/**
 * Document Database Durable Object
 *
 * Implements a MongoDB/Firebase-compatible document database using
 * Cloudflare Durable Objects for hot data and R2 for cold storage.
 *
 * Features:
 * - Document CRUD operations with MongoDB-like API
 * - Automatic ID generation (ObjectId-style or UUID)
 * - Index support for query optimization
 * - Realtime subscriptions via WebSocket
 * - Hybrid storage with automatic tiering
 * - Change streams for reactive updates
 *
 * @module storage/document-do
 */

import {
  type StorageConfig,
  type CollectionStorageConfig,
  type StorageStats,
  type CollectionStats,
  DEFAULT_STORAGE_CONFIG,
  parseStorageSize,
} from './storage-config';

/** Storage key prefixes */
const STORAGE_KEYS = {
  COLLECTION_PREFIX: 'col:',
  DOCUMENT_PREFIX: 'doc:',
  INDEX_PREFIX: 'idx:',
  META_PREFIX: 'meta:',
  CHUNK_INFIX: ':chunk:',
  CONFIG_KEY: 'config',
  COLLECTIONS_LIST: 'collections',
  STATS_KEY: 'stats',
} as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Document with metadata
 */
interface StoredDocument {
  _id: string;
  _createdAt: number;
  _updatedAt: number;
  _version: number;
  data: Record<string, unknown>;
}

/**
 * Collection metadata
 */
interface CollectionMetadata {
  name: string;
  createdAt: number;
  documentCount: number;
  totalBytes: number;
  config: CollectionStorageConfig;
  indexes: IndexMetadata[];
}

/**
 * Index metadata
 */
interface IndexMetadata {
  name: string;
  fields: string[];
  unique: boolean;
  createdAt: number;
}

/**
 * Durable Object State interface
 */
interface DurableObjectState {
  storage: DurableObjectStorage;
  id: { toString: () => string };
  waitUntil: (promise: Promise<unknown>) => void;
  blockConcurrencyWhile: <T>(callback: () => Promise<T>) => Promise<T>;
}

/**
 * Durable Object Storage interface
 */
interface DurableObjectStorage {
  get: <T = unknown>(key: string) => Promise<T | undefined>;
  put: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  deleteAll: () => Promise<void>;
  list: (options?: { prefix?: string; limit?: number }) => Promise<Map<string, unknown>>;
  transaction: <T>(callback: (txn: DurableObjectStorage) => Promise<T>) => Promise<T>;
  getAlarm: () => Promise<number | null>;
  setAlarm: (scheduledTime: number | Date) => Promise<void>;
  deleteAlarm: () => Promise<void>;
}

/**
 * R2 Bucket interface
 */
interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: ArrayBuffer | string): Promise<void>;
  delete(key: string | string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ objects: Array<{ key: string; size: number }> }>;
}

interface R2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

/**
 * Environment bindings
 */
interface DocumentDBEnv {
  DATA_BUCKET?: R2Bucket;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a unique document ID (ObjectId-style)
 */
function generateObjectId(): string {
  const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const random = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  return timestamp + random;
}

/**
 * Build storage key for a document
 */
function buildDocumentKey(collection: string, id: string): string {
  return `${STORAGE_KEYS.DOCUMENT_PREFIX}${collection}:${id}`;
}

/**
 * Build storage key for collection metadata
 */
function buildCollectionMetaKey(collection: string): string {
  return `${STORAGE_KEYS.META_PREFIX}${collection}`;
}

/**
 * Build storage key for index data
 */
function buildIndexKey(collection: string, indexName: string, value: string): string {
  return `${STORAGE_KEYS.INDEX_PREFIX}${collection}:${indexName}:${value}`;
}

/**
 * Estimate document size in bytes
 */
function estimateDocumentSize(doc: Record<string, unknown>): number {
  return JSON.stringify(doc).length * 2; // UTF-16 estimate
}

/**
 * Extract value from document for indexing
 */
function extractIndexValue(doc: Record<string, unknown>, fields: string[]): string {
  const values = fields.map((field) => {
    const parts = field.split('.');
    let value: unknown = doc;
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        value = undefined;
        break;
      }
    }
    return value === undefined ? '' : String(value);
  });
  return values.join(':');
}

