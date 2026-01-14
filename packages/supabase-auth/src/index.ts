/**
 * @dotdo/supabase-auth - Supabase Auth SDK with In-Memory Backend
 *
 * A drop-in replacement for Supabase Auth that stores all data in memory.
 * Perfect for testing, development, and edge environments.
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
 * @see https://supabase.com/docs/reference/javascript/auth-api
 * @module
 */

import { AuthClient } from './auth-client'
import type { SupabaseClientOptions, SupabaseClient } from './types'

/**
 * Create a Supabase client with in-memory auth backend
 *
 * This is the main entry point for using the Supabase Auth compat layer.
 * Unlike the real Supabase client, this version stores all data in memory.
 *
 * @param supabaseUrl - Your Supabase project URL (used for compatibility)
 * @param supabaseKey - Your Supabase anon/public key (used for compatibility)
 * @param options - Client options
 * @returns Supabase client with auth
 *
 * @example
 * ```typescript
 * import { createClient } from '@dotdo/supabase-auth'
 *
 * const supabase = createClient(
 *   'https://test.supabase.co',
 *   'test-key'
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
