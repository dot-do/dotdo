/**
 * Elasticsearch Aggregations
 *
 * Aggregation execution for analytics queries.
 * Supports bucket aggregations (terms, histogram, date_histogram, range)
 * and metric aggregations (avg, sum, min, max, cardinality, stats).
 *
 * @module db/compat/elasticsearch/aggregations
 */

import type { ElasticsearchIndexer, IndexedDocument } from './indexer'
import type {
  Document,
  Aggregation,
  AggregationResult,
  TermsAggregationResult,
  HistogramAggregationResult,
  DateHistogramAggregationResult,
  RangeAggregationResult,
  MetricAggregationResult,
  StatsAggregationResult,
  ExtendedStatsAggregationResult,
  PercentilesAggregationResult,
  TopHitsAggregationResult,
  Query,
  SearchHits,
  Hit,
} from './types'
import type { SearchExecutor } from './search'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Context for aggregation execution
 */
export interface AggregationContext {
  /** Documents to aggregate over */
  documents: IndexedDocument[]
  /** Parent aggregation results (for sub-aggregations) */
  parent?: AggregationResult
}

// ============================================================================
// AGGREGATION EXECUTOR
// ============================================================================

/**
 * Elasticsearch-compatible aggregation executor
 *
 * Executes aggregations over document sets to compute
 * bucket and metric aggregations.
 */
export class AggregationExecutor {
  private indexer: ElasticsearchIndexer
  private searchExecutor?: SearchExecutor

  constructor(indexer: ElasticsearchIndexer, searchExecutor?: SearchExecutor) {
    this.indexer = indexer
    this.searchExecutor = searchExecutor
  }

  /**
   * Execute aggregations over a set of documents
   */
  execute(
    aggregations: Record<string, Aggregation>,
    documents: IndexedDocument[]
  ): Record<string, AggregationResult> {
    const results: Record<string, AggregationResult> = {}

    for (const [name, agg] of Object.entries(aggregations)) {
      results[name] = this.executeAggregation(agg, documents)
    }

    return results
  }

  /**
   * Execute a single aggregation
   */
  private executeAggregation(
    agg: Aggregation,
    documents: IndexedDocument[]
  ): AggregationResult {
    // Terms aggregation
    if ('terms' in agg) {
      return this.executeTerms(agg, documents)
    }

    // Histogram aggregation
    if ('histogram' in agg) {
      return this.executeHistogram(agg, documents)
    }

    // Date histogram aggregation
    if ('date_histogram' in agg) {
      return this.executeDateHistogram(agg, documents)
    }

    // Range aggregation
    if ('range' in agg) {
      return this.executeRange(agg, documents)
    }

    // Date range aggregation
    if ('date_range' in agg) {
      return this.executeDateRange(agg, documents)
    }

    // Avg aggregation
    if ('avg' in agg) {
      return this.executeAvg(agg.avg, documents)
    }

    // Sum aggregation
    if ('sum' in agg) {
      return this.executeSum(agg.sum, documents)
    }

    // Min aggregation
    if ('min' in agg) {
      return this.executeMin(agg.min, documents)
    }

    // Max aggregation
    if ('max' in agg) {
      return this.executeMax(agg.max, documents)
    }

    // Value count aggregation
    if ('value_count' in agg) {
      return this.executeValueCount(agg.value_count, documents)
    }

    // Cardinality aggregation
    if ('cardinality' in agg) {
      return this.executeCardinality(agg.cardinality, documents)
    }

    // Stats aggregation
    if ('stats' in agg) {
      return this.executeStats(agg.stats, documents)
    }

    // Extended stats aggregation
    if ('extended_stats' in agg) {
      return this.executeExtendedStats(agg.extended_stats, documents)
    }

    // Percentiles aggregation
    if ('percentiles' in agg) {
      return this.executePercentiles(agg.percentiles, documents)
    }

    // Top hits aggregation
    if ('top_hits' in agg) {
      return this.executeTopHits(agg.top_hits, documents)
    }

    // Filter aggregation
    if ('filter' in agg) {
      return this.executeFilter(agg, documents) as AggregationResult
    }

    // Filters aggregation
    if ('filters' in agg) {
      return this.executeFilters(agg, documents) as AggregationResult
    }

    // Nested aggregation
    if ('nested' in agg) {
      return this.executeNested(agg, documents) as AggregationResult
    }

    // Unknown aggregation type
    console.warn('Unknown aggregation type:', Object.keys(agg))
    return { value: null }
  }

