/**
 * ServiceRegistry - Service Discovery Primitives
 *
 * Provides comprehensive service discovery:
 * - Service registration and deregistration
 * - Service discovery with query matching
 * - Load balancing (round-robin, random, weighted, least-connections)
 * - Health monitoring and heartbeats
 * - TTL-based auto-deregistration
 * - Change notifications via watchers
 */

export * from './types'

import type {
  Service,
  ServiceInstance,
  ServiceQuery,
  HealthStatus,
  LoadBalancerStrategy,
  RegistrationOptions,
  ServiceChangeEvent,
  WatchCallback,
  WatchHandle,
  HeartbeatConfig,
  IServiceRegistry,
  ILoadBalancer,
  IHealthMonitor,
  IServiceMatcher,
  ITTLManager,
  IChangeNotifier,
  IServiceCache,
  ServiceRegistryStorage,
  MemoryStorageEntry,
  EndpointResult,
} from './types'

// =============================================================================
// Memory Storage Implementation
// =============================================================================

/**
 * In-memory storage implementation for service registry
 */
export class MemoryStorage implements ServiceRegistryStorage {
  private store = new Map<string, MemoryStorageEntry<unknown>>()

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key)
    if (!entry) return null

    // Check TTL expiration
    if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      this.store.delete(key)
      return null
    }

    return entry.value as T
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const entry: MemoryStorageEntry<T> = {
      value,
      expiresAt: ttl ? Date.now() + ttl : undefined,
    }
    this.store.set(key, entry)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = []
    this.store.forEach((entry, key) => {
      if (key.startsWith(prefix)) {
        // Check expiration before including
        if (entry.expiresAt === undefined || Date.now() < entry.expiresAt) {
          keys.push(key)
        }
      }
    })
    return keys
  }

  async getAll<T>(prefix: string): Promise<T[]> {
    const values: T[] = []
    this.store.forEach((entry, key) => {
      if (key.startsWith(prefix)) {
        // Check expiration before including
        if (entry.expiresAt === undefined || Date.now() < entry.expiresAt) {
          values.push(entry.value as T)
        }
      }
    })
    return values
  }
}

// =============================================================================
// LoadBalancer Implementation
// =============================================================================

/**
 * Load balancer for distributing requests across service instances
 */
export class LoadBalancer implements ILoadBalancer {
  private roundRobinIndexes = new Map<string, number>()
  private connections = new Map<string, number>()

  select(instances: ServiceInstance[], strategy: LoadBalancerStrategy): ServiceInstance | null {
    if (instances.length === 0) return null

    switch (strategy) {
      case 'round-robin':
        return this.selectRoundRobin(instances)
      case 'random':
        return this.selectRandom(instances)
      case 'weighted':
        return this.selectWeighted(instances)
      case 'least-connections':
        return this.selectLeastConnections(instances)
      default:
        return this.selectRoundRobin(instances)
    }
  }

  private selectRoundRobin(instances: ServiceInstance[]): ServiceInstance {
    // Get a service key from the first instance
    const serviceKey = instances[0]?.serviceId || 'default'
    const currentIndex = this.roundRobinIndexes.get(serviceKey) ?? 0
    const instance = instances[currentIndex % instances.length]
    this.roundRobinIndexes.set(serviceKey, (currentIndex + 1) % instances.length)
    return instance
  }

  private selectRandom(instances: ServiceInstance[]): ServiceInstance {
    const index = Math.floor(Math.random() * instances.length)
    return instances[index]
  }

  private selectWeighted(instances: ServiceInstance[]): ServiceInstance {
    const totalWeight = instances.reduce((sum, inst) => sum + inst.weight, 0)
    if (totalWeight === 0) return instances[0]

    let random = Math.random() * totalWeight
    for (const instance of instances) {
      random -= instance.weight
      if (random <= 0) {
        return instance
      }
    }
    return instances[instances.length - 1]
  }

  private selectLeastConnections(instances: ServiceInstance[]): ServiceInstance {
    return instances.reduce((min, inst) => {
      const minConn = min.activeConnections ?? 0
      const instConn = inst.activeConnections ?? 0
      return instConn < minConn ? inst : min
    }, instances[0])
  }

  connect(instanceId: string): void {
    const current = this.connections.get(instanceId) ?? 0
    this.connections.set(instanceId, current + 1)
  }

