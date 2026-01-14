/**
 * Service - AI-delivered Services-as-Software DO subclass
 *
 * Extends Business for AI-delivered Services-as-Software businesses.
 * AI agents deliver the service with human escalation when needed.
 *
 * Vision: `class MyAgency extends Service` - a service container that
 * can be extended to create specific AI-powered service businesses.
 *
 * Service-specific OKRs:
 * - TasksCompleted - Work items delivered
 * - QualityScore - Output quality (human or AI-rated)
 * - ResponseTime - Time to first action
 * - DeliveryTime - Time to completion
 * - CustomerSatisfaction - Service CSAT
 * - HumanEscalationRate - % requiring human intervention
 * - CostPerTask - Efficiency metric
 * - CapacityUtilization - Agent workload
 */

import { Business, BusinessConfig } from './Business'
import { Env, OKR } from '../core/DO'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Service configuration
 */
export interface ServiceConfig extends BusinessConfig {
  description?: string
  pricingModel?: PricingModel
}

/**
 * Pricing model for the service
 */
export interface PricingModel {
  type: 'per-task' | 'subscription' | 'usage-based' | 'hybrid'
  basePrice?: number
  pricePerTask?: number
  currency?: string
  tiers?: PricingTier[]
}

/**
 * Pricing tier for tiered pricing
 */
export interface PricingTier {
  name: string
  minTasks?: number
  maxTasks?: number
  pricePerTask: number
}

/**
 * Task definition for service work
 */
export interface ServiceTask {
  taskId: string
  type: string
  description: string
  input: Record<string, unknown>
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  deadline?: Date
  metadata?: Record<string, unknown>
}

/**
 * Internal task record with tracking data
 */
interface TaskRecord extends ServiceTask {
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'escalated'
  submittedAt: Date
  startedAt?: Date
  completedAt?: Date
  output?: Record<string, unknown>
  qualityScore?: number
  humanRating?: number
  responseTimeMs?: number
  deliveryTimeMs?: number
  cost?: number
  escalatedTo?: string
  assignedAgent?: string
  ratingFeedback?: string
  ratedBy?: string
}

/**
 * Task completion options
 */
export interface TaskCompletionOptions {
  status: 'completed' | 'failed' | 'escalated'
  output?: Record<string, unknown>
  qualityScore?: number
  responseTimeMs?: number
  deliveryTimeMs?: number
  cost?: number
  escalatedTo?: string
}

/**
 * Task result after completion
 */
export interface TaskResult {
  taskId: string
  status: 'completed' | 'failed' | 'escalated'
  output?: Record<string, unknown>
  qualityScore?: number
  responseTimeMs?: number
  deliveryTimeMs?: number
  cost?: number
  escalatedTo?: string
  completedAt: Date
}

/**
 * Agent assignment for task execution
 */
export interface AgentAssignment {
  agentId: string
  name: string
  role: 'primary' | 'backup' | 'specialist'
  capabilities?: string[]
  currentLoad?: number
  maxLoad?: number
}

/**
 * Service metrics snapshot
 */
export interface ServiceMetrics {
  tasksCompleted: number
  tasksFailed: number
  tasksEscalated: number
  averageQualityScore: number
  averageResponseTimeMs: number
  averageDeliveryTimeMs: number
  humanEscalationRate: number
  averageCostPerTask: number
  capacityUtilization: number
  totalRevenue: number
}

/**
 * Escalation configuration
 */
export interface ServiceEscalationConfig {
  qualityThreshold?: number
  maxRetries?: number
  escalationTargets: Array<{
    target: string
    priority: 'low' | 'normal' | 'high' | 'urgent'
  }>
}

/**
 * Escalation options
 */
export interface EscalationOptions {
  reason: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
}

/**
 * Quality rating options
 */
