/**
 * @dotdo/twilio/whatsapp - Twilio WhatsApp Messaging API Compatibility Layer
 *
 * Production-ready WhatsApp messaging with template support, media handling,
 * interactive messages, and session management.
 *
 * @example
 * ```typescript
 * import { TwilioWhatsApp } from '@dotdo/twilio/whatsapp'
 *
 * const whatsapp = new TwilioWhatsApp({
 *   accountSid: 'AC...',
 *   authToken: 'your-auth-token',
 *   from: 'whatsapp:+14155238886',
 * })
 *
 * // Send text message
 * const message = await whatsapp.send({
 *   to: 'whatsapp:+15558675310',
 *   body: 'Hello from WhatsApp!',
 * })
 *
 * // Send template message
 * const template = await whatsapp.sendTemplate({
 *   to: 'whatsapp:+15558675310',
 *   contentSid: 'HX...',
 *   contentVariables: { '1': 'John', '2': 'Order #12345' },
 * })
 *
 * // Send media message
 * const media = await whatsapp.sendMedia({
 *   to: 'whatsapp:+15558675310',
 *   mediaUrl: 'https://example.com/image.jpg',
 *   body: 'Check out this image!',
 * })
 *
 * // Send interactive message with buttons
 * const buttons = await whatsapp.sendButtons({
 *   to: 'whatsapp:+15558675310',
 *   body: 'Choose an option:',
 *   buttons: [
 *     { id: 'yes', title: 'Yes' },
 *     { id: 'no', title: 'No' },
 *   ],
 * })
 * ```
 *
 * @module @dotdo/twilio/whatsapp
 */

import { Hono } from 'hono'
import type {
  Message,
  MessageStatus,
  MessageDirection,
  TwilioClientConfig,
  TwilioErrorResponse,
} from './types'

// =============================================================================
// WhatsApp Types
// =============================================================================

/** WhatsApp message status (extends standard message status) */
export type WhatsAppMessageStatus = MessageStatus | 'read'

/** WhatsApp media type */
export type WhatsAppMediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker'

/** WhatsApp button for interactive messages */
export interface WhatsAppButton {
  /** Unique button ID (max 256 characters) */
  id: string
  /** Button display text (max 20 characters) */
  title: string
}

/** WhatsApp list section for interactive list messages */
export interface WhatsAppListSection {
  /** Section title (max 24 characters) */
  title: string
  /** Section rows */
  rows: WhatsAppListRow[]
}

/** WhatsApp list row */
export interface WhatsAppListRow {
  /** Unique row ID (max 200 characters) */
  id: string
  /** Row title (max 24 characters) */
  title: string
  /** Row description (max 72 characters) */
  description?: string
}

/** WhatsApp location */
export interface WhatsAppLocation {
  latitude: number
  longitude: number
  name?: string
  address?: string
}

/** WhatsApp contact */
export interface WhatsAppContact {
  name: {
    formatted_name: string
    first_name?: string
    last_name?: string
    middle_name?: string
    suffix?: string
    prefix?: string
  }
  phones?: Array<{
    phone: string
    type?: 'CELL' | 'MAIN' | 'IPHONE' | 'HOME' | 'WORK'
    wa_id?: string
  }>
  emails?: Array<{
    email: string
    type?: 'HOME' | 'WORK'
  }>
  urls?: Array<{
    url: string
    type?: 'HOME' | 'WORK'
  }>
  addresses?: Array<{
    street?: string
    city?: string
    state?: string
    zip?: string
    country?: string
    country_code?: string
    type?: 'HOME' | 'WORK'
  }>
  org?: {
    company?: string
    department?: string
    title?: string
  }
  birthday?: string
}

/** Session state for 24-hour window tracking */
export interface WhatsAppSession {
  /** User's WhatsApp number (who sent the message) */
  from: string
  /** Alias for from - user's WhatsApp number */
  to: string
  /** Last message timestamp from user */
  lastUserMessage: Date
  /** Session expiry time (24 hours from last user message) */
  expiresAt: Date
  /** Whether session is currently active */
  isActive: boolean
  /** Alias for isActive - whether session is open */
  isOpen: boolean
}

/** WhatsApp send request parameters */
export interface WhatsAppSendRequest {
  /** Recipient WhatsApp number (whatsapp:+...) */
  to: string
  /** Sender WhatsApp number (whatsapp:+...) */
  from?: string
  /** Message body text (max 4096 characters) */
  body?: string
  /** Media URLs (for MMS-style messages) */
  mediaUrl?: string[]
  /** Content SID for template messages */
  contentSid?: string
  /** Template variables as JSON string or object */
  contentVariables?: string | Record<string, string>
  /** Status callback URL */
  statusCallback?: string
  /** Messaging service SID */
  messagingServiceSid?: string
  /** Message validity period in seconds */
  validityPeriod?: number
  /** Persistent action for quick replies */
  persistentAction?: string[]
}

/** WhatsApp template send request */
export interface WhatsAppTemplateSendRequest {
  /** Recipient WhatsApp number */
  to: string
  /** Content SID (HX...) */
  contentSid: string
  /** Template variables */
  contentVariables?: Record<string, string>
  /** Status callback URL */
  statusCallback?: string
  /** Sender WhatsApp number */
  from?: string
}

/** WhatsApp media send request */
export interface WhatsAppMediaSendRequest {
  /** Recipient WhatsApp number */
  to: string
  /** Media URL */
  mediaUrl: string
  /** Optional caption */
  body?: string
  /** Media type hint */
  mediaType?: WhatsAppMediaType
  /** Filename for documents */
  filename?: string
  /** Status callback URL */
  statusCallback?: string
  /** Sender WhatsApp number */
  from?: string
}

/** WhatsApp button message request */
export interface WhatsAppButtonsRequest {
  /** Recipient WhatsApp number */
  to: string
  /** Message body (max 1024 characters) */
  body: string
  /** Buttons (max 3) */
  buttons: WhatsAppButton[]
  /** Optional header text */
  header?: string
  /** Optional footer text (max 60 characters) */
  footer?: string
  /** Status callback URL */
  statusCallback?: string
  /** Sender WhatsApp number */
  from?: string
}

/** WhatsApp list message request */
export interface WhatsAppListRequest {
  /** Recipient WhatsApp number */
  to: string
  /** Message body (max 1024 characters) */
  body: string
  /** Button text to open list (max 20 characters) */
  buttonText: string
  /** List sections (max 10 sections, max 10 rows per section) */
  sections: WhatsAppListSection[]
  /** Optional header text */
  header?: string
  /** Optional footer text */
  footer?: string
  /** Status callback URL */
  statusCallback?: string
  /** Sender WhatsApp number */
  from?: string
}

