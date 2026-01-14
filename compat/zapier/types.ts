/**
 * Zapier Platform Core Type Definitions
 *
 * Comprehensive types for Zapier-compatible automation.
 */

// ============================================================================
// INPUT FIELD TYPES
// ============================================================================

/**
 * Input field type definitions
 */
export type InputFieldType =
  | 'string'
  | 'text'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'datetime'
  | 'file'
  | 'password'
  | 'copy'

/**
 * Input field definition for triggers/actions/searches
 */
export interface InputField {
  key: string
  label: string
  type?: InputFieldType
  required?: boolean
  helpText?: string
  default?: unknown
  placeholder?: string
  choices?: string[] | Array<{ value: string; label: string; sample?: string }>
  list?: boolean
  children?: InputField[]
  /** Dynamic field reference: trigger_key.id_field.label_field */
  dynamic?: string
  /** If true, changing this field triggers dynamic field refresh */
  altersDynamicFields?: boolean
  /** Input format hint (e.g., "{{input.date}}") */
  inputFormat?: string
  /** Computed field - value derived from other fields */
  computed?: boolean
  /** Search field reference: search_key.id_field */
  search?: string
}

/**
 * Output field definition
 */
export interface OutputField {
  key: string
  label?: string
  type?: InputFieldType
  important?: boolean
}

/**
 * Display configuration for triggers/actions/searches
 */
export interface DisplayConfig {
  label: string
  description: string
  hidden?: boolean
  important?: boolean
  directions?: string
}

// ============================================================================
// BUNDLE TYPES
// ============================================================================

/**
 * Bundle meta information
 */
export interface BundleMeta {
  isLoadingSample?: boolean
  isFillingDynamicDropdown?: boolean
  isTestingAuth?: boolean
  isPopulatingDedupe?: boolean
  limit?: number
  page?: number
  zap?: { id: string; name?: string }
  prefill?: Record<string, unknown>
}

/**
 * Raw request data from webhooks
 */
export interface RawRequest {
  method: string
  headers: Record<string, string>
  content: string
  querystring: string
}

/**
 * Bundle - contains all data passed to perform functions
 */
export interface Bundle<
  TInputData = Record<string, unknown>,
  TAuthData = Record<string, unknown>
> {
  inputData: TInputData
  authData: TAuthData
  meta?: BundleMeta
  /** Target URL for webhook subscriptions */
  targetUrl?: string
  /** Data from webhook subscription */
  subscribeData?: Record<string, unknown>
  /** Cleaned webhook request payload */
  cleanedRequest?: Record<string, unknown>
  /** Raw webhook request */
  rawRequest?: RawRequest
  /** Input data with defaults filled in */
  inputDataRaw?: Record<string, unknown>
}

// ============================================================================
// Z REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Z request options
 */
export interface ZRequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  headers?: Record<string, string>
  params?: Record<string, string>
  body?: unknown
  form?: Record<string, string>
  json?: unknown
  raw?: boolean
  redirect?: 'follow' | 'error' | 'manual'
  skipThrowForStatus?: boolean
  timeout?: number
  /** Disable auto-parsing of JSON responses */
  skipParseResponse?: boolean
  /** Remove BOM from response */
  removeBOM?: boolean
}

/**
 * Z response object
 */
export interface ZResponse<T = unknown> {
  status: number
  headers: Headers
  data: T
  content: string
  json: T
  request: ZRequestOptions
  getHeader(name: string): string | null
  throwForStatus(): void
}

/**
 * Custom Zapier errors
 */
export class ZapierError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'ZapierError'
  }
}

export class ExpiredAuthError extends ZapierError {
  constructor(message = 'Authentication has expired') {
    super(message, 'ExpiredAuthError')
    this.name = 'ExpiredAuthError'
  }
}

export class RefreshAuthError extends ZapierError {
  constructor(message = 'Failed to refresh authentication') {
    super(message, 'RefreshAuthError')
    this.name = 'RefreshAuthError'
  }
}

export class HaltedError extends ZapierError {
  constructor(message = 'Zap has been halted') {
    super(message, 'HaltedError')
    this.name = 'HaltedError'
  }
}

export class ThrottledError extends ZapierError {
  delay?: number
  constructor(message = 'Rate limited', delay?: number) {
    super(message, 'ThrottledError')
    this.name = 'ThrottledError'
    this.delay = delay
  }
}

export class ResponseError extends ZapierError {
  status: number
  response: ZResponse
  constructor(response: ZResponse) {
    super(`Request failed with status ${response.status}`)
    this.name = 'ResponseError'
    this.status = response.status
    this.response = response
  }
}

/**
 * Z object errors interface
 */
