/**
 * ImmutableStore - Append-only storage with cryptographic hash chain
 *
 * Provides tamper-evident, append-only storage for audit logs and compliance:
 * - **Append-only**: No updates or deletes allowed
 * - **Hash chain**: Each entry links to previous via SHA-256 hash
 * - **Merkle tree**: Efficient range proofs for subset verification
 * - **Tamper detection**: Verify chain integrity at any time
 * - **Compaction**: Archive old entries while preserving proofs
 * - **Export/Import**: Full chain portability with integrity checks
 * - **Retention**: Time-based enforcement for compliance
 *
 * Hash chain format: hash(prev_hash + entry_data + timestamp)
 *
 * @module db/primitives/audit-log/immutable-store
 */

import { type MetricsCollector, noopMetrics } from '../observability'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * A single entry in the hash chain with its cryptographic proof
 */
export interface ChainedEntry<T> {
  /** Zero-based index in the chain */
  index: number
  /** The actual data stored */
  data: T
  /** Unix timestamp when entry was appended */
  timestamp: number
  /** SHA-256 hash of this entry */
  hash: string
  /** Hash of the previous entry (empty string for genesis) */
  prevHash: string
}

/**
 * Result of chain verification
 */
export interface VerificationResult {
  /** Whether the entire chain is valid */
  valid: boolean
  /** Total entries verified */
  entriesVerified: number
  /** Index of first invalid entry (if any) */
  invalidAt?: number
  /** Description of what failed (if any) */
  error?: string
}

/**
 * Proof for a range of entries in the chain
 */
export interface RangeProof {
  /** Whether the range is valid */
  valid: boolean
  /** Start index of the range */
  start: number
  /** End index of the range (exclusive) */
  end: number
  /** Merkle root hash for the range */
  merkleRoot: string
  /** Proof path from entries to root */
  proofPath: string[]
  /** The entries in the range */
  entries: ChainedEntry<unknown>[]
}

/**
 * Exported chain data for backup/restore
 */
export interface ExportedChain<T> {
  /** Version of export format */
  version: number
  /** When the export was created */
  exportedAt: number
  /** Total entries in export */
  entryCount: number
  /** Hash of the head entry */
  headHash: string
  /** Merkle root of entire chain */
  merkleRoot: string
  /** All entries */
  entries: ChainedEntry<T>[]
  /** Checksum of entire export */
  checksum: string
}

/**
 * Statistics about the immutable store
 */
export interface StoreStats {
  /** Total entries in the chain */
  entryCount: number
  /** Hash of the most recent entry */
  headHash: string
  /** Merkle root of entire chain */
  merkleRoot: string
  /** Timestamp of oldest entry */
  oldestTimestamp?: number
  /** Timestamp of newest entry */
  newestTimestamp?: number
}

/**
 * Retention policy configuration
 */
export interface RetentionPolicy {
  /** Maximum age of entries in milliseconds */
  maxAge?: number
  /** Minimum entries to retain regardless of age */
  minEntries?: number
  /** Whether to create compaction proof when pruning */
  createCompactionProof?: boolean
}

/**
 * Result of retention enforcement
 */
export interface RetentionResult {
  /** Number of entries pruned */
  prunedCount: number
  /** Entries remaining after pruning */
  remainingCount: number
  /** Compaction proof (if policy requested it) */
  compactionProof?: CompactionProof
}

/**
 * Proof that entries were properly compacted
 */
export interface CompactionProof {
  /** Timestamp when compaction occurred */
  compactedAt: number
  /** Number of entries that were compacted */
  compactedCount: number
  /** Merkle root of compacted entries */
  compactedMerkleRoot: string
  /** Hash of last compacted entry */
  lastCompactedHash: string
  /** Hash of first remaining entry after compaction */
  firstRemainingHash: string
}

/**
 * Configuration options for ImmutableStore
 */
export interface ImmutableStoreOptions {
  /** Retention policy for automatic pruning */
  retention?: RetentionPolicy
  /** Metrics collector for observability */
  metrics?: MetricsCollector
}

/**
 * ImmutableStore interface - append-only storage with hash chain
 */
export interface ImmutableStore<T> {
  /**
   * Append a new entry to the chain
   * @param entry - Data to append
   * @returns The chained entry with hash and metadata
   */
  append(entry: T): Promise<ChainedEntry<T>>

  /**
   * Verify the entire chain integrity
   * @returns Verification result
   */
  verify(): Promise<VerificationResult>

