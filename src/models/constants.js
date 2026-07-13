// ── Model Constants & Helpers ─────────────────────────────────────────────────
// Central registry of agent names, model IDs, token limits, and utility helpers
// for selecting and falling back between AI providers.

/** Human-readable display names for each backend agent key. */
const BACKEND_AGENT_NAMES = {
  gemini: "Gemini Flash",
  mistral: "Mistral Large",
  codestral: "Codestral",
  groq: "LLaMA 3.3 70B",
  "groq-llama-8b": "LLaMA 3.1 8B",
  "groq-gpt-120b": "GPT-OSS 120B",
  "groq-gpt-20b": "GPT-OSS 20B",
};

/** Maps Groq-hosted agent keys to their Groq model IDs. */
const GROQ_MODEL_MAP = {
  groq: "llama-3.3-70b-versatile",
  "groq-llama-8b": "llama-3.1-8b-instant",
  "groq-gpt-120b": "openai/gpt-oss-120b",
  "groq-gpt-20b": "openai/gpt-oss-20b",
};

/**
 * Instruction injected into every request to keep responses concise by default.
 * Used by addResponseStyleInstruction* helpers.
 */
const RESPONSE_STYLE_INSTRUCTION =
  "Default to short, concise, direct answers. Expand only when complexity or detail is required. Avoid filler and repetition.";

/**
 * Returns true if the agent is hosted on Groq (shares the GROQ_API_KEY).
 * @param {string} agent
 * @returns {boolean}
 */
function isGroqAgent(agent) {
  return Object.prototype.hasOwnProperty.call(GROQ_MODEL_MAP, agent);
}

/**
 * Returns the max_tokens value appropriate for a Groq-hosted model.
 * @param {string} agent
 * @returns {number}
 */
function getGroqMaxTokens(agent) {
  if (agent === "groq-gpt-20b" || agent === "groq-llama-8b") return 1024;
  if (agent === "groq") return 8192;
  return 2048;
}

/**
 * Returns the human-readable display name for an agent key.
 * @param {string} agent
 * @returns {string}
 */
function getBackendAgentName(agent) {
  return BACKEND_AGENT_NAMES[agent] || "AI Agent";
}

/**
 * Resolves the agent to use, with automatic fallback when an API key is missing.
 * Returns { agent, fallback, original } where fallback is true if a substitute
 * was chosen.
 * @param {string} requestedAgent
 * @returns {{ agent: string, fallback: boolean, original?: string }}
 */
function getActiveAgent(requestedAgent) {
  const groqKey = process.env.GROQ_API_KEY;

  if (isGroqAgent(requestedAgent)) {
    if (groqKey) return { agent: requestedAgent, fallback: false };
    // fall through to try other providers
  }

  const keys = {
    gemini: process.env.GEMINI_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
    codestral: process.env.CODESTRAL_API_KEY,
    groq: groqKey,
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

module.exports = {
  BACKEND_AGENT_NAMES,
  GROQ_MODEL_MAP,
  RESPONSE_STYLE_INSTRUCTION,
  isGroqAgent,
  getGroqMaxTokens,
  getBackendAgentName,
  getActiveAgent,
};
