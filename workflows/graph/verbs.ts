/**
 * Workflow Verb Form Utilities
 *
 * Provides standardized verb form handling for workflow domain operations.
 * Built on top of the base VerbFormStateMachine from db/graph/verb-forms.ts.
 *
 * Key insight: verb form IS the state - no separate status column needed.
 *
 * This module provides:
 * 1. Pre-configured VerbFormStateMachine instances for common workflow verbs
 * 2. Type-safe verb form constants (action/activity/event)
 * 3. State mapping utilities with compile-time type checking
 * 4. Semantic state types for each workflow domain
 *
 * @see db/graph/verb-forms.ts - Base verb form state machine
 * @see dotdo-87ogb - [REFACTOR] Extract common verb forms for workflow domain
 * @module workflows/graph/verbs
 */

import {
  VerbFormStateMachine,
  type VerbConjugation,
  type VerbFormType,
} from '../../db/graph/verb-forms'

// ============================================================================
// VERB FORM DEFINITIONS
// ============================================================================

/**
 * Verb form triplet: action -> activity -> event
 */
export interface VerbForms<
  TAction extends string = string,
  TActivity extends string = string,
  TEvent extends string = string,
> {
  readonly action: TAction
  readonly activity: TActivity
  readonly event: TEvent
}

/**
 * Create a VerbForms object from a base verb
 */
export function createVerbForms<T extends string>(
  machine: VerbFormStateMachine
): VerbForms {
  return {
    action: machine.action,
    activity: machine.activity,
    event: machine.event,
  }
}

// ============================================================================
// WORKFLOW INSTANCE VERBS
// ============================================================================

/**
 * Start lifecycle: start -> starting -> started
 */
export const START_VERBS = {
  action: 'start',
  activity: 'starting',
  event: 'started',
} as const satisfies VerbForms

/**
 * Pause lifecycle: pause -> pausing -> paused
 */
export const PAUSE_VERBS = {
  action: 'pause',
  activity: 'pausing',
  event: 'paused',
} as const satisfies VerbForms

/**
 * Resume lifecycle: resume -> resuming -> resumed
 */
export const RESUME_VERBS = {
  action: 'resume',
  activity: 'resuming',
  event: 'resumed',
} as const satisfies VerbForms

/**
 * Complete lifecycle: complete -> completing -> completed
 */
export const COMPLETE_VERBS = {
  action: 'complete',
  activity: 'completing',
  event: 'completed',
} as const satisfies VerbForms

/**
 * Fail lifecycle: fail -> failing -> failed
 */
export const FAIL_VERBS = {
  action: 'fail',
  activity: 'failing',
  event: 'failed',
} as const satisfies VerbForms

/**
 * Cancel lifecycle: cancel -> cancelling -> cancelled
 */
export const CANCEL_VERBS = {
  action: 'cancel',
  activity: 'cancelling',
  event: 'cancelled',
} as const satisfies VerbForms

// ============================================================================
// STEP EXECUTION VERBS
// ============================================================================

/**
 * Execute lifecycle: execute -> executing -> executed
 */
export const EXECUTE_VERBS = {
  action: 'execute',
  activity: 'executing',
  event: 'executed',
} as const satisfies VerbForms

/**
 * Skip lifecycle: skip -> skipping -> skipped
 */
export const SKIP_VERBS = {
  action: 'skip',
  activity: 'skipping',
  event: 'skipped',
} as const satisfies VerbForms

// ============================================================================
// HUMAN INTERACTION VERBS
// ============================================================================

/**
 * WaitFor lifecycle: waitFor -> waitingFor -> waitedFor
 */
export const WAIT_FOR_VERBS = {
  action: 'waitFor',
  activity: 'waitingFor',
  event: 'waitedFor',
} as const satisfies VerbForms

/**
 * Trigger lifecycle: trigger -> triggering -> triggered
 */
export const TRIGGER_VERBS = {
  action: 'trigger',
  activity: 'triggering',
  event: 'triggered',
} as const satisfies VerbForms

