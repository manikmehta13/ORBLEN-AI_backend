// ── Web Search Routes ─────────────────────────────────────────────────────────
// Provides smart multi-provider search, single-provider endpoints,
// a context-aware search planner, and direct URL scraping.

const { Router } = require("express");
const {
  handleTavilySearch,
  handleDuckDuckGoSearch,
  handleSerpAPISearch,
  scrapeUrlContent,
  enrichSearchResults,
  dedupeSearchQueries,
  formatSearchResponse,
} = require("../services/webSearch");
const { callModelBackend } = require("../models/callModel");

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
//  Helper: pick the first available AI agent for query planning
// ─────────────────────────────────────────────────────────────────────────────
function getAvailableAgent() {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.MISTRAL_API_KEY) return "mistral";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/plan-search
//  Context-aware search query planner: decides whether to search and crafts
//  an optimised query from the current prompt + recent history + memories.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/plan-search", async (req, res) => {
  const { currentPrompt, recentHistory = [], memoryContext = "" } = req.body;
  if (!currentPrompt) return res.status(400).json({ error: "currentPrompt required" });

  const systemMsg = `You are a web-search query planner. You help decide whether a live web search is needed to answer the user's message, and craft the best possible search query if so.

You receive:
- The user's current message
- Their recent conversation history (current chat session only)
- Their personal memory context (facts learned from previous sessions)

Return ONLY a raw JSON object — no markdown, no backticks, no explanation:
{"should_search": <true|false>, "search_query": "<optimised query or empty string>"}

Decision rules:
- Return should_search: FALSE for: greetings, pure coding questions (syntax, algorithms, debugging) unless asking about latest versions/releases, math, logic, abstract reasoning, or any question fully answerable from the conversation history or general training knowledge.
- Return should_search: TRUE for: current events, prices, recent news, latest library/framework versions, specific product or company info, people ("who is..."), comparisons with recency ("X vs Y in 2026"), and anything where training data may be outdated.

Query crafting rules:
- Resolve pronouns and references using conversation history ("that framework" → infer from prior messages)
- Use memory context to personalise queries where helpful
- The search_query MUST be 3-10 words, specific, and Google-optimised
- Include the current year only when recency truly matters`;

  const historyText =
    recentHistory.length > 0
      ? recentHistory.map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`).join("\n")
      : "No prior messages.";

  const userMsg = `User memories:\n${memoryContext || "None"}\n\nRecent conversation:\n${historyText}\n\nCurrent user message: "${currentPrompt}"`;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg },
        ],
        max_tokens: 80,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!groqRes.ok) throw new Error(`Groq plan-search error: ${groqRes.status}`);
    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { should_search: true, search_query: currentPrompt };
    }

    console.log(
      `[PLAN-SEARCH] prompt="${currentPrompt.slice(0, 60)}" → should_search=${parsed.should_search}, query="${parsed.search_query}"`
    );

    res.json({
      should_search: parsed.should_search === true,
      search_query: (parsed.search_query || currentPrompt).trim(),
    });
  } catch (e) {
    console.error("[PLAN-SEARCH] Error, falling back to raw prompt:", e.message);
    res.json({ should_search: true, search_query: currentPrompt });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/search
//  Smart multi-provider search: auto-selects Tavily → SerpAPI → DuckDuckGo,
//  generates parallel sub-queries via LLM, and enriches results by scraping pages.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/search", async (req, res) => {
  const { query, service, format } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });

  console.log(`[SEARCH] Query: "${query}" | Service: ${service || "auto"}`);

  // Direct URL detection
  let urls = query.match(/https?:\/\/[^\s]+/gi);
  if (!urls) {
    const domainMatch = query.trim().match(/^[a-zA-Z0-9.-]+\.[a-z]{2,6}(?:\/\S*)?$/i);
    if (domainMatch) urls = [`https://${query.trim()}`];
  }

  if (urls && urls.length > 0) {
    const searchQueries = dedupeSearchQueries(urls);
    const results = await Promise.all(searchQueries.map((url) => scrapeUrlContent(url)));
    const payload = {
      success: true,
      query,
      results,
      service: "direct_visit",
      count: results.length,
      search_queries: searchQueries,
      format: String(format || "json").toLowerCase(),
    };
    return res.json({ ...payload, formatted: formatSearchResponse(payload, format) });
  }

  // Generate parallel sub-queries via LLM
  let searchQueries = [query];
  const agent = getAvailableAgent();
  if (agent) {
    try {
      const prompt = `You are a Search Intent Analyzer. The user wants to find information about: "${query}".
Output a JSON array containing distinct search queries (as plain strings) that will help retrieve the most comprehensive, relevant, and updated results for this topic.
Use as many query variants as are helpful.
Format: ["query 1", "query 2"]
Do not add any markup, conversational introductory text, or explanations. Only return the raw JSON array.`;

      const resText = await callModelBackend(agent, [{ role: "user", content: prompt }]);
      const match = resText.match(/\[[\s\S]*?\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          searchQueries = dedupeSearchQueries(parsed);
        }
      }
    } catch (err) {
      console.error("[SEARCH ANALYZER] Failed to generate parallel search queries:", err.message);
    }
  }

  console.log(`[SEARCH] Planned parallel search queries: ${JSON.stringify(searchQueries)}`);

  // Execute all sub-queries in parallel
  const allSearchResults = await Promise.all(
    searchQueries.map(async (subQuery) => {
      let results = [];
      let serviceUsed = "duckduckgo";
      let answer = null;

      if ((!service || service === "auto" || service === "tavily") && process.env.TAVILY_API_KEY) {
        const tavilyResult = await handleTavilySearch(subQuery);
        if (tavilyResult) {
          results = tavilyResult.results;
          serviceUsed = "tavily";
          answer = tavilyResult.answer;
        }
      }

      if (
        results.length === 0 &&
        (!service || service === "auto" || service === "serpapi") &&
        process.env.SERPAPI_KEY
      ) {
        const serpResults = await handleSerpAPISearch(subQuery);
        if (serpResults && serpResults.length > 0) {
          results = serpResults;
          serviceUsed = "serpapi";
        }
      }

      if (results.length === 0) {
        results = await handleDuckDuckGoSearch(subQuery);
        serviceUsed = "duckduckgo";
      }

      const enrichedResults = await enrichSearchResults(results);
      const taggedResults = enrichedResults.map((r) => ({
        ...r,
        title: `[Query: "${subQuery}"] ${r.title || "Result"}`,
      }));

      return { service: serviceUsed, results: taggedResults, answer };
    })
  );

  let mergedResults = [];
  let combinedAnswers = [];
  for (const item of allSearchResults) {
    if (item.results) mergedResults.push(...item.results);
    if (item.answer) combinedAnswers.push(item.answer);
  }
  const finalAnswer = combinedAnswers.length > 0 ? combinedAnswers.join(" | ") : null;

  const payload = {
    success: true,
    query,
    results: mergedResults,
    answer: finalAnswer,
    service: "multi_search",
    count: mergedResults.length,
    search_queries: searchQueries,
  };

  res.json({
    ...payload,
    format: String(format || "json").toLowerCase(),
    formatted: formatSearchResponse(payload, format),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/search/duckduckgo  — DuckDuckGo only (free, no key)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/search/duckduckgo", async (req, res) => {
  const { query, format } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });

  try {
    const results = await handleDuckDuckGoSearch(query);
    const payload = {
      success: true,
      query,
      results,
      service: "duckduckgo",
      count: results.length,
      format: String(format || "json").toLowerCase(),
    };
    res.json({ ...payload, formatted: formatSearchResponse(payload, format) });
  } catch (err) {
    res.status(500).json({ error: "Search failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/search/tavily  — Tavily AI only (best for AI research)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/search/tavily", async (req, res) => {
  const { query, format } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });
  if (!process.env.TAVILY_API_KEY) {
    return res.status(503).json({ error: "Tavily API key not configured on server" });
  }

  try {
    const result = await handleTavilySearch(query);
    if (!result) return res.status(500).json({ error: "Tavily search failed" });

    const payload = {
      success: true,
      query,
      results: result.results,
      answer: result.answer,
      service: "tavily",
      count: result.results.length,
      format: String(format || "json").toLowerCase(),
    };
    res.json({ ...payload, formatted: formatSearchResponse(payload, format) });
  } catch (err) {
    res.status(500).json({ error: "Tavily error: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/search/serpapi  — SerpAPI only (Google results)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/search/serpapi", async (req, res) => {
  const { query, format } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });
  if (!process.env.SERPAPI_KEY) {
    return res.status(503).json({ error: "SerpAPI key not configured on server" });
  }

  try {
    const results = await handleSerpAPISearch(query);
    const payload = {
      success: true,
      query,
      results,
      service: "serpapi",
      count: results.length,
      format: String(format || "json").toLowerCase(),
    };
    res.json({ ...payload, formatted: formatSearchResponse(payload, format) });
  } catch (err) {
    res.status(500).json({ error: "SerpAPI error: " + err.message });
  }
});

module.exports = router;
