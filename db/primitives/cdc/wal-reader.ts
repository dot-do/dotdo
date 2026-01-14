/**
 * WAL/Binlog Reader Abstraction
 *
 * Unified abstraction layer for reading database transaction logs:
 * - PostgreSQL logical replication (pgoutput/wal2json)
 * - MySQL binlog with GTID support
 * - SQLite trigger-based change capture
 *
 * All readers implement the WALReader interface with async iterator pattern
 * for consistent consumption across database backends.
 *
 * @module db/primitives/cdc/wal-reader
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * WAL operation types
 */
export enum WALOperationType {
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  TRUNCATE = 'TRUNCATE',
}

/**
 * Position in the WAL stream - varies by database type
 */
export interface WALPosition {
  /** PostgreSQL Log Sequence Number (e.g., '0/1000') */
  lsn?: string
  /** Monotonically increasing sequence number */
  sequence: number
  /** MySQL binlog filename */
  binlogFile?: string
  /** MySQL binlog position within file */
  binlogPosition?: number
  /** MySQL GTID */
  gtid?: GTID
  /** SQLite rowid in change log table */
  rowid?: number
  /** Timestamp of the position */
  timestamp?: number
}

/**
 * MySQL Global Transaction ID
 */
export interface GTID {
  /** Server UUID */
  uuid: string
  /** Transaction ID within the server */
  transactionId: number
}

/**
 * Single WAL entry representing a change
 */
export interface WALEntry<T> {
  /** Position in the log */
  position: WALPosition
  /** Type of operation */
  operation: WALOperationType
  /** Table name */
  table: string
  /** Schema/database name */
  schema: string
  /** State before the change (null for INSERT) */
  before: T | null
  /** State after the change (null for DELETE) */
  after: T | null
  /** Timestamp of the change */
  timestamp: number
  /** Transaction ID */
  transactionId?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * WAL reader state for monitoring
 */
export interface WALReaderState {
  /** Whether connected to the source */
  connected: boolean
  /** Current position in the log */
  position: WALPosition
  /** Last acknowledged position */
  acknowledgedPosition: WALPosition | null
  /** Number of entries processed */
  entriesProcessed: number
  /** Number of errors encountered */
  errorCount: number
}

/**
 * Options for WAL reader configuration
 */
export interface WALReaderOptions {
  /** Position to start reading from */
  startPosition?: WALPosition
  /** Tables to include (empty = all) */
  includeTables?: string[]
  /** Tables to exclude */
  excludeTables?: string[]
  /** Schemas/databases to include */
  includeSchemas?: string[]
  /** Schemas/databases to exclude */
  excludeSchemas?: string[]
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number
  /** Base delay for reconnection backoff (ms) */
  reconnectBaseDelayMs?: number
  /** Maximum delay for reconnection backoff (ms) */
  reconnectMaxDelayMs?: number
  /** Batch size for acknowledgments */
  ackBatchSize?: number
}

/**
 * WAL Reader interface with async iterator pattern
 */
export interface WALReader<T> extends AsyncIterable<WALEntry<T>> {
  /** Connect to the data source */
  connect(): Promise<void>
  /** Disconnect from the data source */
  disconnect(): Promise<void>
  /** Check if connected */
  isConnected(): boolean
  /** Get current position */
  getPosition(): WALPosition
  /** Get last acknowledged position */
  getAcknowledgedPosition(): WALPosition | null
  /** Acknowledge processing up to a position */
  acknowledge(position: WALPosition): Promise<void>
  /** Get reader state */
  getState(): WALReaderState
}

// ============================================================================
// POSTGRESQL WAL READER
// ============================================================================

/**
 * PostgreSQL pgoutput message types
 */
export interface PgOutputMessage {
  type: 'begin' | 'commit' | 'insert' | 'update' | 'delete' | 'wal2json'
  lsn: string
  xid?: number
  relation?: {
    schema: string
    table: string
  }
  tuple?: Record<string, unknown>
  oldTuple?: Record<string, unknown>
  newTuple?: Record<string, unknown>
  change?: Array<{
    kind: string
    schema: string
    table: string
    columnnames?: string[]
    columnvalues?: unknown[]
    oldkeys?: { keynames: string[]; keyvalues: unknown[] }
  }>
}

/**
 * Options for PostgreSQL WAL reader
 */
export interface PostgresWALReaderOptions extends WALReaderOptions {
  /** PostgreSQL connection string */
  connectionString: string
  /** Replication slot name */
  slotName: string
  /** Publication name (for pgoutput) */
  publicationName?: string
  /** Output plugin: 'pgoutput' or 'wal2json' */
  outputPlugin?: 'pgoutput' | 'wal2json'
  /** Create slot if not exists */
  createSlotIfNotExists?: boolean
  /** Drop slot on disconnect */
  dropSlotOnDisconnect?: boolean
  /** Group changes by transaction */
  groupByTransaction?: boolean
  /** Mock messages for testing */
  mockMessages?: PgOutputMessage[]
  /** Callback for slot creation */
  onCreateSlot?: (slotName: string) => void
  /** Callback for slot drop */
  onDropSlot?: (slotName: string) => void
  /** Callback for acknowledgments */
  onAcknowledge?: (lsn: string) => void
}

/**
 * PostgreSQL logical replication reader
 */
export class PostgresWALReader<T = unknown> implements WALReader<T> {
  private options: PostgresWALReaderOptions
  private connected: boolean = false
  private position: WALPosition = { lsn: '0/0', sequence: 0 }
  private acknowledgedPosition: WALPosition | null = null
  private entriesProcessed: number = 0
  private errorCount: number = 0
  private currentTransaction: string | null = null
  private messageIndex: number = 0

