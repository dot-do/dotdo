/**
 * DO Actor Context Tests
 *
 * RED TDD: Tests that action logs include actor from request context.
 * The actor should flow through the workflow execution modes (send, try, do).
 *
 * Actor format examples:
 * - 'Human/nathan' - A human user
 * - 'Agent/support' - An AI agent
 * - 'Service/billing' - A service account
 * - 'API/key-123' - An API key identity
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../DO'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

function createMockSqlStorage() {
  const insertedValues: unknown[] = []

  return {
    exec(query: string, ...params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
    _insertedValues: insertedValues,
  }
}

function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
      if (Array.isArray(key)) {
        let count = 0
        for (const k of key) {
          if (storage.delete(k)) count++
        }
        return count
      }
      return storage.delete(key)
    }),
    deleteAll: vi.fn(async (): Promise<void> => {
      storage.clear()
    }),
    list: vi.fn(async <T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    _storage: storage,
  }
}

function createMockDOId(name: string = 'test-do-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

function createMockState(idName: string = 'test-do-id'): DurableObjectState {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: createMockDOId(idName),
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => callback()),
  } as unknown as DurableObjectState
}

function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    ...overrides,
  }
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

interface DurableObjectState {
  id: DurableObjectId
  storage: DurableObjectStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

interface DurableObjectStorage {
  get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined>
  put<T>(key: string | Record<string, T>, value?: T): Promise<void>
  delete(key: string | string[]): Promise<boolean | number>
  deleteAll(): Promise<void>
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
  sql: unknown
}

// ============================================================================
// TEST DO SUBCLASS
// ============================================================================

/**
 * Test subclass that exposes protected methods and captures logged actions
 */
class TestDO extends DO {
  public loggedActions: Array<{
    durability: 'send' | 'try' | 'do'
    verb: string
    input: unknown
    actor: string
  }> = []

  // Override logAction to capture what would be logged
  protected async logAction(
    durability: 'send' | 'try' | 'do',
    verb: string,
    input: unknown,
  ): Promise<{ rowid: number }> {
    this.loggedActions.push({
      durability,
      verb,
      input,
      actor: this.getCurrentActor(),
    })
    return { rowid: this.loggedActions.length }
  }

  // Expose the method we need to test
  public getCurrentActor(): string {
    return (this as unknown as { _currentActor?: string })._currentActor || ''
  }

  // Expose setActor for testing
  public testSetActor(actor: string): void {
    this.setActor(actor)
  }

  // Expose clearActor for testing
  public testClearActor(): void {
    this.clearActor()
  }

  // Expose send for testing
  public testSend(event: string, data: unknown): void {
    this.send(event, data)
  }

  // Expose try for testing
  public async testTry<T>(action: string, data: unknown): Promise<T> {
    return this.try<T>(action, data)
  }

  // Expose do for testing
  public async testDo<T>(action: string, data: unknown): Promise<T> {
    return this.do<T>(action, data)
  }

  // Override to prevent actual action execution
  protected async executeAction(action: string, data: unknown): Promise<unknown> {
    return { success: true, action, data }
  }

  // Override to prevent actual DB operations
  protected async completeAction(rowid: number | string, output: unknown): Promise<void> {
    // No-op for testing
  }

  protected async failAction(rowid: number | string, error: unknown): Promise<void> {
    // No-op for testing
  }

  protected async emitEvent(verb: string, data: unknown): Promise<void> {
    // No-op for testing
  }
}

// ============================================================================
// TESTS: ACTOR CONTEXT
// ============================================================================

