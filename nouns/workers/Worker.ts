import { z } from 'zod'
import { defineNoun } from '../types'

/**
 * Worker Schema - Base interface for work performers
 *
 * Workers are the fundamental unit of work execution in the digital-workers system.
 * They can be either AI agents or human workers, and track availability status.
 *
 * @see https://schema.org.ai/Worker
 */
export const WorkerSchema = z.object({
  /** Unique identifier URI for the worker */
  $id: z.string(),
  /** JSON-LD type discriminator */
  $type: z.literal('https://schema.org.ai/Worker'),
  /** Display name of the worker */
  name: z.string(),
  /** List of skills/capabilities the worker possesses */
  skills: z.array(z.string()),
  /** Current availability status */
  status: z.enum(['available', 'busy', 'away', 'offline']),
})

export type Worker = z.infer<typeof WorkerSchema>

/**
 * Worker Noun definition
 */
export const Worker = defineNoun({
  noun: 'Worker',
  plural: 'Workers',
  $type: 'https://schema.org.ai/Worker',
  schema: WorkerSchema,
  defaults: {
    status: 'available',
    skills: [],
  },
})

/**
 * Type guard to check if an object is a valid Worker
 */
export function isWorker(obj: unknown): obj is Worker {
  return WorkerSchema.safeParse(obj).success
}
