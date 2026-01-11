/**
 * @dotdo/supabase-auth - Supabase Auth SDK Types
 *
 * Type definitions for Supabase Auth compat layer.
 * These types are designed to be compatible with @supabase/supabase-js auth types.
 *
 * @module
 */

// ============================================================================
// USER AND SESSION TYPES
// ============================================================================

/**
 * User identity from an OAuth provider
 */
export interface UserIdentity {
  id: string
  user_id: string
  identity_data?: Record<string, unknown>
  provider: string
  created_at?: string
  last_sign_in_at?: string
  updated_at?: string
}

/**
 * User app metadata (system-managed)
 */
export interface UserAppMetadata {
  provider?: string
  providers?: string[]
  [key: string]: unknown
}

/**
 * User metadata (user-editable)
 */
export interface UserMetadata {
  [key: string]: unknown
}

/**
 * Factor for MFA
 */
export interface Factor {
  id: string
  friendly_name?: string
  factor_type: 'totp' | 'phone'
  status: 'verified' | 'unverified'
  created_at: string
  updated_at: string
}

/**
 * User object returned by auth methods
 */
export interface User {
  id: string
  aud: string
  role?: string
  email?: string
  email_confirmed_at?: string
  phone?: string
  phone_confirmed_at?: string
  confirmed_at?: string
  last_sign_in_at?: string
  app_metadata: UserAppMetadata
  user_metadata: UserMetadata
  identities?: UserIdentity[]
  factors?: Factor[]
  created_at: string
  updated_at?: string
}

/**
 * Session object
 */
export interface Session {
  access_token: string
  refresh_token: string
  expires_in: number
  expires_at?: number
  token_type: string
  user: User
}

// ============================================================================
// AUTH ERROR TYPES
// ============================================================================

/**
 * Auth error response
 */
export interface AuthError {
  message: string
  status?: number
  code?: string
  name: string
}

/**
 * Custom AuthError class
 */
export class SupabaseAuthError extends Error implements AuthError {
  status?: number
  code?: string

  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.name = 'AuthError'
    this.status = status
    this.code = code
  }
}

// ============================================================================
// AUTH RESPONSE TYPES
// ============================================================================

/**
 * Generic auth response
 */
export interface AuthResponse<T = unknown> {
  data: T | null
  error: AuthError | null
}

/**
 * Auth token response (sign in/sign up with session)
 */
export interface AuthTokenResponse {
  data: {
    user: User | null
    session: Session | null
  }
  error: AuthError | null
}

/**
 * Auth OTP response (passwordless)
 */
export interface AuthOtpResponse {
  data: {
    user: null
    session: null
    messageId?: string
  }
  error: AuthError | null
}

/**
 * User response
 */
export interface UserResponse {
  data: {
    user: User | null
  }
  error: AuthError | null
}

// ============================================================================
// SIGN UP / SIGN IN OPTIONS
// ============================================================================

/**
 * Email/password sign up credentials
 */
export interface SignUpWithPasswordCredentials {
  email: string
  password: string
  options?: {
    data?: UserMetadata
    captchaToken?: string
    emailRedirectTo?: string
  }
}

/**
 * Phone/password sign up credentials
 */
export interface SignUpWithPhoneCredentials {
  phone: string
  password: string
  options?: {
    data?: UserMetadata
    captchaToken?: string
    channel?: 'sms' | 'whatsapp'
  }
}

/**
 * Email/password sign in credentials
 */
export interface SignInWithPasswordCredentials {
  email?: string
  phone?: string
  password: string
  options?: {
    captchaToken?: string
  }
}

/**
 * OAuth sign in options
 */
export interface SignInWithOAuthCredentials {
  provider: Provider
  options?: {
    redirectTo?: string
    scopes?: string
    queryParams?: Record<string, string>
    skipBrowserRedirect?: boolean
  }
}

/**
 * OTP (One-Time Password) sign in credentials
 */
export interface SignInWithOtpCredentials {
  email?: string
  phone?: string
  options?: {
    emailRedirectTo?: string
    shouldCreateUser?: boolean
    data?: UserMetadata
    captchaToken?: string
    channel?: 'sms' | 'whatsapp'
  }
}

/**
 * Token hash verification (magic link)
 */
export interface VerifyOtpParams {
  email?: string
  phone?: string
  token: string
  type: 'sms' | 'email' | 'recovery' | 'invite' | 'magiclink' | 'signup' | 'email_change' | 'phone_change'
  options?: {
    redirectTo?: string
    captchaToken?: string
  }
}

// ============================================================================
// USER UPDATE OPTIONS
// ============================================================================

/**
 * User attributes that can be updated
 */
export interface UserAttributes {
  email?: string
  phone?: string
  password?: string
  nonce?: string
  data?: UserMetadata
}

// ============================================================================
// PASSWORD RESET OPTIONS
// ============================================================================

/**
 * Password reset options
 */
export interface ResetPasswordForEmailOptions {
  redirectTo?: string
  captchaToken?: string
}

// ============================================================================
// AUTH STATE CHANGE
// ============================================================================

/**
 * Auth change event types
 */
export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY'
  | 'MFA_CHALLENGE_VERIFIED'

/**
 * Subscription callback
 */
export type AuthStateChangeCallback = (
  event: AuthChangeEvent,
  session: Session | null
) => void

/**
 * Auth state subscription
 */
export interface Subscription {
  id: string
  callback: AuthStateChangeCallback
  unsubscribe: () => void
}

/**
 * Auth state change response
 */
export interface AuthOnChangeResponse {
  data: {
    subscription: Subscription
  }
}

