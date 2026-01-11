# @dotdo/pusher Realtime Example

**Pusher channels. Self-hosted. Unlimited connections.**

Real-time for everyone. No per-connection fees.

```typescript
import { Pusher } from '@dotdo/pusher'

// Drop-in replacement for pusher-js
const pusher = new Pusher('your-app-key')

// Subscribe and broadcast
const channel = pusher.subscribe('notifications')
channel.bind('new-message', (data) => {
  console.log('Received:', data)
})

// Presence: see who's online
const room = pusher.subscribe('presence-room')
room.bind('pusher:subscription_succeeded', (members) => {
  console.log(`${members.count} users online`)
  members.each((member) => console.log(`- ${member.id}`))
})

room.bind('pusher:member_added', (member) => {
  console.log(`${member.id} joined`)
})

// Private channels with client events
const chat = pusher.subscribe('private-chat')
chat.trigger('client-typing', { user: 'alice' })
```

## What This Example Demonstrates

1. **Broadcast to channels** - Push events to all subscribers
2. **Presence (who's online)** - Track users in real-time
3. **Private channels with auth** - Secure channel access
4. **Client events** - Peer-to-peer messaging
5. **Chat patterns** - Build real-time chat apps
6. **Live collaboration** - Cursors, typing indicators, document sync

## Quick Start

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy to Cloudflare
npm run deploy
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Landing page with live demo |
| `WebSocket /ws/:namespace` | WebSocket connection endpoint |
| `POST /api/broadcast` | Broadcast event to channel (direct DO) |
| `POST /api/trigger` | Broadcast event using PusherServer SDK |
| `GET /api/channel/:name` | Get channel info |
| `GET /api/presence/:channel` | Get presence members |
| `POST /api/auth` | Channel authorization |
| `GET /api/channels` | List all active channels |

## Architecture

```
RealtimeDO (Durable Object)
├── WebSocket connections (hibernatable)
├── Channel subscriptions (in-memory)
├── Presence tracking (per-channel)
└── Event broadcasting (pub/sub)
```

## Why Self-Hosted Pusher?

| Feature | Pusher.com | @dotdo/pusher |
|---------|------------|---------------|
| Pricing | $49+/mo per 100K connections | Free (pay only for DO usage) |
| Latency | Centralized servers | Edge (300+ cities) |
| Vendor lock-in | Yes | No |
| API compatibility | Native | Drop-in replacement |

## Example: Live Chat

```typescript
// Server-side (RealtimeDO)
async onMessage(ws: WebSocket, data: ChatMessage) {
  // Broadcast to all subscribers
  await this.broadcast('chat-room', 'message', {
    user: data.user,
    text: data.text,
    timestamp: Date.now()
  })
}

// Client-side
const chat = pusher.subscribe('chat-room')
chat.bind('message', ({ user, text, timestamp }) => {
  renderMessage(user, text, timestamp)
})
```

## Example: Live Cursors

```typescript
// Track cursor position
document.addEventListener('mousemove', (e) => {
  const channel = pusher.channel('private-doc-123')
  channel.trigger('client-cursor', {
    x: e.clientX,
    y: e.clientY,
    user: currentUser.id
  })
})

// Render other users' cursors
channel.bind('client-cursor', ({ x, y, user }) => {
  updateCursor(user, x, y)
})
```

## Example: Typing Indicator

```typescript
const chat = pusher.subscribe('private-chat')

// Send typing status
input.addEventListener('keydown', () => {
  chat.trigger('client-typing', { user: me.id })
})

// Show typing indicator
chat.bind('client-typing', ({ user }) => {
  showTypingIndicator(user)
})
```

## Server SDK: Triggering Events from Workers

```typescript
import { PusherServer } from '@dotdo/pusher'

// Create server instance with DO binding
const pusher = new PusherServer({
  appId: 'my-app',
  key: 'my-key',
  secret: 'my-secret',
  doNamespace: env.REALTIME_DO, // Direct DO calls (recommended)
})

// Trigger event on a channel
await pusher.trigger('notifications', 'alert', {
  message: 'System update',
  level: 'info',
})

// Trigger on multiple channels
await pusher.trigger(
  ['user-123', 'user-456'],
  'message',
  { text: 'Hello!' }
)

// Batch events
await pusher.triggerBatch([
  { channel: 'channel-1', name: 'event-1', data: { a: 1 } },
  { channel: 'channel-2', name: 'event-2', data: { b: 2 } },
])

// Get channel info
const info = await pusher.getChannelInfo('presence-room')
console.log('Users online:', info.user_count)

// Authenticate channels
const auth = pusher.authorizeChannel(socketId, 'presence-room', {
  user_id: userId,
  user_info: { name: 'Alice' },
})
```

---

Built with [dotdo](https://dotdo.dev) - Build your 1-Person Unicorn
