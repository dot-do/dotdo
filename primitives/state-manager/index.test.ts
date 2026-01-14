import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  StateManager,
  combineReducers,
  createSelector,
  loggerMiddleware,
  thunkMiddleware,
  persistMiddleware,
  TransactionManager,
  HistoryManager,
  PersistenceAdapter,
} from './index'
import type {
  State,
  StateAction,
  Reducer,
  Selector,
  Middleware,
  StateSnapshot,
  Transaction,
  StateSubscriber,
} from './types'

// Test state types
interface CounterState {
  count: number
}

interface TodoState {
  todos: { id: number; text: string; done: boolean }[]
}

interface AppState {
  counter: CounterState
  todos: TodoState
}

// Test reducers
const counterReducer: Reducer<CounterState> = (state = { count: 0 }, action) => {
  switch (action.type) {
    case 'INCREMENT':
      return { count: state.count + 1 }
    case 'DECREMENT':
      return { count: state.count - 1 }
    case 'SET':
      return { count: action.payload as number }
    default:
      return state
  }
}

const todoReducer: Reducer<TodoState> = (state = { todos: [] }, action) => {
  switch (action.type) {
    case 'ADD_TODO':
      return {
        todos: [...state.todos, { id: Date.now(), text: action.payload as string, done: false }],
      }
    case 'TOGGLE_TODO':
      return {
        todos: state.todos.map((todo) =>
          todo.id === action.payload ? { ...todo, done: !todo.done } : todo
        ),
      }
    case 'CLEAR_TODOS':
      return { todos: [] }
    default:
      return state
  }
}

