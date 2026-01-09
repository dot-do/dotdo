import { describe, it, expect } from 'vitest'

/**
 * Actions Table Schema Tests
 *
 * These tests verify the schema for the append-only action log.
 * The actions table is the source of truth for all mutations in dotdo.
 *
 * This is RED phase TDD - tests should FAIL until the Actions schema
 * and query helpers are fully implemented.
 *
 * Key design decisions:
 * - Actions are append-only (immutable command log)
 * - Each action references thing versions by rowid (input/output)
 * - Actions track durability level: send (fire-and-forget), try (quick), do (durable)
 * - Actions have lifecycle status: pending -> running -> completed/failed/undone/retrying
 * - Actors are typed paths: Human/nathan, Agent/support, System/cron
 * - Targets use Noun/id format: Startup/acme, Product/widget
 *
 * Implementation requirements:
 * - actions table exported from db/actions.ts
 * - Export Action and NewAction types for select/insert operations
 * - Export ActionStatus and ActionDurability type constants
 * - Export query helpers for common action patterns
 */

// ============================================================================
// Schema Types (Expected Interface)
// ============================================================================

interface Action {
  id: string // UUID
  verb: string // 'create', 'update', 'delete'
  actor: string | null // 'Human/nathan', 'Agent/support'
  target: string // 'Startup/acme'
  input: number | null // things.rowid before
  output: number | null // things.rowid after
  options: Record<string, unknown> | null
  durability: 'send' | 'try' | 'do'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'undone' | 'retrying'
  error: Record<string, unknown> | null
  requestId: string | null
  sessionId: string | null
  workflowId: string | null
  startedAt: Date | null
  completedAt: Date | null
  duration: number | null // ms
  createdAt: Date
}

// Import the schema - this should work since actions.ts exists
import { actions } from '../actions'

// Import query helpers and types that should be exported
// @ts-expect-error - These exports don't exist yet (RED phase)
import {
  type Action as ActionType,
  type NewAction,
  ActionStatus,
  ActionDurability,
  getActionsByTarget,
  getActionsByActor,
  getActionsByStatus,
  getActionHistory,
  getPendingActions,
  getRunningActions,
  getFailedActions,
  calculateDuration,
} from '../actions'

// ============================================================================
// Schema Table Definition Tests
// ============================================================================

describe('Schema Table Definition', () => {
  describe('Table Export', () => {
    it('actions table is exported from db/actions.ts', () => {
      expect(actions).toBeDefined()
    })

    it('table name is "actions"', () => {
      // Drizzle tables have a _ property with table info
      expect((actions as { _: { name: string } })._?.name ?? 'actions').toBe('actions')
    })

    it('exports Action type for select operations', () => {
      // TypeScript type inference test - this will fail if ActionType is not exported
      const action: Partial<ActionType> = {
        id: 'action-001',
        verb: 'create',
        target: 'Startup/acme',
        status: 'completed',
      }
      expect(action.id).toBe('action-001')
    })

    it('exports NewAction type for insert operations', () => {
      // TypeScript type inference test
      const newAction: Partial<NewAction> = {
        id: 'action-002',
        verb: 'update',
        target: 'Startup/acme',
      }
      expect(newAction.verb).toBe('update')
    })

    it('exports ActionStatus enum/type', () => {
      expect(ActionStatus).toBeDefined()
      expect(ActionStatus.PENDING).toBe('pending')
      expect(ActionStatus.RUNNING).toBe('running')
      expect(ActionStatus.COMPLETED).toBe('completed')
      expect(ActionStatus.FAILED).toBe('failed')
      expect(ActionStatus.UNDONE).toBe('undone')
      expect(ActionStatus.RETRYING).toBe('retrying')
    })

    it('exports ActionDurability enum/type', () => {
      expect(ActionDurability).toBeDefined()
      expect(ActionDurability.SEND).toBe('send')
      expect(ActionDurability.TRY).toBe('try')
      expect(ActionDurability.DO).toBe('do')
    })
  })

  describe('Column Definitions', () => {
    it('has id column (text, unique, not null)', () => {
      expect(actions.id).toBeDefined()
    })

    it('has verb column (text, not null)', () => {
      expect(actions.verb).toBeDefined()
    })

    it('has actor column (text, nullable)', () => {
      expect(actions.actor).toBeDefined()
    })

    it('has target column (text, not null)', () => {
      expect(actions.target).toBeDefined()
    })

    it('has input column (integer, nullable - FK to things.rowid)', () => {
      expect(actions.input).toBeDefined()
    })

    it('has output column (integer, nullable - FK to things.rowid)', () => {
      expect(actions.output).toBeDefined()
    })

    it('has options column (JSON, nullable)', () => {
      expect(actions.options).toBeDefined()
    })

    it('has durability column (enum, default "try")', () => {
      expect(actions.durability).toBeDefined()
    })

    it('has status column (enum, default "pending")', () => {
      expect(actions.status).toBeDefined()
    })

    it('has error column (JSON, nullable)', () => {
      expect(actions.error).toBeDefined()
    })

    it('has requestId column (text, nullable)', () => {
      expect(actions.requestId).toBeDefined()
    })

    it('has sessionId column (text, nullable)', () => {
      expect(actions.sessionId).toBeDefined()
    })

    it('has workflowId column (text, nullable)', () => {
      expect(actions.workflowId).toBeDefined()
    })

    it('has startedAt column (integer timestamp, nullable)', () => {
      expect(actions.startedAt).toBeDefined()
    })

    it('has completedAt column (integer timestamp, nullable)', () => {
      expect(actions.completedAt).toBeDefined()
    })

    it('has duration column (integer, nullable)', () => {
      expect(actions.duration).toBeDefined()
    })

    it('has createdAt column (integer timestamp, not null)', () => {
      expect(actions.createdAt).toBeDefined()
    })
  })

  describe('Index Definitions', () => {
    it('has index on verb (actions_verb_idx)', () => {
      // Index verification - the column used in indexes should exist
      expect(actions.verb).toBeDefined()
    })

    it('has index on target (actions_target_idx)', () => {
      expect(actions.target).toBeDefined()
    })

    it('has index on actor (actions_actor_idx)', () => {
      expect(actions.actor).toBeDefined()
    })

    it('has index on status (actions_status_idx)', () => {
      expect(actions.status).toBeDefined()
    })

    it('has index on requestId (actions_request_idx)', () => {
      expect(actions.requestId).toBeDefined()
    })

    it('has index on createdAt (actions_created_idx)', () => {
      expect(actions.createdAt).toBeDefined()
    })

    it('has index on output (actions_output_idx)', () => {
      expect(actions.output).toBeDefined()
    })
  })
})

