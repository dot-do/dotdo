/**
 * @packageDocumentation
 * @module @dotdo/business-as-code
 *
 * Business-as-Code primitives for modeling organizations, businesses,
 * companies, and workspaces with schema.org.ai integration.
 *
 * This package provides:
 * - **Entity Types**: Organization, Business, Company, Org
 * - **OKR Types**: Goal, KeyResult, Objective
 * - **Zod Schemas**: Runtime validation for all types
 * - **Type Guards**: isOrganization, isBusiness, isCompany, isGoal, isKeyResult
 * - **Factories**: createBusiness for convenient instantiation
 *
 * @example
 * ```typescript
 * import {
 *   createBusiness,
 *   isBusiness,
 *   GoalSchema,
 *   type Business,
 *   type Goal
 * } from '@dotdo/business-as-code'
 *
 * // Create a business
 * const business = createBusiness({
 *   $id: 'https://schema.org.ai/businesses/startup',
 *   name: 'My Startup'
 * })
 *
 * // Add goals
 * business.goals.push({
 *   objective: 'Achieve product-market fit',
 *   keyResults: [
 *     { metric: 'MRR', target: 50000, current: 32000, source: 'stripe.mrr' }
 *   ],
 *   status: 'active'
 * })
 *
 * // Validate data
 * if (isBusiness(data)) {
 *   console.log(`${data.name} has ${data.goals.length} goals`)
 * }
 * ```
 */

// ============================================================================
// Core Entity Types
// ============================================================================

/**
 * Core entity type interfaces for organizational modeling.
 * These form the hierarchy: Organization -> Business -> Company
 */
export type {
  Organization,
  Business,
  Company,
  Org,
  Goal,
  Objective,
  KeyResult,
  Address,
  OrgBilling,
} from './types'

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Zod schemas for runtime validation of entity types.
 * Use these with safeParse() for type-safe validation.
 */
export {
  OrganizationSchema,
  BusinessSchema,
  CompanySchema,
  GoalSchema,
  KeyResultSchema,
} from './types'

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard functions for runtime type checking.
 * Returns true if the object conforms to the expected interface.
 */
export {
  isOrganization,
  isBusiness,
  isCompany,
  isGoal,
  isKeyResult,
} from './types'

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Factory functions for creating properly typed entity instances.
 */
export {
  createBusiness,
} from './types'

// ============================================================================
// Re-export All
// ============================================================================

// Re-export everything for convenience
export * from './types'
