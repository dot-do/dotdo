/**
 * Capability Tier Routing
 *
 * Implements capability tier routing for workers (agents and humans).
 * Tasks are routed based on complexity levels:
 * - Code (1-2): Fast, deterministic operations
 * - Generative (3-5): AI generation tasks
 * - Agentic (6-8): Multi-step reasoning
 * - Human (9-10): Oversight, judgment, approval
 *
 * @module workers/capability-tier-routing
 */

import { GraphEngine, type Node, type Edge } from '../db/graph'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Capability tier levels in ascending order of complexity handling
 */
export type CapabilityTier = 'code' | 'generative' | 'agentic' | 'human'

/**
 * Task request with complexity and requirements
 */
export interface TaskRequest {
  id: string
  type: string
  complexity?: number
  requiredTools?: string[]
  input?: unknown
  metadata?: Record<string, unknown>
}

/**
 * Result of tier selection or routing
 */
export interface TierRouteResult {
  tier: CapabilityTier
  workerId: string | null
  reason?: string
  escalatedFrom?: CapabilityTier
  skippedTiers?: CapabilityTier[]
  routedAt: number
}

/**
 * Result of checking if a tier can handle a task
 */
export interface TierCapabilityResult {
  canHandle: boolean
  missingTools: string[]
  availableTools: string[]
}

/**
 * Worker node in the graph
 */
export interface WorkerNode {
  id: string
  tier: CapabilityTier
  endpoint: string
  status: 'available' | 'busy' | 'offline'
  tools: string[]
  additionalTools?: string[]
}

/**
 * Worker registration input
 */
export interface WorkerRegistration {
  id: string
  tier: CapabilityTier
  endpoint: string
  additionalTools?: string[]
}

/**
 * Escalation record
 */
export interface EscalationRecord {
  from: CapabilityTier
  to: CapabilityTier
  reason: string
  timestamp: number
  taskId: string
}

/**
 * Escalation options
 */
export interface EscalationOptions {
  skipTo?: CapabilityTier
  allowDowngrade?: boolean
}

/**
 * Tier profile for custom configurations
 */
export interface TierProfile {
  complexityRange: [number, number]
  tools: string[]
  escalatesTo: CapabilityTier | null
}

/**
 * Routing history entry
 */
export interface RoutingHistoryEntry {
  taskId: string
  tier: CapabilityTier
  workerId: string | null
  timestamp: number
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Tier order from lowest to highest capability
 */
export const TIER_ORDER: CapabilityTier[] = ['code', 'generative', 'agentic', 'human']

/**
 * Tools available at each tier (tier-specific tools only, not cumulative)
 */
export const TIER_TOOLS: Record<CapabilityTier, string[]> = {
  code: ['calculate', 'lookup', 'validate', 'transform'],
  generative: ['generate', 'summarize', 'analyze', 'classify'],
  agentic: ['browse', 'execute', 'plan', 'delegate'],
  human: ['approve', 'review', 'decide', 'escalate'],
}

/**
 * Capability tier definitions with complexity ranges
 */
export const CAPABILITY_TIERS: Record<CapabilityTier, { minComplexity: number; maxComplexity: number }> = {
  code: { minComplexity: 1, maxComplexity: 2 },
  generative: { minComplexity: 3, maxComplexity: 5 },
  agentic: { minComplexity: 6, maxComplexity: 8 },
  human: { minComplexity: 9, maxComplexity: 10 },
}

/**
 * Task types that indicate higher complexity
 */
const HIGH_COMPLEXITY_TYPES = ['approve', 'review', 'decide', 'escalate', 'judge', 'authorize']
const MEDIUM_COMPLEXITY_TYPES = ['plan', 'execute', 'browse', 'delegate', 'coordinate']
const LOW_COMPLEXITY_TYPES = ['lookup', 'calculate', 'validate', 'transform', 'fetch']

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Compare two tiers, returning negative if a < b, positive if a > b, 0 if equal
 */
export function compareTiers(a: CapabilityTier, b: CapabilityTier): number {
  return TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b)
}

/**
 * Get the next tier in the escalation path
 */
export function getNextTier(tier: CapabilityTier): CapabilityTier | null {
  const index = TIER_ORDER.indexOf(tier)
  if (index >= TIER_ORDER.length - 1) {
    return null
  }
  return TIER_ORDER[index + 1]!
}

/**
 * Map complexity level to appropriate tier
 */
