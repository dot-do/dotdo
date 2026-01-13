import { expectType, expectError } from 'tsd'
import { withAuth } from '../../objects/transport/auth-layer'
import type { DurableObjectState } from '../../objects/transport/handler'

/**
 * TDD GREEN Phase: Mixin Decorator Type Constraints
 *
 * This test file verifies that withAuth mixin properly rejects invalid
 * base classes. The constraints have been tightened from `any[]` to
 * require DO constructor signature.
 *
 * Issue: dotdo-9jqmx (GREEN phase of dotdo-rcek6)
 *
 * Note: withRpcServer tests were removed as part of capnweb migration.
 * The legacy rpc-server.ts has been deleted.
 *
 * The constraints now require:
 * - Constructor with (state: DurableObjectState, env: Record<string, unknown>)
 * - Rejects classes with incompatible constructor parameter types
 *
 * Note: TypeScript structural typing allows classes with fewer parameters
 * to be assigned where more parameters are expected (parameters are optional).
 * This means classes with no constructor or empty constructor still work.
 */

// Valid DO base class - should work
class ValidDOBase {
  constructor(state: DurableObjectState, env: Record<string, unknown>) {}
  fetch(request: Request): Response | Promise<Response> {
    return new Response('ok')
  }
}

// Invalid base class - wrong constructor signature
class InvalidBase {
  constructor(wrongArg: string) {}
}

// Plain class with no constructor args
class NoArgsBase {}

// This SHOULD compile - valid DO base class works
const ValidAuth = withAuth(ValidDOBase)

// Instances can be created with proper args
const _authInstance = new ValidAuth({} as DurableObjectState, {} as Record<string, unknown>)

// ============================================================================
// Type Constraint Verification: Incompatible constructors are rejected
// ============================================================================

// These correctly fail to compile due to tightened constructor constraints.
// The @ts-expect-error directives confirm the type system rejects them.

// @ts-expect-error - Invalid constructor signature (string instead of DurableObjectState) is rejected
const InvalidAuth = withAuth(InvalidBase)

// Note: Classes with no/empty constructors still work due to TypeScript's
// structural typing (fewer params is compatible with more params).
// This is expected TypeScript behavior, not a bug.
const NoArgsAuth = withAuth(NoArgsBase) // Works: () is compatible with (state, env)

// ============================================================================
// Type Safety Preservation: Return type includes base class instance type
// Issue: dotdo-3ppn2
// ============================================================================

/**
 * These tests verify that withAuth preserves the instance type of the
 * base class. The `as new (...args: any[]) => any` cast was defeating
 * type safety by losing the base class's type information.
 *
 * Expected behavior after fix:
 * - Instances have both base class methods AND mixin methods
 * - TypeScript can infer types from base class
 */

// Base class with typed methods for verification
class TypedDOBase {
  constructor(state: DurableObjectState, env: Record<string, unknown>) {}
  fetch(request: Request): Response | Promise<Response> {
    return new Response('ok')
  }

  /** Custom method that should be preserved on the instance type */
  customMethod(): string {
    return 'custom'
  }

  /** Property that should be accessible */
  customProperty = 42
}

// Apply mixin
const TypedAuth = withAuth(TypedDOBase)

// Create instance
const typedAuthInstance = new TypedAuth({} as DurableObjectState, {} as Record<string, unknown>)

// CRITICAL: These tests verify that base class types are preserved
// Without the fix, customMethod and customProperty are typed as 'any'

// Type test: customMethod should return string (not any)
expectType<string>(typedAuthInstance.customMethod())

// Type test: customProperty should be number (not any)
expectType<number>(typedAuthInstance.customProperty)

// Type test: fetch should return Response or Promise<Response>
expectType<Response | Promise<Response>>(typedAuthInstance.fetch(new Request('http://test')))
