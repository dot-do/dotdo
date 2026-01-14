import { defineNoun } from '../types'
import { AgentIdentitySchema } from '../../ai/primitives/packages/id.org.ai/src'

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
  schema: AgentIdentitySchema,
  extends: 'Identity',
})
