/**
 * Type Tests for DO Mixins
 *
 * These tests verify compile-time type safety of the mixin pattern.
 * They ensure that:
 * 1. Mixins preserve base class types
 * 2. Mixins properly combine interface types
 * 3. Type helper utilities work correctly
 * 4. Constructor constraints are properly enforced
 *
 * @module do/tests/mixin-types.test
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  WithAuth,
  WithRPC,
  WithStorage,
  WithWebSocket,
  type Constructor,
  type HasAuth,
  type HasRPC,
  type HasStorage,
  type HasWebSocket,
  type HasDurableObjectState,
  type HasEnv,
  type MixinInstance,
  type InstanceOf,
  type RequiresMixin,
  WebSocketManager,
} from '../mixins'

// =============================================================================
// Test Base Classes
// =============================================================================

/**
 * Minimal base class for testing basic mixin application
 */
class MinimalBase {
  readonly name = 'MinimalBase'
}

/**
 * Base class with state property (simulates DurableObject)
 */
class DOLikeBase implements HasDurableObjectState {
  state?: DurableObjectState

  constructor(state?: DurableObjectState) {
    this.state = state
  }
}

/**
 * Base class with env property (simulates DurableObject with env)
 */
class DOWithEnvBase implements HasDurableObjectState, HasEnv {
  state?: DurableObjectState
  env?: unknown

  constructor(state?: DurableObjectState, env?: unknown) {
    this.state = state
    this.env = env
  }
}

/**
 * Base class with generic env type
 */
interface CustomEnv {
  DATABASE: DurableObjectNamespace
  AUTH_SECRET: string
}

class TypedEnvBase implements HasEnv<CustomEnv> {
  env?: CustomEnv

  constructor(env?: CustomEnv) {
    this.env = env
  }
}

// =============================================================================
// Constructor Type Tests
// =============================================================================

describe('Constructor Type', () => {
  it('should accept classes with no constructor args', () => {
    class NoArgs {}
    const ctor: Constructor<NoArgs> = NoArgs
    expect(ctor).toBeDefined()
  })

  it('should accept classes with typed constructor args', () => {
    class WithArgs {
      constructor(public name: string, public age: number) {}
    }
    const ctor: Constructor<WithArgs> = WithArgs
    expect(ctor).toBeDefined()
  })

  it('should be assignable from built-in constructors', () => {
    const objCtor: Constructor<object> = Object
    const arrCtor: Constructor<unknown[]> = Array
    expect(objCtor).toBeDefined()
    expect(arrCtor).toBeDefined()
  })
})

// =============================================================================
// Single Mixin Type Tests
// =============================================================================

describe('WithStorage Mixin Types', () => {
  it('should add HasStorage interface to base class', () => {
    const StorageDO = WithStorage(MinimalBase)
    const instance = new StorageDO()

    // Verify runtime properties
    expect(instance.things).toBeDefined()
    expect(instance.events).toBeDefined()
    expect(instance.relationships).toBeDefined()
    expect(instance.auditLogs).toBeDefined()
    expect(instance.name).toBe('MinimalBase')

    // Verify type includes HasStorage
    expectTypeOf(instance).toMatchTypeOf<HasStorage>()
    expectTypeOf(instance.things).not.toBeNever()
    expectTypeOf(instance.events).not.toBeNever()
    expectTypeOf(instance.relationships).not.toBeNever()
  })

  it('should preserve base class properties', () => {
    const StorageDO = WithStorage(MinimalBase)
    const instance = new StorageDO()

    expectTypeOf(instance.name).toBeString()
    expect(instance.name).toBe('MinimalBase')
  })
})

describe('WithAuth Mixin Types', () => {
  it('should add HasAuth interface to base class', () => {
    const AuthDO = WithAuth(MinimalBase)
    const instance = new AuthDO()

    // Verify runtime properties
    expect(instance.authGuard).toBeDefined()
    expect(typeof instance.validateCaller).toBe('function')
    expect(typeof instance.canAccess).toBe('function')
    expect(typeof instance.validateToken).toBe('function')
    expect(typeof instance.getCallerId).toBe('function')

    // Verify type includes HasAuth
    expectTypeOf(instance).toMatchTypeOf<HasAuth>()
  })

  it('should work with classes implementing HasDurableObjectState', () => {
    const AuthDO = WithAuth(DOLikeBase)
    const instance = new AuthDO()

    // Both base class and mixin properties should be available
    expectTypeOf(instance).toMatchTypeOf<HasAuth>()
    expect(instance.authGuard).toBeDefined()
  })
})

