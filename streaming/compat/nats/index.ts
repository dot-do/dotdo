/**
 * @dotdo/nats
 *
 * nats.js-compatible NATS SDK backed by Durable Objects.
 * Drop-in replacement for nats.js with edge-native implementation.
 *
 * Usage:
 * ```typescript
 * import { connect, StringCodec } from '@dotdo/nats'
 *
 * const nc = await connect({ servers: 'nats://localhost:4222' })
 * const sc = StringCodec()
 *
 * // Publish
 * nc.publish('updates', sc.encode('Hello NATS'))
 *
 * // Subscribe
 * const sub = nc.subscribe('updates')
 * for await (const msg of sub) {
 *   console.log(sc.decode(msg.data))
 * }
 *
 * // Request/Reply
 * const response = await nc.request('service', sc.encode('help'))
 *
 * // JetStream
 * const js = nc.jetstream()
 * await js.publish('orders', sc.encode('order1'))
 *
 * const consumer = await js.consumers.get('orders', 'processor')
 * const messages = await consumer.fetch({ max_messages: 10 })
 *
 * // KV Store
 * const kv = await js.views.kv('config')
 * await kv.put('key', sc.encode('value'))
 * const entry = await kv.get('key')
 *
 * await nc.close()
 * ```
 *
 * @see https://github.com/nats-io/nats.js
 */

// Export main functions
export { connect, StringCodec, JSONCodec, Empty, headers, _clearAll } from './nats'

// Export types
export type {
  ConnectionOptions,
  NatsConnection,
  Msg,
  MsgHdrs,
  Subscription,
  SubscriptionOptions,
  PublishOptions,
  RequestOptions,
  ServerInfo,
  Stats,
  Status,
  JetStreamClient,
  JetStreamManager,
  JetStreamOptions,
  JetStreamPublishOptions,
  PubAck,
  StreamConfig,
  StreamInfo,
  StreamState,
  ConsumerConfig,
  ConsumerInfo,
  Consumer,
  ConsumerMessages,
  JsMsg,
  JsMsgInfo,
  FetchOptions,
  ConsumeOptions,
  KV,
  KvEntry,
  KvOptions,
  KvStatus,
} from './types'

// Export errors and enums
export {
  NatsError,
  ErrorCode,
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  RetentionPolicy,
  StorageType,
  DiscardPolicy,
} from './types'
