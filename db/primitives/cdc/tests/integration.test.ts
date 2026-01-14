/**
 * CDC Integration Tests
 *
 * End-to-end integration tests with simulated real database scenarios.
 * Tests the full CDC pipeline from capture to transformation to delivery.
 *
 * Covers:
 * - PostgreSQL logical replication simulation
 * - MySQL binlog parsing simulation
 * - SQLite WAL change tracking
 * - Full lifecycle: snapshot -> streaming -> recovery
 * - Debezium-compatible event format validation
 * - Performance benchmarks
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  // Stream
  CDCStream,
  createCDCStream,
  ChangeType,
  type ChangeEvent,
  type CDCPosition,
  // WAL Readers
  PostgresWALReader,
  createPostgresWALReader,
  MySQLBinlogReader,
  createMySQLBinlogReader,
  SQLiteChangeCapture,
  createSQLiteChangeCapture,
  WALOperationType,
  type WALEntry,
  type WALPosition,
  type PgOutputMessage,
  type BinlogEvent,
  type SQLiteChange,
  // Snapshot
  SnapshotManager,
  createSnapshotManager,
  SnapshotPhase,
  type TableScanner,
  type SnapshotEvent,
  // Transform
  createTransformPipeline,
  filter,
  filterSync,
  map,
  mapSync,
  project,
  enrich,
  // Sink
  createMemorySink,
  createMultiSink,
  createQueueSink,
  MemorySink,
  // Offset Tracker
  createOffsetTracker,
  type Offset,
  // Capture
  createPollingCapture,
  createLogCapture,
  createEventCapture,
  type CapturedChange,
} from '../index'

// ============================================================================
// TEST FIXTURES & HELPERS
// ============================================================================

interface User {
  id: string
  name: string
  email: string
  age: number
  created_at: number
  updated_at: number
}

interface Order {
  id: string
  user_id: string
  total: number
  status: 'pending' | 'completed' | 'cancelled'
  items: { sku: string; qty: number }[]
  created_at: number
}

interface Product {
  id: string
  name: string
  price: number
  stock: number
  category: string
}

/**
 * PostgreSQL Database Simulator
 * Simulates PostgreSQL logical replication messages
 */
class PostgresDatabaseSimulator {
  private tables: Map<string, Map<string, unknown>> = new Map()
  private walMessages: PgOutputMessage[] = []
  private currentLsn: number = 0
  private currentXid: number = 1000

  constructor() {
    this.tables.set('users', new Map())
    this.tables.set('orders', new Map())
    this.tables.set('products', new Map())
  }

  /**
   * Execute INSERT and generate WAL message
   */
  async insert<T extends { id: string }>(table: string, record: T): Promise<void> {
    const tableData = this.tables.get(table)
    if (!tableData) throw new Error(`Table ${table} not found`)

    tableData.set(record.id, record)

    this.currentLsn += 1000
    this.walMessages.push({
      type: 'insert',
      relation: { schema: 'public', table },
      tuple: record as Record<string, unknown>,
      lsn: this.formatLsn(this.currentLsn),
    })
  }

  /**
   * Execute UPDATE and generate WAL message
   */
  async update<T extends { id: string }>(table: string, id: string, updates: Partial<T>): Promise<void> {
    const tableData = this.tables.get(table)
    if (!tableData) throw new Error(`Table ${table} not found`)

    const oldRecord = tableData.get(id) as T | undefined
    if (!oldRecord) throw new Error(`Record ${id} not found in ${table}`)

    const newRecord = { ...oldRecord, ...updates }
    tableData.set(id, newRecord)

    this.currentLsn += 1000
    this.walMessages.push({
      type: 'update',
      relation: { schema: 'public', table },
      oldTuple: oldRecord as Record<string, unknown>,
      newTuple: newRecord as Record<string, unknown>,
      lsn: this.formatLsn(this.currentLsn),
    })
  }

  /**
   * Execute DELETE and generate WAL message
   */
  async delete(table: string, id: string): Promise<void> {
    const tableData = this.tables.get(table)
    if (!tableData) throw new Error(`Table ${table} not found`)

    const record = tableData.get(id)
    if (!record) throw new Error(`Record ${id} not found in ${table}`)

    tableData.delete(id)

    this.currentLsn += 1000
    this.walMessages.push({
      type: 'delete',
      relation: { schema: 'public', table },
      oldTuple: record as Record<string, unknown>,
      lsn: this.formatLsn(this.currentLsn),
    })
  }

  /**
   * Execute transaction with multiple operations
   */
  async transaction(operations: Array<() => Promise<void>>): Promise<void> {
    this.currentXid++
    const xid = this.currentXid

    // Begin
    this.currentLsn += 100
    this.walMessages.push({
      type: 'begin',
      xid,
      lsn: this.formatLsn(this.currentLsn),
    })

    // Execute operations
    for (const op of operations) {
      await op()
    }

    // Commit
    this.currentLsn += 100
    this.walMessages.push({
      type: 'commit',
      xid,
      lsn: this.formatLsn(this.currentLsn),
    })
  }

  /**
   * Get all WAL messages since a position
   */
  getWalMessagesSince(lsn?: string): PgOutputMessage[] {
    if (!lsn) return this.walMessages

    const lsnNum = this.parseLsn(lsn)
    return this.walMessages.filter((msg) => this.parseLsn(msg.lsn) > lsnNum)
  }

  /**
   * Get current WAL position
   */
  getCurrentLsn(): string {
    return this.formatLsn(this.currentLsn)
  }

  /**
   * Get table scanner for snapshots
   */
  getTableScanner<T>(tableName: string): TableScanner<T> {
    const tableData = this.tables.get(tableName)
    if (!tableData) throw new Error(`Table ${tableName} not found`)

    const records = Array.from(tableData.values()) as T[]

    return {
      getTableName: () => tableName,
      getRowCount: async () => records.length,
      getPrimaryKey: (record: T) => (record as unknown as { id: string }).id,
      scanChunk: async (cursor: string | null, chunkSize: number) => {
        const startIndex = cursor ? parseInt(cursor, 10) : 0
        const chunk = records.slice(startIndex, startIndex + chunkSize)
        const hasMore = startIndex + chunkSize < records.length
        const nextCursor = hasMore ? String(startIndex + chunkSize) : null

        return { records: chunk, nextCursor, hasMore }
      },
    }
  }

  /**
   * Seed table with initial data
   */
  async seedTable<T extends { id: string }>(tableName: string, records: T[]): Promise<void> {
    const tableData = this.tables.get(tableName)
    if (!tableData) throw new Error(`Table ${tableName} not found`)

    for (const record of records) {
      tableData.set(record.id, record)
    }
  }

