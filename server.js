// ╔══════════════════════════════════════════════════════════╗
// ║         NEXUS AI — Secure Backend Server                 ║
// ║   All API keys live HERE — never in the frontend         ║
// ╚══════════════════════════════════════════════════════════╝

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { Readable } = require("stream");

const app = express();

// ── CORS: Only allow your Netlify frontend ──
app.use(cors({
  origin: [
    "https://nexushub-ai.netlify.app",
    "http://localhost:3000",
    "http://127.0.0.1:5500"
  ]
}));

app.use(express.json());

// ── Health check ──
app.get("/", (req, res) => {
  res.json({ status: "✅ NEXUS AI Backend is live", version: "1.0.0" });
});

// ══════════════════════════════════════════════════════════════
//  🔑 NVIDIA NIM — shared helper (OpenAI-compatible endpoint)
// ══════════════════════════════════════════════════════════════
async function callNvidiaModel(model, apiKey, messages, res) {
  if (!apiKey) {
    return res.status(503).json({ error: `NVIDIA API key for ${model} not configured on server.` });
  }
  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 1500,
        temperature: 0.7,
        stream: false
      })
    });

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: `NVIDIA NIM (${model}) returned non-JSON: ${raw.slice(0, 120)}` });
    }

    if (data.error) return res.status(400).json({ error: data.error.message || JSON.stringify(data.error) });
    if (!data.choices?.[0]?.message?.content) {
      return res.status(500).json({ error: `NVIDIA NIM (${model}) returned an unexpected response structure.` });
    }

    res.json({ result: data.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ error: `NVIDIA NIM (${model}) request failed: ` + err.message });
  }
}

// ══════════════════════════════════════════════════════════════
//  🤖 ROUTE 1: OpenAI GPT-OSS-120b  ← via NVIDIA NIM (FREE)
// ══════════════════════════════════════════════════════════════
app.post("/api/openai", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages required" });
  await callNvidiaModel("openai/gpt-oss-120b", process.env.NVIDIA_KEY_GPTOSS, messages, res);
});

// ══════════════════════════════════════════════════════════════
//  🤖 ROUTE 2: Google (Gemini)
// ══════════════════════════════════════════════════════════════
app.post("/api/gemini", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: "Gemini key not configured on server." });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );
    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json({ result: data.candidates[0].content.parts[0].text });
  } catch (err) {
    res.status(500).json({ error: "Gemini request failed: " + err.message });
  }
});

// ══════════════════════════════════════════════════════════════
//  🤖 ROUTE 3: Mistral AI
// ══════════════════════════════════════════════════════════════
app.post("/api/mistral", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages required" });

  if (!process.env.MISTRAL_API_KEY) {
    return res.status(503).json({ error: "Mistral key not configured on server." });
  }

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mistral-large-latest",
        messages,
        max_tokens: 1500
      })
    });
    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json({ result: data.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ error: "Mistral request failed: " + err.message });
  }
});

// ══════════════════════════════════════════════════════════════
//  🤖 ROUTE 4: Groq (LLaMA 3.3)
// ══════════════════════════════════════════════════════════════
app.post("/api/groq", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages required" });

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: "Groq key not configured on server." });
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        max_tokens: 1500
      })
    });
    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json({ result: data.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ error: "Groq request failed: " + err.message });
  }
});

// ══════════════════════════════════════════════════════════════
//  🤖 ROUTE 5: Cohere
// ══════════════════════════════════════════════════════════════
app.post("/api/cohere", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  if (!process.env.COHERE_API_KEY) {
    return res.status(503).json({ error: "Cohere key not configured on server." });
  }

  try {
    const response = await fetch("https://api.cohere.com/v2/chat", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.COHERE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "command-r-plus-08-2024",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1500
      })
    });
    const data = await response.json();
    if (data.message && typeof data.message === "string") return res.status(400).json({ error: data.message });
    const text = data.message?.content?.[0]?.text;
    if (!text) return res.status(500).json({ error: "Cohere returned an unexpected response." });
    res.json({ result: text });
  } catch (err) {
    res.status(500).json({ error: "Cohere request failed: " + err.message });
  }
});

// ══════════════════════════════════════════════════════════════
//  🆕 ROUTE 6: Meta LLaMA 3.3 70B — via NVIDIA NIM (FREE)
// ══════════════════════════════════════════════════════════════
app.post("/api/nvidia-llama", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages required" });
  await callNvidiaModel("meta/llama-3.3-70b-instruct", process.env.NVIDIA_KEY_LLAMA, messages, res);
});

