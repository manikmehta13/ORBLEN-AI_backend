// ╔══════════════════════════════════════════════════════════╗
// ║         ORBLEN AI — Secure Backend Server                 ║
// ║   All API keys live HERE — never in the frontend         ║
// ╚══════════════════════════════════════════════════════════╝

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const crypto = require("crypto");
const { Readable } = require("stream");
const { initializeApp: initFirebase, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const {
  SKILL_REPOSITORY,
  SKILL_SOURCES,
  selectSkills,
  buildSkillContext,
  publicSkill
} = require("./skillRepository");

// ── Firebase Admin (for per-user token storage & ID token verification) ──
let firebaseReady = false;
const fbRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (fbRaw) {
  try {
    const sa = JSON.parse(fbRaw);
    initFirebase({ credential: cert(sa), databaseURL: "https://storage-53912-default-rtdb.firebaseio.com" });
    firebaseReady = true;
  } catch (e) { console.error("Firebase Admin init failed:", e.message); }
}

const app = express();

// ── CORS: Only allow your Netlify frontend ──
const DEFAULT_ALLOWED_ORIGINS = [
  "https://orblen.pages.dev"
];

const configuredOrigins = String(process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;

  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "https:" && (
      hostname === "orblen.pages.dev" ||
      hostname.endsWith("--orblen.pages.dev")
    );
  } catch {
    return false;
  }
}

const corsOptions = {
  origin(origin, callback) {
    callback(null, isAllowedOrigin(origin));
  },
  methods: ["GET", "HEAD", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
  maxAge: 86400
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use((req, res, next) => {
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
});

app.use(express.json({ limit: '15mb' }));

// ── Piggyback: after any authenticated request, check for due tasks ──
// This catches tasks in real-time when the user is active.
app.use((req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode < 400 && req.headers.authorization?.startsWith('Bearer ')) {
      executeDueTasks();
    }
  });
  next();
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});

// Skill repository: curated coding capabilities the frontend can browse and
// the chat flow can inject into model prompts on demand.
app.get("/api/skills", (req, res) => {
  res.json({
    success: true,
    updatedAt: "2026-06-09",
    sources: SKILL_SOURCES,
    skills: SKILL_REPOSITORY.map(publicSkill)
  });
});

app.post("/api/skills/select", (req, res) => {
  const { query, limit = 4 } = req.body || {};
  if (!query) return res.status(400).json({ error: "query required" });

  const selected = selectSkills(query, { limit }).map(skill => ({
    ...publicSkill(skill),
    score: Number(skill.score.toFixed(2))
  }));

  res.json({
    success: true,
    query,
    selected,
    context: buildSkillContext(selected),
    sources: SKILL_SOURCES
  });
});

app.post("/api/skills/refresh", async (req, res) => {
  const { query } = req.body || {};
  const trendQuery = query || "software development skills trends TypeScript React Python AI cloud native Docker Kubernetes 2026";

  try {
    let results = [];
    let service = "duckduckgo";

    if (process.env.TAVILY_API_KEY) {
      const tavily = await handleTavilySearch(trendQuery);
      if (tavily?.results?.length) {
        results = tavily.results;
        service = "tavily";
      }
    }

    if (!results.length) {
      results = await handleDuckDuckGoSearch(trendQuery);
    }

    const scanText = results
      .map(result => `${result.title || ""} ${result.snippet || result.content || ""}`)
      .join(" ")
      .toLowerCase();

    const matches = SKILL_REPOSITORY
      .map(skill => {
        const terms = [...(skill.tags || []), ...(skill.aliases || []), skill.name]
          .map(term => String(term).toLowerCase())
          .filter(Boolean);
        const hits = terms.filter(term => scanText.includes(term)).slice(0, 8);
        return {
          id: skill.id,
          name: skill.name,
          category: skill.category,
          horizon: skill.horizon,
          demand: skill.demand,
          trendHits: hits
        };
      })
      .filter(skill => skill.trendHits.length)
      .sort((a, b) => b.trendHits.length - a.trendHits.length);

    res.json({
      success: true,
      refreshedAt: new Date().toISOString(),
      query: trendQuery,
      service,
      sources: results.slice(0, 8),
      matches
    });
  } catch (err) {
    res.status(500).json({ error: "Skill refresh failed: " + err.message });
  }
});

// ── Health check ──
app.get("/", (req, res) => {
  res.json({ status: "✅ ORBLEN AI Backend is live", version: "1.0.0" });
});

// ══════════════════════════════════════════════════════════════
//  🔑 NVIDIA NIM — shared helper (OpenAI-compatible endpoint)
// ══════════════════════════════════════════════════════════════
async function callNvidiaModel(model, apiKey, messages, res, opts = {}) {
  if (!apiKey) {
    return res.status(503).json({ error: `NVIDIA API key for ${model} not configured on server.` });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxTokens || 16384,
        temperature: opts.temperature ?? 0.7,
        top_p: opts.topP ?? 1.0,
        stream: false
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: `NVIDIA NIM (${model}) returned non-JSON: ${raw.slice(0, 120)}` });
    }

    if (data.error) return res.status(400).json({ error: data.error.message || JSON.stringify(data.error) });
    if (!data.choices?.[0]?.message?.content) {
      return res.status(500).json({ error: `NVIDIA NIM (${model}) returned an unexpected response structure.` });
    }

    res.json({ result: data.choices[0].message.content });
  } catch (err) {
    const msg = err.name === 'AbortError' ? `NVIDIA NIM (${model}) timed out after 90s.` : `NVIDIA NIM (${model}) request failed: ` + err.message;
    res.status(500).json({ error: msg });
  }
}

// ══════════════════════════════════════════════════════════════
//  🤖 ROUTE 1: OpenAI GPT-OSS-120b  ← via NVIDIA NIM (FREE)
// ══════════════════════════════════════════════════════════════
function apiChatRoute(agentName, isGeminiOrCoherePrompt = false) {
  return async (req, res) => {
    if (req.body.stream) {
      return handleAgenticChatRouteStream(req, res, agentName, isGeminiOrCoherePrompt);
    }
    return handleAgenticChatRoute(req, res, agentName, isGeminiOrCoherePrompt);
  };
}
app.post("/api/openai", apiChatRoute("openai"));
app.post("/api/gemini", apiChatRoute("gemini", true));
app.post("/api/mistral", apiChatRoute("mistral"));
app.post("/api/codestral", apiChatRoute("codestral"));
app.post("/api/groq", apiChatRoute("groq"));
app.post("/api/cohere", apiChatRoute("cohere", true));
app.post("/api/nvidia-llama", apiChatRoute("nvidia-llama"));
app.post("/api/gemma4", apiChatRoute("gemma4"));
app.post("/api/deepseek", apiChatRoute("deepseek"));

// ══════════════════════════════════════════════════════════════
//  ✉️ GMAIL INTEGRATION  (Google OAuth2 API)
//  Per-user token storage via Firebase RTDB
// ══════════════════════════════════════════════════════════════

// ── Firebase token verification helper ──
async function getUserUid(authHeader) {
  if (!firebaseReady) throw new Error("Firebase not initialized");
  if (!authHeader || !authHeader.startsWith("Bearer ")) throw new Error("Missing auth token");
  const idToken = authHeader.slice(7);
  const decoded = await getAuth().verifyIdToken(idToken);
  return decoded.uid;
}

const gmailStates = new Map();

// ── RTDB token helpers ──
const gmailDb = () => getDatabase();

async function getGmailTokens(uid) {
  const snap = await gmailDb().ref(`users/${uid}/gmail`).once("value");
  return snap.val() || null;
}

async function setGmailTokens(uid, tokens) {
  await gmailDb().ref(`users/${uid}/gmail`).set(tokens);
}

async function refreshGmailTokens(uid, current) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: current.refreshToken,
      grant_type: "refresh_token"
    })
  });
  const data = await tokenRes.json();
  if (!tokenRes.ok) throw new Error("Gmail token refresh failed: " + (data.error || tokenRes.statusText));
  const tokens = { accessToken: data.access_token, refreshToken: current.refreshToken, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  await setGmailTokens(uid, tokens);
  return tokens;
}

async function getGmailAccessToken(uid) {
  const tokens = await getGmailTokens(uid);
  if (!tokens || !tokens.refreshToken) throw new Error("Gmail not connected");
  if (tokens.accessToken && tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  const refreshed = await refreshGmailTokens(uid, tokens);
  return refreshed.accessToken;
}

// ── Step 1: Get Google OAuth URL ──
app.get("/api/gmail/auth-url", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const state = crypto.randomBytes(32).toString("hex");
    gmailStates.set(state, { uid, expiresAt: Date.now() + 600_000 });
    const scopes = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly";
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    res.json({
      url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}&access_type=offline&prompt=consent`
    });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ── Step 2: OAuth callback (Google redirects here) ──
app.get("/api/gmail/oauth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send("Missing code or state");
  const stored = gmailStates.get(state);
  if (!stored) return res.status(400).send("Invalid state");
  gmailStates.delete(state);
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code"
      })
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(data.error || "Token exchange failed");
    const tokens = { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
    await setGmailTokens(stored.uid, tokens);
    const frontend = process.env.FRONTEND_URL || "http://localhost:8888";
    res.redirect(`${frontend}?gmail=connected`);
  } catch (err) {
    res.status(500).send("Gmail OAuth failed: " + err.message);
  }
});

// ── Step 3: Check connection status ──
app.get("/api/gmail/status", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const tokens = await getGmailTokens(uid);
    res.json({ connected: !!(tokens && tokens.accessToken), expiresAt: tokens?.expiresAt || 0 });
  } catch {
    res.json({ connected: false, expiresAt: 0 });
  }
});

// ── Step 4: Send an email ──
app.post("/api/gmail/send", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { to, subject, body } = req.body;
    if (!to || !subject || !body) return res.status(400).json({ error: "to, subject, body required" });
    const token = await getGmailAccessToken(uid);
    const email = [
      `From: me`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=UTF-8`,
      "",
      body
    ].join("\r\n");
    const raw = Buffer.from(email).toString("base64url");
    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw })
    });
    const data = await sendRes.json();
    if (!sendRes.ok) throw new Error(data.error?.message || `Gmail API error (${sendRes.status})`);
    res.json({ sent: true, id: data.id, threadId: data.threadId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Step 5: Search emails ──
app.post("/api/gmail/search", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { query, maxResults } = req.body;
    if (!query) return res.status(400).json({ error: "query required" });
    const token = await getGmailAccessToken(uid);
    const searchRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(maxResults || 10, 50)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await searchRes.json();
    if (!searchRes.ok) throw new Error(data.error?.message || `Gmail API error (${searchRes.status})`);
    if (!data.messages || data.messages.length === 0) return res.json({ messages: [] });
    const details = await Promise.all(data.messages.slice(0, 10).map(async (m) => {
      try {
        const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const d = await r.json();
        const headers = (d.payload?.headers || []).reduce((acc, h) => { acc[h.name] = h.value; return acc; }, {});
        return { id: m.id, from: headers.From || "", to: headers.To || "", subject: headers.Subject || "", date: headers.Date || "", snippet: d.snippet || "" };
      } catch { return null; }
    }));
    res.json({ messages: details.filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Email body cleanup — strip CSS/HTML that some senders put in text/plain ──
function cleanEmailBody(body) {
  if (!body) return body;
  // Remove @media blocks
  body = body.replace(/@media\s*[^{]*\{[^}]*\}/gs, '');
  // Remove CSS rules including attribute selectors with quotes
  body = body.replace(/[.#a-zA-Z@]\w[\w\s,#.\-:*>+~[\]()=^$|"']*\s*\{[^}]*\}/gs, '');
  // Remove orphaned CSS braces (stray `}` lines left after partial stripping)
  body = body.replace(/^\s*\}\s*$/gm, '');
  // Remove inline style tags
  body = body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // Remove HTML tags
  body = body.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  body = body.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  // Collapse multiple blank lines
  body = body.replace(/\n{3,}/g, '\n\n');
  return body.trim();
}

// ── Extract links from HTML string ──
function extractLinks(html) {
  const links = [];
  const re = /<a\s[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1] || m[2] || m[3];
    if (url && !url.startsWith('#') && !url.startsWith('mailto:')) links.push(url);
  }
  return [...new Set(links)];
}

// ── Walk MIME parts to collect body, links, and attachments ──
function parseMimeParts(payload) {
  let body = '';
  let html = '';
  const attachments = [];
  const queue = [payload];
  while (queue.length) {
    const p = queue.shift();
    if (p.parts) queue.push(...p.parts);
    if (p.mimeType === 'text/plain' && p.body?.data && !body) {
      body = Buffer.from(p.body.data, 'base64').toString('utf-8');
    }
    if (p.mimeType === 'text/html' && p.body?.data && !html) {
      html = Buffer.from(p.body.data, 'base64').toString('utf-8');
    }
    if (p.filename && p.body?.data) {
      attachments.push({ filename: p.filename, mimeType: p.mimeType });
    }
  }
  return { body, html, attachments };
}

// ── Step 6: Read a specific email ──
app.post("/api/gmail/read", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });
    const token = await getGmailAccessToken(uid);
    const readRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await readRes.json();
    if (!readRes.ok) throw new Error(data.error?.message || `Gmail API error (${readRes.status})`);
    const headers = (data.payload?.headers || []).reduce((acc, h) => { acc[h.name] = h.value; return acc; }, {});
    const { body, html, attachments } = parseMimeParts(data.payload);
    const cleanBody = body ? cleanEmailBody(body) : '';
    const links = html ? extractLinks(html) : [];
    res.json({
      id: data.id,
      from: headers.From,
      to: headers.To,
      subject: headers.Subject,
      date: headers.Date,
      body: cleanBody || '(no plain text body found)',
      links,
      attachments
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
//  📝 GOOGLE DOCS API
// ══════════════════════════════════════════════════════════════

const docsStates = new Map();

async function getDocsTokens(uid) {
  const snap = await gmailDb().ref(`users/${uid}/docs`).once("value");
  return snap.val() || null;
}
async function setDocsTokens(uid, tokens) {
  await gmailDb().ref(`users/${uid}/docs`).set(tokens);
}
async function refreshDocsTokens(uid, current) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: current.refreshToken,
      grant_type: "refresh_token"
    })
  });
  const data = await tokenRes.json();
  if (!tokenRes.ok) throw new Error("Docs token refresh failed: " + (data.error || tokenRes.statusText));
  const tokens = { accessToken: data.access_token, refreshToken: current.refreshToken, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  await setDocsTokens(uid, tokens);
  return tokens;
}
async function getDocsAccessToken(uid) {
  const tokens = await getDocsTokens(uid);
  if (!tokens || !tokens.refreshToken) throw new Error("Google Docs not connected");
  if (tokens.accessToken && tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  const refreshed = await refreshDocsTokens(uid, tokens);
  return refreshed.accessToken;
}

const DOCS_REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI || '').replace('/gmail/', '/docs/');

// ── Docs Step 1: Get OAuth URL ──
app.get("/api/docs/auth-url", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const state = crypto.randomBytes(32).toString("hex");
    docsStates.set(state, { uid, expiresAt: Date.now() + 600_000 });
    const scopes = "https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive";
    res.json({
      url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(DOCS_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}&access_type=offline&prompt=consent`
    });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ── Docs Step 2: OAuth callback ──
app.get("/api/docs/oauth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send("Missing code or state");
  const stored = docsStates.get(state);
  if (!stored) return res.status(400).send("Invalid state");
  docsStates.delete(state);
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: DOCS_REDIRECT_URI,
        grant_type: "authorization_code"
      })
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(data.error || "Token exchange failed");
    const tokens = { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
    await setDocsTokens(stored.uid, tokens);
    const frontend = process.env.FRONTEND_URL || "http://localhost:8888";
    res.redirect(`${frontend}?docs=connected`);
  } catch (err) {
    res.status(500).send("Docs OAuth failed: " + err.message);
  }
});

// ── Docs Step 3: Check status ──
app.get("/api/docs/status", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const tokens = await getDocsTokens(uid);
    res.json({ connected: !!(tokens && tokens.accessToken), expiresAt: tokens?.expiresAt || 0 });
  } catch {
    res.json({ connected: false, expiresAt: 0 });
  }
});

// ── Docs Step 4: List documents via Drive API ──
app.post("/api/docs/list", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { query, maxResults } = req.body;
    const token = await getDocsAccessToken(uid);
    const q = encodeURIComponent(query ? `name contains '${query.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.document'` : "mimeType='application/vnd.google-apps.document'");
    const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,modifiedTime,owners)&pageSize=${Math.min(maxResults || 10, 50)}&orderBy=modifiedTime desc`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await listRes.json();
    if (!listRes.ok) throw new Error(data.error?.message || `Drive API error (${listRes.status})`);
    res.json({ files: (data.files || []).map(f => ({ id: f.id, name: f.name, createdTime: f.createdTime, modifiedTime: f.modifiedTime, owner: f.owners?.[0]?.displayName || "" })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Docs Step 5: Read document content ──
app.post("/api/docs/read", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });
    const token = await getDocsAccessToken(uid);
    const docRes = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await docRes.json();
    if (!docRes.ok) throw new Error(data.error?.message || `Docs API error (${docRes.status})`);
    // Extract plain text from the document body
    let bodyText = "";
    if (data.body?.content) {
      const texts = [];
      const walk = (elements) => {
        for (const el of elements) {
          if (el.paragraph?.elements) {
            for (const pe of el.paragraph.elements) {
              if (pe.textRun?.content) texts.push(pe.textRun.content);
            }
          }
          if (el.table?.tableRows) {
            for (const row of el.table.tableRows) {
              if (row.tableCells) {
                for (const cell of row.tableCells) walk(cell.content);
              }
            }
          }
        }
      };
      walk(data.body.content);
      bodyText = texts.join("");
    }
    res.json({ id: data.documentId, title: data.title || "", body: bodyText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Docs Step 6: Create a new document ──
app.post("/api/docs/create", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { title, body } = req.body;
    if (!title) return res.status(400).json({ error: "title required" });
    const token = await getDocsAccessToken(uid);
    const createRes = await fetch("https://docs.googleapis.com/v1/documents", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
    const data = await createRes.json();
    if (!createRes.ok) throw new Error(data.error?.message || `Docs API error (${createRes.status})`);
    if (body) {
      const requests = markdownToDocsRequests(body);
      if (requests.length) {
        const appendRes = await fetch(`https://docs.googleapis.com/v1/documents/${data.documentId}:batchUpdate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ requests })
        });
        if (!appendRes.ok) {
          const errData = await appendRes.json();
          throw new Error("Content append failed: " + (errData.error?.message || appendRes.statusText));
        }
      }
    }
    res.json({ created: true, id: data.documentId, title: data.title || title, url: `https://docs.google.com/document/d/${data.documentId}/edit` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function markdownToDocsRequests(md, startPos = 1) {
  const STYLES = { 1: 'HEADING_1', 2: 'HEADING_2', 3: 'HEADING_3' };
  const requests = [];
  let pos = startPos;

  function parseInline(s) {
    const out = [];
    let r = s;
    while (r.length) {
      const m = r.match(/(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/);
      if (!m) { out.push({ t: r }); break; }
      if (m.index > 0) out.push({ t: r.slice(0, m.index) });
      const f = m[0];
      if (f.startsWith('***')) out.push({ t: m[2], b: 1, i: 1 });
      else if (f.startsWith('**')) out.push({ t: m[3], b: 1 });
      else if (f.startsWith('*') && f.endsWith('*') && !f.endsWith('**')) out.push({ t: m[4], i: 1 });
      else if (f.startsWith('`')) out.push({ t: m[5], c: 1 });
      else if (f.startsWith('[')) out.push({ t: m[6], l: m[7] });
      else out.push({ t: f });
      r = r.slice(m.index + f.length);
    }
    return out;
  }

  function addFormatReqs(reqs, segs, basePos) {
    let cp = basePos;
    for (const seg of segs) {
      const end = cp + seg.t.length;
      if (seg.b) reqs.push({ updateTextStyle: { range: { startIndex: cp, endIndex: end }, textStyle: { bold: true }, fields: 'bold' } });
      if (seg.i) reqs.push({ updateTextStyle: { range: { startIndex: cp, endIndex: end }, textStyle: { italic: true }, fields: 'italic' } });
      if (seg.c) reqs.push({ updateTextStyle: { range: { startIndex: cp, endIndex: end }, textStyle: { fontFamily: 'Consolas', fontSize: { magnitude: 9, unit: 'PT' } }, fields: 'fontFamily,fontSize' } });
      if (seg.l) reqs.push({ updateTextStyle: { range: { startIndex: cp, endIndex: end }, textStyle: { link: { url: seg.l } }, fields: 'link' } });
      cp = end;
    }
  }

  for (const rawLine of md.split('\n')) {
    const line = rawLine;
    if (/^-{3,}$/.test(line.trim())) {
      requests.push({ insertText: { location: { index: pos }, text: '\n' } });
      pos++;
      continue;
    }
    const hM = line.match(/^(#{1,3})\s+(.*)/);
    if (hM) {
      const lvl = hM[1].length;
      const segs = parseInline(hM[2]);
      const txt = segs.map(s => s.t).join('') + '\n';
      requests.push({ insertText: { location: { index: pos }, text: txt } });
      requests.push({ updateParagraphStyle: { range: { startIndex: pos, endIndex: pos + txt.length - 1 }, paragraphStyle: { namedStyleType: STYLES[lvl] }, fields: 'namedStyleType' } });
      addFormatReqs(requests, segs, pos);
      pos += txt.length;
      continue;
    }
    const lM = line.match(/^[\-\*]\s+(.*)/);
    const content = lM ? lM[1] : line;

    if (!lM && !content) {
      requests.push({ insertText: { location: { index: pos }, text: '\n' } });
      pos++;
      continue;
    }

    const segs = parseInline(content);
    const prefix = lM ? '• ' : '';
    const txt = prefix + segs.map(s => s.t).join('') + '\n';
    requests.push({ insertText: { location: { index: pos }, text: txt } });
    addFormatReqs(requests, segs, pos + prefix.length);
    pos += txt.length;
  }
  return requests;
}

// ── Docs Step 7: Write/append text to existing document ──
app.post("/api/docs/write", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id, content, mode } = req.body;
    if (!id || !content) return res.status(400).json({ error: "id and content required" });
    const token = await getDocsAccessToken(uid);
    const requests = [];
    if (mode === "replace") {
      // Fetch document first to get the actual end index
      const docRes = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const docData = await docRes.json();
      if (!docRes.ok) throw new Error(docData.error?.message || `Docs API error (${docRes.status})`);
      const endIdx = docData.body?.content?.[docData.body.content.length - 1]?.endIndex;
      if (endIdx && endIdx > 1) {
        requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex } } });
      }
    }
    requests.push(...markdownToDocsRequests(content));
    const writeRes = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests })
    });
    const data = await writeRes.json();
    if (!writeRes.ok) throw new Error(data.error?.message || `Docs API error (${writeRes.status})`);
    res.json({ written: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Docs Step 8: Delete a document (move to trash) ──
app.post("/api/docs/delete", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });
    const token = await getDocsAccessToken(uid);
    const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!delRes.ok) {
      const errData = await delRes.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Drive API error (${delRes.status})`);
    }
    res.json({ deleted: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Docs Step 9: Rename a document ──
app.post("/api/docs/rename", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id, title } = req.body;
    if (!id || !title) return res.status(400).json({ error: "id and title required" });
    const token = await getDocsAccessToken(uid);
    const renameRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: title })
    });
    const data = await renameRes.json();
    if (!renameRes.ok) throw new Error(data.error?.message || `Drive API error (${renameRes.status})`);
    res.json({ renamed: true, id: data.id, title: data.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
//  📽 GOOGLE SLIDES API
// ══════════════════════════════════════════════════════════════

const slidesStates = new Map();
const SLIDES_REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI || '').replace('/gmail/', '/slides/');

async function getSlidesTokens(uid) {
  const snap = await gmailDb().ref(`users/${uid}/slides`).once("value");
  return snap.val() || null;
}
async function setSlidesTokens(uid, tokens) {
  await gmailDb().ref(`users/${uid}/slides`).set(tokens);
}
async function refreshSlidesTokens(uid, current) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: current.refreshToken,
      grant_type: "refresh_token"
    })
  });
  const data = await tokenRes.json();
  if (!tokenRes.ok) throw new Error("Slides token refresh failed: " + (data.error || tokenRes.statusText));
  const tokens = { accessToken: data.access_token, refreshToken: current.refreshToken, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  await setSlidesTokens(uid, tokens);
  return tokens;
}
async function getSlidesAccessToken(uid) {
  const tokens = await getSlidesTokens(uid);
  if (!tokens || !tokens.refreshToken) throw new Error("Google Slides not connected");
  if (tokens.accessToken && tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  const refreshed = await refreshSlidesTokens(uid, tokens);
  return refreshed.accessToken;
}

function slideContentToRequests(slides, prefix = 'nx') {
  if (typeof slides === 'string') {
    slides = slides.split(/\n?---\n?/).map(s => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(slides) || !slides.length) return [];
  const requests = [];
  // parse inline markdown (bold/italic) from text, return clean text + style spans
  function parseText(text) {
    let clean = '';
    const spans = [];
    const lines = text.split('\n');
    for (const raw of lines) {
      let line = raw;
      // strip heading markers
      line = line.replace(/^#{1,3}\s+/, '');
      // strip bullet markers
      line = line.replace(/^[-*]\s+/, '');
      // strip numbered list markers
      line = line.replace(/^\d+[.)]\s+/, '');
      // re-process inline bold/italic on the cleaned line
      let i = 0;
      while (i < line.length) {
        if (line.slice(i, i + 2) === '**') {
          const e = line.indexOf('**', i + 2);
          if (e !== -1) { const s = clean.length; clean += line.slice(i + 2, e); spans.push({ start: s, end: clean.length, bold: true }); i = e + 2; continue; }
        }
        if (line[i] === '*' && line.slice(i, i + 2) !== '**') {
          const e = line.indexOf('*', i + 1);
          if (e !== -1 && line.slice(e, e + 2) !== '**') { const s = clean.length; clean += line.slice(i + 1, e); spans.push({ start: s, end: clean.length, italic: true }); i = e + 1; continue; }
        }
        clean += line[i]; i++;
      }
      clean += '\n';
    }
    return { clean: clean.replace(/\n$/, ''), spans };
  }
  const timestamp = Date.now();
  slides.forEach((text, idx) => {
    const slideId = `${prefix}_slide_${idx}_${timestamp}`;
    const shapeId = `${prefix}_shape_${idx}_${timestamp}`;
    requests.push({ createSlide: { objectId: slideId, insertionIndex: idx, slideLayoutReference: { predefinedLayout: "BLANK" } } });
    requests.push({ createShape: { objectId: shapeId, shapeType: "TEXT_BOX", elementProperties: { pageObjectId: slideId, size: { width: { magnitude: 660, unit: "PT" }, height: { magnitude: 450, unit: "PT" } }, transform: { scaleX: 1, scaleY: 1, translateX: 30, translateY: 30, unit: "PT" } } } });
    const { clean, spans } = parseText(text);
    if (clean) {
      requests.push({ insertText: { objectId: shapeId, text: clean, insertionIndex: 0 } });
      spans.forEach(sp => {
        const st = {};
        if (sp.bold) st.bold = true;
        if (sp.italic) st.italic = true;
        requests.push({ updateTextStyle: { objectId: shapeId, style: st, fields: Object.keys(st).join(','), textRange: { type: "FIXED_RANGE", startIndex: sp.start, endIndex: sp.end } } });
      });
    }
  });
  return requests;
}

// ── Slides Step 1: OAuth URL ──
app.get("/api/slides/auth-url", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const state = crypto.randomBytes(32).toString("hex");
    slidesStates.set(state, { uid, expiresAt: Date.now() + 600_000 });
    const scopes = "https://www.googleapis.com/auth/presentations https://www.googleapis.com/auth/drive";
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(SLIDES_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}&access_type=offline&prompt=consent` });
  } catch (err) { res.status(401).json({ error: err.message }); }
});

// ── Slides Step 2: OAuth callback ──
app.get("/api/slides/oauth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send("Missing code or state");
  const stored = slidesStates.get(state);
  if (!stored) return res.status(400).send("Invalid state");
  slidesStates.delete(state);
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: SLIDES_REDIRECT_URI, grant_type: "authorization_code" })
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(data.error || "Token exchange failed");
    const tokens = { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
    await setSlidesTokens(stored.uid, tokens);
    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:8888"}?slides=connected`);
  } catch (err) { res.status(500).send("Slides OAuth failed: " + err.message); }
});

// ── Slides Step 3: Check status ──
app.get("/api/slides/status", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const tokens = await getSlidesTokens(uid);
    res.json({ connected: !!(tokens && tokens.accessToken), expiresAt: tokens?.expiresAt || 0 });
  } catch { res.json({ connected: false, expiresAt: 0 }); }
});

