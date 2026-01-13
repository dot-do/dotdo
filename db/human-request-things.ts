/**
 * Human Request Things with Verb Form State Machine
 *
 * Implements human request types (ApprovalRequest, TaskRequest, DecisionRequest, ReviewRequest)
 * as Things with verb form state transitions.
 *
 * The key insight: verb form IS the state, no separate status column needed.
 *
 * State Machine for each verb:
 *   action (pending) -> activity (in-progress) -> event (completed)
 *
 * Supported verbs:
 * - request: request -> requesting -> requested
 * - approve: approve -> approving -> approved
 * - reject: reject -> rejecting -> rejected
 * - escalate: escalate -> escalating -> escalated
 * - assign: assign -> assigning -> assigned
 * - complete: complete -> completing -> completed
 * - decide: decide -> deciding -> decided
 * - review: review -> reviewing -> reviewed
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Verb form types that encode state
 */
export type VerbFormType = 'action' | 'activity' | 'event'

/**
 * Request state derived from verb form
 */
export type RequestState = 'pending' | 'in_progress' | 'completed'

/**
 * Transition types for state machine
 */
export type TransitionType = 'start' | 'complete' | 'cancel'

/**
 * Verb conjugation forms
 */
export interface VerbForms {
  action: string    // Base form (e.g., 'approve')
  activity: string  // -ing form (e.g., 'approving')
  event: string     // -ed form (e.g., 'approved')
}

/**
 * All verb forms used in human request state machines
 */
export type RequestVerbForm =
  // Request verb
  | 'request' | 'requesting' | 'requested'
  // Approval verb
  | 'approve' | 'approving' | 'approved'
  // Rejection verb
  | 'reject' | 'rejecting' | 'rejected'
  // Escalation verb
  | 'escalate' | 'escalating' | 'escalated'
  // Assignment verb
  | 'assign' | 'assigning' | 'assigned'
  // Completion verb
  | 'complete' | 'completing' | 'completed'
  // Decision verb
  | 'decide' | 'deciding' | 'decided'
  // Review verb
  | 'review' | 'reviewing' | 'reviewed'

// ============================================================================
// KNOWN HUMAN REQUEST VERBS
// ============================================================================

/**
 * Registry of all human request verbs and their conjugations
 */
export const HUMAN_REQUEST_VERBS: Record<string, VerbForms> = {
  request: { action: 'request', activity: 'requesting', event: 'requested' },
  approve: { action: 'approve', activity: 'approving', event: 'approved' },
  reject: { action: 'reject', activity: 'rejecting', event: 'rejected' },
  escalate: { action: 'escalate', activity: 'escalating', event: 'escalated' },
  assign: { action: 'assign', activity: 'assigning', event: 'assigned' },
  complete: { action: 'complete', activity: 'completing', event: 'completed' },
  decide: { action: 'decide', activity: 'deciding', event: 'decided' },
  review: { action: 'review', activity: 'reviewing', event: 'reviewed' },
}

/**
 * Reverse lookup: from any verb form to its base verb
 */
const VERB_FORM_TO_BASE: Map<string, string> = new Map()
for (const [base, forms] of Object.entries(HUMAN_REQUEST_VERBS)) {
  VERB_FORM_TO_BASE.set(forms.action, base)
  VERB_FORM_TO_BASE.set(forms.activity, base)
  VERB_FORM_TO_BASE.set(forms.event, base)
}

// ============================================================================
// THING TYPE DEFINITIONS
// ============================================================================

/**
 * Base interface for all human request Things
 */
export interface HumanRequestThing {
  $id: string
  $type: 'ApprovalRequest' | 'TaskRequest' | 'DecisionRequest' | 'ReviewRequest'
  name: string
  data?: {
    verbForm?: RequestVerbForm
    [key: string]: unknown
  }
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date
}

/**
 * ApprovalRequest Thing - for approval/rejection workflows
 */
export interface ApprovalRequestThing extends HumanRequestThing {
  $type: 'ApprovalRequest'
  data?: {
    verbForm?: RequestVerbForm
    role?: string
    message?: string
    sla?: number
    channel?: string
    result?: {
      approved: boolean
      approver?: string
      reason?: string
      respondedAt?: string
    }
    [key: string]: unknown
  }
}

/**
 * TaskRequest Thing - for task assignment and completion workflows
 */
export interface TaskRequestThing extends HumanRequestThing {
  $type: 'TaskRequest'
  data?: {
    verbForm?: RequestVerbForm
    assignee?: string
    priority?: 'low' | 'normal' | 'high' | 'urgent'
    dueDate?: string
    description?: string
    result?: {
      completedBy?: string
      completedAt?: string
      notes?: string
    }
    [key: string]: unknown
  }
}

