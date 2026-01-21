/**
 * RPC Handler Unit Tests
 *
 * Tests for do/handlers/rpc.ts covering:
 * - RPC method invocation via POST /rpc
 * - Method resolution with dot notation (e.g., "things.create")
 * - Parameter serialization/deserialization
 * - Error handling and propagation (RPCError types, wrapped errors)
 * - Edge cases (malformed requests, missing methods, nested objects)
 *
 * These tests use a minimal Hono app to isolate RPCHandler behavior.
 *
 * @module do/tests/rpc-handler.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { RPCHandler, type RPCHandlerOptions, type RPCContext } from '../handlers/rpc'
import {
  RPCError,
  RPCErrorCode,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  InternalError,
  TimeoutError,
} from '../../rpc/errors'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a test app with RPCHandler configured
 */
function createTestApp(target: Record<string, unknown>, options?: RPCHandlerOptions) {
  const app = new Hono()
  const handler = new RPCHandler(options)
  const context: RPCContext = { target }
  handler.setupRoutes(app, context)
  return app
}

/**
 * Make an RPC call to the test app
 */
async function rpcCall(
  app: Hono,
  method: string,
  args: unknown[] = [],
  path = '/rpc'
): Promise<Response> {
  const request = new Request(`http://test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
  })
  return app.fetch(request)
}

/**
 * Make a raw request to the test app (for testing malformed requests)
 */
async function rawRequest(
  app: Hono,
  body: string | object,
  path = '/rpc'
): Promise<Response> {
  const request = new Request(`http://test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return app.fetch(request)
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('RPCHandler', () => {
  // ==========================================================================
  // BASIC METHOD INVOCATION
  // ==========================================================================

  describe('method invocation', () => {
    it('should invoke a simple method and return result', async () => {
      const target = {
        greet: (name: string) => `Hello, ${name}!`,
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'greet', ['World'])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe('Hello, World!')
    })

    it('should invoke an async method and return result', async () => {
      const target = {
        asyncGreet: async (name: string) => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return `Hello, ${name}!`
        },
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'asyncGreet', ['Async'])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe('Hello, Async!')
    })

    it('should invoke method with no arguments', async () => {
      const target = {
        getTimestamp: () => 12345,
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'getTimestamp', [])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe(12345)
    })

    it('should invoke method with multiple arguments', async () => {
      const target = {
        add: (a: number, b: number, c: number) => a + b + c,
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'add', [1, 2, 3])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe(6)
    })

    it('should handle methods returning null', async () => {
      const target = {
        getNull: () => null,
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'getNull', [])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBeNull()
    })

    it('should handle methods returning undefined', async () => {
      const target = {
        getUndefined: () => undefined,
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'getUndefined', [])

      expect(response.status).toBe(200)
      // Hono's c.json(undefined) returns an empty body
      const text = await response.text()
      expect(text).toBe('')
    })

    it('should maintain correct this context when calling methods', async () => {
      const target = {
        value: 42,
        getValue() {
          return this.value
        },
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'getValue', [])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe(42)
    })
  })

  // ==========================================================================
  // DOT NOTATION METHOD RESOLUTION
  // ==========================================================================

  describe('dot notation method resolution', () => {
    it('should resolve methods via dot notation (one level)', async () => {
      const target = {
        things: {
          create: (data: { name: string }) => ({ id: '123', ...data }),
        },
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'things.create', [{ name: 'test' }])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toEqual({ id: '123', name: 'test' })
    })

    it('should resolve methods via dot notation (multiple levels)', async () => {
      const target = {
        api: {
          v1: {
            users: {
              get: (id: string) => ({ id, name: 'Test User' }),
            },
          },
        },
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'api.v1.users.get', ['user-123'])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toEqual({ id: 'user-123', name: 'Test User' })
    })

    it('should maintain this context in nested methods', async () => {
      const target = {
        service: {
          prefix: 'SVC',
          format(value: string) {
            return `${this.prefix}:${value}`
          },
        },
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'service.format', ['test'])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe('SVC:test')
    })

    it('should return 404 for non-existent nested path', async () => {
      const target = {
        things: {
          create: () => 'created',
        },
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'things.nonexistent.method', [])

      expect(response.status).toBe(404)
      const result = await response.json()
      expect(result.code).toBe(RPCErrorCode.NOT_FOUND)
    })

    it('should return 404 when intermediate path is not an object', async () => {
      const target = {
        value: 'string',
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'value.method', [])

      expect(response.status).toBe(404)
      const result = await response.json()
      expect(result.code).toBe(RPCErrorCode.NOT_FOUND)
    })
  })

  // ==========================================================================
  // PARAMETER SERIALIZATION/DESERIALIZATION
  // ==========================================================================

  describe('parameter serialization', () => {
    it('should handle complex object arguments', async () => {
      const target = {
        processData: (data: {
          name: string
          tags: string[]
          metadata: { key: string; value: number }
        }) => ({
          received: true,
          data,
        }),
      }
      const app = createTestApp(target)

      const input = {
        name: 'Test',
        tags: ['a', 'b', 'c'],
        metadata: { key: 'test', value: 42 },
      }

      const response = await rpcCall(app, 'processData', [input])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result.received).toBe(true)
      expect(result.data).toEqual(input)
    })

    it('should handle array arguments', async () => {
      const target = {
        sum: (numbers: number[]) => numbers.reduce((a, b) => a + b, 0),
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'sum', [[1, 2, 3, 4, 5]])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe(15)
    })

    it('should handle Date objects as ISO strings', async () => {
      const target = {
        processDate: (dateStr: string) => {
          // Dates are serialized as strings in JSON
          return new Date(dateStr).getFullYear()
        },
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'processDate', ['2024-06-15T12:00:00Z'])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe(2024)
    })

    it('should handle boolean arguments', async () => {
      const target = {
        toggle: (value: boolean) => !value,
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'toggle', [true])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe(false)
    })

    it('should handle nested arrays', async () => {
      const target = {
        flatten: (matrix: number[][]) => matrix.flat(),
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'flatten', [[[1, 2], [3, 4], [5, 6]]])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('should handle special number values', async () => {
      const target = {
        checkNumber: (n: number | null) => {
          // JSON serializes special numbers: Infinity, -Infinity, NaN as null
          return n === null ? 'null' : typeof n
        },
      }
      const app = createTestApp(target)

      // JSON.stringify(Infinity) === 'null'
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'checkNumber', args: [null] }),
      })
      const response = await app.fetch(request)

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe('null')
    })

    it('should return complex response objects', async () => {
      const target = {
        getComplex: () => ({
          id: '123',
          items: [{ name: 'a' }, { name: 'b' }],
          metadata: {
            created: '2024-01-01T00:00:00Z',
            tags: ['test'],
          },
        }),
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'getComplex', [])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result.id).toBe('123')
      expect(result.items).toHaveLength(2)
      expect(result.metadata.tags).toContain('test')
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('error handling', () => {
    describe('NotFoundError', () => {
      it('should return 404 for non-existent method', async () => {
        const target = {}
        const app = createTestApp(target)

        const response = await rpcCall(app, 'nonexistent', [])

        expect(response.status).toBe(404)
        const result = await response.json()
        expect(result.code).toBe(RPCErrorCode.NOT_FOUND)
        expect(result.message).toContain('nonexistent')
      })

      it('should return 404 when method throws NotFoundError', async () => {
        const target = {
          findUser: (id: string) => {
            throw new NotFoundError(`User ${id} not found`, { userId: id })
          },
        }
        const app = createTestApp(target)

        const response = await rpcCall(app, 'findUser', ['user-999'])

        expect(response.status).toBe(404)
        const result = await response.json()
        expect(result.code).toBe(RPCErrorCode.NOT_FOUND)
        expect(result.message).toContain('user-999')
        expect(result.details?.userId).toBe('user-999')
      })

      it('should handle property that is not a function', async () => {
        const target = {
          notAFunction: 'I am a string',
        }
        const app = createTestApp(target)

        const response = await rpcCall(app, 'notAFunction', [])

        expect(response.status).toBe(404)
        const result = await response.json()
        expect(result.code).toBe(RPCErrorCode.NOT_FOUND)
      })
    })

    describe('ValidationError', () => {
      it('should return 400 when method throws ValidationError', async () => {
        const target = {
          createUser: (data: { email: string }) => {
            if (!data.email.includes('@')) {
              throw new ValidationError('Invalid email format', { email: data.email })
            }
            return { id: '123', email: data.email }
          },
        }
        const app = createTestApp(target)

        const response = await rpcCall(app, 'createUser', [{ email: 'invalid' }])

        expect(response.status).toBe(400)
        const result = await response.json()
        expect(result.code).toBe(RPCErrorCode.VALIDATION_ERROR)
        expect(result.details?.email).toBe('invalid')
      })
    })

    describe('AuthenticationError', () => {
      it('should return 401 when method throws AuthenticationError', async () => {
        const target = {
          secureMethod: () => {
            throw new AuthenticationError('Token expired')
          },
        }
        const app = createTestApp(target)

        const response = await rpcCall(app, 'secureMethod', [])

        expect(response.status).toBe(401)
        const result = await response.json()
        expect(result.code).toBe(RPCErrorCode.AUTHENTICATION_ERROR)
      })
    })

    describe('AuthorizationError', () => {
      it('should return 403 when method throws AuthorizationError', async () => {
        const target = {
          adminOnly: () => {
            throw new AuthorizationError('Admin access required', { requiredRole: 'admin' })
          },
        }
        const app = createTestApp(target)

        const response = await rpcCall(app, 'adminOnly', [])

        expect(response.status).toBe(403)
        const result = await response.json()
        expect(result.code).toBe(RPCErrorCode.AUTHORIZATION_ERROR)
        expect(result.details?.requiredRole).toBe('admin')
      })
    })

    describe('TimeoutError', () => {
      it('should return 504 when method throws TimeoutError', async () => {
        const target = {
          slowOperation: () => {
            throw new TimeoutError('Operation timed out after 30000ms', { timeout: 30000 })
          },
        }
        const app = createTestApp(target)

        const response = await rpcCall(app, 'slowOperation', [])

        expect(response.status).toBe(504)
        const result = await response.json()
        expect(result.code).toBe(RPCErrorCode.TIMEOUT)
        expect(result.details?.timeout).toBe(30000)
      })
    })

    describe('InternalError', () => {
      it('should wrap generic errors as InternalError', async () => {
        const target = {
          brokenMethod: () => {
            throw new Error('Something went wrong')
          },
        }
        const app = createTestApp(target)

        const response = await rpcCall(app, 'brokenMethod', [])

        expect(response.status).toBe(500)
        const result = await response.json()
        expect(result.code).toBe(RPCErrorCode.INTERNAL_ERROR)
        expect(result.message).toContain('Something went wrong')
      })

      it('should wrap non-Error throws as InternalError', async () => {
        const target = {
          throwString: () => {
            throw 'string error'
          },
        }
        const app = createTestApp(target)

        const response = await rpcCall(app, 'throwString', [])

        expect(response.status).toBe(500)
        const result = await response.json()
        expect(result.code).toBe(RPCErrorCode.INTERNAL_ERROR)
      })

      it('should return 500 when method throws InternalError directly', async () => {
        const target = {
          internalFailure: () => {
            throw new InternalError('Database connection failed')
          },
        }
        const app = createTestApp(target)

        const response = await rpcCall(app, 'internalFailure', [])

        expect(response.status).toBe(500)
        const result = await response.json()
        expect(result.code).toBe(RPCErrorCode.INTERNAL_ERROR)
        expect(result.message).toBe('Database connection failed')
      })
    })

    describe('error propagation', () => {
      it('should propagate error details in response', async () => {
        const target = {
          detailedError: () => {
            throw new RPCError(RPCErrorCode.CONFLICT, 'Resource conflict', {
              resourceId: '123',
              conflictType: 'duplicate',
            })
          },
        }
        const app = createTestApp(target)

        const response = await rpcCall(app, 'detailedError', [])

        expect(response.status).toBe(409)
        const result = await response.json()
        expect(result.code).toBe(RPCErrorCode.CONFLICT)
        expect(result.details?.resourceId).toBe('123')
        expect(result.details?.conflictType).toBe('duplicate')
      })

      it('should handle async method errors', async () => {
        const target = {
          asyncError: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
            throw new ValidationError('Async validation failed')
          },
        }
        const app = createTestApp(target)

        const response = await rpcCall(app, 'asyncError', [])

        expect(response.status).toBe(400)
        const result = await response.json()
        expect(result.code).toBe(RPCErrorCode.VALIDATION_ERROR)
      })

      it('should handle errors in nested method calls', async () => {
        const target = {
          outer: {
            inner: {
              fail: () => {
                throw new NotFoundError('Nested resource not found')
              },
            },
          },
        }
        const app = createTestApp(target)

        const response = await rpcCall(app, 'outer.inner.fail', [])

        expect(response.status).toBe(404)
        const result = await response.json()
        expect(result.code).toBe(RPCErrorCode.NOT_FOUND)
      })
    })
  })

  // ==========================================================================
  // MALFORMED REQUESTS
  // ==========================================================================

  describe('malformed requests', () => {
    it('should handle invalid JSON body', async () => {
      const target = { test: () => 'ok' }
      const app = createTestApp(target)

      const response = await rawRequest(app, 'not valid json')

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should handle missing method field', async () => {
      const target = { test: () => 'ok' }
      const app = createTestApp(target)

      const response = await rawRequest(app, { args: [] })

      // Method is undefined, will be treated as empty string
      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should handle missing args field', async () => {
      const target = {
        test: () => 'ok',
      }
      const app = createTestApp(target)

      // args defaults to undefined, spread with undefined works
      const response = await rawRequest(app, { method: 'test' })

      // Should either work or return an error
      // The handler uses args from body, undefined args will be treated as empty
      expect(response.status).toBeLessThan(500)
    })

    it('should handle empty body', async () => {
      const target = { test: () => 'ok' }
      const app = createTestApp(target)

      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      })
      const response = await app.fetch(request)

      // Empty body should fail to parse
      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should handle null body', async () => {
      const target = { test: () => 'ok' }
      const app = createTestApp(target)

      const response = await rawRequest(app, 'null')

      // null body should fail to access .method
      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  // ==========================================================================
  // HANDLER OPTIONS
  // ==========================================================================

  describe('handler options', () => {
    it('should use custom RPC path', async () => {
      const target = {
        test: () => 'success',
      }
      const app = createTestApp(target, { rpcPath: '/custom-rpc' })

      // Request to custom path should work
      const response = await rpcCall(app, 'test', [], '/custom-rpc')
      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe('success')
    })

    it('should not respond on default path when custom path is set', async () => {
      const target = {
        test: () => 'success',
      }
      const app = createTestApp(target, { rpcPath: '/custom-rpc' })

      // Request to default /rpc should return 404 (no route)
      const response = await rpcCall(app, 'test', [], '/rpc')
      expect(response.status).toBe(404)
    })

    it('should handle debug option without affecting behavior', async () => {
      const target = {
        test: () => 'success',
      }
      // Debug mode should not affect the response
      const app = createTestApp(target, { debug: true })

      const response = await rpcCall(app, 'test', [])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe('success')
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle method returning a Promise that resolves to undefined', async () => {
      const target = {
        voidMethod: async () => {
          // No return statement
        },
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'voidMethod', [])

      expect(response.status).toBe(200)
    })

    it('should handle method with very long name', async () => {
      const longName = 'a'.repeat(1000)
      const target = {
        [longName]: () => 'found',
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, longName, [])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe('found')
    })

    it('should handle deeply nested method paths', async () => {
      const target = {
        a: { b: { c: { d: { e: { method: () => 'deep' } } } } },
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'a.b.c.d.e.method', [])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe('deep')
    })

    it('should handle method with special characters in args', async () => {
      const target = {
        echo: (s: string) => s,
      }
      const app = createTestApp(target)

      const specialStr = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~'
      const response = await rpcCall(app, 'echo', [specialStr])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe(specialStr)
    })

    it('should handle unicode in arguments and responses', async () => {
      const target = {
        echo: (s: string) => s,
      }
      const app = createTestApp(target)

      const unicodeStr = 'Hello \u4e16\u754c \ud83d\ude00 \u00e9\u00e0\u00fc'
      const response = await rpcCall(app, 'echo', [unicodeStr])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe(unicodeStr)
    })

    it('should handle large payloads', async () => {
      const target = {
        processLarge: (data: { items: number[] }) => ({
          count: data.items.length,
          sum: data.items.reduce((a, b) => a + b, 0),
        }),
      }
      const app = createTestApp(target)

      const largeArray = Array.from({ length: 10000 }, (_, i) => i)
      const response = await rpcCall(app, 'processLarge', [{ items: largeArray }])

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result.count).toBe(10000)
      expect(result.sum).toBe(49995000) // Sum of 0..9999
    })

    it('should handle method that returns a function (functions are not JSON serializable)', async () => {
      const target = {
        getFunction: () => () => 'inner',
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'getFunction', [])

      expect(response.status).toBe(200)
      // Functions become undefined in JSON.stringify, and Hono returns empty body for undefined
      const text = await response.text()
      expect(text).toBe('')
    })

    it('should handle circular reference in response', async () => {
      const target = {
        getCircular: () => {
          const obj: Record<string, unknown> = { name: 'test' }
          obj['self'] = obj // Circular reference
          return obj
        },
      }
      const app = createTestApp(target)

      const response = await rpcCall(app, 'getCircular', [])

      // JSON.stringify throws on circular references
      expect(response.status).toBe(500)
    })
  })

  // ==========================================================================
  // HANDLER INTERFACE
  // ==========================================================================

  describe('DOHandler interface', () => {
    it('should have correct name property', () => {
      const handler = new RPCHandler()
      expect(handler.name).toBe('rpc')
    })

    it('should be instantiable with default options', () => {
      const handler = new RPCHandler()
      expect(handler).toBeInstanceOf(RPCHandler)
    })

    it('should be instantiable with custom options', () => {
      const handler = new RPCHandler({
        rpcPath: '/api/rpc',
        debug: true,
      })
      expect(handler).toBeInstanceOf(RPCHandler)
    })
  })
})
