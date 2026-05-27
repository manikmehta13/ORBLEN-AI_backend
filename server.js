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

app.use(express.json({ limit: '15mb' }));

// ── Health check ──
app.get("/", (req, res) => {
  res.json({ status: "✅ NEXUS AI Backend is live", version: "1.0.0" });
});

// ══════════════════════════════════════════════════════════════
//  🔑 NVIDIA NIM — shared helper (OpenAI-compatible endpoint)
// ══════════════════════════════════════════════════════════════
async function callNvidiaModel(model, apiKey, messages, res, opts = {}) {
  if (!apiKey) {
    return res.status(503).json({ error: `NVIDIA API key for ${model} not configured on server.` });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxTokens || 16384,
        temperature: opts.temperature ?? 0.7,
        top_p: opts.topP ?? 1.0,
        stream: false
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

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
    const msg = err.name === 'AbortError' ? `NVIDIA NIM (${model}) timed out after 90s.` : `NVIDIA NIM (${model}) request failed: ` + err.message;
    res.status(500).json({ error: msg });
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
        max_tokens: 16384
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
        max_tokens: 16384
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
        max_tokens: 4096
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
//  🆕 ROUTE: Google Gemma 4 31B IT — via NVIDIA NIM
// ══════════════════════════════════════════════════════════════
app.post("/api/gemma4", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages required" });
  await callNvidiaModel("google/gemma-4-31b-it", process.env.NVIDIA_KEY_GEMMA4, messages, res);
});

// ══════════════════════════════════════════════════════════════
//  🆕 ROUTE: DeepSeek (moonshotai/kimi-k2.6) — via NVIDIA NIM
// ══════════════════════════════════════════════════════════════
app.post("/api/deepseek", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages required" });

  if (!process.env.NVIDIA_KEY_KIMI) {
    return res.status(503).json({ error: "Kimi (NVIDIA NIM) API key not configured on server." });
  }

  await callNvidiaModel("moonshotai/kimi-k2.6", process.env.NVIDIA_KEY_KIMI, messages, res, { maxTokens: 65536, temperature: 1.0 });
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
  deepseek: "Kimi K2.6 (NIM)",
  gemma4: "Gemma 4 31B IT (NIM)",
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
    deepseek: process.env.NVIDIA_KEY_KIMI,
    gemma4: process.env.NVIDIA_KEY_GEMMA4,
    gemini: process.env.GEMINI_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
    groq: process.env.GROQ_API_KEY,
    cohere: process.env.COHERE_API_KEY
  };

  if (keys[requestedAgent]) {
    return { agent: requestedAgent, fallback: false };
  }

  const fallbackOrder = ["gemini", "groq", "deepseek", "gemma4", "nvidia-llama", "openai", "mistral", "cohere"];
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
      max_tokens: 16384,
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
        max_tokens: 16384
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

  if (agent === "deepseek") {
    if (!process.env.NVIDIA_KEY_KIMI) throw new Error("Kimi (NVIDIA NIM) key not configured for DeepSeek agent.");
    return await callNvidiaModelBackend("moonshotai/kimi-k2.6", process.env.NVIDIA_KEY_KIMI, messages);
  }

  if (agent === "gemma4") {
    if (!process.env.NVIDIA_KEY_GEMMA4) throw new Error("Gemma 4 key not configured.");
    return await callNvidiaModelBackend("google/gemma-4-31b-it", process.env.NVIDIA_KEY_GEMMA4, messages);
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
        max_tokens: 16384
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
        max_tokens: 4096
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
//  🌐 WEB SEARCH INTELLIGENCE — Multi-Factor Decision Framework
//
//  Determines whether a query needs live web data by evaluating
//  five factors: knowledge currency gap, training data coverage,
//  answer dynamism, risk of harm, and confidence gap.
//
//  Returns true when the total weighted score crosses the threshold,
//  or when the user explicitly requests a web search.
//
//  This is the same framework used by the frontend for normal chat
//  and debate modes, ensuring consistent behavior everywhere.
// ══════════════════════════════════════════════════════════════

/**
 * Multi-factor decision framework for internet access (backend version).
 * Accepts arbitrary text (topic + branch name + possibilities combined).
 */
function needsInternetAccess(text) {
  const t = text.toLowerCase().trim();
  const words = t.split(/\s+/);
  const wordCount = words.length;

  // Explicit web request — always search
  if (/\b(search(\s+(for|the|up|online|web|internet))?|google\s|look\s*up|browse\s|find\s+(out|online|information|data|details?|the\s+(latest|current|recent))|web\s+search|internet\s+search|check\s+(online|the\s+web|the\s+internet)|lookup)\b/i.test(t)) return true;

  let score = 0;

  // ── FACTOR 1: KNOWLEDGE CURRENCY GAP (0-30) ──

  if (/\b(today|yesterday|tonight|this\s+(week|month|year|quarter|morning|afternoon|evening|decade)|last\s+(night|hour|week|month|year|quarter|decade)|right\s+now|currently|ongoing|as\s+of|at\s+the\s+moment)\b/i.test(t)) score += 18;
  if (/\b(202[4-9]|20[3-9]\d)\b/.test(t)) score += 20;
  if (/\b(weather|forecast|temperature|storm|hurricane|earthquake|flood|wildfire)\b/i.test(t)) score += 12;
  if (/\b(stock\s*(price|market)?|crypto|bitcoin|ethereum|btc|eth|solana|share\s*price|nifty|sensex|index|market\s+cap|trading)\b/i.test(t)) score += 14;
  if (/\b(news|headlines?|headlined|breaking|trending|current\s+events|latest|update)\b/i.test(t)) score += 12;
  if (/\b(tomorrow|next\s+(week|month|year|quarter|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(t)) score += 10;

  // ── FACTOR 2: TRAINING DATA COVERAGE (0-25) ──

  const specificityWords = (t.match(/\b(specific|detail|exact|precise|particular|current|latest|recent|upcoming|new|updated|fresh|live|real.time)\b/gi) || []).length;
  if (specificityWords >= 2) score += 8;
  if (specificityWords >= 3) score += 5;
  if (/\b(what('s| is)\s+new|what\s+happened|what('s| is)\s+happening|update\s+(on|about)|status\s+of|developments?\s+in|progress\s+(on|of|in)|latest\s+(on|in|about|news|update|report|study|finding))\b/i.test(t)) score += 15;
  if (/\b(top\s+\d+|best\s+\w+|worst\s+\w+|highest\s+|lowest\s+|leading\s+|most\s+(popular|valuable|influential|powerful|expensive|anticipated))\b/i.test(t)) score += 10;
  if (wordCount >= 12 && /\b(company|organization|startup|product|service|platform|framework|library|tool|software|app|device|technology)\b/i.test(t)) score += 8;
  if (/\b(how\s+many|how\s+much|statistics?|data\s+(on|about|for|shows)|figures?|numbers?|percentage|rate\s+of|ratio|total|population|GDP|revenue|profit|loss|growth|decline|increase|decrease|survey|poll)\b/i.test(t)) score += 10;

  // ── FACTOR 3: ANSWER DYNAMISM (0-20) ──

  if (/\b(price|pricing|cost|rate|fees|salary|valuation|worth|budget|funding|investment|revenue|profit|quarterly)\b/i.test(t)) score += 8;
  if (/\b(version|release|update|launch|announce|beta|alpha|patch|rollout|deprecat)\b/i.test(t)) score += 8;
  if (/\b(election|poll|vote|approval.rating|candidate|campaign|legislation|bill|policy|regulation|ruling|judgment)\b/i.test(t)) score += 8;
  const dynamicEntityCount = (t.match(/\b(AI|artificial\s+intelligence|GPT|ChatGPT|LLM|machine\s+learning|deep\s+learning|Apple|Google|Microsoft|Meta|Amazon|Tesla|SpaceX|OpenAI|Anthropic|NVIDIA|AMD|Intel|Samsung|Twitter|X\.com|Netflix|Uber|Airbnb|Spotify|Zoom|Slack|Notion|Figma|Vercel|Netlify|Adobe|Oracle|IBM|Salesforce|Palantir|ByteDance|Tencent|Alibaba|Sony|IPO|acquisition|merger|lawsuit|antitrust)\b/gi) || []).length;
  if (dynamicEntityCount >= 1) score += 6;
  if (dynamicEntityCount >= 2) score += 4;
  if (/\b(versus|vs\.?|compare|comparison|difference\s+between|better\s+than|worse\s+than|how\s+does\s+\w+\s+compare|which\s+is\s+(better|worse|faster|cheaper|more))\b/i.test(t)) score += 6;

  // ── FACTOR 4: RISK OF HARM (0-15) ──

  if (/\b(medical|health|treatment|therapy|medication|dosage|symptom|disease|diagnosis|prognosis|surgery|drug|vaccine|clinical|patient|hospital)\b/i.test(t)) score += 15;
  if (/\b(legal|law|lawsuit|statute|regulation|compliance|attorney|lawyer|court|judge|ruling|precedent|contract|liability)\b/i.test(t)) score += 12;
  if (/\b(financial\s+advice|investment|retirement|mortgage|loan|interest\s+rate|credit\s+score|tax|insurance|portfolio|trading)\b/i.test(t)) score += 10;
  if (/\b(safety|security|emergency|disaster|evacuation|warning|alert|recall|hazard|toxic|poison)\b/i.test(t)) score += 12;
  if (/\b(accurate|correct|reliable|up.to.date|up\s+to\s+date|current|verify|confirm|fact.?check|true|real|actual|ensure|make\s+sure|double.check)\b/i.test(t)) score += 8;

  // ── FACTOR 5: CONFIDENCE GAP (0-10) ──

  if (/\b(what\s+(is|are|was|were)\s+(the|a|an)\s+\w+\s+(of|in|for)\s+\w+|how\s+(many|much|large|long|far|old|tall|wide|deep|fast|often)\s+is|when\s+(did|was|were|will|does)\s+\w+|where\s+(is|are|was|were|did|does)\s+\w+)\b/i.test(t)) score += 6;
  if (/\b(\d{4}|\d+%\s|\$\d+|€\d+|£\d+|INR\s+\d+|\d+\s+(million|billion|trillion|thousand|hundred)|born\s+in|founded\s+in|launched\s+in|released\s+in)\b/i.test(t)) score += 5;
  if (/\b(explain|define|what\s+is\s+(a|an|the)\s+\w+\s*$|describe|overview|introduction|meaning\s+of|definition\s+of|concept\s+of|theory\s+of|history\s+of|origins?\s+of)\b/i.test(t)) score -= 8;
  if (/\b(think|believe|opinion|thoughts?\s+on|your\s+(take|perspective|view)|what\s+do\s+you\s+(think|know)\s+about|how\s+do\s+you\s+(feel|view)|in\s+your\s+opinion)\b/i.test(t)) score -= 6;

  // ── PENALTIES: Stable / timeless topics ──

  if (/\b(ancient|classical|medieval|historical|century|b\.c\.|a\.d\.|prehistoric|origin\s+of|etymology|definition|meaning\s+of|derived\s+from|roots?\s+in)\b/i.test(t)) score -= 15;
  if (/\b(mathematical|theorem|proof|formula|equation|scientific\s+(law|principle|theory|method)|physics|chemistry|biology|photosynthesis|gravity|evolution|atom|molecule|cell|DNA)\b/i.test(t)) score -= 12;
  if (/\b(philosophy|philosophical|metaphysics|ethics|morality|existential|consciousness|free\s+will)\b/i.test(t)) score -= 10;
  if (/\b(grammar|syntax|vocabulary|translat\w+|synonym|antonym|spelling|pronunciation|language)\b/i.test(t)) score -= 5;
  if (wordCount <= 4 && !t.includes('?')) {
    const hasStrongSignal = /\b(today|yesterday|tonight|latest|update|news|weather|stock|price|crypto|election)\b/i.test(t);
    if (!hasStrongSignal) score -= 10;
  }

  // ── COMBINED SIGNAL BONUS: temporal + dynamic-interest overlap ──
  const hasTemporalSignal = /\b(today|yesterday|tonight|tomorrow|this\s+(week|month|year|quarter)|last\s+(night|week|month|year)|next\s+(week|month|year)|in\s+20\d{2}|currently|ongoing|recent|latest|upcoming|new)\b/i.test(t);
  const hasDynamicInterest = /\b(news|headlines?|headlined|weather|stock|price|market|crypto|election|score|match|result|winner|version|release|launch|update|trending|breaking)\b/i.test(t);
  if (hasTemporalSignal && hasDynamicInterest) {
    score += 15;
  }

  return score >= 55;
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
  block += "• Use the web data above to ground your answer in current, factual information.\n";
  block += "• Cite sources by number, e.g. [1], when referencing specific results.\n";
  block += "• If web data conflicts with your training knowledge, defer to the web data since it is more current.\n";
  block += "• If the results do not contain enough information, state what is known and what is uncertain.\n";
  block += "• Dates are shown where available — prefer more recent sources for time-sensitive topics.\n";

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
      const combinedText = plan.topic + " " + branch.name + " " + (branch.possibilities || []).join(" ");
      const needsSearch = needsInternetAccess(combinedText);
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
    const synthText = plan.topic + " synthesis overview key trends current state recent developments";
    const topicNeedsSearch = needsInternetAccess(synthText);
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
  const { topic, agents, rounds, webContext } = req.body;
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

        const webDataSection = webSection
          ? `\nUse the following current web data to support your arguments where applicable:\n${webSection}`
          : "";

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
${webDataSection}
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
${webDataSection}
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

// ══════════════════════════════════════════════════════════════
//  ☁️ GOOGLE DRIVE API PROXY ROUTES
//  Each accepts { accessToken, ...params } and proxies to
//  Google Drive API v3. The access token is obtained via
//  Firebase GoogleAuthProvider with drive.file scope.
// ══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
//  Helper: universal Drive API proxy call
// ─────────────────────────────────────────────────────────────
async function driveApiCall(req, res) {
  const { accessToken, method = "GET", path, params = {} } = req.body;
  if (!accessToken) return res.status(400).json({ error: "accessToken required" });
  if (!path) return res.status(400).json({ error: "path required" });

  try {
    const queryString = Object.keys(params).length ? '?' + new URLSearchParams(params) : '';
    const url = `https://www.googleapis.com/drive/v3/${path.replace(/^\//, '')}${queryString}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(method === "GET" || method === "DELETE" ? {} : { "Content-Type": "application/json" })
      },
      body: (method === "GET" || method === "DELETE") ? undefined : JSON.stringify(req.body.body)
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || data.error || `Drive API error (${response.status})` });
    }
    res.json({ ...data, _status: response.status });
  } catch (err) {
    res.status(500).json({ error: "Drive API proxy failed: " + err.message });
  }
}

// ─────────────────────────────────────────────────────────────
//  POST /api/drive/list — list files & folders
//  Body: { accessToken, pageSize?, query?, pageToken? }
//  Proxies: GET /drive/v3/files
// ─────────────────────────────────────────────────────────────
app.post("/api/drive/list", async (req, res) => {
  const { accessToken, pageSize = 50, query, pageToken } = req.body;
  if (!accessToken) return res.status(400).json({ error: "accessToken required" });
  try {
    const params = new URLSearchParams({
      pageSize: String(pageSize),
      fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,parents,createdTime,fileExtension,iconLink,thumbnailLink),nextPageToken"
    });
    if (query) params.set("q", query);
    if (pageToken) params.set("pageToken", pageToken);
    params.set("supportsAllDrives", "true");
    params.set("includeItemsFromAllDrives", "true");
    if (!query) params.set("q", "trashed=false");
    const url = `https://www.googleapis.com/drive/v3/files?${params}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "Drive list failed" });
    res.json({ files: data.files || [], nextPageToken: data.nextPageToken || null });
  } catch (err) {
    res.status(500).json({ error: "Drive list failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/drive/read — read file content (text/plain)
//  Body: { accessToken, fileId }
//  Proxies: GET /drive/v3/files/{fileId}?alt=media
// ─────────────────────────────────────────────────────────────
app.post("/api/drive/read", async (req, res) => {
  const { accessToken, fileId } = req.body;
  if (!accessToken || !fileId) return res.status(400).json({ error: "accessToken and fileId required" });
  try {
    // First get file metadata to know mime type (supportsAllDrives allows shared files)
    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,size,fileExtension&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const meta = await metaRes.json();
    if (!metaRes.ok) return res.status(metaRes.status).json({ error: meta.error?.message || "Drive metadata fetch failed" });

    // If it's a Google Workspace doc, use export
    if (meta.mimeType?.startsWith("application/vnd.google-apps")) {
      const exportMime = meta.mimeType === "application/vnd.google-apps.document" ? "text/plain"
        : meta.mimeType === "application/vnd.google-apps.spreadsheet" ? "text/csv"
        : meta.mimeType === "application/vnd.google-apps.presentation" ? "text/plain"
        : "text/plain";
      const exportRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const content = await exportRes.text();
      return res.json({ name: meta.name, mimeType: meta.mimeType, content });
    }

    // Regular file — download
    const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const contentType = dlRes.headers.get("content-type") || "";
    if (contentType.startsWith("text") || contentType.includes("json") || contentType.includes("javascript")) {
      const content = await dlRes.text();
      return res.json({ name: meta.name, mimeType: meta.mimeType, content });
    }
    // Binary — return as base64
    const buffer = await dlRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    res.json({ name: meta.name, mimeType: meta.mimeType, contentBase64: base64, encoding: "base64", contentType });
  } catch (err) {
    res.status(500).json({ error: "Drive read failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/drive/write — create or update a file
//  Body: { accessToken, name, content, mimeType?, parentId?, fileId?, contentBase64?, encoding? }
//  If encoding === "base64", contentBase64 is decoded to binary and uploaded.
//  If fileId is provided → PATCH (update); otherwise → POST (create)
// ─────────────────────────────────────────────────────────────
app.post("/api/drive/write", async (req, res) => {
  const { accessToken, name, content, mimeType = "text/plain", parentId, fileId, contentBase64, encoding } = req.body;
  if (!accessToken || !name) {
    return res.status(400).json({ error: "accessToken and name required" });
  }
  if (content === undefined && !contentBase64) {
    return res.status(400).json({ error: "content or contentBase64 required" });
  }
  try {
    const boundary = "nexus_drive_boundary";
    const metadata = { name, mimeType };
    if (parentId) metadata.parents = [parentId];

    // Build multipart body parts
    const metaPart = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      "utf-8"
    );
    const contentPart = encoding === "base64" && contentBase64
      ? Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, "utf-8"),
          Buffer.from(contentBase64, "base64"),
          Buffer.from("\r\n", "utf-8")
        ])
      : Buffer.from(
          `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content || ""}\r\n`,
          "utf-8"
        );
    const endPart = Buffer.from(`--${boundary}--`, "utf-8");
    const body = Buffer.concat([metaPart, contentPart, endPart]);

    const fieldsParam = "&fields=id%2Cname%2CmimeType%2CwebViewLink%2Csize";
    const url = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&supportsAllDrives=true${fieldsParam}`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart${fieldsParam}`;

    const method = fileId ? "PATCH" : "POST";
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "Drive write failed" });
    res.json({ file: { id: data.id, name: data.name, mimeType: data.mimeType, webViewLink: data.webViewLink } });
  } catch (err) {
    res.status(500).json({ error: "Drive write failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/drive/delete — delete a file or folder
//  Body: { accessToken, fileId }
// ─────────────────────────────────────────────────────────────
app.post("/api/drive/delete", async (req, res) => {
  const { accessToken, fileId } = req.body;
  if (!accessToken || !fileId) return res.status(400).json({ error: "accessToken and fileId required" });
  try {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: data.error?.message || "Drive delete failed" });
    }
    res.json({ success: true, fileId });
  } catch (err) {
    res.status(500).json({ error: "Drive delete failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/drive/search — full-text search in Drive
//  Body: { accessToken, query, pageSize? }
// ─────────────────────────────────────────────────────────────
app.post("/api/drive/search", async (req, res) => {
  const { accessToken, query, pageSize = 20 } = req.body;
  if (!accessToken || !query) return res.status(400).json({ error: "accessToken and query required" });
  try {
    // Escape single quotes by doubling them (Google Drive API escaping)
    const esc = (s) => s.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
    const params = new URLSearchParams({
      q: `(name contains '${esc(query)}' or fullText contains '${esc(query)}') and trashed=false`,
      pageSize: String(pageSize),
      fields: "files(id,name,mimeType,size,modifiedTime,webViewLink)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true"
    });
    const url = `https://www.googleapis.com/drive/v3/files?${params}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "Drive search failed" });
    res.json({ files: data.files || [] });
  } catch (err) {
    res.status(500).json({ error: "Drive search failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/drive/mkdir — create a folder
//  Body: { accessToken, name, parentId? }
// ─────────────────────────────────────────────────────────────
app.post("/api/drive/mkdir", async (req, res) => {
  const { accessToken, name, parentId } = req.body;
  if (!accessToken || !name) return res.status(400).json({ error: "accessToken and name required" });
  try {
    const metadata = { name, mimeType: "application/vnd.google-apps.folder" };
    if (parentId) metadata.parents = [parentId];
    const response = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(metadata)
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "Drive mkdir failed" });
    res.json({ file: { id: data.id, name: data.name, mimeType: data.mimeType } });
  } catch (err) {
    res.status(500).json({ error: "Drive mkdir failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/drive/move — move/rename a file
//  Body: { accessToken, fileId, newName?, parentId?, removeParentId? }
// ─────────────────────────────────────────────────────────────
app.post("/api/drive/move", async (req, res) => {
  const { accessToken, fileId, newName, addParents, removeParents } = req.body;
  if (!accessToken || !fileId) return res.status(400).json({ error: "accessToken and fileId required" });
  try {
    const params = new URLSearchParams();
    params.set("supportsAllDrives", "true");
    if (addParents) params.set("addParents", addParents);
    if (removeParents) params.set("removeParents", removeParents);
    const body = {};
    if (newName) body.name = newName;
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?${params}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "Drive move failed" });
    res.json({ file: { id: data.id, name: data.name, mimeType: data.mimeType } });
  } catch (err) {
    res.status(500).json({ error: "Drive move failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/drive/markdown — create a well-formatted Markdown file
//  Body: { accessToken, name, content, frontmatter?, parentId? }
//  - Automatically appends .md extension
//  - Optionally prepends YAML frontmatter (object with title, date, author, tags, etc.)
//  - Returns file ID, name, and webViewLink for immediate access
// ─────────────────────────────────────────────────────────────
app.post("/api/drive/markdown", async (req, res) => {
  const { accessToken, name, content, frontmatter, parentId } = req.body;
  if (!accessToken || !name) return res.status(400).json({ error: "accessToken and name required" });
  if (!content) return res.status(400).json({ error: "content required" });

  // Ensure .md extension
  const fileName = name.endsWith(".md") ? name : name + ".md";

  try {
    // Build final content with optional frontmatter
    let finalContent = "";
    if (frontmatter && typeof frontmatter === "object") {
      const fmLines = ["---"];
      for (const [key, val] of Object.entries(frontmatter)) {
        const strVal = typeof val === "object" ? JSON.stringify(val) : String(val);
        fmLines.push(`${key}: ${strVal}`);
      }
      fmLines.push("---\n\n");
      finalContent = fmLines.join("\n") + content;
    } else {
      finalContent = content;
    }

    const boundary = "nexus_md_boundary";
    const metadata = { name: fileName, mimeType: "text/markdown" };
    if (parentId) metadata.parents = [parentId];

    const metaPart = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      "utf-8"
    );
    const contentPart = Buffer.from(
      `--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${finalContent}\r\n`,
      "utf-8"
    );
    const endPart = Buffer.from(`--${boundary}--`, "utf-8");
    const body = Buffer.concat([metaPart, contentPart, endPart]);

    const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id%2Cname%2CmimeType%2CwebViewLink%2Csize";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "Drive markdown create failed" });
    res.json({
      file: {
        id: data.id,
        name: data.name,
        mimeType: "text/markdown",
        webViewLink: data.webViewLink
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Drive markdown create failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/drive/copy — copy a file
//  Body: { accessToken, fileId, name?, parentId? }
// ─────────────────────────────────────────────────────────────
app.post("/api/drive/copy", async (req, res) => {
  const { accessToken, fileId, name, parentId } = req.body;
  if (!accessToken || !fileId) return res.status(400).json({ error: "accessToken and fileId required" });
  try {
    const body = {};
    if (name) body.name = name;
    if (parentId) body.parents = [parentId];
    const params = new URLSearchParams({ supportsAllDrives: "true" });
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/copy?${params}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "Drive copy failed" });
    res.json({ file: { id: data.id, name: data.name, mimeType: data.mimeType, webViewLink: data.webViewLink } });
  } catch (err) {
    res.status(500).json({ error: "Drive copy failed: " + err.message });
  }
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
    process.env.NVIDIA_KEY_KIMI    ? "✅ Kimi K2.6"     : "❌ Kimi K2.6",
    process.env.NVIDIA_KEY_GEMMA4  ? "✅ Gemma 4 31B IT" : "❌ Gemma 4 31B IT",
    process.env.GEMINI_API_KEY     ? "✅ Gemini"       : "❌ Gemini",
    process.env.MISTRAL_API_KEY    ? "✅ Mistral"      : "❌ Mistral",
    process.env.GROQ_API_KEY       ? "✅ Groq + 🧠 Memory" : "❌ Groq / Memory",
    process.env.COHERE_API_KEY     ? "✅ Cohere"       : "❌ Cohere",
    process.env.TAVILY_API_KEY     ? "✅ Tavily Search" : "⚠️  Tavily (DDG fallback active)",
  ].join(" | ")}`);
});
