/**
 * Elasticsearch Client
 *
 * ES-compatible client backed by unified primitives.
 * Provides drop-in replacement for @elastic/elasticsearch client.
 *
 * @module db/compat/elasticsearch/client
 */

import {
  ElasticsearchIndexer,
  createIndexer,
  type IndexConfig,
} from './indexer'
import {
  SearchExecutor,
  createSearchExecutor,
  type SearchExecutorOptions,
} from './search'
import {
  AggregationExecutor,
  createAggregationExecutor,
} from './aggregations'
import type {
  Document,
  ElasticsearchClient,
  ElasticsearchClientOptions,
  IndexRequest,
  IndexResponse,
  GetRequest,
  GetResponse,
  DeleteRequest,
  DeleteResponse,
  UpdateRequest,
  UpdateResponse,
  BulkRequest,
  BulkResponse,
  BulkResponseItem,
  SearchRequest,
  SearchResponse,
  CreateIndexRequest,
  CreateIndexResponse,
  DeleteIndexRequest,
  DeleteIndexResponse,
  GetIndexRequest,
  GetIndexResponse,
  IndexExistsRequest,
  IndexMappings,
  IndexSettings,
  ClusterHealthResponse,
  ClusterStatsResponse,
  InfoResponse,
} from './types'
import { NotFoundError, ResponseError } from './types'

// ============================================================================
// CLIENT IMPLEMENTATION
// ============================================================================

/**
 * Elasticsearch-compatible client
 *
 * Provides ES API compatibility backed by unified primitives:
 * - InvertedIndex for full-text search with BM25
 * - HNSW for vector similarity search
 * - TypedColumnStore for filtering and aggregations
 */
class ElasticsearchClientImpl implements ElasticsearchClient {
  private options: ElasticsearchClientOptions
  private indexes: Map<string, ElasticsearchIndexer> = new Map()
  private searchExecutors: Map<string, SearchExecutor> = new Map()
  private aggregationExecutors: Map<string, AggregationExecutor> = new Map()
  private indexSettings: Map<string, IndexSettings> = new Map()
  private indexCreatedAt: Map<string, number> = new Map()

  /** Index management operations */
  readonly indices: ElasticsearchClient['indices']

  /** Cluster operations */
  readonly cluster: ElasticsearchClient['cluster']

  constructor(options: ElasticsearchClientOptions = {}) {
    this.options = options

    // Initialize indices namespace
    this.indices = {
      create: this.createIndex.bind(this),
      delete: this.deleteIndex.bind(this),
      get: this.getIndex.bind(this),
      exists: this.indexExists.bind(this),
      refresh: this.refreshIndex.bind(this),
      putMapping: this.putMapping.bind(this),
      getMapping: this.getMapping.bind(this),
      putSettings: this.putSettings.bind(this),
      getSettings: this.getSettings.bind(this),
    }

    // Initialize cluster namespace
    this.cluster = {
      health: this.clusterHealth.bind(this),
      stats: this.clusterStats.bind(this),
    }
  }

  // ==========================================================================
  // DOCUMENT OPERATIONS
  // ==========================================================================

  async index<T extends Document = Document>(
    request: IndexRequest<T>
  ): Promise<IndexResponse> {
    const { index, id, document, refresh } = request

    // Get or create indexer
    const indexer = this.getOrCreateIndexer(index)
    const searchExecutor = this.getOrCreateSearchExecutor(index)

    // Generate ID if not provided
    const docId = id || this.generateId()

    // Index the document
    const result = indexer.index(docId, document)

    // Index vector if present and configured
    if (this.options.vector && document.embedding) {
      const embedding = document.embedding as number[]
      searchExecutor.indexVector(docId, embedding)
    }

    return {
      _index: index,
      _id: docId,
      _version: result._version,
      result: result.result,
      _shards: { total: 1, successful: 1, failed: 0 },
      _seq_no: result._seq_no,
      _primary_term: result._primary_term,
    }
  }

