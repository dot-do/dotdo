/**
 * StateStorage - Type-safe wrapper around Durable Object state API
 *
 * Provides:
 * - Type-safe get/set/delete operations
 * - Batch read/write
 * - Transactions
 * - Optional JSON schema validation
 * - State versioning/migration
 * - TTL support
 * - Key prefixing
 */

/// <reference types="@cloudflare/workers-types" />

// ============================================================================
// TYPES
// ============================================================================

/** Validator function type */
export type Validator<T = unknown> = (value: unknown) => value is T

/** Migration function type */
export type MigrationFn<T = unknown> = (data: unknown) => T

/** Migrations map by key and version */
export type Migrations = Record<string, Record<number, MigrationFn>>

/** Validators map by key */
export type Validators = Record<string, Validator>

/** Storage metadata for versioned values */
export interface ValueMetadata {
  version?: number
  createdAt: number
  updatedAt: number
  expiresAt?: number
}

/** Internal wrapped value structure */
interface WrappedValue<T = unknown> {
  value: T
  version?: number
  createdAt: number
  updatedAt: number
  expiresAt?: number
}

/** Options for StateStorage constructor */
export interface StateStorageOptions {
  /** Prefix for all keys */
  prefix?: string
  /** Default TTL in milliseconds */
  defaultTTL?: number
  /** Maximum value size in bytes */
  maxValueSize?: number
  /** Whether to use versioning */
  versioned?: boolean
  /** Current schema version */
  version?: number
  /** Validators by key pattern */
  validators?: Validators
  /** Whether to validate on get */
  validateOnGet?: boolean
  /** Migrations by key and version */
  migrations?: Migrations
}

/** Options for set operation */
export interface SetOptions {
  /** TTL in milliseconds (0 = no expiry) */
  ttl?: number
  /** Warn if value exceeds threshold */
  warnOnLargeValue?: boolean
  /** Threshold in bytes for large value warning */
  largeValueThreshold?: number
}

/** Options for list operation */
export interface ListOptions {
  prefix?: string
  limit?: number
  start?: string
  end?: string
}

/** Options for clear operation */
export interface ClearOptions {
  prefix?: string
}

/** Storage statistics */
export interface StorageStats {
  keyCount: number
  estimatedSize: number
}

/** Transaction context */
export interface TransactionContext {
  get<T>(key: string, defaultValue?: T): Promise<T | undefined>
  set<T>(key: string, value: T, options?: SetOptions): Promise<void>
  delete(key: string): Promise<boolean>
  has(key: string): Promise<boolean>
}

// ============================================================================
// ERRORS
// ============================================================================

export class StateStorageError extends Error {
  readonly key?: string
  readonly operation: string

  constructor(message: string, operation: string, key?: string) {
    super(message)
    this.name = 'StateStorageError'
    this.operation = operation
    this.key = key
  }
}

export class StateValidationError extends StateStorageError {
  readonly validatorKey: string

  constructor(key: string, validatorKey: string) {
    super(`Validation failed for key '${key}' using validator '${validatorKey}'`, 'validation', key)
    this.name = 'StateValidationError'
    this.validatorKey = validatorKey
  }
}

export class StateMigrationError extends StateStorageError {
  readonly fromVersion: number
  readonly toVersion: number

  constructor(key: string, fromVersion: number, toVersion: number, cause?: Error) {
    super(
      `Migration failed for key '${key}' from version ${fromVersion} to ${toVersion}: ${cause?.message || 'Unknown error'}`,
      'migration',
      key,
    )
    this.name = 'StateMigrationError'
    this.fromVersion = fromVersion
    this.toVersion = toVersion
  }
}

// ============================================================================
// STATE STORAGE
// ============================================================================

export class StateStorage {
  private readonly storage: DurableObjectStorage
  private readonly options: StateStorageOptions
  private readonly prefix: string
  private readonly versioned: boolean
  private readonly version: number
  private readonly validators: Validators
  private readonly validateOnGet: boolean
  private readonly migrations: Migrations
  private readonly defaultTTL: number
  private readonly maxValueSize?: number

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTRUCTOR
  // ═══════════════════════════════════════════════════════════════════════════

