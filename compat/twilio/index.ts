/**
 * @dotdo/twilio - Twilio API Compatibility Layer
 *
 * Drop-in replacement for Twilio SDK with edge compatibility.
 * Supports SMS, Voice, WhatsApp, and Verify APIs.
 *
 * @example
 * ```typescript
 * import twilio from '@dotdo/twilio'
 *
 * const client = twilio('accountSid', 'authToken')
 *
 * // SMS
 * const message = await client.messages.create({
 *   body: 'Hello!',
 *   from: '+15017122661',
 *   to: '+15558675310',
 * })
 *
 * // Voice call
 * const call = await client.calls.create({
 *   url: 'https://example.com/twiml',
 *   to: '+15558675310',
 *   from: '+15017122661',
 * })
 *
 * // WhatsApp
 * const whatsapp = await client.messages.create({
 *   body: 'Hello from WhatsApp!',
 *   from: 'whatsapp:+14155238886',
 *   to: 'whatsapp:+15558675310',
 * })
 *
 * // Verify OTP
 * const verification = await client.verify.v2
 *   .services('VA...')
 *   .verifications.create({ to: '+15558675310', channel: 'sms' })
 *
 * const check = await client.verify.v2
 *   .services('VA...')
 *   .verificationChecks.create({ to: '+15558675310', code: '123456' })
 * ```
 *
 * @module @dotdo/twilio
 */

import type {
  Message,
  MessageCreateParams,
  MessageListParams,
  MessageUpdateParams,
  Call,
  CallCreateParams,
  CallListParams,
  CallUpdateParams,
  Verification,
  VerificationCreateParams,
  VerificationUpdateParams,
  VerificationCheck,
  VerificationCheckCreateParams,
  TwilioClientConfig,
  TwilioErrorResponse,
  ListResponse,
} from './types'