// ── Slides Step 4: List via Drive API ──
app.post("/api/slides/list", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { query, maxResults } = req.body;
    const token = await getSlidesAccessToken(uid);
    const q = encodeURIComponent(query ? `name contains '${query.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.presentation'` : "mimeType='application/vnd.google-apps.presentation'");
    const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,modifiedTime,owners)&pageSize=${Math.min(maxResults || 10, 50)}&orderBy=modifiedTime desc`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await listRes.json();
    if (!listRes.ok) throw new Error(data.error?.message || `Drive API error (${listRes.status})`);
    res.json({ files: (data.files || []).map(f => ({ id: f.id, name: f.name, createdTime: f.createdTime, modifiedTime: f.modifiedTime, owner: f.owners?.[0]?.displayName || "" })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Slides Step 5: Read presentation ──
app.post("/api/slides/read", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });
    const token = await getSlidesAccessToken(uid);
    const readRes = await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await readRes.json();
    if (!readRes.ok) throw new Error(data.error?.message || `Slides API error (${readRes.status})`);
    const slides = (data.slides || []).map(slide => {
      const texts = (slide.pageElements || [])
        .filter(el => el.shape?.text?.textElements)
        .flatMap(el => el.shape.text.textElements
          .filter(te => te.textRun?.content)
          .map(te => te.textRun.content)
        );
      return { objectId: slide.objectId, text: texts.join('') };
    });
    res.json({ id: data.presentationId, title: data.title || "", slideCount: slides.length, slides });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Slides Step 6: Create presentation ──
app.post("/api/slides/create", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { title, slides } = req.body;
    if (!title) return res.status(400).json({ error: "title required" });
    const token = await getSlidesAccessToken(uid);
    const createRes = await fetch("https://slides.googleapis.com/v1/presentations", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
    const data = await createRes.json();
    if (!createRes.ok) throw new Error(data.error?.message || `Slides API error (${createRes.status})`);
    const requests = slideContentToRequests(slides);
    if (requests.length) {
      const batchRes = await fetch(`https://slides.googleapis.com/v1/presentations/${data.presentationId}:batchUpdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests })
      });
      if (!batchRes.ok) {
        const errData = await batchRes.json().catch(() => ({}));
        throw new Error("Slide creation failed: " + (errData.error?.message || batchRes.statusText));
      }
    }
    res.json({ created: true, id: data.presentationId, title: data.title || title, url: `https://docs.google.com/presentation/d/${data.presentationId}/edit`, slideCount: (slides ? (Array.isArray(slides) ? slides.length : slides.split(/\n?---\n?/).filter(Boolean).length) : 0) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Slides Step 7: Write / add slides ──
app.post("/api/slides/write", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id, slides, mode } = req.body;
    if (!id || !slides) return res.status(400).json({ error: "id and slides required" });
    const token = await getSlidesAccessToken(uid);
    const requests = [];
    if (mode === "replace") {
      // Fetch presentation to find existing slide IDs
      const presRes = await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const presData = await presRes.json();
      if (!presRes.ok) throw new Error(presData.error?.message || `Slides API error (${presRes.status})`);
      (presData.slides || []).forEach(s => {
        requests.push({ deleteObject: { objectId: s.objectId } });
      });
    }
    requests.push(...slideContentToRequests(slides));
    if (requests.length) {
      const batchRes = await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(id)}:batchUpdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests })
      });
      const data = await batchRes.json();
      if (!batchRes.ok) throw new Error(data.error?.message || `Slides API error (${batchRes.status})`);
    }
    res.json({ written: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Slides Step 8: Delete ──
app.post("/api/slides/delete", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });
    const token = await getSlidesAccessToken(uid);
    const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!delRes.ok) { const errData = await delRes.json().catch(() => ({})); throw new Error(errData.error?.message || `Drive API error (${delRes.status})`); }
    res.json({ deleted: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Slides Step 9: Rename ──
app.post("/api/slides/rename", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id, title } = req.body;
    if (!id || !title) return res.status(400).json({ error: "id and title required" });
    const token = await getSlidesAccessToken(uid);
    const renameRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: title })
    });
    const data = await renameRes.json();
    if (!renameRes.ok) throw new Error(data.error?.message || `Drive API error (${renameRes.status})`);
    res.json({ renamed: true, id: data.id, title: data.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
//  📊 GOOGLE SHEETS API
// ══════════════════════════════════════════════════════════════

const sheetsStates = new Map();
const SHEETS_REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI || '').replace('/gmail/', '/sheets/');

async function getSheetsTokens(uid) {
  const snap = await gmailDb().ref(`users/${uid}/sheets`).once("value");
  return snap.val() || null;
}
async function setSheetsTokens(uid, tokens) {
  await gmailDb().ref(`users/${uid}/sheets`).set(tokens);
}
async function refreshSheetsTokens(uid, current) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: current.refreshToken,
      grant_type: "refresh_token"
    })
  });
  const data = await tokenRes.json();
  if (!tokenRes.ok) throw new Error("Sheets token refresh failed: " + (data.error || tokenRes.statusText));
  const tokens = { accessToken: data.access_token, refreshToken: current.refreshToken, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  await setSheetsTokens(uid, tokens);
  return tokens;
}
async function getSheetsAccessToken(uid) {
  const tokens = await getSheetsTokens(uid);
  if (!tokens || !tokens.refreshToken) throw new Error("Google Sheets not connected");
  if (tokens.accessToken && tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  const refreshed = await refreshSheetsTokens(uid, tokens);
  return refreshed.accessToken;
}

// ── Sheets Step 1: OAuth URL ──
app.get("/api/sheets/auth-url", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const state = crypto.randomBytes(32).toString("hex");
    sheetsStates.set(state, { uid, expiresAt: Date.now() + 600_000 });
    const scopes = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive";
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(SHEETS_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}&access_type=offline&prompt=consent` });
  } catch (err) { res.status(401).json({ error: err.message }); }
});

// ── Sheets Step 2: OAuth callback ──
app.get("/api/sheets/oauth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send("Missing code or state");
  const stored = sheetsStates.get(state);
  if (!stored) return res.status(400).send("Invalid state");
  sheetsStates.delete(state);
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: SHEETS_REDIRECT_URI, grant_type: "authorization_code" })
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(data.error || "Token exchange failed");
    const tokens = { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
    await setSheetsTokens(stored.uid, tokens);
    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:8888"}?sheets=connected`);
  } catch (err) { res.status(500).send("Sheets OAuth failed: " + err.message); }
});

// ── Sheets Step 3: Check status ──
app.get("/api/sheets/status", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const tokens = await getSheetsTokens(uid);
    res.json({ connected: !!(tokens && tokens.accessToken), expiresAt: tokens?.expiresAt || 0 });
  } catch { res.json({ connected: false, expiresAt: 0 }); }
});

// ── Sheets Step 4: List via Drive API ──
app.post("/api/sheets/list", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { query, maxResults } = req.body;
    const token = await getSheetsAccessToken(uid);
    const q = encodeURIComponent(query ? `name contains '${query.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.spreadsheet'` : "mimeType='application/vnd.google-apps.spreadsheet'");
    const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,modifiedTime,owners)&pageSize=${Math.min(maxResults || 10, 50)}&orderBy=modifiedTime desc`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await listRes.json();
    if (!listRes.ok) throw new Error(data.error?.message || `Drive API error (${listRes.status})`);
    res.json({ files: (data.files || []).map(f => ({ id: f.id, name: f.name, createdTime: f.createdTime, modifiedTime: f.modifiedTime, owner: f.owners?.[0]?.displayName || "" })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sheets Step 5: Read cell values ──
app.post("/api/sheets/read", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id, range } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });
    const token = await getSheetsAccessToken(uid);
    const rangeEnc = encodeURIComponent(range || "A1:ZZ");
    const readRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${rangeEnc}?majorDimension=ROWS`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await readRes.json();
    if (!readRes.ok) throw new Error(data.error?.message || `Sheets API error (${readRes.status})`);
    res.json({ id, range: data.range || range, values: data.values || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sheets Step 6: Create spreadsheet ──
app.post("/api/sheets/create", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { title, data } = req.body;
    if (!title) return res.status(400).json({ error: "title required" });
    const token = await getSheetsAccessToken(uid);
    const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: { title } })
    });
    const created = await createRes.json();
    if (!createRes.ok) throw new Error(created.error?.message || `Sheets API error (${createRes.status})`);
    const sheetId = created.spreadsheetId;
    // If data provided, write it starting at A1
    if (data && Array.isArray(data) && data.length) {
      const rangeEnc = encodeURIComponent("A1");
      const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${rangeEnc}?valueInputOption=USER_ENTERED`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: data, majorDimension: "ROWS" })
      });
      if (!writeRes.ok) {
        const errData = await writeRes.json().catch(() => ({}));
        throw new Error("Sheet created but data write failed: " + (errData.error?.message || writeRes.statusText));
      }
    }
    res.json({ created: true, id: sheetId, title, url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sheets Step 7: Write / append data ──
app.post("/api/sheets/write", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id, range, values, mode } = req.body;
    if (!id || !values) return res.status(400).json({ error: "id and values required" });
    const token = await getSheetsAccessToken(uid);
    const rangeEnc = encodeURIComponent(range || "A1");
    let writeRes;
    if (mode === "append") {
      writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${rangeEnc}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values, majorDimension: "ROWS" })
      });
    } else {
      writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${rangeEnc}?valueInputOption=USER_ENTERED`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values, majorDimension: "ROWS" })
      });
    }
    const writeData = await writeRes.json();
    if (!writeRes.ok) throw new Error(writeData.error?.message || `Sheets API error (${writeRes.status})`);
    res.json({ written: true, id, updatedCells: writeData.updatedCells || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sheets Step 8: Delete ──
app.post("/api/sheets/delete", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });
    const token = await getSheetsAccessToken(uid);
    const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!delRes.ok) { const errData = await delRes.json().catch(() => ({})); throw new Error(errData.error?.message || `Drive API error (${delRes.status})`); }
    res.json({ deleted: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sheets Step 9: Rename ──
app.post("/api/sheets/rename", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id, title } = req.body;
    if (!id || !title) return res.status(400).json({ error: "id and title required" });
    const token = await getSheetsAccessToken(uid);
    const renameRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: title })
    });
    const data = await renameRes.json();
    if (!renameRes.ok) throw new Error(data.error?.message || `Drive API error (${renameRes.status})`);
    res.json({ renamed: true, id: data.id, title: data.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
//  📅 GOOGLE CALENDAR API
// ══════════════════════════════════════════════════════════════

const calendarStates = new Map();
const CALENDAR_REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI || '').replace('/gmail/', '/calendar/');

async function getCalendarTokens(uid) {
  const snap = await gmailDb().ref(`users/${uid}/calendar`).once("value");
  return snap.val() || null;
}
async function setCalendarTokens(uid, tokens) {
  await gmailDb().ref(`users/${uid}/calendar`).set(tokens);
}
async function refreshCalendarTokens(uid, current) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: current.refreshToken,
      grant_type: "refresh_token"
    })
  });
  const data = await tokenRes.json();
  if (!tokenRes.ok) throw new Error("Calendar token refresh failed: " + (data.error || tokenRes.statusText));
  const tokens = { accessToken: data.access_token, refreshToken: current.refreshToken, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  await setCalendarTokens(uid, tokens);
  return tokens;
}
async function getCalendarAccessToken(uid) {
  const tokens = await getCalendarTokens(uid);
  if (!tokens || !tokens.refreshToken) throw new Error("Google Calendar not connected");
  if (tokens.accessToken && tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  const refreshed = await refreshCalendarTokens(uid, tokens);
  return refreshed.accessToken;
}

// ══════════════════════════════════════════════════════════════
//  👥 GOOGLE PEOPLE (CONTACTS) API
// ══════════════════════════════════════════════════════════════

const peopleStates = new Map();
const PEOPLE_REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI || '').replace('/gmail/', '/people/');
const PEOPLE_API = "https://people.googleapis.com/v1";
const PEOPLE_FIELDS = "names,emailAddresses,phoneNumbers,addresses,birthdays,organizations,biographies,nicknames,urls";

