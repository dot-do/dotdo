/**
 * @dotdo/streaming/compat
 *
 * Messaging and pub/sub compat SDKs backed by Durable Objects.
 * Drop-in replacements for popular messaging services with edge-native implementations.
 *
 * Available adapters:
 * - kafka: kafkajs-compatible Kafka SDK
 * - nats: nats.js-compatible NATS SDK
 * - sqs: @aws-sdk/client-sqs compatible SQS SDK
 * - pubsub: @google-cloud/pubsub compatible Pub/Sub SDK
 * - pusher: pusher-js compatible SDK
 * - socketio: socket.io-client compatible SDK
 * - ably: ably-js compatible SDK
 */

// Kafka exports
export * as kafka from './kafka'
export { Kafka, createKafka, Partitioners } from './kafka'

// NATS exports
export * as nats from './nats'
export { connect, StringCodec, JSONCodec, Empty, headers } from './nats'

// SQS exports
export * as sqs from './sqs'
export {
  SQSClient,
  CreateQueueCommand,
  DeleteQueueCommand,
  ListQueuesCommand,
  GetQueueUrlCommand,
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
} from './sqs'

// Pub/Sub exports
export * as pubsub from './pubsub'
export { PubSub, Topic, Subscription, Message } from './pubsub'

// Pusher exports
export * as pusher from './pusher'
export { Pusher, createPusher } from './pusher'

// Socket.IO exports
export * as socketio from './socketio'
export { io, Manager, Socket } from './socketio'

// Ably exports
export * as ably from './ably'
export { Realtime } from './ably'
