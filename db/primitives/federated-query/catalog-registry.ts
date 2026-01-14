/**
 * Multi-Source Catalog Registry for Federated Queries
 *
 * Manages multiple data sources (DO, SQL, external APIs) for query federation.
 * Supports dynamic registration, schema discovery, capabilities tracking, and
 * hierarchical namespace resolution.
 *
 * @see dotdo-1v9my
 * @module db/primitives/federated-query/catalog-registry
 */

import type { SourceSchema, SourceStatistics, SourceAdapter, ColumnType, ColumnDef, TableDef, PushdownCapabilities } from './index'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Source type enumeration
 */
export type SourceType =
  | 'sqlite'
  | 'postgres'
  | 'mysql'
  | 'memory'
  | 'rest'
  | 'graphql'
  | 'durable-object'
  | 'kv'
  | 'd1'
  | 'r2'
  | 'custom'

/**
 * Connection configuration for different source types
 */
export interface ConnectionConfig {
  /** Connection URL or host */
  url?: string
  host?: string
  port?: number
  database?: string
  /** Authentication */
  username?: string
  password?: string
  apiKey?: string
  bearerToken?: string
  /** DO-specific */
  doNamespace?: string
  doId?: string
  /** TLS/SSL */
  ssl?: boolean
  sslCert?: string
  /** Connection pooling */
  poolSize?: number
  idleTimeout?: number
  /** Timeouts */
  connectTimeout?: number
  queryTimeout?: number
  /** Custom options */
  [key: string]: unknown
}

/**
 * Extended source capabilities with query features
 */
export interface SourceCapabilities extends PushdownCapabilities {
  /** SQL dialect support */
  supportsSQL?: boolean
  /** Transaction support */
  supportsTransactions?: boolean
  /** Full-text search */
  supportsFullTextSearch?: boolean
  /** Vector/embedding search */
  supportsVectorSearch?: boolean
  /** Streaming results */
  supportsStreaming?: boolean
  /** Real-time updates */
  supportsRealtime?: boolean
  /** Maximum concurrent queries */
  maxConcurrentQueries?: number
  /** Maximum result size */
  maxResultSize?: number
}

/**
 * Source health status
 */
export type SourceHealth = 'healthy' | 'degraded' | 'unhealthy' | 'unknown'

/**
 * Health check result
 */
export interface HealthCheckResult {
  status: SourceHealth
  latencyMs?: number
  lastChecked: Date
  error?: string
  details?: Record<string, unknown>
}

/**
 * Catalog entry for a registered data source
 */
export interface CatalogEntry {
  /** Unique source identifier */
  name: string
  /** Human-readable display name */
  displayName?: string
  /** Source type */
  type: SourceType
  /** Connection configuration */
  connection: ConnectionConfig
  /** Source capabilities */
  capabilities: SourceCapabilities
  /** Schema information */
  schema?: SourceSchema
  /** Table statistics for cost estimation */
  statistics?: SourceStatistics
  /** Priority for routing (higher = preferred) */
  priority: number
  /** Tags for categorization */
  tags?: string[]
  /** Metadata */
  metadata?: Record<string, unknown>
  /** Creation timestamp */
  createdAt: Date
  /** Last update timestamp */
  updatedAt: Date
  /** Health status */
  health?: HealthCheckResult
}

/**
 * Options for registering a source
 */
export interface RegisterSourceOptions {
  /** Replace existing source if present */
  replace?: boolean
  /** Skip schema discovery */
  skipSchemaDiscovery?: boolean
  /** Skip health check */
  skipHealthCheck?: boolean
}

/**
 * Options for listing sources
 */
export interface ListSourcesOptions {
  /** Filter by type */
  type?: SourceType | SourceType[]
  /** Filter by tags */
  tags?: string[]
  /** Filter by health status */
  health?: SourceHealth | SourceHealth[]
  /** Include unavailable sources */
  includeUnavailable?: boolean
  /** Sort by field */
  sortBy?: 'name' | 'priority' | 'createdAt' | 'updatedAt'
  /** Sort direction */
  sortOrder?: 'asc' | 'desc'
}

