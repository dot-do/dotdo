# game.example.com.ai

> Multiplayer game rooms with hibernatable WebSockets at the edge

## The Problem

Building multiplayer games requires WebSocket infrastructure that scales, game servers with low latency, state synchronization across players, and paying for idle connections during off-peak hours.

## The Solution

Each game room is a Durable Object. Players connect via hibernatable WebSockets. The DO sleeps when empty, wakes instantly when players join.

```
Player A ─┐                  ┌─ Player C
          │    ┌─────────┐   │
Player B ─┼───►│ Room DO │◄──┤   Hibernates when empty
          │    │ (edge)  │   │   Wakes in <1ms on connect
Player D ─┘    └─────────┘   └─ Player E
```

## Quick Start

```bash
git clone https://github.com/dot-do/game-example
cd game-example && npm install && npm run deploy
# Play at https://game.example.com.ai
```

## GameRoom DO

```typescript
import { DO, $ } from 'dotdo'
import { WebSocketHub } from 'dotdo/streaming'

interface Player { id: string; x: number; y: number; color: string }

export class GameRoom extends DO {
  private hub = new WebSocketHub()
  private players = new Map<string, Player>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Player joins
    this.$.on.Player.joined(async (event) => {
      const player = event.data as Player
      this.players.set(player.id, player)
      this.hub.broadcast({ type: 'player:joined', player })
    })

    // Player moves
    this.$.on.Player.moved(async (event) => {
      const { id, x, y } = event.data as { id: string; x: number; y: number }
      const player = this.players.get(id)
      if (player) {
        player.x = x
        player.y = y
        this.hub.broadcast({ type: 'player:moved', id, x, y })
      }
    })

    // Player leaves
    this.$.on.Player.left(async (event) => {
      const { id } = event.data as { id: string }
      this.players.delete(id)
      this.hub.broadcast({ type: 'player:left', id })
    })
  }
```

## WebSocket with Hibernation

```typescript
  async handleWebSocket(request: Request): Promise<Response> {
    const playerId = new URL(request.url).searchParams.get('id') || crypto.randomUUID()
    const [client, server] = Object.values(new WebSocketPair())

    // Accept with hibernation - DO sleeps when all sockets idle
    this.ctx.acceptWebSocket(server, ['player', `player:${playerId}`])
    this.hub.connect(server, { playerId })

    // Emit join event
    this.$.send('Player.joined', {
      id: playerId,
      x: Math.random() * 800,
      y: Math.random() * 600,
      color: `hsl(${Math.random() * 360}, 70%, 60%)`,
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  // Called when hibernated DO receives message
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const data = JSON.parse(message as string)
    const playerId = this.hub.getMetadata(ws)?.playerId as string

    if (data.type === 'move') {
      this.$.send('Player.moved', { id: playerId, x: data.x, y: data.y })
    }
  }

  webSocketClose(ws: WebSocket) {
    const playerId = this.hub.getMetadata(ws)?.playerId as string
    this.$.send('Player.left', { id: playerId })
    this.hub.disconnect(ws)
  }
}
```

## Worker

```typescript
export { GameRoom } from './GameRoom'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const roomId = new URL(request.url).pathname.split('/')[2] || 'lobby'
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId))

    if (request.headers.get('Upgrade') === 'websocket') {
      return stub.handleWebSocket(request)
    }
    return stub.fetch(request)
  },
}
```

## Client

```typescript
const ws = new WebSocket('wss://game.example.com.ai/room/my-room')

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.type === 'player:joined') addPlayer(msg.player)
  if (msg.type === 'player:moved') movePlayer(msg.id, msg.x, msg.y)
  if (msg.type === 'player:left') removePlayer(msg.id)
}

// Send movement
ws.send(JSON.stringify({ type: 'move', x: 100, y: 200 }))
```

## Configuration

```toml
# wrangler.toml
name = "game-example"
main = "src/worker.ts"

[durable_objects]
bindings = [{ name = "GAME_ROOM", class_name = "GameRoom" }]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["GameRoom"]
```

## Promise Pipelining

Promises are stubs. Chain freely, await only when needed.

```typescript
// Sequential - N round-trips
for (const playerId of playerIds) {
  await $.Player(playerId).broadcast(gameState)
}

// Pipelined - fire and forget
playerIds.forEach(id => $.Player(id).broadcast(gameState))

// Pipelined - single round-trip for chained calls
const stats = await $.Player(id).getProfile().stats
```

For game broadcasts, fire-and-forget is ideal. No await needed for side effects like notifying other players. Only `await` at exit points when you need the value.

## Cost Model

| Scenario | Traditional | dotdo |
|----------|-------------|-------|
| 100 players | $50/mo server | Pay per request |
| Off-peak hours | Still paying | $0 (hibernated) |

The DO hibernates when all players disconnect. Zero idle costs.

## Try It

```bash
open https://game.example.com.ai/room/demo
```

---

Built with [dotdo](https://dotdo.dev)
