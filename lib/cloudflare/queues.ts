/**
 * Cloudflare Queues Integration for Async Processing
 *
 * This module provides typed queue operations for the dotdo platform:
 *
 * Message Types:
 * - JobMessage: Background task processing (emails, reports, etc.)
 * - EventMessage: Domain event delivery to external systems
 * - WorkflowTrigger: Queue-based workflow initiation
 *
 * Queue Types:
 * - dotdo-events: Domain event delivery
 * - dotdo-jobs: Background job processing
 * - dotdo-webhooks: Webhook delivery
 * - dotdo-dlq: Dead letter queue
 *
 * @module lib/cloudflare/queues
 */

// ============================================================================
// BASE MESSAGE TYPES
// ============================================================================

/**
 * Retry metadata for message redelivery tracking
 */
export interface RetryMetadata {
  /** Current attempt number (starts at 1) */
  attempt: number
  /** Maximum number of attempts before DLQ */
  maxAttempts: number
  /** ISO timestamp of first attempt */
  firstAttemptAt: string
  /** ISO timestamp of last attempt */
  lastAttemptAt: string
  /** Error message from last attempt */
  lastError?: string
}

/**
 * Base message interface for all queue messages
 */
export interface BaseMessage {
  /** Unique message ID */
  id: string
  /** Message type discriminator */
  type: string
  /** ISO timestamp when message was created */
  timestamp: string
  /** Optional correlation ID for distributed tracing */
  correlationId?: string
  /** Optional retry metadata (added after first failure) */
  retry?: RetryMetadata
}

// ============================================================================
// SPECIALIZED MESSAGE TYPES
// ============================================================================

/**
 * Job message for background task processing
 *
 * @example
 * ```typescript
 * const message = createJobMessage({
 *   jobType: 'email.send',
 *   payload: { to: 'user@example.com.ai', subject: 'Welcome!' },
 *   priority: 1, // High priority
 * })
 * await queueClient.send(message)
 * ```
 */
export interface JobMessage extends BaseMessage {
  type: 'job'
  /** Job type identifier (e.g., 'email.send', 'report.generate') */
  jobType: string
  /** Job payload data */
  payload: Record<string, unknown>
  /** Optional priority (1=highest, 10=lowest, default: 5) */
  priority?: number
  /** Optional scheduled time for delayed execution (ISO string) */
  scheduledAt?: string
}

/**
 * Event message for domain event delivery
 *
 * @example
 * ```typescript
 * const message = createEventMessage({
 *   verb: 'Customer.created',
 *   source: 'https://app.example.com.ai/DO/customers',
 *   data: { customerId: 'cust-123', email: 'user@example.com.ai' },
 *   targets: ['webhook-handler', 'analytics-pipeline'],
 * })
 * await queueClient.send(message)
 * ```
 */
export interface EventMessage extends BaseMessage {
  type: 'event'
  /** Domain event verb (e.g., 'Customer.created', 'Order.completed') */
  verb: string
  /** Source namespace/DO URL */
  source: string
  /** Event data payload */
  data: Record<string, unknown>
  /** Optional list of target subscriber IDs */
  targets?: string[]
}

/**
 * Workflow trigger message for starting workflows
 *
 * @example
 * ```typescript
 * const message = createWorkflowTrigger({
 *   workflowId: 'onboarding-flow',
 *   input: { userId: 'user-123', plan: 'premium' },
 * })
 * await queueClient.send(message)
 * ```
 */
export interface WorkflowTrigger extends BaseMessage {
  type: 'workflow'
  /** Workflow ID to trigger */
  workflowId: string
  /** Workflow input parameters */
  input: Record<string, unknown>
  /** Optional parent workflow ID for nested workflows */
  parentWorkflowId?: string
  /** Optional parent step ID if triggered from a workflow step */
  parentStepId?: string
}

/**
 * Union type of all queue message types
 */
export type QueueMessage = JobMessage | EventMessage | WorkflowTrigger

// ============================================================================
// RETRY POLICY
// ============================================================================

