// Redis Integration
// Key-value database capabilities for the dotdo integration registry (do-h3in)
// Hooks pattern standardized in do-07dn

import type {
  Integration,
  IntegrationConfig,
  IntegrationStatus,
  IntegrationMetadata,
  IntegrationResult,
  IntegrationWebhookHandler,
  IntegrationEvent,
  IntegrationHooks,
  MethodCallContext,
} from '../types'
import { successResult, errorResult } from '../registry'

/**
 * Redis-specific configuration
 */
export interface RedisConfig extends IntegrationConfig {
  /** Redis connection URL (redis:// or rediss:// for TLS) */
  url?: string
  /** Redis host */
  host?: string
  /** Redis port */
  port?: number
  /** Redis password */
  password?: string
  /** Database index */
  db?: number
  /** Enable TLS */
  tls?: boolean
  /** Connection timeout in milliseconds */
  connectTimeout?: number
  /** Command timeout in milliseconds */
  commandTimeout?: number
  /** Maximum retry attempts */
  maxRetries?: number
  /** Key prefix for all operations */
  keyPrefix?: string
}

/**
 * Redis value types
 */
export type RedisValue = string | number | null

/**
 * SET command options
 */
export interface SetOptions {
  /** Expiration in seconds */
  ex?: number
  /** Expiration in milliseconds */
  px?: number
  /** Unix timestamp for expiration (seconds) */
  exat?: number
  /** Unix timestamp for expiration (milliseconds) */
  pxat?: number
  /** Only set if key does not exist */
  nx?: boolean
  /** Only set if key exists */
  xx?: boolean
  /** Keep existing TTL */
  keepttl?: boolean
  /** Return old value */
  get?: boolean
}

/**
 * SCAN options
 */
export interface ScanOptions {
  /** Pattern to match */
  match?: string
  /** Number of elements to return per iteration */
  count?: number
  /** Key type */
  type?: 'string' | 'list' | 'set' | 'zset' | 'hash' | 'stream'
}

/**
 * SCAN result
 */
export interface ScanResult {
  cursor: number
  keys: string[]
}

/**
 * Redis integration methods
 */
export interface RedisMethods extends Record<string, (...args: any[]) => Promise<IntegrationResult>> {
  // String operations
  get: (key: string) => Promise<IntegrationResult<RedisValue>>
  set: (key: string, value: string | number, options?: SetOptions) => Promise<IntegrationResult<string | null>>
  del: (...keys: string[]) => Promise<IntegrationResult<number>>
  exists: (...keys: string[]) => Promise<IntegrationResult<number>>
  expire: (key: string, seconds: number) => Promise<IntegrationResult<boolean>>
  ttl: (key: string) => Promise<IntegrationResult<number>>
  incr: (key: string) => Promise<IntegrationResult<number>>
  incrby: (key: string, increment: number) => Promise<IntegrationResult<number>>
  decr: (key: string) => Promise<IntegrationResult<number>>

  // Hash operations
  hget: (key: string, field: string) => Promise<IntegrationResult<RedisValue>>
  hset: (key: string, fieldOrObject: string | Record<string, string | number>, value?: string | number) => Promise<IntegrationResult<number>>
  hgetall: (key: string) => Promise<IntegrationResult<Record<string, string>>>
  hdel: (key: string, ...fields: string[]) => Promise<IntegrationResult<number>>

  // List operations
  lpush: (key: string, ...values: (string | number)[]) => Promise<IntegrationResult<number>>
  rpush: (key: string, ...values: (string | number)[]) => Promise<IntegrationResult<number>>
  lpop: (key: string, count?: number) => Promise<IntegrationResult<RedisValue | string[]>>
  rpop: (key: string, count?: number) => Promise<IntegrationResult<RedisValue | string[]>>
  lrange: (key: string, start: number, stop: number) => Promise<IntegrationResult<string[]>>
  llen: (key: string) => Promise<IntegrationResult<number>>

  // Set operations
  sadd: (key: string, ...members: (string | number)[]) => Promise<IntegrationResult<number>>
  smembers: (key: string) => Promise<IntegrationResult<string[]>>
  sismember: (key: string, member: string | number) => Promise<IntegrationResult<boolean>>
  srem: (key: string, ...members: (string | number)[]) => Promise<IntegrationResult<number>>

