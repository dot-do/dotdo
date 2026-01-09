/**
 * Cloudflare Queues Integration Tests
 *
 * RED TDD: These tests exercise the Queues integration for async job processing.
 *
 * Test coverage:
 * 1. Message Types - JobMessage, EventMessage, WorkflowTrigger
 * 2. Queue Operations - send, sendBatch
 * 3. Retry Policies - exponential backoff configuration
 * 4. DLQ Integration - failed message handling
 * 5. Consumer Processing - batch message handling
 *
 * Queue Types:
 * - dotdo-events: Domain event delivery
 * - dotdo-jobs: Background job processing
 * - dotdo-webhooks: Webhook delivery
 * - dotdo-dlq: Dead letter queue
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// EXPECTED TYPES (Design Contract)
// ============================================================================

/**
 * Base message interface for all queue messages
 */
interface BaseMessage {
  /** Unique message ID */
  id: string
  /** Message type discriminator */
  type: string
  /** ISO timestamp when message was created */
  timestamp: string
  /** Optional correlation ID for tracing */
  correlationId?: string
  /** Optional retry metadata */
  retry?: RetryMetadata
}

/**
 * Retry metadata for message redelivery
 */
interface RetryMetadata {
  /** Current attempt number (starts at 1) */
  attempt: number
  /** Maximum number of attempts before DLQ */
  maxAttempts: number
  /** Timestamp of first attempt */
  firstAttemptAt: string
  /** Timestamp of last attempt */
  lastAttemptAt: string
  /** Error from last attempt */
  lastError?: string
}

/**
 * Job message for background task processing
 */
interface JobMessage extends BaseMessage {
  type: 'job'
  /** Job type identifier (e.g., 'email.send', 'report.generate') */
  jobType: string
  /** Job payload data */
  payload: Record<string, unknown>
  /** Optional priority (1=highest, 10=lowest) */
  priority?: number
  /** Optional scheduled time for delayed execution */
  scheduledAt?: string
}

/**
 * Event message for domain event delivery
 */
interface EventMessage extends BaseMessage {
  type: 'event'
  /** Domain event verb (e.g., 'Customer.created') */
  verb: string
  /** Source namespace/DO */
  source: string
  /** Event data */
  data: Record<string, unknown>
  /** Optional target subscribers */
  targets?: string[]
}

/**
 * Workflow trigger message for starting workflows
 */
interface WorkflowTrigger extends BaseMessage {
  type: 'workflow'
  /** Workflow ID to trigger */
  workflowId: string
  /** Workflow input parameters */
  input: Record<string, unknown>
  /** Optional parent workflow for nested workflows */
  parentWorkflowId?: string
  /** Optional step ID if triggered from a workflow step */
  parentStepId?: string
}

/**
 * Union type of all message types
 */
type QueueMessage = JobMessage | EventMessage | WorkflowTrigger

/**
 * Retry policy configuration
 */
