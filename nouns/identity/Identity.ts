import { defineNoun } from '../types'
import { IdentitySchema } from '../../ai/primitives/packages/id.org.ai/src'

/**
 * Identity - Base identity for humans and AI agents
 *
 * All identity types (User, AgentIdentity) extend this base type.
 * Follows JSON-LD conventions with $id and $type fields.
 */
export const Identity = defineNoun({
  noun: 'Identity',
  plural: 'Identities',
  $type: 'https://schema.org.ai/Identity',
  schema: IdentitySchema,
})
