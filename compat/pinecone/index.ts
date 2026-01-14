/**
 * @dotdo/pinecone - Pinecone SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for @pinecone-database/pinecone backed by
 * dotdo's edgevec HNSW vector search primitives.
 *
 * This implementation matches the Pinecone JavaScript SDK API.
 *
 * @example
 * ```typescript
 * import { Pinecone } from '@dotdo/pinecone'
 *
 * const client = new Pinecone({ apiKey: 'your-api-key' })
 *
 * // Create an index
 * await client.createIndex({
 *   name: 'my-index',
 *   dimension: 768,
 *   metric: 'cosine',
 * })
 *
 * // Get an index
 * const index = client.index('my-index')
 *
 * // Upsert vectors
 * await index.upsert([
 *   { id: 'vec1', values: [0.1, 0.2, ...], metadata: { genre: 'comedy' } },
 *   { id: 'vec2', values: [0.3, 0.4, ...], metadata: { genre: 'drama' } },
 * ])
 *
 * // Query for similar vectors
 * const results = await index.query({
 *   vector: [0.1, 0.2, ...],
 *   topK: 10,
 *   filter: { genre: 'comedy' },
 *   includeMetadata: true,
 * })
 *
 * // Fetch specific vectors
 * const fetched = await index.fetch(['vec1', 'vec2'])
 *
 * // Update a vector
 * await index.update({
 *   id: 'vec1',
 *   metadata: { genre: 'action' },
 * })
 *
 * // Delete vectors
 * await index.delete(['vec1'])
 *
 * // Delete by filter
 * await index.deleteMany({ genre: 'drama' })
 *
 * // Use namespaces
 * const ns = index.namespace('my-namespace')
 * await ns.upsert([...])
 *
 * // Get index stats
 * const stats = await index.describeIndexStats()
 * ```
 *
 * @see https://docs.pinecone.io/reference/api/introduction
 */

// Re-export everything from pinecone implementation
export { Pinecone, clearAllIndices, default } from './pinecone'

// Re-export all types and errors
export * from './types'
