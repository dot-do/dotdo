# Mock Audit Report

**Generated:** 2026-01-20
**Task:** do-luhm.29 - Audit and remove ALL mocks from codebase
**Auditor:** Claude

## Summary

| Category | Count |
|----------|-------|
| **Total vi.fn() usages** | ~710 |
| **Total vi.mock() usages** | 11 |
| **Total vi.spyOn() usages** | ~25 |
| **Total createMock* functions** | ~50 |

### By Package

| Package | vi.fn() | vi.mock() | vi.spyOn() | createMock* | Priority |
|---------|---------|-----------|------------|-------------|----------|
| **do** | ~150 | 0 | 5 | 8 | **P0 - Critical** |
| **db** | ~15 | 0 | 2 | 4 | **P0 - Critical** |
| **rpc** | ~50 | 0 | 0 | 0 | **P1 - High** |
| **auth** | ~25 | 0 | 6 | 0 | **P1 - High** |
| **mcp** | ~30 | 0 | 0 | 0 | **P2 - Medium** |
| **app** | ~60 | 0 | 0 | 0 | **P2 - Medium** |
| **ai** | ~15 | 0 | 0 | 0 | **P2 - Medium** |
| **api** | ~5 | 0 | 0 | 1 | **P2 - Medium** |
| **dotdo (CLI)** | ~20 | 2 | 4 | 0 | **P3 - Low** |
| **primitives** | ~340 | 9 | 7 | ~30 | **P3 - External** |

---

## Priority 0: DurableObject Mocks (CRITICAL)

These must be replaced with real Miniflare/vitest-worker-pools instances.

### do/tests/DO.test.ts

**Lines 5-28:** `createMockState()` - Full mock of DurableObjectState
```typescript
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-do-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {...}),
      delete: vi.fn((key: string) => {...}),
      list: vi.fn(() => Promise.resolve(storage)),
      deleteAll: vi.fn(() => {...}),
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
  }
}
```
**Replace with:** Real DurableObjectState from `cloudflare:test` via vitest-worker-pools
```typescript
import { env } from 'cloudflare:test'
const stub = env.DO.get(env.DO.idFromName('test'))
```

### do/tests/entities.test.ts

**Lines 6-28:** Identical `createMockState()` pattern
**Replace with:** Real Miniflare environment

### do/tests/concurrency.test.ts

**Lines 55-141:** Extended `createMockState()` with concurrency tracking
```typescript
function createMockState(options: { trackConcurrency?: boolean } = {}): DurableObjectState & {...}
```
**Replace with:** Real DurableObjectState - the concurrency tracking can be done via real DO behavior

### do/tests/audit.test.ts

**Lines 9-31:** `createMockState()` for audit logging tests
**Replace with:** Real DurableObjectState with SQLite

### do/tests/websocket.test.ts

**Lines 55-99:** `createMockState()` with WebSocket mocks
```typescript
acceptWebSocket: vi.fn((ws: WebSocket, tags?: string[]) => {...}),
getWebSockets: vi.fn((tag?: string) => {...}),
```
**Replace with:** Real WebSocket handling via Miniflare's WebSocket support

### do/tests/cross-do.test.ts

**Lines 5-53:** Mock state AND mock DurableObjectNamespace
```typescript
const createMockNamespace = (name: string): DurableObjectNamespace => {
  return {
    idFromName: vi.fn((id: string) => ({...})),
    get: vi.fn((doId: any) => ({...}))
  }
}
```
**Replace with:** Real multi-DO setup via Miniflare bindings

### do/tests/context.test.ts

**Lines 5-10:** Simple mock state for context testing
**Replace with:** Real DurableObjectState

### do/tests/schedule.test.ts

**Lines 5-10:** Mock state for scheduler testing
```typescript
const mockState = {
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(() => Promise.resolve(new Map())),
  }
}
```
**Replace with:** Real DurableObjectState with alarm support

---

## Priority 0: Database/Storage Mocks (CRITICAL)

### db/tests/sqlite.test.ts

**Lines 23-64:** `createMockSqlStorage()` - Mock SQL storage
```typescript
function createMockSqlStorage(): MockSqlStorage {
  // Full mock of SqlStorage with Map-based backing
}
```
**Replace with:** Real SQLite via Miniflare's D1/DO SQL

### db/tests/migrations.test.ts

**Lines 24-100:** Extended `createMockSqlStorage()` with exec tracking
**Replace with:** Real SQLite migrations

### db/tests/audit.test.ts

**Lines 9-50:** `createMockAuditStore()` - Mock audit storage
**Replace with:** Real audit store backed by SQLite

### db/tests/events.test.ts

**Lines 93-117:** Event handler mocks
```typescript
const handler = vi.fn()
const badHandler = vi.fn(() => { throw new Error('Oops') })
const goodHandler = vi.fn()
```
**Note:** Handler mocks are acceptable for testing event dispatch - these test callback behavior

