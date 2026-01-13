/**
 * Unified Worker Interface
 *
 * This module provides a unified interface for both AI agents and human workers,
 * enabling workflows that work with any worker type transparently.
 *
 * @module workers/unified
 * @see dotdo-gfduh - Digital Workers - Unified Agent/Human Interface
 *
 * The Worker abstraction provides:
 * - Unified interface for both AI agents and human workers
 * - Capability-based routing (code, generative, agentic, human tiers)
 * - Worker-to-Worker communication patterns (handoff, delegation)
 * - Integration with ai-workflows DSL ($)
 *
 * @example
 * ```typescript
 * import { UnifiedWorkerFactory, TierRouter, LoadBalancer, withWorkers } from './unified'
 *
 * const factory = new UnifiedWorkerFactory(graphStore)
 *
 * // Create workers
 * const ralph = await factory.createWorker({
 *   kind: 'agent',
 *   name: 'ralph',
 *   tier: 'agentic',
 *   capabilities: ['code', 'review'],
 * })
 *
 * // Use workers
 * await ralph.notify(tom, 'Build completed')
 * await ralph.handoffTo(tom, { task: 'Review PR #123' })
 *
 * // Integrate with $ context
 * const $ = withWorkers(context, factory)
 * await $.notify(ralph, 'New task assigned')
 * ```
 */

import type { DocumentGraphStore } from '../db/graph/stores/document'

// ============================================================================
// Type Definitions
// ============================================================================

/** Worker kind discriminator */
export type WorkerKind = 'agent' | 'human'

/** Capability tier for routing */
export type WorkerTier = 'code' | 'generative' | 'agentic' | 'human'

/** Worker status */
export type WorkerStatus = 'available' | 'busy' | 'offline'

/** Tier hierarchy for escalation */
const TIER_ORDER: WorkerTier[] = ['code', 'generative', 'agentic', 'human']

// ============================================================================
// Result Types
// ============================================================================

export interface NotifyResult {
  delivered: boolean
  channel?: string
  messageId?: string
}

export interface AskOptions {
  timeout?: number
  schema?: Record<string, unknown>
}

export interface AskResult {
  answer: string
  confidence?: number
  respondedBy?: string
  respondedAt?: Date
}

export interface ApprovalRequest {
  id: string
  description: string
  requester: string
  data?: Record<string, unknown>
  deadline?: Date
}

export interface ApprovalResult {
  approved: boolean
  approver: string
  reason?: string
  approvedAt?: Date
}

export interface DecisionOption {
  id: string
  label: string
  description?: string
}

export interface DecisionResult {
  selectedOption: DecisionOption
  reasoning?: string
  confidence?: number
  decidedBy?: string
}

export interface DoResult {
  success: boolean
  output?: unknown
  error?: string
  duration?: number
}

export interface HandoffContext {
  task?: string
  files?: string[]
  reason?: string
  preserveContext?: boolean
}

export interface HandoffResult {
  accepted: boolean
  handoffId: string
  receivedBy: string
  receivedAt: Date
}

export interface DelegationTask {
  description: string
  constraints?: string[]
  deadline?: Date
  reportProgress?: boolean
}

export interface DelegationResult {
  delegationId: string
  assignedTo: string
  assignedAt: Date
  status: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'failed'
}

export interface EscalationResult {
  escalationId: string
  escalatedTo: string
  escalatedAt: Date
  priority: 'normal' | 'high' | 'urgent'
}

// ============================================================================
// Worker Input Types
// ============================================================================

export interface CreateWorkerInput {
  kind: WorkerKind
  name: string
  tier: WorkerTier
  capabilities: string[]
  status?: WorkerStatus
  metadata?: Record<string, unknown>
}

export interface WorkerRelationshipInput {
  verb: string
  from: string
  to: string
  data?: Record<string, unknown>
}

export interface WorkerRelationship {
  id: string
  verb: string
  from: string
  to: string
  data?: Record<string, unknown>
  createdAt: Date
}

// ============================================================================
// Unified Worker Interface
// ============================================================================

/**
 * UnifiedWorker - Same API for both agents and humans
 */
export interface UnifiedWorker {
  /** Worker ID */
  id: string
  /** Worker kind: agent or human */
  kind: WorkerKind
  /** Human-readable name */
  name: string
  /** Capability tier for routing */
  tier: WorkerTier
  /** Capabilities this worker has */
  capabilities: string[]
  /** Current availability status */
  status: WorkerStatus

