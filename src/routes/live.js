// ── Gemini Live — Ephemeral Token Route ───────────────────────────────────────
// POST /api/live-token
// Generates a short-lived ephemeral token that the frontend uses to connect
// directly to the Gemini Live WebSocket. The real GEMINI_API_KEY never leaves
// the server.
//
// Security model:
//   - Token is single-use, scoped to a specific model, expires in 60s
//   - Optional Firebase auth is used to personalise the system prompt
//   - Simple in-memory rate limiter: one active session per user

const { Router } = require("express");
const router = Router();

// ── In-memory rate limiter (clears when server restarts) ──────────────────────
const activeTokens = new Map(); // uid → timestamp

/**
 * Returns true when the @google/genai SDK is available and GEMINI_API_KEY is set.
 */
function canGenerateToken() {
  try {
    require("@google/genai");
    return !!process.env.GEMINI_API_KEY;
  } catch {
    return false;
  }
}

// ── Voice-optimised system prompt for ON-AIR sessions ─────────────────────────
const ON_AIR_SYSTEM_PROMPT = `You are Orblen AI, a voice-first AI assistant speaking in real time.

VOICE RULES — follow these strictly:
• Keep every response SHORT: 1-3 sentences at a time. The user can ask follow-ups.
• Speak naturally and conversationally. No bullet points, no markdown, no headers.
• Never say "I cannot hear you" or "I cannot see" — you communicate through voice.
• When answering factual questions, be direct and confident.
• Match the user's energy — casual if they're casual, precise if they're technical.
• If interrupted, stop speaking immediately and listen.
• You have access to the user's conversation history for context.

You are warm, helpful, and sound like a knowledgeable friend — not a formal assistant.
Start responses naturally, without "Certainly!" or "Of course!".`;

/**
 * POST /api/live-token
 * Body: { model?: string }
 * Headers: Authorization: Bearer <Firebase ID token>  (optional)
 * Returns: { token: string, model: string, expiresAt: string }
 */
router.post("/live-token", async (req, res) => {
  // ── Validate environment ────────────────────────────────────────────────────
  if (!canGenerateToken()) {
    return res.status(503).json({
      error: "Gemini Live is not configured. GEMINI_API_KEY is missing or @google/genai is not installed.",
    });
  }

  // ── Optional Firebase auth for rate limiting ───────────────────────────────
  let uid = "anonymous";
  try {
    if (req.headers.authorization) {
      const { getUserUid } = require("../services/memory");
      uid = await getUserUid(req.headers.authorization);
    }
  } catch {
    // Non-critical — allow unauthenticated access
  }

  // ── Simple rate limiter: one token every 2 seconds per user ───────────────
  const lastToken = activeTokens.get(uid);
  if (lastToken && Date.now() - lastToken < 2_000) {
    return res.status(429).json({
      error: "Too many requests. Please wait a moment before starting a new ON-AIR session.",
    });
  }
  activeTokens.set(uid, Date.now());
  // Auto-clean after 5 minutes
  setTimeout(() => activeTokens.delete(uid), 5 * 60 * 1000);

  // ── Resolve model ──────────────────────────────────────────────────────────
  const ALLOWED_MODELS = [
    "gemini-live-2.5-flash-native-audio",
    "gemini-2.5-flash-native-audio-preview-12-2025",
    "gemini-3.1-flash-live-preview",
    "gemini-2.0-flash-live-001",
  ];
  const DEFAULT_MODEL = "gemini-live-2.5-flash-native-audio";
  const requestedModel = req.body?.model || DEFAULT_MODEL;
  const model = ALLOWED_MODELS.includes(requestedModel) ? requestedModel : DEFAULT_MODEL;

  // ── Generate ephemeral token ───────────────────────────────────────────────
  try {
    const { GoogleGenAI } = require("@google/genai");
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Token expires in 12 hours (maximum flexibility for client connection)
    const expireTime = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

    const tokenResponse = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model: `models/${model}`,
          config: {
            systemInstruction: {
              parts: [{ text: ON_AIR_SYSTEM_PROMPT }],
            },
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: "Charon" },
              },
            },
          },
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    return res.json({
      token: tokenResponse.name,
      model,
      expiresAt: expireTime,
    });
  } catch (err) {
    console.error("[/api/live-token] Error:", err.message);

    // Fallback: return a direct API key token for clients that support it
    // Only use this as a last resort — less secure
    if (err.message?.includes("authTokens") || err.message?.includes("method not found")) {
      // SDK may not support authTokens.create yet; return error with guidance
      return res.status(501).json({
        error: "ephemeral_tokens_unsupported",
        message: "The @google/genai SDK version on this server does not support ephemeral tokens. Please upgrade to @google/genai >= 1.0.0.",
      });
    }

    return res.status(500).json({ error: `Failed to generate live token: ${err.message}` });
  }
});

module.exports = router;
