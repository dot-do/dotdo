// @ts-nocheck - Example code, types provided by @dotdo/sqs package at runtime
/**
 * QueueDO - Durable Object for SQS-compatible queue processing
 *
 * Features:
 * - Send/receive messages with visibility timeout
 * - Batch operations (send, delete, change visibility)
 * - Exponential backoff retries
 * - Dead letter queue support
 * - FIFO queue ordering
 * - Long polling
 */

import { DO } from 'dotdo'
import {
  SQSClient,
  CreateQueueCommand,
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
  ChangeMessageVisibilityCommand,
  PurgeQueueCommand,
  GetQueueAttributesCommand,
  type Message,
  type SendMessageBatchRequestEntry,
  type SendMessageCommandOutput,
  type SendMessageBatchCommandOutput,
  type ReceiveMessageCommandOutput,
  type GetQueueAttributesCommandOutput,
} from '@dotdo/sqs'

// Job types for the example
export interface Job {
  id: string
  type: 'email' | 'image' | 'notification' | 'webhook'
  payload: Record<string, unknown>
  priority?: number
  createdAt: string
}

export interface ProcessResult {
  jobId: string
  success: boolean
  error?: string
  duration: number
}

/**
 * QueueDO - Manages job queues with SQS-compatible API
 */
export class QueueDO extends DO {
  static readonly $type = 'QueueDO'