export function matchTierToComplexity(complexity: number): CapabilityTier {
  // Clamp complexity to valid range
  const clamped = Math.max(1, Math.min(10, complexity))

  for (const tier of TIER_ORDER) {
    const { minComplexity, maxComplexity } = CAPABILITY_TIERS[tier]
    if (clamped >= minComplexity && clamped <= maxComplexity) {
      return tier
    }
  }

  // Default to human for anything out of range (should not happen with clamping)
  return 'human'
}

/**
 * Assess complexity of a task based on its properties
 */
export function assessComplexity(task: Partial<TaskRequest>): number {
  let complexity = 3 // Default medium complexity

  // Factor in task type
  if (task.type) {
    if (HIGH_COMPLEXITY_TYPES.includes(task.type.toLowerCase())) {
      complexity += 4
    } else if (MEDIUM_COMPLEXITY_TYPES.includes(task.type.toLowerCase())) {
      complexity += 2
    } else if (LOW_COMPLEXITY_TYPES.includes(task.type.toLowerCase())) {
      complexity -= 1
    }
  }

  // Factor in input complexity
  if (task.input) {
    const inputStr = JSON.stringify(task.input)
    if (inputStr.length > 1000) {
      complexity += 2
    } else if (inputStr.length > 500) {
      complexity += 1
    }

    // Nested objects indicate complexity
    const depth = getObjectDepth(task.input)
    complexity += Math.min(depth - 1, 2)
  }

  // Clamp to valid range
  return Math.max(1, Math.min(10, complexity))
}

/**
 * Get the depth of a nested object
 */
function getObjectDepth(obj: unknown, depth = 1): number {
  if (typeof obj !== 'object' || obj === null) {
    return depth
  }

  let maxDepth = depth
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null) {
      maxDepth = Math.max(maxDepth, getObjectDepth(value, depth + 1))
    }
  }
  return maxDepth
}

/**
 * Get all tools available at a tier (cumulative from lower tiers)
 */
export function getToolsForTier(tier: CapabilityTier): string[] {
  const tierIndex = TIER_ORDER.indexOf(tier)
  const tools: string[] = []

  for (let i = 0; i <= tierIndex; i++) {
    tools.push(...TIER_TOOLS[TIER_ORDER[i]!])
  }

  return tools
}

// =============================================================================
// TIER REGISTRY
// =============================================================================

/**
 * Registry for custom tier profiles
 */
export class TierRegistry {
  private profiles: Map<string, TierProfile> = new Map()

  /**
   * Register a custom tier profile
   */
  registerProfile(name: string, profile: TierProfile): void {
    // Validate complexity range
    if (profile.complexityRange[0] > profile.complexityRange[1]) {
      throw new Error('Invalid complexity range: min must be <= max')
    }

    this.profiles.set(name, profile)
  }

  /**
   * Get a tier profile by name
   */
  getProfile(name: string): TierProfile | undefined {
    return this.profiles.get(name)
  }

  /**
   * Check if a profile exists
   */
  hasProfile(name: string): boolean {
    return this.profiles.has(name)
  }

  /**
   * Remove a tier profile
   */
  removeProfile(name: string): boolean {
    return this.profiles.delete(name)
  }
}

// =============================================================================
// CAPABILITY TIER ROUTER
// =============================================================================

/**
 * Routes tasks to workers based on capability tiers
 */
export class CapabilityTierRouter {
  private graph: GraphEngine
  private escalationHistory: Map<string, EscalationRecord[]> = new Map()
  private routingHistory: RoutingHistoryEntry[] = []
  private roundRobinIndex: Map<CapabilityTier, number> = new Map()

  constructor(graph: GraphEngine) {
    this.graph = graph
  }

  // ---------------------------------------------------------------------------
  // TIER SELECTION
  // ---------------------------------------------------------------------------

  /**
   * Select the appropriate tier for a task
   */
  async selectTier(task: TaskRequest): Promise<TierRouteResult> {
    const complexity = task.complexity ?? assessComplexity(task)
    const tier = matchTierToComplexity(complexity)

    return {
      tier,
      workerId: null,
      routedAt: Date.now(),
    }
  }