  // ==========================================================================
  // BUCKET AGGREGATIONS
  // ==========================================================================

  private executeTerms(
    agg: { terms: { field: string; size?: number; min_doc_count?: number; order?: unknown; missing?: string | number }; aggs?: Record<string, Aggregation> },
    documents: IndexedDocument[]
  ): TermsAggregationResult & Record<string, unknown> {
    const { field, size = 10, min_doc_count = 1, missing } = agg.terms

    // Count terms
    const termCounts = new Map<string | number, IndexedDocument[]>()

    for (const doc of documents) {
      const values = this.getFieldValues(doc._source, field)

      if (values.length === 0 && missing !== undefined) {
        const key = missing
        const existing = termCounts.get(key) || []
        existing.push(doc)
        termCounts.set(key, existing)
      } else {
        for (const value of values) {
          const key = value as string | number
          const existing = termCounts.get(key) || []
          existing.push(doc)
          termCounts.set(key, existing)
        }
      }
    }

    // Build buckets
    let buckets = Array.from(termCounts.entries())
      .filter(([_, docs]) => docs.length >= min_doc_count)
      .map(([key, docs]) => {
        const bucket: Record<string, unknown> = {
          key,
          doc_count: docs.length,
        }

        // Execute sub-aggregations
        if (agg.aggs) {
          const subResults = this.execute(agg.aggs, docs)
          Object.assign(bucket, subResults)
        }

        return bucket
      })

    // Sort buckets (default by doc_count desc)
    buckets.sort((a, b) => (b.doc_count as number) - (a.doc_count as number))

    // Apply size limit
    const sumOtherDocCount = buckets.slice(size).reduce((sum, b) => sum + (b.doc_count as number), 0)
    buckets = buckets.slice(0, size)

    return {
      buckets: buckets as Array<{ key: string | number; key_as_string?: string; doc_count: number }>,
      doc_count_error_upper_bound: 0,
      sum_other_doc_count: sumOtherDocCount,
    }
  }

  private executeHistogram(
    agg: { histogram: { field: string; interval: number; min_doc_count?: number; offset?: number; extended_bounds?: { min: number; max: number } }; aggs?: Record<string, Aggregation> },
    documents: IndexedDocument[]
  ): HistogramAggregationResult & Record<string, unknown> {
    const { field, interval, min_doc_count = 0, offset = 0, extended_bounds } = agg.histogram

    // Group documents into histogram buckets
    const bucketDocs = new Map<number, IndexedDocument[]>()

    for (const doc of documents) {
      const value = this.getNumericValue(doc._source, field)
      if (value === null) continue

      const bucketKey = Math.floor((value - offset) / interval) * interval + offset
      const existing = bucketDocs.get(bucketKey) || []
      existing.push(doc)
      bucketDocs.set(bucketKey, existing)
    }

    // Build buckets
    const buckets: Array<Record<string, unknown>> = []

    // Determine bucket range
    let minBucket = Math.min(...bucketDocs.keys())
    let maxBucket = Math.max(...bucketDocs.keys())

    if (extended_bounds) {
      minBucket = Math.min(minBucket, Math.floor((extended_bounds.min - offset) / interval) * interval + offset)
      maxBucket = Math.max(maxBucket, Math.floor((extended_bounds.max - offset) / interval) * interval + offset)
    }

    // Create all buckets in range
    for (let key = minBucket; key <= maxBucket; key += interval) {
      const docs = bucketDocs.get(key) || []
      if (docs.length < min_doc_count && !extended_bounds) continue

      const bucket: Record<string, unknown> = {
        key,
        doc_count: docs.length,
      }

      if (agg.aggs) {
        const subResults = this.execute(agg.aggs, docs)
        Object.assign(bucket, subResults)
      }

      buckets.push(bucket)
    }

    return {
      buckets: buckets as Array<{ key: number; key_as_string?: string; doc_count: number }>,
    }
  }

