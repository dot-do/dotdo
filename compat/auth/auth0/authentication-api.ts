/**
 * @dotdo/auth0 - Authentication API
 *
 * Auth0 Authentication API compatible implementation.
 * Provides login, signup, token exchange, and passwordless flows.
 *
 * @module
 */

import { createTemporalStore, type TemporalStore } from '../../../db/primitives/temporal-store'
import { createUserManager, type UserManager } from '../shared/users'
import { createSessionManager, type SessionManager } from '../shared/sessions'
import { createMFAManager, type MFAManager } from '../shared/mfa'
import { createOAuthManager, type OAuthManager, generateCodeChallenge } from '../shared/oauth'
import { createJWT, verifyJWT } from '../shared/jwt'
import { AuthenticationError } from '../shared/types'
import type {
  TokenResponse,
  AuthorizationParams,
  TokenExchangeParams,
  SignupParams,
  ChangePasswordParams,
  PasswordlessStartParams,
  PasswordlessVerifyParams,
  Auth0User,
  Auth0MFAChallenge,
} from './types'
import { Auth0APIError } from './types'

// ============================================================================
// AUTHORIZATION CODE TYPES
// ============================================================================

/**
 * Authorization code stored data
 */
interface AuthorizationCodeData {
  code: string
  client_id: string
  user_id: string
  redirect_uri: string
  scope: string
  state?: string
  nonce?: string
  code_challenge?: string
  code_challenge_method?: 'plain' | 'S256'
  expires_at: string
}

// ============================================================================
// DEVICE CODE TYPES
// ============================================================================

/**
 * Device code response
 */
export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

/**
 * Device authorization stored data
 */
interface DeviceAuthorizationData {
  device_code: string
  user_code: string
  client_id: string
  scope: string
  expires_at: string
  interval: number
  status: 'pending' | 'authorized' | 'denied' | 'expired'
  user_id?: string
}

// ============================================================================
// AUTHENTICATION API OPTIONS
// ============================================================================

/**
 * Authentication API configuration
 */
export interface AuthenticationAPIOptions {
  /** Auth0 domain */
  domain: string
  /** Default client ID */
  clientId?: string
  /** Default client secret */
  clientSecret?: string
  /** JWT signing secret */
  jwtSecret: string
  /** JWT algorithm */
  jwtAlgorithm?: 'HS256' | 'RS256'
  /** Access token lifetime in seconds */
  accessTokenTTL?: number
  /** Refresh token lifetime in seconds */
  refreshTokenTTL?: number
  /** ID token lifetime in seconds */
  idTokenTTL?: number
}

// ============================================================================
// AUTHENTICATION API
// ============================================================================

/**
 * Auth0 Authentication API client
 */
export class AuthenticationClient {
  private options: Required<AuthenticationAPIOptions>
  private userManager: UserManager
  private sessionManager: SessionManager
  private mfaManager: MFAManager
  private oauthManager: OAuthManager
  private authCodeStore: TemporalStore<AuthorizationCodeData>
  private deviceCodeStore: TemporalStore<DeviceAuthorizationData>

  constructor(options: AuthenticationAPIOptions) {
    this.options = {
      domain: options.domain,
      clientId: options.clientId ?? '',
      clientSecret: options.clientSecret ?? '',
      jwtSecret: options.jwtSecret,
      jwtAlgorithm: options.jwtAlgorithm ?? 'HS256',
      accessTokenTTL: options.accessTokenTTL ?? 86400, // 24 hours
      refreshTokenTTL: options.refreshTokenTTL ?? 2592000, // 30 days
      idTokenTTL: options.idTokenTTL ?? 36000, // 10 hours
    }

    this.userManager = createUserManager()
    this.sessionManager = createSessionManager({
      jwtSecret: options.jwtSecret,
      jwtAlgorithm: options.jwtAlgorithm ?? 'HS256',
      accessTokenTTL: this.options.accessTokenTTL,
      refreshTokenTTL: this.options.refreshTokenTTL,
      issuer: `https://${options.domain}/`,
    })
    this.mfaManager = createMFAManager({ totpIssuer: options.domain })
    this.oauthManager = createOAuthManager({
      jwtSecret: options.jwtSecret,
      jwtAlgorithm: options.jwtAlgorithm ?? 'HS256',
      accessTokenTTL: this.options.accessTokenTTL,
      refreshTokenTTL: this.options.refreshTokenTTL,
      idTokenTTL: this.options.idTokenTTL,
      issuer: `https://${options.domain}/`,
    })
    this.authCodeStore = createTemporalStore<AuthorizationCodeData>({ enableTTL: true })
    this.deviceCodeStore = createTemporalStore<DeviceAuthorizationData>({ enableTTL: true })
  }

  // ============================================================================
  // DATABASE AUTHENTICATION
  // ============================================================================

