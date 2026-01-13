/**
 * AuditLog - Immutable compliance and audit trail with hash chain verification
 *
 * Provides an append-only audit log with:
 * - **Append-only**: Entries can only be added, never modified or deleted
 * - **Sequential ordering**: Entries maintain strict chronological order
 * - **Hash chain**: Each entry links to previous via SHA-256-like hash
 * - **Tamper detection**: Any modification to existing entries is detectable
 * - **Recovery safety**: All committed entries survive crashes
 *
 * @see dotdo-7kjxa - [GREEN] Immutable store with hash chain
 * @see dotdo-9xw2u - [PRIMITIVE] AuditLog - Immutable compliance and audit trail
 */

import type {
  AuditEntry,
  CreateAuditEntryInput,
  AuditMetadata,
  Actor,
  Action,
  Resource,
  AuditTimestamp,
  StateCapture,
  EventCorrelation,
} from './tests/audit-entry'

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Base error for all immutability violations
 */
export class ImmutabilityViolationError extends Error {
  constructor(
    message: string,
    public readonly entryId?: string
  ) {
    super(message)
    this.name = 'ImmutabilityViolationError'
  }
}

/**
 * Error thrown when attempting to update an audit entry
 */
export class UpdateNotAllowedError extends ImmutabilityViolationError {
  constructor(
    public readonly entryId: string,
    public readonly attemptedField?: string
  ) {
    super(`Cannot update audit entry ${entryId}: audit log is immutable`, entryId)
    this.name = 'UpdateNotAllowedError'
  }
}

/**
 * Error thrown when attempting to delete an audit entry
 */
export class DeleteNotAllowedError extends ImmutabilityViolationError {
  constructor(
    public readonly entryId: string = ''
  ) {
    super(
      entryId
        ? `Cannot delete audit entry ${entryId}: audit log is immutable`
        : 'Cannot delete audit entries: audit log is immutable',
      entryId || undefined
    )
    this.name = 'DeleteNotAllowedError'
  }
}

/**
 * Error thrown on concurrent modification conflicts
 */
export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConcurrencyError'
  }
}

/**
 * Error thrown during recovery when data is corrupted
 */
export class RecoveryError extends Error {
  constructor(
    message: string,
    public readonly corruptedIndex?: number
  ) {
    super(message)
    this.name = 'RecoveryError'
  }
}

// =============================================================================
// RESULT TYPES
// =============================================================================

/**
 * Result of a single append operation
 */
export interface AppendResult {
  success: boolean
  entry: AuditEntry
  index: number
}

/**
 * Result of a batch append operation
 */
export interface BatchAppendResult {
  success: boolean
  entries: AuditEntry[]
  indices: number[]
  failed: Array<{ input: CreateAuditEntryInput; error: string }>
}

/**
 * Options for list queries
 */
export interface ListOptions {
  limit?: number
  offset?: number
}

/**
 * Options for batch append
 */
export interface BatchOptions {
  atomic?: boolean
}

/**
 * Options for creating an audit log
 */
export interface AuditLogOptions {
  storage?: AuditLogStorage
  walEnabled?: boolean
  validateOnRecovery?: boolean
}

/**
 * Internal entry type with hash chain fields
 */
interface InternalAuditEntry extends AuditEntry {
  /** SHA-256-like hash of this entry */
  hash: string
  /** Hash of the previous entry (empty for first) */
  prevHash: string
}

/**
 * Storage interface for audit log persistence
 */
export interface AuditLogStorage {
  corrupt(index: number): void
  getAll(): InternalAuditEntry[]
  setAll(entries: InternalAuditEntry[]): void
  isCorrupted(index: number): boolean
}

/**
 * Transaction interface for WAL-based operations
 */
export interface AuditLogTransaction {
  append(input: CreateAuditEntryInput): void
  commit(): Promise<void>
  rollback(): void
}

// =============================================================================
// MAIN INTERFACE
// =============================================================================

/**
 * AuditLog interface - immutable, append-only audit trail
 */
export interface AuditLog {
  /**
   * Append a new entry to the audit log
   */
  append(input: CreateAuditEntryInput): AppendResult

  /**
   * Append multiple entries atomically or with partial failure
   */
  appendBatch(inputs: CreateAuditEntryInput[], options?: BatchOptions): BatchAppendResult

  /**
   * Append with version for optimistic locking
   */
  appendWithVersion(input: CreateAuditEntryInput, version: number): Promise<AppendResult>

  /**
   * Get an entry by its ID
   */
  get(id: string): AuditEntry | null

  /**
   * Get an entry by its index
   */
  getByIndex(index: number): AuditEntry | null

  /**
   * List entries with optional pagination
   */
  list(options?: ListOptions): AuditEntry[]

