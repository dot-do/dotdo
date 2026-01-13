/**
 * Elasticsearch DSL Parser
 *
 * Parses and validates Elasticsearch Query DSL, aggregations, sort, and pagination.
 * Converts ES DSL into normalized internal representations for execution.
 *
 * @module db/compat/elasticsearch/dsl-parser
 *
 * @example
 * ```typescript
 * import { EsDslParser } from './dsl-parser'
 *
 * const parser = new EsDslParser()
 *
 * // Parse a query
 * const parsed = parser.parseQuery({
 *   bool: {
 *     must: [{ match: { title: 'hello world' } }],
 *     filter: [{ range: { price: { gte: 100 } } }],
 *   },
 * })
 *
 * // Parse aggregations
 * const aggs = parser.parseAggregations({
 *   categories: { terms: { field: 'category' } },
 *   avg_price: { avg: { field: 'price' } },
 * })
 *
 * // Parse sort
 * const sort = parser.parseSort([{ price: 'asc' }, '_score'])
 * ```
 */

import type {
  Query,
  BoolQuery,
  MatchQuery,
  MultiMatchQuery,
  TermQuery,
  TermsQuery,
  RangeQuery,
  ExistsQuery,
  PrefixQuery,
  WildcardQuery,
  MatchPhraseQuery,
  IdsQuery,
  Aggregation,
  Sort,
  SortItem,
  SortOrder,
  SourceFilter,
} from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Query types supported by the parser
 */
export type QueryType =
  | 'match_all'
  | 'match_none'
  | 'match'
  | 'multi_match'
  | 'match_phrase'
  | 'match_phrase_prefix'
  | 'term'
  | 'terms'
  | 'range'
  | 'exists'
  | 'prefix'
  | 'wildcard'
  | 'regexp'
  | 'fuzzy'
  | 'ids'
  | 'bool'
  | 'nested'
  | 'function_score'
  | 'knn'

/**
 * Normalized match clause
 */
export interface NormalizedMatchClause {
  type: 'match'
  field: string
  query: string
  operator: 'or' | 'and'
  fuzziness?: string | number
  boost: number
  minimumShouldMatch?: string | number
  analyzer?: string
}

/**
 * Normalized multi_match clause
 */
export interface NormalizedMultiMatchClause {
  type: 'multi_match'
  query: string
  fields: Array<{ name: string; boost: number }>
  matchType: 'best_fields' | 'most_fields' | 'cross_fields' | 'phrase' | 'phrase_prefix'
  operator: 'or' | 'and'
  fuzziness?: string | number
  minimumShouldMatch?: string | number
}

/**
 * Normalized term clause
 */
export interface NormalizedTermClause {
  type: 'term'
  field: string
  value: string | number | boolean
  boost: number
}

/**
 * Normalized terms clause
 */
export interface NormalizedTermsClause {
  type: 'terms'
  field: string
  values: Array<string | number | boolean>
  boost: number
}

/**
 * Normalized range clause
 */
export interface NormalizedRangeClause {
  type: 'range'
  field: string
  gt?: number | string | Date
  gte?: number | string | Date
  lt?: number | string | Date
  lte?: number | string | Date
  format?: string
  boost: number
}

/**
 * Normalized exists clause
 */
export interface NormalizedExistsClause {
  type: 'exists'
  field: string
}

/**
 * Normalized prefix clause
 */
export interface NormalizedPrefixClause {
  type: 'prefix'
  field: string
  value: string
  boost: number
  caseInsensitive: boolean
}

/**
 * Normalized wildcard clause
 */
export interface NormalizedWildcardClause {
  type: 'wildcard'
  field: string
  value: string
  boost: number
  caseInsensitive: boolean
}

/**
 * Normalized IDs clause
 */
export interface NormalizedIdsClause {
  type: 'ids'
  values: string[]
}

/**
 * Normalized match_phrase clause
 */
export interface NormalizedMatchPhraseClause {
  type: 'match_phrase'
  field: string
  query: string
  slop: number
  boost: number
}

/**
 * Normalized match_all clause
 */
export interface NormalizedMatchAllClause {
  type: 'match_all'
  boost: number
}

/**
 * Normalized match_none clause
 */
export interface NormalizedMatchNoneClause {
  type: 'match_none'
}

/**
 * Normalized bool clause
 */
