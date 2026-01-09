/**
 * @dotdo/nats types
 *
 * nats.js-compatible type definitions
 * for the NATS SDK backed by Durable Objects
 *
 * @see https://github.com/nats-io/nats.js
 */

// ============================================================================
// CONNECTION TYPES
// ============================================================================

/**
 * NATS connection configuration
 */
export interface ConnectionOptions {
  /** Server URL(s) */
  servers?: string | string[]
  /** Client name */
  name?: string
  /** Username for authentication */
  user?: string
  /** Password for authentication */
  pass?: string
  /** Token for authentication */
  token?: string
  /** Connection timeout in ms */
  timeout?: number
  /** Ping interval in ms */
  pingInterval?: number
  /** Max outstanding pings */
  maxPingOut?: number
  /** Enable reconnection */
  reconnect?: boolean
  /** Max reconnect attempts */
  maxReconnectAttempts?: number
  /** Reconnect wait time in ms */
  reconnectTimeWait?: number
  /** Disable server randomization */
  noRandomize?: boolean
  /** Verbose protocol */
  verbose?: boolean
  /** Pedantic protocol */
  pedantic?: boolean
  /** TLS configuration */
  tls?: TlsOptions
  /** Custom authenticator */
  authenticator?: Authenticator
  /** Debug mode */
  debug?: boolean
}

/**
 * TLS options
 */
export interface TlsOptions {
  /** CA certificates */
  ca?: string | Buffer
  /** Client certificate */
  cert?: string | Buffer
  /** Client key */
  key?: string | Buffer
  /** Reject unauthorized certs */
  rejectUnauthorized?: boolean
}

/**
 * Authenticator function
 */
export type Authenticator = () => Promise<{
  user?: string
  pass?: string
  token?: string
  nkey?: string
  sig?: string
}>

/**
 * Server info from NATS
 */
export interface ServerInfo {
  /** Server ID */
  server_id: string
  /** Server name */
  server_name: string
  /** Server version */
  version: string
  /** Protocol version */
  proto: number
  /** Go version */
  go: string
  /** Host */
  host: string
  /** Port */
  port: number
  /** Headders supported */
  headers: boolean
  /** Max payload */
  max_payload: number
  /** JetStream enabled */
  jetstream: boolean
  /** Client ID */
  client_id: number
  /** Client IP */
  client_ip: string
}

/**
 * Connection statistics
 */
export interface Stats {
  /** Incoming bytes */
  inBytes: number
  /** Outgoing bytes */
  outBytes: number
  /** Incoming messages */
  inMsgs: number
  /** Outgoing messages */
  outMsgs: number
  /** Reconnects */
  reconnects: number
}

/**
 * Status event
 */
export interface Status {
  /** Status type */
  type: StatusType
  /** Status data */
  data?: string | ServerInfo
}

/**
 * Status types
 */
export type StatusType =
  | 'connect'
  | 'disconnect'
  | 'reconnect'
  | 'reconnecting'
  | 'update'
  | 'ldm'
  | 'error'
  | 'pingTimer'

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/**
 * NATS message
 */
export interface Msg {
  /** Message subject */
  subject: string
  /** Reply subject (for request/reply) */
  reply?: string
  /** Message data */
  data: Uint8Array
  /** Message headers */
  headers?: MsgHdrs
  /** Server info */
  sid: number
  /** Respond to message */
  respond(data?: Uint8Array, opts?: PublishOptions): boolean
}

/**
 * Message headers interface
 */
export interface MsgHdrs {
  /** Get header value */
  get(key: string): string | undefined
  /** Set header value */
  set(key: string, value: string): void
  /** Append header value */
  append(key: string, value: string): void
  /** Check if header exists */
  has(key: string): boolean
  /** Delete header */
  delete(key: string): void
  /** Get all values for header */
  values(key: string): string[]
  /** Get all header keys */
  keys(): IterableIterator<string>
}

/**
 * Publish options
 */
