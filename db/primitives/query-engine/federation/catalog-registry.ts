/**
 * Multi-Source Catalog Registry
 *
 * Manages multiple data sources for query federation. Supports registration,
 * lookup, priority-based routing, and capability queries.
 *
 * @see dotdo-1v9my
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Capabilities a data source may support
 */
export interface SourceCapabilities {
  supportsJoins: boolean
  supportsAggregations: boolean
  supportsTransactions: boolean
  supportsFullTextSearch: boolean
  supportsVectorSearch: boolean
}

/**
 * Column data types
 */
export type ColumnType =
  | 'string'
  | 'integer'
  | 'bigint'
  | 'float'
  | 'double'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'time'
  | 'json'
  | 'array'
  | 'binary'
  | 'uuid'
  | 'unknown'

/**
 * Column definition with type information
 */
export interface ColumnDefinition {
  name: string
  type: ColumnType
  nullable?: boolean
  primaryKey?: boolean
  defaultValue?: unknown
  comment?: string
}

/**
 * Table definition with columns
 */
export interface TableDefinition {
  name: string
  columns: ColumnDefinition[]
  primaryKey?: string[]
  comment?: string
}

/**
 * Table statistics for cost estimation
 */
export interface TableStatistics {
  rowCount?: number
  sizeBytes?: number
  lastUpdated?: Date
  columnStats?: Map<string, ColumnStatistics>
}

/**
 * Column-level statistics for cost estimation
 */
export interface ColumnStatistics {
  distinctCount?: number
  nullCount?: number
  minValue?: unknown
  maxValue?: unknown
  avgLength?: number
}

/**
 * Qualified name for hierarchical namespace support
 */
export interface QualifiedName {
  catalog?: string
  schema?: string
  table: string
}

/**
 * Schema information for a data source (enhanced)
 */
export interface SourceSchema {
  tables: string[]
  views: string[]
  /** Detailed table definitions with columns */
  tableDefinitions?: Map<string, TableDefinition>
  /** Default schema name for this source */
  defaultSchema?: string
  /** Default catalog name for this source */
  defaultCatalog?: string
}

/**
 * Data source catalog entry
 */
export interface DataSourceCatalog {
  name: string
  type: string
  capabilities: SourceCapabilities
  schema: SourceSchema
  connectionConfig?: Record<string, unknown>
  priority?: number
  /** Table statistics for cost estimation */
  statistics?: Map<string, TableStatistics>
}

/**
 * Source priority configuration
 */
export type SourcePriority = number

/**
 * Routing rule for directing queries to specific sources
 */
export interface RoutingRule {
  table: string
  preferredSource: string
  condition: string
}

/**
 * Options for source registration
 */
export interface RegisterOptions {
  replace?: boolean
}

/**
 * Options for source listing
 */
export interface ListOptions {
  type?: string
}

/**
 * Options for table lookup
 */
export interface LookupOptions {
  includeUnavailable?: boolean
}

/**
 * Query resolution context
 */
export interface ResolveContext {
  readOnly?: boolean
  [key: string]: unknown
}

/**
 * Event types for the catalog registry
 */
type CatalogEvent = 'sourceRegistered' | 'sourceUnregistered' | 'availabilityChanged'

/**
 * Event listener types
 */
type SourceRegisteredListener = (source: DataSourceCatalog) => void
type SourceUnregisteredListener = (name: string) => void
type AvailabilityChangedListener = (name: string, available: boolean) => void

// =============================================================================
// CatalogRegistry Class
// =============================================================================

export class CatalogRegistry {
  private sources: Map<string, DataSourceCatalog> = new Map()
  private tableIndex: Map<string, Set<string>> = new Map() // table -> source names
  private routingRules: Map<string, RoutingRule[]> = new Map() // table -> rules
  private unavailableSources: Set<string> = new Set()
  /** Index for hierarchical namespace resolution: "catalog.schema.table" -> source names */
  private qualifiedNameIndex: Map<string, Set<string>> = new Map()

