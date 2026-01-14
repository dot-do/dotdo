/**
 * @module Human
 * @description Human worker with approval flows, notifications, and escalation
 *
 * Human extends Worker to represent human participants in business workflows.
 * It provides multi-channel notifications (email, Slack, SMS, webhook),
 * approval queues with SLA tracking, and automatic escalation policies.
 * Humans are the "human-in-the-loop" component for AI agent oversight.
 *
 * **Architecture Note:**
 * This DO shares channel abstractions, validation, and workflow logic with
 * HumanFunctionExecutor via lib/human/*. All reusable logic has been consolidated
 * to eliminate duplication:
 * - lib/human/channels - Channel interface and implementations
 * - lib/human/validation - Form, action, schema validation
 * - lib/human/workflows - Approval workflow execution
 * - lib/human/graph-store - GraphHumanStore for state persistence
 *
 * **Core Features:**
 * - Multi-channel notifications (email, Slack, SMS, webhook)
 * - Blocking approval requests with polling or webhooks
 * - SLA-based automatic expiration
 * - Escalation policies with configurable rules
 * - Graph-backed state for queryability
 *
 * **Approval Request States:**
 * | State | Description |
 * |-------|-------------|
 * | `pending` | Awaiting human response |
 * | `approved` | Human approved the request |
 * | `rejected` | Human rejected the request |
 * | `expired` | SLA exceeded without response |
 *
 * **HTTP Endpoints (Blocking Approval Pattern):**
 * | Method | Path | Description |
 * |--------|------|-------------|
 * | POST | `/request` | Submit new approval request |
 * | GET | `/request/:id` | Poll request status |
 * | POST | `/request/:id/respond` | Submit approval response |
 * | DELETE | `/request/:id` | Cancel pending request |
 * | GET | `/requests` | List all requests |
 * | GET | `/pending` | List pending approvals |
 * | POST | `/approve` | Legacy approval endpoint |
 * | GET/PUT | `/channels` | Manage notification channels |
 *
 * **Notification Channels:**
 * | Type | Target Format | Example |
 * |------|---------------|---------|
 * | `email` | Email address | john@acme.com |
 * | `slack` | Channel/user | #approvals, @john |
 * | `sms` | Phone number | +1-555-0123 |
 * | `webhook` | URL | https://hook.example.com |
 *
 * **Template Literal Pattern:**
 * The Human DO is designed to work with the `humans.do` template literal syntax:
 * ```typescript
 * import { ceo, legal } from 'humans.do'
 *
 * // Blocking approval - waits for human response
 * const approved = await ceo`approve the partnership deal`
 *
 * // Non-blocking - notifies human, continues
 * legal`review contract and respond within 48 hours`
 * ```
 *
 * @example Notification Channel Configuration
 * ```typescript
 * class ApprovalManager extends Human {
 *   async onStart() {
 *     await this.setChannels([
 *       { type: 'slack', target: '#approvals', priority: 'high' },
 *       { type: 'email', target: 'manager@acme.com', priority: 'normal' },
 *       { type: 'sms', target: '+1-555-0123', priority: 'urgent' }
 *     ])
 *   }
 * }
 * ```
 *
 * @example Escalation Policy
 * ```typescript
 * await human.setEscalationPolicy({
 *   rules: [
 *     {
 *       afterMinutes: 60, // After 1 hour
 *       escalateTo: 'team-lead@acme.com',
 *       notifyChannels: [{ type: 'slack', target: '#urgent', priority: 'high' }]
 *     },
 *     {
 *       afterMinutes: 240, // After 4 hours
 *       escalateTo: 'director@acme.com',
 *       notifyChannels: [{ type: 'sms', target: '+1-555-0199', priority: 'urgent' }]
 *     }
 *   ],
 *   finalEscalation: 'ceo@acme.com'
 * })
 * ```
 *
 * @example Blocking Approval Flow
 * ```typescript
 * // Client code (using HumanClient or template literal)
 * const human = new Human(ctx, env)
 *
 * // 1. Submit approval request with SLA
 * const request = await human.submitBlockingRequest({
 *   requestId: 'req_123',
 *   role: 'ceo',
 *   message: 'Approve $50k marketing budget',
 *   sla: 4 * 60 * 60 * 1000, // 4 hours
 *   type: 'approval'
 * })
 *
 * // 2. Poll until resolved (or use webhook)
 * let status = await human.getBlockingRequest('req_123')
 * while (status.status === 'pending') {
 *   await sleep(30000) // Poll every 30 seconds
 *   status = await human.getBlockingRequest('req_123')
 * }
 *
 * // 3. Check result
 * if (status.status === 'approved') {
 *   console.log(`Approved by ${status.result?.approver}`)
 * }
 * ```
 *
 * @example HTTP API Usage
 * ```typescript
 * // Submit request
 * const response = await fetch('https://ceo.humans.do/request', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     requestId: 'req_123',
 *     role: 'ceo',
 *     message: 'Approve partnership deal',
 *     sla: 86400000, // 24 hours
 *     type: 'approval'
 *   })
 * })
 *
 * // Human responds via UI or API
 * await fetch('https://ceo.humans.do/request/req_123/respond', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     approved: true,
 *     reason: 'Good strategic fit'
 *   })
 * })
 * ```
 *
 * @example Integration with Agents
 * ```typescript
 * class RefundAgent extends Agent {
 *   async processLargeRefund(amount: number, customerId: string) {
 *     if (amount > 10000) {
 *       // Escalate to human for approval
 *       const human = this.getHuman('senior-accountant')
 *       const approval = await human.approve({
 *         id: `refund-${customerId}-${Date.now()}`,
 *         type: 'refund',
 *         description: `Refund $${amount} to customer ${customerId}`,
 *         requester: this.ctx.id.toString(),
 *         data: { amount, customerId },
 *         deadline: new Date(Date.now() + 4 * 60 * 60 * 1000) // 4 hour SLA
 *       })
 *
 *       if (!approval.approved) {
 *         throw new Error(`Refund rejected: ${approval.reason}`)
 *       }
 *     }
 *     return this.executeRefund(amount, customerId)
 *   }
 * }
 * ```
 *
 * @see Worker - Base class for work-performing entities
 * @see Agent - AI-powered autonomous worker
 * @see lib/human - Shared human-in-the-loop abstractions
 * @see lib/executors/HumanFunctionExecutor - Template literal execution engine
 */

