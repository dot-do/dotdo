// @ts-nocheck - Example code, types provided by @dotdo/sqs package at runtime
/**
 * FifoQueueDO - FIFO Queue Durable Object
 *
 * Implements exactly-once delivery and strict message ordering with:
 * - Message groups for parallel processing of independent work
 * - Content-based deduplication
 * - Sequence numbers for ordering verification
 * - High-throughput mode configuration
 */

import { DO } from 'dotdo'
import {
  SQSClient,
  CreateQueueCommand,
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  type Message,
  type SendMessageBatchRequestEntry,
} from '@dotdo/sqs'

/**
 * FIFO message with ordering metadata
 */
export interface FifoMessage<T = unknown> {
  id: string
  sequenceNumber: string
  messageGroupId: string
  deduplicationId?: string
  body: T
  sentAt: string
}

/**
 * Message group status
 */
export interface MessageGroupStatus {
  groupId: string
  messagesInFlight: number
  lastSequenceNumber?: string
  blocked: boolean
}

/**
 * FIFO queue options
 */
export interface FifoQueueOptions {
  /** Enable content-based deduplication */
  contentBasedDeduplication?: boolean
  /** Deduplication scope: messageGroup or queue */
  deduplicationScope?: 'messageGroup' | 'queue'
  /** High throughput mode */
  highThroughput?: boolean
  /** Visibility timeout in seconds */
  visibilityTimeout?: number
}

/**
 * FifoQueueDO - FIFO Queue Durable Object
 */
export class FifoQueueDO extends DO {
  static readonly $type = 'FifoQueueDO'

