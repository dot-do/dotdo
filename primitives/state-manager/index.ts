/**
 * StateManager - A comprehensive state management primitive for dotdo
 *
 * Features:
 * - Redux-like state management with reducers and actions
 * - Middleware support for logging, thunks, and persistence
 * - Combined reducers for modular state slices
 * - Memoized selectors for derived state
 * - Transactions with commit/rollback semantics
 * - Undo/redo with configurable history limit
 * - State snapshots for time-travel debugging
 * - Persistence adapters for state hydration
 *
 * @example
 * ```typescript
 * const reducer = (state = { count: 0 }, action) => {
 *   switch (action.type) {
 *     case 'INCREMENT': return { count: state.count + 1 }
 *     default: return state
 *   }
 * }
 *
 * const manager = new StateManager(reducer, { count: 0 })
 * manager.subscribe((state) => console.log(state))
 * manager.dispatch({ type: 'INCREMENT' })
 * ```
 */

export * from './types'

import type {
  StateAction,
  Reducer,
  Middleware,
  StateSnapshot,
  Transaction,
  StateSubscriber,
  Unsubscribe,
  PersistenceAdapter,
  StateManagerOptions,
  ReducersMap,
  ThunkAction,
} from './types'

// ============================================================================
// Constants
// ============================================================================

/** Internal action type for initialization */
const INIT_ACTION_TYPE = '@@INIT'

/** Default history limit for undo/redo */
const DEFAULT_HISTORY_LIMIT = 100

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique ID for snapshots
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Deep clone an object to ensure immutability
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// ============================================================================
// HistoryManager
// ============================================================================

/**
 * HistoryManager - Manages undo/redo state history with configurable limits
 *
 * Maintains two stacks:
 * - past: Previous states (for undo)
 * - future: Undone states (for redo)
 *
 * @example
 * ```typescript
 * const history = new HistoryManager<State>(10)
 * history.push(state1)
 * history.push(state2)
 * const prev = history.undo() // returns state1
 * const next = history.redo() // returns state2
 * ```
 */
export class HistoryManager<S> {
  private past: S[] = []
  private future: S[] = []
  private readonly limit: number

  constructor(limit: number = DEFAULT_HISTORY_LIMIT) {
    this.limit = limit
  }

  /**
   * Push a new state onto the history stack
   * Clears the future stack (new timeline)
   */
  push(state: S): void {
    this.past.push(deepClone(state))
    this.future = []
    // Keep limit + 1 entries to allow 'limit' undos
    while (this.past.length > this.limit + 1) {
      this.past.shift()
    }
  }

  /**
   * Undo to the previous state
   * @returns The previous state, or undefined if at the beginning
   */
  undo(): S | undefined {
    if (this.past.length <= 1) {
      return undefined
    }
    const current = this.past.pop()!
    this.future.push(current)
    return deepClone(this.past[this.past.length - 1])
  }

  /**
   * Redo to a previously undone state
   * @returns The next state, or undefined if nothing to redo
   */
  redo(): S | undefined {
    if (this.future.length === 0) {
      return undefined
    }
    const next = this.future.pop()!
    this.past.push(next)
    return deepClone(next)
  }

  canUndo(): boolean {
    return this.past.length > 1
  }

  canRedo(): boolean {
    return this.future.length > 0
  }

  clear(): void {
    this.past = []
    this.future = []
  }

  getCurrentLength(): number {
    return this.past.length
  }
}

// ============================================================================
// TransactionManager
// ============================================================================

/**
 * TransactionManager - Factory for creating transactions with ACID-like semantics
 *
 * @example
 * ```typescript
 * const txManager = new TransactionManager<State>()
 * const tx = txManager.begin(currentState)
 * tx.addAction({ type: 'INCREMENT' })
 * tx.addAction({ type: 'INCREMENT' })
 * tx.commit() // or tx.rollback() on error
 * ```
 */
export class TransactionManager<S> {
  /**
   * Begin a new transaction
   * @param state The initial state to snapshot for potential rollback
   */
  begin(state: S): Transaction<S> {
    const initialState = deepClone(state)

    return {
      actions: [],
      committed: false,
      initialState,

      addAction(action: StateAction): void {
        if (this.committed) {
          throw new Error('Cannot add action to committed transaction')
        }
        this.actions.push(action)
      },

      commit(): void {
        this.committed = true
      },

      rollback(): S {
        this.actions = []
        return deepClone(this.initialState)
      },
    }
  }
}

// ============================================================================
// StateManager
// ============================================================================

/**
 * StateManager - Main state management class with full feature set
 *
 * Provides:
 * - State access via getState()
 * - Action dispatch with middleware support
 * - Subscription system for reactive updates
 * - Selector pattern for derived state
 * - Transactional updates with rollback
 * - Undo/redo time travel
 * - Snapshot/restore for debugging
 * - Persistence for state hydration
 */
