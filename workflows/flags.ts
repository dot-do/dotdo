/**
 * Feature Flag Evaluation with Filter Matching, Traffic Allocation, and Branch Assignment
 *
 * This module provides the evaluateFlag function that evaluates feature flags
 * with support for:
 * - Filter-based targeting (property and cohort filters)
 * - Deterministic traffic allocation using SHA-256 hashing
 * - Weighted branch assignment for A/B/n testing
 *
 * Filter types:
 * - property: Match user properties with operators (eq, neq, gt, lt, gte, lte, in, contains)
 * - cohort: Match user membership in cohorts
 *
 * Multiple filters use AND logic (all must match).
 *
 * @module workflows/flags
 */

import { hashToInt } from './hash'

// Type definitions for property filters
export interface PropertyFilter {
  type: 'property'
  property: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains'
  value: string | number | boolean | string[] | number[]
}

// Type definitions for cohort filters
export interface CohortFilter {
  type: 'cohort'
  cohortId: string
}

export type Filter = PropertyFilter | CohortFilter

// Branch definition for weighted variant assignment
export interface Branch {
  key: string
  weight: number
  payload?: Record<string, unknown>
}

// Legacy variant format (from traffic.test.ts)
export interface Variant {
  id: string
  weight: number
  payload?: unknown
}

// Flag configuration - supports multiple formats from different tests
export interface FlagConfig {
  id: string
  traffic: number
  filters?: Filter[]
  // Branch-based variants (branches.test.ts)
  branches?: Branch[]
  stickiness?: string
  status?: 'active' | 'inactive'
  // Simple variant format (traffic.test.ts)
  enabled?: boolean
  variants?: Variant[]
}

// Evaluation context
export interface EvaluationContext {
  userId?: string
  sessionId?: string
  properties?: Record<string, string | number | boolean | null>
  cohorts?: string[]
}

// Evaluation result
export interface EvaluationResult {
  enabled: boolean
  variant: string | null
  payload?: Record<string, unknown>
  reason?: string
}

/**
 * Maximum value for 32-bit hash (2^32 - 1)
 */
const MAX_HASH_VALUE = 0xffffffff

/**
 * Check if a single filter matches the context
 */
function matchFilter(filter: Filter, context: EvaluationContext): boolean {
  if (filter.type === 'cohort') {
    const cohorts = context.cohorts
    if (!cohorts || cohorts.length === 0) {
      return false
    }
    return cohorts.includes(filter.cohortId)
  }

  // Property filter
  const properties = context.properties
  if (!properties) {
    return false
  }

  const propValue = properties[filter.property]

  // Handle null/undefined as missing
  if (propValue === null || propValue === undefined) {
    return false
  }

  const filterValue = filter.value

  switch (filter.operator) {
    case 'eq':
      return propValue === filterValue

    case 'neq':
      return propValue !== filterValue

    case 'gt':
      if (typeof propValue !== 'number' || typeof filterValue !== 'number') {
        return false
      }
      return propValue > filterValue

    case 'gte':
      if (typeof propValue !== 'number' || typeof filterValue !== 'number') {
        return false
      }
      return propValue >= filterValue

    case 'lt':
      if (typeof propValue !== 'number' || typeof filterValue !== 'number') {
        return false
      }
      return propValue < filterValue

    case 'lte':
      if (typeof propValue !== 'number' || typeof filterValue !== 'number') {
        return false
      }
      return propValue <= filterValue

    case 'in':
      if (!Array.isArray(filterValue)) {
        return false
      }
      return (filterValue as Array<string | number>).includes(propValue as string | number)

    case 'contains':
      if (typeof propValue !== 'string' || typeof filterValue !== 'string') {
        return false
      }
      return propValue.includes(filterValue)

    default:
      return false
  }
}

/**
 * Check if all filters match the context (AND logic)
 */
