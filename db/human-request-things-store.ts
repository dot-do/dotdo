/**
 * Human Request Things Store
 *
 * A specialized store for managing human request Things (ApprovalRequest,
 * TaskRequest, DecisionRequest, ReviewRequest) with verb form state machine
 * transitions.
 *
 * This store builds on top of ThingsStore and provides:
 * - Type-safe human request Thing CRUD operations
 * - Verb form state machine transitions
 * - Queries by state, role, and assignee
 * - Audit history tracking
 *
 * @module db/human-request-things-store
 */

import { sql } from 'drizzle-orm'
import {
  type HumanRequestThing,
  type ApprovalRequestThing,
  type TaskRequestThing,
  type DecisionRequestThing,
  type ReviewRequestThing,
  type RequestVerbForm,
  type TransitionType,
  HumanRequestStateMachine,
  getRequestState,
  HUMAN_REQUEST_VERBS,
} from './human-request-things'
import { ThingsStore, type StoreContext, type ThingEntity } from './stores'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Human request Thing types
 */
export type HumanRequestThingType =
  | 'ApprovalRequest'
  | 'TaskRequest'
  | 'DecisionRequest'
  | 'ReviewRequest'

/**
 * Input for creating a human request Thing
 */
export interface HumanRequestThingInput {
  $type: HumanRequestThingType
  name: string
  data?: Record<string, unknown>
}

/**
 * History entry for audit trail
 */
export interface RequestHistoryEntry {
  id: string
  thingId: string
  action: 'create' | 'transition' | 'update'
  verbForm: string
  timestamp: Date
  actor?: string
  metadata?: Record<string, unknown>
}

// ============================================================================
// DEFAULT VERB FORMS BY TYPE
// ============================================================================

/**
 * Default initial verb forms for each request type
 */
const DEFAULT_VERB_FORMS: Record<HumanRequestThingType, RequestVerbForm> = {
  ApprovalRequest: 'request',
  TaskRequest: 'assign',
  DecisionRequest: 'decide',
  ReviewRequest: 'review',
}

// ============================================================================
// HUMAN REQUEST THINGS STORE
// ============================================================================

/**
 * HumanRequestThingsStore - Manages human request Things with state machine transitions.
 *
 * This store provides a high-level API for managing human request entities
 * (ApprovalRequest, TaskRequest, DecisionRequest, ReviewRequest) with
 * automatic verb form state machine transitions.
 *
 * @example Basic usage
 * ```typescript
 * const store = new HumanRequestThingsStore(ctx)
 *
 * // Create an approval request
 * const request = await store.create({
 *   $type: 'ApprovalRequest',
 *   name: 'Approve partnership',
 *   data: { role: 'ceo' },
 * })
 *
 * // Transition the request
 * const processing = await store.transition(request.$id, 'request', 'start')
 * const completed = await store.transition(processing.$id, 'request', 'complete')
 * ```
 */
export class HumanRequestThingsStore {
  private thingsStore: ThingsStore
  private history: Map<string, RequestHistoryEntry[]> = new Map()
  // Track timestamps per Thing ID (since ThingEntity doesn't store them)
  private timestamps: Map<string, { createdAt: Date; updatedAt: Date }> = new Map()

  constructor(private ctx: StoreContext) {
    this.thingsStore = new ThingsStore(ctx)
  }

  // ==========================================================================
  // CRUD OPERATIONS
  // ==========================================================================

  /**
   * Create a new human request Thing.
   *
   * @param input - The input data for the request
   * @returns The created Thing with initial verb form state
   */
  async create(input: HumanRequestThingInput): Promise<HumanRequestThing> {
    const { $type, name, data = {} } = input

    // Set default verb form based on type if not provided
    const verbForm = (data.verbForm as RequestVerbForm) ?? DEFAULT_VERB_FORMS[$type]

    // Generate ID with type prefix
    const id = `${$type}/${crypto.randomUUID()}`

    // Create the Thing
    const result = await this.thingsStore.create({
      $id: id,
      $type,
      name,
      data: {
        ...data,
        verbForm,
      },
    })

    // Track timestamps
    const now = new Date()
    this.timestamps.set(id, { createdAt: now, updatedAt: now })

    // Convert to HumanRequestThing
    const thing = this.toHumanRequestThing(result)

    // Record history
    this.recordHistory(thing.$id, 'create', verbForm)

    return thing
  }

