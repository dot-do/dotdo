/**
 * @dotdo/sqs - SQS SDK compat
 *
 * Drop-in replacement for @aws-sdk/client-sqs backed by DO SQLite with in-memory storage.
 * This implementation matches the AWS SQS SDK v3 API.
 * Production version routes to Cloudflare Queues based on config.
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sqs/
 */
import type {
  SQSClientConfig,
  ExtendedSQSClientConfig,
  CreateQueueCommandInput,
  CreateQueueCommandOutput,
  DeleteQueueCommandInput,
  DeleteQueueCommandOutput,
  ListQueuesCommandInput,
  ListQueuesCommandOutput,
  GetQueueUrlCommandInput,
  GetQueueUrlCommandOutput,
  GetQueueAttributesCommandInput,
  GetQueueAttributesCommandOutput,
  SetQueueAttributesCommandInput,
  SetQueueAttributesCommandOutput,
  SendMessageCommandInput,
  SendMessageCommandOutput,
  SendMessageBatchCommandInput,
  SendMessageBatchCommandOutput,
  SendMessageBatchRequestEntry,
  SendMessageBatchResultEntry,
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput,
  DeleteMessageCommandInput,
  DeleteMessageCommandOutput,
  DeleteMessageBatchCommandInput,
  DeleteMessageBatchCommandOutput,
  DeleteMessageBatchResultEntry,
  ChangeMessageVisibilityCommandInput,
  ChangeMessageVisibilityCommandOutput,
  ChangeMessageVisibilityBatchCommandInput,
  ChangeMessageVisibilityBatchCommandOutput,
  ChangeMessageVisibilityBatchResultEntry,
  PurgeQueueCommandInput,
  PurgeQueueCommandOutput,
  TagQueueCommandInput,
  TagQueueCommandOutput,
  UntagQueueCommandInput,
  UntagQueueCommandOutput,
  ListQueueTagsCommandInput,
  ListQueueTagsCommandOutput,
  Message,
  QueueAttributes,
  MessageAttributes,
  BatchResultErrorEntry,
  ResponseMetadata,
} from './types'

import {
  QueueDoesNotExist,
  QueueNameExists,
  ReceiptHandleIsInvalid,
  MessageNotInflight,
  EmptyBatchRequest,
  TooManyEntriesInBatchRequest,
  BatchEntryIdsNotDistinct,
  InvalidMessageContents,
} from './types'

// Re-export errors
export {
  SQSServiceException,
  QueueDoesNotExist,
  QueueNameExists,
  InvalidAttributeName,
  InvalidAttributeValue,
  ReceiptHandleIsInvalid,
  MessageNotInflight,
  InvalidIdFormat,
  TooManyEntriesInBatchRequest,
  EmptyBatchRequest,
  BatchEntryIdsNotDistinct,
  PurgeQueueInProgress,
  InvalidBatchEntryId,
  InvalidMessageContents,
  OverLimit,
} from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

/**
 * Internal message structure with visibility tracking
 */
interface InternalMessage {
  messageId: string
  body: string
  md5OfBody: string
  attributes?: MessageAttributes
  md5OfAttributes?: string
  sentTimestamp: number
  approximateReceiveCount: number
  approximateFirstReceiveTimestamp?: number
  visibleAt: number
  receiptHandle?: string
  messageGroupId?: string
  messageDeduplicationId?: string
  sequenceNumber?: string
}

/**
 * Queue data structure
 */
interface QueueData {
  name: string
  url: string
  arn: string
  createdTimestamp: number
  lastModifiedTimestamp: number
  visibilityTimeout: number
  messageRetentionPeriod: number
  maximumMessageSize: number
  delaySeconds: number
  receiveMessageWaitTimeSeconds: number
  fifoQueue: boolean
  contentBasedDeduplication: boolean
  messages: Map<string, InternalMessage>
  deadLetterQueue?: string
  tags: Record<string, string>
  purgeInProgress: boolean
}

/**
 * Global in-memory storage for all queues
 */
const globalQueues = new Map<string, QueueData>()

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Generate message ID (UUID-like format)
 */
