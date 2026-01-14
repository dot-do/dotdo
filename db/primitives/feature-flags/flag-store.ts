/**
 * FlagStore - Feature flag storage with versioning and audit trail
 *
 * Provides a complete feature flag management system with:
 * - **CRUD operations**: create, update, get, list flags
 * - **Version history**: automatic versioning on every change
 * - **Rollback**: restore flags to previous versions
 * - **Environment scoping**: dev, staging, prod isolation
 * - **Archiving**: soft delete with restore capability
 * - **Bulk operations**: batch create, update, archive
 * - **Audit trail**: track who changed what, when, and why
 *
 * @module db/primitives/feature-flags/flag-store
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Supported environments for feature flags
 */
export type Environment = 'dev' | 'staging' | 'prod'

/**
 * Change type for audit trail
 */
export type ChangeType = 'create' | 'update' | 'archive' | 'restore' | 'rollback'

/**
 * Flag definition for creating or updating flags
 */
export interface FlagDefinition {
  /** Unique identifier for the flag */
  key: string
  /** Human-readable name */
  name: string
  /** Whether the flag is enabled */
  enabled: boolean
  /** Optional description */
  description?: string
  /** Owner email or identifier */
  owner?: string
  /** Expiration date for temporary flags */
  expiry?: Date
  /** Environment scope */
  environment?: Environment
  /** Tags for organization/filtering */
  tags?: string[]
}

/**
 * Complete flag entity with metadata
 */
export interface Flag {
  /** Unique identifier for the flag */
  key: string
  /** Human-readable name */
  name: string
  /** Whether the flag is enabled */
  enabled: boolean
  /** Optional description */
  description?: string
  /** Owner email or identifier */
  owner?: string
  /** Expiration date */
  expiry?: Date
  /** Environment scope */
  environment: Environment
  /** Tags for organization */
  tags?: string[]
  /** Current version number */
  version: number
  /** Whether the flag is archived */
  archived: boolean
  /** When the flag was archived */
  archivedAt: Date | null
  /** When the flag was created */
  createdAt: Date
  /** When the flag was last updated */
  updatedAt: Date
}

/**
 * Single change record showing what changed
 */
export interface FieldChange {
  from: unknown
  to: unknown
}

/**
 * Changes map for audit trail
 */
export interface Changes {
  [field: string]: FieldChange
}

/**
 * Version history entry for audit trail
 */
export interface FlagVersion {
  /** Flag key */
  key: string
  /** Version number */
  version: number
  /** Human-readable name at this version */
  name: string
  /** Enabled status at this version */
  enabled: boolean
  /** Description at this version */
  description?: string
  /** Owner at this version */
  owner?: string
  /** Expiry at this version */
  expiry?: Date
  /** Environment at this version */
  environment: Environment
  /** Tags at this version */
  tags?: string[]
  /** Type of change */
  changeType: ChangeType
  /** Who made the change */
  changedBy?: string
  /** When the change was made */
  changedAt: Date
  /** Reason for the change */
  reason?: string
  /** What fields changed (for updates) */
  changes?: Changes
  /** If rollback, which version was rolled back to */
  rolledBackTo?: number
}

/**
 * Filters for listing flags
 */
export interface FlagFilters {
  /** Filter by enabled status */
  enabled?: boolean
  /** Filter by environment */
  environment?: Environment
  /** Filter by owner */
  owner?: string
  /** Filter by tags (matches any) */
  tags?: string[]
  /** Include archived flags */
  includeArchived?: boolean
  /** Pagination limit */
  limit?: number
  /** Pagination offset */
  offset?: number
}

/**
 * Options for creating a flag store
 */
export interface FlagStoreOptions {
  /** Default environment for operations */
  defaultEnvironment?: Environment
  /** Default actor for audit trail */
  defaultActor?: string
}

/**
 * Flag store interface
 */
export interface FlagStore {
  /**
   * Create a new flag
   * @param flag Flag definition
   * @param actor Who is creating the flag
   * @returns The created flag
   */
  create(flag: FlagDefinition, actor?: string): Promise<Flag>

  /**
   * Create multiple flags at once
   * @param flags Flag definitions
   * @param actor Who is creating the flags
   * @returns The created flags
   */
  createMany(flags: FlagDefinition[], actor?: string): Promise<Flag[]>