  /**
   * Route a task to a worker at the appropriate tier
   */
  async route(task: TaskRequest): Promise<TierRouteResult> {
    const complexity = task.complexity ?? assessComplexity(task)
    let tier = matchTierToComplexity(complexity)
    let reason: string | undefined

    // Check if task requires specific tools
    if (task.requiredTools && task.requiredTools.length > 0) {
      const minTier = this.findMinimumTierForTools(task.requiredTools)
      if (compareTiers(minTier, tier) > 0) {
        tier = minTier
        reason = `Required tools only available at ${tier} tier`
      }
    }

    // Find an available worker at the tier
    const workers = await this.getWorkersByTier(tier)
    const availableWorkers = workers.filter(w => w.status === 'available')

    let workerId: string | null = null
    if (availableWorkers.length > 0) {
      // Round-robin selection
      const index = this.roundRobinIndex.get(tier) ?? 0
      workerId = availableWorkers[index % availableWorkers.length]!.id
      this.roundRobinIndex.set(tier, index + 1)
    }

    const result: TierRouteResult = {
      tier,
      workerId,
      reason,
      routedAt: Date.now(),
    }

    // Record routing decision in graph
    await this.recordRouting(task, result)

    // Track in history
    this.routingHistory.push({
      taskId: task.id,
      tier,
      workerId,
      timestamp: Date.now(),
    })

    return result
  }

  /**
   * Find the minimum tier that has all required tools
   */
  private findMinimumTierForTools(requiredTools: string[]): CapabilityTier {
    for (const tier of TIER_ORDER) {
      const availableTools = getToolsForTier(tier)
      if (requiredTools.every(t => availableTools.includes(t))) {
        return tier
      }
    }
    return 'human' // Default to highest tier
  }

  // ---------------------------------------------------------------------------
  // ESCALATION
  // ---------------------------------------------------------------------------

  /**
   * Escalate a task to a higher tier
   */
  async escalate(
    task: TaskRequest,
    fromTier: CapabilityTier,
    reason: string,
    options?: EscalationOptions
  ): Promise<TierRouteResult> {
    const taskHistory = this.escalationHistory.get(task.id) ?? []

    // Check for circular escalation
    if (options?.allowDowngrade) {
      const visitedTiers = new Set(taskHistory.map(h => h.from))
      visitedTiers.add(fromTier)
      // If we've been through all tiers and are trying to go back
      if (visitedTiers.size >= TIER_ORDER.length) {
        throw new Error('Circular escalation detected')
      }
    }

    // Cannot escalate beyond human
    if (fromTier === 'human' && !options?.skipTo) {
      throw new Error('Cannot escalate beyond human tier')
    }

    let targetTier: CapabilityTier

    if (options?.skipTo) {
      // Skip-tier escalation requires justification
      if (!reason || reason.trim() === '') {
        throw new Error('Skip-tier escalation requires justification')
      }
      targetTier = options.skipTo
    } else {
      const nextTier = getNextTier(fromTier)
      if (!nextTier) {
        throw new Error('Cannot escalate beyond human tier')
      }
      targetTier = nextTier
    }

    // Calculate skipped tiers if any
    const skippedTiers: CapabilityTier[] = []
    if (options?.skipTo) {
      const fromIndex = TIER_ORDER.indexOf(fromTier)
      const toIndex = TIER_ORDER.indexOf(targetTier)
      for (let i = fromIndex + 1; i < toIndex; i++) {
        skippedTiers.push(TIER_ORDER[i]!)
      }
    }

    // Record escalation
    const escalationRecord: EscalationRecord = {
      from: fromTier,
      to: targetTier,
      reason,
      timestamp: Date.now(),
      taskId: task.id,
    }
    taskHistory.push(escalationRecord)
    this.escalationHistory.set(task.id, taskHistory)

    // Record in graph
    await this.recordEscalation(task, escalationRecord)

    // Route to new tier
    const workers = await this.getWorkersByTier(targetTier)
    const availableWorkers = workers.filter(w => w.status === 'available')

    let workerId: string | null = null
    if (availableWorkers.length > 0) {
      const index = this.roundRobinIndex.get(targetTier) ?? 0
      workerId = availableWorkers[index % availableWorkers.length]!.id
      this.roundRobinIndex.set(targetTier, index + 1)
    }

    return {
      tier: targetTier,
      workerId,
      reason,
      escalatedFrom: fromTier,
      skippedTiers: skippedTiers.length > 0 ? skippedTiers : undefined,
      routedAt: Date.now(),
    }
  }

  /**
   * Get escalation history for a task
   */
  async getEscalationHistory(taskId: string): Promise<EscalationRecord[]> {
    return this.escalationHistory.get(taskId) ?? []
  }

  // ---------------------------------------------------------------------------
  // TOOLS
  // ---------------------------------------------------------------------------

