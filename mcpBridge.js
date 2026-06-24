const crypto = require("crypto");
const { getDatabase } = require("firebase-admin/database");

const MCP_PROTOCOL_VERSION = "2025-11-25";
const DEFAULT_CLIENT_INFO = {
  name: "ORBLEN AI",
  version: "1.0.0"
};

const remoteSessions = new Map();

function mcpDb() {
  return getDatabase();
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEndpoint(endpoint) {
  const value = trimString(endpoint);
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

function parseHeaderLine(line) {
  const text = trimString(line);
  const idx = text.indexOf(":");
  if (idx <= 0) return null;
  return [text.slice(0, idx).trim(), text.slice(idx + 1).trim()];
}

function safeJsonParse(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function profileToPublic(profile, serverId) {
  return {
    serverId,
    name: profile.name || "",
    endpoint: profile.endpoint || "",
    transport: profile.transport || "streamable-http",
    description: profile.description || "",
    authHeader: profile.authHeader || "",
    headersJson: profile.headersJson || "",
    lastStatus: profile.lastStatus || "unknown",
    lastCheckedAt: profile.lastCheckedAt || 0,
    lastToolsCount: profile.lastToolsCount || 0,
    lastError: profile.lastError || "",
    createdAt: profile.createdAt || 0,
    updatedAt: profile.updatedAt || 0
  };
}

async function readMcpProfiles(uid) {
  const snap = await mcpDb().ref(`users/${uid}/mcp/servers`).once("value");
  return snap.val() || {};
}

async function writeMcpProfile(uid, serverId, profile) {
  await mcpDb().ref(`users/${uid}/mcp/servers/${serverId}`).set(profile);
}

async function deleteMcpProfile(uid, serverId) {
  await mcpDb().ref(`users/${uid}/mcp/servers/${serverId}`).remove();
  remoteSessions.delete(`${uid}:${serverId}`);
}

function buildRequestHeaders(profile = {}, overrides = {}) {
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    ...overrides
  };

  const authHeader = parseHeaderLine(profile.authHeader);
  if (authHeader) headers[authHeader[0]] = authHeader[1];

  const extraHeaders = safeJsonParse(profile.headersJson, null);
  if (extraHeaders && typeof extraHeaders === "object") {
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (value == null) continue;
      headers[key] = String(value);
    }
  }

  return headers;
}

function extractJsonRpcResponse(raw, contentType = "") {
  const text = typeof raw === "string" ? raw : raw?.toString?.() || "";
  if (!text) return null;

  if (contentType.includes("text/event-stream")) {
    const blocks = text.split(/\n\s*\n/);
    for (const block of blocks) {
      const dataLines = block
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trim());
      if (!dataLines.length) continue;
      const payload = dataLines.join("\n");
      if (!payload || payload === "[DONE]") continue;
      try {
        return JSON.parse(payload);
      } catch {
        continue;
      }
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 500) } };
  }
}

async function postJsonRpc(endpoint, payload, headers = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const raw = await response.text();
  const parsed = extractJsonRpcResponse(raw, response.headers.get("content-type") || "");
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    data: parsed
  };
}

async function ensureRemoteSession(profile, key) {
  const cached = remoteSessions.get(key);
  if (cached?.sessionId) return cached;

  const initRequest = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: DEFAULT_CLIENT_INFO
    }
  };

  const result = await postJsonRpc(
    profile.endpoint,
    initRequest,
    buildRequestHeaders(profile)
  );

  if (!result.ok || result.data?.error) {
    const message = result.data?.error?.message || `initialize failed (${result.status})`;
    throw new Error(message);
  }

  const sessionId =
    result.headers.get("MCP-Session-Id") ||
    result.headers.get("Mcp-Session-Id") ||
    result.headers.get("mcp-session-id") ||
    "";

  const session = {
    sessionId,
    serverInfo: result.data?.result?.serverInfo || null,
    capabilities: result.data?.result?.capabilities || null,
    protocolVersion: result.data?.result?.protocolVersion || MCP_PROTOCOL_VERSION,
    updatedAt: Date.now()
  };
  remoteSessions.set(key, session);
  return session;
}

