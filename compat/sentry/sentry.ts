/**
 * @dotdo/sentry - Core Implementation
 *
 * Edge-compatible Sentry SDK implementation using @dotdo/rpc.
 * Provides error tracking, breadcrumbs, and context management.
 *
 * @module @dotdo/sentry/sentry
 */

import type {
  SentryOptions,
  SentryEvent,
  Breadcrumb,
  BreadcrumbHint,
  User,
  Tags,
  Extras,
  Context,
  SeverityLevel,
  Scope as IScope,
  EventHint,
  ParsedDsn,
  Transport,
  Envelope,
  EnvelopeItem,
  TransportResult,
} from './types.js'

// =============================================================================
// Constants
// =============================================================================

const SDK_NAME = '@dotdo/sentry'
const SDK_VERSION = '0.1.0'
const DEFAULT_MAX_BREADCRUMBS = 100
const DEFAULT_SAMPLE_RATE = 1.0

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate a UUID v4 event ID.
 */
function generateEventId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // Set version 4
  const byte6 = bytes[6]
  const byte8 = bytes[8]
  if (byte6 !== undefined) {
    bytes[6] = (byte6 & 0x0f) | 0x40
  }
  // Set variant
  if (byte8 !== undefined) {
    bytes[8] = (byte8 & 0x3f) | 0x80
  }

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return hex
}

/**
 * Parse a Sentry DSN string.
 */
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn)
    const pathParts = url.pathname.split('/')
    const projectId = pathParts.pop() || ''

    return {
      protocol: url.protocol.replace(':', ''),
      publicKey: url.username,
      secretKey: url.password || undefined,
      host: url.hostname,
      port: url.port || undefined,
      path: pathParts.join('/') || undefined,
      projectId,
    }
  } catch {
    return null
  }
}

/**
 * Build the Sentry API URL from parsed DSN.
 */
function buildApiUrl(dsn: ParsedDsn): string {
  const { protocol, host, port, path, projectId } = dsn
  const portStr = port ? `:${port}` : ''
  const pathStr = path ? path : ''
  return `${protocol}://${host}${portStr}${pathStr}/api/${projectId}/envelope/`
}

/**
 * Extract stack frames from an error.
 */
function extractStackFrames(error: Error): Array<{
  filename?: string
  function?: string
  lineno?: number
  colno?: number
  in_app?: boolean
}> {
  if (!error.stack) return []

  const lines = error.stack.split('\n').slice(1) // Skip error message line
  const frames: Array<{
    filename?: string
    function?: string
    lineno?: number
    colno?: number
    in_app?: boolean
  }> = []

  for (const line of lines) {
    const match = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/)
    if (match) {
      const filename = match[2] ?? '<unknown>'
      const linenoStr = match[3] ?? '0'
      const colnoStr = match[4] ?? '0'
      frames.push({
        function: match[1] || '<anonymous>',
        filename,
        lineno: parseInt(linenoStr, 10),
        colno: parseInt(colnoStr, 10),
        in_app: !filename.includes('node_modules'),
      })
    }
  }

  // Sentry expects frames in reverse order (oldest first)
  return frames.reverse()
}

// =============================================================================
// Scope Implementation
// =============================================================================

/**
 * Scope implementation for managing contextual data.
 */
export class Scope implements IScope {
  private _user: User | null = null
  private _tags: Tags = {}
  private _extras: Extras = {}
  private _contexts: Record<string, Context> = {}
  private _level: SeverityLevel | undefined
  private _transactionName: string | undefined
  private _breadcrumbs: Breadcrumb[] = []
  private _fingerprint: string[] | undefined
  private _maxBreadcrumbs: number

  constructor(maxBreadcrumbs: number = DEFAULT_MAX_BREADCRUMBS) {
    this._maxBreadcrumbs = maxBreadcrumbs
  }

  setUser(user: User | null): Scope {
    this._user = user
    return this
  }

  getUser(): User | null {
    return this._user
  }

  setTag(key: string, value: string): Scope {
    this._tags[key] = value
    return this
  }

  setTags(tags: Tags): Scope {
    this._tags = { ...this._tags, ...tags }
    return this
  }

  getTags(): Tags {
    return { ...this._tags }
  }

  setExtra(key: string, value: unknown): Scope {
    this._extras[key] = value
    return this
  }

  setExtras(extras: Extras): Scope {
    this._extras = { ...this._extras, ...extras }
    return this
  }

