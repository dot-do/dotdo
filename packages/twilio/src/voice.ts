/**
 * @dotdo/twilio/voice - Twilio Voice API Compatibility Layer
 *
 * Complete Twilio Voice API implementation with TwiML builder, call control,
 * recording management, and conference support.
 *
 * @example Making Outbound Calls
 * ```typescript
 * import { VoiceClient } from '@dotdo/twilio/voice'
 *
 * const voice = new VoiceClient({
 *   accountSid: 'AC...',
 *   authToken: 'token',
 * })
 *
 * // Make a call with URL
 * const call = await voice.calls.create({
 *   to: '+15558675310',
 *   from: '+15017122661',
 *   url: 'https://example.com/twiml',
 * })
 *
 * // Make a call with inline TwiML
 * const call = await voice.calls.create({
 *   to: '+15558675310',
 *   from: '+15017122661',
 *   twiml: '<Response><Say>Hello!</Say></Response>',
 * })
 * ```
 *
 * @example TwiML Response Builder
 * ```typescript
 * import { VoiceResponse } from '@dotdo/twilio/voice'
 *
 * const response = new VoiceResponse()
 * response.say('Welcome!', { voice: 'Polly.Joanna' })
 * response.gather({
 *   action: '/handle-key',
 *   numDigits: 1,
 * }).say('Press 1 for sales, 2 for support')
 * response.say('We did not receive any input. Goodbye!')
 *
 * const xml = response.toString()
 * ```
 *
 * @example Conference Calls
 * ```typescript
 * const response = new VoiceResponse()
 * const dial = response.dial()
 * dial.conference('MyRoom', {
 *   startConferenceOnEnter: true,
 *   endConferenceOnExit: false,
 *   waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical',
 * })
 * ```
 *
 * @module @dotdo/twilio/voice
 */

import type {
  Call,
  CallCreateParams,
  CallListParams,
  CallUpdateParams,
  CallStatus,
  TwilioClientConfig,
  TwilioErrorResponse,
  ListResponse,
} from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Voice-specific call creation parameters
 */
export interface VoiceCallCreateParams extends CallCreateParams {
  /** Application SID for routing */
  applicationSid?: string
  /** Byoc trunk SID */
  byoc?: string
  /** Caller ID name */
  callerIdName?: string
}

/**
 * Recording resource
 */
export interface Recording {
  sid: string
  accountSid: string
  callSid: string
  conferenceSid?: string
  dateCreated: string
  dateUpdated: string
  startTime: string
  duration: string
  source: 'DialVerb' | 'RecordVerb' | 'Conference' | 'OutboundAPI' | 'StartCallRecordingAPI'
  channels: number
  price?: string
  priceUnit?: string
  status: 'in-progress' | 'paused' | 'stopped' | 'processing' | 'completed' | 'absent' | 'deleted'
  errorCode?: number
  encryptionDetails?: {
    encryptionType: string
    publicKeySid: string
  }
  uri: string
  mediaUrl?: string
}

/**
 * Recording create parameters
 */
export interface RecordingCreateParams {
  /** Recording channels */
  recordingChannels?: 'mono' | 'dual'
  /** Recording status callback URL */
  recordingStatusCallback?: string
  /** Recording status callback method */
  recordingStatusCallbackMethod?: 'GET' | 'POST'
  /** Recording status callback events */
  recordingStatusCallbackEvent?: ('in-progress' | 'completed' | 'absent')[]
  /** Trim silence from recording */
  trim?: 'trim-silence' | 'do-not-trim'
  /** Recording track */
  recordingTrack?: 'inbound' | 'outbound' | 'both'
}

/**
 * Recording update parameters
 */
export interface RecordingUpdateParams {
  /** Pause or resume recording */
  status: 'paused' | 'in-progress' | 'stopped'
  /** Pause behavior */
  pauseBehavior?: 'skip' | 'silence'
}

/**
 * Conference resource
 */
export interface Conference {
  sid: string
  accountSid: string
  friendlyName: string
  status: 'init' | 'in-progress' | 'completed'
  dateCreated: string
  dateUpdated: string
  region: string
  reasonConferenceEnded?: string
  callSidEndingConference?: string
  uri: string
}

/**
 * Conference participant
 */
export interface Participant {
  callSid: string
  conferenceSid: string
  accountSid: string
  dateCreated: string
  dateUpdated: string
  startConferenceOnEnter: boolean
  endConferenceOnExit: boolean
  muted: boolean
  hold: boolean
  coaching: boolean
  callSidToCoach?: string
  label?: string
  status: 'queued' | 'connecting' | 'ringing' | 'connected' | 'complete' | 'failed'
  uri: string
}

/**
 * Participant update parameters
 */
export interface ParticipantUpdateParams {
  muted?: boolean
  hold?: boolean
  holdUrl?: string
  holdMethod?: 'GET' | 'POST'
  announceUrl?: string
  announceMethod?: 'GET' | 'POST'
  beepOnExit?: boolean
  endConferenceOnExit?: boolean
  coaching?: boolean
  callSidToCoach?: string
}

/**
 * Voice webhook payload
 */
export interface VoiceWebhookPayload {
  CallSid: string
  AccountSid: string
  From: string
  To: string
  CallStatus: CallStatus
  ApiVersion: string
  Direction: 'inbound' | 'outbound-api' | 'outbound-dial'
  ForwardedFrom?: string
  CallerName?: string
  ParentCallSid?: string
  // Gather results
  Digits?: string
  FinishedOnKey?: string
  // Speech results
  SpeechResult?: string
  Confidence?: string
  // Recording results
  RecordingUrl?: string
  RecordingSid?: string
  RecordingDuration?: string
  RecordingStatus?: string
  // Status callback specific
  CallDuration?: string
  Timestamp?: string
  SequenceNumber?: string
  Duration?: string
  // SIP specific
  SipResponseCode?: string
  SipCallId?: string
  // Answering machine detection
  AnsweredBy?: 'human' | 'machine_start' | 'machine_end_beep' | 'machine_end_silence' | 'machine_end_other' | 'fax' | 'unknown'
  MachineDetectionDuration?: string
}

/**
 * Recording status callback payload
 */
export interface RecordingStatusCallbackPayload {
  AccountSid: string
  CallSid: string
  RecordingSid: string
  RecordingUrl: string
  RecordingStatus: 'in-progress' | 'completed' | 'absent'
  RecordingDuration?: string
  RecordingChannels?: string
  RecordingSource?: string
  RecordingStartTime?: string
  RecordingTrack?: string
  ErrorCode?: string
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Voice API Error
 */
export class VoiceAPIError extends Error {
  code: number
  status: number
  moreInfo: string

  constructor(response: TwilioErrorResponse) {
    super(response.message)
    this.name = 'VoiceAPIError'
    this.code = response.code
    this.status = response.status
    this.moreInfo = response.more_info
  }
}

// =============================================================================
// TwiML Response Builder
// =============================================================================

/**
 * Base class for TwiML elements
 */
abstract class TwiMLElement {
  protected tagName: string
  protected attributes: Map<string, string | number | boolean>
  protected children: (TwiMLElement | string)[]
  protected textContent?: string

  constructor(tagName: string) {
    this.tagName = tagName
    this.attributes = new Map()
    this.children = []
  }