  /**
   * Clear WAL messages (for testing)
   */
  clearWalMessages(): void {
    this.walMessages = []
  }

  private formatLsn(num: number): string {
    const high = Math.floor(num / 0x100000000)
    const low = num % 0x100000000
    return `${high.toString(16).toUpperCase()}/${low.toString(16).toUpperCase().padStart(8, '0')}`
  }

  private parseLsn(lsn: string): number {
    const [high, low] = lsn.split('/')
    return parseInt(high!, 16) * 0x100000000 + parseInt(low!, 16)
  }
}

/**
 * MySQL Database Simulator
 * Simulates MySQL binlog events
 */
class MySQLDatabaseSimulator {
  private tables: Map<string, Map<string, unknown>> = new Map()
  private binlogEvents: BinlogEvent[] = []
  private currentFile: string = 'mysql-bin.000001'
  private currentPosition: number = 4
  private currentGtidTxn: number = 0
  private serverUuid: string = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  constructor() {
    this.tables.set('users', new Map())
    this.tables.set('orders', new Map())
    this.tables.set('products', new Map())
  }

  /**
   * Execute INSERT and generate binlog event
   */
  async insert<T extends { id: string }>(schema: string, table: string, record: T): Promise<void> {
    const tableData = this.tables.get(table)
    if (!tableData) throw new Error(`Table ${table} not found`)

    tableData.set(record.id, record)
    this.currentPosition += 100

    // GTID event
    this.currentGtidTxn++
    this.binlogEvents.push({
      type: 'GTID',
      gtid: { uuid: this.serverUuid, transactionId: this.currentGtidTxn },
      position: { filename: this.currentFile, position: this.currentPosition },
      timestamp: Date.now(),
    })

    this.currentPosition += 50
    this.binlogEvents.push({
      type: 'WRITE_ROWS',
      schema,
      table,
      rows: [record as Record<string, unknown>],
      position: { filename: this.currentFile, position: this.currentPosition },
      timestamp: Date.now(),
      gtid: { uuid: this.serverUuid, transactionId: this.currentGtidTxn },
    })
  }

  /**
   * Execute UPDATE and generate binlog event
   */
  async update<T extends { id: string }>(
    schema: string,
    table: string,
    id: string,
    updates: Partial<T>
  ): Promise<void> {
    const tableData = this.tables.get(table)
    if (!tableData) throw new Error(`Table ${table} not found`)

    const oldRecord = tableData.get(id) as T | undefined
    if (!oldRecord) throw new Error(`Record ${id} not found in ${table}`)

    const newRecord = { ...oldRecord, ...updates }
    tableData.set(id, newRecord)
    this.currentPosition += 100

    this.currentGtidTxn++
    this.binlogEvents.push({
      type: 'GTID',
      gtid: { uuid: this.serverUuid, transactionId: this.currentGtidTxn },
      position: { filename: this.currentFile, position: this.currentPosition },
      timestamp: Date.now(),
    })

    this.currentPosition += 50
    this.binlogEvents.push({
      type: 'UPDATE_ROWS',
      schema,
      table,
      rows: [{ before: oldRecord as Record<string, unknown>, after: newRecord as Record<string, unknown> }],
      position: { filename: this.currentFile, position: this.currentPosition },
      timestamp: Date.now(),
      gtid: { uuid: this.serverUuid, transactionId: this.currentGtidTxn },
    })
  }

  /**
   * Execute DELETE and generate binlog event
   */
  async delete(schema: string, table: string, id: string): Promise<void> {
    const tableData = this.tables.get(table)
    if (!tableData) throw new Error(`Table ${table} not found`)

    const record = tableData.get(id)
    if (!record) throw new Error(`Record ${id} not found in ${table}`)

    tableData.delete(id)
    this.currentPosition += 100

    this.currentGtidTxn++
    this.binlogEvents.push({
      type: 'GTID',
      gtid: { uuid: this.serverUuid, transactionId: this.currentGtidTxn },
      position: { filename: this.currentFile, position: this.currentPosition },
      timestamp: Date.now(),
    })

    this.currentPosition += 50
    this.binlogEvents.push({
      type: 'DELETE_ROWS',
      schema,
      table,
      rows: [record as Record<string, unknown>],
      position: { filename: this.currentFile, position: this.currentPosition },
      timestamp: Date.now(),
      gtid: { uuid: this.serverUuid, transactionId: this.currentGtidTxn },
    })
  }

  /**
   * Rotate binlog file
   */
  rotateBinlog(): void {
    const fileNum = parseInt(this.currentFile.split('.')[1]!, 10)
    const newFile = `mysql-bin.${String(fileNum + 1).padStart(6, '0')}`

    this.binlogEvents.push({
      type: 'ROTATE',
      nextFile: newFile,
      position: { filename: this.currentFile, position: this.currentPosition },
      timestamp: Date.now(),
    })

    this.currentFile = newFile
    this.currentPosition = 4
  }

  /**
   * Get binlog events
   */
  getBinlogEvents(): BinlogEvent[] {
    return this.binlogEvents
  }

  /**
   * Get current position
   */
  getCurrentPosition(): { file: string; position: number; gtid: number } {
    return {
      file: this.currentFile,
      position: this.currentPosition,
      gtid: this.currentGtidTxn,
    }
  }

  /**
   * Seed table with initial data
   */
  async seedTable<T extends { id: string }>(tableName: string, records: T[]): Promise<void> {
    const tableData = this.tables.get(tableName)
    if (!tableData) throw new Error(`Table ${tableName} not found`)

    for (const record of records) {
      tableData.set(record.id, record)
    }
  }
}

/**
 * SQLite Database Simulator
 * Simulates SQLite trigger-based change capture
 */
class SQLiteDatabaseSimulator {
  private tables: Map<string, Map<string, unknown>> = new Map()
  private changes: SQLiteChange<unknown>[] = []
  private currentRowid: number = 0
  private sessionId: string = `session-${Date.now()}`

  constructor() {
    this.tables.set('users', new Map())
    this.tables.set('orders', new Map())
    this.tables.set('products', new Map())
  }

  /**
   * Execute INSERT and generate change
   */
  async insert<T extends { id: string }>(table: string, record: T): Promise<void> {
    const tableData = this.tables.get(table)
    if (!tableData) throw new Error(`Table ${table} not found`)

    tableData.set(record.id, record)
    this.currentRowid++

    this.changes.push({
      operation: 'INSERT',
      rowid: this.currentRowid,
      before: null,
      after: record,
      timestamp: Date.now(),
      sessionId: this.sessionId,
    })
  }

