// ╔══════════════════════════════════════════════════════════╗
// ║         ORBLEN AI — Secure Backend Server                 ║
// ║   All API keys live HERE — never in the frontend         ║
// ╚══════════════════════════════════════════════════════════╝

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const crypto = require("crypto");
const { Readable } = require("stream");
const { initializeApp: initFirebase, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");

// ── Firebase Admin (for per-user token storage & ID token verification) ──
let firebaseReady = false;
const fbRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (fbRaw) {
  try {
    const sa = JSON.parse(fbRaw);
    initFirebase({ credential: cert(sa), databaseURL: "https://storage-53912-default-rtdb.firebaseio.com" });
    firebaseReady = true;
  } catch (e) { console.error("Firebase Admin init failed:", e.message); }
}

const app = express();

// ── CORS: Only allow your Netlify frontend ──
const DEFAULT_ALLOWED_ORIGINS = [
  "https://orblen.pages.dev"
];

const configuredOrigins = String(process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;

  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "https:" && (
      hostname === "orblen.pages.dev" ||
      hostname.endsWith("--orblen.pages.dev")
    );
  } catch {
    return false;
  }
}

const corsOptions = {
  origin(origin, callback) {
    callback(null, isAllowedOrigin(origin));
  },
  methods: ["GET", "HEAD", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
  maxAge: 86400
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use((req, res, next) => {
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
});

app.use(express.json({ limit: '15mb' }));



app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});

app.get("/api/firebase-config", (_req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID,
  });
});

// Skill repository: curated coding capabilities the frontend can browse and
// the chat flow can inject into model prompts on demand.
app.get("/", (req, res) => {
  res.json({ status: "✅ ORBLEN AI Backend is live", version: "1.0.0" });
});

// ══════════════════════════════════════════════════════════════
//  🤖 ROUTE 1: Chat Endpoints (Gemini, Mistral, Codestral, Groq)
// ══════════════════════════════════════════════════════════════
function apiChatRoute(agentName, isGeminiPrompt = false) {
  return async (req, res) => {
    if (req.body.stream) {
      return handleAgenticChatRouteStream(req, res, agentName, isGeminiPrompt);
    }
    return handleAgenticChatRoute(req, res, agentName, isGeminiPrompt);
  };
}
app.post("/api/gemini", apiChatRoute("gemini", true));
app.post("/api/mistral", apiChatRoute("mistral"));
app.post("/api/codestral", apiChatRoute("codestral"));
app.post("/api/groq", apiChatRoute("groq"));
app.post("/api/groq-llama-8b", apiChatRoute("groq-llama-8b"));

app.post("/api/groq-gpt-120b", apiChatRoute("groq-gpt-120b"));
app.post("/api/groq-gpt-20b", apiChatRoute("groq-gpt-20b"));

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
- Use proper punctuation throughout (periods, commas, question marks, etc.)
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
  gemini: "Gemini Flash",
  mistral: "Mistral Large",
  codestral: "Codestral",
  groq: "LLaMA 3.3 70B",
  "groq-llama-8b": "LLaMA 3.1 8B",

  "groq-gpt-120b": "GPT-OSS 120B",
  "groq-gpt-20b": "GPT-OSS 20B"
};

// Model IDs for all Groq-hosted agents
const GROQ_MODEL_MAP = {
  groq: "llama-3.3-70b-versatile",
  "groq-llama-8b": "llama-3.1-8b-instant",

  "groq-gpt-120b": "openai/gpt-oss-120b",
  "groq-gpt-20b": "openai/gpt-oss-20b"
};

function isGroqAgent(agent) {
  return Object.prototype.hasOwnProperty.call(GROQ_MODEL_MAP, agent);
}

function getGroqMaxTokens(agent) {
  if (agent === "groq-gpt-20b" || agent === "groq-llama-8b") {
    return 1024;
  }
  if (agent === "groq") {
    return 8192;
  }
  return 2048;
}

function getBackendAgentName(a) {
  return BACKEND_AGENT_NAMES[a] || "AI Agent";
}

const RESPONSE_STYLE_INSTRUCTION = "Default to short, concise, direct answers. Expand only when complexity or detail is required. Avoid filler and repetition.";

function hasResponseStyleInstruction(messages) {
  return messages.some(m => typeof m.content === "string" && m.content.includes("Default to short, concise, direct answers"));
}

function addResponseStyleInstructionToMessages(messages) {
  if (!Array.isArray(messages) || hasResponseStyleInstruction(messages)) return messages;

  if (messages[0]?.role === "system") {
    return [
      { ...messages[0], content: `${messages[0].content}\n\n${RESPONSE_STYLE_INSTRUCTION}` },
      ...messages.slice(1)
    ];
  }

  return [{ role: "system", content: RESPONSE_STYLE_INSTRUCTION }, ...messages];
}

function addResponseStyleInstructionToPrompt(prompt) {
  if (typeof prompt !== "string" || prompt.includes("Default to short, concise, direct answers")) return prompt;
  return `[Response Style Instruction: ${RESPONSE_STYLE_INSTRUCTION}]\n\n${prompt}`;
}

function getActiveAgent(requestedAgent) {
  // All groq-* agents share the GROQ_API_KEY
  const groqKey = process.env.GROQ_API_KEY;
  if (isGroqAgent(requestedAgent)) {
    if (groqKey) return { agent: requestedAgent, fallback: false };
    // Fallback from groq model to other providers
  }

  const keys = {
    gemini: process.env.GEMINI_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
    codestral: process.env.CODESTRAL_API_KEY,
    groq: groqKey
  };

  if (keys[requestedAgent]) {
    return { agent: requestedAgent, fallback: false };
  }

  const fallbackOrder = ["gemini", "groq", "mistral", "codestral"];
  for (const agent of fallbackOrder) {
    if (keys[agent]) {
      return { agent, fallback: true, original: requestedAgent };
    }
  }

  return { agent: requestedAgent, fallback: false };
}

async function streamOpenAICompatibleTokens(res, url, headers, body, sendEvent) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, stream: true })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error (${response.status}): ${text.slice(0, 200)}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
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
      if (data === "[DONE]") return fullText;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content || "";
        if (content) {
          fullText += content;
          sendEvent({ type: "token", text: content });
        }
      } catch (e) { /* skip malformed chunks */ }
    }
  }
  return fullText;
}

