/**
 * Workflow Verb Form Utilities Tests
 *
 * Tests for the shared workflow verb form utilities.
 *
 * @see workflows/graph/verbs.ts
 * @see dotdo-87ogb - [REFACTOR] Extract common verb forms for workflow domain
 */

import { describe, it, expect } from 'vitest'
import {
  // Verb form constants
  START_VERBS,
  PAUSE_VERBS,
  RESUME_VERBS,
  COMPLETE_VERBS,
  FAIL_VERBS,
  CANCEL_VERBS,
  EXECUTE_VERBS,
  SKIP_VERBS,
  WAIT_FOR_VERBS,
  TRIGGER_VERBS,
  ESCALATE_VERBS,
  APPROVE_VERBS,
  REJECT_VERBS,
  // State machines
  WORKFLOW_STATE_MACHINES,
  // Instance state mapping
  verbFormToInstanceState,
  instanceStateToVerbForms,
  // Step state mapping
  verbFormToStepState,
  stepStateToVerbForms,
  // Approval state mapping
  verbFormToApprovalState,
  approvalStateToVerbForms,
  // Wait state mapping
  verbFormToWaitState,
  waitStateToVerbForms,
  // Trigger state mapping
  verbFormToTriggerState,
  triggerStateToVerbForms,
  // Type guards
  isActionForm,
  isActivityForm,
  isEventForm,
  // Combined verbs
  WORKFLOW_VERBS,
  // Utilities
  getVerbForms,
  getStateMachine,
  ALL_VERB_FORMS,
} from '../verbs'

// ============================================================================
// VERB FORM CONSTANTS
// ============================================================================

describe('Verb Form Constants', () => {
  describe('Instance lifecycle verbs', () => {
    it('START_VERBS has correct forms', () => {
      expect(START_VERBS.action).toBe('start')
      expect(START_VERBS.activity).toBe('starting')
      expect(START_VERBS.event).toBe('started')
    })

    it('PAUSE_VERBS has correct forms', () => {
      expect(PAUSE_VERBS.action).toBe('pause')
      expect(PAUSE_VERBS.activity).toBe('pausing')
      expect(PAUSE_VERBS.event).toBe('paused')
    })

    it('RESUME_VERBS has correct forms', () => {
      expect(RESUME_VERBS.action).toBe('resume')
      expect(RESUME_VERBS.activity).toBe('resuming')
      expect(RESUME_VERBS.event).toBe('resumed')
    })

    it('COMPLETE_VERBS has correct forms', () => {
      expect(COMPLETE_VERBS.action).toBe('complete')
      expect(COMPLETE_VERBS.activity).toBe('completing')
      expect(COMPLETE_VERBS.event).toBe('completed')
    })

    it('FAIL_VERBS has correct forms', () => {
      expect(FAIL_VERBS.action).toBe('fail')
      expect(FAIL_VERBS.activity).toBe('failing')
      expect(FAIL_VERBS.event).toBe('failed')
    })

    it('CANCEL_VERBS has correct forms', () => {
      expect(CANCEL_VERBS.action).toBe('cancel')
      expect(CANCEL_VERBS.activity).toBe('cancelling')
      expect(CANCEL_VERBS.event).toBe('cancelled')
    })
  })

  describe('Step execution verbs', () => {
    it('EXECUTE_VERBS has correct forms', () => {
      expect(EXECUTE_VERBS.action).toBe('execute')
      expect(EXECUTE_VERBS.activity).toBe('executing')
      expect(EXECUTE_VERBS.event).toBe('executed')
    })

    it('SKIP_VERBS has correct forms', () => {
      expect(SKIP_VERBS.action).toBe('skip')
      expect(SKIP_VERBS.activity).toBe('skipping')
      expect(SKIP_VERBS.event).toBe('skipped')
    })
  })

  describe('Human interaction verbs', () => {
    it('WAIT_FOR_VERBS has correct forms', () => {
      expect(WAIT_FOR_VERBS.action).toBe('waitFor')
      expect(WAIT_FOR_VERBS.activity).toBe('waitingFor')
      expect(WAIT_FOR_VERBS.event).toBe('waitedFor')
    })

    it('TRIGGER_VERBS has correct forms', () => {
      expect(TRIGGER_VERBS.action).toBe('trigger')
      expect(TRIGGER_VERBS.activity).toBe('triggering')
      expect(TRIGGER_VERBS.event).toBe('triggered')
    })

    it('ESCALATE_VERBS has correct forms', () => {
      expect(ESCALATE_VERBS.action).toBe('escalate')
      expect(ESCALATE_VERBS.activity).toBe('escalating')
      expect(ESCALATE_VERBS.event).toBe('escalated')
    })

    it('APPROVE_VERBS has correct forms', () => {
      expect(APPROVE_VERBS.action).toBe('approve')
      expect(APPROVE_VERBS.activity).toBe('approving')
      expect(APPROVE_VERBS.event).toBe('approved')
    })

    it('REJECT_VERBS has correct forms', () => {
      expect(REJECT_VERBS.action).toBe('reject')
      expect(REJECT_VERBS.activity).toBe('rejecting')
      expect(REJECT_VERBS.event).toBe('rejected')
    })
  })
})

