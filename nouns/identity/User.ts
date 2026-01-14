import { defineNoun } from '../types'
import { UserSchema } from '../../ai/primitives/packages/id.org.ai/src'

/**
 * User - Human user identity
 *
 * Extends Identity with human-specific fields:
 * - email: User's email address
 * - name: Display name
 * - profile: Optional metadata
 */
export const User = defineNoun({
  noun: 'User',
  plural: 'Users',
  $type: 'https://schema.org.ai/User',
  schema: UserSchema,
  extends: 'Identity',
})
