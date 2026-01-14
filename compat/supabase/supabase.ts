/**
 * @dotdo/supabase - Supabase Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for Supabase client that runs on Cloudflare Workers
 * with enhanced security and edge-optimized performance.
 *
 * @module
 */

/**
 * Configuration for recovery code generation
 */
export const RECOVERY_CODE_CONFIG = {
  /**
   * Minimum entropy bits for the entire set of recovery codes
   * 128 bits is the NIST minimum for cryptographic keys
   */
  entropyBits: 128,

  /**
   * Default number of recovery codes to generate
   */
  codeCount: 10,

  /**
   * Character set for recovery codes (alphanumeric, case-insensitive)
   * Using uppercase only to avoid confusion (l/1, O/0)
   */
  charset: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // 32 chars (5 bits each)

  /**
   * Format: groups of characters separated by dashes
   */
  groupSize: 4,
  groupCount: 4, // 4 groups of 4 chars = 16 chars = 80 bits per code
} as const

/**
 * Options for generating recovery codes
 */
export interface RecoveryCodeOptions {
  /**
   * Number of codes to generate (default: 10)
   */
  count?: number

  /**
   * Minimum entropy bits per code (default: 128 for the set)
   */
  entropyBits?: number
}

/**
 * Generate cryptographically secure MFA recovery codes
 *
 * Uses crypto.getRandomValues for true randomness.
 * Each code provides sufficient entropy to be unguessable.
 *
 * @param options - Configuration options
 * @returns Array of recovery codes
 *
 * @example
 * ```typescript
 * const codes = generateRecoveryCodes()
 * // ['ABCD-EFGH-JKLM-NPQR', 'STUV-WXYZ-2345-6789', ...]
 * ```
 *
 * @security
 * - Uses crypto.getRandomValues (CSPRNG)
 * - Minimum 128 bits entropy per code set
 * - No predictable patterns (timestamps, indices)
 * - Formatted for easy user entry
 */
export function generateRecoveryCodes(options?: RecoveryCodeOptions): string[] {
  const count = options?.count ?? RECOVERY_CODE_CONFIG.codeCount
  const entropyBits = options?.entropyBits ?? RECOVERY_CODE_CONFIG.entropyBits

  // Calculate characters needed per code for requested entropy
  // Each character from 32-char set provides 5 bits of entropy
  const bitsPerChar = Math.log2(RECOVERY_CODE_CONFIG.charset.length)

  // For higher entropy requests, use more characters
  let totalChars = RECOVERY_CODE_CONFIG.groupSize * RECOVERY_CODE_CONFIG.groupCount
  if (entropyBits > 128) {
    // Scale up for higher entropy requirements
    const minChars = Math.ceil(entropyBits / bitsPerChar)
    totalChars = Math.max(totalChars, minChars)
  }

  // Calculate group configuration for formatting
  const groupSize = RECOVERY_CODE_CONFIG.groupSize
  const groupCount = Math.ceil(totalChars / groupSize)
  const actualTotalChars = groupSize * groupCount

  const codes: string[] = []
  const generatedCodes = new Set<string>()

  for (let i = 0; i < count; i++) {
    let code: string

    // Ensure uniqueness (collision is astronomically unlikely but we check anyway)
    do {
      code = generateSingleCode(actualTotalChars, groupSize)
    } while (generatedCodes.has(code))

    generatedCodes.add(code)
    codes.push(code)
  }

  return codes
}

/**
 * Generate a single recovery code using crypto.getRandomValues
 *
 * @param totalChars - Total characters in the code (excluding separators)
 * @param groupSize - Characters per group
 * @returns Formatted recovery code
 */