  protected setAttribute(name: string, value: string | number | boolean | undefined): void {
    if (value !== undefined) {
      this.attributes.set(name, value)
    }
  }

  protected addChild(child: TwiMLElement | string): void {
    this.children.push(child)
  }

  protected setTextContent(text: string): void {
    this.textContent = text
  }

  toString(): string {
    const attrs = Array.from(this.attributes.entries())
      .map(([k, v]) => `${k}="${escapeXml(String(v))}"`)
      .join(' ')

    const attrStr = attrs ? ` ${attrs}` : ''

    if (this.textContent !== undefined && this.children.length === 0) {
      return `<${this.tagName}${attrStr}>${escapeXml(this.textContent)}</${this.tagName}>`
    }

    if (this.children.length === 0 && this.textContent === undefined) {
      return `<${this.tagName}${attrStr}/>`
    }

    const childStr = this.children
      .map((c) => (typeof c === 'string' ? escapeXml(c) : c.toString()))
      .join('')

    const text = this.textContent !== undefined ? escapeXml(this.textContent) : ''
    return `<${this.tagName}${attrStr}>${text}${childStr}</${this.tagName}>`
  }
}

/**
 * Say TwiML verb options
 */
export interface SayOptions {
  voice?: 'alice' | 'man' | 'woman' | 'Polly.Joanna' | 'Polly.Matthew' | 'Polly.Amy' | 'Polly.Brian' | string
  language?: string
  loop?: number
}

/**
 * Play TwiML verb options
 */
export interface PlayOptions {
  loop?: number
  digits?: string
}

/**
 * Pause TwiML verb options
 */
export interface PauseOptions {
  length?: number
}

/**
 * Gather TwiML verb options
 */
export interface GatherOptions {
  action?: string
  method?: 'GET' | 'POST'
  timeout?: number
  finishOnKey?: string
  numDigits?: number
  input?: 'dtmf' | 'speech' | 'dtmf speech'
  hints?: string
  speechTimeout?: number | 'auto'
  speechModel?: 'default' | 'numbers_and_commands' | 'phone_call'
  enhanced?: boolean
  language?: string
  profanityFilter?: boolean
  actionOnEmptyResult?: boolean
  partialResultCallback?: string
  partialResultCallbackMethod?: 'GET' | 'POST'
  bargeIn?: boolean
}

/**
 * Record TwiML verb options
 */
export interface RecordOptions {
  action?: string
  method?: 'GET' | 'POST'
  timeout?: number
  finishOnKey?: string
  maxLength?: number
  playBeep?: boolean
  trim?: 'trim-silence' | 'do-not-trim'
  recordingStatusCallback?: string
  recordingStatusCallbackMethod?: 'GET' | 'POST'
  recordingStatusCallbackEvent?: string
  transcribe?: boolean
  transcribeCallback?: string
}

/**
 * Dial TwiML verb options
 */
export interface DialOptions {
  action?: string
  method?: 'GET' | 'POST'
  timeout?: number
  hangupOnStar?: boolean
  timeLimit?: number
  callerId?: string
  callerIdName?: string
  record?: 'do-not-record' | 'record-from-answer' | 'record-from-ringing' | 'record-from-answer-dual' | 'record-from-ringing-dual'
  trim?: 'trim-silence' | 'do-not-trim'
  recordingStatusCallback?: string
  recordingStatusCallbackMethod?: 'GET' | 'POST'
  recordingStatusCallbackEvent?: string
  answerOnBridge?: boolean
  ringTone?: string
  referUrl?: string
  referMethod?: 'GET' | 'POST'
}

/**
 * Number noun options (within Dial)
 */
export interface NumberOptions {
  sendDigits?: string
  url?: string
  method?: 'GET' | 'POST'
  statusCallback?: string
  statusCallbackMethod?: 'GET' | 'POST'
  statusCallbackEvent?: string
  byoc?: string
  machineDetection?: 'Enable' | 'DetectMessageEnd'
  machineDetectionTimeout?: number
  machineDetectionSpeechThreshold?: number
  machineDetectionSpeechEndThreshold?: number
  machineDetectionSilenceTimeout?: number
  amdStatusCallback?: string
  amdStatusCallbackMethod?: 'GET' | 'POST'
}

/**
 * Client noun options (within Dial)
 */
export interface ClientOptions {
  url?: string
  method?: 'GET' | 'POST'
  statusCallback?: string
  statusCallbackMethod?: 'GET' | 'POST'
  statusCallbackEvent?: string
}

/**
 * SIP noun options (within Dial)
 */
export interface SipOptions {
  username?: string
  password?: string
  url?: string
  method?: 'GET' | 'POST'
  statusCallback?: string
  statusCallbackMethod?: 'GET' | 'POST'
  statusCallbackEvent?: string
  machineDetection?: 'Enable' | 'DetectMessageEnd'
  machineDetectionTimeout?: number
  machineDetectionSpeechThreshold?: number
  machineDetectionSpeechEndThreshold?: number
  machineDetectionSilenceTimeout?: number
  amdStatusCallback?: string
  amdStatusCallbackMethod?: 'GET' | 'POST'
}

/**
 * Conference noun options (within Dial)
 */
export interface ConferenceOptions {
  muted?: boolean
  beep?: boolean | 'true' | 'false' | 'onEnter' | 'onExit'
  startConferenceOnEnter?: boolean
  endConferenceOnExit?: boolean
  waitUrl?: string
  waitMethod?: 'GET' | 'POST'
  maxParticipants?: number
  record?: 'do-not-record' | 'record-from-start'
  region?: string
  coach?: string
  trim?: 'trim-silence' | 'do-not-trim'
  statusCallback?: string
  statusCallbackMethod?: 'GET' | 'POST'
  statusCallbackEvent?: string
  recordingStatusCallback?: string
  recordingStatusCallbackMethod?: 'GET' | 'POST'
  recordingStatusCallbackEvent?: string
  eventCallbackUrl?: string
  jitterBufferSize?: 'off' | 'small' | 'medium' | 'large'
  participantLabel?: string
}

/**
 * Queue noun options (within Dial)
 */
export interface QueueOptions {
  url?: string
  method?: 'GET' | 'POST'
  reservationSid?: string
  postWorkActivitySid?: string
}

/**
 * Redirect TwiML verb options
 */
export interface RedirectOptions {
  method?: 'GET' | 'POST'
}

/**
 * Reject TwiML verb options
 */
export interface RejectOptions {
  reason?: 'rejected' | 'busy'
}

/**
 * Enqueue TwiML verb options
 */
export interface EnqueueOptions {
  action?: string
  method?: 'GET' | 'POST'
  waitUrl?: string
  waitUrlMethod?: 'GET' | 'POST'
  workflowSid?: string
}

/**
 * Leave TwiML verb (no options)
 */
export interface LeaveOptions {}

/**
 * Hangup TwiML verb (no options)
 */
export interface HangupOptions {}

/**
 * Say TwiML element
 */
class Say extends TwiMLElement {
  constructor(text: string, options?: SayOptions) {
    super('Say')
    this.setTextContent(text)
    if (options) {
      this.setAttribute('voice', options.voice)
      this.setAttribute('language', options.language)
      this.setAttribute('loop', options.loop)
    }
  }
}

/**
 * Play TwiML element
 */
class Play extends TwiMLElement {
  constructor(url?: string, options?: PlayOptions) {
    super('Play')
    if (url) {
      this.setTextContent(url)
    }
    if (options) {
      this.setAttribute('loop', options.loop)
      this.setAttribute('digits', options.digits)
    }
  }
}

/**
 * Pause TwiML element
 */
class Pause extends TwiMLElement {
  constructor(options?: PauseOptions) {
    super('Pause')
    if (options) {
      this.setAttribute('length', options.length)
    }
  }
}

/**
 * Gather TwiML element with nested verbs
 */
class Gather extends TwiMLElement {
  constructor(options?: GatherOptions) {
    super('Gather')
    if (options) {
      this.setAttribute('action', options.action)
      this.setAttribute('method', options.method)
      this.setAttribute('timeout', options.timeout)
      this.setAttribute('finishOnKey', options.finishOnKey)
      this.setAttribute('numDigits', options.numDigits)
      this.setAttribute('input', options.input)
      this.setAttribute('hints', options.hints)
      this.setAttribute('speechTimeout', options.speechTimeout)
      this.setAttribute('speechModel', options.speechModel)
      this.setAttribute('enhanced', options.enhanced)
      this.setAttribute('language', options.language)
      this.setAttribute('profanityFilter', options.profanityFilter)
      this.setAttribute('actionOnEmptyResult', options.actionOnEmptyResult)
      this.setAttribute('partialResultCallback', options.partialResultCallback)
      this.setAttribute('partialResultCallbackMethod', options.partialResultCallbackMethod)
      this.setAttribute('bargeIn', options.bargeIn)
    }
  }