  constructor(options: PostgresWALReaderOptions) {
    this.options = {
      outputPlugin: 'pgoutput',
      ...options,
    }
    if (options.startPosition) {
      this.position = options.startPosition
    }
  }

  async connect(): Promise<void> {
    // In a real implementation, this would establish a replication connection
    // For now, we handle mock messages for testing

    if (this.options.createSlotIfNotExists && this.options.onCreateSlot) {
      this.options.onCreateSlot(this.options.slotName)
    }

    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (this.options.dropSlotOnDisconnect && this.options.onDropSlot) {
      this.options.onDropSlot(this.options.slotName)
    }

    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  getPosition(): WALPosition {
    return this.position
  }

  getAcknowledgedPosition(): WALPosition | null {
    return this.acknowledgedPosition
  }

  async acknowledge(position: WALPosition): Promise<void> {
    this.acknowledgedPosition = position
    if (this.options.onAcknowledge && position.lsn) {
      this.options.onAcknowledge(position.lsn)
    }
  }

  getState(): WALReaderState {
    return {
      connected: this.connected,
      position: this.position,
      acknowledgedPosition: this.acknowledgedPosition,
      entriesProcessed: this.entriesProcessed,
      errorCount: this.errorCount,
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<WALEntry<T>> {
    if (!this.options.mockMessages) return

    while (this.messageIndex < this.options.mockMessages.length && this.connected) {
      const msg = this.options.mockMessages[this.messageIndex]!
      this.messageIndex++

      // Handle transaction boundaries
      if (msg.type === 'begin') {
        this.currentTransaction = String(msg.xid)
        continue
      }

      if (msg.type === 'commit') {
        this.currentTransaction = null
        continue
      }

      // Handle wal2json format
      if (msg.type === 'wal2json' && msg.change) {
        for (const change of msg.change) {
          const entry = this.parseWal2JsonChange(change, msg.lsn)
          if (entry) {
            this.entriesProcessed++
            this.position = entry.position
            yield entry
          }
        }
        continue
      }

      // Handle pgoutput format
      const entry = this.parsePgOutputMessage(msg)
      if (entry) {
        this.entriesProcessed++
        this.position = entry.position
        yield entry
      }
    }
  }

  private parsePgOutputMessage(msg: PgOutputMessage): WALEntry<T> | null {
    if (!msg.relation) return null

    const baseEntry = {
      position: {
        lsn: msg.lsn,
        sequence: this.entriesProcessed + 1,
        timestamp: Date.now(),
      },
      table: msg.relation.table,
      schema: msg.relation.schema,
      timestamp: Date.now(),
      transactionId: this.currentTransaction ?? undefined,
    }

    switch (msg.type) {
      case 'insert':
        return {
          ...baseEntry,
          operation: WALOperationType.INSERT,
          before: null,
          after: msg.tuple as T,
        }

      case 'update':
        return {
          ...baseEntry,
          operation: WALOperationType.UPDATE,
          before: (msg.oldTuple ?? null) as T | null,
          after: msg.newTuple as T,
        }

      case 'delete':
        return {
          ...baseEntry,
          operation: WALOperationType.DELETE,
          before: msg.oldTuple as T,
          after: null,
        }

      default:
        return null
    }
  }

  private parseWal2JsonChange(
    change: NonNullable<PgOutputMessage['change']>[0],
    lsn: string
  ): WALEntry<T> | null {
    const record: Record<string, unknown> = {}
    if (change.columnnames && change.columnvalues) {
      for (let i = 0; i < change.columnnames.length; i++) {
        record[change.columnnames[i]!] = change.columnvalues[i]
      }
    }

    const baseEntry = {
      position: {
        lsn,
        sequence: this.entriesProcessed + 1,
        timestamp: Date.now(),
      },
      table: change.table,
      schema: change.schema,
      timestamp: Date.now(),
    }

    switch (change.kind) {
      case 'insert':
        return {
          ...baseEntry,
          operation: WALOperationType.INSERT,
          before: null,
          after: record as T,
        }

      case 'update':
        return {
          ...baseEntry,
          operation: WALOperationType.UPDATE,
          before: null, // wal2json may not include old values
          after: record as T,
        }

      case 'delete':
        return {
          ...baseEntry,
          operation: WALOperationType.DELETE,
          before: record as T,
          after: null,
        }

      default:
        return null
    }
  }
}

/**
 * Factory function for PostgreSQL WAL reader
 */
export function createPostgresWALReader<T = unknown>(
  options: PostgresWALReaderOptions
): PostgresWALReader<T> {
  return new PostgresWALReader<T>(options)
}

// ============================================================================
// MYSQL BINLOG READER
// ============================================================================

/**
 * MySQL binlog event types
 */
export interface BinlogEvent {
  type: 'WRITE_ROWS' | 'UPDATE_ROWS' | 'DELETE_ROWS' | 'GTID' | 'ROTATE' | 'QUERY'
  tableId?: number
  schema?: string
  table?: string
  rows?: Array<Record<string, unknown> | { before: Record<string, unknown>; after: Record<string, unknown> }>
  position: {
    filename: string
    position: number
  }
  timestamp: number
  gtid?: GTID
  nextFile?: string
  query?: string
}

/**
 * Options for MySQL binlog reader
 */
export interface MySQLBinlogReaderOptions extends WALReaderOptions {
  /** MySQL host */
  host: string
  /** MySQL port */
  port?: number
  /** MySQL user with REPLICATION SLAVE privilege */
  user: string
  /** MySQL password */
  password: string
  /** Server ID (must be unique among replicas) */
  serverId: number
  /** Use GTID-based replication */
  useGtid?: boolean
  /** Starting GTID position */
  startGtid?: GTID
  /** Starting binlog filename */
  startBinlogFile?: string
  /** Starting binlog position */
  startBinlogPosition?: number
  /** Databases to include */
  includeDatabases?: string[]
  /** Databases to exclude */
  excludeDatabases?: string[]
  /** Mock events for testing */
  mockEvents?: BinlogEvent[]
}

/**
 * MySQL binlog reader with GTID support
 */
export class MySQLBinlogReader<T = unknown> implements WALReader<T> {
  private options: MySQLBinlogReaderOptions
  private connected: boolean = false
  private position: WALPosition & { gtid?: GTID } = { sequence: 0 }
  private acknowledgedPosition: WALPosition | null = null
  private entriesProcessed: number = 0
  private errorCount: number = 0
  private eventIndex: number = 0
  private currentGtid: GTID | null = null

  constructor(options: MySQLBinlogReaderOptions) {
    this.options = options

    // Initialize start position
    if (options.startGtid) {
      this.position.gtid = options.startGtid
    }
    if (options.startBinlogFile) {
      this.position.binlogFile = options.startBinlogFile
      this.position.binlogPosition = options.startBinlogPosition ?? 4
    }
  }

  async connect(): Promise<void> {
    // In a real implementation, this would establish a binlog connection
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  getPosition(): WALPosition & { gtid?: GTID } {
    return this.position
  }

  getAcknowledgedPosition(): WALPosition | null {
    return this.acknowledgedPosition
  }

  async acknowledge(position: WALPosition): Promise<void> {
    this.acknowledgedPosition = position
  }

  getState(): WALReaderState {
    return {
      connected: this.connected,
      position: this.position,
      acknowledgedPosition: this.acknowledgedPosition,
      entriesProcessed: this.entriesProcessed,
      errorCount: this.errorCount,
    }
  }

  /**
   * Format GTID set for MySQL replication
   */
  formatGtidSet(gtids: GTID[]): string {
    return gtids
      .map((g) => `${g.uuid}:1-${g.transactionId}`)
      .join(',')
  }

  async *[Symbol.asyncIterator](): AsyncIterator<WALEntry<T>> {
    if (!this.options.mockEvents) return

    while (this.eventIndex < this.options.mockEvents.length && this.connected) {
      const event = this.options.mockEvents[this.eventIndex]!
      this.eventIndex++

      // Handle GTID events
      if (event.type === 'GTID') {
        this.currentGtid = event.gtid ?? null
        continue
      }

      // Handle rotate events
      if (event.type === 'ROTATE') {
        this.position.binlogFile = event.nextFile
        this.position.binlogPosition = 4
        continue
      }

      // Skip if filtered by database
      if (event.schema && this.options.includeDatabases?.length) {
        if (!this.options.includeDatabases.includes(event.schema)) {
          continue
        }
      }
      if (event.schema && this.options.excludeDatabases?.length) {
        if (this.options.excludeDatabases.includes(event.schema)) {
          continue
        }
      }

      // Skip if filtered by table
      if (event.table && this.options.includeTables?.length) {
        if (!this.options.includeTables.includes(event.table)) {
          continue
        }
      }

      // Skip if before start GTID
      if (this.options.useGtid && this.options.startGtid && event.gtid) {
        if (
          event.gtid.uuid === this.options.startGtid.uuid &&
          event.gtid.transactionId <= this.options.startGtid.transactionId
        ) {
          continue
        }
      }

      // Parse row events
      const entries = this.parseBinlogEvent(event)
      for (const entry of entries) {
        this.entriesProcessed++
        this.position = entry.position
        if (event.gtid) {
          this.position.gtid = event.gtid
        }
        yield entry
      }
    }
  }

  private parseBinlogEvent(event: BinlogEvent): WALEntry<T>[] {
    if (!event.rows || !event.schema || !event.table) {
      return []
    }

    const entries: WALEntry<T>[] = []

    for (const row of event.rows) {
      const basePosition: WALPosition = {
        binlogFile: event.position.filename,
        binlogPosition: event.position.position,
        sequence: this.entriesProcessed + 1,
        timestamp: event.timestamp,
      }

      if (this.currentGtid) {
        basePosition.gtid = this.currentGtid
      }

      const baseEntry = {
        position: basePosition,
        table: event.table,
        schema: event.schema,
        timestamp: event.timestamp,
      }

      switch (event.type) {
        case 'WRITE_ROWS':
          entries.push({
            ...baseEntry,
            operation: WALOperationType.INSERT,
            before: null,
            after: row as T,
          })
          break

        case 'UPDATE_ROWS':
          if ('before' in row && 'after' in row) {
            entries.push({
              ...baseEntry,
              operation: WALOperationType.UPDATE,
              before: row.before as T,
              after: row.after as T,
            })
          }
          break

        case 'DELETE_ROWS':
          entries.push({
            ...baseEntry,
            operation: WALOperationType.DELETE,
            before: row as T,
            after: null,
          })
          break
      }
    }

    return entries
  }
}

/**
 * Factory function for MySQL binlog reader
 */
export function createMySQLBinlogReader<T = unknown>(
  options: MySQLBinlogReaderOptions
): MySQLBinlogReader<T> {
  return new MySQLBinlogReader<T>(options)
}

// ============================================================================
// SQLITE CHANGE CAPTURE
// ============================================================================

/**
 * SQLite change record
 */
export interface SQLiteChange<T> {
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  rowid: number
  before: T | null
  after: T | null
  timestamp: number
  sessionId?: string
}

/**
 * Options for SQLite change capture
 */
export interface SQLiteChangeCaptureOptions<T> extends WALReaderOptions {
  /** Table name to capture changes from */
  tableName: string
  /** Session ID for change tracking */
  sessionId?: string
  /** Filter changes by session ID */
  filterSessionId?: string
  /** Retention period for change log (ms) */
  retentionMs?: number
  /** Starting rowid */
  startRowid?: number
  /** Use in-memory database */
  inMemory?: boolean
  /** Callback for change logging */
  onChange?: (change: SQLiteChange<T>) => Promise<void>
  /** Callback for change table creation */
  onCreateChangeTable?: (tableName: string) => void
  /** Callback for change logging */
  onLogChange?: (change: SQLiteChange<T>) => Promise<void>
  /** Callback for cleanup */
  onCleanup?: () => void
}

/**
 * Options for capture methods
 */
interface CaptureMethodOptions {
  sessionId?: string
  rowid?: number
}

/**
 * SQLite trigger-based change capture
 */
export class SQLiteChangeCapture<T = unknown> implements WALReader<T> {
  private options: SQLiteChangeCaptureOptions<T>
  private connected: boolean = false
  private position: WALPosition = { sequence: 0, rowid: 0 }
  private acknowledgedPosition: WALPosition | null = null
  private entriesProcessed: number = 0
  private errorCount: number = 0
  private pendingChanges: SQLiteChange<T>[] = []
  private nextRowid: number = 1

  constructor(options: SQLiteChangeCaptureOptions<T>) {
    this.options = options
    if (options.startRowid) {
      this.position.rowid = options.startRowid
    }
  }

  async connect(): Promise<void> {
    // Create change log table
    const changeTableName = `${this.options.tableName}_changes`
    if (this.options.onCreateChangeTable) {
      this.options.onCreateChangeTable(changeTableName)
    }

    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  getPosition(): WALPosition {
    return this.position
  }

  getAcknowledgedPosition(): WALPosition | null {
    return this.acknowledgedPosition
  }

  async acknowledge(position: WALPosition): Promise<void> {
    this.acknowledgedPosition = position
  }

  getState(): WALReaderState {
    return {
      connected: this.connected,
      position: this.position,
      acknowledgedPosition: this.acknowledgedPosition,
      entriesProcessed: this.entriesProcessed,
      errorCount: this.errorCount,
    }
  }

  /**
   * Capture an INSERT change
   */
  async captureInsert(record: T, options?: CaptureMethodOptions): Promise<void> {
    const rowid = options?.rowid ?? this.nextRowid++
    const change: SQLiteChange<T> = {
      operation: 'INSERT',
      rowid,
      before: null,
      after: record,
      timestamp: Date.now(),
      sessionId: options?.sessionId ?? this.options.sessionId,
    }

    await this.addChange(change)
  }

  /**
   * Capture an UPDATE change
   */
  async captureUpdate(before: T, after: T, options?: CaptureMethodOptions): Promise<void> {
    const rowid = options?.rowid ?? this.nextRowid++
    const change: SQLiteChange<T> = {
      operation: 'UPDATE',
      rowid,
      before,
      after,
      timestamp: Date.now(),
      sessionId: options?.sessionId ?? this.options.sessionId,
    }

    await this.addChange(change)
  }

  /**
   * Capture a DELETE change
   */
  async captureDelete(record: T, options?: CaptureMethodOptions): Promise<void> {
    const rowid = options?.rowid ?? this.nextRowid++
    const change: SQLiteChange<T> = {
      operation: 'DELETE',
      rowid,
      before: record,
      after: null,
      timestamp: Date.now(),
      sessionId: options?.sessionId ?? this.options.sessionId,
    }

    await this.addChange(change)
  }

  /**
   * Cleanup old changes
   */
  async cleanup(): Promise<void> {
    if (this.options.onCleanup) {
      this.options.onCleanup()
    }
  }

  private async addChange(change: SQLiteChange<T>): Promise<void> {
    // Filter by session if configured
    if (this.options.filterSessionId && change.sessionId !== this.options.filterSessionId) {
      return
    }

    // Filter by start rowid
    if (this.options.startRowid && change.rowid <= this.options.startRowid) {
      return
    }

    // Log the change
    if (this.options.onLogChange) {
      await this.options.onLogChange(change)
    }

    this.pendingChanges.push(change)

    // Notify change handler
    if (this.options.onChange) {
      await this.options.onChange(change)
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<WALEntry<T>> {
    while (this.connected) {
      // Wait for changes if none pending
      if (this.pendingChanges.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10))

        // Check if still connected and have changes
        if (!this.connected || this.pendingChanges.length === 0) {
          // If no more changes and not connected, exit
          if (!this.connected) break
          continue
        }
      }

      const change = this.pendingChanges.shift()
      if (!change) continue

      const entry: WALEntry<T> = {
        position: {
          rowid: change.rowid,
          sequence: this.entriesProcessed + 1,
          timestamp: change.timestamp,
        },
        operation: change.operation === 'INSERT'
          ? WALOperationType.INSERT
          : change.operation === 'UPDATE'
            ? WALOperationType.UPDATE
            : WALOperationType.DELETE,
        table: this.options.tableName,
        schema: 'main',
        before: change.before,
        after: change.after,
        timestamp: change.timestamp,
        metadata: change.sessionId ? { sessionId: change.sessionId } : undefined,
      }

      this.entriesProcessed++
      this.position = entry.position

      yield entry
    }
  }
}

/**
 * Factory function for SQLite change capture
 */
export function createSQLiteChangeCapture<T = unknown>(
  options: SQLiteChangeCaptureOptions<T>
): SQLiteChangeCapture<T> {
  return new SQLiteChangeCapture<T>(options)
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse a position string into WALPosition
 */
export function parseWALPosition(positionStr: string): WALPosition {
  // PostgreSQL LSN format: "0/1000" or "16/B374D848"
  if (positionStr.includes('/') && !positionStr.includes(':')) {
    const [segment, offset] = positionStr.split('/')
    const sequence = parseInt(segment!, 16) * 0x100000000 + parseInt(offset!, 16)
    return { lsn: positionStr, sequence }
  }

  // MySQL binlog format: "mysql-bin.000001:1000"
  if (positionStr.includes(':') && positionStr.includes('mysql-bin')) {
    const [file, posStr] = positionStr.split(':')
    const position = parseInt(posStr!, 10)
    return {
      binlogFile: file,
      binlogPosition: position,
      sequence: position,
    }
  }

  // SQLite rowid format: "rowid:12345"
  if (positionStr.startsWith('rowid:')) {
    const rowid = parseInt(positionStr.slice(6), 10)
    return { rowid, sequence: rowid }
  }

  // Default: try to parse as number
  const num = parseInt(positionStr, 10)
  return { sequence: isNaN(num) ? 0 : num }
}

/**
 * Compare two WAL positions
 * Returns negative if a < b, positive if a > b, 0 if equal
 */
export function compareWALPositions(a: WALPosition, b: WALPosition): number {
  // Compare by sequence if both have it
  if (a.sequence !== undefined && b.sequence !== undefined) {
    return a.sequence - b.sequence
  }

  // Compare PostgreSQL LSN
  if (a.lsn && b.lsn) {
    const parseLSN = (lsn: string): number => {
      const [segment, offset] = lsn.split('/')
      return parseInt(segment!, 16) * 0x100000000 + parseInt(offset!, 16)
    }
    return parseLSN(a.lsn) - parseLSN(b.lsn)
  }

  // Compare MySQL binlog position
  if (a.binlogFile && b.binlogFile) {
    const fileCompare = a.binlogFile.localeCompare(b.binlogFile)
    if (fileCompare !== 0) return fileCompare
    return (a.binlogPosition ?? 0) - (b.binlogPosition ?? 0)
  }

  // Compare SQLite rowid
  if (a.rowid !== undefined && b.rowid !== undefined) {
    return a.rowid - b.rowid
  }

  return 0
}
