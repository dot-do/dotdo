import { z } from 'zod'
import { defineNoun } from '../types'
import { TimePeriodSchema } from './Business'

/**
 * Goal category (aligned with Balanced Scorecard perspectives)
 */
export const GoalCategorySchema = z.enum([
  'strategic',
  'operational',
  'financial',
  'customer',
  'internal',
  'learning',
  'growth',
])
export type GoalCategory = z.infer<typeof GoalCategorySchema>

/**
 * Goal status
 */
export const GoalStatusSchema = z.enum([
  'not-started',
  'in-progress',
  'on-track',
  'at-risk',
  'behind',
  'completed',
  'cancelled',
])
export type GoalStatus = z.infer<typeof GoalStatusSchema>

/**
 * Key Result schema (OKR pattern)
 */
export const KeyResultSchema = z.object({
  description: z.string(),
  metric: z.string(),
  startValue: z.number().optional(),
  targetValue: z.number(),
  currentValue: z.number().optional(),
  unit: z.string().optional(),
  progress: z.number().optional(),
  confidence: z.number().optional(),
  owner: z.string().optional(),
  notes: z.string().optional(),
})
export type KeyResult = z.infer<typeof KeyResultSchema>

/**
 * KPI definition schema
 */
export const KPIDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  category: z.enum(['financial', 'customer', 'operations', 'people', 'growth']).optional(),
  unit: z.string().optional(),
  target: z.number().optional(),
  current: z.number().optional(),
  frequency: TimePeriodSchema.optional(),
  dataSource: z.string().optional(),
  formula: z.string().optional(),
  trend: z.enum(['up', 'down', 'stable']).optional(),
  isGood: z.enum(['higher', 'lower', 'target']).optional(),
})
export type KPIDefinition = z.infer<typeof KPIDefinitionSchema>

/**
 * Milestone schema
 */
export const MilestoneSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  targetDate: z.coerce.date().optional(),
  completedDate: z.coerce.date().optional(),
  status: z.enum(['pending', 'completed', 'missed', 'cancelled']).optional(),
  dependencies: z.array(z.string()).optional(),
})
export type Milestone = z.infer<typeof MilestoneSchema>

/**
 * Goal entity schema (OKR-style)
 */
export const GoalSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Goal'),
  name: z.string(),
  slug: z.string().optional(),
  description: z.string().optional(),

  // OKR fields
  objective: z.string().optional(),
  keyResults: z.array(KeyResultSchema).optional(),

  // Classification
  category: GoalCategorySchema.optional(),
  status: GoalStatusSchema.optional(),
  priority: z.number().min(1).max(5).optional(),

  // Progress
  progress: z.number().min(0).max(100).optional(),
  confidence: z.number().min(0).max(100).optional(),

  // Timeline
  period: z.string().optional(),
  startDate: z.coerce.date().optional(),
  targetDate: z.coerce.date().optional(),
  completedDate: z.coerce.date().optional(),

  // Ownership
  owner: z.string().optional(),
  team: z.string().optional(),
  contributors: z.array(z.string()).optional(),

  // Relationships
  parentGoal: z.string().optional(),
  childGoals: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  alignedTo: z.array(z.string()).optional(),

  // KPIs and Milestones
  kpis: z.array(KPIDefinitionSchema).optional(),
  milestones: z.array(MilestoneSchema).optional(),

  // Success metrics
  metrics: z.array(z.string()).optional(),
  successCriteria: z.string().optional(),

  // Notes and updates
  notes: z.string().optional(),
  lastUpdated: z.coerce.date().optional(),
  updateHistory: z.array(z.object({
    date: z.coerce.date(),
    progress: z.number().optional(),
    confidence: z.number().optional(),
    status: GoalStatusSchema.optional(),
    notes: z.string().optional(),
  })).optional(),

  metadata: z.record(z.unknown()).optional(),
})

export type GoalType = z.infer<typeof GoalSchema>

/**
 * Goal Noun - OKR/Goal tracking
 *
 * Represents a goal or OKR with key results, progress tracking,
 * ownership, and hierarchical relationships.
 */
export const Goal = defineNoun({
  noun: 'Goal',
  plural: 'Goals',
  $type: 'https://schema.org.ai/Goal',
  schema: GoalSchema,
  okrs: [
    'Progress', 'Confidence', 'OnTrack',
    'KeyResultsCompleted', 'MilestonesHit',
    'TimeRemaining', 'ProgressVelocity',
  ],
})

/**
 * OKR Noun - alias for Goal with OKR terminology
 */
export const OKR = defineNoun({
  noun: 'OKR',
  plural: 'OKRs',
  $type: 'https://schema.org.ai/OKR',
  schema: GoalSchema,
  okrs: [
    'Progress', 'Confidence', 'OnTrack',
    'KeyResultsCompleted', 'MilestonesHit',
    'TimeRemaining', 'ProgressVelocity',
  ],
})
