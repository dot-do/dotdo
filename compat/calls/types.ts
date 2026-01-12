/**
 * @dotdo/calls - Voice and Video Calling Service Types
 *
 * Type definitions for Twilio voice API compatibility and WebRTC signaling.
 */

// ============================================================================
// Common Types
// ============================================================================

export type CallStatus =
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled'

export type CallDirection = 'inbound' | 'outbound'

export interface CallParticipant {
  /** Phone number or SIP URI */
  address: string
  /** Display name */
  name?: string
  /** Participant type */
  type: 'phone' | 'sip' | 'client'
}

// ============================================================================
// Voice Call Types (Twilio-compatible)
// ============================================================================

export interface VoiceCall {
  /** Unique call identifier */
  sid: string
  /** Account SID */
  account_sid: string
  /** Parent call SID (for child legs) */
  parent_call_sid?: string
  /** From address */
  from: string
  /** To address */
  to: string
  /** Call direction */
  direction: CallDirection
  /** Call status */
  status: CallStatus
  /** Start time */
  start_time?: Date
  /** End time */
  end_time?: Date
  /** Call duration in seconds */
  duration?: number
  /** Price of the call */
  price?: string
  /** Price unit (e.g., 'USD') */
  price_unit?: string
  /** Caller name (CNAM) */
  caller_name?: string
  /** Forwarded from number */
  forwarded_from?: string
  /** Recording SID if recording enabled */
  recording_sid?: string
  /** URL for status callbacks */
  status_callback?: string
  /** HTTP method for status callbacks */
  status_callback_method?: 'GET' | 'POST'
  /** Answering machine detection result */
  answered_by?: 'human' | 'machine_start' | 'machine_end_beep' | 'machine_end_silence' | 'machine_end_other' | 'fax' | 'unknown'
  /** Created timestamp */
  created_at: Date
  /** Updated timestamp */
  updated_at: Date
}

export interface MakeCallRequest {
  /** Phone number or SIP URI to call */
  to: string
  /** Caller ID (from number) */
  from: string
  /** TwiML URL to fetch instructions */
  url?: string
  /** TwiML instructions (alternative to url) */
  twiml?: string
  /** HTTP method for TwiML URL */
  method?: 'GET' | 'POST'
  /** URL for status callbacks */
  status_callback?: string
  /** HTTP method for status callbacks */
  status_callback_method?: 'GET' | 'POST'
  /** Events to receive callbacks for */
  status_callback_event?: StatusCallbackEvent[]
  /** Timeout in seconds before giving up */
  timeout?: number
  /** Caller ID name */
  caller_id?: string
  /** Enable answering machine detection */
  machine_detection?: 'Enable' | 'DetectMessageEnd'
  /** Timeout for machine detection */
  machine_detection_timeout?: number
  /** Whether to record the call */
  record?: boolean
  /** Recording channels */
  recording_channels?: 'mono' | 'dual'
  /** Recording status callback URL */
  recording_status_callback?: string
  /** Recording status callback events */
  recording_status_callback_event?: ('in-progress' | 'completed' | 'absent')[]
  /** Async AMD result callback URL */
  async_amd_status_callback?: string
  /** SIP authentication username */
  sip_auth_username?: string
  /** SIP authentication password */
  sip_auth_password?: string
}

export type StatusCallbackEvent =
  | 'initiated'
  | 'ringing'
  | 'answered'
  | 'completed'

export interface MakeCallResponse {
  sid: string
  account_sid: string
  from: string
  to: string
  status: CallStatus
  direction: 'outbound-api'
  created_at: Date
}

// ============================================================================
// TwiML Types
// ============================================================================

export interface TwiMLResponse {
  /** Raw TwiML XML content */
  xml: string
}

export interface TwiMLSay {
  /** Text to speak */
  text: string
  /** Voice to use */
  voice?: 'alice' | 'man' | 'woman' | string
  /** Language code */
  language?: string
  /** Number of times to loop */
  loop?: number
}

export interface TwiMLPlay {
  /** URL of audio file */
  url: string
  /** Number of times to loop */
  loop?: number
  /** Digits to play (DTMF tones) */
  digits?: string
}

