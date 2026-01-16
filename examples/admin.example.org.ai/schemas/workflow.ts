/**
 * Workflow Schema - Durable Execution Flows
 *
 * Workflows define multi-step processes with handlers, scheduling,
 * and cross-DO communication patterns.
 *
 * @module schemas/workflow
 */

import { z } from 'zod'
import { FunctionTypeSchema } from './function'

/**
 * Workflow step types
 */
export const StepTypeSchema = z.enum([
  'action',    // Execute an action
  'condition', // Branch based on condition
  'parallel',  // Run steps in parallel
  'loop',      // Iterate over items
  'wait',      // Wait for event or timeout
  'human',     // Human approval/input
])
export type StepType = z.infer<typeof StepTypeSchema>

/**
 * Workflow status
 */
export const WorkflowStatusSchema = z.enum([
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
])
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>

/**
 * Workflow step definition
 */
export const WorkflowStepSchema = z.object({
  /** Step identifier */
  id: z.string().min(1, 'step id is required'),
  /** Step type */
  type: StepTypeSchema,
  /** Human-readable name */
  name: z.string().optional(),
  /** Step description */
  description: z.string().optional(),

  /** Action/function to execute (for action steps) */
  action: z.string().optional(),
  /** Function type for action */
  method: FunctionTypeSchema.optional(),

  /** Condition expression (for condition steps) */
  condition: z.string().optional(),
  /** Steps to run if condition is true */
  then: z.array(z.lazy(() => WorkflowStepSchema)).optional(),
  /** Steps to run if condition is false */
  else: z.array(z.lazy(() => WorkflowStepSchema)).optional(),

  /** Steps to run in parallel */
  steps: z.array(z.lazy(() => WorkflowStepSchema)).optional(),

  /** Items to iterate over (for loop steps) */
  items: z.string().optional(),
  /** Step to execute for each item */
  each: z.lazy(() => WorkflowStepSchema).optional(),

  /** Event to wait for (for wait steps) */
  event: z.string().optional(),
  /** Timeout in ms */
  timeout: z.number().int().positive().optional(),

  /** Channel for human input */
  channel: z.string().optional(),
  /** Prompt for human */
  prompt: z.string().optional(),

  /** Input mapping */
  input: z.record(z.string(), z.unknown()).optional(),
  /** Output mapping */
  output: z.record(z.string(), z.unknown()).optional(),

  /** Retry configuration */
  retries: z.object({
    maxAttempts: z.number().int().positive(),
    delay: z.number().int().nonnegative(),
  }).optional(),
})

export type WorkflowStepType = z.infer<typeof WorkflowStepSchema>

/**
 * Schedule trigger schema (CRON-based)
 */
export const ScheduleSchema = z.object({
  /** CRON expression */
  cron: z.string().optional(),
  /** Human-readable schedule (e.g., 'every.Monday.at9am') */
  readable: z.string().optional(),
  /** Timezone */
  timezone: z.string().default('UTC'),
  /** Whether schedule is active */
  enabled: z.boolean().default(true),
})

export type ScheduleType = z.infer<typeof ScheduleSchema>

/**
 * Event trigger schema
 */
export const EventTriggerSchema = z.object({
  /** Event pattern (e.g., 'Customer.created', '*.updated') */
  pattern: z.string().min(1, 'pattern is required'),
  /** Filter conditions */
  filter: z.record(z.string(), z.unknown()).optional(),
})

export type EventTriggerType = z.infer<typeof EventTriggerSchema>

/**
 * WorkflowSchema - validates workflow definitions
 *
 * Workflows combine:
 * - Triggers: Events, schedules, or manual invocation
 * - Steps: Sequential or parallel actions with conditions
 * - State: Durable execution state for recovery
 */
export const WorkflowSchema = z.object({
  /** Unique workflow identifier */
  id: z.string().min(1, 'id is required'),
  /** Human-readable name */
  name: z.string().min(1, 'name is required'),
  /** Description */
  description: z.string().optional(),

  /** Version for schema evolution */
  version: z.string().default('1.0.0'),

  /** Event triggers ($.on.Customer.signup style) */
  triggers: z.array(EventTriggerSchema).optional(),
  /** Schedule triggers ($.every.Monday.at9am style) */
  schedules: z.array(ScheduleSchema).optional(),

  /** Workflow steps */
  steps: z.array(WorkflowStepSchema),

  /** Input schema */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  /** Output schema */
  outputSchema: z.record(z.string(), z.unknown()).optional(),

  /** Global timeout in ms */
  timeout: z.number().int().positive().optional(),

  /** Whether workflow is enabled */
  enabled: z.boolean().default(true),

  /** Metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type WorkflowSchemaType = z.infer<typeof WorkflowSchema>

/**
 * Workflow execution instance
 */
export const WorkflowExecutionSchema = z.object({
  /** Execution ID */
  id: z.string().min(1),
  /** Workflow ID */
  workflowId: z.string().min(1),
  /** Current status */
  status: WorkflowStatusSchema,
  /** Current step ID */
  currentStep: z.string().optional(),
  /** Input data */
  input: z.record(z.string(), z.unknown()).optional(),
  /** Output data */
  output: z.record(z.string(), z.unknown()).optional(),
  /** Error if failed */
  error: z.object({
    message: z.string(),
    step: z.string().optional(),
    stack: z.string().optional(),
  }).optional(),
  /** Started at */
  startedAt: z.date(),
  /** Completed at */
  completedAt: z.date().optional(),
})

export type WorkflowExecutionType = z.infer<typeof WorkflowExecutionSchema>
