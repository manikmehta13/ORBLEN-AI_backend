// ── Miscellaneous Routes ──────────────────────────────────────────────────────
// Health check, root status, and robots.txt

const { Router } = require("express");

const router = Router();

/** Root endpoint — confirms the backend is live. */
router.get("/", (_req, res) => {
  res.json({ status: "✅ ORBLEN AI Backend is live", version: "1.0.0" });
});

/** Health check used by hosting platforms (Render, Railway, etc.). */
router.get("/health", (_req, res) => res.send("OK"));

/** Disallow all crawlers from indexing the API surface. */
router.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});

module.exports = router;
