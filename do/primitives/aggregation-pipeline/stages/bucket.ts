/**
 * $bucket and $bucketAuto Stages - Histogram binning for aggregation
 *
 * $bucket: Categorizes documents into specified bucket boundaries
 * $bucketAuto: Automatically determines optimal bucket boundaries
 *
 * Use cases:
 * - Histogram generation
 * - Range-based grouping
 * - Data distribution analysis
 * - Percentile calculations
 *
 * @example Basic bucket
 * ```typescript
 * createBucketStage({
 *   groupBy: '$price',
 *   boundaries: [0, 100, 200, 500, 1000],
 *   default: 'Other',
 *   output: {
 *     count: { $count: {} },
 *     avgPrice: { $avg: '$price' }
 *   }
 * })
 * ```
 *
 * @example Bucket auto
 * ```typescript
 * createBucketAutoStage({
 *   groupBy: '$score',
 *   buckets: 5,
 *   output: {
 *     count: { $count: {} },
 *     minScore: { $min: '$score' },
 *     maxScore: { $max: '$score' }
 *   },
 *   granularity: 'R5' // Round numbers
 * })
 * ```
 */

import type { Stage } from '../index'
import type { Accumulator } from './group'

// ============================================================================
// Types
// ============================================================================

/**
 * Output specification for bucket aggregations
 */
export type BucketOutput = {
  [key: string]: Accumulator | { $count: Record<string, never> }
}

/**
 * $bucket specification
 */
export interface BucketSpec<T> {
  /** Expression to group by (field reference) */
  groupBy: string
  /** Array of boundary values (must be sorted in ascending order) */
  boundaries: number[]
  /** Default bucket for values outside boundaries */
  default?: string | number | null
  /** Output fields with accumulators */
  output?: BucketOutput
}

/**
 * Granularity options for $bucketAuto
 * Based on preferred number series
 */
export type Granularity =
  | 'R5'   // 1, 1.6, 2.5, 4, 6.3, 10
  | 'R10'  // 1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8, 10
  | 'R20'  // More fine-grained
  | 'R40'  // Even more fine-grained
  | 'R80'  // Very fine-grained
  | '1-2-5'     // Powers of 10 with 1, 2, 5 multipliers
  | 'E6'   // 1.0, 1.5, 2.2, 3.3, 4.7, 6.8
  | 'E12'  // E6 plus intermediates
  | 'E24'  // More precise electronic values
  | 'E48'  // Very precise
  | 'E96'  // Ultra precise
  | 'E192' // Maximum precision
  | 'POWERSOF2' // 1, 2, 4, 8, 16, 32...

/**
 * $bucketAuto specification
 */
export interface BucketAutoSpec<T> {
  /** Expression to group by (field reference) */
  groupBy: string
  /** Number of buckets to create */
  buckets: number
  /** Output fields with accumulators */
  output?: BucketOutput
  /** Granularity for bucket boundaries */
  granularity?: Granularity
}

/**
 * Bucket result document
 */
export interface BucketResult {
  _id: number | string | null | { min: number; max: number }
  count: number
  [key: string]: unknown
}

/**
 * Bucket stage interface
 */
export interface BucketStage<T> extends Stage<T, BucketResult> {
  name: '$bucket'
  specification: BucketSpec<T>
}

/**
 * BucketAuto stage interface
 */