export interface QualityRatingOptions {
  rating: number
  ratedBy: string
  feedback?: string
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class Service extends Business {
  static override readonly $type: string = 'Service'

  // Internal state
  private tasks: Map<string, TaskRecord> = new Map()
  private assignedAgents: Map<string, AgentAssignment> = new Map()
  private pricingModel: PricingModel | null = null
  private escalationConfig: ServiceEscalationConfig | null = null
  private serviceConfig: ServiceConfig | null = null

  // Metrics tracking
  private metricsCache: ServiceMetrics | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  // ==========================================================================
  // SERVICE-SPECIFIC OKRs
  // ==========================================================================

  /**
   * Service-specific OKRs for tracking performance
   */
  override okrs: Record<string, OKR> = {
    TasksCompleted: this.defineOKR({
      objective: 'Maximize task completion rate',
      keyResults: [
        { name: 'CompletedTasks', target: 100, current: 0 },
        { name: 'CompletionRate', target: 95, current: 0, unit: '%' },
      ],
    }),
    QualityScore: this.defineOKR({
      objective: 'Maintain high quality output',
      keyResults: [
        { name: 'AverageQuality', target: 90, current: 0, unit: '%' },
        { name: 'HighQualityTasks', target: 80, current: 0, unit: '%' },
      ],
    }),
    ResponseTime: this.defineOKR({
      objective: 'Minimize response time to first action',
      keyResults: [
        { name: 'AvgResponseMs', target: 1000, current: 0, unit: 'ms' },
        { name: 'Under5SecRate', target: 95, current: 0, unit: '%' },
      ],
    }),
    DeliveryTime: this.defineOKR({
      objective: 'Optimize delivery time to completion',
      keyResults: [
        { name: 'AvgDeliveryMs', target: 60000, current: 0, unit: 'ms' },
        { name: 'OnTimeRate', target: 90, current: 0, unit: '%' },
      ],
    }),
    CustomerSatisfaction: this.defineOKR({
      objective: 'Achieve high customer satisfaction',
      keyResults: [
        { name: 'CSAT', target: 90, current: 0, unit: '%' },
        { name: 'NPS', target: 50, current: 0 },
      ],
    }),
    HumanEscalationRate: this.defineOKR({
      objective: 'Minimize human escalation rate',
      keyResults: [
        { name: 'EscalationRate', target: 10, current: 0, unit: '%' },
        { name: 'AutoResolveRate', target: 90, current: 0, unit: '%' },
      ],
    }),
    CostPerTask: this.defineOKR({
      objective: 'Optimize cost efficiency per task',
      keyResults: [
        { name: 'AvgCost', target: 1.0, current: 0, unit: '$' },
        { name: 'CostReduction', target: 20, current: 0, unit: '%' },
      ],
    }),
    CapacityUtilization: this.defineOKR({
      objective: 'Maintain optimal capacity utilization',
      keyResults: [
        { name: 'Utilization', target: 80, current: 0, unit: '%' },
        { name: 'AgentEfficiency', target: 85, current: 0, unit: '%' },
      ],
    }),
  }

  // ==========================================================================
  // TASK MANAGEMENT
  // ==========================================================================

  /**
   * Submit a new task for processing
   */
  async submitTask(task: ServiceTask): Promise<{ taskId: string }> {
    const record: TaskRecord = {
      ...task,
      status: 'pending',
      submittedAt: new Date(),
    }

    this.tasks.set(task.taskId, record)
    await this.ctx.storage.put(`task:${task.taskId}`, record)

    await this.emit('task.submitted', {
      taskId: task.taskId,
      type: task.type,
      priority: task.priority,
    })

    return { taskId: task.taskId }
  }

  /**
   * Get a task by ID
   */
  async getTask(taskId: string): Promise<TaskRecord | null> {
    // Check in-memory cache first
    if (this.tasks.has(taskId)) {
      return this.tasks.get(taskId) || null
    }

    // Load from storage
    const stored = await this.ctx.storage.get<TaskRecord>(`task:${taskId}`)
    if (stored) {
      this.tasks.set(taskId, stored)
    }
    return stored || null
  }

  /**
   * List all tasks with optional filtering
   */
  async listTasks(filter?: { status?: string }): Promise<TaskRecord[]> {
    // Load all tasks from storage if not in memory
    if (this.tasks.size === 0) {
      const stored = await this.ctx.storage.list<TaskRecord>({ prefix: 'task:' })
      stored.forEach((value, key) => {
        const taskId = key.replace('task:', '')
        this.tasks.set(taskId, value)
      })
    }

    let tasks = Array.from(this.tasks.values())

    // Apply status filter if provided
    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status)
    }

