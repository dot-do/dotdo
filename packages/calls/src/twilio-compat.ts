/**
 * @dotdo/calls - Twilio API Compatibility Layer
 *
 * Drop-in replacement for Twilio's Voice API.
 *
 * @example
 * ```typescript
 * import { TwilioClient } from '@dotdo/calls'
 *
 * const client = new TwilioClient({
 *   accountSid: 'AC123',
 *   authToken: 'token123',
 * })
 *
 * const call = await client.calls.create({
 *   to: '+14155551234',
 *   from: '+14155559876',
 *   url: 'https://example.com/twiml',
 * })
 * ```
 */

import { Hono } from 'hono'
import type {
  VoiceCall,
  MakeCallRequest,
  MakeCallResponse,
  CallStatus,
  VoiceWebhookPayload,
  StatusCallbackPayload,
  TwiMLInstruction,
  TwiMLSay,
  TwiMLPlay,
  TwiMLGather,
  TwiMLDial,
  TwiMLRecord,
  TwiMLRedirect,
  CallErrorResponse,
} from './types'

// ============================================================================
// In-Memory Storage (for testing, replaced by DO in production)
// ============================================================================

const callStore = new Map<string, VoiceCall>()

// ============================================================================
// TwilioClient
// ============================================================================

export interface TwilioClientConfig {
  accountSid: string
  authToken?: string
  apiKey?: string
  apiSecret?: string
}

export class TwilioClient {
  private accountSid: string
  private authToken?: string
  private apiKey?: string
  private apiSecret?: string

  public calls: CallsResource

  constructor(config: TwilioClientConfig) {
    this.accountSid = config.accountSid
    this.authToken = config.authToken
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret

    this.calls = new CallsResource(this.accountSid)
  }
}

export class CallsResource {
  private accountSid: string

  constructor(accountSid: string) {
    this.accountSid = accountSid
  }

  /**
   * Create (initiate) a new outbound call
   */
  async create(request: MakeCallRequest): Promise<MakeCallResponse> {
    // Validate request
    const validation = validateMakeCallRequest(request)
    if (!validation.valid) {
      throw new Error(validation.errors?.error.message || 'Invalid request')
    }

    // Generate call SID
    const sid = generateCallSid()

    // Create call record
    const call: VoiceCall = {
      sid,
      account_sid: this.accountSid,
      from: request.from,
      to: request.to,
      direction: 'outbound',
      status: 'queued',
      status_callback: request.status_callback,
      status_callback_method: request.status_callback_method,
      created_at: new Date(),
      updated_at: new Date(),
    }

    // Store call
    callStore.set(sid, call)

    return {
      sid,
      account_sid: this.accountSid,
      from: request.from,
      to: request.to,
      status: 'queued',
      direction: 'outbound-api',
      created_at: call.created_at,
    }
  }

  /**
   * Retrieve a call by SID
   */
  async get(sid: string): Promise<VoiceCall> {
    const call = callStore.get(sid)
    if (!call) {
      throw new Error('Call not found')
    }
    return call
  }

  /**
   * Update a call (modify TwiML, cancel, complete)
   */
  async update(sid: string, updates: Partial<MakeCallRequest> & { status?: 'canceled' | 'completed' }): Promise<VoiceCall> {
    const call = callStore.get(sid)
    if (!call) {
      throw new Error('Call not found')
    }

    // Update status if provided
    if (updates.status) {
      call.status = updates.status
      if (updates.status === 'completed' || updates.status === 'canceled') {
        call.end_time = new Date()
      }
    }

    call.updated_at = new Date()
    callStore.set(sid, call)

    return call
  }