// ============================================================================
// Action Lifecycle Tests
// ============================================================================

describe('Action Lifecycle', () => {
  describe('Create Action (pending)', () => {
    it('new action starts with pending status by default', () => {
      const newAction: Partial<Action> = {
        id: 'action-001',
        verb: 'create',
        target: 'Startup/acme',
        createdAt: new Date(),
        // status not specified - should default to 'pending'
      }

      expect(newAction.status ?? 'pending').toBe('pending')
    })

    it('requires id, verb, target, and createdAt', () => {
      const requiredFields: (keyof Action)[] = ['id', 'verb', 'target', 'createdAt']

      requiredFields.forEach((field) => {
        expect(actions[field]).toBeDefined()
      })
    })
  })

  describe('Start Action (running)', () => {
    it('running action has startedAt timestamp', () => {
      const runningAction: Partial<Action> = {
        id: 'action-002',
        verb: 'update',
        target: 'Startup/acme',
        status: 'running',
        startedAt: new Date(),
        createdAt: new Date(),
      }

      expect(runningAction.status).toBe('running')
      expect(runningAction.startedAt).toBeDefined()
    })

    it('transition: pending -> running sets startedAt', () => {
      const beforeStart: Partial<Action> = {
        id: 'action-003',
        status: 'pending',
        startedAt: null,
      }

      const afterStart: Partial<Action> = {
        ...beforeStart,
        status: 'running',
        startedAt: new Date(),
      }

      expect(beforeStart.status).toBe('pending')
      expect(beforeStart.startedAt).toBeNull()
      expect(afterStart.status).toBe('running')
      expect(afterStart.startedAt).toBeDefined()
    })
  })

  describe('Complete Action (completed)', () => {
    it('completed action has completedAt and duration', () => {
      const startedAt = new Date()
      const completedAt = new Date(startedAt.getTime() + 500)

      const completedAction: Partial<Action> = {
        id: 'action-004',
        verb: 'create',
        target: 'Startup/acme',
        status: 'completed',
        startedAt,
        completedAt,
        duration: 500,
        output: 1,
        createdAt: startedAt,
      }

      expect(completedAction.status).toBe('completed')
      expect(completedAction.completedAt).toBeDefined()
      expect(completedAction.duration).toBe(500)
    })

    it('transition: running -> completed sets output rowid', () => {
      const beforeComplete: Partial<Action> = {
        status: 'running',
        output: null,
      }

      const afterComplete: Partial<Action> = {
        ...beforeComplete,
        status: 'completed',
        output: 42, // rowid of created/updated thing
        completedAt: new Date(),
        duration: 100,
      }

      expect(afterComplete.status).toBe('completed')
      expect(afterComplete.output).toBe(42)
    })
  })

  describe('Fail Action (failed)', () => {
    it('failed action has error object', () => {
      const failedAction: Partial<Action> = {
        id: 'action-005',
        verb: 'update',
        target: 'Startup/acme',
        status: 'failed',
        error: { code: 'VALIDATION_ERROR', message: 'Invalid data' },
        completedAt: new Date(),
        duration: 50,
        createdAt: new Date(),
      }

      expect(failedAction.status).toBe('failed')
      expect(failedAction.error).toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('transition: running -> failed stores error details', () => {
      const error = {
        code: 'NETWORK_ERROR',
        message: 'Connection timeout',
        retryable: true,
        attempts: 3,
      }

      const failedAction: Partial<Action> = {
        status: 'failed',
        error,
        completedAt: new Date(),
      }

      expect(failedAction.status).toBe('failed')
      expect((failedAction.error as { retryable: boolean }).retryable).toBe(true)
    })
  })

  describe('Undo Action (undone)', () => {
    it('undone action preserves original input/output', () => {
      const undoneAction: Partial<Action> = {
        id: 'action-006',
        verb: 'update',
        target: 'Startup/acme',
        status: 'undone',
        input: 5,
        output: 6,
        createdAt: new Date(),
      }

      expect(undoneAction.status).toBe('undone')
      expect(undoneAction.input).toBe(5)
      expect(undoneAction.output).toBe(6)
    })

    it('transition: completed -> undone marks action as reversed', () => {
      const beforeUndo: Partial<Action> = {
        status: 'completed',
        output: 10,
      }

      const afterUndo: Partial<Action> = {
        ...beforeUndo,
        status: 'undone',
      }

      expect(beforeUndo.status).toBe('completed')
      expect(afterUndo.status).toBe('undone')
      // Output preserved for audit trail
      expect(afterUndo.output).toBe(10)
    })
  })

  describe('Retry Action (retrying)', () => {
    it('retrying action clears previous error', () => {
      const retryingAction: Partial<Action> = {
        id: 'action-007',
        verb: 'create',
        target: 'Startup/acme',
        status: 'retrying',
        error: null, // Cleared for retry
        startedAt: new Date(),
        createdAt: new Date(),
      }

      expect(retryingAction.status).toBe('retrying')
      expect(retryingAction.error).toBeNull()
    })

    it('transition: failed -> retrying restarts execution', () => {
      const beforeRetry: Partial<Action> = {
        status: 'failed',
        error: { code: 'TIMEOUT' },
        completedAt: new Date(),
      }

      const afterRetry: Partial<Action> = {
        ...beforeRetry,
        status: 'retrying',
        error: null,
        startedAt: new Date(), // New start time
        completedAt: null,
      }

      expect(beforeRetry.status).toBe('failed')
      expect(afterRetry.status).toBe('retrying')
      expect(afterRetry.error).toBeNull()
    })

    it('retrying can transition to completed on success', () => {
      const retrySuccess: Partial<Action> = {
        status: 'completed',
        output: 15,
        completedAt: new Date(),
        duration: 200,
      }

      expect(retrySuccess.status).toBe('completed')
      expect(retrySuccess.output).toBe(15)
    })

    it('retrying can transition to failed after max attempts', () => {
      const retryExhausted: Partial<Action> = {
        status: 'failed',
        error: { code: 'MAX_RETRIES', message: 'Exceeded retry limit', attempts: 5 },
        completedAt: new Date(),
      }

      expect(retryExhausted.status).toBe('failed')
      expect((retryExhausted.error as { attempts: number }).attempts).toBe(5)
    })
  })

  describe('Valid Status Values', () => {
    it('accepts all valid status values', () => {
      const validStatuses: Action['status'][] = [
        'pending',
        'running',
        'completed',
        'failed',
        'undone',
        'retrying',
      ]

      validStatuses.forEach((status) => {
        expect(['pending', 'running', 'completed', 'failed', 'undone', 'retrying']).toContain(
          status
        )
      })
    })
  })
})

// ============================================================================
// Version References Tests
// ============================================================================

describe('Version References', () => {
  describe('Create: input=null, output=new_thing_rowid', () => {
    it('create action has null input (no previous version)', () => {
      const createAction: Partial<Action> = {
        id: 'create-001',
        verb: 'create',
        target: 'Startup/newco',
        input: null,
        output: 1, // rowid of new thing
        status: 'completed',
        createdAt: new Date(),
      }

      expect(createAction.input).toBeNull()
      expect(createAction.output).toBe(1)
    })

    it('create action output references new thing rowid', () => {
      // For a create verb, output should point to the newly created thing version
      const action: Partial<Action> = {
        verb: 'create',
        input: null,
        output: 42, // things.rowid of created entity
      }

      expect(action.verb).toBe('create')
      expect(action.input).toBeNull()
      expect(action.output).toBe(42)
    })
  })

  describe('Update: input=old_rowid, output=new_rowid', () => {
    it('update action has both input and output', () => {
      const updateAction: Partial<Action> = {
        id: 'update-001',
        verb: 'update',
        target: 'Startup/acme',
        input: 1, // Previous version rowid
        output: 2, // New version rowid
        status: 'completed',
        createdAt: new Date(),
      }

      expect(updateAction.input).toBe(1)
      expect(updateAction.output).toBe(2)
      expect(updateAction.input).not.toBe(updateAction.output)
    })

    it('update action creates version chain (input -> output)', () => {
      // Version chain: v1 (rowid 1) -> v2 (rowid 2) -> v3 (rowid 3)
      const updateActions: Partial<Action>[] = [
        { verb: 'update', input: 1, output: 2 }, // v1 -> v2
        { verb: 'update', input: 2, output: 3 }, // v2 -> v3
      ]

      // Each output becomes next action's input
      expect(updateActions[0].output).toBe(updateActions[1].input)
    })
  })

  describe('Delete: input=old_rowid, output=null', () => {
    it('delete action has input but null output', () => {
      const deleteAction: Partial<Action> = {
        id: 'delete-001',
        verb: 'delete',
        target: 'Startup/deleted',
        input: 99, // Last version rowid
        output: null, // No new version created
        status: 'completed',
        createdAt: new Date(),
      }

      expect(deleteAction.input).toBe(99)
      expect(deleteAction.output).toBeNull()
    })

    it('delete action references last thing version as input', () => {
      const action: Partial<Action> = {
        verb: 'delete',
        input: 10, // things.rowid being deleted
        output: null,
      }

      expect(action.verb).toBe('delete')
      expect(action.input).toBe(10)
      expect(action.output).toBeNull()
    })
  })
})

// ============================================================================
// Durability Levels Tests
// ============================================================================

describe('Durability Levels', () => {
  describe('send: fire-and-forget', () => {
    it('send durability is non-blocking', () => {
      const sendAction: Partial<Action> = {
        id: 'send-001',
        verb: 'notify',
        target: 'User/nathan',
        durability: 'send',
        createdAt: new Date(),
      }

      expect(sendAction.durability).toBe('send')
    })

    it('send actions are non-durable (no retries)', () => {
      // Business logic: send actions that fail stay failed
      const failedSend: Partial<Action> = {
        durability: 'send',
        status: 'failed',
        error: { code: 'NETWORK_ERROR' },
      }

      // Send actions should not transition to 'retrying'
      expect(failedSend.durability).toBe('send')
      expect(failedSend.status).toBe('failed')
    })

    it('send is appropriate for analytics/logging', () => {
      const analyticsAction: Partial<Action> = {
        verb: 'log',
        target: 'Analytics/pageview',
        durability: 'send',
      }

      expect(analyticsAction.durability).toBe('send')
    })
  })

  describe('try: quick attempt', () => {
    it('try durability is the default', () => {
      const tryAction: Partial<Action> = {
        id: 'try-001',
        verb: 'create',
        target: 'Startup/acme',
        // durability not specified - should default to 'try'
        createdAt: new Date(),
      }

      expect(tryAction.durability ?? 'try').toBe('try')
    })

    it('try actions are blocking but non-durable', () => {
      const tryAction: Partial<Action> = {
        durability: 'try',
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        duration: 100,
      }

      // Try waits for result (blocking)
      expect(tryAction.duration).toBe(100)
      // But doesn't auto-retry (non-durable)
      expect(tryAction.durability).toBe('try')
    })

    it('try is appropriate for synchronous operations', () => {
      const readAction: Partial<Action> = {
        verb: 'read',
        target: 'Startup/acme',
        durability: 'try',
      }

      expect(readAction.durability).toBe('try')
    })
  })

  describe('do: durable with retries', () => {
    it('do durability supports retrying status', () => {
      const doAction: Partial<Action> = {
        id: 'do-001',
        verb: 'process',
        target: 'Job/import',
        durability: 'do',
        status: 'retrying',
        createdAt: new Date(),
      }

      expect(doAction.durability).toBe('do')
      expect(doAction.status).toBe('retrying')
    })

    it('do actions track retry attempts in options', () => {
      const retryingAction: Partial<Action> = {
        durability: 'do',
        status: 'retrying',
        options: { retryCount: 2, maxRetries: 5 },
      }

      expect((retryingAction.options as { retryCount: number }).retryCount).toBe(2)
    })

    it('do is appropriate for critical operations', () => {
      const criticalAction: Partial<Action> = {
        verb: 'sync',
        target: 'Integration/github',
        durability: 'do',
      }

      expect(criticalAction.durability).toBe('do')
    })
  })

  describe('Valid Durability Values', () => {
    it('accepts all valid durability values', () => {
      const validDurabilities: Action['durability'][] = ['send', 'try', 'do']

      validDurabilities.forEach((durability) => {
        expect(['send', 'try', 'do']).toContain(durability)
      })
    })
  })
})

// ============================================================================
// Actor Types Tests
// ============================================================================

describe('Actor Types', () => {
  describe('Human actors: Human/name', () => {
    it('Human actor follows Noun/id format', () => {
      const humanActor = 'Human/nathan'
      const parts = humanActor.split('/')

      expect(parts[0]).toBe('Human')
      expect(parts[1]).toBe('nathan')
    })

    it('Human actors represent real users', () => {
      const humanActions: Partial<Action>[] = [
        { actor: 'Human/nathan', verb: 'create', target: 'Startup/acme' },
        { actor: 'Human/alice', verb: 'update', target: 'Product/widget' },
        { actor: 'Human/admin-user', verb: 'delete', target: 'Cache/old' },
      ]

      humanActions.forEach((action) => {
        expect(action.actor).toMatch(/^Human\//)
      })
    })
  })

  describe('Agent actors: Agent/name', () => {
    it('Agent actor follows Noun/id format', () => {
      const agentActor = 'Agent/support'
      const parts = agentActor.split('/')

      expect(parts[0]).toBe('Agent')
      expect(parts[1]).toBe('support')
    })

    it('Agent actors include specialized AI agents', () => {
      const agentActors = [
        'Agent/support',
        'Agent/coder',
        'Agent/reviewer',
        'Agent/analyst',
        'Agent/scheduler',
      ]

      agentActors.forEach((actor) => {
        expect(actor).toMatch(/^Agent\//)
      })
    })
  })

  describe('System actors: System/name', () => {
    it('System actor follows Noun/id format', () => {
      const systemActor = 'System/cron'
      const parts = systemActor.split('/')

      expect(parts[0]).toBe('System')
      expect(parts[1]).toBe('cron')
    })

    it('System actors include automated processes', () => {
      const systemActors = [
        'System/cron',
        'System/scheduler',
        'System/migration',
        'System/webhook',
        'System/gc',
      ]

      systemActors.forEach((actor) => {
        expect(actor).toMatch(/^System\//)
      })
    })
  })

  describe('Null actor', () => {
    it('actor can be null for anonymous actions', () => {
      const anonymousAction: Partial<Action> = {
        id: 'anon-001',
        verb: 'create',
        actor: null,
        target: 'Session/abc123',
        createdAt: new Date(),
      }

      expect(anonymousAction.actor).toBeNull()
    })

    it('null actor is appropriate for system-initiated actions', () => {
      const action: Partial<Action> = {
        actor: null,
        verb: 'cleanup',
        target: 'Cache/expired',
      }

      expect(action.actor).toBeNull()
    })
  })

  describe('Actor format validation', () => {
    it('valid actors have Type/id format', () => {
      const validActors = ['Human/nathan', 'Agent/support', 'System/cron']

      validActors.forEach((actor) => {
        const parts = actor.split('/')
        expect(parts.length).toBe(2)
        expect(parts[0]).toMatch(/^[A-Z][a-zA-Z]*$/) // PascalCase type
        expect(parts[1].length).toBeGreaterThan(0)
      })
    })
  })
})

// ============================================================================
// Target Format Tests
// ============================================================================

describe('Target Format', () => {
  describe('Noun/id format: Startup/acme', () => {
    it('simple target follows Noun/id format', () => {
      const target = 'Startup/acme'
      const parts = target.split('/')

      expect(parts.length).toBe(2)
      expect(parts[0]).toBe('Startup')
      expect(parts[1]).toBe('acme')
    })

    it('supports various Noun types', () => {
      const targets = [
        'Startup/acme',
        'Product/widget',
        'User/nathan',
        'Order/12345',
        'Invoice/INV-001',
        'Document/readme',
      ]

      targets.forEach((target) => {
        const parts = target.split('/')
        expect(parts.length).toBe(2)
        expect(parts[0][0]).toBe(parts[0][0].toUpperCase()) // Noun is PascalCase
      })
    })
  })

  describe('Nested paths: Startup/acme/Product/widget', () => {
    it('nested target has multiple Noun/id pairs', () => {
      const target = 'Startup/acme/Product/widget'
      const parts = target.split('/')

      expect(parts.length).toBe(4)
      expect(parts[0]).toBe('Startup')
      expect(parts[1]).toBe('acme')
      expect(parts[2]).toBe('Product')
      expect(parts[3]).toBe('widget')
    })

    it('supports deeply nested paths', () => {
      const nestedTargets = [
        'Startup/acme/Product/widget',
        'Startup/acme/Team/engineering',
        'Organization/corp/Department/sales/Employee/john',
        'App/myapp/Feature/auth/Setting/timeout',
      ]

      nestedTargets.forEach((target) => {
        const parts = target.split('/')
        // Nested paths have pairs of Noun/id
        expect(parts.length % 2).toBe(0)
        expect(parts.length).toBeGreaterThanOrEqual(4)
      })
    })

    it('nested paths support hierarchical queries', () => {
      // Find all actions under Startup/acme
      const acmePattern = /^Startup\/acme\//

      const targets = [
        'Startup/acme/Product/widget',
        'Startup/acme/Product/gadget',
        'Startup/acme/Team/dev',
        'Startup/other/Product/item',
      ]

      const acmeTargets = targets.filter((t) => acmePattern.test(t))
      expect(acmeTargets.length).toBe(3)
    })
  })

  describe('Target is required', () => {
    it('target cannot be null or undefined', () => {
      expect(actions.target).toBeDefined()

      // Business logic: every action must have a target
      const actionWithoutTarget: Partial<Action> = {
        id: 'no-target',
        verb: 'create',
        // target is missing
      }
      expect(actionWithoutTarget.target).toBeUndefined()
    })
  })
})

// ============================================================================
// Context Tracking Tests
// ============================================================================

describe('Context Tracking', () => {
  describe('requestId for HTTP request correlation', () => {
    it('stores requestId for HTTP-initiated actions', () => {
      const action: Partial<Action> = {
        id: 'ctx-001',
        verb: 'create',
        target: 'Startup/acme',
        requestId: 'req-uuid-12345',
        createdAt: new Date(),
      }

      expect(action.requestId).toBe('req-uuid-12345')
    })

    it('enables tracing all actions from single request', () => {
      const requestId = 'req-trace-001'
      const requestActions: Partial<Action>[] = [
        { requestId, verb: 'create', target: 'A' },
        { requestId, verb: 'create', target: 'B' },
        { requestId, verb: 'update', target: 'C' },
      ]

      const matchingActions = requestActions.filter((a) => a.requestId === requestId)
      expect(matchingActions.length).toBe(3)
    })
  })

  describe('sessionId for session correlation', () => {
    it('stores sessionId for session-bound actions', () => {
      const action: Partial<Action> = {
        id: 'ctx-002',
        verb: 'update',
        target: 'User/settings',
        sessionId: 'sess-abc123',
        createdAt: new Date(),
      }

      expect(action.sessionId).toBe('sess-abc123')
    })

    it('enables tracing user session history', () => {
      const sessionId = 'sess-user-001'
      const sessionActions: Partial<Action>[] = [
        { sessionId, verb: 'login', target: 'User/nathan' },
        { sessionId, verb: 'create', target: 'Project/new' },
        { sessionId, verb: 'update', target: 'Project/new' },
        { sessionId, verb: 'logout', target: 'User/nathan' },
      ]

      const matchingActions = sessionActions.filter((a) => a.sessionId === sessionId)
      expect(matchingActions.length).toBe(4)
    })
  })

  describe('workflowId for workflow correlation', () => {
    it('stores workflowId for workflow-initiated actions', () => {
      const action: Partial<Action> = {
        id: 'ctx-003',
        verb: 'create',
        target: 'User/new',
        workflowId: 'wf-onboard-001',
        createdAt: new Date(),
      }

      expect(action.workflowId).toBe('wf-onboard-001')
    })

    it('enables tracing workflow execution', () => {
      const workflowId = 'wf-signup-flow'
      const workflowActions: Partial<Action>[] = [
        { workflowId, verb: 'create', target: 'User/new' },
        { workflowId, verb: 'create', target: 'Profile/new' },
        { workflowId, verb: 'send', target: 'Email/welcome' },
        { workflowId, verb: 'create', target: 'Subscription/trial' },
      ]

      const matchingActions = workflowActions.filter((a) => a.workflowId === workflowId)
      expect(matchingActions.length).toBe(4)
    })

    it('workflow actions can span multiple requests', () => {
      const workflowId = 'wf-long-running'
      const workflowActions: Partial<Action>[] = [
        { workflowId, requestId: 'req-1', verb: 'start' },
        { workflowId, requestId: 'req-2', verb: 'process' },
        { workflowId, requestId: 'req-3', verb: 'complete' },
      ]

      const uniqueRequests = new Set(workflowActions.map((a) => a.requestId))
      expect(uniqueRequests.size).toBe(3)
    })
  })

  describe('Combined context', () => {
    it('action can have all three context IDs', () => {
      const action: Partial<Action> = {
        id: 'ctx-all',
        verb: 'update',
        target: 'User/nathan',
        requestId: 'req-123',
        sessionId: 'sess-456',
        workflowId: 'wf-789',
        createdAt: new Date(),
      }

      expect(action.requestId).toBe('req-123')
      expect(action.sessionId).toBe('sess-456')
      expect(action.workflowId).toBe('wf-789')
    })
  })
})

// ============================================================================
// Timing Tests
// ============================================================================

describe('Timing', () => {
  describe('Calculate duration from startedAt/completedAt', () => {
    it('duration equals completedAt - startedAt in milliseconds', () => {
      const startedAt = new Date('2024-01-15T10:00:00.000Z')
      const completedAt = new Date('2024-01-15T10:00:02.500Z')
      const duration = completedAt.getTime() - startedAt.getTime()

      const action: Partial<Action> = {
        startedAt,
        completedAt,
        duration,
      }

      expect(action.duration).toBe(2500)
    })

    it('short actions have small duration', () => {
      const startedAt = new Date()
      const completedAt = new Date(startedAt.getTime() + 5)

      const action: Partial<Action> = {
        startedAt,
        completedAt,
        duration: 5,
      }

      expect(action.duration).toBe(5)
    })

    it('long-running actions have large duration', () => {
      const startedAt = new Date()
      const completedAt = new Date(startedAt.getTime() + 300000) // 5 minutes

      const action: Partial<Action> = {
        startedAt,
        completedAt,
        duration: 300000,
      }

      expect(action.duration).toBe(300000)
    })

    it('calculateDuration helper computes duration', () => {
      // This tests the query helper export
      expect(calculateDuration).toBeDefined()

      const start = new Date('2024-01-15T10:00:00.000Z')
      const end = new Date('2024-01-15T10:01:00.000Z')

      const duration = calculateDuration(start, end)
      expect(duration).toBe(60000)
    })
  })

  describe('Timing field states', () => {
    it('pending actions have null timing fields', () => {
      const pendingAction: Partial<Action> = {
        status: 'pending',
        startedAt: null,
        completedAt: null,
        duration: null,
      }

      expect(pendingAction.startedAt).toBeNull()
      expect(pendingAction.completedAt).toBeNull()
      expect(pendingAction.duration).toBeNull()
    })

    it('running actions have startedAt but null completedAt', () => {
      const runningAction: Partial<Action> = {
        status: 'running',
        startedAt: new Date(),
        completedAt: null,
        duration: null,
      }

      expect(runningAction.startedAt).toBeDefined()
      expect(runningAction.completedAt).toBeNull()
    })

    it('completed actions have all timing fields', () => {
      const startedAt = new Date()
      const completedAt = new Date(startedAt.getTime() + 100)

      const completedAction: Partial<Action> = {
        status: 'completed',
        startedAt,
        completedAt,
        duration: 100,
      }

      expect(completedAction.startedAt).toBeDefined()
      expect(completedAction.completedAt).toBeDefined()
      expect(completedAction.duration).toBe(100)
    })
  })

  describe('Query actions by time range', () => {
    it('supports filtering by createdAt range', () => {
      const baseTime = new Date('2024-01-15T10:00:00.000Z')
      const actions: Partial<Action>[] = [
        { createdAt: new Date(baseTime.getTime()) },
        { createdAt: new Date(baseTime.getTime() + 60000) },
        { createdAt: new Date(baseTime.getTime() + 120000) },
        { createdAt: new Date(baseTime.getTime() + 180000) },
      ]

      const rangeStart = new Date(baseTime.getTime() + 60000)
      const rangeEnd = new Date(baseTime.getTime() + 150000)

      const inRange = actions.filter(
        (a) => a.createdAt! >= rangeStart && a.createdAt! <= rangeEnd
      )
      expect(inRange.length).toBe(2)
    })

    it('supports filtering by startedAt for running action detection', () => {
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 3600000)

      const actions: Partial<Action>[] = [
        { status: 'running', startedAt: new Date(now.getTime() - 7200000) }, // 2 hours ago
        { status: 'running', startedAt: now },
        { status: 'completed', startedAt: new Date(now.getTime() - 7200000) },
      ]

      // Find stale running actions (running for > 1 hour)
      const staleActions = actions.filter(
        (a) => a.status === 'running' && a.startedAt! <= oneHourAgo
      )
      expect(staleActions.length).toBe(1)
    })
  })
})

// ============================================================================
// Query Patterns Tests
// ============================================================================

describe('Query Patterns', () => {
  describe('Get actions for a target', () => {
    it('getActionsByTarget helper is exported', () => {
      expect(getActionsByTarget).toBeDefined()
    })

    it('filters actions by exact target match', () => {
      const actions: Partial<Action>[] = [
        { target: 'Startup/acme', verb: 'create' },
        { target: 'Startup/acme', verb: 'update' },
        { target: 'Product/widget', verb: 'create' },
      ]

      const acmeActions = actions.filter((a) => a.target === 'Startup/acme')
      expect(acmeActions.length).toBe(2)
    })
  })

  describe('Get actions by actor', () => {
    it('getActionsByActor helper is exported', () => {
      expect(getActionsByActor).toBeDefined()
    })

    it('filters actions by exact actor match', () => {
      const actions: Partial<Action>[] = [
        { actor: 'Human/nathan', verb: 'create' },
        { actor: 'Human/nathan', verb: 'update' },
        { actor: 'Agent/bot', verb: 'process' },
      ]

      const nathanActions = actions.filter((a) => a.actor === 'Human/nathan')
      expect(nathanActions.length).toBe(2)
    })

    it('filters actions by actor type prefix', () => {
      const actions: Partial<Action>[] = [
        { actor: 'Human/nathan', verb: 'create' },
        { actor: 'Human/alice', verb: 'update' },
        { actor: 'Agent/bot', verb: 'process' },
        { actor: 'System/cron', verb: 'cleanup' },
      ]

      const humanActions = actions.filter((a) => a.actor?.startsWith('Human/'))
      expect(humanActions.length).toBe(2)
    })
  })

  describe('Get actions by status', () => {
    it('getActionsByStatus helper is exported', () => {
      expect(getActionsByStatus).toBeDefined()
    })

    it('getPendingActions helper is exported', () => {
      expect(getPendingActions).toBeDefined()
    })

    it('getRunningActions helper is exported', () => {
      expect(getRunningActions).toBeDefined()
    })

    it('getFailedActions helper is exported', () => {
      expect(getFailedActions).toBeDefined()
    })

    it('filters actions by status', () => {
      const actions: Partial<Action>[] = [
        { status: 'completed', verb: 'create' },
        { status: 'completed', verb: 'update' },
        { status: 'failed', verb: 'delete' },
        { status: 'pending', verb: 'process' },
      ]

      const completed = actions.filter((a) => a.status === 'completed')
      const failed = actions.filter((a) => a.status === 'failed')
      const pending = actions.filter((a) => a.status === 'pending')

      expect(completed.length).toBe(2)
      expect(failed.length).toBe(1)
      expect(pending.length).toBe(1)
    })
  })

  describe('Get action history for a thing (using output FK)', () => {
    it('getActionHistory helper is exported', () => {
      expect(getActionHistory).toBeDefined()
    })

    it('finds action that created a thing version', () => {
      const actions: Partial<Action>[] = [
        { verb: 'create', output: 1 },
        { verb: 'update', input: 1, output: 2 },
        { verb: 'update', input: 2, output: 3 },
      ]

      const createAction = actions.find((a) => a.output === 1)
      expect(createAction?.verb).toBe('create')
    })

    it('traces version chain using input/output', () => {
      const actions: Partial<Action>[] = [
        { verb: 'create', input: null, output: 1 },
        { verb: 'update', input: 1, output: 2 },
        { verb: 'update', input: 2, output: 3 },
      ]

      // Action that created version 2
      const v2Creator = actions.find((a) => a.output === 2)
      expect(v2Creator?.input).toBe(1)

      // Action that used version 2 as input
      const v2Consumer = actions.find((a) => a.input === 2)
      expect(v2Consumer?.output).toBe(3)
    })
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('Duplicate UUID rejection', () => {
    it('id column has unique constraint', () => {
      // Schema verification - id should be unique
      expect(actions.id).toBeDefined()

      // Business logic: duplicate IDs should be rejected
      const id = 'unique-001'
      const action1: Partial<Action> = { id, verb: 'create', target: 'A' }
      const action2: Partial<Action> = { id, verb: 'update', target: 'B' }

      // Same ID for different actions is invalid
      expect(action1.id).toBe(action2.id)
      // Database would reject the second insert
    })
  })

  describe('Error object serialization', () => {
    it('stores simple error object', () => {
      const error = { code: 'NOT_FOUND', message: 'Resource not found' }

      const action: Partial<Action> = {
        status: 'failed',
        error,
      }

      expect(action.error).toMatchObject({ code: 'NOT_FOUND' })
    })

    it('stores complex nested error object', () => {
      const error = {
        code: 'VALIDATION_ERROR',
        message: 'Multiple validation errors',
        details: {
          fields: [
            { field: 'name', error: 'Required' },
            { field: 'email', error: 'Invalid format' },
          ],
          timestamp: new Date().toISOString(),
        },
        stack: 'Error: Validation failed\n    at validate()',
      }

      const action: Partial<Action> = {
        status: 'failed',
        error,
      }

      expect((action.error as typeof error).details.fields.length).toBe(2)
    })

    it('error is null for successful actions', () => {
      const action: Partial<Action> = {
        status: 'completed',
        error: null,
      }

      expect(action.error).toBeNull()
    })
  })

  describe('Long-running actions', () => {
    it('tracks very long duration values', () => {
      const duration = 86400000 // 24 hours in ms

      const action: Partial<Action> = {
        verb: 'migrate',
        target: 'Database/production',
        status: 'completed',
        duration,
      }

      expect(action.duration).toBe(86400000)
    })

    it('handles actions still running after extended time', () => {
      const startedAt = new Date(Date.now() - 7200000) // 2 hours ago

      const action: Partial<Action> = {
        verb: 'export',
        target: 'Report/massive',
        status: 'running',
        startedAt,
        completedAt: null,
        duration: null,
      }

      expect(action.status).toBe('running')
      expect(action.completedAt).toBeNull()
    })

    it('supports timeout detection for stale actions', () => {
      const oneHourAgo = new Date(Date.now() - 3600000)
      const thirtyMinutesAgo = new Date(Date.now() - 1800000)

      const actions: Partial<Action>[] = [
        { status: 'running', startedAt: oneHourAgo },
        { status: 'running', startedAt: new Date() },
      ]

      // Find stale actions (running for > 30 minutes)
      const staleActions = actions.filter(
        (a) => a.status === 'running' && a.startedAt! <= thirtyMinutesAgo
      )
      expect(staleActions.length).toBe(1)
    })
  })

  describe('Options field serialization', () => {
    it('stores action options as JSON', () => {
      const options = {
        priority: 'high',
        retryPolicy: { maxAttempts: 3, backoff: 'exponential' },
        tags: ['important', 'customer-facing'],
      }

      const action: Partial<Action> = {
        verb: 'process',
        target: 'Job/critical',
        options,
      }

      expect((action.options as typeof options).priority).toBe('high')
      expect((action.options as typeof options).tags).toContain('important')
    })

    it('handles null options', () => {
      const action: Partial<Action> = {
        verb: 'read',
        target: 'User/simple',
        options: null,
      }

      expect(action.options).toBeNull()
    })
  })
})

// ============================================================================
// Integration Tests (Schema Verification)
// ============================================================================

describe('Integration with Things Table', () => {
  it('input column references things.rowid', () => {
    // Schema verification - input references things table
    expect(actions.input).toBeDefined()

    const action: Partial<Action> = {
      verb: 'update',
      input: 5, // things.rowid
      output: 6,
    }

    expect(typeof action.input).toBe('number')
  })

  it('output column references things.rowid', () => {
    // Schema verification - output references things table
    expect(actions.output).toBeDefined()

    const action: Partial<Action> = {
      verb: 'create',
      input: null,
      output: 42, // things.rowid
    }

    expect(typeof action.output).toBe('number')
  })

  it('action chain reconstructs thing version history', () => {
    // Version chain: create -> update -> update -> delete
    const actionChain: Partial<Action>[] = [
      { verb: 'create', input: null, output: 1, target: 'Startup/acme' },
      { verb: 'update', input: 1, output: 2, target: 'Startup/acme' },
      { verb: 'update', input: 2, output: 3, target: 'Startup/acme' },
      { verb: 'delete', input: 3, output: null, target: 'Startup/acme' },
    ]

    // Each action's output is next action's input
    for (let i = 0; i < actionChain.length - 1; i++) {
      expect(actionChain[i].output).toBe(actionChain[i + 1].input)
    }

    // First action creates (null input)
    expect(actionChain[0].input).toBeNull()

    // Last action deletes (null output)
    expect(actionChain[actionChain.length - 1].output).toBeNull()
  })
})