async function callModelBackend(agent, messages) {
  if (agent === "gemini") {
    if (!process.env.GEMINI_API_KEY) throw new Error("Gemini key not configured.");
    const prompt = messages[messages.length - 1].content;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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

  if (isGroqAgent(agent)) {
    if (!process.env.GROQ_API_KEY) throw new Error("Groq key not configured.");
    const groqModel = GROQ_MODEL_MAP[agent];
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: groqModel,
        messages,
        max_tokens: getGroqMaxTokens(agent)
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
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
        max_tokens: 16384
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  }

  if (agent === "codestral") {
    if (!process.env.CODESTRAL_API_KEY) throw new Error("Codestral key not configured.");
    const response = await fetch("https://codestral.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CODESTRAL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "codestral-latest",
        messages,
        max_tokens: 16384
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  }

  throw new Error("Invalid agent selected.");
}

// ─────────────────────────────────────────────────────────────
//  In deep research mode every branch always attempts web
//  search; fetchWebContextForBranch() handles failures gracefully
//  by returning null when no data is available.
// ─────────────────────────────────────────────────────────────

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

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  let block = "\n\n---\n";
  block += `🌐 LIVE WEB SEARCH RESULTS\n`;
  block += `Query: "${webContext.query}"\n`;
  block += `Retrieved: ${today} | Source: ${webContext.service}\n`;

  if (webContext.answer) {
    block += `\n📋 AI Summary: ${webContext.answer}\n`;
  }

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

// ══════════════════════════════════════════════════════════════
//  🌟 AGENTIC ENGINE CORE HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════

async function executeAgenticSearch(agent, query, sendEvent = null) {
  if (sendEvent) sendEvent({ type: "status", message: `🔍 Initiating search for: "${query.slice(0,40)}..."` });
  
  let webContext = null;
  const fakeBranch = { name: query, possibilities: [] };
  webContext = await fetchWebContextForBranch(query, fakeBranch);
  
  if (!webContext) return null;
  
  const evalPrompt = `You are a research evaluator. 
I have performed a web search for the query: "${query}".
Here are the results:
${formatWebContextForPrompt(webContext)}

Does this provide sufficient and accurate information to provide a deep, well-rounded response? 
If YES, output exactly the word "SUFFICIENT" and nothing else.
If NO, output EXACTLY ONE new, improved search query to find the missing information (just the query string, no quotes).`;

  if (sendEvent) sendEvent({ type: "status", message: "🤔 Evaluating search sufficiency..." });
  
  try {
    const evalResponse = await callModelBackend(agent, [{ role: "user", content: evalPrompt }]);
    const evalText = evalResponse.trim();
    
    if (evalText !== "SUFFICIENT") {
      if (sendEvent) sendEvent({ type: "status", message: `🔄 Refining search: "${evalText.slice(0, 40)}..."` });
      const secondaryBranch = { name: evalText, possibilities: [] };
      const secondaryContext = await fetchWebContextForBranch(evalText, secondaryBranch);
      
      if (secondaryContext && secondaryContext.results) {
        webContext.results = [...webContext.results, ...secondaryContext.results].slice(0, 10);
        webContext.query += " | " + secondaryContext.query;
      }
    }
  } catch (err) {
    console.error("Agentic search evaluation failed:", err.message);
  }
  
  return webContext;
}

// ══════════════════════════════════════════════════════════════
//  🏭 Backend Marker Processor — executes all 27 marker types
//  Called after LLM streaming completes, and by the task scheduler
// ══════════════════════════════════════════════════════════════
const MARKER_RE = {
  SAVE_MEMORY:     /\[SAVE_MEMORY\]([\s\S]*?)\[\/SAVE_MEMORY\]/g,
};

async function processMarkers(text, uid) {
  if (!text || !uid) return { cleanText: text || '' };
  let cleanText = text;

  // ── SAVE_MEMORY ──
  {
    const matches = [...text.matchAll(MARKER_RE.SAVE_MEMORY)];
    for (const m of matches) {
      const raw = m[0];
      let p;
      try { 
        let jsonStr = m[1].trim();
        const firstBrace = jsonStr.search(/[\{\[]/);
        const lastBrace = jsonStr.search(/[\}\]][^\}\]]*$/);
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
          jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
        }
        p = JSON.parse(jsonStr); 
      } catch (e) { console.error('JSON parse error in processMarkers:', e.message, 'Raw JSON:', m[1]); }
      if (p && typeof p === 'object') {
        try {
          const memRef = getDatabase().ref(`memories/${uid}`);
          const snap = await memRef.once('value');
          const existing = snap.val() || {};

          function formatMemoryValue(v, indent = 0) {
            const pad = '  '.repeat(indent);
            if (v === null || v === undefined) return '';
            if (typeof v === 'string') return v;
            if (typeof v === 'number' || typeof v === 'boolean') return String(v);
            if (Array.isArray(v)) return v.map(item => `\n${pad}- ${formatMemoryValue(item, indent + 1)}`).join('');
            if (typeof v === 'object') {
              const keys = Object.keys(v);
              if (keys.length === 0) return '';
              return keys.map(k => `\n${pad}${k}: ${formatMemoryValue(v[k], indent + 1)}`).join('');
            }
            return String(v);
          }

          function replaceOrCreate(category, content) {
            const trimmedContent = content.trim();
            // Check if there is an exact or near-identical duplicate to prevent duplicate double-saving
            const isDuplicate = Object.values(existing).some(
              mem => mem.category === category && mem.content.toLowerCase().trim() === trimmedContent.toLowerCase()
            );
            if (isDuplicate) return;

            // If the content is updating a key term like email or phone, we can replace that specific one
            let replaced = false;
            const terms = ["email", "phone", "mobile", "number", "name", "location", "city"];
            const matchedTerm = terms.find(t => trimmedContent.toLowerCase().includes(t));
            if (matchedTerm) {
              const matchingOldId = Object.entries(existing)
                .find(([, mem]) => mem.category === category && mem.content.toLowerCase().includes(matchedTerm))?.[0];
              if (matchingOldId) {
                memRef.child(matchingOldId).set({ id: matchingOldId, content: trimmedContent, category, emoji: '💡', createdAt: Date.now() });
                replaced = true;
              }
            }

            if (!replaced) {
              const memId = `mem_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
              memRef.child(memId).set({ id: memId, content: trimmedContent, category, emoji: '💡', createdAt: Date.now() });
            }
          }

          if (Array.isArray(p)) {
            let count = 0;
            for (const item of p) {
              if (item.content) {
                replaceOrCreate(item.category || 'others', item.content.trim());
                count++;
              }
            }
            cleanText = cleanText.replace(raw, `🧠 Memory saved (${count} facts)`);
          } else if (p.content) {
            replaceOrCreate(p.category || 'others', p.content.trim());
            cleanText = cleanText.replace(raw, `🧠 Memory saved`);
          } else {
            let count = 0;
            for (const [cat, data] of Object.entries(p)) {
              if (!data) continue;
              replaceOrCreate(cat, cat + ':' + formatMemoryValue(data));
              count++;
            }
            cleanText = cleanText.replace(raw, `🧠 Memory saved (${count} ${count === 1 ? 'section' : 'sections'})`);
          }
        } catch (e) { cleanText = cleanText.replace(raw, `⚠ Memory save error: ${e.message}`); }
      }
    }
  }

  return { cleanText };
}

async function handleAgenticChatRoute(req, res, agentName, isGeminiPrompt = false) {
  let messages = req.body.messages;
  let prompt = req.body.prompt;
  const lowLatency = false;
  
  if (isGeminiPrompt) {
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    messages = [{ role: "user", content: addResponseStyleInstructionToPrompt(prompt) }];
  } else {
    if (!messages) return res.status(400).json({ error: "messages required" });
    messages = addResponseStyleInstructionToMessages(messages);
  }

  try {
    let chatMessages = messages;
    if (!lowLatency) {
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || "";
      const webContext = await executeAgenticSearch(agentName, lastUserMsg);
      chatMessages = [...messages];
      if (webContext) {
        chatMessages[chatMessages.length - 1].content += "\n\n" + formatWebContextForPrompt(webContext);
      }
    }

    const response = await callModelBackend(agentName, chatMessages);
    res.json({ result: response });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}

async function handleAgenticChatRouteStream(req, res, agentName, isGeminiPrompt = false) {
  
  let messages = req.body.messages;
  let prompt = req.body.prompt;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  if (isGeminiPrompt) {
    if (!prompt) { sendEvent({ type: "error", message: "prompt required" }); return res.end(); }
    messages = [{ role: "user", content: addResponseStyleInstructionToPrompt(prompt) }];
  } else {
    if (!messages) { sendEvent({ type: "error", message: "messages required" }); return res.end(); }
    messages = addResponseStyleInstructionToMessages(messages);
  }

  try {
    let chatMessages;
    sendEvent({ type: "status", message: "🔍 Searching the web…" });
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || "";
    const webContext = await executeAgenticSearch(agentName, lastUserMsg, sendEvent);
    chatMessages = [...messages];
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
        headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: groqModel, messages: chatMessages, max_tokens: getGroqMaxTokens(agentName), temperature: 0.7, stream: true }),
        signal: AbortSignal.timeout(30000)
      });
      if (!groqRes.ok) {
        const errText = await groqRes.text();
        throw new Error(`Groq API error (${groqRes.status}): ${errText.slice(0, 200)}`);
      }
      fullResponse = "";
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
            if (content) {
              fullResponse += content;
              sendEvent({ type: "token", text: content });
            }
          } catch (_) {}
        }
      }
    } else if (agentName === "mistral") {
      if (!process.env.MISTRAL_API_KEY) throw new Error("Mistral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://api.mistral.ai/v1/chat/completions",
        { "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "mistral-large-latest", messages: chatMessages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agentName === "codestral") {
      if (!process.env.CODESTRAL_API_KEY) throw new Error("Codestral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://codestral.mistral.ai/v1/chat/completions",
        { "Authorization": `Bearer ${process.env.CODESTRAL_API_KEY}`, "Content-Type": "application/json" },
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
          body: JSON.stringify({ contents: [{ parts: [{ text: geminiPrompt }] }] })
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
            if (text) {
              fullResponse += text;
              sendEvent({ type: "token", text });
            }
          } catch (e) { /* skip malformed */ }
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
  const systemPrompt = `Generate a comprehensive, decision-tree style research plan for the query. 
The plan MUST explore diverging paths, scenarios, or outcomes arising from the topic (for example, if the query is an exam like "NEET", Branch 1 could be "Successfully Cracking NEET" and Branch 2 could be "Failing to Crack NEET").
Output ONLY a valid JSON object with the following structure:
{
  "topic": "Brief topic name",
  "branches": [
    { "name": "Branch title (e.g., Scenario A / Path 1)", "possibilities": ["Sub-path 1", "Sub-path 2", "Sub-path 3", "Sub-path 4", "Sub-path 5"] }
  ]
}
Ensure there are 2 to 4 distinct main branches that represent fundamentally different paths or scenarios. 
CRITICAL: Each main branch MUST have a minimum of 5 sub-branches (possibilities) that explore detailed pathways within that branch (e.g., different career paths, alternative steps). Return ONLY the raw JSON object. Do not include markdown code fences or any prose.`;

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
      { name: "Scenario A: Direct Implementation & Success", possibilities: ["Ideal architecture setup", "Market dominance", "Scalability solutions", "Financial returns", "Ecosystem integration"] },
      { name: "Scenario B: Alternative Pathways & Mitigation", possibilities: ["Pivot to new technologies", "Addressing adoption barriers", "Cost-saving architectures", "Niche market focus", "Gradual rollout strategies"] }
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
Apply step-by-step analytical reasoning. Analyze past and current trends, predict future trends and situations based on this data. Evaluate technical feasibility, global impacts, socio-economic challenges, and key trade-offs.${webNote}

Write out your step-by-step reasoning explicitly. Begin with a section titled "### Detailed Reasoning" where you walk through your logic step by step, considering both historical context and future predictions.
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
Analyze the past and current trends from the findings to predict future trends and situations. Based on these predictions, identify key patterns, unexpected connections, global trade-offs, and construct a detailed, step-by-step strategic future roadmap for the user. Output a comprehensive, logical synthesis.
IMPORTANT: You MUST structure your strategic synthesis thoroughly using bullet points, structured sections, and clear lists for patterns, unexpected connections, trade-offs, predictive analysis, and roadmap items, so that the report is visually appealing, readable, and easy for new users to scan. Avoid raw walls of text.`;

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
  doc += `3. [Cross-Branch Predictive Analysis & Strategic Synthesis](#-cross-branch-predictive-analysis--strategic-synthesis)\n`;
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
  doc += `This comprehensive research document explores **${plan.topic}** across multiple analytical dimensions. By mapping a structured research map, conducting parallel deep-dives using step-by-step analytical reasoning, and synthesizing cross-branch discoveries, this report analyzes past and current trends to predict future situations and offers key trade-offs and strategic guidance.${webGroundedNote}\n\n`;

  doc += `## 🔍 Detailed Branch Analyses\n\n`;
  plan.branches.forEach((b) => {
    const usedWeb = branchWebContexts[b.name];
    const webBadge = usedWeb ? ` 🌐 *(Web-grounded via ${usedWeb.service})*` : "";
    doc += `### Branch: ${b.name}${webBadge}\n`;
    doc += `**Explored Focus Areas:** ${b.possibilities.join(", ")}\n\n`;
    doc += `${branchAnalyses[b.name]}\n\n`;
  });

  doc += `## 🧠 Cross-Branch Predictive Analysis & Strategic Synthesis\n`;
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
  const { prompt, agent, lowLatency: requestedLowLatency = false } = req.body;
  const lowLatency = requestedLowLatency === true;
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
      branchSearchDecisions[branch.name] = true;
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
          webContext = await executeAgenticSearch(resolvedAgent, searchQuery, sendEvent);
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
    if (true) {
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
//  🗣️ DEBATE MODE ENGINE — Multi-agent structured debate
// ══════════════════════════════════════════════════════════════

const DEBATE_PERSONAS = [
  { role: "The Advocate", description: "argues in favor of the topic, highlighting benefits, opportunities, and supporting evidence" },
  { role: "The Critic", description: "challenges the topic, pointing out risks, limitations, counterarguments, and potential downsides" },
  { role: "The Analyst", description: "provides objective, data-driven analysis without taking a side, evaluating evidence from all perspectives" },
  { role: "The Synthesizer", description: "seeks common ground, identifies areas of agreement, and bridges opposing viewpoints" },
  { role: "The Pragmatist", description: "focuses on practical implementation, feasibility, real-world constraints, and actionable outcomes" }
];

app.post("/api/debate", async (req, res) => {
  const { topic, agents, rounds, webContext, lowLatency: requestedLowLatency = false } = req.body;
  const lowLatency = requestedLowLatency === true;
  if (!topic) return res.status(400).json({ error: "topic required" });
  if (!agents || !Array.isArray(agents) || agents.length < 2) return res.status(400).json({ error: "At least 2 agents required" });

  const maxRounds = Math.min(Math.max(parseInt(rounds) || 2, 1), 4);
  const selectedAgents = agents.slice(0, 5);
  const webSection = webContext ? formatWebContextForPrompt(webContext) : "";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let transcript = [];

    const participants = selectedAgents.map((agent, i) => {
      const info = getActiveAgent(agent);
      return {
        agent: info.agent,
        name: getBackendAgentName(info.agent),
        persona: DEBATE_PERSONAS[i % DEBATE_PERSONAS.length],
        fallback: info.fallback,
        originalAgent: info.fallback ? agent : null
      };
    });

    // Check if any agents resolved to the same model (deduplicate)
    const seen = new Set();
    const uniqueParticipants = [];
    for (const p of participants) {
      const key = p.agent;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueParticipants.push(p);
      }
    }

    if (uniqueParticipants.length < 2) {
      sendEvent({ type: "error", message: "At least 2 unique agents with valid API keys are required for a debate." });
      res.end();
      return;
    }

    sendEvent({
      type: "start",
      participants: uniqueParticipants.map(p => ({
        agent: p.agent,
        name: p.name,
        persona: p.persona,
        fallback: p.fallback,
        originalAgent: p.originalAgent
      })),
      topic
    });

    sendEvent({
      type: "status",
      message: `🗣️ Debate starting with ${uniqueParticipants.length} participants, ${maxRounds} round${maxRounds > 1 ? "s" : ""}`
    });

    const colorPalette = ["#00f5ff", "#ff2d78", "#ffbe00", "#7c3aed", "#00ff9d"];

    for (let round = 1; round <= maxRounds; round++) {
      for (let pIdx = 0; pIdx < uniqueParticipants.length; pIdx++) {
        const p = uniqueParticipants[pIdx];

        sendEvent({
          type: "speaker_start",
          round,
          agent: p.agent,
          name: p.name,
          persona: p.persona,
          color: colorPalette[pIdx % colorPalette.length]
        });

        const fallbackNote = p.fallback
          ? `\n\nNOTE: API key for "${getBackendAgentName(p.originalAgent)}" was unavailable. You are responding in their place as the ${p.persona.role}.`
          : "";

        const transcriptText = transcript.length > 0
          ? transcript.map(t => `${t.name} (${t.persona.role}):\n${t.content}`).join("\n\n---\n\n")
          : "";

        let speakerWebSection = webSection
          ? `\nUse the following current web data to support your arguments where applicable:\n${webSection}`
          : "";
          
        if (!webSection) {
          const searchContext = await executeAgenticSearch(p.agent, `Debate topic: ${topic} - arguments for ${p.persona.role}`, sendEvent);
          if (searchContext) {
              speakerWebSection = `\nUse the following current web data to support your arguments where applicable:\n${formatWebContextForPrompt(searchContext)}`;
          }
        }

        let debatePrompt;
        if (round === 1 && pIdx === 0) {
          debatePrompt = `You are participating in a structured multi-AI debate.

DEBATE TOPIC: "${topic}"

YOUR ROLE: ${p.persona.role}
YOUR INSTRUCTION: ${p.persona.description}

This is the opening statement of the debate. Present your initial position on this topic clearly and persuasively. Structure your response with:
• Your main thesis/position on the topic
• Key supporting arguments and reasoning
• Evidence or examples where relevant
${speakerWebSection}
Keep your response focused and concise (2-4 paragraphs). Use proper punctuation throughout.${fallbackNote}`;
        } else {
          debatePrompt = `You are participating in a structured multi-AI debate.

DEBATE TOPIC: "${topic}"

YOUR ROLE: ${p.persona.role}
YOUR INSTRUCTION: ${p.persona.description}

Here is the debate transcript so far (Round ${round}):

${transcriptText}

Now it's your turn. Respond to the previous speakers. You should:
• Directly engage with points made by other participants — address them by name
• If you agree with something, acknowledge it and build on it
• If you disagree, explain why with clear reasoning
• Advance your own unique perspective based on your assigned role
• Ask thoughtful questions to probe weaknesses in opposing arguments
• Counter any arguments made against your position
${speakerWebSection}
Keep your response focused and concise (2-4 paragraphs). Use proper punctuation throughout.${fallbackNote}`;
        }

        const messages = [{ role: "user", content: debatePrompt }];

        try {
          const response = await callModelBackend(p.agent, messages);
          transcript.push({
            agent: p.agent,
            name: p.name,
            persona: p.persona,
            content: response,
            round
          });
          sendEvent({
            type: "speaker_end",
            agent: p.agent,
            name: p.name,
            persona: p.persona,
            content: response,
            color: colorPalette[pIdx % colorPalette.length],
            round
          });
        } catch (err) {
          const errorMsg = `[${p.name} is unavailable for this round: ${err.message}]`;
          transcript.push({
            agent: p.agent,
            name: p.name,
            persona: p.persona,
            content: errorMsg,
            round
          });
          sendEvent({
            type: "speaker_end",
            agent: p.agent,
            name: p.name,
            persona: p.persona,
            content: errorMsg,
            color: colorPalette[pIdx % colorPalette.length],
            round,
            error: true
          });
        }
      }
    }

    // ── Synthesis Phase ──
    sendEvent({ type: "status", message: "🧠 Synthesizing debate into a final consensus..." });

    const fullTranscript = transcript.map(t =>
      `--- ${t.name} (${t.persona.role}) - Round ${t.round} ---\n${t.content}`
    ).join("\n\n");

    const webSynthesisSection = webSection
      ? `\nThe following current web data was available to participants during the debate and should inform your synthesis:\n${webSection}`
      : "";

    const synthesisPrompt = `You are a neutral debate moderator and expert synthesis analyst.

DEBATE TOPIC: "${topic}"

Below is the full transcript of a structured multi-AI debate between participants with different assigned perspectives:

${fullTranscript}
${webSynthesisSection}
Your task: synthesize this debate into a clear, balanced, and actionable final document. Structure your response with these sections:

## 📋 Executive Summary
A brief 2-3 sentence overview of the debate's outcome and key takeaways.

## 🔑 Areas of Agreement
List the main points where participants reached consensus or found common ground.

## ⚡ Areas of Disagreement
Summarize the key disagreements and the reasoning behind each side's position.

## 🏁 Final Consensus
A comprehensive, balanced conclusion that incorporates the strongest arguments from all sides. This should be a well-reasoned answer that a neutral observer would find fair and complete.

Keep your synthesis thorough but readable. Use proper punctuation throughout.`;

    const synthesisMessages = [{ role: "user", content: synthesisPrompt }];
    const moderatorAgent = uniqueParticipants[0].agent;

    try {
      const consensus = await callModelBackend(moderatorAgent, synthesisMessages);
      sendEvent({ type: "completed", result: consensus, transcript });
    } catch (err) {
      sendEvent({ type: "error", message: `Consensus synthesis failed: ${err.message}` });
    }

    res.end();
  } catch (err) {
    console.error("Debate error:", err);
    sendEvent({ type: "error", message: err.message });
    res.end();
  }
});

// ══════════════════════════════════════════════════════════════
//  🌐 WEB SEARCH ENGINE — DuckDuckGo, Tavily AI, & SerpAPI
// ══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
//  Helper: fetch with timeout
// ─────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────────────────────────────────────────────
//  Helper: Clean search query for better results
// ─────────────────────────────────────────────────────────────
function cleanSearchQuery(query) {
  return query
    .replace(/\b(hey|hello|hi|tell me about|can you|would you|could you|please|thanks|thank you)\b/gi, '')
    .replace(/[?¿!¡]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// ─────────────────────────────────────────────────────────────
//  Helper: DuckDuckGo Search (Organic Scraper - FREE)
// ─────────────────────────────────────────────────────────────
async function handleDuckDuckGoSearch(query) {
  try {
    const cleaned = cleanSearchQuery(query) || query;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleaned)}`;
    const response = await fetchWithTimeout(url, {
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
      let snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      
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
        let cleanSnippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
        
        // Try to extract a date if present in the snippet
        const dateMatch = cleanSnippet.match(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})/i);
        
        results.push({
          title: cleanTitle,
          url: urlLink,
          snippet: cleanSnippet,
          date: dateMatch ? dateMatch[1] : null,
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
    const cleaned = cleanSearchQuery(query) || query;
    const response = await fetchWithTimeout("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: cleaned,
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
    const cleaned = cleanSearchQuery(query) || query;
    const params = new URLSearchParams({
      q: cleaned,
      api_key: process.env.SERPAPI_KEY,
      engine: "google",
      num: 8
    });

    const response = await fetchWithTimeout(`https://serpapi.com/search?${params}`);
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

// ─────────────────────────────────────────────────────────────
//  Helper: Scrape content of a specific URL
// ─────────────────────────────────────────────────────────────
async function scrapeUrlContent(url) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
      }
    }, 6000); // 6 seconds timeout

    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`);
    }

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : url;

    // Clean body HTML tags to get readable text
    let snippet = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();

    return {
      title,
      url,
      snippet: snippet.slice(0, 3000), // Rich context snippet (up to 3000 chars)
      source: "Direct Web Visit"
    };
  } catch (err) {
    console.error(`Error visiting ${url}:`, err.message);
    return {
      title: "Page unreachable",
      url,
      snippet: `Unable to retrieve page content: ${err.message}`,
      source: "Direct Web Visit"
    };
  }
}

// ─────────────────────────────────────────────────────────────
//  Helper: Enrich search results by scraping top pages
// ─────────────────────────────────────────────────────────────
async function enrichSearchResults(results) {
  if (!results || !results.length) return results;
  
  // Enrich only the top 2 results in parallel to balance detail vs speed
  return await Promise.all(
    results.map(async (r, idx) => {
      if (idx < 2 && r.url && r.url.startsWith("http")) {
        const scrapeRes = await scrapeUrlContent(r.url);
        if (scrapeRes && scrapeRes.snippet && !scrapeRes.snippet.startsWith("Unable to retrieve")) {
          return {
            ...r,
            snippet: scrapeRes.snippet.slice(0, 2000), // Enrich with up to 2000 chars
            isEnriched: true
          };
        }
      }
      return r;
    })
  );
}

// ═════════════════════════════════════════════════════════════
//  ROUTE 0: Context-Aware Search Query Planner
//  Receives current chat history + memories + prompt, returns
//  { should_search: bool, search_query: string }
// ═════════════════════════════════════════════════════════════
app.post("/api/plan-search", async (req, res) => {
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
- Use memory context to personalise queries where helpful (e.g. memory says user is in Haryana → include location for location-specific queries)
- The search_query MUST be 3-10 words, specific, and Google-optimised
- Include the current year only when recency truly matters`;

  const historyText = recentHistory.length > 0
    ? recentHistory.map(m => `${m.role === "user" ? "User" : "AI"}: ${m.content}`).join("\n")
    : "No prior messages.";

  const userMsg = `User memories:\n${memoryContext || "None"}\n\nRecent conversation:\n${historyText}\n\nCurrent user message: "${currentPrompt}"`;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg }
        ],
        max_tokens: 80,
        temperature: 0.1,
        response_format: { type: "json_object" }
      })
    });

    if (!groqRes.ok) throw new Error(`Groq plan-search error: ${groqRes.status}`);
    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content || "{}";

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { parsed = { should_search: true, search_query: currentPrompt }; }

    console.log(`[PLAN-SEARCH] prompt="${currentPrompt.slice(0,60)}" → should_search=${parsed.should_search}, query="${parsed.search_query}"`);

    res.json({
      should_search: parsed.should_search === true,
      search_query: (parsed.search_query || currentPrompt).trim()
    });
  } catch (e) {
    console.error("[PLAN-SEARCH] Error, falling back to raw prompt:", e.message);
    // Graceful fallback — don't block the request
    res.json({ should_search: true, search_query: currentPrompt });
  }
});

