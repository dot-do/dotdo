/**
 * @dotdo/twilio/studio - Type Definitions
 *
 * Twilio Studio API types for flow definitions, widgets, and executions.
 */

// =============================================================================
// Flow Definition Types
// =============================================================================

/**
 * Flow status values
 */
export type FlowStatus = 'draft' | 'published'

/**
 * Flow flags for configuration
 */
export interface FlowFlags {
  allow_concurrent_calls?: boolean
}

/**
 * Offset position for visual layout
 */
export interface WidgetOffset {
  x: number
  y: number
}

/**
 * Transition between states/widgets
 */
export interface FlowTransition {
  /** Event that triggers this transition */
  event: string
  /** Next state name (optional - if not provided, flow ends) */
  next?: string
  /** Conditions for split-based-on widget */
  conditions?: SplitCondition[]
}

/**
 * Condition for split-based-on transitions
 */
export interface SplitCondition {
  /** Friendly name for the condition */
  friendly_name: string
  /** Arguments for evaluation */
  arguments: string[]
  /** Condition type (equal_to, not_equal_to, matches_any_of, etc.) */
  type: SplitConditionType
  /** Value to compare against */
  value: string
}

export type SplitConditionType =
  | 'equal_to'
  | 'not_equal_to'
  | 'matches_any_of'
  | 'does_not_match_any_of'
  | 'is_blank'
  | 'is_not_blank'
  | 'starts_with'
  | 'contains'
  | 'regex'
  | 'less_than'
  | 'greater_than'

// =============================================================================
// Widget Types
// =============================================================================

/**
 * Base widget state
 */
export interface BaseWidgetState {
  /** Widget type identifier */
  type: WidgetType
  /** Unique name for this widget */
  name: string
  /** Transitions to other states */
  transitions: FlowTransition[]
  /** Widget-specific properties */
  properties: Record<string, unknown>
}

/**
 * All supported widget types
 */
export type WidgetType =
  | 'trigger'
  | 'send-message'
  | 'send-and-wait-for-reply'
  | 'say-play'
  | 'gather-input-on-call'
  | 'split-based-on'
  | 'make-outgoing-call-v2'
  | 'connect-call-to'
  | 'record-voicemail'
  | 'make-http-request'
  | 'run-function'
  | 'set-variables'
  | 'enqueue-call'
  | 'fork-stream'
  | 'run-subflow'
  | 'add-twiml-redirect'

// =============================================================================
// Trigger Widget
// =============================================================================

export interface TriggerWidgetProperties {
  offset: WidgetOffset
}

export interface TriggerWidgetState extends BaseWidgetState {
  type: 'trigger'
  properties: TriggerWidgetProperties
}

// =============================================================================
// Send Message Widget
// =============================================================================

export interface SendMessageWidgetProperties {
  offset: WidgetOffset
  /** Message service SID */
  service?: string
  /** Channel type */
  channel?: string
  /** From number */
  from?: string
  /** To number (supports template variables) */
  to?: string
  /** Message body (supports template variables) */
  body: string
  /** Media URL for MMS */
  media_url?: string
  /** Content SID for templates */
  content_sid?: string
  /** Content variables */
  content_variables?: Record<string, string>
}

export interface SendMessageWidgetState extends BaseWidgetState {
  type: 'send-message'
  properties: SendMessageWidgetProperties
}

// =============================================================================
// Send and Wait for Reply Widget
// =============================================================================

export interface SendAndWaitForReplyWidgetProperties {
  offset: WidgetOffset
  /** Message service SID */
  service?: string
  /** Channel type */
  channel?: string
  /** From number */
  from?: string
  /** To number */
  to?: string
  /** Message body */
  body: string
  /** Timeout in seconds */
  timeout?: number
  /** Media URL */
  media_url?: string
}

export interface SendAndWaitForReplyWidgetState extends BaseWidgetState {
  type: 'send-and-wait-for-reply'
  properties: SendAndWaitForReplyWidgetProperties
}

// =============================================================================
// Say/Play Widget
// =============================================================================

