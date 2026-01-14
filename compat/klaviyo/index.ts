/**
 * @dotdo/klaviyo - Klaviyo-compatible marketing automation SDK
 *
 * Drop-in replacement for the Klaviyo API backed by Durable Objects.
 * Provides flow automation, email marketing, SMS, and customer data platform features.
 *
 * @see https://developers.klaviyo.com/en/reference/api-overview
 */

// ============================================================================
// Types
// ============================================================================

export type FlowStatus = 'draft' | 'live' | 'manual'

export type FlowTriggerType = 'metric' | 'list' | 'segment' | 'date' | 'price_drop' | 'back_in_stock'

export type FlowActionType = 'email' | 'sms' | 'push' | 'webhook' | 'update_profile'

export type FlowConditionOperator =
  | 'equals'
  | 'not-equals'
  | 'greater-than'
  | 'less-than'
  | 'contains'
  | 'not-contains'
  | 'in'
  | 'not-in'
  | 'is-set'
  | 'is-not-set'
  | 'has-done'
  | 'has-not-done'
  | 'count-greater-than'
  | 'is-member'
  | 'is-not-member'

export interface Flow {
  id: string
  type: 'flow'
  attributes: FlowAttributes
  relationships?: FlowRelationships
}

export interface FlowAttributes {
  name: string
  status: FlowStatus
  trigger_type: FlowTriggerType
  trigger?: FlowTriggerConfig
  archived?: boolean
  created_at: string
  updated_at: string
}

export interface FlowTriggerConfig {
  metric_id?: string
  list_id?: string
  segment_id?: string
  date_property?: string
  offset_days?: number
  time_of_day?: string
  timezone?: string
  trigger_on?: 'subscribe' | 'enter' | 'exit'
  filter?: FlowFilterConfig
  catalog_id?: string
  price_drop_percentage?: number
  lookback_days?: number
}

export interface FlowFilterConfig {
  type: 'and' | 'or'
  conditions: Array<FlowConditionExpression | FlowFilterConfig>
}

export interface FlowConditionExpression {
  type?: string
  property?: string
  operator: FlowConditionOperator
  value?: unknown
}

export interface FlowRelationships {
  'flow-actions'?: { data: Array<{ type: 'flow-action'; id: string }> }
}

export interface FlowAction {
  id: string
  type: 'flow-action'
  attributes: FlowActionAttributes
  relationships?: {
    flow?: { data: { type: 'flow'; id: string } }
  }
}

export interface FlowActionAttributes {
  action_type: FlowActionType
  settings: FlowActionSettings
  position?: number
  time_window?: TimeWindowConfig
}

export interface FlowActionSettings {
  template_id?: string
  subject?: string
  from_email?: string
  from_name?: string
  message?: string
  media_url?: string
  sender_id?: string
  require_consent?: boolean
  consent_list_id?: string
  title?: string
  body?: string
  icon?: string
  click_action?: string
  url?: string
  method?: string
  headers?: Record<string, string>
  tracking?: TrackingConfig
  dynamic_data?: Record<string, string>
  properties?: Record<string, unknown>
  add_to_lists?: string[]
  remove_from_lists?: string[]
  retry?: RetryConfig
}

export interface TrackingConfig {
  opens?: boolean
  clicks?: boolean
  utm_params?: Record<string, string>
}

export interface RetryConfig {
  max_attempts?: number
  backoff_multiplier?: number
  initial_delay_seconds?: number
}

export interface TimeWindowConfig {
  enabled: boolean
  days: string[]
  start_hour: number
  end_hour: number
  timezone: 'account' | 'recipient'
  queue_outside_window?: boolean
}

export interface FlowTrigger {
  id: string
  type: 'flow-trigger'
  attributes: {
    trigger_type: FlowTriggerType
    config: FlowTriggerConfig
  }
}

export interface FlowCondition {
  id: string
  type: 'flow-condition'
  attributes: {
    condition_type: 'conditional_split' | 'trigger_split'
    expression: FlowConditionExpression | FlowFilterConfig
    branches?: {
      yes?: { next_action_id: string }
      no?: { next_action_id: string }
    }
  }
}

export interface FlowDelay {
  id: string
  type: 'flow-delay'
  attributes: FlowDelayAttributes
}

