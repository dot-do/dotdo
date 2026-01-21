/**
 * WebSocket Reconnection Protocol for Hibernation
 *
 * Implements a robust reconnection protocol for WebSocket connections
 * that survive Durable Object hibernation. This module provides:
 *
 * 1. **Session State Tracking**: Maintains session state across hibernation
 * 2. **Reconnection Handshake**: Protocol for resuming sessions after disconnect
 * 3. **Event Replay**: Replays missed events since last known sequence
 * 4. **Backoff Strategy**: Exponential backoff configuration for client retries
 *
 * ## Protocol Overview
 *
 * The reconnection protocol works as follows:
 *
 * 1. On initial connect, server sends `session.init` with sessionId and sequence
 * 2. Client stores sessionId and tracks lastSeq from received messages
 * 3. On disconnect, client attempts reconnect with `session.resume` message
 * 4. Server validates sessionId and replays events since lastSeq
 * 5. If session expired, server sends `session.expired` and starts fresh
 *
 * ## Message Types
 *
 * Server -> Client:
 * - `session.init`: Initial session establishment
 * - `session.resumed`: Session successfully resumed
 * - `session.expired`: Session expired, fresh session started
 * - `session.error`: Error during reconnection
 * - `event`: Regular event with sequence number
 *
 * Client -> Server:
 * - `session.resume`: Request to resume previous session
 *
 * @module @dotdo/do/websocket-reconnection
 * @see https://developers.cloudflare.com/durable-objects/api/websockets/
 */

import { createScopedLogger, LogLevel } from '@dotdo/utils'

const logger = createScopedLogger({ level: LogLevel.INFO, prefix: '[WebSocket-Reconnection]' })

// ============================================================================
// Protocol Constants
// ============================================================================

/**
 * Protocol version for compatibility checking.
 * Increment when making breaking changes to the protocol.
 */
export const RECONNECTION_PROTOCOL_VERSION = 1

/**
 * Default session timeout in milliseconds (30 minutes).
 * Sessions older than this cannot be resumed.
 */
export const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000

/**
 * Default maximum events to buffer for replay (1000 events).
 * Events beyond this limit are dropped from the replay buffer.
 */
export const DEFAULT_MAX_EVENT_BUFFER = 1000

/**
 * Default backoff configuration for client reconnection attempts.
 */
export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  multiplier: 2,
  jitter: 0.2,
  maxAttempts: 10,
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * Base message interface for all protocol messages
 */
export interface ProtocolMessage {
  type: string
  seq?: number
  timestamp?: number
}

/**
 * Session initialization message sent by server on connect
 */
export interface SessionInitMessage extends ProtocolMessage {
  type: 'session.init'
  sessionId: string
  protocolVersion: number
  seq: number
  timestamp: number
  serverTime: number
  heartbeatInterval: number
  sessionTimeout: number
}

/**
 * Session resume request sent by client
 */
export interface SessionResumeMessage extends ProtocolMessage {
  type: 'session.resume'
  sessionId: string
  lastSeq: number
  clientId?: string | undefined
}

/**
 * Session resumed confirmation sent by server
 */
export interface SessionResumedMessage extends ProtocolMessage {
  type: 'session.resumed'
  sessionId: string
  seq: number
  missedEventCount: number
  timestamp: number
}

/**
 * Session expired notification sent by server
 */
export interface SessionExpiredMessage extends ProtocolMessage {
  type: 'session.expired'
  newSessionId: string
  reason: 'timeout' | 'evicted' | 'not_found'
  seq: number
  timestamp: number
  protocolVersion: number
  heartbeatInterval: number
  sessionTimeout: number
}

/**
 * Session error notification sent by server
 */
export interface SessionErrorMessage extends ProtocolMessage {
  type: 'session.error'
  error: string
  code: SessionErrorCode
  timestamp: number
}

/**
 * Regular event message with sequence number
 */
export interface EventMessage extends ProtocolMessage {
  type: 'event'
  seq: number
  eventType: string
  payload: unknown
  timestamp: number
}

/**
 * Heartbeat ping message
 */
export interface HeartbeatPingMessage extends ProtocolMessage {
  type: 'heartbeat.ping'
  timestamp: number
}

