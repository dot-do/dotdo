import { z } from 'zod'

// ============================================================================
// FLAG - Feature flag with branch-based variants and targeting
// ============================================================================

/**
 * Branch represents a variant in the feature flag
 * Each branch has a weight for traffic distribution and optional payload
 */
export interface Branch {
  key: string
  weight: number
  payload?: Record<string, any>
}

/**
 * Filter for targeting users based on properties or cohort membership
 */
export interface Filter {
  type: 'property' | 'cohort'
  property?: string
  operator?: 'eq' | 'gt' | 'lt' | 'contains' | 'in'
  value?: any
  cohortId?: string
}

/**
 * Stickiness determines how users are assigned to branches
 * - user_id: Consistent per user across sessions
 * - session_id: Consistent within a session
 * - random: Random assignment on each evaluation
 */
export type Stickiness = 'user_id' | 'session_id' | 'random'

/**
 * Flag status
 * - active: Flag is actively being evaluated
 * - disabled: Flag is disabled, returns default behavior
 */
export type FlagStatus = 'active' | 'disabled'

/**
 * Feature Flag for A/B testing and gradual rollouts
 *
 * Features:
 * - Branch-based variants with weighted traffic distribution
 * - Traffic control (0-1) for gradual rollouts
 * - Sticky assignment for consistent user experience
 * - Targeting filters for property or cohort-based targeting
 */
export interface Flag {
  id: string
  key: string
  branches: Branch[]
  traffic: number // 0-1
  stickiness: Stickiness
  status: FlagStatus
  filters?: Filter[]
}

// ============================================================================
// ZOD SCHEMAS - Runtime validation
// ============================================================================

/**
 * Zod schema for Branch validation
 */
export const BranchSchema = z.object({
  key: z.string(),
  weight: z.number(),
  payload: z.record(z.string(), z.unknown()).optional(),
}).strict()

/**
 * Zod schema for Filter validation
 */
export const FilterSchema = z.object({
  type: z.enum(['property', 'cohort']),
  property: z.string().optional(),
  operator: z.enum(['eq', 'gt', 'lt', 'contains', 'in']).optional(),
  value: z.unknown().optional(),
  cohortId: z.string().optional(),
}).strict()

/**
 * Zod schema for Flag validation
 *
 * Validates:
 * - id and key are strings
 * - branches is a non-empty array
 * - traffic is between 0 and 1
 * - stickiness is one of: user_id, session_id, random
 * - status is one of: active, disabled
 * - filters is an optional array of Filter objects
 */
export const FlagSchema = z.object({
  id: z.string(),
  key: z.string(),
  branches: z.array(BranchSchema).min(1),
  traffic: z.number().min(0).max(1),
  stickiness: z.enum(['user_id', 'session_id', 'random']),
  status: z.enum(['active', 'disabled']),
  filters: z.array(FilterSchema).optional(),
}).strict()

// Inferred types from schemas
export type FlagInput = z.infer<typeof FlagSchema>
export type BranchInput = z.infer<typeof BranchSchema>
export type FilterInput = z.infer<typeof FilterSchema>

// ============================================================================
// VALIDATION FUNCTION
// ============================================================================

/**
 * Validates a flag object against the FlagSchema
 *
 * @param flag - The flag object to validate
 * @returns true if valid
 * @throws ZodError if validation fails
 */
export function validateFlag(flag: unknown): boolean {
  FlagSchema.parse(flag)
  return true
}
