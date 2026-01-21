/**
 * Shared Secret Validation Utilities
 *
 * Centralized validation functions for secrets and credentials.
 * Use these utilities instead of duplicating validation logic.
 *
 * @module auth/validation
 */
/**
 * Error thrown when a required secret is missing
 */
export declare class MissingSecretError extends Error {
    constructor(secretName: string, context?: string);
}
/**
 * Error thrown when a secret doesn't meet length requirements
 */
export declare class SecretLengthError extends Error {
    constructor(secretName: string, minLength: number, actualLength: number);
}
/** Type for secrets that can be either string or Uint8Array */
export type SecretValue = string | Uint8Array;
/**
 * Validate that a secret is present (not null, undefined, or empty)
 *
 * @param secret - The secret value to validate (string or Uint8Array)
 * @param name - Name of the secret (for error messages)
 * @param context - Optional context for the error message
 * @throws {MissingSecretError} If the secret is missing
 *
 * @example
 * ```typescript
 * validateSecretPresent(env.JWT_SECRET, 'JWT_SECRET', 'JWT validation')
 * // Throws: "JWT_SECRET is required for JWT validation"
 * ```
 */
export declare function validateSecretPresent(secret: SecretValue | undefined | null, name: string, context?: string): asserts secret is SecretValue;
/**
 * Validate that a secret meets minimum length requirements
 *
 * @param secret - The secret value to validate
 * @param minLength - Minimum required length
 * @param name - Name of the secret (for error messages)
 * @throws {SecretLengthError} If the secret is too short
 *
 * @example
 * ```typescript
 * validateSecretLength(secret, 32, 'DO_INTERNAL_SECRET')
 * // Throws: "DO_INTERNAL_SECRET must be at least 32 characters (got 16)"
 * ```
 */
export declare function validateSecretLength(secret: string, minLength: number, name: string): void;
/**
 * Get a required secret from an environment object
 *
 * @param env - Environment object containing secrets
 * @param key - Key of the secret to retrieve
 * @param context - Optional context for the error message
 * @returns The secret value
 * @throws {MissingSecretError} If the secret is missing
 *
 * @example
 * ```typescript
 * const secret = getRequiredSecret(env, 'JWT_SECRET', 'JWT validation')
 * ```
 */
export declare function getRequiredSecret<T extends Record<string, unknown>>(env: T, key: keyof T & string, context?: string): string;
/**
 * Validate a secret is present and meets minimum length requirements
 *
 * Combines validateSecretPresent and validateSecretLength for convenience.
 *
 * @param secret - The secret value to validate
 * @param minLength - Minimum required length
 * @param name - Name of the secret (for error messages)
 * @param context - Optional context for the error message
 * @throws {MissingSecretError} If the secret is missing
 * @throws {SecretLengthError} If the secret is too short
 *
 * @example
 * ```typescript
 * validateSecret(env.DO_INTERNAL_SECRET, 32, 'DO_INTERNAL_SECRET', 'DO-to-DO signing')
 * ```
 */
export declare function validateSecret(secret: string | undefined | null, minLength: number, name: string, context?: string): asserts secret is string;
/**
 * Check if a secret is configured (present and optionally meets minimum length)
 *
 * Unlike validate functions, this returns a boolean instead of throwing.
 * Useful for optional secrets where you want to check availability.
 *
 * @param secret - The secret value to check
 * @param minLength - Optional minimum required length
 * @returns True if the secret is valid, false otherwise
 *
 * @example
 * ```typescript
 * if (isSecretConfigured(env.DO_INTERNAL_SECRET, 32)) {
 *   // Use the secret for signing
 * } else {
 *   logger.warn('DO_INTERNAL_SECRET not configured - feature disabled')
 * }
 * ```
 */
export declare function isSecretConfigured(secret: string | undefined | null, minLength?: number): secret is string;
//# sourceMappingURL=validation.d.ts.map