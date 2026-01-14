/**
 * @dotdo/sqs
 *
 * @aws-sdk/client-sqs compatible SQS SDK backed by Durable Objects.
 * Drop-in replacement for the AWS SQS SDK v3 with edge-native implementation.
 *
 * Usage:
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
 *   MessageBody: 'Hello World',
 * }))
 *
 * // Receive messages
 * const { Messages } = await client.send(new ReceiveMessageCommand({
 *   QueueUrl,
 *   MaxNumberOfMessages: 10,
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
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sqs/
 */

// Export client and commands
export {
  SQSClient,
  CreateQueueCommand,
  DeleteQueueCommand,
  ListQueuesCommand,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
  ChangeMessageVisibilityCommand,
  ChangeMessageVisibilityBatchCommand,
  PurgeQueueCommand,
  TagQueueCommand,
  UntagQueueCommand,
  ListQueueTagsCommand,
  _clearAll,
  _getQueues,
} from './sqs'

// Export all errors
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
} from './sqs'

// Export all types
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
} from './types'