/**
 * Escalate lifecycle: escalate -> escalating -> escalated
 */
export const ESCALATE_VERBS = {
  action: 'escalate',
  activity: 'escalating',
  event: 'escalated',
} as const satisfies VerbForms

/**
 * Approve lifecycle: approve -> approving -> approved
 */
export const APPROVE_VERBS = {
  action: 'approve',
  activity: 'approving',
  event: 'approved',
} as const satisfies VerbForms

/**
 * Reject lifecycle: reject -> rejecting -> rejected
 */
export const REJECT_VERBS = {
  action: 'reject',
  activity: 'rejecting',
  event: 'rejected',
} as const satisfies VerbForms

// ============================================================================
// STATE MACHINES (pre-configured for each verb family)
// ============================================================================

/**
 * Pre-configured state machines for workflow verbs
 */
export const WORKFLOW_STATE_MACHINES = {
  start: VerbFormStateMachine.fromBaseVerb('start'),
  pause: VerbFormStateMachine.fromBaseVerb('pause'),
  resume: VerbFormStateMachine.fromBaseVerb('resume'),
  complete: VerbFormStateMachine.fromBaseVerb('complete'),
  fail: VerbFormStateMachine.fromBaseVerb('fail'),
  cancel: VerbFormStateMachine.fromBaseVerb('cancel'),
  execute: VerbFormStateMachine.fromBaseVerb('execute'),
  skip: VerbFormStateMachine.fromBaseVerb('skip'),
  waitFor: new VerbFormStateMachine({
    action: 'waitFor',
    activity: 'waitingFor',
    event: 'waitedFor',
  }),
  trigger: VerbFormStateMachine.fromBaseVerb('trigger'),
  escalate: VerbFormStateMachine.fromBaseVerb('escalate'),
  approve: VerbFormStateMachine.fromBaseVerb('approve'),
  reject: VerbFormStateMachine.fromBaseVerb('reject'),
} as const

// ============================================================================
// SEMANTIC STATE TYPES
// ============================================================================

/**
 * Workflow instance states (derived from verb forms)
 */
export type InstanceState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'paused'
  | 'failed'
  | 'cancelled'

/**
 * Step execution states (derived from verb forms)
 */
export type StepExecutionState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'

/**
 * Approval states (derived from verb forms)
 */
export type ApprovalState =
  | 'pending'
  | 'reviewing'
  | 'approved'
  | 'rejected'
  | 'cancelled'

/**
 * Wait states (derived from verb forms)
 */
export type WaitState =
  | 'pending'
  | 'waiting'
  | 'delivered'
  | 'cancelled'
  | 'timeout'

/**
 * Trigger states (derived from verb forms)
 */
export type TriggerState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'

// ============================================================================
// INSTANCE STATE MAPPING
// ============================================================================

/**
 * Maps verb forms to instance semantic states
 *
 * @param stateVerb - The verb form to map
 * @returns The semantic instance state
 */
export function verbFormToInstanceState(stateVerb: string): InstanceState {
  switch (stateVerb) {
    // Start lifecycle
    case START_VERBS.action:
      return 'pending'
    case START_VERBS.activity:
      return 'running'
    case START_VERBS.event:
      return 'completed'

    // Terminal states
    case PAUSE_VERBS.event:
      return 'paused'
    case FAIL_VERBS.event:
      return 'failed'
    case CANCEL_VERBS.event:
      return 'cancelled'

    // Intermediate states (during transitions)
    case PAUSE_VERBS.activity:
    case RESUME_VERBS.activity:
    case COMPLETE_VERBS.activity:
    case FAIL_VERBS.activity:
    case CANCEL_VERBS.activity:
      return 'running'

    // Default to pending for unknown states
    default:
      return 'pending'
  }
}

/**
 * Maps instance semantic states to verb forms for querying
 *
 * @param state - The semantic state
 * @returns Array of verb forms that match this state
 */