/**
 * Heartbeat pong response
 */
export interface HeartbeatPongMessage extends ProtocolMessage {
  type: 'heartbeat.pong'
  timestamp: number
  serverTime: number
}

/**
 * Union of all protocol message types
 */
export type ReconnectionProtocolMessage =
  | SessionInitMessage
  | SessionResumeMessage
  | SessionResumedMessage
  | SessionExpiredMessage
  | SessionErrorMessage
  | EventMessage
  | HeartbeatPingMessage
  | HeartbeatPongMessage

// ============================================================================
// Error Codes
// ============================================================================

/**
 * Error codes for session-related errors
 */
export type SessionErrorCode =
  | 'INVALID_SESSION_ID'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'PROTOCOL_VERSION_MISMATCH'
  | 'INVALID_MESSAGE_FORMAT'
  | 'REPLAY_BUFFER_OVERFLOW'
  | 'INTERNAL_ERROR'

// ============================================================================
// Session State
// ============================================================================

/**
 * Buffered event for replay on reconnection
 */
export interface BufferedEvent {
  seq: number
  eventType: string
  payload: unknown
  timestamp: number
}

/**
 * Session state maintained by the server for each client
 */
export interface SessionState {
  /** Unique session identifier */
  sessionId: string

  /** Optional client identifier for tracking across sessions */
  clientId?: string | undefined

  /** When the session was created */
  createdAt: number

  /** When the session was last active */
  lastActivityAt: number

  /** Current sequence number for events */
  currentSeq: number

  /** Protocol version agreed on */
  protocolVersion: number

  /** Buffered events for replay on reconnection */
  eventBuffer: BufferedEvent[]

  /** Maximum events to buffer */
  maxEventBuffer: number

  /** Session timeout in milliseconds */
  sessionTimeout: number

  /** Custom metadata attached to the session */
  metadata?: Record<string, unknown> | undefined
}

/**
 * Configuration for the reconnection protocol
 */
export interface ReconnectionConfig {
  /** Maximum events to buffer for replay */
  maxEventBuffer?: number

  /** Session timeout in milliseconds */
  sessionTimeoutMs?: number

  /** Heartbeat interval in milliseconds */
  heartbeatIntervalMs?: number

  /** Storage key prefix for session data */
  storageKeyPrefix?: string
}

/**
 * Default reconnection configuration
 */
export const DEFAULT_RECONNECTION_CONFIG: Required<ReconnectionConfig> = {
  maxEventBuffer: DEFAULT_MAX_EVENT_BUFFER,
  sessionTimeoutMs: DEFAULT_SESSION_TIMEOUT_MS,
  heartbeatIntervalMs: 30000,
  storageKeyPrefix: '_ws_session_',
}

// ============================================================================
// Backoff Configuration
// ============================================================================

/**
 * Configuration for exponential backoff
 */
export interface BackoffConfig {
  /** Initial delay in milliseconds */
  initialDelayMs: number

  /** Maximum delay in milliseconds */
  maxDelayMs: number

  /** Multiplier for each retry */
  multiplier: number

  /** Jitter factor (0-1) to add randomness */
  jitter: number

  /** Maximum number of attempts before giving up */
  maxAttempts: number
}

/**
 * Calculate the next retry delay using exponential backoff
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param config - Backoff configuration
 * @returns Delay in milliseconds before next retry
 */
export function calculateBackoffDelay(
  attempt: number,
  config: BackoffConfig = DEFAULT_BACKOFF_CONFIG
): number {
  const { initialDelayMs, maxDelayMs, multiplier, jitter } = config

  // Calculate base delay with exponential growth
  const baseDelay = initialDelayMs * Math.pow(multiplier, attempt)

  // Cap at maximum delay
  const cappedDelay = Math.min(baseDelay, maxDelayMs)

  // Add jitter
  const jitterRange = cappedDelay * jitter
  const jitterOffset = (Math.random() - 0.5) * 2 * jitterRange

  return Math.max(0, Math.round(cappedDelay + jitterOffset))
}

/**
 * Check if another retry should be attempted
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param config - Backoff configuration
 * @returns True if another retry should be attempted
 */
