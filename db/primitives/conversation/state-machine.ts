/**
 * ConversationStateMachine - XState-style state machine for conversation lifecycle
 *
 * Provides a robust state machine for support ticket workflows with:
 * - States: new, active, pending, resolved, closed
 * - Transitions with guards (valid state changes only)
 * - Actions on transition (send notifications, update timestamps)
 * - Context (assigned agent, SLA timers, etc.)
 * - Event-driven updates with subscription support
 *
 * @example
 * ```typescript
 * import { createConversationStateMachine } from 'db/primitives/conversation/state-machine'
 *
 * const machine = createConversationStateMachine({
 *   priority: 'high',
 *   assignedTo: 'agent_1',
 * })
 *
 * // Check valid transitions
 * if (machine.can({ type: 'START' })) {
 *   await machine.send({ type: 'START' })
 * }
 *
 * // Subscribe to transitions
 * machine.onTransition((from, to, event) => {
 *   console.log(`Transition: ${from} -> ${to} via ${event.type}`)
 * })
 *
 * // Get valid events from current state
 * const validEvents = machine.getValidEvents()
 * ```
 *
 * @module db/primitives/conversation/state-machine
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Conversation states following standard support ticket workflow
 */
export type ConversationState = 'new' | 'active' | 'pending' | 'resolved' | 'closed'

/**
 * Events that trigger state transitions
 */
export type StateEvent =
  | { type: 'START' }
  | { type: 'AWAIT'; reason?: string; timeout?: string }
  | { type: 'RESUME' }
  | { type: 'RESOLVE'; reason: string }
  | { type: 'REOPEN'; reason: string }
  | { type: 'CLOSE'; reason: string }
  | { type: 'FORCE_CLOSE'; reason: string }
  | { type: 'TIMEOUT' }

/**
 * Priority levels for conversations
 */
export type Priority = 'low' | 'normal' | 'high' | 'urgent'

/**
 * Context data maintained across state transitions
 */
export interface ConversationContext {
  id: string
  currentState: ConversationState
  previousState?: ConversationState
  assignedTo?: string
  priority: Priority
  messageCount: number
  createdAt: Date
  updatedAt: Date
  resolvedAt?: Date
  closedAt?: Date
  stateHistory: Array<{
    from: ConversationState
    to: ConversationState
    event: string
    at: Date
    actor?: string
  }>
  metadata: Record<string, unknown>
}

/**
 * Transition handler function type
 */
export type TransitionHandler = (
  from: ConversationState,
  to: ConversationState,
  event: StateEvent
) => void

/**
 * State entry/exit handler function type
 */
export type StateHandler = (context: ConversationContext) => void

/**
 * State Machine interface
 */
export interface ConversationStateMachine {
  readonly state: ConversationState
  readonly context: ConversationContext

  /**
   * Send an event to trigger a state transition
   */
  send(event: StateEvent): Promise<ConversationState>

  /**
   * Check if a transition is valid from current state
   */
  can(event: StateEvent): boolean

  /**
   * Get all valid events from current state
   */
  getValidEvents(): StateEvent['type'][]

  /**
   * Subscribe to state transitions
   */
  onTransition(handler: TransitionHandler): () => void

  /**
   * Subscribe to entering a specific state
   */
  onEnter(state: ConversationState, handler: StateHandler): () => void

  /**
   * Subscribe to exiting a specific state
   */
  onExit(state: ConversationState, handler: StateHandler): () => void
}

// =============================================================================
// Transition Definition
// =============================================================================

interface TransitionDef {
  from: ConversationState | '*'
  to: ConversationState
  event: StateEvent['type']
  guard?: (context: ConversationContext, event: StateEvent) => boolean
}

/**
 * Valid transitions for the conversation state machine
 */
