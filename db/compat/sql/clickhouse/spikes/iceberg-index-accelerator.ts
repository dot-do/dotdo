/**
 * SPIKE: DO Query Accelerator for Iceberg Cold Storage
 *
 * Architecture: DO maintains columnar indexes over R2 Iceberg data
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  DO SQLite (Hot Index Layer)         R2 Iceberg (Cold Data)            │
 * │  ┌────────────────────────────┐     ┌────────────────────────────────┐ │
 * │  │ Index Columns:              │     │ Full Data:                     │ │
 * │  │ • _ids (all IDs)            │     │ • things/type=User/*.parquet   │ │
 * │  │ • _types (all types)        │────▶│ • things/type=Order/*.parquet  │ │
 * │  │ • _partitions (manifest)    │     │ • relationships/*.parquet      │ │
 * │  │ • bloom:data.email          │     │                                │ │
 * │  │ • minmax:createdAt          │     │ Partitioned by type + day      │ │
 * │  │ • stats:cardinality         │     │ ~100ms access                  │ │
 * │  └────────────────────────────┘     └────────────────────────────────┘ │
 * │  <1ms access, ~100MB index                                             │
 * │                                                                         │
 * │  Query Flow:                                                            │
 * │  1. Parse SQL → Extract predicates                                      │
 * │  2. Check DO indexes → Prune partitions                                 │
 * │  3. Fetch columns from R2 → Only what's needed                          │
 * │  4. Execute query → Vectorized on fetched data                          │
 * │  5. Cache hot columns → Accelerate repeated queries                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Cost Analysis (10M Things):
 * - Traditional: Scan all 10M rows = $$$
 * - With Accelerator:
 *   - COUNT(*) → 1 DO row read ($0.000001)
 *   - WHERE type = 'x' → 2 DO rows + targeted R2 partition
 *   - WHERE data.email = 'x' → Bloom check + maybe 0 R2 fetches
 */

// ============================================================================
// Types
// ============================================================================

export interface Thing {
  id: string
  type: string
  ns: string
  data: Record<string, unknown>
  embedding?: Float32Array
  createdAt: number
  updatedAt: number
}

export interface Relationship {
  id: string
  type: string
  from: string
  to: string
  data?: Record<string, unknown>
  createdAt: number
}

export interface IcebergPartition {
  partitionKey: string // e.g., "type=User/dt=2024-01-15"
  dataFile: string // R2 path to Parquet file
  rowCount: number
  sizeBytes: number
  minValues: Record<string, unknown>
  maxValues: Record<string, unknown>
  nullCounts: Record<string, number>
}

export interface IndexStats {
  totalRows: number
  partitionCount: number
  bloomFilters: string[] // Columns with bloom filters
  minMaxColumns: string[] // Columns with min/max stats
  lastSyncedAt: number
  coldDataSizeBytes: number
}

// ============================================================================
// Bloom Filter (simplified)
// ============================================================================

export class BloomFilter {
  private bits: Uint8Array
  private hashCount: number
  private size: number

  constructor(expectedItems: number, fpr = 0.01) {
    // Calculate optimal size and hash count
    this.size = Math.ceil((-expectedItems * Math.log(fpr)) / (Math.log(2) ** 2))
    this.hashCount = Math.ceil((this.size / expectedItems) * Math.log(2))
    this.bits = new Uint8Array(Math.ceil(this.size / 8))
  }

  private hash(value: string, seed: number): number {
    let h = seed
    for (let i = 0; i < value.length; i++) {
      h = (h * 31 + value.charCodeAt(i)) >>> 0
    }
    return h % this.size
  }

  add(value: string): void {
    for (let i = 0; i < this.hashCount; i++) {
      const idx = this.hash(value, i)
      this.bits[Math.floor(idx / 8)] |= 1 << (idx % 8)
    }
  }

  mightContain(value: string): boolean {
    for (let i = 0; i < this.hashCount; i++) {
      const idx = this.hash(value, i)
      if (!(this.bits[Math.floor(idx / 8)] & (1 << (idx % 8)))) {
        return false // Definitely not in set
      }
    }
    return true // Maybe in set
  }