  async get<T extends Document = Document>(
    request: GetRequest
  ): Promise<GetResponse<T>> {
    const { index, id } = request

    const indexer = this.indexes.get(index)
    if (!indexer) {
      return {
        _index: index,
        _id: id,
        found: false,
      }
    }

    const doc = indexer.get(id)
    if (!doc) {
      return {
        _index: index,
        _id: id,
        found: false,
      }
    }

    return {
      _index: index,
      _id: id,
      _version: doc._version,
      _seq_no: doc._seq_no,
      _primary_term: doc._primary_term,
      found: true,
      _source: doc._source as T,
    }
  }

  async delete(request: DeleteRequest): Promise<DeleteResponse> {
    const { index, id } = request

    const indexer = this.indexes.get(index)
    if (!indexer) {
      return {
        _index: index,
        _id: id,
        _version: 0,
        result: 'not_found',
        _shards: { total: 1, successful: 1, failed: 0 },
        _seq_no: 0,
        _primary_term: 1,
      }
    }

    const result = indexer.delete(id)

    // Remove vector if present
    const searchExecutor = this.searchExecutors.get(index)
    if (searchExecutor) {
      searchExecutor.deleteVector(id)
    }

    return {
      _index: index,
      _id: id,
      _version: result._version,
      result: result.result,
      _shards: { total: 1, successful: 1, failed: 0 },
      _seq_no: result._seq_no,
      _primary_term: result._primary_term,
    }
  }

  async update<T extends Document = Document>(
    request: UpdateRequest<T>
  ): Promise<UpdateResponse<T>> {
    const { index, id, doc, script, upsert, doc_as_upsert } = request

    const indexer = this.indexes.get(index)
    if (!indexer) {
      if (upsert || doc_as_upsert) {
        // Create new document
        const newDoc = upsert || (doc as T)
        const result = await this.index({ index, id, document: newDoc })
        return {
          _index: index,
          _id: id,
          _version: result._version,
          result: 'created',
          _shards: result._shards,
          _seq_no: result._seq_no,
          _primary_term: result._primary_term,
        }
      }

      return {
        _index: index,
        _id: id,
        _version: 0,
        result: 'noop',
        _shards: { total: 1, successful: 1, failed: 0 },
        _seq_no: 0,
        _primary_term: 1,
      }
    }

    const existing = indexer.get(id)
    if (!existing) {
      if (upsert || doc_as_upsert) {
        const newDoc = upsert || (doc as T)
        const result = await this.index({ index, id, document: newDoc })
        return {
          _index: index,
          _id: id,
          _version: result._version,
          result: 'created',
          _shards: result._shards,
          _seq_no: result._seq_no,
          _primary_term: result._primary_term,
        }
      }

      return {
        _index: index,
        _id: id,
        _version: 0,
        result: 'noop',
        _shards: { total: 1, successful: 1, failed: 0 },
        _seq_no: 0,
        _primary_term: 1,
      }
    }

    // Apply update
    if (doc) {
      const result = indexer.update(id, doc)

      // Update vector if embedding changed
      const searchExecutor = this.searchExecutors.get(index)
      if (searchExecutor && (doc as Record<string, unknown>).embedding) {
        searchExecutor.indexVector(id, (doc as Record<string, unknown>).embedding as number[])
      }

      return {
        _index: index,
        _id: id,
        _version: result._version,
        result: result.result,
        _shards: { total: 1, successful: 1, failed: 0 },
        _seq_no: result._seq_no,
        _primary_term: result._primary_term,
      }
    }

    return {
      _index: index,
      _id: id,
      _version: existing._version,
      result: 'noop',
      _shards: { total: 1, successful: 1, failed: 0 },
      _seq_no: existing._seq_no,
      _primary_term: existing._primary_term,
    }
  }

