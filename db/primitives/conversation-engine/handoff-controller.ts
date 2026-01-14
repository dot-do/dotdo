/**
 * HandoffController - AI-to-Human and Human-to-AI handoff protocol
 *
 * Implements seamless handoff transitions for support conversations with:
 * - AI to human handoff triggers (confidence threshold, explicit request, sentiment)
 * - Human to AI handoff (resolution, after-hours, overflow)
 * - Context preservation during handoff
 * - Handoff notification to all parties
 * - Handoff reason and history tracking
 *
 * @example
 * ```typescript
 * import { createHandoffController, HandoffTrigger } from 'db/primitives/conversation-engine/handoff-controller'
 * import { createConversationEngine } from 'db/primitives/conversation-engine'
 *
 * const engine = createConversationEngine()
 * const handoff = createHandoffController(engine)
 *
 * // Configure AI to human triggers
 * handoff.configureTrigger({
 *   type: 'confidence_threshold',
 *   threshold: 0.7,
 *   action: 'escalate_to_human',
 * })
 *
 * // Initiate handoff
 * await handoff.initiateHandoff(conversationId, {
 *   from: { id: 'ai_bot', type: 'ai' },
 *   to: { id: 'support_queue', type: 'human' },
 *   reason: 'low_confidence',
 *   context: {
 *     summary: 'Customer asking about refund policy',
 *     sentiment: 'frustrated',
 *     lastAiResponse: 'I understand your concern...',
 *   },
 * })
 * ```
 *
 * @module db/primitives/conversation-engine/handoff-controller
 */

import type { ConversationEngine, Conversation, Message, Participant, ParticipantRole } from './index'

// =============================================================================
// Types - Participant Identity
// =============================================================================

export type HandoffParticipantType = 'ai' | 'human' | 'queue'

export interface HandoffParticipant {
  id: string
  type: HandoffParticipantType
  name?: string
  metadata?: Record<string, unknown>
}

// =============================================================================
// Types - Handoff Triggers
// =============================================================================

export type HandoffTriggerType =
  | 'confidence_threshold'
  | 'explicit_request'
  | 'sentiment_negative'
  | 'topic_sensitive'
  | 'max_ai_turns'
  | 'timeout'
  | 'manual'
  | 'after_hours'
  | 'resolution'
  | 'overflow'

export interface HandoffTriggerConfig {
  type: HandoffTriggerType
  enabled?: boolean
  threshold?: number
  keywords?: string[]
  topics?: string[]
  maxTurns?: number
  timeoutMs?: number
  action: 'escalate_to_human' | 'escalate_to_ai' | 'notify' | 'queue'
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  targetQueue?: string
}

export interface TriggerEvaluation {
  triggered: boolean
  triggerType: HandoffTriggerType
  confidence: number
  reason: string
  metadata?: Record<string, unknown>
}

// =============================================================================
// Types - Handoff Context
// =============================================================================

export interface HandoffContext {
  /** Summary of conversation so far */
  summary?: string
  /** Customer sentiment analysis */
  sentiment?: 'positive' | 'neutral' | 'negative' | 'frustrated' | 'angry'
  /** Key topics discussed */
  topics?: string[]
  /** Intent detected by AI */
  intent?: string
  /** Customer's original question/issue */
  originalIssue?: string
  /** Last AI response before handoff */
  lastAiResponse?: string
  /** AI confidence score at handoff */
  aiConfidence?: number
  /** Number of AI turns in conversation */
  aiTurns?: number
  /** Suggested actions for human agent */
  suggestedActions?: string[]
  /** Customer profile/history */
  customerProfile?: {
    id: string
    name?: string
    email?: string
    tier?: string
    lifetime_value?: number
    previous_tickets?: number
    satisfaction_score?: number
  }
  /** Additional custom context */
  custom?: Record<string, unknown>
}

// =============================================================================
// Types - Handoff Reason
// =============================================================================