  /**
   * Verify a range of entries and get Merkle proof
   * @param start - Start index (inclusive)
   * @param end - End index (exclusive)
   * @returns Range proof with Merkle path
   */
  verifyRange(start: number, end: number): Promise<RangeProof>

  /**
   * Get a specific entry by index
   * @param index - Zero-based index
   * @returns The chained entry or null if not found
   */
  getEntry(index: number): Promise<ChainedEntry<T> | null>

  /**
   * Get the most recent entry (head of chain)
   * @returns The head entry or null if chain is empty
   */
  getHead(): Promise<ChainedEntry<T> | null>

  /**
   * Get entries in a range
   * @param start - Start index (inclusive)
   * @param end - End index (exclusive)
   * @returns Array of entries
   */
  getRange(start: number, end: number): Promise<ChainedEntry<T>[]>

  /**
   * Export the entire chain for backup
   * @returns Exported chain with integrity checksum
   */
  export(): Promise<ExportedChain<T>>

  /**
   * Get store statistics
   * @returns Current store stats
   */
  getStats(): Promise<StoreStats>

  /**
   * Enforce retention policy
   * @param policy - Optional override policy
   * @returns Retention enforcement result
   */
  enforceRetention(policy?: RetentionPolicy): Promise<RetentionResult>

  /**
   * Get the current entry count
   * @returns Number of entries in the chain
   */
  count(): Promise<number>
}

// =============================================================================
// METRIC NAMES
// =============================================================================

export const ImmutableStoreMetrics = {
  APPEND_LATENCY: 'immutable_store.append.latency',
  VERIFY_LATENCY: 'immutable_store.verify.latency',
  VERIFY_RANGE_LATENCY: 'immutable_store.verify_range.latency',
  GET_LATENCY: 'immutable_store.get.latency',
  EXPORT_LATENCY: 'immutable_store.export.latency',
  ENTRY_COUNT: 'immutable_store.entry_count',
  MERKLE_REBUILD_COUNT: 'immutable_store.merkle_rebuild_count',
  RETENTION_PRUNED: 'immutable_store.retention_pruned',
} as const

// =============================================================================
// CRYPTO UTILITIES
// =============================================================================

/**
 * Convert string to ArrayBuffer
 */
function stringToBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer as ArrayBuffer
}

/**
 * Convert ArrayBuffer to hex string
 */
function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Compute SHA-256 hash of data
 */
async function sha256(data: string): Promise<string> {
  const buffer = stringToBuffer(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return bufferToHex(hashBuffer)
}

/**
 * Compute hash for a chain entry
 * Format: hash(prevHash + JSON(data) + timestamp)
 */
async function computeEntryHash<T>(prevHash: string, data: T, timestamp: number): Promise<string> {
  const payload = `${prevHash}${JSON.stringify(data)}${timestamp}`
  return sha256(payload)
}

/**
 * Compute Merkle root for a list of hashes
 */
async function computeMerkleRoot(hashes: string[]): Promise<string> {
  if (hashes.length === 0) {
    return sha256('')
  }

  if (hashes.length === 1) {
    return hashes[0]!
  }

  // Build Merkle tree bottom-up
  let level = [...hashes]

  while (level.length > 1) {
    const nextLevel: string[] = []

    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        // Combine two nodes
        const combined = await sha256(level[i]! + level[i + 1]!)
        nextLevel.push(combined)
      } else {
        // Odd node, promote to next level
        nextLevel.push(level[i]!)
      }
    }

    level = nextLevel
  }

  return level[0]!
}

/**
 * Compute Merkle proof path for a specific index
 */
async function computeMerkleProof(hashes: string[], targetIndex: number): Promise<string[]> {
  if (hashes.length <= 1) {
    return []
  }

  const proof: string[] = []
  let level = [...hashes]
  let index = targetIndex

  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1

    if (siblingIndex < level.length) {
      proof.push(level[siblingIndex]!)
    }

    // Build next level
    const nextLevel: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        const combined = await sha256(level[i]! + level[i + 1]!)
        nextLevel.push(combined)
      } else {
        nextLevel.push(level[i]!)
      }
    }

    level = nextLevel
    index = Math.floor(index / 2)
  }

  return proof
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * In-memory implementation of ImmutableStore
 * @internal
 */
class InMemoryImmutableStore<T> implements ImmutableStore<T> {
  /** The chain of entries */
  private entries: ChainedEntry<T>[] = []

  /** Cached Merkle root (invalidated on append) */
  private cachedMerkleRoot: string | null = null

