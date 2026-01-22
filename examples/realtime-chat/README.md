# Real-time Chat Example

A WebSocket-based chat application demonstrating real-time communication with Cloudflare Durable Objects.

## Features

- **WebSocket Support**: Real-time bidirectional communication
- **Hibernatable WebSockets**: Cost-efficient WebSocket handling
- **Room-Based Chat**: Isolated chat rooms with DO-per-room
- **Message Persistence**: SQLite-backed message history
- **User Presence**: Track online users in each room

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# The API will be available at http://localhost:8787
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | API discovery |
| `GET` | `/rooms` | List suggested rooms |
| `GET` | `/rooms/:room` | Get room info |
| `GET` | `/rooms/:room/messages` | Get message history |
| `GET` | `/rooms/:room/ws` | WebSocket connection |

## WebSocket Protocol

### Connecting

```javascript
const ws = new WebSocket('ws://localhost:8787/rooms/general/ws')

ws.onopen = () => {
  // Join with a username
  ws.send(JSON.stringify({
    type: 'join',
    username: 'alice'
  }))
}

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  console.log('Received:', data)
}
```

### Client Messages (Send)

#### Join Room
```json
{
  "type": "join",
  "username": "alice"
}
```

#### Send Message
```json
{
  "type": "message",
  "content": "Hello, everyone!"
}
```

#### Typing Indicator
```json
{
  "type": "typing"
}
```

#### Heartbeat
```json
{
  "type": "ping"
}
```

### Server Messages (Receive)

#### History (on connect)
```json
{
  "type": "history",
  "messages": [
    {
      "id": "msg_abc123",
      "username": "bob",
      "content": "Hi there!",
      "timestamp": 1705123456789
    }
  ],
  "onlineUsers": ["bob", "charlie"]
}
```

#### User Joined
```json
{
  "type": "joined",
  "username": "alice",
  "onlineUsers": ["alice", "bob", "charlie"]
}
```

#### User Left
```json
{
  "type": "left",
  "username": "bob",
  "onlineUsers": ["alice", "charlie"]
}
```

#### New Message
```json
{
  "type": "message",
  "id": "msg_xyz789",
  "username": "alice",
  "content": "Hello!",
  "timestamp": 1705123456789
}
```

#### Typing Indicator
```json
{
  "type": "typing",
  "username": "bob"
}
```

#### Pong (heartbeat response)
```json
{
  "type": "pong"
}
```

#### Error
```json
{
  "type": "error",
  "error": "Please join first"
}
```

## Usage Examples

### Using wscat (CLI)

```bash
# Install wscat
npm install -g wscat

# Connect to a room
wscat -c ws://localhost:8787/rooms/general/ws

# Send join message
> {"type":"join","username":"alice"}

# Send a chat message
> {"type":"message","content":"Hello!"}
```

### Using JavaScript

```javascript
const ws = new WebSocket('ws://localhost:8787/rooms/general/ws')

ws.onopen = () => {
  console.log('Connected!')
  ws.send(JSON.stringify({ type: 'join', username: 'alice' }))
}

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)

  switch (data.type) {
    case 'history':
      console.log('Message history:', data.messages)
      console.log('Online users:', data.onlineUsers)
      break
    case 'joined':
      console.log(`${data.username} joined the chat`)
      break
    case 'left':
      console.log(`${data.username} left the chat`)
      break
    case 'message':
      console.log(`${data.username}: ${data.content}`)
      break
    case 'typing':
      console.log(`${data.username} is typing...`)
      break
    case 'error':
      console.error('Error:', data.error)
      break
  }
}

// Send a message
function sendMessage(content) {
  ws.send(JSON.stringify({ type: 'message', content }))
}

// Send typing indicator
function sendTyping() {
  ws.send(JSON.stringify({ type: 'typing' }))
}
```

### REST API

```bash
# Get room info
curl http://localhost:8787/rooms/general

# Get message history
curl http://localhost:8787/rooms/general/messages

# Get with limit
curl http://localhost:8787/rooms/general/messages?limit=100
```

## Architecture

```
Worker (Stateless)
    |
    +-> Route to ChatRoomDO based on room name
            |
            +-> ChatRoomDO (per room)
                    |
                    +-> SQLite Storage (messages)
                    +-> WebSocket Connections (users)
```

- **Worker**: Routes HTTP/WebSocket to appropriate room DO
- **ChatRoomDO**: One DO per room, handles all chat for that room
- **SQLite**: Persists message history
- **WebSockets**: Managed by DO with hibernation support

## Hibernatable WebSockets

This example uses Cloudflare's Hibernatable WebSockets feature:

- **Cost Efficient**: DO hibernates when no events to process
- **Auto Wake**: Wakes on WebSocket message or alarm
- **State Preserved**: Session data maintained across hibernation

## Key Patterns Demonstrated

1. **WebSocket Upgrade**: HTTP to WebSocket protocol upgrade
2. **Hibernation**: Efficient resource usage with `acceptWebSocket()`
3. **Broadcast Pattern**: Send to all connected clients
4. **Room Isolation**: Each room is a separate DO instance
5. **Message Persistence**: History stored in SQLite

## Deployment

```bash
# Deploy to Cloudflare Workers
npm run deploy
```

## Project Structure

```
realtime-chat/
├── src/
│   ├── index.ts        # Worker entry point
│   └── ChatRoomDO.ts   # Chat room Durable Object
├── package.json
├── tsconfig.json
├── wrangler.jsonc      # Cloudflare config
└── README.md
```

## Related Examples

- [todo-app](../todo-app) - Simple CRUD example
- [auth-api](../auth-api) - JWT authentication
