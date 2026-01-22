/**
 * Token Validation Error Classes
 *
 * Provides specific, actionable error messages for JWT and token validation failures.
 * Error messages are designed to help developers debug issues while remaining safe
 * (no sensitive data like token contents or secrets are leaked).
 *
 * @module auth/errors
 */
/**
 * Error codes for token validation failures.
 * Use these codes for programmatic error handling.
 */
export var TokenErrorCode;
(function (TokenErrorCode) {
    /** Token is missing from the request */
    TokenErrorCode["MISSING_TOKEN"] = "TOKEN_MISSING";
    /** Token format is malformed (not valid JWT structure) */
    TokenErrorCode["MALFORMED_TOKEN"] = "TOKEN_MALFORMED";
    /** Token signature verification failed */
    TokenErrorCode["INVALID_SIGNATURE"] = "TOKEN_INVALID_SIGNATURE";
    /** Token has expired */
    TokenErrorCode["TOKEN_EXPIRED"] = "TOKEN_EXPIRED";
    /** Token is not yet valid (nbf claim is in the future) */
    TokenErrorCode["TOKEN_NOT_YET_VALID"] = "TOKEN_NOT_YET_VALID";
    /** Token issuer (iss) claim doesn't match expected value */
    TokenErrorCode["INVALID_ISSUER"] = "TOKEN_INVALID_ISSUER";
    /** Token audience (aud) claim doesn't match expected value */
    TokenErrorCode["INVALID_AUDIENCE"] = "TOKEN_INVALID_AUDIENCE";
    /** Token is missing required subject (sub) claim */
    TokenErrorCode["MISSING_SUBJECT"] = "TOKEN_MISSING_SUBJECT";
    /** Token algorithm is not allowed */
    TokenErrorCode["ALGORITHM_NOT_ALLOWED"] = "TOKEN_ALG_NOT_ALLOWED";
    /** Token algorithm is not supported */
    TokenErrorCode["ALGORITHM_NOT_SUPPORTED"] = "TOKEN_ALG_NOT_SUPPORTED";
    /** Authorization header format is invalid */
    TokenErrorCode["INVALID_AUTH_HEADER"] = "AUTH_HEADER_INVALID";
    /** Token claim validation failed */
    TokenErrorCode["CLAIM_VALIDATION_FAILED"] = "TOKEN_CLAIM_INVALID";
    /** Generic token validation error */
    TokenErrorCode["VALIDATION_FAILED"] = "TOKEN_VALIDATION_FAILED";
})(TokenErrorCode || (TokenErrorCode = {}));
/**
 * Base error class for token validation failures.
 * All token-specific errors extend this class.
 */
export class TokenValidationError extends Error {
    /** Error code for programmatic handling */
    code;
    /** HTTP status code to return (compatible with Hono's HTTPException) */
    statusCode;
    /** Developer-friendly hint for resolving the error */
    hint;
    constructor(message, code, options) {
        super(message, { cause: options?.cause });
        this.name = 'TokenValidationError';
        this.code = code;
        this.statusCode = options?.statusCode ?? 401;
        this.hint = options?.hint;
    }
    /**
     * Returns a JSON-serializable representation of the error.
     * Safe for client responses (no sensitive data).
     */
    toJSON() {
        return {
            error: this.name,
            code: this.code,
            message: this.message,
            ...(this.hint && { hint: this.hint }),
        };
    }
}
/**
 * Error thrown when no token is present in the request.
 */
export class MissingTokenError extends TokenValidationError {
    constructor(location = 'header') {
        const messages = {
            header: 'Authorization header required',
            cookie: 'Authentication cookie required',
            both: 'Authentication required (provide Bearer token or auth cookie)',
        };
        super(messages[location], TokenErrorCode.MISSING_TOKEN, {
            hint: location === 'header'
                ? 'Include an Authorization header with format: Bearer <token>'
                : location === 'cookie'
                    ? 'Include the authentication cookie in your request'
                    : 'Include either an Authorization header (Bearer <token>) or auth cookie',
        });
        this.name = 'MissingTokenError';
    }
}
/**
 * Error thrown when the Authorization header format is invalid.
 */
