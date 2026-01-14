/**
 * @dotdo/weaviate - Weaviate SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for weaviate-ts-client backed by DO SQLite.
 * This implementation matches the Weaviate TypeScript API.
 *
 * @example
 * ```typescript
 * import weaviate from '@dotdo/weaviate'
 *
 * const client = weaviate.client({
 *   scheme: 'http',
 *   host: 'localhost:8080',
 * })
 *
 * // Create a class (collection)
 * await client.schema.classCreator().withClass({
 *   class: 'Article',
 *   vectorizer: 'text2vec-openai',
 *   properties: [
 *     { name: 'title', dataType: ['text'] },
 *     { name: 'content', dataType: ['text'] },
 *     { name: 'category', dataType: ['string'] },
 *   ],
 * }).do()
 *
 * // Add objects
 * await client.data.creator()
 *   .withClassName('Article')
 *   .withProperties({
 *     title: 'Hello World',
 *     content: 'This is a test article',
 *     category: 'tech',
 *   })
 *   .withVector([0.1, 0.2, 0.3, ...])
 *   .do()
 *
 * // Batch import
 * const batcher = client.batch.objectsBatcher()
 * batcher.withObject({
 *   class: 'Article',
 *   properties: { title: 'Article 1', content: 'Content 1' },
 *   vector: [0.1, 0.2, ...],
 * })
 * batcher.withObject({
 *   class: 'Article',
 *   properties: { title: 'Article 2', content: 'Content 2' },
 *   vector: [0.3, 0.4, ...],
 * })
 * await batcher.do()
 *
 * // Vector search (nearVector)
 * const results = await client.graphql.get()
 *   .withClassName('Article')
 *   .withFields('title content _additional { distance }')
 *   .withNearVector({ vector: [0.1, 0.2, 0.3, ...] })
 *   .withLimit(10)
 *   .do()
 *
 * // Semantic search (nearText)
 * const semanticResults = await client.graphql.get()
 *   .withClassName('Article')
 *   .withFields('title content')
 *   .withNearText({ concepts: ['machine learning'] })
 *   .withLimit(5)
 *   .do()
 *
 * // Hybrid search
 * const hybridResults = await client.graphql.get()
 *   .withClassName('Article')
 *   .withFields('title content')
 *   .withHybrid({ query: 'machine learning', alpha: 0.5 })
 *   .withLimit(10)
 *   .do()
 *
 * // Filter with where clause
 * const filtered = await client.graphql.get()
 *   .withClassName('Article')
 *   .withFields('title content')
 *   .withWhere({
 *     path: ['category'],
 *     operator: 'Equal',
 *     valueString: 'tech',
 *   })
 *   .do()
 *
 * // Get by ID
 * const obj = await client.data.getterById()
 *   .withClassName('Article')
 *   .withId('uuid-here')
 *   .do()
 *
 * // Delete object
 * await client.data.deleter()
 *   .withClassName('Article')
 *   .withId('uuid-here')
 *   .do()
 * ```
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
} from '../../search/compat/vector/weaviate/types'

// Client
export { weaviate, WeaviateClient } from '../../search/compat/vector/weaviate/weaviate'
export { weaviate as default } from '../../search/compat/vector/weaviate/weaviate'