async function callRemoteMethod(profile, key, method, params = {}) {
  const session = await ensureRemoteSession(profile, key);
  const request = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method,
    params
  };

  const headers = buildRequestHeaders(profile);
  if (session.sessionId) headers["MCP-Session-Id"] = session.sessionId;

  const result = await postJsonRpc(profile.endpoint, request, headers);
  if (result.status === 404 && session.sessionId) {
    remoteSessions.delete(key);
    return callRemoteMethod(profile, key, method, params);
  }

  if (!result.ok || result.data?.error) {
    const message = result.data?.error?.message || `MCP ${method} failed (${result.status})`;
    throw new Error(message);
  }

  return result.data?.result ?? result.data;
}

async function listRemoteTools(profile, key) {
  const result = await callRemoteMethod(profile, key, "tools/list", {});
  return Array.isArray(result?.tools) ? result.tools : [];
}

async function listRemoteResources(profile, key) {
  const result = await callRemoteMethod(profile, key, "resources/list", {});
  return Array.isArray(result?.resources) ? result.resources : [];
}

async function listRemotePrompts(profile, key) {
  const result = await callRemoteMethod(profile, key, "prompts/list", {});
  return Array.isArray(result?.prompts) ? result.prompts : [];
}

async function testRemoteProfile(profile, key) {
  const session = await ensureRemoteSession(profile, key);
  const tools = await listRemoteTools(profile, key);
  return {
    serverInfo: session.serverInfo,
    capabilities: session.capabilities,
    tools
  };
}

