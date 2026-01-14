/**
 * ServiceRegistry Tests - TDD Red-Green-Refactor
 *
 * Comprehensive tests for service discovery primitives
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  ServiceRegistry,
  LoadBalancer,
  HealthMonitor,
  ServiceMatcher,
  TTLManager,
  ChangeNotifier,
  ServiceCache,
  MemoryStorage,
} from './index'
import type {
  Service,
  ServiceInstance,
  ServiceQuery,
  HealthStatus,
  LoadBalancerStrategy,
  RegistrationOptions,
  ServiceChangeEvent,
  HeartbeatConfig,
} from './types'

// =============================================================================
// ServiceRegistry - Register/Deregister Tests
// =============================================================================

describe('ServiceRegistry', () => {
  let storage: MemoryStorage
  let registry: ServiceRegistry

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    storage = new MemoryStorage()
    registry = new ServiceRegistry(storage)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('register', () => {
    it('should register a service instance', async () => {
      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      const instance = await registry.register(service)

      expect(instance).toBeDefined()
      expect(instance.id).toBeDefined()
      expect(instance.serviceId).toBe('api-service')
      expect(instance.host).toBe('localhost')
      expect(instance.port).toBe(3000)
      expect(instance.status).toBe('unknown')
      expect(instance.weight).toBe(1)
      expect(instance.registeredAt).toBe(Date.now())
    })

    it('should register with custom options', async () => {
      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      const options: RegistrationOptions = {
        weight: 5,
        initialStatus: 'healthy',
        tags: ['production', 'us-east'],
        metadata: { zone: 'a' },
      }

      const instance = await registry.register(service, options)

      expect(instance.weight).toBe(5)
      expect(instance.status).toBe('healthy')
      expect(instance.tags).toEqual(['production', 'us-east'])
      expect(instance.metadata?.zone).toBe('a')
      expect(instance.metadata?.version).toBe('1.0.0') // Version is stored in metadata for discovery
    })

    it('should register multiple instances of same service', async () => {
      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      const instance1 = await registry.register(service)

      const service2: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3001'],
      }

      const instance2 = await registry.register(service2)

      expect(instance1.id).not.toBe(instance2.id)
      expect(instance1.port).toBe(3000)
      expect(instance2.port).toBe(3001)
    })

    it('should inherit service tags and metadata', async () => {
      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
        tags: ['core'],
        metadata: { team: 'platform' },
      }

      const instance = await registry.register(service)

      expect(instance.tags).toContain('core')
      expect(instance.metadata?.team).toBe('platform')
      expect(instance.metadata?.version).toBe('1.0.0') // Version is stored in metadata for discovery
    })
  })

  describe('deregister', () => {
    it('should deregister a service instance', async () => {
      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      const instance = await registry.register(service)
      await registry.deregister(instance.id)

      const instances = await registry.discover({ name: 'api' })
      expect(instances).toHaveLength(0)
    })

    it('should not throw when deregistering non-existent instance', async () => {
      await expect(registry.deregister('non-existent')).resolves.not.toThrow()
    })

    it('should only deregister the specified instance', async () => {
      const service1: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      const service2: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3001'],
      }

      const instance1 = await registry.register(service1)
      await registry.register(service2)

      await registry.deregister(instance1.id)

      const instances = await registry.discover({ name: 'api' })
      expect(instances).toHaveLength(1)
      expect(instances[0].port).toBe(3001)
    })
  })

  // =============================================================================
  // Discover Tests
  // =============================================================================

  describe('discover', () => {
    beforeEach(async () => {
      // Register various services
      await registry.register({
        id: 'api-v1',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
        tags: ['production'],
      }, { initialStatus: 'healthy' })

      await registry.register({
        id: 'api-v2',
        name: 'api',
        version: '2.0.0',
        endpoints: ['http://localhost:3001'],
        tags: ['staging'],
      }, { initialStatus: 'healthy' })

      await registry.register({
        id: 'worker-v1',
        name: 'worker',
        version: '1.0.0',
        endpoints: ['http://localhost:4000'],
        tags: ['production'],
      }, { initialStatus: 'healthy' })
    })

    it('should discover by name', async () => {
      const instances = await registry.discover({ name: 'api' })

      expect(instances).toHaveLength(2)
      expect(instances.every(i => i.serviceId.startsWith('api'))).toBe(true)
    })

    it('should discover by version', async () => {
      const instances = await registry.discover({ name: 'api', version: '1.0.0' })

      expect(instances).toHaveLength(1)
      expect(instances[0].serviceId).toBe('api-v1')
    })

    it('should discover with version range', async () => {
      const instances = await registry.discover({ name: 'api', version: '^1.0.0' })

      expect(instances).toHaveLength(1)
      expect(instances[0].serviceId).toBe('api-v1')
    })

    it('should discover by tags', async () => {
      const instances = await registry.discover({ tags: ['production'] })

      expect(instances).toHaveLength(2)
    })

    it('should require all tags when multiple specified', async () => {
      await registry.register({
        id: 'api-multi',
        name: 'api',
        version: '3.0.0',
        endpoints: ['http://localhost:3002'],
        tags: ['production', 'us-east'],
      }, { initialStatus: 'healthy' })

      const instances = await registry.discover({ tags: ['production', 'us-east'] })

      expect(instances).toHaveLength(1)
      expect(instances[0].serviceId).toBe('api-multi')
    })

    it('should filter by health status', async () => {
      await registry.register({
        id: 'api-unhealthy',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3003'],
      }, { initialStatus: 'unhealthy' })

      const healthyInstances = await registry.discover({ name: 'api', status: 'healthy' })
      const unhealthyInstances = await registry.discover({ name: 'api', status: 'unhealthy' })

      expect(healthyInstances).toHaveLength(2)
      expect(unhealthyInstances).toHaveLength(1)
    })

    it('should limit results', async () => {
      const instances = await registry.discover({ limit: 1 })

      expect(instances).toHaveLength(1)
    })

    it('should return empty array when no matches', async () => {
      const instances = await registry.discover({ name: 'non-existent' })

      expect(instances).toHaveLength(0)
    })

    it('should return all instances when no query provided', async () => {
      const instances = await registry.discover({})

      expect(instances).toHaveLength(3)
    })
  })

  // =============================================================================
  // Load Balancing Tests
  // =============================================================================

  describe('getEndpoint', () => {
    beforeEach(async () => {
      await registry.register({
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://host1:3000'],
      }, { initialStatus: 'healthy', weight: 1 })

      await registry.register({
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://host2:3000'],
      }, { initialStatus: 'healthy', weight: 2 })

      await registry.register({
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://host3:3000'],
      }, { initialStatus: 'healthy', weight: 1 })
    })

    it('should return null when no instances available', async () => {
      const result = await registry.getEndpoint('non-existent')

      expect(result).toBeNull()
    })

    it('should use round-robin by default', async () => {
      const endpoints: string[] = []

      for (let i = 0; i < 6; i++) {
        const result = await registry.getEndpoint('api')
        if (result) endpoints.push(result.endpoint)
      }

      // Should cycle through all three hosts twice
      expect(endpoints).toHaveLength(6)
      // Verify round-robin pattern (each host appears twice)
      const host1Count = endpoints.filter(e => e.includes('host1')).length
      const host2Count = endpoints.filter(e => e.includes('host2')).length
      const host3Count = endpoints.filter(e => e.includes('host3')).length
      expect(host1Count).toBe(2)
      expect(host2Count).toBe(2)
      expect(host3Count).toBe(2)
    })

    it('should support random load balancing', async () => {
      // Mock Math.random for deterministic testing
      vi.spyOn(Math, 'random').mockReturnValue(0.5)

      const result = await registry.getEndpoint('api', 'random')

      expect(result).not.toBeNull()
      expect(result?.endpoint).toBeDefined()

      vi.restoreAllMocks()
    })

    it('should support weighted load balancing', async () => {
      const endpoints: string[] = []

      // Get many endpoints to verify distribution
      for (let i = 0; i < 100; i++) {
        const result = await registry.getEndpoint('api', 'weighted')
        if (result) endpoints.push(result.endpoint)
      }

      // host2 has weight 2, others have weight 1
      // host2 should get roughly 50% of traffic
      const host2Count = endpoints.filter(e => e.includes('host2')).length
      expect(host2Count).toBeGreaterThan(30) // Allow some variance
      expect(host2Count).toBeLessThan(70)
    })

    it('should support least-connections load balancing', async () => {
      // Simulate connections
      const result1 = await registry.getEndpoint('api', 'least-connections')
      expect(result1).not.toBeNull()

      // Mark this instance as having a connection
      registry.recordConnection(result1!.instance.id)

      // Next request should go to a different instance
      const result2 = await registry.getEndpoint('api', 'least-connections')
      expect(result2).not.toBeNull()
      expect(result2?.instance.id).not.toBe(result1?.instance.id)
    })

    it('should skip unhealthy instances', async () => {
      // Register an unhealthy instance
      const unhealthyInstance = await registry.register({
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://unhealthy:3000'],
      }, { initialStatus: 'unhealthy' })

      const endpoints: string[] = []

      for (let i = 0; i < 10; i++) {
        const result = await registry.getEndpoint('api')
        if (result) endpoints.push(result.endpoint)
      }

      // Unhealthy instance should never be selected
      expect(endpoints.every(e => !e.includes('unhealthy'))).toBe(true)
    })
  })

  // =============================================================================
  // Health Status Tests
  // =============================================================================

  describe('health status', () => {
    it('should update instance health status', async () => {
      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      const instance = await registry.register(service, { initialStatus: 'unknown' })
      expect(instance.status).toBe('unknown')

      await registry.updateHealth(instance.id, 'healthy')

      const instances = await registry.discover({ name: 'api' })
      expect(instances[0].status).toBe('healthy')
    })

    it('should track health transitions', async () => {
      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      const instance = await registry.register(service, { initialStatus: 'healthy' })

      await registry.updateHealth(instance.id, 'unhealthy')
      await registry.updateHealth(instance.id, 'healthy')

      const instances = await registry.discover({ name: 'api' })
      expect(instances[0].status).toBe('healthy')
    })
  })

  // =============================================================================
  // Heartbeat and TTL Tests
  // =============================================================================

  describe('heartbeat', () => {
    it('should update lastHeartbeat timestamp', async () => {
      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      const instance = await registry.register(service)
      const initialHeartbeat = instance.lastHeartbeat

      vi.advanceTimersByTime(5000)

      const updated = await registry.heartbeat(instance.id)

      expect(updated.lastHeartbeat).toBe(initialHeartbeat + 5000)
    })

    it('should mark instance as healthy on heartbeat', async () => {
      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      const instance = await registry.register(service, { initialStatus: 'unknown' })

      const updated = await registry.heartbeat(instance.id)

      expect(updated.status).toBe('healthy')
    })

    it('should throw for non-existent instance', async () => {
      await expect(registry.heartbeat('non-existent')).rejects.toThrow()
    })
  })

  describe('TTL auto-deregistration', () => {
    it('should auto-deregister instance after TTL expires', async () => {
      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      await registry.register(service, { ttl: 10000 }) // 10 second TTL

      // Before TTL expires
      let instances = await registry.discover({ name: 'api' })
      expect(instances).toHaveLength(1)

      // After TTL expires
      vi.advanceTimersByTime(10001)

      instances = await registry.discover({ name: 'api' })
      expect(instances).toHaveLength(0)
    })

    it('should refresh TTL on heartbeat', async () => {
      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      const instance = await registry.register(service, { ttl: 10000 })

      // Advance 8 seconds
      vi.advanceTimersByTime(8000)

      // Send heartbeat - should refresh TTL
      await registry.heartbeat(instance.id)

      // Advance another 8 seconds
      vi.advanceTimersByTime(8000)

      // Should still be registered (TTL refreshed)
      const instances = await registry.discover({ name: 'api' })
      expect(instances).toHaveLength(1)
    })

    it('should not auto-deregister if no TTL set', async () => {
      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      await registry.register(service) // No TTL

      vi.advanceTimersByTime(1000000) // Advance 1000 seconds

      const instances = await registry.discover({ name: 'api' })
      expect(instances).toHaveLength(1)
    })
  })

  // =============================================================================
  // Watch and Change Notifications Tests
  // =============================================================================

  describe('watch', () => {
    it('should notify on registration', async () => {
      const events: ServiceChangeEvent[] = []

      const handle = registry.watch('api', (event) => {
        events.push(event)
      })

      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      await registry.register(service)

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('registered')
      expect(events[0].serviceName).toBe('api')

      handle.unsubscribe()
    })

    it('should notify on deregistration', async () => {
      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      const instance = await registry.register(service)

      const events: ServiceChangeEvent[] = []
      const handle = registry.watch('api', (event) => {
        events.push(event)
      })

      await registry.deregister(instance.id)

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('deregistered')

      handle.unsubscribe()
    })

    it('should notify on health change', async () => {
      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      const instance = await registry.register(service, { initialStatus: 'healthy' })

      const events: ServiceChangeEvent[] = []
      const handle = registry.watch('api', (event) => {
        events.push(event)
      })

      await registry.updateHealth(instance.id, 'unhealthy')

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('health-changed')
      expect(events[0].previousState?.status).toBe('healthy')
      expect(events[0].instance.status).toBe('unhealthy')

      handle.unsubscribe()
    })

    it('should not notify after unsubscribe', async () => {
      const events: ServiceChangeEvent[] = []

      const handle = registry.watch('api', (event) => {
        events.push(event)
      })

      handle.unsubscribe()

      const service: Service = {
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      }

      await registry.register(service)

      expect(events).toHaveLength(0)
    })

    it('should only notify watchers for matching service', async () => {
      const apiEvents: ServiceChangeEvent[] = []
      const workerEvents: ServiceChangeEvent[] = []

      const apiHandle = registry.watch('api', (event) => {
        apiEvents.push(event)
      })

      const workerHandle = registry.watch('worker', (event) => {
        workerEvents.push(event)
      })

      await registry.register({
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      })

      expect(apiEvents).toHaveLength(1)
      expect(workerEvents).toHaveLength(0)

      apiHandle.unsubscribe()
      workerHandle.unsubscribe()
    })
  })

  // =============================================================================
  // Multiple Instances Tests
  // =============================================================================

  describe('multiple instances', () => {
    it('should handle multiple instances of same service', async () => {
      for (let i = 0; i < 5; i++) {
        await registry.register({
          id: 'api-service',
          name: 'api',
          version: '1.0.0',
          endpoints: [`http://host${i}:3000`],
        }, { initialStatus: 'healthy' })
      }

      const instances = await registry.discover({ name: 'api' })
      expect(instances).toHaveLength(5)
    })

    it('should handle multiple services', async () => {
      await registry.register({
        id: 'api',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://localhost:3000'],
      })

      await registry.register({
        id: 'worker',
        name: 'worker',
        version: '1.0.0',
        endpoints: ['http://localhost:4000'],
      })

      await registry.register({
        id: 'scheduler',
        name: 'scheduler',
        version: '1.0.0',
        endpoints: ['http://localhost:5000'],
      })

      const allInstances = await registry.discover({})
      expect(allInstances).toHaveLength(3)

      const apiInstances = await registry.discover({ name: 'api' })
      expect(apiInstances).toHaveLength(1)
    })
  })

  // =============================================================================
  // Weighted Routing Tests
  // =============================================================================

  describe('weighted routing', () => {
    it('should respect weights in distribution', async () => {
      await registry.register({
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://heavy:3000'],
      }, { initialStatus: 'healthy', weight: 10 })

      await registry.register({
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://light:3000'],
      }, { initialStatus: 'healthy', weight: 1 })

      const endpoints: string[] = []
      for (let i = 0; i < 100; i++) {
        const result = await registry.getEndpoint('api', 'weighted')
        if (result) endpoints.push(result.endpoint)
      }

      const heavyCount = endpoints.filter(e => e.includes('heavy')).length
      const lightCount = endpoints.filter(e => e.includes('light')).length

      // Heavy should get roughly 10x more traffic
      expect(heavyCount).toBeGreaterThan(lightCount * 5)
    })

    it('should handle zero weight', async () => {
      await registry.register({
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://active:3000'],
      }, { initialStatus: 'healthy', weight: 1 })

      await registry.register({
        id: 'api-service',
        name: 'api',
        version: '1.0.0',
        endpoints: ['http://draining:3000'],
      }, { initialStatus: 'healthy', weight: 0 })

      const endpoints: string[] = []
      for (let i = 0; i < 10; i++) {
        const result = await registry.getEndpoint('api', 'weighted')
        if (result) endpoints.push(result.endpoint)
      }

      // Zero weight should never be selected
      expect(endpoints.every(e => e.includes('active'))).toBe(true)
    })
  })
})

// =============================================================================
// LoadBalancer Unit Tests
// =============================================================================

describe('LoadBalancer', () => {
  let loadBalancer: LoadBalancer

  beforeEach(() => {
    loadBalancer = new LoadBalancer()
  })

  const createInstances = (count: number, weights?: number[]): ServiceInstance[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `instance-${i}`,
      serviceId: 'test-service',
      host: `host${i}`,
      port: 3000,
      status: 'healthy' as HealthStatus,
      weight: weights?.[i] ?? 1,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
      activeConnections: 0,
    }))
  }

  describe('round-robin', () => {
    it('should cycle through instances', () => {
      const instances = createInstances(3)
      const results: string[] = []

      for (let i = 0; i < 6; i++) {
        const selected = loadBalancer.select(instances, 'round-robin')
        if (selected) results.push(selected.id)
      }

      expect(results).toEqual([
        'instance-0', 'instance-1', 'instance-2',
        'instance-0', 'instance-1', 'instance-2',
      ])
    })

    it('should return null for empty array', () => {
      const result = loadBalancer.select([], 'round-robin')
      expect(result).toBeNull()
    })
  })

  describe('random', () => {
    it('should return a random instance', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)

      const instances = createInstances(3)
      const result = loadBalancer.select(instances, 'random')

      expect(result).toBeDefined()
      expect(result?.id).toBe('instance-1') // 0.5 * 3 = 1.5 -> floor = 1

      vi.restoreAllMocks()
    })
  })

  describe('weighted', () => {
    it('should respect weights in selection', () => {
      const instances = createInstances(2, [9, 1])
      const results: string[] = []

      // Use deterministic random values
      let callCount = 0
      vi.spyOn(Math, 'random').mockImplementation(() => {
        const values = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95]
        return values[callCount++ % values.length]
      })

      for (let i = 0; i < 10; i++) {
        const selected = loadBalancer.select(instances, 'weighted')
        if (selected) results.push(selected.id)
      }

      // With weights 9:1, 9 out of 10 random values (0.05-0.85) should pick instance-0
      const instance0Count = results.filter(id => id === 'instance-0').length
      expect(instance0Count).toBe(9)

      vi.restoreAllMocks()
    })
  })

  describe('least-connections', () => {
    it('should select instance with fewest connections', () => {
      const instances: ServiceInstance[] = [
        { ...createInstances(1)[0], id: 'busy', activeConnections: 10 },
        { ...createInstances(1)[0], id: 'idle', activeConnections: 0 },
        { ...createInstances(1)[0], id: 'moderate', activeConnections: 5 },
      ]

      const result = loadBalancer.select(instances, 'least-connections')

      expect(result?.id).toBe('idle')
    })

    it('should handle tie by selecting first', () => {
      const instances: ServiceInstance[] = [
        { ...createInstances(1)[0], id: 'first', activeConnections: 0 },
        { ...createInstances(1)[0], id: 'second', activeConnections: 0 },
      ]

      const result = loadBalancer.select(instances, 'least-connections')

      expect(result?.id).toBe('first')
    })
  })
})

// =============================================================================
// HealthMonitor Unit Tests
// =============================================================================

describe('HealthMonitor', () => {
  let healthMonitor: HealthMonitor
  let storage: MemoryStorage

  beforeEach(() => {
    vi.useFakeTimers()
    storage = new MemoryStorage()
    healthMonitor = new HealthMonitor(storage)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should update health status', async () => {
    await healthMonitor.updateStatus('instance-1', 'healthy')
    const status = await healthMonitor.getStatus('instance-1')
    expect(status).toBe('healthy')
  })

  it('should return unknown for non-existent instance', async () => {
    const status = await healthMonitor.getStatus('non-existent')
    expect(status).toBe('unknown')
  })
})

// =============================================================================
// ServiceMatcher Unit Tests
// =============================================================================

describe('ServiceMatcher', () => {
  let matcher: ServiceMatcher

  beforeEach(() => {
    matcher = new ServiceMatcher()
  })

  const createInstance = (overrides: Partial<ServiceInstance> = {}): ServiceInstance => ({
    id: 'test-instance',
    serviceId: 'test-service',
    host: 'localhost',
    port: 3000,
    status: 'healthy',
    weight: 1,
    registeredAt: Date.now(),
    lastHeartbeat: Date.now(),
    tags: ['production'],
    ...overrides,
  })

  it('should match by name', () => {
    const instance = createInstance({ serviceId: 'api-service' })

    expect(matcher.matches(instance, { name: 'api' })).toBe(true)
    expect(matcher.matches(instance, { name: 'worker' })).toBe(false)
  })

  it('should match by exact version', () => {
    const instance = createInstance()
    // Version is stored in metadata for matching
    instance.metadata = { version: '1.0.0' }

    expect(matcher.matches(instance, { version: '1.0.0' })).toBe(true)
    expect(matcher.matches(instance, { version: '2.0.0' })).toBe(false)
  })

  it('should match by tags', () => {
    const instance = createInstance({ tags: ['production', 'us-east'] })

    expect(matcher.matches(instance, { tags: ['production'] })).toBe(true)
    expect(matcher.matches(instance, { tags: ['production', 'us-east'] })).toBe(true)
    expect(matcher.matches(instance, { tags: ['staging'] })).toBe(false)
  })

  it('should match by health status', () => {
    const healthyInstance = createInstance({ status: 'healthy' })
    const unhealthyInstance = createInstance({ status: 'unhealthy' })

    expect(matcher.matches(healthyInstance, { status: 'healthy' })).toBe(true)
    expect(matcher.matches(unhealthyInstance, { status: 'healthy' })).toBe(false)
  })

  it('should match all criteria', () => {
    const instance = createInstance({
      serviceId: 'api-service',
      status: 'healthy',
      tags: ['production'],
      metadata: { version: '1.0.0' },
    })

    expect(matcher.matches(instance, {
      name: 'api',
      version: '1.0.0',
      status: 'healthy',
      tags: ['production'],
    })).toBe(true)

    expect(matcher.matches(instance, {
      name: 'api',
      status: 'unhealthy',
    })).toBe(false)
  })
})

// =============================================================================
// TTLManager Unit Tests
// =============================================================================

describe('TTLManager', () => {
  let ttlManager: TTLManager

  beforeEach(() => {
    vi.useFakeTimers()
    ttlManager = new TTLManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should call expire callback when TTL expires', () => {
    const expiredIds: string[] = []
    ttlManager.onExpire((id) => expiredIds.push(id))

    ttlManager.setTTL('instance-1', 5000)

    vi.advanceTimersByTime(5001)

    expect(expiredIds).toContain('instance-1')
  })

  it('should refresh TTL', () => {
    const expiredIds: string[] = []
    ttlManager.onExpire((id) => expiredIds.push(id))

    ttlManager.setTTL('instance-1', 5000)

    vi.advanceTimersByTime(4000)
    ttlManager.refresh('instance-1')

    vi.advanceTimersByTime(4000)
    expect(expiredIds).toHaveLength(0) // Not expired yet

    vi.advanceTimersByTime(2000)
    expect(expiredIds).toContain('instance-1') // Now expired
  })

  it('should remove TTL tracking', () => {
    const expiredIds: string[] = []
    ttlManager.onExpire((id) => expiredIds.push(id))

    ttlManager.setTTL('instance-1', 5000)
    ttlManager.remove('instance-1')

    vi.advanceTimersByTime(10000)

    expect(expiredIds).toHaveLength(0)
  })
})

// =============================================================================
// ChangeNotifier Unit Tests
// =============================================================================

describe('ChangeNotifier', () => {
  let notifier: ChangeNotifier

  beforeEach(() => {
    notifier = new ChangeNotifier()
  })

  it('should emit to subscribers', () => {
    const events: ServiceChangeEvent[] = []

    notifier.subscribe('api', (event) => events.push(event))

    notifier.emit({
      type: 'registered',
      serviceName: 'api',
      instance: {} as ServiceInstance,
      timestamp: Date.now(),
    })

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('registered')
  })

  it('should not emit to unsubscribed', () => {
    const events: ServiceChangeEvent[] = []

    const id = notifier.subscribe('api', (event) => events.push(event))
    notifier.unsubscribe(id)

    notifier.emit({
      type: 'registered',
      serviceName: 'api',
      instance: {} as ServiceInstance,
      timestamp: Date.now(),
    })

    expect(events).toHaveLength(0)
  })

  it('should only emit to matching service subscribers', () => {
    const apiEvents: ServiceChangeEvent[] = []
    const workerEvents: ServiceChangeEvent[] = []

    notifier.subscribe('api', (event) => apiEvents.push(event))
    notifier.subscribe('worker', (event) => workerEvents.push(event))

    notifier.emit({
      type: 'registered',
      serviceName: 'api',
      instance: {} as ServiceInstance,
      timestamp: Date.now(),
    })

    expect(apiEvents).toHaveLength(1)
    expect(workerEvents).toHaveLength(0)
  })
})

// =============================================================================
// ServiceCache Unit Tests
// =============================================================================

describe('ServiceCache', () => {
  let cache: ServiceCache

  beforeEach(() => {
    vi.useFakeTimers()
    cache = new ServiceCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should cache and retrieve instances', () => {
    const instances: ServiceInstance[] = [{
      id: 'instance-1',
      serviceId: 'api',
      host: 'localhost',
      port: 3000,
      status: 'healthy',
      weight: 1,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
    }]

    cache.set('api', instances)

    const cached = cache.get('api')
    expect(cached).toHaveLength(1)
    expect(cached?.[0].id).toBe('instance-1')
  })

  it('should return null for non-cached service', () => {
    const result = cache.get('non-existent')
    expect(result).toBeNull()
  })

  it('should expire cache after TTL', () => {
    const instances: ServiceInstance[] = [{
      id: 'instance-1',
      serviceId: 'api',
      host: 'localhost',
      port: 3000,
      status: 'healthy',
      weight: 1,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
    }]

    cache.set('api', instances, 5000)

    vi.advanceTimersByTime(5001)

    const cached = cache.get('api')
    expect(cached).toBeNull()
  })

  it('should invalidate specific service', () => {
    cache.set('api', [])
    cache.set('worker', [])

    cache.invalidate('api')

    expect(cache.get('api')).toBeNull()
    expect(cache.get('worker')).not.toBeNull()
  })

  it('should clear all cached data', () => {
    cache.set('api', [])
    cache.set('worker', [])

    cache.clear()

    expect(cache.get('api')).toBeNull()
    expect(cache.get('worker')).toBeNull()
  })
})

// =============================================================================
// MemoryStorage Unit Tests
// =============================================================================

describe('MemoryStorage', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    vi.useFakeTimers()
    storage = new MemoryStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should get and set values', async () => {
    await storage.set('key1', { value: 'test' })
    const result = await storage.get<{ value: string }>('key1')
    expect(result?.value).toBe('test')
  })

  it('should return null for missing keys', async () => {
    const result = await storage.get('missing')
    expect(result).toBeNull()
  })

  it('should handle TTL expiration', async () => {
    await storage.set('key1', { value: 'test' }, 1000)

    vi.advanceTimersByTime(500)
    let result = await storage.get('key1')
    expect(result).not.toBeNull()

    vi.advanceTimersByTime(600)
    result = await storage.get('key1')
    expect(result).toBeNull()
  })

  it('should delete keys', async () => {
    await storage.set('key1', { value: 'test' })
    await storage.delete('key1')
    const result = await storage.get('key1')
    expect(result).toBeNull()
  })

  it('should list keys by prefix', async () => {
    await storage.set('service:api:1', {})
    await storage.set('service:api:2', {})
    await storage.set('service:worker:1', {})

    const keys = await storage.list('service:api:')
    expect(keys).toHaveLength(2)
    expect(keys).toContain('service:api:1')
    expect(keys).toContain('service:api:2')
  })

  it('should get all values by prefix', async () => {
    await storage.set('service:api:1', { name: 'api-1' })
    await storage.set('service:api:2', { name: 'api-2' })
    await storage.set('service:worker:1', { name: 'worker-1' })

    const values = await storage.getAll<{ name: string }>('service:api:')
    expect(values).toHaveLength(2)
    expect(values.map(v => v.name).sort()).toEqual(['api-1', 'api-2'])
  })
})