  /**
   * Update an existing flag
   * @param key Flag key
   * @param changes Partial changes to apply
   * @param environment Target environment
   * @param actor Who is making the change
   * @param reason Reason for the change
   * @returns The updated flag
   */
  update(
    key: string,
    changes: Partial<FlagDefinition>,
    environment?: Environment,
    actor?: string,
    reason?: string
  ): Promise<Flag>

  /**
   * Update multiple flags at once
   * @param keys Flag keys
   * @param changes Changes to apply to all
   * @param environment Target environment
   * @param actor Who is making the change
   * @returns The updated flags
   */
  updateMany(
    keys: string[],
    changes: Partial<FlagDefinition>,
    environment?: Environment,
    actor?: string
  ): Promise<Flag[]>

  /**
   * Get a flag by key
   * @param key Flag key
   * @param environment Target environment
   * @returns The flag or null if not found
   */
  get(key: string, environment?: Environment): Promise<Flag | null>

  /**
   * List flags with optional filters
   * @param filters Optional filters
   * @returns Array of flags
   */
  list(filters?: FlagFilters): Promise<Flag[]>

  /**
   * Rollback a flag to a previous version
   * @param key Flag key
   * @param version Version number to rollback to
   * @param environment Target environment
   * @param actor Who is performing the rollback
   * @returns The flag at the rolled-back state
   */
  rollback(key: string, version: number, environment?: Environment, actor?: string): Promise<Flag>

  /**
   * Archive a flag (soft delete)
   * @param key Flag key
   * @param environment Target environment
   * @param actor Who is archiving
   */
  archive(key: string, environment?: Environment, actor?: string): Promise<void>

  /**
   * Archive multiple flags at once
   * @param keys Flag keys
   * @param environment Target environment
   * @param actor Who is archiving
   */
  archiveMany(keys: string[], environment?: Environment, actor?: string): Promise<void>

  /**
   * Restore an archived flag
   * @param key Flag key
   * @param environment Target environment
   * @param actor Who is restoring
   */
  restore(key: string, environment?: Environment, actor?: string): Promise<void>

  /**
   * Get version history for a flag
   * @param key Flag key
   * @param environment Target environment
   * @returns Array of version entries
   */
  getHistory(key: string, environment?: Environment): Promise<FlagVersion[]>

  /**
   * Promote a flag from one environment to another
   * @param key Flag key
   * @param sourceEnv Source environment
   * @param targetEnv Target environment
   * @param actor Who is promoting
   * @returns The promoted flag in the target environment
   */
  promote(key: string, sourceEnv: Environment, targetEnv: Environment, actor?: string): Promise<Flag>

