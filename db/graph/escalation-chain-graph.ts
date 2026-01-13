/**
 * Escalation Chain Graph Queries
 *
 * Implements graph queries for escalation chains that cascade errors through
 * capability tiers: Code -> Generative -> Agentic -> Human
 *
 * ## Graph Structure:
 *
 * - **EscalationChain**: Root node representing an escalation chain instance
 * - **EscalationStep**: Node for each step in the chain
 * - **EscalationTarget**: Node representing escalation targets (roles, humans)
 *
 * ## Relationships:
 *
 * - EscalationChain `hasStep` EscalationStep
 * - EscalationStep `escalatedTo` EscalationStep (chain progression)
 * - EscalationStep `targetedBy` EscalationTarget
 * - EscalationStep `resolvedBy` EscalationTarget
 *
 * ## Key Features:
 *
 * 1. Chain traversal queries - Walk the escalation path
 * 2. Next target resolution - Find who should handle next
 * 3. Metrics calculation - Success rates, resolution times
 * 4. Pattern detection - Identify problematic escalation patterns
 *
 * @module db/graph/escalation-chain-graph
 *
 * @see dotdo-b9atm - [GREEN] Implement escalation chain graph queries
 */

import type { GraphEngine, Node, Edge, TraversalResult } from './index'
import type { CapabilityTier, ErrorSeverity, EscalationRecord } from '../../lib/errors/escalation-chain'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Capability tier order for escalation chain
 */
export const TIER_ORDER: CapabilityTier[] = ['code', 'generative', 'agentic', 'human']

/**
 * Escalation chain node in the graph
 */