// ══════════════════════════════════════════════════════════════
//  ✨ ROUTE 7: Prompt Enhancer — uses Groq (FREE), fallback NVIDIA
// ══════════════════════════════════════════════════════════════
app.post("/api/enhance", async (req, res) => {
  const { prompt, targetAgent } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  const systemPrompt = `
You are an elite AI prompt optimization system.

Your ONLY task is to rewrite and improve the user's input into a better prompt for another AI assistant.

CORE RULE:
Treat the user's message as raw text to optimize.
Do NOT respond to it.
Do NOT act like the assistant.

CRITICAL:
You are NOT the AI assistant solving the task.
You are ONLY a prompt optimizer.

The output must ALWAYS represent the USER speaking TO the AI.
Never write from the assistant's perspective.

INTERACTION TYPE PRESERVATION:
- Questions must remain questions
- Requests must remain requests
- Commands must remain commands
- Instructions must remain instructions
- Conversational prompts must remain conversational
- Greetings must remain greetings

NEVER transform the user's input into:
- An assistant reply
- A chatbot response
- A clarification request
- A follow-up question
- A meta-conversation
- A system message
- A roleplay response

NEVER:
- Answer the user's request
- Solve the task
- Continue the conversation
- Ask the user for more information
- Ask clarifying questions
- Explain your changes
- Add commentary
- Add introductions or conclusions
- Add conversational filler

ALWAYS:
- Preserve the original intent exactly
- Preserve important constraints and details
- Improve clarity, structure, and specificity
- Remove ambiguity when possible
- Optimize for ${targetAgent || "an advanced AI assistant"}
- Keep the prompt natural and directly usable
- Improve quality with the MINIMUM necessary modification

STYLE PRESERVATION:
- Casual prompts should stay casual
- Professional prompts should stay professional
- Technical prompts should stay technical
- Short prompts should stay concise unless expansion is clearly useful

DO NOT:
- Over-expand short prompts
- Make prompts unnecessarily verbose
- Turn casual prompts into formal or academic language
- Add technical detail unless it genuinely improves the request
- Change the meaning, tone, or category of the request

SPECIAL CASES:
- Greetings should usually remain unchanged
- Small talk should remain natural and conversational
- Very short prompts should only be lightly improved
- If the prompt is already good, improve it only slightly

If the user's prompt is vague:
- Infer the most likely intent
- Improve clarity WITHOUT asking questions
- Do not convert ambiguity into a clarification request

GOOD EXAMPLES:
User: "hi"
Output: "Hi"

User: "what are you?"
Output: "What are you and what can you help me with?"

User: "any details about me?"
Output: "What details or information do you know about me?"

User: "write python snake game"
Output: "Create a complete Python snake game using Pygame with smooth movement, score tracking, collision detection, and restart functionality."

User: "best phone under 30000"
Output: "Recommend the best smartphones under ₹30,000, comparing performance, camera quality, battery life, display, and overall value for money."

When beneficial, organize prompts using:
- Goal
- Context
- Requirements
- Constraints
- Output format

OUTPUT RULES:
- Return ONLY the rewritten prompt
- No labels
- No explanations
- No markdown
- No quotation marks
- No code fences
- No extra text before or after the prompt
`;

  // Primary: Groq (free, fast)
  if (process.env.GROQ_API_KEY) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
          max_tokens: 500,
          temperature: 0.3
        })
      });
      const data = await response.json();
      const enhanced = data.choices?.[0]?.message?.content || prompt;
      return res.json({ result: enhanced });
    } catch (err) {
      // fall through to NVIDIA fallback
    }
  }

  // Fallback: NVIDIA NIM (gpt-oss-120b) — also free
  if (process.env.NVIDIA_KEY_GPTOSS) {
    try {
      const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.NVIDIA_KEY_GPTOSS}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
          max_tokens: 500,
          temperature: 0.3,
          stream: false
        })
      });
      const raw = await response.text();
      const data = JSON.parse(raw);
      return res.json({ result: data.choices?.[0]?.message?.content || prompt });
    } catch (err) {
      // safe fallback
    }
  }

  res.json({ result: prompt }); // last resort: return original
});

