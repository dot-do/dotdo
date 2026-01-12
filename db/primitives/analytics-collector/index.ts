/**
 * AnalyticsCollector - Segment-compatible event collection primitive
 *
 * Provides event collection and user tracking with:
 * - Event Collection: track(), page(), screen(), identify(), group(), alias()
 * - User Sessions: session tracking, device detection, referrer tracking
 * - Batching: automatic event batching with flush intervals
 * - User Identification: anonymous ID -> user ID resolution
 * - Context Enrichment: automatic context (IP, user agent, geo)
 *
 * @module db/primitives/analytics-collector
 */

// ============================================================================
// TYPES
// ============================================================================

export interface AnalyticsContext {
  ip?: string
  userAgent?: string
  locale?: string
  timezone?: string
  library?: {
    name: string
    version: string
  }
  page?: {
    url?: string
    referrer?: string
    title?: string
    path?: string
    search?: string
  }
  device?: DeviceInfo
  os?: OSInfo
  browser?: BrowserInfo
  campaign?: CampaignInfo
  [key: string]: unknown
}

export interface DeviceInfo {
  type: 'mobile' | 'tablet' | 'desktop' | 'unknown'
  manufacturer?: string
  model?: string
}

export interface OSInfo {
  name: string
  version?: string
}

export interface BrowserInfo {
  name: string
  version?: string
}

export interface CampaignInfo {
  source?: string
  medium?: string
  name?: string
  term?: string
  content?: string
}

export interface ReferrerInfo {
  url: string
  source?: string
  medium?: string
}

export interface BaseEvent {
  messageId?: string
  timestamp?: Date | string
  userId?: string
  anonymousId?: string
  context?: AnalyticsContext
  integrations?: Record<string, boolean | Record<string, unknown>>
  [key: string]: unknown
}

export interface TrackEvent extends BaseEvent {
  event: string
  properties?: Record<string, unknown>
}

export interface PageEvent extends BaseEvent {
  name?: string
  category?: string
  properties?: {
    url?: string
    referrer?: string
    title?: string
    path?: string
    search?: string
    [key: string]: unknown
  }
}

export interface ScreenEvent extends BaseEvent {
  name: string
  properties?: Record<string, unknown>
}

export interface IdentifyEvent extends BaseEvent {
  traits?: Record<string, unknown>
}

export interface GroupEvent extends BaseEvent {
  groupId: string
  traits?: Record<string, unknown>
}

export interface AliasEvent {
  previousId: string
  userId: string
  messageId?: string
  timestamp?: Date | string
  context?: AnalyticsContext
  integrations?: Record<string, boolean | Record<string, unknown>>
}

export interface Session {
  id: string
  userId?: string
  anonymousId?: string
  startedAt: Date
  lastActivity: Date
  pageViews: number
  events: number
  device?: DeviceInfo
  os?: OSInfo
  browser?: BrowserInfo
  referrer?: ReferrerInfo
  campaign?: CampaignInfo
}

