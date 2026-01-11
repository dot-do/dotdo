/**
 * SPIKE: MongoDB-Compatible Query Engine for DO
 *
 * Globally distributed MongoDB-style queries on Cloudflare Workers + DOs + R2 Iceberg
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────────────────────────┐
 * │ Client Request (any colo)                                                          │
 * │         │                                                                           │
 * │         ▼                                                                           │
 * │ ┌─────────────────────────────────────────────────────────────────────────────────┐ │
 * │ │ Query Router (Worker)                                                           │ │
 * │ │ • Parse MongoDB query                                                           │ │
 * │ │ • Determine which index shards to query                                         │ │
 * │ │ • Fan out to index DOs                                                          │ │
 * │ └───────────────────────────────────────┬─────────────────────────────────────────┘ │
 * │                                         │                                           │
 * │         ┌───────────────────────────────┼───────────────────────────────┐           │
 * │         ▼                               ▼                               ▼           │
 * │ ┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐               │
 * │ │ Index DO Shard 1  │   │ Index DO Shard 2  │   │ Index DO Shard 3  │               │
 * │ │ (type=User)       │   │ (type=Order)      │   │ (type=Product)    │               │
 * │ │ • Bloom filters   │   │ • Bloom filters   │   │ • Bloom filters   │               │
 * │ │ • Min/max stats   │   │ • Min/max stats   │   │ • Min/max stats   │               │
 * │ │ • FTS GIN index   │   │ • FTS GIN index   │   │ • FTS GIN index   │               │
 * │ │ • HNSW vectors    │   │ • HNSW vectors    │   │ • HNSW vectors    │               │
 * │ └─────────┬─────────┘   └─────────┬─────────┘   └─────────┬─────────┘               │
 * │           │                       │                       │                         │
 * │           │ Partition pruning     │ Partition pruning     │ Partition pruning       │
 * │           ▼                       ▼                       ▼                         │
 * │ ┌─────────────────────────────────────────────────────────────────────────────────┐ │
 * │ │ R2 Iceberg (Cold Storage) - Edge Cached at Requesting Colo                     │ │
 * │ │ • Parquet files partitioned by type + date                                      │ │
 * │ │ • Cache headers for edge persistence                                            │ │
 * │ └─────────────────────────────────────────────────────────────────────────────────┘ │
 * │                                         │                                           │
 * │                                         ▼                                           │
 * │ ┌─────────────────────────────────────────────────────────────────────────────────┐ │
 * │ │ Result Aggregator (Worker)                                                      │ │
 * │ │ • Merge results from shards                                                     │ │
 * │ │ • Apply final aggregation stages                                                │ │
 * │ │ • Return to client                                                              │ │
 * │ └─────────────────────────────────────────────────────────────────────────────────┘ │
 * └─────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Key Features:
 * 1. MongoDB Query Compatibility - $eq, $gt, $in, $and, $or, $exists, $regex, etc.
 * 2. Aggregation Pipeline - $match, $group, $project, $sort, $limit, $unwind, $lookup
 * 3. Global Index Sharding - Distribute indexes across DOs by type/hash/geo
 * 4. Edge Caching - Cache Parquet partitions at requesting colo
 * 5. FTS + Vector - Full-text search and vector similarity on Iceberg data
 */

// ============================================================================
// Types
// ============================================================================

/** MongoDB-style query operators */
export type ComparisonOperator = '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte' | '$in' | '$nin'
export type LogicalOperator = '$and' | '$or' | '$not' | '$nor'
export type ElementOperator = '$exists' | '$type'
export type ArrayOperator = '$all' | '$elemMatch' | '$size'
export type TextOperator = '$text' | '$search'
export type VectorOperator = '$vector' | '$near' | '$k'

/** A MongoDB query value - can be a literal or an operator expression */
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | Date
  | RegExp
  | QueryExpression
  | QueryValue[]

/** Operator expression like { $gt: 100 } */
export interface QueryExpression {
  $eq?: QueryValue
  $ne?: QueryValue
  $gt?: QueryValue
  $gte?: QueryValue
  $lt?: QueryValue
  $lte?: QueryValue
  $in?: QueryValue[]
  $nin?: QueryValue[]
  $exists?: boolean
  $type?: string
  $all?: QueryValue[]
  $elemMatch?: MongoQuery
  $size?: number
  $regex?: string | RegExp
  $options?: string
  $text?: { $search: string; $language?: string; $caseSensitive?: boolean }
  $vector?: { $near: number[]; $k?: number; $minScore?: number }
}

/** Top-level MongoDB query */
export interface MongoQuery {
  [field: string]: QueryValue | undefined
  $and?: MongoQuery[]
  $or?: MongoQuery[]
  $not?: MongoQuery
  $nor?: MongoQuery[]
  $text?: { $search: string; $language?: string }
  $vector?: { $near: number[]; $k?: number }
}

/** Aggregation pipeline stage types */
export type AggregationStage =
  | { $match: MongoQuery }
  | { $project: ProjectionSpec }
  | { $group: GroupSpec }
  | { $sort: SortSpec }
  | { $limit: number }
  | { $skip: number }
  | { $unwind: string | UnwindSpec }
  | { $lookup: LookupSpec }
  | { $facet: FacetSpec }
  | { $bucket: BucketSpec }
  | { $count: string }
  | { $addFields: Record<string, unknown> }
  | { $replaceRoot: { newRoot: string } }

export interface ProjectionSpec {
  [field: string]: 0 | 1 | string | ProjectionExpression
}

export interface ProjectionExpression {
  $concat?: string[]
  $substr?: [string, number, number]
  $toUpper?: string
  $toLower?: string
  $add?: (string | number)[]
  $subtract?: [string | number, string | number]
  $multiply?: (string | number)[]
  $divide?: [string | number, string | number]
  $cond?: { if: MongoQuery; then: unknown; else: unknown }
  $ifNull?: [string, unknown]
}

export interface GroupSpec {
  _id: string | Record<string, string> | null
  [accumulator: string]: AccumulatorSpec | string | Record<string, string> | null
}