  say(text: string, options?: SayOptions): this {
    this.addChild(new Say(text, options))
    return this
  }

  play(url?: string, options?: PlayOptions): this {
    this.addChild(new Play(url, options))
    return this
  }

  pause(options?: PauseOptions): this {
    this.addChild(new Pause(options))
    return this
  }
}

/**
 * Record TwiML element
 */
class RecordVerb extends TwiMLElement {
  constructor(options?: RecordOptions) {
    super('Record')
    if (options) {
      this.setAttribute('action', options.action)
      this.setAttribute('method', options.method)
      this.setAttribute('timeout', options.timeout)
      this.setAttribute('finishOnKey', options.finishOnKey)
      this.setAttribute('maxLength', options.maxLength)
      this.setAttribute('playBeep', options.playBeep)
      this.setAttribute('trim', options.trim)
      this.setAttribute('recordingStatusCallback', options.recordingStatusCallback)
      this.setAttribute('recordingStatusCallbackMethod', options.recordingStatusCallbackMethod)
      this.setAttribute('recordingStatusCallbackEvent', options.recordingStatusCallbackEvent)
      this.setAttribute('transcribe', options.transcribe)
      this.setAttribute('transcribeCallback', options.transcribeCallback)
    }
  }
}

/**
 * Number noun element
 */
class NumberNoun extends TwiMLElement {
  constructor(phoneNumber: string, options?: NumberOptions) {
    super('Number')
    this.setTextContent(phoneNumber)
    if (options) {
      this.setAttribute('sendDigits', options.sendDigits)
      this.setAttribute('url', options.url)
      this.setAttribute('method', options.method)
      this.setAttribute('statusCallback', options.statusCallback)
      this.setAttribute('statusCallbackMethod', options.statusCallbackMethod)
      this.setAttribute('statusCallbackEvent', options.statusCallbackEvent)
      this.setAttribute('byoc', options.byoc)
      this.setAttribute('machineDetection', options.machineDetection)
      this.setAttribute('machineDetectionTimeout', options.machineDetectionTimeout)
      this.setAttribute('machineDetectionSpeechThreshold', options.machineDetectionSpeechThreshold)
      this.setAttribute('machineDetectionSpeechEndThreshold', options.machineDetectionSpeechEndThreshold)
      this.setAttribute('machineDetectionSilenceTimeout', options.machineDetectionSilenceTimeout)
      this.setAttribute('amdStatusCallback', options.amdStatusCallback)
      this.setAttribute('amdStatusCallbackMethod', options.amdStatusCallbackMethod)
    }
  }
}

/**
 * Client noun element
 */
class Client extends TwiMLElement {
  constructor(identity: string, options?: ClientOptions) {
    super('Client')
    this.setTextContent(identity)
    if (options) {
      this.setAttribute('url', options.url)
      this.setAttribute('method', options.method)
      this.setAttribute('statusCallback', options.statusCallback)
      this.setAttribute('statusCallbackMethod', options.statusCallbackMethod)
      this.setAttribute('statusCallbackEvent', options.statusCallbackEvent)
    }
  }
}

/**
 * SIP noun element
 */
class Sip extends TwiMLElement {
  constructor(sipUri: string, options?: SipOptions) {
    super('Sip')
    this.setTextContent(sipUri)
    if (options) {
      this.setAttribute('username', options.username)
      this.setAttribute('password', options.password)
      this.setAttribute('url', options.url)
      this.setAttribute('method', options.method)
      this.setAttribute('statusCallback', options.statusCallback)
      this.setAttribute('statusCallbackMethod', options.statusCallbackMethod)
      this.setAttribute('statusCallbackEvent', options.statusCallbackEvent)
      this.setAttribute('machineDetection', options.machineDetection)
      this.setAttribute('machineDetectionTimeout', options.machineDetectionTimeout)
      this.setAttribute('machineDetectionSpeechThreshold', options.machineDetectionSpeechThreshold)
      this.setAttribute('machineDetectionSpeechEndThreshold', options.machineDetectionSpeechEndThreshold)
      this.setAttribute('machineDetectionSilenceTimeout', options.machineDetectionSilenceTimeout)
      this.setAttribute('amdStatusCallback', options.amdStatusCallback)
      this.setAttribute('amdStatusCallbackMethod', options.amdStatusCallbackMethod)
    }
  }
}

/**
 * Conference noun element
 */
class ConferenceNoun extends TwiMLElement {
  constructor(name: string, options?: ConferenceOptions) {
    super('Conference')
    this.setTextContent(name)
    if (options) {
      this.setAttribute('muted', options.muted)
      this.setAttribute('beep', options.beep)
      this.setAttribute('startConferenceOnEnter', options.startConferenceOnEnter)
      this.setAttribute('endConferenceOnExit', options.endConferenceOnExit)
      this.setAttribute('waitUrl', options.waitUrl)
      this.setAttribute('waitMethod', options.waitMethod)
      this.setAttribute('maxParticipants', options.maxParticipants)
      this.setAttribute('record', options.record)
      this.setAttribute('region', options.region)
      this.setAttribute('coach', options.coach)
      this.setAttribute('trim', options.trim)
      this.setAttribute('statusCallback', options.statusCallback)
      this.setAttribute('statusCallbackMethod', options.statusCallbackMethod)
      this.setAttribute('statusCallbackEvent', options.statusCallbackEvent)
      this.setAttribute('recordingStatusCallback', options.recordingStatusCallback)
      this.setAttribute('recordingStatusCallbackMethod', options.recordingStatusCallbackMethod)
      this.setAttribute('recordingStatusCallbackEvent', options.recordingStatusCallbackEvent)
      this.setAttribute('eventCallbackUrl', options.eventCallbackUrl)
      this.setAttribute('jitterBufferSize', options.jitterBufferSize)
      this.setAttribute('participantLabel', options.participantLabel)
    }
  }
}

/**
 * Queue noun element
 */
class Queue extends TwiMLElement {
  constructor(name: string, options?: QueueOptions) {
    super('Queue')
    this.setTextContent(name)
    if (options) {
      this.setAttribute('url', options.url)
      this.setAttribute('method', options.method)
      this.setAttribute('reservationSid', options.reservationSid)
      this.setAttribute('postWorkActivitySid', options.postWorkActivitySid)
    }
  }
}

/**
 * Dial TwiML element with nested nouns
 */
class Dial extends TwiMLElement {
  constructor(numberOrOptions?: string | DialOptions, options?: DialOptions) {
    super('Dial')

    let opts: DialOptions | undefined
    if (typeof numberOrOptions === 'string') {
      this.setTextContent(numberOrOptions)
      opts = options
    } else {
      opts = numberOrOptions
    }

    if (opts) {
      this.setAttribute('action', opts.action)
      this.setAttribute('method', opts.method)
      this.setAttribute('timeout', opts.timeout)
      this.setAttribute('hangupOnStar', opts.hangupOnStar)
      this.setAttribute('timeLimit', opts.timeLimit)
      this.setAttribute('callerId', opts.callerId)
      this.setAttribute('callerIdName', opts.callerIdName)
      this.setAttribute('record', opts.record)
      this.setAttribute('trim', opts.trim)
      this.setAttribute('recordingStatusCallback', opts.recordingStatusCallback)
      this.setAttribute('recordingStatusCallbackMethod', opts.recordingStatusCallbackMethod)
      this.setAttribute('recordingStatusCallbackEvent', opts.recordingStatusCallbackEvent)
      this.setAttribute('answerOnBridge', opts.answerOnBridge)
      this.setAttribute('ringTone', opts.ringTone)
      this.setAttribute('referUrl', opts.referUrl)
      this.setAttribute('referMethod', opts.referMethod)
    }
  }