export interface SayPlayWidgetProperties {
  offset: WidgetOffset
  /** Voice for TTS */
  voice?: string
  /** Language code */
  language?: string
  /** Text to say */
  say?: string
  /** Audio URL to play */
  play?: string
  /** Number of times to loop */
  loop?: number
  /** Digits to play as DTMF */
  digits?: string
}

export interface SayPlayWidgetState extends BaseWidgetState {
  type: 'say-play'
  properties: SayPlayWidgetProperties
}

// =============================================================================
// Gather Input on Call Widget
// =============================================================================

export interface GatherInputOnCallWidgetProperties {
  offset: WidgetOffset
  /** Voice for prompts */
  voice?: string
  /** Language code */
  language?: string
  /** Speech timeout */
  speech_timeout?: string
  /** Speech model */
  speech_model?: string
  /** Input type: dtmf, speech, or both */
  input?: 'dtmf' | 'speech' | 'dtmf speech'
  /** Number of digits to gather */
  number_of_digits?: number
  /** Key to finish gathering */
  finish_on_key?: string
  /** Gather timeout in seconds */
  timeout?: number
  /** Text to say while gathering */
  say?: string
  /** Audio URL to play while gathering */
  play?: string
  /** Speech hints */
  hints?: string
  /** Loop count for prompt */
  loop?: number
  /** Stop gathering on first result */
  stop_gather?: boolean
  /** Profanity filter for speech */
  profanity_filter?: string
}

export interface GatherInputOnCallWidgetState extends BaseWidgetState {
  type: 'gather-input-on-call'
  properties: GatherInputOnCallWidgetProperties
}

// =============================================================================
// Split Based On Widget
// =============================================================================

export interface SplitBasedOnWidgetProperties {
  offset: WidgetOffset
  /** Variable to evaluate (supports template syntax) */
  input: string
}

export interface SplitBasedOnWidgetState extends BaseWidgetState {
  type: 'split-based-on'
  properties: SplitBasedOnWidgetProperties
}

// =============================================================================
// Make Outgoing Call Widget
// =============================================================================

export interface MakeOutgoingCallWidgetProperties {
  offset: WidgetOffset
  /** To number */
  to: string
  /** From number */
  from: string
  /** Timeout in seconds */
  timeout?: number
  /** Machine detection */
  machine_detection?: 'Enable' | 'DetectMessageEnd'
  /** Record the call */
  record?: boolean
  /** Send digits after connect */
  send_digits?: string
  /** Status callback URL */
  status_callback?: string
  /** Trim silence from recordings */
  trim?: 'trim-silence' | 'do-not-trim'
  /** Caller ID name */
  caller_id_name?: string
  /** SIP headers */
  sip_headers?: string
}

export interface MakeOutgoingCallWidgetState extends BaseWidgetState {
  type: 'make-outgoing-call-v2'
  properties: MakeOutgoingCallWidgetProperties
}

// =============================================================================
// Connect Call To Widget
// =============================================================================

export interface ConnectCallToWidgetProperties {
  offset: WidgetOffset
  /** Nouns to dial (number, sip, client) */
  noun: 'number' | 'sip-endpoint' | 'client'
  /** Phone number or SIP URI */
  to?: string
  /** SIP username */
  sip_username?: string
  /** SIP password */
  sip_password?: string
  /** Caller ID */
  caller_id?: string
  /** Timeout in seconds */
  timeout?: number
  /** Record the call */
  record?: boolean
  /** Send digits after connect */
  send_digits?: string
}

export interface ConnectCallToWidgetState extends BaseWidgetState {
  type: 'connect-call-to'
  properties: ConnectCallToWidgetProperties
}

// =============================================================================
// Record Voicemail Widget
// =============================================================================

export interface RecordVoicemailWidgetProperties {
  offset: WidgetOffset
  /** Voice for prompts */
  voice?: string
  /** Language code */
  language?: string
  /** Text to say before recording */
  say?: string
  /** Audio to play before recording */
  play?: string
  /** Max recording length in seconds */
  max_length?: number
  /** Play beep before recording */
  play_beep?: 'true' | 'false'
  /** Key to stop recording */
  finish_on_key?: string
  /** Timeout for silence */
  timeout?: number
  /** Recording transcription */
  transcribe?: boolean
  /** Recording status callback URL */
  recording_status_callback?: string
  /** Trim silence from recordings */
  trim?: 'trim-silence' | 'do-not-trim'
}

