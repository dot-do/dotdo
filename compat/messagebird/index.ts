/**
 * @dotdo/messagebird - MessageBird API Compatibility Layer
 *
 * Drop-in replacement for MessageBird SDK with edge compatibility.
 * Supports SMS, MMS, Voice, and Phone Number Management APIs.
 *
 * @example
 * ```typescript
 * import { MessageBirdClient, createMessageBirdClient } from '@dotdo/messagebird'
 *
 * const client = createMessageBirdClient('your_access_key')
 *
 * // Send SMS
 * const message = await client.messages.create({
 *   originator: '+15017122661',
 *   recipients: ['+15558675310'],
 *   body: 'Hello from dotdo!',
 * })
 *
 * // Make a voice call
 * const call = await client.voice.calls.create({
 *   source: '+15017122661',
 *   destination: '+15558675310',
 *   callFlow: {
 *     steps: [{ action: 'say', options: { payload: 'Hello!' } }],
 *   },
 * })
 *
 * // List phone numbers
 * const numbers = await client.numbers.list()
 * ```
 *
 * @module @dotdo/messagebird
 */

// =============================================================================
// Types
// =============================================================================

export interface MessageBirdConfig {
  accessKey: string
  signingKey?: string
  timeout?: number
  fetch?: typeof fetch
}

export interface MessageBirdErrorResponse {
  errors: Array<{
    code: number
    description: string
    parameter?: string
  }>
}

// SMS Types
export interface SMSSendRequest {
  originator: string
  recipients: string[]
  body: string
  reference?: string
  scheduledDatetime?: Date
  validity?: number
  type?: 'sms' | 'flash' | 'binary'
  datacoding?: 'plain' | 'unicode' | 'auto'
  reportUrl?: string
}

export interface SMSRecipient {
  recipient: number
  status: 'sent' | 'delivered' | 'delivery_failed' | 'buffered' | 'expired' | 'scheduled'
  statusDatetime: string
  statusErrorCode?: number
}

export interface SMSSendResponse {
  id: string
  href: string
  direction: 'mt' | 'mo'
  type: string
  originator: string
  body: string
  reference: string | null
  validity: number | null
  gateway: number
  typeDetails: Record<string, unknown>
  datacoding: string
  mclass: number
  scheduledDatetime: string | null
  createdDatetime: string
  recipients: {
    totalCount: number
    totalSentCount: number
    totalDeliveredCount: number
    totalDeliveryFailedCount: number
    items: SMSRecipient[]
  }
}

export interface MessageListParams {
  originator?: string
  direction?: 'mt' | 'mo'
  limit?: number
  offset?: number
}

export interface MessageListResponse {
  offset: number
  limit: number
  count: number
  totalCount: number
  items: SMSSendResponse[]
}

// MMS Types
export interface MMSSendRequest {
  originator: string
  recipients: string[]
  body?: string
  mediaUrls: string[]
  reference?: string
  scheduledDatetime?: Date
  reportUrl?: string
}

// Voice Types
export interface CallFlowStep {
  action: 'say' | 'play' | 'gather' | 'record' | 'transfer' | 'hangup' | 'pause' | 'fetchCallFlow'
  options?: Record<string, unknown>
}

export interface CallFlow {
  title?: string
  record?: boolean
  steps: CallFlowStep[]
}

export interface VoiceCallRequest {
  source: string
  destination: string
  callFlow: CallFlow
  webhook?: string
  webhookToken?: string
}

export interface VoiceCallResponse {
  id: string
  status: 'queued' | 'starting' | 'ringing' | 'ongoing' | 'ended'
  source: string
  destination: string
  createdAt?: string
  updatedAt?: string
  answeredAt?: string
  endedAt?: string
  duration?: number
  links?: Record<string, string>
}

export interface CallListResponse {
  data: VoiceCallResponse[]
  pagination?: { totalCount: number; pageCount: number }
}

export interface Recording {
  id: string
  callId: string
  duration: number
  format: string
  status: 'initialised' | 'recording' | 'done' | 'failed'
  links: { file: string }
  createdAt?: string
}

export interface Transcription {
  id: string
  recordingId?: string
  status: 'pending' | 'done' | 'failed'
  text?: string
  language?: string
  createdAt?: string
}

// Phone Number Types
export interface PhoneNumber {
  id: string
  number: string
  country: string
  type: 'local' | 'mobile' | 'toll_free'
  features: string[]
  status: 'active' | 'pending' | 'cancelled'
  smsWebhook?: string
  voiceWebhook?: string
  createdAt?: string
}

