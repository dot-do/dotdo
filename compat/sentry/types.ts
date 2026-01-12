/**
 * @dotdo/sentry - Type Definitions
 *
 * Core types for Sentry SDK compatibility layer.
 *
 * @module @dotdo/sentry/types
 */

// =============================================================================
// Severity & Level Types
// =============================================================================

/**
 * Severity level for Sentry events.
 */
export type SeverityLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug'

/**
 * Breadcrumb type categories.
 */
export type BreadcrumbType =
  | 'default'
  | 'debug'
  | 'error'
  | 'navigation'
  | 'http'
  | 'info'
  | 'query'
  | 'transaction'
  | 'ui'
  | 'user'

// =============================================================================
// User & Context Types
// =============================================================================

/**
 * User information attached to events.
 */
export interface User {
  /** Unique identifier for the user */
  id?: string
  /** Email address */
  email?: string
  /** Username */
  username?: string
  /** IP address (typically captured automatically) */
  ip_address?: string
  /** Segment for user categorization */
  segment?: string
  /** Additional user data */
  [key: string]: unknown
}

/**
 * Additional context information.
 */
export interface Context {
  [key: string]: unknown
}

/**
 * Tags are searchable key-value pairs.
 */
export interface Tags {
  [key: string]: string
}

/**
 * Extra data attached to events.
 */
export interface Extras {
  [key: string]: unknown
}

// =============================================================================
// Breadcrumb Types
// =============================================================================

/**
 * A breadcrumb represents an event that happened before an error.
 */
export interface Breadcrumb {
  /** Category for the breadcrumb (e.g., 'http', 'ui.click') */
  category?: string
  /** Message describing the breadcrumb */
  message?: string
  /** Breadcrumb type */
  type?: BreadcrumbType
  /** Severity level */
  level?: SeverityLevel
  /** Timestamp (defaults to current time) */
  timestamp?: number
  /** Additional data */
  data?: Record<string, unknown>
}

/**
 * Hint provided when adding breadcrumbs for filtering.
 */
