/**
 * WorkflowOrchestrator Types
 *
 * Type definitions for the workflow orchestration system.
 */

// =============================================================================
// Execution Status
// =============================================================================

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

// =============================================================================
// Triggers
// =============================================================================

export type TriggerType = 'manual' | 'schedule' | 'event' | 'webhook'

export interface Trigger {
  type: TriggerType
  config?: TriggerConfig
}

export interface TriggerConfig {
  /** Cron expression for schedule triggers */
  cron?: string
  /** Event name for event triggers */
  eventName?: string
  /** Webhook path for webhook triggers */
  webhookPath?: string
}

// =============================================================================
// Workflow Context
// =============================================================================

export interface WorkflowContext<TInputs = Record<string, unknown>, TOutputs = Record<string, unknown>> {
  /** Workflow execution ID */
  executionId: string
  /** Workflow ID */
  workflowId: string
  /** Input data passed to workflow */
  inputs: TInputs
  /** Output data from completed steps */
  outputs: TOutputs
  /** Metadata about the execution */
  metadata: ExecutionMetadata
  /** Get output from a specific step */
  getStepOutput<T = unknown>(stepId: string): T | undefined
}

export interface ExecutionMetadata {
  /** When the workflow execution started */
  startedAt: Date
  /** Retry count for the current execution */
  retryCount: number
  /** Parent execution ID if this is a sub-workflow */
  parentExecutionId?: string
  /** Custom metadata */
  custom?: Record<string, unknown>
}

// =============================================================================
// Step Result
// =============================================================================

export interface StepResult<T = unknown> {
  /** Whether the step succeeded */
  success: boolean
  /** Output data from the step */
  output?: T
  /** Error if the step failed */
  error?: Error
  /** Duration in milliseconds */
  duration: number
}

// =============================================================================
// Compensation Handler
// =============================================================================

export type CompensationHandler<TContext = WorkflowContext> = (
  context: TContext,
  stepOutput: unknown
) => Promise<void>

// =============================================================================
// Workflow Step
// =============================================================================

export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number
  /** Base delay between retries in milliseconds */
  delayMs?: number
  /** Backoff multiplier (exponential backoff) */
  backoffMultiplier?: number
  /** Maximum delay between retries */
  maxDelayMs?: number
}

export type StepHandler<TInput = unknown, TOutput = unknown> = (
  context: WorkflowContext,
  input?: TInput
) => Promise<TOutput>

export type StepCondition = (context: WorkflowContext) => boolean | Promise<boolean>

export interface WorkflowStep<TInput = unknown, TOutput = unknown> {
  /** Unique step identifier */
  id: string
  /** Human-readable step name */
  name: string
  /** The handler function to execute */
  handler: StepHandler<TInput, TOutput>
  /** IDs of steps this step depends on */
  dependencies?: string[]
  /** Retry configuration */
  retry?: RetryConfig
  /** Timeout in milliseconds */
  timeout?: number
  /** Compensation handler for rollback */
  compensation?: CompensationHandler
  /** Condition to determine if step should run */
  condition?: StepCondition
  /** Input mapping from context/other steps */
  inputMapping?: (context: WorkflowContext) => TInput
}

// =============================================================================
// Step Execution State
// =============================================================================

export interface StepExecution {
  /** Step ID */
  stepId: string
  /** Current status */
  status: StepStatus
  /** Result of the step execution */
  result?: StepResult
  /** When the step started */
  startedAt?: Date
  /** When the step completed */
  completedAt?: Date
  /** Current retry attempt */
  attempt: number
}

// =============================================================================
// Workflow Definition
// =============================================================================

export interface Workflow<TInputs = Record<string, unknown>, TOutputs = Record<string, unknown>> {
  /** Unique workflow identifier */
  id: string
  /** Human-readable workflow name */
  name: string
  /** Workflow description */
  description?: string
  /** Steps in the workflow */
  steps: WorkflowStep[]
  /** Triggers for the workflow */
  triggers?: Trigger[]
  /** Default timeout for the entire workflow */
  timeout?: number
  /** Global retry configuration */
  retry?: RetryConfig
  /** Input schema validation (optional) */
  inputSchema?: Record<string, unknown>
  /** Output schema validation (optional) */
  outputSchema?: Record<string, unknown>
}

// =============================================================================
// Workflow Execution
// =============================================================================

export interface WorkflowExecution<TInputs = Record<string, unknown>, TOutputs = Record<string, unknown>> {
  /** Unique execution identifier */
  id: string
  /** Workflow ID being executed */
  workflowId: string
  /** Current execution status */
  status: ExecutionStatus
  /** Step execution states */
  steps: Map<string, StepExecution>
  /** Workflow inputs */
  inputs: TInputs
  /** Workflow outputs (populated on completion) */
  outputs?: TOutputs
  /** When the execution started */
  startedAt: Date
  /** When the execution completed */
  completedAt?: Date
  /** Error if execution failed */
  error?: Error
  /** Metadata */
  metadata: ExecutionMetadata
}

// =============================================================================
// Events
// =============================================================================

export type WorkflowEventType =
  | 'workflow:started'
  | 'workflow:completed'
  | 'workflow:failed'
  | 'workflow:cancelled'
  | 'workflow:paused'
  | 'workflow:resumed'
  | 'step:started'
  | 'step:completed'
  | 'step:failed'
  | 'step:retrying'
  | 'step:skipped'

export interface WorkflowEvent {
  type: WorkflowEventType
  executionId: string
  workflowId: string
  stepId?: string
  timestamp: Date
  data?: unknown
}

export type EventHandler = (event: WorkflowEvent) => void | Promise<void>

// =============================================================================
// Orchestrator Options
// =============================================================================

export interface OrchestratorOptions {
  /** Maximum concurrent step executions */
  maxConcurrency?: number
  /** Default timeout for steps without explicit timeout */
  defaultStepTimeout?: number
  /** Default retry configuration */
  defaultRetry?: RetryConfig
  /** Event handlers */
  onEvent?: EventHandler
}
