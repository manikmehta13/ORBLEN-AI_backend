// ── SSE Streaming Helpers ─────────────────────────────────────────────────────
// Provides a reusable function for streaming tokens from any OpenAI-compatible
// API endpoint (Groq, Mistral, Codestral) via Server-Sent Events.

/**
 * Streams tokens from an OpenAI-compatible SSE endpoint and forwards each
 * token to the client via `sendEvent`. Returns the full accumulated response
 * text when the stream ends.
 *
 * @param {import('http').ServerResponse} res     - Express response (unused directly here, kept for signature parity)
 * @param {string}                        url     - API endpoint URL
 * @param {Record<string,string>}         headers - Request headers (Authorization, Content-Type)
 * @param {object}                        body    - Request body (model, messages, max_tokens, etc.)
 * @param {(data: object) => void}        sendEvent - SSE emit function
 * @returns {Promise<string>} Full response text
 */
async function streamOpenAICompatibleTokens(res, url, headers, body, sendEvent) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, stream: true }),
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
      } catch {
        /* skip malformed chunks */
      }
    }
  }

  return fullText;
}

module.exports = { streamOpenAICompatibleTokens };
