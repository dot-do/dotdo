/**
 * @dotdo/twilio - Type Definitions
 *
 * Complete TypeScript types for Twilio API compatibility.
 */

// =============================================================================
// Message Types
// =============================================================================

export type MessageStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'undelivered'
  | 'failed'
  | 'receiving'
  | 'received'
  | 'accepted'
  | 'scheduled'
  | 'read'
  | 'canceled'

export type MessageDirection =
  | 'inbound'
  | 'outbound-api'
  | 'outbound-call'
  | 'outbound-reply'

export interface Message {
  sid: string
  account_sid: string
  api_version: string
  body: string
  date_created: string
  date_sent: string | null
  date_updated: string
  direction: MessageDirection
  error_code: number | null
  error_message: string | null
  from: string
  messaging_service_sid: string | null
  num_media: string
  num_segments: string
  price: string | null
  price_unit: string
  status: MessageStatus
  to: string
  uri: string
}

export interface MessageCreateParams {
  to: string
  body?: string
  from?: string
  messagingServiceSid?: string
  mediaUrl?: string[]
  contentSid?: string
  contentVariables?: string
  statusCallback?: string
  provideFeedback?: boolean
  attempt?: number
  validityPeriod?: number
  forceDelivery?: boolean
  sendAt?: Date
  sendAsMms?: boolean
  shortenUrls?: boolean
}

export interface MessageListParams {
  to?: string
  from?: string
  dateSent?: Date
  dateSentAfter?: Date
  dateSentBefore?: Date
  pageSize?: number
  page?: number
}

export interface MessageUpdateParams {
  body?: string
  status?: 'canceled'
}

// =============================================================================
// Call Types
// =============================================================================

export type CallStatus =
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled'

export type CallDirection =
  | 'inbound'
  | 'outbound-api'
  | 'outbound-dial'

export interface Call {
  sid: string
  account_sid: string
  annotation?: string
  answered_by: string | null
  api_version: string
  caller_name: string | null
  date_created: string
  date_updated: string
  direction: CallDirection
  duration: string | null
  end_time: string | null
  forwarded_from: string | null
  from: string
  from_formatted: string
  group_sid: string | null
  parent_call_sid: string | null
  phone_number_sid: string
  price: string | null
  price_unit: string
  queue_time: string
  start_time: string | null
  status: CallStatus
  to: string
  to_formatted: string
  trunk_sid: string | null
  uri: string
}

export interface CallCreateParams {
  to: string
  from: string
  url?: string
  twiml?: string
  method?: 'GET' | 'POST'
  fallbackUrl?: string
  fallbackMethod?: 'GET' | 'POST'
  statusCallback?: string
  statusCallbackEvent?: ('initiated' | 'ringing' | 'answered' | 'completed')[]
  statusCallbackMethod?: 'GET' | 'POST'
  sendDigits?: string
  timeout?: number
  record?: boolean
  recordingChannels?: 'mono' | 'dual'
  recordingStatusCallback?: string
  recordingStatusCallbackMethod?: 'GET' | 'POST'
  machineDetection?: 'Enable' | 'DetectMessageEnd'
  machineDetectionTimeout?: number
  machineDetectionSilenceTimeout?: number
  machineDetectionSpeechThreshold?: number
  machineDetectionSpeechEndThreshold?: number
  asyncAmd?: boolean
  asyncAmdStatusCallback?: string
  asyncAmdStatusCallbackMethod?: 'GET' | 'POST'
  callerId?: string
  callReason?: string
  trim?: 'trim-silence' | 'do-not-trim'
}

export interface CallUpdateParams {
  url?: string
  method?: 'GET' | 'POST'
  status?: 'canceled' | 'completed'
  fallbackUrl?: string
  fallbackMethod?: 'GET' | 'POST'
  statusCallback?: string
  statusCallbackMethod?: 'GET' | 'POST'
  twiml?: string
}

export interface CallListParams {
  to?: string
  from?: string
  parentCallSid?: string
  status?: CallStatus
  startTime?: Date
  startTimeAfter?: Date
  startTimeBefore?: Date
  endTime?: Date
  endTimeAfter?: Date
  endTimeBefore?: Date
  pageSize?: number
  page?: number
}

// =============================================================================
// Verify Types
// =============================================================================

export type VerificationChannel = 'sms' | 'call' | 'email' | 'whatsapp' | 'sna'

export type VerificationStatus = 'pending' | 'approved' | 'canceled' | 'max_attempts_reached' | 'deleted' | 'failed' | 'expired'