  /**
   * List calls with optional filters
   */
  async list(filters?: {
    status?: CallStatus
    to?: string
    from?: string
    startTime?: Date
    endTime?: Date
    pageSize?: number
  }): Promise<VoiceCall[]> {
    let calls = Array.from(callStore.values())

    if (filters?.status) {
      calls = calls.filter((c) => c.status === filters.status)
    }
    if (filters?.to) {
      calls = calls.filter((c) => c.to === filters.to)
    }
    if (filters?.from) {
      calls = calls.filter((c) => c.from === filters.from)
    }
    if (filters?.startTime) {
      calls = calls.filter((c) => c.created_at >= filters.startTime!)
    }
    if (filters?.endTime) {
      calls = calls.filter((c) => c.created_at <= filters.endTime!)
    }

    const pageSize = filters?.pageSize || 50
    return calls.slice(0, pageSize)
  }
}

// ============================================================================
// Request Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean
  errors?: CallErrorResponse
}

export function validateMakeCallRequest(request: MakeCallRequest): ValidationResult {
  // Check required fields
  if (!request.to) {
    return {
      valid: false,
      errors: {
        error: {
          code: 21201,
          message: 'The to parameter is required',
        },
      },
    }
  }

  if (!request.from) {
    return {
      valid: false,
      errors: {
        error: {
          code: 21202,
          message: 'The from parameter is required',
        },
      },
    }
  }

  if (!request.url && !request.twiml) {
    return {
      valid: false,
      errors: {
        error: {
          code: 21205,
          message: 'Either url or twiml must be provided',
        },
      },
    }
  }

  // Validate to address
  if (!isValidAddress(request.to)) {
    return {
      valid: false,
      errors: {
        error: {
          code: 21211,
          message: 'Invalid to address',
        },
      },
    }
  }

  // Validate from address
  if (!isValidAddress(request.from)) {
    return {
      valid: false,
      errors: {
        error: {
          code: 21212,
          message: 'Invalid from address',
        },
      },
    }
  }

  return { valid: true }
}

function isValidAddress(address: string): boolean {
  // E.164 phone number
  if (/^\+[1-9]\d{1,14}$/.test(address)) {
    return true
  }
  // SIP URI
  if (/^sip:[^@]+@[^@]+$/.test(address)) {
    return true
  }
  // Client identifier
  if (/^client:[a-zA-Z0-9_-]+$/.test(address)) {
    return true
  }
  return false
}

function generateCallSid(): string {
  const chars = '0123456789abcdef'
  let sid = 'CA'
  for (let i = 0; i < 32; i++) {
    sid += chars[Math.floor(Math.random() * chars.length)]
  }
  return sid
}

// ============================================================================
// TwiML Builder
// ============================================================================

interface SayOptions {
  voice?: string
  language?: string
  loop?: number
}

interface PlayOptions {
  loop?: number
  digits?: string
}

interface GatherOptions {
  action?: string
  method?: 'GET' | 'POST'
  timeout?: number
  finish_on_key?: string
  num_digits?: number
  input?: ('dtmf' | 'speech')[]
  hints?: string
  speech_timeout?: number | 'auto'
  language?: string
  partial_result_callback?: string
}

interface DialOptions {
  caller_id?: string
  timeout?: number
  record?: 'do-not-record' | 'record-from-answer' | 'record-from-ringing' | 'record-from-answer-dual' | 'record-from-ringing-dual'
  action?: string
  method?: 'GET' | 'POST'
  hangup_on_star?: boolean
  time_limit?: number
  ring_tone?: string
  recording_status_callback?: string
}

interface RecordOptions {
  action?: string
  method?: 'GET' | 'POST'
  max_length?: number
  play_beep?: boolean
  finish_on_key?: string
  timeout?: number
  transcribe?: boolean
  transcribe_callback?: string
  recording_status_callback?: string
}

interface NestedBuilder {
  say(text: string, options?: SayOptions): this
  play(url: string, options?: PlayOptions): this
  pause(length?: number): this
}

interface DialNestedBuilder {
  number(phoneNumber: string): this
  client(clientName: string): this
  sip(sipUri: string): this
  conference(roomName: string): this
  queue(queueName: string): this
}