describe('DO Actor Context', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: TestDO

  beforeEach(async () => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new TestDO(mockState, mockEnv)
    await doInstance.initialize({ ns: 'https://test.example.com.ai' })
    doInstance.loggedActions = []
  })

  // ========================================================================
  // TESTS: setActor / clearActor / getCurrentActor
  // ========================================================================

  describe('Actor Management', () => {
    it('getCurrentActor returns empty string by default', () => {
      expect(doInstance.getCurrentActor()).toBe('')
    })

    it('setActor sets the current actor', () => {
      doInstance.testSetActor('Human/nathan')
      expect(doInstance.getCurrentActor()).toBe('Human/nathan')
    })

    it('clearActor clears the current actor', () => {
      doInstance.testSetActor('Human/nathan')
      doInstance.testClearActor()
      expect(doInstance.getCurrentActor()).toBe('')
    })

    it('setActor accepts Agent actor type', () => {
      doInstance.testSetActor('Agent/support')
      expect(doInstance.getCurrentActor()).toBe('Agent/support')
    })

    it('setActor accepts Service actor type', () => {
      doInstance.testSetActor('Service/billing')
      expect(doInstance.getCurrentActor()).toBe('Service/billing')
    })

    it('setActor accepts API key actor type', () => {
      doInstance.testSetActor('API/key-abc123')
      expect(doInstance.getCurrentActor()).toBe('API/key-abc123')
    })

    it('setActor can be called multiple times to change actor', () => {
      doInstance.testSetActor('Human/nathan')
      expect(doInstance.getCurrentActor()).toBe('Human/nathan')

      doInstance.testSetActor('Agent/support')
      expect(doInstance.getCurrentActor()).toBe('Agent/support')
    })
  })

  // ========================================================================
  // TESTS: Actor in send() execution mode
  // ========================================================================

  describe('Actor in send() execution mode', () => {
    it('send() logs action with empty actor by default', async () => {
      doInstance.testSend('customer.created', { id: '123' })

      // Wait for async operation
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(doInstance.loggedActions.length).toBe(1)
      expect(doInstance.loggedActions[0].actor).toBe('')
    })

    it('send() logs action with set actor', async () => {
      doInstance.testSetActor('Human/nathan')
      doInstance.testSend('customer.created', { id: '123' })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(doInstance.loggedActions.length).toBe(1)
      expect(doInstance.loggedActions[0].actor).toBe('Human/nathan')
    })

    it('send() logs action with correct verb and data', async () => {
      doInstance.testSetActor('Agent/support')
      doInstance.testSend('order.placed', { orderId: 'order-456' })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(doInstance.loggedActions[0].verb).toBe('order.placed')
      expect(doInstance.loggedActions[0].input).toEqual({ orderId: 'order-456' })
      expect(doInstance.loggedActions[0].actor).toBe('Agent/support')
    })
  })

  // ========================================================================
  // TESTS: Actor in try() execution mode
  // ========================================================================

  describe('Actor in try() execution mode', () => {
    it('try() logs action with empty actor by default', async () => {
      await doInstance.testTry('processPayment', { amount: 100 })

      expect(doInstance.loggedActions.length).toBe(1)
      expect(doInstance.loggedActions[0].actor).toBe('')
    })

    it('try() logs action with set actor', async () => {
      doInstance.testSetActor('Service/billing')
      await doInstance.testTry('processPayment', { amount: 100 })

      expect(doInstance.loggedActions.length).toBe(1)
      expect(doInstance.loggedActions[0].actor).toBe('Service/billing')
    })

    it('try() logs action with correct durability', async () => {
      doInstance.testSetActor('Human/admin')
      await doInstance.testTry('refund', { orderId: 'order-789' })

      expect(doInstance.loggedActions[0].durability).toBe('try')
    })
  })

  // ========================================================================
  // TESTS: Actor in do() execution mode
  // ========================================================================

  describe('Actor in do() execution mode', () => {
    it('do() logs action with empty actor by default', async () => {
      await doInstance.testDo('sendEmail', { to: 'test@example.com.ai' })

      expect(doInstance.loggedActions.length).toBe(1)
      expect(doInstance.loggedActions[0].actor).toBe('')
    })

    it('do() logs action with set actor', async () => {
      doInstance.testSetActor('API/key-xyz789')
      await doInstance.testDo('sendEmail', { to: 'test@example.com.ai' })

      expect(doInstance.loggedActions.length).toBe(1)
      expect(doInstance.loggedActions[0].actor).toBe('API/key-xyz789')
    })

    it('do() logs action with correct durability', async () => {
      doInstance.testSetActor('Human/manager')
      await doInstance.testDo('approveOrder', { orderId: 'order-999' })

      expect(doInstance.loggedActions[0].durability).toBe('do')
    })
  })

  // ========================================================================
  // TESTS: Actor isolation per request
  // ========================================================================

  describe('Actor isolation', () => {
    it('clearing actor between requests isolates context', async () => {
      // First request
      doInstance.testSetActor('Human/alice')
      await doInstance.testTry('action1', {})

      // Clear between requests
      doInstance.testClearActor()

      // Second request without actor
      await doInstance.testTry('action2', {})

      expect(doInstance.loggedActions[0].actor).toBe('Human/alice')
      expect(doInstance.loggedActions[1].actor).toBe('')
    })

    it('different actors for sequential requests', async () => {
      doInstance.testSetActor('Human/alice')
      await doInstance.testTry('action1', {})

      doInstance.testSetActor('Human/bob')
      await doInstance.testTry('action2', {})

      expect(doInstance.loggedActions[0].actor).toBe('Human/alice')
      expect(doInstance.loggedActions[1].actor).toBe('Human/bob')
    })
  })

  // ========================================================================
  // TESTS: Actor format validation (optional, can be expanded)
  // ========================================================================

  describe('Actor format', () => {
    it('accepts standard Human/id format', () => {
      doInstance.testSetActor('Human/user-123')
      expect(doInstance.getCurrentActor()).toBe('Human/user-123')
    })

    it('accepts standard Agent/id format', () => {
      doInstance.testSetActor('Agent/claude-assistant')
      expect(doInstance.getCurrentActor()).toBe('Agent/claude-assistant')
    })

    it('accepts email-like actor ids', () => {
      doInstance.testSetActor('Human/nathan@example.com.ai')
      expect(doInstance.getCurrentActor()).toBe('Human/nathan@example.com.ai')
    })

    it('accepts UUID actor ids', () => {
      doInstance.testSetActor('Human/550e8400-e29b-41d4-a716-446655440000')
      expect(doInstance.getCurrentActor()).toBe('Human/550e8400-e29b-41d4-a716-446655440000')
    })
  })
})
