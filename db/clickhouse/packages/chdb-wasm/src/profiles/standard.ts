/**
 * Standard profile for @dotdo/chdb-wasm
 *
 * Balanced WASM size (~10MB gzipped) with commonly used features:
 * - Table Engines: Memory, URL, MergeTree, S3
 * - Formats: JSON, CSV, TSV, Parquet, Arrow
 * - Functions: Core SQL + Aggregates
 *
 * Best for: Most use cases in Cloudflare Workers
 *
 * @example
 * ```typescript
 * import { createChdb } from '@dotdo/chdb-wasm/standard';
 *
 * const chdb = await createChdb();
 * const result = await chdb.query(`
 *   SELECT *
 *   FROM url('https://example.com/data.parquet')
 *   FORMAT JSONEachRow
 * `);
 * ```
 *
 * @packageDocumentation
 */

import type { ChdbInstance, ChdbConfig, QueryOptions, MemoryStats } from '../types';
import { createChdb as createChdbBase, ChdbError, DisposedError } from '../chdb';

/**
 * Supported output formats in standard profile.
 */
export type StandardOutputFormat =
  | 'JSON'
  | 'JSONEachRow'
  | 'JSONCompact'
  | 'JSONStringsEachRow'
  | 'CSV'
  | 'CSVWithNames'
  | 'TSV'
  | 'TSVWithNames'
  | 'Parquet'
  | 'Arrow';

/**
 * Query options for standard profile.
 */
export interface StandardQueryOptions extends Omit<QueryOptions, 'format'> {
  format?: StandardOutputFormat;
}

/**
 * Configuration for standard profile.
 */
export interface StandardChdbConfig extends Omit<ChdbConfig, 'profile'> {
  /**
   * Memory limit defaults to 64MB for standard profile.
   * @default 67108864 (64MB)
   */
  memoryLimit?: number;
}

/**
 * ChdbInstance type for standard profile.
 */
export interface StandardChdbInstance extends Omit<ChdbInstance, 'query' | 'queryStream'> {
  query(sql: string, options?: StandardQueryOptions): Promise<string>;
  queryStream(sql: string, options?: StandardQueryOptions): AsyncIterable<string>;
}

/**
 * Create a chdb instance with standard profile.
 *
 * @param config - Optional configuration options.
 * @returns A promise that resolves to a ChdbInstance with standard features.
 */
export async function createChdb(config?: StandardChdbConfig): Promise<StandardChdbInstance> {
  const defaultStandardConfig: StandardChdbConfig = {
    memoryLimit: 64 * 1024 * 1024, // 64MB default for standard
    ...config,
  };

  return createChdbBase({
    ...defaultStandardConfig,
    profile: 'standard',
  }) as Promise<StandardChdbInstance>;
}

export { ChdbError, DisposedError };
export type { MemoryStats };

// Profile metadata
export const profile = {
  name: 'standard',
  targetSize: '10MB',
  features: {
    engines: ['Memory', 'URL', 'MergeTree', 'S3'],
    formats: ['JSON', 'Parquet', 'CSV', 'TSV', 'Arrow'],
    functions: 'Full aggregates, string, datetime, math',
    sql: ['Subqueries', 'CTEs'],
  },
  recommended: true,
};

// Default export for convenience
export { createChdb as default } from '../chdb';
