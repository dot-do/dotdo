# Real-time Collaboration Example

A real-time collaborative document editing application built with dotdo Durable Objects and WebSockets.

## Features

This example demonstrates:

- **WebSocket Connections**: Real-time bidirectional communication
- **Presence Awareness**: See who is currently editing
- **Cursor Tracking**: Show other users' cursor positions in real-time
- **Operational Transformation**: Basic edit operations (insert/delete)
- **Comments**: Threaded comments on document sections
- **Event Handlers**: `$.on.Noun.verb()` pattern for reactive event handling
- **Scheduling**: `$.every` pattern for scheduled tasks

## Key dotdo Concepts

### WorkflowContext ($)

The `$` context provides the core dotdo patterns:

```typescript
// Initialize in constructor
this.$ = createContext(state, env)

// Event handlers - $.on.Noun.verb pattern
this.$.on.Document.edited(async (event) => {
  const { documentId, userId, version, operationCount } = event.payload
  console.log(`Document ${documentId} edited by ${userId}, v${version}`)
})

this.$.on.Collaborator.joined(async (event) => {
  const { documentId, userId, userName } = event.payload
  console.log(`${userName} joined document ${documentId}`)
})

this.$.on.Comment.added(async (event) => {
  // Handle new comment
})

// Wildcard handlers - catch all document events
this.$.on.Document['*'](async (event) => {
  console.log(`[Audit] Document event: ${event.type}`, event.payload)
})

// Fire events (fire-and-forget)
this.$.send({
  type: 'Document.edited',
  payload: { documentId, userId, version, operationCount },
})
```

### Scheduling with $.every

```typescript
// Cleanup stale connections every hour
this.$.every.hour(async () => {
  console.log('Cleaning up stale connections...')
})
```

### WebSocket Manager

```typescript
// Register message handlers
this.ws.on('edit', this.handleEdit.bind(this))
this.ws.on('cursor', this.handleCursor.bind(this))

// Accept WebSocket connection with tags
return this.ws.handleWebSocketUpgrade(
  this.state,
  [`doc:${documentId}`],  // Tags for targeted broadcasts
  true  // Hibernatable
)

// Broadcast to all users viewing a document
this.ws.broadcast(this.state, `doc:${documentId}`, {
  type: 'presence',
  collaborators: [...],
})
```

### Things (Entities)

```typescript
// Document, Collaborator, Comment are all "Things"
const doc = await this.things.create({
  $type: 'Document',
  title: 'My Document',
  content: '',
  version: 0,
})
```

## WebSocket Protocol

### Client to Server Messages

| Type | Description |
|------|-------------|
| `join` | Join a document session |
| `leave` | Leave a document session |
| `edit` | Send edit operations |
| `cursor` | Update cursor position |
| `sync` | Request full document sync |

### Server to Client Messages

| Type | Description |
|------|-------------|
| `document` | Full document state |
| `edit` | Edit from another user |
| `cursor` | Cursor update from another user |
| `presence` | List of active collaborators |
| `ack` | Acknowledgment of edit |
| `error` | Error message |

## API Endpoints

### Documents

| Method | Path | Description |
|--------|------|-------------|
| GET | `/documents` | List all documents |
| GET | `/documents/:id` | Get a document |
| POST | `/documents` | Create a document |
| PATCH | `/documents/:id` | Update document title |

### WebSocket

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ws/:documentId` | WebSocket upgrade |

### Collaborators

| Method | Path | Description |
|--------|------|-------------|
| GET | `/documents/:id/collaborators` | Get active collaborators |

### Comments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/documents/:id/comments` | List comments |
| POST | `/documents/:id/comments` | Add comment |
| POST | `/documents/:docId/comments/:commentId/resolve` | Resolve comment |

### History

| Method | Path | Description |
|--------|------|-------------|
| GET | `/documents/:id/history` | Get document change history |

## Usage Example

### REST API

```bash
# Create a document
curl -X POST http://localhost:8787/documents \
  -H "Content-Type: application/json" \
  -d '{"title":"Meeting Notes","content":""}'

# Get document
curl http://localhost:8787/documents/{documentId}
```

### WebSocket Client

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

// Receive messages
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)

  switch (msg.type) {
    case 'document':
      // Initialize editor with document content
      editor.setContent(msg.content)
      break

    case 'edit':
      // Apply remote edit
      applyOperations(msg.operations)
      break

    case 'cursor':
      // Show other user's cursor
      showCursor(msg.userId, msg.position)
      break

    case 'presence':
      // Update collaborator list
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
    operations: operations,
    baseVersion: currentVersion,
  }))
}

// Send cursor position
function sendCursor(position) {
  ws.send(JSON.stringify({
    type: 'cursor',
    documentId: 'document-id',
    userId: 'user-123',
    position: position,
  }))
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
examples/collaboration/
  CollaborationDO.ts   # Main Durable Object implementation
  types.ts             # TypeScript type definitions
  index.ts             # Worker entrypoint
  wrangler.jsonc       # Cloudflare configuration
  package.json         # Package configuration
  README.md            # This file
```

## Architecture

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

## Edit Operations (Simplified OT)

This example uses a simplified operational transformation model:

```typescript
// Insert text at position
{ type: 'insert', position: 10, content: 'Hello' }

// Delete 5 characters at position
{ type: 'delete', position: 10, length: 5 }

// Retain (no-op for position tracking)
{ type: 'retain', position: 0, length: 10 }
```

For production use, consider using a mature OT library like `ot.js` or a CRDT library like `yjs` or `automerge`.

## Scaling Considerations

- Each workspace gets its own Durable Object, providing isolation
- WebSocket hibernation reduces costs for idle connections
- Use geographic hints for latency-sensitive collaboration
- Consider document sharding for very large documents
