// Central configuration — every setting comes from the environment.
// See .env.example for the full list. No secrets live in code.
require("dotenv").config();

const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/chat-app",

  // JWT auth. In production a real secret is mandatory; anywhere else a
  // dev default is used with a loud warning so a missing .env is obvious.
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,

  // CORS: comma-separated list of allowed browser origins.
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:3000,http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Rate limiting (window in ms, max requests per IP per window).
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX) || 200,
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
};

if (config.nodeEnv === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production (see .env.example)");
}

if (config.nodeEnv !== "production" && !process.env.JWT_SECRET) {
  console.warn(
    "[config] JWT_SECRET is not set — using an insecure dev default. " +
      "Set JWT_SECRET in .env before deploying."
  );
}

module.exports = config;
