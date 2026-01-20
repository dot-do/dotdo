# Case Study: Real-time Collaboration with dotdo

**Published: January 2026**

Learn how to build a real-time collaborative document editing application using dotdo Durable Objects and WebSockets. This case study demonstrates presence awareness, cursor tracking, operational transformation, and live commenting.

## The Problem

Building real-time collaboration features is notoriously difficult:

- **WebSocket Management**: Maintaining persistent connections at scale
- **Presence Tracking**: Knowing who is currently online and active
- **Conflict Resolution**: Handling simultaneous edits from multiple users
- **State Synchronization**: Keeping all clients in sync with the server
- **Event Broadcasting**: Efficiently notifying all relevant clients of changes

Traditional solutions require Redis for pub/sub, a separate WebSocket server, and complex state synchronization logic. With dotdo, WebSockets are native to Durable Objects.

## Architecture Overview

```
  Browser A          Browser B          Browser C
      |                  |                  |
      v                  v                  v
  WebSocket          WebSocket          WebSocket
      |                  |                  |
      +--------+---------+---------+--------+
               |
               v
     +--------------------+
     |  CollaborationDO   |
     |  - things          |  <-- Document, Collaborator, Comment
     |  - events          |  <-- Document.edited, Collaborator.joined
     |  - ws (WebSocket)  |  <-- Handles all real-time messaging
     +--------------------+
               |
               v
     +--------------------+
     |  Durable Storage   |
     |  (per-workspace)   |
     +--------------------+
```

Key benefits:
- **Single Source of Truth**: All state lives in the DO
- **Automatic Fan-out**: WebSocket broadcasts to all connected clients
- **Hibernation**: Idle connections consume minimal resources
- **Geographic Hints**: Low latency via edge deployment

## Key dotdo Patterns

### Event Handlers with $.on.Noun.verb

Track document edits and collaborator activity:

```typescript
// Initialize WorkflowContext for event handling
this.$ = createContext(state, env)

// Track document edits for analytics
this.$.on.Document.edited(async (event) => {
  const { documentId, userId, version, operationCount } = event.payload
  console.log(`Document ${documentId} edited by ${userId}, v${version} (${operationCount} ops)`)
})

// Track collaborator join/leave
this.$.on.Collaborator.joined(async (event) => {
  const { documentId, userId, userName } = event.payload
  console.log(`${userName} (${userId}) joined document ${documentId}`)
})

this.$.on.Collaborator.left(async (event) => {
  const { documentId, userId } = event.payload
  console.log(`User ${userId} left document ${documentId}`)
})

// Track comments
this.$.on.Comment.added(async (event) => {
  const { documentId, commentId, userId } = event.payload
  console.log(`Comment ${commentId} added to document ${documentId} by ${userId}`)
})

// Audit log all document events
this.$.on.Document['*'](async (event) => {
  console.log(`[Audit] Document event: ${event.type}`, event.payload)
})
```

### Scheduling with $.every

Background maintenance tasks:

```typescript
// Every hour - check for stale connections and cleanup
this.$.every.hour(async () => {
  console.log('Cleaning up stale connections...')
  // In production: timeout inactive connections
})
```

### WebSocket Message Handlers

Register handlers for different message types:

```typescript
// Register WebSocket message handlers in constructor
this.ws.on('join', this.handleJoin.bind(this))
this.ws.on('leave', this.handleLeave.bind(this))
this.ws.on('edit', this.handleEdit.bind(this))
this.ws.on('cursor', this.handleCursor.bind(this))
this.ws.on('sync', this.handleSync.bind(this))
```

### WebSocket Upgrade

Accept WebSocket connections with document-specific tags:

```typescript
app.get('/ws/:documentId', async (c) => {
  const documentId = c.req.param('documentId')

  // Verify document exists
  const doc = await this.things.get(documentId)
  if (!doc || doc.$type !== 'Document') {
    return c.json({ error: 'Document not found' }, 404)
  }

  // Check for WebSocket upgrade header
  const upgradeHeader = c.req.header('Upgrade')
  if (upgradeHeader !== 'websocket') {
    return c.json({ error: 'Expected websocket upgrade' }, 426)
  }

  // Accept WebSocket with document tag for targeted broadcasts
  return this.ws.handleWebSocketUpgrade(
    this.state,
    [`doc:${documentId}`],  // Tags for targeted broadcasts
    true  // Hibernatable
  )
})
```

