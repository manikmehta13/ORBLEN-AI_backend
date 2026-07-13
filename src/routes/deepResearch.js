// ── Deep Research Route ────────────────────────────────────────────────────────
// POST /api/deep-research
// Orchestrates a multi-branch research pipeline:
//   1. Generate a decision-tree research plan (LLM)
//   2. Fetch live web data per branch in parallel
//   3. Expand each branch with Chain-of-Thought analysis (LLM)
//   4. Synthesize all branches into a strategic overview (LLM)
//   5. Stream a formatted Markdown research report via SSE

const { Router } = require("express");
const { getActiveAgent, getBackendAgentName } = require("../models/constants");
const { callModelBackend } = require("../models/callModel");
const {
  buildBranchSearchQuery,
  fetchWebContextForBranch,
  formatWebContextForPrompt,
} = require("../services/webSearch");
const { executeAgenticSearch } = require("../services/agenticSearch");

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Renders a Unicode tree diagram of the research plan for the report header. */
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

/** Asks the LLM to build a structured research plan for a query. */
async function generateResearchPlan(agent, query) {
  const systemPrompt = `Generate a comprehensive, decision-tree style research plan for the query.
The plan MUST explore diverging paths, scenarios, or outcomes arising from the topic.
Output ONLY a valid JSON object with the following structure:
{
  "topic": "Brief topic name",
  "branches": [
    { "name": "Branch title (e.g., Scenario A / Path 1)", "possibilities": ["Sub-path 1", "Sub-path 2", "Sub-path 3", "Sub-path 4", "Sub-path 5"] }
  ]
}
Ensure there are 2 to 4 distinct main branches. Each main branch MUST have a minimum of 5 sub-branches.
Return ONLY the raw JSON object. Do not include markdown code fences or any prose.`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Query: "${query}"` },
  ];

  const responseText = await callModelBackend(agent, messages);

  let cleaned = responseText.trim().replace(/```(?:json)?\n?/gi, "").replace(/```\n?/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) cleaned = match[0];

  const plan = JSON.parse(cleaned);
  if (!plan.topic || !Array.isArray(plan.branches)) {
    throw new Error("Invalid plan structure received from model.");
  }
  return plan;
}

/** Returns a hardcoded fallback plan when the LLM plan generation fails. */
function getFallbackPlan(query) {
  return {
    topic: query.slice(0, 40) + "...",
    branches: [
      {
        name: "Scenario A: Direct Implementation & Success",
        possibilities: [
          "Ideal architecture setup",
          "Market dominance",
          "Scalability solutions",
          "Financial returns",
          "Ecosystem integration",
        ],
      },
      {
        name: "Scenario B: Alternative Pathways & Mitigation",
        possibilities: [
          "Pivot to new technologies",
          "Addressing adoption barriers",
          "Cost-saving architectures",
          "Niche market focus",
          "Gradual rollout strategies",
        ],
      },
    ],
  };
}

/**
 * Expands a single research branch using Chain-of-Thought reasoning,
 * optionally grounded with live web data.
 */
async function expandBranchWithCoT(agent, topic, branch, webContext = null) {
  const webSection = webContext ? formatWebContextForPrompt(webContext) : "";
  const webNote = webContext
    ? " Ground your analysis in the real-world web data provided above where relevant, citing specific facts."
    : " Draw on your training knowledge to provide the most accurate analysis possible.";

  const prompt = `You are an expert researcher. Conduct a deep-dive analysis on the research branch "${branch.name}" for the main research topic "${topic}".
Focus specifically on these key possibilities: ${branch.possibilities.join(", ")}.
${webSection}
Apply step-by-step analytical reasoning. Analyze past and current trends, predict future trends and situations based on this data. Evaluate technical feasibility, global impacts, socio-economic challenges, and key trade-offs.${webNote}

Write out your step-by-step reasoning explicitly. Begin with a section titled "### Detailed Reasoning" where you walk through your logic step by step, considering both historical context and future predictions.
Follow this with a section titled "### Key Findings & Analytical Synthesis". IMPORTANT: You MUST structure the final discoveries in this section using clear bullet points or numbered lists, keeping paragraphs short and highly structured.`;

  return await callModelBackend(agent, [{ role: "user", content: prompt }]);
}

/** Synthesizes all branch analyses into a cross-disciplinary strategic overview. */
async function synthesizeFindings(agent, topic, branchAnalyses, synthesisWebContext = null) {
  const branchText = Object.entries(branchAnalyses)
    .map(([branchName, analysis]) => `## Branch: ${branchName}\n\n${analysis}`)
    .join("\n\n");

  const webNote = synthesisWebContext ? formatWebContextForPrompt(synthesisWebContext) : "";

  const prompt = `You are an elite research synthesizer. Combine the following individual branch findings regarding the topic "${topic}" into a coherent, high-level strategic synthesis:

${branchText}
${webNote}
Analyze the past and current trends from the findings to predict future trends and situations. Based on these predictions, identify key patterns, unexpected connections, global trade-offs, and construct a detailed, step-by-step strategic future roadmap for the user.
IMPORTANT: You MUST structure your strategic synthesis thoroughly using bullet points, structured sections, and clear lists.`;

  return await callModelBackend(agent, [{ role: "user", content: prompt }]);
}

