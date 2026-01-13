/**
 * Type tests for Constructor types
 *
 * These tests verify that the centralized Constructor types work correctly
 * with TypeScript's mixin patterns.
 *
 * @module types/tests/constructor.test-d
 */

import { expectType, expectError } from 'tsd'
import type {
  Constructor,
  AbstractConstructor,
  Mixin,
  GetInstanceType,
  GetStaticType,
  ConstructorWith,
  MergeInstanceTypes,
} from '../constructor'

// ============================================================================
// Constructor Type Tests
// ============================================================================

// Basic constructor type
class SimpleClass {
  value = 42
}

// Verify Constructor type accepts a class
const SimpleCtor: Constructor<SimpleClass> = SimpleClass

// Verify Constructor with default type param
const AnyCtor: Constructor = SimpleClass

// Verify instances are correctly typed
const instance = new SimpleCtor()
expectType<number>(instance.value)

// ============================================================================
// Mixin Pattern Tests
// ============================================================================

// Simple mixin function
function withLogging<TBase extends Constructor>(Base: TBase) {
  return class extends Base {
    log(message: string) {
      console.log(`[${this.constructor.name}] ${message}`)
    }
  }
}

// Apply mixin
const LoggingClass = withLogging(SimpleClass)
const loggingInstance = new LoggingClass()

// Should have base class properties
expectType<number>(loggingInstance.value)

// Should have mixin methods
expectType<void>(loggingInstance.log('test'))

// ============================================================================
// Constrained Mixin Tests
// ============================================================================

// Base with required properties
interface HasContext {
  ctx: { state: string }
}

class ContextClass implements HasContext {
  ctx = { state: 'initial' }
}

// Mixin that requires HasContext
function withState<TBase extends ConstructorWith<HasContext>>(Base: TBase) {
  return class extends Base {
    getState() {
      return this.ctx.state
    }
  }
}

// Should work with valid base
const StateClass = withState(ContextClass)
const stateInstance = new StateClass()
expectType<string>(stateInstance.getState())
expectType<{ state: string }>(stateInstance.ctx)

// Should NOT work with invalid base (no ctx)
// @ts-expect-error - SimpleClass doesn't have ctx property
const InvalidState = withState(SimpleClass)

// ============================================================================
// AbstractConstructor Tests
// ============================================================================

abstract class AbstractBase {
  abstract abstractMethod(): string
  concreteMethod() {
    return 'concrete'
  }
}

// Verify AbstractConstructor type
const AbstractCtor: AbstractConstructor<AbstractBase> = AbstractBase

// Can use with abstract-aware mixins
function withAbstractMixin<TBase extends AbstractConstructor>(Base: TBase) {
  abstract class WithAbstract extends Base {
    additionalMethod() {
      return 'additional'
    }
  }
  return WithAbstract
}

const MixedAbstract = withAbstractMixin(AbstractBase)

// Should still be abstract
// @ts-expect-error - Cannot instantiate abstract class
const abstractInstance = new MixedAbstract()

// ============================================================================
// GetInstanceType Tests
// ============================================================================

type SimpleInstance = GetInstanceType<typeof SimpleClass>
declare const simpleFromType: SimpleInstance
expectType<number>(simpleFromType.value)

// Works with mixin results
type LoggingInstance = GetInstanceType<typeof LoggingClass>
declare const loggingFromType: LoggingInstance
expectType<number>(loggingFromType.value)
expectType<(message: string) => void>(loggingFromType.log)

// ============================================================================
// MergeInstanceTypes Tests
// ============================================================================

interface BaseType {
  name: string
  age: number
  shared: string
}

interface ExtensionType {
  age: string  // Override age to be string
  email: string
}

type MergedType = MergeInstanceTypes<BaseType, ExtensionType>

// Verify merged type has correct properties
declare const merged: MergedType
expectType<string>(merged.name)    // From base
expectType<string>(merged.age)     // Overridden by extension
expectType<string>(merged.email)   // From extension
expectType<string>(merged.shared)  // From base

// ============================================================================
// Mixin Type Utility Tests
// ============================================================================

// Define a mixin using the Mixin type
type LoggingMixinType = Mixin<Constructor, { log(msg: string): void }>

const typedLoggingMixin: LoggingMixinType = <T extends Constructor>(Base: T) =>
  class extends Base {
    log(msg: string) {
      console.log(msg)
    }
  }

const TypedLoggingClass = typedLoggingMixin(SimpleClass)
const typedInstance = new TypedLoggingClass()
expectType<number>(typedInstance.value)
expectType<void>(typedInstance.log('test'))

// ============================================================================
// Capability Pattern Tests (Real-world usage)
// ============================================================================

// Simulated WorkflowContext
interface WorkflowContext {
  send(event: unknown): void
}

// Simulated base DO
class BaseDO {
  $: WorkflowContext = { send: () => {} }
}

// Simulated FsCapability
interface FsCapability {
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
}

interface WithFsContext extends WorkflowContext {
  fs: FsCapability
}

// Capability mixin pattern
function withFs<TBase extends Constructor<{ $: WorkflowContext }>>(Base: TBase) {
  return class extends Base {
    declare $: WithFsContext

    // Simulated fs injection
    constructor(...args: any[]) {
      super(...args)
      ;(this.$ as WithFsContext).fs = {
        read: async () => '',
        write: async () => {},
      }
    }

    hasCapability(name: string): boolean {
      return name === 'fs'
    }
  }
}

// Apply capability
const FsDO = withFs(BaseDO)
const fsInstance = new FsDO()

// Verify capability is accessible
expectType<FsCapability>(fsInstance.$.fs)
expectType<boolean>(fsInstance.hasCapability('fs'))

// Chained capabilities
interface GitCapability {
  commit(message: string): Promise<void>
}

interface WithGitContext extends WithFsContext {
  git: GitCapability
}

function withGit<TBase extends Constructor<{ $: WithFsContext }>>(Base: TBase) {
  return class extends Base {
    declare $: WithGitContext

    hasCapability(name: string): boolean {
      if (name === 'git') return true
      // @ts-expect-error - Base may not have hasCapability
      return super.hasCapability?.(name) ?? false
    }
  }
}

// Chain capabilities: withGit(withFs(BaseDO))
const GitDO = withGit(withFs(BaseDO))
const gitInstance = new GitDO()

// Should have both capabilities
expectType<FsCapability>(gitInstance.$.fs)
expectType<GitCapability>(gitInstance.$.git)
