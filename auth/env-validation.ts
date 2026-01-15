/**
 * Environment Variable Validation for Auth Configuration
 *
 * Validates required OAuth environment variables at startup
 * and provides descriptive error messages for missing configuration.
 *
 * @module auth/env-validation
 *
 * @example
 * ```typescript
 * import { validateAuthEnv } from './auth/env-validation'
 *
 * // Validate with CloudflareEnv bindings (preferred)
 * validateAuthEnv(env)
 *
 * // For backwards compatibility, can be called without parameter
 * validateAuthEnv()
 * ```
 *
 * @remarks
 * This module is automatically called by {@link createAuth} when initializing
 * the auth system. You can also call it manually to validate early in the
 * application lifecycle.
 *
 * Required environment variables:
 * - `GOOGLE_CLIENT_ID` - OAuth client ID for Google sign-in
 * - `GOOGLE_CLIENT_SECRET` - OAuth client secret for Google sign-in
 * - `GITHUB_CLIENT_ID` - OAuth client ID for GitHub sign-in
 * - `GITHUB_CLIENT_SECRET` - OAuth client secret for GitHub sign-in
 */

import { logger } from '../lib/logging'

/**
 * Type for env bindings containing OAuth credentials
 */
export interface AuthEnvBindings {
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  [key: string]: string | undefined
}

/**
 * Required OAuth environment variables for auth configuration.
 * @internal
 */
const REQUIRED_AUTH_ENV_VARS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
] as const

/**
 * Type representing the required auth environment variable names.
 */
export type RequiredAuthEnvVar = (typeof REQUIRED_AUTH_ENV_VARS)[number]

/** Tracks whether validation has already been performed */
let validated = false

/**
 * Validates that all required auth environment variables are present.
 *
 * This function checks for the presence of OAuth configuration required
 * for Google and GitHub authentication providers. If any variables are
 * missing, it throws a descriptive error listing all missing variables.
 *
 * @param env - Environment bindings (from CloudflareEnv). If not provided,
 *              the function will log a deprecation warning and skip validation.
 * @throws {Error} If any required environment variables are missing.
 *   The error message includes a list of all missing variables.
 *
 * @example
 * ```typescript
 * // At application startup with CloudflareEnv
 * try {
 *   validateAuthEnv(env)
 *   console.log('Auth configuration validated')
 * } catch (error) {
 *   console.error('Auth configuration error:', error.message)
 * }
 * ```
 *
 * @see {@link createAuth} - Calls this function automatically
 */
export function validateAuthEnv(env?: AuthEnvBindings): void {
  // If no env provided, log warning and skip validation
  // This maintains backwards compatibility during migration
  if (!env) {
    logger.warn(
      'validateAuthEnv() called without env parameter. Pass CloudflareEnv bindings for proper Workers compatibility.',
      { source: 'auth/env-validation' }
    )
    validated = true
    return
  }

  const missing: string[] = []

  for (const varName of REQUIRED_AUTH_ENV_VARS) {
    if (!env[varName]) {
      missing.push(varName)
    }
  }

  if (missing.length > 0) {
    const details = missing.map((v) => `${v} is required`).join(', ')
    throw new Error(`Missing required environment variables: ${details}`)
  }

  validated = true
}

/**
 * Checks if auth environment has been validated.
 *
 * @returns `true` if {@link validateAuthEnv} has been called successfully
 * @internal
 */
export function isAuthEnvValidated(): boolean {
  return validated
}

/**
 * Resets the validation state. Used for testing.
 * @internal
 */
export function resetValidationState(): void {
  validated = false
}
