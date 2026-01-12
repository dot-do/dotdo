/**
 * @dotdo/client Build Output Export Tests
 *
 * Verifies that the package exports all expected functions and types.
 * Tests the source files with capnweb mocked (via vitest.shared.ts alias)
 * to avoid ESM/CJS issues in the Node test environment.
 *
 * The actual capnweb integration is tested in integration tests.
 */

import { describe, it, expect, afterEach } from 'vitest'

// Import from source - capnweb is aliased to a mock in vitest.shared.ts
import {
  $,
  $Context,
  configure,
  createClient,
  disposeSession,
  disposeAllSessions,
  type RpcClient,
  type RpcError,
  type RpcPromise,
  type ChainStep,
  type SdkConfig,
  type DOClient,
  type ClientConfig,
  type ConnectionState,
  type AuthConfig,
  type ReconnectConfig,
  type RPCError,
  type SubscriptionHandle,
  type PipelineStep,
} from '../src/index'

// Also test default export
import defaultExport from '../src/index'

describe('@dotdo/client build output exports', () => {
  afterEach(() => {
    // Clean up sessions after each test
    disposeAllSessions()
  })

  describe('function exports', () => {
    it('exports $ as a callable proxy', () => {
      expect($).toBeDefined()
      expect(typeof $).toBe('function')
    })

    it('exports $Context as a function', () => {
      expect($Context).toBeDefined()
      expect(typeof $Context).toBe('function')
    })

    it('exports configure as a function', () => {
      expect(configure).toBeDefined()
      expect(typeof configure).toBe('function')
    })

    it('exports createClient as a function (backwards compat)', () => {
      expect(createClient).toBeDefined()
      expect(typeof createClient).toBe('function')
    })

    it('exports disposeSession as a function', () => {
      expect(disposeSession).toBeDefined()
      expect(typeof disposeSession).toBe('function')
    })

    it('exports disposeAllSessions as a function', () => {
      expect(disposeAllSessions).toBeDefined()
      expect(typeof disposeAllSessions).toBe('function')
    })

    it('exports default as $ (alias)', () => {
      expect(defaultExport).toBeDefined()
      expect(defaultExport).toBe($)
    })
  })

  describe('function behavior', () => {
    it('$Context throws on empty namespace', () => {
      expect(() => $Context('')).toThrow('Namespace URL is required')
    })

    it('$Context creates a client for valid namespace', () => {
      const client = $Context('https://test.example.com')
      expect(client).toBeDefined()
    })

    it('$Context returns same session for same namespace (caching)', () => {
      const client1 = $Context('https://cache-test.example.com')
      const client2 = $Context('https://cache-test.example.com')
      expect(client1).toBe(client2)
    })

    it('$Context returns different sessions for different namespaces', () => {
      const client1 = $Context('https://ns1.example.com')
      const client2 = $Context('https://ns2.example.com')
      expect(client1).not.toBe(client2)
    })

    it('createClient works as alias for $Context', () => {
      const client = createClient('https://legacy.example.com')
      expect(client).toBeDefined()
    })

    it('createClient accepts config (ignored for backwards compat)', () => {
      const client = createClient('https://config.example.com', {
        timeout: 5000,
        batching: true,
      })
      expect(client).toBeDefined()
    })

    it('configure does not throw', () => {
      expect(() => configure({ namespace: 'https://configured.com' })).not.toThrow()
      expect(() => configure({ localUrl: 'http://localhost:3000' })).not.toThrow()
      expect(() => configure({ isDev: true })).not.toThrow()
    })

    it('disposeSession is safe for non-existent namespace', () => {
      expect(() => disposeSession('https://nonexistent.com')).not.toThrow()
    })

    it('disposeAllSessions clears cached sessions', () => {
      const client1 = $Context('https://clear1.example.com')
      const client2 = $Context('https://clear2.example.com')
      disposeAllSessions()
      const client3 = $Context('https://clear1.example.com')
      // After disposal, should get a new session
      expect(client1).not.toBe(client3)
    })
  })

  describe('$ proxy behavior', () => {
    it('$ can be called with namespace URL', () => {
      const client = $('https://proxy.example.com')
      expect(client).toBeDefined()
    })

    it('$ throws on invalid call', () => {
      // @ts-expect-error - testing runtime error for invalid call
      expect(() => $()).toThrow('$ must be called with a namespace URL or used as a property accessor')
    })

    it('$ property access returns proxy', () => {
      const customer = $.Customer
      expect(customer).toBeDefined()
    })

    it('$ supports chained property access', () => {
      const email = $.Customer.profile.email
      expect(email).toBeDefined()
    })

    it('$ supports method-like calls', () => {
      const result = $.Customer('alice')
      expect(result).toBeDefined()
    })

    it('$ has Symbol.dispose', () => {
      const dispose = $[Symbol.dispose]
      expect(typeof dispose).toBe('function')
    })
  })

  describe('RpcClient shape', () => {
    it('client has onRpcBroken method', () => {
      const client = $Context('https://shape.example.com')
      expect(typeof client.onRpcBroken).toBe('function')
    })

    it('client has Symbol.dispose', () => {
      const client = $Context('https://dispose.example.com')
      expect(typeof client[Symbol.dispose]).toBe('function')
    })
  })

  describe('type exports (compile-time verification)', () => {
    // These tests verify types are exported and usable at compile time
    // They create objects of the expected shape to verify types work

    it('RpcClient type is usable', () => {
      const client: RpcClient = $Context('https://type1.example.com')
      expect(client).toBeDefined()
    })

    it('SdkConfig type is usable', () => {
      const config: SdkConfig = {
        namespace: 'https://example.com',
        localUrl: 'http://localhost:8787',
        isDev: false,
      }
      expect(config.namespace).toBe('https://example.com')
    })

    it('ChainStep type is usable', () => {
      const step: ChainStep = {
        type: 'property',
        key: 'test',
      }
      expect(step.type).toBe('property')
    })

    it('ConnectionState type is usable', () => {
      const state: ConnectionState = 'connected'
      expect(state).toBe('connected')
    })

    it('ClientConfig type is usable', () => {
      const config: ClientConfig = {
        timeout: 5000,
        batchWindow: 10,
        maxBatchSize: 100,
      }
      expect(config.timeout).toBe(5000)
    })

    it('DOClient type is usable', () => {
      const client: DOClient<{ foo(): void }> = $Context('https://type2.example.com')
      expect(client).toBeDefined()
    })

    it('RpcError type is usable', () => {
      const error: RpcError = {
        code: 'TEST_ERROR',
        message: 'Test error message',
      }
      expect(error.code).toBe('TEST_ERROR')
    })

    it('AuthConfig type is usable', () => {
      const auth: AuthConfig = {
        token: 'test-token',
      }
      expect(auth.token).toBe('test-token')
    })

    it('ReconnectConfig type is usable', () => {
      const reconnect: ReconnectConfig = {
        maxAttempts: 3,
        baseDelay: 1000,
      }
      expect(reconnect.maxAttempts).toBe(3)
    })

    it('RPCError type is usable (legacy)', () => {
      const error: RPCError = {
        code: 'ERR',
        message: 'Error',
        stage: 1,
      }
      expect(error.stage).toBe(1)
    })

    it('SubscriptionHandle type is usable', () => {
      const handle: SubscriptionHandle = {
        unsubscribe: () => {},
      }
      expect(typeof handle.unsubscribe).toBe('function')
    })

    it('PipelineStep type is usable', () => {
      const step: PipelineStep = {
        method: 'test',
        params: [1, 2, 3],
      }
      expect(step.method).toBe('test')
    })

    it('RpcPromise type is usable', () => {
      // RpcPromise is a combined type - just verify it compiles
      const _promise: RpcPromise<string> = $Context('https://promise.example.com') as RpcPromise<string>
      expect(true).toBe(true) // Compile-time check passed
    })
  })
})