// ══════════════════════════════════════════════════════════════
//  🧠 ROUTE 8: Memory Extraction — uses Groq LLaMA (FREE)
// ══════════════════════════════════════════════════════════════
app.post("/api/extract-memory", async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) return res.json({ memories: [] });

  if (!process.env.GROQ_API_KEY) return res.json({ memories: [] });

  const systemPrompt = `You are a precision memory extraction AI. Analyze this conversation snippet and extract 0–3 important, reusable facts ABOUT THE USER that would genuinely help personalize future conversations.

EXTRACTION RULES:
- Only extract facts the USER explicitly stated about themselves (not questions they asked)
- Target: name, age, profession, location, skills, ongoing projects, strong preferences, clear goals
- Each memory = one clear sentence starting with "User"
- Category options: "personal" (identity/demographics), "preference" (tastes/style/habits), "project" (active work/goals), "context" (important background knowledge)
- Be conservative — only facts that are genuinely memorable and reusable across future chats
- If nothing worth remembering, return exactly: []
- CRITICAL: Return ONLY a valid JSON array. No explanation, no markdown fences, no extra text.

Example output: [{"content":"User is a 20-year-old computer science student in India","category":"personal"},{"content":"User prefers concise, technical explanations over verbose ones","category":"preference"}]`;

  try {
    const convText = messages
      .filter(m => m.role !== "system")
      .slice(-4)
      .map(m => `${m.role === "user" ? "USER" : "AI"}: ${String(m.content || "").slice(0, 500)}`)
      .join("\n\n");

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Extract memorable user facts from this conversation:\n\n${convText}` }
        ],
        max_tokens: 400,
        temperature: 0.1
      })
    });

    const data = await response.json();
    let rawText = data.choices?.[0]?.message?.content?.trim() || "[]";

    let memories = [];
    try {
      rawText = rawText.replace(/```(?:json)?\n?/g, "").replace(/```\n?/g, "").trim();
      const match = rawText.match(/\[[\s\S]*\]/);
      if (match) rawText = match[0];
      memories = JSON.parse(rawText);
      if (!Array.isArray(memories)) memories = [];
      memories = memories
        .filter(m => m && typeof m.content === "string" && m.content.trim().length > 0)
        .slice(0, 3);
    } catch {
      memories = [];
    }

    res.json({ memories });
  } catch (err) {
    res.json({ memories: [] });
  }
});

// ══════════════════════════════════════════════════════════════
//  🔬 DEEP RESEARCH MODE ENGINE
// ══════════════════════════════════════════════════════════════

const BACKEND_AGENT_NAMES = {
  openai: "GPT-OSS 120B (NIM)",
  "nvidia-llama": "LLaMA 3.3 70B (NIM)",
  gemini: "Gemini Flash",
  mistral: "Mistral Large",
  cohere: "Cohere R+",
  groq: "LLaMA Groq"
};

function getBackendAgentName(a) {
  return BACKEND_AGENT_NAMES[a] || "AI Agent";
}

function getActiveAgent(requestedAgent) {
  const keys = {
    openai: process.env.NVIDIA_KEY_GPTOSS,
    "nvidia-llama": process.env.NVIDIA_KEY_LLAMA,
    gemini: process.env.GEMINI_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
    groq: process.env.GROQ_API_KEY,
    cohere: process.env.COHERE_API_KEY
  };

  if (keys[requestedAgent]) {
    return { agent: requestedAgent, fallback: false };
  }

  const fallbackOrder = ["gemini", "groq", "nvidia-llama", "openai", "mistral", "cohere"];
  for (const agent of fallbackOrder) {
    if (keys[agent]) {
      return { agent, fallback: true, original: requestedAgent };
    }
  }

  return { agent: requestedAgent, fallback: false };
}

async function callNvidiaModelBackend(model, apiKey, messages) {
  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 2000,
      temperature: 0.7,
      stream: false
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices[0].message.content;
}

async function callModelBackend(agent, messages) {
  if (agent === "gemini") {
    if (!process.env.GEMINI_API_KEY) throw new Error("Gemini key not configured.");
    const prompt = messages[messages.length - 1].content;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.candidates[0].content.parts[0].text;
  }

  if (agent === "groq") {
    if (!process.env.GROQ_API_KEY) throw new Error("Groq key not configured.");
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        max_tokens: 2000
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  }

  if (agent === "nvidia-llama") {
    if (!process.env.NVIDIA_KEY_LLAMA) throw new Error("NVIDIA LLaMA key not configured.");
    return await callNvidiaModelBackend("meta/llama-3.3-70b-instruct", process.env.NVIDIA_KEY_LLAMA, messages);
  }

  if (agent === "openai") {
    if (!process.env.NVIDIA_KEY_GPTOSS) throw new Error("NVIDIA GPTOSS key not configured.");
    return await callNvidiaModelBackend("openai/gpt-oss-120b", process.env.NVIDIA_KEY_GPTOSS, messages);
  }

  if (agent === "mistral") {
    if (!process.env.MISTRAL_API_KEY) throw new Error("Mistral key not configured.");
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mistral-large-latest",
        messages,
        max_tokens: 2000
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  }

  if (agent === "cohere") {
    if (!process.env.COHERE_API_KEY) throw new Error("Cohere key not configured.");
    const prompt = messages[messages.length - 1].content;
    const response = await fetch("https://api.cohere.com/v2/chat", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.COHERE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "command-r-plus-08-2024",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2000
      })
    });
    const data = await response.json();
    if (data.message && typeof data.message === "string") throw new Error(data.message);
    const text = data.message?.content?.[0]?.text;
    if (!text) throw new Error("Cohere returned empty response.");
    return text;
  }

  throw new Error("Invalid agent selected.");
}

// ══════════════════════════════════════════════════════════════
//  🌐 WEB SEARCH INTELLIGENCE FOR DEEP RESEARCH
//
//  These helpers decide WHEN to search and retrieve context
//  that gets injected into branch expansion prompts.
// ══════════════════════════════════════════════════════════════

/**
 * Decides whether a research branch benefits from live web data.
 *
 * Logic:
 *  - Scores the combined text (topic + branch name + possibilities) against
 *    two signal lists.
 *  - "Factual" signals: words that suggest real-world, current, or empirical
 *    data would strengthen the analysis.
 *  - "Abstract-only" signals: phrases that indicate pure theory / philosophy
 *    where web results add noise rather than value.
 *  - Returns true when factual signals dominate.
 */
function shouldUseWebSearch(topic, branch) {
  const fullText = (
    topic + " " + branch.name + " " + (branch.possibilities || []).join(" ")
  ).toLowerCase();

  // Signals that strongly suggest live data would help
  const factualSignals = [
    "current", "recent", "latest", "today", "news", "statistic", "statistics",
    "data", "market", "trend", "trends", "price", "prices", "report", "reports",
    "2024", "2025", "2026", "study", "studies", "research", "survey", "surveys",
    "findings", "update", "updates", "emerging", "adoption", "growth", "forecast",
    "forecasts", "industry", "global", "benchmark", "evidence", "technical",
    "technology", "technologies", "implementation", "challenge", "challenges",
    "economic", "socio", "political", "legal", "regulatory", "policy", "policies",
    "impact", "impacts", "case study", "real-world", "practical", "application",
    "applications", "feasibility", "advancement", "development", "breakthrough",
    "innovation", "infrastructure", "solution", "solutions", "future", "roadmap",
    "investment", "funding", "startup", "company", "companies", "government",
    "regulation", "risk", "risks", "security", "privacy", "analysis", "comparison"
  ];

  // Signals that suggest purely abstract reasoning — web search adds little
  const abstractSignals = [
    "pure philosophy", "mathematical proof", "thought experiment",
    "abstract theorem", "metaphysical", "hypothetical only"
  ];

  // If the branch is flagged as purely abstract, skip web search
  if (abstractSignals.some(sig => fullText.includes(sig))) return false;

  // Count how many factual signals appear
  const hits = factualSignals.filter(sig => fullText.includes(sig)).length;

  // Require at least 2 hits so trivially simple topics don't trigger a search
  return hits >= 2;
}

/**
 * Builds a concise, targeted search query from the topic and branch context.
 */
function buildBranchSearchQuery(topic, branch) {
  const topicSlice  = topic.slice(0, 55).trim();
  const branchSlice = branch.name.slice(0, 45).trim();
  const possSlice   = (branch.possibilities || [])[0]?.slice(0, 35).trim() || "";
  return [topicSlice, branchSlice, possSlice].filter(Boolean).join(" ");
}

/**
 * Fetches live web results for a branch.
 * Priority: Tavily (AI-optimised + answer) → DuckDuckGo (free fallback).
 * Returns null on complete failure so callers degrade gracefully.
 */
async function fetchWebContextForBranch(topic, branch) {
  const query = buildBranchSearchQuery(topic, branch);

  // ── Try Tavily first (best quality) ──
  if (process.env.TAVILY_API_KEY) {
    try {
      const result = await handleTavilySearch(query);
      if (result && result.results && result.results.length > 0) {
        return {
          query,
          service: "Tavily",
          icon: "🔮",
          results: result.results.slice(0, 5),
          answer: result.answer || null
        };
      }
    } catch (_) { /* silent — fall through */ }
  }

  // ── DuckDuckGo fallback (always free, no key needed) ──
  try {
    const results = await handleDuckDuckGoSearch(query);
    if (results && results.length > 0) {
      return {
        query,
        service: "DuckDuckGo",
        icon: "🦆",
        results: results.slice(0, 5),
        answer: null
      };
    }
  } catch (_) { /* silent */ }

  return null; // No usable web data — AI will reason from training only
}

/**
 * Formats web search results into a structured prompt injection block.
 * Designed to be appended to branch analysis prompts.
 */
function formatWebContextForPrompt(webContext) {
  if (!webContext || !webContext.results || webContext.results.length === 0) return "";

  let block = "\n\n---\n";
  block += `🌐 LIVE WEB RESEARCH DATA (Source: ${webContext.service} | Query: "${webContext.query}")\n`;
  block += "Use the following real-world, up-to-date information to ground your analysis in current facts:\n\n";

  if (webContext.answer) {
    block += `📋 Web Summary: ${webContext.answer}\n\n`;
  }

  webContext.results.forEach((r, i) => {
    block += `[${i + 1}] ${r.title || "Result"}\n`;
    const snippet = (r.snippet || r.content || r.text || "").slice(0, 250);
    if (snippet) block += `    ${snippet}\n`;
    if (r.url) block += `    🔗 ${r.url}\n`;
    block += "\n";
  });

  block += "---\n";
  block += "IMPORTANT: Integrate the above web data naturally into your step-by-step reasoning. ";
  block += "Cite specific facts or findings where they strengthen the analysis. ";
  block += "If the web data conflicts with your training knowledge, note the discrepancy.\n";

  return block;
}

function generateUnicodeTree(plan) {
  let tree = `Research Map: "${plan.topic}"\n`;
  tree += `├── Query Topic\n`;
  plan.branches.forEach((b, i) => {
    const isLastBranch = i === plan.branches.length - 1;
    const branchPrefix = isLastBranch ? "└── " : "├── ";
    tree += `    ${branchPrefix}Branch: ${b.name}\n`;

    b.possibilities.forEach((p, j) => {
      const isLastPoss = j === b.possibilities.length - 1;
      const possPrefix = isLastPoss ? "└── " : "├── ";
      const linePrefix = isLastBranch ? "        " : "    │   ";
      tree += `${linePrefix}${possPrefix}${p}\n`;
    });
  });
  return tree;
}

async function generateResearchPlan(agent, query) {
  const systemPrompt = `Generate a comprehensive, multi-branch research plan for the query.
Output ONLY a valid JSON object with the following structure:
{
  "topic": "Brief topic name",
  "branches": [
    { "name": "Branch title", "possibilities": ["Possibility A", "Possibility B"] }
  ]
}
Ensure there are exactly 3 to 4 distinct branches, and each has 2 to 3 key possibilities. Return ONLY the raw JSON object. Do not include markdown code fences or any prose.`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Query: "${query}"` }
  ];

  const responseText = await callModelBackend(agent, messages);

  let cleaned = responseText.trim();
  cleaned = cleaned.replace(/```(?:json)?\n?/gi, "").replace(/```\n?/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) cleaned = match[0];

  const plan = JSON.parse(cleaned);
  if (!plan.topic || !Array.isArray(plan.branches)) {
    throw new Error("Invalid plan structure received from model.");
  }
  return plan;
}