// ============================================================================
// STATE MACHINES
// ============================================================================

describe('Workflow State Machines', () => {
  it('provides pre-configured state machines for all workflow verbs', () => {
    const machines = WORKFLOW_STATE_MACHINES
    expect(machines.start).toBeDefined()
    expect(machines.pause).toBeDefined()
    expect(machines.resume).toBeDefined()
    expect(machines.complete).toBeDefined()
    expect(machines.fail).toBeDefined()
    expect(machines.cancel).toBeDefined()
    expect(machines.execute).toBeDefined()
    expect(machines.skip).toBeDefined()
    expect(machines.waitFor).toBeDefined()
    expect(machines.trigger).toBeDefined()
    expect(machines.escalate).toBeDefined()
    expect(machines.approve).toBeDefined()
    expect(machines.reject).toBeDefined()
  })

  it('start machine transitions correctly', () => {
    const machine = WORKFLOW_STATE_MACHINES.start
    expect(machine.getState('start')).toBe('pending')
    expect(machine.getState('starting')).toBe('in_progress')
    expect(machine.getState('started')).toBe('completed')
  })

  it('execute machine transitions correctly', () => {
    const machine = WORKFLOW_STATE_MACHINES.execute
    expect(machine.getState('execute')).toBe('pending')
    expect(machine.getState('executing')).toBe('in_progress')
    expect(machine.getState('executed')).toBe('completed')
  })

  it('approve machine transitions correctly', () => {
    const machine = WORKFLOW_STATE_MACHINES.approve
    expect(machine.getState('approve')).toBe('pending')
    expect(machine.getState('approving')).toBe('in_progress')
    expect(machine.getState('approved')).toBe('completed')
  })

  it('waitFor machine handles custom conjugation', () => {
    const machine = WORKFLOW_STATE_MACHINES.waitFor
    expect(machine.getState('waitFor')).toBe('pending')
    expect(machine.getState('waitingFor')).toBe('in_progress')
    expect(machine.getState('waitedFor')).toBe('completed')
  })
})

// ============================================================================
// INSTANCE STATE MAPPING
// ============================================================================

