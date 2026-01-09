/**
 * @dotdo/pubsub types
 *
 * @google-cloud/pubsub compatible type definitions
 * for the Pub/Sub SDK backed by Durable Objects
 *
 * @see https://cloud.google.com/pubsub/docs/reference/rest/v1/PubsubMessage
 */

// ============================================================================
// CLIENT CONFIGURATION
// ============================================================================

/**
 * Google Cloud credentials
 */
export interface Credentials {
  /** Service account email */
  client_email?: string
  /** Private key for authentication */
  private_key?: string
  /** Project ID */
  project_id?: string
}

/**
 * PubSub client configuration
 */
export interface PubSubConfig {
  /** GCP project ID */
  projectId?: string
  /** Google Cloud credentials */
  credentials?: Credentials
  /** Path to key file */
  keyFilename?: string
  /** Custom API endpoint */
  apiEndpoint?: string
  /** Email to impersonate */
  userEmail?: string
}

/**
 * Extended config for DO backing
 */
export interface ExtendedPubSubConfig extends PubSubConfig {
  /** DO namespace binding */
  doNamespace?: DurableObjectNamespace
}

// ============================================================================
// TOPIC TYPES
// ============================================================================

/**
 * Topic metadata
 */
export interface TopicMetadata {
  /** Full resource name */
  name: string
  /** Labels attached to the topic */
  labels?: Record<string, string>
  /** KMS key name for encryption */
  kmsKeyName?: string
  /** Message retention duration */
  messageRetentionDuration?: Duration
  /** Schema settings */
  schemaSettings?: SchemaSettings
  /** Message storage policy */
  messageStoragePolicy?: MessageStoragePolicy
}

/**
 * Topic creation options
 */
export interface CreateTopicOptions {
  /** Labels for the topic */
  labels?: Record<string, string>
  /** KMS key name */
  kmsKeyName?: string
  /** Message retention duration */
  messageRetentionDuration?: Duration
  /** Schema settings */
  schemaSettings?: SchemaSettings
  /** Google API call options */
  gaxOpts?: object
}

/**
 * Topic options
 */
export interface TopicOptions {
  /** Batching settings for publishing */
  batching?: BatchingOptions
  /** Whether to enable message ordering */
  enableMessageOrdering?: boolean
}

/**
 * Batching options for publishing
 */
export interface BatchingOptions {
  /** Maximum number of messages to batch */
  maxMessages?: number
  /** Maximum time to wait before publishing a batch */
  maxMilliseconds?: number
  /** Maximum size of a batch in bytes */
  maxBytes?: number
}

/**
 * Schema settings for a topic
 */
export interface SchemaSettings {
  /** Schema name */
  schema?: string
  /** Encoding for messages */
  encoding?: 'JSON' | 'BINARY'
}

/**
 * Message storage policy
 */
export interface MessageStoragePolicy {
  /** Allowed persistence regions */
  allowedPersistenceRegions?: string[]
}

// ============================================================================
// SUBSCRIPTION TYPES
// ============================================================================

/**
 * Subscription metadata
 */
export interface SubscriptionMetadata {
  /** Full resource name */
  name: string
  /** Topic this subscription is attached to */
  topic: string
  /** Acknowledgement deadline in seconds */
  ackDeadlineSeconds?: number
  /** Push configuration */
  pushConfig?: PushConfig
  /** Message retention duration */
  messageRetentionDuration?: Duration
  /** Labels */
  labels?: Record<string, string>
  /** Whether message ordering is enabled */
  enableMessageOrdering?: boolean
  /** Dead letter policy */
  deadLetterPolicy?: DeadLetterPolicy
  /** Retry policy */
  retryPolicy?: RetryPolicy
  /** Filter expression */
  filter?: string
  /** Expiration policy */
  expirationPolicy?: ExpirationPolicy
}

/**
 * Subscription creation options
 */
export interface CreateSubscriptionOptions {
  /** Acknowledgement deadline in seconds (10-600) */
  ackDeadlineSeconds?: number
  /** Push configuration */
  pushConfig?: PushConfig
  /** Message retention duration */
  messageRetentionDuration?: Duration
  /** Labels for the subscription */
  labels?: Record<string, string>
  /** Whether to enable message ordering */
  enableMessageOrdering?: boolean
  /** Dead letter policy */
  deadLetterPolicy?: DeadLetterPolicy
  /** Retry policy */
  retryPolicy?: RetryPolicy
  /** Filter expression for messages */
  filter?: string
  /** Expiration policy */
  expirationPolicy?: ExpirationPolicy
  /** Google API call options */
  gaxOpts?: object
}

/**
 * Subscription options
 */
export interface SubscriptionOptions {
  /** Flow control settings */
  flowControl?: FlowControlOptions
  /** Stream options */
  streamingOptions?: StreamingOptions
  /** Acknowledgement deadline in seconds */
  ackDeadline?: number
}

/**
 * Push configuration
 */
export interface PushConfig {
  /** Push endpoint URL */
  pushEndpoint?: string
  /** Push endpoint attributes */
  attributes?: Record<string, string>
  /** OIDC token */
  oidcToken?: OidcToken
}

/**
 * OIDC token for push authentication
 */
export interface OidcToken {
  /** Service account email */
  serviceAccountEmail?: string
  /** Audience for the token */
  audience?: string
}

/**
 * Dead letter policy
 */
export interface DeadLetterPolicy {
  /** Topic for dead letters */
  deadLetterTopic?: string
  /** Maximum delivery attempts before sending to dead letter */
  maxDeliveryAttempts?: number
}

/**
 * Retry policy
 */
export interface RetryPolicy {
  /** Minimum backoff duration */
  minimumBackoff?: Duration
  /** Maximum backoff duration */
  maximumBackoff?: Duration
}

