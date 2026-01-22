# Durable Object Resource Limits

This document describes the resource limits for Durable Objects on Cloudflare Workers and provides best practices for staying within these limits when using dotdo.

## Quick Reference

| Resource | Limit | Notes |
|----------|-------|-------|
| **Memory** | 128 MB | Per DO instance |
| **CPU Time** | 30 seconds | Per request (wall clock) |
| **SQLite Storage** | 1 GB | Per DO instance |
| **SQLite Row Size** | 2 MB | Maximum row size |
| **WebSocket Connections** | 32,768 | Per DO instance |
| **Concurrent Requests** | 1 | Single-threaded execution |
| **Request Body** | 128 MB | Maximum request size |
| **Subrequest Limit** | 1,000 | Per invocation |

## Detailed Limits

### Memory (128 MB)

Each Durable Object instance has a maximum of **128 MB of memory**. This includes:

- JavaScript heap
- Compiled code
- SQLite in-memory caches
- WebSocket connection state

**Best Practices:**

```typescript
class MyDO extends DO {
  // BAD: Loading entire dataset into memory
  async loadAllData() {
    const all = await this.store.list({ limit: Infinity })  // May exceed memory
    return all
  }

  // GOOD: Stream and paginate
  async processData() {
    let cursor: string | undefined
    while (true) {
      const page = await this.store.list({ limit: 100, cursor })
      for (const item of page.results) {
        await this.processItem(item)
      }
      if (!page.cursor) break
      cursor = page.cursor
    }
  }

  // GOOD: Use SQLite for large datasets
  async queryLargeDataset(filter: string) {
    // SQLite handles pagination internally
    return this.ctx.storage.sql
      .exec('SELECT * FROM items WHERE category = ? LIMIT 100', filter)
      .toArray()
  }
}
```

**Memory-Saving Patterns:**

1. **Avoid caching large datasets** - Let SQLite handle storage
2. **Process data in chunks** - Use pagination and streaming
3. **Clean up after processing** - Set variables to `null` when done
4. **Use TypedArrays** for binary data - More memory-efficient than arrays

### CPU Time (30 seconds)

Each request has a maximum wall clock time of **30 seconds**. This is not CPU time - it includes all time waiting for I/O.

**Best Practices:**

```typescript
class MyDO extends DO {
  // BAD: Long-running synchronous computation
  async computeIntensive() {
    let result = 0
    for (let i = 0; i < 1_000_000_000; i++) {
      result += Math.sqrt(i)  // May timeout
    }
    return result
  }

  // GOOD: Break into smaller chunks with alarms
  async startComputation() {
    await this.ctx.storage.put('computeState', { index: 0, result: 0 })
    await this.ctx.storage.setAlarm(Date.now() + 100)
    return { status: 'started' }
  }

  async alarm() {
    const state = await this.ctx.storage.get('computeState')
    const chunkSize = 1_000_000

    for (let i = 0; i < chunkSize; i++) {
      state.result += Math.sqrt(state.index + i)
    }
    state.index += chunkSize

    if (state.index < 1_000_000_000) {
      await this.ctx.storage.put('computeState', state)
      await this.ctx.storage.setAlarm(Date.now() + 100)
    } else {
      await this.ctx.storage.put('computeResult', state.result)
      await this.ctx.storage.delete('computeState')
    }
  }
}
```

**For long-running tasks:**

1. **Use alarms** - Break work into chunks across multiple invocations
2. **Use Queues** - Offload work to Cloudflare Queues
3. **Use Workflows** - For multi-step processes
4. **Track progress** - Store state in SQLite/storage

### SQLite Storage (1 GB)

Each DO has access to **1 GB of SQLite storage**. This is durable, persistent storage.

**Best Practices:**

```typescript
class MyDO extends DO {
  // GOOD: Use appropriate data types
  private ensureSchema() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,           -- JSON for flexible data
        created_at INTEGER NOT NULL,  -- Unix timestamp (smaller than datetime)
        INDEX idx_type (type),
        INDEX idx_created (created_at)
      )
    `)
  }

  // GOOD: Clean up old data periodically
  async cleanup() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000)
    this.ctx.storage.sql.exec(
      'DELETE FROM events WHERE created_at < ?',
      thirtyDaysAgo
    )
    // Reclaim space
    this.ctx.storage.sql.exec('VACUUM')
  }

  // BAD: Storing large blobs inline
  async storeLargeFile(data: ArrayBuffer) {
    // 2MB row limit - will fail for large files
    this.ctx.storage.sql.exec(
      'INSERT INTO files (id, data) VALUES (?, ?)',
      id, data
    )
  }

  // GOOD: Use R2 for large files
  async storeLargeFile(id: string, data: ArrayBuffer) {
    await this.env.R2.put(`files/${id}`, data)
    this.ctx.storage.sql.exec(
      'INSERT INTO files (id, r2_key) VALUES (?, ?)',
      id, `files/${id}`
    )
  }
}
```

**Storage Guidelines:**

| Data Type | Recommended Storage |
|-----------|---------------------|
| Metadata, small JSON | SQLite |
| Large files (>1MB) | R2 |
| Session data | SQLite |
| Logs, events | SQLite with rotation |
| User-uploaded content | R2 |

### SQLite Row Size (2 MB)

Individual SQLite rows are limited to **2 MB**. This affects columns storing large JSON or binary data.

**Best Practices:**

```typescript
// BAD: Large JSON in single column
await this.ctx.storage.sql.exec(
  'INSERT INTO documents (id, content) VALUES (?, ?)',
  id, JSON.stringify(hugeDocument)  // May exceed 2MB
)

