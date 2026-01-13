/**
 * Iterators and Aggregators Module
 *
 * Provides standardized patterns for:
 * - Async iteration over data sources
 * - Memory-efficient streaming
 * - Backpressure-aware processing
 * - Lazy evaluation
 * - Data aggregation and collection
 *
 * @example
 * ```typescript
 * import { iterate, collect, aggregate } from 'lib/iterators'
 *
 * // Iterator - array to individual items
 * for await (const item of iterate([1, 2, 3])) {
 *   console.log(item)
 * }
 *
 * // Aggregator - items to array
 * const items = await collect(asyncGenerator())
 *
 * // Numeric aggregator
 * const stats = await aggregate.numeric(asyncGenerator())
 * console.log(stats.sum, stats.avg, stats.min, stats.max)
 * ```
 *
 * @module lib/iterators
 */

export * from './types'
export * from './iterator'
export * from './aggregators'
export * from './backpressure'
export * from './transforms'