/**
 * Options for finding sources for a table
 */
export interface FindSourcesOptions {
  /** Include unavailable sources */
  includeUnavailable?: boolean
  /** Required capabilities */
  requiredCapabilities?: Array<keyof SourceCapabilities>
}

/**
 * Qualified table name with full namespace
 */
export interface QualifiedTableName {
  /** Catalog name (top-level namespace) */
  catalog?: string
  /** Schema name (second-level namespace) */
  schema?: string
  /** Table name */
  table: string
}

/**
 * Resolved table reference
 */
export interface ResolvedTable {
  /** Source name */
  source: string
  /** Table name within source */
  table: string
  /** Full qualified name */
  qualifiedName: QualifiedTableName
}

/**
 * Event types for the catalog registry
 */
export type CatalogEventType =
  | 'sourceRegistered'
  | 'sourceUnregistered'
  | 'sourceUpdated'
  | 'schemaUpdated'
  | 'healthChanged'
  | 'statisticsUpdated'

/**
 * Event payload types
 */
export interface CatalogEventPayload {
  sourceRegistered: { entry: CatalogEntry }
  sourceUnregistered: { name: string; entry: CatalogEntry }
  sourceUpdated: { name: string; entry: CatalogEntry; changes: Partial<CatalogEntry> }
  schemaUpdated: { name: string; schema: SourceSchema; previousSchema?: SourceSchema }
  healthChanged: { name: string; health: HealthCheckResult; previousHealth?: HealthCheckResult }
  statisticsUpdated: { name: string; statistics: SourceStatistics }
}

/**
 * Event listener type
 */
export type CatalogEventListener<T extends CatalogEventType> = (
  payload: CatalogEventPayload[T]
) => void | Promise<void>

// =============================================================================
// CATALOG REGISTRY CLASS
// =============================================================================

/**
 * Multi-source catalog registry for federated queries
 *
 * Manages registration, discovery, and metadata for multiple data sources
 * used in federated query execution.
 */
export class CatalogRegistry {
  /** Registered sources by name */
  private sources = new Map<string, CatalogEntry>()

  /** Attached adapters by source name */
  private adapters = new Map<string, SourceAdapter>()

  /** Table index: table name -> source names */
  private tableIndex = new Map<string, Set<string>>()

  /** Qualified name index: "catalog.schema.table" -> source names */
  private qualifiedIndex = new Map<string, Set<string>>()

  /** Default source for unqualified references */
  private defaultSource: string | null = null

  /** Default catalog name for hierarchical resolution */
  private defaultCatalog: string | null = null

  /** Default schema name for hierarchical resolution */
  private defaultSchema: string | null = null

  /** Unavailable sources */
  private unavailableSources = new Set<string>()

  /** Event listeners */
  private listeners = new Map<CatalogEventType, Set<CatalogEventListener<CatalogEventType>>>()

  // ===========================================================================
  // SOURCE REGISTRATION
  // ===========================================================================

  /**
   * Register a new data source
   */
  registerSource(
    name: string,
    config: {
      type: SourceType
      connection: ConnectionConfig
      capabilities?: Partial<SourceCapabilities>
      schema?: SourceSchema
      statistics?: SourceStatistics
      priority?: number
      displayName?: string
      tags?: string[]
      metadata?: Record<string, unknown>
    },
    options: RegisterSourceOptions = {}
  ): CatalogEntry {
    const { replace = false } = options

    if (this.sources.has(name) && !replace) {
      throw new Error(`Source '${name}' is already registered`)
    }

    const now = new Date()
    const entry: CatalogEntry = {
      name,
      displayName: config.displayName ?? name,
      type: config.type,
      connection: config.connection,
      capabilities: {
        predicatePushdown: true,
        projectionPushdown: true,
        limitPushdown: true,
        aggregationPushdown: false,
        joinPushdown: false,
        ...config.capabilities,
      },
      schema: config.schema,
      statistics: config.statistics,
      priority: config.priority ?? 0,
      tags: config.tags,
      metadata: config.metadata,
      createdAt: now,
      updatedAt: now,
    }

    const isReplacing = this.sources.has(name)
    if (isReplacing) {
      // Remove old index entries
      const oldEntry = this.sources.get(name)!
      this.removeFromIndexes(oldEntry)
    }

    this.sources.set(name, entry)

    // Build indexes
    if (entry.schema) {
      this.indexSchema(name, entry.schema)
    }

    // Emit event
    this.emit('sourceRegistered', { entry })

    return entry
  }