  getExtras(): Extras {
    return { ...this._extras }
  }

  setContext(name: string, context: Context | null): Scope {
    if (context === null) {
      delete this._contexts[name]
    } else {
      this._contexts[name] = context
    }
    return this
  }

  getContext(name: string): Context | undefined {
    return this._contexts[name]
  }

  getContexts(): Record<string, Context> {
    return { ...this._contexts }
  }

  setLevel(level: SeverityLevel): Scope {
    this._level = level
    return this
  }

  getLevel(): SeverityLevel | undefined {
    return this._level
  }

  setTransactionName(name: string): Scope {
    this._transactionName = name
    return this
  }

  getTransactionName(): string | undefined {
    return this._transactionName
  }

  addBreadcrumb(breadcrumb: Breadcrumb, maxBreadcrumbs?: number): Scope {
    const max = maxBreadcrumbs ?? this._maxBreadcrumbs
    const enriched = {
      ...breadcrumb,
      timestamp: breadcrumb.timestamp ?? Date.now() / 1000,
    }

    this._breadcrumbs.push(enriched)

    if (this._breadcrumbs.length > max) {
      this._breadcrumbs = this._breadcrumbs.slice(-max)
    }

    return this
  }

  getBreadcrumbs(): Breadcrumb[] {
    return [...this._breadcrumbs]
  }

  clearBreadcrumbs(): Scope {
    this._breadcrumbs = []
    return this
  }

  setFingerprint(fingerprint: string[]): Scope {
    this._fingerprint = fingerprint
    return this
  }

  getFingerprint(): string[] | undefined {
    return this._fingerprint
  }

  clear(): Scope {
    this._user = null
    this._tags = {}
    this._extras = {}
    this._contexts = {}
    this._level = undefined
    this._transactionName = undefined
    this._breadcrumbs = []
    this._fingerprint = undefined
    return this
  }

  clone(): Scope {
    const newScope = new Scope(this._maxBreadcrumbs)
    newScope._user = this._user ? { ...this._user } : null
    newScope._tags = { ...this._tags }
    newScope._extras = { ...this._extras }
    newScope._contexts = Object.fromEntries(
      Object.entries(this._contexts).map(([k, v]) => [k, { ...v }])
    )
    newScope._level = this._level
    newScope._transactionName = this._transactionName
    newScope._breadcrumbs = this._breadcrumbs.map((b) => ({ ...b }))
    newScope._fingerprint = this._fingerprint ? [...this._fingerprint] : undefined
    return newScope
  }

  applyToEvent(event: SentryEvent): SentryEvent {
    const applied = { ...event }

    if (this._user) {
      applied.user = { ...this._user, ...applied.user }
    }

    if (Object.keys(this._tags).length > 0) {
      applied.tags = { ...this._tags, ...applied.tags }
    }

    if (Object.keys(this._extras).length > 0) {
      applied.extra = { ...this._extras, ...applied.extra }
    }

    if (Object.keys(this._contexts).length > 0) {
      applied.contexts = { ...this._contexts, ...applied.contexts }
    }

    if (this._level && !applied.level) {
      applied.level = this._level
    }

    if (this._transactionName && !applied.transaction) {
      applied.transaction = this._transactionName
    }

    if (this._breadcrumbs.length > 0) {
      applied.breadcrumbs = [...this._breadcrumbs, ...(applied.breadcrumbs || [])]
    }

    if (this._fingerprint && !applied.fingerprint) {
      applied.fingerprint = [...this._fingerprint]
    }

    return applied
  }
}

// =============================================================================
// Transport Implementation
// =============================================================================

/**
 * Default HTTP transport for sending events to Sentry.
 */
export class FetchTransport implements Transport {
  private readonly url: string
  private readonly publicKey: string
  private readonly fetchImpl: typeof fetch

  constructor(dsn: ParsedDsn, fetchImpl?: typeof fetch) {
    this.url = buildApiUrl(dsn)
    this.publicKey = dsn.publicKey
    this.fetchImpl = fetchImpl ?? globalThis.fetch
  }

