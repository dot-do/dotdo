/**
 * Template Literal Syntax for Human Escalation
 *
 * Usage: ceo`approve the partnership deal`
 *
 * Creates a HumanRequest that can be awaited and chained with .timeout() and .via()
 *
 * @example
 * ```typescript
 * // Blocking approval - waits for human response
 * const { approved, reason } = await ceo`approve the partnership`
 *
 * // With SLA timeout
 * const result = await legal`review this contract`.timeout('4 hours')
 *
 * // With channel routing
 * const approval = await cfo`approve budget`.via('slack')
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Result returned when awaiting a HumanRequest
 */
export interface ApprovalResult {
  /** Whether the request was approved */
  approved: boolean
  /** ID of the person who responded */
  approver?: string
  /** Reason provided for the decision */
  reason?: string
  /** When the response was received */
  respondedAt?: Date
  /** The original request ID */
  requestId?: string
}

/**
 * Configuration for the Human DO client
 */
export interface HumanClientConfig {
  /** Base URL for the Human DO API */
  baseUrl?: string
  /** Default timeout in milliseconds */
  defaultTimeout?: number
  /** Fetch implementation (for testing) */
  fetch?: typeof globalThis.fetch
}

/**
 * Pending approval stored in Human DO
 */
export interface PendingApprovalRecord {
  requestId: string
  role: string
  message: string
  sla?: number
  channel?: string
  createdAt: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  result?: ApprovalResult
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Parse duration strings into milliseconds
 * @param duration - Duration string like "4 hours", "30 minutes", "1 day"
 * @returns Duration in milliseconds
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)\s*(second|minute|hour|day|week)s?$/i)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const value = parseInt(match[1]!, 10)
  const unit = match[2]!.toLowerCase()

  const multipliers: Record<string, number> = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  }

  return value * multipliers[unit]!
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `hr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// Global Configuration
// ============================================================================

let globalClient: HumanClient | null = null
let globalConfig: HumanClientConfig = {}

/**
 * Configure the global Human client
 * Call this at application startup to connect HumanRequest to your Human DO
 *
 * @example
 * ```typescript
 * configureHumanClient({
 *   baseUrl: 'https://api.dotdo.dev/human',
 *   defaultTimeout: 300000, // 5 minutes
 * })
 * ```
 */
export function configureHumanClient(config: HumanClientConfig): void {
  globalConfig = { ...globalConfig, ...config }
  globalClient = new HumanClient(globalConfig)
}

/**
 * Get the configured Human client
 * @internal
 */
export function getHumanClient(): HumanClient {
  if (!globalClient) {
    globalClient = new HumanClient(globalConfig)
  }
  return globalClient
}

// ============================================================================
// HumanClient - Communicates with Human DO
// ============================================================================

/**
 * Client for communicating with Human DO
 * Handles blocking approval requests via polling
 */
export class HumanClient {
  private baseUrl: string
  private defaultTimeout: number
  private fetch: typeof globalThis.fetch

  constructor(config: HumanClientConfig = {}) {
    this.baseUrl = config.baseUrl || 'https://human.do'
    this.defaultTimeout = config.defaultTimeout || 300000 // 5 minutes
    this.fetch = config.fetch || globalThis.fetch
  }

  /**
   * Submit a blocking approval request
   * Polls until response received or timeout
   */
  async requestApproval(params: {
    requestId: string
    role: string
    message: string
    sla?: number
    channel?: string
  }): Promise<ApprovalResult> {
    const timeout = params.sla || this.defaultTimeout
    const startTime = Date.now()
    const pollInterval = Math.min(1000, timeout / 10) // Poll every second or 10% of timeout

    // Submit the request
    const submitResponse = await this.fetch(`${this.baseUrl}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: params.requestId,
        role: params.role,
        message: params.message,
        sla: timeout,
        channel: params.channel,
        type: 'approval',
      }),
    })

    if (!submitResponse.ok) {
      throw new Error(`Failed to submit approval request: ${submitResponse.statusText}`)
    }

    // Poll for response
    while (Date.now() - startTime < timeout) {
      const statusResponse = await this.fetch(`${this.baseUrl}/request/${params.requestId}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      })

      if (statusResponse.ok) {
        const record = await statusResponse.json() as PendingApprovalRecord

        if (record.status === 'approved' || record.status === 'rejected') {
          return {
            approved: record.status === 'approved',
            approver: record.result?.approver,
            reason: record.result?.reason,
            respondedAt: record.result?.respondedAt ? new Date(record.result.respondedAt as unknown as string) : undefined,
            requestId: params.requestId,
          }
        }

        if (record.status === 'expired') {
          throw new HumanTimeoutError(timeout, params.requestId)
        }
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }

    // Timeout reached
    throw new HumanTimeoutError(timeout, params.requestId)
  }
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when human response times out
 */
export class HumanTimeoutError extends Error {
  public readonly timeout: number
  public readonly requestId: string

  constructor(timeout: number, requestId: string) {
    super(`Human approval timed out after ${timeout}ms (request: ${requestId})`)
    this.name = 'HumanTimeoutError'
    this.timeout = timeout
    this.requestId = requestId
  }
}

// ============================================================================
// HumanRequest Class
// ============================================================================

/**
 * HumanRequest represents a pending request for human input/approval
 *
 * Wraps a Promise<ApprovalResult> so it can be awaited. The promise
 * resolves when a human provides a response, or rejects on timeout.
 *
 * @example
 * ```typescript
 * // Basic usage - blocks until human responds
 * const { approved, reason } = await ceo`approve the partnership`
 *
 * // With SLA
 * const result = await legal`review contract`.timeout('4 hours')
 * if (!result.approved) {
 *   throw new Error(`Rejected: ${result.reason}`)
 * }
 *
 * // Check approval without blocking (for inspection)
 * const request = cfo`approve budget`
 * console.log(request.role)    // 'cfo'
 * console.log(request.message) // 'approve budget'
 * const result = await request // Actually waits for approval
 * ```
 */
export class HumanRequest implements PromiseLike<ApprovalResult> {
  private _role: string
  private _message: string
  private _sla?: number
  private _channel?: string
  private _requestId: string
  private _promise: Promise<ApprovalResult>

  constructor(
    role: string,
    message: string,
    options?: {
      sla?: number
      channel?: string
      requestId?: string
    }
  ) {
    this._role = role
    this._message = message
    this._sla = options?.sla
    this._channel = options?.channel
    this._requestId = options?.requestId || generateRequestId()

    // Create the underlying promise that performs the blocking call
    this._promise = new Promise<ApprovalResult>((resolve, reject) => {
      // Defer to allow the constructor to complete
      queueMicrotask(() => {
        const client = getHumanClient()
        client.requestApproval({
          requestId: this._requestId,
          role: this._role,
          message: this._message,
          sla: this._sla,
          channel: this._channel,
        }).then(resolve).catch(reject)
      })
    })
  }

  /**
   * The role being escalated to (e.g., "ceo", "legal")
   */
  get role(): string {
    return this._role
  }

  /**
   * The message/request being sent to the human
   */
  get message(): string {
    return this._message
  }

  /**
   * SLA timeout in milliseconds (if set)
   */
  get sla(): number | undefined {
    return this._sla
  }

  /**
   * Communication channel (if set)
   */
  get channel(): string | undefined {
    return this._channel
  }

  /**
   * Unique ID for this request
   */
  get requestId(): string {
    return this._requestId
  }

  /**
   * Implement PromiseLike for await support
   */
  then<TResult1 = ApprovalResult, TResult2 = never>(
    onfulfilled?: ((value: ApprovalResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this._promise.then(onfulfilled, onrejected)
  }

  /**
   * Support .catch() for error handling
   */
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ): Promise<ApprovalResult | TResult> {
    return this._promise.catch(onrejected)
  }

  /**
   * Support .finally() for cleanup
   */
  finally(onfinally?: (() => void) | null): Promise<ApprovalResult> {
    return this._promise.finally(onfinally)
  }

  /**
   * Set a timeout/SLA for the human request
   * @param duration - Duration string like "4 hours"
   * @returns A new HumanRequest with the SLA set
   */
  timeout(duration: string): HumanRequest {
    const slaMs = parseDuration(duration)
    return new HumanRequest(this._role, this._message, {
      sla: slaMs,
      channel: this._channel,
    })
  }

  /**
   * Set the communication channel for the request
   * @param channelName - Channel name like "slack", "email"
   * @returns A new HumanRequest with the channel set
   */
  via(channelName: string): HumanRequest {
    return new HumanRequest(this._role, this._message, {
      sla: this._sla,
      channel: channelName,
    })
  }
}

/**
 * Type for tagged template functions that create HumanRequest
 */
export type HumanTemplate = (strings: TemplateStringsArray, ...values: unknown[]) => HumanRequest

/**
 * Create a human template function for a specific role
 * @param role - The role name (e.g., "ceo", "senior-accountant")
 * @returns A tagged template function that creates HumanRequest instances
 */
export function createHumanTemplate(role: string): HumanTemplate {
  return (strings: TemplateStringsArray, ...values: unknown[]): HumanRequest => {
    // Interpolate the template string
    const message = strings.reduce((result, str, i) => {
      return result + str + (values[i] !== undefined ? String(values[i]) : '')
    }, '')

    return new HumanRequest(role, message)
  }
}

// Pre-built role templates
export const ceo = createHumanTemplate('ceo')
export const legal = createHumanTemplate('legal')
export const cfo = createHumanTemplate('cfo')
export const cto = createHumanTemplate('cto')
export const hr = createHumanTemplate('hr')
export const support = createHumanTemplate('support')
export const manager = createHumanTemplate('manager')
