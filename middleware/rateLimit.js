const rateLimit = require("express-rate-limit");
const config = require("../config");

// General limit for all routes: 200 requests per IP per 15 minutes
// by default (see .env.example). Sends standard RateLimit-* headers.
const generalLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, error: "Too many requests, please try again later" },
});

// Stricter limit for register/login: 10 attempts per IP per 15 minutes
// by default, so passwords cannot be brute-forced at full speed.
const authLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.authRateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many login attempts, please try again later",
  },
});

module.exports = { generalLimiter, authLimiter };