async function getPeopleTokens(uid) {
  const snap = await gmailDb().ref(`users/${uid}/people`).once("value");
  return snap.val() || null;
}
async function setPeopleTokens(uid, tokens) {
  await gmailDb().ref(`users/${uid}/people`).set(tokens);
}
async function refreshPeopleTokens(uid, current) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: current.refreshToken,
      grant_type: "refresh_token"
    })
  });
  const data = await tokenRes.json();
  if (!tokenRes.ok) throw new Error("People token refresh failed: " + (data.error || tokenRes.statusText));
  const tokens = { accessToken: data.access_token, refreshToken: current.refreshToken, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  await setPeopleTokens(uid, tokens);
  return tokens;
}
async function getPeopleAccessToken(uid) {
  const tokens = await getPeopleTokens(uid);
  if (!tokens || !tokens.refreshToken) throw new Error("Google People not connected");
  if (tokens.accessToken && tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  const refreshed = await refreshPeopleTokens(uid, tokens);
  return refreshed.accessToken;
}

// ── People Step 1: OAuth URL ──
app.get("/api/people/auth-url", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const state = crypto.randomBytes(32).toString("hex");
    peopleStates.set(state, { uid, expiresAt: Date.now() + 600_000 });
    const scopes = "https://www.googleapis.com/auth/contacts";
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(PEOPLE_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}&access_type=offline&prompt=consent` });
  } catch (err) { res.status(401).json({ error: err.message }); }
});

// ── People Step 2: OAuth callback ──
app.get("/api/people/oauth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send("Missing code or state");
  const stored = peopleStates.get(state);
  if (!stored) return res.status(400).send("Invalid state");
  peopleStates.delete(state);
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: PEOPLE_REDIRECT_URI, grant_type: "authorization_code" })
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(data.error || "Token exchange failed");
    const tokens = { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
    await setPeopleTokens(stored.uid, tokens);
    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:8888"}?people=connected`);
  } catch (err) { res.status(500).send("People OAuth failed: " + err.message); }
});

// ── People Step 3: Check status ──
app.get("/api/people/status", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const tokens = await getPeopleTokens(uid);
    res.json({ connected: !!(tokens && tokens.accessToken), expiresAt: tokens?.expiresAt || 0 });
  } catch { res.json({ connected: false, expiresAt: 0 }); }
});

// ── People Step 4: List/Search contacts ──
app.post("/api/people/list", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { query, maxResults } = req.body;
    const token = await getPeopleAccessToken(uid);
    if (query) {
      const params = new URLSearchParams({ query, pageSize: String(Math.min(maxResults || 10, 50)), readMask: PEOPLE_FIELDS });
      const searchRes = await fetch(`${PEOPLE_API}/people:searchContacts?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await searchRes.json();
      if (!searchRes.ok) throw new Error(data.error?.message || `People API error (${searchRes.status})`);
      res.json({ contacts: (data.results || []).map(r => r.person).filter(Boolean) });
    } else {
      const params = new URLSearchParams({ pageSize: String(Math.min(maxResults || 20, 200)), personFields: PEOPLE_FIELDS });
      const listRes = await fetch(`${PEOPLE_API}/people/me/connections?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await listRes.json();
      if (!listRes.ok) throw new Error(data.error?.message || `People API error (${listRes.status})`);
      res.json({ contacts: (data.connections || []).filter(Boolean) });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── People Step 5: Get single contact ──
app.post("/api/people/get", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { resourceName } = req.body;
    if (!resourceName) return res.status(400).json({ error: "resourceName required" });
    const token = await getPeopleAccessToken(uid);
    const params = new URLSearchParams({ personFields: PEOPLE_FIELDS });
    const getRes = await fetch(`${PEOPLE_API}/${encodeURIComponent(resourceName)}?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await getRes.json();
    if (!getRes.ok) throw new Error(data.error?.message || `People API error (${getRes.status})`);
    res.json({ contact: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── People Step 6: Create contact ──
app.post("/api/people/create", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const body = req.body;
    if (!body || (!body.names && !body.emailAddresses && !body.phoneNumbers)) return res.status(400).json({ error: "At least one of names, emailAddresses, or phoneNumbers required" });
    const token = await getPeopleAccessToken(uid);
    const createRes = await fetch(`${PEOPLE_API}/people:createContact`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await createRes.json();
    if (!createRes.ok) throw new Error(data.error?.message || `People API error (${createRes.status})`);
    const name = data.names?.[0]?.displayName || data.resourceName || "Contact";
    res.json({ contact: data, created: true, summary: `${name} created` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── People Step 7: Update contact ──
app.post("/api/people/update", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { resourceName, ...fields } = req.body;
    if (!resourceName) return res.status(400).json({ error: "resourceName required" });
    const allowedFields = ["names","emailAddresses","phoneNumbers","addresses","birthdays","organizations","biographies","nicknames","urls"];
    const updateFields = Object.keys(fields).filter(k => allowedFields.includes(k)).join(",");
    if (!updateFields) return res.status(400).json({ error: "No valid fields to update" });
    const token = await getPeopleAccessToken(uid);
    const params = new URLSearchParams({ updatePersonFields: updateFields });
    const updateRes = await fetch(`${PEOPLE_API}/${encodeURIComponent(resourceName)}:updateContact?${params}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(fields)
    });
    const data = await updateRes.json();
    if (!updateRes.ok) throw new Error(data.error?.message || `People API error (${updateRes.status})`);
    const name = data.names?.[0]?.displayName || data.resourceName || "Contact";
    res.json({ contact: data, updated: true, summary: `${name} updated` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const CAL_API = "https://www.googleapis.com/calendar/v3";

// ── Calendar Step 1: OAuth URL ──
app.get("/api/calendar/auth-url", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const state = crypto.randomBytes(32).toString("hex");
    calendarStates.set(state, { uid, expiresAt: Date.now() + 600_000 });
    const scopes = "https://www.googleapis.com/auth/calendar.events";
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(CALENDAR_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}&access_type=offline&prompt=consent` });
  } catch (err) { res.status(401).json({ error: err.message }); }
});

// ── Calendar Step 2: OAuth callback ──
app.get("/api/calendar/oauth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send("Missing code or state");
  const stored = calendarStates.get(state);
  if (!stored) return res.status(400).send("Invalid state");
  calendarStates.delete(state);
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: CALENDAR_REDIRECT_URI, grant_type: "authorization_code" })
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(data.error || "Token exchange failed");
    const tokens = { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
    await setCalendarTokens(stored.uid, tokens);
    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:8888"}?calendar=connected`);
  } catch (err) { res.status(500).send("Calendar OAuth failed: " + err.message); }
});

// ── Calendar Step 3: Check status ──
app.get("/api/calendar/status", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const tokens = await getCalendarTokens(uid);
    res.json({ connected: !!(tokens && tokens.accessToken), expiresAt: tokens?.expiresAt || 0 });
  } catch { res.json({ connected: false, expiresAt: 0 }); }
});