export interface FlowDelayAttributes {
  delay_type: 'fixed' | 'smart_send' | 'wait_for_event' | 'dynamic'
  duration?: {
    value: number
    unit: 'minutes' | 'hours' | 'days' | 'weeks'
  }
  send_time?: {
    hour: number
    minute: number
    timezone?: string
    day_of_week?: string
  }
  wait_for?: {
    metric_name: string
    timeout: { value: number; unit: string }
    on_timeout?: 'continue' | 'exit'
    on_event?: 'continue' | 'exit'
  }
  dynamic_duration?: {
    source: 'profile_property' | 'event_property'
    property: string
    unit: string
    fallback: number
  }
}

// ============================================================================
// Client
// ============================================================================

export interface KlaviyoClientOptions {
  apiKey: string
  baseUrl?: string
}

/**
 * Klaviyo-compatible client for flow automation and marketing
 *
 * TODO: Implement this class in the GREEN phase
 */
export class KlaviyoClient {
  public Flows: FlowsAPI
  public FlowActions: FlowActionsAPI
  public FlowConditions: FlowConditionsAPI
  public FlowDelays: FlowDelaysAPI
  public FlowExecutions: FlowExecutionsAPI
  public Events: EventsAPI
  public Profiles: ProfilesAPI
  public Lists: ListsAPI
  public Segments: SegmentsAPI
  public Catalog: CatalogAPI

  private executionListeners: Array<(exec: any) => void> = []

  constructor(_options: KlaviyoClientOptions) {
    // TODO: Implement in GREEN phase
    throw new Error('KlaviyoClient not implemented - RED phase')
  }

  onFlowExecution(callback: (execution: any) => void): () => void {
    this.executionListeners.push(callback)
    return () => {
      const index = this.executionListeners.indexOf(callback)
      if (index > -1) this.executionListeners.splice(index, 1)
    }
  }
}

// ============================================================================
// API Interfaces (stubs for RED phase)
// ============================================================================

export interface FlowsAPI {
  create(params: any): Promise<{ data: Flow }>
  get(id: string, options?: any): Promise<{ data: Flow; included?: any[] }>
  list(options?: any): Promise<{ data: Flow[]; links?: { next?: string } }>
  update(id: string, params: any): Promise<{ data: Flow }>
  delete(id: string): Promise<void>
  archive(id: string): Promise<{ data: Flow }>
  unarchive(id: string): Promise<{ data: Flow }>
  getMetrics(id: string, options: any): Promise<{ data: any }>
}

export interface FlowActionsAPI {
  create(params: any): Promise<{ data: FlowAction }>
  get(id: string): Promise<{ data: FlowAction }>
  update(id: string, params: any): Promise<{ data: FlowAction }>
  delete(id: string): Promise<void>
  listByFlow(flowId: string): Promise<{ data: FlowAction[] }>
  getMetrics(id: string, options: any): Promise<{ data: any }>
}

export interface FlowConditionsAPI {
  create(params: any): Promise<{ data: FlowCondition }>
  get(id: string): Promise<{ data: FlowCondition }>
  update(id: string, params: any): Promise<{ data: FlowCondition }>
  delete(id: string): Promise<void>
}

export interface FlowDelaysAPI {
  create(params: any): Promise<{ data: FlowDelay }>
  get(id: string): Promise<{ data: FlowDelay }>
  update(id: string, params: any): Promise<{ data: FlowDelay }>
  delete(id: string): Promise<void>
}

export interface FlowExecutionsAPI {
  list(options?: any): Promise<{ data: any[] }>
  get(id: string): Promise<{ data: any }>
  cancel(id: string): Promise<{ data: any }>
}

export interface EventsAPI {
  create(params: any): Promise<{ data: any }>
}

export interface ProfilesAPI {
  create(params: any): Promise<{ data: any }>
  get(id: string): Promise<{ data: any }>
  update(id: string, params: any): Promise<{ data: any }>
}

export interface ListsAPI {
  addProfiles(listId: string, params: any): Promise<void>
  removeProfiles(listId: string, params: any): Promise<void>
}

export interface SegmentsAPI {
  profileEntered(segmentId: string, profileId: string): Promise<void>
  profileExited(segmentId: string, profileId: string): Promise<void>
}

export interface CatalogAPI {
  updateItem(catalogId: string, itemId: string, params: any): Promise<{ data: any }>
}
