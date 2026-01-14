import { z } from 'zod'
import { defineNoun } from '../types'

/**
 * Team Schema - A group of workers that collaborate on tasks
 *
 * Teams can consist of AI agents, human workers, or a mix of both.
 * They coordinate work through shared goals and complementary skills.
 *
 * @see https://schema.org.ai/Team
 */
export const TeamSchema = z.object({
  /** Unique identifier URI for the team */
  $id: z.string(),
  /** JSON-LD type discriminator */
  $type: z.literal('https://schema.org.ai/Team'),
  /** Team name */
  name: z.string(),
  /** Team description */
  description: z.string().optional(),
  /** List of worker IDs in the team (can be Agent or Human) */
  members: z.array(z.string()),
  /** Team lead worker ID (optional) */
  lead: z.string().optional(),
  /** Collective skills across all team members */
  skills: z.array(z.string()).optional(),
  /** Team status */
  status: z.enum(['active', 'inactive', 'forming']).optional(),
  /** Team goals or OKRs */
  goals: z.array(z.string()).optional(),
  /** Communication channels for the team */
  channels: z.array(z.object({
    type: z.enum(['slack', 'email', 'discord', 'teams', 'other']),
    identifier: z.string(),
  })).optional(),
  /** Team capacity (max concurrent tasks) */
  capacity: z.number().optional(),
  /** Current workload (active tasks) */
  workload: z.number().optional(),
})

export type Team = z.infer<typeof TeamSchema>

/**
 * Team Noun definition
 */
export const Team = defineNoun({
  noun: 'Team',
  plural: 'Teams',
  $type: 'https://schema.org.ai/Team',
  schema: TeamSchema,
  defaults: {
    status: 'active',
    members: [],
    skills: [],
    workload: 0,
  },
})

/**
 * Type guard to check if an object is a valid Team
 */
export function isTeam(obj: unknown): obj is Team {
  return TeamSchema.safeParse(obj).success
}
