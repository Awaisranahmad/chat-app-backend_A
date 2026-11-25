const express = require("express");
const User = require("../models/User");
const { requireAuth, requireSelf } = require("../middleware/auth");
const { isValidObjectId, escapeRegExp } = require("../utils/validate");
const { parsePagination, pageResponse } = require("../utils/pagination");
const { publicUser } = require("../utils/publicUser");

const router = express.Router();

// Every user route needs a login. (Registering is POST /api/auth/register.)
router.use(requireAuth);

function invalidId(res) {
  return res.status(400).json({ success: false, error: "Invalid ID" });
}

function notFound(res, what) {
  return res.status(404).json({ success: false, error: `${what} not found` });
}

// GET /api/users — paginated list, newest first. Password hashes are
// never included (schema select:false + publicUser).
router.get("/", async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const [users, total] = await Promise.all([
      User.find()
        .select("-passwordHash")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(),
    ]);
    return res.json(pageResponse(users.map(publicUser), total, { page, limit }));
  } catch (err) {
    return next(err);
  }
});

// GET /api/users/search?q=ali — find users by name (case-insensitive).
// The query is escaped before it becomes a RegExp, so search text can
// never change what the pattern means.
router.get("/search", async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) {
      return res
        .status(400)
        .json({ success: false, error: "Search query is required" });
    }
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { name: new RegExp(escapeRegExp(q), "i") };
    const [users, total] = await Promise.all([
      User.find(filter)
        .select("-passwordHash")
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);
    return res.json(pageResponse(users.map(publicUser), total, { page, limit }));
  } catch (err) {
    return next(err);
  }
});

// GET /api/users/:id — any logged-in user can view a profile (you need
// to see people before you can chat with them).
router.get("/:id", async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return invalidId(res);
    const user = await User.findById(req.params.id).select("-passwordHash");
    if (!user) return notFound(res, "User");
    return res.json({ success: true, data: publicUser(user) });
  } catch (err) {
    return next(err);
  }
});

// PUT /api/users/:id — only your own profile. Body may contain name,
// status (online/offline/away) and/or profilePic.
router.put("/:id", requireSelf, async (req, res, next) => {
  try {
    const { name, status, profilePic } = req.body || {};
    const id = req.params.id;
    if (!isValidObjectId(id)) return invalidId(res);
    if (name === undefined && status === undefined && profilePic === undefined) {
      return res.status(400).json({
        success: false,
        error: "At least name, status or profilePic required",
      });
    }
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (status !== undefined) updateData.status = status;
    if (profilePic !== undefined) updateData.profilePic = profilePic;
    updateData.updatedAt = new Date();
    const updatedUser = await User.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });
    if (!updatedUser) return notFound(res, "User");
    return res.json({ success: true, data: publicUser(updatedUser) });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/users/:id — only your own account. Your messages stay in
// the other person's chat history (they keep their copy).
router.delete("/:id", requireSelf, async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return invalidId(res);
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return notFound(res, "User");
    return res.json({ success: true, data: { message: "User deleted" } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