  disconnect(instanceId: string): void {
    const current = this.connections.get(instanceId) ?? 0
    this.connections.set(instanceId, Math.max(0, current - 1))
  }

  resetIndex(serviceName: string): void {
    this.roundRobinIndexes.delete(serviceName)
  }

  getConnectionCount(instanceId: string): number {
    return this.connections.get(instanceId) ?? 0
  }
}

// =============================================================================
// HealthMonitor Implementation
// =============================================================================

/**
 * Health monitor for tracking service instance health
 */
export class HealthMonitor implements IHealthMonitor {
  private healthStatuses = new Map<string, HealthStatus>()

  constructor(private storage: ServiceRegistryStorage) {}

  async updateStatus(instanceId: string, status: HealthStatus): Promise<void> {
    this.healthStatuses.set(instanceId, status)
    await this.storage.set(`health:${instanceId}`, status)
  }

  async getStatus(instanceId: string): Promise<HealthStatus> {
    const status = this.healthStatuses.get(instanceId)
    if (status) return status

    const stored = await this.storage.get<HealthStatus>(`health:${instanceId}`)
    return stored ?? 'unknown'
  }

  startMonitoring(instance: ServiceInstance, config: HeartbeatConfig): void {
    // Placeholder - actual health checking would involve HTTP calls or TCP checks
  }

  stopMonitoring(instanceId: string): void {
    this.healthStatuses.delete(instanceId)
  }
}

// =============================================================================
// ServiceMatcher Implementation
// =============================================================================

/**
 * Service matcher for query-based instance filtering
 */
export class ServiceMatcher implements IServiceMatcher {
  matches(instance: ServiceInstance, query: ServiceQuery): boolean {
    // Match by name (checks if serviceId starts with the name)
    if (query.name !== undefined) {
      if (!instance.serviceId.toLowerCase().includes(query.name.toLowerCase())) {
        return false
      }
    }

    // Match by version
    if (query.version !== undefined) {
      const instanceVersion = (instance.metadata?.version as string) ?? ''
      // Support both exact match and semver range (simplified)
      if (query.version.startsWith('^') || query.version.startsWith('~')) {
        // Simplified semver range matching - just check major version for ^
        const rangeVersion = query.version.slice(1)
        const rangeMajor = rangeVersion.split('.')[0]
        const instanceMajor = instanceVersion.split('.')[0]
        if (rangeMajor !== instanceMajor) {
          return false
        }
      } else if (instanceVersion !== query.version) {
        return false
      }
    }

    // Match by tags (all tags must be present)
    if (query.tags !== undefined && query.tags.length > 0) {
      const instanceTags = instance.tags ?? []
      for (const tag of query.tags) {
        if (!instanceTags.includes(tag)) {
          return false
        }
      }
    }

    // Match by health status
    if (query.status !== undefined) {
      if (instance.status !== query.status) {
        return false
      }
    }

    return true
  }
}

// =============================================================================
// TTLManager Implementation
// =============================================================================

/**
 * TTL manager for auto-deregistration of expired instances
 */
export class TTLManager implements ITTLManager {
  private ttls = new Map<string, { ttl: number; startTime: number; timeout: ReturnType<typeof setTimeout> }>()
  private expireCallback?: (instanceId: string) => void

  setTTL(instanceId: string, ttl: number): void {
    this.remove(instanceId) // Clear existing timer

    const startTime = Date.now()
    const timeout = setTimeout(() => {
      this.ttls.delete(instanceId)
      this.expireCallback?.(instanceId)
    }, ttl)

    this.ttls.set(instanceId, { ttl, startTime, timeout })
  }

  refresh(instanceId: string): void {
    const entry = this.ttls.get(instanceId)
    if (entry) {
      clearTimeout(entry.timeout)
      this.setTTL(instanceId, entry.ttl)
    }
  }

  remove(instanceId: string): void {
    const entry = this.ttls.get(instanceId)
    if (entry) {
      clearTimeout(entry.timeout)
      this.ttls.delete(instanceId)
    }
  }

  onExpire(callback: (instanceId: string) => void): void {
    this.expireCallback = callback
  }
}

// =============================================================================
// ChangeNotifier Implementation
// =============================================================================

/**
 * Change notifier for service change events
 */
export class ChangeNotifier implements IChangeNotifier {
  private subscriptions = new Map<string, { serviceName: string; callback: WatchCallback }>()
  private idCounter = 0

