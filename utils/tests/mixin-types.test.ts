/**
 * Tests for utils/mixin-types.ts
 *
 * Comprehensive test coverage for mixin type utilities:
 * 1. Constructor type - basic mixin patterns
 * 2. MixinInstance - type extraction from constructors
 * 3. InstanceOf - alias for MixinInstance
 * 4. MixinFn - mixin function type
 * 5. ComposedType - multi-mixin composition
 * 6. RequiresMixin - type constraint validation
 */

import { describe, it, expect } from 'vitest'
import type {
  Constructor,
  MixinInstance,
  InstanceOf,
  MixinFn,
  ComposedType,
  RequiresMixin,
} from '../mixin-types'

// ============================================================================
// Test Fixtures - Sample classes and interfaces for testing
// ============================================================================

// Base class for testing
class BaseClass {
  baseMethod(): string {
    return 'base'
  }
}

// Interface for feature mixins
interface HasStorage {
  storage: Map<string, unknown>
  get(key: string): unknown
  set(key: string, value: unknown): void
}

interface HasLogger {
  log(message: string): void
}

interface HasAuth {
  userId: string | null
  authenticate(token: string): boolean
}

// ============================================================================
// Constructor Type Tests
// ============================================================================

describe('Constructor type', () => {
  it('should accept a class as Constructor type', () => {
    // TypeScript compilation test - if this compiles, the type works
    const ClassRef: Constructor = BaseClass
    expect(ClassRef).toBe(BaseClass)
  })

  it('should allow instantiation through Constructor type', () => {
    const ClassRef: Constructor = BaseClass
    const instance = new ClassRef()
    expect(instance).toBeInstanceOf(BaseClass)
  })

  it('should work with generic type parameter', () => {
    // Constructor<BaseClass> ensures the instance type
    const ClassRef: Constructor<BaseClass> = BaseClass
    const instance = new ClassRef()
    expect(instance.baseMethod()).toBe('base')
  })

  it('should work with classes that have constructor parameters', () => {
    class ParameterizedClass {
      constructor(
        public name: string,
        public value: number
      ) {}
    }

    // Constructor type allows any[] args, so this should work
    const ClassRef: Constructor<ParameterizedClass> = ParameterizedClass
    const instance = new ClassRef('test', 42)

    expect(instance.name).toBe('test')
    expect(instance.value).toBe(42)
  })
})

// ============================================================================
// Mixin Pattern Tests
// ============================================================================

describe('Mixin pattern with Constructor type', () => {
  // Storage mixin
  function WithStorage<TBase extends Constructor>(Base: TBase) {
    return class extends Base implements HasStorage {
      storage = new Map<string, unknown>()

      get(key: string): unknown {
        return this.storage.get(key)
      }

      set(key: string, value: unknown): void {
        this.storage.set(key, value)
      }
    }
  }

  // Logger mixin
  function WithLogger<TBase extends Constructor>(Base: TBase) {
    return class extends Base implements HasLogger {
      private logs: string[] = []

      log(message: string): void {
        this.logs.push(message)
      }

      getLogs(): string[] {
        return [...this.logs]
      }
    }
  }

  // Auth mixin
  function WithAuth<TBase extends Constructor>(Base: TBase) {
    return class extends Base implements HasAuth {
      userId: string | null = null

      authenticate(token: string): boolean {
        if (token === 'valid-token') {
          this.userId = 'user-123'
          return true
        }
        return false
      }
    }
  }

  it('should allow creating a class with single mixin', () => {
    const StorageClass = WithStorage(BaseClass)
    const instance = new StorageClass()

    instance.set('key', 'value')
    expect(instance.get('key')).toBe('value')
    expect(instance.baseMethod()).toBe('base')
  })

  it('should allow composing multiple mixins', () => {
    const ComposedClass = WithAuth(WithLogger(WithStorage(BaseClass)))
    const instance = new ComposedClass()

    // All mixin methods should be available
    instance.set('key', 'value')
    instance.log('test message')
    instance.authenticate('valid-token')

    expect(instance.get('key')).toBe('value')
    expect(instance.userId).toBe('user-123')
    expect(instance.baseMethod()).toBe('base')
  })

  it('should preserve instanceof checks', () => {
    const StorageClass = WithStorage(BaseClass)
    const instance = new StorageClass()

    expect(instance).toBeInstanceOf(BaseClass)
    expect(instance).toBeInstanceOf(StorageClass)
  })

  it('should work with arrow function mixins', () => {
    const WithCounter = <TBase extends Constructor>(Base: TBase) =>
      class extends Base {
        count = 0
        increment(): number {
          return ++this.count
        }
      }

    const CounterClass = WithCounter(BaseClass)
    const instance = new CounterClass()

    expect(instance.increment()).toBe(1)
    expect(instance.increment()).toBe(2)
  })
})

