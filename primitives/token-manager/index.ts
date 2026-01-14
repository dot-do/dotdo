/**
 * Token Manager
 *
 * Comprehensive token management for JWT, API keys, and token lifecycle.
 */

import type {
  TokenPayload,
  TokenConfig,
  TokenPair,
  APIKey,
  APIKeyOptions,
  APIKeyValidation,
  TokenValidation,
  RefreshConfig,
  RefreshTokenData,
  TokenRotationConfig,
  TokenStorage,
  Algorithm,
} from './types'

export * from './types'

/**
 * Parse duration string to milliseconds
 */
function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') return duration * 1000
  const match = duration.match(/^(\d+)(s|m|h|d|w|y)$/)
  if (!match) throw new Error(`Invalid duration: ${duration}`)
  const value = parseInt(match[1], 10)
  const unit = match[2]
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  }
  return value * multipliers[unit]
}

/**
 * Parse duration string to seconds
 */
function parseDurationSeconds(duration: string | number): number {
  if (typeof duration === 'number') return duration
  return Math.floor(parseDuration(duration) / 1000)
}

/**
 * Generate a random ID
 */
function generateId(length = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  const randomValues = new Uint8Array(length)
  crypto.getRandomValues(randomValues)
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length]
  }
  return result
}

/**
 * Base64URL encode
 */
function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Base64URL decode
 */
function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padding = (4 - (base64.length % 4)) % 4
  const padded = base64 + '='.repeat(padding)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * JWT Handler for creating and verifying JWTs
 */
export class JWTHandler {
  private config: TokenConfig

  constructor(config: TokenConfig) {
    this.config = config
  }

  /**
   * Sign a payload and create a JWT
   */
  async sign(payload: TokenPayload): Promise<string> {
    const algorithm = this.config.algorithm || 'HS256'
    const header = { alg: algorithm, typ: 'JWT' }

    const encodedHeader = base64UrlEncode(JSON.stringify(header))
    const encodedPayload = base64UrlEncode(JSON.stringify(payload))
    const signingInput = `${encodedHeader}.${encodedPayload}`

    const signature = await this.createSignature(signingInput, algorithm)
    return `${signingInput}.${signature}`
  }

  /**
   * Verify a JWT and return the payload
   */
  async verify(token: string): Promise<TokenValidation> {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) {
        return { valid: false, error: 'Token is malformed', errorCode: 'malformed' }
      }

      const [encodedHeader, encodedPayload, signature] = parts

      // Decode header and payload
      let header: { alg: string; typ: string }
      let payload: TokenPayload

