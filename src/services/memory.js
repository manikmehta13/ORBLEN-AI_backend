// ── Memory Service ────────────────────────────────────────────────────────────
// Handles Firebase RTDB memory CRUD operations:
//   - processMarkers()           : strip [SAVE_MEMORY] tags, persist to RTDB
//   - loadMemoriesFromFirebase() : fetch all memories for a user
//   - extractMemoriesBackground(): LLM-powered fact extraction (fire-and-forget)
//   - getUserUid()               : verify Firebase ID token → uid

const crypto = require("crypto");
const { firebaseReady, getAuth, getDatabase } = require("../config/firebase");

// ─────────────────────────────────────────────────────────────────────────────
//  Auth Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifies a Firebase ID token from an Authorization header and returns the
 * user's UID, or null if the token is missing/invalid/Firebase is unavailable.
 * @param {string|undefined} authHeader
 * @returns {Promise<string|null>}
 */
async function getUserUid(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken || !firebaseReady) return null;
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    return decoded.uid || null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SAVE_MEMORY Marker Processor
// ─────────────────────────────────────────────────────────────────────────────

const MARKER_RE = {
  SAVE_MEMORY: /\[SAVE_MEMORY\]([\s\S]*?)\[\/SAVE_MEMORY\]/g,
};

/**
 * Recursively formats a memory value (object/array/primitive) as readable text.
 * @param {*}      v
 * @param {number} [indent]
 * @returns {string}
 */
function formatMemoryValue(v, indent = 0) {
  const pad = "  ".repeat(indent);
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v))
    return v.map((item) => `\n${pad}- ${formatMemoryValue(item, indent + 1)}`).join("");
  if (typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 0) return "";
    return keys.map((k) => `\n${pad}${k}: ${formatMemoryValue(v[k], indent + 1)}`).join("");
  }
  return String(v);
}

/**
 * Scans `text` for [SAVE_MEMORY]…[/SAVE_MEMORY] markers, persists each payload
 * to Firebase RTDB (deduplicating and replacing key terms), and replaces the
 * raw marker with a human-readable confirmation string.
 *
 * @param {string} text - Raw LLM response text
 * @param {string} uid  - Firebase user ID
 * @returns {Promise<{ cleanText: string }>}
 */