describe('StateManager', () => {
  describe('Core State Management', () => {
    test('gets initial state', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })
      expect(manager.getState()).toEqual({ count: 0 })
    })

    test('gets initial state with undefined (uses reducer default)', () => {
      const manager = new StateManager<CounterState>(counterReducer)
      expect(manager.getState()).toEqual({ count: 0 })
    })

    test('dispatches action and updates state', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })
      manager.dispatch({ type: 'INCREMENT' })
      expect(manager.getState()).toEqual({ count: 1 })
    })

    test('dispatches multiple actions', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })
      manager.dispatch({ type: 'INCREMENT' })
      manager.dispatch({ type: 'INCREMENT' })
      manager.dispatch({ type: 'DECREMENT' })
      expect(manager.getState()).toEqual({ count: 1 })
    })

    test('dispatches action with payload', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })
      manager.dispatch({ type: 'SET', payload: 42 })
      expect(manager.getState()).toEqual({ count: 42 })
    })

    test('ignores unknown actions', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 5 })
      manager.dispatch({ type: 'UNKNOWN' })
      expect(manager.getState()).toEqual({ count: 5 })
    })
  })

  describe('Subscriptions', () => {
    test('subscribes to state changes', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })
      const listener = vi.fn()

      manager.subscribe(listener)
      manager.dispatch({ type: 'INCREMENT' })

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith({ count: 1 })
    })

    test('calls multiple subscribers', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      manager.subscribe(listener1)
      manager.subscribe(listener2)
      manager.dispatch({ type: 'INCREMENT' })

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
    })

    test('unsubscribes from state changes', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })
      const listener = vi.fn()

      const unsubscribe = manager.subscribe(listener)
      manager.dispatch({ type: 'INCREMENT' })
      unsubscribe()
      manager.dispatch({ type: 'INCREMENT' })

      expect(listener).toHaveBeenCalledTimes(1)
    })

    test('does not notify subscribers when state unchanged', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })
      const listener = vi.fn()

      manager.subscribe(listener)
      manager.dispatch({ type: 'UNKNOWN' }) // Should not change state

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('Selectors', () => {
    test('selects derived state', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 10 })
      const doubled = manager.select((state) => state.count * 2)
      expect(doubled).toBe(20)
    })

    test('selects nested state', () => {
      const manager = new StateManager<TodoState>(todoReducer, {
        todos: [
          { id: 1, text: 'Test', done: false },
          { id: 2, text: 'Done', done: true },
        ],
      })

      const doneTodos = manager.select((state) => state.todos.filter((t) => t.done))
      expect(doneTodos).toEqual([{ id: 2, text: 'Done', done: true }])
    })
  })

  describe('Memoized Selectors', () => {
    test('creates memoized selector', () => {
      const computeFn = vi.fn((state: CounterState) => state.count * 2)
      const selector = createSelector(computeFn)

      const manager = new StateManager<CounterState>(counterReducer, { count: 5 })

      const result1 = selector(manager.getState())
      const result2 = selector(manager.getState())

      expect(result1).toBe(10)
      expect(result2).toBe(10)
      expect(computeFn).toHaveBeenCalledTimes(1) // Memoized
    })

    test('recomputes when state changes', () => {
      const computeFn = vi.fn((state: CounterState) => state.count * 2)
      const selector = createSelector(computeFn)

      const manager = new StateManager<CounterState>(counterReducer, { count: 5 })

      selector(manager.getState())
      manager.dispatch({ type: 'INCREMENT' })
      selector(manager.getState())

      expect(computeFn).toHaveBeenCalledTimes(2)
    })

    test('creates selector with input selectors', () => {
      interface State {
        items: number[]
        multiplier: number
      }

      const selectItems = (state: State) => state.items
      const selectMultiplier = (state: State) => state.multiplier

      const selectTotal = createSelector(
        [selectItems, selectMultiplier],
        (items, multiplier) => items.reduce((a, b) => a + b, 0) * multiplier
      )

      const state: State = { items: [1, 2, 3], multiplier: 2 }
      expect(selectTotal(state)).toBe(12)
    })
  })

  describe('Combined Reducers', () => {
    test('combines multiple reducers', () => {
      const rootReducer = combineReducers({
        counter: counterReducer,
        todos: todoReducer,
      })

      const initialState = rootReducer(undefined, { type: '@@INIT' })

      expect(initialState).toEqual({
        counter: { count: 0 },
        todos: { todos: [] },
      })
    })

    test('routes actions to correct reducer', () => {
      const rootReducer = combineReducers({
        counter: counterReducer,
        todos: todoReducer,
      })

      let state = rootReducer(undefined, { type: '@@INIT' })
      state = rootReducer(state, { type: 'INCREMENT' })
      state = rootReducer(state, { type: 'ADD_TODO', payload: 'Test' })

      expect(state.counter.count).toBe(1)
      expect(state.todos.todos).toHaveLength(1)
    })
  })

  describe('Middleware', () => {
    test('applies single middleware', () => {
      const logs: string[] = []
      const testMiddleware: Middleware<CounterState> = (store) => (next) => (action) => {
        logs.push(`before: ${action.type}`)
        const result = next(action)
        logs.push(`after: ${action.type}`)
        return result
      }

      const manager = new StateManager<CounterState>(counterReducer, { count: 0 }, [testMiddleware])

      manager.dispatch({ type: 'INCREMENT' })

      expect(logs).toEqual(['before: INCREMENT', 'after: INCREMENT'])
    })

    test('applies middleware in correct order', () => {
      const logs: string[] = []

      const middleware1: Middleware<CounterState> = () => (next) => (action) => {
        logs.push('1-before')
        const result = next(action)
        logs.push('1-after')
        return result
      }

      const middleware2: Middleware<CounterState> = () => (next) => (action) => {
        logs.push('2-before')
        const result = next(action)
        logs.push('2-after')
        return result
      }

      const manager = new StateManager<CounterState>(counterReducer, { count: 0 }, [
        middleware1,
        middleware2,
      ])

      manager.dispatch({ type: 'INCREMENT' })

      expect(logs).toEqual(['1-before', '2-before', '2-after', '1-after'])
    })

    test('logger middleware logs actions', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const manager = new StateManager<CounterState>(counterReducer, { count: 0 }, [
        loggerMiddleware,
      ])

      manager.dispatch({ type: 'INCREMENT' })

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('Transactions', () => {
    test('batches multiple actions in transaction', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })
      const listener = vi.fn()
      manager.subscribe(listener)

      manager.transaction((dispatch) => {
        dispatch({ type: 'INCREMENT' })
        dispatch({ type: 'INCREMENT' })
        dispatch({ type: 'INCREMENT' })
      })

      expect(manager.getState()).toEqual({ count: 3 })
      expect(listener).toHaveBeenCalledTimes(1) // Only one notification
    })

    test('commits transaction on success', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })

      const result = manager.transaction((dispatch) => {
        dispatch({ type: 'INCREMENT' })
        dispatch({ type: 'INCREMENT' })
        return 'success'
      })

      expect(result).toBe('success')
      expect(manager.getState()).toEqual({ count: 2 })
    })

    test('rolls back transaction on error', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 5 })

      expect(() => {
        manager.transaction((dispatch) => {
          dispatch({ type: 'INCREMENT' })
          dispatch({ type: 'INCREMENT' })
          throw new Error('Transaction failed')
        })
      }).toThrow('Transaction failed')

      expect(manager.getState()).toEqual({ count: 5 }) // Rolled back
    })

    test('nested transactions', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })

      manager.transaction((dispatch) => {
        dispatch({ type: 'INCREMENT' })
        manager.transaction((innerDispatch) => {
          innerDispatch({ type: 'INCREMENT' })
          innerDispatch({ type: 'INCREMENT' })
        })
        dispatch({ type: 'INCREMENT' })
      })

      expect(manager.getState()).toEqual({ count: 4 })
    })
  })

  describe('Undo/Redo', () => {
    test('undoes last action', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })

      manager.dispatch({ type: 'INCREMENT' })
      manager.dispatch({ type: 'INCREMENT' })
      expect(manager.getState()).toEqual({ count: 2 })

      manager.undo()
      expect(manager.getState()).toEqual({ count: 1 })
    })

    test('redoes undone action', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })

      manager.dispatch({ type: 'INCREMENT' })
      manager.dispatch({ type: 'INCREMENT' })
      manager.undo()
      manager.redo()

      expect(manager.getState()).toEqual({ count: 2 })
    })

    test('clears redo stack on new action', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })

      manager.dispatch({ type: 'INCREMENT' })
      manager.dispatch({ type: 'INCREMENT' })
      manager.undo()
      manager.dispatch({ type: 'SET', payload: 10 })
      manager.redo() // Should do nothing

      expect(manager.getState()).toEqual({ count: 10 })
    })

    test('undo does nothing when history empty', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 5 })

      manager.undo()
      expect(manager.getState()).toEqual({ count: 5 })
    })

    test('redo does nothing when no undone actions', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 5 })

      manager.dispatch({ type: 'INCREMENT' })
      manager.redo()
      expect(manager.getState()).toEqual({ count: 6 })
    })

    test('can undo/redo', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })

      expect(manager.canUndo()).toBe(false)
      expect(manager.canRedo()).toBe(false)

      manager.dispatch({ type: 'INCREMENT' })
      expect(manager.canUndo()).toBe(true)
      expect(manager.canRedo()).toBe(false)

      manager.undo()
      expect(manager.canUndo()).toBe(false)
      expect(manager.canRedo()).toBe(true)
    })

    test('respects history limit', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 }, [], {
        historyLimit: 3,
      })

      manager.dispatch({ type: 'INCREMENT' }) // count: 1
      manager.dispatch({ type: 'INCREMENT' }) // count: 2
      manager.dispatch({ type: 'INCREMENT' }) // count: 3
      manager.dispatch({ type: 'INCREMENT' }) // count: 4
      manager.dispatch({ type: 'INCREMENT' }) // count: 5

      manager.undo() // count: 4
      manager.undo() // count: 3
      manager.undo() // count: 2
      manager.undo() // Should not go further (limit is 3)

      expect(manager.getState()).toEqual({ count: 2 })
    })
  })

  describe('Snapshots', () => {
    test('creates state snapshot', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 42 })

      const snapshot = manager.snapshot()

      expect(snapshot.state).toEqual({ count: 42 })
      expect(snapshot.id).toBeDefined()
      expect(snapshot.timestamp).toBeDefined()
    })

    test('restores from snapshot', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })

      manager.dispatch({ type: 'INCREMENT' })
      manager.dispatch({ type: 'INCREMENT' })
      const snapshot = manager.snapshot()

      manager.dispatch({ type: 'SET', payload: 100 })
      expect(manager.getState()).toEqual({ count: 100 })

      manager.restore(snapshot)
      expect(manager.getState()).toEqual({ count: 2 })
    })

    test('snapshot is immutable copy', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })

      const snapshot = manager.snapshot()
      manager.dispatch({ type: 'INCREMENT' })

      expect(snapshot.state).toEqual({ count: 0 })
      expect(manager.getState()).toEqual({ count: 1 })
    })

    test('notifies subscribers on restore', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 })
      const listener = vi.fn()

      const snapshot = manager.snapshot()
      manager.dispatch({ type: 'INCREMENT' })
      listener.mockClear()

      manager.subscribe(listener)
      manager.restore(snapshot)

      expect(listener).toHaveBeenCalledWith({ count: 0 })
    })
  })

  describe('Persistence', () => {
    test('persists state with adapter', async () => {
      const storage = new Map<string, string>()
      const adapter: PersistenceAdapter<CounterState> = {
        save: async (key, state) => {
          storage.set(key, JSON.stringify(state))
        },
        load: async (key) => {
          const data = storage.get(key)
          return data ? JSON.parse(data) : null
        },
      }

      const manager = new StateManager<CounterState>(counterReducer, { count: 0 }, [], {
        persistence: { adapter, key: 'test-state' },
      })

      manager.dispatch({ type: 'SET', payload: 42 })
      await manager.persist()

      expect(storage.get('test-state')).toBe(JSON.stringify({ count: 42 }))
    })

    test('loads persisted state', async () => {
      const storage = new Map<string, string>()
      storage.set('test-state', JSON.stringify({ count: 99 }))

      const adapter: PersistenceAdapter<CounterState> = {
        save: async (key, state) => {
          storage.set(key, JSON.stringify(state))
        },
        load: async (key) => {
          const data = storage.get(key)
          return data ? JSON.parse(data) : null
        },
      }

      const manager = new StateManager<CounterState>(counterReducer, { count: 0 }, [], {
        persistence: { adapter, key: 'test-state' },
      })

      await manager.hydrate()

      expect(manager.getState()).toEqual({ count: 99 })
    })

    test('uses initial state when no persisted state', async () => {
      const adapter: PersistenceAdapter<CounterState> = {
        save: async () => {},
        load: async () => null,
      }

      const manager = new StateManager<CounterState>(counterReducer, { count: 5 }, [], {
        persistence: { adapter, key: 'test-state' },
      })

      await manager.hydrate()

      expect(manager.getState()).toEqual({ count: 5 })
    })

    test('persist middleware auto-saves on dispatch', async () => {
      const saves: CounterState[] = []
      const adapter: PersistenceAdapter<CounterState> = {
        save: async (_key, state) => {
          saves.push(state)
        },
        load: async () => null,
      }

      const manager = new StateManager<CounterState>(
        counterReducer,
        { count: 0 },
        [persistMiddleware(adapter, 'test-key')],
        {}
      )

      manager.dispatch({ type: 'INCREMENT' })

      // Wait for async save
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(saves).toContainEqual({ count: 1 })
    })
  })

  describe('Async Actions (Thunk)', () => {
    test('dispatches async thunk action', async () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 }, [thunkMiddleware])

      const asyncIncrement = () => async (dispatch: (action: StateAction) => void) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        dispatch({ type: 'INCREMENT' })
      }

      await manager.dispatch(asyncIncrement())

      expect(manager.getState()).toEqual({ count: 1 })
    })

    test('thunk has access to getState', async () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 5 }, [thunkMiddleware])

      const conditionalIncrement =
        () =>
        async (
          dispatch: (action: StateAction) => void,
          getState: () => CounterState
        ) => {
          const state = getState()
          if (state.count < 10) {
            dispatch({ type: 'INCREMENT' })
          }
        }

      await manager.dispatch(conditionalIncrement())

      expect(manager.getState()).toEqual({ count: 6 })
    })

    test('thunk can dispatch multiple actions', async () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 0 }, [thunkMiddleware])

      const incrementTwice = () => async (dispatch: (action: StateAction) => void) => {
        dispatch({ type: 'INCREMENT' })
        await new Promise((resolve) => setTimeout(resolve, 5))
        dispatch({ type: 'INCREMENT' })
      }

      await manager.dispatch(incrementTwice())

      expect(manager.getState()).toEqual({ count: 2 })
    })
  })

  describe('TransactionManager', () => {
    test('creates and commits transaction', () => {
      let state = { count: 0 }
      const transactionManager = new TransactionManager<CounterState>()

      const tx = transactionManager.begin(state)
      tx.addAction({ type: 'INCREMENT' })
      tx.addAction({ type: 'INCREMENT' })

      expect(tx.actions).toHaveLength(2)
      expect(tx.committed).toBe(false)

      tx.commit()
      expect(tx.committed).toBe(true)
    })

    test('rolls back transaction', () => {
      const state = { count: 5 }
      const transactionManager = new TransactionManager<CounterState>()

      const tx = transactionManager.begin(state)
      tx.addAction({ type: 'INCREMENT' })

      const rolledBack = tx.rollback()
      expect(rolledBack).toEqual({ count: 5 })
      expect(tx.committed).toBe(false)
    })
  })

  describe('HistoryManager', () => {
    test('records state changes', () => {
      const historyManager = new HistoryManager<CounterState>(10)

      historyManager.push({ count: 0 })
      historyManager.push({ count: 1 })
      historyManager.push({ count: 2 })

      expect(historyManager.canUndo()).toBe(true)
    })

    test('undoes state', () => {
      const historyManager = new HistoryManager<CounterState>(10)

      historyManager.push({ count: 0 })
      historyManager.push({ count: 1 })
      historyManager.push({ count: 2 })

      const previous = historyManager.undo()
      expect(previous).toEqual({ count: 1 })
    })

    test('redoes state', () => {
      const historyManager = new HistoryManager<CounterState>(10)

      historyManager.push({ count: 0 })
      historyManager.push({ count: 1 })
      historyManager.push({ count: 2 })

      historyManager.undo()
      const next = historyManager.redo()
      expect(next).toEqual({ count: 2 })
    })

    test('clears future on new push after undo', () => {
      const historyManager = new HistoryManager<CounterState>(10)

      historyManager.push({ count: 0 })
      historyManager.push({ count: 1 })
      historyManager.push({ count: 2 })

      historyManager.undo()
      historyManager.push({ count: 10 })

      expect(historyManager.canRedo()).toBe(false)
    })

    test('respects history limit', () => {
      const historyManager = new HistoryManager<CounterState>(3)

      historyManager.push({ count: 0 })
      historyManager.push({ count: 1 })
      historyManager.push({ count: 2 })
      historyManager.push({ count: 3 })
      historyManager.push({ count: 4 })

      // Can only undo 3 times (limit)
      historyManager.undo() // -> 3
      historyManager.undo() // -> 2
      historyManager.undo() // -> 1
      const result = historyManager.undo() // Should return undefined or stay at limit

      expect(result).toBeUndefined()
    })
  })

  describe('Edge Cases', () => {
    test('handles empty state', () => {
      interface EmptyState {}
      const emptyReducer: Reducer<EmptyState> = (state = {}) => state

      const manager = new StateManager<EmptyState>(emptyReducer)
      expect(manager.getState()).toEqual({})
    })

    test('handles complex nested state', () => {
      interface NestedState {
        level1: {
          level2: {
            level3: {
              value: number
            }
          }
        }
      }

      const nestedReducer: Reducer<NestedState> = (
        state = { level1: { level2: { level3: { value: 0 } } } },
        action
      ) => {
        if (action.type === 'SET_DEEP') {
          return {
            level1: {
              level2: {
                level3: {
                  value: action.payload as number,
                },
              },
            },
          }
        }
        return state
      }

      const manager = new StateManager<NestedState>(nestedReducer)
      manager.dispatch({ type: 'SET_DEEP', payload: 42 })

      expect(manager.select((s) => s.level1.level2.level3.value)).toBe(42)
    })

    test('state is immutable from outside', () => {
      const manager = new StateManager<CounterState>(counterReducer, { count: 5 })

      const state = manager.getState()
      ;(state as any).count = 100 // Try to mutate

      expect(manager.getState().count).toBe(5) // Should be unchanged
    })
  })
})
