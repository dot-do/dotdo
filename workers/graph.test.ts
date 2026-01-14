/**
 * Graph Load Balancer Tests
 *
 * Tests for the GraphLoadBalancer class which provides
 * graph-backed worker management and load balancing:
 * - Worker registration and status tracking as graph nodes
 * - Load balancing via graph queries (round-robin, least-busy, capability)
 * - Routing decision tracking as graph edges for observability
 *
 * @module workers/graph.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { GraphEngine } from '../db/graph'
import {
  GraphLoadBalancer,
  createGraphRoundRobinBalancer,
  createGraphLeastBusyBalancer,
  createGraphCapabilityBalancer,
  type WorkerRegistration,
  type TaskRequest,
} from './graph'

// =============================================================================
// TEST SETUP
// =============================================================================

describe('GraphLoadBalancer', () => {
  let graph: GraphEngine
  let balancer: GraphLoadBalancer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'))
    graph = new GraphEngine()
    balancer = new GraphLoadBalancer(graph)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // WORKER REGISTRATION
  // ===========================================================================

  describe('Worker Registration', () => {
    it('should register a worker as a graph node', async () => {
      const registration: WorkerRegistration = {
        id: 'worker-1',
        endpoint: 'http://worker1:3000',
        capabilities: ['compute', 'analyze'],
        maxConcurrentTasks: 50,
        weight: 2,
      }

      const worker = await balancer.registerWorker(registration)

      expect(worker.id).toBe('worker-1')
      expect(worker.endpoint).toBe('http://worker1:3000')
      expect(worker.status).toBe('available')
      expect(worker.maxConcurrentTasks).toBe(50)
      expect(worker.weight).toBe(2)
      expect(worker.currentTasks).toBe(0)
    })

    it('should create capability nodes and edges', async () => {
      await balancer.registerWorker({
        id: 'worker-2',
        endpoint: 'http://worker2:3000',
        capabilities: ['cap-a', 'cap-b'],
      })

      // Check capability nodes were created
      const capA = await graph.getNode('capability-cap-a')
      const capB = await graph.getNode('capability-cap-b')

      expect(capA).not.toBeNull()
      expect(capA?.label).toBe('Capability')
      expect(capA?.properties.name).toBe('cap-a')
      expect(capB).not.toBeNull()
      expect(capB?.properties.name).toBe('cap-b')
    })

    it('should use default values for optional fields', async () => {
      const worker = await balancer.registerWorker({
        id: 'worker-3',
        endpoint: 'http://worker3:3000',
      })

      expect(worker.maxConcurrentTasks).toBe(100)
      expect(worker.weight).toBe(1)
      expect(worker.cpuUsage).toBe(0)
      expect(worker.memoryUsage).toBe(0)
    })

    it('should deregister a worker', async () => {
      await balancer.registerWorker({
        id: 'worker-4',
        endpoint: 'http://worker4:3000',
      })

      await balancer.deregisterWorker('worker-4')

      const node = await graph.getNode('worker-4')
      expect(node).toBeNull()
    })
  })

  // ===========================================================================
  // STATUS MANAGEMENT
  // ===========================================================================

  describe('Status Management', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'status-worker',
        endpoint: 'http://status:3000',
      })
    })

    it('should update worker status', async () => {
      await balancer.updateWorkerStatus('status-worker', 'busy')

      const node = await graph.getNode('status-worker')
      expect(node?.properties.status).toBe('busy')
    })

    it('should track status changes as edges', async () => {
      await balancer.updateWorkerStatus('status-worker', 'busy')
      await balancer.updateWorkerStatus('status-worker', 'offline')

      const history = await balancer.getStatusHistory('status-worker')

      expect(history.length).toBe(2)
      expect(history[0]!.status).toBe('busy')
      expect(history[1]!.status).toBe('offline')
    })

    it('should update worker load metrics', async () => {
      await balancer.updateWorkerLoad('status-worker', {
        cpuUsage: 0.75,
        memoryUsage: 0.60,
        currentTasks: 15,
      })

      const node = await graph.getNode('status-worker')
      expect(node?.properties.cpuUsage).toBe(0.75)
      expect(node?.properties.memoryUsage).toBe(0.60)
      expect(node?.properties.currentTasks).toBe(15)
    })

    it('should get available workers', async () => {
      await balancer.registerWorker({
        id: 'available-1',
        endpoint: 'http://a1:3000',
      })
      await balancer.registerWorker({
        id: 'busy-1',
        endpoint: 'http://b1:3000',
      })
      await balancer.updateWorkerStatus('busy-1', 'busy')

      const available = await balancer.getAvailableWorkers()

      // Should include both available and busy (but not offline)
      expect(available.length).toBeGreaterThanOrEqual(2)
      expect(available.map(w => w.id)).toContain('available-1')
      expect(available.map(w => w.id)).toContain('busy-1')
    })
  })

  // ===========================================================================
  // ROUND-ROBIN ROUTING
  // ===========================================================================

  describe('Round-Robin Routing', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'rr-worker-1',
        endpoint: 'http://rr1:3000',
      })
      await balancer.registerWorker({
        id: 'rr-worker-2',
        endpoint: 'http://rr2:3000',
      })
      await balancer.registerWorker({
        id: 'rr-worker-3',
        endpoint: 'http://rr3:3000',
      })
    })

    it('should route tasks in round-robin order', async () => {
      const task1: TaskRequest = { id: 'task-1', type: 'compute' }
      const task2: TaskRequest = { id: 'task-2', type: 'compute' }
      const task3: TaskRequest = { id: 'task-3', type: 'compute' }
      const task4: TaskRequest = { id: 'task-4', type: 'compute' }

      const result1 = await balancer.route(task1, 'round-robin')
      const result2 = await balancer.route(task2, 'round-robin')
      const result3 = await balancer.route(task3, 'round-robin')
      const result4 = await balancer.route(task4, 'round-robin')

      // Should cycle through workers
      expect(result1.workerId).toBe('rr-worker-1')
      expect(result2.workerId).toBe('rr-worker-2')
      expect(result3.workerId).toBe('rr-worker-3')
      expect(result4.workerId).toBe('rr-worker-1') // Wraps around
    })

    it('should return null if no workers available', async () => {
      // Mark all workers offline
      await balancer.updateWorkerStatus('rr-worker-1', 'offline')
      await balancer.updateWorkerStatus('rr-worker-2', 'offline')
      await balancer.updateWorkerStatus('rr-worker-3', 'offline')

      const result = await balancer.route({ id: 'task-x', type: 'compute' }, 'round-robin')

      expect(result.workerId).toBeNull()
      expect(result.endpoint).toBeNull()
    })

    it('should return strategy in result', async () => {
      const result = await balancer.route({ id: 'task-y', type: 'compute' }, 'round-robin')

      expect(result.strategy).toBe('round-robin')
    })
  })

  // ===========================================================================
  // LEAST-BUSY ROUTING
  // ===========================================================================

  describe('Least-Busy Routing', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'lb-worker-1',
        endpoint: 'http://lb1:3000',
      })
      await balancer.registerWorker({
        id: 'lb-worker-2',
        endpoint: 'http://lb2:3000',
      })
      await balancer.registerWorker({
        id: 'lb-worker-3',
        endpoint: 'http://lb3:3000',
      })

      // Set different task counts
      await balancer.updateWorkerLoad('lb-worker-1', { currentTasks: 10 })
      await balancer.updateWorkerLoad('lb-worker-2', { currentTasks: 5 })
      await balancer.updateWorkerLoad('lb-worker-3', { currentTasks: 15 })
    })

    it('should route to worker with fewest tasks', async () => {
      const result = await balancer.route({ id: 'task-lb', type: 'compute' }, 'least-busy')

      expect(result.workerId).toBe('lb-worker-2')
    })

    it('should use tiebreaker when specified', async () => {
      // Create tie in task count
      await balancer.updateWorkerLoad('lb-worker-1', { currentTasks: 5, cpuUsage: 0.8 })
      await balancer.updateWorkerLoad('lb-worker-2', { currentTasks: 5, cpuUsage: 0.3 })

      const result = await balancer.route(
        { id: 'task-tb', type: 'compute' },
        'least-busy',
        { tiebreaker: 'cpuUsage' }
      )

      // Should pick lower CPU usage worker
      expect(result.workerId).toBe('lb-worker-2')
    })

    it('should return strategy in result', async () => {
      const result = await balancer.route({ id: 'task-s', type: 'compute' }, 'least-busy')

      expect(result.strategy).toBe('least-busy')
    })
  })

  // ===========================================================================
  // CAPABILITY-BASED ROUTING
  // ===========================================================================

  describe('Capability-Based Routing', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'cap-worker-1',
        endpoint: 'http://cap1:3000',
        capabilities: ['compute', 'analyze'],
      })
      await balancer.registerWorker({
        id: 'cap-worker-2',
        endpoint: 'http://cap2:3000',
        capabilities: ['transform', 'validate'],
      })
      await balancer.registerWorker({
        id: 'cap-worker-3',
        endpoint: 'http://cap3:3000',
        capabilities: ['compute', 'transform', 'analyze'],
      })
    })

    it('should route to worker with required capabilities', async () => {
      const task: TaskRequest = {
        id: 'task-cap',
        type: 'data-processing',
        requiredCapabilities: ['transform', 'validate'],
      }

      const result = await balancer.route(task, 'capability')

      expect(result.workerId).toBe('cap-worker-2')
    })

    it('should route to worker with all required capabilities', async () => {
      const task: TaskRequest = {
        id: 'task-multi',
        type: 'complex',
        requiredCapabilities: ['compute', 'analyze'],
      }

      const result = await balancer.route(task, 'capability')

      // Either worker-1 or worker-3 could handle this
      expect(['cap-worker-1', 'cap-worker-3']).toContain(result.workerId)
    })

    it('should prefer workers with more preferred capabilities', async () => {
      const task: TaskRequest = {
        id: 'task-pref',
        type: 'optimal',
        requiredCapabilities: ['compute'],
        preferredCapabilities: ['transform', 'analyze'],
      }

      const result = await balancer.route(task, 'capability')

      // worker-3 has both preferred capabilities
      expect(result.workerId).toBe('cap-worker-3')
    })

    it('should return null if no worker has required capabilities', async () => {
      const task: TaskRequest = {
        id: 'task-impossible',
        type: 'missing',
        requiredCapabilities: ['nonexistent-capability'],
      }

      const result = await balancer.route(task, 'capability')

      expect(result.workerId).toBeNull()
    })

    it('should fall back to round-robin if no capabilities required', async () => {
      const task: TaskRequest = {
        id: 'task-no-cap',
        type: 'simple',
      }

      const result = await balancer.route(task, 'capability')

      expect(result.workerId).not.toBeNull()
    })
  })

  // ===========================================================================
  // ROUTING DECISION TRACKING
  // ===========================================================================

  describe('Routing Decision Tracking', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'track-worker',
        endpoint: 'http://track:3000',
      })
    })

    it('should increment task count on routing', async () => {
      await balancer.route({ id: 'inc-task-1', type: 'work' })
      await balancer.route({ id: 'inc-task-2', type: 'work' })

      const node = await graph.getNode('track-worker')
      expect(node?.properties.currentTasks).toBe(2)
    })

    it('should track routing history', async () => {
      await balancer.route({ id: 'hist-task-1', type: 'work' })
      await balancer.route({ id: 'hist-task-2', type: 'work' })

      const history = await balancer.getRoutingHistory('track-worker')

      expect(history.length).toBe(2)
      expect(history[0]!.taskId).toBe('hist-task-1')
      expect(history[1]!.taskId).toBe('hist-task-2')
    })

    it('should complete task and decrement count', async () => {
      await balancer.route({ id: 'complete-task', type: 'work' })
      await balancer.completeTask('complete-task', 'track-worker')

      const node = await graph.getNode('track-worker')
      expect(node?.properties.currentTasks).toBe(0)
    })

    it('should mark completed task in routing history', async () => {
      await balancer.route({ id: 'mark-task', type: 'work' })
      await balancer.completeTask('mark-task', 'track-worker')

      const history = await balancer.getRoutingHistory('track-worker')
      expect(history[0]!.completedAt).toBeDefined()
    })

    it('should auto-mark worker as busy when at capacity', async () => {
      // Register a worker with low capacity
      await balancer.registerWorker({
        id: 'low-cap-worker',
        endpoint: 'http://lowcap:3000',
        maxConcurrentTasks: 2,
      })

      await balancer.route({ id: 'cap-task-1', type: 'work' })
      await balancer.route({ id: 'cap-task-2', type: 'work' })

      const node = await graph.getNode('low-cap-worker')
      expect(node?.properties.status).toBe('busy')
    })

    it('should auto-mark worker as available when capacity frees up', async () => {
      await balancer.registerWorker({
        id: 'auto-avail-worker',
        endpoint: 'http://auto:3000',
        maxConcurrentTasks: 1,
      })

      await balancer.route({ id: 'auto-task', type: 'work' })
      // Worker should be busy now
      let node = await graph.getNode('auto-avail-worker')
      expect(node?.properties.status).toBe('busy')

      await balancer.completeTask('auto-task', 'auto-avail-worker')
      node = await graph.getNode('auto-avail-worker')
      expect(node?.properties.status).toBe('available')
    })
  })

  // ===========================================================================
  // HEARTBEAT AND AVAILABILITY
  // ===========================================================================

  describe('Heartbeat Management', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'hb-worker',
        endpoint: 'http://hb:3000',
      })
    })

    it('should update heartbeat timestamp', async () => {
      const beforeHeartbeat = Date.now()
      await balancer.heartbeat('hb-worker')

      const node = await graph.getNode('hb-worker')
      expect(node?.properties.lastHeartbeat).toBeGreaterThanOrEqual(beforeHeartbeat)
    })

    it('should mark stale workers as offline', async () => {
      balancer.setHeartbeatTimeout(1000) // 1 second

      // Advance time past heartbeat timeout
      vi.advanceTimersByTime(2000)

      await balancer.checkHeartbeats()

      const node = await graph.getNode('hb-worker')
      expect(node?.properties.status).toBe('offline')
    })

    it('should not mark workers with recent heartbeat as offline', async () => {
      balancer.setHeartbeatTimeout(30000)

      // Send heartbeat
      await balancer.heartbeat('hb-worker')

      // Advance time less than timeout
      vi.advanceTimersByTime(10000)

      await balancer.checkHeartbeats()

      const node = await graph.getNode('hb-worker')
      expect(node?.properties.status).toBe('available')
    })
  })

  // ===========================================================================
  // ANALYTICS
  // ===========================================================================

  describe('Analytics', () => {
    beforeEach(async () => {
      await balancer.registerWorker({
        id: 'analytics-1',
        endpoint: 'http://a1:3000',
      })
      await balancer.registerWorker({
        id: 'analytics-2',
        endpoint: 'http://a2:3000',
      })

      // Route some tasks
      await balancer.route({ id: 'at-1', type: 'work' })
      await balancer.route({ id: 'at-2', type: 'work' })
      await balancer.route({ id: 'at-3', type: 'work' })
    })

    it('should get task distribution across workers', async () => {
      const distribution = await balancer.getTaskDistribution()

      expect(distribution['analytics-1']).toBeDefined()
      expect(distribution['analytics-2']).toBeDefined()
      const totalTasks = distribution['analytics-1'] + distribution['analytics-2']
      expect(totalTasks).toBe(3)
    })

    it('should get cluster utilization metrics', async () => {
      await balancer.updateWorkerLoad('analytics-1', { cpuUsage: 0.5, memoryUsage: 0.6 })
      await balancer.updateWorkerLoad('analytics-2', { cpuUsage: 0.7, memoryUsage: 0.4 })

      const utilization = await balancer.getClusterUtilization()

      expect(utilization.workerCount).toBe(2)
      expect(utilization.avgCpuUsage).toBe(0.6)
      expect(utilization.avgMemoryUsage).toBe(0.5)
    })

    it('should identify hotspots', async () => {
      await balancer.updateWorkerLoad('analytics-1', { cpuUsage: 0.9 })
      await balancer.updateWorkerLoad('analytics-2', { cpuUsage: 0.3 })

      const hotspots = await balancer.identifyHotspots(0.8)

      expect(hotspots).toContain('analytics-1')
      expect(hotspots).not.toContain('analytics-2')
    })

    it('should handle empty cluster for utilization', async () => {
      const emptyGraph = new GraphEngine()
      const emptyBalancer = new GraphLoadBalancer(emptyGraph)

      const utilization = await emptyBalancer.getClusterUtilization()

      expect(utilization.workerCount).toBe(0)
      expect(utilization.avgCpuUsage).toBe(0)
      expect(utilization.avgMemoryUsage).toBe(0)
      expect(utilization.totalTasks).toBe(0)
    })
  })
})

// =============================================================================
// FACTORY FUNCTION TESTS
// =============================================================================

describe('Graph Load Balancer Factory Functions', () => {
  let graph: GraphEngine

  beforeEach(async () => {
    vi.useFakeTimers()
    graph = new GraphEngine()

    // Register test workers
    const balancer = new GraphLoadBalancer(graph)
    await balancer.registerWorker({
      id: 'factory-worker-1',
      endpoint: 'http://fw1:3000',
      capabilities: ['cap-x'],
    })
    await balancer.registerWorker({
      id: 'factory-worker-2',
      endpoint: 'http://fw2:3000',
      capabilities: ['cap-y'],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('createGraphRoundRobinBalancer', () => {
    it('should create a round-robin balancer', async () => {
      const balancer = createGraphRoundRobinBalancer(graph)

      const result1 = await balancer.route({ id: 't1', type: 'work' })
      const result2 = await balancer.route({ id: 't2', type: 'work' })

      expect(result1.workerId).not.toBe(result2.workerId)
    })

    it('should use round-robin strategy', async () => {
      const balancer = createGraphRoundRobinBalancer(graph)
      const result = await balancer.route({ id: 't', type: 'work' })

      expect(result.strategy).toBe('round-robin')
    })
  })

  describe('createGraphLeastBusyBalancer', () => {
    it('should create a least-busy balancer', async () => {
      const balancer = createGraphLeastBusyBalancer(graph)
      const result = await balancer.route({ id: 't', type: 'work' })

      expect(result.strategy).toBe('least-busy')
    })
  })

  describe('createGraphCapabilityBalancer', () => {
    it('should create a capability-based balancer', async () => {
      const balancer = createGraphCapabilityBalancer(graph)

      const result = await balancer.route({
        id: 't',
        type: 'work',
        requiredCapabilities: ['cap-x'],
      })

      expect(result.strategy).toBe('capability')
      expect(result.workerId).toBe('factory-worker-1')
    })
  })
})
