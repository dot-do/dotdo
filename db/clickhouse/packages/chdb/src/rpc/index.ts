/**
 * capnweb RPC module for @dotdo/chdb
 *
 * Provides client and server implementations for remote chdb access
 * using the capnweb protocol over HTTP.
 *
 * @example Client usage
 * ```typescript
 * import { createRpcClient } from '@dotdo/chdb/rpc';
 *
 * const client = await createRpcClient({
 *   url: 'https://chdb.example.com/rpc',
 *   auth: { token: 'your-token' }
 * });
 *
 * const result = await client.query('SELECT 1 + 1 as sum');
 * ```
 *
 * @example Server usage
 * ```typescript
 * import { createRpcServer } from '@dotdo/chdb/rpc';
 * import { createClient } from '@dotdo/chdb';
 *
 * const chdb = await createClient();
 * const server = createRpcServer(chdb);
 *
 * export default {
 *   async fetch(request: Request): Promise<Response> {
 *     return server.handleRequest(request);
 *   }
 * };
 * ```
 */

// Server exports
export { createRpcServer, ERROR_CODES } from './server';
export type { RpcServerConfig, RpcServer } from './server';

// Client exports
export { createRpcClient, TimeoutError } from './client';
export type { RpcClientConfig } from './client';

// Re-export types from main module for convenience
export type {
  ChdbClient,
  QueryOptions,
  QueryResult,
  Session,
} from '../types';

export {
  ChdbError,
  QueryError,
  ConnectionError,
  AuthenticationError,
} from '../types';
