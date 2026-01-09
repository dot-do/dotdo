/**
 * Startup - Core business container primitive
 *
 * The primary business container for autonomous businesses in dotdo.
 * Extends Business with startup-specific lifecycle including:
 * - Service declaration and binding
 * - Agent binding and configuration
 * - Escalation policy definition
 * - Foundation Sprint integration hooks
 * - HUNCH metrics tracking
 *
 * Vision: `class AcmeTax extends Startup` - a business container that
 * can be extended to create specific autonomous businesses.
 */

import { Business, BusinessConfig } from './Business'
import { Env } from './DO'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Service binding configuration
 */
export interface ServiceBinding {
  serviceId: string
  name: string
  description?: string
  config?: Record<string, unknown>
}

/**
 * Agent binding configuration
 */
export interface AgentBinding {
  agentId: string
  name: string
  role: 'primary' | 'backup' | 'specialist'
  capabilities?: string[]
  mode?: 'autonomous' | 'supervised' | 'manual'
}

/**
 * Escalation rule for sensitive decisions
 */
export interface EscalationRule {
  trigger: string
  condition?: (context: Record<string, unknown>) => boolean
  escalateTo: 'human' | 'manager' | string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  timeout?: number
}

/**
 * Escalation policy for the startup
 */
export interface StartupEscalationPolicy {
  rules: EscalationRule[]
  defaultEscalation?: string
  auditLog?: boolean
}

/**
 * Escalation result
 */
export interface EscalationResult {
  escalatedTo: string
  trigger: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  timestamp: Date
  context: Record<string, unknown>
}

/**
 * Foundation Sprint hypothesis
 */
export interface FoundingHypothesis {
  customer: string
  problem: string
  solution: string
  differentiation: string
  metrics?: HunchMetrics
}

/**
 * HUNCH metrics for PMF measurement
 * Hair-on-fire, Usage, NPS, Churn, LTV/CAC
 */
export interface HunchMetrics {
  hairOnFire?: number // 0-10 scale
  usage?: number // DAU/MAU ratio
  nps?: number // -100 to 100
  churn?: number // monthly churn rate
  ltvCac?: number // LTV/CAC ratio
}

/**
 * Historical metrics entry
 */
export interface MetricsHistoryEntry {
  metrics: HunchMetrics
  recordedAt: Date
}

/**
 * Foundation Sprint phase
 */
export type FoundationSprintPhase = 'ideation' | 'validation' | 'mvp' | 'pmf' | 'growth'

/**
 * Startup configuration
 */
export interface StartupConfig extends BusinessConfig {
  hypothesis?: FoundingHypothesis
  phase?: FoundationSprintPhase
}

/**
 * Operational status
 */
export interface OperationalStatus {
  running: boolean
  phase: FoundationSprintPhase | null
  agentCount: number
  serviceCount: number
  paused: boolean
}

/**
 * Work dispatch request
 */
export interface WorkDispatchRequest {
  type: string
  description: string
  input: Record<string, unknown>
  priority?: number
}

/**
 * Work dispatch result
 */
export interface WorkDispatchResult {
  workId: string
  assignedTo: string
  dispatchedAt: Date
}

// ============================================================================
// STARTUP CLASS
// ============================================================================

export class Startup extends Business {
  static override readonly $type: string = 'Startup'

  // Internal state
  private services: Map<string, ServiceBinding> = new Map()
  private agents: Map<string, AgentBinding> = new Map()
  private escalationPolicy: StartupEscalationPolicy | null = null
  private hypothesis: FoundingHypothesis | null = null
  private phase: FoundationSprintPhase | null = null
  private currentMetrics: HunchMetrics | null = null
  private metricsHistory: MetricsHistoryEntry[] = []
  private running: boolean = false
  private paused: boolean = false
  private startupConfig: StartupConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  // ==========================================================================
  // SERVICE BINDING
  // ==========================================================================

  /**
   * Bind a service to this startup
   */
  async bindService(binding: ServiceBinding): Promise<void> {
    this.services.set(binding.serviceId, binding)
    await this.ctx.storage.put(`service:${binding.serviceId}`, binding)
    await this.emit('service.bound', { serviceId: binding.serviceId, name: binding.name })
  }

