/**
 * Transform - Change data transformation capabilities
 *
 * Provides transformation primitives for CDC changes:
 * - Field mapping and projection
 * - Data type conversion
 * - Filtering
 * - Enrichment with external data
 * - Schema transformation
 * - Change aggregation and debouncing
 *
 * @see https://debezium.io/documentation/reference/stable/transformations/
 */

import { ChangeType, type ChangeEvent } from './stream'

// ============================================================================
// TYPES
// ============================================================================

/** Generic transformer interface */
export interface Transformer<I, O> {
  /** Optional name for identification */
  name?: string
  /** Transform a change event (return null to filter out) */
  transform(event: ChangeEvent<I>): Promise<ChangeEvent<O> | null>
  /** Flush any pending state */
  flush?(): Promise<void>
}

/** Pipeline statistics */
export interface PipelineStats {
  inputCount: number
  outputCount: number
  filteredCount: number
  errorCount: number
  avgLatencyMs: number
}

// ============================================================================
// MAP TRANSFORMER
// ============================================================================

/** Mapping function type */
export type MapFn<I, O> = (record: I) => O | Promise<O>

/**
 * Create a map transformer that transforms record fields
 */
export function map<I, O>(fn: MapFn<I, O>): Transformer<I, O> {
  return {
    name: 'map',
    async transform(event: ChangeEvent<I>): Promise<ChangeEvent<O> | null> {
      const transformedEvent: ChangeEvent<O> = {
        ...event,
        before: event.before ? await fn(event.before) : null,
        after: event.after ? await fn(event.after) : null,
      }
      return transformedEvent
    },
  }
}

// ============================================================================
// FILTER TRANSFORMER
// ============================================================================

/** Filter predicate type */
export type FilterPredicate<T> = (event: ChangeEvent<T>) => boolean | Promise<boolean>

/**
 * Create a filter transformer
 */
export function filter<T>(predicate: FilterPredicate<T>): Transformer<T, T> {
  return {
    name: 'filter',
    async transform(event: ChangeEvent<T>): Promise<ChangeEvent<T> | null> {
      const shouldPass = await predicate(event)
      return shouldPass ? event : null
    },
  }
}

// ============================================================================
// PROJECT TRANSFORMER
// ============================================================================

/** Field path for nested access */
export type FieldPath = string

/** Projection configuration */
export type ProjectionConfig<I, O> =
  | (keyof I)[]
  | Record<keyof O, FieldPath>
  | { exclude: (keyof I)[] }

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Create a project transformer for field selection
 */
export function project<I, O>(config: ProjectionConfig<I, O>): Transformer<I, O> {
  return {
    name: 'project',
    async transform(event: ChangeEvent<I>): Promise<ChangeEvent<O> | null> {
      const projectRecord = (record: I | null): O | null => {
        if (!record) return null

        if (Array.isArray(config)) {
          // Simple field selection
          const result: Record<string, unknown> = {}
          for (const field of config) {
            result[field as string] = (record as Record<string, unknown>)[field as string]
          }
          return result as O
        } else if ('exclude' in config) {
          // Exclusion mode
          const result: Record<string, unknown> = { ...record }
          for (const field of config.exclude) {
            delete result[field as string]
          }
          return result as O
        } else {
          // Field mapping with possible nested paths
          const result: Record<string, unknown> = {}
          for (const [targetField, sourcePath] of Object.entries(config)) {
            result[targetField] = getNestedValue(record, sourcePath as string)
          }
          return result as O
        }
      }

      return {
        ...event,
        before: projectRecord(event.before),
        after: projectRecord(event.after),
      }
    },
  }
}

// ============================================================================
// ENRICH TRANSFORMER
// ============================================================================

/** Enrichment function type */
export type EnrichFn<T, E> = (event: ChangeEvent<T>) => Promise<E>