  serialize(): Uint8Array {
    const header = new Uint8Array(8)
    const view = new DataView(header.buffer)
    view.setUint32(0, this.size, true)
    view.setUint32(4, this.hashCount, true)

    const result = new Uint8Array(header.length + this.bits.length)
    result.set(header)
    result.set(this.bits, header.length)
    return result
  }

  static deserialize(data: Uint8Array): BloomFilter {
    const view = new DataView(data.buffer, data.byteOffset)
    const size = view.getUint32(0, true)
    const hashCount = view.getUint32(4, true)

    const filter = new BloomFilter(1) // Dummy constructor
    filter.size = size
    filter.hashCount = hashCount
    filter.bits = data.slice(8)
    return filter
  }
}

// ============================================================================
// Min/Max Statistics
// ============================================================================

export interface MinMaxStats {
  column: string
  partitionKey: string
  minValue: unknown
  maxValue: unknown
  nullCount: number
  rowCount: number
}

export class MinMaxIndex {
  private stats: Map<string, MinMaxStats[]> = new Map() // column -> partition stats

  addPartitionStats(column: string, stats: MinMaxStats): void {
    if (!this.stats.has(column)) {
      this.stats.set(column, [])
    }
    this.stats.get(column)!.push(stats)
  }

  /**
   * Find partitions that might contain a value
   * Returns partition keys that pass the filter
   */
  findPartitions(column: string, predicate: Predicate): string[] {
    const columnStats = this.stats.get(column)
    if (!columnStats) return [] // Column not indexed, must scan all

    const matching: string[] = []

    for (const stat of columnStats) {
      if (this.mightMatch(stat, predicate)) {
        matching.push(stat.partitionKey)
      }
    }

    return matching
  }

  private mightMatch(stat: MinMaxStats, predicate: Predicate): boolean {
    const { minValue, maxValue } = stat

    switch (predicate.op) {
      case '=':
        // Value must be within [min, max] range
        return this.compare(predicate.value, minValue) >= 0 && this.compare(predicate.value, maxValue) <= 0
      case '>':
        return this.compare(maxValue, predicate.value) > 0
      case '>=':
        return this.compare(maxValue, predicate.value) >= 0
      case '<':
        return this.compare(minValue, predicate.value) < 0
      case '<=':
        return this.compare(minValue, predicate.value) <= 0
      case 'BETWEEN':
        const [low, high] = predicate.value as [unknown, unknown]
        return this.compare(maxValue, low) >= 0 && this.compare(minValue, high) <= 0
      default:
        return true // Can't prune, must scan
    }
  }

  private compare(a: unknown, b: unknown): number {
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b)
    }
    return 0
  }

  serialize(): string {
    const obj: Record<string, MinMaxStats[]> = {}
    for (const [column, stats] of this.stats) {
      obj[column] = stats
    }
    return JSON.stringify(obj)
  }

  static deserialize(json: string): MinMaxIndex {
    const obj = JSON.parse(json)
    const index = new MinMaxIndex()
    for (const [column, stats] of Object.entries(obj)) {
      for (const stat of stats as MinMaxStats[]) {
        index.addPartitionStats(column, stat)
      }
    }
    return index
  }
}

export interface Predicate {
  column: string
  op: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'IN' | 'BETWEEN' | 'LIKE' | 'IS NULL' | 'IS NOT NULL'
  value: unknown
}

// ============================================================================
// Iceberg Index Accelerator
// ============================================================================

/**
 * DO-based query accelerator for Iceberg cold storage
 *
 * Maintains columnar indexes in DO SQLite that enable:
 * 1. Fast COUNT/EXISTS queries without touching R2
 * 2. Partition pruning for filtered queries
 * 3. Bloom filter lookups for high-cardinality columns
 * 4. Column caching for repeated queries
 */
export class IcebergIndexAccelerator {
  // Columnar index storage (simulated SQLite rows)
  private indexRows: Map<string, string | Uint8Array> = new Map()