export interface PhoneNumberListResponse {
  data: PhoneNumber[]
  pagination?: { totalCount: number }
}

export interface AvailableNumber {
  number: string
  type: string
  features: string[]
  monthlyPrice?: number
}

export interface AvailableNumberSearchResponse {
  data: AvailableNumber[]
}

export interface PurchaseNumberRequest {
  number: string
  country: string
}

// Webhook Types
export interface WebhookPayload {
  id: string
  reference?: string
  recipient?: string
  status: string
  statusDatetime: string
  statusErrorCode?: number
}

export interface InboundWebhookPayload {
  id: string
  originator: string
  recipient: string
  body: string
  createdDatetime: string
}

export interface WebhookResult {
  messageId: string
  status: string
  errorCode?: number
  reference?: string
}

export interface InboundResult {
  from: string
  to: string
  body: string
  messageId: string
}

// Balance Types
export interface Balance {
  payment: 'prepaid' | 'postpaid'
  type: 'credits' | 'euros'
  amount: number
}

// =============================================================================
// Error Class
// =============================================================================

export class MessageBirdError extends Error {
  code: number
  parameter?: string

  constructor(response: MessageBirdErrorResponse) {
    const firstError = response.errors[0]
    super(firstError?.description || 'Unknown MessageBird error')
    this.name = 'MessageBirdError'
    this.code = firstError?.code || 0
    this.parameter = firstError?.parameter
  }
}

// =============================================================================
// Messages Resource
// =============================================================================

class MessagesResource {
  constructor(private client: MessageBirdClient) {}

  async create(params: SMSSendRequest): Promise<SMSSendResponse> {
    this.validateRequest(params)

    const body: Record<string, unknown> = {
      originator: params.originator,
      recipients: params.recipients,
      body: params.body,
    }

    if (params.reference) body.reference = params.reference
    if (params.scheduledDatetime) body.scheduledDatetime = params.scheduledDatetime.toISOString()
    if (params.validity) body.validity = params.validity
    if (params.type) body.type = params.type
    if (params.datacoding) body.datacoding = params.datacoding
    if (params.reportUrl) body.reportUrl = params.reportUrl

    return this.client._request('POST', '/messages', body) as Promise<SMSSendResponse>
  }

  async read(id: string): Promise<SMSSendResponse> {
    return this.client._request('GET', `/messages/${id}`) as Promise<SMSSendResponse>
  }

  async list(params?: MessageListParams): Promise<MessageListResponse> {
    const queryParams: Record<string, string> = {}
    if (params?.originator) queryParams.originator = params.originator
    if (params?.direction) queryParams.direction = params.direction
    if (params?.limit) queryParams.limit = String(params.limit)
    if (params?.offset) queryParams.offset = String(params.offset)

    return this.client._request('GET', '/messages', undefined, queryParams) as Promise<MessageListResponse>
  }

  async delete(id: string): Promise<boolean> {
    await this.client._request('DELETE', `/messages/${id}`)
    return true
  }

  private validateRequest(params: SMSSendRequest): void {
    if (!params.originator) {
      throw new MessageBirdError({
        errors: [{ code: 9, description: 'originator is required', parameter: 'originator' }],
      })
    }
    if (!params.recipients || params.recipients.length === 0) {
      throw new MessageBirdError({
        errors: [{ code: 9, description: 'recipients is required', parameter: 'recipients' }],
      })
    }
    if (!params.body) {
      throw new MessageBirdError({
        errors: [{ code: 9, description: 'body is required', parameter: 'body' }],
      })
    }
  }
}

// =============================================================================
// MMS Resource
// =============================================================================

class MMSResource {
  constructor(private client: MessageBirdClient) {}

  async create(params: MMSSendRequest): Promise<SMSSendResponse> {
    const body: Record<string, unknown> = {
      originator: params.originator,
      recipients: params.recipients,
      mediaUrls: params.mediaUrls,
    }

    if (params.body) body.body = params.body
    if (params.reference) body.reference = params.reference
    if (params.scheduledDatetime) body.scheduledDatetime = params.scheduledDatetime.toISOString()
    if (params.reportUrl) body.reportUrl = params.reportUrl

    return this.client._request('POST', '/mms', body) as Promise<SMSSendResponse>
  }
}

// =============================================================================
// Voice Resources
// =============================================================================

class CallsResource {
  constructor(private client: MessageBirdClient) {}

