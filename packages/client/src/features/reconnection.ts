/**
 * Reconnection feature for @dotdo/client
 *
 * Adds automatic reconnection with exponential backoff to a client.
 */

import type { ReconnectConfig, ConnectionState } from '../types'

export interface ReconnectionState {
  attempts: number
  timeoutId: ReturnType<typeof setTimeout> | null
  explicitlyDisconnected: boolean
}

export interface Reconnectable {
  /** Trigger a reconnection attempt */
  reconnect(): void
  /** Mark as explicitly disconnected */
  markDisconnected(): void
  /** Get current connection state */
  readonly connectionState: ConnectionState
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateBackoffDelay(
  attempts: number,
  config: ReconnectConfig
): number {
  const { baseDelay = 1000, maxDelay = 30000, jitter = 0.1 } = config

  // Exponential backoff: baseDelay * 2^attempts
  let delay = Math.min(baseDelay * Math.pow(2, attempts), maxDelay)

  // Add jitter
  const jitterAmount = delay * jitter * (Math.random() * 2 - 1)
  delay = Math.max(0, delay + jitterAmount)

  return delay
}

/**
 * Create a reconnection manager
 */
export function createReconnectionManager(
  config: ReconnectConfig = {},
  onReconnect: () => void
): {
  scheduleReconnect: () => void
  cancelReconnect: () => void
  resetAttempts: () => void
  markDisconnected: () => void
  readonly state: ReconnectionState
} {
  const state: ReconnectionState = {
    attempts: 0,
    timeoutId: null,
    explicitlyDisconnected: false,
  }

  function scheduleReconnect(): void {
    if (state.explicitlyDisconnected) return

    const delay = calculateBackoffDelay(state.attempts, config)
    state.attempts++

    state.timeoutId = setTimeout(() => {
      state.timeoutId = null
      onReconnect()
    }, delay)
  }

  function cancelReconnect(): void {
    if (state.timeoutId) {
      clearTimeout(state.timeoutId)
      state.timeoutId = null
    }
  }

  function resetAttempts(): void {
    state.attempts = 0
  }

  function markDisconnected(): void {
    state.explicitlyDisconnected = true
    cancelReconnect()
  }

  return {
    scheduleReconnect,
    cancelReconnect,
    resetAttempts,
    markDisconnected,
    get state() { return state },
  }
}