  subscribe(serviceName: string, callback: WatchCallback): string {
    const id = `sub-${++this.idCounter}`
    this.subscriptions.set(id, { serviceName, callback })
    return id
  }

  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId)
  }

  emit(event: ServiceChangeEvent): void {
    this.subscriptions.forEach(({ serviceName, callback }) => {
      if (serviceName === event.serviceName) {
        callback(event)
      }
    })
  }
}

// =============================================================================
// ServiceCache Implementation
// =============================================================================

/**
 * Service cache for caching discovered instances
 */
export class ServiceCache implements IServiceCache {
  private cache = new Map<string, { instances: ServiceInstance[]; expiresAt?: number }>()

  get(serviceName: string): ServiceInstance[] | null {
    const entry = this.cache.get(serviceName)
    if (!entry) return null

    if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      this.cache.delete(serviceName)
      return null
    }

    return entry.instances
  }

  set(serviceName: string, instances: ServiceInstance[], ttl?: number): void {
    this.cache.set(serviceName, {
      instances,
      expiresAt: ttl ? Date.now() + ttl : undefined,
    })
  }

  invalidate(serviceName: string): void {
    this.cache.delete(serviceName)
  }

  clear(): void {
    this.cache.clear()
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse endpoint URL to extract host and port
 */
function parseEndpoint(endpoint: string): { host: string; port: number } {
  try {
    const url = new URL(endpoint)
    return {
      host: url.hostname,
      port: url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80),
    }
  } catch {
    // Fallback parsing for non-URL formats
    const match = endpoint.match(/([^:]+):(\d+)/)
    if (match) {
      return { host: match[1], port: parseInt(match[2], 10) }
    }
    return { host: endpoint, port: 80 }
  }
}

/**
 * Generate a unique instance ID
 */
