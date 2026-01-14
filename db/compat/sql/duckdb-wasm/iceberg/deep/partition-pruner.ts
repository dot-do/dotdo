/**
 * Partition Pruner for Iceberg Tables
 *
 * Implements partition pruning based on:
 * - Identity transform partitions
 * - Temporal partitions (year, month, day, hour)
 * - Bucket partitions
 * - Column min/max statistics
 *
 * @module db/compat/sql/duckdb-wasm/iceberg/deep/partition-pruner
 */

import type {
  PartitionPruner,
  Partition,
  PruningOptions,
  PartitionPruningResult,
  FilterPredicate,
} from './types'
import type { PartitionSpec, PartitionField } from '../types'

// ============================================================================
// Transform Utilities
// ============================================================================

/**
 * Parse bucket transform to get bucket count
 */
function parseBucketTransform(transform: string): number | null {
  const match = transform.match(/^bucket\[(\d+)\]$/i)
  return match && match[1] ? parseInt(match[1]) : null
}

/**
 * Parse truncate transform to get width
 */
function parseTruncateTransform(transform: string): number | null {
  const match = transform.match(/^truncate\[(\d+)\]$/i)
  return match && match[1] ? parseInt(match[1]) : null
}

/**
 * Calculate bucket for a value
 * Uses Murmur3 hash (simplified)
 */
function calculateBucket(value: unknown, numBuckets: number): number {
  // Simplified hash - in production, use proper Murmur3
  const str = String(value)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash % numBuckets)
}

/**
 * Extract year from date/timestamp
 */
function extractYear(value: string | Date): number {
  const date = value instanceof Date ? value : new Date(value)
  return date.getUTCFullYear()
}

/**
 * Extract month from date/timestamp (months since Unix epoch)
 */
