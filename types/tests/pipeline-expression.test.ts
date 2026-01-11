import { describe, it, expect, expectTypeOf } from 'vitest'

/**
 * PipelineExpression Type System Tests (RED Phase)
 *
 * These tests verify that the PipelineExpression union includes all expression types
 * that are created throughout the codebase.
 *
 * Current Status: FAILING (RED)
 * The `send` expression type is missing from the PipelineExpression union.
 * See workflows/on.ts lines 228-234 where `as any` bypasses type checking.
 *
 * Related code locations with `as any` casts:
 * - workflows/on.ts:233 - send expression
 * - workflows/on.ts:265 - conditional expression (already in union, cast is legacy)
 * - workflows/on.ts:282 - waitFor expression (already in union, cast is legacy)
 *
 * How to verify RED phase:
 * Run: npx tsc --noEmit types/tests/pipeline-expression.test.ts
 * Expected errors:
 * - TS2344: SendExpression is not assignable to PipelineExpression
 * - TS2367: 'send' type has no overlap with PipelineExpression types
 */

import type { PipelineExpression } from '../../workflows/pipeline-promise'

// ============================================================================
// Type Definitions for Testing
// ============================================================================

/**
 * SendExpression - Represents a fire-and-forget event emission
 * Used by: send.Entity.event(payload) in workflows/on.ts
 */
interface SendExpression {
  type: 'send'
  entity: string
  event: string
  payload: unknown
}

/**
 * ConditionalExpression - Represents if/then/else logic
 * Used by: when(condition, { then, else }) in workflows/on.ts
 * Status: Already in union (should pass)
 */
interface ConditionalExpression {
  type: 'conditional'
  condition: PipelineExpression
  thenBranch: PipelineExpression
  elseBranch: PipelineExpression | null
}

/**
 * BranchExpression - Represents multi-way branching
 * Used by: $.branch() in workflows/pipeline-promise.ts
 * Status: Already in union (should pass)
 */
interface BranchExpression {
  type: 'branch'
  value: PipelineExpression
  cases: Record<string, PipelineExpression>
}

/**
 * WaitForExpression - Represents human-in-the-loop pausing
 * Used by: waitFor(eventName, options) in workflows/on.ts
 * Status: Already in union (should pass)
 */
interface WaitForExpression {
  type: 'waitFor'
  eventName: string
  options: { timeout?: string; type?: string }
}

// ============================================================================
// Expression Type Tests
// ============================================================================

describe('PipelineExpression Union Completeness', () => {
  describe('send expression', () => {
    it('should include send expression type in the union', () => {
      // RED: This test FAILS because SendExpression is not assignable to PipelineExpression
      // The PipelineExpression union is missing the 'send' type variant
      //
      // To fix: Add to PipelineExpression union in workflows/pipeline-promise.ts:
      //   | { type: 'send'; entity: string; event: string; payload: unknown }
      expectTypeOf<SendExpression>().toMatchTypeOf<PipelineExpression>()
    })

    it('should allow creating send expression without cast', () => {
      // GREEN: SendExpression is now in the PipelineExpression union
      const sendExpr: PipelineExpression = {
        type: 'send',
        entity: 'Customer',
        event: 'signup',
        payload: { email: 'test@example.com.ai' },
      }

      // This should be assignable to PipelineExpression
      expectTypeOf(sendExpr).toMatchTypeOf<PipelineExpression>()
    })
  })

  describe('conditional expression', () => {
    it('should include conditional expression type in the union', () => {
      // GREEN: This should pass - conditional is already in the union
      expectTypeOf<ConditionalExpression>().toMatchTypeOf<PipelineExpression>()
    })

    it('should allow creating conditional expression without cast', () => {
      // GREEN: This should pass - but workflows/on.ts:265 still uses `as any`
      // which should be cleaned up after verifying this test passes
      const conditionalExpr: PipelineExpression = {
        type: 'conditional',
        condition: { type: 'literal', value: true },
        thenBranch: { type: 'literal', value: 'yes' },
        elseBranch: { type: 'literal', value: 'no' },
      }

      expectTypeOf(conditionalExpr).toMatchTypeOf<PipelineExpression>()
    })
  })

  describe('branch expression', () => {
    it('should include branch expression type in the union', () => {
      // GREEN: This should pass - branch is already in the union
      expectTypeOf<BranchExpression>().toMatchTypeOf<PipelineExpression>()
    })

    it('should allow creating branch expression without cast', () => {
      // GREEN: This should pass
      const branchExpr: PipelineExpression = {
        type: 'branch',
        value: { type: 'literal', value: 'option1' },
        cases: {
          option1: { type: 'literal', value: 'result1' },
          option2: { type: 'literal', value: 'result2' },
        },
      }

      expectTypeOf(branchExpr).toMatchTypeOf<PipelineExpression>()
    })
  })

  describe('waitFor expression', () => {
    it('should include waitFor expression type in the union', () => {
      // GREEN: This should pass - waitFor is already in the union
      expectTypeOf<WaitForExpression>().toMatchTypeOf<PipelineExpression>()
    })

    it('should allow creating waitFor expression without cast', () => {
      // GREEN: This should pass - but workflows/on.ts:282 still uses complex cast
      // which should be cleaned up after verifying this test passes
      const waitForExpr: PipelineExpression = {
        type: 'waitFor',
        eventName: 'approval',
        options: { timeout: '24h' },
      }

      expectTypeOf(waitForExpr).toMatchTypeOf<PipelineExpression>()
    })
  })
})

