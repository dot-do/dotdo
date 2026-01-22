/**
 * Circuit Breaker for @dotdo/rpc
 *
 * Provides a simple circuit breaker implementation optimized for RPC retry patterns.
 * This is a lightweight implementation that throws on circuit open (rather than returning a result type).
 *
 * ## Canonical Implementation
 *
 * For most use cases, prefer the full-featured circuit breaker from @dotdo/utils:
 *
 * ```typescript
 * import { CircuitBreaker, getCircuitBreaker, runWithCircuitBreakerRegistry } from '@dotdo/utils/circuit-breaker'
 *
 * // Request-scoped (recommended)
 * await runWithCircuitBreakerRegistry(async () => {
 *   const circuit = getCircuitBreaker('my-service')
 *   const result = await circuit.execute(() => fetchData())
 * })
 * ```
 *
 * The @dotdo/utils implementation provides:
 * - Result type (success/failure union) instead of throwing
 * - Fallback support
 * - Latency tracking (avg, p95)
 * - Request-scoped registries via AsyncLocalStorage
 * - Callbacks (onStateChange, onSuccess, onFailure)
 *
 * This module's implementation is kept for:
 * - RetryWithCircuitBreaker class (combines retry with circuit breaker)
 * - RPC-specific use cases that prefer throw-on-open semantics
 *
 * @module @dotdo/rpc/errors/circuit-breaker
 */
import { CircuitOpenError } from './base';
import { calculateJitteredDelay } from './retry';
import { isRetryableError } from './base';
/**
 * Circuit breaker states (uppercase enum for backward compatibility)
 *
 * @remarks
 * The canonical @dotdo/utils/circuit-breaker uses lowercase string literals:
 * `'closed' | 'open' | 'half_open'`
 */
export var CircuitState;
(function (CircuitState) {
    CircuitState["CLOSED"] = "CLOSED";
    CircuitState["OPEN"] = "OPEN";
    CircuitState["HALF_OPEN"] = "HALF_OPEN";
})(CircuitState || (CircuitState = {}));
/**
 * Simple Circuit Breaker pattern implementation for RPC
 *
 * This is a lightweight implementation that:
 * - Throws CircuitOpenError when circuit is open (vs returning a result type)
 * - Has no timeout support (use RetryWithCircuitBreaker for timeout handling)
 * - Is designed to work with RetryWithCircuitBreaker
 *
 * For the full-featured implementation with fallbacks, latency tracking, and
 * request-scoped registries, use @dotdo/utils/circuit-breaker instead.
 *
 * @see {@link @dotdo/utils/circuit-breaker} for the canonical implementation
 */
export class CircuitBreaker {
    state = CircuitState.CLOSED;
    failureCount = 0;
    successCount = 0;
    consecutiveFailures = 0;
    lastFailureTime = null;
    totalRequests = 0;
    successfulRequests = 0;
    failedRequests = 0;
    failureThreshold;
    successThreshold;
    timeout;
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold ?? 5;
        this.successThreshold = options.successThreshold ?? 2;
        this.timeout = options.timeout ?? 60000;
    }
    /**
     * Execute a function with circuit breaker protection
     */
    async execute(fn) {
        this.totalRequests++;
        // Check if circuit should transition from OPEN to HALF_OPEN
        if (this.state === CircuitState.OPEN &&
            this.lastFailureTime &&
            Date.now() - this.lastFailureTime >= this.timeout) {
            this.state = CircuitState.HALF_OPEN;
            this.successCount = 0;
        }
        // Reject immediately if circuit is open
        if (this.state === CircuitState.OPEN) {
            this.failedRequests++;
            throw CircuitOpenError.withMetrics({
                consecutiveFailures: this.consecutiveFailures,
                lastFailureTime: this.lastFailureTime,
                resetTimeMs: this.timeout,
            });
        }
        try {
            const result = await fn();
            this.onSuccess();
            return result;
        }
        catch (error) {
            this.onFailure();
            throw error;
        }
    }
    /**
     * Handle successful execution
     */
    onSuccess() {
        this.successfulRequests++;
        this.consecutiveFailures = 0;
        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            if (this.successCount >= this.successThreshold) {
                this.state = CircuitState.CLOSED;
                this.failureCount = 0;
                this.successCount = 0;
            }
        }
    }
    /**
     * Handle failed execution
     */
    onFailure() {
        this.failedRequests++;
        this.failureCount++;
        this.consecutiveFailures++;
        this.lastFailureTime = Date.now();
        if (this.state === CircuitState.HALF_OPEN) {
            // Any failure in half-open reopens the circuit
            this.state = CircuitState.OPEN;
        }
        else if (this.state === CircuitState.CLOSED) {
            if (this.consecutiveFailures >= this.failureThreshold) {
                this.state = CircuitState.OPEN;
            }
        }
    }
    /**
     * Get current circuit state
     */
    getState() {
        return this.state;
    }
    /**
     * Get circuit breaker metrics
     */
    getMetrics() {
        return {
            state: this.state,
            totalRequests: this.totalRequests,
            successfulRequests: this.successfulRequests,
            failedRequests: this.failedRequests,
            consecutiveFailures: this.consecutiveFailures,
            lastFailureTime: this.lastFailureTime,
        };
    }
    /**
     * Manually reset the circuit breaker
     */
    reset() {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.consecutiveFailures = 0;
        this.lastFailureTime = null;
    }
}
/**
 * Combines retry with exponential backoff and circuit breaker patterns.
 *
 * This class provides a robust error handling strategy for distributed systems:
 * - Retries transient failures with exponential backoff and jitter
 * - Opens circuit after consecutive failures to fail fast
 * - Transitions to half-open state after timeout to test recovery
 * - Closes circuit after successful requests in half-open state
 *
 * The circuit breaker wraps the retry logic, so:
 * 1. If circuit is OPEN, requests fail immediately with CircuitOpenError
 * 2. If circuit is CLOSED or HALF_OPEN, retries are attempted
 * 3. After all retries fail, failure is recorded and circuit may open
 *
 * @example
 * ```typescript
 * const resilientClient = new RetryWithCircuitBreaker({
 *   retry: {
 *     maxRetries: 3,
 *     initialDelay: 100,
 *     maxDelay: 5000,
 *     jitter: true,
 *   },
 *   circuitBreaker: {
 *     failureThreshold: 5,
 *     successThreshold: 2,
 *     timeout: 30000, // 30 seconds
 *   },
 *   onStateChange: (state, metrics) => {
 *     console.log(`Circuit state changed to ${state}`, metrics)
 *   },
 * })
 *
 * // Use for RPC calls
 * const result = await resilientClient.execute(() => rpcClient.someMethod())
 * ```
 */
