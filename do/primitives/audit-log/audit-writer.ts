/**
 * AuditWriter - Audit entry writer with schema validation
 *
 * Provides schema validation, automatic timestamps, state diffing,
 * and sensitive field masking for audit entries.
 *
 * @module db/primitives/audit-log
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Actor type discriminator
 */
export type ActorType = 'user' | 'service' | 'system'

/**
 * Standard audit actions
 */
export type AuditAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'grant'
  | 'revoke'
  | string

/**
 * Actor information
 */
export interface Actor {
  type: ActorType
  id: string
  email?: string
  name?: string
  [key: string]: unknown
}

/**
 * Diff result for before/after comparison
 */
export interface StateDiff {
  changed: string[]
  added: string[]
  removed: string[]
}

/**
 * Audit entry structure
 */
export interface AuditEntry {
  id?: string
  action: AuditAction
  resource: string
  actor: Actor
  timestamp?: Date
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  diff?: StateDiff
  metadata?: Record<string, unknown>
  correlationId?: string
  reason?: string
  outcome?: 'success' | 'failure' | string
}

/**
 * Store interface for persisting audit entries
 */
export interface AuditStore {
  write(entry: AuditEntry): Promise<void>
  writeBatch(entries: AuditEntry[]): Promise<void>
}

/**
 * Writer options
 */
export interface AuditWriterOptions {
  store: AuditStore
  bufferSize?: number
  flushInterval?: number
  defaultMaskedFields?: string[]
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generates a unique ID
 */
function generateId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Deep clones an object
 */
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as unknown as T
  }
  const cloned: Record<string, unknown> = {}
  for (const key of Object.keys(obj as object)) {
    cloned[key] = deepClone((obj as Record<string, unknown>)[key])
  }
  return cloned as T
}

/**
 * Computes diff between two objects
 */
function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): StateDiff {
  const diff: StateDiff = {
    changed: [],
    added: [],
    removed: [],
  }

  const beforeKeys = new Set(Object.keys(before))
  const afterKeys = new Set(Object.keys(after))

  // Find added keys
  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) {
      diff.added.push(key)
    }
  }

  // Find removed keys
  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) {
      diff.removed.push(key)
    }
  }

  // Find changed keys
  for (const key of beforeKeys) {
    if (afterKeys.has(key)) {
      const beforeVal = before[key]
      const afterVal = after[key]
      if (!deepEqual(beforeVal, afterVal)) {
        diff.changed.push(key)
      }
    }
  }

  return diff
}

/**
 * Deep equality check
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((val, idx) => deepEqual(val, b[idx]))
  }

  if (Array.isArray(a) !== Array.isArray(b)) return false

  const aKeys = Object.keys(a as object)
  const bKeys = Object.keys(b as object)

  if (aKeys.length !== bKeys.length) return false

  return aKeys.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key]
    )
  )
}

/**
 * Masks a field value
 */
function maskValue(_value: unknown): string {
  return '[REDACTED]'
}

/**
 * Gets a nested value using dot notation
 */
function getNestedValue(
  obj: Record<string, unknown>,
  path: string
): unknown | undefined {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Sets a nested value using dot notation
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split('.')
  let current: Record<string, unknown> = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (current[part] === undefined || current[part] === null) {
      return // Path doesn't exist
    }
    if (typeof current[part] !== 'object') {
      return // Can't traverse non-object
    }
    current = current[part] as Record<string, unknown>
  }

  const lastPart = parts[parts.length - 1]
  if (lastPart in current) {
    current[lastPart] = value
  }
}

/**
 * Masks sensitive fields in an object
 */
