// Extended test suite for the production upgrade (v2.0.0).
// No database needed: model methods are stubbed (the handlers call them
// at request time), save() runs the real Mongoose validation, and the
// Socket.io tests run against a live server with the same stubs.
//
// Env must be set BEFORE requiring the app: config reads it at load time.
// JWT_SECRET is the test secret, bcrypt is cheap (4 rounds), and the
// rate limits are raised so the suite never trips them.
process.env.JWT_SECRET = "test-secret-for-chat-app-backend";
process.env.BCRYPT_ROUNDS = "4";
process.env.RATE_LIMIT_MAX = "10000";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.CORS_ORIGIN = "http://localhost:3000";

const test = require("node:test");
const { after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { io: Client } = require("socket.io-client");
const User = require("../models/User");
const Message = require("../models/Message");
const Group = require("../models/Group");
const app = require("../app");
const { initSockets } = require("../sockets/chat");

const TEST_SECRET = "test-secret-for-chat-app-backend";
const validId = () => new mongoose.Types.ObjectId();
const validIdStr = () => String(validId());
const tokenFor = (user) =>
  jwt.sign({ id: String(user._id) }, TEST_SECRET, { expiresIn: "1h" });

const fakeUser = {
  _id: validIdStr(),
  name: "Ali",
  email: "ali@example.com",
  status: "online",
  profilePic: "",
  createdAt: new Date(),
  updatedAt: new Date(),
};
const otherUser = {
  _id: validIdStr(),
  name: "Sara",
  email: "sara@example.com",
  status: "offline",
  profilePic: "",
  createdAt: new Date(),
  updatedAt: new Date(),
};
const groupId = validIdStr();
const messageId = validIdStr();

// --- Stub state (reset before every test) ---
let usersById = {};
let authUsersByEmail = {};
let messagesById = {};
let groupsById = {};
let userList = [];
let messageList = [];
let groupList = [];
let userCount = 0;
let messageCount = 0;
let groupCount = 0;
let distinctSenders = [];
let distinctGroupIds = [];
let markReadCount = 0;
let userToken = "";

// A Mongoose Query is thenable and has .select(); this fake behaves the
// same way so `await Model.findById(id)` and
// `await Model.findById(id).select(...)` both work.
function queryResult(value) {
  const q = {
    select: async () => value,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
    catch: (onReject) => Promise.resolve(value).catch(onReject),
  };
  return q;
}

// find() chains: .select().sort().skip().limit().populate() — every step
// returns the same query, awaiting it gives the list.
function listQuery(items) {
  const q = {
    select: () => q,
    sort: () => q,
    skip: () => q,
    limit: () => q,
    populate: () => q,
    then: (resolve, reject) => Promise.resolve(items).then(resolve, reject),
    catch: (onReject) => Promise.resolve(items).catch(onReject),
  };
  return q;
}

// Apply a Mongo-style update object ($set / $addToSet / $pull / plain
// fields) to a plain-object copy, the way findByIdAndUpdate would.
function applyUpdate(doc, update) {
  const out = { ...doc };
  if (update.$set) Object.assign(out, update.$set);
  if (update.$addToSet) {
    for (const [key, value] of Object.entries(update.$addToSet)) {
      const values = value && value.$each ? value.$each : [value];
      out[key] = [...(out[key] || [])];
      for (const v of values) {
        if (!out[key].map(String).includes(String(v))) out[key].push(v);
      }
    }
  }
  if (update.$pull) {
    for (const [key, cond] of Object.entries(update.$pull)) {
      const values = cond && cond.$in ? cond.$in : [cond];
      out[key] = (out[key] || []).filter(
        (x) => !values.map(String).includes(String(x))
      );
    }
  }
  for (const [key, value] of Object.entries(update)) {
    if (!key.startsWith("$")) out[key] = value;
  }
  return out;
}

User.findById = (id) => queryResult(usersById[String(id)] ?? null);
User.findOne = (query) =>
  queryResult(authUsersByEmail[(query && query.email) || ""] ?? null);
// Honours a `_id: { $in: [...] }` filter (used to check group members
// exist); every other filter is ignored and the whole list is returned.
User.find = (filter) => {
  let items = userList;
  if (filter && filter._id && filter._id.$in) {
    const ids = filter._id.$in.map(String);
    items = userList.filter((u) => ids.includes(String(u._id)));
  }
  return listQuery(items);
};
User.countDocuments = async () => userCount;
User.findByIdAndUpdate = async (id, update) => {
  const user = usersById[String(id)];
  if (!user) return null;
  const merged = applyUpdate(user, update);
  usersById[String(id)] = merged;
  return merged;
};
User.findByIdAndDelete = async (id) => {
  const user = usersById[String(id)] ?? null;
  delete usersById[String(id)];
  return user;
};
User.prototype.save = async function () {
  const err = this.validateSync();
  if (err) throw err;
  return this;
};

Message.findById = (id) => queryResult(messagesById[String(id)] ?? null);
Message.find = () => listQuery(messageList);
Message.countDocuments = async () => messageCount;
Message.distinct = async (field) =>
  field === "senderId" ? distinctSenders : distinctGroupIds;
Message.updateMany = async () => ({ modifiedCount: markReadCount });
Message.deleteMany = async () => ({ deletedCount: 0 });
Message.findByIdAndUpdate = async (id, update) => {
  const message = messagesById[String(id)];
  if (!message) return null;
  const merged = applyUpdate(message, update);
  messagesById[String(id)] = merged;
  return merged;
};
Message.findByIdAndDelete = async (id) => {
  const message = messagesById[String(id)] ?? null;
  delete messagesById[String(id)];
  return message;
};
Message.prototype.save = async function () {
  const err = this.validateSync();
  if (err) throw err;
  return this;
};

Group.findById = (id) => queryResult(groupsById[String(id)] ?? null);
Group.find = () => listQuery(groupList);
Group.countDocuments = async () => groupCount;
Group.distinct = async () => distinctGroupIds;
Group.findByIdAndUpdate = async (id, update) => {
  const group = groupsById[String(id)];
  if (!group) return null;
  const merged = applyUpdate(group, update);
  groupsById[String(id)] = merged;
  return merged;
};
Group.findByIdAndDelete = async (id) => {
  const group = groupsById[String(id)] ?? null;
  delete groupsById[String(id)];
  return group;
};
Group.prototype.save = async function () {
  const err = this.validateSync();
  if (err) throw err;
  return this;
};

beforeEach(() => {
  usersById = { [fakeUser._id]: { ...fakeUser }, [otherUser._id]: { ...otherUser } };
  authUsersByEmail = {};
  messagesById = {};
  groupsById = {};
  userList = [{ ...fakeUser }, { ...otherUser }];
  messageList = [];
  groupList = [];
  userCount = 2;
  messageCount = 0;
  groupCount = 0;
  distinctSenders = [];
  distinctGroupIds = [];
  markReadCount = 0;
  userToken = tokenFor(fakeUser);
});

// --- Live HTTP server on an ephemeral port ---
const server = app.listen(0);
const listening = new Promise((resolve) => server.once("listening", resolve));

// --- Live Socket.io server (same app, separate HTTP server) ---
let httpServer = null;
let socketServer = null;
let socketPort = 0;
async function ensureSocketServer() {
  if (httpServer) return;
  httpServer = createServer(app);
  socketServer = initSockets(httpServer);
  app.set("io", socketServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  socketPort = httpServer.address().port;
}

after(
  () =>
    new Promise((resolve) => {
      const closeHttp = new Promise((r) => server.close(r));
      const closeSockets = (async () => {
        if (socketServer) socketServer.close();
        if (httpServer) await new Promise((r) => httpServer.close(r));
      })();
      Promise.all([closeHttp, closeSockets]).then(() => resolve());
    })
);

async function request(method, path, body, token) {
  await listening;
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(
    `http://127.0.0.1:${server.address().port}${path}`,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  );
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave json null for non-JSON bodies
  }
  return { status: res.status, json, text, headers: res.headers };
}

// Same as request() but as the logged-in fakeUser.
async function authed(method, path, body) {
  return request(method, path, body, userToken);
}

// --- User model validation (no database needed: validateSync is local) ---

test("User: name is required", () => {
  const err = new User({}).validateSync();
  assert.ok(err, "expected a validation error");
  assert.match(err.message, /Name is required/);
});

test("User: name shorter than 2 characters is rejected", () => {
  const err = new User({ name: "A" }).validateSync();
  assert.ok(err, "expected a validation error");
  assert.match(err.message, /Name too short/);
});

test("User: status must be online, offline or away", () => {
  const err = new User({ name: "Ali", status: "busy" }).validateSync();
  assert.ok(err, "expected a validation error");
  assert.match(err.message, /not a valid enum value for path `status`/);
});

test("User: email is required and must look like an email", () => {
  const missing = new User({
    name: "Ali",
    passwordHash: "hash",
  }).validateSync();
  assert.ok(missing, "expected a validation error");
  assert.match(missing.message, /Email is required/);

  const bad = new User({
    name: "Ali",
    email: "not-an-email",
    passwordHash: "hash",
  }).validateSync();
  assert.ok(bad, "expected a validation error");
  assert.match(bad.message, /Invalid email address/);
});

test("User: passwordHash is required", () => {
  const err = new User({ name: "Ali", email: "ali@example.com" }).validateSync();
  assert.ok(err, "expected a validation error");
  assert.match(err.message, /Password is required/);
});

test("User: a valid user passes validation", () => {
  assert.equal(
    new User({
      name: "Ali",
      email: "ali@example.com",
      passwordHash: "hash",
    }).validateSync(),
    undefined
  );
  assert.equal(
    new User({
      name: "Ali",
      email: "ali@example.com",
      passwordHash: "hash",
      status: "away",
    }).validateSync(),
    undefined
  );
});

test("User: passwordHash is never in the JSON sent to clients", () => {
  const user = new User({
    name: "Ali",
    email: "ali@example.com",
    passwordHash: "super-secret-hash",
  });
  const json = JSON.parse(JSON.stringify(user));
  assert.equal(json.passwordHash, undefined);
  assert.equal(json.email, "ali@example.com");
});

// --- Message model validation ---

test("Message: text is required", () => {
  const err = new Message({
    senderId: validId(),
    receiverId: validId(),
  }).validateSync();
  assert.ok(err, "expected a validation error");
  assert.match(err.message, /text.*required/);
});

test("Message: whitespace-only text is rejected (trim + required)", () => {
  const err = new Message({
    senderId: validId(),
    receiverId: validId(),
    text: "   ",
  }).validateSync();
  assert.ok(err, "expected a validation error for blank text");
});

test("Message: text longer than 1000 characters is rejected", () => {
  const err = new Message({
    senderId: validId(),
    receiverId: validId(),
    text: "x".repeat(1001),
  }).validateSync();
  assert.ok(err, "expected a validation error");
  assert.match(err.message, /longer than the maximum allowed length/);
});

test("Message: senderId is required", () => {
  const err = new Message({ text: "Hi" }).validateSync();
  assert.ok(err, "expected a validation error");
  assert.match(err.message, /senderId.*required/);
});

test("Message: needs exactly one of receiverId or groupId", () => {
  const neither = new Message({
    senderId: validId(),
    text: "Hi",
  }).validateSync();
  assert.ok(neither, "expected a validation error for neither");
  assert.match(neither.message, /exactly one of receiverId or groupId/);

  const both = new Message({
    senderId: validId(),
    receiverId: validId(),
    groupId: validId(),
    text: "Hi",
  }).validateSync();
  assert.ok(both, "expected a validation error for both");
  assert.match(both.message, /exactly one of receiverId or groupId/);
});

test("Message: a group message (senderId + groupId) is valid", () => {
  assert.equal(
    new Message({
      senderId: validId(),
      groupId: validId(),
      text: "Hi group",
    }).validateSync(),
    undefined
  );
});

test("Message: a valid one-to-one message passes validation", () => {
  assert.equal(
    new Message({
      senderId: validId(),
      receiverId: validId(),
      text: "Hi",
    }).validateSync(),
    undefined
  );
});

// --- Regression: the timestamp field the chat routes sort on ---

test("Message: schema has createdAt (the old createAt typo is gone)", () => {
  assert.ok(Message.schema.path("createdAt"), "createdAt must exist");
  assert.equal(
    Message.schema.path("createAt"),
    undefined,
    "createAt must not exist — routes sort by createdAt"
  );
});

// --- Group model validation ---

test("Group: name is required and at least 2 characters", () => {
  const missing = new Group({ members: [validId()], createdBy: validId() }).validateSync();
  assert.ok(missing, "expected a validation error");
  assert.match(missing.message, /Group name is required/);

  const short = new Group({
    name: "A",
    members: [validId()],
    createdBy: validId(),
  }).validateSync();
  assert.ok(short, "expected a validation error");
  assert.match(short.message, /Group name too short/);
});

test("Group: a valid group passes validation", () => {
  assert.equal(
    new Group({
      name: "Team",
      members: [validId(), validId()],
      createdBy: validId(),
    }).validateSync(),
    undefined
  );
});

// --- ObjectId validation used by the routes ---

test("ObjectId check: accepts a real id, rejects junk like '123'", () => {
  assert.equal(mongoose.Types.ObjectId.isValid(validIdStr()), true);
  assert.equal(mongoose.Types.ObjectId.isValid("123"), false);
  assert.equal(mongoose.Types.ObjectId.isValid("not-an-id"), false);
  assert.equal(mongoose.Types.ObjectId.isValid(""), false);
});

// --- Auth routes ---

test("POST /api/auth/register: bad name, email and password are 400s", async () => {
  const shortName = await request("POST", "/api/auth/register", {
    name: "A",
    email: "ali@example.com",
    password: "secret123",
  });
  assert.equal(shortName.status, 400);

  const badEmail = await request("POST", "/api/auth/register", {
    name: "Ali",
    email: "not-an-email",
    password: "secret123",
  });
  assert.equal(badEmail.status, 400);
  assert.match(badEmail.json.error, /Invalid email/);

  const shortPassword = await request("POST", "/api/auth/register", {
    name: "Ali",
    email: "ali@example.com",
    password: "123",
  });
  assert.equal(shortPassword.status, 400);
  assert.match(shortPassword.json.error, /at least 6 characters/);
});

test("POST /api/auth/register: duplicate email is a 400", async () => {
  authUsersByEmail["ali@example.com"] = { ...fakeUser };
  const { status, json } = await request("POST", "/api/auth/register", {
    name: "Ali",
    email: "ali@example.com",
    password: "secret123",
  });
  assert.equal(status, 400);
  assert.match(json.error, /already registered/);
});

test("POST /api/auth/register: success returns a token, never the hash", async () => {
  const { status, json } = await request("POST", "/api/auth/register", {
    name: "Ali",
    email: "new@example.com",
    password: "secret123",
  });
  assert.equal(status, 201);
  assert.equal(json.success, true);
  assert.equal(typeof json.data.token, "string");
  assert.equal(json.data.user.email, "new@example.com");
  assert.equal(json.data.user.passwordHash, undefined);
  const payload = jwt.verify(json.data.token, TEST_SECRET);
  assert.ok(payload.id, "token must carry the user id");
});

test("POST /api/auth/login: unknown email and wrong password are both 401", async () => {
  const unknown = await request("POST", "/api/auth/login", {
    email: "nobody@example.com",
    password: "secret123",
  });
  assert.equal(unknown.status, 401);
  assert.match(unknown.json.error, /Invalid email or password/);

  authUsersByEmail["ali@example.com"] = {
    ...fakeUser,
    passwordHash: await bcrypt.hash("secret123", 4),
  };
  const wrong = await request("POST", "/api/auth/login", {
    email: "ali@example.com",
    password: "wrong-password",
  });
  assert.equal(wrong.status, 401);
  assert.match(wrong.json.error, /Invalid email or password/);
});

test("POST /api/auth/login: success returns a token", async () => {
  authUsersByEmail["ali@example.com"] = {
    ...fakeUser,
    passwordHash: await bcrypt.hash("secret123", 4),
  };
  const { status, json } = await request("POST", "/api/auth/login", {
    email: "ali@example.com",
    password: "secret123",
  });
  assert.equal(status, 200);
  assert.equal(typeof json.data.token, "string");
  assert.equal(json.data.user.email, "ali@example.com");
});

test("GET /api/auth/me: no token is 401, a token returns the user", async () => {
  const anon = await request("GET", "/api/auth/me");
  assert.equal(anon.status, 401);

  const me = await authed("GET", "/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.json.data.email, "ali@example.com");
});

test("Protected routes: missing token is 401, a bad token is 401", async () => {
  const anon = await request("GET", "/api/users");
  assert.equal(anon.status, 401);
  assert.deepEqual(anon.json, {
    success: false,
    error: "Authentication required",
  });

  const bad = await request("GET", "/api/users", undefined, "not-a-real-token");
  assert.equal(bad.status, 401);
});

// --- User routes (all need a login) ---

test("GET /api/users returns a paginated list", async () => {
  const { status, json } = await authed("GET", "/api/users");
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.data.length, 2);
  assert.equal(json.data[0].name, "Ali");
  assert.equal(json.data[0].passwordHash, undefined);
  assert.deepEqual(json.pagination, {
    page: 1,
    limit: 20,
    total: 2,
    totalPages: 1,
  });

  const page2 = await authed("GET", "/api/users?page=2&limit=1");
  assert.equal(page2.json.pagination.page, 2);
  assert.equal(page2.json.pagination.limit, 1);
});

test("GET /api/users/search finds by name, empty query is a 400", async () => {
  userList = [{ ...fakeUser }];
  userCount = 1;
  const { status, json } = await authed("GET", "/api/users/search?q=ali");
  assert.equal(status, 200);
  assert.equal(json.data.length, 1);
  assert.equal(json.data[0].name, "Ali");

  const empty = await authed("GET", "/api/users/search?q=%20%20");
  assert.equal(empty.status, 400);
});

test("GET /api/users/:id: '123' is a 400, unknown is a 404, known is 200", async () => {
  const bad = await authed("GET", "/api/users/123");
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json, { success: false, error: "Invalid ID" });

  const missing = await authed("GET", `/api/users/${validIdStr()}`);
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.json, { success: false, error: "User not found" });

  const ok = await authed("GET", `/api/users/${fakeUser._id}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.name, "Ali");
});

test("PUT /api/users/:id: someone else is 403, empty body 400, own update 200", async () => {
  const other = await authed("PUT", `/api/users/${otherUser._id}`, {
    name: "Hacked",
  });
  assert.equal(other.status, 403);

  const empty = await authed("PUT", `/api/users/${fakeUser._id}`, {});
  assert.equal(empty.status, 400);
  assert.match(empty.json.error, /At least name, status or profilePic/);

  const ok = await authed("PUT", `/api/users/${fakeUser._id}`, {
    name: "Ali Raza",
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.name, "Ali Raza");

  // The account is gone, so the token stops working too: the auth wall
  // answers 401 before the route is even reached.
  delete usersById[fakeUser._id];
  const missing = await authed("PUT", `/api/users/${fakeUser._id}`, {
    name: "Ali Raza",
  });
  assert.equal(missing.status, 401);
});

test("DELETE /api/users/:id: someone else is 403, own delete 200", async () => {
  const other = await authed("DELETE", `/api/users/${otherUser._id}`);
  assert.equal(other.status, 403);

  const ok = await authed("DELETE", `/api/users/${fakeUser._id}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, {
    success: true,
    data: { message: "User deleted" },
  });

  // The account is gone, so the token stops working too.
  const gone = await authed("DELETE", `/api/users/${fakeUser._id}`);
  assert.equal(gone.status, 401);
});

