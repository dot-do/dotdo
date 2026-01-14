/**
 * @dotdo/pubsub - Google Cloud Pub/Sub SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for @google-cloud/pubsub backed by Durable Objects.
 * This implementation matches the Google Cloud Pub/Sub JavaScript API.
 *
 * @example
 * ```typescript
 * import { PubSub } from '@dotdo/pubsub'
 *
 * const pubsub = new PubSub({ projectId: 'my-project' })
 *
 * // Create a topic
 * const [topic] = await pubsub.createTopic('my-topic')
 *
 * // Or get existing topic
 * const existingTopic = pubsub.topic('my-topic')
 *
 * // Publish a message
 * const messageId = await topic.publishMessage({
 *   data: Buffer.from('Hello, World!'),
 *   attributes: {
 *     key: 'value',
 *     priority: 'high',
 *   },
 * })
 * console.log(`Message ${messageId} published`)
 *
 * // Publish JSON (auto-serialized)
 * await topic.publishMessage({
 *   json: { event: 'user.created', userId: '123' },
 * })
 *
 * // Batch publish
 * const messageIds = await Promise.all([
 *   topic.publishMessage({ data: Buffer.from('Message 1') }),
 *   topic.publishMessage({ data: Buffer.from('Message 2') }),
 *   topic.publishMessage({ data: Buffer.from('Message 3') }),
 * ])
 *
 * // Create a subscription
 * const [subscription] = await topic.createSubscription('my-subscription', {
 *   ackDeadlineSeconds: 60,
 *   messageRetentionDuration: { seconds: 604800 }, // 7 days
 *   retryPolicy: {
 *     minimumBackoff: { seconds: 10 },
 *     maximumBackoff: { seconds: 600 },
 *   },
 * })
 *
 * // Or get existing subscription
 * const existingSub = pubsub.subscription('my-subscription')
 *
 * // Pull messages (synchronous pull)
 * const [messages] = await subscription.pull({ maxMessages: 10 })
 * for (const message of messages) {
 *   console.log('Received:', message.data.toString())
 *   console.log('Attributes:', message.attributes)
 *   console.log('ID:', message.id)
 *   console.log('Published:', message.publishTime)
 *
 *   // Acknowledge the message
 *   message.ack()
 *
 *   // Or negative acknowledge to retry
 *   // message.nack()
 * }
 *
 * // Streaming pull (push-style consumer)
 * subscription.on('message', (message) => {
 *   console.log('Received:', message.data.toString())
 *   message.ack()
 * })
 *
 * subscription.on('error', (error) => {
 *   console.error('Subscription error:', error)
 * })
 *
 * // With flow control
 * subscription.setOptions({
 *   flowControl: {
 *     maxMessages: 100,
 *     maxExtensionMinutes: 10,
 *   },
 * })
 *
 * // List topics
 * const [topics] = await pubsub.getTopics()
 * topics.forEach(t => console.log(t.name))
 *
 * // List subscriptions
 * const [subscriptions] = await topic.getSubscriptions()
 * subscriptions.forEach(s => console.log(s.name))
 *
 * // Check if topic exists
 * const [exists] = await topic.exists()
 *
 * // Get topic metadata
 * const [metadata] = await topic.getMetadata()
 *
 * // Delete subscription
 * await subscription.delete()
 *
 * // Delete topic
 * await topic.delete()
 *
 * // Dead letter queue
 * await topic.createSubscription('with-dlq', {
 *   deadLetterPolicy: {
 *     deadLetterTopic: 'projects/my-project/topics/dead-letter',
 *     maxDeliveryAttempts: 5,
 *   },
 * })
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
} from '../../streaming/compat/pubsub/pubsub'

// Export all errors
export {
  PubSubError,
  TopicNotFoundError,
  SubscriptionNotFoundError,
  TopicExistsError,
  SubscriptionExistsError,
  InvalidMessageError,
  AckDeadlineError,
} from '../../streaming/compat/pubsub/types'

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
} from '../../streaming/compat/pubsub/types'

// Default export for convenience
export { PubSub as default } from '../../streaming/compat/pubsub/pubsub'