  // Unified actions
  notify(target: UnifiedWorker | string, message: string): Promise<NotifyResult>
  ask(question: string, options?: AskOptions): Promise<AskResult>
  approve(request: ApprovalRequest): Promise<ApprovalResult>
  decide(question: string, options: DecisionOption[]): Promise<DecisionResult>
  do(action: string, context?: Record<string, unknown>): Promise<DoResult>

  // Worker coordination
  handoffTo(target: UnifiedWorker | string, context: HandoffContext): Promise<HandoffResult>
  delegateTo(target: UnifiedWorker | string, task: DelegationTask): Promise<DelegationResult>
  escalateTo(target: UnifiedWorker | string, reason: string): Promise<EscalationResult>
}

// ============================================================================
// UnifiedWorkerImpl - Implementation of the unified interface
// ============================================================================

/**
 * Implementation of UnifiedWorker that wraps graph Things
 */
class UnifiedWorkerImpl implements UnifiedWorker {
  id: string
  kind: WorkerKind
  name: string
  tier: WorkerTier
  capabilities: string[]
  status: WorkerStatus

  private factory: UnifiedWorkerFactory

  constructor(
    data: {
      id: string
      kind: WorkerKind
      name: string
      tier: WorkerTier
      capabilities: string[]
      status: WorkerStatus
    },
    factory: UnifiedWorkerFactory
  ) {
    this.id = data.id
    this.kind = data.kind
    this.name = data.name
    this.tier = data.tier
    this.capabilities = data.capabilities
    this.status = data.status
    this.factory = factory
  }

  private getTargetId(target: UnifiedWorker | string): string {
    return typeof target === 'string' ? target : target.id
  }

  async notify(target: UnifiedWorker | string, message: string): Promise<NotifyResult> {
    const targetId = this.getTargetId(target)

    // Create relationship in graph
    await this.factory.createRelationship({
      verb: 'notified',
      from: this.id,
      to: targetId,
      data: { message, notifiedAt: new Date().toISOString() },
    })

    return {
      delivered: true,
      messageId: `msg_${Date.now()}`,
    }
  }

  async ask(question: string, options?: AskOptions): Promise<AskResult> {
    // For agents, this would call the LLM
    // For humans, this would send a notification and wait
    const startTime = Date.now()

    // Simulate response (in real implementation, would route to appropriate handler)
    if (this.kind === 'agent') {
      return {
        answer: `Response to: ${question}`,
        confidence: 0.9,
        respondedBy: this.id,
        respondedAt: new Date(),
      }
    }

    // Human response would be async
    return {
      answer: `Human response to: ${question}`,
      respondedBy: this.id,
      respondedAt: new Date(),
    }
  }

  async approve(request: ApprovalRequest): Promise<ApprovalResult> {
    // Create approval request relationship
    await this.factory.createRelationship({
      verb: 'approving',
      from: request.requester,
      to: this.id,
      data: { request },
    })

    // For testing, auto-approve
    // In real implementation, would wait for human/agent response
    const result: ApprovalResult = {
      approved: true,
      approver: this.id,
      reason: 'Auto-approved for testing',
      approvedAt: new Date(),
    }

    // Update to approved state
    await this.factory.createRelationship({
      verb: 'approved',
      from: request.requester,
      to: this.id,
      data: { request, result },
    })

    return result
  }

  async decide(question: string, options: DecisionOption[]): Promise<DecisionResult> {
    // For agents, would use LLM to decide
    // For humans, would present options and wait
    const selectedOption = options[0]

    return {
      selectedOption,
      reasoning: `Selected ${selectedOption.label} as the best option`,
      confidence: 0.85,
      decidedBy: this.id,
    }
  }

  async do(action: string, context?: Record<string, unknown>): Promise<DoResult> {
    const startTime = Date.now()

    try {
      // Create doing relationship
      await this.factory.createRelationship({
        verb: 'doing',
        from: this.id,
        to: `action:${action}`,
        data: { action, context, startedAt: new Date().toISOString() },
      })

      // Execute action (simulated)
      const output = { action, completed: true }

      // Create done relationship
      await this.factory.createRelationship({
        verb: 'done',
        from: this.id,
        to: `action:${action}`,
        data: { action, output, completedAt: new Date().toISOString() },
      })

      return {
        success: true,
        output,
        duration: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      }
    }
  }