/**
 * Retry policy configuration for queue operations
 */
export interface RetryPolicy {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs: number
  /** Maximum delay in milliseconds (default: 300000 = 5 minutes) */
  maxDelayMs: number
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number
  /** Whether to add jitter to delays (default: true) */
  jitter: boolean
}

/**
 * Default retry policy for queue operations
 *
 * - 3 attempts maximum
 * - Exponential backoff starting at 1 second
 * - Capped at 5 minutes
 * - Jitter enabled for distributed load
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 300000, // 5 minutes
  backoffMultiplier: 2,
  jitter: true,
}

/**
 * Create a custom retry policy by merging with defaults
 *
 * @param overrides - Partial retry policy to merge with defaults
 * @returns Complete retry policy
 */
export function createRetryPolicy(overrides: Partial<RetryPolicy>): RetryPolicy {
  return {
    ...DEFAULT_RETRY_POLICY,
    ...overrides,
  }
}

/**
 * Calculate the backoff delay for a given attempt number
 *
 * @param attempt - The attempt number (1-based)
 * @param policy - The retry policy to use
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(attempt: number, policy: RetryPolicy): number {
  // Exponential backoff: initialDelay * (multiplier ^ (attempt - 1))
  let delay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1)

  // Cap at maximum delay
  delay = Math.min(delay, policy.maxDelayMs)

  // Add jitter (0-25% of delay)
  if (policy.jitter) {
    const jitterRange = delay * 0.25
    delay += Math.random() * jitterRange
  }

  return Math.floor(delay)
}

/**
 * Check if a message should be sent to DLQ based on attempt count
 *
 * @param attempt - Current attempt number
 * @param policy - Retry policy to check against
 * @returns True if message should go to DLQ
 */
export function shouldSendToDLQ(attempt: number, policy: RetryPolicy): boolean {
  return attempt > policy.maxAttempts
}

// ============================================================================
// QUEUE CONFIGURATION
// ============================================================================

/**
 * Queue configuration for a specific queue type
 */
export interface QueueConfig {
  /** Queue name */
  name: string
  /** Retry policy for this queue */
  retryPolicy: RetryPolicy
  /** Dead letter queue name (optional) */
  dlqName?: string
  /** Maximum batch size for consumers (default: 10) */
  batchSize?: number
  /** Maximum concurrent consumers (default: 1) */
  maxConcurrency?: number
}

/**
 * Create a queue configuration with defaults
 */
export function createQueueConfig(config: Partial<QueueConfig> & { name: string }): QueueConfig {
  return {
    retryPolicy: DEFAULT_RETRY_POLICY,
    batchSize: 10,
    maxConcurrency: 1,
    ...config,
  }
}

/**
 * Pre-configured queue configurations for dotdo queues
 */
export const QUEUE_CONFIGS: Record<string, QueueConfig> = {
  'dotdo-events': createQueueConfig({
    name: 'dotdo-events',
    retryPolicy: createRetryPolicy({
      maxAttempts: 3,
      initialDelayMs: 1000,
    }),
    dlqName: 'dotdo-dlq',
    batchSize: 50,
    maxConcurrency: 5,
  }),

  'dotdo-jobs': createQueueConfig({
    name: 'dotdo-jobs',
    retryPolicy: createRetryPolicy({
      maxAttempts: 5,
      initialDelayMs: 2000,
      maxDelayMs: 600000, // 10 minutes
    }),
    dlqName: 'dotdo-dlq',
    batchSize: 10,
    maxConcurrency: 3,
  }),

  'dotdo-webhooks': createQueueConfig({
    name: 'dotdo-webhooks',
    retryPolicy: createRetryPolicy({
      maxAttempts: 5,
      initialDelayMs: 5000, // Longer initial delay for external services
      maxDelayMs: 3600000, // 1 hour max delay
    }),
    dlqName: 'dotdo-dlq',
    batchSize: 5,
    maxConcurrency: 10,
  }),

  'dotdo-dlq': createQueueConfig({
    name: 'dotdo-dlq',
    retryPolicy: createRetryPolicy({
      maxAttempts: 1, // DLQ messages are not retried automatically
    }),
    batchSize: 10,
    maxConcurrency: 1,
  }),
}

