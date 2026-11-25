const { Server } = require("socket.io");
const config = require("../config");
const { verifyToken } = require("../utils/jwt");
const { isValidObjectId } = require("../utils/validate");
const User = require("../models/User");
const Message = require("../models/Message");
const Group = require("../models/Group");

// The one Socket.io server for the process. REST routes reach it through
// req.app.get("io") and the emit helpers below, so a request can also
// push a live event (e.g. a message sent over HTTP still reaches the
// receiver instantly).
let io = null;

function getIO() {
  return io;
}

// Emit from a REST route handler. No-ops when sockets are not attached
// (for example in tests that only load the Express app).
function emitToUser(req, userId, event, payload) {
  const server = req.app && req.app.get("io");
  if (server) server.to(`user:${userId}`).emit(event, payload);
}

function emitToGroup(req, groupId, event, payload) {
  const server = req.app && req.app.get("io");
  if (server) server.to(`group:${groupId}`).emit(event, payload);
}

// Rooms: every user joins `user:<their id>` on connect; group members
// join `group:<group id>`; a 1-1 chat room is `chat:<id1>:<id2>` with
// the ids sorted so both sides compute the same name.
function chatRoom(a, b) {
  return `chat:${[String(a), String(b)].sort().join(":")}`;
}

function initSockets(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: config.corsOrigins, methods: ["GET", "POST"] },
  });

  // A socket must prove who it is: the client sends its login JWT as
  // { auth: { token } } when connecting. No token, no connection.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication required"));
    try {
      const payload = verifyToken(token);
      const user = await User.findById(payload.id).select("-passwordHash");
      if (!user) return next(new Error("Authentication required"));
      socket.user = user;
      return next();
    } catch {
      return next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = String(socket.user._id);
    socket.join(`user:${userId}`);

    // Presence: mark online and tell everyone else.
    User.findByIdAndUpdate(userId, { status: "online" }).catch(() => {});
    socket.broadcast.emit("user:online", { userId });

    // Join a 1-1 chat room (for typing indicators in that chat).
    socket.on("join_chat", ({ userId: otherId } = {}) => {
      if (typeof otherId === "string" && isValidObjectId(otherId)) {
        socket.join(chatRoom(userId, otherId));
      }
    });

    // Join a group room — only if the caller is a member.
    socket.on("join_group", async ({ groupId } = {}) => {
      if (!groupId || !isValidObjectId(groupId)) return;
      const group = await Group.findById(groupId).catch(() => null);
      if (!group) return;
      if (group.members.map(String).includes(userId)) {
        socket.join(`group:${groupId}`);
      }
    });

    // Live message. The sender is always the logged-in socket user.
    // The ack answers { success, data | error } so the client knows
    // whether the message was saved.
    socket.on("send_message", async (data, ack) => {
      const reply = (payload) => {
        if (typeof ack === "function") ack(payload);
      };
      try {
        const { receiverId, groupId, text } = data || {};
        if (typeof text !== "string" || text.trim() === "") {
          throw new Error("Message text is required");
        }
        if (text.trim().length > 1000) {
          throw new Error("Message text must be at most 1000 characters");
        }
        if ((receiverId && groupId) || (!receiverId && !groupId)) {
          throw new Error("Provide exactly one of receiverId or groupId");
        }

        let message;
        if (groupId) {
          if (!isValidObjectId(groupId)) throw new Error("Invalid ID");
          const group = await Group.findById(groupId);
          if (!group) throw new Error("Group not found");
          if (!group.members.map(String).includes(userId)) {
            throw new Error("You are not a member of this group");
          }
          message = new Message({ senderId: userId, groupId, text: text.trim() });
          await message.save();
          io.to(`group:${groupId}`).emit("receive_message", message);
        } else {
          if (!isValidObjectId(receiverId)) throw new Error("Invalid ID");
          if (String(receiverId) === userId) {
            throw new Error("Sender and receiver must differ");
          }
          const receiver = await User.findById(receiverId);
          if (!receiver) throw new Error("User not found");
          message = new Message({ senderId: userId, receiverId, text: text.trim() });
          await message.save();
          io.to(`user:${receiverId}`).emit("receive_message", message);
        }
        reply({ success: true, data: message });
      } catch (err) {
        reply({ success: false, error: err.message });
      }
    });

    // "typing..." — forwarded to the other person (1-1) only.
    socket.on("typing", ({ to, isTyping } = {}) => {
      if (typeof to === "string" && isValidObjectId(to)) {
        io.to(`user:${to}`).emit("typing", {
          from: userId,
          isTyping: !!isTyping,
        });
      }
    });

    // Mark a 1-1 chat as read; the other side hears about it.
    socket.on("mark_read", async ({ chatWith } = {}) => {
      if (!chatWith || !isValidObjectId(chatWith)) return;
      const result = await Message.updateMany(
        { senderId: chatWith, receiverId: userId, isRead: false },
        { $set: { isRead: true } }
      ).catch(() => null);
      const count = (result && result.modifiedCount) || 0;
      if (count > 0) {
        io.to(`user:${chatWith}`).emit("messages_read", { by: userId, count });
      }
    });

    // Presence: mark offline and tell everyone else.
    socket.on("disconnect", async () => {
      await User.findByIdAndUpdate(userId, { status: "offline" }).catch(() => {});
      socket.broadcast.emit("user:offline", { userId });
    });
  });

  return io;
}

module.exports = { initSockets, getIO, emitToUser, emitToGroup, chatRoom };
