/**
 * @dotdo/business-as-code - Type definitions
 *
 * Business-as-Code primitives for modeling organizations, businesses,
 * companies, and workspaces with schema.org.ai integration.
 */

// KeyResult - Grounded in analytics
export interface KeyResult {
  metric: string
  target: number
  current: number
  source: string
}

// Objective - A string description of what to achieve
export type Objective = string

// Goal - OKR structure
export interface Goal {
  objective: Objective
  keyResults: KeyResult[]
}

// Address for headquarters
export interface Address {
  address: string
  city: string
  country: string
}

// Base Organization
export interface Organization {
  $id: string
  $type: 'https://schema.org.ai/Organization'
  name: string
  parentOrganization?: string
}

// Business - Organization with Goals
export interface Business extends Omit<Organization, '$type'> {
  $type: 'https://schema.org.ai/Business'
  goals: Goal[]
}

// Company - Business with legal properties
export interface Company extends Omit<Business, '$type'> {
  $type: 'https://schema.org.ai/Company'
  legalName: string
  jurisdiction: string
  taxId?: string
  headquarters?: Address
  locations?: string[]
}

// Billing metadata for Org
export interface OrgBilling {
  stripeCustomerId?: string
  subscriptionId?: string
}

// Org - Tenant/workspace
export interface Org extends Omit<Organization, '$type' | 'parentOrganization'> {
  $type: 'https://schema.org.ai/Org'
  slug: string
  plan: 'free' | 'pro' | 'enterprise'
  members: string[]
  billing?: OrgBilling
}