export type AccumulatorSpec =
  | { $sum: string | number }
  | { $avg: string }
  | { $min: string }
  | { $max: string }
  | { $first: string }
  | { $last: string }
  | { $push: string | Record<string, string> }
  | { $addToSet: string }
  | { $count: Record<string, never> }
  | { $stdDevPop: string }
  | { $stdDevSamp: string }

export interface SortSpec {
  [field: string]: 1 | -1
}

export interface UnwindSpec {
  path: string
  preserveNullAndEmptyArrays?: boolean
  includeArrayIndex?: string
}

export interface LookupSpec {
  from: string
  localField: string
  foreignField: string
  as: string
}

export interface FacetSpec {
  [name: string]: AggregationStage[]
}

export interface BucketSpec {
  groupBy: string
  boundaries: number[]
  default?: string
  output?: Record<string, AccumulatorSpec>
}

/** Normalized predicate (shared with SQL layer) */
export interface Predicate {
  column: string
  op: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'IN' | 'NOT IN' | 'EXISTS' | 'NOT EXISTS' | 'LIKE' | 'IS NULL' | 'IS NOT NULL' | 'CONTAINS' | 'NEAR'
  value: unknown
  // For vector queries
  k?: number
  minScore?: number
}

/** Parsed query in normalized form */
export interface NormalizedQuery {
  predicates: Predicate[]
  logicalOp: 'AND' | 'OR'
  nested?: NormalizedQuery[]
  // Aggregation info
  groupBy?: string[]
  aggregations?: NormalizedAggregation[]
  projection?: string[]
  sort?: { field: string; direction: 'asc' | 'desc' }[]
  limit?: number
  skip?: number
}

export interface NormalizedAggregation {
  function: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'first' | 'last' | 'push' | 'addToSet' | 'stdDevPop' | 'stdDevSamp'
  column?: string
  alias: string
}

/** Index shard configuration */
export interface IndexShard {
  id: string
  type: 'type' | 'hash' | 'geo'
  value: string // type name, hash range, or geo region
  doId: string // Durable Object ID
  colo?: string // Preferred colo for geo shards
  replicaOf?: string // If this is a read replica
}

/** Shard routing result */
export interface ShardRoute {
  shards: IndexShard[]
  strategy: 'single' | 'scatter' | 'broadcast'
  partitionKey?: string
}

/** Edge cache entry */
export interface CacheEntry {
  key: string
  data: unknown
  colo: string
  cachedAt: number
  expiresAt: number
  sizeBytes: number
}

/** Query execution stats */
export interface QueryStats {
  parseTimeMs: number
  routingTimeMs: number
  indexTimeMs: number
  fetchTimeMs: number
  aggregateTimeMs: number
  totalTimeMs: number
  shardsQueried: number
  partitionsPruned: number
  partitionsFetched: number
  cacheHits: number
  cacheMisses: number
  rowsScanned: number
  rowsReturned: number
}

// ============================================================================
// MongoDB Query Parser
// ============================================================================

export class MongoQueryParser {
  /**
   * Parse a MongoDB query into normalized predicates
   */
  parse(query: MongoQuery): NormalizedQuery {
    const predicates: Predicate[] = []
    const nested: NormalizedQuery[] = []
    let logicalOp: 'AND' | 'OR' = 'AND'

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue

      switch (key) {
        case '$and':
          nested.push(...(value as MongoQuery[]).map((q) => this.parse(q)))
          break

        case '$or':
          logicalOp = 'OR'
          nested.push(...(value as MongoQuery[]).map((q) => this.parse(q)))
          break

        case '$nor':
          // $nor is equivalent to $not($or(...))
          nested.push({
            predicates: [],
            logicalOp: 'OR',
            nested: (value as MongoQuery[]).map((q) => this.parse(q)),
          })
          break

        case '$not':
          // Handle $not at top level
          const notQuery = this.parse(value as MongoQuery)
          // Negate predicates (simplified)
          for (const pred of notQuery.predicates) {
            predicates.push(this.negatePredicate(pred))
          }
          break

        case '$text':
          predicates.push({
            column: '$text',
            op: 'CONTAINS',
            value: (value as { $search: string }).$search,
          })
          break

        case '$vector':
          const vecSpec = value as { $near: number[]; $k?: number; $minScore?: number }
          predicates.push({
            column: '$vector',
            op: 'NEAR',
            value: vecSpec.$near,
            k: vecSpec.$k ?? 10,
            minScore: vecSpec.$minScore,
          })
          break

        default:
          // Field query
          predicates.push(...this.parseFieldQuery(key, value as QueryValue))
      }
    }

    return { predicates, logicalOp, nested: nested.length > 0 ? nested : undefined }
  }

  /**
   * Parse a field-level query
   */
  private parseFieldQuery(field: string, value: QueryValue): Predicate[] {
    // Simple equality: { field: value }
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value instanceof Date ||
      value instanceof RegExp
    ) {
      if (value instanceof RegExp) {
        return [{ column: field, op: 'LIKE', value: value.source }]
      }
      if (value === null) {
        return [{ column: field, op: 'IS NULL', value: null }]
      }
      return [{ column: field, op: '=', value }]
    }

    // Array of values - implicit $in
    if (Array.isArray(value)) {
      return [{ column: field, op: 'IN', value }]
    }

    // Operator expression: { field: { $gt: 100 } }
    const predicates: Predicate[] = []
    const expr = value as QueryExpression

    if (expr.$eq !== undefined) predicates.push({ column: field, op: '=', value: expr.$eq })
    if (expr.$ne !== undefined) predicates.push({ column: field, op: '!=', value: expr.$ne })
    if (expr.$gt !== undefined) predicates.push({ column: field, op: '>', value: expr.$gt })
    if (expr.$gte !== undefined) predicates.push({ column: field, op: '>=', value: expr.$gte })
    if (expr.$lt !== undefined) predicates.push({ column: field, op: '<', value: expr.$lt })
    if (expr.$lte !== undefined) predicates.push({ column: field, op: '<=', value: expr.$lte })
    if (expr.$in !== undefined) predicates.push({ column: field, op: 'IN', value: expr.$in })
    if (expr.$nin !== undefined) predicates.push({ column: field, op: 'NOT IN', value: expr.$nin })
    if (expr.$exists !== undefined) {
      predicates.push({
        column: field,
        op: expr.$exists ? 'IS NOT NULL' : 'IS NULL',
        value: null,
      })
    }
    if (expr.$regex !== undefined) {
      const pattern = expr.$regex instanceof RegExp ? expr.$regex.source : expr.$regex
      predicates.push({ column: field, op: 'LIKE', value: pattern })
    }
    if (expr.$text !== undefined) {
      predicates.push({ column: field, op: 'CONTAINS', value: expr.$text.$search })
    }
    if (expr.$vector !== undefined) {
      predicates.push({
        column: field,
        op: 'NEAR',
        value: expr.$vector.$near,
        k: expr.$vector.$k ?? 10,
        minScore: expr.$vector.$minScore,
      })
    }

    return predicates
  }

  /**
   * Negate a predicate (for $not)
   */
  private negatePredicate(pred: Predicate): Predicate {
    const negations: Record<string, Predicate['op']> = {
      '=': '!=',
      '!=': '=',
      '>': '<=',
      '>=': '<',
      '<': '>=',
      '<=': '>',
      IN: 'NOT IN',
      'NOT IN': 'IN',
      'IS NULL': 'IS NOT NULL',
      'IS NOT NULL': 'IS NULL',
      EXISTS: 'NOT EXISTS',
      'NOT EXISTS': 'EXISTS',
    }
    return { ...pred, op: negations[pred.op] ?? pred.op }
  }
}

