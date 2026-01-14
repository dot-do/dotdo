/**
 * @dotdo/auth0 - Tickets Manager
 *
 * Auth0 Management API Ticket operations for password reset and email verification.
 *
 * @see https://auth0.com/docs/api/management/v2#!/Tickets
 * @module
 */

import type { PasswordResetTicket, EmailVerificationTicket, UserRecord } from './types'
import { Auth0ManagementError } from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parameters for password change ticket
 */
export interface ChangePasswordTicketParams {
  /** User ID */
  user_id: string
  /** URL to redirect after password reset */
  result_url?: string
  /** TTL in seconds */
  ttl_sec?: number
  /** Mark email as verified after reset */
  mark_email_as_verified?: boolean
  /** Include email in redirect URL */
  includeEmailInRedirect?: boolean
  /** Client ID */
  client_id?: string
  /** Organization ID */
  organization_id?: string
  /** Connection ID */
  connection_id?: string
}

/**
 * Parameters for email verification ticket
 */
export interface VerifyEmailTicketParams {
  /** User ID */
  user_id: string
  /** URL to redirect after verification */
  result_url?: string
  /** TTL in seconds */
  ttl_sec?: number
  /** Include email in redirect URL */
  includeEmailInRedirect?: boolean
  /** Identity info */
  identity?: {
    user_id: string
    provider: string
  }
}

// ============================================================================
// TICKETS MANAGER OPTIONS
// ============================================================================

/**
 * Options for TicketsManager
 */
export interface TicketsManagerOptions {
  /** Auth0 domain */
  domain: string
  /** User lookup function */
  getUser: (userId: string) => UserRecord | undefined
  /** Default TTL for password reset tickets (seconds) */
  passwordResetTTL?: number
  /** Default TTL for email verification tickets (seconds) */
  emailVerificationTTL?: number
}

// ============================================================================
// TICKETS MANAGER
// ============================================================================

/**
 * Auth0 Tickets Manager
 *
 * Provides ticket operations for password reset and email verification.
 */
export class TicketsManager {
  private domain: string
  private getUser: (userId: string) => UserRecord | undefined
  private passwordResetTTL: number
  private emailVerificationTTL: number

  // Store for active tickets
  private tickets = new Map<string, {
    type: 'password' | 'email'
    user_id: string
    expires_at: string
    result_url?: string
  }>()

  constructor(options: TicketsManagerOptions) {
    this.domain = options.domain
    this.getUser = options.getUser
    this.passwordResetTTL = options.passwordResetTTL ?? 3600 // 1 hour
    this.emailVerificationTTL = options.emailVerificationTTL ?? 432000 // 5 days
  }

  /**
   * Create a password change ticket
   *
   * @see https://auth0.com/docs/api/management/v2#!/Tickets/post_password_change
   */
  async changePassword(params: ChangePasswordTicketParams): Promise<PasswordResetTicket> {
    const user = this.getUser(params.user_id)
    if (!user) {
      throw new Auth0ManagementError('User not found', 404, 'inexistent_user')
    }

    const ticketId = this.generateTicketId()
    const ttl = params.ttl_sec ?? this.passwordResetTTL
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()

    // Store ticket
    this.tickets.set(ticketId, {
      type: 'password',
      user_id: params.user_id,
      expires_at: expiresAt,
      result_url: params.result_url,
    })

    // Build ticket URL
    let ticketUrl = `https://${this.domain}/lo/reset?ticket=${ticketId}`
    if (params.result_url) {
      ticketUrl += `&redirectTo=${encodeURIComponent(params.result_url)}`
    }
    if (params.includeEmailInRedirect && user.email) {
      ticketUrl += `&email=${encodeURIComponent(user.email)}`
    }

    return {
      ticket: ticketUrl,
    }
  }

  /**
   * Create an email verification ticket
   *
   * @see https://auth0.com/docs/api/management/v2#!/Tickets/post_email_verification
   */
  async verifyEmail(params: VerifyEmailTicketParams): Promise<EmailVerificationTicket> {
    const user = this.getUser(params.user_id)
    if (!user) {
      throw new Auth0ManagementError('User not found', 404, 'inexistent_user')
    }

    const ticketId = this.generateTicketId()
    const ttl = params.ttl_sec ?? this.emailVerificationTTL
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()

    // Store ticket
    this.tickets.set(ticketId, {
      type: 'email',
      user_id: params.user_id,
      expires_at: expiresAt,
      result_url: params.result_url,
    })

    // Build ticket URL
    let ticketUrl = `https://${this.domain}/lo/verify?ticket=${ticketId}`
    if (params.result_url) {
      ticketUrl += `&redirectTo=${encodeURIComponent(params.result_url)}`
    }
    if (params.includeEmailInRedirect && user.email) {
      ticketUrl += `&email=${encodeURIComponent(user.email)}`
    }

    return {
      ticket: ticketUrl,
    }
  }

  /**
   * Generate a ticket ID
   */
  private generateTicketId(): string {
    const bytes = new Uint8Array(24)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}