  async handoffTo(target: UnifiedWorker | string, context: HandoffContext): Promise<HandoffResult> {
    const targetId = this.getTargetId(target)
    const handoffId = `handoff_${Date.now()}`

    await this.factory.createRelationship({
      verb: 'handoffTo',
      from: this.id,
      to: targetId,
      data: {
        handoffId,
        context,
        handoffAt: new Date().toISOString(),
      },
    })

    return {
      accepted: true,
      handoffId,
      receivedBy: targetId,
      receivedAt: new Date(),
    }
  }

  async delegateTo(target: UnifiedWorker | string, task: DelegationTask): Promise<DelegationResult> {
    const targetId = this.getTargetId(target)
    const delegationId = `delegation_${Date.now()}`

    await this.factory.createRelationship({
      verb: 'delegatedTo',
      from: this.id,
      to: targetId,
      data: {
        delegationId,
        task,
        delegatedAt: new Date().toISOString(),
      },
    })

    return {
      delegationId,
      assignedTo: targetId,
      assignedAt: new Date(),
      status: 'pending',
    }
  }

  async escalateTo(target: UnifiedWorker | string, reason: string): Promise<EscalationResult> {
    const targetId = this.getTargetId(target)
    const escalationId = `escalation_${Date.now()}`

    await this.factory.createRelationship({
      verb: 'escalatedTo',
      from: this.id,
      to: targetId,
      data: {
        escalationId,
        reason,
        escalatedAt: new Date().toISOString(),
      },
    })

    return {
      escalationId,
      escalatedTo: targetId,
      escalatedAt: new Date(),
      priority: 'normal',
    }
  }
}

// ============================================================================
// UnifiedWorkerFactory
// ============================================================================

/**
 * Factory for creating and managing UnifiedWorkers
 */
export class UnifiedWorkerFactory {
  private graphStore: DocumentGraphStore
  private workers: Map<string, UnifiedWorkerImpl> = new Map()
  private workersByName: Map<string, string> = new Map()
  private relationships: WorkerRelationship[] = []

  constructor(graphStore: DocumentGraphStore) {
    this.graphStore = graphStore
  }

  /**
   * Create a new unified worker
   */
  async createWorker(input: CreateWorkerInput): Promise<UnifiedWorker> {
    const id = `worker_${input.name}_${Date.now()}`

    const worker = new UnifiedWorkerImpl(
      {
        id,
        kind: input.kind,
        name: input.name,
        tier: input.tier,
        capabilities: input.capabilities,
        status: input.status ?? 'available',
      },
      this
    )

    this.workers.set(id, worker)
    this.workersByName.set(input.name, id)

    // Also store in graph as Thing
    await this.graphStore.createThing({
      id,
      typeId: 20, // Worker type ID
      typeName: 'Worker',
      data: {
        kind: input.kind,
        name: input.name,
        tier: input.tier,
        capabilities: input.capabilities,
        status: input.status ?? 'available',
        metadata: input.metadata,
      },
    })

    return worker
  }

  /**
   * Get a worker by ID
   */
  async getWorker(id: string): Promise<UnifiedWorker | null> {
    const cached = this.workers.get(id)
    if (cached) {
      return cached
    }

    // Try to load from graph
    const thing = await this.graphStore.getThing(id)
    if (!thing || thing.typeName !== 'Worker') {
      return null
    }

    const data = thing.data as {
      kind: WorkerKind
      name: string
      tier: WorkerTier
      capabilities: string[]
      status: WorkerStatus
    }

    const worker = new UnifiedWorkerImpl(
      {
        id: thing.id,
        kind: data.kind,
        name: data.name,
        tier: data.tier,
        capabilities: data.capabilities,
        status: data.status,
      },
      this
    )

    this.workers.set(id, worker)
    this.workersByName.set(data.name, id)

    return worker
  }

  /**
   * Get a worker by name
   */
  async getWorkerByName(name: string): Promise<UnifiedWorker | null> {
    const id = this.workersByName.get(name)
    if (id) {
      return this.getWorker(id)
    }

    // Search in graph
    const things = await this.graphStore.queryThings({
      typeName: 'Worker',
    })

    const found = things.find((t) => (t.data as { name: string })?.name === name)
    if (!found) {
      return null
    }

    return this.getWorker(found.id)
  }