/** Enrichment options */
export interface EnrichOptions<T> {
  /** How to handle enrichment errors */
  onError?: 'skip' | 'throw' | 'default'
  /** Default value on error */
  defaultValue?: unknown
  /** Cache key extractor */
  cacheKey?: (event: ChangeEvent<T>) => string
  /** Cache TTL in milliseconds */
  cacheTtlMs?: number
}

/**
 * Create an enrich transformer that adds external data
 */
export function enrich<T, E extends Partial<T>>(
  fn: EnrichFn<T, E>,
  options?: EnrichOptions<T>
): Transformer<T, T & E> {
  const cache = new Map<string, { value: E; timestamp: number }>()

  return {
    name: 'enrich',
    async transform(event: ChangeEvent<T>): Promise<ChangeEvent<T & E> | null> {
      const enrichRecord = async (record: T | null): Promise<(T & E) | null> => {
        if (!record) return null

        try {
          // Check cache
          if (options?.cacheKey) {
            const key = options.cacheKey(event)
            const cached = cache.get(key)
            if (cached) {
              const ttl = options.cacheTtlMs ?? 60000
              if (Date.now() - cached.timestamp < ttl) {
                return { ...record, ...cached.value }
              }
            }
          }

          const enrichment = await fn(event)

          // Update cache
          if (options?.cacheKey) {
            const key = options.cacheKey(event)
            cache.set(key, { value: enrichment, timestamp: Date.now() })
          }

          return { ...record, ...enrichment }
        } catch (error) {
          switch (options?.onError) {
            case 'skip':
              return record as T & E
            case 'default':
              return { ...record, ...(options.defaultValue as object) } as T & E
            case 'throw':
            default:
              throw error
          }
        }
      }

      return {
        ...event,
        before: await enrichRecord(event.before),
        after: await enrichRecord(event.after),
      }
    },
  }
}

// ============================================================================
// FLATTEN TRANSFORMER
// ============================================================================

/** Flatten options */
export interface FlattenOptions {
  /** Delimiter for flattened keys */
  delimiter?: string
  /** Whether to flatten arrays */
  flattenArrays?: boolean
  /** Maximum depth to flatten */
  maxDepth?: number
}

/**
 * Flatten a nested object
 */
