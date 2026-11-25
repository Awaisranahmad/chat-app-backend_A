const express = require("express");
const Message = require("../models/Message");
const User = require("../models/User");
const Group = require("../models/Group");
const { requireAuth } = require("../middleware/auth");
const { isValidObjectId, escapeRegExp } = require("../utils/validate");
const { parsePagination, pageResponse } = require("../utils/pagination");
const { emitToUser, emitToGroup } = require("../sockets/chat");

const router = express.Router();

// Every message route needs a login.
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

// The sender is always the logged-in user — the client never gets to
// claim to be someone else. A body senderId that disagrees is rejected.
function senderMismatch(req) {
  const claimed = req.body && req.body.senderId;
  return claimed !== undefined && String(claimed) !== String(req.user._id);
}

async function assertGroupMember(groupId, userId) {
  const group = await Group.findById(groupId);
  if (!group) return { error: "not-found" };
  const isMember = group.members.map(String).includes(String(userId));
  if (!isMember) return { error: "forbidden" };
  return { group };
}

// POST /api/message — send a one-to-one message { receiverId, text }
// or a group message { groupId, text }.
router.post("/message", async (req, res, next) => {
  try {
    const { receiverId, groupId, text } = req.body || {};

    if (senderMismatch(req)) {
      return forbidden(res, "senderId must match the logged-in user");
    }
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
    if ((receiverId && groupId) || (!receiverId && !groupId)) {
      return res.status(400).json({
        success: false,
        error: "Provide exactly one of receiverId or groupId",
      });
    }

    let message;
    if (groupId) {
      if (!isValidObjectId(groupId)) return invalidId(res);
      const check = await assertGroupMember(groupId, req.user._id);
      if (check.error === "not-found") return notFound(res, "Group");
      if (check.error === "forbidden") {
        return forbidden(res, "You are not a member of this group");
      }
      message = new Message({
        senderId: req.user._id,
        groupId,
        text: text.trim(),
      });
      await message.save();
      emitToGroup(req, groupId, "receive_message", message);
    } else {
      if (!isValidObjectId(receiverId)) return invalidId(res);
      if (String(receiverId) === String(req.user._id)) {
        return res.status(400).json({
          success: false,
          error: "Sender and receiver must differ",
        });
      }
      const receiver = await User.findById(receiverId);
      if (!receiver) return notFound(res, "User");
      message = new Message({
        senderId: req.user._id,
        receiverId,
        text: text.trim(),
      });
      await message.save();
      emitToUser(req, receiverId, "receive_message", message);
    }

    return res.status(201).json({ success: true, data: message });
  } catch (err) {
    return next(err);
  }
});

// GET /api/message/users/:userId — every one-to-one message a user sent
// or received, newest first. Only your own list.
router.get("/message/users/:userId", async (req, res, next) => {
  try {
    const userId = req.params.userId;
    if (!isValidObjectId(userId)) return invalidId(res);
    if (String(userId) !== String(req.user._id)) {
      return forbidden(res, "You can only view your own messages");
    }
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {
      $or: [{ senderId: userId }, { receiverId: userId }],
    };
    const [messages, total] = await Promise.all([
      Message.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("senderId", "name")
        .populate("receiverId", "name"),
      Message.countDocuments(filter),
    ]);
    return res.json(pageResponse(messages, total, { page, limit }));
  } catch (err) {
    return next(err);
  }
});

