# Chat App Backend API

Express + Mongoose backend for a chat app: users and one-to-one messages
stored in MongoDB.

## Setup

```bash
npm install
```

Create a `.env` file (see `.env.example`):

```text
MONGO_URI=mongodb://localhost:27017/chat-app
PORT=3000
```

Start the server:

```bash
npm start
# or: node index.js
```

Run the tests (no database needed):

```bash
npm test
```

## Base URL

`http://localhost:3000/api`

## Endpoints

### Users

| Method | Endpoint | Description | Body/Params |
|--------|----------|-------------|--------------|
| GET | `/users` | Get all users | - |
| GET | `/users/:id` | Get single user | `id` (URL param) |
| POST | `/users` | Create new user | `{ "name": "Ali", "status": "online" }` |
| PUT | `/users/:id` | Update user | `{ "name": "Ali Raza", "status": "offline" }` |
| DELETE | `/users/:id` | Delete user | `id` (URL param) |

### Messages

| Method | Endpoint | Description | Body/Params |
|--------|----------|-------------|--------------|
| GET | `/message/users/:userId` | All messages a user sent or received | `userId` |
| GET | `/messages/chat/:user1/:user2` | Conversation between two users, oldest first | `user1`, `user2` |
| POST | `/message` | Send a message | `{ "senderId": "...", "receiverId": "...", "text": "Hi" }` |
| DELETE | `/messages/:id` | Delete a message | `id` (URL param) |

## Response Format

Success:

```json
{ "success": true, "data": { "...": "..." } }
```

Error (same shape for every error):

```json
{ "success": false, "error": "message" }
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request — invalid ID, missing/invalid field, or empty update |
| 404 | User / message / route not found |
| 500 | Internal server error (generic message, details are logged) |

## Validation rules

- `id` params must be valid MongoDB ObjectIds, otherwise 400 `Invalid ID`.
- `POST /api/message` needs valid `senderId` + `receiverId`, a non-empty
  `text` (max 1000 characters), and sender ≠ receiver.
- `PUT /api/users/:id` needs at least one of `name` or `status`, otherwise
  400 `At least name or status required`. `status` must be
  `online`, `offline` or `away`; `name` must be at least 2 characters.
- `GET /api/users/:id`, `PUT` and `DELETE` return 404 when the id is valid
  but nothing matches it.

## 🧪 Tests

`npm test` runs the `node:test` suite in `tests/` — no database needed.
It covers User/Message model validation, the `createdAt` field the chat
routes sort on, ObjectId checks, and live route behaviour (400/404/201
responses) with stubbed models — 21 checks in total.

Edge cases to also try by hand (Thunder Client / Postman):

### Users

- **Missing field in POST** – send only `{}` → 400 with validation error.
- **Invalid ID in GET/PUT/DELETE** (e.g., `"123"`) → 400 `Invalid ID`.
- **Non‑existent ID** (correct format but not in DB) → 404.
- **PUT with empty body** → 400 `At least name or status required`.

### Messages

- **POST without `text`** → 400.
- **POST with the same sender and receiver** → 400.
- **GET with invalid user IDs** → 400.
- **DELETE with message ID that doesn’t exist** → 404.

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