---

## Priority 1: RPC/Network Mocks (HIGH)

### rpc/tests/client.test.ts

**Lines 5-367:** Extensive fetch mocking
```typescript
const mockFetch = vi.fn()
// Lines 255-367: Mock DO namespaces for client tests
```
**Replace with:** Real fetch via Miniflare's fetch handler OR integration tests

### rpc/tests/correlation-id.test.ts

**Lines 14-335:** Mock fetch for correlation ID propagation
**Replace with:** Real request/response cycle

### rpc/tests/errors.test.ts

**Lines 109-440:** Mock functions for error handling
```typescript
const fn = vi.fn().mockResolvedValue('success')
const fn = vi.fn().mockRejectedValue(error)
```
**Note:** Some error mocks are necessary for testing error paths

---

## Priority 1: Auth Mocks (HIGH)

### auth/tests/jwks.test.ts

**Lines 102-724:** Mock fetch for JWKS endpoint
```typescript
const mockFetch = vi.fn().mockResolvedValue(createJwksResponse([rsaJwk]))
vi.stubGlobal('fetch', mockFetch)
```
**Replace with:** Real JWKS server (test fixture) OR mock server via MSW

### auth/tests/auth.test.ts

**Lines 304-576:** Console spies for warning tests
```typescript
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
```
**Note:** Console spies are acceptable for testing log output

---

## Priority 2: MCP/Sandbox Mocks (MEDIUM)

### mcp/tests/sandbox.test.ts

**Lines 6-51:** Mock WorkflowContext
```typescript
mockContext = {
  send: vi.fn((event) => {...}),
  try: vi.fn(async (action) => {...}),
  do: vi.fn(async (action, options) => {...}),
  on: {...}
}
```
**Replace with:** Real WorkflowContext from a test DO instance

### mcp/tests/sandbox-integration.test.ts

**Lines 11-54:** Similar mock context pattern
**Replace with:** Real context from integration test setup

---

## Priority 2: App/Frontend Mocks (MEDIUM)

### app/tests/data.test.ts

**Lines 6-600:** Mock fetch and WebSocket for data layer
```typescript
const mockFetch = vi.fn()
global.fetch = mockFetch
// MockWebSocket class for sync testing
```
**Replace with:** MSW (Mock Service Worker) for frontend testing

### app/tests/admin.test.ts

**Lines 66-401:** Mock fetch and WebSocket for admin UI
**Replace with:** MSW or real backend in integration tests

---

## Priority 2: AI Router Mocks (MEDIUM)

### ai/tests/router.test.ts

**Lines 67-278:** Mock AI execution
```typescript
const mockExecute = vi.fn()
```
**Replace with:** Real AI Gateway calls (with test API keys) or AI Gateway mock mode

### ai/tests/promise.test.ts

**Lines 291:** Cleanup mock
```typescript
const cleanup = vi.fn()
```
**Note:** Acceptable for testing cleanup callbacks

---

## Priority 2: API Rate Limit Mocks (MEDIUM)

### api/tests/rate-limit.test.ts

**Lines 37-1106:** `createMockRequest()` helper
```typescript
function createMockRequest(options: {...}): Request
```
**Note:** Request factory is acceptable - these are real Request objects, not mocks

---

## Priority 3: CLI Mocks (LOW)

### dotdo/tests/dev.test.ts

**Lines 6-44:** vi.mock for child_process
```typescript
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))
```
**Note:** Process mocks are necessary for CLI testing - consider integration tests instead

### dotdo/tests/workers-do.test.ts

**Lines 25-66:** vi.mock for @dotdo/rpc
```typescript
vi.mock('@dotdo/rpc', () => ({
  createClient: vi.fn(() => mockAPI),
}))
```
**Replace with:** Real RPC client in integration tests

### dotdo/tests/login.test.ts

**Lines 31-58:** Mock os.homedir
**Note:** Acceptable for testing file operations without touching real home dir

---

## Priority 3: Primitives Mocks (EXTERNAL SUBMODULE)

The `primitives/` directory is a git submodule with its own test strategy. These mocks should be addressed in that repo:

### primitives/packages/ai-functions/test/*
- **batch-background.test.ts**: Mock batch processing
- **tool-orchestration.test.ts**: Mock model.generate
- **decide.test.ts**: Mock decision functions
- **core-functions.test.ts**: Mock AI functions
- **implicit-batch.test.ts**: vi.mock('generate.js')

### primitives/packages/ai-database/test/*
- **cascade-errors.test.ts**: vi.mock('ai-functions')
- **embeddings-integration.test.ts**: Mock embedding provider
- **union-fallback-integration.test.ts**: Mock search functions

### primitives/packages/autonomous-agents/test/*
- **agent.test.ts**: vi.mock('ai-functions')
- **team.test.ts**: vi.mock('ai-functions')