  /**
   * Get tools available at a tier
   */
  getToolsForTier(tier: CapabilityTier): string[] {
    return getToolsForTier(tier)
  }

  /**
   * Check if a tier can handle a task based on required tools
   */
  async canTierHandleTask(tier: CapabilityTier, task: TaskRequest): Promise<TierCapabilityResult> {
    const availableTools = getToolsForTier(tier)
    const requiredTools = task.requiredTools ?? []
    const missingTools = requiredTools.filter(t => !availableTools.includes(t))

    return {
      canHandle: missingTools.length === 0,
      missingTools,
      availableTools,
    }
  }

  // ---------------------------------------------------------------------------
  // WORKER MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Register a worker with a tier
   */
  async registerWorker(registration: WorkerRegistration): Promise<WorkerNode> {
    const tools = [
      ...getToolsForTier(registration.tier),
      ...(registration.additionalTools ?? []),
    ]

    const worker: WorkerNode = {
      id: registration.id,
      tier: registration.tier,
      endpoint: registration.endpoint,
      status: 'available',
      tools,
    }

    // Create graph node
    await this.graph.createNode('Worker', {
      tier: registration.tier,
      endpoint: registration.endpoint,
      status: 'available',
      tools,
    }, { id: registration.id })

    // Create capability edges
    for (const tool of tools) {
      // Create capability node if it doesn't exist
      let capNode = await this.graph.getNode(`cap-${tool}`)
      if (!capNode) {
        capNode = await this.graph.createNode('Capability', { name: tool }, { id: `cap-${tool}` })
      }
      await this.graph.createEdge(registration.id, 'HAS_CAPABILITY', capNode.id)
    }

    return worker
  }

  /**
   * Deregister a worker
   */
  async deregisterWorker(workerId: string): Promise<void> {
    await this.graph.deleteNode(workerId)
  }

  /**
   * Get workers by tier
   */
  async getWorkersByTier(tier: CapabilityTier): Promise<WorkerNode[]> {
    const nodes = await this.graph.queryNodes({
      label: 'Worker',
      where: { tier },
    })

    return nodes.map(node => ({
      id: node.id,
      tier: node.properties.tier as CapabilityTier,
      endpoint: node.properties.endpoint as string,
      status: node.properties.status as 'available' | 'busy' | 'offline',
      tools: node.properties.tools as string[],
    }))
  }

  // ---------------------------------------------------------------------------
  // HISTORY AND ANALYTICS
  // ---------------------------------------------------------------------------

  /**
   * Get routing history
   */
  async getRoutingHistory(): Promise<RoutingHistoryEntry[]> {
    return [...this.routingHistory]
  }

  // ---------------------------------------------------------------------------
  // GRAPH RECORDING
  // ---------------------------------------------------------------------------

  /**
   * Record routing decision in graph
   */
  private async recordRouting(task: TaskRequest, result: TierRouteResult): Promise<void> {
    // Create task node if it doesn't exist
    let taskNode = await this.graph.getNode(`task-${task.id}`)
    if (!taskNode) {
      taskNode = await this.graph.createNode('Task', {
        type: task.type,
        complexity: task.complexity,
      }, { id: `task-${task.id}` })
    }

    // Create ROUTED_TO_TIER edge
    await this.graph.createEdge(taskNode.id, 'ROUTED_TO_TIER', taskNode.id, {
      taskId: task.id,
      tier: result.tier,
      workerId: result.workerId,
      timestamp: result.routedAt,
    })

    // Create ASSIGNED_TO edge if worker was assigned
    if (result.workerId) {
      await this.graph.createEdge(taskNode.id, 'ASSIGNED_TO', result.workerId, {
        taskId: task.id,
        tier: result.tier,
        timestamp: result.routedAt,
      })
    }
  }

  /**
   * Record escalation decision in graph
   */
  private async recordEscalation(task: TaskRequest, record: EscalationRecord): Promise<void> {
    // Create task node if it doesn't exist
    let taskNode = await this.graph.getNode(`task-${task.id}`)
    if (!taskNode) {
      taskNode = await this.graph.createNode('Task', {
        type: task.type,
        complexity: task.complexity,
      }, { id: `task-${task.id}` })
    }

    // Create ESCALATED_TO edge
    await this.graph.createEdge(taskNode.id, 'ESCALATED_TO', taskNode.id, {
      taskId: task.id,
      fromTier: record.from,
      toTier: record.to,
      reason: record.reason,
      timestamp: record.timestamp,
    })
  }
}
