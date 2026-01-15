/**
 * WorkerDO RPC Interface Mixin Tests
 *
 * TDD tests for the RPC mixin that adds rpcCall() capabilities to any Durable Object.
 * The mixin pattern allows flexible composition with existing DO classes.
 *
 * Uses RpcHandler base class for testing core logic without DurableObject runtime dependency.
 * Production code should use RpcWorkerDO or withRpcMethods(DurableObject).
 */

import { describe, it, expect, vi } from 'vitest'
import {
  withRpcMethods,
  RpcHandler,
  RpcError,
  RPC_ERROR_CODES,
} from '../worker-rpc'
import {
  CallMessage,
  ReturnMessage,
  ErrorMessage,
  isReturnMessage,
  isErrorMessage,
  generateBrokerMessageId,
} from '../broker-protocol'

// =============================================================================
// Test Base Classes (using RpcHandler for testability)
// =============================================================================

/**
 * Simple base class for testing the mixin pattern
 */
class TestBase {
  // Base class with no special requirements
}

describe('WorkerDO RPC', () => {
  describe('Direct Stub Methods', () => {
    it('should expose rpcCall() method on class', () => {
      // Create a class with the mixin
      class TestClass extends TestBase {
        testMethod(arg: string): string {
          return `result: ${arg}`
        }
      }

      const RpcEnabledClass = withRpcMethods(TestClass)
      const instance = new RpcEnabledClass()

      // Verify rpcCall is exposed
      expect(typeof instance.rpcCall).toBe('function')
    })

    it('should dispatch to correct internal method', async () => {
      class TestClass extends TestBase {
        greet(name: string): string {
          return `Hello, ${name}!`
        }

        add(a: number, b: number): number {
          return a + b
        }
      }

      const RpcEnabledClass = withRpcMethods(TestClass)
      const instance = new RpcEnabledClass()

      // Call greet method
      const greetResult = await instance.rpcCall('greet', ['World'])
      expect(greetResult).toBe('Hello, World!')

      // Call add method
      const addResult = await instance.rpcCall('add', [5, 3])
      expect(addResult).toBe(8)
    })

    it('should return typed results', async () => {
      interface UserData {
        id: string
        name: string
        email: string
      }

      class UserClass extends TestBase {
        getUser(id: string): UserData {
          return { id, name: 'Alice', email: 'alice@example.com' }
        }

        getUserIds(): string[] {
          return ['u1', 'u2', 'u3']
        }
      }

      const RpcEnabledClass = withRpcMethods(UserClass)
      const instance = new RpcEnabledClass()

      // Object result
      const user = (await instance.rpcCall('getUser', ['u123'])) as UserData
      expect(user).toEqual({ id: 'u123', name: 'Alice', email: 'alice@example.com' })

      // Array result
      const ids = (await instance.rpcCall('getUserIds', [])) as string[]
      expect(ids).toEqual(['u1', 'u2', 'u3'])
    })

    it('should throw on unknown method', async () => {
      class TestClass extends TestBase {
        validMethod(): string {
          return 'ok'
        }
      }

      const RpcEnabledClass = withRpcMethods(TestClass)
      const instance = new RpcEnabledClass()

      await expect(instance.rpcCall('nonExistentMethod', [])).rejects.toThrow(RpcError)
      await expect(instance.rpcCall('nonExistentMethod', [])).rejects.toThrow('Method not found: nonExistentMethod')
    })

    it('should handle async methods', async () => {
      class AsyncClass extends TestBase {
        async fetchData(id: string): Promise<{ id: string; data: string }> {
          // Simulate async operation
          await new Promise((resolve) => setTimeout(resolve, 10))
          return { id, data: 'fetched data' }
        }
      }

      const RpcEnabledClass = withRpcMethods(AsyncClass)
      const instance = new RpcEnabledClass()

      const result = await instance.rpcCall('fetchData', ['id123'])
      expect(result).toEqual({ id: 'id123', data: 'fetched data' })
    })

    it('should propagate errors from method execution', async () => {
      class ErrorClass extends TestBase {
        throwError(): never {
          throw new Error('Something went wrong')
        }
      }

      const RpcEnabledClass = withRpcMethods(ErrorClass)
      const instance = new RpcEnabledClass()

      await expect(instance.rpcCall('throwError', [])).rejects.toThrow('Something went wrong')
    })
  })

  describe('Capability Verification', () => {
    it('should verify capability before executing', async () => {
      class SecureClass extends RpcHandler {
        private validTokens = new Set(['valid-token-123'])

        sensitiveOperation(): string {
          return 'sensitive data'
        }

        // Override to implement actual verification
        protected verifyCapability(token: string): void {
          if (!this.validTokens.has(token)) {
            throw new RpcError(
              `Invalid capability token: ${token}`,
              RPC_ERROR_CODES.CAPABILITY_INVALID
            )
          }
        }
      }

      const instance = new SecureClass()

      // Valid capability should work
      const result = await instance.rpcCall('sensitiveOperation', [], 'valid-token-123')
      expect(result).toBe('sensitive data')

      // Invalid capability should fail
      await expect(instance.rpcCall('sensitiveOperation', [], 'invalid-token')).rejects.toThrow(
        RpcError
      )
    })

    it('should reject invalid capability', async () => {
      class SecureClass extends RpcHandler {
        getData(): string {
          return 'data'
        }

        protected verifyCapability(token: string): void {
          if (token !== 'correct-capability') {
            throw new RpcError('Unauthorized', RPC_ERROR_CODES.CAPABILITY_INVALID)
          }
        }
      }

      const instance = new SecureClass()

      await expect(instance.rpcCall('getData', [], 'wrong-capability')).rejects.toThrow(RpcError)
      await expect(instance.rpcCall('getData', [], 'wrong-capability')).rejects.toThrow(
        'Unauthorized'
      )
    })

    it('should allow call without capability if not required', async () => {
      class OpenClass extends RpcHandler {
        publicMethod(): string {
          return 'public result'
        }

        // Default verifyCapability does nothing (no-op)
      }

      const instance = new OpenClass()

      // Call without capability should succeed
      const result = await instance.rpcCall('publicMethod', [])
      expect(result).toBe('public result')
    })

    it('should call verifyCapability hook when capability provided', async () => {
      const verifyMock = vi.fn()

      class HookedClass extends RpcHandler {
        getData(): string {
          return 'data'
        }

        protected verifyCapability(token: string): void {
          verifyMock(token)
        }
      }

      const instance = new HookedClass()

      await instance.rpcCall('getData', [], 'my-capability')

      expect(verifyMock).toHaveBeenCalledWith('my-capability')
      expect(verifyMock).toHaveBeenCalledTimes(1)
    })

    it('should not call verifyCapability when no capability provided', async () => {
      const verifyMock = vi.fn()

      class HookedClass extends RpcHandler {
        getData(): string {
          return 'data'
        }

        protected verifyCapability(token: string): void {
          verifyMock(token)
        }
      }

      const instance = new HookedClass()

      await instance.rpcCall('getData', [])

      expect(verifyMock).not.toHaveBeenCalled()
    })
  })

  describe('fetch-based RPC', () => {
    it('should handle /rpc POST endpoint', async () => {
      class TestClass extends RpcHandler {
        multiply(a: number, b: number): number {
          return a * b
        }
      }

      const instance = new TestClass()

      const callMessage: CallMessage = {
        id: generateBrokerMessageId(),
        type: 'call',
        target: 'test-do',
        method: 'multiply',
        args: [6, 7],
      }

      const request = new Request('https://test.api.dotdo.dev/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(callMessage),
      })

      const response = await instance.handleRpcFetch(request)
      expect(response.status).toBe(200)
    })

    it('should parse CallMessage from body', async () => {
      class TestClass extends RpcHandler {
        echo(message: string): string {
          return message
        }
      }

      const instance = new TestClass()

      const callMessage: CallMessage = {
        id: 'msg_123',
        type: 'call',
        target: 'test-do',
        method: 'echo',
        args: ['Hello RPC'],
      }

      const request = new Request('https://test.api.dotdo.dev/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(callMessage),
      })

      const response = await instance.handleRpcFetch(request)
      const result = (await response.json()) as ReturnMessage

      expect(isReturnMessage(result)).toBe(true)
      expect(result.value).toBe('Hello RPC')
      expect(result.id).toBe('msg_123')
    })

    it('should return ReturnMessage JSON', async () => {
      class TestClass extends RpcHandler {
        getConfig(): { version: string; debug: boolean } {
          return { version: '1.0.0', debug: true }
        }
      }

      const instance = new TestClass()

      const callMessage: CallMessage = {
        id: 'call_config',
        type: 'call',
        target: 'config-do',
        method: 'getConfig',
        args: [],
      }

      const request = new Request('https://test.api.dotdo.dev/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(callMessage),
      })

      const response = await instance.handleRpcFetch(request)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const result = (await response.json()) as ReturnMessage

      expect(result.type).toBe('return')
      expect(result.id).toBe('call_config')
      expect(result.value).toEqual({ version: '1.0.0', debug: true })
    })

    it('should return ErrorMessage on method not found', async () => {
      class TestClass extends RpcHandler {}

      const instance = new TestClass()

      const callMessage: CallMessage = {
        id: 'call_missing',
        type: 'call',
        target: 'test-do',
        method: 'missingMethod',
        args: [],
      }

      const request = new Request('https://test.api.dotdo.dev/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(callMessage),
      })

      const response = await instance.handleRpcFetch(request)
      expect(response.status).toBe(200) // RPC errors return 200 with error in body

      const result = (await response.json()) as ErrorMessage

      expect(isErrorMessage(result)).toBe(true)
      expect(result.type).toBe('error')
      expect(result.id).toBe('call_missing')
      expect(result.error).toContain('Method not found')
      expect(result.code).toBe(RPC_ERROR_CODES.METHOD_NOT_FOUND)
    })

    it('should return ErrorMessage on capability failure', async () => {
      class SecureClass extends RpcHandler {
        sensitiveData(): string {
          return 'secret'
        }

        protected verifyCapability(_token: string): void {
          throw new RpcError('Invalid capability', RPC_ERROR_CODES.CAPABILITY_INVALID)
        }
      }

      const instance = new SecureClass()

      const callMessage: CallMessage = {
        id: 'call_secure',
        type: 'call',
        target: 'secure-do',
        method: 'sensitiveData',
        args: [],
        capability: 'bad-token',
      }

      const request = new Request('https://test.api.dotdo.dev/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(callMessage),
      })

      const response = await instance.handleRpcFetch(request)
      const result = (await response.json()) as ErrorMessage

      expect(isErrorMessage(result)).toBe(true)
      expect(result.code).toBe(RPC_ERROR_CODES.CAPABILITY_INVALID)
    })

    it('should handle malformed request body', async () => {
      class TestClass extends RpcHandler {}

      const instance = new TestClass()

      const request = new Request('https://test.api.dotdo.dev/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{',
      })

      const response = await instance.handleRpcFetch(request)
      const result = (await response.json()) as ErrorMessage

      expect(isErrorMessage(result)).toBe(true)
      expect(result.code).toBe(RPC_ERROR_CODES.INVALID_REQUEST)
    })

    it('should handle invalid CallMessage structure', async () => {
      class TestClass extends RpcHandler {}

      const instance = new TestClass()

      const request = new Request('https://test.api.dotdo.dev/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'not-a-call', foo: 'bar' }),
      })

      const response = await instance.handleRpcFetch(request)
      const result = (await response.json()) as ErrorMessage

      expect(isErrorMessage(result)).toBe(true)
      expect(result.code).toBe(RPC_ERROR_CODES.INVALID_REQUEST)
    })
  })

  describe('RpcHandler Standalone Class', () => {
    it('should be directly usable without mixin', async () => {
      // Create a subclass of RpcHandler
      class MyHandler extends RpcHandler {
        processData(input: string): string {
          return `processed: ${input}`
        }
      }

      const instance = new MyHandler()

      const result = await instance.rpcCall('processData', ['test input'])
      expect(result).toBe('processed: test input')
    })

    it('should allow capability verification override', async () => {
      class SecureHandler extends RpcHandler {
        private allowedTokens = new Set(['token-abc'])

        getData(): string {
          return 'secure data'
        }

        protected verifyCapability(token: string): void {
          if (!this.allowedTokens.has(token)) {
            throw new RpcError('Unauthorized access', RPC_ERROR_CODES.CAPABILITY_INVALID)
          }
        }
      }

      const instance = new SecureHandler()

      // Valid token
      const result = await instance.rpcCall('getData', [], 'token-abc')
      expect(result).toBe('secure data')

      // Invalid token
      await expect(instance.rpcCall('getData', [], 'token-xyz')).rejects.toThrow(RpcError)
    })
  })

  describe('RpcError', () => {
    it('should include error code', () => {
      const error = new RpcError('Test error', RPC_ERROR_CODES.METHOD_NOT_FOUND)

      expect(error.message).toBe('Test error')
      expect(error.code).toBe(RPC_ERROR_CODES.METHOD_NOT_FOUND)
      expect(error.name).toBe('RpcError')
    })

    it('should be instanceof Error', () => {
      const error = new RpcError('Test', RPC_ERROR_CODES.INTERNAL_ERROR)

      expect(error instanceof Error).toBe(true)
      expect(error instanceof RpcError).toBe(true)
    })

    it('should support all error codes', () => {
      expect(RPC_ERROR_CODES.METHOD_NOT_FOUND).toBe('METHOD_NOT_FOUND')
      expect(RPC_ERROR_CODES.CAPABILITY_INVALID).toBe('CAPABILITY_INVALID')
      expect(RPC_ERROR_CODES.INTERNAL_ERROR).toBe('INTERNAL_ERROR')
      expect(RPC_ERROR_CODES.INVALID_REQUEST).toBe('INVALID_REQUEST')
    })
  })

  describe('Edge Cases', () => {
    it('should handle methods that return undefined', async () => {
      class TestClass extends RpcHandler {
        voidMethod(): void {
          // Does nothing, returns undefined
        }
      }

      const instance = new TestClass()

      const result = await instance.rpcCall('voidMethod', [])
      expect(result).toBeUndefined()
    })

    it('should handle methods that return null', async () => {
      class TestClass extends RpcHandler {
        nullMethod(): null {
          return null
        }
      }

      const instance = new TestClass()

      const result = await instance.rpcCall('nullMethod', [])
      expect(result).toBeNull()
    })

    it('should handle methods with many arguments', async () => {
      class TestClass extends RpcHandler {
        manyArgs(a: number, b: number, c: number, d: number, e: number): number {
          return a + b + c + d + e
        }
      }

      const instance = new TestClass()

      const result = await instance.rpcCall('manyArgs', [1, 2, 3, 4, 5])
      expect(result).toBe(15)
    })

    it('should preserve this context in methods', async () => {
      class StatefulClass extends RpcHandler {
        private counter = 0

        increment(): number {
          this.counter++
          return this.counter
        }

        getCount(): number {
          return this.counter
        }
      }

      const instance = new StatefulClass()

      await instance.rpcCall('increment', [])
      await instance.rpcCall('increment', [])
      const count = await instance.rpcCall('getCount', [])

      expect(count).toBe(2)
    })

    it('should reject attempts to call non-function properties', async () => {
      class TestClass extends RpcHandler {
        someProperty = 'not a function'
      }

      const instance = new TestClass()

      // Note: 'someProperty' exists but is not a function
      // The mixin should check if it's callable
      await expect(instance.rpcCall('someProperty', [])).rejects.toThrow()
    })
  })

  describe('withRpcMethods Mixin', () => {
    it('should add RPC methods to any class', () => {
      class BaseClass {
        baseMethod(): string {
          return 'base'
        }
      }

      const RpcClass = withRpcMethods(BaseClass)
      const instance = new RpcClass()

      // Should have rpcCall
      expect(typeof instance.rpcCall).toBe('function')
      // Should have handleRpcFetch
      expect(typeof instance.handleRpcFetch).toBe('function')
      // Should preserve base method
      expect(instance.baseMethod()).toBe('base')
    })

    it('should work with classes that have constructor args', () => {
      class ConfigurableClass {
        constructor(public name: string, public value: number) {}

        getConfig(): { name: string; value: number } {
          return { name: this.name, value: this.value }
        }
      }

      const RpcClass = withRpcMethods(ConfigurableClass)
      const instance = new RpcClass('test', 42)

      expect(instance.name).toBe('test')
      expect(instance.value).toBe(42)
    })

    it('should allow mixin to be used with async methods', async () => {
      class AsyncClass {
        async delayedResult(delay: number): Promise<string> {
          await new Promise((resolve) => setTimeout(resolve, delay))
          return 'done'
        }
      }

      const RpcClass = withRpcMethods(AsyncClass)
      const instance = new RpcClass()

      const result = await instance.rpcCall('delayedResult', [10])
      expect(result).toBe('done')
    })
  })
})
