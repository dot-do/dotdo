/**
 * @dotdo/calls - Call Durable Object
 *
 * Durable Object for managing voice/video call state, recordings,
 * and WebRTC signaling.
 *
 * @example
 * ```typescript
 * // In your worker
 * import { CallDO } from '@dotdo/calls'
 *
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const id = env.CALL_DO.idFromName('call-123')
 *     const stub = env.CALL_DO.get(id)
 *     return stub.fetch(request)
 *   }
 * }
 *
 * export { CallDO }
 * ```
 */

/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import type {
  VoiceCall,
  WebRTCSession,
  Recording,
  SignalingMessage,
  RTCIceCandidateInit,
  CallStatus,
} from './types'
import { TwiMLBuilder, parseTwiML, parseVoiceWebhook, validateMakeCallRequest } from './twilio-compat'
import { validateOffer, validateAnswer, validateIceCandidate } from './webrtc-signaling'

// ============================================================================
// Types
// ============================================================================

interface CallDOState {
  calls: Map<string, VoiceCall>
  sessions: Map<string, WebRTCSession>
  recordings: Map<string, Recording>
  candidates: Map<string, Map<string, RTCIceCandidateInit[]>> // sessionId -> userId -> candidates
}

interface CallDOEnv {
  // R2 bucket for storing recordings
  RECORDINGS?: R2Bucket
  // Analytics binding
  ANALYTICS?: AnalyticsEngineDataset
}

// ============================================================================
// CallDO - Durable Object
// ============================================================================

export class CallDO implements DurableObject {
  private state: DurableObjectState
  private env: CallDOEnv
  private app: Hono<{ Bindings: CallDOEnv }>

  // In-memory state (hydrated from storage on first request)
  private calls: Map<string, VoiceCall> = new Map()
  private sessions: Map<string, WebRTCSession> = new Map()
  private recordings: Map<string, Recording> = new Map()
  private candidates: Map<string, Map<string, RTCIceCandidateInit[]>> = new Map()

  private initialized = false

  constructor(state: DurableObjectState, env: CallDOEnv) {
    this.state = state
    this.env = env
    this.app = this.createApp()
  }

  /**
   * Initialize state from durable storage
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return

    // Load persisted state
    const stored = await this.state.storage.get<CallDOState>('state')
    if (stored) {
      this.calls = new Map(stored.calls)
      this.sessions = new Map(stored.sessions)
      this.recordings = new Map(stored.recordings)
      this.candidates = new Map(stored.candidates)
    }

    this.initialized = true
  }

  /**
   * Persist state to durable storage
   */
  private async persist(): Promise<void> {
    await this.state.storage.put('state', {
      calls: Array.from(this.calls.entries()),
      sessions: Array.from(this.sessions.entries()),
      recordings: Array.from(this.recordings.entries()),
      candidates: Array.from(this.candidates.entries()),
    })
  }

  /**
   * Handle incoming HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    await this.initialize()
    return this.app.fetch(request, this.env)
  }

  /**
   * Handle WebSocket connections for real-time signaling
   */
  async handleWebSocket(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.state.acceptWebSocket(server)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  /**
   * Handle WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    try {
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message)
      const msg = JSON.parse(data) as SignalingMessage

      // Process the signaling message
      const result = await this.handleSignalingMessage(msg)

      // Broadcast to other connected clients in the session
      if (result.success && msg.session_id) {
        this.broadcastToSession(msg.session_id, msg, ws)
      }

      // Send acknowledgment
      ws.send(JSON.stringify({ type: 'ack', success: result.success, error: result.error }))
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }))
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // Clean up any session state if needed
    ws.close(code, reason)
  }

  /**
   * Broadcast a message to all clients in a session except the sender
   */
  private broadcastToSession(sessionId: string, message: SignalingMessage, excludeWs: WebSocket): void {
    const websockets = this.state.getWebSockets()
    const messageStr = JSON.stringify(message)

    for (const ws of websockets) {
      if (ws !== excludeWs) {
        try {
          ws.send(messageStr)
        } catch {
          // WebSocket might be closed
        }
      }
    }
  }

  /**
   * Handle a signaling message
   */
  private async handleSignalingMessage(message: SignalingMessage): Promise<{ success: boolean; error?: string }> {
    switch (message.type) {
      case 'offer':
        return this.handleOffer(message)
      case 'answer':
        return this.handleAnswer(message)
      case 'ice-candidate':
        return this.handleIceCandidate(message)
      case 'hangup':
        return this.handleHangup(message)
      default:
        return { success: true }
    }
  }

  private async handleOffer(message: SignalingMessage): Promise<{ success: boolean; error?: string }> {
    if (!message.sdp) {
      return { success: false, error: 'Missing SDP' }
    }

    const validation = validateOffer(message.sdp)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    let session = this.sessions.get(message.session_id)
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
      session.updated_at = new Date()
    }

    this.sessions.set(message.session_id, session)
    await this.persist()

    return { success: true }
  }

