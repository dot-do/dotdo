/**
 * @dotdo/supabase-auth - Auth Client with In-Memory Backend
 *
 * A Supabase Auth compatible client that stores all user data in memory.
 * Perfect for testing, development, and edge environments where you want
 * auth functionality without external dependencies.
 *
 * Key Features:
 * - Full Supabase Auth API compatibility
 * - In-memory user and session storage
 * - Password hashing (simulated for in-memory use)
 * - Token generation and validation
 * - Auth state change subscriptions
 *
 * @module
 */

import type {
  User,
  Session,
  AuthError,
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
} from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

/**
 * In-memory user record with password hash
 */
interface StoredUser extends User {
  password_hash: string
}

/**
 * In-memory storage for users and sessions
 */
class InMemoryAuthStore {
  private users = new Map<string, StoredUser>()
  private usersByEmail = new Map<string, string>() // email -> userId
  private usersByPhone = new Map<string, string>() // phone -> userId
  private sessions = new Map<string, Session>() // access_token -> Session
  private refreshTokens = new Map<string, string>() // refresh_token -> access_token

  /**
   * Simple password "hashing" for in-memory use
   * In production, you'd use a real hashing algorithm
   */
  private hashPassword(password: string): string {
    // Simple hash for in-memory - NOT SECURE FOR PRODUCTION
    return `hash_${password}_${password.length}`
  }

  /**
   * Verify password against hash
   */
  private verifyPassword(password: string, hash: string): boolean {
    return this.hashPassword(password) === hash
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
  }

  /**
   * Generate access token
   */
  private generateAccessToken(): string {
    return `at_${this.generateId()}_${Date.now()}`
  }

  /**
   * Generate refresh token
   */
  private generateRefreshToken(): string {
    return `rt_${this.generateId()}_${Date.now()}`
  }

  /**
   * Create a new user
   */
  createUser(
    email: string | undefined,
    phone: string | undefined,
    password: string,
    metadata?: Record<string, unknown>
  ): { user: User; session: Session } | { error: AuthError } {
    // Check for existing user
    if (email && this.usersByEmail.has(email)) {
      return {
        error: {
          message: 'User already registered',
          name: 'AuthError',
          status: 400,
        },
      }
    }
    if (phone && this.usersByPhone.has(phone)) {
      return {
        error: {
          message: 'User already registered',
          name: 'AuthError',
          status: 400,
        },
      }
    }

    // Validate password
    if (password.length < 6) {
      return {
        error: {
          message: 'Password must be at least 6 characters',
          name: 'AuthError',
          status: 400,
        },
      }
    }

    const now = new Date().toISOString()
    const userId = this.generateId()

    const user: StoredUser = {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: now,
      phone,
      phone_confirmed_at: phone ? now : undefined,
      confirmed_at: now,
      last_sign_in_at: now,
      app_metadata: {
        provider: email ? 'email' : 'phone',
        providers: [email ? 'email' : 'phone'],
      },
      user_metadata: metadata ?? {},
      identities: [],
      factors: [],
      created_at: now,
      updated_at: now,
      password_hash: this.hashPassword(password),
    }

    // Store user
    this.users.set(userId, user)
    if (email) this.usersByEmail.set(email, userId)
    if (phone) this.usersByPhone.set(phone, userId)

    // Create session
    const session = this.createSession(user)

    // Return user without password hash
    const { password_hash, ...userWithoutPassword } = user

    return { user: userWithoutPassword, session }
  }

