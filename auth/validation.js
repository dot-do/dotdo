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
export class MissingSecretError extends Error {
    constructor(secretName, context) {
        const message = context
            ? `${secretName} is required for ${context}`
            : `${secretName} is required`;
        super(message);
        this.name = 'MissingSecretError';
    }
}
/**
 * Error thrown when a secret doesn't meet length requirements
 */
export class SecretLengthError extends Error {
    constructor(secretName, minLength, actualLength) {
        super(`${secretName} must be at least ${minLength} characters (got ${actualLength})`);
        this.name = 'SecretLengthError';
    }
}
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
export function validateSecretPresent(secret, name, context) {
    if (secret === undefined || secret === null) {
        throw new MissingSecretError(name, context);
    }
    // Check for empty string
    if (typeof secret === 'string' && secret.length === 0) {
        throw new MissingSecretError(name, context);
    }
    // Check for empty Uint8Array
    if (secret instanceof Uint8Array && secret.length === 0) {
        throw new MissingSecretError(name, context);
    }
}
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
export function validateSecretLength(secret, minLength, name) {
    if (secret.length < minLength) {
        throw new SecretLengthError(name, minLength, secret.length);
    }
}
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
export function getRequiredSecret(env, key, context) {
    const value = env[key];
    if (typeof value !== 'string' || !value) {
        throw new MissingSecretError(key, context);
    }
    return value;
}
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
export function validateSecret(secret, minLength, name, context) {
    validateSecretPresent(secret, name, context);
    validateSecretLength(secret, minLength, name);
}
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
export function isSecretConfigured(secret, minLength) {
    if (!secret) {
        return false;
    }
    if (minLength !== undefined && secret.length < minLength) {
        return false;
    }
    return true;
}
//# sourceMappingURL=validation.js.map