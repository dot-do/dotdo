/**
 * @dotdo/twilio/verify - Twilio Verify OTP API Compatibility Layer
 *
 * Production-ready OTP verification service following Twilio Verify API patterns.
 * Supports SMS, voice call, email, and WhatsApp channels.
 *
 * @example
 * ```typescript
 * import { TwilioVerify } from '@dotdo/twilio/verify'
 *
 * const verify = new TwilioVerify({
 *   accountSid: 'AC...',
 *   authToken: 'your-auth-token',
 *   serviceSid: 'VA...',
 * })
 *
 * // Start verification
 * const verification = await verify.startVerification({
 *   to: '+15558675310',
 *   channel: 'sms',
 * })
 *
 * // Check verification code
 * const result = await verify.checkVerification({
 *   to: '+15558675310',
 *   code: '123456',
 * })
 *
 * if (result.valid) {
 *   console.log('Verification successful!')
 * }
 * ```
 *
 * @module @dotdo/twilio/verify
 */

// =============================================================================
// Types
// =============================================================================

/** Verification delivery channel */
export type VerifyChannel = 'sms' | 'call' | 'email' | 'whatsapp' | 'sna'

/** Verification status */
export type VerifyStatus =
  | 'pending'
  | 'approved'
  | 'canceled'
  | 'max_attempts_reached'
  | 'deleted'
  | 'failed'
  | 'expired'

/** Code send attempt record */
export interface SendCodeAttempt {
  time: string
  channel: VerifyChannel
  attempt_sid: string
}

/** Lookup information returned with verification */
export interface LookupInfo {
  carrier?: {
    mobile_country_code?: string
    mobile_network_code?: string
    name?: string
    type?: 'mobile' | 'landline' | 'voip' | 'unknown'
    error_code?: string | null
  }
}

/** Verification resource */
export interface Verification {
  sid: string
  service_sid: string
  account_sid: string
  to: string
  channel: VerifyChannel
  status: VerifyStatus
  valid: boolean
  lookup: LookupInfo
  amount: string | null
  payee: string | null
  send_code_attempts: SendCodeAttempt[]
  date_created: string
  date_updated: string
  sna: string | null
  url: string
}

/** Verification check result */
export interface VerificationCheck {
  sid: string
  service_sid: string
  account_sid: string
  to: string
  channel: VerifyChannel
  status: VerifyStatus
  valid: boolean
  amount: string | null
  payee: string | null
  date_created: string
  date_updated: string
}

/** Parameters for starting a verification */
export interface StartVerificationParams {
  /** Phone number (E.164 format) or email address to verify */
  to: string
  /** Delivery channel */
  channel: VerifyChannel
  /** Length of the verification code (4-10 digits, default: 6) */
  codeLength?: 4 | 5 | 6 | 7 | 8 | 9 | 10
  /** Locale for the verification message (e.g., 'en', 'es', 'fr') */
  locale?: string
  /** Custom friendly name shown in verification message */
  customFriendlyName?: string
  /** Custom message template (must include {code} placeholder) */
  customMessage?: string
  /** DTMF digits to send for call channel */
  sendDigits?: string
  /** Custom verification code (for testing - not recommended for production) */
  customCode?: string
  /** Amount for SCA/PSD2 verification */
  amount?: string
  /** Payee name for SCA/PSD2 verification */
  payee?: string
  /** Rate limit configuration */
  rateLimits?: Record<string, string>
  /** Channel-specific configuration */
  channelConfiguration?: {
    /** Email channel configuration */
    email?: {
      from?: string
      from_name?: string
      substitutions?: Record<string, string>
    }
    /** WhatsApp channel configuration */
    whatsapp?: {
      from?: string
      message_service_sid?: string
    }
  }
  /** Android app hash for SMS Retriever API */
  appHash?: string
  /** Template SID for custom templates */
  templateSid?: string
  /** Custom substitutions for template */
  templateCustomSubstitutions?: string
  /** Device IP address for risk assessment */
  deviceIp?: string
}