export interface TwiMLGather {
  /** TwiML to execute while gathering */
  nested?: TwiMLInstruction[]
  /** URL to submit gathered digits */
  action?: string
  /** HTTP method for action URL */
  method?: 'GET' | 'POST'
  /** Timeout in seconds */
  timeout?: number
  /** Finish gathering on this key */
  finish_on_key?: string
  /** Number of digits to gather */
  num_digits?: number
  /** Input types to accept */
  input?: ('dtmf' | 'speech')[]
  /** Hints for speech recognition */
  hints?: string
  /** Speech timeout */
  speech_timeout?: number | 'auto'
  /** Language for speech recognition */
  language?: string
  /** Partial results callback */
  partial_result_callback?: string
}

export interface TwiMLDial {
  /** Number or SIP URI to dial */
  number?: string
  /** Client to dial */
  client?: string
  /** SIP URI to dial */
  sip?: string
  /** Conference name */
  conference?: string
  /** Queue name */
  queue?: string
  /** Action URL after dial completes */
  action?: string
  /** HTTP method for action */
  method?: 'GET' | 'POST'
  /** Timeout in seconds */
  timeout?: number
  /** Hangup on star key */
  hangup_on_star?: boolean
  /** Time limit in seconds */
  time_limit?: number
  /** Caller ID */
  caller_id?: string
  /** Record the call */
  record?: 'do-not-record' | 'record-from-answer' | 'record-from-ringing' | 'record-from-answer-dual' | 'record-from-ringing-dual'
  /** Ring tone */
  ring_tone?: string
  /** Callback URL for recording */
  recording_status_callback?: string
}

export interface TwiMLRecord {
  /** Action URL after recording */
  action?: string
  /** HTTP method for action */
  method?: 'GET' | 'POST'
  /** Maximum recording length in seconds */
  max_length?: number
  /** Play beep before recording */
  play_beep?: boolean
  /** Finish recording on this key */
  finish_on_key?: string
  /** Timeout in seconds of silence before stopping */
  timeout?: number
  /** Transcribe the recording */
  transcribe?: boolean
  /** Callback URL for transcription */
  transcribe_callback?: string
  /** Recording status callback URL */
  recording_status_callback?: string
}

export interface TwiMLHangup {}

export interface TwiMLRedirect {
  /** URL to redirect to */
  url: string
  /** HTTP method */
  method?: 'GET' | 'POST'
}

export interface TwiMLPause {
  /** Pause length in seconds */
  length?: number
}

export interface TwiMLReject {
  /** Rejection reason */
  reason?: 'rejected' | 'busy'
}

export type TwiMLInstruction =
  | { type: 'Say'; params: TwiMLSay }
  | { type: 'Play'; params: TwiMLPlay }
  | { type: 'Gather'; params: TwiMLGather }
  | { type: 'Dial'; params: TwiMLDial }
  | { type: 'Record'; params: TwiMLRecord }
  | { type: 'Hangup'; params: TwiMLHangup }
  | { type: 'Redirect'; params: TwiMLRedirect }
  | { type: 'Pause'; params: TwiMLPause }
  | { type: 'Reject'; params: TwiMLReject }

// ============================================================================
// Webhook Types
// ============================================================================

export interface VoiceWebhookPayload {
  /** Call SID */
  CallSid: string
  /** Account SID */
  AccountSid: string
  /** From number */
  From: string
  /** To number */
  To: string
  /** Call status */
  CallStatus: CallStatus
  /** Direction */
  Direction: CallDirection
  /** API version */
  ApiVersion: string
  /** Caller name (CNAM) */
  CallerName?: string
  /** Forwarded from */
  ForwardedFrom?: string
  /** Parent call SID */
  ParentCallSid?: string
  /** Gathered digits */
  Digits?: string
  /** Speech result */
  SpeechResult?: string
  /** Confidence score for speech */
  Confidence?: string
  /** Recording URL */
  RecordingUrl?: string
  /** Recording SID */
  RecordingSid?: string
  /** Recording duration */
  RecordingDuration?: string
  /** Call duration */
  CallDuration?: string
  /** Answered by (AMD result) */
  AnsweredBy?: string
}