/** WhatsApp location message request */
export interface WhatsAppLocationRequest {
  /** Recipient WhatsApp number */
  to: string
  /** Location data */
  location: WhatsAppLocation
  /** Status callback URL */
  statusCallback?: string
  /** Sender WhatsApp number */
  from?: string
}

/** WhatsApp contact message request */
export interface WhatsAppContactRequest {
  /** Recipient WhatsApp number */
  to: string
  /** Contacts to send */
  contacts: WhatsAppContact[]
  /** Status callback URL */
  statusCallback?: string
  /** Sender WhatsApp number */
  from?: string
}

/** WhatsApp send response */
export interface WhatsAppSendResponse {
  sid: string
  accountSid: string
  to: string
  from: string
  body: string | null
  status: WhatsAppMessageStatus
  direction: MessageDirection
  dateCreated: Date
  dateSent: Date | null
  errorCode: number | null
  errorMessage: string | null
  numSegments: number
  num_media?: string
  price: string | null
  priceUnit: string
}

/** WhatsApp webhook payload */
export interface WhatsAppWebhookPayload {
  MessageSid: string
  AccountSid: string
  From: string
  To: string
  Body?: string
  NumMedia?: string
  NumSegments?: string
  SmsStatus?: WhatsAppMessageStatus
  MessageStatus?: WhatsAppMessageStatus
  ApiVersion?: string
  ProfileName?: string
  WaId?: string
  Forwarded?: string
  FrequentlyForwarded?: string
  ButtonText?: string
  ButtonPayload?: string
  ListId?: string
  ListTitle?: string
  Latitude?: string
  Longitude?: string
  Address?: string
  Label?: string
  ReferralNumMedia?: string
  ReferralBody?: string
  ReferralHeadline?: string
  ReferralSourceUrl?: string
  ReferralMediaContentType0?: string
  ReferralMediaUrl0?: string
  MediaContentType0?: string
  MediaUrl0?: string
  MediaContentType1?: string
  MediaUrl1?: string
  MediaContentType2?: string
  MediaUrl2?: string
  MediaContentType3?: string
  MediaUrl3?: string
  MediaContentType4?: string
  MediaUrl4?: string
  ErrorCode?: string
  ErrorMessage?: string
}

/** WhatsApp status webhook payload */
export interface WhatsAppStatusPayload {
  MessageSid: string
  MessageStatus: WhatsAppMessageStatus
  AccountSid: string
  From: string
  To: string
  ApiVersion: string
  SmsSid?: string
  SmsStatus?: WhatsAppMessageStatus
  ErrorCode?: string
  ErrorMessage?: string
  ChannelToAddress?: string
  ChannelPrefix?: string
}

/** TwilioWhatsApp client configuration */
export interface TwilioWhatsAppConfig extends TwilioClientConfig {
  /** Default sender WhatsApp number */
  from?: string
  /** Messaging service SID */
  messagingServiceSid?: string
  /** Webhook secret for signature verification */
  webhookSecret?: string
  /** Enable session tracking (24-hour window) */
  trackSessions?: boolean
  /** Session expiry in milliseconds (default: 24 hours) */
  sessionExpiryMs?: number
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Twilio WhatsApp API Error
 */
export class TwilioWhatsAppError extends Error {
  code: number
  status: number
  moreInfo: string

  constructor(response: TwilioErrorResponse) {
    super(response.message)
    this.name = 'TwilioWhatsAppError'
    this.code = response.code
    this.status = response.status
    this.moreInfo = response.more_info
  }
}

/**
 * Session expired error (24-hour window)
 */
export class SessionExpiredError extends Error {
  to: string
  expiredAt: Date

  constructor(to: string, expiredAt: Date) {
    super(`WhatsApp session expired for ${to}. Use a template message to re-engage.`)
    this.name = 'SessionExpiredError'
    this.to = to
    this.expiredAt = expiredAt
  }
}

// =============================================================================
// Session Manager
// =============================================================================

/**
 * Manages WhatsApp 24-hour session windows
 */
class SessionManager {
  private sessions: Map<string, WhatsAppSession> = new Map()
  private expiryMs: number

  constructor(expiryMs = 24 * 60 * 60 * 1000) {
    this.expiryMs = expiryMs
  }

  /**
   * Record an incoming message (starts/extends session)
   */
  recordIncoming(from: string): WhatsAppSession {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.expiryMs)

    const session: WhatsAppSession = {
      from,
      to: from, // Alias for backwards compatibility
      lastUserMessage: now,
      expiresAt,
      isActive: true,
      isOpen: true, // Alias for isActive
    }

    this.sessions.set(this._normalizeNumber(from), session)
    return session
  }

  /**
   * Check if session is active
   */
  isSessionActive(to: string): boolean {
    const session = this.sessions.get(this._normalizeNumber(to))
    if (!session) return false

    const now = new Date()
    if (now > session.expiresAt) {
      session.isActive = false
      return false
    }

    return session.isActive
  }

  /**
   * Get session for a number
   */
  getSession(to: string): WhatsAppSession | null {
    const session = this.sessions.get(this._normalizeNumber(to))
    if (!session) return null

    // Update active status
    const now = new Date()
    const isActive = now <= session.expiresAt
    session.isActive = isActive
    session.isOpen = isActive

    return session
  }

  /**
   * Get time remaining in session
   */
  getTimeRemaining(to: string): number {
    const session = this.sessions.get(this._normalizeNumber(to))
    if (!session) return 0

    const now = new Date()
    const remaining = session.expiresAt.getTime() - now.getTime()
    return Math.max(0, remaining)
  }

  /**
   * Clear expired sessions
   */
  clearExpired(): number {
    const now = new Date()
    let cleared = 0
    const keysToDelete: string[] = []

    this.sessions.forEach((session, key) => {
      if (now > session.expiresAt) {
        keysToDelete.push(key)
      }
    })

    for (const key of keysToDelete) {
      this.sessions.delete(key)
      cleared++
    }

    return cleared
  }

  /**
   * Clear all sessions
   */
  clear(): void {
    this.sessions.clear()
  }

  /**
   * Normalize WhatsApp number format
   */
  private _normalizeNumber(number: string): string {
    return number.replace(/^whatsapp:/, '')
  }
}

