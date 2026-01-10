import { expectType, expectError } from 'tsd'
import { withRpcServer } from '../../objects/transport/rpc-server'
import { withAuth } from '../../objects/transport/auth-layer'

/**
 * TDD RED Phase: Mixin Decorator Type Constraints
 *
 * This test file verifies that withRpcServer and withAuth mixins
 * should reject invalid base classes. Currently they accept ANY
 * constructor due to `any[]` constraints, which is too loose.
 *
 * Issue: dotdo-rcek6
 *
 * The @ts-expect-error lines below SHOULD trigger type errors
 * when we fix the constraints. Right now they DON'T trigger errors
 * because the mixins accept any constructor - this is the bug.
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
// BUG DEMONSTRATION: These SHOULD NOT compile but currently DO
// ============================================================================

// These SHOULD NOT compile but currently do due to `any[]` constraints
// When the bug is fixed, these @ts-expect-error comments will work correctly.
// Right now, tsd reports "Unused @ts-expect-error directive" because
// the code compiles when it shouldn't.

// @ts-expect-error - Invalid constructor signature should be rejected
const InvalidRpc = withRpcServer(InvalidBase)

// @ts-expect-error - Invalid constructor signature should be rejected
const InvalidAuth = withAuth(InvalidBase)

// @ts-expect-error - Must have DO-compatible constructor (state, env)
const MissingRpc = withRpcServer(MissingMethodsBase)

// @ts-expect-error - Empty constructor is not DO-compatible
const NoArgsRpc = withRpcServer(NoArgsBase)

// @ts-expect-error - Empty constructor is not DO-compatible
const NoArgsAuth = withAuth(NoArgsBase)
