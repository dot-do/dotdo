/**
 * @dotdo/business-as-code
 *
 * Business-as-Code primitives for modeling organizations, businesses,
 * companies, and workspaces with schema.org.ai integration.
 *
 * @module @dotdo/business-as-code
 */

// Core types - explicit exports for discoverability
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

// Re-export everything
export * from './types'