export class StateManager<S> {
  private state: S
  private readonly reducer: Reducer<S>
  private readonly subscribers: Set<StateSubscriber<S>> = new Set()
  private readonly middleware: Middleware<S>[]
  private readonly dispatchWithMiddleware: (action: StateAction | ThunkAction<S>) => unknown
  private readonly historyManager: HistoryManager<S>
  private readonly options: StateManagerOptions<S>

  // Transaction state
  private inTransaction = false
  private transactionActions: StateAction[] = []
  private transactionInitialState: S | null = null

  constructor(
    reducer: Reducer<S>,
    initialState?: S,
    middleware: Middleware<S>[] = [],
    options: StateManagerOptions<S> = {}
  ) {
    this.reducer = reducer
    this.middleware = middleware
    this.options = options
    this.historyManager = new HistoryManager<S>(options.historyLimit ?? DEFAULT_HISTORY_LIMIT)

    // Initialize state from provided value or reducer default
    this.state = initialState !== undefined
      ? deepClone(initialState)
      : reducer(undefined, { type: INIT_ACTION_TYPE })

    // Record initial state in history
    this.historyManager.push(this.state)

    // Build middleware chain
    this.dispatchWithMiddleware = this.buildDispatchChain()
  }

  /**
   * Build the middleware dispatch chain
   * Middleware are applied in order, with each wrapping the next
   */
  private buildDispatchChain(): (action: StateAction | ThunkAction<S>) => unknown {
    const store = {
      getState: () => this.getState(),
      dispatch: (action: StateAction | ThunkAction<S>) => this.dispatch(action),
    }

    // Base dispatch - actually updates state
    let dispatch: (action: StateAction | ThunkAction<S>) => unknown = (action) => {
      if (typeof action === 'function') {
        return action(dispatch as (a: StateAction) => void, () => this.getState())
      }
      this.applyAction(action as StateAction)
      return action
    }

    // Apply middleware in reverse order so first middleware wraps everything
    for (const mw of [...this.middleware].reverse()) {
      const next = dispatch
      dispatch = mw(store)(next)
    }

    return dispatch
  }

  /**
   * Apply an action to the state
   * Handles both normal and transaction modes
   */
  private applyAction(action: StateAction): void {
    const prevState = this.state
    this.state = this.reducer(this.state, action)

    if (this.inTransaction) {
      this.transactionActions.push(action)
    } else if (this.state !== prevState) {
      this.historyManager.push(this.state)
      this.notifySubscribers()
    }
  }

  /**
   * Notify all subscribers of state change
   */
  private notifySubscribers(): void {
    const state = this.getState()
    this.subscribers.forEach((subscriber) => subscriber(state))
  }

  /**
   * Get the current state (immutable copy)
   */
  getState(): S {
    return deepClone(this.state)
  }

  /**
   * Dispatch an action through the middleware chain
   * Supports both plain actions and thunk functions
   */
  dispatch(action: StateAction | ThunkAction<S>): unknown {
    return this.dispatchWithMiddleware(action)
  }

