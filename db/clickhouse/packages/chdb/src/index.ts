/**
 * @dotdo/chdb - Unified chdb client for Cloudflare Workers
 */

// Client factory - main entry point
export { createClient, createChdb } from './client';
export type { Backend, CreateChdbOptions, WasmOptions, SandboxOptions } from './client';

// Environment detection and backend auto-selection
export {
  detectEnvironment,
  selectBackend,
  checkSandboxAvailable,
  checkWasmAvailable,
  autoSelectBackend,
  getEnvironmentInfo,
} from './detection';
export type { Environment } from './detection';

// Type exports
export type {
  ChdbClient,
  ChdbConfig,
  QueryOptions,
  QueryResult,
  Session,
  OutputFormat,
  ArrowFormatOptions,
} from './types';

// Error exports
export { ChdbError, QueryError, ConnectionError, AuthenticationError } from './types';

// RPC exports
export { createRpcServer, createRpcClient, ERROR_CODES, TimeoutError } from './rpc';
export type { RpcServerConfig, RpcServer, RpcClientConfig } from './rpc';

// Backend exports
export { createSandboxBackend } from './backends';
export type { SandboxConfig } from './backends';

// Arrow streaming exports
export {
  streamArrowBatches,
  arrowToJson,
  arrowToJsonStream,
  extractArrowSchema,
  arrowToTable,
  countArrowRows,
  streamArrowBatchesWithInfo,
  streamArrowSlice,
} from './arrow';
export type { ArrowStreamOptions, ArrowSchemaInfo } from './arrow';

// Query function exports
export {
  query,
  queryRaw,
  queryStream,
  queryStreamRows,
  queryOne,
  queryOneOrThrow,
  querySingle,
} from './query';
export type { QueryExecutor, StreamOptions } from './query';
