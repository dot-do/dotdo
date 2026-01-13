/**
 * Discriminated Union Types for GraphThing - TDD RED Phase
 *
 * Tests for ThingRegistry that maps typeName to data types, enabling:
 * - Compile-time type safety when accessing .data field
 * - Discriminated union types for known Thing types
 * - Type helper for narrowing GraphThing to TypedThing<T>
 *
 * @see dotdo-xsa65 - [RED] Add discriminated union for GraphThing types
 *
 * Known Thing types in the registry:
 * - User (UserThingData)
 * - Org (OrgThingData)
 * - Role (RoleThingData)
 * - Session (SessionThingData)
 * - Account (AccountThingData)
 * - Agent (AgentThingData)
 * - Function (FunctionData) - CodeFunction, GenerativeFunction, AgenticFunction, HumanFunction
 * - WorkflowTemplate (WorkflowTemplateData)
 * - WorkflowInstance (WorkflowInstanceData)
 * - WorkflowStep (WorkflowStepData)
 * - StepResult (StepResultData)
 * - ApprovalRequest (ApprovalRequestThingData)
 * - Invitation (InvitationThingData)
 * - Team (TeamThingData)
 *
 * @module db/graph/tests/typed-things
 */

import { describe, it, expect, expectTypeOf } from 'vitest'

// ============================================================================
// IMPORTS - Types and utilities to be implemented
// ============================================================================

import type { GraphThing } from '../things'

// These will be implemented in GREEN phase
import type {
  // The main ThingRegistry mapping typeName -> data type
  ThingRegistry,
  // Discriminated union of all known TypedThings
  TypedThing,
  // Extract a specific TypedThing by typeName
  TypedThingFor,
  // Known type names
  KnownTypeName,
  // Extended types with index signatures
  FunctionDataIndexed,
  WorkflowTemplateDataIndexed,
  WorkflowInstanceDataIndexed,
  WorkflowStepDataIndexed,
  StepResultDataIndexed,
} from '../typed-things'

import {
  // Type guard helper
  isTypedThing,
  // Assertion helper that throws if not the expected type
  assertTypedThing,
  // Get typed thing (returns narrowed type or null)
  getTypedThing,
} from '../typed-things'

// Import existing data types for reference
import type { UserThingData, OrgThingData, RoleThingData, SessionThingData, AccountThingData, InvitationThingData, TeamThingData, ApprovalRequestThingData } from '../humans/types'
import type { FunctionData } from '../adapters/function-graph-adapter'
import type { WorkflowTemplateData, WorkflowInstanceData, WorkflowStepData, StepResultData } from '../workflows/types'
import type { AgentThingData } from '../agent-thing'

// ============================================================================
// 1. ThingRegistry Type Tests
// ============================================================================

