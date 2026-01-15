import { expectType, expectNotType, expectError } from 'tsd'
import type { PipelinePromise, PipelineExpression, MapperInstruction, WorkflowProxyOptions } from '../../workflows/pipeline-types'

/**
 * TDD GREEN Phase: Pipeline Types Use `unknown` Instead of `any`
 *
 * This test file verifies that pipeline-related types do not use `any`.
 * GREEN phase completed - types have been fixed:
 *
 * Fixed issues in workflows/pipeline-types.ts:
 * - Line 36: PipelinePromise now has `[key: string]: unknown` index signature
 *
 * Issue: do-n5b (TypeScript - Tests for type safety violations)
 *
 * All tests now pass because the types properly use `unknown` instead of `any`,
 * requiring explicit type narrowing before use.
 */

// ============================================================================
// PipelinePromise Index Signature Should Not Be `any`
// ============================================================================

/**
 * Test: PipelinePromise index signature should NOT be `any`
 *
 * PipelinePromise now has `[key: string]: unknown` which means
 * accessing any property returns `unknown`, requiring type narrowing.
 *
 * VERIFIED: The index signature uses `unknown`, enforcing type safety.
 */
declare const pipeline: PipelinePromise<string>

// Access a property via index signature
type IndexAccessType = PipelinePromise<string>[string]

// Test: Index access should not return `any`
// This test will FAIL if the index signature is `[key: string]: any`
expectNotType<any>(pipeline['anyProperty'])

// Type check for `any`: if IndexAccessType can be assigned to/from anything
// including function types and unknown simultaneously, it's `any`
type IndexIsAny = IndexAccessType extends (...args: never[]) => unknown
  ? unknown extends IndexAccessType
    ? true  // This is `any` - both conditions are met
    : false
  : false

// This is `false` because index signature uses `unknown` (not `any`)
// VERIFIED: The fix was applied and tests pass
declare const indexIsAnyResult: IndexIsAny
expectType<false>(indexIsAnyResult)

// ============================================================================
// PipelinePromise Known Properties Should Be Properly Typed
// ============================================================================

/**
 * Test: Known properties should have their proper types, not `any`
 */

// __expr should be PipelineExpression, not any
type ExprType = PipelinePromise['__expr']
expectType<PipelineExpression>({} as ExprType)

// __isPipelinePromise should be `true` literal, not any
type IsPipelinePromiseType = PipelinePromise['__isPipelinePromise']
expectType<true>({} as IsPipelinePromiseType)

// ============================================================================
// Chained Property Access Should Require Type Narrowing
// ============================================================================

/**
 * Test: Chaining property access should require type narrowing
 *
 * With `[key: string]: any`, you can write `pipeline.foo.bar.baz`
 * and each step returns `any`. This is unsafe.
 *
 * With `[key: string]: unknown`:
 * - Single property access returns `unknown`
 * - Chained access is not directly possible without type narrowing
 * - This is the desired behavior for type safety
 */

// Single property access should return unknown
type SingleAccessType = PipelinePromise['someProp']

// Test: Single access type should be unknown (not any)
// With unknown, this conditional type yields false (unknown is NOT assignable to function)
type SingleAccessIsAny = SingleAccessType extends (...args: never[]) => unknown
  ? unknown extends SingleAccessType
    ? true  // This is `any` - both conditions are met
    : false
  : false

declare const singleAccessIsAnyResult: SingleAccessIsAny
expectType<false>(singleAccessIsAnyResult)

// ============================================================================
// Index Access Should Return Unknown (Not Any)
// ============================================================================

/**
 * Test: Index access should return `unknown`, preventing unsafe method calls
 *
 * With `[key: string]: any`, you can call any method
 * and get back `any`. This defeats pipeline type inference.
 *
 * With `[key: string]: unknown`:
 * - You cannot call index-accessed values as functions without type narrowing
 * - This is the correct behavior - methods should be called with proper types
 */

// Extract the index signature type
type IndexSignatureType = PipelinePromise[string]

// Verify index access returns unknown (not any)
// The type should be `unknown` which is not callable
type IndexIsUnknown = unknown extends IndexSignatureType
  ? IndexSignatureType extends unknown
    ? true  // Both directions assignable means it's unknown or any
    : false
  : false

// Additional check: unknown is NOT assignable to Function (unlike any)
type IndexIsCallable = IndexSignatureType extends (...args: unknown[]) => unknown
  ? true
  : false