  /**
   * Clone a flag to another environment
   * @param key Flag key
   * @param sourceEnv Source environment
   * @param targetEnv Target environment
   * @param actor Who is cloning
   * @returns The cloned flag
   */
  clone(key: string, sourceEnv: Environment, targetEnv: Environment, actor?: string): Promise<Flag>
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

/**
 * Internal storage key combining flag key and environment
 * @internal
 */
type StorageKey = string

/**
 * Create a storage key from flag key and environment
 * @internal
 */
function makeStorageKey(key: string, environment: Environment): StorageKey {
  return `${environment}:${key}`
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * In-memory FlagStore implementation
 */
class InMemoryFlagStore implements FlagStore {
  private flags: Map<StorageKey, Flag> = new Map()
  private history: Map<StorageKey, FlagVersion[]> = new Map()
  private defaultEnvironment: Environment
  private defaultActor?: string
  private versionLocks: Map<StorageKey, Promise<void>> = new Map()

  constructor(options: FlagStoreOptions = {}) {
    this.defaultEnvironment = options.defaultEnvironment ?? 'dev'
    this.defaultActor = options.defaultActor
  }

  /**
   * Acquire a lock for a storage key to handle concurrent updates
   */
  private async acquireLock(storageKey: StorageKey): Promise<() => void> {
    // Wait for any existing operation
    const existing = this.versionLocks.get(storageKey)
    if (existing) {
      await existing
    }

    // Create a new lock
    let releaseLock: () => void
    const lockPromise = new Promise<void>(resolve => {
      releaseLock = resolve
    })

    this.versionLocks.set(storageKey, lockPromise)

    return () => {
      releaseLock!()
      this.versionLocks.delete(storageKey)
    }
  }

  async create(definition: FlagDefinition, actor?: string): Promise<Flag> {
    const environment = definition.environment ?? this.defaultEnvironment
    const storageKey = makeStorageKey(definition.key, environment)
    const changedBy = actor ?? this.defaultActor

    const release = await this.acquireLock(storageKey)

    try {
      if (this.flags.has(storageKey)) {
        throw new Error(`Flag '${definition.key}' already exists in environment '${environment}'`)
      }

      const now = new Date()
      const flag: Flag = {
        key: definition.key,
        name: definition.name,
        enabled: definition.enabled,
        description: definition.description,
        owner: definition.owner,
        expiry: definition.expiry,
        environment,
        tags: definition.tags,
        version: 1,
        archived: false,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      }

      this.flags.set(storageKey, flag)

      // Record in history
      const version: FlagVersion = {
        key: definition.key,
        version: 1,
        name: definition.name,
        enabled: definition.enabled,
        description: definition.description,
        owner: definition.owner,
        expiry: definition.expiry,
        environment,
        tags: definition.tags,
        changeType: 'create',
        changedBy,
        changedAt: now,
      }

      this.history.set(storageKey, [version])

      return { ...flag }
    } finally {
      release()
    }
  }

  async createMany(definitions: FlagDefinition[], actor?: string): Promise<Flag[]> {
    const results: Flag[] = []
    for (const definition of definitions) {
      const flag = await this.create(definition, actor)
      results.push(flag)
    }
    return results
  }

  async update(
    key: string,
    changes: Partial<FlagDefinition>,
    environment?: Environment,
    actor?: string,
    reason?: string
  ): Promise<Flag> {
    const env = environment ?? this.defaultEnvironment
    const storageKey = makeStorageKey(key, env)
    const changedBy = actor ?? this.defaultActor

    const release = await this.acquireLock(storageKey)

    try {
      const existing = this.flags.get(storageKey)
      if (!existing) {
        throw new Error(`Flag '${key}' not found in environment '${env}'`)
      }

      const now = new Date()

      // Calculate changes diff
      const diff: Changes = {}
      if (changes.name !== undefined && changes.name !== existing.name) {
        diff.name = { from: existing.name, to: changes.name }
      }
      if (changes.enabled !== undefined && changes.enabled !== existing.enabled) {
        diff.enabled = { from: existing.enabled, to: changes.enabled }
      }
      if (changes.description !== undefined && changes.description !== existing.description) {
        diff.description = { from: existing.description, to: changes.description }
      }
      if (changes.owner !== undefined && changes.owner !== existing.owner) {
        diff.owner = { from: existing.owner, to: changes.owner }
      }
      if (changes.expiry !== undefined && changes.expiry?.getTime() !== existing.expiry?.getTime()) {
        diff.expiry = { from: existing.expiry, to: changes.expiry }
      }
      if (changes.tags !== undefined && JSON.stringify(changes.tags) !== JSON.stringify(existing.tags)) {
        diff.tags = { from: existing.tags, to: changes.tags }
      }

      const updated: Flag = {
        ...existing,
        name: changes.name ?? existing.name,
        enabled: changes.enabled ?? existing.enabled,
        description: changes.description ?? existing.description,
        owner: changes.owner ?? existing.owner,
        expiry: changes.expiry ?? existing.expiry,
        tags: changes.tags ?? existing.tags,
        version: existing.version + 1,
        updatedAt: now,
      }

      this.flags.set(storageKey, updated)

      // Record in history
      const version: FlagVersion = {
        key,
        version: updated.version,
        name: updated.name,
        enabled: updated.enabled,
        description: updated.description,
        owner: updated.owner,
        expiry: updated.expiry,
        environment: updated.environment,
        tags: updated.tags,
        changeType: 'update',
        changedBy,
        changedAt: now,
        reason,
        changes: Object.keys(diff).length > 0 ? diff : undefined,
      }

      const historyList = this.history.get(storageKey) ?? []
      historyList.push(version)
      this.history.set(storageKey, historyList)

      return { ...updated }
    } finally {
      release()
    }
  }

  async updateMany(
    keys: string[],
    changes: Partial<FlagDefinition>,
    environment?: Environment,
    actor?: string
  ): Promise<Flag[]> {
    const env = environment ?? this.defaultEnvironment

    // Verify all flags exist first
    for (const key of keys) {
      const storageKey = makeStorageKey(key, env)
      if (!this.flags.has(storageKey)) {
        throw new Error(`Flag '${key}' not found in environment '${env}'`)
      }
    }

    const results: Flag[] = []
    for (const key of keys) {
      const flag = await this.update(key, changes, environment, actor)
      results.push(flag)
    }
    return results
  }

  async get(key: string, environment?: Environment): Promise<Flag | null> {
    const env = environment ?? this.defaultEnvironment
    const storageKey = makeStorageKey(key, env)
    const flag = this.flags.get(storageKey)
    return flag ? { ...flag } : null
  }

  async list(filters?: FlagFilters): Promise<Flag[]> {
    let flags = Array.from(this.flags.values())

    // Filter by environment
    if (filters?.environment) {
      flags = flags.filter(f => f.environment === filters.environment)
    }

    // Filter by enabled status
    if (filters?.enabled !== undefined) {
      flags = flags.filter(f => f.enabled === filters.enabled)
    }

    // Filter by owner
    if (filters?.owner) {
      flags = flags.filter(f => f.owner === filters.owner)
    }

    // Filter by tags
    if (filters?.tags && filters.tags.length > 0) {
      flags = flags.filter(f => f.tags?.some(t => filters.tags!.includes(t)))
    }

    // Filter archived
    if (!filters?.includeArchived) {
      flags = flags.filter(f => !f.archived)
    }

    // Sort by key for consistent ordering
    flags.sort((a, b) => a.key.localeCompare(b.key))

    // Pagination
    const offset = filters?.offset ?? 0
    const limit = filters?.limit ?? flags.length
    flags = flags.slice(offset, offset + limit)

    return flags.map(f => ({ ...f }))
  }

  async rollback(
    key: string,
    version: number,
    environment?: Environment,
    actor?: string
  ): Promise<Flag> {
    const env = environment ?? this.defaultEnvironment
    const storageKey = makeStorageKey(key, env)
    const changedBy = actor ?? this.defaultActor

    const release = await this.acquireLock(storageKey)

    try {
      const existing = this.flags.get(storageKey)
      if (!existing) {
        throw new Error(`Flag '${key}' not found in environment '${env}'`)
      }

      const historyList = this.history.get(storageKey) ?? []
      const targetVersion = historyList.find(v => v.version === version)

      if (!targetVersion) {
        throw new Error(`Version ${version} not found for flag '${key}'`)
      }

      const now = new Date()
      const rolledBack: Flag = {
        key: existing.key,
        name: targetVersion.name,
        enabled: targetVersion.enabled,
        description: targetVersion.description,
        owner: targetVersion.owner,
        expiry: targetVersion.expiry,
        environment: existing.environment,
        tags: targetVersion.tags,
        version: existing.version + 1,
        archived: existing.archived,
        archivedAt: existing.archivedAt,
        createdAt: existing.createdAt,
        updatedAt: now,
      }

      this.flags.set(storageKey, rolledBack)

      // Record rollback in history
      const versionEntry: FlagVersion = {
        key,
        version: rolledBack.version,
        name: rolledBack.name,
        enabled: rolledBack.enabled,
        description: rolledBack.description,
        owner: rolledBack.owner,
        expiry: rolledBack.expiry,
        environment: rolledBack.environment,
        tags: rolledBack.tags,
        changeType: 'rollback',
        changedBy,
        changedAt: now,
        rolledBackTo: version,
      }

      historyList.push(versionEntry)
      this.history.set(storageKey, historyList)

      return { ...rolledBack }
    } finally {
      release()
    }
  }

  async archive(key: string, environment?: Environment, actor?: string): Promise<void> {
    const env = environment ?? this.defaultEnvironment
    const storageKey = makeStorageKey(key, env)
    const changedBy = actor ?? this.defaultActor

    const release = await this.acquireLock(storageKey)

    try {
      const existing = this.flags.get(storageKey)
      if (!existing) {
        throw new Error(`Flag '${key}' not found in environment '${env}'`)
      }

      const now = new Date()
      const archived: Flag = {
        ...existing,
        archived: true,
        archivedAt: now,
        version: existing.version + 1,
        updatedAt: now,
      }

      this.flags.set(storageKey, archived)

      // Record in history
      const version: FlagVersion = {
        key,
        version: archived.version,
        name: archived.name,
        enabled: archived.enabled,
        description: archived.description,
        owner: archived.owner,
        expiry: archived.expiry,
        environment: archived.environment,
        tags: archived.tags,
        changeType: 'archive',
        changedBy,
        changedAt: now,
      }

      const historyList = this.history.get(storageKey) ?? []
      historyList.push(version)
      this.history.set(storageKey, historyList)
    } finally {
      release()
    }
  }

  async archiveMany(keys: string[], environment?: Environment, actor?: string): Promise<void> {
    for (const key of keys) {
      await this.archive(key, environment, actor)
    }
  }

  async restore(key: string, environment?: Environment, actor?: string): Promise<void> {
    const env = environment ?? this.defaultEnvironment
    const storageKey = makeStorageKey(key, env)
    const changedBy = actor ?? this.defaultActor

    const release = await this.acquireLock(storageKey)

    try {
      const existing = this.flags.get(storageKey)
      if (!existing) {
        throw new Error(`Flag '${key}' not found in environment '${env}'`)
      }

      const now = new Date()
      const restored: Flag = {
        ...existing,
        archived: false,
        archivedAt: null,
        version: existing.version + 1,
        updatedAt: now,
      }

      this.flags.set(storageKey, restored)

      // Record in history
      const version: FlagVersion = {
        key,
        version: restored.version,
        name: restored.name,
        enabled: restored.enabled,
        description: restored.description,
        owner: restored.owner,
        expiry: restored.expiry,
        environment: restored.environment,
        tags: restored.tags,
        changeType: 'restore',
        changedBy,
        changedAt: now,
      }

      const historyList = this.history.get(storageKey) ?? []
      historyList.push(version)
      this.history.set(storageKey, historyList)
    } finally {
      release()
    }
  }

  async getHistory(key: string, environment?: Environment): Promise<FlagVersion[]> {
    const env = environment ?? this.defaultEnvironment
    const storageKey = makeStorageKey(key, env)
    const historyList = this.history.get(storageKey)
    return historyList ? historyList.map(v => ({ ...v })) : []
  }

  async promote(
    key: string,
    sourceEnv: Environment,
    targetEnv: Environment,
    actor?: string
  ): Promise<Flag> {
    const sourceKey = makeStorageKey(key, sourceEnv)
    const source = this.flags.get(sourceKey)

    if (!source) {
      throw new Error(`Flag '${key}' not found in environment '${sourceEnv}'`)
    }

    // Create in target environment if it doesn't exist, otherwise update
    const targetKey = makeStorageKey(key, targetEnv)
    const existing = this.flags.get(targetKey)

    if (existing) {
      return this.update(
        key,
        {
          name: source.name,
          enabled: source.enabled,
          description: source.description,
          owner: source.owner,
          expiry: source.expiry,
          tags: source.tags,
        },
        targetEnv,
        actor,
        `Promoted from ${sourceEnv}`
      )
    } else {
      return this.create(
        {
          key: source.key,
          name: source.name,
          enabled: source.enabled,
          description: source.description,
          owner: source.owner,
          expiry: source.expiry,
          environment: targetEnv,
          tags: source.tags,
        },
        actor
      )
    }
  }

  async clone(
    key: string,
    sourceEnv: Environment,
    targetEnv: Environment,
    actor?: string
  ): Promise<Flag> {
    const sourceKey = makeStorageKey(key, sourceEnv)
    const source = this.flags.get(sourceKey)

    if (!source) {
      throw new Error(`Flag '${key}' not found in environment '${sourceEnv}'`)
    }

    return this.create(
      {
        key: source.key,
        name: source.name,
        enabled: source.enabled,
        description: source.description,
        owner: source.owner,
        expiry: source.expiry,
        environment: targetEnv,
        tags: source.tags,
      },
      actor
    )
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new FlagStore instance
 * @param options Store configuration options
 * @returns FlagStore instance
 */
export function createFlagStore(options: FlagStoreOptions = {}): FlagStore {
  return new InMemoryFlagStore(options)
}