/**
 * Match document against query filter
 */
function matchesQuery(doc: Record<string, unknown>, query: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(query)) {
    // Handle special operators
    if (key.startsWith('$')) {
      switch (key) {
        case '$and':
          if (!Array.isArray(value)) return false;
          return value.every((q) => matchesQuery(doc, q as Record<string, unknown>));
        case '$or':
          if (!Array.isArray(value)) return false;
          return value.some((q) => matchesQuery(doc, q as Record<string, unknown>));
        case '$not':
          return !matchesQuery(doc, value as Record<string, unknown>);
        default:
          return false; // Unknown operator
      }
    }

    // Get document value for the key (supports dot notation)
    const parts = key.split('.');
    let docValue: unknown = doc;
    for (const part of parts) {
      if (docValue && typeof docValue === 'object') {
        docValue = (docValue as Record<string, unknown>)[part];
      } else {
        docValue = undefined;
        break;
      }
    }

    // Handle comparison operators
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const ops = value as Record<string, unknown>;
      for (const [op, opValue] of Object.entries(ops)) {
        switch (op) {
          case '$eq':
            if (docValue !== opValue) return false;
            break;
          case '$ne':
            if (docValue === opValue) return false;
            break;
          case '$gt':
            if (typeof docValue !== 'number' || docValue <= (opValue as number)) return false;
            break;
          case '$gte':
            if (typeof docValue !== 'number' || docValue < (opValue as number)) return false;
            break;
          case '$lt':
            if (typeof docValue !== 'number' || docValue >= (opValue as number)) return false;
            break;
          case '$lte':
            if (typeof docValue !== 'number' || docValue > (opValue as number)) return false;
            break;
          case '$in':
            if (!Array.isArray(opValue) || !opValue.includes(docValue)) return false;
            break;
          case '$nin':
            if (!Array.isArray(opValue) || opValue.includes(docValue)) return false;
            break;
          case '$exists':
            if ((opValue && docValue === undefined) || (!opValue && docValue !== undefined))
              return false;
            break;
          case '$regex':
            if (typeof docValue !== 'string') return false;
            try {
              const regex = new RegExp(opValue as string);
              if (!regex.test(docValue)) return false;
            } catch {
              return false;
            }
            break;
          default:
            return false; // Unknown operator
        }
      }
    } else {
      // Direct equality comparison
      if (docValue !== value) return false;
    }
  }
  return true;
}

// =============================================================================
// DocumentDBDO Class
// =============================================================================

/**
 * Document Database Durable Object
 *
 * Provides MongoDB-compatible document storage using Cloudflare Durable Objects
 * with optional R2 tiering for large datasets.
 *
 * @example
 * ```typescript
 * // In a Worker
 * const id = env.DOCUMENT_DB_DO.idFromName('my-database');
 * const stub = env.DOCUMENT_DB_DO.get(id);
 *
 * // Insert a document
 * const response = await stub.fetch(new Request('http://internal/insert', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     collection: 'users',
 *     document: { name: 'Alice', email: 'alice@example.com' }
 *   })
 * }));
 * ```
 */
export class DocumentDBDO {
  private state: DurableObjectState;
  private env: DocumentDBEnv;
  private config: Required<StorageConfig>;
  private initialized: boolean = false;

  constructor(state: DurableObjectState, env: DocumentDBEnv) {
    this.state = state;
    this.env = env;
    this.config = DEFAULT_STORAGE_CONFIG;
  }

