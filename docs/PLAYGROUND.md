# dotdo Playground: Browser-Based Sandbox Design

This document outlines the design for a browser-based playground/sandbox that allows developers to try dotdo without any local setup.

## Overview

The dotdo Playground is an interactive browser-based environment where developers can:

1. Write and run dotdo code in real-time
2. See results immediately without deployment
3. Explore the DO API, WorkflowContext ($), and entity stores
4. Share code snippets and examples
5. Follow interactive tutorials

## Architecture

### Core Components

```
+-------------------+     +-------------------+     +-------------------+
|   Browser Client  |     |   Playground API  |     |   Sandbox DOs     |
|   (Monaco Editor) | --> |   (Worker)        | --> |   (Per-session)   |
+-------------------+     +-------------------+     +-------------------+
         |                         |                         |
         v                         v                         v
   - Code editor            - Session mgmt           - Isolated execution
   - Console output         - Code validation        - Ephemeral storage
   - Live preview           - Rate limiting          - Auto-cleanup
   - Tutorial panels        - Auth (optional)        - _eval RPC endpoint
```

### Technical Design

#### 1. Frontend (Browser Client)

**Tech Stack:**
- TanStack Start (existing @dotdo/app infrastructure)
- Monaco Editor for code editing with TypeScript support
- WebSocket connection for real-time output streaming

**Key Features:**
- Split-pane layout: Editor | Output | Preview
- Syntax highlighting with dotdo-specific completions
- Real-time error highlighting from TypeScript
- Console panel showing logs, events, and results
- Visual entity inspector for Things, Events, Relationships

**Example UI Layout:**
```
+------------------------------------------------------------------+
|  [Templates v] [Share] [Reset]              [Sign In] [Settings] |
+------------------------------------------------------------------+
|                    |                    |                        |
|   // Your Code     |   Console Output   |   Entity Inspector     |
|                    |                    |                        |
|   $.on.Task.created|   > Task created   |   Things (3)           |
|     (async (e) =>  |   > Event fired    |   +- Task: "Learn DO"  |
|       {...}        |   > Handler ran    |   +- Task: "Build app" |
|     )              |                    |   +- User: "demo"      |
|                    |   [Clear] [Export] |                        |
|   [Run] [Format]   |                    |   Events (5)           |
+------------------------------------------------------------------+
|  Tutorial: Step 2/8 - Working with Events         [Next >]       |
+------------------------------------------------------------------+
```

#### 2. Backend (Playground API Worker)

**Responsibilities:**
- Session management (ephemeral sandbox IDs)
- Code validation and security scanning
- Rate limiting to prevent abuse
- Optional authentication for persistence

**Session Model:**
```typescript
interface PlaygroundSession {
  id: string          // Unique session ID (e.g., nanoid)
  createdAt: number   // Timestamp
  expiresAt: number   // Auto-cleanup after 1 hour of inactivity
  userId?: string     // Optional: for persistence across sessions
  doId: string        // Associated sandbox DO instance
}
```

**Endpoints:**
```
POST /playground/sessions           Create new session
GET  /playground/sessions/:id       Get session info
POST /playground/sessions/:id/eval  Execute code in sandbox
WS   /playground/sessions/:id/ws    Real-time output stream
DELETE /playground/sessions/:id     End session (cleanup)
```

#### 3. Sandbox Durable Objects

Each playground session gets its own isolated DO instance. The existing `_eval` RPC method on the DO class provides the execution engine.

**From DO.ts:**
```typescript
async _eval(options: EvalOptions, request?: Request): Promise<EvalResult> {
  // - Sandboxed JavaScript execution
  // - Access to $ context (things, events, relationships)
  // - Timeout enforcement (default 5 seconds)
  // - Caller permission scoping
}
```

**Sandbox Configuration:**
```typescript
interface SandboxDOOptions extends DOOptions {
  // Playground-specific limits
  maxThings: number      // Max entities (default: 100)
  maxEvents: number      // Max events (default: 500)
  evalTimeout: number    // Script timeout ms (default: 5000)

  // Auto-cleanup
  sessionTTL: number     // Session lifetime (default: 1 hour)

  // Isolation
  networkDisabled: true  // No fetch/WebSocket from scripts
  fsDisabled: true       // No filesystem access
}
```

### Security Model

#### Code Execution Security

1. **Sandboxed Environment**: The `_eval` method uses `ScriptInterpreter` with V8 isolate sandboxing
2. **No Network Access**: Scripts cannot make HTTP requests or open WebSockets
3. **No Filesystem Access**: No access to fs, git, bash, or npm primitives
4. **Timeout Enforcement**: Maximum execution time of 5 seconds per script
5. **Resource Limits**: Maximum entities, events, and memory per session