  private sqs: SQSClient
  private queueUrl = 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs'
  private dlqUrl = 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs-dlq'
  private maxRetries = 5

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    this.sqs = new SQSClient({ region: 'us-east-1' })
  }

  /**
   * Initialize queues on first access
   */
  async initialize() {
    // Create dead letter queue first
    try {
      await this.sqs.send(new CreateQueueCommand({
        QueueName: 'jobs-dlq',
      }))
    } catch {
      // Queue may already exist
    }

    // Create main queue with DLQ policy
    try {
      await this.sqs.send(new CreateQueueCommand({
        QueueName: 'jobs',
        Attributes: {
          VisibilityTimeout: '30',
          MessageRetentionPeriod: '345600', // 4 days
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: 'arn:aws:sqs:us-east-1:000000000000:jobs-dlq',
            maxReceiveCount: this.maxRetries.toString(),
          }),
        },
      }))
    } catch {
      // Queue may already exist
    }
  }

  // ===========================================================================
  // Queue Operations
  // ===========================================================================

  /**
   * Queue a new job for processing
   */
  async queueJob(job: Omit<Job, 'id' | 'createdAt'>): Promise<{ messageId: string; job: Job }> {
    const fullJob: Job = {
      ...job,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }

    const result = await this.sqs.send(new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(fullJob),
      DelaySeconds: job.priority === 1 ? 0 : undefined, // High priority = no delay
      MessageAttributes: {
        jobType: {
          DataType: 'String',
          StringValue: job.type,
        },
        priority: {
          DataType: 'Number',
          StringValue: (job.priority ?? 2).toString(),
        },
      },
    })) as SendMessageCommandOutput

    return {
      messageId: result.MessageId!,
      job: fullJob,
    }
  }

  /**
   * Queue multiple jobs in a single batch
   */
  async queueJobBatch(jobs: Omit<Job, 'id' | 'createdAt'>[]): Promise<{
    successful: string[]
    failed: Array<{ index: number; error: string }>
  }> {
    if (jobs.length === 0) {
      return { successful: [], failed: [] }
    }

    if (jobs.length > 10) {
      throw new Error('Batch size cannot exceed 10 messages')
    }

    const entries: SendMessageBatchRequestEntry[] = jobs.map((job, index) => {
      const fullJob: Job = {
        ...job,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      }

      return {
        Id: `job-${index}`,
        MessageBody: JSON.stringify(fullJob),
        DelaySeconds: job.priority === 1 ? 0 : undefined,
        MessageAttributes: {
          jobType: {
            DataType: 'String',
            StringValue: job.type,
          },
        },
      }
    })

    const result = await this.sqs.send(new SendMessageBatchCommand({
      QueueUrl: this.queueUrl,
      Entries: entries,
    }))

    return {
      successful: result.Successful?.map(s => s.MessageId) ?? [],
      failed: result.Failed?.map(f => ({
        index: parseInt(f.Id.replace('job-', '')),
        error: f.Message ?? 'Unknown error',
      })) ?? [],
    }
  }

  /**
   * Receive jobs for processing
   */
  async receiveJobs(options: {
    maxMessages?: number
    visibilityTimeout?: number
    waitTimeSeconds?: number
  } = {}): Promise<Array<{ message: Message; job: Job }>> {
    const result = await this.sqs.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: Math.min(options.maxMessages ?? 10, 10),
      VisibilityTimeout: options.visibilityTimeout ?? 30,
      WaitTimeSeconds: options.waitTimeSeconds ?? 0,
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
    }))

    return (result.Messages ?? []).map((message: Message) => ({
      message,
      job: JSON.parse(message.Body!) as Job,
    }))
  }

  /**
   * Mark a job as complete (delete from queue)
   */
  async completeJob(receiptHandle: string): Promise<void> {
    await this.sqs.send(new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    }))
  }

  /**
   * Complete multiple jobs in a batch
   */
  async completeJobBatch(receiptHandles: string[]): Promise<{
    successful: number
    failed: number
  }> {
    if (receiptHandles.length === 0) {
      return { successful: 0, failed: 0 }
    }

    const result = await this.sqs.send(new DeleteMessageBatchCommand({
      QueueUrl: this.queueUrl,
      Entries: receiptHandles.map((handle, i) => ({
        Id: `del-${i}`,
        ReceiptHandle: handle,
      })),
    }))

    return {
      successful: result.Successful?.length ?? 0,
      failed: result.Failed?.length ?? 0,
    }
  }

  /**
   * Extend visibility timeout for a job (still processing)
   */
  async extendVisibility(receiptHandle: string, additionalSeconds: number): Promise<void> {
    await this.sqs.send(new ChangeMessageVisibilityCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: additionalSeconds,
    }))
  }

  // ===========================================================================
  // Retry Logic with Exponential Backoff
  // ===========================================================================

  /**
   * Process a job with automatic retry on failure
   */
  async processWithRetry(
    message: Message,
    processor: (job: Job) => Promise<void>
  ): Promise<ProcessResult> {
    const job = JSON.parse(message.Body!) as Job
    const startTime = Date.now()
    const receiveCount = parseInt(message.Attributes?.ApproximateReceiveCount ?? '1')

    try {
      await processor(job)

      // Success - delete message
      await this.completeJob(message.ReceiptHandle!)

      return {
        jobId: job.id,
        success: true,
        duration: Date.now() - startTime,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      if (receiveCount >= this.maxRetries) {
        // Max retries exceeded - move to DLQ
        await this.moveToDeadLetter(message, errorMessage)

        return {
          jobId: job.id,
          success: false,
          error: `Max retries exceeded: ${errorMessage}`,
          duration: Date.now() - startTime,
        }
      }

      // Exponential backoff: 2^(attempt-1) seconds
      // 1s, 2s, 4s, 8s, 16s
      const backoffSeconds = Math.pow(2, receiveCount - 1)

      await this.sqs.send(new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle!,
        VisibilityTimeout: backoffSeconds,
      }))

      return {
        jobId: job.id,
        success: false,
        error: `Retry ${receiveCount}/${this.maxRetries}: ${errorMessage}`,
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * Move a failed message to the dead letter queue
   */
  private async moveToDeadLetter(message: Message, reason: string): Promise<void> {
    const job = JSON.parse(message.Body!) as Job

    // Send to DLQ with failure metadata
    await this.sqs.send(new SendMessageCommand({
      QueueUrl: this.dlqUrl,
      MessageBody: JSON.stringify({
        ...job,
        failureReason: reason,
        failedAt: new Date().toISOString(),
        originalMessageId: message.MessageId,
        receiveCount: message.Attributes?.ApproximateReceiveCount,
      }),
    }))

    // Delete from main queue
    await this.completeJob(message.ReceiptHandle!)
  }

  // ===========================================================================
  // Dead Letter Queue Operations
  // ===========================================================================

  /**
   * Receive failed jobs from the dead letter queue
   */
  async receiveDeadLetters(maxMessages = 10): Promise<Array<{
    message: Message
    job: Job & { failureReason?: string; failedAt?: string }
  }>> {
    const result = await this.sqs.send(new ReceiveMessageCommand({
      QueueUrl: this.dlqUrl,
      MaxNumberOfMessages: Math.min(maxMessages, 10),
      AttributeNames: ['All'],
    }))

    return (result.Messages ?? []).map((message: Message) => ({
      message,
      job: JSON.parse(message.Body!),
    }))
  }

  /**
   * Reprocess a dead letter by moving it back to the main queue
   */
  async reprocessDeadLetter(receiptHandle: string, messageBody: string): Promise<string> {
    const job = JSON.parse(messageBody) as Job

    // Remove failure metadata and requeue
    const cleanJob: Job = {
      id: job.id,
      type: job.type,
      payload: job.payload,
      priority: job.priority,
      createdAt: new Date().toISOString(), // Reset timestamp
    }

    const result = await this.sqs.send(new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(cleanJob),
    }))

    // Delete from DLQ
    await this.sqs.send(new DeleteMessageCommand({
      QueueUrl: this.dlqUrl,
      ReceiptHandle: receiptHandle,
    }))

    return result.MessageId!
  }

  /**
   * Purge all dead letters (use with caution)
   */
  async purgeDeadLetters(): Promise<void> {
    await this.sqs.send(new PurgeQueueCommand({
      QueueUrl: this.dlqUrl,
    }))
  }

  // ===========================================================================
  // Queue Statistics
  // ===========================================================================

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    pending: number
    inFlight: number
    delayed: number
    deadLetters: number
  }> {
    const [mainAttrs, dlqAttrs] = await Promise.all([
      this.sqs.send(new GetQueueAttributesCommand({
        QueueUrl: this.queueUrl,
        AttributeNames: ['All'],
      })),
      this.sqs.send(new GetQueueAttributesCommand({
        QueueUrl: this.dlqUrl,
        AttributeNames: ['All'],
      })),
    ])

    return {
      pending: parseInt(mainAttrs.Attributes?.ApproximateNumberOfMessages ?? '0'),
      inFlight: parseInt(mainAttrs.Attributes?.ApproximateNumberOfMessagesNotVisible ?? '0'),
      delayed: parseInt(mainAttrs.Attributes?.ApproximateNumberOfMessagesDelayed ?? '0'),
      deadLetters: parseInt(dlqAttrs.Attributes?.ApproximateNumberOfMessages ?? '0'),
    }
  }

  /**
   * Purge all messages from the main queue (use with caution)
   */
  async purgeQueue(): Promise<void> {
    await this.sqs.send(new PurgeQueueCommand({
      QueueUrl: this.queueUrl,
    }))
  }
}