function generateMessageId(): string {
  const parts = [
    Math.random().toString(16).slice(2, 10),
    Math.random().toString(16).slice(2, 6),
    '4' + Math.random().toString(16).slice(2, 5),
    ((Math.random() * 4) | 8).toString(16) + Math.random().toString(16).slice(2, 5),
    Math.random().toString(16).slice(2, 14),
  ]
  return parts.join('-')
}

/**
 * Generate receipt handle
 */
function generateReceiptHandle(): string {
  const parts = []
  for (let i = 0; i < 4; i++) {
    parts.push(Math.random().toString(36).slice(2, 14))
  }
  return parts.join('')
}

/**
 * Simple MD5 hash (for compatibility, not cryptographically secure)
 */
function md5Hash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  // Convert to hex-like string
  const hex = Math.abs(hash).toString(16).padStart(8, '0')
  return hex.repeat(4)
}

/**
 * Create queue URL from name
 */
function createQueueUrl(queueName: string, region = 'us-east-1'): string {
  return `https://sqs.${region}.amazonaws.com/000000000000/${queueName}`
}

/**
 * Create queue ARN from name
 */
function createQueueArn(queueName: string, region = 'us-east-1'): string {
  return `arn:aws:sqs:${region}:000000000000:${queueName}`
}

/**
 * Extract queue name from URL
 */
function getQueueNameFromUrl(queueUrl: string): string | undefined {
  const parts = queueUrl.split('/')
  return parts[parts.length - 1]
}

/**
 * Get queue by URL
 */
function getQueueByUrl(queueUrl: string): QueueData | undefined {
  for (const [, queue] of globalQueues) {
    if (queue.url === queueUrl) {
      return queue
    }
  }
  return undefined
}

/**
 * Create default response metadata
 */
function createMetadata(): ResponseMetadata {
  return {
    httpStatusCode: 200,
    requestId: generateId(),
    attempts: 1,
    totalRetryDelay: 0,
  }
}

// ============================================================================
// COMMAND CLASSES
// ============================================================================

/**
 * CreateQueue command
 */
export class CreateQueueCommand {
  readonly input: CreateQueueCommandInput

  constructor(input: CreateQueueCommandInput) {
    this.input = input
  }
}

/**
 * DeleteQueue command
 */
export class DeleteQueueCommand {
  readonly input: DeleteQueueCommandInput

  constructor(input: DeleteQueueCommandInput) {
    this.input = input
  }
}

/**
 * ListQueues command
 */
export class ListQueuesCommand {
  readonly input: ListQueuesCommandInput

  constructor(input: ListQueuesCommandInput = {}) {
    this.input = input
  }
}

/**
 * GetQueueUrl command
 */
export class GetQueueUrlCommand {
  readonly input: GetQueueUrlCommandInput

  constructor(input: GetQueueUrlCommandInput) {
    this.input = input
  }
}

/**
 * GetQueueAttributes command
 */
export class GetQueueAttributesCommand {
  readonly input: GetQueueAttributesCommandInput

  constructor(input: GetQueueAttributesCommandInput) {
    this.input = input
  }
}

/**
 * SetQueueAttributes command
 */
export class SetQueueAttributesCommand {
  readonly input: SetQueueAttributesCommandInput

  constructor(input: SetQueueAttributesCommandInput) {
    this.input = input
  }
}

/**
 * SendMessage command
 */
export class SendMessageCommand {
  readonly input: SendMessageCommandInput

  constructor(input: SendMessageCommandInput) {
    this.input = input
  }
}

/**
 * SendMessageBatch command
 */
export class SendMessageBatchCommand {
  readonly input: SendMessageBatchCommandInput

  constructor(input: SendMessageBatchCommandInput) {
    this.input = input
  }
}

/**
 * ReceiveMessage command
 */
export class ReceiveMessageCommand {
  readonly input: ReceiveMessageCommandInput

  constructor(input: ReceiveMessageCommandInput) {
    this.input = input
  }
}

/**
 * DeleteMessage command
 */
export class DeleteMessageCommand {
  readonly input: DeleteMessageCommandInput

  constructor(input: DeleteMessageCommandInput) {
    this.input = input
  }
}

/**
 * DeleteMessageBatch command
 */
