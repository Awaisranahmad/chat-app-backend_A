const mongoose = require("mongoose");

// Keep the email check deliberately simple: a full RFC-compliant check is
// overkill here, and this rejects the common mistakes (no @, no domain,
// spaces). The schema also enforces it, so both layers agree.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Escape user input before putting it in a RegExp (search). Without this,
// a query like ".*" would match everything and crafted input could cause
// catastrophic backtracking (ReDoS).
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { EMAIL_RE, isValidObjectId, escapeRegExp };
