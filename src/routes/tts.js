// ── TTS Routes ────────────────────────────────────────────────────────────────
// POST /api/tts-script — rewrites AI text into a pipe-delimited TTS script
// POST /api/tts        — generates audio via Murf AI and streams it back

const { Router } = require("express");
const { Readable } = require("stream");

const router = Router();

/** Voice-over script rewriter system prompt (preserved verbatim). */
const REWRITER_SYSTEM = `You are a professional voice-over script writer.
Your job: take an AI assistant's text response and rewrite it as a natural spoken-word script.

VOICE TARGET:
- Aim for a warm, bright, natural assistant voice: clear, conversational, lightly expressive, and emotionally present.
- Keep the delivery close and friendly, with subtle confidence instead of announcer drama.
- Use short, human pauses and gentle emphasis. Avoid sing-song, exaggerated excitement, or excessive social sounds.

OUTPUT FORMAT RULES — these are strict:
- Split the script into small spoken chunks separated by the pipe character: |
- Each chunk = roughly one breath (8–15 words max)
- Standalone emotional sounds are their own chunk: | [laugh] | or | [hmm] |
- Start every chunk that needs a delivery style with the tag: [excited] Great news! |
- Use ONLY these tags: [pause] [pause:short] [pause:long] [pause:breath] [excited] [calm] [whisper] [serious] [warm] [laugh] [chuckle] [sigh] [hmm] [list-item] [list-final] [heading] [emphasis] [question] [end-of-thought] [reset]
- Never use tags outside brackets
- Never invent new tags
- The output is ONLY the pipe-delimited script — no explanations, no preamble

DELIVERY RULES:
- Match the emotional tone of the original text
- Add [hmm] or [pause:long] where a human would naturally think or hesitate
- Add [laugh] or [chuckle] only if the content is genuinely humorous or self-aware
- For lists: mark each item [list-item] and the last one [list-final]
- For headings or section transitions: use [heading] then [pause]
- For important warnings or serious points: use [serious]
- For warm/encouraging closings: use [warm]
- For rhetorical questions: use [question] on that chunk
- Add [pause:breath] between long idea clusters even mid-paragraph
- Sentences that end a major thought get [end-of-thought]
- Use [laugh] or [chuckle] SPARINGLY — only when the content itself is genuinely funny or playful.
- Maximum one social sound per 200 words of input. Never add humor that wasn't in the original.`;

/**
 * POST /api/tts-script
 * Body: { text: string, context?: string }
 * Returns: { script: string }
 */
router.post("/tts-script", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

  const messages = [
    { role: "system", content: REWRITER_SYSTEM },
    { role: "user", content: `Rewrite this for natural spoken delivery:\n\n${text.slice(0, 3000)}` },
  ];

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
          messages,
          max_tokens: 1200,
          temperature: 0.5,
        }),
      });

      const data = await response.json();
      const script = data.choices?.[0]?.message?.content?.trim();
      if (script) return res.json({ script });
    } catch {
      /* fall through to plain-text fallback */
    }
  }

  // Graceful degradation: return plain text as a single chunk
  res.json({ script: text });
});

/**
 * POST /api/tts
 * Body: { text: string, voiceId?: string }
 * Returns: audio/mpeg stream from Murf AI CDN
 */
router.post("/tts", async (req, res) => {
  const { text, voiceId } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  if (
    !process.env.MURF_API_KEY ||
    process.env.MURF_API_KEY === "your_murf_api_key_here"
  ) {
    return res.status(503).json({ error: "Murf API key not configured on server." });
  }

  const safeText = text.trim().slice(0, 3000);
  const resolvedVoice = voiceId || process.env.MURF_VOICE_ID || "en-US-natalie";

  try {
    const generateRes = await fetch("https://api.murf.ai/v1/speech/generate", {
      method: "POST",
      headers: {
        "api-key": process.env.MURF_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        text: safeText,
        voiceId: resolvedVoice,
        format: "MP3",
        modelVersion: "GEN2",
        channelType: "MONO",
      }),
    });

    if (!generateRes.ok) {
      const errBody = await generateRes.json().catch(() => ({}));
      const message = errBody.message || errBody.error || `HTTP ${generateRes.status}`;
      return res
        .status(generateRes.status)
        .json({ error: `Murf generate failed (${generateRes.status}): ${message}` });
    }

    const data = await generateRes.json();
    if (!data.audioFile) {
      return res.status(500).json({ error: "Murf returned no audioFile URL." });
    }

    const audioRes = await fetch(data.audioFile);
    if (!audioRes.ok) {
      return res
        .status(500)
        .json({ error: `Failed to fetch Murf audio file: HTTP ${audioRes.status}` });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    if (audioRes.body) {
      return Readable.fromWeb(audioRes.body).pipe(res);
    }

    return res.end(Buffer.from(await audioRes.arrayBuffer()));
  } catch (err) {
    console.error("Murf TTS error:", err.message);
    res.status(500).json({ error: "Murf TTS failed: " + err.message });
  }
});

module.exports = router;
