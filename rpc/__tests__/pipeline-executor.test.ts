/**
 * PipelineExecutor Tests (RED Phase)
 *
 * These tests define the contract for server-side pipeline execution.
 * PipelineExecutor resolves a series of property accesses and method calls
 * against a target object, enabling Cap'n Web-style promise pipelining.
 *
 * @see do-l21: RED: PipelineExecutor tests (server-side)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { PipelineExecutor } from '../pipeline-executor'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Pipeline step - either property access or method call
 */
interface PropertyStep {
  type: 'property'
  name: string
}

interface MethodStep {
  type: 'method'
  name: string
  args: unknown[]
}

type ExecutorPipelineStep = PropertyStep | MethodStep

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Simple object with nested properties
 */
const simpleObject = {
  name: 'Alice',
  email: 'alice@example.com',
  age: 30,
  profile: {
    email: 'alice@profile.com',
    settings: {
      theme: 'dark',
      notifications: true,
    },
  },
}

/**
 * Object with methods
 */
const objectWithMethods = {
  name: 'Bob',
  greet(greeting: string): string {
    return `${greeting}, I'm ${this.name}!`
  },
  add(a: number, b: number): number {
    return a + b
  },
  getProfile() {
    return { email: 'bob@example.com', level: 'premium' }
  },
}

/**
 * Object with async methods
 */
const objectWithAsyncMethods = {
  async fetchData(): Promise<{ data: string }> {
    return { data: 'async result' }
  },
  async slowOperation(delay: number): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, delay))
    return 'completed'
  },
  async getNestedAsync(): Promise<{ inner: { value: number } }> {
    return { inner: { value: 42 } }
  },
}

/**
 * Complex object with chained methods returning objects
 */
const chainableObject = {
  db: {
    users: {
      find(id: string) {
        return {
          id,
          name: `User ${id}`,
          profile: {
            email: `${id}@example.com`,
          },
        }
      },
      async findAsync(id: string) {
        return {
          id,
          name: `User ${id}`,
          profile: {
            email: `${id}@example.com`,
          },
        }
      },
    },
  },
}

/**
 * Object that throws errors
 */
const errorObject = {
  name: 'Error Test',
  throwSync(): never {
    throw new Error('Sync error occurred')
  },
  async throwAsync(): Promise<never> {
    throw new Error('Async error occurred')
  },
}

// ============================================================================
// PROPERTY ACCESS TESTS
// ============================================================================

