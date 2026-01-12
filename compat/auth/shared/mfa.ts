/**
 * @dotdo/auth - Multi-Factor Authentication
 *
 * MFA support including TOTP, SMS, Email OTP, and WebAuthn.
 * Edge-compatible implementation using Web Crypto API.
 *
 * @module
 */

import { createTemporalStore, type TemporalStore } from '../../../db/primitives/temporal-store'
import type { MFAFactor, TOTPEnrollment, MFAChallenge, WebAuthnCredential } from './types'
import { AuthenticationError } from './types'

// ============================================================================
// MFA MANAGER OPTIONS
// ============================================================================

/**
 * MFA manager configuration
 */
export interface MFAManagerOptions {
  /** TOTP issuer name (shown in authenticator apps) */
  totpIssuer?: string
  /** TOTP period in seconds (default: 30) */
  totpPeriod?: number
  /** TOTP digits (default: 6) */
  totpDigits?: number
  /** TOTP window for time drift (default: 1) */
  totpWindow?: number
  /** Challenge expiration in seconds (default: 300 = 5 minutes) */
  challengeTTL?: number
  /** Maximum enrolled factors per user (default: 10) */
  maxFactorsPerUser?: number
  /** OTP length for email/SMS (default: 6) */
  otpLength?: number
  /** OTP expiration in seconds (default: 600 = 10 minutes) */
  otpTTL?: number
}

// ============================================================================
// TOTP UTILITIES
// ============================================================================

/**
 * Generate a random base32 secret
 */
function generateTOTPSecret(length = 20): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let result = ''
  for (const byte of bytes) {
    result += alphabet[byte % 32]
  }
  return result
}

/**
 * Decode base32 string to Uint8Array
 */
function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const cleanInput = input.toUpperCase().replace(/=+$/, '')

  let bits = 0
  let value = 0
  const output: number[] = []

  for (const char of cleanInput) {
    const index = alphabet.indexOf(char)
    if (index === -1) continue

    value = (value << 5) | index
    bits += 5

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return new Uint8Array(output)
}

/**
 * Generate HMAC-based OTP
 */
async function generateHOTP(secret: Uint8Array, counter: bigint, digits: number): Promise<string> {
  const counterBuffer = new ArrayBuffer(8)
  const counterView = new DataView(counterBuffer)
  counterView.setBigUint64(0, counter, false) // Big-endian

  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])

  const signature = await crypto.subtle.sign('HMAC', key, counterBuffer)
  const hash = new Uint8Array(signature)

  // Dynamic truncation
  const offset = hash[hash.length - 1] & 0x0f
  const binary =
    ((hash[offset] & 0x7f) << 24) | ((hash[offset + 1] & 0xff) << 16) | ((hash[offset + 2] & 0xff) << 8) | (hash[offset + 3] & 0xff)

  const otp = binary % Math.pow(10, digits)
  return otp.toString().padStart(digits, '0')
}

/**
 * Generate time-based OTP
 */
async function generateTOTP(secret: string, period: number, digits: number, timestamp?: number): Promise<string> {
  const time = timestamp ?? Math.floor(Date.now() / 1000)
  const counter = BigInt(Math.floor(time / period))
  const secretBytes = base32Decode(secret)
  return generateHOTP(secretBytes, counter, digits)
}

/**
 * Verify TOTP with time window
 */
async function verifyTOTP(
  code: string,
  secret: string,
  period: number,
  digits: number,
  window: number,
  timestamp?: number
): Promise<boolean> {
  const time = timestamp ?? Math.floor(Date.now() / 1000)

  // Check codes within the window
  for (let i = -window; i <= window; i++) {
    const checkTime = time + i * period
    const expectedCode = await generateTOTP(secret, period, digits, checkTime)
    if (constantTimeCompare(code, expectedCode)) {
      return true
    }
  }

  return false
}

/**
 * Generate TOTP URI for QR code
 */
