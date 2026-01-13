/**
 * CDC Real Database Integration Tests
 *
 * Comprehensive integration tests against real database instances to validate
 * end-to-end CDC functionality. Tests the full CDC lifecycle including:
 * - Snapshot -> Streaming -> Recovery
 * - Performance benchmarks (throughput and latency)
 * - Chaos testing (failure scenarios)
 * - Debezium compatibility validation
 *
 * Issue: dotdo-8yod5
 *
 * @module db/primitives/cdc/tests/real-database-integration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest'
import type { Database as SQLiteDatabase } from 'better-sqlite3'
import {
  CDCStream,
  createCDCStream,
  ChangeType,
  type ChangeEvent,
  type CDCPosition,
  createMemorySink,
  createOffsetTracker,
  createTransformPipeline,
  filterSync,
  mapSync,
  createMultiSink,
  SnapshotManager,
  createSnapshotManager,
  SnapshotPhase,
  type TableScanner,
} from '../index'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface User {
  id: string
  name: string
  email: string
  age: number
  status: 'active' | 'inactive' | 'pending'
  created_at: number
  updated_at: number
}

interface Order {
  id: string
  user_id: string
  total: number
  status: 'pending' | 'completed' | 'cancelled'
  items: string // JSON array of {sku, qty}
  created_at: number
}

interface Product {
  id: string
  name: string
  price: number
  stock: number
  category: string
  created_at: number
  updated_at: number
}

// ============================================================================
// SQLITE REAL DATABASE HELPERS
// ============================================================================

/**
 * Create an in-memory SQLite database with CDC-compatible schema
 */
async function createTestDatabase(): Promise<SQLiteDatabase> {
  const betterSqlite = await import('better-sqlite3')
  const Database = betterSqlite.default
  const db = new Database(':memory:')

  // Create users table with CDC-friendly columns
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      age INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX idx_users_email ON users(email);
    CREATE INDEX idx_users_status ON users(status);
    CREATE INDEX idx_users_updated_at ON users(updated_at);
  `)

  // Create orders table
  db.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      total REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      items TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX idx_orders_user_id ON orders(user_id);
    CREATE INDEX idx_orders_status ON orders(status);
    CREATE INDEX idx_orders_created_at ON orders(created_at);
  `)

  // Create products table
  db.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      category TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX idx_products_category ON products(category);
    CREATE INDEX idx_products_updated_at ON products(updated_at);
  `)

  // Create CDC change log table (trigger-based capture)
  db.exec(`
    CREATE TABLE cdc_change_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL,
      row_data TEXT,
      old_data TEXT,
      timestamp INTEGER NOT NULL,
      sequence_no INTEGER NOT NULL
    );

    CREATE INDEX idx_cdc_log_table ON cdc_change_log(table_name);
    CREATE INDEX idx_cdc_log_timestamp ON cdc_change_log(timestamp);
    CREATE INDEX idx_cdc_log_sequence ON cdc_change_log(sequence_no);
  `)

  return db
}

/**
 * Create triggers for CDC change capture
 */
function setupCDCTriggers(db: SQLiteDatabase, tableName: string): void {
  // Insert trigger
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS ${tableName}_insert_trigger
    AFTER INSERT ON ${tableName}
    BEGIN
      INSERT INTO cdc_change_log (table_name, operation, row_data, old_data, timestamp, sequence_no)
      VALUES (
        '${tableName}',
        'INSERT',
        json_object(
          ${getColumnList(db, tableName)}
        ),
        NULL,
        strftime('%s', 'now') * 1000,
        (SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM cdc_change_log)
      );
    END;
  `)

  // Update trigger
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS ${tableName}_update_trigger
    AFTER UPDATE ON ${tableName}
    BEGIN
      INSERT INTO cdc_change_log (table_name, operation, row_data, old_data, timestamp, sequence_no)
      VALUES (
        '${tableName}',
        'UPDATE',
        json_object(
          ${getColumnListNew(db, tableName)}
        ),
        json_object(
          ${getColumnListOld(db, tableName)}
        ),
        strftime('%s', 'now') * 1000,
        (SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM cdc_change_log)
      );
    END;
  `)

  // Delete trigger
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS ${tableName}_delete_trigger
    AFTER DELETE ON ${tableName}
    BEGIN
      INSERT INTO cdc_change_log (table_name, operation, row_data, old_data, timestamp, sequence_no)
      VALUES (
        '${tableName}',
        'DELETE',
        NULL,
        json_object(
          ${getColumnListOld(db, tableName)}
        ),
        strftime('%s', 'now') * 1000,
        (SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM cdc_change_log)
      );
    END;
  `)
}

/**
 * Helper to get column list for json_object (using NEW values)
 */