export interface PublishOptions {
  /** Reply subject */
  reply?: string
  /** Message headers */
  headers?: MsgHdrs
}

/**
 * Request options
 */
export interface RequestOptions extends PublishOptions {
  /** Request timeout in ms */
  timeout?: number
  /** Number of expected responses */
  noMux?: boolean
}

// ============================================================================
// SUBSCRIPTION TYPES
// ============================================================================

/**
 * Subscription options
 */
export interface SubscriptionOptions {
  /** Max messages to receive */
  max?: number
  /** Queue group */
  queue?: string
  /** Callback for messages */
  callback?: (err: NatsError | null, msg: Msg) => void
}

/**
 * Subscription interface
 */
export interface Subscription extends AsyncIterable<Msg> {
  /** Unsubscribe from subject */
  unsubscribe(max?: number): void
  /** Drain subscription */
  drain(): Promise<void>
  /** Check if closed */
  isClosed(): boolean
  /** Get subject */
  getSubject(): string
  /** Get received count */
  getReceived(): number
  /** Get pending count */
  getPending(): number
  /** Get processed count */
  getProcessed(): number
  /** Get max count */
  getMax(): number | undefined
  /** Get ID */
  getID(): number
}

// ============================================================================
// NATS CONNECTION INTERFACE
// ============================================================================

/**
 * NATS connection interface
 */
export interface NatsConnection {
  /** Publish message */
  publish(subject: string, data?: Uint8Array, options?: PublishOptions): void
  /** Subscribe to subject */
  subscribe(subject: string, opts?: SubscriptionOptions): Subscription
  /** Request/reply */
  request(subject: string, data?: Uint8Array, opts?: RequestOptions): Promise<Msg>
  /** Flush pending messages */
  flush(): Promise<void>
  /** Drain connection */
  drain(): Promise<void>
  /** Close connection */
  close(): Promise<void>
  /** Check if closed */
  isClosed(): boolean
  /** Check if draining */
  isDraining(): boolean
  /** Get server info */
  info?: ServerInfo
  /** Get connection stats */
  stats(): Stats
  /** Get RTT to server */
  rtt(): Promise<number>
  /** Status iterator */
  status(): AsyncIterable<Status>
  /** Get JetStream client */
  jetstream(opts?: JetStreamOptions): JetStreamClient
  /** Get JetStream manager */
  jetstreamManager(opts?: JetStreamOptions): Promise<JetStreamManager>
}

// ============================================================================
// JETSTREAM TYPES
// ============================================================================

/**
 * JetStream options
 */
export interface JetStreamOptions {
  /** API prefix */
  apiPrefix?: string
  /** Default timeout */
  timeout?: number
  /** Domain */
  domain?: string
}

/**
 * JetStream client
 */
export interface JetStreamClient {
  /** Publish message */
  publish(subject: string, data?: Uint8Array, opts?: JetStreamPublishOptions): Promise<PubAck>
  /** Get consumers accessor */
  consumers: Consumers
  /** Get views (KV, ObjectStore) */
  views: Views
}

/**
 * JetStream publish options
 */
export interface JetStreamPublishOptions {
  /** Message ID for deduplication */
  msgID?: string
  /** Expect constraints */
  expect?: {
    streamName?: string
    lastMsgID?: string
    lastSequence?: number
    lastSubjectSequence?: number
  }
  /** Message headers */
  headers?: MsgHdrs
  /** Reply subject */
  reply?: string
  /** Timeout */
  timeout?: number
}

/**
 * Publish acknowledgment
 */
export interface PubAck {
  /** Stream name */
  stream: string
  /** Sequence number */
  seq: number
  /** Duplicate flag */
  duplicate: boolean
  /** Domain */
  domain?: string
}

/**
 * JetStream manager
 */
export interface JetStreamManager {
  /** Stream management */
  streams: StreamAPI
  /** Consumer management */
  consumers: ConsumerAPI
  /** Get account info */
  getAccountInfo(): Promise<AccountInfo>
}