  private async handleAnswer(message: SignalingMessage): Promise<{ success: boolean; error?: string }> {
    if (!message.sdp) {
      return { success: false, error: 'Missing SDP' }
    }

    const validation = validateAnswer(message.sdp)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    const session = this.sessions.get(message.session_id)
    if (!session) {
      return { success: false, error: 'Session not found' }
    }

    session.answer = message.sdp
    session.status = 'connected'
    session.start_time = new Date()
    session.updated_at = new Date()

    this.sessions.set(message.session_id, session)
    await this.persist()

    return { success: true }
  }

  private async handleIceCandidate(message: SignalingMessage): Promise<{ success: boolean; error?: string }> {
    if (!message.candidate) {
      return { success: false, error: 'Missing candidate' }
    }

    const validation = validateIceCandidate(message.candidate, { allowEndOfCandidates: true })
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    const session = this.sessions.get(message.session_id)
    if (!session) {
      return { success: false, error: 'Session not found' }
    }

    // Store candidate for the recipient
    let sessionCandidates = this.candidates.get(message.session_id)
    if (!sessionCandidates) {
      sessionCandidates = new Map()
      this.candidates.set(message.session_id, sessionCandidates)
    }

    const userCandidates = sessionCandidates.get(message.to) || []
    userCandidates.push(message.candidate)
    sessionCandidates.set(message.to, userCandidates)

    session.ice_candidates.push(message.candidate)
    session.updated_at = new Date()

    this.sessions.set(message.session_id, session)
    await this.persist()

    return { success: true }
  }

  private async handleHangup(message: SignalingMessage): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(message.session_id)
    if (!session) {
      return { success: false, error: 'Session not found' }
    }

    session.status = 'disconnected'
    session.end_time = new Date()
    session.updated_at = new Date()

    this.sessions.set(message.session_id, session)
    await this.persist()