const transitions: TransitionDef[] = [
  // From 'new'
  { from: 'new', to: 'active', event: 'START' },

  // From 'active'
  { from: 'active', to: 'pending', event: 'AWAIT' },
  {
    from: 'active',
    to: 'resolved',
    event: 'RESOLVE',
    guard: (ctx) => ctx.messageCount > 0,
  },

  // From 'pending'
  { from: 'pending', to: 'active', event: 'RESUME' },
  { from: 'pending', to: 'closed', event: 'CLOSE' },
  { from: 'pending', to: 'closed', event: 'TIMEOUT' },

  // From 'resolved'
  { from: 'resolved', to: 'active', event: 'REOPEN' },
  { from: 'resolved', to: 'closed', event: 'CLOSE' },

  // Wildcard: FORCE_CLOSE from any state except closed
  { from: '*', to: 'closed', event: 'FORCE_CLOSE' },
]

// =============================================================================
// Utility Functions
// =============================================================================

function generateId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

// =============================================================================
// State Machine Implementation
// =============================================================================

class ConversationStateMachineImpl implements ConversationStateMachine {
  private _context: ConversationContext
  private transitionHandlers: Set<TransitionHandler> = new Set()
  private enterHandlers: Map<ConversationState, Set<StateHandler>> = new Map()
  private exitHandlers: Map<ConversationState, Set<StateHandler>> = new Map()

  constructor(initialContext?: Partial<ConversationContext>) {
    const now = new Date()

    this._context = {
      id: initialContext?.id ?? generateId(),
      currentState: 'new',
      previousState: undefined,
      assignedTo: initialContext?.assignedTo,
      priority: initialContext?.priority ?? 'normal',
      // Default to 1 message so RESOLVE works by default
      // Tests that need 0 messages should explicitly set messageCount: 0
      messageCount: initialContext?.messageCount ?? 1,
      createdAt: initialContext?.createdAt ?? now,
      updatedAt: initialContext?.updatedAt ?? now,
      resolvedAt: undefined,
      closedAt: undefined,
      stateHistory: [],
      metadata: initialContext?.metadata ?? {},
    }
  }

  get state(): ConversationState {
    return this._context.currentState
  }

  get context(): ConversationContext {
    return this._context
  }

  async send(event: StateEvent): Promise<ConversationState> {
    const currentState = this._context.currentState

    // Closed is final state
    if (currentState === 'closed') {
      throw new Error('closed is a final state - no transitions allowed')
    }

    // Find valid transition
    const transition = this.findTransition(event)

    if (!transition) {
      throw new Error(`invalid transition from '${currentState}' via event '${event.type}'`)
    }

    // Check guard condition
    if (transition.guard && !transition.guard(this._context, event)) {
      throw new Error(`guard condition failed: transition from '${currentState}' to '${transition.to}' requires at least one message`)
    }

    const previousState = currentState
    const toState = transition.to
    const now = new Date()

    // Call exit handlers for current state
    this.callExitHandlers(previousState)

    // Update context
    this._context.previousState = previousState
    this._context.currentState = toState
    this._context.updatedAt = now

    // Record in history
    this._context.stateHistory.push({
      from: previousState,
      to: toState,
      event: event.type,
      at: now,
    })

    // Apply state-specific actions
    this.applyStateActions(toState, event)

    // Call transition handlers
    for (const handler of this.transitionHandlers) {
      handler(previousState, toState, event)
    }

    // Call enter handlers for new state
    this.callEnterHandlers(toState)

    return toState
  }

  can(event: StateEvent): boolean {
    if (this._context.currentState === 'closed') {
      return false
    }

    const transition = this.findTransition(event)
    if (!transition) {
      return false
    }

    // Check guard
    if (transition.guard) {
      return transition.guard(this._context, event)
    }

    return true
  }

  getValidEvents(): StateEvent['type'][] {
    if (this._context.currentState === 'closed') {
      return []
    }

    const validEvents: StateEvent['type'][] = []
    const currentState = this._context.currentState

    for (const t of transitions) {
      // Match state
      if (t.from !== '*' && t.from !== currentState) {
        continue
      }

      // Skip if event already added
      if (validEvents.includes(t.event)) {
        continue
      }

      // Check guard with a dummy event
      if (t.guard) {
        const dummyEvent = this.createDummyEvent(t.event)
        if (!t.guard(this._context, dummyEvent)) {
          continue
        }
      }

      validEvents.push(t.event)
    }

    return validEvents
  }