export class InvalidAuthHeaderError extends TokenValidationError {
    constructor(reason) {
        const messages = {
            missing_scheme: 'Authorization header missing authentication scheme',
            wrong_scheme: 'Invalid authentication scheme. Expected "Bearer"',
            missing_token: 'Authorization header missing token value',
            malformed: 'Authorization header format is invalid',
        };
        const hints = {
            missing_scheme: 'Format: Authorization: Bearer <token>',
            wrong_scheme: 'Use Bearer authentication: Authorization: Bearer <token>',
            missing_token: 'Include the token after "Bearer ": Authorization: Bearer <token>',
            malformed: 'Expected format: Authorization: Bearer <token>',
        };
        super(messages[reason], TokenErrorCode.INVALID_AUTH_HEADER, {
            hint: hints[reason],
        });
        this.name = 'InvalidAuthHeaderError';
    }
}
/**
 * Error thrown when the token structure is malformed.
 */
export class MalformedTokenError extends TokenValidationError {
    constructor(reason) {
        const message = reason
            ? `Token is malformed: ${reason}`
            : 'Token is malformed (invalid JWT structure)';
        super(message, TokenErrorCode.MALFORMED_TOKEN, {
            hint: 'Ensure the token is a valid JWT with three base64url-encoded parts separated by dots',
        });
        this.name = 'MalformedTokenError';
    }
}
/**
 * Error thrown when token signature verification fails.
 */
export class InvalidSignatureError extends TokenValidationError {
    constructor() {
        super('Token signature verification failed', TokenErrorCode.INVALID_SIGNATURE, {
            hint: 'The token signature is invalid. Ensure the token was signed with the correct secret/key',
        });
        this.name = 'InvalidSignatureError';
    }
}
/**
 * Error thrown when the token has expired.
 */
export class TokenExpiredError extends TokenValidationError {
    /** When the token expired (Unix timestamp) */
    expiredAt;
    constructor(expiredAt) {
        const message = expiredAt
            ? `Token expired at ${new Date(expiredAt * 1000).toISOString()}`
            : 'Token has expired';
        super(message, TokenErrorCode.TOKEN_EXPIRED, {
            hint: 'Refresh your token or request a new one from the authentication endpoint',
        });
        this.name = 'TokenExpiredError';
        this.expiredAt = expiredAt;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            ...(this.expiredAt && { expiredAt: this.expiredAt }),
        };
    }
}
/**
 * Error thrown when the token is not yet valid (nbf in future).
 */
export class TokenNotYetValidError extends TokenValidationError {
    /** When the token becomes valid (Unix timestamp) */
    validFrom;
    constructor(validFrom) {
        const message = validFrom
            ? `Token is not valid until ${new Date(validFrom * 1000).toISOString()}`
            : 'Token is not yet valid';
        super(message, TokenErrorCode.TOKEN_NOT_YET_VALID, {
            hint: 'The token\'s "not before" (nbf) claim is set to a future time. Wait until the token becomes valid or request a new one',
        });
        this.name = 'TokenNotYetValidError';
        this.validFrom = validFrom;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            ...(this.validFrom && { validFrom: this.validFrom }),
        };
    }
}
/**
 * Error thrown when the token issuer doesn't match.
 */
export class InvalidIssuerError extends TokenValidationError {
    constructor(expected) {
        const message = expected
            ? `Token issuer (iss) does not match expected value "${expected}"`
            : 'Token issuer (iss) is invalid';
        super(message, TokenErrorCode.INVALID_ISSUER, {
            hint: 'Ensure the token was issued by the correct authentication server',
        });
        this.name = 'InvalidIssuerError';
    }
}
/**
 * Error thrown when the token audience doesn't match.
 */
export class InvalidAudienceError extends TokenValidationError {
    constructor(expected) {
        const message = expected
            ? `Token audience (aud) does not match expected value "${expected}"`
            : 'Token audience (aud) is invalid';
        super(message, TokenErrorCode.INVALID_AUDIENCE, {
            hint: 'Ensure the token was issued for this API/service',
        });
        this.name = 'InvalidAudienceError';
    }
}
/**
 * Error thrown when the token is missing the subject claim.
 */
