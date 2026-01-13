/**
 * Human - Human worker with approval flows
 *
 * Extends Worker with notification channels, approval queues, escalation.
 * Examples: 'john@acme.com', 'support-team'
 *
 * Supports blocking approvals via the /request endpoint pattern:
 * - POST /request - Submit a new approval request
 * - GET /request/:id - Get request status (for polling)
 * - POST /request/:id/respond - Submit response to a request
 *
 * @example
 * ```typescript
 * // From ceo`approve partnership` template literal:
 * // 1. Client POSTs to /request with message + SLA
 * // 2. Client polls GET /request/:id until status changes
 * // 3. Human responds via POST /request/:id/respond
 * // 4. Client receives ApprovalResult
 * ```
 */

import { Worker, Task, Context, Answer, Option, Decision, ApprovalRequest, ApprovalResult, Channel } from './Worker'
import { Env } from './DO'

export interface NotificationChannel {
  type: 'email' | 'slack' | 'sms' | 'webhook'
  target: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
}

export interface EscalationRule {
  afterMinutes: number
  escalateTo: string
  notifyChannels: NotificationChannel[]
}

export interface EscalationPolicy {
  rules: EscalationRule[]
  finalEscalation?: string
}

export interface PendingApproval {
  request: ApprovalRequest
  receivedAt: Date
  remindedAt?: Date
  escalatedTo?: string
}

/**
 * Blocking approval request record (for template literal pattern)
 */
export interface BlockingApprovalRequest {
  requestId: string
  role: string
  message: string
  sla?: number
  channel?: string
  type: 'approval' | 'question' | 'review'
  createdAt: string
  expiresAt?: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  result?: {
    approved: boolean
    approver?: string
    reason?: string
    respondedAt?: string
  }
}

export class Human extends Worker {
  static override readonly $type = 'Human'

  protected mode: 'autonomous' | 'supervised' | 'manual' = 'manual'
  private channels: NotificationChannel[] = []
  private escalationPolicy: EscalationPolicy | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Configure notification channels
   */
  async setChannels(channels: NotificationChannel[]): Promise<void> {
    this.channels = channels
    await this.ctx.storage.put('channels', channels)
  }

  /**
   * Get notification channels
   */
  async getChannels(): Promise<NotificationChannel[]> {
    if (this.channels.length === 0) {
      const stored = (await this.ctx.storage.get('channels')) as NotificationChannel[] | undefined
      this.channels = stored || []
    }
    return this.channels
  }

  /**
   * Configure escalation policy
   */
  async setEscalationPolicy(policy: EscalationPolicy): Promise<void> {
    this.escalationPolicy = policy
    await this.ctx.storage.put('escalation_policy', policy)
  }

  /**
   * Get escalation policy
   */
  async getEscalationPolicy(): Promise<EscalationPolicy | null> {
    if (!this.escalationPolicy) {
      this.escalationPolicy = (await this.ctx.storage.get('escalation_policy')) as EscalationPolicy | null
    }
    return this.escalationPolicy
  }

  /**
   * Request approval from this human
   */
  async requestApproval(request: ApprovalRequest): Promise<void> {
    const pending: PendingApproval = {
      request,
      receivedAt: new Date(),
    }
    await this.ctx.storage.put(`pending:${request.id}`, pending)

    // Notify via all channels
    const channels = await this.getChannels()
    const message = `Approval needed: ${request.description}`

    for (const channel of channels) {
      await this.sendToChannel(message, channel)
    }

    await this.emit('approval.requested', { request })

    // Schedule escalation check if policy exists
    const policy = await this.getEscalationPolicy()
    if (policy && policy.rules.length > 0) {
      // In production, use Cloudflare alarm or scheduler
      // For now, just emit an event
      await this.emit('escalation.scheduled', {
        requestId: request.id,
        firstCheck: policy.rules[0]!.afterMinutes,
      })
    }
  }

  /**
   * Submit an approval decision
   */
  async submitApproval(requestId: string, approved: boolean, reason?: string): Promise<ApprovalResult> {
    const pending = (await this.ctx.storage.get(`pending:${requestId}`)) as PendingApproval | undefined
    if (!pending) {
      throw new Error(`Approval request not found: ${requestId}`)
    }

    const result: ApprovalResult = {
      approved,
      approver: this.ctx.id.toString(),
      reason,
      approvedAt: new Date(),
    }

    // Remove from pending
    await this.ctx.storage.delete(`pending:${requestId}`)

    // Store result
    await this.ctx.storage.put(`approved:${requestId}`, result)

    await this.emit('approval.submitted', { requestId, result })
    return result
  }

