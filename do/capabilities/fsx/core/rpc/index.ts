/**
 * RPC Service Module for FSx
 *
 * This module provides an RPC interface for running heavy filesystem operations
 * in a separate Worker via service binding. This keeps Durable Object bundles
 * small while enabling efficient batch and streaming operations.
 *
 * @module core/rpc
 *
 * @example
 * ```typescript
 * // Client usage in a Durable Object
 * import { FsServiceClient } from 'fsx/core/rpc'
 *
 * const client = new FsServiceClient(env.FSX_SERVICE)
 * const result = await client.batchWrite([
 *   { path: '/a.txt', content: 'Hello' },
 *   { path: '/b.txt', content: 'World' }
 * ])
 * ```
 *
 * @example
 * ```typescript
 * // Service handler in a dedicated Worker
 * import { FsServiceHandler } from 'fsx/core/rpc'
 * import { FsModule } from 'fsx/do'
 *
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const fs = new FsModule({ sql: env.FSX_DB.storage.sql })
 *     const handler = new FsServiceHandler(fs)
 *     return handler.handleRequest(request)
 *   }
 * }
 * ```
 */

// Client for calling the FSx service from DOs
export { FsServiceClient } from './fs-service.js'

// Handler for implementing the FSx service in a Worker
export { FsServiceHandler } from './fs-service.js'

// Type exports
export type {
  // Progress and callbacks
  ProgressEvent,
  ProgressCallback,

  // Batch operations
  BatchFileItem,
  BatchOperationResult,
  BatchResult,
  BatchReadOptions,
  BatchWriteOptions,
  BatchDeleteOptions,

  // Streaming operations
  StreamChunk,
  StreamReadOptions,
  StreamWriteOptions,

  // RPC protocol
  RpcRequest,
  RpcResponse,
  FsServiceMethods,

  // Service interface
  FsServiceFs,
} from './fs-service.js'

// Constants
export { DEFAULT_CHUNK_SIZE, DEFAULT_PARALLEL_LIMIT } from './fs-service.js'