describe('WithRPC Mixin Types', () => {
  it('should add HasRPC interface to base class', () => {
    const RPCDO = WithRPC(MinimalBase)
    const instance = new RPCDO()

    // Verify runtime properties
    expect(typeof instance.getDOStub).toBe('function')
    expect(typeof instance.hasStub).toBe('function')
    expect(typeof instance.clearStub).toBe('function')
    expect(typeof instance.clearAllStubs).toBe('function')
    expect(typeof instance.getStubCount).toBe('function')

    // Verify type includes HasRPC
    expectTypeOf(instance).toMatchTypeOf<HasRPC>()
  })
})

describe('WithWebSocket Mixin Types', () => {
  it('should add HasWebSocket interface to base class', () => {
    const WebSocketDO = WithWebSocket(MinimalBase)
    const instance = new WebSocketDO()

    // Verify runtime properties
    expect(instance.ws).toBeDefined()
    expect(instance.ws).toBeInstanceOf(WebSocketManager)

    // Verify type includes HasWebSocket
    expectTypeOf(instance).toMatchTypeOf<HasWebSocket>()
    expectTypeOf(instance.ws).toMatchTypeOf<WebSocketManager>()
  })
})

// =============================================================================
// Mixin Composition Type Tests
// =============================================================================

describe('Mixin Composition Types', () => {
  it('should combine multiple mixin interfaces', () => {
    const ComposedDO = WithAuth(WithStorage(MinimalBase))
    const instance = new ComposedDO()

    // Should have both storage and auth capabilities
    expectTypeOf(instance).toMatchTypeOf<HasStorage>()
    expectTypeOf(instance).toMatchTypeOf<HasAuth>()

    // Runtime verification
    expect(instance.things).toBeDefined()
    expect(instance.authGuard).toBeDefined()
  })

  it('should compose all four mixins', () => {
    const FullDO = WithAuth(WithRPC(WithWebSocket(WithStorage(MinimalBase))))
    const instance = new FullDO()

    // Should have all capabilities
    expectTypeOf(instance).toMatchTypeOf<HasStorage>()
    expectTypeOf(instance).toMatchTypeOf<HasWebSocket>()
    expectTypeOf(instance).toMatchTypeOf<HasRPC>()
    expectTypeOf(instance).toMatchTypeOf<HasAuth>()

    // Runtime verification
    expect(instance.things).toBeDefined()
    expect(instance.ws).toBeDefined()
    expect(typeof instance.getDOStub).toBe('function')
    expect(instance.authGuard).toBeDefined()
  })

  it('should preserve base class type through composition', () => {
    const ComposedDO = WithAuth(WithStorage(MinimalBase))
    const instance = new ComposedDO()

    // Base class property should still be accessible
    expectTypeOf(instance.name).toBeString()
    expect(instance.name).toBe('MinimalBase')
  })
})

// =============================================================================
// Type Helper Tests
// =============================================================================

describe('MixinInstance Type Helper', () => {
  it('should extract instance type from mixin result', () => {
    const StorageDO = WithStorage(MinimalBase)
    type StorageInstance = MixinInstance<typeof StorageDO>

    // Create an instance and verify it matches the extracted type
    const instance: StorageInstance = new StorageDO()
    expectTypeOf(instance).toMatchTypeOf<HasStorage>()
  })
})

describe('InstanceOf Type Helper', () => {
  it('should extract instance type from constructor', () => {
    const ComposedDO = WithAuth(WithStorage(MinimalBase))
    type ComposedInstance = InstanceOf<typeof ComposedDO>

    const instance: ComposedInstance = new ComposedDO()

    // Verify the type has both mixin capabilities
    expectTypeOf(instance).toMatchTypeOf<HasStorage>()
    expectTypeOf(instance).toMatchTypeOf<HasAuth>()
  })
})

