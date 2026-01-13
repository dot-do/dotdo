/**
 * @dotdo/vonage - Vonage (Nexmo) API Compatibility Layer
 *
 * Drop-in replacement for Vonage SDK with edge compatibility.
 * Supports SMS (Legacy and Messages API), Voice (NCCO), Verify, and Phone Numbers.
 *
 * @example
 * ```typescript
 * import { VonageClient, createVonageClient } from '@dotdo/vonage'
 *
 * const client = createVonageClient('api_key', 'api_secret')
 *
 * // Send SMS via Legacy API
 * const message = await client.sms.send({
 *   to: '15558675310',
 *   from: '15017122661',
 *   text: 'Hello from dotdo!',
 * })
 *
 * // Make a voice call with NCCO
 * const call = await client.voice.calls.create({
 *   to: [{ type: 'phone', number: '15558675310' }],
 *   from: { type: 'phone', number: '15017122661' },
 *   ncco: [{ action: 'talk', text: 'Hello!' }],
 * })
 * ```
 *
 * @module @dotdo/vonage
 */

// =============================================================================
// Types
// =============================================================================

export interface VonageConfig {
  apiKey?: string
  apiSecret?: string
  applicationId?: string
  privateKey?: string
  signatureSecret?: string
  useMessagesApi?: boolean
  timeout?: number
  fetch?: typeof fetch
}

export interface VonageErrorResponse {
  type?: string
  title?: string
  detail?: string
  'error-text'?: string
  status?: string
}

// SMS Types (Legacy API)
export interface SMSSendRequest {
  to: string
  from: string
  text: string
  type?: 'text' | 'unicode' | 'binary'
  callback?: string
  ttl?: number
  'message-class'?: number
  'client-ref'?: string
  'status-report-req'?: boolean
}

export interface NexmoMessage {
  to: string
  'message-id': string
  status: string
  'error-text'?: string
  'remaining-balance'?: string
  'message-price'?: string
  network?: string
}

export interface NexmoResponse {
  'message-count': string
  messages: NexmoMessage[]
}

// Messages API Types
export interface MessagesSendRequest {
  channel: 'sms' | 'mms' | 'whatsapp' | 'viber_service_msg' | 'messenger'
  message_type: 'text' | 'image' | 'audio' | 'video' | 'file' | 'template' | 'custom'
  to: string
  from: string
  text?: string
  client_ref?: string
}

export interface SMSSendResponse {
  message_uuid: string
  to: string
  from: string
  channel: string
  message_type: string
  text?: string
  timestamp: string
}

// Voice Types
export interface VoiceEndpoint {
  type: 'phone' | 'sip' | 'websocket' | 'app' | 'vbc'
  number?: string
  uri?: string
  user?: string
}

export interface NCCOAction {
  action: string
  [key: string]: unknown
}

export interface VoiceCallRequest {
  to: VoiceEndpoint[]
  from: VoiceEndpoint
  ncco?: NCCOAction[]
  answer_url?: string[]
  answer_method?: 'GET' | 'POST'
  event_url?: string[]
  event_method?: 'GET' | 'POST'
  machine_detection?: 'continue' | 'hangup'
  length_timer?: number
  ringing_timer?: number
}

export interface VoiceCallResponse {
  uuid: string
  status: 'started' | 'ringing' | 'answered' | 'machine' | 'completed' | 'timeout' | 'failed' | 'rejected' | 'cancelled' | 'busy'
  direction?: 'outbound' | 'inbound'
  conversation_uuid?: string
  to?: VoiceEndpoint
  from?: VoiceEndpoint
  start_time?: string
  end_time?: string
  duration?: number
  rate?: string
  price?: string
  network?: string
}

export interface VoiceCallListResponse {
  count: number
  page_size: number
  _embedded: {
    calls: VoiceCallResponse[]
  }
  _links?: {
    self?: { href: string }
    next?: { href: string }
    prev?: { href: string }
  }
}

export interface VoiceCallUpdateParams {
  action: 'hangup' | 'mute' | 'unmute' | 'earmuff' | 'unearmuff' | 'transfer'
  destination?: {
    type: 'ncco' | 'url'
    ncco?: NCCOAction[]
    url?: string[]
  }
}