/**
 * Expiration policy
 */
export interface ExpirationPolicy {
  /** TTL for the subscription */
  ttl?: Duration
}

/**
 * Flow control options
 */
export interface FlowControlOptions {
  /** Maximum number of messages to allow outstanding */
  maxMessages?: number
  /** Maximum bytes to allow outstanding */
  maxBytes?: number
  /** Whether to allow excess messages */
  allowExcessMessages?: boolean
}

/**
 * Streaming options
 */
export interface StreamingOptions {
  /** Maximum ack extension period */
  maxAckExtensionPeriodMinutes?: number
  /** Maximum outstanding messages */
  maxOutstandingMessages?: number
  /** Maximum outstanding bytes */
  maxOutstandingBytes?: number
}

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/**
 * Message to publish
 */
export interface PublishMessage {
  /** Message data as Buffer */
  data?: Buffer
  /** Message attributes */
  attributes?: Record<string, string>
  /** Ordering key for message ordering */
  orderingKey?: string
}

/**
 * Received message from subscription
 */
export interface ReceivedMessage {
  /** Message ID */
  id: string
  /** Acknowledgement ID */
  ackId: string
  /** Message data as Buffer */
  data: Buffer
  /** Message attributes */
  attributes: Record<string, string>
  /** Ordering key if present */
  orderingKey?: string
  /** Publish time */
  publishTime: Date
  /** Delivery attempt number */
  deliveryAttempt?: number
  /** Acknowledge the message */
  ack: () => void
  /** Negative acknowledge for redelivery */
  nack: () => void
  /** Modify the ack deadline */
  modifyAckDeadline: (seconds: number) => void
}

/**
 * Pull request options
 */
export interface PullOptions {
  /** Maximum number of messages to pull */
  maxMessages?: number
  /** Whether to return immediately if no messages */
  returnImmediately?: boolean
}

/**
 * Pull response
 */
export interface PullResponse {
  /** Received messages */
  receivedMessages?: ReceivedMessageWrapper[]
}

/**
 * Wrapper for received message in pull response
 */
export interface ReceivedMessageWrapper {
  /** Ack ID */
  ackId: string
  /** The message */
  message: PubSubMessage
  /** Delivery attempt */
  deliveryAttempt?: number
}

/**
 * Raw Pub/Sub message
 */
export interface PubSubMessage {
  /** Message data (base64 encoded) */
  data?: string
  /** Message attributes */
  attributes?: Record<string, string>
  /** Message ID */
  messageId?: string
  /** Publish timestamp */
  publishTime?: string
  /** Ordering key */
  orderingKey?: string
}

// ============================================================================
// DURATION TYPE
// ============================================================================

/**
 * Duration in seconds and nanos
 */
export interface Duration {
  /** Seconds */
  seconds?: number
  /** Nanoseconds */
  nanos?: number
}

// ============================================================================
// PAGINATION
// ============================================================================

/**
 * Page options for list operations
 */
export interface PageOptions {
  /** Maximum results per page */
  pageSize?: number
  /** Page token for pagination */
  pageToken?: string
  /** Auto-paginate all results */
  autoPaginate?: boolean
  /** Google API call options */
  gaxOpts?: object
}

/**
 * Get options
 */
export interface GetOptions {
  /** Whether to auto-create if not exists */
  autoCreate?: boolean
  /** Google API call options */
  gaxOpts?: object
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Base Pub/Sub error
 */
export class PubSubError extends Error {
  readonly code: number
  readonly details?: string

  constructor(message: string, code = 0, details?: string) {
    super(message)
    this.name = 'PubSubError'
    this.code = code
    this.details = details
  }
}

/**
 * Topic not found error
 */
export class TopicNotFoundError extends PubSubError {
  constructor(topicName?: string) {
    super(
      topicName ? `Topic ${topicName} not found.` : 'Topic not found.',
      5, // NOT_FOUND
      'TOPIC_NOT_FOUND'
    )
    this.name = 'TopicNotFoundError'
  }
}

/**
 * Subscription not found error
 */
export class SubscriptionNotFoundError extends PubSubError {
  constructor(subscriptionName?: string) {
    super(
      subscriptionName ? `Subscription ${subscriptionName} not found.` : 'Subscription not found.',
      5, // NOT_FOUND
      'SUBSCRIPTION_NOT_FOUND'
    )
    this.name = 'SubscriptionNotFoundError'
  }
}

/**
 * Topic already exists error
 */
export class TopicExistsError extends PubSubError {
  constructor(topicName?: string) {
    super(
      topicName ? `Topic ${topicName} already exists.` : 'Topic already exists.',
      6, // ALREADY_EXISTS
      'TOPIC_EXISTS'
    )
    this.name = 'TopicExistsError'
  }
}

/**
 * Subscription already exists error
 */
export class SubscriptionExistsError extends PubSubError {
  constructor(subscriptionName?: string) {
    super(
      subscriptionName ? `Subscription ${subscriptionName} already exists.` : 'Subscription already exists.',
      6, // ALREADY_EXISTS
      'SUBSCRIPTION_EXISTS'
    )
    this.name = 'SubscriptionExistsError'
  }
}

/**
 * Invalid message error
 */
export class InvalidMessageError extends PubSubError {
  constructor(message = 'Message data is required.') {
    super(message, 3, 'INVALID_MESSAGE') // INVALID_ARGUMENT
    this.name = 'InvalidMessageError'
  }
}

/**
 * Invalid ack deadline error
 */
export class AckDeadlineError extends PubSubError {
  constructor(message = 'Invalid ack deadline. Must be between 0 and 600 seconds.') {
    super(message, 3, 'INVALID_ACK_DEADLINE') // INVALID_ARGUMENT
    this.name = 'AckDeadlineError'
  }
}
