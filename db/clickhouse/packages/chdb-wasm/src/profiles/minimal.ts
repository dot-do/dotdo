/**
 * Minimal profile for @dotdo/chdb-wasm
 *
 * Smallest WASM size (~3MB gzipped) with essential features:
 * - Table Engines: Memory, URL
 * - Formats: JSON, Parquet
 * - Functions: Core SQL functions
 *
 * Best for: Simple queries, memory-constrained environments
 *
 * @example
 * ```typescript
 * import { createChdb } from '@dotdo/chdb-wasm/minimal';
 *
 * const chdb = await createChdb();
 * const result = await chdb.query('SELECT 1 + 1', { format: 'JSON' });
 * ```
 *
 * @packageDocumentation
 */

import type { ChdbInstance, ChdbConfig, QueryOptions, MemoryStats } from '../types';
import { createChdb as createChdbBase, ChdbError, DisposedError } from '../chdb';

/**
 * Supported output formats in minimal profile.
 */
export type MinimalOutputFormat = 'JSON' | 'JSONEachRow' | 'JSONCompact' | 'Parquet';

/**
 * Query options for minimal profile.
 */
export interface MinimalQueryOptions extends Omit<QueryOptions, 'format'> {
  format?: MinimalOutputFormat;
}

/**
 * Configuration for minimal profile.
 */
export interface MinimalChdbConfig extends Omit<ChdbConfig, 'profile'> {
  /**
   * Memory limit defaults to 32MB for minimal profile.
   * @default 33554432 (32MB)
   */
  memoryLimit?: number;
}

/**
 * ChdbInstance type for minimal profile.
 */
export interface MinimalChdbInstance extends Omit<ChdbInstance, 'query' | 'queryStream'> {
  query(sql: string, options?: MinimalQueryOptions): Promise<string>;
  queryStream(sql: string, options?: MinimalQueryOptions): AsyncIterable<string>;
}

/**
 * Create a chdb instance with minimal profile.
 *
 * @param config - Optional configuration options.
 * @returns A promise that resolves to a ChdbInstance with minimal features.
 */
export async function createChdb(config?: MinimalChdbConfig): Promise<MinimalChdbInstance> {
  const defaultMinimalConfig: MinimalChdbConfig = {
    memoryLimit: 32 * 1024 * 1024, // 32MB default for minimal
    ...config,
  };

  return createChdbBase({
    ...defaultMinimalConfig,
    profile: 'minimal',
  }) as Promise<MinimalChdbInstance>;
}

export { ChdbError, DisposedError };
export type { MemoryStats };

// Profile metadata
export const profile = {
  name: 'minimal',
  targetSize: '3MB',
  features: {
    engines: ['Memory', 'URL'],
    formats: ['JSON', 'Parquet'],
    functions: 'Core SQL (COUNT, SUM, AVG, MIN, MAX)',
  },
};