  // Event listeners
  private sourceRegisteredListeners: SourceRegisteredListener[] = []
  private sourceUnregisteredListeners: SourceUnregisteredListener[] = []
  private availabilityChangedListeners: AvailabilityChangedListener[] = []

  // =============================================================================
  // Source Registration
  // =============================================================================

  /**
   * Register a data source
   */
  registerSource(source: DataSourceCatalog, options?: RegisterOptions): void {
    const { replace = false } = options ?? {}

    if (this.sources.has(source.name) && !replace) {
      throw new Error(`Source '${source.name}' is already registered`)
    }

    // Ensure priority has a default value
    const normalizedSource: DataSourceCatalog = {
      ...source,
      priority: source.priority ?? 0,
    }

    this.sources.set(source.name, normalizedSource)
    this.indexSourceTables(normalizedSource)

    // Emit event
    this.emitSourceRegistered(normalizedSource)
  }

  /**
   * Unregister a data source
   */
  unregisterSource(name: string): boolean {
    const source = this.sources.get(name)
    if (!source) {
      return false
    }

    // Remove from table index
    this.removeSourceFromIndex(source)

    this.sources.delete(name)
    this.unavailableSources.delete(name)

    // Emit event
    this.emitSourceUnregistered(name)

    return true
  }

  /**
   * Get a source by name
   */
  getSource(name: string): DataSourceCatalog | undefined {
    return this.sources.get(name)
  }

  /**
   * List all registered sources
   */
  listSources(options?: ListOptions): DataSourceCatalog[] {
    const sources = Array.from(this.sources.values())

    if (options?.type) {
      return sources.filter(s => s.type === options.type)
    }

    return sources
  }

  // =============================================================================
  // Table Lookup
  // =============================================================================

  /**
   * Find sources that contain a specific table
   */
  findSourcesForTable(table: string, options?: LookupOptions): DataSourceCatalog[] {
    const { includeUnavailable = false } = options ?? {}
    const sourceNames = this.tableIndex.get(table)

    if (!sourceNames) {
      return []
    }

    let sources = Array.from(sourceNames)
      .map(name => this.sources.get(name)!)
      .filter(Boolean)

    // Exclude unavailable sources unless explicitly requested
    if (!includeUnavailable) {
      sources = sources.filter(s => !this.unavailableSources.has(s.name))
    }

    // Sort by priority (highest first)
    return sources.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  }

  /**
   * Get the preferred source for a table (highest priority)
   */
  getPreferredSourceForTable(table: string): DataSourceCatalog | undefined {
    const sources = this.findSourcesForTable(table)
    return sources[0]
  }

  /**
   * Check if a table exists in any source
   */
  hasTable(table: string): boolean {
    return this.tableIndex.has(table)
  }

  /**
   * Get all tables across all sources
   */
  getAllTables(): string[] {
    return Array.from(this.tableIndex.keys())
  }

  // =============================================================================
  // Hierarchical Namespace Support
  // =============================================================================

  /**
   * Parse a qualified table name (catalog.schema.table or schema.table or table)
   */
  parseQualifiedName(name: string): QualifiedName {
    const parts = name.split('.')
    if (parts.length === 3) {
      return { catalog: parts[0], schema: parts[1], table: parts[2] }
    } else if (parts.length === 2) {
      return { schema: parts[0], table: parts[1] }
    }
    return { table: name }
  }

  /**
   * Format a qualified name to a string
   */
  formatQualifiedName(qn: QualifiedName): string {
    const parts: string[] = []
    if (qn.catalog) parts.push(qn.catalog)
    if (qn.schema) parts.push(qn.schema)
    parts.push(qn.table)
    return parts.join('.')
  }