/** Parameters for checking a verification */
export interface CheckVerificationParams {
  /** Phone number or email that received the code */
  to?: string
  /** The verification code submitted by the user */
  code: string
  /** Verification SID (alternative to 'to') */
  verificationSid?: string
  /** Amount for SCA/PSD2 verification (must match start params) */
  amount?: string
  /** Payee for SCA/PSD2 verification (must match start params) */
  payee?: string
}

/** Parameters for canceling a verification */
export interface CancelVerificationParams {
  /** The verification SID to cancel */
  verificationSid: string
}

/** Parameters for fetching a verification */
export interface FetchVerificationParams {
  /** The verification SID to fetch */
  verificationSid: string
}

/** Twilio Verify client configuration */
export interface TwilioVerifyConfig {
  /** Twilio Account SID */
  accountSid: string
  /** Twilio Auth Token */
  authToken: string
  /** Verify Service SID */
  serviceSid: string
  /** Custom API host (for testing) */
  host?: string
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Enable automatic retries (default: true) */
  autoRetry?: boolean
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
}

/** Twilio API error response */
export interface TwilioVerifyErrorResponse {
  code: number
  message: string
  more_info: string
  status: number
}

// =============================================================================
// Error Class
// =============================================================================

/**
 * Twilio Verify API Error
 */
export class TwilioVerifyError extends Error {
  code: number
  status: number
  moreInfo: string

  constructor(response: TwilioVerifyErrorResponse) {
    super(response.message)
    this.name = 'TwilioVerifyError'
    this.code = response.code
    this.status = response.status
    this.moreInfo = response.more_info
  }
}

// =============================================================================
// TwilioVerify Client
// =============================================================================

/**
 * Twilio Verify OTP client
 *
 * Provides a simplified interface for OTP verification using Twilio Verify API.
 *
 * @example
 * ```typescript
 * const verify = new TwilioVerify({
 *   accountSid: process.env.TWILIO_ACCOUNT_SID,
 *   authToken: process.env.TWILIO_AUTH_TOKEN,
 *   serviceSid: process.env.TWILIO_VERIFY_SERVICE_SID,
 * })
 *
 * // Send OTP via SMS
 * const verification = await verify.startVerification({
 *   to: '+15558675310',
 *   channel: 'sms',
 *   codeLength: 6,
 * })
 *
 * // Verify the code
 * const check = await verify.checkVerification({
 *   to: '+15558675310',
 *   code: userSubmittedCode,
 * })
 *
 * if (check.valid) {
 *   // Code is valid, proceed with authentication
 * } else {
 *   // Invalid code
 * }
 * ```
 */
export class TwilioVerify {
  private accountSid: string
  private authToken: string
  private serviceSid: string
  private baseUrl: string
  private timeout: number
  private autoRetry: boolean
  private maxRetries: number
  private _fetch: typeof fetch

