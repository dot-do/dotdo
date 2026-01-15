# kanban.example.com.ai

A real-time collaborative kanban board built on dotdo v2.

## The Problem

Your team needs project visibility. But kanban tools charge per seat - $10/user/month adds up fast. And their APIs? Limited, proprietary, no audit trail.

## The Solution

dotdo gives you kanban where every card move is an **Action** - event, edge, and audit in one. WebSocket sync is automatic. Unlimited seats.

## Data Model

```typescript
import { noun, verb, thing, action } from 'dotdo'

const Board = noun('Board')
const Column = noun('Column')
const Card = noun('Card')
const User = noun('User')

const move = verb('move')

const card = thing(Card, 'card-auth', {
  title: 'Implement OAuth',
  column: 'col-backlog'
})
const alice = thing(User, 'alice', { name: 'Alice Chen' })
```

## Card Move as Action

```typescript
// Alice moves the card from Backlog to In Progress
const moveAction = action(alice, move, card, {
  from: 'col-backlog',
  to: 'col-progress'
})

// Creates simultaneously:
// - Event:  { type: 'moved', subject: 'alice', object: 'card-auth' }
// - Edge:   alice -> card (relationship)
// - Audit:  { actor: 'alice', verb: 'moved', target: 'card-auth', timestamp }
```

## Event Handling

```typescript
import { DO, WebSocketHub } from 'dotdo'

export default DO.extend({
  hub: new WebSocketHub(),

  init() {
    this.on.Card.moved(async (event) => {
      const { from, to } = event.data

      // Broadcast to all connected clients
      this.hub.broadcast({
        type: 'card:moved',
        cardId: event.object,
        from,
        to,
        movedBy: event.subject
      })
    })

    this.on.Card.*(async (event) => {
      // Log all card activity
      await this.do(() => auditLog.append(event))
    })
  }
})
```

## WebSocket Sync

```typescript
function handleConnection(ws: WebSocket, boardId: string) {
  hub.connect(ws, { boardId })
  hub.room.join(ws, `board:${boardId}`)

  ws.send(JSON.stringify({
    type: 'board:state',
    columns: getColumns(boardId),
    cards: getCards(boardId)
  }))
}

function handleMessage(ws: WebSocket, message: string) {
  const msg = JSON.parse(message)

  if (msg.type === 'card:move') {
    const moveAction = action(currentUser, move, getCard(msg.cardId), {
      from: msg.from,
      to: msg.to
    })
    $.dispatch('Card.moved', moveAction)
  }
}
```

## Column Transitions

```typescript
const TRANSITIONS = {
  'Backlog': ['In Progress'],
  'In Progress': ['Backlog', 'Review', 'Done'],
  'Review': ['In Progress', 'Done'],
  'Done': ['In Progress']
}

this.on.Card.moved(async (event) => {
  const card = getCard(event.object)
  const fromName = getColumn(card.column).name
  const toName = getColumn(event.data.to).name

  if (!TRANSITIONS[fromName]?.includes(toName)) {
    throw new Error(`Invalid transition: ${fromName} -> ${toName}`)
  }

  card.column = event.data.to
  await this.do(() => saveCard(card))
})
```

## Board DO

```typescript
import { DO, WebSocketHub } from 'dotdo'

export default DO.extend({
  hub: new WebSocketHub(),

  init() {
    this.on.Card.moved(async (event) => {
      this.hub.broadcast({ type: 'card:moved', ...event.data })
    })
  },

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair()
      this.hub.connect(pair[1])
      pair[1].accept()
      pair[1].addEventListener('message', (e) => this.handleMessage(pair[1], e.data))
      pair[1].addEventListener('close', () => this.hub.disconnect(pair[1]))
      return new Response(null, { status: 101, webSocket: pair[0] })
    }
    return Response.json(this.getCards())
  }
})
```

## Client

```typescript
const ws = new WebSocket('wss://kanban.example.com.ai/board/engineering')

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.type === 'card:moved') {
    moveCardInUI(msg.cardId, msg.to)
  }
}

// Move a card
ws.send(JSON.stringify({
  type: 'card:move',
  cardId: 'card-auth',
  from: 'col-backlog',
  to: 'col-progress'
}))
```

## Promise Pipelining (Cap'n Web)

True Cap'n Proto-style pipelining: method calls on stubs batch until `await`, then resolve in a single round-trip.

```typescript
// ❌ Sequential - N round-trips
for (const userId of card.watchers) {
  await this.User(userId).notify(cardUpdate)
}

// ✅ Pipelined - fire and forget
card.watchers.forEach(id => this.User(id).notify(cardUpdate))

// ✅ Pipelined - single round-trip for chained access
const email = await this.Card(cardId).assignee.email
```

`this.Noun(id)` returns a pipelined stub. When a card moves, notify watchers without blocking. The notifications fire in parallel - no await needed for side effects.

## What You Get

- Full audit trail of every card move
- Real-time sync across all clients
- Column transition rules
- Unlimited team members
- Your data, your DO
