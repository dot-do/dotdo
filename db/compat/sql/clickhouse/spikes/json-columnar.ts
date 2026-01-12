/**
 * SPIKE: ClickHouse JSON Field Architecture in Native TypeScript
 *
 * Ports ClickHouse's JSON column type to TypeScript for DO SQLite:
 *
 * ClickHouse JSON Type Features:
 * 1. Automatic typed subcolumn extraction from JSON paths
 * 2. Each frequently-accessed path stored as separate column
 * 3. Path statistics for optimization (frequency, type, cardinality)
 * 4. Dynamic schema handling with fallback JSON blob
 * 5. Projection pushdown for efficient queries
 *
 * DO SQLite Mapping:
 * - Each JSON path → separate SQLite row (columnar storage)
 * - Path metadata → _paths row
 * - Rare paths → _dynamic row (full JSON blob)
 * - Record index → _ids row
 *
 * Example: 10,000 records with data.user.email, data.user.name, data.amount
 *
 * Traditional (row-per-record): 10,000 rows
 * ClickHouse JSON Columnar:
 *   - _ids: ["id1", "id2", ...]
 *   - _paths: {paths metadata}
 *   - data.user.email: ["a@b.com", "c@d.com", ...]
 *   - data.user.name: ["Alice", "Bob", ...]
 *   - data.amount: [100, 200, ...]
 *   - _dynamic: [{rare fields}, {rare fields}, ...]
 *
 * Query: SELECT data.user.email FROM things WHERE data.amount > 100
 * Reads: 3 rows (_ids, data.user.email, data.amount) instead of 10,000!
 */

// ============================================================================
// Types
// ============================================================================

export type JSONValue = string | number | boolean | null | JSONObject | JSONArray
export interface JSONObject {
  [key: string]: JSONValue
}
export type JSONArray = JSONValue[]

export type JSONType = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object'

export interface PathStatistics {
  path: string
  frequency: number // How often this path appears (0-1)
  type: JSONType // Dominant type
  typeDistribution: Record<JSONType, number> // Type counts
  cardinality: number // Estimated unique values
  isExtracted: boolean // Whether stored as separate column
  avgSize?: number // Average size in bytes
}

export interface ColumnConfig {
  path: string
  type: JSONType
  nullable: boolean
  extractionThreshold: number // Frequency threshold for extraction
  isExtracted?: boolean // Whether column has been extracted (from schema evolution)
}

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Extract all paths from a JSON object with their types
 */
export function extractPaths(obj: JSONValue, prefix = ''): Map<string, JSONType> {
  const paths = new Map<string, JSONType>()

  if (obj === null) {
    if (prefix) paths.set(prefix, 'null')
    return paths
  }

  if (Array.isArray(obj)) {
    if (prefix) paths.set(prefix, 'array')
    // Index into arrays with [*] notation
    for (const item of obj) {
      const subPaths = extractPaths(item, prefix ? `${prefix}[*]` : '[*]')
      for (const [p, t] of subPaths) {
        paths.set(p, t)
      }
    }
    return paths
  }

  if (typeof obj === 'object') {
    if (prefix) paths.set(prefix, 'object')
    for (const [key, value] of Object.entries(obj)) {
      const newPrefix = prefix ? `${prefix}.${key}` : key
      const subPaths = extractPaths(value, newPrefix)
      for (const [p, t] of subPaths) {
        paths.set(p, t)
      }
    }
    return paths
  }

  // Primitive types
  if (prefix) {
    paths.set(prefix, typeof obj as JSONType)
  }
  return paths
}

/**
 * Get value at a JSON path
 */
export function getPath(obj: JSONValue, path: string): JSONValue | undefined {
  if (!path) return obj

  const parts = path.split(/\.|\[|\]/).filter((p) => p && p !== '*')
  let current: JSONValue = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined

    if (Array.isArray(current)) {
      const index = parseInt(part, 10)
      if (isNaN(index)) return undefined
      current = current[index]
    } else {
      current = (current as JSONObject)[part]
    }
  }

  return current
}

/**
 * Set value at a JSON path (creates intermediate objects)
 */
