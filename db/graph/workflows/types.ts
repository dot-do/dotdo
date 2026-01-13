/**
 * Workflow Graph Types
 *
 * Type definitions for Workflows as Things in the Graph model with state tracking via verb forms.
 *
 * Key concepts:
 * 1. **Workflow Templates**: Define workflow structure as a Thing
 * 2. **Workflow Instances**: Running instances with state
 * 3. **Verb Forms**: Use verb conjugations for state (started, running, completed, failed)
 * 4. **Step Relationships**: CONTAINS, FOLLOWS, BRANCHES_TO
 *
 * @see dotdo-ywyc4 - Workflows as Graph Things
 * @module db/graph/workflows/types
 */

import type { GraphThing, GraphRelationship } from '../types'

// ============================================================================
// TYPE CONSTANTS
// ============================================================================

/**
 * Type ID for WorkflowTemplate Things
 */
export const WORKFLOW_TEMPLATE_TYPE_ID = 110

/**
 * Type name for WorkflowTemplate Things
 */
export const WORKFLOW_TEMPLATE_TYPE_NAME = 'WorkflowTemplate'

/**
 * Type ID for WorkflowInstance Things
 */
export const WORKFLOW_INSTANCE_TYPE_ID = 111

/**
 * Type name for WorkflowInstance Things
 */
export const WORKFLOW_INSTANCE_TYPE_NAME = 'WorkflowInstance'

/**
 * Type ID for WorkflowStep Things
 */
export const WORKFLOW_STEP_TYPE_ID = 112

/**
 * Type name for WorkflowStep Things
 */
export const WORKFLOW_STEP_TYPE_NAME = 'WorkflowStep'

/**
 * Type ID for StepResult Things
 */
export const STEP_RESULT_TYPE_ID = 113

/**
 * Type name for StepResult Things
 */
export const STEP_RESULT_TYPE_NAME = 'StepResult'

// ============================================================================
// RELATIONSHIP VERBS
// ============================================================================

/**
 * Relationship verbs used in workflow graph
 */
export const WORKFLOW_VERBS = {
  // Template structure
  CONTAINS: 'contains', // Template contains Step definitions
  FOLLOWS: 'follows', // Step follows another step in sequence
  BRANCHES_TO: 'branchesTo', // Step conditionally branches to another step

  // Instance relationships
  INSTANCE_OF: 'instanceOf', // Instance is based on Template
  TRIGGERED_BY: 'triggeredBy', // Instance triggered by event/schedule/human

  // Step execution (verb forms)
  EXECUTE: 'execute', // Action: intent to execute (pending)
  EXECUTING: 'executing', // Activity: currently running
  EXECUTED: 'executed', // Event: completed successfully

  // Skip lifecycle
  SKIP: 'skip', // Action: intent to skip
  SKIPPING: 'skipping', // Activity: being skipped
  SKIPPED: 'skipped', // Event: was skipped

  // Instance state lifecycle
  START: 'start', // Action: intent to start (pending)
  STARTING: 'starting', // Activity: starting up (running)
  STARTED: 'started', // Event: fully started (completed)

  // Pause/Resume
  PAUSE: 'pause', // Action: intent to pause
  PAUSING: 'pausing', // Activity: pausing
  PAUSED: 'paused', // Event: paused

  RESUME: 'resume', // Action: intent to resume
  RESUMING: 'resuming', // Activity: resuming
  RESUMED: 'resumed', // Event: resumed (transitions to running)

  // Completion
  COMPLETE: 'complete', // Action: intent to complete
  COMPLETING: 'completing', // Activity: completing
  COMPLETED: 'completed', // Event: completed successfully

  // Failure
  FAIL: 'fail', // Action: intent to fail
  FAILING: 'failing', // Activity: failing
  FAILED: 'failed', // Event: failed

  // Cancel
  CANCEL: 'cancel', // Action: intent to cancel
  CANCELLING: 'cancelling', // Activity: cancelling
  CANCELLED: 'cancelled', // Event: cancelled
} as const

// ============================================================================
// WORKFLOW TEMPLATE TYPES
// ============================================================================