export interface NormalizedBoolClause {
  type: 'bool'
  must: NormalizedQuery[]
  filter: NormalizedQuery[]
  should: NormalizedQuery[]
  mustNot: NormalizedQuery[]
  minimumShouldMatch: number
  boost: number
}

/**
 * Union of all normalized query clauses
 */
export type NormalizedQuery =
  | NormalizedMatchClause
  | NormalizedMultiMatchClause
  | NormalizedTermClause
  | NormalizedTermsClause
  | NormalizedRangeClause
  | NormalizedExistsClause
  | NormalizedPrefixClause
  | NormalizedWildcardClause
  | NormalizedIdsClause
  | NormalizedMatchPhraseClause
  | NormalizedMatchAllClause
  | NormalizedMatchNoneClause
  | NormalizedBoolClause

/**
 * Aggregation types supported by the parser
 */
export type AggregationType =
  | 'terms'
  | 'histogram'
  | 'date_histogram'
  | 'range'
  | 'date_range'
  | 'avg'
  | 'sum'
  | 'min'
  | 'max'
  | 'value_count'
  | 'cardinality'
  | 'stats'
  | 'extended_stats'
  | 'percentiles'
  | 'top_hits'
  | 'filter'
  | 'filters'
  | 'nested'

/**
 * Normalized terms aggregation
 */
export interface NormalizedTermsAgg {
  type: 'terms'
  field: string
  size: number
  minDocCount: number
  order: Array<{ field: string; direction: 'asc' | 'desc' }>
  missing?: string | number
  subAggs: Record<string, NormalizedAggregation>
}

/**
 * Normalized histogram aggregation
 */
export interface NormalizedHistogramAgg {
  type: 'histogram'
  field: string
  interval: number
  minDocCount: number
  offset: number
  extendedBounds?: { min: number; max: number }
  subAggs: Record<string, NormalizedAggregation>
}

/**
 * Normalized date histogram aggregation
 */
export interface NormalizedDateHistogramAgg {
  type: 'date_histogram'
  field: string
  calendarInterval?: string
  fixedInterval?: string
  minDocCount: number
  offset?: string
  timeZone?: string
  format?: string
  subAggs: Record<string, NormalizedAggregation>
}

/**
 * Normalized range aggregation
 */
export interface NormalizedRangeAgg {
  type: 'range'
  field: string
  ranges: Array<{ key?: string; from?: number; to?: number }>
  keyed: boolean
  subAggs: Record<string, NormalizedAggregation>
}

/**
 * Normalized metric aggregation (avg, sum, min, max)
 */
export interface NormalizedMetricAgg {
  type: 'avg' | 'sum' | 'min' | 'max' | 'value_count' | 'cardinality'
  field: string
  missing?: number
}

/**
 * Normalized stats aggregation
 */
export interface NormalizedStatsAgg {
  type: 'stats' | 'extended_stats'
  field: string
  missing?: number
  sigma?: number
}

/**
 * Normalized percentiles aggregation
 */
export interface NormalizedPercentilesAgg {
  type: 'percentiles'
  field: string
  percents: number[]
  keyed: boolean
  missing?: number
}

/**
 * Normalized top_hits aggregation
 */
export interface NormalizedTopHitsAgg {
  type: 'top_hits'
  size: number
  from: number
  sort: NormalizedSort
  source: SourceFilter
}

/**
 * Normalized filter aggregation
 */
export interface NormalizedFilterAgg {
  type: 'filter'
  filter: NormalizedQuery
  subAggs: Record<string, NormalizedAggregation>
}

/**
 * Union of all normalized aggregations
 */
export type NormalizedAggregation =
  | NormalizedTermsAgg
  | NormalizedHistogramAgg
  | NormalizedDateHistogramAgg
  | NormalizedRangeAgg
  | NormalizedMetricAgg
  | NormalizedStatsAgg
  | NormalizedPercentilesAgg
  | NormalizedTopHitsAgg
  | NormalizedFilterAgg

/**
 * Normalized sort item
 */
export interface NormalizedSortItem {
  field: string
  order: 'asc' | 'desc'
  mode?: 'min' | 'max' | 'sum' | 'avg' | 'median'
  missing?: '_last' | '_first' | string | number
  unmappedType?: string
}

/**
 * Normalized sort specification
 */
export type NormalizedSort = NormalizedSortItem[]

/**
 * Normalized pagination
 */
