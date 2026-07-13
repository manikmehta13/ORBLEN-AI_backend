// ── Web Search Service ────────────────────────────────────────────────────────
// Provides search via Tavily AI (primary), DuckDuckGo (free fallback), and
// SerpAPI (Google), plus URL scraping and response formatting utilities.

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch wrapper that aborts after `timeoutMs` milliseconds.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strips common conversational noise from a search query so search engines
 * return more relevant results.
 * @param {string} query
 * @returns {string}
 */
function cleanSearchQuery(query) {
  return query
    .replace(
      /\b(hey|hello|hi|tell me about|can you|would you|could you|please|thanks|thank you)\b/gi,
      ""
    )
    .replace(/[?¿!¡]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tavily AI Search
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes a dynamic max_results value based on query complexity, so simple
 * queries don't waste Tavily credits while complex ones get more results.
 * @param {string} query
 * @returns {number} 1–20
 */
function getDynamicTavilyMaxResults(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return 5;

  let maxResults = 5;
  if (/\b(latest|current|recent|today|2026|2025|news|trending|update|updates)\b/.test(q)) maxResults += 5;
  if (/\b(compare|versus|vs|best|top|alternatives|choices|options|review|ratings|rank|ranking)\b/.test(q)) maxResults += 4;
  if (/\b(and|or|plus|also|including)\b/.test(q)) maxResults += 2;
  if (q.length > 80 || q.split(/\s+/).length > 12) maxResults += 2;
  if (q.includes("?")) maxResults += 1;

  return Math.max(1, Math.min(20, maxResults));
}

/**
 * Performs an AI-optimised search via Tavily.
 * Returns `{ results, answer }` or `null` on failure / missing key.
 * @param {string} query
 * @returns {Promise<{results: object[], answer: string|null}|null>}
 */
async function handleTavilySearch(query) {
  try {
    const cleaned = cleanSearchQuery(query) || query;
    const maxResults = getDynamicTavilyMaxResults(cleaned);
    const response = await fetchWithTimeout("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: cleaned,
        topic: "general",
        max_results: maxResults,
        include_answer: true,
      }),
    });

    const data = await response.json();
    if (data.error) {
      console.error("Tavily error:", data.error);
      return null;
    }

    const results = (data.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      score: r.score,
      source: "Tavily",
    }));

    return { results, answer: data.answer || null };
  } catch (err) {
    console.error("Tavily error:", err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  DuckDuckGo Organic Scraper (free, no key)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scrapes organic results from DuckDuckGo HTML search.
 * Returns up to 8 result objects.
 * @param {string} query
 * @returns {Promise<object[]>}
 */
async function handleDuckDuckGoSearch(query) {
  try {
    const cleaned = cleanSearchQuery(query) || query;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleaned)}`;
    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const html = await response.text();
    const results = [];
    const resultBlocks = html.split('<div class="result results_links results_links_deep web-result');

    for (let i = 1; i < resultBlocks.length; i++) {
      const block = resultBlocks[i];
      const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

      if (titleMatch) {
        let urlLink = titleMatch[1];
        if (urlLink.includes("uddg=")) {
          const parts = urlLink.split("uddg=");
          if (parts[1]) urlLink = decodeURIComponent(parts[1].split("&")[0]);
        }
        if (urlLink.startsWith("//")) urlLink = "https:" + urlLink;
        else if (urlLink.startsWith("/")) urlLink = "https://duckduckgo.com" + urlLink;

        const cleanTitle = titleMatch[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
        const cleanSnippet = snippetMatch
          ? snippetMatch[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
          : "";

        const dateMatch = cleanSnippet.match(
          /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})/i
        );

        results.push({
          title: cleanTitle,
          url: urlLink,
          snippet: cleanSnippet,
          date: dateMatch ? dateMatch[1] : null,
          source: "DuckDuckGo",
        });
      }
    }

    return results.slice(0, 8);
  } catch (err) {
    console.error("DuckDuckGo scraper error:", err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SerpAPI (Google Search Results)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches Google organic results via SerpAPI.
 * Requires SERPAPI_KEY in environment variables.
 * @param {string} query
 * @returns {Promise<object[]>}
 */
async function handleSerpAPISearch(query) {
  try {
    const cleaned = cleanSearchQuery(query) || query;
    const params = new URLSearchParams({
      q: cleaned,
      api_key: process.env.SERPAPI_KEY,
      engine: "google",
      num: 8,
    });

    const response = await fetchWithTimeout(`https://serpapi.com/search?${params}`);
    const data = await response.json();

    if (data.error) {
      console.error("SerpAPI error:", data.error);
      return [];
    }

    return (data.organic_results || []).map((r) => ({
      position: r.position,
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      source: "Google (SerpAPI)",
    }));
  } catch (err) {
    console.error("SerpAPI error:", err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  URL Scraper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches and extracts readable text from a URL.
 * Returns a result object with title, url, snippet, and source.
 * @param {string} url
 * @returns {Promise<object>}
 */
async function scrapeUrlContent(url) {
  try {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        },
      },
      6000
    );

    if (!response.ok) throw new Error(`HTTP status ${response.status}`);

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, "").trim() : url;

    let snippet = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();

    return { title, url, snippet: snippet.slice(0, 3000), source: "Direct Web Visit" };
  } catch (err) {
    console.error(`Error visiting ${url}:`, err.message);
    return {
      title: "Page unreachable",
      url,
      snippet: `Unable to retrieve page content: ${err.message}`,
      source: "Direct Web Visit",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Result Enrichment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enriches all search results by scraping their pages in parallel.
 * Falls back to the original result if scraping fails.
 * @param {object[]} results
 * @returns {Promise<object[]>}
 */
async function enrichSearchResults(results) {
  if (!results || !results.length) return results;

  return await Promise.all(
    results.map(async (r) => {
      if (r.url && r.url.startsWith("http")) {
        const scrapeRes = await scrapeUrlContent(r.url);
        if (scrapeRes && scrapeRes.snippet && !scrapeRes.snippet.startsWith("Unable to retrieve")) {
          return { ...r, snippet: scrapeRes.snippet.slice(0, 2000), isEnriched: true };
        }
      }
      return r;
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Branch Search Helpers (used by Deep Research & Agentic Search)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a concise, targeted search query string from a research topic and branch.
 * @param {string} topic
 * @param {{ name: string, possibilities: string[] }} branch
 * @returns {string}
 */
function buildBranchSearchQuery(topic, branch) {
  const topicSlice = topic.slice(0, 55).trim();
  const branchSlice = branch.name.slice(0, 45).trim();
  const possSlice = (branch.possibilities || [])[0]?.slice(0, 35).trim() || "";
  return [topicSlice, branchSlice, possSlice].filter(Boolean).join(" ");
}

/**
 * Fetches live web results for a research branch.
 * Tries Tavily first, then DuckDuckGo.
 * Returns null on complete failure (callers degrade gracefully).
 * @param {string} topic
 * @param {{ name: string, possibilities: string[] }} branch
 * @returns {Promise<object|null>}
 */
async function fetchWebContextForBranch(topic, branch) {
  const query = buildBranchSearchQuery(topic, branch);

  // Primary: Tavily
  if (process.env.TAVILY_API_KEY) {
    try {
      const result = await handleTavilySearch(query);
      if (result && result.results && result.results.length > 0) {
        return { query, service: "Tavily", icon: "🔮", results: result.results, answer: result.answer || null };
      }
    } catch {
      /* silent fallthrough */
    }
  }

  // Fallback: DuckDuckGo
  try {
    const results = await handleDuckDuckGoSearch(query);
    if (results && results.length > 0) {
      return { query, service: "DuckDuckGo", icon: "🦆", results, answer: null };
    }
  } catch {
    /* silent */
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Prompt Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats web search results into a structured block for injection into an
 * AI prompt. Returns an empty string if no results are available.
 * @param {object|null} webContext
 * @returns {string}
 */
function formatWebContextForPrompt(webContext) {
  if (!webContext || !webContext.results || webContext.results.length === 0) return "";

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let block = "\n\n---\n";
  block += `🌐 LIVE WEB SEARCH RESULTS\n`;
  block += `Query: "${webContext.query}"\n`;
  block += `Retrieved: ${today} | Source: ${webContext.service}\n`;

  if (webContext.answer) block += `\n📋 AI Summary: ${webContext.answer}\n`;

  block += `\n━━━ Results ━━━\n\n`;
  webContext.results.forEach((r, i) => {
    block += `[${i + 1}] ${r.title || "Untitled"}`;
    if (r.date) block += ` (${r.date})`;
    block += "\n";
    const snippet = (r.snippet || r.content || r.text || "").slice(0, 350);
    if (snippet) block += `   ${snippet}\n`;
    if (r.url) block += `   🔗 ${r.url}\n`;
    block += "\n";
  });

  block += "━━━━━━━━━━━━━━━━━━━\n";
  block += "INSTRUCTIONS:\n";
  block += "• SYNTHESIZE both your training knowledge AND the web data above to produce the best answer.\n";
  block += "• Use real-time numbers, figures, and facts from the web to make your response accurate and current.\n";
  block += "• Use your training knowledge to provide context, analyze historical and current trends, and accurately predict future trends and situations based on this data.\n";
  block += "• Keep the final answer concise by default; expand only when the user's request or required nuance calls for it. Do not follow a fixed word limit.\n";
  block += "• Cite web sources by number, e.g. [1]. When combining both sources, note what comes from web vs training.\n";
  block += "• If web data conflicts with your training knowledge, defer to the web data (it is more current).\n";
  block += "• Dates are shown where available — prefer more recent sources for time-sensitive topics.\n";

  return block;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Response Format Helpers (for /api/search routes)
// ─────────────────────────────────────────────────────────────────────────────

/** Escapes special characters for XML output. */
function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Removes duplicate search queries (case-insensitive). */
function dedupeSearchQueries(queries) {
  const seen = new Set();
  const cleaned = [];
  for (const q of queries || []) {
    const value = String(q || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(value);
  }
  return cleaned;
}

/**
 * Serialises a search result payload to JSON, YAML, XML, or Markdown.
 * Defaults to JSON.
 * @param {object} payload
 * @param {string} [format]
 * @returns {string}
 */
function formatSearchResponse(payload, format = "json") {
  const normalized = String(format || "json").toLowerCase();

  if (normalized === "yaml" || normalized === "yml") {
    const lines = [
      `success: ${payload.success ? "true" : "false"}`,
      `query: ${JSON.stringify(payload.query)}`,
      `service: ${JSON.stringify(payload.service)}`,
      `count: ${payload.count ?? 0}`,
      `answer: ${payload.answer ? JSON.stringify(payload.answer) : "null"}`,
      `search_queries:`,
    ];
    for (const q of payload.search_queries || []) lines.push(`  - ${JSON.stringify(q)}`);
    lines.push(`results:`);
    for (const r of payload.results || []) {
      lines.push(`  - title: ${JSON.stringify(r.title || "")}`);
      lines.push(`    url: ${JSON.stringify(r.url || "")}`);
      lines.push(`    snippet: ${JSON.stringify(r.snippet || r.content || "")}`);
      if (r.date) lines.push(`    date: ${JSON.stringify(r.date)}`);
      if (r.source) lines.push(`    source: ${JSON.stringify(r.source)}`);
    }
    return lines.join("\n");
  }

  if (normalized === "xml") {
    const resultsXml = (payload.results || [])
      .map((r) =>
        [
          "    <result>",
          `      <title>${escapeXml(r.title || "")}</title>`,
          `      <url>${escapeXml(r.url || "")}</url>`,
          `      <snippet>${escapeXml(r.snippet || r.content || "")}</snippet>`,
          r.date ? `      <date>${escapeXml(r.date)}</date>` : "",
          r.source ? `      <source>${escapeXml(r.source)}</source>` : "",
          "    </result>",
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n");

    const queriesXml = (payload.search_queries || [])
      .map((q) => `    <query>${escapeXml(q)}</query>`)
      .join("\n");

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<search_response>",
      `  <success>${payload.success ? "true" : "false"}</success>`,
      `  <query>${escapeXml(payload.query)}</query>`,
      `  <service>${escapeXml(payload.service)}</service>`,
      `  <count>${payload.count ?? 0}</count>`,
      payload.answer ? `  <answer>${escapeXml(payload.answer)}</answer>` : "  <answer />",
      "  <search_queries>",
      queriesXml,
      "  </search_queries>",
      "  <results>",
      resultsXml,
      "  </results>",
      "</search_response>",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (normalized === "markdown" || normalized === "md") {
    const lines = [
      `# Search Results`,
      ``,
      `- Query: ${payload.query}`,
      `- Service: ${payload.service}`,
      `- Count: ${payload.count ?? 0}`,
    ];
    if (payload.answer) lines.push(`- Answer: ${payload.answer}`);
    if ((payload.search_queries || []).length > 0) {
      lines.push(``, `## Search Queries`);
      for (const q of payload.search_queries) lines.push(`- ${q}`);
    }
    lines.push(``, `## Results`);
    (payload.results || []).forEach((r, i) => {
      lines.push(`### [${i + 1}] ${r.title || "Result"}`);
      if (r.url) lines.push(`- URL: ${r.url}`);
      if (r.date) lines.push(`- Date: ${r.date}`);
      lines.push(`- Snippet: ${r.snippet || r.content || ""}`);
      lines.push(``);
    });
    return lines.join("\n").trim();
  }

  return JSON.stringify(payload, null, 2);
}

module.exports = {
  fetchWithTimeout,
  cleanSearchQuery,
  handleTavilySearch,
  handleDuckDuckGoSearch,
  handleSerpAPISearch,
  scrapeUrlContent,
  enrichSearchResults,
  buildBranchSearchQuery,
  fetchWebContextForBranch,
  formatWebContextForPrompt,
  dedupeSearchQueries,
  formatSearchResponse,
};