// ============================================================================
// Aggregation Pipeline Parser
// ============================================================================

export class AggregationPipelineParser {
  /**
   * Parse an aggregation pipeline into a normalized query
   */
  parse(pipeline: AggregationStage[]): NormalizedQuery {
    let query: NormalizedQuery = {
      predicates: [],
      logicalOp: 'AND',
    }

    const mongoParser = new MongoQueryParser()

    for (const stage of pipeline) {
      const stageType = Object.keys(stage)[0] as keyof AggregationStage
      const stageValue = (stage as Record<string, unknown>)[stageType]

      switch (stageType) {
        case '$match':
          const matchQuery = mongoParser.parse(stageValue as MongoQuery)
          query.predicates.push(...matchQuery.predicates)
          if (matchQuery.nested) {
            query.nested = [...(query.nested ?? []), ...matchQuery.nested]
          }
          break

        case '$project':
          query.projection = this.parseProjection(stageValue as ProjectionSpec)
          break

        case '$group':
          const groupSpec = stageValue as GroupSpec
          query.groupBy = this.parseGroupId(groupSpec._id)
          query.aggregations = this.parseAggregations(groupSpec)
          break

        case '$sort':
          query.sort = this.parseSort(stageValue as SortSpec)
          break

        case '$limit':
          query.limit = stageValue as number
          break

        case '$skip':
          query.skip = stageValue as number
          break

        // Other stages would be handled similarly
        default:
          // For now, skip unsupported stages
          break
      }
    }

    return query
  }

  private parseProjection(spec: ProjectionSpec): string[] {
    const fields: string[] = []
    for (const [field, value] of Object.entries(spec)) {
      if (value === 1 || typeof value === 'string') {
        fields.push(field)
      }
    }
    return fields
  }

  private parseGroupId(id: string | Record<string, string> | null): string[] {
    if (id === null) return []
    if (typeof id === 'string') return [id.replace('$', '')]
    return Object.values(id).map((v) => v.replace('$', ''))
  }

  private parseAggregations(spec: GroupSpec): NormalizedAggregation[] {
    const aggregations: NormalizedAggregation[] = []

    for (const [alias, accum] of Object.entries(spec)) {
      if (alias === '_id') continue

      const accumSpec = accum as AccumulatorSpec
      if ('$sum' in accumSpec) {
        aggregations.push({
          function: 'sum',
          column: typeof accumSpec.$sum === 'string' ? accumSpec.$sum.replace('$', '') : undefined,
          alias,
        })
      } else if ('$avg' in accumSpec) {
        aggregations.push({ function: 'avg', column: accumSpec.$avg.replace('$', ''), alias })
      } else if ('$min' in accumSpec) {
        aggregations.push({ function: 'min', column: accumSpec.$min.replace('$', ''), alias })
      } else if ('$max' in accumSpec) {
        aggregations.push({ function: 'max', column: accumSpec.$max.replace('$', ''), alias })
      } else if ('$first' in accumSpec) {
        aggregations.push({ function: 'first', column: accumSpec.$first.replace('$', ''), alias })
      } else if ('$last' in accumSpec) {
        aggregations.push({ function: 'last', column: accumSpec.$last.replace('$', ''), alias })
      } else if ('$count' in accumSpec) {
        aggregations.push({ function: 'count', alias })
      } else if ('$push' in accumSpec) {
        const pushSpec = accumSpec.$push
        aggregations.push({
          function: 'push',
          column: typeof pushSpec === 'string' ? pushSpec.replace('$', '') : undefined,
          alias,
        })
      } else if ('$addToSet' in accumSpec) {
        aggregations.push({ function: 'addToSet', column: accumSpec.$addToSet.replace('$', ''), alias })
      }
    }

    return aggregations
  }

  private parseSort(spec: SortSpec): { field: string; direction: 'asc' | 'desc' }[] {
    return Object.entries(spec).map(([field, dir]) => ({
      field,
      direction: dir === 1 ? 'asc' : 'desc',
    }))
  }
}

// ============================================================================
// Index Shard Router
// ============================================================================

export class ShardRouter {
  private shards: IndexShard[] = []
  private typeShardMap: Map<string, IndexShard[]> = new Map()
  private hashRanges: { shard: IndexShard; minHash: number; maxHash: number }[] = []
  private geoShards: Map<string, IndexShard[]> = new Map()

  /**
   * Register an index shard
   */
  registerShard(shard: IndexShard): void {
    this.shards.push(shard)

    switch (shard.type) {
      case 'type':
        if (!this.typeShardMap.has(shard.value)) {
          this.typeShardMap.set(shard.value, [])
        }
        this.typeShardMap.get(shard.value)!.push(shard)
        break

      case 'hash':
        // Hash range format: "0-255" or "256-511"
        const [min, max] = shard.value.split('-').map(Number)
        this.hashRanges.push({ shard, minHash: min, maxHash: max })
        break

      case 'geo':
        if (!this.geoShards.has(shard.value)) {
          this.geoShards.set(shard.value, [])
        }
        this.geoShards.get(shard.value)!.push(shard)
        break
    }
  }