/**
 * Account info
 */
export interface AccountInfo {
  /** Memory used */
  memory: number
  /** Storage used */
  storage: number
  /** Number of streams */
  streams: number
  /** Number of consumers */
  consumers: number
  /** Limits */
  limits: AccountLimits
}

/**
 * Account limits
 */
export interface AccountLimits {
  /** Max memory */
  max_memory: number
  /** Max storage */
  max_storage: number
  /** Max streams */
  max_streams: number
  /** Max consumers */
  max_consumers: number
}

// ============================================================================
// STREAM TYPES
// ============================================================================

/**
 * Stream API
 */
export interface StreamAPI {
  /** Add stream */
  add(config: Partial<StreamConfig>): Promise<StreamInfo>
  /** Update stream */
  update(name: string, config: Partial<StreamConfig>): Promise<StreamInfo>
  /** Get stream info */
  info(name: string): Promise<StreamInfo>
  /** Delete stream */
  delete(name: string): Promise<boolean>
  /** Purge stream */
  purge(name: string, opts?: PurgeOpts): Promise<PurgeResponse>
  /** List streams */
  list(): Lister<StreamInfo>
  /** Get stream names */
  names(subject?: string): Lister<string>
  /** Get message */
  getMessage(name: string, query: MsgRequest): Promise<StoredMsg>
  /** Delete message */
  deleteMessage(name: string, seq: number, erase?: boolean): Promise<boolean>
}

/**
 * Stream configuration
 */
export interface StreamConfig {
  /** Stream name */
  name: string
  /** Subjects */
  subjects?: string[]
  /** Retention policy */
  retention?: RetentionPolicy
  /** Storage type */
  storage?: StorageType
  /** Max consumers */
  max_consumers?: number
  /** Max messages */
  max_msgs?: number
  /** Max bytes */
  max_bytes?: number
  /** Max age in nanoseconds */
  max_age?: number
  /** Max message size */
  max_msg_size?: number
  /** Discard policy */
  discard?: DiscardPolicy
  /** Number of replicas */
  num_replicas?: number
  /** Duplicate window in nanoseconds */
  duplicate_window?: number
  /** No ack */
  no_ack?: boolean
  /** Template owner */
  template_owner?: string
  /** Sealed */
  sealed?: boolean
  /** Deny delete */
  deny_delete?: boolean
  /** Deny purge */
  deny_purge?: boolean
  /** Allow rollup hdrs */
  allow_rollup_hdrs?: boolean
  /** Allow direct */
  allow_direct?: boolean
  /** Mirror direct */
  mirror_direct?: boolean
  /** Description */
  description?: string
  /** Mirror */
  mirror?: StreamSource
  /** Sources */
  sources?: StreamSource[]
  /** Republish */
  republish?: Republish
}

/**
 * Stream source for mirroring
 */
export interface StreamSource {
  /** Name */
  name: string
  /** Start sequence */
  opt_start_seq?: number
  /** Start time */
  opt_start_time?: string
  /** Filter subject */
  filter_subject?: string
  /** External */
  external?: ExternalStream
}

/**
 * External stream
 */
export interface ExternalStream {
  /** API prefix */
  api: string
  /** Deliver prefix */
  deliver?: string
}

/**
 * Republish configuration
 */
export interface Republish {
  /** Source subject */
  src: string
  /** Destination subject */
  dest: string
  /** Headers only */
  headers_only?: boolean
}

/**
 * Stream info
 */
export interface StreamInfo {
  /** Configuration */
  config: StreamConfig
  /** State */
  state: StreamState
  /** Created time */
  created: string
  /** Cluster info */
  cluster?: ClusterInfo
  /** Mirror info */
  mirror?: StreamSourceInfo
  /** Sources info */
  sources?: StreamSourceInfo[]
}

/**
 * Stream state
 */
