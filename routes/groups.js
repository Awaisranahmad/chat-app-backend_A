const express = require("express");
const Group = require("../models/Group");
const User = require("../models/User");
const Message = require("../models/Message");
const { requireAuth } = require("../middleware/auth");
const { isValidObjectId } = require("../utils/validate");
const { parsePagination, pageResponse } = require("../utils/pagination");
const { emitToGroup } = require("../sockets/chat");

const router = express.Router();

// Every group route needs a login.
router.use(requireAuth);

function invalidId(res) {
  return res.status(400).json({ success: false, error: "Invalid ID" });
}

function notFound(res, what) {
  return res.status(404).json({ success: false, error: `${what} not found` });
}

function forbidden(res, message) {
  return res.status(403).json({ success: false, error: message });
}

// Load a group and check the caller is a member. Returns { group } or
// sends the error response itself and returns { error: true }.
async function loadGroupForMember(req, res) {
  if (!isValidObjectId(req.params.id)) {
    invalidId(res);
    return { error: true };
  }
  const group = await Group.findById(req.params.id);
  if (!group) {
    notFound(res, "Group");
    return { error: true };
  }
  const isMember = group.members.map(String).includes(String(req.user._id));
  if (!isMember) {
    forbidden(res, "You are not a member of this group");
    return { error: true };
  }
  return { group };
}

// POST /api/groups — create a group. Body: { name, memberIds: [] }.
// The creator is always added, even if not listed.
router.post("/", async (req, res, next) => {
  try {
    const { name, memberIds = [] } = req.body || {};
    if (typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: "Group name must be at least 2 characters",
      });
    }
    if (!Array.isArray(memberIds)) {
      return res
        .status(400)
        .json({ success: false, error: "memberIds must be an array" });
    }
    if (memberIds.some((id) => !isValidObjectId(id))) return invalidId(res);

    const ids = [...new Set([String(req.user._id), ...memberIds.map(String)])];
    const existing = await User.find({ _id: { $in: ids } }).select("_id");
    if (existing.length !== ids.length) {
      return res
        .status(400)
        .json({ success: false, error: "One or more members do not exist" });
    }

    const group = new Group({ name: name.trim(), members: ids, createdBy: req.user._id });
    await group.save();
    return res.status(201).json({ success: true, data: group });
  } catch (err) {
    return next(err);
  }
});

// GET /api/groups — groups you belong to, newest first.
router.get("/", async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { members: req.user._id };
    const [groups, total] = await Promise.all([
      Group.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("members", "name status")
        .populate("createdBy", "name"),
      Group.countDocuments(filter),
    ]);
    return res.json(pageResponse(groups, total, { page, limit }));
  } catch (err) {
    return next(err);
  }
});

// GET /api/groups/:id — members only.
router.get("/:id", async (req, res, next) => {
  try {
    const { group, error } = await loadGroupForMember(req, res);
    if (error) return undefined;
    return res.json({ success: true, data: group });
  } catch (err) {
    return next(err);
  }
});

// PUT /api/groups/:id/members — add/remove members. Creator only.
// Body: { add: [userIds], remove: [userIds] }. The creator cannot be removed.
router.put("/:id/members", async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return invalidId(res);
    const group = await Group.findById(req.params.id);
    if (!group) return notFound(res, "Group");
    if (String(group.createdBy) !== String(req.user._id)) {
      return forbidden(res, "Only the group creator can manage members");
    }
    const { add = [], remove = [] } = req.body || {};
    if (!Array.isArray(add) || !Array.isArray(remove)) {
      return res
        .status(400)
        .json({ success: false, error: "add and remove must be arrays" });
    }
    if ([...add, ...remove].some((id) => !isValidObjectId(id))) {
      return invalidId(res);
    }
    if (remove.map(String).includes(String(group.createdBy))) {
      return res.status(400).json({
        success: false,
        error: "The group creator cannot be removed",
      });
    }
    if (add.length > 0) {
      const existing = await User.find({ _id: { $in: add } }).select("_id");
      if (existing.length !== new Set(add.map(String)).size) {
        return res
          .status(400)
          .json({ success: false, error: "One or more members do not exist" });
      }
    }
    const updated = await Group.findByIdAndUpdate(
      req.params.id,
      {
        $addToSet: { members: { $each: add } },
        $pull: { members: { $in: remove } },
      },
      { new: true, runValidators: true }
    );
    return res.json({ success: true, data: updated });
  } catch (err) {
    return next(err);
  }
});

// POST /api/groups/:id/leave — leave a group. If the creator leaves and
// others remain, ownership passes to the longest-standing member. If
// the last member leaves, the group (and its messages) are deleted.
router.post("/:id/leave", async (req, res, next) => {
  try {
    const { group, error } = await loadGroupForMember(req, res);
    if (error) return undefined;
    const me = String(req.user._id);
    const remaining = group.members.map(String).filter((id) => id !== me);
    if (remaining.length === 0) {
      await Message.deleteMany({ groupId: group._id });
      await Group.findByIdAndDelete(group._id);
      return res.json({
        success: true,
        data: { message: "Group deleted (last member left)" },
      });
    }
    const update = { $pull: { members: req.user._id } };
    if (String(group.createdBy) === me) {
      update.$set = { createdBy: remaining[0] };
    }
    const updated = await Group.findByIdAndUpdate(group._id, update, {
      new: true,
    });
    return res.json({ success: true, data: updated });
  } catch (err) {
    return next(err);
  }
});

// POST /api/groups/:id/messages — send a message to the group.
router.post("/:id/messages", async (req, res, next) => {
  try {
    const { group, error } = await loadGroupForMember(req, res);
    if (error) return undefined;
    const { text } = req.body || {};
    if (typeof text !== "string" || text.trim() === "") {
      return res
        .status(400)
        .json({ success: false, error: "Message text is required" });
    }
    if (text.trim().length > 1000) {
      return res.status(400).json({
        success: false,
        error: "Message text must be at most 1000 characters",
      });
    }
    const message = new Message({
      senderId: req.user._id,
      groupId: group._id,
      text: text.trim(),
    });
    await message.save();
    emitToGroup(req, group._id, "receive_message", message);
    return res.status(201).json({ success: true, data: message });
  } catch (err) {
    return next(err);
  }
});

// GET /api/groups/:id/messages — group chat history, oldest first.
router.get("/:id/messages", async (req, res, next) => {
  try {
    const { group, error } = await loadGroupForMember(req, res);
    if (error) return undefined;
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { groupId: group._id };
    const [messages, total] = await Promise.all([
      Message.find(filter)
        .sort({ createdAt: 1 }) // oldest first
        .skip(skip)
        .limit(limit)
        .populate("senderId", "name profilePic"),
      Message.countDocuments(filter),
    ]);
    return res.json(pageResponse(messages, total, { page, limit }));
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/groups/:id — creator only. Deletes the group and its messages.
router.delete("/:id", async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return invalidId(res);
    const group = await Group.findById(req.params.id);
    if (!group) return notFound(res, "Group");
    if (String(group.createdBy) !== String(req.user._id)) {
      return forbidden(res, "Only the group creator can delete the group");
    }
    await Message.deleteMany({ groupId: group._id });
    await Group.findByIdAndDelete(group._id);
    return res.json({ success: true, data: { message: "Group deleted" } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
