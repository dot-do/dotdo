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
/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half_open';
/**
 * Configuration for a circuit breaker instance
 */
export interface CircuitBreakerConfig {
    /** Name/identifier for this circuit (e.g., DO namespace) */
    name: string;
    /** Number of failures before opening the circuit (default: 5) */
    failureThreshold?: number;
    /** Time in ms to wait before transitioning from OPEN to HALF_OPEN (default: 30000) */
    resetTimeoutMs?: number;
    /** Number of successful requests in HALF_OPEN needed to close circuit (default: 3) */
    successThreshold?: number;
    /** Request timeout in ms - requests taking longer count as failures (default: 10000) */
    timeoutMs?: number;
    /** Percentage of requests to allow in HALF_OPEN state (default: 0.1 = 10%) */
    halfOpenRequestRatio?: number;
    /** Called when circuit state changes */
    onStateChange?: (name: string, fromState: CircuitState, toState: CircuitState) => void;
    /** Called on each failure */
    onFailure?: (name: string, error: Error, stats: CircuitStats) => void;
    /** Called on each success */
    onSuccess?: (name: string, latencyMs: number, stats: CircuitStats) => void;
}
/**
 * Statistics tracked by the circuit breaker
 */
export interface CircuitStats {
    /** Total number of requests */
    totalRequests: number;
    /** Number of successful requests */
    successCount: number;
    /** Number of failed requests */
    failureCount: number;
    /** Number of requests rejected due to open circuit */
    rejectedCount: number;
    /** Number of timeout failures */
    timeoutCount: number;
    /** Current consecutive failure count */
    consecutiveFailures: number;
    /** Current consecutive success count */
    consecutiveSuccesses: number;
    /** Last failure time */
    lastFailureTime: number | null;
    /** Last success time */
    lastSuccessTime: number | null;
    /** Time circuit was opened */
    circuitOpenedAt: number | null;
    /** Average latency of successful requests (ms) */
    avgLatencyMs: number;
    /** 95th percentile latency (ms) */
    p95LatencyMs: number;
    /** Current state */
    state: CircuitState;
}
/**
 * Result of a circuit breaker execution
 */
export type CircuitBreakerResult<T> = {
    success: true;
    value: T;
    latencyMs: number;
    fromCache?: boolean;
} | {
    success: false;
    error: Error;
    rejected: boolean;
    fallbackUsed: boolean;
};
/**
 * CircuitBreaker - Protects against cascading failures
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({
 *   name: 'customer-do',
 *   failureThreshold: 5,
 *   resetTimeoutMs: 30000,
 * })
 *
 * // Execute with circuit breaker protection
 * const result = await breaker.execute(
 *   () => stub.fetch(request),
 *   () => new Response(JSON.stringify({ error: 'Service unavailable' }), { status: 503 })
 * )
 *
 * if (result.success) {
 *   return result.value
 * } else if (result.fallbackUsed) {
 *   return result.error // This is actually the fallback response
 * }
 * ```
 */
export declare class CircuitBreaker {
    private state;
    private config;
    private stats;
    private latencies;
    private readonly maxLatencySamples;
    constructor(config: CircuitBreakerConfig);
    /**
     * Get the current circuit state
     */
    getState(): CircuitState;
    /**
     * Get current circuit statistics
     */
    getStats(): CircuitStats;
    /**
     * Get the circuit breaker name
     */
    getName(): string;
    /**
     * Check if the circuit is allowing requests
     */
    isAllowingRequests(): boolean;
    /**
     * Execute an operation with circuit breaker protection
     *
     * @param operation - The operation to execute
     * @param fallback - Optional fallback to use when circuit is open or operation fails
     * @returns Result indicating success/failure with value or error
     */
    execute<T>(operation: () => Promise<T>, fallback?: () => T | Promise<T>): Promise<CircuitBreakerResult<T>>;
    /**
     * Force the circuit to open (useful for maintenance or known outages)
     */
    forceOpen(): void;
    /**
     * Force the circuit to close (useful for testing or manual recovery)
     */
    forceClose(): void;
    /**
     * Reset the circuit breaker to initial state
     */
    reset(): void;
    /**
     * Execute operation with timeout
     */
    private executeWithTimeout;
    /**
     * Check and perform state transitions based on timing
     */
    private checkStateTransition;
    /**
     * Transition to a new state
     */
    private transitionTo;
    /**
     * Record a successful operation
     */
    private recordSuccess;
    /**
     * Record a failed operation
     */
    private recordFailure;
    /**
     * Determine if a request should be allowed in half-open state
     */
    private shouldAllowHalfOpenRequest;
    /**
     * Handle a rejected request (circuit open)
     */
    private handleRejection;
    /**
     * Handle a failed operation
     */
    private handleFailure;
    /**
     * Update latency statistics
     */
    private updateLatencyStats;
}
/**
 * Circuit breaker registry for managing multiple circuits
 */