function maskSensitiveFields(
  obj: Record<string, unknown> | undefined,
  fields: string[]
): Record<string, unknown> | undefined {
  if (!obj) return obj

  const cloned = deepClone(obj)

  for (const field of fields) {
    if (field.includes('.')) {
      // Nested field
      const value = getNestedValue(cloned, field)
      if (value !== undefined) {
        setNestedValue(cloned, field, maskValue(value))
      }
    } else {
      // Top-level field
      if (field in cloned) {
        cloned[field] = maskValue(cloned[field])
      }
    }
  }

  return cloned
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

const VALID_ACTOR_TYPES = new Set<ActorType>(['user', 'service', 'system'])

/**
 * Validates an audit entry
 */
function validateEntry(entry: AuditEntry): void {
  // Validate action
  if (!entry.action || typeof entry.action !== 'string' || entry.action.trim() === '') {
    throw new Error('Invalid entry: action is required and must be a non-empty string')
  }

  // Validate resource
  if (!entry.resource || typeof entry.resource !== 'string' || entry.resource.trim() === '') {
    throw new Error('Invalid entry: resource is required and must be a non-empty string')
  }

  // Validate actor
  if (!entry.actor) {
    throw new Error('Invalid entry: actor is required')
  }

  if (!entry.actor.type || !VALID_ACTOR_TYPES.has(entry.actor.type)) {
    throw new Error(
      `Invalid entry: actor type must be one of: ${[...VALID_ACTOR_TYPES].join(', ')}`
    )
  }

  if (!entry.actor.id || typeof entry.actor.id !== 'string' || entry.actor.id.trim() === '') {
    throw new Error('Invalid entry: actor id is required and must be a non-empty string')
  }
}

// =============================================================================
// CORRELATED WRITER
// =============================================================================

/**
 * Writer wrapper that adds correlation ID to entries
 */
class CorrelatedWriter {
  private writer: AuditWriter
  private correlationId: string
  private maskedFields: string[] = []

  constructor(writer: AuditWriter, correlationId: string) {
    this.writer = writer
    this.correlationId = correlationId
  }

  /**
   * Sets fields to mask for this write
   */
  maskFields(fields: string[]): this {
    this.maskedFields = fields
    return this
  }

  /**
   * Writes an entry with correlation ID
   */
  async write(entry: AuditEntry): Promise<void> {
    const correlatedEntry = {
      ...entry,
      correlationId: this.correlationId,
    }

    if (this.maskedFields.length > 0) {
      return this.writer.maskFields(this.maskedFields).write(correlatedEntry)
    }

    return this.writer.write(correlatedEntry)
  }
}

/**
 * Writer wrapper that masks fields
 */
class MaskedWriter {
  private writer: AuditWriter
  private fields: string[]
  private correlationId?: string

  constructor(writer: AuditWriter, fields: string[], correlationId?: string) {
    this.writer = writer
    this.fields = fields
    this.correlationId = correlationId
  }

  /**
   * Writes an entry with masked fields
   */
  async write(entry: AuditEntry): Promise<void> {
    const maskedEntry = {
      ...entry,
      correlationId: this.correlationId ?? entry.correlationId,
    }

    // Apply masking through the writer's internal method
    return this.writer['writeWithMask'](maskedEntry, this.fields)
  }
}

// =============================================================================
// AUDIT WRITER CLASS
// =============================================================================

/**
 * AuditWriter - Main class for writing audit entries
 */
export class AuditWriter {
  private store: AuditStore
  private bufferLimit: number
  private flushInterval: number
  private defaultMaskedFields: string[]
  private buffer: AuditEntry[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private closed: boolean = false
  private pendingFlush: Promise<void> | null = null

  constructor(options: AuditWriterOptions) {
    this.store = options.store
    this.bufferLimit = options.bufferSize ?? 100
    this.flushInterval = options.flushInterval ?? 1000
    this.defaultMaskedFields = options.defaultMaskedFields ?? []

    // Start flush timer if interval is set
    if (this.flushInterval > 0) {
      this.flushTimer = setInterval(() => {
        this.flush().catch(console.error)
      }, this.flushInterval)
    }
  }

  /**
   * Gets current buffer size (number of entries in buffer)
   */
  get bufferSize(): number {
    return this.buffer.length
  }

  /**
   * Writes a single audit entry
   */
  async write(entry: AuditEntry): Promise<void> {
    if (this.closed) {
      throw new Error('AuditWriter is closed')
    }

    // Validate entry
    validateEntry(entry)

    // Process entry
    const processedEntry = this.processEntry(entry, this.defaultMaskedFields)

    // Add to buffer
    this.buffer.push(processedEntry)

    // Auto-flush if buffer is full
    if (this.buffer.length >= this.bufferLimit) {
      await this.flush()
    }
  }

  /**
   * Internal method to write with additional mask fields
   */
  private async writeWithMask(
    entry: AuditEntry,
    additionalFields: string[]
  ): Promise<void> {
    if (this.closed) {
      throw new Error('AuditWriter is closed')
    }

    // Validate entry
    validateEntry(entry)

    // Combine default and additional mask fields
    const allMaskFields = [...this.defaultMaskedFields, ...additionalFields]

    // Process entry
    const processedEntry = this.processEntry(entry, allMaskFields)

    // Add to buffer
    this.buffer.push(processedEntry)

    // Auto-flush if buffer is full
    if (this.buffer.length >= this.bufferLimit) {
      await this.flush()
    }
  }

  /**
   * Writes multiple entries in batch
   */
  async writeBatch(entries: AuditEntry[]): Promise<void> {
    if (this.closed) {
      throw new Error('AuditWriter is closed')
    }

    // Validate all entries first
    for (const entry of entries) {
      validateEntry(entry)
    }

    // Process all entries
    const processedEntries = entries.map((entry) =>
      this.processEntry(entry, this.defaultMaskedFields)
    )

    // Add to buffer
    this.buffer.push(...processedEntries)

    // Auto-flush if buffer is full
    if (this.buffer.length >= this.bufferLimit) {
      await this.flush()
    }
  }

  /**
   * Creates a writer with correlation ID
   */
  withCorrelation(correlationId: string): CorrelatedWriter {
    return new CorrelatedWriter(this, correlationId)
  }

  /**
   * Creates a writer with masked fields
   */
  maskFields(fields: string[]): MaskedWriter {
    return new MaskedWriter(this, fields)
  }

  /**
   * Flushes the buffer to the store
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return
    }

    // Wait for any pending flush
    if (this.pendingFlush) {
      await this.pendingFlush
    }

    // Get entries to flush
    const entries = [...this.buffer]
    this.buffer = []

    // Write to store
    this.pendingFlush = this.store.writeBatch(entries)
    await this.pendingFlush
    this.pendingFlush = null
  }

  /**
   * Closes the writer, flushing remaining entries
   */
  async close(): Promise<void> {
    if (this.closed) return

    this.closed = true

    // Stop flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    // Flush remaining entries
    await this.flush()
  }

  /**
   * Processes an entry with defaults and transformations
   */
  private processEntry(
    entry: AuditEntry,
    maskedFields: string[]
  ): AuditEntry {
    const processed: AuditEntry = {
      ...entry,
      id: entry.id ?? generateId(),
      timestamp: entry.timestamp ?? new Date(),
    }

    // Mask sensitive fields
    if (maskedFields.length > 0) {
      if (processed.before) {
        processed.before = maskSensitiveFields(processed.before, maskedFields)
      }
      if (processed.after) {
        processed.after = maskSensitiveFields(processed.after, maskedFields)
      }
    }

    // Calculate diff if both before and after are provided
    if (processed.before && processed.after) {
      processed.diff = computeDiff(processed.before, processed.after)
    }

    return processed
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Creates a new AuditWriter instance
 */
export function createAuditWriter(options: AuditWriterOptions): AuditWriter {
  return new AuditWriter(options)
}
