const mongoose = require('mongoose');

// 1. Define Schema (structure of a user document)
const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name too short']
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'away'],  // only allowed values
    default: 'online'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// 2. Middleware: update 'updatedAt' on every save
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// 3. Create Model (collection name will be 'users')
const User = mongoose.model('User', userSchema);

module.exports = User;


