/**
 * Capability Infrastructure Tests (RED TDD)
 *
 * These tests verify the capability infrastructure in DOBase.
 * Tests should FAIL initially until the infrastructure is implemented.
 *
 * The capability infrastructure enables:
 * - Opt-in capabilities via withX(Base) pattern
 * - Capability detection via hasCapability()
 * - Lazy initialization of capability APIs
 * - Type-safe $ context extensions
 *
 * @see dotdo-t2jsn issue for requirements
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// These imports will FAIL until infrastructure is implemented
import {
  createCapability,
  type Constructor,
  type CapabilityInit,
  type CapabilityMixin,
} from '../capabilities/infrastructure'

import { DO } from '../DOBase'
import type { WorkflowContext } from '../../types/WorkflowContext'

// ============================================================================
// MOCK DO STATE & ENV
// ============================================================================

/**
 * Minimal mock DurableObjectState for testing
 */
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: {
      toString: () => 'mock-do-id-123',
      name: 'test-do',
      equals: () => false,
    },
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => storage.set(key, value)),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async () => new Map()),
      deleteAll: vi.fn(),
      getAlarm: vi.fn(async () => null),
      setAlarm: vi.fn(),
      deleteAlarm: vi.fn(),
      sync: vi.fn(),
      transaction: vi.fn(),
      transactionSync: vi.fn(),
      getCurrentBookmark: vi.fn(),
      getBookmarkForTime: vi.fn(),
      onNextSessionRestoreBookmark: vi.fn(),
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
    abort: vi.fn(),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
    setWebSocketAutoResponse: vi.fn(),
    getWebSocketAutoResponse: vi.fn(),
    getWebSocketAutoResponseTimestamp: vi.fn(),
    setHibernatableWebSocketEventTimeout: vi.fn(),
    getHibernatableWebSocketEventTimeout: vi.fn(),
    getTags: vi.fn(() => []),
  } as unknown as DurableObjectState
}

/**
 * Minimal mock environment for testing
 */
function createMockEnv() {
  return {
    DO: {
      idFromName: vi.fn(),
      get: vi.fn(),
    },
  }
}

// ============================================================================
// TEST CAPABILITY APIS
// ============================================================================

/**
 * Simple test capability API for testing mixin composition
 */
interface TestCapabilityA {
  getValue(): number
  increment(): void
}

/**
 * Another test capability API
 */
interface TestCapabilityB {
  getMessage(): string
  setMessage(msg: string): void
}

/**
 * Lazy-initialized capability API
 */
interface LazyCapability {
  value: number
}

// ============================================================================
// TRACKING HELPERS
// ============================================================================

/**
 * Track initialization for lazy loading tests
 */
const initializationTracker = {
  capabilityA: { initialized: false, count: 0 },
  capabilityB: { initialized: false, count: 0 },
  lazy: { initialized: false, count: 0 },
}

function resetTracker() {
  initializationTracker.capabilityA = { initialized: false, count: 0 }
  initializationTracker.capabilityB = { initialized: false, count: 0 }
  initializationTracker.lazy = { initialized: false, count: 0 }
}

// ============================================================================
// TESTS: hasCapability()
// ============================================================================

