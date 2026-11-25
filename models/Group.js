const mongoose = require("mongoose");

// A group chat. `members` always includes the creator (`createdBy`);
// the creator is the only one who can add or remove members. If the
// creator leaves, ownership passes to the longest-standing remaining
// member; if the last member leaves, the group is deleted.
const groupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Group name is required"],
    trim: true,
    minlength: [2, "Group name too short"],
    maxlength: [100, "Group name too long"],
  },

  members: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  ],

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
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

groupSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Group", groupSchema);
