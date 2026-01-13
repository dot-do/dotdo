/**
 * @dotdo/supabase - Supabase Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for Supabase client with enhanced security
 * and edge-optimized performance.
 *
 * @example
 * ```typescript
 * import { generateRecoveryCodes, createMFAApi } from '@dotdo/supabase'
 *
 * // Generate secure MFA recovery codes
 * const codes = generateRecoveryCodes()
 * // ['ABCD-EFGH-JKLM-NPQR', 'STUV-WXYZ-2345-6789', ...]
 *
 * // Create MFA API instance
 * const mfa = createMFAApi()
 * const { data, error } = await mfa.getRecoveryCodes()
 * ```
 *
 * @module
 */

export {
  // Recovery code generation
  generateRecoveryCodes,
  RECOVERY_CODE_CONFIG,

  // MFA API
  createMFAApi,

  // Types
  type RecoveryCodeOptions,
  type MFAEnrollResponse,
  type MFAChallengeResponse,
  type MFAVerifyResponse,
  type MFAApi,
} from './supabase'

// Default export
export { default } from './supabase'
