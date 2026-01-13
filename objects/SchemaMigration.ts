/**
 * SchemaMigration - Entity-level schema migration for DO storage
 *
 * Provides safe schema evolution with:
 * - Schema version tracking per entity type
 * - Migration registry with up/down functions
 * - Forward/backward migrations
 * - Lazy migration on read
 * - Batch migrations with progress tracking
 * - Concurrent access safety with locking
 * - Data validation
 * - Partial migration recovery
 * - Migration history/audit trail
 *
 * @module objects/SchemaMigration
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Migration definition with up/down transform functions
 */
export interface Migration {
  /** Migration version (monotonically increasing) */
  version: number
  /** Human-readable migration name */
  name: string
  /** Forward migration function (upgrade) */
  up: (data: unknown) => unknown | Promise<unknown>
  /** Backward migration function (rollback) - optional for irreversible migrations */
  down?: (data: unknown) => unknown | Promise<unknown>
  /** Optional validation function for migrated data */
  validate?: (data: unknown) => boolean
}

/**
 * Result of a batch migration operation
 */
export interface MigrationResult {
  /** Whether the migration completed successfully */
  success: boolean
  /** Number of entities successfully migrated */
  migratedCount: number
  /** Number of entities that failed migration */
  failedCount: number
  /** Errors encountered during migration */
  errors: Array<{ id: string; error: string }>
}

/**
 * Entry in the migration history
 */
export interface MigrationHistoryEntry {
  /** Migration version */
  version: number
  /** Migration name */
  name: string
  /** Unix timestamp when migration was applied */
  timestamp: number
  /** Direction: 'up' (upgrade) or 'down' (rollback) */
  direction: 'up' | 'down'
  /** Number of entities affected */
  entitiesAffected: number
  /** Duration in milliseconds */
  durationMs: number
}

/**
 * Options for entity migration
 */
export interface EntityMigrationOptions {
  /** Starting version of the data */
  fromVersion?: number
  /** Target version to migrate to */
  toVersion?: number
}

/**
 * Options for batch migration
 */
export interface BatchMigrationOptions {
  /** Number of entities to process per batch */
  batchSize?: number
  /** Continue migrating remaining entities if one fails */
  continueOnError?: boolean
}

/**
 * Migration progress tracking
 */
export interface MigrationProgress {
  /** Whether migration is complete */
  completed: boolean
  /** Total number of entities to process */
  totalCount: number
  /** Number of entities processed */
  processedCount: number
  /** Last successfully processed entity ID */
  lastProcessedId?: string
  /** Version being migrated to */
  targetVersion: number
}

/**
 * Storage interface for migration operations
 */
export interface MigrationStorage {
  data: Map<string, { version: number; data: unknown }>
  versions: Map<string, number>
  get(entityType: string, id: string): { version: number; data: unknown } | undefined
  set(entityType: string, id: string, version: number, value: unknown): void
  getVersion(entityType: string): number
  setVersion(entityType: string, version: number): void
  list(entityType: string): Array<{ id: string; version: number; data: unknown }>
}

// ============================================================================
// SCHEMA MIGRATION MANAGER
// ============================================================================

/**
 * Manages schema migrations for entity types in DO storage
 */
export class SchemaMigrationManager {
  /** Registered migrations per entity type */
  private migrations = new Map<string, Map<number, Migration>>()

  /** Target version per entity type for lazy migrations */
  private targetVersions = new Map<string, number>()

  /** Migration history per entity type */
  private history = new Map<string, MigrationHistoryEntry[]>()

  /** Migration progress tracking */
  private progress = new Map<string, MigrationProgress>()

  /** Locks for concurrent migration safety */
  private locks = new Map<string, boolean>()

  /** Storage backend */
  private storage: MigrationStorage

  constructor(storage: MigrationStorage) {
    this.storage = storage
  }

  // ==========================================================================
  // REGISTRATION
  // ==========================================================================

  /**
   * Register a migration for an entity type
   */
  register(entityType: string, migration: Migration): void {
    if (!this.migrations.has(entityType)) {
      this.migrations.set(entityType, new Map())
    }

    const entityMigrations = this.migrations.get(entityType)!

    if (entityMigrations.has(migration.version)) {
      throw new Error(
        `Migration version ${migration.version} is already registered for entity type '${entityType}'`
      )
    }

    entityMigrations.set(migration.version, migration)
  }

  /**
   * Get a specific migration for an entity type
   */
  getMigration(entityType: string, version: number): Migration | undefined {
    return this.migrations.get(entityType)?.get(version)
  }