  /**
   * List all workers
   */
  async listWorkers(): Promise<UnifiedWorker[]> {
    return Array.from(this.workers.values())
  }

  /**
   * Find workers by tier
   */
  async findByTier(tier: WorkerTier): Promise<UnifiedWorker[]> {
    return Array.from(this.workers.values()).filter((w) => w.tier === tier)
  }

  /**
   * Find available workers
   */
  async findAvailable(): Promise<UnifiedWorker[]> {
    return Array.from(this.workers.values()).filter((w) => w.status === 'available')
  }

  /**
   * Find workers by capabilities
   */
  async findByCapabilities(required: string[]): Promise<UnifiedWorker[]> {
    return Array.from(this.workers.values()).filter((w) =>
      required.every((cap) => w.capabilities.includes(cap))
    )
  }

  /**
   * Create a relationship between workers
   */
  async createRelationship(input: WorkerRelationshipInput): Promise<WorkerRelationship> {
    const rel: WorkerRelationship = {
      id: `rel_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      verb: input.verb,
      from: input.from,
      to: input.to,
      data: input.data,
      createdAt: new Date(),
    }

    this.relationships.push(rel)

    // Also store in graph
    await this.graphStore.createRelationship({
      id: rel.id,
      verb: input.verb,
      from: input.from,
      to: input.to,
      data: input.data ?? {},
    })

    return rel
  }

  /**
   * Query relationships from a worker
   */
  async queryRelationships(from: string, verb?: string): Promise<WorkerRelationship[]> {
    let results = this.relationships.filter((r) => r.from === from)
    if (verb) {
      results = results.filter((r) => r.verb === verb)
    }
    return results
  }
}

// ============================================================================
// TierRouter - Route tasks to appropriate tier
// ============================================================================

export interface RouteOptions {
  tier?: WorkerTier
  capabilities?: string[]
}

/**
 * TierRouter - Routes tasks to workers based on capability tier
 */
export class TierRouter {
  private factory: UnifiedWorkerFactory

  constructor(factory: UnifiedWorkerFactory) {
    this.factory = factory
  }

  /**
   * Route to a worker by tier
   */
  async routeByTier(tier: WorkerTier): Promise<UnifiedWorker | null> {
    const available = await this.factory.findAvailable()
    const candidates = available.filter((w) => w.tier === tier)
    return candidates[0] ?? null
  }

  /**
   * Escalate to the next tier
   */
  async escalate(currentTier: WorkerTier): Promise<UnifiedWorker | null> {
    const currentIndex = TIER_ORDER.indexOf(currentTier)
    if (currentIndex === -1 || currentIndex >= TIER_ORDER.length - 1) {
      return null // Cannot escalate beyond human tier
    }

    const nextTier = TIER_ORDER[currentIndex + 1]
    return this.routeByTier(nextTier)
  }

  /**
   * Route by capabilities
   */
  async routeByCapabilities(required: string[]): Promise<UnifiedWorker | null> {
    const candidates = await this.factory.findByCapabilities(required)
    const available = candidates.filter((w) => w.status === 'available')
    return available[0] ?? null
  }
}

// ============================================================================
// LoadBalancer - Distribute work across workers
// ============================================================================

export type LoadBalancingStrategy = 'round-robin' | 'least-busy' | 'capability-match'

/**
 * LoadBalancer - Distributes work across available workers
 */
export class LoadBalancer {
  private factory: UnifiedWorkerFactory
  private strategy: LoadBalancingStrategy
  private roundRobinIndex: number = 0

  constructor(factory: UnifiedWorkerFactory, strategy: LoadBalancingStrategy = 'round-robin') {
    this.factory = factory
    this.strategy = strategy
  }

  /**
   * Get the next worker based on load balancing strategy
   */
  async getNextWorker(options: RouteOptions = {}): Promise<UnifiedWorker | null> {
    let candidates = await this.factory.findAvailable()

    // Filter by tier if specified
    if (options.tier) {
      candidates = candidates.filter((w) => w.tier === options.tier)
    }

    // Filter by capabilities if specified
    if (options.capabilities && options.capabilities.length > 0) {
      candidates = candidates.filter((w) =>
        options.capabilities!.every((cap) => w.capabilities.includes(cap))
      )
    }

    if (candidates.length === 0) {
      return null
    }

    switch (this.strategy) {
      case 'round-robin':
        return this.roundRobin(candidates)
      case 'capability-match':
        return this.capabilityMatch(candidates, options.capabilities ?? [])
      default:
        return candidates[0]
    }
  }

  private roundRobin(candidates: UnifiedWorker[]): UnifiedWorker {
    const worker = candidates[this.roundRobinIndex % candidates.length]
    this.roundRobinIndex++
    return worker
  }

  private capabilityMatch(candidates: UnifiedWorker[], required: string[]): UnifiedWorker {
    // Score by number of matching capabilities
    const scored = candidates.map((w) => ({
      worker: w,
      score: required.filter((cap) => w.capabilities.includes(cap)).length,
    }))

    scored.sort((a, b) => b.score - a.score)
    return scored[0].worker
  }
}

// ============================================================================
// withWorkers - AI Workflows DSL Integration
// ============================================================================

export interface WorkflowContextWithWorkers {
  notify: (target: UnifiedWorker | string, message: string) => Promise<NotifyResult>
  ask: (target: UnifiedWorker | string, question: string, options?: AskOptions) => Promise<AskResult>
  approve: (request: ApprovalRequest, approver?: UnifiedWorker | string) => Promise<ApprovalResult>
  decide: (
    question: string,
    options: DecisionOption[],
    decider?: UnifiedWorker | string
  ) => Promise<DecisionResult>
}

/**
 * Enhance $ context with worker methods
 */
export function withWorkers<T extends Record<string, unknown>>(
  context: T,
  factory: UnifiedWorkerFactory
): T & WorkflowContextWithWorkers {
  const enhanced = {
    ...context,

    async notify(target: UnifiedWorker | string, message: string): Promise<NotifyResult> {
      const targetId = typeof target === 'string' ? target : target.id
      const worker = typeof target === 'string' ? await factory.getWorker(target) : target

      if (worker) {
        return {
          delivered: true,
          messageId: `msg_${Date.now()}`,
        }
      }

      // Create notification relationship even without worker
      await factory.createRelationship({
        verb: 'notified',
        from: 'workflow',
        to: targetId,
        data: { message },
      })

      return { delivered: true }
    },

    async ask(
      target: UnifiedWorker | string,
      question: string,
      options?: AskOptions
    ): Promise<AskResult> {
      const worker =
        typeof target === 'string' ? await factory.getWorker(target) : target

      if (worker) {
        return worker.ask(question, options)
      }

      return {
        answer: 'Worker not found',
        respondedAt: new Date(),
      }
    },

    async approve(
      request: ApprovalRequest,
      approver?: UnifiedWorker | string
    ): Promise<ApprovalResult> {
      if (approver) {
        const worker =
          typeof approver === 'string' ? await factory.getWorker(approver) : approver
        if (worker) {
          return worker.approve(request)
        }
      }

      // Find a human approver
      const humans = await factory.findByTier('human')
      const available = humans.filter((h) => h.status === 'available')

      if (available.length > 0) {
        return available[0].approve(request)
      }

      return {
        approved: false,
        approver: 'none',
        reason: 'No approver available',
      }
    },

    async decide(
      question: string,
      options: DecisionOption[],
      decider?: UnifiedWorker | string
    ): Promise<DecisionResult> {
      if (decider) {
        const worker =
          typeof decider === 'string' ? await factory.getWorker(decider) : decider
        if (worker) {
          return worker.decide(question, options)
        }
      }

      // Default decision (first option)
      return {
        selectedOption: options[0],
        reasoning: 'Default selection',
      }
    },
  }

  return enhanced as T & WorkflowContextWithWorkers
}

// ============================================================================
// Named Worker Template Literals (like humans.do)
// ============================================================================

/**
 * Create a template literal function for a worker
 */
export function createWorkerTemplate(worker: UnifiedWorker) {
  return async (strings: TemplateStringsArray, ...values: unknown[]): Promise<DoResult> => {
    // Build the action string from template literal
    let action = ''
    for (let i = 0; i < strings.length; i++) {
      action += strings[i]
      if (i < values.length) {
        action += String(values[i])
      }
    }

    return worker.do(action)
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  UnifiedWorkerImpl,
  TIER_ORDER,
}
