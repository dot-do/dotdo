/**
 * Type ID Consistency Tests
 *
 * Tests to expose type ID inconsistencies across the graph module.
 * These tests are designed to FAIL until type IDs are consolidated.
 *
 * Known Issues Found:
 * - USER_TYPE_ID: 10 in user.ts, but AUTH_TYPE_IDS.User = 1
 * - AGENT_TYPE_ID: 20 in agent-thing.ts, but AGENT_TYPE_IDS.Agent = 300
 * - WORKER_TYPE_ID: 20 in workers.ts (COLLISION with AGENT_TYPE_ID!)
 * - ROLE_TYPE_ID: 100 in role.ts, but HUMAN_TYPE_IDS.Role = 12
 * - TOOL_TYPE_ID: 100 in tools.ts (COLLISION with ROLE_TYPE_ID!)
 * - INVOCATION_TYPE_ID: 150 (COLLISION with HUMAN_EXECUTION_TYPE_IDS.HumanTask!)
 *
 * @see dotdo-m9k01 - [RED] Type ID Consolidation Tests
 *
 * NO MOCKS - these are pure constant/import verification tests
 */

import { describe, it, expect } from 'vitest'

// Import from centralized constants
import {
  AUTH_TYPE_IDS,
  HUMAN_TYPE_IDS,
  GIT_TYPE_IDS,
  FUNCTION_TYPE_IDS,
  FUNCTION_VERSION_TYPE_IDS,
  HUMAN_EXECUTION_TYPE_IDS,
  HUMAN_REQUEST_TYPE_IDS,
  AGENT_TYPE_IDS,
  TYPE_IDS,
  isAuthTypeId,
  isHumanTypeId,
  isGitTypeId,
  isFunctionTypeId,
  isFunctionVersionTypeId,
  isHumanExecutionTypeId,
  isHumanRequestTypeId,
  isAgentTypeId,
} from '../constants'

// Import individual module constants
import { USER_TYPE_ID } from '../user'
import { ROLE_TYPE_ID } from '../role'
import { AGENT_TYPE_ID } from '../agent-thing'
import { WORKER_TYPE_ID } from '../workers'
import { TOOL_TYPE_ID } from '../tools'
import { INVOCATION_TYPE_ID } from '../tool-invocation'

// Import from stores
import { USER_TYPE_ID as ACCOUNT_USER_TYPE_ID } from '../stores/account-thing'

// Import from workflows
import {
  WORKFLOW_TEMPLATE_TYPE_ID,
  WORKFLOW_INSTANCE_TYPE_ID,
  WORKFLOW_STEP_TYPE_ID,
  STEP_RESULT_TYPE_ID,
} from '../workflows/types'

// Import from agents
import { MEMORY_TYPE_ID } from '../agents/memory'
import { CONVERSATION_TYPE_ID } from '../agents/conversation'

// Import from humans
import { HUMAN_TYPE_IDS as HUMANS_MODULE_TYPE_IDS } from '../humans/types'
import { REQUEST_TYPE_IDS } from '../humans/hitl'
import { ORG_TYPE_ID, INVITATION_TYPE_ID } from '../humans/organization'
import { APPROVAL_TYPE_ID } from '../humans/approval'

