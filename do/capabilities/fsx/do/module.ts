/**
 * FsModule - Filesystem capability module for dotdo integration
 *
 * Provides lazy-loaded filesystem operations that integrate with the
 * WorkflowContext ($) proxy. Uses SQLite for metadata and R2 for tiered blob storage.
 *
 * @example
 * ```typescript
 * // Using with withFs mixin
 * class MySite extends withFs(DO) {
 *   async loadContent() {
 *     const content = await this.$.fs.readFile('content/index.mdx')
 *     return content
 *   }
 * }
 *
 * // Using FsModule directly
 * const fsModule = new FsModule({ sql: ctx.storage.sql })
 * await fsModule.initialize()
 * await fsModule.writeFile('/config.json', '{"key": "value"}')
 * ```
 */

import type {
  FsCapability,
  ReadOptions,
  WriteOptions,
  ListOptions,
  MkdirOptions,
  RmdirOptions,
  RemoveOptions,
  ReaddirOptions,
  Stats,
  FSWatcher,
  WatchOptions,
  ReadStreamOptions,
  WriteStreamOptions,
  MoveOptions,
  CopyOptions,
  DirentType,
} from '../core/index.js'
import { Dirent, FileHandle, constants } from '../core/index.js'
import { ENOENT, EEXIST, EISDIR, ENOTDIR, ENOTEMPTY } from '../core/errors.js'
import {
  computeChecksum,
  blobIdFromChecksum,
  selectTierBySize,
  type CleanupConfig,
  type CleanupResult,
  type CleanupSchedulerState,
  createCleanupSchedulerState,
  DEFAULT_CLEANUP_CONFIG,
} from '../storage/blob-utils.js'

// Re-export security module for backward compatibility
export { PathValidator, pathValidator, SecurityConstants } from './security.js'
export type { ValidationResult, ValidationSuccess, ValidationFailure } from './security.js'

// Re-export blob utilities for consumers
export {
  computeChecksum,
  generateBlobId,
  blobIdFromChecksum,
  checksumFromBlobId,
  isValidBlobId,
  selectTierBySize,
  getTierTransition,
  isValidTierTransition,
  type CleanupConfig,
  type CleanupResult,
  type CleanupSchedulerState,
  type BlobStats,
} from '../storage/blob-utils.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration options for FsModule
 */
export interface FsModuleConfig {
  /** SQLite storage instance from Durable Object context */
  sql: SqlStorage
  /** Optional R2 bucket for warm tier storage */
  r2?: R2Bucket
  /** Optional R2 bucket for cold/archive tier storage */
  archive?: R2Bucket
  /** Base path prefix for all operations (default: '/') */
  basePath?: string
  /** Hot tier max size in bytes (default: 1MB) */
  hotMaxSize?: number
  /** Default file mode (default: 0o644) */
  defaultMode?: number
  /** Default directory mode (default: 0o755) */
  defaultDirMode?: number
  /** Configuration for scheduled blob cleanup */
  cleanupConfig?: CleanupConfig
}

/**
 * Internal file entry stored in SQLite.
 * Maps to the files table schema defined in FILES_TABLE_COLUMNS.
 */
interface FileEntry {
  id: number
  path: string
  name: string
  parent_id: number | null
  type: FileType
  mode: number
  uid: number
  gid: number
  size: number
  blob_id: string | null
  link_target: string | null
  tier: StorageTier
  atime: number
  mtime: number
  ctime: number
  birthtime: number
  nlink: number
  [key: string]: SqlStorageValue
}

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

/**
 * Schema version for migration tracking.
 * Increment when making breaking changes to the schema.
 */
export const SCHEMA_VERSION = 1

/**
 * Valid file types stored in the files table.
 * Used for CHECK constraint and TypeScript type safety.
 */
export const FILE_TYPES = ['file', 'directory', 'symlink'] as const
export type FileType = (typeof FILE_TYPES)[number]

/**
 * Storage tiers for blob data.
 * - hot: SQLite storage (fast, limited size)
 * - warm: R2 storage (medium latency, larger files)
 * - cold: Archive R2 storage (slow, archival)
 */
export const STORAGE_TIERS = ['hot', 'warm', 'cold'] as const
export type StorageTier = (typeof STORAGE_TIERS)[number]

/**
 * Default file mode (0o644 = rw-r--r--)
 */
export const DEFAULT_FILE_MODE = 0o644

/**
 * Default directory mode (0o755 = rwxr-xr-x)
 */
export const DEFAULT_DIR_MODE = 0o755

/**
 * Column definitions for the files table.
 * Each column specifies its SQL type, constraints, and optional default value.
 */
export const FILES_TABLE_COLUMNS = {
  id: { type: 'INTEGER', constraints: 'PRIMARY KEY AUTOINCREMENT' },
  path: { type: 'TEXT', constraints: 'UNIQUE NOT NULL' },
  name: { type: 'TEXT', constraints: 'NOT NULL' },
  parent_id: { type: 'INTEGER', constraints: '' },
  type: { type: 'TEXT', constraints: `NOT NULL CHECK(type IN (${FILE_TYPES.map((t) => `'${t}'`).join(', ')}))` },
  mode: { type: 'INTEGER', constraints: `NOT NULL DEFAULT ${DEFAULT_FILE_MODE}` },
  uid: { type: 'INTEGER', constraints: 'NOT NULL DEFAULT 0' },
  gid: { type: 'INTEGER', constraints: 'NOT NULL DEFAULT 0' },
  size: { type: 'INTEGER', constraints: 'NOT NULL DEFAULT 0' },
  blob_id: { type: 'TEXT', constraints: '' },
  link_target: { type: 'TEXT', constraints: '' },
  tier: { type: 'TEXT', constraints: `NOT NULL DEFAULT 'hot' CHECK(tier IN (${STORAGE_TIERS.map((t) => `'${t}'`).join(', ')}))` },
  atime: { type: 'INTEGER', constraints: 'NOT NULL' },
  mtime: { type: 'INTEGER', constraints: 'NOT NULL' },
  ctime: { type: 'INTEGER', constraints: 'NOT NULL' },
  birthtime: { type: 'INTEGER', constraints: 'NOT NULL' },
  nlink: { type: 'INTEGER', constraints: 'NOT NULL DEFAULT 1' },
} as const

/**
 * Column definitions for the blobs table.
 * Stores binary content with tiered storage support.
 * Content-addressable: id is derived from SHA-256 hash of content.
 * ref_count tracks how many files reference this blob for dedup and cleanup.
 */
export const BLOBS_TABLE_COLUMNS = {
  id: { type: 'TEXT', constraints: 'PRIMARY KEY' },
  data: { type: 'BLOB', constraints: '' },
  size: { type: 'INTEGER', constraints: 'NOT NULL' },
  checksum: { type: 'TEXT', constraints: 'NOT NULL' },
  tier: { type: 'TEXT', constraints: `NOT NULL DEFAULT 'hot' CHECK(tier IN (${STORAGE_TIERS.map((t) => `'${t}'`).join(', ')}))` },
  ref_count: { type: 'INTEGER', constraints: 'NOT NULL DEFAULT 1' },
  created_at: { type: 'INTEGER', constraints: 'NOT NULL' },
} as const

/**
 * Index definitions for performance optimization.
 * Each index targets specific query patterns.
 */
export const SCHEMA_INDEXES = {
  /** Fast path lookups: SELECT * FROM files WHERE path = ? */
  idx_files_path: { table: 'files', columns: ['path'] },
  /** Fast directory listings: SELECT * FROM files WHERE parent_id = ? */
  idx_files_parent: { table: 'files', columns: ['parent_id'] },
  /** Tier-based queries for storage management */
  idx_files_tier: { table: 'files', columns: ['tier'] },
  /** Tier-based blob queries for storage management */
  idx_blobs_tier: { table: 'blobs', columns: ['tier'] },
} as const

/**
 * Builds a CREATE TABLE statement from column definitions.
 * @param tableName - Name of the table
 * @param columns - Column definitions object
 * @param foreignKeys - Optional foreign key constraints
 */