function generateTOTPUri(secret: string, issuer: string, accountName: string, period: number, digits: number): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: digits.toString(),
    period: period.toString(),
  })

  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?${params.toString()}`
}

/**
 * Constant-time string comparison
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

/**
 * Generate a simple QR code SVG (for TOTP enrollment)
 * This is a basic implementation - in production you'd use a proper QR library
 */
function generateQRCodeSVG(data: string): string {
  // This is a placeholder - real implementation would use a QR code library
  // For edge deployment, you might want to generate QR codes client-side
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect fill="white" width="100" height="100"/>
      <text x="50" y="50" text-anchor="middle" fill="black" font-size="8">Scan with Auth App</text>
      <text x="50" y="60" text-anchor="middle" fill="gray" font-size="6">Use URI: ${data.slice(0, 30)}...</text>
    </svg>`
  )}`
}

// ============================================================================
// MFA MANAGER
// ============================================================================

/**
 * MFA manager with TemporalStore backend
 */
export class MFAManager {
  private options: Required<MFAManagerOptions>
  private factorStore: TemporalStore<MFAFactor>
  private secretStore: TemporalStore<string> // Stores TOTP secrets separately
  private challengeStore: TemporalStore<MFAChallenge>
  private webAuthnStore: TemporalStore<WebAuthnCredential>

  constructor(options: MFAManagerOptions = {}) {
    this.options = {
      totpIssuer: options.totpIssuer ?? 'dotdo',
      totpPeriod: options.totpPeriod ?? 30,
      totpDigits: options.totpDigits ?? 6,
      totpWindow: options.totpWindow ?? 1,
      challengeTTL: options.challengeTTL ?? 300,
      maxFactorsPerUser: options.maxFactorsPerUser ?? 10,
      otpLength: options.otpLength ?? 6,
      otpTTL: options.otpTTL ?? 600,
    }

    this.factorStore = createTemporalStore<MFAFactor>()
    this.secretStore = createTemporalStore<string>()
    this.challengeStore = createTemporalStore<MFAChallenge>({ enableTTL: true })
    this.webAuthnStore = createTemporalStore<WebAuthnCredential>()
  }

  // ============================================================================
  // TOTP METHODS
  // ============================================================================

  /**
   * Enroll a new TOTP factor
   */
  async enrollTOTP(userId: string, friendlyName?: string, accountName?: string): Promise<TOTPEnrollment> {
    // Check max factors
    const userFactors = await this.listFactors(userId)
    if (userFactors.length >= this.options.maxFactorsPerUser) {
      throw new AuthenticationError('max_factors_reached', 'Maximum number of MFA factors reached')
    }

    // Generate secret
    const secret = generateTOTPSecret()
    const factorId = this.generateId('factor')
    const now = new Date().toISOString()

    // Create factor (unverified until user confirms)
    const factor: MFAFactor = {
      id: factorId,
      user_id: userId,
      type: 'totp',
      status: 'unverified',
      friendly_name: friendlyName,
      created_at: now,
      updated_at: now,
    }

    // Store factor and secret
    await this.factorStore.put(`factor:${factorId}`, factor, Date.now())
    await this.secretStore.put(`secret:${factorId}`, secret, Date.now())
    await this.addUserFactor(userId, factorId)

    // Generate URI and QR code
    const uri = generateTOTPUri(secret, this.options.totpIssuer, accountName ?? userId, this.options.totpPeriod, this.options.totpDigits)
    const qrCode = generateQRCodeSVG(uri)

    return {
      factor_id: factorId,
      secret,
      uri,
      qr_code: qrCode,
    }
  }

  /**
   * Verify TOTP enrollment (first-time verification)
   */
  async verifyTOTPEnrollment(factorId: string, code: string): Promise<MFAFactor> {
    const factor = await this.factorStore.get(`factor:${factorId}`)
    if (!factor) {
      throw new AuthenticationError('factor_not_found', 'MFA factor not found')
    }

    if (factor.status === 'verified') {
      throw new AuthenticationError('already_verified', 'Factor is already verified')
    }

    const secret = await this.secretStore.get(`secret:${factorId}`)
    if (!secret) {
      throw new AuthenticationError('secret_not_found', 'Factor secret not found')
    }

    const isValid = await verifyTOTP(code, secret, this.options.totpPeriod, this.options.totpDigits, this.options.totpWindow)

    if (!isValid) {
      throw new AuthenticationError('invalid_code', 'Invalid verification code')
    }

    // Mark as verified
    factor.status = 'verified'
    factor.updated_at = new Date().toISOString()
    await this.factorStore.put(`factor:${factorId}`, factor, Date.now())

    return factor
  }

  /**
   * Verify a TOTP code
   */
  async verifyTOTP(factorId: string, code: string): Promise<boolean> {
    const factor = await this.factorStore.get(`factor:${factorId}`)
    if (!factor || factor.type !== 'totp' || factor.status !== 'verified') {
      return false
    }

    const secret = await this.secretStore.get(`secret:${factorId}`)
    if (!secret) {
      return false
    }

    const isValid = await verifyTOTP(code, secret, this.options.totpPeriod, this.options.totpDigits, this.options.totpWindow)

    if (isValid) {
      // Update last used
      factor.last_used_at = new Date().toISOString()
      await this.factorStore.put(`factor:${factorId}`, factor, Date.now())
    }

    return isValid
  }

  // ============================================================================
  // OTP METHODS (EMAIL/SMS)
  // ============================================================================

  /**
   * Enroll an email OTP factor
   */
  async enrollEmailOTP(userId: string, email: string, friendlyName?: string): Promise<MFAFactor> {
    const userFactors = await this.listFactors(userId)
    if (userFactors.length >= this.options.maxFactorsPerUser) {
      throw new AuthenticationError('max_factors_reached', 'Maximum number of MFA factors reached')
    }

    const factorId = this.generateId('factor')
    const now = new Date().toISOString()

    const factor: MFAFactor = {
      id: factorId,
      user_id: userId,
      type: 'email',
      status: 'verified', // Email/SMS factors are verified by sending OTP
      friendly_name: friendlyName ?? email,
      email,
      created_at: now,
      updated_at: now,
    }

    await this.factorStore.put(`factor:${factorId}`, factor, Date.now())
    await this.addUserFactor(userId, factorId)

    return factor
  }

  /**
   * Enroll an SMS OTP factor
   */
  async enrollSMSOTP(userId: string, phoneNumber: string, friendlyName?: string): Promise<MFAFactor> {
    const userFactors = await this.listFactors(userId)
    if (userFactors.length >= this.options.maxFactorsPerUser) {
      throw new AuthenticationError('max_factors_reached', 'Maximum number of MFA factors reached')
    }

    const factorId = this.generateId('factor')
    const now = new Date().toISOString()

    const factor: MFAFactor = {
      id: factorId,
      user_id: userId,
      type: 'sms',
      status: 'verified',
      friendly_name: friendlyName ?? phoneNumber,
      phone_number: phoneNumber,
      created_at: now,
      updated_at: now,
    }

    await this.factorStore.put(`factor:${factorId}`, factor, Date.now())
    await this.addUserFactor(userId, factorId)

    return factor
  }

  /**
   * Generate an OTP code for email/SMS
   */
  async generateOTP(factorId: string): Promise<{ code: string; expiresAt: Date }> {
    const factor = await this.factorStore.get(`factor:${factorId}`)
    if (!factor || (factor.type !== 'email' && factor.type !== 'sms')) {
      throw new AuthenticationError('invalid_factor', 'Invalid factor type for OTP')
    }

    // Generate random OTP
    const code = this.generateNumericOTP(this.options.otpLength)
    const expiresAt = new Date(Date.now() + this.options.otpTTL * 1000)

    // Store OTP (hashed)
    const hashedCode = await this.hashCode(code)
    await this.secretStore.put(`otp:${factorId}`, hashedCode, Date.now(), { ttl: this.options.otpTTL * 1000 })

    return { code, expiresAt }
  }

  /**
   * Verify an OTP code
   */
  async verifyOTP(factorId: string, code: string): Promise<boolean> {
    const storedHash = await this.secretStore.get(`otp:${factorId}`)
    if (!storedHash) {
      return false
    }

    const inputHash = await this.hashCode(code)
    const isValid = constantTimeCompare(inputHash, storedHash)

    if (isValid) {
      // Invalidate OTP after use
      await this.secretStore.put(`otp:${factorId}`, null as unknown as string, Date.now())

      // Update last used
      const factor = await this.factorStore.get(`factor:${factorId}`)
      if (factor) {
        factor.last_used_at = new Date().toISOString()
        await this.factorStore.put(`factor:${factorId}`, factor, Date.now())
      }
    }

    return isValid
  }

  // ============================================================================
  // CHALLENGE METHODS
  // ============================================================================

  /**
   * Create an MFA challenge
   */
  async createChallenge(factorId: string): Promise<MFAChallenge> {
    const factor = await this.factorStore.get(`factor:${factorId}`)
    if (!factor || factor.status !== 'verified') {
      throw new AuthenticationError('invalid_factor', 'Factor not found or not verified')
    }

    const challengeId = this.generateId('chal')
    const expiresAt = new Date(Date.now() + this.options.challengeTTL * 1000)

    const challenge: MFAChallenge = {
      id: challengeId,
      factor_id: factorId,
      type: factor.type,
      expires_at: expiresAt.toISOString(),
    }

    await this.challengeStore.put(`challenge:${challengeId}`, challenge, Date.now(), {
      ttl: this.options.challengeTTL * 1000,
    })

    return challenge
  }

  /**
   * Verify an MFA challenge
   */
  async verifyChallenge(challengeId: string, code: string): Promise<{ valid: boolean; factor?: MFAFactor }> {
    const challenge = await this.challengeStore.get(`challenge:${challengeId}`)
    if (!challenge) {
      return { valid: false }
    }

    // Check expiration
    if (new Date(challenge.expires_at) < new Date()) {
      return { valid: false }
    }

    // Verify based on factor type
    let isValid = false
    if (challenge.type === 'totp') {
      isValid = await this.verifyTOTP(challenge.factor_id, code)
    } else if (challenge.type === 'email' || challenge.type === 'sms') {
      isValid = await this.verifyOTP(challenge.factor_id, code)
    }

    if (isValid) {
      // Invalidate challenge
      await this.challengeStore.put(`challenge:${challengeId}`, null as unknown as MFAChallenge, Date.now())

      const factor = await this.factorStore.get(`factor:${challenge.factor_id}`)
      return { valid: true, factor: factor ?? undefined }
    }

    return { valid: false }
  }

  // ============================================================================
  // FACTOR MANAGEMENT
  // ============================================================================

  /**
   * Get a factor by ID
   */
  async getFactor(factorId: string): Promise<MFAFactor | null> {
    return this.factorStore.get(`factor:${factorId}`)
  }

  /**
   * List all factors for a user
   */
  async listFactors(userId: string): Promise<MFAFactor[]> {
    const factorIds = await this.getUserFactorIds(userId)
    const factors: MFAFactor[] = []

    for (const factorId of factorIds) {
      const factor = await this.factorStore.get(`factor:${factorId}`)
      if (factor) {
        factors.push(factor)
      }
    }

    return factors
  }

  /**
   * List verified factors for a user
   */
  async listVerifiedFactors(userId: string): Promise<MFAFactor[]> {
    const factors = await this.listFactors(userId)
    return factors.filter((f) => f.status === 'verified')
  }

  /**
   * Unenroll a factor
   */
  async unenrollFactor(factorId: string): Promise<void> {
    const factor = await this.factorStore.get(`factor:${factorId}`)
    if (!factor) return

    // Delete factor and associated data
    await this.factorStore.put(`factor:${factorId}`, null as unknown as MFAFactor, Date.now())
    await this.secretStore.put(`secret:${factorId}`, null as unknown as string, Date.now())
    await this.removeUserFactor(factor.user_id, factorId)
  }

  /**
   * Update factor friendly name
   */
  async updateFactorName(factorId: string, friendlyName: string): Promise<MFAFactor> {
    const factor = await this.factorStore.get(`factor:${factorId}`)
    if (!factor) {
      throw new AuthenticationError('factor_not_found', 'MFA factor not found')
    }

    factor.friendly_name = friendlyName
    factor.updated_at = new Date().toISOString()
    await this.factorStore.put(`factor:${factorId}`, factor, Date.now())

    return factor
  }

  /**
   * Check if user has MFA enabled
   */
  async hasMFAEnabled(userId: string): Promise<boolean> {
    const factors = await this.listVerifiedFactors(userId)
    return factors.length > 0
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Generate a unique ID
   */
  private generateId(prefix: string): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${prefix}_${hex}`
  }

  /**
   * Generate numeric OTP
   */
  private generateNumericOTP(length: number): string {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    let result = ''
    for (const byte of bytes) {
      result += (byte % 10).toString()
    }
    return result
  }

  /**
   * Hash a code
   */
  private async hashCode(code: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(code)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Get user's factor IDs
   */
  private async getUserFactorIds(userId: string): Promise<string[]> {
    const data = await this.factorStore.get(`user_factors:${userId}`)
    return (data as unknown as string[] | null) ?? []
  }

  /**
   * Add factor to user's list
   */
  private async addUserFactor(userId: string, factorId: string): Promise<void> {
    const factors = await this.getUserFactorIds(userId)
    if (!factors.includes(factorId)) {
      factors.push(factorId)
      await this.factorStore.put(`user_factors:${userId}`, factors as unknown as MFAFactor, Date.now())
    }
  }

  /**
   * Remove factor from user's list
   */
  private async removeUserFactor(userId: string, factorId: string): Promise<void> {
    const factors = await this.getUserFactorIds(userId)
    const index = factors.indexOf(factorId)
    if (index !== -1) {
      factors.splice(index, 1)
      await this.factorStore.put(`user_factors:${userId}`, factors as unknown as MFAFactor, Date.now())
    }
  }
}

/**
 * Create an MFA manager instance
 */
export function createMFAManager(options?: MFAManagerOptions): MFAManager {
  return new MFAManager(options)
}