  /**
   * Route a query to appropriate shards
   */
  route(query: NormalizedQuery, colo?: string): ShardRoute {
    // Check for type predicate - can route to specific type shard
    const typePredicate = query.predicates.find((p) => p.column === 'type' && p.op === '=')
    if (typePredicate && this.typeShardMap.has(typePredicate.value as string)) {
      const typeShards = this.typeShardMap.get(typePredicate.value as string)!
      // Prefer geo-local replica if available
      const localShard = colo ? typeShards.find((s) => s.colo === colo) : undefined
      return {
        shards: localShard ? [localShard] : [typeShards[0]],
        strategy: 'single',
        partitionKey: typePredicate.value as string,
      }
    }

    // Check for ID predicate - can hash-route to specific shard
    const idPredicate = query.predicates.find((p) => p.column === 'id' && p.op === '=')
    if (idPredicate && this.hashRanges.length > 0) {
      const hash = this.hashString(idPredicate.value as string)
      const hashShard = this.hashRanges.find((r) => hash >= r.minHash && hash <= r.maxHash)
      if (hashShard) {
        return {
          shards: [hashShard.shard],
          strategy: 'single',
          partitionKey: `hash:${hash}`,
        }
      }
    }

    // No specific routing - scatter to all type shards
    const allTypeShards = Array.from(this.typeShardMap.values()).flat()
    if (allTypeShards.length > 0) {
      // Filter to one per type, preferring local colo
      const uniqueTypes = new Set<string>()
      const selectedShards: IndexShard[] = []

      for (const shard of allTypeShards) {
        if (!uniqueTypes.has(shard.value)) {
          uniqueTypes.add(shard.value)
          selectedShards.push(shard)
        }
      }

      return {
        shards: selectedShards,
        strategy: selectedShards.length === 1 ? 'single' : 'scatter',
      }
    }

    // Fallback to all shards
    return {
      shards: this.shards,
      strategy: 'broadcast',
    }
  }

  /**
   * Simple string hash for shard routing
   */
  private hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) >>> 0
    }
    return hash % 1024 // 1024 hash buckets
  }

  /**
   * Get shards for a specific colo (geo-aware routing)
   */
  getShardsForColo(colo: string): IndexShard[] {
    const geoShards = this.geoShards.get(colo) ?? []
    if (geoShards.length > 0) return geoShards

    // Return closest region shards
    // In production, this would use a colo-to-region mapping
    return this.shards.filter((s) => !s.replicaOf)
  }
}

// ============================================================================
// Edge Cache Manager
// ============================================================================

export class EdgeCacheManager {
  private cache: Map<string, CacheEntry> = new Map()
  private maxSizeBytes: number
  private currentSizeBytes = 0
  private defaultTTL: number
  private colo: string

  constructor(options: { maxSizeBytes?: number; defaultTTL?: number; colo?: string } = {}) {
    this.maxSizeBytes = options.maxSizeBytes ?? 100 * 1024 * 1024 // 100MB default
    this.defaultTTL = options.defaultTTL ?? 5 * 60 * 1000 // 5 minutes default
    this.colo = options.colo ?? 'unknown'
  }

  /**
   * Get cached data if available
   */
  get(key: string): unknown | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (Date.now() > entry.expiresAt) {
      this.evict(key)
      return undefined
    }

    return entry.data
  }

  /**
   * Store data in cache
   */
  set(key: string, data: unknown, ttl?: number): void {
    const serialized = JSON.stringify(data)
    const sizeBytes = serialized.length

    // Evict if necessary
    while (this.currentSizeBytes + sizeBytes > this.maxSizeBytes && this.cache.size > 0) {
      this.evictOldest()
    }

    if (sizeBytes > this.maxSizeBytes / 2) {
      return // Don't cache items larger than half the cache
    }

    const entry: CacheEntry = {
      key,
      data,
      colo: this.colo,
      cachedAt: Date.now(),
      expiresAt: Date.now() + (ttl ?? this.defaultTTL),
      sizeBytes,
    }

    // Remove old entry if exists
    if (this.cache.has(key)) {
      this.currentSizeBytes -= this.cache.get(key)!.sizeBytes
    }

    this.cache.set(key, entry)
    this.currentSizeBytes += sizeBytes
  }

  /**
   * Build cache key for a partition fetch
   */
  static partitionKey(partition: string, columns: string[]): string {
    return `partition:${partition}:cols:${columns.sort().join(',')}`
  }

  private evict(key: string): void {
    const entry = this.cache.get(key)
    if (entry) {
      this.currentSizeBytes -= entry.sizeBytes
      this.cache.delete(key)
    }
  }

  private evictOldest(): void {
    let oldest: CacheEntry | undefined
    for (const entry of this.cache.values()) {
      if (!oldest || entry.cachedAt < oldest.cachedAt) {
        oldest = entry
      }
    }
    if (oldest) {
      this.evict(oldest.key)
    }
  }

  getStats(): { entries: number; sizeBytes: number; hitRate?: number } {
    return {
      entries: this.cache.size,
      sizeBytes: this.currentSizeBytes,
    }
  }
}

// ============================================================================
// MongoDB Query Engine
// ============================================================================

export class MongoQueryEngine {
  private queryParser = new MongoQueryParser()
  private pipelineParser = new AggregationPipelineParser()
  private shardRouter = new ShardRouter()
  private cache: EdgeCacheManager

  // Index structures (shared with IcebergIndexAccelerator)
  private bloomFilters: Map<string, BloomFilter> = new Map()
  private minMaxIndex: MinMaxIndex
  private ftsIndex: Map<string, FTSIndex> = new Map()
  private vectorIndex: Map<string, VectorIndex> = new Map()

  constructor(options: { colo?: string; cacheSize?: number } = {}) {
    this.cache = new EdgeCacheManager({
      colo: options.colo,
      maxSizeBytes: options.cacheSize,
    })
    this.minMaxIndex = new MinMaxIndex()
  }

