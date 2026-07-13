// ── CORS Configuration ────────────────────────────────────────────────────────
// Restricts browser access to trusted frontend origins only.
// Supports dynamic Cloudflare Pages preview URLs (*.orblen.pages.dev).

const DEFAULT_ALLOWED_ORIGINS = [
  "https://orblen.pages.dev",
];

const configuredOrigins = String(process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);

/**
 * Returns true if the given origin is permitted to access this backend.
 * Allows Cloudflare Pages preview URLs (*.--orblen.pages.dev).
 * @param {string|undefined} origin
 * @returns {boolean}
 */
function isAllowedOrigin(origin) {
  if (!origin) return true; // same-origin / server-to-server
  if (allowedOrigins.has(origin)) return true;

  try {
    const { protocol, hostname } = new URL(origin);
    return (
      protocol === "https:" &&
      (hostname === "orblen.pages.dev" ||
        hostname.endsWith("--orblen.pages.dev"))
    );
  } catch {
    return false;
  }
}

/** Express-compatible CORS options object. */
const corsOptions = {
  origin(origin, callback) {
    callback(null, isAllowedOrigin(origin));
  },
  methods: ["GET", "HEAD", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
  maxAge: 86400,
};

module.exports = { corsOptions, isAllowedOrigin };