### Handling User Join

When a user joins a document:

```typescript
private async handleJoin(ws: WebSocket, data: unknown): Promise<void> {
  const { documentId, userId, userName } = data as JoinMessage

  // Get or create collaborator
  let collaborator = (await this.things.list({ type: 'Collaborator' }))
    .find((t) => t.userId === userId)

  if (!collaborator) {
    collaborator = await this.things.create({
      $type: 'Collaborator',
      userId,
      name: userName,
      color: getRandomColor(),  // Assign cursor color
    })
  }

  // Track connection
  this.userConnections.set(userId, ws)

  // Initialize cursor position
  this.cursors.set(userId, {
    userId,
    position: 0,
    updatedAt: new Date().toISOString(),
  })

  // Send current document state to joining user
  const doc = await this.things.get(documentId)
  this.ws.send(ws, {
    type: 'document',
    documentId: doc.$id,
    title: doc.title,
    content: doc.content,
    version: doc.version,
  })

  // Broadcast presence update to all collaborators
  await this.broadcastPresence(documentId)

  // Fire event - triggers $.on.Collaborator.joined handler
  this.$.send({
    type: 'Collaborator.joined',
    payload: { documentId, userId, userName },
  })
}
```

### Handling Edits

Process and broadcast document edits:

```typescript
private async handleEdit(ws: WebSocket, data: unknown): Promise<void> {
  const { documentId, userId, operations, baseVersion } = data as EditMessage

  const doc = await this.things.get(documentId)
  if (!doc) {
    this.ws.send(ws, { type: 'error', code: 'NOT_FOUND', message: 'Document not found' })
    return
  }

  // Check for version conflict (simplified OT)
  if (baseVersion !== doc.version) {
    this.ws.send(ws, {
      type: 'error',
      code: 'VERSION_CONFLICT',
      message: 'Document was modified. Please sync and retry.',
    })
    return
  }

  // Apply operations to content
  let content = doc.content
  for (const op of operations) {
    content = this.applyOperation(content, op)
  }

  // Update document
  const newVersion = doc.version + 1
  await this.things.update(documentId, {
    content,
    version: newVersion,
    lastEditedBy: userId,
  })

  // Store change for history
  await this.things.create({
    $type: 'DocumentChange',
    documentId,
    userId,
    version: newVersion,
    operations,
    timestamp: new Date().toISOString(),
  })

  // Send ack to editor
  this.ws.send(ws, {
    type: 'ack',
    documentId,
    version: newVersion,
  })

  // Broadcast edit to other collaborators
  const sockets = this.state.getWebSockets(`doc:${documentId}`)
  for (const socket of sockets) {
    if (socket !== ws) {
      this.ws.send(socket, {
        type: 'edit',
        documentId,
        userId,
        operations,
        version: newVersion,
      })
    }
  }

  // Fire event - triggers $.on.Document.edited handler
  this.$.send({
    type: 'Document.edited',
    payload: { documentId, userId, version: newVersion, operationCount: operations.length },
  })
}
```

### Cursor Broadcasting

Share cursor positions in real-time:

```typescript
private async handleCursor(ws: WebSocket, data: unknown): Promise<void> {
  const { documentId, userId, position, selection } = data as CursorMessage

  // Update cursor position
  this.cursors.set(userId, {
    userId,
    position,
    selection,
    updatedAt: new Date().toISOString(),
  })

  // Broadcast cursor to other collaborators
  const sockets = this.state.getWebSockets(`doc:${documentId}`)
  for (const socket of sockets) {
    if (socket !== ws) {
      this.ws.send(socket, {
        type: 'cursor',
        userId,
        position,
        selection,
      })
    }
  }
}
```

### Presence Broadcasting

Notify all users of who is online:

```typescript
private async broadcastPresence(documentId: string): Promise<void> {
  const collaborators = []

  // Get active collaborators
  const allCollaborators = await this.things.list({ type: 'Collaborator' })
  for (const collab of allCollaborators) {
    if (this.userConnections.has(collab.userId)) {
      collaborators.push({
        userId: collab.userId,
        name: collab.name,
        color: collab.color,
        cursor: this.cursors.get(collab.userId),
      })
    }
  }

  this.ws.broadcast(this.state, `doc:${documentId}`, {
    type: 'presence',
    documentId,
    collaborators,
  })
}
```

