/**
 * OneSignal Type Definitions
 *
 * Types for the OneSignal Push Notification API compatibility layer.
 * Compatible with OneSignal REST API v1.
 *
 * @see https://documentation.onesignal.com/reference/create-notification
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * OneSignal error response
 */
export interface OneSignalErrorResponse {
  errors: string[]
}

/**
 * Generic response with optional warnings
 */
export interface OneSignalResponse {
  id?: string
  recipients?: number
  external_id?: string | null
  errors?: string[]
  warnings?: string[]
}

// =============================================================================
// Notification Types
// =============================================================================

/**
 * Target device types for notifications
 */
export type DeviceType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 13 | 14

/**
 * Button action for notifications
 */
export interface NotificationButton {
  id: string
  text: string
  icon?: string
  url?: string
}

/**
 * Web button for web push notifications
 */
export interface WebButton {
  id: string
  text: string
  icon?: string
  url?: string
}

/**
 * iOS category for interactive notifications
 */
export interface IOSCategory {
  id: string
  buttons?: NotificationButton[]
}

/**
 * Filter for targeting users
 */
export interface NotificationFilter {
  field: 'tag' | 'country' | 'app_version' | 'amount_spent' | 'bought_sku' | 'language' | 'email' | 'first_session' | 'last_session' | 'session_count' | 'session_time' | 'location'
  key?: string
  relation?: '>' | '<' | '=' | '!=' | 'exists' | 'not_exists' | 'time_elapsed_gt' | 'time_elapsed_lt'
  value?: string | number
  hours_ago?: number
  radius?: number
  lat?: number
  long?: number
}

/**
 * Operator for combining filters
 */
export interface FilterOperator {
  operator: 'OR' | 'AND'
}

/**
 * Filter entry (filter or operator)
 */
export type FilterEntry = NotificationFilter | FilterOperator

/**
 * Notification content for different languages
 */
export type LocalizedContent = {
  en?: string
  es?: string
  fr?: string
  de?: string
  pt?: string
  ja?: string
  ko?: string
  zh?: string
  ru?: string
  it?: string
  nl?: string
  ar?: string
  hi?: string
  [key: string]: string | undefined
}

/**
 * Notification creation parameters
 */
export interface NotificationCreateParams {
  // App
  app_id: string

  // Targeting - must include one of these
  included_segments?: string[]
  excluded_segments?: string[]
  include_player_ids?: string[]
  include_external_user_ids?: string[]
  include_email_tokens?: string[]
  include_phone_numbers?: string[]
  include_aliases?: Record<string, string[]>
  filters?: FilterEntry[]

  // Content
  contents?: LocalizedContent
  headings?: LocalizedContent
  subtitle?: LocalizedContent
  template_id?: string
  content_available?: boolean
  mutable_content?: boolean

  // Attachments & Actions
  data?: Record<string, unknown>
  url?: string
  web_url?: string
  app_url?: string
  ios_attachments?: Record<string, string>
  big_picture?: string
  chrome_web_image?: string
  adm_big_picture?: string
  chrome_big_picture?: string
  buttons?: NotificationButton[]
  web_buttons?: WebButton[]
  ios_category?: string
  android_channel_id?: string
  huawei_channel_id?: string
  existing_android_channel_id?: string

  // Appearance
  android_accent_color?: string
  huawei_accent_color?: string
  android_led_color?: string
  huawei_led_color?: string
  android_visibility?: -1 | 0 | 1
  huawei_visibility?: -1 | 0 | 1
  ios_badgeType?: 'None' | 'SetTo' | 'Increase'
  ios_badgeCount?: number
  collapse_id?: string
  apns_alert?: Record<string, unknown>

  // Delivery
  send_after?: string | Date
  delayed_option?: 'timezone' | 'last-active'
  delivery_time_of_day?: string
  throttle_rate_per_minute?: number

  // Sound
  ios_sound?: string
  android_sound?: string
  huawei_sound?: string
  wp_wns_sound?: string

  // Grouping
  android_group?: string
  android_group_message?: LocalizedContent

  // TTL
  ttl?: number
  priority?: number

  // A/B Testing
  is_ios?: boolean
  is_android?: boolean
  is_huawei?: boolean
  is_any_web?: boolean
  is_chrome_web?: boolean
  is_firefox?: boolean
  is_safari?: boolean
  is_wp_wns?: boolean
  is_adm?: boolean
  is_chrome?: boolean

  // Email
  email_subject?: string
  email_body?: string
  email_from_name?: string
  email_from_address?: string
  email_preheader?: string
  disable_email_click_tracking?: boolean

  // SMS
  sms_from?: string
  sms_media_urls?: string[]

  // Other
  external_id?: string
  name?: string
  target_channel?: 'push' | 'email' | 'sms'

  // Idempotency
  idempotency_key?: string
}

/**
 * Notification object returned from API
 */