function getFallbackPlan(query) {
  return {
    topic: query.slice(0, 40) + "...",
    branches: [
      { name: "Technical Feasibility & Architecture", possibilities: ["System requirements", "Integration complexity", "Performance overhead"] },
      { name: "Socio-Economic & Financial Impacts", possibilities: ["Adoption barriers", "Cost-benefit analysis", "Global market scale"] },
      { name: "Future Roadmap & Strategic Directives", possibilities: ["Short-term solutions", "Long-term scalability", "Key trade-offs"] }
    ]
  };
}

/**
 * Expands a single research branch using Chain-of-Thought reasoning.
 * Optionally injects live web data when available.
 *
 * @param {string}      agent      - resolved AI agent key
 * @param {string}      topic      - overall research topic
 * @param {object}      branch     - { name, possibilities[] }
 * @param {object|null} webContext - result from fetchWebContextForBranch, or null
 */
async function expandBranchWithCoT(agent, topic, branch, webContext = null) {
  const webSection = webContext ? formatWebContextForPrompt(webContext) : "";
  const webNote    = webContext
    ? ` Ground your analysis in the real-world web data provided above where relevant, citing specific facts.`
    : " Draw on your training knowledge to provide the most accurate analysis possible.";

  const prompt = `You are an expert researcher. Conduct a deep-dive analysis on the research branch "${branch.name}" for the main research topic "${topic}".
Focus specifically on these key possibilities: ${branch.possibilities.join(", ")}.
${webSection}
Apply step-by-step analytical reasoning. Analyze technical feasibility, global impacts, socio-economic challenges, and key trade-offs.${webNote}

Write out your step-by-step reasoning explicitly. Begin with a section titled "### Detailed Reasoning" where you walk through your logic step by step.
Follow this with a section titled "### Key Findings & Analytical Synthesis". IMPORTANT: You MUST structure the final discoveries in this section using clear bullet points or numbered lists, keeping paragraphs short and highly structured so that new users see an appealing, readable output. Do not output raw walls of text.`;

  const messages = [{ role: "user", content: prompt }];
  return await callModelBackend(agent, messages);
}