export interface Verification {
  sid: string
  service_sid: string
  account_sid: string
  to: string
  channel: VerificationChannel
  status: VerificationStatus
  valid: boolean
  lookup: Record<string, unknown>
  amount: string | null
  payee: string | null
  send_code_attempts: Array<{
    time: string
    channel: string
    attempt_sid: string
  }>
  date_created: string
  date_updated: string
  sna: string | null
  url: string
}

export interface VerificationCreateParams {
  to: string
  channel: VerificationChannel
  codeLength?: number
  locale?: string
  customFriendlyName?: string
  customMessage?: string
  sendDigits?: string
  customCode?: string
  amount?: string
  payee?: string
  rateLimits?: Record<string, unknown>
  channelConfiguration?: Record<string, unknown>
  appHash?: string
  templateSid?: string
  templateCustomSubstitutions?: string
  deviceIp?: string
}

export interface VerificationUpdateParams {
  status: 'canceled' | 'approved'
}

export interface VerificationCheck {
  sid: string
  service_sid: string
  account_sid: string
  to: string
  channel: VerificationChannel
  status: VerificationStatus
  valid: boolean
  amount: string | null
  payee: string | null
  date_created: string
  date_updated: string
}

export interface VerificationCheckCreateParams {
  to?: string
  code: string
  verificationSid?: string
  amount?: string
  payee?: string
}

// =============================================================================
// List Response Types
// =============================================================================

export interface ListResponse<T> {
  messages?: T[]
  calls?: T[]
  verifications?: T[]
  end?: number
  first_page_uri?: string
  next_page_uri?: string | null
  page?: number
  page_size?: number
  previous_page_uri?: string | null
  start?: number
  uri?: string
}

// =============================================================================
// Error Types
// =============================================================================

export interface TwilioErrorResponse {
  code: number
  message: string
  more_info: string
  status: number
}

// =============================================================================
// Client Configuration Types
// =============================================================================

export interface TwilioClientConfig {
  region?: string
  edge?: string
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  logger?: {
    log: (message: string) => void
    warn: (message: string) => void
    error: (message: string) => void
  }
  timeout?: number
  autoRetry?: boolean
  maxRetries?: number
  fetch?: typeof fetch
}

// =============================================================================
// Webhook Types
// =============================================================================

export interface MessageWebhookPayload {
  MessageSid: string
  AccountSid: string
  MessagingServiceSid?: string
  From: string
  To: string
  Body: string
  NumMedia: string
  NumSegments?: string
  SmsStatus: MessageStatus
  SmsSid?: string
  SmsMessageSid?: string
  ApiVersion: string
  MediaContentType0?: string
  MediaUrl0?: string
}

export interface CallWebhookPayload {
  CallSid: string
  AccountSid: string
  From: string
  To: string
  CallStatus: CallStatus
  Direction: string
  ApiVersion: string
  CallerName?: string
  ForwardedFrom?: string
  ParentCallSid?: string
  Digits?: string
  SpeechResult?: string
  Confidence?: string
  RecordingUrl?: string
  RecordingSid?: string
  RecordingDuration?: string
  CallDuration?: string
  AnsweredBy?: string
  SequenceNumber?: string
  Timestamp?: string
}

// =============================================================================
// Conversations Types
// =============================================================================

/** Conversation state */
export type ConversationState = 'active' | 'inactive' | 'closed'

/** Conversation messaging binding */
export type ConversationBindingType = 'sms' | 'whatsapp' | 'chat' | 'email' | 'messenger' | 'gbm'

/** Participant role in conversation */
export type ParticipantRole = 'participant' | 'admin'

/** Conversation webhook event type */
export type ConversationWebhookEvent =
  | 'onMessageAdded'
  | 'onMessageUpdated'
  | 'onMessageRemoved'
  | 'onParticipantAdded'
  | 'onParticipantUpdated'
  | 'onParticipantRemoved'
  | 'onConversationAdded'
  | 'onConversationUpdated'
  | 'onConversationRemoved'
  | 'onConversationStateUpdated'
  | 'onDeliveryUpdated'
  | 'onUserAdded'
  | 'onUserUpdated'

/** Delivery status for conversation messages */
export type ConversationDeliveryStatus = 'sent' | 'delivered' | 'failed' | 'undelivered' | 'read'