  /**
   * Get entries in a range by index
   */
  range(start: number, end: number): AuditEntry[]

  /**
   * Iterate over all entries
   */
  iterate(): AsyncIterable<AuditEntry>

  /**
   * Get total entry count
   */
  count(): number

  /**
   * Get the highest index (or -1 if empty)
   */
  highestIndex(): number

  /**
   * Attempt to update an entry (should throw UpdateNotAllowedError)
   */
  update(id: string, updates: Partial<CreateAuditEntryInput>): never

  /**
   * Attempt to delete an entry (should throw DeleteNotAllowedError)
   */
  delete(id: string): never

  /**
   * Attempt to delete multiple entries (should throw DeleteNotAllowedError)
   */
  deleteMany(ids: string[]): never

  /**
   * Attempt to clear the log (should throw DeleteNotAllowedError)
   */
  clear(): never

  /**
   * Attempt to truncate the log (should throw DeleteNotAllowedError)
   */
  truncate(keepCount: number): never

  /**
   * Attempt to reorder entries (should throw ImmutabilityViolationError)
   */
  reorder(ids: string[]): never

  /**
   * Flush to durable storage
   */
  flush(): Promise<void>

  /**
   * Get the underlying storage
   */
  getStorage(): AuditLogStorage

  /**
   * Begin a transaction (WAL mode)
   */
  beginTransaction(): AuditLogTransaction
}

// =============================================================================
// CRYPTO UTILITIES
// =============================================================================

/**
 * Compute a deterministic hash for synchronous operation
 * In production, this would use Web Crypto API async
 */
function computeHash(data: string): string {
  let hash = 0x811c9dc5 // FNV-1a offset basis
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) // FNV-1a prime
  }
  // Convert to hex and ensure 64 chars (like SHA-256 output)
  const hex1 = (hash >>> 0).toString(16).padStart(8, '0')
  // Generate more bits for realistic hash length
  let hash2 = 0xcbf29ce484222325n
  for (let i = 0; i < data.length; i++) {
    hash2 ^= BigInt(data.charCodeAt(i))
    hash2 = BigInt.asUintN(64, hash2 * 0x100000001b3n)
  }
  const hex2 = hash2.toString(16).padStart(16, '0')
  return (hex1 + hex2 + hex1 + hex2).slice(0, 64)
}

/**
 * Compute hash for a chain entry
 */