/**
 * DecisionRequest Thing - for decision-making workflows
 */
export interface DecisionRequestThing extends HumanRequestThing {
  $type: 'DecisionRequest'
  data?: {
    verbForm?: RequestVerbForm
    options?: string[]
    context?: string
    result?: {
      choice?: string
      decidedBy?: string
      decidedAt?: string
      reasoning?: string
    }
    [key: string]: unknown
  }
}

/**
 * ReviewRequest Thing - for review workflows
 */
export interface ReviewRequestThing extends HumanRequestThing {
  $type: 'ReviewRequest'
  data?: {
    verbForm?: RequestVerbForm
    artifact?: string
    reviewType?: 'code' | 'document' | 'design' | 'other'
    result?: {
      reviewedBy?: string
      reviewedAt?: string
      status?: 'approved' | 'changes_requested' | 'commented'
      comments?: string
    }
    [key: string]: unknown
  }
}

// ============================================================================
// STATE MACHINE IMPLEMENTATION
// ============================================================================

/**
 * Valid transitions between verb form states
 */
const VALID_TRANSITIONS: Record<VerbFormType, Record<string, VerbFormType>> = {
  action: {
    start: 'activity',    // action -> activity (begin work)
    complete: 'event',    // action -> event (immediate completion)
  },
  activity: {
    complete: 'event',    // activity -> event (finish work)
    cancel: 'action',     // activity -> action (cancel, return to pending)
  },
  event: {
    // Events are final - no valid transitions out
  },
}

/**
 * Human Request State Machine
 *
 * Manages state transitions for a specific verb family.
 */
export class HumanRequestStateMachine {
  readonly action: string
  readonly activity: string
  readonly event: string

  constructor(baseVerb: string) {
    const forms = HUMAN_REQUEST_VERBS[baseVerb]
    if (!forms) {
      // Auto-conjugate for unknown verbs
      this.action = baseVerb
      this.activity = conjugateToActivity(baseVerb)
      this.event = conjugateToEvent(baseVerb)
    } else {
      this.action = forms.action
      this.activity = forms.activity
      this.event = forms.event
    }
  }

  /**
   * Gets the semantic state for a given verb form.
   * Returns null if the verb form doesn't belong to this verb family.
   */
  getState(verbForm: string): RequestState | null {
    if (verbForm === this.action) return 'pending'
    if (verbForm === this.activity) return 'in_progress'
    if (verbForm === this.event) return 'completed'
    return null
  }

  /**
   * Checks if a transition is valid from the given verb form.
   */
  canTransition(currentForm: string, transition: TransitionType): boolean {
    const state = this.getState(currentForm)
    if (state === null) return false

    switch (state) {
      case 'pending':
        return transition === 'start' || transition === 'complete'
      case 'in_progress':
        return transition === 'complete' || transition === 'cancel'
      case 'completed':
        return false // No transitions from completed state
    }
  }

  /**
   * Performs a state transition and returns the new verb form.
   * Throws if the transition is not valid.
   */
  transition(currentForm: string, transition: TransitionType): string {
    if (!this.canTransition(currentForm, transition)) {
      const state = this.getState(currentForm)
      throw new Error(
        `Invalid transition '${transition}' from ${state ?? 'unknown'} state (${currentForm})`
      )
    }

    const state = this.getState(currentForm)!

    switch (transition) {
      case 'start':
        return this.activity
      case 'complete':
        return this.event
      case 'cancel':
        return this.action
    }
  }
}

/**
 * ApprovalRequest-specific state machine with approval/rejection support
 */
export class ApprovalRequestStateMachine extends HumanRequestStateMachine {
  constructor() {
    super('request')
  }

  /**
   * Get the approval state machine for transitioning to approved
   */
  getApproveMachine(): HumanRequestStateMachine {
    return new HumanRequestStateMachine('approve')
  }

  /**
   * Get the rejection state machine for transitioning to rejected
   */
  getRejectMachine(): HumanRequestStateMachine {
    return new HumanRequestStateMachine('reject')
  }
}

/**
 * TaskRequest-specific state machine with assignment and completion support
 */
export class TaskRequestStateMachine extends HumanRequestStateMachine {
  constructor() {
    super('assign')
  }

  /**
   * Get the completion state machine for transitioning to completed
   */
  getCompleteMachine(): HumanRequestStateMachine {
    return new HumanRequestStateMachine('complete')
  }

  /**
   * Get the escalation state machine
   */
  getEscalateMachine(): HumanRequestStateMachine {
    return new HumanRequestStateMachine('escalate')
  }
}

/**
 * DecisionRequest-specific state machine
 */
export class DecisionRequestStateMachine extends HumanRequestStateMachine {
  constructor() {
    super('decide')
  }
}

/**
 * ReviewRequest-specific state machine
 */