  /**
   * Get pending approval requests
   */
  async getPendingApprovals(): Promise<PendingApproval[]> {
    const map = await this.ctx.storage.list({ prefix: 'pending:' })
    return Array.from(map.values()) as PendingApproval[]
  }

  /**
   * Check for escalations
   */
  async checkEscalations(): Promise<void> {
    const policy = await this.getEscalationPolicy()
    if (!policy) return

    const pending = await this.getPendingApprovals()
    const now = Date.now()

    for (const approval of pending) {
      const waitingMinutes = (now - approval.receivedAt.getTime()) / (1000 * 60)

      for (const rule of policy.rules) {
        if (waitingMinutes >= rule.afterMinutes && !approval.escalatedTo) {
          // Escalate
          approval.escalatedTo = rule.escalateTo
          await this.ctx.storage.put(`pending:${approval.request.id}`, approval)

          // Notify escalation target
          for (const channel of rule.notifyChannels) {
            await this.sendToChannel(`Escalation: ${approval.request.description} (waiting ${Math.round(waitingMinutes)} minutes)`, channel)
          }

          await this.emit('approval.escalated', {
            requestId: approval.request.id,
            escalatedTo: rule.escalateTo,
          })
          break
        }
      }
    }
  }

  // Worker interface implementations
  protected async executeTask(task: Task, context?: Context): Promise<unknown> {
    // Humans receive task notifications and complete manually
    const channels = await this.getChannels()
    await this.notify(`New task: ${task.description}`, channels)

    await this.emit('task.assigned', { task })
    return { assigned: true, taskId: task.id }
  }

  protected async generateAnswer(question: string, context?: Context): Promise<Answer> {
    // Queue question for human response
    await this.createThing({
      type: 'question',
      name: question,
      data: { context, status: 'pending' },
    })

    const channels = await this.getChannels()
    await this.notify(`Question: ${question}`, channels)

    return {
      text: 'Question queued for human response',
    }
  }

  protected async makeDecision(question: string, options: Option[], context?: Context): Promise<Decision> {
    // Queue decision for human
    await this.createThing({
      type: 'decision',
      name: question,
      data: { options, context, status: 'pending' },
    })

    const channels = await this.getChannels()
    const optionList = options.map((o) => o.label).join(', ')
    await this.notify(`Decision needed: ${question}\nOptions: ${optionList}`, channels)

    // Return placeholder - real decision comes asynchronously
    return {
      selectedOption: options[0]!,
      reasoning: 'Awaiting human decision',
    }
  }

  protected async processApproval(request: ApprovalRequest): Promise<ApprovalResult> {
    await this.requestApproval(request)
    return {
      approved: false,
      approver: this.ctx.id.toString(),
      reason: 'Awaiting human approval',
    }
  }

  protected async generateOutput<T>(prompt: string, schema?: unknown): Promise<T> {
    // Queue generation request for human
    const thing = await this.createThing({
      type: 'generation',
      name: prompt,
      data: { schema, status: 'pending' },
    })

    const channels = await this.getChannels()
    await this.notify(`Generation request: ${prompt}`, channels)

    throw new Error(`Generation queued for human: ${thing.id}`)
  }

  protected async sendToChannel(message: string, channel: NotificationChannel | Channel): Promise<void> {
    // In production, integrate with actual notification services
    await this.emit('notification.sent', {
      channel: channel.type,
      target: channel.target,
      message,
    })
  }

  // =========================================================================
  // Blocking Approval Methods (for template literal pattern)
  // =========================================================================