  /**
   * Get all bound services
   */
  async getServices(): Promise<ServiceBinding[]> {
    // Load from storage if not in memory
    if (this.services.size === 0) {
      const stored = await this.ctx.storage.list<ServiceBinding>({ prefix: 'service:' })
      stored.forEach((value, key) => {
        const serviceId = key.replace('service:', '')
        this.services.set(serviceId, value)
      })
    }
    return Array.from(this.services.values())
  }

  /**
   * Unbind a service from this startup
   */
  async unbindService(serviceId: string): Promise<void> {
    this.services.delete(serviceId)
    await this.ctx.storage.delete(`service:${serviceId}`)
    await this.emit('service.unbound', { serviceId })
  }

  // ==========================================================================
  // AGENT BINDING
  // ==========================================================================

  /**
   * Bind an agent to this startup
   */
  async bindAgent(binding: AgentBinding): Promise<void> {
    this.agents.set(binding.agentId, binding)
    await this.ctx.storage.put(`agent:${binding.agentId}`, binding)
    await this.emit('agent.bound', { agentId: binding.agentId, name: binding.name, role: binding.role })
  }

  /**
   * Get all bound agents
   */
  async getAgents(): Promise<AgentBinding[]> {
    // Load from storage if not in memory
    if (this.agents.size === 0) {
      const stored = await this.ctx.storage.list<AgentBinding>({ prefix: 'agent:' })
      stored.forEach((value, key) => {
        const agentId = key.replace('agent:', '')
        this.agents.set(agentId, value)
      })
    }
    return Array.from(this.agents.values())
  }

  /**
   * Unbind an agent from this startup
   */
  async unbindAgent(agentId: string): Promise<void> {
    this.agents.delete(agentId)
    await this.ctx.storage.delete(`agent:${agentId}`)
    await this.emit('agent.unbound', { agentId })
  }

  /**
   * Get the primary agent
   */
  async getPrimaryAgent(): Promise<AgentBinding | null> {
    const agents = await this.getAgents()
    return agents.find((a) => a.role === 'primary') || null
  }

  // ==========================================================================
  // ESCALATION POLICY
  // ==========================================================================

  /**
   * Set the escalation policy for this startup
   */
  async setEscalationPolicy(policy: StartupEscalationPolicy): Promise<void> {
    // Store serializable version (without functions)
    const serializablePolicy = {
      ...policy,
      rules: policy.rules.map((rule) => ({
        ...rule,
        // Don't store condition function - it will be provided at runtime
        condition: undefined,
      })),
    }
    this.escalationPolicy = policy
    await this.ctx.storage.put('escalationPolicy', serializablePolicy)
    await this.emit('escalation.policySet', { policy: serializablePolicy })
  }

  /**
   * Get the current escalation policy
   */
  async getEscalationPolicy(): Promise<StartupEscalationPolicy | null> {
    if (!this.escalationPolicy) {
      const stored = await this.ctx.storage.get<StartupEscalationPolicy>('escalationPolicy')
      if (stored) {
        this.escalationPolicy = stored
      }
    }
    return this.escalationPolicy
  }

  /**
   * Check if an escalation should be triggered
   */
  async shouldEscalate(trigger: string, context: Record<string, unknown>): Promise<boolean> {
    const policy = await this.getEscalationPolicy()
    if (!policy) return false

    const rule = policy.rules.find((r) => r.trigger === trigger)
    if (!rule) return false

    // If there's a condition function, evaluate it
    if (rule.condition) {
      return rule.condition(context)
    }

    // No condition means always escalate for this trigger
    return true
  }

  /**
   * Trigger an escalation
   */
  async escalate(trigger: string, context: Record<string, unknown>): Promise<EscalationResult> {
    const policy = await this.getEscalationPolicy()
    if (!policy) {
      throw new Error('No escalation policy configured')
    }

    const rule = policy.rules.find((r) => r.trigger === trigger)
    if (!rule) {
      throw new Error(`No escalation rule found for trigger: ${trigger}`)
    }

    const result: EscalationResult = {
      escalatedTo: rule.escalateTo,
      trigger,
      priority: rule.priority,
      timestamp: new Date(),
      context,
    }

    await this.emit('escalation.triggered', {
      trigger,
      escalatedTo: rule.escalateTo,
      priority: rule.priority,
      context,
    })

    return result
  }