export interface StatusCallbackPayload extends VoiceWebhookPayload {
  /** Sequence number */
  SequenceNumber?: string
  /** Timestamp */
  Timestamp?: string
}

// ============================================================================
// WebRTC Signaling Types
// ============================================================================

export type SignalingMessageType =
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'hangup'
  | 'renegotiate'
  | 'mute'
  | 'unmute'
  | 'video-on'
  | 'video-off'

export interface RTCSessionDescriptionInit {
  type: 'offer' | 'answer'
  sdp: string
}

export interface RTCIceCandidateInit {
  candidate: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export interface SignalingMessage {
  /** Message type */
  type: SignalingMessageType
  /** Sender ID */
  from: string
  /** Recipient ID */
  to: string
  /** Call/session ID */
  session_id: string
  /** SDP for offer/answer */
  sdp?: RTCSessionDescriptionInit
  /** ICE candidate */
  candidate?: RTCIceCandidateInit
  /** Timestamp */
  timestamp: Date
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

export interface WebRTCSession {
  /** Session ID */
  id: string
  /** Initiator ID */
  initiator_id: string
  /** Participant IDs */
  participant_ids: string[]
  /** Session status */
  status: 'pending' | 'connecting' | 'connected' | 'disconnected' | 'failed'
  /** Session type */
  type: 'audio' | 'video' | 'screen-share'
  /** Start time */
  start_time?: Date
  /** End time */
  end_time?: Date
  /** Current offer SDP */
  offer?: RTCSessionDescriptionInit
  /** Current answer SDP */
  answer?: RTCSessionDescriptionInit
  /** Pending ICE candidates */
  ice_candidates: RTCIceCandidateInit[]
  /** Created timestamp */
  created_at: Date
  /** Updated timestamp */
  updated_at: Date
}

export interface CreateSessionRequest {
  /** Initiator ID */
  initiator_id: string
  /** Target participant IDs */
  participant_ids: string[]
  /** Session type */
  type: 'audio' | 'video' | 'screen-share'
  /** Optional initial offer */
  offer?: RTCSessionDescriptionInit
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

export interface CreateSessionResponse {
  /** Session ID */
  id: string
  /** Session status */
  status: 'pending'
  /** Created timestamp */
  created_at: Date
}

export interface JoinSessionRequest {
  /** Participant ID joining */
  participant_id: string
  /** Answer SDP */
  answer?: RTCSessionDescriptionInit
}

export interface JoinSessionResponse {
  /** Success indicator */
  success: boolean
  /** Session details */
  session: WebRTCSession
}

// ============================================================================
// Recording Types
// ============================================================================

export interface Recording {
  /** Recording SID */
  sid: string
  /** Account SID */
  account_sid: string
  /** Call SID */
  call_sid: string
  /** Conference SID if from conference */
  conference_sid?: string
  /** Recording status */
  status: 'in-progress' | 'completed' | 'absent' | 'failed'
  /** Duration in seconds */
  duration?: number
  /** Recording channels */
  channels: number
  /** Recording source */
  source: 'DialVerb' | 'RecordVerb' | 'Conference' | 'OutboundAPI'
  /** Error code if failed */
  error_code?: number
  /** Media URL */
  media_url?: string
  /** Storage location (R2 key) */
  storage_key?: string
  /** Created timestamp */
  created_at: Date
  /** Updated timestamp */
  updated_at: Date
}

// ============================================================================
// Provider Types
// ============================================================================

export type CallProvider = 'twilio' | 'vonage' | 'plivo' | 'bandwidth' | 'telnyx' | 'signalwire'

export interface CallProviderConfig {
  provider: CallProvider
  account_sid?: string
  auth_token?: string
  api_key?: string
  api_secret?: string
  enabled?: boolean
  priority?: number
}

// ============================================================================
// Error Types
// ============================================================================

export interface CallError {
  code: number
  message: string
  more_info?: string
  status?: number
}

export interface CallErrorResponse {
  error: CallError
}