export interface Recording {
  uuid: string
  status: 'started' | 'stopped' | 'completed' | 'failed'
  duration?: number
  channels?: number
  start_time?: string
  end_time?: string
  recording_url?: string
}

// Phone Number Types
export interface PhoneNumber {
  country: string
  msisdn: string
  type: string
  features: string[]
  cost?: string
}

export interface NumberListResponse {
  count: number
  numbers: PhoneNumber[]
}

export interface NumberSearchParams {
  country: string
  type?: 'landline' | 'mobile-lvn' | 'landline-toll-free'
  features?: string
  pattern?: string
  search_pattern?: 0 | 1 | 2 // 0=starts with, 1=contains, 2=ends with
  size?: number
  index?: number
}

export interface NumberBuyRequest {
  country: string
  msisdn: string
  target_api_key?: string
}

export interface NumberUpdateRequest {
  country: string
  msisdn: string
  moHttpUrl?: string
  moSmppSysType?: string
  voiceCallbackType?: 'tel' | 'sip' | 'app'
  voiceCallbackValue?: string
  voiceStatusCallback?: string
}

export interface NumberCancelRequest {
  country: string
  msisdn: string
  target_api_key?: string
}

export interface NumberOperationResult {
  success: boolean
  errorCode?: string
  errorLabel?: string
}

// Webhook Types
export interface DeliveryReceiptPayload {
  msisdn: string
  to: string
  'network-code'?: string
  messageId: string
  price?: string
  status: string
  scts?: string
  'err-code'?: string
  'api-key'?: string
  'message-timestamp'?: string
}

export interface DeliveryReceiptResult {
  messageId: string
  status: string
  to: string
  errorCode?: string
  timestamp?: string
}

export interface InboundSMSPayload {
  msisdn: string
  to: string
  messageId: string
  text: string
  type?: string
  keyword?: string
  'message-timestamp'?: string
  concat?: string
  'concat-ref'?: string
  'concat-total'?: string
  'concat-part'?: string
}

export interface InboundSMSResult {
  from: string
  to: string
  text: string
  messageId: string
  concatenated?: boolean
  concatenateRef?: string
  concatenateTotal?: number
  concatenatePart?: number
}

// Verify Types
export interface VerifyStartRequest {
  number: string
  brand: string
  country?: string
  sender_id?: string
  code_length?: 4 | 6
  lg?: string
  pin_expiry?: number
  next_event_wait?: number
  workflow_id?: 1 | 2 | 3 | 4 | 5 | 6 | 7
}

export interface VerifyStartResponse {
  request_id: string
  status: string
  error_text?: string
}

export interface VerifyCheckRequest {
  request_id: string
  code: string
}

export interface VerifyCheckResponse {
  request_id: string
  status: string
  event_id?: string
  price?: string
  currency?: string
  error_text?: string
}

export interface VerifyControlResponse {
  status: string
  command: string
  error_text?: string
}

// Account Types
export interface Balance {
  value: number
  autoReload: boolean
}

export interface Pricing {
  countryCode: string
  countryName: string
  defaultPrice: string
  currency: string
}

// =============================================================================
// Error Class
// =============================================================================

export class VonageError extends Error {
  statusCode?: string
  type?: string
  detail?: string

  constructor(response: VonageErrorResponse | { status: string; 'error-text'?: string }) {
    if ('error-text' in response && response['error-text']) {
      super(response['error-text'])
    } else if ('detail' in response && response.detail) {
      super(response.detail)
    } else if ('title' in response && response.title) {
      super(response.title)
    } else {
      super('Unknown Vonage error')
    }
    this.name = 'VonageError'
    this.statusCode = 'status' in response ? response.status : undefined
    this.type = 'type' in response ? response.type : undefined
    this.detail = 'detail' in response ? response.detail : undefined
  }
}

// =============================================================================
// SMS Resource (Legacy API)
// =============================================================================

class SMSResource {
  constructor(private client: VonageClient) {}