  /**
   * Execute a MongoDB find() query
   */
  async find(
    collection: string,
    query: MongoQuery,
    options: { projection?: string[]; sort?: SortSpec; limit?: number; skip?: number } = {}
  ): Promise<{ data: unknown[]; stats: QueryStats }> {
    const startTime = performance.now()
    const stats: QueryStats = {
      parseTimeMs: 0,
      routingTimeMs: 0,
      indexTimeMs: 0,
      fetchTimeMs: 0,
      aggregateTimeMs: 0,
      totalTimeMs: 0,
      shardsQueried: 0,
      partitionsPruned: 0,
      partitionsFetched: 0,
      cacheHits: 0,
      cacheMisses: 0,
      rowsScanned: 0,
      rowsReturned: 0,
    }

    // Parse query
    const parseStart = performance.now()
    const normalized = this.queryParser.parse(query)
    normalized.projection = options.projection
    normalized.sort = options.sort ? this.pipelineParser['parseSort'](options.sort) : undefined
    normalized.limit = options.limit
    normalized.skip = options.skip
    stats.parseTimeMs = performance.now() - parseStart

    // Add collection type predicate if not already present
    if (!normalized.predicates.some((p) => p.column === 'type')) {
      normalized.predicates.unshift({ column: 'type', op: '=', value: collection })
    }

    // Route to shards
    const routeStart = performance.now()
    const route = this.shardRouter.route(normalized)
    stats.routingTimeMs = performance.now() - routeStart
    stats.shardsQueried = route.shards.length

    // Execute on index layer
    const indexStart = performance.now()
    const indexResult = await this.executeOnIndex(normalized, route)
    stats.indexTimeMs = performance.now() - indexStart
    stats.partitionsPruned = indexResult.partitionsPruned

    // If fully answered from index, return
    if (indexResult.complete) {
      stats.totalTimeMs = performance.now() - startTime
      stats.rowsReturned = indexResult.data.length
      return { data: indexResult.data, stats }
    }

    // Fetch from cold storage
    const fetchStart = performance.now()
    const fetchResult = await this.fetchFromColdStorage(normalized, indexResult.partitions)
    stats.fetchTimeMs = performance.now() - fetchStart
    stats.partitionsFetched = fetchResult.partitionsFetched
    stats.cacheHits = fetchResult.cacheHits
    stats.cacheMisses = fetchResult.cacheMisses
    stats.rowsScanned = fetchResult.rowsScanned

    // Apply final transformations
    const aggregateStart = performance.now()
    const finalResult = this.applyTransformations(fetchResult.data, normalized)
    stats.aggregateTimeMs = performance.now() - aggregateStart

    stats.totalTimeMs = performance.now() - startTime
    stats.rowsReturned = finalResult.length

    return { data: finalResult, stats }
  }

  /**
   * Execute an aggregation pipeline
   */
  async aggregate(
    collection: string,
    pipeline: AggregationStage[]
  ): Promise<{ data: unknown[]; stats: QueryStats }> {
    const startTime = performance.now()
    const stats: QueryStats = {
      parseTimeMs: 0,
      routingTimeMs: 0,
      indexTimeMs: 0,
      fetchTimeMs: 0,
      aggregateTimeMs: 0,
      totalTimeMs: 0,
      shardsQueried: 0,
      partitionsPruned: 0,
      partitionsFetched: 0,
      cacheHits: 0,
      cacheMisses: 0,
      rowsScanned: 0,
      rowsReturned: 0,
    }

    // Parse pipeline
    const parseStart = performance.now()
    const normalized = this.pipelineParser.parse(pipeline)
    stats.parseTimeMs = performance.now() - parseStart

    // Add collection type predicate
    normalized.predicates.unshift({ column: 'type', op: '=', value: collection })

    // Route to shards
    const routeStart = performance.now()
    const route = this.shardRouter.route(normalized)
    stats.routingTimeMs = performance.now() - routeStart
    stats.shardsQueried = route.shards.length

    // Check if we can answer from index (COUNT, EXISTS, etc.)
    const indexStart = performance.now()
    const indexResult = await this.executeOnIndex(normalized, route)
    stats.indexTimeMs = performance.now() - indexStart

    if (indexResult.complete) {
      stats.totalTimeMs = performance.now() - startTime
      stats.rowsReturned = indexResult.data.length
      return { data: indexResult.data, stats }
    }

    // Fetch from cold storage
    const fetchStart = performance.now()
    const fetchResult = await this.fetchFromColdStorage(normalized, indexResult.partitions)
    stats.fetchTimeMs = performance.now() - fetchStart
    stats.partitionsFetched = fetchResult.partitionsFetched
    stats.cacheHits = fetchResult.cacheHits
    stats.cacheMisses = fetchResult.cacheMisses
    stats.rowsScanned = fetchResult.rowsScanned

    // Execute aggregation
    const aggregateStart = performance.now()
    const aggregatedResult = this.executeAggregation(fetchResult.data, normalized)
    stats.aggregateTimeMs = performance.now() - aggregateStart

    stats.totalTimeMs = performance.now() - startTime
    stats.rowsReturned = aggregatedResult.length

    return { data: aggregatedResult, stats }
  }

  /**
   * Register a shard for routing
   */
  registerShard(shard: IndexShard): void {
    this.shardRouter.registerShard(shard)
  }

  /**
   * Add a bloom filter for a field
   */
  addBloomFilter(field: string, values: string[]): void {
    const filter = new BloomFilter(Math.max(values.length, 1000), 0.01)
    for (const value of values) {
      filter.add(value)
    }
    this.bloomFilters.set(field, filter)
  }

  /**
   * Add min/max statistics for a field
   */
  addMinMaxStats(field: string, partition: string, min: unknown, max: unknown, rowCount: number): void {
    this.minMaxIndex.addPartitionStats(field, {
      column: field,
      partitionKey: partition,
      minValue: min,
      maxValue: max,
      nullCount: 0,
      rowCount,
    })
  }

  /**
   * Add FTS index for a field
   */
  addFTSIndex(field: string, index: FTSIndex): void {
    this.ftsIndex.set(field, index)
  }