export type HandoffReasonCode =
  | 'low_confidence'
  | 'customer_requested'
  | 'negative_sentiment'
  | 'sensitive_topic'
  | 'max_turns_exceeded'
  | 'timeout_exceeded'
  | 'manual_escalation'
  | 'ai_unavailable'
  | 'after_hours_end'
  | 'issue_resolved'
  | 'agent_initiated'
  | 'overflow_to_ai'
  | 'routine_inquiry'

export interface HandoffReason {
  code: HandoffReasonCode
  description: string
  triggeredBy?: HandoffTriggerType
  metadata?: Record<string, unknown>
}

// =============================================================================
// Types - Handoff Request/Record
// =============================================================================

export interface HandoffRequest {
  from: HandoffParticipant
  to: HandoffParticipant
  reason: HandoffReasonCode | HandoffReason
  context?: HandoffContext
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  notifyParticipants?: boolean
  preserveContext?: boolean
}

export type HandoffStatus = 'pending' | 'accepted' | 'rejected' | 'completed' | 'cancelled'

export interface HandoffRecord {
  id: string
  conversationId: string
  from: HandoffParticipant
  to: HandoffParticipant
  reason: HandoffReason
  context: HandoffContext
  status: HandoffStatus
  priority: 'low' | 'normal' | 'high' | 'urgent'
  createdAt: Date
  acceptedAt?: Date
  completedAt?: Date
  acceptedBy?: string
  rejectionReason?: string
  metadata?: Record<string, unknown>
}

// =============================================================================
// Types - Handoff Events
// =============================================================================

export type HandoffEventType =
  | 'handoff:initiated'
  | 'handoff:accepted'
  | 'handoff:rejected'
  | 'handoff:completed'
  | 'handoff:cancelled'
  | 'handoff:timeout'
  | 'trigger:detected'

export interface HandoffEvent {
  type: HandoffEventType
  handoffId: string
  conversationId: string
  timestamp: Date
  data: Record<string, unknown>
}

export type HandoffEventHandler = (event: HandoffEvent) => void | Promise<void>

// =============================================================================
// Types - Notification
// =============================================================================

export interface HandoffNotification {
  type: 'handoff_initiated' | 'handoff_accepted' | 'handoff_completed' | 'context_update'
  recipients: string[]
  handoffId: string
  conversationId: string
  message: string
  context?: HandoffContext
  timestamp: Date
}

export type NotificationHandler = (notification: HandoffNotification) => void | Promise<void>

// =============================================================================
// Types - Controller Interface
// =============================================================================

export interface HandoffController {
  // Configuration
  configureTrigger(config: HandoffTriggerConfig): void
  removeTrigger(type: HandoffTriggerType): void
  getTriggers(): HandoffTriggerConfig[]

  // Handoff Operations
  initiateHandoff(conversationId: string, request: HandoffRequest): Promise<HandoffRecord>
  acceptHandoff(handoffId: string, acceptedBy: string): Promise<HandoffRecord>
  rejectHandoff(handoffId: string, reason: string): Promise<HandoffRecord>
  completeHandoff(handoffId: string): Promise<HandoffRecord>
  cancelHandoff(handoffId: string, reason?: string): Promise<HandoffRecord>

  // Query
  getHandoff(handoffId: string): Promise<HandoffRecord | undefined>
  getHandoffHistory(conversationId: string): Promise<HandoffRecord[]>
  getPendingHandoffs(queue?: string): Promise<HandoffRecord[]>

  // Context
  updateContext(handoffId: string, context: Partial<HandoffContext>): Promise<HandoffRecord>
  getContext(handoffId: string): Promise<HandoffContext | undefined>

  // Trigger Evaluation
  evaluateTriggers(conversationId: string, message?: Message): Promise<TriggerEvaluation[]>
  shouldHandoff(conversationId: string, message?: Message): Promise<boolean>

  // Events
  on(event: HandoffEventType, handler: HandoffEventHandler): void
  off(event: HandoffEventType, handler: HandoffEventHandler): void