function matchFilters(filters: Filter[] | undefined, context: EvaluationContext): boolean {
  if (!filters || filters.length === 0) {
    return true
  }
  return filters.every((filter) => matchFilter(filter, context))
}

/**
 * Get the stickiness value from context based on the stickiness field
 */
function getStickinessValue(context: EvaluationContext, stickiness?: string): string {
  if (stickiness === 'session_id') {
    return context.sessionId || context.userId || ''
  }
  // Default to userId
  return context.userId || ''
}

/**
 * Check if user is in traffic allocation using deterministic hash
 */
function isInTraffic(flagId: string, stickinessValue: string, traffic: number): boolean {
  if (traffic <= 0) {
    return false
  }
  if (traffic >= 1) {
    return true
  }

  const hashInput = `${stickinessValue}:${flagId}`
  const hashValue = hashToInt(hashInput)
  const normalizedHash = hashValue / MAX_HASH_VALUE

  return normalizedHash < traffic
}

/**
 * Assign user to a branch based on weighted distribution using deterministic hash
 */
function assignBranch(flagId: string, stickinessValue: string, branches: Branch[]): Branch | null {
  if (!branches || branches.length === 0) {
    return null
  }

  // Calculate total weight
  const totalWeight = branches.reduce((sum, branch) => sum + branch.weight, 0)
  if (totalWeight === 0) {
    return null
  }

  // Use a different hash input for branch assignment to get independent randomization
  const hashInput = `${stickinessValue}:${flagId}:branch`
  const hashValue = hashToInt(hashInput)
  const normalizedHash = hashValue / MAX_HASH_VALUE
  const targetValue = normalizedHash * totalWeight

  // Find the branch based on cumulative weights
  let cumulativeWeight = 0
  for (const branch of branches) {
    cumulativeWeight += branch.weight
    if (targetValue < cumulativeWeight) {
      return branch
    }
  }

  // Fallback to last branch (should not happen with proper weights)
  return branches[branches.length - 1]
}

/**
 * Evaluate a feature flag for a given context.
 *
 * Evaluation order:
 * 1. Check flag status (inactive = disabled)
 * 2. Apply filters (all must match using AND logic)
 * 3. Check traffic allocation using deterministic hash
 * 4. Assign to branch/variant using weighted distribution
 *
 * @param flag - The flag configuration
 * @param context - The evaluation context (user properties, cohorts, etc.)
 * @returns The evaluation result with enabled status, variant, and optional payload
 */
export function evaluateFlag(flag: FlagConfig, context: EvaluationContext): EvaluationResult {
  const stickinessValue = getStickinessValue(context, flag.stickiness)

  // Check if flag status is inactive (branches.test.ts format)
  if (flag.status === 'inactive') {
    return {
      enabled: false,
      variant: null,
    }
  }

  // Check if flag is explicitly disabled (traffic.test.ts format)
  if (flag.enabled === false) {
    return {
      enabled: false,
      variant: 'control',
    }
  }

  // Check filters (AND logic)
  if (!matchFilters(flag.filters, context)) {
    return {
      enabled: false,
      variant: 'control',
    }
  }

  // Check traffic allocation
  if (!isInTraffic(flag.id, stickinessValue, flag.traffic)) {
    // For branch-based flags, return null variant
    if (flag.branches) {
      return {
        enabled: false,
        variant: null,
      }
    }
    return {
      enabled: false,
      variant: 'control',
    }
  }

  // Handle branch-based variants (branches.test.ts format)
  if (flag.branches && flag.branches.length > 0) {
    const branch = assignBranch(flag.id, stickinessValue, flag.branches)
    if (branch) {
      return {
        enabled: true,
        variant: branch.key,
        payload: branch.payload,
      }
    }
    return {
      enabled: true,
      variant: null,
    }
  }

  // Simple flag without variants - enabled with treatment variant
  return {
    enabled: true,
    variant: 'treatment',
  }
}
