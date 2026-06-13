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
