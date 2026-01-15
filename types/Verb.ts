/**
 * Verb - Predicate registry for defining domain actions and events
 *
 * Verbs represent actions that can be performed on Things. Each verb has
 * multiple grammatical forms for different contexts:
 * - Base form (imperative): 'create', 'update', 'delete'
 * - Present participle (activity): 'creating', 'updating', 'deleting'
 * - Past participle (event): 'created', 'updated', 'deleted'
 *
 * Verbs also derive standard field names:
 * - '{event}By' for actor references (e.g., 'createdBy')
 * - '{event}At' for timestamps (e.g., 'createdAt')
 * - '{event}In' for context (e.g., 'createdIn')
 *
 * @module types/Verb
 *
 * @example
 * ```typescript
 * import type { VerbData, Verb } from 'dotdo/types'
 * import { getVerbForms, conjugate, StandardVerbs } from 'dotdo/types'
 *
 * // Use standard verbs
 * const createVerb = getVerbForms(StandardVerbs.create)
 * console.log(createVerb.event) // 'created'
 * console.log(createVerb.by)    // 'createdBy'
 * console.log(createVerb.at)    // 'createdAt'
 *
 * // Auto-conjugate a custom verb
 * const customVerb = conjugate('publish')
 * console.log(customVerb.activity) // 'publishing'
 * console.log(customVerb.event)    // 'published'
 * ```
 */

// ============================================================================
// VERB - Predicate registry entry
// ============================================================================

/**
 * VerbData - Base data structure for verb definitions
 *
 * Defines the grammatical forms and metadata for an action verb.
 *
 * @see {@link Verb} for the full verb instance with derived fields
 * @see {@link conjugate} for auto-generating verb forms
 */
export interface VerbData {
  /** Base form of the verb (imperative, e.g., 'create', 'update', 'delete') */
  verb: string
  /** Present participle / gerund form (e.g., 'creating', 'updating') */
  activity?: string
  /** Past participle form used for events (e.g., 'created', 'updated') */
  event?: string
  /** Inverse/opposite verb (e.g., 'delete' is inverse of 'create') */
  inverse?: string
  /** Human-readable description of the verb */
  description?: string
}

/**
 * Convention: Given an event form like 'created', the following field names are derived:
 * - createdBy: Reference to the actor who performed the action
 * - createdAt: Timestamp when the action occurred
 * - createdIn: Context/request in which the action was performed
 */

/**
 * Verb - Full verb instance with derived field names
 *
 * Extends VerbData with derived field names following the convention:
 * - `by`: Actor reference field ('{event}By')
 * - `at`: Timestamp field ('{event}At')
 * - `in`: Context field ('{event}In')
 *
 * @see {@link getVerbForms} for creating a Verb from VerbData
 */
export interface Verb extends VerbData {
  /** Derived actor reference field name (e.g., 'createdBy') */
  readonly by: string
  /** Derived timestamp field name (e.g., 'createdAt') */
  readonly at: string
  /** Derived context field name (e.g., 'createdIn') */
  readonly in: string
}

// ============================================================================
// STANDARD VERBS
// ============================================================================

/**
 * StandardVerbs - Pre-defined common verbs with correct conjugations
 *
 * Provides a registry of commonly used verbs with their grammatical forms
 * and inverse relationships already defined.
 *
 * @example
 * ```typescript
 * import { StandardVerbs, getVerbForms } from 'dotdo/types'
 *
 * // Get the full verb with derived fields
 * const verb = getVerbForms(StandardVerbs.create)
 * console.log(verb.event) // 'created'
 * console.log(verb.by)    // 'createdBy'
 *
 * // Check inverse relationship
 * console.log(StandardVerbs.create.inverse) // 'delete'
 * console.log(StandardVerbs.delete.inverse) // 'create'
 * ```
 */