/** Conversation resource */
export interface Conversation {
  sid: string
  account_sid: string
  chat_service_sid: string
  messaging_service_sid: string | null
  friendly_name: string | null
  unique_name: string | null
  attributes: string
  state: ConversationState
  date_created: string
  date_updated: string
  timers: {
    date_inactive?: string
    date_closed?: string
  }
  bindings: Record<string, unknown>
  links: {
    participants: string
    messages: string
    webhooks: string
  }
  url: string
}

/** Conversation create parameters */
export interface ConversationCreateParams {
  /** Friendly name for the conversation */
  friendlyName?: string
  /** Unique name for the conversation */
  uniqueName?: string
  /** JSON string of attributes */
  attributes?: string
  /** Messaging Service SID */
  messagingServiceSid?: string
  /** Conversation state */
  state?: ConversationState
  /** Timer for when conversation becomes inactive */
  'timers.inactive'?: string
  /** Timer for when conversation closes */
  'timers.closed'?: string
}

/** Conversation update parameters */
export interface ConversationUpdateParams {
  /** Friendly name for the conversation */
  friendlyName?: string
  /** Unique name for the conversation */
  uniqueName?: string
  /** JSON string of attributes */
  attributes?: string
  /** Conversation state */
  state?: ConversationState
  /** Timer for when conversation becomes inactive */
  'timers.inactive'?: string
  /** Timer for when conversation closes */
  'timers.closed'?: string
}

/** Conversation list parameters */
export interface ConversationListParams {
  /** Page size */
  pageSize?: number
  /** Page token */
  pageToken?: string
  /** Start date filter */
  startDate?: Date
  /** End date filter */
  endDate?: Date
}

/** Conversation participant resource */
export interface ConversationParticipant {
  sid: string
  account_sid: string
  conversation_sid: string
  identity: string | null
  attributes: string
  messaging_binding: {
    type: ConversationBindingType
    address: string
    proxy_address?: string
    projected_address?: string
  } | null
  role_sid: string | null
  date_created: string
  date_updated: string
  last_read_message_index: number | null
  last_read_timestamp: string | null
  url: string
}

/** Participant create parameters */
export interface ParticipantCreateParams {
  /** Identity of the participant (for chat users) */
  identity?: string
  /** Messaging binding type */
  'messagingBinding.type'?: ConversationBindingType
  /** Messaging binding address (phone number) */
  'messagingBinding.address'?: string
  /** Messaging binding proxy address */
  'messagingBinding.proxyAddress'?: string
  /** Messaging binding projected address */
  'messagingBinding.projectedAddress'?: string
  /** JSON string of attributes */
  attributes?: string
  /** Role SID */
  roleSid?: string
  /** Date created */
  dateCreated?: Date
  /** Date updated */
  dateUpdated?: Date
}

/** Participant update parameters */
export interface ParticipantUpdateParams {
  /** JSON string of attributes */
  attributes?: string
  /** Role SID */
  roleSid?: string
  /** Last read message index */
  lastReadMessageIndex?: number
  /** Last read timestamp */
  lastReadTimestamp?: string
  /** Date created */
  dateCreated?: Date
  /** Date updated */
  dateUpdated?: Date
}

/** Conversation message resource */
export interface ConversationMessage {
  sid: string
  account_sid: string
  conversation_sid: string
  index: number
  author: string
  body: string | null
  media: Array<{
    sid: string
    content_type: string
    filename: string | null
    size: number
  }> | null
  attributes: string
  participant_sid: string | null
  date_created: string
  date_updated: string
  delivery: {
    total: number
    sent: string
    delivered: string
    read: string
    failed: string
    undelivered: string
  } | null
  content_sid: string | null
  url: string
  links: {
    delivery_receipts: string
  }
}

/** Message create parameters */
export interface ConversationMessageCreateParams {
  /** Message author */
  author?: string
  /** Message body */
  body?: string
  /** Media SID (for media messages) */
  mediaSid?: string
  /** Content SID (for template messages) */
  contentSid?: string
  /** Content variables for templates */
  contentVariables?: string
  /** JSON string of attributes */
  attributes?: string
  /** Date created */
  dateCreated?: Date
  /** Date updated */
  dateUpdated?: Date
}

/** Message update parameters */
export interface ConversationMessageUpdateParams {
  /** Message author */
  author?: string
  /** Message body */
  body?: string
  /** JSON string of attributes */
  attributes?: string
  /** Date created */
  dateCreated?: Date
  /** Date updated */
  dateUpdated?: Date
}

/** Conversation message list parameters */
export interface ConversationMessageListParams {
  /** Page size */
  pageSize?: number
  /** Page token */
  pageToken?: string
  /** Order (asc or desc) */
  order?: 'asc' | 'desc'
}

