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
//  🧠 ROUTE 8: Memory Extraction — uses Groq LLaMA (FREE)
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

// ══════════════════════════════════════════════════════════════
//  🔬 DEEP RESEARCH MODE ENGINE
// ══════════════════════════════════════════════════════════════

const BACKEND_AGENT_NAMES = {
  openai: "GPT-OSS 20B (NIM)",
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

  // Fallback order:
  const fallbackOrder = ["gemini", "groq", "nvidia-llama", "openai", "mistral", "cohere"];
  for (const agent of fallbackOrder) {
    if (keys[agent]) {
      return { agent, fallback: true, original: requestedAgent };
    }
  }

  // Return requested as default if absolutely nothing is loaded (degrades gracefully to normal route errors)
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
    return await callNvidiaModelBackend("openai/gpt-oss-20b", process.env.NVIDIA_KEY_GPTOSS, messages);
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

async function expandBranchWithCoT(agent, topic, branch) {
  const prompt = `You are an expert researcher. Conduct a deep-dive analysis on the research branch "${branch.name}" for the main research topic "${topic}".
Focus specifically on these key possibilities: ${branch.possibilities.join(", ")}.

Apply step-by-step analytical reasoning. Analyze technical feasibility, global impacts, socio-economic challenges, and key trade-offs.

Write out your step-by-step reasoning explicitly. Begin with a section titled "### Detailed Reasoning" where you walk through your logic step by step, followed by "### Key Findings & Analytical Synthesis" where you summarize your final discoveries.`;

  const messages = [
    { role: "user", content: prompt }
  ];

  return await callModelBackend(agent, messages);
}

async function synthesizeFindings(agent, topic, branchAnalyses) {
  const branchText = Object.entries(branchAnalyses)
    .map(([branchName, analysis]) => `## Branch: ${branchName}\n\n${analysis}`)
    .join("\n\n");

  const prompt = `You are an elite research synthesizer. Combine the following individual branch findings regarding the topic "${topic}" into a coherent, high-level strategic synthesis:

${branchText}

Identify key patterns, unexpected connections, global trade-offs, and construct a strategic future roadmap. Output a comprehensive, logical synthesis.`;

  const messages = [
    { role: "user", content: prompt }
  ];

  return await callModelBackend(agent, messages);
}

function formatResearchDocument(plan, branchAnalyses, synthesis) {
  let doc = `# 🔬 Research Report: ${plan.topic}\n\n`;
  doc += `## 📋 Table of Contents\n`;
  doc += `1. [Research Map Structure](#-research-map-structure)\n`;
  doc += `2. [Executive Summary](#-executive-summary)\n`;
  plan.branches.forEach((b, i) => {
    doc += `3.${i + 1} [Branch: ${b.name}](#branch-${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")})\n`;
  });
  doc += `3. [Cross-Branch Strategic Synthesis](#-cross-branch-strategic-synthesis)\n`;
  doc += `4. [Actionable Recommendations & Next Steps](#-actionable-recommendations--next-steps)\n\n`;

  doc += `## 🌲 Research Map Structure\n`;
  doc += `\`\`\`text\n${generateUnicodeTree(plan)}\`\`\`\n\n`;

  doc += `## 📋 Executive Summary\n`;
  doc += `This comprehensive research document explores **${plan.topic}** across multiple analytical dimensions. By mapping a structured research map, conducting parallel deep-dives using step-by-step analytical reasoning, and synthesizing cross-branch discoveries, this report offers key trade-offs and strategic guidance.\n\n`;

  doc += `## 🔍 Detailed Branch Analyses\n\n`;
  plan.branches.forEach((b) => {
    doc += `### Branch: ${b.name}\n`;
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

    sendEvent({ type: "status", message: `Initiating concurrent branch analyses for ${plan.branches.length} pathways...` });

    const branchAnalyses = {};
    const branchPromises = plan.branches.map(async (branch) => {
      sendEvent({ type: "branch_start", branch: branch.name });
      try {
        const analysis = await expandBranchWithCoT(resolvedAgent, plan.topic, branch);
        branchAnalyses[branch.name] = analysis;
        sendEvent({ type: "branch_end", branch: branch.name, analysis });
      } catch (err) {
        console.error(`Branch ${branch.name} expansion failed:`, err);
        const failMsg = `### Branch Analysis Failed\nAn error occurred while expanding this branch: ${err.message}`;
        branchAnalyses[branch.name] = failMsg;
        sendEvent({ type: "branch_end", branch: branch.name, analysis: failMsg });
      }
    });

    await Promise.all(branchPromises);

    sendEvent({ type: "status", message: "Synthesizing branch findings..." });
    let synthesis;
    try {
      synthesis = await synthesizeFindings(resolvedAgent, plan.topic, branchAnalyses);
    } catch (err) {
      console.error("Synthesis failed, using simple summary synthesis:", err);
      synthesis = "Cross-branch synthesis was limited due to an execution error during the synthesis phase. Detailed insights are available under each respective branch analysis above.";
    }

    sendEvent({ type: "status", message: "Assembling final research document..." });
    const finalReport = formatResearchDocument(plan, branchAnalyses, synthesis);

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
//  Helper: DuckDuckGo Search (FREE - No Key Needed)
// ─────────────────────────────────────────────────────────────
async function handleDuckDuckGoSearch(query) {
  try {
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&t=nexusai`
    );
    const data = await response.json();
    return (data.Results || []).slice(0, 8).map(r => ({
      title: r.Title,
      url: r.FirstURL,
      snippet: r.Text,
      source: "DuckDuckGo"
    }));
  } catch (err) {
    console.error("DuckDuckGo error:", err.message);
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

// ── Start server ──
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 NEXUS AI Backend running on port ${PORT}`);
  console.log(`   Keys loaded: ${[
    process.env.NVIDIA_KEY_GPTOSS  ? "✅ GPT-OSS-20B" : "❌ GPT-OSS-20B",
    process.env.NVIDIA_KEY_LLAMA   ? "✅ LLaMA 3.3"   : "❌ LLaMA 3.3",
    process.env.GEMINI_API_KEY     ? "✅ Gemini"       : "❌ Gemini",
    process.env.MISTRAL_API_KEY    ? "✅ Mistral"      : "❌ Mistral",
    process.env.GROQ_API_KEY       ? "✅ Groq + 🧠 Memory" : "❌ Groq / Memory",
    process.env.COHERE_API_KEY     ? "✅ Cohere"       : "❌ Cohere",
  ].join(" | ")}`);
});
