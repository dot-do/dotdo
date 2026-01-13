/**
 * Graph Integration Layer for Workers
 *
 * Provides graph-backed worker management and load balancing:
 * - Worker registration and status tracking as graph nodes
 * - Load balancing via graph queries (round-robin, least-busy, capability)
 * - Routing decision tracking as graph edges for observability
 *
 * @module workers/graph
 */

import { GraphEngine, type Node, type Edge } from '../db/graph'
import type {
  WorkerStatus,
  LoadBalancerStrategy,
  WorkerRegistration,
  WorkerNode,
  TaskRequest,
  RouteResult,
  WorkerLoadMetrics,
  RouteOptions,
  StatusHistoryEntry,
  RoutingHistoryEntry,
  ClusterUtilization,
  LoadBalancer,
  FullLoadBalancer,
} from './types'

// Re-export types for convenience
export type {
  WorkerStatus,
  LoadBalancerStrategy,
  WorkerRegistration,
  WorkerNode,
  TaskRequest,
  RouteResult,
  WorkerLoadMetrics,
  RouteOptions,
  StatusHistoryEntry,
  RoutingHistoryEntry,
  ClusterUtilization,
}

// =============================================================================
// GRAPH LOAD BALANCER
// =============================================================================

/**
 * GraphLoadBalancer implements load balancing via graph queries.
 *
 * Workers are stored as graph nodes with label "Worker".
 * Capabilities are stored as nodes with label "Capability".
 * Worker-capability relationships are HAS_CAPABILITY edges.
 * Routing decisions are tracked as ROUTED_TO edges.
 * Status changes are tracked as STATUS_CHANGED edges.
 */
export class GraphLoadBalancer implements FullLoadBalancer {
  private graph: GraphEngine
  private roundRobinIndex = 0
  private heartbeatTimeout = 30000 // 30 seconds default

  constructor(graph: GraphEngine) {
    this.graph = graph
  }

  // ===========================================================================
  // WORKER REGISTRATION
  // ===========================================================================

  /**
   * Register a worker as a graph node
   */
  async registerWorker(registration: WorkerRegistration): Promise<WorkerNode> {
    const now = Date.now()

    const node = await this.graph.createNode(
      'Worker',
      {
        endpoint: registration.endpoint,
        status: 'available',
        currentTasks: 0,
        maxConcurrentTasks: registration.maxConcurrentTasks ?? 100,
        cpuUsage: 0,
        memoryUsage: 0,
        weight: registration.weight ?? 1,
        registeredAt: now,
        lastHeartbeat: now,
      },
      { id: registration.id }
    )

    // Create capability nodes and relationships
    if (registration.capabilities) {
      for (const capability of registration.capabilities) {
        // Create or get capability node
        let capNode = await this.graph.getNode(`capability-${capability}`)
        if (!capNode) {
          capNode = await this.graph.createNode(
            'Capability',
            { name: capability },
            { id: `capability-${capability}` }
          )
        }

        // Create HAS_CAPABILITY edge
        await this.graph.createEdge(node.id, 'HAS_CAPABILITY', capNode.id, {
          capability,
        })
      }
    }

    return this.nodeToWorker(node)
  }

  /**
   * Deregister a worker
   */
  async deregisterWorker(workerId: string): Promise<void> {
    await this.graph.deleteNode(workerId)
  }

  /**
   * Update worker status
   */
  async updateWorkerStatus(workerId: string, status: WorkerStatus): Promise<void> {
    const node = await this.graph.getNode(workerId)
    if (!node) return

    const previousStatus = node.properties.status as WorkerStatus

    await this.graph.updateNode(workerId, { status })

    // Track status change as an edge to a status event node
    const statusEventId = `status-${workerId}-${Date.now()}`
    await this.graph.createNode(
      'StatusEvent',
      {
        workerId,
        previousStatus,
        newStatus: status,
        timestamp: Date.now(),
      },
      { id: statusEventId }
    )

    await this.graph.createEdge(workerId, 'STATUS_CHANGED', statusEventId, {
      status,
      timestamp: Date.now(),
    })
  }

  /**
   * Update worker load metrics
   */
  async updateWorkerLoad(workerId: string, metrics: WorkerLoadMetrics): Promise<void> {
    await this.graph.updateNode(workerId, metrics)
  }

  /**
   * Get available workers via graph query
   */
  async getAvailableWorkers(): Promise<WorkerNode[]> {
    const nodes = await this.graph.queryNodes({
      label: 'Worker',
      where: {
        status: { $in: ['available', 'busy'] },
      },
    })

    return nodes.map((n) => this.nodeToWorker(n))
  }

