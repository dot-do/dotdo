/**
 * Backend Abstractions for ClickHouse
 *
 * Provides a unified interface for executing ClickHouse queries across
 * multiple execution environments:
 *
 * - WASM: In-browser/Node.js WebAssembly-based ClickHouse
 * - Sandbox: Local ClickHouse binary in a sandboxed environment
 * - ClickHouse: Remote ClickHouse server via HTTP
 *
 * @example
 * ```typescript
 * import { createAutoBackend, createBackend } from '@dotdo/clickhouse/backends';
 *
 * // Auto-detect and create the best available backend
 * const backend = await createAutoBackend({
 *   config: {
 *     clickhouse: { host: 'http://localhost:8123' }
 *   }
 * });
 *
 * // Execute a query
 * const results = await backend.query<{ name: string }>('SELECT name FROM users');
 *
 * // Stream results
 * for await (const batch of backend.queryStream('SELECT * FROM big_table')) {
 *   console.log(`Received ${batch.length} rows`);
 * }
 *
 * // Clean up
 * backend.dispose?.();
 * ```
 *
 * @example
 * ```typescript
 * // Create a specific backend
 * import { createWasmBackend, createSandboxBackend, createClickHouseBackend } from '@dotdo/clickhouse/backends';
 *
 * // WASM backend for browser
 * const wasmBackend = createWasmBackend({ profile: 'standard' });
 *
 * // Sandbox backend for local development
 * const sandboxBackend = createSandboxBackend({ binary: '/usr/local/bin/clickhouse' });
 *
 * // ClickHouse server backend for production
 * const serverBackend = createClickHouseBackend({
 *   host: 'https://clickhouse.example.com',
 *   username: 'admin',
 *   password: 'secret'
 * });
 * ```
 */

// Base types and abstract class
export {
  Backend,
  BaseBackend,
  BackendName,
  BackendCapabilities,
  QueryOptions,
  DEFAULT_CAPABILITIES,
  FULL_CAPABILITIES,
  WASM_CAPABILITIES,
  SANDBOX_CAPABILITIES,
} from './base';

// WASM backend
export {
  WasmBackend,
  WasmBackendConfig,
  createWasmBackend,
  isWasmSupported,
} from './wasm';

// Sandbox backend
export {
  SandboxBackend,
  SandboxBackendConfig,
  createSandboxBackend,
  isSandboxSupported,
  findClickHouseBinary,
} from './sandbox';

// ClickHouse server backend
export {
  ClickHouseBackend,
  ClickHouseBackendConfig,
  createClickHouseBackend,
  isClickHouseAvailable,
} from './clickhouse';

// Factory and registry
export {
  BackendConfig,
  BackendSelectionOptions,
  BackendAvailability,
  checkBackendAvailability,
  detectBackend,
  createBackend,
  createAutoBackend,
  BackendRegistry,
  globalRegistry,
  initializeBackends,
} from './factory';
