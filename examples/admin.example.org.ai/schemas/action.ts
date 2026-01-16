/**
 * Action Schema - Command Log
 *
 * Actions are the source of truth for all mutations.
 * They reference thing versions for before/after state.
 *
 * @module schemas/action
 */

import { z } from 'zod'

/**
 * Action status enum
 */
export const ActionStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'undone',
  'retrying',
])
export type ActionStatus = z.infer<typeof ActionStatusSchema>

/**
 * Action durability level
 * - send: Fire-and-forget
 * - try: Single attempt
 * - do: Durable with retries
 */
export const ActionDurabilitySchema = z.enum(['send', 'try', 'do'])
export type ActionDurability = z.infer<typeof ActionDurabilitySchema>

/**
 * Error details schema
 */
export const ActionErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
  stack: z.string().optional(),
  retryable: z.boolean().optional(),
})

/**
 * ActionSchema - validates action command records
 *
 * Every action has:
 * - verb: what was done (uses 'action' form like 'create')
 * - actor: who did it (local path or URL)
 * - target: what was affected (local path)
 * - input: thing version before the action (null for creates)
 * - output: thing version after the action (null for deletes)
 * - options: additional parameters
 */
export const ActionSchema = z.object({
  /** UUID for external reference */
  id: z.string().uuid(),

  /** The action verb (create, update, delete) */
  verb: z.string().min(1, 'verb is required'),

  /** Actor who performed the action (e.g., 'Human/nathan', 'Agent/support') */
  actor: z.string().optional(),
  /** Target of the action (e.g., 'Startup/acme') */
  target: z.string().min(1, 'target is required'),

  /** Thing version before the action (null for create) */
  input: z.number().int().positive().nullable(),
  /** Thing version after the action (null for delete) */
  output: z.number().int().positive().nullable(),

  /** Additional parameters */
  options: z.record(z.string(), z.unknown()).optional(),

  /** Durability level */
  durability: ActionDurabilitySchema.default('try'),

  /** Current status */
  status: ActionStatusSchema.default('pending'),
  /** Error details if failed */
  error: ActionErrorSchema.nullable().optional(),

  /** Request correlation ID */
  requestId: z.string().optional(),
  /** Session ID */
  sessionId: z.string().optional(),
  /** Workflow ID for durable workflows */
  workflowId: z.string().optional(),

  /** When execution started */
  startedAt: z.date().optional(),
  /** When execution completed */
  completedAt: z.date().optional(),
  /** Duration in milliseconds */
  duration: z.number().int().nonnegative().optional(),

  /** When the action record was created */
  createdAt: z.date(),
})

export type ActionSchemaType = z.infer<typeof ActionSchema>

/**
 * Schema for creating a new action (subset of required fields)
 */
export const NewActionSchema = ActionSchema.pick({
  verb: true,
  target: true,
  actor: true,
  options: true,
  durability: true,
  requestId: true,
  sessionId: true,
  workflowId: true,
}).extend({
  id: z.string().uuid().optional(),
})

export type NewActionType = z.infer<typeof NewActionSchema>