  async send(envelope: Envelope): Promise<TransportResult> {
    const [header, items] = envelope

    // Build envelope body
    const lines: string[] = []
    lines.push(JSON.stringify(header))

    for (const [itemHeader, payload] of items) {
      lines.push(JSON.stringify(itemHeader))
      lines.push(typeof payload === 'string' ? payload : JSON.stringify(payload))
    }

    const body = lines.join('\n')

    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=${SDK_NAME}/${SDK_VERSION}, sentry_key=${this.publicKey}`,
        },
        body,
      })

      // Extract headers from response
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      return {
        statusCode: response.status,
        headers: responseHeaders,
      }
    } catch (error) {
      // Return a failed result on network errors
      return {
        statusCode: 0,
      }
    }
  }

  async flush(_timeout?: number): Promise<boolean> {
    // For the fetch transport, there's nothing to flush
    return true
  }
}

/**
 * In-memory transport for testing (stores events locally).
 */
export class InMemoryTransport implements Transport {
  private events: SentryEvent[] = []

  async send(envelope: Envelope): Promise<TransportResult> {
    const [, items] = envelope

    for (const [header, payload] of items) {
      if (header.type === 'event' && payload) {
        this.events.push(payload as SentryEvent)
      }
    }

    return { statusCode: 200 }
  }

  async flush(_timeout?: number): Promise<boolean> {
    return true
  }

  getEvents(): SentryEvent[] {
    return [...this.events]
  }

  clear(): void {
    this.events = []
  }
}

// =============================================================================
// Client Implementation
// =============================================================================

/**
 * Sentry client for capturing and sending events.
 */
export class SentryClient {
  private readonly options: SentryOptions
  private readonly dsn: ParsedDsn | undefined
  private readonly transport: Transport | undefined
  private enabled: boolean = true

  constructor(options: SentryOptions) {
    this.options = {
      sampleRate: DEFAULT_SAMPLE_RATE,
      maxBreadcrumbs: DEFAULT_MAX_BREADCRUMBS,
      attachStacktrace: false,
      sendDefaultPii: false,
      ...options,
    }

    if (options.dsn) {
      this.dsn = parseDsn(options.dsn) ?? undefined
      if (this.dsn) {
        this.transport = options.transport
          ? options.transport({ dsn: this.dsn, fetch: globalThis.fetch })
          : new FetchTransport(this.dsn)
      }
    }
  }

  captureException(
    exception: unknown,
    hint?: EventHint,
    scope?: IScope
  ): string {
    const eventId = generateEventId()

    if (!this.shouldSend()) {
      return eventId
    }

    const event = this.buildExceptionEvent(exception, eventId)

    this.sendEvent(event, hint, scope)

    return eventId
  }

  captureMessage(
    message: string,
    level: SeverityLevel = 'info',
    hint?: EventHint,
    scope?: IScope
  ): string {
    const eventId = generateEventId()

    if (!this.shouldSend()) {
      return eventId
    }

    const event: SentryEvent = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      level,
      message,
      sdk: {
        name: SDK_NAME,
        version: SDK_VERSION,
      },
    }

    if (this.options.attachStacktrace) {
      const syntheticError = new Error(message)
      event.exception = {
        values: [
          {
            type: 'Error',
            value: message,
            stacktrace: {
              frames: extractStackFrames(syntheticError),
            },
            mechanism: {
              type: 'generic',
              handled: true,
            },
          },
        ],
      }
    }

    this.sendEvent(event, hint, scope)

    return eventId
  }

  captureEvent(event: SentryEvent, hint?: EventHint, scope?: IScope): string {
    const eventId = event.event_id ?? generateEventId()

    if (!this.shouldSend()) {
      return eventId
    }

    const enriched: SentryEvent = {
      ...event,
      event_id: eventId,
      timestamp: event.timestamp ?? Date.now() / 1000,
      platform: event.platform ?? 'javascript',
      sdk: event.sdk ?? {
        name: SDK_NAME,
        version: SDK_VERSION,
      },
    }

    this.sendEvent(enriched, hint, scope)

    return eventId
  }

  getOptions(): SentryOptions {
    return { ...this.options }
  }

  getDsn(): ParsedDsn | undefined {
    return this.dsn
  }

  getTransport(): Transport | undefined {
    return this.transport
  }

  async flush(timeout?: number): Promise<boolean> {
    if (this.transport) {
      return this.transport.flush(timeout)
    }
    return true
  }

  async close(_timeout?: number): Promise<boolean> {
    this.enabled = false
    return this.flush(_timeout)
  }

  private shouldSend(): boolean {
    if (!this.enabled || !this.transport) {
      return false
    }

    const sampleRate = this.options.sampleRate ?? DEFAULT_SAMPLE_RATE
    return Math.random() < sampleRate
  }

  private buildExceptionEvent(exception: unknown, eventId: string): SentryEvent {
    const error =
      exception instanceof Error
        ? exception
        : new Error(String(exception))

    const event: SentryEvent = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      level: 'error',
      exception: {
        values: [
          {
            type: error.name,
            value: error.message,
            stacktrace: {
              frames: extractStackFrames(error),
            },
            mechanism: {
              type: 'generic',
              handled: true,
            },
          },
        ],
      },
      sdk: {
        name: SDK_NAME,
        version: SDK_VERSION,
      },
    }

    return event
  }

  private sendEvent(
    event: SentryEvent,
    hint?: EventHint,
    scope?: IScope
  ): void {
    let processedEvent = { ...event }

    // Apply global options
    if (this.options.release) {
      processedEvent.release = this.options.release
    }
    if (this.options.environment) {
      processedEvent.environment = this.options.environment
    }
    if (this.options.serverName) {
      processedEvent.server_name = this.options.serverName
    }
    if (this.options.dist) {
      processedEvent.dist = this.options.dist
    }

    // Apply scope
    if (scope) {
      processedEvent = scope.applyToEvent(processedEvent)
    }

    // Run beforeSend hook
    if (this.options.beforeSend) {
      const result = this.options.beforeSend(processedEvent, hint ?? {})
      if (result === null) {
        return // Event dropped
      }
      if (result instanceof Promise) {
        result.then((asyncResult) => {
          if (asyncResult) {
            this.doSend(asyncResult)
          }
        })
        return
      }
      processedEvent = result
    }

    this.doSend(processedEvent)
  }

  private doSend(event: SentryEvent): void {
    if (!this.transport || !this.dsn) {
      return
    }

    const envelope: Envelope = [
      {
        event_id: event.event_id,
        sent_at: new Date().toISOString(),
        dsn: this.options.dsn,
        sdk: {
          name: SDK_NAME,
          version: SDK_VERSION,
        },
      },
      [[{ type: 'event' }, event]],
    ]

    // Fire and forget - don't await
    this.transport.send(envelope).catch(() => {
      // Silently ignore transport errors
    })
  }
}

// =============================================================================
// Hub Implementation
// =============================================================================

/**
 * Hub manages the client and scope stack.
 */
class Hub {
  private client: SentryClient | undefined
  private scopeStack: Scope[] = []
  private options: SentryOptions

  constructor(options: SentryOptions = {}) {
    this.options = options
    this.scopeStack.push(new Scope(options.maxBreadcrumbs))
  }

  bindClient(client: SentryClient | undefined): void {
    this.client = client
  }

  getClient(): SentryClient | undefined {
    return this.client
  }

  getScope(): Scope {
    const scope = this.scopeStack[this.scopeStack.length - 1]
    // scopeStack always has at least one element (created in constructor)
    return scope!
  }

  pushScope(): Scope {
    const newScope = this.getScope().clone()
    this.scopeStack.push(newScope)
    return newScope
  }

  popScope(): boolean {
    if (this.scopeStack.length <= 1) {
      return false
    }
    this.scopeStack.pop()
    return true
  }

  withScope(callback: (scope: Scope) => void): void {
    const scope = this.pushScope()
    try {
      callback(scope)
    } finally {
      this.popScope()
    }
  }

  captureException(exception: unknown, hint?: EventHint): string {
    const eventId = this.client?.captureException(exception, hint, this.getScope())
    return eventId ?? ''
  }

  captureMessage(
    message: string,
    level?: SeverityLevel,
    hint?: EventHint
  ): string {
    const eventId = this.client?.captureMessage(message, level, hint, this.getScope())
    return eventId ?? ''
  }

  captureEvent(event: SentryEvent, hint?: EventHint): string {
    const eventId = this.client?.captureEvent(event, hint, this.getScope())
    return eventId ?? ''
  }

  addBreadcrumb(breadcrumb: Breadcrumb, hint?: BreadcrumbHint): void {
    let processed = breadcrumb

    if (this.options.beforeBreadcrumb) {
      const result = this.options.beforeBreadcrumb(breadcrumb, hint)
      if (result === null) {
        return // Breadcrumb dropped
      }
      processed = result
    }

    this.getScope().addBreadcrumb(processed, this.options.maxBreadcrumbs)
  }

  setUser(user: User | null): void {
    this.getScope().setUser(user)
  }

  setTags(tags: Tags): void {
    this.getScope().setTags(tags)
  }

  setTag(key: string, value: string): void {
    this.getScope().setTag(key, value)
  }

  setExtra(key: string, extra: unknown): void {
    this.getScope().setExtra(key, extra)
  }

  setExtras(extras: Extras): void {
    this.getScope().setExtras(extras)
  }

  setContext(name: string, context: Context | null): void {
    this.getScope().setContext(name, context)
  }

  getOptions(): SentryOptions {
    return this.options
  }
}

// =============================================================================
// Global State
// =============================================================================

let globalHub: Hub | undefined

function getGlobalHub(): Hub {
  if (!globalHub) {
    globalHub = new Hub()
  }
  return globalHub
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Initialize Sentry with the given options.
 */
export function init(options: SentryOptions): void {
  const hub = new Hub(options)

  if (options.dsn) {
    const client = new SentryClient(options)
    hub.bindClient(client)
  }

  // Apply initial scope
  if (options.initialScope) {
    const scope = hub.getScope()
    if (options.initialScope.user) {
      scope.setUser(options.initialScope.user)
    }
    if (options.initialScope.tags) {
      scope.setTags(options.initialScope.tags)
    }
    if (options.initialScope.extra) {
      scope.setExtras(options.initialScope.extra)
    }
    if (options.initialScope.contexts) {
      for (const [name, context] of Object.entries(options.initialScope.contexts)) {
        scope.setContext(name, context)
      }
    }
    if (options.initialScope.level) {
      scope.setLevel(options.initialScope.level)
    }
  }

  globalHub = hub
}

/**
 * Capture an exception and send it to Sentry.
 */
export function captureException(exception: unknown, hint?: EventHint): string {
  return getGlobalHub().captureException(exception, hint)
}

/**
 * Capture a message and send it to Sentry.
 */
export function captureMessage(
  message: string,
  level?: SeverityLevel
): string {
  return getGlobalHub().captureMessage(message, level)
}

/**
 * Capture a custom event and send it to Sentry.
 */
export function captureEvent(event: SentryEvent, hint?: EventHint): string {
  return getGlobalHub().captureEvent(event, hint)
}

/**
 * Add a breadcrumb that will be sent with future events.
 */
export function addBreadcrumb(
  breadcrumb: Breadcrumb,
  hint?: BreadcrumbHint
): void {
  getGlobalHub().addBreadcrumb(breadcrumb, hint)
}

/**
 * Set user information that will be sent with future events.
 */
export function setUser(user: User | null): void {
  getGlobalHub().setUser(user)
}

/**
 * Set tags that will be sent with future events.
 */
export function setTags(tags: Tags): void {
  getGlobalHub().setTags(tags)
}

/**
 * Set a single tag that will be sent with future events.
 */
export function setTag(key: string, value: string): void {
  getGlobalHub().setTag(key, value)
}

/**
 * Set extra data that will be sent with future events.
 */
export function setExtra(key: string, value: unknown): void {
  getGlobalHub().setExtra(key, value)
}

/**
 * Set multiple extras that will be sent with future events.
 */
export function setExtras(extras: Extras): void {
  getGlobalHub().setExtras(extras)
}

/**
 * Set context that will be sent with future events.
 */
export function setContext(name: string, context: Context | null): void {
  getGlobalHub().setContext(name, context)
}

/**
 * Run a callback with an isolated scope.
 */
export function withScope(callback: (scope: Scope) => void): void {
  getGlobalHub().withScope(callback)
}

/**
 * Configure the current scope.
 */
export function configureScope(callback: (scope: Scope) => void): void {
  callback(getGlobalHub().getScope())
}

/**
 * Get the current hub.
 */
export function getCurrentHub(): Hub {
  return getGlobalHub()
}

/**
 * Get the current scope.
 */
export function getCurrentScope(): Scope {
  return getGlobalHub().getScope()
}

/**
 * Flush pending events.
 */
export async function flush(timeout?: number): Promise<boolean> {
  const client = getGlobalHub().getClient()
  return client ? client.flush(timeout) : true
}

/**
 * Close Sentry and flush pending events.
 */
export async function close(timeout?: number): Promise<boolean> {
  const client = getGlobalHub().getClient()
  return client ? client.close(timeout) : true
}

/**
 * Clear all Sentry state (useful for testing).
 */
export function _clear(): void {
  globalHub = undefined
}

/**
 * Get the global hub (useful for testing).
 */
export function _getHub(): Hub | undefined {
  return globalHub
}