  /**
   * Add vector index for a field
   */
  addVectorIndex(field: string, index: VectorIndex): void {
    this.vectorIndex.set(field, index)
  }

  // -------------------------------------------------------------------------
  // Private methods
  // -------------------------------------------------------------------------

  private async executeOnIndex(
    query: NormalizedQuery,
    _route: ShardRoute
  ): Promise<{ complete: boolean; data: unknown[]; partitions: string[]; partitionsPruned: number }> {
    let partitions = this.minMaxIndex.getAllPartitions()
    const initialCount = partitions.length

    // Check bloom filters for equality predicates
    for (const pred of query.predicates) {
      if (pred.op === '=' && this.bloomFilters.has(pred.column)) {
        const bloom = this.bloomFilters.get(pred.column)!
        if (!bloom.mightContain(String(pred.value))) {
          // Definitely not in data
          return { complete: true, data: [], partitions: [], partitionsPruned: initialCount }
        }
      }
    }

    // Use min/max to prune partitions
    for (const pred of query.predicates) {
      if (['>', '>=', '<', '<=', '='].includes(pred.op)) {
        const matchingPartitions = this.minMaxIndex.findPartitions(pred.column, pred)
        if (matchingPartitions.length > 0) {
          partitions = partitions.filter((p) => matchingPartitions.includes(p))
        }
      }
    }

    // Check for count-only query
    if (
      query.aggregations?.length === 1 &&
      query.aggregations[0].function === 'count' &&
      !query.aggregations[0].column &&
      query.predicates.length === 1 &&
      query.predicates[0].column === 'type'
    ) {
      const count = this.minMaxIndex.getRowCountForPartitions(partitions)
      return {
        complete: true,
        data: [{ count }],
        partitions: [],
        partitionsPruned: initialCount - partitions.length,
      }
    }

    // Check FTS index for text queries
    for (const pred of query.predicates) {
      if (pred.op === 'CONTAINS') {
        const fts = this.ftsIndex.get(pred.column)
        if (fts) {
          const matchingPartitions = fts.search(pred.value as string)
          partitions = partitions.filter((p) => matchingPartitions.includes(p))
        }
      }
    }

    // Check vector index for similarity queries
    for (const pred of query.predicates) {
      if (pred.op === 'NEAR') {
        const vec = this.vectorIndex.get(pred.column)
        if (vec) {
          // Vector index returns pre-filtered results
          const results = vec.search(pred.value as number[], pred.k ?? 10)
          return {
            complete: true,
            data: results,
            partitions: [],
            partitionsPruned: initialCount,
          }
        }
      }
    }

    return {
      complete: false,
      data: [],
      partitions,
      partitionsPruned: initialCount - partitions.length,
    }
  }

  private async fetchFromColdStorage(
    query: NormalizedQuery,
    partitions: string[]
  ): Promise<{
    data: Record<string, unknown>[]
    partitionsFetched: number
    cacheHits: number
    cacheMisses: number
    rowsScanned: number
  }> {
    let cacheHits = 0
    let cacheMisses = 0
    let rowsScanned = 0
    const allData: Record<string, unknown>[] = []

    // Determine required columns
    const columns = this.extractRequiredColumns(query)

    for (const partition of partitions) {
      const cacheKey = EdgeCacheManager.partitionKey(partition, columns)
      const cached = this.cache.get(cacheKey) as Record<string, unknown[]> | undefined

      if (cached) {
        cacheHits++
        allData.push(...this.columnarToRows(cached))
        rowsScanned += Object.values(cached)[0]?.length ?? 0
      } else {
        cacheMisses++
        // In production, this would fetch from R2
        // For the spike, we simulate with empty data
        // The actual fetch would use: await fetchFromR2(partition, columns)
      }
    }

    return {
      data: allData,
      partitionsFetched: partitions.length,
      cacheHits,
      cacheMisses,
      rowsScanned,
    }
  }

  private extractRequiredColumns(query: NormalizedQuery): string[] {
    const columns = new Set<string>()

    // Projection
    for (const col of query.projection ?? []) {
      columns.add(col)
    }

    // Predicates
    for (const pred of query.predicates) {
      columns.add(pred.column)
    }

    // Sort
    for (const sort of query.sort ?? []) {
      columns.add(sort.field)
    }

    // Group by
    for (const col of query.groupBy ?? []) {
      columns.add(col)
    }

    // Aggregations
    for (const agg of query.aggregations ?? []) {
      if (agg.column) columns.add(agg.column)
    }

    return Array.from(columns)
  }

  private columnarToRows(columnar: Record<string, unknown[]>): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = []
    const rowCount = Object.values(columnar)[0]?.length ?? 0

    for (let i = 0; i < rowCount; i++) {
      const row: Record<string, unknown> = {}
      for (const [col, values] of Object.entries(columnar)) {
        row[col] = values[i]
      }
      rows.push(row)
    }