  number(phoneNumber: string, options?: NumberOptions): this {
    this.textContent = undefined
    this.addChild(new NumberNoun(phoneNumber, options))
    return this
  }

  client(identity: string, options?: ClientOptions): this {
    this.textContent = undefined
    this.addChild(new Client(identity, options))
    return this
  }

  sip(sipUri: string, options?: SipOptions): this {
    this.textContent = undefined
    this.addChild(new Sip(sipUri, options))
    return this
  }

  conference(name: string, options?: ConferenceOptions): this {
    this.textContent = undefined
    this.addChild(new ConferenceNoun(name, options))
    return this
  }

  queue(name: string, options?: QueueOptions): this {
    this.textContent = undefined
    this.addChild(new Queue(name, options))
    return this
  }
}

/**
 * Redirect TwiML element
 */
class Redirect extends TwiMLElement {
  constructor(url: string, options?: RedirectOptions) {
    super('Redirect')
    this.setTextContent(url)
    if (options) {
      this.setAttribute('method', options.method)
    }
  }
}

/**
 * Reject TwiML element
 */
class Reject extends TwiMLElement {
  constructor(options?: RejectOptions) {
    super('Reject')
    if (options) {
      this.setAttribute('reason', options.reason)
    }
  }
}

/**
 * Hangup TwiML element
 */
class Hangup extends TwiMLElement {
  constructor() {
    super('Hangup')
  }
}

/**
 * Leave TwiML element
 */
class Leave extends TwiMLElement {
  constructor() {
    super('Leave')
  }
}

/**
 * Enqueue TwiML element
 */
class Enqueue extends TwiMLElement {
  constructor(queueName: string, options?: EnqueueOptions) {
    super('Enqueue')
    this.setTextContent(queueName)
    if (options) {
      this.setAttribute('action', options.action)
      this.setAttribute('method', options.method)
      this.setAttribute('waitUrl', options.waitUrl)
      this.setAttribute('waitUrlMethod', options.waitUrlMethod)
      this.setAttribute('workflowSid', options.workflowSid)
    }
  }
}

/**
 * VoiceResponse - Main TwiML builder
 *
 * Build TwiML responses for voice calls with a fluent API.
 *
 * @example
 * ```typescript
 * const response = new VoiceResponse()
 * response.say('Hello!', { voice: 'Polly.Amy' })
 * response.gather({ numDigits: 1 }).say('Press 1 to continue')
 * console.log(response.toString())
 * ```
 */
export class VoiceResponse extends TwiMLElement {
  constructor() {
    super('Response')
  }

  /**
   * Add a Say verb to speak text
   */
  say(text: string, options?: SayOptions): this {
    this.addChild(new Say(text, options))
    return this
  }

  /**
   * Add a Play verb to play audio
   */
  play(url?: string, options?: PlayOptions): this {
    this.addChild(new Play(url, options))
    return this
  }

  /**
   * Add a Pause verb
   */
  pause(options?: PauseOptions): this {
    this.addChild(new Pause(options))
    return this
  }

  /**
   * Add a Gather verb to collect input
   */
  gather(options?: GatherOptions): Gather {
    const gather = new Gather(options)
    this.addChild(gather)
    return gather
  }

  /**
   * Add a Record verb
   */
  record(options?: RecordOptions): this {
    this.addChild(new RecordVerb(options))
    return this
  }

  /**
   * Add a Dial verb
   */
  dial(numberOrOptions?: string | DialOptions, options?: DialOptions): Dial {
    const dial = new Dial(numberOrOptions, options)
    this.addChild(dial)
    return dial
  }

  /**
   * Add a Redirect verb
   */
  redirect(url: string, options?: RedirectOptions): this {
    this.addChild(new Redirect(url, options))
    return this
  }

  /**
   * Add a Reject verb
   */
  reject(options?: RejectOptions): this {
    this.addChild(new Reject(options))
    return this
  }

  /**
   * Add a Hangup verb
   */
  hangup(): this {
    this.addChild(new Hangup())
    return this
  }

  /**
   * Add a Leave verb (for queues)
   */
  leave(): this {
    this.addChild(new Leave())
    return this
  }

  /**
   * Add an Enqueue verb
   */
  enqueue(queueName: string, options?: EnqueueOptions): this {
    this.addChild(new Enqueue(queueName, options))
    return this
  }

