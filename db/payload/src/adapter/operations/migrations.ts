/**
 * Payload Adapter Migration Operations
 *
 * Provides migration management for the Payload database adapter, including:
 * - Running pending migrations (migrate)
 * - Checking migration status (migrateStatus)
 * - Rolling back migrations (migrateDown)
 * - Refreshing migrations (migrateRefresh)
 * - Fresh migrations (migrateFresh)
 * - Creating new migrations (migrateCreate)
 *
 * @module @dotdo/payload/adapter/operations/migrations
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Migration definition
 */
export interface Migration {
  name: string
  timestamp: number
  batch?: number
  up: () => Promise<void>
  down?: () => Promise<void>
  getSql?: () => string
}

/**
 * Migration history record
 */
export interface MigrationRecord {
  name: string
  batch: number
  ranAt: Date
}

/**
 * Migration status for a single migration
 */
export interface MigrationStatusEntry {
  name: string
  status: 'ran' | 'pending'
  batch?: number
  ranAt?: Date
}

/**
 * Result of migrate operation
 */
export interface MigrateResult {
  ran: Array<{ name: string }>
  skipped: Array<{ name: string }>
  pending: Array<{ name: string }>
  errors?: Array<{ name: string; error: Error }>
  wouldRun?: Array<{ name: string; sql?: string }>
}

/**
 * Result of migrateStatus operation
 */
export interface MigrateStatusResult {
  total: number
  ran: number
  pending: number
  migrations: MigrationStatusEntry[]
}

/**
 * Result of migrateDown operation
 */
export interface MigrateDownResult {
  rolledBack: Array<{ name: string }>
}

/**
 * Result of migrateRefresh operation
 */
export interface MigrateRefreshResult {
  rolledBack: Array<{ name: string }>
  ran: Array<{ name: string }>
}

/**
 * Result of migrateFresh operation
 */
export interface MigrateFreshResult {
  dropped: boolean
  ran: Array<{ name: string }>
}

/**
 * Result of migrateCreate operation
 */
export interface MigrateCreateResult {
  name: string
  path: string
  template: string
}

/**
 * Migration file info for discovery
 */
export interface MigrationFileInfo {
  name: string
  path: string
}

/**
 * Options for migrate operation
 */
export interface MigrateOptions {
  only?: string
  transaction?: boolean
  dryRun?: boolean
  showSql?: boolean
  force?: boolean
  lockTimeout?: number
}

/**
 * Options for migrateDown operation
 */
export interface MigrateDownOptions {
  steps?: number
  migration?: string
}

/**
 * Options for migrateFresh operation
 */
export interface MigrateFreshOptions {
  seed?: boolean
}

/**
 * Options for migrateCreate operation
 */
export interface MigrateCreateOptions {
  name: string
  blank?: boolean
}

/**
 * Schema init hooks
 */
export interface SchemaInitHooks {
  beforeSchemaInit?: (args: { schema: any; extendTable?: (name: string, columns: Record<string, string>) => void }) => Promise<any>
  afterSchemaInit?: (args: { schema: any; addColumn?: (table: string, column: string, type: string) => void }) => Promise<any>
  beforeFresh?: () => Promise<void>
}

/**
 * Push options for development mode
 */
export interface PushOptions {
  collections?: Array<{
    slug: string
    fields: Array<{ type: string; name: string; required?: boolean }>
  }>
}

/**
 * Push result
 */
export interface PushResult {
  pushed: boolean
  changes: string[]
}

// ============================================================================
// MIGRATION STORE
// ============================================================================

/**
 * In-memory migration store for tracking registered migrations and history
 */
export interface MigrationStore {
  migrations: Map<string, Migration>
  history: MigrationRecord[]
  currentBatch: number
  migrationDir: string
  migrationFiles: MigrationFileInfo[]
  lockHeld: boolean
  mode: 'development' | 'production'
  seedFunction?: () => Promise<void>
  hooks?: SchemaInitHooks
  eventListeners: Map<string, Array<(...args: any[]) => void>>
  inTransaction: boolean
  schema: any
  customColumns: Array<{ table: string; column: string; type: string }>
  customTables: Array<{ name: string; columns: Record<string, string> }>
}

/**
 * Create a new migration store
 */
export function createMigrationStore(): MigrationStore {
  return {
    migrations: new Map(),
    history: [],
    currentBatch: 0,
    migrationDir: './src/migrations',
    migrationFiles: [],
    lockHeld: false,
    mode: 'development',
    eventListeners: new Map(),
    inTransaction: false,
    schema: {},
    customColumns: [],
    customTables: [],
  }
}

// ============================================================================
// MIGRATION OPERATIONS
// ============================================================================

/**
 * Register migrations with the adapter
 */
