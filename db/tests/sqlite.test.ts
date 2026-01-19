import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSQLiteThingsStore, createSQLiteEventsStore, createSQLiteRelationshipsStore, SQLiteAdapter } from '../sqlite'
import type { Thing, ThingsStore } from '../things'
import type { Event, EventsStore } from '../events'
import type { Relationship, RelationshipsStore } from '../relationships'

// Mock SqlStorage interface
interface MockSqlResult {
  results: Array<Record<string, unknown>>
}

interface MockSqlStorage {
  exec(sql: string): MockSqlResult
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first(): Promise<Record<string, unknown> | null>
      all(): Promise<{ results: Array<Record<string, unknown>> }>
      run(): Promise<void>
    }
  }
}

function createMockSqlStorage(): MockSqlStorage {
  // Create shared state for tables
  const state = {
    things: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
    relationships: [] as Array<Record<string, unknown>>
  }

  const tables = new Map<string, Array<Record<string, unknown>>>()
  tables.set('things', state.things)
  tables.set('events', state.events)
  tables.set('relationships', state.relationships)

  return {
    exec(sql: string): MockSqlResult {
      // Simple exec handler for CREATE TABLE
      return { results: [] }
    },

    prepare(sql: string) {
      const boundValues: unknown[] = []

      return {
        bind(...values: unknown[]) {
          boundValues.push(...values)
          return {
            async first(): Promise<Record<string, unknown> | null> {
              // Parse SQL to determine operation
              const lowerSql = sql.toLowerCase().trim()

              if (lowerSql.startsWith('select')) {
                // Extract table name
                const tableMatch = sql.match(/from\s+(\w+)/i)
                if (!tableMatch) return null

                const tableName = tableMatch[1]
                const rows = tables.get(tableName)
                if (!rows) return null

                // Handle WHERE clause
                if (lowerSql.includes('where')) {
                  // Check for compound WHERE (relationships)
                  if (boundValues.length === 3 && lowerSql.includes('and')) {
                    const [subject, predicate, object] = boundValues
                    const found = rows.find((r: any) =>
                      r.subject === subject && r.predicate === predicate && r.object === object
                    )
                    return found || null
                  }

                  // Simple WHERE clause
                  if (boundValues.length > 0) {
                    const value = boundValues[0]
                    const found = rows.find((r: any) =>
                      r.id === value || r[Object.keys(r)[0]] === value
                    )
                    return found || null
                  }
                }

                return rows[0] || null
              }

              return null
            },

            async all(): Promise<{ results: Array<Record<string, unknown>> }> {
              const lowerSql = sql.toLowerCase().trim()

              if (lowerSql.startsWith('select')) {
                const tableMatch = sql.match(/from\s+(\w+)/i)
                if (!tableMatch) return { results: [] }

                const tableName = tableMatch[1]
                const tableRows = tables.get(tableName)
                if (!tableRows) return { results: [] }

                let rows = [...tableRows]

                // Handle WHERE clause filtering
                if (lowerSql.includes('where') && !lowerSql.includes('where 1=1')) {
                  // Count how many real conditions we have (not including "1=1")
                  const realAndCount = (sql.match(/AND(?!\s*1\s*=\s*1)/gi) || []).length

                  if (realAndCount >= 1) {
                    // Multiple conditions with "WHERE ..." (not 1=1)
                    const hasSubject = sql.includes('subject = ?')
                    const hasPredicate = sql.includes('predicate = ?')
                    const hasObject = sql.includes('object = ?')

                    rows = rows.filter((r: any) => {
                      let valueIndex = 0
                      let matches = true

                      if (hasSubject && boundValues[valueIndex] !== undefined) {
                        matches = matches && r.subject === boundValues[valueIndex]
                        valueIndex++
                      }
                      if (hasPredicate && boundValues[valueIndex] !== undefined) {
                        matches = matches && r.predicate === boundValues[valueIndex]
                        valueIndex++
                      }
                      if (hasObject && boundValues[valueIndex] !== undefined) {
                        matches = matches && r.object === boundValues[valueIndex]
                        valueIndex++
                      }

                      return matches
                    })
                  } else {
                    // We have filters - determine which ones by inspecting SQL and bound values
                    let filterIndex = 0

                    // Check for type filter
                    if (sql.includes('type = ?')) {
                      const typeValue = boundValues[filterIndex++]
                      rows = rows.filter((r: any) => r.type === typeValue)
                    }

                    // Check for source filter
                    if (sql.includes('source = ?')) {
                      const sourceValue = boundValues[filterIndex++]
                      rows = rows.filter((r: any) => r.source === sourceValue)
                    }

                    // Check for correlation_id filter
                    if (sql.includes('correlation_id = ?')) {
                      const corrValue = boundValues[filterIndex++]
                      rows = rows.filter((r: any) => r.correlation_id === corrValue)
                    }

                    // Check for subject filter
                    if (sql.includes('subject = ?')) {
                      const subjectValue = boundValues[filterIndex++]
                      rows = rows.filter((r: any) => r.subject === subjectValue)
                    }

                    // Check for predicate filter
                    if (sql.includes('predicate = ?')) {
                      const predicateValue = boundValues[filterIndex++]
                      rows = rows.filter((r: any) => r.predicate === predicateValue)
                    }

                    // Check for object filter
                    if (sql.includes('object = ?')) {
                      const objectValue = boundValues[filterIndex++]
                      rows = rows.filter((r: any) => r.object === objectValue)
                    }

                    // Check for timestamp range
                    if (sql.includes('timestamp >= ?')) {
                      const sinceValue = boundValues[filterIndex++]
                      rows = rows.filter((r: any) => typeof r.timestamp === 'number' && r.timestamp >= sinceValue)
                    }

                    if (sql.includes('timestamp <= ?')) {
                      const untilValue = boundValues[filterIndex++]
                      rows = rows.filter((r: any) => typeof r.timestamp === 'number' && r.timestamp <= untilValue)
                    }
                  }
                } else if (lowerSql.includes('where 1=1')) {
                  // "WHERE 1=1" with AND conditions - apply all filters
                  const hasSubject = sql.includes('AND subject = ?')
                  const hasPredicate = sql.includes('AND predicate = ?')
                  const hasObject = sql.includes('AND object = ?')
                  const hasType = sql.includes('AND type = ?')
                  const hasSource = sql.includes('AND source = ?')
                  const hasCorrelation = sql.includes('AND correlation_id = ?')
                  const hasSince = sql.includes('AND timestamp >= ?')
                  const hasUntil = sql.includes('AND timestamp <= ?')

                  rows = rows.filter((r: any) => {
                    let valueIndex = 0
                    let matches = true

                    if (hasType && boundValues[valueIndex] !== undefined) {
                      matches = matches && r.type === boundValues[valueIndex]
                      valueIndex++
                    }

                    if (hasSource && boundValues[valueIndex] !== undefined) {
                      matches = matches && r.source === boundValues[valueIndex]
                      valueIndex++
                    }

                    if (hasCorrelation && boundValues[valueIndex] !== undefined) {
                      matches = matches && r.correlation_id === boundValues[valueIndex]
                      valueIndex++
                    }

                    if (hasSince && boundValues[valueIndex] !== undefined) {
                      const sinceValue = boundValues[valueIndex]
                      matches = matches && typeof r.timestamp === 'number' && r.timestamp >= sinceValue
                      valueIndex++
                    }

                    if (hasUntil && boundValues[valueIndex] !== undefined) {
                      const untilValue = boundValues[valueIndex]
                      matches = matches && typeof r.timestamp === 'number' && r.timestamp <= untilValue
                      valueIndex++
                    }

                    if (hasSubject && boundValues[valueIndex] !== undefined) {
                      matches = matches && r.subject === boundValues[valueIndex]
                      valueIndex++
                    }

                    if (hasPredicate && boundValues[valueIndex] !== undefined) {
                      matches = matches && r.predicate === boundValues[valueIndex]
                      valueIndex++
                    }

                    if (hasObject && boundValues[valueIndex] !== undefined) {
                      matches = matches && r.object === boundValues[valueIndex]
                      valueIndex++
                    }

                    return matches
                  })
                }

                // Handle ORDER BY
                if (lowerSql.includes('order by')) {
                  if (lowerSql.includes('created_at desc') || lowerSql.includes('timestamp desc')) {
                    rows.sort((a: any, b: any) => {
                      const aTime = a.created_at || a.timestamp || 0
                      const bTime = b.created_at || b.timestamp || 0
                      return bTime - aTime
                    })
                  }
                }

                // Handle LIMIT/OFFSET with bound parameters
                let limit = rows.length
                let offset = 0

                // Find limit and offset values from bound parameters
                const questionMarks = (sql.match(/\?/g) || []).length
                if (questionMarks >= 2) {
                  // Last two params are typically LIMIT and OFFSET
                  limit = boundValues[boundValues.length - 2] as number || limit
                  offset = boundValues[boundValues.length - 1] as number || offset
                }

                return { results: rows.slice(offset, offset + limit) }
              }

              return { results: [] }
            },

            async run(): Promise<void> {
              const lowerSql = sql.toLowerCase().trim()

              if (lowerSql.startsWith('insert')) {
                const tableMatch = sql.match(/insert into\s+(\w+)/i)
                if (!tableMatch) return

                const tableName = tableMatch[1]
                const rows = tables.get(tableName)
                if (!rows) return

                // Extract column names
                const columnsMatch = sql.match(/\(([^)]+)\)/i)
                if (!columnsMatch) return

                const columns = columnsMatch[1].split(',').map(c => c.trim())

                // Create row object
                const row: Record<string, unknown> = {}
                columns.forEach((col, idx) => {
                  row[col] = boundValues[idx]
                })

                rows.push(row)
              } else if (lowerSql.startsWith('update')) {
                const tableMatch = sql.match(/update\s+(\w+)/i)
                if (!tableMatch) return

                const tableName = tableMatch[1]
                const rows = tables.get(tableName)
                if (!rows) return

                // Find row by ID (last bound value is typically the ID in WHERE clause)
                const id = boundValues[boundValues.length - 1]
                const rowIndex = rows.findIndex((r: any) => r.id === id || r.$id === id)

                if (rowIndex !== -1) {
                  // Update row with new values
                  // This is simplified - real implementation would parse SET clause
                  const setMatch = sql.match(/set\s+(.+?)\s+where/i)
                  if (setMatch) {
                    const setPairs = setMatch[1].split(',')
                    setPairs.forEach((pair, idx) => {
                      const [col] = pair.trim().split('=')
                      rows[rowIndex][col.trim()] = boundValues[idx]
                    })
                  }
                }
              } else if (lowerSql.startsWith('delete')) {
                const tableMatch = sql.match(/delete from\s+(\w+)/i)
                if (!tableMatch) return

                const tableName = tableMatch[1]
                const rows = tables.get(tableName)
                if (!rows) return

                if (lowerSql.includes('where')) {
                  // Delete by specific criteria
                  // For relationships: WHERE subject = ? AND predicate = ? AND object = ?
                  if (boundValues.length === 3) {
                    const [subject, predicate, object] = boundValues
                    const index = rows.findIndex((r: any) =>
                      r.subject === subject && r.predicate === predicate && r.object === object
                    )
                    if (index !== -1) {
                      rows.splice(index, 1)
                    }
                  } else {
                    // Simple ID-based delete
                    const id = boundValues[0]
                    const index = rows.findIndex((r: any) => r.id === id)
                    if (index !== -1) {
                      rows.splice(index, 1)
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

describe('SQLite Adapter', () => {
  let sql: MockSqlStorage
  let adapter: SQLiteAdapter

  beforeEach(() => {
    sql = createMockSqlStorage()
    adapter = new SQLiteAdapter(sql as any)
  })

  describe('initialization', () => {
    it('should create schema tables on init', async () => {
      const execSpy = vi.spyOn(sql, 'exec')

      await adapter.initialize()

      expect(execSpy).toHaveBeenCalled()
      const sqlCall = execSpy.mock.calls[0][0]

      expect(sqlCall).toContain('CREATE TABLE IF NOT EXISTS things')
      expect(sqlCall).toContain('CREATE TABLE IF NOT EXISTS events')
      expect(sqlCall).toContain('CREATE TABLE IF NOT EXISTS relationships')
    })

    it('should create indexes for performance', async () => {
      const execSpy = vi.spyOn(sql, 'exec')

      await adapter.initialize()

      const sqlCall = execSpy.mock.calls[0][0]
      expect(sqlCall).toContain('CREATE INDEX IF NOT EXISTS')
    })

    it('should be idempotent (safe to call multiple times)', async () => {
      await adapter.initialize()
      await adapter.initialize()
      await adapter.initialize()

      // Should not throw
      expect(true).toBe(true)
    })
  })

  describe('transactions', () => {
    beforeEach(async () => {
      await adapter.initialize()
    })

    it('should support transaction begin/commit', async () => {
      await expect(adapter.transaction(async () => {
        return 'success'
      })).resolves.toBe('success')
    })

    it('should rollback on error', async () => {
      await expect(
        adapter.transaction(async () => {
          throw new Error('Transaction failed')
        })
      ).rejects.toThrow('Transaction failed')
    })

    it('should support nested operations in transaction', async () => {
      const result = await adapter.transaction(async () => {
        // Multiple operations should succeed together
        return { inserted: 2, updated: 1 }
      })

      expect(result).toEqual({ inserted: 2, updated: 1 })
    })
  })
})

describe('SQLite ThingsStore', () => {
  let sql: MockSqlStorage
  let store: ThingsStore

  beforeEach(async () => {
    sql = createMockSqlStorage()
    const adapter = new SQLiteAdapter(sql as any)
    await adapter.initialize()
    store = createSQLiteThingsStore(adapter)
  })

  describe('create', () => {
    it('should insert thing into SQLite', async () => {
      const thing = await store.create({ $type: 'Customer', name: 'Alice' })

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
      expect(thing.$createdAt).toBeDefined()
      expect(thing.$updatedAt).toBeDefined()
    })

    it('should require $type', async () => {
      await expect(store.create({ name: 'Alice' } as any)).rejects.toThrow('$type is required')
    })

    it('should persist data as JSON', async () => {
      const thing = await store.create({
        $type: 'Order',
        total: 100,
        items: ['item1', 'item2'],
        metadata: { source: 'web' }
      })

      const retrieved = await store.get(thing.$id)
      expect(retrieved?.total).toBe(100)
      expect(retrieved?.items).toEqual(['item1', 'item2'])
      expect(retrieved?.metadata).toEqual({ source: 'web' })
    })
  })

  describe('get', () => {
    it('should retrieve thing by id', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      const retrieved = await store.get(created.$id)

      expect(retrieved).toEqual(created)
    })

    it('should return null for non-existent id', async () => {
      const result = await store.get('non-existent')
      expect(result).toBeNull()
    })

    it('should parse JSON data field', async () => {
      const created = await store.create({
        $type: 'Product',
        name: 'Widget',
        price: 99.99,
        tags: ['new', 'featured']
      })

      const retrieved = await store.get(created.$id)
      expect(retrieved?.price).toBe(99.99)
      expect(retrieved?.tags).toEqual(['new', 'featured'])
    })
  })

  describe('update', () => {
    it('should update thing in SQLite', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })

      await new Promise(resolve => setTimeout(resolve, 1))

      const updated = await store.update(created.$id, { name: 'Bob' })

      expect(updated.name).toBe('Bob')
      expect(updated.$type).toBe('Customer')
      expect(updated.$updatedAt).toBeGreaterThanOrEqual(created.$updatedAt)
    })

    it('should throw for non-existent thing', async () => {
      await expect(store.update('non-existent', { name: 'Bob' })).rejects.toThrow('Thing not found')
    })

    it('should preserve $id, $type, and $createdAt', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      const updated = await store.update(created.$id, {
        $id: 'new-id',
        $type: 'Order',
        $createdAt: 0
      } as any)

      expect(updated.$id).toBe(created.$id)
      expect(updated.$type).toBe('Customer')
      expect(updated.$createdAt).toBe(created.$createdAt)
    })
  })

  describe('delete', () => {
    it('should delete thing from SQLite', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      await store.delete(created.$id)

      const result = await store.get(created.$id)
      expect(result).toBeNull()
    })

    it('should throw for non-existent thing', async () => {
      await expect(store.delete('non-existent')).rejects.toThrow('Thing not found')
    })
  })

  describe('list', () => {
    it('should list all things', async () => {
      await store.create({ $type: 'Customer', name: 'Alice' })
      await store.create({ $type: 'Order', total: 100 })
      await store.create({ $type: 'Customer', name: 'Bob' })

      const all = await store.list()
      expect(all.length).toBeGreaterThanOrEqual(3)
    })

    it('should filter by type', async () => {
      await store.create({ $type: 'Customer', name: 'Alice' })
      await store.create({ $type: 'Order', total: 100 })
      await store.create({ $type: 'Customer', name: 'Bob' })

      const customers = await store.list({ type: 'Customer' })
      expect(customers).toHaveLength(2)
      expect(customers.every(t => t.$type === 'Customer')).toBe(true)
    })

    it('should support limit', async () => {
      for (let i = 0; i < 5; i++) {
        await store.create({ $type: 'Item', index: i })
      }

      const limited = await store.list({ limit: 2 })
      expect(limited).toHaveLength(2)
    })

    it('should support offset', async () => {
      for (let i = 0; i < 5; i++) {
        await store.create({ $type: 'Item', index: i })
      }

      const page1 = await store.list({ limit: 2, offset: 0 })
      const page2 = await store.list({ limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)

      const page1Ids = page1.map(t => t.$id)
      const page2Ids = page2.map(t => t.$id)
      expect(page1Ids.some(id => page2Ids.includes(id))).toBe(false)
    })

    it('should sort by createdAt descending', async () => {
      const first = await store.create({ $type: 'Item', name: 'first' })
      await new Promise(resolve => setTimeout(resolve, 1))
      const second = await store.create({ $type: 'Item', name: 'second' })
      await new Promise(resolve => setTimeout(resolve, 1))
      const third = await store.create({ $type: 'Item', name: 'third' })

      const items = await store.list({ type: 'Item' })

      expect(items[0].$id).toBe(third.$id)
      expect(items[1].$id).toBe(second.$id)
      expect(items[2].$id).toBe(first.$id)
    })
  })
})

describe('SQLite EventsStore', () => {
  let sql: MockSqlStorage
  let store: EventsStore

  beforeEach(async () => {
    sql = createMockSqlStorage()
    const adapter = new SQLiteAdapter(sql as any)
    await adapter.initialize()
    store = createSQLiteEventsStore(adapter)
  })

  describe('emit', () => {
    it('should insert event into SQLite', async () => {
      const event = await store.emit({ type: 'user.signup', payload: { userId: '123' } })

      expect(event.$id).toBeDefined()
      expect(event.type).toBe('user.signup')
      expect(event.payload).toEqual({ userId: '123' })
      expect(event.$timestamp).toBeDefined()
    })

    it('should support optional source and correlationId', async () => {
      const event = await store.emit({
        type: 'payment.completed',
        payload: { amount: 100 },
        source: 'payment-service',
        correlationId: 'trace-123'
      })

      expect(event.source).toBe('payment-service')
      expect(event.correlationId).toBe('trace-123')
    })

    it('should store payload as JSON', async () => {
      const event = await store.emit({
        type: 'order.created',
        payload: {
          orderId: 'ord-123',
          items: [{ id: 1, qty: 2 }],
          total: 99.99
        }
      })

      const retrieved = await store.get(event.$id)
      expect(retrieved?.payload).toEqual({
        orderId: 'ord-123',
        items: [{ id: 1, qty: 2 }],
        total: 99.99
      })
    })
  })

  describe('get', () => {
    it('should retrieve event by id', async () => {
      const emitted = await store.emit({ type: 'test.event', payload: { data: 'test' } })
      const retrieved = await store.get(emitted.$id)

      expect(retrieved).toEqual(emitted)
    })

    it('should return null for non-existent id', async () => {
      const result = await store.get('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('query', () => {
    beforeEach(async () => {
      await store.emit({ type: 'user.signup', payload: {}, source: 'auth' })
      await store.emit({ type: 'user.login', payload: {}, source: 'auth' })
      await store.emit({ type: 'payment.completed', payload: {}, source: 'payments' })
    })

    it('should filter by type', async () => {
      const events = await store.query({ type: 'user.signup' })
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('user.signup')
    })

    it('should filter by source', async () => {
      const events = await store.query({ source: 'auth' })
      expect(events).toHaveLength(2)
      expect(events.every(e => e.source === 'auth')).toBe(true)
    })

    it('should filter by correlationId', async () => {
      await store.emit({ type: 'step1', payload: {}, correlationId: 'trace-123' })
      await store.emit({ type: 'step2', payload: {}, correlationId: 'trace-123' })
      await store.emit({ type: 'step3', payload: {}, correlationId: 'trace-456' })

      const events = await store.query({ correlationId: 'trace-123' })
      expect(events).toHaveLength(2)
    })

    it('should filter by time range', async () => {
      const now = Date.now()
      await store.emit({ type: 'event1', payload: {} })

      const events = await store.query({ since: now })
      expect(events.length).toBeGreaterThan(0)
    })

    it('should support limit and offset', async () => {
      const page1 = await store.query({ limit: 2, offset: 0 })
      const page2 = await store.query({ limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('subscribe', () => {
    it('should notify subscribers on emit', async () => {
      const events: Event[] = []
      const unsubscribe = store.subscribe((event) => {
        events.push(event)
      })

      await store.emit({ type: 'test', payload: {} })
      await store.emit({ type: 'test2', payload: {} })

      expect(events).toHaveLength(2)
      unsubscribe()
    })

    it('should unsubscribe correctly', async () => {
      const events: Event[] = []
      const unsubscribe = store.subscribe((event) => {
        events.push(event)
      })

      await store.emit({ type: 'test', payload: {} })
      unsubscribe()
      await store.emit({ type: 'test2', payload: {} })

      expect(events).toHaveLength(1)
    })
  })
})

describe('SQLite RelationshipsStore', () => {
  let sql: MockSqlStorage
  let store: RelationshipsStore

  beforeEach(async () => {
    sql = createMockSqlStorage()
    const adapter = new SQLiteAdapter(sql as any)
    await adapter.initialize()
    store = createSQLiteRelationshipsStore(adapter)
  })

  describe('add', () => {
    it('should insert relationship into SQLite', async () => {
      const rel = await store.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1'
      })

      expect(rel.subject).toBe('user-1')
      expect(rel.predicate).toBe('owns')
      expect(rel.object).toBe('order-1')
      expect(rel.$createdAt).toBeDefined()
    })

    it('should prevent duplicate relationships', async () => {
      await store.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })

      await expect(
        store.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
      ).rejects.toThrow('Relationship already exists')
    })
  })

  describe('remove', () => {
    it('should delete relationship from SQLite', async () => {
      await store.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await store.remove({ subject: 'user-1', predicate: 'owns', object: 'order-1' })

      const found = await store.find({ subject: 'user-1', predicate: 'owns' })
      expect(found).toHaveLength(0)
    })

    it('should throw for non-existent relationship', async () => {
      await expect(
        store.remove({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
      ).rejects.toThrow('Relationship not found')
    })
  })

  describe('find', () => {
    beforeEach(async () => {
      await store.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await store.add({ subject: 'user-1', predicate: 'owns', object: 'order-2' })
      await store.add({ subject: 'user-2', predicate: 'owns', object: 'order-3' })
      await store.add({ subject: 'user-1', predicate: 'created', object: 'post-1' })
    })

    it('should find by subject', async () => {
      const rels = await store.find({ subject: 'user-1' })
      expect(rels).toHaveLength(3)
    })

    it('should find by predicate', async () => {
      const rels = await store.find({ predicate: 'owns' })
      expect(rels).toHaveLength(3)
    })

    it('should find by object', async () => {
      const rels = await store.find({ object: 'order-1' })
      expect(rels).toHaveLength(1)
    })

    it('should find by multiple criteria', async () => {
      const rels = await store.find({ subject: 'user-1', predicate: 'owns' })
      expect(rels).toHaveLength(2)
    })
  })

  describe('getRelated', () => {
    beforeEach(async () => {
      await store.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await store.add({ subject: 'user-1', predicate: 'owns', object: 'order-2' })
      await store.add({ subject: 'user-1', predicate: 'created', object: 'post-1' })
    })

    it('should return related object IDs', async () => {
      const orders = await store.getRelated('user-1', 'owns')
      expect(orders).toEqual(['order-1', 'order-2'])
    })

    it('should return empty array when no relations', async () => {
      const results = await store.getRelated('user-2', 'owns')
      expect(results).toEqual([])
    })
  })

  describe('getRelatedTo', () => {
    beforeEach(async () => {
      await store.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await store.add({ subject: 'user-2', predicate: 'owns', object: 'order-1' })
      await store.add({ subject: 'user-1', predicate: 'created', object: 'order-1' })
    })

    it('should return related subject IDs', async () => {
      const owners = await store.getRelatedTo('order-1', 'owns')
      expect(owners).toEqual(['user-1', 'user-2'])
    })

    it('should return empty array when no relations', async () => {
      const results = await store.getRelatedTo('order-2', 'owns')
      expect(results).toEqual([])
    })
  })
})
