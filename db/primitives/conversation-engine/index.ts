/**
 * ConversationEngine - Multi-channel messaging and state machines
 *
 * Provides multi-channel conversation management for:
 * - Chat, email threads, support tickets, sales sequences
 * - State machine for conversation flow
 * - Handoff between agents/humans
 * - Template-based messaging
 * - Routing and escalation
 *
 * @example
 * ```typescript
 * import { ConversationEngine, createConversationEngine } from 'db/primitives/conversation-engine'
 *
 * const engine = createConversationEngine()
 *
 * // Create conversation
 * const conv = await engine.createConversation({
 *   channel: 'email',
 *   participants: [
 *     { id: 'user_123', role: 'customer', email: 'user@example.com' },
 *     { id: 'agent_456', role: 'agent', email: 'agent@company.com' },
 *   ],
 *   subject: 'Support Request',
 * })
 *
 * // Add message
 * await engine.addMessage(conv.id, {
 *   from: 'user_123',
 *   content: 'I need help with my order',
 *   contentType: 'text/plain',
 * })
 *
 * // Transition state
 * await engine.transition(conv.id, 'awaiting_response', {
 *   timeout: '24h',
 *   onTimeout: 'escalate',
 * })
 *
 * // Query conversations
 * const results = await engine.query({
 *   status: 'open',
 *   assignee: 'agent_456',
 * })
 * ```
 *
 * @module db/primitives/conversation-engine
 */

// =============================================================================
// Types - Conversation Status
// =============================================================================

export type ConversationStatus = 'open' | 'closed' | 'pending' | 'resolved'

// =============================================================================
// Types - Participant
// =============================================================================

export type ParticipantRole = 'customer' | 'agent' | 'ai' | 'system'

export interface Participant {
  id: string
  role: ParticipantRole
  name?: string
  email?: string
  phone?: string
  avatar?: string
  metadata?: Record<string, unknown>
  joinedAt: Date
  leftAt?: Date
}

export interface ParticipantOptions {
  id: string
  role: ParticipantRole
  name?: string
  email?: string
  phone?: string
  avatar?: string
  metadata?: Record<string, unknown>
}

// =============================================================================
// Types - Message
// =============================================================================

export type MessageContentType = 'text/plain' | 'text/html' | 'text/markdown' | 'application/json'

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed'

export interface MessageAttachment {
  id: string
  filename: string
  mimeType: string
  size: number
  url: string
}

export interface Message {
  id: string
  conversationId: string
  from: string
  content: string
  contentType: MessageContentType
  status: MessageStatus
  attachments?: MessageAttachment[]
  metadata?: Record<string, unknown>
  createdAt: Date
  deliveredAt?: Date
  readAt?: Date
}

export interface MessageOptions {
  from: string
  content: string
  contentType: MessageContentType
  attachments?: MessageAttachment[]
  metadata?: Record<string, unknown>
  deliverViaChannel?: boolean
}

export interface MessageContent {
  content: string
  contentType: MessageContentType
}

// =============================================================================
// Types - State Machine
// =============================================================================

export type ConversationState = string

export interface StateTransition {
  from: string | '*'
  to: string
  on?: string
  guard?: (conv: Conversation) => boolean
}

export interface StateConfig {
  initial: ConversationState
  states: ConversationState[]
  transitions: StateTransition[]
}

export interface TransitionOptions {
  event?: string
  timeout?: string
  onTimeout?: TimeoutAction
}

export type TimeoutAction = 'escalate' | 'close' | 'notify' | 'transition'

export interface TimeoutConfig {
  action: TimeoutAction
  targetState?: ConversationState
  expiresAt: Date
  timerId?: ReturnType<typeof setTimeout>
}

export interface StateHistoryEntry {
  from: ConversationState
  to: ConversationState
  at: Date
  event?: string
}

// =============================================================================
// Types - Channel
// =============================================================================

export type ChannelType = 'email' | 'sms' | 'chat' | 'social' | 'voice'

export interface ChannelConfig {
  provider?: string
  fromAddress?: string
  fromNumber?: string
  platform?: string
  accountId?: string
  [key: string]: unknown
}

export interface ChannelAdapter {
  type: ChannelType
  send: (message: Message, recipients: Participant[]) => Promise<{ messageId: string }>
  receive?: (payload: unknown) => Promise<MessageOptions>
  formatMessage: (message: Message) => Message
}

