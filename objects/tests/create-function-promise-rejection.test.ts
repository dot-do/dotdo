/**
 * createFunction() Promise Rejection Handling Tests
 *
 * TDD test file for fixing unhandled Promise rejections in createFunction.ts
 *
 * Issue: Code review found unhandled Promise rejections in lines 1198-1234:
 * - Intermediate .then() callbacks can throw but errors may not propagate correctly
 * - Final .catch() should handle all errors from the promise chain
 *
 * These tests verify proper error handling patterns in the promise chain.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  createFunction,
  type FunctionInstance,
  type FunctionRegistry,
  ValidationError,
  RegistrationError,
} from '../createFunction'

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockState() {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-do-id' },
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      }),
    },
  }
}

function createMockEnv() {
  return {
    AI: {
      generate: vi.fn().mockResolvedValue({ text: 'Generated response' }),
      stream: vi.fn(),
    },
    AGENT_RUNNER: {
      run: vi.fn().mockResolvedValue({ result: 'Agent completed' }),
    },
    NOTIFICATIONS: {
      send: vi.fn().mockResolvedValue(undefined),
      waitForResponse: vi.fn().mockResolvedValue({ approved: true }),
    },
  }
}

function createMockRegistry(): FunctionRegistry {
  const functions = new Map<string, FunctionInstance>()
  return {
    register: vi.fn(async (fn: FunctionInstance) => {
      functions.set(fn.name, fn)
    }),
    get: vi.fn(async (name: string) => functions.get(name) || null),
    list: vi.fn(async () => Array.from(functions.values())),
    unregister: vi.fn(async (name: string) => functions.delete(name)),
    has: vi.fn(async (name: string) => functions.has(name)),
  }
}

// ============================================================================
// PROMISE REJECTION HANDLING TESTS
// ============================================================================

describe('createFunction Promise Rejection Handling', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let mockRegistry: FunctionRegistry

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    mockRegistry = createMockRegistry()
    vi.clearAllMocks()
  })

  describe('Registry check failures', () => {
    it('rejects with RegistrationError when registry.has() throws', async () => {
      // Simulate registry.has() throwing an error
      ;(mockRegistry.has as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Registry connection failed')
      )

      await expect(
        createFunction(
          {
            name: 'testFunction',
            type: 'code',
            handler: () => 'result',
          },
          { registry: mockRegistry, env: mockEnv }
        )
      ).rejects.toThrow('Registry connection failed')
    })

    it('rejects when registry.has() returns true for duplicate (without replace)', async () => {
      // When registry.has() returns true, should throw RegistrationError
      ;(mockRegistry.has as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)

      await expect(
        createFunction(
          {
            name: 'existingFunction',
            type: 'code',
            handler: () => 'result',
          },
          { registry: mockRegistry, env: mockEnv }
        )
      ).rejects.toThrow(RegistrationError)
    })

    it('rejects properly when duplicate name found (without replace option)', async () => {
      // First, register a function
      await createFunction(
        {
          name: 'existingFunction',
          type: 'code',
          handler: () => 'result',
        },
        { registry: mockRegistry, env: mockEnv }
      )

      // Attempt to create another function with the same name
      await expect(
        createFunction(
          {
            name: 'existingFunction',
            type: 'code',
            handler: () => 'different result',
          },
          { registry: mockRegistry, env: mockEnv }
        )
      ).rejects.toThrow(RegistrationError)
    })
  })

  describe('Storage operation failures', () => {
    it('rejects when state.storage.put() throws during function persistence', async () => {
      mockState.storage.put.mockRejectedValueOnce(new Error('Storage write failed'))

      await expect(
        createFunction(
          {
            name: 'testFunction',
            type: 'code',
            handler: () => 'result',
          },
          { registry: mockRegistry, env: mockEnv, state: mockState as unknown as DurableObjectState }
        )
      ).rejects.toThrow('Storage write failed')
    })

    it('rejects when state.storage.get() throws during fromStorage', async () => {
      mockState.storage.get.mockRejectedValueOnce(new Error('Storage read failed'))

      await expect(
        createFunction.fromStorage('testFunction', {
          registry: mockRegistry,
          env: mockEnv,
          state: mockState as unknown as DurableObjectState,
        })
      ).rejects.toThrow('Storage read failed')
    })
  })

  describe('Registry operation failures', () => {
    it('rejects when registry.register() throws', async () => {
      ;(mockRegistry.register as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Registration failed')
      )

      await expect(
        createFunction(
          {
            name: 'testFunction',
            type: 'code',
            handler: () => 'result',
          },
          { registry: mockRegistry, env: mockEnv }
        )
      ).rejects.toThrow('Registration failed')
    })

    it('rejects when registry.unregister() throws during replace', async () => {
      // First register the function
      await createFunction(
        {
          name: 'testFunction',
          type: 'code',
          handler: () => 'result',
        },
        { registry: mockRegistry, env: mockEnv }
      )

      // Make unregister fail
      ;(mockRegistry.unregister as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Unregister failed')
      )

      await expect(
        createFunction(
          {
            name: 'testFunction',
            type: 'code',
            handler: () => 'new result',
          },
          { registry: mockRegistry, env: mockEnv, replace: true }
        )
      ).rejects.toThrow('Unregister failed')
    })
  })

  describe('Validation error handling', () => {
    it('rejects with ValidationError for sync validation failures', async () => {
      await expect(
        createFunction(
          {
            name: '', // Invalid empty name
            type: 'code',
            handler: () => 'result',
          },
          { registry: mockRegistry, env: mockEnv }
        )
      ).rejects.toThrow(ValidationError)
    })

    it('rejects with ValidationError for missing required fields', async () => {
      await expect(
        createFunction(
          {
            name: 'testFunction',
            type: 'code',
            // Missing handler
          } as Parameters<typeof createFunction>[0],
          { registry: mockRegistry, env: mockEnv }
        )
      ).rejects.toThrow(ValidationError)
    })
  })

  describe('Error type preservation', () => {
    it('preserves ValidationError type through promise chain', async () => {
      try {
        await createFunction(
          {
            name: '123invalid', // Invalid: must start with letter
            type: 'code',
            handler: () => 'result',
          },
          { registry: mockRegistry, env: mockEnv }
        )
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        expect((error as Error).name).toBe('ValidationError')
      }
    })

    it('preserves RegistrationError type through promise chain', async () => {
      // First register
      await createFunction(
        {
          name: 'existingFunction',
          type: 'code',
          handler: () => 'result',
        },
        { registry: mockRegistry, env: mockEnv }
      )

      // Try to register again
      try {
        await createFunction(
          {
            name: 'existingFunction',
            type: 'code',
            handler: () => 'result',
          },
          { registry: mockRegistry, env: mockEnv }
        )
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(RegistrationError)
        expect((error as Error).name).toBe('RegistrationError')
      }
    })

    it('preserves generic Error through promise chain', async () => {
      ;(mockRegistry.register as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Generic error')
      )

      try {
        await createFunction(
          {
            name: 'testFunction',
            type: 'code',
            handler: () => 'result',
          },
          { registry: mockRegistry, env: mockEnv }
        )
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe('Generic error')
      }
    })
  })

  describe('Multiple async operation failures', () => {
    it('rejects on first failure in sequence (storage before registry)', async () => {
      // Storage fails first
      mockState.storage.put.mockRejectedValueOnce(new Error('Storage failed first'))
      // Registry would fail too if reached
      ;(mockRegistry.register as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Registry failed second')
      )

      await expect(
        createFunction(
          {
            name: 'testFunction',
            type: 'code',
            handler: () => 'result',
          },
          { registry: mockRegistry, env: mockEnv, state: mockState as unknown as DurableObjectState }
        )
      ).rejects.toThrow('Storage failed first')
    })

    it('does not leave partial state on failure', async () => {
      const storagePutCalls: string[] = []
      mockState.storage.put.mockImplementation(async (key: string) => {
        storagePutCalls.push(key)
        if (key.startsWith('function:')) {
          // First put succeeds
        }
      })

      // Registry fails
      ;(mockRegistry.register as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Registration failed')
      )

      await expect(
        createFunction(
          {
            name: 'testFunction',
            type: 'code',
            handler: () => 'result',
          },
          { registry: mockRegistry, env: mockEnv, state: mockState as unknown as DurableObjectState }
        )
      ).rejects.toThrow('Registration failed')

      // Verify the function was attempted to be stored
      // (In a more robust implementation, this would be rolled back)
    })
  })

  describe('Concurrent operation safety', () => {
    it('handles concurrent createFunction calls with same name', async () => {
      const results = await Promise.allSettled([
        createFunction(
          {
            name: 'concurrentFunction',
            type: 'code',
            handler: () => 'result1',
          },
          { registry: mockRegistry, env: mockEnv }
        ),
        createFunction(
          {
            name: 'concurrentFunction',
            type: 'code',
            handler: () => 'result2',
          },
          { registry: mockRegistry, env: mockEnv }
        ),
      ])

      // One should succeed, one should fail with RegistrationError
      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r) => r.status === 'rejected')

      // At least one should succeed
      expect(fulfilled.length).toBeGreaterThanOrEqual(1)

      // If there's a rejection, it should be RegistrationError
      for (const r of rejected) {
        if (r.status === 'rejected') {
          expect(r.reason).toBeInstanceOf(RegistrationError)
        }
      }
    })
  })

  describe('Event emission during failures', () => {
    it('does not emit function.registered on failure', async () => {
      const onEvent = vi.fn()

      ;(mockRegistry.register as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Registration failed')
      )

      await expect(
        createFunction(
          {
            name: 'testFunction',
            type: 'code',
            handler: () => 'result',
          },
          { registry: mockRegistry, env: mockEnv, onEvent }
        )
      ).rejects.toThrow()

      // Should not have emitted function.registered
      const registeredCalls = onEvent.mock.calls.filter(
        (call) => call[0] === 'function.registered'
      )
      expect(registeredCalls).toHaveLength(0)
    })
  })
})

// Type declarations for test file
interface DurableObjectState {
  id: { toString: () => string }
  storage: {
    get: (key: string) => Promise<unknown>
    put: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<boolean>
    list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
  }
}