      try {
        header = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedHeader)))
        payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)))
      } catch {
        return { valid: false, error: 'Token is malformed', errorCode: 'malformed' }
      }

      // Verify signature
      const signingInput = `${encodedHeader}.${encodedPayload}`
      const isValidSignature = await this.verifySignature(
        signingInput,
        signature,
        header.alg as Algorithm
      )

      if (!isValidSignature) {
        return { valid: false, error: 'Invalid signature', errorCode: 'invalid_signature' }
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000)
      if (payload.exp && payload.exp < now) {
        return { valid: false, error: 'Token has expired', errorCode: 'expired' }
      }

      return { valid: true, payload }
    } catch {
      return { valid: false, error: 'Token is malformed', errorCode: 'malformed' }
    }
  }

  private async createSignature(input: string, algorithm: Algorithm): Promise<string> {
    if (algorithm.startsWith('HS')) {
      return this.createHmacSignature(input, algorithm)
    } else if (algorithm.startsWith('RS')) {
      return this.createRsaSignature(input, algorithm)
    }
    throw new Error(`Unsupported algorithm: ${algorithm}`)
  }

  private async createHmacSignature(input: string, algorithm: Algorithm): Promise<string> {
    const hashAlgorithm = {
      HS256: 'SHA-256',
      HS384: 'SHA-384',
      HS512: 'SHA-512',
    }[algorithm]

    if (!this.config.secret) {
      throw new Error('Secret is required for HMAC algorithms')
    }

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.config.secret),
      { name: 'HMAC', hash: hashAlgorithm },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input))
    return base64UrlEncode(new Uint8Array(signature))
  }

  private async createRsaSignature(input: string, algorithm: Algorithm): Promise<string> {
    if (!this.config.privateKey) {
      throw new Error('Private key is required for RSA signing')
    }

    const hashAlgorithm = {
      RS256: 'SHA-256',
      RS384: 'SHA-384',
      RS512: 'SHA-512',
    }[algorithm]

    const key = await crypto.subtle.importKey(
      'pkcs8',
      this.pemToArrayBuffer(this.config.privateKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: hashAlgorithm },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(input)
    )
    return base64UrlEncode(new Uint8Array(signature))
  }

  private async verifySignature(
    input: string,
    signature: string,
    algorithm: Algorithm
  ): Promise<boolean> {
    if (algorithm.startsWith('HS')) {
      return this.verifyHmacSignature(input, signature, algorithm)
    } else if (algorithm.startsWith('RS')) {
      return this.verifyRsaSignature(input, signature, algorithm)
    }
    throw new Error(`Unsupported algorithm: ${algorithm}`)
  }

  private async verifyHmacSignature(
    input: string,
    signature: string,
    algorithm: Algorithm
  ): Promise<boolean> {
    try {
      const expectedSignature = await this.createHmacSignature(input, algorithm)
      return expectedSignature === signature
    } catch {
      return false
    }
  }

  private async verifyRsaSignature(
    input: string,
    signature: string,
    algorithm: Algorithm
  ): Promise<boolean> {
    if (!this.config.publicKey) {
      throw new Error('Public key is required for RSA verification')
    }

    const hashAlgorithm = {
      RS256: 'SHA-256',
      RS384: 'SHA-384',
      RS512: 'SHA-512',
    }[algorithm]

    try {
      const key = await crypto.subtle.importKey(
        'spki',
        this.pemToArrayBuffer(this.config.publicKey),
        { name: 'RSASSA-PKCS1-v1_5', hash: hashAlgorithm },
        false,
        ['verify']
      )

      const signatureBytes = base64UrlDecode(signature)
      // Create a new ArrayBuffer to avoid SharedArrayBuffer type issues
      const signatureBuffer = new ArrayBuffer(signatureBytes.length)
      new Uint8Array(signatureBuffer).set(signatureBytes)
      return await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        signatureBuffer,
        new TextEncoder().encode(input)
      )
    } catch {
      return false
    }
  }

  private pemToArrayBuffer(pem: string): ArrayBuffer {
    const lines = pem.split('\n')
    const base64 = lines
      .filter((line) => !line.startsWith('-----'))
      .join('')
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }
}

/**
 * Refresh Token Store for managing refresh tokens
 */
export class RefreshTokenStore {
  private tokens = new Map<string, RefreshTokenData>()
  private config: RefreshConfig

  constructor(config: RefreshConfig = {}) {
    this.config = {
      tokenLength: config.tokenLength ?? 64,
      expiresIn: config.expiresIn ?? '7d',
      reuseWindow: config.reuseWindow ?? 0,
      rotateOnUse: config.rotateOnUse ?? true,
    }
  }

  async store(
    token: string,
    userId: string,
    options: { family?: string; expiresAt?: number } = {}
  ): Promise<void> {
    const expiresIn = parseDuration(this.config.expiresIn!)
    this.tokens.set(token, {
      token,
      userId,
      createdAt: Date.now(),
      expiresAt: options.expiresAt ?? Date.now() + expiresIn,
      used: false,
      family: options.family ?? generateId(),
    })
  }

  async get(token: string): Promise<RefreshTokenData | null> {
    const data = this.tokens.get(token)
    if (!data) return null

    // Check if expired
    if (data.expiresAt < Date.now()) {
      this.tokens.delete(token)
      return null
    }

    return data
  }

  async markUsed(token: string, replacedBy?: string): Promise<void> {
    const data = this.tokens.get(token)
    if (data) {
      data.used = true
      data.usedAt = Date.now()
      if (replacedBy) data.replacedBy = replacedBy
    }
  }

  async revokeFamily(family: string): Promise<void> {
    for (const [token, data] of this.tokens) {
      if (data.family === family) {
        this.tokens.delete(token)
      }
    }
  }