function extractMonth(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Extract day from date/timestamp
 */
function extractDay(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Extract hour from timestamp
 */
function extractHour(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  const day = extractDay(date)
  const hour = String(date.getUTCHours()).padStart(2, '0')
  return `${day}-${hour}`
}

// ============================================================================
// Predicate Evaluation
// ============================================================================

/**
 * Evaluate predicate against partition value
 */
function evaluatePredicate(
  partitionValue: unknown,
  predicate: FilterPredicate
): boolean {
  switch (predicate.op) {
    case '=':
      return partitionValue === predicate.value

    case '!=':
      return partitionValue !== predicate.value

    case '>':
      return (partitionValue as string | number) > (predicate.value as string | number)

    case '>=':
      return (partitionValue as string | number) >= (predicate.value as string | number)

    case '<':
      return (partitionValue as string | number) < (predicate.value as string | number)

    case '<=':
      return (partitionValue as string | number) <= (predicate.value as string | number)

    case 'IN':
      return (predicate.value as unknown[]).includes(partitionValue)

    case 'NOT IN':
      return !(predicate.value as unknown[]).includes(partitionValue)

    case 'BETWEEN': {
      const pv = partitionValue as string | number
      const v1 = predicate.value as string | number
      const v2 = predicate.value2 as string | number
      return pv >= v1 && pv <= v2
    }

    case 'IS NULL':
      return partitionValue === null || partitionValue === undefined

    case 'IS NOT NULL':
      return partitionValue !== null && partitionValue !== undefined

    default:
      return true // Unknown operator, don't prune
  }
}

/**
 * Check if a range overlaps with predicate
 */
function rangeMatchesPredicate(
  min: unknown,
  max: unknown,
  predicate: FilterPredicate
): boolean {
  const minVal = min as string | number
  const maxVal = max as string | number
  const predicateVal = predicate.value as string | number

  switch (predicate.op) {
    case '=':
      return minVal <= predicateVal && predicateVal <= maxVal

    case '!=':
      // Can only prune if entire range equals the value
      return !(minVal === predicateVal && maxVal === predicateVal)

    case '>':
      return maxVal > predicateVal

    case '>=':
      return maxVal >= predicateVal

    case '<':
      return minVal < predicateVal

    case '<=':
      return minVal <= predicateVal

    case 'BETWEEN': {
      const v1 = predicate.value as string | number
      const v2 = predicate.value2 as string | number
      return maxVal >= v1 && minVal <= v2
    }

    case 'IN': {
      const inValues = predicate.value as unknown[]
      // Check if any IN value falls within range
      return inValues.some(
        (v) => (v as string | number) >= minVal && (v as string | number) <= maxVal
      )
    }

    default:
      return true
  }
}

// ============================================================================
// Transform-Based Pruning
// ============================================================================

/**
 * Get partition value for temporal transform
 */
function getTemporalPartitionValue(
  transform: string,
  filterValue: unknown
): unknown {
  const value = filterValue as string | Date

  switch (transform) {
    case 'year':
      return extractYear(value)

    case 'month':
      return extractMonth(value)

    case 'day':
      return extractDay(value)

    case 'hour':
      return extractHour(value)

    default:
      return value
  }
}

/**
 * Check if temporal partition matches filter
 */
function temporalPartitionMatches(
  partitionValue: unknown,
  transform: string,
  predicate: FilterPredicate
): boolean {
  // Transform filter value to partition format
  const transformedFilterValue = getTemporalPartitionValue(transform, predicate.value)

  // For BETWEEN, also transform the second value
  if (predicate.op === 'BETWEEN') {
    const transformedValue2 = getTemporalPartitionValue(transform, predicate.value2)
    return evaluatePredicate(partitionValue, {
      ...predicate,
      value: transformedFilterValue,
      value2: transformedValue2,
    })
  }

  return evaluatePredicate(partitionValue, {
    ...predicate,
    value: transformedFilterValue,
  })
}

// ============================================================================
// Partition Pruner Implementation
// ============================================================================

class PartitionPrunerImpl implements PartitionPruner {
  /**
   * Prune partitions based on partition spec and filters
   */
  prunePartitions(
    partitions: Partition[],
    partitionSpec: PartitionSpec,
    options: PruningOptions
  ): PartitionPruningResult {
    const totalCount = partitions.length
    let selected = [...partitions]

    for (const filter of options.filters) {
      // Find matching partition field
      const partitionField = partitionSpec.fields.find(
        (f) => f.name === filter.column
      )

      if (!partitionField) {
        // Check if filter column maps to a source column with a transform
        const transformedField = this.findTransformedField(
          partitionSpec,
          filter.column
        )

        if (transformedField) {
          selected = this.pruneByTransform(
            selected,
            transformedField,
            filter
          )
        }
        continue
      }

      // Prune based on partition field
      selected = selected.filter((partition) => {
        const partitionValue = partition.values[partitionField.name]
        const transform = partitionField.transform

        if (transform === 'identity') {
          return evaluatePredicate(partitionValue, filter)
        }

        // Handle temporal transforms
        // For temporal partitions, the partition values are already transformed
        // (e.g., year=2023), so we compare directly using evaluatePredicate
        if (['year', 'month', 'day', 'hour'].includes(transform)) {
          // Direct comparison since partition values are already in transformed format
          return evaluatePredicate(partitionValue, filter)
        }

        // Handle bucket transform
        const bucketCount = parseBucketTransform(transform)
        if (bucketCount !== null && filter.op === '=') {
          const expectedBucket = calculateBucket(filter.value, bucketCount)
          return partitionValue === expectedBucket
        }

        // Can't prune, include partition
        return true
      })
    }

    return {
      selectedPartitions: selected,
      prunedCount: totalCount - selected.length,
      totalCount,
    }
  }

  /**
   * Find partition field that applies a transform to the filter column
   */
  private findTransformedField(
    partitionSpec: PartitionSpec,
    columnName: string
  ): PartitionField | null {
    // In a full implementation, we would look up the source column name
    // from the schema using sourceId. For now, check for common patterns.
    return partitionSpec.fields.find((f) => {
      // Check if partition name suggests it's derived from the column
      // e.g., "timestamp" -> "timestamp_day", "event_day", etc.
      const lowerName = f.name.toLowerCase()
      const lowerColumn = columnName.toLowerCase()
      return (
        lowerName.includes(lowerColumn) ||
        lowerName.replace(/_(?:year|month|day|hour)$/, '') === lowerColumn
      )
    }) ?? null
  }

  /**
   * Prune partitions using transformed partition field
   */
  private pruneByTransform(
    partitions: Partition[],
    field: PartitionField,
    filter: FilterPredicate
  ): Partition[] {
    const transform = field.transform

    return partitions.filter((partition) => {
      const partitionValue = partition.values[field.name]

      // Handle temporal transforms
      if (['year', 'month', 'day', 'hour'].includes(transform)) {
        return temporalPartitionMatches(partitionValue, transform, filter)
      }

      // Can't prune by this transform
      return true
    })
  }

  /**
   * Prune using column min/max statistics
   */
  pruneByStats(
    partitions: Partition[],
    options: PruningOptions
  ): PartitionPruningResult {
    const totalCount = partitions.length
    let selected = [...partitions]

    for (const filter of options.filters) {
      selected = selected.filter((partition) => {
        const stats = partition.columnStats

        if (!stats) {
          return true // No stats, can't prune
        }

        // Check for min/max stats for this column
        const minKey = `min_${filter.column}`
        const maxKey = `max_${filter.column}`
        const min = stats[minKey]
        const max = stats[maxKey]

        if (min === undefined || max === undefined) {
          return true // No stats for this column, can't prune
        }

        return rangeMatchesPredicate(min, max, filter)
      })
    }

    return {
      selectedPartitions: selected,
      prunedCount: totalCount - selected.length,
      totalCount,
    }
  }

  /**
   * Combined pruning using both partition values and statistics
   */
  prune(
    partitions: Partition[],
    partitionSpec: PartitionSpec,
    options: PruningOptions
  ): PartitionPruningResult {
    const totalCount = partitions.length

    // First, prune by partition values
    const partitionPruned = this.prunePartitions(partitions, partitionSpec, options)

    // Then, prune by statistics
    const statsPruned = this.pruneByStats(
      partitionPruned.selectedPartitions,
      options
    )

    return {
      selectedPartitions: statsPruned.selectedPartitions,
      prunedCount: totalCount - statsPruned.selectedPartitions.length,
      totalCount,
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a partition pruner
 *
 * @returns Partition pruner instance
 *
 * @example
 * ```typescript
 * const pruner = createPartitionPruner()
 *
 * const result = pruner.prunePartitions(partitions, partitionSpec, {
 *   filters: [
 *     { column: 'region', op: '=', value: 'us-west-2' },
 *     { column: 'timestamp', op: '>=', value: '2024-01-01' },
 *   ],
 * })
 *
 * console.log(`Pruned ${result.prunedCount} of ${result.totalCount} partitions`)
 * ```
 */
export function createPartitionPruner(): PartitionPruner {
  return new PartitionPrunerImpl()
}