  // ==========================================================================
  // FOUNDATION SPRINT LIFECYCLE
  // ==========================================================================

  /**
   * Set the founding hypothesis
   */
  async setHypothesis(hypothesis: FoundingHypothesis): Promise<void> {
    this.hypothesis = hypothesis
    await this.ctx.storage.put('hypothesis', hypothesis)
    await this.emit('hypothesis.set', { hypothesis })
  }

  /**
   * Get the founding hypothesis
   */
  async getHypothesis(): Promise<FoundingHypothesis | null> {
    if (!this.hypothesis) {
      this.hypothesis = await this.ctx.storage.get<FoundingHypothesis>('hypothesis') || null
    }
    return this.hypothesis
  }

  /**
   * Set the current Foundation Sprint phase
   */
  async setPhase(phase: FoundationSprintPhase): Promise<void> {
    const previousPhase = this.phase
    this.phase = phase
    await this.ctx.storage.put('phase', phase)
    await this.emit('phase.changed', { phase, previousPhase })
  }

  /**
   * Get the current Foundation Sprint phase
   */
  async getPhase(): Promise<FoundationSprintPhase | null> {
    if (!this.phase) {
      this.phase = await this.ctx.storage.get<FoundationSprintPhase>('phase') || null
    }
    return this.phase
  }

  /**
   * Record HUNCH metrics
   */
  async recordMetrics(metrics: HunchMetrics): Promise<void> {
    this.currentMetrics = metrics
    const entry: MetricsHistoryEntry = {
      metrics,
      recordedAt: new Date(),
    }
    this.metricsHistory.push(entry)

    await this.ctx.storage.put('currentMetrics', metrics)
    await this.ctx.storage.put('metricsHistory', this.metricsHistory)
    await this.emit('metrics.recorded', { metrics })
  }

  /**
   * Get current HUNCH metrics
   */
  async getMetrics(): Promise<HunchMetrics | null> {
    if (!this.currentMetrics) {
      this.currentMetrics = await this.ctx.storage.get<HunchMetrics>('currentMetrics') || null
    }
    return this.currentMetrics
  }

  /**
   * Get metrics history
   */
  async getMetricsHistory(): Promise<MetricsHistoryEntry[]> {
    if (this.metricsHistory.length === 0) {
      this.metricsHistory = await this.ctx.storage.get<MetricsHistoryEntry[]>('metricsHistory') || []
    }
    return this.metricsHistory
  }

  // ==========================================================================
  // STARTUP CONFIGURATION
  // ==========================================================================

  /**
   * Configure the startup
   */
  async configure(config: StartupConfig): Promise<void> {
    this.startupConfig = config

    // Also set the parent Business config
    await this.setConfig({
      name: config.name,
      slug: config.slug,
      plan: config.plan,
      settings: config.settings,
    })

    // Set phase and hypothesis if provided
    if (config.phase) {
      await this.setPhase(config.phase)
    }
    if (config.hypothesis) {
      await this.setHypothesis(config.hypothesis)
    }

    await this.ctx.storage.put('startupConfig', config)
    await this.emit('startup.configured', { name: config.name, slug: config.slug })
  }

  /**
   * Get startup configuration
   * Overrides Business.getConfig to return StartupConfig
   */
  override async getConfig(): Promise<StartupConfig | null> {
    if (!this.startupConfig) {
      this.startupConfig = await this.ctx.storage.get<StartupConfig>('startupConfig') || null
    }
    return this.startupConfig
  }

  // ==========================================================================
  // AUTONOMOUS OPERATIONS
  // ==========================================================================

  /**
   * Start autonomous operation loop
   */
  async run(): Promise<void> {
    this.running = true
    this.paused = false
    await this.ctx.storage.put('running', true)
    await this.ctx.storage.put('paused', false)
    await this.emit('startup.started', {})
  }

  /**
   * Pause autonomous operations
   */
  async pause(): Promise<void> {
    this.paused = true
    await this.ctx.storage.put('paused', true)
    await this.emit('startup.paused', {})
  }

  /**
   * Resume autonomous operations
   */
  async resume(): Promise<void> {
    this.paused = false
    await this.ctx.storage.put('paused', false)
    await this.emit('startup.resumed', {})
  }