  async bulk<T extends Document = Document>(
    request: BulkRequest<T>
  ): Promise<BulkResponse> {
    const startTime = Date.now()
    const items: BulkResponse['items'] = []
    let hasErrors = false

    const { operations, index: defaultIndex, refresh } = request

    let i = 0
    while (i < operations.length) {
      const op = operations[i]

      // Check operation type
      if (op && 'index' in op) {
        const action = (op as { index: { _index?: string; _id?: string } }).index
        const indexName = action._index || defaultIndex
        if (!indexName) {
          hasErrors = true
          items.push({
            index: {
              _index: '',
              _id: action._id || '',
              status: 400,
              error: { type: 'illegal_argument_exception', reason: 'index is required' },
            },
          })
          i++
          continue
        }

        // Next item should be the document
        i++
        const doc = operations[i] as T
        if (!doc || typeof doc !== 'object') {
          hasErrors = true
          items.push({
            index: {
              _index: indexName,
              _id: action._id || '',
              status: 400,
              error: { type: 'illegal_argument_exception', reason: 'document is required' },
            },
          })
          i++
          continue
        }

        try {
          const result = await this.index({
            index: indexName,
            id: action._id,
            document: doc,
          })

          items.push({
            index: {
              _index: result._index,
              _id: result._id,
              _version: result._version,
              result: result.result,
              status: result.result === 'created' ? 201 : 200,
              _seq_no: result._seq_no,
              _primary_term: result._primary_term,
              _shards: result._shards,
            },
          })
        } catch (error) {
          hasErrors = true
          items.push({
            index: {
              _index: indexName,
              _id: action._id || '',
              status: 500,
              error: {
                type: 'mapper_exception',
                reason: error instanceof Error ? error.message : 'Unknown error',
              },
            },
          })
        }
      } else if (op && 'create' in op) {
        const action = (op as { create: { _index?: string; _id?: string } }).create
        const indexName = action._index || defaultIndex
        if (!indexName) {
          hasErrors = true
          items.push({
            create: {
              _index: '',
              _id: action._id || '',
              status: 400,
              error: { type: 'illegal_argument_exception', reason: 'index is required' },
            },
          })
          i++
          continue
        }

        // Check if document exists
        const indexer = this.indexes.get(indexName)
        if (indexer && action._id && indexer.get(action._id)) {
          hasErrors = true
          items.push({
            create: {
              _index: indexName,
              _id: action._id,
              status: 409,
              error: { type: 'version_conflict_engine_exception', reason: 'Document already exists' },
            },
          })
          i++
          // Skip document
          i++
          continue
        }

        // Next item should be the document
        i++
        const doc = operations[i] as T

        try {
          const result = await this.index({
            index: indexName,
            id: action._id,
            document: doc,
          })

          items.push({
            create: {
              _index: result._index,
              _id: result._id,
              _version: result._version,
              result: result.result,
              status: 201,
              _seq_no: result._seq_no,
              _primary_term: result._primary_term,
              _shards: result._shards,
            },
          })
        } catch (error) {
          hasErrors = true
          items.push({
            create: {
              _index: indexName,
              _id: action._id || '',
              status: 500,
              error: {
                type: 'mapper_exception',
                reason: error instanceof Error ? error.message : 'Unknown error',
              },
            },
          })
        }
      } else if (op && 'update' in op) {
        const action = (op as { update: { _index?: string; _id?: string } }).update
        const indexName = action._index || defaultIndex
        if (!indexName) {
          hasErrors = true
          items.push({
            update: {
              _index: '',
              _id: action._id || '',
              status: 400,
              error: { type: 'illegal_argument_exception', reason: 'index is required' },
            },
          })
          i++
          continue
        }

        // Next item should be the update spec
        i++
        const updateSpec = operations[i] as { doc?: Partial<T> }

        try {
          const result = await this.update({
            index: indexName,
            id: action._id!,
            doc: updateSpec.doc,
          })

          items.push({
            update: {
              _index: result._index,
              _id: result._id,
              _version: result._version,
              result: result.result,
              status: 200,
              _seq_no: result._seq_no,
              _primary_term: result._primary_term,
              _shards: result._shards,
            },
          })
        } catch (error) {
          hasErrors = true
          items.push({
            update: {
              _index: indexName,
              _id: action._id || '',
              status: 500,
              error: {
                type: 'mapper_exception',
                reason: error instanceof Error ? error.message : 'Unknown error',
              },
            },
          })
        }
      } else if (op && 'delete' in op) {
        const action = (op as { delete: { _index?: string; _id?: string } }).delete
        const indexName = action._index || defaultIndex
        if (!indexName || !action._id) {
          hasErrors = true
          items.push({
            delete: {
              _index: indexName || '',
              _id: action._id || '',
              status: 400,
              error: { type: 'illegal_argument_exception', reason: 'index and id are required' },
            },
          })
          i++
          continue
        }

        try {
          const result = await this.delete({
            index: indexName,
            id: action._id,
          })

          items.push({
            delete: {
              _index: result._index,
              _id: result._id,
              _version: result._version,
              result: result.result as 'deleted' | 'created' | 'updated' | 'noop',
              status: result.result === 'deleted' ? 200 : 404,
              _seq_no: result._seq_no,
              _primary_term: result._primary_term,
              _shards: result._shards,
            },
          })
        } catch (error) {
          hasErrors = true
          items.push({
            delete: {
              _index: indexName,
              _id: action._id,
              status: 500,
              error: {
                type: 'mapper_exception',
                reason: error instanceof Error ? error.message : 'Unknown error',
              },
            },
          })
        }
      }

      i++
    }

    return {
      took: Date.now() - startTime,
      errors: hasErrors,
      items,
    }
  }

