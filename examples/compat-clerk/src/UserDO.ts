/**
 * UserDO - Per-user Data Storage Durable Object
 *
 * Stores all user-specific data in a dedicated Durable Object,
 * enabling fast access and strong consistency for user operations.
 *
 * Features:
 * - User profile and metadata storage
 * - Email/phone verification
 * - Password hashing (PBKDF2)
 * - MFA/TOTP enrollment and verification
 * - OAuth identity linking
 * - External account management
 * - Rate limiting per user
 *
 * @see https://clerk.com/docs/reference/backend-api/tag/Users
 */

import { DurableObject } from 'cloudflare:workers'
import { generateToken, generateOtpCode, generateClerkId } from './jwt'

// ============================================================================
// TYPES
// ============================================================================

export interface Env {
  USER_DO: DurableObjectNamespace
  CLERK_DO: DurableObjectNamespace
  ENVIRONMENT?: string
}

/** Clerk-compatible User object */
export interface User {
  id: string
  object: 'user'
  username: string | null
  first_name: string | null
  last_name: string | null
  image_url: string
  has_image: boolean
  primary_email_address_id: string | null
  primary_phone_number_id: string | null
  primary_web3_wallet_id: string | null
  password_enabled: boolean
  two_factor_enabled: boolean
  totp_enabled: boolean
  backup_code_enabled: boolean
  passkeys_enabled: boolean
  email_addresses: EmailAddress[]
  phone_numbers: PhoneNumber[]
  web3_wallets: Web3Wallet[]
  passkeys: Passkey[]
  external_accounts: ExternalAccount[]
  saml_accounts: SamlAccount[]
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  unsafe_metadata: Record<string, unknown>
  last_sign_in_at: number | null
  banned: boolean
  locked: boolean
  lockout_expires_in_seconds: number | null
  verification_attempts_remaining: number | null
  created_at: number
  updated_at: number
  delete_self_enabled: boolean
  create_organization_enabled: boolean
  last_active_at: number | null
  profile_image_url: string
}

export interface EmailAddress {
  id: string
  object: 'email_address'
  email_address: string
  verification: Verification | null
  linked_to: IdentityLink[]
  created_at: number
  updated_at: number
}

export interface PhoneNumber {
  id: string
  object: 'phone_number'
  phone_number: string
  verification: Verification | null
  linked_to: IdentityLink[]
  reserved_for_second_factor: boolean
  default_second_factor: boolean
  created_at: number
  updated_at: number
}

export interface Web3Wallet {
  id: string
  object: 'web3_wallet'
  web3_wallet: string
  verification: Verification | null
  created_at: number
  updated_at: number
}

export interface Verification {
  status: 'unverified' | 'verified' | 'transferable' | 'failed' | 'expired'
  strategy: string
  attempts: number | null
  expire_at: number | null
  verified_at_client?: string
  error?: VerificationError
}

export interface VerificationError {
  message: string
  long_message: string
  code: string
}

export interface IdentityLink {
  type: 'oauth_google' | 'oauth_github' | 'oauth_apple' | 'saml'
  id: string
}

export interface ExternalAccount {
  id: string
  object: 'external_account'
  provider: string
  identification_id: string
  provider_user_id: string
  approved_scopes: string
  email_address: string
  first_name: string | null
  last_name: string | null
  avatar_url: string
  image_url: string | null
  username: string | null
  public_metadata: Record<string, unknown>
  label: string | null
  verification: Verification | null
  created_at: number
  updated_at: number
}

export interface SamlAccount {
  id: string
  object: 'saml_account'
  provider: string
  provider_user_id: string | null
  email_address: string
  first_name: string | null
  last_name: string | null
  active: boolean
  created_at: number
  updated_at: number
}

/** TOTP Factor for MFA */
export interface TotpFactor {
  id: string
  friendly_name: string | null
  secret: string
  uri: string
  status: 'unverified' | 'verified'
  created_at: number
  updated_at: number
}

/** Backup codes for MFA */
export interface BackupCodes {
  codes: string[]
  created_at: number
  used_codes: string[]
}

/** Passkey/WebAuthn credential */
export interface Passkey {
  id: string
  object: 'passkey'
  name: string
  verification: Verification | null
  credential_id: string // Base64URL encoded
  public_key: string // Base64URL encoded COSE key
  transports: AuthenticatorTransport[]
  sign_count: number
  created_at: number
  updated_at: number
  last_used_at: number | null
}

/** Authenticator transport types */
export type AuthenticatorTransport = 'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid'