  /**
   * Execute UPDATE and generate change
   */
  async update<T extends { id: string }>(table: string, id: string, updates: Partial<T>): Promise<void> {
    const tableData = this.tables.get(table)
    if (!tableData) throw new Error(`Table ${table} not found`)

    const oldRecord = tableData.get(id) as T | undefined
    if (!oldRecord) throw new Error(`Record ${id} not found in ${table}`)

    const newRecord = { ...oldRecord, ...updates }
    tableData.set(id, newRecord)
    this.currentRowid++

    this.changes.push({
      operation: 'UPDATE',
      rowid: this.currentRowid,
      before: oldRecord,
      after: newRecord,
      timestamp: Date.now(),
      sessionId: this.sessionId,
    })
  }

  /**
   * Execute DELETE and generate change
   */
  async delete(table: string, id: string): Promise<void> {
    const tableData = this.tables.get(table)
    if (!tableData) throw new Error(`Table ${table} not found`)

    const record = tableData.get(id)
    if (!record) throw new Error(`Record ${id} not found in ${table}`)

    tableData.delete(id)
    this.currentRowid++

    this.changes.push({
      operation: 'DELETE',
      rowid: this.currentRowid,
      before: record,
      after: null,
      timestamp: Date.now(),
      sessionId: this.sessionId,
    })
  }

  /**
   * Get changes since rowid
   */
  getChangesSince(rowid?: number): SQLiteChange<unknown>[] {
    if (!rowid) return this.changes
    return this.changes.filter((c) => c.rowid > rowid)
  }

  /**
   * Get current rowid
   */
  getCurrentRowid(): number {
    return this.currentRowid
  }

  /**
   * Seed table with initial data
   */
  async seedTable<T extends { id: string }>(tableName: string, records: T[]): Promise<void> {
    const tableData = this.tables.get(tableName)
    if (!tableData) throw new Error(`Table ${tableName} not found`)

    for (const record of records) {
      tableData.set(record.id, record)
    }
  }

  /**
   * Get all records from table
   */
  getTableRecords<T>(tableName: string): T[] {
    const tableData = this.tables.get(tableName)
    if (!tableData) return []
    return Array.from(tableData.values()) as T[]
  }
}

/**
 * Change event generator for testing
 */
function generateChangeEvents<T>(
  count: number,
  factory: (index: number) => { type: ChangeType; before: T | null; after: T | null }
): ChangeEvent<T>[] {
  return Array.from({ length: count }, (_, i) => {
    const { type, before, after } = factory(i)
    return {
      eventId: `evt-${i}`,
      type,
      before,
      after,
      timestamp: Date.now() + i,
      position: { sequence: i + 1, timestamp: Date.now() + i },
      isBackfill: false,
      table: 'test',
    }
  })
}

/**
 * Pipeline assertion helper
 */
class PipelineAssertions<T> {
  private events: ChangeEvent<T>[] = []

  addEvent(event: ChangeEvent<T>): void {
    this.events.push(event)
  }

  assertCount(expected: number): this {
    expect(this.events.length).toBe(expected)
    return this
  }

  assertTypes(expected: ChangeType[]): this {
    expect(this.events.map((e) => e.type)).toEqual(expected)
    return this
  }

  assertSequentialPositions(): this {
    for (let i = 1; i < this.events.length; i++) {
      expect(this.events[i]!.position.sequence).toBeGreaterThan(this.events[i - 1]!.position.sequence)
    }
    return this
  }

  assertNoGaps(): this {
    for (let i = 1; i < this.events.length; i++) {
      expect(this.events[i]!.position.sequence).toBe(this.events[i - 1]!.position.sequence + 1)
    }
    return this
  }

  getEvents(): ChangeEvent<T>[] {
    return this.events
  }

  clear(): void {
    this.events = []
  }
}

// ============================================================================
// POSTGRESQL LOGICAL REPLICATION SIMULATION TESTS
// ============================================================================

