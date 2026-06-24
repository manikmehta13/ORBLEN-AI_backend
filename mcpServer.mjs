import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const BACKEND_URL = (process.env.ORBLEN_BACKEND_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");
const AUTH_HEADER = process.env.ORBLEN_AUTH_HEADER || "";
const AUTH_TOKEN = process.env.ORBLEN_AUTH_TOKEN || "";

function buildBackendHeaders(extra = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...extra
  };

  if (AUTH_HEADER.includes(":")) {
    const idx = AUTH_HEADER.indexOf(":");
    headers[AUTH_HEADER.slice(0, idx).trim()] = AUTH_HEADER.slice(idx + 1).trim();
  } else if (AUTH_TOKEN) {
    headers.Authorization = AUTH_TOKEN.startsWith("Bearer ") ? AUTH_TOKEN : `Bearer ${AUTH_TOKEN}`;
  }

  return headers;
}

async function backendJson(path, body = null, extraHeaders = {}) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: buildBackendHeaders(extraHeaders),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Backend error (${response.status})`);
  }
  return data;
}

function asText(value) {
  return JSON.stringify(value, null, 2);
}

function toolResult(payload) {
  return { content: [{ type: "text", text: asText(payload) }] };
}

async function callAgent(agent, prompt, lowLatency = true) {
  const route = agent === "openai"
    ? "/api/openai"
    : agent === "nvidia-llama"
      ? "/api/nvidia-llama"
      : agent === "deepseek"
        ? "/api/deepseek"
        : agent === "gemma4"
          ? "/api/gemma4"
          : agent === "gemini"
            ? "/api/gemini"
            : agent === "mistral"
              ? "/api/mistral"
              : agent === "codestral"
                ? "/api/codestral"
                : agent === "groq"
                  ? "/api/groq"
                  : agent === "cohere"
                    ? "/api/cohere"
                    : "/api/openai";

  const body = agent === "gemini" || agent === "cohere"
    ? { prompt, lowLatency }
    : { messages: [{ role: "user", content: prompt }], lowLatency };

  const data = await backendJson(route, body);
  return data.result ?? data;
}

const server = new McpServer({
  name: "orblen-ai",
  version: "1.0.0"
});

server.registerTool(
  "orblen.health",
  {
    title: "Backend health",
    description: "Check whether the ORBLEN backend is reachable.",
    inputSchema: z.object({})
  },
  async () => toolResult(await backendJson("/"))
);

server.registerTool(
  "orblen.skills.list",
  {
    title: "List skills",
    description: "Return the curated ORBLEN skill catalog.",
    inputSchema: z.object({})
  },
  async () => toolResult(await backendJson("/api/skills"))
);

server.registerTool(
  "orblen.skills.select",
  {
    title: "Select skills",
    description: "Score skills against a user query.",
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(12).optional()
    })
  },
  async ({ query, limit }) => toolResult(await backendJson("/api/skills/select", { query, limit }))
);

server.registerTool(
  "orblen.search.web",
  {
    title: "Web search",
    description: "Run ORBLEN's web search pipeline.",
    inputSchema: z.object({
      query: z.string().min(1)
    })
  },
  async ({ query }) => toolResult(await backendJson("/api/search", { query }))
);

server.registerTool(
  "orblen.chat",
  {
    title: "Chat completion",
    description: "Send a prompt to one of ORBLEN's model backends.",
    inputSchema: z.object({
      prompt: z.string().min(1),
      agent: z.enum([
        "openai",
        "gemini",
        "mistral",
        "codestral",
        "groq",
        "cohere",
        "nvidia-llama",
        "deepseek",
        "gemma4"
      ]).default("openai")
    })
  },
  async ({ prompt, agent }) => toolResult({ agent, result: await callAgent(agent, prompt, true) })
);

server.registerTool(
  "orblen.gmail.search",
  {
    title: "Search Gmail",
    description: "Search the connected Gmail inbox.",
    inputSchema: z.object({
      query: z.string().min(1),
      maxResults: z.number().int().min(1).max(50).optional()
    })
  },
  async ({ query, maxResults }) => toolResult(await backendJson("/api/gmail/search", { query, maxResults }))
);

server.registerTool(
  "orblen.gmail.read",
  {
    title: "Read Gmail message",
    description: "Read a single Gmail message by message id.",
    inputSchema: z.object({
      id: z.string().min(1)
    })
  },
  async ({ id }) => toolResult(await backendJson("/api/gmail/read", { id }))
);

server.registerTool(
  "orblen.gmail.send",
  {
    title: "Send Gmail message",
    description: "Send an email from the connected Gmail account.",
    inputSchema: z.object({
      to: z.string().min(1),
      subject: z.string().min(1),
      body: z.string().min(1)
    })
  },
  async ({ to, subject, body }) => toolResult(await backendJson("/api/gmail/send", { to, subject, body }))
);

server.registerTool(
  "orblen.docs.list",
  {
    title: "List Docs",
    description: "List Google Docs files.",
    inputSchema: z.object({
      query: z.string().optional(),
      maxResults: z.number().int().min(1).max(50).optional()
    })
  },
  async ({ query, maxResults }) => toolResult(await backendJson("/api/docs/list", { query, maxResults }))
);

server.registerTool(
  "orblen.docs.read",
  {
    title: "Read Docs document",
    description: "Read a Google Docs document.",
    inputSchema: z.object({
      id: z.string().min(1)
    })
  },
  async ({ id }) => toolResult(await backendJson("/api/docs/read", { id }))
);

server.registerTool(
  "orblen.docs.create",
  {
    title: "Create Docs document",
    description: "Create a Google Docs document from markdown content.",
    inputSchema: z.object({
      title: z.string().min(1),
      body: z.string().optional()
    })
  },
  async ({ title, body }) => toolResult(await backendJson("/api/docs/create", { title, body }))
);

server.registerTool(
  "orblen.docs.write",
  {
    title: "Write Docs document",
    description: "Append or replace content in a Google Docs document.",
    inputSchema: z.object({
      id: z.string().min(1),
      content: z.string().min(1),
      mode: z.enum(["append", "replace"]).optional()
    })
  },
  async ({ id, content, mode }) => toolResult(await backendJson("/api/docs/write", { id, content, mode }))
);

server.registerTool(
  "orblen.docs.delete",
  {
    title: "Delete Docs document",
    description: "Move a Google Docs document to trash.",
    inputSchema: z.object({
      id: z.string().min(1)
    })
  },
  async ({ id }) => toolResult(await backendJson("/api/docs/delete", { id }))
);

server.registerTool(
  "orblen.docs.rename",
  {
    title: "Rename Docs document",
    description: "Rename a Google Docs document.",
    inputSchema: z.object({
      id: z.string().min(1),
      title: z.string().min(1)
    })
  },
  async ({ id, title }) => toolResult(await backendJson("/api/docs/rename", { id, title }))
);

server.registerTool(
  "orblen.slides.list",
  {
    title: "List Slides",
    description: "List Google Slides presentations.",
    inputSchema: z.object({
      query: z.string().optional(),
      maxResults: z.number().int().min(1).max(50).optional()
    })
  },
  async ({ query, maxResults }) => toolResult(await backendJson("/api/slides/list", { query, maxResults }))
);

server.registerTool(
  "orblen.slides.read",
  {
    title: "Read Slides presentation",
    description: "Read a Google Slides presentation.",
    inputSchema: z.object({ id: z.string().min(1) })
  },
  async ({ id }) => toolResult(await backendJson("/api/slides/read", { id }))
);

server.registerTool(
  "orblen.slides.create",
  {
    title: "Create Slides presentation",
    description: "Create a Google Slides presentation from markdown.",
    inputSchema: z.object({
      title: z.string().min(1),
      slides: z.union([z.string(), z.array(z.string())])
    })
  },
  async ({ title, slides }) => toolResult(await backendJson("/api/slides/create", { title, slides }))
);

server.registerTool(
  "orblen.slides.write",
  {
    title: "Write Slides presentation",
    description: "Append or replace slides in a presentation.",
    inputSchema: z.object({
      id: z.string().min(1),
      slides: z.union([z.string(), z.array(z.string())]),
      mode: z.enum(["append", "replace"]).optional()
    })
  },
  async ({ id, slides, mode }) => toolResult(await backendJson("/api/slides/write", { id, slides, mode }))
);

server.registerTool(
  "orblen.slides.delete",
  {
    title: "Delete Slides presentation",
    description: "Move a Google Slides presentation to trash.",
    inputSchema: z.object({ id: z.string().min(1) })
  },
  async ({ id }) => toolResult(await backendJson("/api/slides/delete", { id }))
);

server.registerTool(
  "orblen.slides.rename",
  {
    title: "Rename Slides presentation",
    description: "Rename a Google Slides presentation.",
    inputSchema: z.object({
      id: z.string().min(1),
      title: z.string().min(1)
    })
  },
  async ({ id, title }) => toolResult(await backendJson("/api/slides/rename", { id, title }))
);

server.registerTool(
  "orblen.sheets.list",
  {
    title: "List Sheets",
    description: "List Google Sheets spreadsheets.",
    inputSchema: z.object({
      query: z.string().optional(),
      maxResults: z.number().int().min(1).max(50).optional()
    })
  },
  async ({ query, maxResults }) => toolResult(await backendJson("/api/sheets/list", { query, maxResults }))
);

server.registerTool(
  "orblen.sheets.read",
  {
    title: "Read Sheets spreadsheet",
    description: "Read cell values from a Google Sheet.",
    inputSchema: z.object({
      id: z.string().min(1),
      range: z.string().min(1)
    })
  },
  async ({ id, range }) => toolResult(await backendJson("/api/sheets/read", { id, range }))
);

server.registerTool(
  "orblen.sheets.create",
  {
    title: "Create Sheets spreadsheet",
    description: "Create a Google Sheets spreadsheet with optional initial data.",
    inputSchema: z.object({
      title: z.string().min(1),
      data: z.array(z.array(z.any())).optional()
    })
  },
  async ({ title, data }) => toolResult(await backendJson("/api/sheets/create", { title, data }))
);

server.registerTool(
  "orblen.sheets.write",
  {
    title: "Write Sheets spreadsheet",
    description: "Write or append data to a Google Sheet.",
    inputSchema: z.object({
      id: z.string().min(1),
      range: z.string().min(1),
      values: z.array(z.array(z.any())).min(1),
      mode: z.enum(["append", "update"]).optional()
    })
  },
  async ({ id, range, values, mode }) => toolResult(await backendJson("/api/sheets/write", { id, range, values, mode }))
);

server.registerTool(
  "orblen.sheets.delete",
  {
    title: "Delete Sheets spreadsheet",
    description: "Move a Google Sheets spreadsheet to trash.",
    inputSchema: z.object({ id: z.string().min(1) })
  },
  async ({ id }) => toolResult(await backendJson("/api/sheets/delete", { id }))
);

server.registerTool(
  "orblen.sheets.rename",
  {
    title: "Rename Sheets spreadsheet",
    description: "Rename a Google Sheets spreadsheet.",
    inputSchema: z.object({
      id: z.string().min(1),
      title: z.string().min(1)
    })
  },
  async ({ id, title }) => toolResult(await backendJson("/api/sheets/rename", { id, title }))
);

server.registerTool(
  "orblen.calendar.list",
  {
    title: "List Calendar events",
    description: "List upcoming Google Calendar events.",
    inputSchema: z.object({
      maxResults: z.number().int().min(1).max(50).optional(),
      timeMin: z.string().optional(),
      timeMax: z.string().optional()
    })
  },
  async ({ maxResults, timeMin, timeMax }) => toolResult(await backendJson("/api/calendar/list", { maxResults, timeMin, timeMax }))
);

server.registerTool(
  "orblen.calendar.read",
  {
    title: "Read Calendar event",
    description: "Read a Google Calendar event.",
    inputSchema: z.object({ id: z.string().min(1) })
  },
  async ({ id }) => toolResult(await backendJson("/api/calendar/read", { id }))
);

server.registerTool(
  "orblen.calendar.create",
  {
    title: "Create Calendar event",
    description: "Create a Google Calendar event.",
    inputSchema: z.object({
      summary: z.string().min(1),
      start: z.record(z.any()),
      end: z.record(z.any()).optional(),
      attendees: z.array(z.record(z.any())).optional()
    })
  },
  async ({ summary, start, end, attendees }) => toolResult(await backendJson("/api/calendar/create", { summary, start, end, attendees }))
);

server.registerTool(
  "orblen.calendar.update",
  {
    title: "Update Calendar event",
    description: "Update a Google Calendar event.",
    inputSchema: z.object({
      id: z.string().min(1),
      summary: z.string().optional(),
      start: z.record(z.any()).optional(),
      end: z.record(z.any()).optional(),
      attendees: z.array(z.record(z.any())).optional()
    })
  },
  async ({ id, summary, start, end, attendees }) => toolResult(await backendJson("/api/calendar/update", { id, summary, start, end, attendees }))
);

server.registerTool(
  "orblen.calendar.delete",
  {
    title: "Delete Calendar event",
    description: "Delete a Google Calendar event.",
    inputSchema: z.object({ id: z.string().min(1) })
  },
  async ({ id }) => toolResult(await backendJson("/api/calendar/delete", { id }))
);

server.registerTool(
  "orblen.people.list",
  {
    title: "List People contacts",
    description: "Search Google People contacts.",
    inputSchema: z.object({
      query: z.string().optional(),
      maxResults: z.number().int().min(1).max(100).optional()
    })
  },
  async ({ query, maxResults }) => toolResult(await backendJson("/api/people/list", { query, maxResults }))
);

server.registerTool(
  "orblen.people.get",
  {
    title: "Get People contact",
    description: "Read a Google People contact.",
    inputSchema: z.object({ resourceName: z.string().min(1) })
  },
  async ({ resourceName }) => toolResult(await backendJson("/api/people/get", { resourceName }))
);

server.registerTool(
  "orblen.people.create",
  {
    title: "Create People contact",
    description: "Create a Google People contact.",
    inputSchema: z.object({
      names: z.array(z.record(z.any())).optional(),
      emailAddresses: z.array(z.record(z.any())).optional(),
      phoneNumbers: z.array(z.record(z.any())).optional(),
      addresses: z.array(z.record(z.any())).optional(),
      birthdays: z.array(z.record(z.any())).optional(),
      organizations: z.array(z.record(z.any())).optional(),
      biographies: z.array(z.record(z.any())).optional(),
      nicknames: z.array(z.record(z.any())).optional(),
      urls: z.array(z.record(z.any())).optional()
    })
  },
  async (payload) => toolResult(await backendJson("/api/people/create", payload))
);

server.registerTool(
  "orblen.people.update",
  {
    title: "Update People contact",
    description: "Update a Google People contact.",
    inputSchema: z.object({
      resourceName: z.string().min(1),
      names: z.array(z.record(z.any())).optional(),
      emailAddresses: z.array(z.record(z.any())).optional(),
      phoneNumbers: z.array(z.record(z.any())).optional(),
      addresses: z.array(z.record(z.any())).optional(),
      birthdays: z.array(z.record(z.any())).optional(),
      organizations: z.array(z.record(z.any())).optional(),
      biographies: z.array(z.record(z.any())).optional(),
      nicknames: z.array(z.record(z.any())).optional(),
      urls: z.array(z.record(z.any())).optional()
    })
  },
  async (payload) => toolResult(await backendJson("/api/people/update", payload))
);

server.registerTool(
  "orblen.tasks.list",
  {
    title: "List automations",
    description: "List ORBLEN automation tasks.",
    inputSchema: z.object({})
  },
  async () => toolResult(await backendJson("/api/tasks/list"))
);

server.registerTool(
  "orblen.tasks.create",
  {
    title: "Create automation",
    description: "Create an ORBLEN automation task.",
    inputSchema: z.object({
      prompt: z.string().min(1),
      schedule: z.string().optional(),
      agent: z.string().optional(),
      type: z.string().optional(),
      maxRuns: z.number().int().optional(),
      interval: z.number().int().optional(),
      timezone: z.string().optional()
    })
  },
  async (payload) => toolResult(await backendJson("/api/tasks/create", payload))
);

server.registerTool(
  "orblen.tasks.delete",
  {
    title: "Delete automation",
    description: "Delete an ORBLEN automation task.",
    inputSchema: z.object({ taskId: z.string().min(1) })
  },
  async ({ taskId }) => toolResult(await backendJson("/api/tasks/delete", { taskId }))
);

server.registerTool(
  "orblen.tasks.pause",
  {
    title: "Pause or resume automation",
    description: "Toggle an ORBLEN automation task between active and paused.",
    inputSchema: z.object({ taskId: z.string().min(1) })
  },
  async ({ taskId }) => toolResult(await backendJson("/api/tasks/pause", { taskId }))
);

server.registerTool(
  "orblen.tasks.run",
  {
    title: "Run automation now",
    description: "Execute an ORBLEN automation task immediately.",
    inputSchema: z.object({ taskId: z.string().min(1) })
  },
  async ({ taskId }) => toolResult(await backendJson("/api/tasks/run", { taskId }))
);

const transport = new StdioServerTransport();
await server.connect(transport);