export class DeleteMessageBatchCommand {
  readonly input: DeleteMessageBatchCommandInput

  constructor(input: DeleteMessageBatchCommandInput) {
    this.input = input
  }
}

/**
 * ChangeMessageVisibility command
 */
export class ChangeMessageVisibilityCommand {
  readonly input: ChangeMessageVisibilityCommandInput

  constructor(input: ChangeMessageVisibilityCommandInput) {
    this.input = input
  }
}

/**
 * ChangeMessageVisibilityBatch command
 */
export class ChangeMessageVisibilityBatchCommand {
  readonly input: ChangeMessageVisibilityBatchCommandInput

  constructor(input: ChangeMessageVisibilityBatchCommandInput) {
    this.input = input
  }
}

/**
 * PurgeQueue command
 */
export class PurgeQueueCommand {
  readonly input: PurgeQueueCommandInput

  constructor(input: PurgeQueueCommandInput) {
    this.input = input
  }
}

/**
 * TagQueue command
 */
export class TagQueueCommand {
  readonly input: TagQueueCommandInput

  constructor(input: TagQueueCommandInput) {
    this.input = input
  }
}

/**
 * UntagQueue command
 */
export class UntagQueueCommand {
  readonly input: UntagQueueCommandInput

  constructor(input: UntagQueueCommandInput) {
    this.input = input
  }
}

/**
 * ListQueueTags command
 */
export class ListQueueTagsCommand {
  readonly input: ListQueueTagsCommandInput

  constructor(input: ListQueueTagsCommandInput) {
    this.input = input
  }
}

// ============================================================================
// COMMAND TYPES UNION
// ============================================================================

type SQSCommand =
  | CreateQueueCommand
  | DeleteQueueCommand
  | ListQueuesCommand
  | GetQueueUrlCommand
  | GetQueueAttributesCommand
  | SetQueueAttributesCommand
  | SendMessageCommand
  | SendMessageBatchCommand
  | ReceiveMessageCommand
  | DeleteMessageCommand
  | DeleteMessageBatchCommand
  | ChangeMessageVisibilityCommand
  | ChangeMessageVisibilityBatchCommand
  | PurgeQueueCommand
  | TagQueueCommand
  | UntagQueueCommand
  | ListQueueTagsCommand

// ============================================================================
// SQS CLIENT IMPLEMENTATION
// ============================================================================

/**
 * SQS Client
 * @aws-sdk/client-sqs compatible API backed by in-memory storage
 */
export class SQSClient {
  readonly config: ExtendedSQSClientConfig
  private _region: string

  constructor(config: SQSClientConfig | ExtendedSQSClientConfig = {}) {
    this.config = config as ExtendedSQSClientConfig
    this._region = config.region ?? 'us-east-1'
  }

  /**
   * Send a command to SQS
   */
  async send<Input, Output>(command: SQSCommand): Promise<Output> {
    if (command instanceof CreateQueueCommand) {
      return this._createQueue(command.input) as unknown as Output
    }
    if (command instanceof DeleteQueueCommand) {
      return this._deleteQueue(command.input) as unknown as Output
    }
    if (command instanceof ListQueuesCommand) {
      return this._listQueues(command.input) as unknown as Output
    }
    if (command instanceof GetQueueUrlCommand) {
      return this._getQueueUrl(command.input) as unknown as Output
    }
    if (command instanceof GetQueueAttributesCommand) {
      return this._getQueueAttributes(command.input) as unknown as Output
    }
    if (command instanceof SetQueueAttributesCommand) {
      return this._setQueueAttributes(command.input) as unknown as Output
    }
    if (command instanceof SendMessageCommand) {
      return this._sendMessage(command.input) as unknown as Output
    }
    if (command instanceof SendMessageBatchCommand) {
      return this._sendMessageBatch(command.input) as unknown as Output
    }
    if (command instanceof ReceiveMessageCommand) {
      return this._receiveMessage(command.input) as unknown as Output
    }
    if (command instanceof DeleteMessageCommand) {
      return this._deleteMessage(command.input) as unknown as Output
    }
    if (command instanceof DeleteMessageBatchCommand) {
      return this._deleteMessageBatch(command.input) as unknown as Output
    }
    if (command instanceof ChangeMessageVisibilityCommand) {
      return this._changeMessageVisibility(command.input) as unknown as Output
    }
    if (command instanceof ChangeMessageVisibilityBatchCommand) {
      return this._changeMessageVisibilityBatch(command.input) as unknown as Output
    }
    if (command instanceof PurgeQueueCommand) {
      return this._purgeQueue(command.input) as unknown as Output
    }
    if (command instanceof TagQueueCommand) {
      return this._tagQueue(command.input) as unknown as Output
    }
    if (command instanceof UntagQueueCommand) {
      return this._untagQueue(command.input) as unknown as Output
    }
    if (command instanceof ListQueueTagsCommand) {
      return this._listQueueTags(command.input) as unknown as Output
    }

    throw new Error(`Unknown command: ${command.constructor.name}`)
  }