describe('Instance State Mapping', () => {
  describe('verbFormToInstanceState', () => {
    it('maps start lifecycle to correct states', () => {
      expect(verbFormToInstanceState('start')).toBe('pending')
      expect(verbFormToInstanceState('starting')).toBe('running')
      expect(verbFormToInstanceState('started')).toBe('completed')
    })

    it('maps terminal states correctly', () => {
      expect(verbFormToInstanceState('paused')).toBe('paused')
      expect(verbFormToInstanceState('failed')).toBe('failed')
      expect(verbFormToInstanceState('cancelled')).toBe('cancelled')
    })

    it('maps intermediate states to running', () => {
      expect(verbFormToInstanceState('pausing')).toBe('running')
      expect(verbFormToInstanceState('resuming')).toBe('running')
      expect(verbFormToInstanceState('completing')).toBe('running')
      expect(verbFormToInstanceState('failing')).toBe('running')
      expect(verbFormToInstanceState('cancelling')).toBe('running')
    })

    it('defaults to pending for unknown states', () => {
      expect(verbFormToInstanceState('unknown')).toBe('pending')
      expect(verbFormToInstanceState('')).toBe('pending')
    })
  })

  describe('instanceStateToVerbForms', () => {
    it('maps pending to start action', () => {
      const forms = instanceStateToVerbForms('pending')
      expect(forms).toContain('start')
    })

    it('maps running to activity forms', () => {
      const forms = instanceStateToVerbForms('running')
      expect(forms).toContain('starting')
      expect(forms).toContain('pausing')
      expect(forms).toContain('resuming')
    })

    it('maps completed to event forms', () => {
      const forms = instanceStateToVerbForms('completed')
      expect(forms).toContain('started')
      expect(forms).toContain('completed')
    })

    it('maps terminal states to their event forms', () => {
      expect(instanceStateToVerbForms('paused')).toContain('paused')
      expect(instanceStateToVerbForms('failed')).toContain('failed')
      expect(instanceStateToVerbForms('cancelled')).toContain('cancelled')
    })
  })
})

// ============================================================================
// STEP EXECUTION STATE MAPPING
// ============================================================================

describe('Step Execution State Mapping', () => {
  describe('verbFormToStepState', () => {
    it('maps execute lifecycle to correct states', () => {
      expect(verbFormToStepState('execute')).toBe('pending')
      expect(verbFormToStepState('executing')).toBe('running')
      expect(verbFormToStepState('executed')).toBe('completed')
    })

    it('maps skip lifecycle to skipped', () => {
      expect(verbFormToStepState('skip')).toBe('skipped')
      expect(verbFormToStepState('skipping')).toBe('skipped')
      expect(verbFormToStepState('skipped')).toBe('skipped')
    })

    it('defaults to pending for unknown states', () => {
      expect(verbFormToStepState('unknown')).toBe('pending')
    })
  })

  describe('stepStateToVerbForms', () => {
    it('maps states to verb forms', () => {
      expect(stepStateToVerbForms('pending')).toContain('execute')
      expect(stepStateToVerbForms('running')).toContain('executing')
      expect(stepStateToVerbForms('completed')).toContain('executed')
      expect(stepStateToVerbForms('failed')).toContain('executed')
      expect(stepStateToVerbForms('skipped')).toContain('skipped')
    })
  })
})

// ============================================================================
// APPROVAL STATE MAPPING
// ============================================================================

describe('Approval State Mapping', () => {
  describe('verbFormToApprovalState', () => {
    it('maps approve lifecycle to correct states', () => {
      expect(verbFormToApprovalState('approve')).toBe('pending')
      expect(verbFormToApprovalState('approving')).toBe('reviewing')
      expect(verbFormToApprovalState('approved')).toBe('approved')
    })

    it('maps reject and cancel to terminal states', () => {
      expect(verbFormToApprovalState('rejected')).toBe('rejected')
      expect(verbFormToApprovalState('cancelled')).toBe('cancelled')
    })

    it('defaults to pending for unknown states', () => {
      expect(verbFormToApprovalState('unknown')).toBe('pending')
    })
  })

  describe('approvalStateToVerbForms', () => {
    it('maps states to verb forms', () => {
      expect(approvalStateToVerbForms('pending')).toContain('approve')
      expect(approvalStateToVerbForms('reviewing')).toContain('approving')
      expect(approvalStateToVerbForms('approved')).toContain('approved')
      expect(approvalStateToVerbForms('rejected')).toContain('rejected')
      expect(approvalStateToVerbForms('cancelled')).toContain('cancelled')
    })
  })
})

// ============================================================================
// WAIT STATE MAPPING
// ============================================================================