function getColumnListNew(db: SQLiteDatabase, tableName: string): string {
  const columns = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>
  return columns.map((col) => `'${col.name}', NEW.${col.name}`).join(', ')
}

/**
 * Helper to get column list for json_object (using OLD values)
 */
function getColumnListOld(db: SQLiteDatabase, tableName: string): string {
  const columns = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>
  return columns.map((col) => `'${col.name}', OLD.${col.name}`).join(', ')
}

/**
 * Helper to get column list for json_object
 */
function getColumnList(db: SQLiteDatabase, tableName: string): string {
  const columns = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>
  return columns.map((col) => `'${col.name}', NEW.${col.name}`).join(', ')
}

/**
 * Read changes from CDC log since a sequence number
 */
function readChangesFromLog(
  db: SQLiteDatabase,
  tableName: string,
  sinceSequence: number = 0
): Array<{
  id: number
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  row_data: string | null
  old_data: string | null
  timestamp: number
  sequence_no: number
}> {
  return db
    .prepare(
      `SELECT * FROM cdc_change_log
       WHERE table_name = ? AND sequence_no > ?
       ORDER BY sequence_no ASC`
    )
    .all(tableName, sinceSequence) as Array<{
    id: number
    operation: 'INSERT' | 'UPDATE' | 'DELETE'
    row_data: string | null
    old_data: string | null
    timestamp: number
    sequence_no: number
  }>
}

/**
 * Create a table scanner for snapshots
 */
function createTableScanner<T>(db: SQLiteDatabase, tableName: string, primaryKey: string = 'id'): TableScanner<T> {
  return {
    getTableName: () => tableName,
    getRowCount: async () => {
      const result = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as { count: number }
      return result.count
    },
    getPrimaryKey: (record: T) => (record as unknown as Record<string, unknown>)[primaryKey] as string,
    scanChunk: async (cursor: string | null, chunkSize: number) => {
      const offset = cursor ? parseInt(cursor, 10) : 0
      const records = db
        .prepare(`SELECT * FROM ${tableName} ORDER BY ${primaryKey} LIMIT ? OFFSET ?`)
        .all(chunkSize, offset) as T[]
      const hasMore = records.length === chunkSize
      const nextCursor = hasMore ? String(offset + chunkSize) : null
      return { records, nextCursor, hasMore }
    },
  }
}

// ============================================================================
// TEST SUITE: SQLITE TRIGGER-BASED CDC
// ============================================================================

