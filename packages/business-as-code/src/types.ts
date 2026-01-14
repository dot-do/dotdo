/**
 * @dotdo/business-as-code - Type definitions
 *
 * Business-as-Code primitives for modeling organizations, businesses,
 * companies, and workspaces with schema.org.ai integration.
 */

/**
 * KeyResult - Analytics-grounded metric for OKRs
 *
 * Represents a measurable outcome tied to an objective.
 * Each key result is grounded in real analytics data.
 *
 * @see https://schema.org.ai/KeyResult
 */
export interface KeyResult {
  /** The metric being measured (e.g., "Monthly Active Users") */
  metric: string
  /** Target value to achieve */
  target: number
  /** Current value of the metric */
  current: number
  /** Data source for the metric (e.g., "analytics.do", "stripe") */
  source: string
}

/**
 * Objective - A string description of what to achieve
 *
 * The qualitative goal that key results measure progress toward.
 *
 * @see https://schema.org.ai/Objective
 */
export type Objective = string

/**
 * Goal - Objective and Key Results (OKR) structure
 *
 * Combines a qualitative objective with quantitative key results
 * to create measurable goals for organizations.
 *
 * @see https://schema.org.ai/Goal
 */
export interface Goal {
  /** The qualitative objective to achieve */
  objective: Objective
  /** Measurable key results that indicate progress */
  keyResults: KeyResult[]
}

/**
 * Address - Physical location for headquarters and offices
 *
 * @see https://schema.org.ai/Address
 */
export interface Address {
  /** Street address */
  address: string
  /** City name */
  city: string
  /** Country name or ISO code */
  country: string
}

/**
 * Organization - Base interface for organizations
 *
 * The foundational type for all organizational entities.
 * Provides identity and hierarchy capabilities.
 *
 * @see https://schema.org.ai/Organization
 */
export interface Organization {
  /** Unique identifier for the organization */
  $id: string
  /** Schema type identifier */
  $type: 'https://schema.org.ai/Organization'
  /** Display name of the organization */
  name: string
  /** Optional parent organization ID for hierarchy */
  parentOrganization?: string
}

/**
 * Business - Organization with Goals/OKRs
 *
 * Extends Organization with goal-tracking capabilities
 * for businesses that need OKR management.
 *
 * @see https://schema.org.ai/Business
 */
export interface Business extends Omit<Organization, '$type'> {
  /** Schema type identifier */
  $type: 'https://schema.org.ai/Business'
  /** Business goals with objectives and key results */
  goals: Goal[]
}

/**
 * Company - Legal business entity
 *
 * Extends Business with legal and compliance properties
 * for incorporated entities.
 *
 * @see https://schema.org.ai/Company
 */
export interface Company extends Omit<Business, '$type'> {
  /** Schema type identifier */
  $type: 'https://schema.org.ai/Company'
  /** Official registered legal name */
  legalName: string
  /** Legal jurisdiction (e.g., "Delaware", "UK") */
  jurisdiction: string
  /** Tax identification number */
  taxId?: string
  /** Primary business address */
  headquarters?: Address
  /** Additional office locations */
  locations?: string[]
}

/**
 * OrgBilling - Billing metadata for Org
 *
 * Stripe integration for subscription management.
 *
 * @see https://schema.org.ai/OrgBilling
 */
export interface OrgBilling {
  /** Stripe customer ID */
  stripeCustomerId?: string
  /** Active subscription ID */
  subscriptionId?: string
}

/**
 * Org - Tenant/workspace organization
 *
 * Multi-tenant workspace with billing and membership.
 * Used for SaaS platforms to manage customer workspaces.
 *
 * @see https://schema.org.ai/Org
 */
export interface Org extends Omit<Organization, '$type' | 'parentOrganization'> {
  /** Schema type identifier */
  $type: 'https://schema.org.ai/Org'
  /** URL-safe identifier for the workspace */
  slug: string
  /** Subscription plan level */
  plan: 'free' | 'pro' | 'enterprise'
  /** User IDs of workspace members */
  members: string[]
  /** Billing configuration */
  billing?: OrgBilling
}
