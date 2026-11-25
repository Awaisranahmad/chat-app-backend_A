const { verifyToken } = require("../utils/jwt");
const User = require("../models/User");

function unauthorized(res, message = "Authentication required") {
  return res.status(401).json({ success: false, error: message });
}

// Require a valid JWT: `Authorization: Bearer <token>`.
// Attaches the logged-in user (without passwordHash) as req.user.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return unauthorized(res);

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return unauthorized(res, "Invalid or expired token");
  }

  const user = await User.findById(payload.id).select("-passwordHash");
  if (!user) return unauthorized(res);
  req.user = user;
  return next();
}

// The logged-in user may only change their own profile (:id must be them).
function requireSelf(req, res, next) {
  if (String(req.user._id) !== String(req.params.id)) {
    return res
      .status(403)
      .json({ success: false, error: "You can only change your own profile" });
  }
  return next();
}

module.exports = { requireAuth, requireSelf };
