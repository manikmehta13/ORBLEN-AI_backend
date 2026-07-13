// ── Chat Routes ───────────────────────────────────────────────────────────────
// Provides all LLM chat endpoints:
//   POST /api/gemini, /api/mistral, /api/codestral,
//        /api/groq, /api/groq-llama-8b, /api/groq-gpt-120b, /api/groq-gpt-20b
//     → Legacy per-agent endpoints (agentic search + optional streaming)
//
//   POST /api/chat
//     → Single unified endpoint with marker processing
//
//   POST /api/chat-enhanced
//     → Full pipeline: enhance → web search → memory → stream → markers → extract

const { Router } = require("express");
const {
  isGroqAgent,
  GROQ_MODEL_MAP,
  getGroqMaxTokens,
  BACKEND_AGENT_NAMES,
} = require("../models/constants");
const { callModelBackend } = require("../models/callModel");
const { streamOpenAICompatibleTokens } = require("../models/streaming");
const {
  addResponseStyleInstructionToMessages,
  addResponseStyleInstructionToPrompt,
} = require("../services/responseStyle");
const { executeAgenticSearch } = require("../services/agenticSearch");
const {
  fetchWebContextForBranch,
  formatWebContextForPrompt,
} = require("../services/webSearch");
const {
  getUserUid,
  processMarkers,
  loadMemoriesFromFirebase,
  extractMemoriesBackground,
} = require("../services/memory");

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
//  Legacy per-agent endpoints (non-streaming + streaming)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles a non-streaming agentic chat request.
 * Fetches web context, injects it into the last user message, then calls the model.
 */
