/**
 * @dotdo/auth - Multi-Factor Authentication
 *
 * TOTP, SMS, and Email OTP support.
 *
 * @module
 */

import type { MFAFactor, TOTPEnrollment, MFAChallenge, AuthConfig, MFAConfig } from './types'
import { AuthError, AuthErrors } from './error'
import { IndexedStorage } from './storage'

// ============================================================================
// MFA MANAGER
// ============================================================================

export class MFAManager {
  private storage: IndexedStorage
  private totpIssuer: string
  private totpPeriod: number
  private totpDigits: number
  private totpWindow: number
  private challengeTTL: number
  private maxFactorsPerUser: number
  private otpLength: number
  private otpTTL: number

  constructor(storage: IndexedStorage, config: AuthConfig) {
    const mfaConfig = config.mfa ?? {}
    this.storage = storage
    this.totpIssuer = mfaConfig.totpIssuer ?? 'dotdo'
    this.totpPeriod = mfaConfig.totpPeriod ?? 30
    this.totpDigits = mfaConfig.totpDigits ?? 6
    this.totpWindow = 1
    this.challengeTTL = 300
    this.maxFactorsPerUser = 10
    this.otpLength = mfaConfig.otpLength ?? 6
    this.otpTTL = mfaConfig.otpTTL ?? 600
  }

  // ============================================================================
  // TOTP METHODS
  // ============================================================================

  /**
   * Enroll a new TOTP factor
   */
  async enrollTOTP(userId: string, friendlyName?: string, accountName?: string): Promise<TOTPEnrollment> {
    const userFactors = await this.listFactors(userId)
    if (userFactors.length >= this.maxFactorsPerUser) {
      throw new AuthError('max_factors_reached', 'Maximum number of MFA factors reached', 400)
    }

    const secret = this.generateTOTPSecret()
    const factorId = this.generateId('factor')
    const now = new Date().toISOString()

    const factor: MFAFactor = {
      id: factorId,
      user_id: userId,
      type: 'totp',
      status: 'unverified',
      friendly_name: friendlyName,
      created_at: now,
      updated_at: now,
    }

    await this.storage.put(`factor:${factorId}`, factor)
    await this.storage.put(`secret:${factorId}`, secret)
    await this.addUserFactor(userId, factorId)

    const uri = this.generateTOTPUri(secret, this.totpIssuer, accountName ?? userId, this.totpPeriod, this.totpDigits)
    const qrCode = this.generateQRCodePlaceholder(uri)

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
    const factor = await this.storage.get<MFAFactor>(`factor:${factorId}`)
    if (!factor) {
      throw AuthErrors.mfaFactorNotFound()
    }

    if (factor.status === 'verified') {
      throw AuthErrors.mfaAlreadyVerified()
    }

    const secret = await this.storage.get<string>(`secret:${factorId}`)
    if (!secret) {
      throw new AuthError('secret_not_found', 'Factor secret not found', 404)
    }

    const isValid = await this.verifyTOTPCode(code, secret)

    if (!isValid) {
      throw AuthErrors.mfaInvalidCode()
    }

    factor.status = 'verified'
    factor.updated_at = new Date().toISOString()
    await this.storage.put(`factor:${factorId}`, factor)

    return factor
  }

  /**
   * Verify a TOTP code
   */
  async verifyTOTP(factorId: string, code: string): Promise<boolean> {
    const factor = await this.storage.get<MFAFactor>(`factor:${factorId}`)
    if (!factor || factor.type !== 'totp' || factor.status !== 'verified') {
      return false
    }

    const secret = await this.storage.get<string>(`secret:${factorId}`)
    if (!secret) {
      return false
    }

    const isValid = await this.verifyTOTPCode(code, secret)

    if (isValid) {
      factor.last_used_at = new Date().toISOString()
      await this.storage.put(`factor:${factorId}`, factor)
    }

    return isValid
  }

  // ============================================================================
  // EMAIL/SMS OTP METHODS
  // ============================================================================

  /**
   * Enroll an email OTP factor
   */
  async enrollEmailOTP(userId: string, email: string, friendlyName?: string): Promise<MFAFactor> {
    const userFactors = await this.listFactors(userId)
    if (userFactors.length >= this.maxFactorsPerUser) {
      throw new AuthError('max_factors_reached', 'Maximum number of MFA factors reached', 400)
    }

    const factorId = this.generateId('factor')
    const now = new Date().toISOString()

    const factor: MFAFactor = {
      id: factorId,
      user_id: userId,
      type: 'email',
      status: 'verified',
      friendly_name: friendlyName ?? email,
      email,
      created_at: now,
      updated_at: now,
    }

    await this.storage.put(`factor:${factorId}`, factor)
    await this.addUserFactor(userId, factorId)

    return factor
  }