// ═════════════════════════════════════════════════════════════
//  ROUTE 1: Smart Web Search (Auto-selects best available)
// ═════════════════════════════════════════════════════════════
app.post("/api/search", async (req, res) => {
  const { query, service } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });

  console.log(`[SEARCH] Query: "${query}" | Service: ${service || "auto"}`);

  // Check if query is or contains a direct URL
  let urls = query.match(/https?:\/\/[^\s]+/gi);
  if (!urls) {
    const domainMatch = query.trim().match(/^[a-zA-Z0-9.-]+\.[a-z]{2,6}(?:\/\S*)?$/i);
    if (domainMatch) {
      urls = [`https://${query.trim()}`];
    }
  }

  if (urls && urls.length > 0) {
    console.log(`[SEARCH] Direct URLs detected: ${urls.join(", ")}`);
    const results = await Promise.all(urls.slice(0, 3).map(url => scrapeUrlContent(url)));
    return res.json({
      success: true,
      query,
      results,
      service: "direct_visit",
      count: results.length
    });
  }

  // Generate 2 to 3 distinct queries for parallel search
  let searchQueries = [query];
  
  const getAvailableAgent = () => {
    if (process.env.GEMINI_API_KEY) return "gemini";
    if (process.env.GROQ_API_KEY) return "groq";
    if (process.env.MISTRAL_API_KEY) return "mistral";
    return null;
  };
  
  const agent = getAvailableAgent();
  if (agent) {
    try {
      const prompt = `You are a Search Intent Analyzer. The user wants to find information about: "${query}".
Output a JSON array containing 2 to 3 distinct search queries (as plain strings) that will help retrieve the most comprehensive, relevant, and updated results for this topic.
Format: ["query 1", "query 2"]
Do not add any markup, conversational introductory text, or explanations. Only return the raw JSON array.`;
      
      const resText = await callModelBackend(agent, [{ role: "user", content: prompt }]);
      const match = resText.match(/\[[\s\S]*?\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          searchQueries = parsed.map(q => q.trim()).filter(Boolean).slice(0, 3);
        }
      }
    } catch (err) {
      console.error("[SEARCH ANALYZER] Failed to generate parallel search queries:", err.message);
    }
  }
  
  console.log(`[SEARCH] Planned parallel search queries: ${JSON.stringify(searchQueries)}`);

  // Execute all search queries in parallel
  const allSearchResults = await Promise.all(
    searchQueries.map(async (subQuery) => {
      let results = [];
      let serviceUsed = "duckduckgo";
      let answer = null;

      // Try Tavily
      if ((!service || service === "auto" || service === "tavily") && process.env.TAVILY_API_KEY) {
        const tavilyResult = await handleTavilySearch(subQuery);
        if (tavilyResult) {
          results = tavilyResult.results;
          serviceUsed = "tavily";
          answer = tavilyResult.answer;
        }
      }

      // Try SerpAPI fallback
      if (results.length === 0 && (!service || service === "auto" || service === "serpapi") && process.env.SERPAPI_KEY) {
        const serpResults = await handleSerpAPISearch(subQuery);
        if (serpResults && serpResults.length > 0) {
          results = serpResults;
          serviceUsed = "serpapi";
        }
      }

      // Try DDG fallback
      if (results.length === 0) {
        results = await handleDuckDuckGoSearch(subQuery);
        serviceUsed = "duckduckgo";
      }

      // Crawl and scrape top 2 pages for this query in parallel
      const enrichedResults = await enrichSearchResults(results);

      // Tag results with the sub-query name
      const taggedResults = enrichedResults.map(r => ({
        ...r,
        title: `[Query: "${subQuery}"] ${r.title || "Result"}`
      }));

      return {
        service: serviceUsed,
        results: taggedResults,
        answer
      };
    })
  );

  // Combine and merge results
  let mergedResults = [];
  let combinedAnswers = [];
  
  for (const item of allSearchResults) {
    if (item.results) {
      mergedResults.push(...item.results);
    }
    if (item.answer) {
      combinedAnswers.push(item.answer);
    }
  }
  
  const finalAnswer = combinedAnswers.length > 0 ? combinedAnswers.join(" | ") : null;

  res.json({
    success: true,
    query,
    results: mergedResults,
    answer: finalAnswer,
    service: "multi_search",
    count: mergedResults.length
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
    } catch (_) { /* fall through to plain-text fallback */ }
  }

  // Fallback: return plain text as single chunk (graceful degradation)
  res.json({ script: text });
});

