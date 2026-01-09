/**
 * @dotdo/weaviate - Weaviate-compatible vector database
 *
 * Drop-in replacement for weaviate-ts-client backed by DO SQLite.
 * This in-memory implementation matches Weaviate API for testing.
 * Production version uses SQLite vector extensions in Durable Objects.
 *
 * @see https://weaviate.io/developers/weaviate/client-libraries/typescript
 */

// Types
export type {
  WeaviateClientConfig,
  WeaviateClass,
  WeaviateSchema,
  WeaviateProperty,
  WeaviateDataType,
  WeaviateVectorizer,
  VectorIndexConfig,
  InvertedIndexConfig,
  WeaviateObject,
  WeaviateAdditional,
  NearVectorParams,
  NearTextParams,
  NearObjectParams,
  Bm25Params,
  HybridParams,
  WhereFilter,
  WhereOperator,
  SortSpec,
  GraphQLResponse,
  BatchResult,
  BatchDeleteResult,
} from './types'

// Client
export { weaviate, WeaviateClient } from './weaviate'
export { weaviate as default } from './weaviate'