/** Assembles the final Markdown research document from all pipeline outputs. */
function formatResearchDocument(plan, branchAnalyses, synthesis, branchWebContexts = {}) {
  let doc = `# 🔬 Research Report: ${plan.topic}\n\n`;
  doc += `## 📋 Table of Contents\n`;
  doc += `1. [Research Map Structure](#-research-map-structure)\n`;
  doc += `2. [Executive Summary](#-executive-summary)\n`;
  plan.branches.forEach((b, i) => {
    doc += `3.${i + 1} [Branch: ${b.name}](#branch-${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")})\n`;
  });
  doc += `3. [Cross-Branch Predictive Analysis & Strategic Synthesis](#-cross-branch-predictive-analysis--strategic-synthesis)\n`;
  doc += `4. [Actionable Recommendations & Next Steps](#-actionable-recommendations--next-steps)\n`;

  const webBranches = Object.entries(branchWebContexts).filter(([, ctx]) => ctx !== null);
  if (webBranches.length > 0) doc += `5. [Web Sources Used](#-web-sources-used)\n`;
  doc += `\n`;

  doc += `## 🌲 Research Map Structure\n`;
  doc += `\`\`\`text\n${generateUnicodeTree(plan)}\`\`\`\n\n`;

  doc += `## 📋 Executive Summary\n`;
  const webGroundedNote =
    webBranches.length > 0
      ? ` This report is grounded in **${webBranches.length} live web search${webBranches.length > 1 ? "es" : ""}**, ensuring findings reflect current real-world data.`
      : "";
  doc += `This comprehensive research document explores **${plan.topic}** across multiple analytical dimensions.${webGroundedNote}\n\n`;

  doc += `## 🔍 Detailed Branch Analyses\n\n`;
  plan.branches.forEach((b) => {
    const usedWeb = branchWebContexts[b.name];
    const webBadge = usedWeb ? ` 🌐 *(Web-grounded via ${usedWeb.service})*` : "";
    doc += `### Branch: ${b.name}${webBadge}\n`;
    doc += `**Explored Focus Areas:** ${b.possibilities.join(", ")}\n\n`;
    doc += `${branchAnalyses[b.name]}\n\n`;
  });

  doc += `## 🧠 Cross-Branch Predictive Analysis & Strategic Synthesis\n`;
  doc += `${synthesis}\n\n`;

  doc += `## 🚀 Actionable Recommendations & Next Steps\n`;
  doc += `Based on the cross-disciplinary findings and technical analyses within this report, the following directives are recommended:\n`;
  doc += `1. **Phased Implementation**: Focus on short-term high-impact branches while planning resources for long-term scalability barriers.\n`;
  doc += `2. **Risk Mitigation**: Prioritize security and integration issues early in the developmental cycle.\n`;
  doc += `3. **Continuous Revision**: Re-evaluate the research map pathways as key technical metrics are achieved.\n`;

  if (webBranches.length > 0) {
    doc += `\n## 🌐 Web Sources Used\n`;
    doc += `The following live web searches were performed to ground this research in current data:\n\n`;
    webBranches.forEach(([branchName, ctx]) => {
      doc += `### ${branchName}\n`;
      doc += `- **Search Service:** ${ctx.service} ${ctx.icon}\n`;
      doc += `- **Query:** \`${ctx.query}\`\n`;
      if (ctx.answer) doc += `- **Summary:** ${ctx.answer}\n`;
      doc += `- **Sources:**\n`;
      ctx.results.forEach((r, i) => {
        const title = r.title || `Result ${i + 1}`;
        const url = r.url || "";
        doc += url ? `  ${i + 1}. [${title}](${url})\n` : `  ${i + 1}. ${title}\n`;
      });
      doc += "\n";
    });
  }

  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Route
// ─────────────────────────────────────────────────────────────────────────────

/** POST /api/deep-research */
router.post("/deep-research", async (req, res) => {
  const { prompt, agent, lowLatency: requestedLowLatency = false } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const activeInfo = getActiveAgent(agent);
    const resolvedAgent = activeInfo.agent;

    if (activeInfo.fallback) {
      sendEvent({
        type: "status",
        message: `⚠️ API key for "${getBackendAgentName(agent)}" missing. Auto-fallback to "${getBackendAgentName(resolvedAgent)}"...`,
      });
    }

    // Step 1: Research plan
    sendEvent({ type: "status", message: "Structuring research plan..." });
    let plan;
    try {
      plan = await generateResearchPlan(resolvedAgent, prompt);
    } catch (err) {
      console.error("Plan generation failed, using fallback plan:", err);
      plan = getFallbackPlan(prompt);
    }
    sendEvent({ type: "plan", data: plan });

    const searchCount = plan.branches.length;
    sendEvent({
      type: "status",
      message: `Initiating concurrent branch analyses for ${plan.branches.length} pathways (🌐 web search enabled for ${searchCount} branch${searchCount > 1 ? "es" : ""})...`,
    });

    const branchAnalyses = {};
    const branchWebContexts = {};

    // Step 2: Parallel branch analysis + web search
    await Promise.all(
      plan.branches.map(async (branch) => {
        sendEvent({ type: "branch_start", branch: branch.name });

        const searchQuery = buildBranchSearchQuery(plan.topic, branch);
        sendEvent({ type: "web_search_start", branch: branch.name, query: searchQuery });

        let webContext = null;
        try {
          webContext = await executeAgenticSearch(resolvedAgent, searchQuery, sendEvent);
          sendEvent({
            type: "web_search_end",
            branch: branch.name,
            found: !!webContext,
            service: webContext ? webContext.service : null,
            icon: webContext ? webContext.icon : null,
            count: webContext ? webContext.results.length : 0,
            query: searchQuery,
          });
        } catch (err) {
          console.error(`Web search failed for branch "${branch.name}":`, err.message);
          sendEvent({
            type: "web_search_end",
            branch: branch.name,
            found: false,
            service: null,
            icon: null,
            count: 0,
            query: searchQuery,
          });
        }

        branchWebContexts[branch.name] = webContext;

        try {
          const analysis = await expandBranchWithCoT(resolvedAgent, plan.topic, branch, webContext);
          branchAnalyses[branch.name] = analysis;
          sendEvent({
            type: "branch_end",
            branch: branch.name,
            analysis,
            webUsed: !!webContext,
            webService: webContext ? webContext.service : null,
          });
        } catch (err) {
          console.error(`Branch ${branch.name} expansion failed:`, err);
          const failMsg = `### Branch Analysis Failed\nAn error occurred: ${err.message}`;
          branchAnalyses[branch.name] = failMsg;
          sendEvent({ type: "branch_end", branch: branch.name, analysis: failMsg, webUsed: false, webService: null });
        }
      })
    );

    // Step 3: Synthesis
    sendEvent({ type: "status", message: "Synthesizing branch findings..." });
    sendEvent({ type: "synthesis_search_start", query: plan.topic });
    let synthesisWebContext = null;
    try {
      synthesisWebContext = await fetchWebContextForBranch(plan.topic, {
        name: "synthesis overview",
        possibilities: ["key findings", "current state"],
      });
      sendEvent({
        type: "synthesis_search_end",
        found: !!synthesisWebContext,
        service: synthesisWebContext ? synthesisWebContext.service : null,
      });
    } catch {
      sendEvent({ type: "synthesis_search_end", found: false, service: null });
    }

    let synthesis;
    try {
      synthesis = await synthesizeFindings(resolvedAgent, plan.topic, branchAnalyses, synthesisWebContext);
    } catch (err) {
      console.error("Synthesis failed:", err);
      synthesis = "Cross-branch synthesis was limited due to an execution error.";
    }

    sendEvent({ type: "status", message: "Assembling final research document..." });
    const finalReport = formatResearchDocument(plan, branchAnalyses, synthesis, branchWebContexts);
    sendEvent({ type: "completed", result: finalReport });
    res.end();
  } catch (err) {
    console.error("Deep Research failed:", err);
    sendEvent({ type: "error", message: err.message });
    res.end();
  }
});

module.exports = router;
