/**
 * Unified Environment Configuration Validation (do-zvk6d)
 *
 * Provides type-safe environment variable validation with Zod schemas.
 * Validates environment at startup to catch configuration errors early.
 *
 * Features:
 * - Type-safe environment access
 * - Build-time / startup validation
 * - Required vs optional variables
 * - Coercion for numbers, booleans
 * - Cloudflare Workers env compatibility (no process.env)
 * - Default values
 * - Environment-specific schemas
 *
 * @module @dotdo/utils/env-config
 * @issue do-zvk6d - Add unified environment configuration validation
 */
import { z } from 'zod';
// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================
/**
 * Validate environment variables against a Zod schema
 *
 * @param schema - Zod schema defining required and optional env vars
 * @param env - Environment object to validate
 * @param options - Validation options
 * @returns Validation result with typed env values
 *
 * @example
 * ```typescript
 * import { validateEnv, z } from '@dotdo/utils'
 *
 * const EnvSchema = z.object({
 *   DATABASE_URL: z.string().url(),
 *   API_KEY: z.string().min(32),
 *   PORT: z.coerce.number().int().positive().default(3000),
 *   DEBUG: BooleanEnvSchema.default(false),
 * })
 *
 * const result = validateEnv(EnvSchema, process.env)
 * if (!result.success) {
 *   console.error('Environment validation failed:', result.errors)
 *   process.exit(1)
 * }
 *
 * // result.env is fully typed
 * console.log(result.env.PORT) // number
 * ```
 */
export function validateEnv(schema, env, options = {}) {
    const result = schema.safeParse(env);
    if (result.success) {
        if (options.logResult) {
            console.log('[env] Environment validation passed');
        }
        return {
            success: true,
            env: result.data,
        };
    }
    const errors = formatZodErrors(result.error);
    if (options.logResult) {
        console.error('[env] Environment validation failed:', errors);
    }
    if (options.onError) {
        options.onError(errors);
    }
    if (options.throwOnError) {
        throw new EnvConfigError(errors);
    }
    return {
        success: false,
        env: {},
        errors,
    };
}
/**
 * Validate environment and throw if invalid
 *
 * @param schema - Zod schema for environment
 * @param env - Environment object
 * @returns Validated environment (throws on error)
 *
 * @example
 * ```typescript
 * // At application startup
 * const env = validateEnvOrThrow(EnvSchema, process.env)
 * // env is typed and guaranteed to be valid
 * ```
 */
export function validateEnvOrThrow(schema, env) {
    const result = validateEnv(schema, env, { throwOnError: true });
    return result.env;
}
/**
 * Create a typed environment getter with lazy validation
 *
 * @param schema - Zod schema for environment validation
 * @param envSource - Function that returns the environment object
 * @returns Getter function that validates on first call and caches result
 *
 * @example
 * ```typescript
 * const getEnv = createEnvGetter(EnvSchema, () => process.env)
 *
 * // Later in code
 * const env = getEnv() // Validates on first call, caches result
 * console.log(env.DATABASE_URL)
 * ```
 */
export function createEnvGetter(schema, envSource) {
    let cached = null;
    let validated = false;
    return () => {
        if (!validated) {
            cached = validateEnvOrThrow(schema, envSource());
            validated = true;
        }
        return cached;
    };
}
/**
 * Validate Cloudflare Workers environment bindings
 *
 * Use this for validating env in Cloudflare Workers where there's no process.env.
 *
 * @param schema - Zod schema for environment
 * @param env - Cloudflare env bindings from worker fetch handler
 * @param options - Validation options
 *
 * @example
 * ```typescript
 * export default {
 *   async fetch(request: Request, env: Env): Promise<Response> {
 *     const config = validateWorkerEnv(WorkerEnvSchema, env)
 *     if (!config.success) {
 *       return new Response('Configuration error', { status: 500 })
 *     }
 *     // Use config.env
 *   }
 * }
 * ```
 */
export function validateWorkerEnv(schema, env, options = {}) {
    return validateEnv(schema, env, options);
}
// ============================================================================
// COMMON SCHEMAS
// ============================================================================
/**
 * Boolean environment schema that handles string values
 * Supports: 'true', 'false', '1', '0', 'yes', 'no', ''
 */
