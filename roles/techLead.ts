/**
 * Tech Lead Role Definition
 *
 * The techLead role represents the technical leadership function in the
 * Business-as-Code framework. Tech leads optimize for SystemReliability
 * and ArchitectureHealth, with capabilities to review, architect, and approve.
 *
 * @see dotdo-ksy45 - TDD: Tech Lead role
 * @module roles/techLead
 */

import { defineRole } from './define'

/**
 * Tech Lead role
 *
 * Optimizes for:
 * - SystemReliability: Ensuring system uptime and stability
 * - ArchitectureHealth: Maintaining clean, scalable architecture
 *
 * Capabilities:
 * - review: Code review and PR approvals
 * - architect: System design and architecture decisions
 * - approve: Sign-off on technical decisions
 *
 * @example
 * ```typescript
 * import { techLead } from './roles/techLead'
 *
 * // Review architecture
 * await techLead`review the API architecture`
 *
 * // Approve changes
 * await techLead`approve ${pullRequest} for merge`
 * ```
 */
export const techLead = defineRole({
  name: 'techLead',
  okrs: ['SystemReliability', 'ArchitectureHealth'],
  capabilities: ['review', 'architect', 'approve'],
})