  /**
   * Get a human request Thing by ID.
   *
   * @param id - The Thing ID
   * @returns The Thing, or undefined if not found
   */
  async get(id: string): Promise<HumanRequestThing | undefined> {
    const result = await this.thingsStore.get(id)
    if (!result) return undefined
    return this.toHumanRequestThing(result)
  }

  /**
   * Update a human request Thing.
   *
   * @param id - The Thing ID
   * @param data - The data to update
   * @returns The updated Thing
   */
  async update(id: string, data: Partial<HumanRequestThing>): Promise<HumanRequestThing> {
    const result = await this.thingsStore.update(id, data)
    return this.toHumanRequestThing(result)
  }

  // ==========================================================================
  // STATE MACHINE TRANSITIONS
  // ==========================================================================

  /**
   * Transition a human request Thing to a new verb form state.
   *
   * @param id - The Thing ID
   * @param verb - The base verb for the transition (e.g., 'request', 'approve')
   * @param transition - The transition type: 'start' or 'complete'
   * @returns The updated Thing with new verb form
   * @throws Error if the transition is not valid
   */
  async transition(
    id: string,
    verb: string,
    transition: TransitionType
  ): Promise<HumanRequestThing> {
    const thing = await this.get(id)
    if (!thing) {
      throw new Error(`Thing '${id}' not found`)
    }

    const currentForm = thing.data?.verbForm
    if (!currentForm) {
      throw new Error(`Thing '${id}' has no verbForm`)
    }

    // Create state machine and validate transition
    const machine = new HumanRequestStateMachine(verb)
    const currentState = machine.getState(currentForm)

    // Handle case where current form doesn't match verb but equals action form
    if (currentState === null && currentForm !== verb) {
      throw new Error(
        `Invalid transition: current form '${currentForm}' is not compatible with verb '${verb}'`
      )
    }

    // Perform the transition
    const newForm = machine.transition(currentForm, transition) as RequestVerbForm

    // Update the Thing
    const updated = await this.thingsStore.update(id, {
      data: {
        ...thing.data,
        verbForm: newForm,
      },
    })

    // Update timestamp
    const ts = this.timestamps.get(id)
    if (ts) {
      ts.updatedAt = new Date()
    }

    const result = this.toHumanRequestThing(updated)

    // Record history
    this.recordHistory(id, 'transition', newForm)

    return result
  }

  /**
   * Transition a human request Thing with a result payload.
   *
   * Use this when completing a transition with additional data,
   * such as decision results or review feedback.
   *
   * @param id - The Thing ID
   * @param verb - The base verb for the transition
   * @param transition - The transition type
   * @param result - The result data to attach
   * @returns The updated Thing with result
   */
  async transitionWithResult(
    id: string,
    verb: string,
    transition: TransitionType,
    result: Record<string, unknown>
  ): Promise<HumanRequestThing> {
    const thing = await this.get(id)
    if (!thing) {
      throw new Error(`Thing '${id}' not found`)
    }

    const currentForm = thing.data?.verbForm
    if (!currentForm) {
      throw new Error(`Thing '${id}' has no verbForm`)
    }

    // Create state machine and perform transition
    const machine = new HumanRequestStateMachine(verb)
    const newForm = machine.transition(currentForm, transition) as RequestVerbForm

    // Update the Thing with result
    const updated = await this.thingsStore.update(id, {
      data: {
        ...thing.data,
        verbForm: newForm,
        result,
      },
    })

    // Update timestamp
    const ts = this.timestamps.get(id)
    if (ts) {
      ts.updatedAt = new Date()
    }

    const resultThing = this.toHumanRequestThing(updated)

    // Record history
    this.recordHistory(id, 'transition', newForm, { result })

    return resultThing
  }