  // ===========================================================================
  // LOAD BALANCING STRATEGIES
  // ===========================================================================

  /**
   * Route a task to a worker using the specified strategy
   */
  async route(
    task: TaskRequest,
    strategy: LoadBalancerStrategy = 'round-robin',
    options?: RouteOptions
  ): Promise<RouteResult> {
    let workerId: string | null = null
    let endpoint: string | null = null

    switch (strategy) {
      case 'round-robin':
        ({ workerId, endpoint } = await this.routeRoundRobin(task))
        break
      case 'least-busy':
        ({ workerId, endpoint } = await this.routeLeastBusy(task, options))
        break
      case 'capability':
        ({ workerId, endpoint } = await this.routeCapability(task))
        break
      default:
        ({ workerId, endpoint } = await this.routeRoundRobin(task))
    }

    const timestamp = Date.now()

    // Track routing decision if successful
    if (workerId) {
      await this.trackRoutingDecision(task, workerId, strategy, timestamp)
      await this.incrementTaskCount(workerId)
    }

    return { workerId, endpoint, strategy, timestamp }
  }

  /**
   * Round-robin routing via graph query
   */
  private async routeRoundRobin(task: TaskRequest): Promise<{ workerId: string | null; endpoint: string | null }> {
    const workers = await this.graph.queryNodes({
      label: 'Worker',
      where: {
        status: 'available',
      },
    })

    if (workers.length === 0) {
      return { workerId: null, endpoint: null }
    }

    // Round-robin selection
    const selectedIndex = this.roundRobinIndex % workers.length
    const selected = workers[selectedIndex]!
    this.roundRobinIndex = (this.roundRobinIndex + 1) % workers.length

    return {
      workerId: selected.id,
      endpoint: selected.properties.endpoint as string,
    }
  }

  /**
   * Least-busy routing via graph query with orderBy
   */
  private async routeLeastBusy(
    task: TaskRequest,
    options?: RouteOptions
  ): Promise<{ workerId: string | null; endpoint: string | null }> {
    // Query workers ordered by current tasks (ascending)
    let workers = await this.graph.queryNodes({
      label: 'Worker',
      where: {
        status: 'available',
      },
      orderBy: { currentTasks: 'asc' },
      limit: 10,
    })

    if (workers.length === 0) {
      return { workerId: null, endpoint: null }
    }

    // If tiebreaker is specified and there are ties on currentTasks
    if (options?.tiebreaker && workers.length > 1) {
      const lowestTasks = workers[0]!.properties.currentTasks
      const tiedWorkers = workers.filter((w) => w.properties.currentTasks === lowestTasks)

      if (tiedWorkers.length > 1) {
        // Sort by tiebreaker metric
        tiedWorkers.sort((a, b) => {
          const aVal = (a.properties[options.tiebreaker!] as number) ?? 0
          const bVal = (b.properties[options.tiebreaker!] as number) ?? 0
          return aVal - bVal
        })
        workers = tiedWorkers
      }
    }

    const selected = workers[0]!

    return {
      workerId: selected.id,
      endpoint: selected.properties.endpoint as string,
    }
  }

  /**
   * Capability-based routing via graph pattern matching
   */
  private async routeCapability(task: TaskRequest): Promise<{ workerId: string | null; endpoint: string | null }> {
    if (!task.requiredCapabilities || task.requiredCapabilities.length === 0) {
      // No capabilities required, fall back to round-robin
      return this.routeRoundRobin(task)
    }

    // Use graph pattern matching to find workers with required capabilities
    const result = await this.graph.match({
      pattern: '(w:Worker)-[:HAS_CAPABILITY]->(c:Capability)',
      where: {
        'w.status': 'available',
      },
    })

    // Filter workers that have ALL required capabilities
    const workerCapabilities = new Map<string, Set<string>>()

    for (const match of result.matches) {
      const worker = match.w as Node
      const capability = match.c as Node
      const capName = capability.properties.name as string

      if (!workerCapabilities.has(worker.id)) {
        workerCapabilities.set(worker.id, new Set())
      }
      workerCapabilities.get(worker.id)!.add(capName)
    }

    // Find workers with all required capabilities
    const qualifiedWorkers: string[] = []
    for (const [workerId, caps] of workerCapabilities) {
      const hasAllRequired = task.requiredCapabilities.every((req) => caps.has(req))
      if (hasAllRequired) {
        qualifiedWorkers.push(workerId)
      }
    }

    if (qualifiedWorkers.length === 0) {
      return { workerId: null, endpoint: null }
    }

    // If preferred capabilities specified, score workers
    if (task.preferredCapabilities && task.preferredCapabilities.length > 0) {
      const scores = qualifiedWorkers.map((workerId) => {
        const caps = workerCapabilities.get(workerId)!
        const preferredCount = task.preferredCapabilities!.filter((p) => caps.has(p)).length
        return { workerId, score: preferredCount }
      })

      scores.sort((a, b) => b.score - a.score)
      const selectedId = scores[0]!.workerId
      const selectedNode = await this.graph.getNode(selectedId)

      return {
        workerId: selectedId,
        endpoint: selectedNode?.properties.endpoint as string ?? null,
      }
    }

    // Just pick the first qualified worker
    const selectedId = qualifiedWorkers[0]!
    const selectedNode = await this.graph.getNode(selectedId)

    return {
      workerId: selectedId,
      endpoint: selectedNode?.properties.endpoint as string ?? null,
    }
  }