  /**
   * Resolve a qualified name to a source and table
   * Supports: "catalog.schema.table", "schema.table", "table"
   */
  resolveQualifiedName(name: string, options?: LookupOptions): { source: DataSourceCatalog; table: string } | undefined {
    const qn = this.parseQualifiedName(name)
    const { includeUnavailable = false } = options ?? {}

    // First, try exact qualified name lookup
    const qualifiedKey = this.formatQualifiedName(qn)
    const exactSourceNames = this.qualifiedNameIndex.get(qualifiedKey)

    if (exactSourceNames && exactSourceNames.size > 0) {
      let candidates = Array.from(exactSourceNames)
        .map(n => this.sources.get(n)!)
        .filter(Boolean)

      if (!includeUnavailable) {
        candidates = candidates.filter(s => !this.unavailableSources.has(s.name))
      }

      if (candidates.length > 0) {
        const source = candidates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]
        return { source, table: qn.table }
      }
    }

    // Try matching with source defaults
    for (const source of Array.from(this.sources.values())) {
      if (!includeUnavailable && this.unavailableSources.has(source.name)) {
        continue
      }

      const defaultCatalog = source.schema.defaultCatalog
      const defaultSchema = source.schema.defaultSchema

      // Match if catalog/schema match defaults or are unspecified
      const catalogMatches = !qn.catalog || qn.catalog === defaultCatalog
      const schemaMatches = !qn.schema || qn.schema === defaultSchema

      if (catalogMatches && schemaMatches) {
        if (source.schema.tables.includes(qn.table) || source.schema.views.includes(qn.table)) {
          return { source, table: qn.table }
        }
      }
    }

    // Fall back to simple table lookup
    const sources = this.findSourcesForTable(qn.table, options)
    if (sources.length > 0) {
      return { source: sources[0], table: qn.table }
    }

