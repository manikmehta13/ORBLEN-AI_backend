/**
 * ORBLEN AI Backend
 * -----------------------------------------------------------------------------
 * A modular Node.js/Express server that acts as an orchestration layer for
 * AI models, providing real-time web search integration, memory, and TTS.
 * 
 * This file serves as the main entry point, composing configuration,
 * middleware, and routes from the /src directory.
 */

// Load environment variables (must be before any internal imports)
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { corsOptions } = require("./src/config/cors");
const { applyMiddleware } = require("./src/middleware");

// Import Route Modules
const miscRoutes = require("./src/routes/misc");
const firebaseRoutes = require("./src/routes/firebase");
const enhanceRoutes = require("./src/routes/enhance");
const memoryRoutes = require("./src/routes/memory");
const searchRoutes = require("./src/routes/search");
const ttsRoutes = require("./src/routes/tts");
const deepResearchRoutes = require("./src/routes/deepResearch");
const debateRoutes = require("./src/routes/debate");
const chatRoutes = require("./src/routes/chat");

const app = express();
const PORT = process.env.PORT || 3000;

// ── 1. Apply Middleware ───────────────────────────────────────────────────────
// Set up CORS
app.use(cors(corsOptions));
// Handle preflight requests
app.options("*", cors(corsOptions));
// Apply global body parsers and security headers
applyMiddleware(app);

// ── 2. Mount Routes ───────────────────────────────────────────────────────────
// Core & Diagnostics
app.use("/", miscRoutes);

// Config
app.use("/api", firebaseRoutes);

// Utilities & Services
app.use("/api", enhanceRoutes);
app.use("/api", memoryRoutes);
app.use("/api", searchRoutes);
app.use("/api", ttsRoutes);
app.use("/api", deepResearchRoutes);
app.use("/api", debateRoutes);

// Chat Orchestration
app.use("/api", chatRoutes);

// ── 3. Error Handling Fallback ────────────────────────────────────────────────
app.use((req, res, next) => {
  res.status(404).json({ error: "Endpoint not found" });
});

app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

// ── 4. Start Server ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("========================================");
  console.log(`🚀 ORBLEN AI Backend is running`);
  console.log(`📡 Port: ${PORT}`);
  console.log("========================================");
});