  constructor(state: DurableObjectState, options: StateStorageOptions = {}) {
    if (!state?.storage) {
      throw new StateStorageError('Invalid state: storage is required', 'constructor')
    }

    this.storage = state.storage
    this.options = options
    this.prefix = options.prefix ?? ''
    this.versioned = options.versioned ?? false
    this.version = options.version ?? 1
    this.validators = options.validators ?? {}
    this.validateOnGet = options.validateOnGet ?? false
    this.migrations = options.migrations ?? {}
    this.defaultTTL = options.defaultTTL ?? 0
    this.maxValueSize = options.maxValueSize
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a value by key
   */
  async get<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    try {
      const fullKey = this.prefixKey(key)
      const wrapped = await this.storage.get<WrappedValue<T>>(fullKey)

      if (wrapped === undefined) {
        return defaultValue
      }

      // Check for versioned wrapper vs raw value
      if (!this.isWrappedValue(wrapped)) {
        // Raw value (not wrapped), return as-is
        return wrapped as unknown as T
      }

      // Check TTL
      if (wrapped.expiresAt && Date.now() >= wrapped.expiresAt) {
        // Value expired, delete and return default
        await this.storage.delete(fullKey)
        return defaultValue
      }

      let value = wrapped.value

      // Run migrations if needed
      if (this.versioned && wrapped.version !== undefined && wrapped.version < this.version) {
        value = await this.migrateValue(key, value, wrapped.version)
        // Update stored value with new version
        await this.setInternal(key, value, { ttl: wrapped.expiresAt ? wrapped.expiresAt - Date.now() : 0 })
      }

      // Validate if configured
      if (this.validateOnGet) {
        this.validateValue(key, value)
      }

      return value
    } catch (error) {
      if (error instanceof StateStorageError) throw error
      throw new StateStorageError(`Failed to get key '${key}': ${(error as Error).message}`, 'get', key)
    }
  }

  /**
   * Set a value
   */
  async set<T>(key: string, value: T, options: SetOptions = {}): Promise<void> {
    // Validate if validator exists for this key
    this.validateValue(key, value)

    await this.setInternal(key, value, options)
  }

  /**
   * Internal set implementation
   */
  private async setInternal<T>(key: string, value: T, options: SetOptions = {}): Promise<void> {
    try {
      const fullKey = this.prefixKey(key)

      // Check value size if configured
      if (this.maxValueSize || options.warnOnLargeValue) {
        const size = this.estimateSize(value)

        if (this.maxValueSize && size > this.maxValueSize) {
          throw new StateStorageError(`Value exceeds maximum size (${size} > ${this.maxValueSize} bytes)`, 'set', key)
        }

        if (options.warnOnLargeValue && options.largeValueThreshold && size > options.largeValueThreshold) {
          console.warn(`StateStorage: large value detected for key '${key}' (${size} bytes)`)
        }
      }

      // Determine TTL
      const ttl = options.ttl !== undefined ? options.ttl : this.defaultTTL
      const now = Date.now()

      // Wrap value with metadata
      const wrapped: WrappedValue<T> = {
        value,
        createdAt: now,
        updatedAt: now,
        ...(this.versioned && { version: this.version }),
        ...(ttl > 0 && { expiresAt: now + ttl }),
      }

      // Check if updating existing value to preserve createdAt
      const existing = await this.storage.get<WrappedValue<unknown>>(fullKey)
      if (existing && this.isWrappedValue(existing)) {
        wrapped.createdAt = existing.createdAt
      }

      await this.storage.put(fullKey, wrapped)
    } catch (error) {
      if (error instanceof StateStorageError) throw error
      throw new StateStorageError(`Failed to set key '${key}': ${(error as Error).message}`, 'set', key)
    }
  }

  /**
   * Delete a value
   */
  async delete(key: string): Promise<boolean> {
    try {
      const fullKey = this.prefixKey(key)
      return await this.storage.delete(fullKey)
    } catch (error) {
      throw new StateStorageError(`Failed to delete key '${key}': ${(error as Error).message}`, 'delete', key)
    }
  }