/**
 * Synthesizes all branch analyses into a cross-disciplinary overview.
 * Optionally enriched with a final high-level web context pass.
 */
async function synthesizeFindings(agent, topic, branchAnalyses, synthesisWebContext = null) {
  const branchText = Object.entries(branchAnalyses)
    .map(([branchName, analysis]) => `## Branch: ${branchName}\n\n${analysis}`)
    .join("\n\n");

  let webNote = "";
  if (synthesisWebContext) {
    webNote = formatWebContextForPrompt(synthesisWebContext);
  }

  const prompt = `You are an elite research synthesizer. Combine the following individual branch findings regarding the topic "${topic}" into a coherent, high-level strategic synthesis:

${branchText}
${webNote}
Identify key patterns, unexpected connections, global trade-offs, and construct a strategic future roadmap. Output a comprehensive, logical synthesis.
IMPORTANT: You MUST structure your strategic synthesis thoroughly using bullet points, structured sections, and clear lists for patterns, unexpected connections, trade-offs, and roadmap items, so that the report is visually appealing, readable, and easy for new users to scan. Avoid raw walls of text.`;

  const messages = [{ role: "user", content: prompt }];
  return await callModelBackend(agent, messages);
}

/**
 * Formats the final research report Markdown document.
 * Includes a Sources section when web search was used.
 */
function formatResearchDocument(plan, branchAnalyses, synthesis, branchWebContexts = {}) {
  let doc = `# 🔬 Research Report: ${plan.topic}\n\n`;
  doc += `## 📋 Table of Contents\n`;
  doc += `1. [Research Map Structure](#-research-map-structure)\n`;
  doc += `2. [Executive Summary](#-executive-summary)\n`;
  plan.branches.forEach((b, i) => {
    doc += `3.${i + 1} [Branch: ${b.name}](#branch-${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")})\n`;
  });
  doc += `3. [Cross-Branch Strategic Synthesis](#-cross-branch-strategic-synthesis)\n`;
  doc += `4. [Actionable Recommendations & Next Steps](#-actionable-recommendations--next-steps)\n`;

  // Add web sources section if any branches used web search
  const webBranches = Object.entries(branchWebContexts).filter(([, ctx]) => ctx !== null);
  if (webBranches.length > 0) {
    doc += `5. [Web Sources Used](#-web-sources-used)\n`;
  }
  doc += `\n`;

  doc += `## 🌲 Research Map Structure\n`;
  doc += `\`\`\`text\n${generateUnicodeTree(plan)}\`\`\`\n\n`;

  doc += `## 📋 Executive Summary\n`;
  const webGroundedNote = webBranches.length > 0
    ? ` This report is grounded in **${webBranches.length} live web search${webBranches.length > 1 ? "es" : ""}**, ensuring findings reflect current real-world data.`
    : "";
  doc += `This comprehensive research document explores **${plan.topic}** across multiple analytical dimensions. By mapping a structured research map, conducting parallel deep-dives using step-by-step analytical reasoning, and synthesizing cross-branch discoveries, this report offers key trade-offs and strategic guidance.${webGroundedNote}\n\n`;

  doc += `## 🔍 Detailed Branch Analyses\n\n`;
  plan.branches.forEach((b) => {
    const usedWeb = branchWebContexts[b.name];
    const webBadge = usedWeb ? ` 🌐 *(Web-grounded via ${usedWeb.service})*` : "";
    doc += `### Branch: ${b.name}${webBadge}\n`;
    doc += `**Explored Focus Areas:** ${b.possibilities.join(", ")}\n\n`;
    doc += `${branchAnalyses[b.name]}\n\n`;
  });

  doc += `## 🧠 Cross-Branch Strategic Synthesis\n`;
  doc += `${synthesis}\n\n`;

  doc += `## 🚀 Actionable Recommendations & Next Steps\n`;
  doc += `Based on the cross-disciplinary findings and technical analyses within this report, the following directives are recommended:\n`;
  doc += `1. **Phased Implementation**: Focus on short-term high-impact branches while planning resources for long-term scalability barriers.\n`;
  doc += `2. **Risk Mitigation**: Prioritize security and integration issues early in the developmental cycle.\n`;
  doc += `3. **Continuous Revision**: Re-evaluate the research map pathways as key technical metrics are achieved.\n`;

  // Web sources appendix
  if (webBranches.length > 0) {
    doc += `\n## 🌐 Web Sources Used\n`;
    doc += `The following live web searches were performed to ground this research in current data:\n\n`;
    webBranches.forEach(([branchName, ctx]) => {
      doc += `### ${branchName}\n`;
      doc += `- **Search Service:** ${ctx.service} ${ctx.icon}\n`;
      doc += `- **Query:** \`${ctx.query}\`\n`;
      if (ctx.answer) doc += `- **Summary:** ${ctx.answer}\n`;
      doc += `- **Sources:**\n`;
      ctx.results.forEach((r, i) => {
        const title = r.title || `Result ${i + 1}`;
        const url   = r.url || "";
        doc += url ? `  ${i + 1}. [${title}](${url})\n` : `  ${i + 1}. ${title}\n`;
      });
      doc += "\n";
    });
  }

  return doc;
}