function registerMcpRoutes(app, deps) {
  const { getUserUid } = deps;

  async function requireUid(req, res) {
    try {
      return await getUserUid(req.headers.authorization);
    } catch (err) {
      res.status(401).json({ error: err.message });
      return null;
    }
  }

  app.get("/api/mcp/servers", async (req, res) => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const profiles = await readMcpProfiles(uid);
      const servers = Object.entries(profiles)
        .map(([serverId, profile]) => profileToPublic(profile, serverId))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      res.json({ success: true, servers });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mcp/servers", async (req, res) => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const {
        serverId,
        name,
        endpoint,
        transport = "streamable-http",
        description = "",
        authHeader = "",
        headersJson = ""
      } = req.body || {};

      if (!name) return res.status(400).json({ error: "name required" });
      if (!endpoint) return res.status(400).json({ error: "endpoint required" });

      const id = trimString(serverId) || `mcp_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const now = Date.now();
      const existingSnap = await mcpDb().ref(`users/${uid}/mcp/servers/${id}`).once("value");
      const existing = existingSnap.val() || {};
      const profile = {
        name: trimString(name),
        endpoint: normalizeEndpoint(endpoint),
        transport: trimString(transport) || "streamable-http",
        description: trimString(description),
        authHeader: trimString(authHeader),
        headersJson: trimString(headersJson),
        createdAt: existing.createdAt || now,
        updatedAt: now,
        lastStatus: existing.lastStatus || "unknown",
        lastCheckedAt: existing.lastCheckedAt || 0,
        lastToolsCount: existing.lastToolsCount || 0,
        lastError: existing.lastError || ""
      };
      await writeMcpProfile(uid, id, profile);
      res.json({ success: true, server: profileToPublic(profile, id) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mcp/servers/delete", async (req, res) => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const { serverId } = req.body || {};
      if (!serverId) return res.status(400).json({ error: "serverId required" });
      await deleteMcpProfile(uid, serverId);
      res.json({ success: true, serverId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mcp/servers/test", async (req, res) => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const { serverId } = req.body || {};
      if (!serverId) return res.status(400).json({ error: "serverId required" });
      const snap = await mcpDb().ref(`users/${uid}/mcp/servers/${serverId}`).once("value");
      const profile = snap.val();
      if (!profile) return res.status(404).json({ error: "Server profile not found" });

      const key = `${uid}:${serverId}`;
      const probe = await testRemoteProfile(profile, key);
      const updated = {
        ...profile,
        lastStatus: "connected",
        lastCheckedAt: Date.now(),
        lastToolsCount: probe.tools.length,
        lastError: ""
      };
      await writeMcpProfile(uid, serverId, updated);
      res.json({
        success: true,
        serverId,
        serverInfo: probe.serverInfo,
        capabilities: probe.capabilities,
        tools: probe.tools
      });
    } catch (err) {
      const { serverId } = req.body || {};
      if (serverId) {
        const snap = await mcpDb().ref(`users/${uid}/mcp/servers/${serverId}`).once("value").catch(() => null);
        const profile = snap?.val?.();
        if (profile) {
          await writeMcpProfile(uid, serverId, {
            ...profile,
            lastStatus: "error",
            lastCheckedAt: Date.now(),
            lastError: err.message
          }).catch(() => {});
        }
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mcp/servers/tools", async (req, res) => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const { serverId } = req.body || {};
      if (!serverId) return res.status(400).json({ error: "serverId required" });
      const snap = await mcpDb().ref(`users/${uid}/mcp/servers/${serverId}`).once("value");
      const profile = snap.val();
      if (!profile) return res.status(404).json({ error: "Server profile not found" });
      const tools = await listRemoteTools(profile, `${uid}:${serverId}`);
      await writeMcpProfile(uid, serverId, {
        ...profile,
        lastStatus: "connected",
        lastCheckedAt: Date.now(),
        lastToolsCount: tools.length,
        lastError: ""
      });
      res.json({ success: true, tools });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mcp/servers/resources", async (req, res) => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const { serverId } = req.body || {};
      if (!serverId) return res.status(400).json({ error: "serverId required" });
      const snap = await mcpDb().ref(`users/${uid}/mcp/servers/${serverId}`).once("value");
      const profile = snap.val();
      if (!profile) return res.status(404).json({ error: "Server profile not found" });
      const resources = await listRemoteResources(profile, `${uid}:${serverId}`);
      res.json({ success: true, resources });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mcp/servers/prompts", async (req, res) => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const { serverId } = req.body || {};
      if (!serverId) return res.status(400).json({ error: "serverId required" });
      const snap = await mcpDb().ref(`users/${uid}/mcp/servers/${serverId}`).once("value");
      const profile = snap.val();
      if (!profile) return res.status(404).json({ error: "Server profile not found" });
      const prompts = await listRemotePrompts(profile, `${uid}:${serverId}`);
      res.json({ success: true, prompts });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mcp/servers/call", async (req, res) => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const { serverId, name, arguments: args = {} } = req.body || {};
      if (!serverId) return res.status(400).json({ error: "serverId required" });
      if (!name) return res.status(400).json({ error: "tool name required" });
      const snap = await mcpDb().ref(`users/${uid}/mcp/servers/${serverId}`).once("value");
      const profile = snap.val();
      if (!profile) return res.status(404).json({ error: "Server profile not found" });
      const result = await callRemoteMethod(profile, `${uid}:${serverId}`, "tools/call", {
        name,
        arguments: args
      });
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = {
  MCP_PROTOCOL_VERSION,
  DEFAULT_CLIENT_INFO,
  registerMcpRoutes,
  readMcpProfiles,
  writeMcpProfile,
  deleteMcpProfile,
  profileToPublic,
  buildRequestHeaders,
  callRemoteMethod,
  listRemoteTools,
  listRemoteResources,
  listRemotePrompts,
  testRemoteProfile,
  normalizeEndpoint,
  safeJsonParse
};