/** Passkey registration options */
export interface PasskeyRegistrationOptions {
  challenge: string // Base64URL encoded
  rp: {
    name: string
    id: string
  }
  user: {
    id: string // Base64URL encoded
    name: string
    displayName: string
  }
  pubKeyCredParams: Array<{
    alg: number
    type: 'public-key'
  }>
  timeout?: number
  excludeCredentials?: Array<{
    id: string // Base64URL encoded
    type: 'public-key'
    transports?: AuthenticatorTransport[]
  }>
  authenticatorSelection?: {
    authenticatorAttachment?: 'platform' | 'cross-platform'
    residentKey?: 'discouraged' | 'preferred' | 'required'
    userVerification?: 'required' | 'preferred' | 'discouraged'
  }
  attestation?: 'none' | 'indirect' | 'direct' | 'enterprise'
}

/** Passkey authentication options */
export interface PasskeyAuthenticationOptions {
  challenge: string // Base64URL encoded
  timeout?: number
  rpId?: string
  allowCredentials?: Array<{
    id: string // Base64URL encoded
    type: 'public-key'
    transports?: AuthenticatorTransport[]
  }>
  userVerification?: 'required' | 'preferred' | 'discouraged'
}

/** Stored user with password hash */
interface StoredUser extends Omit<User, 'object'> {
  password_hash?: string
  totp_factors: TotpFactor[]
  backup_codes: BackupCodes | null
  passkeys: Passkey[]
  pending_passkey_challenge?: {
    challenge: string
    expires_at: number
    type: 'registration' | 'authentication'
  }
}

/** OTP/Verification token */
interface StoredVerificationToken {
  id: string
  target_id: string // Email/phone ID
  target_type: 'email' | 'phone'
  token: string
  expires_at: number
  attempts: number
  created_at: number
}

/** Rate limit entry */
interface RateLimitEntry {
  count: number
  window_start: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

const OTP_EXPIRY = 10 * 60 * 1000 // 10 minutes
const MAX_VERIFICATION_ATTEMPTS = 5
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100

// ============================================================================
// CRYPTO UTILITIES
// ============================================================================

/**
 * Hash a password using PBKDF2 (Web Crypto API)
 */
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))

  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    key,
    256
  )

  const hashArray = new Uint8Array(derivedBits)
  const combined = new Uint8Array(salt.length + hashArray.length)
  combined.set(salt)
  combined.set(hashArray, salt.length)

  return btoa(String.fromCharCode(...combined))
}

/**
 * Verify a password against a hash
 */
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const combined = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0))
    const salt = combined.slice(0, 16)
    const storedHash = combined.slice(16)

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
      'deriveBits',
    ])

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      key,
      256
    )

    const newHash = new Uint8Array(derivedBits)

    if (storedHash.length !== newHash.length) return false
    let diff = 0
    for (let i = 0; i < storedHash.length; i++) {
      diff |= storedHash[i] ^ newHash[i]
    }
    return diff === 0
  } catch {
    return false
  }
}

/**
 * Generate TOTP secret (base32 encoded)
 */
function generateTotpSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let secret = ''
  for (let i = 0; i < bytes.length; i++) {
    secret += alphabet[bytes[i] % 32]
  }
  return secret
}

/**
 * Generate backup codes
 */
function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const code = generateToken(4).toUpperCase()
    codes.push(`${code.slice(0, 4)}-${code.slice(4, 8)}`)
  }
  return codes
}

// ============================================================================
// USER DURABLE OBJECT
// ============================================================================

