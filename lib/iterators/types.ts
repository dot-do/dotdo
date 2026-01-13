/**
 * Types for iterators and aggregators
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Any async iterable source - arrays, generators, ReadableStreams, etc.
 */
export type AsyncIterableSource<T> =
  | AsyncIterable<T>
  | Iterable<T>
  | T[]
  | ReadableStream<T>

/**
 * Transform function for mapping items
 */
export type Transform<T, R> = (item: T) => R | Promise<R>

/**
 * Predicate function for filtering
 */
export type Predicate<T> = (item: T) => boolean | Promise<boolean>

/**
 * Reducer function for aggregation
 */
export type Reducer<T, R> = (accumulator: R, item: T, index: number) => R | Promise<R>

// ============================================================================
// Iterator Options
// ============================================================================

/**
 * Options for iterator creation
 */
export interface IteratorOptions {
  /**
   * Maximum items to yield (optional limit)
   */
  limit?: number

  /**
   * Items to skip from the start
   */
  offset?: number

  /**
   * Delay between items in ms (for rate limiting)
   */
  delayMs?: number

  /**
   * Signal for cancellation
   */
  signal?: AbortSignal
}

/**
 * Options for batch iteration
 */
export interface BatchIteratorOptions extends IteratorOptions {
  /**
   * Number of items per batch
   * @default 100
   */
  batchSize?: number

  /**
   * Emit partial final batch
   * @default true
   */
  emitPartial?: boolean
}

// ============================================================================
// Aggregator Types
// ============================================================================

/**
 * Result from numeric aggregation
 */
export interface NumericAggregation {
  /** Total sum of values */
  sum: number
  /** Number of values */
  count: number
  /** Average value */
  avg: number
  /** Minimum value */
  min: number
  /** Maximum value */
  max: number
  /** Variance (population) */
  variance: number
  /** Standard deviation (population) */
  stdDev: number
  /** Median value (requires collecting all values) */
  median?: number
  /** All values (if requested) */
  values?: number[]
}

/**
 * Options for numeric aggregation
 */
export interface NumericAggregatorOptions {
  /**
   * Calculate median (requires storing all values)
   * @default false
   */
  includeMedian?: boolean

  /**
   * Keep all values in result
   * @default false
   */
  keepValues?: boolean

  /**
   * Extract numeric value from objects
   */
  valueExtractor?: (item: unknown) => number
}

/**
 * Result from text aggregation
 */
export interface TextAggregation {
  /** Concatenated text */
  text: string
  /** Number of segments */
  count: number
  /** Total character count */
  charCount: number
  /** Total word count (approximate) */
  wordCount: number
  /** Line count */
  lineCount: number
}

/**
 * Options for text aggregation
 */
export interface TextAggregatorOptions {
  /**
   * Separator between text segments
   * @default ''
   */
  separator?: string

  /**
   * Maximum characters (truncate if exceeded)
   */
  maxLength?: number

  /**
   * Trim whitespace from each segment
   * @default false
   */
  trim?: boolean
}

/**
 * Options for array aggregation (collection)
 */
export interface CollectOptions {
  /**
   * Maximum items to collect
   */
  limit?: number

  /**
   * Initial capacity hint for array pre-allocation
   */
  initialCapacity?: number
}

/**
 * Result from table aggregation
 */
export interface TableAggregation<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Array of row records */
  rows: T[]
  /** Column names detected from data */
  columns: string[]
  /** Row count */
  rowCount: number
  /** Column statistics */
  columnStats: Map<string, ColumnStats>
}

/**
 * Statistics for a single column
 */
export interface ColumnStats {
  /** Column name */
  name: string
  /** Data type detected */
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'mixed'
  /** Non-null value count */
  nonNullCount: number
  /** Null/undefined count */
  nullCount: number
  /** Distinct value count (approximate for large datasets) */
  distinctCount: number
  /** For numeric columns */
  numeric?: {
    min: number
    max: number
    sum: number
    avg: number
  }
  /** For string columns */
  string?: {
    minLength: number
    maxLength: number
    avgLength: number
  }
}

/**
 * Options for table aggregation
 */
export interface TableAggregatorOptions {
  /**
   * Columns to include (default: all detected)
   */
  columns?: string[]

  /**
   * Calculate column statistics
   * @default true
   */
  includeStats?: boolean

  /**
   * Maximum distinct values to track per column
   * @default 1000
   */
  maxDistinctValues?: number
}

// ============================================================================
// Backpressure Types
// ============================================================================

/**
 * Backpressure strategy when buffer is full
 */
export type BackpressureStrategy = 'drop-oldest' | 'drop-newest' | 'block' | 'error'

/**
 * Options for backpressure handling
 */
export interface BackpressureOptions {
  /**
   * Maximum buffer size (high water mark)
   * @default 16
   */
  highWaterMark?: number

  /**
   * Low water mark for resuming
   * @default highWaterMark / 4
   */
  lowWaterMark?: number

  /**
   * Strategy when buffer is full
   * @default 'block'
   */
  strategy?: BackpressureStrategy

  /**
   * Timeout for blocking strategy in ms
   */
  blockTimeout?: number
}

/**
 * Backpressure state
 */
export interface BackpressureState {
  /** Current buffer size */
  bufferSize: number
  /** High water mark */
  highWaterMark: number
  /** Low water mark */
  lowWaterMark: number
  /** Whether backpressure is active */
  isPaused: boolean
  /** Number of items dropped */
  droppedCount: number
}

// ============================================================================
// Transform Types
// ============================================================================

/**
 * Chunk size for streaming transforms
 */
export interface ChunkOptions {
  /**
   * Size in bytes for byte-based chunking
   */
  bytes?: number

  /**
   * Number of items for item-based chunking
   */
  items?: number

  /**
   * Time window in ms for time-based chunking
   */
  timeMs?: number
}

/**
 * Deduplication options
 */
export interface DeduplicationOptions<T> {
  /**
   * Extract key for deduplication
   * @default String(item)
   */
  keyExtractor?: (item: T) => string

  /**
   * Maximum keys to track (LRU eviction)
   * @default 10000
   */
  maxKeys?: number

  /**
   * Time window for deduplication in ms
   */
  windowMs?: number
}