export function setPath(obj: JSONObject, path: string, value: JSONValue): void {
  const parts = path.split('.')
  let current: JSONValue = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(current as JSONObject)[part]) {
      ;(current as JSONObject)[part] = {}
    }
    current = (current as JSONObject)[part]
  }

  ;(current as JSONObject)[parts[parts.length - 1]] = value
}

// ============================================================================
// Path Statistics Tracker
// ============================================================================

export class PathStatisticsTracker {
  private pathStats: Map<string, PathStatistics & { count: number }> = new Map()
  private recordCount = 0
  private extractionThreshold: number

  constructor(extractionThreshold = 0.1) {
    // Extract paths that appear in >10% of records
    this.extractionThreshold = extractionThreshold
  }

  /**
   * Track paths from a JSON object
   */
  track(data: JSONObject): void {
    this.recordCount++
    const paths = extractPaths(data)

    for (const [path, type] of paths) {
      let stats = this.pathStats.get(path)

      if (!stats) {
        stats = {
          path,
          frequency: 0,
          type,
          typeDistribution: { string: 0, number: 0, boolean: 0, null: 0, array: 0, object: 0 },
          cardinality: 0,
          isExtracted: false,
          count: 0,
        }
        this.pathStats.set(path, stats)
      }

      stats.count++
      stats.frequency = stats.count / this.recordCount
      stats.typeDistribution[type]++

      // Update dominant type
      let maxCount = 0
      let dominantType: JSONType = 'null'
      for (const [t, count] of Object.entries(stats.typeDistribution)) {
        if (count > maxCount) {
          maxCount = count
          dominantType = t as JSONType
        }
      }
      stats.type = dominantType
    }

    // Update frequencies for paths not seen in this record
    for (const stats of this.pathStats.values()) {
      if (!paths.has(stats.path)) {
        stats.frequency = stats.count / this.recordCount
      }
    }
  }

  /**
   * Get paths that should be extracted as columns
   */
  getExtractedPaths(): PathStatistics[] {
    const extracted: PathStatistics[] = []

    for (const stats of this.pathStats.values()) {
      // Only extract leaf paths (primitives), not objects/arrays
      if (stats.type !== 'object' && stats.type !== 'array') {
        if (stats.frequency >= this.extractionThreshold) {
          stats.isExtracted = true
          extracted.push(stats)
        }
      }
    }

    return extracted.sort((a, b) => b.frequency - a.frequency)
  }

  /**
   * Get all path statistics
   */
  getAllStats(): PathStatistics[] {
    return Array.from(this.pathStats.values()).sort((a, b) => b.frequency - a.frequency)
  }

  getRecordCount(): number {
    return this.recordCount
  }
}

// ============================================================================
// JSON Columnar Storage
// ============================================================================

export interface JSONColumnarRow {
  columnName: string
  data: string | ArrayBuffer // JSON array or binary data
  recordCount: number
  type: JSONType
  updatedAt: number
}

/**
 * ClickHouse-style JSON columnar storage
 *
 * Stores JSON data with automatic typed subcolumn extraction.
 * Each frequently-accessed JSON path becomes a separate column (SQLite row).
 */
export class JSONColumnarStorage {
  private ids: string[] = []
  private columns: Map<string, JSONValue[]> = new Map()
  private dynamicData: JSONObject[] = [] // Fallback for unextracted paths
  private pathTracker: PathStatisticsTracker
  private extractedPaths: Set<string> = new Set()
  private rows: Map<string, string> = new Map() // Simulated SQLite rows
  private readCount = 0
  private writeCount = 0

  constructor(extractionThreshold = 0.1) {
    this.pathTracker = new PathStatisticsTracker(extractionThreshold)
  }

  /**
   * Insert a record with automatic path extraction
   *
   * Note: Path extraction happens on flush() to ensure stable statistics
   */
  insert(id: string, data: JSONObject): void {
    this.ids.push(id)

    // Track path statistics
    this.pathTracker.track(data)

    // Store all data - extraction happens on flush
    this.dynamicData.push(data)
  }

