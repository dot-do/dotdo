/**
 * @dotdo/supabase-auth - Auth Client Implementation
 *
 * Edge-compatible Supabase Auth client that integrates with oauth.do
 * for actual authentication operations.
 *
 * @module
 */

import { EventEmitter } from '../shared/event-emitter'
import type {
  User,
  Session,
  AuthError,
  SupabaseAuthError,
  AuthTokenResponse,
  AuthOtpResponse,
  UserResponse,
  SignUpWithPasswordCredentials,
  SignUpWithPhoneCredentials,
  SignInWithPasswordCredentials,
  SignInWithOAuthCredentials,
  SignInWithOtpCredentials,
  VerifyOtpParams,
  UserAttributes,
  ResetPasswordForEmailOptions,
  AuthChangeEvent,
  AuthStateChangeCallback,
  Subscription,
  AuthOnChangeResponse,
  AuthClientOptions,
  MFAEnrollResponse,
  MFAChallengeResponse,
  MFAVerifyResponse,
  MFAListFactorsResponse,
  MFAUnenrollResponse,
  Factor,
} from './types'

// ============================================================================
// STORAGE IMPLEMENTATION
// ============================================================================

/**
 * In-memory storage for edge environments
 */
class MemoryStorage {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }
}

// ============================================================================
// MFA API
// ============================================================================

/**
 * MFA (Multi-Factor Authentication) API
 */
export class MFAApi {
  constructor(
    private authClient: AuthClient,
    private supabaseUrl: string,
    private headers: Record<string, string>
  ) {}