### primitives/packages/digital-objects/test/*
- **security.test.ts**: Mock SQL storage
- **search-escaping.test.ts**: Mock SQL storage

**Recommendation:** Open issues in primitives repo for mock removal

---

## Acceptable Mocks (DO NOT REMOVE)

Some mocks are appropriate and should NOT be removed:

### 1. Event Handler Mocks
```typescript
const handler = vi.fn()
$.on.Customer.signup(handler)
await $.emit({ type: 'Customer.signup', ... })
expect(handler).toHaveBeenCalled()
```
These test that events are dispatched correctly.

### 2. Console Spies
```typescript
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
```
These test logging behavior without polluting test output.

### 3. Request Factories
```typescript
function createMockRequest(options): Request {
  return new Request(...)  // Real Request object, not a mock
}
```
These create real objects, not mocks.

### 4. Error Path Testing
```typescript
const fn = vi.fn().mockRejectedValue(new Error('Test error'))
```
Necessary to test error handling paths.

---

## Recommended Migration Path

### Phase 1: DO Core (Week 1)
1. Set up vitest-worker-pools configuration
2. Migrate `do/tests/DO.test.ts` to use real Miniflare
3. Migrate `do/tests/entities.test.ts`
4. Migrate `do/tests/websocket.test.ts`
5. Migrate `do/tests/cross-do.test.ts`

### Phase 2: Database (Week 1-2)
1. Migrate `db/tests/sqlite.test.ts` to real SQLite
2. Migrate `db/tests/migrations.test.ts`
3. Migrate `db/tests/audit.test.ts`

### Phase 3: RPC/Auth (Week 2)
1. Migrate `rpc/tests/client.test.ts` to integration tests
2. Set up test JWKS server for `auth/tests/jwks.test.ts`
3. Migrate `rpc/tests/correlation-id.test.ts`

### Phase 4: MCP/AI (Week 2-3)
1. Migrate `mcp/tests/sandbox.test.ts` to real context
2. Set up AI Gateway test mode for `ai/tests/router.test.ts`

### Phase 5: Frontend (Week 3)
1. Set up MSW for `app/tests/data.test.ts`
2. Set up MSW for `app/tests/admin.test.ts`

---

## Example: Converting DO.test.ts

### Before (Mocked)
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO } from '../DO'

function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-do-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      // ... more mocks
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState
}

describe('DO Class', () => {
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    doInstance = new DO(mockState, {})
  })

  it('should respond to GET /', async () => {
    const request = new Request('https://do/')
    const response = await doInstance.fetch(request)
    expect(response.status).toBe(200)
  })
})
```

### After (Real Miniflare)
```typescript
import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

describe('DO Class', () => {
  it('should respond to GET /', async () => {
    const id = env.DO.idFromName('test')
    const stub = env.DO.get(id)

    const response = await stub.fetch('https://do/')
    expect(response.status).toBe(200)

    const json = await response.json()
    expect(json.status).toBe('ok')
  })
})
```

---

## Configuration Reference

### vitest.config.ts for DO Tests
```typescript
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          durableObjects: {
            DO: 'DO',
          },
        },
      },
    },
  },
})
```

### wrangler.toml for Tests
```toml
[durable_objects]
bindings = [
  { name = "DO", class_name = "DO" }
]

[[migrations]]
tag = "v1"
new_classes = ["DO"]
```

---

## Notes

1. **miniflare-integration.test.ts** already demonstrates the correct pattern - this is the reference implementation
2. The primitives submodule has its own testing strategy and should be addressed separately
3. Some tests may need to be split into unit tests (fast, some mocks OK) and integration tests (real infrastructure)
4. Consider using `@cloudflare/vitest-pool-workers` for all DO-related tests

---

## Files to Delete After Migration

Once all tests are migrated to real implementations, these mock utilities can be removed:

- [ ] `do/tests/DO.test.ts` - lines 5-28 (createMockState)
- [ ] `do/tests/entities.test.ts` - lines 6-28 (createMockState)
- [ ] `do/tests/concurrency.test.ts` - lines 55-141 (createMockState)
- [ ] `do/tests/audit.test.ts` - lines 9-31 (createMockState)
- [ ] `do/tests/websocket.test.ts` - lines 55-99 (createMockState)
- [ ] `do/tests/cross-do.test.ts` - lines 5-53 (mockState + createMockNamespace)
- [ ] `do/tests/context.test.ts` - lines 5-10 (mockState)
- [ ] `do/tests/schedule.test.ts` - lines 5-10 (mockState)
- [ ] `db/tests/sqlite.test.ts` - lines 23-64 (createMockSqlStorage)
- [ ] `db/tests/migrations.test.ts` - lines 24-100 (createMockSqlStorage)
- [ ] `db/tests/audit.test.ts` - lines 9-50 (createMockAuditStore)
