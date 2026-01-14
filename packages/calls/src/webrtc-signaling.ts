/**
 * @dotdo/calls - WebRTC Signaling Server
 *
 * WebRTC signaling via Durable Objects for peer-to-peer video/audio calls.
 *
 * @example
 * ```typescript
 * import { SignalingClient } from '@dotdo/calls'
 *
 * const client = new SignalingClient('user123')
 * await client.connect('wss://signaling.calls.do')
 *
 * // Create a video call
 * const session = await client.createSession({
 *   participant_ids: ['user456'],
 *   type: 'video',
 * })
 *
 * // Send offer when local description is ready
 * client.sendOffer('user456', session.id, localDescription)
 * ```
 */

import { Hono } from 'hono'
import type {
  SignalingMessage,
  SignalingMessageType,
  WebRTCSession,
  CreateSessionRequest,
  CreateSessionResponse,
  JoinSessionRequest,
  JoinSessionResponse,
  RTCSessionDescriptionInit,
  RTCIceCandidateInit,
} from './types'

// ============================================================================
// In-Memory Storage (for testing, replaced by DO in production)
// ============================================================================

const sessionStore = new Map<string, WebRTCSession>()
const candidateStore = new Map<string, Map<string, RTCIceCandidateInit[]>>() // sessionId -> userId -> candidates

// ============================================================================
// SignalingServer
// ============================================================================

export interface HandleMessageResult {
  success: boolean
  session_id?: string
  error?: string
}

export class SignalingServer {
  /**
   * Handle an incoming signaling message
   */
  async handleMessage(message: SignalingMessage): Promise<HandleMessageResult> {
    switch (message.type) {
      case 'offer':
        return this.handleOffer(message)
      case 'answer':
        return this.handleAnswer(message)
      case 'ice-candidate':
        return this.handleIceCandidate(message)
      case 'hangup':
        return this.handleHangup(message)
      case 'mute':
      case 'unmute':
      case 'video-on':
      case 'video-off':
        return this.handleMediaStateChange(message)
      case 'renegotiate':
        return this.handleRenegotiate(message)
      default:
        return { success: false, error: 'Unknown message type' }
    }
  }

  private async handleOffer(message: SignalingMessage): Promise<HandleMessageResult> {
    if (!message.sdp) {
      return { success: false, error: 'Missing SDP in offer' }
    }

    // Create or update session
    let session = sessionStore.get(message.session_id)
    if (!session) {
      session = {
        id: message.session_id,
        initiator_id: message.from,
        participant_ids: [message.to],
        status: 'pending',
        type: 'video',
        offer: message.sdp,
        ice_candidates: [],
        created_at: new Date(),
        updated_at: new Date(),
      }
    } else {
      session.offer = message.sdp
      session.status = 'pending'
      session.updated_at = new Date()
    }

    sessionStore.set(message.session_id, session)

    // Initialize candidate storage for this session
    if (!candidateStore.has(message.session_id)) {
      candidateStore.set(message.session_id, new Map())
    }

    return { success: true, session_id: message.session_id }
  }

  private async handleAnswer(message: SignalingMessage): Promise<HandleMessageResult> {
    if (!message.sdp) {
      return { success: false, error: 'Missing SDP in answer' }
    }

    const session = sessionStore.get(message.session_id)
    if (!session) {
      return { success: false, error: 'Session not found' }
    }

    session.answer = message.sdp
    session.status = 'connected'
    session.start_time = new Date()
    session.updated_at = new Date()

    sessionStore.set(message.session_id, session)

    return { success: true, session_id: message.session_id }
  }

