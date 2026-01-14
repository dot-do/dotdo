/**
 * ConversationStateMachine - XState-style state machine for conversation lifecycle
 *
 * Provides a robust state machine for support ticket workflows with:
 * - States: new, active, pending, resolved, closed
 * - Transitions with guards (valid state changes only)
 * - Actions on transition (send notifications, update timestamps)
 * - Context (assigned agent, SLA timers, etc.)
 * - Event-driven updates with subscription support
 * - Serialization and hydration for persistence
 *
 * @example
 * ```typescript
 * import { createStateMachine } from 'db/primitives/conversation/state-machine'
 *
 * const machine = createStateMachine({
 *   initialContext: {
 *     priority: 'high',
 *     assignee: 'agent_1',
 *   },
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
 * const validEvents = machine.getValidTransitions()
 * ```
 *
 * @module db/primitives/conversation/state-machine
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Valid conversation states
 */
export type ConversationState = 'new' | 'active' | 'pending' | 'resolved' | 'closed'

/**
 * Events that trigger state transitions
 */
export type TransitionEvent =
  | { type: 'START'; actor?: string }
  | { type: 'AWAIT'; reason: string; timeout?: number }
  | { type: 'RESUME'; actor?: string }
  | { type: 'RESOLVE'; reason: string; actor?: string }
  | { type: 'REOPEN'; reason: string; actor?: string }
  | { type: 'CLOSE'; reason: string; actor?: string }
  | { type: 'FORCE_CLOSE'; reason: string; actor?: string }
  | { type: 'TIMEOUT' }
  | { type: 'ESCALATE'; to: string; reason: string }

/**
 * State history entry
 */
export interface StateHistoryEntry {
  from: ConversationState
  to: ConversationState
  event: TransitionEvent['type']
  timestamp: Date
  actor?: string
  reason?: string
}

/**
 * State machine context
 */
export interface StateMachineContext {
  id: string
  state: ConversationState
  previousState?: ConversationState
  messageCount: number
  assignee?: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  slaBreached: boolean
  createdAt: Date
  updatedAt: Date
  resolvedAt?: Date
  closedAt?: Date
  pendingSince?: Date
  awaitReason?: string
  closeReason?: string
  resolveReason?: string
  history: StateHistoryEntry[]
  metadata: Record<string, unknown>
}

/**
 * Side effect callback type
 */
export type SideEffect = (context: StateMachineContext, event: TransitionEvent) => void | Promise<void>

/**
 * State machine configuration
 */
export interface StateMachineConfig {
  initialContext?: Partial<StateMachineContext>
  guards?: {
    [key: string]: (context: StateMachineContext, event: TransitionEvent) => boolean
  }
  actions?: {
    onEntry?: { [state in ConversationState]?: SideEffect[] }
    onExit?: { [state in ConversationState]?: SideEffect[] }
    onTransition?: SideEffect[]
  }
}

/**
 * State machine interface
 */
export interface ConversationStateMachine {
  // Current state
  readonly state: ConversationState
  readonly context: StateMachineContext

  // Transition methods
  send(event: TransitionEvent): Promise<ConversationState>
  can(event: TransitionEvent): boolean

  // Query methods
  getValidTransitions(): TransitionEvent['type'][]
  getHistory(): StateHistoryEntry[]
  getTimeInState(): number

  // Event subscriptions
  onTransition(callback: (from: ConversationState, to: ConversationState, event: TransitionEvent) => void): () => void
  onStateEnter(state: ConversationState, callback: (context: StateMachineContext) => void): () => void
  onStateExit(state: ConversationState, callback: (context: StateMachineContext) => void): () => void

  // Persistence
  serialize(): string
  hydrate(serialized: string): void
}

// =============================================================================
// Transition Definition
// =============================================================================

interface TransitionDef {
  from: ConversationState | '*'
  to: ConversationState
  event: TransitionEvent['type']
  builtInGuard?: (context: StateMachineContext, event: TransitionEvent) => boolean
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
    builtInGuard: (ctx) => ctx.messageCount > 0,
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
  private _context: StateMachineContext
  private _stateEnteredAt: Date
  private _config: StateMachineConfig

