// ── Firebase Config Route ─────────────────────────────────────────────────────
// Serves the client-side Firebase SDK configuration from environment variables,
// keeping all credentials server-side and out of the frontend bundle.

const { Router } = require("express");

const router = Router();

/**
 * GET /api/firebase-config
 * Returns the Firebase client configuration object.
 */
router.get("/firebase-config", (_req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID,
  });
});

module.exports = router;