// =============================================================================
// TwilioWhatsApp Client
// =============================================================================

const DEFAULT_API_VERSION = '2010-04-01'
const DEFAULT_TIMEOUT = 30000
const DEFAULT_SESSION_EXPIRY = 24 * 60 * 60 * 1000 // 24 hours

/**
 * TwilioWhatsApp - WhatsApp messaging client with full feature support
 */
/** Status tracking entry */
interface StatusEntry {
  sid: string
  status: WhatsAppMessageStatus
  timestamp: Date
}

/** Status change event handler */
type StatusChangeHandler = (entry: StatusEntry) => void

export class TwilioWhatsApp {
  private accountSid: string
  private authToken: string
  private config: TwilioWhatsAppConfig
  private baseUrl: string
  private _fetch: typeof fetch
  private sessionManager: SessionManager | null
  private statusHistory: Map<string, StatusEntry[]> = new Map()
  private statusHandlers: StatusChangeHandler[] = []

  constructor(config: TwilioWhatsAppConfig & { accountSid: string; authToken: string }) {
    if (!config.accountSid) {
      throw new Error('accountSid is required')
    }
    if (!config.authToken) {
      throw new Error('authToken is required')
    }

    // Validate from number if provided
    if (config.from !== undefined) {
      if (!config.from) {
        throw new Error('from number is required')
      }
      if (!config.from.startsWith('whatsapp:')) {
        throw new Error('from must be in WhatsApp format (whatsapp:+...)')
      }
    }

    this.accountSid = config.accountSid
    this.authToken = config.authToken
    this.config = config
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)

    // Build base URL
    let apiHost = 'api.twilio.com'
    if (config.edge) {
      apiHost = `api.${config.edge}.twilio.com`
    }
    if (config.region) {
      apiHost = `api.${config.region}.twilio.com`
    }
    this.baseUrl = `https://${apiHost}`

