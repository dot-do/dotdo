import { z } from 'zod'

// ============================================================================
// EXPERIMENT - Branch-based A/B testing using git semantics
// ============================================================================

/**
 * Experiment status lifecycle
 * - draft: Not yet active, being configured
 * - running: Active and collecting data
 * - completed: Concluded with a winner determined
 */
export type ExperimentStatus = 'draft' | 'running' | 'completed'

/**
 * Experiment type for branch-based A/B testing
 *
 * Uses git semantics where branches ARE variants. This enables:
 * - Version control for experiment variants
 * - Easy rollback and deployment
 * - Natural branching workflow for experiments
 */
export interface Experiment {
  id: string
  thing: string // Thing id being experimented on (e.g., 'qualifyLead')
  branches: string[] // Branch variants (e.g., ['main', 'ai-experiment'])
  traffic: number // 0-1, percentage of users in experiment
  metric: string // Event pattern to measure (e.g., 'Sales.qualified')
  status: ExperimentStatus
  winner?: string // Winning branch when completed
  createdAt?: Date
  updatedAt?: Date
}

// ============================================================================
// ZOD SCHEMA - Runtime validation
// ============================================================================

/**
 * Zod schema for Experiment validation
 *
 * Validates:
 * - traffic is between 0 and 1
 * - status is one of the allowed values
 * - branches is a non-empty array (minimum 2 for valid experiments)
 * - thing and metric are non-empty strings
 */
export const ExperimentSchema = z.object({
  id: z.string().min(1),
  thing: z.string().min(1),
  branches: z.array(z.string()).min(2),
  traffic: z.number().min(0).max(1),
  metric: z.string().min(1),
  status: z.enum(['draft', 'running', 'completed']),
  winner: z.string().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
})

// Inferred type from schema (can be used for type-safe parsing)
export type ExperimentInput = z.infer<typeof ExperimentSchema>

// ============================================================================
// RUNTIME EXPORT - For dynamic imports and type checking
// ============================================================================

/**
 * Runtime Experiment type marker
 * Used for dynamic imports and runtime type identification
 */
export const Experiment = ExperimentSchema