  // JSON operations (RedisJSON-like)
  jsonSet: (key: string, path: string, value: unknown) => Promise<IntegrationResult<string>>
  jsonGet: (key: string, path?: string) => Promise<IntegrationResult<unknown>>

  // Pub/Sub
  publish: (channel: string, message: string) => Promise<IntegrationResult<number>>

  // Utility
  keys: (pattern: string) => Promise<IntegrationResult<string[]>>
  scan: (cursor: number, options?: ScanOptions) => Promise<IntegrationResult<ScanResult>>
  ping: () => Promise<IntegrationResult<string>>
}

/**
 * Redis Integration
 * Provides key-value database capabilities
 *
 * ## Hooks Pattern (do-07dn)
 * Redis supports Pub/Sub for real-time events:
 * - onEvent() for subscription message handling
 * - setHooks() for method call observability
 * - No traditional webhooks (uses Pub/Sub instead)
 */
export class RedisIntegration implements Integration<RedisConfig, RedisMethods> {
  readonly name = 'redis'
  readonly version = '1.0.0'
  readonly metadata: IntegrationMetadata = {
    displayName: 'Redis',
    description: 'In-memory key-value database',
    category: 'database',
    docsUrl: 'https://redis.io/docs',
    websiteUrl: 'https://redis.io',
    requiredConfig: ['url'],
    optionalConfig: ['host', 'port', 'password', 'db', 'tls', 'keyPrefix'],
  }

  private _status: IntegrationStatus = 'uninitialized'
  private config: RedisConfig | null = null
  private eventHandlers: IntegrationWebhookHandler[] = []
  private hooks: IntegrationHooks = {}

  get status(): IntegrationStatus {
    return this._status
  }

  async init(config: RedisConfig): Promise<void> {
    this._status = 'initializing'

    try {
      // Validate connection info
      if (!config.url && !config.host) {
        throw new Error('Redis URL or host is required')
      }

      this.config = config

      // In a real implementation, you would:
      // 1. Create Redis client connection
      // 2. Test connection with PING
      // 3. Handle reconnection logic

      this._status = 'ready'
    } catch (error) {
      this._status = 'error'
      throw error
    }
  }

  async shutdown(): Promise<void> {
    // In a real implementation, you would close the connection
    this.config = null
    this.eventHandlers = []
    this.hooks = {}
    this._status = 'uninitialized'
  }

  async healthCheck(): Promise<boolean> {
    if (this._status !== 'ready' || !this.config) {
      return false
    }

    // In a real implementation, you would PING the server
    return true
  }

  /**
   * Methods exposed by this integration
   */
  readonly methods: RedisMethods = {
    // String operations
    get: async (key) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      // Stub implementation - returns mock data
      return successResult(`value_for_${key}`, `req_${generateId()}`)
    },

