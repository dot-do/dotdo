/**
 * @dotdo/pubsub
 *
 * @google-cloud/pubsub compatible Pub/Sub SDK backed by Durable Objects.
 * Drop-in replacement for the Google Cloud Pub/Sub SDK with edge-native implementation.
 *
 * Usage:
 * ```typescript
 * import { PubSub } from '@dotdo/pubsub'
 *
 * const pubsub = new PubSub({ projectId: 'my-project' })
 *
 * // Create topic
 * const [topic] = await pubsub.createTopic('my-topic')
 *
 * // Publish
 * const messageId = await topic.publishMessage({
 *   data: Buffer.from('Hello'),
 *   attributes: { key: 'value' }
 * })
 *
 * // Create subscription
 * const [subscription] = await topic.createSubscription('my-sub')
 *
 * // Pull messages
 * const [messages] = await subscription.pull({ maxMessages: 10 })
 * messages.forEach(msg => {
 *   console.log(msg.data.toString())
 *   msg.ack()
 * })
 *
 * // Streaming pull
 * subscription.on('message', (message) => {
 *   console.log(message.data.toString())
 *   message.ack()
 * })
 *
 * // Delete
 * await subscription.delete()
 * await topic.delete()
 * ```
 *
 * @see https://cloud.google.com/pubsub/docs/reference/libraries
 */

// Export client and classes
export {
  PubSub,
  Topic,
  Subscription,
  Message,
  _clearAll,
  _getTopics,
  _getSubscriptions,
} from './pubsub'

// Export all errors
export {
  PubSubError,
  TopicNotFoundError,
  SubscriptionNotFoundError,
  TopicExistsError,
  SubscriptionExistsError,
  InvalidMessageError,
  AckDeadlineError,
} from './types'

// Export all types
export type {
  // Client config
  PubSubConfig,
  ExtendedPubSubConfig,
  Credentials,

  // Topic types
  TopicMetadata,
  CreateTopicOptions,
  TopicOptions,
  BatchingOptions,
  SchemaSettings,
  MessageStoragePolicy,

  // Subscription types
  SubscriptionMetadata,
  CreateSubscriptionOptions,
  SubscriptionOptions,
  PushConfig,
  OidcToken,
  DeadLetterPolicy,
  RetryPolicy,
  ExpirationPolicy,
  FlowControlOptions,
  StreamingOptions,

  // Message types
  PublishMessage,
  ReceivedMessage,
  PullOptions,
  PullResponse,
  ReceivedMessageWrapper,
  PubSubMessage,

  // Utility types
  Duration,
  PageOptions,
  GetOptions,
} from './types'