  /**
   * Finalize path extraction and organize into columns
   */
  private finalizeExtraction(): void {
    // Get paths that meet extraction threshold
    const extractedPaths = this.pathTracker.getExtractedPaths()
    this.extractedPaths = new Set(extractedPaths.map((p) => p.path))

    // Initialize columns
    for (const path of this.extractedPaths) {
      this.columns.set(path, [])
    }

    // Process all records into columns
    const newDynamic: JSONObject[] = []

    for (const data of this.dynamicData) {
      // Extract values for each extracted path
      for (const path of this.extractedPaths) {
        const value = getPath(data, path)
        this.columns.get(path)!.push(value ?? null)
      }

      // Store unextracted paths in dynamic data
      const dynamic: JSONObject = {}
      const allPaths = extractPaths(data)
      for (const [path] of allPaths) {
        if (!this.extractedPaths.has(path) && !path.includes('[*]')) {
          const value = getPath(data, path)
          if (value !== undefined && typeof value !== 'object') {
            setPath(dynamic, path, value)
          }
        }
      }
      newDynamic.push(dynamic)
    }

    this.dynamicData = newDynamic
  }

  /**
   * Flush to storage (simulated SQLite rows)
   */
  flush(): void {
    // Finalize path extraction before writing
    this.finalizeExtraction()

    // Write _ids column
    this.rows.set('_ids', JSON.stringify(this.ids))
    this.writeCount++

    // Write path metadata
    const pathStats = this.pathTracker.getAllStats()
    this.rows.set('_paths', JSON.stringify(pathStats))
    this.writeCount++

    // Write each extracted column as separate row
    for (const [path, values] of this.columns) {
      this.rows.set(`col:${path}`, JSON.stringify(values))
      this.writeCount++
    }

    // Write dynamic data for unextracted paths
    this.rows.set('_dynamic', JSON.stringify(this.dynamicData))
    this.writeCount++
  }

  /**
   * Load specific columns only (projection pushdown!)
   */
  private loadColumn(name: string): void {
    const data = this.rows.get(name)
    if (!data) return
    this.readCount++

    if (name === '_ids') {
      this.ids = JSON.parse(data)
    } else if (name === '_dynamic') {
      this.dynamicData = JSON.parse(data)
    } else if (name.startsWith('col:')) {
      const path = name.slice(4)
      this.columns.set(path, JSON.parse(data))
    }
  }

  /**
   * Query with projection pushdown
   *
   * Only loads columns needed for the query
   */
  query(
    paths: string[],
    filter?: (record: JSONObject) => boolean
  ): Array<{ id: string; data: JSONObject }> {
    // Always load _ids
    if (this.ids.length === 0 && this.rows.has('_ids')) {
      this.loadColumn('_ids')
    }

    // Load only requested columns
    for (const path of paths) {
      if (this.extractedPaths.has(path)) {
        if (!this.columns.has(path) || this.columns.get(path)!.length === 0) {
          this.loadColumn(`col:${path}`)
        }
      }
    }

    // Check if we need dynamic data
    const needsDynamic = paths.some((p) => !this.extractedPaths.has(p))
    if (needsDynamic && this.dynamicData.length === 0 && this.rows.has('_dynamic')) {
      this.loadColumn('_dynamic')
    }

    // Build results
    const results: Array<{ id: string; data: JSONObject }> = []

    for (let i = 0; i < this.ids.length; i++) {
      const record: JSONObject = {}

      // Get values from extracted columns
      for (const path of paths) {
        const column = this.columns.get(path)
        if (column && column[i] !== null && column[i] !== undefined) {
          setPath(record, path, column[i])
        } else if (this.dynamicData[i]) {
          // Try dynamic data
          const value = getPath(this.dynamicData[i], path)
          if (value !== undefined) {
            setPath(record, path, value)
          }
        }
      }

      // Apply filter if provided
      if (!filter || filter(record)) {
        results.push({ id: this.ids[i], data: record })
      }
    }

    return results
  }

  /**
   * Get specific paths for a single record
   */
  get(id: string, paths: string[]): JSONObject | null {
    // Load _ids
    if (this.ids.length === 0 && this.rows.has('_ids')) {
      this.loadColumn('_ids')
    }

    const index = this.ids.indexOf(id)
    if (index === -1) return null

    // Load only requested columns
    for (const path of paths) {
      if (this.extractedPaths.has(path)) {
        if (!this.columns.has(path) || this.columns.get(path)!.length === 0) {
          this.loadColumn(`col:${path}`)
        }
      }
    }

    // Check if we need dynamic data
    const needsDynamic = paths.some((p) => !this.extractedPaths.has(p))
    if (needsDynamic && this.dynamicData.length === 0 && this.rows.has('_dynamic')) {
      this.loadColumn('_dynamic')
    }

    // Build result
    const record: JSONObject = {}
    for (const path of paths) {
      const column = this.columns.get(path)
      if (column && column[index] !== null && column[index] !== undefined) {
        setPath(record, path, column[index])
      } else if (this.dynamicData[index]) {
        const value = getPath(this.dynamicData[index], path)
        if (value !== undefined) {
          setPath(record, path, value)
        }
      }
    }

    return record
  }