// ══════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════
//  🔐 AUTH HELPER — verify Firebase ID token → uid
// ══════════════════════════════════════════════════════════════
async function getUserUid(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;
  if (!firebaseReady) return null;
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    return decoded.uid || null;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
//  🧠 MEMORY HELPERS — load from & save to Firebase RTDB
// ══════════════════════════════════════════════════════════════

/** Loads all memories for a user from Firebase RTDB. Returns array. */
async function loadMemoriesFromFirebase(uid) {
  if (!uid || !firebaseReady) return [];
  try {
    const snap = await getDatabase().ref(`memories/${uid}`).once("value");
    const val = snap.val();
    if (!val || typeof val !== "object") return [];
    return Object.values(val)
      .filter(m => m && typeof m.content === "string" && m.content.trim())
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch {
    return [];
  }
}

/** Fire-and-forget: extract facts from conversation tail, save/update/delete in Firebase RTDB dynamically. */
async function extractMemoriesBackground(messages, uid) {
  if (!uid || !firebaseReady || !process.env.GROQ_API_KEY) return;
  if (!Array.isArray(messages) || messages.length < 2) return;

  try {
    const memRef = getDatabase().ref(`memories/${uid}`);
    const snap = await memRef.once("value");
    const existingObj = snap.val() || {};
    const existingList = Object.values(existingObj)
      .map(m => `- ID: "${m.id}" | Category: "${m.category}" | Content: "${m.content}"`)
      .join("\n");

    const systemPrompt = `You are a precision profile memory manager. You keep track of key details, preferences, projects, and context about a user.

Your task is to analyze a conversation snippet and determine if any changes (additions, updates, or deletions) need to be made to the user's saved profile memories based on what they just said.

Here is the USER'S CURRENT SAVED PROFILE MEMORIES:
${existingList || "None"}

EXTRACTION RULES:
1. "add": Use this action if the user explicitly stated a new key fact (e.g. email, phone number, location, active project) that is NOT already represented in the list.
   - Do NOT replace/overwrite existing unrelated memories in the same category. For example, if the user has an email address stored, and they state a phone number, do NOT delete/overwrite the email address. Keep both.
   - Content should be one clear sentence starting with "User" (e.g. "User's email is test@example.com").
   - Category options: "personal", "preference", "project", "context" (use "personal" for identity/contact details).
2. "update": Use this action if the user corrected or updated a previously stored fact (e.g. they changed their email address or job). Specify the target memory ID from the list.
3. "delete": Use this action if the user explicitly requested to forget a specific fact, or if it is no longer true. Specify the target memory ID.
4. "none": If no changes are needed, return an empty array.

Be conservative: only store facts that are genuinely useful, factual, and reusable. Do not record opinions or temporary chat context.

CRITICAL: Return ONLY a valid JSON array of operations, and absolutely nothing else. No markdown, no formatting fences, no explanations.

Example output:
[
  { "action": "add", "category": "personal", "content": "User's phone number is +1-555-0199" },
  { "action": "update", "id": "mem_123456", "content": "User's email is newaddress@domain.com" }
]`;

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
          { role: "user", content: `Analyze the exchange and generate the JSON operations list:\n\n${convText}` }
        ],
        max_tokens: 400,
        temperature: 0.1
      })
    });

    const data = await response.json();
    let rawText = data.choices?.[0]?.message?.content?.trim() || "[]";
    rawText = rawText.replace(/```(?:json)?\n?/g, "").replace(/```\n?/g, "").trim();
    const match = rawText.match(/\[[\s\S]*\]/);
    if (match) rawText = match[0];

    let operations = [];
    try {
      operations = JSON.parse(rawText);
    } catch {
      return;
    }
    if (!Array.isArray(operations)) return;

    const MEMORY_EMOJI = {
      personal: "👤",
      personal_information: "👤",
      contact_information: "📞",
      location: "📍",
      preference: "❤️",
      preferences: "❤️",
      communication_style: "💬",
      project: "🚀",
      projects: "🚀",
      education: "🎓",
      technical_skills: "🛠️",
      skills: "🛠️",
      programming_languages: "💻",
      others: "📦",
      context: "💡"
    };

    for (const op of operations) {
      if (!op || typeof op !== "object") continue;
      const { action, id, category, content } = op;
      const cat = category || "others";
      const emoji = MEMORY_EMOJI[cat] || "💡";
      
      if (action === "add" && content && content.trim()) {
        const memId = `mem_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
        await memRef.child(memId).set({
          id: memId,
          content: content.trim(),
          category: cat,
          emoji,
          createdAt: Date.now()
        }).catch(() => {});
      } else if (action === "update" && id && content && content.trim()) {
        if (existingObj[id]) {
          const finalCat = category || existingObj[id].category || "others";
          const finalEmoji = MEMORY_EMOJI[finalCat] || "💡";
          await memRef.child(id).update({
            content: content.trim(),
            category: finalCat,
            emoji: finalEmoji,
            createdAt: Date.now()
          }).catch(() => {});
        }
      } else if (action === "delete" && id) {
        if (existingObj[id]) {
          await memRef.child(id).remove().catch(() => {});
        }
      }
    }
  } catch {
    // background — never throw
  }
}

// ══════════════════════════════════════════════════════════════
//  ✨ PROMPT ENHANCER HELPER (backend-side)
// ══════════════════════════════════════════════════════════════
async function enhancePromptBackend(rawPrompt, targetAgentName = "an advanced AI assistant") {
  if (!process.env.GROQ_API_KEY) return rawPrompt;
  const systemPrompt = `You are an elite AI prompt optimization system.

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
- Use proper punctuation throughout (periods, commas, question marks, etc.)
- Optimize for ${targetAgentName}
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

OUTPUT RULES:
- Return ONLY the rewritten prompt
- No labels
- No explanations
- No markdown
- No quotation marks
- No code fences
- No extra text before or after the prompt`;

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
          { role: "user", content: rawPrompt }
        ],
        max_tokens: 500,
        temperature: 0.3
      })
    });
    const data = await response.json();
    const enhanced = data.choices?.[0]?.message?.content?.trim();
    return (enhanced && enhanced.length > 0) ? enhanced : rawPrompt;
  } catch {
    return rawPrompt;
  }
}

// ══════════════════════════════════════════════════════════════
//  🌐 WEB SEARCH HELPER (backend-side, context-aware)
// ══════════════════════════════════════════════════════════════
async function planAndFetchWebContext(rawPrompt, recentHistory = [], memories = []) {
  if (!process.env.GROQ_API_KEY) {
    // No planner available — try a direct search anyway
    const fallbackData = await fetchWebContextForBranch(rawPrompt, { name: rawPrompt, possibilities: [] });
    return { shouldSearch: !!fallbackData, searchQuery: rawPrompt, webData: fallbackData };
  }

  // ── Step 1: Context-aware planning ──
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
- Use memory context to personalise queries where helpful (e.g. memory says user is in Haryana → include location for location-specific queries)
- The search_query MUST be 3-10 words, specific, and Google-optimised
- Include the current year only when recency truly matters`;

  const historyText = recentHistory.length > 0
    ? recentHistory.map(m => `${m.role === "user" ? "User" : "AI"}: ${m.content}`).join("\n")
    : "No prior messages.";

  const memoryLines = memories.length > 0
    ? memories.map(m => `• ${m.content}`).join("\n")
    : "None";

  const userMsg = `User memories:\n${memoryLines}\n\nRecent conversation:\n${historyText}\n\nCurrent user message: "${rawPrompt}"`;

  let shouldSearch = false;
  let searchQuery = rawPrompt;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg }
        ],
        max_tokens: 80,
        temperature: 0.1,
        response_format: { type: "json_object" }
      }),
      signal: AbortSignal.timeout(5000)
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

  if (!shouldSearch) {
    return { shouldSearch: false, searchQuery, webData: null };
  }

  // ── Step 2: Fetch web results ──
  const webData = await fetchWebContextForBranch(searchQuery, { name: searchQuery, possibilities: [] });
  return { shouldSearch: true, searchQuery, webData };
}

