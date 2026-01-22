/**
 * Client factory for @dotdo/chdb
 *
 * Provides a unified interface for creating chdb clients with automatic
 * backend detection and configuration options.
 */

import type { ChdbClient, ChdbConfig } from './types';
import { ChdbError } from './types';
import {
  detectEnvironment,
  autoSelectBackend,
  checkSandboxAvailable,
  checkWasmAvailable,
  type Backend,
  type Environment,
} from './detection';

// Re-export detection types and functions for convenience
export type { Backend, Environment };
export {
  detectEnvironment,
  autoSelectBackend,
  checkSandboxAvailable,
  checkWasmAvailable,
};

/**
 * WASM backend configuration options
 */
export interface WasmOptions {
  /** WASM profile determining feature set and binary size */
  profile?: 'minimal' | 'standard' | 'full';
  /** Maximum memory limit in bytes for the WASM instance */
  memoryLimit?: number;
}

/**
 * Sandbox backend configuration options
 */
export interface SandboxOptions {
  /** Path to chdb binary */
  binary?: string;
  /** Query timeout in milliseconds */
  timeout?: number;
}

/**
 * Options for creating a chdb client
 */
export interface CreateChdbOptions {
  /** Backend to use ('wasm', 'sandbox', or 'auto' for automatic detection) */
  backend?: Backend;
  /** WASM-specific configuration */
  wasm?: WasmOptions;
  /** Sandbox-specific configuration */
  sandbox?: SandboxOptions;
  /** Common ClickHouse settings applied to all queries */
  settings?: Record<string, string | number>;
}


/**
 * Auto-detect the best available backend
 *
 * Uses the detection module to determine the optimal backend based on:
 * - Runtime environment (browser, worker, node, deno, container)
 * - Backend availability (sandbox binary, WebAssembly support)
 */
async function autoDetectBackend(options?: CreateChdbOptions): Promise<ChdbClient> {
  try {
    const backend = await autoSelectBackend({
      preferSandbox: true,
      customBinaryPath: options?.sandbox?.binary,
    });

    if (backend === 'sandbox') {
      const { createSandboxBackend } = await import('./backends/sandbox');
      return createSandboxBackend(options?.sandbox);
    }

    if (backend === 'wasm') {
      const { createWasmBackend } = await import('./backends/wasm');
      return createWasmBackend(options?.wasm);
    }

    // This shouldn't happen, but handle it gracefully
    throw new ChdbError(`Unknown backend selected: ${backend}`);
  } catch (error) {
    if (error instanceof ChdbError) {
      throw error;
    }
    throw new ChdbError(
      `No available backend found. ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Create a chdb client with the specified options
 *
 * @param options - Configuration options for the client
 * @returns A promise that resolves to a ChdbClient instance
 *
 * @example
 * ```typescript
 * // Auto-detect backend
 * const client = await createClient();
 *
 * // Explicitly use WASM backend
 * const wasmClient = await createClient({ backend: 'wasm' });
 *
 * // Use sandbox with custom binary path
 * const sandboxClient = await createClient({
 *   backend: 'sandbox',
 *   sandbox: { binary: '/opt/chdb/bin/chdb' }
 * });
 *
 * // With common settings
 * const client = await createClient({
 *   settings: {
 *     max_threads: 4,
 *     max_memory_usage: 1073741824
 *   }
 * });
 * ```
 */
export async function createClient(options?: CreateChdbOptions): Promise<ChdbClient> {
  const backend = options?.backend || 'auto';

  if (backend === 'auto') {
    return await autoDetectBackend(options);
  }

  if (backend === 'wasm') {
    const { createWasmBackend } = await import('./backends/wasm');
    return createWasmBackend(options?.wasm);
  }

  if (backend === 'sandbox') {
    const { createSandboxBackend } = await import('./backends/sandbox');
    return createSandboxBackend(options?.sandbox);
  }

  throw new ChdbError(`Unknown backend: ${backend}`);
}

/**
 * Create a chdb client (alias for createClient)
 *
 * @param options - Configuration options for the client
 * @returns A promise that resolves to a ChdbClient instance
 */
export const createChdb = createClient;

/**
 * Re-export types for convenience
 */
export type { ChdbClient, ChdbConfig };