app.post("/api/deep-research", async (req, res) => {
  const { prompt, agent } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "prompt required" });
  }

  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const activeInfo = getActiveAgent(agent);
    const resolvedAgent = activeInfo.agent;

    if (activeInfo.fallback) {
      sendEvent({
        type: "status",
        message: `⚠️ API key for "${getBackendAgentName(agent)}" missing. Auto-fallback to "${getBackendAgentName(resolvedAgent)}"...`
      });
    }

    sendEvent({ type: "status", message: "Structuring research plan..." });
    let plan;
    try {
      plan = await generateResearchPlan(resolvedAgent, prompt);
    } catch (err) {
      console.error("Plan generation failed, using fallback plan:", err);
      plan = getFallbackPlan(prompt);
    }

    sendEvent({ type: "plan", data: plan });

    // ── Decide which branches need web search before launching parallel work ──
    const branchSearchDecisions = {};
    plan.branches.forEach(branch => {
      const needsSearch = shouldUseWebSearch(plan.topic, branch);
      branchSearchDecisions[branch.name] = needsSearch;
    });

    const searchCount = Object.values(branchSearchDecisions).filter(Boolean).length;
    const searchNote  = searchCount > 0
      ? ` (🌐 web search enabled for ${searchCount} branch${searchCount > 1 ? "es" : ""})`
      : " (AI knowledge only — no live search needed for this topic)";

    sendEvent({
      type: "status",
      message: `Initiating concurrent branch analyses for ${plan.branches.length} pathways${searchNote}...`
    });

    const branchAnalyses    = {};
    const branchWebContexts = {}; // tracks which branches got web data

    const branchPromises = plan.branches.map(async (branch) => {
      sendEvent({ type: "branch_start", branch: branch.name });

      // ── Web search phase ──
      let webContext = null;
      const needsSearch = branchSearchDecisions[branch.name];

      if (needsSearch) {
        const searchQuery = buildBranchSearchQuery(plan.topic, branch);
        sendEvent({
          type: "web_search_start",
          branch: branch.name,
          query: searchQuery
        });

        try {
          webContext = await fetchWebContextForBranch(plan.topic, branch);
          sendEvent({
            type: "web_search_end",
            branch: branch.name,
            found: !!webContext,
            service: webContext ? webContext.service : null,
            icon: webContext ? webContext.icon : null,
            count: webContext ? webContext.results.length : 0,
            query: searchQuery
          });
        } catch (err) {
          console.error(`Web search failed for branch "${branch.name}":`, err.message);
          sendEvent({
            type: "web_search_end",
            branch: branch.name,
            found: false,
            service: null,
            icon: null,
            count: 0,
            query: searchQuery
          });
        }
      }

      branchWebContexts[branch.name] = webContext; // null if not searched or failed

      // ── Analysis phase ──
      try {
        const analysis = await expandBranchWithCoT(resolvedAgent, plan.topic, branch, webContext);
        branchAnalyses[branch.name] = analysis;
        sendEvent({
          type: "branch_end",
          branch: branch.name,
          analysis,
          webUsed: !!webContext,
          webService: webContext ? webContext.service : null
        });
      } catch (err) {
        console.error(`Branch ${branch.name} expansion failed:`, err);
        const failMsg = `### Branch Analysis Failed\nAn error occurred while expanding this branch: ${err.message}`;
        branchAnalyses[branch.name] = failMsg;
        sendEvent({
          type: "branch_end",
          branch: branch.name,
          analysis: failMsg,
          webUsed: false,
          webService: null
        });
      }
    });

    await Promise.all(branchPromises);

    // ── Synthesis phase — optionally add a topic-level search for broader context ──
    sendEvent({ type: "status", message: "Synthesizing branch findings..." });

    let synthesisWebContext = null;
    // Only do a synthesis-level search if the topic itself strongly signals recency
    const topicNeedsSearch = shouldUseWebSearch(plan.topic, { name: "synthesis overview", possibilities: ["key trends", "current state", "recent developments"] });
    if (topicNeedsSearch && (process.env.TAVILY_API_KEY || true)) {
      sendEvent({ type: "synthesis_search_start", query: plan.topic });
      try {
        synthesisWebContext = await fetchWebContextForBranch(
          plan.topic,
          { name: "synthesis overview", possibilities: ["key findings", "current state"] }
        );
        sendEvent({
          type: "synthesis_search_end",
          found: !!synthesisWebContext,
          service: synthesisWebContext ? synthesisWebContext.service : null
        });
      } catch (_) {
        sendEvent({ type: "synthesis_search_end", found: false, service: null });
      }
    }

    let synthesis;
    try {
      synthesis = await synthesizeFindings(resolvedAgent, plan.topic, branchAnalyses, synthesisWebContext);
    } catch (err) {
      console.error("Synthesis failed:", err);
      synthesis = "Cross-branch synthesis was limited due to an execution error during the synthesis phase. Detailed insights are available under each respective branch analysis above.";
    }

    sendEvent({ type: "status", message: "Assembling final research document..." });
    const finalReport = formatResearchDocument(plan, branchAnalyses, synthesis, branchWebContexts);

    sendEvent({ type: "completed", result: finalReport });
    res.end();
  } catch (err) {
    console.error("Deep Research failed:", err);
    sendEvent({ type: "error", message: err.message });
    res.end();
  }
});