export interface BreadcrumbHint {
  /** Original event that triggered the breadcrumb */
  event?: Event
  /** Level override */
  level?: SeverityLevel
  /** Input source */
  input?: unknown[]
  /** HTTP response */
  response?: Response
  /** HTTP request */
  request?: Request
  /** XHR object (for browser environments) */
  xhr?: unknown
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Stack frame information.
 */
export interface StackFrame {
  /** Filename where the error occurred */
  filename?: string
  /** Function name */
  function?: string
  /** Module name */
  module?: string
  /** Line number */
  lineno?: number
  /** Column number */
  colno?: number
  /** Whether this frame is in-app code */
  in_app?: boolean
  /** Source code context (lines before/after) */
  context_line?: string
  pre_context?: string[]
  post_context?: string[]
}

/**
 * Stacktrace information.
 */
export interface Stacktrace {
  frames: StackFrame[]
}

/**
 * Exception value for error events.
 */
export interface ExceptionValue {
  /** Exception type/name */
  type?: string
  /** Exception message */
  value?: string
  /** Stack trace */
  stacktrace?: Stacktrace
  /** Mechanism that captured the exception */
  mechanism?: {
    type: string
    handled?: boolean
    data?: Record<string, unknown>
  }
}

/**
 * A Sentry event representing an error, message, or transaction.
 */
export interface SentryEvent {
  /** Event ID (UUID) */
  event_id?: string
  /** Event type (event, transaction) */
  type?: 'event' | 'transaction'
  /** Timestamp */
  timestamp?: number
  /** Start timestamp (for transactions) */
  start_timestamp?: number
  /** Platform (e.g., 'javascript') */
  platform?: string
  /** SDK information */
  sdk?: {
    name: string
    version: string
  }
  /** Severity level */
  level?: SeverityLevel
  /** Logger name */
  logger?: string
  /** Transaction name */
  transaction?: string
  /** Server name */
  server_name?: string
  /** Release version */
  release?: string
  /** Distribution */
  dist?: string
  /** Environment (e.g., 'production') */
  environment?: string
  /** Message */
  message?: string
  /** Exception information */
  exception?: {
    values?: ExceptionValue[]
  }
  /** Request information */
  request?: {
    url?: string
    method?: string
    headers?: Record<string, string>
    query_string?: string
    data?: unknown
  }
  /** User information */
  user?: User
  /** Tags */
  tags?: Tags
  /** Extra data */
  extra?: Extras
  /** Contexts */
  contexts?: Record<string, Context>
  /** Breadcrumbs */
  breadcrumbs?: Breadcrumb[]
  /** Fingerprint for grouping */
  fingerprint?: string[]
  /** Spans (for transactions) */
  spans?: Array<Record<string, unknown>>
  /** Measurements (for transactions) */
  measurements?: Record<string, { value: number; unit: string }>
}

/**
 * Hint provided when capturing events for filtering.
 */
export interface EventHint {
  /** Original exception */
  originalException?: Error | string
  /** Synthetic exception for stack traces */
  syntheticException?: Error
  /** Additional data */
  data?: unknown
  /** Event ID */
  event_id?: string
}

// =============================================================================
// Scope Types
// =============================================================================

/**
 * Scope holds contextual information for events.
 */
export interface Scope {
  /** Set user information */
  setUser(user: User | null): Scope
  /** Get current user */
  getUser(): User | null
  /** Set a single tag */
  setTag(key: string, value: string): Scope
  /** Set multiple tags */
  setTags(tags: Tags): Scope
  /** Get all tags */
  getTags(): Tags
  /** Set extra data */
  setExtra(key: string, value: unknown): Scope
  /** Set multiple extras */
  setExtras(extras: Extras): Scope
  /** Get all extras */
  getExtras(): Extras
  /** Set context */
  setContext(name: string, context: Context | null): Scope
  /** Get a specific context */
  getContext(name: string): Context | undefined
  /** Get all contexts */
  getContexts(): Record<string, Context>
  /** Set severity level */
  setLevel(level: SeverityLevel): Scope
  /** Get current level */
  getLevel(): SeverityLevel | undefined
  /** Set transaction name */
  setTransactionName(name: string): Scope
  /** Get transaction name */
  getTransactionName(): string | undefined
  /** Add a breadcrumb */
  addBreadcrumb(breadcrumb: Breadcrumb, maxBreadcrumbs?: number): Scope
  /** Get all breadcrumbs */
  getBreadcrumbs(): Breadcrumb[]
  /** Clear breadcrumbs */
  clearBreadcrumbs(): Scope
  /** Set fingerprint */
  setFingerprint(fingerprint: string[]): Scope
  /** Get fingerprint */
  getFingerprint(): string[] | undefined
  /** Clear the scope */
  clear(): Scope
  /** Clone the scope */
  clone(): Scope
  /** Apply scope data to an event */
  applyToEvent(event: SentryEvent): SentryEvent
}

// =============================================================================
// Transport Types
// =============================================================================

/**
 * Transport for sending events to Sentry.
 */
export interface Transport {
  /** Send an event envelope */
  send(envelope: Envelope): Promise<TransportResult>
  /** Flush pending events */
  flush(timeout?: number): Promise<boolean>
}

/**
 * Transport result after sending.
 */
export interface TransportResult {
  /** Status code */
  statusCode?: number
  /** Headers from response */
  headers?: Record<string, string>
}

/**
 * Envelope item types.
 */
export type EnvelopeItemType =
  | 'event'
  | 'session'
  | 'attachment'
  | 'transaction'
  | 'client_report'

/**
 * Envelope item header.
 */
export interface EnvelopeItemHeader {
  type: EnvelopeItemType
  length?: number
}

/**
 * Envelope item (header + payload).
 */
export type EnvelopeItem = [EnvelopeItemHeader, unknown]

/**
 * Envelope header with common fields.
 */
export interface EnvelopeHeader {
  event_id?: string
  sent_at?: string
  dsn?: string
  sdk?: { name: string; version: string }
}

/**
 * Sentry envelope format.
 */
export type Envelope = [EnvelopeHeader, EnvelopeItem[]]

// =============================================================================
// Integration Types
// =============================================================================

/**
 * Integration interface for extending Sentry functionality.
 */
export interface Integration {
  /** Unique integration name */
  name: string
  /** Setup the integration */
  setupOnce?(): void
  /** Process an event */
  processEvent?(event: SentryEvent, hint: EventHint): SentryEvent | null
}

// =============================================================================
// Client Options
// =============================================================================

/**
 * Options for initializing the Sentry client.
 */
export interface SentryOptions {
  /** Sentry DSN (Data Source Name) */
  dsn?: string
  /** Enable debug mode */
  debug?: boolean
  /** Release version identifier */
  release?: string
  /** Environment name */
  environment?: string
  /** Sample rate for error events (0.0 to 1.0) */
  sampleRate?: number
  /** Sample rate for tracing (0.0 to 1.0) */
  tracesSampleRate?: number
  /** Maximum breadcrumbs to store */
  maxBreadcrumbs?: number
  /** Attach stack traces to messages */
  attachStacktrace?: boolean
  /** Send default PII */
  sendDefaultPii?: boolean
  /** Server name */
  serverName?: string
  /** Distribution identifier */
  dist?: string
  /** Initial scope configuration */
  initialScope?: Partial<{
    user: User
    tags: Tags
    extra: Extras
    contexts: Record<string, Context>
    level: SeverityLevel
  }>
  /** Before send hook for filtering/modifying events */
  beforeSend?(event: SentryEvent, hint: EventHint): SentryEvent | null | Promise<SentryEvent | null>
  /** Before breadcrumb hook */
  beforeBreadcrumb?(breadcrumb: Breadcrumb, hint?: BreadcrumbHint): Breadcrumb | null
  /** Integrations to use */
  integrations?: Integration[]
  /** Default integrations to disable */
  defaultIntegrations?: boolean | Integration[]
  /** Transport to use */
  transport?: (options: TransportOptions) => Transport
  /** Allowed URLs for capturing errors */
  allowUrls?: Array<string | RegExp>
  /** Denied URLs to ignore */
  denyUrls?: Array<string | RegExp>
  /** Tags to ignore */
  ignoreErrors?: Array<string | RegExp>
  /** Auto session tracking */
  autoSessionTracking?: boolean
  /** Enable tracing */
  enableTracing?: boolean
}

/**
 * Transport options passed to transport factory.
 */
export interface TransportOptions {
  /** Parsed DSN */
  dsn: ParsedDsn
  /** Headers to include */
  headers?: Record<string, string>
  /** Fetch implementation */
  fetch?: typeof fetch
}

/**
 * Parsed DSN components.
 */
export interface ParsedDsn {
  /** Protocol (http/https) */
  protocol: string
  /** Public key */
  publicKey: string
  /** Secret key (deprecated) */
  secretKey?: string
  /** Sentry host */
  host: string
  /** Port */
  port?: string
  /** Path */
  path?: string
  /** Project ID */
  projectId: string
}

// =============================================================================
// Client Types
// =============================================================================

/**
 * Sentry client interface.
 */
export interface SentryClient {
  /** Capture an exception */
  captureException(exception: unknown, hint?: EventHint, scope?: Scope): string
  /** Capture a message */
  captureMessage(message: string, level?: SeverityLevel, hint?: EventHint, scope?: Scope): string
  /** Capture an event */
  captureEvent(event: SentryEvent, hint?: EventHint, scope?: Scope): string
  /** Get client options */
  getOptions(): SentryOptions
  /** Get the DSN */
  getDsn(): ParsedDsn | undefined
  /** Get the transport */
  getTransport(): Transport | undefined
  /** Flush pending events */
  flush(timeout?: number): Promise<boolean>
  /** Close the client */
  close(timeout?: number): Promise<boolean>
}

// =============================================================================
// Hub Types
// =============================================================================

/**
 * Hub manages scopes and clients.
 */
export interface Hub {
  /** Get the current client */
  getClient(): SentryClient | undefined
  /** Get the current scope */
  getScope(): Scope
  /** Push a new scope */
  pushScope(): Scope
  /** Pop the current scope */
  popScope(): boolean
  /** Run callback with isolated scope */
  withScope(callback: (scope: Scope) => void): void
  /** Capture exception */
  captureException(exception: unknown, hint?: EventHint): string
  /** Capture message */
  captureMessage(message: string, level?: SeverityLevel, hint?: EventHint): string
  /** Capture event */
  captureEvent(event: SentryEvent, hint?: EventHint): string
  /** Add breadcrumb */
  addBreadcrumb(breadcrumb: Breadcrumb, hint?: BreadcrumbHint): void
  /** Set user */
  setUser(user: User | null): void
  /** Set tags */
  setTags(tags: Tags): void
  /** Set tag */
  setTag(key: string, value: string): void
  /** Set extra */
  setExtra(key: string, extra: unknown): void
  /** Set extras */
  setExtras(extras: Extras): void
  /** Set context */
  setContext(name: string, context: Context | null): void
}