describe('Wait State Mapping', () => {
  describe('verbFormToWaitState', () => {
    it('maps waitFor lifecycle to correct states', () => {
      expect(verbFormToWaitState('waitFor')).toBe('pending')
      expect(verbFormToWaitState('waitingFor')).toBe('waiting')
      expect(verbFormToWaitState('waitedFor')).toBe('delivered')
    })

    it('defaults to pending for unknown states', () => {
      expect(verbFormToWaitState('unknown')).toBe('pending')
    })
  })

  describe('waitStateToVerbForms', () => {
    it('maps states to verb forms', () => {
      expect(waitStateToVerbForms('pending')).toContain('waitFor')
      expect(waitStateToVerbForms('waiting')).toContain('waitingFor')
      expect(waitStateToVerbForms('delivered')).toContain('waitedFor')
      expect(waitStateToVerbForms('cancelled')).toContain('waitedFor')
      expect(waitStateToVerbForms('timeout')).toContain('waitedFor')
    })
  })
})

// ============================================================================
// TRIGGER STATE MAPPING
// ============================================================================

describe('Trigger State Mapping', () => {
  describe('verbFormToTriggerState', () => {
    it('maps trigger lifecycle to correct states', () => {
      expect(verbFormToTriggerState('trigger')).toBe('pending')
      expect(verbFormToTriggerState('triggering')).toBe('running')
      expect(verbFormToTriggerState('triggered')).toBe('completed')
    })

    it('defaults to pending for unknown states', () => {
      expect(verbFormToTriggerState('unknown')).toBe('pending')
    })
  })

  describe('triggerStateToVerbForms', () => {
    it('maps states to verb forms', () => {
      expect(triggerStateToVerbForms('pending')).toContain('trigger')
      expect(triggerStateToVerbForms('running')).toContain('triggering')
      expect(triggerStateToVerbForms('completed')).toContain('triggered')
      expect(triggerStateToVerbForms('failed')).toContain('triggered')
    })
  })
})

// ============================================================================
// TYPE GUARDS
// ============================================================================

describe('Type Guards', () => {
  describe('isActionForm', () => {
    it('returns true for action forms', () => {
      expect(isActionForm('start')).toBe(true)
      expect(isActionForm('pause')).toBe(true)
      expect(isActionForm('resume')).toBe(true)
      expect(isActionForm('complete')).toBe(true)
      expect(isActionForm('fail')).toBe(true)
      expect(isActionForm('cancel')).toBe(true)
      expect(isActionForm('execute')).toBe(true)
      expect(isActionForm('skip')).toBe(true)
      expect(isActionForm('waitFor')).toBe(true)
      expect(isActionForm('trigger')).toBe(true)
      expect(isActionForm('escalate')).toBe(true)
      expect(isActionForm('approve')).toBe(true)
      expect(isActionForm('reject')).toBe(true)
    })

    it('returns false for activity and event forms', () => {
      expect(isActionForm('starting')).toBe(false)
      expect(isActionForm('started')).toBe(false)
      expect(isActionForm('unknown')).toBe(false)
    })
  })

  describe('isActivityForm', () => {
    it('returns true for activity forms', () => {
      expect(isActivityForm('starting')).toBe(true)
      expect(isActivityForm('pausing')).toBe(true)
      expect(isActivityForm('resuming')).toBe(true)
      expect(isActivityForm('completing')).toBe(true)
      expect(isActivityForm('failing')).toBe(true)
      expect(isActivityForm('cancelling')).toBe(true)
      expect(isActivityForm('executing')).toBe(true)
      expect(isActivityForm('skipping')).toBe(true)
      expect(isActivityForm('waitingFor')).toBe(true)
      expect(isActivityForm('triggering')).toBe(true)
      expect(isActivityForm('escalating')).toBe(true)
      expect(isActivityForm('approving')).toBe(true)
      expect(isActivityForm('rejecting')).toBe(true)
    })

    it('returns false for action and event forms', () => {
      expect(isActivityForm('start')).toBe(false)
      expect(isActivityForm('started')).toBe(false)
      expect(isActivityForm('unknown')).toBe(false)
    })
  })

  describe('isEventForm', () => {
    it('returns true for event forms', () => {
      expect(isEventForm('started')).toBe(true)
      expect(isEventForm('paused')).toBe(true)
      expect(isEventForm('resumed')).toBe(true)
      expect(isEventForm('completed')).toBe(true)
      expect(isEventForm('failed')).toBe(true)
      expect(isEventForm('cancelled')).toBe(true)
      expect(isEventForm('executed')).toBe(true)
      expect(isEventForm('skipped')).toBe(true)
      expect(isEventForm('waitedFor')).toBe(true)
      expect(isEventForm('triggered')).toBe(true)
      expect(isEventForm('escalated')).toBe(true)
      expect(isEventForm('approved')).toBe(true)
      expect(isEventForm('rejected')).toBe(true)
    })

    it('returns false for action and activity forms', () => {
      expect(isEventForm('start')).toBe(false)
      expect(isEventForm('starting')).toBe(false)
      expect(isEventForm('unknown')).toBe(false)
    })
  })
})

