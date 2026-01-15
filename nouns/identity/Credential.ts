import { z } from 'zod'
import { defineNoun } from '../types'

/**
 * Credential schema - Zod v4 compatible wrapper
 *
 * This schema mirrors the shape of CredentialSchema from ai/primitives/id.org.ai
 * but uses Zod v4 to maintain type compatibility with dotdo's Noun system.
 *
 * @see ai/primitives/packages/id.org.ai/src for the canonical definition
 */
const CredentialSchemaLocal = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Credential'),
  identityId: z.string(),
  credentialType: z.enum(['password', 'oauth', 'api_key', 'sso']),
  provider: z.string().optional(),
  expiresAt: z.string().optional(),
})

/**
 * Credential - Authentication credential for an identity
 *
 * Represents an authentication method associated with an Identity:
 * - identityId: Reference to the identity this credential belongs to
 * - credentialType: Type of credential (password, oauth, api_key, sso)
 * - provider: OAuth/SSO provider name (e.g., 'google', 'github')
 * - expiresAt: ISO 8601 timestamp when the credential expires
 *
 * Note: This stores credential metadata, NOT the actual secret values.
 */
export const Credential = defineNoun({
  noun: 'Credential',
  plural: 'Credentials',
  $type: 'https://schema.org.ai/Credential',
  schema: CredentialSchemaLocal,
})
