import { z } from 'zod'
import { defineNoun } from '../types'

/**
 * Local Session schema (Zod v4 compatible)
 *
 * Mirrors the schema from id.org.ai but using the main project's Zod version
 * to avoid Zod v3/v4 type incompatibility.
 */
export const SessionSchema = z.object({
  $id: z.string().min(1),
  $type: z.literal('https://schema.org.ai/Session'),
  identityId: z.string().min(1),
  token: z.string().min(1),
  expiresAt: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Session - Active authentication session
 *
 * Represents an authenticated session for an Identity:
 * - identityId: Reference to the authenticated identity
 * - token: Secure session token
 * - expiresAt: ISO 8601 timestamp when the session expires
 * - metadata: Optional session metadata (user agent, IP, etc.)
 */
export const Session = defineNoun({
  noun: 'Session',
  plural: 'Sessions',
  $type: 'https://schema.org.ai/Session',
  schema: SessionSchema,
})