  /** Retention policy */
  private readonly retention?: RetentionPolicy

  /** Metrics collector */
  private readonly metrics: MetricsCollector

  constructor(options?: ImmutableStoreOptions) {
    this.retention = options?.retention
    this.metrics = options?.metrics ?? noopMetrics
  }

  async append(entry: T): Promise<ChainedEntry<T>> {
    const start = performance.now()
    try {
      const index = this.entries.length
      const timestamp = Date.now()
      const prevHash = index > 0 ? this.entries[index - 1]!.hash : ''

      const hash = await computeEntryHash(prevHash, entry, timestamp)

      const chainedEntry: ChainedEntry<T> = {
        index,
        data: entry,
        timestamp,
        hash,
        prevHash,
      }

      this.entries.push(chainedEntry)

      // Invalidate Merkle cache
      this.cachedMerkleRoot = null

      this.metrics.recordGauge(ImmutableStoreMetrics.ENTRY_COUNT, this.entries.length)

      return chainedEntry
    } finally {
      this.metrics.recordLatency(ImmutableStoreMetrics.APPEND_LATENCY, performance.now() - start)
    }
  }

  async verify(): Promise<VerificationResult> {
    const start = performance.now()
    try {
      if (this.entries.length === 0) {
        return { valid: true, entriesVerified: 0 }
      }

      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i]!
        const expectedPrevHash = i > 0 ? this.entries[i - 1]!.hash : ''

        // Check prev hash link
        if (entry.prevHash !== expectedPrevHash) {
          return {
            valid: false,
            entriesVerified: i,
            invalidAt: i,
            error: `Previous hash mismatch at index ${i}`,
          }
        }

        // Recompute and verify hash
        const computedHash = await computeEntryHash(entry.prevHash, entry.data, entry.timestamp)
        if (entry.hash !== computedHash) {
          return {
            valid: false,
            entriesVerified: i,
            invalidAt: i,
            error: `Hash mismatch at index ${i}: expected ${computedHash}, got ${entry.hash}`,
          }
        }
      }

