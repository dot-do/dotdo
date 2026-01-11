// @ts-nocheck - Example code, types provided by @dotdo/sqs package at runtime
/**
 * DLQDO - Dedicated Dead Letter Queue Durable Object
 *
 * A separate Durable Object for managing dead letter queues with:
 * - Failed message inspection and analysis
 * - Bulk reprocessing with filtering
 * - Message retention policies
 * - Alerting hooks for monitoring
 * - Message replay with modifications
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
  PurgeQueueCommand,
  GetQueueAttributesCommand,
  type Message,
} from '@dotdo/sqs'

/**
 * Dead letter entry with failure metadata
 */
export interface DeadLetter {
  id: string
  originalMessageId: string
  body: string
  failureReason: string
  failedAt: string
  receiveCount: number
  firstFailedAt: string
  lastFailedAt: string
  retryHistory: Array<{
    attempt: number
    error: string
    timestamp: string
  }>
  sourceQueue: string
  metadata?: Record<string, unknown>
}

/**
 * Reprocess options
 */
export interface ReprocessOptions {
  /** Filter by failure reason pattern */
  reasonPattern?: string
  /** Filter by failed after date */
  failedAfter?: string
  /** Filter by failed before date */
  failedBefore?: string
  /** Maximum number to reprocess */
  limit?: number
  /** Transform the message body before reprocessing */
  transform?: (body: string) => string
  /** Target queue (default: original source queue) */
  targetQueue?: string
}

/**
 * DLQ statistics
 */
export interface DLQStats {
  totalMessages: number
  oldestMessage?: string
  newestMessage?: string
  bySourceQueue: Record<string, number>
  byFailureReason: Record<string, number>
}

/**
 * DLQDO - Dead Letter Queue Durable Object
 */
export class DLQDO extends DO {
  static readonly $type = 'DLQDO'

