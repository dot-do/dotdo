/**
 * WorkflowStateMachine - Unified State Transition Primitive with Verb Forms
 *
 * Provides a generic state machine primitive for workflow and state machine compat
 * layers (Temporal.io, Inngest, Trigger.dev, XState, etc.).
 *
 * ## Verb Form States
 *
 * Follows the dotdo verb form convention where states are expressed as verbs:
 * - Base (pending): awaiting, pending, queued
 * - Active (ing): running, processing, executing
 * - Completed (ed): completed, succeeded, finished
 * - Failed: failed, errored, cancelled
 *
 * ## Features
 * - Generic state definition with typed events
 * - Guard conditions for transitions
 * - Entry/exit actions
 * - Side effect handlers
 * - History tracking for replay
 * - Serialization for durability
 * - Timeout/deadline integration
 * - Compensation callback registration
 *
 * @example Workflow State Machine
 * ```typescript
 * import { createWorkflowStateMachine } from 'db/primitives/workflow-state-machine'
 *
 * const workflow = createWorkflowStateMachine({
 *   id: 'order-123',
 *   states: {
 *     pending: { on: { START: 'running' } },
 *     running: { on: { COMPLETE: 'completed', FAIL: 'failed' } },
 *     completed: { type: 'final' },
 *     failed: { type: 'final' },
 *   },
 *   initial: 'pending',
 * })
 *
 * await workflow.send({ type: 'START' })
 * await workflow.send({ type: 'COMPLETE', result: { orderId: '123' } })
 * ```
 *
 * @module db/primitives/workflow-state-machine
 */

import { type MetricsCollector, noopMetrics, MetricNames } from './observability'

// =============================================================================
// Types
// =============================================================================

/**
 * Verb form state categories following dotdo convention
 */
export type VerbFormCategory = 'pending' | 'active' | 'completed' | 'failed' | 'final'

/**
 * Base event type - all events must have a type
 */
export interface WorkflowEvent {
  type: string
  [key: string]: unknown
}

/**
 * State definition for the state machine
 */
export interface StateDefinition<TEvent extends WorkflowEvent = WorkflowEvent> {
  /** State type: 'final' states cannot be exited */
  type?: 'final'
  /** Verb form category for the state */
  verbForm?: VerbFormCategory
  /** Transitions from this state: event type -> target state */
  on?: Record<string, string>
  /** Actions to run when entering this state */
  onEntry?: ((context: WorkflowStateContext, event: TEvent) => void | Promise<void>)[]
  /** Actions to run when exiting this state */
  onExit?: ((context: WorkflowStateContext, event: TEvent) => void | Promise<void>)[]
  /** Guard conditions: must return true for transition to proceed */
  guards?: Record<string, (context: WorkflowStateContext, event: TEvent) => boolean>
  /** Timeout configuration for this state */
  timeout?: {
    after: number
    send: TEvent
  }
}

/**
 * State machine configuration
 */
export interface StateMachineConfig<
  TState extends string = string,
  TEvent extends WorkflowEvent = WorkflowEvent,
> {
  /** Unique identifier for this state machine instance */
  id: string
  /** State definitions */
  states: Record<TState, StateDefinition<TEvent>>
  /** Initial state */
  initial: TState
  /** Initial context data */
  context?: Record<string, unknown>
  /** Global guards */
  guards?: Record<string, (context: WorkflowStateContext, event: TEvent) => boolean>
  /** Global actions */
  actions?: {
    onTransition?: ((from: TState, to: TState, event: TEvent, context: WorkflowStateContext) => void | Promise<void>)[]
  }
  /** Metrics collector */
  metrics?: MetricsCollector
}

/**
 * Context held by the state machine
 */
export interface WorkflowStateContext {
  /** State machine ID */
  id: string
  /** Current state */
  state: string
  /** Previous state */
  previousState?: string
  /** Custom data */
  data: Record<string, unknown>
  /** Created timestamp */
  createdAt: number
  /** Last updated timestamp */
  updatedAt: number
  /** History of transitions */
  history: TransitionHistoryEntry[]
  /** Registered compensations for saga pattern */
  compensations: CompensationEntry[]
}