// ============================================================================
// COMBINED VERBS CONSTANT
// ============================================================================

describe('WORKFLOW_VERBS Combined Constant', () => {
  it('contains all instance lifecycle verbs', () => {
    expect(WORKFLOW_VERBS.START).toBe('start')
    expect(WORKFLOW_VERBS.STARTING).toBe('starting')
    expect(WORKFLOW_VERBS.STARTED).toBe('started')

    expect(WORKFLOW_VERBS.PAUSE).toBe('pause')
    expect(WORKFLOW_VERBS.PAUSING).toBe('pausing')
    expect(WORKFLOW_VERBS.PAUSED).toBe('paused')

    expect(WORKFLOW_VERBS.RESUME).toBe('resume')
    expect(WORKFLOW_VERBS.RESUMING).toBe('resuming')
    expect(WORKFLOW_VERBS.RESUMED).toBe('resumed')

    expect(WORKFLOW_VERBS.COMPLETE).toBe('complete')
    expect(WORKFLOW_VERBS.COMPLETING).toBe('completing')
    expect(WORKFLOW_VERBS.COMPLETED).toBe('completed')

    expect(WORKFLOW_VERBS.FAIL).toBe('fail')
    expect(WORKFLOW_VERBS.FAILING).toBe('failing')
    expect(WORKFLOW_VERBS.FAILED).toBe('failed')

    expect(WORKFLOW_VERBS.CANCEL).toBe('cancel')
    expect(WORKFLOW_VERBS.CANCELLING).toBe('cancelling')
    expect(WORKFLOW_VERBS.CANCELLED).toBe('cancelled')
  })

  it('contains all step execution verbs', () => {
    expect(WORKFLOW_VERBS.EXECUTE).toBe('execute')
    expect(WORKFLOW_VERBS.EXECUTING).toBe('executing')
    expect(WORKFLOW_VERBS.EXECUTED).toBe('executed')

    expect(WORKFLOW_VERBS.SKIP).toBe('skip')
    expect(WORKFLOW_VERBS.SKIPPING).toBe('skipping')
    expect(WORKFLOW_VERBS.SKIPPED).toBe('skipped')
  })

  it('contains all human interaction verbs', () => {
    expect(WORKFLOW_VERBS.WAIT_FOR).toBe('waitFor')
    expect(WORKFLOW_VERBS.WAITING_FOR).toBe('waitingFor')
    expect(WORKFLOW_VERBS.WAITED_FOR).toBe('waitedFor')

    expect(WORKFLOW_VERBS.TRIGGER).toBe('trigger')
    expect(WORKFLOW_VERBS.TRIGGERING).toBe('triggering')
    expect(WORKFLOW_VERBS.TRIGGERED).toBe('triggered')

    expect(WORKFLOW_VERBS.ESCALATE).toBe('escalate')
    expect(WORKFLOW_VERBS.ESCALATING).toBe('escalating')
    expect(WORKFLOW_VERBS.ESCALATED).toBe('escalated')

    expect(WORKFLOW_VERBS.APPROVE).toBe('approve')
    expect(WORKFLOW_VERBS.APPROVING).toBe('approving')
    expect(WORKFLOW_VERBS.APPROVED).toBe('approved')

    expect(WORKFLOW_VERBS.REJECT).toBe('reject')
    expect(WORKFLOW_VERBS.REJECTING).toBe('rejecting')
    expect(WORKFLOW_VERBS.REJECTED).toBe('rejected')
  })

  it('contains structural relationship verbs', () => {
    expect(WORKFLOW_VERBS.CONTAINS).toBe('contains')
    expect(WORKFLOW_VERBS.FOLLOWS).toBe('follows')
    expect(WORKFLOW_VERBS.BRANCHES_TO).toBe('branchesTo')
    expect(WORKFLOW_VERBS.INSTANCE_OF).toBe('instanceOf')
    expect(WORKFLOW_VERBS.TRIGGERED_BY).toBe('triggeredBy')
  })
})

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