// GET /api/messages/chat/:user1/:user2 — conversation, oldest first.
// You must be one of the two people in it.
router.get("/messages/chat/:user1/:user2", async (req, res, next) => {
  try {
    const { user1, user2 } = req.params;
    if (!isValidObjectId(user1) || !isValidObjectId(user2)) {
      return invalidId(res);
    }
    const me = String(req.user._id);
    if (me !== String(user1) && me !== String(user2)) {
      return forbidden(res, "You are not part of this conversation");
    }
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {
      $or: [
        { senderId: user1, receiverId: user2 },
        { senderId: user2, receiverId: user1 },
      ],
    };
    const [messages, total] = await Promise.all([
      Message.find(filter)
        .sort({ createdAt: 1 }) // oldest first
        .skip(skip)
        .limit(limit)
        .populate("senderId", "name profilePic")
        .populate("receiverId", "name profilePic"),
      Message.countDocuments(filter),
    ]);
    return res.json(pageResponse(messages, total, { page, limit }));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/messages/chat/:user1/:user2/read — mark the other person's
// messages to you as read. Returns how many were marked.
router.put("/messages/chat/:user1/:user2/read", async (req, res, next) => {
  try {
    const { user1, user2 } = req.params;
    if (!isValidObjectId(user1) || !isValidObjectId(user2)) {
      return invalidId(res);
    }
    const me = String(req.user._id);
    if (me !== String(user1) && me !== String(user2)) {
      return forbidden(res, "You are not part of this conversation");
    }
    const other = me === String(user1) ? user2 : user1;
    const result = await Message.updateMany(
      { senderId: other, receiverId: req.user._id, isRead: false },
      { $set: { isRead: true } }
    );
    const markedRead = result.modifiedCount || 0;
    if (markedRead > 0) {
      emitToUser(req, other, "messages_read", { by: me, count: markedRead });
    }
    return res.json({ success: true, data: { markedRead } });
  } catch (err) {
    return next(err);
  }
});

// GET /api/messages/unread — unread counts per conversation, plus a total.
// One-to-one counts are grouped by sender; group counts are per group.
router.get("/messages/unread", async (req, res, next) => {
  try {
    const me = req.user._id;
    const conversations = [];

    const senders = await Message.distinct("senderId", {
      receiverId: me,
      isRead: false,
    });
    for (const senderId of senders) {
      const unread = await Message.countDocuments({
        senderId,
        receiverId: me,
        isRead: false,
      });
      if (unread > 0) conversations.push({ userId: String(senderId), unread });
    }

    const groupIds = await Group.distinct("_id", { members: me });
    for (const groupId of groupIds) {
      const unread = await Message.countDocuments({
        groupId,
        senderId: { $ne: me },
        isRead: false,
      });
      if (unread > 0) conversations.push({ groupId: String(groupId), unread });
    }

    const total = conversations.reduce((sum, c) => sum + c.unread, 0);
    return res.json({ success: true, data: { conversations, total } });
  } catch (err) {
    return next(err);
  }
});

// GET /api/messages/search?q=hello — search your own messages by text.
// Only messages you sent, received, or that are in your groups.
router.get("/messages/search", async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) {
      return res
        .status(400)
        .json({ success: false, error: "Search query is required" });
    }
    const { page, limit, skip } = parsePagination(req.query);
    const myGroups = await Group.find({ members: req.user._id }).select("_id");
    const filter = {
      $or: [
        { senderId: req.user._id },
        { receiverId: req.user._id },
        { groupId: { $in: myGroups.map((g) => g._id) } },
      ],
      text: new RegExp(escapeRegExp(q), "i"),
    };
    const [messages, total] = await Promise.all([
      Message.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("senderId", "name"),
      Message.countDocuments(filter),
    ]);
    return res.json(pageResponse(messages, total, { page, limit }));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/messages/:id — edit your own message. Sets edited=true and
// editedAt; the original text is replaced.
router.put("/messages/:id", async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return invalidId(res);
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
    const message = await Message.findById(req.params.id);
    if (!message) return notFound(res, "Message");
    if (String(message.senderId) !== String(req.user._id)) {
      return forbidden(res, "You can only edit your own messages");
    }
    const updated = await Message.findByIdAndUpdate(
      req.params.id,
      { text: text.trim(), edited: true, editedAt: new Date() },
      { new: true, runValidators: true }
    );
    if (updated.receiverId) {
      emitToUser(req, updated.receiverId, "message_edited", updated);
    }
    if (updated.groupId) {
      emitToGroup(req, updated.groupId, "message_edited", updated);
    }
    return res.json({ success: true, data: updated });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/messages/:id — delete your own message (hard delete).
router.delete("/messages/:id", async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return invalidId(res);
    const message = await Message.findById(req.params.id);
    if (!message) return notFound(res, "Message");
    if (String(message.senderId) !== String(req.user._id)) {
      return forbidden(res, "You can only delete your own messages");
    }
    await Message.findByIdAndDelete(req.params.id);
    if (message.receiverId) {
      emitToUser(req, message.receiverId, "message_deleted", {
        messageId: String(message._id),
      });
    }
    if (message.groupId) {
      emitToGroup(req, message.groupId, "message_deleted", {
        messageId: String(message._id),
      });
    }
    return res.json({ success: true, data: { message: "Message deleted" } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
