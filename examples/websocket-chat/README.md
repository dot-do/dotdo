# WebSocket Chat Example

A real-time chat application demonstrating WebSocket management, presence tracking, and typing indicators using dotdo Durable Objects.

## Features

This example demonstrates:

- **Real-time Messaging**: Send and receive messages instantly via WebSockets
- **Presence Tracking**: See who's online in each room
- **Typing Indicators**: See when others are typing
- **Message History**: Load recent messages when joining a room
- **Message Editing/Deletion**: Edit or delete your own messages
- **Room Management**: Create public/private rooms with member limits
- **Hibernatable WebSockets**: Efficient connection management at scale

## Key dotdo Concepts

### WebSocket Handler Registration

```typescript
constructor(state: DurableObjectState, env: DOEnv) {
  super(state, env)

  // Register handlers for different message types
  this.ws.on('join', this.handleJoin.bind(this))
  this.ws.on('leave', this.handleLeave.bind(this))
  this.ws.on('message', this.handleMessage.bind(this))
  this.ws.on('typing', this.handleTyping.bind(this))
}
```

### WebSocket Upgrade

```typescript
// Accept WebSocket connection with room-specific tags
app.get('/ws/:roomId', async (c) => {
  const roomId = c.req.param('roomId')

  // Accept with tags for targeted broadcasts
  return this.ws.handleWebSocketUpgrade(
    this.state,
    [`room:${roomId}`],  // Tags for this connection
    true                  // Use hibernatable WebSockets
  )
})
```

### Broadcasting Messages

```typescript
// Send to specific connection
this.ws.send(ws, { type: 'ack', messageId })

// Broadcast to all connections with a tag
this.ws.broadcast(this.state, `room:${roomId}`, {
  type: 'new_message',
  message: chatMessage,
})

// Broadcast to all except one
const sockets = this.state.getWebSockets(`room:${roomId}`)
for (const socket of sockets) {
  if (socket !== excludeWs) {
    this.ws.send(socket, message)
  }
}
```

### Handling Connection Close

```typescript
async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
  // Clean up user state when they disconnect
  for (const [userId, socket] of this.userConnections.entries()) {
    if (socket === ws) {
      this.userConnections.delete(userId)

      // Notify others in the room
      this.ws.broadcast(this.state, `room:${roomId}`, {
        type: 'user_left',
        userId,
      })
      break
    }
  }

  await super.webSocketClose(ws, code, reason, wasClean)
}
```

## API Endpoints

### REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/rooms` | List all rooms |
| POST | `/rooms` | Create a new room |
| GET | `/rooms/:id` | Get room details |
| DELETE | `/rooms/:id` | Delete a room |
| GET | `/rooms/:id/messages` | Get message history |
| GET | `/rooms/:id/presence` | Get online users |

### WebSocket Endpoint

| Path | Description |
|------|-------------|
| `/ws/:roomId` | Connect to a room via WebSocket |

## WebSocket Protocol

### Client -> Server Messages

#### Join Room

```json
{
  "type": "join",
  "roomId": "room-abc123",
  "userId": "user-456",
  "userName": "Alice",
  "avatar": "https://..."
}
```

#### Leave Room

```json
{
  "type": "leave",
  "roomId": "room-abc123",
  "userId": "user-456"
}
```

#### Send Message

```json
{
  "type": "message",
  "roomId": "room-abc123",
  "content": "Hello everyone!",
  "replyTo": "msg-xyz789"
}
```

#### Edit Message

```json
{
  "type": "edit",
  "messageId": "msg-xyz789",
  "content": "Updated message"
}
```

#### Delete Message

```json
{
  "type": "delete",
  "messageId": "msg-xyz789"
}
```

#### Typing Indicator

```json
{
  "type": "typing",
  "roomId": "room-abc123",
  "isTyping": true
}
```

#### Ping (Keep-alive)

```json
{
  "type": "ping"
}
```

### Server -> Client Messages

#### Room State (on join)

```json
{
  "type": "room_state",
  "room": {
    "$id": "room-abc123",
    "name": "General",
    "description": "Main chat room",
    "isPrivate": false
  },
  "participants": [
    {
      "userId": "user-456",
      "userName": "Alice",
      "role": "owner",
      "online": true
    }
  ],
  "recentMessages": [...]
}
```

#### New Message