test("POST /api/users is gone: register at /api/auth/register instead", async () => {
  // No login at all: the auth wall answers first.
  const anon = await request("POST", "/api/users/", { name: "Ali" });
  assert.equal(anon.status, 401);
});

// --- Message routes ---

test("GET /api/message/users/:userId: someone else's list is 403", async () => {
  const other = await authed("GET", `/api/message/users/${otherUser._id}`);
  assert.equal(other.status, 403);

  const bad = await authed("GET", "/api/message/users/123");
  assert.equal(bad.status, 400);

  const ok = await authed("GET", `/api/message/users/${fakeUser._id}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.data, []);
  assert.equal(ok.json.pagination.total, 0);
});

test("GET /api/messages/chat/:user1/:user2: outsiders get 403", async () => {
  const bad = await authed("GET", `/api/messages/chat/123/${validIdStr()}`);
  assert.equal(bad.status, 400);

  const outsider = await authed(
    "GET",
    `/api/messages/chat/${otherUser._id}/${validIdStr()}`
  );
  assert.equal(outsider.status, 403);

  const ok = await authed(
    "GET",
    `/api/messages/chat/${fakeUser._id}/${otherUser._id}`
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.data, []);
});

test("POST /api/message: validation and the happy path", async () => {
  const anon = await request("POST", "/api/message", {
    receiverId: otherUser._id,
    text: "Hi",
  });
  assert.equal(anon.status, 401);

  const claimed = await authed("POST", "/api/message", {
    senderId: otherUser._id,
    receiverId: otherUser._id,
    text: "Hi",
  });
  assert.equal(claimed.status, 403);
  assert.match(claimed.json.error, /must match the logged-in user/);

  const badIds = await authed("POST", "/api/message", {
    receiverId: "123",
    text: "Hi",
  });
  assert.equal(badIds.status, 400);

  const self = await authed("POST", "/api/message", {
    receiverId: fakeUser._id,
    text: "Hi",
  });
  assert.equal(self.status, 400);
  assert.match(self.json.error, /must differ/);

  const blank = await authed("POST", "/api/message", {
    receiverId: otherUser._id,
    text: "   ",
  });
  assert.equal(blank.status, 400);
  assert.match(blank.json.error, /text is required/);

  const unknown = await authed("POST", "/api/message", {
    receiverId: validIdStr(),
    text: "Hi",
  });
  assert.equal(unknown.status, 404);

  const ok = await authed("POST", "/api/message", {
    receiverId: otherUser._id,
    text: "Hi",
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.text, "Hi");
});

test("POST /api/message to a group: member 201, non-member 403", async () => {
  groupsById[groupId] = {
    _id: groupId,
    name: "Team",
    members: [fakeUser._id, otherUser._id],
    createdBy: fakeUser._id,
  };
  const ok = await authed("POST", "/api/message", {
    groupId,
    text: "Hello group",
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.text, "Hello group");

  groupsById[groupId] = {
    _id: groupId,
    name: "Team",
    members: [otherUser._id],
    createdBy: otherUser._id,
  };
  const outsider = await authed("POST", "/api/message", {
    groupId,
    text: "Hello group",
  });
  assert.equal(outsider.status, 403);
});

test("PUT /api/messages/:id: only the sender can edit", async () => {
  messagesById[messageId] = {
    _id: messageId,
    senderId: fakeUser._id,
    receiverId: otherUser._id,
    text: "Hi",
    edited: false,
  };

  const bad = await authed("PUT", "/api/messages/123", { text: "Hey" });
  assert.equal(bad.status, 400);

  const missing = await authed("PUT", `/api/messages/${validIdStr()}`, {
    text: "Hey",
  });
  assert.equal(missing.status, 404);

  const blank = await authed("PUT", `/api/messages/${messageId}`, {
    text: "   ",
  });
  assert.equal(blank.status, 400);

  const ok = await authed("PUT", `/api/messages/${messageId}`, {
    text: "Hello!",
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.text, "Hello!");
  assert.equal(ok.json.data.edited, true);
  assert.ok(ok.json.data.editedAt, "editedAt must be set");

  messagesById[messageId] = {
    _id: messageId,
    senderId: otherUser._id,
    receiverId: fakeUser._id,
    text: "Hi",
    edited: false,
  };
  const notMine = await authed("PUT", `/api/messages/${messageId}`, {
    text: "Hacked",
  });
  assert.equal(notMine.status, 403);
});

test("DELETE /api/messages/:id: only the sender can delete", async () => {
  assert.equal((await authed("DELETE", "/api/messages/123")).status, 400);

  assert.equal(
    (await authed("DELETE", `/api/messages/${validIdStr()}`)).status,
    404
  );

  messagesById[messageId] = {
    _id: messageId,
    senderId: otherUser._id,
    receiverId: fakeUser._id,
    text: "Hi",
  };
  const notMine = await authed("DELETE", `/api/messages/${messageId}`);
  assert.equal(notMine.status, 403);

  messagesById[messageId] = {
    _id: messageId,
    senderId: fakeUser._id,
    receiverId: otherUser._id,
    text: "Hi",
  };
  const ok = await authed("DELETE", `/api/messages/${messageId}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, {
    success: true,
    data: { message: "Message deleted" },
  });
});

