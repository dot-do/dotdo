/**
 * EdgeVec Service - WorkerEntrypoint for HNSW Vector Search
 *
 * RED phase stub implementation - all methods throw NotImplemented.
 * This file exists to make tests compile. Actual implementation comes in GREEN phase.
 *
 * EdgeVec is deployed as a separate worker to avoid bundle bloat in the main app.
 * It uses WASM for efficient HNSW operations via Workers RPC (Service Bindings).
 *
 * @see db/edgevec/types.ts for type definitions
 * @see docs/plans/2026-01-09-compat-layer-design.md
 */

import type {
  EdgeVecService,
  IndexConfig,
  Vector,
  SearchOptions,
  CreateIndexResult,
  InsertResult,
  DeleteResult,
  SearchResult,
  SearchError,
  DescribeIndexResult,
  ListIndexesResult,
  DeleteIndexResult,
  PersistResult,
  PersistAllResult,
  LoadResult,
  LoadAllResult,
  BatchSearchResult,
} from './types'

// ============================================================================
// WorkerEntrypoint Base Class
// ============================================================================

/**
 * Base class for WorkerEntrypoint
 *
 * In Cloudflare Workers runtime, this extends the actual WorkerEntrypoint.
 * In Node.js (for testing), this provides a mock implementation.
 */
let WorkerEntrypointBase: new (ctx: unknown, env: unknown) => object

try {
  // Try to import from cloudflare:workers (only available in Workers runtime)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cfWorkers = require('cloudflare:workers')
  WorkerEntrypointBase = cfWorkers.WorkerEntrypoint
} catch {
  // Fallback for Node.js testing environment
  WorkerEntrypointBase = class MockWorkerEntrypoint {
    protected ctx: unknown
    protected env: unknown

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  } as unknown as typeof WorkerEntrypointBase
}

/**
 * EdgeVec Service Implementation
 *
 * Extends WorkerEntrypoint for RPC access via Service Bindings.
 * All public methods are callable via env.EDGEVEC.methodName(args).
 *
 * @example
 * ```typescript
 * // In wrangler.toml:
 * [[services]]
 * binding = "EDGEVEC"
 * service = "edgevec-worker"
 *
 * // In your worker:
 * const result = await env.EDGEVEC.createIndex('my-ns', 'my-index', { dimensions: 128 })
 * ```
 */
export class EdgeVecServiceImpl extends WorkerEntrypointBase implements EdgeVecService {
  // ============================================================================
  // Index Management
  // ============================================================================

  /**
   * Create a new HNSW index
   */
  async createIndex(
    namespace: string,
    name: string,
    config: IndexConfig
  ): Promise<CreateIndexResult> {
    // RED phase: not implemented
    throw new Error('Not implemented: createIndex')
  }

  /**
   * Delete an index and all its vectors
   */
  async deleteIndex(namespace: string, name: string): Promise<DeleteIndexResult> {
    // RED phase: not implemented
    throw new Error('Not implemented: deleteIndex')
  }

  /**
   * Get detailed information about an index
   */
  async describeIndex(namespace: string, name: string): Promise<DescribeIndexResult> {
    // RED phase: not implemented
    throw new Error('Not implemented: describeIndex')
  }

  /**
   * List all indexes in a namespace
   */
  async listIndexes(namespace: string): Promise<ListIndexesResult> {
    // RED phase: not implemented
    throw new Error('Not implemented: listIndexes')
  }

  // ============================================================================
  // Vector Operations
  // ============================================================================

  /**
   * Insert vectors into an index (upsert behavior)
   */
  async insert(namespace: string, indexName: string, vectors: Vector[]): Promise<InsertResult> {
    // RED phase: not implemented
    throw new Error('Not implemented: insert')
  }

  /**
   * Delete vectors by ID
   */
  async delete(namespace: string, indexName: string, ids: string[]): Promise<DeleteResult> {
    // RED phase: not implemented
    throw new Error('Not implemented: delete')
  }

  /**
   * Search for similar vectors
   */
  async search(
    namespace: string,
    indexName: string,
    query: number[] | Float32Array,
    options?: SearchOptions
  ): Promise<SearchResult | SearchError> {
    // RED phase: not implemented
    throw new Error('Not implemented: search')
  }

  /**
   * Batch search with multiple query vectors
   */
  async batchSearch(
    namespace: string,
    indexName: string,
    queries: Array<number[] | Float32Array>,
    options?: SearchOptions
  ): Promise<BatchSearchResult> {
    // RED phase: not implemented
    throw new Error('Not implemented: batchSearch')
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  /**
   * Persist an index to durable storage
   */
  async persist(namespace: string, indexName: string): Promise<PersistResult> {
    // RED phase: not implemented
    throw new Error('Not implemented: persist')
  }

  /**
   * Persist all indexes to durable storage
   */
  async persistAll(): Promise<PersistAllResult> {
    // RED phase: not implemented
    throw new Error('Not implemented: persistAll')
  }

  /**
   * Load an index from durable storage
   */
  async load(namespace: string, indexName: string): Promise<LoadResult> {
    // RED phase: not implemented
    throw new Error('Not implemented: load')
  }

  /**
   * Load all indexes from durable storage
   */
  async loadAll(): Promise<LoadAllResult> {
    // RED phase: not implemented
    throw new Error('Not implemented: loadAll')
  }
}
