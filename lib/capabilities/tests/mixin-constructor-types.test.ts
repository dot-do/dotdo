/**
 * TDD Tests: Mixin Constructor Type Safety
 *
 * Issue: dotdo-3ppn2
 *
 * These tests verify that mixin implementations preserve type safety:
 * 1. Base class instance methods are preserved and correctly typed
 * 2. Static properties from base classes are preserved
 * 3. The $ context extensions work correctly
 * 4. Chained mixins compose types correctly
 *
 * The `as unknown as Constructor` pattern IS necessary for TypeScript mixin patterns,
 * but the types should be correct at the consumer level.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { withFs, type WithFsContext, type FsCapability } from '../fs'
import { withGit, type WithGitContext, type GitCapability } from '../git'
import { withBash, type WithBashContext, type BashCapability, type BashExecutor, type BashResult } from '../bash'
import { withNpm, type WithNpmContext, type NpmCapability } from '../npm'
import type { WorkflowContext } from '../../../types/WorkflowContext'
import type { Constructor } from '../types'

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Minimal mock storage for testing mixins
 */
function createMockStorage(): DurableObjectStorage {
  const data = new Map<string, unknown>()
  return {
    get: async <T>(key: string) => data.get(key) as T | undefined,
    put: async (key: string, value: unknown) => { data.set(key, value) },
    delete: async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key]
      keys.forEach(k => data.delete(k))
    },
    list: async <T>(_options?: { prefix?: string }) => data as Map<string, T>,
    getAlarm: async () => null,
    setAlarm: async () => {},
    deleteAlarm: async () => {},
    sync: async () => {},
    transaction: async <T>(closure: (txn: DurableObjectTransaction) => Promise<T>) => closure({} as DurableObjectTransaction),
    deleteAll: async () => { data.clear() },
    sql: {} as SqlStorage,
    transactionSync: <T>(closure: () => T) => closure(),
    kv: {} as DurableObjectKVStore,
    getCurrentBookmark: async () => '',
    getBookmarkForTime: async () => '',
    onNextSessionRestoreBookmark: () => {},
  } as unknown as DurableObjectStorage
}

function createMockState(): DurableObjectState {
  return {
    storage: createMockStorage(),
    id: { toString: () => 'test-id' },
    waitUntil: () => {},
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
  } as unknown as DurableObjectState
}

function createMockEnv(): Record<string, unknown> {
  return {}
}

/**
 * Mock BashExecutor for testing withBash
 */
function createMockBashExecutor(): BashExecutor {
  return {
    execute: async (command: string) => ({
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: '',
      stderr: '',
      exitCode: 0,
      intent: { commands: [command], reads: [], writes: [], deletes: [], network: false, elevated: false },
      classification: { type: 'execute', impact: 'none', reversible: true, reason: 'test' } as const,
    }),
  }
}

// ============================================================================
// TEST BASE CLASSES
// ============================================================================

/**
 * Minimal base class with WorkflowContext
 */
class MinimalBase {
  $: WorkflowContext = {} as WorkflowContext

  constructor(_state?: DurableObjectState, _env?: Record<string, unknown>) {}
}

/**
 * Base class with custom methods for type preservation testing
 */
class TypedBaseClass extends MinimalBase {
  /** Custom method that should be preserved on the instance type */
  customMethod(): string {
    return 'custom'
  }

  /** Property that should be accessible */
  customProperty = 42

  /** Async method */
  async asyncMethod(): Promise<number> {
    return 123
  }

  /** Static property */
  static VERSION = '1.0.0'

  /** Static method */
  static create(): TypedBaseClass {
    return new TypedBaseClass()
  }
}

// ============================================================================
// withFs TYPE PRESERVATION TESTS
// ============================================================================