  /**
   * database namespace for username/password authentication
   */
  database = {
    /**
     * Sign up a new user
     */
    signUp: async (data: SignupParams): Promise<Auth0User> => {
      const user = await this.userManager.createUser({
        email: data.email,
        password: data.password,
        username: data.username,
        first_name: data.given_name,
        last_name: data.family_name,
        name: data.name,
        picture: data.picture,
        metadata: data.user_metadata,
      })

      return {
        user_id: user.id,
        email: user.email,
        email_verified: user.email_verified,
        name: user.name,
        given_name: user.first_name,
        family_name: user.last_name,
        picture: user.picture,
        created_at: user.created_at,
        updated_at: user.updated_at,
        user_metadata: user.metadata,
        app_metadata: user.app_metadata,
      }
    },

    /**
     * Change password request (sends email)
     */
    changePassword: async (data: ChangePasswordParams): Promise<string> => {
      const token = await this.userManager.generatePasswordResetToken(data.email)

      if (!token) {
        // Don't reveal if user exists
        return 'If this email exists, a password reset link has been sent.'
      }

      // In production, send email here
      return 'We have sent you an email to reset your password.'
    },
  }

  // ============================================================================
  // PASSWORDLESS AUTHENTICATION
  // ============================================================================

  /**
   * passwordless namespace
   */
  passwordless = {
    /**
     * Start passwordless authentication
     */
    start: async (data: PasswordlessStartParams): Promise<{ _id: string; email?: string; phone_number?: string }> => {
      // Create or get user
      let user = data.email
        ? await this.userManager.getUserByEmail(data.email)
        : await this.userManager.getUserByPhone(data.phone_number!)

      if (!user) {
        user = await this.userManager.createUser({
          email: data.email,
          phone: data.phone_number,
        })
      }

      // For email/SMS OTP, we'd need an MFA factor
      // Create a temporary factor for this passwordless flow
      let factor
      if (data.connection === 'email' && data.email) {
        factor = await this.mfaManager.enrollEmailOTP(user.id, data.email, 'passwordless')
      } else if (data.connection === 'sms' && data.phone_number) {
        factor = await this.mfaManager.enrollSMSOTP(user.id, data.phone_number, 'passwordless')
      } else {
        throw new Auth0APIError(400, 'Bad Request', 'Invalid connection or missing email/phone')
      }

      // Generate and "send" OTP
      const { code } = await this.mfaManager.generateOTP(factor.id)

      // In production, send email/SMS here
      console.log(`[Passwordless] OTP for ${data.email ?? data.phone_number}: ${code}`)

      return {
        _id: factor.id,
        email: data.email,
        phone_number: data.phone_number,
      }
    },

    /**
     * Verify passwordless code
     */
    verify: async (data: PasswordlessVerifyParams): Promise<TokenResponse> => {
      // Find user
      const user = data.email
        ? await this.userManager.getUserByEmail(data.email)
        : await this.userManager.getUserByPhone(data.phone_number!)

      if (!user) {
        throw new Auth0APIError(401, 'Unauthorized', 'Invalid code')
      }

      // Find the passwordless factor
      const factors = await this.mfaManager.listFactors(user.id)
      const factor = factors.find(
        (f) =>
          (f.type === 'email' && f.email === data.email) ||
          (f.type === 'sms' && f.phone_number === data.phone_number)
      )

      if (!factor) {
        throw new Auth0APIError(401, 'Unauthorized', 'No passwordless factor found')
      }

      // Verify OTP
      const isValid = await this.mfaManager.verifyOTP(factor.id, data.verification_code)

      if (!isValid) {
        throw new Auth0APIError(401, 'Unauthorized', 'Invalid code')
      }

      // Create session and tokens
      const { tokens } = await this.sessionManager.createSession(
        {
          id: user.id,
          email: user.email,
          name: user.name,
          metadata: user.metadata,
          app_metadata: user.app_metadata,
          created_at: user.created_at,
          updated_at: user.updated_at,
        },
        {
          clientId: data.client_id,
          scope: data.scope,
        }
      )

      // Generate ID token
      const idToken = await this.generateIdToken(user, data.client_id, data.scope)

      return {
        access_token: tokens.access_token,
        token_type: 'Bearer',
        expires_in: tokens.expires_in,
        refresh_token: tokens.refresh_token,
        id_token: idToken,
        scope: data.scope,
      }
    },
  }

  // ============================================================================
  // OAUTH / TOKEN OPERATIONS
  // ============================================================================