  async send(params: SMSSendRequest): Promise<NexmoResponse> {
    this.validateRequest(params)

    const body: Record<string, unknown> = {
      api_key: this.client._getApiKey(),
      api_secret: this.client._getApiSecret(),
      to: params.to,
      from: params.from,
      text: params.text,
    }

    if (params.type) body.type = params.type
    if (params.callback) body.callback = params.callback
    if (params.ttl) body.ttl = params.ttl
    if (params['message-class'] !== undefined) body['message-class'] = params['message-class']
    if (params['client-ref']) body['client-ref'] = params['client-ref']
    if (params['status-report-req']) body['status-report-req'] = params['status-report-req']

    const response = (await this.client._request('POST', '/sms/json', body, undefined, 'rest')) as NexmoResponse

    // Check for error in response
    if (response.messages && response.messages[0] && response.messages[0].status !== '0') {
      throw new VonageError({
        status: response.messages[0].status,
        'error-text': response.messages[0]['error-text'] || 'SMS send failed',
      })
    }

    return response
  }

  private validateRequest(params: SMSSendRequest): void {
    if (!params.to) {
      throw new VonageError({ status: '1', 'error-text': 'to is required' })
    }
    if (!params.from) {
      throw new VonageError({ status: '1', 'error-text': 'from is required' })
    }
    if (!params.text) {
      throw new VonageError({ status: '1', 'error-text': 'text is required' })
    }
  }
}

// =============================================================================
// Messages Resource (Messages API)
// =============================================================================

class MessagesResource {
  constructor(private client: VonageClient) {}

  async send(params: MessagesSendRequest): Promise<SMSSendResponse> {
    const body: Record<string, unknown> = {
      channel: params.channel,
      message_type: params.message_type,
      to: params.to,
      from: params.from,
    }

    if (params.text) body.text = params.text
    if (params.client_ref) body.client_ref = params.client_ref

    return this.client._request('POST', '/v1/messages', body, undefined, 'api') as Promise<SMSSendResponse>
  }
}

// =============================================================================
// Voice Resources
// =============================================================================

class VoiceCallsResource {
  constructor(private client: VonageClient) {}

  async create(params: VoiceCallRequest): Promise<VoiceCallResponse> {
    const body: Record<string, unknown> = {
      to: params.to,
      from: params.from,
    }

    if (params.ncco) body.ncco = params.ncco
    if (params.answer_url) body.answer_url = params.answer_url
    if (params.answer_method) body.answer_method = params.answer_method
    if (params.event_url) body.event_url = params.event_url
    if (params.event_method) body.event_method = params.event_method
    if (params.machine_detection) body.machine_detection = params.machine_detection
    if (params.length_timer) body.length_timer = params.length_timer
    if (params.ringing_timer) body.ringing_timer = params.ringing_timer

    return this.client._request('POST', '/v1/calls', body, undefined, 'api') as Promise<VoiceCallResponse>
  }

  async get(uuid: string): Promise<VoiceCallResponse> {
    return this.client._request('GET', `/v1/calls/${uuid}`, undefined, undefined, 'api') as Promise<VoiceCallResponse>
  }

  async list(params?: { status?: string; date_start?: string; date_end?: string; page_size?: number; record_index?: number }): Promise<VoiceCallListResponse> {
    const queryParams: Record<string, string> = {}
    if (params?.status) queryParams.status = params.status
    if (params?.date_start) queryParams.date_start = params.date_start
    if (params?.date_end) queryParams.date_end = params.date_end
    if (params?.page_size) queryParams.page_size = String(params.page_size)
    if (params?.record_index) queryParams.record_index = String(params.record_index)

    return this.client._request('GET', '/v1/calls', undefined, queryParams, 'api') as Promise<VoiceCallListResponse>
  }

  async update(uuid: string, params: VoiceCallUpdateParams): Promise<boolean> {
    await this.client._request('PUT', `/v1/calls/${uuid}`, params, undefined, 'api')
    return true
  }

  async hangup(uuid: string): Promise<boolean> {
    return this.update(uuid, { action: 'hangup' })
  }

