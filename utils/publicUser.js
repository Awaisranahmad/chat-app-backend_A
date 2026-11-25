// The shape a user is shown as in API responses. The password hash is
// never included, even if the document somehow carries it.
function publicUser(user) {
  if (!user) return null;
  const u = typeof user.toObject === "function" ? user.toObject() : user;
  return {
    _id: u._id,
    name: u.name,
    email: u.email,
    status: u.status,
    profilePic: u.profilePic || "",
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

module.exports = { publicUser };
