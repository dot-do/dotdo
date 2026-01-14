/**
 * @dotdo/sqs types
 *
 * @aws-sdk/client-sqs compatible type definitions
 * for the SQS SDK backed by in-memory storage
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sqs/
 */

// ============================================================================
// CLIENT CONFIGURATION
// ============================================================================

/**
 * AWS credentials
 */
export interface Credentials {
  /** AWS access key ID */
  accessKeyId: string
  /** AWS secret access key */
  secretAccessKey: string
  /** AWS session token (for temporary credentials) */
  sessionToken?: string
}

/**
 * SQS client configuration
 */
export interface SQSClientConfig {
  /** AWS region */
  region?: string
  /** AWS credentials */
  credentials?: Credentials | (() => Promise<Credentials>)
  /** Custom endpoint URL */
  endpoint?: string
  /** Maximum retry attempts */
  maxAttempts?: number
  /** Request timeout in milliseconds */
  requestTimeout?: number
}

/**
 * Extended SQS config for DO backing
 */
export interface ExtendedSQSClientConfig extends SQSClientConfig {
  /** DO namespace binding */
  doNamespace?: DurableObjectNamespace
  /** Cloudflare Queue binding (for production) */
  queueBinding?: Queue
}

// ============================================================================
// QUEUE ATTRIBUTES
// ============================================================================

/**
 * Queue attribute names
 */
export type QueueAttributeName =
  | 'All'
  | 'Policy'
  | 'VisibilityTimeout'
  | 'MaximumMessageSize'
  | 'MessageRetentionPeriod'
  | 'ApproximateNumberOfMessages'
  | 'ApproximateNumberOfMessagesNotVisible'
  | 'CreatedTimestamp'
  | 'LastModifiedTimestamp'
  | 'QueueArn'
  | 'ApproximateNumberOfMessagesDelayed'
  | 'DelaySeconds'
  | 'ReceiveMessageWaitTimeSeconds'
  | 'RedrivePolicy'
  | 'FifoQueue'
  | 'ContentBasedDeduplication'
  | 'KmsMasterKeyId'
  | 'KmsDataKeyReusePeriodSeconds'
  | 'DeduplicationScope'
  | 'FifoThroughputLimit'
  | 'RedriveAllowPolicy'
  | 'SqsManagedSseEnabled'

/**
 * Queue attributes map
 */
export type QueueAttributes = Partial<Record<QueueAttributeName, string>>

/**
 * Message system attribute names
 */
export type MessageSystemAttributeName =
  | 'SenderId'
  | 'SentTimestamp'
  | 'ApproximateReceiveCount'
  | 'ApproximateFirstReceiveTimestamp'
  | 'SequenceNumber'
  | 'MessageDeduplicationId'
  | 'MessageGroupId'
  | 'AWSTraceHeader'
  | 'DeadLetterQueueSourceArn'

/**
 * Message system attributes map
 */
export type MessageSystemAttributes = Partial<Record<MessageSystemAttributeName, string>>

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/**
 * Message attribute value
 */
export interface MessageAttributeValue {
  /** Data type (String, Number, Binary) */
  DataType: string
  /** String value (for String and Number types) */
  StringValue?: string
  /** Binary value */
  BinaryValue?: Uint8Array
}

/**
 * Message attributes map
 */
export type MessageAttributes = Record<string, MessageAttributeValue>

/**
 * Received message
 */
export interface Message {
  /** Message ID */
  MessageId?: string
  /** Receipt handle for deleting/changing visibility */
  ReceiptHandle?: string
  /** MD5 hash of message body */
  MD5OfBody?: string
  /** Message body */
  Body?: string
  /** Message attributes */
  Attributes?: MessageSystemAttributes
  /** MD5 hash of message attributes */
  MD5OfMessageAttributes?: string
  /** Custom message attributes */
  MessageAttributes?: MessageAttributes
}

/**
 * Batch entry for sending messages
 */
export interface SendMessageBatchRequestEntry {
  /** Unique ID for this entry */
  Id: string
  /** Message body */
  MessageBody: string
  /** Delay in seconds */
  DelaySeconds?: number
  /** Message attributes */
  MessageAttributes?: MessageAttributes
  /** Message system attributes for send */
  MessageSystemAttributes?: MessageAttributes
  /** Message deduplication ID (FIFO only) */
  MessageDeduplicationId?: string
  /** Message group ID (FIFO only) */
  MessageGroupId?: string
}

/**
 * Successful batch result entry
 */
export interface SendMessageBatchResultEntry {
  /** Entry ID */
  Id: string
  /** Message ID */
  MessageId: string
  /** MD5 hash of message body */
  MD5OfMessageBody: string
  /** MD5 hash of message attributes */
  MD5OfMessageAttributes?: string
  /** Sequence number (FIFO only) */
  SequenceNumber?: string
}