export const BooleanEnvSchema = z
    .union([z.boolean(), z.string()])
    .transform((val) => {
    if (typeof val === 'boolean')
        return val;
    const lower = val.toLowerCase();
    return lower === 'true' || lower === '1' || lower === 'yes';
});
/**
 * Port number schema with coercion and validation
 */
export const PortSchema = z.coerce.number().int().min(1).max(65535);
/**
 * Node environment schema
 */
export const NodeEnvSchema = z.enum(['development', 'production', 'test', 'staging']);
/**
 * URL schema for database connections, APIs, etc.
 */
export const UrlSchema = z.string().url();
/**
 * API key schema with minimum length validation
 */
export const ApiKeySchema = z.string().min(16);
/**
 * Secret schema with minimum entropy
 */
export const SecretSchema = z.string().min(32);
/**
 * Optional string that falls back to undefined
 */
export const OptionalStringSchema = z.string().optional();
/**
 * Duration schema (e.g., "30s", "5m", "1h")
 */
export const DurationSchema = z.string().regex(/^\d+[smhd]$/, {
    message: 'Duration must be in format: 30s, 5m, 1h, 1d',
});
/**
 * Comma-separated list schema
 */
export const CommaSeparatedListSchema = z
    .string()
    .transform((val) => val.split(',').map((s) => s.trim()).filter(Boolean));
// ============================================================================
// DOTDO-SPECIFIC SCHEMAS
// ============================================================================
/**
 * Base environment schema for all dotdo packages
 */
