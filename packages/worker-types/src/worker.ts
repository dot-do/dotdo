/**
 * @module worker
 * @description Core worker interfaces and types
 *
 * Defines the fundamental interfaces for work-performing entities in dotdo.
 * Both AI Agents and Humans implement these interfaces.
 */

// =============================================================================
// WORKER MODE
// =============================================================================

/**
 * Worker operation modes
 *
 * | Mode | Description | Behavior |
 * |------|-------------|----------|
 * | `autonomous` | Fully independent | Executes without human oversight |
 * | `supervised` | Human oversight | May require approval for actions |
 * | `manual` | Human-controlled | Requires human direction |
 */
export type WorkerMode = 'autonomous' | 'supervised' | 'manual'

// =============================================================================
// TASK TYPES
// =============================================================================

/**
 * Task definition for worker execution
 */
export interface Task {
  /** Unique task identifier */
  id: string
  /** Task type/category */
  type: string
  /** Human-readable description */
  description: string
  /** Task input data */
  input: Record<string, unknown>
  /** Priority level (1 = highest) */
  priority?: number
  /** Task deadline */
  deadline?: Date
}

/**
 * Result of task execution
 */
export interface TaskResult {
  /** Whether the task succeeded */
  success: boolean
  /** Task output (if successful) */
  output?: unknown
  /** Error message (if failed) */
  error?: string
  /** Execution duration in milliseconds */
  duration?: number
}

// =============================================================================
// CONTEXT TYPES
// =============================================================================

/**
 * Execution context for worker operations
 */
export interface Context {
  /** Conversation ID for multi-turn interactions */
  conversationId?: string
  /** User ID for attribution */
  userId?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

// =============================================================================
// QUESTION/ANSWER TYPES
// =============================================================================

/**
 * Answer to a question
 */
export interface Answer {
  /** Answer text */
  text: string
  /** Confidence score (0-1) */
  confidence?: number
  /** Source references */
  sources?: string[]
}

// =============================================================================
// DECISION TYPES
// =============================================================================

/**
 * Option for decision making
 */
export interface Option {
  /** Option identifier */
  id: string
  /** Display label */
  label: string
  /** Extended description */
  description?: string
}

/**
 * Result of a decision
 */
export interface Decision {
  /** The selected option */
  selectedOption: Option
  /** Reasoning for the decision */
  reasoning?: string
  /** Confidence score (0-1) */
  confidence?: number
}

// =============================================================================
// APPROVAL TYPES
// =============================================================================

/**
 * Approval request
 */
export interface ApprovalRequest {
  /** Unique request identifier */
  id: string
  /** Request type/category */
  type: string
  /** Human-readable description */
  description: string
  /** Who is requesting approval */
  requester: string
  /** Request data */
  data: Record<string, unknown>
  /** Approval deadline */
  deadline?: Date
}

/**
 * Result of an approval request
 */
export interface ApprovalResult {
  /** Whether approved */
  approved: boolean
  /** Who approved */
  approver: string
  /** Reason for decision */
  reason?: string
  /** When approved */
  approvedAt?: Date
}

// =============================================================================
// NOTIFICATION TYPES
// =============================================================================

/**
 * Notification channel configuration
 */
export interface Channel {
  /** Channel type */
  type: 'email' | 'slack' | 'sms' | 'webhook'
  /** Channel target (email address, channel name, phone number, URL) */
  target: string
}

// =============================================================================
// WORKER INTERFACE
// =============================================================================

/**
 * Core worker interface that all work-performing entities implement
 *
 * This interface defines the common API for Workers, Agents, and Humans.
 * It enables a unified approach to task execution, question answering,
 * decision making, and approval workflows.
 */
export interface IWorker {
  /**
   * Execute a task
   * @param task - Task to execute
   * @param context - Execution context
   * @returns Task result
   */
  executeWork(task: Task, context?: Context): Promise<TaskResult>

  /**
   * Ask a question and get an answer
   * @param question - The question to ask
   * @param context - Execution context
   * @returns Answer
   */
  ask(question: string, context?: Context): Promise<Answer>

  /**
   * Make a decision between options
   * @param question - The decision question
   * @param options - Available options
   * @param context - Execution context
   * @returns Decision
   */
  decide(question: string, options: Option[], context?: Context): Promise<Decision>

  /**
   * Request approval for an action
   * @param request - Approval request
   * @returns Approval result
   */
  approve(request: ApprovalRequest): Promise<ApprovalResult>

  /**
   * Generate structured output
   * @param prompt - Generation prompt
   * @param schema - Output schema
   * @returns Generated output
   */
  generate<T>(prompt: string, schema?: unknown): Promise<T>

  /**
   * Send notification to channels
   * @param message - Notification message
   * @param channels - Target channels
   */
  notify(message: string, channels: Channel[]): Promise<void>

  /**
   * Get current worker mode
   */
  getMode(): WorkerMode

  /**
   * Set worker mode
   * @param mode - New mode
   */
  setMode(mode: WorkerMode): void
}

// =============================================================================
// WORKER CONFIG
// =============================================================================

/**
 * Configuration for creating a worker
 */
export interface WorkerConfig {
  /** Initial worker mode */
  mode?: WorkerMode
  /** Default notification channels */
  channels?: Channel[]
  /** Worker metadata */
  metadata?: Record<string, unknown>
}
