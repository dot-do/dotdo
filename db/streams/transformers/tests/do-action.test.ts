import { describe, it, expect } from 'vitest'
import { transformDoAction, type ActionInput } from '../do-action'

describe('transformDoAction', () => {
  // Helper to create a minimal completed action
  function createAction(overrides: Partial<ActionInput> = {}): ActionInput {
    return {
      id: 'act_123',
      verb: 'create',
      durability: 'try',
      status: 'completed',
      ...overrides,
    }
  }

  describe('field mappings', () => {
    it('maps id to span_id', () => {
      const action = createAction({ id: 'act_abc123' })
      const event = transformDoAction(action, 'test-ns')

      expect(event.span_id).toBe('act_abc123')
    })

    it('maps verb to action_verb and event_name', () => {
      const action = createAction({ verb: 'update' })
      const event = transformDoAction(action, 'test-ns')

      expect(event.action_verb).toBe('update')
      expect(event.event_name).toBe('action.update')
    })

    it('maps actor to actor_id', () => {
      const action = createAction({ actor: 'Human/nathan' })
      const event = transformDoAction(action, 'test-ns')

      expect(event.actor_id).toBe('Human/nathan')
    })

    it('maps target to action_target and resource_id', () => {
      const action = createAction({ target: 'Startup/acme' })
      const event = transformDoAction(action, 'test-ns')

      expect(event.action_target).toBe('Startup/acme')
      expect(event.resource_id).toBe('Startup/acme')
    })

    it('maps inputVersion and outputVersion to action_input_version (uses inputVersion)', () => {
      const action = createAction({
        inputVersion: 5,
        outputVersion: 6,
      })
      const event = transformDoAction(action, 'test-ns')

      expect(event.action_input_version).toBe(5)
    })

    it('maps durability to action_durability for send', () => {
      const action = createAction({ durability: 'send' })
      const event = transformDoAction(action, 'test-ns')

      expect(event.action_durability).toBe('send')
    })

    it('maps durability to action_durability for try', () => {
      const action = createAction({ durability: 'try' })
      const event = transformDoAction(action, 'test-ns')

      expect(event.action_durability).toBe('try')
    })

    it('maps durability to action_durability for do', () => {
      const action = createAction({ durability: 'do' })
      const event = transformDoAction(action, 'test-ns')

      expect(event.action_durability).toBe('do')
    })

    it('maps status completed to outcome success', () => {
      const action = createAction({ status: 'completed' })
      const event = transformDoAction(action, 'test-ns')

      expect(event.outcome).toBe('success')
    })

    it('maps status failed to outcome error', () => {
      const action = createAction({ status: 'failed' })
      const event = transformDoAction(action, 'test-ns')

      expect(event.outcome).toBe('error')
    })

    it('maps error to error_message', () => {
      const action = createAction({
        status: 'failed',
        error: 'Something went wrong',
      })
      const event = transformDoAction(action, 'test-ns')

      expect(event.error_message).toBe('Something went wrong')
    })

    it('maps error object to error_message as JSON string', () => {
      const action = createAction({
        status: 'failed',
        error: { code: 'ERR_001', message: 'Validation failed' },
      })
      const event = transformDoAction(action, 'test-ns')

      expect(event.error_message).toBe('{"code":"ERR_001","message":"Validation failed"}')
    })

    it('maps requestId to correlation_id', () => {
      const action = createAction({ requestId: 'req_xyz789' })
      const event = transformDoAction(action, 'test-ns')

      expect(event.correlation_id).toBe('req_xyz789')
    })

    it('maps sessionId to session_id', () => {
      const action = createAction({ sessionId: 'sess_abc123' })
      const event = transformDoAction(action, 'test-ns')

      expect(event.session_id).toBe('sess_abc123')
    })

    it('maps workflowId to workflow_id', () => {
      const action = createAction({ workflowId: 'wf_xyz789' })
      const event = transformDoAction(action, 'test-ns')

      expect(event.workflow_id).toBe('wf_xyz789')
    })

    it('maps startedAt to started_at as ISO string', () => {
      const startDate = new Date('2024-01-15T10:30:00.000Z')
      const action = createAction({
        startedAt: startDate,
        completedAt: new Date('2024-01-15T10:30:05.000Z'),
      })
      const event = transformDoAction(action, 'test-ns')

      expect(event.started_at).toBe('2024-01-15T10:30:00.000Z')
    })

    it('maps completedAt to ended_at as ISO string', () => {
      const endDate = new Date('2024-01-15T10:30:05.000Z')
      const action = createAction({
        startedAt: new Date('2024-01-15T10:30:00.000Z'),
        completedAt: endDate,
      })
      const event = transformDoAction(action, 'test-ns')

      expect(event.ended_at).toBe('2024-01-15T10:30:05.000Z')
    })

    it('calculates duration_ms correctly from timestamps', () => {
      const action = createAction({
        startedAt: new Date('2024-01-15T10:30:00.000Z'),
        completedAt: new Date('2024-01-15T10:30:05.500Z'),
      })
      const event = transformDoAction(action, 'test-ns')

      expect(event.duration_ms).toBe(5500)
    })

    it('uses provided durationMs if no timestamps', () => {
      const action = createAction({ durationMs: 1234 })
      const event = transformDoAction(action, 'test-ns')

      expect(event.duration_ms).toBe(1234)
    })

    it('prefers calculated duration over provided durationMs', () => {
      const action = createAction({
        startedAt: new Date('2024-01-15T10:30:00.000Z'),
        completedAt: new Date('2024-01-15T10:30:02.000Z'),
        durationMs: 9999, // Should be ignored
      })
      const event = transformDoAction(action, 'test-ns')

      expect(event.duration_ms).toBe(2000)
    })
  })

  describe('core identity fields', () => {
    it('sets event_type to trace', () => {
      const action = createAction()
      const event = transformDoAction(action, 'test-ns')

      expect(event.event_type).toBe('trace')
    })

    it('uses action id as event id', () => {
      const action = createAction({ id: 'act_unique' })
      const event = transformDoAction(action, 'test-ns')

      expect(event.id).toBe('act_unique')
    })

    it('uses provided namespace', () => {
      const action = createAction()
      const event = transformDoAction(action, 'my-tenant.api.dotdo.dev')

      expect(event.ns).toBe('my-tenant.api.dotdo.dev')
    })
  })

  describe('terminal state validation', () => {
    it('throws for pending status', () => {
      const action = createAction({ status: 'pending' as 'completed' })

      expect(() => transformDoAction(action, 'test-ns')).toThrow(
        'Only terminal action states should be transformed'
      )
    })

    it('throws for in_progress status', () => {
      const action = createAction({ status: 'in_progress' as 'completed' })

      expect(() => transformDoAction(action, 'test-ns')).toThrow(
        'Only terminal action states should be transformed'
      )
    })

    it('accepts completed status', () => {
      const action = createAction({ status: 'completed' })

      expect(() => transformDoAction(action, 'test-ns')).not.toThrow()
    })

    it('accepts failed status', () => {
      const action = createAction({ status: 'failed' })

      expect(() => transformDoAction(action, 'test-ns')).not.toThrow()
    })
  })

  describe('resource type extraction', () => {
    it('extracts resource_type from target path', () => {
      const action = createAction({ target: 'Customer/cust_123' })
      const event = transformDoAction(action, 'test-ns')

      expect(event.resource_type).toBe('Customer')
    })

    it('handles nested target paths', () => {
      const action = createAction({ target: 'Organization/org_1/Team/team_2' })
      const event = transformDoAction(action, 'test-ns')

      // Takes first segment as type
      expect(event.resource_type).toBe('Organization')
    })

    it('handles null target', () => {
      const action = createAction({ target: undefined })
      const event = transformDoAction(action, 'test-ns')

      expect(event.resource_type).toBeNull()
      expect(event.resource_id).toBeNull()
    })
  })

  describe('event source metadata', () => {
    it('sets event_source to do_action', () => {
      const action = createAction()
      const event = transformDoAction(action, 'test-ns')

      expect(event.event_source).toBe('do_action')
    })

    it('sets schema_version to 1', () => {
      const action = createAction()
      const event = transformDoAction(action, 'test-ns')

      expect(event.schema_version).toBe(1)
    })
  })

  describe('full transformation', () => {
    it('transforms a complete action correctly', () => {
      const action: ActionInput = {
        id: 'act_full_test',
        verb: 'update',
        actor: 'Agent/support',
        target: 'Ticket/ticket_456',
        inputVersion: 3,
        outputVersion: 4,
        durability: 'do',
        status: 'completed',
        requestId: 'req_abc',
        sessionId: 'sess_xyz',
        workflowId: 'wf_123',
        startedAt: new Date('2024-01-15T12:00:00.000Z'),
        completedAt: new Date('2024-01-15T12:00:01.500Z'),
      }

      const event = transformDoAction(action, 'tenant.api.dotdo.dev')

      // Core identity
      expect(event.id).toBe('act_full_test')
      expect(event.event_type).toBe('trace')
      expect(event.event_name).toBe('action.update')
      expect(event.ns).toBe('tenant.api.dotdo.dev')

      // Causality
      expect(event.span_id).toBe('act_full_test')
      expect(event.session_id).toBe('sess_xyz')
      expect(event.workflow_id).toBe('wf_123')
      expect(event.correlation_id).toBe('req_abc')

      // Actor
      expect(event.actor_id).toBe('Agent/support')

      // Resource
      expect(event.resource_type).toBe('Ticket')
      expect(event.resource_id).toBe('Ticket/ticket_456')

      // Timing
      expect(event.started_at).toBe('2024-01-15T12:00:00.000Z')
      expect(event.ended_at).toBe('2024-01-15T12:00:01.500Z')
      expect(event.duration_ms).toBe(1500)

      // Outcome
      expect(event.outcome).toBe('success')

      // DO Specific
      expect(event.action_verb).toBe('update')
      expect(event.action_durability).toBe('do')
      expect(event.action_target).toBe('Ticket/ticket_456')
      expect(event.action_input_version).toBe(3)

      // Metadata
      expect(event.event_source).toBe('do_action')
      expect(event.schema_version).toBe(1)
    })
  })
})