  /**
   * Enroll an SMS OTP factor
   */
  async enrollSMSOTP(userId: string, phoneNumber: string, friendlyName?: string): Promise<MFAFactor> {
    const userFactors = await this.listFactors(userId)
    if (userFactors.length >= this.maxFactorsPerUser) {
      throw new AuthError('max_factors_reached', 'Maximum number of MFA factors reached', 400)
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

    await this.storage.put(`factor:${factorId}`, factor)
    await this.addUserFactor(userId, factorId)

    return factor
  }

  /**
   * Generate an OTP code for email/SMS
   */
  async generateOTP(factorId: string): Promise<{ code: string; expiresAt: Date }> {
    const factor = await this.storage.get<MFAFactor>(`factor:${factorId}`)
    if (!factor || (factor.type !== 'email' && factor.type !== 'sms')) {
      throw new AuthError('invalid_factor', 'Invalid factor type for OTP', 400)
    }

    const code = this.generateNumericOTP(this.otpLength)
    const expiresAt = new Date(Date.now() + this.otpTTL * 1000)

    const hashedCode = await this.hashCode(code)
    await this.storage.put(`otp:${factorId}`, hashedCode, { ttl: this.otpTTL * 1000 })

    return { code, expiresAt }
  }

  /**
   * Verify an OTP code
   */
  async verifyOTP(factorId: string, code: string): Promise<boolean> {
    const storedHash = await this.storage.get<string>(`otp:${factorId}`)
    if (!storedHash) {
      return false
    }

    const inputHash = await this.hashCode(code)
    const isValid = this.constantTimeCompare(inputHash, storedHash)

    if (isValid) {
      await this.storage.delete(`otp:${factorId}`)

      const factor = await this.storage.get<MFAFactor>(`factor:${factorId}`)
      if (factor) {
        factor.last_used_at = new Date().toISOString()
        await this.storage.put(`factor:${factorId}`, factor)
      }
    }

    return isValid
  }

  // ============================================================================
  // FACTOR MANAGEMENT
  // ============================================================================

  /**
   * Get a factor by ID
   */
  async getFactor(factorId: string): Promise<MFAFactor | null> {
    return this.storage.get<MFAFactor>(`factor:${factorId}`)
  }

  /**
   * List all factors for a user
   */
  async listFactors(userId: string): Promise<MFAFactor[]> {
    const factorIds = await this.getUserFactorIds(userId)
    const factors: MFAFactor[] = []

    for (const factorId of factorIds) {
      const factor = await this.storage.get<MFAFactor>(`factor:${factorId}`)
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
  async unenroll(factorId: string): Promise<void> {
    const factor = await this.storage.get<MFAFactor>(`factor:${factorId}`)
    if (!factor) return

    await this.storage.delete(`factor:${factorId}`)
    await this.storage.delete(`secret:${factorId}`)
    await this.removeUserFactor(factor.user_id, factorId)
  }

  /**
   * Check if user has MFA enabled
   */
  async hasMFA(userId: string): Promise<boolean> {
    const factors = await this.listVerifiedFactors(userId)
    return factors.length > 0
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private generateId(prefix: string): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${prefix}_${hex}`
  }

  private generateTOTPSecret(length = 20): string {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    let result = ''
    for (const byte of bytes) {
      result += alphabet[byte % 32]
    }
    return result
  }

  private generateTOTPUri(secret: string, issuer: string, accountName: string, period: number, digits: number): string {
    const params = new URLSearchParams({
      secret,
      issuer,
      algorithm: 'SHA1',
      digits: digits.toString(),
      period: period.toString(),
    })

    return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?${params.toString()}`
  }

  private generateQRCodePlaceholder(data: string): string {
    return `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect fill="white" width="100" height="100"/>
        <text x="50" y="50" text-anchor="middle" fill="black" font-size="8">Scan with Auth App</text>
      </svg>`
    )}`
  }

  private base32Decode(input: string): Uint8Array {
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

  private async generateHOTP(secret: Uint8Array, counter: bigint, digits: number): Promise<string> {
    const counterBuffer = new ArrayBuffer(8)
    const counterView = new DataView(counterBuffer)
    counterView.setBigUint64(0, counter, false)

    const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])

    const signature = await crypto.subtle.sign('HMAC', key, counterBuffer)
    const hash = new Uint8Array(signature)

    const offset = hash[hash.length - 1] & 0x0f
    const binary =
      ((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff)

    const otp = binary % Math.pow(10, digits)
    return otp.toString().padStart(digits, '0')
  }

  private async verifyTOTPCode(code: string, secret: string, timestamp?: number): Promise<boolean> {
    const time = timestamp ?? Math.floor(Date.now() / 1000)
    const secretBytes = this.base32Decode(secret)

    for (let i = -this.totpWindow; i <= this.totpWindow; i++) {
      const checkTime = time + i * this.totpPeriod
      const counter = BigInt(Math.floor(checkTime / this.totpPeriod))
      const expectedCode = await this.generateHOTP(secretBytes, counter, this.totpDigits)
      if (this.constantTimeCompare(code, expectedCode)) {
        return true
      }
    }

    return false
  }

  private generateNumericOTP(length: number): string {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    let result = ''
    for (const byte of bytes) {
      result += (byte % 10).toString()
    }
    return result
  }

  private async hashCode(code: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(code)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }

  private async getUserFactorIds(userId: string): Promise<string[]> {
    const data = await this.storage.get<string[]>(`user_factors:${userId}`)
    return data ?? []
  }

  private async addUserFactor(userId: string, factorId: string): Promise<void> {
    const factors = await this.getUserFactorIds(userId)
    if (!factors.includes(factorId)) {
      factors.push(factorId)
      await this.storage.put(`user_factors:${userId}`, factors)
    }
  }

  private async removeUserFactor(userId: string, factorId: string): Promise<void> {
    const factors = await this.getUserFactorIds(userId)
    const index = factors.indexOf(factorId)
    if (index !== -1) {
      factors.splice(index, 1)
      await this.storage.put(`user_factors:${userId}`, factors)
    }
  }
}