  /**
   * oauth namespace
   */
  oauth = {
    /**
     * Build authorization URL
     */
    authorizationUrl: (params: AuthorizationParams): string => {
      const url = new URL(`https://${this.options.domain}/authorize`)

      url.searchParams.set('response_type', params.response_type)
      url.searchParams.set('client_id', params.client_id)
      url.searchParams.set('redirect_uri', params.redirect_uri)
      url.searchParams.set('scope', params.scope)

      if (params.state) url.searchParams.set('state', params.state)
      if (params.nonce) url.searchParams.set('nonce', params.nonce)
      if (params.audience) url.searchParams.set('audience', params.audience)
      if (params.connection) url.searchParams.set('connection', params.connection)
      if (params.prompt) url.searchParams.set('prompt', params.prompt)
      if (params.login_hint) url.searchParams.set('login_hint', params.login_hint)
      if (params.max_age !== undefined) url.searchParams.set('max_age', params.max_age.toString())
      if (params.code_challenge) url.searchParams.set('code_challenge', params.code_challenge)
      if (params.code_challenge_method) url.searchParams.set('code_challenge_method', params.code_challenge_method)

      return url.toString()
    },

    /**
     * Exchange tokens (authorization code, refresh token, etc.)
     */
    token: async (params: TokenExchangeParams): Promise<TokenResponse> => {
      switch (params.grant_type) {
        case 'authorization_code':
          return this.handleAuthorizationCodeGrant(params)

        case 'refresh_token':
          return this.handleRefreshTokenGrant(params)

        case 'client_credentials':
          return this.handleClientCredentialsGrant(params)

        case 'password':
          return this.handlePasswordGrant(params)

        case 'urn:ietf:params:oauth:grant-type:device_code':
          return this.handleDeviceCodeGrant(params)

        default:
          throw new Auth0APIError(400, 'unsupported_grant_type', `Grant type not supported: ${params.grant_type}`)
      }
    },

    /**
     * Revoke a token
     */
    revokeToken: async (params: { client_id: string; client_secret?: string; token: string }): Promise<void> => {
      await this.oauthManager.revokeToken(params.token, 'refresh_token')
    },

    /**
     * Revoke a token (alias for revokeToken)
     */
    revoke: async (params: { client_id: string; client_secret?: string; token: string }): Promise<void> => {
      // Revoke in both OAuthManager and SessionManager stores
      await this.oauthManager.revokeToken(params.token, 'refresh_token')

      // Also revoke in SessionManager's store (where tokens from password grant are stored)
      const tokenHash = await this.hashToken(params.token)
      const sessionManagerStore = (this.sessionManager as unknown as { refreshTokenStore: { put(key: string, value: unknown, timestamp: number): Promise<void> } }).refreshTokenStore
      await sessionManagerStore.put(`refresh:${tokenHash}`, null, Date.now())
    },

    /**
     * Get user info from access token
     */
    userInfo: async (accessToken: string): Promise<Auth0User & { sub: string }> => {
      const result = await this.sessionManager.validateAccessToken(accessToken)

      if (!result.valid || !result.session) {
        throw new Auth0APIError(401, 'Unauthorized', 'Invalid access token')
      }

      const user = await this.userManager.getUser(result.session.user_id)
      if (!user) {
        throw new Auth0APIError(401, 'Unauthorized', 'User not found')
      }

      return {
        sub: user.id, // OIDC standard
        user_id: user.id, // Auth0 specific
        email: user.email,
        email_verified: user.email_verified,
        name: user.name,
        nickname: user.username,
        given_name: user.first_name,
        family_name: user.last_name,
        picture: user.picture,
        created_at: user.created_at,
        updated_at: user.updated_at,
        user_metadata: user.metadata,
        app_metadata: user.app_metadata,
      }
    },
  }

  // ============================================================================
  // MFA
  // ============================================================================