    return undefined
  }

  /**
   * List all qualified names (catalog.schema.table format) available
   */
  listQualifiedNames(): string[] {
    return Array.from(this.qualifiedNameIndex.keys())
  }

  // =============================================================================
  // Column and Schema Introspection
  // =============================================================================

  /**
   * Get table definition with columns for a specific source and table
   */
  getTableDefinition(sourceName: string, tableName: string): TableDefinition | undefined {
    const source = this.sources.get(sourceName)
    if (!source?.schema.tableDefinitions) {
      return undefined
    }
    return source.schema.tableDefinitions.get(tableName)
  }

  /**
   * Get columns for a table from a specific source
   */
  getTableColumns(sourceName: string, tableName: string): ColumnDefinition[] {
    const definition = this.getTableDefinition(sourceName, tableName)
    return definition?.columns ?? []
  }

  /**
   * Register table definition with columns
   */
  registerTableDefinition(sourceName: string, definition: TableDefinition): void {
    const source = this.sources.get(sourceName)
    if (!source) {
      throw new Error(`Source '${sourceName}' not found`)
    }

    // Initialize tableDefinitions if needed
    if (!source.schema.tableDefinitions) {
      source.schema.tableDefinitions = new Map()
    }

    source.schema.tableDefinitions.set(definition.name, definition)

    // Add to tables list if not already present
    if (!source.schema.tables.includes(definition.name)) {
      source.schema.tables.push(definition.name)
      // Re-index
      this.indexSourceTables(source)
    }
  }

  /**
   * Get all table definitions for a source
   */
  getAllTableDefinitions(sourceName: string): TableDefinition[] {
    const source = this.sources.get(sourceName)
    if (!source?.schema.tableDefinitions) {
      return []
    }
    return Array.from(source.schema.tableDefinitions.values())
  }

  // =============================================================================
  // Table Statistics for Cost Estimation
  // =============================================================================

  /**
   * Get statistics for a table
   */
  getTableStatistics(sourceName: string, tableName: string): TableStatistics | undefined {
    const source = this.sources.get(sourceName)
    return source?.statistics?.get(tableName)
  }

  /**
   * Update statistics for a table
   */
  setTableStatistics(sourceName: string, tableName: string, stats: TableStatistics): void {
    const source = this.sources.get(sourceName)
    if (!source) {
      throw new Error(`Source '${sourceName}' not found`)
    }

    if (!source.statistics) {
      source.statistics = new Map()
    }

    source.statistics.set(tableName, {
      ...stats,
      lastUpdated: stats.lastUpdated ?? new Date(),
    })
  }

  /**
   * Get column statistics for cost estimation
   */
  getColumnStatistics(sourceName: string, tableName: string, columnName: string): ColumnStatistics | undefined {
    const tableStats = this.getTableStatistics(sourceName, tableName)
    return tableStats?.columnStats?.get(columnName)
  }

  /**
   * Update column statistics
   */
  setColumnStatistics(sourceName: string, tableName: string, columnName: string, stats: ColumnStatistics): void {
    const source = this.sources.get(sourceName)
    if (!source) {
      throw new Error(`Source '${sourceName}' not found`)
    }

    if (!source.statistics) {
      source.statistics = new Map()
    }

    let tableStats = source.statistics.get(tableName)
    if (!tableStats) {
      tableStats = { lastUpdated: new Date() }
      source.statistics.set(tableName, tableStats)
    }

    if (!tableStats.columnStats) {
      tableStats.columnStats = new Map()
    }

    tableStats.columnStats.set(columnName, stats)
    tableStats.lastUpdated = new Date()
  }

  /**
   * Estimate row count for a table (useful for query planning)
   */
  estimateRowCount(sourceName: string, tableName: string): number | undefined {
    return this.getTableStatistics(sourceName, tableName)?.rowCount
  }

  /**
   * Estimate selectivity based on column statistics
   */
  estimateSelectivity(sourceName: string, tableName: string, columnName: string, value: unknown): number {
    const columnStats = this.getColumnStatistics(sourceName, tableName, columnName)
    const tableStats = this.getTableStatistics(sourceName, tableName)

    if (!columnStats?.distinctCount || !tableStats?.rowCount) {
      // Default selectivity when no stats available
      return 0.1
    }

    // Simple selectivity estimation: 1 / distinctCount
    return 1 / columnStats.distinctCount
  }

  /**
   * Clear all statistics for a source
   */
  clearStatistics(sourceName: string): void {
    const source = this.sources.get(sourceName)
    if (source) {
      source.statistics = new Map()
    }
  }

  // =============================================================================
  // Priority Management
  // =============================================================================

  /**
   * Set the priority for a source
   */
  setSourcePriority(name: string, priority: number): void {
    const source = this.sources.get(name)
    if (source) {
      source.priority = priority
    }
  }

  // =============================================================================
  // Capability Queries
  // =============================================================================

  /**
   * Find sources with a specific capability
   */
  findSourcesWithCapability(capability: keyof SourceCapabilities): DataSourceCatalog[] {
    return Array.from(this.sources.values())
      .filter(source => source.capabilities[capability] === true)
  }

  /**
   * Find sources matching multiple capabilities
   */
  findSourcesWithCapabilities(capabilities: Array<keyof SourceCapabilities>): DataSourceCatalog[] {
    return Array.from(this.sources.values())
      .filter(source => capabilities.every(cap => source.capabilities[cap] === true))
  }

  /**
   * Check if a source has a specific capability
   */
  sourceHasCapability(name: string, capability: keyof SourceCapabilities): boolean {
    const source = this.sources.get(name)
    return source?.capabilities[capability] === true
  }

  // =============================================================================
  // Routing Rules
  // =============================================================================

  /**
   * Add a routing rule
   */
  addRoutingRule(rule: RoutingRule): void {
    const rules = this.routingRules.get(rule.table) ?? []
    rules.push(rule)
    this.routingRules.set(rule.table, rules)
  }

  /**
   * Get routing rules for a table
   */
  getRoutingRules(table: string): RoutingRule[] {
    return this.routingRules.get(table) ?? []
  }

  /**
   * Remove a routing rule
   */
  removeRoutingRule(table: string, condition: string): void {
    const rules = this.routingRules.get(table)
    if (rules) {
      const filtered = rules.filter(r => r.condition !== condition)
      if (filtered.length === 0) {
        this.routingRules.delete(table)
      } else {
        this.routingRules.set(table, filtered)
      }
    }
  }

  /**
   * Clear all routing rules
   */
  clearRoutingRules(): void {
    this.routingRules.clear()
  }

  /**
   * Resolve the best source for a table based on context and routing rules
   */
  resolveSource(table: string, context: ResolveContext): DataSourceCatalog | undefined {
    // First, check specific rules for this table
    const tableRules = this.routingRules.get(table) ?? []

    // Then, check wildcard rules
    const wildcardRules = this.routingRules.get('*') ?? []

    // Combine rules, with specific rules taking precedence
    const allRules = [...tableRules, ...wildcardRules]

    // Find matching rule based on context
    for (const rule of allRules) {
      if (this.matchesCondition(rule.condition, context)) {
        const source = this.sources.get(rule.preferredSource)
        if (source && !this.unavailableSources.has(source.name)) {
          return source
        }
      }
    }

    // Fall back to priority-based selection
    return this.getPreferredSourceForTable(table)
  }

  /**
   * Match a condition against context
   */
  private matchesCondition(condition: string, context: ResolveContext): boolean {
    switch (condition) {
      case 'read-only':
        return context.readOnly === true
      case 'default':
        return true
      default:
        return false
    }
  }

  // =============================================================================
  // Schema Management
  // =============================================================================

  /**
   * Update the schema for a source
   */
  updateSourceSchema(name: string, schema: SourceSchema): void {
    const source = this.sources.get(name)
    if (!source) {
      throw new Error(`Source '${name}' not found`)
    }

    // Remove old tables from index
    this.removeSourceFromIndex(source)

    // Update schema
    source.schema = schema

    // Re-index tables
    this.indexSourceTables(source)
  }

  // =============================================================================
  // Health and Availability
  // =============================================================================

  /**
   * Check if a source is available
   */
  isSourceAvailable(name: string): boolean {
    if (!this.sources.has(name)) {
      return false
    }
    return !this.unavailableSources.has(name)
  }

  /**
   * Mark a source as unavailable
   */
  markSourceUnavailable(name: string): void {
    if (this.sources.has(name)) {
      this.unavailableSources.add(name)
      this.emitAvailabilityChanged(name, false)
    }
  }

  /**
   * Mark a source as available
   */
  markSourceAvailable(name: string): void {
    if (this.sources.has(name) && this.unavailableSources.has(name)) {
      this.unavailableSources.delete(name)
      this.emitAvailabilityChanged(name, true)
    }
  }

  // =============================================================================
  // Serialization
  // =============================================================================

  /**
   * Export catalog to JSON
   */
  toJSON(): string {
    const data = {
      sources: Array.from(this.sources.values()),
      routingRules: Array.from(this.routingRules.entries()).flatMap(([_, rules]) => rules),
    }
    return JSON.stringify(data, null, 2)
  }

  /**
   * Import catalog from JSON
   */
  fromJSON(json: string): void {
    const data = JSON.parse(json) as {
      sources: DataSourceCatalog[]
      routingRules: RoutingRule[]
    }

    // Clear existing data
    this.sources.clear()
    this.tableIndex.clear()
    this.routingRules.clear()
    this.unavailableSources.clear()
    this.qualifiedNameIndex.clear()

    // Import sources
    for (const source of data.sources) {
      this.registerSource(source)
    }

    // Import routing rules
    for (const rule of data.routingRules) {
      this.addRoutingRule(rule)
    }
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  /**
   * Register an event listener
   */
  on(event: 'sourceRegistered', listener: SourceRegisteredListener): void
  on(event: 'sourceUnregistered', listener: SourceUnregisteredListener): void
  on(event: 'availabilityChanged', listener: AvailabilityChangedListener): void
  on(event: CatalogEvent, listener: unknown): void {
    switch (event) {
      case 'sourceRegistered':
        this.sourceRegisteredListeners.push(listener as SourceRegisteredListener)
        break
      case 'sourceUnregistered':
        this.sourceUnregisteredListeners.push(listener as SourceUnregisteredListener)
        break
      case 'availabilityChanged':
        this.availabilityChangedListeners.push(listener as AvailabilityChangedListener)
        break
    }
  }

  private emitSourceRegistered(source: DataSourceCatalog): void {
    for (const listener of this.sourceRegisteredListeners) {
      listener(source)
    }
  }

  private emitSourceUnregistered(name: string): void {
    for (const listener of this.sourceUnregisteredListeners) {
      listener(name)
    }
  }

  private emitAvailabilityChanged(name: string, available: boolean): void {
    for (const listener of this.availabilityChangedListeners) {
      listener(name, available)
    }
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  /**
   * Index tables from a source
   */
  private indexSourceTables(source: DataSourceCatalog): void {
    const catalog = source.schema.defaultCatalog
    const schema = source.schema.defaultSchema

    // Index tables
    for (const table of source.schema.tables) {
      // Simple index
      const sources = this.tableIndex.get(table) ?? new Set()
      sources.add(source.name)
      this.tableIndex.set(table, sources)

      // Qualified name index
      this.indexQualifiedName(source.name, { catalog, schema, table })
    }

    // Index views
    for (const view of source.schema.views) {
      // Simple index
      const sources = this.tableIndex.get(view) ?? new Set()
      sources.add(source.name)
      this.tableIndex.set(view, sources)

      // Qualified name index
      this.indexQualifiedName(source.name, { catalog, schema, table: view })
    }
  }

  /**
   * Index a qualified name for a source
   */
  private indexQualifiedName(sourceName: string, qn: QualifiedName): void {
    // Index all possible qualified name variations
    const variations: string[] = [qn.table]

    if (qn.schema) {
      variations.push(`${qn.schema}.${qn.table}`)
    }

    if (qn.catalog && qn.schema) {
      variations.push(`${qn.catalog}.${qn.schema}.${qn.table}`)
    }

    for (const key of variations) {
      const sources = this.qualifiedNameIndex.get(key) ?? new Set()
      sources.add(sourceName)
      this.qualifiedNameIndex.set(key, sources)
    }
  }

  /**
   * Remove qualified name index entries for a source
   */
  private removeQualifiedNameIndex(sourceName: string, qn: QualifiedName): void {
    const variations: string[] = [qn.table]

    if (qn.schema) {
      variations.push(`${qn.schema}.${qn.table}`)
    }

    if (qn.catalog && qn.schema) {
      variations.push(`${qn.catalog}.${qn.schema}.${qn.table}`)
    }

    for (const key of variations) {
      const sources = this.qualifiedNameIndex.get(key)
      if (sources) {
        sources.delete(sourceName)
        if (sources.size === 0) {
          this.qualifiedNameIndex.delete(key)
        }
      }
    }
  }

  /**
   * Remove a source from the table index
   */
  private removeSourceFromIndex(source: DataSourceCatalog): void {
    const catalog = source.schema.defaultCatalog
    const schema = source.schema.defaultSchema

    // Remove tables
    for (const table of source.schema.tables) {
      const sources = this.tableIndex.get(table)
      if (sources) {
        sources.delete(source.name)
        if (sources.size === 0) {
          this.tableIndex.delete(table)
        }
      }
      this.removeQualifiedNameIndex(source.name, { catalog, schema, table })
    }

    // Remove views
    for (const view of source.schema.views) {
      const sources = this.tableIndex.get(view)
      if (sources) {
        sources.delete(source.name)
        if (sources.size === 0) {
          this.tableIndex.delete(view)
        }
      }
      this.removeQualifiedNameIndex(source.name, { catalog, schema, table: view })
    }
  }
}