  /**
   * Enroll a new MFA factor (TOTP)
   */
  async enroll(params: {
    factorType: 'totp'
    issuer?: string
    friendlyName?: string
  }): Promise<MFAEnrollResponse> {
    const session = await this.authClient.getSession()
    if (!session.data.session) {
      return {
        data: null,
        error: { message: 'No active session', name: 'AuthError' },
      }
    }

    try {
      const response = await fetch(`${this.supabaseUrl}/auth/v1/factors`, {
        method: 'POST',
        headers: {
          ...this.headers,
          Authorization: `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          factor_type: params.factorType,
          issuer: params.issuer,
          friendly_name: params.friendlyName,
        }),
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: null,
          error: { message: error.message || 'Failed to enroll MFA', name: 'AuthError', status: response.status },
        }
      }

      const data = await response.json() as MFAEnrollResponse['data']
      return { data, error: null }
    } catch (err) {
      return {
        data: null,
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  /**
   * Create an MFA challenge
   */
  async challenge(params: { factorId: string }): Promise<MFAChallengeResponse> {
    const session = await this.authClient.getSession()
    if (!session.data.session) {
      return {
        data: null,
        error: { message: 'No active session', name: 'AuthError' },
      }
    }

    try {
      const response = await fetch(`${this.supabaseUrl}/auth/v1/factors/${params.factorId}/challenge`, {
        method: 'POST',
        headers: {
          ...this.headers,
          Authorization: `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: null,
          error: { message: error.message || 'Failed to create challenge', name: 'AuthError', status: response.status },
        }
      }

      const data = await response.json() as MFAChallengeResponse['data']
      return { data, error: null }
    } catch (err) {
      return {
        data: null,
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  /**
   * Verify an MFA challenge
   */
  async verify(params: {
    factorId: string
    challengeId: string
    code: string
  }): Promise<MFAVerifyResponse> {
    const session = await this.authClient.getSession()
    if (!session.data.session) {
      return {
        data: null,
        error: { message: 'No active session', name: 'AuthError' },
      }
    }

    try {
      const response = await fetch(
        `${this.supabaseUrl}/auth/v1/factors/${params.factorId}/verify`,
        {
          method: 'POST',
          headers: {
            ...this.headers,
            Authorization: `Bearer ${session.data.session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            challenge_id: params.challengeId,
            code: params.code,
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: null,
          error: { message: error.message || 'Failed to verify challenge', name: 'AuthError', status: response.status },
        }
      }

      const data = await response.json() as MFAVerifyResponse['data']

      // Update session if returned
      if (data?.session) {
        this.authClient._setSession(data.session)
      }

      return { data, error: null }
    } catch (err) {
      return {
        data: null,
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  /**
   * List enrolled MFA factors
   */
  async listFactors(): Promise<MFAListFactorsResponse> {
    const session = await this.authClient.getSession()
    if (!session.data.session) {
      return {
        data: null,
        error: { message: 'No active session', name: 'AuthError' },
      }
    }

    try {
      const response = await fetch(`${this.supabaseUrl}/auth/v1/factors`, {
        method: 'GET',
        headers: {
          ...this.headers,
          Authorization: `Bearer ${session.data.session.access_token}`,
        },
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: null,
          error: { message: error.message || 'Failed to list factors', name: 'AuthError', status: response.status },
        }
      }

      const factors = await response.json() as Factor[]
      return {
        data: {
          totp: factors.filter((f) => f.factor_type === 'totp'),
          phone: factors.filter((f) => f.factor_type === 'phone'),
        },
        error: null,
      }
    } catch (err) {
      return {
        data: null,
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  /**
   * Unenroll an MFA factor
   */
  async unenroll(params: { factorId: string }): Promise<MFAUnenrollResponse> {
    const session = await this.authClient.getSession()
    if (!session.data.session) {
      return {
        data: null,
        error: { message: 'No active session', name: 'AuthError' },
      }
    }

    try {
      const response = await fetch(`${this.supabaseUrl}/auth/v1/factors/${params.factorId}`, {
        method: 'DELETE',
        headers: {
          ...this.headers,
          Authorization: `Bearer ${session.data.session.access_token}`,
        },
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: null,
          error: { message: error.message || 'Failed to unenroll factor', name: 'AuthError', status: response.status },
        }
      }

      return { data: { id: params.factorId }, error: null }
    } catch (err) {
      return {
        data: null,
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  /**
   * Get the current MFA authentication level
   */
  async getAuthenticatorAssuranceLevel(): Promise<{
    data: {
      currentLevel: 'aal1' | 'aal2' | null
      nextLevel: 'aal1' | 'aal2' | null
      currentAuthenticationMethods: Array<{
        method: 'password' | 'otp' | 'oauth' | 'totp'
        timestamp: number
      }>
    } | null
    error: AuthError | null
  }> {
    const session = await this.authClient.getSession()
    if (!session.data.session) {
      return {
        data: {
          currentLevel: null,
          nextLevel: null,
          currentAuthenticationMethods: [],
        },
        error: null,
      }
    }

    // Parse JWT to get AAL (simplified - real implementation would decode JWT)
    const user = session.data.session.user
    const hasMFA = user.factors && user.factors.some((f) => f.status === 'verified')

    return {
      data: {
        currentLevel: 'aal1',
        nextLevel: hasMFA ? 'aal2' : 'aal1',
        currentAuthenticationMethods: [
          { method: 'password', timestamp: Date.now() },
        ],
      },
      error: null,
    }
  }
}

// ============================================================================
// AUTH CLIENT
// ============================================================================

/**
 * Supabase Auth Client
 *
 * Provides full Supabase Auth API compatibility for edge environments.
 * Integrates with oauth.do for actual authentication operations.
 */
export class AuthClient extends EventEmitter {
  private supabaseUrl: string
  private supabaseKey: string
  private options: AuthClientOptions
  private storage: {
    getItem: (key: string) => string | null | Promise<string | null>
    setItem: (key: string, value: string) => void | Promise<void>
    removeItem: (key: string) => void | Promise<void>
  }
  private currentSession: Session | null = null
  private currentUser: User | null = null
  private subscriptions = new Map<string, Subscription>()
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private storageKey: string

  /**
   * MFA API instance
   */
  public mfa: MFAApi

  constructor(
    supabaseUrl: string,
    supabaseKey: string,
    options: AuthClientOptions = {}
  ) {
    super()
    this.supabaseUrl = supabaseUrl.replace(/\/$/, '') // Remove trailing slash
    this.supabaseKey = supabaseKey
    this.options = {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
      ...options,
    }
    this.storage = options.storage ?? new MemoryStorage()
    this.storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`

    this.mfa = new MFAApi(this, this.supabaseUrl, this.getHeaders())

    // Initialize session from storage
    this._initSession()
  }

  /**
   * Get default headers for API requests
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: this.supabaseKey,
      ...(this.options.headers ?? {}),
    }
  }

  /**
   * Initialize session from storage
   */
  private async _initSession(): Promise<void> {
    if (!this.options.persistSession) return

    try {
      const stored = await this.storage.getItem(this.storageKey)
      if (stored) {
        const session = JSON.parse(stored) as Session
        if (session.expires_at && session.expires_at * 1000 > Date.now()) {
          this.currentSession = session
          this.currentUser = session.user
          this._notifyAllSubscribers('INITIAL_SESSION', session)
          this._startAutoRefresh(session)
        } else {
          // Session expired, try to refresh
          await this.refreshSession()
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Start auto-refresh timer
   */
  private _startAutoRefresh(session: Session): void {
    if (!this.options.autoRefreshToken) return
    if (this.refreshTimer) clearTimeout(this.refreshTimer)

    const expiresAt = session.expires_at ?? Date.now() / 1000 + session.expires_in
    const refreshIn = (expiresAt * 1000 - Date.now()) * 0.8 // Refresh at 80% of expiry

    if (refreshIn > 0) {
      this.refreshTimer = setTimeout(() => {
        this.refreshSession()
      }, refreshIn)
    }
  }

  /**
   * Stop auto-refresh timer
   */
  private _stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  /**
   * Notify all subscribers of auth state change
   */
  private _notifyAllSubscribers(event: AuthChangeEvent, session: Session | null): void {
    for (const subscription of this.subscriptions.values()) {
      try {
        subscription.callback(event, session)
      } catch {
        // Ignore callback errors
      }
    }
    this.emit(event, session)
  }

  /**
   * Set session (internal, used by MFA)
   */
  _setSession(session: Session): void {
    this.currentSession = session
    this.currentUser = session.user

    if (this.options.persistSession) {
      this.storage.setItem(this.storageKey, JSON.stringify(session))
    }

    this._startAutoRefresh(session)
  }

  // ============================================================================
  // SIGN UP METHODS
  // ============================================================================

  /**
   * Sign up with email/password
   */
  async signUp(
    credentials: SignUpWithPasswordCredentials | SignUpWithPhoneCredentials
  ): Promise<AuthTokenResponse> {
    const isEmail = 'email' in credentials
    const endpoint = `${this.supabaseUrl}/auth/v1/signup`

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          email: isEmail ? credentials.email : undefined,
          phone: !isEmail ? credentials.phone : undefined,
          password: credentials.password,
          data: credentials.options?.data,
          gotrue_meta_security: credentials.options?.captchaToken
            ? { captcha_token: credentials.options.captchaToken }
            : undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: { user: null, session: null },
          error: { message: error.message || 'Sign up failed', name: 'AuthError', status: response.status },
        }
      }

      const data = await response.json() as Session & { user?: User }
      const session = data.access_token ? data : null
      const user = session?.user ?? data.user ?? null

      if (session) {
        this._setSession(session)
        this._notifyAllSubscribers('SIGNED_IN', session)
      }

      return { data: { user, session }, error: null }
    } catch (err) {
      return {
        data: { user: null, session: null },
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  // ============================================================================
  // SIGN IN METHODS
  // ============================================================================

  /**
   * Sign in with email/password or phone/password
   */
  async signInWithPassword(
    credentials: SignInWithPasswordCredentials
  ): Promise<AuthTokenResponse> {
    const endpoint = `${this.supabaseUrl}/auth/v1/token?grant_type=password`

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          email: credentials.email,
          phone: credentials.phone,
          password: credentials.password,
          gotrue_meta_security: credentials.options?.captchaToken
            ? { captcha_token: credentials.options.captchaToken }
            : undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: { user: null, session: null },
          error: { message: error.message || 'Sign in failed', name: 'AuthError', status: response.status },
        }
      }

      const session = await response.json() as Session
      this._setSession(session)
      this._notifyAllSubscribers('SIGNED_IN', session)

      return { data: { user: session.user, session }, error: null }
    } catch (err) {
      return {
        data: { user: null, session: null },
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  /**
   * Sign in with OAuth provider
   * Returns URL to redirect to for OAuth flow
   */
  async signInWithOAuth(
    credentials: SignInWithOAuthCredentials
  ): Promise<{
    data: { provider: string; url: string } | null
    error: AuthError | null
  }> {
    const { provider, options } = credentials

    const params = new URLSearchParams({
      provider,
    })

    if (options?.redirectTo) {
      params.set('redirect_to', options.redirectTo)
    }
    if (options?.scopes) {
      params.set('scopes', options.scopes)
    }
    if (options?.queryParams) {
      for (const [key, value] of Object.entries(options.queryParams)) {
        params.set(key, value)
      }
    }

    const url = `${this.supabaseUrl}/auth/v1/authorize?${params.toString()}`

    return {
      data: { provider, url },
      error: null,
    }
  }

  /**
   * Sign in with OTP (magic link or SMS)
   */
  async signInWithOtp(credentials: SignInWithOtpCredentials): Promise<AuthOtpResponse> {
    const isEmail = !!credentials.email
    const endpoint = `${this.supabaseUrl}/auth/v1/otp`

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          email: credentials.email,
          phone: credentials.phone,
          create_user: credentials.options?.shouldCreateUser ?? true,
          data: credentials.options?.data,
          gotrue_meta_security: credentials.options?.captchaToken
            ? { captcha_token: credentials.options.captchaToken }
            : undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: { user: null, session: null },
          error: { message: error.message || 'OTP request failed', name: 'AuthError', status: response.status },
        }
      }

      const data = await response.json() as { message_id?: string }
      return {
        data: { user: null, session: null, messageId: data.message_id },
        error: null,
      }
    } catch (err) {
      return {
        data: { user: null, session: null },
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  /**
   * Verify OTP token
   */
  async verifyOtp(params: VerifyOtpParams): Promise<AuthTokenResponse> {
    const endpoint = `${this.supabaseUrl}/auth/v1/verify`

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          email: params.email,
          phone: params.phone,
          token: params.token,
          type: params.type,
          redirect_to: params.options?.redirectTo,
          gotrue_meta_security: params.options?.captchaToken
            ? { captcha_token: params.options.captchaToken }
            : undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: { user: null, session: null },
          error: { message: error.message || 'OTP verification failed', name: 'AuthError', status: response.status },
        }
      }

      const session = await response.json() as Session
      this._setSession(session)
      this._notifyAllSubscribers('SIGNED_IN', session)

      return { data: { user: session.user, session }, error: null }
    } catch (err) {
      return {
        data: { user: null, session: null },
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  // ============================================================================
  // SIGN OUT
  // ============================================================================

  /**
   * Sign out the current user
   */
  async signOut(options?: { scope?: 'global' | 'local' | 'others' }): Promise<{ error: AuthError | null }> {
    const scope = options?.scope ?? 'local'

    try {
      if (this.currentSession && scope !== 'local') {
        await fetch(`${this.supabaseUrl}/auth/v1/logout?scope=${scope}`, {
          method: 'POST',
          headers: {
            ...this.getHeaders(),
            Authorization: `Bearer ${this.currentSession.access_token}`,
          },
        })
      }
    } catch {
      // Ignore logout API errors
    }

    this._stopAutoRefresh()
    this.currentSession = null
    this.currentUser = null

    if (this.options.persistSession) {
      await this.storage.removeItem(this.storageKey)
    }

    this._notifyAllSubscribers('SIGNED_OUT', null)

    return { error: null }
  }

  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================

  /**
   * Get the current session
   */
  async getSession(): Promise<{
    data: { session: Session | null }
    error: AuthError | null
  }> {
    return {
      data: { session: this.currentSession },
      error: null,
    }
  }

  /**
   * Refresh the current session
   */
  async refreshSession(): Promise<AuthTokenResponse> {
    if (!this.currentSession?.refresh_token) {
      return {
        data: { user: null, session: null },
        error: { message: 'No refresh token available', name: 'AuthError' },
      }
    }

    try {
      const response = await fetch(
        `${this.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            refresh_token: this.currentSession.refresh_token,
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        // Clear invalid session
        await this.signOut({ scope: 'local' })
        return {
          data: { user: null, session: null },
          error: { message: error.message || 'Token refresh failed', name: 'AuthError', status: response.status },
        }
      }

      const session = await response.json() as Session
      this._setSession(session)
      this._notifyAllSubscribers('TOKEN_REFRESHED', session)

      return { data: { user: session.user, session }, error: null }
    } catch (err) {
      return {
        data: { user: null, session: null },
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  /**
   * Set session manually (useful for server-side rendering)
   */
  async setSession(params: {
    access_token: string
    refresh_token: string
  }): Promise<AuthTokenResponse> {
    try {
      const response = await fetch(`${this.supabaseUrl}/auth/v1/user`, {
        method: 'GET',
        headers: {
          ...this.getHeaders(),
          Authorization: `Bearer ${params.access_token}`,
        },
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: { user: null, session: null },
          error: { message: error.message || 'Invalid session', name: 'AuthError', status: response.status },
        }
      }

      const user = await response.json() as User
      const session: Session = {
        access_token: params.access_token,
        refresh_token: params.refresh_token,
        expires_in: 3600, // Default 1 hour
        token_type: 'bearer',
        user,
      }

      this._setSession(session)
      this._notifyAllSubscribers('SIGNED_IN', session)

      return { data: { user, session }, error: null }
    } catch (err) {
      return {
        data: { user: null, session: null },
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  // ============================================================================
  // USER MANAGEMENT
  // ============================================================================

  /**
   * Get the current user
   */
  async getUser(): Promise<UserResponse> {
    if (!this.currentSession) {
      return {
        data: { user: null },
        error: null,
      }
    }

    try {
      const response = await fetch(`${this.supabaseUrl}/auth/v1/user`, {
        method: 'GET',
        headers: {
          ...this.getHeaders(),
          Authorization: `Bearer ${this.currentSession.access_token}`,
        },
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: { user: null },
          error: { message: error.message || 'Failed to get user', name: 'AuthError', status: response.status },
        }
      }

      const user = await response.json() as User
      this.currentUser = user

      return { data: { user }, error: null }
    } catch (err) {
      return {
        data: { user: null },
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  /**
   * Update the current user
   */
  async updateUser(attributes: UserAttributes): Promise<UserResponse> {
    if (!this.currentSession) {
      return {
        data: { user: null },
        error: { message: 'No active session', name: 'AuthError' },
      }
    }

    try {
      const response = await fetch(`${this.supabaseUrl}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          ...this.getHeaders(),
          Authorization: `Bearer ${this.currentSession.access_token}`,
        },
        body: JSON.stringify(attributes),
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: { user: null },
          error: { message: error.message || 'Failed to update user', name: 'AuthError', status: response.status },
        }
      }

      const user = await response.json() as User
      this.currentUser = user

      // Update user in session
      if (this.currentSession) {
        this.currentSession.user = user
        this._setSession(this.currentSession)
      }

      this._notifyAllSubscribers('USER_UPDATED', this.currentSession)

      return { data: { user }, error: null }
    } catch (err) {
      return {
        data: { user: null },
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  // ============================================================================
  // PASSWORD RESET
  // ============================================================================

  /**
   * Request password reset email
   */
  async resetPasswordForEmail(
    email: string,
    options?: ResetPasswordForEmailOptions
  ): Promise<{ data: object; error: AuthError | null }> {
    try {
      const response = await fetch(`${this.supabaseUrl}/auth/v1/recover`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          email,
          redirect_to: options?.redirectTo,
          gotrue_meta_security: options?.captchaToken
            ? { captcha_token: options.captchaToken }
            : undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: {},
          error: { message: error.message || 'Password reset failed', name: 'AuthError', status: response.status },
        }
      }

      return { data: {}, error: null }
    } catch (err) {
      return {
        data: {},
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  // ============================================================================
  // AUTH STATE CHANGE LISTENER
  // ============================================================================

  /**
   * Subscribe to auth state changes
   */
  onAuthStateChange(callback: AuthStateChangeCallback): AuthOnChangeResponse {
    const id = crypto.randomUUID()

    const subscription: Subscription = {
      id,
      callback,
      unsubscribe: () => {
        this.subscriptions.delete(id)
      },
    }

    this.subscriptions.set(id, subscription)

    // Immediately notify with current session
    if (this.currentSession) {
      setTimeout(() => {
        callback('INITIAL_SESSION', this.currentSession)
      }, 0)
    }

    return {
      data: { subscription },
    }
  }

  // ============================================================================
  // EXCHANGE CODE (PKCE)
  // ============================================================================

  /**
   * Exchange authorization code for session (PKCE flow)
   */
  async exchangeCodeForSession(authCode: string): Promise<AuthTokenResponse> {
    try {
      const response = await fetch(
        `${this.supabaseUrl}/auth/v1/token?grant_type=pkce`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            auth_code: authCode,
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: { user: null, session: null },
          error: { message: error.message || 'Code exchange failed', name: 'AuthError', status: response.status },
        }
      }

      const session = await response.json() as Session
      this._setSession(session)
      this._notifyAllSubscribers('SIGNED_IN', session)

      return { data: { user: session.user, session }, error: null }
    } catch (err) {
      return {
        data: { user: null, session: null },
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  // ============================================================================
  // ADMIN METHODS (require service role key)
  // ============================================================================

  /**
   * Admin: Create a user
   */
  async admin_createUser(params: {
    email?: string
    phone?: string
    password?: string
    email_confirm?: boolean
    phone_confirm?: boolean
    user_metadata?: Record<string, unknown>
    app_metadata?: Record<string, unknown>
  }): Promise<UserResponse> {
    try {
      const response = await fetch(`${this.supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(params),
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: { user: null },
          error: { message: error.message || 'Failed to create user', name: 'AuthError', status: response.status },
        }
      }

      const user = await response.json() as User
      return { data: { user }, error: null }
    } catch (err) {
      return {
        data: { user: null },
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }

  /**
   * Admin: Delete a user
   */
  async admin_deleteUser(userId: string): Promise<{ data: { user: User | null }; error: AuthError | null }> {
    try {
      const response = await fetch(`${this.supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: this.getHeaders(),
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        return {
          data: { user: null },
          error: { message: error.message || 'Failed to delete user', name: 'AuthError', status: response.status },
        }
      }

      const user = await response.json() as User
      return { data: { user }, error: null }
    } catch (err) {
      return {
        data: { user: null },
        error: { message: (err as Error).message, name: 'AuthError' },
      }
    }
  }
}
