// Shared RPC Headers
// These constants are used by both @dotdo/rpc and @dotdo/do for DO-to-DO communication
// They are defined here in @dotdo/rpc to avoid circular dependencies
// ============================================================================
// Correlation ID Utilities
// ============================================================================
/**
 * Generate a unique correlation ID for request tracing
 * Uses crypto.randomUUID() when available, otherwise falls back to a timestamp-based ID
 */
export function generateCorrelationId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}
/** Header name for correlation ID */
export const CORRELATION_ID_HEADER = 'X-Correlation-ID';
// ============================================================================
// DO-to-DO Headers
// ============================================================================
/**
 * Header indicating the request is from another DO
 */
export const DO_SOURCE_HEADER = 'X-DO-Source';
/**
 * Header containing the source DO's ID
 */
export const DO_SOURCE_ID_HEADER = 'X-DO-Source-ID';
/**
 * Header containing HMAC signature for DO-to-DO authentication
 * This prevents header spoofing by external clients
 */
export const DO_SIGNATURE_HEADER = 'X-DO-Signature';
/**
 * Header containing timestamp for signature validation (prevents replay attacks)
 */
export const DO_TIMESTAMP_HEADER = 'X-DO-Timestamp';
/**
 * Header containing nonce for replay protection and idempotency
 */
export const DO_NONCE_HEADER = 'X-DO-Nonce';
/**
 * Header indicating the request is from a Cloudflare Worker
 * This is set by the Cloudflare runtime for internal requests
 */
export const CF_WORKER_HEADER = 'cf-worker';
/**
 * Header containing the worker name (set by us in the API layer)
 */
export const WORKER_NAME_HEADER = 'X-Worker-Name';
/**
 * Header indicating internal trust chain
 */
export const INTERNAL_TRUST_HEADER = 'X-Internal-Trust';
//# sourceMappingURL=headers.js.map