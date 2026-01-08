/**
 * Human - Human worker with approval flows
 *
 * Extends Worker with notification channels, approval queues, escalation.
 * Examples: 'john@acme.com', 'support-team'
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

export class Human extends Worker {
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
      const stored = await this.ctx.storage.get('channels') as NotificationChannel[] | undefined
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
      this.escalationPolicy = await this.ctx.storage.get('escalation_policy') as EscalationPolicy | null
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
        firstCheck: policy.rules[0].afterMinutes,
      })
    }
  }

  /**
   * Submit an approval decision
   */
  async submitApproval(
    requestId: string,
    approved: boolean,
    reason?: string
  ): Promise<ApprovalResult> {
    const pending = await this.ctx.storage.get(`pending:${requestId}`) as PendingApproval | undefined
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
            await this.sendToChannel(
              `Escalation: ${approval.request.description} (waiting ${Math.round(waitingMinutes)} minutes)`,
              channel
            )
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
    const optionList = options.map(o => o.label).join(', ')
    await this.notify(`Decision needed: ${question}\nOptions: ${optionList}`, channels)

    // Return placeholder - real decision comes asynchronously
    return {
      selectedOption: options[0],
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

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/pending') {
      const pending = await this.getPendingApprovals()
      return new Response(JSON.stringify(pending), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/approve' && request.method === 'POST') {
      const { requestId, approved, reason } = await request.json() as {
        requestId: string
        approved: boolean
        reason?: string
      }
      const result = await this.submitApproval(requestId, approved, reason)
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/channels') {
      if (request.method === 'GET') {
        const channels = await this.getChannels()
        return new Response(JSON.stringify(channels), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const channels = await request.json() as NotificationChannel[]
        await this.setChannels(channels)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return super.fetch(request)
  }
}

export default Human
