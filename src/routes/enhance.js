// ── Prompt Enhancement Route ──────────────────────────────────────────────────
// POST /api/enhance — rewrites a raw prompt for clarity and specificity using
// an LLM (Groq primary; falls back to returning the original prompt unchanged).

const { Router } = require("express");

const router = Router();

/** System prompt used by the prompt optimizer. Preserved verbatim. */
const ENHANCE_SYSTEM_PROMPT = `You are an elite AI prompt optimization system.

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
- No labels, no explanations, no markdown, no quotation marks, no code fences
- No extra text before or after the prompt`;

/**
 * POST /api/enhance
 * Body: { prompt: string, targetAgent?: string }
 * Returns: { result: string }
 */
router.post("/enhance", async (req, res) => {
  const { prompt, targetAgent } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  const systemPrompt =
    ENHANCE_SYSTEM_PROMPT +
    `\n- Optimize for ${targetAgent || "an advanced AI assistant"}`;

  // Primary: Groq (fast, free)
  if (process.env.GROQ_API_KEY) {
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
            { role: "user", content: prompt },
          ],
          max_tokens: 500,
          temperature: 0.3,
        }),
      });

      const data = await response.json();
      const enhanced = data.choices?.[0]?.message?.content || prompt;
      return res.json({ result: enhanced });
    } catch {
      /* fall through to plain-text fallback */
    }
  }

  // Last resort: return the original prompt unchanged
  res.json({ result: prompt });
});

module.exports = router;
