# ORBLEN AI Backend

Secure Node.js/Express server for ORBLEN AI. All API keys live here — never exposed to the frontend.

**Live Frontend:** https://orblen.pages.dev/
**Frontend Repo:** https://github.com/manik1312006/ORBLEN-AI

---

## Architecture

```
Client (Cloudflare Pages)
        │
        │ HTTPS (CORS-restricted)
        ▼
┌───────────────────────────────────────────────────────────┐
│  Express Server (Render Free Tier)                        │
│                                                           │
│  ┌──────────────────────────────────┐                     │
│  │  AI Agent Routes                 │                     │
│  │  /api/gemini    → Google Gemini  │────▶ googleapis.com  │
│  │  /api/mistral   → Mistral AI     │────▶ api.mistral.ai  │
│  │  /api/codestral → Codestral      │────▶ codestral.mistral.ai
│  │  /api/groq      → Groq           │────▶ api.groq.com    │
│  └──────────────────────────────────┘                     │
│                                                           │
│  ┌──────────────────────────────────┐                     │
│  │  Prompt Enhancer                 │                     │
│  │  /api/enhance (Groq)             │                     │
│  └──────────────────────────────────┘                     │
│                                                           │
│  ┌──────────────────────────────────┐                     │
│  │  Google Workspace Integration    │                     │
│  │  (OAuth 2.0 token management)    │────▶ googleapis.com  │
│  │  Gmail / Docs / Slides / Sheets  │                     │
│  │  Calendar / People               │                     │
│  └──────────────────────────────────┘                     │
│                                                           │
│  ┌──────────────────────────────────┐                     │
│  │  Firebase Admin SDK              │◀─── Firebase RTDB   │
│  │  - ID token verification         │    (token storage)  │
│  │  - Per-user OAuth token storage  │                     │
│  └──────────────────────────────────┘                     │
│                                                           │
│  ┌──────────────────────────────────┐                     │
│  │  Services                        │                     │
│  │  - Deep Research Engine          │                     │
│  │  - Smart Web Search (Tavily/DDG) │                     │
│  │  - Memory Extraction (Groq)      │                     │
│  │  - Skill Repository (30+ skills) │                     │
│  │  - TTS Proxy (Murf AI)           │                     │
│  │  - Marker Processor (27 types)   │                     │
│  └──────────────────────────────────┘                     │
└───────────────────────────────────────────────────────────┘
```

---

## File Structure

```
ORBLEN-AI_backend/
├── server.js               # Main server (~5000 lines, all routes & logic)
├── skillRepository.js      # 30+ skill definitions for auto-selection
├── package.json            # Dependencies & scripts
├── .gitignore              # node_modules, .env, *.log
└── .env                    # API keys (never committed)
```

---

## API Routes

### AI Agents (12 Models / 20+ Total)

| Method | Route | Agent | Provider | Model |
|---|---|---|---|---|
| POST | `/api/gemini` | Gemini Flash | Google | `gemini-3.5-flash` |
| POST | `/api/mistral` | Mistral Large | Mistral AI | `mistral-large-latest` |
| POST | `/api/codestral` | Codestral | Mistral AI | `codestral-latest` |
| POST | `/api/groq` | LLaMA 3.3 70B | Groq | `llama-3.3-70b-versatile` |
| POST | `/api/groq-llama-8b` | LLaMA 3.1 8B | Groq | `llama-3.1-8b-instant` |
| POST | `/api/groq-deepseek` | DeepSeek R1 | Groq | `deepseek-r1-distill-llama-70b` |
| POST | `/api/groq-qwen-32b` | Qwen 3 32B | Groq | `qwen3-32b` |
| POST | `/api/groq-qwen-27b` | Qwen 3.6 27B | Groq | `qwen-3.6-27b` |
| POST | `/api/groq-gemma-9b` | Gemma 2 9B | Groq | `gemma2-9b-it` |
| POST | `/api/groq-gemma-27b` | Gemma 2 27B | Groq | `gemma-2-27b-it` |
| POST | `/api/groq-gpt-120b` | GPT-OSS 120B | Groq | `openai/gpt-oss-120b` |
| POST | `/api/groq-gpt-20b` | GPT-OSS 20B | Groq | `openai/gpt-oss-20b` |

Each agent route supports both standard and streaming responses.

### Prompt Enhancer

| Method | Route | Description |
|---|---|---|
| POST | `/api/enhance` | Rewrites user prompt using Groq LLaMA (primary) → returns original if it fails |

Includes a comprehensive system prompt that ensures the enhancer preserves intent, tone, and structure while improving clarity.

### Deep Research Engine