  /**
   * Destroy client (cleanup)
   */
  destroy(): void {
    // No-op for in-memory implementation
  }

  // ==========================================================================
  // QUEUE OPERATIONS
  // ==========================================================================

  private async _createQueue(input: CreateQueueCommandInput): Promise<CreateQueueCommandOutput> {
    const { QueueName, Attributes = {}, tags = {} } = input

    // Check if queue already exists
    if (globalQueues.has(QueueName)) {
      throw new QueueNameExists()
    }

    const now = Date.now()
    const isFifo = QueueName.endsWith('.fifo') || Attributes.FifoQueue === 'true'

    const queue: QueueData = {
      name: QueueName,
      url: createQueueUrl(QueueName, this._region),
      arn: createQueueArn(QueueName, this._region),
      createdTimestamp: now,
      lastModifiedTimestamp: now,
      visibilityTimeout: parseInt(Attributes.VisibilityTimeout ?? '30'),
      messageRetentionPeriod: parseInt(Attributes.MessageRetentionPeriod ?? '345600'),
      maximumMessageSize: parseInt(Attributes.MaximumMessageSize ?? '262144'),
      delaySeconds: parseInt(Attributes.DelaySeconds ?? '0'),
      receiveMessageWaitTimeSeconds: parseInt(Attributes.ReceiveMessageWaitTimeSeconds ?? '0'),
      fifoQueue: isFifo,
      contentBasedDeduplication: Attributes.ContentBasedDeduplication === 'true',
      messages: new Map(),
      deadLetterQueue: Attributes.RedrivePolicy
        ? JSON.parse(Attributes.RedrivePolicy).deadLetterTargetArn
        : undefined,
      tags,
      purgeInProgress: false,
    }

    globalQueues.set(QueueName, queue)

    return {
      QueueUrl: queue.url,
      $metadata: createMetadata(),
    }
  }

  private async _deleteQueue(input: DeleteQueueCommandInput): Promise<DeleteQueueCommandOutput> {
    const { QueueUrl } = input

    const queue = getQueueByUrl(QueueUrl)
    if (!queue) {
      throw new QueueDoesNotExist()
    }

    globalQueues.delete(queue.name)

    return {
      $metadata: createMetadata(),
    }
  }

  private async _listQueues(input: ListQueuesCommandInput): Promise<ListQueuesCommandOutput> {
    const { QueueNamePrefix, MaxResults = 1000 } = input

    let urls: string[] = []

    for (const [name, queue] of globalQueues) {
      if (!QueueNamePrefix || name.startsWith(QueueNamePrefix)) {
        urls.push(queue.url)
      }
    }

    // Apply limit
    if (urls.length > MaxResults) {
      urls = urls.slice(0, MaxResults)
    }

    return {
      QueueUrls: urls.length > 0 ? urls : undefined,
      $metadata: createMetadata(),
    }
  }

  private async _getQueueUrl(input: GetQueueUrlCommandInput): Promise<GetQueueUrlCommandOutput> {
    const { QueueName } = input

    const queue = globalQueues.get(QueueName)
    if (!queue) {
      throw new QueueDoesNotExist()
    }

    return {
      QueueUrl: queue.url,
      $metadata: createMetadata(),
    }
  }