/**
 * Failed batch result entry
 */
export interface BatchResultErrorEntry {
  /** Entry ID */
  Id: string
  /** Whether the error is a sender fault */
  SenderFault: boolean
  /** Error code */
  Code: string
  /** Error message */
  Message?: string
}

/**
 * Delete message batch entry
 */
export interface DeleteMessageBatchRequestEntry {
  /** Entry ID */
  Id: string
  /** Receipt handle */
  ReceiptHandle: string
}

/**
 * Delete message batch result entry
 */
export interface DeleteMessageBatchResultEntry {
  /** Entry ID */
  Id: string
}

/**
 * Change message visibility batch entry
 */
export interface ChangeMessageVisibilityBatchRequestEntry {
  /** Entry ID */
  Id: string
  /** Receipt handle */
  ReceiptHandle: string
  /** New visibility timeout in seconds */
  VisibilityTimeout: number
}

/**
 * Change message visibility batch result entry
 */
export interface ChangeMessageVisibilityBatchResultEntry {
  /** Entry ID */
  Id: string
}

// ============================================================================
// COMMAND INPUTS
// ============================================================================

/**
 * CreateQueue input
 */
export interface CreateQueueCommandInput {
  /** Queue name */
  QueueName: string
  /** Queue attributes */
  Attributes?: QueueAttributes
  /** Tags for the queue */
  tags?: Record<string, string>
}

/**
 * DeleteQueue input
 */
export interface DeleteQueueCommandInput {
  /** Queue URL */
  QueueUrl: string
}

/**
 * ListQueues input
 */
export interface ListQueuesCommandInput {
  /** Queue name prefix filter */
  QueueNamePrefix?: string
  /** Maximum results */
  MaxResults?: number
  /** Pagination token */
  NextToken?: string
}

/**
 * GetQueueUrl input
 */
export interface GetQueueUrlCommandInput {
  /** Queue name */
  QueueName: string
  /** Queue owner AWS account ID */
  QueueOwnerAWSAccountId?: string
}

/**
 * GetQueueAttributes input
 */
export interface GetQueueAttributesCommandInput {
  /** Queue URL */
  QueueUrl: string
  /** Attribute names to retrieve */
  AttributeNames?: QueueAttributeName[]
}

/**
 * SetQueueAttributes input
 */
export interface SetQueueAttributesCommandInput {
  /** Queue URL */
  QueueUrl: string
  /** Attributes to set */
  Attributes: QueueAttributes
}

/**
 * SendMessage input
 */
export interface SendMessageCommandInput {
  /** Queue URL */
  QueueUrl: string
  /** Message body */
  MessageBody: string
  /** Delay in seconds (0-900) */
  DelaySeconds?: number
  /** Message attributes */
  MessageAttributes?: MessageAttributes
  /** Message system attributes */
  MessageSystemAttributes?: MessageAttributes
  /** Message deduplication ID (FIFO only) */
  MessageDeduplicationId?: string
  /** Message group ID (FIFO only) */
  MessageGroupId?: string
}

/**
 * SendMessageBatch input
 */
export interface SendMessageBatchCommandInput {
  /** Queue URL */
  QueueUrl: string
  /** Batch entries */
  Entries: SendMessageBatchRequestEntry[]
}

/**
 * ReceiveMessage input
 */
export interface ReceiveMessageCommandInput {
  /** Queue URL */
  QueueUrl: string
  /** Attribute names to return */
  AttributeNames?: MessageSystemAttributeName[]
  /** Message attribute names to return */
  MessageAttributeNames?: string[]
  /** Maximum messages (1-10) */
  MaxNumberOfMessages?: number
  /** Visibility timeout in seconds */
  VisibilityTimeout?: number
  /** Long polling wait time (0-20 seconds) */
  WaitTimeSeconds?: number
  /** Receive request attempt ID (FIFO only) */
  ReceiveRequestAttemptId?: string
}

/**
 * DeleteMessage input
 */
export interface DeleteMessageCommandInput {
  /** Queue URL */
  QueueUrl: string
  /** Receipt handle */
  ReceiptHandle: string
}

/**
 * DeleteMessageBatch input
 */
export interface DeleteMessageBatchCommandInput {
  /** Queue URL */
  QueueUrl: string
  /** Batch entries */
  Entries: DeleteMessageBatchRequestEntry[]
}

/**
 * ChangeMessageVisibility input
 */
