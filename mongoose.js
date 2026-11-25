const mongoose = require("mongoose");
const config = require("./config");

const connectDB = async () => {
  try {
    // Falls back to mongodb://localhost:27017/chat-app when MONGO_URI
    // is not set (see config.js / .env.example).
    await mongoose.connect(config.mongoUri);
    console.log("Mongoose Connected");
  } catch (err) {
    console.log("error failed to connect", err);
    process.exit(1);
  }
};

module.exports = connectDB;
