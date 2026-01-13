/**
 * Type Guards for GraphThing Domain Data Types
 *
 * TDD RED Phase: Tests for type guards that will enable safe narrowing
 * without 'as unknown as T' casts across the codebase.
 *
 * These type guards are needed for:
 * - FunctionData (function-graph-adapter.ts)
 * - UserThingData (user.ts, humans/types.ts)
 * - WorkflowInstanceData (workflows/types.ts)
 * - SessionThingData (humans/types.ts)
 * - WorkflowTemplateData (workflows/types.ts)
 * - WorkflowStepData (workflows/types.ts)
 * - StepResultData (workflows/types.ts)
 *
 * @see dotdo-y04jb - [RED] Add type guards for GraphThing domain data types
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// Import types and type guards (will be created in GREEN phase)
// ============================================================================

import {
  // Type guards to be implemented
  isFunctionData,
  isWorkflowInstanceData,
  isWorkflowTemplateData,
  isWorkflowStepData,
  isStepResultData,
  isSessionThingData,
  // Existing type guards to verify
  isUserThingData,
} from '../type-guards'

import type {
  FunctionData,
} from '../adapters/function-graph-adapter'

import type {
  WorkflowInstanceData,
  WorkflowTemplateData,
  WorkflowStepData,
  StepResultData,
} from '../workflows/types'

import type {
  SessionThingData,
  UserThingData,
} from '../humans/types'

// ============================================================================
// 1. FunctionData Type Guard Tests
// ============================================================================

describe('isFunctionData', () => {
  describe('valid FunctionData', () => {
    it('returns true for minimal valid FunctionData', () => {
      const data: FunctionData = {
        name: 'myFunction',
        type: 'code',
      }
      expect(isFunctionData(data)).toBe(true)
    })

    it('returns true for complete FunctionData with all fields', () => {
      const data: FunctionData = {
        name: 'myFunction',
        type: 'generative',
        description: 'A test function',
        handler: 'handlers/test.ts',
        config: { timeout: 5000 },
        version: '1.0.0',
        enabled: true,
      }
      expect(isFunctionData(data)).toBe(true)
    })

    it('returns true for code type', () => {
      const data = { name: 'fn', type: 'code' }
      expect(isFunctionData(data)).toBe(true)
    })

    it('returns true for generative type', () => {
      const data = { name: 'fn', type: 'generative' }
      expect(isFunctionData(data)).toBe(true)
    })

    it('returns true for agentic type', () => {
      const data = { name: 'fn', type: 'agentic' }
      expect(isFunctionData(data)).toBe(true)
    })

    it('returns true for human type', () => {
      const data = { name: 'fn', type: 'human' }
      expect(isFunctionData(data)).toBe(true)
    })

    it('returns true with enabled=false', () => {
      const data = { name: 'fn', type: 'code', enabled: false }
      expect(isFunctionData(data)).toBe(true)
    })
  })

  describe('invalid FunctionData', () => {
    it('returns false for null', () => {
      expect(isFunctionData(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isFunctionData(undefined)).toBe(false)
    })

    it('returns false for string', () => {
      expect(isFunctionData('not a function')).toBe(false)
    })

    it('returns false for number', () => {
      expect(isFunctionData(42)).toBe(false)
    })

    it('returns false for array', () => {
      expect(isFunctionData([{ name: 'fn', type: 'code' }])).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(isFunctionData({})).toBe(false)
    })

    it('returns false when name is missing', () => {
      expect(isFunctionData({ type: 'code' })).toBe(false)
    })

    it('returns false when type is missing', () => {
      expect(isFunctionData({ name: 'fn' })).toBe(false)
    })

    it('returns false when name is not a string', () => {
      expect(isFunctionData({ name: 123, type: 'code' })).toBe(false)
    })

    it('returns false when type is not a valid FunctionType', () => {
      expect(isFunctionData({ name: 'fn', type: 'invalid' })).toBe(false)
    })

    it('returns false when type is not a string', () => {
      expect(isFunctionData({ name: 'fn', type: 123 })).toBe(false)
    })
  })
})

// ============================================================================
// 2. WorkflowInstanceData Type Guard Tests
// ============================================================================

describe('isWorkflowInstanceData', () => {
  describe('valid WorkflowInstanceData', () => {
    it('returns true for minimal valid WorkflowInstanceData', () => {
      const data: WorkflowInstanceData = {
        templateId: 'template-123',
        stateVerb: 'started',
        input: {},
      }
      expect(isWorkflowInstanceData(data)).toBe(true)
    })

    it('returns true for complete WorkflowInstanceData', () => {
      const data: WorkflowInstanceData = {
        templateId: 'template-123',
        stateVerb: 'completed',
        input: { orderId: 'order-456' },
        output: { result: 'success' },
        error: undefined,
        currentStepIndex: 3,
        currentStepName: 'finalStep',
        startedAt: Date.now() - 1000,
        endedAt: Date.now(),
        metadata: { priority: 'high' },
      }
      expect(isWorkflowInstanceData(data)).toBe(true)
    })

    it('returns true with error field set', () => {
      const data = {
        templateId: 'template-123',
        stateVerb: 'failed',
        input: {},
        error: 'Something went wrong',
      }
      expect(isWorkflowInstanceData(data)).toBe(true)
    })
  })

  describe('invalid WorkflowInstanceData', () => {
    it('returns false for null', () => {
      expect(isWorkflowInstanceData(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isWorkflowInstanceData(undefined)).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(isWorkflowInstanceData({})).toBe(false)
    })

    it('returns false when templateId is missing', () => {
      expect(isWorkflowInstanceData({ stateVerb: 'started', input: {} })).toBe(false)
    })

    it('returns false when stateVerb is missing', () => {
      expect(isWorkflowInstanceData({ templateId: 'template-123', input: {} })).toBe(false)
    })

    it('returns false when input is missing', () => {
      expect(isWorkflowInstanceData({ templateId: 'template-123', stateVerb: 'started' })).toBe(false)
    })

    it('returns false when templateId is not a string', () => {
      expect(isWorkflowInstanceData({ templateId: 123, stateVerb: 'started', input: {} })).toBe(false)
    })

    it('returns false when stateVerb is not a string', () => {
      expect(isWorkflowInstanceData({ templateId: 'template-123', stateVerb: 123, input: {} })).toBe(false)
    })

    it('returns false when input is not an object', () => {
      expect(isWorkflowInstanceData({ templateId: 'template-123', stateVerb: 'started', input: 'not object' })).toBe(false)
    })

    it('returns false when input is an array', () => {
      expect(isWorkflowInstanceData({ templateId: 'template-123', stateVerb: 'started', input: [] })).toBe(false)
    })
  })
})

// ============================================================================
// 3. WorkflowTemplateData Type Guard Tests
// ============================================================================

describe('isWorkflowTemplateData', () => {
  describe('valid WorkflowTemplateData', () => {
    it('returns true for minimal valid WorkflowTemplateData', () => {
      const data: WorkflowTemplateData = {
        name: 'Order Processing',
        version: '1.0.0',
      }
      expect(isWorkflowTemplateData(data)).toBe(true)
    })

    it('returns true for complete WorkflowTemplateData', () => {
      const data: WorkflowTemplateData = {
        name: 'Order Processing',
        description: 'Handles order fulfillment',
        version: '2.1.0',
        tags: ['orders', 'fulfillment'],
        triggers: [
          { type: 'event', config: { eventName: 'order.created' } },
        ],
        timeout: 300000,
        metadata: { author: 'system' },
      }
      expect(isWorkflowTemplateData(data)).toBe(true)
    })
  })

  describe('invalid WorkflowTemplateData', () => {
    it('returns false for null', () => {
      expect(isWorkflowTemplateData(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isWorkflowTemplateData(undefined)).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(isWorkflowTemplateData({})).toBe(false)
    })

    it('returns false when name is missing', () => {
      expect(isWorkflowTemplateData({ version: '1.0.0' })).toBe(false)
    })

    it('returns false when version is missing', () => {
      expect(isWorkflowTemplateData({ name: 'Test' })).toBe(false)
    })

    it('returns false when name is not a string', () => {
      expect(isWorkflowTemplateData({ name: 123, version: '1.0.0' })).toBe(false)
    })

    it('returns false when version is not a string', () => {
      expect(isWorkflowTemplateData({ name: 'Test', version: 1 })).toBe(false)
    })
  })
})

// ============================================================================
// 4. WorkflowStepData Type Guard Tests
// ============================================================================

describe('isWorkflowStepData', () => {
  describe('valid WorkflowStepData', () => {
    it('returns true for minimal valid WorkflowStepData', () => {
      const data: WorkflowStepData = {
        name: 'processOrder',
        type: 'action',
        index: 0,
      }
      expect(isWorkflowStepData(data)).toBe(true)
    })

    it('returns true for complete WorkflowStepData', () => {
      const data: WorkflowStepData = {
        name: 'awaitApproval',
        type: 'human',
        description: 'Wait for manager approval',
        index: 2,
        config: {
          timeout: 86400000,
          humanRole: 'manager',
          sla: '24h',
        },
        handler: 'steps/approval.ts',
        metadata: { priority: 'high' },
      }
      expect(isWorkflowStepData(data)).toBe(true)
    })

    it('returns true for action type', () => {
      const data = { name: 'step', type: 'action', index: 0 }
      expect(isWorkflowStepData(data)).toBe(true)
    })

    it('returns true for decision type', () => {
      const data = { name: 'step', type: 'decision', index: 0 }
      expect(isWorkflowStepData(data)).toBe(true)
    })

    it('returns true for parallel type', () => {
      const data = { name: 'step', type: 'parallel', index: 0 }
      expect(isWorkflowStepData(data)).toBe(true)
    })

    it('returns true for wait type', () => {
      const data = { name: 'step', type: 'wait', index: 0 }
      expect(isWorkflowStepData(data)).toBe(true)
    })

    it('returns true for human type', () => {
      const data = { name: 'step', type: 'human', index: 0 }
      expect(isWorkflowStepData(data)).toBe(true)
    })

    it('returns true for subprocess type', () => {
      const data = { name: 'step', type: 'subprocess', index: 0 }
      expect(isWorkflowStepData(data)).toBe(true)
    })
  })

  describe('invalid WorkflowStepData', () => {
    it('returns false for null', () => {
      expect(isWorkflowStepData(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isWorkflowStepData(undefined)).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(isWorkflowStepData({})).toBe(false)
    })

    it('returns false when name is missing', () => {
      expect(isWorkflowStepData({ type: 'action', index: 0 })).toBe(false)
    })

    it('returns false when type is missing', () => {
      expect(isWorkflowStepData({ name: 'step', index: 0 })).toBe(false)
    })

    it('returns false when index is missing', () => {
      expect(isWorkflowStepData({ name: 'step', type: 'action' })).toBe(false)
    })

    it('returns false when name is not a string', () => {
      expect(isWorkflowStepData({ name: 123, type: 'action', index: 0 })).toBe(false)
    })

    it('returns false when type is not a valid WorkflowStepType', () => {
      expect(isWorkflowStepData({ name: 'step', type: 'invalid', index: 0 })).toBe(false)
    })

    it('returns false when index is not a number', () => {
      expect(isWorkflowStepData({ name: 'step', type: 'action', index: '0' })).toBe(false)
    })
  })
})

// ============================================================================
// 5. StepResultData Type Guard Tests
// ============================================================================

describe('isStepResultData', () => {
  describe('valid StepResultData', () => {
    it('returns true for minimal valid StepResultData', () => {
      const data: StepResultData = {
        stepName: 'processOrder',
        output: {},
        createdAt: Date.now(),
      }
      expect(isStepResultData(data)).toBe(true)
    })

    it('returns true for StepResultData with complex output', () => {
      const data: StepResultData = {
        stepName: 'calculateTotal',
        output: {
          total: 99.99,
          items: ['a', 'b', 'c'],
          nested: { deep: { value: true } },
        },
        createdAt: 1704067200000,
      }
      expect(isStepResultData(data)).toBe(true)
    })
  })

  describe('invalid StepResultData', () => {
    it('returns false for null', () => {
      expect(isStepResultData(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isStepResultData(undefined)).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(isStepResultData({})).toBe(false)
    })

    it('returns false when stepName is missing', () => {
      expect(isStepResultData({ output: {}, createdAt: Date.now() })).toBe(false)
    })

    it('returns false when output is missing', () => {
      expect(isStepResultData({ stepName: 'step', createdAt: Date.now() })).toBe(false)
    })

    it('returns false when createdAt is missing', () => {
      expect(isStepResultData({ stepName: 'step', output: {} })).toBe(false)
    })

    it('returns false when stepName is not a string', () => {
      expect(isStepResultData({ stepName: 123, output: {}, createdAt: Date.now() })).toBe(false)
    })

    it('returns false when output is not an object', () => {
      expect(isStepResultData({ stepName: 'step', output: 'not object', createdAt: Date.now() })).toBe(false)
    })

    it('returns false when output is an array', () => {
      expect(isStepResultData({ stepName: 'step', output: [], createdAt: Date.now() })).toBe(false)
    })

    it('returns false when createdAt is not a number', () => {
      expect(isStepResultData({ stepName: 'step', output: {}, createdAt: '2024-01-01' })).toBe(false)
    })
  })
})

// ============================================================================
// 6. SessionThingData Type Guard Tests
// ============================================================================

describe('isSessionThingData', () => {
  describe('valid SessionThingData', () => {
    it('returns true for minimal valid SessionThingData', () => {
      const data: SessionThingData = {
        token: 'session-token-abc123',
        userId: 'user-123',
        expiresAt: Date.now() + 86400000,
      }
      expect(isSessionThingData(data)).toBe(true)
    })

    it('returns true for complete SessionThingData', () => {
      const data: SessionThingData = {
        token: 'session-token-abc123',
        userId: 'user-123',
        expiresAt: Date.now() + 86400000,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        ipAddress: '192.168.1.1',
        deviceFingerprint: 'fp-xyz789',
        isFresh: true,
        lastActivityAt: Date.now(),
        metadata: { source: 'web' },
      }
      expect(isSessionThingData(data)).toBe(true)
    })
  })

  describe('invalid SessionThingData', () => {
    it('returns false for null', () => {
      expect(isSessionThingData(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isSessionThingData(undefined)).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(isSessionThingData({})).toBe(false)
    })

    it('returns false when token is missing', () => {
      expect(isSessionThingData({ userId: 'user-123', expiresAt: Date.now() })).toBe(false)
    })

    it('returns false when userId is missing', () => {
      expect(isSessionThingData({ token: 'token', expiresAt: Date.now() })).toBe(false)
    })

    it('returns false when expiresAt is missing', () => {
      expect(isSessionThingData({ token: 'token', userId: 'user-123' })).toBe(false)
    })

    it('returns false when token is not a string', () => {
      expect(isSessionThingData({ token: 123, userId: 'user-123', expiresAt: Date.now() })).toBe(false)
    })

    it('returns false when userId is not a string', () => {
      expect(isSessionThingData({ token: 'token', userId: 123, expiresAt: Date.now() })).toBe(false)
    })

    it('returns false when expiresAt is not a number', () => {
      expect(isSessionThingData({ token: 'token', userId: 'user-123', expiresAt: '2024-12-31' })).toBe(false)
    })
  })
})

// ============================================================================
// 7. UserThingData Type Guard Tests (existing but verify/extend)
// ============================================================================

describe('isUserThingData', () => {
  describe('valid UserThingData', () => {
    it('returns true for minimal valid UserThingData', () => {
      const data: UserThingData = {
        email: 'test@example.com',
        status: 'active',
      }
      expect(isUserThingData(data)).toBe(true)
    })

    it('returns true for complete UserThingData', () => {
      const data: UserThingData = {
        email: 'test@example.com',
        name: 'Test User',
        displayName: 'Test',
        firstName: 'Test',
        lastName: 'User',
        status: 'active',
        emailVerified: true,
        avatarUrl: 'https://example.com/avatar.png',
        bio: 'A test user',
        timezone: 'America/New_York',
        locale: 'en-US',
        phone: '+1234567890',
        phoneVerified: true,
        externalId: 'ext-123',
        externalProvider: 'google',
        lastSignInAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: { source: 'signup' },
      }
      expect(isUserThingData(data)).toBe(true)
    })

    it('returns true for each valid status', () => {
      const statuses = ['active', 'inactive', 'suspended', 'pending', 'deleted'] as const
      for (const status of statuses) {
        expect(isUserThingData({ email: 'test@example.com', status })).toBe(true)
      }
    })
  })

  describe('invalid UserThingData', () => {
    it('returns false for null', () => {
      expect(isUserThingData(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isUserThingData(undefined)).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(isUserThingData({})).toBe(false)
    })

    it('returns false when email is missing', () => {
      expect(isUserThingData({ status: 'active' })).toBe(false)
    })

    it('returns false when status is missing', () => {
      expect(isUserThingData({ email: 'test@example.com' })).toBe(false)
    })

    it('returns false when email is not a string', () => {
      expect(isUserThingData({ email: 123, status: 'active' })).toBe(false)
    })

    it('returns false when status is not a string', () => {
      expect(isUserThingData({ email: 'test@example.com', status: 123 })).toBe(false)
    })
  })
})

// ============================================================================
// 8. Type Guard Utility Tests
// ============================================================================

describe('Type guard utilities', () => {
  describe('type narrowing works correctly', () => {
    it('narrows FunctionData correctly in conditionals', () => {
      const data: unknown = { name: 'fn', type: 'code' }
      if (isFunctionData(data)) {
        // TypeScript should allow accessing FunctionData properties here
        const _name: string = data.name
        const _type: 'code' | 'generative' | 'agentic' | 'human' = data.type
        expect(_name).toBe('fn')
        expect(_type).toBe('code')
      } else {
        // This branch should not execute
        expect.fail('isFunctionData should return true')
      }
    })

    it('narrows WorkflowInstanceData correctly in conditionals', () => {
      const data: unknown = { templateId: 'tpl', stateVerb: 'running', input: { x: 1 } }
      if (isWorkflowInstanceData(data)) {
        // TypeScript should allow accessing WorkflowInstanceData properties here
        const _templateId: string = data.templateId
        const _stateVerb: string = data.stateVerb
        const _input: Record<string, unknown> = data.input
        expect(_templateId).toBe('tpl')
        expect(_stateVerb).toBe('running')
        expect(_input).toEqual({ x: 1 })
      } else {
        expect.fail('isWorkflowInstanceData should return true')
      }
    })

    it('narrows SessionThingData correctly in conditionals', () => {
      const data: unknown = { token: 'tok', userId: 'usr', expiresAt: 12345 }
      if (isSessionThingData(data)) {
        // TypeScript should allow accessing SessionThingData properties here
        const _token: string = data.token
        const _userId: string = data.userId
        const _expiresAt: number = data.expiresAt
        expect(_token).toBe('tok')
        expect(_userId).toBe('usr')
        expect(_expiresAt).toBe(12345)
      } else {
        expect.fail('isSessionThingData should return true')
      }
    })
  })

  describe('works with GraphThing.data', () => {
    it('safely narrows GraphThing data field', () => {
      // Simulate a GraphThing with unknown data
      const thing = {
        id: 'fn-123',
        typeId: 100,
        typeName: 'CodeFunction',
        data: { name: 'myFunc', type: 'code' } as unknown,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      if (isFunctionData(thing.data)) {
        expect(thing.data.name).toBe('myFunc')
        expect(thing.data.type).toBe('code')
      } else {
        expect.fail('isFunctionData should narrow the data field')
      }
    })
  })
})

// ============================================================================
// 9. COMPLETENESS TESTS - Missing Property Checks (RED PHASE)
// ============================================================================
// These tests expose incomplete type guards that don't fully validate data shapes

describe('Type Guard Completeness Tests', () => {
  // --------------------------------------------------------------------------
  // 9.1 isUserThingData - Missing Property Checks
  // --------------------------------------------------------------------------
  describe('isUserThingData completeness', () => {
    describe('status validation', () => {
      // FAILING: Current implementation accepts any string for status
      it('returns false for invalid status values', () => {
        // Status should be one of: 'active' | 'inactive' | 'suspended' | 'pending' | 'deleted'
        const invalidStatuses = ['unknown', 'blocked', 'banned', 'ACTIVE', 'Active', '', ' ']
        for (const status of invalidStatuses) {
          expect(isUserThingData({ email: 'test@example.com', status })).toBe(false)
        }
      })

      it('returns false when status is null', () => {
        expect(isUserThingData({ email: 'test@example.com', status: null })).toBe(false)
      })

      it('returns false when status is an object', () => {
        expect(isUserThingData({ email: 'test@example.com', status: {} })).toBe(false)
      })
    })

    describe('email validation', () => {
      // Tests for basic email format validation
      it('returns false when email is empty string', () => {
        expect(isUserThingData({ email: '', status: 'active' })).toBe(false)
      })

      it('returns false when email is null', () => {
        expect(isUserThingData({ email: null, status: 'active' })).toBe(false)
      })
    })

    describe('optional property validation', () => {
      // Optional properties should be validated when present
      it('returns false when name is present but not a string or null', () => {
        expect(isUserThingData({ email: 'test@example.com', status: 'active', name: 123 })).toBe(false)
        expect(isUserThingData({ email: 'test@example.com', status: 'active', name: {} })).toBe(false)
        expect(isUserThingData({ email: 'test@example.com', status: 'active', name: [] })).toBe(false)
      })

      it('returns false when emailVerified is present but not a boolean', () => {
        expect(isUserThingData({ email: 'test@example.com', status: 'active', emailVerified: 'yes' })).toBe(false)
        expect(isUserThingData({ email: 'test@example.com', status: 'active', emailVerified: 1 })).toBe(false)
        expect(isUserThingData({ email: 'test@example.com', status: 'active', emailVerified: null })).toBe(false)
      })

      it('returns false when lastSignInAt is present but not a number or null', () => {
        expect(isUserThingData({ email: 'test@example.com', status: 'active', lastSignInAt: '2024-01-01' })).toBe(false)
        expect(isUserThingData({ email: 'test@example.com', status: 'active', lastSignInAt: {} })).toBe(false)
      })

      it('returns false when metadata is present but not an object', () => {
        expect(isUserThingData({ email: 'test@example.com', status: 'active', metadata: 'invalid' })).toBe(false)
        expect(isUserThingData({ email: 'test@example.com', status: 'active', metadata: 123 })).toBe(false)
        expect(isUserThingData({ email: 'test@example.com', status: 'active', metadata: [] })).toBe(false)
      })
    })

    describe('prototype pollution protection', () => {
      it('handles objects with null prototype', () => {
        const data = Object.create(null)
        data.email = 'test@example.com'
        data.status = 'active'
        expect(isUserThingData(data)).toBe(true)
      })

      it('ignores inherited properties', () => {
        const proto = { email: 'inherited@example.com', status: 'active' }
        const data = Object.create(proto)
        // Object has no own properties, should fail
        expect(isUserThingData(data)).toBe(false)
      })
    })
  })

  // --------------------------------------------------------------------------
  // 9.2 isFunctionData - Type Validation
  // --------------------------------------------------------------------------
  describe('isFunctionData completeness', () => {
    describe('type field validation', () => {
      it('returns false for similar but invalid type strings', () => {
        // Type should be exactly: 'code' | 'generative' | 'agentic' | 'human'
        const invalidTypes = ['CODE', 'Code', 'generic', 'agent', 'humans', '', ' ', 'function']
        for (const type of invalidTypes) {
          expect(isFunctionData({ name: 'fn', type })).toBe(false)
        }
      })
    })

    describe('optional property validation', () => {
      it('returns false when enabled is present but not a boolean', () => {
        expect(isFunctionData({ name: 'fn', type: 'code', enabled: 'true' })).toBe(false)
        expect(isFunctionData({ name: 'fn', type: 'code', enabled: 1 })).toBe(false)
        expect(isFunctionData({ name: 'fn', type: 'code', enabled: null })).toBe(false)
      })

      it('returns false when version is present but not a string', () => {
        expect(isFunctionData({ name: 'fn', type: 'code', version: 1.0 })).toBe(false)
        expect(isFunctionData({ name: 'fn', type: 'code', version: {} })).toBe(false)
      })

      it('returns false when handler is present but not a string', () => {
        expect(isFunctionData({ name: 'fn', type: 'code', handler: 123 })).toBe(false)
        expect(isFunctionData({ name: 'fn', type: 'code', handler: {} })).toBe(false)
      })

      it('returns false when config is present but not an object', () => {
        expect(isFunctionData({ name: 'fn', type: 'code', config: 'invalid' })).toBe(false)
        expect(isFunctionData({ name: 'fn', type: 'code', config: [] })).toBe(false)
      })
    })
  })

  // --------------------------------------------------------------------------
  // 9.3 isSessionThingData - Required Property Validation
  // --------------------------------------------------------------------------
  describe('isSessionThingData completeness', () => {
    describe('expiresAt validation', () => {
      it('returns false when expiresAt is negative', () => {
        expect(isSessionThingData({ token: 'tok', userId: 'usr', expiresAt: -1 })).toBe(false)
      })

      it('returns false when expiresAt is NaN', () => {
        expect(isSessionThingData({ token: 'tok', userId: 'usr', expiresAt: NaN })).toBe(false)
      })

      it('returns false when expiresAt is Infinity', () => {
        expect(isSessionThingData({ token: 'tok', userId: 'usr', expiresAt: Infinity })).toBe(false)
      })
    })

    describe('optional property validation', () => {
      it('returns false when isFresh is present but not a boolean', () => {
        expect(isSessionThingData({ token: 'tok', userId: 'usr', expiresAt: 12345, isFresh: 'yes' })).toBe(false)
        expect(isSessionThingData({ token: 'tok', userId: 'usr', expiresAt: 12345, isFresh: 1 })).toBe(false)
      })

      it('returns false when lastActivityAt is present but not a number', () => {
        expect(isSessionThingData({ token: 'tok', userId: 'usr', expiresAt: 12345, lastActivityAt: '2024' })).toBe(false)
      })
    })
  })

  // --------------------------------------------------------------------------
  // 9.4 isWorkflowInstanceData - Input Object Validation
  // --------------------------------------------------------------------------
  describe('isWorkflowInstanceData completeness', () => {
    describe('input object validation', () => {
      it('returns false when input is null', () => {
        expect(isWorkflowInstanceData({ templateId: 'tpl', stateVerb: 'running', input: null })).toBe(false)
      })
    })

    describe('optional property validation', () => {
      it('returns false when output is present but not an object', () => {
        expect(isWorkflowInstanceData({
          templateId: 'tpl',
          stateVerb: 'running',
          input: {},
          output: 'result',
        })).toBe(false)
      })

      it('returns false when output is an array', () => {
        expect(isWorkflowInstanceData({
          templateId: 'tpl',
          stateVerb: 'running',
          input: {},
          output: [],
        })).toBe(false)
      })

      it('returns false when currentStepIndex is present but not a number', () => {
        expect(isWorkflowInstanceData({
          templateId: 'tpl',
          stateVerb: 'running',
          input: {},
          currentStepIndex: '0',
        })).toBe(false)
      })

      it('returns false when startedAt is present but not a number', () => {
        expect(isWorkflowInstanceData({
          templateId: 'tpl',
          stateVerb: 'running',
          input: {},
          startedAt: '2024-01-01',
        })).toBe(false)
      })
    })
  })

  // --------------------------------------------------------------------------
  // 9.5 isWorkflowStepData - Step Type Validation
  // --------------------------------------------------------------------------
  describe('isWorkflowStepData completeness', () => {
    describe('type field validation', () => {
      it('returns false for similar but invalid step types', () => {
        // Type should be exactly: 'action' | 'decision' | 'parallel' | 'wait' | 'human' | 'subprocess'
        const invalidTypes = ['ACTION', 'Action', 'branch', 'fork', 'join', 'approval', '', ' ']
        for (const type of invalidTypes) {
          expect(isWorkflowStepData({ name: 'step', type, index: 0 })).toBe(false)
        }
      })
    })

    describe('index validation', () => {
      it('returns false when index is negative', () => {
        expect(isWorkflowStepData({ name: 'step', type: 'action', index: -1 })).toBe(false)
      })

      it('returns false when index is NaN', () => {
        expect(isWorkflowStepData({ name: 'step', type: 'action', index: NaN })).toBe(false)
      })

      it('returns false when index is a float', () => {
        expect(isWorkflowStepData({ name: 'step', type: 'action', index: 1.5 })).toBe(false)
      })
    })

    describe('optional property validation', () => {
      it('returns false when config is present but not an object', () => {
        expect(isWorkflowStepData({ name: 'step', type: 'action', index: 0, config: 'invalid' })).toBe(false)
      })

      it('returns false when handler is present but not a string', () => {
        expect(isWorkflowStepData({ name: 'step', type: 'action', index: 0, handler: 123 })).toBe(false)
      })
    })
  })

  // --------------------------------------------------------------------------
  // 9.6 isStepResultData - Output Validation
  // --------------------------------------------------------------------------
  describe('isStepResultData completeness', () => {
    describe('createdAt validation', () => {
      it('returns false when createdAt is negative', () => {
        expect(isStepResultData({ stepName: 'step', output: {}, createdAt: -1 })).toBe(false)
      })

      it('returns false when createdAt is NaN', () => {
        expect(isStepResultData({ stepName: 'step', output: {}, createdAt: NaN })).toBe(false)
      })
    })

    describe('output validation', () => {
      it('returns false when output is null', () => {
        expect(isStepResultData({ stepName: 'step', output: null, createdAt: 12345 })).toBe(false)
      })
    })
  })

  // --------------------------------------------------------------------------
  // 9.7 isWorkflowTemplateData - Version Validation
  // --------------------------------------------------------------------------
  describe('isWorkflowTemplateData completeness', () => {
    describe('optional property validation', () => {
      it('returns false when tags is present but not an array', () => {
        expect(isWorkflowTemplateData({ name: 'Workflow', version: '1.0.0', tags: 'tag1' })).toBe(false)
        expect(isWorkflowTemplateData({ name: 'Workflow', version: '1.0.0', tags: {} })).toBe(false)
      })

      it('returns false when triggers is present but not an array', () => {
        expect(isWorkflowTemplateData({ name: 'Workflow', version: '1.0.0', triggers: {} })).toBe(false)
      })

      it('returns false when timeout is present but not a number', () => {
        expect(isWorkflowTemplateData({ name: 'Workflow', version: '1.0.0', timeout: '5000' })).toBe(false)
      })
    })
  })
})

// ============================================================================
// 10. EDGE CASES - Runtime vs Compile-time Safety
// ============================================================================

describe('Runtime vs Compile-time Type Safety', () => {
  describe('handles JavaScript type coercion edge cases', () => {
    it('rejects objects that would pass loose equality checks', () => {
      // Objects that JavaScript might coerce unexpectedly
      expect(isUserThingData({ email: { toString: () => 'test@example.com' }, status: 'active' })).toBe(false)
      expect(isFunctionData({ name: { valueOf: () => 'fn' }, type: 'code' })).toBe(false)
    })

    it('rejects Symbol properties', () => {
      const sym = Symbol('email')
      const obj = { [sym]: 'test@example.com', status: 'active' }
      expect(isUserThingData(obj)).toBe(false)
    })

    it('rejects objects with non-enumerable required properties', () => {
      const obj = {}
      Object.defineProperty(obj, 'email', { value: 'test@example.com', enumerable: false })
      Object.defineProperty(obj, 'status', { value: 'active', enumerable: false })
      // Should still work since we access by property name, not enumeration
      expect(isUserThingData(obj)).toBe(true)
    })
  })

  describe('handles frozen and sealed objects', () => {
    it('accepts frozen valid objects', () => {
      const frozen = Object.freeze({ email: 'test@example.com', status: 'active' })
      expect(isUserThingData(frozen)).toBe(true)
    })

    it('accepts sealed valid objects', () => {
      const sealed = Object.seal({ email: 'test@example.com', status: 'active' })
      expect(isUserThingData(sealed)).toBe(true)
    })
  })

  describe('handles class instances', () => {
    it('accepts plain class instances with valid data', () => {
      class UserData {
        email = 'test@example.com'
        status: 'active' = 'active'
      }
      const instance = new UserData()
      expect(isUserThingData(instance)).toBe(true)
    })

    it('rejects class instances with getter-only properties', () => {
      class UserData {
        get email() {
          return 'test@example.com'
        }
        get status(): 'active' {
          return 'active'
        }
      }
      const instance = new UserData()
      // Getters should still work since they're accessed like normal properties
      expect(isUserThingData(instance)).toBe(true)
    })
  })
})
