/**
 * Unified Human Escalation Abstraction
 *
 * This module unifies the template literal syntax (`ceo\`approve this\``) with
 * the DO-backed request handling (`Human.submitBlockingRequest`). It provides
 * a single interface that both patterns use, enabling:
 *
 * - Template literals to optionally use a local DO instance directly
 * - DO-backed requests to use the same result types
 * - Consistent SLA, escalation, and channel handling across both patterns
 * - Backward compatibility with existing code
 *
 * Architecture:
 * - HumanEscalationProvider: Interface for submitting/polling requests
 * - HttpEscalationProvider: HTTP-based provider (default for template literals)
 * - DOEscalationProvider: Direct DO access provider (when running inside a DO)
 * - createEscalationRequest: Factory for creating unified requests
 *
 * @module lib/humans/escalation
 */

import {
  type ApprovalResult,
  type PendingApprovalRecord,
  HumanTimeoutError,
  parseDuration,
} from './templates'

// ============================================================================
// Types
// ============================================================================

/**
 * Unified request configuration for human escalation
 */
export interface EscalationRequest {
  /** Unique request ID */
  requestId: string
  /** Role to escalate to (e.g., 'ceo', 'legal') */
  role: string
  /** Message/prompt for the human */
  message: string
  /** SLA timeout in milliseconds */
  sla?: number
  /** Notification channel (e.g., 'slack', 'email') */
  channel?: string
  /** Request type */
  type: 'approval' | 'question' | 'review'
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Request status from the provider
 */
export interface EscalationStatus {
  /** Current status */
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  /** Result if resolved */
  result?: ApprovalResult
  /** When the request was created */
  createdAt: string
  /** When the request expires */
  expiresAt?: string
}

/**
 * Provider for human escalation requests
 *
 * Abstracts the underlying mechanism (HTTP API vs direct DO access)
 */
export interface HumanEscalationProvider {
  /**
   * Submit a new escalation request
   */
  submit(request: EscalationRequest): Promise<EscalationStatus>

  /**
   * Get the current status of a request
   */
  getStatus(requestId: string): Promise<EscalationStatus | null>

  /**
   * Wait for a response with polling (blocking)
   */
  waitForResponse(
    requestId: string,
    options: {
      timeout: number
      pollInterval?: number
    }
  ): Promise<ApprovalResult>

  /**
   * Cancel a pending request
   */
  cancel(requestId: string): Promise<boolean>
}

/**
 * Configuration for HTTP-based escalation provider
 */
export interface HttpEscalationProviderConfig {
  /** Base URL for the Human DO API */
  baseUrl: string
  /** Fetch implementation (for testing) */
  fetch?: typeof globalThis.fetch
  /** Default poll interval in milliseconds */
  defaultPollInterval?: number
}

/**
 * Human DO stub interface for direct DO access
 */
export interface HumanDOStub {
  submitBlockingRequest(params: {
    requestId: string
    role: string
    message: string
    sla?: number
    channel?: string
    type?: 'approval' | 'question' | 'review'
  }): Promise<PendingApprovalRecord>

  getBlockingRequest(requestId: string): Promise<PendingApprovalRecord | null>

  respondToBlockingRequest(params: {
    requestId: string
    approved: boolean
    approver?: string
    reason?: string
  }): Promise<PendingApprovalRecord>

  cancelBlockingRequest(requestId: string): Promise<boolean>
}

/**
 * Configuration for DO-based escalation provider
 */
export interface DOEscalationProviderConfig {
  /** Human DO stub for direct access */
  humanDO: HumanDOStub
  /** Role name for this DO */
  role: string
}

// ============================================================================
// HTTP Escalation Provider
// ============================================================================

/**
 * HTTP-based provider that communicates with Human DO via REST API
 *
 * This is the default provider used by template literals when running
 * outside a Durable Object context.
 */
export class HttpEscalationProvider implements HumanEscalationProvider {
  private baseUrl: string
  private fetch: typeof globalThis.fetch
  private defaultPollInterval: number

  constructor(config: HttpEscalationProviderConfig) {
    this.baseUrl = config.baseUrl
    this.fetch = config.fetch || globalThis.fetch
    this.defaultPollInterval = config.defaultPollInterval || 1000
  }

