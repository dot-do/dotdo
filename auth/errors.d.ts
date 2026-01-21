/**
 * Token Validation Error Classes
 *
 * Provides specific, actionable error messages for JWT and token validation failures.
 * Error messages are designed to help developers debug issues while remaining safe
 * (no sensitive data like token contents or secrets are leaked).
 *
 * @module auth/errors
 */
import type { ContentfulStatusCode } from 'hono/utils/http-status';
/**
 * Error codes for token validation failures.
 * Use these codes for programmatic error handling.
 */
export declare enum TokenErrorCode {
    /** Token is missing from the request */
    MISSING_TOKEN = "TOKEN_MISSING",
    /** Token format is malformed (not valid JWT structure) */
    MALFORMED_TOKEN = "TOKEN_MALFORMED",
    /** Token signature verification failed */
    INVALID_SIGNATURE = "TOKEN_INVALID_SIGNATURE",
    /** Token has expired */
    TOKEN_EXPIRED = "TOKEN_EXPIRED",
    /** Token is not yet valid (nbf claim is in the future) */
    TOKEN_NOT_YET_VALID = "TOKEN_NOT_YET_VALID",
    /** Token issuer (iss) claim doesn't match expected value */
    INVALID_ISSUER = "TOKEN_INVALID_ISSUER",
    /** Token audience (aud) claim doesn't match expected value */
    INVALID_AUDIENCE = "TOKEN_INVALID_AUDIENCE",
    /** Token is missing required subject (sub) claim */
    MISSING_SUBJECT = "TOKEN_MISSING_SUBJECT",
    /** Token algorithm is not allowed */
    ALGORITHM_NOT_ALLOWED = "TOKEN_ALG_NOT_ALLOWED",
    /** Token algorithm is not supported */
    ALGORITHM_NOT_SUPPORTED = "TOKEN_ALG_NOT_SUPPORTED",
    /** Authorization header format is invalid */
    INVALID_AUTH_HEADER = "AUTH_HEADER_INVALID",
    /** Token claim validation failed */
    CLAIM_VALIDATION_FAILED = "TOKEN_CLAIM_INVALID",
    /** Generic token validation error */
    VALIDATION_FAILED = "TOKEN_VALIDATION_FAILED"
}
/**
 * Base error class for token validation failures.
 * All token-specific errors extend this class.
 */
export declare class TokenValidationError extends Error {
    /** Error code for programmatic handling */
    readonly code: TokenErrorCode;
    /** HTTP status code to return (compatible with Hono's HTTPException) */
    readonly statusCode: ContentfulStatusCode;
    /** Developer-friendly hint for resolving the error */
    readonly hint: string | undefined;
    constructor(message: string, code: TokenErrorCode, options?: {
        statusCode?: ContentfulStatusCode;
        hint?: string;
        cause?: unknown;
    });
    /**
     * Returns a JSON-serializable representation of the error.
     * Safe for client responses (no sensitive data).
     */
    toJSON(): {
        hint?: string | undefined;
        error: string;
        code: TokenErrorCode;
        message: string;
    };
}
/**
 * Error thrown when no token is present in the request.
 */
export declare class MissingTokenError extends TokenValidationError {
    constructor(location?: 'header' | 'cookie' | 'both');
}
/**
 * Error thrown when the Authorization header format is invalid.
 */
export declare class InvalidAuthHeaderError extends TokenValidationError {
    constructor(reason: 'missing_scheme' | 'wrong_scheme' | 'missing_token' | 'malformed');
}
/**
 * Error thrown when the token structure is malformed.
 */
export declare class MalformedTokenError extends TokenValidationError {
    constructor(reason?: string);
}
/**
 * Error thrown when token signature verification fails.
 */
export declare class InvalidSignatureError extends TokenValidationError {
    constructor();
}
/**
 * Error thrown when the token has expired.
 */
export declare class TokenExpiredError extends TokenValidationError {
    /** When the token expired (Unix timestamp) */
    readonly expiredAt: number | undefined;
    constructor(expiredAt?: number);
    toJSON(): {
        expiredAt?: number | undefined;
        hint?: string | undefined;
        error: string;
        code: TokenErrorCode;
        message: string;
    };
}
/**
 * Error thrown when the token is not yet valid (nbf in future).
 */
export declare class TokenNotYetValidError extends TokenValidationError {
    /** When the token becomes valid (Unix timestamp) */
    readonly validFrom: number | undefined;
    constructor(validFrom?: number);
    toJSON(): {
        validFrom?: number | undefined;
        hint?: string | undefined;
        error: string;
        code: TokenErrorCode;
        message: string;
    };
}
/**
 * Error thrown when the token issuer doesn't match.
 */
export declare class InvalidIssuerError extends TokenValidationError {
    constructor(expected?: string);
}
/**
 * Error thrown when the token audience doesn't match.
 */
export declare class InvalidAudienceError extends TokenValidationError {
    constructor(expected?: string);
}
/**
 * Error thrown when the token is missing the subject claim.
 */
export declare class MissingSubjectError extends TokenValidationError {
    constructor();
}
/**
 * Error thrown when the token uses a disallowed algorithm.
 */
export declare class AlgorithmNotAllowedError extends TokenValidationError {
    constructor(algorithm?: string);
}
/**
 * Error thrown when the token uses an unsupported algorithm.
 */
export declare class AlgorithmNotSupportedError extends TokenValidationError {
    constructor(algorithm?: string);
}
/**
 * Error thrown when a specific JWT claim validation fails.
 */
export declare class ClaimValidationError extends TokenValidationError {
    /** The claim that failed validation */
    readonly claim: string;
    /** The reason for the validation failure */
    readonly reason: string | undefined;
    constructor(claim: string, reason?: string);
    toJSON(): {
        reason?: string | undefined;
        claim: string;
        hint?: string | undefined;
        error: string;
        code: TokenErrorCode;
        message: string;
    };
}
/**
 * Maps jose library errors to our specific error types.
 * This provides more actionable error messages while preserving the original error as the cause.
 *
 * @param error - The error thrown by jose
 * @param options - Optional context for generating better error messages
 * @returns A TokenValidationError subclass with specific details
 */
export declare function mapJoseError(error: unknown, options?: {
    expectedIssuer?: string | undefined;
    expectedAudience?: string | undefined;
}): TokenValidationError;
/**
 * Generates an appropriate WWW-Authenticate header value based on the error.
 *
 * @param error - The token validation error
 * @param realm - The realm for the WWW-Authenticate header (default: "dotdo")
 * @returns A properly formatted WWW-Authenticate header value
 */
export declare function getWWWAuthenticateHeader(error: TokenValidationError, realm?: string): string;
//# sourceMappingURL=errors.d.ts.map