describe('RequiresMixin Type Helper', () => {
  it('should narrow type to require specific mixin', () => {
    type HasStorageClass = RequiresMixin<HasStorage & HasAuth, HasStorage>

    // This should compile - the type includes HasStorage
    const example: HasStorageClass = {
      things: {} as any,
      events: {} as any,
      relationships: {} as any,
      auditLogs: {} as any,
      setAuditContext: () => {},
      getAuditContext: () => ({ actor: 'system' }),
      query: () => ({} as any),
      authGuard: {} as any,
      validateCaller: async () => ({} as any),
      canAccess: async () => true,
      validateToken: async () => null,
      getCallerId: () => null,
    }

    expect(example.things).toBeDefined()
  })
})

// =============================================================================
// HasDurableObjectState and HasEnv Interface Tests
// =============================================================================

describe('HasDurableObjectState Interface', () => {
  it('should allow optional state property', () => {
    const obj: HasDurableObjectState = {}
    expect(obj.state).toBeUndefined()
  })

  it('should be compatible with DurableObjectState', () => {
    const mockState = {
      id: { toString: () => 'test-id' },
    } as DurableObjectState

    const obj: HasDurableObjectState = { state: mockState }
    expect(obj.state?.id?.toString()).toBe('test-id')
  })
})

describe('HasEnv Interface', () => {
  it('should allow optional env property', () => {
    const obj: HasEnv = {}
    expect(obj.env).toBeUndefined()
  })

  it('should support generic env type', () => {
    const obj: HasEnv<CustomEnv> = {
      env: {
        DATABASE: {} as DurableObjectNamespace,
        AUTH_SECRET: 'secret',
      },
    }

    expectTypeOf(obj.env).toMatchTypeOf<CustomEnv | undefined>()
    expect(obj.env?.AUTH_SECRET).toBe('secret')
  })
})

// =============================================================================
// Constructor Constraint Tests
// =============================================================================

describe('Constructor Constraints', () => {
  it('should accept any constructor for WithStorage', () => {
    // Basic class
    class Basic {}
    const StorageBasic = WithStorage(Basic)
    expect(new StorageBasic().things).toBeDefined()

    // Class with constructor args
    class WithArgs {
      constructor(public value: number) {}
    }
    const StorageWithArgs = WithStorage(WithArgs)
    const instance = new StorageWithArgs(42)
    expect(instance.things).toBeDefined()
  })

  it('should accept any constructor for WithAuth', () => {
    class Basic {}
    const AuthBasic = WithAuth(Basic)
    expect(new AuthBasic().authGuard).toBeDefined()
  })

  it('should accept any constructor for WithRPC', () => {
    class Basic {}
    const RPCBasic = WithRPC(Basic)
    expect(typeof new RPCBasic().getDOStub).toBe('function')
  })

  it('should accept any constructor for WithWebSocket', () => {
    class Basic {}
    const WSBasic = WithWebSocket(Basic)
    expect(new WSBasic().ws).toBeDefined()
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  it('should handle empty options', () => {
    const StorageDO = WithStorage(MinimalBase, {})
    const AuthDO = WithAuth(MinimalBase, {})
    const RPCDO = WithRPC(MinimalBase, {})
    const WSDO = WithWebSocket(MinimalBase, {})

    expect(new StorageDO().things).toBeDefined()
    expect(new AuthDO().authGuard).toBeDefined()
    expect(typeof new RPCDO().getDOStub).toBe('function')
    expect(new WSDO().ws).toBeDefined()
  })

  it('should handle deeply nested composition', () => {
    // 4 levels of mixin composition
    const Level1 = WithStorage(MinimalBase)
    const Level2 = WithWebSocket(Level1)
    const Level3 = WithRPC(Level2)
    const Level4 = WithAuth(Level3)

    const instance = new Level4()

    // All capabilities should be present
    expect(instance.things).toBeDefined()
    expect(instance.ws).toBeDefined()
    expect(typeof instance.getDOStub).toBe('function')
    expect(instance.authGuard).toBeDefined()
    expect(instance.name).toBe('MinimalBase')
  })

  it('should allow applying same mixin multiple times (idempotent)', () => {
    // While not recommended, this shouldn't break
    const DoubleMixin = WithStorage(WithStorage(MinimalBase))
    const instance = new DoubleMixin()

    // Should still work, just have one storage capability
    expect(instance.things).toBeDefined()
  })
})