export interface StreamState {
  /** Messages */
  messages: number
  /** Bytes */
  bytes: number
  /** First sequence */
  first_seq: number
  /** First timestamp */
  first_ts: string
  /** Last sequence */
  last_seq: number
  /** Last timestamp */
  last_ts: string
  /** Consumer count */
  consumer_count: number
  /** Deleted messages */
  deleted?: number[]
  /** Num deleted */
  num_deleted?: number
  /** Num subjects */
  num_subjects?: number
  /** Subjects */
  subjects?: Record<string, number>
}

/**
 * Cluster info
 */
export interface ClusterInfo {
  /** Name */
  name?: string
  /** Leader */
  leader?: string
  /** Replicas */
  replicas?: PeerInfo[]
}

/**
 * Peer info
 */
export interface PeerInfo {
  /** Name */
  name: string
  /** Current */
  current: boolean
  /** Offline */
  offline?: boolean
  /** Active */
  active: number
  /** Lag */
  lag?: number
}

/**
 * Stream source info
 */
export interface StreamSourceInfo {
  /** Name */
  name: string
  /** Lag */
  lag: number
  /** Active */
  active: number
  /** External */
  external?: ExternalStream
}

/**
 * Purge options
 */
export interface PurgeOpts {
  /** Filter subject */
  filter?: string
  /** Sequence */
  seq?: number
  /** Keep */
  keep?: number
}

/**
 * Purge response
 */
export interface PurgeResponse {
  /** Success */
  success: boolean
  /** Purged count */
  purged: number
}

/**
 * Message request
 */
export interface MsgRequest {
  /** Sequence */
  seq?: number
  /** Last by subject */
  last_by_subj?: string
  /** Next by subject */
  next_by_subj?: string
}

/**
 * Stored message
 */
export interface StoredMsg {
  /** Subject */
  subject: string
  /** Sequence */
  seq: number
  /** Headers */
  header?: MsgHdrs
  /** Data */
  data: Uint8Array
  /** Time */
  time: string
}

// ============================================================================
// CONSUMER TYPES
// ============================================================================

/**
 * Consumer API
 */
export interface ConsumerAPI {
  /** Add consumer */
  add(stream: string, config: Partial<ConsumerConfig>): Promise<ConsumerInfo>
  /** Update consumer */
  update(stream: string, durable: string, config: Partial<ConsumerConfig>): Promise<ConsumerInfo>
  /** Get consumer info */
  info(stream: string, consumer: string): Promise<ConsumerInfo>
  /** Delete consumer */
  delete(stream: string, consumer: string): Promise<boolean>
  /** List consumers */
  list(stream: string): Lister<ConsumerInfo>
}

/**
 * Consumer configuration
 */
export interface ConsumerConfig {
  /** Durable name */
  durable_name?: string
  /** Name */
  name?: string
  /** Description */
  description?: string
  /** Deliver policy */
  deliver_policy?: DeliverPolicy
  /** Optional start sequence */
  opt_start_seq?: number
  /** Optional start time */
  opt_start_time?: string
  /** Ack policy */
  ack_policy?: AckPolicy
  /** Ack wait in nanoseconds */
  ack_wait?: number
  /** Max deliver */
  max_deliver?: number
  /** Filter subject */
  filter_subject?: string
  /** Filter subjects */
  filter_subjects?: string[]
  /** Replay policy */
  replay_policy?: ReplayPolicy
  /** Rate limit */
  rate_limit_bps?: number
  /** Sample frequency */
  sample_freq?: string
  /** Max waiting */
  max_waiting?: number
  /** Max ack pending */
  max_ack_pending?: number
  /** Headers only */
  headers_only?: boolean
  /** Max batch */
  max_batch?: number
  /** Max expires in nanoseconds */
  max_expires?: number
  /** Inactive threshold in nanoseconds */
  inactive_threshold?: number
  /** Backoff */
  backoff?: number[]
  /** Num replicas */
  num_replicas?: number
  /** Memory storage */
  mem_storage?: boolean
  /** Deliver subject (for push consumers) */
  deliver_subject?: string
  /** Deliver group */
  deliver_group?: string
  /** Flow control */
  flow_control?: boolean
  /** Idle heartbeat in nanoseconds */
  idle_heartbeat?: number
}

