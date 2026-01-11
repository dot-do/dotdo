/**
 * Consistency POC - Cross-node consistency for stateless DOs
 *
 * This implements the hybrid consistency approach recommended in the analysis:
 * 1. libSQL leader for single-writer coordination (write path)
 * 2. Consistent hash ring for affinity hints (routing optimization)
 * 3. Optimistic concurrency as additional safety layer
 *
 * Key insight: libSQL's single-writer architecture naturally provides
 * the consistency guarantees we need without external lock services.
 *
 * @see ./consistency-analysis.md for detailed rationale
 */

import type { Client as LibSQLClient, ResultSet } from '../../db/compat/sql/turso/types'

// ============================================================================
// Types
// ============================================================================

/**
 * Lock representing exclusive access to a DO
 */
export interface Lock {
  /** DO identifier */
  doId: string
  /** Node currently holding the lock */
  nodeId: string
  /** When the lock was acquired */
  acquiredAt: number
  /** When the lock expires (TTL-based) */
  expiresAt: number
  /** Version for optimistic concurrency */
  version: bigint
  /** Fencing token to prevent stale lock holders from acting */
  fencingToken: number
}

/**
 * Lock acquisition options
 */
export interface LockOptions {
  /** Time-to-live in milliseconds (default: 30000) */
  ttlMs?: number
  /** Whether to wait for lock if unavailable (default: false) */
  wait?: boolean
  /** Maximum wait time in milliseconds (default: 5000) */
  waitTimeoutMs?: number
  /** Retry interval when waiting (default: 100ms) */
  retryIntervalMs?: number
}

/**
 * Result of lock acquisition attempt
 */
export interface LockResult {
  /** Whether lock was acquired */
  acquired: boolean
  /** Lock details if acquired */
  lock?: Lock
  /** Reason for failure if not acquired */
  reason?: 'already_held' | 'timeout' | 'error'
  /** Current lock holder if lock is held */
  currentHolder?: {
    nodeId: string
    expiresAt: number
  }
}

/**
 * Node in the cluster
 */
export interface NodeInfo {
  /** Node identifier */
  id: string
  /** Node address */
  address: string
  /** Node weight for consistent hashing */
  weight?: number
  /** Node metadata */
  metadata?: Record<string, unknown>
}

/**
 * Consistent hash ring configuration
 */
export interface HashRingConfig {
  /** Number of virtual nodes per physical node */
  virtualNodes?: number
  /** Hash function (default: FNV-1a) */
  hashFunction?: (key: string) => number
}

/**
 * Consistency guard interface - main abstraction for DO coordination
 */
export interface ConsistencyGuard {
  /** Acquire exclusive access to a DO */
  acquire(doId: string, options?: LockOptions): Promise<LockResult>

  /** Release exclusive access */
  release(lock: Lock): Promise<boolean>

  /** Refresh lock TTL (heartbeat) */
  refresh(lock: Lock, ttlMs?: number): Promise<Lock | null>

  /** Check if DO is available for locking */
  isAvailable(doId: string): Promise<boolean>

  /** Get optimal node for this DO (affinity hint) */
  getAffinityNode(doId: string): string

  /** Validate a lock is still held and valid */
  validateLock(lock: Lock): Promise<boolean>
}

// ============================================================================
// Consistent Hash Ring
// ============================================================================

/**
 * FNV-1a hash function - fast and good distribution
 */
function fnv1a(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = (hash * 16777619) >>> 0 // Ensure unsigned 32-bit
  }
  return hash
}

/**
 * Consistent Hash Ring for routing affinity
 *
 * Uses virtual nodes to improve distribution and minimize
 * key redistribution when nodes are added/removed.
 */
export class ConsistentHashRing {
  private ring: Map<number, string> = new Map()
  private sortedHashes: number[] = []
  private nodes: Map<string, NodeInfo> = new Map()
  private virtualNodes: number
  private hashFunction: (key: string) => number

  constructor(config?: HashRingConfig) {
    this.virtualNodes = config?.virtualNodes ?? 150
    this.hashFunction = config?.hashFunction ?? fnv1a
  }

  /**
   * Add a node to the ring
   */
  addNode(node: NodeInfo): void {
    if (this.nodes.has(node.id)) {
      return // Already exists
    }

    this.nodes.set(node.id, node)
    const weight = node.weight ?? 1

    // Add virtual nodes
    for (let i = 0; i < this.virtualNodes * weight; i++) {
      const hash = this.hashFunction(`${node.id}:${i}`)
      this.ring.set(hash, node.id)
    }

    // Rebuild sorted hashes
    this.sortedHashes = Array.from(this.ring.keys()).sort((a, b) => a - b)
  }

