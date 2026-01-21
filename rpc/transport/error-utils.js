// Error Utilities for Unified Transport Error Handling
// Provides shared utilities for normalizing and categorizing errors across all transports
import { ErrorCode, isRetryableCode, } from '../errors';
/**
 * Determine the error category from an error code
 */
export function getErrorCategory(code, httpStatus) {
    switch (code) {
        case ErrorCode.TIMEOUT:
            return 'timeout';
        case ErrorCode.NETWORK_ERROR:
        case ErrorCode.SERVICE_UNAVAILABLE:
            return 'network';
        case ErrorCode.VALIDATION_ERROR:
            return 'validation';
        case ErrorCode.CIRCUIT_OPEN:
            return 'transport';
        default:
            // Check HTTP status for server errors
            if (httpStatus !== undefined) {
                if (httpStatus >= 500)
                    return 'server';
                if (httpStatus >= 400)
                    return 'validation';
            }
            return 'server';
    }
}
export function createNormalizedError(options) {
    const { type, code, message, httpStatus, details } = options;
    const error = {
        type,
        name: type, // Include name for backward compatibility
        code,
        message,
    };
    if (httpStatus !== undefined) {
        error.httpStatus = httpStatus;
    }
    if (details !== undefined) {
        error.details = details;
    }
    return error;
}
/**
 * Create a timeout error with normalized structure
 */
export function createTimeoutError(timeoutMs, transportType) {
    return createNormalizedError({
        type: 'TimeoutError',
        code: ErrorCode.TIMEOUT,
        message: `Request timed out after ${timeoutMs}ms`,
        httpStatus: 504,
        details: { timeout: timeoutMs, transportType },
    });
}
/**
 * Create a network error with normalized structure
 */
export function createNetworkError(message, transportType, details) {
    return createNormalizedError({
        type: 'NetworkError',
        code: ErrorCode.NETWORK_ERROR,
        message,
        httpStatus: 503,
        details: { transportType, ...details },
    });
}
/**
 * Create a transport error from an underlying error
 */
export function createTransportErrorFromCatch(error, transportType, endpoint) {
    // Handle AbortError/TimeoutError specially
    if (error instanceof Error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            return createNormalizedError({
                type: 'TimeoutError',
                code: ErrorCode.TIMEOUT,
                message: `Transport timeout: ${error.message}`,
                httpStatus: 504,
                details: {
                    transportType,
                    endpoint,
                    reason: 'timeout',
                    originalError: error.name,
                },
            });
        }
        // Network-related errors
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            return createNetworkError(`Network error: ${error.message}`, transportType, { endpoint, reason: 'network_failure', originalError: error.name });
        }
    }
    // Generic transport error
    const message = error instanceof Error ? error.message : String(error);
    return createNormalizedError({
        type: 'TransportError',
        code: ErrorCode.NETWORK_ERROR,
        message: `Transport error: ${message}`,
        httpStatus: 503,
        details: {
            transportType,
            endpoint,
            reason: 'unknown',
            originalError: error instanceof Error ? error.name : 'Unknown',
        },
    });
}
/**
 * Create an error context for the error interceptor
 */
export function createErrorContext(params) {
    const { transportType, message, correlationId, error, endpoint, attempt, startTime } = params;
    const category = getErrorCategory(error.code, error.httpStatus);
    const retryable = isRetryableCode(error.code);
    const context = {
        transportType,
        message,
        correlationId,
        category,
        retryable,
    };
    if (endpoint !== undefined) {
        context.endpoint = endpoint;
    }
    if (error.httpStatus !== undefined) {
        context.httpStatus = error.httpStatus;
    }
    if (attempt !== undefined) {
        context.attempt = attempt;
    }
    if (startTime !== undefined) {
        context.durationMs = Date.now() - startTime;
    }
    return context;
}
/**
 * Apply error interceptor and return the final error
 *
 * This utility handles the interceptor invocation and falls back to the original
 * error if the interceptor returns undefined or throws.
 */
export function applyErrorInterceptor(error, context, interceptor) {
    if (!interceptor) {
        return error;
    }
    try {
        const transformed = interceptor(error, context);
        // Return transformed error if provided, otherwise use original
        return transformed ?? error;
    }
    catch {
        // Interceptor threw - use original error
        return error;
    }
}
/**
 * Create an error response with normalized structure and optional interceptor
 */
export function createErrorResponse(params) {
    const { error, correlationId, transportType, message, endpoint, attempt, startTime, onError } = params;
    const context = createErrorContext({
        transportType,
        message,
        correlationId,
        error,
        endpoint,
        attempt,
        startTime,
    });
    const finalError = applyErrorInterceptor(error, context, onError);
    return {
        error: finalError,
        correlationId,
    };
}
/**
 * Create a validation error response
 */
