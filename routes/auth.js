const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const config = require("../config");
const { signToken } = require("../utils/jwt");
const { EMAIL_RE } = require("../utils/validate");
const { publicUser } = require("../utils/publicUser");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// POST /api/auth/register — create an account, get a login token.
// Body: { name, email, password } (password >= 6 chars, never stored).
router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};

    if (typeof name !== "string" || name.trim().length < 2) {
      return res
        .status(400)
        .json({ success: false, error: "Name must be at least 2 characters" });
    }
    if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid email address" });
    }
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res
        .status(400)
        .json({ success: false, error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
    const user = new User({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
    });
    await user.save();

    return res.status(201).json({
      success: true,
      data: { token: signToken(user._id), user: publicUser(user) },
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/login — Body: { email, password }.
// Wrong email and wrong password give the same 401 on purpose, so the
// response never reveals whether an email is registered.
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || typeof password !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "Email and password are required" });
    }

    // passwordHash is select:false on the schema, so ask for it explicitly.
    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select("+passwordHash");
    if (!user) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid email or password" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid email or password" });
    }

    return res.json({
      success: true,
      data: { token: signToken(user._id), user: publicUser(user) },
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/auth/me — who the token belongs to.
router.get("/me", requireAuth, (req, res) => {
  return res.json({ success: true, data: publicUser(req.user) });
});

module.exports = router;