// With unknown, this should be false (unknown is not callable)
// With any, this would be true (any is callable)
declare const indexIsCallableResult: IndexIsCallable
expectType<false>(indexIsCallableResult)

// ============================================================================
// PipelineExpression Types Should Use `unknown`
// ============================================================================

/**
 * Test: PipelineExpression variants should use `unknown` not `any`
 */

// 'literal' variant has value: unknown - should be safe
declare const literalExpr: Extract<PipelineExpression, { type: 'literal' }>
type LiteralValueType = typeof literalExpr.value
type LiteralIsAny = LiteralValueType extends (...args: never[]) => unknown
  ? unknown extends LiteralValueType
    ? true
    : false
  : false

// This should already be false (uses unknown)
declare const literalIsAnyResult: LiteralIsAny
expectType<false>(literalIsAnyResult)

// 'call' variant has context: unknown and args: unknown[] - should be safe
declare const callExpr: Extract<PipelineExpression, { type: 'call' }>
type CallContextType = typeof callExpr.context
type CallArgsType = typeof callExpr.args

type CallContextIsAny = CallContextType extends (...args: never[]) => unknown
  ? unknown extends CallContextType
    ? true
    : false
  : false

declare const callContextIsAnyResult: CallContextIsAny
expectType<false>(callContextIsAnyResult)

// ============================================================================
// Type Guard Should Not Use `any` Cast
// ============================================================================

/**
 * Test: isPipelinePromise type guard should not require `any` cast
 *
 * In pipeline-types.ts line 54, there's a cast: `(value as any).__isPipelinePromise`
 * This could be replaced with proper type narrowing.
 *
 * Note: isPipelinePromise is imported but the type guard test uses
 * the PipelinePromise type directly to avoid syntax limitations.
 */
import { isPipelinePromise } from '../../workflows/pipeline-types'

// Verify isPipelinePromise is exported (for runtime use)
declare const unknownValue: unknown
const _typeGuardExists: typeof isPipelinePromise = isPipelinePromise

// Test type guard narrows properly
declare const narrowedPipeline: PipelinePromise
expectType<PipelineExpression>(narrowedPipeline.__expr)
expectType<true>(narrowedPipeline.__isPipelinePromise)

// Index access after guard should NOT return any
type GuardedIndexType = PipelinePromise[string]
type GuardedIndexIsAny = GuardedIndexType extends (...args: never[]) => unknown
  ? unknown extends GuardedIndexType
    ? true
    : false
  : false

declare const guardedIndexIsAnyResult: GuardedIndexIsAny
expectType<false>(guardedIndexIsAnyResult)

// ============================================================================
// WorkflowProxyOptions Should Be Properly Typed
// ============================================================================

/**
 * Test: WorkflowProxyOptions callbacks should use proper types
 */
declare const options: WorkflowProxyOptions

// execute returns Promise<unknown>, not Promise<any>
// Extract the return type of execute function
type ExecuteFunction = NonNullable<WorkflowProxyOptions['execute']>
type ExecuteReturnType = ReturnType<ExecuteFunction>
type ExecuteResultType = Awaited<ExecuteReturnType>

type ExecuteIsAny = ExecuteResultType extends (...args: never[]) => unknown
  ? unknown extends ExecuteResultType
    ? true
    : false
  : false

declare const executeIsAnyResult: ExecuteIsAny
// This should already be false (uses unknown)
expectType<false>(executeIsAnyResult)

// ============================================================================
// Strict Usage Tests
// ============================================================================

/**
 * Test: Using index-accessed values should require type narrowing
 *
 * If index signature returns `unknown` or constrained type,
 * direct usage without type guards should error.
 * With `any`, no errors occur (unsafe).
 */

// This SHOULD error after the fix (cannot call method on unknown/constrained type)
// Currently compiles because index returns `any`
// @ts-expect-error - After fix: cannot call arbitrary method on pipeline property
const _unsafeCall = pipeline['data'].toUpperCase()

// This SHOULD error after the fix (cannot spread unknown)
// @ts-expect-error - After fix: cannot spread non-object type
const _unsafeSpread = { ...pipeline['config'] }

// This SHOULD error after the fix (cannot use in arithmetic)
// @ts-expect-error - After fix: cannot use in arithmetic operation
const _unsafeArithmetic = pipeline['count'] + 1