export interface BucketAutoStage<T> extends Stage<T, BucketResult> {
  name: '$bucketAuto'
  specification: BucketAutoSpec<T>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a nested value from an object using dot notation
 */
function getFieldValue(obj: unknown, field: string): unknown {
  if (obj === null || obj === undefined) return undefined

  const path = field.startsWith('$') ? field.slice(1) : field
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Find the bucket index for a value
 */
function findBucketIndex(value: number, boundaries: number[]): number {
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (value >= boundaries[i]! && value < boundaries[i + 1]!) {
      return i
    }
  }
  return -1 // Outside boundaries
}

/**
 * Accumulator state
 */
interface AccumulatorState {
  type: string
  field?: string
  value: unknown
  count?: number
  values?: unknown[]
  set?: Set<string>
}

/**
 * Initialize accumulator state
 */
function initAccumulator(acc: Accumulator | { $count: Record<string, never> }): AccumulatorState {
  if ('$sum' in acc) {
    const sumSpec = acc as { $sum: string | number }
    return {
      type: '$sum',
      field: typeof sumSpec.$sum === 'string' ? sumSpec.$sum : undefined,
      value: typeof sumSpec.$sum === 'number' ? 0 : 0,
    }
  }
  if ('$count' in acc) {
    return { type: '$count', value: 0 }
  }
  if ('$avg' in acc) {
    const avgSpec = acc as { $avg: string }
    return { type: '$avg', field: avgSpec.$avg, value: 0, count: 0 }
  }
  if ('$min' in acc) {
    const minSpec = acc as { $min: string }
    return { type: '$min', field: minSpec.$min, value: undefined }
  }
  if ('$max' in acc) {
    const maxSpec = acc as { $max: string }
    return { type: '$max', field: maxSpec.$max, value: undefined }
  }
  if ('$first' in acc) {
    const firstSpec = acc as { $first: string }
    return { type: '$first', field: firstSpec.$first, value: undefined }
  }
  if ('$last' in acc) {
    const lastSpec = acc as { $last: string }
    return { type: '$last', field: lastSpec.$last, value: undefined }
  }
  if ('$push' in acc) {
    const pushSpec = acc as { $push: string }
    return { type: '$push', field: pushSpec.$push, value: [], values: [] }
  }
  if ('$addToSet' in acc) {
    const addToSetSpec = acc as { $addToSet: string }
    return { type: '$addToSet', field: addToSetSpec.$addToSet, value: [], values: [], set: new Set() }
  }

  return { type: 'unknown', value: null }
}

/**
 * Update accumulator with a document
 */
function updateAccumulator(state: AccumulatorState, doc: unknown): void {
  switch (state.type) {
    case '$sum': {
      const val = state.field ? getFieldValue(doc, state.field) : 1
      const addValue = typeof val === 'number' ? val : 0
      state.value = (state.value as number) + addValue
      break
    }

    case '$count':
      state.value = (state.value as number) + 1
      break

    case '$avg': {
      const val = getFieldValue(doc, state.field!)
      if (val !== null && val !== undefined && typeof val === 'number') {
        state.value = (state.value as number) + val
        state.count = (state.count || 0) + 1
      }
      break
    }

    case '$min': {
      const val = getFieldValue(doc, state.field!)
      if (val !== null && val !== undefined) {
        if (state.value === undefined || (val as number) < (state.value as number)) {
          state.value = val
        }
      }
      break
    }

    case '$max': {
      const val = getFieldValue(doc, state.field!)
      if (val !== null && val !== undefined) {
        if (state.value === undefined || (val as number) > (state.value as number)) {
          state.value = val
        }
      }
      break
    }

    case '$first': {
      if (state.value === undefined) {
        state.value = getFieldValue(doc, state.field!)
      }
      break
    }

    case '$last': {
      state.value = getFieldValue(doc, state.field!)
      break
    }

    case '$push': {
      const val = getFieldValue(doc, state.field!)
      ;(state.values as unknown[]).push(val)
      state.value = state.values
      break
    }

    case '$addToSet': {
      const val = getFieldValue(doc, state.field!)
      const key = JSON.stringify(val)
      if (!state.set!.has(key)) {
        state.set!.add(key)
        ;(state.values as unknown[]).push(val)
        state.value = state.values
      }
      break
    }
  }
}

/**
 * Finalize accumulator value
 */
function finalizeAccumulator(state: AccumulatorState): unknown {
  if (state.type === '$avg') {
    if (!state.count || state.count === 0) return null
    return (state.value as number) / state.count
  }
  return state.value
}

/**
 * Get preferred numbers for a granularity
 */
function getPreferredNumbers(granularity: Granularity): number[] {
  switch (granularity) {
    case 'R5':
      return [1.0, 1.6, 2.5, 4.0, 6.3]
    case 'R10':
      return [1.0, 1.25, 1.6, 2.0, 2.5, 3.15, 4.0, 5.0, 6.3, 8.0]
    case 'R20':
      return [1.0, 1.12, 1.25, 1.4, 1.6, 1.8, 2.0, 2.24, 2.5, 2.8, 3.15, 3.55, 4.0, 4.5, 5.0, 5.6, 6.3, 7.1, 8.0, 9.0]
    case 'R40':
    case 'R80':
      // Simplified - use R20 subdivisions
      return [1.0, 1.06, 1.12, 1.18, 1.25, 1.32, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.12, 2.24, 2.36, 2.5, 2.65, 2.8, 3.0, 3.15, 3.35, 3.55, 3.75, 4.0, 4.25, 4.5, 4.75, 5.0, 5.3, 5.6, 6.0, 6.3, 6.7, 7.1, 7.5, 8.0, 8.5, 9.0, 9.5]
    case '1-2-5':
      return [1.0, 2.0, 5.0]
    case 'E6':
      return [1.0, 1.5, 2.2, 3.3, 4.7, 6.8]
    case 'E12':
      return [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]
    case 'E24':
      return [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1]
    case 'E48':
    case 'E96':
    case 'E192':
      // Use E24 as approximation
      return [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1]
    case 'POWERSOF2':
      return [1, 2, 4, 8]
    default:
      return [1.0, 2.0, 5.0]
  }
}

/**
 * Round a value to the nearest preferred number
 */
function roundToPreferred(value: number, preferred: number[]): number {
  if (value <= 0) return preferred[0]!

  // Find the power of 10
  const magnitude = Math.floor(Math.log10(value))
  const scale = Math.pow(10, magnitude)
  const normalized = value / scale

  // Find the nearest preferred number
  let best = preferred[0]!
  let bestDiff = Math.abs(normalized - best)

  for (const p of preferred) {
    const diff = Math.abs(normalized - p)
    if (diff < bestDiff) {
      bestDiff = diff
      best = p
    }
  }

  // Also check the previous decade (multiply by 10)
  for (const p of preferred) {
    const diff = Math.abs(normalized - p * 10)
    if (diff < bestDiff) {
      bestDiff = diff
      best = p * 10
    }
  }

  return best * scale
}

/**
 * Generate bucket boundaries for bucketAuto
 */
function generateAutoBucketBoundaries(
  values: number[],
  numBuckets: number,
  granularity?: Granularity
): number[] {
  if (values.length === 0) return [0, 1]

  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]!
  const max = sorted[sorted.length - 1]!

