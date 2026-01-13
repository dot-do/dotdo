/**
 * Source Capability Detection for Query Federation
 *
 * This module provides capability detection for data sources,
 * allowing the query planner to know what operations each source supports.
 * This enables intelligent query pushdown and federation planning.
 *
 * @see dotdo-wwnz3
 */

import type {
  ComparisonOp,
  AggregateFunction,
  JoinType,
  DistanceMetric,
  QueryNode,
  PredicateNode,
  LogicalNode,
  ProjectionNode,
  GroupByNode,
  JoinNode,
} from '../ast'

// =============================================================================
// Types
// =============================================================================

/**
 * Transaction isolation levels
 */
export type IsolationLevel = 'read_uncommitted' | 'read_committed' | 'repeatable_read' | 'serializable'

/**
 * Source capabilities interface
 * Defines what operations a data source can perform
 */
export interface SourceCapabilities {
  // Core query capabilities
  supportsFiltering: boolean
  supportsProjection: boolean
  supportsAggregation: boolean
  supportsSorting: boolean

  // Supported operators and functions
  supportedOperators: ComparisonOp[]
  supportedAggregates: AggregateFunction[]

  // Join capabilities
  supportsJoins: boolean
  supportedJoinTypes: JoinType[]
  supportsSubqueries: boolean

  // Result handling
  maxResultSize: number
  supportsStreaming: boolean

  // Pagination
  supportsPagination: boolean
  supportsOffset: boolean
  supportsCursor: boolean

  // Advanced search
  supportsFullTextSearch: boolean
  supportsVectorSearch: boolean
  supportedDistanceMetrics: DistanceMetric[]

  // Transactions
  supportsTransactions: boolean
  isolationLevels: IsolationLevel[]
}

/**
 * Partial capabilities for building capabilities incrementally
 */
export type PartialCapabilities = Partial<SourceCapabilities>

/**
 * Query to check against capabilities
 */
export interface CapabilityQuery {
  filter?: PredicateNode | LogicalNode
  projection?: ProjectionNode
  groupBy?: GroupByNode
  join?: JoinNode
}

/**
 * Data source interface for capability probing
 */
export interface ProbeableSource {
  name: string
  execute: (query: string) => Promise<unknown[]>
}

// =============================================================================
// Default/Empty Capabilities
// =============================================================================

/**
 * Empty capabilities - nothing is supported
 */
const EMPTY_CAPABILITIES: SourceCapabilities = {
  supportsFiltering: false,
  supportsProjection: false,
  supportsAggregation: false,
  supportsSorting: false,
  supportedOperators: [],
  supportedAggregates: [],
  supportsJoins: false,
  supportedJoinTypes: [],
  supportsSubqueries: false,
  maxResultSize: 1000,
  supportsStreaming: false,
  supportsPagination: false,
  supportsOffset: false,
  supportsCursor: false,
  supportsFullTextSearch: false,
  supportsVectorSearch: false,
  supportedDistanceMetrics: [],
  supportsTransactions: false,
  isolationLevels: [],
}

/**
 * Default capabilities - minimal support for basic operations
 */
export const DEFAULT_CAPABILITIES: SourceCapabilities = {
  ...EMPTY_CAPABILITIES,
  supportsFiltering: true,
  supportedOperators: ['='],
}

// =============================================================================
// Preset Capabilities for Common Data Sources
// =============================================================================

/**
 * SQLite capabilities
 */
