/**
 * Service - Business service offering
 *
 * Represents a subscribable service delivered by Agents, Humans, or automation.
 * Examples: SaaS subscriptions, marketing content, agentic coding on demand
 */

import { DO, Env } from './DO'

export type ServiceType = 'subscription' | 'on-demand' | 'project' | 'retainer'
export type DeliveryMethod = 'agent' | 'human' | 'automated' | 'hybrid'

export interface ServiceTier {
  id: string
  name: string
  description?: string
  price: number
  interval?: 'monthly' | 'yearly' | 'one-time' | 'per-use'
  features: string[]
  limits?: Record<string, number>
  deliveryMethod: DeliveryMethod
  sla?: {
    responseTime: string
    resolution: string
    availability: string
  }
}

export interface ServiceConfig {
  name: string
  description?: string
  type: ServiceType
  category?: string
  tiers: ServiceTier[]
  deliveryMethod: DeliveryMethod
  assignedWorkers?: string[] // Agent or Human DO IDs
  capabilities?: string[]
  integrations?: string[]
}

export interface ServiceSubscription {
  id: string
  serviceId: string
  customerId: string
  tierId: string
  status: 'active' | 'paused' | 'canceled' | 'trial'
  startedAt: Date
  currentPeriodStart: Date
  currentPeriodEnd: Date
  canceledAt?: Date
  metadata?: Record<string, unknown>
}

export interface ServiceRequest {
  id: string
  subscriptionId: string
  type: string
  description: string
  input: Record<string, unknown>
  status: 'pending' | 'assigned' | 'in_progress' | 'review' | 'completed' | 'failed'
  assignedTo?: string // Worker DO ID
  priority: 'low' | 'normal' | 'high' | 'urgent'
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  output?: Record<string, unknown>
  feedback?: {
    rating: number
    comment?: string
  }
}

export interface ServiceDeliverable {
  id: string
  requestId: string
  type: string
  name: string
  content: unknown
  createdAt: Date
  createdBy: string
  version: number
}

export class Service extends DO {
  private config: ServiceConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get service configuration
   */
  async getConfig(): Promise<ServiceConfig | null> {
    if (!this.config) {
      this.config = (await this.ctx.storage.get('config')) as ServiceConfig | null
    }
    return this.config
  }

  /**
   * Configure the service
   */
  async configure(config: ServiceConfig): Promise<void> {
    this.config = config
    await this.ctx.storage.put('config', config)
    await this.emit('service.configured', { config })
  }

  // ============================================================================
  // Subscriptions
  // ============================================================================

  /**
   * Create a subscription
   */
  async subscribe(customerId: string, tierId: string, trial: boolean = false): Promise<ServiceSubscription> {
    const config = await this.getConfig()
    if (!config) throw new Error('Service not configured')

    const tier = config.tiers.find((t) => t.id === tierId)
    if (!tier) throw new Error(`Tier not found: ${tierId}`)

    const now = new Date()
    const periodEnd = new Date(now)

    if (trial) {
      periodEnd.setDate(periodEnd.getDate() + 14) // 14-day trial
    } else if (tier.interval === 'monthly') {
      periodEnd.setMonth(periodEnd.getMonth() + 1)
    } else if (tier.interval === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1)
    }

    const subscription: ServiceSubscription = {
      id: crypto.randomUUID(),
      serviceId: this.ctx.id.toString(),
      customerId,
      tierId,
      status: trial ? 'trial' : 'active',
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    }

    await this.ctx.storage.put(`subscription:${subscription.id}`, subscription)
    await this.emit('subscription.created', { subscription })