export interface UserIdentity {
  userId?: string
  anonymousIds: string[]
  traits: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface BatchResult {
  success: boolean
  count: number
  error?: Error
  destinations?: Record<string, { success: boolean; error?: Error }>
}

export interface Destination {
  name: string
  send: (batch: unknown[]) => Promise<{ success: boolean; count: number }>
}

export type EventMiddleware = (event: unknown) => unknown | null

export interface AnalyticsCollectorOptions {
  writeKey: string
  flushAt?: number
  flushInterval?: number
  maxQueueSize?: number
  retries?: number
  retryDelay?: number
  retryBackoff?: 'fixed' | 'exponential'
  dedupWindow?: number
  sessionTimeout?: number
  destinations?: Destination[]
  middleware?: EventMiddleware[]
  onTrack?: (event: TrackEvent) => void
  onFlush?: (result: BatchResult) => void
  onError?: (error: Error) => void
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface QueuedEvent {
  type: 'track' | 'page' | 'screen' | 'identify' | 'group' | 'alias'
  messageId: string
  timestamp: string
  userId?: string
  anonymousId?: string
  context?: AnalyticsContext
  integrations?: Record<string, boolean | Record<string, unknown>>
  [key: string]: unknown
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateId(): string {
  const hex = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) {
      id += '-'
    }
    id += hex[Math.floor(Math.random() * 16)]
  }
  return id
}

function generateSessionId(): string {
  return `sess_${generateId().replace(/-/g, '').slice(0, 20)}`
}

function parseUserAgent(userAgent: string): {
  device: DeviceInfo
  os: OSInfo
  browser: BrowserInfo
} {
  const device: DeviceInfo = { type: 'unknown' }
  const os: OSInfo = { name: 'Unknown' }
  const browser: BrowserInfo = { name: 'Unknown' }

  // Device detection
  if (/iPhone/i.test(userAgent)) {
    device.type = 'mobile'
    device.manufacturer = 'Apple'
    device.model = 'iPhone'
  } else if (/iPad/i.test(userAgent)) {
    device.type = 'tablet'
    device.manufacturer = 'Apple'
    device.model = 'iPad'
  } else if (/Android/i.test(userAgent)) {
    device.type = /Mobile/i.test(userAgent) ? 'mobile' : 'tablet'
    device.manufacturer = 'Android'
  } else {
    device.type = 'desktop'
  }

  // OS detection
  if (/Mac OS X/i.test(userAgent)) {
    os.name = 'macOS'
    const match = userAgent.match(/Mac OS X\s*([\d_]+)/)
    if (match?.[1]) {
      os.version = match[1].replace(/_/g, '.')
    }
  } else if (/Windows NT/i.test(userAgent)) {
    os.name = 'Windows'
    const match = userAgent.match(/Windows NT\s*([\d.]+)/)
    if (match) {
      os.version = match[1]
    }
  } else if (/iPhone OS/i.test(userAgent) || /iPad/i.test(userAgent)) {
    os.name = 'iOS'
    const match = userAgent.match(/OS\s*([\d_]+)/)
    if (match?.[1]) {
      os.version = match[1].replace(/_/g, '.')
    }
  } else if (/Android/i.test(userAgent)) {
    os.name = 'Android'
    const match = userAgent.match(/Android\s*([\d.]+)/)
    if (match) {
      os.version = match[1]
    }
  } else if (/Linux/i.test(userAgent)) {
    os.name = 'Linux'
  }

  // Browser detection
  if (/Chrome/i.test(userAgent) && !/Chromium|Edge/i.test(userAgent)) {
    browser.name = 'Chrome'
    const match = userAgent.match(/Chrome\/([\d.]+)/)
    if (match) {
      browser.version = match[1]
    }
  } else if (/Firefox/i.test(userAgent)) {
    browser.name = 'Firefox'
    const match = userAgent.match(/Firefox\/([\d.]+)/)
    if (match) {
      browser.version = match[1]
    }
  } else if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) {
    browser.name = 'Safari'
    const match = userAgent.match(/Version\/([\d.]+)/)
    if (match) {
      browser.version = match[1]
    }
  } else if (/Edge/i.test(userAgent)) {
    browser.name = 'Edge'
    const match = userAgent.match(/Edge\/([\d.]+)/)
    if (match) {
      browser.version = match[1]
    }
  }

  return { device, os, browser }
}

function parseReferrer(url: string): ReferrerInfo {
  const referrer: ReferrerInfo = { url }

  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()

    // Common referrer sources
    if (host.includes('google')) {
      referrer.source = 'google'
      referrer.medium = 'organic'
    } else if (host.includes('facebook') || host.includes('fb.com')) {
      referrer.source = 'facebook'
      referrer.medium = 'social'
    } else if (host.includes('twitter') || host.includes('t.co')) {
      referrer.source = 'twitter'
      referrer.medium = 'social'
    } else if (host.includes('linkedin')) {
      referrer.source = 'linkedin'
      referrer.medium = 'social'
    } else if (host.includes('bing')) {
      referrer.source = 'bing'
      referrer.medium = 'organic'
    } else if (host.includes('yahoo')) {
      referrer.source = 'yahoo'
      referrer.medium = 'organic'
    } else {
      referrer.source = host
      referrer.medium = 'referral'
    }
  } catch {
    // Invalid URL
  }

  return referrer
}

function parseUTMParams(url: string): CampaignInfo | undefined {
  try {
    const parsed = new URL(url)
    const params = parsed.searchParams

    const source = params.get('utm_source')
    const medium = params.get('utm_medium')
    const name = params.get('utm_campaign')
    const term = params.get('utm_term')
    const content = params.get('utm_content')

    if (source || medium || name) {
      return {
        source: source || undefined,
        medium: medium || undefined,
        name: name || undefined,
        term: term || undefined,
        content: content || undefined,
      }
    }
  } catch {
    // Invalid URL
  }

  return undefined
}

// ============================================================================
// ANALYTICS COLLECTOR CLASS
// ============================================================================