    set: async (key, value, options) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      // Stub implementation
      return successResult('OK', `req_${generateId()}`)
    },

    del: async (...keys) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(keys.length, `req_${generateId()}`)
    },

    exists: async (...keys) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(keys.length, `req_${generateId()}`)
    },

    expire: async (key, seconds) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(true, `req_${generateId()}`)
    },

    ttl: async (key) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(3600, `req_${generateId()}`)
    },

    incr: async (key) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(1, `req_${generateId()}`)
    },

    incrby: async (key, increment) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(increment, `req_${generateId()}`)
    },

    decr: async (key) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(-1, `req_${generateId()}`)
    },

    // Hash operations
    hget: async (key, field) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(`value_for_${field}`, `req_${generateId()}`)
    },

    hset: async (key, fieldOrObject, value) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      const numFields = typeof fieldOrObject === 'object' ? Object.keys(fieldOrObject).length : 1
      return successResult(numFields, `req_${generateId()}`)
    },

    hgetall: async (key) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult({ field1: 'value1', field2: 'value2' }, `req_${generateId()}`)
    },

    hdel: async (key, ...fields) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(fields.length, `req_${generateId()}`)
    },

    // List operations
    lpush: async (key, ...values) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(values.length, `req_${generateId()}`)
    },

    rpush: async (key, ...values) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(values.length, `req_${generateId()}`)
    },

    lpop: async (key, count) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      if (count && count > 1) {
        return successResult(['value1', 'value2'], `req_${generateId()}`)
      }
      return successResult('value1', `req_${generateId()}`)
    },

    rpop: async (key, count) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      if (count && count > 1) {
        return successResult(['value1', 'value2'], `req_${generateId()}`)
      }
      return successResult('value1', `req_${generateId()}`)
    },

    lrange: async (key, start, stop) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(['item1', 'item2', 'item3'], `req_${generateId()}`)
    },

    llen: async (key) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(3, `req_${generateId()}`)
    },

    // Set operations
    sadd: async (key, ...members) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(members.length, `req_${generateId()}`)
    },

    smembers: async (key) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(['member1', 'member2', 'member3'], `req_${generateId()}`)
    },

    sismember: async (key, member) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(true, `req_${generateId()}`)
    },

    srem: async (key, ...members) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(members.length, `req_${generateId()}`)
    },

    // JSON operations
    jsonSet: async (key, path, value) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult('OK', `req_${generateId()}`)
    },

    jsonGet: async (key, path) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult({ name: 'Test', value: 123 }, `req_${generateId()}`)
    },

    // Pub/Sub
    publish: async (channel, message) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      // Returns number of subscribers that received the message
      return successResult(1, `req_${generateId()}`)
    },

    // Utility
    keys: async (pattern) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult(['key1', 'key2', 'key3'], `req_${generateId()}`)
    },

    scan: async (cursor, options) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      const result: ScanResult = {
        cursor: cursor === 0 ? 0 : cursor + 10,
        keys: ['key1', 'key2', 'key3'],
      }
      return successResult(result, `req_${generateId()}`)
    },

    ping: async () => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Redis integration is not initialized')
      }

      return successResult('PONG', `req_${generateId()}`)
    },
  }

  // ============================================================================
  // EVENT HOOKS (do-07dn)
  // Redis uses Pub/Sub for event delivery, not HTTP webhooks.
  // onEvent() handles subscription messages; no handleWebhook() needed.
  // ============================================================================

  /**
   * Register a handler for Redis Pub/Sub events.
   * In a real implementation, this would subscribe to Redis channels
   * and call handlers when messages are received.
   */
  onEvent(handler: IntegrationWebhookHandler): void {
    this.eventHandlers.push(handler)
  }

  /**
   * Emit an event to all registered handlers.
   * Called internally when Pub/Sub messages are received.
   */
  private async emitEvent(type: string, payload: unknown, channel?: string): Promise<void> {
    const event: IntegrationEvent = {
      integration: this.name,
      type,
      payload,
      timestamp: new Date(),
      webhookId: channel, // Use channel as webhook ID for Pub/Sub
    }

    for (const handler of this.eventHandlers) {
      try {
        await handler(event)
      } catch (error) {
        // Call error hook if configured
        if (this.hooks.onError) {
          await this.hooks.onError(
            { code: 'EVENT_HANDLER_ERROR', message: String(error), originalError: error },
            { integration: this.name, method: 'emitEvent' }
          )
        }
      }
    }
  }

  // ============================================================================
  // OBSERVABILITY HOOKS (do-07dn)
  // ============================================================================

  /**
   * Configure observability hooks for method calls and errors.
   */
  setHooks(hooks: IntegrationHooks): void {
    this.hooks = hooks
  }

  /**
   * Helper to wrap method calls with hooks.
   * Call this at the start and end of method implementations for full observability.
   */
  private async invokeWithHooks<T>(
    method: string,
    args: unknown[],
    fn: () => Promise<IntegrationResult<T>>
  ): Promise<IntegrationResult<T>> {
    const context: MethodCallContext = {
      method,
      args,
      timestamp: new Date(),
    }

    // Call before hook
    if (this.hooks.onMethodCall?.before) {
      await this.hooks.onMethodCall.before(context)
    }

    let result: IntegrationResult<T>
    try {
      result = await fn()
    } catch (error) {
      result = errorResult('UNEXPECTED_ERROR', String(error), error)
    }

    // Call after hook
    if (this.hooks.onMethodCall?.after) {
      await this.hooks.onMethodCall.after(context, result as IntegrationResult)
    }

    // Call error hook on failure
    if (!result.success && this.hooks.onError) {
      await this.hooks.onError(result.error!, { integration: this.name, method, args })
    }

    return result
  }
}

/**
 * Generate a random ID for stub responses
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

/**
 * Factory function for creating Redis integration
 */
export function createRedisIntegration(): RedisIntegration {
  return new RedisIntegration()
}

/**
 * Default export
 */
export default RedisIntegration