// ══════════════════════════════════════════════════════════════
//  🌐 WEB SEARCH ENGINE — DuckDuckGo, Tavily AI, & SerpAPI
// ══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
//  Helper: DuckDuckGo Search (Organic Scraper - FREE)
// ─────────────────────────────────────────────────────────────
async function handleDuckDuckGoSearch(query) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const results = [];
    const resultBlocks = html.split('<div class="result results_links results_links_deep web-result');
    
    for (let i = 1; i < resultBlocks.length; i++) {
      const block = resultBlocks[i];
      const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      
      if (titleMatch) {
        let urlLink = titleMatch[1];
        if (urlLink.includes('uddg=')) {
          const parts = urlLink.split('uddg=');
          if (parts[1]) {
            urlLink = decodeURIComponent(parts[1].split('&')[0]);
          }
        }
        
        if (urlLink.startsWith('//')) {
          urlLink = 'https:' + urlLink;
        } else if (urlLink.startsWith('/')) {
          urlLink = 'https://duckduckgo.com' + urlLink;
        }
        
        const cleanTitle = titleMatch[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        const cleanSnippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
        
        results.push({
          title: cleanTitle,
          url: urlLink,
          snippet: cleanSnippet,
          source: "DuckDuckGo"
        });
      }
    }
    
    return results.slice(0, 8);
  } catch (err) {
    console.error("DuckDuckGo scraper error:", err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
//  Helper: Tavily AI Search (AI-Optimized with Answer)
// ─────────────────────────────────────────────────────────────
async function handleTavilySearch(query) {
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: query,
        topic: "general",
        max_results: 8,
        include_answer: true
      })
    });

    const data = await response.json();

    if (data.error) {
      console.error("Tavily error:", data.error);
      return null;
    }

    const results = (data.results || []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      score: r.score,
      source: "Tavily"
    }));

    return { results, answer: data.answer || null };
  } catch (err) {
    console.error("Tavily error:", err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  Helper: SerpAPI Search (Google Results)
// ─────────────────────────────────────────────────────────────
async function handleSerpAPISearch(query) {
  try {
    const params = new URLSearchParams({
      q: query,
      api_key: process.env.SERPAPI_KEY,
      engine: "google",
      num: 8
    });

    const response = await fetch(`https://serpapi.com/search?${params}`);
    const data = await response.json();

    if (data.error) {
      console.error("SerpAPI error:", data.error);
      return [];
    }

    return (data.organic_results || []).map(r => ({
      position: r.position,
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      source: "Google (SerpAPI)"
    }));
  } catch (err) {
    console.error("SerpAPI error:", err.message);
    return [];
  }
}

// ═════════════════════════════════════════════════════════════
//  ROUTE 1: Smart Web Search (Auto-selects best available)
// ═════════════════════════════════════════════════════════════
app.post("/api/search", async (req, res) => {
  const { query, service } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });

  console.log(`[SEARCH] Query: "${query}" | Service: ${service || "auto"}`);

  // Try Tavily first (AI-optimized with answer)
  if ((!service || service === "auto" || service === "tavily") && process.env.TAVILY_API_KEY) {
    const tavilyResult = await handleTavilySearch(query);
    if (tavilyResult) {
      return res.json({
        success: true,
        query,
        results: tavilyResult.results,
        answer: tavilyResult.answer,
        service: "tavily",
        count: tavilyResult.results.length
      });
    }
  }

  // Try SerpAPI as fallback
  if ((!service || service === "auto" || service === "serpapi") && process.env.SERPAPI_KEY) {
    const serpResults = await handleSerpAPISearch(query);
    if (serpResults.length > 0) {
      return res.json({
        success: true,
        query,
        results: serpResults,
        service: "serpapi",
        count: serpResults.length
      });
    }
  }

  // Fallback to DuckDuckGo (always works)
  const ddgResults = await handleDuckDuckGoSearch(query);
  res.json({
    success: true,
    query,
    results: ddgResults,
    service: "duckduckgo",
    count: ddgResults.length
  });
});

// ═════════════════════════════════════════════════════════════
//  ROUTE 2: DuckDuckGo Only (Free, No API Key)
// ═════════════════════════════════════════════════════════════
app.post("/api/search/duckduckgo", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });

  try {
    const results = await handleDuckDuckGoSearch(query);
    res.json({
      success: true,
      query,
      results,
      service: "duckduckgo",
      count: results.length
    });
  } catch (err) {
    res.status(500).json({ error: "Search failed: " + err.message });
  }
});

// ═════════════════════════════════════════════════════════════
//  ROUTE 3: Tavily AI Only (Best for AI Research)
// ═════════════════════════════════════════════════════════════
app.post("/api/search/tavily", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });

  if (!process.env.TAVILY_API_KEY) {
    return res.status(503).json({ error: "Tavily API key not configured on server" });
  }

  try {
    const result = await handleTavilySearch(query);
    if (!result) {
      return res.status(500).json({ error: "Tavily search failed" });
    }

    res.json({
      success: true,
      query,
      results: result.results,
      answer: result.answer,
      service: "tavily",
      count: result.results.length
    });
  } catch (err) {
    res.status(500).json({ error: "Tavily error: " + err.message });
  }
});

// ═════════════════════════════════════════════════════════════
//  ROUTE 4: SerpAPI Only (Google Search Results)
// ═════════════════════════════════════════════════════════════
app.post("/api/search/serpapi", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });

  if (!process.env.SERPAPI_KEY) {
    return res.status(503).json({ error: "SerpAPI key not configured on server" });
  }

  try {
    const results = await handleSerpAPISearch(query);
    res.json({
      success: true,
      query,
      results,
      service: "serpapi",
      count: results.length
    });
  } catch (err) {
    res.status(500).json({ error: "SerpAPI error: " + err.message });
  }
});