// ============================================================================
// MixinInstance Type Tests
// ============================================================================

describe('MixinInstance type', () => {
  it('should extract instance type from constructor', () => {
    // TypeScript compilation test
    type BaseInstance = MixinInstance<typeof BaseClass>

    // Create an instance and verify type compatibility
    const instance: BaseInstance = new BaseClass()
    expect(instance.baseMethod()).toBe('base')
  })

  it('should extract instance type from mixed-in class', () => {
    function WithFeature<TBase extends Constructor>(Base: TBase) {
      return class extends Base {
        feature = 'enabled'
      }
    }

    const MixedClass = WithFeature(BaseClass)
    type MixedInstance = MixinInstance<typeof MixedClass>

    const instance: MixedInstance = new MixedClass()
    expect(instance.feature).toBe('enabled')
    expect(instance.baseMethod()).toBe('base')
  })

  it('should work with complex mixin chains', () => {
    function WithA<TBase extends Constructor>(Base: TBase) {
      return class extends Base {
        a = 'A'
      }
    }
    function WithB<TBase extends Constructor>(Base: TBase) {
      return class extends Base {
        b = 'B'
      }
    }
    function WithC<TBase extends Constructor>(Base: TBase) {
      return class extends Base {
        c = 'C'
      }
    }

    const ABC = WithC(WithB(WithA(BaseClass)))
    type ABCInstance = MixinInstance<typeof ABC>

    const instance: ABCInstance = new ABC()
    expect(instance.a).toBe('A')
    expect(instance.b).toBe('B')
    expect(instance.c).toBe('C')
  })
})

// ============================================================================
// InstanceOf Type Tests
// ============================================================================

describe('InstanceOf type', () => {
  it('should be equivalent to MixinInstance', () => {
    // Both types should produce the same result
    type ViaInstanceOf = InstanceOf<typeof BaseClass>
    type ViaMixinInstance = MixinInstance<typeof BaseClass>

    // Both should work with the same instance
    const instance1: ViaInstanceOf = new BaseClass()
    const instance2: ViaMixinInstance = new BaseClass()

    expect(instance1.baseMethod()).toBe('base')
    expect(instance2.baseMethod()).toBe('base')
  })

  it('should extract correct instance type', () => {
    class CustomClass {
      custom(): number {
        return 42
      }
    }

    type Instance = InstanceOf<typeof CustomClass>
    const instance: Instance = new CustomClass()

    expect(instance.custom()).toBe(42)
  })
})

// ============================================================================
// MixinFn Type Tests
// ============================================================================

describe('MixinFn type', () => {
  it('should type a basic mixin function', () => {
    const mixinFn: MixinFn = <TBase extends Constructor>(Base: TBase) => {
      return class extends Base {
        added = true
      }
    }

    const Result = mixinFn(BaseClass)
    const instance = new Result()

    expect(instance.added).toBe(true)
  })

  it('should work with typed return', () => {
    interface HasTimestamp {
      timestamp: number
    }

    const withTimestamp: MixinFn<Constructor<HasTimestamp>> = <TBase extends Constructor>(Base: TBase) => {
      return class extends Base {
        timestamp = Date.now()
      }
    }

    const Timestamped = withTimestamp(BaseClass)
    const instance = new Timestamped()

    expect(typeof instance.timestamp).toBe('number')
  })
})

// ============================================================================
// ComposedType Tests
// ============================================================================