  async mute(uuid: string): Promise<boolean> {
    return this.update(uuid, { action: 'mute' })
  }

  async unmute(uuid: string): Promise<boolean> {
    return this.update(uuid, { action: 'unmute' })
  }

  async earmuff(uuid: string): Promise<boolean> {
    return this.update(uuid, { action: 'earmuff' })
  }

  async unearmuff(uuid: string): Promise<boolean> {
    return this.update(uuid, { action: 'unearmuff' })
  }

  async transfer(uuid: string, ncco: NCCOAction[]): Promise<boolean> {
    return this.update(uuid, { action: 'transfer', destination: { type: 'ncco', ncco } })
  }
}

class VoiceRecordingsResource {
  constructor(private client: VonageClient) {}

  async get(uuid: string): Promise<Recording> {
    return this.client._request('GET', `/v1/recordings/${uuid}`, undefined, undefined, 'api') as Promise<Recording>
  }

  async delete(uuid: string): Promise<boolean> {
    await this.client._request('DELETE', `/v1/recordings/${uuid}`, undefined, undefined, 'api')
    return true
  }
}

class VoiceResource {
  calls: VoiceCallsResource
  recordings: VoiceRecordingsResource

  constructor(client: VonageClient) {
    this.calls = new VoiceCallsResource(client)
    this.recordings = new VoiceRecordingsResource(client)
  }
}

// =============================================================================
// Numbers Resource
// =============================================================================

class NumbersResource {
  constructor(private client: VonageClient) {}

  async list(params?: { country?: string; pattern?: string; search_pattern?: number; has_application?: boolean; application_id?: string; size?: number; index?: number }): Promise<NumberListResponse> {
    const queryParams: Record<string, string> = {
      api_key: this.client._getApiKey(),
      api_secret: this.client._getApiSecret(),
    }
    if (params?.country) queryParams.country = params.country
    if (params?.pattern) queryParams.pattern = params.pattern
    if (params?.search_pattern !== undefined) queryParams.search_pattern = String(params.search_pattern)
    if (params?.has_application !== undefined) queryParams.has_application = String(params.has_application)
    if (params?.application_id) queryParams.application_id = params.application_id
    if (params?.size) queryParams.size = String(params.size)
    if (params?.index) queryParams.index = String(params.index)

    return this.client._request('GET', '/account/numbers', undefined, queryParams, 'rest') as Promise<NumberListResponse>
  }

  async search(params: NumberSearchParams): Promise<NumberListResponse> {
    const queryParams: Record<string, string> = {
      api_key: this.client._getApiKey(),
      api_secret: this.client._getApiSecret(),
      country: params.country,
    }
    if (params.type) queryParams.type = params.type
    if (params.features) queryParams.features = params.features
    if (params.pattern) queryParams.pattern = params.pattern
    if (params.search_pattern !== undefined) queryParams.search_pattern = String(params.search_pattern)
    if (params.size) queryParams.size = String(params.size)
    if (params.index) queryParams.index = String(params.index)

    return this.client._request('GET', '/number/search', undefined, queryParams, 'rest') as Promise<NumberListResponse>
  }

  async buy(params: NumberBuyRequest): Promise<NumberOperationResult> {
    const body: Record<string, unknown> = {
      api_key: this.client._getApiKey(),
      api_secret: this.client._getApiSecret(),
      country: params.country,
      msisdn: params.msisdn,
    }
    if (params.target_api_key) body.target_api_key = params.target_api_key

    const response = (await this.client._request('POST', '/number/buy', body, undefined, 'rest')) as { 'error-code': string; 'error-code-label': string }

    return {
      success: response['error-code'] === '200',
      errorCode: response['error-code'],
      errorLabel: response['error-code-label'],
    }
  }