  async create(params: VoiceCallRequest): Promise<VoiceCallResponse> {
    const body: Record<string, unknown> = {
      source: params.source,
      destination: params.destination,
      callFlow: params.callFlow,
    }

    if (params.webhook) body.webhook = params.webhook
    if (params.webhookToken) body.webhookToken = params.webhookToken

    const response = await this.client._request('POST', '/calls', body) as { data: VoiceCallResponse[] }
    return response.data[0]
  }

  async read(id: string): Promise<VoiceCallResponse> {
    const response = await this.client._request('GET', `/calls/${id}`) as { data: VoiceCallResponse[] }
    return response.data[0]
  }

  async list(params?: { limit?: number; offset?: number }): Promise<CallListResponse> {
    const queryParams: Record<string, string> = {}
    if (params?.limit) queryParams.limit = String(params.limit)
    if (params?.offset) queryParams.offset = String(params.offset)

    return this.client._request('GET', '/calls', undefined, queryParams) as Promise<CallListResponse>
  }

  async update(id: string, params: { callFlow: CallFlow }): Promise<VoiceCallResponse> {
    const response = await this.client._request('PUT', `/calls/${id}`, params) as { data: VoiceCallResponse[] }
    return response.data[0]
  }

  async delete(id: string): Promise<boolean> {
    await this.client._request('DELETE', `/calls/${id}`)
    return true
  }
}

class RecordingsResource {
  constructor(private client: MessageBirdClient) {}

  async list(callId: string): Promise<{ data: Recording[] }> {
    return this.client._request('GET', `/calls/${callId}/recordings`) as Promise<{ data: Recording[] }>
  }

  async read(callId: string, recordingId: string): Promise<Recording> {
    const response = await this.client._request(
      'GET',
      `/calls/${callId}/recordings/${recordingId}`
    ) as { data: Recording[] }
    return response.data[0]
  }

  async delete(callId: string, recordingId: string): Promise<boolean> {
    await this.client._request('DELETE', `/calls/${callId}/recordings/${recordingId}`)
    return true
  }
}

class TranscriptionsResource {
  constructor(private client: MessageBirdClient) {}

  async create(
    callId: string,
    recordingId: string,
    params: { language: string }
  ): Promise<Transcription> {
    const response = await this.client._request(
      'POST',
      `/calls/${callId}/recordings/${recordingId}/transcriptions`,
      params
    ) as { data: Transcription[] }
    return response.data[0]
  }

  async read(callId: string, recordingId: string, transcriptionId: string): Promise<Transcription> {
    const response = await this.client._request(
      'GET',
      `/calls/${callId}/recordings/${recordingId}/transcriptions/${transcriptionId}`
    ) as { data: Transcription[] }
    return response.data[0]
  }
}

class VoiceResource {
  calls: CallsResource
  recordings: RecordingsResource
  transcriptions: TranscriptionsResource

  constructor(client: MessageBirdClient) {
    this.calls = new CallsResource(client)
    this.recordings = new RecordingsResource(client)
    this.transcriptions = new TranscriptionsResource(client)
  }
}

// =============================================================================
// Phone Numbers Resource
// =============================================================================

class NumbersResource {
  constructor(private client: MessageBirdClient) {}

  async list(params?: { country?: string; features?: string[] }): Promise<PhoneNumberListResponse> {
    const queryParams: Record<string, string> = {}
    if (params?.country) queryParams.country = params.country
    if (params?.features) queryParams.features = params.features.join(',')

    return this.client._request('GET', '/phone-numbers', undefined, queryParams) as Promise<PhoneNumberListResponse>
  }

  async read(id: string): Promise<PhoneNumber> {
    const response = await this.client._request('GET', `/phone-numbers/${id}`) as { data: PhoneNumber[] }
    return response.data[0]
  }

  async searchAvailable(
    country: string,
    params?: { features?: string[]; type?: string }
  ): Promise<AvailableNumberSearchResponse> {
    const queryParams: Record<string, string> = {}
    if (params?.features) queryParams.features = params.features.join(',')
    if (params?.type) queryParams.type = params.type

    return this.client._request(
      'GET',
      `/available-phone-numbers/${country}`,
      undefined,
      queryParams
    ) as Promise<AvailableNumberSearchResponse>
  }

  async purchase(params: PurchaseNumberRequest): Promise<PhoneNumber> {
    const response = await this.client._request('POST', '/phone-numbers', params) as { data: PhoneNumber[] }
    return response.data[0]
  }

  async update(id: string, params: { smsWebhook?: string; voiceWebhook?: string }): Promise<PhoneNumber> {
    const response = await this.client._request('PATCH', `/phone-numbers/${id}`, params) as { data: PhoneNumber[] }
    return response.data[0]
  }