/**
 * Step type in a workflow template
 */
export type WorkflowStepType = 'action' | 'decision' | 'parallel' | 'wait' | 'human' | 'subprocess'

/**
 * Step definition data stored in WorkflowStep Thing
 */
export interface WorkflowStepData {
  /** Step name (unique within workflow) */
  name: string
  /** Step type */
  type: WorkflowStepType
  /** Step description */
  description?: string
  /** Step index in linear execution order */
  index: number
  /** Configuration for the step */
  config?: {
    /** Timeout in milliseconds */
    timeout?: number
    /** Number of retries */
    retries?: number
    /** Retry delay in milliseconds */
    retryDelay?: number
    /** Event to wait for (for 'wait' type) */
    eventName?: string
    /** Human role for approval (for 'human' type) */
    humanRole?: string
    /** SLA for human approval */
    sla?: string
    /** Condition expression (for 'decision' type) */
    condition?: string
    /** Branches for decision step */
    branches?: Array<{ condition: string; targetStep: string }>
  }
  /** Handler function reference */
  handler?: string
  /** Metadata */
  metadata?: Record<string, unknown>
}

/**
 * Trigger definition for workflow
 */
export interface WorkflowTriggerData {
  /** Trigger type */
  type: 'event' | 'schedule' | 'webhook' | 'manual'
  /** Trigger configuration */
  config: {
    /** Event name for event triggers */
    eventName?: string
    /** Cron expression for schedule triggers */
    cronExpression?: string
    /** Timezone for schedule */
    timezone?: string
    /** Webhook path */
    webhookPath?: string
  }
}

/**
 * Workflow template data stored in WorkflowTemplate Thing
 */
export interface WorkflowTemplateData {
  /** Workflow name */
  name: string
  /** Workflow description */
  description?: string
  /** Version string (semver) */
  version: string
  /** Tags for categorization */
  tags?: string[]
  /** Triggers that can start this workflow */
  triggers?: WorkflowTriggerData[]
  /** Default timeout for the entire workflow */
  timeout?: number
  /** Metadata */
  metadata?: Record<string, unknown>
}

/**
 * WorkflowTemplate Thing - represents a workflow definition
 */
export interface WorkflowTemplateThing extends Omit<GraphThing, 'data'> {
  typeId: typeof WORKFLOW_TEMPLATE_TYPE_ID
  typeName: typeof WORKFLOW_TEMPLATE_TYPE_NAME
  data: WorkflowTemplateData | null
}

/**
 * WorkflowStep Thing - represents a step in a workflow template
 */
export interface WorkflowStepThing extends Omit<GraphThing, 'data'> {
  typeId: typeof WORKFLOW_STEP_TYPE_ID
  typeName: typeof WORKFLOW_STEP_TYPE_NAME
  data: WorkflowStepData | null
}

// ============================================================================
// WORKFLOW INSTANCE TYPES
// ============================================================================

/**
 * Semantic instance states derived from verb forms
 */
export type InstanceState = 'pending' | 'running' | 'completed' | 'paused' | 'failed' | 'cancelled'

/**
 * Workflow instance data
 */
export interface WorkflowInstanceData {
  /** Reference to the workflow template ID */
  templateId: string
  /** State encoded as verb form */
  stateVerb: string
  /** Input data provided when creating the instance */
  input: Record<string, unknown>
  /** Output data set when completing the instance */
  output?: Record<string, unknown>
  /** Error message if the instance failed */
  error?: string
  /** Current step index */
  currentStepIndex?: number
  /** Current step name */
  currentStepName?: string
  /** Started timestamp */
  startedAt?: number
  /** Completed/failed timestamp */
  endedAt?: number
  /** Metadata */
  metadata?: Record<string, unknown>
}

/**
 * WorkflowInstance Thing - represents a running workflow
 */
export interface WorkflowInstanceThing extends Omit<GraphThing, 'data'> {
  typeId: typeof WORKFLOW_INSTANCE_TYPE_ID
  typeName: typeof WORKFLOW_INSTANCE_TYPE_NAME
  data: WorkflowInstanceData | null
}