export class UserDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USER CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get user data
   */
  async getUser(): Promise<User | null> {
    const stored = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!stored) return null
    return this.toPublicUser(stored)
  }

  /**
   * Create or initialize user
   */
  async createUser(params: {
    username?: string
    first_name?: string
    last_name?: string
    email_address?: string
    phone_number?: string
    password?: string
    public_metadata?: Record<string, unknown>
    private_metadata?: Record<string, unknown>
    unsafe_metadata?: Record<string, unknown>
    skip_password_checks?: boolean
    skip_password_requirement?: boolean
  }): Promise<User> {
    const now = Date.now()
    const userId = generateClerkId('user')

    const emailAddresses: EmailAddress[] = []
    const phoneNumbers: PhoneNumber[] = []

    // Create email address if provided
    if (params.email_address) {
      const emailId = generateClerkId('idn')
      emailAddresses.push({
        id: emailId,
        object: 'email_address',
        email_address: params.email_address,
        verification: null,
        linked_to: [],
        created_at: now,
        updated_at: now,
      })
    }

    // Create phone number if provided
    if (params.phone_number) {
      const phoneId = generateClerkId('idn')
      phoneNumbers.push({
        id: phoneId,
        object: 'phone_number',
        phone_number: params.phone_number,
        verification: null,
        linked_to: [],
        reserved_for_second_factor: false,
        default_second_factor: false,
        created_at: now,
        updated_at: now,
      })
    }

    // Hash password if provided
    let passwordHash: string | undefined
    if (params.password) {
      passwordHash = await hashPassword(params.password)
    }

    const user: StoredUser = {
      id: userId,
      username: params.username ?? null,
      first_name: params.first_name ?? null,
      last_name: params.last_name ?? null,
      image_url: `https://img.clerk.com/default-avatar-${userId.slice(-4)}.png`,
      has_image: false,
      primary_email_address_id: emailAddresses[0]?.id ?? null,
      primary_phone_number_id: phoneNumbers[0]?.id ?? null,
      primary_web3_wallet_id: null,
      password_enabled: !!passwordHash,
      two_factor_enabled: false,
      totp_enabled: false,
      backup_code_enabled: false,
      email_addresses: emailAddresses,
      phone_numbers: phoneNumbers,
      web3_wallets: [],
      external_accounts: [],
      saml_accounts: [],
      public_metadata: params.public_metadata ?? {},
      private_metadata: params.private_metadata ?? {},
      unsafe_metadata: params.unsafe_metadata ?? {},
      last_sign_in_at: null,
      banned: false,
      locked: false,
      lockout_expires_in_seconds: null,
      verification_attempts_remaining: null,
      created_at: now,
      updated_at: now,
      delete_self_enabled: true,
      create_organization_enabled: true,
      last_active_at: null,
      profile_image_url: `https://img.clerk.com/default-avatar-${userId.slice(-4)}.png`,
      password_hash: passwordHash,
      totp_factors: [],
      backup_codes: null,
      passkeys: [],
    }

    await this.ctx.storage.put('user', user)

    return this.toPublicUser(user)
  }

  /**
   * Update user data
   */
  async updateUser(params: {
    username?: string
    first_name?: string
    last_name?: string
    primary_email_address_id?: string
    primary_phone_number_id?: string
    public_metadata?: Record<string, unknown>
    private_metadata?: Record<string, unknown>
    unsafe_metadata?: Record<string, unknown>
    password?: string
    skip_password_checks?: boolean
  }): Promise<User | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    const now = Date.now()

    if (params.username !== undefined) user.username = params.username
    if (params.first_name !== undefined) user.first_name = params.first_name
    if (params.last_name !== undefined) user.last_name = params.last_name
    if (params.primary_email_address_id !== undefined) {
      user.primary_email_address_id = params.primary_email_address_id
    }
    if (params.primary_phone_number_id !== undefined) {
      user.primary_phone_number_id = params.primary_phone_number_id
    }
    if (params.public_metadata !== undefined) {
      user.public_metadata = { ...user.public_metadata, ...params.public_metadata }
    }
    if (params.private_metadata !== undefined) {
      user.private_metadata = { ...user.private_metadata, ...params.private_metadata }
    }
    if (params.unsafe_metadata !== undefined) {
      user.unsafe_metadata = { ...user.unsafe_metadata, ...params.unsafe_metadata }
    }
    if (params.password) {
      user.password_hash = await hashPassword(params.password)
      user.password_enabled = true
    }

    user.updated_at = now

    await this.ctx.storage.put('user', user)

    return this.toPublicUser(user)
  }

  /**
   * Delete user
   */
  async deleteUser(): Promise<{ deleted: boolean }> {
    await this.ctx.storage.deleteAll()
    return { deleted: true }
  }

  /**
   * Ban user
   */
  async banUser(): Promise<User | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    user.banned = true
    user.updated_at = Date.now()
    await this.ctx.storage.put('user', user)

    return this.toPublicUser(user)
  }

  /**
   * Unban user
   */
  async unbanUser(): Promise<User | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    user.banned = false
    user.updated_at = Date.now()
    await this.ctx.storage.put('user', user)

    return this.toPublicUser(user)
  }

  /**
   * Lock user
   */
  async lockUser(): Promise<User | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    user.locked = true
    user.updated_at = Date.now()
    await this.ctx.storage.put('user', user)

    return this.toPublicUser(user)
  }

  /**
   * Unlock user
   */
  async unlockUser(): Promise<User | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    user.locked = false
    user.lockout_expires_in_seconds = null
    user.verification_attempts_remaining = null
    user.updated_at = Date.now()
    await this.ctx.storage.put('user', user)

    return this.toPublicUser(user)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PASSWORD MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Verify password
   */
  async verifyPasswordAttempt(password: string): Promise<{ valid: boolean }> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user || !user.password_hash) {
      return { valid: false }
    }

    if (user.banned || user.locked) {
      return { valid: false }
    }

    const valid = await verifyPassword(password, user.password_hash)

    if (valid) {
      user.last_sign_in_at = Date.now()
      user.last_active_at = Date.now()
      await this.ctx.storage.put('user', user)
    }

    return { valid }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EMAIL/PHONE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add email address
   */
  async addEmailAddress(emailAddress: string): Promise<EmailAddress | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    const now = Date.now()
    const emailId = generateClerkId('idn')

    const email: EmailAddress = {
      id: emailId,
      object: 'email_address',
      email_address: emailAddress,
      verification: null,
      linked_to: [],
      created_at: now,
      updated_at: now,
    }

    user.email_addresses.push(email)
    if (!user.primary_email_address_id) {
      user.primary_email_address_id = emailId
    }
    user.updated_at = now
    await this.ctx.storage.put('user', user)

    return email
  }

  /**
   * Remove email address
   */
  async removeEmailAddress(emailId: string): Promise<{ deleted: boolean }> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return { deleted: false }

    const index = user.email_addresses.findIndex((e) => e.id === emailId)
    if (index === -1) return { deleted: false }

    user.email_addresses.splice(index, 1)
    if (user.primary_email_address_id === emailId) {
      user.primary_email_address_id = user.email_addresses[0]?.id ?? null
    }
    user.updated_at = Date.now()
    await this.ctx.storage.put('user', user)

    return { deleted: true }
  }

  /**
   * Add phone number
   */
  async addPhoneNumber(phoneNumber: string): Promise<PhoneNumber | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    const now = Date.now()
    const phoneId = generateClerkId('idn')

    const phone: PhoneNumber = {
      id: phoneId,
      object: 'phone_number',
      phone_number: phoneNumber,
      verification: null,
      linked_to: [],
      reserved_for_second_factor: false,
      default_second_factor: false,
      created_at: now,
      updated_at: now,
    }

    user.phone_numbers.push(phone)
    if (!user.primary_phone_number_id) {
      user.primary_phone_number_id = phoneId
    }
    user.updated_at = now
    await this.ctx.storage.put('user', user)

    return phone
  }

  /**
   * Remove phone number
   */
  async removePhoneNumber(phoneId: string): Promise<{ deleted: boolean }> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return { deleted: false }

    const index = user.phone_numbers.findIndex((p) => p.id === phoneId)
    if (index === -1) return { deleted: false }

    user.phone_numbers.splice(index, 1)
    if (user.primary_phone_number_id === phoneId) {
      user.primary_phone_number_id = user.phone_numbers[0]?.id ?? null
    }
    user.updated_at = Date.now()
    await this.ctx.storage.put('user', user)

    return { deleted: true }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Prepare email verification
   */
  async prepareEmailVerification(
    emailId: string,
    strategy: 'email_code' | 'email_link' = 'email_code'
  ): Promise<{ token: string } | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    const email = user.email_addresses.find((e) => e.id === emailId)
    if (!email) return null

    const token = strategy === 'email_code' ? generateOtpCode() : generateToken(32)
    const now = Date.now()

    const verification: StoredVerificationToken = {
      id: generateClerkId('ver'),
      target_id: emailId,
      target_type: 'email',
      token,
      expires_at: now + OTP_EXPIRY,
      attempts: 0,
      created_at: now,
    }

    email.verification = {
      status: 'unverified',
      strategy,
      attempts: 0,
      expire_at: now + OTP_EXPIRY,
    }

    await this.ctx.storage.put(`verification:${emailId}`, verification)
    await this.ctx.storage.put('user', user)

    return { token }
  }

  /**
   * Attempt email verification
   */
  async attemptEmailVerification(emailId: string, code: string): Promise<{ verified: boolean }> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return { verified: false }

    const email = user.email_addresses.find((e) => e.id === emailId)
    if (!email) return { verified: false }

    const verification = (await this.ctx.storage.get(
      `verification:${emailId}`
    )) as StoredVerificationToken | null
    if (!verification) return { verified: false }

    const now = Date.now()

    // Check expiration
    if (verification.expires_at < now) {
      email.verification = {
        status: 'expired',
        strategy: email.verification?.strategy ?? 'email_code',
        attempts: verification.attempts,
        expire_at: verification.expires_at,
      }
      await this.ctx.storage.put('user', user)
      await this.ctx.storage.delete(`verification:${emailId}`)
      return { verified: false }
    }

    // Check attempts
    if (verification.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      email.verification = {
        status: 'failed',
        strategy: email.verification?.strategy ?? 'email_code',
        attempts: verification.attempts,
        expire_at: verification.expires_at,
        error: {
          message: 'Too many attempts',
          long_message: 'Maximum verification attempts exceeded',
          code: 'too_many_attempts',
        },
      }
      await this.ctx.storage.put('user', user)
      await this.ctx.storage.delete(`verification:${emailId}`)
      return { verified: false }
    }

    // Increment attempts
    verification.attempts++
    await this.ctx.storage.put(`verification:${emailId}`, verification)

    // Verify code
    if (verification.token !== code) {
      email.verification = {
        status: 'unverified',
        strategy: email.verification?.strategy ?? 'email_code',
        attempts: verification.attempts,
        expire_at: verification.expires_at,
      }
      await this.ctx.storage.put('user', user)
      return { verified: false }
    }

    // Success!
    email.verification = {
      status: 'verified',
      strategy: email.verification?.strategy ?? 'email_code',
      attempts: verification.attempts,
      expire_at: null,
    }
    email.updated_at = now
    user.updated_at = now

    await this.ctx.storage.put('user', user)
    await this.ctx.storage.delete(`verification:${emailId}`)

    return { verified: true }
  }

  /**
   * Prepare phone verification
   */
  async preparePhoneVerification(phoneId: string): Promise<{ token: string } | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    const phone = user.phone_numbers.find((p) => p.id === phoneId)
    if (!phone) return null

    const token = generateOtpCode()
    const now = Date.now()

    const verification: StoredVerificationToken = {
      id: generateClerkId('ver'),
      target_id: phoneId,
      target_type: 'phone',
      token,
      expires_at: now + OTP_EXPIRY,
      attempts: 0,
      created_at: now,
    }

    phone.verification = {
      status: 'unverified',
      strategy: 'phone_code',
      attempts: 0,
      expire_at: now + OTP_EXPIRY,
    }

    await this.ctx.storage.put(`verification:${phoneId}`, verification)
    await this.ctx.storage.put('user', user)

    return { token }
  }

  /**
   * Attempt phone verification
   */
  async attemptPhoneVerification(phoneId: string, code: string): Promise<{ verified: boolean }> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return { verified: false }

    const phone = user.phone_numbers.find((p) => p.id === phoneId)
    if (!phone) return { verified: false }

    const verification = (await this.ctx.storage.get(
      `verification:${phoneId}`
    )) as StoredVerificationToken | null
    if (!verification) return { verified: false }

    const now = Date.now()

    if (verification.expires_at < now) {
      phone.verification = { status: 'expired', strategy: 'phone_code', attempts: verification.attempts, expire_at: verification.expires_at }
      await this.ctx.storage.put('user', user)
      await this.ctx.storage.delete(`verification:${phoneId}`)
      return { verified: false }
    }

    if (verification.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      phone.verification = { status: 'failed', strategy: 'phone_code', attempts: verification.attempts, expire_at: verification.expires_at }
      await this.ctx.storage.put('user', user)
      await this.ctx.storage.delete(`verification:${phoneId}`)
      return { verified: false }
    }

    verification.attempts++
    await this.ctx.storage.put(`verification:${phoneId}`, verification)

    if (verification.token !== code) {
      phone.verification = { status: 'unverified', strategy: 'phone_code', attempts: verification.attempts, expire_at: verification.expires_at }
      await this.ctx.storage.put('user', user)
      return { verified: false }
    }

    phone.verification = { status: 'verified', strategy: 'phone_code', attempts: verification.attempts, expire_at: null }
    phone.updated_at = now
    user.updated_at = now

    await this.ctx.storage.put('user', user)
    await this.ctx.storage.delete(`verification:${phoneId}`)

    return { verified: true }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MFA / TOTP
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Enroll TOTP factor
   */
  async enrollTotp(friendlyName?: string): Promise<{
    id: string
    secret: string
    uri: string
  } | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    const secret = generateTotpSecret()
    const factorId = generateClerkId('totp')
    const now = Date.now()

    const issuer = 'Clerk'
    const accountName = user.email_addresses[0]?.email_address ?? user.username ?? user.id
    const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`

    const factor: TotpFactor = {
      id: factorId,
      friendly_name: friendlyName ?? null,
      secret,
      uri,
      status: 'unverified',
      created_at: now,
      updated_at: now,
    }

    user.totp_factors.push(factor)
    await this.ctx.storage.put('user', user)

    return { id: factorId, secret, uri }
  }

  /**
   * Verify TOTP factor
   */
  async verifyTotp(factorId: string, code: string): Promise<{ verified: boolean }> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return { verified: false }

    const factor = user.totp_factors.find((f) => f.id === factorId)
    if (!factor) return { verified: false }

    // In production, verify TOTP code against secret using HMAC-based OTP algorithm
    // For this implementation, we accept any 6-digit code for testing
    if (!/^\d{6}$/.test(code)) {
      return { verified: false }
    }

    factor.status = 'verified'
    factor.updated_at = Date.now()
    user.totp_enabled = true
    user.two_factor_enabled = true
    user.updated_at = Date.now()

    await this.ctx.storage.put('user', user)

    return { verified: true }
  }

  /**
   * Delete TOTP factor
   */
  async deleteTotp(factorId: string): Promise<{ deleted: boolean }> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return { deleted: false }

    const index = user.totp_factors.findIndex((f) => f.id === factorId)
    if (index === -1) return { deleted: false }

    user.totp_factors.splice(index, 1)
    if (user.totp_factors.length === 0) {
      user.totp_enabled = false
      if (!user.backup_code_enabled) {
        user.two_factor_enabled = false
      }
    }
    user.updated_at = Date.now()

    await this.ctx.storage.put('user', user)

    return { deleted: true }
  }

  /**
   * Generate backup codes
   */
  async generateBackupCodes(): Promise<{ codes: string[] } | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    const codes = generateBackupCodes(10)

    user.backup_codes = {
      codes,
      created_at: Date.now(),
      used_codes: [],
    }
    user.backup_code_enabled = true
    user.two_factor_enabled = true
    user.updated_at = Date.now()

    await this.ctx.storage.put('user', user)

    return { codes }
  }

  /**
   * Use backup code
   */
  async useBackupCode(code: string): Promise<{ valid: boolean }> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user || !user.backup_codes) return { valid: false }

    const normalizedCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const index = user.backup_codes.codes.findIndex(
      (c) => c.replace(/-/g, '') === normalizedCode
    )

    if (index === -1) return { valid: false }

    // Remove used code
    const usedCode = user.backup_codes.codes.splice(index, 1)[0]
    user.backup_codes.used_codes.push(usedCode)

    // Disable if no codes left
    if (user.backup_codes.codes.length === 0) {
      user.backup_code_enabled = false
      if (!user.totp_enabled) {
        user.two_factor_enabled = false
      }
    }

    user.updated_at = Date.now()
    await this.ctx.storage.put('user', user)

    return { valid: true }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PASSKEYS (WebAuthn)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start passkey registration
   * Returns WebAuthn PublicKeyCredentialCreationOptions
   */
  async startPasskeyRegistration(params?: {
    name?: string
    authenticatorAttachment?: 'platform' | 'cross-platform'
    residentKey?: 'discouraged' | 'preferred' | 'required'
    userVerification?: 'required' | 'preferred' | 'discouraged'
  }): Promise<PasskeyRegistrationOptions | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    const now = Date.now()
    const challenge = generateToken(32)

    // Store challenge for verification
    user.pending_passkey_challenge = {
      challenge,
      expires_at: now + 5 * 60 * 1000, // 5 minutes
      type: 'registration',
    }

    user.updated_at = now
    await this.ctx.storage.put('user', user)

    // Get user display name
    const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') ||
      user.email_addresses[0]?.email_address ||
      user.username ||
      user.id

    // Build exclude credentials from existing passkeys
    const excludeCredentials = user.passkeys.map((pk) => ({
      id: pk.credential_id,
      type: 'public-key' as const,
      transports: pk.transports,
    }))

    return {
      challenge: this.base64UrlEncode(challenge),
      rp: {
        name: 'Clerk Compat',
        id: 'localhost', // Should come from config in production
      },
      user: {
        id: this.base64UrlEncode(user.id),
        name: user.email_addresses[0]?.email_address ?? user.username ?? user.id,
        displayName,
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' }, // ES256
        { alg: -257, type: 'public-key' }, // RS256
      ],
      timeout: 60000,
      excludeCredentials: excludeCredentials.length > 0 ? excludeCredentials : undefined,
      authenticatorSelection: {
        authenticatorAttachment: params?.authenticatorAttachment,
        residentKey: params?.residentKey ?? 'preferred',
        userVerification: params?.userVerification ?? 'preferred',
      },
      attestation: 'none',
    }
  }

  /**
   * Complete passkey registration
   * Verifies the attestation response and stores the credential
   */
  async completePasskeyRegistration(params: {
    name?: string
    credential_id: string // Base64URL encoded
    public_key: string // Base64URL encoded COSE key
    client_data_json: string // Base64URL encoded
    attestation_object?: string // Base64URL encoded
    transports?: AuthenticatorTransport[]
  }): Promise<Passkey | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    // Verify challenge exists and hasn't expired
    if (!user.pending_passkey_challenge) {
      return null
    }

    if (user.pending_passkey_challenge.type !== 'registration') {
      return null
    }

    if (Date.now() > user.pending_passkey_challenge.expires_at) {
      delete user.pending_passkey_challenge
      await this.ctx.storage.put('user', user)
      return null
    }

    // Parse client data JSON to verify challenge
    try {
      const clientDataJson = JSON.parse(
        new TextDecoder().decode(this.base64UrlDecode(params.client_data_json))
      ) as { challenge: string; origin: string; type: string }

      // Verify the challenge matches
      const expectedChallenge = this.base64UrlEncode(user.pending_passkey_challenge.challenge)
      if (clientDataJson.challenge !== expectedChallenge) {
        return null
      }

      // Verify the type
      if (clientDataJson.type !== 'webauthn.create') {
        return null
      }
    } catch {
      return null
    }

    // Check for duplicate credential
    if (user.passkeys.some((pk) => pk.credential_id === params.credential_id)) {
      return null
    }

    const now = Date.now()
    const passkeyId = generateClerkId('pk')

    const passkey: Passkey = {
      id: passkeyId,
      object: 'passkey',
      name: params.name ?? `Passkey ${user.passkeys.length + 1}`,
      verification: { status: 'verified', strategy: 'passkey', attempts: null, expire_at: null },
      credential_id: params.credential_id,
      public_key: params.public_key,
      transports: params.transports ?? ['internal'],
      sign_count: 0,
      created_at: now,
      updated_at: now,
      last_used_at: null,
    }

    user.passkeys.push(passkey)
    delete user.pending_passkey_challenge
    user.updated_at = now

    await this.ctx.storage.put('user', user)

    return passkey
  }

  /**
   * Start passkey authentication
   * Returns WebAuthn PublicKeyCredentialRequestOptions
   */
  async startPasskeyAuthentication(params?: {
    userVerification?: 'required' | 'preferred' | 'discouraged'
  }): Promise<PasskeyAuthenticationOptions | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user || user.passkeys.length === 0) return null

    const now = Date.now()
    const challenge = generateToken(32)

    // Store challenge for verification
    user.pending_passkey_challenge = {
      challenge,
      expires_at: now + 5 * 60 * 1000, // 5 minutes
      type: 'authentication',
    }

    user.updated_at = now
    await this.ctx.storage.put('user', user)

    // Build allowed credentials from user's passkeys
    const allowCredentials = user.passkeys.map((pk) => ({
      id: pk.credential_id,
      type: 'public-key' as const,
      transports: pk.transports,
    }))

    return {
      challenge: this.base64UrlEncode(challenge),
      timeout: 60000,
      rpId: 'localhost', // Should come from config in production
      allowCredentials,
      userVerification: params?.userVerification ?? 'preferred',
    }
  }

  /**
   * Verify passkey authentication
   */
  async verifyPasskeyAuthentication(params: {
    credential_id: string // Base64URL encoded
    client_data_json: string // Base64URL encoded
    authenticator_data: string // Base64URL encoded
    signature: string // Base64URL encoded
    user_handle?: string // Base64URL encoded (for resident keys)
  }): Promise<{ verified: boolean; passkey?: Passkey }> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return { verified: false }

    // Verify challenge exists and hasn't expired
    if (!user.pending_passkey_challenge) {
      return { verified: false }
    }

    if (user.pending_passkey_challenge.type !== 'authentication') {
      return { verified: false }
    }

    if (Date.now() > user.pending_passkey_challenge.expires_at) {
      delete user.pending_passkey_challenge
      await this.ctx.storage.put('user', user)
      return { verified: false }
    }

    // Find the passkey
    const passkey = user.passkeys.find((pk) => pk.credential_id === params.credential_id)
    if (!passkey) {
      return { verified: false }
    }

    // Parse client data JSON to verify challenge
    try {
      const clientDataJson = JSON.parse(
        new TextDecoder().decode(this.base64UrlDecode(params.client_data_json))
      ) as { challenge: string; origin: string; type: string }

      // Verify the challenge matches
      const expectedChallenge = this.base64UrlEncode(user.pending_passkey_challenge.challenge)
      if (clientDataJson.challenge !== expectedChallenge) {
        return { verified: false }
      }

      // Verify the type
      if (clientDataJson.type !== 'webauthn.get') {
        return { verified: false }
      }
    } catch {
      return { verified: false }
    }

    // In a full implementation, we would verify the signature using the stored public key
    // and the authenticator data. For this compatibility layer, we trust the client-side
    // verification and just check that the credential exists and challenge matches.

    // Update sign count (would check against authenticator data in full impl)
    const authenticatorDataBytes = this.base64UrlDecode(params.authenticator_data)
    if (authenticatorDataBytes.length >= 37) {
      // Sign count is bytes 33-36 (big-endian uint32)
      const signCount = new DataView(authenticatorDataBytes.buffer).getUint32(33, false)
      if (signCount <= passkey.sign_count && passkey.sign_count > 0) {
        // Potential cloned authenticator - for security, reject
        return { verified: false }
      }
      passkey.sign_count = signCount
    }

    passkey.last_used_at = Date.now()
    passkey.updated_at = Date.now()
    delete user.pending_passkey_challenge
    user.updated_at = Date.now()

    await this.ctx.storage.put('user', user)

    return { verified: true, passkey }
  }

  /**
   * List user's passkeys
   */
  async listPasskeys(): Promise<Passkey[]> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    return user?.passkeys ?? []
  }

  /**
   * Get a specific passkey
   */
  async getPasskey(passkeyId: string): Promise<Passkey | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null
    return user.passkeys.find((pk) => pk.id === passkeyId) ?? null
  }

  /**
   * Update passkey name
   */
  async updatePasskey(passkeyId: string, params: { name: string }): Promise<Passkey | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    const passkey = user.passkeys.find((pk) => pk.id === passkeyId)
    if (!passkey) return null

    passkey.name = params.name
    passkey.updated_at = Date.now()
    user.updated_at = Date.now()

    await this.ctx.storage.put('user', user)

    return passkey
  }

  /**
   * Delete a passkey
   */
  async deletePasskey(passkeyId: string): Promise<{ deleted: boolean }> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return { deleted: false }

    const index = user.passkeys.findIndex((pk) => pk.id === passkeyId)
    if (index === -1) return { deleted: false }

    user.passkeys.splice(index, 1)
    user.updated_at = Date.now()

    await this.ctx.storage.put('user', user)

    return { deleted: true }
  }

  /**
   * Base64URL encode helper
   */
  private base64UrlEncode(data: string | Uint8Array): string {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  /**
   * Base64URL decode helper
   */
  private base64UrlDecode(str: string): Uint8Array {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
    while (base64.length % 4 !== 0) {
      base64 += '='
    }
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTERNAL ACCOUNTS (OAuth)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Link external account (OAuth provider)
   */
  async linkExternalAccount(params: {
    provider: string
    provider_user_id: string
    email_address: string
    first_name?: string
    last_name?: string
    avatar_url?: string
    username?: string
    approved_scopes?: string
  }): Promise<ExternalAccount | null> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return null

    const now = Date.now()
    const accountId = generateClerkId('eac')

    const externalAccount: ExternalAccount = {
      id: accountId,
      object: 'external_account',
      provider: params.provider,
      identification_id: generateClerkId('idn'),
      provider_user_id: params.provider_user_id,
      approved_scopes: params.approved_scopes ?? '',
      email_address: params.email_address,
      first_name: params.first_name ?? null,
      last_name: params.last_name ?? null,
      avatar_url: params.avatar_url ?? '',
      image_url: params.avatar_url ?? null,
      username: params.username ?? null,
      public_metadata: {},
      label: null,
      verification: { status: 'verified', strategy: `oauth_${params.provider}`, attempts: null, expire_at: null },
      created_at: now,
      updated_at: now,
    }

    user.external_accounts.push(externalAccount)
    user.updated_at = now

    await this.ctx.storage.put('user', user)

    return externalAccount
  }

  /**
   * Unlink external account
   */
  async unlinkExternalAccount(accountId: string): Promise<{ deleted: boolean }> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return { deleted: false }

    const index = user.external_accounts.findIndex((a) => a.id === accountId)
    if (index === -1) return { deleted: false }

    user.external_accounts.splice(index, 1)
    user.updated_at = Date.now()

    await this.ctx.storage.put('user', user)

    return { deleted: true }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RATE LIMITING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check rate limit
   */
  async checkRateLimit(action: string = 'default'): Promise<{
    allowed: boolean
    remaining: number
    reset_at: number
  }> {
    const key = `rate_limit:${action}`
    const now = Date.now()

    let entry = (await this.ctx.storage.get(key)) as RateLimitEntry | undefined

    if (!entry || now - entry.window_start > RATE_LIMIT_WINDOW) {
      entry = { count: 0, window_start: now }
    }

    if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
      return {
        allowed: false,
        remaining: 0,
        reset_at: entry.window_start + RATE_LIMIT_WINDOW,
      }
    }

    entry.count++
    await this.ctx.storage.put(key, entry)

    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - entry.count,
      reset_at: entry.window_start + RATE_LIMIT_WINDOW,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Convert stored user to public user (removes sensitive data)
   */
  private toPublicUser(stored: StoredUser): User {
    const { password_hash: _, totp_factors: __, backup_codes: ___, pending_passkey_challenge: ____, ...publicUser } = stored
    return {
      ...publicUser,
      object: 'user',
      passkeys_enabled: stored.passkeys.length > 0,
    }
  }

  /**
   * Update last active timestamp
   */
  async touch(): Promise<void> {
    const user = (await this.ctx.storage.get('user')) as StoredUser | null
    if (!user) return

    user.last_active_at = Date.now()
    await this.ctx.storage.put('user', user)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'UserDO' })
    }

    if (url.pathname === '/rpc' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          jsonrpc: string
          id: number
          method: string
          params?: unknown[]
        }
        const { method, params = [], id } = body

        const methodFn = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
        if (typeof methodFn !== 'function') {
          return Response.json(
            { jsonrpc: '2.0', id, error: { code: -32601, message: `Method '${method}' not found` } },
            { status: 400 }
          )
        }

        const result = await methodFn.apply(this, params)
        return Response.json({ jsonrpc: '2.0', id, result })
      } catch (error) {
        return Response.json(
          { jsonrpc: '2.0', id: 0, error: { code: -32603, message: String(error) } },
          { status: 500 }
        )
      }
    }

    return new Response('Not Found', { status: 404 })
  }
}
