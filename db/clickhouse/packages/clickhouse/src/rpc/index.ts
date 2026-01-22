/**
 * capnweb RPC module for @dotdo/clickhouse
 *
 * Provides client and server implementations for remote ClickHouse access
 * using the capnweb protocol over HTTP.
 *
 * @example Client usage
 * ```typescript
 * import { createRpcClient } from '@dotdo/clickhouse/rpc';
 *
 * const client = await createRpcClient({
 *   url: 'https://clickhouse.example.com/rpc',
 *   auth: { token: 'your-token' }
 * });
 *
 * const result = await client.query('SELECT 1 + 1 as sum');
 * console.log(result.data); // [{ sum: 2 }]
 *
 * // Stream large results
 * for await (const batch of client.queryStream('SELECT * FROM large_table')) {
 *   processBatch(batch);
 * }
 *
 * // Insert data
 * await client.insert('users', [
 *   { id: 1, name: 'Alice' },
 *   { id: 2, name: 'Bob' }
 * ]);
 *
 * // Health check
 * const isHealthy = await client.ping();
 * ```
 *
 * @example Server usage
 * ```typescript
 * import { createRpcServer } from '@dotdo/clickhouse/rpc';
 * import { createClient } from '@dotdo/clickhouse';
 *
 * const clickhouse = await createClient({
 *   backend: 'clickhouse',
 *   clickhouse: { host: 'http://localhost:8123' }
 * });
 *
 * const server = createRpcServer(clickhouse, {
 *   auth: {
 *     validateToken: async (token) => token === process.env.API_TOKEN
 *   }
 * });
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
export { createRpcClient } from './client';
export type { RpcClientConfig } from './client';

// Re-export types from main module for convenience
export type {
  ClickHouseClient,
  QueryOptions,
  QueryResult,
  InsertOptions,
} from '../types';

export {
  ClickHouseError,
  QueryError,
  ConnectionError,
  AuthenticationError,
  TimeoutError,
} from '../types';
