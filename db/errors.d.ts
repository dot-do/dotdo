/**
 * @dotdo/db - Error Types
 *
 * Provides a consistent error hierarchy for the entire dotdo ecosystem.
 * This is the base layer that other packages (@dotdo/rpc, @dotdo/do, etc.) can extend.
 *
 * Design Principles:
 * 1. Base DotdoError class with standardized error codes
 * 2. Package-specific error types extending base
 * 3. Consistent error codes with HTTP status mapping
 * 4. Proper error serialization for cross-boundary transport
 */
/**
 * Standardized error codes following the pattern: CATEGORY_ACTION or CATEGORY
 * These codes provide machine-readable identifiers for programmatic error handling.
 */
export declare const ErrorCode: {
    readonly INTERNAL_ERROR: "INTERNAL_ERROR";
    readonly NOT_FOUND: "NOT_FOUND";
    readonly VALIDATION_ERROR: "VALIDATION_ERROR";
    readonly CONFLICT: "CONFLICT";
    readonly TIMEOUT: "TIMEOUT";
    readonly RATE_LIMIT: "RATE_LIMIT";
    readonly SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE";
    readonly NOT_IMPLEMENTED: "NOT_IMPLEMENTED";
    readonly PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE";
    readonly AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR";
    readonly AUTHORIZATION_ERROR: "AUTHORIZATION_ERROR";
    readonly NETWORK_ERROR: "NETWORK_ERROR";
    readonly RPC_ERROR: "RPC_ERROR";
    readonly CIRCUIT_OPEN: "CIRCUIT_OPEN";
    readonly DATABASE_ERROR: "DATABASE_ERROR";
    readonly TRANSACTION_ERROR: "TRANSACTION_ERROR";
    readonly STORAGE_ERROR: "STORAGE_ERROR";
};
export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];
/**
 * Mapping from error codes to HTTP status codes
 */
export declare const ERROR_CODE_TO_HTTP_STATUS: Record<ErrorCodeType, number>;
/**
 * Get HTTP status code for a given error code
 */
export declare function getHttpStatusForCode(code: ErrorCodeType | string): number;
/**
 * Check if an error code represents a retryable error
 */
export declare function isRetryableCode(code: ErrorCodeType | string): boolean;
/**
 * Type alias for error details/context.
 *
 * This is a legitimate use of Record<string, unknown> because error details
 * are inherently open-ended - different error types may include different
 * contextual information (field names, IDs, URLs, counts, etc.).
 *
 * Using Record<string, unknown> here provides:
 * 1. Type safety (prevents `any`)
 * 2. Flexibility for varying error contexts
 * 3. JSON serializability guarantee
 *
 * @example
 * ```typescript
 * const details: ErrorDetails = {
 *   resourceType: 'Customer',
 *   resourceId: 'cust-123',
 *   field: 'email',
 *   attemptedValue: 'invalid'
 * }
 * ```
 */
export type ErrorDetails = Record<string, unknown>;
/**
 * Serialized error format for JSON transport across boundaries
 */
export interface SerializedDotdoError {
    /** Error type name (e.g., 'DotdoError', 'NotFoundError') */
    type: string;
    /** Error name (alias for type, for backward compatibility) */
    name?: string;
    /** Error code for programmatic handling */
    code: ErrorCodeType | string;
    /** Human-readable error message */
    message: string;
    /** Additional error details */
    details?: ErrorDetails;
    /** HTTP status code */
    httpStatus?: number;
    /** Stack trace (optional, excluded by default in production) */
    stack?: string;
    /** Serialized cause error (optional) */
    cause?: SerializedDotdoError | {
        name: string;
        message: string;
    };
}
/**
 * Options for error serialization
 */
export interface SerializeErrorOptions {
    /** Include stack trace in serialized output (default: false in production) */
    includeStack?: boolean;
}
/**
 * Options for creating a DotdoError
 */
export interface DotdoErrorOptions {
    /** Underlying cause of the error */
    cause?: Error | unknown;
    /** Additional context/metadata */
    details?: ErrorDetails;
}
/**
 * Base error class for the entire dotdo ecosystem.
 *
 * All package-specific errors should extend this class to ensure:
 * - Consistent error code handling
 * - HTTP status code mapping
 * - Proper serialization for cross-boundary transport
 * - Cause chaining for debugging
 *
 * @example
 * ```typescript
 * // Basic usage
 * throw new DotdoError(ErrorCode.NOT_FOUND, 'Resource not found')
 *
 * // With details and cause
 * try {
 *   await fetchData()
 * } catch (err) {
 *   throw new DotdoError(ErrorCode.NETWORK_ERROR, 'Failed to fetch data', {
 *     cause: err,
 *     details: { url, timeout }
 *   })
 * }
 * ```
 */
