/**
 * @packageDocumentation
 * @module @dotdo/business-as-code
 *
 * Business entity types for schema.org.ai
 *
 * This package provides business entity types with OKR support:
 * - {@link Organization} - Base organizational entity
 * - {@link Business} - Organization with goals
 * - {@link Company} - Business with corporate details
 * - {@link Goal} - OKR-style objectives
 * - {@link KeyResult} - Measurable outcomes grounded in analytics
 * - {@link Org} - Multi-tenant workspace organization
 *
 * @example
 * ```typescript
 * import { createBusiness, isBusiness, GoalSchema } from '@dotdo/business-as-code'
 *
 * const business = createBusiness({
 *   $id: 'https://schema.org.ai/businesses/startup',
 *   name: 'My Startup'
 * })
 *
 * // business.goals === []
 * // business.$type === 'https://schema.org.ai/Business'
 * ```
 */

import { z } from 'zod'

/**
 * KeyResult - A measurable outcome for tracking goal progress
 *
 * Key Results are grounded in real analytics sources, providing
 * objective measurement of progress toward objectives. Each KeyResult
 * connects to an external data source for automated tracking.
 *
 * @see https://schema.org.ai/KeyResult
 *
 * @example
 * ```typescript
 * const kr: KeyResult = {
 *   metric: 'MRR',
 *   target: 50000,
 *   current: 32000,
 *   source: 'stripe.mrr',
 *   unit: 'USD'
 * }
 *
 * // Progress: 32000/50000 = 64%
 * const progress = kr.current / kr.target
 * ```
 */
export interface KeyResult {
  /** The metric being measured (e.g., "MRR", "DAU", "NPS") */
  metric: string
  /** Target value to achieve */
  target: number
  /** Current value of the metric */
  current: number
  /** Data source for the metric (e.g., "stripe.mrr", "analytics.do/dau") */
  source: string
  /** Unit of measurement (e.g., "USD", "%", "users") */
  unit?: string
}

/**
 * Zod schema for validating KeyResult objects
 *
 * @example
 * ```typescript
 * const result = KeyResultSchema.safeParse({
 *   metric: 'MRR',
 *   target: 50000,
 *   current: 32000,
 *   source: 'stripe.mrr'
 * })
 * if (result.success) {
 *   console.log('Valid KeyResult:', result.data)
 * }
 * ```
 */
export const KeyResultSchema = z.object({
  metric: z.string(),
  target: z.number(),
  current: z.number(),
  source: z.string(),
  unit: z.string().optional()
})

/**
 * Type guard to check if an object is a valid KeyResult
 *
 * @param obj - Object to validate
 * @returns True if the object conforms to the KeyResult interface
 *
 * @example
 * ```typescript
 * const data = await fetchMetrics()
 * if (isKeyResult(data)) {
 *   console.log(`Progress: ${data.current}/${data.target}`)
 * }
 * ```
 */
export function isKeyResult(obj: unknown): obj is KeyResult {
  return KeyResultSchema.safeParse(obj).success
}

/**
 * Objective - A string description of what to achieve
 *
 * The qualitative goal that key results measure progress toward.
 * Objectives should be inspirational, memorable, and ambitious.
 *
 * @see https://schema.org.ai/Objective
 *
 * @example
 * ```typescript
 * const objective: Objective = 'Achieve product-market fit'
 * ```
 */
export type Objective = string

/**
 * Goal - An objective with measurable key results (OKR)
 *
 * Goals use the OKR (Objectives and Key Results) framework
 * with analytics grounding for objective measurement. Each goal
 * combines a qualitative objective with quantitative key results.
 *
 * @see https://schema.org.ai/Goal
 *
 * @example
 * ```typescript
 * const goal: Goal = {
 *   objective: 'Achieve product-market fit',
 *   keyResults: [
 *     { metric: 'MRR', target: 50000, current: 32000, source: 'stripe.mrr', unit: 'USD' },
 *     { metric: 'NPS', target: 50, current: 42, source: 'surveys.nps' },
 *     { metric: 'Churn', target: 2, current: 3.5, source: 'analytics.churn', unit: '%' }
 *   ],
 *   status: 'active',
 *   owner: 'ceo@startup.com',
 *   dueDate: '2024-Q4'
 * }
 *
 * // Calculate overall progress
 * const progress = goal.keyResults.reduce((sum, kr) =>
 *   sum + (kr.current / kr.target), 0) / goal.keyResults.length
 * ```
 */