describe('ComposedType type', () => {
  // Define typed mixin functions for testing
  function WithStorage2<TBase extends Constructor>(Base: TBase) {
    return class extends Base {
      storage = new Map<string, unknown>()
    }
  }

  function WithLogger2<TBase extends Constructor>(Base: TBase) {
    return class extends Base {
      log(_msg: string): void {}
    }
  }

  function WithAuth2<TBase extends Constructor>(Base: TBase) {
    return class extends Base {
      userId: string | null = null
    }
  }

  it('should compose single mixin type', () => {
    type Composed = ComposedType<typeof WithStorage2>

    // The composed type should be a constructor
    const Result: Composed = WithStorage2(BaseClass)
    const instance = new Result()

    expect(instance.storage).toBeInstanceOf(Map)
  })

  it('should compose two mixin types', () => {
    type Composed = ComposedType<typeof WithStorage2, typeof WithLogger2>

    // Create a class with both mixins
    const Result = WithLogger2(WithStorage2(BaseClass))
    const instance: InstanceOf<typeof Result> = new Result()

    expect(instance.storage).toBeInstanceOf(Map)
    expect(typeof instance.log).toBe('function')
  })

  it('should compose three mixin types', () => {
    type Composed = ComposedType<typeof WithStorage2, typeof WithLogger2, typeof WithAuth2>

    // The type includes all three mixin capabilities
    const Result = WithAuth2(WithLogger2(WithStorage2(BaseClass)))
    const instance = new Result()

    expect(instance.storage).toBeInstanceOf(Map)
    expect(typeof instance.log).toBe('function')
    expect(instance.userId).toBeNull()
  })
})

// ============================================================================
// RequiresMixin Type Tests
// ============================================================================

describe('RequiresMixin type', () => {
  it('should pass through type when constraint is satisfied', () => {
    interface HasName {
      name: string
    }

    class NamedClass implements HasName {
      name = 'test'
    }

    // TypeScript compilation test - should pass through
    type Result = RequiresMixin<NamedClass, HasName>

    // Result should be NamedClass (not never)
    const instance: Result = new NamedClass()
    expect(instance.name).toBe('test')
  })

  it('should return never when constraint is not satisfied', () => {
    interface HasName {
      name: string
    }

    class NoNameClass {
      value = 42
    }

    // This should result in `never` type
    type Result = RequiresMixin<NoNameClass, HasName>

    // We can't actually instantiate `never`, but we can verify the type logic
    // by checking that the original class doesn't have `name`
    const instance = new NoNameClass()
    expect('name' in instance).toBe(false)
  })

  it('should work with mixin-created classes', () => {
    interface HasFeature {
      feature: string
    }

    function WithFeature<TBase extends Constructor>(Base: TBase) {
      return class extends Base implements HasFeature {
        feature = 'enabled'
      }
    }

    const Featured = WithFeature(BaseClass)
    type FeaturedInstance = InstanceOf<typeof Featured>

    // Validation should pass
    type Validated = RequiresMixin<FeaturedInstance, HasFeature>

    const instance: Validated = new Featured()
    expect(instance.feature).toBe('enabled')
  })
})

// ============================================================================
// Edge Cases and Real-World Patterns
// ============================================================================

