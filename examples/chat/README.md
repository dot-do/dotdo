# chat.example.com.ai

Real-time chat rooms with hibernatable WebSockets.

## The Problem

Building real-time chat requires WebSocket connections that scale, message history, and presence tracking. Traditional WebSocket servers charge for every open connection - 10,000 idle users costs the same as 10,000 active users.

## The Solution

dotdo's hibernatable WebSockets scale to millions at near-zero cost. Each room is a Durable Object that hibernates when idle and wakes on messages.

## Data Model

```typescript
interface Room {
  $type: 'Room'
  $id: string
  name: string
}

interface Message {
  $type: 'Message'
  $id: string
  room: string
  author: string
  content: string
  sent: Date
}

interface User {
  $type: 'User'
  $id: string
  name: string
}
```

## WebSocket Upgrade

```typescript
import { DO } from 'dotdo'

export default DO.extend({
  onRequest(c) {
    return this.app.get('/ws/:room', (c) => {
      if (c.req.header('Upgrade') !== 'websocket') {
        return c.json({ error: 'Upgrade Required' }, 426)
      }

      const room = c.req.param('room')
      const [client, server] = Object.values(new WebSocketPair())

      // Accept with room tag for broadcast targeting
      this.ctx.acceptWebSocket(server, [`room:${room}`])

      return new Response(null, { status: 101, webSocket: client })
    })
  }
})
```

## Hibernation Pattern

The DO hibernates between messages. Cloudflare wakes it when a WebSocket message arrives:

```typescript
import { $, DO } from 'dotdo'

export default DO.extend({
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const data = JSON.parse(message as string)

    if (data.type === 'message') {
      const msg = this.things.create({
        $type: 'Message',
        room: data.room,
        author: data.author,
        content: data.content,
        sent: new Date(),
      })

      // Broadcast to room members via tag
      this.broadcast(`room:${data.room}`, { type: 'message', message: msg })

      // Emit event for handlers
      $.send('Message.sent', msg)
    }
  }
})
```

## Broadcast to Room

```typescript
import { DO } from 'dotdo'

export default DO.extend({
  broadcast(tag: string, payload: unknown): void {
    const sockets = this.ctx.getWebSockets(tag)
    const message = JSON.stringify(payload)
    for (const ws of sockets) {
      try { ws.send(message) } catch { /* closed */ }
    }
  }
})
```

## Event Handlers

```typescript
import { $ } from 'dotdo'

// Notify mentioned users
$.on.Message.sent((event) => {
  const message = event.data as Message
  const mentions = extractMentions(message.content)
  // Fire-and-forget - no await needed for side effects
  mentions.forEach(userId => $.User(userId).notify({ type: 'mention', room: message.room }))
})
```

## Promise Pipelining

Promises are stubs. Chain freely, await only when needed.

```typescript
// ❌ Sequential - N round-trips
for (const userId of mentions) {
  await $.User(userId).notify({ type: 'mention', room })
}

// ✅ Pipelined - fire and forget notifications
mentions.forEach(userId => $.User(userId).notify({ type: 'mention', room }))

// ✅ Pipelined - single round-trip for chained access
const authorName = await $.User(message.author).getProfile().name
```

Only `await` at exit points when you need the value.

## Client Code

```typescript
const ws = new WebSocket('wss://chat.example.com.ai/ws/general')

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  if (data.type === 'message') renderMessage(data.message)
}

function sendMessage(content: string) {
  ws.send(JSON.stringify({
    type: 'message',
    room: 'general',
    author: currentUser.$id,
    content,
  }))
}
```

## Message History

```typescript
import { DO } from 'dotdo'

export default DO.extend({
  onRequest() {
    return this.app.get('/rooms/:room/messages', async (c) => {
      const room = c.req.param('room')
      const messages = await this.things.list({
        $type: 'Message',
        where: { room },
        orderBy: { sent: 'desc' },
        limit: 50,
      })
      return c.json(messages)
    })
  }
})
```

## Cost Model

| Connections | Traditional | dotdo (Hibernating) |
|-------------|-------------|---------------------|
| 10,000 idle | $$$$$$      | ~$0                 |
| 100,000 idle| $$$$$$$$$   | ~$0                 |

You only pay when messages are sent. Idle connections hibernate to zero.

## Quick Start

```bash
npm install
npm run dev
wscat -c ws://localhost:8787/ws/general
```

## Deploy

```bash
npx wrangler deploy
```