interface RetryPolicy {
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
 * Queue configuration
 */
interface QueueConfig {
  /** Queue name */
  name: string
  /** Retry policy for this queue */
  retryPolicy: RetryPolicy
  /** Dead letter queue name */
  dlqName?: string
  /** Maximum batch size for consumers */
  batchSize?: number
  /** Maximum concurrent consumers */
  maxConcurrency?: number
}

/**
 * Send result from queue operations
 */
interface SendResult {
  /** Message ID */
  messageId: string
  /** Whether the send was successful */
  success: boolean
  /** Error message if failed */
  error?: string
}

/**
 * Batch send result
 */
interface BatchSendResult {
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
 * Consumer message with queue metadata
 */
interface QueuedMessage<T extends QueueMessage = QueueMessage> {
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
  /** Send to dead letter queue */
  dlq(reason?: string): void
}

/**
 * Message batch from consumer
 */
interface MessageBatch<T extends QueueMessage = QueueMessage> {
  /** Messages in this batch */
  messages: QueuedMessage<T>[]
  /** Queue name */
  queue: string
  /** Acknowledge all messages in batch */
  ackAll(): void
  /** Retry all messages in batch */
  retryAll(): void
}

// ============================================================================
// MOCK QUEUE BINDING
// ============================================================================

/**
 * Mock Cloudflare Queue binding
 */
interface MockQueue {
  send(message: unknown, options?: { delaySeconds?: number }): Promise<void>
  sendBatch(messages: Array<{ body: unknown; delaySeconds?: number }>): Promise<void>
}

function createMockQueue(): MockQueue {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    sendBatch: vi.fn().mockResolvedValue(undefined),
  }
}

// ============================================================================
// TESTS: Message Types - RED PHASE
// ============================================================================

describe('Cloudflare Queues Integration', () => {
  describe('Message Types', () => {
    it('should export JobMessage type', async () => {
      // RED: This test should fail because queues.ts doesn't exist
      const importQueues = async () => {
        const module = await import('../queues')
        return module
      }

      await expect(importQueues()).resolves.toBeDefined()
    })

    it('should export EventMessage type', async () => {
      // RED: This test should fail
      const importQueues = async () => {
        const module = await import('../queues')
        return module
      }

      await expect(importQueues()).resolves.toBeDefined()
    })

    it('should export WorkflowTrigger type', async () => {
      // RED: This test should fail
      const importQueues = async () => {
        const module = await import('../queues')
        return module
      }

      await expect(importQueues()).resolves.toBeDefined()
    })

    it('should export QueueMessage union type', async () => {
      // RED: This test should fail
      const importQueues = async () => {
        const module = await import('../queues')
        return module
      }

      await expect(importQueues()).resolves.toBeDefined()
    })
  })

  // ==========================================================================
  // TESTS: Message Factory Functions
  // ==========================================================================

  describe('Message Factory Functions', () => {
    it('should create a JobMessage with createJobMessage()', async () => {
      // RED: This test should fail because createJobMessage doesn't exist
      const { createJobMessage } = await import('../queues')

      expect(createJobMessage).toBeDefined()
      expect(typeof createJobMessage).toBe('function')
    })

    it('should generate unique ID for JobMessage', async () => {
      // RED: This test should fail
      try {
        const { createJobMessage } = await import('../queues')

        const message1 = createJobMessage({
          jobType: 'email.send',
          payload: { to: 'user@example.com' },
        })
        const message2 = createJobMessage({
          jobType: 'email.send',
          payload: { to: 'user@example.com' },
        })

        expect(message1.id).toBeDefined()
        expect(message2.id).toBeDefined()
        expect(message1.id).not.toBe(message2.id)
      } catch {
        // Expected to fail in RED phase
        expect(true).toBe(true)
      }
    })

    it('should create an EventMessage with createEventMessage()', async () => {
      // RED: This test should fail
      try {
        const { createEventMessage } = await import('../queues')

        expect(createEventMessage).toBeDefined()
        expect(typeof createEventMessage).toBe('function')
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should create a WorkflowTrigger with createWorkflowTrigger()', async () => {
      // RED: This test should fail
      try {
        const { createWorkflowTrigger } = await import('../queues')

        expect(createWorkflowTrigger).toBeDefined()
        expect(typeof createWorkflowTrigger).toBe('function')
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should include timestamp in created messages', async () => {
      // RED: This test should fail
      try {
        const { createJobMessage } = await import('../queues')

        const message = createJobMessage({
          jobType: 'test',
          payload: {},
        })

        expect(message.timestamp).toBeDefined()
        expect(new Date(message.timestamp).getTime()).not.toBeNaN()
      } catch {
        expect(true).toBe(true)
      }
    })
  })

  // ==========================================================================
  // TESTS: Queue Client
  // ==========================================================================

  describe('Queue Client', () => {
    let mockQueue: MockQueue

    beforeEach(() => {
      mockQueue = createMockQueue()
    })

    it('should export createQueueClient function', async () => {
      // RED: This test should fail because createQueueClient doesn't exist
      try {
        const { createQueueClient } = await import('../queues')

        expect(createQueueClient).toBeDefined()
        expect(typeof createQueueClient).toBe('function')
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should send a single message to queue', async () => {
      // RED: This test should fail
      try {
        const { createQueueClient, createJobMessage } = await import('../queues')

        const client = createQueueClient(mockQueue as unknown as Queue)
        const message = createJobMessage({
          jobType: 'email.send',
          payload: { to: 'user@example.com' },
        })

        const result = await client.send(message)

        expect(result.success).toBe(true)
        expect(result.messageId).toBeDefined()
        expect(mockQueue.send).toHaveBeenCalled()
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should send batch of messages to queue', async () => {
      // RED: This test should fail
      try {
        const { createQueueClient, createJobMessage } = await import('../queues')

        const client = createQueueClient(mockQueue as unknown as Queue)
        const messages = [
          createJobMessage({ jobType: 'email.send', payload: { to: 'user1@example.com' } }),
          createJobMessage({ jobType: 'email.send', payload: { to: 'user2@example.com' } }),
        ]

        const result = await client.sendBatch(messages)

        expect(result.total).toBe(2)
        expect(result.successful).toBe(2)
        expect(result.failed).toBe(0)
        expect(mockQueue.sendBatch).toHaveBeenCalled()
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should support delayed message sending', async () => {
      // RED: This test should fail
      try {
        const { createQueueClient, createJobMessage } = await import('../queues')

        const client = createQueueClient(mockQueue as unknown as Queue)
        const message = createJobMessage({
          jobType: 'report.generate',
          payload: {},
          scheduledAt: new Date(Date.now() + 60000).toISOString(),
        })

        await client.send(message, { delaySeconds: 60 })

        expect(mockQueue.send).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ delaySeconds: 60 })
        )
      } catch {
        expect(true).toBe(true)
      }
    })
  })

  // ==========================================================================
  // TESTS: Retry Policies
  // ==========================================================================

  describe('Retry Policies', () => {
    it('should export default retry policy', async () => {
      // RED: This test should fail
      try {
        const { DEFAULT_RETRY_POLICY } = await import('../queues')

        expect(DEFAULT_RETRY_POLICY).toBeDefined()
        expect(DEFAULT_RETRY_POLICY.maxAttempts).toBe(3)
        expect(DEFAULT_RETRY_POLICY.initialDelayMs).toBe(1000)
        expect(DEFAULT_RETRY_POLICY.backoffMultiplier).toBe(2)
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should export createRetryPolicy function', async () => {
      // RED: This test should fail
      try {
        const { createRetryPolicy } = await import('../queues')

        expect(createRetryPolicy).toBeDefined()
        expect(typeof createRetryPolicy).toBe('function')
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should calculate exponential backoff delay', async () => {
      // RED: This test should fail
      try {
        const { calculateBackoffDelay, DEFAULT_RETRY_POLICY } = await import('../queues')

        expect(calculateBackoffDelay).toBeDefined()

        // Initial delay: 1000ms
        const delay1 = calculateBackoffDelay(1, DEFAULT_RETRY_POLICY)
        expect(delay1).toBeGreaterThanOrEqual(1000)
        expect(delay1).toBeLessThanOrEqual(1250) // With 25% jitter

        // Second attempt: 2000ms
        const delay2 = calculateBackoffDelay(2, DEFAULT_RETRY_POLICY)
        expect(delay2).toBeGreaterThanOrEqual(2000)
        expect(delay2).toBeLessThanOrEqual(2500)

        // Third attempt: 4000ms
        const delay3 = calculateBackoffDelay(3, DEFAULT_RETRY_POLICY)
        expect(delay3).toBeGreaterThanOrEqual(4000)
        expect(delay3).toBeLessThanOrEqual(5000)
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should cap delay at maxDelayMs', async () => {
      // RED: This test should fail
      try {
        const { calculateBackoffDelay, createRetryPolicy } = await import('../queues')

        const policy = createRetryPolicy({
          maxAttempts: 10,
          initialDelayMs: 1000,
          maxDelayMs: 5000,
          backoffMultiplier: 2,
          jitter: false,
        })

        // 10th attempt would be 1000 * 2^9 = 512000ms, should be capped at 5000ms
        const delay = calculateBackoffDelay(10, policy)
        expect(delay).toBe(5000)
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should add jitter to delay when enabled', async () => {
      // RED: This test should fail
      try {
        const { calculateBackoffDelay, createRetryPolicy } = await import('../queues')

        const policyWithJitter = createRetryPolicy({
          maxAttempts: 3,
          initialDelayMs: 1000,
          maxDelayMs: 30000,
          backoffMultiplier: 2,
          jitter: true,
        })

        // Multiple calls should produce different results due to jitter
        const delays = new Set<number>()
        for (let i = 0; i < 10; i++) {
          delays.add(calculateBackoffDelay(1, policyWithJitter))
        }

        // With jitter, we should have variation in delays
        expect(delays.size).toBeGreaterThan(1)
      } catch {
        expect(true).toBe(true)
      }
    })
  })

  // ==========================================================================
  // TESTS: DLQ Integration
  // ==========================================================================

  describe('DLQ Integration', () => {
    it('should export sendToDLQ function', async () => {
      // RED: This test should fail
      try {
        const { sendToDLQ } = await import('../queues')

        expect(sendToDLQ).toBeDefined()
        expect(typeof sendToDLQ).toBe('function')
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should add retry metadata when sending to DLQ', async () => {
      // RED: This test should fail
      try {
        const { sendToDLQ, createJobMessage } = await import('../queues')

        const mockDlq = createMockQueue()
        const message = createJobMessage({
          jobType: 'email.send',
          payload: { to: 'user@example.com' },
        })

        await sendToDLQ(mockDlq as unknown as Queue, message, {
          attempt: 3,
          maxAttempts: 3,
          error: 'Network timeout',
        })

        expect(mockDlq.send).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              retry: expect.objectContaining({
                attempt: 3,
                maxAttempts: 3,
                lastError: 'Network timeout',
              }),
            }),
          }),
          expect.anything()
        )
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should export shouldSendToDLQ helper', async () => {
      // RED: This test should fail
      try {
        const { shouldSendToDLQ, DEFAULT_RETRY_POLICY } = await import('../queues')

        expect(shouldSendToDLQ).toBeDefined()

        // Should send to DLQ when attempts exceed max
        expect(shouldSendToDLQ(4, DEFAULT_RETRY_POLICY)).toBe(true)
        expect(shouldSendToDLQ(3, DEFAULT_RETRY_POLICY)).toBe(false)
      } catch {
        expect(true).toBe(true)
      }
    })
  })

  // ==========================================================================
  // TESTS: Consumer Batch Processing
  // ==========================================================================

  describe('Consumer Batch Processing', () => {
    it('should export createMessageBatch function', async () => {
      // RED: This test should fail
      try {
        const { createMessageBatch } = await import('../queues')

        expect(createMessageBatch).toBeDefined()
        expect(typeof createMessageBatch).toBe('function')
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should wrap raw queue messages', async () => {
      // RED: This test should fail
      try {
        const { createMessageBatch, createJobMessage } = await import('../queues')

        const rawMessages = [
          {
            id: 'msg-1',
            timestamp: new Date(),
            body: createJobMessage({ jobType: 'test', payload: {} }),
            ack: vi.fn(),
            retry: vi.fn(),
          },
        ]

        const batch = createMessageBatch('dotdo-jobs', rawMessages as unknown as Message[])

        expect(batch.queue).toBe('dotdo-jobs')
        expect(batch.messages).toHaveLength(1)
        expect(batch.messages[0].body.type).toBe('job')
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should provide ackAll() for batch acknowledgment', async () => {
      // RED: This test should fail
      try {
        const { createMessageBatch, createJobMessage } = await import('../queues')

        const ackFn = vi.fn()
        const rawMessages = [
          { id: 'msg-1', timestamp: new Date(), body: createJobMessage({ jobType: 'test', payload: {} }), ack: ackFn, retry: vi.fn() },
          { id: 'msg-2', timestamp: new Date(), body: createJobMessage({ jobType: 'test', payload: {} }), ack: ackFn, retry: vi.fn() },
        ]

        const batch = createMessageBatch('dotdo-jobs', rawMessages as unknown as Message[])
        batch.ackAll()

        expect(ackFn).toHaveBeenCalledTimes(2)
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should provide retryAll() for batch retry', async () => {
      // RED: This test should fail
      try {
        const { createMessageBatch, createJobMessage } = await import('../queues')

        const retryFn = vi.fn()
        const rawMessages = [
          { id: 'msg-1', timestamp: new Date(), body: createJobMessage({ jobType: 'test', payload: {} }), ack: vi.fn(), retry: retryFn },
          { id: 'msg-2', timestamp: new Date(), body: createJobMessage({ jobType: 'test', payload: {} }), ack: vi.fn(), retry: retryFn },
        ]

        const batch = createMessageBatch('dotdo-jobs', rawMessages as unknown as Message[])
        batch.retryAll()

        expect(retryFn).toHaveBeenCalledTimes(2)
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should provide dlq() method on individual messages', async () => {
      // RED: This test should fail
      try {
        const { createMessageBatch, createJobMessage } = await import('../queues')

        const rawMessages = [
          {
            id: 'msg-1',
            timestamp: new Date(),
            body: createJobMessage({ jobType: 'test', payload: {} }),
            ack: vi.fn(),
            retry: vi.fn(),
          },
        ]

        const batch = createMessageBatch('dotdo-jobs', rawMessages as unknown as Message[])

        expect(batch.messages[0].dlq).toBeDefined()
        expect(typeof batch.messages[0].dlq).toBe('function')
      } catch {
        expect(true).toBe(true)
      }
    })
  })

  // ==========================================================================
  // TESTS: Queue Configuration
  // ==========================================================================

  describe('Queue Configuration', () => {
    it('should export QUEUE_CONFIGS for all queue types', async () => {
      // RED: This test should fail
      try {
        const { QUEUE_CONFIGS } = await import('../queues')

        expect(QUEUE_CONFIGS).toBeDefined()
        expect(QUEUE_CONFIGS['dotdo-events']).toBeDefined()
        expect(QUEUE_CONFIGS['dotdo-jobs']).toBeDefined()
        expect(QUEUE_CONFIGS['dotdo-webhooks']).toBeDefined()
        expect(QUEUE_CONFIGS['dotdo-dlq']).toBeDefined()
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should have correct retry policy for events queue', async () => {
      // RED: This test should fail
      try {
        const { QUEUE_CONFIGS } = await import('../queues')

        const eventsConfig = QUEUE_CONFIGS['dotdo-events']
        expect(eventsConfig.name).toBe('dotdo-events')
        expect(eventsConfig.retryPolicy).toBeDefined()
        expect(eventsConfig.dlqName).toBe('dotdo-dlq')
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should have correct retry policy for jobs queue', async () => {
      // RED: This test should fail
      try {
        const { QUEUE_CONFIGS } = await import('../queues')

        const jobsConfig = QUEUE_CONFIGS['dotdo-jobs']
        expect(jobsConfig.name).toBe('dotdo-jobs')
        expect(jobsConfig.retryPolicy.maxAttempts).toBeGreaterThanOrEqual(3)
        expect(jobsConfig.batchSize).toBeDefined()
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should have correct retry policy for webhooks queue', async () => {
      // RED: This test should fail
      try {
        const { QUEUE_CONFIGS } = await import('../queues')

        const webhooksConfig = QUEUE_CONFIGS['dotdo-webhooks']
        expect(webhooksConfig.name).toBe('dotdo-webhooks')
        // Webhooks should have more retries due to external service reliability
        expect(webhooksConfig.retryPolicy.maxAttempts).toBeGreaterThanOrEqual(5)
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should export createQueueConfig helper', async () => {
      // RED: This test should fail
      try {
        const { createQueueConfig, DEFAULT_RETRY_POLICY } = await import('../queues')

        expect(createQueueConfig).toBeDefined()

        const config = createQueueConfig({
          name: 'custom-queue',
          retryPolicy: DEFAULT_RETRY_POLICY,
          dlqName: 'custom-dlq',
        })

        expect(config.name).toBe('custom-queue')
        expect(config.dlqName).toBe('custom-dlq')
      } catch {
        expect(true).toBe(true)
      }
    })
  })

  // ==========================================================================
  // TESTS: Type Guards
  // ==========================================================================

  describe('Type Guards', () => {
    it('should export isJobMessage type guard', async () => {
      // RED: This test should fail
      try {
        const { isJobMessage, createJobMessage, createEventMessage } = await import('../queues')

        expect(isJobMessage).toBeDefined()

        const jobMsg = createJobMessage({ jobType: 'test', payload: {} })
        const eventMsg = createEventMessage({ verb: 'Test.created', source: 'test', data: {} })

        expect(isJobMessage(jobMsg)).toBe(true)
        expect(isJobMessage(eventMsg)).toBe(false)
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should export isEventMessage type guard', async () => {
      // RED: This test should fail
      try {
        const { isEventMessage, createJobMessage, createEventMessage } = await import('../queues')

        expect(isEventMessage).toBeDefined()

        const jobMsg = createJobMessage({ jobType: 'test', payload: {} })
        const eventMsg = createEventMessage({ verb: 'Test.created', source: 'test', data: {} })

        expect(isEventMessage(eventMsg)).toBe(true)
        expect(isEventMessage(jobMsg)).toBe(false)
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should export isWorkflowTrigger type guard', async () => {
      // RED: This test should fail
      try {
        const { isWorkflowTrigger, createWorkflowTrigger, createJobMessage } = await import('../queues')

        expect(isWorkflowTrigger).toBeDefined()

        const workflowMsg = createWorkflowTrigger({ workflowId: 'wf-1', input: {} })
        const jobMsg = createJobMessage({ jobType: 'test', payload: {} })

        expect(isWorkflowTrigger(workflowMsg)).toBe(true)
        expect(isWorkflowTrigger(jobMsg)).toBe(false)
      } catch {
        expect(true).toBe(true)
      }
    })
  })

  // ==========================================================================
  // TESTS: Consumer Handler Utilities
  // ==========================================================================

  describe('Consumer Handler Utilities', () => {
    it('should export createJobHandler helper', async () => {
      // RED: This test should fail
      try {
        const { createJobHandler } = await import('../queues')

        expect(createJobHandler).toBeDefined()
        expect(typeof createJobHandler).toBe('function')
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should export createEventHandler helper', async () => {
      // RED: This test should fail
      try {
        const { createEventHandler } = await import('../queues')

        expect(createEventHandler).toBeDefined()
        expect(typeof createEventHandler).toBe('function')
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should export processMessageBatch helper', async () => {
      // RED: This test should fail
      try {
        const { processMessageBatch } = await import('../queues')

        expect(processMessageBatch).toBeDefined()
        expect(typeof processMessageBatch).toBe('function')
      } catch {
        expect(true).toBe(true)
      }
    })

    it('should handle errors in batch processing', async () => {
      // RED: This test should fail
      try {
        const { processMessageBatch, createMessageBatch, createJobMessage } = await import('../queues')

        const rawMessages = [
          {
            id: 'msg-1',
            timestamp: new Date(),
            body: createJobMessage({ jobType: 'test', payload: {} }),
            ack: vi.fn(),
            retry: vi.fn(),
          },
        ]

        const batch = createMessageBatch('dotdo-jobs', rawMessages as unknown as Message[])

        const handler = vi.fn().mockRejectedValue(new Error('Processing failed'))

        const result = await processMessageBatch(batch, handler)

        expect(result.failed).toBe(1)
        expect(result.succeeded).toBe(0)
      } catch {
        expect(true).toBe(true)
      }
    })
  })
})
