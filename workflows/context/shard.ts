/**
 * Shard Context API for $.shard
 *
 * Provides a workflow context API for DO-level sharding with support for:
 * - $.shard(namespace, config?) - Create or access ShardManager for a namespace
 * - $.shard(namespace).getShardStub(key) - Get DO stub for a specific key
 * - $.shard(namespace).getShardId(key) - Get shard index for a key
 * - $.shard(namespace).queryAll(path, init?) - Fan out query to all shards
 * - $.shard(namespace).getAllShardStubs() - Get all shard stubs
 *
 * Handles the 10GB per DO limit by distributing data across multiple DOs using:
 * - Consistent hashing: Minimal key redistribution when adding shards
 * - Range sharding: Good for time-series or alphabetical data
 * - Simple hash: Uniform distribution, full redistribution on resize
 *
 * @module workflows/context/shard
 */

import {
  ShardManager,
  consistentHash,
  rangeHash,
  simpleHash,
  extractShardKey,
  type ShardQueryResult,
} from '../../db/core/shard'
import {
  type ShardConfig,
  type ShardAlgorithm,
  DEFAULT_SHARD_CONFIG,
} from '../../db/core/types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration options for shard context
 */
export interface ShardContextConfig extends Partial<ShardConfig> {
  /** Optional namespace binding (for testing with mocks) */
  namespace?: DurableObjectNamespace
}

/**
 * Shard context instance returned by $.shard(namespace)
 */
export interface ShardContextInstance {
  /**
   * Get the ShardManager for this namespace
   */
  manager(): ShardManager

  /**
   * Get shard index for a key value
   * @param key - The key to hash
   * @returns Shard index [0, count)
   */
  getShardId(key: string): number

  /**
   * Get DO stub for a specific shard key value
   * @param key - The shard key value (e.g., tenant ID)
   * @returns DO stub for the appropriate shard
   */
  getShardStub(key: string): Promise<DurableObjectStub>

  /**
   * Get DO stub by extracting shard key from SQL
   * @param sql - SQL statement
   * @param params - Query parameters
   * @returns DO stub or undefined if no shard key found
   */
  getShardStubForSql(
    sql: string,
    params?: unknown[] | Record<string, unknown>
  ): Promise<DurableObjectStub | undefined>

  /**
   * Fan out a query to all shards
   * @param path - Request path
   * @param init - Fetch init options
   * @returns Array of results from each shard
   */
  queryAll<T = unknown>(
    path: string,
    init?: RequestInit
  ): Promise<ShardQueryResult<T>[]>

  /**
   * Get all shard stubs
   */
  getAllShardStubs(): DurableObjectStub[]

  /**
   * Get current configuration
   */
  config(): ShardConfig

  /**
   * Get shard count
   */
  shardCount(): number

  /**
   * Get shard key field name
   */
  shardKey(): string
}

/**
 * Internal storage for shard context state
 */
export interface ShardStorage {
  /** Registered namespaces with their managers */
  managers: Map<string, ShardManager>
  /** Namespace configurations */
  configs: Map<string, ShardConfig>
  /** Mock namespace bindings for testing */
  mockBindings: Map<string, DurableObjectNamespace>
}

/**
 * Full context interface returned by createMockContext
 */
export interface ShardContext {
  shard: (namespaceName: string, config?: ShardContextConfig) => ShardContextInstance
  _storage: ShardStorage
  _registerMockNamespace: (name: string, namespace: DurableObjectNamespace) => void
}

// ============================================================================
// MOCK DURABLE OBJECT NAMESPACE
// ============================================================================

/**
 * Mock DurableObjectId for testing
 */
class MockDurableObjectId implements DurableObjectId {
  constructor(
    private _name: string,
    public readonly name: string | undefined = _name
  ) {}

  toString(): string {
    return this._name
  }

  equals(other: DurableObjectId): boolean {
    return other.toString() === this._name
  }
}

/**
 * Mock DurableObjectStub for testing
 */
class MockDurableObjectStub implements DurableObjectStub {
  readonly id: DurableObjectId
  readonly name?: string

