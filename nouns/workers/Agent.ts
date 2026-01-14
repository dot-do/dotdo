import { z } from 'zod'
import { defineNoun } from '../types'
import { WorkerSchema } from './Worker'

/**
 * Agent Schema - AI autonomous worker that can perform tasks independently
 *
 * Agents extend Worker with AI-specific properties including the model used,
 * available tools, and whether they can operate autonomously without human oversight.
 *
 * @see https://schema.org.ai/Agent
 */
export const AgentSchema = WorkerSchema.omit({ $type: true }).extend({
  /** JSON-LD type discriminator for Agent */
  $type: z.literal('https://schema.org.ai/Agent'),
  /** AI model identifier (e.g., 'claude-3-opus', 'gpt-4') */
  model: z.string(),
  /** List of tools the agent can use */
  tools: z.array(z.string()),
  /** Whether the agent can operate without human approval */
  autonomous: z.boolean(),
  /** System prompt/instructions for the agent */
  systemPrompt: z.string().optional(),
  /** Temperature setting for the model (0-1) */
  temperature: z.number().min(0).max(1).optional(),
  /** Maximum tokens per response */
  maxTokens: z.number().optional(),
})

export type Agent = z.infer<typeof AgentSchema>

/**
 * Agent Noun definition
 */
export const Agent = defineNoun({
  noun: 'Agent',
  plural: 'Agents',
  $type: 'https://schema.org.ai/Agent',
  schema: AgentSchema,
  extends: 'Worker',
  defaults: {
    status: 'available',
    skills: [],
    tools: [],
    autonomous: false,
  },
})

/**
 * Type guard to check if an object is a valid Agent
 */
export function isAgent(obj: unknown): obj is Agent {
  return AgentSchema.safeParse(obj).success
}