  async search<T extends Document = Document>(
    request: { index: string | string[] } & SearchRequest<T>
  ): Promise<SearchResponse<T>> {
    const indexNames = Array.isArray(request.index) ? request.index : [request.index]

    // For now, only support single index
    const indexName = indexNames[0]!

    const indexer = this.indexes.get(indexName)
    if (!indexer) {
      return {
        took: 0,
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: {
          total: { value: 0, relation: 'eq' },
          max_score: null,
          hits: [],
        },
      }
    }

    const searchExecutor = this.getOrCreateSearchExecutor(indexName)
    const aggregationExecutor = this.getOrCreateAggregationExecutor(indexName)

    // Execute search
    const response = searchExecutor.search<T>(request)

    // Execute aggregations
    if (request.aggs || request.aggregations) {
      const aggs = request.aggs || request.aggregations
      if (aggs) {
        // Get all matching documents for aggregation (not just paginated results)
        // We need to run the search again without pagination to get all doc IDs
        let docs
        if (request.query) {
          // Execute search without pagination to get all matching doc IDs
          const allMatchingResponse = searchExecutor.search<T>({
            ...request,
            from: 0,
            size: 10000, // Get all matching docs for aggregations
            aggs: undefined,
            aggregations: undefined,
          })
          docs = allMatchingResponse.hits.hits
            .map((h) => indexer.get(h._id))
            .filter((d): d is NonNullable<typeof d> => d !== null)
        } else {
          docs = indexer.getAllDocuments()
        }

        response.aggregations = aggregationExecutor.execute(aggs, docs)
      }
    }

    return response
  }

  // ==========================================================================
  // INDEX MANAGEMENT
  // ==========================================================================

  private async createIndex(
    request: CreateIndexRequest
  ): Promise<CreateIndexResponse> {
    const { index, mappings, settings } = request

    if (this.indexes.has(index)) {
      throw new ResponseError(400, { error: 'Index already exists' }, `Index ${index} already exists`)
    }

    const indexer = createIndexer({
      name: index,
      mappings: mappings || { properties: {} },
    })

    this.indexes.set(index, indexer)
    this.indexSettings.set(index, settings || {})
    this.indexCreatedAt.set(index, Date.now())

    // Create search executor with vector support if configured
    const searchOptions: SearchExecutorOptions = {}
    if (this.options.vector) {
      searchOptions.vector = this.options.vector as SearchExecutorOptions['vector']
    } else if (mappings?.properties) {
      // Check for dense_vector field
      for (const [_, fieldMapping] of Object.entries(mappings.properties)) {
        if (fieldMapping.type === 'dense_vector' && fieldMapping.dims) {
          searchOptions.vector = {
            dimensions: fieldMapping.dims,
            metric: 'cosine',
          }
          break
        }
      }
    }

    const searchExecutor = createSearchExecutor(indexer, searchOptions)
    this.searchExecutors.set(index, searchExecutor)

    const aggregationExecutor = createAggregationExecutor(indexer, searchExecutor)
    this.aggregationExecutors.set(index, aggregationExecutor)

    return {
      acknowledged: true,
      shards_acknowledged: true,
      index,
    }
  }