    return rows
  }

  private applyTransformations(
    data: Record<string, unknown>[],
    query: NormalizedQuery
  ): Record<string, unknown>[] {
    let result = data

    // Apply predicates (filter)
    result = result.filter((row) => this.matchesPredicates(row, query.predicates))

    // Apply sort
    if (query.sort && query.sort.length > 0) {
      result.sort((a, b) => {
        for (const { field, direction } of query.sort!) {
          const cmp = this.compareValues(a[field], b[field])
          if (cmp !== 0) return direction === 'asc' ? cmp : -cmp
        }
        return 0
      })
    }

    // Apply skip
    if (query.skip) {
      result = result.slice(query.skip)
    }

    // Apply limit
    if (query.limit) {
      result = result.slice(0, query.limit)
    }

    // Apply projection
    if (query.projection && query.projection.length > 0) {
      result = result.map((row) => {
        const projected: Record<string, unknown> = {}
        for (const field of query.projection!) {
          projected[field] = this.getNestedValue(row, field)
        }
        return projected
      })
    }

    return result
  }

  private executeAggregation(
    data: Record<string, unknown>[],
    query: NormalizedQuery
  ): Record<string, unknown>[] {
    // First apply filters
    let filtered = data.filter((row) => this.matchesPredicates(row, query.predicates))

    // Group
    if (query.groupBy && query.groupBy.length > 0) {
      const groups = new Map<string, Record<string, unknown>[]>()

      for (const row of filtered) {
        const key = query.groupBy.map((col) => String(this.getNestedValue(row, col))).join('\x00')
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(row)
      }

      // Compute aggregations
      const results: Record<string, unknown>[] = []

      for (const [key, groupRows] of groups) {
        const result: Record<string, unknown> = {}

        // Add group key fields
        const keyParts = key.split('\x00')
        for (let i = 0; i < query.groupBy.length; i++) {
          result[query.groupBy[i]] = keyParts[i]
        }

        // Compute each aggregation
        for (const agg of query.aggregations ?? []) {
          result[agg.alias] = this.computeAggregation(groupRows, agg)
        }

        results.push(result)
      }

      filtered = results
    }

    // Apply sort
    if (query.sort && query.sort.length > 0) {
      filtered.sort((a, b) => {
        for (const { field, direction } of query.sort!) {
          const cmp = this.compareValues(a[field], b[field])
          if (cmp !== 0) return direction === 'asc' ? cmp : -cmp
        }
        return 0
      })
    }

    // Apply limit
    if (query.limit) {
      filtered = filtered.slice(0, query.limit)
    }

    return filtered
  }

  private matchesPredicates(row: Record<string, unknown>, predicates: Predicate[]): boolean {
    for (const pred of predicates) {
      const value = this.getNestedValue(row, pred.column)
      if (!this.evaluatePredicate(value, pred)) {
        return false
      }
    }
    return true
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  private evaluatePredicate(value: unknown, pred: Predicate): boolean {
    switch (pred.op) {
      case '=':
        return value === pred.value
      case '!=':
        return value !== pred.value
      case '>':
        return this.compareValues(value, pred.value) > 0
      case '>=':
        return this.compareValues(value, pred.value) >= 0
      case '<':
        return this.compareValues(value, pred.value) < 0
      case '<=':
        return this.compareValues(value, pred.value) <= 0
      case 'IN':
        return (pred.value as unknown[]).includes(value)
      case 'NOT IN':
        return !(pred.value as unknown[]).includes(value)
      case 'IS NULL':
        return value === null || value === undefined
      case 'IS NOT NULL':
        return value !== null && value !== undefined
      case 'LIKE':
        if (typeof value !== 'string') return false
        const pattern = new RegExp(pred.value as string, 'i')
        return pattern.test(value)
      case 'CONTAINS':
        if (typeof value !== 'string') return false
        return value.toLowerCase().includes((pred.value as string).toLowerCase())
      default:
        return true
    }
  }

  private compareValues(a: unknown, b: unknown): number {
    if (a === b) return 0
    if (a === null || a === undefined) return -1
    if (b === null || b === undefined) return 1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
    return String(a).localeCompare(String(b))
  }

  private computeAggregation(rows: Record<string, unknown>[], agg: NormalizedAggregation): unknown {
    const values = agg.column ? rows.map((r) => this.getNestedValue(r, agg.column!)) : rows

    switch (agg.function) {
      case 'count':
        return values.length

      case 'sum':
        return values.reduce((sum: number, v) => sum + (Number(v) || 0), 0)

      case 'avg': {
        const nums = values.filter((v) => typeof v === 'number') as number[]
        return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null
      }

      case 'min':
        return values.reduce((min, v) => (this.compareValues(v, min) < 0 ? v : min), values[0])

      case 'max':
        return values.reduce((max, v) => (this.compareValues(v, max) > 0 ? v : max), values[0])

      case 'first':
        return values[0]

      case 'last':
        return values[values.length - 1]

      case 'push':
        return values

      case 'addToSet':
        return [...new Set(values)]

      default:
        return null
    }
  }
}

// ============================================================================
// Supporting Index Structures (simplified - would import from other spikes)
// ============================================================================

export class BloomFilter {
  private bits: Uint8Array
  private hashCount: number
  private size: number

  constructor(expectedItems: number, fpr = 0.01) {
    this.size = Math.ceil((-expectedItems * Math.log(fpr)) / Math.log(2) ** 2)
    this.hashCount = Math.ceil((this.size / expectedItems) * Math.log(2))
    this.bits = new Uint8Array(Math.ceil(this.size / 8))
  }

  private hash(value: string, seed: number): number {
    let h = seed
    for (let i = 0; i < value.length; i++) {
      h = ((h * 31 + value.charCodeAt(i)) >>> 0)
    }
    return h % this.size
  }

  add(value: string): void {
    for (let i = 0; i < this.hashCount; i++) {
      const idx = this.hash(value, i)
      this.bits[Math.floor(idx / 8)] |= 1 << idx % 8
    }
  }

  mightContain(value: string): boolean {
    for (let i = 0; i < this.hashCount; i++) {
      const idx = this.hash(value, i)
      if (!(this.bits[Math.floor(idx / 8)] & (1 << idx % 8))) {
        return false
      }
    }
    return true
  }
}

export class MinMaxIndex {
  private stats: Map<string, { partitionKey: string; minValue: unknown; maxValue: unknown; rowCount: number }[]> =
    new Map()
  private allPartitions: Set<string> = new Set()

  addPartitionStats(
    column: string,
    stats: { column: string; partitionKey: string; minValue: unknown; maxValue: unknown; nullCount: number; rowCount: number }
  ): void {
    if (!this.stats.has(column)) {
      this.stats.set(column, [])
    }
    this.stats.get(column)!.push({
      partitionKey: stats.partitionKey,
      minValue: stats.minValue,
      maxValue: stats.maxValue,
      rowCount: stats.rowCount,
    })
    this.allPartitions.add(stats.partitionKey)
  }

  findPartitions(column: string, predicate: Predicate): string[] {
    const columnStats = this.stats.get(column)
    if (!columnStats) return []

    return columnStats
      .filter((s) => this.mightMatch(s, predicate))
      .map((s) => s.partitionKey)
  }

