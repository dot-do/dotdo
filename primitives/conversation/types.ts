/**
 * Conversation State Machine Types
 *
 * Type definitions for XState-powered conversation lifecycle management.
 * Supports multi-channel conversations (chat, email, support, sales).
 */

// =============================================================================
// State Types
// =============================================================================

/**
 * Core conversation states
 */
export type ConversationState = 'open' | 'waiting' | 'resolved' | 'closed'

/**
 * Extended conversation states for complex workflows
 */
export type ExtendedConversationState =
  | 'open'
  | 'waiting'
  | 'waiting_customer'
  | 'waiting_agent'
  | 'waiting_approval'
  | 'escalated'
  | 'resolved'
  | 'closed'

// =============================================================================
// Event Types
// =============================================================================

/**
 * Base event structure
 */
export interface ConversationEvent {
  type: string
  timestamp?: Date
  actor?: string
  metadata?: Record<string, unknown>
}

/**
 * Core conversation events
 */
export type CoreConversationEvent =
  | { type: 'MESSAGE_RECEIVED'; from: string; content: string }
  | { type: 'MESSAGE_SENT'; to: string; content: string }
  | { type: 'ASSIGN'; to: string }
  | { type: 'WAIT'; reason?: string; timeout?: string }
  | { type: 'RESPOND' }
  | { type: 'RESOLVE'; reason: string }
  | { type: 'REOPEN'; reason: string }
  | { type: 'CLOSE'; reason: string }
  | { type: 'ESCALATE'; to: string; reason: string }
  | { type: 'TIMEOUT' }
  | { type: 'TRANSFER'; from: string; to: string }

// =============================================================================
// Context Types
// =============================================================================

/**
 * Participant in a conversation
 */
export interface ConversationParticipant {
  id: string
  role: 'customer' | 'agent' | 'ai' | 'system'
  name?: string
  email?: string
  joinedAt: Date
  leftAt?: Date
}

/**
 * Message in a conversation
 */
export interface ConversationMessage {
  id: string
  from: string
  content: string
  contentType: 'text/plain' | 'text/html' | 'text/markdown'
  createdAt: Date
  metadata?: Record<string, unknown>
}

/**
 * Conversation context (persistent data)
 */
export interface ConversationContext {
  id: string
  channel: 'chat' | 'email' | 'sms' | 'social' | 'voice'
  subject?: string
  participants: ConversationParticipant[]
  messages: ConversationMessage[]
  assignedTo?: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  tags: string[]
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  resolvedAt?: Date
  closedAt?: Date
  closeReason?: string
  resolveReason?: string
  escalationHistory: EscalationRecord[]
  stateHistory: StateHistoryEntry[]
  timeout?: TimeoutConfig
}

/**
 * Escalation record
 */
export interface EscalationRecord {
  from: string
  to: string
  reason: string
  at: Date
}

/**
 * State history entry
 */
export interface StateHistoryEntry {
  from: ConversationState
  to: ConversationState
  event: string
  at: Date
  actor?: string
}

/**
 * Timeout configuration
 */
export interface TimeoutConfig {
  duration: string
  action: 'escalate' | 'close' | 'notify' | 'remind'
  expiresAt: Date
}

// =============================================================================
// Machine Configuration Types
// =============================================================================

/**
 * Guard function type
 */
export type ConversationGuard<TContext extends ConversationContext = ConversationContext> = (
  context: TContext,
  event: CoreConversationEvent
) => boolean

/**
 * Action function type
 */
export type ConversationAction<TContext extends ConversationContext = ConversationContext> = (
  context: TContext,
  event: CoreConversationEvent
) => Partial<TContext> | void

/**
 * Transition configuration
 */
export interface ConversationTransition<TContext extends ConversationContext = ConversationContext> {
  target: ConversationState
  guard?: ConversationGuard<TContext>
  actions?: ConversationAction<TContext>[]
}

/**
 * State configuration
 */
export interface ConversationStateConfig<TContext extends ConversationContext = ConversationContext> {
  on?: Record<string, ConversationState | ConversationTransition<TContext>>
  entry?: ConversationAction<TContext>[]
  exit?: ConversationAction<TContext>[]
  type?: 'final'
}

/**
 * Machine configuration
 */
export interface ConversationMachineConfig<TContext extends ConversationContext = ConversationContext> {
  id: string
  initial: ConversationState
  context?: Partial<TContext>
  states: Record<ConversationState, ConversationStateConfig<TContext>>
  guards?: Record<string, ConversationGuard<TContext>>
  actions?: Record<string, ConversationAction<TContext>>
}

// =============================================================================
// Machine Interface
// =============================================================================

/**
 * Handler for state transitions
 */
export type TransitionHandler = (
  from: ConversationState,
  to: ConversationState,
  event: CoreConversationEvent
) => void

/**
 * Handler for entering a specific state
 */
export type StateHandler<TContext extends ConversationContext = ConversationContext> = (
  context: TContext
) => void

/**
 * Timeout handler
 */
export type TimeoutHandler = (context: ConversationContext) => void

/**
 * Storage interface for DO persistence
 */
export interface ConversationStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * Conversation Machine interface
 */
export interface ConversationMachine<TContext extends ConversationContext = ConversationContext> {
  readonly state: ConversationState
  readonly context: TContext

  /**
   * Send an event to trigger a state transition
   */
  send(event: CoreConversationEvent): Promise<ConversationState>

  /**
   * Check if a transition is valid from current state
   */
  can(event: CoreConversationEvent): boolean

  /**
   * Subscribe to all state transitions
   */
  onTransition(handler: TransitionHandler): () => void

  /**
   * Subscribe to entering a specific state
   */
  onState(state: ConversationState, handler: StateHandler<TContext>): () => void

  /**
   * Subscribe to timeout events
   */
  onTimeout(handler: TimeoutHandler): () => void

  /**
   * Set a timeout for the current state
   */
  setTimeout(duration: string, action: TimeoutConfig['action']): void

  /**
   * Clear any active timeout
   */
  clearTimeout(): void

  /**
   * Persist current state to DO storage
   */
  persist(): Promise<void>

  /**
   * Restore state from DO storage
   */
  restore(id: string): Promise<void>

  /**
   * Stop the machine actor
   */
  stop(): void
}

/**
 * Factory for creating conversation machine instances
 */
export interface ConversationMachineFactory<TContext extends ConversationContext = ConversationContext> {
  create(initialContext?: Partial<TContext>, storage?: ConversationStorage): ConversationMachine<TContext>
}