  private async deleteIndex(
    request: DeleteIndexRequest
  ): Promise<DeleteIndexResponse> {
    const indexNames = Array.isArray(request.index) ? request.index : [request.index]

    for (const index of indexNames) {
      this.indexes.delete(index)
      this.searchExecutors.delete(index)
      this.aggregationExecutors.delete(index)
      this.indexSettings.delete(index)
      this.indexCreatedAt.delete(index)
    }

    return { acknowledged: true }
  }

  private async getIndex(request: GetIndexRequest): Promise<GetIndexResponse> {
    const indexNames = Array.isArray(request.index) ? request.index : [request.index]
    const result: GetIndexResponse = {}

    for (const index of indexNames) {
      const indexer = this.indexes.get(index)
      if (indexer) {
        result[index] = {
          aliases: {},
          mappings: indexer.getMappings(),
          settings: { index: this.indexSettings.get(index) || {} },
        }
      }
    }

    return result
  }

  private async indexExists(request: IndexExistsRequest): Promise<boolean> {
    const indexNames = Array.isArray(request.index) ? request.index : [request.index]

    for (const index of indexNames) {
      if (!this.indexes.has(index)) {
        return false
      }
    }

    return true
  }

  private async refreshIndex(
    request: { index: string | string[] }
  ): Promise<{ _shards: { total: number; successful: number; failed: number } }> {
    // In-memory implementation - refresh is a no-op
    return {
      _shards: { total: 1, successful: 1, failed: 0 },
    }
  }

  private async putMapping(
    request: { index: string; body: IndexMappings }
  ): Promise<{ acknowledged: boolean }> {
    const indexer = this.indexes.get(request.index)
    if (!indexer) {
      throw new NotFoundError({ error: 'Index not found' }, `Index ${request.index} not found`)
    }

    indexer.updateMappings(request.body)
    return { acknowledged: true }
  }

  private async getMapping(
    request: { index: string | string[] }
  ): Promise<Record<string, { mappings: IndexMappings }>> {
    const indexNames = Array.isArray(request.index) ? request.index : [request.index]
    const result: Record<string, { mappings: IndexMappings }> = {}

    for (const index of indexNames) {
      const indexer = this.indexes.get(index)
      if (indexer) {
        result[index] = { mappings: indexer.getMappings() }
      }
    }

    return result
  }

  private async putSettings(
    request: { index: string; body: IndexSettings }
  ): Promise<{ acknowledged: boolean }> {
    const existing = this.indexSettings.get(request.index) || {}
    this.indexSettings.set(request.index, { ...existing, ...request.body })
    return { acknowledged: true }
  }

  private async getSettings(
    request: { index: string | string[] }
  ): Promise<Record<string, { settings: { index: IndexSettings } }>> {
    const indexNames = Array.isArray(request.index) ? request.index : [request.index]
    const result: Record<string, { settings: { index: IndexSettings } }> = {}

    for (const index of indexNames) {
      const settings = this.indexSettings.get(index)
      if (settings) {
        result[index] = { settings: { index: settings } }
      }
    }

    return result
  }

  // ==========================================================================
  // CLUSTER OPERATIONS
  // ==========================================================================

  private async clusterHealth(
    request?: { index?: string | string[]; level?: 'cluster' | 'indices' | 'shards' }
  ): Promise<ClusterHealthResponse> {
    return {
      cluster_name: 'dotdo-elasticsearch',
      status: 'green',
      timed_out: false,
      number_of_nodes: 1,
      number_of_data_nodes: 1,
      active_primary_shards: this.indexes.size,
      active_shards: this.indexes.size,
      relocating_shards: 0,
      initializing_shards: 0,
      unassigned_shards: 0,
      delayed_unassigned_shards: 0,
      number_of_pending_tasks: 0,
      number_of_in_flight_fetch: 0,
      task_max_waiting_in_queue_millis: 0,
      active_shards_percent_as_number: 100,
    }
  }