// GOOD: Split large documents
async storeDocument(id: string, doc: LargeDocument) {
  const content = JSON.stringify(doc)

  if (content.length < 1_500_000) {  // Leave buffer for row overhead
    this.ctx.storage.sql.exec(
      'INSERT INTO documents (id, content) VALUES (?, ?)',
      id, content
    )
  } else {
    // Store in R2, reference in SQLite
    await this.env.R2.put(`documents/${id}`, content)
    this.ctx.storage.sql.exec(
      'INSERT INTO documents (id, r2_key) VALUES (?, ?)',
      id, `documents/${id}`
    )
  }
}
```

### WebSocket Connections (32,768)

Each DO can maintain up to **32,768 concurrent WebSocket connections**.

**Best Practices:**

```typescript
class ChatRoomDO extends DO {
  // Track connection count
  private connectionCount = 0

  async handleWebSocket(request: Request): Promise<Response> {
    // Check limit before accepting
    if (this.connectionCount >= 30000) {  // Leave buffer
      return new Response('Room full', { status: 503 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.ctx.acceptWebSocket(server, ['room-member'])
    this.connectionCount++

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketClose(ws: WebSocket) {
    this.connectionCount--
  }

  // GOOD: Use tags for efficient broadcast
  broadcast(message: string) {
    // getWebSockets returns only matching sockets
    for (const ws of this.ctx.getWebSockets('room-member')) {
      ws.send(message)
    }
  }
}
```

**For massive scale:**

1. **Shard by room/topic** - Multiple DOs for different rooms
2. **Use hierarchical fanout** - Coordinator DO routes to room DOs
3. **Implement backpressure** - Reject connections when near limit

### Concurrent Requests (1)

Durable Objects are **single-threaded** - only one request executes at a time within a DO instance. Other requests queue.

**Best Practices:**

```typescript
class MyDO extends DO {
  // BAD: Long-running requests block others
  async heavyOperation() {
    await sleep(5000)  // All other requests wait
    return result
  }

  // GOOD: Use input gates for batching
  async fetch(request: Request) {
    // Quick response, actual work happens via alarm
    const taskId = crypto.randomUUID()
    await this.ctx.storage.put(`task:${taskId}`, { status: 'pending' })
    await this.ctx.storage.setAlarm(Date.now() + 10)

    return Response.json({ taskId, status: 'queued' })
  }

  // GOOD: Batch related operations
  async batchUpdate(items: Item[]) {
    // Single transaction, atomic
    this.ctx.storage.transactionSync(() => {
      for (const item of items) {
        this.ctx.storage.sql.exec(
          'UPDATE items SET data = ? WHERE id = ?',
          JSON.stringify(item.data), item.id
        )
      }
    })
  }
}
```

### Subrequest Limit (1,000)

Each DO invocation can make up to **1,000 subrequests** (fetch calls to external services or other DOs).

**Best Practices:**

```typescript
class MyDO extends DO {
  // BAD: Unbounded subrequests
  async notifyAll(userIds: string[]) {
    // May exceed 1000 limit
    await Promise.all(userIds.map(id =>
      fetch(`https://api.example.com/notify/${id}`)
    ))
  }

  // GOOD: Batch API calls
  async notifyAll(userIds: string[]) {
    // Single request, batch payload
    await fetch('https://api.example.com/notify/batch', {
      method: 'POST',
      body: JSON.stringify({ userIds })
    })
  }

  // GOOD: Use Queues for fanout
  async notifyAll(userIds: string[]) {
    for (const id of userIds) {
      await this.env.NOTIFICATION_QUEUE.send({ userId: id })
    }
  }
}
```

## Monitoring Resource Usage

### Memory Monitoring

```typescript
class MyDO extends DO {
  async getMemoryUsage() {
    // Note: Not officially supported, may not be accurate
    const used = process.memoryUsage?.() ?? {}
    return {
      heapUsed: used.heapUsed,
      heapTotal: used.heapTotal,
      external: used.external
    }
  }
}
```

### Storage Monitoring

```typescript
class MyDO extends DO {
  async getStorageStats() {
    const rows = this.ctx.storage.sql.exec(`
      SELECT
        name as table_name,
        (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=m.name) as row_count
      FROM sqlite_master m
      WHERE type='table'
    `).toArray()

    // Get total database size
    const pageCount = this.ctx.storage.sql.exec(
      'PRAGMA page_count'
    ).toArray()[0].page_count as number

    const pageSize = this.ctx.storage.sql.exec(
      'PRAGMA page_size'
    ).toArray()[0].page_size as number

    return {
      tables: rows,
      totalSize: pageCount * pageSize,
      limit: 1024 * 1024 * 1024  // 1GB
    }
  }
}
```

## When to Shard

Consider sharding your DO when:

| Symptom | Sharding Strategy |
|---------|-------------------|
| Approaching 1GB storage | Shard by user/tenant |
| WebSocket connections > 10K | Shard by room/topic |
| Memory pressure | Shard by data partition |
| High request latency | Geographic sharding |

### Sharding Example

```typescript
// Worker entry point - route to appropriate DO
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    const userId = url.searchParams.get('userId')

    // Shard by user ID hash
    const shardId = hashToShard(userId, 100)  // 100 shards
    const id = env.DO.idFromName(`shard-${shardId}`)
    const stub = env.DO.get(id)

    return stub.fetch(request)
  }
}

function hashToShard(key: string, numShards: number): number {
  let hash = 0
  for (const char of key) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0)
    hash = hash & hash
  }
  return Math.abs(hash) % numShards
}
```

## Related Documentation

- [Cloudflare DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [SQLite in Workers](https://developers.cloudflare.com/d1/learning/querying-json/)
- [ARCHITECTURE.md](/ARCHITECTURE.md) - System design
- [TROUBLESHOOTING.md](/docs/TROUBLESHOOTING.md) - Common issues