export class ReviewRequestStateMachine extends HumanRequestStateMachine {
  constructor() {
    super('review')
  }
}

// ============================================================================
// TRANSITION FUNCTIONS
// ============================================================================

/**
 * Transition a human request Thing to a new verb form state.
 *
 * @param thing - The Thing to transition
 * @param verb - The base verb for the transition (e.g., 'approve', 'complete')
 * @param transition - The transition to apply: 'start', 'complete', or 'cancel'
 * @returns A new Thing object with updated verbForm and updatedAt
 * @throws Error if the transition is not valid
 */
export function transitionTo<T extends HumanRequestThing>(
  thing: T,
  verb: string,
  transition: TransitionType
): T {
  const machine = new HumanRequestStateMachine(verb)
  const currentForm = thing.data?.verbForm

  if (!currentForm) {
    throw new Error('Thing has no verbForm in data')
  }

  // Validate the current form belongs to the verb family or matches the action
  const currentState = machine.getState(currentForm)
  if (currentState === null) {
    // Current form doesn't match, check if we're starting a new verb
    if (currentForm !== verb) {
      throw new Error(
        `Cannot transition with verb '${verb}' - current form '${currentForm}' is not compatible`
      )
    }
  }

  // Perform the transition
  const newForm = machine.transition(currentForm, transition)

  // Return a new Thing with updated state
  return {
    ...thing,
    data: {
      ...thing.data,
      verbForm: newForm as RequestVerbForm,
    },
    updatedAt: new Date(),
  }
}

/**
 * Validate if a transition between two verb forms is allowed.
 *
 * @param currentState - The current verb form
 * @param targetState - The target verb form
 * @returns true if the transition is valid, false otherwise
 */
export function validateTransition(currentState: string, targetState: string): boolean {
  // Get the base verb for both states
  const currentBase = VERB_FORM_TO_BASE.get(currentState)
  const targetBase = VERB_FORM_TO_BASE.get(targetState)

  // Both must be known verb forms
  if (!currentBase || !targetBase) {
    return false
  }

  // Must be the same verb family
  if (currentBase !== targetBase) {
    return false
  }

  // Get the state machine
  const machine = new HumanRequestStateMachine(currentBase)

  // Determine what transition would result in the target state
  const currentVerbState = machine.getState(currentState)
  const targetVerbState = machine.getState(targetState)

  if (!currentVerbState || !targetVerbState) {
    return false
  }

  // Check valid state progressions
  // pending -> in_progress (start)
  // pending -> completed (complete - immediate)
  // in_progress -> completed (complete)
  // in_progress -> pending (cancel)

  if (currentVerbState === 'pending') {
    return targetVerbState === 'in_progress' || targetVerbState === 'completed'
  }

  if (currentVerbState === 'in_progress') {
    return targetVerbState === 'completed' || targetVerbState === 'pending'
  }

  // completed state has no valid outgoing transitions
  return false
}

/**
 * Get the semantic state from a verb form.
 *
 * @param verbForm - The verb form to analyze
 * @returns The request state: 'pending', 'in_progress', or 'completed'
 */
export function getRequestState(verbForm: string): RequestState {
  // Check for known activity forms (-ing)
  if (verbForm.endsWith('ing')) {
    return 'in_progress'
  }

  // Check for known event forms (-ed)
  if (verbForm.endsWith('ed')) {
    return 'completed'
  }

  // Default to pending (action form)
  return 'pending'
}

// ============================================================================
// CONJUGATION HELPERS
// ============================================================================

/**
 * Conjugate a base verb to its -ing form (activity/present participle)
 */
function conjugateToActivity(baseVerb: string): string {
  // Verbs ending in -e (but not -ee): drop e, add -ing (approve -> approving)
  if (
    baseVerb.endsWith('e') &&
    !baseVerb.endsWith('ee')
  ) {
    return baseVerb.slice(0, -1) + 'ing'
  }

  // Default: just add -ing
  return baseVerb + 'ing'
}

/**
 * Conjugate a base verb to its -ed form (event/past participle)
 */
function conjugateToEvent(baseVerb: string): string {
  // Verbs ending in -e: just add -d (approve -> approved)
  if (baseVerb.endsWith('e')) {
    return baseVerb + 'd'
  }

  // Verbs ending in consonant + y: change y to ied (apply -> applied)
  if (baseVerb.endsWith('y') && baseVerb.length > 1 && isConsonant(baseVerb[baseVerb.length - 2]!)) {
    return baseVerb.slice(0, -1) + 'ied'
  }

  // Default: add -ed
  return baseVerb + 'ed'
}

/**
 * Check if a character is a consonant
 */
function isConsonant(char: string): boolean {
  return /[bcdfghjklmnpqrstvwxyz]/i.test(char)
}
