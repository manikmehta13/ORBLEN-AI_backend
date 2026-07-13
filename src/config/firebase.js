// ── Firebase Admin Initialization ─────────────────────────────────────────────
// Initialises Firebase Admin SDK using a JSON service-account stored in the
// FIREBASE_SERVICE_ACCOUNT environment variable.
// Exports helpers used across route and service modules.

const { initializeApp: initFirebase, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");

let firebaseReady = false;

const fbRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (fbRaw) {
  try {
    const serviceAccount = JSON.parse(fbRaw);
    initFirebase({
      credential: cert(serviceAccount),
      databaseURL: "https://storage-53912-default-rtdb.firebaseio.com",
    });
    firebaseReady = true;
  } catch (e) {
    console.error("Firebase Admin init failed:", e.message);
  }
}

module.exports = { firebaseReady, getAuth, getDatabase };