  /**
   * Aggregate query on a specific path
   */
  aggregate(
    path: string,
    operation: 'sum' | 'avg' | 'min' | 'max' | 'count'
  ): number {
    // Only load the needed column
    if (this.extractedPaths.has(path)) {
      if (!this.columns.has(path) || this.columns.get(path)!.length === 0) {
        this.loadColumn(`col:${path}`)
      }
    } else if (this.dynamicData.length === 0 && this.rows.has('_dynamic')) {
      this.loadColumn('_dynamic')
    }

    const column = this.columns.get(path)
    const values: number[] = []

    if (column) {
      for (const v of column) {
        if (typeof v === 'number') values.push(v)
      }
    } else {
      // Fall back to dynamic data
      for (const dynamic of this.dynamicData) {
        const v = getPath(dynamic, path)
        if (typeof v === 'number') values.push(v)
      }
    }

    if (values.length === 0) return 0

    switch (operation) {
      case 'sum':
        return values.reduce((a, b) => a + b, 0)
      case 'avg':
        return values.reduce((a, b) => a + b, 0) / values.length
      case 'min':
        return Math.min(...values)
      case 'max':
        return Math.max(...values)
      case 'count':
        return values.length
    }
  }

  /**
   * Get count without loading data
   */
  count(): number {
    if (this.ids.length > 0) return this.ids.length
    if (this.rows.has('_ids')) {
      this.loadColumn('_ids')
      return this.ids.length
    }
    return 0
  }

  /**
   * Get extracted column names
   */
  getExtractedColumns(): string[] {
    return Array.from(this.extractedPaths)
  }

  /**
   * Get path statistics
   */
  getPathStatistics(): PathStatistics[] {
    return this.pathTracker.getAllStats()
  }

  /**
   * Get storage statistics
   */
  getStats(): {
    readCount: number
    writeCount: number
    columnCount: number
    recordCount: number
    bytesStored: number
    extractedPaths: string[]
  } {
    let bytesStored = 0
    for (const data of this.rows.values()) {
      bytesStored += data.length
    }

    return {
      readCount: this.readCount,
      writeCount: this.writeCount,
      columnCount: this.rows.size,
      recordCount: this.ids.length || this.pathTracker.getRecordCount(),
      bytesStored,
      extractedPaths: Array.from(this.extractedPaths),
    }
  }

  /**
   * Reset storage
   */
  reset(): void {
    this.ids = []
    this.columns.clear()
    this.dynamicData = []
    this.extractedPaths.clear()
    this.rows.clear()
    this.readCount = 0
    this.writeCount = 0
  }

  /**
   * Generate SQL for DO SQLite
   */
  static createTableSQL(tableName: string): string {
    return `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        column_name TEXT PRIMARY KEY,
        column_data BLOB NOT NULL,
        column_type TEXT NOT NULL,
        record_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `
  }

