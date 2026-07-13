// ── Debate Route ──────────────────────────────────────────────────────────────
// POST /api/debate
// Runs a structured multi-agent debate: each agent adopts a persona and responds
// in turns for the specified number of rounds, then a moderator synthesizes a
// final consensus. All output is streamed via SSE.

const { Router } = require("express");
const { getActiveAgent, getBackendAgentName } = require("../models/constants");
const { callModelBackend } = require("../models/callModel");
const { formatWebContextForPrompt } = require("../services/webSearch");
const { executeAgenticSearch } = require("../services/agenticSearch");

const router = Router();

/** Persona assignments for debate participants (cycled for > 5 agents). */
const DEBATE_PERSONAS = [
  { role: "The Advocate", description: "argues in favor of the topic, highlighting benefits, opportunities, and supporting evidence" },
  { role: "The Critic", description: "challenges the topic, pointing out risks, limitations, counterarguments, and potential downsides" },
  { role: "The Analyst", description: "provides objective, data-driven analysis without taking a side, evaluating evidence from all perspectives" },
  { role: "The Synthesizer", description: "seeks common ground, identifies areas of agreement, and bridges opposing viewpoints" },
  { role: "The Pragmatist", description: "focuses on practical implementation, feasibility, real-world constraints, and actionable outcomes" },
];

