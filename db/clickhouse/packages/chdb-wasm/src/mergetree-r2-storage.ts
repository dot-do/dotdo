/**
 * MergeTree R2 Storage Integration
 *
 * This module provides the integration layer between MergeTree storage
 * and Cloudflare R2/Durable Objects. It uses the existing R2StorageProvider
 * and MergeTreeDO from the src/storage directory.
 *
 * Usage in worker:
 *
 * ```typescript
 * import { createMergeTreeStorage, MergeTreeStorageManager } from './mergetree-r2-storage';
 *
 * // In worker fetch handler
 * const storage = createMergeTreeStorage(env);
 * if (storage.isConfigured()) {
 *   const parts = await storage.listParts('default', 'my_table');
 * }
 * ```
 *
 * @module mergetree-r2-storage
 */

import {
  R2StorageProvider,
  createR2Provider,
  type R2Bucket,
} from './storage/r2-provider';
import type { VFSStorageProvider } from './wasm/vfs-bridge';
import type { DurableObjectNamespace, DurableObjectStub } from './http-query-handler';

// ---------------------------------------------------------------------------
// Integration Types
// ---------------------------------------------------------------------------

/**
 * R2 Bucket interface - compatible subset of Cloudflare's R2Bucket
 * This is a minimal interface that works with both http-query-handler and r2-provider types
 */
export interface MergeTreeR2Bucket {
  get(key: string, options?: { range?: { offset?: number; length?: number } }): Promise<unknown>;
  head(key: string): Promise<{ size: number; etag?: string } | null>;
  put(key: string, value: ArrayBuffer | string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ objects: unknown[] }>;
}

/**
 * Environment bindings required for MergeTree R2 storage
 */
export interface MergeTreeStorageEnv {
  /** R2 bucket for MergeTree data storage */
  DATA_BUCKET?: MergeTreeR2Bucket;
  /** Durable Object namespace for MergeTreeDO coordination */
  MERGETREE_DO?: DurableObjectNamespace;
}

/**
 * Part information from MergeTree DO
 */
export interface PartInfo {
  name: string;
  partition: string;
  rowCount: number;
  sizeBytes: number;
  state: 'active' | 'detached' | 'merging' | 'deleting';
  minBlock: number;
  maxBlock: number;
  level: number;
  createdAt: string;
}

/**
 * Table schema from MergeTree DO
 */
export interface TableSchema {
  name: string;
  database: string;
  columns: Array<{
    name: string;
    type: string;
    nullable?: boolean;
    default?: unknown;
  }>;
  engine: string;
  orderBy?: string[];
  partitionBy?: string;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// VFS Provider for MergeTree
// ---------------------------------------------------------------------------

/**
 * MergeTree VFS Provider that routes operations to R2 storage
 *
 * This wraps the R2StorageProvider with MergeTree-specific path handling
 * and integrates with the Durable Object for metadata coordination.
 */
export class MergeTreeVFSProvider implements VFSStorageProvider {
  private readonly r2Provider: R2StorageProvider;
  private readonly doNamespace?: DurableObjectNamespace;

  constructor(env: MergeTreeStorageEnv) {
    if (!env.DATA_BUCKET) {
      throw new Error('DATA_BUCKET is required for MergeTreeVFSProvider');
    }

    // Cast to R2Bucket - the interfaces are compatible at runtime
    this.r2Provider = createR2Provider(env.DATA_BUCKET as unknown as R2Bucket, {
      prefix: 'mergetree/',
      cacheMetadata: true,
      cacheTTL: 60000, // 1 minute cache for metadata
    });

    this.doNamespace = env.MERGETREE_DO;
  }

  // VFSStorageProvider interface implementation

  async stat(path: string) {
    return this.r2Provider.stat(path);
  }

  async read(path: string, offset: number, length: number) {
    return this.r2Provider.read(path, offset, length);
  }

  async readFile(path: string) {
    return this.r2Provider.readFile(path);
  }

  async write(path: string, data: ArrayBuffer) {
    return this.r2Provider.write(path, data);
  }

  async append(path: string, data: ArrayBuffer) {
    return this.r2Provider.append(path, data);
  }

  async delete(path: string) {
    return this.r2Provider.delete(path);
  }

  async list(path: string) {
    return this.r2Provider.list(path);
  }

  async mkdir(path: string) {
    return this.r2Provider.mkdir(path);
  }

  async rename(oldPath: string, newPath: string) {
    return this.r2Provider.rename(oldPath, newPath);
  }

  async flush() {
    return this.r2Provider.flush();
  }

  // Additional MergeTree-specific methods

  /**
   * Get the Durable Object stub for a table
   */
  getTableDO(database: string, table: string): DurableObjectStub | null {
    if (!this.doNamespace) {
      return null;
    }
    const id = this.doNamespace.idFromName(`${database}.${table}`);
    return this.doNamespace.get(id);
  }

