const mongoose = require("mongoose");

// A chat message. It belongs to exactly one conversation: either a
// one-to-one chat (`receiverId`) or a group (`groupId`) — never both,
// never neither. That rule is enforced by the validator on `groupId`
// below (a path validator runs in validateSync too, unlike a pre
// ('validate') hook, so the tests can check it without a database).
const messageSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  // One-to-one messages only. Null for group messages.
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },

  // Group messages only. Null for one-to-one messages.
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Group",
    default: null,
    validate: {
      validator: function (value) {
        const hasReceiver = !!this.receiverId;
        const hasGroup = !!value;
        return hasReceiver !== hasGroup;
      },
      message: "Message needs exactly one of receiverId or groupId",
    },
  },

  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000,
  },

  // Read receipts. For one-to-one chats the receiver marks a message
  // read. For groups this is per-message, not per-member: any member
  // marking it read marks it for the group (a per-member receipt
  // collection is a future improvement — see README).
  isRead: {
    type: Boolean,
    default: false,
  },

  // Set by PUT /api/messages/:id when the sender edits a message.
  edited: {
    type: Boolean,
    default: false,
  },

  editedAt: {
    type: Date,
    default: null,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },

  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

messageSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Message", messageSchema);