// ── Calendar Step 4: List upcoming events ──
app.post("/api/calendar/list", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { maxResults, timeMin, timeMax } = req.body;
    const token = await getCalendarAccessToken(uid);
    const params = new URLSearchParams({ orderBy: "startTime", singleEvents: "true", maxResults: String(Math.min(maxResults || 10, 50)) });
    params.set("timeMin", timeMin || new Date().toISOString());
    if (timeMax) params.set("timeMax", timeMax);
    const listRes = await fetch(`${CAL_API}/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await listRes.json();
    if (!listRes.ok) throw new Error(data.error?.message || `Calendar API error (${listRes.status})`);
    res.json({ events: (data.items || []).map(e => ({ id: e.id, summary: e.summary || "(no title)", description: e.description || "", start: e.start, end: e.end, status: e.status, location: e.location || "", hangoutLink: e.hangoutLink || "" })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Calendar Step 5: Read event ──
app.post("/api/calendar/read", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id, eventId } = req.body;
    const evId = id || eventId;
    if (!evId) return res.status(400).json({ error: "id required" });
    const token = await getCalendarAccessToken(uid);
    const readRes = await fetch(`${CAL_API}/calendars/primary/events/${encodeURIComponent(evId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await readRes.json();
    if (!readRes.ok) throw new Error(data.error?.message || `Calendar API error (${readRes.status})`);
    res.json({ event: { id: data.id, summary: data.summary, description: data.description, start: data.start, end: data.end, status: data.status, location: data.location, htmlLink: data.htmlLink, hangoutLink: data.hangoutLink, createdAt: data.created, updated: data.updated, creator: data.creator, attendees: data.attendees || [] } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Calendar Step 6: Create event ──
app.post("/api/calendar/create", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { summary, description, start, end, location, attendees } = req.body;
    if (!summary || !start || !end) return res.status(400).json({ error: "summary, start, and end required" });
    const token = await getCalendarAccessToken(uid);
    const body = { summary, description: description || "", start, end };
    if (location) body.location = location;
    if (attendees) body.attendees = attendees.map(email => ({ email }));
    const createRes = await fetch(`${CAL_API}/calendars/primary/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await createRes.json();
    if (!createRes.ok) throw new Error(data.error?.message || `Calendar API error (${createRes.status})`);
    res.json({ event: { id: data.id, summary: data.summary, htmlLink: data.htmlLink, start: data.start, end: data.end } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Calendar Step 7: Quick add ──
app.post("/api/calendar/quick-add", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });
    const token = await getCalendarAccessToken(uid);
    const qaRes = await fetch(`${CAL_API}/calendars/primary/events/quickAdd?text=${encodeURIComponent(text)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await qaRes.json();
    if (!qaRes.ok) throw new Error(data.error?.message || `Calendar API error (${qaRes.status})`);
    res.json({ event: { id: data.id, summary: data.summary, htmlLink: data.htmlLink, start: data.start, end: data.end } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Calendar Step 8: Update event ──
app.post("/api/calendar/update", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id, eventId, ...fields } = req.body;
    const evId = id || eventId;
    if (!evId) return res.status(400).json({ error: "id required" });
    const token = await getCalendarAccessToken(uid);
    const updRes = await fetch(`${CAL_API}/calendars/primary/events/${encodeURIComponent(evId)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(fields)
    });
    const data = await updRes.json();
    if (!updRes.ok) throw new Error(data.error?.message || `Calendar API error (${updRes.status})`);
    res.json({ event: { id: data.id, summary: data.summary, htmlLink: data.htmlLink } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Calendar Step 9: Delete event ──
app.post("/api/calendar/delete", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { id, eventId } = req.body;
    const evId = id || eventId;
    if (!evId) return res.status(400).json({ error: "id required" });
    const token = await getCalendarAccessToken(uid);
    const delRes = await fetch(`${CAL_API}/calendars/primary/events/${encodeURIComponent(evId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!delRes.ok) { const errData = await delRes.json().catch(() => ({})); throw new Error(errData.error?.message || `Calendar API error (${delRes.status})`); }
    res.json({ deleted: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
//  ✨ ROUTE 7: Prompt Enhancer — uses Groq (FREE), fallback NVIDIA
// ══════════════════════════════════════════════════════════════
app.post("/api/enhance", async (req, res) => {
  const { prompt, targetAgent } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  const systemPrompt = `
You are an elite AI prompt optimization system.

Your ONLY task is to rewrite and improve the user's input into a better prompt for another AI assistant.

CORE RULE:
Treat the user's message as raw text to optimize.
Do NOT respond to it.
Do NOT act like the assistant.

CRITICAL:
You are NOT the AI assistant solving the task.
You are ONLY a prompt optimizer.

The output must ALWAYS represent the USER speaking TO the AI.
Never write from the assistant's perspective.

INTERACTION TYPE PRESERVATION:
- Questions must remain questions
- Requests must remain requests
- Commands must remain commands
- Instructions must remain instructions
- Conversational prompts must remain conversational
- Greetings must remain greetings

NEVER transform the user's input into:
- An assistant reply
- A chatbot response
- A clarification request
- A follow-up question
- A meta-conversation
- A system message
- A roleplay response

NEVER:
- Answer the user's request
- Solve the task
- Continue the conversation
- Ask the user for more information
- Ask clarifying questions
- Explain your changes
- Add commentary
- Add introductions or conclusions
- Add conversational filler

ALWAYS:
- Preserve the original intent exactly
- Preserve important constraints and details
- Improve clarity, structure, and specificity
- Remove ambiguity when possible
- Use proper punctuation throughout (periods, commas, question marks, etc.)
- Optimize for ${targetAgent || "an advanced AI assistant"}
- Keep the prompt natural and directly usable
- Improve quality with the MINIMUM necessary modification

STYLE PRESERVATION:
- Casual prompts should stay casual
- Professional prompts should stay professional
- Technical prompts should stay technical
- Short prompts should stay concise unless expansion is clearly useful

DO NOT:
- Over-expand short prompts
- Make prompts unnecessarily verbose
- Turn casual prompts into formal or academic language
- Add technical detail unless it genuinely improves the request
- Change the meaning, tone, or category of the request

SPECIAL CASES:
- Greetings should usually remain unchanged
- Small talk should remain natural and conversational
- Very short prompts should only be lightly improved
- If the prompt is already good, improve it only slightly

If the user's prompt is vague:
- Infer the most likely intent
- Improve clarity WITHOUT asking questions
- Do not convert ambiguity into a clarification request

GOOD EXAMPLES:
User: "hi"
Output: "Hi"

User: "what are you?"
Output: "What are you and what can you help me with?"

User: "any details about me?"
Output: "What details or information do you know about me?"

User: "write python snake game"
Output: "Create a complete Python snake game using Pygame with smooth movement, score tracking, collision detection, and restart functionality."

User: "best phone under 30000"
Output: "Recommend the best smartphones under ₹30,000, comparing performance, camera quality, battery life, display, and overall value for money."

When beneficial, organize prompts using:
- Goal
- Context
- Requirements
- Constraints
- Output format

OUTPUT RULES:
- Return ONLY the rewritten prompt
- No labels
- No explanations
- No markdown
- No quotation marks
- No code fences
- No extra text before or after the prompt
`;

  // Primary: Groq (free, fast)
  if (process.env.GROQ_API_KEY) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
          max_tokens: 500,
          temperature: 0.3
        })
      });
      const data = await response.json();
      const enhanced = data.choices?.[0]?.message?.content || prompt;
      return res.json({ result: enhanced });
    } catch (err) {
      // fall through to NVIDIA fallback
    }
  }

  // Fallback: NVIDIA NIM (gpt-oss-120b) — also free
  if (process.env.NVIDIA_KEY_GPTOSS) {
    try {
      const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.NVIDIA_KEY_GPTOSS}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
          max_tokens: 500,
          temperature: 0.3,
          stream: false
        })
      });
      const raw = await response.text();
      const data = JSON.parse(raw);
      return res.json({ result: data.choices?.[0]?.message?.content || prompt });
    } catch (err) {
      // safe fallback
    }
  }

  res.json({ result: prompt }); // last resort: return original
});

// ══════════════════════════════════════════════════════════════
//  🧠 ROUTE 8: Memory Extraction — uses Groq LLaMA (FREE)
// ══════════════════════════════════════════════════════════════
app.post("/api/extract-memory", async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) return res.json({ memories: [] });

  if (!process.env.GROQ_API_KEY) return res.json({ memories: [] });

  const systemPrompt = `You are a precision memory extraction AI. Analyze this conversation snippet and extract 0–3 important, reusable facts ABOUT THE USER that would genuinely help personalize future conversations.

EXTRACTION RULES:
- Only extract facts the USER explicitly stated about themselves (not questions they asked)
- Target: name, age, profession, location, skills, ongoing projects, strong preferences, clear goals
- Each memory = one clear sentence starting with "User"
- Category options: "personal" (identity/demographics), "preference" (tastes/style/habits), "project" (active work/goals), "context" (important background knowledge)
- Be conservative — only facts that are genuinely memorable and reusable across future chats
- If nothing worth remembering, return exactly: []
- CRITICAL: Return ONLY a valid JSON array. No explanation, no markdown fences, no extra text.

Example output: [{"content":"User is a 20-year-old computer science student in India","category":"personal"},{"content":"User prefers concise, technical explanations over verbose ones","category":"preference"}]`;

  try {
    const convText = messages
      .filter(m => m.role !== "system")
      .slice(-4)
      .map(m => `${m.role === "user" ? "USER" : "AI"}: ${String(m.content || "").slice(0, 500)}`)
      .join("\n\n");

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Extract memorable user facts from this conversation:\n\n${convText}` }
        ],
        max_tokens: 400,
        temperature: 0.1
      })
    });

    const data = await response.json();
    let rawText = data.choices?.[0]?.message?.content?.trim() || "[]";

    let memories = [];
    try {
      rawText = rawText.replace(/```(?:json)?\n?/g, "").replace(/```\n?/g, "").trim();
      const match = rawText.match(/\[[\s\S]*\]/);
      if (match) rawText = match[0];
      memories = JSON.parse(rawText);
      if (!Array.isArray(memories)) memories = [];
      memories = memories
        .filter(m => m && typeof m.content === "string" && m.content.trim().length > 0)
        .slice(0, 3);
    } catch {
      memories = [];
    }

    res.json({ memories });
  } catch (err) {
    res.json({ memories: [] });
  }
});

// ══════════════════════════════════════════════════════════════
//  🔬 DEEP RESEARCH MODE ENGINE
// ══════════════════════════════════════════════════════════════

const BACKEND_AGENT_NAMES = {
  openai: "GPT-OSS 120B (NIM)",
  "nvidia-llama": "LLaMA 3.3 70B (NIM)",
  deepseek: "Kimi K2.6 (NIM)",
  gemma4: "Gemma 4 31B IT (NIM)",
  gemini: "Gemini Flash",
  mistral: "Mistral Large",
  codestral: "Codestral",
  cohere: "Cohere R+",
  groq: "LLaMA Groq"
};

function getBackendAgentName(a) {
  return BACKEND_AGENT_NAMES[a] || "AI Agent";
}

const RESPONSE_STYLE_INSTRUCTION = "Default to short, concise, effective answers. There is no fixed word limit: expand only when the user's request, task complexity, safety, code or document output, research/debate mode, or necessary nuance clearly requires more detail. Use focused bullet points or compact paragraphs where appropriate. Avoid padding, repetition, unnecessary background, and raw walls of text.";

function hasResponseStyleInstruction(messages) {
  return messages.some(m => typeof m.content === "string" && m.content.includes("Default to short, concise, effective answers"));
}

function addResponseStyleInstructionToMessages(messages) {
  if (!Array.isArray(messages) || hasResponseStyleInstruction(messages)) return messages;

  if (messages[0]?.role === "system") {
    return [
      { ...messages[0], content: `${messages[0].content}\n\n${RESPONSE_STYLE_INSTRUCTION}` },
      ...messages.slice(1)
    ];
  }

  return [{ role: "system", content: RESPONSE_STYLE_INSTRUCTION }, ...messages];
}

function addResponseStyleInstructionToPrompt(prompt) {
  if (typeof prompt !== "string" || prompt.includes("Default to short, concise, effective answers")) return prompt;
  return `[Response Style Instruction: ${RESPONSE_STYLE_INSTRUCTION}]\n\n${prompt}`;
}

function getActiveAgent(requestedAgent) {
  const keys = {
    openai: process.env.NVIDIA_KEY_GPTOSS,
    "nvidia-llama": process.env.NVIDIA_KEY_LLAMA,
    deepseek: process.env.NVIDIA_KEY_KIMI,
    gemma4: process.env.NVIDIA_KEY_GEMMA4,
    gemini: process.env.GEMINI_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
    codestral: process.env.CODESTRAL_API_KEY,
    groq: process.env.GROQ_API_KEY,
    cohere: process.env.COHERE_API_KEY
  };

  if (keys[requestedAgent]) {
    return { agent: requestedAgent, fallback: false };
  }

  const fallbackOrder = ["gemini", "groq", "deepseek", "gemma4", "nvidia-llama", "openai", "mistral", "codestral", "cohere"];
  for (const agent of fallbackOrder) {
    if (keys[agent]) {
      return { agent, fallback: true, original: requestedAgent };
    }
  }

  return { agent: requestedAgent, fallback: false };
}

async function callNvidiaModelBackend(model, apiKey, messages) {
  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 16384,
      temperature: 0.7,
      stream: false
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices[0].message.content;
}

async function streamOpenAICompatibleTokens(res, url, headers, body, sendEvent) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, stream: true })
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
      } catch (e) { /* skip malformed chunks */ }
    }
  }
  return fullText;
}

async function callModelBackend(agent, messages) {
  if (agent === "gemini") {
    if (!process.env.GEMINI_API_KEY) throw new Error("Gemini key not configured.");
    const prompt = messages[messages.length - 1].content;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.candidates[0].content.parts[0].text;
  }

  if (agent === "groq") {
    if (!process.env.GROQ_API_KEY) throw new Error("Groq key not configured.");
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        max_tokens: 8192
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  }

  if (agent === "nvidia-llama") {
    if (!process.env.NVIDIA_KEY_LLAMA) throw new Error("NVIDIA LLaMA key not configured.");
    return await callNvidiaModelBackend("meta/llama-3.3-70b-instruct", process.env.NVIDIA_KEY_LLAMA, messages);
  }

  if (agent === "deepseek") {
    if (!process.env.NVIDIA_KEY_KIMI) throw new Error("Kimi (NVIDIA NIM) key not configured for DeepSeek agent.");
    return await callNvidiaModelBackend("moonshotai/kimi-k2.6", process.env.NVIDIA_KEY_KIMI, messages);
  }

  if (agent === "gemma4") {
    if (!process.env.NVIDIA_KEY_GEMMA4) throw new Error("Gemma 4 key not configured.");
    return await callNvidiaModelBackend("google/gemma-4-31b-it", process.env.NVIDIA_KEY_GEMMA4, messages);
  }

  if (agent === "openai") {
    if (!process.env.NVIDIA_KEY_GPTOSS) throw new Error("NVIDIA GPTOSS key not configured.");
    return await callNvidiaModelBackend("openai/gpt-oss-120b", process.env.NVIDIA_KEY_GPTOSS, messages);
  }

  if (agent === "mistral") {
    if (!process.env.MISTRAL_API_KEY) throw new Error("Mistral key not configured.");
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mistral-large-latest",
        messages,
        max_tokens: 16384
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  }

  if (agent === "codestral") {
    if (!process.env.CODESTRAL_API_KEY) throw new Error("Codestral key not configured.");
    const response = await fetch("https://codestral.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CODESTRAL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "codestral-latest",
        messages,
        max_tokens: 16384
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  }

  if (agent === "cohere") {
    if (!process.env.COHERE_API_KEY) throw new Error("Cohere key not configured.");
    const prompt = messages[messages.length - 1].content;
    const response = await fetch("https://api.cohere.com/v2/chat", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.COHERE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "command-r-plus-08-2024",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096
      })
    });
    const data = await response.json();
    if (data.message && typeof data.message === "string") throw new Error(data.message);
    const text = data.message?.content?.[0]?.text;
    if (!text) throw new Error("Cohere returned empty response.");
    return text;
  }

  throw new Error("Invalid agent selected.");
}

// ─────────────────────────────────────────────────────────────
//  In deep research mode every branch always attempts web
//  search; fetchWebContextForBranch() handles failures gracefully
//  by returning null when no data is available.
// ─────────────────────────────────────────────────────────────

/**
 * Builds a concise, targeted search query from the topic and branch context.
 */
function buildBranchSearchQuery(topic, branch) {
  const topicSlice  = topic.slice(0, 55).trim();
  const branchSlice = branch.name.slice(0, 45).trim();
  const possSlice   = (branch.possibilities || [])[0]?.slice(0, 35).trim() || "";
  return [topicSlice, branchSlice, possSlice].filter(Boolean).join(" ");
}

/**
 * Fetches live web results for a branch.
 * Priority: Tavily (AI-optimised + answer) → DuckDuckGo (free fallback).
 * Returns null on complete failure so callers degrade gracefully.
 */
async function fetchWebContextForBranch(topic, branch) {
  const query = buildBranchSearchQuery(topic, branch);

  // ── Try Tavily first (best quality) ──
  if (process.env.TAVILY_API_KEY) {
    try {
      const result = await handleTavilySearch(query);
      if (result && result.results && result.results.length > 0) {
        return {
          query,
          service: "Tavily",
          icon: "🔮",
          results: result.results.slice(0, 5),
          answer: result.answer || null
        };
      }
    } catch (_) { /* silent — fall through */ }
  }

  // ── DuckDuckGo fallback (always free, no key needed) ──
  try {
    const results = await handleDuckDuckGoSearch(query);
    if (results && results.length > 0) {
      return {
        query,
        service: "DuckDuckGo",
        icon: "🦆",
        results: results.slice(0, 5),
        answer: null
      };
    }
  } catch (_) { /* silent */ }

  return null; // No usable web data — AI will reason from training only
}

/**
 * Formats web search results into a structured prompt injection block.
 * Designed to be appended to branch analysis prompts.
 */
function formatWebContextForPrompt(webContext) {
  if (!webContext || !webContext.results || webContext.results.length === 0) return "";

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  let block = "\n\n---\n";
  block += `🌐 LIVE WEB SEARCH RESULTS\n`;
  block += `Query: "${webContext.query}"\n`;
  block += `Retrieved: ${today} | Source: ${webContext.service}\n`;

  if (webContext.answer) {
    block += `\n📋 AI Summary: ${webContext.answer}\n`;
  }

  block += `\n━━━ Results ━━━\n\n`;

  webContext.results.forEach((r, i) => {
    block += `[${i + 1}] ${r.title || "Untitled"}`;
    if (r.date) block += ` (${r.date})`;
    block += "\n";
    const snippet = (r.snippet || r.content || r.text || "").slice(0, 350);
    if (snippet) block += `   ${snippet}\n`;
    if (r.url) block += `   🔗 ${r.url}\n`;
    block += "\n";
  });

  block += "━━━━━━━━━━━━━━━━━━━\n";
  block += "INSTRUCTIONS:\n";
  block += "• SYNTHESIZE both your training knowledge AND the web data above to produce the best answer.\n";
  block += "• Use real-time numbers, figures, and facts from the web to make your response accurate and current.\n";
  block += "• Use your training knowledge to provide context, analyze historical and current trends, and accurately predict future trends and situations based on this data.\n";
  block += "• Keep the final answer concise by default; expand only when the user's request or required nuance calls for it. Do not follow a fixed word limit.\n";
  block += "• Cite web sources by number, e.g. [1]. When combining both sources, note what comes from web vs training.\n";
  block += "• If web data conflicts with your training knowledge, defer to the web data (it is more current).\n";
  block += "• Dates are shown where available — prefer more recent sources for time-sensitive topics.\n";

  return block;
}

// ══════════════════════════════════════════════════════════════
//  🌟 AGENTIC ENGINE CORE HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════

async function executeAgenticSearch(agent, query, sendEvent = null) {
  if (sendEvent) sendEvent({ type: "status", message: `🔍 Initiating search for: "${query.slice(0,40)}..."` });
  
  let webContext = null;
  const fakeBranch = { name: query, possibilities: [] };
  webContext = await fetchWebContextForBranch(query, fakeBranch);
  
  if (!webContext) return null;
  
  const evalPrompt = `You are a research evaluator. 
I have performed a web search for the query: "${query}".
Here are the results:
${formatWebContextForPrompt(webContext)}

Does this provide sufficient and accurate information to provide a deep, well-rounded response? 
If YES, output exactly the word "SUFFICIENT" and nothing else.
If NO, output EXACTLY ONE new, improved search query to find the missing information (just the query string, no quotes).`;

  if (sendEvent) sendEvent({ type: "status", message: "🤔 Evaluating search sufficiency..." });
  
  try {
    const evalResponse = await callModelBackend(agent, [{ role: "user", content: evalPrompt }]);
    const evalText = evalResponse.trim();
    
    if (evalText !== "SUFFICIENT") {
      if (sendEvent) sendEvent({ type: "status", message: `🔄 Refining search: "${evalText.slice(0, 40)}..."` });
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

// ══════════════════════════════════════════════════════════════
//  🏭 Backend Marker Processor — executes all 27 marker types
//  Called after LLM streaming completes, and by the task scheduler
// ══════════════════════════════════════════════════════════════
const MARKER_RE = {
  GMAIL_SEND:      /\[GMAIL_SEND\](.*?)\[\/GMAIL_SEND\]/gs,
  GMAIL_SEARCH:    /\[GMAIL_SEARCH\](.*?)\[\/GMAIL_SEARCH\]/gs,
  GMAIL_READ:      /\[GMAIL_READ\](.*?)\[\/GMAIL_READ\]/gs,
  DOCS_LIST:       /\[DOCS_LIST\](.*?)\[\/DOCS_LIST\]/gs,
  DOCS_READ:       /\[DOCS_READ\](.*?)\[\/DOCS_READ\]/gs,
  DOCS_CREATE:     /\[DOCS_CREATE\](.*?)\[\/DOCS_CREATE\]/gs,
  DOCS_WRITE:      /\[DOCS_WRITE\](.*?)\[\/DOCS_WRITE\]/gs,
  DOCS_DELETE:     /\[DOCS_DELETE\](.*?)\[\/DOCS_DELETE\]/gs,
  DOCS_RENAME:     /\[DOCS_RENAME\](.*?)\[\/DOCS_RENAME\]/gs,
  SLIDES_LIST:     /\[SLIDES_LIST\](.*?)\[\/SLIDES_LIST\]/gs,
  SLIDES_READ:     /\[SLIDES_READ\](.*?)\[\/SLIDES_READ\]/gs,
  SLIDES_CREATE:   /\[SLIDES_CREATE\](.*?)\[\/SLIDES_CREATE\]/gs,
  SLIDES_WRITE:    /\[SLIDES_WRITE\](.*?)\[\/SLIDES_WRITE\]/gs,
  SLIDES_DELETE:   /\[SLIDES_DELETE\](.*?)\[\/SLIDES_DELETE\]/gs,
  SLIDES_RENAME:   /\[SLIDES_RENAME\](.*?)\[\/SLIDES_RENAME\]/gs,
  SHEETS_LIST:     /\[SHEETS_LIST\](.*?)\[\/SHEETS_LIST\]/gs,
  SHEETS_READ:     /\[SHEETS_READ\](.*?)\[\/SHEETS_READ\]/gs,
  SHEETS_CREATE:   /\[SHEETS_CREATE\](.*?)\[\/SHEETS_CREATE\]/gs,
  SHEETS_WRITE:    /\[SHEETS_WRITE\](.*?)\[\/SHEETS_WRITE\]/gs,
  SHEETS_DELETE:   /\[SHEETS_DELETE\](.*?)\[\/SHEETS_DELETE\]/gs,
  SHEETS_RENAME:   /\[SHEETS_RENAME\](.*?)\[\/SHEETS_RENAME\]/gs,
  CALENDAR_LIST:   /\[CALENDAR_LIST\](.*?)\[\/CALENDAR_LIST\]/gs,
  CALENDAR_READ:   /\[CALENDAR_READ\](.*?)\[\/CALENDAR_READ\]/gs,
  CALENDAR_CREATE: /\[CALENDAR_CREATE\](.*?)\[\/CALENDAR_CREATE\]/gs,
  CALENDAR_QUICK_ADD: /\[CALENDAR_QUICK_ADD\](.*?)\[\/CALENDAR_QUICK_ADD\]/gs,
  CALENDAR_UPDATE: /\[CALENDAR_UPDATE\](.*?)\[\/CALENDAR_UPDATE\]/gs,
  CALENDAR_DELETE: /\[CALENDAR_DELETE\](.*?)\[\/CALENDAR_DELETE\]/gs,
  SAVE_MEMORY:     /\[SAVE_MEMORY\](.*?)\[\/SAVE_MEMORY\]/gs,
  PEOPLE_LIST:     /\[PEOPLE_LIST\](.*?)\[\/PEOPLE_LIST\]/gs,
  PEOPLE_GET:      /\[PEOPLE_GET\](.*?)\[\/PEOPLE_GET\]/gs,
  PEOPLE_CREATE:   /\[PEOPLE_CREATE\](.*?)\[\/PEOPLE_CREATE\]/gs,
  PEOPLE_UPDATE:   /\[PEOPLE_UPDATE\](.*?)\[\/PEOPLE_UPDATE\]/gs,
};

async function processMarkers(text, uid) {
  if (!text || !uid) return { cleanText: text || '' };
  let cleanText = text;

  function parseMarkerJsonOrAttrs(str) {
    try { return JSON.parse(str); } catch {}
    const attrs = {};
    str.replace(/(\w+)\s*=\s*"([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ''; });
    if (attrs.to || attrs.subject || attrs.body) return attrs;
    return null;
  }

  function markdownToHtml(s) {
    // Escape HTML entities first
    let h = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inlineFmt = (t) => t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    // Convert markdown tables: consecutive |...| lines with a separator row
    h = h.replace(/((?:^[^\n]*\|[^\n]*$(?:\n|$))+)/gm, (block) => {
      const rows = block.trim().split('\n').filter(r => r.trim().startsWith('|'));
      if (rows.length < 3) return block; // need header + separator + at least 1 body row
      const sepIdx = rows.findIndex(r => /^\|[\s:-]+\|/.test(r));
      if (sepIdx < 0) return block;
      const headRow = rows[sepIdx - 1];
      const bodyRows = rows.slice(sepIdx + 1);
      if (!headRow || !bodyRows.length) return block;
      const cells = (r) => r.split('|').slice(1, -1).map(c => inlineFmt(c.trim()));
      let tbl = '<table><thead><tr>';
      cells(headRow).forEach(c => { tbl += `<th>${c}</th>`; });
      tbl += '</tr></thead><tbody>';
      bodyRows.forEach(r => { tbl += '<tr>'; cells(r).forEach(c => { tbl += `<td>${c}</td>`; }); tbl += '</tr>'; });
      tbl += '</tbody></table>';
      return tbl;
    });
    h = h
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^-{3,}$/gm, '<hr>')
      .replace(/^\* (.+)$/gm, '<li>$1</li>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    h = h.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    h = h.replace(/<table>[\s\S]*?<\/table>/g, m => m);
    h = h.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
    if (/^<table/i.test(h)) return h;
    return '<p>' + h + '</p>';
  }

  // ── GMAIL_SEND ──
  { let m; while ((m = MARKER_RE.GMAIL_SEND.exec(text)) !== null) {
    const raw = m[0], idx = m.index;
    let p = parseMarkerJsonOrAttrs(m[1]);
    if (p && p.to && p.subject && p.body) {
      try {
        const token = await getGmailAccessToken(uid);
        const htmlBody = markdownToHtml(p.body);
        const plainBody = p.body.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        const boundary = `boundary_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const email = [
          `From: me`,`To: ${p.to}`,`Subject: ${p.subject}`,
          `MIME-Version: 1.0`,
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          ``,
          `--${boundary}`,
          `Content-Type: text/plain; charset=UTF-8`,
          ``,
          plainBody,
          `--${boundary}`,
          `Content-Type: text/html; charset=UTF-8`,
          `Content-Transfer-Encoding: quoted-printable`,
          ``,
          `<!DOCTYPE html><html><body style="font-family:sans-serif;line-height:1.6">${htmlBody}</body></html>`,
          `--${boundary}--`
        ].join("\r\n");
        const raw64 = Buffer.from(email).toString("base64url");
        const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw: raw64 })
        });
        const d = await sendRes.json();
        if (sendRes.ok) cleanText = cleanText.replace(raw, `✅ Email sent to ${p.to} (subject: ${p.subject})`);
        else cleanText = cleanText.replace(raw, `⚠ Gmail send failed: ${d.error?.message || sendRes.statusText}`);
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Gmail send error: ${e.message}`); }
    }
  }}

  // ── GMAIL_SEARCH ──
  { let m; while ((m = MARKER_RE.GMAIL_SEARCH.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && p.query) {
      try {
        const token = await getGmailAccessToken(uid);
        const searchRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(p.query)}&maxResults=${Math.min(p.maxResults || 10, 50)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await searchRes.json();
        if (searchRes.ok && data.messages?.length) {
          const rows = (await Promise.all(data.messages.slice(0, 10).map(async (msg) => {
            try {
              const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(msg.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              const d = await r.json();
              const hdrs = (d.payload?.headers || []).reduce((a, h) => { a[h.name] = h.value; return a; }, {});
              const cleanFrom = (hdrs.From || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              const cleanSubject = hdrs.Subject || '(No Subject)';
              const cleanDate = hdrs.Date ? hdrs.Date.split(' ').slice(0, 4).join(' ') : '';
              const snippet = d.snippet || '';
              return `| **${cleanFrom}** <br> *${cleanDate}* | **${cleanSubject}** <br> ${snippet} | \`${msg.id}\` |`;
            } catch { return null; }
          }))).filter(Boolean);
          const table = [
            `### 📧 Gmail Search Results for "${p.query}"`,
            `| From & Date | Subject & Snippet | ID |`,
            `| :--- | :--- | :--- |`,
            ...rows
          ].join('\n');
          cleanText = cleanText.replace(raw, table);
        } else {
          cleanText = cleanText.replace(raw, `📧 No emails found for "${p.query}"`);
        }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Gmail search error: ${e.message}`); }
    }
  }}

  // ── GMAIL_READ ──
  { let m; while ((m = MARKER_RE.GMAIL_READ.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId)) {
      try {
        const token = await getGmailAccessToken(uid);
        const readRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(p.id || p.eventId)}?format=full`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await readRes.json();
        if (readRes.ok) {
          const hdrs = (data.payload?.headers || []).reduce((a, h) => { a[h.name] = h.value; return a; }, {});
          const { body, html, attachments } = parseMimeParts(data.payload);
          const cleanBody = body ? cleanEmailBody(body) : '(no plain text body found)';
          const links = html ? extractLinks(html) : [];
          const from = (hdrs.From || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const truncatedBody = cleanBody.slice(0, 4000).split('\n').map(line => `> ${line}`).join('\n');
          let card = [
            `### 📧 Email: ${hdrs.Subject || '(No Subject)'}`,
            `> **From:** ${from}`,
            `> **Date:** ${hdrs.Date || ''}`,
            `> **ID:** \`${data.id}\``,
            `>`,
            `---`,
            truncatedBody
          ].join('\n');
          if (links.length) {
            card += `\n\n**Links:**\n` + links.map(l => `- ${l}`).join('\n');
          }
          if (attachments.length) {
            card += `\n\n**Attachments:**\n` + attachments.map(a => `- ${a.filename} (${a.mimeType})`).join('\n');
          }
          cleanText = cleanText.replace(raw, card);
        } else {
          cleanText = cleanText.replace(raw, `⚠ Gmail read failed: ${data.error?.message || readRes.statusText}`);
        }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Gmail read error: ${e.message}`); }
    }
  }}

  // ── DOCS_LIST ──
  { let m; while ((m = MARKER_RE.DOCS_LIST.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    try {
      const token = await getDocsAccessToken(uid);
      const q = encodeURIComponent(p?.query
        ? `name contains '${p.query.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.document'`
        : "mimeType='application/vnd.google-apps.document'");
      const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,modifiedTime,owners)&pageSize=${Math.min(p?.maxResults || 10, 50)}&orderBy=modifiedTime desc`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await listRes.json();
      if (listRes.ok && data.files?.length) {
        const rows = data.files.map(f => {
          const mod = f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '—';
          return `| **${f.name}** | ${f.owners?.[0]?.displayName || '—'} | ${mod} | \`${f.id}\` |`;
        });
        const table = [
          `### 📝 Google Documents (${data.files.length})`,
          `| Document Name | Owner | Last Modified | ID |`,
          `| :--- | :--- | :--- | :--- |`,
          ...rows
        ].join('\n');
        cleanText = cleanText.replace(raw, table);
      } else {
        cleanText = cleanText.replace(raw, `📝 No documents found${p?.query ? ' for "' + p.query + '"' : ''}`);
      }
    } catch (e) { cleanText = cleanText.replace(raw, `⚠ Docs list error: ${e.message}`); }
  }}

  // ── DOCS_READ ──
  { let m; while ((m = MARKER_RE.DOCS_READ.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId)) {
      try {
        const token = await getDocsAccessToken(uid);
        const docRes = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(p.id || p.eventId)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await docRes.json();
        if (docRes.ok) {
          let body = '';
          if (data.body?.content) {
            const texts = [];
            const walk = (els) => { for (const el of els) { if (el.paragraph?.elements) for (const pe of el.paragraph.elements) { if (pe.textRun?.content) texts.push(pe.textRun.content); } if (el.table?.tableRows) for (const row of el.table.tableRows) if (row.tableCells) for (const cell of row.tableCells) walk(cell.content); } };
            walk(data.body.content);
            body = texts.join('');
          }
          cleanText = cleanText.replace(raw, `📝 Document: ${data.title || ''}\n\n${body.slice(0, 5000)}`);
        } else {
          cleanText = cleanText.replace(raw, `⚠ Docs read failed: ${data.error?.message || docRes.statusText}`);
        }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Docs read error: ${e.message}`); }
    }
  }}

  // ── DOCS_CREATE ──
  { let m; while ((m = MARKER_RE.DOCS_CREATE.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && p.title) {
      try {
        const token = await getDocsAccessToken(uid);
        const createRes = await fetch("https://docs.googleapis.com/v1/documents", {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ title: p.title })
        });
        const data = await createRes.json();
        if (createRes.ok) {
          const docId = data.documentId;
          if (p.body) {
            const reqs = markdownToDocsRequests(p.body);
            if (reqs.length) {
              await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
                method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ requests: reqs })
              });
            }
          }
          const docUrl = `https://docs.google.com/document/d/${docId}`;
          cleanText = cleanText.replace(raw, `[✅ Document created: "${data.title || p.title}"](https://docs.google.com/document/d/${docId})`);
        } else {
          cleanText = cleanText.replace(raw, `⚠ Docs create failed: ${data.error?.message || createRes.statusText}`);
        }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Docs create error: ${e.message}`); }
    }
  }}

  // ── DOCS_WRITE ──
  { let m; while ((m = MARKER_RE.DOCS_WRITE.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId) && p.content) {
      try {
        const token = await getDocsAccessToken(uid);
        const docId = p.id || p.eventId;
        const reqs = [];
        let startPos = 1;

        // Fetch document first to get the actual endIndex
        const docRes = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const docData = await docRes.json();
        if (docRes.ok) {
          const endIdx = docData.body?.content?.[docData.body.content.length - 1]?.endIndex;
          if (p.mode === 'replace') {
            if (endIdx && endIdx > 1) {
              reqs.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIdx } } });
            }
            startPos = 1;
          } else {
            // Append at the end of document
            startPos = (endIdx && endIdx > 1) ? endIdx - 1 : 1;
          }
        }

        reqs.push(...markdownToDocsRequests(p.content, startPos));

        if (reqs.length) {
          const writeRes = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, {
            method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ requests: reqs })
          });
          const writeData = await writeRes.json();
          if (!writeRes.ok) throw new Error(writeData.error?.message || writeRes.statusText);
        }
        cleanText = cleanText.replace(raw, `✅ Document updated (ID: ${docId})`);
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Docs write error: ${e.message}`); }
    }
  }}

  // ── DOCS_DELETE ──
  { let m; while ((m = MARKER_RE.DOCS_DELETE.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId)) {
      try {
        const token = await getDocsAccessToken(uid);
        const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(p.id || p.eventId)}`, {
          method: "DELETE", headers: { Authorization: `Bearer ${token}` }
        });
        if (delRes.ok) cleanText = cleanText.replace(raw, `🗑 Document deleted (ID: ${p.id || p.eventId})`);
        else { const e = await delRes.json().catch(() => ({})); cleanText = cleanText.replace(raw, `⚠ Docs delete failed: ${e.error?.message || delRes.statusText}`); }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Docs delete error: ${e.message}`); }
    }
  }}

  // ── DOCS_RENAME ──
  { let m; while ((m = MARKER_RE.DOCS_RENAME.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId) && p.title) {
      try {
        const token = await getDocsAccessToken(uid);
        const renameRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(p.id || p.eventId)}?fields=id,name`, {
          method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: p.title })
        });
        const data = await renameRes.json();
        if (renameRes.ok) cleanText = cleanText.replace(raw, `✅ Document renamed to: "${data.name}"`);
        else cleanText = cleanText.replace(raw, `⚠ Docs rename failed: ${data.error?.message || renameRes.statusText}`);
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Docs rename error: ${e.message}`); }
    }
  }}

  // ── SLIDES_LIST ──
  { let m; while ((m = MARKER_RE.SLIDES_LIST.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    try {
      const token = await getSlidesAccessToken(uid);
      const q = encodeURIComponent(p?.query
        ? `name contains '${p.query.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.presentation'`
        : "mimeType='application/vnd.google-apps.presentation'");
      const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,modifiedTime,owners)&pageSize=${Math.min(p?.maxResults || 10, 50)}&orderBy=modifiedTime desc`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await listRes.json();
      if (listRes.ok && data.files?.length) {
        const rows = data.files.map(f => {
          const mod = f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '—';
          return `| **${f.name}** | ${f.owners?.[0]?.displayName || '—'} | ${mod} | \`${f.id}\` |`;
        });
        const table = [
          `### 📽️ Google Slides (${data.files.length})`,
          `| Presentation Name | Owner | Last Modified | ID |`,
          `| :--- | :--- | :--- | :--- |`,
          ...rows
        ].join('\n');
        cleanText = cleanText.replace(raw, table);
      } else {
        cleanText = cleanText.replace(raw, `📽️ No presentations found${p?.query ? ' for "' + p.query + '"' : ''}`);
      }
    } catch (e) { cleanText = cleanText.replace(raw, `⚠ Slides list error: ${e.message}`); }
  }}

  // ── SLIDES_READ ──
  { let m; while ((m = MARKER_RE.SLIDES_READ.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId)) {
      try {
        const token = await getSlidesAccessToken(uid);
        const readRes = await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(p.id || p.eventId)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await readRes.json();
        if (readRes.ok) {
          const slides = (data.slides || []).map(s => {
            const texts = (s.pageElements || []).filter(el => el.shape?.text?.textElements).flatMap(el => el.shape.text.textElements.filter(te => te.textRun?.content).map(te => te.textRun.content));
            return `Slide ${s.objectId}: ${texts.join('').slice(0, 200)}`;
          }).join('\n');
          cleanText = cleanText.replace(raw, `📽 Presentation: ${data.title || ''}\n${slides}`);
        } else {
          cleanText = cleanText.replace(raw, `⚠ Slides read failed: ${data.error?.message || readRes.statusText}`);
        }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Slides read error: ${e.message}`); }
    }
  }}

  // ── SLIDES_CREATE ──
  { let m; while ((m = MARKER_RE.SLIDES_CREATE.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && p.title) {
      try {
        const token = await getSlidesAccessToken(uid);
        const createRes = await fetch("https://slides.googleapis.com/v1/presentations", {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ title: p.title })
        });
        const data = await createRes.json();
        if (createRes.ok) {
          let slideCount = 0;
          if (p.slides) {
            const requests = slideContentToRequests(p.slides, 'auto');
            slideCount = Array.isArray(p.slides) ? p.slides.length : p.slides.split(/\n?---\n?/).filter(Boolean).length;
            if (requests.length) {
              await fetch(`https://slides.googleapis.com/v1/presentations/${data.presentationId}:batchUpdate`, {
                method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ requests })
              });
            }
          }
          const slidesUrl = `https://docs.google.com/presentation/d/${data.presentationId}`;
          cleanText = cleanText.replace(raw, `[✅ Presentation created: "${data.title || p.title}" (${slideCount} slides)](${slidesUrl})`);
        } else {
          cleanText = cleanText.replace(raw, `⚠ Slides create failed: ${data.error?.message || createRes.statusText}`);
        }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Slides create error: ${e.message}`); }
    }
  }}

  // ── SLIDES_WRITE ──
  { let m; while ((m = MARKER_RE.SLIDES_WRITE.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId) && p.slides) {
      try {
        const token = await getSlidesAccessToken(uid);
        const presId = p.id || p.eventId;
        const reqs = [];
        if (p.mode === 'replace') {
          const presRes = await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presId)}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const presData = await presRes.json();
          if (presRes.ok) (presData.slides || []).forEach(s => reqs.push({ deleteObject: { objectId: s.objectId } }));
        }
        reqs.push(...slideContentToRequests(p.slides, 'auto'));
        if (reqs.length) {
          await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presId)}:batchUpdate`, {
            method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ requests: reqs })
          });
        }
        cleanText = cleanText.replace(raw, `✅ Presentation updated (ID: ${presId})`);
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Slides write error: ${e.message}`); }
    }
  }}

  // ── SLIDES_DELETE ──
  { let m; while ((m = MARKER_RE.SLIDES_DELETE.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId)) {
      try {
        const token = await getSlidesAccessToken(uid);
        const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(p.id || p.eventId)}`, {
          method: "DELETE", headers: { Authorization: `Bearer ${token}` }
        });
        if (delRes.ok) cleanText = cleanText.replace(raw, `🗑 Presentation deleted (ID: ${p.id || p.eventId})`);
        else { const e = await delRes.json().catch(() => ({})); cleanText = cleanText.replace(raw, `⚠ Slides delete failed: ${e.error?.message || delRes.statusText}`); }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Slides delete error: ${e.message}`); }
    }
  }}

  // ── SLIDES_RENAME ──
  { let m; while ((m = MARKER_RE.SLIDES_RENAME.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId) && p.title) {
      try {
        const token = await getSlidesAccessToken(uid);
        const renameRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(p.id || p.eventId)}?fields=id,name`, {
          method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: p.title })
        });
        const data = await renameRes.json();
        if (renameRes.ok) cleanText = cleanText.replace(raw, `✅ Presentation renamed to: "${data.name}"`);
        else cleanText = cleanText.replace(raw, `⚠ Slides rename failed: ${data.error?.message || renameRes.statusText}`);
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Slides rename error: ${e.message}`); }
    }
  }}

  // ── SHEETS_LIST ──
  { let m; while ((m = MARKER_RE.SHEETS_LIST.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    try {
      const token = await getSheetsAccessToken(uid);
      const q = encodeURIComponent(p?.query
        ? `name contains '${p.query.replace(/'/g, "\\'")}'  and mimeType='application/vnd.google-apps.spreadsheet'`
        : "mimeType='application/vnd.google-apps.spreadsheet'");
      const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,modifiedTime,owners)&pageSize=${Math.min(p?.maxResults || 10, 50)}&orderBy=modifiedTime desc`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await listRes.json();
      if (listRes.ok && data.files?.length) {
        const rows = data.files.map(f => {
          const mod = f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '—';
          return `| **${f.name}** | ${f.owners?.[0]?.displayName || '—'} | ${mod} | \`${f.id}\` |`;
        });
        const table = [
          `### 📊 Google Sheets (${data.files.length})`,
          `| Spreadsheet Name | Owner | Last Modified | ID |`,
          `| :--- | :--- | :--- | :--- |`,
          ...rows
        ].join('\n');
        cleanText = cleanText.replace(raw, table);
      } else {
        cleanText = cleanText.replace(raw, `📊 No spreadsheets found${p?.query ? ' for "' + p.query + '"' : ''}`);
      }
    } catch (e) { cleanText = cleanText.replace(raw, `⚠ Sheets list error: ${e.message}`); }
  }}

  // ── SHEETS_READ ──
  { let m; while ((m = MARKER_RE.SHEETS_READ.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId)) {
      try {
        const token = await getSheetsAccessToken(uid);
        const rangeEnc = encodeURIComponent(p.range || "A1:ZZ");
        const readRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(p.id || p.eventId)}/values/${rangeEnc}?majorDimension=ROWS`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await readRes.json();
        if (readRes.ok) {
          const vals = data.values || [];
          // Build a markdown table from cell values
          if (vals.length) {
            const maxCols = Math.max(...vals.map(r => r.length));
            const pad = (cell) => String(cell || '').replace(/\|/g, '\\|');
            const [header, ...body] = vals.slice(0, 30);
            const paddedHeader = Array.from({ length: maxCols }, (_, i) => pad(header?.[i] ?? ''));
            const separator = Array.from({ length: maxCols }, () => ':---');
            const bodyRows = body.map(row => {
              const padded = Array.from({ length: maxCols }, (_, i) => pad(row[i] ?? ''));
              return `| ${padded.join(' | ')} |`;
            });
            const table = [
              `### 📊 Sheet Data (${vals.length} rows, range: ${p.range || 'A1:ZZ'})`,
              `| ${paddedHeader.join(' | ')} |`,
              `| ${separator.join(' | ')} |`,
              ...bodyRows,
              vals.length > 30 ? `*… and ${vals.length - 30} more rows*` : ''
            ].filter(Boolean).join('\n');
            cleanText = cleanText.replace(raw, table);
          } else {
            cleanText = cleanText.replace(raw, `📊 Sheet is empty (range: ${p.range || 'A1:ZZ'})`);
          }
        } else {
          cleanText = cleanText.replace(raw, `⚠ Sheets read failed: ${data.error?.message || readRes.statusText}`);
        }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Sheets read error: ${e.message}`); }
    }
  }}

  // ── SHEETS_CREATE ──
  { let m; while ((m = MARKER_RE.SHEETS_CREATE.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && p.title) {
      try {
        const token = await getSheetsAccessToken(uid);
        const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ properties: { title: p.title } })
        });
        const data = await createRes.json();
        if (createRes.ok) {
          if (p.data && Array.isArray(p.data) && p.data.length) {
            const rangeEnc = encodeURIComponent("A1");
            await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${data.spreadsheetId}/values/${rangeEnc}?valueInputOption=USER_ENTERED`, {
              method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ values: p.data, majorDimension: "ROWS" })
            });
          }
          const sheetsUrl = `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}`;
          cleanText = cleanText.replace(raw, `[✅ Spreadsheet created: "${data.properties?.title || p.title}"](${sheetsUrl})`);
        } else {
          cleanText = cleanText.replace(raw, `⚠ Sheets create failed: ${data.error?.message || createRes.statusText}`);
        }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Sheets create error: ${e.message}`); }
    }
  }}

  // ── SHEETS_WRITE ──
  { let m; while ((m = MARKER_RE.SHEETS_WRITE.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId) && p.values) {
      try {
        const token = await getSheetsAccessToken(uid);
        const sheetId = p.id || p.eventId;
        const rangeEnc = encodeURIComponent(p.range || "A1");
        let writeRes;
        if (p.mode === 'append') {
          writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${rangeEnc}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
            method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: p.values, majorDimension: "ROWS" })
          });
        } else {
          writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${rangeEnc}?valueInputOption=USER_ENTERED`, {
            method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: p.values, majorDimension: "ROWS" })
          });
        }
        const writeData = await writeRes.json();
        if (writeRes.ok) cleanText = cleanText.replace(raw, `✅ Sheet updated: ${writeData.updatedCells || 0} cells written`);
        else cleanText = cleanText.replace(raw, `⚠ Sheets write failed: ${writeData.error?.message || writeRes.statusText}`);
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Sheets write error: ${e.message}`); }
    }
  }}

  // ── SHEETS_DELETE ──
  { let m; while ((m = MARKER_RE.SHEETS_DELETE.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId)) {
      try {
        const token = await getSheetsAccessToken(uid);
        const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(p.id || p.eventId)}`, {
          method: "DELETE", headers: { Authorization: `Bearer ${token}` }
        });
        if (delRes.ok) cleanText = cleanText.replace(raw, `🗑 Spreadsheet deleted (ID: ${p.id || p.eventId})`);
        else { const e = await delRes.json().catch(() => ({})); cleanText = cleanText.replace(raw, `⚠ Sheets delete failed: ${e.error?.message || delRes.statusText}`); }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Sheets delete error: ${e.message}`); }
    }
  }}

  // ── SHEETS_RENAME ──
  { let m; while ((m = MARKER_RE.SHEETS_RENAME.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId) && p.title) {
      try {
        const token = await getSheetsAccessToken(uid);
        const renameRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(p.id || p.eventId)}?fields=id,name`, {
          method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: p.title })
        });
        const data = await renameRes.json();
        if (renameRes.ok) cleanText = cleanText.replace(raw, `✅ Spreadsheet renamed to: "${data.name}"`);
        else cleanText = cleanText.replace(raw, `⚠ Sheets rename failed: ${data.error?.message || renameRes.statusText}`);
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Sheets rename error: ${e.message}`); }
    }
  }}

  // ── CALENDAR_LIST ──
  { let m; while ((m = MARKER_RE.CALENDAR_LIST.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    try {
      const token = await getCalendarAccessToken(uid);
      const params = new URLSearchParams({ orderBy: "startTime", singleEvents: "true", maxResults: String(Math.min(p?.maxResults || 10, 50)) });
      params.set("timeMin", p?.timeMin || new Date().toISOString());
      if (p?.timeMax) params.set("timeMax", p.timeMax);
      const listRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await listRes.json();
      if (listRes.ok && data.items?.length) {
        const formatDT = (dt, d) => {
          if (dt) {
            const parsed = new Date(dt);
            return parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          }
          return d || '—';
        };
        const statusIcon = (s) => s === 'cancelled' ? '❌' : s === 'tentative' ? '❓' : '✅';
        const rows = data.items.map(e => {
          const start = formatDT(e.start?.dateTime, e.start?.date);
          const end = formatDT(e.end?.dateTime, e.end?.date);
          const status = `${statusIcon(e.status)} ${e.status || 'confirmed'}`;
          const title = (e.summary || '(no title)').replace(/\|/g, '\\|');
          return `| **${title}** | ${start} | ${end} | ${status} | \`${e.id}\` |`;
        });
        const table = [
          `### 📅 Calendar Events (${data.items.length})`,
          `| Event | Start | End | Status | ID |`,
          `| :--- | :--- | :--- | :--- | :--- |`,
          ...rows
        ].join('\n');
        cleanText = cleanText.replace(raw, table);
      } else {
        cleanText = cleanText.replace(raw, `📅 No upcoming events found.`);
      }
    } catch (e) { cleanText = cleanText.replace(raw, `⚠ Calendar list error: ${e.message}`); }
  }}

  // ── CALENDAR_READ ──
  { let m; while ((m = MARKER_RE.CALENDAR_READ.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId)) {
      try {
        const token = await getCalendarAccessToken(uid);
        const evId = p.id || p.eventId;
        const readRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(evId)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await readRes.json();
        if (readRes.ok) {
          cleanText = cleanText.replace(raw, `📅 Event: ${data.summary || '(no title)'}\nStart: ${data.start?.dateTime || data.start?.date || '—'}\nEnd: ${data.end?.dateTime || data.end?.date || '—'}\nStatus: ${data.status || ''}\nDescription: ${(data.description || '').slice(0, 1000)}`);
        } else {
          cleanText = cleanText.replace(raw, `⚠ Calendar read failed: ${data.error?.message || readRes.statusText}`);
        }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Calendar read error: ${e.message}`); }
    }
  }}

  // ── CALENDAR_CREATE ──
  { let m; while ((m = MARKER_RE.CALENDAR_CREATE.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && p.summary && p.start && p.end) {
      try {
        const token = await getCalendarAccessToken(uid);
        const body = { summary: p.summary, description: p.description || '', start: p.start, end: p.end };
        if (p.location) body.location = p.location;
        if (p.attendees) body.attendees = p.attendees.map(email => ({ email }));
        const createRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await createRes.json();
        if (createRes.ok) cleanText = cleanText.replace(raw, `✅ Event created: "${data.summary || p.summary}" (ID: ${data.id})`);
        else cleanText = cleanText.replace(raw, `⚠ Calendar create failed: ${data.error?.message || createRes.statusText}`);
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Calendar create error: ${e.message}`); }
    }
  }}

  // ── CALENDAR_QUICK_ADD ──
  { let m; while ((m = MARKER_RE.CALENDAR_QUICK_ADD.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && p.text) {
      try {
        const token = await getCalendarAccessToken(uid);
        const qaRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/quickAdd?text=${encodeURIComponent(p.text)}`, {
          method: "POST", headers: { Authorization: `Bearer ${token}` }
        });
        const data = await qaRes.json();
        if (qaRes.ok) cleanText = cleanText.replace(raw, `✅ Event created via quick add: "${data.summary || p.text}" (ID: ${data.id})`);
        else cleanText = cleanText.replace(raw, `⚠ Calendar quick add failed: ${data.error?.message || qaRes.statusText}`);
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Calendar quick add error: ${e.message}`); }
    }
  }}

  // ── CALENDAR_UPDATE ──
  { let m; while ((m = MARKER_RE.CALENDAR_UPDATE.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId)) {
      try {
        const token = await getCalendarAccessToken(uid);
        const evId = p.id || p.eventId;
        const { id, eventId, ...fields } = p;
        const updRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(evId)}`, {
          method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(fields)
        });
        const data = await updRes.json();
        if (updRes.ok) cleanText = cleanText.replace(raw, `✅ Event updated: "${data.summary || ''}" (ID: ${data.id})`);
        else cleanText = cleanText.replace(raw, `⚠ Calendar update failed: ${data.error?.message || updRes.statusText}`);
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Calendar update error: ${e.message}`); }
    }
  }}

  // ── CALENDAR_DELETE ──
  { let m; while ((m = MARKER_RE.CALENDAR_DELETE.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.id || p.eventId)) {
      try {
        const token = await getCalendarAccessToken(uid);
        const evId = p.id || p.eventId;
        const delRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(evId)}`, {
          method: "DELETE", headers: { Authorization: `Bearer ${token}` }
        });
        if (delRes.ok) cleanText = cleanText.replace(raw, `🗑 Event deleted (ID: ${evId})`);
        else { const e = await delRes.json().catch(() => ({})); cleanText = cleanText.replace(raw, `⚠ Calendar delete failed: ${e.error?.message || delRes.statusText}`); }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Calendar delete error: ${e.message}`); }
    }
  }}

  // ── PEOPLE_LIST ──
  { let m; while ((m = MARKER_RE.PEOPLE_LIST.exec(text)) !== null) {
    const raw = m[0]; let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p) {
      try {
        const token = await getPeopleAccessToken(uid);
        const maxResults = p.maxResults || 20;
        let persons = [];
        let label = '';

        if (p.query) {
          const params = new URLSearchParams({ query: p.query, pageSize: String(Math.min(maxResults, 50)), readMask: PEOPLE_FIELDS });
          const searchRes = await fetch(`${PEOPLE_API}/people:searchContacts?${params}`, { headers: { Authorization: `Bearer ${token}` } });
          const data = await searchRes.json();
          if (!searchRes.ok) throw new Error(data.error?.message || searchRes.statusText);
          persons = (data.results || []).map(r => r.person).filter(Boolean);
          label = `"${p.query}"`;
        } else {
          const params = new URLSearchParams({ pageSize: String(Math.min(maxResults, 200)), personFields: PEOPLE_FIELDS });
          const listRes = await fetch(`${PEOPLE_API}/people/me/connections?${params}`, { headers: { Authorization: `Bearer ${token}` } });
          const data = await listRes.json();
          if (!listRes.ok) throw new Error(data.error?.message || listRes.statusText);
          persons = (data.connections || []).filter(Boolean);
          label = `(all — ${persons.length} total)`;
        }

        if (!persons.length) {
          cleanText = cleanText.replace(raw, `📇 No contacts${label ? ' matching ' + label : ''}.`);
        } else {
          const rows = persons.map(c => {
            const name = c.names?.[0]?.displayName || 'Unknown';
            const email = c.emailAddresses?.[0]?.value || '—';
            const phone = c.phoneNumbers?.[0]?.value || '—';
            const org = c.organizations?.[0] ? [c.organizations[0].name, c.organizations[0].title].filter(Boolean).join(' — ') : '—';
            const id = c.resourceName || '';
            return `| **${name}** | ${email} | ${phone} | ${org} | \`${id}\` |`;
          });
          const table = [
            `### 📇 Contacts ${label}`,
            `| Name | Email | Phone | Organization | Resource Name |`,
            `| :--- | :--- | :--- | :--- | :--- |`,
            ...rows
          ].join('\n');
          cleanText = cleanText.replace(raw, table);
        }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ People list error: ${e.message}`); }
    }
  }}

  // ── PEOPLE_GET ──
  { let m; while ((m = MARKER_RE.PEOPLE_GET.exec(text)) !== null) {
    const raw = m[0]; let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && p.resourceName) {
      try {
        const token = await getPeopleAccessToken(uid);
        const params = new URLSearchParams({ personFields: PEOPLE_FIELDS });
        const getRes = await fetch(`${PEOPLE_API}/${encodeURIComponent(p.resourceName)}?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await getRes.json();
        if (!getRes.ok) throw new Error(data.error?.message || getRes.statusText);
        const c = data;
        const name = c.names?.map(n => n.displayName).join(', ') || 'Unknown';
        const cardLines = [
          `### 📇 Contact: ${name}`
        ];
        if (c.nicknames?.length) cardLines.push(`> **Nickname:** ${c.nicknames.map(n => n.value).join(', ')}`);
        if (c.emailAddresses?.length) c.emailAddresses.forEach(e => cardLines.push(`> **Email:** ${e.value}${e.type ? ' *(' + e.type + ')*' : ''}`));
        if (c.phoneNumbers?.length) c.phoneNumbers.forEach(n => cardLines.push(`> **Phone:** ${n.value}${n.type ? ' *(' + n.type + ')*' : ''}`));
        if (c.addresses?.length) c.addresses.forEach(a => cardLines.push(`> **Address:** ${a.formattedValue}${a.type ? ' *(' + a.type + ')*' : ''}`));
        if (c.birthdays?.length) {
          const b = c.birthdays[0].date;
          const bday = [b.day, b.month].join('/') + (b.year ? '/' + b.year : '');
          cardLines.push(`> **Birthday:** ${bday}`);
        }
        if (c.organizations?.length) c.organizations.forEach(o => cardLines.push(`> **Organization:** ${[o.name, o.title, o.department].filter(Boolean).join(' — ')}`));
        if (c.biographies?.length) cardLines.push(`> **Bio:** ${c.biographies[0].value.slice(0, 300)}`);
        if (c.urls?.length) c.urls.forEach(u => cardLines.push(`> **URL:** [${u.value}](${u.value})`));
        cardLines.push(`> **Resource Name:** \`${c.resourceName || ''}\``);
        cleanText = cleanText.replace(raw, cardLines.join('\n'));
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ People get error: ${e.message}`); }
    }
  }}

  // ── PEOPLE_CREATE ──
  { let m; while ((m = MARKER_RE.PEOPLE_CREATE.exec(text)) !== null) {
    const raw = m[0]; let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && (p.names || p.emailAddresses || p.phoneNumbers)) {
      try {
        const token = await getPeopleAccessToken(uid);
        const createRes = await fetch(`${PEOPLE_API}/people:createContact`, {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(p)
        });
        const data = await createRes.json();
        if (!createRes.ok) throw new Error(data.error?.message || createRes.statusText);
        const name = data.names?.[0]?.displayName || data.resourceName || 'Contact';
        cleanText = cleanText.replace(raw, `✅ Contact created: ${name} (${data.resourceName})`);
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ People create error: ${e.message}`); }
    }
  }}

  // ── PEOPLE_UPDATE ──
  { let m; while ((m = MARKER_RE.PEOPLE_UPDATE.exec(text)) !== null) {
    const raw = m[0]; let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && p.resourceName) {
      try {
        const allowedFields = ["names","emailAddresses","phoneNumbers","addresses","birthdays","organizations","biographies","nicknames","urls"];
        const updateFields = Object.keys(p).filter(k => allowedFields.includes(k) && k !== 'resourceName').join(",");
        if (!updateFields) { cleanText = cleanText.replace(raw, '⚠ No valid fields to update'); continue; }
        const token = await getPeopleAccessToken(uid);
        const params = new URLSearchParams({ updatePersonFields: updateFields });
        const { resourceName, ...fields } = p;
        const updateRes = await fetch(`${PEOPLE_API}/${encodeURIComponent(resourceName)}:updateContact?${params}`, {
          method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(fields)
        });
        const data = await updateRes.json();
        if (!updateRes.ok) throw new Error(data.error?.message || updateRes.statusText);
        const name = data.names?.[0]?.displayName || data.resourceName || 'Contact';
        cleanText = cleanText.replace(raw, `✅ Contact updated: ${name} (${data.resourceName})`);
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ People update error: ${e.message}`); }
    }
  }}

  // ── SAVE_MEMORY ──
  { let m; while ((m = MARKER_RE.SAVE_MEMORY.exec(text)) !== null) {
    const raw = m[0];
    let p;
    try { p = JSON.parse(m[1]); } catch {}
    if (p && typeof p === 'object') {
      try {
        const memRef = gmailDb().ref(`memories/${uid}`);
        const snap = await memRef.once('value');
        const existing = snap.val() || {};

        // Helper to format a value as YAML-like string
        function formatMemoryValue(v, indent = 0) {
          const pad = '  '.repeat(indent);
          if (v === null || v === undefined) return '';
          if (typeof v === 'string') return v;
          if (typeof v === 'number' || typeof v === 'boolean') return String(v);
          if (Array.isArray(v)) return v.map(item => `\n${pad}- ${formatMemoryValue(item, indent + 1)}`).join('');
          if (typeof v === 'object') {
            const keys = Object.keys(v);
            if (keys.length === 0) return '';
            return keys.map(k => `\n${pad}${k}: ${formatMemoryValue(v[k], indent + 1)}`).join('');
          }
          return String(v);
        }

        // Use raw top-level keys as categories (personal_information, education, projects, etc.)
        // One memory entry per unique key. Same key replaces old entry with that key.
        function replaceOrCreate(category, content) {
          const existingIds = Object.entries(existing)
            .filter(([, mem]) => mem.category === category)
            .map(([id]) => id);
          for (const id of existingIds) memRef.child(id).remove();
          const memId = `mem_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
          memRef.child(memId).set({ id: memId, content, category, emoji: '💡', createdAt: Date.now() });
        }

        if (p.content) {
          // Flat memory: category defaults to 'others'
          replaceOrCreate(p.category || 'others', p.content.trim());
          cleanText = cleanText.replace(raw, `🧠 Memory saved`);
        } else {
          // Each top-level key is its own category
          let count = 0;
          for (const [cat, data] of Object.entries(p)) {
            if (!data) continue;
            replaceOrCreate(cat, cat + ':' + formatMemoryValue(data));
            count++;
          }
          cleanText = cleanText.replace(raw, `🧠 Memory saved (${count} ${count === 1 ? 'section' : 'sections'})`);
        }
      } catch (e) { cleanText = cleanText.replace(raw, `⚠ Memory save error: ${e.message}`); }
    }
  }}

  return { cleanText };
}

