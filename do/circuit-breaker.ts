/**
 * Circuit Breaker Pattern Implementation for DO Graceful Degradation
 *
 * Implements the circuit breaker pattern to protect against cascading failures
 * when Durable Objects become unavailable or slow to respond.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit is open, requests fail fast with fallback response
 * - HALF_OPEN: Testing if service has recovered, limited requests pass through
 *
 * @module @dotdo/do/circuit-breaker
 * @stable
 * @since 1.0.0
 */

// Re-export everything from @dotdo/utils/circuit-breaker
// This consolidates the circuit breaker implementation in a single location
// while maintaining backward compatibility for @dotdo/do consumers.
export {
  // Core types
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitStats,
  type CircuitBreakerResult,

  // Core class
  CircuitBreaker,

  // Registry
  CircuitBreakerRegistry,

  // Factory functions
  createCircuitBreaker,
  createCircuitBreakerRegistry,

  // Request-scoped (recommended)
  runWithCircuitBreakerRegistry,
  getCurrentCircuitBreakerRegistry,
  getCircuitBreaker,

  // Deprecated global registry (for backward compatibility only)
  getGlobalCircuitBreakerRegistry,
  resetGlobalCircuitBreakerRegistry,
} from '@dotdo/utils'