## Edit Operations (Simplified OT)

Basic operational transformation:

```typescript
private applyOperation(content: string, op: Operation): string {
  switch (op.type) {
    case 'insert':
      return (
        content.slice(0, op.position) +
        (op.content || '') +
        content.slice(op.position)
      )
    case 'delete':
      return (
        content.slice(0, op.position) +
        content.slice(op.position + (op.length || 0))
      )
    case 'retain':
      return content  // No change
    default:
      return content
  }
}
```

## Type Definitions

```typescript
export interface Document {
  $type: 'Document'
  title: string
  content: string
  version: number
  lastEditedBy?: string
}

export interface Collaborator {
  $type: 'Collaborator'
  userId: string
  name: string
  color: string  // Cursor/selection color
}

export interface CursorPosition {
  userId: string
  position: number
  selection?: { start: number; end: number }
  updatedAt: string
}

export interface Operation {
  type: 'insert' | 'delete' | 'retain'
  position: number
  content?: string   // For insert
  length?: number    // For delete/retain
}

export interface Comment {
  $type: 'Comment'
  documentId: string
  userId: string
  userName: string
  content: string
  position: { start: number; end: number }
  resolved: boolean
  createdAt: string
  resolvedAt?: string
  resolvedBy?: string
}
```

## WebSocket Protocol

### Client to Server
| Type | Description |
|------|-------------|
| `join` | Join a document session |
| `leave` | Leave a document session |
| `edit` | Send edit operations |
| `cursor` | Update cursor position |
| `sync` | Request full document sync |

### Server to Client
| Type | Description |
|------|-------------|
| `document` | Full document state |
| `edit` | Edit from another user |
| `cursor` | Cursor update from another user |
| `presence` | List of active collaborators |
| `ack` | Acknowledgment of edit |
| `error` | Error message |

## Client Implementation

```javascript
// Connect to document
const ws = new WebSocket('ws://localhost:8787/ws/document-id')

// Join session
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'join',
    documentId: 'document-id',
    userId: 'user-123',
    userName: 'Alice',
  }))
}

// Handle messages
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)

  switch (msg.type) {
    case 'document':
      editor.setContent(msg.content)
      break

    case 'edit':
      applyOperations(msg.operations)
      break

    case 'cursor':
      showCursor(msg.userId, msg.position)
      break

    case 'presence':
      updateCollaborators(msg.collaborators)
      break
  }
}

// Send edit
function sendEdit(operations) {
  ws.send(JSON.stringify({
    type: 'edit',
    documentId: 'document-id',
    userId: 'user-123',
    operations,
    baseVersion: currentVersion,
  }))
}

// Send cursor position
function sendCursor(position) {
  ws.send(JSON.stringify({
    type: 'cursor',
    documentId: 'document-id',
    userId: 'user-123',
    position,
  }))
}
```

## Benefits and Results

### What We Achieved

1. **Native WebSockets**: No separate WebSocket server or Redis needed
2. **Presence Awareness**: Real-time visibility into who is online
3. **Cursor Tracking**: See where other users are typing
4. **Event-Driven**: All changes trigger events for analytics and logging
5. **Hibernation**: Idle connections cost almost nothing
6. **Comment Threading**: Inline comments with resolution workflow

### Performance

- **Low Latency**: Co-located compute and state at the edge
- **Efficient Broadcasting**: Tags enable targeted message delivery
- **Connection Hibernation**: Automatic resource optimization

### Scaling Considerations

- Each workspace gets its own Durable Object
- WebSocket hibernation reduces costs for idle connections
- Geographic hints minimize latency for real-time collaboration
- Consider document sharding for very large documents

## Try It Yourself

The complete example is available at `examples/collaboration/`:

```bash
cd examples/collaboration
npm install
npm run dev
```

Example API calls:

```bash
# Create a document
curl -X POST http://localhost:8787/documents \
  -H "Content-Type: application/json" \
  -d '{"title":"Meeting Notes","content":""}'

# Get document
curl http://localhost:8787/documents/{documentId}

# Add a comment
curl -X POST http://localhost:8787/documents/{docId}/comments \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice","userName":"Alice","content":"Nice work!","position":{"start":0,"end":10}}'
```

---

*Next: [AI Agent Case Study](/docs/blog/case-study-ai-agent.md)*