async function handleAgenticChatRoute(req, res, agentName, isGeminiOrCoherePrompt = false) {
  const lowLatency = req.body.lowLatency === true;
  let messages = req.body.messages;
  let prompt = req.body.prompt;
  
  if (lowLatency) {
    // In low-latency mode the frontend builds the exact system prompt;
    // skip backend additions (response style, agentic search, critique).
    if (!messages) return res.status(400).json({ error: "messages required" });
  } else if (isGeminiOrCoherePrompt) {
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    messages = [{ role: "user", content: addResponseStyleInstructionToPrompt(prompt) }];
  } else {
    if (!messages) return res.status(400).json({ error: "messages required" });
    messages = addResponseStyleInstructionToMessages(messages);
  }

  try {
    let chatMessages = messages;
    if (!lowLatency) {
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || "";
      const webContext = await executeAgenticSearch(agentName, lastUserMsg);
      chatMessages = [...messages];
      if (webContext) {
        chatMessages[chatMessages.length - 1].content += "\n\n" + formatWebContextForPrompt(webContext);
      }
    }

    const response = await callModelBackend(agentName, chatMessages);
    res.json({ result: response });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}

const NVIDIA_MODEL_MAP = {
  openai:        { model: "openai/gpt-oss-120b",         key: "NVIDIA_KEY_GPTOSS" },
  "nvidia-llama":{ model: "meta/llama-3.3-70b-instruct", key: "NVIDIA_KEY_LLAMA" },
  deepseek:      { model: "moonshotai/kimi-k2.6",        key: "NVIDIA_KEY_KIMI" },
  gemma4:        { model: "google/gemma-4-31b-it",       key: "NVIDIA_KEY_GEMMA4" },
};

async function handleAgenticChatRouteStream(req, res, agentName, isGeminiOrCoherePrompt = false) {
  const lowLatency = req.body.lowLatency === true;
  let messages = req.body.messages;
  let prompt = req.body.prompt;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (lowLatency) {
    if (!messages) { sendEvent({ type: "error", message: "messages required" }); return res.end(); }
  } else if (isGeminiOrCoherePrompt) {
    if (!prompt) { sendEvent({ type: "error", message: "prompt required" }); return res.end(); }
    messages = [{ role: "user", content: addResponseStyleInstructionToPrompt(prompt) }];
  } else {
    if (!messages) { sendEvent({ type: "error", message: "messages required" }); return res.end(); }
    messages = addResponseStyleInstructionToMessages(messages);
  }

  try {
    let chatMessages;
    if (lowLatency) {
      chatMessages = messages;
    } else {
      sendEvent({ type: "status", message: "🔍 Searching the web…" });
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || "";
      const webContext = await executeAgenticSearch(agentName, lastUserMsg, sendEvent);
      chatMessages = [...messages];
      if (webContext) {
        chatMessages[chatMessages.length - 1].content += "\n\n" + formatWebContextForPrompt(webContext);
      }
    }

    sendEvent({ type: "status", message: "🤖 Generating response…" });

    let fullResponse = "";

    if (NVIDIA_MODEL_MAP[agentName]) {
      const { model, key } = NVIDIA_MODEL_MAP[agentName];
      const apiKey = process.env[key];
      if (!apiKey) throw new Error(`${agentName} key not configured.`);
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://integrate.api.nvidia.com/v1/chat/completions",
        { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        { model, messages: chatMessages, max_tokens: 16384, temperature: 0.7 },
        sendEvent
      );
    } else if (agentName === "groq") {
      if (!process.env.GROQ_API_KEY) throw new Error("Groq key not configured.");
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: chatMessages, max_tokens: 8192, temperature: 0.7, stream: true }),
        signal: AbortSignal.timeout(30000)
      });
      if (!groqRes.ok) {
        const errText = await groqRes.text();
        throw new Error(`Groq API error (${groqRes.status}): ${errText.slice(0, 200)}`);
      }
      fullResponse = "";
      const reader = groqRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || "";
            if (content) {
              fullResponse += content;
              sendEvent({ type: "token", text: content });
            }
          } catch (_) {}
        }
      }
    } else if (agentName === "mistral") {
      if (!process.env.MISTRAL_API_KEY) throw new Error("Mistral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://api.mistral.ai/v1/chat/completions",
        { "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "mistral-large-latest", messages: chatMessages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agentName === "codestral") {
      if (!process.env.CODESTRAL_API_KEY) throw new Error("Codestral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://codestral.mistral.ai/v1/chat/completions",
        { "Authorization": `Bearer ${process.env.CODESTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "codestral-latest", messages: chatMessages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agentName === "gemini") {
      if (!process.env.GEMINI_API_KEY) throw new Error("Gemini key not configured.");
      const geminiPrompt = chatMessages[chatMessages.length - 1].content;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: geminiPrompt }] }] })
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${text.slice(0, 200)}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (text) {
              fullResponse += text;
              sendEvent({ type: "token", text });
            }
          } catch (e) { /* skip malformed */ }
        }
      }
    } else if (agentName === "cohere") {
      if (!process.env.COHERE_API_KEY) throw new Error("Cohere key not configured.");
      const coherePrompt = chatMessages[chatMessages.length - 1].content;
      const response = await fetch("https://api.cohere.com/v2/chat", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.COHERE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "command-r-plus-08-2024",
          messages: [{ role: "user", content: coherePrompt }],
          max_tokens: 4096,
          stream: true
        })
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Cohere API error (${response.status}): ${text.slice(0, 200)}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.type === "content-delta" && parsed.delta?.message?.content?.text) {
              fullResponse += parsed.delta.message.content.text;
              sendEvent({ type: "token", text: parsed.delta.message.content.text });
            }
          } catch (e) { /* skip */ }
        }
      }
    } else {
      throw new Error("Invalid agent selected.");
    }

    sendEvent({ type: "done", result: fullResponse });
    res.end();
  } catch (err) {
    sendEvent({ type: "error", message: err.message });
    res.end();
  }
}

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

async function generateResearchPlan(agent, query) {
  const systemPrompt = `Generate a comprehensive, decision-tree style research plan for the query. 
The plan MUST explore diverging paths, scenarios, or outcomes arising from the topic (for example, if the query is an exam like "NEET", Branch 1 could be "Successfully Cracking NEET" and Branch 2 could be "Failing to Crack NEET").
Output ONLY a valid JSON object with the following structure:
{
  "topic": "Brief topic name",
  "branches": [
    { "name": "Branch title (e.g., Scenario A / Path 1)", "possibilities": ["Sub-path 1", "Sub-path 2", "Sub-path 3", "Sub-path 4", "Sub-path 5"] }
  ]
}
Ensure there are 2 to 4 distinct main branches that represent fundamentally different paths or scenarios. 
CRITICAL: Each main branch MUST have a minimum of 5 sub-branches (possibilities) that explore detailed pathways within that branch (e.g., different career paths, alternative steps). Return ONLY the raw JSON object. Do not include markdown code fences or any prose.`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Query: "${query}"` }
  ];

  const responseText = await callModelBackend(agent, messages);

  let cleaned = responseText.trim();
  cleaned = cleaned.replace(/```(?:json)?\n?/gi, "").replace(/```\n?/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) cleaned = match[0];

  const plan = JSON.parse(cleaned);
  if (!plan.topic || !Array.isArray(plan.branches)) {
    throw new Error("Invalid plan structure received from model.");
  }
  return plan;
}

function getFallbackPlan(query) {
  return {
    topic: query.slice(0, 40) + "...",
    branches: [
      { name: "Scenario A: Direct Implementation & Success", possibilities: ["Ideal architecture setup", "Market dominance", "Scalability solutions", "Financial returns", "Ecosystem integration"] },
      { name: "Scenario B: Alternative Pathways & Mitigation", possibilities: ["Pivot to new technologies", "Addressing adoption barriers", "Cost-saving architectures", "Niche market focus", "Gradual rollout strategies"] }
    ]
  };
}

/**
 * Expands a single research branch using Chain-of-Thought reasoning.
 * Optionally injects live web data when available.
 *
 * @param {string}      agent      - resolved AI agent key
 * @param {string}      topic      - overall research topic
 * @param {object}      branch     - { name, possibilities[] }
 * @param {object|null} webContext - result from fetchWebContextForBranch, or null
 */
async function expandBranchWithCoT(agent, topic, branch, webContext = null) {
  const webSection = webContext ? formatWebContextForPrompt(webContext) : "";
  const webNote    = webContext
    ? ` Ground your analysis in the real-world web data provided above where relevant, citing specific facts.`
    : " Draw on your training knowledge to provide the most accurate analysis possible.";

  const prompt = `You are an expert researcher. Conduct a deep-dive analysis on the research branch "${branch.name}" for the main research topic "${topic}".
Focus specifically on these key possibilities: ${branch.possibilities.join(", ")}.
${webSection}
Apply step-by-step analytical reasoning. Analyze past and current trends, predict future trends and situations based on this data. Evaluate technical feasibility, global impacts, socio-economic challenges, and key trade-offs.${webNote}

Write out your step-by-step reasoning explicitly. Begin with a section titled "### Detailed Reasoning" where you walk through your logic step by step, considering both historical context and future predictions.
Follow this with a section titled "### Key Findings & Analytical Synthesis". IMPORTANT: You MUST structure the final discoveries in this section using clear bullet points or numbered lists, keeping paragraphs short and highly structured so that new users see an appealing, readable output. Do not output raw walls of text.`;

  const messages = [{ role: "user", content: prompt }];
  return await callModelBackend(agent, messages);
}

/**
 * Synthesizes all branch analyses into a cross-disciplinary overview.
 * Optionally enriched with a final high-level web context pass.
 */
async function synthesizeFindings(agent, topic, branchAnalyses, synthesisWebContext = null) {
  const branchText = Object.entries(branchAnalyses)
    .map(([branchName, analysis]) => `## Branch: ${branchName}\n\n${analysis}`)
    .join("\n\n");

  let webNote = "";
  if (synthesisWebContext) {
    webNote = formatWebContextForPrompt(synthesisWebContext);
  }

  const prompt = `You are an elite research synthesizer. Combine the following individual branch findings regarding the topic "${topic}" into a coherent, high-level strategic synthesis:

${branchText}
${webNote}
Analyze the past and current trends from the findings to predict future trends and situations. Based on these predictions, identify key patterns, unexpected connections, global trade-offs, and construct a detailed, step-by-step strategic future roadmap for the user. Output a comprehensive, logical synthesis.
IMPORTANT: You MUST structure your strategic synthesis thoroughly using bullet points, structured sections, and clear lists for patterns, unexpected connections, trade-offs, predictive analysis, and roadmap items, so that the report is visually appealing, readable, and easy for new users to scan. Avoid raw walls of text.`;

  const messages = [{ role: "user", content: prompt }];
  return await callModelBackend(agent, messages);
}

/**
 * Formats the final research report Markdown document.
 * Includes a Sources section when web search was used.
 */
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

  // Add web sources section if any branches used web search
  const webBranches = Object.entries(branchWebContexts).filter(([, ctx]) => ctx !== null);
  if (webBranches.length > 0) {
    doc += `5. [Web Sources Used](#-web-sources-used)\n`;
  }
  doc += `\n`;

  doc += `## 🌲 Research Map Structure\n`;
  doc += `\`\`\`text\n${generateUnicodeTree(plan)}\`\`\`\n\n`;

  doc += `## 📋 Executive Summary\n`;
  const webGroundedNote = webBranches.length > 0
    ? ` This report is grounded in **${webBranches.length} live web search${webBranches.length > 1 ? "es" : ""}**, ensuring findings reflect current real-world data.`
    : "";
  doc += `This comprehensive research document explores **${plan.topic}** across multiple analytical dimensions. By mapping a structured research map, conducting parallel deep-dives using step-by-step analytical reasoning, and synthesizing cross-branch discoveries, this report analyzes past and current trends to predict future situations and offers key trade-offs and strategic guidance.${webGroundedNote}\n\n`;

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

  // Web sources appendix
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
        const url   = r.url || "";
        doc += url ? `  ${i + 1}. [${title}](${url})\n` : `  ${i + 1}. ${title}\n`;
      });
      doc += "\n";
    });
  }

  return doc;
}

