/**
 * @dotdo/cubejs - Cube.js Headless BI Compatibility Layer
 *
 * A Cube.js-compatible semantic layer for the dotdo platform.
 * Provides cube schemas, query building, SQL generation, pre-aggregation caching,
 * and a REST API compatible with Cube.js clients.
 *
 * @example
 * ```typescript
 * import {
 *   cube,
 *   CubeClient,
 *   QueryBuilder,
 *   createCubeAPI,
 * } from '@dotdo/compat/cubejs'
 *
 * // Define a cube schema
 * const Orders = cube('Orders', {
 *   sql: 'SELECT * FROM orders',
 *   measures: {
 *     count: { type: 'count' },
 *     totalAmount: { sql: 'amount', type: 'sum' },
 *   },
 *   dimensions: {
 *     id: { sql: 'id', type: 'number', primaryKey: true },
 *     status: { sql: 'status', type: 'string' },
 *     createdAt: { sql: 'created_at', type: 'time' },
 *   },
 *   preAggregations: {
 *     ordersDaily: {
 *       type: 'rollup',
 *       measureReferences: ['count', 'totalAmount'],
 *       dimensionReferences: ['status'],
 *       timeDimensionReference: 'createdAt',
 *       granularity: 'day',
 *     },
 *   },
 * })
 *
 * // Build queries
 * const query = new QueryBuilder()
 *   .select('Orders.count', 'Orders.totalAmount')
 *   .dimensions('Orders.status')
 *   .where('Orders.status', 'equals', 'completed')
 *   .timeDimension('Orders.createdAt', 'day', 'last 30 days')
 *   .orderBy('Orders.totalAmount', 'desc')
 *   .limit(100)
 *   .build()
 *
 * // Use the client
 * const client = new CubeClient({
 *   apiToken: 'your_api_token',
 *   apiUrl: 'https://cube.example.com/cubejs-api/v1',
 * })
 *
 * const result = await client.load(query)
 *
 * // Or create a compatible API
 * const api = createCubeAPI({
 *   cubes: [Orders],
 *   apiToken: 'your_api_token',
 *   dataSource: async (query) => db.query(generateSQL(query)),
 * })
 *
 * export default { fetch: api.fetch }
 * ```
 */

// =============================================================================
// Schema
// =============================================================================

export {
  // Factory
  cube,

  // Types
  type CubeSchema,
  type Measure,
  type MeasureType,
  type Dimension,
  type DimensionType,
  type Join,
  type JoinRelationship,
  type PreAggregation,
  type PreAggregationType,
  type Segment,
  type Granularity,
  type RefreshKey,

  // Helpers
  getPrimaryKey,
  getTimeDimensions,
  getMeasure,
  getDimension,
  hasJoinPath,
  getJoinPath,
} from './schema'

// =============================================================================
// Query
// =============================================================================

export {
  // Builder
  QueryBuilder,

  // Types
  type CubeQuery,
  type Filter,
  type LogicalFilter,
  type FilterOperator,
  type TimeDimension,
  type SortDirection,
  type Order,
  type PivotConfig,

  // Helpers
  filter,
  and,
  or,
  timeDimension,
  normalizeQuery,
  getQueryCubes,
  validateQueryMembers,
} from './query'

// =============================================================================
// Client
// =============================================================================

export {
  CubeClient,

  // Types
  type CubeClientOptions,
  type QueryResult,
  type MetaResult,
  type DryRunResult,
  type LoadOptions,
  type SecurityContext,
} from './client'

// =============================================================================
// Cache
// =============================================================================

export {
  PreAggregationCache,

  // Types
  type PreAggregationCacheOptions,
} from './cache'

// =============================================================================
// API
// =============================================================================

export {
  CubeAPI,
  createCubeAPI,

  // Types
  type CubeAPIOptions,
  type MetaResponse,
  type DryRunResponse,
  type SQLResponse,
} from './api'

// =============================================================================
// SQL Generation
// =============================================================================

export { generateSQL } from './sql'

// =============================================================================
// Errors
// =============================================================================

export {
  CubeError,
  ValidationError,
  QueryError,
  AuthenticationError,
  NotFoundError,
  PreAggregationError,
  SQLGenerationError,
} from './errors'