  /**
   * Unregister a data source
   */
  unregisterSource(name: string): boolean {
    const entry = this.sources.get(name)
    if (!entry) {
      return false
    }

    // Clean up indexes
    this.removeFromIndexes(entry)
    this.sources.delete(name)
    this.adapters.delete(name)
    this.unavailableSources.delete(name)

    // Reset default if needed
    if (this.defaultSource === name) {
      this.defaultSource = null
    }

    // Emit event
    this.emit('sourceUnregistered', { name, entry })

    return true
  }

  /**
   * Check if a source is registered
   */
  hasSource(name: string): boolean {
    return this.sources.has(name)
  }

  /**
   * Get a source entry by name
   */
  getSource(name: string): CatalogEntry | undefined {
    return this.sources.get(name)
  }

  /**
   * List all registered sources with optional filtering
   */
  listSources(options: ListSourcesOptions = {}): CatalogEntry[] {
    let entries = Array.from(this.sources.values())

    // Filter by type
    if (options.type) {
      const types = Array.isArray(options.type) ? options.type : [options.type]
      entries = entries.filter(e => types.includes(e.type))
    }

    // Filter by tags
    if (options.tags && options.tags.length > 0) {
      entries = entries.filter(e =>
        e.tags && options.tags!.some(tag => e.tags!.includes(tag))
      )
    }

    // Filter by health
    if (options.health) {
      const healthStates = Array.isArray(options.health) ? options.health : [options.health]
      entries = entries.filter(e =>
        e.health && healthStates.includes(e.health.status)
      )
    }

    // Exclude unavailable unless explicitly requested
    if (!options.includeUnavailable) {
      entries = entries.filter(e => !this.unavailableSources.has(e.name))
    }

    // Sort
    const sortBy = options.sortBy ?? 'priority'
    const sortOrder = options.sortOrder ?? 'desc'
    entries.sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'priority':
          comparison = a.priority - b.priority
          break
        case 'createdAt':
          comparison = a.createdAt.getTime() - b.createdAt.getTime()
          break
        case 'updatedAt':
          comparison = a.updatedAt.getTime() - b.updatedAt.getTime()
          break
      }
      return sortOrder === 'desc' ? -comparison : comparison
    })

    return entries
  }

  // ===========================================================================
  // ADAPTER MANAGEMENT
  // ===========================================================================

  /**
   * Attach an adapter to a source
   */
  attachAdapter(sourceName: string, adapter: SourceAdapter): void {
    if (!this.sources.has(sourceName)) {
      throw new Error(`Source '${sourceName}' is not registered`)
    }
    this.adapters.set(sourceName, adapter)
  }

  /**
   * Get the adapter for a source
   */
  getAdapter(sourceName: string): SourceAdapter | undefined {
    return this.adapters.get(sourceName)
  }

  /**
   * Detach adapter from a source
   */
  detachAdapter(sourceName: string): boolean {
    return this.adapters.delete(sourceName)
  }

  // ===========================================================================
  // SCHEMA MANAGEMENT
  // ===========================================================================

  /**
   * Register or update schema for a source
   */
  registerSchema(sourceName: string, schema: SourceSchema): void {
    const entry = this.sources.get(sourceName)
    if (!entry) {
      throw new Error(`Source '${sourceName}' is not registered`)
    }

    const previousSchema = entry.schema

    // Remove old index entries
    if (previousSchema) {
      this.removeSchemaFromIndex(sourceName, previousSchema)
    }

    // Update entry
    entry.schema = schema
    entry.updatedAt = new Date()

    // Rebuild indexes
    this.indexSchema(sourceName, schema)

    // Emit event
    this.emit('schemaUpdated', { name: sourceName, schema, previousSchema })
  }

  /**
   * Get schema for a source
   */
  getSchema(sourceName: string): SourceSchema | undefined {
    return this.sources.get(sourceName)?.schema
  }

  /**
   * Discover schema from a source adapter
   */
  async discoverSchema(sourceName: string): Promise<SourceSchema> {
    const adapter = this.adapters.get(sourceName)
    if (!adapter) {
      throw new Error(`No adapter attached to source '${sourceName}'`)
    }

    // Query adapter for available tables
    const result = await adapter.execute({ table: '__tables__' })

    const schema: SourceSchema = { tables: {} }

    // Extract table names
    const tableNames: string[] = []
    for (const row of result.rows) {
      if (typeof row.table_name === 'string') {
        tableNames.push(row.table_name)
      }
    }

    // Discover columns for each table
    for (const tableName of tableNames) {
      const tableResult = await adapter.execute({ table: tableName, limit: 1 })
      if (tableResult.rows.length > 0) {
        const sampleRow = tableResult.rows[0]!
        const columns: Record<string, ColumnDef> = {}
        for (const [colName, value] of Object.entries(sampleRow)) {
          columns[colName] = {
            type: this.inferColumnType(value),
            nullable: true,
          }
        }
        schema.tables[tableName] = { columns }
      }
    }

    // Register the discovered schema
    this.registerSchema(sourceName, schema)

    return schema
  }

  /**
   * Get column definition for a specific table column
   */
  getColumnDef(sourceName: string, tableName: string, columnName: string): ColumnDef | undefined {
    const schema = this.getSchema(sourceName)
    return schema?.tables[tableName]?.columns[columnName]
  }

  /**
   * Get table definition
   */
  getTableDef(sourceName: string, tableName: string): TableDef | undefined {
    const schema = this.getSchema(sourceName)
    return schema?.tables[tableName]
  }

  // ===========================================================================
  // STATISTICS MANAGEMENT
  // ===========================================================================

  /**
   * Register or update statistics for a source
   */
  registerStatistics(sourceName: string, statistics: SourceStatistics): void {
    const entry = this.sources.get(sourceName)
    if (!entry) {
      throw new Error(`Source '${sourceName}' is not registered`)
    }

    entry.statistics = statistics
    entry.updatedAt = new Date()

    // Emit event
    this.emit('statisticsUpdated', { name: sourceName, statistics })
  }

  /**
   * Get statistics for a source
   */
  getStatistics(sourceName: string): SourceStatistics | undefined {
    return this.sources.get(sourceName)?.statistics
  }

  /**
   * Get table statistics
   */
  getTableStatistics(sourceName: string, tableName: string): { rowCount: number; sizeBytes: number; distinctCounts?: Record<string, number> } | undefined {
    return this.getStatistics(sourceName)?.tables[tableName]
  }

  // ===========================================================================
  // TABLE LOOKUP AND RESOLUTION
  // ===========================================================================

  /**
   * Find sources that contain a specific table
   */
  findSourcesForTable(tableName: string, options: FindSourcesOptions = {}): CatalogEntry[] {
    const { includeUnavailable = false, requiredCapabilities } = options

    // Check unqualified name first
    let sourceNames = this.tableIndex.get(tableName)

    // If not found, try qualified lookup
    if (!sourceNames || sourceNames.size === 0) {
      sourceNames = this.qualifiedIndex.get(tableName)
    }

    if (!sourceNames || sourceNames.size === 0) {
      return []
    }

    let entries = Array.from(sourceNames)
      .map(name => this.sources.get(name)!)
      .filter(Boolean)

    // Exclude unavailable
    if (!includeUnavailable) {
      entries = entries.filter(e => !this.unavailableSources.has(e.name))
    }

    // Filter by capabilities
    if (requiredCapabilities && requiredCapabilities.length > 0) {
      entries = entries.filter(e =>
        requiredCapabilities.every(cap => e.capabilities[cap])
      )
    }

    // Sort by priority (highest first)
    return entries.sort((a, b) => b.priority - a.priority)
  }

  /**
   * Get the preferred source for a table (highest priority available)
   */
  getPreferredSourceForTable(tableName: string, options: FindSourcesOptions = {}): CatalogEntry | undefined {
    const sources = this.findSourcesForTable(tableName, options)
    return sources[0]
  }

  /**
   * Check if any source has a specific table
   */
  hasTable(tableName: string): boolean {
    return this.tableIndex.has(tableName) || this.qualifiedIndex.has(tableName)
  }

  /**
   * Get all tables across all sources
   */
  getAllTables(): string[] {
    return Array.from(this.tableIndex.keys())
  }

  /**
   * Resolve a table reference to source and table
   */
  resolveTable(tableRef: string): ResolvedTable {
    const parts = tableRef.split('.')

    if (parts.length === 3) {
      // catalog.schema.table format
      const [catalog, schema, table] = parts as [string, string, string]
      const qualifiedName: QualifiedTableName = { catalog, schema, table }
      const key = `${catalog}.${schema}.${table}`

      const sources = this.qualifiedIndex.get(key)
      if (sources && sources.size > 0) {
        return {
          source: Array.from(sources)[0]!,
          table,
          qualifiedName,
        }
      }

      throw new Error(`Table ${key} not found in any source`)
    }

    if (parts.length === 2) {
      // source.table or schema.table format
      const [prefix, table] = parts as [string, string]

      // First, try as source.table
      const entry = this.sources.get(prefix)
      if (entry && entry.schema?.tables[table]) {
        return {
          source: prefix,
          table,
          qualifiedName: { table },
        }
      }

      // Try as schema.table with default catalog
      if (this.defaultCatalog) {
        const key = `${this.defaultCatalog}.${prefix}.${table}`
        const sources = this.qualifiedIndex.get(key)
        if (sources && sources.size > 0) {
          return {
            source: Array.from(sources)[0]!,
            table,
            qualifiedName: { catalog: this.defaultCatalog, schema: prefix, table },
          }
        }
      }

      throw new Error(`Table ${tableRef} not found in any source`)
    }

    // Unqualified table name
    const table = parts[0]!

    // Find which sources have this table
    const sourcesWithTable = this.tableIndex.get(table)

    if (!sourcesWithTable || sourcesWithTable.size === 0) {
      // Try default source
      if (this.defaultSource) {
        const defaultEntry = this.sources.get(this.defaultSource)
        if (defaultEntry?.schema?.tables[table]) {
          return {
            source: this.defaultSource,
            table,
            qualifiedName: { table },
          }
        }
      }
      throw new Error(`Table '${table}' not found in any source`)
    }

    // Filter out unavailable sources
    const availableSources = Array.from(sourcesWithTable).filter(
      name => !this.unavailableSources.has(name)
    )

    if (availableSources.length === 0) {
      throw new Error(`Table '${table}' exists but all sources are unavailable`)
    }

    if (availableSources.length > 1) {
      throw new Error(
        `Ambiguous table reference: '${table}' exists in multiple sources: ${availableSources.join(', ')}`
      )
    }

    return {
      source: availableSources[0]!,
      table,
      qualifiedName: { table },
    }
  }

  // ===========================================================================
  // DEFAULT SOURCE MANAGEMENT
  // ===========================================================================

  /**
   * Set the default source for unqualified table references
   */
  setDefaultSource(sourceName: string | null): void {
    if (sourceName !== null && !this.sources.has(sourceName)) {
      throw new Error(`Source '${sourceName}' is not registered`)
    }
    this.defaultSource = sourceName
  }

  /**
   * Get the default source
   */
  getDefaultSource(): string | null {
    return this.defaultSource
  }

  /**
   * Set default catalog for hierarchical namespace resolution
   */
  setDefaultCatalog(catalogName: string | null): void {
    this.defaultCatalog = catalogName
  }

  /**
   * Set default schema for hierarchical namespace resolution
   */
  setDefaultSchema(schemaName: string | null): void {
    this.defaultSchema = schemaName
  }

  // ===========================================================================
  // HEALTH AND AVAILABILITY
  // ===========================================================================

  /**
   * Check if a source is available
   */
  isSourceAvailable(sourceName: string): boolean {
    return this.sources.has(sourceName) && !this.unavailableSources.has(sourceName)
  }

  /**
   * Mark a source as unavailable
   */
  markSourceUnavailable(sourceName: string, error?: string): void {
    if (!this.sources.has(sourceName)) {
      return
    }

    const entry = this.sources.get(sourceName)!
    const previousHealth = entry.health

    const health: HealthCheckResult = {
      status: 'unhealthy',
      lastChecked: new Date(),
      error,
    }

    entry.health = health
    this.unavailableSources.add(sourceName)

    this.emit('healthChanged', { name: sourceName, health, previousHealth })
  }

  /**
   * Mark a source as available
   */
  markSourceAvailable(sourceName: string, latencyMs?: number): void {
    if (!this.sources.has(sourceName)) {
      return
    }

    const entry = this.sources.get(sourceName)!
    const previousHealth = entry.health

    const health: HealthCheckResult = {
      status: 'healthy',
      lastChecked: new Date(),
      latencyMs,
    }

    entry.health = health
    this.unavailableSources.delete(sourceName)

    this.emit('healthChanged', { name: sourceName, health, previousHealth })
  }

  /**
   * Update health status
   */
  updateHealth(sourceName: string, result: HealthCheckResult): void {
    const entry = this.sources.get(sourceName)
    if (!entry) {
      return
    }

    const previousHealth = entry.health
    entry.health = result

    if (result.status === 'unhealthy') {
      this.unavailableSources.add(sourceName)
    } else {
      this.unavailableSources.delete(sourceName)
    }

    this.emit('healthChanged', { name: sourceName, health: result, previousHealth })
  }

  /**
   * Get health status for a source
   */
  getHealth(sourceName: string): HealthCheckResult | undefined {
    return this.sources.get(sourceName)?.health
  }

  // ===========================================================================
  // CAPABILITY QUERIES
  // ===========================================================================

  /**
   * Find sources with a specific capability
   */
  findSourcesWithCapability(capability: keyof SourceCapabilities): CatalogEntry[] {
    return Array.from(this.sources.values()).filter(
      entry => entry.capabilities[capability] === true
    )
  }

  /**
   * Find sources matching all specified capabilities
   */
  findSourcesWithCapabilities(capabilities: Array<keyof SourceCapabilities>): CatalogEntry[] {
    return Array.from(this.sources.values()).filter(
      entry => capabilities.every(cap => entry.capabilities[cap] === true)
    )
  }

  /**
   * Check if a source has a specific capability
   */
  sourceHasCapability(sourceName: string, capability: keyof SourceCapabilities): boolean {
    const entry = this.sources.get(sourceName)
    return entry?.capabilities[capability] === true
  }

  /**
   * Get capabilities for a source
   */
  getCapabilities(sourceName: string): SourceCapabilities | undefined {
    return this.sources.get(sourceName)?.capabilities
  }

  // ===========================================================================
  // SERIALIZATION
  // ===========================================================================

  /**
   * Export catalog to JSON
   */
  toJSON(): string {
    const data = {
      sources: Array.from(this.sources.values()).map(entry => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
        health: entry.health ? {
          ...entry.health,
          lastChecked: entry.health.lastChecked.toISOString(),
        } : undefined,
      })),
      defaultSource: this.defaultSource,
      defaultCatalog: this.defaultCatalog,
      defaultSchema: this.defaultSchema,
    }
    return JSON.stringify(data, null, 2)
  }

  /**
   * Import catalog from JSON
   */
  fromJSON(json: string): void {
    const data = JSON.parse(json) as {
      sources: Array<CatalogEntry & {
        createdAt: string
        updatedAt: string
        health?: HealthCheckResult & { lastChecked: string }
      }>
      defaultSource?: string
      defaultCatalog?: string
      defaultSchema?: string
    }

    // Clear existing state
    this.sources.clear()
    this.tableIndex.clear()
    this.qualifiedIndex.clear()
    this.unavailableSources.clear()

    // Import sources
    for (const sourceData of data.sources) {
      const entry: CatalogEntry = {
        ...sourceData,
        createdAt: new Date(sourceData.createdAt),
        updatedAt: new Date(sourceData.updatedAt),
        health: sourceData.health ? {
          ...sourceData.health,
          lastChecked: new Date(sourceData.health.lastChecked),
        } : undefined,
      }

      this.sources.set(entry.name, entry)

      if (entry.schema) {
        this.indexSchema(entry.name, entry.schema)
      }

      if (entry.health?.status === 'unhealthy') {
        this.unavailableSources.add(entry.name)
      }
    }

    // Restore defaults
    this.defaultSource = data.defaultSource ?? null
    this.defaultCatalog = data.defaultCatalog ?? null
    this.defaultSchema = data.defaultSchema ?? null
  }

  // ===========================================================================
  // EVENT HANDLING
  // ===========================================================================

  /**
   * Register an event listener
   */
  on<T extends CatalogEventType>(event: T, listener: CatalogEventListener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener as CatalogEventListener<CatalogEventType>)

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(listener as CatalogEventListener<CatalogEventType>)
    }
  }

  /**
   * Remove an event listener
   */
  off<T extends CatalogEventType>(event: T, listener: CatalogEventListener<T>): void {
    this.listeners.get(event)?.delete(listener as CatalogEventListener<CatalogEventType>)
  }

  /**
   * Emit an event
   */
  private emit<T extends CatalogEventType>(event: T, payload: CatalogEventPayload[T]): void {
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      for (const listener of eventListeners) {
        try {
          listener(payload as CatalogEventPayload[CatalogEventType])
        } catch {
          // Ignore listener errors
        }
      }
    }
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Index schema tables
   */
  private indexSchema(sourceName: string, schema: SourceSchema): void {
    for (const tableName of Object.keys(schema.tables)) {
      // Index unqualified name
      if (!this.tableIndex.has(tableName)) {
        this.tableIndex.set(tableName, new Set())
      }
      this.tableIndex.get(tableName)!.add(sourceName)

      // Index qualified name if source has metadata
      const entry = this.sources.get(sourceName)
      if (entry?.metadata?.catalog && entry?.metadata?.schema) {
        const qualifiedName = `${entry.metadata.catalog}.${entry.metadata.schema}.${tableName}`
        if (!this.qualifiedIndex.has(qualifiedName)) {
          this.qualifiedIndex.set(qualifiedName, new Set())
        }
        this.qualifiedIndex.get(qualifiedName)!.add(sourceName)
      }
    }
  }

  /**
   * Remove schema from indexes
   */
  private removeSchemaFromIndex(sourceName: string, schema: SourceSchema): void {
    for (const tableName of Object.keys(schema.tables)) {
      const sources = this.tableIndex.get(tableName)
      if (sources) {
        sources.delete(sourceName)
        if (sources.size === 0) {
          this.tableIndex.delete(tableName)
        }
      }
    }
  }

  /**
   * Remove all index entries for a source
   */
  private removeFromIndexes(entry: CatalogEntry): void {
    if (entry.schema) {
      this.removeSchemaFromIndex(entry.name, entry.schema)
    }

    // Remove from qualified index
    for (const [key, sources] of this.qualifiedIndex) {
      if (sources.has(entry.name)) {
        sources.delete(entry.name)
        if (sources.size === 0) {
          this.qualifiedIndex.delete(key)
        }
      }
    }
  }

  /**
   * Infer column type from a value
   */
  private inferColumnType(value: unknown): ColumnType {
    if (value === null || value === undefined) return 'string'
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'integer' : 'number'
    }
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'timestamp'
      return 'string'
    }
    if (typeof value === 'object') return 'json'
    return 'string'
  }
}