describe('Capability Infrastructure', () => {
  beforeEach(() => {
    resetTracker()
  })

  describe('hasCapability()', () => {
    it('returns false for unregistered capabilities', () => {
      const state = createMockState()
      const env = createMockEnv()
      const doInstance = new DO(state, env as any)

      // DOBase should have hasCapability method
      expect(typeof (doInstance as any).hasCapability).toBe('function')
      expect((doInstance as any).hasCapability('fs')).toBe(false)
      expect((doInstance as any).hasCapability('git')).toBe(false)
      expect((doInstance as any).hasCapability('bash')).toBe(false)
      expect((doInstance as any).hasCapability('nonexistent')).toBe(false)
    })

    it('hasCapability is available on DOBase class instances', () => {
      const state = createMockState()
      const env = createMockEnv()
      const doInstance = new DO(state, env as any)

      // Should be a method, not undefined
      expect((doInstance as any).hasCapability).toBeDefined()
    })
  })

  // ==========================================================================
  // TESTS: Capability adds capability to $ context
  // ==========================================================================

  describe('Capability adds capability to $ context', () => {
    it('capability adds capability to $ context', () => {
      // Create a test capability using createCapability
      const withTestA = createCapability<'testA', TestCapabilityA>(
        'testA',
        () => {
          initializationTracker.capabilityA.initialized = true
          initializationTracker.capabilityA.count++
          let value = 0
          return {
            getValue: () => value,
            increment: () => { value++ },
          }
        }
      )

      // Apply mixin to DO
      const TestDO = withTestA(DO)
      const state = createMockState()
      const env = createMockEnv()
      const doInstance = new TestDO(state, env as any)

      // Should have the capability registered
      expect((doInstance as any).hasCapability('testA')).toBe(true)

      // Should have $.testA available
      expect((doInstance.$ as any).testA).toBeDefined()
    })

    it('capability API methods are callable', () => {
      const withTestA = createCapability<'testA', TestCapabilityA>(
        'testA',
        () => {
          let value = 0
          return {
            getValue: () => value,
            increment: () => { value++ },
          }
        }
      )

      const TestDO = withTestA(DO)
      const state = createMockState()
      const env = createMockEnv()
      const doInstance = new TestDO(state, env as any)

      const testA = (doInstance.$ as any).testA as TestCapabilityA

      expect(testA.getValue()).toBe(0)
      testA.increment()
      expect(testA.getValue()).toBe(1)
    })
  })

  // ==========================================================================
  // TESTS: Capabilities compose in correct order
  // ==========================================================================

  describe('Capabilities compose in correct order', () => {
    it('withB(withA(DOBase)) has both capabilities', () => {
      // Create two capabilities
      const withA = createCapability<'a', TestCapabilityA>(
        'a',
        () => {
          initializationTracker.capabilityA.initialized = true
          let value = 0
          return {
            getValue: () => value,
            increment: () => { value++ },
          }
        }
      )

      const withB = createCapability<'b', TestCapabilityB>(
        'b',
        () => {
          initializationTracker.capabilityB.initialized = true
          let message = 'hello'
          return {
            getMessage: () => message,
            setMessage: (msg: string) => { message = msg },
          }
        }
      )

      // Compose: withB(withA(DOBase))
      const ComposedDO = withB(withA(DO))
      const state = createMockState()
      const env = createMockEnv()
      const doInstance = new ComposedDO(state, env as any)

      // Both capabilities should be registered
      expect((doInstance as any).hasCapability('a')).toBe(true)
      expect((doInstance as any).hasCapability('b')).toBe(true)

      // Both should be accessible on $ context
      expect((doInstance.$ as any).a).toBeDefined()
      expect((doInstance.$ as any).b).toBeDefined()
    })

    it('static capabilities array contains all capability names', () => {
      const withA = createCapability<'a', TestCapabilityA>(
        'a',
        () => ({ getValue: () => 0, increment: () => {} })
      )

      const withB = createCapability<'b', TestCapabilityB>(
        'b',
        () => ({ getMessage: () => '', setMessage: () => {} })
      )

      const ComposedDO = withB(withA(DO))

      // Static capabilities array should contain both
      expect((ComposedDO as any).capabilities).toBeDefined()
      expect((ComposedDO as any).capabilities).toContain('a')
      expect((ComposedDO as any).capabilities).toContain('b')
    })

    it('composition order does not affect capability availability', () => {
      const withA = createCapability<'a', TestCapabilityA>(
        'a',
        () => ({ getValue: () => 0, increment: () => {} })
      )

      const withB = createCapability<'b', TestCapabilityB>(
        'b',
        () => ({ getMessage: () => '', setMessage: () => {} })
      )

      // Different composition order
      const AB = withB(withA(DO))
      const BA = withA(withB(DO))

      const stateAB = createMockState()
      const stateBA = createMockState()
      const env = createMockEnv()

      const instanceAB = new AB(stateAB, env as any)
      const instanceBA = new BA(stateBA, env as any)

      // Both should have both capabilities regardless of order
      expect((instanceAB as any).hasCapability('a')).toBe(true)
      expect((instanceAB as any).hasCapability('b')).toBe(true)
      expect((instanceBA as any).hasCapability('a')).toBe(true)
      expect((instanceBA as any).hasCapability('b')).toBe(true)
    })
  })

  // ==========================================================================
  // TESTS: Capability initialization is lazy
  // ==========================================================================

  describe('Capability initialization is lazy', () => {
    it('capability is NOT initialized on DO construction', () => {
      const withLazy = createCapability<'lazy', LazyCapability>(
        'lazy',
        () => {
          initializationTracker.lazy.initialized = true
          initializationTracker.lazy.count++
          return { value: 42 }
        }
      )

      const LazyDO = withLazy(DO)
      const state = createMockState()
      const env = createMockEnv()

      // Just constructing should NOT trigger initialization
      const doInstance = new LazyDO(state, env as any)

      expect(initializationTracker.lazy.initialized).toBe(false)
      expect(initializationTracker.lazy.count).toBe(0)
    })

    it('capability is initialized on first $ property access', () => {
      const withLazy = createCapability<'lazy', LazyCapability>(
        'lazy',
        () => {
          initializationTracker.lazy.initialized = true
          initializationTracker.lazy.count++
          return { value: 42 }
        }
      )

      const LazyDO = withLazy(DO)
      const state = createMockState()
      const env = createMockEnv()
      const doInstance = new LazyDO(state, env as any)

      // Not initialized yet
      expect(initializationTracker.lazy.initialized).toBe(false)

      // Access the capability
      const lazy = (doInstance.$ as any).lazy
      expect(lazy).toBeDefined()

      // Now it should be initialized
      expect(initializationTracker.lazy.initialized).toBe(true)
      expect(initializationTracker.lazy.count).toBe(1)
    })

    it('capability is cached after first initialization', () => {
      const withLazy = createCapability<'lazy', LazyCapability>(
        'lazy',
        () => {
          initializationTracker.lazy.count++
          return { value: 42 }
        }
      )

      const LazyDO = withLazy(DO)
      const state = createMockState()
      const env = createMockEnv()
      const doInstance = new LazyDO(state, env as any)

      // Access multiple times
      const lazy1 = (doInstance.$ as any).lazy
      const lazy2 = (doInstance.$ as any).lazy
      const lazy3 = (doInstance.$ as any).lazy

      // Should only initialize once
      expect(initializationTracker.lazy.count).toBe(1)

      // Should return same instance
      expect(lazy1).toBe(lazy2)
      expect(lazy2).toBe(lazy3)
    })

    it('accessing one capability does not initialize others', () => {
      const withA = createCapability<'a', TestCapabilityA>(
        'a',
        () => {
          initializationTracker.capabilityA.initialized = true
          initializationTracker.capabilityA.count++
          return { getValue: () => 0, increment: () => {} }
        }
      )

      const withB = createCapability<'b', TestCapabilityB>(
        'b',
        () => {
          initializationTracker.capabilityB.initialized = true
          initializationTracker.capabilityB.count++
          return { getMessage: () => '', setMessage: () => {} }
        }
      )

      const ComposedDO = withB(withA(DO))
      const state = createMockState()
      const env = createMockEnv()
      const doInstance = new ComposedDO(state, env as any)

      // Access only capability A
      const _a = (doInstance.$ as any).a

      // Only A should be initialized
      expect(initializationTracker.capabilityA.initialized).toBe(true)
      expect(initializationTracker.capabilityB.initialized).toBe(false)
    })
  })

  // ==========================================================================
  // TESTS: WorkflowContext type includes capability extensions
  // ==========================================================================

  describe('WorkflowContext type includes capability extensions', () => {
    it('typed capability access compiles correctly (type-level test)', () => {
      // This is primarily a compile-time test
      // If this test file compiles, the types are working

      const withTyped = createCapability<'typed', { greet: (name: string) => string }>(
        'typed',
        () => ({
          greet: (name: string) => `Hello, ${name}!`,
        })
      )

      const TypedDO = withTyped(DO)
      const state = createMockState()
      const env = createMockEnv()
      const doInstance = new TypedDO(state, env as any)

      // Type inference should work
      const typed = (doInstance.$ as any).typed
      const greeting: string = typed.greet('World')

      expect(greeting).toBe('Hello, World!')
    })

    it('base WorkflowContext methods remain accessible', () => {
      const withTest = createCapability<'test', { value: number }>(
        'test',
        () => ({ value: 42 })
      )

      const TestDO = withTest(DO)
      const state = createMockState()
      const env = createMockEnv()
      const doInstance = new TestDO(state, env as any)

      // Base $ methods should still be accessible
      expect(typeof doInstance.$.send).toBe('function')
      expect(typeof doInstance.$.try).toBe('function')
      expect(typeof doInstance.$.do).toBe('function')
      expect(doInstance.$.on).toBeDefined()
      expect(doInstance.$.every).toBeDefined()
    })
  })

  // ==========================================================================
  // TESTS: createCapability helper
  // ==========================================================================

  describe('createCapability helper', () => {
    it('returns a valid capability function', () => {
      const capability = createCapability('test', () => ({ hello: () => 'world' }))

      expect(typeof capability).toBe('function')
    })

    it('capability function accepts a class constructor', () => {
      const capability = createCapability('test', () => ({ value: 1 }))

      // Should not throw
      const ExtendedClass = capability(DO)
      expect(ExtendedClass).toBeDefined()
      expect(typeof ExtendedClass).toBe('function')
    })

    it('returned class can be instantiated', () => {
      const capability = createCapability('test', () => ({ value: 1 }))
      const ExtendedClass = capability(DO)

      const state = createMockState()
      const env = createMockEnv()

      // Should not throw
      const instance = new ExtendedClass(state, env as any)
      expect(instance).toBeDefined()
    })

    it('init function receives context with state, env, and $', () => {
      let receivedContext: any = null

      const capability = createCapability('test', (ctx) => {
        receivedContext = ctx
        return { value: 1 }
      })

      const ExtendedClass = capability(DO)
      const state = createMockState()
      const env = createMockEnv()
      const instance = new ExtendedClass(state, env as any)

      // Access capability to trigger init
      const _ = (instance.$ as any).test

      expect(receivedContext).not.toBeNull()
      expect(receivedContext.state).toBeDefined()
      expect(receivedContext.env).toBeDefined()
      expect(receivedContext.$).toBeDefined()
    })
  })

  // ==========================================================================
  // TESTS: Edge cases and robustness
  // ==========================================================================

  describe('Edge cases', () => {
    it('same capability applied twice is idempotent', () => {
      const withTest = createCapability<'test', { value: number }>(
        'test',
        () => {
          initializationTracker.lazy.count++
          return { value: 42 }
        }
      )

      // Apply twice
      const DoubleMixin = withTest(withTest(DO))
      const state = createMockState()
      const env = createMockEnv()
      const instance = new DoubleMixin(state, env as any)

      // Access capability
      const test = (instance.$ as any).test

      // Should only have one 'test' capability, initialized once
      expect(test.value).toBe(42)
      expect(initializationTracker.lazy.count).toBe(1)
    })

    it('capability with same name in different definitions uses last applied', () => {
      const withTestV1 = createCapability<'test', { version: number }>(
        'test',
        () => ({ version: 1 })
      )

      const withTestV2 = createCapability<'test', { version: number }>(
        'test',
        () => ({ version: 2 })
      )

      // V2 applied last
      const Mixed = withTestV2(withTestV1(DO))
      const state = createMockState()
      const env = createMockEnv()
      const instance = new Mixed(state, env as any)

      // Should use V2 (last applied)
      expect((instance.$ as any).test.version).toBe(2)
    })

    it('capability preserves constructor signature', () => {
      const withTest = createCapability('test', () => ({ value: 1 }))
      const ExtendedClass = withTest(DO)

      // Should still require state and env
      const state = createMockState()
      const env = createMockEnv()
      const instance = new ExtendedClass(state, env as any)

      expect(instance).toBeInstanceOf(DO)
    })

    it('capability can access other capabilities via $', () => {
      const withFirst = createCapability<'first', { getValue: () => number }>(
        'first',
        () => ({ getValue: () => 100 })
      )

      const withSecond = createCapability<'second', { getDoubled: () => number }>(
        'second',
        (ctx) => ({
          getDoubled: () => {
            // Access first capability through ctx.$
            const first = (ctx.$ as any).first
            return first ? first.getValue() * 2 : 0
          },
        })
      )

      const ComposedDO = withSecond(withFirst(DO))
      const state = createMockState()
      const env = createMockEnv()
      const instance = new ComposedDO(state, env as any)

      // Access second which uses first internally
      const second = (instance.$ as any).second
      expect(second.getDoubled()).toBe(200)
    })
  })

  // ==========================================================================
  // TESTS: Subclassing
  // ==========================================================================

  describe('Subclassing', () => {
    it('custom DO subclass can use capabilities', () => {
      const withTest = createCapability<'test', { value: number }>(
        'test',
        () => ({ value: 42 })
      )

      // Custom subclass
      class MyCustomDO extends DO {
        customMethod() {
          return 'custom'
        }
      }

      const ExtendedCustom = withTest(MyCustomDO)
      const state = createMockState()
      const env = createMockEnv()
      const instance = new ExtendedCustom(state, env as any)

      // Custom method should work
      expect(instance.customMethod()).toBe('custom')

      // Capability should work
      expect((instance as any).hasCapability('test')).toBe(true)
      expect((instance.$ as any).test.value).toBe(42)
    })

    it('can extend capability-enhanced class', () => {
      const withTest = createCapability<'test', { value: number }>(
        'test',
        () => ({ value: 42 })
      )

      const MixedDO = withTest(DO)

      // Extend the mixed class
      class FurtherExtended extends MixedDO {
        furtherMethod() {
          return 'further'
        }
      }

      const state = createMockState()
      const env = createMockEnv()
      const instance = new FurtherExtended(state, env as any)

      // Both should work
      expect(instance.furtherMethod()).toBe('further')
      expect((instance as any).hasCapability('test')).toBe(true)
    })
  })
})

// ============================================================================
// TYPE-LEVEL TESTS
// ============================================================================

/**
 * These tests verify type-level behavior.
 * They primarily check that the types compile correctly.
 */
describe('Type-level tests', () => {
  it('createCapability has correct type signature', () => {
    // If this compiles, the type signature is correct
    type CapabilityFn = typeof createCapability

    // Should accept name and init function
    const _: CapabilityFn = createCapability
    expect(_).toBeDefined()
  })

  it('Constructor type is correctly defined', () => {
    // Constructor type should accept any class constructor
    type TestConstructor = Constructor<{ test: string }>
    const _: TestConstructor = class { test = 'value' }
    expect(_).toBeDefined()
  })

  it('CapabilityInit type is correctly defined', () => {
    // CapabilityInit should be a function receiving context and returning API
    const init: CapabilityInit<{ value: number }> = (ctx) => ({ value: 1 })
    expect(init).toBeDefined()
    expect(typeof init).toBe('function')
  })

  it('CapabilityMixin type is correctly defined', () => {
    // CapabilityMixin should be a function that transforms a class
    const capability = createCapability('test', () => ({ v: 1 }))
    const _: CapabilityMixin<'test', { v: number }> = capability
    expect(_).toBeDefined()
  })
})
