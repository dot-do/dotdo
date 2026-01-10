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
 * // Validate at startup - throws if any required vars are missing
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
 * @throws {Error} If any required environment variables are missing.
 *   The error message includes a list of all missing variables.
 *
 * @example
 * ```typescript
 * // At application startup
 * try {
 *   validateAuthEnv()
 *   console.log('Auth configuration validated')
 * } catch (error) {
 *   console.error('Auth configuration error:', error.message)
 *   process.exit(1)
 * }
 * ```
 *
 * @see {@link createAuth} - Calls this function automatically
 */
export function validateAuthEnv(): void {
  const missing: string[] = []

  for (const varName of REQUIRED_AUTH_ENV_VARS) {
    if (!process.env[varName]) {
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
