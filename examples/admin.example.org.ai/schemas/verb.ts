/**
 * Verb Schema - Predicate Registry
 *
 * Verbs define the predicates used in relationships and actions.
 * They have linguistic forms for natural language generation.
 *
 * @module schemas/verb
 */

import { z } from 'zod'

/**
 * VerbSchema - validates verb definitions
 *
 * Verbs are the predicate registry. Each verb has multiple linguistic forms:
 * - verb: predicate form (Subject creates Object)
 * - action: imperative form ($.do('create', ...))
 * - activity: present participle (creating)
 * - event: past participle (created)
 * - reverse: backward operator (<-, <~)
 * - inverse: opposite predicate (creates -> deletes)
 *
 * Convention: given event 'created'
 *   - createdBy = actor
 *   - createdAt = timestamp
 *   - createdIn = request/context
 */
export const VerbSchema = z.object({
  /** Predicate form - reads naturally in graph (Subject creates Object) */
  verb: z.string().min(1, 'verb is required'),

  /** Imperative/base form (create) */
  action: z.string().optional(),
  /** Present participle/gerund (creating) */
  activity: z.string().optional(),
  /** Past participle (created) */
  event: z.string().optional(),
  /** Backward operator form (createdBy) */
  reverse: z.string().optional(),
  /** Opposite predicate (deletes) */
  inverse: z.string().optional(),

  /** Human-readable description */
  description: z.string().optional(),
})

export type VerbSchemaType = z.infer<typeof VerbSchema>

/**
 * Common verbs with all linguistic forms
 */
export const COMMON_VERBS = [
  { verb: 'creates', action: 'create', activity: 'creating', event: 'created', reverse: 'createdBy', inverse: 'deletes' },
  { verb: 'updates', action: 'update', activity: 'updating', event: 'updated', reverse: 'updatedBy', inverse: null },
  { verb: 'deletes', action: 'delete', activity: 'deleting', event: 'deleted', reverse: 'deletedBy', inverse: 'creates' },
  { verb: 'owns', action: 'own', activity: 'owning', event: 'owned', reverse: 'ownedBy', inverse: null },
  { verb: 'manages', action: 'manage', activity: 'managing', event: 'managed', reverse: 'managedBy', inverse: null },
  { verb: 'belongs', action: 'belong', activity: 'belonging', event: 'belonged', reverse: 'has', inverse: null },
] as const