app.post("/api/deep-research", async (req, res) => {
  const { prompt, agent, lowLatency: requestedLowLatency = false } = req.body;
  const lowLatency = requestedLowLatency === true;
  if (!prompt) {
    return res.status(400).json({ error: "prompt required" });
  }

  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const activeInfo = getActiveAgent(agent);
    const resolvedAgent = activeInfo.agent;

    if (activeInfo.fallback) {
      sendEvent({
        type: "status",
        message: `⚠️ API key for "${getBackendAgentName(agent)}" missing. Auto-fallback to "${getBackendAgentName(resolvedAgent)}"...`
      });
    }

    sendEvent({ type: "status", message: "Structuring research plan..." });
    let plan;
    try {
      plan = await generateResearchPlan(resolvedAgent, prompt);
    } catch (err) {
      console.error("Plan generation failed, using fallback plan:", err);
      plan = getFallbackPlan(prompt);
    }

    sendEvent({ type: "plan", data: plan });

    // ── Decide which branches need web search before launching parallel work ──
    const branchSearchDecisions = {};
    plan.branches.forEach(branch => {
      branchSearchDecisions[branch.name] = true;
    });

    const searchCount = Object.values(branchSearchDecisions).filter(Boolean).length;
    const searchNote  = searchCount > 0
      ? ` (🌐 web search enabled for ${searchCount} branch${searchCount > 1 ? "es" : ""})`
      : " (AI knowledge only — no live search needed for this topic)";

    sendEvent({
      type: "status",
      message: `Initiating concurrent branch analyses for ${plan.branches.length} pathways${searchNote}...`
    });

    const branchAnalyses    = {};
    const branchWebContexts = {}; // tracks which branches got web data

    const branchPromises = plan.branches.map(async (branch) => {
      sendEvent({ type: "branch_start", branch: branch.name });

      // ── Web search phase ──
      let webContext = null;
      const needsSearch = branchSearchDecisions[branch.name];

      if (needsSearch) {
        const searchQuery = buildBranchSearchQuery(plan.topic, branch);
        sendEvent({
          type: "web_search_start",
          branch: branch.name,
          query: searchQuery
        });

        try {
          webContext = await executeAgenticSearch(resolvedAgent, searchQuery, sendEvent);
          sendEvent({
            type: "web_search_end",
            branch: branch.name,
            found: !!webContext,
            service: webContext ? webContext.service : null,
            icon: webContext ? webContext.icon : null,
            count: webContext ? webContext.results.length : 0,
            query: searchQuery
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
            query: searchQuery
          });
        }
      }

      branchWebContexts[branch.name] = webContext; // null if not searched or failed

      // ── Analysis phase ──
      try {
        const analysis = await expandBranchWithCoT(resolvedAgent, plan.topic, branch, webContext);
        branchAnalyses[branch.name] = analysis;
        sendEvent({
          type: "branch_end",
          branch: branch.name,
          analysis,
          webUsed: !!webContext,
          webService: webContext ? webContext.service : null
        });
      } catch (err) {
        console.error(`Branch ${branch.name} expansion failed:`, err);
        const failMsg = `### Branch Analysis Failed\nAn error occurred while expanding this branch: ${err.message}`;
        branchAnalyses[branch.name] = failMsg;
        sendEvent({
          type: "branch_end",
          branch: branch.name,
          analysis: failMsg,
          webUsed: false,
          webService: null
        });
      }
    });

    await Promise.all(branchPromises);

    // ── Synthesis phase — optionally add a topic-level search for broader context ──
    sendEvent({ type: "status", message: "Synthesizing branch findings..." });

    let synthesisWebContext = null;
    if (true) {
      sendEvent({ type: "synthesis_search_start", query: plan.topic });
      try {
        synthesisWebContext = await fetchWebContextForBranch(
          plan.topic,
          { name: "synthesis overview", possibilities: ["key findings", "current state"] }
        );
        sendEvent({
          type: "synthesis_search_end",
          found: !!synthesisWebContext,
          service: synthesisWebContext ? synthesisWebContext.service : null
        });
      } catch (_) {
        sendEvent({ type: "synthesis_search_end", found: false, service: null });
      }
    }

    let synthesis;
    try {
      synthesis = await synthesizeFindings(resolvedAgent, plan.topic, branchAnalyses, synthesisWebContext);
    } catch (err) {
      console.error("Synthesis failed:", err);
      synthesis = "Cross-branch synthesis was limited due to an execution error during the synthesis phase. Detailed insights are available under each respective branch analysis above.";
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

// ══════════════════════════════════════════════════════════════
//  🗣️ DEBATE MODE ENGINE — Multi-agent structured debate
// ══════════════════════════════════════════════════════════════

const DEBATE_PERSONAS = [
  { role: "The Advocate", description: "argues in favor of the topic, highlighting benefits, opportunities, and supporting evidence" },
  { role: "The Critic", description: "challenges the topic, pointing out risks, limitations, counterarguments, and potential downsides" },
  { role: "The Analyst", description: "provides objective, data-driven analysis without taking a side, evaluating evidence from all perspectives" },
  { role: "The Synthesizer", description: "seeks common ground, identifies areas of agreement, and bridges opposing viewpoints" },
  { role: "The Pragmatist", description: "focuses on practical implementation, feasibility, real-world constraints, and actionable outcomes" }
];

app.post("/api/debate", async (req, res) => {
  const { topic, agents, rounds, webContext, lowLatency: requestedLowLatency = false } = req.body;
  const lowLatency = requestedLowLatency === true;
  if (!topic) return res.status(400).json({ error: "topic required" });
  if (!agents || !Array.isArray(agents) || agents.length < 2) return res.status(400).json({ error: "At least 2 agents required" });

  const maxRounds = Math.min(Math.max(parseInt(rounds) || 2, 1), 4);
  const selectedAgents = agents.slice(0, 5);
  const webSection = webContext ? formatWebContextForPrompt(webContext) : "";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let transcript = [];

    const participants = selectedAgents.map((agent, i) => {
      const info = getActiveAgent(agent);
      return {
        agent: info.agent,
        name: getBackendAgentName(info.agent),
        persona: DEBATE_PERSONAS[i % DEBATE_PERSONAS.length],
        fallback: info.fallback,
        originalAgent: info.fallback ? agent : null
      };
    });

    // Check if any agents resolved to the same model (deduplicate)
    const seen = new Set();
    const uniqueParticipants = [];
    for (const p of participants) {
      const key = p.agent;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueParticipants.push(p);
      }
    }

    if (uniqueParticipants.length < 2) {
      sendEvent({ type: "error", message: "At least 2 unique agents with valid API keys are required for a debate." });
      res.end();
      return;
    }

    sendEvent({
      type: "start",
      participants: uniqueParticipants.map(p => ({
        agent: p.agent,
        name: p.name,
        persona: p.persona,
        fallback: p.fallback,
        originalAgent: p.originalAgent
      })),
      topic
    });

    sendEvent({
      type: "status",
      message: `🗣️ Debate starting with ${uniqueParticipants.length} participants, ${maxRounds} round${maxRounds > 1 ? "s" : ""}`
    });

    const colorPalette = ["#00f5ff", "#ff2d78", "#ffbe00", "#7c3aed", "#00ff9d"];

    for (let round = 1; round <= maxRounds; round++) {
      for (let pIdx = 0; pIdx < uniqueParticipants.length; pIdx++) {
        const p = uniqueParticipants[pIdx];

        sendEvent({
          type: "speaker_start",
          round,
          agent: p.agent,
          name: p.name,
          persona: p.persona,
          color: colorPalette[pIdx % colorPalette.length]
        });

        const fallbackNote = p.fallback
          ? `\n\nNOTE: API key for "${getBackendAgentName(p.originalAgent)}" was unavailable. You are responding in their place as the ${p.persona.role}.`
          : "";

        const transcriptText = transcript.length > 0
          ? transcript.map(t => `${t.name} (${t.persona.role}):\n${t.content}`).join("\n\n---\n\n")
          : "";

        let speakerWebSection = webSection
          ? `\nUse the following current web data to support your arguments where applicable:\n${webSection}`
          : "";
          
        if (!webSection) {
          const searchContext = await executeAgenticSearch(p.agent, `Debate topic: ${topic} - arguments for ${p.persona.role}`, sendEvent);
          if (searchContext) {
              speakerWebSection = `\nUse the following current web data to support your arguments where applicable:\n${formatWebContextForPrompt(searchContext)}`;
          }
        }

        let debatePrompt;
        if (round === 1 && pIdx === 0) {
          debatePrompt = `You are participating in a structured multi-AI debate.

DEBATE TOPIC: "${topic}"

YOUR ROLE: ${p.persona.role}
YOUR INSTRUCTION: ${p.persona.description}

This is the opening statement of the debate. Present your initial position on this topic clearly and persuasively. Structure your response with:
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
• Ask thoughtful questions to probe weaknesses in opposing arguments
• Counter any arguments made against your position
${speakerWebSection}
Keep your response focused and concise (2-4 paragraphs). Use proper punctuation throughout.${fallbackNote}`;
        }

        const messages = [{ role: "user", content: debatePrompt }];

        try {
          const response = await callModelBackend(p.agent, messages);
          transcript.push({
            agent: p.agent,
            name: p.name,
            persona: p.persona,
            content: response,
            round
          });
          sendEvent({
            type: "speaker_end",
            agent: p.agent,
            name: p.name,
            persona: p.persona,
            content: response,
            color: colorPalette[pIdx % colorPalette.length],
            round
          });
        } catch (err) {
          const errorMsg = `[${p.name} is unavailable for this round: ${err.message}]`;
          transcript.push({
            agent: p.agent,
            name: p.name,
            persona: p.persona,
            content: errorMsg,
            round
          });
          sendEvent({
            type: "speaker_end",
            agent: p.agent,
            name: p.name,
            persona: p.persona,
            content: errorMsg,
            color: colorPalette[pIdx % colorPalette.length],
            round,
            error: true
          });
        }
      }
    }

    // ── Synthesis Phase ──
    sendEvent({ type: "status", message: "🧠 Synthesizing debate into a final consensus..." });

    const fullTranscript = transcript.map(t =>
      `--- ${t.name} (${t.persona.role}) - Round ${t.round} ---\n${t.content}`
    ).join("\n\n");

    const webSynthesisSection = webSection
      ? `\nThe following current web data was available to participants during the debate and should inform your synthesis:\n${webSection}`
      : "";

    const synthesisPrompt = `You are a neutral debate moderator and expert synthesis analyst.

DEBATE TOPIC: "${topic}"

Below is the full transcript of a structured multi-AI debate between participants with different assigned perspectives:

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
A comprehensive, balanced conclusion that incorporates the strongest arguments from all sides. This should be a well-reasoned answer that a neutral observer would find fair and complete.

Keep your synthesis thorough but readable. Use proper punctuation throughout.`;

    const synthesisMessages = [{ role: "user", content: synthesisPrompt }];
    const moderatorAgent = uniqueParticipants[0].agent;

    try {
      const consensus = await callModelBackend(moderatorAgent, synthesisMessages);
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

// ══════════════════════════════════════════════════════════════
//  🌐 WEB SEARCH ENGINE — DuckDuckGo, Tavily AI, & SerpAPI
// ══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
//  Helper: fetch with timeout
// ─────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────────────────────────────────────────────
//  Helper: Clean search query for better results
// ─────────────────────────────────────────────────────────────
function cleanSearchQuery(query) {
  return query
    .replace(/\b(hey|hello|hi|tell me about|can you|would you|could you|please|thanks|thank you)\b/gi, '')
    .replace(/[?¿!¡]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// ─────────────────────────────────────────────────────────────
//  Helper: DuckDuckGo Search (Organic Scraper - FREE)
// ─────────────────────────────────────────────────────────────
async function handleDuckDuckGoSearch(query) {
  try {
    const cleaned = cleanSearchQuery(query) || query;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleaned)}`;
    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const results = [];
    const resultBlocks = html.split('<div class="result results_links results_links_deep web-result');
    
    for (let i = 1; i < resultBlocks.length; i++) {
      const block = resultBlocks[i];
      const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      let snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      
      if (titleMatch) {
        let urlLink = titleMatch[1];
        if (urlLink.includes('uddg=')) {
          const parts = urlLink.split('uddg=');
          if (parts[1]) {
            urlLink = decodeURIComponent(parts[1].split('&')[0]);
          }
        }
        
        if (urlLink.startsWith('//')) {
          urlLink = 'https:' + urlLink;
        } else if (urlLink.startsWith('/')) {
          urlLink = 'https://duckduckgo.com' + urlLink;
        }
        
        const cleanTitle = titleMatch[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        let cleanSnippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
        
        // Try to extract a date if present in the snippet
        const dateMatch = cleanSnippet.match(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})/i);
        
        results.push({
          title: cleanTitle,
          url: urlLink,
          snippet: cleanSnippet,
          date: dateMatch ? dateMatch[1] : null,
          source: "DuckDuckGo"
        });
      }
    }
    
    return results.slice(0, 8);
  } catch (err) {
    console.error("DuckDuckGo scraper error:", err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
//  Helper: Tavily AI Search (AI-Optimized with Answer)
// ─────────────────────────────────────────────────────────────
async function handleTavilySearch(query) {
  try {
    const cleaned = cleanSearchQuery(query) || query;
    const response = await fetchWithTimeout("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: cleaned,
        topic: "general",
        max_results: 8,
        include_answer: true
      })
    });

    const data = await response.json();

    if (data.error) {
      console.error("Tavily error:", data.error);
      return null;
    }

    const results = (data.results || []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      score: r.score,
      source: "Tavily"
    }));

    return { results, answer: data.answer || null };
  } catch (err) {
    console.error("Tavily error:", err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  Helper: SerpAPI Search (Google Results)
// ─────────────────────────────────────────────────────────────
async function handleSerpAPISearch(query) {
  try {
    const cleaned = cleanSearchQuery(query) || query;
    const params = new URLSearchParams({
      q: cleaned,
      api_key: process.env.SERPAPI_KEY,
      engine: "google",
      num: 8
    });

    const response = await fetchWithTimeout(`https://serpapi.com/search?${params}`);
    const data = await response.json();

    if (data.error) {
      console.error("SerpAPI error:", data.error);
      return [];
    }

    return (data.organic_results || []).map(r => ({
      position: r.position,
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      source: "Google (SerpAPI)"
    }));
  } catch (err) {
    console.error("SerpAPI error:", err.message);
    return [];
  }
}

// ═════════════════════════════════════════════════════════════
//  ROUTE 1: Smart Web Search (Auto-selects best available)
// ═════════════════════════════════════════════════════════════
app.post("/api/search", async (req, res) => {
  const { query, service } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });

  console.log(`[SEARCH] Query: "${query}" | Service: ${service || "auto"}`);

  // Try Tavily first (AI-optimized with answer)
  if ((!service || service === "auto" || service === "tavily") && process.env.TAVILY_API_KEY) {
    const tavilyResult = await handleTavilySearch(query);
    if (tavilyResult) {
      return res.json({
        success: true,
        query,
        results: tavilyResult.results,
        answer: tavilyResult.answer,
        service: "tavily",
        count: tavilyResult.results.length
      });
    }
  }

  // Try SerpAPI as fallback
  if ((!service || service === "auto" || service === "serpapi") && process.env.SERPAPI_KEY) {
    const serpResults = await handleSerpAPISearch(query);
    if (serpResults.length > 0) {
      return res.json({
        success: true,
        query,
        results: serpResults,
        service: "serpapi",
        count: serpResults.length
      });
    }
  }

  // Fallback to DuckDuckGo (always works)
  const ddgResults = await handleDuckDuckGoSearch(query);
  res.json({
    success: true,
    query,
    results: ddgResults,
    service: "duckduckgo",
    count: ddgResults.length
  });
});

// ═════════════════════════════════════════════════════════════
//  ROUTE 2: DuckDuckGo Only (Free, No API Key)
// ═════════════════════════════════════════════════════════════
app.post("/api/search/duckduckgo", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });

  try {
    const results = await handleDuckDuckGoSearch(query);
    res.json({
      success: true,
      query,
      results,
      service: "duckduckgo",
      count: results.length
    });
  } catch (err) {
    res.status(500).json({ error: "Search failed: " + err.message });
  }
});