export const SQLITE_CAPABILITIES: SourceCapabilities = {
  supportsFiltering: true,
  supportsProjection: true,
  supportsAggregation: true,
  supportsSorting: true,
  supportedOperators: ['=', '!=', '>', '>=', '<', '<=', 'IN', 'NOT IN', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL'],
  supportedAggregates: ['count', 'sum', 'avg', 'min', 'max'],
  supportsJoins: true,
  supportedJoinTypes: ['INNER', 'LEFT', 'CROSS'],
  supportsSubqueries: true,
  maxResultSize: Infinity,
  supportsStreaming: false,
  supportsPagination: true,
  supportsOffset: true,
  supportsCursor: false,
  supportsFullTextSearch: true, // FTS5
  supportsVectorSearch: false,
  supportedDistanceMetrics: [],
  supportsTransactions: true,
  isolationLevels: ['serializable'],
}

/**
 * PostgreSQL capabilities
 */
export const POSTGRES_CAPABILITIES: SourceCapabilities = {
  supportsFiltering: true,
  supportsProjection: true,
  supportsAggregation: true,
  supportsSorting: true,
  supportedOperators: ['=', '!=', '>', '>=', '<', '<=', 'IN', 'NOT IN', 'BETWEEN', 'LIKE', 'CONTAINS', 'IS NULL', 'IS NOT NULL'],
  supportedAggregates: ['count', 'sum', 'avg', 'min', 'max', 'first', 'last'],
  supportsJoins: true,
  supportedJoinTypes: ['INNER', 'LEFT', 'RIGHT', 'CROSS'],
  supportsSubqueries: true,
  maxResultSize: Infinity,
  supportsStreaming: true,
  supportsPagination: true,
  supportsOffset: true,
  supportsCursor: true,
  supportsFullTextSearch: true,
  supportsVectorSearch: true, // pgvector
  supportedDistanceMetrics: ['cosine', 'euclidean', 'dotProduct'],
  supportsTransactions: true,
  isolationLevels: ['read_uncommitted', 'read_committed', 'repeatable_read', 'serializable'],
}

/**
 * MongoDB capabilities
 */
export const MONGODB_CAPABILITIES: SourceCapabilities = {
  supportsFiltering: true,
  supportsProjection: true,
  supportsAggregation: true,
  supportsSorting: true,
  supportedOperators: ['=', '!=', '>', '>=', '<', '<=', 'IN', 'NOT IN', 'CONTAINS', 'IS NULL', 'IS NOT NULL'],
  supportedAggregates: ['count', 'sum', 'avg', 'min', 'max', 'first', 'last', 'push', 'addToSet'],
  supportsJoins: false, // $lookup is not a true join
  supportedJoinTypes: [],
  supportsSubqueries: false,
  maxResultSize: Infinity,
  supportsStreaming: true,
  supportsPagination: true,
  supportsOffset: true,
  supportsCursor: true,
  supportsFullTextSearch: true,
  supportsVectorSearch: true, // Atlas Vector Search
  supportedDistanceMetrics: ['cosine', 'euclidean', 'dotProduct'],
  supportsTransactions: true,
  isolationLevels: ['read_committed'],
}

/**
 * Elasticsearch capabilities
 */
export const ELASTICSEARCH_CAPABILITIES: SourceCapabilities = {
  supportsFiltering: true,
  supportsProjection: true,
  supportsAggregation: true,
  supportsSorting: true,
  supportedOperators: ['=', '!=', '>', '>=', '<', '<=', 'IN', 'CONTAINS', 'LIKE', 'IS NULL', 'IS NOT NULL'],
  supportedAggregates: ['count', 'sum', 'avg', 'min', 'max'],
  supportsJoins: false,
  supportedJoinTypes: [],
  supportsSubqueries: false,
  maxResultSize: 10000, // Default ES limit
  supportsStreaming: true, // scroll API
  supportsPagination: true,
  supportsOffset: true,
  supportsCursor: true,
  supportsFullTextSearch: true,
  supportsVectorSearch: true, // kNN search
  supportedDistanceMetrics: ['cosine', 'euclidean', 'dotProduct'],
  supportsTransactions: false,
  isolationLevels: [],
}

/**
 * Redis capabilities (basic key-value only)
 */
export const REDIS_CAPABILITIES: SourceCapabilities = {
  supportsFiltering: true,
  supportsProjection: false,
  supportsAggregation: false,
  supportsSorting: false,
  supportedOperators: ['='], // Only key equality
  supportedAggregates: [],
  supportsJoins: false,
  supportedJoinTypes: [],
  supportsSubqueries: false,
  maxResultSize: Infinity,
  supportsStreaming: true, // SCAN
  supportsPagination: false,
  supportsOffset: false,
  supportsCursor: true, // SCAN cursor
  supportsFullTextSearch: false, // RediSearch is separate
  supportsVectorSearch: false, // RedisVL is separate
  supportedDistanceMetrics: [],
  supportsTransactions: true, // MULTI
  isolationLevels: ['read_committed'],
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create capabilities from partial specification
 * Missing properties default to false/empty
 */
export function createCapabilities(partial: PartialCapabilities): SourceCapabilities {
  return {
    ...EMPTY_CAPABILITIES,
    ...partial,
  }
}

// =============================================================================
// Capability Detector Class
// =============================================================================

/**
 * Capability detector for managing and probing source capabilities
 */
export class CapabilityDetector {
  private sources: Map<string, SourceCapabilities> = new Map()

  /**
   * Register a source with its capabilities
   */
  registerSource(name: string, capabilities: SourceCapabilities): void {
    this.sources.set(name, capabilities)
  }

  /**
   * Get capabilities for a registered source
   */
  getCapabilities(name: string): SourceCapabilities | undefined {
    return this.sources.get(name)
  }

  /**
   * List all registered source names
   */
  listSources(): string[] {
    return Array.from(this.sources.keys())
  }

  /**
   * Detect capabilities from connection string
   */
  detectFromConnectionString(connectionString: string): SourceCapabilities {
    // Parse protocol from connection string
    const protocol = connectionString.split('://')[0]?.toLowerCase()

    switch (protocol) {
      case 'sqlite':
        return SQLITE_CAPABILITIES

      case 'postgres':
      case 'postgresql':
        return POSTGRES_CAPABILITIES

      case 'mongodb':
      case 'mongodb+srv':
        return MONGODB_CAPABILITIES

      case 'elasticsearch':
      case 'https': // Could be ES
        if (connectionString.includes('elastic') || connectionString.includes(':9200')) {
          return ELASTICSEARCH_CAPABILITIES
        }
        return createCapabilities({})

      case 'redis':
      case 'rediss':
        return REDIS_CAPABILITIES

      default:
        return createCapabilities({})
    }
  }

  /**
   * Probe a source to verify filtering capability
   */
  async probeFiltering(source: ProbeableSource): Promise<boolean> {
    try {
      await source.execute('SELECT 1 WHERE 1 = 1')
      return true
    } catch {
      return false
    }
  }

  /**
   * Probe a source to verify aggregation capability
   */
  async probeAggregation(source: ProbeableSource): Promise<boolean> {
    try {
      await source.execute('SELECT COUNT(*) FROM (SELECT 1)')
      return true
    } catch {
      return false
    }
  }

  /**
   * Probe and update capabilities for a source
   */
  async probeAndUpdate(source: ProbeableSource): Promise<void> {
    const current = this.sources.get(source.name) || createCapabilities({})

    const supportsFiltering = await this.probeFiltering(source)

    this.sources.set(source.name, {
      ...current,
      supportsFiltering,
    })
  }

  /**
   * Intersect capabilities from multiple sources
   * Returns capabilities that ALL sources support (for federated queries)
   */
  intersectCapabilities(capsList: SourceCapabilities[]): SourceCapabilities {
    if (capsList.length === 0) {
      return createCapabilities({})
    }

    if (capsList.length === 1) {
      return capsList[0]!
    }

    // Find intersection of operators
    const operatorSets = capsList.map(c => new Set(c.supportedOperators))
    const commonOperators = [...operatorSets[0]!].filter(op =>
      operatorSets.every(set => set.has(op))
    ) as ComparisonOp[]

    // Find intersection of aggregates
    const aggregateSets = capsList.map(c => new Set(c.supportedAggregates))
    const commonAggregates = [...aggregateSets[0]!].filter(agg =>
      aggregateSets.every(set => set.has(agg))
    ) as AggregateFunction[]

    // Find intersection of join types
    const joinTypeSets = capsList.map(c => new Set(c.supportedJoinTypes))
    const commonJoinTypes = [...joinTypeSets[0]!].filter(jt =>
      joinTypeSets.every(set => set.has(jt))
    ) as JoinType[]

    // Find intersection of distance metrics
    const metricSets = capsList.map(c => new Set(c.supportedDistanceMetrics))
    const commonMetrics = [...metricSets[0]!].filter(m =>
      metricSets.every(set => set.has(m))
    ) as DistanceMetric[]

    // Find intersection of isolation levels
    const isoSets = capsList.map(c => new Set(c.isolationLevels))
    const commonIsoLevels = [...isoSets[0]!].filter(iso =>
      isoSets.every(set => set.has(iso))
    ) as IsolationLevel[]

    return {
      supportsFiltering: capsList.every(c => c.supportsFiltering),
      supportsProjection: capsList.every(c => c.supportsProjection),
      supportsAggregation: capsList.every(c => c.supportsAggregation),
      supportsSorting: capsList.every(c => c.supportsSorting),
      supportedOperators: commonOperators,
      supportedAggregates: commonAggregates,
      supportsJoins: capsList.every(c => c.supportsJoins),
      supportedJoinTypes: commonJoinTypes,
      supportsSubqueries: capsList.every(c => c.supportsSubqueries),
      maxResultSize: Math.min(...capsList.map(c => c.maxResultSize)),
      supportsStreaming: capsList.every(c => c.supportsStreaming),
      supportsPagination: capsList.every(c => c.supportsPagination),
      supportsOffset: capsList.every(c => c.supportsOffset),
      supportsCursor: capsList.every(c => c.supportsCursor),
      supportsFullTextSearch: capsList.every(c => c.supportsFullTextSearch),
      supportsVectorSearch: capsList.every(c => c.supportsVectorSearch),
      supportedDistanceMetrics: commonMetrics,
      supportsTransactions: capsList.every(c => c.supportsTransactions),
      isolationLevels: commonIsoLevels,
    }
  }
}

// =============================================================================
// Query Compatibility Helpers
// =============================================================================

/**
 * Check if a filter predicate can be pushed to a source
 */
export function canPushFilter(
  node: PredicateNode | LogicalNode | QueryNode,
  caps: SourceCapabilities
): boolean {
  if (!caps.supportsFiltering) {
    return false
  }

  if (node.type === 'predicate') {
    const predicate = node as PredicateNode

    // Check if operator is supported
    if (!caps.supportedOperators.includes(predicate.op)) {
      return false
    }

    // Special handling for NEAR - requires vector search capability
    if (predicate.op === 'NEAR') {
      if (!caps.supportsVectorSearch) {
        return false
      }
      // Check if the distance metric is supported
      if (predicate.metric && !caps.supportedDistanceMetrics.includes(predicate.metric)) {
        return false
      }
    }

    return true
  }

  if (node.type === 'logical') {
    const logical = node as LogicalNode
    // All children must be pushable
    return logical.children.every(child => canPushFilter(child, caps))
  }

  return false
}

/**
 * Check if a projection can be pushed to a source
 */
export function canPushProjection(
  projection: ProjectionNode,
  caps: SourceCapabilities
): boolean {
  return caps.supportsProjection
}

/**
 * Check if aggregation can be pushed to a source
 */
export function canPushAggregation(
  groupBy: GroupByNode,
  caps: SourceCapabilities
): boolean {
  if (!caps.supportsAggregation) {
    return false
  }

  // Check if all aggregate functions are supported
  for (const agg of groupBy.aggregations) {
    if (!caps.supportedAggregates.includes(agg.aggregation.function)) {
      return false
    }
  }

  // Check HAVING clause if present
  if (groupBy.having) {
    if (!canPushFilter(groupBy.having, caps)) {
      return false
    }
  }

  return true
}

/**
 * Check if a join can be pushed to a source
 */
export function canPushJoin(
  join: JoinNode,
  caps: SourceCapabilities
): boolean {
  if (!caps.supportsJoins) {
    return false
  }

  if (!caps.supportedJoinTypes.includes(join.joinType)) {
    return false
  }

  return true
}

/**
 * Check if an entire query can be executed on a source
 */
export function canExecuteQuery(
  query: CapabilityQuery,
  caps: SourceCapabilities
): boolean {
  // Check filter
  if (query.filter && !canPushFilter(query.filter, caps)) {
    return false
  }

  // Check projection
  if (query.projection && !canPushProjection(query.projection, caps)) {
    return false
  }

  // Check aggregation
  if (query.groupBy && !canPushAggregation(query.groupBy, caps)) {
    return false
  }

  // Check join
  if (query.join && !canPushJoin(query.join, caps)) {
    return false
  }

  return true
}