export const BaseDotdoEnvSchema = z.object({
    /** Environment: development, production, test, staging */
    ENVIRONMENT: NodeEnvSchema.default('development'),
    /** Enable debug logging */
    DEBUG: BooleanEnvSchema.default(false),
    /** Log level: debug, info, warn, error */
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
/**
 * DO package environment schema
 */
export const DOEnvSchema = BaseDotdoEnvSchema.extend({
    /** DO internal secret for DO-to-DO authentication */
    DO_INTERNAL_SECRET: SecretSchema.optional(),
    /** Enable metrics collection */
    METRICS_ENABLED: BooleanEnvSchema.default(false),
    /** Enable tracing */
    TRACING_ENABLED: BooleanEnvSchema.default(false),
});
/**
 * API package environment schema
 */
export const ApiEnvSchema = BaseDotdoEnvSchema.extend({
    /** CORS allowed origins (comma-separated) */
    CORS_ORIGINS: CommaSeparatedListSchema.optional(),
    /** Rate limit tier: free, pro, enterprise */
    RATE_LIMIT_TIER: z.enum(['free', 'pro', 'enterprise']).default('free'),
    /** JWT secret for authentication */
    JWT_SECRET: SecretSchema.optional(),
    /** API key for external services */
    API_KEY: ApiKeySchema.optional(),
});
/**
 * Auth package environment schema
 */
export const AuthEnvSchema = BaseDotdoEnvSchema.extend({
    /** JWT secret for signing tokens */
    JWT_SECRET: SecretSchema,
    /** JWT issuer */
    JWT_ISSUER: z.string().default('dotdo'),
    /** JWT audience */
    JWT_AUDIENCE: z.string().default('dotdo'),
    /** Token expiry duration */
    TOKEN_EXPIRY: DurationSchema.default('1h'),
    /** Refresh token expiry */
    REFRESH_TOKEN_EXPIRY: DurationSchema.default('7d'),
    /** JWKS URL for external identity providers */
    JWKS_URL: UrlSchema.optional(),
});
/**
 * AI package environment schema
 */
export const AIEnvSchema = BaseDotdoEnvSchema.extend({
    /** OpenAI API key */
    OPENAI_API_KEY: ApiKeySchema.optional(),
    /** Anthropic API key */
    ANTHROPIC_API_KEY: ApiKeySchema.optional(),
    /** Default AI provider: openai, anthropic, cloudflare */
    AI_PROVIDER: z.enum(['openai', 'anthropic', 'cloudflare']).default('anthropic'),
    /** Default model to use */
    AI_MODEL: z.string().optional(),
    /** AI request timeout in milliseconds */
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
});
/**
 * Database package environment schema
 */
export const DBEnvSchema = BaseDotdoEnvSchema.extend({
    /** Database URL (for external databases) */
    DATABASE_URL: UrlSchema.optional(),
    /** Enable query logging */
    DB_LOG_QUERIES: BooleanEnvSchema.default(false),
    /** Maximum pool size */
    DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
});
/**
 * Full dotdo environment schema (all packages combined)
 */
export const DotdoEnvSchema = z.object({
    // Base
    ...BaseDotdoEnvSchema.shape,
    // DO
    DO_INTERNAL_SECRET: SecretSchema.optional(),
    METRICS_ENABLED: BooleanEnvSchema.default(false),
    TRACING_ENABLED: BooleanEnvSchema.default(false),
    // API
    CORS_ORIGINS: CommaSeparatedListSchema.optional(),
    RATE_LIMIT_TIER: z.enum(['free', 'pro', 'enterprise']).default('free'),
    // Auth
    JWT_SECRET: SecretSchema.optional(),
    JWT_ISSUER: z.string().default('dotdo'),
    JWT_AUDIENCE: z.string().default('dotdo'),
    TOKEN_EXPIRY: DurationSchema.default('1h'),
    REFRESH_TOKEN_EXPIRY: DurationSchema.default('7d'),
    JWKS_URL: UrlSchema.optional(),
    // AI
    OPENAI_API_KEY: ApiKeySchema.optional(),
    ANTHROPIC_API_KEY: ApiKeySchema.optional(),
    AI_PROVIDER: z.enum(['openai', 'anthropic', 'cloudflare']).default('anthropic'),
    AI_MODEL: z.string().optional(),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    // Database
    DATABASE_URL: UrlSchema.optional(),
    DB_LOG_QUERIES: BooleanEnvSchema.default(false),
    DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
});
// ============================================================================
// ERROR CLASS
// ============================================================================
/**
 * Error thrown when environment validation fails
 */
export class EnvConfigError extends Error {
    errors;
    constructor(errors) {
        const missing = errors.filter((e) => e.missing).map((e) => e.name);
        const invalid = errors.filter((e) => !e.missing).map((e) => `${e.name} (${e.message})`);
        const parts = [];
        if (missing.length > 0) {
            parts.push(`Missing: ${missing.join(', ')}`);
        }
        if (invalid.length > 0) {
            parts.push(`Invalid: ${invalid.join(', ')}`);
        }
        super(`Environment validation failed. ${parts.join('. ')}`);
        this.name = 'EnvConfigError';
        this.errors = errors;
    }
}
// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
/**
 * Format Zod errors into EnvValidationError array
 */
function formatZodErrors(error) {
    return error.issues.map((issue) => {
        const name = issue.path[0]?.toString() ?? 'unknown';
        const isMissing = issue.code === 'invalid_type' &&
            issue.received === 'undefined';
        return {
            name,
            message: issue.message,
            missing: isMissing,
            value: isMissing ? undefined : issue.received,
        };
    });
}
/**
 * Check if running in production environment
 */
export function isProduction(env) {
    const envValue = env['ENVIRONMENT'] ?? env['NODE_ENV'];
    return envValue === 'production';
}
/**
 * Check if running in development environment
 */
export function isDevelopment(env) {
    const envValue = env['ENVIRONMENT'] ?? env['NODE_ENV'];
    return envValue === 'development' || envValue === undefined;
}
/**
 * Check if running in test environment
 */
export function isTest(env) {
    const envValue = env['ENVIRONMENT'] ?? env['NODE_ENV'];
    return envValue === 'test';
}
/**
 * Get a required environment variable or throw
 *
 * @param env - Environment object
 * @param key - Variable name
 * @returns Variable value
 * @throws Error if variable is not defined
 */
export function requireEnv(env, key) {
    const value = env[key];
    if (value === undefined || value === null || value === '') {
        throw new EnvConfigError([
            { name: key, message: 'Required environment variable is not defined', missing: true },
        ]);
    }
    return String(value);
}
/**
 * Get an optional environment variable with default
 *
 * @param env - Environment object
 * @param key - Variable name
 * @param defaultValue - Default value if not defined
 * @returns Variable value or default
 */
export function optionalEnv(env, key, defaultValue) {
    const value = env[key];
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    // Coerce to the type of defaultValue
    if (typeof defaultValue === 'number') {
        return Number(value);
    }
    if (typeof defaultValue === 'boolean') {
        const strValue = String(value).toLowerCase();
        return (strValue === 'true' || strValue === '1' || strValue === 'yes');
    }
    return String(value);
}
// Re-export Zod for convenience
export { z } from 'zod';
//# sourceMappingURL=env-config.js.map