export function instanceStateToVerbForms(state: InstanceState): string[] {
  switch (state) {
    case 'pending':
      return [START_VERBS.action]
    case 'running':
      return [
        START_VERBS.activity,
        PAUSE_VERBS.activity,
        RESUME_VERBS.activity,
        COMPLETE_VERBS.activity,
        FAIL_VERBS.activity,
        CANCEL_VERBS.activity,
      ]
    case 'completed':
      return [START_VERBS.event, COMPLETE_VERBS.event]
    case 'paused':
      return [PAUSE_VERBS.event]
    case 'failed':
      return [FAIL_VERBS.event]
    case 'cancelled':
      return [CANCEL_VERBS.event]
  }
}

// ============================================================================
// STEP EXECUTION STATE MAPPING
// ============================================================================

/**
 * Maps verb forms to step execution semantic states
 *
 * @param verb - The verb form to map
 * @returns The semantic step execution state
 */
export function verbFormToStepState(verb: string): StepExecutionState {
  switch (verb) {
    case EXECUTE_VERBS.action:
      return 'pending'
    case EXECUTE_VERBS.activity:
      return 'running'
    case EXECUTE_VERBS.event:
      return 'completed' // Note: check error field for 'failed'
    case SKIP_VERBS.action:
    case SKIP_VERBS.activity:
    case SKIP_VERBS.event:
      return 'skipped'
    default:
      return 'pending'
  }
}

/**
 * Maps step execution semantic states to verb forms for querying
 *
 * @param state - The semantic state
 * @returns Array of verb forms that match this state
 */
export function stepStateToVerbForms(state: StepExecutionState): string[] {
  switch (state) {
    case 'pending':
      return [EXECUTE_VERBS.action]
    case 'running':
      return [EXECUTE_VERBS.activity]
    case 'completed':
      return [EXECUTE_VERBS.event] // Filter out those with error field
    case 'failed':
      return [EXECUTE_VERBS.event] // Filter for those with error field
    case 'skipped':
      return [SKIP_VERBS.event]
  }
}

// ============================================================================
// APPROVAL STATE MAPPING
// ============================================================================

/**
 * Maps verb forms to approval semantic states
 *
 * @param verb - The verb form to map
 * @returns The semantic approval state
 */
export function verbFormToApprovalState(verb: string): ApprovalState {
  switch (verb) {
    case APPROVE_VERBS.action:
      return 'pending'
    case APPROVE_VERBS.activity:
      return 'reviewing'
    case APPROVE_VERBS.event:
      return 'approved'
    case REJECT_VERBS.event:
      return 'rejected'
    case CANCEL_VERBS.event:
      return 'cancelled'
    default:
      return 'pending'
  }
}

/**
 * Maps approval semantic states to verb forms for querying
 *
 * @param state - The semantic state
 * @returns Array of verb forms that match this state
 */
export function approvalStateToVerbForms(state: ApprovalState): string[] {
  switch (state) {
    case 'pending':
      return [APPROVE_VERBS.action]
    case 'reviewing':
      return [APPROVE_VERBS.activity]
    case 'approved':
      return [APPROVE_VERBS.event]
    case 'rejected':
      return [REJECT_VERBS.event]
    case 'cancelled':
      return [CANCEL_VERBS.event]
  }
}

// ============================================================================
// WAIT STATE MAPPING
// ============================================================================

/**
 * Maps verb forms to wait semantic states
 *
 * @param verb - The verb form to map
 * @returns The semantic wait state
 */
export function verbFormToWaitState(verb: string): WaitState {
  switch (verb) {
    case WAIT_FOR_VERBS.action:
      return 'pending'
    case WAIT_FOR_VERBS.activity:
      return 'waiting'
    case WAIT_FOR_VERBS.event:
      return 'delivered' // Check error field for timeout/cancelled
    default:
      return 'pending'
  }
}

/**
 * Maps wait semantic states to verb forms for querying
 *
 * @param state - The semantic state
 * @returns Array of verb forms that match this state
 */
