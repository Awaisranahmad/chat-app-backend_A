const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const config = require("./config");
const { generalLimiter, authLimiter } = require("./middleware/rateLimit");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const messageRoutes = require("./routes/messages");
const groupRoutes = require("./routes/groups");

const app = express();

// Security headers (helmet also removes X-Powered-By).
app.use(helmet());
app.use(cors({ origin: config.corsOrigins }));

// Bodies are small here (a message is at most 1000 chars); reject
// anything bigger outright.
app.use(express.json({ limit: "100kb" }));

// Rate limiting for every route (see middleware/rateLimit.js).
app.use(generalLimiter);

// Health check for load balancers / deploy platforms. Public.
app.get("/health", (req, res) => {
  res.json({ success: true, data: { status: "ok" } });
});

// Auth has its own stricter rate limit (brute-force protection).
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/users", userRoutes);
app.use("/api", messageRoutes);
app.use("/api/groups", groupRoutes);

// Unknown route — one consistent error shape.
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// Global error handler — one consistent error shape everywhere.
// Mongoose validation / cast problems are the client's fault (400);
// duplicate email is a 400 too; anything else is a 500 with a generic
// message (no internals leaked).
app.use((err, req, res, next) => {
  if (err && err.name === "ValidationError") {
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err && err.name === "CastError") {
    return res.status(400).json({ success: false, error: "Invalid ID" });
  }
  if (err && err.code === 11000) {
    return res
      .status(400)
      .json({ success: false, error: "Email already registered" });
  }
  console.error(err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

module.exports = app;
