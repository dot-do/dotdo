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
}

/**
 * Create a new transform pipeline
 */
export function createTransformPipeline<I, O = I>(): TransformPipeline<I, O> {
  return new TransformPipeline<I, O>()
}