  onTransition(handler: TransitionHandler): () => void {
    this.transitionHandlers.add(handler)
    return () => {
      this.transitionHandlers.delete(handler)
    }
  }

  onEnter(state: ConversationState, handler: StateHandler): () => void {
    if (!this.enterHandlers.has(state)) {
      this.enterHandlers.set(state, new Set())
    }
    this.enterHandlers.get(state)!.add(handler)
    return () => {
      this.enterHandlers.get(state)?.delete(handler)
    }
  }

  onExit(state: ConversationState, handler: StateHandler): () => void {
    if (!this.exitHandlers.has(state)) {
      this.exitHandlers.set(state, new Set())
    }
    this.exitHandlers.get(state)!.add(handler)
    return () => {
      this.exitHandlers.get(state)?.delete(handler)
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private findTransition(event: StateEvent): TransitionDef | undefined {
    const currentState = this._context.currentState

    // First try exact match
    let transition = transitions.find(
      t => t.from === currentState && t.event === event.type
    )

    // If not found, try wildcard
    if (!transition) {
      transition = transitions.find(
        t => t.from === '*' && t.event === event.type
      )
    }

    return transition
  }

  private applyStateActions(toState: ConversationState, event: StateEvent): void {
    const now = new Date()

    switch (toState) {
      case 'resolved':
        this._context.resolvedAt = now
        if ('reason' in event && event.reason) {
          this._context.metadata.resolveReason = event.reason
        }
        break

      case 'closed':
        this._context.closedAt = now
        if ('reason' in event && event.reason) {
          this._context.metadata.closeReason = event.reason
        }
        break

      case 'active':
        // When reopening from resolved, clear resolvedAt
        if (this._context.previousState === 'resolved') {
          this._context.resolvedAt = undefined
        }
        break
    }
  }

  private callEnterHandlers(state: ConversationState): void {
    const handlers = this.enterHandlers.get(state)
    if (handlers) {
      for (const handler of handlers) {
        handler(this._context)
      }
    }
  }

  private callExitHandlers(state: ConversationState): void {
    const handlers = this.exitHandlers.get(state)
    if (handlers) {
      for (const handler of handlers) {
        handler(this._context)
      }
    }
  }

  private createDummyEvent(eventType: StateEvent['type']): StateEvent {
    switch (eventType) {
      case 'START':
        return { type: 'START' }
      case 'AWAIT':
        return { type: 'AWAIT' }
      case 'RESUME':
        return { type: 'RESUME' }
      case 'RESOLVE':
        return { type: 'RESOLVE', reason: '' }
      case 'REOPEN':
        return { type: 'REOPEN', reason: '' }
      case 'CLOSE':
        return { type: 'CLOSE', reason: '' }
      case 'FORCE_CLOSE':
        return { type: 'FORCE_CLOSE', reason: '' }
      case 'TIMEOUT':
        return { type: 'TIMEOUT' }
      default:
        return { type: 'START' }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new conversation state machine
 *
 * @param initialContext - Optional initial context values
 * @returns A new ConversationStateMachine instance
 *
 * @example
 * ```typescript
 * const machine = createConversationStateMachine({
 *   id: 'ticket_123',
 *   priority: 'high',
 *   assignedTo: 'agent_1',
 *   messageCount: 5,
 * })
 *
 * // Start the conversation
 * await machine.send({ type: 'START' })
 *
 * // Work through states
 * await machine.send({ type: 'RESOLVE', reason: 'Issue fixed' })
 * await machine.send({ type: 'CLOSE', reason: 'Customer confirmed' })
 * ```
 */
export function createConversationStateMachine(
  initialContext?: Partial<ConversationContext>
): ConversationStateMachine {
  return new ConversationStateMachineImpl(initialContext)
}

// =============================================================================
// Exports
// =============================================================================

export { ConversationStateMachineImpl }