export function registerMigrations(
  store: MigrationStore,
  migrations: Migration[]
): void {
  for (const migration of migrations) {
    if (store.migrations.has(migration.name)) {
      throw new Error(`Migration '${migration.name}' is already registered (duplicate migration name)`)
    }
    store.migrations.set(migration.name, migration)
  }
}

/**
 * Get migrations sorted by timestamp
 */
function getSortedMigrations(store: MigrationStore): Migration[] {
  return Array.from(store.migrations.values()).sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Check if a migration has been run
 */
function isMigrationRun(store: MigrationStore, name: string): boolean {
  return store.history.some((h) => h.name === name)
}

/**
 * Emit an event
 */
function emit(store: MigrationStore, event: string, ...args: any[]): void {
  const listeners = store.eventListeners.get(event) || []
  for (const listener of listeners) {
    listener(...args)
  }
}

/**
 * Acquire migration lock
 */
function acquireLock(store: MigrationStore, options?: { lockTimeout?: number }): void {
  if (store.lockHeld) {
    if (options?.lockTimeout !== undefined) {
      throw new Error('Lock acquisition timeout')
    }
    throw new Error('Migrations are already running (lock held)')
  }
  store.lockHeld = true
  emit(store, 'lockAcquired')
}

/**
 * Release migration lock
 */
function releaseLock(store: MigrationStore): void {
  store.lockHeld = false
  emit(store, 'lockReleased')
}

/**
 * Run pending migrations
 */
export async function migrate(
  store: MigrationStore,
  options?: MigrateOptions
): Promise<MigrateResult> {
  const result: MigrateResult = {
    ran: [],
    skipped: [],
    pending: [],
  }

  // Acquire lock
  acquireLock(store, { lockTimeout: options?.lockTimeout })

  try {
    const sortedMigrations = getSortedMigrations(store)
    const pendingMigrations: Migration[] = []

    // Determine which migrations to run
    for (const migration of sortedMigrations) {
      if (isMigrationRun(store, migration.name)) {
        result.skipped.push({ name: migration.name })
      } else {
        pendingMigrations.push(migration)
      }
    }

    // Handle --only option
    const migrationsToRun = options?.only
      ? pendingMigrations.filter((m) => m.name === options.only)
      : pendingMigrations

    // Handle dry run
    if (options?.dryRun) {
      result.wouldRun = migrationsToRun.map((m) => ({
        name: m.name,
        sql: options.showSql && m.getSql ? m.getSql() : undefined,
      }))
      releaseLock(store)
      return result
    }

    // Increment batch number for this run
    const batch = store.currentBatch + 1
    store.currentBatch = batch

    // Start transaction
    store.inTransaction = true

    // Run migrations
    const errors: Array<{ name: string; error: Error }> = []

    for (const migration of migrationsToRun) {
      try {
        await migration.up()

        // Record in history
        store.history.push({
          name: migration.name,
          batch,
          ranAt: new Date(),
        })

        result.ran.push({ name: migration.name })
        emit(store, 'transactionCommit')
      } catch (err) {
        const error = err as Error

        if (options?.force) {
          // Continue on error with force flag
          errors.push({ name: migration.name, error })
        } else {
          // Roll back all migrations in this batch on failure
          store.history = store.history.filter((h) => h.batch !== batch)
          store.inTransaction = false

          // Create enhanced error with migration context
          const enhancedError = new Error(error.message) as Error & {
            migration: string
            sql?: string
            code?: string
          }
          enhancedError.migration = migration.name
          if ((error as any).sql) enhancedError.sql = (error as any).sql
          if ((error as any).code) enhancedError.code = (error as any).code

          releaseLock(store)
          throw enhancedError
        }
      }
    }

    if (errors.length > 0) {
      result.errors = errors
    }

    // Calculate remaining pending
    result.pending = sortedMigrations
      .filter((m) => !isMigrationRun(store, m.name) && !result.ran.some((r) => r.name === m.name))
      .map((m) => ({ name: m.name }))

    store.inTransaction = false
  } finally {
    releaseLock(store)
  }

  return result
}

/**
 * Get migration status
 */
export async function migrateStatus(store: MigrationStore): Promise<MigrateStatusResult> {
  const sortedMigrations = getSortedMigrations(store)
  const migrations: MigrationStatusEntry[] = []

  let ran = 0
  let pending = 0

  for (const migration of sortedMigrations) {
    const record = store.history.find((h) => h.name === migration.name)
    if (record) {
      migrations.push({
        name: migration.name,
        status: 'ran',
        batch: record.batch,
        ranAt: record.ranAt,
      })
      ran++
    } else {
      migrations.push({
        name: migration.name,
        status: 'pending',
      })
      pending++
    }
  }

  return {
    total: sortedMigrations.length,
    ran,
    pending,
    migrations,
  }
}

/**
 * Get migration history
 */
export function getMigrationHistory(store: MigrationStore): MigrationRecord[] {
  return [...store.history]
}

/**
 * Roll back migrations
 */
export async function migrateDown(
  store: MigrationStore,
  options?: MigrateDownOptions
): Promise<MigrateDownResult> {
  const result: MigrateDownResult = {
    rolledBack: [],
  }

  // Handle rolling back specific migration
  if (options?.migration) {
    const record = store.history.find((h) => h.name === options.migration)
    if (!record) {
      throw new Error(`Migration '${options.migration}' not found or does not exist`)
    }
    const migration = store.migrations.get(options.migration)
    if (!migration?.down) {
      throw new Error(`Migration '${options.migration}' has no down function and cannot be rolled back`)
    }
    await migration.down()
    store.history = store.history.filter((h) => h.name !== options.migration)
    result.rolledBack.push({ name: options.migration })
    return result
  }

  if (store.history.length === 0) {
    return result
  }

  // Determine migrations to roll back
  let migrationsToRollback: MigrationRecord[]

  // Helper to get migration timestamp
  const getMigrationTimestamp = (name: string): number => {
    const migration = store.migrations.get(name)
    return migration?.timestamp ?? 0
  }

  if (options?.steps !== undefined) {
    // Roll back N steps (most recent first by migration timestamp)
    migrationsToRollback = [...store.history]
      .sort((a, b) => {
        // Sort by migration timestamp descending (most recent first)
        const aTimestamp = getMigrationTimestamp(a.name)
        const bTimestamp = getMigrationTimestamp(b.name)
        return bTimestamp - aTimestamp
      })
      .slice(0, options.steps)
  } else {
    // Roll back last batch (in reverse migration timestamp order)
    const lastBatch = Math.max(...store.history.map((h) => h.batch))
    migrationsToRollback = store.history
      .filter((h) => h.batch === lastBatch)
      .sort((a, b) => {
        const aTimestamp = getMigrationTimestamp(a.name)
        const bTimestamp = getMigrationTimestamp(b.name)
        return bTimestamp - aTimestamp
      })
  }

  // Roll back in reverse order (already sorted by timestamp desc)
  for (const record of migrationsToRollback) {
    const migration = store.migrations.get(record.name)
    if (!migration) {
      throw new Error(`Migration '${record.name}' not found`)
    }
    if (!migration.down) {
      throw new Error(`Migration '${record.name}' has no down function and cannot be rolled back`)
    }
    await migration.down()
    store.history = store.history.filter((h) => h.name !== record.name)
    result.rolledBack.push({ name: record.name })
  }

  return result
}

/**
 * Refresh migrations (roll back all and re-run)
 */
export async function migrateRefresh(store: MigrationStore): Promise<MigrateRefreshResult> {
  const result: MigrateRefreshResult = {
    rolledBack: [],
    ran: [],
  }

  // Helper to get migration timestamp
  const getMigrationTimestamp = (name: string): number => {
    const migration = store.migrations.get(name)
    return migration?.timestamp ?? 0
  }

  // Roll back all migrations in reverse order (by migration timestamp descending)
  const sortedHistory = [...store.history].sort((a, b) => {
    const aTimestamp = getMigrationTimestamp(a.name)
    const bTimestamp = getMigrationTimestamp(b.name)
    return bTimestamp - aTimestamp
  })

  for (const record of sortedHistory) {
    const migration = store.migrations.get(record.name)
    if (migration?.down) {
      await migration.down()
      result.rolledBack.push({ name: record.name })
    }
  }

  // Clear history
  store.history = []
  store.currentBatch = 0

  // Re-run all migrations
  const migrateResult = await migrate(store)
  result.ran = migrateResult.ran

  return result
}

/**
 * Fresh migrations (drop all and re-run)
 * @param store Migration store
 * @param options Options including seed
 * @param clearData Function to clear all data
 */
export async function migrateFresh(
  store: MigrationStore,
  options?: MigrateFreshOptions,
  clearData?: () => void
): Promise<MigrateFreshResult> {
  // Call beforeFresh hook
  if (store.hooks?.beforeFresh) {
    await store.hooks.beforeFresh()
  }

  // Clear all data
  if (clearData) {
    clearData()
  }

  // Clear history and reset batch
  store.history = []
  store.currentBatch = 0

  // Run all migrations
  const migrateResult = await migrate(store)

  // Run seed if requested
  if (options?.seed && store.seedFunction) {
    await store.seedFunction()
  }

  return {
    dropped: true,
    ran: migrateResult.ran,
  }
}

/**
 * Create a new migration file
 */
export async function migrateCreate(
  store: MigrationStore,
  options: MigrateCreateOptions
): Promise<MigrateCreateResult> {
  // Sanitize name: lowercase, replace spaces with underscores, remove special chars
  const sanitizedName = options.name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')

  // Generate timestamp in YYYYMMDD_HHMMSS format
  const now = new Date()
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')

  const name = `${timestamp}_${sanitizedName}`
  const path = `${store.migrationDir}/${name}.ts`

  // Generate template
  const template = options.blank
    ? generateBlankTemplate(name)
    : generateMigrationTemplate(name)

  return {
    name,
    path,
    template,
  }
}

/**
 * Generate migration template with SQL helpers
 */
function generateMigrationTemplate(name: string): string {
  return `import type { Migration } from '@dotdo/payload'

export const ${name}: Migration = {
  name: '${name}',
  timestamp: ${Date.now()},

  async up() {
    // Add your migration logic here
    // Example: await sql\`CREATE TABLE ...\`
  },

  async down() {
    // Add rollback logic here
    // Example: await sql\`DROP TABLE ...\`
  },
}
`
}

/**
 * Generate blank migration template
 */
function generateBlankTemplate(name: string): string {
  return `import type { Migration } from '@dotdo/payload'

export const ${name}: Migration = {
  name: '${name}',
  timestamp: ${Date.now()},

  async up() {
    // Add your migration logic here
  },

  async down() {
    // Add rollback logic here
  },
}
`
}

// ============================================================================
// MIGRATION DIRECTORY
// ============================================================================

/**
 * Get the migration directory
 */
export function getMigrationDir(store: MigrationStore): string {
  return store.migrationDir
}

/**
 * Set the migration directory
 */
export function setMigrationDir(store: MigrationStore, dir: string): void {
  store.migrationDir = dir
}

/**
 * Get common migration search paths
 */
export function getMigrationSearchPaths(): string[] {
  return [
    './src/migrations',
    './dist/migrations',
    './migrations',
  ]
}

/**
 * Set mock migration files for testing
 */
export function setMigrationFiles(store: MigrationStore, files: MigrationFileInfo[]): void {
  store.migrationFiles = files
}

/**
 * Discover migrations from directory
 */
export async function discoverMigrations(store: MigrationStore): Promise<MigrationFileInfo[]> {
  return store.migrationFiles
}

// ============================================================================
// SCHEMA HOOKS
// ============================================================================

/**
 * Initialize schema with hooks
 */
export async function initSchema(store: MigrationStore): Promise<void> {
  const extendTable = (name: string, columns: Record<string, string>) => {
    store.customTables.push({ name, columns })
  }

  const addColumn = (table: string, column: string, type: string) => {
    store.customColumns.push({ table, column, type })
  }

  // Run beforeSchemaInit hook
  if (store.hooks?.beforeSchemaInit) {
    store.schema = await store.hooks.beforeSchemaInit({
      schema: store.schema,
      extendTable,
    })
  }

  // Run afterSchemaInit hook
  if (store.hooks?.afterSchemaInit) {
    store.schema = await store.hooks.afterSchemaInit({
      schema: store.schema,
      addColumn,
    })
  }
}

// ============================================================================
// TRANSACTION AND LOCKING
// ============================================================================

/**
 * Check if currently in a transaction
 */
export function isInTransaction(store: MigrationStore): boolean {
  return store.inTransaction
}

/**
 * Set lock held state (for testing)
 */
export function setLockHeld(store: MigrationStore, held: boolean): void {
  store.lockHeld = held
}

/**
 * Register event listener
 */
export function on(store: MigrationStore, event: string, listener: (...args: any[]) => void): void {
  if (!store.eventListeners.has(event)) {
    store.eventListeners.set(event, [])
  }
  store.eventListeners.get(event)!.push(listener)
}

// ============================================================================
// MODE AND SEED
// ============================================================================

/**
 * Set adapter mode
 */
export function setMode(store: MigrationStore, mode: 'development' | 'production'): void {
  store.mode = mode
}

/**
 * Set seed function
 */
export function setSeedFunction(store: MigrationStore, fn: () => Promise<void>): void {
  store.seedFunction = fn
}

/**
 * Push schema changes (development mode only)
 */
export async function push(
  store: MigrationStore,
  options: PushOptions
): Promise<PushResult> {
  if (store.mode === 'production') {
    throw new Error('Push is not allowed in production mode. Use migrations instead.')
  }

  // Check for warning about mixing push and migrations
  if (store.history.length > 0) {
    emit(store, 'warning', 'Mixing push with migrations is not recommended')
  }

  const changes: string[] = []

  // Simulate detecting schema changes
  for (const collection of options.collections || []) {
    for (const field of collection.fields) {
      if (!field.required) {
        changes.push(`added column: ${field.name}`)
      }
    }
  }

  return {
    pushed: true,
    changes,
  }
}