describe('Utility Functions', () => {
  describe('getVerbForms', () => {
    it('returns verb forms for known base verbs', () => {
      expect(getVerbForms('start')).toEqual(START_VERBS)
      expect(getVerbForms('execute')).toEqual(EXECUTE_VERBS)
      expect(getVerbForms('approve')).toEqual(APPROVE_VERBS)
    })
  })

  describe('getStateMachine', () => {
    it('returns state machine for known base verbs', () => {
      const startMachine = getStateMachine('start')
      expect(startMachine.action).toBe('start')
      expect(startMachine.activity).toBe('starting')
      expect(startMachine.event).toBe('started')
    })
  })

  describe('ALL_VERB_FORMS', () => {
    it('contains all verb form sets', () => {
      expect(ALL_VERB_FORMS.start).toEqual(START_VERBS)
      expect(ALL_VERB_FORMS.pause).toEqual(PAUSE_VERBS)
      expect(ALL_VERB_FORMS.resume).toEqual(RESUME_VERBS)
      expect(ALL_VERB_FORMS.complete).toEqual(COMPLETE_VERBS)
      expect(ALL_VERB_FORMS.fail).toEqual(FAIL_VERBS)
      expect(ALL_VERB_FORMS.cancel).toEqual(CANCEL_VERBS)
      expect(ALL_VERB_FORMS.execute).toEqual(EXECUTE_VERBS)
      expect(ALL_VERB_FORMS.skip).toEqual(SKIP_VERBS)
      expect(ALL_VERB_FORMS.waitFor).toEqual(WAIT_FOR_VERBS)
      expect(ALL_VERB_FORMS.trigger).toEqual(TRIGGER_VERBS)
      expect(ALL_VERB_FORMS.escalate).toEqual(ESCALATE_VERBS)
      expect(ALL_VERB_FORMS.approve).toEqual(APPROVE_VERBS)
      expect(ALL_VERB_FORMS.reject).toEqual(REJECT_VERBS)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration: Workflow State Lifecycle', () => {
  it('demonstrates complete workflow instance lifecycle', () => {
    // Workflow: pending -> running -> completed
    const state1 = verbFormToInstanceState('start')
    expect(state1).toBe('pending')

    const state2 = verbFormToInstanceState('starting')
    expect(state2).toBe('running')

    const state3 = verbFormToInstanceState('started')
    expect(state3).toBe('completed')
  })

  it('demonstrates workflow pause/resume cycle', () => {
    // Running -> paused -> running -> completed
    expect(verbFormToInstanceState('starting')).toBe('running')
    expect(verbFormToInstanceState('pausing')).toBe('running')
    expect(verbFormToInstanceState('paused')).toBe('paused')
    expect(verbFormToInstanceState('resuming')).toBe('running')
    // After resume, back to the original running state verb
    expect(verbFormToInstanceState('starting')).toBe('running')
    // The event form of 'start' is 'started', and 'complete' event is 'completed'
    // Both map to 'completed' state
    expect(verbFormToInstanceState('started')).toBe('completed')
  })

  it('demonstrates step execution lifecycle', () => {
    expect(verbFormToStepState('execute')).toBe('pending')
    expect(verbFormToStepState('executing')).toBe('running')
    expect(verbFormToStepState('executed')).toBe('completed')
  })

  it('demonstrates approval workflow lifecycle', () => {
    expect(verbFormToApprovalState('approve')).toBe('pending')
    expect(verbFormToApprovalState('approving')).toBe('reviewing')
    expect(verbFormToApprovalState('approved')).toBe('approved')
  })

  it('demonstrates rejection flow', () => {
    expect(verbFormToApprovalState('approve')).toBe('pending')
    expect(verbFormToApprovalState('approving')).toBe('reviewing')
    expect(verbFormToApprovalState('rejected')).toBe('rejected')
  })
})
