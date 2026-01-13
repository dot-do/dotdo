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
import { GraphEngine, type Node, type Edge } from '../db/graph'
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
} from './load-balancing-graph'

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
      await balancer.registerWorker({
        id: 'worker-limited',
        endpoint: 'http://limited:3000',
        maxConcurrentTasks: 2,
      })

      await balancer.route({ id: 'task-1', type: 'compute' }, 'round-robin')
      await balancer.route({ id: 'task-2', type: 'compute' }, 'round-robin')
      // Worker should now be at capacity

      const node = await graph.getNode('worker-limited')
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
      // Route more tasks to worker-1 to create a hotspot
      for (let i = 0; i < 10; i++) {
        await balancer.route({ id: `hot-task-${i}`, type: 'compute' }, 'round-robin')
      }

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
