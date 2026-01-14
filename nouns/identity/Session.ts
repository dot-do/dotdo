import { defineNoun } from '../types'
import { SessionSchema } from '../../ai/primitives/packages/id.org.ai/src'

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