  /**
   * Cost analysis for various queries
   */
  static queryCostAnalysis(
    recordCount: number,
    totalPaths: number,
    extractedPaths: number
  ): Array<{
    query: string
    rowPerRecord: number
    jsonColumnar: number
    savings: string
  }> {
    return [
      {
        query: 'SELECT COUNT(*)',
        rowPerRecord: recordCount,
        jsonColumnar: 1, // Just _ids
        savings: `${Math.round((1 - 1 / recordCount) * 100)}%`,
      },
      {
        query: 'SELECT data.user.email',
        rowPerRecord: recordCount,
        jsonColumnar: 2, // _ids + col:data.user.email
        savings: `${Math.round((1 - 2 / recordCount) * 100)}%`,
      },
      {
        query: 'SELECT data.user.email, data.user.name',
        rowPerRecord: recordCount,
        jsonColumnar: 3, // _ids + 2 columns
        savings: `${Math.round((1 - 3 / recordCount) * 100)}%`,
      },
      {
        query: "SELECT data.user.email WHERE data.amount > 100",
        rowPerRecord: recordCount,
        jsonColumnar: 3, // _ids + 2 columns for filter + projection
        savings: `${Math.round((1 - 3 / recordCount) * 100)}%`,
      },
      {
        query: 'SELECT SUM(data.amount)',
        rowPerRecord: recordCount,
        jsonColumnar: 1, // Just the amount column
        savings: `${Math.round((1 - 1 / recordCount) * 100)}%`,
      },
      {
        query: 'SELECT * (all paths)',
        rowPerRecord: recordCount,
        jsonColumnar: extractedPaths + 3, // All columns + _ids + _paths + _dynamic
        savings: `${Math.round((1 - (extractedPaths + 3) / recordCount) * 100)}%`,
      },
      {
        query: `INSERT ${recordCount} records`,
        rowPerRecord: recordCount,
        jsonColumnar: extractedPaths + 3, // One write per column
        savings: `${Math.round((1 - (extractedPaths + 3) / recordCount) * 100)}%`,
      },
    ]
  }
}

// ============================================================================
// Typed Column Store (for numeric/string paths)
// ============================================================================

/**
 * Specialized columnar storage for typed paths
 *
 * Uses typed arrays for numeric paths for better compression and performance
 */
export class TypedColumnStore {
  private stringColumns: Map<string, string[]> = new Map()
  private numberColumns: Map<string, Float64Array> = new Map()
  private boolColumns: Map<string, Uint8Array> = new Map()
  private nullMasks: Map<string, Uint8Array> = new Map() // Bit mask for nulls
  private recordCount = 0

  /**
   * Add a string column
   */
  addStringColumn(path: string, values: (string | null)[]): void {
    const strings: string[] = []
    const nullMask = new Uint8Array(Math.ceil(values.length / 8))

    for (let i = 0; i < values.length; i++) {
      if (values[i] === null) {
        nullMask[Math.floor(i / 8)] |= 1 << (i % 8)
        strings.push('')
      } else {
        strings.push(values[i]!)
      }
    }

    this.stringColumns.set(path, strings)
    this.nullMasks.set(`${path}:null`, nullMask)
    this.recordCount = Math.max(this.recordCount, values.length)
  }

  /**
   * Add a numeric column using Float64Array
   */
  addNumberColumn(path: string, values: (number | null)[]): void {
    const numbers = new Float64Array(values.length)
    const nullMask = new Uint8Array(Math.ceil(values.length / 8))

    for (let i = 0; i < values.length; i++) {
      if (values[i] === null) {
        nullMask[Math.floor(i / 8)] |= 1 << (i % 8)
        numbers[i] = NaN
      } else {
        numbers[i] = values[i]!
      }
    }

    this.numberColumns.set(path, numbers)
    this.nullMasks.set(`${path}:null`, nullMask)
    this.recordCount = Math.max(this.recordCount, values.length)
  }

  /**
   * Add a boolean column using Uint8Array (packed bits)
   */
  addBoolColumn(path: string, values: (boolean | null)[]): void {
    const bools = new Uint8Array(Math.ceil(values.length / 8))
    const nullMask = new Uint8Array(Math.ceil(values.length / 8))

    for (let i = 0; i < values.length; i++) {
      if (values[i] === null) {
        nullMask[Math.floor(i / 8)] |= 1 << (i % 8)
      } else if (values[i]) {
        bools[Math.floor(i / 8)] |= 1 << (i % 8)
      }
    }

    this.boolColumns.set(path, bools)
    this.nullMasks.set(`${path}:null`, nullMask)
    this.recordCount = Math.max(this.recordCount, values.length)
  }

  /**
   * Get string value at index
   */
  getString(path: string, index: number): string | null {
    const nullMask = this.nullMasks.get(`${path}:null`)
    if (nullMask && (nullMask[Math.floor(index / 8)] & (1 << (index % 8)))) {
      return null
    }
    return this.stringColumns.get(path)?.[index] ?? null
  }