  constructor(config: TwilioVerifyConfig) {
    if (!config.accountSid) {
      throw new Error('accountSid is required')
    }
    if (!config.authToken) {
      throw new Error('authToken is required')
    }
    if (!config.serviceSid) {
      throw new Error('serviceSid is required')
    }

    this.accountSid = config.accountSid
    this.authToken = config.authToken
    this.serviceSid = config.serviceSid
    this.baseUrl = config.host
      ? `https://${config.host}`
      : 'https://verify.twilio.com'
    this.timeout = config.timeout ?? 30000
    this.autoRetry = config.autoRetry ?? true
    this.maxRetries = config.maxRetries ?? 3
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)
  }

  /**
   * Start a new verification
   *
   * Sends a verification code to the specified phone number or email address
   * using the specified channel (SMS, call, email, or WhatsApp).
   *
   * @param params - Verification parameters
   * @returns The created verification resource
   *
   * @example SMS Verification
   * ```typescript
   * const verification = await verify.startVerification({
   *   to: '+15558675310',
   *   channel: 'sms',
   * })
   * ```
   *
   * @example Voice Call Verification
   * ```typescript
   * const verification = await verify.startVerification({
   *   to: '+15558675310',
   *   channel: 'call',
   *   locale: 'en',
   * })
   * ```
   *
   * @example Email Verification
   * ```typescript
   * const verification = await verify.startVerification({
   *   to: 'user@example.com',
   *   channel: 'email',
   *   channelConfiguration: {
   *     email: {
   *       from: 'noreply@myapp.com',
   *       from_name: 'My App',
   *     },
   *   },
   * })
   * ```
   *
   * @example Custom Code Length
   * ```typescript
   * const verification = await verify.startVerification({
   *   to: '+15558675310',
   *   channel: 'sms',
   *   codeLength: 8,
   * })
   * ```
   */
  async startVerification(params: StartVerificationParams): Promise<Verification> {
    // Validate required parameters
    if (!params.to) {
      throw new TwilioVerifyError({
        code: 60200,
        message: "Invalid parameter: 'To' is required",
        more_info: 'https://www.twilio.com/docs/errors/60200',
        status: 400,
      })
    }

    if (!params.channel) {
      throw new TwilioVerifyError({
        code: 60200,
        message: "Invalid parameter: 'Channel' is required",
        more_info: 'https://www.twilio.com/docs/errors/60200',
        status: 400,
      })
    }

    // Validate channel
    const validChannels: VerifyChannel[] = ['sms', 'call', 'email', 'whatsapp', 'sna']
    if (!validChannels.includes(params.channel)) {
      throw new TwilioVerifyError({
        code: 60200,
        message: `Invalid parameter: 'Channel' must be one of: ${validChannels.join(', ')}`,
        more_info: 'https://www.twilio.com/docs/errors/60200',
        status: 400,
      })
    }

    // Validate code length
    if (params.codeLength !== undefined) {
      if (params.codeLength < 4 || params.codeLength > 10) {
        throw new TwilioVerifyError({
          code: 60200,
          message: "Invalid parameter: 'CodeLength' must be between 4 and 10",
          more_info: 'https://www.twilio.com/docs/errors/60200',
          status: 400,
        })
      }
    }

    // Validate email channel has email address
    if (params.channel === 'email' && !params.to.includes('@')) {
      throw new TwilioVerifyError({
        code: 60200,
        message: "Invalid parameter: 'To' must be a valid email address for email channel",
        more_info: 'https://www.twilio.com/docs/errors/60200',
        status: 400,
      })
    }

    // Validate phone channels have phone number
    if (['sms', 'call', 'whatsapp', 'sna'].includes(params.channel)) {
      if (!params.to.startsWith('+')) {
        throw new TwilioVerifyError({
          code: 60200,
          message: "Invalid parameter: 'To' must be in E.164 format for phone channels",
          more_info: 'https://www.twilio.com/docs/errors/60200',
          status: 400,
        })
      }
    }

    // Build API parameters
    const apiParams: Record<string, unknown> = {
      To: params.to,
      Channel: params.channel,
    }

    if (params.codeLength !== undefined) apiParams.CodeLength = params.codeLength
    if (params.locale) apiParams.Locale = params.locale
    if (params.customFriendlyName) apiParams.CustomFriendlyName = params.customFriendlyName
    if (params.customMessage) apiParams.CustomMessage = params.customMessage
    if (params.sendDigits) apiParams.SendDigits = params.sendDigits
    if (params.customCode) apiParams.CustomCode = params.customCode
    if (params.amount) apiParams.Amount = params.amount
    if (params.payee) apiParams.Payee = params.payee
    if (params.rateLimits) apiParams.RateLimits = JSON.stringify(params.rateLimits)
    if (params.channelConfiguration) {
      apiParams.ChannelConfiguration = JSON.stringify(params.channelConfiguration)
    }
    if (params.appHash) apiParams.AppHash = params.appHash
    if (params.templateSid) apiParams.TemplateSid = params.templateSid
    if (params.templateCustomSubstitutions) {
      apiParams.TemplateCustomSubstitutions = params.templateCustomSubstitutions
    }
    if (params.deviceIp) apiParams.DeviceIp = params.deviceIp

    return this._request(
      'POST',
      `/v2/Services/${this.serviceSid}/Verifications`,
      apiParams
    ) as Promise<Verification>
  }

  /**
   * Check a verification code
   *
   * Validates a verification code submitted by the user against the
   * pending verification.
   *
   * @param params - Check parameters
   * @returns The verification check result
   *
   * @example Check by phone number
   * ```typescript
   * const result = await verify.checkVerification({
   *   to: '+15558675310',
   *   code: '123456',
   * })
   *
   * if (result.valid) {
   *   console.log('Code is valid!')
   * } else {
   *   console.log('Invalid code, status:', result.status)
   * }
   * ```
   *
   * @example Check by verification SID
   * ```typescript
   * const result = await verify.checkVerification({
   *   verificationSid: 'VE...',
   *   code: '123456',
   * })
   * ```
   *
   * @example SCA/PSD2 verification
   * ```typescript
   * const result = await verify.checkVerification({
   *   to: '+15558675310',
   *   code: '123456',
   *   amount: '100.00',
   *   payee: 'Acme Corp',
   * })
   * ```
   */
  async checkVerification(params: CheckVerificationParams): Promise<VerificationCheck> {
    // Validate required parameters
    if (!params.code) {
      throw new TwilioVerifyError({
        code: 60200,
        message: "Invalid parameter: 'Code' is required",
        more_info: 'https://www.twilio.com/docs/errors/60200',
        status: 400,
      })
    }

    if (!params.to && !params.verificationSid) {
      throw new TwilioVerifyError({
        code: 60200,
        message: "Invalid parameter: Either 'To' or 'VerificationSid' is required",
        more_info: 'https://www.twilio.com/docs/errors/60200',
        status: 400,
      })
    }

    // Build API parameters
    const apiParams: Record<string, unknown> = {
      Code: params.code,
    }

    if (params.to) apiParams.To = params.to
    if (params.verificationSid) apiParams.VerificationSid = params.verificationSid
    if (params.amount) apiParams.Amount = params.amount
    if (params.payee) apiParams.Payee = params.payee

    return this._request(
      'POST',
      `/v2/Services/${this.serviceSid}/VerificationCheck`,
      apiParams
    ) as Promise<VerificationCheck>
  }

  /**
   * Cancel a pending verification
   *
   * Cancels a pending verification. This is useful when the user requests
   * a new code or abandons the verification flow.
   *
   * @param params - Cancel parameters
   * @returns The canceled verification
   *
   * @example
   * ```typescript
   * const canceled = await verify.cancelVerification({
   *   verificationSid: 'VE...',
   * })
   *
   * console.log('Verification canceled:', canceled.status) // 'canceled'
   * ```
   */
  async cancelVerification(params: CancelVerificationParams): Promise<Verification> {
    if (!params.verificationSid) {
      throw new TwilioVerifyError({
        code: 60200,
        message: "Invalid parameter: 'VerificationSid' is required",
        more_info: 'https://www.twilio.com/docs/errors/60200',
        status: 400,
      })
    }

    return this._request(
      'POST',
      `/v2/Services/${this.serviceSid}/Verifications/${params.verificationSid}`,
      { Status: 'canceled' }
    ) as Promise<Verification>
  }

  /**
   * Fetch a verification by SID
   *
   * Retrieves the current state of a verification.
   *
   * @param params - Fetch parameters
   * @returns The verification resource
   *
   * @example
   * ```typescript
   * const verification = await verify.fetchVerification({
   *   verificationSid: 'VE...',
   * })
   *
   * console.log('Status:', verification.status)
   * console.log('Attempts:', verification.send_code_attempts.length)
   * ```
   */
  async fetchVerification(params: FetchVerificationParams): Promise<Verification> {
    if (!params.verificationSid) {
      throw new TwilioVerifyError({
        code: 60200,
        message: "Invalid parameter: 'VerificationSid' is required",
        more_info: 'https://www.twilio.com/docs/errors/60200',
        status: 400,
      })
    }

    return this._request(
      'GET',
      `/v2/Services/${this.serviceSid}/Verifications/${params.verificationSid}`
    ) as Promise<Verification>
  }

  /**
   * Approve a verification (for testing)
   *
   * Manually approves a pending verification. This is useful for testing
   * but should not be used in production.
   *
   * @param params - The verification SID to approve
   * @returns The approved verification
   *
   * @example
   * ```typescript
   * // For testing only
   * const approved = await verify.approveVerification({
   *   verificationSid: 'VE...',
   * })
   * ```
   */
  async approveVerification(params: { verificationSid: string }): Promise<Verification> {
    if (!params.verificationSid) {
      throw new TwilioVerifyError({
        code: 60200,
        message: "Invalid parameter: 'VerificationSid' is required",
        more_info: 'https://www.twilio.com/docs/errors/60200',
        status: 400,
      })
    }

    return this._request(
      'POST',
      `/v2/Services/${this.serviceSid}/Verifications/${params.verificationSid}`,
      { Status: 'approved' }
    ) as Promise<Verification>
  }

  /**
   * Send a new code for an existing verification
   *
   * Creates a new verification with the same parameters as a previous one.
   * This is a convenience method for resending codes.
   *
   * @param params - Resend parameters (same as startVerification)
   * @returns The new verification resource
   *
   * @example
   * ```typescript
   * // User requests a new code
   * const newVerification = await verify.resendCode({
   *   to: '+15558675310',
   *   channel: 'sms',
   * })
   * ```
   */
  async resendCode(params: StartVerificationParams): Promise<Verification> {
    return this.startVerification(params)
  }

  /**
   * Internal request handler
   */
  private async _request(
    method: 'GET' | 'POST',
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
      body = this._encodeFormData(params)
    }

    const maxRetries = this.autoRetry ? this.maxRetries : 0
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.timeout)

        try {
          const response = await this._fetch(url.toString(), {
            method,
            headers,
            body,
            signal: controller.signal,
          })

          const data = await response.json()

          if (!response.ok) {
            throw new TwilioVerifyError(data as TwilioVerifyErrorResponse)
          }

          return data
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors (4xx)
        if (error instanceof TwilioVerifyError && error.status >= 400 && error.status < 500) {
          throw error
        }

        // Retry with exponential backoff
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
          await this._sleep(delay)
        }
      }
    }

    throw lastError ?? new Error('Unknown error')
  }

  /**
   * Encode an object as form data
   */
  private _encodeFormData(data: Record<string, unknown>, prefix = ''): string {
    const parts: string[] = []

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue

      const fullKey = prefix ? `${prefix}[${key}]` : key

      if (value === null || value === '') {
        parts.push(`${encodeURIComponent(fullKey)}=`)
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (typeof item === 'object' && item !== null) {
            parts.push(this._encodeFormData(item as Record<string, unknown>, `${fullKey}[${index}]`))
          } else {
            parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(item))}`)
          }
        })
      } else if (typeof value === 'object') {
        parts.push(this._encodeFormData(value as Record<string, unknown>, fullKey))
      } else {
        parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`)
      }
    }

    return parts.filter((p) => p).join('&')
  }

  /**
   * Sleep for a specified duration
   */
  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a TwilioVerify client
 *
 * @param config - Client configuration
 * @returns TwilioVerify instance
 *
 * @example
 * ```typescript
 * import { createVerifyClient } from '@dotdo/twilio/verify'
 *
 * const verify = createVerifyClient({
 *   accountSid: 'AC...',
 *   authToken: 'your-auth-token',
 *   serviceSid: 'VA...',
 * })
 * ```
 */
export function createVerifyClient(config: TwilioVerifyConfig): TwilioVerify {
  return new TwilioVerify(config)
}

// =============================================================================
// Default Export
// =============================================================================

export default TwilioVerify
