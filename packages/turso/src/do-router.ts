/**
 * @dotdo/turso DO Router Types
 *
 * Type definitions for the Durable Object-based query routing system.
 * These are stub types for TDD - implementation will follow in GREEN phase.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Result of a database query
 */
export interface QueryResult {
  rows: unknown[]
  columns: string[]
  rowsAffected: number
  lastInsertRowid: number | bigint | null
}

/**
 * Database stub representing a connection to a specific DO
 */
export interface DatabaseStub {
  id: { name: string; toString(): string }
  name: string
  fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>
  connect: () => Promise<Connection>
}

/**
 * Low-level connection for direct query execution
 */
export interface Connection {
  execute: (sql: string, params?: unknown[]) => Promise<QueryResult>
  close: () => Promise<void>
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for the DO router
 */
export interface TursoDORouterConfig {
  namespace: DurableObjectNamespace
  defaultPoolConfig?: PoolConfig
  cachingConfig?: CachingConfig
  logger?: Logger
}

/**
 * Durable Object namespace interface (Cloudflare Workers)
 */
export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

/**
 * Durable Object ID
 */
export interface DurableObjectId {
  name: string
  toString(): string
}

/**
 * Durable Object stub
 */
export interface DurableObjectStub {
  id: DurableObjectId
  fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>
  connect: () => Promise<unknown>
  name: string
}

/**
 * Per-tenant configuration
 */
export interface TenantConfig {
  tenantId: string
  connectionString?: string
  authToken?: string
  maxConnections?: number
}

/**
 * Connection pool configuration
 */
export interface PoolConfig {
  maxConnections: number
  connectionTimeout?: number
  idleTimeout?: number
}

/**
 * Caching configuration for DO stubs
 */
export interface CachingConfig {
  stubTTL?: number
  maxCacheSize?: number
}

// ============================================================================
// Routing Types
// ============================================================================

/**
 * Custom routing strategy
 */
export interface RoutingStrategy {
  name: string
  route: (query: string, context: RoutingContext) => 'primary' | 'replica'
}

/**
 * Context passed to routing strategy
 */
export interface RoutingContext {
  database: string
  sessionId?: string
  tenantId?: string
  forcePrimary?: boolean
}

/**
 * Information about the last routing decision
 */
export interface RoutingInfo {
  target: 'primary' | 'replica'
  queryType: 'read' | 'write'
  isTransaction?: boolean
  hint?: string
  reason?: string
  strategy?: string
}

// ============================================================================
// Failover Types
// ============================================================================

/**
 * Error that can be retried
 */
export interface TransientError extends Error {
  code?: string
  retryable: boolean
}

/**
 * Failover configuration
 */
export interface FailoverConfig {
  backupDatabase: string
  failoverThreshold: number
  healthCheckInterval?: number
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number
  resetTimeout: number
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
}

// ============================================================================
// Pool Types
// ============================================================================

/**
 * Connection pool state
 */
export interface ConnectionPool {
  maxConnections: number
  activeConnections: number
  availableConnections: number
  queuedRequests: number
  totalCreated: number
}

// ============================================================================
// Metrics & Logging Types
// ============================================================================

/**
 * Per-tenant metrics
 */
export interface TenantMetrics {
  queryCount: number
  readCount: number
  writeCount: number
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  size: number
}

/**
 * Logger interface
 */
export interface Logger {
  debug: (entry: unknown) => void
  info: (entry: unknown) => void
  error: (entry: unknown) => void
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Query options
 */
export interface QueryOptions {
  forcePrimary?: boolean
  sessionId?: string
  retry?: RetryConfig
}

/**
 * Batch query item
 */
export interface BatchQuery {
  sql: string
  params: unknown[]
}

/**
 * Transaction callback
 */
export type TransactionCallback = (tx: Transaction) => Promise<void>

/**
 * Transaction interface
 */
export interface Transaction {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>
  execute: (sql: string, params?: unknown[]) => Promise<QueryResult>
}

// ============================================================================
// Main Router Class (Stub)
// ============================================================================

/**
 * TursoDORouter - Routes queries to appropriate Durable Objects
 *
 * This is a stub class for TDD. Implementation will follow in GREEN phase.
 */
export class TursoDORouter {
  constructor(_config: TursoDORouterConfig) {
    throw new Error('TursoDORouter not implemented - RED phase')
  }

  // Database access
  async getDatabase(_name: string): Promise<DatabaseStub> {
    throw new Error('Not implemented')
  }

  async getDatabaseForTenant(_tenantId: string, _dbName?: string): Promise<DatabaseStub> {
    throw new Error('Not implemented')
  }

  async connectTenant(_config: TenantConfig): Promise<DatabaseStub> {
    throw new Error('Not implemented')
  }

  // Query execution
  async query(_db: string | DatabaseStub, _sql: string, _options?: QueryOptions): Promise<QueryResult> {
    throw new Error('Not implemented')
  }

  async execute(_db: string | DatabaseStub, _sql: string, _params?: unknown[], _options?: QueryOptions): Promise<QueryResult> {
    throw new Error('Not implemented')
  }

  async batch(_db: string, _queries: BatchQuery[]): Promise<QueryResult[]> {
    throw new Error('Not implemented')
  }

  async transaction(_db: string, _callback: TransactionCallback): Promise<void> {
    throw new Error('Not implemented')
  }

  // Tenant isolation
  withTenantIsolation(_tenantId: string): TursoDORouter {
    throw new Error('Not implemented')
  }

  getTenantConfig(_tenantId: string): TenantConfig | undefined {
    throw new Error('Not implemented')
  }

  // Routing
  getLastRoutingInfo(): RoutingInfo {
    throw new Error('Not implemented')
  }

  setRoutingStrategy(_strategy: RoutingStrategy): void {
    throw new Error('Not implemented')
  }

  enableReadYourWrites(_sessionId: string): void {
    throw new Error('Not implemented')
  }

  // Failover
  configureFailover(_dbName: string, _config: FailoverConfig): void {
    throw new Error('Not implemented')
  }

  configureCircuitBreaker(_dbName: string, _config: CircuitBreakerConfig): void {
    throw new Error('Not implemented')
  }

  isFailedOver(_dbName: string): boolean {
    throw new Error('Not implemented')
  }

  // Pool management
  getConnectionPool(_dbName: string): ConnectionPool {
    throw new Error('Not implemented')
  }

  configurePool(_dbName: string, _config: PoolConfig): void {
    throw new Error('Not implemented')
  }

  // Caching
  flushCache(_dbName?: string): void {
    throw new Error('Not implemented')
  }

  configureCaching(_config: CachingConfig): void {
    throw new Error('Not implemented')
  }

  getCacheStats(): CacheStats {
    throw new Error('Not implemented')
  }

  // Metrics & logging
  getMetrics(_tenantId: string): TenantMetrics {
    throw new Error('Not implemented')
  }

  setLogger(_logger: Logger): void {
    throw new Error('Not implemented')
  }
}