  private async _getQueueAttributes(input: GetQueueAttributesCommandInput): Promise<GetQueueAttributesCommandOutput> {
    const { QueueUrl, AttributeNames = [] } = input

    const queue = getQueueByUrl(QueueUrl)
    if (!queue) {
      throw new QueueDoesNotExist()
    }

    const getAll = AttributeNames.includes('All') || AttributeNames.length === 0

    // Count messages in different states
    const now = Date.now()
    let approximateNumberOfMessages = 0
    let approximateNumberOfMessagesNotVisible = 0
    let approximateNumberOfMessagesDelayed = 0

    for (const [, msg] of queue.messages) {
      if (msg.visibleAt > now) {
        if (msg.approximateReceiveCount === 0) {
          approximateNumberOfMessagesDelayed++
        } else {
          approximateNumberOfMessagesNotVisible++
        }
      } else {
        approximateNumberOfMessages++
      }
    }

    const allAttributes: QueueAttributes = {
      QueueArn: queue.arn,
      ApproximateNumberOfMessages: approximateNumberOfMessages.toString(),
      ApproximateNumberOfMessagesNotVisible: approximateNumberOfMessagesNotVisible.toString(),
      ApproximateNumberOfMessagesDelayed: approximateNumberOfMessagesDelayed.toString(),
      CreatedTimestamp: Math.floor(queue.createdTimestamp / 1000).toString(),
      LastModifiedTimestamp: Math.floor(queue.lastModifiedTimestamp / 1000).toString(),
      VisibilityTimeout: queue.visibilityTimeout.toString(),
      MaximumMessageSize: queue.maximumMessageSize.toString(),
      MessageRetentionPeriod: queue.messageRetentionPeriod.toString(),
      DelaySeconds: queue.delaySeconds.toString(),
      ReceiveMessageWaitTimeSeconds: queue.receiveMessageWaitTimeSeconds.toString(),
      FifoQueue: queue.fifoQueue.toString(),
      ContentBasedDeduplication: queue.contentBasedDeduplication.toString(),
    }

    let attributes: QueueAttributes

    if (getAll) {
      attributes = allAttributes
    } else {
      attributes = {}
      for (const name of AttributeNames) {
        if (name in allAttributes) {
          attributes[name] = allAttributes[name]
        }
      }
    }

    return {
      Attributes: attributes,
      $metadata: createMetadata(),
    }
  }

  private async _setQueueAttributes(input: SetQueueAttributesCommandInput): Promise<SetQueueAttributesCommandOutput> {
    const { QueueUrl, Attributes } = input

    const queue = getQueueByUrl(QueueUrl)
    if (!queue) {
      throw new QueueDoesNotExist()
    }

    // Update attributes
    if (Attributes.VisibilityTimeout !== undefined) {
      queue.visibilityTimeout = parseInt(Attributes.VisibilityTimeout)
    }
    if (Attributes.MessageRetentionPeriod !== undefined) {
      queue.messageRetentionPeriod = parseInt(Attributes.MessageRetentionPeriod)
    }
    if (Attributes.MaximumMessageSize !== undefined) {
      queue.maximumMessageSize = parseInt(Attributes.MaximumMessageSize)
    }
    if (Attributes.DelaySeconds !== undefined) {
      queue.delaySeconds = parseInt(Attributes.DelaySeconds)
    }
    if (Attributes.ReceiveMessageWaitTimeSeconds !== undefined) {
      queue.receiveMessageWaitTimeSeconds = parseInt(Attributes.ReceiveMessageWaitTimeSeconds)
    }
    if (Attributes.RedrivePolicy !== undefined) {
      queue.deadLetterQueue = JSON.parse(Attributes.RedrivePolicy).deadLetterTargetArn
    }

    queue.lastModifiedTimestamp = Date.now()

    return {
      $metadata: createMetadata(),
    }
  }

  // ==========================================================================
  // MESSAGE OPERATIONS
  // ==========================================================================