// ============================================================================
// OAUTH PROVIDERS
// ============================================================================

/**
 * Supported OAuth providers
 */
export type Provider =
  | 'apple'
  | 'azure'
  | 'bitbucket'
  | 'discord'
  | 'facebook'
  | 'figma'
  | 'github'
  | 'gitlab'
  | 'google'
  | 'kakao'
  | 'keycloak'
  | 'linkedin'
  | 'linkedin_oidc'
  | 'notion'
  | 'slack'
  | 'spotify'
  | 'twitch'
  | 'twitter'
  | 'workos'
  | 'zoom'

// ============================================================================
// MFA TYPES
// ============================================================================

/**
 * MFA enroll response
 */
export interface MFAEnrollResponse {
  data: {
    id: string
    type: 'totp'
    totp: {
      qr_code: string
      secret: string
      uri: string
    }
  } | null
  error: AuthError | null
}

/**
 * MFA challenge response
 */
export interface MFAChallengeResponse {
  data: {
    id: string
    type: 'totp'
    expires_at: number
  } | null
  error: AuthError | null
}

/**
 * MFA verify response
 */
export interface MFAVerifyResponse {
  data: {
    user: User
    session: Session
  } | null
  error: AuthError | null
}

/**
 * MFA list factors response
 */
export interface MFAListFactorsResponse {
  data: {
    totp: Factor[]
    phone: Factor[]
  } | null
  error: AuthError | null
}

/**
 * MFA unenroll response
 */
export interface MFAUnenrollResponse {
  data: {
    id: string
  } | null
  error: AuthError | null
}

// ============================================================================
// CLIENT OPTIONS
// ============================================================================

/**
 * Auth client options
 */
export interface AuthClientOptions {
  /**
   * Custom storage implementation (defaults to in-memory for edge)
   */
  storage?: {
    getItem: (key: string) => string | null | Promise<string | null>
    setItem: (key: string, value: string) => void | Promise<void>
    removeItem: (key: string) => void | Promise<void>
  }

  /**
   * Auto refresh token (defaults to true)
   */
  autoRefreshToken?: boolean

  /**
   * Persist session (defaults to true)
   */
  persistSession?: boolean

  /**
   * Detect session in URL (defaults to true)
   */
  detectSessionInUrl?: boolean

  /**
   * Flow type for auth
   */
  flowType?: 'implicit' | 'pkce'

  /**
   * Custom headers
   */
  headers?: Record<string, string>
}

/**
 * Supabase client options (createClient)
 */
export interface SupabaseClientOptions {
  auth?: AuthClientOptions
  global?: {
    headers?: Record<string, string>
  }
}

// ============================================================================
// CLIENT INTERFACE (forward declaration for circular deps)
// ============================================================================

/**
 * Supabase Client interface
 * Actual implementation uses AuthClient from auth-client.ts
 */
export interface SupabaseClient {
  /**
   * Auth client instance
   */
  auth: {
    signUp: (credentials: SignUpWithPasswordCredentials | SignUpWithPhoneCredentials) => Promise<AuthTokenResponse>
    signInWithPassword: (credentials: SignInWithPasswordCredentials) => Promise<AuthTokenResponse>
    signInWithOAuth: (credentials: SignInWithOAuthCredentials) => Promise<{ data: { provider: string; url: string } | null; error: AuthError | null }>
    signInWithOtp: (credentials: SignInWithOtpCredentials) => Promise<AuthOtpResponse>
    verifyOtp: (params: VerifyOtpParams) => Promise<AuthTokenResponse>
    signOut: (options?: { scope?: 'global' | 'local' | 'others' }) => Promise<{ error: AuthError | null }>
    getSession: () => Promise<{ data: { session: Session | null }; error: AuthError | null }>
    refreshSession: () => Promise<AuthTokenResponse>
    setSession: (params: { access_token: string; refresh_token: string }) => Promise<AuthTokenResponse>
    getUser: () => Promise<UserResponse>
    updateUser: (attributes: UserAttributes) => Promise<UserResponse>
    resetPasswordForEmail: (email: string, options?: ResetPasswordForEmailOptions) => Promise<{ data: object; error: AuthError | null }>
    onAuthStateChange: (callback: AuthStateChangeCallback) => AuthOnChangeResponse
    exchangeCodeForSession: (authCode: string) => Promise<AuthTokenResponse>
    admin_createUser: (params: {
      email?: string
      phone?: string
      password?: string
      email_confirm?: boolean
      phone_confirm?: boolean
      user_metadata?: Record<string, unknown>
      app_metadata?: Record<string, unknown>
    }) => Promise<UserResponse>
    admin_deleteUser: (userId: string) => Promise<{ data: { user: User | null }; error: AuthError | null }>
    mfa: {
      enroll: (params: { factorType: 'totp'; issuer?: string; friendlyName?: string }) => Promise<MFAEnrollResponse>
      challenge: (params: { factorId: string }) => Promise<MFAChallengeResponse>
      verify: (params: { factorId: string; challengeId: string; code: string }) => Promise<MFAVerifyResponse>
      listFactors: () => Promise<MFAListFactorsResponse>
      unenroll: (params: { factorId: string }) => Promise<MFAUnenrollResponse>
      getAuthenticatorAssuranceLevel: () => Promise<{
        data: {
          currentLevel: 'aal1' | 'aal2' | null
          nextLevel: 'aal1' | 'aal2' | null
          currentAuthenticationMethods: Array<{
            method: 'password' | 'otp' | 'oauth' | 'totp'
            timestamp: number
          }>
        } | null
        error: AuthError | null
      }>
    }
  }
}