export function createValidationErrorResponse(errorMessage, correlationId) {
    return createNormalizedError({
        type: 'ValidationError',
        code: ErrorCode.VALIDATION_ERROR,
        message: errorMessage,
        httpStatus: 400,
    });
}
/**
 * Create a generic server error response from HTTP status
 */
export function createServerErrorFromStatus(status, transportType, statusText) {
    const message = statusText ?? `${transportType} RPC error: ${status}`;
    return createNormalizedError({
        type: 'RPCError',
        code: status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_ERROR,
        message,
        httpStatus: status,
        details: { transportType },
    });
}
/**
 * Create a transport closed error
 */
export function createTransportClosedError(transportType) {
    return createNormalizedError({
        type: 'TransportError',
        code: ErrorCode.NETWORK_ERROR,
        message: 'Transport has been closed',
        httpStatus: 503,
        details: { transportType, reason: 'closed' },
    });
}
/**
 * Create a no transport available error
 */
export function createNoTransportError(transportType) {
    return createNormalizedError({
        type: 'TransportError',
        code: ErrorCode.NETWORK_ERROR,
        message: 'No transport available',
        httpStatus: 503,
        details: { transportType, reason: 'no_transport' },
    });
}
/**
 * Create a unified error handler for transport implementations.
 *
 * This factory creates a consistent error handling function that:
 * - Normalizes errors from different sources (catch blocks, HTTP responses, etc.)
 * - Creates proper error context
 * - Applies error interceptors
 * - Returns consistent error responses
 *
 * @example
 * ```typescript
 * const handleError = createUnifiedErrorHandler({
 *   transportType: 'fetch',
 *   endpoint: 'https://api.example.com',
 *   onError: (error, context) => {
 *     console.error(`[${context.transportType}] ${error.message}`)
 *   }
 * })
 *
 * // In transport implementation:
 * try {
 *   // ... send request
 * } catch (error) {
 *   return handleError.fromCatch(error, message, correlationId, startTime)
 * }
 * ```
 */
export function createUnifiedErrorHandler(options) {
    const { transportType, endpoint, onError } = options;
    return {
        /**
         * Handle an error from a catch block (transport-level errors)
         */
        fromCatch(error, message, correlationId, startTime) {
            const transportError = createTransportErrorFromCatch(error, transportType, endpoint);
            return createErrorResponse({
                error: transportError,
                correlationId,
                transportType,
                message,
                endpoint,
                startTime,
                onError,
            });
        },
        /**
         * Handle an already-serialized error (e.g., from server response)
         */
        fromSerializedError(error, message, correlationId, startTime) {
            const context = createErrorContext({
                transportType,
                message,
                correlationId,
                error,
                endpoint,
                startTime,
            });
            const finalError = applyErrorInterceptor(error, context, onError);
            return { error: finalError, correlationId };
        },
        /**
         * Handle a timeout error
         */
        fromTimeout(timeoutMs, message, correlationId, startTime) {
            const error = createTimeoutError(timeoutMs, transportType);
            return createErrorResponse({
                error,
                correlationId,
                transportType,
                message,
                endpoint,
                startTime,
                onError,
            });
        },
        /**
         * Handle a network error
         */
        fromNetworkError(errorMessage, message, correlationId, details, startTime) {
            const error = createNetworkError(errorMessage, transportType, details);
            return createErrorResponse({
                error,
                correlationId,
                transportType,
                message,
                endpoint,
                startTime,
                onError,
            });
        },
        /**
         * Handle a validation error
         */
        fromValidationError(errorMessage, message, correlationId, startTime) {
            const error = createValidationErrorResponse(errorMessage, correlationId);
            return createErrorResponse({
                error,
                correlationId,
                transportType,
                message,
                endpoint,
                startTime,
                onError,
            });
        },
        /**
         * Handle an HTTP status error
         */
        fromHttpStatus(status, message, correlationId, statusText, startTime) {
            const error = createServerErrorFromStatus(status, transportType, statusText);
            return createErrorResponse({
                error,
                correlationId,
                transportType,
                message,
                endpoint,
                startTime,
                onError,
            });
        },
        /**
         * Handle a transport closed error
         */
        fromClosed(message, correlationId) {
            const error = createTransportClosedError(transportType);
            return { error, correlationId };
        },
        /**
         * Handle a no transport available error
         */
        fromNoTransport(message, correlationId) {
            const error = createNoTransportError(transportType);
            return { error, correlationId };
        },
    };
}
//# sourceMappingURL=error-utils.js.map