export interface RecordVoicemailWidgetState extends BaseWidgetState {
  type: 'record-voicemail'
  properties: RecordVoicemailWidgetProperties
}

// =============================================================================
// Make HTTP Request Widget
// =============================================================================

export interface MakeHttpRequestWidgetProperties {
  offset: WidgetOffset
  /** Request method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Request URL */
  url: string
  /** Content type */
  content_type?: 'application/x-www-form-urlencoded' | 'application/json'
  /** Request body */
  body?: Record<string, string> | string
  /** Request parameters */
  parameters?: Array<{ key: string; value: string }>
}

export interface MakeHttpRequestWidgetState extends BaseWidgetState {
  type: 'make-http-request'
  properties: MakeHttpRequestWidgetProperties
}

// =============================================================================
// Run Function Widget
// =============================================================================

export interface RunFunctionWidgetProperties {
  offset: WidgetOffset
  /** Service SID */
  service_sid: string
  /** Environment SID */
  environment_sid: string
  /** Function SID */
  function_sid: string
  /** Function URL */
  url?: string
  /** Function parameters */
  parameters?: Array<{ key: string; value: string }>
}

export interface RunFunctionWidgetState extends BaseWidgetState {
  type: 'run-function'
  properties: RunFunctionWidgetProperties
}

// =============================================================================
// Set Variables Widget
// =============================================================================

export interface SetVariablesWidgetProperties {
  offset: WidgetOffset
  /** Variables to set */
  variables: Array<{
    key: string
    value: string
  }>
}

export interface SetVariablesWidgetState extends BaseWidgetState {
  type: 'set-variables'
  properties: SetVariablesWidgetProperties
}

// =============================================================================
// Enqueue Call Widget
// =============================================================================

export interface EnqueueCallWidgetProperties {
  offset: WidgetOffset
  /** Queue name or SID */
  queue_name?: string
  /** Workflow SID for TaskRouter */
  workflow_sid?: string
  /** Wait URL */
  wait_url?: string
  /** Task attributes */
  task_attributes?: Record<string, unknown>
  /** Priority */
  priority?: number
  /** Timeout */
  timeout?: number
}

export interface EnqueueCallWidgetState extends BaseWidgetState {
  type: 'enqueue-call'
  properties: EnqueueCallWidgetProperties
}

// =============================================================================
// Fork Stream Widget
// =============================================================================

export interface ForkStreamWidgetProperties {
  offset: WidgetOffset
  /** Stream action */
  stream_action: 'start' | 'stop'
  /** Stream connector */
  stream_connector?: string
  /** Stream name */
  stream_name?: string
  /** Stream URL */
  stream_url?: string
  /** Track */
  stream_track?: 'inbound_track' | 'outbound_track' | 'both_tracks'
}

export interface ForkStreamWidgetState extends BaseWidgetState {
  type: 'fork-stream'
  properties: ForkStreamWidgetProperties
}

// =============================================================================
// Run Subflow Widget
// =============================================================================

export interface RunSubflowWidgetProperties {
  offset: WidgetOffset
  /** Flow SID to run */
  flow_sid: string
  /** Parameters to pass */
  parameters?: Array<{ key: string; value: string }>
}

export interface RunSubflowWidgetState extends BaseWidgetState {
  type: 'run-subflow'
  properties: RunSubflowWidgetProperties
}

// =============================================================================
// Add TwiML Redirect Widget
// =============================================================================

export interface AddTwimlRedirectWidgetProperties {
  offset: WidgetOffset
  /** TwiML URL */
  url: string
  /** Request method */
  method?: 'GET' | 'POST'
}

export interface AddTwimlRedirectWidgetState extends BaseWidgetState {
  type: 'add-twiml-redirect'
  properties: AddTwimlRedirectWidgetProperties
}

// =============================================================================
// Union of all Widget States
// =============================================================================

