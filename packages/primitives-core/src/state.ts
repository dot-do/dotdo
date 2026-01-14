/**
 * State management utilities for primitives
 *
 * Provides a Redux-like state backend with middleware support,
 * transactions, and snapshot/restore capabilities.
 *
 * @module @dotdo/primitives-core/state
 */

/**
 * Action type for state mutations
 */
export interface StateAction {
  type: string
  payload?: unknown
}

/**
 * Reducer function type
 */
export type Reducer<S> = (state: S | undefined, action: StateAction) => S

/**
 * Middleware function type
 */
export type Middleware<S> = (store: MiddlewareAPI<S>) => (next: Dispatch) => (action: StateAction) => void

/**
 * Dispatch function type
 */
export type Dispatch = (action: StateAction) => void

/**
 * Middleware API exposed to middleware
 */
export interface MiddlewareAPI<S> {
  getState: () => S
  dispatch: Dispatch
}

/**
 * Subscriber function type
 */
export type Subscriber<S> = (state: S) => void

/**
 * State snapshot for persistence/restore
 */
export interface StateSnapshot<S> {
  id: string
  state: S
  timestamp: number
}

/**
 * State backend implementation
 */
export class StateBackend<S> {
  private state: S
  private reducer: Reducer<S>
  private subscribers = new Set<Subscriber<S>>()
  private _dispatch: Dispatch
  private snapshotCounter = 0
  private inTransaction = false
  private transactionState: S | null = null

  constructor(reducer: Reducer<S>, initialState?: S, middleware: Middleware<S>[] = []) {
    this.reducer = reducer
    this.state = initialState ?? reducer(undefined, { type: '@@INIT' })

    // Build middleware chain
    let dispatch: Dispatch = (action) => {
      const newState = this.reducer(this.state, action)
      if (newState !== this.state) {
        this.state = newState
        if (!this.inTransaction) {
          this.notifySubscribers()
        }
      }
    }

    // Apply middleware in reverse order
    const api: MiddlewareAPI<S> = {
      getState: () => this.state,
      dispatch: (action) => this._dispatch(action),
    }

    for (let i = middleware.length - 1; i >= 0; i--) {
      dispatch = middleware[i]!(api)(dispatch)
    }

    this._dispatch = dispatch
  }

  /**
   * Get current state (returns immutable copy)
   */
  getState(): S {
    // Return a shallow copy to prevent direct mutation
    if (typeof this.state === 'object' && this.state !== null) {
      return { ...this.state }
    }
    return this.state
  }

  /**
   * Dispatch an action to update state
   *
   * @param action - Action to dispatch
   */
  dispatch(action: StateAction): void {
    this._dispatch(action)
  }

  /**
   * Dispatch an action to update state (alias for dispatch)
   *
   * @param action - Action to dispatch
   * @deprecated Use dispatch() instead
   */
  dispatchAction(action: StateAction): void {
    this._dispatch(action)
  }

  /**
   * Subscribe to state changes
   *
   * @param subscriber - Function to call on state change
   * @returns Unsubscribe function
   */
  subscribe(subscriber: Subscriber<S>): () => void {
    this.subscribers.add(subscriber)
    return () => {
      this.subscribers.delete(subscriber)
    }
  }

  /**
   * Select derived state
   *
   * @param selector - Function to derive state
   * @returns Selected value
   */
  select<R>(selector: (state: S) => R): R {
    return selector(this.state)
  }

  /**
   * Create a snapshot of current state
   *
   * @returns State snapshot
   */
  snapshot(): StateSnapshot<S> {
    return {
      id: `snapshot-${++this.snapshotCounter}`,
      state: this.getState(),
      timestamp: Date.now(),
    }
  }

  /**
   * Restore state from a snapshot
   *
   * @param snapshot - Snapshot to restore
   */
  restore(snapshot: StateSnapshot<S>): void {
    if (this.state !== snapshot.state) {
      this.state = snapshot.state
      this.notifySubscribers()
    }
  }

  /**
   * Execute multiple dispatches as a transaction
   *
   * If any dispatch throws, the state is rolled back.
   * Subscribers are notified only once at the end.
   *
   * @param fn - Function that performs dispatches
   */
  transaction(fn: (dispatch: Dispatch) => void): void {
    const previousState = this.state
    this.inTransaction = true
    this.transactionState = this.state

    try {
      fn(this.dispatch.bind(this))
      this.inTransaction = false
      this.transactionState = null
      this.notifySubscribers()
    } catch (error) {
      // Rollback
      this.state = previousState
      this.inTransaction = false
      this.transactionState = null
      throw error
    }
  }

  private notifySubscribers(): void {
    const currentState = this.getState()
    for (const subscriber of this.subscribers) {
      subscriber(currentState)
    }
  }
}

/**
 * Create a new state backend
 *
 * @param reducer - Reducer function
 * @param initialState - Optional initial state
 * @param middleware - Optional middleware array
 * @returns New StateBackend instance
 *
 * @example
 * ```typescript
 * interface CounterState {
 *   count: number
 * }
 *
 * const reducer: Reducer<CounterState> = (state = { count: 0 }, action) => {
 *   switch (action.type) {
 *     case 'INCREMENT':
 *       return { count: state.count + 1 }
 *     case 'DECREMENT':
 *       return { count: state.count - 1 }
 *     default:
 *       return state
 *   }
 * }
 *
 * const backend = createStateBackend(reducer)
 * backend.dispatch({ type: 'INCREMENT' })
 * console.log(backend.getState().count) // 1
 * ```
 */
export function createStateBackend<S>(
  reducer: Reducer<S>,
  initialState?: S,
  middleware: Middleware<S>[] = []
): StateBackend<S> {
  return new StateBackend(reducer, initialState, middleware)
}