export class AnalyticsCollector {
  readonly writeKey: string
  readonly options: Required<
    Pick<
      AnalyticsCollectorOptions,
      | 'flushAt'
      | 'flushInterval'
      | 'maxQueueSize'
      | 'retries'
      | 'retryDelay'
      | 'retryBackoff'
      | 'dedupWindow'
      | 'sessionTimeout'
      | 'destinations'
      | 'middleware'
    >
  > &
    Pick<AnalyticsCollectorOptions, 'onTrack' | 'onFlush' | 'onError'>

  private queue: QueuedEvent[] = []
  private sessions: Map<string, Session> = new Map()
  private identities: Map<string, UserIdentity> = new Map()
  private seenMessageIds: Map<string, number> = new Map()
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private flushLock: Promise<BatchResult> | null = null
  private closed = false

  constructor(options: AnalyticsCollectorOptions) {
    if (!options.writeKey) {
      throw new Error('writeKey is required')
    }

    this.writeKey = options.writeKey
    this.options = {
      flushAt: options.flushAt ?? 20,
      flushInterval: options.flushInterval ?? 10000,
      maxQueueSize: options.maxQueueSize ?? 10000,
      retries: options.retries ?? 3,
      retryDelay: options.retryDelay ?? 100,
      retryBackoff: options.retryBackoff ?? 'exponential',
      dedupWindow: options.dedupWindow ?? 60000,
      sessionTimeout: options.sessionTimeout ?? 30 * 60 * 1000,
      destinations: options.destinations ?? [],
      middleware: options.middleware ?? [],
      onTrack: options.onTrack,
      onFlush: options.onFlush,
      onError: options.onError,
    }

    // Start flush interval timer
    this.startFlushTimer()
  }