  constructor(id: DurableObjectId) {
    this.id = id
    this.name = id.name
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Return a mock response for testing
    return new Response(JSON.stringify({ shard: this.name, mock: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  connect(_options?: DurableObjectConnectOptions): Socket {
    throw new Error('Mock stub does not support connect()')
  }
}

/**
 * Mock DurableObjectNamespace for testing
 */
class MockDurableObjectNamespace implements DurableObjectNamespace {
  jurisdiction(_options: DurableObjectJurisdiction): DurableObjectNamespace {
    return this
  }

  idFromName(name: string): DurableObjectId {
    return new MockDurableObjectId(name, name)
  }

  idFromString(id: string): DurableObjectId {
    return new MockDurableObjectId(id, undefined)
  }

  newUniqueId(options?: DurableObjectNewUniqueIdOptions): DurableObjectId {
    const id = `unique-${Date.now()}-${Math.random().toString(36).slice(2)}`
    return new MockDurableObjectId(id, options?.jurisdiction)
  }

  get(id: DurableObjectId): DurableObjectStub {
    return new MockDurableObjectStub(id)
  }
}

// ============================================================================
// CONTEXT FACTORY
// ============================================================================

/**
 * Creates a mock workflow context ($) with shard support for testing
 *
 * This factory creates a context object with:
 * - $.shard(namespace, config?) - Returns a ShardContextInstance for the namespace
 * - $._storage - Internal storage for test setup
 * - $._registerMockNamespace - Register mock DO namespace for testing
 *
 * @returns A ShardContext object with shard API methods
 *
 * @example Basic usage
 * ```typescript
 * const $ = createMockContext()
 *
 * // Configure a shard namespace
 * const tenantShard = $.shard('tenants', {
 *   key: 'tenant_id',
 *   count: 16,
 *   algorithm: 'consistent'
 * })
 *
 * // Get shard for a specific tenant
 * const shardId = tenantShard.getShardId('tenant-123')
 * const stub = await tenantShard.getShardStub('tenant-123')
 *
 * // Fan out query to all shards
 * const results = await tenantShard.queryAll('/query', {
 *   method: 'POST',
 *   body: JSON.stringify({ sql: 'SELECT * FROM data' })
 * })
 * ```
 */
export function createMockContext(): ShardContext {
  // Internal storage
  const storage: ShardStorage = {
    managers: new Map<string, ShardManager>(),
    configs: new Map<string, ShardConfig>(),
    mockBindings: new Map<string, DurableObjectNamespace>(),
  }

  /**
   * Get or create namespace binding
   */
  function getNamespaceBinding(name: string): DurableObjectNamespace {
    // Check for registered mock binding
    let binding = storage.mockBindings.get(name)
    if (!binding) {
      // Create a default mock binding
      binding = new MockDurableObjectNamespace()
      storage.mockBindings.set(name, binding)
    }
    return binding
  }

  /**
   * Get or create ShardManager for a namespace
   */
  function getOrCreateManager(
    namespaceName: string,
    config?: ShardContextConfig
  ): ShardManager {
    // Check for existing manager
    let manager = storage.managers.get(namespaceName)

    if (!manager) {
      // Create new manager
      const namespace = config?.namespace ?? getNamespaceBinding(namespaceName)
      const shardConfig: ShardConfig = {
        key: config?.key ?? DEFAULT_SHARD_CONFIG.key,
        count: config?.count ?? DEFAULT_SHARD_CONFIG.count,
        algorithm: config?.algorithm ?? DEFAULT_SHARD_CONFIG.algorithm,
      }

      manager = new ShardManager(namespace, shardConfig)
      storage.managers.set(namespaceName, manager)
      storage.configs.set(namespaceName, shardConfig)
    } else if (config) {
      // Update existing manager config if provided
      const namespace = config.namespace ?? getNamespaceBinding(namespaceName)
      const shardConfig: ShardConfig = {
        key: config.key ?? storage.configs.get(namespaceName)!.key,
        count: config.count ?? storage.configs.get(namespaceName)!.count,
        algorithm: config.algorithm ?? storage.configs.get(namespaceName)!.algorithm,
      }

      manager = new ShardManager(namespace, shardConfig)
      storage.managers.set(namespaceName, manager)
      storage.configs.set(namespaceName, shardConfig)
    }

    return manager
  }

  /**
   * Create a ShardContextInstance for a namespace
   */
  function createShardInstance(
    namespaceName: string,
    config?: ShardContextConfig
  ): ShardContextInstance {
    const manager = getOrCreateManager(namespaceName, config)

    return {
      manager(): ShardManager {
        return manager
      },

      getShardId(key: string): number {
        return manager.getShardId(key)
      },

      async getShardStub(key: string): Promise<DurableObjectStub> {
        return manager.getShardStub(key)
      },

      async getShardStubForSql(
        sql: string,
        params?: unknown[] | Record<string, unknown>
      ): Promise<DurableObjectStub | undefined> {
        return manager.getShardStubForSql(sql, params)
      },

      async queryAll<T = unknown>(
        path: string,
        init?: RequestInit
      ): Promise<ShardQueryResult<T>[]> {
        return manager.queryAll<T>(path, init)
      },

      getAllShardStubs(): DurableObjectStub[] {
        return manager.getAllShardStubs()
      },

      config(): ShardConfig {
        return manager.config
      },

      shardCount(): number {
        return manager.shardCount
      },

      shardKey(): string {
        return manager.shardKey
      },
    }
  }

  return {
    shard: createShardInstance,
    _storage: storage,
    _registerMockNamespace(name: string, namespace: DurableObjectNamespace): void {
      storage.mockBindings.set(name, namespace)
    },
  }
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

// Re-export utility functions from shard module
export {
  consistentHash,
  rangeHash,
  simpleHash,
  extractShardKey,
}

// Re-export types
export type {
  ShardConfig,
  ShardAlgorithm,
  ShardQueryResult,
}
