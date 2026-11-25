const mongoose = require("mongoose");
const { EMAIL_RE } = require("../utils/validate");

// A user account. `email` + `passwordHash` were added in the production
// upgrade (2026-11-25): accounts created before that have no credentials
// and need to register again — see README "Upgrading from the old version".
//
// `passwordHash` is `select: false`, so no query returns it unless login
// explicitly asks for it, and `toJSON` strips it as a second line of
// defence. Passwords are never stored or returned in plain text.
const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
    trim: true,
    minlength: [2, "Name too short"],
    maxlength: [100, "Name too long"],
  },

  email: {
    type: String,
    required: [true, "Email is required"],
    trim: true,
    lowercase: true,
    unique: true,
    maxlength: [254, "Email too long"],
    match: [EMAIL_RE, "Invalid email address"],
  },

  passwordHash: {
    type: String,
    required: [true, "Password is required"],
    select: false,
  },

  // Presence. The socket server sets this to "online" on connect and
  // "offline" on disconnect; "away" is set by the user.
  status: {
    type: String,
    enum: ["online", "offline", "away"], // only allowed values
    default: "online",
  },

  profilePic: {
    type: String,
    default: "",
    maxlength: [2048, "Profile picture URL too long"],
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

// Middleware: update 'updatedAt' on every save
userSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Never leak the password hash (or the internal __v) in API responses.
userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

// Create Model (collection name will be 'users')
const User = mongoose.model("User", userSchema);

module.exports = User;