  /**
   * Get operational status
   */
  async getStatus(): Promise<OperationalStatus> {
    // Load from storage if needed
    if (this.running === false) {
      this.running = await this.ctx.storage.get<boolean>('running') || false
    }
    if (this.paused === false) {
      this.paused = await this.ctx.storage.get<boolean>('paused') || false
    }

    const agents = await this.getAgents()
    const services = await this.getServices()
    const phase = await this.getPhase()

    return {
      running: this.running,
      phase,
      agentCount: agents.length,
      serviceCount: services.length,
      paused: this.paused,
    }
  }

  /**
   * Dispatch work to bound agents
   */
  async dispatchWork(request: WorkDispatchRequest): Promise<WorkDispatchResult> {
    const primaryAgent = await this.getPrimaryAgent()
    if (!primaryAgent) {
      throw new Error('No primary agent bound to dispatch work to')
    }

    const workId = crypto.randomUUID()
    const result: WorkDispatchResult = {
      workId,
      assignedTo: primaryAgent.agentId,
      dispatchedAt: new Date(),
    }

    await this.emit('work.dispatched', {
      workId,
      type: request.type,
      assignedTo: primaryAgent.agentId,
    })

    return result
  }

  // ==========================================================================
  // HTTP ENDPOINTS
  // ==========================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // /config - GET startup configuration
    if (url.pathname === '/config' && request.method === 'GET') {
      const config = await this.getConfig()
      return new Response(JSON.stringify(config), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /config - PUT startup configuration
    if (url.pathname === '/config' && request.method === 'PUT') {
      const config = (await request.json()) as StartupConfig
      await this.configure(config)
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /services - GET bound services
    if (url.pathname === '/services' && request.method === 'GET') {
      const services = await this.getServices()
      return new Response(JSON.stringify(services), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /services - POST bind a service
    if (url.pathname === '/services' && request.method === 'POST') {
      const binding = (await request.json()) as ServiceBinding
      await this.bindService(binding)
      return new Response(JSON.stringify({ success: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /agents - GET bound agents
    if (url.pathname === '/agents' && request.method === 'GET') {
      const agents = await this.getAgents()
      return new Response(JSON.stringify(agents), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /agents - POST bind an agent
    if (url.pathname === '/agents' && request.method === 'POST') {
      const binding = (await request.json()) as AgentBinding
      await this.bindAgent(binding)
      return new Response(JSON.stringify({ success: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /status - GET operational status
    if (url.pathname === '/status' && request.method === 'GET') {
      const status = await this.getStatus()
      return new Response(JSON.stringify(status), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /metrics - GET HUNCH metrics
    if (url.pathname === '/metrics' && request.method === 'GET') {
      const metrics = await this.getMetrics()
      return new Response(JSON.stringify(metrics || {}), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /metrics - POST record metrics
    if (url.pathname === '/metrics' && request.method === 'POST') {
      const metrics = (await request.json()) as HunchMetrics
      await this.recordMetrics(metrics)
      return new Response(JSON.stringify({ success: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /escalate - POST trigger escalation
    if (url.pathname === '/escalate' && request.method === 'POST') {
      const body = (await request.json()) as { trigger: string; context: Record<string, unknown> }
      const result = await this.escalate(body.trigger, body.context)
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /hypothesis - GET founding hypothesis
    if (url.pathname === '/hypothesis' && request.method === 'GET') {
      const hypothesis = await this.getHypothesis()
      return new Response(JSON.stringify(hypothesis || {}), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /hypothesis - PUT set founding hypothesis
    if (url.pathname === '/hypothesis' && request.method === 'PUT') {
      const hypothesis = (await request.json()) as FoundingHypothesis
      await this.setHypothesis(hypothesis)
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /phase - GET current phase
    if (url.pathname === '/phase' && request.method === 'GET') {
      const phase = await this.getPhase()
      return new Response(JSON.stringify({ phase }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /phase - PUT set phase
    if (url.pathname === '/phase' && request.method === 'PUT') {
      const body = (await request.json()) as { phase: FoundationSprintPhase }
      await this.setPhase(body.phase)
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Fall through to parent Business handler
    return super.fetch(request)
  }
}

export default Startup
