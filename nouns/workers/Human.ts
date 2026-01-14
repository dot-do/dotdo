import { z } from 'zod'
import { defineNoun } from '../types'
import { WorkerSchema } from './Worker'

/**
 * Human Schema - Human worker that may require approval for actions
 *
 * Humans extend Worker with properties for managing human-in-the-loop workflows,
 * including approval requirements and notification preferences.
 *
 * @see https://schema.org.ai/Human
 */
export const HumanSchema = WorkerSchema.omit({ $type: true }).extend({
  /** JSON-LD type discriminator for Human */
  $type: z.literal('https://schema.org.ai/Human'),
  /** Whether actions require approval from this human */
  requiresApproval: z.boolean(),
  /** Channels for sending notifications (e.g., 'email', 'slack', 'sms') */
  notificationChannels: z.array(z.string()),
  /** Email address for the human worker */
  email: z.string().email().optional(),
  /** Timezone for scheduling and notifications */
  timezone: z.string().optional(),
  /** Working hours (ISO 8601 time format) */
  workingHours: z.object({
    start: z.string(),
    end: z.string(),
  }).optional(),
  /** Preferred language for communications */
  preferredLanguage: z.string().optional(),
})

export type Human = z.infer<typeof HumanSchema>

/**
 * Human Noun definition
 */
export const Human = defineNoun({
  noun: 'Human',
  plural: 'Humans',
  $type: 'https://schema.org.ai/Human',
  schema: HumanSchema,
  extends: 'Worker',
  defaults: {
    status: 'available',
    skills: [],
    requiresApproval: true,
    notificationChannels: ['email'],
  },
})

/**
 * Type guard to check if an object is a valid Human
 */
export function isHuman(obj: unknown): obj is Human {
  return HumanSchema.safeParse(obj).success
}