describe('ThingRegistry', () => {
  describe('type mapping completeness', () => {
    it('maps User to UserThingData', () => {
      // This test verifies compile-time type safety
      type UserData = ThingRegistry['User']
      expectTypeOf<UserData>().toEqualTypeOf<UserThingData>()
    })

    it('maps Org to OrgThingData', () => {
      type OrgData = ThingRegistry['Org']
      expectTypeOf<OrgData>().toEqualTypeOf<OrgThingData>()
    })

    it('maps Role to RoleThingData', () => {
      type RoleData = ThingRegistry['Role']
      expectTypeOf<RoleData>().toEqualTypeOf<RoleThingData>()
    })

    it('maps Session to SessionThingData', () => {
      type SessionData = ThingRegistry['Session']
      expectTypeOf<SessionData>().toEqualTypeOf<SessionThingData>()
    })

    it('maps Account to AccountThingData', () => {
      type AccountData = ThingRegistry['Account']
      expectTypeOf<AccountData>().toEqualTypeOf<AccountThingData>()
    })

    it('maps Agent to AgentThingData', () => {
      type AgentData = ThingRegistry['Agent']
      expectTypeOf<AgentData>().toEqualTypeOf<AgentThingData>()
    })

    it('maps CodeFunction to FunctionDataIndexed', () => {
      type FnData = ThingRegistry['CodeFunction']
      expectTypeOf<FnData>().toEqualTypeOf<FunctionDataIndexed>()
    })

    it('maps GenerativeFunction to FunctionDataIndexed', () => {
      type FnData = ThingRegistry['GenerativeFunction']
      expectTypeOf<FnData>().toEqualTypeOf<FunctionDataIndexed>()
    })

    it('maps AgenticFunction to FunctionDataIndexed', () => {
      type FnData = ThingRegistry['AgenticFunction']
      expectTypeOf<FnData>().toEqualTypeOf<FunctionDataIndexed>()
    })

    it('maps HumanFunction to FunctionDataIndexed', () => {
      type FnData = ThingRegistry['HumanFunction']
      expectTypeOf<FnData>().toEqualTypeOf<FunctionDataIndexed>()
    })

    it('maps WorkflowTemplate to WorkflowTemplateDataIndexed', () => {
      type WfData = ThingRegistry['WorkflowTemplate']
      expectTypeOf<WfData>().toEqualTypeOf<WorkflowTemplateDataIndexed>()
    })

    it('maps WorkflowInstance to WorkflowInstanceDataIndexed', () => {
      type WfData = ThingRegistry['WorkflowInstance']
      expectTypeOf<WfData>().toEqualTypeOf<WorkflowInstanceDataIndexed>()
    })

    it('maps WorkflowStep to WorkflowStepDataIndexed', () => {
      type WfData = ThingRegistry['WorkflowStep']
      expectTypeOf<WfData>().toEqualTypeOf<WorkflowStepDataIndexed>()
    })

    it('maps StepResult to StepResultDataIndexed', () => {
      type WfData = ThingRegistry['StepResult']
      expectTypeOf<WfData>().toEqualTypeOf<StepResultDataIndexed>()
    })

    it('maps ApprovalRequest to ApprovalRequestThingData', () => {
      type Data = ThingRegistry['ApprovalRequest']
      expectTypeOf<Data>().toEqualTypeOf<ApprovalRequestThingData>()
    })

    it('maps Invitation to InvitationThingData', () => {
      type Data = ThingRegistry['Invitation']
      expectTypeOf<Data>().toEqualTypeOf<InvitationThingData>()
    })

    it('maps Team to TeamThingData', () => {
      type Data = ThingRegistry['Team']
      expectTypeOf<Data>().toEqualTypeOf<TeamThingData>()
    })
  })

  describe('KnownTypeName', () => {
    it('includes all known type names', () => {
      // KnownTypeName should be a union of all keys in ThingRegistry
      const userType: KnownTypeName = 'User'
      const orgType: KnownTypeName = 'Org'
      const agentType: KnownTypeName = 'Agent'
      const workflowType: KnownTypeName = 'WorkflowInstance'

      expect(userType).toBe('User')
      expect(orgType).toBe('Org')
      expect(agentType).toBe('Agent')
      expect(workflowType).toBe('WorkflowInstance')
    })

    it('is a string union type', () => {
      expectTypeOf<KnownTypeName>().toBeString()
    })
  })
})

// ============================================================================
// 2. TypedThing Discriminated Union Tests
// ============================================================================

