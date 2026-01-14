import { expectType, expectNotType, expectError } from 'tsd'
import type { Branch, Filter, Flag, FlagInput, BranchInput, FilterInput } from '../Flag'

/**
 * TDD RED Phase: Flag Types Should Not Use `any`
 *
 * This test file verifies that Flag-related types do not use `any`.
 * These tests are expected to FAIL in the RED phase because:
 *
 * Current issues in types/Flag.ts:
 * - Line 14: Branch.payload is Record<string, any>
 * - Line 24: Filter.value is `any`
 *
 * Issue: do-n5b (TypeScript epic - eliminate any types)
 *
 * Once the types are fixed to use `unknown` or proper types instead of `any`,
 * these tests will pass (GREEN phase).
 */

// ============================================================================
// Branch.payload Should Not Be `any`
// ============================================================================

/**
 * Test: Branch payload should NOT allow any type assignment
 *
 * Currently Branch.payload is Record<string, any>, which means
 * values can be any type without type checking. This is unsafe.
 *
 * Expected: After fix, payload should be Record<string, unknown>
 * which requires explicit type narrowing before use.
 */
declare const branch: Branch

// Extract the value type from Branch.payload
type BranchPayloadValue = NonNullable<Branch['payload']>[string]

// This test will FAIL if payload is Record<string, any>
// because `any` is assignable to/from everything including `never`
// When payload is Record<string, unknown>, this will properly constrain the type
expectNotType<any>(branch.payload)

// A safer way to test: if payload[key] can be assigned to a function without checks,
// it means the value type is `any` (which is unsafe)
type BranchPayloadIsAny = BranchPayloadValue extends (...args: never[]) => unknown
  ? unknown extends BranchPayloadValue
    ? true  // This is `any` - both conditions are met
    : false
  : false

// This should be `false` after the fix (payload uses `unknown`)
// Currently it's `true` because payload uses `any`
declare const branchPayloadIsAnyResult: BranchPayloadIsAny
expectType<false>(branchPayloadIsAnyResult)

// ============================================================================
// Filter.value Should Not Be `any`
// ============================================================================

/**
 * Test: Filter.value should NOT be `any`
 *
 * Currently Filter.value is typed as `any` (line 24), which defeats
 * type safety for targeting filters.
 *
 * Expected: After fix, value should be `unknown` requiring explicit
 * type narrowing, or a union of supported types.
 */
declare const filter: Filter

// Extract the type of Filter.value
type FilterValueType = Filter['value']

// Test: value should not be `any`
expectNotType<any>(filter.value)

// Type narrowing test: if value is `any`, this comparison type-checks incorrectly
type FilterValueIsAny = FilterValueType extends (...args: never[]) => unknown
  ? unknown extends FilterValueType
    ? true  // This is `any`
    : false
  : false

// This should be `false` after the fix
declare const filterValueIsAnyResult: FilterValueIsAny
expectType<false>(filterValueIsAnyResult)

// ============================================================================
// Zod-Inferred Types Should Also Be Safe
// ============================================================================

/**
 * Test: Zod-inferred types should use `unknown` not `any`
 *
 * The Zod schemas (BranchSchema, FilterSchema) use z.unknown() which
 * correctly infers to `unknown`. But the interface types should match.
 */

// BranchInput (from Zod) payload should also not be any
type BranchInputPayloadValue = NonNullable<BranchInput['payload']>[string]
type BranchInputPayloadIsAny = BranchInputPayloadValue extends (...args: never[]) => unknown
  ? unknown extends BranchInputPayloadValue
    ? true
    : false
  : false

declare const branchInputPayloadIsAnyResult: BranchInputPayloadIsAny
// Zod schema uses z.unknown(), so this should already be false
expectType<false>(branchInputPayloadIsAnyResult)

// FilterInput (from Zod) value should also not be any
type FilterInputValueType = FilterInput['value']
type FilterInputValueIsAny = FilterInputValueType extends (...args: never[]) => unknown
  ? unknown extends FilterInputValueType
    ? true
    : false
  : false

declare const filterInputValueIsAnyResult: FilterInputValueIsAny
// Zod schema uses z.unknown(), so this should already be false
expectType<false>(filterInputValueIsAnyResult)

// ============================================================================
// Type Consistency Test
// ============================================================================

/**
 * Test: Interface types should be assignable to Zod-inferred types
 *
 * If the interface uses `any` but Zod uses `unknown`, assignments
 * will have unexpected behavior. They should be consistent.
 */

// A Branch should be assignable to BranchInput
declare const branchForAssignment: Branch
const _branchInput: BranchInput = branchForAssignment

// A Filter should be assignable to FilterInput
declare const filterForAssignment: Filter
const _filterInput: FilterInput = filterForAssignment

// A Flag should be assignable to FlagInput
declare const flagForAssignment: Flag
const _flagInput: FlagInput = flagForAssignment

// ============================================================================
// Strict Usage Tests
// ============================================================================

/**
 * Test: Accessing payload/value should require type narrowing
 *
 * If these are properly typed as `unknown`, you cannot use them
 * directly without type guards. With `any`, no guards needed (unsafe).
 */

// This SHOULD error after the fix (cannot call methods on unknown)
// Currently it compiles because `any` allows anything
// @ts-expect-error - After fix: cannot call method on unknown type
const _unsafePayloadCall = branch.payload?.someKey.toString()

// This SHOULD error after the fix (cannot use value directly in arithmetic)
// @ts-expect-error - After fix: cannot use unknown in arithmetic
const _unsafeValueArithmetic = (filter.value || 0) + 1
