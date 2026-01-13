/**
 * TDD RED Phase: Mixin Type Safety Tests
 *
 * These tests verify that capability mixins preserve base class type information.
 *
 * Issue: dotdo-3ppn2
 *
 * Problem: The `@ts-expect-error` directives in withFs and withGit defeat
 * type safety by allowing the return type annotation to be incorrect.
 * The `as any` cast was also used in some mixins, which loses type information.
 *
 * Expected behavior after fix:
 * - Instances have both base class methods AND mixin methods
 * - TypeScript can infer types from base class
 * - No @ts-expect-error needed in the mixin implementations
 */

import { expectType, expectError } from 'tsd'
import { withFs, type WithFsContext, type FsCapability } from '../fs'
import { withGit, type WithGitContext, type GitCapability } from '../git'
import type { WorkflowContext } from '../../../types/WorkflowContext'

// ============================================================================
// TEST BASE CLASS
// ============================================================================

/**
 * Base class with typed methods for verification.
 * This simulates a DO class with custom methods.
 */
class TypedBaseClass {
  $: WorkflowContext = {} as WorkflowContext

  constructor() {}

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
}

// ============================================================================
// withFs TYPE PRESERVATION
// ============================================================================

// Apply withFs mixin
const WithFsClass = withFs(TypedBaseClass)

// Create instance
const fsInstance = new WithFsClass()

// CRITICAL: These tests verify that base class types are preserved
// Without the fix, customMethod and customProperty are typed as 'any'

// Type test: customMethod should return string (not any)
expectType<string>(fsInstance.customMethod())

// Type test: customProperty should be number (not any)
expectType<number>(fsInstance.customProperty)

// Type test: asyncMethod should return Promise<number> (not any)
expectType<Promise<number>>(fsInstance.asyncMethod())

// Type test: $ should have fs capability
expectType<FsCapability>(fsInstance.$.fs)

// ============================================================================
// withGit TYPE PRESERVATION
// ============================================================================

// Apply withGit on top of withFs
const WithGitClass = withGit(withFs(TypedBaseClass))

// Create instance
const gitInstance = new WithGitClass()

// CRITICAL: Base class types preserved through chained mixins

// Type test: customMethod still returns string
expectType<string>(gitInstance.customMethod())

// Type test: customProperty still number
expectType<number>(gitInstance.customProperty)

// Type test: $ has both fs and git
expectType<FsCapability>(gitInstance.$.fs)
expectType<GitCapability>(gitInstance.$.git)

// ============================================================================
// CONSTRUCTOR TYPE SAFETY
// ============================================================================

/**
 * These tests verify that constructor types are properly constrained.
 * The mixins should require specific base class properties, not accept any.
 */

// Base class missing $ property - should cause type error
class MissingDollarBase {
  someOtherProp = 'value'
}

// @ts-expect-error - withFs requires $ property on base class
const InvalidFsClass = withFs(MissingDollarBase)

// @ts-expect-error - withGit requires $ with fs property (TypedBaseClass only has WorkflowContext)
const InvalidGitClass = withGit(TypedBaseClass)

// ============================================================================
// STATIC PROPERTIES TYPE PRESERVATION
// ============================================================================

/**
 * Static properties from base class should be preserved.
 */
class BaseWithStatics {
  $: WorkflowContext = {} as WorkflowContext

  static VERSION = '1.0.0'
  static create(): BaseWithStatics {
    return new BaseWithStatics()
  }
}

const ExtendedWithStatics = withFs(BaseWithStatics)

// Static properties should be accessible
expectType<string>(ExtendedWithStatics.VERSION)
expectType<BaseWithStatics>(ExtendedWithStatics.create())

// Capabilities static should be added
expectType<string[]>((ExtendedWithStatics as unknown as { capabilities: string[] }).capabilities)