// ============================================================================
// MESSAGE FACTORY FUNCTIONS
// ============================================================================

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return `msg-${crypto.randomUUID()}`
}

/**
 * Get current ISO timestamp
 */
function getCurrentTimestamp(): string {
  return new Date().toISOString()
}

/**
 * Input type for creating a job message
 */
export interface CreateJobMessageInput {
  jobType: string
  payload: Record<string, unknown>
  priority?: number
  scheduledAt?: string
  correlationId?: string
}

/**
 * Create a new JobMessage
 *
 * @param input - Job message parameters
 * @returns A fully formed JobMessage
 */
export function createJobMessage(input: CreateJobMessageInput): JobMessage {
  return {
    id: generateMessageId(),
    type: 'job',
    timestamp: getCurrentTimestamp(),
    jobType: input.jobType,
    payload: input.payload,
    priority: input.priority ?? 5,
    scheduledAt: input.scheduledAt,
    correlationId: input.correlationId,
  }
}

/**
 * Input type for creating an event message
 */
export interface CreateEventMessageInput {
  verb: string
  source: string
  data: Record<string, unknown>
  targets?: string[]
  correlationId?: string
}

/**
 * Create a new EventMessage
 *
 * @param input - Event message parameters
 * @returns A fully formed EventMessage
 */
export function createEventMessage(input: CreateEventMessageInput): EventMessage {
  return {
    id: generateMessageId(),
    type: 'event',
    timestamp: getCurrentTimestamp(),
    verb: input.verb,
    source: input.source,
    data: input.data,
    targets: input.targets,
    correlationId: input.correlationId,
  }
}

/**
 * Input type for creating a workflow trigger
 */
export interface CreateWorkflowTriggerInput {
  workflowId: string
  input: Record<string, unknown>
  parentWorkflowId?: string
  parentStepId?: string
  correlationId?: string
}

/**
 * Create a new WorkflowTrigger message
 *
 * @param input - Workflow trigger parameters
 * @returns A fully formed WorkflowTrigger
 */