  // In-memory caches
  private idIndex: Set<string> = new Set()
  private typeIndex: Map<string, Set<string>> = new Map() // type -> Set<id>
  private partitionManifest: IcebergPartition[] = []
  private bloomFilters: Map<string, BloomFilter> = new Map() // column -> bloom
  private minMaxIndex = new MinMaxIndex()

  // Statistics
  private totalRows = 0
  private readCount = 0
  private writeCount = 0
  private r2FetchCount = 0

  // Column cache (for recently accessed cold data)
  private columnCache: Map<string, Record<string, unknown[]>> = new Map()
  private cacheMaxBytes = 50 * 1024 * 1024 // 50MB cache limit

  /**
   * Initialize from Iceberg manifest
   */
  async syncFromManifest(manifest: IcebergManifest): Promise<void> {
    // Extract partition info from manifest
    this.partitionManifest = manifest.entries.map((entry) => ({
      partitionKey: entry.partitionKey,
      dataFile: entry.dataFile,
      rowCount: entry.rowCount,
      sizeBytes: entry.sizeBytes,
      minValues: entry.lowerBounds,
      maxValues: entry.upperBounds,
      nullCounts: entry.nullCounts,
    }))

    // Update min/max index from manifest
    for (const partition of this.partitionManifest) {
      for (const [column, minVal] of Object.entries(partition.minValues)) {
        this.minMaxIndex.addPartitionStats(column, {
          column,
          partitionKey: partition.partitionKey,
          minValue: minVal,
          maxValue: partition.maxValues[column],
          nullCount: partition.nullCounts[column] ?? 0,
          rowCount: partition.rowCount,
        })
      }
    }

    // Calculate totals
    this.totalRows = this.partitionManifest.reduce((sum, p) => sum + p.rowCount, 0)

    // Store index data as columnar rows
    this.indexRows.set('_manifest', JSON.stringify(this.partitionManifest))
    this.indexRows.set('_minmax', this.minMaxIndex.serialize())
    this.indexRows.set(
      '_stats',
      JSON.stringify({
        totalRows: this.totalRows,
        partitionCount: this.partitionManifest.length,
        lastSyncedAt: Date.now(),
      })
    )
    this.writeCount += 3
  }

  /**
   * Add bloom filter for a column (built from full scan)
   */
  addBloomFilter(column: string, values: string[]): void {
    const filter = new BloomFilter(values.length, 0.01)
    for (const value of values) {
      filter.add(value)
    }
    this.bloomFilters.set(column, filter)
    this.indexRows.set(`bloom:${column}`, filter.serialize())
    this.writeCount++
  }

  /**
   * Index IDs for fast existence checks
   */
  indexIds(ids: string[]): void {
    for (const id of ids) {
      this.idIndex.add(id)
    }
    this.indexRows.set('_ids', JSON.stringify(Array.from(this.idIndex)))
    this.writeCount++
  }

  /**
   * Index types for fast type filtering
   */
  indexTypes(typeToIds: Map<string, string[]>): void {
    for (const [type, ids] of typeToIds) {
      this.typeIndex.set(type, new Set(ids))
    }
    const serialized: Record<string, string[]> = {}
    for (const [type, ids] of this.typeIndex) {
      serialized[type] = Array.from(ids)
    }
    this.indexRows.set('_types', JSON.stringify(serialized))
    this.writeCount++
  }

  // ============================================================================
  // Query Execution
  // ============================================================================