  private async clusterStats(): Promise<ClusterStatsResponse> {
    let totalDocs = 0
    let totalSize = 0

    for (const indexer of this.indexes.values()) {
      totalDocs += indexer.getDocCount()
      // Estimate size based on doc count
      totalSize += indexer.getDocCount() * 1000
    }

    return {
      cluster_name: 'dotdo-elasticsearch',
      cluster_uuid: 'dotdo-uuid',
      timestamp: Date.now(),
      status: 'green',
      indices: {
        count: this.indexes.size,
        docs: { count: totalDocs, deleted: 0 },
        store: { size_in_bytes: totalSize },
      },
      nodes: {
        count: { total: 1 },
      },
    }
  }

  // ==========================================================================
  // CLIENT UTILITIES
  // ==========================================================================

  async ping(): Promise<boolean> {
    return true
  }

  async info(): Promise<InfoResponse> {
    return {
      name: 'dotdo-node',
      cluster_name: 'dotdo-elasticsearch',
      cluster_uuid: 'dotdo-uuid',
      version: {
        number: '8.0.0',
        build_flavor: 'default',
        build_type: 'dotdo',
        build_hash: 'dotdo',
        build_date: new Date().toISOString(),
        build_snapshot: false,
        lucene_version: '9.0.0',
        minimum_wire_compatibility_version: '7.17.0',
        minimum_index_compatibility_version: '7.0.0',
      },
      tagline: 'You Know, for Search (powered by dotdo)',
    }
  }

  async close(): Promise<void> {
    // Clean up resources
    this.indexes.clear()
    this.searchExecutors.clear()
    this.aggregationExecutors.clear()
    this.indexSettings.clear()
    this.indexCreatedAt.clear()
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private getOrCreateIndexer(indexName: string): ElasticsearchIndexer {
    let indexer = this.indexes.get(indexName)
    if (!indexer) {
      indexer = createIndexer({
        name: indexName,
        mappings: { properties: {} },
      })
      this.indexes.set(indexName, indexer)
      this.indexCreatedAt.set(indexName, Date.now())
    }
    return indexer
  }

  private getOrCreateSearchExecutor(indexName: string): SearchExecutor {
    let executor = this.searchExecutors.get(indexName)
    if (!executor) {
      const indexer = this.getOrCreateIndexer(indexName)
      const options: SearchExecutorOptions = {}

      if (this.options.vector) {
        options.vector = this.options.vector as SearchExecutorOptions['vector']
      }

      executor = createSearchExecutor(indexer, options)
      this.searchExecutors.set(indexName, executor)
    }
    return executor
  }

  private getOrCreateAggregationExecutor(indexName: string): AggregationExecutor {
    let executor = this.aggregationExecutors.get(indexName)
    if (!executor) {
      const indexer = this.getOrCreateIndexer(indexName)
      const searchExecutor = this.getOrCreateSearchExecutor(indexName)
      executor = createAggregationExecutor(indexer, searchExecutor)
      this.aggregationExecutors.set(indexName, executor)
    }
    return executor
  }

  private generateId(): string {
    // Generate a unique ID similar to ES
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).slice(2, 10)
    return `${timestamp}${random}`
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new Elasticsearch client
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
 * // Index documents
 * await client.index({
 *   index: 'products',
 *   id: 'product-1',
 *   document: {
 *     name: 'MacBook Pro',
 *     description: 'Apple laptop',
 *     price: 2499,
 *   },
 * })
 *
 * // Search
 * const results = await client.search({
 *   index: 'products',
 *   query: {
 *     match: { description: 'laptop' },
 *   },
 *   aggs: {
 *     avg_price: { avg: { field: 'price' } },
 *   },
 * })
 * ```
 */
export function createClient(options: ElasticsearchClientOptions = {}): ElasticsearchClient {
  return new ElasticsearchClientImpl(options)
}
