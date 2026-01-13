/**
 * Graph-Backed Load Balancing Tests
 *
 * TDD RED phase: Tests for load balancing via graph queries.
 *
 * This module implements load balancing strategies using graph queries to:
 * 1. Query worker nodes and their availability status
 * 2. Select workers using round-robin via graph traversal
 * 3. Select workers using least-busy via graph aggregation queries
 * 4. Route tasks based on capability matching via graph relationships
 * 5. Track routing decisions as graph edges for observability
 *
 * @module workers/load-balancing-graph
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { GraphEngine, type Node, type Edge } from '../../db/graph'
import {
  GraphLoadBalancer,
  createGraphRoundRobinBalancer,
  createGraphLeastBusyBalancer,
  createGraphCapabilityBalancer,
  type WorkerNode,
  type TaskRequest,
  type RouteResult,
  type WorkerStatus,
  type LoadBalancerStrategy,
} from '../load-balancing-graph'

// =============================================================================
// TEST SETUP
// =============================================================================

describe('GraphLoadBalancer', () => {
  let graph: GraphEngine
  let balancer: GraphLoadBalancer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    graph = new GraphEngine()
    balancer = new GraphLoadBalancer(graph)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // 1. WORKER REGISTRATION AND STATUS TRACKING
  // ===========================================================================

  describe('Worker Registration', () => {
    it('should register a worker as a graph node', async () => {
      const worker = await balancer.registerWorker({
        id: 'worker-1',
        endpoint: 'http://localhost:3001',
        capabilities: ['compute', 'storage'],
      })

      expect(worker).toBeDefined()
      expect(worker.id).toBe('worker-1')
      expect(worker.status).toBe('available')

      // Verify it's stored in the graph
      const node = await graph.getNode('worker-1')
      expect(node).not.toBeNull()
      expect(node?.label).toBe('Worker')
      expect(node?.properties.endpoint).toBe('http://localhost:3001')
    })

    it('should register multiple workers', async () => {
      await balancer.registerWorker({ id: 'worker-1', endpoint: 'http://localhost:3001' })
      await balancer.registerWorker({ id: 'worker-2', endpoint: 'http://localhost:3002' })
      await balancer.registerWorker({ id: 'worker-3', endpoint: 'http://localhost:3003' })

      const workers = await balancer.getAvailableWorkers()
      expect(workers).toHaveLength(3)
    })

    it('should track worker capabilities as graph relationships', async () => {
      await balancer.registerWorker({
        id: 'worker-1',
        endpoint: 'http://localhost:3001',
        capabilities: ['compute', 'storage'],
      })

      // Capabilities should be represented as relationships
      const computeEdges = await graph.queryEdges({
        from: 'worker-1',
        type: 'HAS_CAPABILITY',
      })

      expect(computeEdges.length).toBeGreaterThanOrEqual(1)
    })

    it('should update worker status', async () => {
      await balancer.registerWorker({ id: 'worker-1', endpoint: 'http://localhost:3001' })

      await balancer.updateWorkerStatus('worker-1', 'busy')

      const node = await graph.getNode('worker-1')
      expect(node?.properties.status).toBe('busy')
    })

    it('should deregister a worker', async () => {
      await balancer.registerWorker({ id: 'worker-1', endpoint: 'http://localhost:3001' })
      await balancer.deregisterWorker('worker-1')

      const node = await graph.getNode('worker-1')
      expect(node).toBeNull()
    })

    it('should track worker load metrics', async () => {
      await balancer.registerWorker({ id: 'worker-1', endpoint: 'http://localhost:3001' })

      await balancer.updateWorkerLoad('worker-1', {
        currentTasks: 5,
        cpuUsage: 0.75,
        memoryUsage: 0.60,
      })

      const node = await graph.getNode('worker-1')
      expect(node?.properties.currentTasks).toBe(5)
      expect(node?.properties.cpuUsage).toBe(0.75)
    })
  })

  // ===========================================================================
  // 2. ROUND-ROBIN LOAD BALANCING VIA GRAPH QUERIES
  // ===========================================================================

  describe('Round-Robin via Graph Queries', () => {
    beforeEach(async () => {
      await balancer.registerWorker({ id: 'worker-1', endpoint: 'http://host1:3000' })
      await balancer.registerWorker({ id: 'worker-2', endpoint: 'http://host2:3000' })
      await balancer.registerWorker({ id: 'worker-3', endpoint: 'http://host3:3000' })
    })

    it('should query available workers from graph', async () => {
      const workers = await balancer.getAvailableWorkers()

      expect(workers).toHaveLength(3)
      expect(workers.every((w) => w.status === 'available')).toBe(true)
    })

    it('should cycle through workers using round-robin', async () => {
      const task: TaskRequest = { id: 'task-1', type: 'compute' }
      const results: string[] = []

      for (let i = 0; i < 6; i++) {
        const result = await balancer.route(task, 'round-robin')
        results.push(result.workerId)
      }

      // Should cycle through all three workers twice
      expect(results).toEqual([
        'worker-1', 'worker-2', 'worker-3',
        'worker-1', 'worker-2', 'worker-3',
      ])
    })

    it('should skip unavailable workers in round-robin', async () => {
      await balancer.updateWorkerStatus('worker-2', 'offline')

      const task: TaskRequest = { id: 'task-1', type: 'compute' }
      const results: string[] = []

      for (let i = 0; i < 4; i++) {
        const result = await balancer.route(task, 'round-robin')
        results.push(result.workerId)
      }

      expect(results).toEqual(['worker-1', 'worker-3', 'worker-1', 'worker-3'])
    })

    it('should query workers using graph query engine', async () => {
      // Verify that the round-robin uses graph queries internally
      const querySpy = vi.spyOn(graph, 'queryNodes')

      await balancer.route({ id: 'task-1', type: 'compute' }, 'round-robin')

      expect(querySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Worker',
          where: expect.objectContaining({
            status: expect.anything(),
          }),
        })
      )
    })

    it('should return null when no workers available', async () => {
      await balancer.updateWorkerStatus('worker-1', 'offline')
      await balancer.updateWorkerStatus('worker-2', 'offline')
      await balancer.updateWorkerStatus('worker-3', 'offline')

      const result = await balancer.route({ id: 'task-1', type: 'compute' }, 'round-robin')

      expect(result.workerId).toBeNull()
    })
  })

  // ===========================================================================
  // 3. LEAST-BUSY LOAD BALANCING VIA GRAPH QUERIES
  // ===========================================================================

  describe('Least-Busy via Graph Queries', () => {
    beforeEach(async () => {
      await balancer.registerWorker({ id: 'worker-1', endpoint: 'http://host1:3000' })
      await balancer.registerWorker({ id: 'worker-2', endpoint: 'http://host2:3000' })
      await balancer.registerWorker({ id: 'worker-3', endpoint: 'http://host3:3000' })
    })

    it('should select worker with lowest current load', async () => {
      await balancer.updateWorkerLoad('worker-1', { currentTasks: 10 })
      await balancer.updateWorkerLoad('worker-2', { currentTasks: 2 })
      await balancer.updateWorkerLoad('worker-3', { currentTasks: 5 })

      const result = await balancer.route({ id: 'task-1', type: 'compute' }, 'least-busy')

      expect(result.workerId).toBe('worker-2')
    })

    it('should use graph query with orderBy for least-busy selection', async () => {
      await balancer.updateWorkerLoad('worker-1', { currentTasks: 10 })
      await balancer.updateWorkerLoad('worker-2', { currentTasks: 2 })
      await balancer.updateWorkerLoad('worker-3', { currentTasks: 5 })

      const querySpy = vi.spyOn(graph, 'queryNodes')

      await balancer.route({ id: 'task-1', type: 'compute' }, 'least-busy')

      expect(querySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { currentTasks: 'asc' },
        })
      )
    })

    it('should consider multiple load metrics for least-busy', async () => {
      await balancer.updateWorkerLoad('worker-1', { currentTasks: 5, cpuUsage: 0.9 })
      await balancer.updateWorkerLoad('worker-2', { currentTasks: 5, cpuUsage: 0.3 })
      await balancer.updateWorkerLoad('worker-3', { currentTasks: 5, cpuUsage: 0.6 })

      // When tasks are equal, use CPU as tiebreaker
      const result = await balancer.route(
        { id: 'task-1', type: 'compute' },
        'least-busy',
        { tiebreaker: 'cpuUsage' }
      )

      expect(result.workerId).toBe('worker-2')
    })

    it('should skip busy workers', async () => {
      await balancer.updateWorkerStatus('worker-1', 'busy')
      await balancer.updateWorkerLoad('worker-2', { currentTasks: 10 })
      await balancer.updateWorkerLoad('worker-3', { currentTasks: 5 })

      const result = await balancer.route({ id: 'task-1', type: 'compute' }, 'least-busy')

      // Should select worker-3 (least busy of available workers)
      expect(result.workerId).toBe('worker-3')
    })

    it('should automatically increment task count on route', async () => {
      await balancer.updateWorkerLoad('worker-1', { currentTasks: 0 })
      await balancer.updateWorkerLoad('worker-2', { currentTasks: 0 })

      const result1 = await balancer.route({ id: 'task-1', type: 'compute' }, 'least-busy')
      const node1 = await graph.getNode(result1.workerId!)

      expect(node1?.properties.currentTasks).toBe(1)
    })
  })

  // ===========================================================================
  // 4. CAPABILITY-BASED ROUTING VIA GRAPH QUERIES
  // ===========================================================================

  describe('Capability-Based Routing via Graph Queries', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'worker-compute',
        endpoint: 'http://compute:3000',
        capabilities: ['compute', 'gpu'],
      })
      await balancer.registerWorker({
        id: 'worker-storage',
        endpoint: 'http://storage:3000',
        capabilities: ['storage', 's3'],
      })
      await balancer.registerWorker({
        id: 'worker-all',
        endpoint: 'http://all:3000',
        capabilities: ['compute', 'storage', 'gpu'],
      })
    })

    it('should route task to worker with required capability', async () => {
      const task: TaskRequest = {
        id: 'task-1',
        type: 'compute',
        requiredCapabilities: ['gpu'],
      }

      const result = await balancer.route(task, 'capability')

      // Only worker-compute and worker-all have gpu capability
      expect(['worker-compute', 'worker-all']).toContain(result.workerId)
    })

    it('should find workers with multiple required capabilities', async () => {
      const task: TaskRequest = {
        id: 'task-1',
        type: 'compute',
        requiredCapabilities: ['compute', 'gpu'],
      }

      const result = await balancer.route(task, 'capability')

      expect(['worker-compute', 'worker-all']).toContain(result.workerId)
    })

    it('should use graph traversal for capability matching', async () => {
      const task: TaskRequest = {
        id: 'task-1',
        type: 'storage',
        requiredCapabilities: ['s3'],
      }

      // Capability matching should use graph pattern matching
      const matchSpy = vi.spyOn(graph, 'match')

      await balancer.route(task, 'capability')

      expect(matchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: expect.stringContaining('HAS_CAPABILITY'),
        })
      )
    })

    it('should return null when no worker has required capability', async () => {
      const task: TaskRequest = {
        id: 'task-1',
        type: 'unknown',
        requiredCapabilities: ['quantum'],
      }

      const result = await balancer.route(task, 'capability')

      expect(result.workerId).toBeNull()
    })

    it('should prefer worker with more matching capabilities', async () => {
      const task: TaskRequest = {
        id: 'task-1',
        type: 'compute',
        requiredCapabilities: ['compute'],
        preferredCapabilities: ['gpu', 'storage'],
      }

      const result = await balancer.route(task, 'capability')

      // worker-all has all three capabilities
      expect(result.workerId).toBe('worker-all')
    })
  })

  // ===========================================================================
  // 5. ROUTING DECISION TRACKING IN GRAPH
  // ===========================================================================

  describe('Routing Decision Tracking', () => {
    beforeEach(async () => {
      await balancer.registerWorker({ id: 'worker-1', endpoint: 'http://host1:3000' })
      await balancer.registerWorker({ id: 'worker-2', endpoint: 'http://host2:3000' })
    })

    it('should store routing decision as graph edge', async () => {
      const task: TaskRequest = { id: 'task-1', type: 'compute' }

      const result = await balancer.route(task, 'round-robin')

      // Check that a ROUTED_TO edge was created
      const edges = await graph.queryEdges({
        type: 'ROUTED_TO',
        to: result.workerId!,
      })

      expect(edges).toHaveLength(1)
      expect(edges[0].properties.taskId).toBe('task-1')
    })

    it('should track routing timestamp', async () => {
      const task: TaskRequest = { id: 'task-1', type: 'compute' }

      await balancer.route(task, 'round-robin')

      const edges = await graph.queryEdges({ type: 'ROUTED_TO' })

      expect(edges[0].properties.routedAt).toBe(Date.now())
    })

    it('should track routing strategy used', async () => {
      const task: TaskRequest = { id: 'task-1', type: 'compute' }

      await balancer.route(task, 'least-busy')

      const edges = await graph.queryEdges({ type: 'ROUTED_TO' })

      expect(edges[0].properties.strategy).toBe('least-busy')
    })

    it('should allow querying routing history for a worker', async () => {
      // Route multiple tasks to workers
      await balancer.route({ id: 'task-1', type: 'compute' }, 'round-robin')
      await balancer.route({ id: 'task-2', type: 'compute' }, 'round-robin')
      await balancer.route({ id: 'task-3', type: 'compute' }, 'round-robin')
      await balancer.route({ id: 'task-4', type: 'compute' }, 'round-robin')

      const worker1History = await balancer.getRoutingHistory('worker-1')

      expect(worker1History.length).toBe(2) // 2 tasks routed to worker-1
    })

    it('should track task completion and update metrics', async () => {
      const task: TaskRequest = { id: 'task-1', type: 'compute' }
      const result = await balancer.route(task, 'round-robin')

      await balancer.completeTask(task.id, result.workerId!)

      // Task count should decrement
      const node = await graph.getNode(result.workerId!)
      expect(node?.properties.currentTasks).toBe(0)

      // Routing edge should be updated with completion time
      const edges = await graph.queryEdges({
        type: 'ROUTED_TO',
        where: { taskId: 'task-1' },
      })
      expect(edges[0].properties.completedAt).toBeDefined()
    })
  })

  // ===========================================================================
  // 6. AVAILABILITY TRACKING IN GRAPH
  // ===========================================================================

  describe('Availability Tracking in Graph', () => {
    beforeEach(async () => {
      await balancer.registerWorker({ id: 'worker-1', endpoint: 'http://host1:3000' })
      await balancer.registerWorker({ id: 'worker-2', endpoint: 'http://host2:3000' })
    })

    it('should track availability status changes as graph edges', async () => {
      await balancer.updateWorkerStatus('worker-1', 'busy')
      await balancer.updateWorkerStatus('worker-1', 'available')
      await balancer.updateWorkerStatus('worker-1', 'offline')

      const statusHistory = await balancer.getStatusHistory('worker-1')

      expect(statusHistory).toHaveLength(3)
      expect(statusHistory[0].status).toBe('busy')
      expect(statusHistory[1].status).toBe('available')
      expect(statusHistory[2].status).toBe('offline')
    })

    it('should automatically mark worker as busy when at capacity', async () => {
      // Create a fresh balancer and graph to avoid interference from beforeEach workers
      const localGraph = new GraphEngine()
      const localBalancer = new GraphLoadBalancer(localGraph)

      await localBalancer.registerWorker({
        id: 'worker-limited',
        endpoint: 'http://limited:3000',
        maxConcurrentTasks: 2,
      })

      await localBalancer.route({ id: 'task-1', type: 'compute' }, 'round-robin')
      await localBalancer.route({ id: 'task-2', type: 'compute' }, 'round-robin')
      // Worker should now be at capacity

      const node = await localGraph.getNode('worker-limited')
      expect(node?.properties.status).toBe('busy')
    })

    it('should track heartbeat timestamps', async () => {
      await balancer.heartbeat('worker-1')

      vi.advanceTimersByTime(5000)

      await balancer.heartbeat('worker-1')

      const node = await graph.getNode('worker-1')
      expect(node?.properties.lastHeartbeat).toBe(Date.now())
    })

    it('should mark workers as offline after heartbeat timeout', async () => {
      // Set heartbeat timeout to 10 seconds
      balancer.setHeartbeatTimeout(10000)

      await balancer.heartbeat('worker-1')

      vi.advanceTimersByTime(11000)

      await balancer.checkHeartbeats()

      const node = await graph.getNode('worker-1')
      expect(node?.properties.status).toBe('offline')
    })
  })

  // ===========================================================================
  // 7. GRAPH AGGREGATION FOR ANALYTICS
  // ===========================================================================

  describe('Graph Aggregation for Analytics', () => {
    beforeEach(async () => {
      await balancer.registerWorker({ id: 'worker-1', endpoint: 'http://host1:3000' })
      await balancer.registerWorker({ id: 'worker-2', endpoint: 'http://host2:3000' })
      await balancer.registerWorker({ id: 'worker-3', endpoint: 'http://host3:3000' })

      // Simulate routing history
      for (let i = 0; i < 10; i++) {
        await balancer.route({ id: `task-${i}`, type: 'compute' }, 'round-robin')
      }
    })

    it('should calculate task distribution across workers', async () => {
      const distribution = await balancer.getTaskDistribution()

      expect(distribution['worker-1']).toBeGreaterThanOrEqual(3)
      expect(distribution['worker-2']).toBeGreaterThanOrEqual(3)
      expect(distribution['worker-3']).toBeGreaterThanOrEqual(3)
    })

    it('should calculate worker utilization metrics', async () => {
      await balancer.updateWorkerLoad('worker-1', { currentTasks: 8, cpuUsage: 0.8 })
      await balancer.updateWorkerLoad('worker-2', { currentTasks: 4, cpuUsage: 0.4 })
      await balancer.updateWorkerLoad('worker-3', { currentTasks: 6, cpuUsage: 0.6 })

      const utilization = await balancer.getClusterUtilization()

      expect(utilization.avgCpuUsage).toBeCloseTo(0.6, 1)
      expect(utilization.totalTasks).toBe(18)
      expect(utilization.workerCount).toBe(3)
    })

    it('should identify hotspots using graph centrality', async () => {
      // Set worker-1 to have high CPU usage to trigger hotspot detection
      await balancer.updateWorkerLoad('worker-1', { cpuUsage: 0.9 })
      await balancer.updateWorkerLoad('worker-2', { cpuUsage: 0.3 })
      await balancer.updateWorkerLoad('worker-3', { cpuUsage: 0.3 })

      const hotspots = await balancer.identifyHotspots()

      expect(hotspots).toContain('worker-1')
    })
  })
})

// =============================================================================
// STANDALONE FACTORY FUNCTION TESTS
// =============================================================================

describe('Graph Load Balancer Factory Functions', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  describe('createGraphRoundRobinBalancer', () => {
    it('should create a round-robin balancer backed by graph', async () => {
      const balancer = createGraphRoundRobinBalancer(graph)

      // Register workers
      await graph.createNode('Worker', { status: 'available' }, { id: 'w1' })
      await graph.createNode('Worker', { status: 'available' }, { id: 'w2' })

      const result1 = await balancer.route({ id: 'task-1', type: 'compute' })
      const result2 = await balancer.route({ id: 'task-2', type: 'compute' })

      expect(result1.workerId).toBe('w1')
      expect(result2.workerId).toBe('w2')
    })
  })

  describe('createGraphLeastBusyBalancer', () => {
    it('should create a least-busy balancer backed by graph', async () => {
      const balancer = createGraphLeastBusyBalancer(graph)

      // Register workers with different loads
      await graph.createNode('Worker', { status: 'available', currentTasks: 10 }, { id: 'w1' })
      await graph.createNode('Worker', { status: 'available', currentTasks: 2 }, { id: 'w2' })

      const result = await balancer.route({ id: 'task-1', type: 'compute' })

      expect(result.workerId).toBe('w2')
    })
  })

  describe('createGraphCapabilityBalancer', () => {
    it('should create a capability balancer backed by graph', async () => {
      const balancer = createGraphCapabilityBalancer(graph)

      // Register workers with capabilities
      const w1 = await graph.createNode('Worker', { status: 'available' }, { id: 'w1' })
      await graph.createNode('Capability', { name: 'gpu' }, { id: 'cap-gpu' })
      await graph.createEdge(w1.id, 'HAS_CAPABILITY', 'cap-gpu')

      const result = await balancer.route({
        id: 'task-1',
        type: 'compute',
        requiredCapabilities: ['gpu'],
      })

      expect(result.workerId).toBe('w1')
    })
  })
})

// =============================================================================
// TDD RED PHASE: Geographic/Affinity-Based Routing
// =============================================================================

describe('Geographic/Affinity-Based Routing via Graph Queries', () => {
  let graph: GraphEngine
  let balancer: GraphLoadBalancer

  beforeEach(() => {
    graph = new GraphEngine()
    balancer = new GraphLoadBalancer(graph)
  })

  describe('Geographic Region Routing', () => {
    beforeEach(async () => {
      // Register workers in different regions as graph nodes with region relationships
      await balancer.registerWorker({
        id: 'worker-us-east-1',
        endpoint: 'http://us-east-1:3000',
        capabilities: ['compute'],
      })
      await balancer.registerWorker({
        id: 'worker-us-west-2',
        endpoint: 'http://us-west-2:3000',
        capabilities: ['compute'],
      })
      await balancer.registerWorker({
        id: 'worker-eu-west-1',
        endpoint: 'http://eu-west-1:3000',
        capabilities: ['compute'],
      })
      await balancer.registerWorker({
        id: 'worker-ap-southeast-1',
        endpoint: 'http://ap-southeast-1:3000',
        capabilities: ['compute'],
      })

      // Set geographic regions for workers via graph relationships
      await balancer.setWorkerRegion('worker-us-east-1', 'us-east-1')
      await balancer.setWorkerRegion('worker-us-west-2', 'us-west-2')
      await balancer.setWorkerRegion('worker-eu-west-1', 'eu-west-1')
      await balancer.setWorkerRegion('worker-ap-southeast-1', 'ap-southeast-1')
    })

    it('should route task to worker in specified region', async () => {
      const task = {
        id: 'task-1',
        type: 'compute',
        region: 'us-east-1',
      }

      const result = await balancer.route(task, 'geographic')

      expect(result.workerId).toBe('worker-us-east-1')
    })

    it('should use graph query to find workers in region', async () => {
      const querySpy = vi.spyOn(graph, 'match')

      await balancer.route(
        { id: 'task-1', type: 'compute', region: 'eu-west-1' },
        'geographic'
      )

      expect(querySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: expect.stringContaining('IN_REGION'),
        })
      )
    })

    it('should find nearest region when exact region unavailable', async () => {
      // Define region proximity relationships in graph
      await balancer.setRegionProximity('us-east-1', 'us-west-2', 50)
      await balancer.setRegionProximity('us-east-1', 'eu-west-1', 100)
      await balancer.setRegionProximity('us-east-1', 'ap-southeast-1', 200)

      // Make us-east-1 worker unavailable
      await balancer.updateWorkerStatus('worker-us-east-1', 'offline')

      const task = {
        id: 'task-1',
        type: 'compute',
        region: 'us-east-1',
      }

      const result = await balancer.route(task, 'geographic')

      // Should route to nearest available region (us-west-2)
      expect(result.workerId).toBe('worker-us-west-2')
    })

    it('should use graph shortest path for region proximity', async () => {
      await balancer.setRegionProximity('us-east-1', 'us-west-2', 50)

      const pathSpy = vi.spyOn(graph, 'shortestPath')

      await balancer.updateWorkerStatus('worker-us-east-1', 'offline')
      await balancer.route(
        { id: 'task-1', type: 'compute', region: 'us-east-1' },
        'geographic'
      )

      expect(pathSpy).toHaveBeenCalled()
    })

    it('should track region routing decisions in graph', async () => {
      await balancer.route(
        { id: 'task-1', type: 'compute', region: 'eu-west-1' },
        'geographic'
      )

      const edges = await graph.queryEdges({
        type: 'ROUTED_TO',
        where: { strategy: 'geographic', requestedRegion: 'eu-west-1' },
      })

      expect(edges).toHaveLength(1)
    })
  })

  describe('Affinity-Based Worker Selection', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'worker-1',
        endpoint: 'http://worker1:3000',
      })
      await balancer.registerWorker({
        id: 'worker-2',
        endpoint: 'http://worker2:3000',
      })
      await balancer.registerWorker({
        id: 'worker-3',
        endpoint: 'http://worker3:3000',
      })
    })

    it('should route task to worker with established affinity', async () => {
      // Create affinity: user-123 prefers worker-2
      await balancer.setAffinity('user-123', 'worker-2')

      const task = {
        id: 'task-1',
        type: 'compute',
        affinityKey: 'user-123',
      }

      const result = await balancer.route(task, 'affinity')

      expect(result.workerId).toBe('worker-2')
    })

    it('should store affinity as graph relationship', async () => {
      await balancer.setAffinity('session-abc', 'worker-1')

      const edges = await graph.queryEdges({
        type: 'HAS_AFFINITY',
        where: { affinityKey: 'session-abc' },
      })

      expect(edges).toHaveLength(1)
      expect(edges[0].to).toBe('worker-1')
    })

    it('should use graph traversal to find affinity relationships', async () => {
      await balancer.setAffinity('tenant-xyz', 'worker-3')

      const matchSpy = vi.spyOn(graph, 'match')

      await balancer.route(
        { id: 'task-1', type: 'compute', affinityKey: 'tenant-xyz' },
        'affinity'
      )

      expect(matchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: expect.stringContaining('HAS_AFFINITY'),
        })
      )
    })

    it('should fallback to least-busy when affinity worker unavailable', async () => {
      await balancer.setAffinity('user-456', 'worker-2')
      await balancer.updateWorkerStatus('worker-2', 'offline')

      // Set different loads
      await balancer.updateWorkerLoad('worker-1', { currentTasks: 10 })
      await balancer.updateWorkerLoad('worker-3', { currentTasks: 2 })

      const result = await balancer.route(
        { id: 'task-1', type: 'compute', affinityKey: 'user-456' },
        'affinity'
      )

      expect(result.workerId).toBe('worker-3')
    })

    it('should create new affinity when none exists', async () => {
      const result = await balancer.route(
        { id: 'task-1', type: 'compute', affinityKey: 'new-user' },
        'affinity'
      )

      // Should have created affinity relationship
      const edges = await graph.queryEdges({
        type: 'HAS_AFFINITY',
        where: { affinityKey: 'new-user' },
      })

      expect(edges).toHaveLength(1)
      expect(edges[0].to).toBe(result.workerId)
    })

    it('should track affinity strength over time', async () => {
      await balancer.setAffinity('user-789', 'worker-1')

      // Route multiple tasks with same affinity
      for (let i = 0; i < 5; i++) {
        await balancer.route(
          { id: `task-${i}`, type: 'compute', affinityKey: 'user-789' },
          'affinity'
        )
      }

      const affinityStrength = await balancer.getAffinityStrength('user-789', 'worker-1')

      expect(affinityStrength).toBe(5)
    })
  })

  describe('Multi-Tenant Isolation Routing', () => {
    beforeEach(async () => {
      // Register workers with tenant isolation
      await balancer.registerWorker({
        id: 'worker-tenant-a',
        endpoint: 'http://tenant-a:3000',
      })
      await balancer.registerWorker({
        id: 'worker-tenant-b',
        endpoint: 'http://tenant-b:3000',
      })
      await balancer.registerWorker({
        id: 'worker-shared',
        endpoint: 'http://shared:3000',
      })

      // Set tenant assignments via graph
      await balancer.assignWorkerToTenant('worker-tenant-a', 'tenant-a')
      await balancer.assignWorkerToTenant('worker-tenant-b', 'tenant-b')
      await balancer.markWorkerAsShared('worker-shared')
    })

    it('should route to tenant-dedicated worker when available', async () => {
      const task = {
        id: 'task-1',
        type: 'compute',
        tenantId: 'tenant-a',
      }

      const result = await balancer.route(task, 'tenant-isolated')

      expect(result.workerId).toBe('worker-tenant-a')
    })

    it('should use graph query for tenant isolation', async () => {
      const matchSpy = vi.spyOn(graph, 'match')

      await balancer.route(
        { id: 'task-1', type: 'compute', tenantId: 'tenant-b' },
        'tenant-isolated'
      )

      expect(matchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: expect.stringContaining('ASSIGNED_TO_TENANT'),
        })
      )
    })

    it('should fallback to shared workers when tenant worker unavailable', async () => {
      await balancer.updateWorkerStatus('worker-tenant-a', 'offline')

      const result = await balancer.route(
        { id: 'task-1', type: 'compute', tenantId: 'tenant-a' },
        'tenant-isolated'
      )

      expect(result.workerId).toBe('worker-shared')
    })

    it('should prevent cross-tenant routing to dedicated workers', async () => {
      const task = {
        id: 'task-1',
        type: 'compute',
        tenantId: 'tenant-a',
      }

      // Make tenant-a worker unavailable
      await balancer.updateWorkerStatus('worker-tenant-a', 'offline')
      await balancer.updateWorkerStatus('worker-shared', 'offline')

      const result = await balancer.route(task, 'tenant-isolated')

      // Should NOT route to worker-tenant-b
      expect(result.workerId).not.toBe('worker-tenant-b')
      expect(result.workerId).toBeNull()
    })
  })
})

// =============================================================================
// TDD RED PHASE: Circuit Breaker Integration
// =============================================================================

describe('Circuit Breaker Integration with Graph Load Balancer', () => {
  let graph: GraphEngine
  let balancer: GraphLoadBalancer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    graph = new GraphEngine()
    balancer = new GraphLoadBalancer(graph)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Worker Circuit Breaker State in Graph', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'worker-1',
        endpoint: 'http://worker1:3000',
      })
      await balancer.registerWorker({
        id: 'worker-2',
        endpoint: 'http://worker2:3000',
      })
      await balancer.registerWorker({
        id: 'worker-3',
        endpoint: 'http://worker3:3000',
      })

      // Configure circuit breaker thresholds
      await balancer.configureCircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 30000,
        halfOpenRequests: 1,
      })
    })

    it('should store circuit breaker state as graph node property', async () => {
      const node = await graph.getNode('worker-1')

      expect(node?.properties.circuitState).toBe('closed')
    })

    it('should open circuit after failure threshold', async () => {
      // Record failures
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')

      const node = await graph.getNode('worker-1')

      expect(node?.properties.circuitState).toBe('open')
    })

    it('should track circuit state changes as graph edges', async () => {
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')

      const edges = await graph.queryEdges({
        type: 'CIRCUIT_STATE_CHANGE',
        from: 'worker-1',
      })

      expect(edges.length).toBeGreaterThan(0)
      expect(edges.some((e) => e.properties.newState === 'open')).toBe(true)
    })

    it('should transition to half-open after reset timeout', async () => {
      // Open the circuit
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')

      // Advance time past reset timeout
      vi.advanceTimersByTime(31000)

      await balancer.checkCircuitBreakers()

      const node = await graph.getNode('worker-1')

      expect(node?.properties.circuitState).toBe('half-open')
    })

    it('should close circuit after successful half-open request', async () => {
      // Open the circuit
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')

      vi.advanceTimersByTime(31000)
      await balancer.checkCircuitBreakers()

      // Record success in half-open state
      await balancer.recordWorkerSuccess('worker-1')

      const node = await graph.getNode('worker-1')

      expect(node?.properties.circuitState).toBe('closed')
    })

    it('should reopen circuit on failure in half-open state', async () => {
      // Open the circuit
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')

      vi.advanceTimersByTime(31000)
      await balancer.checkCircuitBreakers()

      // Record failure in half-open state
      await balancer.recordWorkerFailure('worker-1')

      const node = await graph.getNode('worker-1')

      expect(node?.properties.circuitState).toBe('open')
    })
  })

  describe('Circuit Breaker Aware Routing', () => {
    beforeEach(async () => {
      await balancer.registerWorker({ id: 'worker-1', endpoint: 'http://w1:3000' })
      await balancer.registerWorker({ id: 'worker-2', endpoint: 'http://w2:3000' })
      await balancer.registerWorker({ id: 'worker-3', endpoint: 'http://w3:3000' })

      await balancer.configureCircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 30000,
        halfOpenRequests: 1,
      })
    })

    it('should exclude workers with open circuits from routing', async () => {
      // Open circuit for worker-1
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')

      const task = { id: 'task-1', type: 'compute' }
      const results: string[] = []

      for (let i = 0; i < 10; i++) {
        const result = await balancer.route(task, 'round-robin')
        results.push(result.workerId!)
      }

      expect(results).not.toContain('worker-1')
    })

    it('should use graph query to filter out open circuits', async () => {
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')

      const querySpy = vi.spyOn(graph, 'queryNodes')

      await balancer.route({ id: 'task-1', type: 'compute' }, 'round-robin')

      expect(querySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            circuitState: { $ne: 'open' },
          }),
        })
      )
    })

    it('should allow limited requests to half-open circuits', async () => {
      // Open circuit for worker-1
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')

      vi.advanceTimersByTime(31000)
      await balancer.checkCircuitBreakers()

      // Half-open circuit should receive exactly 1 request
      const result = await balancer.routeWithCircuitBreakerProbe({
        id: 'probe-task',
        type: 'health-check',
      })

      expect(result.workerId).toBe('worker-1')
      expect(result.isProbeRequest).toBe(true)
    })

    it('should track circuit breaker decisions in routing history', async () => {
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')

      await balancer.route({ id: 'task-1', type: 'compute' }, 'round-robin')

      const edges = await graph.queryEdges({
        type: 'ROUTED_TO',
      })

      const routingEdge = edges[0]
      expect(routingEdge?.properties.excludedWorkers).toContain('worker-1')
      expect(routingEdge?.properties.excludedReason).toBe('circuit-open')
    })
  })

  describe('Sliding Window Failure Tracking in Graph', () => {
    beforeEach(async () => {
      await balancer.registerWorker({ id: 'worker-1', endpoint: 'http://w1:3000' })

      await balancer.configureCircuitBreaker({
        failureThreshold: 5,
        resetTimeout: 30000,
        halfOpenRequests: 1,
        slidingWindow: {
          windowSize: 60000, // 1 minute
          minRequests: 3,
        },
      })
    })

    it('should store failure events as graph nodes', async () => {
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')

      const failureNodes = await graph.queryNodes({
        label: 'FailureEvent',
        where: { workerId: 'worker-1' },
      })

      expect(failureNodes).toHaveLength(2)
    })

    it('should use graph query to calculate failure rate in window', async () => {
      // Record failures across time
      await balancer.recordWorkerFailure('worker-1')
      vi.advanceTimersByTime(10000)
      await balancer.recordWorkerSuccess('worker-1')
      vi.advanceTimersByTime(10000)
      await balancer.recordWorkerFailure('worker-1')

      const failureRate = await balancer.getWorkerFailureRate('worker-1', 60000)

      expect(failureRate).toBeCloseTo(0.67, 1) // 2/3
    })

    it('should prune old failure events outside sliding window', async () => {
      await balancer.recordWorkerFailure('worker-1')

      // Advance past sliding window
      vi.advanceTimersByTime(70000)

      await balancer.pruneOldFailureEvents()

      const failureNodes = await graph.queryNodes({
        label: 'FailureEvent',
        where: { workerId: 'worker-1' },
      })

      expect(failureNodes).toHaveLength(0)
    })

    it('should not open circuit below minimum requests', async () => {
      // Only 2 failures, below minRequests of 3
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')

      const node = await graph.getNode('worker-1')

      expect(node?.properties.circuitState).toBe('closed')
    })
  })

  describe('Per-Worker Circuit Breaker Configuration', () => {
    beforeEach(async () => {
      await balancer.registerWorker({ id: 'critical-worker', endpoint: 'http://critical:3000' })
      await balancer.registerWorker({ id: 'standard-worker', endpoint: 'http://standard:3000' })
    })

    it('should support per-worker circuit breaker thresholds', async () => {
      await balancer.configureWorkerCircuitBreaker('critical-worker', {
        failureThreshold: 1, // Very sensitive
        resetTimeout: 60000,
        halfOpenRequests: 3,
      })

      await balancer.configureWorkerCircuitBreaker('standard-worker', {
        failureThreshold: 5, // More tolerant
        resetTimeout: 30000,
        halfOpenRequests: 1,
      })

      // One failure should open critical-worker circuit
      await balancer.recordWorkerFailure('critical-worker')
      const criticalNode = await graph.getNode('critical-worker')
      expect(criticalNode?.properties.circuitState).toBe('open')

      // One failure should not open standard-worker circuit
      await balancer.recordWorkerFailure('standard-worker')
      const standardNode = await graph.getNode('standard-worker')
      expect(standardNode?.properties.circuitState).toBe('closed')
    })

    it('should store circuit breaker config as graph node properties', async () => {
      await balancer.configureWorkerCircuitBreaker('critical-worker', {
        failureThreshold: 2,
        resetTimeout: 45000,
        halfOpenRequests: 2,
      })

      const node = await graph.getNode('critical-worker')

      expect(node?.properties.cbFailureThreshold).toBe(2)
      expect(node?.properties.cbResetTimeout).toBe(45000)
      expect(node?.properties.cbHalfOpenRequests).toBe(2)
    })
  })

  describe('Circuit Breaker Cascading and Dependencies', () => {
    beforeEach(async () => {
      // Create workers with dependencies
      await balancer.registerWorker({ id: 'worker-db', endpoint: 'http://db:3000' })
      await balancer.registerWorker({ id: 'worker-cache', endpoint: 'http://cache:3000' })
      await balancer.registerWorker({ id: 'worker-api', endpoint: 'http://api:3000' })

      // Set up dependencies via graph
      await balancer.setWorkerDependency('worker-api', 'worker-db')
      await balancer.setWorkerDependency('worker-api', 'worker-cache')

      await balancer.configureCircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 30000,
        halfOpenRequests: 1,
      })
    })

    it('should detect worker dependencies via graph traversal', async () => {
      const dependencies = await balancer.getWorkerDependencies('worker-api')

      expect(dependencies).toContain('worker-db')
      expect(dependencies).toContain('worker-cache')
    })

    it('should cascade circuit open to dependent workers', async () => {
      // Open circuit for worker-db (dependency)
      await balancer.recordWorkerFailure('worker-db')
      await balancer.recordWorkerFailure('worker-db')
      await balancer.recordWorkerFailure('worker-db')

      await balancer.propagateCircuitState()

      const apiNode = await graph.getNode('worker-api')

      expect(apiNode?.properties.circuitState).toBe('open')
      expect(apiNode?.properties.circuitOpenReason).toBe('dependency-failure')
    })

    it('should use graph query to find affected workers', async () => {
      const traverseSpy = vi.spyOn(graph, 'traverse')

      await balancer.recordWorkerFailure('worker-db')
      await balancer.recordWorkerFailure('worker-db')
      await balancer.recordWorkerFailure('worker-db')

      await balancer.propagateCircuitState()

      expect(traverseSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          start: 'worker-db',
          direction: 'INCOMING',
        })
      )
    })

    it('should track dependency relationships in routing decisions', async () => {
      await balancer.recordWorkerFailure('worker-db')
      await balancer.recordWorkerFailure('worker-db')
      await balancer.recordWorkerFailure('worker-db')

      await balancer.propagateCircuitState()

      const result = await balancer.route({ id: 'task-1', type: 'compute' }, 'round-robin')

      const edges = await graph.queryEdges({
        type: 'ROUTED_TO',
        where: { taskId: 'task-1' },
      })

      expect(edges[0]?.properties.cascadeExcluded).toContain('worker-api')
    })
  })

  describe('Circuit Breaker Metrics and Analytics', () => {
    beforeEach(async () => {
      await balancer.registerWorker({ id: 'worker-1', endpoint: 'http://w1:3000' })
      await balancer.registerWorker({ id: 'worker-2', endpoint: 'http://w2:3000' })

      await balancer.configureCircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 30000,
        halfOpenRequests: 1,
      })
    })

    it('should aggregate circuit breaker stats across cluster', async () => {
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerSuccess('worker-2')
      await balancer.recordWorkerSuccess('worker-2')

      const stats = await balancer.getCircuitBreakerStats()

      expect(stats.openCircuits).toBe(1)
      expect(stats.closedCircuits).toBe(1)
      expect(stats.totalFailures).toBe(3)
      expect(stats.totalSuccesses).toBe(2)
    })

    it('should calculate circuit trip frequency via graph aggregation', async () => {
      // Trip circuit multiple times
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')

      vi.advanceTimersByTime(31000)
      await balancer.checkCircuitBreakers()
      await balancer.recordWorkerSuccess('worker-1')

      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')

      const tripFrequency = await balancer.getCircuitTripFrequency('worker-1', 3600000)

      expect(tripFrequency).toBe(2)
    })

    it('should identify flapping circuits via graph pattern matching', async () => {
      // Rapidly flip circuit state
      for (let i = 0; i < 5; i++) {
        // Trip circuit
        await balancer.recordWorkerFailure('worker-1')
        await balancer.recordWorkerFailure('worker-1')
        await balancer.recordWorkerFailure('worker-1')

        vi.advanceTimersByTime(31000)
        await balancer.checkCircuitBreakers()

        // Recover
        await balancer.recordWorkerSuccess('worker-1')

        vi.advanceTimersByTime(1000)
      }

      const flappingWorkers = await balancer.identifyFlappingCircuits(5, 300000)

      expect(flappingWorkers).toContain('worker-1')
    })

    it('should calculate mean time to recovery via graph queries', async () => {
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')
      await balancer.recordWorkerFailure('worker-1')

      vi.advanceTimersByTime(45000) // 45 seconds to recover

      await balancer.checkCircuitBreakers()
      await balancer.recordWorkerSuccess('worker-1')

      const mttr = await balancer.getMeanTimeToRecovery('worker-1')

      expect(mttr).toBeGreaterThanOrEqual(45000)
    })
  })
})

// =============================================================================
// TDD RED PHASE: Agent Capacity Tracking via Graph Relationships
// =============================================================================

describe('Agent Capacity Tracking via Graph Relationships', () => {
  let graph: GraphEngine
  let balancer: GraphLoadBalancer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    graph = new GraphEngine()
    balancer = new GraphLoadBalancer(graph)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Capacity Pool Management', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'agent-1',
        endpoint: 'http://agent1:3000',
        maxConcurrentTasks: 5,
      })
      await balancer.registerWorker({
        id: 'agent-2',
        endpoint: 'http://agent2:3000',
        maxConcurrentTasks: 10,
      })
      await balancer.registerWorker({
        id: 'agent-3',
        endpoint: 'http://agent3:3000',
        maxConcurrentTasks: 3,
      })
    })

    it('should track total cluster capacity as graph aggregation', async () => {
      const capacity = await balancer.getTotalClusterCapacity()

      expect(capacity.totalSlots).toBe(18) // 5 + 10 + 3
      expect(capacity.usedSlots).toBe(0)
      expect(capacity.availableSlots).toBe(18)
    })

    it('should store capacity allocation as graph relationship', async () => {
      await balancer.route({ id: 'task-1', type: 'compute' }, 'least-busy')
      await balancer.route({ id: 'task-2', type: 'compute' }, 'least-busy')

      const allocations = await graph.queryEdges({
        type: 'ALLOCATES_CAPACITY',
      })

      expect(allocations.length).toBeGreaterThanOrEqual(2)
    })

    it('should query available capacity using graph filter', async () => {
      // Fill agent-3 to capacity (3 tasks)
      await balancer.updateWorkerLoad('agent-3', { currentTasks: 3 })
      await balancer.updateWorkerStatus('agent-3', 'busy')

      const availableAgents = await balancer.getAgentsWithAvailableCapacity()

      expect(availableAgents).toHaveLength(2)
      expect(availableAgents.map((a) => a.id)).not.toContain('agent-3')
    })

    it('should calculate per-agent utilization percentage via graph', async () => {
      await balancer.updateWorkerLoad('agent-1', { currentTasks: 2 })
      await balancer.updateWorkerLoad('agent-2', { currentTasks: 8 })
      await balancer.updateWorkerLoad('agent-3', { currentTasks: 1 })

      const utilization = await balancer.getAgentUtilization('agent-1')

      expect(utilization).toBeCloseTo(0.4, 2) // 2/5 = 40%
    })

    it('should reserve capacity for high-priority tasks', async () => {
      // Reserve 2 slots on agent-1 for priority tasks
      await balancer.reserveCapacity('agent-1', {
        slots: 2,
        priority: 'high',
        expiresAt: Date.now() + 60000,
      })

      const node = await graph.getNode('agent-1')

      expect(node?.properties.reservedSlots).toBe(2)
    })

    it('should honor capacity reservations during routing', async () => {
      await balancer.reserveCapacity('agent-1', { slots: 4, priority: 'high' })
      await balancer.updateWorkerLoad('agent-1', { currentTasks: 0 })

      // Regular task should not use reserved capacity
      const result = await balancer.route(
        { id: 'task-1', type: 'compute', priority: 1 }, // Low priority
        'least-busy'
      )

      // Should not route to agent-1 because only 1 unreserved slot (5-4=1)
      // and other agents have more capacity
      expect(result.workerId).not.toBe('agent-1')
    })

    it('should track capacity history as graph edges', async () => {
      await balancer.updateWorkerLoad('agent-1', { currentTasks: 2 })
      vi.advanceTimersByTime(5000)
      await balancer.updateWorkerLoad('agent-1', { currentTasks: 5 })
      vi.advanceTimersByTime(5000)
      await balancer.updateWorkerLoad('agent-1', { currentTasks: 3 })

      const history = await balancer.getCapacityHistory('agent-1', 60000)

      expect(history).toHaveLength(3)
      expect(history[0].currentTasks).toBe(2)
      expect(history[1].currentTasks).toBe(5)
      expect(history[2].currentTasks).toBe(3)
    })

    it('should predict capacity exhaustion using graph analytics', async () => {
      // Simulate increasing load over time
      await balancer.updateWorkerLoad('agent-1', { currentTasks: 1 })
      vi.advanceTimersByTime(60000)
      await balancer.updateWorkerLoad('agent-1', { currentTasks: 2 })
      vi.advanceTimersByTime(60000)
      await balancer.updateWorkerLoad('agent-1', { currentTasks: 3 })

      const prediction = await balancer.predictCapacityExhaustion('agent-1')

      expect(prediction.willExhaust).toBe(true)
      expect(prediction.estimatedTime).toBeDefined()
    })
  })

  describe('Dynamic Capacity Scaling', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'scalable-agent',
        endpoint: 'http://scalable:3000',
        maxConcurrentTasks: 5,
      })
    })

    it('should increase agent capacity dynamically', async () => {
      await balancer.scaleAgentCapacity('scalable-agent', { maxConcurrentTasks: 10 })

      const node = await graph.getNode('scalable-agent')

      expect(node?.properties.maxConcurrentTasks).toBe(10)
    })

    it('should track capacity changes as graph events', async () => {
      await balancer.scaleAgentCapacity('scalable-agent', { maxConcurrentTasks: 8 })

      const events = await graph.queryEdges({
        type: 'CAPACITY_CHANGED',
        from: 'scalable-agent',
      })

      expect(events.length).toBeGreaterThanOrEqual(1)
      expect(events[0].properties.previousCapacity).toBe(5)
      expect(events[0].properties.newCapacity).toBe(8)
    })

    it('should not reduce capacity below current usage', async () => {
      await balancer.updateWorkerLoad('scalable-agent', { currentTasks: 4 })

      await expect(
        balancer.scaleAgentCapacity('scalable-agent', { maxConcurrentTasks: 3 })
      ).rejects.toThrow()
    })

    it('should auto-scale based on utilization threshold', async () => {
      await balancer.configureAutoScaling('scalable-agent', {
        scaleUpThreshold: 0.8,
        scaleDownThreshold: 0.2,
        scaleUpIncrement: 2,
        scaleDownIncrement: 1,
        minCapacity: 3,
        maxCapacity: 20,
      })

      // Push utilization to 80%
      await balancer.updateWorkerLoad('scalable-agent', { currentTasks: 4 })

      await balancer.evaluateAutoScaling()

      const node = await graph.getNode('scalable-agent')

      expect(node?.properties.maxConcurrentTasks).toBe(7) // 5 + 2
    })
  })
})

// =============================================================================
// TDD RED PHASE: Automatic Failover Between Agents
// =============================================================================

describe('Automatic Failover Between Agents', () => {
  let graph: GraphEngine
  let balancer: GraphLoadBalancer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    graph = new GraphEngine()
    balancer = new GraphLoadBalancer(graph)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Primary-Secondary Failover', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'primary-agent',
        endpoint: 'http://primary:3000',
        capabilities: ['compute'],
      })
      await balancer.registerWorker({
        id: 'secondary-agent',
        endpoint: 'http://secondary:3000',
        capabilities: ['compute'],
      })
      await balancer.registerWorker({
        id: 'tertiary-agent',
        endpoint: 'http://tertiary:3000',
        capabilities: ['compute'],
      })

      // Configure failover chain
      await balancer.configureFailoverChain('primary-agent', [
        'secondary-agent',
        'tertiary-agent',
      ])
    })

    it('should store failover chain as graph relationships', async () => {
      const edges = await graph.queryEdges({
        type: 'FAILS_OVER_TO',
        from: 'primary-agent',
      })

      expect(edges).toHaveLength(2)
    })

    it('should route to primary agent when available', async () => {
      const result = await balancer.routeWithFailover(
        { id: 'task-1', type: 'compute' },
        'primary-agent'
      )

      expect(result.workerId).toBe('primary-agent')
      expect(result.wasFailover).toBe(false)
    })

    it('should failover to secondary when primary unavailable', async () => {
      await balancer.updateWorkerStatus('primary-agent', 'offline')

      const result = await balancer.routeWithFailover(
        { id: 'task-1', type: 'compute' },
        'primary-agent'
      )

      expect(result.workerId).toBe('secondary-agent')
      expect(result.wasFailover).toBe(true)
      expect(result.failoverFrom).toBe('primary-agent')
    })

    it('should cascade failover through chain', async () => {
      await balancer.updateWorkerStatus('primary-agent', 'offline')
      await balancer.updateWorkerStatus('secondary-agent', 'offline')

      const result = await balancer.routeWithFailover(
        { id: 'task-1', type: 'compute' },
        'primary-agent'
      )

      expect(result.workerId).toBe('tertiary-agent')
      expect(result.failoverChain).toEqual([
        'primary-agent',
        'secondary-agent',
        'tertiary-agent',
      ])
    })

    it('should track failover events in graph', async () => {
      await balancer.updateWorkerStatus('primary-agent', 'offline')

      await balancer.routeWithFailover(
        { id: 'task-1', type: 'compute' },
        'primary-agent'
      )

      const edges = await graph.queryEdges({
        type: 'FAILOVER_EVENT',
      })

      expect(edges).toHaveLength(1)
      expect(edges[0].properties.reason).toBe('primary-offline')
    })

    it('should return to primary after recovery', async () => {
      await balancer.updateWorkerStatus('primary-agent', 'offline')

      // First request fails over
      const result1 = await balancer.routeWithFailover(
        { id: 'task-1', type: 'compute' },
        'primary-agent'
      )
      expect(result1.workerId).toBe('secondary-agent')

      // Primary recovers
      await balancer.updateWorkerStatus('primary-agent', 'available')

      // Next request goes to primary
      const result2 = await balancer.routeWithFailover(
        { id: 'task-2', type: 'compute' },
        'primary-agent'
      )
      expect(result2.workerId).toBe('primary-agent')
    })
  })

  describe('Health Check Based Failover', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'health-agent-1',
        endpoint: 'http://health1:3000',
      })
      await balancer.registerWorker({
        id: 'health-agent-2',
        endpoint: 'http://health2:3000',
      })

      await balancer.configureHealthCheck({
        interval: 5000,
        timeout: 2000,
        unhealthyThreshold: 3,
        healthyThreshold: 2,
      })
    })

    it('should mark agent unhealthy after failed health checks', async () => {
      // Simulate failed health checks
      await balancer.recordHealthCheckResult('health-agent-1', { success: false })
      await balancer.recordHealthCheckResult('health-agent-1', { success: false })
      await balancer.recordHealthCheckResult('health-agent-1', { success: false })

      const node = await graph.getNode('health-agent-1')

      expect(node?.properties.healthStatus).toBe('unhealthy')
    })

    it('should store health check results as graph edges', async () => {
      await balancer.recordHealthCheckResult('health-agent-1', {
        success: true,
        latencyMs: 50,
      })

      const edges = await graph.queryEdges({
        type: 'HEALTH_CHECK',
        from: 'health-agent-1',
      })

      expect(edges).toHaveLength(1)
      expect(edges[0].properties.success).toBe(true)
    })

    it('should exclude unhealthy agents from routing', async () => {
      await balancer.recordHealthCheckResult('health-agent-1', { success: false })
      await balancer.recordHealthCheckResult('health-agent-1', { success: false })
      await balancer.recordHealthCheckResult('health-agent-1', { success: false })

      const result = await balancer.route(
        { id: 'task-1', type: 'compute' },
        'round-robin'
      )

      expect(result.workerId).toBe('health-agent-2')
    })

    it('should recover agent after consecutive healthy checks', async () => {
      // First make unhealthy
      await balancer.recordHealthCheckResult('health-agent-1', { success: false })
      await balancer.recordHealthCheckResult('health-agent-1', { success: false })
      await balancer.recordHealthCheckResult('health-agent-1', { success: false })

      // Then recover
      await balancer.recordHealthCheckResult('health-agent-1', { success: true })
      await balancer.recordHealthCheckResult('health-agent-1', { success: true })

      const node = await graph.getNode('health-agent-1')

      expect(node?.properties.healthStatus).toBe('healthy')
    })

    it('should track health check history for analysis', async () => {
      await balancer.recordHealthCheckResult('health-agent-1', { success: true, latencyMs: 50 })
      vi.advanceTimersByTime(5000)
      await balancer.recordHealthCheckResult('health-agent-1', { success: true, latencyMs: 45 })
      vi.advanceTimersByTime(5000)
      await balancer.recordHealthCheckResult('health-agent-1', { success: false })

      const history = await balancer.getHealthCheckHistory('health-agent-1', 60000)

      expect(history).toHaveLength(3)
      expect(history[2].success).toBe(false)
    })
  })

  describe('Task Reassignment on Failure', () => {
    beforeEach(async () => {
      await balancer.registerWorker({ id: 'worker-a', endpoint: 'http://a:3000' })
      await balancer.registerWorker({ id: 'worker-b', endpoint: 'http://b:3000' })
      await balancer.registerWorker({ id: 'worker-c', endpoint: 'http://c:3000' })
    })

    it('should reassign in-flight tasks when worker fails', async () => {
      // Route some tasks to worker-a
      await balancer.route({ id: 'task-1', type: 'compute' }, 'round-robin')
      await balancer.route({ id: 'task-2', type: 'compute' }, 'round-robin')
      await balancer.route({ id: 'task-3', type: 'compute' }, 'round-robin')

      // Assuming task-1 went to worker-a
      const tasksBefore = await balancer.getInFlightTasks('worker-a')

      // Worker-a fails
      await balancer.handleWorkerFailure('worker-a')

      // Tasks should be reassigned
      const reassignments = await graph.queryEdges({
        type: 'TASK_REASSIGNED',
      })

      expect(reassignments.length).toBeGreaterThan(0)
    })

    it('should track reassignment history', async () => {
      await balancer.route({ id: 'task-1', type: 'compute' }, 'round-robin')
      await balancer.handleWorkerFailure('worker-a')

      const history = await balancer.getTaskReassignmentHistory('task-1')

      expect(history.length).toBeGreaterThanOrEqual(0)
    })

    it('should limit reassignment attempts to prevent infinite loops', async () => {
      await balancer.route({ id: 'task-1', type: 'compute' }, 'round-robin')

      // Fail multiple workers
      await balancer.handleWorkerFailure('worker-a')
      await balancer.handleWorkerFailure('worker-b')
      await balancer.handleWorkerFailure('worker-c')

      const task = await balancer.getTaskStatus('task-1')

      expect(task?.status).toBe('failed')
      expect(task?.failureReason).toContain('max reassignment')
    })

    it('should prioritize task reassignment to similar capability workers', async () => {
      await balancer.registerWorker({
        id: 'gpu-worker',
        endpoint: 'http://gpu:3000',
        capabilities: ['gpu', 'compute'],
      })

      await balancer.route(
        { id: 'gpu-task', type: 'compute', requiredCapabilities: ['gpu'] },
        'capability'
      )

      await balancer.handleWorkerFailure('gpu-worker')

      // Should fail gracefully since no other GPU workers
      const task = await balancer.getTaskStatus('gpu-task')

      expect(task?.status).toBe('pending-reassignment')
    })
  })
})

// =============================================================================
// TDD RED PHASE: Work Distribution Algorithms
// =============================================================================

describe('Work Distribution Algorithms', () => {
  let graph: GraphEngine
  let balancer: GraphLoadBalancer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    graph = new GraphEngine()
    balancer = new GraphLoadBalancer(graph)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Weighted Distribution', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'heavy-worker',
        endpoint: 'http://heavy:3000',
        weight: 3,
      })
      await balancer.registerWorker({
        id: 'medium-worker',
        endpoint: 'http://medium:3000',
        weight: 2,
      })
      await balancer.registerWorker({
        id: 'light-worker',
        endpoint: 'http://light:3000',
        weight: 1,
      })
    })

    it('should distribute tasks according to weights', async () => {
      const distribution: Record<string, number> = {
        'heavy-worker': 0,
        'medium-worker': 0,
        'light-worker': 0,
      }

      // Route 60 tasks
      for (let i = 0; i < 60; i++) {
        const result = await balancer.route({ id: `task-${i}`, type: 'compute' }, 'weighted')
        if (result.workerId) {
          distribution[result.workerId]++
        }
      }

      // Expect roughly 3:2:1 ratio (30:20:10)
      expect(distribution['heavy-worker']).toBeGreaterThan(25)
      expect(distribution['heavy-worker']).toBeLessThan(35)
      expect(distribution['medium-worker']).toBeGreaterThan(15)
      expect(distribution['medium-worker']).toBeLessThan(25)
      expect(distribution['light-worker']).toBeGreaterThan(5)
      expect(distribution['light-worker']).toBeLessThan(15)
    })

    it('should use graph query for weighted selection', async () => {
      const querySpy = vi.spyOn(graph, 'queryNodes')

      await balancer.route({ id: 'task-1', type: 'compute' }, 'weighted')

      expect(querySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Worker',
        })
      )
    })

    it('should dynamically adjust weights based on performance', async () => {
      // Simulate poor performance on heavy-worker
      await balancer.recordTaskCompletion('heavy-worker', {
        duration: 10000,
        success: false,
      })
      await balancer.recordTaskCompletion('heavy-worker', {
        duration: 8000,
        success: false,
      })

      // Trigger weight adjustment
      await balancer.adjustWeightsFromPerformance()

      const node = await graph.getNode('heavy-worker')

      expect(node?.properties.weight).toBeLessThan(3)
    })

    it('should track weight changes in graph', async () => {
      await balancer.setWorkerWeight('heavy-worker', 5)

      const edges = await graph.queryEdges({
        type: 'WEIGHT_CHANGED',
        from: 'heavy-worker',
      })

      expect(edges).toHaveLength(1)
      expect(edges[0].properties.previousWeight).toBe(3)
      expect(edges[0].properties.newWeight).toBe(5)
    })
  })

  describe('Priority-Based Distribution', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'priority-worker-1',
        endpoint: 'http://p1:3000',
      })
      await balancer.registerWorker({
        id: 'priority-worker-2',
        endpoint: 'http://p2:3000',
      })
    })

    it('should prioritize high-priority tasks', async () => {
      // Queue some tasks
      await balancer.queueTask({ id: 'low-1', type: 'compute', priority: 1 })
      await balancer.queueTask({ id: 'high-1', type: 'compute', priority: 10 })
      await balancer.queueTask({ id: 'med-1', type: 'compute', priority: 5 })

      // Process next task
      const next = await balancer.getNextTask()

      expect(next?.id).toBe('high-1')
    })

    it('should store task queue as graph nodes', async () => {
      await balancer.queueTask({ id: 'queued-1', type: 'compute', priority: 5 })

      const taskNodes = await graph.queryNodes({
        label: 'QueuedTask',
        where: { taskId: 'queued-1' },
      })

      expect(taskNodes).toHaveLength(1)
      expect(taskNodes[0].properties.priority).toBe(5)
    })

    it('should prevent priority starvation with aging', async () => {
      // Queue old low-priority task
      await balancer.queueTask({ id: 'old-low', type: 'compute', priority: 1 })

      vi.advanceTimersByTime(60000) // Age for 1 minute

      // Queue new high-priority task
      await balancer.queueTask({ id: 'new-high', type: 'compute', priority: 10 })

      // Apply aging to increase priority of old tasks
      await balancer.applyPriorityAging({ agingRate: 0.1 })

      const task = await balancer.getQueuedTask('old-low')

      expect(task?.effectivePriority).toBeGreaterThan(1)
    })

    it('should query priority queue using graph orderBy', async () => {
      await balancer.queueTask({ id: 'task-1', type: 'compute', priority: 1 })
      await balancer.queueTask({ id: 'task-2', type: 'compute', priority: 5 })

      const querySpy = vi.spyOn(graph, 'queryNodes')

      await balancer.getNextTask()

      expect(querySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: expect.objectContaining({
            priority: 'desc',
          }),
        })
      )
    })

    it('should dedicate workers to priority tiers', async () => {
      await balancer.assignWorkerToPriorityTier('priority-worker-1', 'high')
      await balancer.assignWorkerToPriorityTier('priority-worker-2', 'normal')

      // High priority task should go to dedicated worker
      const result = await balancer.routePriorityTask(
        { id: 'vip-task', type: 'compute', priority: 10 },
        'high'
      )

      expect(result.workerId).toBe('priority-worker-1')
    })
  })

  describe('Deadline-Aware Scheduling', () => {
    beforeEach(async () => {
      await balancer.registerWorker({ id: 'deadline-worker-1', endpoint: 'http://d1:3000' })
      await balancer.registerWorker({ id: 'deadline-worker-2', endpoint: 'http://d2:3000' })
    })

    it('should schedule tasks by deadline urgency', async () => {
      const now = Date.now()

      await balancer.queueTask({
        id: 'later-task',
        type: 'compute',
        deadline: now + 3600000, // 1 hour
      })
      await balancer.queueTask({
        id: 'urgent-task',
        type: 'compute',
        deadline: now + 60000, // 1 minute
      })
      await balancer.queueTask({
        id: 'medium-task',
        type: 'compute',
        deadline: now + 600000, // 10 minutes
      })

      const next = await balancer.getNextTaskByDeadline()

      expect(next?.id).toBe('urgent-task')
    })

    it('should estimate task completion time', async () => {
      // Record historical task durations
      await balancer.recordTaskCompletion('deadline-worker-1', {
        taskType: 'compute',
        duration: 5000,
        success: true,
      })
      await balancer.recordTaskCompletion('deadline-worker-1', {
        taskType: 'compute',
        duration: 6000,
        success: true,
      })

      const estimate = await balancer.estimateTaskDuration('deadline-worker-1', 'compute')

      expect(estimate).toBeGreaterThan(5000)
      expect(estimate).toBeLessThan(7000)
    })

    it('should reject tasks that cannot meet deadline', async () => {
      // Worker is busy with long tasks
      await balancer.updateWorkerLoad('deadline-worker-1', { currentTasks: 5 })
      await balancer.updateWorkerLoad('deadline-worker-2', { currentTasks: 5 })

      const now = Date.now()
      const result = await balancer.routeWithDeadline(
        { id: 'impossible-task', type: 'compute', deadline: now + 1000 },
        { strict: true }
      )

      expect(result.workerId).toBeNull()
      expect(result.rejectionReason).toBe('deadline-unattainable')
    })

    it('should preempt lower priority tasks for urgent deadlines', async () => {
      // Fill worker with low-priority tasks
      await balancer.route({ id: 'low-1', type: 'compute', priority: 1 }, 'least-busy')

      const now = Date.now()
      const result = await balancer.routeWithDeadline(
        { id: 'urgent', type: 'compute', deadline: now + 5000, priority: 10 },
        { allowPreemption: true }
      )

      expect(result.workerId).toBeDefined()
      expect(result.preemptedTasks?.length).toBeGreaterThan(0)
    })

    it('should track SLA compliance in graph', async () => {
      const now = Date.now()

      await balancer.queueTask({
        id: 'sla-task',
        type: 'compute',
        deadline: now + 60000,
      })

      // Complete before deadline
      await balancer.route({ id: 'sla-task', type: 'compute' }, 'round-robin')
      vi.advanceTimersByTime(30000)
      await balancer.completeTask('sla-task', 'deadline-worker-1')

      const metrics = await balancer.getSLAMetrics()

      expect(metrics.tasksMetDeadline).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Fair Share Scheduling', () => {
    beforeEach(async () => {
      await balancer.registerWorker({ id: 'shared-worker-1', endpoint: 'http://s1:3000' })
      await balancer.registerWorker({ id: 'shared-worker-2', endpoint: 'http://s2:3000' })

      // Register tenants with different shares
      await balancer.registerTenant('tenant-a', { share: 50 })
      await balancer.registerTenant('tenant-b', { share: 30 })
      await balancer.registerTenant('tenant-c', { share: 20 })
    })

    it('should distribute capacity according to tenant shares', async () => {
      const distribution: Record<string, number> = {
        'tenant-a': 0,
        'tenant-b': 0,
        'tenant-c': 0,
      }

      // Route 100 tasks for different tenants
      for (let i = 0; i < 100; i++) {
        const tenant = ['tenant-a', 'tenant-b', 'tenant-c'][i % 3]
        const result = await balancer.routeForTenant(
          { id: `task-${i}`, type: 'compute' },
          tenant!
        )
        if (result.workerId) {
          distribution[tenant!]++
        }
      }

      // Should respect fair share limits
      expect(distribution['tenant-a']).toBeLessThanOrEqual(55)
      expect(distribution['tenant-b']).toBeLessThanOrEqual(35)
      expect(distribution['tenant-c']).toBeLessThanOrEqual(25)
    })

    it('should store tenant configuration in graph', async () => {
      const node = await graph.queryNodes({
        label: 'Tenant',
        where: { tenantId: 'tenant-a' },
      })

      expect(node).toHaveLength(1)
      expect(node[0].properties.share).toBe(50)
    })

    it('should track per-tenant usage via graph edges', async () => {
      await balancer.routeForTenant({ id: 'task-1', type: 'compute' }, 'tenant-a')
      await balancer.routeForTenant({ id: 'task-2', type: 'compute' }, 'tenant-a')

      const usage = await balancer.getTenantUsage('tenant-a')

      expect(usage.activeTaskCount).toBe(2)
    })

    it('should allow burst above share when capacity available', async () => {
      // Only tenant-a is submitting tasks
      const routed: string[] = []

      for (let i = 0; i < 10; i++) {
        const result = await balancer.routeForTenant(
          { id: `task-${i}`, type: 'compute' },
          'tenant-a',
          { allowBurst: true }
        )
        if (result.workerId) {
          routed.push(result.workerId)
        }
      }

      // Should get more than 50% when no competition
      expect(routed.length).toBe(10)
    })

    it('should reclaim burst capacity when other tenants need it', async () => {
      // Tenant-a bursts to fill capacity
      for (let i = 0; i < 10; i++) {
        await balancer.routeForTenant(
          { id: `burst-${i}`, type: 'compute' },
          'tenant-a',
          { allowBurst: true }
        )
      }

      // Tenant-b now needs capacity
      const result = await balancer.routeForTenant(
        { id: 'tenant-b-task', type: 'compute' },
        'tenant-b'
      )

      // Should preempt tenant-a burst tasks
      expect(result.workerId).toBeDefined()
    })
  })

  describe('Locality-Aware Distribution', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'worker-node-1',
        endpoint: 'http://node1:3000',
      })
      await balancer.registerWorker({
        id: 'worker-node-2',
        endpoint: 'http://node2:3000',
      })
      await balancer.registerWorker({
        id: 'worker-node-3',
        endpoint: 'http://node3:3000',
      })

      // Register data locations
      await balancer.registerDataLocation('dataset-a', 'worker-node-1')
      await balancer.registerDataLocation('dataset-b', 'worker-node-2')
    })

    it('should prefer workers with local data', async () => {
      const result = await balancer.routeWithDataLocality(
        { id: 'task-1', type: 'compute' },
        ['dataset-a']
      )

      expect(result.workerId).toBe('worker-node-1')
      expect(result.dataLocalityScore).toBe(1.0)
    })

    it('should store data location as graph relationship', async () => {
      const edges = await graph.queryEdges({
        type: 'HAS_DATA',
        where: { datasetId: 'dataset-a' },
      })

      expect(edges).toHaveLength(1)
      expect(edges[0].from).toBe('worker-node-1')
    })

    it('should calculate data transfer cost for non-local execution', async () => {
      const cost = await balancer.calculateDataTransferCost(
        'worker-node-3',
        ['dataset-a', 'dataset-b']
      )

      expect(cost.transferRequired).toBe(true)
      expect(cost.estimatedBytes).toBeGreaterThan(0)
    })

    it('should balance data locality with worker load', async () => {
      // Make data-local worker heavily loaded
      await balancer.updateWorkerLoad('worker-node-1', { currentTasks: 10 })
      await balancer.updateWorkerLoad('worker-node-2', { currentTasks: 1 })

      const result = await balancer.routeWithDataLocality(
        { id: 'task-1', type: 'compute' },
        ['dataset-a'],
        { localityWeight: 0.3, loadWeight: 0.7 }
      )

      // Should prefer less loaded worker despite data transfer cost
      expect(result.workerId).toBe('worker-node-2')
    })

    it('should replicate data to frequently accessed workers', async () => {
      // Simulate multiple accesses to dataset-a from worker-node-2
      for (let i = 0; i < 10; i++) {
        await balancer.recordDataAccess('dataset-a', 'worker-node-2')
      }

      await balancer.evaluateDataReplication()

      const edges = await graph.queryEdges({
        type: 'HAS_DATA',
        where: { datasetId: 'dataset-a' },
      })

      // Should now be on multiple nodes
      expect(edges.length).toBeGreaterThan(1)
    })
  })
})
