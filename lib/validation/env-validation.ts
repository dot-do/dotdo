/**
 * Environment Variable Validation
 *
 * Provides type-safe environment variable access with Zod validation.
 * Validates environment at startup to catch configuration errors early.
 */

import { z, ZodType, ZodError } from 'zod'
import { ValidationError } from './error-transform'

/**
 * Validated environment container
 */
interface ValidatedEnv<T> {
  /** The validated environment values */
  readonly env: T
  /** Whether validation was successful */
  readonly isValid: boolean
  /** Validation errors if any */
  readonly errors?: ValidationError
}

/**
 * Validate environment variables against a schema
 *
 * @param schema - Zod schema defining required and optional env vars
 * @param env - Environment object to validate (defaults to process.env)
 * @returns Validated environment with proper types
 *
 * @example
 * ```ts
 * const EnvSchema = z.object({
 *   DATABASE_URL: z.string().url(),
 *   API_KEY: z.string().min(32),
 *   NODE_ENV: z.enum(['development', 'production', 'test']),
 *   PORT: z.coerce.number().int().positive().default(3000),
 *   DEBUG: z.coerce.boolean().default(false),
 * })
 *
 * const result = validateEnv(EnvSchema)
 * if (!result.isValid) {
 *   console.error('Environment validation failed:', result.errors)
 *   process.exit(1)
 * }
 *
 * // result.env is fully typed
 * console.log(result.env.PORT) // number
 * ```
 */
export function validateEnv<T>(
  schema: ZodType<T>,
  env: Record<string, string | undefined> = typeof process !== 'undefined'
    ? process.env
    : {}
): ValidatedEnv<T> {
  const result = schema.safeParse(env)

  if (result.success) {
    return {
      env: result.data,
      isValid: true,
    }
  }

  const firstIssue = result.error.issues[0]
  const details = formatEnvErrors(result.error)

  return {
    env: {} as T,
    isValid: false,
    errors: new ValidationError({
      message: formatEnvErrorMessage(result.error),
      path: firstIssue?.path ?? [],
      code: 'ENV_VALIDATION_FAILED',
      status: 500,
      details,
    }),
  }
}

/**
 * Validate environment variables and throw if invalid
 *
 * @param schema - Zod schema defining required and optional env vars
 * @param env - Environment object to validate (defaults to process.env)
 * @returns Validated environment with proper types
 * @throws ValidationError if validation fails
 *
 * @example
 * ```ts
 * // At application startup
 * const env = validateEnvOrThrow(EnvSchema)
 *
 * // env is typed and guaranteed to be valid
 * startServer(env.PORT)
 * ```
 */
export function validateEnvOrThrow<T>(
  schema: ZodType<T>,
  env: Record<string, string | undefined> = typeof process !== 'undefined'
    ? process.env
    : {}
): T {
  const result = validateEnv(schema, env)

  if (!result.isValid) {
    throw result.errors
  }

  return result.env
}

/**
 * Create a typed environment accessor with validation
 *
 * @param schema - Zod schema for environment validation
 * @returns Function to get validated environment
 *
 * @example
 * ```ts
 * const getEnv = createEnvGetter(EnvSchema)
 *
 * // Later in code
 * const env = getEnv() // Validates on first call, caches result
 * console.log(env.DATABASE_URL)
 * ```
 */
export function createEnvGetter<T>(
  schema: ZodType<T>
): () => T {
  let cachedEnv: T | null = null
  let validated = false

  return (): T => {
    if (!validated) {
      cachedEnv = validateEnvOrThrow(schema)
      validated = true
    }
    return cachedEnv!
  }
}

/**
 * Format Zod errors for environment variables
 */
function formatEnvErrors(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {}

  for (const issue of error.issues) {
    const envVar = issue.path[0]?.toString() ?? '_unknown'
    if (!details[envVar]) {
      details[envVar] = []
    }
    details[envVar].push(issue.message)
  }

  return details
}

/**
 * Format a user-friendly error message for env validation
 */
function formatEnvErrorMessage(error: ZodError): string {
  const missingVars: string[] = []
  const invalidVars: string[] = []

  for (const issue of error.issues) {
    const envVar = issue.path[0]?.toString() ?? 'unknown'
    if (issue.code === 'invalid_type' && (issue as { received?: string }).received === 'undefined') {
      missingVars.push(envVar)
    } else {
      invalidVars.push(`${envVar} (${issue.message})`)
    }
  }

  const parts: string[] = []
  if (missingVars.length > 0) {
    parts.push(`Missing: ${missingVars.join(', ')}`)
  }
  if (invalidVars.length > 0) {
    parts.push(`Invalid: ${invalidVars.join(', ')}`)
  }

  return `Environment validation failed. ${parts.join('. ')}`
}

// ============================================================================
// Common Environment Schemas
// ============================================================================

/**
 * Common Node environment schema
 */
export const NodeEnvSchema = z.enum(['development', 'production', 'test']).default('development')

/**
 * Common port schema with coercion and defaults
 */
export const PortSchema = z.coerce.number().int().min(1).max(65535).default(3000)

/**
 * Common boolean schema that handles string values
 */
export const BooleanEnvSchema = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
  .default('false')
  .transform((val) => val === 'true' || val === '1' || val === 'yes')

/**
 * Common URL schema for database connections
 */
export const DatabaseUrlSchema = z.string().url()

/**
 * Common API key schema (minimum length validation)
 */
export const ApiKeySchema = z.string().min(16)

/**
 * Base schema for common environment variables
 */
export const BaseEnvSchema = z.object({
  NODE_ENV: NodeEnvSchema,
})

/**
 * Helper to create optional env var with default
 */
export function optionalEnv<T>(
  schema: ZodType<T>,
  defaultValue: T
): ZodType<T> {
  return schema.optional().default(defaultValue as unknown as undefined) as unknown as ZodType<T>
}
