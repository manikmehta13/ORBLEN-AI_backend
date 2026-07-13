// ── Model Backend Caller ──────────────────────────────────────────────────────
// Provides a unified async function that dispatches a chat request to the
// correct AI provider (Gemini, Groq, Mistral, Codestral) based on the agent key
// and returns the full text response. Used in non-streaming contexts.

const { isGroqAgent, GROQ_MODEL_MAP, getGroqMaxTokens } = require("./constants");

/**
 * Calls the appropriate AI provider for the given agent and messages array.
 * Returns the full text response string.
 *
 * @param {string}                                agent    - Agent key (e.g. "gemini", "groq", "mistral")
 * @param {Array<{role: string, content: string}>} messages - Conversation history
 * @returns {Promise<string>}
 */
async function callModelBackend(agent, messages) {
  // ── Gemini ──────────────────────────────────────────────────────────────────
  if (agent === "gemini") {
    if (!process.env.GEMINI_API_KEY) throw new Error("Gemini key not configured.");

    const prompt = messages[messages.length - 1].content;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.candidates[0].content.parts[0].text;
  }

  // ── Groq (LLaMA / GPT-OSS family) ───────────────────────────────────────────
  if (isGroqAgent(agent)) {
    if (!process.env.GROQ_API_KEY) throw new Error("Groq key not configured.");

    const groqModel = GROQ_MODEL_MAP[agent];
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: groqModel,
        messages,
        max_tokens: getGroqMaxTokens(agent),
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  }

  // ── Mistral Large ───────────────────────────────────────────────────────────
  if (agent === "mistral") {
    if (!process.env.MISTRAL_API_KEY) throw new Error("Mistral key not configured.");

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-large-latest",
        messages,
        max_tokens: 16384,
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  }

  // ── Codestral ───────────────────────────────────────────────────────────────
  if (agent === "codestral") {
    if (!process.env.CODESTRAL_API_KEY) throw new Error("Codestral key not configured.");

    const response = await fetch("https://codestral.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CODESTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "codestral-latest",
        messages,
        max_tokens: 16384,
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  }

  throw new Error("Invalid agent selected.");
}

module.exports = { callModelBackend };