export function waitStateToVerbForms(state: WaitState): string[] {
  switch (state) {
    case 'pending':
      return [WAIT_FOR_VERBS.action]
    case 'waiting':
      return [WAIT_FOR_VERBS.activity]
    case 'delivered':
    case 'cancelled':
    case 'timeout':
      return [WAIT_FOR_VERBS.event] // Need to check data for differentiation
  }
}

// ============================================================================
// TRIGGER STATE MAPPING
// ============================================================================

/**
 * Maps verb forms to trigger semantic states
 *
 * @param verb - The verb form to map
 * @returns The semantic trigger state
 */
export function verbFormToTriggerState(verb: string): TriggerState {
  switch (verb) {
    case TRIGGER_VERBS.action:
      return 'pending'
    case TRIGGER_VERBS.activity:
      return 'running'
    case TRIGGER_VERBS.event:
      return 'completed' // Check error field for 'failed'
    default:
      return 'pending'
  }
}

/**
 * Maps trigger semantic states to verb forms for querying
 *
 * @param state - The semantic state
 * @returns Array of verb forms that match this state
 */
export function triggerStateToVerbForms(state: TriggerState): string[] {
  switch (state) {
    case 'pending':
      return [TRIGGER_VERBS.action]
    case 'running':
      return [TRIGGER_VERBS.activity]
    case 'completed':
    case 'failed':
      return [TRIGGER_VERBS.event] // Need to check data for differentiation
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if a verb form is an action (pending/intent)
 */
export function isActionForm(verb: string): boolean {
  return (
    verb === START_VERBS.action ||
    verb === PAUSE_VERBS.action ||
    verb === RESUME_VERBS.action ||
    verb === COMPLETE_VERBS.action ||
    verb === FAIL_VERBS.action ||
    verb === CANCEL_VERBS.action ||
    verb === EXECUTE_VERBS.action ||
    verb === SKIP_VERBS.action ||
    verb === WAIT_FOR_VERBS.action ||
    verb === TRIGGER_VERBS.action ||
    verb === ESCALATE_VERBS.action ||
    verb === APPROVE_VERBS.action ||
    verb === REJECT_VERBS.action
  )
}

/**
 * Check if a verb form is an activity (in-progress)
 */
export function isActivityForm(verb: string): boolean {
  return (
    verb === START_VERBS.activity ||
    verb === PAUSE_VERBS.activity ||
    verb === RESUME_VERBS.activity ||
    verb === COMPLETE_VERBS.activity ||
    verb === FAIL_VERBS.activity ||
    verb === CANCEL_VERBS.activity ||
    verb === EXECUTE_VERBS.activity ||
    verb === SKIP_VERBS.activity ||
    verb === WAIT_FOR_VERBS.activity ||
    verb === TRIGGER_VERBS.activity ||
    verb === ESCALATE_VERBS.activity ||
    verb === APPROVE_VERBS.activity ||
    verb === REJECT_VERBS.activity
  )
}

/**
 * Check if a verb form is an event (completed)
 */
export function isEventForm(verb: string): boolean {
  return (
    verb === START_VERBS.event ||
    verb === PAUSE_VERBS.event ||
    verb === RESUME_VERBS.event ||
    verb === COMPLETE_VERBS.event ||
    verb === FAIL_VERBS.event ||
    verb === CANCEL_VERBS.event ||
    verb === EXECUTE_VERBS.event ||
    verb === SKIP_VERBS.event ||
    verb === WAIT_FOR_VERBS.event ||
    verb === TRIGGER_VERBS.event ||
    verb === ESCALATE_VERBS.event ||
    verb === APPROVE_VERBS.event ||
    verb === REJECT_VERBS.event
  )
}

// ============================================================================
// WORKFLOW VERBS CONSTANT (combined for compatibility)
// ============================================================================

/**
 * All workflow verbs combined for easy access
 * Compatible with existing WORKFLOW_VERBS from db/graph/workflows/types.ts
 */
export const WORKFLOW_VERBS = {
  // Instance lifecycle
  START: START_VERBS.action,
  STARTING: START_VERBS.activity,
  STARTED: START_VERBS.event,

  PAUSE: PAUSE_VERBS.action,
  PAUSING: PAUSE_VERBS.activity,
  PAUSED: PAUSE_VERBS.event,

  RESUME: RESUME_VERBS.action,
  RESUMING: RESUME_VERBS.activity,
  RESUMED: RESUME_VERBS.event,

  COMPLETE: COMPLETE_VERBS.action,
  COMPLETING: COMPLETE_VERBS.activity,
  COMPLETED: COMPLETE_VERBS.event,

  FAIL: FAIL_VERBS.action,
  FAILING: FAIL_VERBS.activity,
  FAILED: FAIL_VERBS.event,

  CANCEL: CANCEL_VERBS.action,
  CANCELLING: CANCEL_VERBS.activity,
  CANCELLED: CANCEL_VERBS.event,

  // Step execution
  EXECUTE: EXECUTE_VERBS.action,
  EXECUTING: EXECUTE_VERBS.activity,
  EXECUTED: EXECUTE_VERBS.event,

  SKIP: SKIP_VERBS.action,
  SKIPPING: SKIP_VERBS.activity,
  SKIPPED: SKIP_VERBS.event,

  // Human interaction
  WAIT_FOR: WAIT_FOR_VERBS.action,
  WAITING_FOR: WAIT_FOR_VERBS.activity,
  WAITED_FOR: WAIT_FOR_VERBS.event,

  TRIGGER: TRIGGER_VERBS.action,
  TRIGGERING: TRIGGER_VERBS.activity,
  TRIGGERED: TRIGGER_VERBS.event,

  ESCALATE: ESCALATE_VERBS.action,
  ESCALATING: ESCALATE_VERBS.activity,
  ESCALATED: ESCALATE_VERBS.event,

  APPROVE: APPROVE_VERBS.action,
  APPROVING: APPROVE_VERBS.activity,
  APPROVED: APPROVE_VERBS.event,

  REJECT: REJECT_VERBS.action,
  REJECTING: REJECT_VERBS.activity,
  REJECTED: REJECT_VERBS.event,

  // Structural relationships (non-verb-form)
  CONTAINS: 'contains',
  FOLLOWS: 'follows',
  BRANCHES_TO: 'branchesTo',
  INSTANCE_OF: 'instanceOf',
  TRIGGERED_BY: 'triggeredBy',
} as const

/**
 * Type for all workflow verb values
 */
export type WorkflowVerb = (typeof WORKFLOW_VERBS)[keyof typeof WORKFLOW_VERBS]

// ============================================================================
// VERB FORM LOOKUP
// ============================================================================

/**
 * All verb form sets for easy lookup
 */
export const ALL_VERB_FORMS = {
  start: START_VERBS,
  pause: PAUSE_VERBS,
  resume: RESUME_VERBS,
  complete: COMPLETE_VERBS,
  fail: FAIL_VERBS,
  cancel: CANCEL_VERBS,
  execute: EXECUTE_VERBS,
  skip: SKIP_VERBS,
  waitFor: WAIT_FOR_VERBS,
  trigger: TRIGGER_VERBS,
  escalate: ESCALATE_VERBS,
  approve: APPROVE_VERBS,
  reject: REJECT_VERBS,
} as const

/**
 * Get verb forms by base verb name
 */
export function getVerbForms(baseVerb: keyof typeof ALL_VERB_FORMS): VerbForms {
  return ALL_VERB_FORMS[baseVerb]
}

/**
 * Get state machine by base verb name
 */
export function getStateMachine(
  baseVerb: keyof typeof WORKFLOW_STATE_MACHINES
): VerbFormStateMachine {
  return WORKFLOW_STATE_MACHINES[baseVerb]
}
