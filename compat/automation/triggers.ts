/**
 * Automation Triggers - n8n-compatible trigger nodes
 *
 * Implements trigger nodes for workflow automation:
 * - WebhookTrigger: HTTP endpoints that receive data
 * - CronTrigger: Scheduled execution based on cron expressions
 * - PollingTrigger: Periodically check external sources for changes
 */

// ============================================================================
// TYPES
// ============================================================================

export interface TriggerEvent {
  /** Unique event ID */
  id: string
  /** Source of the event (webhook, cron, polling) */
  source: 'webhook' | 'cron' | 'polling'
  /** Event data */
  data: unknown
  /** Timestamp */
  timestamp: number
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

export interface TriggerConfig {
  id?: string
}

export interface TriggerResult {
  success: boolean
  data?: unknown
  query?: Record<string, string>
  headers?: Record<string, string>
  responseData?: unknown
  error?: string
}

export type TriggerListener = (event: TriggerEvent) => void
export type ErrorListener = (error: Error) => void

// ============================================================================
// BASE TRIGGER
// ============================================================================

abstract class BaseTrigger<TConfig extends TriggerConfig = TriggerConfig> {
  readonly id: string
  protected config: TConfig
  protected listeners: Set<TriggerListener> = new Set()
  protected errorListeners: Set<ErrorListener> = new Set()

  constructor(config: TConfig) {
    this.id = config.id ?? `trigger-${crypto.randomUUID()}`
    this.config = config
  }

  onTrigger(listener: TriggerListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  protected emit(event: TriggerEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event)
      } catch (error) {
        this.emitError(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  protected emitError(error: Error): void {
    this.errorListeners.forEach((listener) => {
      try {
        listener(error)
      } catch {
        // Ignore errors in error handlers
      }
    })
  }

  protected generateEventId(): string {
    return `evt-${crypto.randomUUID()}`
  }
}

// ============================================================================
// WEBHOOK TRIGGER
// ============================================================================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface WebhookAuthentication {
  type: 'header' | 'basic' | 'hmac'
  header?: string
  value?: string
  username?: string
  password?: string
  secret?: string
  algorithm?: 'sha256' | 'sha1' | 'md5'
}

export interface WebhookTriggerConfig extends TriggerConfig {
  path: string
  method?: HttpMethod
  authentication?: WebhookAuthentication
  responseMode?: 'immediate' | 'lastNode'
  responseData?: unknown
}

export class WebhookTrigger extends BaseTrigger<WebhookTriggerConfig> {
  readonly path: string
  readonly method: HttpMethod

  constructor(config: WebhookTriggerConfig) {
    super(config)
    this.path = config.path
    this.method = config.method ?? 'POST'
  }

