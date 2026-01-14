/**
 * ServiceRegistry Types - Service Discovery Primitives
 *
 * Provides types for comprehensive service discovery:
 * - Service registration and deregistration
 * - Service discovery with query matching
 * - Load balancing (round-robin, random, weighted, least-connections)
 * - Health monitoring and heartbeats
 * - TTL-based auto-deregistration
 * - Change notifications via watchers
 */

/**
 * Health status of a service instance
 */
export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown'

/**
 * Load balancing strategy for endpoint selection
 */
export type LoadBalancerStrategy = 'round-robin' | 'random' | 'weighted' | 'least-connections'

/**
 * Service definition
 */
export interface Service {
  /** Unique service identifier */
  id: string
  /** Human-readable service name */
  name: string
  /** Service version (semver format recommended) */
  version: string
  /** Service endpoints (URLs or addresses) */
  endpoints: string[]
  /** Additional metadata */
  metadata?: Record<string, unknown>
  /** Tags for filtering */
  tags?: string[]
}

/**
 * Service instance representing a running instance of a service
 */
export interface ServiceInstance {
  /** Unique instance identifier */
  id: string
  /** ID of the service this instance belongs to */
  serviceId: string
  /** Host address */
  host: string
  /** Port number */
  port: number
  /** Current health status */
  status: HealthStatus
  /** Weight for weighted load balancing (default: 1) */
  weight: number
  /** Timestamp when instance was registered */
  registeredAt: number
  /** Timestamp of last heartbeat */
  lastHeartbeat: number
  /** Additional instance metadata */
  metadata?: Record<string, unknown>
  /** Tags for filtering */
  tags?: string[]
  /** Active connection count for least-connections balancing */
  activeConnections?: number
}

/**
 * Query parameters for service discovery
 */
export interface ServiceQuery {
  /** Service name to match */
  name?: string
  /** Version to match (exact or semver range) */
  version?: string
  /** Tags that must all be present */
  tags?: string[]
  /** Health status filter */
  status?: HealthStatus
  /** Maximum number of results */
  limit?: number
}

/**
 * Heartbeat configuration
 */
export interface HeartbeatConfig {
  /** Heartbeat interval in milliseconds */
  interval: number
  /** Timeout for considering instance unhealthy */
  timeout: number
  /** Number of retries before marking as unhealthy */
  retries: number
}

/**
 * Registration options for a service instance
 */
export interface RegistrationOptions {
  /** Time-to-live in milliseconds (auto-deregister if no heartbeat) */
  ttl?: number
  /** Heartbeat configuration */
  heartbeat?: HeartbeatConfig
  /** Initial health status (default: 'unknown') */
  initialStatus?: HealthStatus
  /** Weight for weighted load balancing (default: 1) */
  weight?: number
  /** Tags for filtering */
  tags?: string[]
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Endpoint selection result
 */
export interface EndpointResult {
  /** The selected instance */
  instance: ServiceInstance
  /** Full endpoint URL */
  endpoint: string
}

/**
 * Service change event
 */
export interface ServiceChangeEvent {
  /** Type of change */
  type: 'registered' | 'deregistered' | 'updated' | 'health-changed'
  /** Service name */
  serviceName: string
  /** Affected instance */
  instance: ServiceInstance
  /** Previous instance state (for updates) */
  previousState?: Partial<ServiceInstance>
  /** Timestamp of the event */
  timestamp: number
}

/**
 * Watch callback function
 */
export type WatchCallback = (event: ServiceChangeEvent) => void

/**
 * Watch subscription handle
 */
export interface WatchHandle {
  /** Unique subscription ID */
  id: string
  /** Service name being watched */
  serviceName: string
  /** Unsubscribe function */
  unsubscribe: () => void
}

/**
 * Service registry interface
 */
export interface IServiceRegistry {
  /**
   * Register a service instance
   * @param service Service definition
   * @param options Registration options
   * @returns The registered instance
   */
  register(service: Service, options?: RegistrationOptions): Promise<ServiceInstance>

  /**
   * Deregister a service instance
   * @param instanceId Instance ID to remove
   */
  deregister(instanceId: string): Promise<void>

  /**
   * Discover services matching a query
   * @param query Service query parameters
   * @returns Matching service instances
   */
  discover(query: ServiceQuery): Promise<ServiceInstance[]>

  /**
   * Get an endpoint for a service with load balancing
   * @param serviceName Service name
   * @param strategy Load balancing strategy (default: 'round-robin')
   * @returns Selected endpoint or null if no instances available
   */
  getEndpoint(serviceName: string, strategy?: LoadBalancerStrategy): Promise<EndpointResult | null>

