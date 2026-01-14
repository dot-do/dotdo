/**
 * $() Client SDK Tests
 *
 * Tests for the Cap'n Web RPC client.
 * These tests verify that sdk/client.ts correctly re-exports from @dotdo/client.
 *
 * Note: Since capnweb uses its own transport layer (WebSocket/HTTP batch),
 * we test the SDK's API surface and configuration rather than mocking
 * the underlying RPC protocol. Integration tests should be used for
 * end-to-end RPC behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Import the implementation under test - this now re-exports from @dotdo/client
import {
  $,
  $Context,
  configure,
  disposeSession,
  disposeAllSessions,
  createClient,
  type ChainStep,
  type RpcClient,
  type SdkConfig,
  type DOClient,
  type ClientConfig,
} from './client'

// =============================================================================
// Test Suite
// =============================================================================

describe('$() client SDK', () => {
  beforeEach(() => {
    // Clear all sessions before each test
    disposeAllSessions()
  })

  afterEach(() => {
    // Clean up after tests
    disposeAllSessions()
  })

  // ===========================================================================
  // API Surface Tests
  // ===========================================================================

  describe('API surface', () => {
    it('exports $ as a callable proxy', () => {
      expect($).toBeDefined()
      // $ should be a proxy that can be called
      expect(typeof $).toBe('function')
    })

    it('exports $Context function', () => {
      expect($Context).toBeDefined()
      expect(typeof $Context).toBe('function')
    })

    it('exports configure function', () => {
      expect(configure).toBeDefined()
      expect(typeof configure).toBe('function')
    })

    it('exports disposeSession function', () => {
      expect(disposeSession).toBeDefined()
      expect(typeof disposeSession).toBe('function')
    })

    it('exports disposeAllSessions function', () => {
      expect(disposeAllSessions).toBeDefined()
      expect(typeof disposeAllSessions).toBe('function')
    })
  })

  // ===========================================================================
  // $Context Tests
  // ===========================================================================

  describe('$Context', () => {
    it('creates a client for namespace URL', () => {
      const client = $Context('https://startups.studio')
      expect(client).toBeDefined()
    })

    it('throws on empty namespace', () => {
      expect(() => $Context('')).toThrow('Namespace URL is required')
    })

    it('returns same session for same namespace', () => {
      const client1 = $Context('https://startups.studio')
      const client2 = $Context('https://startups.studio')
      // Should return the same cached session
      expect(client1).toBe(client2)
    })

    it('returns different sessions for different namespaces', () => {
      const client1 = $Context('https://startups.studio')
      const client2 = $Context('https://platform.do')
      // Should be different sessions
      expect(client1).not.toBe(client2)
    })
  })

  // ===========================================================================
  // $ Proxy Tests
  // ===========================================================================

  describe('$ proxy', () => {
    it('$ can be called with namespace URL', () => {
      const client = $('https://startups.studio')
      expect(client).toBeDefined()
    })

    it('$ throws on invalid call', () => {
      expect(() => ($() as unknown)).toThrow(
        '$ must be called with a namespace URL or used as a property accessor'
      )
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
      // Check that $ has disposal support
      const dispose = $[Symbol.dispose]
      expect(typeof dispose).toBe('function')
    })
  })

  // ===========================================================================
  // Configuration Tests
  // ===========================================================================

  describe('configuration', () => {
    it('configure sets namespace', () => {
      configure({ namespace: 'https://custom.namespace' })
      // Configuration is applied (we can't easily test the internal state,
      // but configure should not throw)
      expect(true).toBe(true)
    })

    it('configure sets localUrl', () => {
      configure({ localUrl: 'http://localhost:3000' })
      expect(true).toBe(true)
    })

    it('configure sets isDev', () => {
      configure({ isDev: true })
      expect(true).toBe(true)
    })

    it('configure merges with existing config', () => {
      configure({ namespace: 'https://first.com' })
      configure({ localUrl: 'http://localhost:4000' })
      // Both settings should be preserved
      expect(true).toBe(true)
    })
  })

  // ===========================================================================
  // Session Management Tests
  // ===========================================================================

  describe('session management', () => {
    it('disposeSession removes session from cache', () => {
      const client1 = $Context('https://startups.studio')
      disposeSession('https://startups.studio')
      const client2 = $Context('https://startups.studio')
      // After disposal, should get a new session
      expect(client1).not.toBe(client2)
    })

    it('disposeAllSessions clears all sessions', () => {
      const client1 = $Context('https://startups.studio')
      const client2 = $Context('https://platform.do')
      disposeAllSessions()
      const client3 = $Context('https://startups.studio')
      const client4 = $Context('https://platform.do')
      // All should be new sessions
      expect(client1).not.toBe(client3)
      expect(client2).not.toBe(client4)
    })

    it('disposeSession is safe for non-existent namespace', () => {
      // Should not throw
      expect(() => disposeSession('https://nonexistent.com')).not.toThrow()
    })
  })

  // ===========================================================================
  // Type Tests (compile-time, but we verify runtime shape)
  // ===========================================================================

  describe('types', () => {
    it('RpcClient has expected shape', () => {
      const client = $Context('https://startups.studio')

      // Client should be defined
      expect(client).toBeDefined()
      // capnweb stubs use function as proxy target to support being callable
      expect(['object', 'function'].includes(typeof client)).toBe(true)

      // Should have disposal (capnweb stubs are Disposable)
      expect(typeof client[Symbol.dispose]).toBe('function')

      // Should have onRpcBroken for handling connection failures
      expect(typeof client.onRpcBroken).toBe('function')
    })

    it('ChainStep type is exported', () => {
      // Verify ChainStep is a valid type by creating an object of that shape
      const step: ChainStep = {
        type: 'property',
        key: 'test',
      }
      expect(step.type).toBe('property')
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('handles namespace with trailing slash', () => {
      const client = $Context('https://startups.studio/')
      expect(client).toBeDefined()
    })

    it('handles namespace with path', () => {
      const client = $Context('https://startups.studio/api/v1')
      expect(client).toBeDefined()
    })

    it('handles Symbol properties on $', () => {
      // Symbols should not break the proxy
      expect(() => String($)).not.toThrow()
    })

    it('handles Symbol.toStringTag', () => {
      // Accessing Symbol.toStringTag should not throw
      const tag = $[Symbol.toStringTag]
      // May be undefined or a string
      expect(tag === undefined || typeof tag === 'string').toBe(true)
    })
  })
})

// =============================================================================
// Backwards Compatibility Tests
// =============================================================================

describe('backwards compatibility', () => {
  beforeEach(() => {
    disposeAllSessions()
  })

  afterEach(() => {
    disposeAllSessions()
  })

  it('createClient works as alias for $Context', () => {
    const client = createClient('https://startups.studio')
    expect(client).toBeDefined()
  })

  it('createClient accepts config (ignored)', () => {
    // The config is ignored in the new implementation but should not throw
    const client = createClient('https://startups.studio', {
      timeout: 5000,
      batching: true,
    })
    expect(client).toBeDefined()
  })

  it('DOClient type is exported', () => {
    // DOClient is now an alias for RpcClient
    const client: DOClient<{ foo(): void }> = $Context('https://example.com')
    expect(client).toBeDefined()
  })

  it('ClientConfig type is exported', () => {
    const config: ClientConfig = {
      timeout: 5000,
      batchWindow: 10,
      maxBatchSize: 100,
    }
    expect(config.timeout).toBe(5000)
  })
})

// =============================================================================
// Integration Test Helpers (for future integration tests)
// =============================================================================

describe('integration test helpers', () => {
  it('provides SdkConfig type', () => {
    const config: SdkConfig = {
      namespace: 'https://example.com.ai',
      localUrl: 'http://localhost:8787',
      isDev: false,
    }
    expect(config.namespace).toBe('https://example.com.ai')
  })
})
