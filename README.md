# Chat App Backend API

Express + Mongoose + Socket.io backend for a chat app: users, one-to-one
and group messages stored in MongoDB, with JWT login, live messaging,
read receipts, search and pagination.

Version 2.0.0 is a production-level upgrade of the original Day 13/14
backend (see [Changelog](#changelog)). The biggest change: **every
route now needs a login** — the old backend let anyone read or delete
anyone's data.

## Features

- **JWT auth** — register/login, bcrypt password hashing, all routes
  protected, users can only read/change their own data and messages
  they take part in.
- **Real-time messaging (Socket.io)** — messages arrive live, online/
  offline presence, typing indicators.
- **Read receipts** — mark a chat read, unread counts per conversation.
- **Group chat** — create groups, add/remove members, group messages.
- **Message edit** — senders can edit their own messages (marked
  `edited`); delete is still a hard delete.
- **Search** — users by name, your messages by text.
- **Pagination** — every list is paginated (`?page=&limit=`, max 100).
- **Security** — helmet headers, CORS allow-list, rate limiting
  (stricter on login/register), validated input everywhere, no secrets
  in code.
- **Tests** — 59 checks, no database needed (`npm test`).

## Setup

```bash
npm install
```

Create a `.env` file (see `.env.example`):

```text
MONGO_URI=mongodb://localhost:27017/chat-app
PORT=3000
JWT_SECRET=change-me-to-a-long-random-string
```

Start the server:

```bash
npm start
# or, with auto-restart while developing:
npm run dev
```

Run the tests (no database needed):

```bash
npm test
```

Health check (public, for deploy platforms):

```bash
curl http://localhost:3000/health
# {"success":true,"data":{"status":"ok"}}
```

## Environment variables

| Variable | Default | What it does |
|----------|---------|--------------|
| `MONGO_URI` | `mongodb://localhost:27017/chat-app` | MongoDB connection string |
| `PORT` | `3000` | Port the server listens on |
| `NODE_ENV` | `development` | `production` requires `JWT_SECRET` |
| `JWT_SECRET` | dev default (warns) | Secret that signs login tokens — **required in production** |
| `JWT_EXPIRES_IN` | `7d` | How long a login token lasts |
| `BCRYPT_ROUNDS` | `10` | Cost of password hashing |
| `CORS_ORIGIN` | `http://localhost:3000,http://localhost:5173` | Browser origins allowed (comma-separated) |
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | Rate-limit window |
| `RATE_LIMIT_MAX` | `200` | Max requests per IP per window |
| `AUTH_RATE_LIMIT_MAX` | `10` | Max register/login attempts per IP per window |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Auth flow

1. **Register** — `POST /api/auth/register` with
   `{ "name": "Ali", "email": "ali@example.com", "password": "secret123" }`
   (password at least 6 characters). Returns a token + the user.
2. **Login** — `POST /api/auth/login` with `{ "email", "password" }`.
   Returns a token + the user. A wrong email and a wrong password give
   the same `401` on purpose, so the response never reveals whether an
   email is registered.
3. **Use the token** — send it on every request:
   `Authorization: Bearer <token>`.
4. **Check it** — `GET /api/auth/me` returns the logged-in user.

Tokens expire after `JWT_EXPIRES_IN` (default 7 days); log in again
for a new one. There is no refresh-token endpoint yet — that is a
possible next step.

## Response format

Every success:

```json
{ "success": true, "data": { "...": "..." } }
```

Every error:

```json
{ "success": false, "error": "message" }
```

Paginated lists add a `pagination` block:

```json
{
  "success": true,
  "data": [ "..." ],
  "pagination": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request — invalid ID, missing/invalid field, empty update |
| 401 | No token, or an invalid/expired token |
| 403 | Logged in, but not allowed (someone else's data, not a group member) |
| 404 | User / message / group / route not found |
| 429 | Too many requests (rate limit) |
| 500 | Internal server error (generic message, details are logged) |

Base URL: `http://localhost:3000/api` (all endpoints below are under it).

## Endpoints

### Auth (public)

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| POST | `/auth/register` | Create an account | `{ "name", "email", "password" }` |
| POST | `/auth/login` | Log in | `{ "email", "password" }` |
| GET | `/auth/me` | Who the token belongs to | — |

### Users (login required)

| Method | Endpoint | Description | Notes |
|--------|----------|-------------|-------|
| GET | `/users` | List users, newest first | Paginated (`?page=&limit=`) |
| GET | `/users/search?q=ali` | Find users by name | Case-insensitive |
| GET | `/users/:id` | One profile | Any logged-in user |
| PUT | `/users/:id` | Update profile | **Own profile only.** `{ "name", "status", "profilePic" }` — `status` is `online`, `offline` or `away` |
| DELETE | `/users/:id` | Delete your account | **Own account only.** Your messages stay in the other person's chat history |

### Messages (login required)

The sender is always the logged-in user — the client never sends a
`senderId` (one that disagrees with the token is rejected with 403).

| Method | Endpoint | Description | Notes |
|--------|----------|-------------|-------|
| POST | `/message` | Send a message | `{ "receiverId", "text" }` for 1-1, or `{ "groupId", "text" }` for a group |
| GET | `/message/users/:userId` | Your messages, newest first | **Your own list only.** Paginated |
| GET | `/messages/chat/:user1/:user2` | Conversation, oldest first | You must be one of the two. Paginated |
| PUT | `/messages/chat/:user1/:user2/read` | Mark the other person's messages as read | Returns `{ "markedRead": n }` |
| GET | `/messages/unread` | Unread counts per conversation | `{ "conversations": [{ "userId" \| "groupId", "unread": n }], "total": n }` |
| GET | `/messages/search?q=hello` | Search your messages by text | Only messages you sent, received, or that are in your groups |
| PUT | `/messages/:id` | Edit your message | **Sender only.** `{ "text" }` — sets `edited: true` and `editedAt` |
| DELETE | `/messages/:id` | Delete your message | **Sender only** (hard delete) |

### Groups (login required)

| Method | Endpoint | Description | Notes |
|--------|----------|-------------|-------|
| POST | `/groups` | Create a group | `{ "name", "memberIds": [] }` — you are always added |
| GET | `/groups` | Your groups, newest first | Paginated |
| GET | `/groups/:id` | One group | **Members only** |
| PUT | `/groups/:id/members` | Add/remove members | **Creator only.** `{ "add": [], "remove": [] }` — the creator cannot be removed |
| POST | `/groups/:id/leave` | Leave a group | If the creator leaves, ownership passes to the longest-standing member; if the last member leaves, the group and its messages are deleted |
| POST | `/groups/:id/messages` | Send a message to the group | **Members only** |
| GET | `/groups/:id/messages` | Group history, oldest first | **Members only.** Paginated |
| DELETE | `/groups/:id` | Delete the group + its messages | **Creator only** |

## Real-time (Socket.io)

Connect with your login token:

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  auth: { token: "<JWT from login>" },
});
```

Without a valid token the connection is rejected. On connect you join
your personal room and are marked `online`; on disconnect you are
marked `offline`.

### Events you send

| Event | Data | What happens |
|-------|------|--------------|
| `join_chat` | `{ "userId": "<other user>" }` | Join a 1-1 chat room (for typing indicators) |
| `join_group` | `{ "groupId": "<id>" }` | Join a group room (members only) |
| `send_message` | `{ "receiverId", "text" }` or `{ "groupId", "text" }` | Save + deliver live. Ack: `{ "success": true, "data": message }` or `{ "success": false, "error": "..." }` |
| `typing` | `{ "to": "<user id>", "isTyping": true }` | Tell the other person you are typing |
| `mark_read` | `{ "chatWith": "<user id>" }` | Mark their messages to you read |

### Events you receive

| Event | Data | When |
|-------|------|------|
| `receive_message` | The saved message | Someone messages you, or messages a group you joined |
| `message_edited` | The updated message | Someone edits their message to you / in your group |
| `message_deleted` | `{ "messageId": "..." }` | Someone deletes their message to you / in your group |
| `typing` | `{ "from": "<user id>", "isTyping": true }` | The other person is (or stopped) typing |
| `messages_read` | `{ "by": "<user id>", "count": n }` | The other person read your messages |
| `user:online` | `{ "userId": "..." }` | Someone came online |
| `user:offline` | `{ "userId": "..." }` | Someone went offline |

Messages sent over the REST API also arrive as `receive_message` /
`message_edited` / `message_deleted` — the two ways of sending feed
the same live stream.

## Validation rules

- `id` params must be valid MongoDB ObjectIds, otherwise 400 `Invalid ID`.
- `POST /api/message` needs exactly one of `receiverId` or `groupId`,
  non-empty `text` (max 1000 characters), and sender ≠ receiver.
- Register needs a name (≥ 2 chars), a valid email, and a password
  (≥ 6 chars). Emails are unique (case-insensitive).
- `PUT /api/users/:id` needs at least one of `name`, `status` or
  `profilePic`. `status` must be `online`, `offline` or `away`.
- Group names need at least 2 characters; member IDs must exist.
- Search text is escaped before it becomes a RegExp, so a query can
  never change what the pattern means.

## 🧪 Tests

`npm test` runs the `node:test` suite in `tests/` — **no database
needed**. Model methods are stubbed, `save()` runs the real Mongoose
validation, and the Socket.io tests run against a live server with the
same stubs.

59 checks in total: User/Message/Group model validation, the
`createdAt` regression, ObjectId checks, auth (register/login/me,
401/403 rules), ownership rules, pagination, search, read receipts,
unread counts, group CRUD + group messages, message edit/delete, rate
limit headers, and live Socket.io behaviour (auth, presence, typing,
1-1 + group delivery, mark-as-read, REST→socket delivery).

## Deploy notes (not deployed yet)

This backend is ready to deploy as-is; nothing here deploys it for you.

1. **Database** — create a free MongoDB Atlas cluster and put its
   connection string in `MONGO_URI`. (Local MongoDB works too.)
2. **Host** — Render or Railway, from this repo:
   - Build command: `npm install`
   - Start command: `npm start`
   - Set the environment variables from `.env.example` — at minimum
     `MONGO_URI`, `JWT_SECRET` (generate a long random one) and
     `CORS_ORIGIN` (your frontend's origin). The server refuses to
     start in production without `JWT_SECRET`.
3. **Check it** — `GET /health` should answer
   `{"success":true,"data":{"status":"ok"}}`.
4. **Frontend** — point it at the deployed URL and send the JWT as
   `Authorization: Bearer <token>` (REST) and `auth: { token }`
   (Socket.io).

## Upgrading from the old version (breaking changes)

- **Login is now required everywhere** except `POST /api/auth/register`,
  `POST /api/auth/login` and `GET /health`.
- **`POST /api/users` is gone.** Register at `POST /api/auth/register`
  instead.
- **Users now need `email` + `password`.** Accounts created before
  this upgrade have no credentials — those users need to register
  again (their old messages stay, attached to the old user document).
- **The sender is the token, not the body.** `POST /api/message` no
  longer takes `senderId`; it is the logged-in user.
- **One response envelope everywhere.** Success is now always
  `{ success: true, data }`, lists add `pagination`. The old code
  returned bare documents/arrays.
- **`/api/nope` without a token is 401**, not 404: the routers run
  their auth check before route matching. With a valid token it is a
  404 as before.

## Known limitations

- **Group read receipts are per-message, not per-member.** Marking a
  group message read marks it for the whole group. Per-member receipts
  would need a separate receipts collection.
- **Presence is single-device and simple.** Connecting sets `online`,
  disconnecting sets `offline`; a user on two devices can flicker
  offline when one disconnects.
- **No refresh tokens.** A login lasts `JWT_EXPIRES_IN` (default 7
  days); after that the user logs in again.
- **Deleting an account keeps its messages** in the other person's
  chat history.
- **No file/image messages yet** — text only (max 1000 characters).
- **No pagination on `GET /api/messages/search` results beyond
  `page`/`limit`** — it uses the same envelope as every other list.

## ✅ Final Checklist for Day 13/14

| Task | Status |
|------|--------|
| Consistent error responses (success: false) | ✅ |
| Global error handler | ✅ |
| Mongoose validations (runValidators: true) | ✅ |
| README.md with all endpoints | ✅ |
| Test all edge cases | ✅ |
| GitHub push with updated code | ⬜ |

## Changelog

### 2026-11-25 — Production upgrade (v2.0.0)

- **JWT auth** — `POST /api/auth/register`, `POST /api/auth/login`,
  `GET /api/auth/me`; bcrypt password hashes (never plain text,
  never returned); `requireAuth` on every route; users can only
  read/change their own data and messages they take part in.
- **Real-time (Socket.io)** — token-authenticated sockets, live
  send/receive, online/offline presence, typing indicators, mark-as-read
  events; REST sends also push live events.
- **Read receipts** — `PUT /api/messages/chat/:a/:b/read` and
  `GET /api/messages/unread` (per-conversation counts).
- **Group chat** — `Group` model + full `/api/groups` routes (create,
  members, leave, messages, delete).
- **Message edit** — `PUT /api/messages/:id` (sender only, sets
  `edited` + `editedAt`); delete stays a hard delete.
- **Search** — `GET /api/users/search?q=` and
  `GET /api/messages/search?q=` (regex-escaped input).
- **Pagination** — every list takes `?page=&limit=` (max 100) and
  returns `{ data, pagination }`.
- **Security** — helmet, CORS allow-list from env, rate limiting
  (200/15 min general, 10/15 min auth), `express.json` 100kb cap,
  `JWT_SECRET` mandatory in production, duplicate-email handling.
- **Tests** — suite grew from 21 to 59 checks, still no database
  needed, including live Socket.io tests.
- **Breaking changes** — see [Upgrading from the old
  version](#upgrading-from-the-old-version).

### 2026-11-25 — Broken routes fixed + validation + tests

- `GET /api/users/:id` used to crash on every call: it checked `user`
  before defining it (`ReferenceError`) and called the non-existent
  `User.findbyId`. It now uses `findById`, returns 404 when the user
  does not exist, and 400 for an invalid id.
- `PUT /api/users/:id` never awaited the update and passed
  `res.json(newUser)` as a callback argument, so it answered with an
  unfinished result. It now awaits `findByIdAndUpdate`, returns the
  updated user, 404s on a missing user, and 400s on an empty body or an
  invalid id. It also writes `updatedAt` (the old code wrote `updateAt`,
  a field the schema does not have).
- `models/Message.js`: `createAt` typo fixed to `createdAt` — the chat
  routes sort by `createdAt`, so sorting silently did nothing before.
  `text` now trims, so a whitespace-only message is rejected. Removed
  the unused `node:stream/consumers` import.
- New `DELETE /api/messages/:id` endpoint (the README already listed it,
  but the route did not exist).
- Every route now validates ObjectIds up front (400 `Invalid ID`
  instead of a 500 CastError), and `POST /api/message` rejects empty
  text and sender = receiver.
- One consistent error shape everywhere: `{ success: false, error }`,
  via a global error handler + 404 handler. 500s no longer leak
  internal error messages.
- `PORT` now defaults to 3000 when `.env` does not set it; `.env.example`
  added. `npm start` / `npm test` scripts added, and the server only
  connects to MongoDB when run directly (`node index.js`), so tests can
  load the app without a database.
- New `tests/api.test.js`: 21 checks (model validation, `createdAt`
  regression, ObjectId checks, live HTTP route tests with stubbed
  models — no database needed).
