import { z } from 'zod'
import { defineNoun } from '../types'

/**
 * AgentIdentity schema - Zod v4 compatible wrapper
 *
 * This schema mirrors the shape of AgentIdentitySchema from ai/primitives/id.org.ai
 * but uses Zod v4 to maintain type compatibility with dotdo's Noun system.
 *
 * @see ai/primitives/packages/id.org.ai/src for the canonical definition
 */
const AgentIdentitySchemaLocal = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/AgentIdentity'),
  model: z.string(),
  capabilities: z.array(z.string()),
  autonomous: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/**
 * AgentIdentity - AI agent identity
 *
 * Extends Identity with agent-specific fields:
 * - model: The AI model powering this agent (e.g., 'claude-3-opus')
 * - capabilities: List of capabilities this agent supports
 * - autonomous: Whether the agent can act autonomously without human approval
 */
export const AgentIdentity = defineNoun({
  noun: 'AgentIdentity',
  plural: 'AgentIdentities',
  $type: 'https://schema.org.ai/AgentIdentity',
  schema: AgentIdentitySchemaLocal,
  extends: 'Identity',
})