| Method | Route | Description |
|---|---|---|
| POST | `/api/deep-research` | Multi-branch exploration with SSE streaming, automatic web searches per branch, synthesis grounding |

Features:
- Automatic agent fallback if primary agent key is missing
- Branch-level web search (Tavily → DuckDuckGo)
- Search sufficiency evaluation (AI judges if results are sufficient)
- Secondary refinement searches
- Response style instruction injection

### Smart Web Search

| Method | Route | Description |
|---|---|---|
| POST | `/api/search` | Auto-selects Tavily → SerpAPI → DuckDuckGo |
| POST | `/api/search/duckduckgo` | Organic HTML DuckDuckGo scraper (free, no API key) |

### AI Memory Extraction

| Method | Route | Description |
|---|---|---|
| POST | `/api/extract-memory` | Extracts 0-3 factual memories about the user from conversation history using Groq LLaMA |

Memory categories: `personal`, `preference`, `project`, `context`

### Google Workspace Integration

All integrations use OAuth 2.0 with per-user token storage in Firebase Realtime Database. Tokens are auto-refreshed using stored refresh tokens.

#### Gmail (`/api/gmail/*`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/gmail/auth-url` | Get OAuth URL for Gmail scopes |
| GET | `/api/gmail/oauth/callback` | OAuth callback handler |
| GET | `/api/gmail/status` | Check Gmail connection status |
| POST | `/api/gmail/send` | Send email (supports text/plain and multipart/alternative with HTML) |
| POST | `/api/gmail/search` | Search emails (returns metadata of top 10) |
| POST | `/api/gmail/read` | Read full email body (plain text extraction with CSS/HTML cleanup) |

#### Google Docs (`/api/docs/*`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/docs/auth-url` | Get OAuth URL |
| GET | `/api/docs/oauth/callback` | OAuth callback |
| GET | `/api/docs/status` | Check connection |
| POST | `/api/docs/list` | List documents via Drive API |
| POST | `/api/docs/read` | Read document content (plain text extraction with table support) |
| POST | `/api/docs/create` | Create document (with optional markdown content → styled Docs format) |
| POST | `/api/docs/write` | Write/append content (replace or append mode) |
| POST | `/api/docs/delete` | Move to trash |
| POST | `/api/docs/rename` | Rename document |

Includes a full `markdownToDocsRequests()` function that converts bold, italic, code, links, headings, and lists to Google Docs API batchUpdate requests.

#### Google Slides (`/api/slides/*`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/slides/auth-url` | Get OAuth URL |
| GET | `/api/slides/oauth/callback` | OAuth callback |
| GET | `/api/slides/status` | Check connection |
| POST | `/api/slides/list` | List presentations via Drive API |
| POST | `/api/slides/read` | Read presentation content |
| POST | `/api/slides/create` | Create presentation with slides from markdown (--- separated) |
| POST | `/api/slides/write` | Add/replace slides |
| POST | `/api/slides/delete` | Move to trash |
| POST | `/api/slides/rename` | Rename |

Includes `slideContentToRequests()` that parses markdown into slide creation requests with bold/italic formatting.

#### Google Sheets (`/api/sheets/*`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/sheets/auth-url` | Get OAuth URL |
| GET | `/api/sheets/oauth/callback` | OAuth callback |
| GET | `/api/sheets/status` | Check connection |
| POST | `/api/sheets/list` | List spreadsheets via Drive API |
| POST | `/api/sheets/read` | Read cell values (range query) |
| POST | `/api/sheets/create` | Create spreadsheet with optional initial data |
| POST | `/api/sheets/write` | Write or append data |
| POST | `/api/sheets/delete` | Move to trash |
| POST | `/api/sheets/rename` | Rename |

#### Google Calendar (`/api/calendar/*`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/calendar/auth-url` | Get OAuth URL |
| GET | `/api/calendar/oauth/callback` | OAuth callback |
| GET | `/api/calendar/status` | Check connection |
| POST | `/api/calendar/list` | List upcoming events (with timeMin/timeMax filters) |
| POST | `/api/calendar/read` | Read full event details |
| POST | `/api/calendar/create` | Create event with attendees |
| POST | `/api/calendar/quick-add` | Quick add event from natural language text |
| POST | `/api/calendar/update` | Update event fields |
| POST | `/api/calendar/delete` | Delete event |

#### Google People/Contacts (`/api/people/*`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/people/auth-url` | Get OAuth URL |
| GET | `/api/people/oauth/callback` | OAuth callback |
| GET | `/api/people/status` | Check connection |
| POST | `/api/people/list` | List/search contacts (full readMask) |
| POST | `/api/people/get` | Get single contact by resourceName |
| POST | `/api/people/create` | Create contact |
| POST | `/api/people/update` | Update contact fields |