export type WidgetState =
  | TriggerWidgetState
  | SendMessageWidgetState
  | SendAndWaitForReplyWidgetState
  | SayPlayWidgetState
  | GatherInputOnCallWidgetState
  | SplitBasedOnWidgetState
  | MakeOutgoingCallWidgetState
  | ConnectCallToWidgetState
  | RecordVoicemailWidgetState
  | MakeHttpRequestWidgetState
  | RunFunctionWidgetState
  | SetVariablesWidgetState
  | EnqueueCallWidgetState
  | ForkStreamWidgetState
  | RunSubflowWidgetState
  | AddTwimlRedirectWidgetState

// =============================================================================
// Flow Definition
// =============================================================================

/**
 * Complete Studio Flow Definition
 */
export interface FlowDefinition {
  /** Flow description */
  description: string
  /** Flow configuration flags */
  flags: FlowFlags
  /** Initial state name */
  initial_state: string
  /** Array of widget states */
  states: WidgetState[]
}

// =============================================================================
// Flow Resource
// =============================================================================

/**
 * Flow resource from the API
 */
export interface Flow {
  /** Flow SID */
  sid: string
  /** Account SID */
  account_sid: string
  /** Flow friendly name */
  friendly_name: string
  /** Flow definition */
  definition: FlowDefinition
  /** Flow status */
  status: FlowStatus
  /** Version number */
  revision: number
  /** Last commit message */
  commit_message: string | null
  /** Valid flag */
  valid: boolean
  /** Validation errors */
  errors: FlowValidationError[] | null
  /** Validation warnings */
  warnings: FlowValidationWarning[] | null
  /** Date created */
  date_created: string
  /** Date updated */
  date_updated: string
  /** URL for this flow */
  url: string
  /** Links to related resources */
  links: {
    executions: string
    revisions: string
  }
  /** Webhook URL for triggers */
  webhook_url: string
}

/**
 * Flow validation error
 */
export interface FlowValidationError {
  /** Error message */
  message: string
  /** Property path */
  property_path: string
}

/**
 * Flow validation warning
 */
export interface FlowValidationWarning {
  /** Warning message */
  message: string
  /** Property path */
  property_path: string
}

// =============================================================================
// Flow Operations
// =============================================================================

/**
 * Parameters for creating a flow
 */
export interface FlowCreateParams {
  /** Friendly name */
  friendly_name: string
  /** Flow status */
  status: FlowStatus
  /** Flow definition */
  definition: FlowDefinition
  /** Commit message */
  commit_message?: string
}

/**
 * Parameters for updating a flow
 */
export interface FlowUpdateParams {
  /** Friendly name */
  friendly_name?: string
  /** Flow status */
  status?: FlowStatus
  /** Flow definition */
  definition?: FlowDefinition
  /** Commit message (required when updating definition) */
  commit_message?: string
}

/**
 * Parameters for listing flows
 */
export interface FlowListParams {
  /** Page size */
  page_size?: number
  /** Page number */
  page?: number
}

// =============================================================================
// Execution Types
// =============================================================================

/**
 * Execution status values
 */
export type ExecutionStatus = 'active' | 'ended'

/**
 * Execution resource
 */
export interface Execution {
  /** Execution SID */
  sid: string
  /** Account SID */
  account_sid: string
  /** Flow SID */
  flow_sid: string
  /** Contact channel address */
  contact_channel_address: string
  /** Contact SID */
  contact_sid: string
  /** Execution context (variables and state) */
  context: ExecutionContext
  /** Execution status */
  status: ExecutionStatus
  /** Date created */
  date_created: string
  /** Date updated */
  date_updated: string
  /** URL for this execution */
  url: string
  /** Links to related resources */
  links: {
    steps: string
    execution_context: string
  }
}

/**
 * Execution context containing flow variables
 */
export interface ExecutionContext {
  /** Flow-level variables */
  flow?: {
    /** Flow SID */
    flow_sid: string
    /** Channel type */
    channel: {
      address: string
    }
    /** Custom variables */
    variables: Record<string, unknown>
    /** Data from trigger */
    data: Record<string, unknown>
  }
  /** Contact information */
  contact?: {
    channel: {
      address: string
    }
  }
  /** Trigger data */
  trigger?: {
    message?: {
      Body: string
      From: string
      To: string
      MessageSid: string
    }
    call?: {
      CallSid: string
      From: string
      To: string
      CallStatus: string
    }
    request?: {
      parameters: Record<string, unknown>
    }
  }
  /** Widget outputs */
  widgets: Record<string, WidgetOutput>
}