describe('Type ID Consistency', () => {
  describe('Centralized Constants - Internal Uniqueness', () => {
    it('AUTH_TYPE_IDS should have unique values', () => {
      const values = Object.values(AUTH_TYPE_IDS)
      const uniqueValues = new Set(values)
      expect(values.length).toBe(uniqueValues.size)
    })

    it('HUMAN_TYPE_IDS should have unique values', () => {
      const values = Object.values(HUMAN_TYPE_IDS)
      const uniqueValues = new Set(values)
      expect(values.length).toBe(uniqueValues.size)
    })

    it('GIT_TYPE_IDS should have unique values', () => {
      const values = Object.values(GIT_TYPE_IDS)
      const uniqueValues = new Set(values)
      expect(values.length).toBe(uniqueValues.size)
    })

    it('FUNCTION_TYPE_IDS should have unique values', () => {
      const values = Object.values(FUNCTION_TYPE_IDS)
      const uniqueValues = new Set(values)
      // Note: FUNCTION_TYPE_IDS.Function duplicates CodeFunction (both 100)
      // This is intentional - Function is legacy alias
      expect(values.length).toBe(uniqueValues.size + 1) // +1 for intentional duplicate
    })

    it('FUNCTION_VERSION_TYPE_IDS should have unique values', () => {
      const values = Object.values(FUNCTION_VERSION_TYPE_IDS)
      const uniqueValues = new Set(values)
      expect(values.length).toBe(uniqueValues.size)
    })

    it('HUMAN_EXECUTION_TYPE_IDS should have unique values', () => {
      const values = Object.values(HUMAN_EXECUTION_TYPE_IDS)
      const uniqueValues = new Set(values)
      expect(values.length).toBe(uniqueValues.size)
    })

    it('HUMAN_REQUEST_TYPE_IDS should have unique values', () => {
      const values = Object.values(HUMAN_REQUEST_TYPE_IDS)
      const uniqueValues = new Set(values)
      expect(values.length).toBe(uniqueValues.size)
    })

    it('AGENT_TYPE_IDS should have unique values', () => {
      const values = Object.values(AGENT_TYPE_IDS)
      const uniqueValues = new Set(values)
      expect(values.length).toBe(uniqueValues.size)
    })
  })

  describe('Cross-Group Uniqueness - No Collisions', () => {
    it('AUTH and HUMAN type ID ranges should not overlap (except intentionally)', () => {
      // AUTH is 1-9, HUMAN is 10-29
      const authIds = Object.values(AUTH_TYPE_IDS)
      const humanIds = Object.values(HUMAN_TYPE_IDS)

      const overlap = authIds.filter(id => humanIds.includes(id))
      expect(overlap).toEqual([]) // No overlap expected
    })

    it('GIT type IDs should not collide with HUMAN type IDs', () => {
      const gitIds = Object.values(GIT_TYPE_IDS)
      const humanIds = Object.values(HUMAN_TYPE_IDS)

      const overlap = gitIds.filter(id => humanIds.includes(id))
      expect(overlap).toEqual([])
    })

    it('FUNCTION type IDs should not collide with HUMAN type IDs', () => {
      const functionIds = Object.values(FUNCTION_TYPE_IDS)
      const humanIds = Object.values(HUMAN_TYPE_IDS)

      const overlap = functionIds.filter(id => humanIds.includes(id))
      expect(overlap).toEqual([])
    })

    it('AGENT type IDs should not collide with HUMAN type IDs', () => {
      const agentIds = Object.values(AGENT_TYPE_IDS)
      const humanIds = Object.values(HUMAN_TYPE_IDS)

      const overlap = agentIds.filter(id => humanIds.includes(id))
      expect(overlap).toEqual([])
    })

    it('WORKFLOW type IDs should not collide with FUNCTION type IDs', () => {
      const workflowIds = [
        WORKFLOW_TEMPLATE_TYPE_ID,
        WORKFLOW_INSTANCE_TYPE_ID,
        WORKFLOW_STEP_TYPE_ID,
        STEP_RESULT_TYPE_ID,
      ]
      const functionIds = Object.values(FUNCTION_TYPE_IDS)

      const overlap = workflowIds.filter(id => functionIds.includes(id))
      // KNOWN ISSUE: WORKFLOW_TEMPLATE_TYPE_ID (110) = FUNCTION_TYPE_IDS.FunctionVersion (110)
      // This test exposes the bug
      expect(overlap).toEqual([])
    })
  })

  describe('Module Constants vs Centralized Constants', () => {
    describe('User Type ID', () => {
      it('USER_TYPE_ID from user.ts should match HUMAN_TYPE_IDS.User', () => {
        // user.ts: USER_TYPE_ID = 10
        // constants.ts: HUMAN_TYPE_IDS.User = 10
        expect(USER_TYPE_ID).toBe(HUMAN_TYPE_IDS.User)
      })

      it('USER_TYPE_ID from account-thing.ts should match HUMAN_TYPE_IDS.User', () => {
        // stores/account-thing.ts: USER_TYPE_ID = 10
        // constants.ts: HUMAN_TYPE_IDS.User = 10
        expect(ACCOUNT_USER_TYPE_ID).toBe(HUMAN_TYPE_IDS.User)
      })

      it('USER_TYPE_ID should NOT match AUTH_TYPE_IDS.User (different ranges)', () => {
        // AUTH_TYPE_IDS.User = 1 (legacy compat)
        // HUMAN_TYPE_IDS.User = 10 (canonical)
        expect(USER_TYPE_ID).not.toBe(AUTH_TYPE_IDS.User)
        expect(AUTH_TYPE_IDS.User).toBe(1)
        expect(HUMAN_TYPE_IDS.User).toBe(10)
      })
    })

    describe('Agent Type ID', () => {
      it('AGENT_TYPE_ID from agent-thing.ts should match AGENT_TYPE_IDS.Agent', () => {
        // agent-thing.ts: AGENT_TYPE_ID = 20
        // constants.ts: AGENT_TYPE_IDS.Agent = 300
        // KNOWN BUG: These don't match!
        expect(AGENT_TYPE_ID).toBe(AGENT_TYPE_IDS.Agent)
      })

      it('AGENT_TYPE_ID should be in the agent range (300-349)', () => {
        // agent-thing.ts: AGENT_TYPE_ID = 20 (WRONG - in human range!)
        expect(isAgentTypeId(AGENT_TYPE_ID)).toBe(true)
      })
    })

    describe('Worker Type ID', () => {
      it('WORKER_TYPE_ID should not collide with AGENT_TYPE_ID', () => {
        // workers.ts: WORKER_TYPE_ID = 20
        // agent-thing.ts: AGENT_TYPE_ID = 20
        // KNOWN BUG: COLLISION!
        expect(WORKER_TYPE_ID).not.toBe(AGENT_TYPE_ID)
      })

      it('WORKER_TYPE_ID should be in the human range (10-29) if intended as human-related', () => {
        // workers.ts: WORKER_TYPE_ID = 20
        // Currently in human range but not defined in HUMAN_TYPE_IDS
        const isInHumanRange = isHumanTypeId(WORKER_TYPE_ID)
        const isDefinedInHumanIds = Object.values(HUMAN_TYPE_IDS).includes(WORKER_TYPE_ID)

        // If in human range, should be in HUMAN_TYPE_IDS
        if (isInHumanRange) {
          expect(isDefinedInHumanIds).toBe(true)
        }
      })
    })

    describe('Role Type ID', () => {
      it('ROLE_TYPE_ID from role.ts should match HUMAN_TYPE_IDS.Role', () => {
        // role.ts: ROLE_TYPE_ID = 100
        // constants.ts: HUMAN_TYPE_IDS.Role = 12
        // KNOWN BUG: These don't match!
        expect(ROLE_TYPE_ID).toBe(HUMAN_TYPE_IDS.Role)
      })

      it('ROLE_TYPE_ID should be in the human range (10-29)', () => {
        // role.ts: ROLE_TYPE_ID = 100 (WRONG - in function range!)
        expect(isHumanTypeId(ROLE_TYPE_ID)).toBe(true)
      })

      it('ROLE_TYPE_ID should not collide with FUNCTION_TYPE_IDS', () => {
        // role.ts: ROLE_TYPE_ID = 100
        // constants.ts: FUNCTION_TYPE_IDS.CodeFunction = 100
        // KNOWN BUG: COLLISION!
        const functionIds = Object.values(FUNCTION_TYPE_IDS)
        expect(functionIds).not.toContain(ROLE_TYPE_ID)
      })
    })

    describe('Tool Type ID', () => {
      it('TOOL_TYPE_ID should not collide with ROLE_TYPE_ID', () => {
        // tools.ts: TOOL_TYPE_ID = 100
        // role.ts: ROLE_TYPE_ID = 100
        // KNOWN BUG: COLLISION!
        expect(TOOL_TYPE_ID).not.toBe(ROLE_TYPE_ID)
      })

      it('TOOL_TYPE_ID should not collide with FUNCTION_TYPE_IDS', () => {
        // tools.ts: TOOL_TYPE_ID = 100
        // constants.ts: FUNCTION_TYPE_IDS.CodeFunction = 100
        // KNOWN BUG: COLLISION!
        const functionIds = Object.values(FUNCTION_TYPE_IDS)
        expect(functionIds).not.toContain(TOOL_TYPE_ID)
      })

      it('TOOL_TYPE_ID should match AGENT_TYPE_IDS.Tool if defined', () => {
        // AGENT_TYPE_IDS.Tool = 301
        // tools.ts: TOOL_TYPE_ID = 100
        // KNOWN BUG: These don't match!
        expect(TOOL_TYPE_ID).toBe(AGENT_TYPE_IDS.Tool)
      })
    })

    describe('Invocation Type ID', () => {
      it('INVOCATION_TYPE_ID should not collide with HUMAN_EXECUTION_TYPE_IDS', () => {
        // tool-invocation.ts: INVOCATION_TYPE_ID = 150
        // constants.ts: HUMAN_EXECUTION_TYPE_IDS.HumanTask = 150
        // KNOWN BUG: COLLISION!
        const humanExecIds = Object.values(HUMAN_EXECUTION_TYPE_IDS)
        expect(humanExecIds).not.toContain(INVOCATION_TYPE_ID)
      })
    })

    describe('Organization Type ID', () => {
      it('ORG_TYPE_ID from humans/organization.ts should match HUMAN_TYPE_IDS.Organization', () => {
        expect(ORG_TYPE_ID).toBe(HUMAN_TYPE_IDS.Organization)
      })

      it('INVITATION_TYPE_ID should match HUMAN_TYPE_IDS.Invitation', () => {
        expect(INVITATION_TYPE_ID).toBe(HUMAN_TYPE_IDS.Invitation)
      })
    })

    describe('Approval Type ID', () => {
      it('APPROVAL_TYPE_ID should match HUMAN_TYPE_IDS.ApprovalRequest', () => {
        expect(APPROVAL_TYPE_ID).toBe(HUMAN_TYPE_IDS.ApprovalRequest)
      })
    })

    describe('Human Request Type IDs', () => {
      it('REQUEST_TYPE_IDS should match HUMAN_REQUEST_TYPE_IDS', () => {
        expect(REQUEST_TYPE_IDS.approval).toBe(HUMAN_REQUEST_TYPE_IDS.approval)
        expect(REQUEST_TYPE_IDS.task).toBe(HUMAN_REQUEST_TYPE_IDS.task)
        expect(REQUEST_TYPE_IDS.decision).toBe(HUMAN_REQUEST_TYPE_IDS.decision)
        expect(REQUEST_TYPE_IDS.review).toBe(HUMAN_REQUEST_TYPE_IDS.review)
      })
    })
  })

  describe('Module Re-exports Consistency', () => {
    it('humans/types.ts HUMAN_TYPE_IDS should be identical to constants.ts HUMAN_TYPE_IDS', () => {
      expect(HUMANS_MODULE_TYPE_IDS).toEqual(HUMAN_TYPE_IDS)
    })
  })

  describe('Range Checker Functions', () => {
    it('isAuthTypeId should correctly identify auth range (1-9)', () => {
      expect(isAuthTypeId(1)).toBe(true)
      expect(isAuthTypeId(9)).toBe(true)
      expect(isAuthTypeId(0)).toBe(false)
      expect(isAuthTypeId(10)).toBe(false)
    })

    it('isHumanTypeId should correctly identify human range (10-29)', () => {
      expect(isHumanTypeId(10)).toBe(true)
      expect(isHumanTypeId(29)).toBe(true)
      expect(isHumanTypeId(9)).toBe(false)
      expect(isHumanTypeId(30)).toBe(false)
    })

    it('isGitTypeId should correctly identify git range (50-99)', () => {
      expect(isGitTypeId(50)).toBe(true)
      expect(isGitTypeId(99)).toBe(true)
      expect(isGitTypeId(49)).toBe(false)
      expect(isGitTypeId(100)).toBe(false)
    })

    it('isFunctionTypeId should correctly identify function range (100-119)', () => {
      expect(isFunctionTypeId(100)).toBe(true)
      expect(isFunctionTypeId(119)).toBe(true)
      expect(isFunctionTypeId(99)).toBe(false)
      expect(isFunctionTypeId(120)).toBe(false)
    })

    it('isFunctionVersionTypeId should correctly identify version range (120-129)', () => {
      expect(isFunctionVersionTypeId(120)).toBe(true)
      expect(isFunctionVersionTypeId(129)).toBe(true)
      expect(isFunctionVersionTypeId(119)).toBe(false)
      expect(isFunctionVersionTypeId(130)).toBe(false)
    })

    it('isHumanExecutionTypeId should correctly identify execution range (150-199)', () => {
      expect(isHumanExecutionTypeId(150)).toBe(true)
      expect(isHumanExecutionTypeId(199)).toBe(true)
      expect(isHumanExecutionTypeId(149)).toBe(false)
      expect(isHumanExecutionTypeId(200)).toBe(false)
    })

    it('isHumanRequestTypeId should correctly identify request range (200-249)', () => {
      expect(isHumanRequestTypeId(200)).toBe(true)
      expect(isHumanRequestTypeId(249)).toBe(true)
      expect(isHumanRequestTypeId(199)).toBe(false)
      expect(isHumanRequestTypeId(250)).toBe(false)
    })

    it('isAgentTypeId should correctly identify agent range (300-349)', () => {
      expect(isAgentTypeId(300)).toBe(true)
      expect(isAgentTypeId(349)).toBe(true)
      expect(isAgentTypeId(299)).toBe(false)
      expect(isAgentTypeId(350)).toBe(false)
    })
  })

  describe('Workflow Type IDs', () => {
    it('WORKFLOW_TEMPLATE_TYPE_ID should be in workflow range (not function range)', () => {
      // Currently 110, which is in FUNCTION_TYPE_IDS range
      // Should be in a separate workflow range (e.g., 400-499)
      expect(isFunctionTypeId(WORKFLOW_TEMPLATE_TYPE_ID)).toBe(false)
    })

    it('WORKFLOW_INSTANCE_TYPE_ID should be in workflow range', () => {
      expect(isFunctionTypeId(WORKFLOW_INSTANCE_TYPE_ID)).toBe(false)
    })

    it('WORKFLOW_STEP_TYPE_ID should be in workflow range', () => {
      expect(isFunctionTypeId(WORKFLOW_STEP_TYPE_ID)).toBe(false)
    })

    it('STEP_RESULT_TYPE_ID should be in workflow range', () => {
      expect(isFunctionTypeId(STEP_RESULT_TYPE_ID)).toBe(false)
    })

    it('workflow type IDs should not collide with function type IDs', () => {
      const workflowIds = [
        WORKFLOW_TEMPLATE_TYPE_ID,
        WORKFLOW_INSTANCE_TYPE_ID,
        WORKFLOW_STEP_TYPE_ID,
        STEP_RESULT_TYPE_ID,
      ]
      const functionIds = Object.values(FUNCTION_TYPE_IDS)

      for (const wfId of workflowIds) {
        expect(functionIds).not.toContain(wfId)
      }
    })
  })

  describe('Agent Module Type IDs', () => {
    it('MEMORY_TYPE_ID should not collide with other type IDs', () => {
      // agents/memory.ts: MEMORY_TYPE_ID = 21
      expect(isHumanTypeId(MEMORY_TYPE_ID)).toBe(true)

      // Should be defined in HUMAN_TYPE_IDS if in human range
      const humanIdValues = Object.values(HUMAN_TYPE_IDS)
      // Memory is agent-related but uses ID 21 (in human range)
      // This may be intentional or a bug - test documents current state
      expect(humanIdValues.includes(MEMORY_TYPE_ID) || isAgentTypeId(MEMORY_TYPE_ID)).toBe(true)
    })

    it('CONVERSATION_TYPE_ID should not collide with other type IDs', () => {
      // agents/conversation.ts: CONVERSATION_TYPE_ID = 22
      expect(isHumanTypeId(CONVERSATION_TYPE_ID)).toBe(true)

      // Should be defined in appropriate type ID group
      const humanIdValues = Object.values(HUMAN_TYPE_IDS)
      expect(humanIdValues.includes(CONVERSATION_TYPE_ID) || isAgentTypeId(CONVERSATION_TYPE_ID)).toBe(true)
    })
  })

  describe('TYPE_IDS Combined Object', () => {
    it('should include all AUTH_TYPE_IDS', () => {
      for (const [key, value] of Object.entries(AUTH_TYPE_IDS)) {
        expect(TYPE_IDS[key as keyof typeof TYPE_IDS]).toBe(value)
      }
    })

    it('should include all GIT_TYPE_IDS', () => {
      for (const [key, value] of Object.entries(GIT_TYPE_IDS)) {
        expect(TYPE_IDS[key as keyof typeof TYPE_IDS]).toBe(value)
      }
    })

    it('should include all FUNCTION_TYPE_IDS', () => {
      for (const [key, value] of Object.entries(FUNCTION_TYPE_IDS)) {
        expect(TYPE_IDS[key as keyof typeof TYPE_IDS]).toBe(value)
      }
    })

    it('should include all HUMAN_EXECUTION_TYPE_IDS', () => {
      for (const [key, value] of Object.entries(HUMAN_EXECUTION_TYPE_IDS)) {
        expect(TYPE_IDS[key as keyof typeof TYPE_IDS]).toBe(value)
      }
    })

    it('should include all AGENT_TYPE_IDS', () => {
      for (const [key, value] of Object.entries(AGENT_TYPE_IDS)) {
        expect(TYPE_IDS[key as keyof typeof TYPE_IDS]).toBe(value)
      }
    })

    it('TYPE_IDS values should be unique (no accidental overwrites from spread)', () => {
      // When spreading multiple objects, later values overwrite earlier ones
      // This test checks if any values were lost due to key collisions
      const allExpectedIds = new Set([
        ...Object.values(AUTH_TYPE_IDS),
        ...Object.values(GIT_TYPE_IDS),
        ...Object.values(FUNCTION_TYPE_IDS),
        ...Object.values(HUMAN_EXECUTION_TYPE_IDS),
        ...Object.values(AGENT_TYPE_IDS),
      ])

      const actualIds = new Set(Object.values(TYPE_IDS))

      // Note: This may fail if there are intentional key overlaps (like Function = CodeFunction)
      // The unique count should match expected minus intentional duplicates
      expect(actualIds.size).toBeGreaterThanOrEqual(allExpectedIds.size - 1)
    })
  })

  describe('Summary: Known Type ID Collisions', () => {
    it('documents all known collisions for tracking purposes', () => {
      const knownCollisions = [
        {
          ids: [AGENT_TYPE_ID, WORKER_TYPE_ID],
          value: 20,
          sources: ['agent-thing.ts', 'workers.ts'],
        },
        {
          ids: [ROLE_TYPE_ID, TOOL_TYPE_ID, FUNCTION_TYPE_IDS.CodeFunction],
          value: 100,
          sources: ['role.ts', 'tools.ts', 'constants.ts'],
        },
        {
          ids: [INVOCATION_TYPE_ID, HUMAN_EXECUTION_TYPE_IDS.HumanTask],
          value: 150,
          sources: ['tool-invocation.ts', 'constants.ts'],
        },
        {
          ids: [WORKFLOW_TEMPLATE_TYPE_ID, FUNCTION_TYPE_IDS.FunctionVersion],
          value: 110,
          sources: ['workflows/types.ts', 'constants.ts'],
        },
        {
          ids: [WORKFLOW_INSTANCE_TYPE_ID, FUNCTION_TYPE_IDS.FunctionRef],
          value: 111,
          sources: ['workflows/types.ts', 'constants.ts'],
        },
        {
          ids: [WORKFLOW_STEP_TYPE_ID, FUNCTION_TYPE_IDS.FunctionBlob],
          value: 112,
          sources: ['workflows/types.ts', 'constants.ts'],
        },
      ]

      // This test just documents collisions - it always passes
      // The actual collision tests above will fail until fixed
      expect(knownCollisions.length).toBeGreaterThan(0)
    })
  })
})
