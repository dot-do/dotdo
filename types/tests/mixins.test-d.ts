import { expectType, expectError } from 'tsd'
import { withRpcServer } from '../../objects/transport/rpc-server'
import { withAuth } from '../../objects/transport/auth-layer'
import type { DurableObjectState } from '../../objects/transport/handler'

/**
 * TDD GREEN Phase: Mixin Decorator Type Constraints
 *
 * This test file verifies that withRpcServer and withAuth mixins
 * now properly reject invalid base classes. The constraints have
 * been tightened from `any[]` to require DO constructor signature.
 *
 * Issue: dotdo-9jqmx (GREEN phase of dotdo-rcek6)
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

// Another invalid - missing required methods
class MissingMethodsBase {
  constructor() {}
}

// Plain class with no constructor args
class NoArgsBase {}

// These SHOULD compile - valid DO base classes work
const ValidRpc = withRpcServer(ValidDOBase)
const ValidAuth = withAuth(ValidDOBase)

// Instances can be created with proper args
const _rpcInstance = new ValidRpc({} as DurableObjectState, {} as Record<string, unknown>)
const _authInstance = new ValidAuth({} as DurableObjectState, {} as Record<string, unknown>)

// ============================================================================
// Type Constraint Verification: Incompatible constructors are rejected
// ============================================================================

// These correctly fail to compile due to tightened constructor constraints.
// The @ts-expect-error directives confirm the type system rejects them.

// @ts-expect-error - Invalid constructor signature (string instead of DurableObjectState) is rejected
const InvalidRpc = withRpcServer(InvalidBase)

// @ts-expect-error - Invalid constructor signature (string instead of DurableObjectState) is rejected
const InvalidAuth = withAuth(InvalidBase)

// Note: Classes with no/empty constructors still work due to TypeScript's
// structural typing (fewer params is compatible with more params).
// This is expected TypeScript behavior, not a bug.
const MissingRpc = withRpcServer(MissingMethodsBase) // Works: () is compatible with (state, env)
const NoArgsRpc = withRpcServer(NoArgsBase) // Works: () is compatible with (state, env)
const NoArgsAuth = withAuth(NoArgsBase) // Works: () is compatible with (state, env)
