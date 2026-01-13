/**
 * Role Type Definitions
 *
 * Roles represent job functions in the Business-as-Code framework.
 * Each role has specific OKRs (metrics it optimizes for) and capabilities
 * (actions it can perform).
 *
 * @see dotdo-89132 - TDD: Role types and defineRole()
 * @module roles/types
 */

/**
 * OKR (Objectives and Key Results) metric name
 *
 * These are the metrics a role optimizes for:
 * - Product: FeatureAdoption, UserSatisfaction, TimeToValue
 * - Engineering: BuildVelocity, CodeQuality, SystemReliability
 * - Sales: PipelineHealth, ConversionRate, RevenueGrowth
 * - Support: ResponseTime, ResolutionRate, CustomerSatisfaction
 * - etc.
 */
export type OKRMetric = string

/**
 * Capability name
 *
 * These are the actions a role can perform:
 * - Product: spec, roadmap, prioritize, plan
 * - Engineering: implement, refactor, test
 * - Sales: pitch, qualify, negotiate, close
 * - etc.
 */
export type Capability = string

/**
 * Configuration for defining a role
 */
export interface RoleConfig {
  /** Unique identifier for the role (e.g., 'product', 'engineering', 'sales') */
  name: string

  /** OKR metrics this role optimizes for */
  okrs: OKRMetric[]

  /** Actions/capabilities this role can perform */
  capabilities: Capability[]
}

/**
 * Pipeline promise with chainable methods
 * Matches the pattern from agents/named/factory.ts
 */
export interface PipelinePromise<T> extends Promise<T> {
  map<R>(fn: (value: T) => R | Promise<R>): PipelinePromise<R>
}

/**
 * Role - A callable job function with OKRs and capabilities
 *
 * Roles can be invoked via template literals or function calls:
 *
 * @example
 * ```typescript
 * // Template literal invocation
 * await product`plan the roadmap`
 *
 * // With interpolation
 * await product`plan ${feature} for Q1`
 * ```
 *
 * The Role interface combines:
 * 1. Callable function (template literal tag or direct call)
 * 2. Metadata properties (name, okrs, capabilities)
 */
export interface Role {
  /** Template literal invocation */
  (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<string>
  /** Function call invocation (alternative syntax) */
  (input: string | object): PipelinePromise<string>

  /** Role identifier (e.g., 'product', 'engineering') */
  readonly name: string

  /** OKR metrics this role optimizes for */
  readonly okrs: readonly OKRMetric[]

  /** Actions/capabilities this role can perform */
  readonly capabilities: readonly Capability[]
}