  // Subscribers
  private transitionCallbacks: Set<(from: ConversationState, to: ConversationState, event: TransitionEvent) => void> = new Set()
  private stateEnterCallbacks: Map<ConversationState, Set<(context: StateMachineContext) => void>> = new Map()
  private stateExitCallbacks: Map<ConversationState, Set<(context: StateMachineContext) => void>> = new Map()

  constructor(config?: StateMachineConfig) {
    this._config = config ?? {}
    const initialContext = config?.initialContext
    const now = new Date()

    this._context = {
      id: initialContext?.id ?? generateId(),
      state: 'new',
      previousState: undefined,
      messageCount: initialContext?.messageCount ?? 0,
      assignee: initialContext?.assignee,
      priority: initialContext?.priority ?? 'normal',
      slaBreached: initialContext?.slaBreached ?? false,
      createdAt: initialContext?.createdAt ?? now,
      updatedAt: initialContext?.updatedAt ?? now,
      resolvedAt: undefined,
      closedAt: undefined,
      pendingSince: undefined,
      awaitReason: undefined,
      closeReason: undefined,
      resolveReason: undefined,
      history: [],
      metadata: initialContext?.metadata ?? {},
    }

    this._stateEnteredAt = now
  }

  get state(): ConversationState {
    return this._context.state
  }

  get context(): StateMachineContext {
    return this._context
  }

  async send(event: TransitionEvent): Promise<ConversationState> {
    const currentState = this._context.state

    // Closed is final state
    if (currentState === 'closed') {
      throw new Error(`Cannot transition from closed state - closed is a final state`)
    }

    // Find valid transition
    const transition = this.findTransition(event)

    if (!transition) {
      throw new Error(`Invalid transition: cannot transition from '${currentState}' via event '${event.type}'`)
    }

    // Check built-in guard condition
    if (transition.builtInGuard && !transition.builtInGuard(this._context, event)) {
      throw new Error(`Guard condition failed: RESOLVE requires at least one message`)
    }

    // Check custom guard if defined
    // Pass a snapshot of context to guard so it sees state before transition
    const guardKey = `${currentState}.${event.type}`
    const customGuard = this._config.guards?.[guardKey]
    if (customGuard) {
      // Create snapshot for guard (so test spies see pre-transition state)
      const contextSnapshot = { ...this._context }
      if (!customGuard(contextSnapshot, event)) {
        throw new Error(`Custom guard condition failed for ${guardKey}`)
      }
    }

    const previousState = currentState
    const toState = transition.to
    const now = new Date()

    // Get actor and reason from event
    const actor = 'actor' in event ? event.actor : undefined
    const reason = 'reason' in event ? event.reason : undefined

    // Execute onExit actions for current state (config-based)
    const exitActions = this._config.actions?.onExit?.[previousState]
    if (exitActions) {
      for (const action of exitActions) {
        await action(this._context, event)
      }
    }

    // Call exit subscribers
    const exitCallbacks = this.stateExitCallbacks.get(previousState)
    if (exitCallbacks) {
      for (const callback of exitCallbacks) {
        callback(this._context)
      }
    }

    // Update context
    this._context.previousState = previousState
    this._context.state = toState
    this._context.updatedAt = now
    this._stateEnteredAt = now

    // Apply state-specific side effects
    this.applyStateEffects(previousState, toState, event, now)

    // Record in history
    const historyEntry: StateHistoryEntry = {
      from: previousState,
      to: toState,
      event: event.type,
      timestamp: now,
      actor,
      reason,
    }
    this._context.history.push(historyEntry)

    // Execute onTransition actions (config-based)
    const transitionActions = this._config.actions?.onTransition
    if (transitionActions) {
      for (const action of transitionActions) {
        await action(this._context, event)
      }
    }

    // Call transition subscribers
    for (const callback of this.transitionCallbacks) {
      callback(previousState, toState, event)
    }

    // Execute onEntry actions for new state (config-based)
    const entryActions = this._config.actions?.onEntry?.[toState]
    if (entryActions) {
      for (const action of entryActions) {
        await action(this._context, event)
      }
    }

    // Call enter subscribers
    const enterCallbacks = this.stateEnterCallbacks.get(toState)
    if (enterCallbacks) {
      for (const callback of enterCallbacks) {
        callback(this._context)
      }
    }

    return toState
  }