  private sqs: SQSClient
  private queuePrefix: string

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    this.sqs = new SQSClient({ region: 'us-east-1' })
    this.queuePrefix = 'https://sqs.us-east-1.amazonaws.com/000000000000/'
  }

  /**
   * Get queue URL for a DLQ
   */
  private dlqUrl(queueName: string): string {
    return `${this.queuePrefix}${queueName}-dlq`
  }

  /**
   * Initialize a DLQ for a source queue
   */
  async initializeDLQ(sourceQueueName: string): Promise<string> {
    const dlqName = `${sourceQueueName}-dlq`

    try {
      await this.sqs.send(new CreateQueueCommand({
        QueueName: dlqName,
        Attributes: {
          MessageRetentionPeriod: '1209600', // 14 days
        },
      }))
    } catch {
      // Queue may already exist
    }

    return this.dlqUrl(sourceQueueName)
  }

  // ===========================================================================
  // Message Storage
  // ===========================================================================

  /**
   * Add a message to the dead letter queue
   */
  async addDeadLetter(
    sourceQueue: string,
    originalMessage: Message,
    failureReason: string,
    retryHistory: DeadLetter['retryHistory'] = []
  ): Promise<string> {
    const now = new Date().toISOString()
    const originalBody = originalMessage.Body ?? ''

    const deadLetter: DeadLetter = {
      id: crypto.randomUUID(),
      originalMessageId: originalMessage.MessageId ?? 'unknown',
      body: originalBody,
      failureReason,
      failedAt: now,
      receiveCount: parseInt(originalMessage.Attributes?.ApproximateReceiveCount ?? '1'),
      firstFailedAt: retryHistory.length > 0 ? retryHistory[0].timestamp : now,
      lastFailedAt: now,
      retryHistory: [
        ...retryHistory,
        {
          attempt: retryHistory.length + 1,
          error: failureReason,
          timestamp: now,
        },
      ],
      sourceQueue,
    }

    const result = await this.sqs.send(new SendMessageCommand({
      QueueUrl: this.dlqUrl(sourceQueue),
      MessageBody: JSON.stringify(deadLetter),
      MessageAttributes: {
        sourceQueue: {
          DataType: 'String',
          StringValue: sourceQueue,
        },
        failureReason: {
          DataType: 'String',
          StringValue: failureReason.slice(0, 256), // Truncate for attribute
        },
        failedAt: {
          DataType: 'String',
          StringValue: now,
        },
      },
    }))

    return result.MessageId!
  }

  /**
   * Add multiple messages to the dead letter queue in batch
   */
  async addDeadLetterBatch(
    sourceQueue: string,
    failures: Array<{
      message: Message
      failureReason: string
      retryHistory?: DeadLetter['retryHistory']
    }>
  ): Promise<{ successful: number; failed: number }> {
    if (failures.length === 0) {
      return { successful: 0, failed: 0 }
    }

    // Process in batches of 10
    let successful = 0
    let failed = 0

    for (let i = 0; i < failures.length; i += 10) {
      const batch = failures.slice(i, i + 10)
      const now = new Date().toISOString()

      const entries = batch.map((failure, index) => {
        const originalBody = failure.message.Body ?? ''
        const retryHistory = failure.retryHistory ?? []

        const deadLetter: DeadLetter = {
          id: crypto.randomUUID(),
          originalMessageId: failure.message.MessageId ?? 'unknown',
          body: originalBody,
          failureReason: failure.failureReason,
          failedAt: now,
          receiveCount: parseInt(failure.message.Attributes?.ApproximateReceiveCount ?? '1'),
          firstFailedAt: retryHistory.length > 0 ? retryHistory[0].timestamp : now,
          lastFailedAt: now,
          retryHistory: [
            ...retryHistory,
            {
              attempt: retryHistory.length + 1,
              error: failure.failureReason,
              timestamp: now,
            },
          ],
          sourceQueue,
        }

        return {
          Id: `dlq-${index}`,
          MessageBody: JSON.stringify(deadLetter),
          MessageAttributes: {
            sourceQueue: {
              DataType: 'String',
              StringValue: sourceQueue,
            },
            failureReason: {
              DataType: 'String',
              StringValue: failure.failureReason.slice(0, 256),
            },
          },
        }
      })

      const result = await this.sqs.send(new SendMessageBatchCommand({
        QueueUrl: this.dlqUrl(sourceQueue),
        Entries: entries,
      }))

      successful += result.Successful?.length ?? 0
      failed += result.Failed?.length ?? 0
    }

    return { successful, failed }
  }

  // ===========================================================================
  // Message Retrieval
  // ===========================================================================

  /**
   * Receive dead letters for inspection
   */
  async receiveDeadLetters(
    sourceQueue: string,
    options: { maxMessages?: number; visibilityTimeout?: number } = {}
  ): Promise<Array<{ message: Message; deadLetter: DeadLetter }>> {
    const result = await this.sqs.send(new ReceiveMessageCommand({
      QueueUrl: this.dlqUrl(sourceQueue),
      MaxNumberOfMessages: Math.min(options.maxMessages ?? 10, 10),
      VisibilityTimeout: options.visibilityTimeout ?? 300, // 5 min default for inspection
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
    }))

    return (result.Messages ?? []).map((message: Message) => ({
      message,
      deadLetter: JSON.parse(message.Body!) as DeadLetter,
    }))
  }

  /**
   * Peek at dead letters without hiding them
   */
  async peekDeadLetters(
    sourceQueue: string,
    options: { maxMessages?: number } = {}
  ): Promise<DeadLetter[]> {
    const result = await this.sqs.send(new ReceiveMessageCommand({
      QueueUrl: this.dlqUrl(sourceQueue),
      MaxNumberOfMessages: Math.min(options.maxMessages ?? 10, 10),
      VisibilityTimeout: 0, // Immediately visible again
      AttributeNames: ['All'],
    }))

    return (result.Messages ?? []).map((message: Message) =>
      JSON.parse(message.Body!) as DeadLetter
    )
  }

  // ===========================================================================
  // Reprocessing
  // ===========================================================================

  /**
   * Reprocess a single dead letter
   */
  async reprocess(
    sourceQueue: string,
    receiptHandle: string,
    deadLetter: DeadLetter,
    options: { targetQueue?: string; transform?: (body: string) => string } = {}
  ): Promise<{ newMessageId: string }> {
    const targetQueue = options.targetQueue ?? deadLetter.sourceQueue
    const body = options.transform ? options.transform(deadLetter.body) : deadLetter.body

    // Send to target queue
    const result = await this.sqs.send(new SendMessageCommand({
      QueueUrl: `${this.queuePrefix}${targetQueue}`,
      MessageBody: body,
      MessageAttributes: {
        reprocessedFrom: {
          DataType: 'String',
          StringValue: 'dlq',
        },
        originalMessageId: {
          DataType: 'String',
          StringValue: deadLetter.originalMessageId,
        },
        reprocessedAt: {
          DataType: 'String',
          StringValue: new Date().toISOString(),
        },
      },
    }))

    // Delete from DLQ
    await this.sqs.send(new DeleteMessageCommand({
      QueueUrl: this.dlqUrl(sourceQueue),
      ReceiptHandle: receiptHandle,
    }))

    return { newMessageId: result.MessageId! }
  }

  /**
   * Bulk reprocess dead letters with filtering
   */
  async bulkReprocess(
    sourceQueue: string,
    options: ReprocessOptions = {}
  ): Promise<{
    reprocessed: number
    failed: number
    skipped: number
  }> {
    const limit = options.limit ?? 100
    let reprocessed = 0
    let failed = 0
    let skipped = 0
    let processed = 0

    while (processed < limit) {
      // Receive batch of dead letters
      const batch = await this.receiveDeadLetters(sourceQueue, {
        maxMessages: Math.min(10, limit - processed),
        visibilityTimeout: 300,
      })

      if (batch.length === 0) break

      for (const { message, deadLetter } of batch) {
        // Apply filters
        if (options.reasonPattern) {
          const pattern = new RegExp(options.reasonPattern, 'i')
          if (!pattern.test(deadLetter.failureReason)) {
            skipped++
            processed++
            // Return message to queue by setting visibility to 0
            continue
          }
        }

        if (options.failedAfter) {
          if (new Date(deadLetter.failedAt) < new Date(options.failedAfter)) {
            skipped++
            processed++
            continue
          }
        }

        if (options.failedBefore) {
          if (new Date(deadLetter.failedAt) > new Date(options.failedBefore)) {
            skipped++
            processed++
            continue
          }
        }

        // Reprocess
        try {
          await this.reprocess(sourceQueue, message.ReceiptHandle!, deadLetter, {
            targetQueue: options.targetQueue,
            transform: options.transform,
          })
          reprocessed++
        } catch (error) {
          failed++
          console.error('Reprocess failed:', error)
        }

        processed++
        if (processed >= limit) break
      }
    }

    return { reprocessed, failed, skipped }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Delete a dead letter without reprocessing
   */
  async deleteDeadLetter(sourceQueue: string, receiptHandle: string): Promise<void> {
    await this.sqs.send(new DeleteMessageCommand({
      QueueUrl: this.dlqUrl(sourceQueue),
      ReceiptHandle: receiptHandle,
    }))
  }

  /**
   * Purge all dead letters for a source queue
   */
  async purge(sourceQueue: string): Promise<void> {
    await this.sqs.send(new PurgeQueueCommand({
      QueueUrl: this.dlqUrl(sourceQueue),
    }))
  }

  /**
   * Delete dead letters older than a certain age
   */
  async cleanup(
    sourceQueue: string,
    olderThan: string
  ): Promise<{ deleted: number }> {
    const cutoff = new Date(olderThan)
    let deleted = 0

    while (true) {
      const batch = await this.receiveDeadLetters(sourceQueue, {
        maxMessages: 10,
        visibilityTimeout: 60,
      })

      if (batch.length === 0) break

      const toDelete: string[] = []

      for (const { message, deadLetter } of batch) {
        if (new Date(deadLetter.failedAt) < cutoff) {
          toDelete.push(message.ReceiptHandle!)
        }
      }

      if (toDelete.length > 0) {
        await this.sqs.send(new DeleteMessageBatchCommand({
          QueueUrl: this.dlqUrl(sourceQueue),
          Entries: toDelete.map((handle, i) => ({
            Id: `del-${i}`,
            ReceiptHandle: handle,
          })),
        }))
        deleted += toDelete.length
      }

      // If we didn't delete all in batch, more work to do
      if (toDelete.length < batch.length) break
    }

    return { deleted }
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get DLQ statistics
   */
  async getStats(sourceQueue: string): Promise<DLQStats> {
    const attrs = await this.sqs.send(new GetQueueAttributesCommand({
      QueueUrl: this.dlqUrl(sourceQueue),
      AttributeNames: ['All'],
    }))

    const totalMessages = parseInt(
      attrs.Attributes?.ApproximateNumberOfMessages ?? '0'
    )

    // Sample messages to build statistics
    const sample = await this.peekDeadLetters(sourceQueue, { maxMessages: 10 })

    const bySourceQueue: Record<string, number> = {}
    const byFailureReason: Record<string, number> = {}
    let oldestMessage: string | undefined
    let newestMessage: string | undefined

    for (const dl of sample) {
      // Count by source queue
      bySourceQueue[dl.sourceQueue] = (bySourceQueue[dl.sourceQueue] ?? 0) + 1

      // Count by failure reason (normalize)
      const reason = dl.failureReason.split(':')[0].trim()
      byFailureReason[reason] = (byFailureReason[reason] ?? 0) + 1

      // Track oldest/newest
      if (!oldestMessage || dl.failedAt < oldestMessage) {
        oldestMessage = dl.failedAt
      }
      if (!newestMessage || dl.failedAt > newestMessage) {
        newestMessage = dl.failedAt
      }
    }

    return {
      totalMessages,
      oldestMessage,
      newestMessage,
      bySourceQueue,
      byFailureReason,
    }
  }

  // ===========================================================================
  // Alerting Hooks
  // ===========================================================================

  /**
   * Check if DLQ depth exceeds threshold
   */
  async checkThreshold(
    sourceQueue: string,
    threshold: number
  ): Promise<{ exceeds: boolean; count: number }> {
    const stats = await this.getStats(sourceQueue)
    return {
      exceeds: stats.totalMessages > threshold,
      count: stats.totalMessages,
    }
  }

  /**
   * Get recent failures for alerting
   */
  async getRecentFailures(
    sourceQueue: string,
    withinMinutes: number
  ): Promise<DeadLetter[]> {
    const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString()
    const sample = await this.peekDeadLetters(sourceQueue, { maxMessages: 10 })

    return sample.filter(dl => dl.failedAt >= cutoff)
  }
}