  /**
   * Remove a node from the ring
   */
  removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId)
    if (!node) {
      return
    }

    const weight = node.weight ?? 1

    // Remove virtual nodes
    for (let i = 0; i < this.virtualNodes * weight; i++) {
      const hash = this.hashFunction(`${nodeId}:${i}`)
      this.ring.delete(hash)
    }

    this.nodes.delete(nodeId)

    // Rebuild sorted hashes
    this.sortedHashes = Array.from(this.ring.keys()).sort((a, b) => a - b)
  }

  /**
   * Get the node responsible for a key
   */
  getNode(key: string): string | null {
    if (this.sortedHashes.length === 0) {
      return null
    }

    const hash = this.hashFunction(key)

    // Binary search for first hash >= key hash
    let low = 0
    let high = this.sortedHashes.length

    while (low < high) {
      const mid = (low + high) >>> 1
      if (this.sortedHashes[mid] < hash) {
        low = mid + 1
      } else {
        high = mid
      }
    }

    // Wrap around if we went past the end
    const index = low >= this.sortedHashes.length ? 0 : low
    const nodeHash = this.sortedHashes[index]
    return this.ring.get(nodeHash) ?? null
  }

  /**
   * Get N nodes for a key (for replication)
   */
  getNodes(key: string, count: number): string[] {
    if (this.sortedHashes.length === 0 || count <= 0) {
      return []
    }

    const nodes: string[] = []
    const seen = new Set<string>()
    const hash = this.hashFunction(key)

    // Find starting position
    let low = 0
    let high = this.sortedHashes.length

    while (low < high) {
      const mid = (low + high) >>> 1
      if (this.sortedHashes[mid] < hash) {
        low = mid + 1
      } else {
        high = mid
      }
    }

    // Collect unique nodes
    let idx = low >= this.sortedHashes.length ? 0 : low
    const startIdx = idx

    do {
      const nodeHash = this.sortedHashes[idx]
      const nodeId = this.ring.get(nodeHash)

      if (nodeId && !seen.has(nodeId)) {
        nodes.push(nodeId)
        seen.add(nodeId)

        if (nodes.length >= count) {
          break
        }
      }

      idx = (idx + 1) % this.sortedHashes.length
    } while (idx !== startIdx)

    return nodes
  }

  /**
   * Get all nodes in the ring
   */
  getAllNodes(): NodeInfo[] {
    return Array.from(this.nodes.values())
  }

  /**
   * Get ring size (number of virtual nodes)
   */
  get size(): number {
    return this.sortedHashes.length
  }
}

// ============================================================================
// Lock Table Schema
// ============================================================================

/**
 * SQL schema for lock table
 *
 * This table lives in the libSQL leader and provides
 * single-writer coordination.
 */
export const LOCK_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS do_locks (
  -- DO identifier (primary key)
  do_id TEXT PRIMARY KEY,

  -- Node currently holding the lock
  node_id TEXT NOT NULL,

  -- When the lock was acquired (epoch ms)
  acquired_at INTEGER NOT NULL,

  -- When the lock expires (epoch ms)
  expires_at INTEGER NOT NULL,

  -- Monotonically increasing fencing token
  -- Prevents stale lock holders from acting
  fencing_token INTEGER NOT NULL DEFAULT 0,

  -- Metadata for debugging
  metadata TEXT,

  -- Indexes for efficient queries
  CHECK (expires_at > acquired_at)
);

-- Index for finding expired locks
CREATE INDEX IF NOT EXISTS idx_do_locks_expires ON do_locks(expires_at);