/** POST /api/debate */
router.post("/debate", async (req, res) => {
  const { topic, agents, rounds, webContext, lowLatency: requestedLowLatency = false } = req.body;
  if (!topic) return res.status(400).json({ error: "topic required" });
  if (!agents || !Array.isArray(agents) || agents.length < 2) {
    return res.status(400).json({ error: "At least 2 agents required" });
  }

  const maxRounds = Math.min(Math.max(parseInt(rounds) || 2, 1), 4);
  const selectedAgents = agents.slice(0, 5);
  const webSection = webContext ? formatWebContextForPrompt(webContext) : "";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const transcript = [];

    // Resolve agents and assign personas
    const participants = selectedAgents.map((agent, i) => {
      const info = getActiveAgent(agent);
      return {
        agent: info.agent,
        name: getBackendAgentName(info.agent),
        persona: DEBATE_PERSONAS[i % DEBATE_PERSONAS.length],
        fallback: info.fallback,
        originalAgent: info.fallback ? agent : null,
      };
    });

    // Deduplicate by resolved agent key
    const seen = new Set();
    const uniqueParticipants = [];
    for (const p of participants) {
      if (!seen.has(p.agent)) {
        seen.add(p.agent);
        uniqueParticipants.push(p);
      }
    }

    if (uniqueParticipants.length < 2) {
      sendEvent({ type: "error", message: "At least 2 unique agents with valid API keys are required." });
      return res.end();
    }

    sendEvent({
      type: "start",
      participants: uniqueParticipants.map((p) => ({
        agent: p.agent,
        name: p.name,
        persona: p.persona,
        fallback: p.fallback,
        originalAgent: p.originalAgent,
      })),
      topic,
    });
    sendEvent({
      type: "status",
      message: `🗣️ Debate starting with ${uniqueParticipants.length} participants, ${maxRounds} round${maxRounds > 1 ? "s" : ""}`,
    });

    const colorPalette = ["#00f5ff", "#ff2d78", "#ffbe00", "#7c3aed", "#00ff9d"];

    // ── Debate rounds ──────────────────────────────────────────────────────────
    for (let round = 1; round <= maxRounds; round++) {
      for (let pIdx = 0; pIdx < uniqueParticipants.length; pIdx++) {
        const p = uniqueParticipants[pIdx];

        sendEvent({
          type: "speaker_start",
          round,
          agent: p.agent,
          name: p.name,
          persona: p.persona,
          color: colorPalette[pIdx % colorPalette.length],
        });

        const fallbackNote = p.fallback
          ? `\n\nNOTE: API key for "${getBackendAgentName(p.originalAgent)}" was unavailable. You are responding in their place as the ${p.persona.role}.`
          : "";

        const transcriptText =
          transcript.length > 0
            ? transcript.map((t) => `${t.name} (${t.persona.role}):\n${t.content}`).join("\n\n---\n\n")
            : "";

        // Fetch per-speaker web context when no global webContext was provided
        let speakerWebSection = webSection
          ? `\nUse the following current web data to support your arguments:\n${webSection}`
          : "";

        if (!webSection) {
          const searchContext = await executeAgenticSearch(
            p.agent,
            `Debate topic: ${topic} - arguments for ${p.persona.role}`,
            sendEvent
          );
          if (searchContext) {
            speakerWebSection = `\nUse the following current web data to support your arguments:\n${formatWebContextForPrompt(searchContext)}`;
          }
        }

        let debatePrompt;
        if (round === 1 && pIdx === 0) {
          debatePrompt = `You are participating in a structured multi-AI debate.

DEBATE TOPIC: "${topic}"

YOUR ROLE: ${p.persona.role}
YOUR INSTRUCTION: ${p.persona.description}

This is the opening statement of the debate. Present your initial position clearly and persuasively. Structure your response with:
• Your main thesis/position on the topic
• Key supporting arguments and reasoning
• Evidence or examples where relevant
${speakerWebSection}
Keep your response focused and concise (2-4 paragraphs). Use proper punctuation throughout.${fallbackNote}`;
        } else {
          debatePrompt = `You are participating in a structured multi-AI debate.

DEBATE TOPIC: "${topic}"

YOUR ROLE: ${p.persona.role}
YOUR INSTRUCTION: ${p.persona.description}

Here is the debate transcript so far (Round ${round}):

${transcriptText}

Now it's your turn. Respond to the previous speakers. You should:
• Directly engage with points made by other participants — address them by name
• If you agree with something, acknowledge it and build on it
• If you disagree, explain why with clear reasoning
• Advance your own unique perspective based on your assigned role
• Counter any arguments made against your position
${speakerWebSection}
Keep your response focused and concise (2-4 paragraphs). Use proper punctuation throughout.${fallbackNote}`;
        }

        try {
          const response = await callModelBackend(p.agent, [{ role: "user", content: debatePrompt }]);
          transcript.push({ agent: p.agent, name: p.name, persona: p.persona, content: response, round });
          sendEvent({
            type: "speaker_end",
            agent: p.agent,
            name: p.name,
            persona: p.persona,
            content: response,
            color: colorPalette[pIdx % colorPalette.length],
            round,
          });
        } catch (err) {
          const errorMsg = `[${p.name} is unavailable for this round: ${err.message}]`;
          transcript.push({ agent: p.agent, name: p.name, persona: p.persona, content: errorMsg, round });
          sendEvent({
            type: "speaker_end",
            agent: p.agent,
            name: p.name,
            persona: p.persona,
            content: errorMsg,
            color: colorPalette[pIdx % colorPalette.length],
            round,
            error: true,
          });
        }
      }
    }

    // ── Synthesis phase ────────────────────────────────────────────────────────
    sendEvent({ type: "status", message: "🧠 Synthesizing debate into a final consensus..." });

    const fullTranscript = transcript
      .map((t) => `--- ${t.name} (${t.persona.role}) - Round ${t.round} ---\n${t.content}`)
      .join("\n\n");

    const webSynthesisSection = webSection
      ? `\nThe following current web data was available to participants during the debate:\n${webSection}`
      : "";

    const synthesisPrompt = `You are a neutral debate moderator and expert synthesis analyst.

DEBATE TOPIC: "${topic}"

Below is the full transcript of a structured multi-AI debate:

${fullTranscript}
${webSynthesisSection}
Your task: synthesize this debate into a clear, balanced, and actionable final document. Structure your response with these sections:

## 📋 Executive Summary
A brief 2-3 sentence overview of the debate's outcome and key takeaways.

## 🔑 Areas of Agreement
List the main points where participants reached consensus or found common ground.

## ⚡ Areas of Disagreement
Summarize the key disagreements and the reasoning behind each side's position.

## 🏁 Final Consensus
A comprehensive, balanced conclusion that incorporates the strongest arguments from all sides.

Keep your synthesis thorough but readable. Use proper punctuation throughout.`;

    const moderatorAgent = uniqueParticipants[0].agent;
    try {
      const consensus = await callModelBackend(moderatorAgent, [{ role: "user", content: synthesisPrompt }]);
      sendEvent({ type: "completed", result: consensus, transcript });
    } catch (err) {
      sendEvent({ type: "error", message: `Consensus synthesis failed: ${err.message}` });
    }

    res.end();
  } catch (err) {
    console.error("Debate error:", err);
    sendEvent({ type: "error", message: err.message });
    res.end();
  }
});

module.exports = router;
