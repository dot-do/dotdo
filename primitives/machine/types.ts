/**
 * Machine - Durable State Machines (XState v5)
 *
 * Type definitions for DO-backed durable state machines.
 */

/**
 * Handler for state transitions
 */
export type TransitionHandler<TState extends string, TEvent extends { type: string }> = (
  from: TState,
  to: TState,
  event: TEvent
) => void

/**
 * Handler for entering a specific state
 */
export type StateHandler<TContext> = (context: TContext) => void

/**
 * Action to execute during transitions
 */
export type Action<TContext, TEvent extends { type: string }> = (
  context: TContext,
  event: TEvent
) => TContext | void

/**
 * Configuration for a single state
 */
export interface StateConfig<TState extends string, TEvent extends { type: string }, TContext> {
  on?: Record<
    string,
    TState | { target: TState; guard?: (ctx: TContext, event: TEvent) => boolean; actions?: Action<TContext, TEvent>[] }
  >
  entry?: Action<TContext, TEvent>[]
  exit?: Action<TContext, TEvent>[]
  type?: 'final'
}

/**
 * Configuration for creating a machine
 */
export interface MachineConfig<TState extends string, TEvent extends { type: string }, TContext> {
  id: string
  initial: TState
  context?: TContext
  states: Record<TState, StateConfig<TState, TEvent, TContext>>
}

/**
 * Factory for creating machine instances
 */
export interface MachineFactory<TState extends string, TEvent extends { type: string }, TContext> {
  create(initialContext?: Partial<TContext>): Machine<TState, TEvent, TContext>
}

/**
 * Core Machine interface - DO-backed durable state machine
 */
export interface Machine<TState extends string, TEvent extends { type: string }, TContext = unknown> {
  readonly state: TState
  readonly context: TContext

  /**
   * Send an event to trigger a state transition
   */
  send(event: TEvent): Promise<TState>

  /**
   * Check if a transition is valid from current state
   */
  can(event: TEvent): boolean

  /**
   * Subscribe to all state transitions
   */
  onTransition(handler: TransitionHandler<TState, TEvent>): () => void

  /**
   * Subscribe to entering a specific state
   */
  onState(state: TState, handler: StateHandler<TContext>): () => void

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
 * Storage interface for DO persistence
 */
export interface MachineStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
}