function generateInstanceId(): string {
  return `inst-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

// =============================================================================
// ServiceRegistry Implementation
// =============================================================================

/**
 * Service registry for service discovery and management
 */
export class ServiceRegistry implements IServiceRegistry {
  private storage: ServiceRegistryStorage
  private loadBalancer: LoadBalancer
  private healthMonitor: HealthMonitor
  private matcher: ServiceMatcher
  private ttlManager: TTLManager
  private notifier: ChangeNotifier
  private cache: ServiceCache
  private instances = new Map<string, ServiceInstance>()
  private serviceInstances = new Map<string, Set<string>>() // serviceName -> instanceIds
  private instanceTTLs = new Map<string, number>() // instanceId -> ttl

  constructor(storage?: ServiceRegistryStorage) {
    this.storage = storage ?? new MemoryStorage()
    this.loadBalancer = new LoadBalancer()
    this.healthMonitor = new HealthMonitor(this.storage)
    this.matcher = new ServiceMatcher()
    this.ttlManager = new TTLManager()
    this.notifier = new ChangeNotifier()
    this.cache = new ServiceCache()

    // Setup TTL expiration callback
    this.ttlManager.onExpire((instanceId) => {
      this.deregister(instanceId)
    })
  }

  async register(service: Service, options?: RegistrationOptions): Promise<ServiceInstance> {
    const { host, port } = parseEndpoint(service.endpoints[0] || 'localhost:80')

    const instance: ServiceInstance = {
      id: generateInstanceId(),
      serviceId: service.id,
      host,
      port,
      status: options?.initialStatus ?? 'unknown',
      weight: options?.weight ?? 1,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
      tags: [...(service.tags ?? []), ...(options?.tags ?? [])],
      metadata: { ...service.metadata, ...options?.metadata, version: service.version },
      activeConnections: 0,
    }

    // Store the instance
    this.instances.set(instance.id, instance)
    await this.storage.set(`instance:${instance.id}`, instance)

    // Track by service name
    const serviceName = this.getServiceName(service.id)
    if (!this.serviceInstances.has(serviceName)) {
      this.serviceInstances.set(serviceName, new Set())
    }
    this.serviceInstances.get(serviceName)!.add(instance.id)

    // Setup TTL if specified
    if (options?.ttl) {
      this.instanceTTLs.set(instance.id, options.ttl)
      this.ttlManager.setTTL(instance.id, options.ttl)
    }

    // Invalidate cache
    this.cache.invalidate(serviceName)

    // Emit registration event
    this.notifier.emit({
      type: 'registered',
      serviceName,
      instance,
      timestamp: Date.now(),
    })

    return instance
  }

  async deregister(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId)
    if (!instance) return

    const serviceName = this.getServiceName(instance.serviceId)

    // Remove from storage
    this.instances.delete(instanceId)
    await this.storage.delete(`instance:${instanceId}`)

    // Remove from service tracking
    this.serviceInstances.get(serviceName)?.delete(instanceId)

    // Remove TTL tracking
    this.ttlManager.remove(instanceId)
    this.instanceTTLs.delete(instanceId)

    // Invalidate cache
    this.cache.invalidate(serviceName)

    // Emit deregistration event
    this.notifier.emit({
      type: 'deregistered',
      serviceName,
      instance,
      timestamp: Date.now(),
    })
  }

  async discover(query: ServiceQuery): Promise<ServiceInstance[]> {
    const allInstances = Array.from(this.instances.values())

    let filtered = allInstances.filter(instance => this.matcher.matches(instance, {
      ...query,
      name: query.name ? query.name : undefined,
    }))

    // Apply limit
    if (query.limit !== undefined && query.limit > 0) {
      filtered = filtered.slice(0, query.limit)
    }

    return filtered
  }

  async getEndpoint(serviceName: string, strategy: LoadBalancerStrategy = 'round-robin'): Promise<EndpointResult | null> {
    // Get healthy instances for the service
    const instances = await this.discover({
      name: serviceName,
      status: 'healthy',
    })

    if (instances.length === 0) return null

    // Apply load balancing
    const selected = this.loadBalancer.select(instances, strategy)
    if (!selected) return null

    return {
      instance: selected,
      endpoint: `http://${selected.host}:${selected.port}`,
    }
  }

  async heartbeat(instanceId: string): Promise<ServiceInstance> {
    const instance = this.instances.get(instanceId)
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`)
    }

    // Update heartbeat timestamp
    instance.lastHeartbeat = Date.now()
    instance.status = 'healthy'

    // Refresh TTL if configured
    const ttl = this.instanceTTLs.get(instanceId)
    if (ttl) {
      this.ttlManager.refresh(instanceId)
    }

    // Update storage
    await this.storage.set(`instance:${instanceId}`, instance)

    return instance
  }

  async updateHealth(instanceId: string, status: HealthStatus): Promise<void> {
    const instance = this.instances.get(instanceId)
    if (!instance) return

    const previousStatus = instance.status
    instance.status = status

    await this.storage.set(`instance:${instanceId}`, instance)
    await this.healthMonitor.updateStatus(instanceId, status)

    const serviceName = this.getServiceName(instance.serviceId)
    this.cache.invalidate(serviceName)

    // Emit health change event
    if (previousStatus !== status) {
      this.notifier.emit({
        type: 'health-changed',
        serviceName,
        instance,
        previousState: { status: previousStatus },
        timestamp: Date.now(),
      })
    }
  }

  watch(serviceName: string, callback: WatchCallback): WatchHandle {
    const id = this.notifier.subscribe(serviceName, callback)

    return {
      id,
      serviceName,
      unsubscribe: () => this.notifier.unsubscribe(id),
    }
  }

  recordConnection(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (instance) {
      instance.activeConnections = (instance.activeConnections ?? 0) + 1
      this.loadBalancer.connect(instanceId)
    }
  }

  releaseConnection(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (instance) {
      instance.activeConnections = Math.max(0, (instance.activeConnections ?? 0) - 1)
      this.loadBalancer.disconnect(instanceId)
    }
  }

  private getServiceName(serviceId: string): string {
    // Extract service name from serviceId (e.g., 'api-v1' -> 'api')
    return serviceId.split('-')[0]
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a service registry with optional storage
 *
 * @example
 * ```ts
 * const registry = createServiceRegistry()
 *
 * // Register a service
 * const instance = await registry.register({
 *   id: 'api-service',
 *   name: 'api',
 *   version: '1.0.0',
 *   endpoints: ['http://localhost:3000'],
 * })
 *
 * // Discover services
 * const instances = await registry.discover({ name: 'api' })
 *
 * // Get load-balanced endpoint
 * const endpoint = await registry.getEndpoint('api', 'round-robin')
 * ```
 */
export function createServiceRegistry(storage?: ServiceRegistryStorage): ServiceRegistry {
  return new ServiceRegistry(storage ?? new MemoryStorage())
}