// ═════════════════════════════════════════════════════════════
//  ROUTE 3: Tavily AI Only (Best for AI Research)
// ═════════════════════════════════════════════════════════════
app.post("/api/search/tavily", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });

  if (!process.env.TAVILY_API_KEY) {
    return res.status(503).json({ error: "Tavily API key not configured on server" });
  }

  try {
    const result = await handleTavilySearch(query);
    if (!result) {
      return res.status(500).json({ error: "Tavily search failed" });
    }

    res.json({
      success: true,
      query,
      results: result.results,
      answer: result.answer,
      service: "tavily",
      count: result.results.length
    });
  } catch (err) {
    res.status(500).json({ error: "Tavily error: " + err.message });
  }
});

// ═════════════════════════════════════════════════════════════
//  ROUTE 4: SerpAPI Only (Google Search Results)
// ═════════════════════════════════════════════════════════════
app.post("/api/search/serpapi", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });

  if (!process.env.SERPAPI_KEY) {
    return res.status(503).json({ error: "SerpAPI key not configured on server" });
  }

  try {
    const results = await handleSerpAPISearch(query);
    res.json({
      success: true,
      query,
      results,
      service: "serpapi",
      count: results.length
    });
  } catch (err) {
    res.status(500).json({ error: "SerpAPI error: " + err.message });
  }
});