  async submit(request: EscalationRequest): Promise<EscalationStatus> {
    const response = await this.fetch(`${this.baseUrl}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: request.requestId,
        role: request.role,
        message: request.message,
        sla: request.sla,
        channel: request.channel,
        type: request.type,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to submit escalation request: ${response.statusText}`)
    }

    const record = (await response.json()) as PendingApprovalRecord
    return this.recordToStatus(record)
  }

  async getStatus(requestId: string): Promise<EscalationStatus | null> {
    const response = await this.fetch(`${this.baseUrl}/request/${requestId}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error(`Failed to get request status: ${response.statusText}`)
    }

    const record = (await response.json()) as PendingApprovalRecord
    return this.recordToStatus(record)
  }

  async waitForResponse(
    requestId: string,
    options: { timeout: number; pollInterval?: number }
  ): Promise<ApprovalResult> {
    const timeout = options.timeout
    const pollInterval = options.pollInterval || this.defaultPollInterval
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const status = await this.getStatus(requestId)

      if (!status) {
        throw new Error(`Request not found: ${requestId}`)
      }

      if (status.status === 'approved' || status.status === 'rejected') {
        return {
          approved: status.status === 'approved',
          approver: status.result?.approver,
          reason: status.result?.reason,
          respondedAt: status.result?.respondedAt,
          requestId,
        }
      }

      if (status.status === 'expired') {
        throw new HumanTimeoutError(timeout, requestId)
      }

      await this.sleep(pollInterval)
    }

    throw new HumanTimeoutError(timeout, requestId)
  }

  async cancel(requestId: string): Promise<boolean> {
    const response = await this.fetch(`${this.baseUrl}/request/${requestId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      return false
    }

    const result = (await response.json()) as { cancelled: boolean }
    return result.cancelled
  }

  private recordToStatus(record: PendingApprovalRecord): EscalationStatus {
    return {
      status: record.status,
      result: record.result
        ? {
            approved: record.result.approved ?? record.status === 'approved',
            approver: record.result.approver,
            reason: record.result.reason,
            respondedAt: record.result.respondedAt
              ? new Date(record.result.respondedAt as unknown as string)
              : undefined,
            requestId: record.requestId,
          }
        : undefined,
      createdAt: record.createdAt,
      expiresAt: record.sla
        ? new Date(new Date(record.createdAt).getTime() + record.sla).toISOString()
        : undefined,
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// DO Escalation Provider
// ============================================================================

/**
 * Direct DO access provider for running inside a Durable Object context
 *
 * When running inside a DO (or with direct access to a DO stub), this provider
 * bypasses HTTP and communicates directly with the Human DO methods.
 */
export class DOEscalationProvider implements HumanEscalationProvider {
  private humanDO: HumanDOStub
  private role: string

  constructor(config: DOEscalationProviderConfig) {
    this.humanDO = config.humanDO
    this.role = config.role
  }

  async submit(request: EscalationRequest): Promise<EscalationStatus> {
    const record = await this.humanDO.submitBlockingRequest({
      requestId: request.requestId,
      role: request.role || this.role,
      message: request.message,
      sla: request.sla,
      channel: request.channel,
      type: request.type,
    })

    return this.recordToStatus(record)
  }

  async getStatus(requestId: string): Promise<EscalationStatus | null> {
    const record = await this.humanDO.getBlockingRequest(requestId)
    if (!record) {
      return null
    }
    return this.recordToStatus(record)
  }

  async waitForResponse(
    requestId: string,
    options: { timeout: number; pollInterval?: number }
  ): Promise<ApprovalResult> {
    const timeout = options.timeout
    const pollInterval = options.pollInterval || 1000
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const record = await this.humanDO.getBlockingRequest(requestId)

      if (!record) {
        throw new Error(`Request not found: ${requestId}`)
      }

      if (record.status === 'approved' || record.status === 'rejected') {
        return {
          approved: record.status === 'approved',
          approver: record.result?.approver,
          reason: record.result?.reason,
          respondedAt: record.result?.respondedAt
            ? new Date(record.result.respondedAt as unknown as string)
            : undefined,
          requestId,
        }
      }

      if (record.status === 'expired') {
        throw new HumanTimeoutError(timeout, requestId)
      }

      await this.sleep(pollInterval)
    }

    throw new HumanTimeoutError(timeout, requestId)
  }

  async cancel(requestId: string): Promise<boolean> {
    return this.humanDO.cancelBlockingRequest(requestId)
  }

  private recordToStatus(record: PendingApprovalRecord): EscalationStatus {
    return {
      status: record.status,
      result: record.result
        ? {
            approved: record.result.approved ?? record.status === 'approved',
            approver: record.result.approver,
            reason: record.result.reason,
            respondedAt: record.result.respondedAt
              ? new Date(record.result.respondedAt as unknown as string)
              : undefined,
            requestId: record.requestId,
          }
        : undefined,
      createdAt: record.createdAt,
      expiresAt: record.sla
        ? new Date(new Date(record.createdAt).getTime() + record.sla).toISOString()
        : undefined,
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * Global provider registry
 *
 * Allows configuring a default provider and role-specific overrides.
 * Template literals use this to resolve the appropriate provider.
 */
class EscalationProviderRegistry {
  private defaultProvider: HumanEscalationProvider | null = null
  private roleProviders: Map<string, HumanEscalationProvider> = new Map()

  /**
   * Set the default escalation provider
   */
  setDefault(provider: HumanEscalationProvider): void {
    this.defaultProvider = provider
  }

  /**
   * Set a provider for a specific role
   */
  setForRole(role: string, provider: HumanEscalationProvider): void {
    this.roleProviders.set(role, provider)
  }

  /**
   * Get the provider for a role (or default)
   */
  get(role: string): HumanEscalationProvider {
    // Check role-specific provider first
    const roleProvider = this.roleProviders.get(role)
    if (roleProvider) {
      return roleProvider
    }

    // Fall back to default
    if (this.defaultProvider) {
      return this.defaultProvider
    }

    // Create a default HTTP provider if none configured
    return new HttpEscalationProvider({
      baseUrl: `https://${role}.humans.do`,
    })
  }

  /**
   * Clear all registered providers
   */
  clear(): void {
    this.defaultProvider = null
    this.roleProviders.clear()
  }
}

// Global registry instance
const providerRegistry = new EscalationProviderRegistry()

// ============================================================================
// Configuration Functions
// ============================================================================

/**
 * Configure the default escalation provider
 *
 * @example HTTP provider (default for external clients)
 * ```typescript
 * configureEscalationProvider(
 *   new HttpEscalationProvider({
 *     baseUrl: 'https://api.dotdo.dev/human',
 *   })
 * )
 * ```
 *
 * @example DO provider (for code running inside a DO)
 * ```typescript
 * configureEscalationProvider(
 *   new DOEscalationProvider({
 *     humanDO: this.env.HUMAN.get(this.env.HUMAN.idFromName('ceo')),
 *     role: 'ceo',
 *   })
 * )
 * ```
 */
export function configureEscalationProvider(provider: HumanEscalationProvider): void {
  providerRegistry.setDefault(provider)
}

/**
 * Configure a provider for a specific role
 *
 * @example
 * ```typescript
 * configureRoleProvider('ceo', new DOEscalationProvider({
 *   humanDO: env.CEO_HUMAN,
 *   role: 'ceo',
 * }))
 * ```
 */
export function configureRoleProvider(role: string, provider: HumanEscalationProvider): void {
  providerRegistry.setForRole(role, provider)
}

/**
 * Get the configured provider for a role
 */
export function getEscalationProvider(role: string): HumanEscalationProvider {
  return providerRegistry.get(role)
}

/**
 * Clear all provider configuration (useful for testing)
 */
export function clearProviderConfig(): void {
  providerRegistry.clear()
}

// ============================================================================
// Unified Request Creation
// ============================================================================

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `esc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Create a unified escalation request
 *
 * This is the low-level factory used by both template literals and
 * direct DO access. It returns an awaitable object that resolves
 * when the human responds.
 *
 * @example Direct usage
 * ```typescript
 * const result = await createEscalationRequest({
 *   role: 'ceo',
 *   message: 'Approve the partnership deal',
 *   sla: 14400000, // 4 hours
 *   channel: 'slack',
 * })
 *
 * if (result.approved) {
 *   console.log(`Approved by ${result.approver}`)
 * }
 * ```
 */
export function createEscalationRequest(options: {
  role: string
  message: string
  sla?: number | string
  channel?: string
  type?: 'approval' | 'question' | 'review'
  requestId?: string
  provider?: HumanEscalationProvider
}): EscalationRequestHandle {
  const requestId = options.requestId || generateRequestId()
  const sla = typeof options.sla === 'string' ? parseDuration(options.sla) : options.sla
  const provider = options.provider || getEscalationProvider(options.role)

  return new EscalationRequestHandle({
    requestId,
    role: options.role,
    message: options.message,
    sla,
    channel: options.channel,
    type: options.type || 'approval',
    provider,
  })
}

// ============================================================================
// Escalation Request Handle
// ============================================================================

/**
 * Handle to a pending escalation request
 *
 * Implements PromiseLike so it can be awaited. Provides chaining methods
 * for configuration (timeout, via) and access to request properties.
 *
 * This class unifies the behavior of HumanRequest (from templates.ts)
 * with the DO-backed request handling.
 */
export class EscalationRequestHandle implements PromiseLike<ApprovalResult> {
  private _requestId: string
  private _role: string
  private _message: string
  private _sla?: number
  private _channel?: string
  private _type: 'approval' | 'question' | 'review'
  private _provider: HumanEscalationProvider
  private _promise: Promise<ApprovalResult>

  constructor(config: {
    requestId: string
    role: string
    message: string
    sla?: number
    channel?: string
    type: 'approval' | 'question' | 'review'
    provider: HumanEscalationProvider
  }) {
    this._requestId = config.requestId
    this._role = config.role
    this._message = config.message
    this._sla = config.sla
    this._channel = config.channel
    this._type = config.type
    this._provider = config.provider

    // Create the underlying promise
    this._promise = this.executeRequest()
  }

  // Properties
  get requestId(): string {
    return this._requestId
  }

  get role(): string {
    return this._role
  }

  get message(): string {
    return this._message
  }

  get sla(): number | undefined {
    return this._sla
  }

  get channel(): string | undefined {
    return this._channel
  }

  get type(): 'approval' | 'question' | 'review' {
    return this._type
  }

  // PromiseLike implementation
  then<TResult1 = ApprovalResult, TResult2 = never>(
    onfulfilled?: ((value: ApprovalResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this._promise.then(onfulfilled, onrejected)
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ): Promise<ApprovalResult | TResult> {
    return this._promise.catch(onrejected)
  }

  finally(onfinally?: (() => void) | null): Promise<ApprovalResult> {
    return this._promise.finally(onfinally)
  }

  // Chaining methods
  /**
   * Set a timeout/SLA for the request
   * @returns A new handle with the SLA set
   */
  timeout(duration: string | number): EscalationRequestHandle {
    const slaMs = typeof duration === 'string' ? parseDuration(duration) : duration
    return new EscalationRequestHandle({
      requestId: generateRequestId(), // New request for new config
      role: this._role,
      message: this._message,
      sla: slaMs,
      channel: this._channel,
      type: this._type,
      provider: this._provider,
    })
  }

  /**
   * Set the communication channel
   * @returns A new handle with the channel set
   */
  via(channelName: string): EscalationRequestHandle {
    return new EscalationRequestHandle({
      requestId: generateRequestId(), // New request for new config
      role: this._role,
      message: this._message,
      sla: this._sla,
      channel: channelName,
      type: this._type,
      provider: this._provider,
    })
  }

  /**
   * Cancel the pending request
   */
  async cancel(): Promise<boolean> {
    return this._provider.cancel(this._requestId)
  }

  /**
   * Get the current status without waiting
   */
  async getStatus(): Promise<EscalationStatus | null> {
    return this._provider.getStatus(this._requestId)
  }

  // Private implementation
  private async executeRequest(): Promise<ApprovalResult> {
    // Submit the request
    await this._provider.submit({
      requestId: this._requestId,
      role: this._role,
      message: this._message,
      sla: this._sla,
      channel: this._channel,
      type: this._type,
    })

    // Wait for response with the configured timeout
    const timeout = this._sla || 5 * 60 * 1000 // Default 5 minutes
    return this._provider.waitForResponse(this._requestId, { timeout })
  }
}

// ============================================================================
// Exports
// ============================================================================

export default {
  HttpEscalationProvider,
  DOEscalationProvider,
  configureEscalationProvider,
  configureRoleProvider,
  getEscalationProvider,
  clearProviderConfig,
  createEscalationRequest,
  EscalationRequestHandle,
}
