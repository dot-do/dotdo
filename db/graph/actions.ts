/**
 * Action/Activity/Event Lifecycle
 *
 * GREEN PHASE: Implements action lifecycle with verb form transitions.
 *
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
 */

import type { SQLiteGraphStore } from './stores'
import { getVerbFormType, transitionVerbForm, parseVerbForm } from './verb-forms'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for creating a new action (intent).
 */
export interface CreateActionInput {
  verb: string // Action form verb (e.g., 'create', 'update', 'delete')
  from: string // Actor URL (who is performing the action)
  to: string // Target URL (what will be affected)
  data?: Record<string, unknown> // Optional action payload
}

/**
 * An Action represents an intent to do something.
 * Verb is in action form (e.g., 'create', 'update', 'delete').
 */
export interface Action {
  id: string
  verb: string // Action form: 'create', 'update', 'delete'
  from: string // Actor URL
  to: string // Target URL (what will be affected)
  data?: Record<string, unknown>
  createdAt: Date
}

/**
 * An Activity represents work in progress.
 * Verb is in activity form (e.g., 'creating', 'updating', 'deleting').
 */
export interface Activity {
  id: string
  actionId: string // Reference to original action
  verb: string // Activity form: 'creating', 'updating', 'deleting'
  from: string // Actor URL
  to: null // Always null during activity (work in progress)
  data?: Record<string, unknown>
  startedAt: Date
}

/**
 * An Event represents completed work.
 * Verb is in event form (e.g., 'created', 'updated', 'deleted').
 */
export interface Event {
  id: string
  actionId: string // Reference to original action
  verb: string // Event form: 'created', 'updated', 'deleted'
  from: string // Actor URL
  to: string // Result URL (what was created/affected)
  data?: Record<string, unknown>
  completedAt: Date
}

// ============================================================================
// INTERNAL STATE - Stored in relationship data
// ============================================================================

/**
 * Internal state stored in relationship data field
 */
interface ActionState {
  actionId: string // Original action ID (for tracking through transitions)
  originalTo: string // Original target URL (for restoring on fail)
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  startedAt?: number // Unix timestamp when started
  completedAt?: number // Unix timestamp when completed
  error?: string // Error message if failed
}

// ============================================================================
// ACTION LIFECYCLE STORE
// ============================================================================

/**
 * ActionLifecycleStore manages action/activity/event transitions.
 *
 * Uses the GraphStore to persist actions as relationships with verb-encoded state.
 */
export class ActionLifecycleStore {
  private store: SQLiteGraphStore
  private idCounter = 0

  constructor(store: SQLiteGraphStore) {
    this.store = store
  }