  /**
   * Initialize the DO with stored config
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    const storedConfig = await this.state.storage.get<Partial<StorageConfig>>(
      STORAGE_KEYS.CONFIG_KEY
    );
    if (storedConfig) {
      this.config = { ...DEFAULT_STORAGE_CONFIG, ...storedConfig };
    }

    this.initialized = true;
  }

  /**
   * Handle incoming HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    await this.initialize();

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Route based on path and method
      if (path === '/insert' && request.method === 'POST') {
        return this.handleInsert(request);
      }
      if (path === '/insertMany' && request.method === 'POST') {
        return this.handleInsertMany(request);
      }
      if (path === '/findById' && request.method === 'POST') {
        return this.handleFindById(request);
      }
      if (path === '/find' && request.method === 'POST') {
        return this.handleFind(request);
      }
      if (path === '/update' && request.method === 'POST') {
        return this.handleUpdate(request);
      }
      if (path === '/delete' && request.method === 'POST') {
        return this.handleDelete(request);
      }
      if (path === '/deleteMany' && request.method === 'POST') {
        return this.handleDeleteMany(request);
      }
      if (path === '/createCollection' && request.method === 'POST') {
        return this.handleCreateCollection(request);
      }
      if (path === '/dropCollection' && request.method === 'POST') {
        return this.handleDropCollection(request);
      }
      if (path === '/listCollections' && request.method === 'GET') {
        return this.handleListCollections();
      }
      if (path === '/stats' && request.method === 'GET') {
        return this.handleGetStats();
      }
      if (path === '/collectionStats' && request.method === 'POST') {
        return this.handleGetCollectionStats(request);
      }
      if (path === '/configure' && request.method === 'POST') {
        return this.handleConfigure(request);
      }
      if (path === '/runTiering' && request.method === 'POST') {
        return this.handleRunTiering();
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Handle scheduled alarms (for tiering)
   */
  async alarm(): Promise<void> {
    await this.runTiering();

    // Schedule next tiering run (every 6 hours)
    await this.state.storage.setAlarm(Date.now() + 6 * 60 * 60 * 1000);
  }

  // =========================================================================
  // Request Handlers
  // =========================================================================