  /**
   * Execute a query using indexes + cold storage
   *
   * Returns: { result, stats }
   */
  async executeQuery(
    query: ParsedQuery,
    fetchFromR2: (file: string, columns: string[]) => Promise<Record<string, unknown[]>>
  ): Promise<QueryResult> {
    const startTime = performance.now()
    const queryStats: QueryStats = {
      indexRowsRead: 0,
      r2PartitionsFetched: 0,
      r2BytesFetched: 0,
      rowsScanned: 0,
      rowsReturned: 0,
      cacheHits: 0,
      executionTimeMs: 0,
    }

    // Step 1: Check if query can be answered from index alone
    if (this.canAnswerFromIndex(query)) {
      const result = this.executeFromIndex(query)
      queryStats.indexRowsRead = this.readCount
      queryStats.executionTimeMs = performance.now() - startTime
      return { data: result, stats: queryStats }
    }

    // Step 2: Use index to prune partitions
    const partitionsToScan = this.prunePartitions(query.predicates)
    queryStats.indexRowsRead = this.readCount

    if (partitionsToScan.length === 0) {
      // No partitions match - return empty
      queryStats.executionTimeMs = performance.now() - startTime
      return { data: [], stats: queryStats }
    }

    // Step 3: Check bloom filters for equality predicates
    const bloomResult = this.checkBloomFilters(query.predicates)
    if (bloomResult === 'definitely_not_exists') {
      queryStats.executionTimeMs = performance.now() - startTime
      return { data: [], stats: queryStats }
    }

    // Step 4: Fetch required columns from R2
    const requiredColumns = this.extractRequiredColumns(query)
    const columnData: Record<string, unknown[]> = {}

    for (const partition of partitionsToScan) {
      // Check column cache first
      const cacheKey = `${partition.partitionKey}:${requiredColumns.join(',')}`
      if (this.columnCache.has(cacheKey)) {
        queryStats.cacheHits++
        const cached = this.columnCache.get(cacheKey)!
        this.mergeColumnData(columnData, cached)
        continue
      }

      // Fetch from R2
      const partitionData = await fetchFromR2(partition.dataFile, requiredColumns)
      queryStats.r2PartitionsFetched++
      queryStats.r2BytesFetched += partition.sizeBytes

      // Cache the fetched data
      this.cacheColumnData(cacheKey, partitionData)

      this.mergeColumnData(columnData, partitionData)
    }

    // Step 5: Execute query on fetched data
    const result = this.executeOnColumnData(query, columnData)
    queryStats.rowsScanned = Object.values(columnData)[0]?.length ?? 0
    queryStats.rowsReturned = result.length
    queryStats.executionTimeMs = performance.now() - startTime

    return { data: result, stats: queryStats }
  }

  /**
   * Check if query can be fully answered from index
   */
  private canAnswerFromIndex(query: ParsedQuery): boolean {
    // COUNT(*) without complex filters
    if (query.isCountOnly && query.predicates.length === 0) {
      return true
    }

    // COUNT(*) WHERE type = 'x' (if type is indexed)
    if (
      query.isCountOnly &&
      query.predicates.length === 1 &&
      query.predicates[0].column === 'type' &&
      query.predicates[0].op === '='
    ) {
      return true
    }

    // EXISTS(id) check
    if (query.isExistsOnly && query.predicates.length === 1 && query.predicates[0].column === 'id') {
      return true
    }

    return false
  }

  /**
   * Execute query entirely from index
   */
  private executeFromIndex(query: ParsedQuery): unknown[] {
    this.readCount++

    if (query.isCountOnly) {
      if (query.predicates.length === 0) {
        // COUNT(*)
        return [{ count: this.totalRows }]
      }

      // COUNT(*) WHERE type = 'x'
      const typePredicate = query.predicates[0]
      const typeIds = this.typeIndex.get(typePredicate.value as string)
      return [{ count: typeIds?.size ?? 0 }]
    }

    if (query.isExistsOnly) {
      const idPredicate = query.predicates[0]
      return [{ exists: this.idIndex.has(idPredicate.value as string) }]
    }

    return []
  }