  private executeDateHistogram(
    agg: { date_histogram: { field: string; calendar_interval?: string; fixed_interval?: string; min_doc_count?: number; format?: string; time_zone?: string }; aggs?: Record<string, Aggregation> },
    documents: IndexedDocument[]
  ): DateHistogramAggregationResult & Record<string, unknown> {
    const { field, calendar_interval, fixed_interval, min_doc_count = 0, format } = agg.date_histogram

    // Determine interval in milliseconds
    const intervalMs = this.parseInterval(calendar_interval || fixed_interval || '1d')

    // Group documents into buckets
    const bucketDocs = new Map<number, IndexedDocument[]>()

    for (const doc of documents) {
      const value = this.getDateValue(doc._source, field)
      if (value === null) continue

      const bucketKey = Math.floor(value / intervalMs) * intervalMs
      const existing = bucketDocs.get(bucketKey) || []
      existing.push(doc)
      bucketDocs.set(bucketKey, existing)
    }

    // Build buckets
    const buckets: Array<Record<string, unknown>> = []
    const sortedKeys = Array.from(bucketDocs.keys()).sort((a, b) => a - b)

    for (const key of sortedKeys) {
      const docs = bucketDocs.get(key) || []
      if (docs.length < min_doc_count) continue

      const bucket: Record<string, unknown> = {
        key,
        key_as_string: new Date(key).toISOString(),
        doc_count: docs.length,
      }

      if (agg.aggs) {
        const subResults = this.execute(agg.aggs, docs)
        Object.assign(bucket, subResults)
      }

      buckets.push(bucket)
    }

    return {
      buckets: buckets as Array<{ key: number; key_as_string: string; doc_count: number }>,
    }
  }

  private executeRange(
    agg: { range: { field: string; ranges: Array<{ key?: string; from?: number; to?: number }>; keyed?: boolean }; aggs?: Record<string, Aggregation> },
    documents: IndexedDocument[]
  ): RangeAggregationResult & Record<string, unknown> {
    const { field, ranges, keyed = false } = agg.range

    const buckets: Array<Record<string, unknown>> = []

    for (const range of ranges) {
      const { key, from, to } = range
      const bucketKey = key || `${from ?? '*'}-${to ?? '*'}`

      const docs = documents.filter((doc) => {
        const value = this.getNumericValue(doc._source, field)
        if (value === null) return false

        if (from !== undefined && value < from) return false
        if (to !== undefined && value >= to) return false

        return true
      })

      const bucket: Record<string, unknown> = {
        key: bucketKey,
        doc_count: docs.length,
      }

      if (from !== undefined) bucket.from = from
      if (to !== undefined) bucket.to = to

      if (agg.aggs) {
        const subResults = this.execute(agg.aggs, docs)
        Object.assign(bucket, subResults)
      }

      buckets.push(bucket)
    }

    if (keyed) {
      const keyedBuckets: Record<string, Record<string, unknown>> = {}
      for (const bucket of buckets) {
        keyedBuckets[bucket.key as string] = bucket
      }
      return { buckets: keyedBuckets as unknown as Array<{ key?: string; from?: number; to?: number; doc_count: number }> }
    }

    return {
      buckets: buckets as Array<{ key?: string; from?: number; to?: number; doc_count: number }>,
    }
  }

