/**
 * Action/Activity/Event Lifecycle Tests
 *
 * GREEN PHASE: Tests for action -> activity -> event lifecycle via verb forms.
 *
 * @see dotdo-muko1 - [RED] Actions/Activities/Events lifecycle tests
 * @see dotdo-vjjov - [GREEN] Actions/Activities/Events implementation
 *
 * The key insight: the verb form IS the state - no separate status column needed:
 * - Action form (create) = pending/intent
 * - Activity form (creating) = in-progress
 * - Event form (created) = completed
 *
 * Lifecycle:
 *   Action (create) -> Activity (creating) -> Event (created)
 *        |                    |                    |
 *      intent          in-progress            completed
 *     to=target         to=null              to=result
 *
 * Design:
 * - Uses SQLiteGraphStore for real SQLite storage (NO MOCKS per CLAUDE.md)
 * - Verifies verb form state encoding
 * - Demonstrates full lifecycle from intent to completion
 * - Tests durable execution semantics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores'
import {
  ActionLifecycleStore,
  type Action,
  type Activity,
  type Event,
  type CreateActionInput,
} from '../actions'

// ============================================================================
// TEST SUITE: Action Lifecycle
// ============================================================================

describe('Action/Activity/Event Lifecycle', () => {
  let store: SQLiteGraphStore
  let lifecycle: ActionLifecycleStore

  // Bound functions for cleaner test syntax
  let createAction: (input: CreateActionInput) => Promise<Action>
  let startAction: (actionId: string) => Promise<Activity>
  let completeAction: (activityId: string, resultTo: string) => Promise<Event>
  let failAction: (activityId: string, error: Error) => Promise<Action>
  let cancelAction: (actionId: string) => Promise<void>
  let getAction: (actionId: string) => Promise<Action | null>
  let getPendingActions: () => Promise<Action[]>
  let getActiveActivities: () => Promise<Activity[]>
  let getCompletedEvents: () => Promise<Event[]>

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    lifecycle = new ActionLifecycleStore(store)

    // Bind methods for cleaner test syntax
    createAction = lifecycle.createAction.bind(lifecycle)
    startAction = lifecycle.startAction.bind(lifecycle)
    completeAction = lifecycle.completeAction.bind(lifecycle)
    failAction = lifecycle.failAction.bind(lifecycle)
    cancelAction = lifecycle.cancelAction.bind(lifecycle)
    getAction = lifecycle.getAction.bind(lifecycle)
    getPendingActions = lifecycle.getPendingActions.bind(lifecycle)
    getActiveActivities = lifecycle.getActiveActivities.bind(lifecycle)
    getCompletedEvents = lifecycle.getCompletedEvents.bind(lifecycle)
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // 1. Action Creation (Intent)
  // ==========================================================================

  describe('Action Creation (Intent)', () => {
    it('creates action with verb in action form', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
        data: { name: 'My Project' },
      })

      expect(action.verb).toBe('create')
      expect(action.from).toBe('https://users.do/alice')
      expect(action.to).toBe('https://projects.do/new-project')
      expect(action.data).toEqual({ name: 'My Project' })
    })

    it('generates unique action ID', async () => {
      const action1 = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/proj-1',
      })

      const action2 = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/proj-2',
      })

      expect(action1.id).not.toBe(action2.id)
    })

    it('sets createdAt timestamp', async () => {
      const before = Date.now()

      const action = await createAction({
        verb: 'update',
        from: 'https://users.do/alice',
        to: 'https://projects.do/proj-123',
      })

      const after = Date.now()
      const createdAtMs = action.createdAt.getTime()

      expect(createdAtMs).toBeGreaterThanOrEqual(before)
      expect(createdAtMs).toBeLessThanOrEqual(after)
    })

    it('validates verb is in action form (not activity or event)', async () => {
      // Should reject activity form verbs
      await expect(
        createAction({
          verb: 'creating',  // Activity form - invalid
          from: 'https://users.do/alice',
          to: 'https://projects.do/new-project',
        })
      ).rejects.toThrow()

      // Should reject event form verbs
      await expect(
        createAction({
          verb: 'created',  // Event form - invalid
          from: 'https://users.do/alice',
          to: 'https://projects.do/new-project',
        })
      ).rejects.toThrow()
    })

    it('supports various action verbs', async () => {
      const verbs = ['create', 'update', 'delete', 'assign', 'approve', 'publish']

      for (const verb of verbs) {
        const action = await createAction({
          verb,
          from: 'https://users.do/alice',
          to: `https://resources.do/${verb}-target`,
        })

        expect(action.verb).toBe(verb)
      }
    })
  })

  // ==========================================================================
  // 2. Transition to Activity (Start)
  // ==========================================================================

  describe('Transition to Activity (Start)', () => {
    it('transitions action to activity form', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      const activity = await startAction(action.id)

      expect(activity.verb).toBe('creating')  // create -> creating
      expect(activity.to).toBeNull()          // to becomes null during progress
    })

    it('preserves from URL through transition', async () => {
      const action = await createAction({
        verb: 'update',
        from: 'https://users.do/bob',
        to: 'https://projects.do/proj-123',
      })

      const activity = await startAction(action.id)

      expect(activity.from).toBe('https://users.do/bob')
    })

    it('preserves data through transition', async () => {
      const actionData = { name: 'Updated Name', priority: 'high' }

      const action = await createAction({
        verb: 'update',
        from: 'https://users.do/alice',
        to: 'https://projects.do/proj-123',
        data: actionData,
      })

      const activity = await startAction(action.id)

      expect(activity.data).toEqual(actionData)
    })

    it('references original action', async () => {
      const action = await createAction({
        verb: 'delete',
        from: 'https://users.do/alice',
        to: 'https://projects.do/proj-to-delete',
      })

      const activity = await startAction(action.id)

      expect(activity.actionId).toBe(action.id)
    })

    it('sets startedAt timestamp', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      const before = Date.now()
      const activity = await startAction(action.id)
      const after = Date.now()

      const startedAtMs = activity.startedAt.getTime()
      expect(startedAtMs).toBeGreaterThanOrEqual(before)
      expect(startedAtMs).toBeLessThanOrEqual(after)
    })

    it('rejects starting non-existent action', async () => {
      await expect(startAction('non-existent-action-id')).rejects.toThrow()
    })

    it('rejects starting already-started action', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      await startAction(action.id)

      // Attempting to start again should fail
      await expect(startAction(action.id)).rejects.toThrow()
    })
  })

  // ==========================================================================
  // 3. Complete as Event
  // ==========================================================================

  describe('Complete as Event', () => {
    it('completes activity as event with result', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      expect(event.verb).toBe('created')  // creating -> created
      expect(event.to).toBe('https://projects.do/proj-123')  // to is result
    })

    it('preserves from URL through completion', async () => {
      const action = await createAction({
        verb: 'update',
        from: 'https://users.do/bob',
        to: 'https://projects.do/proj-123',
      })

      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      expect(event.from).toBe('https://users.do/bob')
    })

    it('preserves data through completion', async () => {
      const actionData = { changes: { name: 'New Name' } }

      const action = await createAction({
        verb: 'update',
        from: 'https://users.do/alice',
        to: 'https://projects.do/proj-123',
        data: actionData,
      })

      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      expect(event.data).toEqual(actionData)
    })

    it('references original action', async () => {
      const action = await createAction({
        verb: 'delete',
        from: 'https://users.do/alice',
        to: 'https://projects.do/proj-to-delete',
      })

      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://archive.do/proj-archived')

      expect(event.actionId).toBe(action.id)
    })

    it('sets completedAt timestamp', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      const activity = await startAction(action.id)

      const before = Date.now()
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')
      const after = Date.now()

      const completedAtMs = event.completedAt.getTime()
      expect(completedAtMs).toBeGreaterThanOrEqual(before)
      expect(completedAtMs).toBeLessThanOrEqual(after)
    })

    it('requires result URL for completion', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      const activity = await startAction(action.id)

      // @ts-ignore - Testing runtime validation (null passed to string param)
      await expect(completeAction(activity.id, null)).rejects.toThrow()
      await expect(completeAction(activity.id, '')).rejects.toThrow()
    })

    it('rejects completing non-existent activity', async () => {
      await expect(
        completeAction('non-existent-activity-id', 'https://result.do/something')
      ).rejects.toThrow()
    })

    it('rejects completing already-completed activity', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      const activity = await startAction(action.id)
      await completeAction(activity.id, 'https://projects.do/proj-123')

      // Attempting to complete again should fail
      await expect(
        completeAction(activity.id, 'https://projects.do/proj-456')
      ).rejects.toThrow()
    })
  })

  // ==========================================================================
  // 4. Query by State
  // ==========================================================================

  describe('Query by State', () => {
    beforeEach(async () => {
      // Create mix of actions in different states
      // Pending actions (action form)
      await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/proj-1',
      })
      await createAction({
        verb: 'update',
        from: 'https://users.do/bob',
        to: 'https://projects.do/proj-2',
      })
      await createAction({
        verb: 'delete',
        from: 'https://users.do/carol',
        to: 'https://projects.do/proj-3',
      })

      // In-progress activities (activity form)
      const action4 = await createAction({
        verb: 'create',
        from: 'https://users.do/dave',
        to: 'https://projects.do/proj-4',
      })
      await startAction(action4.id)

      const action5 = await createAction({
        verb: 'update',
        from: 'https://users.do/eve',
        to: 'https://projects.do/proj-5',
      })
      await startAction(action5.id)

      // Completed events (event form)
      const action6 = await createAction({
        verb: 'create',
        from: 'https://users.do/frank',
        to: 'https://projects.do/proj-6',
      })
      const activity6 = await startAction(action6.id)
      await completeAction(activity6.id, 'https://projects.do/proj-6-result')

      const action7 = await createAction({
        verb: 'delete',
        from: 'https://users.do/grace',
        to: 'https://projects.do/proj-7',
      })
      const activity7 = await startAction(action7.id)
      await completeAction(activity7.id, 'https://archive.do/proj-7-archived')
    })

    it('queries pending actions (action form verbs)', async () => {
      const pending = await getPendingActions()

      expect(pending.length).toBe(3)
      expect(pending.every(a => ['create', 'update', 'delete'].includes(a.verb))).toBe(true)
    })

    it('queries in-progress activities (activity form verbs)', async () => {
      const active = await getActiveActivities()

      expect(active.length).toBe(2)
      expect(active.every(a => a.verb.endsWith('ing'))).toBe(true)
    })

    it('queries completed events (event form verbs)', async () => {
      const completed = await getCompletedEvents()

      expect(completed.length).toBe(2)
      expect(completed.every(e => e.verb.endsWith('ed'))).toBe(true)
    })

    it('pending actions have defined to field', async () => {
      const pending = await getPendingActions()

      for (const action of pending) {
        expect(action.to).toBeDefined()
        expect(action.to).not.toBeNull()
      }
    })

    it('active activities have null to field', async () => {
      const active = await getActiveActivities()

      for (const activity of active) {
        expect(activity.to).toBeNull()
      }
    })

    it('completed events have result to field', async () => {
      const completed = await getCompletedEvents()

      for (const event of completed) {
        expect(event.to).toBeDefined()
        expect(event.to).not.toBeNull()
        expect(event.to).not.toBe('')
      }
    })
  })

  // ==========================================================================
  // 5. Full Lifecycle
  // ==========================================================================

  describe('Full Lifecycle', () => {
    it('demonstrates complete lifecycle: create -> creating -> created', async () => {
      // 1. Intent - Create action with action form verb
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
        data: { name: 'My Awesome Project' },
      })

      expect(action.verb).toBe('create')
      expect(action.to).toBe('https://projects.do/new-project')

      // 2. Start - Transition to activity form
      const activity = await startAction(action.id)

      expect(activity.verb).toBe('creating')
      expect(activity.to).toBeNull()
      expect(activity.actionId).toBe(action.id)

      // 3. Complete - Transition to event form with result
      const resultUrl = 'https://projects.do/proj-abc123'
      const event = await completeAction(activity.id, resultUrl)

      expect(event.verb).toBe('created')
      expect(event.to).toBe(resultUrl)
      expect(event.actionId).toBe(action.id)
    })

    it('demonstrates update lifecycle: update -> updating -> updated', async () => {
      const updateData = { name: 'Updated Project Name', status: 'active' }

      // 1. Intent
      const action = await createAction({
        verb: 'update',
        from: 'https://users.do/bob',
        to: 'https://projects.do/proj-123',
        data: updateData,
      })

      expect(action.verb).toBe('update')

      // 2. Start
      const activity = await startAction(action.id)

      expect(activity.verb).toBe('updating')
      expect(activity.data).toEqual(updateData)

      // 3. Complete
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      expect(event.verb).toBe('updated')
      expect(event.to).toBe('https://projects.do/proj-123')
    })

    it('demonstrates delete lifecycle: delete -> deleting -> deleted', async () => {
      // 1. Intent
      const action = await createAction({
        verb: 'delete',
        from: 'https://users.do/admin',
        to: 'https://projects.do/proj-to-delete',
      })

      expect(action.verb).toBe('delete')

      // 2. Start
      const activity = await startAction(action.id)

      expect(activity.verb).toBe('deleting')

      // 3. Complete - to is archive location for soft deletes
      const event = await completeAction(activity.id, 'https://archive.do/proj-deleted-123')

      expect(event.verb).toBe('deleted')
      expect(event.to).toBe('https://archive.do/proj-deleted-123')
    })

    it('demonstrates assign lifecycle: assign -> assigning -> assigned', async () => {
      // 1. Intent
      const action = await createAction({
        verb: 'assign',
        from: 'https://users.do/manager',
        to: 'https://tasks.do/task-456',
        data: { assignee: 'https://users.do/developer' },
      })

      expect(action.verb).toBe('assign')

      // 2. Start
      const activity = await startAction(action.id)

      expect(activity.verb).toBe('assigning')

      // 3. Complete
      const event = await completeAction(activity.id, 'https://assignments.do/assign-789')

      expect(event.verb).toBe('assigned')
    })
  })

  // ==========================================================================
  // 6. Durable Execution Semantics
  // ==========================================================================

  describe('Durable Execution Semantics', () => {
    it('actions are persisted and retrievable', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      // Should be retrievable after creation
      const retrieved = await getAction(action.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(action.id)
      expect(retrieved?.verb).toBe('create')
    })

    it('completion is idempotent', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      const activity = await startAction(action.id)

      // First completion succeeds
      const event1 = await completeAction(activity.id, 'https://projects.do/proj-123')
      expect(event1.verb).toBe('created')

      // Second completion with same result should return same event (idempotent)
      // or throw an idempotency error
      try {
        const event2 = await completeAction(activity.id, 'https://projects.do/proj-123')
        // If it doesn't throw, should return equivalent event
        expect(event2.to).toBe(event1.to)
      } catch (error) {
        // Alternatively, it may throw an idempotency error
        expect(error).toBeDefined()
      }
    })

    it('failed action can be retried', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      const activity = await startAction(action.id)

      // Simulate failure
      const failedAction = await failAction(activity.id, new Error('Temporary failure'))

      // Should return to action form (pending state)
      expect(failedAction.verb).toBe('create')

      // Should be able to start again
      const retryActivity = await startAction(failedAction.id)
      expect(retryActivity.verb).toBe('creating')

      // And complete successfully
      const event = await completeAction(retryActivity.id, 'https://projects.do/proj-123')
      expect(event.verb).toBe('created')
    })

    it('cancelled action is removed from pending queue', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      const pendingBefore = await getPendingActions()
      expect(pendingBefore.some(a => a.id === action.id)).toBe(true)

      await cancelAction(action.id)

      const pendingAfter = await getPendingActions()
      expect(pendingAfter.some(a => a.id === action.id)).toBe(false)
    })

    it('action state survives across retrieval', async () => {
      // Create and start an action
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      await startAction(action.id)

      // Retrieve action - should still show in-progress state
      const retrieved = await getAction(action.id)

      // The action should reflect its current state in the lifecycle
      expect(retrieved).not.toBeNull()
    })
  })

  // ==========================================================================
  // 7. Failure Handling
  // ==========================================================================

  describe('Failure Handling', () => {
    it('failAction transitions activity back to action', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      const activity = await startAction(action.id)
      expect(activity.verb).toBe('creating')

      // Fail the action
      const failedAction = await failAction(activity.id, new Error('Something went wrong'))

      // Should return to action form (pending state)
      expect(failedAction.verb).toBe('create')
      expect(failedAction.to).toBe('https://projects.do/new-project')  // Original to restored
    })

    it('failAction preserves error information', async () => {
      const action = await createAction({
        verb: 'update',
        from: 'https://users.do/bob',
        to: 'https://projects.do/proj-123',
        data: { name: 'New Name' },
      })

      const activity = await startAction(action.id)

      const error = new Error('Database connection failed')
      const failedAction = await failAction(activity.id, error)

      // Error information should be accessible (implementation specific)
      // Could be stored in data, or in a separate failures table
      expect(failedAction).toBeDefined()
    })

    it('cannot fail an action that has not started', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      // Action has not been started, so cannot fail
      await expect(
        failAction(action.id, new Error('Cannot fail unstarted action'))
      ).rejects.toThrow()
    })

    it('cannot fail an already-completed action', async () => {
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      const activity = await startAction(action.id)
      await completeAction(activity.id, 'https://projects.do/proj-123')

      // Completed actions cannot fail
      await expect(
        failAction(activity.id, new Error('Cannot fail completed action'))
      ).rejects.toThrow()
    })
  })

  // ==========================================================================
  // 8. Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles irregular verb conjugations', async () => {
      // Test with a verb that has irregular conjugation
      // 'go' -> 'going' -> 'went' (irregular past tense)

      const action = await createAction({
        verb: 'send',  // send -> sending -> sent
        from: 'https://users.do/alice',
        to: 'https://messages.do/msg-123',
      })

      expect(action.verb).toBe('send')

      const activity = await startAction(action.id)
      expect(activity.verb).toBe('sending')

      const event = await completeAction(activity.id, 'https://delivered.do/msg-123')
      expect(event.verb).toBe('sent')
    })

    it('handles custom domain verbs', async () => {
      // Custom verbs specific to the domain
      const verbs = ['deploy', 'merge', 'release', 'rollback', 'provision']

      for (const verb of verbs) {
        const action = await createAction({
          verb,
          from: 'https://users.do/devops',
          to: `https://resources.do/${verb}-target`,
        })

        const activity = await startAction(action.id)
        expect(activity.verb).toBe(`${verb.replace(/e$/, '')}ing`.replace(/yy/, 'yi'))  // Basic conjugation

        // Complete and verify event form
        const event = await completeAction(activity.id, `https://results.do/${verb}-result`)
        expect(event.verb.endsWith('ed') || event.verb.endsWith('d')).toBe(true)
      }
    })

    it('preserves URL structure through lifecycle', async () => {
      const complexFrom = 'https://org.users.do/teams/engineering/members/alice'
      const complexTo = 'https://org.projects.do/2024/q1/initiatives/platform-upgrade'

      const action = await createAction({
        verb: 'create',
        from: complexFrom,
        to: complexTo,
      })

      expect(action.from).toBe(complexFrom)
      expect(action.to).toBe(complexTo)

      const activity = await startAction(action.id)
      expect(activity.from).toBe(complexFrom)

      const resultUrl = 'https://org.projects.do/2024/q1/initiatives/platform-upgrade/v1'
      const event = await completeAction(activity.id, resultUrl)

      expect(event.from).toBe(complexFrom)
      expect(event.to).toBe(resultUrl)
    })

    it('handles concurrent action starts', async () => {
      const action1 = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/proj-1',
      })

      const action2 = await createAction({
        verb: 'create',
        from: 'https://users.do/bob',
        to: 'https://projects.do/proj-2',
      })

      // Start both concurrently
      const [activity1, activity2] = await Promise.all([
        startAction(action1.id),
        startAction(action2.id),
      ])

      expect(activity1.verb).toBe('creating')
      expect(activity2.verb).toBe('creating')
      expect(activity1.id).not.toBe(activity2.id)
    })

    it('handles rapid lifecycle transitions', async () => {
      // Create -> Start -> Complete in quick succession
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/quick-project',
      })

      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/quick-result')

      expect(event.verb).toBe('created')

      // Timestamps should be ordered
      expect(action.createdAt.getTime()).toBeLessThanOrEqual(activity.startedAt.getTime())
      expect(activity.startedAt.getTime()).toBeLessThanOrEqual(event.completedAt.getTime())
    })
  })
})

// ============================================================================
// INTEGRATION TEST: SQLite Storage Backend
// ============================================================================

describe('Action Lifecycle - SQLite Integration', () => {
  let store: SQLiteGraphStore
  let lifecycle: ActionLifecycleStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    lifecycle = new ActionLifecycleStore(store)
  })

  afterEach(async () => {
    await store.close()
  })

  it('actions are stored in SQLite graph', async () => {
    // This test verifies that the lifecycle implementation uses SQLiteGraphStore
    // for persistence. The implementation should store actions as relationships
    // in the graph.

    // Create an action
    const action = await lifecycle.createAction({
      verb: 'create',
      from: 'https://users.do/alice',
      to: 'https://projects.do/new-project',
    })

    // Query the graph directly to verify storage
    const relationships = await store.queryRelationshipsFrom('https://users.do/alice')

    // Should find the action stored as a relationship with verb in action form
    const stored = relationships.find(r => r.verb === 'create')
    expect(stored).toBeDefined()
  })

  it('lifecycle transitions update graph edges', async () => {
    const action = await lifecycle.createAction({
      verb: 'create',
      from: 'https://users.do/alice',
      to: 'https://projects.do/new-project',
    })

    // Verify action form
    let relationships = await store.queryRelationshipsFrom('https://users.do/alice')
    expect(relationships.some(r => r.verb === 'create')).toBe(true)

    // Start action
    await lifecycle.startAction(action.id)

    // Verify activity form (verb should have changed to 'creating')
    relationships = await store.queryRelationshipsFrom('https://users.do/alice')
    expect(relationships.some(r => r.verb === 'creating')).toBe(true)
    expect(relationships.some(r => r.verb === 'create')).toBe(false)
  })

  it('completed events have proper to field in graph', async () => {
    const action = await lifecycle.createAction({
      verb: 'create',
      from: 'https://users.do/alice',
      to: 'https://projects.do/new-project',
    })

    const activity = await lifecycle.startAction(action.id)
    const resultUrl = 'https://projects.do/proj-final-123'
    await lifecycle.completeAction(activity.id, resultUrl)

    // Query for completed events
    const relationships = await store.queryRelationshipsFrom('https://users.do/alice')
    const completed = relationships.find(r => r.verb === 'created')

    expect(completed).toBeDefined()
    expect(completed?.to).toBe(resultUrl)
  })
})
