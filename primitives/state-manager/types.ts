// Types for StateManager primitive

/**
 * Generic state object type
 */
export type State = Record<string, unknown>

/**
 * Action that can be dispatched to modify state
 */
export interface StateAction {
  type: string
  payload?: unknown
}

/**
 * Reducer function that takes state and action, returns new state
 */
export type Reducer<S> = (state: S | undefined, action: StateAction) => S

/**
 * Selector function to derive data from state
 */
export type Selector<S, R> = (state: S) => R

/**
 * Store interface for middleware
 */
export interface MiddlewareStore<S> {
  getState: () => S
  dispatch: (action: StateAction | ThunkAction<S>) => void
}

/**
 * Thunk action for async operations
 */
export type ThunkAction<S> = (
  dispatch: (action: StateAction) => void,
  getState: () => S
) => Promise<void> | void

/**
 * Middleware function that can intercept and modify dispatched actions
 */
export type Middleware<S> = (
  store: MiddlewareStore<S>
) => (next: (action: StateAction | ThunkAction<S>) => void) => (action: StateAction | ThunkAction<S>) => void

/**
 * State snapshot for time-travel and persistence
 */
export interface StateSnapshot<S> {
  state: S
  timestamp: number
  id: string
}

/**
 * Transaction for batching actions
 */
export interface Transaction<S> {
  actions: StateAction[]
  committed: boolean
  initialState: S
  addAction(action: StateAction): void
  commit(): void
  rollback(): S
}

/**
 * Subscriber callback for state changes
 */
export type StateSubscriber<S> = (state: S) => void

/**
 * Unsubscribe function returned by subscribe
 */
export type Unsubscribe = () => void

/**
 * Persistence adapter interface for saving/loading state
 */
export interface PersistenceAdapter<S> {
  save(key: string, state: S): Promise<void>
  load(key: string): Promise<S | null>
}

/**
 * Persistence configuration
 */
export interface PersistenceConfig<S> {
  adapter: PersistenceAdapter<S>
  key: string
}

/**
 * StateManager options
 */
export interface StateManagerOptions<S> {
  historyLimit?: number
  persistence?: PersistenceConfig<S>
}

/**
 * Combined reducers map
 */
export type ReducersMap<S> = {
  [K in keyof S]: Reducer<S[K]>
}

/**
 * Input selector for createSelector
 */
export type InputSelector<S, R> = (state: S) => R