export type {
  Message,
  MessageCreateParams,
  MessageListParams,
  MessageUpdateParams,
  Call,
  CallCreateParams,
  CallListParams,
  CallUpdateParams,
  Verification,
  VerificationCreateParams,
  VerificationUpdateParams,
  VerificationCheck,
  VerificationCheckCreateParams,
  TwilioClientConfig,
  ListResponse,
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_API_VERSION = '2010-04-01'
const DEFAULT_TIMEOUT = 30000

// =============================================================================
// Error Class
// =============================================================================

/**
 * Twilio API Error
 */
export class TwilioAPIError extends Error {
  code: number
  status: number
  moreInfo: string

  constructor(response: TwilioErrorResponse) {
    super(response.message)
    this.name = 'TwilioAPIError'
    this.code = response.code
    this.status = response.status
    this.moreInfo = response.more_info
  }
}

// =============================================================================
// Message Instance
// =============================================================================

/**
 * Instance methods for a single message
 */
class MessageInstance {
  private client: TwilioClient
  private accountSid: string
  private messageSid: string

  constructor(client: TwilioClient, accountSid: string, messageSid: string) {
    this.client = client
    this.accountSid = accountSid
    this.messageSid = messageSid
  }

  async fetch(): Promise<Message> {
    return this.client._request(
      'GET',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages/${this.messageSid}.json`
    ) as Promise<Message>
  }

  async update(params: MessageUpdateParams): Promise<Message> {
    const apiParams: Record<string, unknown> = {}
    if (params.body !== undefined) apiParams.Body = params.body
    if (params.status !== undefined) apiParams.Status = params.status

    return this.client._request(
      'POST',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages/${this.messageSid}.json`,
      apiParams
    ) as Promise<Message>
  }

  async remove(): Promise<boolean> {
    return this.client._request(
      'DELETE',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages/${this.messageSid}.json`
    ) as Promise<boolean>
  }
}

// =============================================================================
// Messages Resource
// =============================================================================

/**
 * Interface for the messages callable + resource
 */
interface MessagesResourceInterface {
  (sid: string): MessageInstance
  create(params: MessageCreateParams): Promise<Message>
  list(params?: MessageListParams): Promise<Message[]>
}

/**
 * Create messages resource with callable pattern
 */
function createMessagesResource(client: TwilioClient, accountSid: string): MessagesResourceInterface {
  const callable = ((sid: string) => new MessageInstance(client, accountSid, sid)) as MessagesResourceInterface

  callable.create = async (params: MessageCreateParams): Promise<Message> => {
    // Validate required params
    if (!params.to) {
      throw new TwilioAPIError({
        code: 21604,
        message: "The 'To' phone number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21604',
        status: 400,
      })
    }

    if (!params.body && !params.mediaUrl && !params.contentSid) {
      throw new TwilioAPIError({
        code: 21602,
        message: "A 'Body' or 'MediaUrl' or 'ContentSid' parameter is required.",
        more_info: 'https://www.twilio.com/docs/errors/21602',
        status: 400,
      })
    }

    if (!params.from && !params.messagingServiceSid) {
      throw new TwilioAPIError({
        code: 21603,
        message: "A 'From' phone number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21603',
        status: 400,
      })
    }

    // Convert params to snake_case for API
    const apiParams: Record<string, unknown> = {
      To: params.to,
      Body: params.body,
      From: params.from,
      MessagingServiceSid: params.messagingServiceSid,
      MediaUrl: params.mediaUrl,
      ContentSid: params.contentSid,
      ContentVariables: params.contentVariables,
      StatusCallback: params.statusCallback,
      ProvideFeedback: params.provideFeedback,
      Attempt: params.attempt,
      ValidityPeriod: params.validityPeriod,
      ForceDelivery: params.forceDelivery,
      SendAt: params.sendAt?.toISOString(),
      SendAsMms: params.sendAsMms,
      ShortenUrls: params.shortenUrls,
    }

    // Remove undefined values
    Object.keys(apiParams).forEach((key) => {
      if (apiParams[key] === undefined) delete apiParams[key]
    })

    return client._request(
      'POST',
      `/${DEFAULT_API_VERSION}/Accounts/${accountSid}/Messages.json`,
      apiParams
    ) as Promise<Message>
  }

  callable.list = async (params?: MessageListParams): Promise<Message[]> => {
    const apiParams: Record<string, unknown> = {}
    if (params) {
      if (params.to) apiParams.To = params.to
      if (params.from) apiParams.From = params.from
      if (params.dateSent) apiParams.DateSent = params.dateSent.toISOString().split('T')[0]
      if (params.dateSentAfter) apiParams['DateSent>'] = params.dateSentAfter.toISOString().split('T')[0]
      if (params.dateSentBefore) apiParams['DateSent<'] = params.dateSentBefore.toISOString().split('T')[0]
      if (params.pageSize) apiParams.PageSize = params.pageSize
      if (params.page !== undefined) apiParams.Page = params.page
    }

    const response = await client._request(
      'GET',
      `/${DEFAULT_API_VERSION}/Accounts/${accountSid}/Messages.json`,
      apiParams
    ) as ListResponse<Message>

    return response.messages || []
  }

  return callable
}

// =============================================================================
// Call Instance
// =============================================================================

/**
 * Instance methods for a single call
 */
class CallInstance {
  private client: TwilioClient
  private accountSid: string
  private callSid: string

  constructor(client: TwilioClient, accountSid: string, callSid: string) {
    this.client = client
    this.accountSid = accountSid
    this.callSid = callSid
  }

  async fetch(): Promise<Call> {
    return this.client._request(
      'GET',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Calls/${this.callSid}.json`
    ) as Promise<Call>
  }

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
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Calls/${this.callSid}.json`,
      apiParams
    ) as Promise<Call>
  }
}

// =============================================================================
// Calls Resource
// =============================================================================

/**
 * Interface for the calls callable + resource
 */
interface CallsResourceInterface {
  (sid: string): CallInstance
  create(params: CallCreateParams): Promise<Call>
  list(params?: CallListParams): Promise<Call[]>
}

/**
 * Create calls resource with callable pattern
 */
function createCallsResource(client: TwilioClient, accountSid: string): CallsResourceInterface {
  const callable = ((sid: string) => new CallInstance(client, accountSid, sid)) as CallsResourceInterface

  callable.create = async (params: CallCreateParams): Promise<Call> => {
    // Validate required params
    if (!params.to) {
      throw new TwilioAPIError({
        code: 21201,
        message: "The 'To' phone number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21201',
        status: 400,
      })
    }

    if (!params.from) {
      throw new TwilioAPIError({
        code: 21202,
        message: "The 'From' phone number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21202',
        status: 400,
      })
    }

    if (!params.url && !params.twiml) {
      throw new TwilioAPIError({
        code: 21205,
        message: "Either 'Url' or 'Twiml' is required.",
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
      Method: params.method,
      FallbackUrl: params.fallbackUrl,
      FallbackMethod: params.fallbackMethod,
      StatusCallback: params.statusCallback,
      StatusCallbackEvent: params.statusCallbackEvent,
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
      CallReason: params.callReason,
      Trim: params.trim,
    }

    // Remove undefined values
    Object.keys(apiParams).forEach((key) => {
      if (apiParams[key] === undefined) delete apiParams[key]
    })

    return client._request(
      'POST',
      `/${DEFAULT_API_VERSION}/Accounts/${accountSid}/Calls.json`,
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
      `/${DEFAULT_API_VERSION}/Accounts/${accountSid}/Calls.json`,
      apiParams
    ) as ListResponse<Call>

    return response.calls || []
  }

  return callable
}

// =============================================================================
// Verification Instance
// =============================================================================

/**
 * Instance methods for a single verification
 */
class VerificationInstance {
  private client: TwilioClient
  private serviceSid: string
  private verificationSid: string

  constructor(client: TwilioClient, serviceSid: string, verificationSid: string) {
    this.client = client
    this.serviceSid = serviceSid
    this.verificationSid = verificationSid
  }

  async fetch(): Promise<Verification> {
    return this.client._verifyRequest(
      'GET',
      `/v2/Services/${this.serviceSid}/Verifications/${this.verificationSid}`
    ) as Promise<Verification>
  }

  async update(params: VerificationUpdateParams): Promise<Verification> {
    return this.client._verifyRequest(
      'POST',
      `/v2/Services/${this.serviceSid}/Verifications/${this.verificationSid}`,
      { Status: params.status }
    ) as Promise<Verification>
  }
}

// =============================================================================
// Verifications Resource
// =============================================================================

/**
 * Interface for verifications resource
 */
interface VerificationsResourceInterface {
  (sid: string): VerificationInstance
  create(params: VerificationCreateParams): Promise<Verification>
}

/**
 * Create verifications resource with callable pattern
 */
function createVerificationsResource(client: TwilioClient, serviceSid: string): VerificationsResourceInterface {
  const callable = ((verificationSid: string) => new VerificationInstance(client, serviceSid, verificationSid)) as VerificationsResourceInterface

  callable.create = async (params: VerificationCreateParams): Promise<Verification> => {
    const apiParams: Record<string, unknown> = {
      To: params.to,
      Channel: params.channel,
      CodeLength: params.codeLength,
      Locale: params.locale,
      CustomFriendlyName: params.customFriendlyName,
      CustomMessage: params.customMessage,
      SendDigits: params.sendDigits,
      CustomCode: params.customCode,
      Amount: params.amount,
      Payee: params.payee,
      RateLimits: params.rateLimits,
      ChannelConfiguration: params.channelConfiguration,
      AppHash: params.appHash,
      TemplateSid: params.templateSid,
      TemplateCustomSubstitutions: params.templateCustomSubstitutions,
      DeviceIp: params.deviceIp,
    }

    // Remove undefined values
    Object.keys(apiParams).forEach((key) => {
      if (apiParams[key] === undefined) delete apiParams[key]
    })

    return client._verifyRequest(
      'POST',
      `/v2/Services/${serviceSid}/Verifications`,
      apiParams
    ) as Promise<Verification>
  }

  return callable
}

// =============================================================================
// Verification Checks Resource
// =============================================================================

/**
 * Verification checks resource
 */
interface VerificationChecksResourceInterface {
  create(params: VerificationCheckCreateParams): Promise<VerificationCheck>
}

function createVerificationChecksResource(client: TwilioClient, serviceSid: string): VerificationChecksResourceInterface {
  return {
    create: async (params: VerificationCheckCreateParams): Promise<VerificationCheck> => {
      const apiParams: Record<string, unknown> = {
        To: params.to,
        Code: params.code,
        VerificationSid: params.verificationSid,
        Amount: params.amount,
        Payee: params.payee,
      }

      // Remove undefined values
      Object.keys(apiParams).forEach((key) => {
        if (apiParams[key] === undefined) delete apiParams[key]
      })

      return client._verifyRequest(
        'POST',
        `/v2/Services/${serviceSid}/VerificationCheck`,
        apiParams
      ) as Promise<VerificationCheck>
    },
  }
}

// =============================================================================
// Verify Service Context
// =============================================================================

/**
 * Interface for verify service context
 */
interface VerifyServiceContextInterface {
  verifications: VerificationsResourceInterface
  verificationChecks: VerificationChecksResourceInterface
}

function createVerifyServiceContext(client: TwilioClient, serviceSid: string): VerifyServiceContextInterface {
  return {
    verifications: createVerificationsResource(client, serviceSid),
    verificationChecks: createVerificationChecksResource(client, serviceSid),
  }
}

// =============================================================================
// Verify V2 Resource
// =============================================================================

/**
 * Verify V2 resource
 */
class VerifyV2Resource {
  private client: TwilioClient

  constructor(client: TwilioClient) {
    this.client = client
  }

  /**
   * Get a service context by SID
   */
  services(serviceSid: string): VerifyServiceContextInterface {
    return createVerifyServiceContext(this.client, serviceSid)
  }
}

/**
 * Verify resource
 */
class VerifyResource {
  v2: VerifyV2Resource

  constructor(client: TwilioClient) {
    this.v2 = new VerifyV2Resource(client)
  }
}

// =============================================================================
// Webhooks Utility
// =============================================================================

/**
 * Webhooks utility for signature verification
 */
export class Webhooks {
  /**
   * Validate a Twilio request signature
   */
  static async validateRequest(
    authToken: string,
    signature: string,
    url: string,
    params: Record<string, string>
  ): Promise<boolean> {
    const expectedSignature = await Webhooks.getExpectedTwilioSignature(authToken, url, params)
    return secureCompare(signature, expectedSignature)
  }

  /**
   * Validate a request with a raw body (for JSON webhooks)
   */
  static async validateRequestWithBody(
    authToken: string,
    signature: string,
    url: string,
    body: string
  ): Promise<boolean> {
    const bodyHash = await Webhooks.getBodyHash(body)
    const urlWithHash = `${url}?bodySHA256=${bodyHash}`
    const expectedSignature = await Webhooks.getExpectedTwilioSignature(authToken, urlWithHash, {})
    return secureCompare(signature, expectedSignature)
  }

  /**
   * Generate the expected Twilio signature for a request
   */
  static async getExpectedTwilioSignature(
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

    const signature = await crypto.subtle.sign('HMAC', key, messageData)

    // Base64 encode
    return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(signature))))
  }

  /**
   * Get SHA256 hash of body for webhook validation
   */
  static async getBodyHash(body: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(body)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
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
// Main Twilio Client
// =============================================================================

/**
 * Twilio client for API interactions
 */
export class TwilioClient {
  private accountSid: string
  private authToken: string
  private config: TwilioClientConfig
  private baseUrl: string
  private verifyBaseUrl: string
  private _fetch: typeof fetch

  // Resources
  messages: MessagesResourceInterface
  calls: CallsResourceInterface
  verify: VerifyResource

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

    // Build base URLs
    let apiHost = 'api.twilio.com'
    let verifyHost = 'verify.twilio.com'
    if (config.edge) {
      apiHost = `api.${config.edge}.twilio.com`
      verifyHost = `verify.${config.edge}.twilio.com`
    }
    if (config.region) {
      apiHost = `api.${config.region}.twilio.com`
      verifyHost = `verify.${config.region}.twilio.com`
    }
    this.baseUrl = `https://${apiHost}`
    this.verifyBaseUrl = `https://${verifyHost}`
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)

    // Initialize resources
    this.messages = createMessagesResource(this, accountSid)
    this.calls = createCallsResource(this, accountSid)
    this.verify = new VerifyResource(this)
  }

  /**
   * Make a raw API request to the main Twilio API
   * @internal
   */
  async _request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    return this._makeRequest(this.baseUrl, method, path, params)
  }

  /**
   * Make a raw API request to the Verify API
   * @internal
   */
  async _verifyRequest(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    return this._makeRequest(this.verifyBaseUrl, method, path, params)
  }

  /**
   * Internal request handler
   */
  private async _makeRequest(
    baseUrl: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const url = new URL(path, baseUrl)

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
        const timeout = this.config.timeout ?? DEFAULT_TIMEOUT
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
            throw new TwilioAPIError(data as TwilioErrorResponse)
          }

          return data
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors (4xx)
        if (error instanceof TwilioAPIError && error.status >= 400 && error.status < 500) {
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

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a Twilio client using the factory function
 */
export function twilio(accountSid: string, authToken: string, config?: TwilioClientConfig): TwilioClient {
  return new TwilioClient(accountSid, authToken, config)
}

/**
 * Twilio class alias for new Twilio() pattern
 */
export const Twilio = TwilioClient

// =============================================================================
// Verify Module
// =============================================================================

export {
  TwilioVerify,
  TwilioVerifyError,
  createVerifyClient,
  type VerifyChannel,
  type VerifyStatus,
  type Verification as VerifyVerification,
  type VerificationCheck as VerifyVerificationCheck,
  type StartVerificationParams,
  type CheckVerificationParams,
  type CancelVerificationParams,
  type FetchVerificationParams,
  type TwilioVerifyConfig,
  type TwilioVerifyErrorResponse,
  type SendCodeAttempt,
  type LookupInfo,
} from './verify'

// =============================================================================
// SMS Module
// =============================================================================

export {
  TwilioSMS,
  TwilioSMSError,
  RateLimitError,
  createTwilioSMS,
  type SMSSendRequest,
  type SMSSendResponse,
  type SMSStatusEntry,
  type RateLimitConfig,
  type TwilioSMSConfig,
} from './sms'

// =============================================================================
// WhatsApp Module
// =============================================================================

export {
  TwilioWhatsApp,
  TwilioWhatsAppError,
  SessionExpiredError,
  createWhatsAppClient,
  type WhatsAppMessageStatus,
  type WhatsAppMediaType,
  type WhatsAppButton,
  type WhatsAppListSection,
  type WhatsAppListRow,
  type WhatsAppLocation,
  type WhatsAppContact,
  type WhatsAppSession,
  type WhatsAppSendRequest,
  type WhatsAppTemplateSendRequest,
  type WhatsAppMediaSendRequest,
  type WhatsAppButtonsRequest,
  type WhatsAppListRequest,
  type WhatsAppLocationRequest,
  type WhatsAppContactRequest,
  type WhatsAppSendResponse,
  type WhatsAppWebhookPayload,
  type WhatsAppStatusPayload,
  type TwilioWhatsAppConfig,
} from './whatsapp'

// =============================================================================
// Voice Module
// =============================================================================

export {
  VoiceClient,
  VoiceResponse,
  VoiceAPIError,
  createVoiceClient,
  parseVoiceWebhook,
  parseRecordingStatusCallback,
  validateWebhookSignature,
  type VoiceCallCreateParams,
  type Recording,
  type RecordingCreateParams,
  type RecordingUpdateParams,
  type Conference,
  type Participant,
  type ParticipantUpdateParams,
  type VoiceWebhookPayload,
  type RecordingStatusCallbackPayload,
  type SayOptions,
  type PlayOptions,
  type PauseOptions,
  type GatherOptions,
  type RecordOptions,
  type DialOptions,
  type NumberOptions,
  type ClientOptions,
  type SipOptions,
  type ConferenceOptions,
  type QueueOptions,
  type RedirectOptions,
  type RejectOptions,
  type EnqueueOptions,
} from './voice'

// =============================================================================
// Default Export
// =============================================================================

export default twilio