  private startFlushTimer(): void {
    if (this.options.flushInterval > 0) {
      this.flushTimer = setInterval(() => {
        this.flush().catch((err) => {
          this.options.onError?.(err)
        })
      }, this.options.flushInterval)
    }
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  get queueSize(): number {
    return this.queue.length
  }

  private getUserKey(userId?: string, anonymousId?: string): string {
    return userId || anonymousId || ''
  }

  private getOrCreateSession(
    userId?: string,
    anonymousId?: string,
    context?: AnalyticsContext
  ): Session {
    const userKey = this.getUserKey(userId, anonymousId)
    let session = this.sessions.get(userKey)
    const now = new Date()

    // Check if session expired
    if (session) {
      const elapsed = now.getTime() - session.lastActivity.getTime()
      if (elapsed > this.options.sessionTimeout) {
        session = undefined // Expire session
      }
    }

    if (!session) {
      session = {
        id: generateSessionId(),
        userId,
        anonymousId,
        startedAt: now,
        lastActivity: now,
        pageViews: 0,
        events: 0,
      }

      // Parse device/browser/OS from user agent
      if (context?.userAgent) {
        const { device, os, browser } = parseUserAgent(context.userAgent)
        session.device = device
        session.os = os
        session.browser = browser
      }

      this.sessions.set(userKey, session)
    }

    // Update last activity
    session.lastActivity = now

    return session
  }

  private applyMiddleware(event: unknown): unknown | null {
    let processed: unknown = event
    for (const middleware of this.options.middleware) {
      if (processed === null) return null
      processed = middleware(processed)
    }
    return processed
  }

  private addToQueue(event: QueuedEvent): void {
    // Check deduplication
    const messageId = event.messageId
    const lastSeen = this.seenMessageIds.get(messageId)
    const now = Date.now()

    if (lastSeen && now - lastSeen < this.options.dedupWindow) {
      return // Duplicate, skip
    }

    this.seenMessageIds.set(messageId, now)

    // Apply middleware
    const processed = this.applyMiddleware(event)
    if (processed === null) {
      return // Dropped by middleware
    }

    // Enforce max queue size (drop oldest)
    while (this.queue.length >= this.options.maxQueueSize) {
      this.queue.shift()
    }

    this.queue.push(processed as QueuedEvent)

    // Auto-flush if batch size reached
    if (this.queue.length >= this.options.flushAt) {
      // Don't await - let it run in background but track it
      this.flush().catch((err) => {
        this.options.onError?.(err)
      })
    }
  }

  private enrichContext(context?: AnalyticsContext): AnalyticsContext {
    return {
      ...context,
      library: {
        name: 'dotdo-analytics',
        version: '1.0.0',
      },
    }
  }

  async track(event: TrackEvent): Promise<void> {
    if (this.closed) {
      throw new Error('Analytics is closed')
    }

    if (!event.userId && !event.anonymousId) {
      throw new Error('userId or anonymousId is required')
    }

    if (!event.event) {
      throw new Error('event name is required')
    }

    const session = this.getOrCreateSession(
      event.userId,
      event.anonymousId,
      event.context
    )
    session.events++

    const queuedEvent: QueuedEvent = {
      type: 'track',
      messageId: event.messageId || generateId(),
      timestamp:
        event.timestamp instanceof Date
          ? event.timestamp.toISOString()
          : event.timestamp || new Date().toISOString(),
      userId: event.userId,
      anonymousId: event.anonymousId,
      event: event.event,
      properties: event.properties,
      context: this.enrichContext(event.context),
      integrations: event.integrations,
    }

    this.addToQueue(queuedEvent)
    this.options.onTrack?.(event)
  }

  async page(event: PageEvent): Promise<void> {
    if (this.closed) {
      throw new Error('Analytics is closed')
    }

    if (!event.userId && !event.anonymousId) {
      throw new Error('userId or anonymousId is required')
    }

    const session = this.getOrCreateSession(
      event.userId,
      event.anonymousId,
      event.context
    )
    session.pageViews++

    // Track referrer from first page view
    if (!session.referrer && event.properties?.referrer) {
      session.referrer = parseReferrer(event.properties.referrer as string)
    }

    // Track campaign from URL params
    if (!session.campaign && event.properties?.url) {
      session.campaign = parseUTMParams(event.properties.url as string)
    }

    const queuedEvent: QueuedEvent = {
      type: 'page',
      messageId: event.messageId || generateId(),
      timestamp:
        event.timestamp instanceof Date
          ? event.timestamp.toISOString()
          : event.timestamp || new Date().toISOString(),
      userId: event.userId,
      anonymousId: event.anonymousId,
      name: event.name,
      category: event.category,
      properties: event.properties,
      context: this.enrichContext(event.context),
      integrations: event.integrations,
    }

    this.addToQueue(queuedEvent)
  }

  async screen(event: ScreenEvent): Promise<void> {
    if (this.closed) {
      throw new Error('Analytics is closed')
    }

    if (!event.userId && !event.anonymousId) {
      throw new Error('userId or anonymousId is required')
    }

    const session = this.getOrCreateSession(
      event.userId,
      event.anonymousId,
      event.context
    )
    session.pageViews++

    const queuedEvent: QueuedEvent = {
      type: 'screen',
      messageId: event.messageId || generateId(),
      timestamp:
        event.timestamp instanceof Date
          ? event.timestamp.toISOString()
          : event.timestamp || new Date().toISOString(),
      userId: event.userId,
      anonymousId: event.anonymousId,
      name: event.name,
      properties: event.properties,
      context: this.enrichContext(event.context),
      integrations: event.integrations,
    }

    this.addToQueue(queuedEvent)
  }

  async identify(event: IdentifyEvent): Promise<void> {
    if (this.closed) {
      throw new Error('Analytics is closed')
    }

    if (!event.userId && !event.anonymousId) {
      throw new Error('userId or anonymousId is required')
    }

    // Update identity store
    const identityKey = event.userId || event.anonymousId!
    let identity = this.identities.get(identityKey)
    const now = new Date()

    if (!identity) {
      identity = {
        userId: event.userId,
        anonymousIds: [],
        traits: {},
        createdAt: now,
        updatedAt: now,
      }
      this.identities.set(identityKey, identity)
    }

    // Merge traits
    if (event.traits) {
      identity.traits = { ...identity.traits, ...event.traits }
    }
    identity.updatedAt = now

    // Link anonymous to user
    if (event.userId && event.anonymousId) {
      if (!identity.anonymousIds.includes(event.anonymousId)) {
        identity.anonymousIds.push(event.anonymousId)
      }
    }

    const queuedEvent: QueuedEvent = {
      type: 'identify',
      messageId: event.messageId || generateId(),
      timestamp:
        event.timestamp instanceof Date
          ? event.timestamp.toISOString()
          : event.timestamp || new Date().toISOString(),
      userId: event.userId,
      anonymousId: event.anonymousId,
      traits: event.traits,
      context: this.enrichContext(event.context),
      integrations: event.integrations,
    }

    this.addToQueue(queuedEvent)
  }

  async group(event: GroupEvent): Promise<void> {
    if (this.closed) {
      throw new Error('Analytics is closed')
    }

    if (!event.userId && !event.anonymousId) {
      throw new Error('userId or anonymousId is required')
    }

    if (!event.groupId) {
      throw new Error('groupId is required')
    }

    const queuedEvent: QueuedEvent = {
      type: 'group',
      messageId: event.messageId || generateId(),
      timestamp:
        event.timestamp instanceof Date
          ? event.timestamp.toISOString()
          : event.timestamp || new Date().toISOString(),
      userId: event.userId,
      anonymousId: event.anonymousId,
      groupId: event.groupId,
      traits: event.traits,
      context: this.enrichContext(event.context),
      integrations: event.integrations,
    }

    this.addToQueue(queuedEvent)
  }

  async alias(event: AliasEvent): Promise<void> {
    if (this.closed) {
      throw new Error('Analytics is closed')
    }

    if (!event.previousId) {
      throw new Error('previousId is required')
    }

    if (!event.userId) {
      throw new Error('userId is required')
    }

    // Merge identities
    const previousIdentity = this.identities.get(event.previousId)
    if (previousIdentity) {
      let newIdentity = this.identities.get(event.userId)
      if (!newIdentity) {
        newIdentity = {
          userId: event.userId,
          anonymousIds: [],
          traits: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        this.identities.set(event.userId, newIdentity)
      }

      // Merge traits from previous identity
      newIdentity.traits = { ...previousIdentity.traits, ...newIdentity.traits }

      // Add previous ID to anonymous IDs
      if (!newIdentity.anonymousIds.includes(event.previousId)) {
        newIdentity.anonymousIds.push(event.previousId)
      }
    }

    const queuedEvent: QueuedEvent = {
      type: 'alias',
      messageId: event.messageId || generateId(),
      timestamp:
        event.timestamp instanceof Date
          ? event.timestamp.toISOString()
          : event.timestamp || new Date().toISOString(),
      previousId: event.previousId,
      userId: event.userId,
      context: this.enrichContext(event.context),
      integrations: event.integrations,
    }

    this.addToQueue(queuedEvent)
  }

  getSession(userIdOrAnonymousId: string): Session | undefined {
    return this.sessions.get(userIdOrAnonymousId)
  }

  getIdentity(userIdOrAnonymousId: string): UserIdentity | undefined {
    return this.identities.get(userIdOrAnonymousId)
  }

  async flush(): Promise<BatchResult> {
    // If another flush is in progress, wait for it and return its result
    if (this.flushLock) {
      return this.flushLock
    }

    if (this.queue.length === 0) {
      const result = { success: true, count: 0 }
      this.options.onFlush?.(result)
      return result
    }

    // Take ownership of the queue and create lock
    const batch = [...this.queue]
    this.queue = []

    // Create the flush promise and store it
    this.flushLock = this.doFlush(batch)

    try {
      return await this.flushLock
    } finally {
      this.flushLock = null
    }
  }

  private async doFlush(batch: QueuedEvent[]): Promise<BatchResult> {
    const destinations = this.options.destinations
    if (destinations.length === 0) {
      const result = { success: true, count: batch.length }
      this.options.onFlush?.(result)
      return result
    }

    const destinationResults: Record<
      string,
      { success: boolean; error?: Error }
    > = {}
    let hasAnySuccess = false
    let lastError: Error | undefined

    for (const destination of destinations) {
      let attempts = 0
      let delay = this.options.retryDelay
      let success = false
      let destError: Error | undefined

      // retries is number of RETRIES after first attempt
      // So total attempts = 1 + retries
      const maxAttempts = 1 + this.options.retries

      while (attempts < maxAttempts && !success) {
        if (attempts > 0) {
          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, delay))
          if (this.options.retryBackoff === 'exponential') {
            delay *= 2
          }
        }

        attempts++

        try {
          await destination.send(batch)
          success = true
          hasAnySuccess = true
          destinationResults[destination.name] = { success: true }
        } catch (err) {
          destError = err instanceof Error ? err : new Error(String(err))
          lastError = destError
        }
      }

      // Record failure if we exhausted all attempts without success
      if (!success) {
        destinationResults[destination.name] = {
          success: false,
          error: destError,
        }
        if (destError) {
          this.options.onError?.(destError)
        }
      }
    }

    const result: BatchResult = {
      success: hasAnySuccess,
      count: batch.length,
      destinations: destinationResults,
      error: !hasAnySuccess ? lastError : undefined,
    }

    this.options.onFlush?.(result)
    return result
  }

  async close(): Promise<void> {
    if (this.closed) return

    this.stopFlushTimer()
    await this.flush()
    this.closed = true
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createAnalyticsCollector(
  options: AnalyticsCollectorOptions
): AnalyticsCollector {
  return new AnalyticsCollector(options)
}