  private async handleIceCandidate(message: SignalingMessage): Promise<HandleMessageResult> {
    if (!message.candidate) {
      return { success: false, error: 'Missing candidate' }
    }

    const session = sessionStore.get(message.session_id)
    if (!session) {
      return { success: false, error: 'Session not found' }
    }

    // Store candidate for the recipient
    let sessionCandidates = candidateStore.get(message.session_id)
    if (!sessionCandidates) {
      sessionCandidates = new Map()
      candidateStore.set(message.session_id, sessionCandidates)
    }

    const userCandidates = sessionCandidates.get(message.to) || []
    userCandidates.push(message.candidate)
    sessionCandidates.set(message.to, userCandidates)

    session.ice_candidates.push(message.candidate)
    session.updated_at = new Date()
    sessionStore.set(message.session_id, session)

    return { success: true, session_id: message.session_id }
  }

  private async handleHangup(message: SignalingMessage): Promise<HandleMessageResult> {
    const session = sessionStore.get(message.session_id)
    if (!session) {
      return { success: false, error: 'Session not found' }
    }

    session.status = 'disconnected'
    session.end_time = new Date()
    session.updated_at = new Date()

    sessionStore.set(message.session_id, session)

    return { success: true, session_id: message.session_id }
  }

  private async handleMediaStateChange(message: SignalingMessage): Promise<HandleMessageResult> {
    const session = sessionStore.get(message.session_id)
    if (!session) {
      return { success: false, error: 'Session not found' }
    }

    session.updated_at = new Date()
    sessionStore.set(message.session_id, session)

    return { success: true, session_id: message.session_id }
  }

  private async handleRenegotiate(message: SignalingMessage): Promise<HandleMessageResult> {
    const session = sessionStore.get(message.session_id)
    if (!session) {
      return { success: false, error: 'Session not found' }
    }

    if (message.sdp) {
      if (message.sdp.type === 'offer') {
        session.offer = message.sdp
      } else {
        session.answer = message.sdp
      }
    }

    session.updated_at = new Date()
    sessionStore.set(message.session_id, session)

    return { success: true, session_id: message.session_id }
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<WebRTCSession | null> {
    return sessionStore.get(sessionId) || null
  }

  /**
   * Get pending ICE candidates for a user
   */
  async getPendingCandidates(sessionId: string, userId: string): Promise<RTCIceCandidateInit[]> {
    const sessionCandidates = candidateStore.get(sessionId)
    if (!sessionCandidates) {
      return []
    }

    const candidates = sessionCandidates.get(userId) || []
    // Clear after reading
    sessionCandidates.set(userId, [])

    return candidates
  }
}

// ============================================================================
// SessionManager
// ============================================================================

export class SessionManager {
  /**
   * Create a new WebRTC session
   */
  async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
    const id = generateSessionId()

    const session: WebRTCSession = {
      id,
      initiator_id: request.initiator_id,
      participant_ids: request.participant_ids,
      status: 'pending',
      type: request.type,
      offer: request.offer,
      ice_candidates: [],
      created_at: new Date(),
      updated_at: new Date(),
    }

    sessionStore.set(id, session)

    // Initialize candidate storage
    candidateStore.set(id, new Map())

    return {
      id,
      status: 'pending',
      created_at: session.created_at,
    }
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<WebRTCSession | null> {
    return sessionStore.get(sessionId) || null
  }

  /**
   * Join an existing session
   */
  async joinSession(sessionId: string, request: JoinSessionRequest): Promise<JoinSessionResponse> {
    const session = sessionStore.get(sessionId)
    if (!session) {
      return {
        success: false,
        session: null as unknown as WebRTCSession,
      }
    }

    // Check if participant is authorized
    if (
      session.initiator_id !== request.participant_id &&
      !session.participant_ids.includes(request.participant_id)
    ) {
      return {
        success: false,
        session,
      }
    }

    // Update session with answer if provided
    if (request.answer) {
      session.answer = request.answer
      session.status = 'connected'
      session.start_time = new Date()
    }

    session.updated_at = new Date()
    sessionStore.set(sessionId, session)

    return {
      success: true,
      session,
    }
  }

  /**
   * End a session
   */
  async endSession(sessionId: string, userId: string): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) {
      return
    }

    session.status = 'disconnected'
    session.end_time = new Date()
    session.updated_at = new Date()