  /**
   * Use index to determine which partitions to scan
   */
  private prunePartitions(predicates: Predicate[]): IcebergPartition[] {
    if (predicates.length === 0) {
      return this.partitionManifest
    }

    let candidates = new Set(this.partitionManifest.map((p) => p.partitionKey))

    for (const predicate of predicates) {
      // Use min/max index for range predicates
      const matchingPartitions = this.minMaxIndex.findPartitions(predicate.column, predicate)
      if (matchingPartitions.length > 0) {
        candidates = new Set([...candidates].filter((p) => matchingPartitions.includes(p)))
        this.readCount++ // Read min/max index
      }

      // Use type index for type equality
      if (predicate.column === 'type' && predicate.op === '=') {
        const typePartitions = this.partitionManifest.filter(
          (p) => p.partitionKey.includes(`type=${predicate.value}`) || p.minValues.type === predicate.value
        )
        candidates = new Set(typePartitions.map((p) => p.partitionKey))
        this.readCount++ // Read type index
      }
    }

    return this.partitionManifest.filter((p) => candidates.has(p.partitionKey))
  }

  /**
   * Check bloom filters for equality predicates
   */
  private checkBloomFilters(predicates: Predicate[]): 'definitely_not_exists' | 'maybe_exists' {
    for (const predicate of predicates) {
      if (predicate.op === '=') {
        const bloom = this.bloomFilters.get(predicate.column)
        if (bloom) {
          this.readCount++ // Read bloom filter
          if (!bloom.mightContain(String(predicate.value))) {
            return 'definitely_not_exists'
          }
        }
      }
    }
    return 'maybe_exists'
  }

  /**
   * Extract columns needed for query execution
   */
  private extractRequiredColumns(query: ParsedQuery): string[] {
    const columns = new Set<string>()

    // Projection columns
    for (const col of query.select) {
      columns.add(col)
    }

    // Filter columns
    for (const pred of query.predicates) {
      columns.add(pred.column)
    }

    // Order by columns
    for (const col of query.orderBy ?? []) {
      columns.add(col)
    }

    // Group by columns
    for (const col of query.groupBy ?? []) {
      columns.add(col)
    }

    // Aggregation columns (e.g., sum(amount) needs 'amount')
    for (const agg of query.aggregations ?? []) {
      if (agg.column) {
        columns.add(agg.column)
      }
    }

    return Array.from(columns)
  }

  /**
   * Merge partition data into combined column data
   */
  private mergeColumnData(target: Record<string, unknown[]>, source: Record<string, unknown[]>): void {
    for (const [col, values] of Object.entries(source)) {
      if (!target[col]) {
        target[col] = []
      }
      target[col].push(...values)
    }
  }

  /**
   * Cache column data with LRU eviction
   */
  private cacheColumnData(key: string, data: Record<string, unknown[]>): void {
    const size = JSON.stringify(data).length
    if (size > this.cacheMaxBytes / 2) {
      return // Don't cache if too large
    }

    // Simple eviction: clear cache if full
    if (this.estimateCacheSize() + size > this.cacheMaxBytes) {
      this.columnCache.clear()
    }

    this.columnCache.set(key, data)
  }

  private estimateCacheSize(): number {
    let size = 0
    for (const data of this.columnCache.values()) {
      size += JSON.stringify(data).length
    }
    return size
  }

  /**
   * Execute query on fetched column data
   */
  private executeOnColumnData(query: ParsedQuery, columnData: Record<string, unknown[]>): unknown[] {
    const rowCount = Object.values(columnData)[0]?.length ?? 0
    if (rowCount === 0) return []

    // Build result rows
    const results: Record<string, unknown>[] = []

    for (let i = 0; i < rowCount; i++) {
      // Apply filters
      let passesFilter = true
      for (const pred of query.predicates) {
        const value = columnData[pred.column]?.[i]
        if (!this.evaluatePredicate(value, pred)) {
          passesFilter = false
          break
        }
      }

      if (passesFilter) {
        const row: Record<string, unknown> = {}
        // Include all fetched columns (not just select) so aggregations have access to their columns
        for (const col of Object.keys(columnData)) {
          row[col] = columnData[col]?.[i]
        }
        results.push(row)
      }
    }

    // Apply aggregations if needed
    if (query.groupBy && query.groupBy.length > 0) {
      return this.aggregate(results, query.groupBy, query.aggregations ?? [])
    }

    // Apply order by
    if (query.orderBy && query.orderBy.length > 0) {
      results.sort((a, b) => {
        for (const col of query.orderBy!) {
          const cmp = this.compareValues(a[col], b[col])
          if (cmp !== 0) return cmp
        }
        return 0
      })
    }

    // Apply limit
    if (query.limit) {
      return results.slice(0, query.limit)
    }

    return results
  }