/**
 * History entry for transitions
 */
export interface TransitionHistoryEntry {
  from: string
  to: string
  event: string
  timestamp: number
  eventData?: Record<string, unknown>
}

/**
 * Compensation entry for saga pattern
 */
export interface CompensationEntry {
  stepId: string
  compensation: () => Promise<void>
  timestamp: number
}

/**
 * Checkpoint state for persistence
 */
export interface StateMachineCheckpoint {
  id: string
  state: string
  previousState?: string
  data: Record<string, unknown>
  history: TransitionHistoryEntry[]
  compensations: string[] // stepIds only, functions not serializable
  createdAt: number
  updatedAt: number
  version: number
}

/**
 * Result of attempting a transition
 */
export interface TransitionResult {
  success: boolean
  fromState: string
  toState: string
  event: WorkflowEvent
  error?: string
}

// =============================================================================
// WorkflowStateMachine Interface
// =============================================================================

/**
 * Workflow state machine interface
 */
export interface WorkflowStateMachine<
  TState extends string = string,
  TEvent extends WorkflowEvent = WorkflowEvent,
> {
  /** Current state */
  readonly state: TState
  /** Context data */
  readonly context: WorkflowStateContext
  /** State machine ID */
  readonly id: string

  /** Send an event to trigger a transition */
  send(event: TEvent): Promise<TransitionResult>

  /** Check if an event can trigger a transition */
  can(event: TEvent): boolean

  /** Get valid events from current state */
  getValidEvents(): string[]

  /** Check if current state is final */
  isFinal(): boolean

  /** Get verb form category of current state */
  getVerbForm(): VerbFormCategory

  /** Subscribe to transitions */
  onTransition(callback: (from: TState, to: TState, event: TEvent) => void): () => void

  /** Subscribe to state entry */
  onStateEnter(state: TState, callback: (context: WorkflowStateContext) => void): () => void

  /** Subscribe to state exit */
  onStateExit(state: TState, callback: (context: WorkflowStateContext) => void): () => void

  /** Register a compensation for saga pattern */
  registerCompensation(stepId: string, compensation: () => Promise<void>): void

  /** Execute all registered compensations in reverse order */
  compensate(): Promise<void>

  /** Clear all registered compensations */
  clearCompensations(): void

  /** Get transition history */
  getHistory(): TransitionHistoryEntry[]

  /** Create a checkpoint for persistence */
  checkpoint(): StateMachineCheckpoint

  /** Restore from a checkpoint */
  restore(checkpoint: StateMachineCheckpoint): void

  /** Serialize to JSON string */
  serialize(): string

  /** Hydrate from JSON string */
  hydrate(serialized: string): void

  /** Update context data */
  updateContext(data: Partial<Record<string, unknown>>): void
}

// =============================================================================
// Implementation
// =============================================================================

class WorkflowStateMachineImpl<
  TState extends string = string,
  TEvent extends WorkflowEvent = WorkflowEvent,
