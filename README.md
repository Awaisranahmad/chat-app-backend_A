# Chat App Backend API

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
| GET | `/messages/user/:userId` | All messages of a user | `userId` |
| GET | `/messages/chat/:user1/:user2` | Conversation between two users | `user1`, `user2` |
| POST | `/messages` | Send a message | `{ "senderId": "...", "receiverId": "...", "text": "Hi" }` |
| DELETE | `/messages/:messageId` | Delete a message | `messageId` |

## Response Format

Success:
```json
{ "success": true, "data": { ... } }

Error:

json
{ "success": false, "error": "message" }
Setup
npm install

Create .env file:

text
MONGO_URI=your_mongodb_uri
PORT=3000
node index.js

text

---

## 🧪 4. Test Endpoints (Edge Cases)

Thunder Client / Postman mein yeh cases test karo:

### Users
- **Missing field in POST** – send only `{}` → should return 400 with validation error.
- **Invalid ID in GET/PUT/DELETE** (e.g., `"123"`) → should return 400 "Invalid ID".
- **Non‑existent ID** (correct format but not in DB) → should return 404.
- **PUT with empty body** → should return 400 "At least name or status required".

### Messages
- **POST without `text`** → validation error.
- **GET with invalid user IDs** → 400.
- **DELETE with message ID that doesn’t exist** → 404.
- **DELETE with correct ID but different logged‑in user** (if auth) → 403.

---

## ✅ Final Checklist for Day 13/14

| Task | Status |
|------|--------|
| Consistent error responses (success: false) | ⬜ |
| Global error handler | ⬜ |
| Mongoose validations (runValidators: true) | ⬜ |
| README.md with all endpoints | ⬜ |
| Test all edge cases | ⬜ |
| GitHub push with updated code | ⬜ |

**Ab tu yeh tasks kar. Koi error aaye to bata. 💪**