  /**
   * Get number value at index
   */
  getNumber(path: string, index: number): number | null {
    const nullMask = this.nullMasks.get(`${path}:null`)
    if (nullMask && (nullMask[Math.floor(index / 8)] & (1 << (index % 8)))) {
      return null
    }
    const value = this.numberColumns.get(path)?.[index]
    return value !== undefined && !isNaN(value) ? value : null
  }

  /**
   * Get boolean value at index
   */
  getBool(path: string, index: number): boolean | null {
    const nullMask = this.nullMasks.get(`${path}:null`)
    if (nullMask && (nullMask[Math.floor(index / 8)] & (1 << (index % 8)))) {
      return null
    }
    const bools = this.boolColumns.get(path)
    if (!bools) return null
    return Boolean(bools[Math.floor(index / 8)] & (1 << (index % 8)))
  }

  /**
   * Sum a numeric column (vectorized)
   */
  sum(path: string): number {
    const numbers = this.numberColumns.get(path)
    if (!numbers) return 0

    let sum = 0
    for (let i = 0; i < numbers.length; i++) {
      if (!isNaN(numbers[i])) sum += numbers[i]
    }
    return sum
  }

  /**
   * Get memory usage
   */
  getMemoryUsage(): {
    stringBytes: number
    numberBytes: number
    boolBytes: number
    nullMaskBytes: number
    total: number
  } {
    let stringBytes = 0
    for (const strings of this.stringColumns.values()) {
      for (const s of strings) {
        stringBytes += s.length * 2 // UTF-16
      }
    }

    let numberBytes = 0
    for (const numbers of this.numberColumns.values()) {
      numberBytes += numbers.byteLength
    }

    let boolBytes = 0
    for (const bools of this.boolColumns.values()) {
      boolBytes += bools.byteLength
    }

    let nullMaskBytes = 0
    for (const mask of this.nullMasks.values()) {
      nullMaskBytes += mask.byteLength
    }

    return {
      stringBytes,
      numberBytes,
      boolBytes,
      nullMaskBytes,
      total: stringBytes + numberBytes + boolBytes + nullMaskBytes,
    }
  }
}

// ============================================================================
// Schema Evolution Handler
// ============================================================================

/**
 * Handles schema evolution in columnar JSON storage
 *
 * When new paths appear or types change, manages column creation/migration
 */
export class SchemaEvolutionHandler {
  private schema: Map<string, ColumnConfig> = new Map()
  private version = 0

  /**
   * Detect schema changes from new data
   */
  detectChanges(
    currentStats: PathStatistics[],
    extractionThreshold: number
  ): {
    newColumns: string[]
    typeChanges: Array<{ path: string; from: JSONType; to: JSONType }>
    removedColumns: string[]
  } {
    const newColumns: string[] = []
    const typeChanges: Array<{ path: string; from: JSONType; to: JSONType }> = []
    const removedColumns: string[] = []
    const seenPaths = new Set<string>()

    for (const stats of currentStats) {
      seenPaths.add(stats.path)
      const existing = this.schema.get(stats.path)

      if (!existing) {
        // New path
        if (stats.frequency >= extractionThreshold && stats.type !== 'object' && stats.type !== 'array') {
          newColumns.push(stats.path)
        }
      } else if (existing.type !== stats.type) {
        // Type changed
        typeChanges.push({
          path: stats.path,
          from: existing.type,
          to: stats.type,
        })
      }
    }

    // Check for removed columns
    for (const [path, config] of this.schema) {
      if (!seenPaths.has(path) && config.isExtracted) {
        removedColumns.push(path)
      }
    }

    return { newColumns, typeChanges, removedColumns }
  }

  /**
   * Apply schema changes
   */
  applyChanges(
    newColumns: string[],
    stats: PathStatistics[],
    extractionThreshold: number
  ): void {
    for (const path of newColumns) {
      const pathStats = stats.find((s) => s.path === path)
      if (pathStats) {
        this.schema.set(path, {
          path,
          type: pathStats.type,
          nullable: pathStats.frequency < 1.0,
          extractionThreshold,
        })
      }
    }
    this.version++
  }

  /**
   * Get current schema
   */
  getSchema(): Map<string, ColumnConfig> {
    return new Map(this.schema)
  }

  /**
   * Get schema version
   */
  getVersion(): number {
    return this.version
  }
}
