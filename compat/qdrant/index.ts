/**
 * @dotdo/qdrant - Qdrant SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for @qdrant/js-client-rest backed by DO SQLite.
 * This implementation matches the Qdrant TypeScript API.
 *
 * @example
 * ```typescript
 * import { QdrantClient } from '@dotdo/qdrant'
 *
 * const client = new QdrantClient({ url: 'http://localhost:6333' })
 *
 * // Create a collection
 * await client.createCollection('products', {
 *   vectors: {
 *     size: 768,
 *     distance: 'Cosine',
 *   },
 * })
 *
 * // Upsert points (vectors with payloads)
 * await client.upsert('products', {
 *   wait: true,
 *   points: [
 *     {
 *       id: 1,
 *       vector: [0.1, 0.2, 0.3, ...],
 *       payload: { name: 'iPhone', price: 999, category: 'electronics' },
 *     },
 *     {
 *       id: 2,
 *       vector: [0.4, 0.5, 0.6, ...],
 *       payload: { name: 'MacBook', price: 2499, category: 'electronics' },
 *     },
 *   ],
 * })
 *
 * // Search for similar vectors
 * const results = await client.search('products', {
 *   vector: [0.1, 0.2, 0.3, ...],
 *   limit: 10,
 *   filter: {
 *     must: [
 *       { key: 'category', match: { value: 'electronics' } },
 *       { key: 'price', range: { lte: 1500 } },
 *     ],
 *   },
 *   with_payload: true,
 *   with_vector: false,
 * })
 *
 * // Batch search
 * const batchResults = await client.searchBatch('products', {
 *   searches: [
 *     { vector: [0.1, 0.2, ...], limit: 5 },
 *     { vector: [0.3, 0.4, ...], limit: 5 },
 *   ],
 * })
 *
 * // Retrieve points by ID
 * const points = await client.retrieve('products', {
 *   ids: [1, 2],
 *   with_payload: true,
 *   with_vector: true,
 * })
 *
 * // Scroll through all points
 * const scrollResult = await client.scroll('products', {
 *   limit: 100,
 *   with_payload: true,
 *   filter: { must: [{ key: 'category', match: { value: 'electronics' } }] },
 * })
 *
 * // Count points
 * const count = await client.count('products', {
 *   filter: { must: [{ key: 'price', range: { gte: 500 } }] },
 *   exact: true,
 * })
 *
 * // Delete points
 * await client.delete('products', {
 *   wait: true,
 *   points: [1, 2],
 * })
 *
 * // Delete by filter
 * await client.delete('products', {
 *   wait: true,
 *   filter: { must: [{ key: 'price', range: { gt: 2000 } }] },
 * })
 *
 * // Recommend similar points
 * const recommendations = await client.recommend('products', {
 *   positive: [1, 2],
 *   negative: [3],
 *   limit: 10,
 * })
 *
 * // Get collection info
 * const info = await client.getCollection('products')
 *
 * // List collections
 * const collections = await client.getCollections()
 *
 * // Delete collection
 * await client.deleteCollection('products')
 * ```
 *
 * @see https://qdrant.tech/documentation/
 */

// Types
export type {
  // Client
  QdrantClientConfig,
  // Distance metrics
  Distance,
  // Collection
  VectorParams,
  HnswConfig,
  QuantizationConfig,
  CollectionConfig,
  CollectionInfo,
  PayloadSchemaInfo,
  CollectionsResponse,
  // Points
  PointId,
  Payload,
  PointStruct,
  Record,
  ScoredPoint,
  // Filters
  FieldCondition,
  MatchValue,
  RangeCondition,
  GeoBoundingBox,
  GeoRadius,
  GeoPolygon,
  GeoPoint,
  ValuesCount,
  HasIdCondition,
  IsEmptyCondition,
  IsNullCondition,
  NestedCondition,
  Condition,
  Filter,
  // Search
  SearchRequest,
  SearchParams,
  // Retrieve
  RetrieveRequest,
  // Scroll
  ScrollRequest,
  ScrollResponse,
  // Count
  CountRequest,
  CountResponse,
  // Delete
  PointsSelector,
  // Upsert
  UpsertRequest,
  // Operations
  OperationResult,
  // Batch
  BatchSearchRequest,
  // Recommend
  RecommendRequest,
} from '../../search/compat/vector/qdrant/types'

// Client
export { QdrantClient } from '../../search/compat/vector/qdrant/qdrant'

// Default export for convenience
export { QdrantClient as default } from '../../search/compat/vector/qdrant/qdrant'