  /**
   * Generate a unique ID for actions
   */
  private generateId(): string {
    return `action-${++this.idCounter}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Create a new action (intent).
   *
   * @param input - Action input with verb, from, to, and optional data
   * @returns The created Action
   * @throws Error if verb is not in action form
   */
  async createAction(input: CreateActionInput): Promise<Action> {
    // Validate verb is in action form
    const verbType = getVerbFormType(input.verb)
    if (verbType !== 'action') {
      throw new Error(
        `Invalid verb form: '${input.verb}' is in ${verbType} form. Use action form (e.g., 'create', 'update', 'delete').`
      )
    }

    const id = this.generateId()
    const state: ActionState = {
      actionId: id,
      originalTo: input.to,
      status: 'pending',
    }

    const rel = await this.store.createRelationship({
      id,
      verb: input.verb,
      from: input.from,
      to: input.to,
      data: {
        ...input.data,
        __actionState: state,
      },
    })

    return {
      id: rel.id,
      verb: rel.verb,
      from: rel.from,
      to: rel.to,
      data: this.extractUserData(rel.data),
      createdAt: rel.createdAt,
    }
  }

  /**
   * Start an action, transitioning it to an activity.
   *
   * @param actionId - The ID of the action to start
   * @returns The Activity (in-progress state)
   * @throws Error if action not found or already started
   */
  async startAction(actionId: string): Promise<Activity> {
    const action = await this.getRawAction(actionId)
    if (!action) {
      throw new Error(`Action not found: ${actionId}`)
    }

    const state = this.extractState(action.data)

    // Validate current state
    if (state.status !== 'pending') {
      throw new Error(`Cannot start action in ${state.status} state`)
    }

    const verbType = getVerbFormType(action.verb)
    if (verbType !== 'action') {
      throw new Error(`Cannot start: action is in ${verbType} form (${action.verb})`)
    }

    // Transition verb to activity form
    const activityVerb = transitionVerbForm(action.verb, 'start')
    const now = Date.now()

    // Update state
    const newState: ActionState = {
      ...state,
      status: 'in_progress',
      startedAt: now,
    }

    // Delete old relationship and create new one with updated verb
    await this.store.deleteRelationship(actionId)

    // Create new relationship with activity verb and null 'to'
    // Since GraphStore doesn't support null 'to', we use a special marker
    await this.store.createRelationship({
      id: actionId,
      verb: activityVerb,
      from: action.from,
      to: '__null__', // Special marker for null
      data: {
        ...this.extractUserData(action.data),
        __actionState: newState,
      },
    })

    return {
      id: actionId,
      actionId: state.actionId,
      verb: activityVerb,
      from: action.from,
      to: null,
      data: this.extractUserData(action.data),
      startedAt: new Date(now),
    }
  }

  /**
   * Complete an activity, transitioning it to an event.
   *
   * @param activityId - The ID of the activity to complete
   * @param resultTo - The result URL (what was created/affected)
   * @returns The Event (completed state)
   * @throws Error if activity not found, not in progress, or resultTo is invalid
   */
  async completeAction(activityId: string, resultTo: string): Promise<Event> {
    // Validate resultTo
    if (!resultTo || resultTo === '') {
      throw new Error('Result URL is required for completion')
    }

    const activity = await this.getRawAction(activityId)
    if (!activity) {
      throw new Error(`Activity not found: ${activityId}`)
    }

    const state = this.extractState(activity.data)

    // Validate current state
    if (state.status !== 'in_progress') {
      throw new Error(`Cannot complete action in ${state.status} state`)
    }

    const verbType = getVerbFormType(activity.verb)
    if (verbType !== 'activity') {
      throw new Error(`Cannot complete: action is in ${verbType} form (${activity.verb})`)
    }

    // Transition verb to event form
    const eventVerb = transitionVerbForm(activity.verb, 'complete')
    const now = Date.now()

    // Update state
    const newState: ActionState = {
      ...state,
      status: 'completed',
      completedAt: now,
    }

    // Delete old relationship and create new one with updated verb
    await this.store.deleteRelationship(activityId)

    await this.store.createRelationship({
      id: activityId,
      verb: eventVerb,
      from: activity.from,
      to: resultTo,
      data: {
        ...this.extractUserData(activity.data),
        __actionState: newState,
      },
    })

    return {
      id: activityId,
      actionId: state.actionId,
      verb: eventVerb,
      from: activity.from,
      to: resultTo,
      data: this.extractUserData(activity.data),
      completedAt: new Date(now),
    }
  }

  /**
   * Fail an activity, transitioning it back to an action.
   *
   * @param activityId - The ID of the activity that failed
   * @param error - The error that caused the failure
   * @returns The Action (returned to pending state for retry)
   * @throws Error if activity not found or not in progress
   */
  async failAction(activityId: string, error: Error): Promise<Action> {
    const activity = await this.getRawAction(activityId)
    if (!activity) {
      throw new Error(`Activity not found: ${activityId}`)
    }

    const state = this.extractState(activity.data)

    // Validate current state
    if (state.status !== 'in_progress') {
      throw new Error(`Cannot fail action in ${state.status} state`)
    }

    const verbType = getVerbFormType(activity.verb)
    if (verbType !== 'activity') {
      throw new Error(`Cannot fail: action is in ${verbType} form (${activity.verb})`)
    }

    // Transition verb back to action form
    const actionVerb = transitionVerbForm(activity.verb, 'cancel')

    // Update state - reset to pending for retry
    const newState: ActionState = {
      ...state,
      status: 'pending',
      error: error.message,
    }

    // Delete old relationship and create new one with action verb
    await this.store.deleteRelationship(activityId)

    const rel = await this.store.createRelationship({
      id: activityId,
      verb: actionVerb,
      from: activity.from,
      to: state.originalTo, // Restore original target
      data: {
        ...this.extractUserData(activity.data),
        __actionState: newState,
      },
    })

    return {
      id: rel.id,
      verb: rel.verb,
      from: rel.from,
      to: rel.to,
      data: this.extractUserData(rel.data),
      createdAt: rel.createdAt,
    }
  }

  /**
   * Cancel a pending action.
   *
   * @param actionId - The ID of the action to cancel
   * @throws Error if action not found or not pending
   */
  async cancelAction(actionId: string): Promise<void> {
    const action = await this.getRawAction(actionId)
    if (!action) {
      throw new Error(`Action not found: ${actionId}`)
    }

    const state = this.extractState(action.data)

    // Only pending actions can be cancelled
    if (state.status !== 'pending') {
      throw new Error(`Cannot cancel action in ${state.status} state`)
    }

    // Mark as cancelled by updating state (or just delete)
    await this.store.deleteRelationship(actionId)
  }

  /**
   * Get an action by ID.
   *
   * @param actionId - The action ID
   * @returns The Action if found, null otherwise
   */
  async getAction(actionId: string): Promise<Action | null> {
    const raw = await this.getRawAction(actionId)
    if (!raw) {
      return null
    }

    return {
      id: raw.id,
      verb: raw.verb,
      from: raw.from,
      to: raw.to === '__null__' ? '' : raw.to, // Handle null marker
      data: this.extractUserData(raw.data),
      createdAt: raw.createdAt,
    }
  }

  /**
   * Get all pending actions (action form verbs).
   *
   * @returns Array of pending Actions
   */
  async getPendingActions(): Promise<Action[]> {
    // Query all relationships and filter by verb form type
    // This is inefficient but works for the current implementation
    // A production implementation would use a verb pattern index
    const allRels = await this.getAllRelationships()

    return allRels
      .filter((rel) => {
        const verbType = getVerbFormType(rel.verb)
        const state = this.extractState(rel.data)
        return verbType === 'action' && state.status === 'pending'
      })
      .map((rel) => ({
        id: rel.id,
        verb: rel.verb,
        from: rel.from,
        to: rel.to,
        data: this.extractUserData(rel.data),
        createdAt: rel.createdAt,
      }))
  }

  /**
   * Get all active activities (activity form verbs).
   *
   * @returns Array of in-progress Activities
   */
  async getActiveActivities(): Promise<Activity[]> {
    const allRels = await this.getAllRelationships()

    return allRels
      .filter((rel) => {
        const verbType = getVerbFormType(rel.verb)
        const state = this.extractState(rel.data)
        return verbType === 'activity' && state.status === 'in_progress'
      })
      .map((rel) => {
        const state = this.extractState(rel.data)
        return {
          id: rel.id,
          actionId: state.actionId,
          verb: rel.verb,
          from: rel.from,
          to: null as null, // Activity always has null 'to'
          data: this.extractUserData(rel.data),
          startedAt: new Date(state.startedAt ?? rel.createdAt.getTime()),
        }
      })
  }

  /**
   * Get all completed events (event form verbs).
   *
   * @returns Array of completed Events
   */
  async getCompletedEvents(): Promise<Event[]> {
    const allRels = await this.getAllRelationships()

    return allRels
      .filter((rel) => {
        const verbType = getVerbFormType(rel.verb)
        const state = this.extractState(rel.data)
        return verbType === 'event' && state.status === 'completed'
      })
      .map((rel) => {
        const state = this.extractState(rel.data)
        return {
          id: rel.id,
          actionId: state.actionId,
          verb: rel.verb,
          from: rel.from,
          to: rel.to,
          data: this.extractUserData(rel.data),
          completedAt: new Date(state.completedAt ?? rel.createdAt.getTime()),
        }
      })
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  /**
   * Get raw relationship by ID.
   * Need to search since we don't have a direct get by ID.
   */
  private async getRawAction(
    id: string
  ): Promise<{ id: string; verb: string; from: string; to: string; data: Record<string, unknown> | null; createdAt: Date } | null> {
    const allRels = await this.getAllRelationships()
    return allRels.find((r) => r.id === id) ?? null
  }

  /**
   * Get all relationships (inefficient but necessary without direct ID lookup).
   */
  private async getAllRelationships(): Promise<
    Array<{ id: string; verb: string; from: string; to: string; data: Record<string, unknown> | null; createdAt: Date }>
  > {
    // We need to query all verbs - this is a hack since GraphStore doesn't have a getAll method
    // In production, we'd have a separate actions table or use a known set of verbs

    // Common action verbs to query
    const commonVerbs = [
      'create', 'creating', 'created',
      'update', 'updating', 'updated',
      'delete', 'deleting', 'deleted',
      'assign', 'assigning', 'assigned',
      'approve', 'approving', 'approved',
      'publish', 'publishing', 'published',
      'send', 'sending', 'sent',
      'deploy', 'deploying', 'deployed',
      'merge', 'merging', 'merged',
      'release', 'releasing', 'released',
      'rollback', 'rollbacking', 'rollbacked',
      'provision', 'provisioning', 'provisioned',
    ]

    const results: Array<{ id: string; verb: string; from: string; to: string; data: Record<string, unknown> | null; createdAt: Date }> = []
    const seenIds = new Set<string>()

    for (const verb of commonVerbs) {
      const rels = await this.store.queryRelationshipsByVerb(verb)
      for (const rel of rels) {
        if (!seenIds.has(rel.id)) {
          seenIds.add(rel.id)
          results.push(rel)
        }
      }
    }

    return results
  }

  /**
   * Extract action state from relationship data.
   */
  private extractState(data: Record<string, unknown> | null): ActionState {
    if (!data || !data.__actionState) {
      // Return a default state for backwards compatibility
      return {
        actionId: '',
        originalTo: '',
        status: 'pending',
      }
    }
    return data.__actionState as ActionState
  }

  /**
   * Extract user data (remove internal state).
   */
  private extractUserData(data: Record<string, unknown> | null): Record<string, unknown> | undefined {
    if (!data) {
      return undefined
    }
    const { __actionState, ...userData } = data
    return Object.keys(userData).length > 0 ? userData : undefined
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an ActionLifecycleStore bound to a GraphStore.
 *
 * @param store - The SQLiteGraphStore to use for persistence
 * @returns An ActionLifecycleStore instance
 */
export function createActionLifecycleStore(store: SQLiteGraphStore): ActionLifecycleStore {
  return new ActionLifecycleStore(store)
}
