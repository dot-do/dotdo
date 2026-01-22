/**
 * Storage Configuration for Document Databases
 *
 * Provides configuration options for hybrid storage mode that combines
 * Durable Objects and R2 for document database support (MongoDB/Firebase compat).
 *
 * Storage Modes:
 * - DO-Only: All data in Durable Object SQLite (<1GB, low latency, realtime)
 * - R2-Only: MergeTree parts stored in R2 (large datasets, analytical)
 * - Hybrid: DO for hot data, R2 for cold data (recommended)
 *
 * @module storage/storage-config
 */

// =============================================================================
// Storage Mode Types
// =============================================================================

/**
 * Storage mode for document databases
 */
export type StorageMode = 'do' | 'r2' | 'hybrid';

/**
 * Data tiering policy for hybrid mode
 * - age: Move to cold storage based on document age
 * - access: Move based on access patterns (LRU)
 * - size: Move based on collection size thresholds
 */
export type TieringPolicy = 'age' | 'access' | 'size';

// =============================================================================
// Storage Configuration Types
// =============================================================================

/**
 * Storage size with unit
 */
export interface StorageSize {
  value: number;
  unit: 'B' | 'KB' | 'MB' | 'GB';
}

/**
 * Parse storage size string (e.g., "100MB") to bytes
 */