  // Handle edge case where all values are the same
  if (min === max) {
    if (granularity) {
      const preferred = getPreferredNumbers(granularity)
      const lower = roundToPreferred(min * 0.9, preferred)
      const upper = roundToPreferred(min * 1.1, preferred)
      return [lower, upper]
    }
    return [min, min + 1]
  }

  // Calculate equal-width bucket boundaries
  const range = max - min
  const bucketWidth = range / numBuckets

  const boundaries: number[] = []

  if (granularity) {
    const preferred = getPreferredNumbers(granularity)

    // Round boundaries to preferred numbers
    for (let i = 0; i <= numBuckets; i++) {
      const rawBoundary = min + i * bucketWidth
      const rounded = roundToPreferred(rawBoundary, preferred)
      if (boundaries.length === 0 || rounded > boundaries[boundaries.length - 1]!) {
        boundaries.push(rounded)
      }
    }

    // Ensure we have at least 2 boundaries
    if (boundaries.length < 2) {
      boundaries.length = 0
      boundaries.push(roundToPreferred(min, preferred))
      boundaries.push(roundToPreferred(max * 1.1, preferred))
    }
  } else {
    // Simple equal-width boundaries
    for (let i = 0; i <= numBuckets; i++) {
      boundaries.push(min + i * bucketWidth)
    }
  }

  return boundaries
}

// ============================================================================
// Bucket Stage Factory
// ============================================================================

/**
 * Create a $bucket stage for histogram binning with explicit boundaries
 */
export function createBucketStage<T>(spec: BucketSpec<T>): BucketStage<T> {
  // Validate boundaries are sorted
  for (let i = 1; i < spec.boundaries.length; i++) {
    if (spec.boundaries[i]! <= spec.boundaries[i - 1]!) {
      throw new Error('$bucket boundaries must be sorted in ascending order')
    }
  }

  return {
    name: '$bucket',
    specification: spec,

    process(input: T[]): BucketResult[] {
      // Initialize buckets
      const buckets = new Map<string, {
        id: number | string | null
        states: Map<string, AccumulatorState>
        count: number
      }>()

      // Create bucket for each boundary range
      for (let i = 0; i < spec.boundaries.length - 1; i++) {
        const id = spec.boundaries[i]!
        const states = new Map<string, AccumulatorState>()

        // Always add count
        states.set('count', initAccumulator({ $count: {} }))

        // Add output accumulators
        if (spec.output) {
          for (const [field, acc] of Object.entries(spec.output)) {
            states.set(field, initAccumulator(acc))
          }
        }

        buckets.set(String(id), { id, states, count: 0 })
      }

      // Create default bucket if specified
      if (spec.default !== undefined) {
        const states = new Map<string, AccumulatorState>()
        states.set('count', initAccumulator({ $count: {} }))
        if (spec.output) {
          for (const [field, acc] of Object.entries(spec.output)) {
            states.set(field, initAccumulator(acc))
          }
        }
        buckets.set('__default__', { id: spec.default, states, count: 0 })
      }

      // Process documents
      for (const doc of input) {
        const value = getFieldValue(doc, spec.groupBy)

        if (value === null || value === undefined || typeof value !== 'number') {
          // Non-numeric values go to default bucket
          if (spec.default !== undefined) {
            const bucket = buckets.get('__default__')!
            bucket.count++
            for (const state of bucket.states.values()) {
              updateAccumulator(state, doc)
            }
          }
          continue
        }

        const bucketIndex = findBucketIndex(value, spec.boundaries)

        if (bucketIndex >= 0) {
          const bucketKey = String(spec.boundaries[bucketIndex])
          const bucket = buckets.get(bucketKey)!
          bucket.count++
          for (const state of bucket.states.values()) {
            updateAccumulator(state, doc)
          }
        } else if (spec.default !== undefined) {
          // Outside boundaries - go to default
          const bucket = buckets.get('__default__')!
          bucket.count++
          for (const state of bucket.states.values()) {
            updateAccumulator(state, doc)
          }
        }
      }

      // Build results
      const results: BucketResult[] = []

      // First, add boundary buckets in order
      for (let i = 0; i < spec.boundaries.length - 1; i++) {
        const id = spec.boundaries[i]!
        const bucket = buckets.get(String(id))!

        // Only include buckets with documents (or if explicitly requested)
        if (bucket.count > 0) {
          const result: BucketResult = {
            _id: id,
            count: bucket.count,
          }

          if (spec.output) {
            for (const [field, state] of bucket.states) {
              if (field !== 'count') {
                result[field] = finalizeAccumulator(state)
              }
            }
          }

          results.push(result)
        }
      }

      // Add default bucket if it has documents
      if (spec.default !== undefined) {
        const bucket = buckets.get('__default__')!
        if (bucket.count > 0) {
          const result: BucketResult = {
            _id: bucket.id,
            count: bucket.count,
          }

          if (spec.output) {
            for (const [field, state] of bucket.states) {
              if (field !== 'count') {
                result[field] = finalizeAccumulator(state)
              }
            }
          }

          results.push(result)
        }
      }

      return results
    },
  }
}

