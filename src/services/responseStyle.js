// ── Response Style Injection ──────────────────────────────────────────────────
// Utilities for ensuring every request includes the project-wide response style
// instruction, whether the payload uses a flat prompt string or a messages array.

const { RESPONSE_STYLE_INSTRUCTION } = require("../models/constants");

/**
 * Returns true if the response style instruction is already present in the
 * messages array (avoids double-injection).
 * @param {Array<{role: string, content: string}>} messages
 * @returns {boolean}
 */
function hasResponseStyleInstruction(messages) {
  return messages.some(
    (m) =>
      typeof m.content === "string" &&
      m.content.includes("Default to short, concise, direct answers")
  );
}

/**
 * Prepends or appends the response style instruction to a messages array.
 * If a system message already exists it is extended; otherwise a new system
 * message is inserted at the front.
 * Returns the original array unchanged if the instruction is already present.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Array<{role: string, content: string}>}
 */
function addResponseStyleInstructionToMessages(messages) {
  if (!Array.isArray(messages) || hasResponseStyleInstruction(messages)) {
    return messages;
  }

  if (messages[0]?.role === "system") {
    return [
      {
        ...messages[0],
        content: `${messages[0].content}\n\n${RESPONSE_STYLE_INSTRUCTION}`,
      },
      ...messages.slice(1),
    ];
  }

  return [{ role: "system", content: RESPONSE_STYLE_INSTRUCTION }, ...messages];
}

/**
 * Prepends the response style instruction to a plain prompt string.
 * Returns the prompt unchanged if the instruction is already present.
 * @param {string} prompt
 * @returns {string}
 */
function addResponseStyleInstructionToPrompt(prompt) {
  if (
    typeof prompt !== "string" ||
    prompt.includes("Default to short, concise, direct answers")
  ) {
    return prompt;
  }
  return `[Response Style Instruction: ${RESPONSE_STYLE_INSTRUCTION}]\n\n${prompt}`;
}

module.exports = {
  addResponseStyleInstructionToMessages,
  addResponseStyleInstructionToPrompt,
};
