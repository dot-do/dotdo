import { z } from 'zod'
import { defineNoun } from '../types'

/**
 * Local Identity schema (Zod v4 compatible)
 *
 * Mirrors the schema from id.org.ai but using the main project's Zod version
 * to avoid Zod v3/v4 type incompatibility.
 */
export const IdentitySchema = z.object({
  $id: z.string().min(1),
  $type: z.literal('https://schema.org.ai/Identity'),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

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