  /**
   * mfa namespace
   */
  mfa = {
    /**
     * Challenge MFA
     */
    challenge: async (params: {
      client_id: string
      client_secret?: string
      mfa_token: string
      challenge_type: 'otp' | 'oob'
      authenticator_id?: string
    }): Promise<Auth0MFAChallenge> => {
      // Verify MFA token
      const result = await verifyJWT(params.mfa_token, {
        secret: this.options.jwtSecret,
        algorithms: [this.options.jwtAlgorithm],
      })

      if (!result.valid || !result.claims?.sub) {
        throw new Auth0APIError(401, 'Unauthorized', 'Invalid MFA token')
      }

      const userId = result.claims.sub

      // Get user's factors
      const factors = await this.mfaManager.listVerifiedFactors(userId)

      if (factors.length === 0) {
        throw new Auth0APIError(400, 'Bad Request', 'No MFA factors enrolled')
      }

      // Find the appropriate factor
      const factor = params.authenticator_id
        ? factors.find((f) => f.id === params.authenticator_id)
        : factors[0]

      if (!factor) {
        throw new Auth0APIError(400, 'Bad Request', 'Authenticator not found')
      }

      // Create challenge
      const challenge = await this.mfaManager.createChallenge(factor.id)

      // For email/SMS, generate and "send" OTP
      if (factor.type === 'email' || factor.type === 'sms') {
        const { code } = await this.mfaManager.generateOTP(factor.id)
        console.log(`[MFA] OTP for ${factor.email ?? factor.phone_number}: ${code}`)
      }

      return {
        challenge_type: factor.type === 'totp' ? 'otp' : 'oob',
        oob_code: challenge.id,
      }
    },

    /**
     * Verify MFA
     */
    verify: async (params: {
      client_id: string
      client_secret?: string
      mfa_token: string
      otp?: string
      oob_code?: string
      binding_code?: string
    }): Promise<TokenResponse> => {
      // Verify MFA token
      const result = await verifyJWT(params.mfa_token, {
        secret: this.options.jwtSecret,
        algorithms: [this.options.jwtAlgorithm],
      })

      if (!result.valid || !result.claims?.sub) {
        throw new Auth0APIError(401, 'Unauthorized', 'Invalid MFA token')
      }

      const userId = result.claims.sub
      const user = await this.userManager.getUser(userId)

      if (!user) {
        throw new Auth0APIError(401, 'Unauthorized', 'User not found')
      }

      let verified = false

      if (params.otp) {
        // TOTP verification
        const factors = await this.mfaManager.listVerifiedFactors(userId)
        const totpFactor = factors.find((f) => f.type === 'totp')

        if (totpFactor) {
          verified = await this.mfaManager.verifyTOTP(totpFactor.id, params.otp)
        }
      } else if (params.oob_code && params.binding_code) {
        // OOB (email/SMS) verification
        const verifyResult = await this.mfaManager.verifyChallenge(params.oob_code, params.binding_code)
        verified = verifyResult.valid
      }

      if (!verified) {
        throw new Auth0APIError(401, 'Unauthorized', 'Invalid MFA code')
      }

      // Create session and tokens
      const { tokens } = await this.sessionManager.createSession(
        {
          id: user.id,
          email: user.email,
          name: user.name,
          metadata: user.metadata,
          app_metadata: user.app_metadata,
          created_at: user.created_at,
          updated_at: user.updated_at,
        },
        { clientId: params.client_id }
      )

      const idToken = await this.generateIdToken(user, params.client_id)

      return {
        access_token: tokens.access_token,
        token_type: 'Bearer',
        expires_in: tokens.expires_in,
        refresh_token: tokens.refresh_token,
        id_token: idToken,
      }
    },

    /**
     * Associate a new authenticator
     */
    associate: async (params: {
      client_id: string
      client_secret?: string
      access_token: string
      authenticator_types: ('otp' | 'oob')[]
      oob_channels?: ('sms' | 'email')[]
      phone_number?: string
      email?: string
    }) => {
      // Validate access token
      const validation = await this.sessionManager.validateAccessToken(params.access_token)

      if (!validation.valid || !validation.session) {
        throw new Auth0APIError(401, 'Unauthorized', 'Invalid access token')
      }

      const userId = validation.session.user_id
      const user = await this.userManager.getUser(userId)

      if (!user) {
        throw new Auth0APIError(401, 'Unauthorized', 'User not found')
      }

      if (params.authenticator_types.includes('otp')) {
        // TOTP enrollment
        const enrollment = await this.mfaManager.enrollTOTP(userId, undefined, user.email)

        return {
          authenticator_type: 'otp',
          factor_id: enrollment.factor_id, // For confirmation step
          secret: enrollment.secret,
          barcode_uri: enrollment.uri,
          recovery_codes: [], // Would generate recovery codes in production
        }
      } else if (params.authenticator_types.includes('oob')) {
        // Email/SMS enrollment
        if (params.oob_channels?.includes('sms') && params.phone_number) {
          const factor = await this.mfaManager.enrollSMSOTP(userId, params.phone_number)
          return {
            authenticator_type: 'oob',
            oob_channel: 'sms',
            oob_code: factor.id,
          }
        } else if (params.oob_channels?.includes('email') && (params.email ?? user.email)) {
          const factor = await this.mfaManager.enrollEmailOTP(userId, params.email ?? user.email!)
          return {
            authenticator_type: 'oob',
            oob_channel: 'email',
            oob_code: factor.id,
          }
        }
      }

      throw new Auth0APIError(400, 'Bad Request', 'Invalid authenticator configuration')
    },

    /**
     * Confirm authenticator association with an OTP code
     * This verifies the TOTP enrollment and marks the factor as verified
     */
    confirmAssociation: async (params: {
      client_id: string
      access_token: string
      factor_id: string
      otp: string
    }): Promise<{ status: 'verified' }> => {
      // Validate access token
      const validation = await this.sessionManager.validateAccessToken(params.access_token)

      if (!validation.valid || !validation.session) {
        throw new Auth0APIError(401, 'Unauthorized', 'Invalid access token')
      }

      try {
        await this.mfaManager.verifyTOTPEnrollment(params.factor_id, params.otp)
        return { status: 'verified' }
      } catch (error) {
        if (error instanceof AuthenticationError) {
          throw new Auth0APIError(400, 'Bad Request', error.message)
        }
        throw new Auth0APIError(400, 'Bad Request', 'Invalid OTP code')
      }
    },
  }