/** Delivery receipt for a message */
export interface DeliveryReceipt {
  sid: string
  account_sid: string
  conversation_sid: string
  message_sid: string
  participant_sid: string
  status: ConversationDeliveryStatus
  error_code: number | null
  date_created: string
  date_updated: string
  url: string
}

/** Conversation webhook resource */
export interface ConversationWebhook {
  sid: string
  account_sid: string
  conversation_sid: string
  target: 'webhook' | 'studio' | 'trigger'
  url: string | null
  configuration: {
    method?: 'GET' | 'POST'
    filters?: ConversationWebhookEvent[]
    triggers?: string[]
    flow_sid?: string
    replay_after?: number
  }
  date_created: string
  date_updated: string
}

/** Webhook create parameters */
export interface ConversationWebhookCreateParams {
  /** Target type */
  target: 'webhook' | 'studio' | 'trigger'
  /** Webhook URL */
  'configuration.url'?: string
  /** HTTP method */
  'configuration.method'?: 'GET' | 'POST'
  /** Event filters */
  'configuration.filters'?: ConversationWebhookEvent[]
  /** Replay after */
  'configuration.replayAfter'?: number
  /** Studio flow SID */
  'configuration.flowSid'?: string
  /** Triggers */
  'configuration.triggers'?: string[]
}

/** Webhook update parameters */
export interface ConversationWebhookUpdateParams {
  /** Webhook URL */
  'configuration.url'?: string
  /** HTTP method */
  'configuration.method'?: 'GET' | 'POST'
  /** Event filters */
  'configuration.filters'?: ConversationWebhookEvent[]
}

/** Conversation user resource */
export interface ConversationUser {
  sid: string
  account_sid: string
  chat_service_sid: string
  identity: string
  friendly_name: string | null
  role_sid: string | null
  attributes: string
  is_online: boolean | null
  is_notifiable: boolean | null
  date_created: string
  date_updated: string
  url: string
  links: {
    user_conversations: string
  }
}

/** User create parameters */
export interface ConversationUserCreateParams {
  /** User identity (required) */
  identity: string
  /** Friendly name */
  friendlyName?: string
  /** JSON string of attributes */
  attributes?: string
  /** Role SID */
  roleSid?: string
}

/** User update parameters */
export interface ConversationUserUpdateParams {
  /** Friendly name */
  friendlyName?: string
  /** JSON string of attributes */
  attributes?: string
  /** Role SID */
  roleSid?: string
}

/** User conversation resource (link between user and conversation) */
export interface UserConversation {
  account_sid: string
  chat_service_sid: string
  conversation_sid: string
  user_sid: string
  participant_sid: string
  conversation_friendly_name: string | null
  conversation_state: ConversationState
  notification_level: 'default' | 'muted'
  unread_messages_count: number
  last_read_message_index: number | null
  date_created: string
  date_updated: string
  url: string
  links: {
    conversation: string
    participant: string
  }
}

/** User conversation update parameters */
export interface UserConversationUpdateParams {
  /** Notification level */
  notificationLevel?: 'default' | 'muted'
  /** Last read message index */
  lastReadMessageIndex?: number
  /** Last read timestamp */
  lastReadTimestamp?: string
}

/** Conversation service resource */
export interface ConversationService {
  sid: string
  account_sid: string
  friendly_name: string
  date_created: string
  date_updated: string
  url: string
  links: {
    conversations: string
    users: string
    roles: string
    bindings: string
    configuration: string
    webhooks: string
  }
}

/** Conversation service create parameters */
export interface ConversationServiceCreateParams {
  /** Friendly name for the service */
  friendlyName: string
}

/** Conversation service update parameters */
export interface ConversationServiceUpdateParams {
  /** Friendly name for the service */
  friendlyName?: string
}

/** Conversation webhook payload (for incoming webhooks) */
export interface ConversationWebhookPayload {
  AccountSid: string
  ChatServiceSid: string
  ConversationSid: string
  EventType: ConversationWebhookEvent
  MessageSid?: string
  MessageIndex?: string
  MessageBody?: string
  MessageAuthor?: string
  MessageAttributes?: string
  MessageMedia?: string
  ParticipantSid?: string
  ParticipantIdentity?: string
  ParticipantAttributes?: string
  MessagingBindingAddress?: string
  MessagingBindingProxyAddress?: string
  Source?: string
  RetryCount?: string
  DateCreated?: string
  DateUpdated?: string
  ClientIdentity?: string
  Reason?: string
  State?: ConversationState
}