  private evaluatePredicate(value: unknown, predicate: Predicate): boolean {
    switch (predicate.op) {
      case '=':
        return value === predicate.value
      case '!=':
        return value !== predicate.value
      case '>':
        return (value as number) > (predicate.value as number)
      case '>=':
        return (value as number) >= (predicate.value as number)
      case '<':
        return (value as number) < (predicate.value as number)
      case '<=':
        return (value as number) <= (predicate.value as number)
      case 'IN':
        return (predicate.value as unknown[]).includes(value)
      case 'IS NULL':
        return value == null
      case 'IS NOT NULL':
        return value != null
      default:
        return true
    }
  }

  private compareValues(a: unknown, b: unknown): number {
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b)
    }
    return 0
  }

  private aggregate(
    rows: Record<string, unknown>[],
    groupBy: string[],
    aggregations: Aggregation[]
  ): Record<string, unknown>[] {
    const groups = new Map<string, Record<string, unknown>[]>()

    // Group rows
    for (const row of rows) {
      const key = groupBy.map((col) => String(row[col])).join('\x00')
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(row)
    }

    // Compute aggregations
    const results: Record<string, unknown>[] = []

    for (const [key, groupRows] of groups) {
      const result: Record<string, unknown> = {}

      // Add group by columns
      const keyParts = key.split('\x00')
      for (let i = 0; i < groupBy.length; i++) {
        result[groupBy[i]] = keyParts[i]
      }

      // Compute aggregations
      for (const agg of aggregations) {
        result[agg.alias] = this.computeAggregation(groupRows, agg)
      }

      results.push(result)
    }

    return results
  }

  private computeAggregation(rows: Record<string, unknown>[], agg: Aggregation): unknown {
    switch (agg.function) {
      case 'count':
        return rows.length
      case 'sum':
        return rows.reduce((sum, row) => sum + ((row[agg.column!] as number) ?? 0), 0)
      case 'avg': {
        const sum = rows.reduce((s, row) => s + ((row[agg.column!] as number) ?? 0), 0)
        return sum / rows.length
      }
      case 'min':
        return Math.min(...rows.map((row) => (row[agg.column!] as number) ?? Infinity))
      case 'max':
        return Math.max(...rows.map((row) => (row[agg.column!] as number) ?? -Infinity))
      default:
        return null
    }
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  getStats(): IndexStats {
    return {
      totalRows: this.totalRows,
      partitionCount: this.partitionManifest.length,
      bloomFilters: Array.from(this.bloomFilters.keys()),
      minMaxColumns: [], // Would extract from minMaxIndex
      lastSyncedAt: Date.now(),
      coldDataSizeBytes: this.partitionManifest.reduce((sum, p) => sum + p.sizeBytes, 0),
    }
  }

  getQueryStats(): { readCount: number; writeCount: number; r2FetchCount: number } {
    return {
      readCount: this.readCount,
      writeCount: this.writeCount,
      r2FetchCount: this.r2FetchCount,
    }
  }

  /**
   * Cost analysis comparing index-accelerated vs full scan
   */
  static costAnalysis(totalRows: number, partitions: number): CostComparison[] {
    return [
      {
        query: 'SELECT COUNT(*)',
        fullScan: { r2Fetches: partitions, rowsRead: totalRows, estimatedCost: partitions * 0.0004 },
        accelerated: { indexReads: 1, r2Fetches: 0, estimatedCost: 0.000001 },
        savings: '99.99%',
      },
      {
        query: "SELECT COUNT(*) WHERE type = 'User'",
        fullScan: { r2Fetches: partitions, rowsRead: totalRows, estimatedCost: partitions * 0.0004 },
        accelerated: { indexReads: 2, r2Fetches: 0, estimatedCost: 0.000002 },
        savings: '99.99%',
      },
      {
        query: "SELECT * WHERE type = 'User' LIMIT 100",
        fullScan: { r2Fetches: partitions, rowsRead: totalRows, estimatedCost: partitions * 0.0004 },
        accelerated: { indexReads: 2, r2Fetches: 1, estimatedCost: 0.0004 },
        savings: `${Math.round((1 - 1 / partitions) * 100)}%`,
      },
      {
        query: "SELECT * WHERE data.email = 'x@y.com'",
        fullScan: { r2Fetches: partitions, rowsRead: totalRows, estimatedCost: partitions * 0.0004 },
        accelerated: { indexReads: 1, r2Fetches: 0, estimatedCost: 0.000001 }, // If bloom says no
        savings: '99.99% (if bloom filter negative)',
      },
      {
        query: 'SELECT * WHERE createdAt > "2024-01-01"',
        fullScan: { r2Fetches: partitions, rowsRead: totalRows, estimatedCost: partitions * 0.0004 },
        accelerated: {
          indexReads: 1,
          r2Fetches: Math.ceil(partitions / 4),
          estimatedCost: Math.ceil(partitions / 4) * 0.0004,
        },
        savings: '~75% (min/max pruning)',
      },
    ]
  }
}