-- Index for finding locks by node
CREATE INDEX IF NOT EXISTS idx_do_locks_node ON do_locks(node_id);
`

/**
 * SQL to initialize fencing token sequence
 * This ensures globally unique, monotonic fencing tokens
 */
export const FENCING_TOKEN_SCHEMA = `
CREATE TABLE IF NOT EXISTS fencing_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO fencing_tokens (id, value) VALUES (1, 0);
`

// ============================================================================
// Hybrid Consistency Guard Implementation
// ============================================================================

/**
 * Default lock options
 */
const DEFAULT_LOCK_OPTIONS: Required<LockOptions> = {
  ttlMs: 30000,
  wait: false,
  waitTimeoutMs: 5000,
  retryIntervalMs: 100,
}

/**
 * HybridConsistencyGuard - Production implementation
 *
 * Uses libSQL leader for coordination and consistent hash ring
 * for routing affinity hints.
 *
 * Key properties:
 * 1. Single-writer via libSQL leader (no split-brain)
 * 2. Fencing tokens prevent stale lock holders
 * 3. TTL-based expiry for crash recovery
 * 4. Routing hints improve cache locality
 */
export class HybridConsistencyGuard implements ConsistencyGuard {
  private libsql: LibSQLClient
  private hashRing: ConsistentHashRing
  private currentNodeId: string
  private initialized = false

  constructor(
    libsql: LibSQLClient,
    currentNodeId: string,
    nodes?: NodeInfo[],
    hashRingConfig?: HashRingConfig
  ) {
    this.libsql = libsql
    this.currentNodeId = currentNodeId
    this.hashRing = new ConsistentHashRing(hashRingConfig)

    // Initialize hash ring with provided nodes
    if (nodes) {
      for (const node of nodes) {
        this.hashRing.addNode(node)
      }
    }
  }

  /**
   * Initialize lock table (call once at startup)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    await this.libsql.batch([
      { sql: LOCK_TABLE_SCHEMA, args: [] },
      { sql: FENCING_TOKEN_SCHEMA, args: [] },
    ])

    this.initialized = true
  }

  /**
   * Acquire exclusive access to a DO
   */
  async acquire(doId: string, options?: LockOptions): Promise<LockResult> {
    const opts = { ...DEFAULT_LOCK_OPTIONS, ...options }
    const startTime = Date.now()

    while (true) {
      const result = await this.tryAcquire(doId, opts.ttlMs)

      if (result.acquired) {
        return result
      }

      if (!opts.wait) {
        return result
      }

      // Check if we've exceeded wait timeout
      if (Date.now() - startTime >= opts.waitTimeoutMs) {
        return {
          acquired: false,
          reason: 'timeout',
          currentHolder: result.currentHolder,
        }
      }

      // Wait before retrying
      await this.sleep(opts.retryIntervalMs)
    }
  }

  /**
   * Single attempt to acquire lock
   */
  private async tryAcquire(doId: string, ttlMs: number): Promise<LockResult> {
    const now = Date.now()
    const expiresAt = now + ttlMs

    try {
      // Atomically:
      // 1. Get next fencing token
      // 2. Insert or update lock (only if expired or same node)
      const result = await this.libsql.batch([
        // Increment fencing token
        {
          sql: `UPDATE fencing_tokens SET value = value + 1 WHERE id = 1 RETURNING value`,
          args: [],
        },
        // Try to acquire lock
        {
          sql: `
            INSERT INTO do_locks (do_id, node_id, acquired_at, expires_at, fencing_token)
            VALUES (?, ?, ?, ?, (SELECT value FROM fencing_tokens WHERE id = 1))
            ON CONFLICT (do_id) DO UPDATE SET
              node_id = excluded.node_id,
              acquired_at = excluded.acquired_at,
              expires_at = excluded.expires_at,
              fencing_token = excluded.fencing_token
            WHERE
              do_locks.expires_at < ? OR
              do_locks.node_id = ?
            RETURNING *
          `,
          args: [doId, this.currentNodeId, now, expiresAt, now, this.currentNodeId],
        },
      ])

      const fencingResult = result[0] as ResultSet
      const lockResult = result[1] as ResultSet

      // Check if lock was acquired
      if (lockResult.rows.length > 0) {
        const row = lockResult.rows[0]
        return {
          acquired: true,
          lock: {
            doId: row['do_id'] as string,
            nodeId: row['node_id'] as string,
            acquiredAt: row['acquired_at'] as number,
            expiresAt: row['expires_at'] as number,
            version: BigInt(row['rowid'] as number || 0),
            fencingToken: row['fencing_token'] as number,
          },
        }
      }

      // Lock not acquired - get current holder
      const currentLock = await this.libsql.execute({
        sql: `SELECT node_id, expires_at FROM do_locks WHERE do_id = ?`,
        args: [doId],
      })

      if (currentLock.rows.length > 0) {
        const holder = currentLock.rows[0]
        return {
          acquired: false,
          reason: 'already_held',
          currentHolder: {
            nodeId: holder['node_id'] as string,
            expiresAt: holder['expires_at'] as number,
          },
        }
      }

      // This shouldn't happen, but handle it
      return {
        acquired: false,
        reason: 'error',
      }
    } catch (error) {
      console.error('[ConsistencyGuard] Lock acquisition error:', error)
      return {
        acquired: false,
        reason: 'error',
      }
    }
  }

  /**
   * Release exclusive access
   */
  async release(lock: Lock): Promise<boolean> {
    try {
      const result = await this.libsql.execute({
        sql: `
          DELETE FROM do_locks
          WHERE do_id = ? AND node_id = ? AND fencing_token = ?
        `,
        args: [lock.doId, lock.nodeId, lock.fencingToken],
      })

      return result.rowsAffected > 0
    } catch (error) {
      console.error('[ConsistencyGuard] Lock release error:', error)
      return false
    }
  }

  /**
   * Refresh lock TTL (heartbeat)
   */
  async refresh(lock: Lock, ttlMs?: number): Promise<Lock | null> {
    const newExpiresAt = Date.now() + (ttlMs ?? DEFAULT_LOCK_OPTIONS.ttlMs)

    try {
      const result = await this.libsql.execute({
        sql: `
          UPDATE do_locks
          SET expires_at = ?
          WHERE do_id = ? AND node_id = ? AND fencing_token = ?
          RETURNING *
        `,
        args: [newExpiresAt, lock.doId, lock.nodeId, lock.fencingToken],
      })

      if (result.rows.length === 0) {
        // Lock was lost or expired
        return null
      }

      const row = result.rows[0]
      return {
        ...lock,
        expiresAt: row['expires_at'] as number,
      }
    } catch (error) {
      console.error('[ConsistencyGuard] Lock refresh error:', error)
      return null
    }
  }

  /**
   * Check if DO is available for locking
   */
  async isAvailable(doId: string): Promise<boolean> {
    try {
      const result = await this.libsql.execute({
        sql: `
          SELECT 1 FROM do_locks
          WHERE do_id = ? AND expires_at > ?
          LIMIT 1
        `,
        args: [doId, Date.now()],
      })

      return result.rows.length === 0
    } catch (error) {
      console.error('[ConsistencyGuard] Availability check error:', error)
      return false
    }
  }

  /**
   * Get optimal node for this DO (affinity hint)
   */
  getAffinityNode(doId: string): string {
    return this.hashRing.getNode(doId) ?? this.currentNodeId
  }

  /**
   * Validate a lock is still held and valid
   */
  async validateLock(lock: Lock): Promise<boolean> {
    try {
      const result = await this.libsql.execute({
        sql: `
          SELECT 1 FROM do_locks
          WHERE do_id = ?
            AND node_id = ?
            AND fencing_token = ?
            AND expires_at > ?
          LIMIT 1
        `,
        args: [lock.doId, lock.nodeId, lock.fencingToken, Date.now()],
      })

      return result.rows.length > 0
    } catch (error) {
      console.error('[ConsistencyGuard] Lock validation error:', error)
      return false
    }
  }

  /**
   * Add a node to the hash ring
   */
  addNode(node: NodeInfo): void {
    this.hashRing.addNode(node)
  }

  /**
   * Remove a node from the hash ring
   */
  removeNode(nodeId: string): void {
    this.hashRing.removeNode(nodeId)
  }

  /**
   * Cleanup expired locks (maintenance task)
   */
  async cleanupExpiredLocks(): Promise<number> {
    try {
      const result = await this.libsql.execute({
        sql: `DELETE FROM do_locks WHERE expires_at < ?`,
        args: [Date.now()],
      })

      return result.rowsAffected
    } catch (error) {
      console.error('[ConsistencyGuard] Cleanup error:', error)
      return 0
    }
  }

  /**
   * Get all locks held by this node (for graceful shutdown)
   */
  async getOwnedLocks(): Promise<Lock[]> {
    try {
      const result = await this.libsql.execute({
        sql: `
          SELECT * FROM do_locks
          WHERE node_id = ? AND expires_at > ?
        `,
        args: [this.currentNodeId, Date.now()],
      })

      return result.rows.map((row) => ({
        doId: row['do_id'] as string,
        nodeId: row['node_id'] as string,
        acquiredAt: row['acquired_at'] as number,
        expiresAt: row['expires_at'] as number,
        version: BigInt(row['rowid'] as number || 0),
        fencingToken: row['fencing_token'] as number,
      }))
    } catch (error) {
      console.error('[ConsistencyGuard] Get owned locks error:', error)
      return []
    }
  }

  /**
   * Release all locks held by this node (for graceful shutdown)
   */
  async releaseAllOwnedLocks(): Promise<number> {
    try {
      const result = await this.libsql.execute({
        sql: `DELETE FROM do_locks WHERE node_id = ?`,
        args: [this.currentNodeId],
      })

      return result.rowsAffected
    } catch (error) {
      console.error('[ConsistencyGuard] Release all locks error:', error)
      return 0
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// Lock-Protected DO Wrapper
// ============================================================================

/**
 * Options for lock-protected operations
 */
export interface ProtectedOperationOptions<T> {
  /** DO identifier */
  doId: string
  /** Operation to execute while holding lock */
  operation: (lock: Lock) => Promise<T>
  /** Lock options */
  lockOptions?: LockOptions
  /** Heartbeat interval in ms (default: ttl/3) */
  heartbeatIntervalMs?: number
}

/**
 * Execute an operation while holding a lock
 *
 * This is the main entry point for protected DO operations.
 * It handles:
 * 1. Lock acquisition
 * 2. Heartbeat during long operations
 * 3. Lock release on completion or error
 *
 * @example
 * ```typescript
 * const result = await executeWithLock(guard, {
 *   doId: 'my-do',
 *   operation: async (lock) => {
 *     // Safe to modify state here
 *     await updateState(lock.fencingToken)
 *     return 'done'
 *   }
 * })
 * ```
 */
export async function executeWithLock<T>(
  guard: ConsistencyGuard,
  options: ProtectedOperationOptions<T>
): Promise<T> {
  const lockResult = await guard.acquire(options.doId, options.lockOptions)

  if (!lockResult.acquired || !lockResult.lock) {
    throw new Error(
      `Failed to acquire lock for ${options.doId}: ${lockResult.reason}`
    )
  }

  const lock = lockResult.lock
  const ttlMs = options.lockOptions?.ttlMs ?? DEFAULT_LOCK_OPTIONS.ttlMs
  const heartbeatInterval = options.heartbeatIntervalMs ?? Math.floor(ttlMs / 3)

  // Start heartbeat
  let currentLock = lock
  let heartbeatActive = true

  const heartbeat = async () => {
    while (heartbeatActive) {
      await new Promise((resolve) => setTimeout(resolve, heartbeatInterval))

      if (!heartbeatActive) break

      const refreshed = await guard.refresh(currentLock)
      if (!refreshed) {
        console.error('[ConsistencyGuard] Lost lock during operation:', options.doId)
        heartbeatActive = false
        break
      }
      currentLock = refreshed
    }
  }

  // Start heartbeat in background
  const heartbeatPromise = heartbeat()

  try {
    // Execute the operation
    return await options.operation(currentLock)
  } finally {
    // Stop heartbeat and release lock
    heartbeatActive = false
    await guard.release(currentLock)

    // Wait for heartbeat to stop
    await heartbeatPromise.catch(() => {
      // Ignore heartbeat errors during cleanup
    })
  }
}

// ============================================================================
// Fencing Token Validator
// ============================================================================

/**
 * Validates that an operation is authorized based on fencing token
 *
 * Use this in your storage layer to reject stale operations from
 * old lock holders.
 *
 * @example
 * ```typescript
 * async function updateState(doId: string, data: unknown, fencingToken: number) {
 *   const isValid = await fencingValidator.validate(doId, fencingToken)
 *   if (!isValid) {
 *     throw new Error('Stale fencing token - operation rejected')
 *   }
 *   // Proceed with update
 * }
 * ```
 */
export class FencingTokenValidator {
  private libsql: LibSQLClient

  constructor(libsql: LibSQLClient) {
    this.libsql = libsql
  }

  /**
   * Validate a fencing token for a DO
   *
   * Returns true if the token is current (matches the active lock)
   */
  async validate(doId: string, fencingToken: number): Promise<boolean> {
    try {
      const result = await this.libsql.execute({
        sql: `
          SELECT 1 FROM do_locks
          WHERE do_id = ?
            AND fencing_token = ?
            AND expires_at > ?
          LIMIT 1
        `,
        args: [doId, fencingToken, Date.now()],
      })

      return result.rows.length > 0
    } catch (error) {
      console.error('[FencingValidator] Validation error:', error)
      return false
    }
  }

  /**
   * Get the current fencing token for a DO
   */
  async getCurrentToken(doId: string): Promise<number | null> {
    try {
      const result = await this.libsql.execute({
        sql: `
          SELECT fencing_token FROM do_locks
          WHERE do_id = ? AND expires_at > ?
          LIMIT 1
        `,
        args: [doId, Date.now()],
      })

      if (result.rows.length === 0) {
        return null
      }

      return result.rows[0]['fencing_token'] as number
    } catch (error) {
      console.error('[FencingValidator] Get current token error:', error)
      return null
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  fnv1a as hashFnv1a,
  DEFAULT_LOCK_OPTIONS,
}