  // Notifications
  onNotification(handler: NotificationHandler): void
  offNotification(handler: NotificationHandler): void
}

// =============================================================================
// Utility Functions
// =============================================================================

function generateId(): string {
  return `ho_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

function normalizeReason(reason: HandoffReasonCode | HandoffReason): HandoffReason {
  if (typeof reason === 'string') {
    const descriptions: Record<HandoffReasonCode, string> = {
      low_confidence: 'AI confidence below threshold',
      customer_requested: 'Customer requested human agent',
      negative_sentiment: 'Negative customer sentiment detected',
      sensitive_topic: 'Sensitive topic requires human handling',
      max_turns_exceeded: 'Maximum AI conversation turns exceeded',
      timeout_exceeded: 'Response timeout exceeded',
      manual_escalation: 'Manual escalation by operator',
      ai_unavailable: 'AI agent unavailable',
      after_hours_end: 'Business hours resumed',
      issue_resolved: 'Issue resolved, returning to AI',
      agent_initiated: 'Human agent initiated handoff',
      overflow_to_ai: 'Queue overflow, routing to AI',
      routine_inquiry: 'Routine inquiry suitable for AI',
    }
    return {
      code: reason,
      description: descriptions[reason] || reason,
    }
  }
  return reason
}

// =============================================================================
// HandoffController Implementation
// =============================================================================

class HandoffControllerImpl implements HandoffController {
  private engine: ConversationEngine
  private triggers: Map<HandoffTriggerType, HandoffTriggerConfig> = new Map()
  private handoffs: Map<string, HandoffRecord> = new Map()
  private conversationHandoffs: Map<string, string[]> = new Map()
  private eventHandlers: Map<HandoffEventType, Set<HandoffEventHandler>> = new Map()
  private notificationHandlers: Set<NotificationHandler> = new Set()

  constructor(engine: ConversationEngine) {
    this.engine = engine
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  configureTrigger(config: HandoffTriggerConfig): void {
    this.triggers.set(config.type, { ...config, enabled: config.enabled ?? true })
  }

  removeTrigger(type: HandoffTriggerType): void {
    this.triggers.delete(type)
  }

  getTriggers(): HandoffTriggerConfig[] {
    return Array.from(this.triggers.values())
  }

  // ===========================================================================
  // Handoff Operations
  // ===========================================================================

  async initiateHandoff(conversationId: string, request: HandoffRequest): Promise<HandoffRecord> {
    const conversation = await this.engine.getConversation(conversationId)
    if (!conversation) {
      throw new Error(`Conversation '${conversationId}' not found`)
    }

    const handoffId = generateId()
    const reason = normalizeReason(request.reason)

    const record: HandoffRecord = {
      id: handoffId,
      conversationId,
      from: request.from,
      to: request.to,
      reason,
      context: request.context ?? {},
      status: 'pending',
      priority: request.priority ?? 'normal',
      createdAt: new Date(),
    }

    this.handoffs.set(handoffId, record)

    // Track handoffs per conversation
    const existing = this.conversationHandoffs.get(conversationId) ?? []
    existing.push(handoffId)
    this.conversationHandoffs.set(conversationId, existing)

    // Add handoff participant to conversation if needed
    if (request.to.type !== 'queue') {
      const role: ParticipantRole = request.to.type === 'ai' ? 'ai' : 'agent'
      try {
        await this.engine.addParticipant(conversationId, {
          id: request.to.id,
          role,
          name: request.to.name,
          metadata: { handoffId, handoffType: request.to.type },
        })
      } catch {
        // Participant may already exist
      }
    }

    // Emit event
    this.emitEvent({
      type: 'handoff:initiated',
      handoffId,
      conversationId,
      timestamp: new Date(),
      data: { from: request.from, to: request.to, reason, priority: record.priority },
    })

    // Send notifications
    if (request.notifyParticipants !== false) {
      await this.sendNotification({
        type: 'handoff_initiated',
        recipients: this.getNotificationRecipients(conversation, request),
        handoffId,
        conversationId,
        message: this.formatHandoffMessage(record),
        context: record.context,
        timestamp: new Date(),
      })
    }

    return { ...record }
  }

  async acceptHandoff(handoffId: string, acceptedBy: string): Promise<HandoffRecord> {
    const record = this.handoffs.get(handoffId)
    if (!record) {
      throw new Error(`Handoff '${handoffId}' not found`)
    }

    if (record.status !== 'pending') {
      throw new Error(`Handoff '${handoffId}' is not pending (status: ${record.status})`)
    }

    record.status = 'accepted'
    record.acceptedAt = new Date()
    record.acceptedBy = acceptedBy

    this.emitEvent({
      type: 'handoff:accepted',
      handoffId,
      conversationId: record.conversationId,
      timestamp: new Date(),
      data: { acceptedBy },
    })

    // Send notification
    const conversation = await this.engine.getConversation(record.conversationId)
    if (conversation) {
      await this.sendNotification({
        type: 'handoff_accepted',
        recipients: this.getAllParticipantIds(conversation),
        handoffId,
        conversationId: record.conversationId,
        message: `Handoff accepted by ${acceptedBy}`,
        timestamp: new Date(),
      })
    }

    return { ...record }
  }

  async rejectHandoff(handoffId: string, reason: string): Promise<HandoffRecord> {
    const record = this.handoffs.get(handoffId)
    if (!record) {
      throw new Error(`Handoff '${handoffId}' not found`)
    }

    if (record.status !== 'pending') {
      throw new Error(`Handoff '${handoffId}' is not pending (status: ${record.status})`)
    }

    record.status = 'rejected'
    record.rejectionReason = reason

    this.emitEvent({
      type: 'handoff:rejected',
      handoffId,
      conversationId: record.conversationId,
      timestamp: new Date(),
      data: { reason },
    })

    return { ...record }
  }

  async completeHandoff(handoffId: string): Promise<HandoffRecord> {
    const record = this.handoffs.get(handoffId)
    if (!record) {
      throw new Error(`Handoff '${handoffId}' not found`)
    }

    if (record.status !== 'accepted') {
      throw new Error(`Handoff '${handoffId}' must be accepted before completing (status: ${record.status})`)
    }

    record.status = 'completed'
    record.completedAt = new Date()

    this.emitEvent({
      type: 'handoff:completed',
      handoffId,
      conversationId: record.conversationId,
      timestamp: new Date(),
      data: {},
    })

    // Send notification
    const conversation = await this.engine.getConversation(record.conversationId)
    if (conversation) {
      await this.sendNotification({
        type: 'handoff_completed',
        recipients: this.getAllParticipantIds(conversation),
        handoffId,
        conversationId: record.conversationId,
        message: 'Handoff completed successfully',
        timestamp: new Date(),
      })
    }

    return { ...record }
  }

  async cancelHandoff(handoffId: string, reason?: string): Promise<HandoffRecord> {
    const record = this.handoffs.get(handoffId)
    if (!record) {
      throw new Error(`Handoff '${handoffId}' not found`)
    }

    if (record.status === 'completed') {
      throw new Error(`Cannot cancel completed handoff '${handoffId}'`)
    }

    record.status = 'cancelled'
    record.metadata = { ...record.metadata, cancellationReason: reason }

    this.emitEvent({
      type: 'handoff:cancelled',
      handoffId,
      conversationId: record.conversationId,
      timestamp: new Date(),
      data: { reason },
    })

    return { ...record }
  }

  // ===========================================================================
  // Query
  // ===========================================================================

  async getHandoff(handoffId: string): Promise<HandoffRecord | undefined> {
    const record = this.handoffs.get(handoffId)
    return record ? { ...record } : undefined
  }

  async getHandoffHistory(conversationId: string): Promise<HandoffRecord[]> {
    const handoffIds = this.conversationHandoffs.get(conversationId) ?? []
    return handoffIds
      .map(id => this.handoffs.get(id))
      .filter((r): r is HandoffRecord => r !== undefined)
      .map(r => ({ ...r }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  async getPendingHandoffs(queue?: string): Promise<HandoffRecord[]> {
    return Array.from(this.handoffs.values())
      .filter(r => {
        if (r.status !== 'pending') return false
        if (queue && r.to.type === 'queue' && r.to.id !== queue) return false
        if (queue && r.to.type !== 'queue') return false
        return true
      })
      .map(r => ({ ...r }))
      .sort((a, b) => {
        // Sort by priority then by creation time
        const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 }
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
        if (priorityDiff !== 0) return priorityDiff
        return a.createdAt.getTime() - b.createdAt.getTime()
      })
  }

  // ===========================================================================
  // Context
  // ===========================================================================

  async updateContext(handoffId: string, context: Partial<HandoffContext>): Promise<HandoffRecord> {
    const record = this.handoffs.get(handoffId)
    if (!record) {
      throw new Error(`Handoff '${handoffId}' not found`)
    }

    record.context = { ...record.context, ...context }

    // Send context update notification
    const conversation = await this.engine.getConversation(record.conversationId)
    if (conversation) {
      await this.sendNotification({
        type: 'context_update',
        recipients: [record.to.id],
        handoffId,
        conversationId: record.conversationId,
        message: 'Handoff context updated',
        context: record.context,
        timestamp: new Date(),
      })
    }

    return { ...record }
  }

  async getContext(handoffId: string): Promise<HandoffContext | undefined> {
    const record = this.handoffs.get(handoffId)
    return record ? { ...record.context } : undefined
  }

  // ===========================================================================
  // Trigger Evaluation
  // ===========================================================================

  async evaluateTriggers(conversationId: string, message?: Message): Promise<TriggerEvaluation[]> {
    const conversation = await this.engine.getConversation(conversationId)
    if (!conversation) {
      return []
    }

    const evaluations: TriggerEvaluation[] = []

    for (const [type, config] of this.triggers) {
      if (!config.enabled) continue

      const evaluation = await this.evaluateSingleTrigger(config, conversation, message)
      if (evaluation.triggered) {
        evaluations.push(evaluation)

        this.emitEvent({
          type: 'trigger:detected',
          handoffId: '',
          conversationId,
          timestamp: new Date(),
          data: { trigger: type, evaluation },
        })
      }
    }

    return evaluations
  }

  async shouldHandoff(conversationId: string, message?: Message): Promise<boolean> {
    const evaluations = await this.evaluateTriggers(conversationId, message)
    return evaluations.length > 0
  }

  private async evaluateSingleTrigger(
    config: HandoffTriggerConfig,
    conversation: Conversation,
    message?: Message,
  ): Promise<TriggerEvaluation> {
    const baseResult = {
      triggered: false,
      triggerType: config.type,
      confidence: 0,
      reason: '',
    }

    switch (config.type) {
      case 'confidence_threshold': {
        // Check AI confidence in message metadata
        const confidence = message?.metadata?.aiConfidence as number | undefined
        if (confidence !== undefined && config.threshold !== undefined) {
          if (confidence < config.threshold) {
            return {
              ...baseResult,
              triggered: true,
              confidence,
              reason: `AI confidence ${confidence.toFixed(2)} below threshold ${config.threshold}`,
              metadata: { aiConfidence: confidence, threshold: config.threshold },
            }
          }
        }
        break
      }

      case 'explicit_request': {
        // Check for keywords indicating human request
        const content = message?.content?.toLowerCase() ?? ''
        const keywords = config.keywords ?? ['human', 'agent', 'person', 'representative', 'speak to someone', 'talk to a human']
        const matched = keywords.find(k => content.includes(k.toLowerCase()))
        if (matched) {
          return {
            ...baseResult,
            triggered: true,
            confidence: 1.0,
            reason: `Customer requested human agent (matched: "${matched}")`,
            metadata: { matchedKeyword: matched },
          }
        }
        break
      }

      case 'sentiment_negative': {
        // Check sentiment in message or conversation metadata
        const sentiment = (message?.metadata?.sentiment ?? conversation.metadata.sentiment) as string | undefined
        const negativeStates = ['negative', 'frustrated', 'angry']
        if (sentiment && negativeStates.includes(sentiment)) {
          return {
            ...baseResult,
            triggered: true,
            confidence: 0.9,
            reason: `Negative sentiment detected: ${sentiment}`,
            metadata: { sentiment },
          }
        }
        break
      }

      case 'topic_sensitive': {
        // Check for sensitive topics
        const content = message?.content?.toLowerCase() ?? ''
        const topics = config.topics ?? ['legal', 'lawsuit', 'refund', 'cancel', 'complaint', 'manager']
        const matched = topics.find(t => content.includes(t.toLowerCase()))
        if (matched) {
          return {
            ...baseResult,
            triggered: true,
            confidence: 0.85,
            reason: `Sensitive topic detected: ${matched}`,
            metadata: { topic: matched },
          }
        }
        break
      }

      case 'max_ai_turns': {
        // Count AI participant messages
        const aiMessages = conversation.messages.filter(m => {
          const participant = conversation.participants.find(p => p.id === m.from)
          return participant?.role === 'ai'
        })
        const maxTurns = config.maxTurns ?? 5
        if (aiMessages.length >= maxTurns) {
          return {
            ...baseResult,
            triggered: true,
            confidence: 1.0,
            reason: `Maximum AI turns (${maxTurns}) exceeded`,
            metadata: { aiTurns: aiMessages.length, maxTurns },
          }
        }
        break
      }

      case 'manual': {
        // Manual trigger - always triggered when evaluated explicitly
        return {
          ...baseResult,
          triggered: true,
          confidence: 1.0,
          reason: 'Manual escalation requested',
        }
      }

      default:
        break
    }

    return baseResult
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  on(event: HandoffEventType, handler: HandoffEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  off(event: HandoffEventType, handler: HandoffEventHandler): void {
    this.eventHandlers.get(event)?.delete(handler)
  }

  private emitEvent(event: HandoffEvent): void {
    const handlers = this.eventHandlers.get(event.type)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event)
        } catch {
          // Ignore handler errors
        }
      }
    }
  }

  // ===========================================================================
  // Notifications
  // ===========================================================================

  onNotification(handler: NotificationHandler): void {
    this.notificationHandlers.add(handler)
  }

  offNotification(handler: NotificationHandler): void {
    this.notificationHandlers.delete(handler)
  }

  private async sendNotification(notification: HandoffNotification): Promise<void> {
    for (const handler of this.notificationHandlers) {
      try {
        await handler(notification)
      } catch {
        // Ignore notification errors
      }
    }
  }

  private getNotificationRecipients(conversation: Conversation, request: HandoffRequest): string[] {
    const recipients = new Set<string>()

    // Add all conversation participants
    for (const p of conversation.participants) {
      recipients.add(p.id)
    }

    // Add handoff target
    if (request.to.type !== 'queue') {
      recipients.add(request.to.id)
    }

    return Array.from(recipients)
  }

  private getAllParticipantIds(conversation: Conversation): string[] {
    return conversation.participants.map(p => p.id)
  }

  private formatHandoffMessage(record: HandoffRecord): string {
    const fromType = record.from.type === 'ai' ? 'AI' : 'Agent'
    const toType = record.to.type === 'ai' ? 'AI' : record.to.type === 'queue' ? 'Queue' : 'Agent'
    return `Handoff initiated from ${fromType} (${record.from.id}) to ${toType} (${record.to.id}): ${record.reason.description}`
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createHandoffController(engine: ConversationEngine): HandoffController {
  return new HandoffControllerImpl(engine)
}

// =============================================================================
// Export Implementation Class
// =============================================================================

export { HandoffControllerImpl }