export interface NormalizedPagination {
  from: number
  size: number
  searchAfter?: unknown[]
}

/**
 * Normalized source filter
 */
export interface NormalizedSourceFilter {
  enabled: boolean
  includes: string[]
  excludes: string[]
}

/**
 * Parser validation error
 */
export class DslParseError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly value?: unknown
  ) {
    super(`DSL Parse Error at '${path}': ${message}`)
    this.name = 'DslParseError'
  }
}

// ============================================================================
// PARSER IMPLEMENTATION
// ============================================================================

/**
 * Elasticsearch DSL Parser
 *
 * Parses and normalizes ES Query DSL into internal representations.
 */
export class EsDslParser {
  /**
   * Parse a Query DSL object
   */
  parseQuery(query: Query | undefined): NormalizedQuery {
    if (!query || Object.keys(query).length === 0) {
      return { type: 'match_all', boost: 1.0 }
    }

    // Identify query type
    const queryType = this.identifyQueryType(query)

    switch (queryType) {
      case 'match_all':
        return this.parseMatchAll(query as { match_all: { boost?: number } })

      case 'match_none':
        return { type: 'match_none' }

      case 'match':
        return this.parseMatch(query as MatchQuery)

      case 'multi_match':
        return this.parseMultiMatch(query as MultiMatchQuery)

      case 'match_phrase':
        return this.parseMatchPhrase(query as MatchPhraseQuery)

      case 'term':
        return this.parseTerm(query as TermQuery)

      case 'terms':
        return this.parseTerms(query as TermsQuery)

      case 'range':
        return this.parseRange(query as RangeQuery)

      case 'exists':
        return this.parseExists(query as ExistsQuery)

      case 'prefix':
        return this.parsePrefix(query as PrefixQuery)

      case 'wildcard':
        return this.parseWildcard(query as WildcardQuery)

      case 'ids':
        return this.parseIds(query as IdsQuery)

      case 'bool':
        return this.parseBool(query as BoolQuery)

      default:
        throw new DslParseError(`Unknown query type: ${queryType}`, 'query', query)
    }
  }

  /**
   * Identify the type of a query
   */
  private identifyQueryType(query: Query): QueryType {
    if ('match_all' in query) return 'match_all'
    if ('match_none' in query) return 'match_none'
    if ('match' in query) return 'match'
    if ('multi_match' in query) return 'multi_match'
    if ('match_phrase' in query) return 'match_phrase'
    if ('match_phrase_prefix' in query) return 'match_phrase_prefix'
    if ('term' in query) return 'term'
    if ('terms' in query) return 'terms'
    if ('range' in query) return 'range'
    if ('exists' in query) return 'exists'
    if ('prefix' in query) return 'prefix'
    if ('wildcard' in query) return 'wildcard'
    if ('regexp' in query) return 'regexp'
    if ('fuzzy' in query) return 'fuzzy'
    if ('ids' in query) return 'ids'
    if ('bool' in query) return 'bool'
    if ('nested' in query) return 'nested'
    if ('function_score' in query) return 'function_score'
    if ('knn' in query) return 'knn'

    throw new DslParseError(`Cannot identify query type`, 'query', query)
  }

  /**
   * Parse match_all query
   */
  private parseMatchAll(query: { match_all: { boost?: number } }): NormalizedMatchAllClause {
    return {
      type: 'match_all',
      boost: query.match_all.boost ?? 1.0,
    }
  }

  /**
   * Parse match query
   */
  private parseMatch(query: MatchQuery): NormalizedMatchClause {
    const [field, config] = Object.entries(query.match)[0]!

    if (typeof config === 'string') {
      return {
        type: 'match',
        field,
        query: config,
        operator: 'or',
        boost: 1.0,
      }
    }

    return {
      type: 'match',
      field,
      query: config.query,
      operator: config.operator ?? 'or',
      fuzziness: config.fuzziness,
      boost: config.boost ?? 1.0,
      minimumShouldMatch: config.minimum_should_match,
      analyzer: config.analyzer,
    }
  }