/**
 * Consumer info
 */
export interface ConsumerInfo {
  /** Stream name */
  stream_name: string
  /** Name */
  name: string
  /** Created */
  created: string
  /** Config */
  config: ConsumerConfig
  /** Delivered */
  delivered: SequenceInfo
  /** Ack floor */
  ack_floor: SequenceInfo
  /** Num ack pending */
  num_ack_pending: number
  /** Num redelivered */
  num_redelivered: number
  /** Num waiting */
  num_waiting: number
  /** Num pending */
  num_pending: number
  /** Cluster */
  cluster?: ClusterInfo
  /** Push bound */
  push_bound?: boolean
}

/**
 * Sequence info
 */
export interface SequenceInfo {
  /** Consumer sequence */
  consumer_seq: number
  /** Stream sequence */
  stream_seq: number
  /** Last active */
  last_active?: string
}

// ============================================================================
// CONSUMER CLIENT TYPES
// ============================================================================

/**
 * Consumers accessor
 */
export interface Consumers {
  /** Get consumer */
  get(stream: string, consumer: string): Promise<Consumer>
}

/**
 * Consumer client
 */
export interface Consumer {
  /** Get info */
  info(): Promise<ConsumerInfo>
  /** Fetch messages */
  fetch(opts?: FetchOptions): Promise<ConsumerMessages>
  /** Consume messages (push) */
  consume(opts?: ConsumeOptions): Promise<ConsumerMessages>
  /** Delete consumer */
  delete(): Promise<boolean>
}

/**
 * Fetch options
 */
export interface FetchOptions {
  /** Max messages */
  max_messages?: number
  /** Max bytes */
  max_bytes?: number
  /** Expires in ms */
  expires?: number
  /** Idle heartbeat in ms */
  idle_heartbeat?: number
}

/**
 * Consume options
 */
export interface ConsumeOptions extends FetchOptions {
  /** Callback */
  callback?: (msg: JsMsg) => void
}

/**
 * Consumer messages iterator
 */
export interface ConsumerMessages extends AsyncIterable<JsMsg> {
  /** Stop consuming */
  stop(): void
  /** Get consumer info */
  getConsumerInfo(): Promise<ConsumerInfo>
}

/**
 * JetStream message
 */
export interface JsMsg {
  /** Message subject */
  subject: string
  /** Message data */
  data: Uint8Array
  /** Message headers */
  headers?: MsgHdrs
  /** Message info */
  info: JsMsgInfo
  /** Acknowledge message */
  ack(): void
  /** Negative acknowledge (request redelivery) */
  nak(delay?: number): void
  /** Working (extend ack deadline) */
  working(): Promise<void>
  /** Terminate (no redelivery) */
  term(): void
  /** Check if message is a JetStream message */
  isJetStream(): boolean
}

/**
 * JetStream message info
 */
export interface JsMsgInfo {
  /** Stream */
  stream: string
  /** Consumer */
  consumer: string
  /** Delivered count */
  deliveryCount: number
  /** Stream sequence */
  streamSequence: number
  /** Consumer sequence */
  consumerSequence: number
  /** Timestamp */
  timestampNanos: number
  /** Pending */
  pending: number
}

// ============================================================================
// KV TYPES
// ============================================================================

/**
 * Views accessor
 */
export interface Views {
  /** Get or create KV bucket */
  kv(bucket: string, opts?: KvOptions): Promise<KV>
}

/**
 * KV options
 */