export class TwiMLBuilder implements NestedBuilder {
  private elements: string[] = []

  say(text: string, options?: SayOptions): this {
    const attrs = this.formatAttributes({
      voice: options?.voice,
      language: options?.language,
      loop: options?.loop,
    })
    this.elements.push(`<Say${attrs}>${escapeXml(text)}</Say>`)
    return this
  }

  play(url: string, options?: PlayOptions): this {
    const attrs = this.formatAttributes({
      loop: options?.loop,
      digits: options?.digits,
    })
    this.elements.push(`<Play${attrs}>${escapeXml(url)}</Play>`)
    return this
  }

  gather(options: GatherOptions, nested?: (gather: NestedBuilder) => void): this {
    const attrs = this.formatAttributes({
      action: options.action,
      method: options.method,
      timeout: options.timeout,
      finishOnKey: options.finish_on_key,
      numDigits: options.num_digits,
      input: options.input?.join(' '),
      hints: options.hints,
      speechTimeout: options.speech_timeout,
      language: options.language,
      partialResultCallback: options.partial_result_callback,
    })

    if (nested) {
      const nestedBuilder = new TwiMLBuilder()
      nested(nestedBuilder)
      this.elements.push(`<Gather${attrs}>${nestedBuilder.buildInner()}</Gather>`)
    } else {
      this.elements.push(`<Gather${attrs}></Gather>`)
    }
    return this
  }

  dial(number: string | null, options?: DialOptions, nested?: (dial: DialNestedBuilder) => void): this {
    const attrs = this.formatAttributes({
      callerId: options?.caller_id,
      timeout: options?.timeout,
      record: options?.record,
      action: options?.action,
      method: options?.method,
      hangupOnStar: options?.hangup_on_star,
      timeLimit: options?.time_limit,
      ringTone: options?.ring_tone,
      recordingStatusCallback: options?.recording_status_callback,
    })

    if (nested) {
      const nestedBuilder = new DialNestedBuilderImpl()
      nested(nestedBuilder)
      this.elements.push(`<Dial${attrs}>${nestedBuilder.buildInner()}</Dial>`)
    } else if (number) {
      this.elements.push(`<Dial${attrs}>${escapeXml(number)}</Dial>`)
    } else {
      this.elements.push(`<Dial${attrs}></Dial>`)
    }
    return this
  }

  record(options: RecordOptions): this {
    const attrs = this.formatAttributes({
      action: options.action,
      method: options.method,
      maxLength: options.max_length,
      playBeep: options.play_beep,
      finishOnKey: options.finish_on_key,
      timeout: options.timeout,
      transcribe: options.transcribe,
      transcribeCallback: options.transcribe_callback,
      recordingStatusCallback: options.recording_status_callback,
    })
    this.elements.push(`<Record${attrs} />`)
    return this
  }

  hangup(): this {
    this.elements.push('<Hangup />')
    return this
  }

  redirect(url: string, options?: { method?: 'GET' | 'POST' }): this {
    const attrs = this.formatAttributes({
      method: options?.method,
    })
    this.elements.push(`<Redirect${attrs}>${escapeXml(url)}</Redirect>`)
    return this
  }

  pause(length?: number): this {
    const attrs = this.formatAttributes({ length })
    this.elements.push(`<Pause${attrs} />`)
    return this
  }

  reject(reason?: 'rejected' | 'busy'): this {
    const attrs = this.formatAttributes({ reason })
    this.elements.push(`<Reject${attrs} />`)
    return this
  }

