const express = require("express");
const connectDB = require("./mongoose");
const Message = require("./models/Message");
const User = require("./models/User");
const { error } = require("node:console");
const app = express();
connectDB();
app.use(express.json());

app.get("/api/users", async (req, res) => {
  try {
    const user = await User.find();
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/users/:id", async (req, res) => {
  try {
    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }
    const user = await User.findbyId(req.params.id);
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: "Invalid ID" });
  }
});
// GET /api/message/users/:userId
app.get('/api/message/users/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const messages = await Message.find({
      $or: [
        { senderId: userId },
        { receiverId: userId }
      ]
    }).populate('senderId', 'name')
      .populate('receiverId', 'name')
      .sort({ createdAt: -1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// GET /api/messages/chat/:user1/:user2
app.get('/api/messages/chat/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const messages = await Message.find({
      $or: [
        { senderId: user1, receiverId: user2 },
        { senderId: user2, receiverId: user1 }
      ]
    })
    .populate('senderId', 'name profilePic')
    .populate('receiverId', 'name profilePic')
    .sort({ createdAt: 1 }); // oldest first
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/message", async (req, res) => {
  try {
    const { senderId, receiverId, text } = req.body;
    const message = new Message({ senderId, receiverId, text });
    await message.save();
    res.status(201).json(message);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/users/", async (req, res) => {
  try {
    const { name, status } = req.body;
    const newUser = new User({ name, status });
    await newUser.save();
    res.status(201).json({ newUser });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/users/:id", async (req, res) => {
  try {
    const { name, status } = req.body;
    const id = req.params.id;
    const updateData = {};
    if (name) {
      updateData.name = name;
    }
    if (status) {
      updateData.status = status;
    }
    updateData.updateAt = new Date();
    const newUser = User.findByIdAndUpdate(
      id,

      updateData,
      {
        new: true,
        runValidators: true,
      },
      res.json(newUser),
    );
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/users/:id", async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(process.env.PORT, () => {
  console.log("server running ");
});
