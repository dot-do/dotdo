/**
 * Role Types and defineRole()
 *
 * Defines role types for the agent system.
 * Roles define the capabilities and OKRs that agents can implement.
 *
 * @see dotdo-89132 - TDD: Role types and defineRole()
 * @see dotdo-r6my2 - TDD: Agent types and defineAgent()
 * @module agents/roles
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Role configuration for defining a role
 */
export interface RoleConfig {
  /** Role identifier name */
  name: string
  /** OKRs (Objectives and Key Results) this role aims to achieve */
  okrs: string[]
  /** Capabilities this role provides */
  capabilities: string[]
  /** Optional description */
  description?: string
}

/**
 * Role object representing a defined role
 *
 * Roles are the "job descriptions" that agents implement.
 * Multiple agents can share the same role with different personas.
 */
export interface Role {
  /** Role identifier name */
  readonly name: string
  /** OKRs (Objectives and Key Results) */
  readonly okrs: readonly string[]
  /** Capabilities this role provides */
  readonly capabilities: readonly string[]
  /** Optional description */
  readonly description?: string
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Define a role with OKRs and capabilities
 *
 * @example
 * ```ts
 * const product = defineRole({
 *   name: 'product',
 *   okrs: ['Define MVP', 'Create roadmaps'],
 *   capabilities: ['Write specs', 'Prioritize features'],
 * })
 * ```
 */
export function defineRole(config: RoleConfig): Role {
  return {
    name: config.name,
    okrs: Object.freeze([...config.okrs]),
    capabilities: Object.freeze([...config.capabilities]),
    description: config.description,
  }
}

// ============================================================================
// Pre-defined Roles
// ============================================================================

/**
 * Product role - defines products, specs, and roadmaps
 */
export const product = defineRole({
  name: 'product',
  okrs: [
    'Define MVP requirements and scope',
    'Create product specifications',
    'Plan feature roadmaps',
    'Prioritize based on user value',
  ],
  capabilities: [
    'Write product specs',
    'Define user stories',
    'Create acceptance criteria',
    'Prioritize features',
    'Plan roadmaps',
  ],
  description: 'Product Manager - specs, roadmaps, MVP definition',
})

/**
 * Engineering role - builds and implements code
 */
export const engineering = defineRole({
  name: 'engineering',
  okrs: [
    'Write clean, production-ready code',
    'Implement features from specifications',
    'Maintain code quality and tests',
  ],
  capabilities: [
    'Write TypeScript code',
    'Implement features',
    'Refactor code',
    'Write tests',
    'Debug issues',
  ],
  description: 'Software Engineer - builds code, implements features',
})

/**
 * Tech Lead role - architecture, review, technical decisions
 */
export const techLead = defineRole({
  name: 'tech-lead',
  okrs: [
    'Ensure code quality and correctness',
    'Design scalable architecture',
    'Mentor team members',
  ],
  capabilities: [
    'Review code',
    'Design architecture',
    'Make technical decisions',
    'Identify risks',
    'Provide feedback',
  ],
  description: 'Tech Lead - architecture, code review, technical decisions',
})

/**
 * Marketing role - content, launches, announcements
 */
export const marketing = defineRole({
  name: 'marketing',
  okrs: [
    'Create compelling content',
    'Plan product launches',
    'Build brand awareness',
  ],
  capabilities: [
    'Write copy',
    'Plan launches',
    'Create announcements',
    'Communicate value',
    'Build brand voice',
  ],
  description: 'Marketing Lead - content, launches, announcements',
})

/**
 * Sales role - outreach, pitches, closing deals
 */
export const sales = defineRole({
  name: 'sales',
  okrs: [
    'Generate leads',
    'Close deals',
    'Build customer relationships',
  ],
  capabilities: [
    'Create pitches',
    'Qualify leads',
    'Handle objections',
    'Negotiate deals',
    'Build relationships',
  ],
  description: 'Sales Lead - outreach, pitches, closing deals',
})

/**
 * QA role - testing, quality assurance
 */
export const qa = defineRole({
  name: 'qa',
  okrs: [
    'Ensure product quality',
    'Find bugs before release',
    'Validate requirements',
  ],
  capabilities: [
    'Design test strategies',
    'Write test cases',
    'Find edge cases',
    'Validate features',
    'Report bugs',
  ],
  description: 'QA Lead - testing, quality assurance, bug finding',
})

/**
 * Frontend role - UI, components, design systems
 */
export const frontend = defineRole({
  name: 'frontend',
  okrs: [
    'Build beautiful, accessible UIs',
    'Create reusable components',
    'Optimize performance',
  ],
  capabilities: [
    'Build React components',
    'Create design systems',
    'Implement responsive layouts',
    'Add animations',
    'Optimize bundles',
  ],
  description: 'Frontend Engineer - React, components, design systems',
})

/**
 * Data role - analytics, metrics, data-driven insights
 */
export const data = defineRole({
  name: 'data',
  okrs: [
    'Generate actionable data-driven insights',
    'Track and improve key metrics',
    'Enable data-informed decision making',
  ],
  capabilities: [
    'Analyze metrics and KPIs',
    'Generate data-driven insights',
    'Build reports and dashboards',
    'Identify trends and anomalies',
    'Perform cohort and funnel analysis',
    'Track feature adoption',
    'Calculate business metrics',
  ],
  description: 'Data Analyst - analytics, metrics, data-driven insights',
})