export class MissingSubjectError extends TokenValidationError {
    constructor() {
        super('Token is missing required subject (sub) claim', TokenErrorCode.MISSING_SUBJECT, {
            hint: 'The token must include a "sub" claim identifying the user/subject',
        });
        this.name = 'MissingSubjectError';
    }
}
/**
 * Error thrown when the token uses a disallowed algorithm.
 */
export class AlgorithmNotAllowedError extends TokenValidationError {
    constructor(algorithm) {
        const message = algorithm
            ? `Token algorithm "${algorithm}" is not allowed`
            : 'Token algorithm is not allowed';
        super(message, TokenErrorCode.ALGORITHM_NOT_ALLOWED, {
            hint: 'The token uses an algorithm that is not permitted. Check the server\'s allowed algorithms configuration',
        });
        this.name = 'AlgorithmNotAllowedError';
    }
}
/**
 * Error thrown when the token uses an unsupported algorithm.
 */
export class AlgorithmNotSupportedError extends TokenValidationError {
    constructor(algorithm) {
        const message = algorithm
            ? `Token algorithm "${algorithm}" is not supported`
            : 'Token algorithm is not supported';
        super(message, TokenErrorCode.ALGORITHM_NOT_SUPPORTED, {
            hint: 'The token uses an algorithm that is not supported by this server',
        });
        this.name = 'AlgorithmNotSupportedError';
    }
}
/**
 * Error thrown when a specific JWT claim validation fails.
 */
export class ClaimValidationError extends TokenValidationError {
    /** The claim that failed validation */
    claim;
    /** The reason for the validation failure */
    reason;
    constructor(claim, reason) {
        const message = reason
            ? `Token claim "${claim}" validation failed: ${reason}`
            : `Token claim "${claim}" validation failed`;
        super(message, TokenErrorCode.CLAIM_VALIDATION_FAILED, {
            hint: `Check the "${claim}" claim in your token payload`,
        });
        this.name = 'ClaimValidationError';
        this.claim = claim;
        this.reason = reason;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            claim: this.claim,
            ...(this.reason && { reason: this.reason }),
        };
    }
}
/**
 * Maps jose library errors to our specific error types.
 * This provides more actionable error messages while preserving the original error as the cause.
 *
 * @param error - The error thrown by jose
 * @param options - Optional context for generating better error messages
 * @returns A TokenValidationError subclass with specific details
 */
