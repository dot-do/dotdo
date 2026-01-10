/**
 * Base Channel Infrastructure
 *
 * Provides abstract base class and utilities for channel implementations.
 */

import type {
  ChannelType,
  NotificationPayload,
  NotificationResult,
  HumanResponse,
} from './types'

// ============================================================================
// ABSTRACT BASE CLASS
// ============================================================================

/**
 * Abstract base class for channel implementations
 *
 * Provides common functionality:
 * - Channel name and type identification
 * - Message ID generation
 * - Timeout utilities
 *
 * Note: Existing channels don't need to extend this class - it's provided
 * for future implementations and as a reference implementation.
 */
export abstract class BaseChannel<
  TConfig = unknown,
  TPayload extends NotificationPayload = NotificationPayload,
  TResult extends NotificationResult = NotificationResult
> {
  /** Channel display name */
  public readonly name: string

  /** Channel type identifier */
  public readonly type: ChannelType

  /** Channel configuration */
  protected config: TConfig

  constructor(config: TConfig, name: string, type: ChannelType) {
    this.config = config
    this.name = name
    this.type = type
  }

  /**
   * Send a notification through this channel
   */
  abstract send(payload: TPayload): Promise<TResult>

  /**
   * Generate a unique message ID
   */
  protected generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Wrap a promise with a timeout
   *
   * @param promise - The promise to wrap
   * @param timeoutMs - Timeout in milliseconds
   * @param errorMessage - Error message on timeout
   */
  protected withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage = 'Operation timed out'
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
      ),
    ])
  }
}

/**
 * Abstract base class for channels that support interactive responses
 */
export abstract class InteractiveBaseChannel<
  TConfig = unknown,
  TPayload extends NotificationPayload = NotificationPayload,
  TResult extends NotificationResult = NotificationResult,
  TResponse = HumanResponse
> extends BaseChannel<TConfig, TPayload, TResult> {
  /**
   * Wait for a human response with timeout
   */
  abstract waitForResponse(params: { timeout: number }): Promise<TResponse>
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a unique message ID
 * Standalone function for channels that don't extend BaseChannel
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Wrap a promise with a timeout
 * Standalone function for channels that don't extend BaseChannel
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Error message on timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ])
}

/**
 * Parse action ID format used by Slack/Discord: "action_requestId"
 *
 * @param actionId - The action ID string (e.g., "approve_req-123")
 * @returns Parsed action and requestId
 */
export function parseActionId(actionId: string): { action: string; requestId?: string } {
  const underscoreIndex = actionId.indexOf('_')
  if (underscoreIndex > -1) {
    return {
      action: actionId.substring(0, underscoreIndex),
      requestId: actionId.substring(underscoreIndex + 1),
    }
  }
  return { action: actionId }
}

/**
 * Build action ID from action and requestId
 *
 * @param action - The action name
 * @param requestId - The request ID
 */
export function buildActionId(action: string, requestId: string): string {
  return `${action}_${requestId}`
}
