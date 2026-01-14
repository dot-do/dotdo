/**
 * @dotdo/mixpanel - Type Definitions
 *
 * TypeScript types for Mixpanel SDK compatibility layer.
 * Matches the official mixpanel npm package API.
 *
 * @module @dotdo/mixpanel/types
 */

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Mixpanel SDK configuration options.
 */
export interface MixpanelConfig {
  /** Project token */
  token: string
  /** API host (default: https://api.mixpanel.com) */
  host?: string
  /** Path for track API (default: /track) */
  trackPath?: string
  /** Path for engage API (default: /engage) */
  engagePath?: string
  /** Path for groups API (default: /groups) */
  groupsPath?: string
  /** Enable debug logging */
  debug?: boolean
  /** Secret for server-side API calls */
  secret?: string
  /** Keep query parameters in URL */
  keepQueryParameters?: boolean
  /** Batch events before sending */
  batch?: boolean
  /** Batch size threshold */
  batchSize?: number
  /** Batch flush interval in ms */
  batchFlushInterval?: number
  /** Max retry attempts */
  maxRetries?: number
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Properties for track events.
 */
export interface TrackProperties {
  /** Event timestamp (seconds since epoch) */
  time?: number
  /** IP address for geo lookup */
  ip?: string | boolean
  /** Insert ID for deduplication */
  $insert_id?: string
  /** User's browser */
  $browser?: string
  /** Browser version */
  $browser_version?: string
  /** Current URL */
  $current_url?: string
  /** Device type */
  $device?: string
  /** OS */
  $os?: string
  /** Screen height */
  $screen_height?: number
  /** Screen width */
  $screen_width?: number
  /** Search engine */
  $search_engine?: string
  /** Referrer */
  $referrer?: string
  /** Initial referrer */
  $initial_referrer?: string
  /** UTM source */
  utm_source?: string
  /** UTM medium */
  utm_medium?: string
  /** UTM campaign */
  utm_campaign?: string
  /** UTM term */
  utm_term?: string
  /** UTM content */
  utm_content?: string
  /** Other properties */
  [key: string]: unknown
}

/**
 * Base event structure for tracking.
 */
export interface TrackEvent {
  /** Event name */
  event: string
  /** Event properties */
  properties: TrackProperties & {
    /** Project token */
    token: string
    /** Distinct ID */
    distinct_id: string
  }
}

/**
 * Callback for event operations.
 */
export type Callback = (err?: Error) => void

// =============================================================================
// People (User Profiles) Types
// =============================================================================

/**
 * People profile properties.
 */
export interface PeopleProperties {
  /** Email address */
  $email?: string
  /** First name */
  $first_name?: string
  /** Last name */
  $last_name?: string
  /** Full name */
  $name?: string
  /** Phone number */
  $phone?: string
  /** Created timestamp */
  $created?: string | Date
  /** City */
  $city?: string
  /** Region */
  $region?: string
  /** Country code */
  $country_code?: string
  /** Timezone */
  $timezone?: string
  /** Custom properties */
  [key: string]: unknown
}

/**
 * People operation types.
 */
export type PeopleOperationType =
  | '$set'
  | '$set_once'
  | '$add'
  | '$append'
  | '$union'
  | '$remove'
  | '$unset'
  | '$delete'

/**
 * People update payload.
 */
export interface PeopleUpdate {
  /** Project token */
  $token: string
  /** Distinct ID */
  $distinct_id: string
  /** IP address for geo */
  $ip?: string | boolean
  /** Ignore time */
  $ignore_time?: boolean
  /** Ignore alias */
  $ignore_alias?: boolean
  /** Operation-specific data */
  $set?: PeopleProperties
  $set_once?: PeopleProperties
  $add?: Record<string, number>
  $append?: Record<string, unknown>
  $union?: Record<string, unknown[]>
  $remove?: Record<string, unknown>
  $unset?: string[]
  $delete?: boolean
}

/**
 * People analytics class interface.
 */
export interface People {
  /** Set user properties */
  set(distinctId: string, properties: PeopleProperties, callback?: Callback): void
  set(distinctId: string, property: string, value: unknown, callback?: Callback): void

  /** Set user property only if not already set */
  set_once(distinctId: string, properties: PeopleProperties, callback?: Callback): void
  set_once(distinctId: string, property: string, value: unknown, callback?: Callback): void

  /** Increment numeric property */
  increment(distinctId: string, properties: Record<string, number>, callback?: Callback): void
  increment(distinctId: string, property: string, value?: number, callback?: Callback): void

  /** Append to list property */
  append(distinctId: string, properties: Record<string, unknown>, callback?: Callback): void
  append(distinctId: string, property: string, value: unknown, callback?: Callback): void

  /** Union with list property */
  union(distinctId: string, properties: Record<string, unknown[]>, callback?: Callback): void
  union(distinctId: string, property: string, values: unknown[], callback?: Callback): void

  /** Remove from list property */
  remove(distinctId: string, properties: Record<string, unknown>, callback?: Callback): void
  remove(distinctId: string, property: string, value: unknown, callback?: Callback): void

  /** Unset (delete) properties */
  unset(distinctId: string, properties: string[], callback?: Callback): void
  unset(distinctId: string, property: string, callback?: Callback): void

  /** Delete the user profile */
  deleteUser(distinctId: string, callback?: Callback): void