  /**
   * Submit a blocking approval request
   * Used by the HumanClient when ceo`approve something` is awaited
   */
  async submitBlockingRequest(params: {
    requestId: string
    role: string
    message: string
    sla?: number
    channel?: string
    type?: 'approval' | 'question' | 'review'
  }): Promise<BlockingApprovalRequest> {
    const now = new Date()
    const record: BlockingApprovalRequest = {
      requestId: params.requestId,
      role: params.role,
      message: params.message,
      sla: params.sla,
      channel: params.channel,
      type: params.type || 'approval',
      createdAt: now.toISOString(),
      expiresAt: params.sla ? new Date(now.getTime() + params.sla).toISOString() : undefined,
      status: 'pending',
    }

    // Store the request
    await this.ctx.storage.put(`blocking:${params.requestId}`, record)

    // Notify via channels
    const channels = await this.getChannels()
    if (channels.length > 0) {
      const message = `Approval needed: ${params.message}`
      for (const channel of channels) {
        await this.sendToChannel(message, channel)
      }
    }

    await this.emit('blocking.request.submitted', { request: record })

    // Schedule expiration alarm if SLA is set
    if (params.sla) {
      await this.scheduleExpiration(params.requestId, params.sla)
    }

    return record
  }

  /**
   * Get a blocking request by ID
   * Used by HumanClient polling
   */
  async getBlockingRequest(requestId: string): Promise<BlockingApprovalRequest | null> {
    const record = await this.ctx.storage.get(`blocking:${requestId}`) as BlockingApprovalRequest | undefined

    if (!record) {
      return null
    }

    // Check if expired
    if (record.expiresAt && record.status === 'pending') {
      const expiresAt = new Date(record.expiresAt)
      if (expiresAt <= new Date()) {
        record.status = 'expired'
        await this.ctx.storage.put(`blocking:${requestId}`, record)
        await this.emit('blocking.request.expired', { requestId })
      }
    }

    return record
  }

  /**
   * Respond to a blocking approval request
   * Called when a human submits their decision
   */
  async respondToBlockingRequest(params: {
    requestId: string
    approved: boolean
    approver?: string
    reason?: string
  }): Promise<BlockingApprovalRequest> {
    const record = await this.ctx.storage.get(`blocking:${params.requestId}`) as BlockingApprovalRequest | undefined

    if (!record) {
      throw new Error(`Request not found: ${params.requestId}`)
    }

    if (record.status !== 'pending') {
      throw new Error(`Request already ${record.status}: ${params.requestId}`)
    }

    // Update the record with the response
    record.status = params.approved ? 'approved' : 'rejected'
    record.result = {
      approved: params.approved,
      approver: params.approver || this.ctx.id.toString(),
      reason: params.reason,
      respondedAt: new Date().toISOString(),
    }

    await this.ctx.storage.put(`blocking:${params.requestId}`, record)

    await this.emit('blocking.request.responded', {
      requestId: params.requestId,
      result: record.result,
    })

    return record
  }

  /**
   * Schedule expiration for a request using DO alarm
   */
  private async scheduleExpiration(requestId: string, delayMs: number): Promise<void> {
    // Store pending expiration for alarm handling
    const expirations = await this.ctx.storage.get('pending_expirations') as Record<string, number> || {}
    expirations[requestId] = Date.now() + delayMs
    await this.ctx.storage.put('pending_expirations', expirations)

    // Schedule alarm for the nearest expiration
    const nextExpiration = Math.min(...Object.values(expirations))
    await this.ctx.storage.setAlarm(nextExpiration)
  }

  /**
   * Handle scheduled alarms for request expiration
   */
  async alarm(): Promise<void> {
    const expirations = await this.ctx.storage.get('pending_expirations') as Record<string, number> || {}
    const now = Date.now()
    let nextAlarm: number | null = null

    for (const [requestId, expiresAt] of Object.entries(expirations)) {
      if (expiresAt <= now) {
        // Expire this request
        const record = await this.ctx.storage.get(`blocking:${requestId}`) as BlockingApprovalRequest | undefined
        if (record && record.status === 'pending') {
          record.status = 'expired'
          await this.ctx.storage.put(`blocking:${requestId}`, record)
          await this.emit('blocking.request.expired', { requestId })
        }
        delete expirations[requestId]
      } else {
        // Track next alarm time
        nextAlarm = nextAlarm ? Math.min(nextAlarm, expiresAt) : expiresAt
      }
    }

    await this.ctx.storage.put('pending_expirations', expirations)

    // Schedule next alarm if there are pending expirations
    if (nextAlarm) {
      await this.ctx.storage.setAlarm(nextAlarm)
    }
  }