  /**
   * Get active parts for a table from the Durable Object
   */
  async getActiveParts(database: string, table: string): Promise<PartInfo[]> {
    const stub = this.getTableDO(database, table);
    if (!stub) {
      return [];
    }

    try {
      const response = await stub.fetch(
        new Request('https://do/tables?database=' + encodeURIComponent(database))
      );
      if (!response.ok) {
        return [];
      }
      // Parse response - for now return empty array until DO endpoint is implemented
      await response.json();
      // TODO: Implement actual part listing from DO response
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Clear metadata cache
   */
  clearCache(): void {
    this.r2Provider.clearCache();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.r2Provider.getStats();
  }
}

// ---------------------------------------------------------------------------
// Storage Manager
// ---------------------------------------------------------------------------

/**
 * MergeTree Storage Manager
 *
 * Provides a high-level interface for MergeTree storage operations,
 * coordinating between R2 storage and Durable Objects.
 */
export class MergeTreeStorageManager {
  private readonly vfsProvider: MergeTreeVFSProvider | null;
  private readonly env: MergeTreeStorageEnv;

  constructor(env: MergeTreeStorageEnv) {
    this.env = env;

    if (env.DATA_BUCKET) {
      try {
        this.vfsProvider = new MergeTreeVFSProvider(env);
      } catch {
        this.vfsProvider = null;
      }
    } else {
      this.vfsProvider = null;
    }
  }

  /**
   * Check if storage is properly configured
   */
  isConfigured(): boolean {
    return this.vfsProvider !== null;
  }

  /**
   * Check if full storage (R2 + DO) is available
   */
  hasFullStorage(): boolean {
    return !!this.env.DATA_BUCKET && !!this.env.MERGETREE_DO;
  }

  /**
   * Get the VFS provider for WASM integration
   */
  getVFSProvider(): VFSStorageProvider | null {
    return this.vfsProvider;
  }

  /**
   * Get a Durable Object stub for a specific table
   */
  getTableDO(database: string, table: string): DurableObjectStub | null {
    if (!this.env.MERGETREE_DO) {
      return null;
    }
    const id = this.env.MERGETREE_DO.idFromName(`${database}.${table}`);
    return this.env.MERGETREE_DO.get(id);
  }

  /**
   * List all parts for a table
   */
  async listParts(database: string, table: string): Promise<PartInfo[]> {
    if (!this.vfsProvider) {
      return [];
    }
    return this.vfsProvider.getActiveParts(database, table);
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { cachedEntries?: number; trackedDirectories?: number } {
    if (!this.vfsProvider) {
      return {};
    }
    return this.vfsProvider.getCacheStats();
  }

  /**
   * Clear caches
   */
  clearCaches(): void {
    if (this.vfsProvider) {
      this.vfsProvider.clearCache();
    }
  }
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Create a MergeTree storage manager from environment bindings
 *
 * @param env - Worker environment bindings
 * @returns MergeTreeStorageManager instance
 */
export function createMergeTreeStorage(
  env: MergeTreeStorageEnv
): MergeTreeStorageManager {
  return new MergeTreeStorageManager(env);
}

/**
 * Create a MergeTree VFS provider from environment bindings
 *
 * @param env - Worker environment bindings
 * @returns MergeTreeVFSProvider instance or null if DATA_BUCKET not configured
 */
export function createMergeTreeVFSProviderFromEnv(
  env: MergeTreeStorageEnv
): MergeTreeVFSProvider | null {
  if (!env.DATA_BUCKET) {
    return null;
  }

  try {
    return new MergeTreeVFSProvider(env);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Path Helpers
// ---------------------------------------------------------------------------

/**
 * Build R2 path for a MergeTree data file
 *
 * R2 key structure:
 *   {database}/{table}/data/{partition}/{part_name}/{file}
 *
 * @param database - Database name
 * @param table - Table name
 * @param partition - Partition key (e.g., "202401")
 * @param partName - Part name (e.g., "20240115_1_1_0")
 * @param file - File name (e.g., "data.bin", "columns.txt")
 * @returns Full R2 key path
 */
export function buildMergeTreePath(
  database: string,
  table: string,
  partition: string,
  partName: string,
  file: string
): string {
  return `${database}/${table}/data/${partition}/${partName}/${file}`;
}

/**
 * Build R2 prefix for listing files in a part
 */
export function buildPartPrefix(
  database: string,
  table: string,
  partition: string,
  partName: string
): string {
  return `${database}/${table}/data/${partition}/${partName}/`;
}

/**
 * Build R2 prefix for listing parts in a partition
 */
export function buildPartitionPrefix(
  database: string,
  table: string,
  partition: string
): string {
  return `${database}/${table}/data/${partition}/`;
}

/**
 * Build R2 prefix for listing partitions in a table
 */
export function buildTablePrefix(database: string, table: string): string {
  return `${database}/${table}/data/`;
}