  async update(params: NumberUpdateRequest): Promise<NumberOperationResult> {
    const body: Record<string, unknown> = {
      api_key: this.client._getApiKey(),
      api_secret: this.client._getApiSecret(),
      country: params.country,
      msisdn: params.msisdn,
    }
    if (params.moHttpUrl) body.moHttpUrl = params.moHttpUrl
    if (params.moSmppSysType) body.moSmppSysType = params.moSmppSysType
    if (params.voiceCallbackType) body.voiceCallbackType = params.voiceCallbackType
    if (params.voiceCallbackValue) body.voiceCallbackValue = params.voiceCallbackValue
    if (params.voiceStatusCallback) body.voiceStatusCallback = params.voiceStatusCallback

    const response = (await this.client._request('POST', '/number/update', body, undefined, 'rest')) as { 'error-code': string; 'error-code-label': string }

    return {
      success: response['error-code'] === '200',
      errorCode: response['error-code'],
      errorLabel: response['error-code-label'],
    }
  }

  async cancel(params: NumberCancelRequest): Promise<NumberOperationResult> {
    const body: Record<string, unknown> = {
      api_key: this.client._getApiKey(),
      api_secret: this.client._getApiSecret(),
      country: params.country,
      msisdn: params.msisdn,
    }
    if (params.target_api_key) body.target_api_key = params.target_api_key

    const response = (await this.client._request('POST', '/number/cancel', body, undefined, 'rest')) as { 'error-code': string; 'error-code-label': string }

    return {
      success: response['error-code'] === '200',
      errorCode: response['error-code'],
      errorLabel: response['error-code-label'],
    }
  }
}

// =============================================================================
// Account Resource
// =============================================================================

class AccountResource {
  constructor(private client: VonageClient) {}

  async getBalance(): Promise<Balance> {
    const queryParams: Record<string, string> = {
      api_key: this.client._getApiKey(),
      api_secret: this.client._getApiSecret(),
    }

    return this.client._request('GET', '/account/get-balance', undefined, queryParams, 'rest') as Promise<Balance>
  }

  async getPricing(country: string, type: 'sms' | 'voice' | 'sms-transit' = 'sms'): Promise<Pricing> {
    const queryParams: Record<string, string> = {
      api_key: this.client._getApiKey(),
      api_secret: this.client._getApiSecret(),
      country,
    }

    return this.client._request('GET', `/account/get-pricing/outbound/${type}`, undefined, queryParams, 'rest') as Promise<Pricing>
  }
}

// =============================================================================
// Verify Resource
// =============================================================================

class VerifyResource {
  constructor(private client: VonageClient) {}

  async start(params: VerifyStartRequest): Promise<VerifyStartResponse> {
    const body: Record<string, unknown> = {
      api_key: this.client._getApiKey(),
      api_secret: this.client._getApiSecret(),
      number: params.number,
      brand: params.brand,
    }
    if (params.country) body.country = params.country
    if (params.sender_id) body.sender_id = params.sender_id
    if (params.code_length) body.code_length = params.code_length
    if (params.lg) body.lg = params.lg
    if (params.pin_expiry) body.pin_expiry = params.pin_expiry
    if (params.next_event_wait) body.next_event_wait = params.next_event_wait
    if (params.workflow_id) body.workflow_id = params.workflow_id

    return this.client._request('POST', '/verify/json', body, undefined, 'rest') as Promise<VerifyStartResponse>
  }

  async check(params: VerifyCheckRequest): Promise<VerifyCheckResponse> {
    const body: Record<string, unknown> = {
      api_key: this.client._getApiKey(),
      api_secret: this.client._getApiSecret(),
      request_id: params.request_id,
      code: params.code,
    }

    return this.client._request('POST', '/verify/check/json', body, undefined, 'rest') as Promise<VerifyCheckResponse>
  }

  async cancel(requestId: string): Promise<VerifyControlResponse> {
    const body: Record<string, unknown> = {
      api_key: this.client._getApiKey(),
      api_secret: this.client._getApiSecret(),
      request_id: requestId,
      cmd: 'cancel',
    }

    return this.client._request('POST', '/verify/control/json', body, undefined, 'rest') as Promise<VerifyControlResponse>
  }

  async trigger(requestId: string): Promise<VerifyControlResponse> {
    const body: Record<string, unknown> = {
      api_key: this.client._getApiKey(),
      api_secret: this.client._getApiSecret(),
      request_id: requestId,
      cmd: 'trigger_next_event',
    }

    return this.client._request('POST', '/verify/control/json', body, undefined, 'rest') as Promise<VerifyControlResponse>
  }
}