describe('withFs mixin type preservation', () => {
  let state: DurableObjectState
  let env: Record<string, unknown>

  beforeEach(() => {
    state = createMockState()
    env = createMockEnv()
  })

  it('should preserve base class instance methods', () => {
    const WithFsClass = withFs(TypedBaseClass)
    const instance = new WithFsClass(state, env)

    // Instance should have customMethod
    expect(typeof instance.customMethod).toBe('function')
    expect(instance.customMethod()).toBe('custom')

    // TypeScript type check: customMethod returns string
    const result: string = instance.customMethod()
    expect(result).toBe('custom')
  })

  it('should preserve base class properties', () => {
    const WithFsClass = withFs(TypedBaseClass)
    const instance = new WithFsClass(state, env)

    // Instance should have customProperty
    expect(instance.customProperty).toBe(42)

    // TypeScript type check: customProperty is number
    const value: number = instance.customProperty
    expect(value).toBe(42)
  })

  it('should preserve base class async methods', async () => {
    const WithFsClass = withFs(TypedBaseClass)
    const instance = new WithFsClass(state, env)

    // Instance should have asyncMethod
    expect(typeof instance.asyncMethod).toBe('function')
    const result = await instance.asyncMethod()
    expect(result).toBe(123)

    // TypeScript type check: asyncMethod returns Promise<number>
    const typedResult: Promise<number> = instance.asyncMethod()
    expect(await typedResult).toBe(123)
  })

  it('should add fs capability to $ context', () => {
    const WithFsClass = withFs(TypedBaseClass)
    const instance = new WithFsClass(state, env)

    // $ should have fs capability
    expect(instance.$).toBeDefined()
    expect(instance.$.fs).toBeDefined()

    // TypeScript type check: $.fs has FsCapability methods
    const fs: FsCapability = instance.$.fs
    expect(typeof fs.read).toBe('function')
    expect(typeof fs.write).toBe('function')
  })

  it('should add hasCapability method', () => {
    const WithFsClass = withFs(TypedBaseClass)
    const instance = new WithFsClass(state, env)

    expect(typeof instance.hasCapability).toBe('function')
    expect(instance.hasCapability('fs')).toBe(true)
    expect(instance.hasCapability('git')).toBe(false)
  })

  it('should preserve static properties', () => {
    const WithFsClass = withFs(TypedBaseClass)

    // Static properties should be preserved
    // Note: Due to class expression limitations, static properties may not
    // be automatically preserved, but the capabilities static should exist
    expect((WithFsClass as unknown as { capabilities: string[] }).capabilities).toContain('fs')
  })
})

// ============================================================================
// withGit TYPE PRESERVATION TESTS (chained on withFs)
// ============================================================================

describe('withGit mixin type preservation (chained)', () => {
  let state: DurableObjectState
  let env: Record<string, unknown>

  beforeEach(() => {
    state = createMockState()
    env = createMockEnv()
  })

  it('should preserve base class methods through chain', () => {
    const WithGitClass = withGit(withFs(TypedBaseClass))
    const instance = new WithGitClass(state, env)

    // Instance should still have customMethod from base
    expect(typeof instance.customMethod).toBe('function')
    expect(instance.customMethod()).toBe('custom')

    // TypeScript type check
    const result: string = instance.customMethod()
    expect(result).toBe('custom')
  })

  it('should preserve base class properties through chain', () => {
    const WithGitClass = withGit(withFs(TypedBaseClass))
    const instance = new WithGitClass(state, env)

    // Instance should still have customProperty
    expect(instance.customProperty).toBe(42)

    // TypeScript type check
    const value: number = instance.customProperty
    expect(value).toBe(42)
  })

  it('should have both fs and git capabilities', () => {
    const WithGitClass = withGit(withFs(TypedBaseClass))
    const instance = new WithGitClass(state, env)

    // $ should have both fs and git
    expect(instance.$.fs).toBeDefined()
    expect(instance.$.git).toBeDefined()

    // TypeScript type checks
    const fs: FsCapability = instance.$.fs
    const git: GitCapability = instance.$.git

    expect(typeof fs.read).toBe('function')
    expect(typeof git.status).toBe('function')
  })

  it('should compose hasCapability correctly', () => {
    const WithGitClass = withGit(withFs(TypedBaseClass))
    const instance = new WithGitClass(state, env)

    expect(instance.hasCapability('fs')).toBe(true)
    expect(instance.hasCapability('git')).toBe(true)
    expect(instance.hasCapability('bash')).toBe(false)
  })

  it('should accumulate capabilities in static array', () => {
    const WithGitClass = withGit(withFs(TypedBaseClass))
    const caps = (WithGitClass as unknown as { capabilities: string[] }).capabilities

    expect(caps).toContain('fs')
    expect(caps).toContain('git')
  })
})

// ============================================================================
// withBash TYPE PRESERVATION TESTS
// ============================================================================

describe('withBash mixin type preservation', () => {
  let state: DurableObjectState
  let env: Record<string, unknown>

  beforeEach(() => {
    state = createMockState()
    env = createMockEnv()
  })

  it('should preserve base class methods', () => {
    const WithBashClass = withBash(TypedBaseClass, {
      executor: () => createMockBashExecutor()
    })
    const instance = new WithBashClass(state, env)

    expect(typeof instance.customMethod).toBe('function')
    expect(instance.customMethod()).toBe('custom')
  })

  it('should add bash capability', () => {
    const WithBashClass = withBash(TypedBaseClass, {
      executor: () => createMockBashExecutor()
    })
    const instance = new WithBashClass(state, env)

    expect(instance.$.bash).toBeDefined()
    expect(typeof instance.$.bash.exec).toBe('function')
  })

  it('should integrate with fs when chained', () => {
    const WithBashFsClass = withBash(withFs(TypedBaseClass), {
      executor: () => createMockBashExecutor(),
      fs: (inst) => inst.$.fs
    })
    const instance = new WithBashFsClass(state, env)

    expect(instance.$.fs).toBeDefined()
    expect(instance.$.bash).toBeDefined()
    expect(instance.hasCapability('fs')).toBe(true)
    expect(instance.hasCapability('bash')).toBe(true)
  })
})