describe('TypedThing', () => {
  describe('discriminated union structure', () => {
    it('discriminates on typeName field', () => {
      // TypedThing should be a discriminated union where typeName is the discriminant
      const userThing: TypedThing = {
        id: 'user-123',
        typeId: 1,
        typeName: 'User',
        data: { email: 'test@example.com', status: 'active' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      // When typeName is 'User', data should be UserThingData
      if (userThing.typeName === 'User') {
        expectTypeOf(userThing.data).toEqualTypeOf<UserThingData | null>()
      }
    })

    it('provides type-safe data access after narrowing', () => {
      const thing: TypedThing = {
        id: 'agent-ralph',
        typeId: 20,
        typeName: 'Agent',
        data: {
          persona: { role: 'engineering', name: 'Ralph', description: 'Engineer' },
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      // After checking typeName, data should be narrowed
      if (thing.typeName === 'Agent' && thing.data) {
        // Should compile: accessing AgentThingData fields
        const model: string = thing.data.model
        const mode: 'autonomous' | 'supervised' | 'manual' = thing.data.mode
        expect(model).toBe('claude-sonnet-4-20250514')
        expect(mode).toBe('autonomous')
      }
    })

    it('handles null data field correctly', () => {
      const thing: TypedThing = {
        id: 'session-123',
        typeId: 4,
        typeName: 'Session',
        data: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      if (thing.typeName === 'Session') {
        // data can be SessionThingData | null
        expectTypeOf(thing.data).toEqualTypeOf<SessionThingData | null>()
      }
    })
  })

  describe('TypedThingFor<T> extraction', () => {
    it('extracts User TypedThing', () => {
      type UserThing = TypedThingFor<'User'>

      const userThing: UserThing = {
        id: 'user-456',
        typeId: 1,
        typeName: 'User',
        data: { email: 'user@example.com', status: 'active' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      // typeName should be literal 'User'
      expectTypeOf(userThing.typeName).toEqualTypeOf<'User'>()
      // data should be UserThingData | null
      expectTypeOf(userThing.data).toEqualTypeOf<UserThingData | null>()
    })

    it('extracts WorkflowInstance TypedThing', () => {
      type WorkflowInstanceThing = TypedThingFor<'WorkflowInstance'>

      const wfThing: WorkflowInstanceThing = {
        id: 'wf-instance-789',
        typeId: 111,
        typeName: 'WorkflowInstance',
        data: {
          templateId: 'template-123',
          stateVerb: 'running',
          input: { orderId: 'order-456' },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      // typeName should be literal 'WorkflowInstance'
      expectTypeOf(wfThing.typeName).toEqualTypeOf<'WorkflowInstance'>()
      // data should be WorkflowInstanceDataIndexed | null
      expectTypeOf(wfThing.data).toEqualTypeOf<WorkflowInstanceDataIndexed | null>()
    })

    it('extracts CodeFunction TypedThing', () => {
      type CodeFunctionThing = TypedThingFor<'CodeFunction'>

      const fnThing: CodeFunctionThing = {
        id: 'fn-code-001',
        typeId: 100,
        typeName: 'CodeFunction',
        data: { name: 'myFunction', type: 'code' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      expectTypeOf(fnThing.typeName).toEqualTypeOf<'CodeFunction'>()
      expectTypeOf(fnThing.data).toEqualTypeOf<FunctionDataIndexed | null>()
    })
  })
})

// ============================================================================
// 3. isTypedThing Type Guard Tests
// ============================================================================

describe('isTypedThing', () => {
  describe('type narrowing', () => {
    it('narrows GraphThing to specific TypedThing when typeName matches', () => {
      const thing: GraphThing = {
        id: 'user-123',
        typeId: 1,
        typeName: 'User',
        data: { email: 'test@example.com', status: 'active' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      if (isTypedThing(thing, 'User')) {
        // After the guard, thing.data should be UserThingData | null
        expectTypeOf(thing.data).toEqualTypeOf<UserThingData | null>()

        // Runtime check
        if (thing.data) {
          expect(thing.data.email).toBe('test@example.com')
          expect(thing.data.status).toBe('active')
        }
      }
    })

    it('returns true for matching typeName', () => {
      const thing: GraphThing = {
        id: 'agent-priya',
        typeId: 20,
        typeName: 'Agent',
        data: {
          persona: { role: 'product', name: 'Priya', description: 'Product Manager' },
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      expect(isTypedThing(thing, 'Agent')).toBe(true)
    })

    it('returns false for non-matching typeName', () => {
      const thing: GraphThing = {
        id: 'user-456',
        typeId: 1,
        typeName: 'User',
        data: { email: 'test@example.com', status: 'active' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      expect(isTypedThing(thing, 'Agent')).toBe(false)
      expect(isTypedThing(thing, 'Session')).toBe(false)
      expect(isTypedThing(thing, 'WorkflowInstance')).toBe(false)
    })

    it('returns false for unknown typeName', () => {
      const thing: GraphThing = {
        id: 'custom-123',
        typeId: 999,
        typeName: 'CustomUnknownType',
        data: { foo: 'bar' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      // Should return false for known type checks
      expect(isTypedThing(thing, 'User')).toBe(false)
      expect(isTypedThing(thing, 'Agent')).toBe(false)
    })

    it('handles null data correctly', () => {
      const thing: GraphThing = {
        id: 'session-empty',
        typeId: 4,
        typeName: 'Session',
        data: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      // Should still return true - typeName matches
      expect(isTypedThing(thing, 'Session')).toBe(true)

      if (isTypedThing(thing, 'Session')) {
        // data is SessionThingData | null
        expect(thing.data).toBeNull()
      }
    })
  })

  describe('validates data structure', () => {
    it('returns false when data does not match expected structure for User', () => {
      const thing: GraphThing = {
        id: 'fake-user',
        typeId: 1,
        typeName: 'User',
        data: { notEmail: 'test@example.com' }, // Missing email field
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      // Should return false because data structure is invalid
      expect(isTypedThing(thing, 'User')).toBe(false)
    })

    it('returns false when data does not match expected structure for Agent', () => {
      const thing: GraphThing = {
        id: 'fake-agent',
        typeId: 20,
        typeName: 'Agent',
        data: { name: 'Not an agent' }, // Missing required fields
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      expect(isTypedThing(thing, 'Agent')).toBe(false)
    })

    it('returns true when data matches expected structure', () => {
      const thing: GraphThing = {
        id: 'valid-workflow',
        typeId: 111,
        typeName: 'WorkflowInstance',
        data: {
          templateId: 'tpl-123',
          stateVerb: 'running',
          input: { orderId: 'order-456' },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      expect(isTypedThing(thing, 'WorkflowInstance')).toBe(true)
    })
  })
})

// ============================================================================
// 4. assertTypedThing Assertion Helper Tests
// ============================================================================

describe('assertTypedThing', () => {
  it('does not throw for matching typeName', () => {
    const thing: GraphThing = {
      id: 'user-123',
      typeId: 1,
      typeName: 'User',
      data: { email: 'test@example.com', status: 'active' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    expect(() => assertTypedThing(thing, 'User')).not.toThrow()
  })

  it('throws for non-matching typeName', () => {
    const thing: GraphThing = {
      id: 'user-123',
      typeId: 1,
      typeName: 'User',
      data: { email: 'test@example.com', status: 'active' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    expect(() => assertTypedThing(thing, 'Agent')).toThrow()
  })

  it('throws with descriptive error message', () => {
    const thing: GraphThing = {
      id: 'session-456',
      typeId: 4,
      typeName: 'Session',
      data: { token: 'tok', userId: 'usr', expiresAt: 12345 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    expect(() => assertTypedThing(thing, 'User')).toThrow(/expected.*User.*got.*Session/i)
  })

  it('narrows type after assertion', () => {
    const thing: GraphThing = {
      id: 'org-acme',
      typeId: 2,
      typeName: 'Org',
      data: { name: 'Acme Corp', slug: 'acme', status: 'active' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    assertTypedThing(thing, 'Org')
    // After assertion, thing.data should be narrowed to OrgThingData | null
    expectTypeOf(thing.data).toEqualTypeOf<OrgThingData | null>()

    if (thing.data) {
      expect(thing.data.name).toBe('Acme Corp')
      expect(thing.data.slug).toBe('acme')
    }
  })
})

// ============================================================================
// 5. getTypedThing Helper Tests
// ============================================================================

describe('getTypedThing', () => {
  it('returns narrowed type for matching typeName', () => {
    const thing: GraphThing = {
      id: 'role-admin',
      typeId: 3,
      typeName: 'Role',
      data: { name: 'Admin', permissions: ['*:*'] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    const typed = getTypedThing(thing, 'Role')

    expect(typed).not.toBeNull()
    if (typed && typed.data) {
      // typed.data should be RoleThingData
      expect(typed.data.name).toBe('Admin')
      expect(typed.data.permissions).toContain('*:*')
    }
  })

  it('returns null for non-matching typeName', () => {
    const thing: GraphThing = {
      id: 'user-123',
      typeId: 1,
      typeName: 'User',
      data: { email: 'test@example.com', status: 'active' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    const typed = getTypedThing(thing, 'Agent')
    expect(typed).toBeNull()
  })

  it('returns null for invalid data structure', () => {
    const thing: GraphThing = {
      id: 'invalid-user',
      typeId: 1,
      typeName: 'User',
      data: { notEmail: 'bad' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    const typed = getTypedThing(thing, 'User')
    expect(typed).toBeNull()
  })

  it('returns correct type for TypedThingFor', () => {
    const thing: GraphThing = {
      id: 'template-order',
      typeId: 110,
      typeName: 'WorkflowTemplate',
      data: { name: 'Order Processing', version: '1.0.0' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    const typed = getTypedThing(thing, 'WorkflowTemplate')

    if (typed) {
      expectTypeOf(typed).toEqualTypeOf<TypedThingFor<'WorkflowTemplate'>>()
      if (typed.data) {
        expect(typed.data.name).toBe('Order Processing')
        expect(typed.data.version).toBe('1.0.0')
      }
    }
  })
})

// ============================================================================
// 6. Real-World Usage Pattern Tests
// ============================================================================

describe('Real-world usage patterns', () => {
  describe('switch statement pattern', () => {
    it('enables exhaustive type checking in switch', () => {
      function handleThing(thing: TypedThing): string {
        switch (thing.typeName) {
          case 'User':
            return thing.data ? `User: ${thing.data.email}` : 'User (no data)'
          case 'Agent':
            return thing.data ? `Agent: ${thing.data.persona.name}` : 'Agent (no data)'
          case 'WorkflowInstance':
            return thing.data ? `Workflow: ${thing.data.stateVerb}` : 'Workflow (no data)'
          case 'Org':
            return thing.data ? `Org: ${thing.data.name}` : 'Org (no data)'
          case 'Role':
            return thing.data ? `Role: ${thing.data.name}` : 'Role (no data)'
          case 'Session':
            return thing.data ? `Session: ${thing.data.userId}` : 'Session (no data)'
          case 'Account':
            return thing.data ? `Account: ${thing.data.provider}` : 'Account (no data)'
          case 'CodeFunction':
          case 'GenerativeFunction':
          case 'AgenticFunction':
          case 'HumanFunction':
            return thing.data ? `Function: ${thing.data.name}` : 'Function (no data)'
          case 'WorkflowTemplate':
            return thing.data ? `Template: ${thing.data.name}` : 'Template (no data)'
          case 'WorkflowStep':
            return thing.data ? `Step: ${thing.data.name}` : 'Step (no data)'
          case 'StepResult':
            return thing.data ? `Result: ${thing.data.stepName}` : 'Result (no data)'
          case 'ApprovalRequest':
            return thing.data ? `Approval: ${thing.data.title}` : 'Approval (no data)'
          case 'Invitation':
            return thing.data ? `Invitation: ${thing.data.email}` : 'Invitation (no data)'
          case 'Team':
            return thing.data ? `Team: ${thing.data.name}` : 'Team (no data)'
          default:
            // TypeScript should flag this if we miss a case
            const _exhaustive: never = thing
            return `Unknown type: ${(_exhaustive as TypedThing).typeName}`
        }
      }

      const userThing: TypedThing = {
        id: 'user-1',
        typeId: 1,
        typeName: 'User',
        data: { email: 'alice@example.com', status: 'active' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      expect(handleThing(userThing)).toBe('User: alice@example.com')
    })
  })

  describe('array filtering pattern', () => {
    it('filters and narrows array of GraphThings', () => {
      const things: GraphThing[] = [
        {
          id: 'user-1',
          typeId: 1,
          typeName: 'User',
          data: { email: 'alice@example.com', status: 'active' },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deletedAt: null,
        },
        {
          id: 'agent-ralph',
          typeId: 20,
          typeName: 'Agent',
          data: {
            persona: { role: 'engineering', name: 'Ralph', description: 'Engineer' },
            model: 'claude-sonnet-4-20250514',
            mode: 'autonomous',
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deletedAt: null,
        },
        {
          id: 'user-2',
          typeId: 1,
          typeName: 'User',
          data: { email: 'bob@example.com', status: 'inactive' },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deletedAt: null,
        },
      ]

      // Filter to only User things with proper typing
      const users = things
        .map((t) => getTypedThing(t, 'User'))
        .filter((t): t is TypedThingFor<'User'> => t !== null)

      expect(users).toHaveLength(2)
      expect(users[0]!.data?.email).toBe('alice@example.com')
      expect(users[1]!.data?.email).toBe('bob@example.com')
    })
  })

  describe('GraphStore integration pattern', () => {
    it('enables typed queries from GraphStore', () => {
      // This tests the pattern of getting things from the store and narrowing them
      const mockGetThing = (id: string): GraphThing | null => {
        if (id === 'wf-123') {
          return {
            id: 'wf-123',
            typeId: 111,
            typeName: 'WorkflowInstance',
            data: {
              templateId: 'tpl-order',
              stateVerb: 'completed',
              input: { orderId: 'order-789' },
              output: { success: true },
            },
            createdAt: Date.now() - 10000,
            updatedAt: Date.now(),
            deletedAt: null,
          }
        }
        return null
      }

      const thing = mockGetThing('wf-123')
      expect(thing).not.toBeNull()

      if (thing && isTypedThing(thing, 'WorkflowInstance') && thing.data) {
        // Now we have full type safety
        expect(thing.data.templateId).toBe('tpl-order')
        expect(thing.data.stateVerb).toBe('completed')
        expect(thing.data.output?.success).toBe(true)
      }
    })
  })
})

// ============================================================================
// 7. Type Safety Compile-Time Tests
// ============================================================================

describe('Compile-time type safety', () => {
  it('prevents accessing wrong data fields', () => {
    const userThing: TypedThingFor<'User'> = {
      id: 'user-1',
      typeId: 1,
      typeName: 'User',
      data: { email: 'test@example.com', status: 'active' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    // This should compile
    if (userThing.data) {
      const email: string = userThing.data.email
      expect(email).toBe('test@example.com')
    }

    // The following would NOT compile (if uncommented):
    // userThing.data?.model // Error: Property 'model' does not exist on type 'UserThingData'
    // userThing.data?.stateVerb // Error: Property 'stateVerb' does not exist on type 'UserThingData'
  })

  it('enforces typeName literal type', () => {
    type UserThing = TypedThingFor<'User'>

    const thing: UserThing = {
      id: 'user-1',
      typeId: 1,
      typeName: 'User', // Must be exactly 'User'
      data: { email: 'test@example.com', status: 'active' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    // typeName should be exactly 'User', not just string
    expectTypeOf(thing.typeName).toEqualTypeOf<'User'>()
  })

  it('TypedThing is assignable to GraphThing', () => {
    const typed: TypedThing = {
      id: 'user-1',
      typeId: 1,
      typeName: 'User',
      data: { email: 'test@example.com', status: 'active' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    // TypedThing should be assignable to GraphThing
    const graph: GraphThing = typed
    expect(graph.id).toBe('user-1')
  })

  it('GraphThing is not directly assignable to specific TypedThingFor', () => {
    // This test documents that narrowing is required
    const graph: GraphThing = {
      id: 'user-1',
      typeId: 1,
      typeName: 'User',
      data: { email: 'test@example.com', status: 'active' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    // Cannot directly assign - need to narrow
    // const typed: TypedThingFor<'User'> = graph // Would not compile

    // Must use type guard
    const typed = getTypedThing(graph, 'User')
    expect(typed).not.toBeNull()
  })
})
