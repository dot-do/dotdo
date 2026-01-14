/**
 * @dotdo/calls - Voice and Video Calling Service
 *
 * Voice/video calling with Twilio API compatibility and WebRTC signaling.
 *
 * Features:
 * - Twilio-compatible voice API (POST /Calls, TwiML responses)
 * - WebRTC signaling for video calls (offer/answer/ICE candidates)
 * - Call state management via Durable Objects
 * - Recording storage on R2
 * - Real-time signaling via WebSocket
 *
 * @example Twilio-compatible Voice API
 * ```typescript
 * import { TwilioClient } from '@dotdo/calls'
 *
 * const client = new TwilioClient({
 *   accountSid: 'AC123',
 *   authToken: 'token123',
 * })
 *
 * // Make an outbound call
 * const call = await client.calls.create({
 *   to: '+14155551234',
 *   from: '+14155559876',
 *   url: 'https://example.com/twiml',
 * })
 *
 * // Or with inline TwiML
 * const call = await client.calls.create({
 *   to: '+14155551234',
 *   from: '+14155559876',
 *   twiml: '<Response><Say>Hello World</Say></Response>',
 * })
 * ```
 *
 * @example TwiML Builder
 * ```typescript
 * import { TwiMLBuilder } from '@dotdo/calls'
 *
 * const builder = new TwiMLBuilder()
 * builder
 *   .say('Welcome to our service!', { voice: 'alice' })
 *   .gather({
 *     action: '/handle-input',
 *     num_digits: 1,
 *   }, (gather) => {
 *     gather.say('Press 1 for sales, 2 for support')
 *   })
 *   .say('We did not receive any input. Goodbye!')
 *   .hangup()
 *
 * const twiml = builder.build()
 * // Returns: <?xml version="1.0" encoding="UTF-8"?>
 * // <Response>
 * //   <Say voice="alice">Welcome to our service!</Say>
 * //   <Gather action="/handle-input" numDigits="1">
 * //     <Say>Press 1 for sales, 2 for support</Say>
 * //   </Gather>
 * //   <Say>We did not receive any input. Goodbye!</Say>
 * //   <Hangup />
 * // </Response>
 * ```
 *
 * @example WebRTC Signaling
 * ```typescript
 * import { SignalingClient, SessionManager } from '@dotdo/calls'
 *
 * // Create a session manager
 * const manager = new SessionManager()
 *
 * // Create a new video call session
 * const session = await manager.createSession({
 *   initiator_id: 'user1',
 *   participant_ids: ['user2'],
 *   type: 'video',
 * })
 *
 * // Connect a client for real-time signaling
 * const client = new SignalingClient('user1')
 * await client.connect('wss://calls.do/signaling')
 *
 * // Handle incoming offers
 * client.on('offer', async ({ from, session_id, sdp }) => {
 *   const peerConnection = new RTCPeerConnection()
 *   await peerConnection.setRemoteDescription(sdp)
 *   const answer = await peerConnection.createAnswer()
 *   await peerConnection.setLocalDescription(answer)
 *   await client.sendAnswer(from, session_id, answer)
 * })
 *
 * // Handle incoming ICE candidates
 * client.on('ice-candidate', async ({ from, session_id, candidate }) => {
 *   await peerConnection.addIceCandidate(candidate)
 * })
 * ```
 *
 * @example Hono Integration
 * ```typescript
 * import { Hono } from 'hono'
 * import { createVoiceRouter, createSignalingRouter } from '@dotdo/calls'
 *
 * const app = new Hono()
 *
 * // Mount Twilio-compatible voice API
 * app.route('/voice', createVoiceRouter())
 *
 * // Mount WebRTC signaling API
 * app.route('/signaling', createSignalingRouter())
 *
 * export default app
 * ```
 *
 * @example Durable Object
 * ```typescript
 * import { CallDO } from '@dotdo/calls'
 *
 * // In wrangler.toml:
 * // [[durable_objects.bindings]]
 * // name = "CALL_DO"
 * // class_name = "CallDO"
 *
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const url = new URL(request.url)
 *     const callId = url.pathname.split('/')[2]
 *     const id = env.CALL_DO.idFromName(callId)
 *     const stub = env.CALL_DO.get(id)
 *     return stub.fetch(request)
 *   }
 * }
 *
 * export { CallDO }
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Common types
  CallStatus,
  CallDirection,
  CallParticipant,

  // Voice call types
  VoiceCall,
  MakeCallRequest,
  MakeCallResponse,
  StatusCallbackEvent,

  // TwiML types
  TwiMLResponse,
  TwiMLSay,
  TwiMLPlay,
  TwiMLGather,
  TwiMLDial,
  TwiMLRecord,
  TwiMLHangup,
  TwiMLRedirect,
  TwiMLPause,
  TwiMLReject,
  TwiMLInstruction,

  // Webhook types
  VoiceWebhookPayload,
  StatusCallbackPayload,

  // WebRTC types
  SignalingMessageType,
  SignalingMessage,
  RTCSessionDescriptionInit,
  RTCIceCandidateInit,
  WebRTCSession,
  CreateSessionRequest,
  CreateSessionResponse,
  JoinSessionRequest,
  JoinSessionResponse,

  // Recording types
  Recording,

  // Provider types
  CallProvider,
  CallProviderConfig,

  // Error types
  CallError,
  CallErrorResponse,
} from './types'

// ============================================================================
// Twilio Compatibility
// ============================================================================

export {
  TwilioClient,
  CallsResource,
  validateMakeCallRequest,
  TwiMLBuilder,
  parseTwiML,
  parseVoiceWebhook,
  createVoiceRouter,
} from './twilio-compat'

export type {
  TwilioClientConfig,
  ValidationResult as TwilioValidationResult,
  VoiceEnv,
} from './twilio-compat'

// ============================================================================
// WebRTC Signaling
// ============================================================================

export {
  SignalingServer,
  SessionManager,
  SignalingClient,
  validateOffer,
  validateAnswer,
  validateIceCandidate,
  createSignalingRouter,
} from './webrtc-signaling'

export type {
  HandleMessageResult,
  ValidationResult as SignalingValidationResult,
  SignalingEnv,
} from './webrtc-signaling'

// ============================================================================
// Durable Object
// ============================================================================

export { CallDO } from './CallDO'

// ============================================================================
// Default Export
// ============================================================================

import { TwilioClient as _TwilioClient } from './twilio-compat'
export { _TwilioClient as default }
