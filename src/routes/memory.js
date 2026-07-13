// ── Memory Routes ─────────────────────────────────────────────────────────────
// POST /api/extract-memory — Groq-powered fact extraction from a conversation

const { Router } = require("express");

const router = Router();

/**
 * POST /api/extract-memory
 * Body: { messages: Array<{role, content}> }
 * Returns: { memories: Array<{content, category}> }
 *
 * Uses Groq LLaMA to extract 0–3 reusable facts about the user from the
 * most recent conversation messages. Returns an empty array on failure.
 */
router.post("/extract-memory", async (req, res) => {
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
      .filter((m) => m.role !== "system")
      .slice(-4)
      .map(
        (m) =>
          `${m.role === "user" ? "USER" : "AI"}: ${String(m.content || "").slice(0, 500)}`
      )
      .join("\n\n");

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
          {
            role: "user",
            content: `Extract memorable user facts from this conversation:\n\n${convText}`,
          },
        ],
        max_tokens: 400,
        temperature: 0.1,
      }),
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
        .filter((m) => m && typeof m.content === "string" && m.content.trim().length > 0)
        .slice(0, 3);
    } catch {
      memories = [];
    }

    res.json({ memories });
  } catch {
    res.json({ memories: [] });
  }
});

module.exports = router;