export interface ZErrors {
  Error: new (message: string) => ZapierError
  ExpiredAuthError: new (message?: string) => ExpiredAuthError
  RefreshAuthError: new (message?: string) => RefreshAuthError
  HaltedError: new (message?: string) => HaltedError
  ThrottledError: new (message?: string, delay?: number) => ThrottledError
  ResponseError: new (response: ZResponse) => ResponseError
}

/**
 * Z object console
 */
export interface ZConsole {
  log: (...args: unknown[]) => void
  time: (label: string) => void
  timeEnd: (label: string) => void
}

/**
 * Z object JSON utilities
 */
export interface ZJSON {
  parse: (text: string) => unknown
  stringify: (value: unknown) => string
}

/**
 * Cursor interface for pagination
 */
export interface ZCursor {
  get: () => Promise<string | undefined>
  set: (cursor: string) => Promise<void>
}

/**
 * Dehydration function type
 */
export type DehydrateFunc<T = unknown> = (
  z: ZObject,
  bundle: Bundle
) => Promise<T>

/**
 * Z object - the main interface for making requests and using utilities
 */
export interface ZObject {
  request: {
    (url: string): Promise<ZResponse>
    (options: ZRequestOptions): Promise<ZResponse>
  }
  console: ZConsole
  JSON: ZJSON
  errors: ZErrors
  dehydrate: <T = unknown>(
    func: DehydrateFunc<T>,
    inputData: Record<string, unknown>
  ) => string
  dehydrateFile: <T = unknown>(
    func: DehydrateFunc<T>,
    inputData: Record<string, unknown>
  ) => string
  stashFile: (
    url: string,
    options?: { filename?: string; contentType?: string }
  ) => Promise<string>
  generateCallbackUrl: () => string
  cursor: ZCursor
  /** Hash a value for deduplication */
  hash: (algorithm: 'md5' | 'sha1' | 'sha256', value: string) => string
}

// ============================================================================
// AUTHENTICATION TYPES
// ============================================================================

/**
 * OAuth2 configuration
 */
export interface OAuth2Config {
  authorizeUrl: string | ((z: ZObject, bundle: Bundle) => string)
  getAccessToken: (
    z: ZObject,
    bundle: Bundle
  ) => Promise<{ access_token: string; refresh_token?: string; expires_in?: number; [key: string]: unknown }>
  refreshAccessToken?: (
    z: ZObject,
    bundle: Bundle
  ) => Promise<{ access_token: string; expires_in?: number; [key: string]: unknown }>
  scope?: string
  autoRefresh?: boolean
  /** PKCE support */
  enablePkce?: boolean
}

/**
 * Session auth configuration
 */
export interface SessionConfig {
  perform: (
    z: ZObject,
    bundle: Bundle
  ) => Promise<{ sessionKey: string; [key: string]: unknown }>
}

/**
 * Custom auth configuration
 */
export interface CustomAuthConfig {
  /** Function to modify requests with auth */
  perform?: (z: ZObject, bundle: Bundle) => Promise<Record<string, unknown>>
}

/**
 * Authentication configuration
 */
export interface AuthenticationConfig {
  type: 'oauth2' | 'api_key' | 'session' | 'basic' | 'custom' | 'digest'
  oauth2Config?: OAuth2Config
  sessionConfig?: SessionConfig
  customConfig?: CustomAuthConfig
  fields?: InputField[]
  test: (z: ZObject, bundle: Bundle) => Promise<unknown>
  connectionLabel?: string | ((z: ZObject, bundle: Bundle) => Promise<string>)
}

// ============================================================================
// OPERATION TYPES
// ============================================================================

/**
 * Perform function type
 */
export type PerformFunction<T = unknown[]> = (
  z: ZObject,
  bundle: Bundle
) => Promise<T>

/**
 * Dynamic input field function
 */
export type DynamicInputFieldFunction = (
  z: ZObject,
  bundle: Bundle
) => Promise<InputField[]>

/**
 * Input field or dynamic function
 */
export type InputFieldOrFunction = InputField | DynamicInputFieldFunction

/**
 * Base operation config
 */
export interface BaseOperationConfig {
  inputFields?: InputFieldOrFunction[]
  outputFields?: OutputField[]
  sample?: Record<string, unknown>
}

// ============================================================================
// TRIGGER TYPES
// ============================================================================

/**
 * Polling trigger operation
 */
export interface PollingTriggerOperation extends BaseOperationConfig {
  type: 'polling'
  perform: PerformFunction<unknown[]>
  canPaginate?: boolean
}

/**
 * Hook trigger operation
 */