    return tasks
  }

  /**
   * Complete a task with results
   */
  async completeTask(taskId: string, options: TaskCompletionOptions): Promise<TaskResult> {
    const task = await this.getTask(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const now = new Date()
    const updatedTask: TaskRecord = {
      ...task,
      status: options.status,
      completedAt: now,
      output: options.output,
      qualityScore: options.qualityScore,
      responseTimeMs: options.responseTimeMs,
      deliveryTimeMs: options.deliveryTimeMs,
      cost: options.cost,
      escalatedTo: options.escalatedTo,
    }

    this.tasks.set(taskId, updatedTask)
    await this.ctx.storage.put(`task:${taskId}`, updatedTask)

    // Invalidate metrics cache
    this.metricsCache = null

    await this.emit('task.completed', {
      taskId,
      status: options.status,
      qualityScore: options.qualityScore,
    })

    return {
      taskId,
      status: options.status,
      output: options.output,
      qualityScore: options.qualityScore,
      responseTimeMs: options.responseTimeMs,
      deliveryTimeMs: options.deliveryTimeMs,
      cost: options.cost,
      escalatedTo: options.escalatedTo,
      completedAt: now,
    }
  }

  // ==========================================================================
  // AGENT ASSIGNMENT
  // ==========================================================================

  /**
   * Assign an agent to this service
   */
  async assignAgent(assignment: AgentAssignment): Promise<void> {
    this.assignedAgents.set(assignment.agentId, {
      ...assignment,
      currentLoad: assignment.currentLoad ?? 0,
      maxLoad: assignment.maxLoad ?? 10,
    })
    await this.ctx.storage.put(`agent:${assignment.agentId}`, assignment)
    await this.emit('agent.assigned', {
      agentId: assignment.agentId,
      name: assignment.name,
      role: assignment.role,
    })
  }

  /**
   * Get all assigned agents
   */
  async getAssignedAgents(): Promise<AgentAssignment[]> {
    // Load from storage if not in memory
    if (this.assignedAgents.size === 0) {
      const stored = await this.ctx.storage.list<AgentAssignment>({ prefix: 'agent:' })
      stored.forEach((value, key) => {
        const agentId = key.replace('agent:', '')
        this.assignedAgents.set(agentId, value)
      })
    }
    return Array.from(this.assignedAgents.values())
  }

  /**
   * Unassign an agent from this service
   */
  async unassignAgent(agentId: string): Promise<void> {
    this.assignedAgents.delete(agentId)
    await this.ctx.storage.delete(`agent:${agentId}`)
    await this.emit('agent.unassigned', { agentId })
  }

  /**
   * Get the agent with the lowest current load
   */
  async getAvailableAgent(): Promise<AgentAssignment | null> {
    const agents = await this.getAssignedAgents()
    if (agents.length === 0) return null

    // Sort by load percentage (currentLoad / maxLoad)
    const sorted = agents.sort((a, b) => {
      const loadA = (a.currentLoad ?? 0) / (a.maxLoad ?? 10)
      const loadB = (b.currentLoad ?? 0) / (b.maxLoad ?? 10)
      return loadA - loadB
    })

    return sorted[0] || null
  }

  /**
   * Update an agent's current load
   */
  async updateAgentLoad(agentId: string, load: number): Promise<void> {
    const agent = this.assignedAgents.get(agentId)
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    const updated = { ...agent, currentLoad: load }
    this.assignedAgents.set(agentId, updated)
    await this.ctx.storage.put(`agent:${agentId}`, updated)
  }

  // ==========================================================================
  // HUMAN ESCALATION
  // ==========================================================================

  /**
   * Set escalation configuration
   */
  async setEscalationConfig(config: ServiceEscalationConfig): Promise<void> {
    this.escalationConfig = config
    await this.ctx.storage.put('escalationConfig', config)
    await this.emit('escalation.configured', { config })
  }

  /**
   * Get escalation configuration
   */
  async getEscalationConfig(): Promise<ServiceEscalationConfig | null> {
    if (!this.escalationConfig) {
      this.escalationConfig = await this.ctx.storage.get<ServiceEscalationConfig>('escalationConfig') || null
    }
    return this.escalationConfig
  }

  /**
   * Escalate a task to human review
   */
  async escalateTask(taskId: string, options: EscalationOptions): Promise<TaskResult> {
    const config = await this.getEscalationConfig()
    if (!config || config.escalationTargets.length === 0) {
      throw new Error('No escalation targets configured')
    }

    const task = await this.getTask(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    // Find appropriate escalation target
    const priority = options.priority || 'normal'
    const target = config.escalationTargets.find((t) => t.priority === priority) || config.escalationTargets[0]

    const result = await this.completeTask(taskId, {
      status: 'escalated',
      escalatedTo: target.target,
    })

    await this.emit('task.escalated', {
      taskId,
      escalatedTo: target.target,
      reason: options.reason,
      priority,
    })

    return result
  }

  // ==========================================================================
  // PRICING MODEL
  // ==========================================================================

  /**
   * Set the pricing model for this service
   */
  async setPricingModel(model: PricingModel): Promise<void> {
    this.pricingModel = model
    await this.ctx.storage.put('pricingModel', model)
    await this.emit('pricing.configured', { model })
  }

  /**
   * Get the current pricing model
   */
  async getPricingModel(): Promise<PricingModel | null> {
    if (!this.pricingModel) {
      this.pricingModel = await this.ctx.storage.get<PricingModel>('pricingModel') || null
    }
    return this.pricingModel
  }

  /**
   * Calculate the cost for a specific task
   */
  async calculateTaskCost(taskId: string): Promise<number> {
    const pricing = await this.getPricingModel()
    if (!pricing) return 0

    switch (pricing.type) {
      case 'per-task':
        return pricing.pricePerTask ?? 0

      case 'usage-based':
        if (pricing.tiers && pricing.tiers.length > 0) {
          // Get task count to determine tier
          const tasks = await this.listTasks({ status: 'completed' })
          const taskCount = tasks.length + 1

          // Find applicable tier
          const tier = pricing.tiers.find(
            (t) => taskCount >= (t.minTasks ?? 0) && (!t.maxTasks || taskCount <= t.maxTasks)
          )
          return tier?.pricePerTask ?? pricing.pricePerTask ?? 0
        }
        return pricing.pricePerTask ?? 0

      case 'subscription':
        // For subscription, per-task cost might be 0 or calculated differently
        return pricing.pricePerTask ?? 0

      case 'hybrid':
        return pricing.pricePerTask ?? 0

      default:
        return 0
    }
  }

  // ==========================================================================
  // SERVICE METRICS
  // ==========================================================================

  /**
   * Get comprehensive service metrics
   */
  async getServiceMetrics(): Promise<ServiceMetrics> {
    // Use cached metrics if available
    if (this.metricsCache) {
      return this.metricsCache
    }

    const tasks = await this.listTasks()
    const agents = await this.getAssignedAgents()

    const completed = tasks.filter((t) => t.status === 'completed')
    const failed = tasks.filter((t) => t.status === 'failed')
    const escalated = tasks.filter((t) => t.status === 'escalated')

    const totalProcessed = completed.length + failed.length + escalated.length

    // Calculate averages
    const qualityScores = completed.filter((t) => t.qualityScore !== undefined).map((t) => t.qualityScore!)
    const responseTimes = completed.filter((t) => t.responseTimeMs !== undefined).map((t) => t.responseTimeMs!)
    const deliveryTimes = completed.filter((t) => t.deliveryTimeMs !== undefined).map((t) => t.deliveryTimeMs!)
    const costs = completed.filter((t) => t.cost !== undefined).map((t) => t.cost!)

    const avgQuality = qualityScores.length > 0 ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length : 0
    const avgResponse = responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0
    const avgDelivery = deliveryTimes.length > 0 ? deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length : 0
    const avgCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : 0
    const totalRevenue = costs.reduce((a, b) => a + b, 0)

    // Calculate escalation rate
    const escalationRate = totalProcessed > 0 ? escalated.length / totalProcessed : 0

    // Calculate capacity utilization
    const totalLoad = agents.reduce((sum, a) => sum + (a.currentLoad ?? 0), 0)
    const totalCapacity = agents.reduce((sum, a) => sum + (a.maxLoad ?? 10), 0)
    const utilization = totalCapacity > 0 ? (totalLoad / totalCapacity) * 100 : 0

    const metrics: ServiceMetrics = {
      tasksCompleted: completed.length,
      tasksFailed: failed.length,
      tasksEscalated: escalated.length,
      averageQualityScore: avgQuality,
      averageResponseTimeMs: avgResponse,
      averageDeliveryTimeMs: avgDelivery,
      humanEscalationRate: escalationRate,
      averageCostPerTask: avgCost,
      capacityUtilization: utilization,
      totalRevenue,
    }

    this.metricsCache = metrics
    return metrics
  }

  /**
   * Record a quality rating for a completed task
   */
  async recordQualityRating(taskId: string, rating: QualityRatingOptions): Promise<void> {
    const task = await this.getTask(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const updated: TaskRecord = {
      ...task,
      humanRating: rating.rating,
      ratedBy: rating.ratedBy,
      ratingFeedback: rating.feedback,
    }

    this.tasks.set(taskId, updated)
    await this.ctx.storage.put(`task:${taskId}`, updated)

    // Invalidate metrics cache
    this.metricsCache = null

    await this.emit('task.rated', {
      taskId,
      rating: rating.rating,
      ratedBy: rating.ratedBy,
    })
  }

  // ==========================================================================
  // SERVICE CONFIGURATION
  // ==========================================================================

  /**
   * Configure the service
   */
  async configure(config: ServiceConfig): Promise<void> {
    this.serviceConfig = config

    // Also set the parent Business config
    await this.setConfig({
      name: config.name,
      slug: config.slug,
      plan: config.plan,
      settings: config.settings,
    })

    // Set pricing model if provided
    if (config.pricingModel) {
      await this.setPricingModel(config.pricingModel)
    }

    await this.ctx.storage.put('serviceConfig', config)
    await this.emit('service.configured', {
      name: config.name,
      slug: config.slug,
      description: config.description,
    })
  }

  /**
   * Get service configuration
   * Overrides Business.getConfig to return ServiceConfig
   */
  override async getConfig(): Promise<ServiceConfig | null> {
    if (!this.serviceConfig) {
      this.serviceConfig = await this.ctx.storage.get<ServiceConfig>('serviceConfig') || null
    }
    return this.serviceConfig
  }

  // ==========================================================================
  // HTTP ENDPOINTS
  // ==========================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // /config - GET service configuration
    if (url.pathname === '/config' && request.method === 'GET') {
      const config = await this.getConfig()
      return new Response(JSON.stringify(config), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /config - PUT service configuration
    if (url.pathname === '/config' && request.method === 'PUT') {
      const config = (await request.json()) as ServiceConfig
      await this.configure(config)
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /tasks - GET all tasks
    if (url.pathname === '/tasks' && request.method === 'GET') {
      const status = url.searchParams.get('status') || undefined
      const tasks = await this.listTasks(status ? { status } : undefined)
      return new Response(JSON.stringify(tasks), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /tasks - POST submit a new task
    if (url.pathname === '/tasks' && request.method === 'POST') {
      const task = (await request.json()) as ServiceTask
      const result = await this.submitTask(task)
      return new Response(JSON.stringify(result), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /tasks/:id - GET a specific task
    if (url.pathname.startsWith('/tasks/') && request.method === 'GET') {
      const taskId = url.pathname.replace('/tasks/', '')
      const task = await this.getTask(taskId)
      if (!task) {
        return new Response(JSON.stringify({ error: 'Task not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(task), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /tasks/:id/complete - POST complete a task
    if (url.pathname.match(/^\/tasks\/[^/]+\/complete$/) && request.method === 'POST') {
      const taskId = url.pathname.replace('/tasks/', '').replace('/complete', '')
      const options = (await request.json()) as TaskCompletionOptions
      const result = await this.completeTask(taskId, options)
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /tasks/:id/escalate - POST escalate a task
    if (url.pathname.match(/^\/tasks\/[^/]+\/escalate$/) && request.method === 'POST') {
      const taskId = url.pathname.replace('/tasks/', '').replace('/escalate', '')
      const options = (await request.json()) as EscalationOptions
      const result = await this.escalateTask(taskId, options)
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /agents - GET all assigned agents
    if (url.pathname === '/agents' && request.method === 'GET') {
      const agents = await this.getAssignedAgents()
      return new Response(JSON.stringify(agents), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /agents - POST assign an agent
    if (url.pathname === '/agents' && request.method === 'POST') {
      const agent = (await request.json()) as AgentAssignment
      await this.assignAgent(agent)
      return new Response(JSON.stringify({ success: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /metrics - GET service metrics
    if (url.pathname === '/metrics' && request.method === 'GET') {
      const metrics = await this.getServiceMetrics()
      return new Response(JSON.stringify(metrics), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /pricing - GET pricing model
    if (url.pathname === '/pricing' && request.method === 'GET') {
      const pricing = await this.getPricingModel()
      return new Response(JSON.stringify(pricing || {}), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /pricing - PUT set pricing model
    if (url.pathname === '/pricing' && request.method === 'PUT') {
      const pricing = (await request.json()) as PricingModel
      await this.setPricingModel(pricing)
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /escalation - GET escalation config
    if (url.pathname === '/escalation' && request.method === 'GET') {
      const config = await this.getEscalationConfig()
      return new Response(JSON.stringify(config || {}), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /escalation - PUT set escalation config
    if (url.pathname === '/escalation' && request.method === 'PUT') {
      const config = (await request.json()) as ServiceEscalationConfig
      await this.setEscalationConfig(config)
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Fall through to parent Business handler
    return super.fetch(request)
  }
}

export default Service
