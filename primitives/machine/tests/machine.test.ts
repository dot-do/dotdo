/**
 * Machine - Durable State Machines (XState v5)
 *
 * TDD test suite following strict red-green-refactor cycles.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Machine } from '../machine.js'
import type { MachineConfig, MachineStorage } from '../types.js'

// =============================================================================
// Test Types
// =============================================================================

type PaymentState = 'pending' | 'processing' | 'captured' | 'failed'
type PaymentEvent =
  | { type: 'CONFIRM' }
  | { type: 'SUCCESS' }
  | { type: 'FAIL' }
  | { type: 'RETRY' }
  | { type: 'REFUND'; reason?: string }

interface PaymentContext {
  amount: number
  currency: string
  attempts: number
}

const paymentConfig: MachineConfig<PaymentState, PaymentEvent, PaymentContext> = {
  id: 'payment',
  initial: 'pending',
  context: { amount: 0, currency: 'USD', attempts: 0 },
  states: {
    pending: {
      on: {
        CONFIRM: 'processing',
      },
    },
    processing: {
      on: {
        SUCCESS: 'captured',
        FAIL: 'failed',
      },
    },
    captured: {
      type: 'final',
    },
    failed: {
      on: {
        RETRY: 'pending',
      },
    },
  },
}

// =============================================================================
// TDD Cycle 1: Machine.define() creating factory
// =============================================================================

describe('Machine.define()', () => {
  it('should create a machine factory from config', () => {
    const factory = Machine.define(paymentConfig)

    expect(factory).toBeDefined()
    expect(factory.create).toBeInstanceOf(Function)
  })

  it('should create machine instance from factory', () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create()

    expect(machine).toBeDefined()
    expect(machine.state).toBe('pending')
    expect(machine.context).toEqual({ amount: 0, currency: 'USD', attempts: 0 })
  })

  it('should allow overriding initial context', () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create({ amount: 100, currency: 'EUR' })

    expect(machine.context.amount).toBe(100)
    expect(machine.context.currency).toBe('EUR')
    expect(machine.context.attempts).toBe(0) // Default preserved
  })
})

// =============================================================================
// TDD Cycle 2: send() transitions state
// =============================================================================

describe('Machine.send()', () => {
  it('should transition state on valid event', async () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create()

    expect(machine.state).toBe('pending')

    const newState = await machine.send({ type: 'CONFIRM' })

    expect(newState).toBe('processing')
    expect(machine.state).toBe('processing')
  })

  it('should follow multiple transitions', async () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create()

    await machine.send({ type: 'CONFIRM' })
    expect(machine.state).toBe('processing')

    await machine.send({ type: 'SUCCESS' })
    expect(machine.state).toBe('captured')
  })

  it('should stay in current state on invalid event', async () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create()

    // FAIL is not valid in 'pending' state
    const newState = await machine.send({ type: 'FAIL' })

    expect(newState).toBe('pending')
    expect(machine.state).toBe('pending')
  })
})

// =============================================================================
// TDD Cycle 3: can() checking valid transitions
// =============================================================================

describe('Machine.can()', () => {
  it('should return true for valid transition', () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create()

    expect(machine.can({ type: 'CONFIRM' })).toBe(true)
  })

  it('should return false for invalid transition', () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create()

    expect(machine.can({ type: 'FAIL' })).toBe(false)
    expect(machine.can({ type: 'SUCCESS' })).toBe(false)
    expect(machine.can({ type: 'RETRY' })).toBe(false)
  })

  it('should update valid transitions after state change', async () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create()

    expect(machine.can({ type: 'CONFIRM' })).toBe(true)
    expect(machine.can({ type: 'SUCCESS' })).toBe(false)

    await machine.send({ type: 'CONFIRM' })

    expect(machine.can({ type: 'CONFIRM' })).toBe(false)
    expect(machine.can({ type: 'SUCCESS' })).toBe(true)
    expect(machine.can({ type: 'FAIL' })).toBe(true)
  })
})

// =============================================================================
// TDD Cycle 4: observers (onTransition, onState)
// =============================================================================

describe('Machine.onTransition()', () => {
  it('should call handler on every transition', async () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create()
    const handler = vi.fn()

    machine.onTransition(handler)

    await machine.send({ type: 'CONFIRM' })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('pending', 'processing', { type: 'CONFIRM' })
  })

  it('should return unsubscribe function', async () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create()
    const handler = vi.fn()

    const unsubscribe = machine.onTransition(handler)
    await machine.send({ type: 'CONFIRM' })
    expect(handler).toHaveBeenCalledTimes(1)

    unsubscribe()
    await machine.send({ type: 'SUCCESS' })
    expect(handler).toHaveBeenCalledTimes(1) // Not called again
  })
})

describe('Machine.onState()', () => {
  it('should call handler when entering specific state', async () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create()
    const handler = vi.fn()

    machine.onState('processing', handler)

    await machine.send({ type: 'CONFIRM' })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ amount: 0, currency: 'USD', attempts: 0 })
  })

  it('should not call handler for other states', async () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create()
    const handler = vi.fn()

    machine.onState('captured', handler)

    await machine.send({ type: 'CONFIRM' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('should return unsubscribe function', async () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create()
    const handler = vi.fn()

    const unsubscribe = machine.onState('processing', handler)
    await machine.send({ type: 'CONFIRM' })
    expect(handler).toHaveBeenCalledTimes(1)

    // Go back to pending via failed state
    await machine.send({ type: 'FAIL' })
    unsubscribe()

    // Try to get back to processing
    await machine.send({ type: 'RETRY' })
    await machine.send({ type: 'CONFIRM' })
    expect(handler).toHaveBeenCalledTimes(1) // Not called again
  })
})

// =============================================================================
// TDD Cycle 5: DO persistence (persist/restore)
// =============================================================================

describe('Machine persistence', () => {
  let mockStorage: MachineStorage

  beforeEach(() => {
    const store = new Map<string, unknown>()
    mockStorage = {
      get: vi.fn((key: string) => Promise.resolve(store.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        store.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        store.delete(key)
        return Promise.resolve()
      }),
    }
  })

  it('should persist current state to storage', async () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create({ amount: 100 }, mockStorage)

    await machine.send({ type: 'CONFIRM' })
    await machine.persist()

    expect(mockStorage.put).toHaveBeenCalled()
  })

  it('should restore state from storage', async () => {
    const factory = Machine.define(paymentConfig)

    // Create and persist first machine
    const machine1 = factory.create({ amount: 100 }, mockStorage)
    await machine1.send({ type: 'CONFIRM' })
    await machine1.persist()
    machine1.stop()

    // Create new machine and restore
    const machine2 = factory.create({ amount: 0 }, mockStorage)
    await machine2.restore('payment')

    expect(machine2.state).toBe('processing')
    expect(machine2.context.amount).toBe(100)
  })

  it('should handle restore when no persisted state exists', async () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create({ amount: 50 }, mockStorage)

    await machine.restore('nonexistent')

    // Should stay in initial state
    expect(machine.state).toBe('pending')
    expect(machine.context.amount).toBe(50)
  })
})

// =============================================================================
// TDD Cycle 6: Guards and actions with context
// =============================================================================

describe('Machine guards and actions', () => {
  type CallState = 'idle' | 'ringing' | 'connected' | 'ended'
  type CallEvent =
    | { type: 'DIAL'; number: string }
    | { type: 'ANSWER' }
    | { type: 'HANG_UP' }
    | { type: 'TIMEOUT' }

  interface CallContext {
    phoneNumber: string | null
    duration: number
    callCount: number
  }

  const callConfig: MachineConfig<CallState, CallEvent, CallContext> = {
    id: 'call',
    initial: 'idle',
    context: { phoneNumber: null, duration: 0, callCount: 0 },
    states: {
      idle: {
        on: {
          DIAL: {
            target: 'ringing',
            guard: (ctx, event) => event.number.length > 0,
            actions: [
              (ctx, event) => ({ ...ctx, phoneNumber: event.number, callCount: ctx.callCount + 1 }),
            ],
          },
        },
      },
      ringing: {
        on: {
          ANSWER: 'connected',
          HANG_UP: 'ended',
          TIMEOUT: 'ended',
        },
      },
      connected: {
        entry: [(ctx) => ({ ...ctx, duration: 0 })],
        on: {
          HANG_UP: {
            target: 'ended',
            actions: [(ctx) => ({ ...ctx, duration: ctx.duration + 60 })],
          },
        },
      },
      ended: {
        type: 'final',
      },
    },
  }

  it('should block transition when guard returns false', async () => {
    const factory = Machine.define(callConfig)
    const machine = factory.create()

    // Empty number should be blocked by guard
    const newState = await machine.send({ type: 'DIAL', number: '' })

    expect(newState).toBe('idle')
    expect(machine.state).toBe('idle')
  })

  it('should allow transition when guard returns true', async () => {
    const factory = Machine.define(callConfig)
    const machine = factory.create()

    const newState = await machine.send({ type: 'DIAL', number: '555-1234' })

    expect(newState).toBe('ringing')
    expect(machine.state).toBe('ringing')
  })

  it('should execute actions and update context', async () => {
    const factory = Machine.define(callConfig)
    const machine = factory.create()

    await machine.send({ type: 'DIAL', number: '555-1234' })

    expect(machine.context.phoneNumber).toBe('555-1234')
    expect(machine.context.callCount).toBe(1)
  })

  it('should execute entry actions on state entry', async () => {
    const factory = Machine.define(callConfig)
    const machine = factory.create({ phoneNumber: null, duration: 100, callCount: 0 })

    await machine.send({ type: 'DIAL', number: '555-1234' })
    await machine.send({ type: 'ANSWER' })

    // Entry action should reset duration
    expect(machine.context.duration).toBe(0)
  })

  it('should execute exit actions with context update', async () => {
    const factory = Machine.define(callConfig)
    const machine = factory.create()

    await machine.send({ type: 'DIAL', number: '555-1234' })
    await machine.send({ type: 'ANSWER' })
    await machine.send({ type: 'HANG_UP' })

    // Action on HANG_UP should add 60 to duration
    expect(machine.context.duration).toBe(60)
  })

  it('should reflect guard status in can()', () => {
    const factory = Machine.define(callConfig)
    const machine = factory.create()

    // can() should return false when guard would fail
    // Note: can() with event data that would fail guard
    expect(machine.can({ type: 'DIAL', number: '' })).toBe(false)
    expect(machine.can({ type: 'DIAL', number: '555-1234' })).toBe(true)
  })
})

// =============================================================================
// Integration: Full payment flow
// =============================================================================

describe('Integration: Payment flow', () => {
  it('should complete full payment flow', async () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create({ amount: 99.99, currency: 'USD', attempts: 0 })

    expect(machine.state).toBe('pending')

    await machine.send({ type: 'CONFIRM' })
    expect(machine.state).toBe('processing')

    await machine.send({ type: 'SUCCESS' })
    expect(machine.state).toBe('captured')

    // Final state - should not transition
    expect(machine.can({ type: 'RETRY' })).toBe(false)
  })

  it('should handle payment retry flow', async () => {
    const factory = Machine.define(paymentConfig)
    const machine = factory.create({ amount: 50, currency: 'EUR', attempts: 0 })

    await machine.send({ type: 'CONFIRM' })
    await machine.send({ type: 'FAIL' })
    expect(machine.state).toBe('failed')

    await machine.send({ type: 'RETRY' })
    expect(machine.state).toBe('pending')

    await machine.send({ type: 'CONFIRM' })
    await machine.send({ type: 'SUCCESS' })
    expect(machine.state).toBe('captured')
  })
})