export interface Goal {
  /** The qualitative objective to achieve */
  objective: Objective
  /** Measurable key results that indicate progress */
  keyResults: KeyResult[]
  /** Status of the goal */
  status?: 'draft' | 'active' | 'completed' | 'cancelled'
  /** Owner of the goal (email or user ID) */
  owner?: string
  /** Due date for the goal (ISO date or quarter like "2024-Q4") */
  dueDate?: string
}

/**
 * Zod schema for validating Goal objects
 *
 * @example
 * ```typescript
 * const result = GoalSchema.safeParse({
 *   objective: 'Launch v2.0',
 *   keyResults: [{ metric: 'Users', target: 1000, current: 0, source: 'analytics.users' }]
 * })
 * ```
 */
export const GoalSchema = z.object({
  objective: z.string(),
  keyResults: z.array(KeyResultSchema),
  status: z.enum(['draft', 'active', 'completed', 'cancelled']).optional(),
  owner: z.string().optional(),
  dueDate: z.string().optional()
})

/**
 * Type guard to check if an object is a valid Goal
 *
 * @param obj - Object to validate
 * @returns True if the object conforms to the Goal interface
 *
 * @example
 * ```typescript
 * if (isGoal(data)) {
 *   console.log(`Goal: ${data.objective}`)
 *   console.log(`Key Results: ${data.keyResults.length}`)
 * }
 * ```
 */
export function isGoal(obj: unknown): obj is Goal {
  return GoalSchema.safeParse(obj).success
}

/**
 * Address - Physical location for headquarters and offices
 *
 * Used to specify geographic locations for companies and organizations.
 *
 * @see https://schema.org.ai/Address
 *
 * @example
 * ```typescript
 * const hq: Address = {
 *   address: '123 Main Street',
 *   city: 'San Francisco',
 *   country: 'USA'
 * }
 * ```
 */
export interface Address {
  /** Street address including number and street name */
  address: string
  /** City name */
  city: string
  /** Country name or ISO code (e.g., "USA", "UK", "Germany") */
  country: string
}

/**
 * Organization - Base interface for organizational entities
 *
 * The foundational type for all organizational entities in the hierarchy.
 * Provides identity, naming, and parent-child relationships.
 *
 * Hierarchy: Organization -> Business -> Company
 *
 * @see https://schema.org.ai/Organization
 *
 * @example
 * ```typescript
 * const org: Organization = {
 *   $id: 'https://schema.org.ai/orgs/acme',
 *   $type: 'https://schema.org.ai/Organization',
 *   name: 'Acme Inc',
 *   description: 'Building the future of widgets'
 * }
 * ```
 */
export interface Organization {
  /** Unique identifier (URL-style) for the organization */
  $id: string
  /** Schema type identifier */
  $type: 'https://schema.org.ai/Organization'
  /** Display name of the organization */
  name: string
  /** Optional description of the organization */
  description?: string
  /** Optional parent organization ID for hierarchy */
  parentOrganization?: string
}

/**
 * Zod schema for validating Organization objects
 *
 * @example
 * ```typescript
 * const result = OrganizationSchema.safeParse({
 *   $id: 'https://schema.org.ai/orgs/acme',
 *   $type: 'https://schema.org.ai/Organization',
 *   name: 'Acme Inc'
 * })
 * ```
 */
export const OrganizationSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Organization'),
  name: z.string(),
  description: z.string().optional()
})