async function handleAgenticChatRoute(req, res, agentName, isGeminiPrompt = false) {
  let messages = req.body.messages;
  let prompt = req.body.prompt;

  if (isGeminiPrompt) {
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    messages = [{ role: "user", content: addResponseStyleInstructionToPrompt(prompt) }];
  } else {
    if (!messages) return res.status(400).json({ error: "messages required" });
    messages = addResponseStyleInstructionToMessages(messages);
  }

  try {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const webContext = await executeAgenticSearch(agentName, lastUserMsg);

    const chatMessages = [...messages];
    if (webContext) {
      chatMessages[chatMessages.length - 1].content += "\n\n" + formatWebContextForPrompt(webContext);
    }

    const response = await callModelBackend(agentName, chatMessages);
    res.json({ result: response });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * Handles a streaming agentic chat request over SSE.
 * Fetches web context, then streams tokens from the resolved provider.
 */
async function handleAgenticChatRouteStream(req, res, agentName, isGeminiPrompt = false) {
  let messages = req.body.messages;
  let prompt = req.body.prompt;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  if (isGeminiPrompt) {
    if (!prompt) {
      sendEvent({ type: "error", message: "prompt required" });
      return res.end();
    }
    messages = [{ role: "user", content: addResponseStyleInstructionToPrompt(prompt) }];
  } else {
    if (!messages) {
      sendEvent({ type: "error", message: "messages required" });
      return res.end();
    }
    messages = addResponseStyleInstructionToMessages(messages);
  }

  try {
    sendEvent({ type: "status", message: "🔍 Searching the web…" });
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const webContext = await executeAgenticSearch(agentName, lastUserMsg, sendEvent);
    const chatMessages = [...messages];
    if (webContext) {
      chatMessages[chatMessages.length - 1].content += "\n\n" + formatWebContextForPrompt(webContext);
    }

    sendEvent({ type: "status", message: "🤖 Generating response…" });

    let fullResponse = "";

    if (isGroqAgent(agentName)) {
      if (!process.env.GROQ_API_KEY) throw new Error("Groq key not configured.");
      const groqModel = GROQ_MODEL_MAP[agentName];
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: groqModel,
          messages: chatMessages,
          max_tokens: getGroqMaxTokens(agentName),
          temperature: 0.7,
          stream: true,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!groqRes.ok) {
        const errText = await groqRes.text();
        throw new Error(`Groq API error (${groqRes.status}): ${errText.slice(0, 200)}`);
      }
      const reader = groqRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || "";
            if (content) { fullResponse += content; sendEvent({ type: "token", text: content }); }
          } catch { /* skip malformed */ }
        }
      }
    } else if (agentName === "mistral") {
      if (!process.env.MISTRAL_API_KEY) throw new Error("Mistral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://api.mistral.ai/v1/chat/completions",
        { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "mistral-large-latest", messages: chatMessages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agentName === "codestral") {
      if (!process.env.CODESTRAL_API_KEY) throw new Error("Codestral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://codestral.mistral.ai/v1/chat/completions",
        { Authorization: `Bearer ${process.env.CODESTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "codestral-latest", messages: chatMessages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agentName === "gemini") {
      if (!process.env.GEMINI_API_KEY) throw new Error("Gemini key not configured.");
      const geminiPrompt = chatMessages[chatMessages.length - 1].content;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: geminiPrompt }] }] }),
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${text.slice(0, 200)}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (text) { fullResponse += text; sendEvent({ type: "token", text }); }
          } catch { /* skip malformed */ }
        }
      }
    } else {
      throw new Error("Invalid agent selected.");
    }

    sendEvent({ type: "done", result: fullResponse });
    res.end();
  } catch (err) {
    sendEvent({ type: "error", message: err.message });
    res.end();
  }
}

/**
 * Factory: returns an Express route handler for a named agent.
 * Delegates to the streaming or non-streaming handler based on req.body.stream.
 */
function apiChatRoute(agentName, isGeminiPrompt = false) {
  return async (req, res) => {
    if (req.body.stream) {
      return handleAgenticChatRouteStream(req, res, agentName, isGeminiPrompt);
    }
    return handleAgenticChatRoute(req, res, agentName, isGeminiPrompt);
  };
}

// Register legacy per-agent endpoints
router.post("/gemini", apiChatRoute("gemini", true));
router.post("/mistral", apiChatRoute("mistral"));
router.post("/codestral", apiChatRoute("codestral"));
router.post("/groq", apiChatRoute("groq"));
router.post("/groq-llama-8b", apiChatRoute("groq-llama-8b"));
router.post("/groq-gpt-120b", apiChatRoute("groq-gpt-120b"));
router.post("/groq-gpt-20b", apiChatRoute("groq-gpt-20b"));

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/chat — unified chat with marker processing
// ─────────────────────────────────────────────────────────────────────────────
router.post("/chat", async (req, res) => {
  const { messages, agent } = req.body;
  if (!messages || !agent) return res.status(400).json({ error: "messages and agent required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  let uid = null;
  try {
    if (req.headers.authorization) uid = await getUserUid(req.headers.authorization);
  } catch { /* non-critical */ }

  try {
    sendEvent({ type: "status", message: "🤖 Generating response…" });
    let fullResponse = "";

    if (isGroqAgent(agent)) {
      if (!process.env.GROQ_API_KEY) throw new Error("Groq key not configured.");
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: GROQ_MODEL_MAP[agent],
          messages,
          max_tokens: getGroqMaxTokens(agent),
          temperature: 0.7,
          stream: true,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!groqRes.ok) {
        const errText = await groqRes.text();
        throw new Error(`Groq API error (${groqRes.status}): ${errText.slice(0, 200)}`);
      }
      const reader = groqRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || "";
            if (content) { fullResponse += content; sendEvent({ type: "token", text: content }); }
          } catch { /* skip */ }
        }
      }
    } else if (agent === "mistral") {
      if (!process.env.MISTRAL_API_KEY) throw new Error("Mistral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://api.mistral.ai/v1/chat/completions",
        { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "mistral-large-latest", messages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agent === "codestral") {
      if (!process.env.CODESTRAL_API_KEY) throw new Error("Codestral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://codestral.mistral.ai/v1/chat/completions",
        { Authorization: `Bearer ${process.env.CODESTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "codestral-latest", messages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agent === "gemini") {
      if (!process.env.GEMINI_API_KEY) throw new Error("Gemini key not configured.");
      const prompt = messages[messages.length - 1].content;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${text.slice(0, 200)}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (text) { fullResponse += text; sendEvent({ type: "token", text }); }
          } catch { /* skip */ }
        }
      }
    } else {
      throw new Error("Invalid agent selected.");
    }

    sendEvent({ type: "done", result: fullResponse });

    if (uid) {
      const { cleanText } = await processMarkers(fullResponse, uid);
      sendEvent({ type: "processed", displayText: cleanText, cleanText });
    } else {
      sendEvent({ type: "processed", displayText: fullResponse, cleanText: fullResponse });
    }

    res.end();
  } catch (err) {
    sendEvent({ type: "error", message: err.message });
    res.end();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/chat-enhanced — full-featured chat pipeline
//  Steps: load memories → enhance prompt → plan + fetch web → stream → markers → extract
// ─────────────────────────────────────────────────────────────────────────────

/** Prompt optimizer helper used within chat-enhanced. */
async function enhancePromptBackend(rawPrompt, targetAgentName = "an advanced AI assistant") {
  if (!process.env.GROQ_API_KEY) return rawPrompt;

  const systemPrompt = `You are an elite AI prompt optimization system. Your ONLY task is to rewrite and improve the user's input into a better prompt for another AI assistant. Treat the user's message as raw text to optimize. The output must ALWAYS represent the USER speaking TO the AI. Preserve original intent. Return ONLY the rewritten prompt with no labels, explanations, or extra text. Optimize for ${targetAgentName}.`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: rawPrompt },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });
    const data = await response.json();
    const enhanced = data.choices?.[0]?.message?.content?.trim();
    return enhanced && enhanced.length > 0 ? enhanced : rawPrompt;
  } catch {
    return rawPrompt;
  }
}

