/**
 * ColumnarStore Types
 *
 * TypeScript types for analytics-optimized columnar storage.
 */

/** Record to be inserted into the columnar store */
export interface ColumnarRecord {
  id?: string
  type: string
  data: Record<string, unknown>
  embedding?: number[]
}

/** Result of a batch insert operation */
export interface InsertResult {
  success: boolean
  count: number
  ids: string[]
}

/** Column statistics for query optimization */
export interface ColumnStats {
  min: unknown
  max: unknown
  nullCount: number
  cardinality: number
}

/** Path statistics for JSON subcolumn extraction */
export interface PathStats {
  frequency: number
  type: 'String' | 'Int64' | 'Float64' | 'Bool' | 'Object' | 'Array' | 'Null'
}

/** Type index entry */
export interface TypeIndexEntry {
  count: number
  indices: number[]
}

/** Type index mapping type names to their stats */
export interface TypeIndex {
  [typeName: string]: TypeIndexEntry
}

/** Store metadata */
export interface StoreMeta {
  count: number
  dimensions: string[]
  embeddingDimensions?: number
}

/** Timestamps storage format */
export interface TimestampsColumn {
  created: number[]
  updated: number[]
}

/** Bloom filter interface */
export interface BloomFilter {
  mightContain(value: string): boolean
  add(value: string): void
  config: {
    falsePositiveRate: number
  }
}

/** Query options */
export interface QueryOptions {
  type: string
  columns?: string[]
  where?: Record<string, unknown>
  limit?: number
  offset?: number
  orderBy?: string
  order?: 'asc' | 'desc'
}

/** Range predicate for partition pruning */
export interface RangePredicate {
  op: '>' | '<' | '>=' | '<=' | '='
  value: unknown
}

/** Aggregate query options */
export interface AggregateOptions {
  type?: string
  groupBy?: string
  where?: Record<string, unknown>
  metrics: string[]
}

/** Count query options */
export interface CountOptions {
  type?: string
  where?: Record<string, unknown>
}

/** Cost savings calculation result */
export interface CostSavings {
  traditional: {
    writes: number
    cost: number
  }
  columnar: {
    writes: number
    cost: number
  }
  percentSaved: number
}

/** Query cost estimate */
export interface QueryCostEstimate {
  rowReads: number
  estimatedCost: number
}

/** CDC event emitted on batch operations */
export interface CdcEvent {
  type: 'cdc.batch_insert'
  op: 'c' | 'u' | 'd'
  store: 'columnar'
  table: string
  count: number
  partition: string
  timestamp: number
  batchId: string
}

/** CDC handler function type */
export type CdcHandler = (event: CdcEvent) => void | Promise<void>

/** ColumnarStore configuration options */
export interface ColumnarStoreOptions {
  tablePrefix?: string
  bloomFalsePositiveRate?: number
  extractionThreshold?: number
  onCdc?: CdcHandler
}

/** Mock database interface for testing */
export interface MockDb {
  exec: (sql: string) => { changes: number }
  prepare: (sql: string) => {
    bind: (...args: unknown[]) => unknown
    run: () => { changes: number }
    get: () => { value: string | null } | null
    all: () => unknown[]
  }
  _storage?: Map<string, string>
}