  /**
   * Convert to TwiML XML string
   */
  toString(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>${super.toString()}`
  }
}

// =============================================================================
// Call Instance
// =============================================================================

/**
 * Instance for interacting with a single call
 */
class CallInstance {
  private client: VoiceClient
  private accountSid: string
  private callSid: string

  constructor(client: VoiceClient, accountSid: string, callSid: string) {
    this.client = client
    this.accountSid = accountSid
    this.callSid = callSid
  }

  /**
   * Fetch call details
   */
  async fetch(): Promise<Call> {
    return this.client._request(
      'GET',
      `/2010-04-01/Accounts/${this.accountSid}/Calls/${this.callSid}.json`
    ) as Promise<Call>
  }

  /**
   * Update call (modify TwiML, cancel, or complete)
   */
  async update(params: CallUpdateParams): Promise<Call> {
    const apiParams: Record<string, unknown> = {}
    if (params.url) apiParams.Url = params.url
    if (params.method) apiParams.Method = params.method
    if (params.status) apiParams.Status = params.status
    if (params.fallbackUrl) apiParams.FallbackUrl = params.fallbackUrl
    if (params.fallbackMethod) apiParams.FallbackMethod = params.fallbackMethod
    if (params.statusCallback) apiParams.StatusCallback = params.statusCallback
    if (params.statusCallbackMethod) apiParams.StatusCallbackMethod = params.statusCallbackMethod
    if (params.twiml) apiParams.Twiml = params.twiml

    return this.client._request(
      'POST',
      `/2010-04-01/Accounts/${this.accountSid}/Calls/${this.callSid}.json`,
      apiParams
    ) as Promise<Call>
  }

  /**
   * Cancel the call
   */
  async cancel(): Promise<Call> {
    return this.update({ status: 'canceled' })
  }

  /**
   * Complete (hang up) the call
   */
  async complete(): Promise<Call> {
    return this.update({ status: 'completed' })
  }

  /**
   * Access recordings for this call
   */
  get recordings(): CallRecordingsResource {
    return new CallRecordingsResource(this.client, this.accountSid, this.callSid)
  }
}

// =============================================================================
// Call Recordings Resource
// =============================================================================

/**
 * Recordings resource for a specific call
 */
class CallRecordingsResource {
  private client: VoiceClient
  private accountSid: string
  private callSid: string

  constructor(client: VoiceClient, accountSid: string, callSid: string) {
    this.client = client
    this.accountSid = accountSid
    this.callSid = callSid
  }

  /**
   * Start a new recording on the call
   */
  async create(params?: RecordingCreateParams): Promise<Recording> {
    const apiParams: Record<string, unknown> = {}
    if (params) {
      if (params.recordingChannels) apiParams.RecordingChannels = params.recordingChannels
      if (params.recordingStatusCallback) apiParams.RecordingStatusCallback = params.recordingStatusCallback
      if (params.recordingStatusCallbackMethod) apiParams.RecordingStatusCallbackMethod = params.recordingStatusCallbackMethod
      if (params.recordingStatusCallbackEvent) apiParams.RecordingStatusCallbackEvent = params.recordingStatusCallbackEvent.join(' ')
      if (params.trim) apiParams.Trim = params.trim
      if (params.recordingTrack) apiParams.RecordingTrack = params.recordingTrack
    }

    return this.client._request(
      'POST',
      `/2010-04-01/Accounts/${this.accountSid}/Calls/${this.callSid}/Recordings.json`,
      apiParams
    ) as Promise<Recording>
  }

  /**
   * List recordings for this call
   */
  async list(): Promise<Recording[]> {
    const response = await this.client._request(
      'GET',
      `/2010-04-01/Accounts/${this.accountSid}/Calls/${this.callSid}/Recordings.json`
    ) as { recordings: Recording[] }
    return response.recordings || []
  }

  /**
   * Get a specific recording
   */
  async get(recordingSid: string): Promise<Recording> {
    return this.client._request(
      'GET',
      `/2010-04-01/Accounts/${this.accountSid}/Calls/${this.callSid}/Recordings/${recordingSid}.json`
    ) as Promise<Recording>
  }

  /**
   * Update a recording (pause, resume, stop)
   */
  async update(recordingSid: string, params: RecordingUpdateParams): Promise<Recording> {
    const apiParams: Record<string, unknown> = {
      Status: params.status,
    }
    if (params.pauseBehavior) apiParams.PauseBehavior = params.pauseBehavior

    return this.client._request(
      'POST',
      `/2010-04-01/Accounts/${this.accountSid}/Calls/${this.callSid}/Recordings/${recordingSid}.json`,
      apiParams
    ) as Promise<Recording>
  }

  /**
   * Delete a recording
   */
  async delete(recordingSid: string): Promise<boolean> {
    return this.client._request(
      'DELETE',
      `/2010-04-01/Accounts/${this.accountSid}/Calls/${this.callSid}/Recordings/${recordingSid}.json`
    ) as Promise<boolean>
  }
}

// =============================================================================
// Calls Resource
// =============================================================================

/**
 * Calls resource interface
 */
interface CallsResourceInterface {
  (sid: string): CallInstance
  create(params: VoiceCallCreateParams): Promise<Call>
  list(params?: CallListParams): Promise<Call[]>
}

/**
 * Create calls resource with callable pattern
 */
function createCallsResource(client: VoiceClient, accountSid: string): CallsResourceInterface {
  const callable = ((sid: string) => new CallInstance(client, accountSid, sid)) as CallsResourceInterface

  callable.create = async (params: VoiceCallCreateParams): Promise<Call> => {
    // Validate required params
    if (!params.to) {
      throw new VoiceAPIError({
        code: 21201,
        message: "The 'To' phone number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21201',
        status: 400,
      })
    }

    if (!params.from) {
      throw new VoiceAPIError({
        code: 21202,
        message: "The 'From' phone number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21202',
        status: 400,
      })
    }

    if (!params.url && !params.twiml && !params.applicationSid) {
      throw new VoiceAPIError({
        code: 21205,
        message: "Either 'Url', 'Twiml', or 'ApplicationSid' is required.",
        more_info: 'https://www.twilio.com/docs/errors/21205',
        status: 400,
      })
    }

    // Convert params to API format
    const apiParams: Record<string, unknown> = {
      To: params.to,
      From: params.from,
      Url: params.url,
      Twiml: params.twiml,
      ApplicationSid: params.applicationSid,
      Method: params.method,
      FallbackUrl: params.fallbackUrl,
      FallbackMethod: params.fallbackMethod,
      StatusCallback: params.statusCallback,
      StatusCallbackEvent: params.statusCallbackEvent?.join(' '),
      StatusCallbackMethod: params.statusCallbackMethod,
      SendDigits: params.sendDigits,
      Timeout: params.timeout,
      Record: params.record,
      RecordingChannels: params.recordingChannels,
      RecordingStatusCallback: params.recordingStatusCallback,
      RecordingStatusCallbackMethod: params.recordingStatusCallbackMethod,
      MachineDetection: params.machineDetection,
      MachineDetectionTimeout: params.machineDetectionTimeout,
      MachineDetectionSilenceTimeout: params.machineDetectionSilenceTimeout,
      MachineDetectionSpeechThreshold: params.machineDetectionSpeechThreshold,
      MachineDetectionSpeechEndThreshold: params.machineDetectionSpeechEndThreshold,
      AsyncAmd: params.asyncAmd,
      AsyncAmdStatusCallback: params.asyncAmdStatusCallback,
      AsyncAmdStatusCallbackMethod: params.asyncAmdStatusCallbackMethod,
      CallerId: params.callerId,
      CallerIdName: params.callerIdName,
      CallReason: params.callReason,
      Trim: params.trim,
      Byoc: params.byoc,
    }

    // Remove undefined values
    Object.keys(apiParams).forEach((key) => {
      if (apiParams[key] === undefined) delete apiParams[key]
    })

    return client._request(
      'POST',
      `/2010-04-01/Accounts/${accountSid}/Calls.json`,
      apiParams
    ) as Promise<Call>
  }

  callable.list = async (params?: CallListParams): Promise<Call[]> => {
    const apiParams: Record<string, unknown> = {}
    if (params) {
      if (params.to) apiParams.To = params.to
      if (params.from) apiParams.From = params.from
      if (params.parentCallSid) apiParams.ParentCallSid = params.parentCallSid
      if (params.status) apiParams.Status = params.status
      if (params.startTime) apiParams.StartTime = params.startTime.toISOString()
      if (params.startTimeAfter) apiParams['StartTime>'] = params.startTimeAfter.toISOString()
      if (params.startTimeBefore) apiParams['StartTime<'] = params.startTimeBefore.toISOString()
      if (params.endTime) apiParams.EndTime = params.endTime.toISOString()
      if (params.endTimeAfter) apiParams['EndTime>'] = params.endTimeAfter.toISOString()
      if (params.endTimeBefore) apiParams['EndTime<'] = params.endTimeBefore.toISOString()
      if (params.pageSize) apiParams.PageSize = params.pageSize
      if (params.page !== undefined) apiParams.Page = params.page
    }

    const response = await client._request(
      'GET',
      `/2010-04-01/Accounts/${accountSid}/Calls.json`,
      apiParams
    ) as ListResponse<Call>

    return response.calls || []
  }

  return callable
}

// =============================================================================
// Recordings Resource
// =============================================================================

/**
 * Recording instance for a specific recording
 */
class RecordingInstance {
  private client: VoiceClient
  private accountSid: string
  private recordingSid: string

  constructor(client: VoiceClient, accountSid: string, recordingSid: string) {
    this.client = client
    this.accountSid = accountSid
    this.recordingSid = recordingSid
  }

  /**
   * Fetch recording details
   */
  async fetch(): Promise<Recording> {
    return this.client._request(
      'GET',
      `/2010-04-01/Accounts/${this.accountSid}/Recordings/${this.recordingSid}.json`
    ) as Promise<Recording>
  }

  /**
   * Delete the recording
   */
  async delete(): Promise<boolean> {
    return this.client._request(
      'DELETE',
      `/2010-04-01/Accounts/${this.accountSid}/Recordings/${this.recordingSid}.json`
    ) as Promise<boolean>
  }
}

/**
 * Recordings resource interface
 */
interface RecordingsResourceInterface {
  (sid: string): RecordingInstance
  list(params?: { callSid?: string; conferenceSid?: string; dateCreated?: Date; pageSize?: number }): Promise<Recording[]>
}

/**
 * Create recordings resource
 */
function createRecordingsResource(client: VoiceClient, accountSid: string): RecordingsResourceInterface {
  const callable = ((sid: string) => new RecordingInstance(client, accountSid, sid)) as RecordingsResourceInterface

  callable.list = async (params?): Promise<Recording[]> => {
    const apiParams: Record<string, unknown> = {}
    if (params) {
      if (params.callSid) apiParams.CallSid = params.callSid
      if (params.conferenceSid) apiParams.ConferenceSid = params.conferenceSid
      if (params.dateCreated) apiParams.DateCreated = params.dateCreated.toISOString().split('T')[0]
      if (params.pageSize) apiParams.PageSize = params.pageSize
    }

    const response = await client._request(
      'GET',
      `/2010-04-01/Accounts/${accountSid}/Recordings.json`,
      apiParams
    ) as { recordings: Recording[] }

    return response.recordings || []
  }

  return callable
}

// =============================================================================
// Conferences Resource
// =============================================================================

/**
 * Conference participant instance
 */
class ParticipantInstance {
  private client: VoiceClient
  private accountSid: string
  private conferenceSid: string
  private callSid: string

  constructor(client: VoiceClient, accountSid: string, conferenceSid: string, callSid: string) {
    this.client = client
    this.accountSid = accountSid
    this.conferenceSid = conferenceSid
    this.callSid = callSid
  }

  /**
   * Fetch participant details
   */
  async fetch(): Promise<Participant> {
    return this.client._request(
      'GET',
      `/2010-04-01/Accounts/${this.accountSid}/Conferences/${this.conferenceSid}/Participants/${this.callSid}.json`
    ) as Promise<Participant>
  }

  /**
   * Update participant (mute, hold, etc.)
   */
  async update(params: ParticipantUpdateParams): Promise<Participant> {
    const apiParams: Record<string, unknown> = {}
    if (params.muted !== undefined) apiParams.Muted = params.muted
    if (params.hold !== undefined) apiParams.Hold = params.hold
    if (params.holdUrl) apiParams.HoldUrl = params.holdUrl
    if (params.holdMethod) apiParams.HoldMethod = params.holdMethod
    if (params.announceUrl) apiParams.AnnounceUrl = params.announceUrl
    if (params.announceMethod) apiParams.AnnounceMethod = params.announceMethod
    if (params.beepOnExit !== undefined) apiParams.BeepOnExit = params.beepOnExit
    if (params.endConferenceOnExit !== undefined) apiParams.EndConferenceOnExit = params.endConferenceOnExit
    if (params.coaching !== undefined) apiParams.Coaching = params.coaching
    if (params.callSidToCoach) apiParams.CallSidToCoach = params.callSidToCoach

    return this.client._request(
      'POST',
      `/2010-04-01/Accounts/${this.accountSid}/Conferences/${this.conferenceSid}/Participants/${this.callSid}.json`,
      apiParams
    ) as Promise<Participant>
  }

  /**
   * Remove participant from conference
   */
  async delete(): Promise<boolean> {
    return this.client._request(
      'DELETE',
      `/2010-04-01/Accounts/${this.accountSid}/Conferences/${this.conferenceSid}/Participants/${this.callSid}.json`
    ) as Promise<boolean>
  }
}

/**
 * Conference participants resource
 */
interface ParticipantsResourceInterface {
  (callSid: string): ParticipantInstance
  create(params: { from: string; to: string; statusCallback?: string; statusCallbackMethod?: 'GET' | 'POST'; statusCallbackEvent?: string[]; label?: string; timeout?: number; record?: boolean; muted?: boolean; beep?: string | boolean; startConferenceOnEnter?: boolean; endConferenceOnExit?: boolean; waitUrl?: string; waitMethod?: 'GET' | 'POST'; earlyMedia?: boolean; maxParticipants?: number; conferenceRecord?: string; conferenceRecordingStatusCallback?: string; conferenceRecordingStatusCallbackMethod?: 'GET' | 'POST'; recordingStatusCallback?: string; recordingStatusCallbackMethod?: 'GET' | 'POST'; recordingStatusCallbackEvent?: string[]; coaching?: boolean; callSidToCoach?: string; jitterBufferSize?: 'off' | 'small' | 'medium' | 'large' }): Promise<Participant>
  list(params?: { muted?: boolean; hold?: boolean; coaching?: boolean; pageSize?: number }): Promise<Participant[]>
}

/**
 * Conference instance
 */
class ConferenceInstance {
  private client: VoiceClient
  private accountSid: string
  private conferenceSid: string
  participants: ParticipantsResourceInterface

  constructor(client: VoiceClient, accountSid: string, conferenceSid: string) {
    this.client = client
    this.accountSid = accountSid
    this.conferenceSid = conferenceSid
    this.participants = this.createParticipantsResource()
  }

  private createParticipantsResource(): ParticipantsResourceInterface {
    const callable = ((callSid: string) => new ParticipantInstance(this.client, this.accountSid, this.conferenceSid, callSid)) as ParticipantsResourceInterface

    callable.create = async (params): Promise<Participant> => {
      const apiParams: Record<string, unknown> = {
        From: params.from,
        To: params.to,
      }
      if (params.statusCallback) apiParams.StatusCallback = params.statusCallback
      if (params.statusCallbackMethod) apiParams.StatusCallbackMethod = params.statusCallbackMethod
      if (params.statusCallbackEvent) apiParams.StatusCallbackEvent = params.statusCallbackEvent.join(' ')
      if (params.label) apiParams.Label = params.label
      if (params.timeout) apiParams.Timeout = params.timeout
      if (params.record !== undefined) apiParams.Record = params.record
      if (params.muted !== undefined) apiParams.Muted = params.muted
      if (params.beep !== undefined) apiParams.Beep = params.beep
      if (params.startConferenceOnEnter !== undefined) apiParams.StartConferenceOnEnter = params.startConferenceOnEnter
      if (params.endConferenceOnExit !== undefined) apiParams.EndConferenceOnExit = params.endConferenceOnExit
      if (params.waitUrl) apiParams.WaitUrl = params.waitUrl
      if (params.waitMethod) apiParams.WaitMethod = params.waitMethod
      if (params.earlyMedia !== undefined) apiParams.EarlyMedia = params.earlyMedia
      if (params.maxParticipants) apiParams.MaxParticipants = params.maxParticipants
      if (params.conferenceRecord) apiParams.ConferenceRecord = params.conferenceRecord
      if (params.conferenceRecordingStatusCallback) apiParams.ConferenceRecordingStatusCallback = params.conferenceRecordingStatusCallback
      if (params.conferenceRecordingStatusCallbackMethod) apiParams.ConferenceRecordingStatusCallbackMethod = params.conferenceRecordingStatusCallbackMethod
      if (params.recordingStatusCallback) apiParams.RecordingStatusCallback = params.recordingStatusCallback
      if (params.recordingStatusCallbackMethod) apiParams.RecordingStatusCallbackMethod = params.recordingStatusCallbackMethod
      if (params.recordingStatusCallbackEvent) apiParams.RecordingStatusCallbackEvent = params.recordingStatusCallbackEvent.join(' ')
      if (params.coaching !== undefined) apiParams.Coaching = params.coaching
      if (params.callSidToCoach) apiParams.CallSidToCoach = params.callSidToCoach
      if (params.jitterBufferSize) apiParams.JitterBufferSize = params.jitterBufferSize

      return this.client._request(
        'POST',
        `/2010-04-01/Accounts/${this.accountSid}/Conferences/${this.conferenceSid}/Participants.json`,
        apiParams
      ) as Promise<Participant>
    }

    callable.list = async (params?): Promise<Participant[]> => {
      const apiParams: Record<string, unknown> = {}
      if (params) {
        if (params.muted !== undefined) apiParams.Muted = params.muted
        if (params.hold !== undefined) apiParams.Hold = params.hold
        if (params.coaching !== undefined) apiParams.Coaching = params.coaching
        if (params.pageSize) apiParams.PageSize = params.pageSize
      }

      const response = await this.client._request(
        'GET',
        `/2010-04-01/Accounts/${this.accountSid}/Conferences/${this.conferenceSid}/Participants.json`,
        apiParams
      ) as { participants: Participant[] }

      return response.participants || []
    }

    return callable
  }

  /**
   * Fetch conference details
   */
  async fetch(): Promise<Conference> {
    return this.client._request(
      'GET',
      `/2010-04-01/Accounts/${this.accountSid}/Conferences/${this.conferenceSid}.json`
    ) as Promise<Conference>
  }

  /**
   * Update conference (end it)
   */
  async update(params: { status: 'completed' }): Promise<Conference> {
    return this.client._request(
      'POST',
      `/2010-04-01/Accounts/${this.accountSid}/Conferences/${this.conferenceSid}.json`,
      { Status: params.status }
    ) as Promise<Conference>
  }

  /**
   * Get recordings for this conference
   */
  get recordings(): ConferenceRecordingsResource {
    return new ConferenceRecordingsResource(this.client, this.accountSid, this.conferenceSid)
  }
}

/**
 * Conference recordings resource
 */
class ConferenceRecordingsResource {
  private client: VoiceClient
  private accountSid: string
  private conferenceSid: string

  constructor(client: VoiceClient, accountSid: string, conferenceSid: string) {
    this.client = client
    this.accountSid = accountSid
    this.conferenceSid = conferenceSid
  }

  /**
   * List recordings for this conference
   */
  async list(): Promise<Recording[]> {
    const response = await this.client._request(
      'GET',
      `/2010-04-01/Accounts/${this.accountSid}/Conferences/${this.conferenceSid}/Recordings.json`
    ) as { recordings: Recording[] }
    return response.recordings || []
  }

  /**
   * Get a specific recording
   */
  async get(recordingSid: string): Promise<Recording> {
    return this.client._request(
      'GET',
      `/2010-04-01/Accounts/${this.accountSid}/Conferences/${this.conferenceSid}/Recordings/${recordingSid}.json`
    ) as Promise<Recording>
  }

  /**
   * Update a recording (pause, resume, stop)
   */
  async update(recordingSid: string, params: RecordingUpdateParams): Promise<Recording> {
    const apiParams: Record<string, unknown> = {
      Status: params.status,
    }
    if (params.pauseBehavior) apiParams.PauseBehavior = params.pauseBehavior

    return this.client._request(
      'POST',
      `/2010-04-01/Accounts/${this.accountSid}/Conferences/${this.conferenceSid}/Recordings/${recordingSid}.json`,
      apiParams
    ) as Promise<Recording>
  }

  /**
   * Delete a recording
   */
  async delete(recordingSid: string): Promise<boolean> {
    return this.client._request(
      'DELETE',
      `/2010-04-01/Accounts/${this.accountSid}/Conferences/${this.conferenceSid}/Recordings/${recordingSid}.json`
    ) as Promise<boolean>
  }
}

/**
 * Conferences resource interface
 */
interface ConferencesResourceInterface {
  (sid: string): ConferenceInstance
  list(params?: { status?: 'init' | 'in-progress' | 'completed'; friendlyName?: string; dateCreated?: Date; dateUpdated?: Date; pageSize?: number }): Promise<Conference[]>
}

/**
 * Create conferences resource
 */
function createConferencesResource(client: VoiceClient, accountSid: string): ConferencesResourceInterface {
  const callable = ((sid: string) => new ConferenceInstance(client, accountSid, sid)) as ConferencesResourceInterface

  callable.list = async (params?): Promise<Conference[]> => {
    const apiParams: Record<string, unknown> = {}
    if (params) {
      if (params.status) apiParams.Status = params.status
      if (params.friendlyName) apiParams.FriendlyName = params.friendlyName
      if (params.dateCreated) apiParams.DateCreated = params.dateCreated.toISOString().split('T')[0]
      if (params.dateUpdated) apiParams.DateUpdated = params.dateUpdated.toISOString().split('T')[0]
      if (params.pageSize) apiParams.PageSize = params.pageSize
    }

    const response = await client._request(
      'GET',
      `/2010-04-01/Accounts/${accountSid}/Conferences.json`,
      apiParams
    ) as { conferences: Conference[] }

    return response.conferences || []
  }

  return callable
}

// =============================================================================
// Voice Client
// =============================================================================

/**
 * VoiceClient - Twilio Voice API client
 *
 * Complete implementation of Twilio Voice API with call management,
 * recording control, and conference support.
 *
 * @example
 * ```typescript
 * const voice = new VoiceClient({
 *   accountSid: 'AC...',
 *   authToken: 'token',
 * })
 *
 * // Make a call
 * const call = await voice.calls.create({
 *   to: '+15558675310',
 *   from: '+15017122661',
 *   url: 'https://example.com/twiml',
 * })
 *
 * // Update call with new TwiML
 * await voice.calls(call.sid).update({
 *   twiml: '<Response><Say>Redirected!</Say></Response>',
 * })
 *
 * // Start recording
 * await voice.calls(call.sid).recordings.create()
 *
 * // End call
 * await voice.calls(call.sid).complete()
 * ```
 */
export class VoiceClient {
  private accountSid: string
  private authToken: string
  private config: TwilioClientConfig
  private baseUrl: string
  private _fetch: typeof fetch

  // Resources
  calls: CallsResourceInterface
  recordings: RecordingsResourceInterface
  conferences: ConferencesResourceInterface

  constructor(accountSid: string, authToken: string, config: TwilioClientConfig = {}) {
    if (!accountSid) {
      throw new Error('accountSid is required')
    }
    if (!authToken) {
      throw new Error('authToken is required')
    }

    this.accountSid = accountSid
    this.authToken = authToken
    this.config = config

    // Build base URL
    let apiHost = 'api.twilio.com'
    if (config.edge) {
      apiHost = `api.${config.edge}.twilio.com`
    }
    if (config.region) {
      apiHost = `api.${config.region}.twilio.com`
    }
    this.baseUrl = `https://${apiHost}`
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)