export interface Notification {
  id: string
  app_id: string
  contents?: LocalizedContent
  headings?: LocalizedContent
  subtitle?: LocalizedContent
  data?: Record<string, unknown>
  url?: string
  send_after?: string
  delayed_option?: string
  delivery_time_of_day?: string
  template_id?: string
  external_id?: string | null

  // Stats
  successful?: number
  failed?: number
  errored?: number
  converted?: number
  remaining?: number
  queued_at?: number
  completed_at?: string | null
  canceled?: boolean
  received?: number

  // Targeting
  included_segments?: string[]
  excluded_segments?: string[]
  filters?: FilterEntry[]

  // Platform specific
  isIos?: boolean
  isAndroid?: boolean
  isHuawei?: boolean
  isAnyWeb?: boolean
  isEmail?: boolean
  isSMS?: boolean

  // Timestamps
  created_at?: string
  updated_at?: string
}

/**
 * Notification list response
 */
export interface NotificationListResponse {
  notifications: Notification[]
  total_count: number
  offset: number
  limit: number
}

/**
 * Notification view response
 */
export interface NotificationViewResponse extends Notification {
  platform_delivery_stats?: {
    ios?: { success: number; failed: number; errored: number }
    android?: { success: number; failed: number; errored: number }
    web?: { success: number; failed: number; errored: number }
    email?: { success: number; failed: number; errored: number }
    sms?: { success: number; failed: number; errored: number }
  }
}

/**
 * Outcome data for analytics
 */
export interface OutcomeData {
  id: string
  value: number
  aggregation: 'sum' | 'count'
}

/**
 * Notification history entry
 */
export interface NotificationHistoryEntry {
  notification_id: string
  events: {
    event: string
    time: number
    count?: number
  }[]
}

// =============================================================================
// Device/Player Types
// =============================================================================

/**
 * Device/Player information
 */
export interface Device {
  id: string
  identifier?: string
  session_count: number
  language: string
  timezone: number
  game_version?: string
  device_os: string
  device_type: DeviceType
  device_model?: string
  ad_id?: string
  tags?: Record<string, string>
  last_active: number
  playtime?: number
  amount_spent: number
  created_at: number
  invalid_identifier: boolean
  badge_count?: number
  sdk?: string
  test_type?: number
  ip?: string
  external_user_id?: string
  notification_types?: number
  long?: number
  lat?: number
  country?: string

  // Web
  web_auth?: string
  web_p256?: string
}

/**
 * Device creation parameters
 */
export interface DeviceCreateParams {
  app_id: string
  device_type: DeviceType
  identifier?: string
  language?: string
  timezone?: number
  game_version?: string
  device_model?: string
  device_os?: string
  ad_id?: string
  sdk?: string
  session_count?: number
  tags?: Record<string, string>
  amount_spent?: number
  created_at?: number
  playtime?: number
  badge_count?: number
  last_active?: number
  notification_types?: number
  test_type?: number
  long?: number
  lat?: number
  country?: string
  external_user_id?: string

  // Web push specific
  web_auth?: string
  web_p256?: string
}

/**
 * Device update parameters
 */
export interface DeviceUpdateParams {
  app_id?: string
  identifier?: string
  language?: string
  timezone?: number
  game_version?: string
  device_model?: string
  device_os?: string
  ad_id?: string
  sdk?: string
  session_count?: number
  tags?: Record<string, string>
  amount_spent?: number
  playtime?: number
  badge_count?: number
  last_active?: number
  notification_types?: number
  test_type?: number
  long?: number
  lat?: number
  country?: string
  external_user_id?: string
  external_user_id_auth_hash?: string

  // Web push specific
  web_auth?: string
  web_p256?: string
}

/**
 * Device list response
 */
export interface DeviceListResponse {
  players: Device[]
  total_count: number
  offset: number
  limit: number
}

/**
 * Device CSV export response
 */
export interface DeviceExportResponse {
  csv_file_url: string
}

// =============================================================================
// Segment Types
// =============================================================================

/**
 * Segment filter
 */
export interface SegmentFilter {
  field: string
  key?: string
  relation: string
  value: string | number
  hours_ago?: number
}

/**
 * Segment information
 */
export interface Segment {
  id: string
  name: string
  created_at: string
  updated_at: string
  is_active: boolean
  filter?: SegmentFilter[]
  read_only?: boolean
}

/**
 * Segment creation parameters
 */
export interface SegmentCreateParams {
  name: string
  filters: FilterEntry[]
}

/**
 * Segment list response
 */
export interface SegmentListResponse {
  segments: Segment[]
  total_count: number
  offset: number
  limit: number
}

// =============================================================================
// Template Types
// =============================================================================

/**
 * Template information
 */
