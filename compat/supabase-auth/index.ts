/**
 * @dotdo/supabase-auth - Supabase Auth SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for Supabase Auth client that runs on Cloudflare Workers
 * with edge-optimized performance.
 *
 * @example Basic Usage
 * ```typescript
 * import { createClient } from '@dotdo/supabase-auth'
 *
 * const supabase = createClient(
 *   'https://your-project.supabase.co',
 *   'your-anon-key'
 * )
 *
 * // Sign up
 * const { data, error } = await supabase.auth.signUp({
 *   email: 'user@example.com',
 *   password: 'password123'
 * })
 *
 * // Sign in
 * const { data, error } = await supabase.auth.signInWithPassword({
 *   email: 'user@example.com',
 *   password: 'password123'
 * })
 *
 * // Get current user
 * const { data: { user } } = await supabase.auth.getUser()
 *
 * // Sign out
 * await supabase.auth.signOut()
 * ```
 *
 * @example Auth State Changes
 * ```typescript
 * import { createClient } from '@dotdo/supabase-auth'
 *
 * const supabase = createClient(url, key)
 *
 * supabase.auth.onAuthStateChange((event, session) => {
 *   if (event === 'SIGNED_IN') {
 *     console.log('User signed in:', session?.user?.email)
 *   } else if (event === 'SIGNED_OUT') {
 *     console.log('User signed out')
 *   }
 * })
 * ```
 *
 * @example OAuth Sign In
 * ```typescript
 * import { createClient } from '@dotdo/supabase-auth'
 *
 * const supabase = createClient(url, key)
 *
 * // Get OAuth URL
 * const { data } = await supabase.auth.signInWithOAuth({
 *   provider: 'github',
 *   options: {
 *     redirectTo: 'https://myapp.com/auth/callback'
 *   }
 * })
 *
 * // Redirect to OAuth provider
 * window.location.href = data.url
 * ```
 *
 * @example MFA (Multi-Factor Authentication)
 * ```typescript
 * import { createClient } from '@dotdo/supabase-auth'
 *
 * const supabase = createClient(url, key)
 *
 * // Enroll TOTP
 * const { data: factor } = await supabase.auth.mfa.enroll({
 *   factorType: 'totp',
 *   friendlyName: 'My Authenticator'
 * })
 *
 * // Create challenge
 * const { data: challenge } = await supabase.auth.mfa.challenge({
 *   factorId: factor.id
 * })
 *
 * // Verify challenge
 * const { data } = await supabase.auth.mfa.verify({
 *   factorId: factor.id,
 *   challengeId: challenge.id,
 *   code: '123456'
 * })
 * ```
 *
 * @see https://supabase.com/docs/reference/javascript/auth-api
 * @module
 */

import { AuthClient } from './auth-client'
import type { SupabaseClientOptions, SupabaseClient } from './types'

/**
 * Create a Supabase client
 *
 * This is the main entry point for using the Supabase Auth compat layer.
 * It creates a client that matches the @supabase/supabase-js API.
 *
 * @param supabaseUrl - Your Supabase project URL
 * @param supabaseKey - Your Supabase anon/public key
 * @param options - Client options
 * @returns Supabase client with auth
 *
 * @example
 * ```typescript
 * import { createClient } from '@dotdo/supabase-auth'
 *
 * const supabase = createClient(
 *   process.env.SUPABASE_URL,
 *   process.env.SUPABASE_ANON_KEY
 * )
 *
 * const { data, error } = await supabase.auth.signInWithPassword({
 *   email: 'user@example.com',
 *   password: 'password123'
 * })
 * ```
 */
export function createClient(
  supabaseUrl: string,
  supabaseKey: string,
  options?: SupabaseClientOptions
): SupabaseClient {
  const authClient = new AuthClient(supabaseUrl, supabaseKey, options?.auth)

  return {
    auth: authClient,
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

// Main exports
export { createClient as default }
export { AuthClient }

// Types
export type {
  // User and Session
  User,
  Session,
  UserIdentity,
  UserAppMetadata,
  UserMetadata,
  Factor,
  // Errors
  AuthError,
  SupabaseAuthError,
  // Responses
  AuthResponse,
  AuthTokenResponse,
  AuthOtpResponse,
  UserResponse,
  // Sign up/in credentials
  SignUpWithPasswordCredentials,
  SignUpWithPhoneCredentials,
  SignInWithPasswordCredentials,
  SignInWithOAuthCredentials,
  SignInWithOtpCredentials,
  VerifyOtpParams,
  // User updates
  UserAttributes,
  ResetPasswordForEmailOptions,
  // Auth state
  AuthChangeEvent,
  AuthStateChangeCallback,
  Subscription,
  AuthOnChangeResponse,
  // Providers
  Provider,
  // MFA
  MFAEnrollResponse,
  MFAChallengeResponse,
  MFAVerifyResponse,
  MFAListFactorsResponse,
  MFAUnenrollResponse,
  // Client options
  AuthClientOptions,
  SupabaseClientOptions,
  SupabaseClient,
} from './types'