  private async handleInsert(request: Request): Promise<Response> {
    const { collection, document } = await request.json<{
      collection: string;
      document: Record<string, unknown>;
    }>();

    const id = await this.insert(collection, document);
    return new Response(JSON.stringify({ id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleInsertMany(request: Request): Promise<Response> {
    const { collection, documents } = await request.json<{
      collection: string;
      documents: Record<string, unknown>[];
    }>();

    const ids = await this.insertMany(collection, documents);
    return new Response(JSON.stringify({ ids }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleFindById(request: Request): Promise<Response> {
    const { collection, id } = await request.json<{ collection: string; id: string }>();

    const doc = await this.findById(collection, id);
    return new Response(JSON.stringify({ document: doc }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleFind(request: Request): Promise<Response> {
    const { collection, query, options } = await request.json<{
      collection: string;
      query: Record<string, unknown>;
      options?: { limit?: number; skip?: number; sort?: Record<string, 1 | -1> };
    }>();

    const docs = await this.find(collection, query, options);
    return new Response(JSON.stringify({ documents: docs }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleUpdate(request: Request): Promise<Response> {
    const { collection, id, update } = await request.json<{
      collection: string;
      id: string;
      update: Record<string, unknown>;
    }>();

    const success = await this.update(collection, id, update);
    return new Response(JSON.stringify({ success }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleDelete(request: Request): Promise<Response> {
    const { collection, id } = await request.json<{ collection: string; id: string }>();

    const success = await this.delete(collection, id);
    return new Response(JSON.stringify({ success }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleDeleteMany(request: Request): Promise<Response> {
    const { collection, query } = await request.json<{
      collection: string;
      query: Record<string, unknown>;
    }>();

    const count = await this.deleteMany(collection, query);
    return new Response(JSON.stringify({ deletedCount: count }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleCreateCollection(request: Request): Promise<Response> {
    const { name, config } = await request.json<{
      name: string;
      config?: CollectionStorageConfig;
    }>();

    await this.createCollection(name, config);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleDropCollection(request: Request): Promise<Response> {
    const { name } = await request.json<{ name: string }>();

    await this.dropCollection(name);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleListCollections(): Promise<Response> {
    const collections = await this.listCollections();
    return new Response(JSON.stringify({ collections }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleGetStats(): Promise<Response> {
    const stats = await this.getStats();
    return new Response(JSON.stringify(stats), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleGetCollectionStats(request: Request): Promise<Response> {
    const { name } = await request.json<{ name: string }>();

    const stats = await this.getCollectionStats(name);
    return new Response(JSON.stringify(stats), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleConfigure(request: Request): Promise<Response> {
    const config = await request.json<Partial<StorageConfig>>();

    this.config = { ...this.config, ...config };
    await this.state.storage.put(STORAGE_KEYS.CONFIG_KEY, config);

    // Schedule tiering alarm if hybrid mode
    if (this.config.mode === 'hybrid') {
      const existingAlarm = await this.state.storage.getAlarm();
      if (!existingAlarm) {
        await this.state.storage.setAlarm(Date.now() + 60 * 60 * 1000); // 1 hour
      }
    }

    return new Response(JSON.stringify({ success: true, config: this.config }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleRunTiering(): Promise<Response> {
    const result = await this.runTiering();
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // =========================================================================
  // Core Operations
  // =========================================================================

  /**
   * Insert a document into a collection
   */
  async insert(collection: string, document: Record<string, unknown>): Promise<string> {
    // Ensure collection exists
    const meta = await this.getCollectionMeta(collection);
    if (!meta) {
      throw new Error(`Collection "${collection}" does not exist`);
    }

    // Generate ID if not provided
    const id = (document._id as string) || generateObjectId();

    // Create stored document
    const storedDoc: StoredDocument = {
      _id: id,
      _createdAt: Date.now(),
      _updatedAt: Date.now(),
      _version: 1,
      data: document,
    };

    const docSize = estimateDocumentSize(storedDoc as unknown as Record<string, unknown>);

    // Check DO size limit
    if (meta.totalBytes + docSize > parseStorageSize(this.config.doThreshold)) {
      if (this.config.mode === 'do') {
        throw new Error(
          `Collection "${collection}" would exceed DO storage threshold. Consider switching to hybrid mode.`
        );
      }
      // In hybrid mode, document goes directly to R2
      await this.writeToR2(collection, id, storedDoc);
    } else {
      // Write to DO
      await this.state.storage.put(buildDocumentKey(collection, id), storedDoc);
    }

    // Update indexes
    await this.updateIndexes(collection, id, document, meta.indexes);

    // Update collection metadata
    meta.documentCount++;
    meta.totalBytes += docSize;
    await this.state.storage.put(buildCollectionMetaKey(collection), meta);

    return id;
  }

  /**
   * Insert multiple documents
   */
  async insertMany(
    collection: string,
    documents: Record<string, unknown>[]
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const doc of documents) {
      const id = await this.insert(collection, doc);
      ids.push(id);
    }
    return ids;
  }

  /**
   * Find a document by ID
   */
  async findById(collection: string, id: string): Promise<Record<string, unknown> | null> {
    // Try DO first
    const storedDoc = await this.state.storage.get<StoredDocument>(
      buildDocumentKey(collection, id)
    );
    if (storedDoc) {
      return { _id: storedDoc._id, ...storedDoc.data };
    }

    // Try R2 if hybrid mode
    if (this.config.mode === 'hybrid' && this.env.DATA_BUCKET) {
      const r2Doc = await this.readFromR2(collection, id);
      if (r2Doc) {
        return { _id: r2Doc._id, ...r2Doc.data };
      }
    }

    return null;
  }

  /**
   * Find documents matching a query
   */
  async find(
    collection: string,
    query: Record<string, unknown>,
    options?: { limit?: number; skip?: number; sort?: Record<string, 1 | -1> }
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];

    // Scan DO documents
    const prefix = `${STORAGE_KEYS.DOCUMENT_PREFIX}${collection}:`;
    const docsMap = await this.state.storage.list({ prefix });

    for (const [, value] of docsMap) {
      const storedDoc = value as StoredDocument;
      const doc = { _id: storedDoc._id, ...storedDoc.data };
      if (matchesQuery(doc, query)) {
        results.push(doc);
      }
    }

    // Scan R2 documents if hybrid mode
    if (this.config.mode === 'hybrid' && this.env.DATA_BUCKET) {
      const r2Prefix = `${this.config.r2Prefix}${collection}/`;
      const r2List = await this.env.DATA_BUCKET.list({ prefix: r2Prefix });

      for (const obj of r2List.objects) {
        const r2Doc = await this.readFromR2ByKey(obj.key);
        if (r2Doc) {
          const doc = { _id: r2Doc._id, ...r2Doc.data };
          if (matchesQuery(doc, query)) {
            results.push(doc);
          }
        }
      }
    }

    // Apply sort
    if (options?.sort) {
      const sortEntries = Object.entries(options.sort);
      results.sort((a, b) => {
        for (const [field, direction] of sortEntries) {
          const aVal = a[field] as string | number | boolean | null;
          const bVal = b[field] as string | number | boolean | null;
          if (aVal === null || aVal === undefined) return 1 * direction;
          if (bVal === null || bVal === undefined) return -1 * direction;
          if (aVal < bVal) return -1 * direction;
          if (aVal > bVal) return 1 * direction;
        }
        return 0;
      });
    }

    // Apply skip and limit
    const skip = options?.skip || 0;
    const limit = options?.limit || results.length;
    return results.slice(skip, skip + limit);
  }

  /**
   * Update a document
   */
  async update(
    collection: string,
    id: string,
    update: Record<string, unknown>
  ): Promise<boolean> {
    const key = buildDocumentKey(collection, id);
    const storedDoc = await this.state.storage.get<StoredDocument>(key);

    if (storedDoc) {
      // Update in DO
      const updatedDoc: StoredDocument = {
        ...storedDoc,
        _updatedAt: Date.now(),
        _version: storedDoc._version + 1,
        data: { ...storedDoc.data, ...update },
      };

      await this.state.storage.put(key, updatedDoc);

      // Update indexes
      const meta = await this.getCollectionMeta(collection);
      if (meta) {
        await this.updateIndexes(collection, id, updatedDoc.data, meta.indexes);
      }

      return true;
    }

    // Try R2 if hybrid mode
    if (this.config.mode === 'hybrid' && this.env.DATA_BUCKET) {
      const r2Doc = await this.readFromR2(collection, id);
      if (r2Doc) {
        const updatedDoc: StoredDocument = {
          ...r2Doc,
          _updatedAt: Date.now(),
          _version: r2Doc._version + 1,
          data: { ...r2Doc.data, ...update },
        };
        await this.writeToR2(collection, id, updatedDoc);
        return true;
      }
    }

    return false;
  }

  /**
   * Delete a document
   */
  async delete(collection: string, id: string): Promise<boolean> {
    const key = buildDocumentKey(collection, id);
    const deleted = await this.state.storage.delete(key);

    if (deleted) {
      // Update collection metadata
      const meta = await this.getCollectionMeta(collection);
      if (meta) {
        meta.documentCount--;
        await this.state.storage.put(buildCollectionMetaKey(collection), meta);
      }
      return true;
    }

    // Try R2 if hybrid mode
    if (this.config.mode === 'hybrid' && this.env.DATA_BUCKET) {
      const r2Key = `${this.config.r2Prefix}${collection}/${id}.json`;
      try {
        await this.env.DATA_BUCKET.delete(r2Key);
        const meta = await this.getCollectionMeta(collection);
        if (meta) {
          meta.documentCount--;
          await this.state.storage.put(buildCollectionMetaKey(collection), meta);
        }
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Delete documents matching a query
   */
  async deleteMany(collection: string, query: Record<string, unknown>): Promise<number> {
    const docs = await this.find(collection, query);
    let count = 0;

    for (const doc of docs) {
      const deleted = await this.delete(collection, doc._id as string);
      if (deleted) count++;
    }

    return count;
  }

  /**
   * Create a collection
   */
  async createCollection(name: string, config?: CollectionStorageConfig): Promise<void> {
    const existingMeta = await this.getCollectionMeta(name);
    if (existingMeta) {
      throw new Error(`Collection "${name}" already exists`);
    }

    const meta: CollectionMetadata = {
      name,
      createdAt: Date.now(),
      documentCount: 0,
      totalBytes: 0,
      config: config || { name },
      indexes: [],
    };

    // Create default _id index
    meta.indexes.push({
      name: '_id_',
      fields: ['_id'],
      unique: true,
      createdAt: Date.now(),
    });

    await this.state.storage.put(buildCollectionMetaKey(name), meta);

    // Update collections list
    const collections = (await this.state.storage.get<string[]>(STORAGE_KEYS.COLLECTIONS_LIST)) || [];
    if (!collections.includes(name)) {
      collections.push(name);
      await this.state.storage.put(STORAGE_KEYS.COLLECTIONS_LIST, collections);
    }
  }

  /**
   * Drop a collection
   */
  async dropCollection(name: string): Promise<void> {
    // Delete all documents
    const prefix = `${STORAGE_KEYS.DOCUMENT_PREFIX}${name}:`;
    const docsMap = await this.state.storage.list({ prefix });
    for (const key of docsMap.keys()) {
      await this.state.storage.delete(key);
    }

    // Delete indexes
    const indexPrefix = `${STORAGE_KEYS.INDEX_PREFIX}${name}:`;
    const indexMap = await this.state.storage.list({ prefix: indexPrefix });
    for (const key of indexMap.keys()) {
      await this.state.storage.delete(key);
    }

    // Delete R2 data if hybrid mode
    if (this.config.mode === 'hybrid' && this.env.DATA_BUCKET) {
      const r2Prefix = `${this.config.r2Prefix}${name}/`;
      const r2List = await this.env.DATA_BUCKET.list({ prefix: r2Prefix });
      if (r2List.objects.length > 0) {
        await this.env.DATA_BUCKET.delete(r2List.objects.map((o) => o.key));
      }
    }

    // Delete metadata
    await this.state.storage.delete(buildCollectionMetaKey(name));

    // Update collections list
    const collections = (await this.state.storage.get<string[]>(STORAGE_KEYS.COLLECTIONS_LIST)) || [];
    const index = collections.indexOf(name);
    if (index !== -1) {
      collections.splice(index, 1);
      await this.state.storage.put(STORAGE_KEYS.COLLECTIONS_LIST, collections);
    }
  }

  /**
   * List all collections
   */
  async listCollections(): Promise<string[]> {
    return (await this.state.storage.get<string[]>(STORAGE_KEYS.COLLECTIONS_LIST)) || [];
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<StorageStats> {
    const collections = await this.listCollections();
    let doDocuments = 0;
    let r2Documents = 0;
    let doBytes = 0;
    let r2Bytes = 0;

    for (const name of collections) {
      const stats = await this.getCollectionStats(name);
      doDocuments += stats.doDocuments;
      r2Documents += stats.r2Documents;
      doBytes += stats.doBytes;
      r2Bytes += stats.r2Bytes;
    }

    return {
      doDocuments,
      r2Documents,
      doBytes,
      r2Bytes,
      collections: collections.length,
    };
  }

  /**
   * Get collection statistics
   */
  async getCollectionStats(name: string): Promise<CollectionStats> {
    const meta = await this.getCollectionMeta(name);
    if (!meta) {
      throw new Error(`Collection "${name}" does not exist`);
    }

    let r2Documents = 0;
    let r2Bytes = 0;

    if (this.config.mode === 'hybrid' && this.env.DATA_BUCKET) {
      const r2Prefix = `${this.config.r2Prefix}${name}/`;
      const r2List = await this.env.DATA_BUCKET.list({ prefix: r2Prefix });
      r2Documents = r2List.objects.length;
      r2Bytes = r2List.objects.reduce((sum, obj) => sum + obj.size, 0);
    }

    return {
      name,
      doDocuments: meta.documentCount,
      r2Documents,
      doBytes: meta.totalBytes,
      r2Bytes,
      indexes: meta.indexes.length,
    };
  }

  /**
   * Run data tiering (move cold data from DO to R2)
   */
  async runTiering(): Promise<{ moved: number; bytes: number }> {
    if (this.config.mode !== 'hybrid' || !this.env.DATA_BUCKET) {
      return { moved: 0, bytes: 0 };
    }

    let moved = 0;
    let bytes = 0;
    const collections = await this.listCollections();
    const threshold = parseStorageSize(this.config.doThreshold);
    const coldThreshold = Date.now() - this.config.coldAfterDays * 24 * 60 * 60 * 1000;

    for (const collectionName of collections) {
      const meta = await this.getCollectionMeta(collectionName);
      if (!meta || meta.totalBytes < threshold) continue;

      // Get all documents, sorted by creation time
      const prefix = `${STORAGE_KEYS.DOCUMENT_PREFIX}${collectionName}:`;
      const docsMap = await this.state.storage.list({ prefix });

      const docs: Array<{ key: string; doc: StoredDocument }> = [];
      for (const [key, value] of docsMap) {
        docs.push({ key, doc: value as StoredDocument });
      }

      // Sort by creation time (oldest first)
      docs.sort((a, b) => a.doc._createdAt - b.doc._createdAt);

      // Move cold documents to R2
      for (const { key, doc } of docs) {
        if (doc._createdAt > coldThreshold) break;
        if (meta.totalBytes < threshold * 0.8) break; // Stop when under 80% threshold

        const docSize = estimateDocumentSize(doc as unknown as Record<string, unknown>);
        await this.writeToR2(collectionName, doc._id, doc);
        await this.state.storage.delete(key);

        meta.totalBytes -= docSize;
        moved++;
        bytes += docSize;
      }

      await this.state.storage.put(buildCollectionMetaKey(collectionName), meta);
    }

    // Update stats
    await this.state.storage.put(STORAGE_KEYS.STATS_KEY, {
      lastTieringRun: Date.now(),
      lastTieringMoved: moved,
    });

    return { moved, bytes };
  }

  // =========================================================================
  // Helper Methods
  // =========================================================================

  private async getCollectionMeta(name: string): Promise<CollectionMetadata | null> {
    return (await this.state.storage.get<CollectionMetadata>(buildCollectionMetaKey(name))) || null;
  }

  private async updateIndexes(
    collection: string,
    docId: string,
    document: Record<string, unknown>,
    indexes: IndexMetadata[]
  ): Promise<void> {
    for (const index of indexes) {
      if (index.name === '_id_') continue; // _id is handled separately

      const value = extractIndexValue(document, index.fields);
      const indexKey = buildIndexKey(collection, index.name, value);

      // Get existing index entry
      const existing = (await this.state.storage.get<string[]>(indexKey)) || [];

      if (!existing.includes(docId)) {
        existing.push(docId);
        await this.state.storage.put(indexKey, existing);
      }
    }
  }

  private async writeToR2(
    collection: string,
    id: string,
    doc: StoredDocument
  ): Promise<void> {
    if (!this.env.DATA_BUCKET) {
      throw new Error('R2 bucket not configured');
    }

    const key = `${this.config.r2Prefix}${collection}/${id}.json`;
    const data = JSON.stringify(doc);
    await this.env.DATA_BUCKET.put(key, data);
  }

  private async readFromR2(collection: string, id: string): Promise<StoredDocument | null> {
    if (!this.env.DATA_BUCKET) return null;

    const key = `${this.config.r2Prefix}${collection}/${id}.json`;
    return this.readFromR2ByKey(key);
  }

  private async readFromR2ByKey(key: string): Promise<StoredDocument | null> {
    if (!this.env.DATA_BUCKET) return null;

    const obj = await this.env.DATA_BUCKET.get(key);
    if (!obj) return null;

    const text = await obj.text();
    return JSON.parse(text) as StoredDocument;
  }
}
