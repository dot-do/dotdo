/**
 * State backend factory tests
 * @module primitives-core/state.test
 */
import { describe, test, expect, vi } from 'vitest'
import {
  createStateBackend,
  StateBackend,
  StateAction,
  Reducer,
  Middleware,
} from './state'

// Test state type
interface CounterState {
  count: number
}

// Test reducer
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

describe('createStateBackend', () => {
  test('creates a StateBackend instance', () => {
    const backend = createStateBackend(counterReducer)
    expect(backend).toBeDefined()
    expect(typeof backend.getState).toBe('function')
    expect(typeof backend.dispatch).toBe('function')
    expect(typeof backend.subscribe).toBe('function')
  })

  test('accepts initial state', () => {
    const backend = createStateBackend(counterReducer, { count: 10 })
    expect(backend.getState().count).toBe(10)
  })

  test('uses reducer default state when no initial provided', () => {
    const backend = createStateBackend(counterReducer)
    expect(backend.getState().count).toBe(0)
  })
})

describe('StateBackend.getState', () => {
  test('returns current state', () => {
    const backend = createStateBackend(counterReducer, { count: 5 })
    expect(backend.getState()).toEqual({ count: 5 })
  })

  test('returns immutable copy', () => {
    const backend = createStateBackend(counterReducer, { count: 5 })
    const state1 = backend.getState()
    const state2 = backend.getState()

    expect(state1).toEqual(state2)
    expect(state1).not.toBe(state2)
  })
})

describe('StateBackend.dispatch', () => {
  test('updates state via reducer', () => {
    const backend = createStateBackend(counterReducer, { count: 0 })

    backend.dispatch({ type: 'INCREMENT' })
    expect(backend.getState().count).toBe(1)

    backend.dispatch({ type: 'INCREMENT' })
    expect(backend.getState().count).toBe(2)

    backend.dispatch({ type: 'DECREMENT' })
    expect(backend.getState().count).toBe(1)
  })

  test('handles action with payload', () => {
    const backend = createStateBackend(counterReducer, { count: 0 })

    backend.dispatch({ type: 'SET', payload: 100 })
    expect(backend.getState().count).toBe(100)
  })

  test('ignores unknown actions', () => {
    const backend = createStateBackend(counterReducer, { count: 5 })

    backend.dispatch({ type: 'UNKNOWN' })
    expect(backend.getState().count).toBe(5)
  })
})

describe('StateBackend.subscribe', () => {
  test('notifies subscriber on state change', () => {
    const backend = createStateBackend(counterReducer, { count: 0 })
    const subscriber = vi.fn()

    backend.subscribe(subscriber)
    backend.dispatch({ type: 'INCREMENT' })

    expect(subscriber).toHaveBeenCalledWith({ count: 1 })
  })

  test('returns unsubscribe function', () => {
    const backend = createStateBackend(counterReducer, { count: 0 })
    const subscriber = vi.fn()

    const unsubscribe = backend.subscribe(subscriber)
    expect(typeof unsubscribe).toBe('function')
  })

  test('unsubscribe stops notifications', () => {
    const backend = createStateBackend(counterReducer, { count: 0 })
    const subscriber = vi.fn()

    const unsubscribe = backend.subscribe(subscriber)
    backend.dispatch({ type: 'INCREMENT' })
    expect(subscriber).toHaveBeenCalledTimes(1)

    unsubscribe()
    backend.dispatch({ type: 'INCREMENT' })
    expect(subscriber).toHaveBeenCalledTimes(1)
  })

  test('multiple subscribers all notified', () => {
    const backend = createStateBackend(counterReducer, { count: 0 })
    const subscriber1 = vi.fn()
    const subscriber2 = vi.fn()

    backend.subscribe(subscriber1)
    backend.subscribe(subscriber2)
    backend.dispatch({ type: 'INCREMENT' })

    expect(subscriber1).toHaveBeenCalled()
    expect(subscriber2).toHaveBeenCalled()
  })

  test('does not notify if state unchanged', () => {
    const backend = createStateBackend(counterReducer, { count: 0 })
    const subscriber = vi.fn()

    backend.subscribe(subscriber)
    backend.dispatch({ type: 'UNKNOWN' }) // Should not change state

    expect(subscriber).not.toHaveBeenCalled()
  })
})