export declare class CircuitBreakerRegistry {
    private circuits;
    private defaultConfig;
    constructor(defaultConfig?: Partial<CircuitBreakerConfig>);
    /**
     * Get or create a circuit breaker for a name
     */
    get(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker;
    /**
     * Check if a circuit exists
     */
    has(name: string): boolean;
    /**
     * Remove a circuit breaker
     */
    remove(name: string): boolean;
    /**
     * Get all circuit names
     */
    getNames(): string[];
    /**
     * Get stats for all circuits
     */
    getAllStats(): Record<string, CircuitStats>;
    /**
     * Get circuits in a specific state
     */
    getByState(state: CircuitState): CircuitBreaker[];
    /**
     * Reset all circuits
     */
    resetAll(): void;
    /**
     * Clear all circuits
     */
    clear(): void;
}
/**
 * Create a circuit breaker instance
 */
export declare function createCircuitBreaker(config: CircuitBreakerConfig): CircuitBreaker;
/**
 * Create a circuit breaker registry with default configuration
 */
export declare function createCircuitBreakerRegistry(defaultConfig?: Partial<CircuitBreakerConfig>): CircuitBreakerRegistry;
/**
 * Run a function with a circuit breaker registry scoped to this request.
 *
 * @param fn - The async function to run with the scoped registry
 * @param config - Optional default configuration for circuit breakers
 * @returns The result of the function
 *
 * @example
 * ```ts
 * // In middleware - ensures tenant isolation
 * app.use(async (c, next) => {
 *   await runWithCircuitBreakerRegistry(async () => {
 *     await next()
 *   })
 * })
 *
 * // In handler - circuits are isolated per request
 * const circuit = getCircuitBreaker('customer-service')
 * await circuit.execute(() => fetchCustomer(id))
 * ```
 */
export declare function runWithCircuitBreakerRegistry<T>(fn: () => Promise<T>, config?: Partial<CircuitBreakerConfig>): Promise<T>;
/**
 * Get the current circuit breaker registry from the request context.
 * Returns undefined if not running within runWithCircuitBreakerRegistry().
 *
 * @returns The current CircuitBreakerRegistry or undefined
 */
export declare function getCurrentCircuitBreakerRegistry(): CircuitBreakerRegistry | undefined;
/**
 * Get or create a circuit breaker for the given name.
 *
 * This is the recommended way to obtain circuit breakers. It automatically
 * uses the correct registry based on context:
 *
 * - **Within `runWithCircuitBreakerRegistry()`**: Returns a circuit from the
 *   request-scoped registry, ensuring tenant isolation.
 * - **Outside any context**: Falls back to the deprecated global registry
 *   for backward compatibility. A console warning may be emitted in development.
 *
 * @param name - The circuit breaker name (e.g., 'customer-service', 'payment-api')
 * @param config - Optional configuration to customize the circuit breaker
 * @returns A CircuitBreaker instance
 *
 * @example
 * ```ts
 * // Recommended: Use within a scoped context
 * await runWithCircuitBreakerRegistry(async () => {
 *   const circuit = getCircuitBreaker('my-service', { failureThreshold: 3 })
 *   const result = await circuit.execute(() => fetchData())
 * })
 *
 * // The circuit breaker is automatically cleaned up when the context ends
 * ```
 *
 * @see {@link runWithCircuitBreakerRegistry} - Set up a request-scoped context
 * @see {@link getCurrentCircuitBreakerRegistry} - Get the raw registry if needed
 */
export declare function getCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker;
/**
 * Get the global circuit breaker registry singleton.
 *
 * @deprecated **DO NOT USE** - Use `runWithCircuitBreakerRegistry()` for request-scoped isolation.
 *             Will be removed in v4.0.0.
 *
 * This function returns a shared global registry that persists across all requests,
 * causing tenant state leakage. See `globalRegistry` documentation for migration guide.
 *
 * @since 1.0.0
 * @returns The global CircuitBreakerRegistry instance
 * @see {@link runWithCircuitBreakerRegistry} - The recommended alternative
 * @see {@link getCurrentCircuitBreakerRegistry} - Get registry within a scoped context
 */
export declare function getGlobalCircuitBreakerRegistry(): CircuitBreakerRegistry;
/**
 * Reset the global circuit breaker registry.
 *
 * @deprecated **DO NOT USE** - Use `runWithCircuitBreakerRegistry()` for request-scoped isolation.
 *             Will be removed in v4.0.0.
 *
 * This function clears and resets the global registry. With request-scoped registries,
 * cleanup happens automatically when the request context ends.
 *
 * @since 1.0.0
 * @see {@link runWithCircuitBreakerRegistry} - The recommended alternative
 */
export declare function resetGlobalCircuitBreakerRegistry(): void;
//# sourceMappingURL=circuit-breaker.d.ts.map