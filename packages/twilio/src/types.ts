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