  async handleRequest(request: Request): Promise<TriggerResult> {
    try {
      // Validate authentication
      if (this.config.authentication) {
        const authResult = await this.validateAuthentication(request)
        if (!authResult.valid) {
          return {
            success: false,
            error: authResult.error ?? 'authentication failed',
          }
        }
      }

      // Parse request data
      const url = new URL(request.url)
      const query = Object.fromEntries(url.searchParams.entries())
      const headers = this.extractHeaders(request)
      let data: unknown

      const contentType = request.headers.get('content-type') ?? ''

      if (contentType.includes('application/json')) {
        data = await request.json()
      } else if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData()
        const entries: Record<string, unknown> = {}
        formData.forEach((value, key) => { entries[key] = value })
        data = entries
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await request.formData()
        const entries: Record<string, unknown> = {}
        formData.forEach((value, key) => { entries[key] = value })
        data = entries
      } else if (request.method === 'GET') {
        data = query
      } else {
        try {
          const text = await request.text()
          data = text ? JSON.parse(text) : {}
        } catch {
          data = {}
        }
      }

      // Emit trigger event
      const event: TriggerEvent = {
        id: this.generateEventId(),
        source: 'webhook',
        data,
        timestamp: Date.now(),
        metadata: {
          path: this.path,
          method: this.method,
          query,
          headers,
        },
      }
      this.emit(event)

      return {
        success: true,
        data,
        query,
        headers,
        responseData: this.config.responseData,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.emitError(error instanceof Error ? error : new Error(errorMessage))
      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  private extractHeaders(request: Request): Record<string, string> {
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    return headers
  }

  private async validateAuthentication(
    request: Request
  ): Promise<{ valid: boolean; error?: string }> {
    const auth = this.config.authentication
    if (!auth) return { valid: true }

    switch (auth.type) {
      case 'header': {
        const headerValue = request.headers.get(auth.header!)
        if (headerValue !== auth.value) {
          return { valid: false, error: 'authentication failed: invalid header' }
        }
        return { valid: true }
      }

      case 'basic': {
        const authHeader = request.headers.get('authorization')
        if (!authHeader?.startsWith('Basic ')) {
          return { valid: false, error: 'authentication failed: missing basic auth' }
        }
        const encoded = authHeader.slice(6)
        const decoded = atob(encoded)
        const [username, password] = decoded.split(':')
        if (username !== auth.username || password !== auth.password) {
          return { valid: false, error: 'authentication failed: invalid credentials' }
        }
        return { valid: true }
      }

      case 'hmac': {
        // HMAC validation would require computing the signature
        // For now, just check the header exists
        const signatureHeader = request.headers.get(auth.header!)
        if (!signatureHeader) {
          return { valid: false, error: 'authentication failed: missing signature' }
        }
        // TODO: Implement actual HMAC verification
        return { valid: true }
      }

      default:
        return { valid: true }
    }
  }
}

// ============================================================================
// CRON TRIGGER
// ============================================================================

export interface CronTriggerConfig extends TriggerConfig {
  expression: string
  timezone?: string
}

interface CronField {
  values: Set<number>
  step: number
  range: [number, number]
}

export class CronTrigger extends BaseTrigger<CronTriggerConfig> {
  readonly expression: string
  readonly timezone: string
  private running = false
  private timerId: ReturnType<typeof setTimeout> | null = null
  private parsedFields: CronField[] | null = null

  constructor(config: CronTriggerConfig) {
    super(config)
    this.expression = config.expression
    this.timezone = config.timezone ?? 'UTC'
    this.parsedFields = this.parseCronExpression(config.expression)
  }

  isValid(): boolean {
    return this.parsedFields !== null
  }

  isRunning(): boolean {
    return this.running
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.scheduleNext()
  }

  stop(): void {
    this.running = false
    if (this.timerId) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
  }

  getNextExecution(from: Date = new Date()): Date {
    if (!this.parsedFields) {
      throw new Error('Invalid cron expression')
    }

    const next = new Date(from)
    next.setSeconds(0)
    next.setMilliseconds(0)

    // Simple implementation: find next matching minute
    const [minute, hour, dayOfMonth, month, dayOfWeek] = this.parsedFields

    // Advance to next minute
    next.setMinutes(next.getMinutes() + 1)

    // Find matching time (limited iterations to prevent infinite loop)
    for (let i = 0; i < 527040; i++) {
      // ~1 year of minutes
      if (this.matches(next)) {
        return next
      }
      next.setMinutes(next.getMinutes() + 1)
    }

    return next
  }

  private matches(date: Date): boolean {
    if (!this.parsedFields) return false

    const [minute, hour, dayOfMonth, month, dayOfWeek] = this.parsedFields

    const m = date.getMinutes()
    const h = date.getHours()
    const dom = date.getDate()
    const mon = date.getMonth() + 1
    const dow = date.getDay()

    return (
      minute.values.has(m) &&
      hour.values.has(h) &&
      dayOfMonth.values.has(dom) &&
      month.values.has(mon) &&
      dayOfWeek.values.has(dow)
    )
  }

  private scheduleNext(): void {
    if (!this.running) return

    const now = new Date()
    const next = this.getNextExecution(now)
    const delay = next.getTime() - now.getTime()

    this.timerId = setTimeout(() => {
      if (!this.running) return

      const event: TriggerEvent = {
        id: this.generateEventId(),
        source: 'cron',
        data: {},
        timestamp: Date.now(),
        metadata: {
          expression: this.expression,
          scheduledTime: next.toISOString(),
          timezone: this.timezone,
        },
      }
      this.emit(event)

      this.scheduleNext()
    }, Math.max(0, delay))
  }

  private parseCronExpression(expression: string): CronField[] | null {
    const parts = expression.trim().split(/\s+/)
    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`)
    }

    try {
      return [
        this.parseField(parts[0], 0, 59), // minute
        this.parseField(parts[1], 0, 23), // hour
        this.parseField(parts[2], 1, 31), // day of month
        this.parseField(parts[3], 1, 12), // month
        this.parseField(parts[4], 0, 6), // day of week
      ]
    } catch (error) {
      throw new Error(`Invalid cron expression: ${error}`)
    }
  }

  private parseField(field: string, min: number, max: number): CronField {
    const values = new Set<number>()

    // Handle day of week names
    const dayNames: Record<string, number> = {
      SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
    }
    for (const [name, value] of Object.entries(dayNames)) {
      field = field.replace(new RegExp(name, 'gi'), String(value))
    }

    // Handle month names
    const monthNames: Record<string, number> = {
      JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
      JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
    }
    for (const [name, value] of Object.entries(monthNames)) {
      field = field.replace(new RegExp(name, 'gi'), String(value))
    }

    const parts = field.split(',')

    for (const part of parts) {
      if (part === '*') {
        for (let i = min; i <= max; i++) values.add(i)
      } else if (part.includes('/')) {
        const [range, stepStr] = part.split('/')
        const step = parseInt(stepStr, 10)
        let start = min
        let end = max

        if (range !== '*') {
          if (range.includes('-')) {
            const [s, e] = range.split('-').map((n) => parseInt(n, 10))
            start = s
            end = e
          } else {
            start = parseInt(range, 10)
          }
        }

        for (let i = start; i <= end; i += step) {
          values.add(i)
        }
      } else if (part.includes('-')) {
        const [start, end] = part.split('-').map((n) => parseInt(n, 10))
        for (let i = start; i <= end; i++) {
          values.add(i)
        }
      } else {
        values.add(parseInt(part, 10))
      }
    }

    return { values, step: 1, range: [min, max] }
  }
}

// ============================================================================
// POLLING TRIGGER
// ============================================================================

export interface BackoffConfig {
  type: 'exponential' | 'linear' | 'constant'
  initialDelay: string
  maxDelay: string
  factor?: number
}

export interface StateStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
}

export interface PollResult {
  data: unknown[]
  watermark?: string
}

export interface PollingTriggerConfig extends TriggerConfig {
  interval: string
  pollFunction: (watermark?: string) => Promise<PollResult>
  deduplicationKey?: (item: unknown) => string
  stateStorage?: StateStorage
  watermarkMode?: boolean
  backoff?: BackoffConfig
}

export class PollingTrigger extends BaseTrigger<PollingTriggerConfig> {
  readonly interval: string
  private running = false
  private timerId: ReturnType<typeof setTimeout> | null = null
  private seenKeys = new Set<string>()
  private currentWatermark?: string
  private consecutiveErrors = 0

  constructor(config: PollingTriggerConfig) {
    super(config)
    this.interval = config.interval
  }

  getIntervalMs(): number {
    return this.parseDuration(this.interval)
  }

  isRunning(): boolean {
    return this.running
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.loadState().then(() => this.poll())
  }

  stop(): void {
    this.running = false
    if (this.timerId) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
  }

  private async loadState(): Promise<void> {
    if (!this.config.stateStorage) return

    try {
      const state = (await this.config.stateStorage.get(`polling:${this.id}`)) as {
        seenKeys?: string[]
        watermark?: string
      } | null

      if (state) {
        if (state.seenKeys) {
          this.seenKeys = new Set(state.seenKeys)
        }
        if (state.watermark) {
          this.currentWatermark = state.watermark
        }
      }
    } catch {
      // Ignore state loading errors
    }
  }

  private async saveState(): Promise<void> {
    if (!this.config.stateStorage) return

    try {
      await this.config.stateStorage.set(`polling:${this.id}`, {
        seenKeys: Array.from(this.seenKeys),
        watermark: this.currentWatermark,
      })
    } catch {
      // Ignore state saving errors
    }
  }

  private async poll(): Promise<void> {
    if (!this.running) return

    try {
      const result = await this.config.pollFunction(
        this.config.watermarkMode ? this.currentWatermark : undefined
      )

      // Reset consecutive errors on success
      this.consecutiveErrors = 0

      // Deduplicate items
      let newItems = result.data
      if (this.config.deduplicationKey) {
        newItems = result.data.filter((item) => {
          const key = this.config.deduplicationKey!(item)
          if (this.seenKeys.has(key)) {
            return false
          }
          this.seenKeys.add(key)
          return true
        })
      }

      // Update watermark
      if (result.watermark) {
        this.currentWatermark = result.watermark
      }

      // Save state
      await this.saveState()

      // Emit event if there are new items
      if (newItems.length > 0) {
        const event: TriggerEvent = {
          id: this.generateEventId(),
          source: 'polling',
          data: newItems,
          timestamp: Date.now(),
          metadata: {
            itemCount: newItems.length,
            watermark: this.currentWatermark,
          },
        }
        this.emit(event)
      }

      // Schedule next poll
      this.scheduleNext(this.getIntervalMs())
    } catch (error) {
      this.consecutiveErrors++
      this.emitError(error instanceof Error ? error : new Error(String(error)))

      // Calculate backoff delay
      const delay = this.calculateBackoff()
      this.scheduleNext(delay)
    }
  }

  private scheduleNext(delay: number): void {
    if (!this.running) return

    this.timerId = setTimeout(() => {
      this.poll()
    }, delay)
  }

  private calculateBackoff(): number {
    const backoff = this.config.backoff
    if (!backoff) {
      return this.getIntervalMs()
    }

    const initialDelay = this.parseDuration(backoff.initialDelay)
    const maxDelay = this.parseDuration(backoff.maxDelay)
    const factor = backoff.factor ?? 2

    let delay: number

    switch (backoff.type) {
      case 'exponential':
        delay = initialDelay * Math.pow(factor, this.consecutiveErrors - 1)
        break
      case 'linear':
        delay = initialDelay * this.consecutiveErrors
        break
      case 'constant':
      default:
        delay = initialDelay
    }

    return Math.min(delay, maxDelay)
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
    if (!match) {
      throw new Error(`Invalid duration format: ${duration}`)
    }

    const value = parseInt(match[1], 10)
    const unit = match[2]

    switch (unit) {
      case 'ms':
        return value
      case 's':
        return value * 1000
      case 'm':
        return value * 60 * 1000
      case 'h':
        return value * 60 * 60 * 1000
      case 'd':
        return value * 24 * 60 * 60 * 1000
      default:
        return value
    }
  }
}