  async cancel(id: string): Promise<boolean> {
    await this.client._request('DELETE', `/phone-numbers/${id}`)
    return true
  }
}

// =============================================================================
// Balance Resource
// =============================================================================

class BalanceResource {
  constructor(private client: MessageBirdClient) {}

  async read(): Promise<Balance> {
    return this.client._request('GET', '/balance') as Promise<Balance>
  }
}

// =============================================================================
// MessageBird Client
// =============================================================================

const DEFAULT_BASE_URL = 'https://rest.messagebird.com'
const DEFAULT_VOICE_URL = 'https://voice.messagebird.com'
const DEFAULT_TIMEOUT = 30000

export class MessageBirdClient {
  private accessKey: string
  private signingKey?: string
  private baseUrl: string
  private voiceUrl: string
  private timeout: number
  private _fetch: typeof fetch

  // Resources
  messages: MessagesResource
  mms: MMSResource
  voice: VoiceResource
  numbers: NumbersResource
  balance: BalanceResource

  constructor(config: MessageBirdConfig) {
    if (!config.accessKey) {
      throw new Error('accessKey is required')
    }

    this.accessKey = config.accessKey
    this.signingKey = config.signingKey
    this.baseUrl = DEFAULT_BASE_URL
    this.voiceUrl = DEFAULT_VOICE_URL
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)

    // Initialize resources
    this.messages = new MessagesResource(this)
    this.mms = new MMSResource(this)
    this.voice = new VoiceResource(this)
    this.numbers = new NumbersResource(this)
    this.balance = new BalanceResource(this)
  }

  /**
   * Handle incoming webhook payload
   */
  handleWebhook(payload: WebhookPayload): WebhookResult {
    return {
      messageId: payload.id,
      status: payload.status,
      errorCode: payload.statusErrorCode,
      reference: payload.reference,
    }
  }

  /**
   * Handle inbound message webhook
   */
  handleInboundWebhook(payload: InboundWebhookPayload): InboundResult {
    return {
      from: payload.originator,
      to: payload.recipient,
      body: payload.body,
      messageId: payload.id,
    }
  }

  /**
   * Verify webhook signature
   */
  async verifyWebhookSignature(
    signature: string,
    timestamp: string,
    body: string
  ): Promise<boolean> {
    if (!this.signingKey) {
      return false
    }

    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(timestamp + body)
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(this.signingKey),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const expectedSignature = await crypto.subtle.sign('HMAC', key, data)
      const expectedHex = Array.from(new Uint8Array(expectedSignature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      return this.secureCompare(signature, expectedHex)
    } catch {
      return false
    }
  }

  /**
   * Make API request
   * @internal
   */
  async _request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
    queryParams?: Record<string, string>
  ): Promise<unknown> {
    // Use voice URL for voice-related endpoints
    const baseUrl = path.startsWith('/calls') ? this.voiceUrl : this.baseUrl
    const url = new URL(path, baseUrl)

    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value)
      }
    }

    const headers: Record<string, string> = {
      Authorization: `AccessKey ${this.accessKey}`,
      'Content-Type': 'application/json',
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await this._fetch(url.toString(), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      if (method === 'DELETE' && response.status === 204) {
        return true
      }

      const data = await response.json()

      if (!response.ok) {
        throw new MessageBirdError(data as MessageBirdErrorResponse)
      }

      return data
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Constant-time string comparison
   */
  private secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }
}

// =============================================================================
// Unified SMS Interface (MessageBirdSMS)
// =============================================================================

export interface MessageBirdSMSConfig {
  accessKey: string
  defaultOriginator?: string
  statusCallbackUrl?: string
  signingKey?: string
  timeout?: number
  fetch?: typeof fetch
}

export interface UnifiedSMSSendRequest {
  to: string
  body: string
  from?: string
  reference?: string
  mediaUrl?: string[]
  scheduledDatetime?: Date
}

export interface UnifiedSMSSendResult {
  delivered: boolean
  messageId: string
  status: string
}

export interface UnifiedStatusResult {
  messageId: string
  status: string
  deliveredCount: number
  failedCount: number
}

/**
 * MessageBirdSMS - Unified SMS interface compatible with lib/channels/sms pattern
 */
export class MessageBirdSMS {
  private client: MessageBirdClient
  private defaultOriginator?: string
  private statusCallbackUrl?: string