  generateToken(): string {
    const bytes = new Uint8Array(this.config.tokenLength!)
    crypto.getRandomValues(bytes)
    return base64UrlEncode(bytes)
  }
}

/**
 * API Key Generator for creating secure API keys
 */
export class APIKeyGenerator {
  async generate(options: { prefix?: string; length?: number } = {}): Promise<string> {
    const prefix = options.prefix ?? ''
    const length = options.length ?? 32
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    return prefix + base64UrlEncode(bytes)
  }
}

/**
 * Token Revocation List for tracking revoked tokens
 */
export class TokenRevocationList {
  private revoked = new Map<string, number>()

  async add(jti: string, expiresAt: number): Promise<void> {
    this.revoked.set(jti, expiresAt)
  }

  async isRevoked(jti: string): Promise<boolean> {
    return this.revoked.has(jti)
  }

  async cleanup(): Promise<void> {
    const now = Date.now()
    for (const [jti, expiresAt] of this.revoked) {
      if (expiresAt < now) {
        this.revoked.delete(jti)
      }
    }
  }
}

/**
 * Claims Validator for validating custom claims
 */
export class ClaimsValidator {
  private requiredClaims: string[] = []
  private requiredValues: Map<string, unknown[]> = new Map()
  private customValidators: Map<string, (value: unknown) => boolean | Promise<boolean>> =
    new Map()

  require(claim: string): void {
    this.requiredClaims.push(claim)
  }

  requireValue(claim: string, values: unknown[]): void {
    this.requiredValues.set(claim, values)
  }

  custom(claim: string, validator: (value: unknown) => boolean | Promise<boolean>): void {
    this.customValidators.set(claim, validator)
  }

  async validate(claims: Record<string, unknown>): Promise<boolean> {
    // Check required claims
    for (const claim of this.requiredClaims) {
      if (!(claim in claims)) return false
    }

    // Check required values
    for (const [claim, values] of this.requiredValues) {
      if (!values.includes(claims[claim])) return false
    }

    // Check custom validators
    for (const [claim, validator] of this.customValidators) {
      const result = await validator(claims[claim])
      if (!result) return false
    }

    return true
  }
}

/**
 * Token Rotation for automatic token rotation
 */
export class TokenRotation {
  private tokenManager: TokenManager
  private config: TokenRotationConfig
  private rotatedTokens = new Map<string, { newToken: string; expiresAt: number }>()

  constructor(tokenManager: TokenManager, config: TokenRotationConfig) {
    this.tokenManager = tokenManager
    this.config = config
  }

  needsRotation(token: string): boolean {
    // Decode token to check issued time
    const parts = token.split('.')
    if (parts.length !== 3) return false

    try {
      const payload = JSON.parse(
        new TextDecoder().decode(base64UrlDecode(parts[1]))
      ) as TokenPayload
      const interval = parseDuration(this.config.interval)
      const issuedAt = payload.iat * 1000
      return Date.now() - issuedAt > interval
    } catch {
      return false
    }
  }

  async rotate(token: string): Promise<{ oldToken: string; newToken: string }> {
    // Verify old token
    const result = await this.tokenManager.verifyToken(token)
    if (!result.valid || !result.payload) {
      throw new Error('Cannot rotate invalid token')
    }

    // Create new token with same claims
    const { iat, exp, jti, ...rest } = result.payload
    const newToken = await this.tokenManager.createToken(rest)

    // Store rotation info for grace period
    const gracePeriod = this.config.gracePeriod
      ? parseDuration(this.config.gracePeriod)
      : 0
    this.rotatedTokens.set(token, {
      newToken,
      expiresAt: Date.now() + gracePeriod,
    })

    // Call onRotate callback if provided
    if (this.config.onRotate) {
      await this.config.onRotate(token, newToken)
    }

    return { oldToken: token, newToken }
  }

