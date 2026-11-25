const express = require("express");
const mongoose = require("mongoose");
const connectDB = require("./mongoose");
const Message = require("./models/Message");
const User = require("./models/User");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// A valid MongoDB ObjectId string, e.g. "507f1f77bcf86cd799439011".
// Mongoose casts bad ids (e.g. "123") and throws a CastError, so check
// up front and answer 400 instead of leaking a 500.
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function invalidId(res) {
  return res.status(400).json({ success: false, error: "Invalid ID" });
}

function notFound(res, what) {
  return res.status(404).json({ success: false, error: `${what} not found` });
}

app.get("/api/users", async (req, res, next) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    next(err);
  }
});

app.get("/api/users/:id", async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return invalidId(res);
    const user = await User.findById(req.params.id);
    if (!user) return notFound(res, "User");
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// GET /api/message/users/:userId — every message a user sent or received
app.get("/api/message/users/:userId", async (req, res, next) => {
  try {
    const userId = req.params.userId;
    if (!isValidObjectId(userId)) return invalidId(res);
    const messages = await Message.find({
      $or: [{ senderId: userId }, { receiverId: userId }],
    })
      .populate("senderId", "name")
      .populate("receiverId", "name")
      .sort({ createdAt: -1 });
    res.json(messages);
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/chat/:user1/:user2 — conversation, oldest first
app.get("/api/messages/chat/:user1/:user2", async (req, res, next) => {
  try {
    const { user1, user2 } = req.params;
    if (!isValidObjectId(user1) || !isValidObjectId(user2)) {
      return invalidId(res);
    }
    const messages = await Message.find({
      $or: [
        { senderId: user1, receiverId: user2 },
        { senderId: user2, receiverId: user1 },
      ],
    })
      .populate("senderId", "name profilePic")
      .populate("receiverId", "name profilePic")
      .sort({ createdAt: 1 }); // oldest first
    res.json(messages);
  } catch (err) {
    next(err);
  }
});

app.post("/api/message", async (req, res, next) => {
  try {
    const { senderId, receiverId, text } = req.body;
    if (!isValidObjectId(senderId) || !isValidObjectId(receiverId)) {
      return invalidId(res);
    }
    if (senderId === receiverId) {
      return res
        .status(400)
        .json({ success: false, error: "Sender and receiver must differ" });
    }
    if (typeof text !== "string" || text.trim() === "") {
      return res
        .status(400)
        .json({ success: false, error: "Message text is required" });
    }
    const message = new Message({ senderId, receiverId, text: text.trim() });
    await message.save();
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

app.post("/api/users/", async (req, res, next) => {
  try {
    const { name, status } = req.body;
    const newUser = new User({ name, status });
    await newUser.save();
    res.status(201).json({ newUser });
  } catch (err) {
    next(err);
  }
});

app.put("/api/users/:id", async (req, res, next) => {
  try {
    const { name, status } = req.body;
    const id = req.params.id;
    if (!isValidObjectId(id)) return invalidId(res);
    if (name === undefined && status === undefined) {
      return res.status(400).json({
        success: false,
        error: "At least name or status required",
      });
    }
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (status !== undefined) updateData.status = status;
    updateData.updatedAt = new Date();
    const updatedUser = await User.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });
    if (!updatedUser) return notFound(res, "User");
    res.json(updatedUser);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/users/:id", async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return invalidId(res);
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return notFound(res, "User");
    res.json({ message: "User deleted" });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/messages/:id", async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return invalidId(res);
    const message = await Message.findByIdAndDelete(req.params.id);
    if (!message) return notFound(res, "Message");
    res.json({ message: "Message deleted" });
  } catch (err) {
    next(err);
  }
});

// Unknown route
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// Global error handler — one consistent error shape everywhere.
// Mongoose validation / cast problems are the client's fault (400);
// anything else is a 500 with a generic message (no internals leaked).
app.use((err, req, res, next) => {
  if (err && err.name === "ValidationError") {
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err && err.name === "CastError") {
    return res.status(400).json({ success: false, error: "Invalid ID" });
  }
  console.error(err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

// Only connect + listen when run directly (`node index.js`).
// Requiring this file (e.g. from tests) just gives you the app.
if (require.main === module) {
  connectDB();
  app.listen(PORT, () => {
    console.log(`server running on port ${PORT}`);
  });
}

module.exports = app;