  private formatAttributes(attrs: Record<string, string | number | boolean | undefined>): string {
    const parts: string[] = []
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined) {
        parts.push(`${key}="${escapeXml(String(value))}"`)
      }
    }
    return parts.length > 0 ? ' ' + parts.join(' ') : ''
  }

  buildInner(): string {
    return this.elements.join('')
  }

  build(): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${this.elements.join('')}</Response>`
  }
}

class DialNestedBuilderImpl implements DialNestedBuilder {
  private elements: string[] = []

  number(phoneNumber: string): this {
    this.elements.push(`<Number>${escapeXml(phoneNumber)}</Number>`)
    return this
  }

  client(clientName: string): this {
    this.elements.push(`<Client>${escapeXml(clientName)}</Client>`)
    return this
  }

  sip(sipUri: string): this {
    this.elements.push(`<Sip>${escapeXml(sipUri)}</Sip>`)
    return this
  }

  conference(roomName: string): this {
    this.elements.push(`<Conference>${escapeXml(roomName)}</Conference>`)
    return this
  }

  queue(queueName: string): this {
    this.elements.push(`<Queue>${escapeXml(queueName)}</Queue>`)
    return this
  }

  buildInner(): string {
    return this.elements.join('')
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ============================================================================
// TwiML Parser
// ============================================================================

export function parseTwiML(xml: string): TwiMLInstruction[] {
  // Simple XML parser for TwiML
  const instructions: TwiMLInstruction[] = []

  // Check for Response element
  if (!xml.includes('<Response>') && !xml.includes('<Response ')) {
    throw new Error('Missing Response element')
  }

  // Extract content inside Response
  const responseMatch = xml.match(/<Response[^>]*>([\s\S]*)<\/Response>/i)
  if (!responseMatch) {
    throw new Error('Invalid TwiML: Missing Response content')
  }

  const content = responseMatch[1]

  // Parse each verb
  const verbRegex = /<(Say|Play|Gather|Dial|Record|Hangup|Redirect|Pause|Reject)([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi
  let match

  while ((match = verbRegex.exec(content)) !== null) {
    const verb = match[1]
    const attrsStr = match[2] || ''
    const innerContent = match[3] || ''

    const attrs = parseAttributes(attrsStr)

    switch (verb.toLowerCase()) {
      case 'say':
        instructions.push({
          type: 'Say',
          params: {
            text: innerContent.trim(),
            voice: attrs.voice,
            language: attrs.language,
            loop: attrs.loop ? parseInt(attrs.loop, 10) : undefined,
          } as TwiMLSay,
        })
        break

      case 'play':
        instructions.push({
          type: 'Play',
          params: {
            url: innerContent.trim(),
            loop: attrs.loop ? parseInt(attrs.loop, 10) : undefined,
            digits: attrs.digits,
          } as TwiMLPlay,
        })
        break

      case 'gather': {
        const nestedInstructions = innerContent ? parseTwiML(`<Response>${innerContent}</Response>`) : []
        instructions.push({
          type: 'Gather',
          params: {
            action: attrs.action,
            method: attrs.method as 'GET' | 'POST' | undefined,
            timeout: attrs.timeout ? parseInt(attrs.timeout, 10) : undefined,
            finish_on_key: attrs.finishonkey || attrs.finishOnKey,
            num_digits: attrs.numdigits || attrs.numDigits ? parseInt(attrs.numdigits || attrs.numDigits, 10) : undefined,
            nested: nestedInstructions.length > 0 ? nestedInstructions : undefined,
          } as TwiMLGather & { nested?: TwiMLInstruction[] },
        })
        break
      }

      case 'dial':
        instructions.push({
          type: 'Dial',
          params: {
            number: innerContent.trim() || undefined,
            timeout: attrs.timeout ? parseInt(attrs.timeout, 10) : undefined,
            caller_id: attrs.callerid || attrs.callerId,
            record: attrs.record as TwiMLDial['record'],
            action: attrs.action,
            method: attrs.method as 'GET' | 'POST' | undefined,
          } as TwiMLDial,
        })
        break

      case 'record':
        instructions.push({
          type: 'Record',
          params: {
            action: attrs.action,
            method: attrs.method as 'GET' | 'POST' | undefined,
            max_length: attrs.maxlength || attrs.maxLength ? parseInt(attrs.maxlength || attrs.maxLength, 10) : undefined,
            play_beep: attrs.playbeep === 'true' || attrs.playBeep === 'true',
            finish_on_key: attrs.finishonkey || attrs.finishOnKey,
            timeout: attrs.timeout ? parseInt(attrs.timeout, 10) : undefined,
            transcribe: attrs.transcribe === 'true',
          } as TwiMLRecord,
        })
        break

      case 'hangup':
        instructions.push({
          type: 'Hangup',
          params: {},
        })
        break

      case 'redirect':
        instructions.push({
          type: 'Redirect',
          params: {
            url: innerContent.trim(),
            method: attrs.method as 'GET' | 'POST' | undefined,
          } as TwiMLRedirect,
        })
        break

      case 'pause':
        instructions.push({
          type: 'Pause',
          params: {
            length: attrs.length ? parseInt(attrs.length, 10) : undefined,
          },
        })
        break

      case 'reject':
        instructions.push({
          type: 'Reject',
          params: {
            reason: attrs.reason as 'rejected' | 'busy' | undefined,
          },
        })
        break
    }
  }

  return instructions
}

function parseAttributes(attrsStr: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrRegex = /(\w+)=["']([^"']*)["']/gi
  let match

  while ((match = attrRegex.exec(attrsStr)) !== null) {
    attrs[match[1].toLowerCase()] = match[2]
    // Also store camelCase version
    attrs[match[1]] = match[2]
  }

  return attrs
}

// ============================================================================
// Webhook Parser
// ============================================================================

export function parseVoiceWebhook(payload: Record<string, string>): VoiceWebhookPayload {
  return {
    CallSid: payload.CallSid,
    AccountSid: payload.AccountSid,
    From: payload.From,
    To: payload.To,
    CallStatus: payload.CallStatus as CallStatus,
    Direction: payload.Direction as 'inbound' | 'outbound',
    ApiVersion: payload.ApiVersion,
    CallerName: payload.CallerName,
    ForwardedFrom: payload.ForwardedFrom,
    ParentCallSid: payload.ParentCallSid,
    Digits: payload.Digits,
    SpeechResult: payload.SpeechResult,
    Confidence: payload.Confidence,
    RecordingUrl: payload.RecordingUrl,
    RecordingSid: payload.RecordingSid,
    RecordingDuration: payload.RecordingDuration,
    CallDuration: payload.CallDuration,
    AnsweredBy: payload.AnsweredBy,
    SequenceNumber: payload.SequenceNumber,
    Timestamp: payload.Timestamp,
  } as VoiceWebhookPayload & StatusCallbackPayload
}

// ============================================================================
// Hono Router
// ============================================================================

export interface VoiceEnv {
  TWILIO_ACCOUNT_SID?: string
  TWILIO_AUTH_TOKEN?: string
}

type TwilioMakeCallRequest = {
  To: string
  From: string
  Url?: string
  Twiml?: string
  Method?: 'GET' | 'POST'
  StatusCallback?: string
  StatusCallbackMethod?: 'GET' | 'POST'
  StatusCallbackEvent?: string[]
  Timeout?: number
  Record?: boolean
  RecordingChannels?: 'mono' | 'dual'
  MachineDetection?: 'Enable' | 'DetectMessageEnd'
}

/**
 * Create a Hono router with Twilio-compatible voice endpoints
 */
export function createVoiceRouter(): Hono<{ Bindings: VoiceEnv }> {
  const router = new Hono<{ Bindings: VoiceEnv }>()

  // POST /Calls - Create a new outbound call
  router.post('/Calls', async (c) => {
    try {
      const body = await c.req.json<TwilioMakeCallRequest>()

      const request: MakeCallRequest = {
        to: body.To,
        from: body.From,
        url: body.Url,
        twiml: body.Twiml,
        method: body.Method,
        status_callback: body.StatusCallback,
        status_callback_method: body.StatusCallbackMethod,
        status_callback_event: body.StatusCallbackEvent as MakeCallRequest['status_callback_event'],
        timeout: body.Timeout,
        record: body.Record,
        recording_channels: body.RecordingChannels,
        machine_detection: body.MachineDetection,
      }

      const validation = validateMakeCallRequest(request)
      if (!validation.valid) {
        return c.json(validation.errors, 400)
      }

      const client = new TwilioClient({
        accountSid: c.env?.TWILIO_ACCOUNT_SID || 'AC_default',
        authToken: c.env?.TWILIO_AUTH_TOKEN,
      })

      const result = await client.calls.create(request)
      return c.json(result, 201)
    } catch (error) {
      return c.json(
        { error: { code: 500, message: error instanceof Error ? error.message : 'Unknown error' } },
        500
      )
    }
  })

  // GET /Calls/:sid - Retrieve a call
  router.get('/Calls/:sid', async (c) => {
    try {
      const sid = c.req.param('sid')
      const client = new TwilioClient({
        accountSid: c.env?.TWILIO_ACCOUNT_SID || 'AC_default',
      })

      const call = await client.calls.get(sid)
      return c.json(call)
    } catch (error) {
      if (error instanceof Error && error.message === 'Call not found') {
        return c.json({ error: { code: 20404, message: 'Call not found' } }, 404)
      }
      return c.json({ error: { code: 20404, message: 'Call not found' } }, 404)
    }
  })

  // POST /Calls/:sid - Update a call
  router.post('/Calls/:sid', async (c) => {
    const sid = c.req.param('sid')
    const body = await c.req.json<{ Status?: 'canceled' | 'completed'; Url?: string; Twiml?: string }>()

    const client = new TwilioClient({
      accountSid: c.env?.TWILIO_ACCOUNT_SID || 'AC_default',
    })

    try {
      const call = await client.calls.update(sid, {
        status: body.Status,
        url: body.Url,
        twiml: body.Twiml,
      })
      return c.json(call)
    } catch (error) {
      if (error instanceof Error && error.message === 'Call not found') {
        return c.json({ error: { code: 20404, message: 'Call not found' } }, 404)
      }
      throw error
    }
  })

  // GET /Calls - List calls
  router.get('/Calls', async (c) => {
    const status = c.req.query('Status') as CallStatus | undefined
    const to = c.req.query('To')
    const from = c.req.query('From')

    const client = new TwilioClient({
      accountSid: c.env?.TWILIO_ACCOUNT_SID || 'AC_default',
    })

    const calls = await client.calls.list({
      status,
      to,
      from,
    })

    return c.json({ calls })
  })

  // POST /webhook/voice - Handle inbound voice webhook
  router.post('/webhook/voice', async (c) => {
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

    // Update call status in store
    const call = callStore.get(webhook.CallSid)
    if (call) {
      call.status = webhook.CallStatus
      call.updated_at = new Date()
      callStore.set(webhook.CallSid, call)
    }

    // Return empty TwiML response by default
    const builder = new TwiMLBuilder()
    const twiml = builder.build()

    return c.text(twiml, 200, {
      'Content-Type': 'application/xml',
    })
  })

  // POST /webhook/status - Handle status callback
  router.post('/webhook/status', async (c) => {
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

    // Update call status in store
    const call = callStore.get(webhook.CallSid)
    if (call) {
      call.status = webhook.CallStatus
      if (webhook.CallDuration) {
        call.duration = parseInt(webhook.CallDuration, 10)
      }
      if (webhook.CallStatus === 'completed') {
        call.end_time = new Date()
      }
      call.updated_at = new Date()
      callStore.set(webhook.CallSid, call)
    }

    return c.json({ success: true })
  })

  return router
}

// ============================================================================
// Exports
// ============================================================================

export { TwilioClient as default }