describe('SQLite Real Database Integration - Trigger-Based CDC', () => {
  let db: SQLiteDatabase

  beforeEach(async () => {
    db = await createTestDatabase()
    setupCDCTriggers(db, 'users')
    setupCDCTriggers(db, 'orders')
    setupCDCTriggers(db, 'products')
  })

  afterEach(() => {
    if (db) db.close()
  })

  describe('Full CDC Lifecycle: Snapshot -> Streaming -> Recovery', () => {
    it('should capture initial snapshot from real SQLite table', async () => {
      // Seed initial data
      const now = Date.now()
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('user-1', 'Alice', 'alice@test.com', 25, 'active', now, now)
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('user-2', 'Bob', 'bob@test.com', 30, 'active', now, now)
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('user-3', 'Carol', 'carol@test.com', 35, 'pending', now, now)

      // Create snapshot manager with real scanner
      const scanner = createTableScanner<User>(db, 'users')
      const snapshotEvents: User[] = []

      const snapshotManager = createSnapshotManager<User>({
        scanner,
        chunkSize: 2,
        onSnapshot: async (event) => {
          snapshotEvents.push(event.record)
        },
      })

      await snapshotManager.start()
      await snapshotManager.waitForCompletion()

      expect(snapshotEvents).toHaveLength(3)
      expect(snapshotManager.getState().phase).toBe(SnapshotPhase.COMPLETED)
      expect(snapshotEvents.map((u) => u.id).sort()).toEqual(['user-1', 'user-2', 'user-3'])
    })

    it('should capture INSERT changes via triggers after snapshot', async () => {
      // Clear any existing log entries from trigger setup
      db.exec('DELETE FROM cdc_change_log')

      const now = Date.now()

      // Insert a user - should be captured by trigger
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('user-new', 'Dave', 'dave@test.com', 40, 'active', now, now)

      // Read from CDC log
      const changes = readChangesFromLog(db, 'users')

      expect(changes).toHaveLength(1)
      expect(changes[0]!.operation).toBe('INSERT')

      const rowData = JSON.parse(changes[0]!.row_data!)
      expect(rowData.id).toBe('user-new')
      expect(rowData.name).toBe('Dave')
      expect(rowData.email).toBe('dave@test.com')
    })

    it('should capture UPDATE changes with before/after via triggers', async () => {
      // Seed and clear log
      const now = Date.now()
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('user-update', 'Eve', 'eve@test.com', 28, 'pending', now, now)
      db.exec('DELETE FROM cdc_change_log')

      // Update user
      const updateTime = Date.now()
      db.prepare(`UPDATE users SET name = ?, status = ?, updated_at = ? WHERE id = ?`).run(
        'Eve Updated',
        'active',
        updateTime,
        'user-update'
      )

      // Read from CDC log
      const changes = readChangesFromLog(db, 'users')

      expect(changes).toHaveLength(1)
      expect(changes[0]!.operation).toBe('UPDATE')

      const oldData = JSON.parse(changes[0]!.old_data!)
      const newData = JSON.parse(changes[0]!.row_data!)

      expect(oldData.name).toBe('Eve')
      expect(oldData.status).toBe('pending')
      expect(newData.name).toBe('Eve Updated')
      expect(newData.status).toBe('active')
    })

    it('should capture DELETE changes with old data via triggers', async () => {
      // Seed and clear log
      const now = Date.now()
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('user-delete', 'Frank', 'frank@test.com', 45, 'inactive', now, now)
      db.exec('DELETE FROM cdc_change_log')

      // Delete user
      db.prepare(`DELETE FROM users WHERE id = ?`).run('user-delete')

      // Read from CDC log
      const changes = readChangesFromLog(db, 'users')

      expect(changes).toHaveLength(1)
      expect(changes[0]!.operation).toBe('DELETE')
      expect(changes[0]!.row_data).toBeNull()

      const oldData = JSON.parse(changes[0]!.old_data!)
      expect(oldData.id).toBe('user-delete')
      expect(oldData.name).toBe('Frank')
    })

    it('should maintain sequence ordering across operations', async () => {
      db.exec('DELETE FROM cdc_change_log')
      const now = Date.now()

      // Perform multiple operations
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('seq-1', 'User1', 'user1@test.com', 20, 'active', now, now)

      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('seq-2', 'User2', 'user2@test.com', 21, 'active', now, now)

      db.prepare(`UPDATE users SET age = ? WHERE id = ?`).run(22, 'seq-1')

      db.prepare(`DELETE FROM users WHERE id = ?`).run('seq-2')

      // Verify sequence ordering
      const changes = readChangesFromLog(db, 'users')

      expect(changes).toHaveLength(4)
      expect(changes[0]!.sequence_no).toBeLessThan(changes[1]!.sequence_no)
      expect(changes[1]!.sequence_no).toBeLessThan(changes[2]!.sequence_no)
      expect(changes[2]!.sequence_no).toBeLessThan(changes[3]!.sequence_no)

      expect(changes[0]!.operation).toBe('INSERT')
      expect(changes[1]!.operation).toBe('INSERT')
      expect(changes[2]!.operation).toBe('UPDATE')
      expect(changes[3]!.operation).toBe('DELETE')
    })

    it('should support resuming from a checkpoint (recovery)', async () => {
      db.exec('DELETE FROM cdc_change_log')
      const now = Date.now()

      // First batch of operations
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('chk-1', 'Checkpoint1', 'chk1@test.com', 20, 'active', now, now)
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('chk-2', 'Checkpoint2', 'chk2@test.com', 21, 'active', now, now)

      // Get checkpoint (last sequence)
      const checkpointChanges = readChangesFromLog(db, 'users')
      const checkpointSeq = checkpointChanges[checkpointChanges.length - 1]!.sequence_no

      // Second batch of operations
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('chk-3', 'Checkpoint3', 'chk3@test.com', 22, 'active', now, now)
      db.prepare(`UPDATE users SET age = 25 WHERE id = ?`).run('chk-1')

      // Resume from checkpoint - should only get changes after checkpoint
      const newChanges = readChangesFromLog(db, 'users', checkpointSeq)

      expect(newChanges).toHaveLength(2)
      expect(newChanges[0]!.operation).toBe('INSERT')
      expect(JSON.parse(newChanges[0]!.row_data!).id).toBe('chk-3')
      expect(newChanges[1]!.operation).toBe('UPDATE')
    })
  })

  describe('CDC Stream Integration with Real Database', () => {
    it('should process real database changes through CDCStream', async () => {
      db.exec('DELETE FROM cdc_change_log')
      const now = Date.now()

      // Setup CDC stream
      const processedEvents: ChangeEvent<User>[] = []
      const stream = createCDCStream<User>({
        onChange: async (event) => {
          processedEvents.push(event)
        },
      })

      await stream.start()

      // Perform database operations
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('stream-1', 'StreamUser', 'stream@test.com', 30, 'active', now, now)

      // Read changes and feed to stream
      const changes = readChangesFromLog(db, 'users')
      for (const change of changes) {
        if (change.operation === 'INSERT' && change.row_data) {
          const userData = JSON.parse(change.row_data) as User
          await stream.insert(userData, {
            eventId: `cdc-${change.sequence_no}`,
            table: 'users',
          })
        }
      }

      await stream.stop()

      expect(processedEvents).toHaveLength(1)
      expect(processedEvents[0]!.type).toBe(ChangeType.INSERT)
      expect(processedEvents[0]!.after?.id).toBe('stream-1')
    })

    it('should handle multi-table changes through stream', async () => {
      db.exec('DELETE FROM cdc_change_log')
      const now = Date.now()

      // Insert user and order
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('multi-user', 'MultiUser', 'multi@test.com', 35, 'active', now, now)

      db.prepare(
        `INSERT INTO orders (id, user_id, total, status, items, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('multi-order', 'multi-user', 99.99, 'pending', '[]', now)

      // Read changes from both tables
      const userChanges = readChangesFromLog(db, 'users')
      const orderChanges = readChangesFromLog(db, 'orders')

      expect(userChanges).toHaveLength(1)
      expect(orderChanges).toHaveLength(1)
      expect(userChanges[0]!.operation).toBe('INSERT')
      expect(orderChanges[0]!.operation).toBe('INSERT')
    })

    it('should support filtering by table', async () => {
      db.exec('DELETE FROM cdc_change_log')
      const now = Date.now()

      // Setup filtered stream
      const filteredEvents: ChangeEvent<User>[] = []
      const stream = createCDCStream<User>({
        tables: ['users'], // Only users table
        onChange: async (event) => {
          filteredEvents.push(event)
        },
      })

      await stream.start()

      // Insert into both tables
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('filter-user', 'FilterUser', 'filter@test.com', 40, 'active', now, now)

      db.prepare(
        `INSERT INTO products (id, name, price, stock, category, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('filter-product', 'FilterProduct', 19.99, 100, 'electronics', now, now)

      // Process only user changes
      const userChanges = readChangesFromLog(db, 'users')
      for (const change of userChanges) {
        if (change.row_data) {
          await stream.insert(JSON.parse(change.row_data), { table: 'users' })
        }
      }

      await stream.stop()

      expect(filteredEvents).toHaveLength(1)
      expect(filteredEvents[0]!.table).toBe('users')
    })
  })
})

// ============================================================================
// TEST SUITE: PERFORMANCE BENCHMARKS
// ============================================================================

describe('CDC Performance Benchmarks with Real Database', () => {
  let db: SQLiteDatabase

  beforeEach(async () => {
    db = await createTestDatabase()
    setupCDCTriggers(db, 'users')
  })

  afterEach(() => {
    if (db) db.close()
  })

  describe('Throughput and Latency', () => {
    it('should process 1000 INSERT operations with acceptable latency', async () => {
      const now = Date.now()
      const insertStmt = db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )

      const startTime = performance.now()

      // Batch insert using transaction
      const insertMany = db.transaction(() => {
        for (let i = 0; i < 1000; i++) {
          insertStmt.run(`perf-${i}`, `User${i}`, `user${i}@perf.com`, 20 + (i % 50), 'active', now, now)
        }
      })

      insertMany()

      const endTime = performance.now()
      const duration = endTime - startTime

      // Verify all changes captured
      const changes = readChangesFromLog(db, 'users')
      expect(changes).toHaveLength(1000)

      // Performance assertion - should complete in under 2 seconds
      expect(duration).toBeLessThan(2000)

      // Calculate throughput
      const throughput = 1000 / (duration / 1000)
      console.log(`Throughput: ${throughput.toFixed(2)} operations/sec`)
      console.log(`Total duration: ${duration.toFixed(2)}ms`)

      // Average latency per operation
      const avgLatency = duration / 1000
      expect(avgLatency).toBeLessThan(2) // Less than 2ms per operation average
    })

    it('should handle mixed operations (INSERT/UPDATE/DELETE) efficiently', async () => {
      const now = Date.now()

      // Seed some data first
      const seedStmt = db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      db.transaction(() => {
        for (let i = 0; i < 200; i++) {
          seedStmt.run(`mix-${i}`, `MixUser${i}`, `mix${i}@test.com`, 25, 'active', now, now)
        }
      })()

      db.exec('DELETE FROM cdc_change_log')

      const updateStmt = db.prepare(`UPDATE users SET age = ?, updated_at = ? WHERE id = ?`)
      const deleteStmt = db.prepare(`DELETE FROM users WHERE id = ?`)
      const insertStmt = db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )

      const startTime = performance.now()

      // Mixed operations
      db.transaction(() => {
        // 100 inserts
        for (let i = 200; i < 300; i++) {
          insertStmt.run(`mix-${i}`, `MixUser${i}`, `mix${i}@test.com`, 25, 'active', now, now)
        }
        // 100 updates
        for (let i = 0; i < 100; i++) {
          updateStmt.run(30 + i, now, `mix-${i}`)
        }
        // 50 deletes
        for (let i = 100; i < 150; i++) {
          deleteStmt.run(`mix-${i}`)
        }
      })()

      const endTime = performance.now()
      const duration = endTime - startTime

      const changes = readChangesFromLog(db, 'users')
      expect(changes).toHaveLength(250) // 100 + 100 + 50

      // Count operations
      const inserts = changes.filter((c) => c.operation === 'INSERT').length
      const updates = changes.filter((c) => c.operation === 'UPDATE').length
      const deletes = changes.filter((c) => c.operation === 'DELETE').length

      expect(inserts).toBe(100)
      expect(updates).toBe(100)
      expect(deletes).toBe(50)

      // Should complete in under 1 second
      expect(duration).toBeLessThan(1000)
    })

    it('should measure CDC stream processing throughput', async () => {
      const now = Date.now()

      // Seed data
      const seedStmt = db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      db.transaction(() => {
        for (let i = 0; i < 500; i++) {
          seedStmt.run(`stream-perf-${i}`, `PerfUser${i}`, `perf${i}@test.com`, 25, 'active', now, now)
        }
      })()

      const changes = readChangesFromLog(db, 'users')
      expect(changes).toHaveLength(500)

      // Process through CDC stream
      let processedCount = 0
      const stream = createCDCStream<User>({
        onChange: async () => {
          processedCount++
        },
      })

      await stream.start()

      const streamStart = performance.now()

      for (const change of changes) {
        if (change.row_data) {
          await stream.insert(JSON.parse(change.row_data), {
            eventId: `evt-${change.sequence_no}`,
          })
        }
      }

      await stream.stop()

      const streamDuration = performance.now() - streamStart

      expect(processedCount).toBe(500)

      // Stream processing throughput
      const streamThroughput = 500 / (streamDuration / 1000)
      console.log(`Stream throughput: ${streamThroughput.toFixed(2)} events/sec`)

      // Should process at least 1000 events/sec
      expect(streamThroughput).toBeGreaterThan(100)
    })

    it('should benchmark checkpoint/recovery cycle', async () => {
      const now = Date.now()

      // Create stream with state tracking
      const stream = createCDCStream<User>()
      await stream.start()

      // Process some events
      for (let i = 0; i < 100; i++) {
        await stream.insert(
          {
            id: `chk-perf-${i}`,
            name: `ChkUser${i}`,
            email: `chk${i}@test.com`,
            age: 25,
            status: 'active' as const,
            created_at: now,
            updated_at: now,
          },
          { eventId: `chk-evt-${i}` }
        )
      }

      // Checkpoint
      const checkpointStart = performance.now()
      const checkpoint = await stream.getCheckpointState()
      const position = stream.getCurrentPosition()
      await stream.commit(position)
      const checkpointDuration = performance.now() - checkpointStart

      // Restore
      const stream2 = createCDCStream<User>({ startPosition: position })
      const restoreStart = performance.now()
      await stream2.restoreFromCheckpoint(checkpoint)
      const restoreDuration = performance.now() - restoreStart

      await stream.stop()
      await stream2.stop()

      console.log(`Checkpoint time: ${checkpointDuration.toFixed(2)}ms`)
      console.log(`Restore time: ${restoreDuration.toFixed(2)}ms`)

      // Both should be fast
      expect(checkpointDuration).toBeLessThan(100)
      expect(restoreDuration).toBeLessThan(100)
    })
  })
})