  async verifyWithGrace(token: string): Promise<TokenValidation> {
    // First check if it's a rotated token within grace period
    const rotation = this.rotatedTokens.get(token)
    if (rotation) {
      if (Date.now() < rotation.expiresAt) {
        return this.tokenManager.verifyToken(token)
      }
      // Grace period expired
      this.rotatedTokens.delete(token)
      return { valid: false, error: 'Token has been rotated and grace period expired' }
    }

    return this.tokenManager.verifyToken(token)
  }
}

/**
 * In-Memory Token Storage implementation
 */
export class InMemoryTokenStorage implements TokenStorage {
  private refreshTokens = new Map<string, RefreshTokenData>()
  private apiKeys = new Map<string, APIKey>()
  private apiKeysById = new Map<string, APIKey>()
  private revokedTokens = new Map<string, number>()

  async storeRefreshToken(data: RefreshTokenData): Promise<void> {
    this.refreshTokens.set(data.token, data)
  }

  async getRefreshToken(token: string): Promise<RefreshTokenData | null> {
    return this.refreshTokens.get(token) ?? null
  }

  async markRefreshTokenUsed(token: string, replacedBy?: string): Promise<void> {
    const data = this.refreshTokens.get(token)
    if (data) {
      data.used = true
      data.usedAt = Date.now()
      if (replacedBy) data.replacedBy = replacedBy
    }
  }

  async revokeTokenFamily(family: string): Promise<void> {
    for (const [token, data] of this.refreshTokens) {
      if (data.family === family) {
        this.refreshTokens.delete(token)
      }
    }
  }

  async isRevoked(tokenId: string): Promise<boolean> {
    return this.revokedTokens.has(tokenId)
  }

  async revokeToken(tokenId: string, expiresAt: number): Promise<void> {
    this.revokedTokens.set(tokenId, expiresAt)
  }

  async storeAPIKey(apiKey: APIKey): Promise<void> {
    this.apiKeys.set(apiKey.key, apiKey)
    this.apiKeysById.set(apiKey.id, apiKey)
  }

  async getAPIKey(key: string): Promise<APIKey | null> {
    return this.apiKeys.get(key) ?? null
  }

  async getAPIKeyById(id: string): Promise<APIKey | null> {
    return this.apiKeysById.get(id) ?? null
  }

  async revokeAPIKey(keyOrId: string): Promise<void> {
    const byKey = this.apiKeys.get(keyOrId)
    const byId = this.apiKeysById.get(keyOrId)
    const apiKey = byKey ?? byId
    if (apiKey) {
      this.apiKeys.delete(apiKey.key)
      this.apiKeysById.delete(apiKey.id)
    }
  }

  async updateAPIKeyLastUsed(key: string): Promise<void> {
    const apiKey = this.apiKeys.get(key)
    if (apiKey) {
      apiKey.lastUsedAt = Date.now()
    }
  }
}

/**
 * Token Manager configuration
 */
export interface TokenManagerConfig extends TokenConfig {
  refreshConfig?: RefreshConfig
  storage?: TokenStorage
}

/**
 * Main Token Manager class
 */
export class TokenManager {
  private config: TokenManagerConfig
  private jwtHandler: JWTHandler
  private refreshStore: RefreshTokenStore
  private apiKeyGenerator: APIKeyGenerator
  private revocationList: TokenRevocationList
  private storage: TokenStorage

  constructor(config: TokenManagerConfig) {
    this.config = {
      algorithm: 'HS256',
      expiresIn: '1h',
      ...config,
    }
    this.jwtHandler = new JWTHandler(this.config)
    this.refreshStore = new RefreshTokenStore(config.refreshConfig)
    this.apiKeyGenerator = new APIKeyGenerator()
    this.revocationList = new TokenRevocationList()
    this.storage = config.storage ?? new InMemoryTokenStorage()
  }

  /**
   * Create a JWT token
   */
  async createToken(
    payload: Omit<TokenPayload, 'iat' | 'exp'> & { claims?: Record<string, unknown> }
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    const expiresIn =
      typeof this.config.expiresIn === 'number'
        ? this.config.expiresIn
        : parseDurationSeconds(this.config.expiresIn!)

    const fullPayload: TokenPayload = {
      ...payload,
      iat: now,
      exp: now + expiresIn,
      jti: generateId(),
    }

    if (this.config.issuer) {
      fullPayload.iss = this.config.issuer
    }
    if (this.config.audience) {
      fullPayload.aud = this.config.audience
    }

    return this.jwtHandler.sign(fullPayload)
  }