async function processMarkers(text, uid) {
  if (!text || !uid) return { cleanText: text || "" };

  let cleanText = text;
  const matches = [...text.matchAll(MARKER_RE.SAVE_MEMORY)];

  for (const m of matches) {
    const raw = m[0];
    let payload;

    try {
      let jsonStr = m[1].trim();
      const firstBrace = jsonStr.search(/[\{\[]/);
      const lastBrace = jsonStr.search(/[\}\]][^\}\]]*$/);
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
        jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
      }
      payload = JSON.parse(jsonStr);
    } catch (e) {
      console.error("JSON parse error in processMarkers:", e.message);
    }

    if (!payload || typeof payload !== "object") continue;

    try {
      const memRef = getDatabase().ref(`memories/${uid}`);
      const snap = await memRef.once("value");
      const existing = snap.val() || {};

      const KEY_TERMS = ["email", "phone", "mobile", "number", "name", "location", "city"];

      function replaceOrCreate(category, content) {
        const trimmed = content.trim();

        // Skip exact duplicates
        const isDuplicate = Object.values(existing).some(
          (mem) =>
            mem.category === category &&
            mem.content.toLowerCase().trim() === trimmed.toLowerCase()
        );
        if (isDuplicate) return;

        // Replace a single existing entry if it shares a key term (e.g. email)
        const matchedTerm = KEY_TERMS.find((t) => trimmed.toLowerCase().includes(t));
        if (matchedTerm) {
          const matchingOldId = Object.entries(existing).find(
            ([, mem]) =>
              mem.category === category && mem.content.toLowerCase().includes(matchedTerm)
          )?.[0];
          if (matchingOldId) {
            memRef
              .child(matchingOldId)
              .set({ id: matchingOldId, content: trimmed, category, emoji: "💡", createdAt: Date.now() });
            return;
          }
        }

        const memId = `mem_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
        memRef.child(memId).set({ id: memId, content: trimmed, category, emoji: "💡", createdAt: Date.now() });
      }

      if (Array.isArray(payload)) {
        let count = 0;
        for (const item of payload) {
          if (item.content) {
            replaceOrCreate(item.category || "others", item.content.trim());
            count++;
          }
        }
        cleanText = cleanText.replace(raw, `🧠 Memory saved (${count} facts)`);
      } else if (payload.content) {
        replaceOrCreate(payload.category || "others", payload.content.trim());
        cleanText = cleanText.replace(raw, "🧠 Memory saved");
      } else {
        let count = 0;
        for (const [cat, data] of Object.entries(payload)) {
          if (!data) continue;
          replaceOrCreate(cat, `${cat}:${formatMemoryValue(data)}`);
          count++;
        }
        cleanText = cleanText.replace(
          raw,
          `🧠 Memory saved (${count} ${count === 1 ? "section" : "sections"})`
        );
      }
    } catch (e) {
      cleanText = cleanText.replace(raw, `⚠ Memory save error: ${e.message}`);
    }
  }

  return { cleanText };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Firebase Memory Loader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads all saved memories for a user from Firebase RTDB, sorted newest first.
 * Returns an empty array when Firebase is unavailable or the user has no memories.
 * @param {string} uid
 * @returns {Promise<object[]>}
 */
async function loadMemoriesFromFirebase(uid) {
  if (!uid || !firebaseReady) return [];
  try {
    const snap = await getDatabase().ref(`memories/${uid}`).once("value");
    const val = snap.val();
    if (!val || typeof val !== "object") return [];
    return Object.values(val)
      .filter((m) => m && typeof m.content === "string" && m.content.trim())
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Background Memory Extractor
// ─────────────────────────────────────────────────────────────────────────────

/** Emoji mapping for memory categories. */
const MEMORY_EMOJI = {
  personal: "👤",
  personal_information: "👤",
  contact_information: "📞",
  location: "📍",
  preference: "❤️",
  preferences: "❤️",
  communication_style: "💬",
  project: "🚀",
  projects: "🚀",
  education: "🎓",
  technical_skills: "🛠️",
  skills: "🛠️",
  programming_languages: "💻",
  others: "📦",
  context: "💡",
};

/**
 * Fire-and-forget: uses an LLM to extract memorable user facts from a
 * conversation tail and applies add/update/delete operations on Firebase RTDB.
 * Never throws — designed to run in the background after a response is sent.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {string}                                 uid
 * @returns {Promise<void>}
 */
async function extractMemoriesBackground(messages, uid) {
  if (!uid || !firebaseReady || !process.env.GROQ_API_KEY) return;
  if (!Array.isArray(messages) || messages.length < 2) return;

  try {
    const memRef = getDatabase().ref(`memories/${uid}`);
    const snap = await memRef.once("value");
    const existingObj = snap.val() || {};
    const existingList = Object.values(existingObj)
      .map((m) => `- ID: "${m.id}" | Category: "${m.category}" | Content: "${m.content}"`)
      .join("\n");

    const systemPrompt = `You are a precision profile memory manager. You keep track of key details, preferences, projects, and context about a user.

Your task is to analyze a conversation snippet and determine if any changes (additions, updates, or deletions) need to be made to the user's saved profile memories based on what they just said.

Here is the USER'S CURRENT SAVED PROFILE MEMORIES:
${existingList || "None"}

EXTRACTION RULES:
1. "add": Use this action if the user explicitly stated a new key fact (e.g. email, phone number, location, active project) that is NOT already represented in the list.
   - Do NOT replace/overwrite existing unrelated memories in the same category.
   - Content should be one clear sentence starting with "User" (e.g. "User's email is test@example.com").
   - Category options: "personal", "preference", "project", "context".
2. "update": Use this action if the user corrected or updated a previously stored fact. Specify the target memory ID.
3. "delete": Use this action if the user explicitly requested to forget a specific fact, or if it is no longer true. Specify the target memory ID.
4. "none": If no changes are needed, return an empty array.

Be conservative: only store facts that are genuinely useful, factual, and reusable.

CRITICAL: Return ONLY a valid JSON array of operations, and absolutely nothing else.`;

    const convText = messages
      .filter((m) => m.role !== "system")
      .slice(-4)
      .map((m) => `${m.role === "user" ? "USER" : "AI"}: ${String(m.content || "").slice(0, 500)}`)
      .join("\n\n");

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
          {
            role: "user",
            content: `Analyze the exchange and generate the JSON operations list:\n\n${convText}`,
          },
        ],
        max_tokens: 400,
        temperature: 0.1,
      }),
    });

    const data = await response.json();
    let rawText = data.choices?.[0]?.message?.content?.trim() || "[]";
    rawText = rawText.replace(/```(?:json)?\n?/g, "").replace(/```\n?/g, "").trim();
    const match = rawText.match(/\[[\s\S]*\]/);
    if (match) rawText = match[0];

    let operations = [];
    try {
      operations = JSON.parse(rawText);
    } catch {
      return;
    }
    if (!Array.isArray(operations)) return;

    for (const op of operations) {
      if (!op || typeof op !== "object") continue;
      const { action, id, category, content } = op;
      const cat = category || "others";
      const emoji = MEMORY_EMOJI[cat] || "💡";

      if (action === "add" && content && content.trim()) {
        const memId = `mem_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
        await memRef
          .child(memId)
          .set({ id: memId, content: content.trim(), category: cat, emoji, createdAt: Date.now() })
          .catch(() => {});
      } else if (action === "update" && id && content && content.trim()) {
        if (existingObj[id]) {
          const finalCat = category || existingObj[id].category || "others";
          const finalEmoji = MEMORY_EMOJI[finalCat] || "💡";
          await memRef
            .child(id)
            .update({ content: content.trim(), category: finalCat, emoji: finalEmoji, createdAt: Date.now() })
            .catch(() => {});
        }
      } else if (action === "delete" && id) {
        if (existingObj[id]) {
          await memRef.child(id).remove().catch(() => {});
        }
      }
    }
  } catch {
    // Background — never throw
  }
}

module.exports = {
  getUserUid,
  processMarkers,
  loadMemoriesFromFirebase,
  extractMemoriesBackground,
};