export interface KvOptions {
  /** History depth */
  history?: number
  /** TTL in ms */
  ttl?: number
  /** Max bucket size */
  max_bucket_size?: number
  /** Max value size */
  max_value_size?: number
  /** Replicas */
  replicas?: number
  /** Description */
  description?: string
  /** Placement */
  placement?: Placement
  /** Republish */
  republish?: Republish
  /** Mirror */
  mirror?: StreamSource
  /** Sources */
  sources?: StreamSource[]
  /** Bind only (don't create) */
  bindOnly?: boolean
}

/**
 * Placement
 */
export interface Placement {
  /** Cluster */
  cluster: string
  /** Tags */
  tags?: string[]
}

/**
 * KV bucket
 */
export interface KV {
  /** Put value */
  put(key: string, value: Uint8Array): Promise<number>
  /** Get value */
  get(key: string, revision?: number): Promise<KvEntry | null>
  /** Create value (fail if exists) */
  create(key: string, value: Uint8Array): Promise<number>
  /** Update value (with revision check) */
  update(key: string, value: Uint8Array, revision: number): Promise<number>
  /** Delete key */
  delete(key: string, opts?: KvDeleteOptions): Promise<void>
  /** Purge key history */
  purge(key: string): Promise<void>
  /** Destroy bucket */
  destroy(): Promise<boolean>
  /** List keys */
  keys(filter?: string): Promise<AsyncIterable<string>>
  /** Watch for changes */
  watch(opts?: KvWatchOptions): Promise<AsyncIterable<KvEntry>>
  /** Get key history */
  history(key: string, opts?: KvWatchOptions): Promise<AsyncIterable<KvEntry>>
  /** Get bucket status */
  status(): Promise<KvStatus>
}

/**
 * KV entry
 */
export interface KvEntry {
  /** Bucket name */
  bucket: string
  /** Key */
  key: string
  /** Value */
  value: Uint8Array
  /** Revision */
  revision: number
  /** Created time */
  created: Date
  /** Operation */
  operation: KvOperation
  /** Delta (for watch) */
  delta?: number
}

/**
 * KV operation type
 */
export type KvOperation = 'PUT' | 'DEL' | 'PURGE'

/**
 * KV delete options
 */
export interface KvDeleteOptions {
  /** Revision */
  revision?: number
}

/**
 * KV watch options
 */
export interface KvWatchOptions {
  /** Key filter */
  key?: string
  /** Headers only */
  headers_only?: boolean
  /** Ignore deletes */
  ignore_deletes?: boolean
  /** Include history */
  include_history?: boolean
}

/**
 * KV status
 */
export interface KvStatus {
  /** Bucket name */
  bucket: string
  /** Values count */
  values: number
  /** History depth */
  history: number
  /** TTL */
  ttl: number
  /** Bucket location */
  bucket_location: string
  /** Backing store type */
  backingStore: string
  /** Stream info */
  streamInfo: StreamInfo
}

// ============================================================================
// LISTER TYPE
// ============================================================================

/**
 * Lister for paginated results
 */
export interface Lister<T> {
  /** Get next page */
  next(): Promise<T[]>
  [Symbol.asyncIterator](): AsyncIterator<T>
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * NATS error
 */
export class NatsError extends Error {
  /** Error code */
  code: string
  /** Chain cause */
  chainedError?: Error