import { Worker, Task, Context, Answer, Option, Decision, ApprovalRequest, ApprovalResult, Channel } from './Worker'
import { Env } from '../core/DO'
import type { ThingEntity } from '../../db/stores'

// Import shared types, utilities, and channel abstractions from lib/human
import {
  type NotificationPriority,
  type NotificationChannel as SharedNotificationChannel,
} from '../../lib/human'
import {
  type HumanNotificationChannel,
  type NotificationPayload,
  type SendResult,
} from '../../lib/human/channels'
import { createChannel, type ChannelConfig } from '../../lib/human/channel-factory'

/**
 * Notification channel configuration for Human DO.
 *
 * This is a simplified version of the channel config used for DO storage.
 * For full-featured channel instances, use lib/human/channels.
 *
 * @see SharedNotificationChannel - Type alias from lib/human
 */
export interface NotificationChannel {
  type: 'email' | 'slack' | 'sms' | 'webhook'
  target: string
  priority: NotificationPriority
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

/**
 * Thing type constant for ApprovalRequest
 */
const APPROVAL_REQUEST_TYPE = 'ApprovalRequest'

export class Human extends Worker {
  static override readonly $type = 'Human'

  protected mode: 'autonomous' | 'supervised' | 'manual' = 'manual'
  private channels: NotificationChannel[] = []
  private escalationPolicy: EscalationPolicy | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  // =========================================================================
  // Graph Helper Methods
  // =========================================================================

  /**
   * Convert a ThingEntity to BlockingApprovalRequest
   */
  private thingToBlockingRequest(thing: ThingEntity): BlockingApprovalRequest {
    const data = thing.data as Record<string, unknown> | null
    return {
      requestId: thing.$id,
      role: (data?.role as string) ?? '',
      message: thing.name ?? '',
      sla: data?.sla as number | undefined,
      channel: data?.channel as string | undefined,
      type: (data?.requestType as 'approval' | 'question' | 'review') ?? 'approval',
      createdAt: (data?.createdAt as string) ?? new Date().toISOString(),
      expiresAt: data?.expiresAt as string | undefined,
      status: (data?.status as 'pending' | 'approved' | 'rejected' | 'expired') ?? 'pending',
      result: data?.result as BlockingApprovalRequest['result'],
    }
  }