    // Initialize resources
    this.calls = createCallsResource(this, accountSid)
    this.recordings = createRecordingsResource(this, accountSid)
    this.conferences = createConferencesResource(this, accountSid)
  }

  /**
   * Make a raw API request
   * @internal
   */
  async _request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const url = new URL(path, this.baseUrl)

    // Add query params for GET requests
    if (method === 'GET' && params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    // Build Basic Auth header
    const auth = btoa(`${this.accountSid}:${this.authToken}`)

    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }

    // Build request body for POST
    let body: string | undefined
    if (method === 'POST' && params) {
      body = encodeFormData(params)
    }

    const maxRetries = this.config.autoRetry ? (this.config.maxRetries ?? 3) : 0
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeout = this.config.timeout ?? 30000
        const timeoutId = setTimeout(() => controller.abort(), timeout)

        try {
          const response = await this._fetch(url.toString(), {
            method,
            headers,
            body,
            signal: controller.signal,
          })

          if (method === 'DELETE' && response.status === 204) {
            return true
          }

          const data = await response.json()

          if (!response.ok) {
            throw new VoiceAPIError(data as TwilioErrorResponse)
          }

          return data
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors (4xx)
        if (error instanceof VoiceAPIError && error.status >= 400 && error.status < 500) {
          throw error
        }

        // Retry with exponential backoff
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
          await sleep(delay)
        }
      }
    }

    throw lastError ?? new Error('Unknown error')
  }
}

