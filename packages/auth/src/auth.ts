/**
 * @dotdo/auth - Main Auth Class
 *
 * Unified authentication API with multi-provider support.
 *
 * @module
 */

import type { User, Session, TokenPair, AuthConfig, AuthResult, TokenValidationResult } from './types'
import { AuthError, AuthErrors } from './error'
import { createInMemoryStorage, IndexedStorage } from './storage'
import { UserManager, type CreateUserParams } from './users'
import { SessionManager } from './sessions'
import { MFAManager } from './mfa'
import { OAuthManager } from './oauth'

// ============================================================================
// AUTH CLASS
// ============================================================================

/**
 * Main authentication class
 */
export class Auth {
  readonly users: UserManager
  readonly sessions: SessionManager
  readonly mfa: MFAManager
  readonly oauth: OAuthManager

  private storage: IndexedStorage

  constructor(config: AuthConfig) {
    const storageBackend = config.storage ?? createInMemoryStorage()
    this.storage = new IndexedStorage(storageBackend)

    this.users = new UserManager(this.storage, config)
    this.sessions = new SessionManager(this.storage, config)
    this.mfa = new MFAManager(this.storage, config)
    this.oauth = new OAuthManager(this.storage, config)
  }

  // ============================================================================
  // SIGN UP / SIGN IN / SIGN OUT
  // ============================================================================

  /**
   * Create a new user account and session
   */
  async signUp(params: {
    email?: string
    phone?: string
    username?: string
    password: string
    firstName?: string
    lastName?: string
    metadata?: Record<string, unknown>
  }): Promise<AuthResult> {
    const user = await this.users.create({
      email: params.email,
      phone: params.phone,
      username: params.username,
      password: params.password,
      first_name: params.firstName,
      last_name: params.lastName,
      metadata: params.metadata,
    })

    const { session, tokens } = await this.sessions.create(user)

    return { user, session, tokens }
  }

  /**
   * Authenticate a user and create a session
   */
  async signIn(params: {
    email?: string
    phone?: string
    username?: string
    password: string
  }): Promise<AuthResult> {
    const identifier = params.email ?? params.phone ?? params.username
    if (!identifier) {
      throw new AuthError('invalid_request', 'Email, phone, or username is required', 400)
    }

    const result = await this.users.verifyPassword(identifier, params.password)

    if (!result.valid || !result.user) {
      if (result.locked && result.lockUntil) {
        throw AuthErrors.accountLocked(result.lockUntil)
      }
      throw AuthErrors.invalidCredentials()
    }

    const { session, tokens } = await this.sessions.create(result.user)

    return { user: result.user, session, tokens }
  }

  /**
   * Sign out a session
   */
  async signOut(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId)
  }

  /**
   * Sign out all sessions for a user
   */
  async signOutAll(userId: string, exceptSessionId?: string): Promise<number> {
    return this.sessions.revokeAll(userId, exceptSessionId)
  }

  // ============================================================================
  // TOKEN OPERATIONS
  // ============================================================================

  /**
   * Validate an access token
   */
  async validateToken(accessToken: string): Promise<TokenValidationResult> {
    const result = await this.sessions.validate(accessToken)

    if (!result.valid || !result.session) {
      return { valid: false, error: result.error }
    }

    const user = await this.users.get(result.session.user_id)
    if (!user) {
      return { valid: false, error: 'User not found' }
    }

    return {
      valid: true,
      user,
      session: result.session,
    }
  }

  /**
   * Refresh tokens using a refresh token
   */
  async refreshToken(refreshToken: string): Promise<TokenPair> {
    // First, find the user from the refresh token
    const tokenHash = await this.hashToken(refreshToken)
    const tokenData = await this.storage.get<{ session_id: string; user_id: string; expires_at: string }>(`refresh:${tokenHash}`)

    if (!tokenData) {
      throw AuthErrors.invalidToken()
    }

    const user = await this.users.get(tokenData.user_id)
    if (!user) {
      throw AuthErrors.userNotFound()
    }

    const { tokens } = await this.sessions.refresh(refreshToken, user)
    return tokens
  }

  // ============================================================================
  // PASSWORD OPERATIONS
  // ============================================================================

  /**
   * Request a password reset token
   */
  async requestPasswordReset(email: string): Promise<string | null> {
    return this.users.generatePasswordResetToken(email)
  }

  /**
   * Reset password with a token
   */
  async resetPassword(token: string, newPassword: string): Promise<User> {
    return this.users.resetPasswordWithToken(token, newPassword)
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    return this.users.changePassword(userId, currentPassword, newPassword)
  }

  // ============================================================================
  // EMAIL VERIFICATION
  // ============================================================================

  /**
   * Request email verification token
   */
  async requestEmailVerification(userId: string): Promise<string> {
    return this.users.generateEmailVerificationToken(userId)
  }

  /**
   * Verify email with token
   */
  async verifyEmail(token: string): Promise<User> {
    return this.users.verifyEmailToken(token)
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an Auth instance
 */
export function createAuth(config: AuthConfig): Auth {
  return new Auth(config)
}