  private executeDateRange(
    agg: { date_range: { field: string; format?: string; ranges: Array<{ key?: string; from?: string | number; to?: string | number }> }; aggs?: Record<string, Aggregation> },
    documents: IndexedDocument[]
  ): RangeAggregationResult & Record<string, unknown> {
    const { field, ranges } = agg.date_range

    const buckets: Array<Record<string, unknown>> = []

    for (const range of ranges) {
      const { key, from, to } = range

      const fromMs = from !== undefined ? this.parseDateValue(from) : undefined
      const toMs = to !== undefined ? this.parseDateValue(to) : undefined
      const bucketKey = key || `${from ?? '*'}-${to ?? '*'}`

      const docs = documents.filter((doc) => {
        const value = this.getDateValue(doc._source, field)
        if (value === null) return false

        if (fromMs !== undefined && value < fromMs) return false
        if (toMs !== undefined && value >= toMs) return false

        return true
      })

      const bucket: Record<string, unknown> = {
        key: bucketKey,
        doc_count: docs.length,
      }

      if (from !== undefined) bucket.from = fromMs
      if (to !== undefined) bucket.to = toMs

      if (agg.aggs) {
        const subResults = this.execute(agg.aggs, docs)
        Object.assign(bucket, subResults)
      }

      buckets.push(bucket)
    }

    return {
      buckets: buckets as Array<{ key?: string; from?: number; to?: number; doc_count: number }>,
    }
  }

  private executeFilter(
    agg: { filter: Query; aggs?: Record<string, Aggregation> },
    documents: IndexedDocument[]
  ): AggregationResult {
    // Execute filter query
    const filterDocs = this.filterDocuments(documents, agg.filter)

    const result: Record<string, unknown> = {
      doc_count: filterDocs.length,
    }

    if (agg.aggs) {
      const subResults = this.execute(agg.aggs, filterDocs)
      Object.assign(result, subResults)
    }

    return result as unknown as AggregationResult
  }

  private executeFilters(
    agg: { filters: { filters: Record<string, Query> | Query[]; other_bucket?: boolean; other_bucket_key?: string }; aggs?: Record<string, Aggregation> },
    documents: IndexedDocument[]
  ): AggregationResult {
    const { filters, other_bucket = false, other_bucket_key = '_other_' } = agg.filters

    const buckets: Record<string, Record<string, unknown>> = {}
    const matchedDocIds = new Set<string>()

    if (Array.isArray(filters)) {
      filters.forEach((filter, index) => {
        const filterDocs = this.filterDocuments(documents, filter)
        filterDocs.forEach((d) => matchedDocIds.add(d._id))

        const bucket: Record<string, unknown> = {
          doc_count: filterDocs.length,
        }

        if (agg.aggs) {
          Object.assign(bucket, this.execute(agg.aggs, filterDocs))
        }

        buckets[String(index)] = bucket
      })
    } else {
      for (const [name, filter] of Object.entries(filters)) {
        const filterDocs = this.filterDocuments(documents, filter)
        filterDocs.forEach((d) => matchedDocIds.add(d._id))

        const bucket: Record<string, unknown> = {
          doc_count: filterDocs.length,
        }

        if (agg.aggs) {
          Object.assign(bucket, this.execute(agg.aggs, filterDocs))
        }

        buckets[name] = bucket
      }
    }

    if (other_bucket) {
      const otherDocs = documents.filter((d) => !matchedDocIds.has(d._id))
      const otherBucket: Record<string, unknown> = {
        doc_count: otherDocs.length,
      }

      if (agg.aggs) {
        Object.assign(otherBucket, this.execute(agg.aggs, otherDocs))
      }

      buckets[other_bucket_key] = otherBucket
    }

    return {
      buckets: buckets as Record<string, { doc_count: number }>,
    } as AggregationResult
  }