// =============================================================================
// Webhook Handlers
// =============================================================================

/**
 * Parse a voice webhook request body
 */
export function parseVoiceWebhook(body: Record<string, string> | FormData | URLSearchParams): VoiceWebhookPayload {
  let params: Record<string, string>

  if (body instanceof FormData) {
    params = {}
    body.forEach((value, key) => {
      params[key] = String(value)
    })
  } else if (body instanceof URLSearchParams) {
    params = {}
    body.forEach((value, key) => {
      params[key] = value
    })
  } else {
    params = body
  }

  return {
    CallSid: params.CallSid,
    AccountSid: params.AccountSid,
    From: params.From,
    To: params.To,
    CallStatus: params.CallStatus as CallStatus,
    ApiVersion: params.ApiVersion,
    Direction: params.Direction as 'inbound' | 'outbound-api' | 'outbound-dial',
    ForwardedFrom: params.ForwardedFrom,
    CallerName: params.CallerName,
    ParentCallSid: params.ParentCallSid,
    Digits: params.Digits,
    FinishedOnKey: params.FinishedOnKey,
    SpeechResult: params.SpeechResult,
    Confidence: params.Confidence,
    RecordingUrl: params.RecordingUrl,
    RecordingSid: params.RecordingSid,
    RecordingDuration: params.RecordingDuration,
    RecordingStatus: params.RecordingStatus,
    CallDuration: params.CallDuration,
    Timestamp: params.Timestamp,
    SequenceNumber: params.SequenceNumber,
    Duration: params.Duration,
    SipResponseCode: params.SipResponseCode,
    SipCallId: params.SipCallId,
    AnsweredBy: params.AnsweredBy as VoiceWebhookPayload['AnsweredBy'],
    MachineDetectionDuration: params.MachineDetectionDuration,
  }
}