#### Rate Limiting

```typescript
const PLAYGROUND_LIMITS = {
  evalPerMinute: 30,        // Max code executions per minute
  sessionsPerIP: 5,         // Max concurrent sessions per IP
  codeMaxLength: 50_000,    // Max code size (50KB)
}
```

#### Code Validation (Pre-execution)

Before executing user code, validate:
- No `eval()` or `Function()` calls
- No `import` or `require` (only sandbox-provided APIs)
- No infinite loop patterns (basic static analysis)
- Code size within limits

### Data Model

#### Session Storage

Sessions stored in KV with auto-expiration:
```typescript
// Key: playground:session:{sessionId}
// Value: PlaygroundSession JSON
// TTL: 3600 seconds (1 hour)
```

#### Sandbox DO Storage

Each sandbox DO uses ephemeral SQLite storage that auto-cleans when the session expires:
- Things: Up to 100 entities per session
- Events: Up to 500 events per session
- Relationships: Up to 200 relationships per session

### API Design

#### Create Session

```http
POST /playground/sessions
Content-Type: application/json

{
  "template": "blank" | "tasks" | "events" | "websockets",
  "tutorial": "getting-started" | null
}

Response:
{
  "sessionId": "abc123xyz",
  "expiresAt": 1704067200000,
  "editorUrl": "https://playground.dotdo.dev/s/abc123xyz"
}
```

#### Execute Code

```http
POST /playground/sessions/:id/eval
Content-Type: application/json

{
  "script": "const task = await $.things.create({ $type: 'Task', title: 'Hello' }); return task;"
}

Response:
{
  "success": true,
  "value": { "$id": "task_123", "$type": "Task", "title": "Hello" },
  "logs": [
    { "level": "log", "args": ["Task created"], "timestamp": 1704067200000 }
  ],
  "duration": 12
}
```

#### WebSocket Events

```typescript
// Client -> Server
{ type: 'eval', script: '...' }
{ type: 'subscribe', filters: ['events', 'things'] }
{ type: 'ping' }

// Server -> Client
{ type: 'eval.result', success: true, value: {...}, logs: [...] }
{ type: 'eval.error', error: 'Timeout exceeded' }
{ type: 'entity.created', entity: {...} }
{ type: 'event.emitted', event: {...} }
{ type: 'pong' }
```

### Templates and Examples

Pre-built templates for quick starts:

#### 1. Blank Template
```typescript
// Start fresh - your playground is ready!

// Create your first entity
const item = await $.things.create({
  $type: 'Item',
  name: 'My First Item'
})

console.log('Created:', item)
return item
```

#### 2. Task Manager Template
```typescript
// Task Manager Example

// Define event handlers
$.on.Task.created(async (event) => {
  console.log('New task:', event.payload.title)
})

$.on.Task.completed(async (event) => {
  console.log('Completed:', event.payload.taskId)
})

// Create some tasks
const task1 = await $.things.create({
  $type: 'Task',
  title: 'Learn dotdo',
  status: 'pending',
  priority: 'high'
})

const task2 = await $.things.create({
  $type: 'Task',
  title: 'Build something awesome',
  status: 'pending',
  priority: 'medium'
})

// Fire events
$.send({ type: 'Task.created', payload: { taskId: task1.$id, title: task1.title }})
$.send({ type: 'Task.created', payload: { taskId: task2.$id, title: task2.title }})

// Return all tasks
return await $.things.list({ type: 'Task' })
```

#### 3. Event Sourcing Template
```typescript
// Event Sourcing Example

// Track all events
const allEvents = []

$.on['*']['*'](async (event) => {
  allEvents.push({
    type: event.type,
    time: new Date().toISOString(),
    payload: event.payload
  })
  console.log(`Event: ${event.type}`)
})

// Simulate a user journey
$.send({ type: 'User.registered', payload: { email: 'demo@example.com' }})
$.send({ type: 'User.verified', payload: { email: 'demo@example.com' }})
$.send({ type: 'Order.created', payload: { items: 3, total: 99.99 }})
$.send({ type: 'Order.paid', payload: { paymentMethod: 'card' }})
$.send({ type: 'Order.shipped', payload: { carrier: 'express' }})

// Wait for events to process
await new Promise(r => setTimeout(r, 100))

return { eventCount: allEvents.length, events: allEvents }
```

### Interactive Tutorial System