      return { valid: true, entriesVerified: this.entries.length }
    } finally {
      this.metrics.recordLatency(ImmutableStoreMetrics.VERIFY_LATENCY, performance.now() - start)
    }
  }

  async verifyRange(start: number, end: number): Promise<RangeProof> {
    const startTime = performance.now()
    try {
      // Validate range
      if (start < 0 || end > this.entries.length || start >= end) {
        return {
          valid: false,
          start,
          end,
          merkleRoot: '',
          proofPath: [],
          entries: [],
        }
      }

      // Get entries in range
      const rangeEntries = this.entries.slice(start, end)

      // Verify chain links within range
      for (let i = 0; i < rangeEntries.length; i++) {
        const entry = rangeEntries[i]!
        const globalIndex = start + i
        const expectedPrevHash = globalIndex > 0 ? this.entries[globalIndex - 1]!.hash : ''

        if (entry.prevHash !== expectedPrevHash) {
          return {
            valid: false,
            start,
            end,
            merkleRoot: '',
            proofPath: [],
            entries: rangeEntries as ChainedEntry<unknown>[],
          }
        }

        const computedHash = await computeEntryHash(entry.prevHash, entry.data, entry.timestamp)
        if (entry.hash !== computedHash) {
          return {
            valid: false,
            start,
            end,
            merkleRoot: '',
            proofPath: [],
            entries: rangeEntries as ChainedEntry<unknown>[],
          }
        }
      }

      // Compute Merkle root for range
      const rangeHashes = rangeEntries.map((e) => e.hash)
      const merkleRoot = await computeMerkleRoot(rangeHashes)

      // Compute proof path (from first entry to root)
      const proofPath = await computeMerkleProof(rangeHashes, 0)

      return {
        valid: true,
        start,
        end,
        merkleRoot,
        proofPath,
        entries: rangeEntries as ChainedEntry<unknown>[],
      }
    } finally {
      this.metrics.recordLatency(ImmutableStoreMetrics.VERIFY_RANGE_LATENCY, performance.now() - startTime)
    }
  }

  async getEntry(index: number): Promise<ChainedEntry<T> | null> {
    const start = performance.now()
    try {
      if (index < 0 || index >= this.entries.length) {
        return null
      }
      return this.entries[index] ?? null
    } finally {
      this.metrics.recordLatency(ImmutableStoreMetrics.GET_LATENCY, performance.now() - start)
    }
  }

  async getHead(): Promise<ChainedEntry<T> | null> {
    if (this.entries.length === 0) {
      return null
    }
    return this.entries[this.entries.length - 1] ?? null
  }

  async getRange(start: number, end: number): Promise<ChainedEntry<T>[]> {
    if (start < 0 || end > this.entries.length || start >= end) {
      return []
    }
    return this.entries.slice(start, end)
  }

  async export(): Promise<ExportedChain<T>> {
    const start = performance.now()
    try {
      const headEntry = await this.getHead()
      const merkleRoot = await this.getMerkleRoot()

      const exportData: Omit<ExportedChain<T>, 'checksum'> = {
        version: 1,
        exportedAt: Date.now(),
        entryCount: this.entries.length,
        headHash: headEntry?.hash ?? '',
        merkleRoot,
        entries: [...this.entries],
      }

      // Compute checksum of export (excluding checksum field)
      const checksum = await sha256(JSON.stringify(exportData))

      return {
        ...exportData,
        checksum,
      }
    } finally {
      this.metrics.recordLatency(ImmutableStoreMetrics.EXPORT_LATENCY, performance.now() - start)
    }
  }

  async getStats(): Promise<StoreStats> {
    const merkleRoot = await this.getMerkleRoot()
    const head = await this.getHead()

    return {
      entryCount: this.entries.length,
      headHash: head?.hash ?? '',
      merkleRoot,
      oldestTimestamp: this.entries.length > 0 ? this.entries[0]!.timestamp : undefined,
      newestTimestamp: head?.timestamp,
    }
  }

  async enforceRetention(policy?: RetentionPolicy): Promise<RetentionResult> {
    const effectivePolicy = policy ?? this.retention

    if (!effectivePolicy?.maxAge) {
      return { prunedCount: 0, remainingCount: this.entries.length }
    }

    const cutoffTime = Date.now() - effectivePolicy.maxAge
    const minEntries = effectivePolicy.minEntries ?? 0

    // Find entries to prune
    let pruneCount = 0
    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i]!.timestamp < cutoffTime) {
        pruneCount++
      } else {
        break // Entries are in chronological order
      }
    }

    // Ensure we keep minimum entries
    const maxPruneCount = Math.max(0, this.entries.length - minEntries)
    pruneCount = Math.min(pruneCount, maxPruneCount)

    if (pruneCount === 0) {
      return { prunedCount: 0, remainingCount: this.entries.length }
    }

    let compactionProof: CompactionProof | undefined

    if (effectivePolicy.createCompactionProof) {
      const prunedEntries = this.entries.slice(0, pruneCount)
      const prunedHashes = prunedEntries.map((e) => e.hash)
      const compactedMerkleRoot = await computeMerkleRoot(prunedHashes)

      compactionProof = {
        compactedAt: Date.now(),
        compactedCount: pruneCount,
        compactedMerkleRoot,
        lastCompactedHash: prunedEntries[prunedEntries.length - 1]!.hash,
        firstRemainingHash: this.entries[pruneCount]?.hash ?? '',
      }
    }

    // Prune entries
    this.entries = this.entries.slice(pruneCount)

    // Re-index remaining entries
    for (let i = 0; i < this.entries.length; i++) {
      this.entries[i] = { ...this.entries[i]!, index: i }
    }

    // Invalidate Merkle cache
    this.cachedMerkleRoot = null

    this.metrics.incrementCounter(ImmutableStoreMetrics.RETENTION_PRUNED, undefined, pruneCount)
    this.metrics.recordGauge(ImmutableStoreMetrics.ENTRY_COUNT, this.entries.length)

    return {
      prunedCount: pruneCount,
      remainingCount: this.entries.length,
      compactionProof,
    }
  }

  async count(): Promise<number> {
    return this.entries.length
  }

  /**
   * Get Merkle root (cached)
   */
  private async getMerkleRoot(): Promise<string> {
    if (this.cachedMerkleRoot !== null) {
      return this.cachedMerkleRoot
    }

    const hashes = this.entries.map((e) => e.hash)
    this.cachedMerkleRoot = await computeMerkleRoot(hashes)
    this.metrics.incrementCounter(ImmutableStoreMetrics.MERKLE_REBUILD_COUNT)

    return this.cachedMerkleRoot
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a new ImmutableStore instance
 *
 * @typeParam T - The type of data to store in entries
 * @param options - Configuration options
 * @returns A new ImmutableStore instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const store = createImmutableStore<AuditEvent>()
 *
 * // Append events
 * const entry = await store.append({
 *   actor: 'user:123',
 *   action: 'login',
 *   timestamp: Date.now(),
 * })
 *
 * // Verify integrity
 * const result = await store.verify()
 * if (!result.valid) {
 *   console.error('Tampering detected at index', result.invalidAt)
 * }
 *
 * // Get range proof
 * const proof = await store.verifyRange(0, 100)
 * console.log('Merkle root:', proof.merkleRoot)
 * ```
 *
 * @example
 * ```typescript
 * // With retention policy
 * const store = createImmutableStore<AuditEvent>({
 *   retention: {
 *     maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
 *     minEntries: 1000,
 *     createCompactionProof: true,
 *   },
 * })
 *
 * // Enforce retention
 * const result = await store.enforceRetention()
 * console.log('Pruned', result.prunedCount, 'entries')
 * ```
 */
export function createImmutableStore<T>(options?: ImmutableStoreOptions): ImmutableStore<T> {
  return new InMemoryImmutableStore<T>(options)
}

/**
 * Import an exported chain and verify integrity
 *
 * @typeParam T - The type of data stored in entries
 * @param exported - The exported chain data
 * @returns A new ImmutableStore populated with the imported data
 * @throws Error if import verification fails
 *
 * @example
 * ```typescript
 * // Export from source
 * const exported = await sourceStore.export()
 *
 * // Save to file/storage
 * await saveToFile(JSON.stringify(exported))
 *
 * // Later, import
 * const imported = JSON.parse(await readFromFile())
 * const store = await importImmutableStore<AuditEvent>(imported)
 *
 * // Store is now ready to use with all entries restored
 * ```
 */
export async function importImmutableStore<T>(exported: ExportedChain<T>): Promise<ImmutableStore<T>> {
  // Verify export format version
  if (exported.version !== 1) {
    throw new Error(`Unsupported export version: ${exported.version}`)
  }

  // Verify checksum
  const exportWithoutChecksum: Omit<ExportedChain<T>, 'checksum'> = {
    version: exported.version,
    exportedAt: exported.exportedAt,
    entryCount: exported.entryCount,
    headHash: exported.headHash,
    merkleRoot: exported.merkleRoot,
    entries: exported.entries,
  }

  const computedChecksum = await sha256(JSON.stringify(exportWithoutChecksum))
  if (computedChecksum !== exported.checksum) {
    throw new Error('Export checksum verification failed - data may be corrupted')
  }

  // Verify entry count matches
  if (exported.entries.length !== exported.entryCount) {
    throw new Error(
      `Entry count mismatch: expected ${exported.entryCount}, got ${exported.entries.length}`
    )
  }

  // Create store and manually populate (bypassing append to preserve original hashes)
  const store = new InMemoryImmutableStore<T>() as unknown as {
    entries: ChainedEntry<T>[]
    cachedMerkleRoot: string | null
  }

  store.entries = [...exported.entries]
  store.cachedMerkleRoot = null

  // Verify the imported chain
  const castStore = store as unknown as ImmutableStore<T>
  const verifyResult = await castStore.verify()

  if (!verifyResult.valid) {
    throw new Error(`Import verification failed: ${verifyResult.error}`)
  }

  // Verify head hash matches
  const head = await castStore.getHead()
  if (head && head.hash !== exported.headHash) {
    throw new Error('Head hash verification failed')
  }

  // Verify Merkle root matches
  const stats = await castStore.getStats()
  if (stats.merkleRoot !== exported.merkleRoot) {
    throw new Error('Merkle root verification failed')
  }

  return castStore
}

/**
 * Verify a standalone range proof without the full store
 *
 * @param proof - The range proof to verify
 * @returns Whether the proof is valid
 *
 * @example
 * ```typescript
 * // Get proof from store
 * const proof = await store.verifyRange(0, 100)
 *
 * // Later, verify proof independently
 * const isValid = await verifyRangeProof(proof)
 * ```
 */
export async function verifyRangeProof(proof: RangeProof): Promise<boolean> {
  if (!proof.valid || proof.entries.length === 0) {
    return proof.valid
  }

  // Verify chain links within the proof
  for (let i = 1; i < proof.entries.length; i++) {
    const entry = proof.entries[i]!
    const prevEntry = proof.entries[i - 1]!

    if (entry.prevHash !== prevEntry.hash) {
      return false
    }
  }

  // Recompute Merkle root from entries
  const hashes = proof.entries.map((e) => e.hash)
  const computedRoot = await computeMerkleRoot(hashes)

  return computedRoot === proof.merkleRoot
}
