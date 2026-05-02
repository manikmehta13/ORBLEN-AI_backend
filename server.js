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
// ══════════════════════════════════════════════════════════════
app.post("/api/claude", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages required" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "Claude key not configured on server." });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1500,
        messages
      })
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

  const systemPrompt = `You are an expert prompt engineer. Rewrite the user's prompt to be clearer, more specific, well-structured, and optimized for ${targetAgent || "an AI assistant"}.
Rules:
- Preserve the original intent 100%
- Add context, structure, and clarity  
- Remove ambiguity
- Return ONLY the enhanced prompt, nothing else. No preamble.`;

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
    process.env.GROQ_API_KEY       ? "✅ Groq"         : "❌ Groq",
    process.env.COHERE_API_KEY     ? "✅ Cohere"       : "❌ Cohere",
  ].join(" | ")}`);
});