/**
 * Type guard to check if an object is a valid Organization
 *
 * @param obj - Object to validate
 * @returns True if the object conforms to the Organization interface
 *
 * @example
 * ```typescript
 * if (isOrganization(entity)) {
 *   console.log(`Organization: ${entity.name}`)
 * }
 * ```
 */
export function isOrganization(obj: unknown): obj is Organization {
  return OrganizationSchema.safeParse(obj).success
}

/**
 * Business - An organization with goals
 *
 * Businesses have OKR-style goals that are grounded in real analytics.
 * Extends Organization with goal-tracking capabilities for businesses
 * that need strategic planning and measurement.
 *
 * Hierarchy: Organization -> Business -> Company
 *
 * @see https://schema.org.ai/Business
 *
 * @example
 * ```typescript
 * const business = createBusiness({
 *   $id: 'https://schema.org.ai/businesses/acme',
 *   name: 'Acme Inc'
 * })
 * // business.goals === []
 * // business.$type === 'https://schema.org.ai/Business'
 *
 * // Add goals
 * business.goals.push({
 *   objective: 'Achieve product-market fit',
 *   keyResults: [
 *     { metric: 'MRR', target: 50000, current: 32000, source: 'stripe.mrr' }
 *   ],
 *   status: 'active'
 * })
 * ```
 */
export interface Business extends Omit<Organization, '$type'> {
  /** Schema type identifier */
  $type: 'https://schema.org.ai/Business'
  /** Business goals with objectives and key results (OKRs) */
  goals: Goal[]
  /** Industry the business operates in (e.g., "SaaS", "FinTech") */
  industry?: string
}

/**
 * Zod schema for validating Business objects
 *
 * @example
 * ```typescript
 * const result = BusinessSchema.safeParse({
 *   $id: 'https://schema.org.ai/businesses/startup',
 *   $type: 'https://schema.org.ai/Business',
 *   name: 'My Startup',
 *   goals: []
 * })
 * ```
 */
export const BusinessSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Business'),
  name: z.string(),
  description: z.string().optional(),
  goals: z.array(GoalSchema),
  industry: z.string().optional()
})

/**
 * Type guard to check if an object is a valid Business
 *
 * @param obj - Object to validate
 * @returns True if the object conforms to the Business interface
 *
 * @example
 * ```typescript
 * const entities = await fetchEntities()
 * const businesses = entities.filter(isBusiness)
 * ```
 */
export function isBusiness(obj: unknown): obj is Business {
  return BusinessSchema.safeParse(obj).success
}

/**
 * Factory function to create a new Business with default values
 *
 * Creates a Business with the correct $type and an empty goals array.
 * Use this instead of manually constructing Business objects.
 *
 * @param input - Business configuration
 * @param input.$id - Unique identifier for the business
 * @param input.name - Display name of the business
 * @param input.description - Optional description
 * @param input.industry - Optional industry classification
 * @returns A new Business object with $type and empty goals
 *
 * @example
 * ```typescript
 * const business = createBusiness({
 *   $id: 'https://schema.org.ai/businesses/startup',
 *   name: 'My Startup',
 *   industry: 'SaaS'
 * })
 *
 * console.log(business.$type)  // 'https://schema.org.ai/Business'
 * console.log(business.goals)  // []
 * ```
 */
export function createBusiness(input: { $id: string; name: string; description?: string; industry?: string }): Business {
  return {
    ...input,
    $type: 'https://schema.org.ai/Business',
    goals: []
  }
}

/**
 * Company - A business with additional corporate details
 *
 * Extends Business with legal and compliance properties
 * for incorporated entities. Includes financial metrics,
 * legal registration details, and physical locations.
 *
 * Hierarchy: Organization -> Business -> Company
 *
 * @see https://schema.org.ai/Company
 *
 * @example
 * ```typescript
 * const company: Company = {
 *   $id: 'https://schema.org.ai/companies/acme',
 *   $type: 'https://schema.org.ai/Company',
 *   name: 'Acme Corporation',
 *   goals: [],
 *   foundedAt: '2020-01-15',
 *   employees: 150,
 *   revenue: 5000000,
 *   legalName: 'Acme Corporation, Inc.',
 *   jurisdiction: 'Delaware',
 *   headquarters: {
 *     address: '123 Main Street',
 *     city: 'San Francisco',
 *     country: 'USA'
 *   }
 * }
 * ```
 */