describe('PostgreSQL Logical Replication Integration', () => {
  let pgSimulator: PostgresDatabaseSimulator

  beforeEach(() => {
    pgSimulator = new PostgresDatabaseSimulator()
  })

  describe('full lifecycle: snapshot -> streaming -> recovery', () => {
    it('should perform initial snapshot and then stream changes', async () => {
      // Seed initial data
      const initialUsers: User[] = [
        { id: '1', name: 'Alice', email: 'alice@test.com', age: 25, created_at: Date.now(), updated_at: Date.now() },
        { id: '2', name: 'Bob', email: 'bob@test.com', age: 30, created_at: Date.now(), updated_at: Date.now() },
        { id: '3', name: 'Carol', email: 'carol@test.com', age: 35, created_at: Date.now(), updated_at: Date.now() },
      ]
      await pgSimulator.seedTable('users', initialUsers)

      // Capture WAL position before snapshot
      const snapshotWalPosition = pgSimulator.getCurrentLsn()

      // Perform snapshot
      const snapshotEvents: SnapshotEvent<User>[] = []
      const scanner = pgSimulator.getTableScanner<User>('users')
      const snapshotManager = createSnapshotManager<User>({
        scanner,
        chunkSize: 2,
        initialWalPosition: snapshotWalPosition,
        trackRecordIds: true,
        onSnapshot: async (event) => {
          snapshotEvents.push(event)
        },
      })

      await snapshotManager.start()
      await snapshotManager.waitForCompletion()

      expect(snapshotEvents).toHaveLength(3)
      expect(snapshotManager.getState().phase).toBe(SnapshotPhase.COMPLETED)

      // Now simulate changes after snapshot
      await pgSimulator.insert<User>('users', {
        id: '4',
        name: 'Dave',
        email: 'dave@test.com',
        age: 40,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await pgSimulator.update<User>('users', '1', { name: 'Alice Updated', updated_at: Date.now() })
      await pgSimulator.delete('users', '2')

      // Create reader for streaming
      const walMessages = pgSimulator.getWalMessagesSince(snapshotWalPosition)
      const reader = createPostgresWALReader<User>({
        connectionString: 'mock://localhost',
        slotName: 'test_slot',
        publicationName: 'test_pub',
        mockMessages: walMessages,
      })

      // Stream changes
      const streamedEntries: WALEntry<User>[] = []
      await reader.connect()
      for await (const entry of reader) {
        streamedEntries.push(entry)
      }
      await reader.disconnect()

      // Verify streamed changes
      expect(streamedEntries).toHaveLength(3)
      expect(streamedEntries[0]!.operation).toBe(WALOperationType.INSERT)
      expect(streamedEntries[0]!.after?.name).toBe('Dave')
      expect(streamedEntries[1]!.operation).toBe(WALOperationType.UPDATE)
      expect(streamedEntries[1]!.after?.name).toBe('Alice Updated')
      expect(streamedEntries[2]!.operation).toBe(WALOperationType.DELETE)
    })

    it('should handle recovery with checkpoint restoration', async () => {
      // Simulate changes
      await pgSimulator.insert<User>('users', {
        id: '1',
        name: 'User1',
        email: 'user1@test.com',
        age: 20,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await pgSimulator.insert<User>('users', {
        id: '2',
        name: 'User2',
        email: 'user2@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await pgSimulator.insert<User>('users', {
        id: '3',
        name: 'User3',
        email: 'user3@test.com',
        age: 30,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      // Create CDC stream and process some changes
      const processedEvents: ChangeEvent<User>[] = []
      const stream = createCDCStream<User>({
        onChange: async (event) => {
          processedEvents.push(event)
        },
      })

      await stream.start()

      // Process first two changes
      const walMessages = pgSimulator.getWalMessagesSince()
      const reader = createPostgresWALReader<User>({
        connectionString: 'mock://localhost',
        slotName: 'test_slot',
        mockMessages: walMessages,
      })

      await reader.connect()
      let checkpointPosition: CDCPosition | null = null
      let count = 0

      for await (const entry of reader) {
        await stream.insert(entry.after!, { eventId: `pg-${count}` })
        count++
        if (count === 2) {
          // Checkpoint after second record
          checkpointPosition = stream.getCurrentPosition()
          await stream.commit(checkpointPosition)
        }
      }
      await reader.disconnect()

      // Save checkpoint state
      const checkpointState = await stream.getCheckpointState()
      await stream.stop()

      // Simulate restart - create new stream from checkpoint
      const recoveredStream = createCDCStream<User>({
        startPosition: checkpointPosition!,
        onChange: async (event) => {
          processedEvents.push(event)
        },
      })

      await recoveredStream.restoreFromCheckpoint(checkpointState)
      await recoveredStream.start()

      // Verify recovery state
      const recoveredPosition = recoveredStream.getCurrentPosition()
      expect(recoveredPosition.sequence).toBe(checkpointPosition!.sequence)

      await recoveredStream.stop()
    })

    it('should handle transactions atomically', async () => {
      // Execute a transaction
      await pgSimulator.transaction([
        () =>
          pgSimulator.insert<User>('users', {
            id: '1',
            name: 'User1',
            email: 'user1@test.com',
            age: 20,
            created_at: Date.now(),
            updated_at: Date.now(),
          }),
        () =>
          pgSimulator.insert<User>('users', {
            id: '2',
            name: 'User2',
            email: 'user2@test.com',
            age: 25,
            created_at: Date.now(),
            updated_at: Date.now(),
          }),
      ])

      const walMessages = pgSimulator.getWalMessagesSince()
      const reader = createPostgresWALReader<User>({
        connectionString: 'mock://localhost',
        slotName: 'test_slot',
        publicationName: 'test_pub',
        groupByTransaction: true,
        mockMessages: walMessages,
      })

      await reader.connect()
      const entries: WALEntry<User>[] = []
      for await (const entry of reader) {
        entries.push(entry)
      }
      await reader.disconnect()

      // Both entries should have same transaction ID
      expect(entries).toHaveLength(2)
      expect(entries[0]!.transactionId).toBeDefined()
      expect(entries[0]!.transactionId).toBe(entries[1]!.transactionId)
    })
  })

  describe('Debezium-compatible event format', () => {
    it('should generate events with Debezium-compatible structure', async () => {
      await pgSimulator.insert<User>('users', {
        id: '1',
        name: 'Test',
        email: 'test@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      const walMessages = pgSimulator.getWalMessagesSince()
      const reader = createPostgresWALReader<User>({
        connectionString: 'mock://localhost',
        slotName: 'test_slot',
        mockMessages: walMessages,
      })

      await reader.connect()
      const entries: WALEntry<User>[] = []
      for await (const entry of reader) {
        entries.push(entry)
      }
      await reader.disconnect()

      const entry = entries[0]!

      // Debezium-compatible fields
      expect(entry.operation).toBeDefined() // op
      expect(entry.before).toBeDefined() // before (null for insert)
      expect(entry.after).toBeDefined() // after
      expect(entry.table).toBeDefined() // table
      expect(entry.schema).toBeDefined() // database/schema
      expect(entry.timestamp).toBeDefined() // ts_ms
      expect(entry.position).toBeDefined() // source position
      expect(entry.position.lsn).toBeDefined() // LSN
    })
  })

  describe('LSN-based acknowledgment', () => {
    it('should track acknowledged LSN positions', async () => {
      await pgSimulator.insert<User>('users', {
        id: '1',
        name: 'User1',
        email: 'user1@test.com',
        age: 20,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await pgSimulator.insert<User>('users', {
        id: '2',
        name: 'User2',
        email: 'user2@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      const ackLsns: string[] = []
      const reader = createPostgresWALReader<User>({
        connectionString: 'mock://localhost',
        slotName: 'test_slot',
        onAcknowledge: (lsn) => ackLsns.push(lsn),
        mockMessages: pgSimulator.getWalMessagesSince(),
      })

      await reader.connect()
      for await (const entry of reader) {
        await reader.acknowledge(entry.position)
      }
      await reader.disconnect()

      expect(ackLsns).toHaveLength(2)
      expect(reader.getAcknowledgedPosition()?.lsn).toBe(ackLsns[1])
    })
  })
})

// ============================================================================
// MYSQL BINLOG PARSING SIMULATION TESTS
// ============================================================================

describe('MySQL Binlog Parsing Integration', () => {
  let mysqlSimulator: MySQLDatabaseSimulator

  beforeEach(() => {
    mysqlSimulator = new MySQLDatabaseSimulator()
  })

  describe('GTID-based replication', () => {
    it('should track GTID positions across operations', async () => {
      await mysqlSimulator.insert<User>('test_db', 'users', {
        id: '1',
        name: 'User1',
        email: 'user1@test.com',
        age: 20,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await mysqlSimulator.insert<User>('test_db', 'users', {
        id: '2',
        name: 'User2',
        email: 'user2@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await mysqlSimulator.update<User>('test_db', 'users', '1', { name: 'User1 Updated' })

      const reader = createMySQLBinlogReader<User>({
        host: 'mock://localhost',
        user: 'repl',
        password: 'secret',
        serverId: 1,
        useGtid: true,
        mockEvents: mysqlSimulator.getBinlogEvents(),
      })

      await reader.connect()
      const entries: WALEntry<User>[] = []
      for await (const entry of reader) {
        entries.push(entry)
      }
      await reader.disconnect()

      expect(entries).toHaveLength(3)

      // Verify GTID tracking
      const position = reader.getPosition()
      expect(position.gtid).toBeDefined()
      expect(position.gtid?.transactionId).toBe(3) // 3 operations
    })

    it('should resume from GTID position', async () => {
      await mysqlSimulator.insert<User>('test_db', 'users', {
        id: '1',
        name: 'User1',
        email: 'user1@test.com',
        age: 20,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await mysqlSimulator.insert<User>('test_db', 'users', {
        id: '2',
        name: 'User2',
        email: 'user2@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await mysqlSimulator.insert<User>('test_db', 'users', {
        id: '3',
        name: 'User3',
        email: 'user3@test.com',
        age: 30,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      // Resume from GTID transaction 1 (skip first record)
      const reader = createMySQLBinlogReader<User>({
        host: 'mock://localhost',
        user: 'repl',
        password: 'secret',
        serverId: 1,
        useGtid: true,
        startGtid: { uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', transactionId: 1 },
        mockEvents: mysqlSimulator.getBinlogEvents(),
      })

      await reader.connect()
      const entries: WALEntry<User>[] = []
      for await (const entry of reader) {
        entries.push(entry)
      }
      await reader.disconnect()

      // Should only get records after GTID txn 1
      expect(entries).toHaveLength(2)
      expect(entries[0]!.after?.name).toBe('User2')
      expect(entries[1]!.after?.name).toBe('User3')
    })
  })

  describe('binlog file rotation', () => {
    it('should handle binlog rotation seamlessly', async () => {
      await mysqlSimulator.insert<User>('test_db', 'users', {
        id: '1',
        name: 'BeforeRotation',
        email: 'before@test.com',
        age: 20,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      mysqlSimulator.rotateBinlog()

      await mysqlSimulator.insert<User>('test_db', 'users', {
        id: '2',
        name: 'AfterRotation',
        email: 'after@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      const reader = createMySQLBinlogReader<User>({
        host: 'mock://localhost',
        user: 'repl',
        password: 'secret',
        serverId: 1,
        mockEvents: mysqlSimulator.getBinlogEvents(),
      })

      await reader.connect()
      const entries: WALEntry<User>[] = []
      for await (const entry of reader) {
        entries.push(entry)
      }
      await reader.disconnect()

      expect(entries).toHaveLength(2)
      expect(entries[0]!.after?.name).toBe('BeforeRotation')
      expect(entries[1]!.after?.name).toBe('AfterRotation')

      // Position should reflect new file
      const position = reader.getPosition()
      expect(position.binlogFile).toBe('mysql-bin.000002')
    })
  })

  describe('row-level filtering', () => {
    it('should filter by database', async () => {
      await mysqlSimulator.insert<User>('test_db', 'users', {
        id: '1',
        name: 'TestDB',
        email: 'test@test.com',
        age: 20,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      // Manually add event for different database
      const events = mysqlSimulator.getBinlogEvents()
      events.push({
        type: 'WRITE_ROWS',
        schema: 'other_db',
        table: 'users',
        rows: [{ id: '2', name: 'OtherDB' }],
        position: { filename: 'mysql-bin.000001', position: 9999 },
        timestamp: Date.now(),
      })

      const reader = createMySQLBinlogReader<User>({
        host: 'mock://localhost',
        user: 'repl',
        password: 'secret',
        serverId: 1,
        includeDatabases: ['test_db'],
        mockEvents: events,
      })

      await reader.connect()
      const entries: WALEntry<User>[] = []
      for await (const entry of reader) {
        entries.push(entry)
      }
      await reader.disconnect()

      expect(entries).toHaveLength(1)
      expect(entries[0]!.after?.name).toBe('TestDB')
    })
  })

  describe('UPDATE with before/after', () => {
    it('should capture both before and after images', async () => {
      // First insert
      await mysqlSimulator.insert<User>('test_db', 'users', {
        id: '1',
        name: 'Original',
        email: 'original@test.com',
        age: 20,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      // Then update
      await mysqlSimulator.update<User>('test_db', 'users', '1', { name: 'Updated', age: 25 })

      const reader = createMySQLBinlogReader<User>({
        host: 'mock://localhost',
        user: 'repl',
        password: 'secret',
        serverId: 1,
        mockEvents: mysqlSimulator.getBinlogEvents(),
      })

      await reader.connect()
      const entries: WALEntry<User>[] = []
      for await (const entry of reader) {
        entries.push(entry)
      }
      await reader.disconnect()

      // Second entry is the UPDATE
      const updateEntry = entries[1]!
      expect(updateEntry.operation).toBe(WALOperationType.UPDATE)
      expect(updateEntry.before?.name).toBe('Original')
      expect(updateEntry.before?.age).toBe(20)
      expect(updateEntry.after?.name).toBe('Updated')
      expect(updateEntry.after?.age).toBe(25)
    })
  })
})

// ============================================================================
// SQLITE WAL CHANGE TRACKING TESTS
// ============================================================================

describe('SQLite WAL Change Tracking Integration', () => {
  let sqliteSimulator: SQLiteDatabaseSimulator

  beforeEach(() => {
    sqliteSimulator = new SQLiteDatabaseSimulator()
  })

  describe('trigger-based capture', () => {
    it('should capture all CRUD operations', async () => {
      // Simulate INSERT
      await sqliteSimulator.insert<User>('users', {
        id: '1',
        name: 'User1',
        email: 'user1@test.com',
        age: 20,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      // Simulate UPDATE
      await sqliteSimulator.update<User>('users', '1', { name: 'User1 Updated' })

      // Simulate DELETE
      await sqliteSimulator.delete('users', '1')

      const changes = sqliteSimulator.getChangesSince()
      expect(changes).toHaveLength(3)
      expect(changes[0]!.operation).toBe('INSERT')
      expect(changes[1]!.operation).toBe('UPDATE')
      expect(changes[2]!.operation).toBe('DELETE')
    })

    it('should maintain rowid ordering', async () => {
      for (let i = 1; i <= 5; i++) {
        await sqliteSimulator.insert<User>('users', {
          id: String(i),
          name: `User${i}`,
          email: `user${i}@test.com`,
          age: 20 + i,
          created_at: Date.now(),
          updated_at: Date.now(),
        })
      }

      const changes = sqliteSimulator.getChangesSince()

      // Rowids should be sequential
      for (let i = 1; i < changes.length; i++) {
        expect(changes[i]!.rowid).toBeGreaterThan(changes[i - 1]!.rowid)
      }
    })

    it('should support resumption from rowid', async () => {
      for (let i = 1; i <= 5; i++) {
        await sqliteSimulator.insert<User>('users', {
          id: String(i),
          name: `User${i}`,
          email: `user${i}@test.com`,
          age: 20 + i,
          created_at: Date.now(),
          updated_at: Date.now(),
        })
      }

      // Resume from rowid 3
      const changes = sqliteSimulator.getChangesSince(3)
      expect(changes).toHaveLength(2)
      expect(changes[0]!.rowid).toBe(4)
      expect(changes[1]!.rowid).toBe(5)
    })
  })

  describe('SQLiteChangeCapture integration', () => {
    it('should work with SQLiteChangeCapture reader', async () => {
      const capturedChanges: SQLiteChange<User>[] = []

      const reader = createSQLiteChangeCapture<User>({
        tableName: 'users',
        onChange: async (change) => capturedChanges.push(change),
      })

      await reader.connect()

      // Capture changes
      await reader.captureInsert({
        id: '1',
        name: 'Test',
        email: 'test@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      // Read from iterator
      const entries: WALEntry<User>[] = []
      for await (const entry of reader) {
        entries.push(entry)
        break
      }

      await reader.disconnect()

      expect(capturedChanges).toHaveLength(1)
      expect(entries).toHaveLength(1)
      expect(entries[0]!.operation).toBe(WALOperationType.INSERT)
    })

    it('should track session ID for change attribution', async () => {
      const reader = createSQLiteChangeCapture<User>({
        tableName: 'users',
        sessionId: 'session-abc123',
      })

      await reader.connect()
      await reader.captureInsert({
        id: '1',
        name: 'Test',
        email: 'test@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      const entries: WALEntry<User>[] = []
      for await (const entry of reader) {
        entries.push(entry)
        break
      }

      await reader.disconnect()

      expect(entries[0]!.metadata?.sessionId).toBe('session-abc123')
    })
  })
})

// ============================================================================
// END-TO-END CDC PIPELINE TESTS
// ============================================================================

describe('End-to-End CDC Pipeline', () => {
  describe('full pipeline: capture -> transform -> sink', () => {
    it('should process changes through complete pipeline', async () => {
      // Setup sink
      const sink = createMemorySink<{ userId: string; displayName: string }>()

      // Setup transform pipeline using sync transformers for CDCStream integration
      const pipeline = createTransformPipeline<User, { userId: string; displayName: string }>()
        .pipe(
          filterSync((e) => e.after !== null && e.after.age >= 18)
        )
        .pipe(
          mapSync((user) => ({
            userId: user.id,
            displayName: `${user.name} (${user.age})`,
          }))
        )

      // Setup CDC stream
      const stream = createCDCStream<User, { userId: string; displayName: string }>({
        transform: (event) => {
          const transformed = pipeline.transformSync(event)
          if (!transformed) {
            // Filtered out - return event with null after to indicate filtering
            return { ...event, after: null } as unknown as ChangeEvent<{ userId: string; displayName: string }>
          }
          return {
            ...event,
            after: transformed.after,
            before: transformed.before,
          } as ChangeEvent<{ userId: string; displayName: string }>
        },
        onChange: async (event) => {
          if (event.after) {
            await sink.write(event)
          }
        },
      })

      await stream.start()

      // Process some users
      await stream.insert({
        id: '1',
        name: 'Adult',
        email: 'adult@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await stream.insert({
        id: '2',
        name: 'Minor',
        email: 'minor@test.com',
        age: 15,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await stream.insert({
        id: '3',
        name: 'Senior',
        email: 'senior@test.com',
        age: 65,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      await stream.stop()

      // Only adults should be in sink
      const changes = sink.getChanges()
      expect(changes).toHaveLength(2)
      expect(changes[0]!.after?.displayName).toBe('Adult (25)')
      expect(changes[1]!.after?.displayName).toBe('Senior (65)')
    })

    it('should handle backfill followed by streaming', async () => {
      const assertions = new PipelineAssertions<User>()
      const stream = createCDCStream<User>({
        onChange: async (event) => assertions.addEvent(event),
      })

      await stream.start()

      // Backfill existing data
      await stream.startBackfill()
      await stream.backfillInsert({
        id: '1',
        name: 'Existing1',
        email: 'e1@test.com',
        age: 20,
        created_at: Date.now() - 10000,
        updated_at: Date.now() - 10000,
      })
      await stream.backfillInsert({
        id: '2',
        name: 'Existing2',
        email: 'e2@test.com',
        age: 25,
        created_at: Date.now() - 5000,
        updated_at: Date.now() - 5000,
      })
      const backfillEndPosition = await stream.endBackfill()

      // Stream new changes
      await stream.insert({
        id: '3',
        name: 'New1',
        email: 'n1@test.com',
        age: 30,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      await stream.stop()

      assertions.assertCount(3)
      const events = assertions.getEvents()
      expect(events[0]!.isBackfill).toBe(true)
      expect(events[1]!.isBackfill).toBe(true)
      expect(events[2]!.isBackfill).toBe(false)
    })

    it('should fan out to multiple sinks', async () => {
      const primarySink = createMemorySink<User>()
      const auditSink = createMemorySink<User>()
      const analyticsSink = createMemorySink<User>()

      const multiSink = createMultiSink<User>({
        sinks: [primarySink, auditSink],
        routes: [
          {
            condition: (e) => e.type === ChangeType.DELETE,
            sink: analyticsSink,
          },
        ],
        parallel: true,
      })

      const stream = createCDCStream<User>({
        onChange: async (event) => multiSink.write(event),
      })

      await stream.start()

      await stream.insert({
        id: '1',
        name: 'User1',
        email: 'u1@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await stream.delete({
        id: '1',
        name: 'User1',
        email: 'u1@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      await stream.stop()

      // Primary and audit get all events
      expect(primarySink.getChanges()).toHaveLength(2)
      expect(auditSink.getChanges()).toHaveLength(2)

      // Analytics only gets deletes
      expect(analyticsSink.getChanges()).toHaveLength(1)
      expect(analyticsSink.getChanges()[0]!.type).toBe(ChangeType.DELETE)
    })
  })

  describe('exactly-once delivery', () => {
    it('should deduplicate events with same eventId', async () => {
      const processedEvents: ChangeEvent<User>[] = []
      const stream = createCDCStream<User>({
        onChange: async (event) => processedEvents.push(event),
      })

      await stream.start()

      const eventData = {
        id: '1',
        name: 'Test',
        email: 'test@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      }

      // Try to insert same event twice
      await stream.insert(eventData, { eventId: 'dedup-test-1' })
      await stream.insert(eventData, { eventId: 'dedup-test-1' })
      await stream.insert(eventData, { eventId: 'dedup-test-2' })

      await stream.stop()

      // Should only process 2 unique events
      expect(processedEvents).toHaveLength(2)
    })
  })

  describe('checkpointing and recovery', () => {
    it('should restore from checkpoint correctly', async () => {
      const stream1Events: ChangeEvent<User>[] = []
      const stream1 = createCDCStream<User>({
        onChange: async (event) => stream1Events.push(event),
      })

      await stream1.start()

      await stream1.insert({
        id: '1',
        name: 'User1',
        email: 'u1@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await stream1.insert({
        id: '2',
        name: 'User2',
        email: 'u2@test.com',
        age: 30,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      // Checkpoint
      const checkpointState = await stream1.getCheckpointState()
      const position = stream1.getCurrentPosition()
      await stream1.commit(position)
      await stream1.stop()

      // Create new stream from checkpoint
      const stream2Events: ChangeEvent<User>[] = []
      const stream2 = createCDCStream<User>({
        startPosition: position,
        onChange: async (event) => stream2Events.push(event),
      })

      await stream2.restoreFromCheckpoint(checkpointState)
      await stream2.start()

      // Add more events
      await stream2.insert({
        id: '3',
        name: 'User3',
        email: 'u3@test.com',
        age: 35,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      await stream2.stop()

      // Stream2 should continue from position
      expect(stream2.getCurrentPosition().sequence).toBeGreaterThan(position.sequence)
    })
  })

  describe('batching', () => {
    it('should batch events by count', async () => {
      const batches: ChangeEvent<User>[][] = []
      const stream = createCDCStream<User>({
        batchSize: 3,
        onBatch: async (batch) => batches.push([...batch]),
      })

      await stream.start()

      for (let i = 1; i <= 7; i++) {
        await stream.insert({
          id: String(i),
          name: `User${i}`,
          email: `u${i}@test.com`,
          age: 20 + i,
          created_at: Date.now(),
          updated_at: Date.now(),
        })
      }

      await stream.flush()
      await stream.stop()

      // Should have batches of 3, 3, 1
      expect(batches).toHaveLength(3)
      expect(batches[0]).toHaveLength(3)
      expect(batches[1]).toHaveLength(3)
      expect(batches[2]).toHaveLength(1)
    })

    it('should flush batch on timeout', async () => {
      const batches: ChangeEvent<User>[][] = []
      const stream = createCDCStream<User>({
        batchSize: 100, // High count so time triggers first
        batchTimeoutMs: 50,
        onBatch: async (batch) => batches.push([...batch]),
      })

      await stream.start()

      await stream.insert({
        id: '1',
        name: 'User1',
        email: 'u1@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 100))

      await stream.stop()

      expect(batches).toHaveLength(1)
      expect(batches[0]).toHaveLength(1)
    })
  })

  describe('error handling', () => {
    it('should send failed events to dead letter queue', async () => {
      const deadLetterEvents: Array<{ event: ChangeEvent<User>; error: Error }> = []
      let processCount = 0

      const stream = createCDCStream<User>({
        retryAttempts: 2,
        onChange: async () => {
          processCount++
          if (processCount <= 2) {
            throw new Error('Simulated failure')
          }
        },
        onDeadLetter: async (event, error) => {
          deadLetterEvents.push({ event, error })
        },
      })

      await stream.start()

      // This should fail and go to dead letter
      await stream.insert({
        id: '1',
        name: 'FailUser',
        email: 'fail@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      await stream.stop()

      expect(deadLetterEvents).toHaveLength(1)
      expect(deadLetterEvents[0]!.error.message).toBe('Simulated failure')
    })

    it('should retry with exponential backoff', async () => {
      const attemptTimes: number[] = []
      let attempts = 0

      const stream = createCDCStream<User>({
        retryAttempts: 3,
        onChange: async () => {
          attemptTimes.push(Date.now())
          attempts++
          if (attempts < 3) {
            throw new Error('Retry me')
          }
        },
      })

      await stream.start()

      await stream.insert({
        id: '1',
        name: 'RetryUser',
        email: 'retry@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      await stream.stop()

      // Should have succeeded on 3rd attempt
      expect(attempts).toBe(3)
    })
  })

  describe('statistics tracking', () => {
    it('should track operation counts', async () => {
      const stream = createCDCStream<User>()

      await stream.start()

      await stream.insert({
        id: '1',
        name: 'User1',
        email: 'u1@test.com',
        age: 25,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await stream.insert({
        id: '2',
        name: 'User2',
        email: 'u2@test.com',
        age: 30,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await stream.update(
        { id: '1', name: 'User1', email: 'u1@test.com', age: 25, created_at: Date.now(), updated_at: Date.now() },
        { id: '1', name: 'User1 Updated', email: 'u1@test.com', age: 26, created_at: Date.now(), updated_at: Date.now() }
      )
      await stream.delete({
        id: '2',
        name: 'User2',
        email: 'u2@test.com',
        age: 30,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      await stream.stop()

      const stats = stream.getStats()
      expect(stats.insertCount).toBe(2)
      expect(stats.updateCount).toBe(1)
      expect(stats.deleteCount).toBe(1)
      expect(stats.totalChanges).toBe(4)
    })
  })
})

// ============================================================================
// PERFORMANCE BENCHMARKS
// ============================================================================

describe('Performance Benchmarks', () => {
  it('should process 1000 events in reasonable time', async () => {
    const sink = createMemorySink<User>()
    const stream = createCDCStream<User>({
      onChange: async (event) => sink.write(event),
    })

    await stream.start()
    const startTime = Date.now()

    for (let i = 0; i < 1000; i++) {
      await stream.insert({
        id: String(i),
        name: `User${i}`,
        email: `user${i}@test.com`,
        age: 20 + (i % 50),
        created_at: Date.now(),
        updated_at: Date.now(),
      })
    }

    await stream.stop()
    const duration = Date.now() - startTime

    expect(sink.getChanges()).toHaveLength(1000)
    expect(duration).toBeLessThan(5000) // Should complete in under 5 seconds

    const stats = stream.getStats()
    expect(stats.totalChanges).toBe(1000)
    expect(stats.avgProcessingLatencyMs).toBeLessThan(50) // Avg latency under 50ms
  })

  it('should handle batched processing efficiently', async () => {
    let batchCount = 0
    const stream = createCDCStream<User>({
      batchSize: 100,
      onBatch: async (batch) => {
        batchCount++
        // Simulate batch processing delay
        await new Promise((resolve) => setTimeout(resolve, 1))
      },
    })

    await stream.start()
    const startTime = Date.now()

    for (let i = 0; i < 500; i++) {
      await stream.insert({
        id: String(i),
        name: `User${i}`,
        email: `user${i}@test.com`,
        age: 20 + (i % 50),
        created_at: Date.now(),
        updated_at: Date.now(),
      })
    }

    await stream.flush()
    await stream.stop()
    const duration = Date.now() - startTime

    expect(batchCount).toBe(5) // 500 / 100 = 5 batches
    expect(duration).toBeLessThan(2000) // Should complete quickly
  })

  it('should maintain throughput under transform pipeline', async () => {
    // Use sync transformers for CDCStream integration
    const pipeline = createTransformPipeline<User, { id: string; name: string }>()
      .pipe(filterSync((e) => e.after !== null && e.after.age >= 18))
      .pipe(mapSync((u) => ({ id: u.id, name: u.name })))

    const sink = createMemorySink<{ id: string; name: string }>()
    let transformedCount = 0

    const stream = createCDCStream<User, { id: string; name: string }>({
      transform: (event) => {
        const transformed = pipeline.transformSync(event)
        if (transformed && transformed.after) {
          transformedCount++
          return { ...event, after: transformed.after, before: transformed.before } as ChangeEvent<{
            id: string
            name: string
          }>
        }
        return { ...event, after: null } as unknown as ChangeEvent<{ id: string; name: string }>
      },
      onChange: async (event) => {
        if (event.after) {
          await sink.write(event)
        }
      },
    })

    await stream.start()
    const startTime = Date.now()

    for (let i = 0; i < 500; i++) {
      await stream.insert({
        id: String(i),
        name: `User${i}`,
        email: `user${i}@test.com`,
        age: 10 + (i % 30), // Some will be filtered (age < 18)
        created_at: Date.now(),
        updated_at: Date.now(),
      })
    }

    await stream.stop()
    const duration = Date.now() - startTime

    // Should filter out users with age < 18
    expect(sink.getChanges().length).toBeLessThan(500)
    expect(sink.getChanges().length).toBeGreaterThan(0)
    expect(duration).toBeLessThan(3000)
  })
})

// ============================================================================
// CHAOS TESTING
// ============================================================================

describe('Chaos Testing', () => {
  it('should handle interleaved operations correctly', async () => {
    const sink = createMemorySink<User>({
      keyExtractor: (e) => e.after?.id ?? e.before?.id ?? '',
    })

    const stream = createCDCStream<User>({
      onChange: async (event) => sink.write(event),
    })

    await stream.start()

    // Interleave operations on different records
    const operations = [
      () =>
        stream.insert({
          id: '1',
          name: 'User1',
          email: 'u1@test.com',
          age: 25,
          created_at: Date.now(),
          updated_at: Date.now(),
        }),
      () =>
        stream.insert({
          id: '2',
          name: 'User2',
          email: 'u2@test.com',
          age: 30,
          created_at: Date.now(),
          updated_at: Date.now(),
        }),
      () =>
        stream.update(
          {
            id: '1',
            name: 'User1',
            email: 'u1@test.com',
            age: 25,
            created_at: Date.now(),
            updated_at: Date.now(),
          },
          {
            id: '1',
            name: 'User1 Updated',
            email: 'u1@test.com',
            age: 26,
            created_at: Date.now(),
            updated_at: Date.now(),
          }
        ),
      () =>
        stream.insert({
          id: '3',
          name: 'User3',
          email: 'u3@test.com',
          age: 35,
          created_at: Date.now(),
          updated_at: Date.now(),
        }),
      () =>
        stream.delete({
          id: '2',
          name: 'User2',
          email: 'u2@test.com',
          age: 30,
          created_at: Date.now(),
          updated_at: Date.now(),
        }),
    ]

    for (const op of operations) {
      await op()
    }

    await stream.stop()

    // Verify correct number of events
    expect(sink.getChanges()).toHaveLength(5)

    // Verify per-key history
    const user1Changes = sink.getChangesByKey('1')
    expect(user1Changes).toHaveLength(2) // insert + update

    const user2Changes = sink.getChangesByKey('2')
    expect(user2Changes).toHaveLength(2) // insert + delete
  })

  it('should handle rapid fire events', async () => {
    const sink = createMemorySink<User>()
    const stream = createCDCStream<User>({
      onChange: async (event) => sink.write(event),
    })

    await stream.start()

    // Fire many events rapidly
    const promises: Promise<void>[] = []
    for (let i = 0; i < 100; i++) {
      promises.push(
        stream.insert({
          id: String(i),
          name: `User${i}`,
          email: `u${i}@test.com`,
          age: 20 + i,
          created_at: Date.now(),
          updated_at: Date.now(),
        })
      )
    }

    await Promise.all(promises)
    await stream.stop()

    // All events should be captured
    expect(sink.getChanges()).toHaveLength(100)
  })

  it('should maintain ordering under concurrent updates to same record', async () => {
    const events: ChangeEvent<User>[] = []
    const stream = createCDCStream<User>({
      onChange: async (event) => events.push(event),
    })

    await stream.start()

    const baseUser: User = {
      id: '1',
      name: 'Original',
      email: 'original@test.com',
      age: 25,
      created_at: Date.now(),
      updated_at: Date.now(),
    }

    // Sequential updates to same record
    await stream.insert(baseUser)
    await stream.update(baseUser, { ...baseUser, name: 'Update1', age: 26 })
    await stream.update({ ...baseUser, name: 'Update1', age: 26 }, { ...baseUser, name: 'Update2', age: 27 })
    await stream.update({ ...baseUser, name: 'Update2', age: 27 }, { ...baseUser, name: 'Update3', age: 28 })

    await stream.stop()

    // Verify ordering
    expect(events).toHaveLength(4)
    expect(events[0]!.type).toBe(ChangeType.INSERT)
    expect(events[1]!.after?.name).toBe('Update1')
    expect(events[2]!.after?.name).toBe('Update2')
    expect(events[3]!.after?.name).toBe('Update3')

    // Positions should be sequential
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.position.sequence).toBeGreaterThan(events[i - 1]!.position.sequence)
    }
  })
})
