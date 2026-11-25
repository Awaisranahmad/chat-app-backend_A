const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../models/User");
const Message = require("../models/Message");
const app = require("../index");

const validId = () => new mongoose.Types.ObjectId();
const validIdStr = () => String(validId());

// --- Stubs: the handlers call these at request time, so replacing them
// here lets the routes run with no database. save() still runs the real
// Mongoose validation, so invalid documents are still rejected. ---
const fakeUser = { _id: validIdStr(), name: "Ali", status: "online" };
const fakeMessage = {
  _id: validIdStr(),
  senderId: validIdStr(),
  receiverId: validIdStr(),
  text: "Hi",
};

let foundUser = null; // what User.findById* returns
let foundMessage = null; // what Message.findByIdAndDelete returns

User.find = async () => [fakeUser];
User.findById = async () => foundUser;
User.findByIdAndUpdate = async () => foundUser;
User.findByIdAndDelete = async () => foundUser;
User.prototype.save = async function () {
  const err = this.validateSync();
  if (err) throw err;
  return this;
};
Message.findByIdAndDelete = async () => foundMessage;
Message.prototype.save = async function () {
  const err = this.validateSync();
  if (err) throw err;
  return this;
};
// Message.find is used as .populate().populate().sort() — chainable fake.
Message.find = () => ({
  populate: () => ({ populate: () => ({ sort: async () => [] }) }),
});

// --- Live server on an ephemeral port ---
const server = app.listen(0);
const listening = new Promise((resolve) => server.once("listening", resolve));
after(() => new Promise((resolve) => server.close(resolve)));

async function request(method, path, body) {
  await listening;
  const res = await fetch(
    `http://127.0.0.1:${server.address().port}${path}`,
    {
      method,
      headers: { "content-type": "application/json" },
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
  return { status: res.status, json, text };
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

test("User: a valid user passes validation", () => {
  assert.equal(new User({ name: "Ali" }).validateSync(), undefined);
  assert.equal(
    new User({ name: "Ali", status: "away" }).validateSync(),
    undefined
  );
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

test("Message: senderId and receiverId are required", () => {
  const err = new Message({ text: "Hi" }).validateSync();
  assert.ok(err, "expected a validation error");
  assert.match(err.message, /senderId.*required/);
});

test("Message: a valid message passes validation", () => {
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

// --- ObjectId validation used by the routes ---

test("ObjectId check: accepts a real id, rejects junk like '123'", () => {
  assert.equal(mongoose.Types.ObjectId.isValid(validIdStr()), true);
  assert.equal(mongoose.Types.ObjectId.isValid("123"), false);
  assert.equal(mongoose.Types.ObjectId.isValid("not-an-id"), false);
  assert.equal(mongoose.Types.ObjectId.isValid(""), false);
});

// --- Live route behaviour (stubbed models, real HTTP) ---

test("GET /api/users returns the user list", async () => {
  const { status, json } = await request("GET", "/api/users");
  assert.equal(status, 200);
  assert.equal(json.length, 1);
  assert.equal(json[0].name, "Ali");
});

test("GET /api/users/:id: '123' is a 400, a valid but unknown id is a 404", async () => {
  const bad = await request("GET", "/api/users/123");
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json, { success: false, error: "Invalid ID" });

  foundUser = null;
  const missing = await request("GET", `/api/users/${validIdStr()}`);
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.json, { success: false, error: "User not found" });

  // Regression: the old route threw ReferenceError here (it checked
  // `user` before defining it) and called non-existent findbyId.
  foundUser = fakeUser;
  const ok = await request("GET", `/api/users/${validIdStr()}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.name, "Ali");
  foundUser = null;
});

test("GET /api/message/users/:userId validates the id", async () => {
  const bad = await request("GET", "/api/message/users/123");
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json, { success: false, error: "Invalid ID" });

  const ok = await request("GET", `/api/message/users/${validIdStr()}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, []);
});

test("GET /api/messages/chat/:user1/:user2 validates both ids", async () => {
  const bad = await request(
    "GET",
    `/api/messages/chat/123/${validIdStr()}`
  );
  assert.equal(bad.status, 400);

  const ok = await request(
    "GET",
    `/api/messages/chat/${validIdStr()}/${validIdStr()}`
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, []);
});

test("POST /api/message rejects bad ids, same sender/receiver, blank text", async () => {
  const a = validIdStr();
  const b = validIdStr();

  const badIds = await request("POST", "/api/message", {
    senderId: "123",
    receiverId: b,
    text: "Hi",
  });
  assert.equal(badIds.status, 400);

  const same = await request("POST", "/api/message", {
    senderId: a,
    receiverId: a,
    text: "Hi",
  });
  assert.equal(same.status, 400);
  assert.match(same.json.error, /must differ/);

  const blank = await request("POST", "/api/message", {
    senderId: a,
    receiverId: b,
    text: "   ",
  });
  assert.equal(blank.status, 400);
  assert.match(blank.json.error, /text is required/);

  const ok = await request("POST", "/api/message", {
    senderId: a,
    receiverId: b,
    text: "Hi",
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.text, "Hi");
});

test("POST /api/users: missing name is a 400", async () => {
  const { status, json } = await request("POST", "/api/users/", {});
  assert.equal(status, 400);
  assert.equal(json.success, false);
  assert.match(json.error, /Name is required/);
});

test("PUT /api/users/:id: bad id 400, empty body 400, valid update 200", async () => {
  const badId = await request("PUT", "/api/users/123", { name: "Ali" });
  assert.equal(badId.status, 400);

  const empty = await request("PUT", `/api/users/${validIdStr()}`, {});
  assert.equal(empty.status, 400);
  assert.match(empty.json.error, /At least name or status required/);

  // Regression: the old handler never awaited the update and passed
  // res.json() as a callback, answering before the update finished.
  foundUser = fakeUser;
  const ok = await request("PUT", `/api/users/${validIdStr()}`, {
    name: "Ali Raza",
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.name, "Ali");
  foundUser = null;

  const missing = await request("PUT", `/api/users/${validIdStr()}`, {
    name: "Ali Raza",
  });
  assert.equal(missing.status, 404);
});

test("DELETE /api/users/:id: bad id 400, unknown id 404, known id 200", async () => {
  assert.equal((await request("DELETE", "/api/users/123")).status, 400);

  foundUser = null;
  assert.equal(
    (await request("DELETE", `/api/users/${validIdStr()}`)).status,
    404
  );

  foundUser = fakeUser;
  const ok = await request("DELETE", `/api/users/${validIdStr()}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { message: "User deleted" });
  foundUser = null;
});

test("DELETE /api/messages/:id exists: bad id 400, unknown 404, known 200", async () => {
  assert.equal((await request("DELETE", "/api/messages/123")).status, 400);

  foundMessage = null;
  assert.equal(
    (await request("DELETE", `/api/messages/${validIdStr()}`)).status,
    404
  );

  foundMessage = fakeMessage;
  const ok = await request("DELETE", `/api/messages/${validIdStr()}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { message: "Message deleted" });
  foundMessage = null;
});

test("Unknown route is a 404 with the consistent error shape", async () => {
  const { status, json } = await request("GET", "/api/nope");
  assert.equal(status, 404);
  assert.deepEqual(json, { success: false, error: "Route not found" });
});