// ══════════════════════════════════════════════════════════════
//  🎙️ ROUTE: TTS Script Generator — rewrites AI response for speech
// ══════════════════════════════════════════════════════════════
app.post("/api/tts-script", async (req, res) => {
  const { text, context } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

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

  const messages = [
    { role: "system", content: REWRITER_SYSTEM },
    { role: "user", content: `Rewrite this for natural spoken delivery:\n\n${text.slice(0, 3000)}` }
  ];

  if (process.env.GROQ_API_KEY) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages,
          max_tokens: 1200,
          temperature: 0.5
        })
      });
      const data = await response.json();
      const script = data.choices?.[0]?.message?.content?.trim();
      if (script) return res.json({ script });
    } catch (_) { /* fall through to NVIDIA fallback */ }
  }

  if (process.env.NVIDIA_KEY_GPTOSS) {
    try {
      const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.NVIDIA_KEY_GPTOSS}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages,
          max_tokens: 1200,
          temperature: 0.4,
          stream: false
        })
      });
      const data = await response.json();
      const script = data.choices?.[0]?.message?.content?.trim();
      if (script) return res.json({ script });
    } catch (_) { /* fall through to plain-text fallback */ }
  }

  // Fallback: return plain text as single chunk (graceful degradation)
  res.json({ script: text });
});

// ══════════════════════════════════════════════════════════════
// ROUTE: Murf AI Text-to-Speech
// POST /api/tts
// Body: { text: string, voiceId?: string }
// Returns: audio/mpeg, proxied from Murf's CDN URL
// ---------------------------------------------------------------------------
app.post("/api/tts", async (req, res) => {
  const { text, voiceId } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  if (!process.env.MURF_API_KEY || process.env.MURF_API_KEY === "your_murf_api_key_here") {
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
        "Accept": "application/json",
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
      return res.status(generateRes.status).json({
        error: `Murf generate failed (${generateRes.status}): ${message}`,
      });
    }

    const data = await generateRes.json();

    if (!data.audioFile) {
      return res.status(500).json({ error: "Murf returned no audioFile URL." });
    }

    const audioRes = await fetch(data.audioFile);

    if (!audioRes.ok) {
      return res.status(500).json({
        error: `Failed to fetch Murf audio file: HTTP ${audioRes.status}`,
      });
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

// ══════════════════════════════════════════════════════════════
//  🤖 CHAT ENDPOINT — full marker processing on backend
//  Replaces per-agent streaming endpoints for marker-aware chat
// ══════════════════════════════════════════════════════════════
app.post("/api/chat", async (req, res) => {
  const { messages, agent, lowLatency } = req.body;
  if (!messages || !agent) return res.status(400).json({ error: "messages and agent required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Get uid for marker processing (optional — needed for OAuth token access)
  let uid = null;
  try {
    const authHeader = req.headers.authorization;
    if (authHeader) uid = await getUserUid(authHeader);
  } catch {}

  try {
    sendEvent({ type: "status", message: "🤖 Generating response…" });

    let fullResponse = "";
    const agentName = agent;

    if (NVIDIA_MODEL_MAP[agentName]) {
      const { model, key } = NVIDIA_MODEL_MAP[agentName];
      const apiKey = process.env[key];
      if (!apiKey) throw new Error(`${agentName} key not configured.`);
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://integrate.api.nvidia.com/v1/chat/completions",
        { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        { model, messages, max_tokens: 16384, temperature: 0.7 },
        sendEvent
      );
    } else if (agentName === "groq") {
      if (!process.env.GROQ_API_KEY) throw new Error("Groq key not configured.");
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, max_tokens: 8192, temperature: 0.7, stream: true }),
        signal: AbortSignal.timeout(30000)
      });
      if (!groqRes.ok) { const errText = await groqRes.text(); throw new Error(`Groq API error (${groqRes.status}): ${errText.slice(0, 200)}`); }
      const reader = groqRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
          if (data === "[DONE]") break;
          try { const parsed = JSON.parse(data); const content = parsed.choices?.[0]?.delta?.content || ""; if (content) { fullResponse += content; sendEvent({ type: "token", text: content }); } } catch (_) {}
        }
      }
    } else if (agentName === "mistral") {
      if (!process.env.MISTRAL_API_KEY) throw new Error("Mistral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://api.mistral.ai/v1/chat/completions",
        { "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "mistral-large-latest", messages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agentName === "codestral") {
      if (!process.env.CODESTRAL_API_KEY) throw new Error("Codestral key not configured.");
      fullResponse = await streamOpenAICompatibleTokens(
        res,
        "https://codestral.mistral.ai/v1/chat/completions",
        { "Authorization": `Bearer ${process.env.CODESTRAL_API_KEY}`, "Content-Type": "application/json" },
        { model: "codestral-latest", messages, max_tokens: 16384 },
        sendEvent
      );
    } else if (agentName === "gemini") {
      if (!process.env.GEMINI_API_KEY) throw new Error("Gemini key not configured.");
      const prompt = messages[messages.length - 1].content;
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      if (!response.ok) { const text = await response.text(); throw new Error(`Gemini API error (${response.status}): ${text.slice(0, 200)}`); }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
          try { const parsed = JSON.parse(data); const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || ""; if (text) { fullResponse += text; sendEvent({ type: "token", text }); } } catch (_) {}
        }
      }
    } else if (agentName === "cohere") {
      if (!process.env.COHERE_API_KEY) throw new Error("Cohere key not configured.");
      const prompt = messages[messages.length - 1].content;
      const response = await fetch("https://api.cohere.com/v2/chat", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.COHERE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "command-r-plus-08-2024", messages: [{ role: "user", content: prompt }], max_tokens: 4096, stream: true })
      });
      if (!response.ok) { const text = await response.text(); throw new Error(`Cohere API error (${response.status}): ${text.slice(0, 200)}`); }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try { const parsed = JSON.parse(trimmed); if (parsed.type === "content-delta" && parsed.delta?.message?.content?.text) { fullResponse += parsed.delta.message.content.text; sendEvent({ type: "token", text: parsed.delta.message.content.text }); } } catch (_) {}
        }
      }
    } else {
      throw new Error("Invalid agent selected.");
    }

    // Send done event with raw response
    sendEvent({ type: "done", result: fullResponse });

    // Process markers if uid available
    if (uid) {
      const { cleanText } = await processMarkers(fullResponse, uid);
      sendEvent({ type: "processed", displayText: cleanText, cleanText });
    } else {
      sendEvent({ type: "processed", displayText: fullResponse, cleanText: fullResponse });
    }

    res.end();
  } catch (err) {
    sendEvent({ type: "error", message: err.message });
    res.end();
  }
});

// ══════════════════════════════════════════════════════════════
//  ⏰ TASK SCHEDULER — Persistent autonomous agent system
//  Tasks stored at tasks/{uid}/{taskId} in RTDB
// ══════════════════════════════════════════════════════════════

// ── Helper: cron-like "daily at HH:MM" → next run timestamp ──
function parseNextRun(schedule, timezone) {
  if (!schedule) return Date.now() + 7200000; // default 2h
  // Support "daily at HH:MM" or "HH:MM" format
  const dailyMatch = schedule.match(/daily\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i) || schedule.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (dailyMatch) {
    let h = parseInt(dailyMatch[1]), m = parseInt(dailyMatch[2]);
    const ampm = (dailyMatch[3] || '').toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;

    if (timezone) {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      const now = new Date();
      const wall = Object.fromEntries(fmt.formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
      let ty = parseInt(wall.year), tm = parseInt(wall.month), td = parseInt(wall.day);
      if (h < parseInt(wall.hour) || (h === parseInt(wall.hour) && m <= parseInt(wall.minute))) {
        const tom = new Date(ty, tm - 1, td + 1);
        ty = tom.getFullYear(); tm = tom.getMonth() + 1; td = tom.getDate();
      }
      let approx = new Date(Date.UTC(ty, tm - 1, td, h, m));
      for (let i = 0; i < 2; i++) {
        const w2 = Object.fromEntries(fmt.formatToParts(approx).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
        const wh = parseInt(w2.hour), wm = parseInt(w2.minute);
        if (wh === h && wm === m) break;
        approx = new Date(approx.getTime() + (h - wh) * 3600000 + (m - wm) * 60000);
      }
      return approx.getTime();
    }

    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  // Support "every X hours"
  const everyMatch = schedule.match(/every\s+(\d+)\s*hours?/i);
  if (everyMatch) return Date.now() + parseInt(everyMatch[1]) * 3600000;
  // Support "every X minutes"
  const minMatch = schedule.match(/every\s+(\d+)\s*minutes?/i);
  if (minMatch) return Date.now() + parseInt(minMatch[1]) * 60000;
  // Try parsing as a cron-like "0 19 * * *" (minute hour)
  const cronMatch = schedule.match(/^(\d+)\s+(\d+)/);
  if (cronMatch) {
    const m = parseInt(cronMatch[1]), h = parseInt(cronMatch[2]);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  return Date.now() + 7200000; // default 2h
}

// ── Create a task ──
app.post("/api/tasks/create", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { prompt, schedule, agent, type, maxRuns, interval, timezone } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    const now = Date.now();
    const taskId = `task_${now}_${crypto.randomBytes(4).toString("hex")}`;
    const nextRun = type === 'continuous' ? (now + (interval || 7200000)) : parseNextRun(schedule || 'daily at 19:00', timezone);

    const task = {
      prompt,
      status: "active",
      schedule: schedule || 'daily at 19:00',
      timezone: timezone || null,
      agent: agent || 'openai',
      type: type || 'scheduled',
      interval: interval || 7200000,
      lastRun: 0,
      nextRun,
      totalRuns: 0,
      maxRuns: maxRuns || null,
      conversationHistory: [],
      context: {},
      createdAt: now,
      updatedAt: now
    };

    await gmailDb().ref(`tasks/${uid}/${taskId}`).set(task);
    res.json({ created: true, taskId, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── List tasks ──
app.get("/api/tasks/list", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const snap = await gmailDb().ref(`tasks/${uid}`).once("value");
    const data = snap.val() || {};
    const tasks = Object.entries(data).map(([id, t]) => ({ taskId: id, ...t }));
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete a task ──
app.post("/api/tasks/delete", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { taskId } = req.body;
    if (!taskId) return res.status(400).json({ error: "taskId required" });
    await gmailDb().ref(`tasks/${uid}/${taskId}`).remove();
    res.json({ deleted: true, taskId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pause/resume a task ──
app.post("/api/tasks/pause", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { taskId } = req.body;
    if (!taskId) return res.status(400).json({ error: "taskId required" });
    const snap = await gmailDb().ref(`tasks/${uid}/${taskId}`).once("value");
    const task = snap.val();
    if (!task) return res.status(404).json({ error: "Task not found" });
    const newStatus = task.status === "active" ? "paused" : "active";
    await gmailDb().ref(`tasks/${uid}/${taskId}/status`).set(newStatus);
    await gmailDb().ref(`tasks/${uid}/${taskId}/updatedAt`).set(Date.now());
    res.json({ status: newStatus, taskId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── executeSingleTask: run one task (LLM + marker processing + state update) ──
async function executeSingleTask(uid, taskId, task) {
  const now = Date.now();
  const history = task.conversationHistory || [];
  const contextStr = Object.keys(task.context || {}).length ? `\n\nCurrent context: ${JSON.stringify(task.context)}` : '';
  const markerExamples = `\n\nMarker format examples:\n[GMAIL_SEND]{"to":"user@email.com","subject":"Hello","body":"Message with **bold** and *italic*"}[/GMAIL_SEND]\n[CALENDAR_DELETE]{"id":"event-id"}[/CALENDAR_DELETE]\n[DOCS_CREATE]{"title":"Doc","body":"Content"}[/DOCS_CREATE]\n[SAVE_MEMORY]{"personal_information":{"preferred_name":"Manik","full_name":"Manik Mehta","location":{"city":"Fatehabad","state":"Haryana","country":"India"}}}[/SAVE_MEMORY]\n[PEOPLE_LIST]{"query":"John","maxResults":5}[/PEOPLE_LIST]\nUse valid JSON inside markers. Email body supports markdown — it will be converted to HTML.`;
  const completeHint = (task.type !== 'scheduled' && task.type !== 'continuous') ? '\n\nIf this task is permanently done, end with [TASK_COMPLETE] so it is not re-run.' : '';

  // Auto web search if prompt suggests current info is needed
  let webInjection = '';
  if (/news|latest|today|current|search|web|recent|this (week|month|year)/i.test(task.prompt)) {
    try {
      const query = task.prompt.replace(/send.*?mail|email|gmail|GMAIL_SEND|summarize|summary/gi, '').trim().slice(0, 200) || task.prompt.slice(0, 200);
      const webContext = await executeAgenticSearch(task.agent, query);
      if (webContext) {
        webInjection = '\n\n' + formatWebContextForPrompt(webContext);
      }
    } catch (e) {
      console.error(`⏰ Web search for task ${taskId} failed:`, e.message);
    }
  }

  // Inject existing memories so the LLM knows what's already stored
  let memoryInjection = '';
  try {
    const memSnap = await gmailDb().ref(`memories/${uid}`).once('value');
    const mems = memSnap.val() || {};
    const entries = Object.values(mems).filter(m => m.content);
    if (entries.length) {
      const formatted = entries.map(m => {
        if (m.content.includes('\n')) {
          return m.content.split('\n').filter(Boolean).map((line, i) => i === 0 ? line : '  ' + line).join('\n');
        }
        return m.content;
      }).join('\n');
      memoryInjection = '\n\n[Your existing memories about the user]\n' + formatted + '\n\nUse SAVE_MEMORY to store new facts. Skip saving if the fact is already covered above — check carefully to avoid duplicates.';
    }
  } catch (e) { console.error('⏰ Memory fetch error:', e.message); }

  const systemMsg = { role: 'system', content: `You are an autonomous AI agent. Your task:\n${task.prompt}\n\nExecute the actions requested. Use markers (GMAIL_SEND, CALENDAR_DELETE, etc.) to perform operations.${markerExamples}${completeHint}${memoryInjection}${contextStr}` };
  const userContent = task.type === 'continuous'
    ? `Continue your recurring task (runs every ${((task.interval || 60000)/60000).toFixed(0)} min). Previous conversation:\n${history.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n')}\n\n---\nRepeat your action. Do NOT mark as complete — this runs automatically on schedule.`
    : `Execute your task now. Use the available tools (markers) to perform the requested actions.${webInjection}`;
  const userMsg = { role: 'user', content: userContent };
  const messages = [systemMsg, ...history.slice(-10), userMsg];

  const llmResponse = await callModelBackend(task.agent, messages);
  const { cleanText } = await processMarkers(llmResponse, uid);

  const isComplete = cleanText.includes('[TASK_COMPLETE]') || cleanText.includes('✅ Task complete');
  const newConversationHistory = [...history, { role: 'assistant', content: cleanText.replace('[TASK_COMPLETE]', '').trim() }];
  const nextRun = task.type === 'continuous'
    ? (isComplete ? 0 : now + (task.interval || 7200000))
    : parseNextRun(task.schedule, task.timezone);

  const updates = {
    lastRun: now,
    nextRun: isComplete ? 0 : nextRun,
    totalRuns: (task.totalRuns || 0) + 1,
    conversationHistory: newConversationHistory.slice(-50),
    updatedAt: now
  };
  if (isComplete) updates.status = 'completed';

  await gmailDb().ref(`tasks/${uid}/${taskId}`).update(updates);
  console.log(`⏰ Task executed: ${uid.slice(0,8)} / ${taskId.slice(0,12)} / ${isComplete ? 'completed' : 'ran'}`);
  return { uid, taskId, status: isComplete ? 'completed' : 'executed', cleanText };
}

// ── executeDueTasks: check and execute all due tasks ──
let _executingTasks = false;
async function executeDueTasks() {
  if (_executingTasks) return [];
  _executingTasks = true;
  const now = Date.now();
  const executed = [];

  try {
    const allTasksSnap = await gmailDb().ref('tasks').once('value');
    const allUsersTasks = allTasksSnap.val() || {};

    for (const [uid, userTasks] of Object.entries(allUsersTasks)) {
      for (const [taskId, task] of Object.entries(userTasks)) {
        if (task.status !== 'active' || task.nextRun > now) continue;
        if (task.maxRuns && task.totalRuns >= task.maxRuns) {
          await gmailDb().ref(`tasks/${uid}/${taskId}/status`).set('completed');
          continue;
        }

        try {
          executed.push(await executeSingleTask(uid, taskId, task));
        } catch (taskErr) {
          console.error(`⏰ Task ${taskId} (${uid}) failed:`, taskErr.message);
          await gmailDb().ref(`tasks/${uid}/${taskId}/lastRun`).set(now);
          const retryInterval = task.type === 'continuous' ? (task.interval || 60000) : 7200000;
          await gmailDb().ref(`tasks/${uid}/${taskId}/nextRun`).set(now + retryInterval);
          executed.push({ uid, taskId, status: 'failed', error: taskErr.message });
        }
      }
    }
  } catch (err) {
    console.error('⏰ executeDueTasks error:', err.message);
  } finally {
    _executingTasks = false;
  }

  return executed;
}

// ── Run Now: execute a specific task immediately ──
app.post("/api/tasks/run", async (req, res) => {
  try {
    const uid = await getUserUid(req.headers.authorization);
    const { taskId } = req.body;
    if (!taskId) return res.status(400).json({ error: "taskId required" });
    const snap = await gmailDb().ref(`tasks/${uid}/${taskId}`).once("value");
    const task = snap.val();
    if (!task) return res.status(404).json({ error: "Task not found" });
    // Reset history so the LLM starts fresh (no stale failed attempts)
    await gmailDb().ref(`tasks/${uid}/${taskId}/conversationHistory`).set([]);
    task.conversationHistory = [];
    const result = await executeSingleTask(uid, taskId, task);
    res.json(result);
  } catch (err) {
    console.error(`⏰ Run task error: ${err.stack || err.message}`);
    res.status(500).json({ error: err.message, stack: (process.env.NODE_ENV !== 'production') ? err.stack : undefined });
  }
});

// ── Tick: called by cron-job.org every 2 hours (idle coverage) ──
app.post("/api/tasks/tick", async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const provided = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    if (provided !== cronSecret) return res.status(401).json({ error: "Unauthorized" });
  }
  const executed = await executeDueTasks();
  res.json({ ticked: true, timestamp: Date.now(), executed });
});

// Lightweight health check for Render
app.get("/health", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  // Internal tick every 60 seconds — server is always warm from UptimeRobot pings
  setInterval(() => executeDueTasks(), 60000);
  console.log(`🚀 ORBLEN AI Backend running on port ${PORT}`);
  console.log(`   Keys loaded: ${[
    process.env.NVIDIA_KEY_GPTOSS  ? "✅ GPT-OSS-120B" : "❌ GPT-OSS-120B",
    process.env.NVIDIA_KEY_LLAMA   ? "✅ LLaMA 3.3"   : "❌ LLaMA 3.3",
    process.env.NVIDIA_KEY_KIMI    ? "✅ Kimi K2.6"     : "❌ Kimi K2.6",
    process.env.NVIDIA_KEY_GEMMA4  ? "✅ Gemma 4 31B IT" : "❌ Gemma 4 31B IT",
    process.env.GEMINI_API_KEY     ? "✅ Gemini"       : "❌ Gemini",
    process.env.MISTRAL_API_KEY    ? "✅ Mistral"      : "❌ Mistral",
    process.env.CODESTRAL_API_KEY  ? "✅ Codestral"    : "❌ Codestral",
    process.env.GROQ_API_KEY       ? "✅ Groq + 🧠 Memory" : "❌ Groq / Memory",
    process.env.COHERE_API_KEY     ? "✅ Cohere"       : "❌ Cohere",
    process.env.TAVILY_API_KEY     ? "✅ Tavily Search" : "⚠️  Tavily (DDG fallback active)",
    process.env.GOOGLE_CLIENT_ID   ? "✅ Gmail + Docs + Slides + Sheets + Calendar + People" : "❌ Gmail / Docs / Slides / Sheets / Calendar / People",
    firebaseReady                  ? "✅ Firebase RTDB" : "❌ Firebase RTDB",
  ].join(" | ")}`);
});