// ============================================================================
// Supporting Types
// ============================================================================

export interface IcebergManifest {
  entries: Array<{
    partitionKey: string
    dataFile: string
    rowCount: number
    sizeBytes: number
    lowerBounds: Record<string, unknown>
    upperBounds: Record<string, unknown>
    nullCounts: Record<string, number>
  }>
}

export interface ParsedQuery {
  select: string[]
  predicates: Predicate[]
  groupBy?: string[]
  orderBy?: string[]
  limit?: number
  aggregations?: Aggregation[]
  isCountOnly?: boolean
  isExistsOnly?: boolean
}

export interface Aggregation {
  function: 'count' | 'sum' | 'avg' | 'min' | 'max'
  column?: string
  alias: string
}

export interface QueryResult {
  data: unknown[]
  stats: QueryStats
}

export interface QueryStats {
  indexRowsRead: number
  r2PartitionsFetched: number
  r2BytesFetched: number
  rowsScanned: number
  rowsReturned: number
  cacheHits: number
  executionTimeMs: number
}

export interface CostComparison {
  query: string
  fullScan: { r2Fetches: number; rowsRead: number; estimatedCost: number }
  accelerated: { indexReads: number; r2Fetches: number; estimatedCost: number }
  savings: string
}

// ============================================================================
// Test Helpers
// ============================================================================

export function generateTestManifest(
  partitionCount: number,
  rowsPerPartition: number
): IcebergManifest {
  const types = ['User', 'Order', 'Product', 'Event', 'Session']
  const entries = []

  for (let i = 0; i < partitionCount; i++) {
    const type = types[i % types.length]
    const day = `2024-01-${String((i % 31) + 1).padStart(2, '0')}`

    entries.push({
      partitionKey: `type=${type}/dt=${day}`,
      dataFile: `s3://bucket/data/type=${type}/dt=${day}/part-${i}.parquet`,
      rowCount: rowsPerPartition,
      sizeBytes: rowsPerPartition * 500, // ~500 bytes per row
      lowerBounds: {
        type,
        createdAt: new Date(`${day}T00:00:00Z`).getTime(),
        id: `${type.toLowerCase()}-${i * rowsPerPartition}`,
      },
      upperBounds: {
        type,
        createdAt: new Date(`${day}T23:59:59Z`).getTime(),
        id: `${type.toLowerCase()}-${(i + 1) * rowsPerPartition - 1}`,
      },
      nullCounts: { type: 0, createdAt: 0, id: 0, data: rowsPerPartition * 0.1 },
    })
  }

  return { entries }
}

export function generateTestEmails(count: number): string[] {
  const emails: string[] = []
  for (let i = 0; i < count; i++) {
    emails.push(`user${i}@example.com`)
  }
  return emails
}
