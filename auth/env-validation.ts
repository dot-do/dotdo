/**
 * Environment Variable Validation for Auth Configuration
 *
 * Validates required OAuth environment variables at startup
 * and provides descriptive error messages for missing configuration.
 */

const REQUIRED_AUTH_ENV_VARS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
] as const

/**
 * Validates that all required auth environment variables are present.
 * Throws a descriptive error if any are missing.
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
}
