/**
 * Graph-Backed Load Balancing
 *
 * Implements load balancing strategies using graph queries for:
 * - Worker registration and status tracking as graph nodes
 * - Round-robin routing via graph traversal
 * - Least-busy routing via graph aggregation queries
 * - Capability-based routing via graph pattern matching
 * - Routing decision tracking as graph edges for observability
 *
 * @module workers/load-balancing-graph
 */

import { GraphEngine, type Node, type Edge } from '../db/graph'

// Import types from consolidated types module
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
} from './types'

// Re-export types for backward compatibility
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
// =============================================================================
// CIRCUIT BREAKER TYPES
// =============================================================================

/**
 * Circuit breaker state: closed (healthy), open (failing), half-open (testing)
 */
export type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number
  /** Time before transitioning from open to half-open (ms) */
  resetTimeout: number
  /** Number of requests allowed in half-open state */
  halfOpenRequests: number
  /** Sliding window configuration */
  slidingWindow?: {
    /** Window size in ms */
    windowSize: number
    /** Minimum requests before calculating failure rate */
    minRequests: number
  }
}

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  openCircuits: number
  closedCircuits: number
  halfOpenCircuits: number
  totalFailures: number
  totalSuccesses: number
}

/**
 * Extended task request with routing options
 */
export interface ExtendedTaskRequest extends TaskRequest {
  /** Target region for geographic routing */
  region?: string
  /** Affinity key for session/user affinity */
  affinityKey?: string
  /** Tenant ID for multi-tenant isolation */
  tenantId?: string
}

/**
 * Extended route result with additional info
 */
export interface ExtendedRouteResult extends RouteResult {
  /** Whether this is a probe request to half-open circuit */
  isProbeRequest?: boolean
}

export class GraphLoadBalancer {
  private graph: GraphEngine
  private roundRobinIndex = 0
  private heartbeatTimeout = 30000 // 30 seconds default
  private circuitBreakerConfig: CircuitBreakerConfig = {
    failureThreshold: 3,
    resetTimeout: 30000,
    halfOpenRequests: 1,
  }
  private eventCounter = 0

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

  private statusEventCounter = 0

  /**
   * Update worker status
   */
  async updateWorkerStatus(workerId: string, status: WorkerStatus): Promise<void> {
    const node = await this.graph.getNode(workerId)
    if (!node) return

    const previousStatus = node.properties.status as WorkerStatus

    await this.graph.updateNode(workerId, { status })

    // Track status change as an edge to a status event node
    // Use counter to avoid ID collision with fake timers
    const statusEventId = `status-${workerId}-${Date.now()}-${this.statusEventCounter++}`
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
    task: TaskRequest | ExtendedTaskRequest,
    strategy: LoadBalancerStrategy | 'geographic' | 'affinity' | 'tenant-isolated' = 'round-robin',
    options?: RouteOptions
  ): Promise<RouteResult> {
    let workerId: string | null = null
    let endpoint: string | null = null
    let excludedWorkers: string[] = []

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
      case 'geographic':
        ({ workerId, endpoint } = await this.routeGeographic(task as ExtendedTaskRequest))
        break
      case 'affinity':
        ({ workerId, endpoint } = await this.routeAffinity(task as ExtendedTaskRequest))
        break
      case 'tenant-isolated':
        ({ workerId, endpoint } = await this.routeTenantIsolated(task as ExtendedTaskRequest))
        break
      default:
        ({ workerId, endpoint } = await this.routeRoundRobin(task))
    }

    const timestamp = Date.now()

    // Track routing decision if successful
    if (workerId) {
      // Get excluded workers for tracking (directly open circuits)
      const openCircuitWorkers = await this.graph.queryNodes({
        label: 'Worker',
        where: { circuitState: 'open' },
      })
      excludedWorkers = openCircuitWorkers.map(w => w.id)

      // Get cascade-excluded workers (open due to dependency failure)
      const cascadeExcludedWorkers = await this.graph.queryNodes({
        label: 'Worker',
        where: { circuitOpenReason: 'dependency-failure' },
      })
      const cascadeExcluded = cascadeExcludedWorkers.map(w => w.id)

      await this.trackRoutingDecision(task, workerId, strategy as LoadBalancerStrategy, timestamp, excludedWorkers, cascadeExcluded)
      await this.incrementTaskCount(workerId)
    }