  /**
   * Get all migrations for an entity type, sorted by version
   */
  getMigrations(entityType: string): Migration[] {
    const entityMigrations = this.migrations.get(entityType)
    if (!entityMigrations) return []

    return Array.from(entityMigrations.values()).sort((a, b) => a.version - b.version)
  }

  // ==========================================================================
  // VERSION MANAGEMENT
  // ==========================================================================

  /**
   * Get current schema version for an entity type
   */
  async getCurrentVersion(entityType: string): Promise<number> {
    return this.storage.getVersion(entityType)
  }

  /**
   * Set target version for lazy migrations
   */
  setTargetVersion(entityType: string, version: number): void {
    this.targetVersions.set(entityType, version)
  }

  /**
   * Get target version for lazy migrations
   */
  getTargetVersion(entityType: string): number | undefined {
    return this.targetVersions.get(entityType)
  }

  // ==========================================================================
  // ENTITY MIGRATION
  // ==========================================================================

  /**
   * Migrate a single entity's data through version transformations
   */
  async migrateEntity<T>(
    entityType: string,
    data: unknown,
    options?: EntityMigrationOptions
  ): Promise<T> {
    const currentVersion = options?.fromVersion ?? this.storage.getVersion(entityType)
    const targetVersion = options?.toVersion ?? this.getHighestVersion(entityType)

    if (currentVersion === targetVersion) {
      return data as T
    }

    let result = data
    const migrations = this.getMigrations(entityType)

    if (targetVersion > currentVersion) {
      // Forward migration (upgrade)
      for (const migration of migrations) {
        if (migration.version > currentVersion && migration.version <= targetVersion) {
          result = await migration.up(result)

          // Validate if validator provided
          if (migration.validate && !migration.validate(result)) {
            throw new Error(
              `Validation failed for migration '${migration.name}' (v${migration.version})`
            )
          }
        }
      }
    } else {
      // Backward migration (rollback)
      const reverseMigrations = [...migrations].reverse()
      for (const migration of reverseMigrations) {
        if (migration.version <= currentVersion && migration.version > targetVersion) {
          if (!migration.down) {
            throw new Error(
              `Cannot rollback migration '${migration.name}' (v${migration.version}) - no down function defined`
            )
          }
          result = await migration.down(result)
        }
      }
    }

    return result as T
  }

  /**
   * Migrate entity data lazily on read
   */
  async migrateOnRead<T>(
    entityType: string,
    data: unknown,
    dataVersion: number
  ): Promise<T> {
    const targetVersion = this.targetVersions.get(entityType)

    if (targetVersion === undefined || dataVersion >= targetVersion) {
      return data as T
    }

    return this.migrateEntity<T>(entityType, data, {
      fromVersion: dataVersion,
      toVersion: targetVersion,
    })
  }

  // ==========================================================================
  // BATCH MIGRATION
  // ==========================================================================

  /**
   * Migrate all entities of a type in batch
   */
  async migrateBatch(
    entityType: string,
    options?: BatchMigrationOptions
  ): Promise<MigrationResult> {
    const batchSize = options?.batchSize ?? 100
    const continueOnError = options?.continueOnError ?? false

    // Check if already locked
    if (this.locks.get(entityType)) {
      return {
        success: true,
        migratedCount: 0,
        failedCount: 0,
        errors: [],
      }
    }

    // Acquire lock
    this.locks.set(entityType, true)

    const startTime = Date.now()
    const result: MigrationResult = {
      success: true,
      migratedCount: 0,
      failedCount: 0,
      errors: [],
    }

    try {
      const currentVersion = this.storage.getVersion(entityType)
      const targetVersion = this.getHighestVersion(entityType)

      if (currentVersion >= targetVersion) {
        return result
      }

      const entities = this.storage.list(entityType)
      const totalCount = entities.length

      // Initialize progress
      this.progress.set(entityType, {
        completed: false,
        totalCount,
        processedCount: 0,
        targetVersion,
      })

      // Process in batches
      for (let i = 0; i < entities.length; i += batchSize) {
        const batch = entities.slice(i, i + batchSize)

        for (const entity of batch) {
          try {
            const migrated = await this.migrateEntity(entityType, entity.data, {
              fromVersion: entity.version,
              toVersion: targetVersion,
            })

            // Update storage with migrated data
            this.storage.set(entityType, entity.id, targetVersion, migrated)
            result.migratedCount++

            // Update progress
            const progress = this.progress.get(entityType)!
            progress.processedCount++
            progress.lastProcessedId = entity.id
          } catch (error) {
            result.failedCount++
            result.errors.push({
              id: entity.id,
              error: error instanceof Error ? error.message : String(error),
            })

            if (!continueOnError) {
              result.success = false
              break
            }
          }
        }

        if (!continueOnError && result.errors.length > 0) {
          break
        }
      }

      // Update schema version if successful
      if (result.failedCount === 0 || continueOnError) {
        this.storage.setVersion(entityType, targetVersion)

        // Record history
        this.recordHistory(entityType, {
          version: targetVersion,
          name: this.getMigration(entityType, targetVersion)?.name ?? `v${targetVersion}`,
          timestamp: Date.now(),
          direction: 'up',
          entitiesAffected: result.migratedCount,
          durationMs: Date.now() - startTime,
        })
      }

      // Mark progress complete
      const progress = this.progress.get(entityType)
      if (progress) {
        progress.completed = true
      }
    } finally {
      // Release lock
      this.locks.set(entityType, false)
    }

    return result
  }