export interface EscalationChainNode {
  /** Unique chain ID */
  id: string
  /** When the chain started */
  startedAt: number
  /** When the chain completed (if completed) */
  completedAt?: number
  /** Whether the chain was successful */
  success: boolean
  /** Whether all tiers were exhausted */
  exhausted: boolean
  /** Original error message */
  errorMessage: string
  /** Original error code */
  errorCode?: string
  /** Error severity */
  severity: ErrorSeverity
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Escalation step node in the graph
 */
export interface EscalationStepNode {
  /** Step ID */
  id: string
  /** Chain ID this step belongs to */
  chainId: string
  /** Capability tier */
  tier: CapabilityTier
  /** Step index in the chain (0-based) */
  stepIndex: number
  /** Whether this step succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Duration in milliseconds */
  duration: number
  /** When the step started */
  timestamp: number
  /** Resolution value if succeeded */
  resolution?: unknown
}

/**
 * Escalation target node (role, human, or service)
 */
export interface EscalationTargetNode {
  /** Target ID */
  id: string
  /** Target type (role, human, service) */
  type: 'role' | 'human' | 'service'
  /** Target name */
  name: string
  /** Capability tier this target handles */
  tier: CapabilityTier
  /** Priority for this tier (lower = higher priority) */
  priority: number
  /** Whether the target is available */
  available: boolean
  /** SLA in milliseconds */
  sla?: number
  /** Success rate (0-1) */
  successRate?: number
  /** Average response time in milliseconds */
  avgResponseTime?: number
}

/**
 * Options for finding next escalation target
 */
export interface FindNextTargetOptions {
  /** Current tier (to find next tier's target) */
  currentTier?: CapabilityTier
  /** Prefer targets with higher success rates */
  preferHighSuccessRate?: boolean
  /** Only consider available targets */
  availableOnly?: boolean
  /** Maximum SLA in milliseconds */
  maxSla?: number
  /** Exclude these target IDs */
  excludeTargets?: string[]
}

/**
 * Options for chain traversal
 */
export interface ChainTraversalOptions {
  /** Maximum depth to traverse */
  maxDepth?: number
  /** Only include successful steps */
  successfulOnly?: boolean
  /** Filter by tier */
  tier?: CapabilityTier
  /** Include resolution data */
  includeResolutions?: boolean
}

/**
 * Escalation chain metrics
 */
export interface EscalationChainMetrics {
  /** Total number of chains */
  totalChains: number
  /** Number of successful chains */
  successfulChains: number
  /** Number of exhausted chains (all tiers failed) */
  exhaustedChains: number
  /** Success rate (0-1) */
  successRate: number
  /** Resolution counts by tier */
  resolvedByTier: Record<CapabilityTier, number>
  /** Average escalation depth (number of tiers tried) */
  averageEscalationDepth: number
  /** Average chain duration in milliseconds */
  averageDuration: number
  /** Counts by severity */
  bySeverity: Record<ErrorSeverity, number>
  /** Most common error codes */
  topErrorCodes: Array<{ code: string; count: number }>
}

/**
 * Escalation pattern detected in the graph
 */
export interface EscalationPattern {
  /** Pattern type */
  type: 'repeated-escalation' | 'tier-bottleneck' | 'circular-escalation' | 'timeout-spike'
  /** Description */
  description: string
  /** Affected tier(s) */
  affectedTiers: CapabilityTier[]
  /** Number of occurrences */
  occurrences: number
  /** Severity of the pattern */
  severity: 'low' | 'medium' | 'high'
  /** Suggested action */
  suggestion: string
}

// ============================================================================
// GRAPH LABELS AND EDGE TYPES
// ============================================================================

export const ESCALATION_LABELS = {
  chain: 'EscalationChain',
  step: 'EscalationStep',
  target: 'EscalationTarget',
} as const

export const ESCALATION_EDGES = {
  hasStep: 'HAS_STEP',
  escalatedTo: 'ESCALATED_TO',
  targetedBy: 'TARGETED_BY',
  resolvedBy: 'RESOLVED_BY',
  nextTarget: 'NEXT_TARGET',
} as const

// ============================================================================
// ESCALATION CHAIN GRAPH SERVICE
// ============================================================================

/**
 * EscalationChainGraph provides graph-based queries for escalation chains.
 *
 * @example
 * ```typescript
 * const graph = new GraphEngine()
 * const escalationGraph = new EscalationChainGraph(graph)
 *
 * // Create a chain
 * const chain = await escalationGraph.createChain({
 *   errorMessage: 'Connection failed',
 *   severity: 'medium',
 * })
 *
 * // Record steps
 * await escalationGraph.recordStep(chain.id, {
 *   tier: 'code',
 *   success: false,
 *   error: 'Retry exhausted',
 *   duration: 1500,
 * })
 *
 * // Find next target
 * const nextTarget = await escalationGraph.findNextTarget({
 *   currentTier: 'code',
 *   availableOnly: true,
 * })
 *
 * // Get chain traversal
 * const path = await escalationGraph.traverseChain(chain.id)
 *
 * // Calculate metrics
 * const metrics = await escalationGraph.calculateMetrics()
 * ```
 */
export class EscalationChainGraph {
  constructor(private graph: GraphEngine) {}

  // ==========================================================================
  // CHAIN OPERATIONS
  // ==========================================================================