describe('PipelineExecutor', () => {
  let executor: PipelineExecutor

  beforeEach(() => {
    executor = new PipelineExecutor()
  })

  describe('property access execution', () => {
    it('accesses a simple property', async () => {
      const result = await executor.execute(simpleObject, [{ type: 'property', name: 'name' }])

      expect(result).toBe('Alice')
    })

    it('accesses nested property with single step', async () => {
      const result = await executor.execute(simpleObject, [{ type: 'property', name: 'profile' }])

      expect(result).toEqual({
        email: 'alice@profile.com',
        settings: {
          theme: 'dark',
          notifications: true,
        },
      })
    })

    it('accesses deeply nested property with chained steps', async () => {
      const result = await executor.execute(simpleObject, [
        { type: 'property', name: 'profile' },
        { type: 'property', name: 'settings' },
        { type: 'property', name: 'theme' },
      ])

      expect(result).toBe('dark')
    })

    it('returns undefined for non-existent property without throwing', async () => {
      const result = await executor.execute(simpleObject, [{ type: 'property', name: 'nonexistent' }])

      expect(result).toBeUndefined()
    })

    it('accesses numeric properties', async () => {
      const arrayLikeObject = { 0: 'first', 1: 'second', length: 2 }
      const result = await executor.execute(arrayLikeObject, [{ type: 'property', name: '0' }])

      expect(result).toBe('first')
    })
  })

  // ============================================================================
  // METHOD CALL TESTS
  // ============================================================================

  describe('method call execution', () => {
    it('calls a method with a single string argument', async () => {
      const result = await executor.execute(objectWithMethods, [{ type: 'method', name: 'greet', args: ['Hello'] }])

      expect(result).toBe("Hello, I'm Bob!")
    })

    it('calls a method with multiple arguments', async () => {
      const result = await executor.execute(objectWithMethods, [{ type: 'method', name: 'add', args: [5, 3] }])

      expect(result).toBe(8)
    })

    it('calls a method with no arguments', async () => {
      const result = await executor.execute(objectWithMethods, [{ type: 'method', name: 'getProfile', args: [] }])

      expect(result).toEqual({ email: 'bob@example.com', level: 'premium' })
    })

    it('preserves this context when calling methods', async () => {
      const contextObject = {
        multiplier: 10,
        multiply(value: number) {
          return value * this.multiplier
        },
      }
      const result = await executor.execute(contextObject, [{ type: 'method', name: 'multiply', args: [5] }])

      expect(result).toBe(50)
    })
  })

  // ============================================================================
  // CHAINED EXECUTION TESTS
  // ============================================================================

  describe('chained execution', () => {
    it('chains property access then method call', async () => {
      const obj = {
        calculator: {
          double(n: number) {
            return n * 2
          },
        },
      }

      const result = await executor.execute(obj, [
        { type: 'property', name: 'calculator' },
        { type: 'method', name: 'double', args: [21] },
      ])

      expect(result).toBe(42)
    })

    it('chains method call then property access', async () => {
      const result = await executor.execute(objectWithMethods, [
        { type: 'method', name: 'getProfile', args: [] },
        { type: 'property', name: 'email' },
      ])

      expect(result).toBe('bob@example.com')
    })

    it('chains multiple property accesses', async () => {
      const result = await executor.execute(simpleObject, [
        { type: 'property', name: 'profile' },
        { type: 'property', name: 'settings' },
        { type: 'property', name: 'notifications' },
      ])

      expect(result).toBe(true)
    })

    it('chains method call returning object then property access', async () => {
      const result = await executor.execute(chainableObject, [
        { type: 'property', name: 'db' },
        { type: 'property', name: 'users' },
        { type: 'method', name: 'find', args: ['user-123'] },
        { type: 'property', name: 'profile' },
        { type: 'property', name: 'email' },
      ])

      expect(result).toBe('user-123@example.com')
    })

    it('handles long chains correctly', async () => {
      const deepObject = {
        a: {
          b: {
            c: {
              d: {
                e: {
                  value: 'deep value',
                },
              },
            },
          },
        },
      }

      const result = await executor.execute(deepObject, [
        { type: 'property', name: 'a' },
        { type: 'property', name: 'b' },
        { type: 'property', name: 'c' },
        { type: 'property', name: 'd' },
        { type: 'property', name: 'e' },
        { type: 'property', name: 'value' },
      ])

      expect(result).toBe('deep value')
    })
  })

  // ============================================================================
  // ASYNC METHOD HANDLING TESTS
  // ============================================================================

  describe('async method handling', () => {
    it('awaits async methods automatically', async () => {
      const result = await executor.execute(objectWithAsyncMethods, [
        { type: 'method', name: 'fetchData', args: [] },
      ])

      expect(result).toEqual({ data: 'async result' })
    })

    it('chains property access after async method', async () => {
      const result = await executor.execute(objectWithAsyncMethods, [
        { type: 'method', name: 'fetchData', args: [] },
        { type: 'property', name: 'data' },
      ])

      expect(result).toBe('async result')
    })

    it('chains async method then nested property access', async () => {
      const result = await executor.execute(objectWithAsyncMethods, [
        { type: 'method', name: 'getNestedAsync', args: [] },
        { type: 'property', name: 'inner' },
        { type: 'property', name: 'value' },
      ])

      expect(result).toBe(42)
    })

    it('handles mixed sync and async operations in chain', async () => {
      const mixedObject = {
        getData() {
          return {
            async process() {
              return { result: 'processed' }
            },
          }
        },
      }

      const result = await executor.execute(mixedObject, [
        { type: 'method', name: 'getData', args: [] },
        { type: 'method', name: 'process', args: [] },
        { type: 'property', name: 'result' },
      ])

      expect(result).toBe('processed')
    })

    it('chains async method returning object with another async method', async () => {
      const result = await executor.execute(chainableObject, [
        { type: 'property', name: 'db' },
        { type: 'property', name: 'users' },
        { type: 'method', name: 'findAsync', args: ['async-user'] },
        { type: 'property', name: 'name' },
      ])

      expect(result).toBe('User async-user')
    })
  })

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('error handling', () => {
    it('throws meaningful error for missing property on null', async () => {
      const objWithNull = { value: null }

      await expect(
        executor.execute(objWithNull, [
          { type: 'property', name: 'value' },
          { type: 'property', name: 'nested' },
        ])
      ).rejects.toThrow(/cannot read.*property.*nested.*null/i)
    })

    it('throws meaningful error for missing property on undefined', async () => {
      const objWithUndefined = { value: undefined }

      await expect(
        executor.execute(objWithUndefined, [
          { type: 'property', name: 'value' },
          { type: 'property', name: 'nested' },
        ])
      ).rejects.toThrow(/cannot read.*property.*nested.*undefined/i)
    })

    it('throws meaningful error for calling non-function as method', async () => {
      await expect(
        executor.execute(simpleObject, [{ type: 'method', name: 'name', args: [] }])
      ).rejects.toThrow(/not a function/i)
    })

    it('propagates sync method errors', async () => {
      await expect(
        executor.execute(errorObject, [{ type: 'method', name: 'throwSync', args: [] }])
      ).rejects.toThrow('Sync error occurred')
    })

    it('propagates async method errors', async () => {
      await expect(
        executor.execute(errorObject, [{ type: 'method', name: 'throwAsync', args: [] }])
      ).rejects.toThrow('Async error occurred')
    })

    it('includes step index in error for debugging', async () => {
      await expect(
        executor.execute(simpleObject, [
          { type: 'property', name: 'profile' },
          { type: 'property', name: 'settings' },
          { type: 'method', name: 'nonexistent', args: [] },
        ])
      ).rejects.toThrow(/step.*2/i)
    })

    it('includes property/method name in error message', async () => {
      const objWithNull = { value: null }

      await expect(
        executor.execute(objWithNull, [
          { type: 'property', name: 'value' },
          { type: 'property', name: 'specificProp' },
        ])
      ).rejects.toThrow(/specificProp/i)
    })
  })

  // ============================================================================
  // NESTED OBJECT TRAVERSAL TESTS
  // ============================================================================

  describe('nested object traversal', () => {
    it('traverses nested objects correctly', async () => {
      const nested = {
        level1: {
          level2: {
            level3: {
              target: 'found',
            },
          },
        },
      }

      const result = await executor.execute(nested, [
        { type: 'property', name: 'level1' },
        { type: 'property', name: 'level2' },
        { type: 'property', name: 'level3' },
        { type: 'property', name: 'target' },
      ])

      expect(result).toBe('found')
    })

    it('traverses arrays using numeric index properties', async () => {
      const objWithArray = {
        items: ['first', 'second', 'third'],
      }

      const result = await executor.execute(objWithArray, [
        { type: 'property', name: 'items' },
        { type: 'property', name: '1' },
      ])

      expect(result).toBe('second')
    })

    it('calls array methods through pipeline', async () => {
      const objWithArray = {
        items: [1, 2, 3, 4, 5],
      }

      const result = await executor.execute(objWithArray, [
        { type: 'property', name: 'items' },
        { type: 'method', name: 'filter', args: [(n: number) => n > 2] },
        { type: 'property', name: 'length' },
      ])

      expect(result).toBe(3)
    })

    it('handles Map objects', async () => {
      const objWithMap = {
        data: new Map([
          ['key1', 'value1'],
          ['key2', 'value2'],
        ]),
      }

      const result = await executor.execute(objWithMap, [
        { type: 'property', name: 'data' },
        { type: 'method', name: 'get', args: ['key1'] },
      ])

      expect(result).toBe('value1')
    })

    it('handles Set objects', async () => {
      const objWithSet = {
        tags: new Set(['a', 'b', 'c']),
      }

      const result = await executor.execute(objWithSet, [
        { type: 'property', name: 'tags' },
        { type: 'method', name: 'has', args: ['b'] },
      ])

      expect(result).toBe(true)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('handles empty pipeline (returns target unchanged)', async () => {
      const result = await executor.execute(simpleObject, [])

      expect(result).toBe(simpleObject)
    })

    it('handles primitive target with empty pipeline', async () => {
      const result = await executor.execute('hello', [])

      expect(result).toBe('hello')
    })

    it('handles primitive target with method call', async () => {
      const result = await executor.execute('hello', [{ type: 'method', name: 'toUpperCase', args: [] }])

      expect(result).toBe('HELLO')
    })

    it('handles number target with method call', async () => {
      const result = await executor.execute(42.5, [{ type: 'method', name: 'toFixed', args: [1] }])

      expect(result).toBe('42.5')
    })

    it('handles Symbol properties', async () => {
      const sym = Symbol('test')
      const objWithSymbol = { [sym]: 'symbol value' }

      // Note: Symbol properties are typically accessed differently
      // This test verifies the executor handles string-based symbol description
      const result = await executor.execute(objWithSymbol, [{ type: 'property', name: sym.toString() }])

      // Symbols accessed via string won't work the same way
      expect(result).toBeUndefined()
    })

    it('handles getter properties', async () => {
      const objWithGetter = {
        _value: 100,
        get computed() {
          return this._value * 2
        },
      }

      const result = await executor.execute(objWithGetter, [{ type: 'property', name: 'computed' }])

      expect(result).toBe(200)
    })

    it('handles methods that return undefined', async () => {
      const obj = {
        doNothing() {
          return undefined
        },
      }

      const result = await executor.execute(obj, [{ type: 'method', name: 'doNothing', args: [] }])

      expect(result).toBeUndefined()
    })

    it('handles methods that return null', async () => {
      const obj = {
        returnNull() {
          return null
        },
      }

      const result = await executor.execute(obj, [{ type: 'method', name: 'returnNull', args: [] }])

      expect(result).toBeNull()
    })

    it('handles boolean false as intermediate value', async () => {
      const obj = {
        getFalse() {
          return false
        },
      }

      const result = await executor.execute(obj, [{ type: 'method', name: 'getFalse', args: [] }])

      expect(result).toBe(false)
    })

    it('handles zero as intermediate value', async () => {
      const obj = {
        getZero() {
          return 0
        },
      }

      const result = await executor.execute(obj, [{ type: 'method', name: 'getZero', args: [] }])

      expect(result).toBe(0)
    })
  })

  // ============================================================================
  // REAL-WORLD SCENARIO TESTS
  // ============================================================================

  describe('real-world scenarios', () => {
    it('executes Customer.profile.email pattern', async () => {
      const customer = {
        profile: {
          email: 'alice@example.com',
          verified: true,
        },
      }

      const result = await executor.execute(customer, [
        { type: 'property', name: 'profile' },
        { type: 'property', name: 'email' },
      ])

      expect(result).toBe('alice@example.com')
    })

    it('executes Order.getItems().length pattern', async () => {
      const order = {
        getItems() {
          return [{ id: 1 }, { id: 2 }, { id: 3 }]
        },
      }

      const result = await executor.execute(order, [
        { type: 'method', name: 'getItems', args: [] },
        { type: 'property', name: 'length' },
      ])

      expect(result).toBe(3)
    })

    it('executes User.sendNotification(message) pattern', async () => {
      const notificationsSent: string[] = []
      const user = {
        sendNotification(message: string) {
          notificationsSent.push(message)
          return { success: true, id: 'notif-123' }
        },
      }

      const result = await executor.execute(user, [
        { type: 'method', name: 'sendNotification', args: ['Hello!'] },
        { type: 'property', name: 'success' },
      ])

      expect(result).toBe(true)
      expect(notificationsSent).toContain('Hello!')
    })

    it('executes API.users.find(id).profile pattern', async () => {
      const api = {
        users: {
          find(id: string) {
            return {
              id,
              profile: {
                displayName: `User ${id}`,
                avatar: `https://avatars.example.com/${id}`,
              },
            }
          },
        },
      }

      const result = await executor.execute(api, [
        { type: 'property', name: 'users' },
        { type: 'method', name: 'find', args: ['u-456'] },
        { type: 'property', name: 'profile' },
        { type: 'property', name: 'displayName' },
      ])

      expect(result).toBe('User u-456')
    })

    it('executes async DB query pattern', async () => {
      const db = {
        async query(sql: string, params: unknown[]) {
          if (sql.includes('SELECT')) {
            return {
              rows: [{ id: params[0], name: 'Test User' }],
              rowCount: 1,
            }
          }
          return { rows: [], rowCount: 0 }
        },
      }

      const result = await executor.execute(db, [
        { type: 'method', name: 'query', args: ['SELECT * FROM users WHERE id = ?', ['user-1']] },
        { type: 'property', name: 'rows' },
        { type: 'property', name: '0' },
        { type: 'property', name: 'name' },
      ])

      expect(result).toBe('Test User')
    })
  })
})