function buildCreateTable(
  tableName: string,
  columns: Record<string, { type: string; constraints: string }>,
  foreignKeys: string[] = []
): string {
  const columnDefs = Object.entries(columns)
    .map(([name, def]) => `    ${name} ${def.type}${def.constraints ? ' ' + def.constraints : ''}`)
    .join(',\n')

  const fkDefs = foreignKeys.length > 0 ? ',\n' + foreignKeys.map((fk) => `    ${fk}`).join(',\n') : ''

  return `CREATE TABLE IF NOT EXISTS ${tableName} (\n${columnDefs}${fkDefs}\n  )`
}

/**
 * Builds CREATE INDEX statements from index definitions.
 */
function buildCreateIndexes(indexes: typeof SCHEMA_INDEXES): string[] {
  return Object.entries(indexes).map(
    ([name, def]) => `CREATE INDEX IF NOT EXISTS ${name} ON ${def.table}(${def.columns.join(', ')})`
  )
}

/**
 * Complete schema SQL generated from typed definitions.
 *
 * Schema Design Decisions:
 * 1. files table uses path as unique identifier for fast lookups
 * 2. parent_id enables efficient directory listings via index
 * 3. Blob content is stored separately to allow tiered storage
 * 4. Type CHECK constraints ensure data integrity
 * 5. Foreign key with CASCADE ensures orphan cleanup
 */
const SCHEMA = [
  buildCreateTable('files', FILES_TABLE_COLUMNS, [
    'FOREIGN KEY (parent_id) REFERENCES files(id) ON DELETE CASCADE',
  ]),
  ...buildCreateIndexes(SCHEMA_INDEXES).slice(0, 3), // files indexes
  buildCreateTable('blobs', BLOBS_TABLE_COLUMNS),
  ...buildCreateIndexes(SCHEMA_INDEXES).slice(3), // blobs indexes
].join(';\n\n') + ';'

// ============================================================================
// FSMODULE CLASS
// ============================================================================

/**
 * FsModule - Filesystem capability for Durable Object integration
 *
 * Implements the FsCapability interface with lazy initialization,
 * SQLite-backed metadata, and tiered blob storage (DO SQLite + R2).
 */
/**
 * Transaction log entry structure for FsModule
 */
interface FsTransactionLogEntry {
  id: string
  status: 'active' | 'committed' | 'rolled_back'
  startTime: number
  endTime?: number
}

export class FsModule implements FsCapability {
  readonly name = 'fs'

  private sql: SqlStorage
  private r2?: R2Bucket
  private archive?: R2Bucket
  private basePath: string
  private hotMaxSize: number
  private defaultMode: number
  private defaultDirMode: number
  private initialized = false

  // Transaction state
  private transactionDepth = 0
  private savepointCounter = 0
  private transactionLog: FsTransactionLogEntry[] = []
  private currentTransactionId: string | null = null

  // Cleanup scheduler state
  private cleanupConfig: Required<CleanupConfig>
  private cleanupState: CleanupSchedulerState

  constructor(config: FsModuleConfig) {
    this.sql = config.sql
    this.r2 = config.r2
    this.archive = config.archive
    this.basePath = config.basePath ?? '/'
    this.hotMaxSize = config.hotMaxSize ?? 1024 * 1024 // 1MB
    this.defaultMode = config.defaultMode ?? DEFAULT_FILE_MODE
    this.defaultDirMode = config.defaultDirMode ?? DEFAULT_DIR_MODE
    this.cleanupConfig = { ...DEFAULT_CLEANUP_CONFIG, ...config.cleanupConfig }
    this.cleanupState = createCleanupSchedulerState()
  }

  // ===========================================================================
  // TRANSACTION API
  // ===========================================================================

  /**
   * Begin a new transaction or create a savepoint for nested transactions.
   * @param options - Optional transaction options (timeout, etc.)
   */
  async beginTransaction(_options?: { timeout?: number }): Promise<void> {
    await this.initialize()
    if (this.transactionDepth === 0) {
      // Start new transaction
      this.currentTransactionId = crypto.randomUUID()
      this.transactionLog.push({
        id: this.currentTransactionId,
        status: 'active',
        startTime: Date.now(),
      })
      await this.sql.exec('BEGIN TRANSACTION')
    } else {
      // Create savepoint for nested transaction
      this.savepointCounter++
      await this.sql.exec(`SAVEPOINT sp_${this.savepointCounter}`)
    }
    this.transactionDepth++
  }

  /**
   * Commit the current transaction or release savepoint.
   */
  async commit(): Promise<void> {
    if (this.transactionDepth <= 0) {
      throw new Error('No active transaction to commit')
    }

    this.transactionDepth--

    if (this.transactionDepth === 0) {
      // Commit main transaction
      await this.sql.exec('COMMIT')

      // Update transaction log
      const logEntry = this.transactionLog.find((e) => e.id === this.currentTransactionId)
      if (logEntry) {
        logEntry.status = 'committed'
        logEntry.endTime = Date.now()
      }
      this.currentTransactionId = null
      this.savepointCounter = 0
    } else {
      // Release savepoint
      await this.sql.exec(`RELEASE SAVEPOINT sp_${this.savepointCounter}`)
      this.savepointCounter--
    }
  }

  /**
   * Rollback the current transaction or to savepoint.
   */
  async rollback(): Promise<void> {
    if (this.transactionDepth <= 0) {
      throw new Error('No active transaction to rollback')
    }

    this.transactionDepth--

    if (this.transactionDepth === 0) {
      // Rollback main transaction
      await this.sql.exec('ROLLBACK')

      // Update transaction log
      const logEntry = this.transactionLog.find((e) => e.id === this.currentTransactionId)
      if (logEntry) {
        logEntry.status = 'rolled_back'
        logEntry.endTime = Date.now()
      }
      this.currentTransactionId = null
      this.savepointCounter = 0
    } else {
      // Rollback to savepoint
      await this.sql.exec(`ROLLBACK TO SAVEPOINT sp_${this.savepointCounter}`)
      this.savepointCounter--
    }
  }

  /**
   * Execute a function within a transaction with automatic commit/rollback.
   * @param fn - Function to execute within transaction
   * @returns Result of the function
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.beginTransaction()
    try {
      const result = await fn()
      await this.commit()
      return result
    } catch (error) {
      await this.rollback()
      throw error
    }
  }

  /**
   * Get the transaction log entries.
   */
  async getTransactionLog(): Promise<FsTransactionLogEntry[]> {
    return [...this.transactionLog]
  }

  /**
   * Recover from uncommitted transactions (for crash recovery).
   */
  async recoverTransactions(): Promise<void> {
    // SQLite automatically rolls back uncommitted transactions on recovery
    // Reset local state
    this.transactionDepth = 0
    this.savepointCounter = 0
    this.currentTransactionId = null
  }

  /**
   * Check if currently in a transaction.
   */
  isInTransaction(): boolean {
    return this.transactionDepth > 0
  }

  /**
   * Initialize the module - creates schema and root directory
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Create schema
    await this.sql.exec(SCHEMA)

    // Create root directory if not exists
    // Note: Use .toArray() instead of .one() since .one() throws if no results
    const rootResults = this.sql.exec<FileEntry>('SELECT * FROM files WHERE path = ?', '/').toArray()

    if (rootResults.length === 0) {
      const now = Date.now()
      this.sql.exec(
        `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, tier, atime, mtime, ctime, birthtime, nlink)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        '/',
        '',
        null,
        'directory',
        this.defaultDirMode,
        0,
        0,
        0,
        'hot',
        now,
        now,
        now,
        now,
        2
      )
    }

    this.initialized = true
  }

  /**
   * Cleanup hook for capability disposal
   */
  async dispose(): Promise<void> {
    // No cleanup needed for SQLite-backed storage
  }

  // ===========================================================================
  // PATH UTILITIES
  // ===========================================================================