export interface Channel {
  type: ChannelType
  config: ChannelConfig
  adapter: ChannelAdapter
}

// =============================================================================
// Types - Routing
// =============================================================================

export type Priority = 'low' | 'normal' | 'high' | 'urgent'

export interface Queue {
  id: string
  priority: 'fifo' | 'priority' | 'round-robin'
  agents: string[]
  currentIndex: number
}

export interface AssignmentOptions {
  to: string
  type?: 'queue' | 'agent'
  priority?: Priority
  skills?: string[]
}

export interface EscalationOptions {
  reason: string
  to: string
  notes?: string
}

export interface TransferOptions {
  from: string
  to: string
  reason: string
  notes?: string
}

export interface EscalationRecord {
  from: string
  to: string
  reason: string
  notes?: string
  at: Date
}

export interface TransferRecord {
  from: string
  to: string
  reason: string
  notes?: string
  at: Date
}

export interface RoutingRule {
  id: string
  condition: (conv: Conversation, msg: Message) => boolean
  action: { assignTo: string }
}

// =============================================================================
// Types - Template
// =============================================================================

export interface MessageTemplate {
  id: string
  name: string
  content: string
  contentType: MessageContentType
  variables: string[]
}

export type TemplateVariables = Record<string, string | number | string[]>

export interface TemplatedMessageOptions {
  from: string
  templateId: string
  variables: TemplateVariables
}

// =============================================================================
// Types - Conversation
// =============================================================================

export interface Conversation {
  id: string
  channel: ChannelType
  status: ConversationStatus
  state: ConversationState
  subject?: string
  participants: Participant[]
  messages: Message[]
  tags?: string[]
  metadata: Record<string, unknown>
  priority?: Priority
  requiredSkills?: string[]
  assignedQueue?: string
  assignedTo?: string
  escalation?: EscalationRecord
  escalationHistory?: EscalationRecord[]
  transferHistory?: TransferRecord[]
  stateHistory: StateHistoryEntry[]
  timeout?: TimeoutConfig
  closeReason?: string
  createdAt: Date
  updatedAt: Date
  closedAt?: Date
}

export interface ConversationOptions {
  id?: string
  channel: ChannelType
  participants: ParticipantOptions[]
  subject?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface ConversationUpdateOptions {
  subject?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface CloseOptions {
  reason: string
}

export interface ReopenOptions {
  reason: string
}

// =============================================================================
// Types - Query
// =============================================================================

export interface ConversationQuery {
  status?: ConversationStatus
  channel?: ChannelType[]
  assignee?: string
  tags?: string[]
  participant?: string
  createdAfter?: Date
  createdBefore?: Date
  limit?: number
  offset?: number
  sortBy?: 'createdAt' | 'updatedAt' | 'priority'
  sortOrder?: 'asc' | 'desc'
}

export interface QueryResult {
  conversations: Conversation[]
  total: number
  hasMore: boolean
}

export interface GetMessagesOptions {
  limit?: number
  offset?: number
}

// =============================================================================
// Types - Events
// =============================================================================

export type EventType =
  | 'conversation:created'
  | 'conversation:updated'
  | 'conversation:closed'
  | 'conversation:reopened'
  | 'conversation:assigned'
  | 'message:added'
  | 'message:status'
  | 'participant:added'
  | 'participant:removed'
  | 'state:changed'
  | 'escalation'
  | 'timeout'

export type EventHandler = (event: Record<string, unknown>) => void | Promise<void>

export type TimeoutHandler = (event: { conversationId: string; action: TimeoutAction }) => void | Promise<void>

export type EscalationHandler = (event: { conversationId: string; reason: string; to: string }) => void | Promise<void>

// =============================================================================
// Types - Engine Config
// =============================================================================

export interface ConversationEngineConfig {
  defaultChannel?: ChannelType
  defaultState?: ConversationState
  maxParticipants?: number
  maxMessagesPerConversation?: number
  states?: StateConfig
}

// =============================================================================
// Types - Transition Result
// =============================================================================

export interface TransitionResult {
  state: ConversationState
  previousState: ConversationState
}

// =============================================================================
// ConversationEngine Interface
// =============================================================================

export interface ConversationEngine {
  // Conversation CRUD
  createConversation(options: ConversationOptions): Promise<Conversation>
  getConversation(id: string): Promise<Conversation | undefined>
  updateConversation(id: string, options: ConversationUpdateOptions): Promise<Conversation>
  closeConversation(id: string, options: CloseOptions): Promise<Conversation>
  reopenConversation(id: string, options: ReopenOptions): Promise<Conversation>

  // Messages
  addMessage(conversationId: string, options: MessageOptions): Promise<Message>
  getMessages(conversationId: string, options?: GetMessagesOptions): Promise<Message[]>
  updateMessageStatus(messageId: string, status: MessageStatus): Promise<Message>
  getMessagesForChannel(conversationId: string, channel: ChannelType): Promise<Message[]>

  // Participants
  addParticipant(conversationId: string, options: ParticipantOptions): Promise<Participant>
  removeParticipant(conversationId: string, participantId: string): Promise<void>
  updateParticipant(conversationId: string, participantId: string, options: Partial<ParticipantOptions>): Promise<Participant>

  // State Machine
  transition(conversationId: string, toState: ConversationState, options?: TransitionOptions): Promise<TransitionResult>
  onTimeout(handler: TimeoutHandler): void

  // Channels
  registerChannel(adapter: ChannelAdapter): void
  getChannels(): ChannelType[]

  // Routing
  createQueue(id: string, config: Omit<Queue, 'id' | 'currentIndex'>): void
  assign(conversationId: string, options: AssignmentOptions): Promise<void>
  escalate(conversationId: string, options: EscalationOptions): Promise<void>
  transfer(conversationId: string, options: TransferOptions): Promise<void>
  addRoutingRule(rule: RoutingRule): void
  onEscalation(handler: EscalationHandler): void

  // Templates
  registerTemplate(template: MessageTemplate): void
  getTemplate(id: string): MessageTemplate | undefined
  renderTemplate(templateId: string, variables: TemplateVariables): Promise<MessageContent>
  sendTemplatedMessage(conversationId: string, options: TemplatedMessageOptions): Promise<Message>

  // Query
  query(query: ConversationQuery): Promise<QueryResult>

  // Events
  on(event: EventType, handler: EventHandler): void
  off(event: EventType, handler: EventHandler): void
}

// =============================================================================
// Utility Functions
// =============================================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const value = parseInt(match[1]!, 10)
  const unit = match[2]!

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }

  return value * multipliers[unit]!
}

function stripHtml(html: string): string {
  // Simple HTML stripping - in production use a proper library
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

// =============================================================================
// ConversationEngine Implementation
// =============================================================================

class ConversationEngineImpl implements ConversationEngine {
  private conversations = new Map<string, Conversation>()
  private messages = new Map<string, Message>()
  private channels = new Map<ChannelType, ChannelAdapter>()
  private queues = new Map<string, Queue>()
  private templates = new Map<string, MessageTemplate>()
  private routingRules: RoutingRule[] = []
  private eventHandlers = new Map<EventType, Set<EventHandler>>()
  private timeoutHandlers: TimeoutHandler[] = []
  private escalationHandlers: EscalationHandler[] = []

  private config: Required<ConversationEngineConfig>
  private stateConfig: StateConfig | undefined

  constructor(config?: ConversationEngineConfig) {
    this.config = {
      defaultChannel: config?.defaultChannel ?? 'chat',
      defaultState: config?.defaultState ?? 'new',
      maxParticipants: config?.maxParticipants ?? 100,
      maxMessagesPerConversation: config?.maxMessagesPerConversation ?? 10000,
      states: config?.states!,
    }
    this.stateConfig = config?.states
  }

  // ===========================================================================
  // Conversation CRUD
  // ===========================================================================

  async createConversation(options: ConversationOptions): Promise<Conversation> {
    const id = options.id ?? generateId()

    if (this.conversations.has(id)) {
      throw new Error(`Conversation with id '${id}' already exists`)
    }

    const now = new Date()
    const participants: Participant[] = options.participants.map(p => ({
      ...p,
      joinedAt: now,
    }))

    const conversation: Conversation = {
      id,
      channel: options.channel,
      status: 'open',
      state: this.stateConfig?.initial ?? this.config.defaultState,
      subject: options.subject,
      participants,
      messages: [],
      tags: options.tags,
      metadata: options.metadata ?? {},
      stateHistory: [],
      createdAt: now,
      updatedAt: now,
    }

    this.conversations.set(id, conversation)
    this.emit('conversation:created', { conversationId: id, conversation })

    return { ...conversation }
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    const conv = this.conversations.get(id)
    return conv ? { ...conv } : undefined
  }

  async updateConversation(id: string, options: ConversationUpdateOptions): Promise<Conversation> {
    const conv = this.conversations.get(id)
    if (!conv) {
      throw new Error(`Conversation '${id}' not found`)
    }

    if (options.subject !== undefined) {
      conv.subject = options.subject
    }
    if (options.tags !== undefined) {
      conv.tags = options.tags
    }
    if (options.metadata !== undefined) {
      conv.metadata = { ...conv.metadata, ...options.metadata }
    }

    conv.updatedAt = new Date()

    this.emit('conversation:updated', { conversationId: id })

    return { ...conv }
  }

  async closeConversation(id: string, options: CloseOptions): Promise<Conversation> {
    const conv = this.conversations.get(id)
    if (!conv) {
      throw new Error(`Conversation '${id}' not found`)
    }

    if (conv.status === 'closed') {
      throw new Error(`Conversation '${id}' is already closed`)
    }

    conv.status = 'closed'
    conv.closeReason = options.reason
    conv.closedAt = new Date()
    conv.updatedAt = new Date()

    // Clear any pending timeouts
    if (conv.timeout?.timerId) {
      clearTimeout(conv.timeout.timerId)
      conv.timeout = undefined
    }

    this.emit('conversation:closed', { conversationId: id, reason: options.reason })

    return { ...conv }
  }

  async reopenConversation(id: string, options: ReopenOptions): Promise<Conversation> {
    const conv = this.conversations.get(id)
    if (!conv) {
      throw new Error(`Conversation '${id}' not found`)
    }

    if (conv.status !== 'closed') {
      throw new Error(`Conversation '${id}' is not closed`)
    }

    conv.status = 'open'
    conv.closeReason = undefined
    conv.closedAt = undefined
    conv.updatedAt = new Date()

    this.emit('conversation:reopened', { conversationId: id, reason: options.reason })

    return { ...conv }
  }

  // ===========================================================================
  // Messages
  // ===========================================================================

  async addMessage(conversationId: string, options: MessageOptions): Promise<Message> {
    const conv = this.conversations.get(conversationId)
    if (!conv) {
      throw new Error(`Conversation '${conversationId}' not found`)
    }

    const isParticipant = conv.participants.some(p => p.id === options.from)
    if (!isParticipant) {
      throw new Error(`'${options.from}' is not a participant in conversation '${conversationId}'`)
    }

    const message: Message = {
      id: generateId(),
      conversationId,
      from: options.from,
      content: options.content,
      contentType: options.contentType,
      status: 'sent',
      attachments: options.attachments,
      metadata: options.metadata,
      createdAt: new Date(),
    }

    this.messages.set(message.id, message)
    conv.messages.push(message)
    conv.updatedAt = new Date()

    // Check routing rules
    for (const rule of this.routingRules) {
      if (rule.condition(conv, message)) {
        await this.assign(conversationId, { to: rule.action.assignTo })
        break
      }
    }

    // Send via channel if requested
    if (options.deliverViaChannel) {
      const adapter = this.channels.get(conv.channel)
      if (adapter) {
        const recipients = conv.participants.filter(p => p.id !== options.from)
        await adapter.send(message, recipients)
      }
    }

    this.emit('message:added', {
      conversationId,
      messageId: message.id,
      from: options.from,
    })

    return { ...message }
  }

  async getMessages(conversationId: string, options?: GetMessagesOptions): Promise<Message[]> {
    const conv = this.conversations.get(conversationId)
    if (!conv) {
      return []
    }

    let messages = [...conv.messages]

    if (options?.offset !== undefined) {
      messages = messages.slice(options.offset)
    }

    if (options?.limit !== undefined) {
      messages = messages.slice(0, options.limit)
    }

    return messages
  }

  async updateMessageStatus(messageId: string, status: MessageStatus): Promise<Message> {
    const message = this.messages.get(messageId)
    if (!message) {
      throw new Error(`Message '${messageId}' not found`)
    }

    message.status = status

    if (status === 'delivered') {
      message.deliveredAt = new Date()
    } else if (status === 'read') {
      message.readAt = new Date()
    }

    this.emit('message:status', { messageId, status })

    return { ...message }
  }

  async getMessagesForChannel(conversationId: string, channel: ChannelType): Promise<Message[]> {
    const messages = await this.getMessages(conversationId)

    // Convert messages to target channel format
    return messages.map(msg => {
      if (channel === 'chat' && msg.contentType === 'text/html') {
        return {
          ...msg,
          content: stripHtml(msg.content),
          contentType: 'text/plain' as MessageContentType,
        }
      }
      return { ...msg }
    })
  }

  // ===========================================================================
  // Participants
  // ===========================================================================

  async addParticipant(conversationId: string, options: ParticipantOptions): Promise<Participant> {
    const conv = this.conversations.get(conversationId)
    if (!conv) {
      throw new Error(`Conversation '${conversationId}' not found`)
    }

    const exists = conv.participants.some(p => p.id === options.id)
    if (exists) {
      throw new Error(`'${options.id}' is already a participant in conversation '${conversationId}'`)
    }

    const participant: Participant = {
      ...options,
      joinedAt: new Date(),
    }

    conv.participants.push(participant)
    conv.updatedAt = new Date()

    this.emit('participant:added', { conversationId, participantId: options.id })

    return { ...participant }
  }

  async removeParticipant(conversationId: string, participantId: string): Promise<void> {
    const conv = this.conversations.get(conversationId)
    if (!conv) {
      throw new Error(`Conversation '${conversationId}' not found`)
    }

    const participant = conv.participants.find(p => p.id === participantId)
    if (!participant) {
      throw new Error(`'${participantId}' is not a participant in conversation '${conversationId}'`)
    }

    // Check if this is the last customer
    const customers = conv.participants.filter(p => p.role === 'customer')
    if (participant.role === 'customer' && customers.length === 1) {
      throw new Error(`cannot remove last customer from conversation`)
    }

    conv.participants = conv.participants.filter(p => p.id !== participantId)
    conv.updatedAt = new Date()

    this.emit('participant:removed', { conversationId, participantId })
  }

  async updateParticipant(
    conversationId: string,
    participantId: string,
    options: Partial<ParticipantOptions>,
  ): Promise<Participant> {
    const conv = this.conversations.get(conversationId)
    if (!conv) {
      throw new Error(`Conversation '${conversationId}' not found`)
    }

    const participant = conv.participants.find(p => p.id === participantId)
    if (!participant) {
      throw new Error(`'${participantId}' is not a participant in conversation '${conversationId}'`)
    }

    if (options.name !== undefined) participant.name = options.name
    if (options.email !== undefined) participant.email = options.email
    if (options.phone !== undefined) participant.phone = options.phone
    if (options.avatar !== undefined) participant.avatar = options.avatar
    if (options.metadata !== undefined) {
      participant.metadata = { ...participant.metadata, ...options.metadata }
    }

    conv.updatedAt = new Date()

    return { ...participant }
  }

  // ===========================================================================
  // State Machine
  // ===========================================================================

  async transition(
    conversationId: string,
    toState: ConversationState,
    options?: TransitionOptions,
  ): Promise<TransitionResult> {
    const conv = this.conversations.get(conversationId)
    if (!conv) {
      throw new Error(`Conversation '${conversationId}' not found`)
    }

    const previousState = conv.state

    // Validate transition if state config exists
    if (this.stateConfig) {
      const event = options?.event
      const validTransition = this.stateConfig.transitions.find(t => {
        const fromMatch = t.from === '*' || t.from === previousState
        const toMatch = t.to === toState
        // If caller specified an event, it must match.
        // If caller didn't specify event, only match transitions without a required event OR with explicit `from` match (not wildcard)
        const eventMatch = event
          ? t.on === event
          : !t.on || (t.from !== '*')

        return fromMatch && toMatch && eventMatch
      })

      if (!validTransition) {
        throw new Error(`invalid transition from '${previousState}' to '${toState}'`)
      }

      // Check guard if present
      if (validTransition.guard && !validTransition.guard(conv)) {
        throw new Error(`guard condition failed for transition from '${previousState}' to '${toState}'`)
      }
    }

    // Clear existing timeout
    if (conv.timeout?.timerId) {
      clearTimeout(conv.timeout.timerId)
      conv.timeout = undefined
    }

    // Update state
    conv.state = toState
    conv.stateHistory.push({
      from: previousState,
      to: toState,
      at: new Date(),
      event: options?.event,
    })
    conv.updatedAt = new Date()

    // Set up timeout if specified
    if (options?.timeout && options.onTimeout) {
      const durationMs = parseDuration(options.timeout)
      const expiresAt = new Date(Date.now() + durationMs)

      const timerId = setTimeout(() => {
        this.handleTimeout(conversationId, options.onTimeout!)
      }, durationMs)

      conv.timeout = {
        action: options.onTimeout,
        expiresAt,
        timerId,
      }
    }

    this.emit('state:changed', {
      conversationId,
      from: previousState,
      to: toState,
    })

    return {
      state: toState,
      previousState,
    }
  }

  private handleTimeout(conversationId: string, action: TimeoutAction): void {
    for (const handler of this.timeoutHandlers) {
      handler({ conversationId, action })
    }
  }

  onTimeout(handler: TimeoutHandler): void {
    this.timeoutHandlers.push(handler)
  }

  // ===========================================================================
  // Channels
  // ===========================================================================

  registerChannel(adapter: ChannelAdapter): void {
    this.channels.set(adapter.type, adapter)
  }

  getChannels(): ChannelType[] {
    return Array.from(this.channels.keys())
  }

  // ===========================================================================
  // Routing
  // ===========================================================================

  createQueue(id: string, config: Omit<Queue, 'id' | 'currentIndex'>): void {
    this.queues.set(id, {
      id,
      ...config,
      currentIndex: 0,
    })
  }

  async assign(conversationId: string, options: AssignmentOptions): Promise<void> {
    const conv = this.conversations.get(conversationId)
    if (!conv) {
      throw new Error(`Conversation '${conversationId}' not found`)
    }

    if (options.type === 'agent') {
      conv.assignedTo = options.to
    } else {
      // Assign to queue
      const queue = this.queues.get(options.to)
      if (queue) {
        conv.assignedQueue = options.to

        // Round-robin assignment
        if (queue.agents.length > 0) {
          conv.assignedTo = queue.agents[queue.currentIndex]
          queue.currentIndex = (queue.currentIndex + 1) % queue.agents.length
        }
      }
    }

    if (options.priority) {
      conv.priority = options.priority
    }

    if (options.skills) {
      conv.requiredSkills = options.skills
    }

    conv.updatedAt = new Date()

    this.emit('conversation:assigned', {
      conversationId,
      assignedTo: conv.assignedTo,
      assignedQueue: conv.assignedQueue,
    })
  }

  async escalate(conversationId: string, options: EscalationOptions): Promise<void> {
    const conv = this.conversations.get(conversationId)
    if (!conv) {
      throw new Error(`Conversation '${conversationId}' not found`)
    }

    const escalation: EscalationRecord = {
      from: conv.assignedQueue ?? conv.assignedTo ?? '',
      to: options.to,
      reason: options.reason,
      notes: options.notes,
      at: new Date(),
    }

    conv.escalation = escalation
    conv.escalationHistory = conv.escalationHistory ?? []
    conv.escalationHistory.push(escalation)

    // Re-assign to new queue
    await this.assign(conversationId, { to: options.to })

    // Notify handlers
    for (const handler of this.escalationHandlers) {
      handler({
        conversationId,
        reason: options.reason,
        to: options.to,
      })
    }
  }

  async transfer(conversationId: string, options: TransferOptions): Promise<void> {
    const conv = this.conversations.get(conversationId)
    if (!conv) {
      throw new Error(`Conversation '${conversationId}' not found`)
    }

    const transfer: TransferRecord = {
      from: options.from,
      to: options.to,
      reason: options.reason,
      notes: options.notes,
      at: new Date(),
    }

    conv.transferHistory = conv.transferHistory ?? []
    conv.transferHistory.push(transfer)

    conv.assignedTo = options.to
    conv.updatedAt = new Date()
  }

  addRoutingRule(rule: RoutingRule): void {
    this.routingRules.push(rule)
  }

  onEscalation(handler: EscalationHandler): void {
    this.escalationHandlers.push(handler)
  }

  // ===========================================================================
  // Templates
  // ===========================================================================

  registerTemplate(template: MessageTemplate): void {
    this.templates.set(template.id, template)
  }

  getTemplate(id: string): MessageTemplate | undefined {
    return this.templates.get(id)
  }

  async renderTemplate(templateId: string, variables: TemplateVariables): Promise<MessageContent> {
    const template = this.templates.get(templateId)
    if (!template) {
      throw new Error(`Template '${templateId}' not found`)
    }

    // Check for missing required variables
    for (const varName of template.variables) {
      // Handle filter syntax like "items|join"
      const baseName = varName.split('|')[0]!
      if (!(baseName in variables)) {
        throw new Error(`missing required variable: ${baseName}`)
      }
    }

    // Render template
    let content = template.content

    for (const [key, value] of Object.entries(variables)) {
      // Handle array with join filter
      const joinPattern = new RegExp(`\\{\\{${key}\\|join:\\s*"([^"]*)"\\}\\}`, 'g')
      content = content.replace(joinPattern, (_, separator) => {
        if (Array.isArray(value)) {
          return value.join(separator)
        }
        return String(value)
      })

      // Handle simple variable substitution
      const simplePattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g')
      content = content.replace(simplePattern, String(value))
    }

    return {
      content,
      contentType: template.contentType,
    }
  }

  async sendTemplatedMessage(
    conversationId: string,
    options: TemplatedMessageOptions,
  ): Promise<Message> {
    const rendered = await this.renderTemplate(options.templateId, options.variables)

    return this.addMessage(conversationId, {
      from: options.from,
      content: rendered.content,
      contentType: rendered.contentType,
      metadata: {
        templateId: options.templateId,
        variables: options.variables,
      },
    })
  }

  // ===========================================================================
  // Query
  // ===========================================================================

  async query(query: ConversationQuery): Promise<QueryResult> {
    let results = Array.from(this.conversations.values())

    // Filter by status
    if (query.status) {
      results = results.filter(c => c.status === query.status)
    }

    // Filter by channel
    if (query.channel && query.channel.length > 0) {
      results = results.filter(c => query.channel!.includes(c.channel))
    }

    // Filter by assignee
    if (query.assignee) {
      results = results.filter(c => c.assignedTo === query.assignee)
    }

    // Filter by tags
    if (query.tags && query.tags.length > 0) {
      results = results.filter(c =>
        query.tags!.some(tag => c.tags?.includes(tag)),
      )
    }

    // Filter by participant
    if (query.participant) {
      results = results.filter(c =>
        c.participants.some(p => p.id === query.participant),
      )
    }

    // Filter by date range
    if (query.createdAfter) {
      results = results.filter(c => c.createdAt >= query.createdAfter!)
    }
    if (query.createdBefore) {
      results = results.filter(c => c.createdAt <= query.createdBefore!)
    }

    // Sort
    const sortBy = query.sortBy ?? 'createdAt'
    const sortOrder = query.sortOrder ?? 'asc'
    results.sort((a, b) => {
      let aVal: number
      let bVal: number

      if (sortBy === 'priority') {
        const priorityOrder: Record<Priority, number> = {
          urgent: 4,
          high: 3,
          normal: 2,
          low: 1,
        }
        aVal = priorityOrder[a.priority ?? 'normal']
        bVal = priorityOrder[b.priority ?? 'normal']
      } else {
        aVal = a[sortBy].getTime()
        bVal = b[sortBy].getTime()
      }

      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal
    })

    const total = results.length

    // Pagination
    const offset = query.offset ?? 0
    const limit = query.limit ?? total

    results = results.slice(offset, offset + limit)

    return {
      conversations: results.map(c => ({ ...c })),
      total,
      hasMore: offset + limit < total,
    }
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  on(event: EventType, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  off(event: EventType, handler: EventHandler): void {
    this.eventHandlers.get(event)?.delete(handler)
  }

  private emit(event: EventType, data: Record<string, unknown>): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      Array.from(handlers).forEach(handler => {
        try {
          handler(data)
        } catch {
          // Ignore handler errors
        }
      })
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createConversationEngine(config?: ConversationEngineConfig): ConversationEngine {
  return new ConversationEngineImpl(config)
}

// =============================================================================
// Channel Adapter Factory
// =============================================================================

export function createChannelAdapter(type: ChannelType, config: ChannelConfig): ChannelAdapter {
  return {
    type,
    send: async (message, recipients) => {
      // Default implementation - in production, integrate with actual providers
      return { messageId: generateId() }
    },
    receive: async (payload) => {
      return {
        from: 'unknown',
        content: String(payload),
        contentType: 'text/plain',
      }
    },
    formatMessage: (message) => message,
  }
}

// =============================================================================
// Export the implementation class
// =============================================================================

export { ConversationEngineImpl }