  private executeNested(
    agg: { nested: { path: string }; aggs?: Record<string, Aggregation> },
    documents: IndexedDocument[]
  ): AggregationResult {
    const { path } = agg.nested

    // Flatten nested documents
    const nestedDocs: IndexedDocument[] = []

    for (const doc of documents) {
      const nestedArray = this.indexer.getFieldValue(doc._source, path)
      if (Array.isArray(nestedArray)) {
        for (const nested of nestedArray) {
          if (typeof nested === 'object' && nested !== null) {
            nestedDocs.push({
              ...doc,
              _source: nested as Document,
            })
          }
        }
      }
    }

    const result: Record<string, unknown> = {
      doc_count: nestedDocs.length,
    }

    if (agg.aggs) {
      const subResults = this.execute(agg.aggs, nestedDocs)
      Object.assign(result, subResults)
    }

    return result as unknown as AggregationResult
  }

  // ==========================================================================
  // METRIC AGGREGATIONS
  // ==========================================================================

  private executeAvg(
    config: { field: string; missing?: number },
    documents: IndexedDocument[]
  ): MetricAggregationResult {
    const values = this.getNumericValues(documents, config.field, config.missing)
    if (values.length === 0) return { value: null }

    const sum = values.reduce((a, b) => a + b, 0)
    return { value: sum / values.length }
  }

  private executeSum(
    config: { field: string; missing?: number },
    documents: IndexedDocument[]
  ): MetricAggregationResult {
    const values = this.getNumericValues(documents, config.field, config.missing)
    if (values.length === 0) return { value: 0 }

    return { value: values.reduce((a, b) => a + b, 0) }
  }

  private executeMin(
    config: { field: string; missing?: number },
    documents: IndexedDocument[]
  ): MetricAggregationResult {
    const values = this.getNumericValues(documents, config.field, config.missing)
    if (values.length === 0) return { value: null }

    return { value: Math.min(...values) }
  }

  private executeMax(
    config: { field: string; missing?: number },
    documents: IndexedDocument[]
  ): MetricAggregationResult {
    const values = this.getNumericValues(documents, config.field, config.missing)
    if (values.length === 0) return { value: null }

    return { value: Math.max(...values) }
  }

  private executeValueCount(
    config: { field: string },
    documents: IndexedDocument[]
  ): MetricAggregationResult {
    let count = 0
    for (const doc of documents) {
      const value = this.indexer.getFieldValue(doc._source, config.field)
      if (value !== undefined && value !== null) {
        count++
      }
    }
    return { value: count }
  }

  private executeCardinality(
    config: { field: string; precision_threshold?: number; missing?: string | number },
    documents: IndexedDocument[]
  ): MetricAggregationResult {
    const uniqueValues = new Set<string>()

    for (const doc of documents) {
      const values = this.getFieldValues(doc._source, config.field)
      if (values.length === 0 && config.missing !== undefined) {
        uniqueValues.add(String(config.missing))
      } else {
        for (const value of values) {
          uniqueValues.add(String(value))
        }
      }
    }

    return { value: uniqueValues.size }
  }

  private executeStats(
    config: { field: string; missing?: number },
    documents: IndexedDocument[]
  ): StatsAggregationResult {
    const values = this.getNumericValues(documents, config.field, config.missing)

    if (values.length === 0) {
      return {
        count: 0,
        min: null,
        max: null,
        avg: null,
        sum: 0,
      }
    }

    const sum = values.reduce((a, b) => a + b, 0)
    return {
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: sum / values.length,
      sum,
    }
  }