test("PUT /api/messages/chat/:a/:b/read marks the other side read", async () => {
  markReadCount = 2;
  const ok = await authed(
    "PUT",
    `/api/messages/chat/${fakeUser._id}/${otherUser._id}/read`
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.data, { markedRead: 2 });

  const outsider = await authed(
    "PUT",
    `/api/messages/chat/${otherUser._id}/${validIdStr()}/read`
  );
  assert.equal(outsider.status, 403);
});

test("GET /api/messages/unread counts per conversation", async () => {
  distinctSenders = [otherUser._id];
  distinctGroupIds = [groupId];
  messageCount = 3;
  const { status, json } = await authed("GET", "/api/messages/unread");
  assert.equal(status, 200);
  assert.deepEqual(json.data, {
    conversations: [
      { userId: otherUser._id, unread: 3 },
      { groupId, unread: 3 },
    ],
    total: 6,
  });
});

test("GET /api/messages/search searches only your messages", async () => {
  groupList = [{ _id: groupId }];
  messageList = [
    {
      _id: messageId,
      senderId: otherUser._id,
      receiverId: fakeUser._id,
      text: "hello there",
    },
  ];
  messageCount = 1;
  const { status, json } = await authed("GET", "/api/messages/search?q=hello");
  assert.equal(status, 200);
  assert.equal(json.data.length, 1);
  assert.equal(json.pagination.total, 1);

  const empty = await authed("GET", "/api/messages/search?q=%20");
  assert.equal(empty.status, 400);
});