// ============================================================================
// Type Discriminant Tests
// ============================================================================

describe('PipelineExpression Type Discriminants', () => {
  describe('type field narrowing', () => {
    it('should narrow to send expression when type is "send"', () => {
      // RED: This test FAILS until send is added to union
      // Type narrowing should work with discriminated unions
      function handleExpression(expr: PipelineExpression) {
        if (expr.type === 'send') {
          // Should narrow to SendExpression shape
          // Currently this branch is unreachable because 'send' is not in union
          expectTypeOf(expr).toHaveProperty('entity')
          expectTypeOf(expr).toHaveProperty('event')
          expectTypeOf(expr).toHaveProperty('payload')
        }
      }

      // Verify the function compiles (it doesn't use send narrowing properly yet)
      expectTypeOf(handleExpression).toBeFunction()
    })

    it('should narrow to conditional expression when type is "conditional"', () => {
      // GREEN: This should work
      function handleExpression(expr: PipelineExpression) {
        if (expr.type === 'conditional') {
          expectTypeOf(expr.condition).toMatchTypeOf<PipelineExpression>()
          expectTypeOf(expr.thenBranch).toMatchTypeOf<PipelineExpression>()
          expectTypeOf(expr.elseBranch).toMatchTypeOf<PipelineExpression | null>()
        }
      }

      expectTypeOf(handleExpression).toBeFunction()
    })

    it('should narrow to waitFor expression when type is "waitFor"', () => {
      // GREEN: This should work
      function handleExpression(expr: PipelineExpression) {
        if (expr.type === 'waitFor') {
          expectTypeOf(expr.eventName).toBeString()
          expectTypeOf(expr.options).toMatchTypeOf<{ timeout?: string; type?: string }>()
        }
      }

      expectTypeOf(handleExpression).toBeFunction()
    })
  })
})

// ============================================================================
// Union Exhaustiveness Tests
// ============================================================================

describe('PipelineExpression Exhaustiveness', () => {
  it('should handle all expression types in switch statement', () => {
    // This test ensures the union can be exhaustively checked
    // GREEN: Now includes 'send' case for complete exhaustiveness
    function getExpressionDescription(expr: PipelineExpression): string {
      switch (expr.type) {
        case 'call':
          return `Call ${expr.domain}.${expr.method.join('.')}`
        case 'property':
          return `Property ${expr.property}`
        case 'map':
          return 'Map operation'
        case 'conditional':
          return 'Conditional'
        case 'branch':
          return 'Branch'
        case 'match':
          return 'Match'
        case 'waitFor':
          return `Wait for ${expr.eventName}`
        case 'send':
          return `Send ${expr.entity}.${expr.event}`
        case 'literal':
          return `Literal: ${expr.value}`
        case 'placeholder':
          return `Placeholder: ${expr.path.join('.')}`
        default:
          // Exhaustiveness check - should be never if all cases are covered
          const _exhaustive: never = expr
          return _exhaustive
      }
    }

    expectTypeOf(getExpressionDescription).toBeFunction()
  })

  it('should include send in exhaustiveness check after fix', () => {
    // GREEN: 'send' is now included in the union
    type ExpectedTypes = PipelineExpression['type']

    // All expression types including 'send'
    expectTypeOf<ExpectedTypes>().toMatchTypeOf<
      | 'call'
      | 'property'
      | 'map'
      | 'conditional'
      | 'branch'
      | 'match'
      | 'waitFor'
      | 'send'
      | 'literal'
      | 'placeholder'
    >()
  })
})

// ============================================================================
// Integration with on.ts Usage
// ============================================================================

describe('Integration with send proxy (workflows/on.ts)', () => {
  it('should allow send expression creation without type assertion', () => {
    // GREEN: This mirrors the code in workflows/on.ts - no cast needed
    function createSendExpression(
      entity: string,
      event: string,
      payload: unknown
    ): PipelineExpression {
      return {
        type: 'send',
        entity,
        event,
        payload,
      }
    }

    const result = createSendExpression('Customer', 'signup', { email: 'test@example.com.ai' })
    expectTypeOf(result).toMatchTypeOf<PipelineExpression>()
  })
})