describe('StateBackend.select', () => {
  test('selects derived state', () => {
    const backend = createStateBackend(counterReducer, { count: 10 })
    const doubled = backend.select((state) => state.count * 2)

    expect(doubled).toBe(20)
  })

  test('select reflects current state', () => {
    const backend = createStateBackend(counterReducer, { count: 0 })

    backend.dispatch({ type: 'INCREMENT' })
    const count = backend.select((state) => state.count)

    expect(count).toBe(1)
  })
})

describe('StateBackend with middleware', () => {
  test('middleware intercepts dispatch', () => {
    const middleware: Middleware<CounterState> = (store) => (next) => (action) => {
      if (action.type === 'BLOCKED') {
        return // Block this action
      }
      return next(action)
    }

    const backend = createStateBackend(counterReducer, { count: 0 }, [middleware])

    backend.dispatch({ type: 'INCREMENT' })
    expect(backend.getState().count).toBe(1)

    backend.dispatch({ type: 'BLOCKED' })
    expect(backend.getState().count).toBe(1) // Should not change
  })

  test('middleware can transform actions', () => {
    const doubleMiddleware: Middleware<CounterState> = (store) => (next) => (action) => {
      if (action.type === 'DOUBLE_INCREMENT') {
        next({ type: 'INCREMENT' })
        next({ type: 'INCREMENT' })
        return
      }
      return next(action)
    }

    const backend = createStateBackend(counterReducer, { count: 0 }, [doubleMiddleware])

    backend.dispatch({ type: 'DOUBLE_INCREMENT' })
    expect(backend.getState().count).toBe(2)
  })

  test('multiple middleware chain correctly', () => {
    const calls: string[] = []

    const middleware1: Middleware<CounterState> = () => (next) => (action) => {
      calls.push('m1-before')
      const result = next(action)
      calls.push('m1-after')
      return result
    }

    const middleware2: Middleware<CounterState> = () => (next) => (action) => {
      calls.push('m2-before')
      const result = next(action)
      calls.push('m2-after')
      return result
    }

    const backend = createStateBackend(counterReducer, { count: 0 }, [middleware1, middleware2])

    backend.dispatch({ type: 'INCREMENT' })

    expect(calls).toEqual(['m1-before', 'm2-before', 'm2-after', 'm1-after'])
  })
})

describe('StateBackend.snapshot and restore', () => {
  test('creates snapshot of current state', () => {
    const backend = createStateBackend(counterReducer, { count: 5 })
    const snapshot = backend.snapshot()

    expect(snapshot.state).toEqual({ count: 5 })
    expect(snapshot.id).toBeDefined()
    expect(snapshot.timestamp).toBeGreaterThan(0)
  })

  test('restores state from snapshot', () => {
    const backend = createStateBackend(counterReducer, { count: 5 })
    const snapshot = backend.snapshot()

    backend.dispatch({ type: 'SET', payload: 100 })
    expect(backend.getState().count).toBe(100)

    backend.restore(snapshot)
    expect(backend.getState().count).toBe(5)
  })

  test('restore notifies subscribers', () => {
    const backend = createStateBackend(counterReducer, { count: 5 })
    const snapshot = backend.snapshot()
    const subscriber = vi.fn()

    backend.dispatch({ type: 'SET', payload: 100 })
    backend.subscribe(subscriber)
    backend.restore(snapshot)

    expect(subscriber).toHaveBeenCalledWith({ count: 5 })
  })
})

describe('StateBackend.transaction', () => {
  test('batches multiple dispatches', () => {
    const backend = createStateBackend(counterReducer, { count: 0 })
    const subscriber = vi.fn()

    backend.subscribe(subscriber)

    backend.transaction((dispatch) => {
      dispatch({ type: 'INCREMENT' })
      dispatch({ type: 'INCREMENT' })
      dispatch({ type: 'INCREMENT' })
    })

    // Subscriber should be called once with final state
    expect(subscriber).toHaveBeenCalledTimes(1)
    expect(subscriber).toHaveBeenCalledWith({ count: 3 })
  })

  test('rolls back on error', () => {
    const backend = createStateBackend(counterReducer, { count: 5 })

    expect(() => {
      backend.transaction((dispatch) => {
        dispatch({ type: 'INCREMENT' })
        throw new Error('Transaction failed')
      })
    }).toThrow('Transaction failed')

    // State should be rolled back
    expect(backend.getState().count).toBe(5)
  })
})