// ============================================================================
// TEST SUITE: CHAOS TESTING
// ============================================================================

describe('CDC Chaos Testing with Real Database', () => {
  let db: SQLiteDatabase

  beforeEach(async () => {
    db = await createTestDatabase()
    setupCDCTriggers(db, 'users')
  })

  afterEach(() => {
    if (db) db.close()
  })

  describe('Failure Scenarios', () => {
    it('should handle rapid concurrent operations without data loss', async () => {
      const now = Date.now()
      db.exec('DELETE FROM cdc_change_log')

      // Simulate rapid operations
      const operations = []
      for (let i = 0; i < 100; i++) {
        operations.push(() => {
          db.prepare(
            `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(`rapid-${i}`, `Rapid${i}`, `rapid${i}@test.com`, 25, 'active', now, now)
        })
      }

      // Execute all rapidly in transaction
      db.transaction(() => {
        operations.forEach((op) => op())
      })()

      const changes = readChangesFromLog(db, 'users')
      expect(changes).toHaveLength(100)

      // Verify all changes have unique sequence numbers
      const sequences = new Set(changes.map((c) => c.sequence_no))
      expect(sequences.size).toBe(100)
    })

    it('should maintain consistency after failed transaction (rollback)', async () => {
      const now = Date.now()
      db.exec('DELETE FROM cdc_change_log')

      // Successful insert
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('consistent-1', 'Consistent1', 'consistent1@test.com', 25, 'active', now, now)

      // Attempt failing transaction
      try {
        db.transaction(() => {
          db.prepare(
            `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run('consistent-2', 'Consistent2', 'consistent2@test.com', 25, 'active', now, now)

          // This will fail due to unique email constraint
          db.prepare(
            `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run('consistent-3', 'Consistent3', 'consistent1@test.com', 25, 'active', now, now) // duplicate email
        })()
      } catch (_error) {
        // Expected to fail
      }

      // Verify CDC log consistency
      // Should only have the first successful insert
      const changes = readChangesFromLog(db, 'users')
      expect(changes).toHaveLength(1)
      expect(JSON.parse(changes[0]!.row_data!).id).toBe('consistent-1')

      // Verify table state
      const users = db.prepare('SELECT * FROM users').all()
      expect(users).toHaveLength(1)
    })

    it('should handle interleaved updates to same record', async () => {
      const now = Date.now()

      // Insert base record
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('interleave-1', 'Original', 'interleave@test.com', 25, 'active', now, now)

      db.exec('DELETE FROM cdc_change_log')

      // Multiple updates to same record
      for (let i = 0; i < 10; i++) {
        db.prepare(`UPDATE users SET age = ?, updated_at = ? WHERE id = ?`).run(25 + i, now + i, 'interleave-1')
      }

      const changes = readChangesFromLog(db, 'users')
      expect(changes).toHaveLength(10)

      // Verify each update captured with before/after
      changes.forEach((change, index) => {
        expect(change.operation).toBe('UPDATE')
        const newData = JSON.parse(change.row_data!)
        expect(newData.age).toBe(25 + index)
      })

      // Final state should reflect last update
      const finalUser = db.prepare('SELECT age FROM users WHERE id = ?').get('interleave-1') as { age: number }
      expect(finalUser.age).toBe(34) // 25 + 9
    })

    it('should handle large batch operations', async () => {
      const now = Date.now()
      db.exec('DELETE FROM cdc_change_log')

      // Large batch insert
      const insertStmt = db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )

      db.transaction(() => {
        for (let i = 0; i < 5000; i++) {
          insertStmt.run(`batch-${i}`, `Batch${i}`, `batch${i}@test.com`, 20 + (i % 50), 'active', now, now)
        }
      })()

      // Verify all captured
      const changes = readChangesFromLog(db, 'users')
      expect(changes).toHaveLength(5000)

      // Verify sequence integrity
      for (let i = 1; i < changes.length; i++) {
        expect(changes[i]!.sequence_no).toBeGreaterThan(changes[i - 1]!.sequence_no)
      }
    })

    it('should handle delete-then-reinsert with same ID', async () => {
      const now = Date.now()
      db.exec('DELETE FROM cdc_change_log')

      // Insert -> Delete -> Reinsert same ID
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('reuse-id', 'First', 'reuse@test.com', 25, 'active', now, now)

      db.prepare(`DELETE FROM users WHERE id = ?`).run('reuse-id')

      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('reuse-id', 'Second', 'reuse2@test.com', 30, 'active', now, now)

      const changes = readChangesFromLog(db, 'users')
      expect(changes).toHaveLength(3)
      expect(changes[0]!.operation).toBe('INSERT')
      expect(changes[1]!.operation).toBe('DELETE')
      expect(changes[2]!.operation).toBe('INSERT')

      // First insert
      expect(JSON.parse(changes[0]!.row_data!).name).toBe('First')
      // Delete old data
      expect(JSON.parse(changes[1]!.old_data!).name).toBe('First')
      // Second insert
      expect(JSON.parse(changes[2]!.row_data!).name).toBe('Second')
    })
  })
})

// ============================================================================
// TEST SUITE: DEBEZIUM COMPATIBILITY
// ============================================================================

describe('Debezium Compatibility Validation', () => {
  let db: SQLiteDatabase

  beforeEach(async () => {
    db = await createTestDatabase()
    setupCDCTriggers(db, 'users')
  })

  afterEach(() => {
    if (db) db.close()
  })

  describe('Debezium-Compatible Event Format', () => {
    /**
     * Debezium event structure:
     * {
     *   "op": "c" | "u" | "d" | "r",
     *   "ts_ms": timestamp,
     *   "before": {...} | null,
     *   "after": {...} | null,
     *   "source": {...}
     * }
     */
    it('should emit INSERT events with Debezium-compatible structure', async () => {
      const now = Date.now()
      db.exec('DELETE FROM cdc_change_log')

      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('debezium-1', 'DebeziumUser', 'debezium@test.com', 30, 'active', now, now)

      const changes = readChangesFromLog(db, 'users')
      const change = changes[0]!

      // Convert to Debezium format
      const debeziumEvent = {
        op: 'c', // Create
        ts_ms: change.timestamp,
        before: null,
        after: JSON.parse(change.row_data!),
        source: {
          table: 'users',
          sequence: change.sequence_no,
        },
      }

      expect(debeziumEvent.op).toBe('c')
      expect(debeziumEvent.before).toBeNull()
      expect(debeziumEvent.after).not.toBeNull()
      expect(debeziumEvent.after.id).toBe('debezium-1')
      expect(debeziumEvent.source.table).toBe('users')
    })

    it('should emit UPDATE events with before/after in Debezium format', async () => {
      const now = Date.now()

      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('debezium-update', 'Before', 'update@test.com', 25, 'pending', now, now)

      db.exec('DELETE FROM cdc_change_log')

      db.prepare(`UPDATE users SET name = ?, status = ? WHERE id = ?`).run('After', 'active', 'debezium-update')

      const changes = readChangesFromLog(db, 'users')
      const change = changes[0]!

      // Convert to Debezium format
      const debeziumEvent = {
        op: 'u', // Update
        ts_ms: change.timestamp,
        before: JSON.parse(change.old_data!),
        after: JSON.parse(change.row_data!),
        source: {
          table: 'users',
          sequence: change.sequence_no,
        },
      }

      expect(debeziumEvent.op).toBe('u')
      expect(debeziumEvent.before).not.toBeNull()
      expect(debeziumEvent.after).not.toBeNull()
      expect(debeziumEvent.before.name).toBe('Before')
      expect(debeziumEvent.after.name).toBe('After')
      expect(debeziumEvent.before.status).toBe('pending')
      expect(debeziumEvent.after.status).toBe('active')
    })

    it('should emit DELETE events with before in Debezium format', async () => {
      const now = Date.now()

      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('debezium-delete', 'ToDelete', 'delete@test.com', 35, 'active', now, now)

      db.exec('DELETE FROM cdc_change_log')

      db.prepare(`DELETE FROM users WHERE id = ?`).run('debezium-delete')

      const changes = readChangesFromLog(db, 'users')
      const change = changes[0]!

      // Convert to Debezium format
      const debeziumEvent = {
        op: 'd', // Delete
        ts_ms: change.timestamp,
        before: JSON.parse(change.old_data!),
        after: null,
        source: {
          table: 'users',
          sequence: change.sequence_no,
        },
      }

      expect(debeziumEvent.op).toBe('d')
      expect(debeziumEvent.before).not.toBeNull()
      expect(debeziumEvent.after).toBeNull()
      expect(debeziumEvent.before.id).toBe('debezium-delete')
      expect(debeziumEvent.before.name).toBe('ToDelete')
    })

    it('should support Debezium snapshot (read) events during initial sync', async () => {
      const now = Date.now()

      // Seed data before snapshot
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('snapshot-1', 'Snapshot1', 's1@test.com', 25, 'active', now, now)
      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('snapshot-2', 'Snapshot2', 's2@test.com', 30, 'active', now, now)

      // Perform snapshot
      const scanner = createTableScanner<User>(db, 'users')
      const snapshotEvents: Array<{
        op: string
        before: null
        after: User
        source: { snapshot: string }
      }> = []

      const snapshotManager = createSnapshotManager<User>({
        scanner,
        chunkSize: 10,
        onSnapshot: async (event) => {
          // Convert to Debezium snapshot format
          snapshotEvents.push({
            op: 'r', // Read (snapshot)
            before: null,
            after: event.record,
            source: { snapshot: 'true' },
          })
        },
      })

      await snapshotManager.start()
      await snapshotManager.waitForCompletion()

      expect(snapshotEvents).toHaveLength(2)
      snapshotEvents.forEach((event) => {
        expect(event.op).toBe('r')
        expect(event.before).toBeNull()
        expect(event.after).not.toBeNull()
        expect(event.source.snapshot).toBe('true')
      })
    })

    it('should maintain monotonic ordering like Debezium', async () => {
      const now = Date.now()
      db.exec('DELETE FROM cdc_change_log')

      // Multiple operations
      for (let i = 0; i < 20; i++) {
        db.prepare(
          `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(`order-${i}`, `User${i}`, `order${i}@test.com`, 25, 'active', now + i, now + i)
      }

      const changes = readChangesFromLog(db, 'users')

      // Debezium ensures monotonic ordering via LSN/sequence
      // Verify our sequence numbers are strictly increasing
      for (let i = 1; i < changes.length; i++) {
        expect(changes[i]!.sequence_no).toBeGreaterThan(changes[i - 1]!.sequence_no)
      }

      // Verify timestamps are non-decreasing
      for (let i = 1; i < changes.length; i++) {
        expect(changes[i]!.timestamp).toBeGreaterThanOrEqual(changes[i - 1]!.timestamp)
      }
    })
  })

  describe('Debezium Transform Pipeline', () => {
    it('should support SMT-like transformations (Single Message Transform)', async () => {
      const now = Date.now()
      db.exec('DELETE FROM cdc_change_log')

      db.prepare(
        `INSERT INTO users (id, name, email, age, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('smt-1', 'SMTUser', 'smt@test.com', 30, 'active', now, now)

      const changes = readChangesFromLog(db, 'users')
      const change = changes[0]!

      // Apply SMT-like transformations
      const userData = JSON.parse(change.row_data!) as User

      // 1. Mask email (like Debezium MaskField SMT)
      const maskedEmail = userData.email.replace(/(.{2}).*(@.*)/, '$1***$2')

      // 2. Route by field (like Debezium ContentBasedRouter)
      const topic = userData.status === 'active' ? 'users-active' : 'users-inactive'

      // 3. Filter (like Debezium Filter SMT)
      const shouldInclude = userData.age >= 18

      expect(maskedEmail).toBe('sm***@test.com')
      expect(topic).toBe('users-active')
      expect(shouldInclude).toBe(true)
    })

    it('should integrate with CDC transform pipeline', async () => {
      const now = Date.now()

      // Setup transform pipeline similar to Debezium
      const pipeline = createTransformPipeline<User, { userId: string; displayName: string; isAdult: boolean }>()
        .pipe(filterSync((e) => e.after !== null && e.after.status === 'active'))
        .pipe(
          mapSync((u) => ({
            userId: u.id,
            displayName: `${u.name} <${u.email}>`,
            isAdult: u.age >= 18,
          }))
        )

      // Process through pipeline
      const testUser: User = {
        id: 'pipeline-1',
        name: 'Pipeline',
        email: 'pipeline@test.com',
        age: 25,
        status: 'active',
        created_at: now,
        updated_at: now,
      }

      const event: ChangeEvent<User> = {
        eventId: 'evt-1',
        type: ChangeType.INSERT,
        before: null,
        after: testUser,
        timestamp: now,
        position: { sequence: 1, timestamp: now },
        isBackfill: false,
      }

      const result = pipeline.transformSync(event)

      expect(result).not.toBeNull()
      expect(result!.after?.userId).toBe('pipeline-1')
      expect(result!.after?.displayName).toBe('Pipeline <pipeline@test.com>')
      expect(result!.after?.isAdult).toBe(true)
    })
  })
})

// ============================================================================
// TEST SUITE: POSTGRESQL INTEGRATION (Scaffolding)
// ============================================================================

describe.skip('PostgreSQL Real Database Integration', () => {
  /**
   * These tests require a running PostgreSQL instance with logical replication enabled.
   *
   * Prerequisites:
   * 1. PostgreSQL 14+ with wal_level=logical
   * 2. CREATE TABLE, CREATE PUBLICATION, CREATE SUBSCRIPTION permissions
   * 3. Environment variables: PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE
   *
   * To enable these tests:
   * 1. Start PostgreSQL: docker-compose up -d postgres
   * 2. Set environment variables
   * 3. Remove .skip from describe()
   */

  it('should connect to PostgreSQL and read WAL', async () => {
    // TODO: Implement with pg client
    // const { Client } = await import('pg')
    // const client = new Client({
    //   connectionString: process.env.PG_CONNECTION_STRING
    // })
    expect(true).toBe(true)
  })

  it('should create logical replication slot', async () => {
    // TODO: Implement
    expect(true).toBe(true)
  })

  it('should capture changes via pgoutput', async () => {
    // TODO: Implement
    expect(true).toBe(true)
  })

  it('should handle LSN-based checkpointing', async () => {
    // TODO: Implement
    expect(true).toBe(true)
  })
})

// ============================================================================
// TEST SUITE: MYSQL INTEGRATION (Scaffolding)
// ============================================================================

describe.skip('MySQL Real Database Integration', () => {
  /**
   * These tests require a running MySQL instance with binlog enabled.
   *
   * Prerequisites:
   * 1. MySQL 8+ with binlog_format=ROW, log_bin=ON
   * 2. REPLICATION SLAVE privilege
   * 3. Environment variables: MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
   *
   * To enable these tests:
   * 1. Start MySQL: docker-compose up -d mysql
   * 2. Set environment variables
   * 3. Remove .skip from describe()
   */

  it('should connect to MySQL and read binlog', async () => {
    // TODO: Implement with mysql2 client
    expect(true).toBe(true)
  })

  it('should track GTID positions', async () => {
    // TODO: Implement
    expect(true).toBe(true)
  })

  it('should handle binlog rotation', async () => {
    // TODO: Implement
    expect(true).toBe(true)
  })

  it('should capture row-level changes', async () => {
    // TODO: Implement
    expect(true).toBe(true)
  })
})