  /**
   * Parse multi_match query
   */
  private parseMultiMatch(query: MultiMatchQuery): NormalizedMultiMatchClause {
    const config = query.multi_match

    // Parse fields with boosts (e.g., "title^2")
    const fields = config.fields.map((field) => {
      const match = field.match(/^(.+)\^(\d+(?:\.\d+)?)$/)
      if (match) {
        return { name: match[1]!, boost: parseFloat(match[2]!) }
      }
      return { name: field, boost: 1.0 }
    })

    return {
      type: 'multi_match',
      query: config.query,
      fields,
      matchType: config.type ?? 'best_fields',
      operator: config.operator ?? 'or',
      fuzziness: config.fuzziness,
      minimumShouldMatch: config.minimum_should_match,
    }
  }

  /**
   * Parse match_phrase query
   */
  private parseMatchPhrase(query: MatchPhraseQuery): NormalizedMatchPhraseClause {
    const [field, config] = Object.entries(query.match_phrase)[0]!

    if (typeof config === 'string') {
      return {
        type: 'match_phrase',
        field,
        query: config,
        slop: 0,
        boost: 1.0,
      }
    }

    return {
      type: 'match_phrase',
      field,
      query: config.query,
      slop: config.slop ?? 0,
      boost: config.boost ?? 1.0,
    }
  }

  /**
   * Parse term query
   */
  private parseTerm(query: TermQuery): NormalizedTermClause {
    const [field, config] = Object.entries(query.term)[0]!

    if (typeof config === 'object' && config !== null && 'value' in config) {
      return {
        type: 'term',
        field,
        value: config.value,
        boost: config.boost ?? 1.0,
      }
    }

    return {
      type: 'term',
      field,
      value: config as string | number | boolean,
      boost: 1.0,
    }
  }

  /**
   * Parse terms query
   */
  private parseTerms(query: TermsQuery): NormalizedTermsClause {
    const [field, values] = Object.entries(query.terms)[0]!

    return {
      type: 'terms',
      field,
      values: values as Array<string | number | boolean>,
      boost: 1.0,
    }
  }

  /**
   * Parse range query
   */
  private parseRange(query: RangeQuery): NormalizedRangeClause {
    const [field, conditions] = Object.entries(query.range)[0]!

    return {
      type: 'range',
      field,
      gt: conditions.gt,
      gte: conditions.gte,
      lt: conditions.lt,
      lte: conditions.lte,
      format: conditions.format,
      boost: conditions.boost ?? 1.0,
    }
  }

  /**
   * Parse exists query
   */
  private parseExists(query: ExistsQuery): NormalizedExistsClause {
    return {
      type: 'exists',
      field: query.exists.field,
    }
  }

  /**
   * Parse prefix query
   */
  private parsePrefix(query: PrefixQuery): NormalizedPrefixClause {
    const [field, config] = Object.entries(query.prefix)[0]!

    if (typeof config === 'string') {
      return {
        type: 'prefix',
        field,
        value: config,
        boost: 1.0,
        caseInsensitive: false,
      }
    }

    return {
      type: 'prefix',
      field,
      value: config.value,
      boost: config.boost ?? 1.0,
      caseInsensitive: false,
    }
  }

  /**
   * Parse wildcard query
   */
  private parseWildcard(query: WildcardQuery): NormalizedWildcardClause {
    const [field, config] = Object.entries(query.wildcard)[0]!

    if (typeof config === 'string') {
      return {
        type: 'wildcard',
        field,
        value: config,
        boost: 1.0,
        caseInsensitive: true,
      }
    }

    return {
      type: 'wildcard',
      field,
      value: config.value,
      boost: config.boost ?? 1.0,
      caseInsensitive: true,
    }
  }

  /**
   * Parse ids query
   */
  private parseIds(query: IdsQuery): NormalizedIdsClause {
    return {
      type: 'ids',
      values: query.ids.values,
    }
  }

  /**
   * Parse bool query
   */
  private parseBool(query: BoolQuery): NormalizedBoolClause {
    const config = query.bool

    // Parse clauses
    const must = (config.must ? (Array.isArray(config.must) ? config.must : [config.must]) : []).map((q) =>
      this.parseQuery(q)
    )

    const filter = (config.filter ? (Array.isArray(config.filter) ? config.filter : [config.filter]) : []).map((q) =>
      this.parseQuery(q)
    )

    const should = (config.should ? (Array.isArray(config.should) ? config.should : [config.should]) : []).map((q) =>
      this.parseQuery(q)
    )

    const mustNot = (config.must_not ? (Array.isArray(config.must_not) ? config.must_not : [config.must_not]) : []).map(
      (q) => this.parseQuery(q)
    )

    // Determine minimum_should_match
    let minimumShouldMatch = 0
    if (config.minimum_should_match !== undefined) {
      if (typeof config.minimum_should_match === 'number') {
        minimumShouldMatch = config.minimum_should_match
      } else {
        // Parse string format (e.g., "2", "-1", "75%")
        minimumShouldMatch = this.parseMinimumShouldMatch(config.minimum_should_match, should.length)
      }
    } else if (should.length > 0 && must.length === 0 && filter.length === 0) {
      // Default: at least 1 should clause must match if no must/filter
      minimumShouldMatch = 1
    }

    return {
      type: 'bool',
      must,
      filter,
      should,
      mustNot,
      minimumShouldMatch,
      boost: config.boost ?? 1.0,
    }
  }