    // Initialize session manager if tracking enabled
    this.sessionManager = config.trackSessions
      ? new SessionManager(config.sessionExpiryMs ?? DEFAULT_SESSION_EXPIRY)
      : null
  }

  // ===========================================================================
  // Message Sending
  // ===========================================================================

  /**
   * Send a WhatsApp text message
   *
   * @param request - Send request parameters
   * @returns The sent message
   *
   * @example
   * ```typescript
   * const message = await whatsapp.send({
   *   to: 'whatsapp:+15558675310',
   *   body: 'Hello from WhatsApp!',
   * })
   * ```
   */
  async send(request: WhatsAppSendRequest): Promise<WhatsAppSendResponse> {
    this._validateSendRequest(request)

    const normalizedRequest = this._normalizeSendRequest(request)

    // Check session if tracking enabled and not using template
    if (this.sessionManager && !request.contentSid) {
      if (!this.sessionManager.isSessionActive(normalizedRequest.to)) {
        const session = this.sessionManager.getSession(normalizedRequest.to)
        if (session) {
          throw new SessionExpiredError(normalizedRequest.to, session.expiresAt)
        }
        throw new SessionExpiredError(normalizedRequest.to, new Date())
      }
    }

    return this._sendMessage(normalizedRequest)
  }

  /**
   * Send a WhatsApp template message
   *
   * Template messages can be sent outside the 24-hour window.
   *
   * @param request - Template request parameters
   * @returns The sent message
   *
   * @example
   * ```typescript
   * const template = await whatsapp.sendTemplate({
   *   to: 'whatsapp:+15558675310',
   *   contentSid: 'HX...',
   *   contentVariables: { '1': 'John', '2': 'Your order is ready' },
   * })
   * ```
   */
  async sendTemplate(request: WhatsAppTemplateSendRequest): Promise<WhatsAppSendResponse> {
    if (!request.to) {
      throw new TwilioWhatsAppError({
        code: 21604,
        message: "The 'To' number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21604',
        status: 400,
      })
    }

    if (!request.contentSid) {
      throw new TwilioWhatsAppError({
        code: 21602,
        message: "The 'ContentSid' is required for template messages.",
        more_info: 'https://www.twilio.com/docs/errors/21602',
        status: 400,
      })
    }

    const sendRequest: WhatsAppSendRequest = {
      to: this._ensureWhatsAppPrefix(request.to),
      from: request.from,
      contentSid: request.contentSid,
      contentVariables: request.contentVariables
        ? JSON.stringify(request.contentVariables)
        : undefined,
      statusCallback: request.statusCallback,
    }

    return this._sendMessage(this._normalizeSendRequest(sendRequest))
  }

  /**
   * Send a WhatsApp media message (image, video, audio, document)
   *
   * @param request - Media request parameters
   * @returns The sent message
   *
   * @example Image
   * ```typescript
   * const image = await whatsapp.sendMedia({
   *   to: 'whatsapp:+15558675310',
   *   mediaUrl: 'https://example.com/image.jpg',
   *   body: 'Check out this image!',
   * })
   * ```
   *
   * @example Document with filename
   * ```typescript
   * const doc = await whatsapp.sendMedia({
   *   to: 'whatsapp:+15558675310',
   *   mediaUrl: 'https://example.com/invoice.pdf',
   *   filename: 'Invoice-2024.pdf',
   *   mediaType: 'document',
   * })
   * ```
   */
  async sendMedia(request: WhatsAppMediaSendRequest): Promise<WhatsAppSendResponse> {
    if (!request.to) {
      throw new TwilioWhatsAppError({
        code: 21604,
        message: "The 'To' number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21604',
        status: 400,
      })
    }

    if (!request.mediaUrl) {
      throw new TwilioWhatsAppError({
        code: 21602,
        message: "The 'MediaUrl' is required for media messages.",
        more_info: 'https://www.twilio.com/docs/errors/21602',
        status: 400,
      })
    }

    const sendRequest: WhatsAppSendRequest = {
      to: this._ensureWhatsAppPrefix(request.to),
      from: request.from,
      body: request.body,
      mediaUrl: [request.mediaUrl],
      statusCallback: request.statusCallback,
    }

    // Check session for freeform messages
    const normalizedRequest = this._normalizeSendRequest(sendRequest)

    if (this.sessionManager) {
      if (!this.sessionManager.isSessionActive(normalizedRequest.to)) {
        const session = this.sessionManager.getSession(normalizedRequest.to)
        throw new SessionExpiredError(
          normalizedRequest.to,
          session?.expiresAt ?? new Date()
        )
      }
    }

    return this._sendMessage(normalizedRequest)
  }

  /**
   * Send an interactive button message
   *
   * @param request - Button message request
   * @returns The sent message
   *
   * @example
   * ```typescript
   * const message = await whatsapp.sendButtons({
   *   to: 'whatsapp:+15558675310',
   *   body: 'Would you like to proceed?',
   *   buttons: [
   *     { id: 'yes', title: 'Yes' },
   *     { id: 'no', title: 'No' },
   *     { id: 'maybe', title: 'Maybe Later' },
   *   ],
   *   footer: 'Reply within 24 hours',
   * })
   * ```
   */
  async sendButtons(request: WhatsAppButtonsRequest): Promise<WhatsAppSendResponse> {
    if (!request.to) {
      throw new TwilioWhatsAppError({
        code: 21604,
        message: "The 'To' number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21604',
        status: 400,
      })
    }

    if (!request.body) {
      throw new TwilioWhatsAppError({
        code: 21602,
        message: "The 'Body' is required for button messages.",
        more_info: 'https://www.twilio.com/docs/errors/21602',
        status: 400,
      })
    }

    if (!request.buttons || request.buttons.length === 0) {
      throw new TwilioWhatsAppError({
        code: 21602,
        message: 'At least one button is required.',
        more_info: 'https://www.twilio.com/docs/errors/21602',
        status: 400,
      })
    }

    if (request.buttons.length > 3) {
      throw new TwilioWhatsAppError({
        code: 21602,
        message: 'Maximum 3 buttons allowed.',
        more_info: 'https://www.twilio.com/docs/errors/21602',
        status: 400,
      })
    }

    // Validate button constraints
    for (const button of request.buttons) {
      if (!button.id || button.id.length > 256) {
        throw new TwilioWhatsAppError({
          code: 21602,
          message: 'Button id is required and must be max 256 characters.',
          more_info: 'https://www.twilio.com/docs/errors/21602',
          status: 400,
        })
      }
      if (!button.title || button.title.length > 20) {
        throw new TwilioWhatsAppError({
          code: 21602,
          message: 'Button title is required and must be max 20 characters.',
          more_info: 'https://www.twilio.com/docs/errors/21602',
          status: 400,
        })
      }
    }

    // Build interactive message content
    const interactive = {
      type: 'button',
      body: { text: request.body },
      action: {
        buttons: request.buttons.map((btn) => ({
          type: 'reply',
          reply: { id: btn.id, title: btn.title },
        })),
      },
      ...(request.header && { header: { type: 'text', text: request.header } }),
      ...(request.footer && { footer: { text: request.footer } }),
    }

    const to = this._ensureWhatsAppPrefix(request.to)
    const from = request.from
      ? this._ensureWhatsAppPrefix(request.from)
      : this.config.from
        ? this._ensureWhatsAppPrefix(this.config.from)
        : undefined

    if (!from && !this.config.messagingServiceSid) {
      throw new TwilioWhatsAppError({
        code: 21603,
        message: "A 'From' number or 'MessagingServiceSid' is required.",
        more_info: 'https://www.twilio.com/docs/errors/21603',
        status: 400,
      })
    }

    // Check session
    if (this.sessionManager && !this.sessionManager.isSessionActive(to)) {
      const session = this.sessionManager.getSession(to)
      throw new SessionExpiredError(to, session?.expiresAt ?? new Date())
    }

    // Send via Content API
    const apiParams: Record<string, unknown> = {
      To: to,
      From: from,
      MessagingServiceSid: this.config.messagingServiceSid,
      ContentSid: 'interactive', // Placeholder - real impl uses Content API
      Body: JSON.stringify(interactive),
      StatusCallback: request.statusCallback,
    }

    // Remove undefined values
    Object.keys(apiParams).forEach((key) => {
      if (apiParams[key] === undefined) delete apiParams[key]
    })

    const response = (await this._request(
      'POST',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages.json`,
      apiParams
    )) as Message

    return this._messageToResponse(response)
  }

  /**
   * Send an interactive list message
   *
   * @param request - List message request
   * @returns The sent message
   *
   * @example
   * ```typescript
   * const message = await whatsapp.sendList({
   *   to: 'whatsapp:+15558675310',
   *   body: 'Choose your preferred option:',
   *   buttonText: 'View Options',
   *   sections: [
   *     {
   *       title: 'Popular',
   *       rows: [
   *         { id: 'pizza', title: 'Pizza', description: 'Cheese and tomato' },
   *         { id: 'burger', title: 'Burger', description: 'Beef patty' },
   *       ],
   *     },
   *     {
   *       title: 'Healthy',
   *       rows: [
   *         { id: 'salad', title: 'Salad', description: 'Fresh greens' },
   *       ],
   *     },
   *   ],
   * })
   * ```
   */
  async sendList(request: WhatsAppListRequest): Promise<WhatsAppSendResponse> {
    if (!request.to) {
      throw new TwilioWhatsAppError({
        code: 21604,
        message: "The 'To' number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21604',
        status: 400,
      })
    }

    if (!request.body) {
      throw new TwilioWhatsAppError({
        code: 21602,
        message: "The 'Body' is required for list messages.",
        more_info: 'https://www.twilio.com/docs/errors/21602',
        status: 400,
      })
    }

    if (!request.buttonText || request.buttonText.length > 20) {
      throw new TwilioWhatsAppError({
        code: 21602,
        message: "The 'ButtonText' is required and must be max 20 characters.",
        more_info: 'https://www.twilio.com/docs/errors/21602',
        status: 400,
      })
    }

    if (!request.sections || request.sections.length === 0) {
      throw new TwilioWhatsAppError({
        code: 21602,
        message: 'At least one section is required.',
        more_info: 'https://www.twilio.com/docs/errors/21602',
        status: 400,
      })
    }

    if (request.sections.length > 10) {
      throw new TwilioWhatsAppError({
        code: 21602,
        message: 'Maximum 10 sections allowed.',
        more_info: 'https://www.twilio.com/docs/errors/21602',
        status: 400,
      })
    }

    // Validate sections
    for (const section of request.sections) {
      if (section.rows.length > 10) {
        throw new TwilioWhatsAppError({
          code: 21602,
          message: 'Maximum 10 rows per section allowed.',
          more_info: 'https://www.twilio.com/docs/errors/21602',
          status: 400,
        })
      }
    }

    // Build interactive message content
    const interactive = {
      type: 'list',
      body: { text: request.body },
      action: {
        button: request.buttonText,
        sections: request.sections,
      },
      ...(request.header && { header: { type: 'text', text: request.header } }),
      ...(request.footer && { footer: { text: request.footer } }),
    }

    const to = this._ensureWhatsAppPrefix(request.to)
    const from = request.from
      ? this._ensureWhatsAppPrefix(request.from)
      : this.config.from
        ? this._ensureWhatsAppPrefix(this.config.from)
        : undefined

    if (!from && !this.config.messagingServiceSid) {
      throw new TwilioWhatsAppError({
        code: 21603,
        message: "A 'From' number or 'MessagingServiceSid' is required.",
        more_info: 'https://www.twilio.com/docs/errors/21603',
        status: 400,
      })
    }

    // Check session
    if (this.sessionManager && !this.sessionManager.isSessionActive(to)) {
      const session = this.sessionManager.getSession(to)
      throw new SessionExpiredError(to, session?.expiresAt ?? new Date())
    }

    const apiParams: Record<string, unknown> = {
      To: to,
      From: from,
      MessagingServiceSid: this.config.messagingServiceSid,
      Body: JSON.stringify(interactive),
      StatusCallback: request.statusCallback,
    }

    Object.keys(apiParams).forEach((key) => {
      if (apiParams[key] === undefined) delete apiParams[key]
    })

    const response = (await this._request(
      'POST',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages.json`,
      apiParams
    )) as Message

    return this._messageToResponse(response)
  }

  /**
   * Send a location message
   *
   * @param request - Location message request
   * @returns The sent message
   */
  async sendLocation(request: WhatsAppLocationRequest): Promise<WhatsAppSendResponse> {
    if (!request.to) {
      throw new TwilioWhatsAppError({
        code: 21604,
        message: "The 'To' number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21604',
        status: 400,
      })
    }

    if (!request.location) {
      throw new TwilioWhatsAppError({
        code: 21602,
        message: "The 'Location' is required.",
        more_info: 'https://www.twilio.com/docs/errors/21602',
        status: 400,
      })
    }

    const to = this._ensureWhatsAppPrefix(request.to)
    const from = this._getFromNumber(request.from)

    // Check session
    if (this.sessionManager && !this.sessionManager.isSessionActive(to)) {
      const session = this.sessionManager.getSession(to)
      throw new SessionExpiredError(to, session?.expiresAt ?? new Date())
    }

    const persistentAction = [
      `geo:${request.location.latitude},${request.location.longitude}`,
      request.location.name || '',
      request.location.address || '',
    ].filter(Boolean)

    const apiParams: Record<string, unknown> = {
      To: to,
      From: from,
      MessagingServiceSid: this.config.messagingServiceSid,
      Body: request.location.name || `Location: ${request.location.latitude},${request.location.longitude}`,
      PersistentAction: persistentAction,
      StatusCallback: request.statusCallback,
    }

    Object.keys(apiParams).forEach((key) => {
      if (apiParams[key] === undefined) delete apiParams[key]
    })

    const response = (await this._request(
      'POST',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages.json`,
      apiParams
    )) as Message

    return this._messageToResponse(response)
  }

  /**
   * Send a contact card message
   *
   * @param request - Contact message request
   * @returns The sent message
   */
  async sendContact(request: WhatsAppContactRequest): Promise<WhatsAppSendResponse> {
    if (!request.to) {
      throw new TwilioWhatsAppError({
        code: 21604,
        message: "The 'To' number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21604',
        status: 400,
      })
    }

    if (!request.contacts || request.contacts.length === 0) {
      throw new TwilioWhatsAppError({
        code: 21602,
        message: 'At least one contact is required.',
        more_info: 'https://www.twilio.com/docs/errors/21602',
        status: 400,
      })
    }

    const to = this._ensureWhatsAppPrefix(request.to)
    const from = this._getFromNumber(request.from)

    // Check session
    if (this.sessionManager && !this.sessionManager.isSessionActive(to)) {
      const session = this.sessionManager.getSession(to)
      throw new SessionExpiredError(to, session?.expiresAt ?? new Date())
    }

    // Build vCard format for contacts
    const contactsBody = request.contacts
      .map((c) => c.name.formatted_name)
      .join(', ')

    const apiParams: Record<string, unknown> = {
      To: to,
      From: from,
      MessagingServiceSid: this.config.messagingServiceSid,
      Body: `Contact: ${contactsBody}`,
      StatusCallback: request.statusCallback,
    }

    Object.keys(apiParams).forEach((key) => {
      if (apiParams[key] === undefined) delete apiParams[key]
    })

    const response = (await this._request(
      'POST',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages.json`,
      apiParams
    )) as Message

    return this._messageToResponse(response)
  }

  // ===========================================================================
  // Message Status & Retrieval
  // ===========================================================================

  /**
   * Get message status from Twilio API
   *
   * @param sid - Message SID
   * @returns Message status
   */
  async getStatus(sid: string): Promise<WhatsAppSendResponse> {
    const response = (await this._request(
      'GET',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages/${sid}.json`
    )) as Message

    return this._messageToResponse(response)
  }

  /**
   * Delete a message
   *
   * @param sid - Message SID
   * @returns Success status
   */
  async delete(sid: string): Promise<boolean> {
    await this._request(
      'DELETE',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages/${sid}.json`
    )
    return true
  }

  /**
   * Send an interactive message (buttons, lists, or CTA URLs)
   *
   * @param request - Interactive message request
   * @returns The sent message
   */
  async sendInteractive(request: {
    to: string
    type: 'button' | 'list' | 'cta_url'
    body: string
    header?: { type: 'text' | 'image'; text?: string; mediaUrl?: string }
    footer?: string
    buttons?: Array<{ id: string; title: string }>
    buttonText?: string
    sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>
    ctaUrl?: { displayText: string; url: string }
    from?: string
    statusCallback?: string
  }): Promise<WhatsAppSendResponse> {
    // Validate based on type
    if (request.type === 'button') {
      if (!request.buttons || request.buttons.length === 0) {
        throw new TwilioWhatsAppError({
          code: 21602,
          message: 'At least one button is required.',
          more_info: 'https://www.twilio.com/docs/errors/21602',
          status: 400,
        })
      }
      if (request.buttons.length > 3) {
        throw new TwilioWhatsAppError({
          code: 21602,
          message: 'Interactive button messages support a maximum of 3 buttons.',
          more_info: 'https://www.twilio.com/docs/errors/21602',
          status: 400,
        })
      }
      for (const button of request.buttons) {
        if (button.title.length > 20) {
          throw new TwilioWhatsAppError({
            code: 21602,
            message: 'Interactive button title exceeds 20 characters.',
            more_info: 'https://www.twilio.com/docs/errors/21602',
            status: 400,
          })
        }
      }
    } else if (request.type === 'list') {
      if (!request.sections || request.sections.length === 0) {
        throw new TwilioWhatsAppError({
          code: 21602,
          message: 'At least one section is required for list messages.',
          more_info: 'https://www.twilio.com/docs/errors/21602',
          status: 400,
        })
      }
      if (request.sections.length > 10) {
        throw new TwilioWhatsAppError({
          code: 21602,
          message: 'Interactive list messages support a maximum of 10 sections.',
          more_info: 'https://www.twilio.com/docs/errors/21602',
          status: 400,
        })
      }
      for (const section of request.sections) {
        if (section.rows.length > 10) {
          throw new TwilioWhatsAppError({
            code: 21602,
            message: 'Interactive list messages support a maximum of 10 rows per section',
            more_info: 'https://www.twilio.com/docs/errors/21602',
            status: 400,
          })
        }
        for (const row of section.rows) {
          if (row.title.length > 24) {
            throw new TwilioWhatsAppError({
              code: 21602,
              message: 'Interactive list row title exceeds 24 characters',
              more_info: 'https://www.twilio.com/docs/errors/21602',
              status: 400,
            })
          }
          if (row.description && row.description.length > 72) {
            throw new TwilioWhatsAppError({
              code: 21602,
              message: 'Interactive list row description exceeds 72 characters',
              more_info: 'https://www.twilio.com/docs/errors/21602',
              status: 400,
            })
          }
        }
      }
      if (!request.buttonText) {
        throw new TwilioWhatsAppError({
          code: 21602,
          message: 'buttonText is required for list messages',
          more_info: 'https://www.twilio.com/docs/errors/21602',
          status: 400,
        })
      }
      if (request.buttonText.length > 20) {
        throw new TwilioWhatsAppError({
          code: 21602,
          message: 'Button text exceeds 20 characters.',
          more_info: 'https://www.twilio.com/docs/errors/21602',
          status: 400,
        })
      }
    } else if (request.type === 'cta_url') {
      if (!request.ctaUrl?.displayText) {
        throw new TwilioWhatsAppError({
          code: 21602,
          message: 'displayText is required for CTA URL messages.',
          more_info: 'https://www.twilio.com/docs/errors/21602',
          status: 400,
        })
      }
      if (!request.ctaUrl?.url) {
        throw new TwilioWhatsAppError({
          code: 21602,
          message: 'url is required for CTA URL messages.',
          more_info: 'https://www.twilio.com/docs/errors/21602',
          status: 400,
        })
      }
    }

    // Build the interactive message content
    const to = this._ensureWhatsAppPrefix(request.to)
    const from = request.from
      ? this._ensureWhatsAppPrefix(request.from)
      : this.config.from
        ? this._ensureWhatsAppPrefix(this.config.from)
        : undefined

    if (!from && !this.config.messagingServiceSid) {
      throw new TwilioWhatsAppError({
        code: 21603,
        message: "A 'From' number or 'MessagingServiceSid' is required.",
        more_info: 'https://www.twilio.com/docs/errors/21603',
        status: 400,
      })
    }

    const apiParams: Record<string, unknown> = {
      To: to,
      From: from,
      MessagingServiceSid: this.config.messagingServiceSid,
      ContentSid: `interactive_${request.type}`,
      Body: request.body,
      StatusCallback: request.statusCallback,
    }

    Object.keys(apiParams).forEach((key) => {
      if (apiParams[key] === undefined) delete apiParams[key]
    })

    const response = (await this._request(
      'POST',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages.json`,
      apiParams
    )) as Message

    return this._messageToResponse(response)
  }

  /**
   * Send a text message (alias for send)
   *
   * @param request - Send request with to and body
   * @returns The sent message
   */
  async sendText(request: { to: string; body: string; from?: string; statusCallback?: string; requireSession?: boolean }): Promise<WhatsAppSendResponse> {
    // If requireSession is true, check session
    if (request.requireSession) {
      const to = this._ensureWhatsAppPrefix(request.to)
      // If no session manager exists, or session isn't active, throw
      if (!this.sessionManager || !this.sessionManager.isSessionActive(to)) {
        throw new Error('WhatsApp session window is closed. Use a template message to re-engage.')
      }
    }
    return this.send(request)
  }

  /**
   * Get a message by SID (alias for getStatus)
   *
   * @param sid - Message SID
   * @returns The message
   */
  async getMessage(sid: string): Promise<WhatsAppSendResponse> {
    return this.getStatus(sid)
  }

  /**
   * List messages with optional filters
   *
   * @param filters - Optional filters (to, from, dateSent, pageSize)
   * @returns Array of messages
   */
  async listMessages(filters?: {
    to?: string
    from?: string
    dateSent?: Date
    pageSize?: number
  }): Promise<WhatsAppSendResponse[]> {
    const params: Record<string, unknown> = {}

    if (filters?.to) params.To = filters.to
    if (filters?.from) params.From = filters.from
    if (filters?.dateSent) params.DateSent = filters.dateSent.toISOString().split('T')[0]
    if (filters?.pageSize) params.PageSize = filters.pageSize

    const response = await this._request(
      'GET',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages.json`,
      params
    ) as { messages: Message[] }

    return response.messages.map(this._messageToResponse)
  }

  /**
   * Delete a message (alias for delete)
   *
   * @param sid - Message SID
   * @returns Success status
   */
  async deleteMessage(sid: string): Promise<boolean> {
    return this.delete(sid)
  }

  // ===========================================================================
  // Status Tracking
  // ===========================================================================

  /**
   * Handle a status callback from Twilio
   *
   * @param callback - Status callback payload
   * @returns Parsed status info
   */
  handleStatusCallback(callback: WhatsAppStatusPayload): {
    sid: string
    status: WhatsAppMessageStatus
    errorCode?: string
    errorMessage?: string
    timestamp: Date
  } {
    const entry: StatusEntry = {
      sid: callback.MessageSid,
      status: callback.MessageStatus,
      timestamp: new Date(),
    }

    // Add to history
    const history = this.statusHistory.get(callback.MessageSid) || []
    history.push(entry)
    this.statusHistory.set(callback.MessageSid, history)

    // Notify handlers
    for (const handler of this.statusHandlers) {
      handler(entry)
    }

    return {
      sid: callback.MessageSid,
      status: callback.MessageStatus,
      errorCode: callback.ErrorCode,
      errorMessage: callback.ErrorMessage,
      timestamp: entry.timestamp,
    }
  }

  /**
   * Get current message status
   *
   * @param sid - Message SID
   * @returns Current status or null if unknown
   */
  getMessageStatus(sid: string): WhatsAppMessageStatus | null {
    const history = this.statusHistory.get(sid)
    if (!history || history.length === 0) return null
    return history[history.length - 1].status
  }

  /**
   * Get message status history
   *
   * @param sid - Message SID
   * @returns Array of status entries
   */
  getMessageStatusHistory(sid: string): StatusEntry[] {
    return this.statusHistory.get(sid) || []
  }

  /**
   * Register a status change handler
   *
   * @param handler - Handler function
   */
  onStatusChange(handler: StatusChangeHandler): void {
    this.statusHandlers.push(handler)
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Check if a session is active for a user
   *
   * @param to - User's WhatsApp number
   * @returns Whether session is active
   */
  isSessionActive(to: string): boolean {
    if (!this.sessionManager) {
      return false // No session manager means no sessions
    }
    return this.sessionManager.isSessionActive(to)
  }

  /**
   * Check if a session is open (alias for isSessionActive)
   *
   * @param to - User's WhatsApp number
   * @returns Whether session is open
   */
  isSessionOpen(to: string): boolean {
    return this.isSessionActive(to)
  }

  /**
   * Handle an incoming message webhook (creates/extends session)
   *
   * @param payload - Incoming webhook payload
   * @returns Session info
   */
  handleIncoming(payload: WhatsAppWebhookPayload): WhatsAppSession {
    if (!this.sessionManager) {
      // Create a temporary session manager for tracking
      this.sessionManager = new SessionManager(this.config.sessionExpiryMs ?? DEFAULT_SESSION_EXPIRY)
    }

    return this.sessionManager.recordIncoming(payload.From)
  }

  /**
   * Clear all sessions
   */
  clearSessions(): void {
    if (this.sessionManager) {
      this.sessionManager.clear()
    }
  }

  /**
   * Get session details for a user
   *
   * @param to - User's WhatsApp number
   * @returns Session details or null
   */
  getSession(to: string): WhatsAppSession | null {
    if (!this.sessionManager) {
      return null
    }
    return this.sessionManager.getSession(to)
  }

  /**
   * Get time remaining in session (milliseconds)
   *
   * @param to - User's WhatsApp number
   * @returns Time remaining in milliseconds
   */
  getSessionTimeRemaining(to: string): number {
    if (!this.sessionManager) {
      return Infinity
    }
    return this.sessionManager.getTimeRemaining(to)
  }

  /**
   * Clear expired sessions
   *
   * @returns Number of sessions cleared
   */
  clearExpiredSessions(): number {
    if (!this.sessionManager) {
      return 0
    }
    return this.sessionManager.clearExpired()
  }

  // ===========================================================================
  // Webhooks
  // ===========================================================================

  /**
   * Handle incoming webhook from Twilio
   *
   * @param payload - Webhook payload
   * @returns Parsed message data
   */
  handleWebhook(payload: WhatsAppWebhookPayload): {
    type: 'message' | 'status'
    data: WhatsAppWebhookPayload
    session?: WhatsAppSession
  } {
    // Determine if this is an incoming message or status update
    const isIncoming = payload.Body !== undefined || payload.NumMedia !== undefined

    if (isIncoming && this.sessionManager) {
      // Record incoming message to extend session
      const session = this.sessionManager.recordIncoming(payload.From)
      return {
        type: 'message',
        data: payload,
        session,
      }
    }

    return {
      type: isIncoming ? 'message' : 'status',
      data: payload,
    }
  }

  /**
   * Verify webhook signature
   *
   * @param signature - X-Twilio-Signature header
   * @param url - Full webhook URL
   * @param params - Request parameters
   * @returns Whether signature is valid
   */
  async verifyWebhookSignature(
    signature: string,
    url: string,
    params: Record<string, string>
  ): Promise<boolean> {
    const secret = this.config.webhookSecret || this.authToken
    const expectedSignature = await this._getExpectedSignature(secret, url, params)
    return this._secureCompare(signature, expectedSignature)
  }

  /**
   * Create a Hono router for handling webhooks
   *
   * @returns Hono app with webhook routes
   *
   * @example
   * ```typescript
   * const whatsapp = new TwilioWhatsApp({ ... })
   * const webhookRouter = whatsapp.createWebhookHandler()
   *
   * // Mount in your main app
   * app.route('/webhooks/whatsapp', webhookRouter)
   * ```
   */
  createWebhookHandler(): Hono {
    const router = new Hono()

    // Status callback webhook
    router.post('/status', async (c) => {
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

      // Verify signature if configured
      const signature = c.req.header('X-Twilio-Signature')
      if (signature && this.config.webhookSecret) {
        const url = c.req.url
        const isValid = await this.verifyWebhookSignature(signature, url, payload)
        if (!isValid) {
          return c.json({ error: 'Invalid signature' }, 403)
        }
      }

      // Handle status callback
      this.handleStatusCallback(payload as unknown as WhatsAppStatusPayload)
      this.handleWebhook(payload as unknown as WhatsAppWebhookPayload)

      return c.json({ success: true }, 200)
    })

    // Incoming message webhook
    router.post('/incoming', async (c) => {
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

      // Verify signature if configured
      const signature = c.req.header('X-Twilio-Signature')
      if (signature && this.config.webhookSecret) {
        const url = c.req.url
        const isValid = await this.verifyWebhookSignature(signature, url, payload)
        if (!isValid) {
          return c.json({ error: 'Invalid signature' }, 403)
        }
      }

      // Handle incoming message and create/extend session
      this.handleIncoming(payload as unknown as WhatsAppWebhookPayload)
      this.handleWebhook(payload as unknown as WhatsAppWebhookPayload)

      // Return empty TwiML response
      return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
        'Content-Type': 'application/xml',
      })
    })

    // Legacy /inbound route (alias for /incoming)
    router.post('/inbound', async (c) => {
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

      // Verify signature if configured
      const signature = c.req.header('X-Twilio-Signature')
      if (signature && this.config.webhookSecret) {
        const url = c.req.url
        const isValid = await this.verifyWebhookSignature(signature, url, payload)
        if (!isValid) {
          return c.json({ error: 'Invalid signature' }, 403)
        }
      }

      this.handleWebhook(payload as unknown as WhatsAppWebhookPayload)

      // Return empty TwiML response
      return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
        'Content-Type': 'application/xml',
      })
    })

    return router
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Validate send request
   */
  private _validateSendRequest(request: WhatsAppSendRequest): void {
    if (!request.to) {
      throw new TwilioWhatsAppError({
        code: 21604,
        message: "The 'To' number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21604',
        status: 400,
      })
    }

    if (!request.body && !request.mediaUrl?.length && !request.contentSid) {
      throw new TwilioWhatsAppError({
        code: 21602,
        message: "A 'Body', 'MediaUrl', or 'ContentSid' is required.",
        more_info: 'https://www.twilio.com/docs/errors/21602',
        status: 400,
      })
    }

    // Message body length validation
    if (request.body && request.body.length > 4096) {
      throw new TwilioWhatsAppError({
        code: 21617,
        message: 'Message body exceeds 4096 characters.',
        more_info: 'https://www.twilio.com/docs/errors/21617',
        status: 400,
      })
    }
  }

  /**
   * Normalize send request with defaults
   */
  private _normalizeSendRequest(request: WhatsAppSendRequest): WhatsAppSendRequest {
    const to = this._ensureWhatsAppPrefix(request.to)
    const from = request.from
      ? this._ensureWhatsAppPrefix(request.from)
      : this.config.from
        ? this._ensureWhatsAppPrefix(this.config.from)
        : undefined

    if (!from && !request.messagingServiceSid && !this.config.messagingServiceSid) {
      throw new TwilioWhatsAppError({
        code: 21603,
        message: "A 'From' number or 'MessagingServiceSid' is required.",
        more_info: 'https://www.twilio.com/docs/errors/21603',
        status: 400,
      })
    }

    return {
      ...request,
      to,
      from,
      messagingServiceSid: request.messagingServiceSid || this.config.messagingServiceSid,
    }
  }

  /**
   * Get from number with validation
   */
  private _getFromNumber(from?: string): string | undefined {
    if (from) {
      return this._ensureWhatsAppPrefix(from)
    }
    if (this.config.from) {
      return this._ensureWhatsAppPrefix(this.config.from)
    }
    return undefined
  }

  /**
   * Ensure WhatsApp prefix on phone number
   */
  private _ensureWhatsAppPrefix(number: string): string {
    if (number.startsWith('whatsapp:')) {
      return number
    }
    return `whatsapp:${number}`
  }

  /**
   * Send message via Twilio API
   */
  private async _sendMessage(request: WhatsAppSendRequest): Promise<WhatsAppSendResponse> {
    const apiParams: Record<string, unknown> = {
      To: request.to,
      Body: request.body,
      From: request.from,
      MessagingServiceSid: request.messagingServiceSid,
      MediaUrl: request.mediaUrl,
      ContentSid: request.contentSid,
      ContentVariables: request.contentVariables,
      StatusCallback: request.statusCallback,
      ValidityPeriod: request.validityPeriod,
      PersistentAction: request.persistentAction,
    }

    // Remove undefined values
    Object.keys(apiParams).forEach((key) => {
      if (apiParams[key] === undefined) delete apiParams[key]
    })

    const response = (await this._request(
      'POST',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages.json`,
      apiParams
    )) as Message

    return this._messageToResponse(response)
  }

  /**
   * Convert Twilio Message to WhatsAppSendResponse
   */
  private _messageToResponse = (message: Message): WhatsAppSendResponse => {
    return {
      sid: message.sid,
      accountSid: message.account_sid,
      to: message.to,
      from: message.from,
      body: message.body,
      status: message.status as WhatsAppMessageStatus,
      direction: message.direction,
      dateCreated: new Date(message.date_created),
      dateSent: message.date_sent ? new Date(message.date_sent) : null,
      errorCode: message.error_code,
      errorMessage: message.error_message,
      numSegments: parseInt(message.num_segments, 10),
      num_media: message.num_media,
      price: message.price,
      priceUnit: message.price_unit,
    }
  }

  /**
   * Make API request to Twilio
   */
  private async _request(
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
      body = this._encodeFormData(params)
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
            throw new TwilioWhatsAppError(data as TwilioErrorResponse)
          }

          return data
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors (4xx)
        if (error instanceof TwilioWhatsAppError && error.status >= 400 && error.status < 500) {
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
   * Encode form data
   */
  private _encodeFormData(data: Record<string, unknown>, prefix = ''): string {
    const parts: string[] = []

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue

      const fullKey = prefix ? `${prefix}[${key}]` : key

      if (value === null || value === '') {
        parts.push(`${encodeURIComponent(fullKey)}=`)
      } else if (Array.isArray(value)) {
        value.forEach((item) => {
          parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(item))}`)
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
   * Get expected Twilio signature
   */
  private async _getExpectedSignature(
    authToken: string,
    url: string,
    params: Record<string, string>
  ): Promise<string> {
    const sortedKeys = Object.keys(params).sort()
    let data = url
    for (const key of sortedKeys) {
      data += key + params[key]
    }

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
    const signatureBytes = new Uint8Array(signature)
    return btoa(Array.from(signatureBytes).map((b) => String.fromCharCode(b)).join(''))
  }

  /**
   * Constant-time string comparison
   */
  private _secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
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
 * Create a TwilioWhatsApp client
 *
 * @param accountSid - Twilio Account SID
 * @param authToken - Twilio Auth Token
 * @param config - Additional configuration
 * @returns TwilioWhatsApp instance
 *
 * @example
 * ```typescript
 * import { createWhatsAppClient } from '@dotdo/twilio/whatsapp'
 *
 * const whatsapp = createWhatsAppClient('AC...', 'token', {
 *   from: 'whatsapp:+14155238886',
 *   trackSessions: true,
 * })
 * ```
 */
export function createWhatsAppClient(
  accountSid: string,
  authToken: string,
  config?: Omit<TwilioWhatsAppConfig, 'accountSid' | 'authToken'>
): TwilioWhatsApp {
  return new TwilioWhatsApp({ accountSid, authToken, ...config })
}

// =============================================================================
// Exports
// =============================================================================

export default TwilioWhatsApp