/**
 * Create a $bucketAuto stage for automatic histogram binning
 */
export function createBucketAutoStage<T>(spec: BucketAutoSpec<T>): BucketAutoStage<T> {
  if (spec.buckets < 1) {
    throw new Error('$bucketAuto buckets must be at least 1')
  }

  return {
    name: '$bucketAuto',
    specification: spec,

    process(input: T[]): BucketResult[] {
      if (input.length === 0) return []

      // Extract values for the groupBy field
      const values: number[] = []
      for (const doc of input) {
        const value = getFieldValue(doc, spec.groupBy)
        if (typeof value === 'number') {
          values.push(value)
        }
      }

      if (values.length === 0) return []

      // Generate boundaries
      const boundaries = generateAutoBucketBoundaries(
        values,
        spec.buckets,
        spec.granularity
      )

      // Initialize buckets with min/max as _id
      const buckets = new Map<number, {
        min: number
        max: number
        states: Map<string, AccumulatorState>
        count: number
      }>()

      for (let i = 0; i < boundaries.length - 1; i++) {
        const states = new Map<string, AccumulatorState>()
        states.set('count', initAccumulator({ $count: {} }))

        if (spec.output) {
          for (const [field, acc] of Object.entries(spec.output)) {
            states.set(field, initAccumulator(acc))
          }
        }

        buckets.set(i, {
          min: boundaries[i]!,
          max: boundaries[i + 1]!,
          states,
          count: 0,
        })
      }

      // Process documents
      for (const doc of input) {
        const value = getFieldValue(doc, spec.groupBy)

        if (typeof value !== 'number') continue

        // Find the appropriate bucket
        let bucketIndex = -1
        for (let i = 0; i < boundaries.length - 1; i++) {
          const min = boundaries[i]!
          const max = boundaries[i + 1]!

          // Last bucket includes the max value
          if (i === boundaries.length - 2) {
            if (value >= min && value <= max) {
              bucketIndex = i
              break
            }
          } else {
            if (value >= min && value < max) {
              bucketIndex = i
              break
            }
          }
        }

        // If value is exactly at or beyond boundaries, put in last bucket
        if (bucketIndex === -1 && value >= boundaries[boundaries.length - 2]!) {
          bucketIndex = boundaries.length - 2
        }

        if (bucketIndex >= 0 && buckets.has(bucketIndex)) {
          const bucket = buckets.get(bucketIndex)!
          bucket.count++
          for (const state of bucket.states.values()) {
            updateAccumulator(state, doc)
          }
        }
      }

      // Build results
      const results: BucketResult[] = []

      for (const [index, bucket] of buckets) {
        if (bucket.count > 0) {
          const result: BucketResult = {
            _id: { min: bucket.min, max: bucket.max },
            count: bucket.count,
          }

          if (spec.output) {
            for (const [field, state] of bucket.states) {
              if (field !== 'count') {
                result[field] = finalizeAccumulator(state)
              }
            }
          }

          results.push(result)
        }
      }

      // Sort by min value
      results.sort((a, b) => {
        const aMin = (a._id as { min: number }).min
        const bMin = (b._id as { min: number }).min
        return aMin - bMin
      })

      return results
    },
  }
}