function generateSingleCode(totalChars: number, groupSize: number): string {
  const charset = RECOVERY_CODE_CONFIG.charset
  const charsetLength = charset.length

  // Generate random bytes - need enough for all characters
  // Using rejection sampling to avoid modulo bias
  const randomBytes = new Uint8Array(totalChars * 2) // Extra bytes for rejection sampling
  crypto.getRandomValues(randomBytes)

  const chars: string[] = []
  let byteIndex = 0

  while (chars.length < totalChars) {
    if (byteIndex >= randomBytes.length) {
      // If we run out of bytes (very unlikely), get more
      crypto.getRandomValues(randomBytes)
      byteIndex = 0
    }

    const randomValue = randomBytes[byteIndex++]

    // Rejection sampling to avoid modulo bias
    // 256 / 32 = 8, so values 0-255 map evenly to 0-31
    // But to be safe, reject values >= 256 - (256 % charsetLength)
    const maxUnbiased = 256 - (256 % charsetLength)
    if (randomValue < maxUnbiased) {
      chars.push(charset[randomValue % charsetLength])
    }
    // else: skip this byte (rejection sampling)
  }

  // Format with dashes for readability
  const groups: string[] = []
  for (let i = 0; i < chars.length; i += groupSize) {
    groups.push(chars.slice(i, i + groupSize).join(''))
  }

  return groups.join('-')
}

// ============================================================================
// Supabase Client Implementation Placeholder
// The following would be the full Supabase compat layer implementation
// For now, we focus on the secure MFA recovery code generation
// ============================================================================

/**
 * Supabase MFA types (matching Supabase API)
 */
export interface MFAEnrollResponse {
  id: string
  type: 'totp'
  totp: {
    qr_code: string
    secret: string
    uri: string
  }
}

export interface MFAChallengeResponse {
  id: string
  type: 'totp'
  expires_at: number
}

export interface MFAVerifyResponse {
  user: object
  session: object
}

/**
 * MFA API for managing multi-factor authentication
 */
export interface MFAApi {
  /**
   * Enroll a new MFA factor
   */
  enroll(params: { factorType: 'totp'; issuer?: string; friendlyName?: string }): Promise<{
    data: MFAEnrollResponse | null
    error: Error | null
  }>

  /**
   * Create a challenge for MFA verification
   */
  challenge(params: { factorId: string }): Promise<{
    data: MFAChallengeResponse | null
    error: Error | null
  }>

  /**
   * Verify an MFA challenge
   */
  verify(params: { factorId: string; challengeId: string; code: string }): Promise<{
    data: MFAVerifyResponse | null
    error: Error | null
  }>

  /**
   * List enrolled MFA factors
   */
  listFactors(): Promise<{
    data: {
      totp: Array<{ id: string; friendly_name?: string; factor_type: 'totp'; status: string }>
    } | null
    error: Error | null
  }>

  /**
   * Unenroll an MFA factor
   */
  unenroll(params: { factorId: string }): Promise<{
    data: { id: string } | null
    error: Error | null
  }>

  /**
   * Get recovery codes for account recovery
   *
   * @security Uses crypto.getRandomValues for secure code generation
   */
  getRecoveryCodes(): Promise<{
    data: { codes: string[] } | null
    error: Error | null
  }>
}

/**
 * Create MFA API instance
 *
 * @internal
 */
export function createMFAApi(): MFAApi {
  return {
    async enroll(_params) {
      // TODO: Implement TOTP enrollment
      return { data: null, error: new Error('Not implemented') }
    },

    async challenge(_params) {
      // TODO: Implement challenge creation
      return { data: null, error: new Error('Not implemented') }
    },

    async verify(_params) {
      // TODO: Implement verification
      return { data: null, error: new Error('Not implemented') }
    },

    async listFactors() {
      // TODO: Implement factor listing
      return { data: null, error: new Error('Not implemented') }
    },

    async unenroll(_params) {
      // TODO: Implement unenrollment
      return { data: null, error: new Error('Not implemented') }
    },

    async getRecoveryCodes() {
      // Secure recovery code generation using crypto.getRandomValues
      const codes = generateRecoveryCodes()
      return { data: { codes }, error: null }
    },
  }
}

// Export for testing and direct use
export default {
  generateRecoveryCodes,
  RECOVERY_CODE_CONFIG,
  createMFAApi,
}