export interface HookTriggerOperation extends BaseOperationConfig {
  type: 'hook'
  performSubscribe: (
    z: ZObject,
    bundle: Bundle
  ) => Promise<{ id: string; [key: string]: unknown }>
  performUnsubscribe: (z: ZObject, bundle: Bundle) => Promise<unknown>
  perform: PerformFunction<unknown[]>
  performList?: PerformFunction<unknown[]>
}

/**
 * Base trigger config
 */
export interface BaseTriggerConfig {
  key: string
  noun: string
  display: DisplayConfig
}

/**
 * Polling trigger config
 */
export interface PollingTriggerConfig extends BaseTriggerConfig {
  operation: PollingTriggerOperation
}

/**
 * Hook trigger config
 */
export interface HookTriggerConfig extends BaseTriggerConfig {
  operation: HookTriggerOperation
}

/**
 * Trigger config union type
 */
export type TriggerConfig = PollingTriggerConfig | HookTriggerConfig

// ============================================================================
// ACTION TYPES
// ============================================================================

/**
 * Action operation config
 */
export interface ActionOperation extends BaseOperationConfig {
  perform: PerformFunction<unknown>
}

/**
 * Action config
 */
export interface ActionConfig {
  key: string
  noun: string
  display: DisplayConfig
  operation: ActionOperation
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

/**
 * Search operation config
 */
export interface SearchOperation extends BaseOperationConfig {
  perform: PerformFunction<unknown[]>
}

/**
 * Search config
 */
export interface SearchConfig {
  key: string
  noun: string
  display: DisplayConfig
  operation: SearchOperation
  /** Link to create action for "search or create" */
  searchOrCreateKey?: string
}

// ============================================================================
// RESOURCE TYPES
// ============================================================================

/**
 * Resource definition for CRUD operations
 */
export interface ResourceConfig {
  key: string
  noun: string
  get?: {
    display: DisplayConfig
    operation: {
      perform: PerformFunction<unknown>
      inputFields?: InputFieldOrFunction[]
    }
  }
  list?: {
    display: DisplayConfig
    operation: {
      perform: PerformFunction<unknown[]>
      inputFields?: InputFieldOrFunction[]
      canPaginate?: boolean
    }
  }
  create?: {
    display: DisplayConfig
    operation: ActionOperation
  }
  search?: {
    display: DisplayConfig
    operation: SearchOperation
  }
  sample?: Record<string, unknown>
  outputFields?: OutputField[]
}

// ============================================================================
// MIDDLEWARE TYPES
// ============================================================================

/**
 * Before request middleware
 */
export type BeforeRequestMiddleware = (
  request: ZRequestOptions,
  z: ZObject,
  bundle: Bundle
) => ZRequestOptions | Promise<ZRequestOptions>

/**
 * After response middleware
 */
export type AfterResponseMiddleware = (
  response: ZResponse,
  z: ZObject,
  bundle: Bundle
) => ZResponse | Promise<ZResponse>

// ============================================================================
// APP CONFIG
// ============================================================================

/**
 * App configuration
 */
export interface AppConfig {
  version: string
  platformVersion: string
  authentication?: AuthenticationConfig
  triggers?: Record<string, TriggerConfig>
  actions?: Record<string, ActionConfig>
  searches?: Record<string, SearchConfig>
  resources?: Record<string, ResourceConfig>
  beforeRequest?: BeforeRequestMiddleware[]
  afterResponse?: AfterResponseMiddleware[]
  hydrators?: Record<string, DehydrateFunc>
  /** Legacy creates alias */
  creates?: Record<string, ActionConfig>
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Zapier CLI export format
 */
export interface ZapierExportFormat {
  version: string
  platformVersion: string
  authentication?: AuthenticationConfig
  triggers: Record<string, TriggerConfig>
  creates: Record<string, ActionConfig>
  searches: Record<string, SearchConfig>
  resources?: Record<string, ResourceConfig>
}

// ============================================================================
// WEBHOOK TYPES
// ============================================================================

/**
 * Webhook subscription data
 */
export interface WebhookSubscription {
  id: string
  targetUrl: string
  event?: string
  createdAt: number
  metadata?: Record<string, unknown>
}

/**
 * Webhook request handler result
 */
export interface WebhookHandlerResult {
  /** Data items to process */
  data: unknown[]
  /** HTTP status to return */
  status?: number
  /** Response body to send */
  response?: unknown
}

// ============================================================================
// HYDRATION TYPES
// ============================================================================

/**
 * Hydration payload stored in dehydrated references
 */
export interface HydrationPayload {
  type: 'method' | 'file'
  method?: string
  bundle: Record<string, unknown>
}

/**
 * Stashed file info
 */
export interface StashedFile {
  url: string
  filename?: string
  contentType?: string
  size?: number
}
