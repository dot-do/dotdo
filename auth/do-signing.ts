/**
 * DO-to-DO Authentication Signing
 *
 * This module re-exports DO signing functionality from @dotdo/rpc for backwards compatibility.
 * The canonical implementation is now in @dotdo/rpc/do-signing.
 *
 * @module @dotdo/auth/do-signing
 * @deprecated Import from @dotdo/rpc/do-signing instead
 */

// Re-export everything from @dotdo/rpc/do-signing
export {
  // Header constants
  DO_SOURCE_HEADER,
  DO_SOURCE_ID_HEADER,
  DO_SIGNATURE_HEADER,
  DO_TIMESTAMP_HEADER,
  CORRELATION_ID_HEADER,
  // Signature configuration
  SIGNATURE_MAX_AGE_MS,
  // Secret management
  setDOInternalSecret,
  getDOInternalSecret,
  clearDOInternalSecret,
  // Signing utilities
  generateHmacSignature,
  verifyHmacSignature,
  verifyDOSignature,
  addDOSourceHeaders,
  addDOSourceHeadersAsync,
  createDOToDoHeaders,
} from '@dotdo/rpc/do-signing'