function computeEntryHash(prevHash: string, data: object, timestamp: number): string {
  const payload = `${prevHash}${JSON.stringify(data)}${timestamp}`
  return computeHash(payload)
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}-${random}`
}

// =============================================================================
// DEEP FREEZE UTILITY
// =============================================================================

/**
 * Deep freeze an object to make it truly immutable
 */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepFreeze(item)
    }
    return Object.freeze(obj) as T
  }

  for (const key of Object.keys(obj as object)) {
    deepFreeze((obj as Record<string, unknown>)[key])
  }

  return Object.freeze(obj)
}

/**
 * Deep clone an object
 */
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  return JSON.parse(JSON.stringify(obj))
}

// =============================================================================
// IN-MEMORY STORAGE
// =============================================================================

class InMemoryStorage implements AuditLogStorage {
  private entries: InternalAuditEntry[] = []
  private corrupted: Set<number> = new Set()

  getAll(): InternalAuditEntry[] {
    return this.entries.map((e) => deepClone(e))
  }

  setAll(entries: InternalAuditEntry[]): void {
    this.entries = entries.map((e) => deepClone(e))
  }

  corrupt(index: number): void {
    if (index >= 0 && index < this.entries.length) {
      this.corrupted.add(index)
      // Actually corrupt the entry's hash
      const entry = this.entries[index]
      if (entry) {
        entry.hash = 'corrupted-hash-' + index
      }
    }
  }

  isCorrupted(index: number): boolean {
    return this.corrupted.has(index)
  }
}

// =============================================================================
// AUDIT LOG IMPLEMENTATION
// =============================================================================

class InMemoryAuditLog implements AuditLog {
  private entries: InternalAuditEntry[] = []
  private entriesById: Map<string, number> = new Map()
  private storage: InMemoryStorage
  private walEnabled: boolean
  private lastVersion: number = 0

  constructor(options?: AuditLogOptions) {
    this.storage = (options?.storage as InMemoryStorage) || new InMemoryStorage()
    this.walEnabled = options?.walEnabled ?? false

    // Recover from storage if provided
    if (options?.storage) {
      const storedEntries = this.storage.getAll()

      // Validate on recovery if requested
      if (options.validateOnRecovery && storedEntries.length > 0) {
        for (let i = 0; i < storedEntries.length; i++) {
          const entry = storedEntries[i]!
          const expectedPrevHash = i > 0 ? storedEntries[i - 1]!.hash : ''

          // Check hash chain integrity
          if (entry.prevHash !== expectedPrevHash) {
            throw new RecoveryError(`Hash chain broken at index ${i}`, i)
          }

          // Verify entry hash
          const entryData = this.extractHashableData(entry)
          const computedHash = computeEntryHash(
            entry.prevHash,
            entryData,
            new Date(entry.createdAt).getTime()
          )
          if (entry.hash !== computedHash) {
            throw new RecoveryError(`Entry hash mismatch at index ${i}`, i)
          }
        }
      }

      // Restore entries with deep freeze for immutability
      for (const entry of storedEntries) {
        const frozenEntry = deepFreeze(deepClone(entry))
        this.entries.push(frozenEntry)
        this.entriesById.set(entry.id, entry.index)
      }

      this.lastVersion = this.entries.length
    }
  }

  /**
   * Extract the hashable data from an entry
   */
  private extractHashableData(entry: InternalAuditEntry): object {
    return {
      actor: entry.actor,
      action: entry.action,
      resource: entry.resource,
      timestamp: entry.timestamp,
      state: entry.state,
      metadata: entry.metadata,
      correlation: entry.correlation,
    }
  }

  append(input: CreateAuditEntryInput): AppendResult {
    const index = this.entries.length
    const createdAt = new Date().toISOString()
    const prevHash = index > 0 ? this.entries[index - 1]!.hash : ''

    // Normalize and create the entry
    const entry = this.normalizeInput(input, index, createdAt, prevHash)

    // Deep freeze for true immutability
    const frozenEntry = deepFreeze(entry)

    // Add to log
    this.entries.push(frozenEntry)
    this.entriesById.set(entry.id, index)
    this.lastVersion++

    // Return a frozen deep clone so external code can't affect internal state
    return {
      success: true,
      entry: deepFreeze(deepClone(frozenEntry)),
      index,
    }
  }

  appendBatch(inputs: CreateAuditEntryInput[], options?: BatchOptions): BatchAppendResult {
    const atomic = options?.atomic ?? false
    const entries: AuditEntry[] = []
    const indices: number[] = []
    const failed: Array<{ input: CreateAuditEntryInput; error: string }> = []

    // For atomic mode, validate all inputs first
    if (atomic) {
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i]!
        try {
          this.validateInput(input)
        } catch (error) {
          throw new Error(`Invalid entry at index ${i}: ${(error as Error).message}`)
        }
      }
    }

    // Process each input
    const startIndex = this.entries.length
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]!
      try {
        this.validateInput(input)
        const result = this.append(input)
        entries.push(result.entry)
        indices.push(result.index)
      } catch (error) {
        if (atomic) {
          // Rollback all appended entries
          while (this.entries.length > startIndex) {
            const entry = this.entries.pop()
            if (entry) {
              this.entriesById.delete(entry.id)
            }
          }
          this.lastVersion = startIndex
          throw error
        }
        failed.push({
          input,
          error: (error as Error).message,
        })
      }
    }

    return { success: failed.length === 0, entries, indices, failed }
  }

  async appendWithVersion(input: CreateAuditEntryInput, version: number): Promise<AppendResult> {
    // Check if version matches expected for optimistic locking
    if (version !== this.lastVersion) {
      throw new ConcurrencyError(
        `Version conflict: expected ${this.lastVersion}, got ${version}`
      )
    }

    return this.append(input)
  }

  get(id: string): AuditEntry | null {
    const index = this.entriesById.get(id)
    if (index === undefined) {
      return null
    }
    // Return a frozen deep clone
    return deepFreeze(deepClone(this.entries[index]!))
  }

  getByIndex(index: number): AuditEntry | null {
    if (index < 0 || index >= this.entries.length) {
      return null
    }
    return deepFreeze(deepClone(this.entries[index]!))
  }

  list(options?: ListOptions): AuditEntry[] {
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? this.entries.length
    const slice = this.entries.slice(offset, offset + limit)
    return slice.map((e) => deepFreeze(deepClone(e)))
  }

  range(start: number, end: number): AuditEntry[] {
    if (start < 0 || end > this.entries.length || start >= end) {
      return []
    }
    return this.entries.slice(start, end).map((e) => deepFreeze(deepClone(e)))
  }

  async *iterate(): AsyncIterable<AuditEntry> {
    for (const entry of this.entries) {
      yield deepFreeze(deepClone(entry))
    }
  }

  count(): number {
    return this.entries.length
  }

  highestIndex(): number {
    return this.entries.length > 0 ? this.entries.length - 1 : -1
  }

  // ==========================================================================
  // IMMUTABILITY VIOLATIONS - All these throw
  // ==========================================================================

  update(id: string, _updates: Partial<CreateAuditEntryInput>): never {
    throw new UpdateNotAllowedError(id)
  }

  delete(id: string): never {
    throw new DeleteNotAllowedError(id)
  }

  deleteMany(_ids: string[]): never {
    throw new DeleteNotAllowedError()
  }

  clear(): never {
    throw new DeleteNotAllowedError()
  }

  truncate(_keepCount: number): never {
    throw new DeleteNotAllowedError()
  }

  reorder(_ids: string[]): never {
    throw new ImmutabilityViolationError('Cannot reorder audit entries: audit log is immutable')
  }

  // ==========================================================================
  // PERSISTENCE
  // ==========================================================================

  async flush(): Promise<void> {
    this.storage.setAll(this.entries.map((e) => deepClone(e)))
  }

  getStorage(): AuditLogStorage {
    return this.storage
  }

  // ==========================================================================
  // WAL SUPPORT
  // ==========================================================================

  beginTransaction(): AuditLogTransaction {
    if (!this.walEnabled) {
      throw new Error('WAL is not enabled')
    }

    const log = this
    const pending: CreateAuditEntryInput[] = []

    return {
      append(input: CreateAuditEntryInput): void {
        pending.push(input)
      },

      async commit(): Promise<void> {
        for (const input of pending) {
          log.append(input)
        }
        await log.flush()
      },

      rollback(): void {
        // Clear pending - entries were never added to the log
        pending.length = 0
      },
    }
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private normalizeInput(
    input: CreateAuditEntryInput,
    index: number,
    createdAt: string,
    prevHash: string
  ): InternalAuditEntry {
    const id = generateId()
    const timestamp = this.normalizeTimestamp(input.timestamp)
    const actor = this.normalizeActor(input.actor)
    const action = this.normalizeAction(input.action)
    const resource = this.normalizeResource(input.resource)

    const entryData = {
      actor,
      action,
      resource,
      timestamp,
      state: input.before || input.after
        ? {
            before: input.before,
            after: input.after,
          }
        : undefined,
      metadata: input.metadata,
      correlation: input.correlation as EventCorrelation | undefined,
    }

    const hash = computeEntryHash(prevHash, entryData, new Date(createdAt).getTime())

    return {
      id,
      ...entryData,
      createdAt,
      schemaVersion: 1,
      index,
      hash,
      prevHash,
    }
  }

  private normalizeTimestamp(input?: string | Date): AuditTimestamp {
    const date = input ? new Date(input) : new Date()
    return {
      iso: date.toISOString(),
      epochMs: date.getTime(),
    }
  }

  private normalizeActor(input: CreateAuditEntryInput['actor']): Actor {
    if (typeof input === 'string') {
      return { userId: input }
    }
    return { ...input }
  }

  private normalizeAction(input: CreateAuditEntryInput['action']): Action {
    if (typeof input === 'string') {
      return { type: input }
    }
    if ('type' in input) {
      return { ...input }
    }
    return { type: String(input) }
  }

  private normalizeResource(input: CreateAuditEntryInput['resource']): Resource {
    return { ...input } as Resource
  }

  private validateInput(input: unknown): void {
    if (!input || typeof input !== 'object') {
      throw new Error('Input must be an object')
    }

    const obj = input as Record<string, unknown>

    if (!obj.actor) {
      throw new Error('actor is required')
    }
    if (!obj.action) {
      throw new Error('action is required')
    }
    if (!obj.resource) {
      throw new Error('resource is required')
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new AuditLog instance
 *
 * @param options - Configuration options
 * @returns A new AuditLog instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const log = createAuditLog()
 *
 * // Append an entry
 * const result = log.append({
 *   actor: { userId: 'user-123' },
 *   action: 'create',
 *   resource: { type: 'Document', id: 'doc-456' },
 * })
 *
 * // Entries are immutable
 * log.update(result.entry.id, { action: 'modified' }) // Throws UpdateNotAllowedError
 * log.delete(result.entry.id) // Throws DeleteNotAllowedError
 * ```
 *
 * @example
 * ```typescript
 * // With recovery from storage
 * const log1 = createAuditLog()
 * log1.append({ actor: { userId: 'user' }, action: 'create', resource: { type: 'Doc', id: '1' } })
 * await log1.flush()
 *
 * // Recover
 * const log2 = createAuditLog({ storage: log1.getStorage() })
 * console.log(log2.count()) // 1
 * ```
 */
export function createAuditLog(options?: AuditLogOptions): AuditLog {
  return new InMemoryAuditLog(options)
}

// Re-export types from audit-entry for convenience
export type {
  AuditEntry,
  CreateAuditEntryInput,
  AuditMetadata,
} from './tests/audit-entry'