  /**
   * Create a BlockingApprovalRequest as a Thing in the graph
   */
  private async createApprovalRequestThing(record: BlockingApprovalRequest): Promise<ThingEntity> {
    const thing = await this.things.create({
      $id: record.requestId,
      $type: APPROVAL_REQUEST_TYPE,
      name: record.message,
      data: {
        role: record.role,
        sla: record.sla,
        channel: record.channel,
        requestType: record.type,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        status: record.status,
        result: record.result,
      },
    })

    // Create relationship: Request assignedTo Human
    try {
      await this.relationships.create({
        verb: 'assignedTo',
        from: `${this.ns}/${APPROVAL_REQUEST_TYPE}/${record.requestId}`,
        to: this.ns,
        data: { assignedAt: record.createdAt },
      })
    } catch {
      // Relationship may already exist, ignore duplicate errors
    }

    return thing
  }

  /**
   * Update an ApprovalRequest Thing in the graph
   */
  private async updateApprovalRequestThing(record: BlockingApprovalRequest): Promise<ThingEntity> {
    return this.things.update(record.requestId, {
      data: {
        role: record.role,
        sla: record.sla,
        channel: record.channel,
        requestType: record.type,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        status: record.status,
        result: record.result,
      },
    })
  }

  /**
   * Get an ApprovalRequest Thing by ID
   */
  private async getApprovalRequestThing(requestId: string): Promise<ThingEntity | null> {
    return this.things.get(requestId)
  }

  /**
   * Delete an ApprovalRequest Thing and its relationships
   */
  private async deleteApprovalRequestThing(requestId: string): Promise<void> {
    // Delete the relationship first
    await this.relationships.deleteWhere({
      from: `${this.ns}/${APPROVAL_REQUEST_TYPE}/${requestId}`,
      verb: 'assignedTo',
    })

    // Delete the thing (soft delete)
    try {
      await this.things.delete(requestId)
    } catch {
      // Thing may not exist, ignore errors
    }
  }

  /**
   * List all ApprovalRequest Things
   */
  private async listApprovalRequestThings(status?: 'pending' | 'approved' | 'rejected' | 'expired'): Promise<ThingEntity[]> {
    const things = await this.things.list({ type: APPROVAL_REQUEST_TYPE })

    if (status) {
      return things.filter((thing) => {
        const data = thing.data as Record<string, unknown> | null
        return data?.status === status
      })
    }

    return things
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
   *
   * Now uses Graph model: creates ApprovalRequest Thing with unified state machine
   */
  async requestApproval(request: ApprovalRequest): Promise<void> {
    const now = new Date()

    // Create as BlockingApprovalRequest Thing (unified model)
    const record: BlockingApprovalRequest = {
      requestId: request.id,
      role: request.requester,
      message: request.description,
      sla: request.deadline ? request.deadline.getTime() - now.getTime() : undefined,
      type: 'approval',
      createdAt: now.toISOString(),
      expiresAt: request.deadline?.toISOString(),
      status: 'pending',
    }

    // Store as Thing in graph
    await this.createApprovalRequestThing(record)

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
      await this.emit('escalation.scheduled', {
        requestId: request.id,
        firstCheck: policy.rules[0]!.afterMinutes,
      })
    }

    // Schedule expiration if deadline is set
    if (record.sla) {
      await this.scheduleExpiration(request.id, record.sla)
    }
  }

  /**
   * Submit an approval decision
   *
   * Now uses Graph model: updates ApprovalRequest Thing state
   */
  async submitApproval(requestId: string, approved: boolean, reason?: string): Promise<ApprovalResult> {
    const thing = await this.getApprovalRequestThing(requestId)
    if (!thing) {
      throw new Error(`Approval request not found: ${requestId}`)
    }

    const record = this.thingToBlockingRequest(thing)
    if (record.status !== 'pending') {
      throw new Error(`Request already ${record.status}: ${requestId}`)
    }

    const result: ApprovalResult = {
      approved,
      approver: this.ctx.id.toString(),
      reason,
      approvedAt: new Date(),
    }

    // Update Thing state (status transition via verb form)
    record.status = approved ? 'approved' : 'rejected'
    record.result = {
      approved,
      approver: this.ctx.id.toString(),
      reason,
      respondedAt: new Date().toISOString(),
    }
    await this.updateApprovalRequestThing(record)

    await this.emit('approval.submitted', { requestId, result })
    return result
  }