  can(event: TransitionEvent): boolean {
    if (this._context.state === 'closed') {
      return false
    }

    const transition = this.findTransition(event)
    if (!transition) {
      return false
    }

    // Check built-in guard
    if (transition.builtInGuard && !transition.builtInGuard(this._context, event)) {
      return false
    }

    // Check custom guard
    const guardKey = `${this._context.state}.${event.type}`
    const customGuard = this._config.guards?.[guardKey]
    if (customGuard && !customGuard(this._context, event)) {
      return false
    }

    return true
  }

  getValidTransitions(): TransitionEvent['type'][] {
    if (this._context.state === 'closed') {
      return []
    }

    const validEvents: TransitionEvent['type'][] = []
    const currentState = this._context.state

    for (const t of transitions) {
      // Match state
      if (t.from !== '*' && t.from !== currentState) {
        continue
      }

      // Skip if event already added
      if (validEvents.includes(t.event)) {
        continue
      }

      // Check built-in guard with a dummy event
      if (t.builtInGuard) {
        const dummyEvent = this.createDummyEvent(t.event)
        if (!t.builtInGuard(this._context, dummyEvent)) {
          continue
        }
      }

      // Check custom guard
      const guardKey = `${currentState}.${t.event}`
      const customGuard = this._config.guards?.[guardKey]
      if (customGuard) {
        const dummyEvent = this.createDummyEvent(t.event)
        if (!customGuard(this._context, dummyEvent)) {
          continue
        }
      }

      validEvents.push(t.event)
    }

    return validEvents
  }

  getHistory(): StateHistoryEntry[] {
    // Return a copy to prevent external modification
    return [...this._context.history]
  }

  getTimeInState(): number {
    return Date.now() - this._stateEnteredAt.getTime()
  }

  onTransition(callback: (from: ConversationState, to: ConversationState, event: TransitionEvent) => void): () => void {
    this.transitionCallbacks.add(callback)
    return () => {
      this.transitionCallbacks.delete(callback)
    }
  }

  onStateEnter(state: ConversationState, callback: (context: StateMachineContext) => void): () => void {
    if (!this.stateEnterCallbacks.has(state)) {
      this.stateEnterCallbacks.set(state, new Set())
    }
    this.stateEnterCallbacks.get(state)!.add(callback)
    return () => {
      this.stateEnterCallbacks.get(state)?.delete(callback)
    }
  }

  onStateExit(state: ConversationState, callback: (context: StateMachineContext) => void): () => void {
    if (!this.stateExitCallbacks.has(state)) {
      this.stateExitCallbacks.set(state, new Set())
    }
    this.stateExitCallbacks.get(state)!.add(callback)
    return () => {
      this.stateExitCallbacks.get(state)?.delete(callback)
    }
  }

  serialize(): string {
    return JSON.stringify({
      state: this._context.state,
      context: {
        ...this._context,
        createdAt: this._context.createdAt.toISOString(),
        updatedAt: this._context.updatedAt.toISOString(),
        resolvedAt: this._context.resolvedAt?.toISOString(),
        closedAt: this._context.closedAt?.toISOString(),
        pendingSince: this._context.pendingSince?.toISOString(),
        history: this._context.history.map(h => ({
          ...h,
          timestamp: h.timestamp.toISOString(),
        })),
      },
      stateEnteredAt: this._stateEnteredAt.toISOString(),
    })
  }