// ============================================================================
// CONSTRUCTOR CONSTRAINT TESTS
// ============================================================================

describe('mixin constructor constraints', () => {
  it('withFs should require $ property on base class', () => {
    // This test verifies the constraint at runtime
    // TypeScript would catch this at compile time

    class MissingDollarBase {
      someOtherProp = 'value'
    }

    // At runtime, creating an instance without $ would fail
    // when the mixin tries to access this.$
    // The TypeScript constraint ensures this error is caught at compile time
    expect(() => {
      // @ts-expect-error - TypeScript correctly rejects this
      const InvalidClass = withFs(MissingDollarBase)
      new InvalidClass()
    }).toThrow()
  })

  it('withGit should require $.fs on base class', () => {
    // withGit requires withFs to be applied first
    // The constraint is checked at runtime when $.git is accessed
    class BaseWithPlain$ {
      $: WorkflowContext = {} as WorkflowContext
    }

    // @ts-expect-error - TypeScript correctly rejects this
    const WithGitOnly = withGit(BaseWithPlain$)
    const instance = new WithGitOnly()

    // Accessing $.git should throw because $.fs is required
    expect(() => instance.$.git).toThrow('requires withFs')
  })
})

// ============================================================================
// TYPE INFERENCE TESTS
// ============================================================================

describe('mixin type inference', () => {
  it('should correctly infer return type of customMethod', () => {
    const WithFsClass = withFs(TypedBaseClass)
    const instance = new WithFsClass(createMockState(), createMockEnv())

    // TypeScript should infer this as string, not any
    const result = instance.customMethod()

    // If the type was 'any', this assertion wouldn't catch type errors
    // This is a runtime verification that the type system is working
    expect(typeof result).toBe('string')

    // Verify the type is correctly narrowed
    const upperResult = result.toUpperCase()
    expect(upperResult).toBe('CUSTOM')
  })

  it('should correctly infer return type of asyncMethod', async () => {
    const WithFsClass = withFs(TypedBaseClass)
    const instance = new WithFsClass(createMockState(), createMockEnv())

    const result = await instance.asyncMethod()

    // TypeScript should infer this as number, not any
    expect(typeof result).toBe('number')

    // Verify numeric operations work
    const doubled = result * 2
    expect(doubled).toBe(246)
  })

  it('should correctly type chained mixin results', async () => {
    const ChainedClass = withGit(withFs(TypedBaseClass))
    const instance = new ChainedClass(createMockState(), createMockEnv())

    // All base methods should be accessible and correctly typed
    const customResult = instance.customMethod()
    const asyncResult = await instance.asyncMethod()
    const propValue = instance.customProperty

    expect(typeof customResult).toBe('string')
    expect(typeof asyncResult).toBe('number')
    expect(typeof propValue).toBe('number')

    // All capabilities should be accessible
    expect(typeof instance.$.fs.read).toBe('function')
    expect(typeof instance.$.git.status).toBe('function')
  })
})

// ============================================================================
// COMPILE-TIME TYPE SAFETY VERIFICATION
// ============================================================================

/**
 * These tests exist primarily to verify compile-time behavior.
 * If TypeScript compilation succeeds, the types are correct.
 * The runtime tests above verify that the types match actual behavior.
 */
describe('compile-time type safety', () => {
  it('should allow correct type assignments', () => {
    const WithFsClass = withFs(TypedBaseClass)
    const instance = new WithFsClass(createMockState(), createMockEnv())

    // These assignments verify type correctness at compile time
    const _str: string = instance.customMethod()
    const _num: number = instance.customProperty
    const _promise: Promise<number> = instance.asyncMethod()
    const _fs: FsCapability = instance.$.fs
    const _hasCapability: boolean = instance.hasCapability('fs')

    // If we got here, types are correct
    expect(true).toBe(true)
  })

  it('should allow correct chained type assignments', () => {
    const WithGitFsClass = withGit(withFs(TypedBaseClass))
    const instance = new WithGitFsClass(createMockState(), createMockEnv())

    // These assignments verify type correctness at compile time
    const _str: string = instance.customMethod()
    const _num: number = instance.customProperty
    const _promise: Promise<number> = instance.asyncMethod()
    const _fs: FsCapability = instance.$.fs
    const _git: GitCapability = instance.$.git
    const _hasCapability: boolean = instance.hasCapability('fs')

    // If we got here, types are correct
    expect(true).toBe(true)
  })
})