  /**
   * Subscribe to state changes
   * @returns Unsubscribe function
   */
  subscribe(listener: StateSubscriber<S>): Unsubscribe {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  /**
   * Select derived state using a selector function
   */
  select<R>(selector: (state: S) => R): R {
    return selector(this.getState())
  }

  /**
   * Execute multiple actions in a transaction
   * Commits on success, rolls back on error
   * Subscribers are notified only once on commit
   */
  transaction<R>(fn: (dispatch: (action: StateAction) => void) => R): R {
    const wasInTransaction = this.inTransaction
    const prevInitialState = this.transactionInitialState
    const prevActions = this.transactionActions

    if (!wasInTransaction) {
      this.inTransaction = true
      this.transactionInitialState = deepClone(this.state)
      this.transactionActions = []
    }

    try {
      const result = fn((action: StateAction) => this.applyAction(action))

      if (!wasInTransaction) {
        this.inTransaction = false
        this.historyManager.push(this.state)
        this.notifySubscribers()
      }

      return result
    } catch (error) {
      // Rollback on error
      if (!wasInTransaction && this.transactionInitialState !== null) {
        this.state = this.transactionInitialState
      }
      this.inTransaction = wasInTransaction
      this.transactionInitialState = prevInitialState
      this.transactionActions = prevActions
      throw error
    }
  }

  /**
   * Undo the last action
   */
  undo(): void {
    const prevState = this.historyManager.undo()
    if (prevState !== undefined) {
      this.state = prevState
      this.notifySubscribers()
    }
  }

  /**
   * Redo a previously undone action
   */
  redo(): void {
    const nextState = this.historyManager.redo()
    if (nextState !== undefined) {
      this.state = nextState
      this.notifySubscribers()
    }
  }

  canUndo(): boolean {
    return this.historyManager.canUndo()
  }

  canRedo(): boolean {
    return this.historyManager.canRedo()
  }

  /**
   * Create an immutable snapshot of the current state
   */
  snapshot(): StateSnapshot<S> {
    return {
      state: deepClone(this.state),
      timestamp: Date.now(),
      id: generateId(),
    }
  }

  /**
   * Restore state from a snapshot
   */
  restore(snapshot: StateSnapshot<S>): void {
    this.state = deepClone(snapshot.state)
    this.notifySubscribers()
  }

  /**
   * Persist current state using the configured adapter
   */
  async persist(): Promise<void> {
    if (!this.options.persistence) {
      throw new Error('No persistence adapter configured')
    }
    await this.options.persistence.adapter.save(
      this.options.persistence.key,
      this.state
    )
  }

  /**
   * Hydrate state from persistence adapter
   */
  async hydrate(): Promise<void> {
    if (!this.options.persistence) {
      throw new Error('No persistence adapter configured')
    }
    const loaded = await this.options.persistence.adapter.load(
      this.options.persistence.key
    )
    if (loaded !== null) {
      this.state = loaded
      this.notifySubscribers()
    }
  }
}

// ============================================================================
// Reducer Utilities
// ============================================================================

/**
 * Combine multiple reducers into a single reducer
 * Each reducer manages its own slice of the state
 *
 * @example
 * ```typescript
 * const rootReducer = combineReducers({
 *   counter: counterReducer,
 *   todos: todoReducer,
 * })
 * ```
 */
export function combineReducers<S extends Record<string, unknown>>(
  reducers: ReducersMap<S>
): Reducer<S> {
  return (state: S | undefined, action: StateAction): S => {
    const nextState = {} as S
    let hasChanged = false

    for (const key in reducers) {
      const reducer = reducers[key]
      const prevStateForKey = state ? state[key] : undefined
      const nextStateForKey = reducer(prevStateForKey, action)
      nextState[key] = nextStateForKey
      hasChanged = hasChanged || nextStateForKey !== prevStateForKey
    }

    return hasChanged || state === undefined ? nextState : state
  }
}

// ============================================================================
// Selector Utilities
// ============================================================================

/**
 * Create a memoized selector for efficient derived state computation
 *
 * Supports two signatures:
 * 1. `createSelector(computeFn)` - Simple memoized function
 * 2. `createSelector([inputSelectors], resultFn)` - Composed selector
 *
 * @example
 * ```typescript
 * // Simple selector
 * const selectCount = createSelector((state) => state.count * 2)
 *
 * // Composed selector
 * const selectTotal = createSelector(
 *   [selectItems, selectMultiplier],
 *   (items, multiplier) => items.reduce((a, b) => a + b, 0) * multiplier
 * )
 * ```
 */
export function createSelector<S, R>(
  computeOrInputs: ((state: S) => R) | Array<(state: S) => unknown>,
  resultFn?: (...args: unknown[]) => R
): (state: S) => R {
  let lastStateJson: string | undefined
  let lastInputs: unknown[] | undefined
  let lastResult: R

  if (Array.isArray(computeOrInputs)) {
    // Composed selector with input selectors
    const inputSelectors = computeOrInputs
    const compute = resultFn!

    return (state: S): R => {
      const inputs = inputSelectors.map((selector) => selector(state))

      if (
        lastInputs !== undefined &&
        inputs.length === lastInputs.length &&
        inputs.every((input, i) => input === lastInputs![i])
      ) {
        return lastResult
      }

      lastInputs = inputs
      lastResult = compute(...inputs)
      return lastResult
    }
  }

  // Simple memoized selector - use JSON comparison for deep equality
  const compute = computeOrInputs

  return (state: S): R => {
    const stateJson = JSON.stringify(state)
    if (stateJson === lastStateJson) {
      return lastResult
    }
    lastStateJson = stateJson
    lastResult = compute(state)
    return lastResult
  }
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Logger middleware - logs all actions and state changes to console
 */
export const loggerMiddleware: Middleware<unknown> = (store) => (next) => (action) => {
  if (typeof action === 'function') {
    return next(action)
  }
  const actionObj = action as StateAction
  console.log('Action:', actionObj.type)
  console.log('Prev state:', store.getState())
  const result = next(action)
  console.log('Next state:', store.getState())
  return result
}

/**
 * Thunk middleware - enables async actions
 * Thunk actions are functions that receive dispatch and getState
 *
 * @example
 * ```typescript
 * const asyncIncrement = () => async (dispatch, getState) => {
 *   await delay(1000)
 *   dispatch({ type: 'INCREMENT' })
 * }
 *
 * manager.dispatch(asyncIncrement())
 * ```
 */
export const thunkMiddleware: Middleware<unknown> = (store) => (next) => (action) => {
  if (typeof action === 'function') {
    return (action as ThunkAction<unknown>)(
      (a: StateAction) => store.dispatch(a),
      store.getState
    )
  }
  return next(action)
}

/**
 * Persist middleware - auto-saves state after each dispatch
 *
 * @param adapter The persistence adapter to use
 * @param key The storage key for the state
 */
export function persistMiddleware<S>(
  adapter: PersistenceAdapter<S>,
  key: string
): Middleware<S> {
  return (store) => (next) => (action) => {
    const result = next(action)
    if (typeof action !== 'function') {
      adapter.save(key, store.getState() as S)
    }
    return result
  }
}

// Re-export PersistenceAdapter type for convenience
export type { PersistenceAdapter }