// ══════════════════════════════════════════════════════════════
//  🤖 CHAT ENDPOINT — full marker processing on backend
//  Replaces per-agent streaming endpoints for marker-aware chat
// ══════════════════════════════════════════════════════════════
app.post("/api/chat", async (req, res) => {
  const { messages, agent, lowLatency } = req.body;
  if (!messages || !agent) return res.status(400).json({ error: "messages and agent required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Get uid for marker processing (optional — needed for OAuth token access)
  let uid = null;
  try {
    const authHeader = req.headers.authorization;
    if (authHeader) uid = await getUserUid(authHeader);
  } catch {}

  try {
    sendEvent({ type: "status", message: "🤖 Generating response…" });

    let fullResponse = "";
    const agentName = agent;

    if (isGroqAgent(agentName)) {
      if (!process.env.GROQ_API_KEY) throw new Error("Groq key not configured.");
      const groqModel = GROQ_MODEL_MAP[agentName];
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: groqModel, messages, max_tokens: getGroqMaxTokens(agentName), temperature: 0.7, stream: true }),
        signal: AbortSignal.timeout(30000)
      });
      if (!groqRes.ok) { const errText = await groqRes.text(); throw new Error(`Groq API error (${groqRes.status}): ${errText.slice(0, 200)}`); }
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
          try { const parsed = JSON.parse(data); const content = parsed.choices?.[0]?.delta?.content || ""; if (content) { fullResponse += content; sendEvent({ type: "token", text: content }); } } catch (_) {}
        }
      }
    } else if (agentName === "mistral") {
      if (!process.env.MISTRAL_API_KEY) throw new Error("Mistral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://api.mistral.ai/v1/chat/completions",
        { "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "mistral-large-latest", messages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agentName === "codestral") {
      if (!process.env.CODESTRAL_API_KEY) throw new Error("Codestral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://codestral.mistral.ai/v1/chat/completions",
        { "Authorization": `Bearer ${process.env.CODESTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "codestral-latest", messages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agentName === "gemini") {
      if (!process.env.GEMINI_API_KEY) throw new Error("Gemini key not configured.");
      const prompt = messages[messages.length - 1].content;
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      if (!response.ok) { const text = await response.text(); throw new Error(`Gemini API error (${response.status}): ${text.slice(0, 200)}`); }
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
          try { const parsed = JSON.parse(data); const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || ""; if (text) { fullResponse += text; sendEvent({ type: "token", text }); } } catch (_) {}
        }
      }
    } else {
      throw new Error("Invalid agent selected.");
    }

    // Send done event with raw response
    sendEvent({ type: "done", result: fullResponse });

    // Process markers if uid available
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

app.get("/health", (req, res) => res.send("OK"));

// ══════════════════════════════════════════════════════════════
//  🚀 UNIFIED /api/chat-enhanced — One endpoint, all features
//  Orchestrates: Enhance → Web Search → Memory → Stream → Markers → Memory Extract
// ══════════════════════════════════════════════════════════════
app.post("/api/chat-enhanced", async (req, res) => {
  const { messages, agent, rawPrompt, options = {} } = req.body;
  const {
    enhance: enableEnhance = true,
    webSearch: enableWebSearch = true,
    memories: enableMemories = true
  } = options;

  if (!messages || !Array.isArray(messages) || !agent || !rawPrompt) {
    return res.status(400).json({ error: "messages, agent, and rawPrompt are required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // ── Resolve authenticated uid (optional — for memory) ──
  let uid = null;
  try {
    const authHeader = req.headers.authorization;
    if (authHeader) uid = await getUserUid(authHeader);
  } catch {}

  try {
    // ── STEP 1: Load user memories from Firebase ──
    let userMemories = [];
    if (enableMemories && uid) {
      try {
        userMemories = await loadMemoriesFromFirebase(uid);
        if (userMemories.length > 0) {
          sendEvent({ type: "status", message: `🧠 Loaded ${userMemories.length} memor${userMemories.length === 1 ? "y" : "ies"}…` });
        }
      } catch { /* non-critical */ }
    }

    // ── STEP 2: Enhance the prompt ──
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
      } catch { /* non-critical — use raw prompt */ }
    }

    // ── STEP 3: Context-aware web search ──
    let webData = null;
    let searchQuery = null;
    const trivialTest = /^(hi|hello|hey|hiya|yo|sup|thanks|thank you|bye|good morning|good night|good afternoon|good evening|yes|no|ok|okay|sure|alright|lol|haha|nice|great|awesome|cool|maybe|idk|oh|ah|um|hmm)[\s!?.]*$/i.test(rawPrompt.trim()) || rawPrompt.trim().length < 3;

    if (enableWebSearch && !trivialTest) {
      sendEvent({ type: "status", message: "🧠 Planning search strategy…" });
      const recentHistory = messages
        .filter(m => m.role !== "system")
        .slice(-6)
        .map(m => ({ role: m.role, content: String(m.content || "").slice(0, 400) }));

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
              results: (webData.results || []).slice(0, 6).map(r => ({
                title: r.title,
                url: r.url,
                snippet: (r.snippet || r.content || "").slice(0, 200),
                date: r.date || null
              }))
            });
          }
        } else {
          sendEvent({ type: "search_plan", shouldSearch: false, reason: "Query answered by training data" });
        }
      } catch { /* web search failure is non-critical */ }
    }

    // ── STEP 4: Build final message set ──
    const BASE_SYSTEM_PROMPT = "You are Orblen AI, an advanced assistant with live search. Use provided search results to give accurate, up-to-date answers, citing sources as [1]. Default to short, concise responses with proper punctuation. Expand only when necessary for complexity or detail.";

    let sysContent = BASE_SYSTEM_PROMPT;

    if (userMemories.length > 0) {
      const memSummary = userMemories.map(m => m.content.trim()).join(". ");
      sysContent += `\n\nUser background context: ${memSummary}\nUse this context naturally and helpfully when relevant. Do not mention that you have a stored memory system.`;
    }

    // Build web context block
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

    const userMsgContent = finalPrompt + webContextBlock;
    const chatMessages = [
      { role: "system", content: sysContent },
      { role: "user", content: userMsgContent }
    ];

    // ── STEP 5: Stream the model response ──
    sendEvent({ type: "status", message: `🤖 Asking ${BACKEND_AGENT_NAMES[agent] || agent}…` });

    let fullResponse = "";

    if (isGroqAgent(agent)) {
      if (!process.env.GROQ_API_KEY) throw new Error("Groq key not configured.");
      const groqModel = GROQ_MODEL_MAP[agent];
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: groqModel, messages: chatMessages, max_tokens: getGroqMaxTokens(agent), temperature: 0.7, stream: true }),
        signal: AbortSignal.timeout(30000)
      });
      if (!groqRes.ok) { const errText = await groqRes.text(); throw new Error(`Groq API error (${groqRes.status}): ${errText.slice(0, 200)}`); }
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
          try { const parsed = JSON.parse(data); const content = parsed.choices?.[0]?.delta?.content || ""; if (content) { fullResponse += content; sendEvent({ type: "token", text: content }); } } catch (_) {}
        }
      }
    } else if (agent === "mistral") {
      if (!process.env.MISTRAL_API_KEY) throw new Error("Mistral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://api.mistral.ai/v1/chat/completions",
        { "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "mistral-large-latest", messages: chatMessages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agent === "codestral") {
      if (!process.env.CODESTRAL_API_KEY) throw new Error("Codestral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://codestral.mistral.ai/v1/chat/completions",
        { "Authorization": `Bearer ${process.env.CODESTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "codestral-latest", messages: chatMessages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agent === "gemini") {
      if (!process.env.GEMINI_API_KEY) throw new Error("Gemini key not configured.");
      // For Gemini, build a flattened prompt
      const geminiPrompt = chatMessages.map(m => m.content).join("\n\n");
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: geminiPrompt }] }] })
        }
      );
      if (!response.ok) { const text = await response.text(); throw new Error(`Gemini API error (${response.status}): ${text.slice(0, 200)}`); }
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
          try { const parsed = JSON.parse(data); const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || ""; if (text) { fullResponse += text; sendEvent({ type: "token", text }); } } catch (_) {}
        }
      }
    } else {
      // Other Gemini-family agents routed through Gemini key
      if (!process.env.GEMINI_API_KEY) throw new Error("Gemini key not configured.");
      const geminiPrompt = chatMessages.map(m => m.content).join("\n\n");
      const agentModelMap = {
        "gemma": "gemma-3-27b-it",
        "gemini-pro": "gemini-pro",
        "gemini-thinking": "gemini-2.0-flash-thinking-exp"
      };
      const model = agentModelMap[agent] || "gemini-3.5-flash";
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: geminiPrompt }] }] })
        }
      );
      if (!response.ok) { const text = await response.text(); throw new Error(`${agent} API error (${response.status}): ${text.slice(0, 200)}`); }
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
          try { const parsed = JSON.parse(data); const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || ""; if (text) { fullResponse += text; sendEvent({ type: "token", text }); } } catch (_) {}
        }
      }
    }

    // ── STEP 6: Process SAVE_MEMORY markers ──
    sendEvent({ type: "done", result: fullResponse });

    let displayText = fullResponse;
    let memorySaved = false;

    if (uid) {
      const { cleanText } = await processMarkers(fullResponse, uid);
      displayText = cleanText;
      memorySaved = cleanText !== fullResponse;
    } else {
      // Strip SAVE_MEMORY markers from display text even if not saved
      displayText = fullResponse
        .replace(/\[SAVE_MEMORY\][\s\S]*?\[\/SAVE_MEMORY\]/g, "🧠 Memory saved")
        .trim();
    }

    sendEvent({ type: "processed", displayText, cleanText: displayText, memorySaved });

    // ── STEP 7: Background memory extraction (fire-and-forget) ──
    if (uid && enableMemories) {
      const allMessages = [
        ...messages.filter(m => m.role !== "system").slice(-3),
        { role: "assistant", content: displayText }
      ];
      extractMemoriesBackground(allMessages, uid).then(() => {
        // Memory extraction is complete — this runs in background
      }).catch(() => {});
    }

    res.end();
  } catch (err) {
    console.error("[/api/chat-enhanced] Error:", err.message);
    sendEvent({ type: "error", message: err.message });
    res.end();
  }
});



const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 ORBLEN AI Backend running on port ${PORT}`);
  console.log(`   Keys loaded: ${[
    process.env.GEMINI_API_KEY     ? "✅ Gemini"       : "❌ Gemini",
    process.env.MISTRAL_API_KEY    ? "✅ Mistral"      : "❌ Mistral",
    process.env.CODESTRAL_API_KEY  ? "✅ Codestral"    : "❌ Codestral",
    process.env.GROQ_API_KEY       ? "✅ Groq + 🧠 Memory" : "❌ Groq / Memory",
    process.env.TAVILY_API_KEY     ? "✅ Tavily Search" : "⚠️  Tavily (DDG fallback active)",
    "",
    firebaseReady                  ? "✅ Firebase RTDB" : "❌ Firebase RTDB",
  ].join(" | ")}`);
});