export declare class DotdoError extends Error {
    /** Error code for programmatic handling */
    readonly code: ErrorCodeType | string;
    /** HTTP status code derived from error code */
    readonly httpStatus: number;
    /** Additional error details/context */
    readonly details?: ErrorDetails;
    constructor(code: ErrorCodeType | string, message: string, options?: DotdoErrorOptions);
    /**
     * Check if this error is retryable
     */
    get retryable(): boolean;
    /**
     * Serialize error for JSON transport
     */
    toJSON(): SerializedDotdoError;
    /**
     * Create a formatted string representation
     */
    toString(): string;
    /**
     * Wrap an unknown error as a DotdoError
     */
    static wrap(error: unknown, code?: ErrorCodeType | string): DotdoError;
    /**
     * Check if an error is a DotdoError with a specific code
     */
    static is(error: unknown, code: ErrorCodeType | string): error is DotdoError;
    /**
     * Check if an error is any DotdoError
     */
    static isDotdoError(error: unknown): error is DotdoError;
}
/**
 * Base database error class
 * Extends DotdoError with database-specific defaults
 *
 * Note: Uses positional `details` argument for backward compatibility.
 */
export declare class DatabaseError extends DotdoError {
    constructor(message: string, details?: ErrorDetails);
}
/**
 * Validation error for invalid input (e.g., missing required fields)
 *
 * Named DbValidationError to avoid conflict with ValidationError interfaces
 * in schema.ts and schemas.ts.
 *
 * Extends DatabaseError for inheritance hierarchy compatibility.
 */
export declare class DbValidationError extends DatabaseError {
    readonly code: "VALIDATION_ERROR";
    readonly httpStatus = 400;
    constructor(message?: string, details?: ErrorDetails);
    /**
     * Create a DbValidationError with multiple field errors
     */
    static withErrors(errors: Array<{
        field: string;
        message: string;
    }>): DbValidationError;
    /**
     * Create a DbValidationError for a single field
     */
    static forField(field: string, constraint: string, value?: unknown): DbValidationError;
}
/**
 * Resource not found error
 *
 * Named DbNotFoundError for consistency with DbValidationError.
 *
 * Extends DatabaseError for inheritance hierarchy compatibility.
 */
export declare class DbNotFoundError extends DatabaseError {
    readonly code: "NOT_FOUND";
    readonly httpStatus = 404;
    constructor(message?: string, details?: ErrorDetails);
    /**
     * Create a DbNotFoundError for a specific resource type and ID
     */
    static forResource(resourceType: string, resourceId: string): DbNotFoundError;
}
/**
 * Transaction-related errors for the database layer
 */
export declare class TransactionError extends DotdoError {
    constructor(message: string, cause?: Error, details?: ErrorDetails);
    /**
     * Create a TransactionError for rollback failure
     */
    static rollbackFailed(originalError: Error, rollbackError: Error): TransactionError;
    /**
     * Create a TransactionError for nested transaction failure
     */
    static nestedFailed(savepointName: string, error: Error): TransactionError;
}
/**
 * Error thrown when attempting nested transactions without support
 */
export declare class NestedTransactionError extends TransactionError {
    constructor(message?: string);
}
/**
 * Serialize an error for transmission across boundaries
 */
export declare function serializeDotdoError(error: Error | DotdoError, options?: SerializeErrorOptions): SerializedDotdoError;
/**
 * Serialize any value as an error for transmission
 */
export declare function serializeUnknownAsDotdoError(error: unknown, options?: SerializeErrorOptions): SerializedDotdoError;
/**
 * Registry of error constructors for deserialization.
 * Note: DatabaseError and subclasses accept (message, details?) but are
 * compatible for basic deserialization through type widening.
 */
type ErrorConstructorType = new (message: string, optionsOrDetails?: DotdoErrorOptions | ErrorDetails) => DotdoError;
/**
 * Register a custom error class for deserialization
 */
export declare function registerErrorClass(name: string, ErrorClass: ErrorConstructorType): void;
/**
 * Deserialize an error received from across boundaries
 */
export declare function deserializeDotdoError(serialized: SerializedDotdoError): DotdoError | Error;
/**
 * Type guard to check if an object is a SerializedDotdoError
 */
export declare function isSerializedDotdoError(value: unknown): value is SerializedDotdoError;
/**
 * Extract error message from an unknown error value
 */
export declare function getErrorMessage(error: unknown): string;
/**
 * Check if an error is retryable
 */
export declare function isRetryableError(error: unknown): boolean;
export {};
//# sourceMappingURL=errors.d.ts.map