  private executeExtendedStats(
    config: { field: string; missing?: number; sigma?: number },
    documents: IndexedDocument[]
  ): ExtendedStatsAggregationResult {
    const values = this.getNumericValues(documents, config.field, config.missing)
    const sigma = config.sigma || 2

    if (values.length === 0) {
      return {
        count: 0,
        min: null,
        max: null,
        avg: null,
        sum: 0,
        sum_of_squares: null,
        variance: null,
        variance_population: null,
        variance_sampling: null,
        std_deviation: null,
        std_deviation_population: null,
        std_deviation_sampling: null,
        std_deviation_bounds: {
          upper: null,
          lower: null,
          upper_population: null,
          lower_population: null,
          upper_sampling: null,
          lower_sampling: null,
        },
      }
    }

    const sum = values.reduce((a, b) => a + b, 0)
    const avg = sum / values.length
    const sumOfSquares = values.reduce((a, b) => a + b * b, 0)
    const variancePopulation = values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length
    const varianceSampling = values.length > 1 ? values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / (values.length - 1) : 0
    const stdDevPopulation = Math.sqrt(variancePopulation)
    const stdDevSampling = Math.sqrt(varianceSampling)

    return {
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      avg,
      sum,
      sum_of_squares: sumOfSquares,
      variance: variancePopulation,
      variance_population: variancePopulation,
      variance_sampling: varianceSampling,
      std_deviation: stdDevPopulation,
      std_deviation_population: stdDevPopulation,
      std_deviation_sampling: stdDevSampling,
      std_deviation_bounds: {
        upper: avg + sigma * stdDevPopulation,
        lower: avg - sigma * stdDevPopulation,
        upper_population: avg + sigma * stdDevPopulation,
        lower_population: avg - sigma * stdDevPopulation,
        upper_sampling: avg + sigma * stdDevSampling,
        lower_sampling: avg - sigma * stdDevSampling,
      },
    }
  }

  private executePercentiles(
    config: { field: string; percents?: number[]; keyed?: boolean; missing?: number },
    documents: IndexedDocument[]
  ): PercentilesAggregationResult {
    const percents = config.percents || [1, 5, 25, 50, 75, 95, 99]
    const keyed = config.keyed !== false

    const values = this.getNumericValues(documents, config.field, config.missing)

    if (values.length === 0) {
      if (keyed) {
        const result: Record<string, number | null> = {}
        for (const p of percents) {
          result[String(p)] = null
        }
        return { values: result }
      }
      return { values: percents.map((key) => ({ key, value: null })) }
    }

    // Sort values for percentile calculation
    values.sort((a, b) => a - b)

    const calculatePercentile = (p: number): number => {
      const index = (p / 100) * (values.length - 1)
      const lower = Math.floor(index)
      const upper = Math.ceil(index)
      const weight = index - lower

      if (lower === upper) {
        return values[lower]!
      }
      return values[lower]! * (1 - weight) + values[upper]! * weight
    }

    if (keyed) {
      const result: Record<string, number | null> = {}
      for (const p of percents) {
        result[String(p)] = calculatePercentile(p)
      }
      return { values: result }
    }

    return {
      values: percents.map((key) => ({
        key,
        value: calculatePercentile(key),
      })),
    }
  }