  // ==========================================================================
  // QUERY METHODS
  // ==========================================================================

  /**
   * List human request Things by state.
   *
   * @param state - The state to filter by: 'pending', 'in_progress', or 'completed'
   * @returns Array of Things in the specified state
   */
  async listByState(state: 'pending' | 'in_progress' | 'completed'): Promise<HumanRequestThing[]> {
    // Get all human request types
    const types: HumanRequestThingType[] = [
      'ApprovalRequest',
      'TaskRequest',
      'DecisionRequest',
      'ReviewRequest',
    ]

    const results: HumanRequestThing[] = []

    for (const type of types) {
      const things = await this.thingsStore.list({ type })
      for (const thing of things) {
        const humanThing = this.toHumanRequestThing(thing)
        const verbForm = humanThing.data?.verbForm
        if (verbForm && getRequestState(verbForm) === state) {
          results.push(humanThing)
        }
      }
    }

    return results
  }

  /**
   * List human request Things by role.
   *
   * @param role - The role to filter by (e.g., 'ceo', 'manager')
   * @returns Array of Things assigned to the role
   */
  async listByRole(role: string): Promise<HumanRequestThing[]> {
    // Get ApprovalRequest things and filter by role
    const things = await this.thingsStore.list({ type: 'ApprovalRequest' })
    return things
      .filter((thing) => thing.data?.role === role)
      .map((thing) => this.toHumanRequestThing(thing))
  }

  /**
   * List human request Things by assignee.
   *
   * @param assignee - The assignee to filter by (e.g., email address)
   * @returns Array of Things assigned to the assignee
   */
  async listByAssignee(assignee: string): Promise<HumanRequestThing[]> {
    // Get TaskRequest things and filter by assignee
    const things = await this.thingsStore.list({ type: 'TaskRequest' })
    return things
      .filter((thing) => thing.data?.assignee === assignee)
      .map((thing) => this.toHumanRequestThing(thing))
  }

  // ==========================================================================
  // HISTORY / AUDIT TRAIL
  // ==========================================================================

  /**
   * Get the audit history for a human request Thing.
   *
   * @param id - The Thing ID
   * @returns Array of history entries
   */
  async getHistory(id: string): Promise<RequestHistoryEntry[]> {
    return this.history.get(id) ?? []
  }

  /**
   * Record a history entry for a Thing.
   */
  private recordHistory(
    thingId: string,
    action: 'create' | 'transition' | 'update',
    verbForm: string,
    metadata?: Record<string, unknown>
  ): void {
    const entries = this.history.get(thingId) ?? []
    entries.push({
      id: crypto.randomUUID(),
      thingId,
      action,
      verbForm,
      timestamp: new Date(),
      metadata,
    })
    this.history.set(thingId, entries)
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Clean up test data.
   * This is primarily used in tests to reset state between runs.
   */
  async cleanup(): Promise<void> {
    // Clear history
    this.history.clear()

    // Clear timestamps
    this.timestamps.clear()

    // Note: We don't delete Things from the database here
    // as that would require database-level cleanup which
    // should be handled by the test framework
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Convert a ThingEntity to a HumanRequestThing.
   */
  private toHumanRequestThing(entity: ThingEntity): HumanRequestThing {
    // Get tracked timestamps or use current time as fallback
    const ts = this.timestamps.get(entity.$id)
    const now = new Date()

    return {
      $id: entity.$id,
      $type: entity.$type as HumanRequestThingType,
      name: entity.name ?? '',
      data: entity.data as HumanRequestThing['data'],
      createdAt: ts?.createdAt ?? now,
      updatedAt: ts?.updatedAt ?? now,
    }
  }
}
