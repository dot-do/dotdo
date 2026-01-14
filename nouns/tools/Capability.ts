import { defineNoun } from '../types'
import { CapabilitySchema } from 'digital-tools'

/**
 * Capability - Permissions and abilities (fsx, gitx, bashx, etc.)
 *
 * Capabilities represent internal system features that provide access to
 * local resources like file systems, git repositories, shell commands,
 * and other system-level operations. They define what actions a worker
 * is permitted to perform and what resources it can access.
 *
 * Capabilities differ from Tools and Integrations in that they represent
 * permission boundaries and internal system access rather than external services.
 *
 * @see https://schema.org.ai/Capability
 */
export const Capability = defineNoun({
  noun: 'Capability',
  plural: 'Capabilities',
  $type: 'https://schema.org.ai/Capability',
  schema: CapabilitySchema,
})