  hydrate(serialized: string): void {
    const data = JSON.parse(serialized)

    this._context = {
      ...data.context,
      createdAt: new Date(data.context.createdAt),
      updatedAt: new Date(data.context.updatedAt),
      resolvedAt: data.context.resolvedAt ? new Date(data.context.resolvedAt) : undefined,
      closedAt: data.context.closedAt ? new Date(data.context.closedAt) : undefined,
      pendingSince: data.context.pendingSince ? new Date(data.context.pendingSince) : undefined,
      history: data.context.history.map((h: StateHistoryEntry & { timestamp: string }) => ({
        ...h,
        timestamp: new Date(h.timestamp),
      })),
    }

    this._stateEnteredAt = new Date(data.stateEnteredAt)
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private findTransition(event: TransitionEvent): TransitionDef | undefined {
    const currentState = this._context.state

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

  private applyStateEffects(
    fromState: ConversationState,
    toState: ConversationState,
    event: TransitionEvent,
    now: Date
  ): void {
    // Clear pendingSince when leaving pending state
    if (fromState === 'pending') {
      this._context.pendingSince = undefined
    }

    // Clear resolvedAt when reopening
    if (fromState === 'resolved' && toState === 'active') {
      this._context.resolvedAt = undefined
    }

    // Clear awaitReason when resuming
    if (event.type === 'RESUME') {
      this._context.awaitReason = undefined
    }

    switch (toState) {
      case 'pending':
        this._context.pendingSince = now
        if ('reason' in event && event.reason) {
          this._context.awaitReason = event.reason
        }
        break

      case 'resolved':
        this._context.resolvedAt = now
        if ('reason' in event && event.reason) {
          this._context.resolveReason = event.reason
        }
        break

      case 'closed':
        this._context.closedAt = now
        if ('reason' in event && event.reason) {
          this._context.closeReason = event.reason
        }
        break
    }
  }

  private createDummyEvent(eventType: TransitionEvent['type']): TransitionEvent {
    switch (eventType) {
      case 'START':
        return { type: 'START' }
      case 'AWAIT':
        return { type: 'AWAIT', reason: '' }
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
      case 'ESCALATE':
        return { type: 'ESCALATE', to: '', reason: '' }
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
 * @param config - Optional configuration with initial context, guards, and actions
 * @returns A new ConversationStateMachine instance
 *
 * @example
 * ```typescript
 * const machine = createStateMachine({
 *   initialContext: {
 *     id: 'ticket_123',
 *     priority: 'high',
 *     assignee: 'agent_1',
 *     messageCount: 5,
 *   },
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
export function createStateMachine(config?: StateMachineConfig): ConversationStateMachine {
  return new ConversationStateMachineImpl(config)
}

// =============================================================================
// Legacy Interface Types (backward compatibility)
// =============================================================================

/**
 * Legacy context interface for backward compatibility
 */
export interface ConversationContext {
  id: string
  currentState: ConversationState
  previousState?: ConversationState
  assignedTo?: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
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
 * Legacy event type
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
 * Legacy state machine interface for backward compatibility
 */
export interface LegacyConversationStateMachine {
  readonly state: ConversationState
  readonly context: ConversationContext

  send(event: StateEvent): Promise<ConversationState>
  can(event: StateEvent): boolean
  getValidEvents(): StateEvent['type'][]

  onTransition(handler: (from: ConversationState, to: ConversationState, event: StateEvent) => void): () => void
  onEnter(state: ConversationState, handler: (context: ConversationContext) => void): () => void
  onExit(state: ConversationState, handler: (context: ConversationContext) => void): () => void
}

// =============================================================================
// Legacy State Machine Implementation
// =============================================================================

class LegacyConversationStateMachineImpl implements LegacyConversationStateMachine {
  private _context: ConversationContext
  private _config: { messageCount: number }

  private transitionCallbacks: Set<(from: ConversationState, to: ConversationState, event: StateEvent) => void> = new Set()
  private enterCallbacks: Map<ConversationState, Set<(context: ConversationContext) => void>> = new Map()
  private exitCallbacks: Map<ConversationState, Set<(context: ConversationContext) => void>> = new Map()

  constructor(initialContext?: Partial<ConversationContext>) {
    const now = new Date()

    this._context = {
      id: initialContext?.id ?? generateId(),
      currentState: 'new',
      previousState: undefined,
      assignedTo: initialContext?.assignedTo,
      priority: initialContext?.priority ?? 'normal',
      messageCount: initialContext?.messageCount ?? 1, // Default to 1 so RESOLVE works by default
      createdAt: initialContext?.createdAt ?? now,
      updatedAt: initialContext?.updatedAt ?? now,
      resolvedAt: undefined,
      closedAt: undefined,
      stateHistory: [],
      metadata: initialContext?.metadata ?? {},
    }

    this._config = {
      messageCount: initialContext?.messageCount ?? 1,
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
      throw new Error(`closed is a final state - no transitions allowed`)
    }

    // Find valid transition
    const transition = this.findTransition(event)

    if (!transition) {
      throw new Error(`Invalid transition: cannot transition from '${currentState}' via event '${event.type}'`)
    }

    // Check built-in guard condition
    if (transition.builtInGuard && !transition.builtInGuard(this._context, event)) {
      throw new Error(`Guard condition failed: RESOLVE requires at least one message`)
    }

    const previousState = currentState
    const toState = transition.to
    const now = new Date()

    // Call exit handlers for current state
    const exitCbs = this.exitCallbacks.get(previousState)
    if (exitCbs) {
      for (const cb of exitCbs) {
        cb(this._context)
      }
    }

    // Update context
    this._context.previousState = previousState
    this._context.currentState = toState
    this._context.updatedAt = now

    // Apply state-specific side effects
    this.applyStateEffects(previousState, toState, event, now)

    // Record in history
    this._context.stateHistory.push({
      from: previousState,
      to: toState,
      event: event.type,
      at: now,
    })

    // Call transition handlers
    for (const cb of this.transitionCallbacks) {
      cb(previousState, toState, event)
    }

    // Call enter handlers for new state
    const enterCbs = this.enterCallbacks.get(toState)
    if (enterCbs) {
      for (const cb of enterCbs) {
        cb(this._context)
      }
    }

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

    // Check built-in guard
    if (transition.builtInGuard && !transition.builtInGuard(this._context, event)) {
      return false
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
      if (validEvents.includes(t.event as StateEvent['type'])) {
        continue
      }

      // Check built-in guard with a dummy event
      if (t.builtInGuard) {
        const dummyEvent = this.createDummyEvent(t.event)
        if (!t.builtInGuard(this._context as unknown as StateMachineContext, dummyEvent)) {
          continue
        }
      }

      validEvents.push(t.event as StateEvent['type'])
    }

    return validEvents
  }

  onTransition(handler: (from: ConversationState, to: ConversationState, event: StateEvent) => void): () => void {
    this.transitionCallbacks.add(handler)
    return () => {
      this.transitionCallbacks.delete(handler)
    }
  }

  onEnter(state: ConversationState, handler: (context: ConversationContext) => void): () => void {
    if (!this.enterCallbacks.has(state)) {
      this.enterCallbacks.set(state, new Set())
    }
    this.enterCallbacks.get(state)!.add(handler)
    return () => {
      this.enterCallbacks.get(state)?.delete(handler)
    }
  }

  onExit(state: ConversationState, handler: (context: ConversationContext) => void): () => void {
    if (!this.exitCallbacks.has(state)) {
      this.exitCallbacks.set(state, new Set())
    }
    this.exitCallbacks.get(state)!.add(handler)
    return () => {
      this.exitCallbacks.get(state)?.delete(handler)
    }
  }

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

  private applyStateEffects(
    fromState: ConversationState,
    toState: ConversationState,
    event: StateEvent,
    now: Date
  ): void {
    // Clear resolvedAt when reopening
    if (fromState === 'resolved' && toState === 'active') {
      this._context.resolvedAt = undefined
    }

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
    }
  }

  private createDummyEvent(eventType: TransitionEvent['type']): TransitionEvent {
    switch (eventType) {
      case 'START':
        return { type: 'START' }
      case 'AWAIT':
        return { type: 'AWAIT', reason: '' }
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
      case 'ESCALATE':
        return { type: 'ESCALATE', to: '', reason: '' }
      default:
        return { type: 'START' }
    }
  }
}

// Legacy export for backward compatibility
export function createConversationStateMachine(
  initialContext?: Partial<ConversationContext>
): LegacyConversationStateMachine {
  return new LegacyConversationStateMachineImpl(initialContext)
}

// =============================================================================
// Exports
// =============================================================================

export { ConversationStateMachineImpl }
