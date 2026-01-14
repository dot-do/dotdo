import { defineNoun } from '../types'
import { CredentialSchema } from '../../ai/primitives/packages/id.org.ai/src'

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
  schema: CredentialSchema,
})