export interface Template {
  id: string
  name: string
  contents?: LocalizedContent
  headings?: LocalizedContent
  subtitle?: LocalizedContent
  url?: string
  buttons?: NotificationButton[]
  web_buttons?: WebButton[]
  data?: Record<string, unknown>

  // Platform specific
  ios_sound?: string
  android_sound?: string
  android_channel_id?: string
  chrome_web_image?: string
  big_picture?: string

  created_at?: string
  updated_at?: string
}

/**
 * Template creation parameters
 */
export interface TemplateCreateParams {
  name: string
  contents?: LocalizedContent
  headings?: LocalizedContent
  subtitle?: LocalizedContent
  url?: string
  buttons?: NotificationButton[]
  web_buttons?: WebButton[]
  data?: Record<string, unknown>

  // Platform specific
  ios_sound?: string
  android_sound?: string
  android_channel_id?: string
  chrome_web_image?: string
  big_picture?: string
}

/**
 * Template update parameters
 */
export interface TemplateUpdateParams extends Partial<TemplateCreateParams> {}

/**
 * Template list response
 */
export interface TemplateListResponse {
  templates: Template[]
  total_count: number
  offset: number
  limit: number
}

// =============================================================================
// App Types
// =============================================================================

/**
 * OneSignal App
 */
export interface App {
  id: string
  name: string
  players: number
  messageable_players: number
  updated_at: string
  created_at: string
  android_gcm_sender_id?: string
  gcm_key?: string
  chrome_web_origin?: string
  chrome_web_default_notification_icon?: string
  chrome_web_sub_domain?: string
  apns_env?: 'sandbox' | 'production'
  apns_certificates?: string
  apns_p8?: string
  apns_team_id?: string
  apns_key_id?: string
  apns_bundle_id?: string
  safari_apns_p12?: string
  safari_apns_certificate?: string
  safari_site_origin?: string
  safari_push_id?: string
  safari_icon_16_16?: string
  safari_icon_32_32?: string
  safari_icon_64_64?: string
  safari_icon_128_128?: string
  safari_icon_256_256?: string
  site_name?: string
  basic_auth_key?: string
  additional_data_is_root_payload?: boolean
}

/**
 * App creation parameters
 */
export interface AppCreateParams {
  name: string
  android_gcm_sender_id?: string
  gcm_key?: string
  chrome_web_origin?: string
  chrome_web_default_notification_icon?: string
  chrome_web_sub_domain?: string
  apns_env?: 'sandbox' | 'production'
  apns_p12?: string
  apns_p12_password?: string
  apns_p8?: string
  apns_team_id?: string
  apns_key_id?: string
  apns_bundle_id?: string
  safari_apns_p12?: string
  safari_apns_p12_password?: string
  safari_site_origin?: string
  safari_push_id?: string
  safari_icon_256_256?: string
  site_name?: string
  organization_id?: string
}

/**
 * App update parameters
 */
export interface AppUpdateParams extends Partial<AppCreateParams> {}

// =============================================================================
// Outcome Types
// =============================================================================

/**
 * Outcome for analytics
 */
export interface Outcome {
  id: string
  value: number
  aggregation: 'sum' | 'count'
}

/**
 * Outcome request parameters
 */
export interface OutcomeParams {
  outcome_names: string[]
  outcome_time_range?: 'hour' | '1h' | 'day' | '1d' | 'week' | '7d' | 'month' | '30d'
  outcome_platforms?: ('ios' | 'android' | 'web')[]
  outcome_attribution?: 'total' | 'direct' | 'influenced'
}

/**
 * Outcome response
 */
export interface OutcomeResponse {
  outcomes: Outcome[]
}

// =============================================================================
// A/B Testing Types
// =============================================================================

/**
 * A/B test variant
 */
export interface ABTestVariant {
  id: string
  name: string
  contents?: LocalizedContent
  headings?: LocalizedContent
  weight?: number
}

/**
 * A/B test configuration
 */
export interface ABTestConfig {
  variants: ABTestVariant[]
  metric: 'clicks' | 'conversions' | 'opens'
  duration_hours?: number
  winner_selection?: 'automatic' | 'manual'
}

/**
 * A/B test results
 */
export interface ABTestResults {
  notification_id: string
  variants: {
    id: string
    name: string
    sent: number
    opened: number
    clicked: number
    converted: number
    rate: number
    is_winner?: boolean
  }[]
  status: 'running' | 'completed' | 'manual_selection_needed'
}

// =============================================================================
// Client Configuration
// =============================================================================

/**
 * OneSignal client configuration
 */
export interface OneSignalClientConfig {
  appId: string
  apiKey: string
  userAuthKey?: string
  baseUrl?: string
  timeout?: number
  fetch?: typeof fetch
  autoRetry?: boolean
  maxRetries?: number
}

/**
 * Request options for API calls
 */
export interface RequestOptions {
  timeout?: number
  signal?: AbortSignal
  idempotencyKey?: string
}