// --- Group routes ---

const fakeGroup = () => ({
  _id: groupId,
  name: "Team",
  members: [fakeUser._id, otherUser._id],
  createdBy: fakeUser._id,
  createdAt: new Date(),
  updatedAt: new Date(),
});

test("POST /api/groups: validation, then a group with the creator in it", async () => {
  const short = await authed("POST", "/api/groups", { name: "A" });
  assert.equal(short.status, 400);

  const badMember = await authed("POST", "/api/groups", {
    name: "Team",
    memberIds: ["123"],
  });
  assert.equal(badMember.status, 400);

  userList = [{ ...fakeUser }];
  const ghost = await authed("POST", "/api/groups", {
    name: "Team",
    memberIds: [otherUser._id, validIdStr()],
  });
  assert.equal(ghost.status, 400);
  assert.match(ghost.json.error, /do not exist/);

  userList = [{ ...fakeUser }, { ...otherUser }];
  const ok = await authed("POST", "/api/groups", {
    name: "Team",
    memberIds: [otherUser._id],
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.name, "Team");
  assert.ok(ok.json.data.members.map(String).includes(fakeUser._id));
  assert.ok(ok.json.data.members.map(String).includes(otherUser._id));
});

test("GET /api/groups lists your groups, paginated", async () => {
  groupList = [fakeGroup()];
  groupCount = 1;
  const { status, json } = await authed("GET", "/api/groups");
  assert.equal(status, 200);
  assert.equal(json.data.length, 1);
  assert.equal(json.data[0].name, "Team");
  assert.equal(json.pagination.total, 1);
});

test("GET /api/groups/:id: non-member 403, member 200", async () => {
  const bad = await authed("GET", "/api/groups/123");
  assert.equal(bad.status, 400);

  const missing = await authed("GET", `/api/groups/${validIdStr()}`);
  assert.equal(missing.status, 404);

  groupsById[groupId] = { ...fakeGroup(), members: [otherUser._id] };
  const outsider = await authed("GET", `/api/groups/${groupId}`);
  assert.equal(outsider.status, 403);

  groupsById[groupId] = fakeGroup();
  const ok = await authed("GET", `/api/groups/${groupId}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.name, "Team");
});

test("PUT /api/groups/:id/members: creator only, creator cannot be removed", async () => {
  groupsById[groupId] = { ...fakeGroup(), createdBy: otherUser._id };
  const notCreator = await authed("PUT", `/api/groups/${groupId}/members`, {
    add: [otherUser._id],
  });
  assert.equal(notCreator.status, 403);

  groupsById[groupId] = fakeGroup();
  const removeCreator = await authed("PUT", `/api/groups/${groupId}/members`, {
    remove: [fakeUser._id],
  });
  assert.equal(removeCreator.status, 400);

  const thirdId = validIdStr();
  const ok = await authed("PUT", `/api/groups/${groupId}/members`, {
    add: [thirdId],
  });
  // The new member must exist: the stub list is the two known users.
  assert.equal(ok.status, 400);

  const ok2 = await authed("PUT", `/api/groups/${groupId}/members`, {
    add: [otherUser._id],
    remove: [],
  });
  assert.equal(ok2.status, 200);
  assert.ok(ok2.json.data.members.map(String).includes(otherUser._id));
});

test("POST /api/groups/:id/leave: member leaves, last member deletes", async () => {
  groupsById[groupId] = fakeGroup();
  const ok = await authed("POST", `/api/groups/${groupId}/leave`);
  assert.equal(ok.status, 200);
  assert.ok(!ok.json.data.members.map(String).includes(fakeUser._id));
  // Ownership passed to the remaining member.
  assert.equal(String(ok.json.data.createdBy), otherUser._id);

  groupsById[groupId] = {
    ...fakeGroup(),
    members: [fakeUser._id],
    createdBy: fakeUser._id,
  };
  const last = await authed("POST", `/api/groups/${groupId}/leave`);
  assert.equal(last.status, 200);
  assert.match(last.json.data.message, /Group deleted/);
});

test("POST /api/groups/:id/messages: member 201, non-member 403", async () => {
  groupsById[groupId] = { ...fakeGroup(), members: [otherUser._id] };
  const outsider = await authed("POST", `/api/groups/${groupId}/messages`, {
    text: "Hi",
  });
  assert.equal(outsider.status, 403);

  groupsById[groupId] = fakeGroup();
  const ok = await authed("POST", `/api/groups/${groupId}/messages`, {
    text: "Hello group",
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.text, "Hello group");

  const blank = await authed("POST", `/api/groups/${groupId}/messages`, {
    text: "   ",
  });
  assert.equal(blank.status, 400);
});

test("GET /api/groups/:id/messages: member reads history, paginated", async () => {
  groupsById[groupId] = fakeGroup();
  messageList = [
    {
      _id: messageId,
      senderId: fakeUser._id,
      groupId,
      text: "Hello group",
    },
  ];
  messageCount = 1;
  const { status, json } = await authed("GET", `/api/groups/${groupId}/messages`);
  assert.equal(status, 200);
  assert.equal(json.data.length, 1);
  assert.equal(json.pagination.total, 1);
});

test("DELETE /api/groups/:id: creator only", async () => {
  groupsById[groupId] = { ...fakeGroup(), createdBy: otherUser._id };
  const notCreator = await authed("DELETE", `/api/groups/${groupId}`);
  assert.equal(notCreator.status, 403);

  groupsById[groupId] = fakeGroup();
  const ok = await authed("DELETE", `/api/groups/${groupId}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, {
    success: true,
    data: { message: "Group deleted" },
  });
});

// --- Health + rate limiting ---

test("GET /health answers ok, and rate-limit headers are present", async () => {
  const { status, json, headers } = await request("GET", "/health");
  assert.equal(status, 200);
  assert.deepEqual(json, { success: true, data: { status: "ok" } });
  // express-rate-limit sends one combined `ratelimit` header, e.g.
  // `limit=200, remaining=199, reset=900`.
  const rateLimit = headers.get("ratelimit") || "";
  assert.match(rateLimit, /limit=/, "RateLimit header expected");
});

test("Unknown route is a 404 with the consistent error shape", async () => {
  // With a valid login an unknown path is a 404...
  const { status, json } = await authed("GET", "/api/nope");
  assert.equal(status, 404);
  assert.deepEqual(json, { success: false, error: "Route not found" });

  // ...without one the auth wall answers first (routers run requireAuth
  // before any route matching).
  const anon = await request("GET", "/api/nope");
  assert.equal(anon.status, 401);
});

// --- Socket.io (live server, stubbed models) ---

function connectClient(user, tokenOverride) {
  const token =
    tokenOverride === undefined ? tokenFor(user) : tokenOverride;
  return new Promise((resolve, reject) => {
    const socket = Client(`http://127.0.0.1:${socketPort}`, {
      auth: token === null ? {} : { token },
      reconnection: false,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (err) =>
      reject(new Error(`connect_error: ${err.message}`))
    );
  });
}

function waitFor(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${event}`)),
      timeoutMs
    );
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

test("Socket: no token is rejected", async () => {
  await ensureSocketServer();
  await assert.rejects(connectClient(fakeUser, null), /Authentication required/);
});

test("Socket: a valid token connects", async () => {
  await ensureSocketServer();
  const socket = await connectClient(fakeUser);
  assert.ok(socket.connected);
  socket.disconnect();
});

test("Socket: presence — others hear user:online", async () => {
  await ensureSocketServer();
  const bob = await connectClient(otherUser);
  const online = waitFor(bob, "user:online");
  const alice = await connectClient(fakeUser);
  const event = await online;
  assert.equal(event.userId, fakeUser._id);
  alice.disconnect();
  bob.disconnect();
});

test("Socket: typing is forwarded to the other user", async () => {
  await ensureSocketServer();
  const alice = await connectClient(fakeUser);
  const bob = await connectClient(otherUser);
  const typed = waitFor(bob, "typing");
  alice.emit("typing", { to: otherUser._id, isTyping: true });
  const event = await typed;
  assert.equal(event.from, fakeUser._id);
  assert.equal(event.isTyping, true);
  alice.disconnect();
  bob.disconnect();
});

test("Socket: send_message reaches the receiver with an ack", async () => {
  await ensureSocketServer();
  const alice = await connectClient(fakeUser);
  const bob = await connectClient(otherUser);
  const received = waitFor(bob, "receive_message");
  const ack = await new Promise((resolve) => {
    alice.emit(
      "send_message",
      { receiverId: otherUser._id, text: "Hello B" },
      resolve
    );
  });
  assert.equal(ack.success, true);
  const message = await received;
  assert.equal(message.text, "Hello B");
  assert.equal(String(message.senderId), fakeUser._id);
  alice.disconnect();
  bob.disconnect();
});

test("Socket: send_message to yourself is an ack error", async () => {
  await ensureSocketServer();
  const alice = await connectClient(fakeUser);
  const ack = await new Promise((resolve) => {
    alice.emit(
      "send_message",
      { receiverId: fakeUser._id, text: "Hi me" },
      resolve
    );
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /must differ/);
  alice.disconnect();
});

test("Socket: group message reaches group members", async () => {
  await ensureSocketServer();
  groupsById[groupId] = fakeGroup();
  const alice = await connectClient(fakeUser);
  const bob = await connectClient(otherUser);
  alice.emit("join_group", { groupId });
  bob.emit("join_group", { groupId });
  // Give both joins a moment to register before sending.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const received = waitFor(bob, "receive_message");
  const ack = await new Promise((resolve) => {
    alice.emit("send_message", { groupId, text: "Hello group" }, resolve);
  });
  assert.equal(ack.success, true);
  const message = await received;
  assert.equal(message.text, "Hello group");
  alice.disconnect();
  bob.disconnect();
});

test("Socket: mark_read tells the other side", async () => {
  await ensureSocketServer();
  markReadCount = 2;
  const alice = await connectClient(fakeUser);
  const bob = await connectClient(otherUser);
  const read = waitFor(bob, "messages_read");
  alice.emit("mark_read", { chatWith: otherUser._id });
  const event = await read;
  assert.equal(event.by, fakeUser._id);
  assert.equal(event.count, 2);
  alice.disconnect();
  bob.disconnect();
});

test("Socket: a REST message also arrives live", async () => {
  await ensureSocketServer();
  const bob = await connectClient(otherUser);
  const received = waitFor(bob, "receive_message");
  const res = await authed("POST", "/api/message", {
    receiverId: otherUser._id,
    text: "Hi from REST",
  });
  assert.equal(res.status, 201);
  const message = await received;
  assert.equal(message.text, "Hi from REST");
  bob.disconnect();
});
