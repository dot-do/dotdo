# TanStack DB Integration Design

## Overview

Integrate `@tanstack/db` properly with dotdo's real-time sync infrastructure. Move `packages/tanstack` to `db/tanstack` and rewrite to use TanStack DB's actual sync API.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client (React)                          │
├─────────────────────────────────────────────────────────────────┤
│  @tanstack/db                                                   │
│  └── useLiveQuery()                                             │
│       └── collection (from dotdoCollectionOptions)              │
│            ├── sync: WebSocket → begin/write/commit/markReady   │
│            └── mutations: Cap'n Web RPC → txid return           │
└─────────────────────────────────────────────────────────────────┘
                              │
                    WebSocket + RPC
                              │
┌─────────────────────────────────────────────────────────────────┐
│                      Server (DO)                                │
├─────────────────────────────────────────────────────────────────┤
│  DOBase                                                         │
│  ├── /sync WebSocket → SyncEngine                               │
│  │    └── subscribe/unsubscribe by collection                   │
│  ├── /rpc Cap'n Web → Collection RPC Methods                    │
│  │    └── {Noun}.create/update/delete → returns rowid           │
│  └── ThingsStore mutations → SyncEngine.broadcast()             │
└─────────────────────────────────────────────────────────────────┘
```

## Client: db/tanstack

### Package Structure

```
db/tanstack/
├── index.ts              # Public exports
├── collection.ts         # dotdoCollectionOptions() factory
├── sync-client.ts        # WebSocket subscription manager
├── rpc.ts                # Cap'n Web RPC client
├── protocol.ts           # Wire format (migrate from packages/tanstack)
└── tests/
    ├── unit/
    │   ├── sync-client.test.ts
    │   ├── rpc.test.ts
    │   └── collection.test.ts
    └── integration/
        └── live-query.test.ts
```

### Collection Options Factory

```typescript
import type { CollectionConfig } from '@tanstack/db'

export function dotdoCollectionOptions<T extends { $id: string }>(config: {
  doUrl: string
  collection: string
  schema: ZodSchema<T>
  branch?: string
}): CollectionConfig<T> {
  return {
    id: `dotdo:${config.collection}`,
    schema: config.schema,
    getKey: (item) => item.$id,

    sync: ({ begin, write, commit, markReady }) => {
      const client = new SyncClient(config)

      client.onInitial((items) => {
        begin()
        for (const item of items) {
          write({ type: 'insert', value: item })
        }
        commit()
        markReady()
      })

      client.onChange((op, item) => {
        begin()
        write({ type: op, value: item })
        commit()
      })

      client.connect()
      return () => client.disconnect()
    },

    onInsert: async ({ transaction }) => {
      const item = transaction.mutations[0].modified
      const result = await capnweb(config.doUrl, config.collection, 'create', item)
      return { txid: result.rowid }
    },

    onUpdate: async ({ transaction }) => {
      const { key, changes } = transaction.mutations[0]
      const result = await capnweb(config.doUrl, config.collection, 'update', { id: key, ...changes })
      return { txid: result.rowid }
    },

    onDelete: async ({ transaction }) => {
      const { key } = transaction.mutations[0]
      const result = await capnweb(config.doUrl, config.collection, 'delete', { id: key })
      return { txid: result.rowid }
    },
  }
}
```

### Cap'n Web RPC Client

```typescript
interface CapnWebRequest {
  id: string
  type: 'call' | 'batch'
  calls: Array<{
    promiseId: string
    target: { type: 'root' }
    method: string
    args: Array<{ type: 'value'; value: unknown }>
  }>
}

export async function capnweb<T>(
  doUrl: string,
  collection: string,
  method: string,
  params: unknown
): Promise<T> {
  const request: CapnWebRequest = {
    id: crypto.randomUUID(),
    type: 'call',
    calls: [{
      promiseId: 'p1',
      target: { type: 'root' },
      method: `${collection}.${method}`,
      args: [{ type: 'value', value: params }]
    }]
  }

  const response = await fetch(`${doUrl}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  })

  const result = await response.json()
  if (result.results[0].type === 'error') {
    throw new Error(result.results[0].error.message)
  }
  return result.results[0].value
}
```

## Server: DO Changes

### 1. Complete ThingsCollection Interface

Add `update` and `delete` to ThingsCollection:

```typescript
export interface ThingsCollection<T extends Thing = Thing> {
  get(id: string): Promise<T | null>
  list(): Promise<T[]>
  find(query: Record<string, unknown>): Promise<T[]>
  create(data: Partial<T>): Promise<T & { rowid: number }>
  update(id: string, data: Partial<T>): Promise<T & { rowid: number }>
  delete(id: string): Promise<{ rowid: number }>
}
```

### 2. Dynamic Collection RPC Methods

Expose collection methods via RPC with pattern `{Noun}.{method}`:

```typescript
// In DOBase, intercept RPC calls matching pattern
handleRpcMethod(method: string, args: unknown[]) {
  const match = method.match(/^([A-Z][a-zA-Z]*)\.(create|update|delete|get|list|find)$/)
  if (match) {
    const [, noun, action] = match
    const collection = this.collection(noun)
    return collection[action](...args)
  }
  // Fall through to normal RPC
}
```

### 3. Wire SyncEngine to DO

```typescript
// In DOBase
private _syncEngine?: SyncEngine

get syncEngine(): SyncEngine {
  if (!this._syncEngine) {
    this._syncEngine = new SyncEngine(this.things)
  }
  return this._syncEngine
}

// In fetch handler, add /sync route
if (url.pathname === '/sync') {
  return this.handleSyncWebSocket(request)
}
```

### 4. Broadcast Changes on Mutations

Hook ThingsStore mutations to broadcast:

```typescript
// After things.create/update/delete succeeds
this.syncEngine.onThingCreated(thing, rowid)
this.syncEngine.onThingUpdated(thing, rowid)
this.syncEngine.onThingDeleted(collection, id, branch, rowid)
```

## Protocol

Wire format (already defined in packages/tanstack/protocol.ts):

```typescript
// Client → Server
{ type: 'subscribe', collection: 'Task', branch?: string }
{ type: 'unsubscribe', collection: 'Task' }

// Server → Client
{ type: 'initial', collection: 'Task', data: T[], txid: number }
{ type: 'insert', collection: 'Task', key: string, data: T, txid: number }
{ type: 'update', collection: 'Task', key: string, data: T, txid: number }
{ type: 'delete', collection: 'Task', key: string, txid: number }
```

## TDD Phases

### Server
1. RED: Collection RPC methods tests
2. GREEN: Implement dynamic collection RPC
3. RED: SyncEngine broadcast tests
4. GREEN: Hook mutations to broadcasts
5. RED: /sync WebSocket route tests
6. GREEN: Wire SyncEngine to DO fetch

### Client
1. Setup: Move packages/tanstack → db/tanstack
2. RED: Cap'n Web RPC client tests
3. GREEN: Implement rpc.ts
4. RED: SyncClient tests
5. GREEN: Implement sync-client.ts
6. RED: dotdoCollectionOptions tests with @tanstack/db
7. GREEN: Implement collection.ts
8. RED: E2E integration tests
9. GREEN: Wire everything together

## Dependencies

```
@tanstack/db: ^0.5.0
zod: ^3.24.0
```

## References

- [TanStack DB Docs](https://tanstack.com/db/latest/docs)
- [Collection Options Creator Guide](https://tanstack.com/db/latest/docs/guides/collection-options-creator)
- [Electric Collection Reference](https://tanstack.com/db/latest/docs/collections/electric-collection)