  // ============================================================================
  // AUTHORIZATION CODE FLOW
  // ============================================================================

  /**
   * authorization namespace for Authorization Code and PKCE flows
   */
  authorization = {
    /**
     * Generate an authorization code for a user
     * This is typically called after user authentication on the authorize endpoint
     *
     * @param userId - The authenticated user's ID
     * @param params - Authorization parameters
     * @returns Authorization code and redirect URL
     */
    generateCode: async (
      userId: string,
      params: {
        client_id: string
        redirect_uri: string
        scope: string
        state?: string
        nonce?: string
        code_challenge?: string
        code_challenge_method?: 'plain' | 'S256'
      }
    ): Promise<{ code: string; redirect_url: string }> => {
      // Validate user exists
      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new Auth0APIError(400, 'invalid_request', 'User not found')
      }

      // Generate authorization code
      const code = this.generateSecureCode()
      const codeHash = await this.hashToken(code)
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

      const authCodeData: AuthorizationCodeData = {
        code: codeHash,
        client_id: params.client_id,
        user_id: userId,
        redirect_uri: params.redirect_uri,
        scope: params.scope,
        state: params.state,
        nonce: params.nonce,
        code_challenge: params.code_challenge,
        code_challenge_method: params.code_challenge_method,
        expires_at: expiresAt.toISOString(),
      }

      await this.authCodeStore.put(`authcode:${codeHash}`, authCodeData, Date.now(), {
        ttl: 10 * 60 * 1000, // 10 minutes
      })

      // Build redirect URL
      const redirectUrl = new URL(params.redirect_uri)
      redirectUrl.searchParams.set('code', code)
      if (params.state) {
        redirectUrl.searchParams.set('state', params.state)
      }

      return {
        code,
        redirect_url: redirectUrl.toString(),
      }
    },

    /**
     * Generate PKCE code verifier and challenge
     * Used by clients to initiate PKCE flow
     */
    generatePKCE: async (): Promise<{ code_verifier: string; code_challenge: string; code_challenge_method: 'S256' }> => {
      const codeVerifier = this.generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier, 'S256')

