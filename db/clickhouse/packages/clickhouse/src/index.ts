/**
 * @dotdo/clickhouse
 *
 * Full ClickHouse deployment with S3-backed scale-out architecture,
 * plus unified client supporting WASM, Sandbox, and Container backends.
 */

// Unified Client API
export {
  createClient,
  checkBackendAvailability,
  type Backend,
  type CreateClientOptions,
} from './client';

// Core Types
export {
  // Interfaces
  type ClickHouseClient,
  type ClickHouseConfig,
  type QueryOptions,
  type InsertOptions,
  type QueryResult,
  type QueryResultWithMeta,
  type QueryStatistics,
  type QueryProgress,
  type ColumnMeta,
  type ColumnSchema,
  type CreateTableOptions,
  type DataFormat,
  // Error classes
  ClickHouseError,
  QueryError,
  ConnectionError,
  AuthenticationError,
  TimeoutError,
  BackendNotAvailableError,
} from './types';

// HTTP Proxy exports
export {
  createHttpProxy,
  createWorkerHandler,
  type ProxyConfig,
  type HttpProxy,
  type WorkerEnv,
} from './proxy';

// R2 Storage exports
export {
  // Presigned URLs
  R2PresignedUrls,
  createR2Client,
  type R2Config,
  type ReadUrlOptions,
  type WriteUrlOptions,
  type MultipartUploadOptions,
  type MultipartUploadInit,
  // CORS Configuration
  configureR2Cors,
  createR2CorsClient,
  getR2Endpoint,
  generateCorsXml,
  createProductionCorsConfig,
  defaultWasmCorsConfig,
  devCorsConfig,
  type CorsConfig,
} from './r2';

// RPC exports
export {
  createRpcServer,
  createRpcClient,
  ERROR_CODES,
  type RpcServerConfig,
  type RpcServer,
  type RpcClientConfig,
} from './rpc';

// Backend Abstractions
export {
  // Base types
  type Backend as BackendInterface,
  BaseBackend,
  type BackendName,
  type BackendCapabilities,
  type QueryOptions as BackendQueryOptions,
  DEFAULT_CAPABILITIES,
  FULL_CAPABILITIES,
  WASM_CAPABILITIES,
  SANDBOX_CAPABILITIES,
  // WASM backend
  WasmBackend,
  type WasmBackendConfig,
  createWasmBackend,
  isWasmSupported,
  // Sandbox backend
  SandboxBackend,
  type SandboxBackendConfig,
  createSandboxBackend,
  isSandboxSupported,
  findClickHouseBinary,
  // ClickHouse server backend
  ClickHouseBackend,
  type ClickHouseBackendConfig,
  createClickHouseBackend,
  isClickHouseAvailable,
  // Factory and registry
  type BackendConfig,
  type BackendSelectionOptions,
  type BackendAvailability,
  checkBackendAvailability as checkAllBackends,
  detectBackend,
  createBackend,
  createAutoBackend,
  BackendRegistry,
  globalRegistry,
  initializeBackends,
} from './backends';

// Re-export default for convenience
export { default } from './proxy';