    return { workerId, endpoint, strategy: strategy as LoadBalancerStrategy, timestamp }
  }

  /**
   * Round-robin routing via graph query
   */
  private async routeRoundRobin(task: TaskRequest): Promise<{ workerId: string | null; endpoint: string | null }> {
    // Query workers with circuit breaker filtering in graph
    const workers = await this.graph.queryNodes({
      label: 'Worker',
      where: {
        status: 'available',
        circuitState: { $ne: 'open' },
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
    const allWorkers = await this.graph.queryNodes({
      label: 'Worker',
      where: {
        status: 'available',
      },
      orderBy: { currentTasks: 'asc' },
      limit: 20,
    })

    // Filter out workers with open circuit breakers
    let workers = allWorkers.filter(w =>
      (w.properties.circuitState as string) !== 'open'
    )

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
    task: TaskRequest | ExtendedTaskRequest,
    workerId: string,
    strategy: LoadBalancerStrategy | 'geographic' | 'affinity' | 'tenant-isolated',
    timestamp: number,
    excludedWorkers: string[] = [],
    cascadeExcluded: string[] = []
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

    // Build edge properties
    const extendedTask = task as ExtendedTaskRequest
    const edgeProperties: Record<string, unknown> = {
      taskId: task.id,
      routedAt: timestamp,
      strategy,
      excludedWorkers,
      excludedReason: excludedWorkers.length > 0 ? 'circuit-open' : undefined,
      cascadeExcluded: cascadeExcluded.length > 0 ? cascadeExcluded : undefined,
    }

    // Add extended routing metadata
    if (extendedTask.region) {
      edgeProperties.requestedRegion = extendedTask.region
    }
    if (extendedTask.affinityKey) {
      edgeProperties.affinityKey = extendedTask.affinityKey
    }
    if (extendedTask.tenantId) {
      edgeProperties.tenantId = extendedTask.tenantId
    }

    // Create ROUTED_TO edge with routing metadata
    await this.graph.createEdge(taskNode.id, 'ROUTED_TO', workerId, edgeProperties)
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
  // GEOGRAPHIC REGION ROUTING
  // ===========================================================================

  /**
   * Set worker region via graph relationship
   */
  async setWorkerRegion(workerId: string, region: string): Promise<void> {
    const worker = await this.graph.getNode(workerId)
    if (!worker) return

    // Create region node if it doesn't exist
    let regionNode = await this.graph.getNode(`region-${region}`)
    if (!regionNode) {
      regionNode = await this.graph.createNode(
        'Region',
        { name: region },
        { id: `region-${region}` }
      )
    }

    // Create IN_REGION edge
    await this.graph.createEdge(workerId, 'IN_REGION', regionNode.id, {
      region,
      assignedAt: Date.now(),
    })

    // Also store region as property on worker
    await this.graph.updateNode(workerId, { region })
  }

  /**
   * Set proximity between regions (lower is closer)
   */
  async setRegionProximity(regionA: string, regionB: string, distance: number): Promise<void> {
    // Create region nodes if they don't exist
    let nodeA = await this.graph.getNode(`region-${regionA}`)
    if (!nodeA) {
      nodeA = await this.graph.createNode('Region', { name: regionA }, { id: `region-${regionA}` })
    }

    let nodeB = await this.graph.getNode(`region-${regionB}`)
    if (!nodeB) {
      nodeB = await this.graph.createNode('Region', { name: regionB }, { id: `region-${regionB}` })
    }

    // Create bidirectional PROXIMATE_TO edges
    await this.graph.createEdge(nodeA.id, 'PROXIMATE_TO', nodeB.id, { distance })
    await this.graph.createEdge(nodeB.id, 'PROXIMATE_TO', nodeA.id, { distance })
  }

  /**
   * Route task geographically via graph queries
   */
  private async routeGeographic(task: ExtendedTaskRequest): Promise<{ workerId: string | null; endpoint: string | null }> {
    if (!task.region) {
      return this.routeRoundRobin(task)
    }

    // Use graph pattern matching to find workers in region
    const result = await this.graph.match({
      pattern: '(w:Worker)-[:IN_REGION]->(r:Region)',
      where: {
        'r.name': task.region,
        'w.status': 'available',
      },
    })

    if (result.matches.length > 0) {
      const worker = result.matches[0]!.w as Node
      return {
        workerId: worker.id,
        endpoint: worker.properties.endpoint as string,
      }
    }

    // No worker in exact region - find nearest available region
    const nearestWorker = await this.findNearestRegionWorker(task.region)
    return nearestWorker
  }

  /**
   * Find worker in nearest available region using graph shortest path
   */
  private async findNearestRegionWorker(targetRegion: string): Promise<{ workerId: string | null; endpoint: string | null }> {
    const targetRegionNode = await this.graph.getNode(`region-${targetRegion}`)
    if (!targetRegionNode) {
      return { workerId: null, endpoint: null }
    }

    // Get all regions and find shortest paths
    const regionNodes = await this.graph.queryNodes({ label: 'Region' })
    let nearestRegion: string | null = null
    let shortestDistance = Infinity

    for (const regionNode of regionNodes) {
      if (regionNode.id === targetRegionNode.id) continue

      // Use shortestPath to find proximity
      const path = await this.graph.shortestPath(targetRegionNode.id, regionNode.id, {
        relationshipTypes: ['PROXIMATE_TO'],
        maxDepth: 5,
      })

      if (path && path.length < shortestDistance) {
        // Check if this region has available workers
        const workersInRegion = await this.graph.match({
          pattern: '(w:Worker)-[:IN_REGION]->(r:Region)',
          where: {
            'r.id': regionNode.id,
            'w.status': 'available',
          },
        })

        if (workersInRegion.matches.length > 0) {
          shortestDistance = path.length
          nearestRegion = regionNode.properties.name as string
        }
      }
    }

    if (!nearestRegion) {
      return { workerId: null, endpoint: null }
    }

    // Get a worker from the nearest region
    const result = await this.graph.match({
      pattern: '(w:Worker)-[:IN_REGION]->(r:Region)',
      where: {
        'r.name': nearestRegion,
        'w.status': 'available',
      },
    })

    if (result.matches.length > 0) {
      const worker = result.matches[0]!.w as Node
      return {
        workerId: worker.id,
        endpoint: worker.properties.endpoint as string,
      }
    }

    return { workerId: null, endpoint: null }
  }

  // ===========================================================================
  // AFFINITY-BASED ROUTING
  // ===========================================================================

  /**
   * Set affinity between a key (user/session) and a worker
   */
  async setAffinity(affinityKey: string, workerId: string): Promise<void> {
    // Create affinity node if it doesn't exist
    let affinityNode = await this.graph.getNode(`affinity-${affinityKey}`)
    if (!affinityNode) {
      affinityNode = await this.graph.createNode(
        'Affinity',
        { key: affinityKey, strength: 0 },
        { id: `affinity-${affinityKey}` }
      )
    }

    // Create or update HAS_AFFINITY edge
    const existingEdges = await this.graph.queryEdges({
      type: 'HAS_AFFINITY',
      from: affinityNode.id,
      where: { affinityKey },
    })

    if (existingEdges.length === 0) {
      await this.graph.createEdge(affinityNode.id, 'HAS_AFFINITY', workerId, {
        affinityKey,
        createdAt: Date.now(),
        strength: 0, // Start at 0, will be incremented on first route
      })
    }
  }

  /**
   * Get affinity strength between a key and worker
   */
  async getAffinityStrength(affinityKey: string, workerId: string): Promise<number> {
    const edges = await this.graph.queryEdges({
      type: 'HAS_AFFINITY',
      to: workerId,
      where: { affinityKey },
    })

    if (edges.length === 0) return 0
    return (edges[0]!.properties.strength as number) ?? 0
  }

  /**
   * Route task based on affinity via graph traversal
   */
  private async routeAffinity(task: ExtendedTaskRequest): Promise<{ workerId: string | null; endpoint: string | null }> {
    if (!task.affinityKey) {
      return this.routeLeastBusy(task)
    }

    // Use graph pattern matching to find affinity
    const result = await this.graph.match({
      pattern: '(a:Affinity)-[:HAS_AFFINITY]->(w:Worker)',
      where: {
        'a.key': task.affinityKey,
      },
    })

    if (result.matches.length > 0) {
      const worker = result.matches[0]!.w as Node

      // Check if worker is available
      if (worker.properties.status === 'available') {
        // Increment affinity strength
        const edges = await this.graph.queryEdges({
          type: 'HAS_AFFINITY',
          to: worker.id,
          where: { affinityKey: task.affinityKey },
        })

        if (edges.length > 0) {
          const currentStrength = (edges[0]!.properties.strength as number) ?? 0
          await this.graph.updateEdge(edges[0]!.id, { strength: currentStrength + 1 })
        }

        return {
          workerId: worker.id,
          endpoint: worker.properties.endpoint as string,
        }
      }

      // Affinity worker unavailable - fall back to least-busy
      const fallback = await this.routeLeastBusy(task)
      return fallback
    }

    // No existing affinity - create one with least-busy selection
    const result2 = await this.routeLeastBusy(task)
    if (result2.workerId) {
      await this.setAffinity(task.affinityKey, result2.workerId)
    }
    return result2
  }

  // ===========================================================================
  // MULTI-TENANT ISOLATION ROUTING
  // ===========================================================================

  /**
   * Assign worker to tenant for isolation
   */
  async assignWorkerToTenant(workerId: string, tenantId: string): Promise<void> {
    // Create tenant node if it doesn't exist
    let tenantNode = await this.graph.getNode(`tenant-${tenantId}`)
    if (!tenantNode) {
      tenantNode = await this.graph.createNode(
        'Tenant',
        { id: tenantId },
        { id: `tenant-${tenantId}` }
      )
    }

    // Create ASSIGNED_TO_TENANT edge
    await this.graph.createEdge(workerId, 'ASSIGNED_TO_TENANT', tenantNode.id, {
      tenantId,
      assignedAt: Date.now(),
    })

    // Mark worker as dedicated
    await this.graph.updateNode(workerId, { tenantId, isShared: false })
  }

  /**
   * Mark worker as shared (available to all tenants)
   */
  async markWorkerAsShared(workerId: string): Promise<void> {
    await this.graph.updateNode(workerId, { isShared: true, tenantId: null })
  }

  /**
   * Route task with tenant isolation via graph queries
   */
  private async routeTenantIsolated(task: ExtendedTaskRequest): Promise<{ workerId: string | null; endpoint: string | null }> {
    if (!task.tenantId) {
      return this.routeRoundRobin(task)
    }

    // First, try to find dedicated worker for this tenant
    const result = await this.graph.match({
      pattern: '(w:Worker)-[:ASSIGNED_TO_TENANT]->(t:Tenant)',
      where: {
        't.id': task.tenantId,
        'w.status': 'available',
      },
    })

    if (result.matches.length > 0) {
      const worker = result.matches[0]!.w as Node
      return {
        workerId: worker.id,
        endpoint: worker.properties.endpoint as string,
      }
    }

    // No dedicated worker - try shared workers
    const sharedWorkers = await this.graph.queryNodes({
      label: 'Worker',
      where: {
        status: 'available',
        isShared: true,
      },
    })

    if (sharedWorkers.length > 0) {
      const worker = sharedWorkers[0]!
      return {
        workerId: worker.id,
        endpoint: worker.properties.endpoint as string,
      }
    }

    // No available workers (neither dedicated nor shared)
    return { workerId: null, endpoint: null }
  }

  // ===========================================================================
  // CIRCUIT BREAKER
  // ===========================================================================

  /**
   * Configure global circuit breaker settings
   */
  async configureCircuitBreaker(config: CircuitBreakerConfig): Promise<void> {
    this.circuitBreakerConfig = config

    // Initialize circuit state for all existing workers
    const workers = await this.graph.queryNodes({ label: 'Worker' })
    for (const worker of workers) {
      if (!worker.properties.circuitState) {
        await this.graph.updateNode(worker.id, {
          circuitState: 'closed',
          failureCount: 0,
          lastFailureAt: null,
          circuitOpenedAt: null,
        })
      }
    }
  }

  /**
   * Configure per-worker circuit breaker settings
   */
  async configureWorkerCircuitBreaker(workerId: string, config: CircuitBreakerConfig): Promise<void> {
    await this.graph.updateNode(workerId, {
      cbFailureThreshold: config.failureThreshold,
      cbResetTimeout: config.resetTimeout,
      cbHalfOpenRequests: config.halfOpenRequests,
      circuitState: 'closed',
      failureCount: 0,
    })
  }

  /**
   * Record a worker failure
   */
  async recordWorkerFailure(workerId: string): Promise<void> {
    const worker = await this.graph.getNode(workerId)
    if (!worker) return

    const now = Date.now()

    // Create failure event node
    const failureId = `failure-${workerId}-${now}-${this.eventCounter++}`
    await this.graph.createNode(
      'FailureEvent',
      {
        workerId,
        timestamp: now,
        type: 'failure',
      },
      { id: failureId }
    )

    // Get worker's circuit breaker config (per-worker or global)
    const threshold = (worker.properties.cbFailureThreshold as number) ?? this.circuitBreakerConfig.failureThreshold
    const currentState = (worker.properties.circuitState as CircuitState) ?? 'closed'
    const failureCount = ((worker.properties.failureCount as number) ?? 0) + 1

    const updates: Record<string, unknown> = {
      failureCount,
      lastFailureAt: now,
    }

    // Check if we should open the circuit
    if (currentState === 'closed') {
      // Check sliding window if configured
      if (this.circuitBreakerConfig.slidingWindow) {
        const windowStart = now - this.circuitBreakerConfig.slidingWindow.windowSize
        const recentFailures = await this.graph.queryNodes({
          label: 'FailureEvent',
          where: {
            workerId,
            timestamp: { $gte: windowStart },
          },
        })

        if (recentFailures.length >= this.circuitBreakerConfig.slidingWindow.minRequests &&
            failureCount >= threshold) {
          updates.circuitState = 'open'
          updates.circuitOpenedAt = now

          // Track state change
          await this.trackCircuitStateChange(workerId, 'closed', 'open', now)
        }
      } else if (failureCount >= threshold) {
        updates.circuitState = 'open'
        updates.circuitOpenedAt = now

        // Track state change
        await this.trackCircuitStateChange(workerId, 'closed', 'open', now)
      }
    } else if (currentState === 'half-open') {
      // Failure in half-open - reopen circuit
      updates.circuitState = 'open'
      updates.circuitOpenedAt = now
      updates.failureCount = 1 // Reset count

      await this.trackCircuitStateChange(workerId, 'half-open', 'open', now)
    }

    await this.graph.updateNode(workerId, updates)
  }

  /**
   * Record a worker success
   */
  async recordWorkerSuccess(workerId: string): Promise<void> {
    const worker = await this.graph.getNode(workerId)
    if (!worker) return

    const now = Date.now()
    const currentState = (worker.properties.circuitState as CircuitState) ?? 'closed'

    // Create success event node
    const successId = `success-${workerId}-${now}-${this.eventCounter++}`
    await this.graph.createNode(
      'SuccessEvent',
      {
        workerId,
        timestamp: now,
        type: 'success',
      },
      { id: successId }
    )

    if (currentState === 'half-open') {
      // Success in half-open - close the circuit
      await this.graph.updateNode(workerId, {
        circuitState: 'closed',
        failureCount: 0,
        circuitOpenedAt: null,
      })

      await this.trackCircuitStateChange(workerId, 'half-open', 'closed', now)
    }
  }

  /**
   * Track circuit state change as graph edge
   */
  private async trackCircuitStateChange(workerId: string, fromState: CircuitState, toState: CircuitState, timestamp: number): Promise<void> {
    const stateChangeId = `circuit-state-${workerId}-${timestamp}-${this.eventCounter++}`
    await this.graph.createNode(
      'CircuitStateChange',
      {
        workerId,
        fromState,
        newState: toState,
        timestamp,
      },
      { id: stateChangeId }
    )

    await this.graph.createEdge(workerId, 'CIRCUIT_STATE_CHANGE', stateChangeId, {
      fromState,
      newState: toState,
      timestamp,
    })
  }

  /**
   * Check and update circuit breaker states
   */
  async checkCircuitBreakers(): Promise<void> {
    const now = Date.now()
    const workers = await this.graph.queryNodes({
      label: 'Worker',
      where: {
        circuitState: 'open',
      },
    })

    for (const worker of workers) {
      const resetTimeout = (worker.properties.cbResetTimeout as number) ?? this.circuitBreakerConfig.resetTimeout
      const circuitOpenedAt = worker.properties.circuitOpenedAt as number

      if (circuitOpenedAt && (now - circuitOpenedAt) >= resetTimeout) {
        await this.graph.updateNode(worker.id, {
          circuitState: 'half-open',
        })

        await this.trackCircuitStateChange(worker.id, 'open', 'half-open', now)
      }
    }
  }

  /**
   * Route with circuit breaker probe for half-open circuits
   */
  async routeWithCircuitBreakerProbe(task: TaskRequest): Promise<ExtendedRouteResult> {
    // Find half-open workers
    const halfOpenWorkers = await this.graph.queryNodes({
      label: 'Worker',
      where: {
        circuitState: 'half-open',
      },
    })

    if (halfOpenWorkers.length > 0) {
      const worker = halfOpenWorkers[0]!
      return {
        workerId: worker.id,
        endpoint: worker.properties.endpoint as string,
        strategy: 'round-robin',
        timestamp: Date.now(),
        isProbeRequest: true,
      }
    }

    // No half-open circuits - normal routing
    const result = await this.route(task, 'round-robin')
    return { ...result, isProbeRequest: false }
  }

  /**
   * Get failure rate for worker in sliding window
   */
  async getWorkerFailureRate(workerId: string, windowMs: number): Promise<number> {
    const now = Date.now()
    const windowStart = now - windowMs

    // Query failure events
    const failures = await this.graph.queryNodes({
      label: 'FailureEvent',
      where: {
        workerId,
        timestamp: { $gte: windowStart },
      },
    })

    // Query success events
    const successes = await this.graph.queryNodes({
      label: 'SuccessEvent',
      where: {
        workerId,
        timestamp: { $gte: windowStart },
      },
    })

    const total = failures.length + successes.length
    if (total === 0) return 0

    return failures.length / total
  }

  /**
   * Prune old failure events outside sliding window
   */
  async pruneOldFailureEvents(): Promise<void> {
    const windowSize = this.circuitBreakerConfig.slidingWindow?.windowSize ?? 60000
    const cutoff = Date.now() - windowSize

    const oldEvents = await this.graph.queryNodes({
      label: 'FailureEvent',
      where: {
        timestamp: { $lt: cutoff },
      },
    })

    for (const event of oldEvents) {
      await this.graph.deleteNode(event.id)
    }
  }

  // ===========================================================================
  // CIRCUIT BREAKER DEPENDENCIES AND CASCADING
  // ===========================================================================

  /**
   * Set dependency between workers
   */
  async setWorkerDependency(dependentWorkerId: string, dependsOnWorkerId: string): Promise<void> {
    await this.graph.createEdge(dependentWorkerId, 'DEPENDS_ON', dependsOnWorkerId, {
      createdAt: Date.now(),
    })
  }

  /**
   * Get worker dependencies
   */
  async getWorkerDependencies(workerId: string): Promise<string[]> {
    const edges = await this.graph.queryEdges({
      type: 'DEPENDS_ON',
      from: workerId,
    })

    return edges.map(e => e.to)
  }

  /**
   * Propagate circuit state to dependent workers
   */
  async propagateCircuitState(): Promise<void> {
    const openWorkers = await this.graph.queryNodes({
      label: 'Worker',
      where: {
        circuitState: 'open',
      },
    })

    for (const openWorker of openWorkers) {
      // Find workers that depend on this one using traverse
      const result = await this.graph.traverse({
        start: openWorker.id,
        direction: 'INCOMING',
        maxDepth: 5,
        filter: { type: 'DEPENDS_ON' },
      })

      for (const dependentNode of result.nodes) {
        if (dependentNode.label === 'Worker') {
          const currentState = dependentNode.properties.circuitState as CircuitState
          if (currentState !== 'open') {
            await this.graph.updateNode(dependentNode.id, {
              circuitState: 'open',
              circuitOpenReason: 'dependency-failure',
            })

            await this.trackCircuitStateChange(dependentNode.id, currentState ?? 'closed', 'open', Date.now())
          }
        }
      }
    }
  }

  // ===========================================================================
  // CIRCUIT BREAKER METRICS
  // ===========================================================================

  /**
   * Get circuit breaker statistics
   */
  async getCircuitBreakerStats(): Promise<CircuitBreakerStats> {
    const workers = await this.graph.queryNodes({ label: 'Worker' })

    let openCircuits = 0
    let closedCircuits = 0
    let halfOpenCircuits = 0

    for (const worker of workers) {
      const state = (worker.properties.circuitState as CircuitState) ?? 'closed'
      switch (state) {
        case 'open':
          openCircuits++
          break
        case 'closed':
          closedCircuits++
          break
        case 'half-open':
          halfOpenCircuits++
          break
      }
    }

    const failures = await this.graph.queryNodes({ label: 'FailureEvent' })
    const successes = await this.graph.queryNodes({ label: 'SuccessEvent' })

    return {
      openCircuits,
      closedCircuits,
      halfOpenCircuits,
      totalFailures: failures.length,
      totalSuccesses: successes.length,
    }
  }

  /**
   * Get circuit trip frequency for a worker
   */
  async getCircuitTripFrequency(workerId: string, windowMs: number): Promise<number> {
    const windowStart = Date.now() - windowMs

    const stateChanges = await this.graph.queryEdges({
      type: 'CIRCUIT_STATE_CHANGE',
      from: workerId,
      where: {
        newState: 'open',
        timestamp: { $gte: windowStart },
      },
    })

    return stateChanges.length
  }

  /**
   * Identify flapping circuits
   */
  async identifyFlappingCircuits(tripThreshold: number, windowMs: number): Promise<string[]> {
    const workers = await this.graph.queryNodes({ label: 'Worker' })
    const flapping: string[] = []

    for (const worker of workers) {
      const frequency = await this.getCircuitTripFrequency(worker.id, windowMs)
      if (frequency >= tripThreshold) {
        flapping.push(worker.id)
      }
    }

    return flapping
  }

  /**
   * Get mean time to recovery for a worker
   */
  async getMeanTimeToRecovery(workerId: string): Promise<number> {
    const stateChanges = await this.graph.queryEdges({
      type: 'CIRCUIT_STATE_CHANGE',
      from: workerId,
    })

    // Find pairs of open -> closed transitions
    let totalRecoveryTime = 0
    let recoveryCount = 0

    const openTimestamps: number[] = []

    // Sort by timestamp
    const sorted = stateChanges.sort((a, b) =>
      (a.properties.timestamp as number) - (b.properties.timestamp as number)
    )

    for (const change of sorted) {
      const newState = change.properties.newState as CircuitState
      const timestamp = change.properties.timestamp as number

      if (newState === 'open') {
        openTimestamps.push(timestamp)
      } else if (newState === 'closed' && openTimestamps.length > 0) {
        const openedAt = openTimestamps.shift()!
        totalRecoveryTime += timestamp - openedAt
        recoveryCount++
      }
    }

    if (recoveryCount === 0) {
      // No recoveries yet - return time since last open
      if (openTimestamps.length > 0) {
        return Date.now() - openTimestamps[0]!
      }
      return 0
    }

    return totalRecoveryTime / recoveryCount
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
 * Interface for simple load balancers
 * @deprecated Use LoadBalancer from './types' instead
 */
export interface SimpleLoadBalancer extends LoadBalancer {}

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
export function createGraphCapabilityBalancer(graph: GraphEngine): SimpleLoadBalancer {
  const balancer = new GraphLoadBalancer(graph)

  return {
    async route(task: TaskRequest): Promise<RouteResult> {
      return balancer.route(task, 'capability')
    },
  }
}