  private mightMatch(
    stat: { minValue: unknown; maxValue: unknown },
    predicate: Predicate
  ): boolean {
    const { minValue, maxValue } = stat
    const compare = (a: unknown, b: unknown): number => {
      if (a === b) return 0
      if (typeof a === 'number' && typeof b === 'number') return a - b
      return String(a).localeCompare(String(b))
    }

    switch (predicate.op) {
      case '=':
        return compare(predicate.value, minValue) >= 0 && compare(predicate.value, maxValue) <= 0
      case '>':
        return compare(maxValue, predicate.value) > 0
      case '>=':
        return compare(maxValue, predicate.value) >= 0
      case '<':
        return compare(minValue, predicate.value) < 0
      case '<=':
        return compare(minValue, predicate.value) <= 0
      default:
        return true
    }
  }

  getAllPartitions(): string[] {
    return Array.from(this.allPartitions)
  }

  getRowCountForPartitions(partitions: string[]): number {
    let total = 0
    for (const [, columnStats] of this.stats) {
      for (const stat of columnStats) {
        if (partitions.includes(stat.partitionKey)) {
          total = Math.max(total, stat.rowCount)
        }
      }
      break // Only count once
    }
    return total
  }
}

/** Simplified FTS index interface */
export interface FTSIndex {
  search(query: string): string[] // Returns matching partition keys
}

/** Simplified vector index interface */
export interface VectorIndex {
  search(query: number[], k: number): Record<string, unknown>[]
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Generate test data for MongoDB queries
 */
export function generateTestData(count: number, type: string): Record<string, unknown>[] {
  const data: Record<string, unknown>[] = []

  for (let i = 0; i < count; i++) {
    data.push({
      id: `${type}-${i}`,
      type,
      data: {
        name: `${type} ${i}`,
        email: `${type.toLowerCase()}${i}@example.com`,
        age: 18 + (i % 60),
        score: Math.random() * 100,
        active: i % 2 === 0,
        tags: [`tag${i % 5}`, `category${i % 3}`],
        createdAt: new Date(Date.now() - i * 86400000),
      },
      createdAt: Date.now() - i * 86400000,
      updatedAt: Date.now() - i * 3600000,
    })
  }

  return data
}

/**
 * Cost comparison between traditional and accelerated queries
 */
export function costAnalysis(
  totalRecords: number,
  partitions: number
): {
  query: string
  traditional: { partitionsFetched: number; estimatedCost: string }
  accelerated: { partitionsFetched: number; indexReads: number; estimatedCost: string }
  savings: string
}[] {
  const partitionFetchCost = 0.00001 // $0.01 per 1000 fetches
  const indexReadCost = 0.000001 // $0.001 per 1000 reads

  return [
    {
      query: 'db.users.find()',
      traditional: {
        partitionsFetched: partitions,
        estimatedCost: `$${(partitions * partitionFetchCost).toFixed(6)}`,
      },
      accelerated: {
        partitionsFetched: partitions,
        indexReads: 1,
        estimatedCost: `$${(partitions * partitionFetchCost + indexReadCost).toFixed(6)}`,
      },
      savings: '0%',
    },
    {
      query: 'db.users.countDocuments()',
      traditional: {
        partitionsFetched: partitions,
        estimatedCost: `$${(partitions * partitionFetchCost).toFixed(6)}`,
      },
      accelerated: {
        partitionsFetched: 0,
        indexReads: 1,
        estimatedCost: `$${indexReadCost.toFixed(6)}`,
      },
      savings: '99.99%',
    },
    {
      query: 'db.users.find({"data.email": "x@y.com"})',
      traditional: {
        partitionsFetched: partitions,
        estimatedCost: `$${(partitions * partitionFetchCost).toFixed(6)}`,
      },
      accelerated: {
        partitionsFetched: 0,
        indexReads: 1,
        estimatedCost: `$${indexReadCost.toFixed(6)}`,
      },
      savings: '99.99%',
    },
    {
      query: 'db.users.find({createdAt: {$gt: date}})',
      traditional: {
        partitionsFetched: partitions,
        estimatedCost: `$${(partitions * partitionFetchCost).toFixed(6)}`,
      },
      accelerated: {
        partitionsFetched: Math.floor(partitions * 0.25),
        indexReads: 1,
        estimatedCost: `$${(Math.floor(partitions * 0.25) * partitionFetchCost + indexReadCost).toFixed(6)}`,
      },
      savings: '75%',
    },
    {
      query: 'db.users.find({type: "Premium"})',
      traditional: {
        partitionsFetched: partitions,
        estimatedCost: `$${(partitions * partitionFetchCost).toFixed(6)}`,
      },
      accelerated: {
        partitionsFetched: Math.floor(partitions * 0.1),
        indexReads: 1,
        estimatedCost: `$${(Math.floor(partitions * 0.1) * partitionFetchCost + indexReadCost).toFixed(6)}`,
      },
      savings: '90%',
    },
    {
      query: 'db.users.aggregate([{$match: {}}, {$group: {_id: "$type", count: {$sum: 1}}}])',
      traditional: {
        partitionsFetched: partitions,
        estimatedCost: `$${(partitions * partitionFetchCost).toFixed(6)}`,
      },
      accelerated: {
        partitionsFetched: 0,
        indexReads: 1,
        estimatedCost: `$${indexReadCost.toFixed(6)}`,
      },
      savings: '99.99%',
    },
    {
      query: 'db.users.find({$text: {$search: "urgent"}})',
      traditional: {
        partitionsFetched: partitions,
        estimatedCost: `$${(partitions * partitionFetchCost).toFixed(6)}`,
      },
      accelerated: {
        partitionsFetched: Math.floor(partitions * 0.05),
        indexReads: 2,
        estimatedCost: `$${(Math.floor(partitions * 0.05) * partitionFetchCost + 2 * indexReadCost).toFixed(6)}`,
      },
      savings: '95%',
    },
    {
      query: 'db.products.find({$vector: {$near: embedding, $k: 10}})',
      traditional: {
        partitionsFetched: partitions,
        estimatedCost: `$${(partitions * partitionFetchCost).toFixed(6)}`,
      },
      accelerated: {
        partitionsFetched: 0,
        indexReads: 1,
        estimatedCost: `$${indexReadCost.toFixed(6)}`,
      },
      savings: '99.99%',
    },
  ]
}