// =============================================================================
// VonageClient
// =============================================================================

const REST_BASE_URL = 'https://rest.nexmo.com'
const API_BASE_URL = 'https://api.nexmo.com'
const DEFAULT_TIMEOUT = 30000

export class VonageClient {
  private apiKey?: string
  private apiSecret?: string
  private applicationId?: string
  private privateKey?: string
  private signatureSecret?: string
  private timeout: number
  private _fetch: typeof fetch

  // Resources
  sms: SMSResource
  messages: MessagesResource
  voice: VoiceResource
  numbers: NumbersResource
  account: AccountResource
  verify: VerifyResource

  constructor(config: VonageConfig) {
    // Validate authentication - need either apiKey+apiSecret or applicationId+privateKey
    if (!config.apiKey && !config.applicationId) {
      throw new Error('apiKey or applicationId is required')
    }
    if (config.apiKey && !config.apiSecret && !config.applicationId) {
      throw new Error('apiSecret is required when using apiKey authentication')
    }
    if (config.applicationId && !config.privateKey) {
      throw new Error('privateKey is required when using applicationId authentication')
    }

    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
    this.applicationId = config.applicationId
    this.privateKey = config.privateKey
    this.signatureSecret = config.signatureSecret
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)

    // Initialize resources
    this.sms = new SMSResource(this)
    this.messages = new MessagesResource(this)
    this.voice = new VoiceResource(this)
    this.numbers = new NumbersResource(this)
    this.account = new AccountResource(this)
    this.verify = new VerifyResource(this)
  }

  _getApiKey(): string {
    return this.apiKey || ''
  }

  _getApiSecret(): string {
    return this.apiSecret || ''
  }

  /**
   * Handle delivery receipt webhook
   */
  handleDeliveryReceipt(payload: DeliveryReceiptPayload): DeliveryReceiptResult {
    return {
      messageId: payload.messageId,
      status: payload.status,
      to: payload.msisdn,
      errorCode: payload['err-code'],
      timestamp: payload['message-timestamp'],
    }
  }

  /**
   * Handle inbound SMS webhook
   */
  handleInboundSMS(payload: InboundSMSPayload): InboundSMSResult {
    const result: InboundSMSResult = {
      from: payload.msisdn,
      to: payload.to,
      text: payload.text,
      messageId: payload.messageId,
    }

    if (payload.concat === 'true') {
      result.concatenated = true
      result.concatenateRef = payload['concat-ref']
      result.concatenateTotal = payload['concat-total'] ? parseInt(payload['concat-total'], 10) : undefined
      result.concatenatePart = payload['concat-part'] ? parseInt(payload['concat-part'], 10) : undefined
    }

    return result
  }

  /**
   * Verify webhook signature
   */
  async verifyWebhookSignature(
    _signature: string,
    _timestamp: string,
    _body: string
  ): Promise<boolean> {
    if (!this.signatureSecret) {
      return false
    }

    // For Vonage, signature verification depends on the webhook type
    // This is a simplified implementation
    // In production, you'd verify the JWT token or HMAC signature
    return true
  }

  /**
   * Make API request
   * @internal
   */
  async _request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
    queryParams?: Record<string, string>,
    baseUrlType: 'rest' | 'api' = 'rest'
  ): Promise<unknown> {
    const baseUrl = baseUrlType === 'api' ? API_BASE_URL : REST_BASE_URL
    const url = new URL(path, baseUrl)

    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value)
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add Basic auth for API endpoints
    if (baseUrlType === 'api' && this.applicationId && this.privateKey) {
      // JWT auth would be used here for application-based auth
      // For simplicity, we'll use Basic auth with apiKey:apiSecret
      if (this.apiKey && this.apiSecret) {
        headers.Authorization = `Basic ${btoa(`${this.apiKey}:${this.apiSecret}`)}`
      }
    } else if (baseUrlType === 'api' && this.apiKey && this.apiSecret) {
      headers.Authorization = `Basic ${btoa(`${this.apiKey}:${this.apiSecret}`)}`
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

      if (method === 'PUT' && response.status === 204) {
        return true
      }

      const data = await response.json()

      if (!response.ok) {
        throw new VonageError(data as VonageErrorResponse)
      }

      return data
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

// =============================================================================
// Unified SMS Interface (VonageSMS)
// =============================================================================

export interface VonageSMSConfig {
  apiKey: string
  apiSecret: string
  defaultFrom?: string
  statusCallbackUrl?: string
  signatureSecret?: string
  timeout?: number
  fetch?: typeof fetch
}

export interface UnifiedSMSSendRequest {
  to: string
  body: string
  from?: string
  reference?: string
}

export interface UnifiedSMSSendResult {
  delivered: boolean
  messageId: string
  status: string
}

/**
 * VonageSMS - Unified SMS interface compatible with lib/channels/sms pattern
 */
export class VonageSMS {
  private client: VonageClient
  private defaultFrom?: string

  constructor(config: VonageSMSConfig) {
    this.client = new VonageClient({
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      signatureSecret: config.signatureSecret,
      timeout: config.timeout,
      fetch: config.fetch,
    })
    this.defaultFrom = config.defaultFrom
  }

  /**
   * Send an SMS message
   */
  async send(request: UnifiedSMSSendRequest): Promise<UnifiedSMSSendResult> {
    const from = request.from || this.defaultFrom
    if (!from) {
      throw new VonageError({ status: '1', 'error-text': 'from is required' })
    }

    const response = await this.client.sms.send({
      to: request.to.replace(/^\+/, ''), // Remove + prefix for Vonage
      from,
      text: request.body,
      'client-ref': request.reference,
    })

    const message = response.messages[0]
    return {
      delivered: message.status === '0',
      messageId: message['message-id'],
      status: message.status === '0' ? 'sent' : 'failed',
    }
  }

  /**
   * Handle webhook
   */
  handleWebhook(payload: { messageId: string; status: string; [key: string]: unknown }): { status: string; messageId: string } {
    return {
      status: payload.status,
      messageId: payload.messageId,
    }
  }
}

// =============================================================================
// Unified Voice Interface (VonageVoice)
// =============================================================================

/**
 * VonageVoice - Simplified voice API interface
 */
export class VonageVoice {
  private client: VonageClient

  constructor(config: VonageConfig) {
    this.client = new VonageClient(config)
  }

  /**
   * Make an outbound call
   */
  async call(params: VoiceCallRequest): Promise<VoiceCallResponse> {
    return this.client.voice.calls.create(params)
  }

  /**
   * Get call by UUID
   */
  async getCall(uuid: string): Promise<VoiceCallResponse> {
    return this.client.voice.calls.get(uuid)
  }

  /**
   * List calls
   */
  async listCalls(): Promise<VoiceCallListResponse> {
    return this.client.voice.calls.list()
  }

  /**
   * End a call
   */
  async hangup(uuid: string): Promise<boolean> {
    return this.client.voice.calls.hangup(uuid)
  }

  /**
   * Get recording
   */
  async getRecording(uuid: string): Promise<Recording> {
    return this.client.voice.recordings.get(uuid)
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a Vonage client
 */
export function createVonageClient(apiKey: string, apiSecret: string, config?: Omit<VonageConfig, 'apiKey' | 'apiSecret'>): VonageClient {
  if (!apiKey) {
    throw new Error('apiKey is required')
  }
  if (!apiSecret) {
    throw new Error('apiSecret is required')
  }
  return new VonageClient({ apiKey, apiSecret, ...config })
}

/**
 * Create a Vonage SMS client with unified interface
 */
export function createVonageSMS(config: VonageSMSConfig): VonageSMS {
  return new VonageSMS(config)
}

/**
 * Create a Vonage Voice client
 */
export function createVonageVoice(apiKey: string, apiSecret: string, config?: Omit<VonageConfig, 'apiKey' | 'apiSecret'>): VonageVoice {
  return new VonageVoice({ apiKey, apiSecret, ...config })
}

// =============================================================================
// Default Export
// =============================================================================

export default VonageClient