  /**
   * Verify a JWT token
   */
  async verifyToken(token: string): Promise<TokenValidation> {
    const result = await this.jwtHandler.verify(token)

    if (!result.valid) return result

    // Check if token is revoked
    if (result.payload?.jti) {
      const isRevoked = await this.storage.isRevoked(result.payload.jti)
      if (isRevoked) {
        return { valid: false, error: 'Token has been revoked', errorCode: 'revoked' }
      }
    }

    return result
  }

  /**
   * Create a token pair (access + refresh tokens)
   */
  async createTokenPair(
    payload: Omit<TokenPayload, 'iat' | 'exp'>
  ): Promise<TokenPair> {
    const accessToken = await this.createToken(payload)
    const accessTokenPayload = await this.verifyToken(accessToken)

    const refreshConfig = this.config.refreshConfig ?? {}
    const refreshExpiresIn = parseDuration(refreshConfig.expiresIn ?? '7d')

    const refreshToken = this.refreshStore.generateToken()
    const family = generateId()

    await this.refreshStore.store(refreshToken, payload.sub, {
      family,
      expiresAt: Date.now() + refreshExpiresIn,
    })

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      accessTokenExpiresAt: accessTokenPayload.payload!.exp * 1000,
      refreshTokenExpiresAt: Date.now() + refreshExpiresIn,
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<TokenPair | null> {
    const tokenData = await this.refreshStore.get(refreshToken)
    if (!tokenData) return null

    // Check if token was already used (for rotation)
    if (tokenData.used) {
      // Possible token reuse attack - revoke entire family
      await this.refreshStore.revokeFamily(tokenData.family)
      return null
    }

    // Mark as used
    await this.refreshStore.markUsed(refreshToken)

    // Create new token pair
    return this.createTokenPair({ sub: tokenData.userId })
  }

  /**
   * Revoke a token
   */
  async revokeToken(token: string): Promise<void> {
    const result = await this.jwtHandler.verify(token)
    if (result.valid && result.payload?.jti) {
      await this.storage.revokeToken(result.payload.jti, result.payload.exp * 1000)
    }
  }

  /**
   * Revoke a token by its ID (jti)
   */
  async revokeTokenById(jti: string): Promise<void> {
    // Use a far future expiration since we don't know the actual expiration
    await this.storage.revokeToken(jti, Date.now() + 365 * 24 * 60 * 60 * 1000)
  }

  /**
   * Create an API key
   */
  async createAPIKey(options: APIKeyOptions): Promise<APIKey> {
    const key = await this.apiKeyGenerator.generate({
      prefix: options.prefix,
      length: options.length,
    })

    let expiresAt: number | null = null
    if (options.expiresIn !== null && options.expiresIn !== undefined) {
      expiresAt = Date.now() + parseDuration(options.expiresIn)
    }

    const apiKey: APIKey = {
      key,
      id: generateId(),
      name: options.name,
      permissions: options.permissions ?? [],
      createdAt: Date.now(),
      expiresAt,
      metadata: options.metadata,
    }

    await this.storage.storeAPIKey(apiKey)
    return apiKey
  }

  /**
   * Validate an API key
   */
  async validateAPIKey(key: string): Promise<APIKeyValidation> {
    const apiKey = await this.storage.getAPIKey(key)

    if (!apiKey) {
      return { valid: false, error: 'API key not found', errorCode: 'not_found' }
    }

    if (apiKey.expiresAt && apiKey.expiresAt < Date.now()) {
      return { valid: false, error: 'API key has expired', errorCode: 'expired' }
    }

    await this.storage.updateAPIKeyLastUsed(key)
    return { valid: true, apiKey }
  }

  /**
   * Check if an API key has a specific permission
   */
  async checkAPIKeyPermission(key: string, permission: string): Promise<boolean> {
    const result = await this.validateAPIKey(key)
    if (!result.valid || !result.apiKey) return false
    return result.apiKey.permissions.includes(permission)
  }
}