/**
 * Output from a widget execution
 */
export interface WidgetOutput {
  /** Inbound data received */
  inbound?: Record<string, unknown>
  /** Parsed data */
  parsed?: Record<string, unknown>
  /** HTTP response (for http request widget) */
  response?: {
    status_code: number
    body: string
    parsed: unknown
    headers: Record<string, string>
  }
  /** Digits entered (for gather widget) */
  Digits?: string
  /** Speech result (for gather widget) */
  SpeechResult?: string
  /** Message SID (for send message widget) */
  MessageSid?: string
  /** Call SID (for call widgets) */
  CallSid?: string
  /** Recording URL (for record widget) */
  RecordingUrl?: string
  /** Any other properties */
  [key: string]: unknown
}

/**
 * Parameters for triggering an execution
 */
export interface ExecutionCreateParams {
  /** Contact channel address (phone number) */
  to: string
  /** Sender address */
  from: string
  /** Parameters passed to the flow */
  parameters?: Record<string, unknown>
}

/**
 * Parameters for listing executions
 */
export interface ExecutionListParams {
  /** Filter by start date */
  date_created_from?: Date
  /** Filter by end date */
  date_created_to?: Date
  /** Page size */
  page_size?: number
  /** Page number */
  page?: number
}

/**
 * Parameters for updating an execution
 */
export interface ExecutionUpdateParams {
  /** New status (use 'ended' to stop execution) */
  status: 'ended'
}

// =============================================================================
// Execution Step Types
// =============================================================================

/**
 * Execution step resource
 */
export interface ExecutionStep {
  /** Step SID */
  sid: string
  /** Account SID */
  account_sid: string
  /** Flow SID */
  flow_sid: string
  /** Execution SID */
  execution_sid: string
  /** Name of the widget/state */
  name: string
  /** Transitioned from state */
  transitioned_from: string
  /** Transitioned to state */
  transitioned_to: string
  /** Date created */
  date_created: string
  /** Date updated */
  date_updated: string
  /** URL for this step */
  url: string
  /** Links to related resources */
  links: {
    step_context: string
  }
}

/**
 * Step context containing input/output data
 */
export interface ExecutionStepContext {
  /** Account SID */
  account_sid: string
  /** Flow SID */
  flow_sid: string
  /** Execution SID */
  execution_sid: string
  /** Step SID */
  step_sid: string
  /** Context data at this step */
  context: Record<string, unknown>
  /** URL */
  url: string
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * List response for flows
 */
export interface FlowListResponse {
  flows: Flow[]
  meta: {
    page: number
    page_size: number
    first_page_url: string
    previous_page_url: string | null
    next_page_url: string | null
    url: string
    key: string
  }
}

/**
 * List response for executions
 */
export interface ExecutionListResponse {
  executions: Execution[]
  meta: {
    page: number
    page_size: number
    first_page_url: string
    previous_page_url: string | null
    next_page_url: string | null
    url: string
    key: string
  }
}

/**
 * List response for execution steps
 */
export interface ExecutionStepListResponse {
  steps: ExecutionStep[]
  meta: {
    page: number
    page_size: number
    first_page_url: string
    previous_page_url: string | null
    next_page_url: string | null
    url: string
    key: string
  }
}

// =============================================================================
// Client Configuration
// =============================================================================

/**
 * Studio client configuration
 */
export interface StudioClientConfig {
  /** Account SID */
  accountSid: string
  /** Auth token */
  authToken: string
  /** Custom fetch function */
  fetch?: typeof fetch
  /** Request timeout in ms */
  timeout?: number
  /** Auto retry on failure */
  autoRetry?: boolean
  /** Max retry attempts */
  maxRetries?: number
  /** Custom base URL */
  baseUrl?: string
}

/**
 * Error response from API
 */
export interface StudioErrorResponse {
  code: number
  message: string
  more_info: string
  status: number
}