  /**
   * Resume a previously interrupted migration
   */
  async resumeMigration(entityType: string): Promise<MigrationResult> {
    const progress = this.progress.get(entityType)

    if (!progress || progress.completed) {
      return {
        success: true,
        migratedCount: 0,
        failedCount: 0,
        errors: [],
      }
    }

    const entities = this.storage.list(entityType)
    const startIndex = progress.lastProcessedId
      ? entities.findIndex(e => e.id === progress.lastProcessedId) + 1
      : 0

    const remainingEntities = entities.slice(startIndex)

    // Temporarily replace list to only process remaining
    const originalList = this.storage.list.bind(this.storage)
    this.storage.list = () => remainingEntities

    const result = await this.migrateBatch(entityType)

    // Restore original list function
    this.storage.list = originalList

    return result
  }

  // ==========================================================================
  // ROLLBACK
  // ==========================================================================

  /**
   * Rollback to a specific version
   */
  async rollback(entityType: string, toVersion: number): Promise<MigrationResult> {
    const currentVersion = this.storage.getVersion(entityType)
    const startTime = Date.now()

    if (currentVersion <= toVersion) {
      return {
        success: true,
        migratedCount: 0,
        failedCount: 0,
        errors: [],
      }
    }

    const result: MigrationResult = {
      success: true,
      migratedCount: 0,
      failedCount: 0,
      errors: [],
    }

    // Check if all migrations between current and target have down functions
    const migrations = this.getMigrations(entityType)
    for (const migration of migrations) {
      if (migration.version > toVersion && migration.version <= currentVersion) {
        if (!migration.down) {
          result.success = false
          result.errors.push({
            id: '',
            error: `Migration '${migration.name}' (v${migration.version}) is irreversible - cannot rollback`,
          })
          return result
        }
      }
    }

    // Perform rollback on all entities
    const entities = this.storage.list(entityType)

    for (const entity of entities) {
      try {
        const rolledBack = await this.migrateEntity(entityType, entity.data, {
          fromVersion: currentVersion,
          toVersion,
        })

        this.storage.set(entityType, entity.id, toVersion, rolledBack)
        result.migratedCount++
      } catch (error) {
        result.failedCount++
        result.errors.push({
          id: entity.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (result.failedCount === 0) {
      this.storage.setVersion(entityType, toVersion)

      // Record rollback in history
      this.recordHistory(entityType, {
        version: currentVersion,
        name: this.getMigration(entityType, currentVersion)?.name ?? `v${currentVersion}`,
        timestamp: Date.now(),
        direction: 'down',
        entitiesAffected: result.migratedCount,
        durationMs: Date.now() - startTime,
      })
    }

    return result
  }

  // ==========================================================================
  // PROGRESS & HISTORY
  // ==========================================================================

  /**
   * Get migration progress for an entity type
   */
  getMigrationProgress(entityType: string): MigrationProgress | undefined {
    return this.progress.get(entityType)
  }

  /**
   * Get migration history for an entity type
   */
  getMigrationHistory(entityType: string): MigrationHistoryEntry[] {
    return this.history.get(entityType) ?? []
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Get the highest registered migration version
   */
  private getHighestVersion(entityType: string): number {
    const migrations = this.getMigrations(entityType)
    if (migrations.length === 0) return 0
    return Math.max(...migrations.map(m => m.version))
  }

  /**
   * Record a migration in the history
   */
  private recordHistory(entityType: string, entry: MigrationHistoryEntry): void {
    if (!this.history.has(entityType)) {
      this.history.set(entityType, [])
    }
    this.history.get(entityType)!.push(entry)
  }
}