  private sqs: SQSClient
  private queueUrl: string
  private queueName: string
  private options: FifoQueueOptions

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    this.sqs = new SQSClient({ region: 'us-east-1' })
    this.queueName = 'fifo-queue.fifo'
    this.queueUrl = `https://sqs.us-east-1.amazonaws.com/000000000000/${this.queueName}`
    this.options = {
      contentBasedDeduplication: true,
      deduplicationScope: 'messageGroup',
      highThroughput: false,
      visibilityTimeout: 30,
    }
  }

  /**
   * Initialize the FIFO queue
   */
  async initialize(
    queueName: string,
    options: FifoQueueOptions = {}
  ): Promise<{ queueUrl: string }> {
    this.options = { ...this.options, ...options }

    // Ensure queue name ends with .fifo
    this.queueName = queueName.endsWith('.fifo') ? queueName : `${queueName}.fifo`
    this.queueUrl = `https://sqs.us-east-1.amazonaws.com/000000000000/${this.queueName}`

    try {
      const result = await this.sqs.send(new CreateQueueCommand({
        QueueName: this.queueName,
        Attributes: {
          FifoQueue: 'true',
          ContentBasedDeduplication: this.options.contentBasedDeduplication ? 'true' : 'false',
          DeduplicationScope: this.options.deduplicationScope ?? 'messageGroup',
          FifoThroughputLimit: this.options.highThroughput ? 'perMessageGroupId' : 'perQueue',
          VisibilityTimeout: (this.options.visibilityTimeout ?? 30).toString(),
        },
      }))

      this.queueUrl = result.QueueUrl!
    } catch {
      // Queue may already exist
    }

    return { queueUrl: this.queueUrl }
  }

  // ===========================================================================
  // Sending Messages
  // ===========================================================================

  /**
   * Send a message to a specific message group
   *
   * Messages within the same group are processed in order.
   * Messages in different groups can be processed in parallel.
   *
   * @example
   * // Process orders for each customer in order
   * await fifo.send('customer-123', { orderId: 'order-1', action: 'create' })
   * await fifo.send('customer-123', { orderId: 'order-1', action: 'ship' })
   *
   * // Different customers can be processed in parallel
   * await fifo.send('customer-456', { orderId: 'order-2', action: 'create' })
   */
  async send<T>(
    messageGroupId: string,
    body: T,
    options: { deduplicationId?: string; delaySeconds?: number } = {}
  ): Promise<FifoMessage<T>> {
    const messageBody = typeof body === 'string' ? body : JSON.stringify(body)

    const result = await this.sqs.send(new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: messageBody,
      MessageGroupId: messageGroupId,
      MessageDeduplicationId: options.deduplicationId,
      DelaySeconds: options.delaySeconds,
    }))

    return {
      id: result.MessageId!,
      sequenceNumber: result.SequenceNumber!,
      messageGroupId,
      deduplicationId: options.deduplicationId,
      body,
      sentAt: new Date().toISOString(),
    }
  }

  /**
   * Send multiple messages in a batch
   *
   * All messages in a batch must belong to the same or different message groups.
   * Order is preserved per group.
   *
   * @example
   * await fifo.sendBatch([
   *   { groupId: 'orders', body: { action: 'create', id: '1' } },
   *   { groupId: 'orders', body: { action: 'create', id: '2' } },
   *   { groupId: 'inventory', body: { action: 'update', sku: 'ABC' } },
   * ])
   */
  async sendBatch<T>(
    messages: Array<{
      groupId: string
      body: T
      deduplicationId?: string
    }>
  ): Promise<{
    successful: FifoMessage<T>[]
    failed: Array<{ index: number; error: string }>
  }> {
    if (messages.length === 0) {
      return { successful: [], failed: [] }
    }

    if (messages.length > 10) {
      throw new Error('Batch size cannot exceed 10 messages')
    }

    const entries: SendMessageBatchRequestEntry[] = messages.map((msg, index) => ({
      Id: `msg-${index}`,
      MessageBody: typeof msg.body === 'string' ? msg.body : JSON.stringify(msg.body),
      MessageGroupId: msg.groupId,
      MessageDeduplicationId: msg.deduplicationId,
    }))

    const result = await this.sqs.send(new SendMessageBatchCommand({
      QueueUrl: this.queueUrl,
      Entries: entries,
    }))

    const successful: FifoMessage<T>[] = (result.Successful ?? []).map((s) => {
      const originalIndex = parseInt(s.Id.replace('msg-', ''))
      return {
        id: s.MessageId,
        sequenceNumber: s.SequenceNumber!,
        messageGroupId: messages[originalIndex].groupId,
        deduplicationId: messages[originalIndex].deduplicationId,
        body: messages[originalIndex].body,
        sentAt: new Date().toISOString(),
      }
    })

    const failed = (result.Failed ?? []).map((f) => ({
      index: parseInt(f.Id.replace('msg-', '')),
      error: f.Message ?? 'Unknown error',
    }))

    return { successful, failed }
  }

  // ===========================================================================
  // Receiving Messages
  // ===========================================================================

  /**
   * Receive messages from the FIFO queue
   *
   * Messages are returned in order per message group.
   * Only one message per group is returned at a time (unless visibility timeout expires).
   */
  async receive<T>(options: {
    maxMessages?: number
    visibilityTimeout?: number
    waitTimeSeconds?: number
  } = {}): Promise<Array<{
    message: Message
    fifoMessage: FifoMessage<T>
  }>> {
    const result = await this.sqs.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: Math.min(options.maxMessages ?? 10, 10),
      VisibilityTimeout: options.visibilityTimeout ?? this.options.visibilityTimeout,
      WaitTimeSeconds: options.waitTimeSeconds ?? 0,
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
    }))

    return (result.Messages ?? []).map((message: Message) => {
      let body: T
      try {
        body = JSON.parse(message.Body!) as T
      } catch {
        body = message.Body as unknown as T
      }

      return {
        message,
        fifoMessage: {
          id: message.MessageId!,
          sequenceNumber: message.Attributes?.SequenceNumber ?? '',
          messageGroupId: message.Attributes?.MessageGroupId ?? '',
          deduplicationId: message.Attributes?.MessageDeduplicationId,
          body,
          sentAt: new Date(parseInt(message.Attributes?.SentTimestamp ?? '0')).toISOString(),
        },
      }
    })
  }

  /**
   * Receive messages from a specific message group
   *
   * Note: SQS doesn't support filtering by group on receive.
   * This method receives all available messages and filters client-side.
   */
  async receiveFromGroup<T>(
    messageGroupId: string,
    options: { maxMessages?: number; visibilityTimeout?: number } = {}
  ): Promise<Array<{ message: Message; fifoMessage: FifoMessage<T> }>> {
    const all = await this.receive<T>(options)
    return all.filter(m => m.fifoMessage.messageGroupId === messageGroupId)
  }

  /**
   * Complete (delete) a message
   */
  async complete(receiptHandle: string): Promise<void> {
    await this.sqs.send(new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    }))
  }

  // ===========================================================================
  // Ordering Patterns
  // ===========================================================================

  /**
   * Process messages in order with automatic acknowledgment
   *
   * @example
   * await fifo.processInOrder(async (message, ack) => {
   *   await processOrder(message.body)
   *   await ack() // Acknowledge after processing
   * })
   */
  async processInOrder<T>(
    handler: (
      fifoMessage: FifoMessage<T>,
      ack: () => Promise<void>,
      message: Message
    ) => Promise<void>,
    options: { maxMessages?: number; visibilityTimeout?: number } = {}
  ): Promise<{ processed: number; errors: number }> {
    const messages = await this.receive<T>(options)

    let processed = 0
    let errors = 0

    for (const { message, fifoMessage } of messages) {
      try {
        const ack = async () => {
          await this.complete(message.ReceiptHandle!)
        }

        await handler(fifoMessage, ack, message)
        processed++
      } catch (error) {
        errors++
        console.error(`Error processing message ${fifoMessage.id}:`, error)
        // Message will become visible again after visibility timeout
      }
    }

    return { processed, errors }
  }

  /**
   * Process messages grouped by message group ID
   *
   * This allows parallel processing of different groups while maintaining
   * order within each group.
   */
  async processByGroup<T>(
    handler: (
      groupId: string,
      messages: FifoMessage<T>[],
      ackAll: () => Promise<void>
    ) => Promise<void>,
    options: { maxMessages?: number; visibilityTimeout?: number } = {}
  ): Promise<{ groupsProcessed: number; messagesProcessed: number; errors: number }> {
    const results = await this.receive<T>(options)

    // Group by message group ID
    const groups = new Map<string, Array<{ message: Message; fifoMessage: FifoMessage<T> }>>()

    for (const item of results) {
      const groupId = item.fifoMessage.messageGroupId
      if (!groups.has(groupId)) {
        groups.set(groupId, [])
      }
      groups.get(groupId)!.push(item)
    }

    let groupsProcessed = 0
    let messagesProcessed = 0
    let errors = 0

    // Process each group
    for (const [groupId, groupMessages] of groups) {
      try {
        const fifoMessages = groupMessages.map(m => m.fifoMessage)
        const ackAll = async () => {
          for (const { message } of groupMessages) {
            await this.complete(message.ReceiptHandle!)
          }
        }

        await handler(groupId, fifoMessages, ackAll)
        groupsProcessed++
        messagesProcessed += groupMessages.length
      } catch (error) {
        errors++
        console.error(`Error processing group ${groupId}:`, error)
      }
    }

    return { groupsProcessed, messagesProcessed, errors }
  }

  // ===========================================================================
  // Deduplication
  // ===========================================================================

  /**
   * Send with idempotency key
   *
   * Uses the idempotency key as the deduplication ID to prevent duplicate processing.
   * SQS deduplicates messages with the same ID within a 5-minute window.
   */
  async sendIdempotent<T>(
    messageGroupId: string,
    idempotencyKey: string,
    body: T
  ): Promise<FifoMessage<T>> {
    return this.send(messageGroupId, body, { deduplicationId: idempotencyKey })
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    approximateMessages: number
    approximateMessagesNotVisible: number
    approximateMessagesDelayed: number
    isFifo: boolean
    contentBasedDeduplication: boolean
  }> {
    const result = await this.sqs.send(new GetQueueAttributesCommand({
      QueueUrl: this.queueUrl,
      AttributeNames: ['All'],
    }))

    return {
      approximateMessages: parseInt(result.Attributes?.ApproximateNumberOfMessages ?? '0'),
      approximateMessagesNotVisible: parseInt(result.Attributes?.ApproximateNumberOfMessagesNotVisible ?? '0'),
      approximateMessagesDelayed: parseInt(result.Attributes?.ApproximateNumberOfMessagesDelayed ?? '0'),
      isFifo: result.Attributes?.FifoQueue === 'true',
      contentBasedDeduplication: result.Attributes?.ContentBasedDeduplication === 'true',
    }
  }
}