  /** Track revenue (alias for track_charge) */
  track_charge(distinctId: string, amount: number, properties?: Record<string, unknown>, callback?: Callback): void

  /** Clear all charges */
  clear_charges(distinctId: string, callback?: Callback): void
}

// =============================================================================
// Groups Types
// =============================================================================

/**
 * Group properties.
 */
export interface GroupProperties {
  /** Group name */
  $name?: string
  /** Custom properties */
  [key: string]: unknown
}

/**
 * Group update payload.
 */
export interface GroupUpdate {
  /** Project token */
  $token: string
  /** Group key */
  $group_key: string
  /** Group ID */
  $group_id: string
  /** Operation-specific data */
  $set?: GroupProperties
  $set_once?: GroupProperties
  $add?: Record<string, number>
  $append?: Record<string, unknown>
  $union?: Record<string, unknown[]>
  $remove?: Record<string, unknown>
  $unset?: string[]
  $delete?: boolean
}

/**
 * Groups analytics class interface.
 */
export interface Groups {
  /** Set group properties */
  set(groupKey: string, groupId: string, properties: GroupProperties, callback?: Callback): void
  set(groupKey: string, groupId: string, property: string, value: unknown, callback?: Callback): void

  /** Set group property only if not already set */
  set_once(groupKey: string, groupId: string, properties: GroupProperties, callback?: Callback): void
  set_once(groupKey: string, groupId: string, property: string, value: unknown, callback?: Callback): void

  /** Delete the group */
  deleteGroup(groupKey: string, groupId: string, callback?: Callback): void

  /** Remove a property value from a list */
  remove(groupKey: string, groupId: string, properties: Record<string, unknown>, callback?: Callback): void
  remove(groupKey: string, groupId: string, property: string, value: unknown, callback?: Callback): void

  /** Union with list property */
  union(groupKey: string, groupId: string, properties: Record<string, unknown[]>, callback?: Callback): void
  union(groupKey: string, groupId: string, property: string, values: unknown[], callback?: Callback): void

  /** Unset (delete) properties */
  unset(groupKey: string, groupId: string, properties: string[], callback?: Callback): void
}

// =============================================================================
// Import Types
// =============================================================================

/**
 * Event for import endpoint.
 */
export interface ImportEvent {
  /** Event name */
  event: string
  /** Event properties (must include distinct_id and time) */
  properties: {
    distinct_id: string
    time: number
    [key: string]: unknown
  }
}

/**
 * Import response.
 */
export interface ImportResponse {
  code: number
  num_records_imported: number
  error?: string
}

// =============================================================================
// Export/Query Types
// =============================================================================

/**
 * Export query options.
 */
export interface ExportOptions {
  /** Start date (YYYY-MM-DD) */
  from_date: string
  /** End date (YYYY-MM-DD) */
  to_date: string
  /** Limit number of results */
  limit?: number
  /** Event name filter */
  event?: string | string[]
  /** Property filter expression */
  where?: string
}

/**
 * JQL query options.
 */
export interface JQLOptions {
  /** JQL script */
  script: string
  /** Script parameters */
  params?: Record<string, unknown>
}

/**
 * Funnel query options.
 */
export interface FunnelOptions {
  /** Funnel ID */
  funnel_id: number
  /** Start date */
  from_date?: string
  /** End date */
  to_date?: string
  /** Length in days */
  length?: number
  /** Unit (day, week, month) */
  unit?: 'day' | 'week' | 'month'
  /** Segmentation property */
  on?: string
  /** Property filter */
  where?: string
  /** Limit */
  limit?: number
}

/**
 * Segmentation query options.
 */
export interface SegmentationOptions {
  /** Event name */
  event: string
  /** Start date */
  from_date: string
  /** End date */
  to_date: string
  /** Segmentation property */
  on?: string
  /** Property filter */
  where?: string
  /** Aggregation type */
  type?: 'general' | 'unique' | 'average'
  /** Unit (minute, hour, day, week, month) */
  unit?: 'minute' | 'hour' | 'day' | 'week' | 'month'
}

/**
 * Retention query options.
 */
export interface RetentionOptions {
  /** Start date */
  from_date: string
  /** End date */
  to_date: string
  /** Born event */
  born_event?: string
  /** Return event */
  event?: string
  /** Born property filter */
  born_where?: string
  /** Return property filter */
  where?: string
  /** Interval count */
  interval_count?: number
  /** Unit (day, week, month) */
  unit?: 'day' | 'week' | 'month'
  /** Retention type */
  retention_type?: 'birth' | 'compounded'
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Track API response.
 */
export interface TrackResponse {
  status: 1 | 0
  error?: string
}

/**
 * Engage API response.
 */
export interface EngageResponse {
  status: 1 | 0
  error?: string
}

/**
 * Query result.
 */
export interface QueryResult<T = unknown> {
  results?: T
  error?: string
  computed_at?: string
}

// =============================================================================
// Transport Types
// =============================================================================

/**
 * Transport interface for sending events.
 */
export interface Transport {
  /** Send track events */
  track(events: TrackEvent[]): Promise<TrackResponse>
  /** Send engage (people) updates */
  engage(updates: PeopleUpdate[]): Promise<EngageResponse>
  /** Send group updates */
  groups(updates: GroupUpdate[]): Promise<EngageResponse>
}