  private async _sendMessage(input: SendMessageCommandInput): Promise<SendMessageCommandOutput> {
    const {
      QueueUrl,
      MessageBody,
      DelaySeconds,
      MessageAttributes,
      MessageDeduplicationId,
      MessageGroupId,
    } = input

    const queue = getQueueByUrl(QueueUrl)
    if (!queue) {
      throw new QueueDoesNotExist()
    }

    // Validate message body size
    if (MessageBody.length > queue.maximumMessageSize) {
      throw new InvalidMessageContents(`Message body is too long (max ${queue.maximumMessageSize} bytes)`)
    }

    const now = Date.now()
    const delay = DelaySeconds ?? queue.delaySeconds
    const messageId = generateMessageId()
    const md5OfBody = md5Hash(MessageBody)
    const md5OfAttributes = MessageAttributes ? md5Hash(JSON.stringify(MessageAttributes)) : undefined

    const message: InternalMessage = {
      messageId,
      body: MessageBody,
      md5OfBody,
      attributes: MessageAttributes,
      md5OfAttributes,
      sentTimestamp: now,
      approximateReceiveCount: 0,
      visibleAt: now + delay * 1000,
      messageGroupId: MessageGroupId,
      messageDeduplicationId: MessageDeduplicationId,
      sequenceNumber: queue.fifoQueue ? now.toString() : undefined,
    }

    queue.messages.set(messageId, message)

    return {
      MessageId: messageId,
      MD5OfMessageBody: md5OfBody,
      MD5OfMessageAttributes: md5OfAttributes,
      SequenceNumber: message.sequenceNumber,
      $metadata: createMetadata(),
    }
  }

