/**
 * @dotdo/sqs - AWS SQS SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for @aws-sdk/client-sqs that runs on Cloudflare Workers
 * with in-memory storage backed by Durable Objects.
 *
 * Features:
 * - API-compatible with @aws-sdk/client-sqs v3
 * - Standard and FIFO queue support
 * - Message visibility timeouts
 * - Batch operations (send, delete, change visibility)
 * - Message attributes and system attributes
 * - Queue tagging
 * - MD5 hash verification
 *
 * @example
 * ```typescript
 * import {
 *   SQSClient,
 *   CreateQueueCommand,
 *   SendMessageCommand,
 *   ReceiveMessageCommand,
 *   DeleteMessageCommand,
 * } from '@dotdo/sqs'
 *
 * const client = new SQSClient({ region: 'us-east-1' })
 *
 * // Create a queue
 * const { QueueUrl } = await client.send(new CreateQueueCommand({
 *   QueueName: 'my-queue',
 * }))
 *
 * // Send a message
 * await client.send(new SendMessageCommand({
 *   QueueUrl,
 *   MessageBody: JSON.stringify({ event: 'user.created', userId: '123' }),
 * }))
 *
 * // Receive and process messages
 * const { Messages } = await client.send(new ReceiveMessageCommand({
 *   QueueUrl,
 *   MaxNumberOfMessages: 10,
 *   WaitTimeSeconds: 20, // Long polling
 * }))
 *
 * // Delete processed message
 * if (Messages?.[0]) {
 *   await client.send(new DeleteMessageCommand({
 *     QueueUrl,
 *     ReceiptHandle: Messages[0].ReceiptHandle!,
 *   }))
 * }
 * ```
 *
 * @example FIFO Queue
 * ```typescript
 * // Create FIFO queue
 * const { QueueUrl } = await client.send(new CreateQueueCommand({
 *   QueueName: 'orders.fifo',
 *   Attributes: {
 *     FifoQueue: 'true',
 *     ContentBasedDeduplication: 'true',
 *   },
 * }))
 *
 * // Send with message group ID for ordering
 * await client.send(new SendMessageCommand({
 *   QueueUrl,
 *   MessageBody: JSON.stringify({ orderId: '456' }),
 *   MessageGroupId: 'customer-123',
 * }))
 * ```
 *
 * @example Batch Operations
 * ```typescript
 * // Send batch of messages
 * const { Successful, Failed } = await client.send(new SendMessageBatchCommand({
 *   QueueUrl,
 *   Entries: [
 *     { Id: '1', MessageBody: 'First message' },
 *     { Id: '2', MessageBody: 'Second message', DelaySeconds: 10 },
 *     { Id: '3', MessageBody: 'Third message' },
 *   ],
 * }))
 *
 * // Delete batch of messages
 * await client.send(new DeleteMessageBatchCommand({
 *   QueueUrl,
 *   Entries: Messages.map((m, i) => ({
 *     Id: `${i}`,
 *     ReceiptHandle: m.ReceiptHandle!,
 *   })),
 * }))
 * ```
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sqs/
 */

// Re-export the full SQS implementation from streaming/compat/sqs
export {
  // Client
  SQSClient,

  // Queue Commands
  CreateQueueCommand,
  DeleteQueueCommand,
  ListQueuesCommand,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,

  // Message Commands
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
  ChangeMessageVisibilityCommand,
  ChangeMessageVisibilityBatchCommand,
  PurgeQueueCommand,

  // Tag Commands
  TagQueueCommand,
  UntagQueueCommand,
  ListQueueTagsCommand,

  // Errors
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

  // Test utilities
  _clearAll,
  _getQueues,
} from '../../streaming/compat/sqs'

// Re-export all types
export type {
  // Client config
  SQSClientConfig,
  ExtendedSQSClientConfig,
  Credentials,

  // Queue types
  QueueAttributeName,
  QueueAttributes,
  MessageSystemAttributeName,
  MessageSystemAttributes,

  // Message types
  Message,
  MessageAttributeValue,
  MessageAttributes,
  SendMessageBatchRequestEntry,
  SendMessageBatchResultEntry,
  BatchResultErrorEntry,
  DeleteMessageBatchRequestEntry,
  DeleteMessageBatchResultEntry,
  ChangeMessageVisibilityBatchRequestEntry,
  ChangeMessageVisibilityBatchResultEntry,

  // Command inputs
  CreateQueueCommandInput,
  DeleteQueueCommandInput,
  ListQueuesCommandInput,
  GetQueueUrlCommandInput,
  GetQueueAttributesCommandInput,
  SetQueueAttributesCommandInput,
  SendMessageCommandInput,
  SendMessageBatchCommandInput,
  ReceiveMessageCommandInput,
  DeleteMessageCommandInput,
  DeleteMessageBatchCommandInput,
  ChangeMessageVisibilityCommandInput,
  ChangeMessageVisibilityBatchCommandInput,
  PurgeQueueCommandInput,
  TagQueueCommandInput,
  UntagQueueCommandInput,
  ListQueueTagsCommandInput,

  // Command outputs
  CreateQueueCommandOutput,
  DeleteQueueCommandOutput,
  ListQueuesCommandOutput,
  GetQueueUrlCommandOutput,
  GetQueueAttributesCommandOutput,
  SetQueueAttributesCommandOutput,
  SendMessageCommandOutput,
  SendMessageBatchCommandOutput,
  ReceiveMessageCommandOutput,
  DeleteMessageCommandOutput,
  DeleteMessageBatchCommandOutput,
  ChangeMessageVisibilityCommandOutput,
  ChangeMessageVisibilityBatchCommandOutput,
  PurgeQueueCommandOutput,
  TagQueueCommandOutput,
  UntagQueueCommandOutput,
  ListQueueTagsCommandOutput,

  // Metadata
  ResponseMetadata,
  Command,
} from '../../streaming/compat/sqs'

// Default export for convenience
export { SQSClient as default } from '../../streaming/compat/sqs'
