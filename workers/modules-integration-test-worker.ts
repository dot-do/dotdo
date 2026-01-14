/**
 * Modules Integration Test Worker
 *
 * Test worker that exports a minimal DO for testing DOStorage, DOWorkflow,
 * DOTransport, DOIntrospection, and SchemaMigration integration.
 *
 * Uses real SQLite storage via miniflare - NO MOCKS.
 *
 * @module workers/modules-integration-test-worker
 */

import { DO } from '../objects/core/DOBase'
import type { Env } from '../objects/core/DOBase'
import { sql } from 'drizzle-orm'
import { RpcTarget } from 'cloudflare:workers'
import {
  SchemaMigrationManager,
  type Migration,
  type MigrationResult,
  type MigrationHistoryEntry,
  type MigrationStorage,
} from '../objects/SchemaMigration'
import type {
  ThingsStore,
  RelationshipsStore,
  ThingEntity,
  RelationshipEntity,
} from '../db/stores'

// ============================================================================
// SCHEMA INITIALIZATION SQL
// ============================================================================

const SCHEMA_STATEMENTS = [
  // NOTE: Core tables (nouns, things, relationships, objects, actions, events) are created
  // by DOBase's migration system in db/drizzle/migrations.ts.
  // We only create test-specific tables here for SchemaMigration testing.

  // Schema migrations table (for SchemaMigrationManager integration)
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    entity_type TEXT NOT NULL,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (entity_type, id)
  )`,

  // Schema versions table
  `CREATE TABLE IF NOT EXISTS schema_versions (
    entity_type TEXT PRIMARY KEY,
    version INTEGER NOT NULL
  )`,
]

// ============================================================================
// RPC TARGET WRAPPERS
// ============================================================================

/**
 * RPC-enabled wrapper for SchemaMigrationManager.
 * Allows testing schema migrations through real DO RPC.
 */
class SchemaMigrationRpc extends RpcTarget {
  private manager: SchemaMigrationManager

  constructor(private storage: SQLiteMigrationStorage) {
    super()
    this.manager = new SchemaMigrationManager(storage)
  }

  /**
   * Get current version for an entity type
   */
  async getCurrentVersion(entityType: string): Promise<number> {
    return this.manager.getCurrentVersion(entityType)
  }

  /**
   * Register a migration (simplified - just stores migration info)
   */
  registerMigration(
    entityType: string,
    version: number,
    name: string,
    upType: 'add-field' | 'rename-field' | 'identity',
    fieldName?: string,
    defaultValue?: unknown
  ): void {
    // Create up/down functions based on type
    let up: (data: unknown) => unknown
    let down: (data: unknown) => unknown

    switch (upType) {
      case 'add-field':
        up = (data: unknown) => ({ ...(data as Record<string, unknown>), [fieldName!]: defaultValue })
        down = (data: unknown) => {
          const { [fieldName!]: _, ...rest } = data as Record<string, unknown>
          return rest
        }
        break
      case 'rename-field':
        up = (data: unknown) => data // Would need more info for real rename
        down = (data: unknown) => data
        break
      case 'identity':
      default:
        up = (data: unknown) => data
        down = (data: unknown) => data
    }

    this.manager.register(entityType, { version, name, up, down })
  }

  /**
   * Set target version for lazy migrations
   */
  setTargetVersion(entityType: string, version: number): void {
    this.manager.setTargetVersion(entityType, version)
  }

  /**
   * Migrate an entity
   */
  async migrateEntity(
    entityType: string,
    data: unknown,
    fromVersion?: number,
    toVersion?: number
  ): Promise<unknown> {
    return this.manager.migrateEntity(entityType, data, { fromVersion, toVersion })
  }

  /**
   * Migrate on read (lazy migration)
   */
  async migrateOnRead(
    entityType: string,
    data: unknown,
    dataVersion: number
  ): Promise<unknown> {
    return this.manager.migrateOnRead(entityType, data, dataVersion)
  }

  /**
   * Run batch migration
   */
  async migrateBatch(
    entityType: string,
    batchSize?: number,
    continueOnError?: boolean
  ): Promise<MigrationResult> {
    return this.manager.migrateBatch(entityType, { batchSize, continueOnError })
  }

  /**
   * Rollback to a version
   */
  async rollback(entityType: string, toVersion: number): Promise<MigrationResult> {
    return this.manager.rollback(entityType, toVersion)
  }

  /**
   * Get migration progress
   */
  getMigrationProgress(entityType: string): {
    completed: boolean
    totalCount: number
    processedCount: number
    targetVersion: number
  } | undefined {
    const progress = this.manager.getMigrationProgress(entityType)
    if (!progress) return undefined
    return {
      completed: progress.completed,
      totalCount: progress.totalCount,
      processedCount: progress.processedCount,
      targetVersion: progress.targetVersion,
    }
  }

  /**
   * Get migration history
   */
  getMigrationHistory(entityType: string): MigrationHistoryEntry[] {
    return this.manager.getMigrationHistory(entityType)
  }

  /**
   * Store test data (for testing migrations)
   */
  storeTestData(entityType: string, id: string, version: number, data: unknown): void {
    this.storage.set(entityType, id, version, data)
  }

  /**
   * Get stored test data
   */
  getTestData(entityType: string, id: string): { version: number; data: unknown } | undefined {
    return this.storage.get(entityType, id)
  }

  /**
   * List all test data for entity type
   */
  listTestData(entityType: string): Array<{ id: string; version: number; data: unknown }> {
    return this.storage.list(entityType)
  }

  /**
   * Set schema version directly
   */
  setSchemaVersion(entityType: string, version: number): void {
    this.storage.setVersion(entityType, version)
  }
}

/**
 * SQLite-backed storage for SchemaMigrationManager.
 * Uses real SQLite via DO storage.
 */
class SQLiteMigrationStorage implements MigrationStorage {
  data: Map<string, { version: number; data: unknown }> = new Map()
  versions: Map<string, number> = new Map()

  constructor(private sql: SqlStorage) {
    // Load existing data from SQLite
    this.loadFromSQLite()
  }

  private loadFromSQLite(): void {
    try {
      // Load schema versions
      const versions = this.sql.exec('SELECT entity_type, version FROM schema_versions').toArray()
      for (const row of versions) {
        this.versions.set(row.entity_type as string, row.version as number)
      }

      // Load migration data
      const data = this.sql.exec('SELECT entity_type, id, version, data FROM schema_migrations').toArray()
      for (const row of data) {
        const key = `${row.entity_type}:${row.id}`
        this.data.set(key, {
          version: row.version as number,
          data: JSON.parse(row.data as string),
        })
      }
    } catch {
      // Tables might not exist yet
    }
  }

  get(entityType: string, id: string): { version: number; data: unknown } | undefined {
    return this.data.get(`${entityType}:${id}`)
  }

  set(entityType: string, id: string, version: number, value: unknown): void {
    const key = `${entityType}:${id}`
    this.data.set(key, { version, data: value })

    // Persist to SQLite
    this.sql.exec(
      `INSERT OR REPLACE INTO schema_migrations (entity_type, id, version, data) VALUES (?, ?, ?, ?)`,
      entityType,
      id,
      version,
      JSON.stringify(value)
    )
  }

  getVersion(entityType: string): number {
    return this.versions.get(entityType) ?? 0
  }

  setVersion(entityType: string, version: number): void {
    this.versions.set(entityType, version)

    // Persist to SQLite
    this.sql.exec(
      `INSERT OR REPLACE INTO schema_versions (entity_type, version) VALUES (?, ?)`,
      entityType,
      version
    )
  }

  list(entityType: string): Array<{ id: string; version: number; data: unknown }> {
    const results: Array<{ id: string; version: number; data: unknown }> = []
    for (const [key, value] of this.data.entries()) {
      if (key.startsWith(`${entityType}:`)) {
        results.push({
          id: key.replace(`${entityType}:`, ''),
          ...value,
        })
      }
    }
    return results
  }
}

/**
 * RPC wrapper for ThingsStore
 */
class ThingsRpc extends RpcTarget {
  constructor(private store: ThingsStore) {
    super()
  }

  async create(data: Partial<ThingEntity> & { type?: string }): Promise<ThingEntity> {
    return this.store.create(data)
  }

  async get(id: string): Promise<ThingEntity | null> {
    return this.store.get(id)
  }

  async list(options?: { type?: string }): Promise<ThingEntity[]> {
    return this.store.list(options)
  }

  async update(id: string, data: Partial<ThingEntity>): Promise<ThingEntity> {
    return this.store.update(id, data)
  }

  async delete(id: string): Promise<ThingEntity> {
    return this.store.delete(id)
  }
}

/**
 * RPC wrapper for RelationshipsStore
 */
class RelsRpc extends RpcTarget {
  constructor(private store: RelationshipsStore) {
    super()
  }

  async create(data: {
    verb: string
    from: string
    to: string
    data?: Record<string, unknown>
  }): Promise<RelationshipEntity & { $id: string }> {
    const result = await this.store.create(data)
    return { ...result, $id: result.id }
  }

  async list(options?: { from?: string; to?: string; verb?: string }): Promise<Array<RelationshipEntity & { $id: string }>> {
    const results = await this.store.list(options)
    return results.map((r) => ({ ...r, $id: r.id }))
  }

  async delete(id: string): Promise<RelationshipEntity> {
    return this.store.delete(id)
  }
}

// ============================================================================
// TEST DURABLE OBJECT
// ============================================================================

/**
 * Modules Integration Test DO.
 * Provides RPC access to DOStorage, DOWorkflow, DOIntrospection, and SchemaMigration.
 */
export class ModulesTestDO extends DO<Env> {
  static readonly $type = 'ModulesTestDO'

  private schemaInitialized = false
  private _migrationStorage?: SQLiteMigrationStorage
  private _schemaMigrationRpc?: SchemaMigrationRpc
  private _thingsRpc?: ThingsRpc
  private _relsRpc?: RelsRpc

  // Private getters for parent stores
  private get parentThings(): ThingsStore {
    const parentThings = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Object.getPrototypeOf(this)),
      'things'
    )?.get?.call(this)
    return parentThings
  }

  private get parentRels(): RelationshipsStore {
    const parentRels = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Object.getPrototypeOf(this)),
      'rels'
    )?.get?.call(this)
    return parentRels
  }

  // ==========================================================================
  // RPC ACCESSORS
  // ==========================================================================

  /**
   * Get SchemaMigration RPC wrapper
   */
  get schemaMigration(): SchemaMigrationRpc {
    if (!this._schemaMigrationRpc) {
      if (!this._migrationStorage) {
        this._migrationStorage = new SQLiteMigrationStorage(this.ctx.storage.sql)
      }
      this._schemaMigrationRpc = new SchemaMigrationRpc(this._migrationStorage)
    }
    return this._schemaMigrationRpc
  }

  /**
   * Get Things RPC wrapper
   */
  get things(): ThingsRpc {
    if (!this._thingsRpc) {
      this._thingsRpc = new ThingsRpc(this.parentThings)
    }
    return this._thingsRpc
  }

  /**
   * Get Rels RPC wrapper
   */
  get rels(): RelsRpc {
    if (!this._relsRpc) {
      this._relsRpc = new RelsRpc(this.parentRels)
    }
    return this._relsRpc
  }

  // ==========================================================================
  // FLAT RPC METHODS (for things store)
  // ==========================================================================

  async thingsCreate(data: Partial<ThingEntity> & { type?: string }): Promise<ThingEntity> {
    return this.parentThings.create(data)
  }

  async thingsGet(id: string): Promise<ThingEntity | null> {
    return this.parentThings.get(id)
  }

  async thingsList(options?: { type?: string }): Promise<ThingEntity[]> {
    return this.parentThings.list(options)
  }

  async thingsUpdate(id: string, data: Partial<ThingEntity>): Promise<ThingEntity> {
    return this.parentThings.update(id, data)
  }

  async thingsDelete(id: string): Promise<ThingEntity | null> {
    try {
      return await this.parentThings.delete(id)
    } catch {
      return null
    }
  }

  // ==========================================================================
  // FLAT RPC METHODS (for relationships store)
  // ==========================================================================

  async relsCreate(data: {
    verb: string
    from: string
    to: string
    data?: Record<string, unknown>
  }): Promise<RelationshipEntity & { $id: string }> {
    const result = await this.parentRels.create(data)
    return { ...result, $id: result.id }
  }

  async relsList(options?: { from?: string; to?: string; verb?: string }): Promise<Array<RelationshipEntity & { $id: string }>> {
    const results = await this.parentRels.list(options)
    return results.map((r) => ({ ...r, $id: r.id }))
  }

  async relsDelete(id: string): Promise<void> {
    await this.parentRels.delete(id)
  }

  // ==========================================================================
  // SQL ACCESS
  // ==========================================================================

  /**
   * Execute raw SQL
   */
  async sqlExecute(
    query: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[]; changes?: number }> {
    const storage = this.ctx.storage
    const cursor = params && params.length > 0
      ? storage.sql.exec(query, ...params)
      : storage.sql.exec(query)

    const rows = cursor.toArray() as Record<string, unknown>[]
    const changes = (cursor as { rowsWritten?: number }).rowsWritten

    return { rows, changes }
  }

  // ==========================================================================
  // IDENTITY
  // ==========================================================================

  get $id(): string {
    return `https://${this.ns}`
  }

  getNs(): string {
    return this.ns
  }

  // ==========================================================================
  // INTROSPECTION
  // ==========================================================================

  /**
   * Get DO introspection schema
   */
  async introspect(role?: string): Promise<{
    ns: string
    stores: string[]
    nouns: string[]
  }> {
    const introspectedRole = role ?? 'user'
    return {
      ns: this.ns,
      stores: ['things', 'relationships', 'events', 'actions'],
      nouns: this.getRegisteredNouns().map(n => n.noun),
    }
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  protected override getRegisteredNouns(): Array<{ noun: string; plural: string }> {
    return [
      { noun: 'User', plural: 'users' },
      { noun: 'Order', plural: 'orders' },
      { noun: 'Customer', plural: 'customers' },
      { noun: 'Product', plural: 'products' },
      { noun: 'Task', plural: 'tasks' },
      { noun: 'Note', plural: 'notes' },
      { noun: 'Widget', plural: 'widgets' },
    ]
  }

  private async initSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('already exists')) {
            console.error('[ModulesTestDO] Schema statement failed:', err)
          }
        }
      }

      this.schemaInitialized = true
    } catch (error) {
      console.error('[ModulesTestDO] Schema init error:', error)
      this.schemaInitialized = true
    }
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
      const storedNs = await ctx.storage.get<string>('ns')
      if (storedNs) {
        this._ns = storedNs
      } else {
        this._ns = ctx.id.toString()
      }
    })
  }

  override async fetch(request: Request): Promise<Response> {
    const headerNs = request.headers.get('X-DO-NS')
    if (headerNs) {
      this._ns = headerNs
      await this.ctx.storage.put('ns', headerNs)
    } else if (!this.ns) {
      const storedNs = await this.ctx.storage.get<string>('ns')
      if (storedNs) {
        this._ns = storedNs
      } else {
        this._ns = this.ctx.id.toString()
      }
    }

    return super.fetch(request)
  }
}

// ============================================================================
// WORKER ENTRY POINT
// ============================================================================

export interface TestEnv extends Env {
  TEST_DO: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    const ns = request.headers.get('X-DO-NS') || 'test'
    const id = env.TEST_DO.idFromName(ns)
    const stub = env.TEST_DO.get(id)
    return stub.fetch(request)
  },
}