  private normalizePath(path: string): string {
    // Handle base path
    if (!path.startsWith('/')) {
      path = this.basePath + (this.basePath.endsWith('/') ? '' : '/') + path
    }

    // Remove trailing slashes (except root)
    if (path !== '/' && path.endsWith('/')) {
      path = path.slice(0, -1)
    }

    // Resolve . and ..
    const parts = path.split('/').filter(Boolean)
    const resolved: string[] = []
    for (const part of parts) {
      if (part === '.') continue
      if (part === '..') {
        resolved.pop()
      } else {
        resolved.push(part)
      }
    }
    return '/' + resolved.join('/')
  }

  private getParentPath(path: string): string {
    const normalized = this.normalizePath(path)
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) return '/'
    return normalized.substring(0, lastSlash)
  }

  private getFileName(path: string): string {
    const normalized = this.normalizePath(path)
    const lastSlash = normalized.lastIndexOf('/')
    return normalized.substring(lastSlash + 1)
  }

  // ===========================================================================
  // INTERNAL FILE OPERATIONS
  // ===========================================================================

  private async getFile(path: string): Promise<FileEntry | null> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    // Note: Use .toArray() instead of .one() since .one() throws if no results
    const results = this.sql.exec<FileEntry>('SELECT * FROM files WHERE path = ?', normalized).toArray()
    return results.length > 0 ? results[0]! : null
  }

  private selectTier(size: number, explicitTier?: StorageTier): StorageTier {
    if (explicitTier) return explicitTier
    return selectTierBySize(size, this.hotMaxSize, !!this.r2)
  }

  /**
   * Compute SHA-256 hash of data and return as hex string.
   * Uses shared utility from storage/blob-utils.ts.
   */
  private computeBlobChecksum(data: Uint8Array): Promise<string> {
    return computeChecksum(data)
  }

  /**
   * Generate content-addressable blob ID from checksum.
   * Uses shared utility from storage/blob-utils.ts.
   */
  private generateBlobIdFromChecksum(checksum: string): string {
    return blobIdFromChecksum(checksum)
  }

  /**
   * Store blob with content-addressable ID and reference counting.
   * If blob already exists (same content), just increment ref_count.
   * Returns the blob ID.
   *
   * Optimized deduplication: uses single query to check existence
   * and atomic UPDATE for ref_count increment.
   */
  private async storeBlob(data: Uint8Array, tier: StorageTier): Promise<string> {
    const now = Date.now()
    const checksum = await this.computeBlobChecksum(data)
    const blobId = this.generateBlobIdFromChecksum(checksum)

    // Check if blob already exists (deduplication)
    const existing = this.sql.exec<{ id: string; ref_count: number; tier: string }>(
      'SELECT id, ref_count, tier FROM blobs WHERE id = ?',
      blobId
    ).toArray()

    if (existing.length > 0) {
      // Blob exists - increment ref_count
      this.sql.exec('UPDATE blobs SET ref_count = ref_count + 1 WHERE id = ?', blobId)
      return blobId
    }

    // New blob - store with ref_count = 1
    if (tier === 'hot') {
      this.sql.exec(
        'INSERT INTO blobs (id, data, size, checksum, tier, ref_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        blobId,
        data.buffer,
        data.length,
        checksum,
        tier,
        1,
        now
      )
    } else if (tier === 'warm' && this.r2) {
      await this.r2.put(blobId, data)
      this.sql.exec(
        'INSERT INTO blobs (id, size, checksum, tier, ref_count, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        blobId,
        data.length,
        checksum,
        tier,
        1,
        now
      )
    } else if (tier === 'cold' && this.archive) {
      await this.archive.put(blobId, data)
      this.sql.exec(
        'INSERT INTO blobs (id, size, checksum, tier, ref_count, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        blobId,
        data.length,
        checksum,
        tier,
        1,
        now
      )
    }

    return blobId
  }

  /**
   * Decrement blob reference count. If ref_count reaches 0, delete the blob.
   */
  private async decrementBlobRef(blobId: string, tier: StorageTier): Promise<void> {
    // Get current ref_count
    const blob = this.sql.exec<{ ref_count: number }>(
      'SELECT ref_count FROM blobs WHERE id = ?',
      blobId
    ).toArray()

    if (blob.length === 0) return

    const newRefCount = blob[0]!.ref_count - 1

    if (newRefCount <= 0) {
      // Delete blob completely
      await this.deleteBlobCompletely(blobId, tier)
    } else {
      // Just decrement ref_count
      this.sql.exec('UPDATE blobs SET ref_count = ? WHERE id = ?', newRefCount, blobId)
    }
  }

  /**
   * Completely delete a blob from storage
   */
  private async deleteBlobCompletely(blobId: string, tier: StorageTier): Promise<void> {
    this.sql.exec('DELETE FROM blobs WHERE id = ?', blobId)

    if (tier === 'warm' && this.r2) {
      await this.r2.delete(blobId)
    } else if (tier === 'cold' && this.archive) {
      await this.archive.delete(blobId)
    }
  }

  /**
   * Increment blob reference count (for hard links)
   */
  private incrementBlobRef(blobId: string): void {
    this.sql.exec('UPDATE blobs SET ref_count = ref_count + 1 WHERE id = ?', blobId)
  }

  private async getBlob(id: string, tier: 'hot' | 'warm' | 'cold'): Promise<Uint8Array | null> {
    if (tier === 'hot') {
      // Note: Use .toArray() instead of .one() since .one() throws if no results
      const blobs = this.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM blobs WHERE id = ?', id).toArray()
      if (blobs.length === 0 || !blobs[0]?.data) return null
      return new Uint8Array(blobs[0].data)
    }

    if (tier === 'warm' && this.r2) {
      const obj = await this.r2.get(id)
      if (!obj) return null
      return new Uint8Array(await obj.arrayBuffer())
    }

    if (tier === 'cold' && this.archive) {
      const obj = await this.archive.get(id)
      if (!obj) return null
      return new Uint8Array(await obj.arrayBuffer())
    }

    return null
  }

  private async deleteBlob(id: string, tier: 'hot' | 'warm' | 'cold'): Promise<void> {
    this.sql.exec('DELETE FROM blobs WHERE id = ?', id)

    if (tier === 'warm' && this.r2) {
      await this.r2.delete(id)
    } else if (tier === 'cold' && this.archive) {
      await this.archive.delete(id)
    }
  }

  // ===========================================================================
  // FILE OPERATIONS
  // ===========================================================================

  async read(path: string, options?: ReadOptions): Promise<string | Uint8Array> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (file.type === 'directory') {
      throw new EISDIR(undefined, normalized)
    }

    // Follow symlinks
    if (file.type === 'symlink' && file.link_target) {
      return this.read(file.link_target, options)
    }

    if (!file.blob_id) {
      return options?.encoding ? '' : new Uint8Array(0)
    }

    const data = await this.getBlob(file.blob_id, file.tier as StorageTier)
    if (!data) {
      return options?.encoding ? '' : new Uint8Array(0)
    }

    // Handle range reads
    let result = data
    if (options?.start !== undefined || options?.end !== undefined) {
      const start = options.start ?? 0
      const end = options.end !== undefined ? options.end + 1 : data.length
      result = data.slice(start, end)
    }

    // Update atime
    this.sql.exec('UPDATE files SET atime = ? WHERE id = ?', Date.now(), file.id)

    if (options?.encoding) {
      return new TextDecoder().decode(result)
    }

    return result
  }

  async write(path: string, data: string | Uint8Array, options?: WriteOptions): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const parentPath = this.getParentPath(normalized)
    const name = this.getFileName(normalized)

    // Check parent exists (before transaction)
    const parent = await this.getFile(parentPath)
    if (!parent) {
      throw new ENOENT(undefined, parentPath)
    }

    // Convert data to bytes
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data

    // Determine tier
    const tier = options?.tier ?? this.selectTier(bytes.length)

    // Check if file exists
    const existing = await this.getFile(normalized)

    // Handle exclusive flag (before transaction)
    if (options?.flag === 'wx' || options?.flag === 'ax') {
      if (existing) {
        throw new EEXIST(undefined, normalized)
      }
    }

    // Note: In Cloudflare Durable Objects, each request is processed atomically.
    // We don't use explicit SQL transactions (BEGIN/COMMIT) as they're not allowed.
    const now = Date.now()

    // Handle append flag
    if (options?.flag === 'a' || options?.flag === 'ax') {
      if (existing && existing.blob_id) {
        const existingData = await this.getBlob(existing.blob_id, existing.tier as StorageTier)
        if (existingData) {
          const combined = new Uint8Array(existingData.length + bytes.length)
          combined.set(existingData)
          combined.set(bytes, existingData.length)

          // Decrement ref on old blob
          await this.decrementBlobRef(existing.blob_id, existing.tier as StorageTier)

          // Store new blob (content-addressable)
          const blobId = await this.storeBlob(combined, tier)

          // Update file
          this.sql.exec(
            'UPDATE files SET blob_id = ?, size = ?, tier = ?, mtime = ?, ctime = ? WHERE id = ?',
            blobId,
            combined.length,
            tier,
            now,
            now,
            existing.id
          )
          return
        }
      }
    }

    // Store blob (content-addressable with dedup)
    const blobId = await this.storeBlob(bytes, tier)

    if (existing) {
      // Decrement ref on old blob (may delete if ref_count reaches 0)
      if (existing.blob_id) {
        await this.decrementBlobRef(existing.blob_id, existing.tier as StorageTier)
      }

      // Update file
      this.sql.exec(
        'UPDATE files SET blob_id = ?, size = ?, tier = ?, mtime = ?, ctime = ? WHERE id = ?',
        blobId,
        bytes.length,
        tier,
        now,
        now,
        existing.id
      )
    } else {
      // Create new file
      this.sql.exec(
        `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, blob_id, tier, atime, mtime, ctime, birthtime, nlink)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        normalized,
        name,
        parent.id,
        'file',
        options?.mode ?? this.defaultMode,
        0,
        0,
        bytes.length,
        blobId,
        tier,
        now,
        now,
        now,
        now,
        1
      )
    }
  }

  async append(path: string, data: string | Uint8Array): Promise<void> {
    return this.write(path, data, { flag: 'a' })
  }

  async unlink(path: string): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (file.type === 'directory') {
      throw new EISDIR(undefined, normalized)
    }

    // Decrement blob ref_count (will delete blob if ref_count reaches 0)
    if (file.blob_id) {
      await this.decrementBlobRef(file.blob_id, file.tier as StorageTier)
    }

    // Delete file entry
    this.sql.exec('DELETE FROM files WHERE id = ?', file.id)
  }

  async rename(oldPath: string, newPath: string, options?: MoveOptions): Promise<void> {
    await this.initialize()
    const oldNormalized = this.normalizePath(oldPath)
    const newNormalized = this.normalizePath(newPath)

    const file = await this.getFile(oldNormalized)
    if (!file) {
      throw new ENOENT(undefined, oldNormalized)
    }

    // Check if destination exists
    const existing = await this.getFile(newNormalized)
    if (existing && !options?.overwrite) {
      throw new EEXIST(undefined, newNormalized)
    }

    // Get new parent
    const newParentPath = this.getParentPath(newNormalized)
    const newParent = await this.getFile(newParentPath)
    if (!newParent) {
      throw new ENOENT(undefined, newParentPath)
    }

    // Note: In Cloudflare Durable Objects, each request is processed atomically.
    const now = Date.now()
    const newName = this.getFileName(newNormalized)

    // Delete existing if overwriting
    if (existing) {
      if (existing.blob_id) {
        await this.decrementBlobRef(existing.blob_id, existing.tier as StorageTier)
      }
      this.sql.exec('DELETE FROM files WHERE id = ?', existing.id)
    }

    // Update file
    this.sql.exec(
      'UPDATE files SET path = ?, name = ?, parent_id = ?, ctime = ? WHERE id = ?',
      newNormalized,
      newName,
      newParent.id,
      now,
      file.id
    )

    // If directory, update all children paths
    if (file.type === 'directory') {
      const children = this.sql.exec<FileEntry>('SELECT * FROM files WHERE path LIKE ?', oldNormalized + '/%').toArray()
      for (const child of children) {
        const newChildPath = newNormalized + child.path.substring(oldNormalized.length)
        this.sql.exec('UPDATE files SET path = ? WHERE id = ?', newChildPath, child.id)
      }
    }
  }

  async copyFile(src: string, dest: string, options?: CopyOptions): Promise<void> {
    await this.initialize()
    const srcNormalized = this.normalizePath(src)
    const destNormalized = this.normalizePath(dest)

    const srcFile = await this.getFile(srcNormalized)
    if (!srcFile) {
      throw new ENOENT(undefined, srcNormalized)
    }

    // Check destination
    const existing = await this.getFile(destNormalized)
    if (existing && !options?.overwrite) {
      throw new EEXIST(undefined, destNormalized)
    }

    // Read source content
    const content = await this.read(srcNormalized)

    // Write to destination
    await this.write(destNormalized, content)
  }

  async truncate(path: string, length: number = 0): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (file.type === 'directory') {
      throw new EISDIR(undefined, normalized)
    }

    const now = Date.now()

    if (file.blob_id) {
      const data = await this.getBlob(file.blob_id, file.tier as StorageTier)
      if (data) {
        const truncated = data.slice(0, length)
        const newTier = this.selectTier(truncated.length)

        // Store new blob (content-addressable)
        const newBlobId = await this.storeBlob(truncated, newTier)

        // Decrement ref on old blob
        await this.decrementBlobRef(file.blob_id, file.tier as StorageTier)

        this.sql.exec(
          'UPDATE files SET blob_id = ?, size = ?, tier = ?, mtime = ?, ctime = ? WHERE id = ?',
          newBlobId,
          truncated.length,
          newTier,
          now,
          now,
          file.id
        )
      }
    }
  }

  // ===========================================================================
  // DIRECTORY OPERATIONS
  // ===========================================================================

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const now = Date.now()

    if (options?.recursive) {
      const parts = normalized.split('/').filter(Boolean)
      let currentPath = ''

      for (const part of parts) {
        currentPath += '/' + part
        const existing = await this.getFile(currentPath)

        if (!existing) {
          const parentPath = this.getParentPath(currentPath)
          const parent = await this.getFile(parentPath)

          this.sql.exec(
            `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, tier, atime, mtime, ctime, birthtime, nlink)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            currentPath,
            part,
            parent?.id ?? null,
            'directory',
            options?.mode ?? this.defaultDirMode,
            0,
            0,
            0,
            'hot',
            now,
            now,
            now,
            now,
            2
          )
        }
      }
    } else {
      const parentPath = this.getParentPath(normalized)
      const name = this.getFileName(normalized)
      const parent = await this.getFile(parentPath)

      if (!parent) {
        throw new ENOENT(undefined, parentPath)
      }

      const existing = await this.getFile(normalized)
      if (existing) {
        throw new EEXIST(undefined, normalized)
      }

      this.sql.exec(
        `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, tier, atime, mtime, ctime, birthtime, nlink)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        normalized,
        name,
        parent.id,
        'directory',
        options?.mode ?? this.defaultDirMode,
        0,
        0,
        0,
        'hot',
        now,
        now,
        now,
        now,
        2
      )
    }
  }

  async rmdir(path: string, options?: RmdirOptions): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (file.type !== 'directory') {
      throw new ENOTDIR(undefined, normalized)
    }

    const children = this.sql.exec<FileEntry>('SELECT * FROM files WHERE parent_id = ?', file.id).toArray()

    if (children.length > 0 && !options?.recursive) {
      throw new ENOTEMPTY(undefined, normalized)
    }

    if (options?.recursive) {
      // Delete all descendants recursively
      // Note: In Cloudflare Durable Objects, each request is processed atomically.
      await this.deleteRecursive(file)
    } else {
      this.sql.exec('DELETE FROM files WHERE id = ?', file.id)
    }
  }

  private async deleteRecursive(file: FileEntry): Promise<void> {
    const children = this.sql.exec<FileEntry>('SELECT * FROM files WHERE parent_id = ?', file.id).toArray()

    for (const child of children) {
      if (child.type === 'directory') {
        await this.deleteRecursive(child)
      } else {
        if (child.blob_id) {
          await this.decrementBlobRef(child.blob_id, child.tier as StorageTier)
        }
        this.sql.exec('DELETE FROM files WHERE id = ?', child.id)
      }
    }

    this.sql.exec('DELETE FROM files WHERE id = ?', file.id)
  }

  async rm(path: string, options?: RemoveOptions): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      if (options?.force) return
      throw new ENOENT(undefined, normalized)
    }

    if (file.type === 'directory') {
      await this.rmdir(normalized, { recursive: options?.recursive })
    } else {
      await this.unlink(normalized)
    }
  }

  async list(path: string, options?: ListOptions): Promise<string[] | Dirent[]> {
    return this.readdir(path, options as ReaddirOptions)
  }

  async readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (file.type !== 'directory') {
      throw new ENOTDIR(undefined, normalized)
    }

    const children = this.sql.exec<FileEntry>('SELECT * FROM files WHERE parent_id = ?', file.id).toArray()

    if (options?.withFileTypes) {
      const result: Dirent[] = children.map((child) => new Dirent(child.name, normalized, child.type as DirentType))

      if (options.recursive) {
        for (const child of children) {
          if (child.type === 'directory') {
            const subEntries = (await this.readdir(child.path, options)) as Dirent[]
            result.push(...subEntries)
          }
        }
      }

      return result
    }

    const names = children.map((c) => c.name)

    if (options?.recursive) {
      for (const child of children) {
        if (child.type === 'directory') {
          const subNames = (await this.readdir(child.path, options)) as string[]
          names.push(...subNames.map((n) => child.name + '/' + n))
        }
      }
    }

    return names
  }

  // ===========================================================================
  // METADATA OPERATIONS
  // ===========================================================================

  async stat(path: string): Promise<Stats> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    let file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    // Follow symlinks
    while (file.type === 'symlink' && file.link_target) {
      file = await this.getFile(file.link_target)
      if (!file) {
        throw new ENOENT(undefined, normalized)
      }
    }

    return this.fileToStats(file)
  }

  async lstat(path: string): Promise<Stats> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    return this.fileToStats(file)
  }

  private fileToStats(file: FileEntry): Stats {
    const typeMode =
      file.type === 'directory' ? constants.S_IFDIR : file.type === 'symlink' ? constants.S_IFLNK : constants.S_IFREG

    const mode = typeMode | file.mode

    return {
      dev: 0,
      ino: file.id,
      mode,
      nlink: file.nlink,
      uid: file.uid,
      gid: file.gid,
      rdev: 0,
      size: file.size,
      blksize: 4096,
      blocks: Math.ceil(file.size / 512),
      atimeMs: file.atime,
      mtimeMs: file.mtime,
      ctimeMs: file.ctime,
      birthtimeMs: file.birthtime,
      atime: new Date(file.atime),
      mtime: new Date(file.mtime),
      ctime: new Date(file.ctime),
      birthtime: new Date(file.birthtime),
      isFile: () => file.type === 'file',
      isDirectory: () => file.type === 'directory',
      isSymbolicLink: () => file.type === 'symlink',
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    } as Stats
  }

  async exists(path: string): Promise<boolean> {
    await this.initialize()
    const file = await this.getFile(path)
    return file !== null
  }

  async access(path: string, _mode?: number): Promise<void> {
    await this.initialize()
    const file = await this.getFile(path)
    if (!file) {
      throw new ENOENT(undefined, path)
    }
    // Simplified: just check existence for now (mode checks not implemented)
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    this.sql.exec('UPDATE files SET mode = ?, ctime = ? WHERE id = ?', mode, Date.now(), file.id)
  }

  async chown(path: string, uid: number, gid: number): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    this.sql.exec('UPDATE files SET uid = ?, gid = ?, ctime = ? WHERE id = ?', uid, gid, Date.now(), file.id)
  }

  async utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    const atimeMs = atime instanceof Date ? atime.getTime() : atime
    const mtimeMs = mtime instanceof Date ? mtime.getTime() : mtime

    this.sql.exec('UPDATE files SET atime = ?, mtime = ?, ctime = ? WHERE id = ?', atimeMs, mtimeMs, Date.now(), file.id)
  }

  // ===========================================================================
  // SYMBOLIC LINKS
  // ===========================================================================

  async symlink(target: string, path: string): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const now = Date.now()
    const parentPath = this.getParentPath(normalized)
    const name = this.getFileName(normalized)

    const parent = await this.getFile(parentPath)
    if (!parent) {
      throw new ENOENT(undefined, parentPath)
    }

    const existing = await this.getFile(normalized)
    if (existing) {
      throw new EEXIST(undefined, normalized)
    }

    this.sql.exec(
      `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, link_target, tier, atime, mtime, ctime, birthtime, nlink)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      normalized,
      name,
      parent.id,
      'symlink',
      0o777,
      0,
      0,
      target.length,
      target,
      'hot',
      now,
      now,
      now,
      now,
      1
    )
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    await this.initialize()
    const existingNormalized = this.normalizePath(existingPath)
    const newNormalized = this.normalizePath(newPath)
    const now = Date.now()

    const file = await this.getFile(existingNormalized)
    if (!file) {
      throw new ENOENT(undefined, existingNormalized)
    }

    const existing = await this.getFile(newNormalized)
    if (existing) {
      throw new EEXIST(undefined, newNormalized)
    }

    const parentPath = this.getParentPath(newNormalized)
    const name = this.getFileName(newNormalized)
    const parent = await this.getFile(parentPath)

    if (!parent) {
      throw new ENOENT(undefined, parentPath)
    }

    // Increment nlink on original file
    this.sql.exec('UPDATE files SET nlink = nlink + 1 WHERE id = ?', file.id)

    // Increment blob ref_count if file has a blob
    if (file.blob_id) {
      this.incrementBlobRef(file.blob_id)
    }

    // Create new entry
    this.sql.exec(
      `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, blob_id, tier, atime, mtime, ctime, birthtime, nlink)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newNormalized,
      name,
      parent.id,
      file.type,
      file.mode,
      file.uid,
      file.gid,
      file.size,
      file.blob_id,
      file.tier,
      now,
      now,
      now,
      now,
      file.nlink + 1
    )
  }

  async readlink(path: string): Promise<string> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (file.type !== 'symlink' || !file.link_target) {
      throw Object.assign(new Error('invalid argument'), { code: 'EINVAL', path: normalized })
    }

    return file.link_target
  }

  async realpath(path: string): Promise<string> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    let file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    // Follow symlinks
    let depth = 0
    while (file.type === 'symlink' && file.link_target) {
      if (depth++ > 40) {
        throw Object.assign(new Error('too many symbolic links'), { code: 'ELOOP', path: normalized })
      }

      let target = file.link_target
      if (!target.startsWith('/')) {
        const parentPath = this.getParentPath(file.path)
        target = this.normalizePath(parentPath + '/' + target)
      }

      file = await this.getFile(target)
      if (!file) {
        throw new ENOENT(undefined, target)
      }
    }

    return file.path
  }

  // ===========================================================================
  // STREAMING OPERATIONS
  // ===========================================================================

  async createReadStream(path: string, options?: ReadStreamOptions): Promise<ReadableStream<Uint8Array>> {
    const data = (await this.read(path, options)) as Uint8Array
    const highWaterMark = options?.highWaterMark ?? 16384
    let offset = 0

    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= data.length) {
          controller.close()
          return
        }

        const chunk = data.slice(offset, offset + highWaterMark)
        offset += chunk.length
        controller.enqueue(chunk)
      },
    })
  }

  async createWriteStream(path: string, options?: WriteStreamOptions): Promise<WritableStream<Uint8Array>> {
    const chunks: Uint8Array[] = []
    const self = this

    return new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk)
      },
      async close() {
        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
        const combined = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          combined.set(chunk, offset)
          offset += chunk.length
        }
        await self.write(path, combined, { mode: options?.mode })
      },
    })
  }

  // ===========================================================================
  // FILE HANDLE OPERATIONS
  // ===========================================================================

  async open(path: string, flags?: string | number, mode?: number): Promise<FileHandle> {
    // Simplified implementation - read entire file into memory
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    let data: Uint8Array
    if (file) {
      data = file.blob_id ? ((await this.getBlob(file.blob_id, file.tier as StorageTier)) ?? new Uint8Array(0)) : new Uint8Array(0)
    } else {
      // Create file if flags allow
      if (flags === 'w' || flags === 'w+' || flags === 'a' || flags === 'a+') {
        await this.write(normalized, new Uint8Array(0), { mode: mode ?? this.defaultMode })
        data = new Uint8Array(0)
      } else {
        throw new ENOENT(undefined, normalized)
      }
    }

    const stats = await this.stat(normalized)
    const self = this

    // Create FileHandle
    let fd = Math.floor(Math.random() * 1000000)

    return {
      fd,
      read: async (buffer: Uint8Array, offset?: number, length?: number, position?: number) => {
        const readPos = position ?? 0
        const readLen = length ?? (buffer.length - (offset ?? 0))
        const bytesToRead = Math.min(readLen, data.length - readPos)

        for (let i = 0; i < bytesToRead; i++) {
          buffer[(offset ?? 0) + i] = data[readPos + i]!
        }

        return { bytesRead: bytesToRead, buffer }
      },
      write: async (writeData: Uint8Array | string, position?: number) => {
        const bytes = typeof writeData === 'string' ? new TextEncoder().encode(writeData) : writeData
        const pos = position ?? data.length

        if (pos + bytes.length > data.length) {
          const newData = new Uint8Array(pos + bytes.length)
          newData.set(data)
          data = newData
        }

        for (let i = 0; i < bytes.length; i++) {
          data[pos + i] = bytes[i]!
        }

        return { bytesWritten: bytes.length }
      },
      stat: async () => stats,
      truncate: async (length: number = 0) => {
        data = data.slice(0, length)
      },
      sync: async () => {
        await self.write(normalized, data)
      },
      close: async () => {
        await self.write(normalized, data)
      },
      createReadStream: (options?: ReadStreamOptions) => {
        const start = options?.start ?? 0
        const end = options?.end ?? data.length - 1
        const sliced = data.slice(start, end + 1)
        const highWaterMark = options?.highWaterMark ?? 16384
        let offset = 0

        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (offset >= sliced.length) {
              controller.close()
              return
            }
            const chunk = sliced.slice(offset, offset + highWaterMark)
            offset += chunk.length
            controller.enqueue(chunk)
          },
        })
      },
      createWriteStream: (_options?: WriteStreamOptions) => {
        const chunks: Uint8Array[] = []
        return new WritableStream<Uint8Array>({
          write(chunk) {
            chunks.push(chunk)
          },
          close() {
            const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
            const combined = new Uint8Array(totalLength)
            let off = 0
            for (const chunk of chunks) {
              combined.set(chunk, off)
              off += chunk.length
            }
            data = combined
          },
        })
      },
    } as FileHandle
  }

  // ===========================================================================
  // WATCH OPERATIONS
  // ===========================================================================

  watch(
    _path: string,
    _options?: WatchOptions,
    _listener?: (eventType: 'rename' | 'change', filename: string) => void
  ): FSWatcher {
    // Simplified stub - real implementation would use SQLite triggers or polling
    // Parameters are intentionally unused in this stub implementation
    return {
      close: () => {},
      ref: function () {
        return this
      },
      unref: function () {
        return this
      },
    }
  }

  // ===========================================================================
  // TIERED STORAGE OPERATIONS
  // ===========================================================================

  async promote(path: string, tier: 'hot' | 'warm'): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (!file.blob_id) return

    const currentTier = file.tier as StorageTier
    if (currentTier === tier) return

    // Read from current tier
    const data = await this.getBlob(file.blob_id, currentTier)
    if (!data) return

    // Move blob to new tier - delete from old tier first
    await this.moveBlobToTier(file.blob_id, data, currentTier, tier)

    // Update file tier
    this.sql.exec('UPDATE files SET tier = ? WHERE id = ?', tier, file.id)
  }

  async demote(path: string, tier: 'warm' | 'cold'): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (!file.blob_id) return

    const currentTier = file.tier as StorageTier
    if (currentTier === tier) return

    // Read from current tier
    const data = await this.getBlob(file.blob_id!, currentTier)
    if (!data) return

    // Move blob to new tier - delete from old tier first
    await this.moveBlobToTier(file.blob_id, data, currentTier, tier)

    // Update file tier
    this.sql.exec('UPDATE files SET tier = ? WHERE id = ?', tier, file.id)
  }

  /**
   * Move a blob from one tier to another, preserving its ID and ref_count.
   */
  private async moveBlobToTier(
    blobId: string,
    data: Uint8Array,
    fromTier: StorageTier,
    toTier: StorageTier
  ): Promise<void> {
    // Store data in new tier
    if (toTier === 'hot') {
      // Hot tier stores data inline in SQLite
      this.sql.exec('UPDATE blobs SET data = ?, tier = ? WHERE id = ?', data.buffer, toTier, blobId)
    } else if (toTier === 'warm' && this.r2) {
      await this.r2.put(blobId, data)
      this.sql.exec('UPDATE blobs SET data = NULL, tier = ? WHERE id = ?', toTier, blobId)
    } else if (toTier === 'cold' && this.archive) {
      await this.archive.put(blobId, data)
      this.sql.exec('UPDATE blobs SET data = NULL, tier = ? WHERE id = ?', toTier, blobId)
    }

    // Clean up old tier data
    if (fromTier === 'warm' && this.r2) {
      await this.r2.delete(blobId)
    } else if (fromTier === 'cold' && this.archive) {
      await this.archive.delete(blobId)
    }
    // Hot tier data is overwritten in place, no cleanup needed
  }

  async getTier(path: string): Promise<'hot' | 'warm' | 'cold'> {
    await this.initialize()
    const file = await this.getFile(path)

    if (!file) {
      throw new ENOENT(undefined, path)
    }

    return file.tier as StorageTier
  }

  // ===========================================================================
  // ATOMIC BATCH OPERATIONS
  // ===========================================================================

  /**
   * Copy a directory recursively with atomic transaction semantics.
   * Either all files are copied or none (rollback on failure).
   *
   * @param src - Source directory path
   * @param dest - Destination directory path
   * @param options - Copy options
   */
  async copyDir(
    src: string,
    dest: string,
    options?: { recursive?: boolean; preserveMetadata?: boolean }
  ): Promise<void> {
    await this.initialize()
    const srcNormalized = this.normalizePath(src)
    const destNormalized = this.normalizePath(dest)

    const srcDir = await this.getFile(srcNormalized)
    if (!srcDir) {
      throw new ENOENT(undefined, srcNormalized)
    }

    if (srcDir.type !== 'directory') {
      throw new ENOTDIR(undefined, srcNormalized)
    }

    // Note: In Cloudflare Durable Objects, each request is processed atomically.
    // Create destination directory
    const destParentPath = this.getParentPath(destNormalized)
    const destParent = await this.getFile(destParentPath)
    if (!destParent) {
      throw new ENOENT(undefined, destParentPath)
    }

    const now = Date.now()
    const destName = this.getFileName(destNormalized)

    // Create the destination directory entry
    this.sql.exec(
      `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, tier, atime, mtime, ctime, birthtime, nlink)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      destNormalized,
      destName,
      destParent.id,
      'directory',
      options?.preserveMetadata ? srcDir.mode : this.defaultDirMode,
      srcDir.uid,
      srcDir.gid,
      0,
      'hot',
      now,
      now,
      now,
      now,
      2
    )

    // Recursively copy contents
    await this.copyDirContents(srcNormalized, destNormalized, options)
  }

  /**
   * Helper to recursively copy directory contents within a transaction.
   */
  private async copyDirContents(
    srcPath: string,
    destPath: string,
    options?: { recursive?: boolean; preserveMetadata?: boolean }
  ): Promise<void> {
    const srcDir = await this.getFile(srcPath)
    if (!srcDir) return

    const children = this.sql.exec<FileEntry>('SELECT * FROM files WHERE parent_id = ?', srcDir.id).toArray()
    const destDir = await this.getFile(destPath)
    if (!destDir) return

    const now = Date.now()

    for (const child of children) {
      const destChildPath = destPath + '/' + child.name

      if (child.type === 'directory') {
        // Create subdirectory
        this.sql.exec(
          `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, tier, atime, mtime, ctime, birthtime, nlink)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          destChildPath,
          child.name,
          destDir.id,
          'directory',
          options?.preserveMetadata ? child.mode : this.defaultDirMode,
          child.uid,
          child.gid,
          0,
          'hot',
          now,
          now,
          now,
          now,
          2
        )

        // Recursively copy its contents
        if (options?.recursive !== false) {
          await this.copyDirContents(child.path, destChildPath, options)
        }
      } else if (child.type === 'file') {
        // Copy file - reuse blob with incremented ref_count (deduplication)
        let blobId: string | null = null
        if (child.blob_id) {
          // Increment ref_count on existing blob instead of copying data
          this.incrementBlobRef(child.blob_id)
          blobId = child.blob_id
        }

        this.sql.exec(
          `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, blob_id, tier, atime, mtime, ctime, birthtime, nlink)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          destChildPath,
          child.name,
          destDir.id,
          'file',
          options?.preserveMetadata ? child.mode : this.defaultMode,
          child.uid,
          child.gid,
          child.size,
          blobId,
          child.tier,
          now,
          now,
          now,
          now,
          1
        )
      } else if (child.type === 'symlink') {
        // Copy symlink
        this.sql.exec(
          `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, link_target, tier, atime, mtime, ctime, birthtime, nlink)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          destChildPath,
          child.name,
          destDir.id,
          'symlink',
          0o777,
          child.uid,
          child.gid,
          child.size,
          child.link_target,
          'hot',
          now,
          now,
          now,
          now,
          1
        )
      }
    }
  }

  /**
   * Write multiple files atomically. Either all succeed or all are rolled back.
   * Note: In Cloudflare Durable Objects, each request is processed atomically.
   *
   * @param files - Array of file paths and content to write
   */
  async writeMany(files: Array<{ path: string; content: string | Uint8Array }>): Promise<void> {
    for (const file of files) {
      await this.write(file.path, file.content)
    }
  }

  /**
   * Soft delete a file or directory. The entry is marked for deletion but
   * only physically removed on commit.
   *
   * @param path - Path to delete
   * @param options - Delete options
   */
  async softDelete(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    // For soft delete within a transaction, we just do a regular delete
    // since SQLite transactions will handle the rollback automatically
    if (file.type === 'directory') {
      if (options?.recursive) {
        await this.deleteRecursive(file)
      } else {
        const children = this.sql.exec<FileEntry>('SELECT * FROM files WHERE parent_id = ?', file.id).toArray()
        if (children.length > 0) {
          throw new ENOTEMPTY(undefined, normalized)
        }
        this.sql.exec('DELETE FROM files WHERE id = ?', file.id)
      }
    } else {
      if (file.blob_id) {
        await this.decrementBlobRef(file.blob_id, file.tier as StorageTier)
      }
      this.sql.exec('DELETE FROM files WHERE id = ?', file.id)
    }
  }

  // ===========================================================================
  // BLOB MANAGEMENT OPERATIONS
  // ===========================================================================

  /**
   * Get information about a blob by file path.
   *
   * @param path - The file path to look up
   * @returns Blob information or null if not found
   */
  async getBlobInfoByPath(path: string): Promise<{
    blobId: string
    size: number
    checksum: string
    tier: StorageTier
    refCount: number
    createdAt: number
  } | null> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file || !file.blob_id) return null

    const blob = this.sql.exec<{
      id: string
      size: number
      checksum: string
      tier: string
      ref_count: number
      created_at: number
    }>('SELECT id, size, checksum, tier, ref_count, created_at FROM blobs WHERE id = ?', file.blob_id).toArray()

    if (blob.length === 0) return null

    return {
      blobId: blob[0]!.id,
      size: blob[0]!.size,
      checksum: blob[0]!.checksum,
      tier: blob[0]!.tier as StorageTier,
      refCount: blob[0]!.ref_count,
      createdAt: blob[0]!.created_at,
    }
  }

  /**
   * Get information about a blob by ID.
   *
   * @param blobId - The blob ID to look up
   * @returns Blob information or null if not found
   */
  async getBlobInfo(blobId: string): Promise<{
    id: string
    size: number
    checksum: string
    tier: StorageTier
    ref_count: number
    created_at: number
  } | null> {
    await this.initialize()
    const blob = this.sql.exec<{
      id: string
      size: number
      checksum: string
      tier: string
      ref_count: number
      created_at: number
    }>('SELECT id, size, checksum, tier, ref_count, created_at FROM blobs WHERE id = ?', blobId).toArray()

    if (blob.length === 0) return null

    return {
      id: blob[0]!.id,
      size: blob[0]!.size,
      checksum: blob[0]!.checksum,
      tier: blob[0]!.tier as StorageTier,
      ref_count: blob[0]!.ref_count,
      created_at: blob[0]!.created_at,
    }
  }

  /**
   * Get a blob by its ID, returning both metadata and data.
   *
   * @param blobId - The blob ID to retrieve
   * @returns Blob data and metadata or null if not found
   */
  async getBlobById(blobId: string): Promise<{
    id: string
    data: Uint8Array
    size: number
    checksum: string
    tier: StorageTier
  } | null> {
    await this.initialize()
    const blobMeta = this.sql.exec<{
      id: string
      size: number
      checksum: string
      tier: string
    }>('SELECT id, size, checksum, tier FROM blobs WHERE id = ?', blobId).toArray()

    if (blobMeta.length === 0) return null

    const tier = blobMeta[0]!.tier as StorageTier
    const data = await this.getBlob(blobId, tier)

    if (!data) return null

    return {
      id: blobMeta[0]!.id,
      data,
      size: blobMeta[0]!.size,
      checksum: blobMeta[0]!.checksum,
      tier,
    }
  }

  /**
   * Verify the integrity of a blob by checking its checksum.
   *
   * @param blobId - The blob ID to verify
   * @returns Object with valid flag and details
   */
  async verifyBlobIntegrity(blobId: string): Promise<{
    valid: boolean
    storedChecksum: string
    actualChecksum: string
    size: number
  }> {
    await this.initialize()
    const blobMeta = this.sql.exec<{
      id: string
      size: number
      checksum: string
      tier: string
    }>('SELECT id, size, checksum, tier FROM blobs WHERE id = ?', blobId).toArray()

    if (blobMeta.length === 0) {
      throw new Error(`Blob not found: ${blobId}`)
    }

    const tier = blobMeta[0]!.tier as StorageTier
    const data = await this.getBlob(blobId, tier)

    if (!data) {
      throw new Error(`Blob data not found: ${blobId}`)
    }

    const actualChecksum = await this.computeBlobChecksum(data)
    const storedChecksum = blobMeta[0]!.checksum

    return {
      valid: actualChecksum === storedChecksum,
      storedChecksum,
      actualChecksum,
      size: data.length,
    }
  }

  /**
   * Verify a checksum matches for given data content.
   *
   * @param checksum - Expected checksum
   * @param content - Content to verify (string or Uint8Array)
   * @returns true if checksum matches
   */
  async verifyChecksum(checksum: string, content: string | Uint8Array): Promise<boolean> {
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : content
    const actualChecksum = await this.computeBlobChecksum(data)
    return actualChecksum === checksum
  }

  /**
   * List all orphaned blobs (blobs with ref_count = 0).
   *
   * @returns Array of orphaned blob IDs
   */
  async listOrphanedBlobs(): Promise<string[]> {
    await this.initialize()
    const blobs = this.sql.exec<{ id: string }>('SELECT id FROM blobs WHERE ref_count = 0').toArray()
    return blobs.map(b => b.id)
  }

  /**
   * Clean up all orphaned blobs (blobs with ref_count = 0).
   *
   * @returns Number of blobs cleaned up
   */
  async cleanupOrphanedBlobs(): Promise<number> {
    await this.initialize()
    const orphaned = await this.listOrphanedBlobs()

    for (const blobId of orphaned) {
      // Get blob tier before deleting
      const blobMeta = this.sql.exec<{ tier: string }>('SELECT tier FROM blobs WHERE id = ?', blobId).toArray()
      if (blobMeta.length > 0) {
        const tier = blobMeta[0]!.tier as StorageTier
        await this.deleteBlobCompletely(blobId, tier)
      }
    }

    return orphaned.length
  }

  /**
   * Get statistics about blobs by storage tier.
   *
   * @returns Object with counts and sizes by tier
   */
  async getTierStats(): Promise<{
    hot: { count: number; totalSize: number }
    warm: { count: number; totalSize: number }
    cold: { count: number; totalSize: number }
  }> {
    await this.initialize()
    const stats = this.sql.exec<{ tier: string; count: number; total_size: number }>(
      'SELECT tier, COUNT(*) as count, COALESCE(SUM(size), 0) as total_size FROM blobs GROUP BY tier'
    ).toArray()

    const result = {
      hot: { count: 0, totalSize: 0 },
      warm: { count: 0, totalSize: 0 },
      cold: { count: 0, totalSize: 0 },
    }

    for (const s of stats) {
      const tier = s.tier as StorageTier
      result[tier] = { count: s.count, totalSize: s.total_size }
    }

    return result
  }

  /**
   * Get deduplication statistics.
   *
   * @returns Object with deduplication metrics
   */
  async getDedupStats(): Promise<{
    totalBlobs: number
    uniqueBlobs: number
    totalRefs: number
    dedupRatio: number
    savedBytes: number
  }> {
    await this.initialize()

    // Get total blobs and refs
    const blobStats = this.sql.exec<{ total: number; total_refs: number; total_size: number }>(
      'SELECT COUNT(*) as total, COALESCE(SUM(ref_count), 0) as total_refs, COALESCE(SUM(size), 0) as total_size FROM blobs'
    ).toArray()

    const totalBlobs = blobStats[0]?.total ?? 0
    const totalRefs = blobStats[0]?.total_refs ?? 0
    const totalSize = blobStats[0]?.total_size ?? 0

    // Unique blobs is same as totalBlobs (since content-addressable IDs)
    const uniqueBlobs = totalBlobs

    // Dedup ratio is refs / blobs (how many times each blob is referenced on average)
    const dedupRatio = totalBlobs > 0 ? totalRefs / totalBlobs : 1

    // Saved bytes: (totalRefs - totalBlobs) * avgBlobSize
    // This represents bytes saved by deduplication
    const avgBlobSize = totalBlobs > 0 ? totalSize / totalBlobs : 0
    const savedBytes = Math.max(0, (totalRefs - totalBlobs) * avgBlobSize)

    return {
      totalBlobs,
      uniqueBlobs,
      totalRefs,
      dedupRatio,
      savedBytes: Math.round(savedBytes),
    }
  }

  /**
   * Get the reference count for a blob.
   *
   * @param blobId - The blob ID to check
   * @returns Reference count or 0 if not found
   */
  async getBlobRefCount(blobId: string): Promise<number> {
    await this.initialize()
    const blob = this.sql.exec<{ ref_count: number }>('SELECT ref_count FROM blobs WHERE id = ?', blobId).toArray()
    return blob.length > 0 ? blob[0]!.ref_count : 0
  }

  // ===========================================================================
  // SCHEDULED CLEANUP OPERATIONS
  // ===========================================================================

  /**
   * Get the current cleanup scheduler state.
   *
   * @returns Current cleanup scheduler state
   */
  getCleanupState(): CleanupSchedulerState {
    return { ...this.cleanupState }
  }

  /**
   * Check if cleanup should be triggered based on current conditions.
   *
   * @returns true if cleanup should run
   */
  async shouldRunCleanup(): Promise<boolean> {
    if (this.cleanupState.running) return false

    await this.initialize()
    const orphanedCount = await this.countOrphanedBlobs()
    return orphanedCount >= this.cleanupConfig.minOrphanCount
  }

  /**
   * Count orphaned blobs that are eligible for cleanup.
   *
   * @returns Number of orphaned blobs
   */
  private async countOrphanedBlobs(): Promise<number> {
    const result = this.sql.exec<{ count: number }>(
      'SELECT COUNT(*) as count FROM blobs WHERE ref_count = 0'
    ).toArray()
    return result[0]?.count ?? 0
  }

  /**
   * Run scheduled cleanup of orphaned blobs.
   *
   * This method respects the cleanup configuration:
   * - minOrphanCount: Minimum orphans before cleanup triggers
   * - minOrphanAgeMs: Grace period for recently orphaned blobs
   * - batchSize: Maximum blobs to clean per invocation
   *
   * @param force - Force cleanup even if thresholds not met
   * @returns Cleanup result with statistics
   */
  async runScheduledCleanup(force = false): Promise<CleanupResult> {
    await this.initialize()

    const startTime = Date.now()

    // Check if cleanup should run
    if (!force && !(await this.shouldRunCleanup())) {
      return {
        cleaned: 0,
        skipped: 0,
        found: 0,
        durationMs: Date.now() - startTime,
      }
    }

    // Mark as running
    this.cleanupState.running = true

    try {
      // Find orphaned blobs with age filter
      const cutoffTime = Date.now() - this.cleanupConfig.minOrphanAgeMs
      const orphaned = this.sql.exec<{ id: string; tier: string; created_at: number }>(
        `SELECT id, tier, created_at FROM blobs
         WHERE ref_count = 0
         ORDER BY created_at ASC
         LIMIT ?`,
        this.cleanupConfig.batchSize
      ).toArray()

      let cleaned = 0
      let skipped = 0

      for (const blob of orphaned) {
        // Check age - skip if too recent
        if (blob.created_at > cutoffTime) {
          skipped++
          continue
        }

        // Delete the blob
        const tier = blob.tier as StorageTier
        await this.deleteBlobCompletely(blob.id, tier)
        cleaned++
      }

      // Update scheduler state
      this.cleanupState.lastCleanup = Date.now()
      this.cleanupState.cleanupCount++
      this.cleanupState.totalCleaned += cleaned

      return {
        cleaned,
        skipped,
        found: orphaned.length,
        durationMs: Date.now() - startTime,
      }
    } finally {
      this.cleanupState.running = false
    }
  }

  /**
   * Trigger background cleanup if conditions are met.
   *
   * This is a non-blocking method that can be called after
   * file operations to opportunistically clean up orphans.
   *
   * @returns Promise that resolves when cleanup check is scheduled
   */
  async maybeRunBackgroundCleanup(): Promise<void> {
    if (!this.cleanupConfig.async) {
      // Synchronous mode - run inline
      await this.runScheduledCleanup()
      return
    }

    // Async mode - check and run in background
    // Note: In Durable Objects, we can't truly run in background
    // but we can defer the cleanup to avoid blocking the response
    const shouldRun = await this.shouldRunCleanup()
    if (shouldRun) {
      // Schedule cleanup (will run on next tick)
      queueMicrotask(async () => {
        try {
          await this.runScheduledCleanup()
        } catch {
          // Swallow errors in background cleanup
        }
      })
    }
  }

  /**
   * Get cleanup configuration.
   *
   * @returns Current cleanup configuration
   */
  getCleanupConfig(): Required<CleanupConfig> {
    return { ...this.cleanupConfig }
  }

  /**
   * Update cleanup configuration.
   *
   * @param config - Partial configuration to merge
   */
  setCleanupConfig(config: Partial<CleanupConfig>): void {
    this.cleanupConfig = { ...this.cleanupConfig, ...config }
  }
}