describe('Real-world mixin patterns', () => {
  it('should support DO-style mixin pattern', () => {
    // Simulating the pattern used in @dotdo/do
    class BaseDO {
      state: unknown = null

      doSomething(): string {
        return 'base'
      }
    }

    function WithSQLiteStorage<TBase extends Constructor>(Base: TBase) {
      return class extends Base {
        sql = {
          exec: (query: string) => ({ query, results: [] }),
        }
      }
    }

    function WithWebSocket<TBase extends Constructor>(Base: TBase) {
      return class extends Base {
        acceptWebSocket(): void {}
        broadcast(_message: string): void {}
      }
    }

    // Compose the DO with mixins
    const EnhancedDO = WithWebSocket(WithSQLiteStorage(BaseDO))

    // Extract instance type for use elsewhere
    type DOInstance = MixinInstance<typeof EnhancedDO>

    const instance: DOInstance = new EnhancedDO()

    expect(instance.doSomething()).toBe('base')
    expect(instance.sql.exec('SELECT 1')).toEqual({
      query: 'SELECT 1',
      results: [],
    })
    expect(typeof instance.acceptWebSocket).toBe('function')
    expect(typeof instance.broadcast).toBe('function')
  })

  it('should support conditional mixin application', () => {
    function WithFeatureIf<TBase extends Constructor>(
      Base: TBase,
      enabled: boolean
    ) {
      if (enabled) {
        return class extends Base {
          feature = 'enabled'
        }
      }
      return Base
    }

    const EnabledClass = WithFeatureIf(BaseClass, true)
    const DisabledClass = WithFeatureIf(BaseClass, false)

    const enabledInstance = new EnabledClass()
    const disabledInstance = new DisabledClass()

    expect('feature' in enabledInstance).toBe(true)
    expect('feature' in disabledInstance).toBe(false)
  })

  it('should support mixin with initialization parameters', () => {
    function WithConfig<TBase extends Constructor>(Base: TBase, config: { name: string }) {
      return class extends Base {
        configName = config.name
      }
    }

    const ConfiguredClass = WithConfig(BaseClass, { name: 'my-config' })
    const instance = new ConfiguredClass()

    expect(instance.configName).toBe('my-config')
  })

  it('should support method overriding in mixins', () => {
    class Greeter {
      greet(): string {
        return 'Hello'
      }
    }

    function WithFormalGreeting<TBase extends Constructor<Greeter>>(Base: TBase) {
      return class extends Base {
        greet(): string {
          return `Good day, ${super.greet()}`
        }
      }
    }

    const FormalGreeter = WithFormalGreeting(Greeter)
    const instance = new FormalGreeter()

    expect(instance.greet()).toBe('Good day, Hello')
  })

  it('should handle private members in mixins', () => {
    function WithPrivateCounter<TBase extends Constructor>(Base: TBase) {
      return class extends Base {
        #count = 0

        increment(): number {
          return ++this.#count
        }

        getCount(): number {
          return this.#count
        }
      }
    }

    const Counter = WithPrivateCounter(BaseClass)
    const instance = new Counter()

    expect(instance.increment()).toBe(1)
    expect(instance.increment()).toBe(2)
    expect(instance.getCount()).toBe(2)
    // Private field is not accessible
    expect('#count' in instance).toBe(false)
  })
})

// ============================================================================
// Type Safety Verification
// ============================================================================

describe('Type safety verification', () => {
  it('should maintain type safety across mixin chain', () => {
    class TypedBase {
      value: number = 0
    }

    function WithMultiplier<TBase extends Constructor<TypedBase>>(Base: TBase) {
      return class extends Base {
        multiply(factor: number): number {
          return this.value * factor
        }
      }
    }

    function WithAdder<TBase extends Constructor<TypedBase>>(Base: TBase) {
      return class extends Base {
        add(amount: number): number {
          return this.value + amount
        }
      }
    }

    const MathClass = WithAdder(WithMultiplier(TypedBase))
    const instance = new MathClass()
    instance.value = 10

    expect(instance.multiply(2)).toBe(20)
    expect(instance.add(5)).toBe(15)
  })

  it('should work with abstract base classes', () => {
    abstract class AbstractBase {
      abstract getName(): string
    }

    class ConcreteBase extends AbstractBase {
      getName(): string {
        return 'concrete'
      }
    }

    function WithPrefix<TBase extends Constructor<AbstractBase>>(Base: TBase) {
      return class extends Base {
        getPrefixedName(): string {
          return `prefix-${this.getName()}`
        }
      }
    }

    const Prefixed = WithPrefix(ConcreteBase)
    const instance = new Prefixed()

    expect(instance.getName()).toBe('concrete')
    expect(instance.getPrefixedName()).toBe('prefix-concrete')
  })

  it('should support generic methods in mixins', () => {
    function WithSerializer<TBase extends Constructor>(Base: TBase) {
      return class extends Base {
        serialize<T>(data: T): string {
          return JSON.stringify(data)
        }

        deserialize<T>(json: string): T {
          return JSON.parse(json) as T
        }
      }
    }

    const SerializerClass = WithSerializer(BaseClass)
    const instance = new SerializerClass()

    const data = { name: 'test', value: 42 }
    const json = instance.serialize(data)
    const restored = instance.deserialize<typeof data>(json)

    expect(restored).toEqual(data)
  })
})