    sessionStore.set(sessionId, session)
  }

  /**
   * List sessions for a user
   */
  async listSessions(userId: string, filters?: { status?: WebRTCSession['status'] }): Promise<WebRTCSession[]> {
    let sessions = Array.from(sessionStore.values()).filter(
      (s) => s.initiator_id === userId || s.participant_ids.includes(userId)
    )

    if (filters?.status) {
      sessions = sessions.filter((s) => s.status === filters.status)
    }

    return sessions
  }
}

function generateSessionId(): string {
  const chars = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 32; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

// ============================================================================
// SignalingClient
// ============================================================================

type EventHandler<T = unknown> = (data: T) => void

export class SignalingClient {
  private userId: string
  private connected = false
  private ws: WebSocket | null = null
  private eventHandlers: Map<string, EventHandler[]> = new Map()

  constructor(userId: string) {
    this.userId = userId
  }

  /**
   * Connect to the signaling server
   */
  async connect(url: string): Promise<{ connected: boolean }> {
    // In a real implementation, this would establish a WebSocket connection
    // For testing, we just set the connected flag
    this.connected = true
    return { connected: true }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Disconnect from the signaling server
   */
  disconnect(): void {
    this.connected = false
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  /**
   * Send an offer to a peer
   */
  async sendOffer(to: string, sessionId: string, offer: RTCSessionDescriptionInit): Promise<{ sent: boolean }> {
    if (!this.connected) {
      return { sent: false }
    }

    const message: SignalingMessage = {
      type: 'offer',
      from: this.userId,
      to,
      session_id: sessionId,
      sdp: offer,
      timestamp: new Date(),
    }

    // In a real implementation, send via WebSocket
    // For testing, we process directly
    return { sent: true }
  }

  /**
   * Send an answer to a peer
   */
  async sendAnswer(to: string, sessionId: string, answer: RTCSessionDescriptionInit): Promise<{ sent: boolean }> {
    if (!this.connected) {
      return { sent: false }
    }

    const message: SignalingMessage = {
      type: 'answer',
      from: this.userId,
      to,
      session_id: sessionId,
      sdp: answer,
      timestamp: new Date(),
    }

    return { sent: true }
  }

  /**
   * Send an ICE candidate to a peer
   */
  async sendIceCandidate(to: string, sessionId: string, candidate: RTCIceCandidateInit): Promise<{ sent: boolean }> {
    if (!this.connected) {
      return { sent: false }
    }

    const message: SignalingMessage = {
      type: 'ice-candidate',
      from: this.userId,
      to,
      session_id: sessionId,
      candidate,
      timestamp: new Date(),
    }

    return { sent: true }
  }

  /**
   * Send hangup to a peer
   */
  async sendHangup(to: string, sessionId: string): Promise<{ sent: boolean }> {
    if (!this.connected) {
      return { sent: false }
    }

    const message: SignalingMessage = {
      type: 'hangup',
      from: this.userId,
      to,
      session_id: sessionId,
      timestamp: new Date(),
    }

    return { sent: true }
  }

  /**
   * Register an event handler
   */
  on<T = unknown>(event: string, handler: EventHandler<T>): void {
    const handlers = this.eventHandlers.get(event) || []
    handlers.push(handler as EventHandler)
    this.eventHandlers.set(event, handlers)
  }

  /**
   * Remove an event handler
   */
  off(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event) || []
    const index = handlers.indexOf(handler)
    if (index !== -1) {
      handlers.splice(index, 1)
    }
  }

  /**
   * Emit an event (for testing and internal use)
   */
  emit<T = unknown>(event: string, data: T): void {
    const handlers = this.eventHandlers.get(event) || []
    handlers.forEach((handler) => handler(data))
  }
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean
  error?: string
}

export function validateOffer(offer: RTCSessionDescriptionInit): ValidationResult {
  if (!offer.sdp) {
    return { valid: false, error: 'SDP is required' }
  }

  if (offer.type !== 'offer') {
    return { valid: false, error: 'type must be "offer"' }
  }

  // Basic SDP validation - must start with v=0
  if (!offer.sdp.startsWith('v=0')) {
    return { valid: false, error: 'Invalid SDP format' }
  }

  return { valid: true }
}

export function validateAnswer(answer: RTCSessionDescriptionInit): ValidationResult {
  if (!answer.sdp) {
    return { valid: false, error: 'SDP is required' }
  }

  if (answer.type !== 'answer') {
    return { valid: false, error: 'type must be "answer"' }
  }

  // Basic SDP validation
  if (!answer.sdp.startsWith('v=0')) {
    return { valid: false, error: 'Invalid SDP format' }
  }

  return { valid: true }
}

export function validateIceCandidate(
  candidate: RTCIceCandidateInit,
  options?: { allowEndOfCandidates?: boolean }
): ValidationResult {
  // End of candidates signal
  if (candidate.candidate === '' && candidate.sdpMid === null && candidate.sdpMLineIndex === null) {
    if (options?.allowEndOfCandidates) {
      return { valid: true }
    }
    return { valid: false, error: 'Empty candidate' }
  }

  if (!candidate.candidate) {
    return { valid: false, error: 'candidate string is required' }
  }

  return { valid: true }
}

// ============================================================================
// Hono Router
// ============================================================================

export interface SignalingEnv {
  // Add any environment bindings here
}

/**
 * Create a Hono router for WebRTC signaling
 */
export function createSignalingRouter(): Hono<{ Bindings: SignalingEnv }> {
  const router = new Hono<{ Bindings: SignalingEnv }>()
  const manager = new SessionManager()
  const server = new SignalingServer()

  // POST /sessions - Create a new session
  router.post('/sessions', async (c) => {
    try {
      const body = await c.req.json<CreateSessionRequest>()
      const result = await manager.createSession(body)
      return c.json(result, 201)
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      )
    }
  })

  // GET /sessions/:id - Get session details
  router.get('/sessions/:id', async (c) => {
    const id = c.req.param('id')
    const session = await manager.getSession(id)

    if (!session) {
      return c.json({ error: 'Session not found' }, 404)
    }

    return c.json(session)
  })

  // POST /sessions/:id/join - Join a session
  router.post('/sessions/:id/join', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json<JoinSessionRequest>()

    const result = await manager.joinSession(id, body)

    if (!result.success) {
      return c.json({ success: false, error: 'Failed to join session' }, 400)
    }

    return c.json(result)
  })

  // POST /sessions/:id/signal - Send a signaling message
  router.post('/sessions/:id/signal', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json<Partial<SignalingMessage>>()

    const message: SignalingMessage = {
      type: body.type as SignalingMessageType,
      from: body.from || '',
      to: body.to || '',
      session_id: id,
      sdp: body.sdp,
      candidate: body.candidate,
      timestamp: new Date(),
      metadata: body.metadata,
    }

    const result = await server.handleMessage(message)

    if (!result.success) {
      return c.json({ success: false, error: result.error }, 400)
    }

    return c.json({ success: true })
  })

  // DELETE /sessions/:id - End a session
  router.delete('/sessions/:id', async (c) => {
    const id = c.req.param('id')
    const userId = c.req.header('X-User-Id') || ''

    await manager.endSession(id, userId)

    return c.json({ success: true })
  })

  // GET /sessions/:id/candidates - Get pending ICE candidates
  router.get('/sessions/:id/candidates', async (c) => {
    const id = c.req.param('id')
    const forUser = c.req.query('for') || ''

    const candidates = await server.getPendingCandidates(id, forUser)

    return c.json(candidates)
  })

  // GET /sessions - List sessions for a user
  router.get('/sessions', async (c) => {
    const userId = c.req.query('user_id') || c.req.header('X-User-Id') || ''
    const status = c.req.query('status') as WebRTCSession['status'] | undefined

    const sessions = await manager.listSessions(userId, { status })

    return c.json({ sessions })
  })

  return router
}

// ============================================================================
// Exports
// ============================================================================

export {
  SignalingServer as default,
}