  /**
   * Parse minimum_should_match string format
   */
  private parseMinimumShouldMatch(value: string, totalClauses: number): number {
    if (value.endsWith('%')) {
      const percentage = parseInt(value.slice(0, -1), 10)
      return Math.ceil((percentage / 100) * totalClauses)
    }

    const num = parseInt(value, 10)
    if (num < 0) {
      return Math.max(0, totalClauses + num)
    }
    return num
  }

  // ==========================================================================
  // AGGREGATION PARSING
  // ==========================================================================

  /**
   * Parse aggregations
   */
  parseAggregations(aggs: Record<string, Aggregation> | undefined): Record<string, NormalizedAggregation> {
    if (!aggs) return {}

    const result: Record<string, NormalizedAggregation> = {}

    for (const [name, aggDef] of Object.entries(aggs)) {
      result[name] = this.parseAggregation(aggDef, name)
    }

    return result
  }

  /**
   * Parse a single aggregation
   */
  private parseAggregation(agg: Aggregation, path: string): NormalizedAggregation {
    // Parse sub-aggregations
    const subAggs = this.parseAggregations(agg.aggs)

    // Identify aggregation type
    if ('terms' in agg) {
      return this.parseTermsAgg(agg, subAggs)
    }

    if ('histogram' in agg) {
      return this.parseHistogramAgg(agg, subAggs)
    }

    if ('date_histogram' in agg) {
      return this.parseDateHistogramAgg(agg, subAggs)
    }

    if ('range' in agg) {
      return this.parseRangeAgg(agg, subAggs)
    }

    if ('avg' in agg) {
      return { type: 'avg', field: agg.avg.field, missing: agg.avg.missing }
    }

    if ('sum' in agg) {
      return { type: 'sum', field: agg.sum.field, missing: agg.sum.missing }
    }

    if ('min' in agg) {
      return { type: 'min', field: agg.min.field, missing: agg.min.missing }
    }

    if ('max' in agg) {
      return { type: 'max', field: agg.max.field, missing: agg.max.missing }
    }

    if ('value_count' in agg) {
      return { type: 'value_count', field: agg.value_count.field }
    }

    if ('cardinality' in agg) {
      return { type: 'cardinality', field: agg.cardinality.field, missing: agg.cardinality.missing as number }
    }

    if ('stats' in agg) {
      return { type: 'stats', field: agg.stats.field, missing: agg.stats.missing }
    }

    if ('extended_stats' in agg) {
      return {
        type: 'extended_stats',
        field: agg.extended_stats.field,
        missing: agg.extended_stats.missing,
        sigma: agg.extended_stats.sigma,
      }
    }

    if ('percentiles' in agg) {
      return {
        type: 'percentiles',
        field: agg.percentiles.field,
        percents: agg.percentiles.percents ?? [1, 5, 25, 50, 75, 95, 99],
        keyed: agg.percentiles.keyed ?? true,
        missing: agg.percentiles.missing,
      }
    }

    if ('top_hits' in agg) {
      return {
        type: 'top_hits',
        size: agg.top_hits.size ?? 3,
        from: agg.top_hits.from ?? 0,
        sort: this.parseSort(agg.top_hits.sort),
        source: agg.top_hits._source ?? true,
      }
    }

    if ('filter' in agg) {
      return {
        type: 'filter',
        filter: this.parseQuery(agg.filter as Query),
        subAggs,
      }
    }

    throw new DslParseError(`Unknown aggregation type`, path, agg)
  }