  /**
   * Get pending approval requests
   *
   * Now uses Graph model: queries ApprovalRequest Things by status
   * Returns PendingApproval[] for backwards compatibility
   */
  async getPendingApprovals(): Promise<PendingApproval[]> {
    const things = await this.listApprovalRequestThings('pending')

    // Convert Things to PendingApproval format for backwards compatibility
    return things.map((thing) => {
      const record = this.thingToBlockingRequest(thing)
      return {
        request: {
          id: record.requestId,
          type: record.type,
          description: record.message,
          requester: record.role,
          data: {},
          deadline: record.expiresAt ? new Date(record.expiresAt) : undefined,
        } as ApprovalRequest,
        receivedAt: new Date(record.createdAt),
        remindedAt: undefined,
        escalatedTo: undefined, // Will be populated from Thing data if needed
      }
    })
  }

  /**
   * Check for escalations
   *
   * Now uses Graph model: queries and updates ApprovalRequest Things
   */
  async checkEscalations(): Promise<void> {
    const policy = await this.getEscalationPolicy()
    if (!policy) return

    const things = await this.listApprovalRequestThings('pending')
    const now = Date.now()

    for (const thing of things) {
      const record = this.thingToBlockingRequest(thing)
      const createdAt = new Date(record.createdAt).getTime()
      const waitingMinutes = (now - createdAt) / (1000 * 60)

      // Get current escalation level from Thing data
      const data = thing.data as Record<string, unknown> | null
      const escalatedTo = data?.escalatedTo as string | undefined

      for (const rule of policy.rules) {
        if (waitingMinutes >= rule.afterMinutes && !escalatedTo) {
          // Update Thing with escalation info
          await this.things.update(record.requestId, {
            data: {
              ...data,
              escalatedTo: rule.escalateTo,
              escalatedAt: new Date().toISOString(),
            },
          })

          // Notify escalation target
          for (const channel of rule.notifyChannels) {
            await this.sendToChannel(`Escalation: ${record.message} (waiting ${Math.round(waitingMinutes)} minutes)`, channel)
          }

          await this.emit('approval.escalated', {
            requestId: record.requestId,
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

  /**
   * Send a message through a notification channel.
   *
   * Uses the shared channel abstractions from lib/human/channels when
   * channel instances are configured, otherwise emits an event for
   * external notification handling.
   *
   * @param message - The notification message
   * @param channel - Channel configuration (type, target, priority)
   * @param requestId - Optional request ID for tracking
   */
  protected async sendToChannel(
    message: string,
    channel: NotificationChannel | Channel,
    requestId?: string
  ): Promise<void> {
    // Try to use configured channel instances from lib/human/channels
    const channelInstance = await this.getChannelInstance(channel.type)

    if (channelInstance) {
      // Use the shared channel abstraction for delivery
      const payload: NotificationPayload = {
        requestId: requestId || `human-${this.ctx.id.toString()}-${Date.now()}`,
        message,
        priority: 'priority' in channel ? channel.priority : 'normal',
      }

      try {
        const result = await channelInstance.send(payload)
        await this.emit('notification.sent', {
          channel: channel.type,
          target: channel.target,
          message,
          messageId: result.messageId,
          delivered: result.delivered,
        })
      } catch (error) {
        await this.emit('notification.failed', {
          channel: channel.type,
          target: channel.target,
          message,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    } else {
      // Fallback: emit event for external notification handling
      // (legacy behavior for when channels are not configured)
      await this.emit('notification.sent', {
        channel: channel.type,
        target: channel.target,
        message,
      })
    }
  }

  /**
   * Get a channel instance by type.
   *
   * Channel instances are created from env configuration using
   * lib/human/channel-factory. Override this method to provide
   * custom channel implementations.
   */
  protected async getChannelInstance(type: string): Promise<HumanNotificationChannel | null> {
    // Check if env has channel configuration
    // Example env vars: SLACK_WEBHOOK_URL, SENDGRID_API_KEY, etc.
    try {
      switch (type) {
        case 'slack':
          if (this.env.SLACK_WEBHOOK_URL) {
            return createChannel({
              type: 'slack',
              webhookUrl: this.env.SLACK_WEBHOOK_URL,
            })
          }
          break
        case 'email':
          if (this.env.SENDGRID_API_KEY) {
            return createChannel({
              type: 'email',
              provider: 'sendgrid',
              apiKey: this.env.SENDGRID_API_KEY,
              from: this.env.EMAIL_FROM || 'noreply@dotdo.dev',
            })
          }
          break
        case 'sms':
          if (this.env.TWILIO_ACCOUNT_SID && this.env.TWILIO_AUTH_TOKEN) {
            return createChannel({
              type: 'sms',
              provider: 'twilio',
              accountSid: this.env.TWILIO_ACCOUNT_SID,
              authToken: this.env.TWILIO_AUTH_TOKEN,
              from: this.env.TWILIO_PHONE_NUMBER,
            })
          }
          break
        case 'webhook':
          // Webhooks are configured per-channel in the channel config
          break
        case 'discord':
          if (this.env.DISCORD_WEBHOOK_URL) {
            return createChannel({
              type: 'discord',
              webhookUrl: this.env.DISCORD_WEBHOOK_URL,
            })
          }
          break
      }
    } catch {
      // Channel configuration not available, fallback to event emission
    }
    return null
  }

  // =========================================================================
  // Blocking Approval Methods (for template literal pattern)
  // =========================================================================

  /**
   * Submit a blocking approval request
   * Used by the HumanClient when ceo`approve something` is awaited
   *
   * Now uses Graph model: creates an ApprovalRequest Thing with assignedTo relationship
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

    // Store the request as a Thing in the graph (with assignedTo relationship)
    await this.createApprovalRequestThing(record)

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
   *
   * Now uses Graph model: retrieves ApprovalRequest Thing by ID
   */
  async getBlockingRequest(requestId: string): Promise<BlockingApprovalRequest | null> {
    const thing = await this.getApprovalRequestThing(requestId)

    if (!thing) {
      return null
    }

    const record = this.thingToBlockingRequest(thing)

    // Check if expired
    if (record.expiresAt && record.status === 'pending') {
      const expiresAt = new Date(record.expiresAt)
      if (expiresAt <= new Date()) {
        record.status = 'expired'
        await this.updateApprovalRequestThing(record)
        await this.emit('blocking.request.expired', { requestId })
      }
    }

    return record
  }

  /**
   * Respond to a blocking approval request
   * Called when a human submits their decision
   *
   * Now uses Graph model: updates ApprovalRequest Thing with status transition
   */
  async respondToBlockingRequest(params: {
    requestId: string
    approved: boolean
    approver?: string
    reason?: string
  }): Promise<BlockingApprovalRequest> {
    const thing = await this.getApprovalRequestThing(params.requestId)

    if (!thing) {
      throw new Error(`Request not found: ${params.requestId}`)
    }

    const record = this.thingToBlockingRequest(thing)

    if (record.status !== 'pending') {
      throw new Error(`Request already ${record.status}: ${params.requestId}`)
    }

    // Update the record with the response (status transition via verb form)
    record.status = params.approved ? 'approved' : 'rejected'
    record.result = {
      approved: params.approved,
      approver: params.approver || this.ctx.id.toString(),
      reason: params.reason,
      respondedAt: new Date().toISOString(),
    }

    await this.updateApprovalRequestThing(record)

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
   *
   * Now uses Graph model: retrieves and updates ApprovalRequest Things
   */
  async alarm(): Promise<void> {
    const expirations = await this.ctx.storage.get('pending_expirations') as Record<string, number> || {}
    const now = Date.now()
    let nextAlarm: number | null = null

    for (const [requestId, expiresAt] of Object.entries(expirations)) {
      if (expiresAt <= now) {
        // Expire this request using Graph model
        const thing = await this.getApprovalRequestThing(requestId)
        if (thing) {
          const record = this.thingToBlockingRequest(thing)
          if (record.status === 'pending') {
            record.status = 'expired'
            await this.updateApprovalRequestThing(record)
            await this.emit('blocking.request.expired', { requestId })
          }
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
   *
   * Now uses Graph model: queries ApprovalRequest Things by type and status
   */
  async listBlockingRequests(status?: 'pending' | 'approved' | 'rejected' | 'expired'): Promise<BlockingApprovalRequest[]> {
    const things = await this.listApprovalRequestThings(status)
    return things.map((thing) => this.thingToBlockingRequest(thing))
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

    // DELETE /request/:id - Cancel a pending request (uses Graph model)
    if (requestMatch && request.method === 'DELETE') {
      const requestId = requestMatch[1]!
      const thing = await this.getApprovalRequestThing(requestId)

      if (!thing) {
        return new Response(JSON.stringify({ error: 'Request not found', cancelled: false }), {
          status: 404,
          headers: jsonHeaders,
        })
      }

      const record = this.thingToBlockingRequest(thing)

      if (record.status !== 'pending') {
        return new Response(JSON.stringify({ error: `Request already ${record.status}`, cancelled: false }), {
          status: 400,
          headers: jsonHeaders,
        })
      }

      await this.deleteApprovalRequestThing(requestId)
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