  private executeTopHits(
    config: { size?: number; from?: number; sort?: unknown[]; _source?: unknown },
    documents: IndexedDocument[]
  ): TopHitsAggregationResult {
    const size = config.size || 3
    const from = config.from || 0

    // Simple sort by _id if no sort specified
    let sortedDocs = [...documents]

    // Apply pagination
    const paginatedDocs = sortedDocs.slice(from, from + size)

    const hits: Hit[] = paginatedDocs.map((doc) => ({
      _index: this.indexer.name,
      _id: doc._id,
      _score: null,
      _source: doc._source,
    }))

    return {
      hits: {
        total: { value: documents.length, relation: 'eq' },
        max_score: null,
        hits,
      },
    }
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private getFieldValues(doc: Document, field: string): unknown[] {
    const value = this.indexer.getFieldValue(doc, field)
    if (value === undefined || value === null) return []
    if (Array.isArray(value)) return value
    return [value]
  }

  private getNumericValue(doc: Document, field: string): number | null {
    const value = this.indexer.getFieldValue(doc, field)
    if (value === undefined || value === null) return null
    const num = Number(value)
    return isNaN(num) ? null : num
  }

  private getNumericValues(
    documents: IndexedDocument[],
    field: string,
    missing?: number
  ): number[] {
    const values: number[] = []

    for (const doc of documents) {
      const value = this.getNumericValue(doc._source, field)
      if (value !== null) {
        values.push(value)
      } else if (missing !== undefined) {
        values.push(missing)
      }
    }

    return values
  }

  private getDateValue(doc: Document, field: string): number | null {
    const value = this.indexer.getFieldValue(doc, field)
    if (value === undefined || value === null) return null

    if (typeof value === 'number') return value
    if (typeof value === 'string') {
      const parsed = Date.parse(value)
      return isNaN(parsed) ? null : parsed
    }

    return null
  }

  private parseDateValue(value: string | number): number {
    if (typeof value === 'number') return value
    return Date.parse(value)
  }

  private parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)([smhdwMy])$/)
    if (!match) {
      // Try parsing as fixed interval
      const fixedMatch = interval.match(/^(\d+)(ms|s|m|h|d)$/)
      if (fixedMatch) {
        const value = parseInt(fixedMatch[1]!)
        const unit = fixedMatch[2]
        switch (unit) {
          case 'ms': return value
          case 's': return value * 1000
          case 'm': return value * 60 * 1000
          case 'h': return value * 60 * 60 * 1000
          case 'd': return value * 24 * 60 * 60 * 1000
        }
      }
      return 24 * 60 * 60 * 1000 // Default to 1 day
    }

    const value = parseInt(match[1]!)
    const unit = match[2]

    switch (unit) {
      case 's': return value * 1000
      case 'm': return value * 60 * 1000
      case 'h': return value * 60 * 60 * 1000
      case 'd': return value * 24 * 60 * 60 * 1000
      case 'w': return value * 7 * 24 * 60 * 60 * 1000
      case 'M': return value * 30 * 24 * 60 * 60 * 1000 // Approximate
      case 'y': return value * 365 * 24 * 60 * 60 * 1000 // Approximate
      default: return 24 * 60 * 60 * 1000
    }
  }

  private filterDocuments(documents: IndexedDocument[], query: Query): IndexedDocument[] {
    // Simple filter implementation - in production would use SearchExecutor
    // For now, implement basic filters inline

    if ('term' in query) {
      const field = Object.keys(query.term)[0]!
      const value = query.term[field]
      const targetValue = typeof value === 'object' && value !== null ? (value as { value: unknown }).value : value

      return documents.filter((doc) => {
        const docValue = this.indexer.getFieldValue(doc._source, field)
        return docValue === targetValue
      })
    }

    if ('bool' in query) {
      let result = documents

      if (query.bool.must) {
        for (const clause of query.bool.must) {
          result = this.filterDocuments(result, clause)
        }
      }

      if (query.bool.filter) {
        for (const clause of query.bool.filter) {
          result = this.filterDocuments(result, clause)
        }
      }

      if (query.bool.must_not) {
        for (const clause of query.bool.must_not) {
          const excluded = new Set(this.filterDocuments(result, clause).map((d) => d._id))
          result = result.filter((d) => !excluded.has(d._id))
        }
      }

      return result
    }

    if ('range' in query) {
      const field = Object.keys(query.range)[0]!
      const config = query.range[field] as { gt?: number; gte?: number; lt?: number; lte?: number }

      return documents.filter((doc) => {
        const value = this.getNumericValue(doc._source, field)
        if (value === null) return false

        if (config.gt !== undefined && value <= config.gt) return false
        if (config.gte !== undefined && value < config.gte) return false
        if (config.lt !== undefined && value >= config.lt) return false
        if (config.lte !== undefined && value > config.lte) return false

        return true
      })
    }

    if ('match_all' in query) {
      return documents
    }

    return documents
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new aggregation executor
 */
export function createAggregationExecutor(
  indexer: ElasticsearchIndexer,
  searchExecutor?: SearchExecutor
): AggregationExecutor {
  return new AggregationExecutor(indexer, searchExecutor)
}