function flattenObject(
  obj: Record<string, unknown>,
  options: FlattenOptions,
  prefix: string = '',
  depth: number = 0
): Record<string, unknown> {
  const delimiter = options.delimiter ?? '_'
  const maxDepth = options.maxDepth ?? 10
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}${delimiter}${key}` : key

    if (depth >= maxDepth) {
      result[newKey] = value
    } else if (Array.isArray(value) && options.flattenArrays) {
      for (let i = 0; i < value.length; i++) {
        const arrayKey = `${newKey}${delimiter}${i}`
        if (typeof value[i] === 'object' && value[i] !== null) {
          Object.assign(result, flattenObject(value[i] as Record<string, unknown>, options, arrayKey, depth + 1))
        } else {
          result[arrayKey] = value[i]
        }
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, options, newKey, depth + 1))
    } else {
      result[newKey] = value
    }
  }

  return result
}

/**
 * Create a flatten transformer for nested objects
 */
export function flatten<I, O>(options: FlattenOptions = {}): Transformer<I, O> {
  return {
    name: 'flatten',
    async transform(event: ChangeEvent<I>): Promise<ChangeEvent<O> | null> {
      const flattenRecord = (record: I | null): O | null => {
        if (!record) return null
        return flattenObject(record as Record<string, unknown>, options) as O
      }

      return {
        ...event,
        before: flattenRecord(event.before),
        after: flattenRecord(event.after),
      }
    },
  }
}

// ============================================================================
// AGGREGATE TRANSFORMER
// ============================================================================

/** Aggregation options */
export interface AggregateOptions<I, O> {
  /** Key extractor for grouping */
  keyBy: (event: ChangeEvent<I>) => string
  /** Time window in milliseconds */
  windowMs: number
  /** Reducer function */
  reducer: (acc: O | null, event: ChangeEvent<I>) => O
  /** Handler for aggregated results */
  onAggregate: (result: O) => Promise<void>
}

/**
 * Create an aggregate transformer for batching changes
 */
export function aggregate<I, O>(options: AggregateOptions<I, O>): Transformer<I, I> {
  const windows = new Map<string, { data: O; timer: ReturnType<typeof setTimeout> }>()

  const flush = async (key: string): Promise<void> => {
    const window = windows.get(key)
    if (window) {
      await options.onAggregate(window.data)
      windows.delete(key)
    }
  }

  return {
    name: 'aggregate',
    async transform(event: ChangeEvent<I>): Promise<ChangeEvent<I> | null> {
      const key = options.keyBy(event)
      let window = windows.get(key)

      if (!window) {
        const timer = setTimeout(() => flush(key), options.windowMs)
        window = { data: options.reducer(null, event), timer }
        windows.set(key, window)
      } else {
        window.data = options.reducer(window.data, event)
      }

      // Return null to prevent individual event emission
      return null
    },
    async flush(): Promise<void> {
      const keys = [...windows.keys()]
      for (const key of keys) {
        const window = windows.get(key)
        if (window) {
          clearTimeout(window.timer)
          await flush(key)
        }
      }
    },
  }
}

// ============================================================================
// DEBOUNCE TRANSFORMER
// ============================================================================

/** Debounce options */
export interface DebounceOptions<T> {
  /** Key extractor */
  keyBy: (event: ChangeEvent<T>) => string
  /** Debounce window in milliseconds */
  windowMs: number
  /** Handler for debounced events */
  onEmit: (event: ChangeEvent<T>) => Promise<void>
}

/**
 * Create a debounce transformer for rapid changes to same key
 */
export function debounce<T>(options: DebounceOptions<T>): Transformer<T, T> {
  const pending = new Map<string, { event: ChangeEvent<T>; timer: ReturnType<typeof setTimeout> }>()

  const emit = async (key: string): Promise<void> => {
    const entry = pending.get(key)
    if (entry) {
      await options.onEmit(entry.event)
      pending.delete(key)
    }
  }

  return {
    name: 'debounce',
    async transform(event: ChangeEvent<T>): Promise<ChangeEvent<T> | null> {
      const key = options.keyBy(event)
      const existing = pending.get(key)

      if (existing) {
        clearTimeout(existing.timer)
      }

      const timer = setTimeout(() => emit(key), options.windowMs)
      pending.set(key, { event, timer })

      // Return null to prevent immediate emission
      return null
    },
    async flush(): Promise<void> {
      const keys = [...pending.keys()]
      for (const key of keys) {
        const entry = pending.get(key)
        if (entry) {
          clearTimeout(entry.timer)
          await emit(key)
        }
      }
    },
  }
}

// ============================================================================
// TRANSFORM PIPELINE
// ============================================================================

/**
 * Transform pipeline for composing multiple transformers
 */
export class TransformPipeline<I, O> {
  private transformers: Transformer<unknown, unknown>[] = []
  private stats: PipelineStats = {
    inputCount: 0,
    outputCount: 0,
    filteredCount: 0,
    errorCount: 0,
    avgLatencyMs: 0,
  }
  private totalLatencyMs: number = 0

  /**
   * Add a transformer to the pipeline
   */
  pipe<N>(transformer: Transformer<O, N>): TransformPipeline<I, N> {
    this.transformers.push(transformer as Transformer<unknown, unknown>)
    return this as unknown as TransformPipeline<I, N>
  }

  /**
   * Transform an event through the pipeline
   */
  async transform(event: ChangeEvent<I>): Promise<ChangeEvent<O> | null> {
    const startTime = performance.now()
    this.stats.inputCount++

    let current: ChangeEvent<unknown> | null = event

    try {
      for (const transformer of this.transformers) {
        if (!current) break
        current = await transformer.transform(current)
      }

      if (current) {
        this.stats.outputCount++
      } else {
        this.stats.filteredCount++
      }

      return current as ChangeEvent<O> | null
    } catch (error) {
      this.stats.errorCount++
      throw error
    } finally {
      this.totalLatencyMs += performance.now() - startTime
      this.stats.avgLatencyMs = this.totalLatencyMs / this.stats.inputCount
    }
  }

  /**
   * Flush all transformers
   */
  async flush(): Promise<void> {
    for (const transformer of this.transformers) {
      if (transformer.flush) {
        await transformer.flush()
      }
    }
  }

  /**
   * Get pipeline statistics
   */
  getStats(): PipelineStats {
    return { ...this.stats }
  }

  /**
   * Transform an event through the pipeline (sync version)
   * Note: All transformers must be synchronous for this to work
   */
  transformSync(event: ChangeEvent<I>): ChangeEvent<O> | null {
    const startTime = performance.now()
    this.stats.inputCount++

    let current: ChangeEvent<unknown> | null = event

    try {
      for (const transformer of this.transformers) {
        if (!current) break
        const result = transformer.transform(current)
        if (result instanceof Promise) {
          throw new Error('Cannot use async transformers with transformSync')
        }
        current = result as ChangeEvent<unknown> | null
      }

      if (current) {
        this.stats.outputCount++
      } else {
        this.stats.filteredCount++
      }

      return current as ChangeEvent<O> | null
    } catch (error) {
      this.stats.errorCount++
      throw error
    } finally {
      this.totalLatencyMs += performance.now() - startTime
      this.stats.avgLatencyMs = this.totalLatencyMs / this.stats.inputCount
    }
  }
}

/**
 * Create a new transform pipeline
 */
export function createTransformPipeline<I, O = I>(): TransformPipeline<I, O> {
  return new TransformPipeline<I, O>()
}

// ============================================================================
// FILTER CHAIN - Composable Predicates
// ============================================================================

/** Filter predicate for FilterChain */
export type ChainPredicate<T> = (event: ChangeEvent<T>) => boolean | Promise<boolean>

/**
 * FilterChain - Composable filter predicates with AND/OR/NOT logic
 */
export class FilterChain<T> {
  private predicates: Array<{
    type: 'and' | 'or' | 'not' | 'group'
    predicate?: ChainPredicate<T>
    chain?: FilterChain<T>
  }> = []

  /**
   * Add an AND predicate
   */
  and(predicate: ChainPredicate<T>): FilterChain<T> {
    this.predicates.push({ type: 'and', predicate })
    return this
  }

  /**
   * Add an OR predicate
   */
  or(predicate: ChainPredicate<T>): FilterChain<T> {
    this.predicates.push({ type: 'or', predicate })
    return this
  }

  /**
   * Add a NOT predicate
   */
  not(predicate: ChainPredicate<T>): FilterChain<T> {
    this.predicates.push({ type: 'not', predicate })
    return this
  }

  /**
   * Add a grouped sub-chain (for complex boolean expressions)
   */
  group(builder: (chain: FilterChain<T>) => FilterChain<T>): FilterChain<T> {
    const subChain = new FilterChain<T>()
    builder(subChain)
    this.predicates.push({ type: 'group', chain: subChain })
    return this
  }

  /**
   * Test an event against the filter chain (async)
   */
  async test(event: ChangeEvent<T>): Promise<boolean> {
    if (this.predicates.length === 0) return true

    let result = true
    let hasOr = false

    for (const item of this.predicates) {
      let predicateResult: boolean

      if (item.type === 'group' && item.chain) {
        predicateResult = await item.chain.test(event)
      } else if (item.predicate) {
        const rawResult = item.predicate(event)
        predicateResult = rawResult instanceof Promise ? await rawResult : rawResult
        if (item.type === 'not') {
          predicateResult = !predicateResult
        }
      } else {
        continue
      }

      if (item.type === 'or') {
        hasOr = true
        if (predicateResult) return true
      } else {
        // AND or NOT or GROUP
        if (!predicateResult) {
          if (hasOr) {
            // In OR mode, continue checking other predicates
            result = false
          } else {
            return false
          }
        }
      }
    }

    return hasOr ? false : result
  }

  /**
   * Test an event against the filter chain (sync)
   */
  testSync(event: ChangeEvent<T>): boolean {
    if (this.predicates.length === 0) return true

    let result = true
    let hasOr = false

    for (const item of this.predicates) {
      let predicateResult: boolean

      if (item.type === 'group' && item.chain) {
        predicateResult = item.chain.testSync(event)
      } else if (item.predicate) {
        const rawResult = item.predicate(event)
        if (rawResult instanceof Promise) {
          throw new Error('Cannot use async predicates with testSync')
        }
        predicateResult = rawResult
        if (item.type === 'not') {
          predicateResult = !predicateResult
        }
      } else {
        continue
      }

      if (item.type === 'or') {
        hasOr = true
        if (predicateResult) return true
      } else {
        // AND or NOT or GROUP
        if (!predicateResult) {
          if (hasOr) {
            result = false
          } else {
            return false
          }
        }
      }
    }

    return hasOr ? false : result
  }

  /**
   * Convert to a Transformer
   */
  toTransformer(): Transformer<T, T> {
    return {
      name: 'filterChain',
      transform: async (event: ChangeEvent<T>): Promise<ChangeEvent<T> | null> => {
        const shouldPass = await this.test(event)
        return shouldPass ? event : null
      },
    }
  }
}

/**
 * Create a new filter chain
 */
export function createFilterChain<T>(): FilterChain<T> {
  return new FilterChain<T>()
}

// ============================================================================
// OPERATION TYPE FILTER
// ============================================================================

/** Operation type string */
export type OperationType = 'INSERT' | 'UPDATE' | 'DELETE'

/**
 * Filter by operation type
 */
export function filterByOperation<T>(operations: OperationType[]): Transformer<T, T> {
  const operationSet = new Set(operations)
  return {
    name: 'filterByOperation',
    async transform(event: ChangeEvent<T>): Promise<ChangeEvent<T> | null> {
      return operationSet.has(event.type as OperationType) ? event : null
    },
  }
}

// ============================================================================
// TABLE FILTER
// ============================================================================

/** Table filter configuration */
export type TableFilterConfig = string[] | { exclude: string[] }

/**
 * Convert glob pattern to regex
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

/**
 * Filter by table name with glob pattern support
 */
export function filterByTable<T>(config: TableFilterConfig): Transformer<T, T> {
  const isExclude = !Array.isArray(config) && 'exclude' in config
  const patterns = isExclude ? config.exclude : config
  const regexes = patterns.map(globToRegex)

  return {
    name: 'filterByTable',
    async transform(event: ChangeEvent<T>): Promise<ChangeEvent<T> | null> {
      const table = event.table
      if (!table) return isExclude ? event : null

      const matches = regexes.some((regex) => regex.test(table))

      if (isExclude) {
        // Exclude mode: pass through if NOT matching
        return matches ? null : event
      } else {
        // Include mode: pass through if matching
        return matches ? event : null
      }
    },
  }
}

// ============================================================================
// COLUMN FILTER
// ============================================================================

/**
 * Filter by changed columns (for UPDATE events)
 */
export function filterByColumn<T>(columns: (keyof T)[]): Transformer<T, T> {
  const columnSet = new Set(columns as string[])

  return {
    name: 'filterByColumn',
    async transform(event: ChangeEvent<T>): Promise<ChangeEvent<T> | null> {
      // Always pass through INSERT and DELETE
      if (event.type !== ChangeType.UPDATE) {
        return event
      }

      // For UPDATE, check if any of the specified columns changed
      const before = event.before as Record<string, unknown> | null
      const after = event.after as Record<string, unknown> | null

      if (!before || !after) return event

      for (const column of columnSet) {
        if (before[column] !== after[column]) {
          return event
        }
      }

      return null
    },
  }
}

// ============================================================================
// RENAME TRANSFORMER
// ============================================================================

/** Rename options */
export interface RenameOptions {
  /** Preserve fields not in the rename map */
  preserveOthers?: boolean
}

/**
 * Rename fields in records
 */
export function rename<I, O>(
  mapping: Partial<Record<keyof I, keyof O>>,
  options?: RenameOptions
): Transformer<I, O> {
  const { preserveOthers = false } = options ?? {}

  const renameRecord = (record: I | null): O | null => {
    if (!record) return null

    const result: Record<string, unknown> = {}

    // Apply renames
    for (const [sourceKey, targetKey] of Object.entries(mapping)) {
      if (targetKey && sourceKey in (record as object)) {
        result[targetKey as string] = (record as Record<string, unknown>)[sourceKey]
      }
    }

    // Preserve other fields if requested
    if (preserveOthers) {
      const renamedKeys = new Set(Object.keys(mapping))
      for (const [key, value] of Object.entries(record as object)) {
        if (!renamedKeys.has(key)) {
          result[key] = value
        }
      }
    }

    return result as O
  }

  return {
    name: 'rename',
    async transform(event: ChangeEvent<I>): Promise<ChangeEvent<O> | null> {
      return {
        ...event,
        before: renameRecord(event.before),
        after: renameRecord(event.after),
      }
    },
  }
}

// ============================================================================
// MASK TRANSFORMER
// ============================================================================

/** Mask options */
export interface MaskOptions {
  /** Custom mask function */
  maskFn?: (value: unknown) => unknown
}

/**
 * Set a nested value in an object using dot notation
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }
  const lastPart = parts[parts.length - 1]!
  current[lastPart] = value
}

/**
 * Deep clone an object
 */
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(deepClone) as T
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as object)) {
    result[key] = deepClone(value)
  }
  return result as T
}

/**
 * Mask field values for PII protection
 */
export function mask<T>(fields: string[], options?: MaskOptions): Transformer<T, T> {
  const defaultMaskFn = () => '****'
  const maskFn = options?.maskFn ?? defaultMaskFn

  const maskRecord = (record: T | null): T | null => {
    if (!record) return null

    const result = deepClone(record) as Record<string, unknown>

    for (const field of fields) {
      const value = getNestedValue(result, field)
      if (value !== undefined) {
        setNestedValue(result, field, maskFn(value))
      }
    }

    return result as T
  }

  return {
    name: 'mask',
    transform(event: ChangeEvent<T>): ChangeEvent<T> | null | Promise<ChangeEvent<T> | null> {
      return {
        ...event,
        before: maskRecord(event.before),
        after: maskRecord(event.after),
      }
    },
  }
}

// ============================================================================
// DERIVE TRANSFORMER
// ============================================================================

/** Derivation function type */
export type DeriveFn<T, V> = (record: T) => V | Promise<V>

/**
 * Compute derived fields from existing fields
 */
export function derive<I, O extends I>(
  derivations: { [K in keyof Omit<O, keyof I>]: DeriveFn<I, O[K]> }
): Transformer<I, O> {
  const deriveRecordSync = (record: I | null): O | null | Promise<O | null> => {
    if (!record) return null

    const result: Record<string, unknown> = { ...record }
    const promises: Array<Promise<void>> = []
    let hasAsync = false

    for (const [key, fn] of Object.entries(derivations)) {
      const deriveFn = fn as DeriveFn<I, unknown>
      const derivedValue = deriveFn(record)

      if (derivedValue instanceof Promise) {
        hasAsync = true
        promises.push(derivedValue.then((v) => {
          result[key] = v
        }))
      } else {
        result[key] = derivedValue
      }
    }

    if (hasAsync) {
      return Promise.all(promises).then(() => result as O)
    }

    return result as O
  }

  return {
    name: 'derive',
    transform(event: ChangeEvent<I>): ChangeEvent<O> | null | Promise<ChangeEvent<O> | null> {
      const beforeResult = deriveRecordSync(event.before)
      const afterResult = deriveRecordSync(event.after)

      // If either result is a promise, we need to return a promise
      if (beforeResult instanceof Promise || afterResult instanceof Promise) {
        return Promise.all([
          beforeResult instanceof Promise ? beforeResult : Promise.resolve(beforeResult),
          afterResult instanceof Promise ? afterResult : Promise.resolve(afterResult),
        ]).then(([before, after]) => ({
          ...event,
          before,
          after,
        }))
      }

      return {
        ...event,
        before: beforeResult,
        after: afterResult,
      }
    },
  }
}

// ============================================================================
// WHERE CONDITIONAL FILTERING
// ============================================================================

/** Comparison operators */
export type WhereOperator = 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'gt' | 'gte' | 'lt' | 'lte' | 'regex' | 'in' | 'notIn'

/** Where condition */
export interface WhereCondition<T> {
  field: keyof T
  operator: WhereOperator
  value: unknown
}

/**
 * Evaluate a where condition against a record
 */
function evaluateCondition<T>(record: T, condition: WhereCondition<T>): boolean {
  const fieldValue = (record as Record<string, unknown>)[condition.field as string]

  switch (condition.operator) {
    case 'equals':
      return fieldValue === condition.value
    case 'contains':
      return typeof fieldValue === 'string' && fieldValue.includes(String(condition.value))
    case 'startsWith':
      return typeof fieldValue === 'string' && fieldValue.startsWith(String(condition.value))
    case 'endsWith':
      return typeof fieldValue === 'string' && fieldValue.endsWith(String(condition.value))
    case 'gt':
      return typeof fieldValue === 'number' && fieldValue > (condition.value as number)
    case 'gte':
      return typeof fieldValue === 'number' && fieldValue >= (condition.value as number)
    case 'lt':
      return typeof fieldValue === 'number' && fieldValue < (condition.value as number)
    case 'lte':
      return typeof fieldValue === 'number' && fieldValue <= (condition.value as number)
    case 'regex':
      return typeof fieldValue === 'string' && new RegExp(String(condition.value)).test(fieldValue)
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(fieldValue)
    case 'notIn':
      return Array.isArray(condition.value) && !condition.value.includes(fieldValue)
    default:
      return false
  }
}

/**
 * Create a where filter transformer
 */
export function where<T>(condition: WhereCondition<T>): Transformer<T, T> {
  return {
    name: 'where',
    async transform(event: ChangeEvent<T>): Promise<ChangeEvent<T> | null> {
      const record = event.after ?? event.before
      if (!record) return null
      return evaluateCondition(record, condition) ? event : null
    },
  }
}

/**
 * Create a where filter that requires ALL conditions to match
 */
export function whereAll<T>(conditions: WhereCondition<T>[]): Transformer<T, T> {
  return {
    name: 'whereAll',
    async transform(event: ChangeEvent<T>): Promise<ChangeEvent<T> | null> {
      const record = event.after ?? event.before
      if (!record) return null
      const allMatch = conditions.every((cond) => evaluateCondition(record, cond))
      return allMatch ? event : null
    },
  }
}

/**
 * Create a where filter that requires ANY condition to match
 */
export function whereAny<T>(conditions: WhereCondition<T>[]): Transformer<T, T> {
  return {
    name: 'whereAny',
    async transform(event: ChangeEvent<T>): Promise<ChangeEvent<T> | null> {
      const record = event.after ?? event.before
      if (!record) return null
      const anyMatch = conditions.some((cond) => evaluateCondition(record, cond))
      return anyMatch ? event : null
    },
  }
}