  // ===========================================================================
  // ROUTING DECISION TRACKING
  // ===========================================================================

  /**
   * Track a routing decision as a graph edge
   */
  private async trackRoutingDecision(
    task: TaskRequest,
    workerId: string,
    strategy: LoadBalancerStrategy,
    timestamp: number
  ): Promise<void> {
    // Create task node if it doesn't exist
    let taskNode = await this.graph.getNode(`task-${task.id}`)
    if (!taskNode) {
      taskNode = await this.graph.createNode(
        'Task',
        {
          type: task.type,
          requiredCapabilities: task.requiredCapabilities ?? [],
          createdAt: timestamp,
        },
        { id: `task-${task.id}` }
      )
    }

    // Create ROUTED_TO edge
    await this.graph.createEdge(taskNode.id, 'ROUTED_TO', workerId, {
      taskId: task.id,
      routedAt: timestamp,
      strategy,
    })
  }

  /**
   * Increment task count for a worker
   */
  private async incrementTaskCount(workerId: string): Promise<void> {
    const node = await this.graph.getNode(workerId)
    if (!node) return

    const currentTasks = ((node.properties.currentTasks as number) ?? 0) + 1
    const maxConcurrentTasks = (node.properties.maxConcurrentTasks as number) ?? 100

    const updates: Record<string, unknown> = { currentTasks }

    // Auto-mark as busy if at capacity
    if (currentTasks >= maxConcurrentTasks) {
      updates.status = 'busy'
    }

    await this.graph.updateNode(workerId, updates)
  }

  /**
   * Mark a task as completed
   */
  async completeTask(taskId: string, workerId: string): Promise<void> {
    // Find the routing edge and update it
    const edges = await this.graph.queryEdges({
      type: 'ROUTED_TO',
      to: workerId,
      where: { taskId },
    })

    if (edges.length > 0) {
      await this.graph.updateEdge(edges[0]!.id, {
        completedAt: Date.now(),
      })
    }

    // Decrement task count
    const node = await this.graph.getNode(workerId)
    if (!node) return

    const currentTasks = Math.max(0, ((node.properties.currentTasks as number) ?? 1) - 1)
    const updates: Record<string, unknown> = { currentTasks }

    // If was busy and now has capacity, mark as available
    if (node.properties.status === 'busy' && currentTasks < (node.properties.maxConcurrentTasks as number)) {
      updates.status = 'available'
    }

    await this.graph.updateNode(workerId, updates)
  }

  /**
   * Get routing history for a worker
   */
  async getRoutingHistory(workerId: string): Promise<RoutingHistoryEntry[]> {
    const edges = await this.graph.queryEdges({
      type: 'ROUTED_TO',
      to: workerId,
    })

    return edges.map((e) => ({
      taskId: e.properties.taskId as string,
      routedAt: e.properties.routedAt as number,
      completedAt: e.properties.completedAt as number | undefined,
      strategy: e.properties.strategy as LoadBalancerStrategy,
    }))
  }

  // ===========================================================================
  // AVAILABILITY TRACKING
  // ===========================================================================

  /**
   * Get status history for a worker
   */
  async getStatusHistory(workerId: string): Promise<StatusHistoryEntry[]> {
    const edges = await this.graph.queryEdges({
      type: 'STATUS_CHANGED',
      from: workerId,
    })

    return edges.map((e) => ({
      status: e.properties.status as WorkerStatus,
      timestamp: e.properties.timestamp as number,
    }))
  }

  /**
   * Send heartbeat for a worker
   */
  async heartbeat(workerId: string): Promise<void> {
    await this.graph.updateNode(workerId, {
      lastHeartbeat: Date.now(),
    })
  }

  /**
   * Set heartbeat timeout
   */
  setHeartbeatTimeout(timeout: number): void {
    this.heartbeatTimeout = timeout
  }