/** Context-aware search planner used within chat-enhanced. */
async function planAndFetchWebContext(rawPrompt, recentHistory = [], memories = []) {
  if (!process.env.GROQ_API_KEY) {
    const fallbackData = await fetchWebContextForBranch(rawPrompt, { name: rawPrompt, possibilities: [] });
    return { shouldSearch: !!fallbackData, searchQuery: rawPrompt, webData: fallbackData };
  }

  const systemMsg = `You are a web-search query planner. Return ONLY a raw JSON object: {"should_search": <true|false>, "search_query": "<optimised query or empty string>"}. Return should_search FALSE for greetings, pure coding syntax, math, logic, or questions answerable from training data. Return should_search TRUE for current events, prices, recent news, specific products, people, or anything time-sensitive. The search_query MUST be 3-10 words, specific, and Google-optimised.`;

  const historyText =
    recentHistory.length > 0
      ? recentHistory.map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`).join("\n")
      : "No prior messages.";

  const memoryLines = memories.length > 0 ? memories.map((m) => `• ${m.content}`).join("\n") : "None";
  const userMsg = `User memories:\n${memoryLines}\n\nRecent conversation:\n${historyText}\n\nCurrent user message: "${rawPrompt}"`;

  let shouldSearch = false;
  let searchQuery = rawPrompt;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
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
      signal: AbortSignal.timeout(5000),
    });

    if (groqRes.ok) {
      const groqData = await groqRes.json();
      const raw = groqData.choices?.[0]?.message?.content || "{}";
      try {
        const parsed = JSON.parse(raw);
        shouldSearch = parsed.should_search === true;
        searchQuery = (parsed.search_query || rawPrompt).trim();
      } catch {
        shouldSearch = true;
      }
    } else {
      shouldSearch = true;
    }
  } catch {
    shouldSearch = true;
  }

  if (!shouldSearch) return { shouldSearch: false, searchQuery, webData: null };

  const webData = await fetchWebContextForBranch(searchQuery, { name: searchQuery, possibilities: [] });
  return { shouldSearch: true, searchQuery, webData };
}

router.post("/chat-enhanced", async (req, res) => {
  const { messages, agent, rawPrompt, options = {} } = req.body;
  const {
    enhance: enableEnhance = true,
    webSearch: enableWebSearch = true,
    memories: enableMemories = true,
  } = options;

  if (!messages || !Array.isArray(messages) || !agent || !rawPrompt) {
    return res.status(400).json({ error: "messages, agent, and rawPrompt are required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  let uid = null;
  try {
    if (req.headers.authorization) uid = await getUserUid(req.headers.authorization);
  } catch { /* non-critical */ }

  try {
    // STEP 1: Load memories
    let userMemories = [];
    if (enableMemories && uid) {
      try {
        userMemories = await loadMemoriesFromFirebase(uid);
        if (userMemories.length > 0) {
          sendEvent({ type: "status", message: `🧠 Loaded ${userMemories.length} memor${userMemories.length === 1 ? "y" : "ies"}…` });
        }
      } catch { /* non-critical */ }
    }

    // STEP 2: Enhance prompt
    let finalPrompt = rawPrompt;
    if (enableEnhance) {
      sendEvent({ type: "status", message: "✨ Enhancing your prompt…" });
      const agentNames = { gemini: "Gemini Flash", mistral: "Mistral Large", codestral: "Codestral", groq: "LLaMA Groq" };
      const targetAgentName = agentNames[agent] || "an advanced AI assistant";
      try {
        const enhanced = await enhancePromptBackend(rawPrompt, targetAgentName);
        if (enhanced && enhanced !== rawPrompt) {
          finalPrompt = enhanced;
          sendEvent({ type: "enhanced", enhancedPrompt: finalPrompt });
        }
      } catch { /* non-critical */ }
    }

    // STEP 3: Context-aware web search
    let webData = null;
    let searchQuery = null;
    const isTrivial = /^(hi|hello|hey|hiya|yo|sup|thanks|thank you|bye|good morning|good night|good afternoon|good evening|yes|no|ok|okay|sure|alright|lol|haha|nice|great|awesome|cool|maybe|idk|oh|ah|um|hmm)[\s!?.]*$/i.test(rawPrompt.trim()) || rawPrompt.trim().length < 3;

    if (enableWebSearch && !isTrivial) {
      sendEvent({ type: "status", message: "🧠 Planning search strategy…" });
      const recentHistory = messages
        .filter((m) => m.role !== "system")
        .slice(-6)
        .map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 400) }));

      try {
        const plan = await planAndFetchWebContext(rawPrompt, recentHistory, userMemories);
        if (plan.shouldSearch) {
          searchQuery = plan.searchQuery;
          sendEvent({ type: "status", message: `🌐 Searching: "${plan.searchQuery}"…` });
          webData = plan.webData;
          if (webData) {
            sendEvent({
              type: "web_results",
              count: webData.results?.length || 0,
              service: webData.service || "Web",
              query: plan.searchQuery,
              answer: webData.answer || null,
              results: (webData.results || []).map((r) => ({
                title: r.title,
                url: r.url,
                snippet: (r.snippet || r.content || "").slice(0, 200),
                date: r.date || null,
              })),
            });
          }
        } else {
          sendEvent({ type: "search_plan", shouldSearch: false, reason: "Query answered by training data" });
        }
      } catch { /* web search failure is non-critical */ }
    }

    // STEP 4: Build final message set
    const BASE_SYSTEM = "You are Orblen AI, an advanced assistant with live search. Use provided search results to give accurate, up-to-date answers, citing sources as [1]. Default to short, concise responses with proper punctuation. Expand only when necessary.";

    let sysContent = BASE_SYSTEM;
    if (userMemories.length > 0) {
      const memSummary = userMemories.map((m) => m.content.trim()).join(". ");
      sysContent += `\n\nUser background context: ${memSummary}\nUse this context naturally and helpfully when relevant. Do not mention that you have a stored memory system.`;
    }

    let webContextBlock = "";
    if (webData && webData.results && webData.results.length > 0) {
      const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      webContextBlock = `\n\n────────────────────────────────────────\nLIVE WEB SEARCH RESULTS\nQuery: "${searchQuery}"\nRetrieved: ${today} | Source: ${webData.service || "Web"}\n────────────────────────────────────────\n`;
      if (webData.answer) webContextBlock += `📋 AI Summary: ${webData.answer}\n\n`;
      webData.results.slice(0, 3).forEach((r, i) => {
        webContextBlock += `[${i + 1}] ${r.title || "Result"}`;
        if (r.date) webContextBlock += ` (${r.date})`;
        webContextBlock += "\n";
        const snippet = (r.snippet || r.content || "").slice(0, 180).trim();
        if (snippet) webContextBlock += `   ${snippet}\n`;
        if (r.url) webContextBlock += `   🔗 ${r.url}\n`;
        webContextBlock += "\n";
      });
      webContextBlock += `────────────────────────────────────────\n`;
    }

    const chatMessages = [
      { role: "system", content: sysContent },
      { role: "user", content: finalPrompt + webContextBlock },
    ];

    // STEP 5: Stream model response
    sendEvent({ type: "status", message: `🤖 Asking ${BACKEND_AGENT_NAMES[agent] || agent}…` });

    let fullResponse = "";

    if (isGroqAgent(agent)) {
      if (!process.env.GROQ_API_KEY) throw new Error("Groq key not configured.");
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: GROQ_MODEL_MAP[agent],
          messages: chatMessages,
          max_tokens: getGroqMaxTokens(agent),
          temperature: 0.7,
          stream: true,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!groqRes.ok) {
        const errText = await groqRes.text();
        throw new Error(`Groq API error (${groqRes.status}): ${errText.slice(0, 200)}`);
      }
      const reader = groqRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || "";
            if (content) { fullResponse += content; sendEvent({ type: "token", text: content }); }
          } catch { /* skip */ }
        }
      }
    } else if (agent === "mistral") {
      if (!process.env.MISTRAL_API_KEY) throw new Error("Mistral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://api.mistral.ai/v1/chat/completions",
        { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "mistral-large-latest", messages: chatMessages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agent === "codestral") {
      if (!process.env.CODESTRAL_API_KEY) throw new Error("Codestral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://codestral.mistral.ai/v1/chat/completions",
        { Authorization: `Bearer ${process.env.CODESTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "codestral-latest", messages: chatMessages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agent === "gemini") {
      if (!process.env.GEMINI_API_KEY) throw new Error("Gemini key not configured.");
      const geminiPrompt = chatMessages.map((m) => m.content).join("\n\n");
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: geminiPrompt }] }] }),
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${text.slice(0, 200)}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (text) { fullResponse += text; sendEvent({ type: "token", text }); }
          } catch { /* skip */ }
        }
      }
    } else {
      // Gemini family (gemma, gemini-pro, gemini-thinking, etc.)
      if (!process.env.GEMINI_API_KEY) throw new Error("Gemini key not configured.");
      const geminiPrompt = chatMessages.map((m) => m.content).join("\n\n");
      const agentModelMap = {
        gemma: "gemma-3-27b-it",
        "gemini-pro": "gemini-pro",
        "gemini-thinking": "gemini-2.0-flash-thinking-exp",
      };
      const model = agentModelMap[agent] || "gemini-3.5-flash";
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: geminiPrompt }] }] }),
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${agent} API error (${response.status}): ${text.slice(0, 200)}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (text) { fullResponse += text; sendEvent({ type: "token", text }); }
          } catch { /* skip */ }
        }
      }
    }

    // STEP 6: Process SAVE_MEMORY markers
    sendEvent({ type: "done", result: fullResponse });

    let displayText = fullResponse;
    let memorySaved = false;

    if (uid) {
      const { cleanText } = await processMarkers(fullResponse, uid);
      displayText = cleanText;
      memorySaved = cleanText !== fullResponse;
    } else {
      displayText = fullResponse
        .replace(/\[SAVE_MEMORY\][\s\S]*?\[\/SAVE_MEMORY\]/g, "🧠 Memory saved")
        .trim();
    }

    sendEvent({ type: "processed", displayText, cleanText: displayText, memorySaved });

    // STEP 7: Background memory extraction (fire-and-forget)
    if (uid && enableMemories) {
      const allMessages = [
        ...messages.filter((m) => m.role !== "system").slice(-3),
        { role: "assistant", content: displayText },
      ];
      extractMemoriesBackground(allMessages, uid).catch(() => {});
    }

    res.end();
  } catch (err) {
    console.error("[/api/chat-enhanced] Error:", err.message);
    sendEvent({ type: "error", message: err.message });
    res.end();
  }
});

module.exports = router;