  /**
   * Check if key exists
   */
  async has(key: string): Promise<boolean> {
    const value = await this.get(key)
    return value !== undefined
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get multiple values at once
   */
  async getMany<T>(keys: string[]): Promise<Record<string, T | undefined>> {
    const result: Record<string, T | undefined> = {}

    // Process all keys
    await Promise.all(
      keys.map(async (key) => {
        result[key] = await this.get<T>(key)
      }),
    )

    return result
  }

  /**
   * Set multiple values at once
   */
  async setMany(values: Record<string, unknown>, options: SetOptions = {}): Promise<void> {
    await Promise.all(Object.entries(values).map(([key, value]) => this.set(key, value, options)))
  }

  /**
   * Delete multiple keys at once
   */
  async deleteMany(keys: string[]): Promise<number> {
    let count = 0
    await Promise.all(
      keys.map(async (key) => {
        if (await this.delete(key)) {
          count++
        }
      }),
    )
    return count
  }

  /**
   * List entries with optional filtering
   */
  async list<T = unknown>(options: ListOptions = {}): Promise<Map<string, T>> {
    const storagePrefix = this.prefix + (options.prefix ?? '')
    const entries = await this.storage.list<WrappedValue<T>>({
      prefix: storagePrefix,
      limit: options.limit,
      start: options.start ? this.prefix + options.start : undefined,
      end: options.end ? this.prefix + options.end : undefined,
    })

    const result = new Map<string, T>()
    const now = Date.now()

    for (const [fullKey, wrapped] of entries) {
      // Strip prefix from key
      const key = this.stripPrefix(fullKey)

      // Skip expired values
      if (this.isWrappedValue(wrapped) && wrapped.expiresAt && now >= wrapped.expiresAt) {
        continue
      }

      // Extract value
      const value = this.isWrappedValue(wrapped) ? wrapped.value : (wrapped as unknown as T)
      result.set(key, value)
    }

    return result
  }

  /**
   * Get keys with optional prefix filter
   */
  async keys(options: ListOptions = {}): Promise<string[]> {
    const entries = await this.list(options)
    return Array.from(entries.keys())
  }

  /**
   * Count entries with optional prefix filter
   */
  async count(options: ListOptions = {}): Promise<number> {
    const entries = await this.list(options)
    return entries.size
  }

  /**
   * Clear all entries or entries with prefix
   */
  async clear(options: ClearOptions = {}): Promise<void> {
    if (options.prefix) {
      // Delete only entries with the given prefix
      const keys = await this.keys({ prefix: options.prefix })
      await this.deleteMany(keys)
    } else {
      // Delete all entries
      await this.storage.deleteAll()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a transaction
   */
  async transaction<T>(closure: (tx: TransactionContext) => Promise<T>): Promise<T> {
    // Create transaction context
    const tx: TransactionContext = {
      get: async <V>(key: string, defaultValue?: V) => this.get<V>(key, defaultValue),
      set: async <V>(key: string, value: V, options?: SetOptions) => this.set<V>(key, value, options),
      delete: async (key: string) => this.delete(key),
      has: async (key: string) => this.has(key),
    }

    // Use DO storage transaction
    return await this.storage.transaction(async () => {
      return await closure(tx)
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // METADATA & UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get metadata for a key
   */
  async getMetadata(key: string): Promise<ValueMetadata | undefined> {
    const fullKey = this.prefixKey(key)
    const wrapped = await this.storage.get<WrappedValue<unknown>>(fullKey)

    if (!wrapped || !this.isWrappedValue(wrapped)) {
      return undefined
    }

    return {
      version: wrapped.version,
      createdAt: wrapped.createdAt,
      updatedAt: wrapped.updatedAt,
      expiresAt: wrapped.expiresAt,
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<StorageStats> {
    const entries = await this.list()
    let estimatedSize = 0

    for (const [key, value] of entries) {
      estimatedSize += key.length * 2 // UTF-16 chars
      estimatedSize += this.estimateSize(value)
    }

    return {
      keyCount: entries.size,
      estimatedSize,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if value is a wrapped value (has our metadata structure)
   */
  private isWrappedValue<T>(value: unknown): value is WrappedValue<T> {
    if (typeof value !== 'object' || value === null) return false
    const obj = value as Record<string, unknown>
    return 'value' in obj && 'createdAt' in obj && 'updatedAt' in obj
  }

  /**
   * Add prefix to key
   */
  private prefixKey(key: string): string {
    return this.prefix + key
  }

  /**
   * Remove prefix from key
   */
  private stripPrefix(key: string): string {
    if (this.prefix && key.startsWith(this.prefix)) {
      return key.slice(this.prefix.length)
    }
    return key
  }

  /**
   * Validate a value using configured validator
   */
  private validateValue(key: string, value: unknown): void {
    // Find validator for this key
    const validator = this.validators[key]
    if (validator && !validator(value)) {
      throw new StateValidationError(key, key)
    }
  }

  /**
   * Run migrations on a value
   */
  private async migrateValue<T>(key: string, value: unknown, fromVersion: number): Promise<T> {
    const keyMigrations = this.migrations[key]
    if (!keyMigrations) {
      // No migrations defined for this key, return as-is
      return value as T
    }

    let currentValue = value
    let currentVersion = fromVersion

    // Run migrations in sequence
    while (currentVersion < this.version) {
      const migration = keyMigrations[currentVersion]
      if (migration) {
        try {
          currentValue = migration(currentValue)
        } catch (error) {
          throw new StateMigrationError(key, currentVersion, currentVersion + 1, error as Error)
        }
      }
      currentVersion++
    }

    return currentValue as T
  }

  /**
   * Estimate size of a value in bytes
   */
  private estimateSize(value: unknown): number {
    try {
      const json = JSON.stringify(value)
      return json.length * 2 // Rough estimate for UTF-16
    } catch {
      return 0
    }
  }
}

export default StateStorage