export function createWorkflowTrigger(input: CreateWorkflowTriggerInput): WorkflowTrigger {
  return {
    id: generateMessageId(),
    type: 'workflow',
    timestamp: getCurrentTimestamp(),
    workflowId: input.workflowId,
    input: input.input,
    parentWorkflowId: input.parentWorkflowId,
    parentStepId: input.parentStepId,
    correlationId: input.correlationId,
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for JobMessage
 */
export function isJobMessage(message: QueueMessage): message is JobMessage {
  return message.type === 'job'
}

/**
 * Type guard for EventMessage
 */
export function isEventMessage(message: QueueMessage): message is EventMessage {
  return message.type === 'event'
}

/**
 * Type guard for WorkflowTrigger
 */
export function isWorkflowTrigger(message: QueueMessage): message is WorkflowTrigger {
  return message.type === 'workflow'
}

// ============================================================================
// QUEUE CLIENT
// ============================================================================

/**
 * Result from sending a single message
 */
export interface SendResult {
  /** Message ID */
  messageId: string
  /** Whether the send was successful */
  success: boolean
  /** Error message if failed */
  error?: string
}

/**
 * Result from sending a batch of messages
 */
export interface BatchSendResult {
  /** Total messages attempted */
  total: number
  /** Successfully sent messages */
  successful: number
  /** Failed messages */
  failed: number
  /** Individual results */
  results: SendResult[]
}

/**
 * Send options for queue operations
 */
export interface SendOptions {
  /** Delay in seconds before message becomes visible */
  delaySeconds?: number
}

/**
 * Queue client interface for sending messages
 */
export interface QueueClient {
  /** Send a single message to the queue */
  send(message: QueueMessage, options?: SendOptions): Promise<SendResult>
  /** Send multiple messages to the queue */
  sendBatch(messages: QueueMessage[], options?: SendOptions): Promise<BatchSendResult>
}

/**
 * Create a queue client wrapping a Cloudflare Queue binding
 *
 * @param queue - The Cloudflare Queue binding
 * @returns A typed queue client
 */
export function createQueueClient(queue: Queue): QueueClient {
  return {
    async send(message: QueueMessage, options?: SendOptions): Promise<SendResult> {
      try {
        await queue.send(message, {
          delaySeconds: options?.delaySeconds,
        })
        return {
          messageId: message.id,
          success: true,
        }
      } catch (error) {
        return {
          messageId: message.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },

    async sendBatch(messages: QueueMessage[], options?: SendOptions): Promise<BatchSendResult> {
      const results: SendResult[] = []

      try {
        const batchMessages = messages.map((message) => ({
          body: message,
          delaySeconds: options?.delaySeconds,
        }))

        await queue.sendBatch(batchMessages)

        // All succeeded
        for (const message of messages) {
          results.push({
            messageId: message.id,
            success: true,
          })
        }
      } catch (error) {
        // All failed
        const errorMessage = error instanceof Error ? error.message : String(error)
        for (const message of messages) {
          results.push({
            messageId: message.id,
            success: false,
            error: errorMessage,
          })
        }
      }

      const successful = results.filter((r) => r.success).length
      const failed = results.filter((r) => !r.success).length

      return {
        total: results.length,
        successful,
        failed,
        results,
      }
    },
  }
}

// ============================================================================
// DLQ INTEGRATION
// ============================================================================

/**
 * Options for sending a message to DLQ
 */
export interface DLQSendOptions {
  /** Current attempt number */
  attempt: number
  /** Maximum attempts allowed */
  maxAttempts: number
  /** Error message from last failure */
  error: string
  /** First attempt timestamp (ISO string) */
  firstAttemptAt?: string
}

/**
 * Send a failed message to the dead letter queue
 *
 * @param dlqQueue - The DLQ Queue binding
 * @param message - The original message that failed
 * @param options - DLQ send options with retry metadata
 */
export async function sendToDLQ(
  dlqQueue: Queue,
  message: QueueMessage,
  options: DLQSendOptions
): Promise<SendResult> {
  const now = getCurrentTimestamp()

  // Add retry metadata to the message
  const dlqMessage: QueueMessage = {
    ...message,
    retry: {
      attempt: options.attempt,
      maxAttempts: options.maxAttempts,
      firstAttemptAt: options.firstAttemptAt ?? now,
      lastAttemptAt: now,
      lastError: options.error,
    },
  }

  try {
    await dlqQueue.send({ body: dlqMessage })
    return {
      messageId: message.id,
      success: true,
    }
  } catch (error) {
    return {
      messageId: message.id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ============================================================================
// CONSUMER BATCH PROCESSING
// ============================================================================

/**
 * Wrapper around a raw queue message with helper methods
 */
export interface QueuedMessage<T extends QueueMessage = QueueMessage> {
  /** The message body */
  body: T
  /** Queue-assigned message ID */
  id: string
  /** Timestamp when message was enqueued */
  timestamp: Date
  /** Number of times this message has been delivered */
  attempts: number
  /** Acknowledge the message (remove from queue) */
  ack(): void
  /** Retry the message with exponential backoff */
  retry(): void
  /** Send to dead letter queue with optional reason */
  dlq(reason?: string): void
}

/**
 * Batch of messages from a queue consumer
 */
export interface MessageBatch<T extends QueueMessage = QueueMessage> {
  /** Messages in this batch */
  messages: QueuedMessage<T>[]
  /** Queue name */
  queue: string
  /** Acknowledge all messages in batch */
  ackAll(): void
  /** Retry all messages in batch */
  retryAll(): void
}

/**
 * Raw message from Cloudflare Queue (minimal interface)
 */
interface RawQueueMessage {
  id: string
  timestamp: Date
  body: unknown
  ack(): void
  retry(): void
}

/**
 * Create a wrapped message batch from raw queue messages
 *
 * @param queueName - The name of the source queue
 * @param rawMessages - Raw messages from Cloudflare Queue
 * @param dlqQueue - Optional DLQ queue for dead lettering
 * @returns A wrapped message batch with helper methods
 */
export function createMessageBatch<T extends QueueMessage = QueueMessage>(
  queueName: string,
  rawMessages: RawQueueMessage[],
  dlqQueue?: Queue
): MessageBatch<T> {
  let attemptCount = 1

  const messages: QueuedMessage<T>[] = rawMessages.map((raw) => ({
    body: raw.body as T,
    id: raw.id,
    timestamp: raw.timestamp,
    attempts: attemptCount++,
    ack: () => raw.ack(),
    retry: () => raw.retry(),
    dlq: (reason?: string) => {
      if (dlqQueue) {
        const message = raw.body as QueueMessage
        sendToDLQ(dlqQueue, message, {
          attempt: attemptCount,
          maxAttempts: 3,
          error: reason ?? 'Manually sent to DLQ',
        }).catch(() => {
          // Best effort DLQ send
        })
      }
      raw.ack() // Acknowledge original message
    },
  }))

  return {
    messages,
    queue: queueName,
    ackAll: () => {
      for (const msg of messages) {
        msg.ack()
      }
    },
    retryAll: () => {
      for (const msg of messages) {
        msg.retry()
      }
    },
  }
}

// ============================================================================
// CONSUMER HANDLER UTILITIES
// ============================================================================

/**
 * Job handler function type
 */
export type JobHandler = (message: JobMessage) => Promise<void>

/**
 * Event handler function type
 */
export type EventHandler = (message: EventMessage) => Promise<void>

/**
 * Generic message handler function type
 */
export type MessageHandler<T extends QueueMessage = QueueMessage> = (message: T) => Promise<void>

/**
 * Create a typed job handler with error handling
 *
 * @param handler - The job processing function
 * @returns A wrapped handler with consistent error handling
 */
export function createJobHandler(handler: JobHandler): MessageHandler<JobMessage> {
  return async (message: JobMessage) => {
    // Runtime validation that message type is correct
    const queueMsg = message as unknown as QueueMessage
    if (!isJobMessage(queueMsg)) {
      throw new Error(`Expected JobMessage but got ${queueMsg.type}`)
    }
    await handler(message)
  }
}

/**
 * Create a typed event handler with error handling
 *
 * @param handler - The event processing function
 * @returns A wrapped handler with consistent error handling
 */
export function createEventHandler(handler: EventHandler): MessageHandler<EventMessage> {
  return async (message: EventMessage) => {
    // Runtime validation that message type is correct
    const queueMsg = message as unknown as QueueMessage
    if (!isEventMessage(queueMsg)) {
      throw new Error(`Expected EventMessage but got ${queueMsg.type}`)
    }
    await handler(message)
  }
}

/**
 * Result from batch message processing
 */
export interface BatchProcessResult {
  /** Number of successfully processed messages */
  succeeded: number
  /** Number of failed messages */
  failed: number
  /** Error details for failed messages */
  errors: Array<{ messageId: string; error: string }>
}

/**
 * Process a batch of messages with a handler function
 *
 * Messages are processed sequentially. Failed messages are collected
 * but processing continues. Returns aggregated results.
 *
 * @param batch - The message batch to process
 * @param handler - The handler function for each message
 * @returns Processing results with success/failure counts
 */
export async function processMessageBatch<T extends QueueMessage>(
  batch: MessageBatch<T>,
  handler: MessageHandler<T>
): Promise<BatchProcessResult> {
  const errors: Array<{ messageId: string; error: string }> = []
  let succeeded = 0
  let failed = 0

  for (const queuedMessage of batch.messages) {
    try {
      await handler(queuedMessage.body)
      queuedMessage.ack()
      succeeded++
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      errors.push({
        messageId: queuedMessage.id,
        error: errorMessage,
      })
      queuedMessage.retry()
      failed++
    }
  }

  return {
    succeeded,
    failed,
    errors,
  }
}