  constructor(message: string, code: string, chainedError?: Error) {
    super(message)
    this.name = 'NatsError'
    this.code = code
    this.chainedError = chainedError
  }
}

/**
 * Error codes
 */
export const ErrorCode = {
  /** API error */
  ApiError: 'API_ERROR',
  /** Bad authentication */
  BadAuthentication: 'BAD_AUTHENTICATION',
  /** Bad creds */
  BadCreds: 'BAD_CREDS',
  /** Bad header */
  BadHeader: 'BAD_HEADER',
  /** Bad JSON */
  BadJson: 'BAD_JSON',
  /** Bad payload */
  BadPayload: 'BAD_PAYLOAD',
  /** Bad subject */
  BadSubject: 'BAD_SUBJECT',
  /** Cancelled */
  Cancelled: 'CANCELLED',
  /** Connection closed */
  ConnectionClosed: 'CONNECTION_CLOSED',
  /** Connection draining */
  ConnectionDraining: 'CONNECTION_DRAINING',
  /** Connection refused */
  ConnectionRefused: 'CONNECTION_REFUSED',
  /** Connection timeout */
  ConnectionTimeout: 'CONNECTION_TIMEOUT',
  /** Disconnect */
  Disconnect: 'DISCONNECT',
  /** Invalid option */
  InvalidOption: 'INVALID_OPTION',
  /** Invalid payload type */
  InvalidPayloadType: 'INVALID_PAYLOAD_TYPE',
  /** JetStream 404 */
  JetStream404NoMessages: 'JETSTREAM_404_NO_MESSAGES',
  /** JetStream 408 */
  JetStream408RequestTimeout: 'JETSTREAM_408_REQUEST_TIMEOUT',
  /** JetStream 409 */
  JetStream409: 'JETSTREAM_409',
  /** JetStream not enabled */
  JetStreamNotEnabled: 'JETSTREAM_NOT_ENABLED',
  /** Max payload exceeded */
  MaxPayloadExceeded: 'MAX_PAYLOAD_EXCEEDED',
  /** No responders */
  NoResponders: 'NO_RESPONDERS',
  /** Not function */
  NotFunction: 'NOT_FUNCTION',
  /** Request error */
  RequestError: 'REQUEST_ERROR',
  /** Server error */
  ServerError: 'SERVER_ERROR',
  /** Stale connection */
  StaleConnection: 'STALE_CONNECTION',
  /** Subscription closed */
  SubClosed: 'SUBSCRIPTION_CLOSED',
  /** Subscription draining */
  SubDraining: 'SUBSCRIPTION_DRAINING',
  /** Timeout */
  Timeout: 'TIMEOUT',
  /** TLS */
  Tls: 'TLS',
  /** Unknown */
  Unknown: 'UNKNOWN',
} as const

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode]

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Acknowledgment policy
 */
export const AckPolicy = {
  /** No acknowledgment required */
  None: 'none',
  /** All messages must be acknowledged */
  All: 'all',
  /** Explicit acknowledgment per message */
  Explicit: 'explicit',
} as const

export type AckPolicyType = typeof AckPolicy[keyof typeof AckPolicy]

/**
 * Deliver policy
 */
export const DeliverPolicy = {
  /** All messages */
  All: 'all',
  /** Last message */
  Last: 'last',
  /** New messages only */
  New: 'new',
  /** By start sequence */
  StartSequence: 'by_start_sequence',
  /** By start time */
  StartTime: 'by_start_time',
  /** Last per subject */
  LastPerSubject: 'last_per_subject',
} as const

export type DeliverPolicyType = typeof DeliverPolicy[keyof typeof DeliverPolicy]

/**
 * Replay policy
 */
export const ReplayPolicy = {
  /** Instant replay */
  Instant: 'instant',
  /** Original timing */
  Original: 'original',
} as const

export type ReplayPolicyType = typeof ReplayPolicy[keyof typeof ReplayPolicy]

/**
 * Retention policy
 */
export const RetentionPolicy = {
  /** Limits based retention */
  Limits: 'limits',
  /** Interest based retention */
  Interest: 'interest',
  /** Work queue retention */
  Workqueue: 'workqueue',
} as const

export type RetentionPolicyType = typeof RetentionPolicy[keyof typeof RetentionPolicy]

/**
 * Storage type
 */
export const StorageType = {
  /** File storage */
  File: 'file',
  /** Memory storage */
  Memory: 'memory',
} as const

export type StorageTypeType = typeof StorageType[keyof typeof StorageType]

/**
 * Discard policy
 */
export const DiscardPolicy = {
  /** Discard old messages */
  Old: 'old',
  /** Discard new messages */
  New: 'new',
} as const

export type DiscardPolicyType = typeof DiscardPolicy[keyof typeof DiscardPolicy]