export const StandardVerbs: Record<string, VerbData> = {
  create: {
    verb: 'create',
    activity: 'creating',
    event: 'created',
    inverse: 'delete',
  },
  update: {
    verb: 'update',
    activity: 'updating',
    event: 'updated',
  },
  delete: {
    verb: 'delete',
    activity: 'deleting',
    event: 'deleted',
    inverse: 'create',
  },
  assign: {
    verb: 'assign',
    activity: 'assigning',
    event: 'assigned',
    inverse: 'unassign',
  },
  unassign: {
    verb: 'unassign',
    activity: 'unassigning',
    event: 'unassigned',
    inverse: 'assign',
  },
  publish: {
    verb: 'publish',
    activity: 'publishing',
    event: 'published',
    inverse: 'unpublish',
  },
  archive: {
    verb: 'archive',
    activity: 'archiving',
    event: 'archived',
    inverse: 'unarchive',
  },
  approve: {
    verb: 'approve',
    activity: 'approving',
    event: 'approved',
    inverse: 'reject',
  },
  reject: {
    verb: 'reject',
    activity: 'rejecting',
    event: 'rejected',
    inverse: 'approve',
  },
  complete: {
    verb: 'complete',
    activity: 'completing',
    event: 'completed',
    inverse: 'reopen',
  },
  start: {
    verb: 'start',
    activity: 'starting',
    event: 'started',
    inverse: 'stop',
  },
  stop: {
    verb: 'stop',
    activity: 'stopping',
    event: 'stopped',
    inverse: 'start',
  },
}

// ============================================================================
// HELPER: Get derived forms
// ============================================================================

/**
 * Get the full Verb instance with derived field names
 *
 * Takes a VerbData and adds the derived field names following the convention:
 * - `by`: '{event}By' for actor references
 * - `at`: '{event}At' for timestamps
 * - `in`: '{event}In' for context
 *
 * @param verb - The base VerbData to extend
 * @returns A Verb with all derived field names
 *
 * @example
 * ```typescript
 * const verb = getVerbForms({ verb: 'create', event: 'created' })
 * console.log(verb.by) // 'createdBy'
 * console.log(verb.at) // 'createdAt'
 * console.log(verb.in) // 'createdIn'
 * ```
 */
export function getVerbForms(verb: VerbData): Verb {
  const event = verb.event || verb.verb + 'ed'

  return {
    ...verb,
    event,
    by: event + 'By',
    at: event + 'At',
    in: event + 'In',
  }
}

// ============================================================================
// HELPER: Conjugate verb (simple rules)
// ============================================================================

/**
 * Auto-conjugate a verb using simple English rules
 *
 * Generates the activity (present participle) and event (past participle)
 * forms from the base verb using basic conjugation rules:
 * - Verbs ending in 'e': add 'ing'/'d' (create -> creating/created)
 * - Verbs ending in 'y': change to 'ying'/'ied' (apply -> applying/applied)
 * - Other verbs: add 'ing'/'ed' (start -> starting/started)
 *
 * Note: This is a fallback for simple cases. Prefer explicit definitions
 * in StandardVerbs for irregular verbs or when precision is needed.
 *
 * @param verb - The base verb to conjugate
 * @returns A VerbData with generated activity and event forms
 *
 * @example
 * ```typescript
 * conjugate('publish')
 * // { verb: 'publish', activity: 'publishing', event: 'published' }
 *
 * conjugate('create')
 * // { verb: 'create', activity: 'creating', event: 'created' }
 *
 * conjugate('apply')
 * // { verb: 'apply', activity: 'applying', event: 'applied' }
 * ```
 */
export function conjugate(verb: string): VerbData {
  // Simple English conjugation rules
  // This is a fallback - prefer explicit definitions

  let activity: string
  let event: string

  if (verb.endsWith('e')) {
    activity = verb + 'ing'
    event = verb + 'd'
  } else if (verb.endsWith('y')) {
    activity = verb.slice(0, -1) + 'ying'
    event = verb.slice(0, -1) + 'ied'
  } else {
    activity = verb + 'ing'
    event = verb + 'ed'
  }

  return {
    verb,
    activity,
    event,
  }
}