  /**
   * Parse terms aggregation
   */
  private parseTermsAgg(
    agg: { terms: { field: string; size?: number; min_doc_count?: number; order?: unknown; missing?: unknown } },
    subAggs: Record<string, NormalizedAggregation>
  ): NormalizedTermsAgg {
    const config = agg.terms

    // Parse order
    const order: Array<{ field: string; direction: 'asc' | 'desc' }> = []
    if (config.order) {
      const orderArr = Array.isArray(config.order) ? config.order : [config.order]
      for (const orderItem of orderArr) {
        const [field, direction] = Object.entries(orderItem as Record<string, string>)[0]!
        order.push({ field, direction: direction as 'asc' | 'desc' })
      }
    } else {
      // Default order: by doc count descending
      order.push({ field: '_count', direction: 'desc' })
    }

    return {
      type: 'terms',
      field: config.field,
      size: config.size ?? 10,
      minDocCount: config.min_doc_count ?? 1,
      order,
      missing: config.missing as string | number | undefined,
      subAggs,
    }
  }

  /**
   * Parse histogram aggregation
   */
  private parseHistogramAgg(
    agg: {
      histogram: {
        field: string
        interval: number
        min_doc_count?: number
        offset?: number
        extended_bounds?: { min: number; max: number }
      }
    },
    subAggs: Record<string, NormalizedAggregation>
  ): NormalizedHistogramAgg {
    const config = agg.histogram

    return {
      type: 'histogram',
      field: config.field,
      interval: config.interval,
      minDocCount: config.min_doc_count ?? 0,
      offset: config.offset ?? 0,
      extendedBounds: config.extended_bounds,
      subAggs,
    }
  }

  /**
   * Parse date_histogram aggregation
   */
  private parseDateHistogramAgg(
    agg: {
      date_histogram: {
        field: string
        calendar_interval?: string
        fixed_interval?: string
        min_doc_count?: number
        offset?: string
        time_zone?: string
        format?: string
      }
    },
    subAggs: Record<string, NormalizedAggregation>
  ): NormalizedDateHistogramAgg {
    const config = agg.date_histogram

    return {
      type: 'date_histogram',
      field: config.field,
      calendarInterval: config.calendar_interval,
      fixedInterval: config.fixed_interval,
      minDocCount: config.min_doc_count ?? 0,
      offset: config.offset,
      timeZone: config.time_zone,
      format: config.format,
      subAggs,
    }
  }

  /**
   * Parse range aggregation
   */
  private parseRangeAgg(
    agg: { range: { field: string; ranges: Array<{ key?: string; from?: number; to?: number }>; keyed?: boolean } },
    subAggs: Record<string, NormalizedAggregation>
  ): NormalizedRangeAgg {
    const config = agg.range

    return {
      type: 'range',
      field: config.field,
      ranges: config.ranges,
      keyed: config.keyed ?? false,
      subAggs,
    }
  }

  // ==========================================================================
  // SORT PARSING
  // ==========================================================================

  /**
   * Parse sort specification
   */
  parseSort(sort: Sort | undefined): NormalizedSort {
    if (!sort || sort.length === 0) {
      return []
    }

    return sort.map((item, index) => this.parseSortItem(item, index))
  }

  /**
   * Parse a single sort item
   */
  private parseSortItem(item: SortItem | string, index: number): NormalizedSortItem {
    // String format: "field" or "_score"
    if (typeof item === 'string') {
      return {
        field: item,
        order: item === '_score' ? 'desc' : 'asc',
      }
    }

    // Object format
    const [field, config] = Object.entries(item)[0]!

    if (typeof config === 'string') {
      return {
        field,
        order: config as 'asc' | 'desc',
      }
    }

    return {
      field,
      order: config.order ?? (field === '_score' ? 'desc' : 'asc'),
      mode: config.mode,
      missing: config.missing,
      unmappedType: config.unmapped_type,
    }
  }

  // ==========================================================================
  // PAGINATION PARSING
  // ==========================================================================

  /**
   * Parse pagination options
   */
  parsePagination(from?: number, size?: number, searchAfter?: unknown[]): NormalizedPagination {
    return {
      from: from ?? 0,
      size: size ?? 10,
      searchAfter,
    }
  }

  // ==========================================================================
  // SOURCE FILTER PARSING
  // ==========================================================================

