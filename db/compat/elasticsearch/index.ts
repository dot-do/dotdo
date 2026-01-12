/**
 * @dotdo/elasticsearch
 * Elasticsearch SDK compatibility layer
 *
 * Drop-in replacement for @elastic/elasticsearch backed by unified primitives:
 * - InvertedIndex for full-text search with BM25 scoring
 * - HNSW for vector similarity search
 * - TypedColumnStore for filtering and aggregations
 *
 * @see https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/
 *
 * @example
 * ```typescript
 * import { createClient } from '@dotdo/compat/elasticsearch'
 *
 * const client = createClient({
 *   defaultIndex: 'products',
 *   vector: {
 *     dimensions: 384,
 *     metric: 'cosine',
 *   },
 * })
 *
 * // Create index with mappings
 * await client.indices.create({
 *   index: 'products',
 *   mappings: {
 *     properties: {
 *       name: { type: 'text', analyzer: 'standard' },
 *       description: { type: 'text' },
 *       category: { type: 'keyword' },
 *       price: { type: 'float' },
 *       embedding: { type: 'dense_vector', dims: 384 },
 *     },
 *   },
 * })
 *
 * // Index documents
 * await client.index({
 *   index: 'products',
 *   id: 'product-1',
 *   document: {
 *     name: 'MacBook Pro 16',
 *     description: 'Apple laptop with M3 Pro chip',
 *     category: 'electronics',
 *     price: 2499,
 *     embedding: [...], // 384-dimensional vector
 *   },
 * })
 *
 * // Bulk indexing
 * await client.bulk({
 *   operations: [
 *     { index: { _index: 'products', _id: 'product-2' } },
 *     { name: 'ThinkPad X1', description: 'Business laptop', category: 'electronics', price: 1899 },
 *     { index: { _index: 'products', _id: 'product-3' } },
 *     { name: 'Sony Headphones', description: 'Wireless noise cancelling', category: 'audio', price: 399 },
 *   ],
 *   refresh: true,
 * })
 *
 * // Full-text search with BM25
 * const results = await client.search({
 *   index: 'products',
 *   query: {
 *     bool: {
 *       must: [
 *         { match: { description: 'laptop' } },
 *       ],
 *       filter: [
 *         { range: { price: { lte: 2000 } } },
 *       ],
 *     },
 *   },
 *   sort: [{ price: 'asc' }],
 *   highlight: {
 *     fields: { description: {} },
 *   },
 * })
 *
 * // Vector similarity search (KNN)
 * const knnResults = await client.search({
 *   index: 'products',
 *   knn: {
 *     field: 'embedding',
 *     query_vector: queryVector,
 *     k: 10,
 *     num_candidates: 100,
 *   },
 * })
 *
 * // Hybrid search (BM25 + KNN with RRF)
 * const hybridResults = await client.search({
 *   index: 'products',
 *   query: {
 *     match: { description: 'laptop professional' },
 *   },
 *   knn: {
 *     field: 'embedding',
 *     query_vector: queryVector,
 *     k: 50,
 *   },
 *   rank: {
 *     rrf: {
 *       window_size: 100,
 *       rank_constant: 60,
 *     },
 *   },
 * })
 *
 * // Aggregations
 * const aggResults = await client.search({
 *   index: 'products',
 *   size: 0,
 *   aggs: {
 *     by_category: {
 *       terms: { field: 'category' },
 *       aggs: {
 *         avg_price: { avg: { field: 'price' } },
 *         max_price: { max: { field: 'price' } },
 *       },
 *     },
 *     price_histogram: {
 *       histogram: { field: 'price', interval: 500 },
 *     },
 *   },
 * })
 * ```
 */

// Re-export types
export * from './types'

// Re-export client factory
export { createClient } from './client'

// Re-export internal components for advanced usage
export { ElasticsearchIndexer, createIndexer } from './indexer'
export { SearchExecutor, createSearchExecutor } from './search'
export { AggregationExecutor, createAggregationExecutor } from './aggregations'
