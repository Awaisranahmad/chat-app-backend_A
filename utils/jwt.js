const jwt = require("jsonwebtoken");
const config = require("../config");

function signToken(userId) {
  return jwt.sign({ id: String(userId) }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = { signToken, verifyToken };