  constructor(config: MessageBirdSMSConfig) {
    this.client = new MessageBirdClient({
      accessKey: config.accessKey,
      signingKey: config.signingKey,
      timeout: config.timeout,
      fetch: config.fetch,
    })
    this.defaultOriginator = config.defaultOriginator
    this.statusCallbackUrl = config.statusCallbackUrl
  }

  /**
   * Send an SMS message
   */
  async send(request: UnifiedSMSSendRequest): Promise<UnifiedSMSSendResult> {
    const originator = request.from || this.defaultOriginator
    if (!originator) {
      throw new MessageBirdError({
        errors: [{ code: 9, description: 'originator is required', parameter: 'originator' }],
      })
    }

    // If media URLs are provided, send as MMS
    if (request.mediaUrl && request.mediaUrl.length > 0) {
      const response = await this.client.mms.create({
        originator,
        recipients: [request.to],
        body: request.body,
        mediaUrls: request.mediaUrl,
        reference: request.reference,
        scheduledDatetime: request.scheduledDatetime,
        reportUrl: this.statusCallbackUrl,
      })

      return {
        delivered: response.recipients.totalSentCount > 0,
        messageId: response.id,
        status: response.recipients.items[0]?.status || 'sent',
      }
    }

    // Send as SMS
    const response = await this.client.messages.create({
      originator,
      recipients: [request.to],
      body: request.body,
      reference: request.reference,
      scheduledDatetime: request.scheduledDatetime,
      reportUrl: this.statusCallbackUrl,
    })

    return {
      delivered: response.recipients.totalSentCount > 0,
      messageId: response.id,
      status: response.recipients.items[0]?.status || 'sent',
    }
  }

  /**
   * Get message status
   */
  async getStatus(messageId: string): Promise<UnifiedStatusResult> {
    const message = await this.client.messages.read(messageId)

    return {
      messageId: message.id,
      status: message.recipients.items[0]?.status || 'unknown',
      deliveredCount: message.recipients.totalDeliveredCount,
      failedCount: message.recipients.totalDeliveryFailedCount,
    }
  }

  /**
   * Handle webhook
   */
  handleWebhook(payload: WebhookPayload): WebhookResult {
    return this.client.handleWebhook(payload)
  }

  /**
   * Handle inbound message webhook
   */
  handleInboundWebhook(payload: InboundWebhookPayload): InboundResult {
    return this.client.handleInboundWebhook(payload)
  }

  /**
   * Verify webhook signature
   */
  async verifyWebhookSignature(
    signature: string,
    timestamp: string,
    body: string
  ): Promise<boolean> {
    return this.client.verifyWebhookSignature(signature, timestamp, body)
  }
}

// =============================================================================
// Voice Interface (MessageBirdVoice)
// =============================================================================

/**
 * MessageBirdVoice - Simplified voice API interface
 */
export class MessageBirdVoice {
  private client: MessageBirdClient

  constructor(config: MessageBirdConfig) {
    this.client = new MessageBirdClient(config)
  }

  /**
   * Make an outbound call
   */
  async call(params: VoiceCallRequest): Promise<VoiceCallResponse> {
    return this.client.voice.calls.create(params)
  }

  /**
   * Get call by ID
   */
  async getCall(callId: string): Promise<VoiceCallResponse> {
    return this.client.voice.calls.read(callId)
  }

  /**
   * List calls
   */
  async listCalls(): Promise<CallListResponse> {
    return this.client.voice.calls.list()
  }

  /**
   * End a call
   */
  async endCall(callId: string): Promise<boolean> {
    return this.client.voice.calls.delete(callId)
  }

  /**
   * Get recordings for a call
   */
  async getRecordings(callId: string): Promise<Recording[]> {
    const response = await this.client.voice.recordings.list(callId)
    return response.data
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a MessageBird client
 */
export function createMessageBirdClient(accessKey: string, config?: Omit<MessageBirdConfig, 'accessKey'>): MessageBirdClient {
  return new MessageBirdClient({ accessKey, ...config })
}

/**
 * Create a MessageBird SMS client with unified interface
 */
export function createMessageBirdSMS(config: MessageBirdSMSConfig): MessageBirdSMS {
  return new MessageBirdSMS(config)
}

/**
 * Create a MessageBird Voice client
 */
export function createMessageBirdVoice(accessKey: string, config?: Omit<MessageBirdConfig, 'accessKey'>): MessageBirdVoice {
  return new MessageBirdVoice({ accessKey, ...config })
}

// =============================================================================
// Default Export
// =============================================================================

export default MessageBirdClient
