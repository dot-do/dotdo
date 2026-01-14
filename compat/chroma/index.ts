/**
 * @dotdo/chroma - Chroma SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for chromadb backed by DO SQLite.
 * This implementation matches the Chroma JavaScript API.
 *
 * @example
 * ```typescript
 * import { ChromaClient } from '@dotdo/chroma'
 *
 * const client = new ChromaClient({ path: 'http://localhost:8000' })
 *
 * // Create a collection
 * const collection = await client.createCollection({
 *   name: 'documents',
 *   metadata: { 'hnsw:space': 'cosine' },
 * })
 *
 * // Or get existing collection
 * const existingCollection = await client.getCollection({ name: 'documents' })
 *
 * // Get or create collection
 * const col = await client.getOrCreateCollection({ name: 'documents' })
 *
 * // Add documents with embeddings
 * await collection.add({
 *   ids: ['doc1', 'doc2', 'doc3'],
 *   embeddings: [
 *     [0.1, 0.2, 0.3, ...],
 *     [0.4, 0.5, 0.6, ...],
 *     [0.7, 0.8, 0.9, ...],
 *   ],
 *   metadatas: [
 *     { source: 'wiki', category: 'science' },
 *     { source: 'blog', category: 'tech' },
 *     { source: 'paper', category: 'science' },
 *   ],
 *   documents: [
 *     'The mitochondria is the powerhouse of the cell',
 *     'JavaScript is a programming language',
 *     'Neural networks are inspired by the brain',
 *   ],
 * })
 *
 * // Query by embedding
 * const results = await collection.query({
 *   queryEmbeddings: [[0.1, 0.2, 0.3, ...]],
 *   nResults: 5,
 *   where: { category: 'science' },
 *   whereDocument: { '$contains': 'cell' },
 *   include: ['documents', 'metadatas', 'distances'],
 * })
 *
 * // Get documents by ID
 * const docs = await collection.get({
 *   ids: ['doc1', 'doc2'],
 *   include: ['documents', 'metadatas', 'embeddings'],
 * })
 *
 * // Get with filters
 * const filtered = await collection.get({
 *   where: { category: { '$eq': 'science' } },
 *   whereDocument: { '$contains': 'neural' },
 * })
 *
 * // Update documents
 * await collection.update({
 *   ids: ['doc1'],
 *   metadatas: [{ source: 'wiki', category: 'biology' }],
 * })
 *
 * // Upsert documents (insert or update)
 * await collection.upsert({
 *   ids: ['doc4'],
 *   embeddings: [[0.2, 0.3, 0.4, ...]],
 *   metadatas: [{ source: 'new' }],
 *   documents: ['New document content'],
 * })
 *
 * // Delete documents
 * await collection.delete({
 *   ids: ['doc1', 'doc2'],
 * })
 *
 * // Delete by filter
 * await collection.delete({
 *   where: { category: 'tech' },
 * })
 *
 * // Peek at collection (get first n items)
 * const peek = await collection.peek({ limit: 10 })
 *
 * // Count documents
 * const count = await collection.count()
 *
 * // Modify collection metadata
 * await collection.modify({ metadata: { 'hnsw:space': 'l2' } })
 *
 * // List all collections
 * const collections = await client.listCollections()
 *
 * // Delete collection
 * await client.deleteCollection({ name: 'documents' })
 *
 * // Server heartbeat
 * const heartbeat = await client.heartbeat()
 *
 * // Server version
 * const version = await client.version()
 * ```
 *
 * @see https://docs.trychroma.com/reference/js-client
 */

// Main client export
export { ChromaClient, _resetStorage, _getStorageStats } from '../../search/compat/vector/chroma/chroma'

// Error exports
export {
  ChromaError,
  ChromaConfigurationError,
  ChromaConnectionError,
  ChromaNotFoundError,
  ChromaConflictError,
  ChromaValidationError,
  ChromaRequestError,
} from '../../search/compat/vector/chroma/types'

// Type exports
export type {
  // Configuration
  ChromaClientParams,
  AuthOptions,

  // Metadata types
  MetadataValue,
  Metadata,

  // Embedding types
  Embedding,
  Embeddings,

  // Filter types
  WhereOperators,
  WhereLogicalOperators,
  Where,
  WhereDocumentOperators,
  WhereDocumentLogicalOperators,
  WhereDocument,

  // Include types
  IncludeEnum,

  // Collection types
  CollectionModel,
  CreateCollectionParams,
  GetCollectionParams,
  DeleteCollectionParams,
  ModifyCollectionParams,

  // Document operation types
  AddParams,
  UpdateParams,
  UpsertParams,
  QueryParams,
  QueryResponse,
  GetParams,
  GetResponse,
  DeleteParams,
  PeekParams,

  // Function types
  EmbeddingFunction,

  // Interface types
  Collection,
  ChromaClientInterface,
} from '../../search/compat/vector/chroma/types'

// Default export for convenience
export { ChromaClient as default } from '../../search/compat/vector/chroma/chroma'