```json
{
  "type": "new_message",
  "message": {
    "$id": "msg-new123",
    "roomId": "room-abc123",
    "userId": "user-456",
    "userName": "Alice",
    "content": "Hello!",
    "type": "text",
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

#### Message Edited

```json
{
  "type": "message_edited",
  "messageId": "msg-xyz789",
  "content": "Updated content",
  "editedAt": "2024-01-15T10:35:00Z"
}
```

#### Message Deleted

```json
{
  "type": "message_deleted",
  "messageId": "msg-xyz789"
}
```

#### User Joined

```json
{
  "type": "user_joined",
  "userId": "user-789",
  "userName": "Bob",
  "avatar": "https://..."
}
```

#### User Left

```json
{
  "type": "user_left",
  "userId": "user-789",
  "userName": "Bob"
}
```

#### Typing Update

```json
{
  "type": "typing_update",
  "users": [
    { "userId": "user-456", "userName": "Alice" },
    { "userId": "user-789", "userName": "Bob" }
  ]
}
```

#### Error

```json
{
  "type": "error",
  "code": "UNAUTHORIZED",
  "message": "You can only edit your own messages"
}
```

#### Acknowledgment

```json
{
  "type": "ack",
  "messageId": "msg-new123"
}
```

#### Pong

```json
{
  "type": "pong",
  "timestamp": 1705312200000
}
```

## Usage Examples

### Create a Room

```bash
curl -X POST http://localhost:8791/rooms \
  -H "Content-Type: application/json" \
  -d '{
    "name": "General",
    "description": "Main chat room",
    "createdBy": "user-123"
  }'
```

### Connect via WebSocket (JavaScript)

```javascript
const ws = new WebSocket('ws://localhost:8791/ws/room-abc123')

ws.onopen = () => {
  // Join the room
  ws.send(JSON.stringify({
    type: 'join',
    roomId: 'room-abc123',
    userId: 'user-456',
    userName: 'Alice'
  }))
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)

  switch (msg.type) {
    case 'room_state':
      // Initialize UI with room data
      displayRoom(msg.room)
      displayParticipants(msg.participants)
      displayMessages(msg.recentMessages)
      break

    case 'new_message':
      appendMessage(msg.message)
      break

    case 'user_joined':
      addOnlineUser(msg)
      break

    case 'user_left':
      removeOnlineUser(msg.userId)
      break

    case 'typing_update':
      showTypingIndicator(msg.users)
      break
  }
}

// Send a message
function sendMessage(content) {
  ws.send(JSON.stringify({
    type: 'message',
    roomId: 'room-abc123',
    content
  }))
}

// Send typing indicator
let typingTimeout
function onInputChange() {
  ws.send(JSON.stringify({
    type: 'typing',
    roomId: 'room-abc123',
    isTyping: true
  }))

  clearTimeout(typingTimeout)
  typingTimeout = setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'typing',
      roomId: 'room-abc123',
      isTyping: false
    }))
  }, 2000)
}
```

### Keep Connection Alive

```javascript
// Send ping every 30 seconds
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }))
  }
}, 30000)
```

### Handle Reconnection

```javascript
function connect() {
  const ws = new WebSocket('ws://localhost:8791/ws/room-abc123')

  ws.onclose = () => {
    console.log('Disconnected, reconnecting in 3s...')
    setTimeout(connect, 3000)
  }

  ws.onerror = (error) => {
    console.error('WebSocket error:', error)
    ws.close()
  }

  return ws
}
```

## Running Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

## Project Structure

```
examples/websocket-chat/
  ChatDO.ts           # Main Durable Object implementation
  types.ts            # TypeScript type definitions
  index.ts            # Worker entrypoint
  wrangler.jsonc      # Cloudflare configuration
  package.json        # Package configuration
  README.md           # This file
```

## Architecture

```
WebSocket Connection (ws://host/ws/room-123)
         |
         v
+---------------------+
|   Worker (index)    |
|   Route by server   |
+---------------------+
         |
         v
+---------------------+
|      ChatDO         |
|  - things           |  <-- Room, Participant, ChatMessage
|  - ws.on handlers   |  <-- join, message, typing, etc.
|  - ws.broadcast     |  <-- Send to all in room
+---------------------+
         |
    +----+----+
    |         |
    v         v
+-------+  +----------+
|  In-  |  | SQLite   |
| Memory|  | Storage  |
| State |  | (things) |
+-------+  +----------+
```

## Hibernatable WebSockets

This example uses Cloudflare's hibernatable WebSockets for efficient resource usage:

- **Memory efficient**: Connections hibernate when idle
- **Automatic wake**: Wakes on incoming messages
- **Tag-based routing**: Use tags like `room:${roomId}` for targeted broadcasts
- **Large-scale support**: Handle thousands of connections per DO

```typescript
// Accept with hibernation enabled
return this.ws.handleWebSocketUpgrade(
  this.state,
  [`room:${roomId}`],
  true  // Enable hibernation
)

// Tags allow efficient room-based broadcasting
this.ws.broadcast(this.state, `room:${roomId}`, message)
```

## Production Considerations

- **Rate Limiting**: Limit messages per user per second
- **Content Moderation**: Filter inappropriate content
- **Message Size**: Enforce maximum message length
- **Connection Limits**: Limit connections per room
- **Authentication**: Verify user identity before join
- **Persistence**: Messages stored in SQLite survive restarts
- **Scaling**: Each chat server (DO) handles its own rooms