    return { success: true }
  }

  /**
   * Create the Hono app with all routes
   */
  private createApp(): Hono<{ Bindings: CallDOEnv }> {
    const app = new Hono<{ Bindings: CallDOEnv }>()

    // ========================================================================
    // Voice Call Routes (Twilio-compatible)
    // ========================================================================

    // POST /calls - Create a new call
    app.post('/calls', async (c) => {
      const body = await c.req.json<{
        to: string
        from: string
        url?: string
        twiml?: string
        status_callback?: string
        status_callback_method?: 'GET' | 'POST'
      }>()

      const validation = validateMakeCallRequest(body)
      if (!validation.valid) {
        return c.json(validation.errors, 400)
      }

      const sid = this.generateSid('CA')

      const call: VoiceCall = {
        sid,
        account_sid: 'AC_default',
        from: body.from,
        to: body.to,
        direction: 'outbound',
        status: 'queued',
        status_callback: body.status_callback,
        status_callback_method: body.status_callback_method,
        created_at: new Date(),
        updated_at: new Date(),
      }

      this.calls.set(sid, call)
      await this.persist()

      return c.json(call, 201)
    })

    // GET /calls/:sid - Get call details
    app.get('/calls/:sid', async (c) => {
      const sid = c.req.param('sid')
      const call = this.calls.get(sid)

      if (!call) {
        return c.json({ error: 'Call not found' }, 404)
      }

      return c.json(call)
    })

    // POST /calls/:sid - Update a call
    app.post('/calls/:sid', async (c) => {
      const sid = c.req.param('sid')
      const call = this.calls.get(sid)

      if (!call) {
        return c.json({ error: 'Call not found' }, 404)
      }

      const body = await c.req.json<{
        status?: 'canceled' | 'completed'
        url?: string
        twiml?: string
      }>()

      if (body.status) {
        call.status = body.status
        if (body.status === 'completed' || body.status === 'canceled') {
          call.end_time = new Date()
        }
      }

      call.updated_at = new Date()
      this.calls.set(sid, call)
      await this.persist()

      return c.json(call)
    })

    // GET /calls - List calls
    app.get('/calls', async (c) => {
      const status = c.req.query('status') as CallStatus | undefined
      const to = c.req.query('to')
      const from = c.req.query('from')

      let calls = Array.from(this.calls.values())

      if (status) {
        calls = calls.filter((call) => call.status === status)
      }
      if (to) {
        calls = calls.filter((call) => call.to === to)
      }
      if (from) {
        calls = calls.filter((call) => call.from === from)
      }

      return c.json({ calls })
    })

    // POST /webhook/voice - Handle voice webhook
    app.post('/webhook/voice', async (c) => {
      const contentType = c.req.header('Content-Type') || ''
      let payload: Record<string, string>

      if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await c.req.parseBody()
        payload = Object.fromEntries(
          Object.entries(formData).map(([k, v]) => [k, String(v)])
        )
      } else {
        payload = await c.req.json()
      }

      const webhook = parseVoiceWebhook(payload)

      // Update call state
      const call = this.calls.get(webhook.CallSid)
      if (call) {
        call.status = webhook.CallStatus
        call.updated_at = new Date()
        this.calls.set(webhook.CallSid, call)
        await this.persist()
      }

      // Return default TwiML
      const builder = new TwiMLBuilder()
      return c.text(builder.build(), 200, {
        'Content-Type': 'application/xml',
      })
    })

    // ========================================================================
    // WebRTC Session Routes
    // ========================================================================

    // POST /sessions - Create a new WebRTC session
    app.post('/sessions', async (c) => {
      const body = await c.req.json<{
        initiator_id: string
        participant_ids: string[]
        type: 'audio' | 'video' | 'screen-share'
        offer?: { type: 'offer'; sdp: string }
      }>()

      const id = this.generateSid('')

      const session: WebRTCSession = {
        id,
        initiator_id: body.initiator_id,
        participant_ids: body.participant_ids,
        status: 'pending',
        type: body.type,
        offer: body.offer,
        ice_candidates: [],
        created_at: new Date(),
        updated_at: new Date(),
      }

      this.sessions.set(id, session)
      this.candidates.set(id, new Map())
      await this.persist()

      return c.json({ id, status: 'pending', created_at: session.created_at }, 201)
    })

    // GET /sessions/:id - Get session details
    app.get('/sessions/:id', async (c) => {
      const id = c.req.param('id')
      const session = this.sessions.get(id)

      if (!session) {
        return c.json({ error: 'Session not found' }, 404)
      }

      return c.json(session)
    })

    // POST /sessions/:id/join - Join a session
    app.post('/sessions/:id/join', async (c) => {
      const id = c.req.param('id')
      const session = this.sessions.get(id)

      if (!session) {
        return c.json({ success: false, error: 'Session not found' }, 404)
      }

      const body = await c.req.json<{
        participant_id: string
        answer?: { type: 'answer'; sdp: string }
      }>()

      // Check authorization
      if (!session.participant_ids.includes(body.participant_id) && session.initiator_id !== body.participant_id) {
        return c.json({ success: false, error: 'Unauthorized' }, 403)
      }

      if (body.answer) {
        session.answer = body.answer
        session.status = 'connected'
        session.start_time = new Date()
      }

      session.updated_at = new Date()
      this.sessions.set(id, session)
      await this.persist()

      return c.json({ success: true, session })
    })

    // POST /sessions/:id/signal - Send a signaling message
    app.post('/sessions/:id/signal', async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json<Partial<SignalingMessage>>()

      const message: SignalingMessage = {
        type: body.type as SignalingMessage['type'],
        from: body.from || '',
        to: body.to || '',
        session_id: id,
        sdp: body.sdp,
        candidate: body.candidate,
        timestamp: new Date(),
      }

      const result = await this.handleSignalingMessage(message)

      if (!result.success) {
        return c.json({ success: false, error: result.error }, 400)
      }

      // Broadcast to connected WebSocket clients
      this.broadcastSignalingMessage(message)

      return c.json({ success: true })
    })

    // DELETE /sessions/:id - End a session
    app.delete('/sessions/:id', async (c) => {
      const id = c.req.param('id')
      const session = this.sessions.get(id)

      if (!session) {
        return c.json({ error: 'Session not found' }, 404)
      }

      session.status = 'disconnected'
      session.end_time = new Date()
      session.updated_at = new Date()

      this.sessions.set(id, session)
      await this.persist()

      return c.json({ success: true })
    })

    // GET /sessions/:id/candidates - Get pending ICE candidates
    app.get('/sessions/:id/candidates', async (c) => {
      const id = c.req.param('id')
      const forUser = c.req.query('for') || ''

      const sessionCandidates = this.candidates.get(id)
      if (!sessionCandidates) {
        return c.json([])
      }

      const candidates = sessionCandidates.get(forUser) || []
      // Clear after reading
      sessionCandidates.set(forUser, [])
      await this.persist()

      return c.json(candidates)
    })

    // ========================================================================
    // Recording Routes
    // ========================================================================

    // GET /recordings/:sid - Get recording details
    app.get('/recordings/:sid', async (c) => {
      const sid = c.req.param('sid')
      const recording = this.recordings.get(sid)

      if (!recording) {
        return c.json({ error: 'Recording not found' }, 404)
      }

      return c.json(recording)
    })

    // GET /recordings/:sid/media - Stream recording media
    app.get('/recordings/:sid/media', async (c) => {
      const sid = c.req.param('sid')
      const recording = this.recordings.get(sid)

      if (!recording || !recording.storage_key) {
        return c.json({ error: 'Recording not found' }, 404)
      }

      if (!this.env.RECORDINGS) {
        return c.json({ error: 'Recording storage not configured' }, 503)
      }

      const object = await this.env.RECORDINGS.get(recording.storage_key)
      if (!object) {
        return c.json({ error: 'Recording media not found' }, 404)
      }

      return new Response(object.body, {
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': String(object.size),
        },
      })
    })

    // POST /recordings - Create a recording reference (internal)
    app.post('/recordings', async (c) => {
      const body = await c.req.json<{
        call_sid: string
        storage_key?: string
        duration?: number
      }>()

      const sid = this.generateSid('RE')

      const recording: Recording = {
        sid,
        account_sid: 'AC_default',
        call_sid: body.call_sid,
        status: 'in-progress',
        channels: 1,
        source: 'RecordVerb',
        storage_key: body.storage_key,
        created_at: new Date(),
        updated_at: new Date(),
      }

      this.recordings.set(sid, recording)
      await this.persist()

      return c.json(recording, 201)
    })

    // ========================================================================
    // WebSocket Upgrade
    // ========================================================================

    app.get('/ws', async (c) => {
      const request = c.req.raw
      return this.handleWebSocket(request)
    })

    // ========================================================================
    // Health Check
    // ========================================================================

    app.get('/health', (c) => {
      return c.json({
        status: 'ok',
        calls: this.calls.size,
        sessions: this.sessions.size,
        recordings: this.recordings.size,
      })
    })

    return app
  }

  /**
   * Generate a Twilio-style SID
   */
  private generateSid(prefix: string): string {
    const chars = '0123456789abcdef'
    let sid = prefix
    for (let i = 0; i < 32; i++) {
      sid += chars[Math.floor(Math.random() * chars.length)]
    }
    return sid
  }

  /**
   * Broadcast a signaling message to all WebSocket clients
   */
  private broadcastSignalingMessage(message: SignalingMessage): void {
    const websockets = this.state.getWebSockets()
    const messageStr = JSON.stringify(message)

    for (const ws of websockets) {
      try {
        ws.send(messageStr)
      } catch {
        // WebSocket might be closed
      }
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export default CallDO