  /**
   * Parse source filter
   */
  parseSourceFilter(source: SourceFilter | undefined): NormalizedSourceFilter {
    // Disabled
    if (source === false) {
      return { enabled: false, includes: [], excludes: [] }
    }

    // All fields
    if (source === true || source === undefined) {
      return { enabled: true, includes: [], excludes: [] }
    }

    // Single field
    if (typeof source === 'string') {
      return { enabled: true, includes: [source], excludes: [] }
    }

    // Array of fields
    if (Array.isArray(source)) {
      return { enabled: true, includes: source, excludes: [] }
    }

    // Object with includes/excludes
    return {
      enabled: true,
      includes: source.includes ?? [],
      excludes: source.excludes ?? [],
    }
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  /**
   * Validate a query DSL
   */
  validateQuery(query: Query): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    try {
      this.parseQuery(query)
    } catch (e) {
      if (e instanceof DslParseError) {
        errors.push(e.message)
      } else {
        errors.push(`Unknown error: ${(e as Error).message}`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Validate aggregations
   */
  validateAggregations(aggs: Record<string, Aggregation>): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    try {
      this.parseAggregations(aggs)
    } catch (e) {
      if (e instanceof DslParseError) {
        errors.push(e.message)
      } else {
        errors.push(`Unknown error: ${(e as Error).message}`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }
}

// ============================================================================
// QUERY ANALYSIS UTILITIES
// ============================================================================

/**
 * Analyze a query to extract metadata
 */
export interface QueryAnalysis {
  /** Query types used */
  queryTypes: QueryType[]
  /** Fields referenced */
  fields: string[]
  /** Has full-text search (requires scoring) */
  hasFullText: boolean
  /** Is filter-only (no scoring needed) */
  isFilterOnly: boolean
  /** Estimated complexity (1-10) */
  complexity: number
}

/**
 * Analyze a parsed query
 */
export function analyzeQuery(query: NormalizedQuery): QueryAnalysis {
  const analysis: QueryAnalysis = {
    queryTypes: [],
    fields: [],
    hasFullText: false,
    isFilterOnly: true,
    complexity: 1,
  }

  function analyze(q: NormalizedQuery): void {
    analysis.queryTypes.push(q.type as QueryType)

    switch (q.type) {
      case 'match':
        analysis.fields.push(q.field)
        analysis.hasFullText = true
        analysis.isFilterOnly = false
        analysis.complexity += 2
        break

      case 'multi_match':
        analysis.fields.push(...q.fields.map((f) => f.name))
        analysis.hasFullText = true
        analysis.isFilterOnly = false
        analysis.complexity += 3
        break

      case 'match_phrase':
        analysis.fields.push(q.field)
        analysis.hasFullText = true
        analysis.isFilterOnly = false
        analysis.complexity += 3
        break

      case 'term':
        analysis.fields.push(q.field)
        analysis.complexity += 1
        break

      case 'terms':
        analysis.fields.push(q.field)
        analysis.complexity += 1
        break

      case 'range':
        analysis.fields.push(q.field)
        analysis.complexity += 1
        break

      case 'exists':
        analysis.fields.push(q.field)
        analysis.complexity += 1
        break

      case 'prefix':
      case 'wildcard':
        analysis.fields.push(q.field)
        analysis.complexity += 2
        break

      case 'bool':
        for (const clause of [...q.must, ...q.filter, ...q.should, ...q.mustNot]) {
          analyze(clause)
        }
        analysis.complexity += 1
        break
    }
  }

  analyze(query)

  // Deduplicate
  analysis.queryTypes = [...new Set(analysis.queryTypes)]
  analysis.fields = [...new Set(analysis.fields)]
  analysis.complexity = Math.min(10, analysis.complexity)

  return analysis
}

/**
 * Extract search terms from a query (for highlighting, suggestions, etc.)
 */
export function extractSearchTerms(query: NormalizedQuery): string[] {
  const terms: string[] = []

  function extract(q: NormalizedQuery): void {
    switch (q.type) {
      case 'match':
      case 'match_phrase':
        terms.push(q.query)
        break

      case 'multi_match':
        terms.push(q.query)
        break

      case 'term':
        if (typeof q.value === 'string') {
          terms.push(q.value)
        }
        break

      case 'bool':
        for (const clause of [...q.must, ...q.should]) {
          extract(clause)
        }
        break
    }
  }

  extract(query)
  return [...new Set(terms)]
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new DSL parser
 */
export function createDslParser(): EsDslParser {
  return new EsDslParser()
}

// Default parser instance
export const defaultParser = new EsDslParser()