### Skill Repository

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/skills` | List all skills with sources |
| POST | `/api/skills/select` | Select relevant skills for a query (TF-IDF-like scoring) |
| POST | `/api/skills/refresh` | Scan trending web data to surface relevant skills |

30+ skill definitions covering: frontend (React, Vue, Svelte, Angular, Tailwind), backend (Node, Python, Java, Go, .NET, Laravel), data (SQL, NoSQL, Prisma), devops (Docker, K8s, Terraform, CI/CD, Cloud), AI (RAG, Evals), security, testing, mobile/PWA, and more.

### TTS (Text-to-Speech)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/tts-script` | Adapts raw AI responses into vocal scripts for natural speech |
| POST | `/api/tts` | Proxies Murf AI API for MP3 voice generation |

### Backend Marker Processor

The server includes a marker-based system that lets AI responses trigger real Google Workspace actions. Markers are detected in LLM output and executed server-side:

```
[GMAIL_SEND]{"to":"...","subject":"...","body":"..."}[/GMAIL_SEND]
[DOCS_CREATE]{"title":"...","body":"markdown..."}[/DOCS_CREATE]
[CALENDAR_QUICK_ADD]{"text":"Meeting tomorrow at 3pm"}[/CALENDAR_QUICK_ADD]
[SAVE_MEMORY]{"content":"...","category":"..."}[/SAVE_MEMORY]
```

27 marker types total across all Google integrations + memory.

---

## CORS & Security

- CORS restricted to `https://orblen.pages.dev` by default
- Additional origins configurable via `FRONTEND_ORIGINS` env var (comma-separated)
- Wildcard support for Cloudflare preview deployments (`*.--orblen.pages.dev`)
- All responses include `X-Robots-Tag: noindex, nofollow, noarchive`
- `/robots.txt` returns `Disallow: /`
- Firebase Admin SDK verifies ID tokens before any authenticated operation
- Request body limit: 15mb
- Firestore service account key is an env var (not a file)

---

## Uptime & Keepalive

Since Render's free tier puts the server to sleep after ~15 min of inactivity:

1. **UptimeRobot** pings `GET /` every 14 min
2. **Client-side** `pages/chat.html` pings `/health` every 5 min while the chat tab is open

The health route returns:
```json
{ "status": "✅ ORBLEN AI Backend is live", "version": "1.0.0" }
```

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| express | ^4.19.2 | HTTP server framework |
| cors | ^2.8.5 | Cross-origin resource sharing |
| dotenv | ^16.4.5 | Environment variable loading |
| firebase-admin | ^12.7.0 | Firebase auth verification + RTDB access |
| @elevenlabs/elevenlabs-js | ^2.49.1 | ElevenLabs TTS integration |

---

## Setup

```bash
npm install

# Create .env with all API keys
cp .env.example .env   # (or manually create)

# Development (auto-reload)
npm run dev

# Production
npm start
```

**Minimum Node version:** 18.0.0

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: 4000) |
| `GEMINI_API_KEY` | No | Google Gemini API key |
| `MISTRAL_API_KEY` | No | Mistral AI API key |
| `CODESTRAL_API_KEY` | No | Codestral API key |
| `GROQ_API_KEY` | No | Groq API key (free, recommended) |
| `TAVILY_API_KEY` | No | Tavily search API key |
| `GOOGLE_CLIENT_ID` | For OAuth | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | For OAuth | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | For OAuth | OAuth callback URL |
| `FIREBASE_SERVICE_ACCOUNT` | For Auth | Firebase Admin service account JSON |
| `FRONTEND_URL` | No | Frontend URL for OAuth redirects |
| `FRONTEND_ORIGINS` | No | Additional CORS origins (comma-separated) |

The server works with partial keys — missing keys return a clear error message instead of crashing.

---

## Key Design Decisions

1. **All API keys server-side** — the frontend never sees API keys. Every request goes through the Express proxy.
2. **Per-user OAuth tokens in Firebase RTDB** — users connect their Google account once, tokens are stored encrypted-at-rest in Firebase and auto-refreshed.
3. **Markers in LLM output** — instead of building a function-calling system, the server scans AI responses for `[MARKER]` patterns and executes them post-stream. This is simpler and works with any model.
4. **Automatic agent fallback** — Deep Research and Chat routes automatically fall back to an available agent if the requested one's key is missing.
5. **Response style instruction** — all agents receive a "concise by default" instruction that keeps responses short unless depth is required.
7. **UI update** — Fixed integration button layout on frontend to prevent overlap on wide screens.
6. **DuckDuckGo as free fallback** — the organic HTML scraper works without any API key, keeping search available even without Tavily/SerpAPI.