  /**
   * Send a heartbeat for an instance
   * @param instanceId Instance ID
   * @returns Updated instance
   */
  heartbeat(instanceId: string): Promise<ServiceInstance>

  /**
   * Watch for changes to a service
   * @param serviceName Service name to watch
   * @param callback Callback for change events
   * @returns Watch handle for unsubscribing
   */
  watch(serviceName: string, callback: WatchCallback): WatchHandle
}

/**
 * Load balancer interface
 */
export interface ILoadBalancer {
  /**
   * Select an instance from available instances
   * @param instances Available instances
   * @param strategy Load balancing strategy
   * @returns Selected instance or null if none available
   */
  select(instances: ServiceInstance[], strategy: LoadBalancerStrategy): ServiceInstance | null

  /**
   * Record a connection to an instance (for least-connections)
   * @param instanceId Instance ID
   */
  connect(instanceId: string): void

  /**
   * Record a disconnection from an instance
   * @param instanceId Instance ID
   */
  disconnect(instanceId: string): void

  /**
   * Reset round-robin index for a service
   * @param serviceName Service name
   */
  resetIndex(serviceName: string): void
}

/**
 * Health monitor interface
 */
export interface IHealthMonitor {
  /**
   * Update health status of an instance
   * @param instanceId Instance ID
   * @param status New health status
   */
  updateStatus(instanceId: string, status: HealthStatus): Promise<void>

  /**
   * Get health status of an instance
   * @param instanceId Instance ID
   * @returns Current health status
   */
  getStatus(instanceId: string): Promise<HealthStatus>

  /**
   * Start health checking for an instance
   * @param instance Instance to monitor
   * @param config Health check configuration
   */
  startMonitoring(instance: ServiceInstance, config: HeartbeatConfig): void

  /**
   * Stop health checking for an instance
   * @param instanceId Instance ID
   */
  stopMonitoring(instanceId: string): void
}

/**
 * TTL manager interface for auto-deregistration
 */
export interface ITTLManager {
  /**
   * Set TTL for an instance
   * @param instanceId Instance ID
   * @param ttl Time-to-live in milliseconds
   */
  setTTL(instanceId: string, ttl: number): void

  /**
   * Refresh TTL for an instance (extend expiration)
   * @param instanceId Instance ID
   */
  refresh(instanceId: string): void

  /**
   * Remove TTL tracking for an instance
   * @param instanceId Instance ID
   */
  remove(instanceId: string): void

  /**
   * Set callback for when an instance expires
   * @param callback Expiration callback
   */
  onExpire(callback: (instanceId: string) => void): void
}

/**
 * Service matcher interface for query matching
 */
export interface IServiceMatcher {
  /**
   * Check if an instance matches a query
   * @param instance Instance to check
   * @param query Query to match against
   * @returns True if instance matches
   */
  matches(instance: ServiceInstance, query: ServiceQuery): boolean
}

/**
 * Change notifier interface
 */
export interface IChangeNotifier {
  /**
   * Subscribe to changes for a service
   * @param serviceName Service name
   * @param callback Change callback
   * @returns Subscription ID
   */
  subscribe(serviceName: string, callback: WatchCallback): string

  /**
   * Unsubscribe from changes
   * @param subscriptionId Subscription ID
   */
  unsubscribe(subscriptionId: string): void

  /**
   * Emit a change event
   * @param event Change event
   */
  emit(event: ServiceChangeEvent): void
}

/**
 * Service cache interface
 */
export interface IServiceCache {
  /**
   * Get cached instances for a service
   * @param serviceName Service name
   * @returns Cached instances or null if not cached
   */
  get(serviceName: string): ServiceInstance[] | null

  /**
   * Set cached instances for a service
   * @param serviceName Service name
   * @param instances Instances to cache
   * @param ttl Cache TTL in milliseconds
   */
  set(serviceName: string, instances: ServiceInstance[], ttl?: number): void

  /**
   * Invalidate cache for a service
   * @param serviceName Service name
   */
  invalidate(serviceName: string): void

  /**
   * Clear all cached data
   */
  clear(): void
}

/**
 * Storage adapter interface for persistence
 */
export interface ServiceRegistryStorage {
  /** Get value by key */
  get<T>(key: string): Promise<T | null>
  /** Set value with optional TTL in milliseconds */
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  /** Delete a key */
  delete(key: string): Promise<void>
  /** List keys by prefix */
  list(prefix: string): Promise<string[]>
  /** Get all values matching a prefix */
  getAll<T>(prefix: string): Promise<T[]>
}

/**
 * In-memory storage entry
 */
export interface MemoryStorageEntry<T> {
  value: T
  expiresAt?: number
}