  /**
   * Check heartbeats and mark stale workers as offline
   */
  async checkHeartbeats(): Promise<void> {
    const now = Date.now()
    const workers = await this.graph.queryNodes({
      label: 'Worker',
      where: {
        status: { $in: ['available', 'busy'] },
      },
    })

    for (const worker of workers) {
      const lastHeartbeat = worker.properties.lastHeartbeat as number
      if (now - lastHeartbeat > this.heartbeatTimeout) {
        await this.updateWorkerStatus(worker.id, 'offline')
      }
    }
  }

  // ===========================================================================
  // ANALYTICS
  // ===========================================================================

  /**
   * Get task distribution across workers
   */
  async getTaskDistribution(): Promise<Record<string, number>> {
    const workers = await this.graph.queryNodes({ label: 'Worker' })
    const distribution: Record<string, number> = {}

    for (const worker of workers) {
      const edges = await this.graph.queryEdges({
        type: 'ROUTED_TO',
        to: worker.id,
      })
      distribution[worker.id] = edges.length
    }

    return distribution
  }

  /**
   * Get cluster utilization metrics
   */
  async getClusterUtilization(): Promise<ClusterUtilization> {
    const workers = await this.graph.queryNodes({ label: 'Worker' })

    if (workers.length === 0) {
      return { avgCpuUsage: 0, avgMemoryUsage: 0, totalTasks: 0, workerCount: 0 }
    }

    let totalCpu = 0
    let totalMemory = 0
    let totalTasks = 0

    for (const worker of workers) {
      totalCpu += (worker.properties.cpuUsage as number) ?? 0
      totalMemory += (worker.properties.memoryUsage as number) ?? 0
      totalTasks += (worker.properties.currentTasks as number) ?? 0
    }

    return {
      avgCpuUsage: totalCpu / workers.length,
      avgMemoryUsage: totalMemory / workers.length,
      totalTasks,
      workerCount: workers.length,
    }
  }

  /**
   * Identify hotspots (overloaded workers)
   */
  async identifyHotspots(threshold = 0.8): Promise<string[]> {
    const workers = await this.graph.queryNodes({
      label: 'Worker',
      where: {
        cpuUsage: { $gte: threshold },
      },
    })

    // Also check task count relative to distribution
    const distribution = await this.getTaskDistribution()
    const avgTasks = Object.values(distribution).reduce((a, b) => a + b, 0) / Object.keys(distribution).length

    const hotspots = new Set<string>()

    // Workers with high CPU
    for (const w of workers) {
      hotspots.add(w.id)
    }

    // Workers with significantly more tasks than average
    for (const [workerId, taskCount] of Object.entries(distribution)) {
      if (taskCount > avgTasks * 1.5) {
        hotspots.add(workerId)
      }
    }

    return Array.from(hotspots)
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Convert a graph node to a WorkerNode
   */
  private nodeToWorker(node: Node): WorkerNode {
    return {
      id: node.id,
      endpoint: node.properties.endpoint as string,
      status: node.properties.status as WorkerStatus,
      capabilities: node.properties.capabilities as string[] ?? [],
      currentTasks: node.properties.currentTasks as number ?? 0,
      maxConcurrentTasks: node.properties.maxConcurrentTasks as number ?? 100,
      cpuUsage: node.properties.cpuUsage as number ?? 0,
      memoryUsage: node.properties.memoryUsage as number ?? 0,
      weight: node.properties.weight as number ?? 1,
      registeredAt: node.properties.registeredAt as number ?? 0,
      lastHeartbeat: node.properties.lastHeartbeat as number ?? 0,
    }
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a round-robin load balancer backed by graph
 */
export function createGraphRoundRobinBalancer(graph: GraphEngine): LoadBalancer {
  const balancer = new GraphLoadBalancer(graph)

  return {
    async route(task: TaskRequest): Promise<RouteResult> {
      return balancer.route(task, 'round-robin')
    },
  }
}

/**
 * Create a least-busy load balancer backed by graph
 */
export function createGraphLeastBusyBalancer(graph: GraphEngine): LoadBalancer {
  const balancer = new GraphLoadBalancer(graph)

  return {
    async route(task: TaskRequest): Promise<RouteResult> {
      return balancer.route(task, 'least-busy')
    },
  }
}

/**
 * Create a capability-based load balancer backed by graph
 */
export function createGraphCapabilityBalancer(graph: GraphEngine): LoadBalancer {
  const balancer = new GraphLoadBalancer(graph)

  return {
    async route(task: TaskRequest): Promise<RouteResult> {
      return balancer.route(task, 'capability')
    },
  }
}
