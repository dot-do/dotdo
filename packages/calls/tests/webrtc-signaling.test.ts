/**
 * @dotdo/calls - WebRTC Signaling Tests
 *
 * TDD tests for WebRTC signaling via Durable Objects.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SignalingServer,
  SignalingClient,
  SessionManager,
  createSignalingRouter,
  validateOffer,
  validateAnswer,
  validateIceCandidate,
} from '../src/webrtc-signaling'
import type {
  SignalingMessage,
  WebRTCSession,
  CreateSessionRequest,
  RTCSessionDescriptionInit,
  RTCIceCandidateInit,
} from '../src/types'

// ============================================================================
// SignalingServer Tests
// ============================================================================

describe('SignalingServer', () => {
  describe('handleMessage', () => {
    let server: SignalingServer

    beforeEach(() => {
      server = new SignalingServer()
    })

    it('handles offer message', async () => {
      const message: SignalingMessage = {
        type: 'offer',
        from: 'user1',
        to: 'user2',
        session_id: 'session123',
        sdp: {
          type: 'offer',
          sdp: 'v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\n...',
        },
        timestamp: new Date(),
      }

      const result = await server.handleMessage(message)

      expect(result.success).toBe(true)
      expect(result.session_id).toBe('session123')
    })

    it('handles answer message', async () => {
      // First create a session with an offer
      await server.handleMessage({
        type: 'offer',
        from: 'user1',
        to: 'user2',
        session_id: 'session123',
        sdp: {
          type: 'offer',
          sdp: 'v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\n...',
        },
        timestamp: new Date(),
      })

      // Then send an answer
      const message: SignalingMessage = {
        type: 'answer',
        from: 'user2',
        to: 'user1',
        session_id: 'session123',
        sdp: {
          type: 'answer',
          sdp: 'v=0\r\no=- 789 012 IN IP4 127.0.0.1\r\n...',
        },
        timestamp: new Date(),
      }

      const result = await server.handleMessage(message)

      expect(result.success).toBe(true)
    })

    it('handles ICE candidate message', async () => {
      // First create a session
      await server.handleMessage({
        type: 'offer',
        from: 'user1',
        to: 'user2',
        session_id: 'session123',
        sdp: {
          type: 'offer',
          sdp: 'v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\n...',
        },
        timestamp: new Date(),
      })

      // Then send an ICE candidate
      const message: SignalingMessage = {
        type: 'ice-candidate',
        from: 'user1',
        to: 'user2',
        session_id: 'session123',
        candidate: {
          candidate: 'candidate:1 1 udp 2122260223 192.168.1.100 54321 typ host generation 0',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
        timestamp: new Date(),
      }

      const result = await server.handleMessage(message)

      expect(result.success).toBe(true)
    })

    it('handles hangup message', async () => {
      // First create a session
      await server.handleMessage({
        type: 'offer',
        from: 'user1',
        to: 'user2',
        session_id: 'session123',
        sdp: {
          type: 'offer',
          sdp: 'v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\n...',
        },
        timestamp: new Date(),
      })

      // Then hang up
      const message: SignalingMessage = {
        type: 'hangup',
        from: 'user1',
        to: 'user2',
        session_id: 'session123',
        timestamp: new Date(),
      }

      const result = await server.handleMessage(message)

      expect(result.success).toBe(true)
    })

    it('handles mute message', async () => {
      await server.handleMessage({
        type: 'offer',
        from: 'user1',
        to: 'user2',
        session_id: 'session123',
        sdp: {
          type: 'offer',
          sdp: 'v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\n...',
        },
        timestamp: new Date(),
      })

      const message: SignalingMessage = {
        type: 'mute',
        from: 'user1',
        to: 'user2',
        session_id: 'session123',
        timestamp: new Date(),
      }

      const result = await server.handleMessage(message)

      expect(result.success).toBe(true)
    })

    it('handles video-off message', async () => {
      await server.handleMessage({
        type: 'offer',
        from: 'user1',
        to: 'user2',
        session_id: 'session123',
        sdp: {
          type: 'offer',
          sdp: 'v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\n...',
        },
        timestamp: new Date(),
      })

      const message: SignalingMessage = {
        type: 'video-off',
        from: 'user1',
        to: 'user2',
        session_id: 'session123',
        timestamp: new Date(),
      }

      const result = await server.handleMessage(message)

      expect(result.success).toBe(true)
    })

    it('rejects answer without prior offer', async () => {
      const message: SignalingMessage = {
        type: 'answer',
        from: 'user2',
        to: 'user1',
        session_id: 'nonexistent',
        sdp: {
          type: 'answer',
          sdp: 'v=0\r\no=- 789 012 IN IP4 127.0.0.1\r\n...',
        },
        timestamp: new Date(),
      }

      const result = await server.handleMessage(message)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Session not found')
    })
  })

  describe('getSession', () => {
    let server: SignalingServer

    beforeEach(() => {
      server = new SignalingServer()
    })

    it('returns session after offer', async () => {
      await server.handleMessage({
        type: 'offer',
        from: 'user1',
        to: 'user2',
        session_id: 'session123',
        sdp: {
          type: 'offer',
          sdp: 'v=0\r\n...',
        },
        timestamp: new Date(),
      })

      const session = await server.getSession('session123')

      expect(session).toBeDefined()
      expect(session?.id).toBe('session123')
      expect(session?.status).toBe('pending')
      expect(session?.offer).toBeDefined()
    })

    it('returns updated session after answer', async () => {
      await server.handleMessage({
        type: 'offer',
        from: 'user1',
        to: 'user2',
        session_id: 'session123',
        sdp: { type: 'offer', sdp: 'v=0\r\n...' },
        timestamp: new Date(),
      })

      await server.handleMessage({
        type: 'answer',
        from: 'user2',
        to: 'user1',
        session_id: 'session123',
        sdp: { type: 'answer', sdp: 'v=0\r\n...' },
        timestamp: new Date(),
      })

      const session = await server.getSession('session123')

      expect(session?.status).toBe('connected')
      expect(session?.answer).toBeDefined()
    })

    it('returns null for non-existent session', async () => {
      const session = await server.getSession('nonexistent')

      expect(session).toBeNull()
    })
  })

  describe('getPendingCandidates', () => {
    let server: SignalingServer

    beforeEach(() => {
      server = new SignalingServer()
    })

    it('returns pending ICE candidates', async () => {
      // Use a unique session ID for this test to avoid interference from other tests
      const sessionId = `session-ice-${Date.now()}`

      await server.handleMessage({
        type: 'offer',
        from: 'user1',
        to: 'user2',
        session_id: sessionId,
        sdp: { type: 'offer', sdp: 'v=0\r\n...' },
        timestamp: new Date(),
      })

      await server.handleMessage({
        type: 'ice-candidate',
        from: 'user1',
        to: 'user2',
        session_id: sessionId,
        candidate: {
          candidate: 'candidate:1 1 udp 2122260223 192.168.1.100 54321 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
        timestamp: new Date(),
      })

      await server.handleMessage({
        type: 'ice-candidate',
        from: 'user1',
        to: 'user2',
        session_id: sessionId,
        candidate: {
          candidate: 'candidate:2 1 udp 2122260222 192.168.1.100 54322 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
        timestamp: new Date(),
      })

      const candidates = await server.getPendingCandidates(sessionId, 'user2')

      expect(candidates).toHaveLength(2)
    })

    it('returns empty array for no candidates', async () => {
      const sessionId = `session-empty-${Date.now()}`

      await server.handleMessage({
        type: 'offer',
        from: 'user1',
        to: 'user2',
        session_id: sessionId,
        sdp: { type: 'offer', sdp: 'v=0\r\n...' },
        timestamp: new Date(),
      })

      const candidates = await server.getPendingCandidates(sessionId, 'user2')

      expect(candidates).toHaveLength(0)
    })
  })
})

// ============================================================================
// SessionManager Tests
// ============================================================================

describe('SessionManager', () => {
  describe('createSession', () => {
    let manager: SessionManager

    beforeEach(() => {
      manager = new SessionManager()
    })

    it('creates a new session', async () => {
      const request: CreateSessionRequest = {
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
      }

      const result = await manager.createSession(request)

      expect(result.id).toBeDefined()
      expect(result.id.length).toBeGreaterThan(0)
      expect(result.status).toBe('pending')
    })

    it('creates session with initial offer', async () => {
      const request: CreateSessionRequest = {
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
        offer: {
          type: 'offer',
          sdp: 'v=0\r\n...',
        },
      }

      const result = await manager.createSession(request)
      const session = await manager.getSession(result.id)

      expect(session?.offer).toBeDefined()
      expect(session?.offer?.type).toBe('offer')
    })

    it('creates audio-only session', async () => {
      const request: CreateSessionRequest = {
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'audio',
      }

      const result = await manager.createSession(request)
      const session = await manager.getSession(result.id)

      expect(session?.type).toBe('audio')
    })

    it('creates screen-share session', async () => {
      const request: CreateSessionRequest = {
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'screen-share',
      }

      const result = await manager.createSession(request)
      const session = await manager.getSession(result.id)

      expect(session?.type).toBe('screen-share')
    })

    it('supports multiple participants', async () => {
      const request: CreateSessionRequest = {
        initiator_id: 'user1',
        participant_ids: ['user2', 'user3', 'user4'],
        type: 'video',
      }

      const result = await manager.createSession(request)
      const session = await manager.getSession(result.id)

      expect(session?.participant_ids).toContain('user2')
      expect(session?.participant_ids).toContain('user3')
      expect(session?.participant_ids).toContain('user4')
    })
  })

  describe('joinSession', () => {
    let manager: SessionManager

    beforeEach(() => {
      manager = new SessionManager()
    })

    it('allows participant to join with answer', async () => {
      const { id } = await manager.createSession({
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
        offer: { type: 'offer', sdp: 'v=0\r\n...' },
      })

      const result = await manager.joinSession(id, {
        participant_id: 'user2',
        answer: { type: 'answer', sdp: 'v=0\r\n...' },
      })

      expect(result.success).toBe(true)
      expect(result.session.status).toBe('connected')
      expect(result.session.answer).toBeDefined()
    })

    it('rejects unauthorized participant', async () => {
      const { id } = await manager.createSession({
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
      })

      const result = await manager.joinSession(id, {
        participant_id: 'unauthorized-user',
      })

      expect(result.success).toBe(false)
    })

    it('rejects join on non-existent session', async () => {
      const result = await manager.joinSession('nonexistent', {
        participant_id: 'user2',
      })

      expect(result.success).toBe(false)
    })
  })

  describe('endSession', () => {
    let manager: SessionManager

    beforeEach(() => {
      manager = new SessionManager()
    })

    it('ends an active session', async () => {
      const { id } = await manager.createSession({
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
      })

      await manager.endSession(id, 'user1')
      const session = await manager.getSession(id)

      expect(session?.status).toBe('disconnected')
      expect(session?.end_time).toBeDefined()
    })

    it('allows any participant to end session', async () => {
      const { id } = await manager.createSession({
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
      })

      await manager.endSession(id, 'user2')
      const session = await manager.getSession(id)

      expect(session?.status).toBe('disconnected')
    })
  })

  describe('listSessions', () => {
    let manager: SessionManager

    beforeEach(() => {
      manager = new SessionManager()
    })

    it('lists all sessions for a user', async () => {
      await manager.createSession({
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
      })

      await manager.createSession({
        initiator_id: 'user1',
        participant_ids: ['user3'],
        type: 'audio',
      })

      const sessions = await manager.listSessions('user1')

      expect(sessions.length).toBeGreaterThanOrEqual(2)
    })

    it('includes sessions where user is participant', async () => {
      await manager.createSession({
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
      })

      const sessions = await manager.listSessions('user2')

      expect(sessions.length).toBeGreaterThanOrEqual(1)
    })

    it('filters by status', async () => {
      const { id } = await manager.createSession({
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
      })

      await manager.endSession(id, 'user1')

      const pendingSessions = await manager.listSessions('user1', { status: 'pending' })
      const disconnectedSessions = await manager.listSessions('user1', { status: 'disconnected' })

      expect(pendingSessions.every((s) => s.status === 'pending')).toBe(true)
      expect(disconnectedSessions.some((s) => s.status === 'disconnected')).toBe(true)
    })
  })
})

// ============================================================================
// SignalingClient Tests
// ============================================================================

describe('SignalingClient', () => {
  describe('connect', () => {
    it('connects to signaling server', async () => {
      const client = new SignalingClient('user1')

      // Mock WebSocket or use server directly for testing
      const result = await client.connect('ws://localhost:8080/signaling')

      expect(result.connected).toBe(true)
    })
  })

  describe('sendOffer', () => {
    let client: SignalingClient

    beforeEach(() => {
      client = new SignalingClient('user1')
    })

    it('sends offer to peer', async () => {
      await client.connect('ws://localhost:8080/signaling')

      const offer: RTCSessionDescriptionInit = {
        type: 'offer',
        sdp: 'v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\n...',
      }

      const result = await client.sendOffer('user2', 'session123', offer)

      expect(result.sent).toBe(true)
    })
  })

  describe('sendAnswer', () => {
    let client: SignalingClient

    beforeEach(() => {
      client = new SignalingClient('user2')
    })

    it('sends answer to peer', async () => {
      await client.connect('ws://localhost:8080/signaling')

      const answer: RTCSessionDescriptionInit = {
        type: 'answer',
        sdp: 'v=0\r\no=- 789 012 IN IP4 127.0.0.1\r\n...',
      }

      const result = await client.sendAnswer('user1', 'session123', answer)

      expect(result.sent).toBe(true)
    })
  })

  describe('sendIceCandidate', () => {
    let client: SignalingClient

    beforeEach(() => {
      client = new SignalingClient('user1')
    })

    it('sends ICE candidate to peer', async () => {
      await client.connect('ws://localhost:8080/signaling')

      const candidate: RTCIceCandidateInit = {
        candidate: 'candidate:1 1 udp 2122260223 192.168.1.100 54321 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      }

      const result = await client.sendIceCandidate('user2', 'session123', candidate)

      expect(result.sent).toBe(true)
    })
  })

  describe('event handlers', () => {
    let client: SignalingClient

    beforeEach(() => {
      client = new SignalingClient('user1')
    })

    it('receives offer event', async () => {
      const offerReceived = vi.fn()
      client.on('offer', offerReceived)

      await client.connect('ws://localhost:8080/signaling')

      // Simulate receiving an offer (would come from server)
      client.emit('offer', {
        from: 'user2',
        session_id: 'session123',
        sdp: { type: 'offer', sdp: 'v=0\r\n...' },
      })

      expect(offerReceived).toHaveBeenCalled()
    })

    it('receives answer event', async () => {
      const answerReceived = vi.fn()
      client.on('answer', answerReceived)

      await client.connect('ws://localhost:8080/signaling')

      client.emit('answer', {
        from: 'user2',
        session_id: 'session123',
        sdp: { type: 'answer', sdp: 'v=0\r\n...' },
      })

      expect(answerReceived).toHaveBeenCalled()
    })

    it('receives ice-candidate event', async () => {
      const candidateReceived = vi.fn()
      client.on('ice-candidate', candidateReceived)

      await client.connect('ws://localhost:8080/signaling')

      client.emit('ice-candidate', {
        from: 'user2',
        session_id: 'session123',
        candidate: {
          candidate: 'candidate:1...',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      })

      expect(candidateReceived).toHaveBeenCalled()
    })

    it('receives hangup event', async () => {
      const hangupReceived = vi.fn()
      client.on('hangup', hangupReceived)

      await client.connect('ws://localhost:8080/signaling')

      client.emit('hangup', {
        from: 'user2',
        session_id: 'session123',
      })

      expect(hangupReceived).toHaveBeenCalled()
    })
  })

  describe('disconnect', () => {
    it('disconnects from signaling server', async () => {
      const client = new SignalingClient('user1')
      await client.connect('ws://localhost:8080/signaling')

      client.disconnect()

      expect(client.isConnected()).toBe(false)
    })
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

describe('validateOffer', () => {
  it('validates a valid offer', () => {
    const offer: RTCSessionDescriptionInit = {
      type: 'offer',
      sdp: 'v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=ice-ufrag:abc\r\na=ice-pwd:xyz\r\n',
    }

    const result = validateOffer(offer)

    expect(result.valid).toBe(true)
  })

  it('rejects offer without SDP', () => {
    const offer = {
      type: 'offer',
    } as RTCSessionDescriptionInit

    const result = validateOffer(offer)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('SDP')
  })

  it('rejects offer with wrong type', () => {
    const offer = {
      type: 'answer',
      sdp: 'v=0\r\n...',
    } as RTCSessionDescriptionInit

    const result = validateOffer(offer)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('type')
  })

  it('rejects offer with malformed SDP', () => {
    const offer: RTCSessionDescriptionInit = {
      type: 'offer',
      sdp: 'not valid sdp',
    }

    const result = validateOffer(offer)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('SDP')
  })
})

describe('validateAnswer', () => {
  it('validates a valid answer', () => {
    const answer: RTCSessionDescriptionInit = {
      type: 'answer',
      sdp: 'v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
    }

    const result = validateAnswer(answer)

    expect(result.valid).toBe(true)
  })

  it('rejects answer without SDP', () => {
    const answer = {
      type: 'answer',
    } as RTCSessionDescriptionInit

    const result = validateAnswer(answer)

    expect(result.valid).toBe(false)
  })

  it('rejects answer with wrong type', () => {
    const answer = {
      type: 'offer',
      sdp: 'v=0\r\n...',
    } as RTCSessionDescriptionInit

    const result = validateAnswer(answer)

    expect(result.valid).toBe(false)
  })
})

describe('validateIceCandidate', () => {
  it('validates a valid ICE candidate', () => {
    const candidate: RTCIceCandidateInit = {
      candidate: 'candidate:1 1 udp 2122260223 192.168.1.100 54321 typ host generation 0',
      sdpMid: '0',
      sdpMLineIndex: 0,
    }

    const result = validateIceCandidate(candidate)

    expect(result.valid).toBe(true)
  })

  it('rejects empty candidate', () => {
    const candidate: RTCIceCandidateInit = {
      candidate: '',
      sdpMid: '0',
      sdpMLineIndex: 0,
    }

    const result = validateIceCandidate(candidate)

    expect(result.valid).toBe(false)
  })

  it('accepts end-of-candidates signal', () => {
    const candidate: RTCIceCandidateInit = {
      candidate: '',
      sdpMid: null,
      sdpMLineIndex: null,
    }

    // End of candidates is signaled with empty candidate and null mid/index
    const result = validateIceCandidate(candidate, { allowEndOfCandidates: true })

    expect(result.valid).toBe(true)
  })
})

// ============================================================================
// Hono Router Tests
// ============================================================================

describe('createSignalingRouter', () => {
  it('creates a Hono router', () => {
    const router = createSignalingRouter()

    expect(router).toBeDefined()
  })

  it('handles POST /sessions endpoint', async () => {
    const router = createSignalingRouter()

    const request = new Request('http://localhost/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
      }),
    })

    const response = await router.fetch(request)

    expect(response.status).toBe(201)
    const body = await response.json() as { id: string }
    expect(body.id).toBeDefined()
  })

  it('handles GET /sessions/:id endpoint', async () => {
    const router = createSignalingRouter()

    // Create a session first
    const createRequest = new Request('http://localhost/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
      }),
    })

    const createResponse = await router.fetch(createRequest)
    const created = await createResponse.json() as { id: string }

    // Get the session
    const getRequest = new Request(`http://localhost/sessions/${created.id}`, {
      method: 'GET',
    })

    const getResponse = await router.fetch(getRequest)

    expect(getResponse.status).toBe(200)
    const session = await getResponse.json() as WebRTCSession
    expect(session.id).toBe(created.id)
  })

  it('handles POST /sessions/:id/join endpoint', async () => {
    const router = createSignalingRouter()

    // Create a session with an offer
    const createRequest = new Request('http://localhost/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
        offer: { type: 'offer', sdp: 'v=0\r\n...' },
      }),
    })

    const createResponse = await router.fetch(createRequest)
    const created = await createResponse.json() as { id: string }

    // Join the session
    const joinRequest = new Request(`http://localhost/sessions/${created.id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participant_id: 'user2',
        answer: { type: 'answer', sdp: 'v=0\r\n...' },
      }),
    })

    const joinResponse = await router.fetch(joinRequest)

    expect(joinResponse.status).toBe(200)
    const result = await joinResponse.json() as { success: boolean }
    expect(result.success).toBe(true)
  })

  it('handles POST /sessions/:id/signal endpoint', async () => {
    const router = createSignalingRouter()

    // Create a session
    const createRequest = new Request('http://localhost/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
        offer: { type: 'offer', sdp: 'v=0\r\n...' },
      }),
    })

    const createResponse = await router.fetch(createRequest)
    const created = await createResponse.json() as { id: string }

    // Send a signal (ICE candidate)
    const signalRequest = new Request(`http://localhost/sessions/${created.id}/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ice-candidate',
        from: 'user1',
        to: 'user2',
        candidate: {
          candidate: 'candidate:1...',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      }),
    })

    const signalResponse = await router.fetch(signalRequest)

    expect(signalResponse.status).toBe(200)
  })

  it('handles DELETE /sessions/:id endpoint', async () => {
    const router = createSignalingRouter()

    // Create a session
    const createRequest = new Request('http://localhost/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
      }),
    })

    const createResponse = await router.fetch(createRequest)
    const created = await createResponse.json() as { id: string }

    // End the session
    const deleteRequest = new Request(`http://localhost/sessions/${created.id}`, {
      method: 'DELETE',
      headers: { 'X-User-Id': 'user1' },
    })

    const deleteResponse = await router.fetch(deleteRequest)

    expect(deleteResponse.status).toBe(200)
  })

  it('handles GET /sessions/:id/candidates endpoint', async () => {
    const router = createSignalingRouter()

    // Create a session
    const createRequest = new Request('http://localhost/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initiator_id: 'user1',
        participant_ids: ['user2'],
        type: 'video',
        offer: { type: 'offer', sdp: 'v=0\r\n...' },
      }),
    })

    const createResponse = await router.fetch(createRequest)
    const created = await createResponse.json() as { id: string }

    // Get candidates
    const candidatesRequest = new Request(`http://localhost/sessions/${created.id}/candidates?for=user2`, {
      method: 'GET',
    })

    const candidatesResponse = await router.fetch(candidatesRequest)

    expect(candidatesResponse.status).toBe(200)
    const candidates = await candidatesResponse.json() as RTCIceCandidateInit[]
    expect(Array.isArray(candidates)).toBe(true)
  })

  it('returns 404 for non-existent session', async () => {
    const router = createSignalingRouter()

    const request = new Request('http://localhost/sessions/nonexistent', {
      method: 'GET',
    })

    const response = await router.fetch(request)

    expect(response.status).toBe(404)
  })
})