export class RetryWithCircuitBreaker {
    circuitBreaker;
    retryOptions;
    onStateChange;
    lastState = CircuitState.CLOSED;
    totalRetryAttempts = 0;
    lastRetryDelayMs = null;
    constructor(options = {}) {
        this.circuitBreaker = new CircuitBreaker(options.circuitBreaker);
        this.retryOptions = {
            maxRetries: options.retry?.maxRetries ?? 3,
            initialDelay: options.retry?.initialDelay ?? 1000,
            backoffFactor: options.retry?.backoffFactor ?? 2,
            maxDelay: options.retry?.maxDelay ?? 30000,
            jitter: options.retry?.jitter ?? 'full', // Default to 'full' jitter for distributed systems
        };
        if (options.onStateChange !== undefined) {
            this.onStateChange = options.onStateChange;
        }
    }
    /**
     * Execute a function with retry and circuit breaker protection
     */
    async execute(fn) {
        // Check for state change before execution
        this.checkStateChange();
        try {
            // Circuit breaker wraps the retry logic
            const result = await this.circuitBreaker.execute(async () => {
                return this.executeWithRetry(fn);
            });
            // Check for state change after success
            this.checkStateChange();
            return result;
        }
        catch (error) {
            // Check for state change after failure (circuit may have opened)
            this.checkStateChange();
            throw error;
        }
    }
    /**
     * Internal retry logic with exponential backoff
     */
    async executeWithRetry(fn) {
        const { maxRetries, initialDelay, backoffFactor, maxDelay, jitter } = this.retryOptions;
        let lastError;
        let attempt = 0;
        let previousDelay = initialDelay;
        while (attempt <= maxRetries) {
            try {
                const result = await fn();
                // Check for state change after success
                this.checkStateChange();
                return result;
            }
            catch (error) {
                lastError = error;
                attempt++;
                this.totalRetryAttempts++;
                // Don't retry if not retryable or if we've exhausted retries
                if (!isRetryableError(error) || attempt > maxRetries) {
                    // Check for state change after final failure
                    this.checkStateChange();
                    throw error;
                }
                // Calculate base delay with exponential backoff
                const baseDelay = Math.min(initialDelay * Math.pow(backoffFactor, attempt - 1), maxDelay);
                // Apply jitter strategy to prevent thundering herd
                const delay = calculateJitteredDelay(baseDelay, jitter, initialDelay, previousDelay);
                previousDelay = delay > 0 ? delay : initialDelay;
                this.lastRetryDelayMs = delay;
                // Wait before retrying
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
        throw lastError;
    }
    /**
     * Check and notify state changes
     */
    checkStateChange() {
        const currentState = this.circuitBreaker.getState();
        if (currentState !== this.lastState) {
            this.lastState = currentState;
            this.onStateChange?.(currentState, this.circuitBreaker.getMetrics());
        }
    }
    /**
     * Get current circuit state
     */
    getState() {
        return this.circuitBreaker.getState();
    }
    /**
     * Get combined metrics
     */
    getMetrics() {
        return {
            ...this.circuitBreaker.getMetrics(),
            totalRetryAttempts: this.totalRetryAttempts,
            lastRetryDelayMs: this.lastRetryDelayMs,
        };
    }
    /**
     * Manually reset the circuit breaker and retry metrics
     */
    reset() {
        this.circuitBreaker.reset();
        this.totalRetryAttempts = 0;
        this.lastRetryDelayMs = null;
        this.lastState = CircuitState.CLOSED;
    }
    /**
     * Check if circuit is currently allowing requests
     */
    isAllowingRequests() {
        const state = this.circuitBreaker.getState();
        return state === CircuitState.CLOSED || state === CircuitState.HALF_OPEN;
    }
}
//# sourceMappingURL=circuit-breaker.js.map