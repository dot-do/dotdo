/**
 * @dotdo/qdrant - Qdrant-compatible vector search SDK
 *
 * Drop-in replacement for @qdrant/js-client-rest backed by DO SQLite.
 * This in-memory implementation matches Qdrant API for testing.
 * Production version uses SQLite with vector extensions in Durable Objects.
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
} from './types'

// Client
export { QdrantClient } from './qdrant'