> implements WorkflowStateMachine<TState, TEvent> {
  private _context: WorkflowStateContext
  private _config: StateMachineConfig<TState, TEvent>
  private _version = 0
  private _timeouts = new Map<string, ReturnType<typeof setTimeout>>()

  // Subscribers
  private _transitionCallbacks = new Set<(from: TState, to: TState, event: TEvent) => void>()
  private _enterCallbacks = new Map<TState, Set<(context: WorkflowStateContext) => void>>()
  private _exitCallbacks = new Map<TState, Set<(context: WorkflowStateContext) => void>>()

  private _metrics: MetricsCollector

  constructor(config: StateMachineConfig<TState, TEvent>) {
    this._config = config
    this._metrics = config.metrics ?? noopMetrics

    const now = Date.now()
    this._context = {
      id: config.id,
      state: config.initial,
      previousState: undefined,
      data: config.context ?? {},
      createdAt: now,
      updatedAt: now,
      history: [],
      compensations: [],
    }

    // Set up initial state timeout if configured
    this.setupStateTimeout(config.initial)
  }

  get state(): TState {
    return this._context.state as TState
  }

  get context(): WorkflowStateContext {
    return this._context
  }

  get id(): string {
    return this._context.id
  }

  async send(event: TEvent): Promise<TransitionResult> {
    const start = performance.now()
    const currentState = this._context.state as TState
    const stateConfig = this._config.states[currentState]

    // Check if state is final
    if (stateConfig?.type === 'final') {
      this._metrics.incrementCounter('workflow_state_machine.transition_blocked')
      return {
        success: false,
        fromState: currentState,
        toState: currentState,
        event,
        error: `Cannot transition from final state '${currentState}'`,
      }
    }

    // Find target state
    const targetState = stateConfig?.on?.[event.type]
    if (!targetState) {
      this._metrics.incrementCounter('workflow_state_machine.invalid_transition')
      return {
        success: false,
        fromState: currentState,
        toState: currentState,
        event,
        error: `No transition defined for event '${event.type}' from state '${currentState}'`,
      }
    }

    // Check guards
    const guardKey = `${currentState}.${event.type}`
    const stateGuard = stateConfig?.guards?.[event.type]
    const globalGuard = this._config.guards?.[guardKey]

    if (stateGuard && !stateGuard(this._context, event)) {
      this._metrics.incrementCounter('workflow_state_machine.guard_failed')
      return {
        success: false,
        fromState: currentState,
        toState: targetState as TState,
        event,
        error: `Guard condition failed for '${guardKey}'`,
      }
    }

    if (globalGuard && !globalGuard(this._context, event)) {
      this._metrics.incrementCounter('workflow_state_machine.guard_failed')
      return {
        success: false,
        fromState: currentState,
        toState: targetState as TState,
        event,
        error: `Global guard condition failed for '${guardKey}'`,
      }
    }

    const now = Date.now()

    // Clear current state timeout
    this.clearStateTimeout(currentState)

    // Execute onExit actions
    const exitActions = stateConfig?.onExit ?? []
    for (const action of exitActions) {
      await action(this._context, event)
    }

    // Notify exit subscribers
    const exitCallbacks = this._exitCallbacks.get(currentState)
    if (exitCallbacks) {
      for (const callback of exitCallbacks) {
        callback(this._context)
      }
    }

    // Update state
    this._context.previousState = currentState
    this._context.state = targetState
    this._context.updatedAt = now
    this._version++

    // Record history
    const historyEntry: TransitionHistoryEntry = {
      from: currentState,
      to: targetState,
      event: event.type,
      timestamp: now,
      eventData: { ...event },
    }
    delete historyEntry.eventData!.type
    if (Object.keys(historyEntry.eventData!).length === 0) {
      delete historyEntry.eventData
    }
    this._context.history.push(historyEntry)

    // Execute global onTransition actions
    const globalActions = this._config.actions?.onTransition ?? []
    for (const action of globalActions) {
      await action(currentState, targetState as TState, event, this._context)
    }

    // Notify transition subscribers
    for (const callback of this._transitionCallbacks) {
      callback(currentState, targetState as TState, event)
    }

    // Get target state config
    const targetStateConfig = this._config.states[targetState as TState]

    // Execute onEntry actions
    const entryActions = targetStateConfig?.onEntry ?? []
    for (const action of entryActions) {
      await action(this._context, event)
    }

    // Notify enter subscribers
    const enterCallbacks = this._enterCallbacks.get(targetState as TState)
    if (enterCallbacks) {
      for (const callback of enterCallbacks) {
        callback(this._context)
      }
    }

    // Set up timeout for new state
    this.setupStateTimeout(targetState as TState)

    this._metrics.incrementCounter('workflow_state_machine.transitions')
    this._metrics.recordLatency('workflow_state_machine.transition_latency', performance.now() - start)

    return {
      success: true,
      fromState: currentState,
      toState: targetState as TState,
      event,
    }
  }

  can(event: TEvent): boolean {
    const currentState = this._context.state as TState
    const stateConfig = this._config.states[currentState]

    // Cannot transition from final state
    if (stateConfig?.type === 'final') {
      return false
    }

    // Check if transition exists
    const targetState = stateConfig?.on?.[event.type]
    if (!targetState) {
      return false
    }

    // Check guards
    const stateGuard = stateConfig?.guards?.[event.type]
    const guardKey = `${currentState}.${event.type}`
    const globalGuard = this._config.guards?.[guardKey]

    if (stateGuard && !stateGuard(this._context, event)) {
      return false
    }

    if (globalGuard && !globalGuard(this._context, event)) {
      return false
    }

    return true
  }

  getValidEvents(): string[] {
    const currentState = this._context.state as TState
    const stateConfig = this._config.states[currentState]

    if (stateConfig?.type === 'final') {
      return []
    }

    return Object.keys(stateConfig?.on ?? {})
  }

  isFinal(): boolean {
    const currentState = this._context.state as TState
    const stateConfig = this._config.states[currentState]
    return stateConfig?.type === 'final'
  }

  getVerbForm(): VerbFormCategory {
    const currentState = this._context.state as TState
    const stateConfig = this._config.states[currentState]

    if (stateConfig?.verbForm) {
      return stateConfig.verbForm
    }

    // Infer from state name and type
    if (stateConfig?.type === 'final') {
      return 'final'
    }

    const stateLower = currentState.toLowerCase()
    if (stateLower.endsWith('ing')) {
      return 'active'
    }
    if (stateLower.endsWith('ed') || stateLower.includes('complet') || stateLower.includes('succeed')) {
      return 'completed'
    }
    if (stateLower.includes('fail') || stateLower.includes('error') || stateLower.includes('cancel')) {
      return 'failed'
    }
    return 'pending'
  }

  onTransition(callback: (from: TState, to: TState, event: TEvent) => void): () => void {
    this._transitionCallbacks.add(callback)
    return () => {
      this._transitionCallbacks.delete(callback)
    }
  }

  onStateEnter(state: TState, callback: (context: WorkflowStateContext) => void): () => void {
    if (!this._enterCallbacks.has(state)) {
      this._enterCallbacks.set(state, new Set())
    }
    this._enterCallbacks.get(state)!.add(callback)
    return () => {
      this._enterCallbacks.get(state)?.delete(callback)
    }
  }

  onStateExit(state: TState, callback: (context: WorkflowStateContext) => void): () => void {
    if (!this._exitCallbacks.has(state)) {
      this._exitCallbacks.set(state, new Set())
    }
    this._exitCallbacks.get(state)!.add(callback)
    return () => {
      this._exitCallbacks.get(state)?.delete(callback)
    }
  }

  registerCompensation(stepId: string, compensation: () => Promise<void>): void {
    this._context.compensations.push({
      stepId,
      compensation,
      timestamp: Date.now(),
    })
  }

  async compensate(): Promise<void> {
    const start = performance.now()
    // Execute compensations in reverse order (LIFO)
    const compensations = [...this._context.compensations].reverse()

    for (const entry of compensations) {
      try {
        await entry.compensation()
        this._metrics.incrementCounter('workflow_state_machine.compensations_executed')
      } catch (error) {
        this._metrics.incrementCounter('workflow_state_machine.compensation_failures')
        throw error
      }
    }

    this._metrics.recordLatency('workflow_state_machine.compensate_latency', performance.now() - start)
  }

  clearCompensations(): void {
    this._context.compensations = []
  }

  getHistory(): TransitionHistoryEntry[] {
    return [...this._context.history]
  }

  checkpoint(): StateMachineCheckpoint {
    return {
      id: this._context.id,
      state: this._context.state,
      previousState: this._context.previousState,
      data: { ...this._context.data },
      history: [...this._context.history],
      compensations: this._context.compensations.map(c => c.stepId),
      createdAt: this._context.createdAt,
      updatedAt: this._context.updatedAt,
      version: this._version,
    }
  }

  restore(checkpoint: StateMachineCheckpoint): void {
    // Clear existing timeouts
    for (const timeout of this._timeouts.values()) {
      clearTimeout(timeout)
    }
    this._timeouts.clear()

    this._context.id = checkpoint.id
    this._context.state = checkpoint.state
    this._context.previousState = checkpoint.previousState
    this._context.data = { ...checkpoint.data }
    this._context.history = [...checkpoint.history]
    this._context.createdAt = checkpoint.createdAt
    this._context.updatedAt = checkpoint.updatedAt
    // Note: compensations functions cannot be restored, only stepIds
    this._context.compensations = []
    this._version = checkpoint.version

    // Set up timeout for restored state
    this.setupStateTimeout(checkpoint.state as TState)
  }

  serialize(): string {
    return JSON.stringify(this.checkpoint())
  }

  hydrate(serialized: string): void {
    const checkpoint = JSON.parse(serialized) as StateMachineCheckpoint
    this.restore(checkpoint)
  }

  updateContext(data: Partial<Record<string, unknown>>): void {
    this._context.data = { ...this._context.data, ...data }
    this._context.updatedAt = Date.now()
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private setupStateTimeout(state: TState): void {
    const stateConfig = this._config.states[state]
    if (!stateConfig?.timeout) {
      return
    }

    const timeout = setTimeout(() => {
      // Auto-send timeout event
      this.send(stateConfig.timeout!.send).catch(() => {
        // Ignore errors from timeout transitions
      })
    }, stateConfig.timeout.after)

    this._timeouts.set(state, timeout)
  }

  private clearStateTimeout(state: TState): void {
    const timeout = this._timeouts.get(state)
    if (timeout) {
      clearTimeout(timeout)
      this._timeouts.delete(state)
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new workflow state machine
 *
 * @param config - State machine configuration
 * @returns A new WorkflowStateMachine instance
 *
 * @example
 * ```typescript
 * const machine = createWorkflowStateMachine({
 *   id: 'payment-workflow-123',
 *   states: {
 *     pending: { on: { PROCESS: 'processing' } },
 *     processing: { on: { SUCCESS: 'completed', FAIL: 'failed' } },
 *     completed: { type: 'final', verbForm: 'completed' },
 *     failed: { type: 'final', verbForm: 'failed' },
 *   },
 *   initial: 'pending',
 * })
 *
 * machine.registerCompensation('charge-card', async () => {
 *   await refundPayment()
 * })
 *
 * await machine.send({ type: 'PROCESS' })
 * // If processing fails, compensations run in reverse
 * ```
 */
export function createWorkflowStateMachine<
  TState extends string = string,
  TEvent extends WorkflowEvent = WorkflowEvent,
>(config: StateMachineConfig<TState, TEvent>): WorkflowStateMachine<TState, TEvent> {
  return new WorkflowStateMachineImpl(config)
}

// =============================================================================
// Predefined Workflow States
// =============================================================================

/**
 * Standard workflow states using verb forms
 */
export const WorkflowStates = {
  // Pending states (awaiting)
  PENDING: 'pending',
  QUEUED: 'queued',
  AWAITING: 'awaiting',
  SCHEDULED: 'scheduled',

  // Active states (-ing)
  RUNNING: 'running',
  PROCESSING: 'processing',
  EXECUTING: 'executing',
  RETRYING: 'retrying',

  // Completed states (-ed)
  COMPLETED: 'completed',
  SUCCEEDED: 'succeeded',
  FINISHED: 'finished',

  // Failed states
  FAILED: 'failed',
  ERRORED: 'errored',
  CANCELLED: 'cancelled',
  TIMED_OUT: 'timed_out',
} as const

/**
 * Standard workflow events
 */
export const WorkflowEvents = {
  START: 'START',
  COMPLETE: 'COMPLETE',
  FAIL: 'FAIL',
  RETRY: 'RETRY',
  CANCEL: 'CANCEL',
  TIMEOUT: 'TIMEOUT',
  RESUME: 'RESUME',
  PAUSE: 'PAUSE',
} as const