  /**
   * Sign in with password
   */
  signIn(
    email: string | undefined,
    phone: string | undefined,
    password: string
  ): { user: User; session: Session } | { error: AuthError } {
    // Find user
    let userId: string | undefined
    if (email) {
      userId = this.usersByEmail.get(email)
    } else if (phone) {
      userId = this.usersByPhone.get(phone)
    }

    if (!userId) {
      return {
        error: {
          message: 'Invalid login credentials',
          name: 'AuthError',
          status: 400,
        },
      }
    }

    const user = this.users.get(userId)
    if (!user) {
      return {
        error: {
          message: 'Invalid login credentials',
          name: 'AuthError',
          status: 400,
        },
      }
    }

    // Verify password
    if (!this.verifyPassword(password, user.password_hash)) {
      return {
        error: {
          message: 'Invalid login credentials',
          name: 'AuthError',
          status: 400,
        },
      }
    }

    // Update last sign in
    user.last_sign_in_at = new Date().toISOString()

    // Create session
    const session = this.createSession(user)

    // Return user without password hash
    const { password_hash, ...userWithoutPassword } = user

    return { user: userWithoutPassword, session }
  }

  /**
   * Create a session for a user
   */
  private createSession(user: StoredUser): Session {
    const accessToken = this.generateAccessToken()
    const refreshToken = this.generateRefreshToken()

    const { password_hash, ...userWithoutPassword } = user

    const session: Session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600, // 1 hour
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: userWithoutPassword,
    }

    this.sessions.set(accessToken, session)
    this.refreshTokens.set(refreshToken, accessToken)

    return session
  }

  /**
   * Get session by access token
   */
  getSession(accessToken: string): Session | null {
    return this.sessions.get(accessToken) ?? null
  }

  /**
   * Get user by access token
   */
  getUserByAccessToken(accessToken: string): User | null {
    const session = this.sessions.get(accessToken)
    return session?.user ?? null
  }

  /**
   * Refresh session using refresh token
   */
  refreshSession(refreshToken: string): { session: Session } | { error: AuthError } {
    const oldAccessToken = this.refreshTokens.get(refreshToken)
    if (!oldAccessToken) {
      return {
        error: {
          message: 'Invalid refresh token',
          name: 'AuthError',
          status: 400,
        },
      }
    }

    const oldSession = this.sessions.get(oldAccessToken)
    if (!oldSession) {
      return {
        error: {
          message: 'Session not found',
          name: 'AuthError',
          status: 400,
        },
      }
    }

    // Get user
    const storedUser = this.users.get(oldSession.user.id)
    if (!storedUser) {
      return {
        error: {
          message: 'User not found',
          name: 'AuthError',
          status: 400,
        },
      }
    }

    // Delete old session
    this.sessions.delete(oldAccessToken)
    this.refreshTokens.delete(refreshToken)

    // Create new session
    const session = this.createSession(storedUser)

    return { session }
  }

  /**
   * Validate access token and return session
   */
  validateSession(accessToken: string): { session: Session } | { error: AuthError } {
    const session = this.sessions.get(accessToken)
    if (!session) {
      return {
        error: {
          message: 'Invalid session',
          name: 'AuthError',
          status: 401,
        },
      }
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    if (session.expires_at && session.expires_at < now) {
      this.sessions.delete(accessToken)
      return {
        error: {
          message: 'Session expired',
          name: 'AuthError',
          status: 401,
        },
      }
    }

    return { session }
  }

  /**
   * Invalidate session (sign out)
   */
  invalidateSession(accessToken: string): void {
    const session = this.sessions.get(accessToken)
    if (session) {
      this.sessions.delete(accessToken)
      this.refreshTokens.delete(session.refresh_token)
    }
  }

  /**
   * Update user
   */
  updateUser(
    userId: string,
    attributes: UserAttributes
  ): { user: User } | { error: AuthError } {
    const user = this.users.get(userId)
    if (!user) {
      return {
        error: {
          message: 'User not found',
          name: 'AuthError',
          status: 400,
        },
      }
    }

    // Update fields
    if (attributes.email !== undefined) {
      // Check if email is taken
      if (this.usersByEmail.has(attributes.email) && this.usersByEmail.get(attributes.email) !== userId) {
        return {
          error: {
            message: 'Email already in use',
            name: 'AuthError',
            status: 400,
          },
        }
      }
      // Remove old email mapping
      if (user.email) {
        this.usersByEmail.delete(user.email)
      }
      user.email = attributes.email
      this.usersByEmail.set(attributes.email, userId)
    }

    if (attributes.phone !== undefined) {
      // Check if phone is taken
      if (this.usersByPhone.has(attributes.phone) && this.usersByPhone.get(attributes.phone) !== userId) {
        return {
          error: {
            message: 'Phone already in use',
            name: 'AuthError',
            status: 400,
          },
        }
      }
      // Remove old phone mapping
      if (user.phone) {
        this.usersByPhone.delete(user.phone)
      }
      user.phone = attributes.phone
      this.usersByPhone.set(attributes.phone, userId)
    }

    if (attributes.password !== undefined) {
      if (attributes.password.length < 6) {
        return {
          error: {
            message: 'Password must be at least 6 characters',
            name: 'AuthError',
            status: 400,
          },
        }
      }
      user.password_hash = this.hashPassword(attributes.password)
    }

    if (attributes.data !== undefined) {
      user.user_metadata = {
        ...user.user_metadata,
        ...attributes.data,
      }
    }

    user.updated_at = new Date().toISOString()

    // Update all active sessions for this user
    for (const [token, session] of this.sessions) {
      if (session.user.id === userId) {
        const { password_hash, ...userWithoutPassword } = user
        session.user = userWithoutPassword
      }
    }

    const { password_hash, ...userWithoutPassword } = user
    return { user: userWithoutPassword }
  }
}

