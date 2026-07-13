// ── Agentic Search Service ────────────────────────────────────────────────────
// Wraps fetchWebContextForBranch with an LLM-based sufficiency evaluator:
// if the first pass of results is insufficient, a second refined query is run
// automatically before returning.

const { fetchWebContextForBranch } = require("./webSearch");
const { callModelBackend } = require("../models/callModel");

/**
 * Performs a two-pass agentic web search:
 *   1. Fetch results for `query`.
 *   2. Ask the LLM whether the results are sufficient.
 *   3. If not, refine the query and merge secondary results.
 *
 * @param {string}                  agent      - Agent key used for the sufficiency evaluation step
 * @param {string}                  query      - Initial search query
 * @param {((data: object) => void)} [sendEvent] - Optional SSE emit function for status updates
 * @returns {Promise<object|null>}  webContext object or null
 */
async function executeAgenticSearch(agent, query, sendEvent = null) {
  if (sendEvent) {
    sendEvent({ type: "status", message: `🔍 Initiating search for: "${query.slice(0, 40)}..."` });
  }

  const fakeBranch = { name: query, possibilities: [] };
  let webContext = await fetchWebContextForBranch(query, fakeBranch);

  if (!webContext) return null;

  // Ask the model whether the results are sufficient or if a refined query is needed
  const evalPrompt = `You are a research evaluator. 
I have performed a web search for the query: "${query}".
Here are the results:
${JSON.stringify((webContext.results || []).slice(0, 3).map((r) => ({ title: r.title, snippet: (r.snippet || "").slice(0, 200) })))}

Does this provide sufficient and accurate information to provide a deep, well-rounded response? 
If YES, output exactly the word "SUFFICIENT" and nothing else.
If NO, output EXACTLY ONE new, improved search query to find the missing information (just the query string, no quotes).`;

  if (sendEvent) sendEvent({ type: "status", message: "🤔 Evaluating search sufficiency..." });

  try {
    const evalResponse = await callModelBackend(agent, [{ role: "user", content: evalPrompt }]);
    const evalText = evalResponse.trim();

    if (evalText !== "SUFFICIENT") {
      if (sendEvent) {
        sendEvent({ type: "status", message: `🔄 Refining search: "${evalText.slice(0, 40)}..."` });
      }
      const secondaryBranch = { name: evalText, possibilities: [] };
      const secondaryContext = await fetchWebContextForBranch(evalText, secondaryBranch);

      if (secondaryContext && secondaryContext.results) {
        webContext.results = [...webContext.results, ...secondaryContext.results].slice(0, 10);
        webContext.query += " | " + secondaryContext.query;
      }
    }
  } catch (err) {
    console.error("Agentic search evaluation failed:", err.message);
  }

  return webContext;
}

module.exports = { executeAgenticSearch };
