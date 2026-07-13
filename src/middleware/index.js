// ── Global Middleware ─────────────────────────────────────────────────────────
// Applies project-wide middleware to an Express app instance.

/**
 * Attaches all global middleware to the given Express app.
 * @param {import('express').Application} app
 */
function applyMiddleware(app) {
  const express = require("express");

  // Block search engine indexing of the backend API
  app.use((_req, res, next) => {
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    next();
  });

  // Parse JSON request bodies (up to 15 MB for base64 image payloads)
  app.use(express.json({ limit: "15mb" }));
}

module.exports = { applyMiddleware };