// ============================================================================
// STEP EXECUTION TYPES
// ============================================================================

/**
 * Step execution states derived from verb forms
 */
export type StepExecutionState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/**
 * Step execution relationship data
 */
export interface StepExecutionData {
  /** Name of the step being executed */
  stepName: string
  /** Index of the step in the workflow */
  stepIndex: number
  /** Timestamp when step started */
  startedAt?: number
  /** Timestamp when step completed */
  completedAt?: number
  /** Duration in milliseconds */
  duration?: number
  /** Error message for failed steps */
  error?: string
  /** Input to the step */
  input?: Record<string, unknown>
}

/**
 * Step execution relationship
 */
export interface StepExecutionRelationship extends GraphRelationship {
  verb: 'execute' | 'executing' | 'executed' | 'skip' | 'skipping' | 'skipped'
  data: StepExecutionData | null
}

/**
 * Step result data
 */
export interface StepResultData {
  /** Step name this result belongs to */
  stepName: string
  /** The output data from the step */
  output: Record<string, unknown>
  /** Timestamp when result was created */
  createdAt: number
}

/**
 * StepResult Thing - represents the output of a step execution
 */
export interface StepResultThing extends Omit<GraphThing, 'data'> {
  typeId: typeof STEP_RESULT_TYPE_ID
  typeName: typeof STEP_RESULT_TYPE_NAME
  data: StepResultData | null
}

// ============================================================================
// INPUT TYPES
// ============================================================================

/**
 * Input for creating a WorkflowTemplate
 */
export interface CreateWorkflowTemplateInput {
  /** Optional custom ID (auto-generated if not provided) */
  id?: string
  /** Template data */
  name: string
  description?: string
  version: string
  tags?: string[]
  triggers?: WorkflowTriggerData[]
  timeout?: number
  metadata?: Record<string, unknown>
}

/**
 * Input for creating a WorkflowStep
 */
export interface CreateWorkflowStepInput {
  /** Optional custom ID (auto-generated if not provided) */
  id?: string
  /** The template this step belongs to */
  templateId: string
  /** Step data */
  name: string
  type: WorkflowStepType
  description?: string
  index: number
  config?: WorkflowStepData['config']
  handler?: string
  metadata?: Record<string, unknown>
}

/**
 * Input for creating a WorkflowInstance
 */
export interface CreateWorkflowInstanceInput {
  /** Optional custom ID (auto-generated if not provided) */
  id?: string
  /** The template ID this instance is based on */
  templateId: string
  /** Input data for the workflow */
  input: Record<string, unknown>
  /** Metadata */
  metadata?: Record<string, unknown>
}

/**
 * Input for creating a step execution
 */
export interface CreateStepExecutionInput {
  /** Workflow instance ID */
  instanceId: string
  /** Step Thing ID */
  stepId: string
  /** Step name */
  stepName: string
  /** Step index */
  stepIndex: number
  /** Input to the step */
  input?: Record<string, unknown>
}

/**
 * Input for completing a step execution
 */
export interface CompleteStepExecutionInput {
  /** Result Thing URL */
  resultTo: string
  /** Duration in milliseconds */
  duration: number
}

/**
 * Input for failing a step execution
 */
export interface FailStepExecutionInput {
  /** Error that caused the failure */
  error: Error
  /** Duration in milliseconds */
  duration: number
}

// ============================================================================
// QUERY OPTIONS
// ============================================================================

/**
 * Options for querying workflow templates
 */
export interface QueryWorkflowTemplatesOptions {
  /** Filter by tag */
  tag?: string
  /** Limit results */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** Include deleted templates */
  includeDeleted?: boolean
}

/**
 * Options for querying workflow instances
 */
export interface QueryWorkflowInstancesOptions {
  /** Filter by template ID */
  templateId?: string
  /** Filter by state */
  state?: InstanceState
  /** Limit results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

/**
 * Options for querying step executions
 */
export interface QueryStepExecutionsOptions {
  /** Filter by instance ID */
  instanceId?: string
  /** Filter by step name */
  stepName?: string
  /** Filter by state */
  state?: StepExecutionState
  /** Limit results */
  limit?: number
}