export function mapJoseError(error, options) {
    if (error instanceof TokenValidationError) {
        return error;
    }
    if (!(error instanceof Error)) {
        return new TokenValidationError('Token validation failed', TokenErrorCode.VALIDATION_FAILED, { cause: error });
    }
    const errorMessage = error.message.toLowerCase();
    const errorCode = error.code;
    // Check for specific jose error codes first
    switch (errorCode) {
        case 'ERR_JWT_EXPIRED':
            // Extract expiration time from the error if available
            const expPayload = error.payload;
            return new TokenExpiredError(expPayload?.exp);
        case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
            return new InvalidSignatureError();
        case 'ERR_JWT_INVALID':
        case 'ERR_JWS_INVALID':
            return new MalformedTokenError();
        case 'ERR_JOSE_ALG_NOT_ALLOWED':
            return new AlgorithmNotAllowedError();
        case 'ERR_JOSE_NOT_SUPPORTED':
            return new AlgorithmNotSupportedError();
        case 'ERR_JWT_CLAIM_VALIDATION_FAILED': {
            const claimError = error;
            // Handle specific claim failures
            if (claimError.claim === 'iss') {
                return new InvalidIssuerError(options?.expectedIssuer);
            }
            if (claimError.claim === 'aud') {
                return new InvalidAudienceError(options?.expectedAudience);
            }
            if (claimError.claim === 'nbf') {
                const nbf = claimError.payload?.nbf;
                return new TokenNotYetValidError(typeof nbf === 'number' ? nbf : undefined);
            }
            if (claimError.claim === 'exp') {
                const exp = claimError.payload?.exp;
                return new TokenExpiredError(typeof exp === 'number' ? exp : undefined);
            }
            return new ClaimValidationError(claimError.claim ?? 'unknown', claimError.reason);
        }
    }
    // Fall back to message-based detection for errors without codes
    if (errorMessage.includes('expired') || errorMessage.includes('"exp" claim')) {
        return new TokenExpiredError();
    }
    if (errorMessage.includes('signature verification failed') || errorMessage.includes('signature mismatch')) {
        return new InvalidSignatureError();
    }
    if (errorMessage.includes('"iss" claim') || errorMessage.includes('issuer')) {
        return new InvalidIssuerError(options?.expectedIssuer);
    }
    if (errorMessage.includes('"aud" claim') || errorMessage.includes('audience')) {
        return new InvalidAudienceError(options?.expectedAudience);
    }
    if (errorMessage.includes('"nbf" claim') || errorMessage.includes('not yet valid')) {
        return new TokenNotYetValidError();
    }
    if (errorMessage.includes('malformed') ||
        errorMessage.includes('invalid compact jws') ||
        errorMessage.includes('invalid jwt') ||
        errorMessage.includes('not a valid') ||
        errorMessage.includes('invalid encoding')) {
        return new MalformedTokenError();
    }
    if (errorMessage.includes('algorithm')) {
        if (errorMessage.includes('not allowed')) {
            return new AlgorithmNotAllowedError();
        }
        if (errorMessage.includes('not supported')) {
            return new AlgorithmNotSupportedError();
        }
    }
    // Generic fallback - include original message for debugging but wrap in our error type
    return new TokenValidationError(error.message || 'Token validation failed', TokenErrorCode.VALIDATION_FAILED, { cause: error });
}
/**
 * Generates an appropriate WWW-Authenticate header value based on the error.
 *
 * @param error - The token validation error
 * @param realm - The realm for the WWW-Authenticate header (default: "dotdo")
 * @returns A properly formatted WWW-Authenticate header value
 */
export function getWWWAuthenticateHeader(error, realm = 'dotdo') {
    // Map error codes to OAuth 2.0 Bearer token error codes
    // See RFC 6750 Section 3.1
    const errorDescriptionMap = {
        [TokenErrorCode.MISSING_TOKEN]: 'invalid_request',
        [TokenErrorCode.MALFORMED_TOKEN]: 'invalid_token',
        [TokenErrorCode.INVALID_SIGNATURE]: 'invalid_token',
        [TokenErrorCode.TOKEN_EXPIRED]: 'invalid_token',
        [TokenErrorCode.TOKEN_NOT_YET_VALID]: 'invalid_token',
        [TokenErrorCode.INVALID_ISSUER]: 'invalid_token',
        [TokenErrorCode.INVALID_AUDIENCE]: 'invalid_token',
        [TokenErrorCode.MISSING_SUBJECT]: 'invalid_token',
        [TokenErrorCode.ALGORITHM_NOT_ALLOWED]: 'invalid_token',
        [TokenErrorCode.ALGORITHM_NOT_SUPPORTED]: 'invalid_token',
        [TokenErrorCode.INVALID_AUTH_HEADER]: 'invalid_request',
        [TokenErrorCode.CLAIM_VALIDATION_FAILED]: 'invalid_token',
        [TokenErrorCode.VALIDATION_FAILED]: 'invalid_token',
    };
    const oauthError = errorDescriptionMap[error.code] || 'invalid_token';
    // Build the header with realm and error
    let header = `Bearer realm="${realm}", error="${oauthError}"`;
    // Add error_description with a sanitized version of the message
    // Escape quotes in the message to prevent header injection
    const safeMessage = error.message.replace(/"/g, '\\"');
    header += `, error_description="${safeMessage}"`;
    // Add error_code for programmatic handling
    header += `, error_code="${error.code}"`;
    return header;
}
//# sourceMappingURL=errors.js.map