  /**
   * List all pending blocking requests
   */
  async listBlockingRequests(status?: 'pending' | 'approved' | 'rejected' | 'expired'): Promise<BlockingApprovalRequest[]> {
    const map = await this.ctx.storage.list({ prefix: 'blocking:' })
    const requests = Array.from(map.values()) as BlockingApprovalRequest[]

    if (status) {
      return requests.filter(r => r.status === status)
    }

    return requests
  }

  // =========================================================================
  // HTTP Handler
  // =========================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const jsonHeaders = { 'Content-Type': 'application/json' }

    // =====================================================================
    // Blocking Approval Endpoints (for template literal pattern)
    // =====================================================================

    // POST /request - Submit a new blocking approval request
    if (url.pathname === '/request' && request.method === 'POST') {
      const body = await request.json() as {
        requestId: string
        role: string
        message: string
        sla?: number
        channel?: string
        type?: 'approval' | 'question' | 'review'
      }

      const record = await this.submitBlockingRequest(body)
      return new Response(JSON.stringify(record), { headers: jsonHeaders })
    }

    // GET /request/:id - Get request status (for polling)
    const requestMatch = url.pathname.match(/^\/request\/([^/]+)$/)
    if (requestMatch && request.method === 'GET') {
      const requestId = requestMatch[1]!
      const record = await this.getBlockingRequest(requestId)

      if (!record) {
        return new Response(JSON.stringify({ error: 'Request not found' }), {
          status: 404,
          headers: jsonHeaders,
        })
      }

      return new Response(JSON.stringify(record), { headers: jsonHeaders })
    }

    // DELETE /request/:id - Cancel a pending request
    if (requestMatch && request.method === 'DELETE') {
      const requestId = requestMatch[1]!
      const record = await this.ctx.storage.get(`blocking:${requestId}`) as BlockingApprovalRequest | undefined

      if (!record) {
        return new Response(JSON.stringify({ error: 'Request not found', cancelled: false }), {
          status: 404,
          headers: jsonHeaders,
        })
      }

      if (record.status !== 'pending') {
        return new Response(JSON.stringify({ error: `Request already ${record.status}`, cancelled: false }), {
          status: 400,
          headers: jsonHeaders,
        })
      }

      await this.ctx.storage.delete(`blocking:${requestId}`)
      await this.emit('blocking.request.cancelled', { requestId })

      return new Response(JSON.stringify({ cancelled: true }), { headers: jsonHeaders })
    }

    // POST /request/:id/respond - Submit response to a request
    const respondMatch = url.pathname.match(/^\/request\/([^/]+)\/respond$/)
    if (respondMatch && request.method === 'POST') {
      const requestId = respondMatch[1]!
      const body = await request.json() as {
        approved: boolean
        approver?: string
        reason?: string
      }

      try {
        const record = await this.respondToBlockingRequest({
          requestId,
          approved: body.approved,
          approver: body.approver,
          reason: body.reason,
        })

        return new Response(JSON.stringify(record), { headers: jsonHeaders })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: jsonHeaders,
        })
      }
    }

    // GET /requests - List all blocking requests
    if (url.pathname === '/requests' && request.method === 'GET') {
      const status = url.searchParams.get('status') as 'pending' | 'approved' | 'rejected' | 'expired' | null
      const requests = await this.listBlockingRequests(status || undefined)
      return new Response(JSON.stringify(requests), { headers: jsonHeaders })
    }

    // =====================================================================
    // Legacy Endpoints
    // =====================================================================

    if (url.pathname === '/pending') {
      const pending = await this.getPendingApprovals()
      return new Response(JSON.stringify(pending), { headers: jsonHeaders })
    }

    if (url.pathname === '/approve' && request.method === 'POST') {
      const { requestId, approved, reason } = (await request.json()) as {
        requestId: string
        approved: boolean
        reason?: string
      }
      const result = await this.submitApproval(requestId, approved, reason)
      return new Response(JSON.stringify(result), { headers: jsonHeaders })
    }

    if (url.pathname === '/channels') {
      if (request.method === 'GET') {
        const channels = await this.getChannels()
        return new Response(JSON.stringify(channels), { headers: jsonHeaders })
      }
      if (request.method === 'PUT') {
        const channels = (await request.json()) as NotificationChannel[]
        await this.setChannels(channels)
        return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders })
      }
    }

    return super.fetch(request)
  }
}

export default Human