      return {
        code_verifier: codeVerifier,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }
    },

    /**
     * Build PKCE authorization URL
     * Convenience method that generates PKCE and returns the full authorization URL
     */
    buildPKCEAuthorizationUrl: async (params: {
      client_id: string
      redirect_uri: string
      scope: string
      state?: string
      audience?: string
      connection?: string
    }): Promise<{ url: string; code_verifier: string }> => {
      const pkce = await this.authorization.generatePKCE()

      const url = this.oauth.authorizationUrl({
        response_type: 'code',
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        scope: params.scope,
        state: params.state,
        audience: params.audience,
        connection: params.connection,
        code_challenge: pkce.code_challenge,
        code_challenge_method: pkce.code_challenge_method,
      })

      return {
        url,
        code_verifier: pkce.code_verifier,
      }
    },
  }

  // ============================================================================
  // DEVICE AUTHORIZATION FLOW
  // ============================================================================

  /**
   * device namespace for Device Authorization Grant (RFC 8628)
   */
  device = {
    /**
     * Start device authorization flow
     * Returns device_code and user_code for the device to poll and user to enter
     *
     * @example
     * ```typescript
     * const deviceAuth = await auth.device.authorize({
     *   client_id: 'my-client-id',
     *   scope: 'openid profile email',
     * })
     *
     * console.log(`Go to ${deviceAuth.verification_uri} and enter code: ${deviceAuth.user_code}`)
     * ```
     */
    authorize: async (params: {
      client_id: string
      scope?: string
      audience?: string
    }): Promise<DeviceCodeResponse> => {
      const deviceCode = this.generateSecureCode()
      const userCode = this.generateUserCode()
      const deviceCodeHash = await this.hashToken(deviceCode)
      const expiresIn = 1800 // 30 minutes
      const interval = 5 // 5 seconds polling interval
      const expiresAt = new Date(Date.now() + expiresIn * 1000)

      const deviceAuthData: DeviceAuthorizationData = {
        device_code: deviceCodeHash,
        user_code: userCode,
        client_id: params.client_id,
        scope: params.scope ?? 'openid',
        expires_at: expiresAt.toISOString(),
        interval,
        status: 'pending',
      }

      // Store by device_code hash and user_code for lookup
      await this.deviceCodeStore.put(`device:${deviceCodeHash}`, deviceAuthData, Date.now(), {
        ttl: expiresIn * 1000,
      })
      await this.deviceCodeStore.put(`usercode:${userCode}`, deviceAuthData, Date.now(), {
        ttl: expiresIn * 1000,
      })

      const verificationUri = `https://${this.options.domain}/activate`

      return {
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: verificationUri,
        verification_uri_complete: `${verificationUri}?user_code=${userCode}`,
        expires_in: expiresIn,
        interval,
      }
    },

    /**
     * Authorize a device using user_code
     * Called when user enters the user_code on the verification page
     *
     * @param userCode - The user code displayed to the user
     * @param userId - The authenticated user's ID
     */
    authorizeUserCode: async (userCode: string, userId: string): Promise<void> => {
      const deviceAuthData = await this.deviceCodeStore.get(`usercode:${userCode}`)

      if (!deviceAuthData) {
        throw new Auth0APIError(400, 'invalid_request', 'Invalid or expired user code')
      }

      if (deviceAuthData.status !== 'pending') {
        throw new Auth0APIError(400, 'invalid_request', 'User code already used or expired')
      }

      if (new Date(deviceAuthData.expires_at) < new Date()) {
        throw new Auth0APIError(400, 'expired_token', 'User code has expired')
      }

      // Update both stores with authorized status
      const updatedData: DeviceAuthorizationData = {
        ...deviceAuthData,
        status: 'authorized',
        user_id: userId,
      }

      const deviceCodeHash = deviceAuthData.device_code
      await this.deviceCodeStore.put(`device:${deviceCodeHash}`, updatedData, Date.now())
      await this.deviceCodeStore.put(`usercode:${userCode}`, updatedData, Date.now())
    },

    /**
     * Deny a device authorization
     * Called when user denies the device authorization request
     */
    denyUserCode: async (userCode: string): Promise<void> => {
      const deviceAuthData = await this.deviceCodeStore.get(`usercode:${userCode}`)

      if (!deviceAuthData) {
        throw new Auth0APIError(400, 'invalid_request', 'Invalid or expired user code')
      }

      const updatedData: DeviceAuthorizationData = {
        ...deviceAuthData,
        status: 'denied',
      }

      const deviceCodeHash = deviceAuthData.device_code
      await this.deviceCodeStore.put(`device:${deviceCodeHash}`, updatedData, Date.now())
      await this.deviceCodeStore.put(`usercode:${userCode}`, updatedData, Date.now())
    },

    /**
     * Get device authorization status by user code
     * Useful for displaying the current status in the UI
     */
    getStatus: async (userCode: string): Promise<{ status: 'pending' | 'authorized' | 'denied' | 'expired'; client_id: string; scope: string }> => {
      const deviceAuthData = await this.deviceCodeStore.get(`usercode:${userCode}`)

      if (!deviceAuthData) {
        throw new Auth0APIError(400, 'invalid_request', 'Invalid or expired user code')
      }

      let status = deviceAuthData.status
      if (new Date(deviceAuthData.expires_at) < new Date()) {
        status = 'expired'
      }

      return {
        status,
        client_id: deviceAuthData.client_id,
        scope: deviceAuthData.scope,
      }
    },
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Handle authorization code grant (with PKCE support)
   */
  private async handleAuthorizationCodeGrant(params: TokenExchangeParams): Promise<TokenResponse> {
    if (!params.code || !params.redirect_uri) {
      throw new Auth0APIError(400, 'invalid_request', 'Missing code or redirect_uri')
    }

    // Hash the code to look up the stored authorization data
    const codeHash = await this.hashToken(params.code)
    const authCodeData = await this.authCodeStore.get(`authcode:${codeHash}`)

    if (!authCodeData) {
      throw new Auth0APIError(401, 'invalid_grant', 'Invalid or expired authorization code')
    }

    // Validate client_id matches
    if (authCodeData.client_id !== params.client_id) {
      throw new Auth0APIError(401, 'invalid_grant', 'Client ID mismatch')
    }

    // Validate redirect_uri matches
    if (authCodeData.redirect_uri !== params.redirect_uri) {
      throw new Auth0APIError(401, 'invalid_grant', 'Redirect URI mismatch')
    }

    // Check expiration
    if (new Date(authCodeData.expires_at) < new Date()) {
      throw new Auth0APIError(401, 'invalid_grant', 'Authorization code expired')
    }

    // PKCE validation
    if (authCodeData.code_challenge) {
      if (!params.code_verifier) {
        throw new Auth0APIError(400, 'invalid_request', 'Code verifier required for PKCE flow')
      }

      // Verify the code_verifier against the stored code_challenge
      const computedChallenge = await generateCodeChallenge(
        params.code_verifier,
        authCodeData.code_challenge_method ?? 'S256'
      )

      if (computedChallenge !== authCodeData.code_challenge) {
        throw new Auth0APIError(401, 'invalid_grant', 'Invalid code verifier')
      }
    }

    // Get user
    const user = await this.userManager.getUser(authCodeData.user_id)
    if (!user) {
      throw new Auth0APIError(401, 'invalid_grant', 'User not found')
    }

    // Delete the authorization code (single-use)
    await this.authCodeStore.put(`authcode:${codeHash}`, null as unknown as AuthorizationCodeData, Date.now())

    // Create session and tokens
    const { tokens } = await this.sessionManager.createSession(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        metadata: user.metadata,
        app_metadata: user.app_metadata,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      {
        clientId: params.client_id,
        scope: authCodeData.scope,
      }
    )

    // Generate ID token with nonce if provided
    const idToken = await this.generateIdToken(user, params.client_id, authCodeData.scope, authCodeData.nonce)

    return {
      access_token: tokens.access_token,
      token_type: 'Bearer',
      expires_in: tokens.expires_in,
      refresh_token: tokens.refresh_token,
      id_token: idToken,
      scope: authCodeData.scope,
    }
  }

  /**
   * Handle device code grant (RFC 8628)
   */
  private async handleDeviceCodeGrant(params: TokenExchangeParams): Promise<TokenResponse> {
    if (!params.device_code) {
      throw new Auth0APIError(400, 'invalid_request', 'Missing device_code')
    }

    // Hash the device code to look up the stored authorization data
    const deviceCodeHash = await this.hashToken(params.device_code)
    const deviceAuthData = await this.deviceCodeStore.get(`device:${deviceCodeHash}`)

    if (!deviceAuthData) {
      throw new Auth0APIError(401, 'invalid_grant', 'Invalid or expired device code')
    }

    // Validate client_id matches
    if (deviceAuthData.client_id !== params.client_id) {
      throw new Auth0APIError(401, 'invalid_grant', 'Client ID mismatch')
    }

    // Check expiration
    if (new Date(deviceAuthData.expires_at) < new Date()) {
      throw new Auth0APIError(401, 'expired_token', 'Device code has expired')
    }

    // Check status
    switch (deviceAuthData.status) {
      case 'pending':
        // User hasn't authorized yet - tell client to slow down/keep polling
        throw new Auth0APIError(400, 'authorization_pending', 'Authorization pending')

      case 'denied':
        // User denied the authorization
        throw new Auth0APIError(401, 'access_denied', 'The user denied the authorization request')

      case 'expired':
        throw new Auth0APIError(401, 'expired_token', 'Device code has expired')

      case 'authorized':
        // Proceed with token generation
        break
    }

    // Get user
    if (!deviceAuthData.user_id) {
      throw new Auth0APIError(500, 'server_error', 'User ID not found in device authorization')
    }

    const user = await this.userManager.getUser(deviceAuthData.user_id)
    if (!user) {
      throw new Auth0APIError(401, 'invalid_grant', 'User not found')
    }

    // Delete the device code (single-use)
    await this.deviceCodeStore.put(`device:${deviceCodeHash}`, null as unknown as DeviceAuthorizationData, Date.now())
    await this.deviceCodeStore.put(`usercode:${deviceAuthData.user_code}`, null as unknown as DeviceAuthorizationData, Date.now())

    // Create session and tokens
    const { tokens } = await this.sessionManager.createSession(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        metadata: user.metadata,
        app_metadata: user.app_metadata,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      {
        clientId: params.client_id,
        scope: deviceAuthData.scope,
      }
    )

    // Generate ID token
    const idToken = await this.generateIdToken(user, params.client_id, deviceAuthData.scope)

    return {
      access_token: tokens.access_token,
      token_type: 'Bearer',
      expires_in: tokens.expires_in,
      refresh_token: tokens.refresh_token,
      id_token: idToken,
      scope: deviceAuthData.scope,
    }
  }

  /**
   * Handle refresh token grant
   */
  private async handleRefreshTokenGrant(params: TokenExchangeParams): Promise<TokenResponse> {
    if (!params.refresh_token) {
      throw new Auth0APIError(400, 'invalid_request', 'Missing refresh_token')
    }

    try {
      // Use the session manager to look up and validate the refresh token
      // The session manager stores user_id with refresh tokens
      const refreshTokenHash = await this.hashToken(params.refresh_token)
      const tokenData = await (this.sessionManager as unknown as { refreshTokenStore: { get(key: string): Promise<{ session_id: string; user_id: string; expires_at: string } | null> } }).refreshTokenStore.get(`refresh:${refreshTokenHash}`)

      if (!tokenData) {
        throw new Auth0APIError(401, 'invalid_grant', 'Invalid refresh token')
      }

      // Check expiration
      if (new Date(tokenData.expires_at) < new Date()) {
        throw new Auth0APIError(401, 'invalid_grant', 'Refresh token expired')
      }

      // Get user
      const user = await this.userManager.getUser(tokenData.user_id)
      if (!user) {
        throw new Auth0APIError(401, 'invalid_grant', 'User not found')
      }

      // Refresh tokens
      const { tokens } = await this.sessionManager.refreshTokens(params.refresh_token, user, {
        clientId: params.client_id,
        scope: params.scope,
      })

      // Generate ID token if scopes include openid
      const scopes = params.scope?.split(' ') ?? []
      let idToken: string | undefined
      if (scopes.includes('openid')) {
        idToken = await this.generateIdToken(user, params.client_id, params.scope)
      }

      return {
        access_token: tokens.access_token,
        token_type: 'Bearer',
        expires_in: tokens.expires_in,
        refresh_token: tokens.refresh_token,
        id_token: idToken,
        scope: params.scope,
      }
    } catch (error) {
      if (error instanceof Auth0APIError) throw error
      throw new Auth0APIError(401, 'invalid_grant', 'Invalid refresh token')
    }
  }

  /**
   * Hash a token for storage lookup
   */
  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Handle client credentials grant
   */
  private async handleClientCredentialsGrant(params: TokenExchangeParams): Promise<TokenResponse> {
    if (!params.client_secret) {
      throw new Auth0APIError(401, 'invalid_client', 'Client authentication required')
    }

    // In production, validate client credentials
    const accessToken = await createJWT(
      {
        scope: params.scope,
        gty: 'client-credentials',
      },
      {
        secret: this.options.jwtSecret,
        algorithm: this.options.jwtAlgorithm,
        issuer: `https://${this.options.domain}/`,
        audience: params.audience,
        subject: params.client_id,
        expiresIn: this.options.accessTokenTTL,
      }
    )

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.options.accessTokenTTL,
      scope: params.scope,
    }
  }

  /**
   * Handle password grant (Resource Owner Password)
   */
  private async handlePasswordGrant(params: TokenExchangeParams): Promise<TokenResponse> {
    if (!params.username || !params.password) {
      throw new Auth0APIError(400, 'invalid_request', 'Missing username or password')
    }

    // Verify credentials
    const result = await this.userManager.verifyPassword(params.username, params.password)

    if (!result.valid || !result.user) {
      if (result.locked) {
        throw new Auth0APIError(401, 'too_many_attempts', 'Account is locked')
      }
      throw new Auth0APIError(401, 'invalid_grant', 'Wrong email or password')
    }

    // Check if MFA is required
    const hasMFA = await this.mfaManager.hasMFAEnabled(result.user.id)

    if (hasMFA) {
      // Return MFA token instead of access token
      const mfaToken = await createJWT(
        {
          scope: params.scope,
        },
        {
          secret: this.options.jwtSecret,
          algorithm: this.options.jwtAlgorithm,
          issuer: `https://${this.options.domain}/`,
          audience: params.audience ?? params.client_id,
          subject: result.user.id,
          expiresIn: 300, // 5 minutes for MFA
        }
      )

      throw new Auth0APIError(403, 'mfa_required', 'MFA required', 'mfa_required')
    }

    // Create session
    const { tokens } = await this.sessionManager.createSession(result.user, {
      clientId: params.client_id,
      scope: params.scope,
    })

    // Generate ID token
    const idToken = await this.generateIdToken(result.user, params.client_id, params.scope)

    return {
      access_token: tokens.access_token,
      token_type: 'Bearer',
      expires_in: tokens.expires_in,
      refresh_token: tokens.refresh_token,
      id_token: idToken,
      scope: params.scope,
    }
  }

  /**
   * Generate ID token
   */
  private async generateIdToken(
    user: { id: string; email?: string; name?: string; first_name?: string; last_name?: string; picture?: string; email_verified?: boolean },
    clientId: string,
    scope?: string
  ): Promise<string> {
    const claims: Record<string, unknown> = {
      auth_time: Math.floor(Date.now() / 1000),
    }

    // Add claims based on scope
    const scopes = scope?.split(' ') ?? []

    if (scopes.includes('email') || scopes.includes('openid')) {
      claims.email = user.email
      claims.email_verified = user.email_verified
    }

    if (scopes.includes('profile') || scopes.includes('openid')) {
      claims.name = user.name
      claims.given_name = user.first_name
      claims.family_name = user.last_name
      claims.picture = user.picture
    }

    return createJWT(claims, {
      secret: this.options.jwtSecret,
      algorithm: this.options.jwtAlgorithm,
      issuer: `https://${this.options.domain}/`,
      audience: clientId,
      subject: user.id,
      expiresIn: this.options.idTokenTTL,
    })
  }
}

/**
 * Create an Authentication API client
 */
export function createAuthenticationClient(options: AuthenticationAPIOptions): AuthenticationClient {
  return new AuthenticationClient(options)
}