export function shouldRetry(
  attempt: number,
  config: BackoffConfig = DEFAULT_BACKOFF_CONFIG
): boolean {
  return attempt < config.maxAttempts
}

// ============================================================================
// Session Manager
// ============================================================================

/**
 * Manages WebSocket sessions with reconnection support.
 *
 * This class handles:
 * - Session creation and validation
 * - Event buffering for replay
 * - Session expiration and cleanup
 * - Reconnection handshake processing
 *
 * @example
 * ```typescript
 * const manager = new SessionManager(ctx)
 *
 * // On new connection
 * const session = manager.createSession(ws)
 * ws.send(JSON.stringify(manager.createInitMessage(session)))
 *
 * // On reconnection request
 * const resumed = await manager.resumeSession(ws, resumeMessage)
 * if (resumed) {
 *   // Replay missed events
 *   for (const event of resumed.missedEvents) {
 *     ws.send(JSON.stringify(event))
 *   }
 * }
 * ```
 */
export class SessionManager {
  private ctx: DurableObjectState
  private config: Required<ReconnectionConfig>
  private sessions = new Map<string, SessionState>()
  private wsToSession = new Map<WebSocket, string>()

  constructor(
    ctx: DurableObjectState,
    config: Partial<ReconnectionConfig> = {}
  ) {
    this.ctx = ctx
    this.config = { ...DEFAULT_RECONNECTION_CONFIG, ...config }
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).slice(2, 10)
    return `sess_${timestamp}_${random}`
  }

  /**
   * Create a new session for a WebSocket connection
   *
   * @param ws - The WebSocket connection
   * @param clientId - Optional client identifier
   * @param metadata - Optional session metadata
   * @returns The created session state
   */
  createSession(
    ws: WebSocket,
    clientId?: string,
    metadata?: Record<string, unknown>
  ): SessionState {
    const now = Date.now()
    const sessionId = this.generateSessionId()

    const session: SessionState = {
      sessionId,
      clientId,
      createdAt: now,
      lastActivityAt: now,
      currentSeq: 0,
      protocolVersion: RECONNECTION_PROTOCOL_VERSION,
      eventBuffer: [],
      maxEventBuffer: this.config.maxEventBuffer,
      sessionTimeout: this.config.sessionTimeoutMs,
      metadata,
    }

    this.sessions.set(sessionId, session)
    this.wsToSession.set(ws, sessionId)

    // Persist session
    this.persistSession(session)

    logger.debug('Session created', { sessionId, clientId })

    return session
  }

  /**
   * Get the session for a WebSocket connection
   */
  getSession(ws: WebSocket): SessionState | undefined {
    const sessionId = this.wsToSession.get(ws)
    if (!sessionId) return undefined
    return this.sessions.get(sessionId)
  }

  /**
   * Get a session by its ID
   */
  getSessionById(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Update session activity timestamp
   */
  touchSession(ws: WebSocket): void {
    const session = this.getSession(ws)
    if (session) {
      session.lastActivityAt = Date.now()
    }
  }

  /**
   * Check if a session has expired
   */
  isSessionExpired(session: SessionState): boolean {
    const now = Date.now()
    return now - session.lastActivityAt > session.sessionTimeout
  }

  /**
   * Buffer an event for potential replay on reconnection
   *
   * @param session - The session to buffer the event for
   * @param eventType - The type of event
   * @param payload - The event payload
   * @returns The sequence number assigned to the event
   */
  bufferEvent(
    session: SessionState,
    eventType: string,
    payload: unknown
  ): number {
    session.currentSeq++
    const seq = session.currentSeq

    const bufferedEvent: BufferedEvent = {
      seq,
      eventType,
      payload,
      timestamp: Date.now(),
    }

    session.eventBuffer.push(bufferedEvent)

    // Trim buffer if it exceeds max size
    while (session.eventBuffer.length > session.maxEventBuffer) {
      session.eventBuffer.shift()
    }

    session.lastActivityAt = Date.now()

    return seq
  }

  /**
   * Get events since a given sequence number for replay
   *
   * @param session - The session to get events from
   * @param lastSeq - The last sequence number the client has
   * @returns Array of events to replay, or null if seq is too old
   */
  getEventsSince(
    session: SessionState,
    lastSeq: number
  ): BufferedEvent[] | null {
    // Check if lastSeq is within our buffer range
    if (session.eventBuffer.length === 0) {
      return []
    }

    const oldestSeq = session.eventBuffer[0]?.seq ?? 0

    // If lastSeq is older than our buffer, we can't replay
    if (lastSeq < oldestSeq - 1) {
      return null
    }

    // Return all events after lastSeq
    return session.eventBuffer.filter(e => e.seq > lastSeq)
  }

  /**
   * Create a session.init message for a new connection
   */
  createInitMessage(session: SessionState): SessionInitMessage {
    return {
      type: 'session.init',
      sessionId: session.sessionId,
      protocolVersion: RECONNECTION_PROTOCOL_VERSION,
      seq: session.currentSeq,
      timestamp: Date.now(),
      serverTime: Date.now(),
      heartbeatInterval: this.config.heartbeatIntervalMs,
      sessionTimeout: session.sessionTimeout,
    }
  }

  /**
   * Create a session.resumed message
   */
  createResumedMessage(
    session: SessionState,
    missedEventCount: number
  ): SessionResumedMessage {
    return {
      type: 'session.resumed',
      sessionId: session.sessionId,
      seq: session.currentSeq,
      missedEventCount,
      timestamp: Date.now(),
    }
  }

  /**
   * Create a session.expired message with new session info
   */
  createExpiredMessage(
    newSession: SessionState,
    reason: 'timeout' | 'evicted' | 'not_found'
  ): SessionExpiredMessage {
    return {
      type: 'session.expired',
      newSessionId: newSession.sessionId,
      reason,
      seq: newSession.currentSeq,
      timestamp: Date.now(),
      protocolVersion: RECONNECTION_PROTOCOL_VERSION,
      heartbeatInterval: this.config.heartbeatIntervalMs,
      sessionTimeout: newSession.sessionTimeout,
    }
  }

  /**
   * Create a session.error message
   */
  createErrorMessage(
    error: string,
    code: SessionErrorCode
  ): SessionErrorMessage {
    return {
      type: 'session.error',
      error,
      code,
      timestamp: Date.now(),
    }
  }

  /**
   * Create an event message with sequence number
   */
  createEventMessage(
    session: SessionState,
    eventType: string,
    payload: unknown
  ): EventMessage {
    const seq = this.bufferEvent(session, eventType, payload)

    return {
      type: 'event',
      seq,
      eventType,
      payload,
      timestamp: Date.now(),
    }
  }

  /**
   * Attempt to resume a session from a resume request
   *
   * @param ws - The new WebSocket connection
   * @param resumeMessage - The session.resume message from client
   * @returns Resume result with session and missed events, or error
   */
  async resumeSession(
    ws: WebSocket,
    resumeMessage: SessionResumeMessage
  ): Promise<{
    success: true
    session: SessionState
    missedEvents: BufferedEvent[]
  } | {
    success: false
    error: SessionErrorCode
    newSession: SessionState
    reason: 'timeout' | 'evicted' | 'not_found'
  }> {
    const { sessionId, lastSeq, clientId } = resumeMessage

    // Try to find existing session
    let session = this.sessions.get(sessionId)

    // If not in memory, try to restore from storage
    if (!session) {
      session = await this.restoreSession(sessionId)
    }

    // Session not found
    if (!session) {
      const newSession = this.createSession(ws, clientId)
      return {
        success: false,
        error: 'SESSION_NOT_FOUND',
        newSession,
        reason: 'not_found',
      }
    }

    // Session expired
    if (this.isSessionExpired(session)) {
      // Clean up old session
      await this.deleteSession(sessionId)

      const newSession = this.createSession(ws, clientId, session.metadata)
      return {
        success: false,
        error: 'SESSION_EXPIRED',
        newSession,
        reason: 'timeout',
      }
    }

    // Try to get missed events
    const missedEvents = this.getEventsSince(session, lastSeq)

    // Event buffer overflow - too many events missed
    if (missedEvents === null) {
      // Clean up old session
      await this.deleteSession(sessionId)

      const newSession = this.createSession(ws, clientId, session.metadata)
      return {
        success: false,
        error: 'REPLAY_BUFFER_OVERFLOW',
        newSession,
        reason: 'evicted',
      }
    }

    // Successfully resuming session
    session.lastActivityAt = Date.now()
    this.wsToSession.set(ws, sessionId)

    logger.debug('Session resumed', {
      sessionId,
      missedEventCount: missedEvents.length,
    })

    return {
      success: true,
      session,
      missedEvents,
    }
  }

  /**
   * Handle WebSocket disconnect - preserve session for potential reconnection
   */
  handleDisconnect(ws: WebSocket): void {
    const sessionId = this.wsToSession.get(ws)
    if (sessionId) {
      this.wsToSession.delete(ws)
      // Session is kept in memory for potential reconnection
      // It will be cleaned up when it expires

      const session = this.sessions.get(sessionId)
      if (session) {
        this.persistSession(session)
      }
    }
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    let cleaned = 0
    const now = Date.now()

    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivityAt > session.sessionTimeout) {
        await this.deleteSession(sessionId)
        cleaned++
      }
    }

    return cleaned
  }

  /**
   * Persist session to storage
   */
  private async persistSession(session: SessionState): Promise<void> {
    const key = `${this.config.storageKeyPrefix}${session.sessionId}`
    try {
      await this.ctx.storage.put(key, {
        sessionId: session.sessionId,
        clientId: session.clientId,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        currentSeq: session.currentSeq,
        protocolVersion: session.protocolVersion,
        eventBuffer: session.eventBuffer,
        maxEventBuffer: session.maxEventBuffer,
        sessionTimeout: session.sessionTimeout,
        metadata: session.metadata,
      })
    } catch (error) {
      logger.error('Failed to persist session', {
        sessionId: session.sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Restore session from storage
   */
  private async restoreSession(sessionId: string): Promise<SessionState | undefined> {
    const key = `${this.config.storageKeyPrefix}${sessionId}`
    try {
      const data = await this.ctx.storage.get<SessionState>(key)
      if (data) {
        this.sessions.set(sessionId, data)
        return data
      }
    } catch (error) {
      logger.error('Failed to restore session', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return undefined
  }

  /**
   * Delete session from memory and storage
   */
  private async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId)
    const key = `${this.config.storageKeyPrefix}${sessionId}`
    try {
      await this.ctx.storage.delete(key)
    } catch (error) {
      logger.error('Failed to delete session', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Restore all sessions from hibernation.
   * Call this in blockConcurrencyWhile during DO wake.
   */
  async restoreFromHibernation(): Promise<void> {
    try {
      // Get all session keys from storage
      const prefix = this.config.storageKeyPrefix
      const stored = await this.ctx.storage.list({ prefix })

      for (const [key, value] of stored) {
        const session = value as SessionState
        if (session && session.sessionId) {
          this.sessions.set(session.sessionId, session)
        }
      }

      logger.debug('Restored sessions from hibernation', {
        count: this.sessions.size,
      })
    } catch (error) {
      logger.error('Failed to restore sessions from hibernation', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Get session statistics
   */
  getStats(): {
    activeSessions: number
    totalBufferedEvents: number
    oldestSessionAge: number
  } {
    let totalBufferedEvents = 0
    let oldestSessionAge = 0
    const now = Date.now()

    for (const session of this.sessions.values()) {
      totalBufferedEvents += session.eventBuffer.length
      const age = now - session.createdAt
      if (age > oldestSessionAge) {
        oldestSessionAge = age
      }
    }

    return {
      activeSessions: this.sessions.size,
      totalBufferedEvents,
      oldestSessionAge,
    }
  }
}

// ============================================================================
// Client Helpers
// ============================================================================

/**
 * Client-side reconnection state for implementing reconnection logic
 */
export interface ClientReconnectionState {
  /** Current session ID from server */
  sessionId: string | null

  /** Last received sequence number */
  lastSeq: number

  /** Protocol version agreed with server */
  protocolVersion: number

  /** Current reconnection attempt (0 = initial connection) */
  attempt: number

  /** Whether currently connected */
  isConnected: boolean

  /** Timestamp of last successful connection */
  lastConnectedAt: number | null

  /** Client identifier (optional, for session tracking) */
  clientId?: string | undefined
}

/**
 * Create initial client reconnection state
 */
export function createClientState(clientId?: string): ClientReconnectionState {
  return {
    sessionId: null,
    lastSeq: 0,
    protocolVersion: RECONNECTION_PROTOCOL_VERSION,
    attempt: 0,
    isConnected: false,
    lastConnectedAt: null,
    clientId,
  }
}

/**
 * Update client state from a session.init message
 */
export function handleSessionInit(
  state: ClientReconnectionState,
  message: SessionInitMessage
): ClientReconnectionState {
  return {
    ...state,
    sessionId: message.sessionId,
    lastSeq: message.seq,
    protocolVersion: message.protocolVersion,
    attempt: 0,
    isConnected: true,
    lastConnectedAt: Date.now(),
  }
}

/**
 * Update client state from a session.resumed message
 */
export function handleSessionResumed(
  state: ClientReconnectionState,
  message: SessionResumedMessage
): ClientReconnectionState {
  return {
    ...state,
    sessionId: message.sessionId,
    lastSeq: message.seq,
    attempt: 0,
    isConnected: true,
    lastConnectedAt: Date.now(),
  }
}

/**
 * Update client state from a session.expired message
 */
export function handleSessionExpired(
  state: ClientReconnectionState,
  message: SessionExpiredMessage
): ClientReconnectionState {
  return {
    ...state,
    sessionId: message.newSessionId,
    lastSeq: message.seq,
    protocolVersion: message.protocolVersion,
    attempt: 0,
    isConnected: true,
    lastConnectedAt: Date.now(),
  }
}

/**
 * Update client state from an event message
 */
export function handleEvent(
  state: ClientReconnectionState,
  message: EventMessage
): ClientReconnectionState {
  return {
    ...state,
    lastSeq: message.seq,
  }
}

/**
 * Update client state on disconnect
 */
export function handleDisconnect(
  state: ClientReconnectionState
): ClientReconnectionState {
  return {
    ...state,
    isConnected: false,
    attempt: state.attempt + 1,
  }
}

/**
 * Create a session.resume message to send to server
 */
export function createResumeMessage(
  state: ClientReconnectionState
): SessionResumeMessage | null {
  if (!state.sessionId) {
    return null
  }

  return {
    type: 'session.resume',
    sessionId: state.sessionId,
    lastSeq: state.lastSeq,
    clientId: state.clientId,
  }
}

/**
 * Check if client should attempt to resume or start fresh
 */
export function shouldAttemptResume(state: ClientReconnectionState): boolean {
  return state.sessionId !== null
}

/**
 * Get the next retry delay for reconnection
 */
export function getNextRetryDelay(
  state: ClientReconnectionState,
  config: BackoffConfig = DEFAULT_BACKOFF_CONFIG
): number | null {
  if (!shouldRetry(state.attempt, config)) {
    return null
  }
  return calculateBackoffDelay(state.attempt, config)
}

/**
 * Parse a protocol message from JSON string
 */
export function parseProtocolMessage(
  data: string | ArrayBuffer
): ReconnectionProtocolMessage | null {
  try {
    const str = typeof data === 'string' ? data : new TextDecoder().decode(data)
    const message = JSON.parse(str) as ReconnectionProtocolMessage

    if (!message.type) {
      return null
    }

    return message
  } catch {
    return null
  }
}

/**
 * Check if a message is a protocol message (not a regular app message)
 */
export function isProtocolMessage(message: unknown): message is ReconnectionProtocolMessage {
  if (!message || typeof message !== 'object') {
    return false
  }

  const msg = message as { type?: string }
  const protocolTypes = [
    'session.init',
    'session.resume',
    'session.resumed',
    'session.expired',
    'session.error',
    'event',
    'heartbeat.ping',
    'heartbeat.pong',
  ]

  return typeof msg.type === 'string' && protocolTypes.includes(msg.type)
}