  /**
   * Create a new escalation chain.
   *
   * @param options - Chain creation options
   * @returns The created chain node
   */
  async createChain(options: {
    errorMessage: string
    errorCode?: string
    severity: ErrorSeverity
    metadata?: Record<string, unknown>
  }): Promise<Node> {
    const id = `chain-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

    const properties: EscalationChainNode = {
      id,
      startedAt: Date.now(),
      success: false,
      exhausted: false,
      errorMessage: options.errorMessage,
      errorCode: options.errorCode,
      severity: options.severity,
      metadata: options.metadata,
    }

    return this.graph.createNode(ESCALATION_LABELS.chain, properties, { id })
  }

  /**
   * Get an escalation chain by ID.
   *
   * @param chainId - The chain ID
   * @returns The chain node or null
   */
  async getChain(chainId: string): Promise<Node | null> {
    return this.graph.getNode(chainId)
  }

  /**
   * Complete an escalation chain.
   *
   * @param chainId - The chain ID
   * @param success - Whether the chain was successful
   * @param resolvedByTier - Which tier resolved the chain (if successful)
   * @returns The updated chain node
   */
  async completeChain(
    chainId: string,
    success: boolean,
    resolvedByTier?: CapabilityTier
  ): Promise<Node> {
    const updates: Partial<EscalationChainNode> = {
      completedAt: Date.now(),
      success,
      exhausted: !success,
    }

    if (resolvedByTier) {
      updates.metadata = { ...(await this.getChain(chainId))?.properties.metadata as Record<string, unknown>, resolvedByTier }
    }

    return this.graph.updateNode(chainId, updates)
  }

  // ==========================================================================
  // STEP OPERATIONS
  // ==========================================================================

  /**
   * Record an escalation step.
   *
   * @param chainId - The chain this step belongs to
   * @param step - Step data
   * @returns The created step node
   */
  async recordStep(chainId: string, step: {
    tier: CapabilityTier
    success: boolean
    error?: string
    duration: number
    resolution?: unknown
  }): Promise<Node> {
    // Get existing steps to determine index
    const existingSteps = await this.getChainSteps(chainId)
    const stepIndex = existingSteps.length

    const stepId = `step-${chainId}-${stepIndex}`
    const properties: EscalationStepNode = {
      id: stepId,
      chainId,
      tier: step.tier,
      stepIndex,
      success: step.success,
      error: step.error,
      duration: step.duration,
      timestamp: Date.now(),
      resolution: step.resolution,
    }

    const stepNode = await this.graph.createNode(ESCALATION_LABELS.step, properties, { id: stepId })

    // Create HAS_STEP edge from chain to step
    await this.graph.createEdge(chainId, ESCALATION_EDGES.hasStep, stepId, { index: stepIndex })

    // If there's a previous step, create ESCALATED_TO edge
    if (stepIndex > 0) {
      const prevStepId = `step-${chainId}-${stepIndex - 1}`
      await this.graph.createEdge(prevStepId, ESCALATION_EDGES.escalatedTo, stepId)
    }

    return stepNode
  }

  /**
   * Get all steps for a chain.
   *
   * @param chainId - The chain ID
   * @returns Array of step nodes
   */
  async getChainSteps(chainId: string): Promise<Node[]> {
    const steps = await this.graph.queryNodes({
      label: ESCALATION_LABELS.step,
      where: { chainId },
      orderBy: { stepIndex: 'asc' },
    })
    return steps
  }

  /**
   * Get the last step in a chain.
   *
   * @param chainId - The chain ID
   * @returns The last step or null
   */
  async getLastStep(chainId: string): Promise<Node | null> {
    const steps = await this.getChainSteps(chainId)
    return steps.length > 0 ? steps[steps.length - 1]! : null
  }

  // ==========================================================================
  // TARGET OPERATIONS
  // ==========================================================================

  /**
   * Register an escalation target.
   *
   * @param target - Target configuration
   * @returns The created target node
   */
  async registerTarget(target: {
    type: 'role' | 'human' | 'service'
    name: string
    tier: CapabilityTier
    priority?: number
    sla?: number
  }): Promise<Node> {
    const id = `target-${target.tier}-${target.name.toLowerCase().replace(/\s+/g, '-')}`

    const properties: EscalationTargetNode = {
      id,
      type: target.type,
      name: target.name,
      tier: target.tier,
      priority: target.priority ?? 1,
      available: true,
      sla: target.sla,
    }

    // Check if target already exists
    const existing = await this.graph.getNode(id)
    if (existing) {
      return this.graph.updateNode(id, properties)
    }

    return this.graph.createNode(ESCALATION_LABELS.target, properties, { id })
  }

  /**
   * Update target availability.
   *
   * @param targetId - The target ID
   * @param available - Whether the target is available
   * @returns The updated target node
   */
  async setTargetAvailability(targetId: string, available: boolean): Promise<Node> {
    return this.graph.updateNode(targetId, { available })
  }

  /**
   * Update target metrics (success rate, avg response time).
   *
   * @param targetId - The target ID
   * @param metrics - Metrics to update
   * @returns The updated target node
   */
  async updateTargetMetrics(targetId: string, metrics: {
    successRate?: number
    avgResponseTime?: number
  }): Promise<Node> {
    return this.graph.updateNode(targetId, metrics)
  }

  /**
   * Get all targets for a tier.
   *
   * @param tier - The capability tier
   * @param options - Query options
   * @returns Array of target nodes
   */
  async getTargetsForTier(tier: CapabilityTier, options?: {
    availableOnly?: boolean
    maxSla?: number
  }): Promise<Node[]> {
    const where: Record<string, unknown> = { tier }

    if (options?.availableOnly) {
      where.available = true
    }

    const targets = await this.graph.queryNodes({
      label: ESCALATION_LABELS.target,
      where,
      orderBy: { priority: 'asc' },
    })

    // Filter by SLA if specified
    if (options?.maxSla !== undefined) {
      return targets.filter(t => {
        const sla = t.properties.sla as number | undefined
        return sla === undefined || sla <= options.maxSla!
      })
    }

    return targets
  }

  // ==========================================================================
  // CHAIN TRAVERSAL QUERIES
  // ==========================================================================

  /**
   * Traverse an escalation chain from start to end.
   *
   * @param chainId - The chain ID
   * @param options - Traversal options
   * @returns Traversal result with nodes and edges
   */
  async traverseChain(chainId: string, options?: ChainTraversalOptions): Promise<{
    chain: Node | null
    steps: Node[]
    path: Edge[]
    depth: number
    resolvedByTier?: CapabilityTier
  }> {
    const chain = await this.getChain(chainId)
    if (!chain) {
      return { chain: null, steps: [], path: [], depth: 0 }
    }

    let steps = await this.getChainSteps(chainId)

    // Apply filters
    if (options?.successfulOnly) {
      steps = steps.filter(s => s.properties.success)
    }

    if (options?.tier) {
      steps = steps.filter(s => s.properties.tier === options.tier)
    }

    if (options?.maxDepth !== undefined) {
      steps = steps.slice(0, options.maxDepth)
    }

    // Get edges between steps (ESCALATED_TO)
    const path: Edge[] = []
    for (let i = 0; i < steps.length - 1; i++) {
      const edges = await this.graph.queryEdges({
        type: ESCALATION_EDGES.escalatedTo,
        from: steps[i]!.id,
        to: steps[i + 1]!.id,
      })
      if (edges.length > 0) {
        path.push(edges[0]!)
      }
    }

    // Find resolved tier
    const successfulStep = steps.find(s => s.properties.success)
    const resolvedByTier = successfulStep?.properties.tier as CapabilityTier | undefined

    return {
      chain,
      steps,
      path,
      depth: steps.length,
      resolvedByTier,
    }
  }

  /**
   * Find the escalation path from one tier to another.
   *
   * @param fromTier - Starting tier
   * @param toTier - Target tier
   * @returns Path of tiers to traverse
   */
  getEscalationPath(fromTier: CapabilityTier, toTier: CapabilityTier): CapabilityTier[] {
    const fromIndex = TIER_ORDER.indexOf(fromTier)
    const toIndex = TIER_ORDER.indexOf(toTier)

    if (fromIndex === -1 || toIndex === -1 || fromIndex >= toIndex) {
      return []
    }

    return TIER_ORDER.slice(fromIndex, toIndex + 1)
  }

  /**
   * Get all chains that were resolved at a specific tier.
   *
   * @param tier - The tier that resolved the chains
   * @param options - Query options
   * @returns Array of chain nodes
   */
  async getChainsResolvedByTier(tier: CapabilityTier, options?: {
    since?: number
    limit?: number
  }): Promise<Node[]> {
    // Get all successful steps at this tier
    const steps = await this.graph.queryNodes({
      label: ESCALATION_LABELS.step,
      where: {
        tier,
        success: true,
      },
      limit: options?.limit,
    })

    // Get unique chain IDs
    const chainIds = new Set<string>()
    for (const step of steps) {
      chainIds.add(step.properties.chainId as string)
    }

    // Fetch chains
    const chains: Node[] = []
    for (const chainId of chainIds) {
      const chain = await this.getChain(chainId)
      if (chain) {
        // Filter by time if specified
        if (options?.since && (chain.properties.startedAt as number) < options.since) {
          continue
        }
        chains.push(chain)
      }
    }

    return chains
  }

  // ==========================================================================
  // NEXT ESCALATION TARGET
  // ==========================================================================

  /**
   * Find the next escalation target based on current tier and options.
   *
   * @param options - Options for finding the target
   * @returns The best target or null if none available
   */
  async findNextTarget(options?: FindNextTargetOptions): Promise<Node | null> {
    // Determine the next tier
    let nextTier: CapabilityTier
    if (options?.currentTier) {
      const currentIndex = TIER_ORDER.indexOf(options.currentTier)
      if (currentIndex === -1 || currentIndex >= TIER_ORDER.length - 1) {
        return null // No next tier available
      }
      nextTier = TIER_ORDER[currentIndex + 1]!
    } else {
      nextTier = 'code' // Start from the beginning
    }

    // Get targets for the next tier
    let targets = await this.getTargetsForTier(nextTier, {
      availableOnly: options?.availableOnly,
      maxSla: options?.maxSla,
    })

    // Exclude specified targets
    if (options?.excludeTargets && options.excludeTargets.length > 0) {
      const excludeSet = new Set(options.excludeTargets)
      targets = targets.filter(t => !excludeSet.has(t.id))
    }

    if (targets.length === 0) {
      return null
    }

    // Sort by success rate if requested
    if (options?.preferHighSuccessRate) {
      targets.sort((a, b) => {
        const aRate = (a.properties.successRate as number) ?? 0
        const bRate = (b.properties.successRate as number) ?? 0
        return bRate - aRate
      })
    }

    return targets[0]!
  }

  /**
   * Get the complete escalation chain for a target (who they can escalate to).
   *
   * @param targetId - Starting target ID
   * @returns Array of potential escalation targets in order
   */
  async getTargetEscalationChain(targetId: string): Promise<Node[]> {
    const target = await this.graph.getNode(targetId)
    if (!target) {
      return []
    }

    const currentTier = target.properties.tier as CapabilityTier
    const tierIndex = TIER_ORDER.indexOf(currentTier)

    if (tierIndex === -1) {
      return []
    }

    const escalationChain: Node[] = []
    for (let i = tierIndex + 1; i < TIER_ORDER.length; i++) {
      const tier = TIER_ORDER[i]!
      const targets = await this.getTargetsForTier(tier, { availableOnly: true })
      if (targets.length > 0) {
        escalationChain.push(targets[0]!)
      }
    }

    return escalationChain
  }

  // ==========================================================================
  // METRICS CALCULATION
  // ==========================================================================

  /**
   * Calculate escalation chain metrics.
   *
   * @param options - Metrics options
   * @returns Calculated metrics
   */
  async calculateMetrics(options?: {
    since?: number
    until?: number
  }): Promise<EscalationChainMetrics> {
    // Get all chains
    let chains = await this.graph.queryNodes({
      label: ESCALATION_LABELS.chain,
    })

    // Filter by time range
    if (options?.since) {
      chains = chains.filter(c => (c.properties.startedAt as number) >= options.since!)
    }
    if (options?.until) {
      chains = chains.filter(c => (c.properties.startedAt as number) <= options.until!)
    }

    const metrics: EscalationChainMetrics = {
      totalChains: chains.length,
      successfulChains: 0,
      exhaustedChains: 0,
      successRate: 0,
      resolvedByTier: { code: 0, generative: 0, agentic: 0, human: 0 },
      averageEscalationDepth: 0,
      averageDuration: 0,
      bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
      topErrorCodes: [],
    }

    if (chains.length === 0) {
      return metrics
    }

    let totalDepth = 0
    let totalDuration = 0
    const errorCodeCounts = new Map<string, number>()

    for (const chain of chains) {
      const props = chain.properties as unknown as EscalationChainNode

      // Count by success/exhausted
      if (props.success) {
        metrics.successfulChains++
      }
      if (props.exhausted) {
        metrics.exhaustedChains++
      }

      // Count by severity
      metrics.bySeverity[props.severity]++

      // Count error codes
      if (props.errorCode) {
        errorCodeCounts.set(props.errorCode, (errorCodeCounts.get(props.errorCode) ?? 0) + 1)
      }

      // Get chain steps to calculate depth and resolved tier
      const steps = await this.getChainSteps(chain.id)
      totalDepth += steps.length

      // Find resolved tier
      const successfulStep = steps.find(s => s.properties.success)
      if (successfulStep) {
        const tier = successfulStep.properties.tier as CapabilityTier
        metrics.resolvedByTier[tier]++
      }

      // Calculate duration
      if (props.completedAt && props.startedAt) {
        totalDuration += props.completedAt - props.startedAt
      }
    }

    // Calculate averages
    metrics.successRate = metrics.successfulChains / chains.length
    metrics.averageEscalationDepth = totalDepth / chains.length
    metrics.averageDuration = Math.round(totalDuration / chains.length)

    // Get top error codes
    metrics.topErrorCodes = Array.from(errorCodeCounts.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return metrics
  }

  /**
   * Get metrics for a specific tier.
   *
   * @param tier - The capability tier
   * @param options - Metrics options
   * @returns Tier-specific metrics
   */
  async getTierMetrics(tier: CapabilityTier, options?: {
    since?: number
  }): Promise<{
    totalAttempts: number
    successCount: number
    failureCount: number
    successRate: number
    averageDuration: number
    escalationRate: number
  }> {
    let steps = await this.graph.queryNodes({
      label: ESCALATION_LABELS.step,
      where: { tier },
    })

    if (options?.since) {
      steps = steps.filter(s => (s.properties.timestamp as number) >= options.since!)
    }

    const totalAttempts = steps.length
    const successCount = steps.filter(s => s.properties.success).length
    const failureCount = totalAttempts - successCount

    let totalDuration = 0
    for (const step of steps) {
      totalDuration += step.properties.duration as number
    }

    // Calculate escalation rate (how many failures led to next tier)
    const escalatedSteps = await this.graph.queryEdges({
      type: ESCALATION_EDGES.escalatedTo,
    })
    const escalationsFromTier = escalatedSteps.filter(e => {
      const stepId = e.from
      const step = steps.find(s => s.id === stepId)
      return step && step.properties.tier === tier
    }).length

    return {
      totalAttempts,
      successCount,
      failureCount,
      successRate: totalAttempts > 0 ? successCount / totalAttempts : 0,
      averageDuration: totalAttempts > 0 ? Math.round(totalDuration / totalAttempts) : 0,
      escalationRate: failureCount > 0 ? escalationsFromTier / failureCount : 0,
    }
  }

  // ==========================================================================
  // PATTERN DETECTION
  // ==========================================================================

  /**
   * Detect problematic escalation patterns.
   *
   * @param options - Detection options
   * @returns Array of detected patterns
   */
  async detectPatterns(options?: {
    since?: number
    minOccurrences?: number
  }): Promise<EscalationPattern[]> {
    const patterns: EscalationPattern[] = []
    const minOccurrences = options?.minOccurrences ?? 3

    // 1. Detect tier bottlenecks (high failure rate at specific tier)
    for (const tier of TIER_ORDER) {
      const tierMetrics = await this.getTierMetrics(tier, { since: options?.since })

      if (tierMetrics.totalAttempts >= minOccurrences) {
        // High failure rate (> 80%)
        if (tierMetrics.successRate < 0.2) {
          patterns.push({
            type: 'tier-bottleneck',
            description: `High failure rate at ${tier} tier (${Math.round((1 - tierMetrics.successRate) * 100)}% failures)`,
            affectedTiers: [tier],
            occurrences: tierMetrics.failureCount,
            severity: tier === 'human' ? 'high' : 'medium',
            suggestion: tier === 'human'
              ? 'Review human escalation process and consider adding more handlers'
              : `Improve ${tier} tier handler or adjust retry logic`,
          })
        }

        // High escalation rate (> 90% of failures escalate)
        if (tierMetrics.escalationRate > 0.9 && tierMetrics.failureCount >= minOccurrences) {
          patterns.push({
            type: 'repeated-escalation',
            description: `Nearly all ${tier} tier failures escalate (${Math.round(tierMetrics.escalationRate * 100)}%)`,
            affectedTiers: [tier],
            occurrences: Math.round(tierMetrics.failureCount * tierMetrics.escalationRate),
            severity: 'medium',
            suggestion: `Consider skipping ${tier} tier for certain error types`,
          })
        }
      }
    }

    // 2. Detect chains that always exhaust (go through all tiers without resolution)
    const metrics = await this.calculateMetrics({ since: options?.since })
    if (metrics.exhaustedChains >= minOccurrences) {
      const exhaustionRate = metrics.exhaustedChains / metrics.totalChains
      if (exhaustionRate > 0.1) {
        patterns.push({
          type: 'repeated-escalation',
          description: `${Math.round(exhaustionRate * 100)}% of chains exhaust all tiers`,
          affectedTiers: TIER_ORDER.slice(),
          occurrences: metrics.exhaustedChains,
          severity: 'high',
          suggestion: 'Review error classification and add specialized handlers',
        })
      }
    }

    // 3. Detect common error codes that always fail
    for (const { code, count } of metrics.topErrorCodes) {
      if (count >= minOccurrences) {
        const chainsWithCode = await this.graph.queryNodes({
          label: ESCALATION_LABELS.chain,
          where: { errorCode: code },
        })

        const exhaustedWithCode = chainsWithCode.filter(c => c.properties.exhausted).length
        if (exhaustedWithCode / chainsWithCode.length > 0.5) {
          patterns.push({
            type: 'tier-bottleneck',
            description: `Error code "${code}" frequently exhausts all tiers`,
            affectedTiers: TIER_ORDER.slice(),
            occurrences: exhaustedWithCode,
            severity: 'high',
            suggestion: `Add specialized handler for error code "${code}"`,
          })
        }
      }
    }

    return patterns
  }

  // ==========================================================================
  // GRAPH STATISTICS
  // ==========================================================================

  /**
   * Get overall graph statistics for escalation chains.
   *
   * @returns Graph statistics
   */
  async getGraphStats(): Promise<{
    totalNodes: number
    chainCount: number
    stepCount: number
    targetCount: number
    edgeCount: number
    edgesByType: Record<string, number>
  }> {
    const stats = await this.graph.stats()

    const chains = await this.graph.queryNodes({ label: ESCALATION_LABELS.chain })
    const steps = await this.graph.queryNodes({ label: ESCALATION_LABELS.step })
    const targets = await this.graph.queryNodes({ label: ESCALATION_LABELS.target })

    return {
      totalNodes: stats.nodeCount,
      chainCount: chains.length,
      stepCount: steps.length,
      targetCount: targets.length,
      edgeCount: stats.edgeCount,
      edgesByType: stats.typeCounts,
    }
  }

  // ==========================================================================
  // CLEANUP AND MAINTENANCE
  // ==========================================================================

  /**
   * Clean up old escalation chains.
   *
   * @param olderThan - Remove chains older than this timestamp
   * @returns Number of chains removed
   */
  async cleanupOldChains(olderThan: number): Promise<number> {
    const chains = await this.graph.queryNodes({
      label: ESCALATION_LABELS.chain,
      where: {
        startedAt: { $lt: olderThan },
      },
    })

    let removed = 0
    for (const chain of chains) {
      // Delete all steps first
      const steps = await this.getChainSteps(chain.id)
      for (const step of steps) {
        await this.graph.deleteNode(step.id)
      }

      // Delete the chain
      await this.graph.deleteNode(chain.id)
      removed++
    }

    return removed
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { EscalationChainGraph }
export default EscalationChainGraph