// ══════════════════════════════════════════════════════════════
//  🎙️ ROUTE: TTS Script Generator — rewrites AI response for speech
// ══════════════════════════════════════════════════════════════
app.post("/api/tts-script", async (req, res) => {
  const { text, context } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

const REWRITER_SYSTEM = `You are a professional voice-over script writer.
Your job: take an AI assistant's text response and rewrite it as a natural spoken-word script.

VOICE TARGET:
- Aim for a warm, bright, natural assistant voice: clear, conversational, lightly expressive, and emotionally present.
- Keep the delivery close and friendly, with subtle confidence instead of announcer drama.
- Use short, human pauses and gentle emphasis. Avoid sing-song, exaggerated excitement, or excessive social sounds.

OUTPUT FORMAT RULES — these are strict:
- Split the script into small spoken chunks separated by the pipe character: |
- Each chunk = roughly one breath (8–15 words max)
- Standalone emotional sounds are their own chunk: | [laugh] | or | [hmm] |
- Start every chunk that needs a delivery style with the tag: [excited] Great news! |
- Use ONLY these tags: [pause] [pause:short] [pause:long] [pause:breath] [excited] [calm] [whisper] [serious] [warm] [laugh] [chuckle] [sigh] [hmm] [list-item] [list-final] [heading] [emphasis] [question] [end-of-thought] [reset]
- Never use tags outside brackets
- Never invent new tags
- The output is ONLY the pipe-delimited script — no explanations, no preamble

DELIVERY RULES:
- Match the emotional tone of the original text
- Add [hmm] or [pause:long] where a human would naturally think or hesitate
- Add [laugh] or [chuckle] only if the content is genuinely humorous or self-aware
- For lists: mark each item [list-item] and the last one [list-final]
- For headings or section transitions: use [heading] then [pause]
- For important warnings or serious points: use [serious]
- For warm/encouraging closings: use [warm]
- For rhetorical questions: use [question] on that chunk
- Add [pause:breath] between long idea clusters even mid-paragraph
- Sentences that end a major thought get [end-of-thought]
- Use [laugh] or [chuckle] SPARINGLY — only when the content itself is genuinely funny or playful.
- Maximum one social sound per 200 words of input. Never add humor that wasn't in the original.`;

  const messages = [
    { role: "system", content: REWRITER_SYSTEM },
    { role: "user", content: `Rewrite this for natural spoken delivery:\n\n${text.slice(0, 3000)}` }
  ];

  if (process.env.GROQ_API_KEY) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages,
          max_tokens: 1200,
          temperature: 0.5
        })
      });
      const data = await response.json();
      const script = data.choices?.[0]?.message?.content?.trim();
      if (script) return res.json({ script });
    } catch (_) { /* fall through to NVIDIA fallback */ }
  }

  if (process.env.NVIDIA_KEY_GPTOSS) {
    try {
      const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.NVIDIA_KEY_GPTOSS}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-20b",
          messages,
          max_tokens: 1200,
          temperature: 0.4,
          stream: false
        })
      });
      const data = await response.json();
      const script = data.choices?.[0]?.message?.content?.trim();
      if (script) return res.json({ script });
    } catch (_) { /* fall through to plain-text fallback */ }
  }

  // Fallback: return plain text as single chunk (graceful degradation)
  res.json({ script: text });
});

// ── Start server ──
// ---------------------------------------------------------------------------
// ROUTE: Murf AI Text-to-Speech
// POST /api/tts
// Body: { text: string, voiceId?: string }
// Returns: audio/mpeg, proxied from Murf's CDN URL
// ---------------------------------------------------------------------------
app.post("/api/tts", async (req, res) => {
  const { text, voiceId } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  if (!process.env.MURF_API_KEY || process.env.MURF_API_KEY === "your_murf_api_key_here") {
    return res.status(503).json({ error: "Murf API key not configured on server." });
  }

  const safeText = text.trim().slice(0, 3000);
  const resolvedVoice = voiceId || process.env.MURF_VOICE_ID || "en-US-natalie";

  try {
    const generateRes = await fetch("https://api.murf.ai/v1/speech/generate", {
      method: "POST",
      headers: {
        "api-key": process.env.MURF_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        text: safeText,
        voiceId: resolvedVoice,
        format: "MP3",
        modelVersion: "GEN2",
        channelType: "MONO",
      }),
    });

    if (!generateRes.ok) {
      const errBody = await generateRes.json().catch(() => ({}));
      const message = errBody.message || errBody.error || `HTTP ${generateRes.status}`;
      return res.status(generateRes.status).json({
        error: `Murf generate failed (${generateRes.status}): ${message}`,
      });
    }

    const data = await generateRes.json();

    if (!data.audioFile) {
      return res.status(500).json({ error: "Murf returned no audioFile URL." });
    }

    const audioRes = await fetch(data.audioFile);

    if (!audioRes.ok) {
      return res.status(500).json({
        error: `Failed to fetch Murf audio file: HTTP ${audioRes.status}`,
      });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    if (audioRes.body) {
      return Readable.fromWeb(audioRes.body).pipe(res);
    }

    return res.end(Buffer.from(await audioRes.arrayBuffer()));
  } catch (err) {
    console.error("Murf TTS error:", err.message);
    res.status(500).json({ error: "Murf TTS failed: " + err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 NEXUS AI Backend running on port ${PORT}`);
  console.log(`   Keys loaded: ${[
    process.env.NVIDIA_KEY_GPTOSS  ? "✅ GPT-OSS-120B" : "❌ GPT-OSS-120B",
    process.env.NVIDIA_KEY_LLAMA   ? "✅ LLaMA 3.3"   : "❌ LLaMA 3.3",
    process.env.GEMINI_API_KEY     ? "✅ Gemini"       : "❌ Gemini",
    process.env.MISTRAL_API_KEY    ? "✅ Mistral"      : "❌ Mistral",
    process.env.GROQ_API_KEY       ? "✅ Groq + 🧠 Memory" : "❌ Groq / Memory",
    process.env.COHERE_API_KEY     ? "✅ Cohere"       : "❌ Cohere",
    process.env.TAVILY_API_KEY     ? "✅ Tavily Search" : "⚠️  Tavily (DDG fallback active)",
  ].join(" | ")}`);
});