  private async _sendMessageBatch(input: SendMessageBatchCommandInput): Promise<SendMessageBatchCommandOutput> {
    const { QueueUrl, Entries } = input

    if (!Entries || Entries.length === 0) {
      throw new EmptyBatchRequest()
    }

    if (Entries.length > 10) {
      throw new TooManyEntriesInBatchRequest()
    }

    // Check for duplicate IDs
    const ids = new Set<string>()
    for (const entry of Entries) {
      if (ids.has(entry.Id)) {
        throw new BatchEntryIdsNotDistinct()
      }
      ids.add(entry.Id)
    }

    const successful: SendMessageBatchResultEntry[] = []
    const failed: BatchResultErrorEntry[] = []

    for (const entry of Entries) {
      try {
        const result = await this._sendMessage({
          QueueUrl,
          MessageBody: entry.MessageBody,
          DelaySeconds: entry.DelaySeconds,
          MessageAttributes: entry.MessageAttributes,
          MessageDeduplicationId: entry.MessageDeduplicationId,
          MessageGroupId: entry.MessageGroupId,
        })

        successful.push({
          Id: entry.Id,
          MessageId: result.MessageId!,
          MD5OfMessageBody: result.MD5OfMessageBody!,
          MD5OfMessageAttributes: result.MD5OfMessageAttributes,
          SequenceNumber: result.SequenceNumber,
        })
      } catch (error) {
        failed.push({
          Id: entry.Id,
          SenderFault: true,
          Code: error instanceof Error ? error.name : 'UnknownError',
          Message: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return {
      Successful: successful.length > 0 ? successful : undefined,
      Failed: failed.length > 0 ? failed : undefined,
      $metadata: createMetadata(),
    }
  }

  private async _receiveMessage(input: ReceiveMessageCommandInput): Promise<ReceiveMessageCommandOutput> {
    const {
      QueueUrl,
      AttributeNames = [],
      MessageAttributeNames = [],
      MaxNumberOfMessages = 1,
      VisibilityTimeout,
      WaitTimeSeconds,
    } = input

    const queue = getQueueByUrl(QueueUrl)
    if (!queue) {
      throw new QueueDoesNotExist()
    }

    const now = Date.now()
    const visibilityTimeout = VisibilityTimeout ?? queue.visibilityTimeout
    const maxMessages = Math.min(MaxNumberOfMessages, 10)

    // Long polling simulation
    const waitTime = WaitTimeSeconds ?? queue.receiveMessageWaitTimeSeconds
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, Math.min(waitTime * 100, 2000)))
    }

    const messages: Message[] = []

    for (const [messageId, internalMsg] of queue.messages) {
      if (messages.length >= maxMessages) break

      // Check if message is visible
      if (internalMsg.visibleAt <= now) {
        // Update message state
        internalMsg.approximateReceiveCount++
        if (!internalMsg.approximateFirstReceiveTimestamp) {
          internalMsg.approximateFirstReceiveTimestamp = now
        }
        internalMsg.receiptHandle = generateReceiptHandle()
        internalMsg.visibleAt = now + visibilityTimeout * 1000

        // Build response message
        const msg: Message = {
          MessageId: messageId,
          ReceiptHandle: internalMsg.receiptHandle,
          MD5OfBody: internalMsg.md5OfBody,
          Body: internalMsg.body,
        }

        // Include system attributes if requested
        if (AttributeNames.length > 0 || AttributeNames.includes('All')) {
          msg.Attributes = {
            SenderId: '000000000000',
            SentTimestamp: internalMsg.sentTimestamp.toString(),
            ApproximateReceiveCount: internalMsg.approximateReceiveCount.toString(),
            ApproximateFirstReceiveTimestamp: internalMsg.approximateFirstReceiveTimestamp?.toString(),
          }
          if (internalMsg.sequenceNumber) {
            msg.Attributes.SequenceNumber = internalMsg.sequenceNumber
          }
          if (internalMsg.messageGroupId) {
            msg.Attributes.MessageGroupId = internalMsg.messageGroupId
          }
          if (internalMsg.messageDeduplicationId) {
            msg.Attributes.MessageDeduplicationId = internalMsg.messageDeduplicationId
          }
        }

        // Include message attributes if requested
        if (internalMsg.attributes && (MessageAttributeNames.includes('All') || MessageAttributeNames.length > 0)) {
          msg.MD5OfMessageAttributes = internalMsg.md5OfAttributes
          if (MessageAttributeNames.includes('All')) {
            msg.MessageAttributes = internalMsg.attributes
          } else {
            msg.MessageAttributes = {}
            for (const name of MessageAttributeNames) {
              if (internalMsg.attributes[name]) {
                msg.MessageAttributes[name] = internalMsg.attributes[name]
              }
            }
          }
        }

        messages.push(msg)
      }
    }

    return {
      Messages: messages.length > 0 ? messages : undefined,
      $metadata: createMetadata(),
    }
  }

  private async _deleteMessage(input: DeleteMessageCommandInput): Promise<DeleteMessageCommandOutput> {
    const { QueueUrl, ReceiptHandle } = input

    const queue = getQueueByUrl(QueueUrl)
    if (!queue) {
      throw new QueueDoesNotExist()
    }

    // Find message by receipt handle
    let found = false
    for (const [messageId, msg] of queue.messages) {
      if (msg.receiptHandle === ReceiptHandle) {
        queue.messages.delete(messageId)
        found = true
        break
      }
    }

    if (!found) {
      throw new ReceiptHandleIsInvalid()
    }

    return {
      $metadata: createMetadata(),
    }
  }

  private async _deleteMessageBatch(input: DeleteMessageBatchCommandInput): Promise<DeleteMessageBatchCommandOutput> {
    const { QueueUrl, Entries } = input

    if (!Entries || Entries.length === 0) {
      throw new EmptyBatchRequest()
    }

    if (Entries.length > 10) {
      throw new TooManyEntriesInBatchRequest()
    }

    // Check for duplicate IDs
    const ids = new Set<string>()
    for (const entry of Entries) {
      if (ids.has(entry.Id)) {
        throw new BatchEntryIdsNotDistinct()
      }
      ids.add(entry.Id)
    }

    const successful: DeleteMessageBatchResultEntry[] = []
    const failed: BatchResultErrorEntry[] = []

    for (const entry of Entries) {
      try {
        await this._deleteMessage({
          QueueUrl,
          ReceiptHandle: entry.ReceiptHandle,
        })
        successful.push({ Id: entry.Id })
      } catch (error) {
        failed.push({
          Id: entry.Id,
          SenderFault: true,
          Code: error instanceof Error ? error.name : 'UnknownError',
          Message: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return {
      Successful: successful.length > 0 ? successful : undefined,
      Failed: failed.length > 0 ? failed : undefined,
      $metadata: createMetadata(),
    }
  }

  private async _changeMessageVisibility(input: ChangeMessageVisibilityCommandInput): Promise<ChangeMessageVisibilityCommandOutput> {
    const { QueueUrl, ReceiptHandle, VisibilityTimeout } = input

    const queue = getQueueByUrl(QueueUrl)
    if (!queue) {
      throw new QueueDoesNotExist()
    }

    // Find message by receipt handle
    let found = false
    for (const [, msg] of queue.messages) {
      if (msg.receiptHandle === ReceiptHandle) {
        // Check if message is still in flight
        const now = Date.now()
        if (msg.visibleAt < now) {
          throw new MessageNotInflight()
        }

        msg.visibleAt = now + VisibilityTimeout * 1000
        found = true
        break
      }
    }

    if (!found) {
      throw new ReceiptHandleIsInvalid()
    }

    return {
      $metadata: createMetadata(),
    }
  }

  private async _changeMessageVisibilityBatch(input: ChangeMessageVisibilityBatchCommandInput): Promise<ChangeMessageVisibilityBatchCommandOutput> {
    const { QueueUrl, Entries } = input

    if (!Entries || Entries.length === 0) {
      throw new EmptyBatchRequest()
    }

    if (Entries.length > 10) {
      throw new TooManyEntriesInBatchRequest()
    }

    // Check for duplicate IDs
    const ids = new Set<string>()
    for (const entry of Entries) {
      if (ids.has(entry.Id)) {
        throw new BatchEntryIdsNotDistinct()
      }
      ids.add(entry.Id)
    }

    const successful: ChangeMessageVisibilityBatchResultEntry[] = []
    const failed: BatchResultErrorEntry[] = []

    for (const entry of Entries) {
      try {
        await this._changeMessageVisibility({
          QueueUrl,
          ReceiptHandle: entry.ReceiptHandle,
          VisibilityTimeout: entry.VisibilityTimeout,
        })
        successful.push({ Id: entry.Id })
      } catch (error) {
        failed.push({
          Id: entry.Id,
          SenderFault: true,
          Code: error instanceof Error ? error.name : 'UnknownError',
          Message: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return {
      Successful: successful.length > 0 ? successful : undefined,
      Failed: failed.length > 0 ? failed : undefined,
      $metadata: createMetadata(),
    }
  }

  private async _purgeQueue(input: PurgeQueueCommandInput): Promise<PurgeQueueCommandOutput> {
    const { QueueUrl } = input

    const queue = getQueueByUrl(QueueUrl)
    if (!queue) {
      throw new QueueDoesNotExist()
    }

    // Clear all messages
    queue.messages.clear()

    return {
      $metadata: createMetadata(),
    }
  }

  // ==========================================================================
  // TAG OPERATIONS
  // ==========================================================================

  private async _tagQueue(input: TagQueueCommandInput): Promise<TagQueueCommandOutput> {
    const { QueueUrl, Tags } = input

    const queue = getQueueByUrl(QueueUrl)
    if (!queue) {
      throw new QueueDoesNotExist()
    }

    Object.assign(queue.tags, Tags)

    return {
      $metadata: createMetadata(),
    }
  }

  private async _untagQueue(input: UntagQueueCommandInput): Promise<UntagQueueCommandOutput> {
    const { QueueUrl, TagKeys } = input

    const queue = getQueueByUrl(QueueUrl)
    if (!queue) {
      throw new QueueDoesNotExist()
    }

    for (const key of TagKeys) {
      delete queue.tags[key]
    }

    return {
      $metadata: createMetadata(),
    }
  }

  private async _listQueueTags(input: ListQueueTagsCommandInput): Promise<ListQueueTagsCommandOutput> {
    const { QueueUrl } = input

    const queue = getQueueByUrl(QueueUrl)
    if (!queue) {
      throw new QueueDoesNotExist()
    }

    return {
      Tags: Object.keys(queue.tags).length > 0 ? { ...queue.tags } : undefined,
      $metadata: createMetadata(),
    }
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Clear all in-memory data (for testing)
 */
export function _clearAll(): void {
  globalQueues.clear()
}

/**
 * Get all queues (for testing/debugging)
 */
export function _getQueues(): Map<string, QueueData> {
  return globalQueues
}