Tutorials are structured as a series of steps with:
- Instructional text (markdown)
- Pre-filled code snippets
- Expected outcomes/assertions
- Hints for common mistakes

```typescript
interface TutorialStep {
  id: string
  title: string
  description: string       // Markdown content
  initialCode: string       // Pre-filled editor content
  hints: string[]           // Help messages
  validation?: {
    // Optional: Check user's code output
    expectValue?: unknown
    expectLogs?: string[]
    expectEntities?: number
  }
}

interface Tutorial {
  id: string
  title: string
  description: string
  steps: TutorialStep[]
  estimatedTime: string     // "15 minutes"
}
```

**Tutorial: Getting Started with dotdo**

| Step | Title | Description |
|------|-------|-------------|
| 1 | Your First Entity | Create a Thing using `$.things.create()` |
| 2 | Listing Entities | Query entities with `$.things.list()` |
| 3 | Event Handlers | Set up handlers with `$.on.Noun.verb()` |
| 4 | Firing Events | Emit events with `$.send()` |
| 5 | Relationships | Connect entities with `$.relationships` |
| 6 | Building a Mini-App | Combine everything into a task tracker |

### Deployment Architecture

```
                                    Cloudflare Network
+------------------------------------------------------------------------+
|                                                                        |
|   playground.dotdo.dev                                                 |
|         |                                                              |
|         v                                                              |
|   +-------------+                                                      |
|   |   Worker    |  <- Rate limiting, session management                |
|   | (Hono API)  |                                                      |
|   +-------------+                                                      |
|         |                                                              |
|         +------------------+------------------+                         |
|         |                  |                  |                         |
|         v                  v                  v                         |
|   +----------+       +----------+       +----------+                   |
|   | Sandbox  |       | Sandbox  |       | Sandbox  |  <- Per-session   |
|   |   DO 1   |       |   DO 2   |       |   DO N   |     DOs           |
|   +----------+       +----------+       +----------+                   |
|                                                                        |
|   +------------------+                                                 |
|   | KV: Sessions     |  <- Session metadata, auto-expiring             |
|   +------------------+                                                 |
|                                                                        |
+------------------------------------------------------------------------+
```

### Implementation Phases

#### Phase 1: Core Playground (MVP)
- [ ] Basic Monaco editor with dotdo syntax support
- [ ] Session management API
- [ ] Sandbox DO with _eval integration
- [ ] Console output panel
- [ ] Single "Blank" template

#### Phase 2: Enhanced Features
- [ ] Entity inspector (visual tree view)
- [ ] Multiple templates (tasks, events, relationships)
- [ ] Code sharing (short URLs)
- [ ] WebSocket real-time updates

#### Phase 3: Tutorial System
- [ ] Tutorial framework
- [ ] "Getting Started" tutorial
- [ ] Step validation and hints
- [ ] Progress tracking (optional sign-in)

#### Phase 4: Advanced Features
- [ ] Custom DO class definitions
- [ ] Multi-file support
- [ ] Export to Wrangler project
- [ ] Collaboration (shared sessions)

### Cost Considerations

**Per Session:**
- DO instance: ~$0.01/hour (hibernation when idle)
- KV reads/writes: Negligible
- Worker invocations: ~$0.50/million

**Rate Limiting to Control Costs:**
- Max 5 concurrent sessions per IP
- Sessions auto-expire after 1 hour of inactivity
- 30 code executions per minute limit

**Estimated Monthly Cost (1000 daily users):**
- ~$50-100/month for moderate usage
- Scales linearly with user engagement

### Success Metrics

1. **Engagement**: Time spent in playground
2. **Completion**: Tutorial completion rate
3. **Conversion**: Users who continue to local development
4. **Sharing**: Code snippets shared
5. **Retention**: Return visits

### Future Considerations

1. **Paid Tier**: Longer sessions, more resources, persistent storage
2. **Integration**: Embed playground in documentation
3. **API Explorer**: Generate playground links from API docs
4. **Template Marketplace**: Community-contributed templates

---

## Summary

The dotdo Playground provides a zero-friction way to experience the framework. By leveraging the existing `_eval` RPC capability and Durable Object isolation, we can create a secure, ephemeral sandbox environment that runs real dotdo code in the browser.

Key technical enablers:
- `DO._eval()` for sandboxed code execution
- Durable Objects for isolated per-session state
- WebSockets for real-time output streaming
- KV for session management with auto-expiration

This design prioritizes security (sandboxed execution, rate limiting), developer experience (Monaco editor, real-time feedback), and cost efficiency (auto-cleanup, hibernation).