    return subscription
  }

  /**
   * Get subscription
   */
  async getSubscription(subscriptionId: string): Promise<ServiceSubscription | null> {
    return (await this.ctx.storage.get(`subscription:${subscriptionId}`)) as ServiceSubscription | null
  }

  /**
   * List subscriptions
   */
  async listSubscriptions(customerId?: string): Promise<ServiceSubscription[]> {
    const map = await this.ctx.storage.list({ prefix: 'subscription:' })
    let subscriptions = Array.from(map.values()) as ServiceSubscription[]

    if (customerId) {
      subscriptions = subscriptions.filter((s) => s.customerId === customerId)
    }

    return subscriptions.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(subscriptionId: string): Promise<ServiceSubscription | null> {
    const subscription = await this.getSubscription(subscriptionId)
    if (!subscription) return null

    subscription.status = 'canceled'
    subscription.canceledAt = new Date()

    await this.ctx.storage.put(`subscription:${subscriptionId}`, subscription)
    await this.emit('subscription.canceled', { subscription })

    return subscription
  }

  // ============================================================================
  // Service Requests
  // ============================================================================

  /**
   * Create a service request
   */
  async createRequest(
    subscriptionId: string,
    type: string,
    description: string,
    input: Record<string, unknown>,
    priority: ServiceRequest['priority'] = 'normal',
  ): Promise<ServiceRequest> {
    const subscription = await this.getSubscription(subscriptionId)
    if (!subscription || subscription.status === 'canceled') {
      throw new Error('Active subscription required')
    }

    const request: ServiceRequest = {
      id: crypto.randomUUID(),
      subscriptionId,
      type,
      description,
      input,
      status: 'pending',
      priority,
      createdAt: new Date(),
    }

    await this.ctx.storage.put(`request:${request.id}`, request)
    await this.emit('request.created', { request })

    // Auto-assign based on delivery method
    await this.assignRequest(request.id)

    return request
  }

  /**
   * Get service request
   */
  async getRequest(requestId: string): Promise<ServiceRequest | null> {
    return (await this.ctx.storage.get(`request:${requestId}`)) as ServiceRequest | null
  }

  /**
   * List service requests
   */
  async listRequests(subscriptionId?: string, status?: ServiceRequest['status']): Promise<ServiceRequest[]> {
    const map = await this.ctx.storage.list({ prefix: 'request:' })
    let requests = Array.from(map.values()) as ServiceRequest[]

    if (subscriptionId) {
      requests = requests.filter((r) => r.subscriptionId === subscriptionId)
    }
    if (status) {
      requests = requests.filter((r) => r.status === status)
    }

    return requests.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  /**
   * Assign request to a worker
   */
  async assignRequest(requestId: string, workerId?: string): Promise<ServiceRequest | null> {
    const request = await this.getRequest(requestId)
    if (!request) return null

    const config = await this.getConfig()
    if (!config) return null

    // Auto-select worker if not specified
    if (!workerId && config.assignedWorkers?.length) {
      // Simple round-robin (in production, use smarter load balancing)
      const activeRequests = await this.listRequests(undefined, 'in_progress')
      const workerLoads: Record<string, number> = {}

      for (const worker of config.assignedWorkers) {
        workerLoads[worker] = activeRequests.filter((r) => r.assignedTo === worker).length
      }

      // Pick least loaded worker
      workerId = config.assignedWorkers.reduce((a, b) => ((workerLoads[a] || 0) <= (workerLoads[b] || 0) ? a : b))
    }

    request.assignedTo = workerId
    request.status = 'assigned'

    await this.ctx.storage.put(`request:${requestId}`, request)
    await this.emit('request.assigned', { request, workerId })

    return request
  }

  /**
   * Start working on a request
   */
  async startRequest(requestId: string): Promise<ServiceRequest | null> {
    const request = await this.getRequest(requestId)
    if (!request) return null

    request.status = 'in_progress'
    request.startedAt = new Date()

    await this.ctx.storage.put(`request:${requestId}`, request)
    await this.emit('request.started', { request })

    return request
  }

  /**
   * Complete a request
   */
  async completeRequest(requestId: string, output: Record<string, unknown>): Promise<ServiceRequest | null> {
    const request = await this.getRequest(requestId)
    if (!request) return null

    request.status = 'completed'
    request.completedAt = new Date()
    request.output = output

    await this.ctx.storage.put(`request:${requestId}`, request)
    await this.emit('request.completed', { request })

    return request
  }

  /**
   * Submit feedback for a request
   */
  async submitFeedback(requestId: string, rating: number, comment?: string): Promise<ServiceRequest | null> {
    const request = await this.getRequest(requestId)
    if (!request) return null

    request.feedback = { rating, comment }

    await this.ctx.storage.put(`request:${requestId}`, request)
    await this.emit('feedback.submitted', { requestId, rating, comment })

    return request
  }

  // ============================================================================
  // Deliverables
  // ============================================================================

  /**
   * Create a deliverable
   */
  async createDeliverable(requestId: string, type: string, name: string, content: unknown, createdBy: string): Promise<ServiceDeliverable> {
    // Get existing versions
    const existing = await this.getDeliverables(requestId, type)
    const version = existing.length + 1

    const deliverable: ServiceDeliverable = {
      id: crypto.randomUUID(),
      requestId,
      type,
      name,
      content,
      createdAt: new Date(),
      createdBy,
      version,
    }

    await this.ctx.storage.put(`deliverable:${deliverable.id}`, deliverable)
    await this.emit('deliverable.created', { deliverable })

    return deliverable
  }

  /**
   * Get deliverables for a request
   */
  async getDeliverables(requestId: string, type?: string): Promise<ServiceDeliverable[]> {
    const map = await this.ctx.storage.list({ prefix: 'deliverable:' })
    let deliverables = Array.from(map.values()) as ServiceDeliverable[]

    deliverables = deliverables.filter((d) => d.requestId === requestId)
    if (type) {
      deliverables = deliverables.filter((d) => d.type === type)
    }

    return deliverables.sort((a, b) => a.version - b.version)
  }

  // ============================================================================
  // Analytics
  // ============================================================================

  /**
   * Get service metrics
   */
  async getMetrics(): Promise<{
    totalSubscriptions: number
    activeSubscriptions: number
    totalRequests: number
    completedRequests: number
    avgCompletionTime: number
    avgRating: number
  }> {
    const subscriptions = await this.listSubscriptions()
    const requests = await this.listRequests()

    const activeSubscriptions = subscriptions.filter((s) => s.status === 'active' || s.status === 'trial')
    const completedRequests = requests.filter((r) => r.status === 'completed')

    const completionTimes = completedRequests.filter((r) => r.startedAt && r.completedAt).map((r) => r.completedAt!.getTime() - r.startedAt!.getTime())

    const ratings = completedRequests.filter((r) => r.feedback?.rating).map((r) => r.feedback!.rating)

    return {
      totalSubscriptions: subscriptions.length,
      activeSubscriptions: activeSubscriptions.length,
      totalRequests: requests.length,
      completedRequests: completedRequests.length,
      avgCompletionTime: completionTimes.length > 0 ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length : 0,
      avgRating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/config') {
      if (request.method === 'GET') {
        const config = await this.getConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = (await request.json()) as ServiceConfig
        await this.configure(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      const { customerId, tierId, trial } = (await request.json()) as {
        customerId: string
        tierId: string
        trial?: boolean
      }
      const subscription = await this.subscribe(customerId, tierId, trial)
      return new Response(JSON.stringify(subscription), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/subscriptions') {
      const customerId = url.searchParams.get('customerId') || undefined
      const subscriptions = await this.listSubscriptions(customerId)
      return new Response(JSON.stringify(subscriptions), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/request' && request.method === 'POST') {
      const { subscriptionId, type, description, input, priority } = (await request.json()) as {
        subscriptionId: string
        type: string
        description: string
        input: Record<string, unknown>
        priority?: ServiceRequest['priority']
      }
      const req = await this.createRequest(subscriptionId, type, description, input, priority)
      return new Response(JSON.stringify(req), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/requests') {
      const subscriptionId = url.searchParams.get('subscriptionId') || undefined
      const status = url.searchParams.get('status') as ServiceRequest['status'] | undefined
      const requests = await this.listRequests(subscriptionId, status)
      return new Response(JSON.stringify(requests), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/metrics') {
      const metrics = await this.getMetrics()
      return new Response(JSON.stringify(metrics), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/request/')) {
      const requestId = url.pathname.split('/')[2]
      const req = await this.getRequest(requestId)
      if (!req) {
        return new Response('Not Found', { status: 404 })
      }
      return new Response(JSON.stringify(req), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return super.fetch(request)
  }
}

export default Service
