// ╔══════════════════════════════════════════════════════════╗
// ║         NEXUS AI — Secure Backend Server                 ║
// ║   All API keys live HERE — never in the frontend         ║
// ╚══════════════════════════════════════════════════════════╝

const express = require("express");
const cors = require("cors");
require("dotenv").config();

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
//     stream: false is REQUIRED — some models default to SSE
//     streaming which breaks JSON.parse on the client.
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
        stream: false          // ← critical: prevents SSE / NDJSON responses
      })
    });

    // Guard: NVIDIA sometimes returns non-JSON on error (e.g. 429 HTML pages)
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
//  🤖 ROUTE 1: OpenAI GPT-OSS-20b  ← via NVIDIA NIM (FREE)
// ══════════════════════════════════════════════════════════════
app.post("/api/openai", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages required" });
  await callNvidiaModel("openai/gpt-oss-20b", process.env.NVIDIA_KEY_GPTOSS, messages, res);
});

// ══════════════════════════════════════════════════════════════
//  🤖 ROUTE 2: Anthropic (Claude)
//     ✦ Updated: extracts system message → top-level param
//       so memory context is passed correctly to Claude's API
// ══════════════════════════════════════════════════════════════
app.post("/api/claude", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages required" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "Claude key not configured on server." });
  }

  // Claude requires system content as a top-level parameter, not a role in messages
  const systemMsg = messages.find(m => m.role === "system");
  const filteredMessages = messages.filter(m => m.role !== "system");

  try {
    const body = {
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1500,
      messages: filteredMessages
    };
    if (systemMsg?.content) body.system = systemMsg.content;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json({ result: data.content[0].text });
  } catch (err) {
    res.status(500).json({ error: "Claude request failed: " + err.message });
  }
});

// ══════════════════════════════════════════════════════════════
//  🤖 ROUTE 3: Google (Gemini)
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
//  🤖 ROUTE 4: Mistral AI
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
//  🤖 ROUTE 5: Groq (LLaMA 3.3)
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
//  🤖 ROUTE 6: Cohere
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
//  🆕 ROUTE 7: Meta LLaMA 3.3 70B — via NVIDIA NIM (FREE)
// ══════════════════════════════════════════════════════════════
app.post("/api/nvidia-llama", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages required" });
  await callNvidiaModel("meta/llama-3.3-70b-instruct", process.env.NVIDIA_KEY_LLAMA, messages, res);
});

// ══════════════════════════════════════════════════════════════
//  🆕 ROUTE 8: Mistral Mixtral 8x7B — via NVIDIA NIM (FREE)
// ══════════════════════════════════════════════════════════════
app.post("/api/nvidia-mixtral", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages required" });
  await callNvidiaModel("mistralai/mixtral-8x7b-instruct", process.env.NVIDIA_KEY_MIXTRAL, messages, res);
});

// ══════════════════════════════════════════════════════════════
//  🆕 ROUTE 9: Google Gemma 2 2B — via NVIDIA NIM (FREE)
// ══════════════════════════════════════════════════════════════
app.post("/api/nvidia-gemma", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages required" });
  await callNvidiaModel("google/gemma-2-2b-it", process.env.NVIDIA_KEY_GEMMA, messages, res);
});

// ══════════════════════════════════════════════════════════════
//  ✨ ROUTE 10: Prompt Enhancer — uses Groq (FREE), fallback NVIDIA
// ══════════════════════════════════════════════════════════════
app.post("/api/enhance", async (req, res) => {
  const { prompt, targetAgent } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  const systemPrompt = `
You are an elite prompt optimization system.

Your ONLY task is to rewrite user input into a better prompt for another AI.

CRITICAL RULE:
The output must ALWAYS represent the USER speaking TO the AI.
Never write from the AI's perspective.

The rewritten prompt must preserve the original interaction type:
- Questions must remain questions
- Requests must remain requests
- Commands must remain commands
- Instructions must remain instructions

NEVER transform the input into:
- An assistant reply
- A chatbot response
- A clarification message
- A conversational response
- A meta message

You are NOT the assistant solving the task.
You are ONLY rewriting the user's input.

Never:
- Answer the prompt
- Continue the conversation
- Ask follow-up questions
- Explain anything
- Add conversational filler

Always:
- Preserve intent exactly
- Improve clarity and specificity
- Improve structure and formatting
- Remove ambiguity
- Keep all important constraints
- Optimize for ${targetAgent || "an advanced AI assistant"}

If the prompt is vague, improve it using the most likely intent without changing meaning.

Return ONLY the rewritten prompt.
No labels.
No explanations.
No markdown.
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

  // Fallback: NVIDIA NIM (gpt-oss-20b) — also free
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
//  🧠 ROUTE 11: Memory Extraction — uses Groq LLaMA (FREE)
//
//  Analyzes the last few conversation turns and extracts
//  0–3 memorable, reusable facts about the user.
//  Returns [] on any failure so frontend degrades gracefully.
// ══════════════════════════════════════════════════════════════
app.post("/api/extract-memory", async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) return res.json({ memories: [] });

  // Memory extraction requires Groq (free). No key → skip silently.
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
    // Only look at the last 4 messages (2 exchanges), filter out system role
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
        temperature: 0.1   // Low temp for consistent, factual extraction
      })
    });

    const data = await response.json();
    let rawText = data.choices?.[0]?.message?.content?.trim() || "[]";

    // Robustly parse JSON even if wrapped in markdown or prose
    let memories = [];
    try {
      // Strip markdown code fences if present
      rawText = rawText.replace(/```(?:json)?\n?/g, "").replace(/```\n?/g, "").trim();
      // Extract first JSON array if there's surrounding text
      const match = rawText.match(/\[[\s\S]*\]/);
      if (match) rawText = match[0];
      memories = JSON.parse(rawText);
      if (!Array.isArray(memories)) memories = [];
      // Validate each memory object
      memories = memories
        .filter(m => m && typeof m.content === "string" && m.content.trim().length > 0)
        .slice(0, 3); // Hard cap: 3 per extraction call
    } catch {
      memories = []; // Parse failure → return empty gracefully
    }

    res.json({ memories });
  } catch (err) {
    // Network error, quota exceeded, etc. — always return empty, never error the client
    res.json({ memories: [] });
  }
});

// ── Start server ──
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 NEXUS AI Backend running on port ${PORT}`);
  console.log(`   Keys loaded: ${[
    process.env.NVIDIA_KEY_GPTOSS  ? "✅ GPT-OSS-20B" : "❌ GPT-OSS-20B",
    process.env.NVIDIA_KEY_LLAMA   ? "✅ LLaMA 3.3"   : "❌ LLaMA 3.3",
    process.env.NVIDIA_KEY_MIXTRAL ? "✅ Mixtral 8x7B" : "❌ Mixtral 8x7B",
    process.env.NVIDIA_KEY_GEMMA   ? "✅ Gemma 2 2B"  : "❌ Gemma 2 2B",
    process.env.ANTHROPIC_API_KEY  ? "✅ Claude"       : "❌ Claude",
    process.env.GEMINI_API_KEY     ? "✅ Gemini"       : "❌ Gemini",
    process.env.MISTRAL_API_KEY    ? "✅ Mistral"      : "❌ Mistral",
    process.env.GROQ_API_KEY       ? "✅ Groq + 🧠 Memory" : "❌ Groq / Memory",
    process.env.COHERE_API_KEY     ? "✅ Cohere"       : "❌ Cohere",
  ].join(" | ")}`);
});