export interface Company extends Omit<Business, '$type'> {
  /** Schema type identifier */
  $type: 'https://schema.org.ai/Company'
  /** Date the company was founded (ISO date string) */
  foundedAt?: string
  /** Number of employees */
  employees?: number
  /** Annual revenue in base currency units */
  revenue?: number
  /** Official registered legal name */
  legalName?: string
  /** Legal jurisdiction (e.g., "Delaware", "UK", "Germany") */
  jurisdiction?: string
  /** Tax identification number (EIN, VAT, etc.) */
  taxId?: string
  /** Primary business address / headquarters */
  headquarters?: Address
  /** Additional office locations (as location identifiers) */
  locations?: string[]
}

/**
 * Zod schema for validating Company objects
 *
 * @example
 * ```typescript
 * const result = CompanySchema.safeParse({
 *   $id: 'https://schema.org.ai/companies/acme',
 *   $type: 'https://schema.org.ai/Company',
 *   name: 'Acme Corp',
 *   goals: [],
 *   employees: 50
 * })
 * ```
 */
export const CompanySchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Company'),
  name: z.string(),
  description: z.string().optional(),
  goals: z.array(GoalSchema),
  industry: z.string().optional(),
  foundedAt: z.string().optional(),
  employees: z.number().optional(),
  revenue: z.number().optional()
})

/**
 * Type guard to check if an object is a valid Company
 *
 * @param obj - Object to validate
 * @returns True if the object conforms to the Company interface
 *
 * @example
 * ```typescript
 * if (isCompany(entity)) {
 *   console.log(`${entity.name} has ${entity.employees} employees`)
 * }
 * ```
 */
export function isCompany(obj: unknown): obj is Company {
  return CompanySchema.safeParse(obj).success
}

/**
 * OrgBilling - Billing metadata for Org
 *
 * Stripe integration for subscription management.
 * Used to track customer and subscription IDs for payment processing.
 *
 * @see https://schema.org.ai/OrgBilling
 *
 * @example
 * ```typescript
 * const billing: OrgBilling = {
 *   stripeCustomerId: 'cus_abc123',
 *   subscriptionId: 'sub_xyz789'
 * }
 * ```
 */
export interface OrgBilling {
  /** Stripe customer ID (cus_xxx format) */
  stripeCustomerId?: string
  /** Active Stripe subscription ID (sub_xxx format) */
  subscriptionId?: string
}

/**
 * Org - Multi-tenant workspace organization
 *
 * Used for SaaS platforms to manage customer workspaces.
 * Includes subscription plans, membership, and billing integration.
 * This is distinct from the Organization hierarchy - Orgs are
 * workspaces/tenants rather than business entities.
 *
 * @see https://schema.org.ai/Org
 *
 * @example
 * ```typescript
 * const workspace: Org = {
 *   $id: 'https://schema.org.ai/orgs/acme-workspace',
 *   $type: 'https://schema.org.ai/Org',
 *   name: 'Acme Workspace',
 *   slug: 'acme',
 *   plan: 'pro',
 *   members: ['user_001', 'user_002', 'user_003'],
 *   billing: {
 *     stripeCustomerId: 'cus_abc123',
 *     subscriptionId: 'sub_xyz789'
 *   }
 * }
 * ```
 */
export interface Org extends Omit<Organization, '$type' | 'parentOrganization'> {
  /** Schema type identifier */
  $type: 'https://schema.org.ai/Org'
  /** URL-safe identifier for the workspace (e.g., "acme" for acme.app.com) */
  slug: string
  /** Subscription plan level */
  plan: 'free' | 'pro' | 'enterprise'
  /** User IDs of workspace members */
  members: string[]
  /** Billing configuration (Stripe integration) */
  billing?: OrgBilling
}
