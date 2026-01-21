# Troubleshooting Guide

This guide covers common issues developers encounter when working with dotdo and Durable Objects (DOs), along with their causes, solutions, and prevention strategies.

## Table of Contents

1. [Build/TypeScript Errors](#1-buildtypescript-errors)
2. [DO Not Found](#2-do-not-found)
3. [Storage Errors](#3-storage-errors)
4. [RPC Failures](#4-rpc-failures)
5. [WebSocket Issues](#5-websocket-issues)
6. [Deployment Failures](#6-deployment-failures)
7. [Local Development](#7-local-development)
8. [Testing Problems](#8-testing-problems)

---

## 1. Build/TypeScript Errors

### 1.1 Missing Cloudflare Types

**Symptom:**
```
Cannot find name 'DurableObject'.
Cannot find name 'DurableObjectState'.
Cannot find name 'DurableObjectId'.
```

**Cause:**
The `@cloudflare/workers-types` package is not installed or not properly configured in your TypeScript config.

**Solution:**
1. Install the types package:
   ```bash
   npm install -D @cloudflare/workers-types
   ```

2. Add to your `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "types": ["@cloudflare/workers-types"]
     }
   }
   ```

**Prevention:**
Always include `@cloudflare/workers-types` as a peer dependency in your package.json.

---

### 1.2 WebSocket Response Type Mismatch

**Symptom:**
```
Type '{ status: number; webSocket: WebSocket; }' is not assignable to type 'ResponseInit'.
Property 'webSocket' does not exist on type 'ResponseInit'.
```

**Cause:**
Standard TypeScript `ResponseInit` doesn't include the `webSocket` property that Cloudflare Workers supports.

**Solution:**
The Cloudflare Workers runtime extends `ResponseInit` to include `webSocket`. Ensure you're using `@cloudflare/workers-types`:

```typescript
// This works with @cloudflare/workers-types
return new Response(null, {
  status: 101,
  webSocket: client,
})
```

**Prevention:**
Use the Cloudflare-specific types and avoid mixing with standard Web API types.

---

### 1.3 Module Resolution Errors

**Symptom:**
```
Cannot find module '@dotdo/do' or its corresponding type declarations.
```

**Cause:**
Workspace package linking not set up correctly or package not built.

**Solution:**
1. Build the package:
   ```bash
   npm run build --workspace=@dotdo/do
   ```

2. Ensure package.json exports are correct:
   ```json
   {
     "exports": {
       ".": {
         "types": "./dist/index.d.ts",
         "import": "./dist/index.js"
       }
     }
   }
   ```

**Prevention:**
Run `npm run build` before running tests or starting development.

---

### 1.4 Hono Type Conflicts

**Symptom:**
```
Type 'Context' is not assignable to type 'Context<any, any, {}>'.
```

**Cause:**
Hono version mismatch or incorrect context type inference.

**Solution:**
Explicitly type your Hono app and context:

```typescript
import { Hono } from 'hono'

type Bindings = {
  DO: DurableObjectNamespace
}

const app = new Hono<{ Bindings: Bindings }>()
```

**Prevention:**
Lock Hono version in package.json and use explicit type annotations.

---

## 2. DO Not Found

### 2.1 Binding Not Configured

**Symptom:**
```
TypeError: Cannot read properties of undefined (reading 'idFromName')
Error: DO is not defined
```

**Cause:**
The Durable Object binding is not configured in `wrangler.toml` or `wrangler.jsonc`.

**Solution:**
Add the binding to your wrangler config:

```jsonc
// wrangler.jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "DO", "class_name": "DO" }
    ]
  }
}
```

Or in TOML:
```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "DO"
class_name = "DO"
```

**Prevention:**
Always verify bindings match your code before deployment.

---

### 2.2 Class Not Exported

**Symptom:**
```
A Durable Object binding with name "DO" expects a class named "DO" to be exported.
No such class was found in your Worker's script.
```

**Cause:**
The DO class is not exported from your worker's entry point.

**Solution:**
Export the class from your main worker file:

```typescript
// index.ts
export { DO } from './DO'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // ...
  }
}
```

**Prevention:**
Ensure all DO classes referenced in wrangler config are exported.

---

### 2.3 Namespace Mismatch

**Symptom:**
DO exists but operations fail silently or return unexpected results.

**Cause:**
Using the wrong namespace or ID derivation method.

**Solution:**
Verify you're using the correct method:

```typescript
// From name (deterministic)
const id = env.DO.idFromName('my-do-name')

// From string ID (must be valid hex)
const id = env.DO.idFromString('0123456789abcdef...')

// Generate new unique ID
const id = env.DO.newUniqueId()
```

**Prevention:**
Use consistent ID derivation throughout your application.

---

### 2.4 Migration Issues

**Symptom:**
```
Error: Durable Object migration required but not configured
```

**Cause:**
DO class was renamed or moved without migration configuration.

**Solution:**
Add migration configuration:

```toml
# wrangler.toml
[[migrations]]
tag = "v1"
new_classes = ["DO"]

[[migrations]]
tag = "v2"
renamed_classes = [{ from = "OldDO", to = "DO" }]
```

**Prevention:**
Plan migrations before renaming DO classes.

---

## 3. Storage Errors

### 3.1 SQLite Row Size Limit

**Symptom:**
```
Error: Row too large
SQLITE_TOOBIG: string or blob too big
```

**Cause:**
SQLite has a maximum row size of approximately 1MB (2GB theoretical, but practical limits are lower).

**Solution:**
1. Store large blobs in R2 instead:
   ```typescript
   // Store reference in SQLite, data in R2
   await env.R2.put(`blob:${id}`, largeData)
   await sql.exec('INSERT INTO items (id, r2_key) VALUES (?, ?)', id, `blob:${id}`)
   ```

2. Compress data before storage:
   ```typescript
   const compressed = await compress(data)
   ```

**Prevention:**
Design schemas with size limits in mind. Use R2 for large objects.

---

### 3.2 Storage Quota Exceeded

**Symptom:**
```
Error: Durable Object storage quota exceeded
```

**Cause:**
DO storage limit (currently 1GB per DO) has been reached.

**Solution:**
1. Implement data cleanup/archival:
   ```typescript
   // Archive old data to R2
   const oldItems = sql.exec('SELECT * FROM items WHERE created_at < ?', cutoffDate)
   await archiveToR2(oldItems)
   sql.exec('DELETE FROM items WHERE created_at < ?', cutoffDate)
   ```

2. Shard data across multiple DOs.

**Prevention:**
Monitor storage usage and implement retention policies.

---

### 3.3 Transaction Deadlock

**Symptom:**
```
Error: database is locked
SQLITE_BUSY: database is locked
```

**Cause:**
Concurrent writes from multiple requests or nested transactions.

**Solution:**
Use `blockConcurrencyWhile` for atomic operations:

```typescript
await this.state.blockConcurrencyWhile(async () => {
  const current = await this.storage.get('counter')
  await this.storage.put('counter', current + 1)
})
```

**Prevention:**
Always use `blockConcurrencyWhile` for read-modify-write operations.

---

### 3.4 Data Not Persisting

**Symptom:**
Data appears to save but is lost after DO hibernation or restart.

**Cause:**
1. Using in-memory variables instead of storage
2. Not awaiting storage operations

**Solution:**
```typescript
// Wrong - data lost on hibernation
this.counter = 1

// Correct - persisted
await this.storage.put('counter', 1)

// For SQLite, ensure write completes
this.sql.exec('INSERT INTO items (value) VALUES (?)', value)
```

**Prevention:**
Never rely on instance variables for persistent state.

---

## 4. RPC Failures

### 4.1 Method Not Found

**Symptom:**
```json
{ "error": "Method not found: users.create" }
```
HTTP 404

**Cause:**
The RPC method path doesn't match any method on the DO.

**Solution:**
1. Verify method exists on the DO class:
   ```typescript
   class MyDO extends DO {
     users = {
       create: async (data: UserData) => { /* ... */ }
     }
   }
   ```

2. Check method path format:
   ```typescript
   // RPC call
   { method: 'users.create', args: [userData] }
   ```

**Prevention:**
Use typed RPC clients that catch mismatches at compile time.

---

### 4.2 Serialization Errors

**Symptom:**
```
TypeError: Converting circular structure to JSON
Error: Cannot serialize non-JSON value
```

**Cause:**
Attempting to return non-serializable values (functions, circular refs, symbols).

**Solution:**
Return only JSON-serializable data:

```typescript
// Wrong
return { process: process, circular: obj }

// Correct
return {
  result: serializableData,
  metadata: { /* plain objects only */ }
}
```

**Prevention:**
Define clear return types and validate before returning.

---

### 4.3 Timeout Errors

**Symptom:**
```
TimeoutError: Request timed out after 30000ms
AbortError: The operation was aborted
```

**Cause:**
RPC call exceeded the timeout threshold (default 30s).

**Solution:**
1. Increase timeout for long operations:
   ```typescript
   const client = createClient<MyAPI>({
     url: 'https://api.example.com.ai',
     timeout: 60000 // 60 seconds
   })
   ```

2. Break up long operations:
   ```typescript
   // Instead of one long operation
   await processAllItems(items)

   // Use batching
   for (const batch of chunks(items, 100)) {
     await processBatch(batch)
   }
   ```

**Prevention:**
Set appropriate timeouts and implement progress tracking for long operations.

---

### 4.4 Circuit Breaker Open

**Symptom:**
```
ServiceUnavailableError: Circuit breaker is open
```

**Cause:**
Too many consecutive failures triggered the circuit breaker.

**Solution:**
1. Wait for circuit breaker timeout (default 60s)
2. Manually reset if needed:
   ```typescript
   circuitBreaker.reset()
   ```
3. Investigate underlying failures

**Prevention:**
Monitor circuit breaker metrics and address root causes:
```typescript
const metrics = circuitBreaker.getMetrics()
console.log('Circuit state:', metrics.state)
console.log('Consecutive failures:', metrics.consecutiveFailures)
```

---

### 4.5 Authentication/Authorization Errors

**Symptom:**
```
AuthenticationError: Authentication token has expired
AuthorizationError: Insufficient permissions to create users
```

**Cause:**
Invalid, expired, or missing authentication token, or insufficient permissions.

**Solution:**
1. For expired tokens, refresh the token
2. For missing tokens, ensure token is included:
   ```typescript
   const response = await fetch(url, {
     headers: {
       'Authorization': `Bearer ${token}`
     }
   })
   ```

**Prevention:**
Implement token refresh logic and proper permission checks.

---

## 5. WebSocket Issues

### 5.1 Connection Drops

**Symptom:**
WebSocket connections close unexpectedly with code 1006 (abnormal closure).

**Cause:**
1. Network issues
2. DO hibernation without hibernatable WebSocket
3. No heartbeat/keepalive

**Solution:**
1. Use hibernatable WebSockets:
   ```typescript
   ctx.acceptWebSocket(server, ['hibernatable'])
   ```

2. Implement heartbeat:
   ```typescript
   const heartbeatId = ws.startHeartbeat(ctx, 30000, 60000)
   ```

3. Handle reconnection on client:
   ```javascript
   ws.onclose = () => {
     setTimeout(() => reconnect(), 1000)
   }
   ```

**Prevention:**
Always use hibernatable WebSockets and implement heartbeat.

---

### 5.2 Hibernation Not Working

**Symptom:**
DO doesn't wake up on WebSocket message, or state is lost.

**Cause:**
1. WebSocket not accepted with hibernation tag
2. State stored in instance variables instead of storage

**Solution:**
```typescript
// Accept with hibernation
ctx.acceptWebSocket(server, ['hibernatable'])

// Store state in storage, not instance variables
await this.storage.put('wsState', state)
```

**Prevention:**
Follow hibernation best practices in Cloudflare documentation.

---

### 5.3 Broadcast Failures

**Symptom:**
Messages not reaching all connected clients.

**Cause:**
1. Some WebSockets in error state
2. Tags not matching

**Solution:**
Check broadcast results:
```typescript
const result = ws.broadcast(ctx, 'room:123', message)
if (result.failed > 0) {
  console.warn(`Failed to send to ${result.failed} clients`)
}
```

**Prevention:**
Handle broadcast failures and implement retry logic.

---

### 5.4 Invalid JSON Message

**Symptom:**
```json
{ "type": "error", "error": "Invalid JSON message" }
```

**Cause:**
Client sent non-JSON or malformed JSON message.

**Solution:**
Validate messages before sending:
```javascript
// Client-side
const message = JSON.stringify({ type: 'chat', data: text })
ws.send(message)
```

**Prevention:**
Implement message validation on both client and server.

---

## 6. Deployment Failures

### 6.1 Script Size Exceeded

**Symptom:**
```
Error: Script is too large (max 5MB after compression)
```

**Cause:**
Worker script with dependencies exceeds size limit.

**Solution:**
1. Use tree shaking:
   ```javascript
   // Import only what you need
   import { specific } from 'large-package'
   ```

2. Move large assets to R2/KV
3. Use dynamic imports for optional features

**Prevention:**
Monitor bundle size during development.

---

### 6.2 Wrangler Config Errors

**Symptom:**
```
Error: Configuration file contains errors
```

**Cause:**
Invalid syntax or missing required fields in wrangler.toml/jsonc.

**Solution:**
Validate your configuration:
```bash
npx wrangler config check
```

Common fixes:
```jsonc
// wrangler.jsonc
{
  "name": "my-worker",           // Required
  "main": "index.ts",            // Required
  "compatibility_date": "2025-01-15",  // Required
  "durable_objects": {
    "bindings": [
      { "name": "DO", "class_name": "DO" }
    ]
  }
}
```

**Prevention:**
Use wrangler's config validation in CI/CD.

---

### 6.3 Missing Environment Variables

**Symptom:**
```
Error: Missing required environment variable: API_KEY
```

**Cause:**
Secrets not configured for the deployment environment.

**Solution:**
Add secrets:
```bash
npx wrangler secret put API_KEY
```

Or use `.dev.vars` for local development.

**Prevention:**
Document required secrets and validate on startup.

---

### 6.4 Compatibility Date Issues

**Symptom:**
```
Error: This feature requires compatibility_date >= 2024-01-01
```

**Cause:**
Using features that require a newer compatibility date.

**Solution:**
Update your wrangler config:
```jsonc
{
  "compatibility_date": "2025-01-15"
}
```

**Prevention:**
Keep compatibility date updated and test with new dates in staging.

---

## 7. Local Development

### 7.1 Miniflare Setup Issues

**Symptom:**
```
Error: Cannot find module 'workerd'
Error: Miniflare failed to start
```

**Cause:**
Missing or incompatible workerd binary.

**Solution:**
1. Install/reinstall workerd:
   ```bash
   npm install -D workerd@latest
   ```

2. Clear node_modules and reinstall:
   ```bash
   rm -rf node_modules
   npm install
   ```

**Prevention:**
Pin workerd version in package.json.

---

### 7.2 Hot Reload Not Working

**Symptom:**
Changes not reflected after saving files.

**Cause:**
1. Wrangler dev not watching correct files
2. Build step required but not running

**Solution:**
1. Use wrangler dev with proper config:
   ```bash
   npx wrangler dev --local
   ```

2. For TypeScript, ensure build runs:
   ```bash
   npm run dev  # Should include tsc --watch
   ```

**Prevention:**
Configure proper watch scripts in package.json.

---

### 7.3 Port Already in Use

**Symptom:**
```
Error: listen EADDRINUSE: address already in use :::8787
```

**Cause:**
Previous process still running on the port.

**Solution:**
1. Kill the process:
   ```bash
   pkill -9 -f wrangler
   pkill -9 -f miniflare
   ```

2. Use a different port:
   ```bash
   npx wrangler dev --port 8788
   ```

**Prevention:**
Clean up processes before restarting development server.

---

### 7.4 Memory Issues with Vitest/Vite

**Symptom:**
```
FATAL ERROR: Reached heap limit Allocation failed
JavaScript heap out of memory
```

**Cause:**
Running multiple vitest instances or watch mode with large codebase.

**Solution:**
1. Run tests sequentially:
   ```bash
   npx vitest run  # Not watch mode
   ```

2. Kill orphan processes:
   ```bash
   pkill -9 -f vitest
   pkill -9 -f vite
   ```

3. Increase Node memory (last resort):
   ```bash
   NODE_OPTIONS=--max-old-space-size=4096 npm test
   ```

**Prevention:**
Never run multiple vitest instances in parallel. Use `vitest run` in CI.

---

## 8. Testing Problems

### 8.1 Mock Setup Issues

**Symptom:**
Tests fail with undefined storage or missing DO methods.

**Cause:**
Incomplete mock implementation.

**Solution:**
Create comprehensive mocks:
```typescript
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: { toString: () => 'test-do-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve(true)
      }),
      list: vi.fn(() => Promise.resolve(storage)),
      deleteAll: vi.fn(() => {
        storage.clear()
        return Promise.resolve()
      }),
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState
}
```

**Prevention:**
Use Miniflare for integration tests instead of mocks when possible.

---

### 8.2 Async Test Failures

**Symptom:**
```
Error: Timeout - Async callback was not invoked within the 5000ms timeout
```

**Cause:**
1. Missing await on async operations
2. Unresolved promises
3. Test timeout too short

**Solution:**
1. Ensure all promises are awaited:
   ```typescript
   it('should work', async () => {
     await doInstance.fetch(request)  // Don't forget await
   })
   ```

2. Increase timeout for slow tests:
   ```typescript
   it('slow test', async () => {
     // ...
   }, 30000)  // 30 second timeout
   ```

**Prevention:**
Use TypeScript strict mode to catch missing awaits.

---

### 8.3 Test Isolation Issues

**Symptom:**
Tests pass individually but fail when run together.

**Cause:**
Shared state between tests not being reset.

**Solution:**
Use beforeEach to reset state:
```typescript
describe('DO Feature', () => {
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()  // Fresh state each test
    doInstance = new DO(mockState, {})
  })

  afterEach(() => {
    vi.clearAllMocks()
  })
})
```

**Prevention:**
Never share state between tests without explicit reset.

---

### 8.4 Miniflare Integration Test Setup

**Symptom:**
```
Error: No Durable Object class 'TestDO' exported
```

**Cause:**
Miniflare not configured with DO class.

**Solution:**
Configure Miniflare properly:
```typescript
const mf = new Miniflare({
  script: TEST_DO_SCRIPT,
  modules: true,
  durableObjects: {
    TEST_DO: 'TestDO'
  }
})
```

**Prevention:**
Follow Miniflare documentation for DO testing.

---

### 8.5 SQLite Tests Requiring Workers Pool

**Symptom:**
```
Error: sql is not defined
Error: Cannot use SQLite outside of Workers runtime
```

**Cause:**
SQLite tests running in Node.js instead of Workers runtime.

**Solution:**
Use the Cloudflare Vitest pool for SQLite tests:
```typescript
// vitest.config.ts
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' }
      }
    }
  }
})
```

**Prevention:**
Configure separate vitest projects for Workers vs Node tests.

---

## Quick Reference: Error Code Lookup

| Error Code | HTTP Status | Meaning |
|------------|-------------|---------|
| `NOT_FOUND` | 404 | Resource or method not found |
| `VALIDATION_ERROR` | 400 | Invalid input parameters |
| `AUTHENTICATION_ERROR` | 401 | Missing or invalid credentials |
| `AUTHORIZATION_ERROR` | 403 | Insufficient permissions |
| `CONFLICT` | 409 | Resource conflict (duplicate, version mismatch) |
| `RATE_LIMIT` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `TIMEOUT` | 504 | Request timed out |
| `NETWORK_ERROR` | 503 | Network connectivity issue |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |
| `CIRCUIT_OPEN` | 503 | Circuit breaker is open |

---

## Getting Help

If you're still stuck after consulting this guide:

1. **Check the logs**: Use `wrangler tail` to view real-time logs
2. **Search issues**: Check the GitHub issues for similar problems
3. **Ask the community**: Post in Discord or GitHub Discussions
4. **File a bug**: If you've found a bug, file an issue with reproduction steps

---

## Version Information

- dotdo version: Check `package.json`
- Wrangler version: `npx wrangler --version`
- Miniflare version: Check `package.json`
- Workerd version: Check `package.json`