// ============================================================================
// AUTH CLIENT
// ============================================================================

/**
 * Supabase Auth Client with In-Memory Backend
 *
 * Provides full Supabase Auth API compatibility using in-memory storage.
 * Perfect for testing, development, and edge environments.
 */
export class AuthClient {
  private store: InMemoryAuthStore
  private options: AuthClientOptions
  private currentSession: Session | null = null
  private subscriptions = new Map<string, Subscription>()
  private refreshTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private supabaseUrl: string,
    private supabaseKey: string,
    options: AuthClientOptions = {}
  ) {
    this.store = new InMemoryAuthStore()
    this.options = {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
      ...options,
    }
  }

  /**
   * Generate a unique subscription ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
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
  }

  /**
   * Set the current session
   */
  private _setSession(session: Session | null): void {
    this.currentSession = session

    if (session && this.options.autoRefreshToken) {
      this._startAutoRefresh(session)
    }
  }

  /**
   * Start auto-refresh timer
   */
  private _startAutoRefresh(session: Session): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)

    const expiresAt = session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in
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

  // ============================================================================
  // SIGN UP
  // ============================================================================

  /**
   * Sign up with email/password or phone/password
   */
  async signUp(
    credentials: SignUpWithPasswordCredentials | SignUpWithPhoneCredentials
  ): Promise<AuthTokenResponse> {
    const isEmail = 'email' in credentials
    const result = this.store.createUser(
      isEmail ? credentials.email : undefined,
      !isEmail ? credentials.phone : undefined,
      credentials.password,
      credentials.options?.data
    )

    if ('error' in result) {
      return {
        data: { user: null, session: null },
        error: result.error,
      }
    }

    this._setSession(result.session)
    this._notifyAllSubscribers('SIGNED_IN', result.session)

    return {
      data: { user: result.user, session: result.session },
      error: null,
    }
  }

  // ============================================================================
  // SIGN IN
  // ============================================================================

  /**
   * Sign in with email/password or phone/password
   */
  async signInWithPassword(
    credentials: SignInWithPasswordCredentials
  ): Promise<AuthTokenResponse> {
    const result = this.store.signIn(
      credentials.email,
      credentials.phone,
      credentials.password
    )

    if ('error' in result) {
      return {
        data: { user: null, session: null },
        error: result.error,
      }
    }

    this._setSession(result.session)
    this._notifyAllSubscribers('SIGNED_IN', result.session)

    return {
      data: { user: result.user, session: result.session },
      error: null,
    }
  }

  /**
   * Sign in with OAuth provider
   * Note: In-memory backend doesn't support real OAuth - returns URL for compatibility
   */
  async signInWithOAuth(
    credentials: SignInWithOAuthCredentials
  ): Promise<{
    data: { provider: string; url: string } | null
    error: AuthError | null
  }> {
    const { provider, options } = credentials

    const params = new URLSearchParams({ provider })
    if (options?.redirectTo) {
      params.set('redirect_to', options.redirectTo)
    }
    if (options?.scopes) {
      params.set('scopes', options.scopes)
    }

    const url = `${this.supabaseUrl}/auth/v1/authorize?${params.toString()}`

    return {
      data: { provider, url },
      error: null,
    }
  }

  /**
   * Sign in with OTP
   * Note: In-memory backend doesn't send real OTPs
   */
  async signInWithOtp(credentials: SignInWithOtpCredentials): Promise<AuthOtpResponse> {
    return {
      data: { user: null, session: null, messageId: `msg_${Date.now()}` },
      error: null,
    }
  }

  /**
   * Verify OTP token
   * Note: In-memory backend accepts any token for testing
   */
  async verifyOtp(params: VerifyOtpParams): Promise<AuthTokenResponse> {
    return {
      data: { user: null, session: null },
      error: { message: 'OTP verification not supported in in-memory mode', name: 'AuthError' },
    }
  }

  // ============================================================================
  // SIGN OUT
  // ============================================================================

  /**
   * Sign out the current user
   */
  async signOut(options?: { scope?: 'global' | 'local' | 'others' }): Promise<{ error: AuthError | null }> {
    if (this.currentSession) {
      this.store.invalidateSession(this.currentSession.access_token)
    }

    this._stopAutoRefresh()
    this.currentSession = null

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

    const result = this.store.refreshSession(this.currentSession.refresh_token)

    if ('error' in result) {
      return {
        data: { user: null, session: null },
        error: result.error,
      }
    }

    this._setSession(result.session)
    this._notifyAllSubscribers('TOKEN_REFRESHED', result.session)

    return {
      data: { user: result.session.user, session: result.session },
      error: null,
    }
  }

  /**
   * Set session manually
   */
  async setSession(params: {
    access_token: string
    refresh_token: string
  }): Promise<AuthTokenResponse> {
    const result = this.store.validateSession(params.access_token)

    if ('error' in result) {
      return {
        data: { user: null, session: null },
        error: result.error,
      }
    }

    this._setSession(result.session)
    this._notifyAllSubscribers('SIGNED_IN', result.session)

    return {
      data: { user: result.session.user, session: result.session },
      error: null,
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

    const user = this.store.getUserByAccessToken(this.currentSession.access_token)

    return {
      data: { user },
      error: null,
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

    const result = this.store.updateUser(this.currentSession.user.id, attributes)

    if ('error' in result) {
      return {
        data: { user: null },
        error: result.error,
      }
    }

    // Update session with new user data
    if (this.currentSession) {
      this.currentSession.user = result.user
    }

    this._notifyAllSubscribers('USER_UPDATED', this.currentSession)

    return {
      data: { user: result.user },
      error: null,
    }
  }

  // ============================================================================
  // PASSWORD RESET
  // ============================================================================

  /**
   * Request password reset email
   * Note: In-memory backend doesn't send real emails
   */
  async resetPasswordForEmail(
    email: string,
    options?: ResetPasswordForEmailOptions
  ): Promise<{ data: object; error: AuthError | null }> {
    // In-memory backend - always succeed (for security, don't reveal if email exists)
    return { data: {}, error: null }
  }

  // ============================================================================
  // AUTH STATE CHANGE
  // ============================================================================

  /**
   * Subscribe to auth state changes
   */
  onAuthStateChange(callback: AuthStateChangeCallback): AuthOnChangeResponse {
    const id = this.generateId()

    const subscription: Subscription = {
      id,
      callback,
      unsubscribe: () => {
        this.subscriptions.delete(id)
      },
    }

    this.subscriptions.set(id, subscription)

    // Immediately notify with current session if exists
    if (this.currentSession) {
      setTimeout(() => {
        callback('INITIAL_SESSION', this.currentSession)
      }, 0)
    }

    return {
      data: { subscription },
    }
  }
}