export interface ChangeMessageVisibilityCommandInput {
  /** Queue URL */
  QueueUrl: string
  /** Receipt handle */
  ReceiptHandle: string
  /** New visibility timeout in seconds */
  VisibilityTimeout: number
}

/**
 * ChangeMessageVisibilityBatch input
 */
export interface ChangeMessageVisibilityBatchCommandInput {
  /** Queue URL */
  QueueUrl: string
  /** Batch entries */
  Entries: ChangeMessageVisibilityBatchRequestEntry[]
}

/**
 * PurgeQueue input
 */
export interface PurgeQueueCommandInput {
  /** Queue URL */
  QueueUrl: string
}

/**
 * TagQueue input
 */
export interface TagQueueCommandInput {
  /** Queue URL */
  QueueUrl: string
  /** Tags to add */
  Tags: Record<string, string>
}

/**
 * UntagQueue input
 */
export interface UntagQueueCommandInput {
  /** Queue URL */
  QueueUrl: string
  /** Tag keys to remove */
  TagKeys: string[]
}

/**
 * ListQueueTags input
 */
export interface ListQueueTagsCommandInput {
  /** Queue URL */
  QueueUrl: string
}

// ============================================================================
// COMMAND OUTPUTS
// ============================================================================

/**
 * CreateQueue output
 */
export interface CreateQueueCommandOutput {
  /** Queue URL */
  QueueUrl?: string
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * DeleteQueue output
 */
export interface DeleteQueueCommandOutput {
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * ListQueues output
 */
export interface ListQueuesCommandOutput {
  /** Queue URLs */
  QueueUrls?: string[]
  /** Pagination token */
  NextToken?: string
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * GetQueueUrl output
 */
export interface GetQueueUrlCommandOutput {
  /** Queue URL */
  QueueUrl?: string
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * GetQueueAttributes output
 */
export interface GetQueueAttributesCommandOutput {
  /** Queue attributes */
  Attributes?: QueueAttributes
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * SetQueueAttributes output
 */
export interface SetQueueAttributesCommandOutput {
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * SendMessage output
 */
export interface SendMessageCommandOutput {
  /** Message ID */
  MessageId?: string
  /** MD5 hash of message body */
  MD5OfMessageBody?: string
  /** MD5 hash of message attributes */
  MD5OfMessageAttributes?: string
  /** Sequence number (FIFO only) */
  SequenceNumber?: string
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * SendMessageBatch output
 */
export interface SendMessageBatchCommandOutput {
  /** Successful entries */
  Successful?: SendMessageBatchResultEntry[]
  /** Failed entries */
  Failed?: BatchResultErrorEntry[]
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * ReceiveMessage output
 */
export interface ReceiveMessageCommandOutput {
  /** Received messages */
  Messages?: Message[]
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * DeleteMessage output
 */
export interface DeleteMessageCommandOutput {
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * DeleteMessageBatch output
 */
export interface DeleteMessageBatchCommandOutput {
  /** Successful entries */
  Successful?: DeleteMessageBatchResultEntry[]
  /** Failed entries */
  Failed?: BatchResultErrorEntry[]
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * ChangeMessageVisibility output
 */
export interface ChangeMessageVisibilityCommandOutput {
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * ChangeMessageVisibilityBatch output
 */
export interface ChangeMessageVisibilityBatchCommandOutput {
  /** Successful entries */
  Successful?: ChangeMessageVisibilityBatchResultEntry[]
  /** Failed entries */
  Failed?: BatchResultErrorEntry[]
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * PurgeQueue output
 */
export interface PurgeQueueCommandOutput {
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * TagQueue output
 */
export interface TagQueueCommandOutput {
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * UntagQueue output
 */
export interface UntagQueueCommandOutput {
  /** Response metadata */
  $metadata: ResponseMetadata
}

/**
 * ListQueueTags output
 */
export interface ListQueueTagsCommandOutput {
  /** Tags */
  Tags?: Record<string, string>
  /** Response metadata */
  $metadata: ResponseMetadata
}

// ============================================================================
// METADATA TYPES
// ============================================================================

/**
 * Response metadata
 */
export interface ResponseMetadata {
  /** HTTP status code */
  httpStatusCode?: number
  /** Request ID */
  requestId?: string
  /** Extended request ID */
  extendedRequestId?: string
  /** Retry attempts */
  attempts?: number
  /** Total retry delay */
  totalRetryDelay?: number
}

// ============================================================================
// COMMAND INTERFACE
// ============================================================================

/**
 * Command interface for all SQS commands
 */
export interface Command<Input, Output> {
  /** Input for the command */
  input: Input
  /** Resolve the command middleware stack */
  resolveMiddleware: (
    clientStack: unknown,
    configuration: unknown,
    options: unknown
  ) => unknown
}
