import { z } from 'zod'
import { defineNoun } from '../types'

/**
 * User schema - Zod v4 compatible wrapper
 *
 * This schema mirrors the shape of UserSchema from ai/primitives/id.org.ai
 * but uses Zod v4 to maintain type compatibility with dotdo's Noun system.
 *
 * @see ai/primitives/packages/id.org.ai/src for the canonical definition
 */
const UserSchemaLocal = z.object({
  $id: z.string().min(1),
  $type: z.literal('https://schema.org.ai/User'),
  email: z.string().email(),
  name: z.string().min(1),
  profile: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

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
  schema: UserSchemaLocal,
  extends: 'Identity',
})
