/**
 * Firebase Cloud Messaging Type Definitions
 *
 * Types for the FCM Push Notification API compatibility layer.
 * Compatible with Firebase Admin SDK messaging API.
 *
 * @see https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * FCM error codes
 */
export type FCMErrorCode =
  | 'messaging/invalid-argument'
  | 'messaging/invalid-recipient'
  | 'messaging/invalid-payload'
  | 'messaging/invalid-data-payload-key'
  | 'messaging/payload-size-limit-exceeded'
  | 'messaging/invalid-options'
  | 'messaging/invalid-registration-token'
  | 'messaging/registration-token-not-registered'
  | 'messaging/mismatched-credential'
  | 'messaging/invalid-package-name'
  | 'messaging/message-rate-exceeded'
  | 'messaging/device-message-rate-exceeded'
  | 'messaging/topics-message-rate-exceeded'
  | 'messaging/too-many-topics'
  | 'messaging/invalid-apns-credentials'
  | 'messaging/server-unavailable'
  | 'messaging/internal-error'
  | 'messaging/unknown-error'
  | 'messaging/third-party-auth-error'
  | 'messaging/quota-exceeded'
  | 'messaging/authentication-error'

/**
 * FCM error response
 */
export interface FCMErrorResponse {
  code: FCMErrorCode
  message: string
  details?: unknown
}

// =============================================================================
// Notification Payload Types
// =============================================================================

/**
 * Basic notification configuration
 */
export interface Notification {
  title?: string
  body?: string
  imageUrl?: string
}

/**
 * Android notification configuration
 */
export interface AndroidNotification {
  title?: string
  body?: string
  icon?: string
  color?: string
  sound?: string
  tag?: string
  clickAction?: string
  bodyLocKey?: string
  bodyLocArgs?: string[]
  titleLocKey?: string
  titleLocArgs?: string[]
  channelId?: string
  ticker?: string
  sticky?: boolean
  eventTime?: Date
  localOnly?: boolean
  notificationPriority?: 'PRIORITY_MIN' | 'PRIORITY_LOW' | 'PRIORITY_DEFAULT' | 'PRIORITY_HIGH' | 'PRIORITY_MAX'
  defaultSound?: boolean
  defaultVibrateTimings?: boolean
  defaultLightSettings?: boolean
  vibrateTimings?: string[]
  visibility?: 'VISIBILITY_UNSPECIFIED' | 'PRIVATE' | 'PUBLIC' | 'SECRET'
  notificationCount?: number
  lightSettings?: LightSettings
  image?: string
}

/**
 * Light settings for Android notifications
 */
export interface LightSettings {
  color: {
    red: number
    green: number
    blue: number
    alpha: number
  }
  lightOnDuration: string
  lightOffDuration: string
}

/**
 * Android FCM options
 */
export interface AndroidFcmOptions {
  analyticsLabel?: string
}

/**
 * Android-specific message configuration
 */
export interface AndroidConfig {
  collapseKey?: string
  priority?: 'high' | 'normal'
  ttl?: string
  restrictedPackageName?: string
  data?: Record<string, string>
  notification?: AndroidNotification
  fcmOptions?: AndroidFcmOptions
  directBootOk?: boolean
}

/**
 * APS alert configuration for iOS
 */
export interface ApsAlert {
  title?: string
  subtitle?: string
  body?: string
  locKey?: string
  locArgs?: string[]
  titleLocKey?: string
  titleLocArgs?: string[]
  subtitleLocKey?: string
  subtitleLocArgs?: string[]
  actionLocKey?: string
  launchImage?: string
}

/**
 * APS configuration for iOS
 */
export interface Aps {
  alert?: string | ApsAlert
  badge?: number
  sound?: string | CriticalSound
  contentAvailable?: boolean
  mutableContent?: boolean
  category?: string
  threadId?: string
  targetContentId?: string
}

/**
 * Critical sound for iOS
 */
export interface CriticalSound {
  name: string
  critical?: boolean
  volume?: number
}

/**
 * APNS FCM options
 */
export interface ApnsFcmOptions {
  analyticsLabel?: string
  image?: string
}

/**
 * APNS payload configuration
 */
export interface ApnsPayload {
  aps: Aps
  [key: string]: unknown
}

/**
 * APNS-specific message configuration (iOS)
 */
export interface ApnsConfig {
  headers?: Record<string, string>
  payload?: ApnsPayload
  fcmOptions?: ApnsFcmOptions
}

/**
 * Web push notification configuration
 */
export interface WebpushNotification {
  title?: string
  body?: string
  icon?: string
  badge?: string
  image?: string
  language?: string
  tag?: string
  data?: Record<string, unknown>
  vibrate?: number[]
  renotify?: boolean
  requireInteraction?: boolean
  silent?: boolean
  timestamp?: number
  actions?: WebpushNotificationAction[]
  dir?: 'auto' | 'ltr' | 'rtl'
}

/**
 * Web push notification action
 */
export interface WebpushNotificationAction {
  action: string
  title: string
  icon?: string
}

/**
 * Web push FCM options
 */
export interface WebpushFcmOptions {
  link?: string
  analyticsLabel?: string
}

