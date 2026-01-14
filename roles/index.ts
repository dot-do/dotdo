/**
 * Roles System
 *
 * Roles represent job functions in the Business-as-Code framework.
 * Each role has specific OKRs (metrics it optimizes for) and capabilities
 * (actions it can perform).
 *
 * @example
 * ```typescript
 * import { defineRole } from './roles'
 *
 * const product = defineRole({
 *   name: 'product',
 *   okrs: ['FeatureAdoption', 'UserSatisfaction', 'TimeToValue'],
 *   capabilities: ['spec', 'roadmap', 'prioritize', 'plan'],
 * })
 *
 * // Usage
 * await product`plan the roadmap`
 * ```
 *
 * @module roles
 */

export { defineRole, enableMockMode, disableMockMode } from './define'
export type { Role, RoleConfig, PipelinePromise, OKRMetric, Capability } from './types'

// Pre-defined roles
export { data } from './data'
export { engineering } from './engineering'
export { finance } from './finance'
export { marketing } from './marketing'
export { product } from './product'
export { support } from './support'
export { techLead } from './techLead'
