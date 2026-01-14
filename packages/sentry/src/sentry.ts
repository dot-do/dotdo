/**
 * @dotdo/sentry - Core Implementation
 *
 * Edge-compatible Sentry SDK implementation.
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
  ScopeInterface,
  EventHint,
  ParsedDsn,
  Transport,
  Envelope,
} from './types.js'
import { Scope } from './scope.js'
import { FetchTransport } from './transport.js'

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
    scope?: ScopeInterface
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
    scope?: ScopeInterface
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

  captureEvent(event: SentryEvent, hint?: EventHint, scope?: ScopeInterface): string {
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
    scope?: ScopeInterface
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

// Re-export Scope for external use (SentryClient is already exported via its class declaration)
export { Scope }