/**
 * Webpush-specific message configuration
 */
export interface WebpushConfig {
  headers?: Record<string, string>
  data?: Record<string, string>
  notification?: WebpushNotification
  fcmOptions?: WebpushFcmOptions
}

/**
 * FCM options for all platforms
 */
export interface FcmOptions {
  analyticsLabel?: string
}

// =============================================================================
// Message Types
// =============================================================================

/**
 * Base message configuration (shared across all message types)
 */
export interface BaseMessage {
  data?: Record<string, string>
  notification?: Notification
  android?: AndroidConfig
  webpush?: WebpushConfig
  apns?: ApnsConfig
  fcmOptions?: FcmOptions
}

/**
 * Message with single token target
 */
export interface TokenMessage extends BaseMessage {
  token: string
}

/**
 * Message with topic target
 */
export interface TopicMessage extends BaseMessage {
  topic: string
}

/**
 * Message with condition target
 */
export interface ConditionMessage extends BaseMessage {
  condition: string
}

/**
 * Union type for all message types
 */
export type Message = TokenMessage | TopicMessage | ConditionMessage

/**
 * Multicast message (send to multiple tokens)
 */
export interface MulticastMessage extends BaseMessage {
  tokens: string[]
}

// =============================================================================
// Response Types
// =============================================================================

/**
 * Response from sending a single message
 */
export interface SendResponse {
  success: boolean
  messageId?: string
  error?: FCMErrorResponse
}

/**
 * Response from sending to multiple tokens
 */
export interface BatchResponse {
  responses: SendResponse[]
  successCount: number
  failureCount: number
}

/**
 * Topic management response
 */
export interface TopicManagementResponse {
  successCount: number
  failureCount: number
  errors?: {
    index: number
    error: FCMErrorResponse
  }[]
}

// =============================================================================
// Topic Types
// =============================================================================

/**
 * Topic subscription parameters
 */
export interface TopicSubscriptionParams {
  topic: string
  tokens: string[]
}

/**
 * Topic unsubscription parameters
 */
export interface TopicUnsubscriptionParams {
  topic: string
  tokens: string[]
}

// =============================================================================
// Dry Run Types
// =============================================================================

/**
 * Options for sending messages
 */
export interface SendOptions {
  dryRun?: boolean
}

// =============================================================================
// Analytics Types
// =============================================================================

/**
 * Message delivery stats
 */
export interface MessageDeliveryStats {
  messageId: string
  sent: number
  delivered: number
  opened: number
  errors: number
  timestamp: string
}

/**
 * Topic stats
 */
export interface TopicStats {
  topic: string
  subscriberCount: number
  messagesSent: number
  lastMessageAt?: string
}

// =============================================================================
// Client Configuration
// =============================================================================

/**
 * Service account credentials
 */
export interface ServiceAccountCredentials {
  projectId: string
  clientEmail: string
  privateKey: string
}

/**
 * FCM client configuration
 */
export interface FCMClientConfig {
  credential: ServiceAccountCredentials
  projectId?: string
  timeout?: number
  fetch?: typeof fetch
  autoRetry?: boolean
  maxRetries?: number
  databaseURL?: string
}

/**
 * Request options for API calls
 */
export interface RequestOptions {
  timeout?: number
  signal?: AbortSignal
  dryRun?: boolean
}

// =============================================================================
// Condition Builder Types
// =============================================================================

/**
 * Topic condition operators
 */
export type ConditionOperator = 'AND' | 'OR' | 'NOT'

/**
 * Topic condition node
 */
export interface ConditionNode {
  type: 'topic' | 'operator'
  value?: string
  operator?: ConditionOperator
  left?: ConditionNode
  right?: ConditionNode
}

// =============================================================================
// Legacy Types (for HTTP v1 API compatibility)
// =============================================================================

/**
 * Legacy downstream message format
 */
export interface LegacyMessage {
  to?: string
  registration_ids?: string[]
  condition?: string
  collapse_key?: string
  priority?: 'high' | 'normal'
  content_available?: boolean
  mutable_content?: boolean
  time_to_live?: number
  restricted_package_name?: string
  dry_run?: boolean
  data?: Record<string, string>
  notification?: {
    title?: string
    body?: string
    android_channel_id?: string
    icon?: string
    sound?: string
    badge?: string
    tag?: string
    color?: string
    click_action?: string
    body_loc_key?: string
    body_loc_args?: string[]
    title_loc_key?: string
    title_loc_args?: string[]
  }
}

/**
 * Legacy response format
 */
export interface LegacyResponse {
  multicast_id: number
  success: number
  failure: number
  canonical_ids: number
  results: {
    message_id?: string
    registration_id?: string
    error?: string
  }[]
}

// =============================================================================
// Batch Message Types
// =============================================================================

/**
 * Message with ID for batch operations
 */
export interface MessageWithId {
  id: string
  message: Message
}

/**
 * Batch send response
 */
export interface BatchSendResponse {
  responses: {
    id: string
    success: boolean
    messageId?: string
    error?: FCMErrorResponse
  }[]
  successCount: number
  failureCount: number
}