/**
 * Parse a recording status callback
 */
export function parseRecordingStatusCallback(body: Record<string, string> | FormData | URLSearchParams): RecordingStatusCallbackPayload {
  let params: Record<string, string>

  if (body instanceof FormData) {
    params = {}
    body.forEach((value, key) => {
      params[key] = String(value)
    })
  } else if (body instanceof URLSearchParams) {
    params = {}
    body.forEach((value, key) => {
      params[key] = value
    })
  } else {
    params = body
  }

  return {
    AccountSid: params.AccountSid,
    CallSid: params.CallSid,
    RecordingSid: params.RecordingSid,
    RecordingUrl: params.RecordingUrl,
    RecordingStatus: params.RecordingStatus as RecordingStatusCallbackPayload['RecordingStatus'],
    RecordingDuration: params.RecordingDuration,
    RecordingChannels: params.RecordingChannels,
    RecordingSource: params.RecordingSource,
    RecordingStartTime: params.RecordingStartTime,
    RecordingTrack: params.RecordingTrack,
    ErrorCode: params.ErrorCode,
  }
}

/**
 * Validate a Twilio webhook signature
 */
export async function validateWebhookSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): Promise<boolean> {
  const expectedSignature = await getExpectedSignature(authToken, url, params)
  return secureCompare(signature, expectedSignature)
}

/**
 * Generate expected Twilio signature
 */
async function getExpectedSignature(
  authToken: string,
  url: string,
  params: Record<string, string>
): Promise<string> {
  // Sort params and create string
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const key of sortedKeys) {
    data += key + params[key]
  }

  // Compute HMAC-SHA1
  const encoder = new TextEncoder()
  const keyData = encoder.encode(authToken)
  const messageData = encoder.encode(data)

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData)

  // Base64 encode
  return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(signatureBuffer))))
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Encode an object as form data
 */
function encodeFormData(data: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = []

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue

    const fullKey = prefix ? `${prefix}[${key}]` : key

    if (value === null || value === '') {
      parts.push(`${encodeURIComponent(fullKey)}=`)
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object' && item !== null) {
          parts.push(encodeFormData(item as Record<string, unknown>, `${fullKey}[${index}]`))
        } else {
          parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(item))}`)
        }
      })
    } else if (typeof value === 'object') {
      parts.push(encodeFormData(value as Record<string, unknown>, fullKey))
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`)
    }
  }

  return parts.filter((p) => p).join('&')
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Constant-time string comparison
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a VoiceClient using the factory function
 */
export function createVoiceClient(accountSid: string, authToken: string, config?: TwilioClientConfig): VoiceClient {
  return new VoiceClient(accountSid, authToken, config)
}

// =============================================================================
// Default Export
// =============================================================================

export default VoiceClient