export function parseStorageSize(size: string): number {
  const match = size.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
  if (!match) {
    throw new Error(`Invalid storage size format: ${size}. Expected format: "100MB", "1GB", etc.`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };

  return Math.floor(value * multipliers[unit]);
}

/**
 * Format bytes to human-readable size
 */
export function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

/**
 * Storage configuration options for document databases
 */
export interface StorageConfig {
  /**
   * Storage mode: 'do', 'r2', or 'hybrid'
   * @default 'hybrid'
   */
  mode: StorageMode;

  /**
   * Size threshold for moving data from DO to R2 in hybrid mode
   * When collection exceeds this size, older documents move to R2
   * @default '100MB'
   */
  doThreshold?: string;

  /**
   * Data tiering policy for hybrid mode
   * @default 'age'
   */
  tieringPolicy?: TieringPolicy;

  /**
   * Days after which data is considered "cold" and moved to R2
   * Only used when tieringPolicy is 'age'
   * @default 7
   */
  coldAfterDays?: number;

  /**
   * Maximum documents to keep in DO hot storage per collection
   * Only used when tieringPolicy is 'access'
   * @default 10000
   */
  maxHotDocuments?: number;

  /**
   * Enable realtime subscriptions (requires DO storage)
   * @default true
   */
  enableRealtime?: boolean;

  /**
   * R2 bucket prefix for data storage
   * @default 'documents/'
   */
  r2Prefix?: string;

  /**
   * Enable compression for R2 storage
   * @default true
   */
  enableCompression?: boolean;

  /**
   * Batch size for R2 operations
   * @default 100
   */
  r2BatchSize?: number;
}

/**
 * Default storage configuration
 */
export const DEFAULT_STORAGE_CONFIG: Required<StorageConfig> = {
  mode: 'hybrid',
  doThreshold: '100MB',
  tieringPolicy: 'age',
  coldAfterDays: 7,
  maxHotDocuments: 10000,
  enableRealtime: true,
  r2Prefix: 'documents/',
  enableCompression: true,
  r2BatchSize: 100,
};

/**
 * Merge user config with defaults
 */
export function mergeStorageConfig(config: Partial<StorageConfig>): Required<StorageConfig> {
  return {
    ...DEFAULT_STORAGE_CONFIG,
    ...config,
  };
}

// =============================================================================
// Storage Limits
// =============================================================================

/**
 * Cloudflare Durable Object storage limits
 */
export const DO_LIMITS = {
  /** Maximum storage per DO instance */
  MAX_STORAGE_BYTES: 1024 * 1024 * 1024, // 1GB

  /** Maximum key size */
  MAX_KEY_SIZE: 2048,

  /** Maximum value size per key */
  MAX_VALUE_SIZE: 128 * 1024, // 128KB

  /** Maximum keys per list() call */
  MAX_LIST_KEYS: 1000,

  /** Maximum concurrent connections to a DO */
  MAX_CONCURRENT_REQUESTS: 100,

  /** Alarm minimum interval */
  MIN_ALARM_INTERVAL_MS: 1000,
} as const;

/**
 * Cloudflare R2 storage limits
 */
export const R2_LIMITS = {
  /** Maximum object size */
  MAX_OBJECT_SIZE: 5 * 1024 * 1024 * 1024 * 1024, // 5TB

  /** Maximum object size for single PUT */
  MAX_SINGLE_PUT_SIZE: 5 * 1024 * 1024 * 1024, // 5GB

  /** Recommended multipart threshold */
  MULTIPART_THRESHOLD: 100 * 1024 * 1024, // 100MB

  /** Maximum parts per multipart upload */
  MAX_MULTIPART_PARTS: 10000,

  /** Minimum part size for multipart */
  MIN_MULTIPART_PART_SIZE: 5 * 1024 * 1024, // 5MB

  /** Maximum list objects per request */
  MAX_LIST_OBJECTS: 1000,

  /** Maximum keys to delete per request */
  MAX_DELETE_KEYS: 1000,
} as const;

// =============================================================================
// Collection Configuration
// =============================================================================

/**
 * Per-collection storage configuration
 */
export interface CollectionStorageConfig {
  /**
   * Collection name
   */
  name: string;

  /**
   * Override storage mode for this collection
   */
  mode?: StorageMode;

  /**
   * Override tiering policy for this collection
   */
  tieringPolicy?: TieringPolicy;

  /**
   * Custom threshold for this collection
   */
  doThreshold?: string;

  /**
   * Enable indexing for this collection
   * @default true
   */
  indexed?: boolean;

  /**
   * Fields to index (for query optimization)
   */
  indexFields?: string[];

  /**
   * TTL in days (documents auto-delete after this time)
   * @default undefined (no TTL)
   */
  ttlDays?: number;

  /**
   * Enable change streams for this collection
   * @default false
   */
  enableChangeStreams?: boolean;
}

// =============================================================================
// Storage State Types
// =============================================================================

/**
 * Storage statistics for monitoring
 */
export interface StorageStats {
  /** Total documents in DO storage */
  doDocuments: number;
  /** Total documents in R2 storage */
  r2Documents: number;
  /** Total bytes in DO storage */
  doBytes: number;
  /** Total bytes in R2 storage */
  r2Bytes: number;
  /** Number of collections */
  collections: number;
  /** Last tiering run timestamp */
  lastTieringRun?: number;
  /** Documents moved in last tiering run */
  lastTieringMoved?: number;
}

/**
 * Collection statistics
 */
export interface CollectionStats {
  name: string;
  doDocuments: number;
  r2Documents: number;
  doBytes: number;
  r2Bytes: number;
  indexes: number;
  lastWrite?: number;
  lastRead?: number;
}

// =============================================================================
// Storage Provider Interface
// =============================================================================

/**
 * Storage provider interface for document operations
 */
export interface DocumentStorageProvider {
  /**
   * Insert a document
   */
  insert(collection: string, document: Record<string, unknown>): Promise<string>;

  /**
   * Insert multiple documents
   */
  insertMany(collection: string, documents: Record<string, unknown>[]): Promise<string[]>;

  /**
   * Find a document by ID
   */
  findById(collection: string, id: string): Promise<Record<string, unknown> | null>;

  /**
   * Find documents matching a query
   */
  find(
    collection: string,
    query: Record<string, unknown>,
    options?: { limit?: number; skip?: number; sort?: Record<string, 1 | -1> }
  ): Promise<Record<string, unknown>[]>;

  /**
   * Update a document
   */
  update(
    collection: string,
    id: string,
    update: Record<string, unknown>
  ): Promise<boolean>;

  /**
   * Delete a document
   */
  delete(collection: string, id: string): Promise<boolean>;

  /**
   * Delete documents matching a query
   */
  deleteMany(collection: string, query: Record<string, unknown>): Promise<number>;

  /**
   * Create a collection
   */
  createCollection(name: string, config?: CollectionStorageConfig): Promise<void>;

  /**
   * Drop a collection
   */
  dropCollection(name: string): Promise<void>;

  /**
   * List all collections
   */
  listCollections(): Promise<string[]>;

  /**
   * Get storage statistics
   */
  getStats(): Promise<StorageStats>;

  /**
   * Get collection statistics
   */
  getCollectionStats(name: string): Promise<CollectionStats>;

  /**
   * Run data tiering (move cold data from DO to R2)
   */
  runTiering(): Promise<{ moved: number; bytes: number }>;
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate storage configuration
 */
export function validateStorageConfig(config: Partial<StorageConfig>): void {
  if (config.mode && !['do', 'r2', 'hybrid'].includes(config.mode)) {
    throw new Error(`Invalid storage mode: ${config.mode}. Must be 'do', 'r2', or 'hybrid'.`);
  }

  if (config.tieringPolicy && !['age', 'access', 'size'].includes(config.tieringPolicy)) {
    throw new Error(
      `Invalid tiering policy: ${config.tieringPolicy}. Must be 'age', 'access', or 'size'.`
    );
  }

  if (config.doThreshold) {
    try {
      const bytes = parseStorageSize(config.doThreshold);
      if (bytes > DO_LIMITS.MAX_STORAGE_BYTES) {
        throw new Error(
          `DO threshold ${config.doThreshold} exceeds DO storage limit of ${formatStorageSize(DO_LIMITS.MAX_STORAGE_BYTES)}`
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('Invalid storage size')) {
        throw e;
      }
      throw new Error(`Invalid doThreshold: ${config.doThreshold}`);
    }
  }

  if (config.coldAfterDays !== undefined && config.coldAfterDays < 0) {
    throw new Error('coldAfterDays must be non-negative');
  }

  if (config.maxHotDocuments !== undefined && config.maxHotDocuments < 1) {
    throw new Error('maxHotDocuments must be at least 1');
  }

  if (config.r2BatchSize !== undefined && (config.r2BatchSize < 1 || config.r2BatchSize > 1000)) {
    throw new Error('r2BatchSize must be between 1 and 1000');
  }
}

/**
 * Check if storage mode supports realtime subscriptions
 */
export function supportsRealtime(mode: StorageMode): boolean {
  return mode === 'do' || mode === 'hybrid';
}

/**
 * Check if storage mode requires R2 bucket
 */
export function requiresR2(mode: StorageMode): boolean {
  return mode === 'r2' || mode === 'hybrid';
}

/**
 * Check if storage mode requires DO namespace
 */
export function requiresDO(mode: StorageMode): boolean {
  return mode === 'do' || mode === 'hybrid';
}
