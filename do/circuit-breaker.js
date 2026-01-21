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
export class CircuitBreaker {
    state = 'closed';
    config;
    stats;
    latencies = [];
    maxLatencySamples = 100;
    constructor(config) {
        this.config = {
            name: config.name,
            failureThreshold: config.failureThreshold ?? 5,
            resetTimeoutMs: config.resetTimeoutMs ?? 30000,
            successThreshold: config.successThreshold ?? 3,
            timeoutMs: config.timeoutMs ?? 10000,
            halfOpenRequestRatio: config.halfOpenRequestRatio ?? 0.1,
            onStateChange: config.onStateChange ?? (() => { }),
            onFailure: config.onFailure ?? (() => { }),
            onSuccess: config.onSuccess ?? (() => { }),
        };
        this.stats = {
            totalRequests: 0,
            successCount: 0,
            failureCount: 0,
            rejectedCount: 0,
            timeoutCount: 0,
            consecutiveFailures: 0,
            consecutiveSuccesses: 0,
            lastFailureTime: null,
            lastSuccessTime: null,
            circuitOpenedAt: null,
            avgLatencyMs: 0,
            p95LatencyMs: 0,
            state: 'closed',
        };
    }
    /**
     * Get the current circuit state
     */
    getState() {
        return this.state;
    }
    /**
     * Get current circuit statistics
     */
    getStats() {
        return { ...this.stats, state: this.state };
    }
    /**
     * Get the circuit breaker name
     */
    getName() {
        return this.config.name;
    }
    /**
     * Check if the circuit is allowing requests
     */
    isAllowingRequests() {
        this.checkStateTransition();
        return this.state === 'closed' || (this.state === 'half_open' && this.shouldAllowHalfOpenRequest());
    }
    /**
     * Execute an operation with circuit breaker protection
     *
     * @param operation - The operation to execute
     * @param fallback - Optional fallback to use when circuit is open or operation fails
     * @returns Result indicating success/failure with value or error
     */
    async execute(operation, fallback) {
        this.stats.totalRequests++;
        this.checkStateTransition();
        // Check if circuit is open
        if (this.state === 'open') {
            this.stats.rejectedCount++;
            return this.handleRejection(fallback);
        }
        // In half-open state, only allow a percentage of requests through
        if (this.state === 'half_open' && !this.shouldAllowHalfOpenRequest()) {
            this.stats.rejectedCount++;
            return this.handleRejection(fallback);
        }
        // Execute the operation with timeout
        const startTime = Date.now();
        try {
            const result = await this.executeWithTimeout(operation);
            const latencyMs = Date.now() - startTime;
            this.recordSuccess(latencyMs);
            return { success: true, value: result, latencyMs };
        }
        catch (error) {
            const latencyMs = Date.now() - startTime;
            const err = error instanceof Error ? error : new Error(String(error));
            // Check if it was a timeout
            if (err.message === 'Circuit breaker timeout') {
                this.stats.timeoutCount++;
            }
            this.recordFailure(err);
            return this.handleFailure(err, fallback);
        }
    }
    /**
     * Force the circuit to open (useful for maintenance or known outages)
     */
    forceOpen() {
        this.transitionTo('open');
    }
    /**
     * Force the circuit to close (useful for testing or manual recovery)
     */
    forceClose() {
        this.transitionTo('closed');
        this.stats.consecutiveFailures = 0;
        this.stats.consecutiveSuccesses = 0;
    }
    /**
     * Reset the circuit breaker to initial state
     */
    reset() {
        this.state = 'closed';
        this.stats = {
            totalRequests: 0,
            successCount: 0,
            failureCount: 0,
            rejectedCount: 0,
            timeoutCount: 0,
            consecutiveFailures: 0,
            consecutiveSuccesses: 0,
            lastFailureTime: null,
            lastSuccessTime: null,
            circuitOpenedAt: null,
            avgLatencyMs: 0,
            p95LatencyMs: 0,
            state: 'closed',
        };
        this.latencies = [];
    }
    /**
     * Execute operation with timeout
     */
    async executeWithTimeout(operation) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Circuit breaker timeout'));
            }, this.config.timeoutMs);
            operation()
                .then((result) => {
                clearTimeout(timeoutId);
                resolve(result);
            })
                .catch((error) => {
                clearTimeout(timeoutId);
                reject(error);
            });
        });
    }
    /**
     * Check and perform state transitions based on timing
     */
    checkStateTransition() {
        if (this.state === 'open' && this.stats.circuitOpenedAt) {
            const timeSinceOpen = Date.now() - this.stats.circuitOpenedAt;
            if (timeSinceOpen >= this.config.resetTimeoutMs) {
                this.transitionTo('half_open');
            }
        }
    }
    /**
     * Transition to a new state
     */
    transitionTo(newState) {
        if (this.state !== newState) {
            const oldState = this.state;
            this.state = newState;
            if (newState === 'open') {
                this.stats.circuitOpenedAt = Date.now();
            }
            else if (newState === 'closed') {
                this.stats.circuitOpenedAt = null;
            }
            this.config.onStateChange(this.config.name, oldState, newState);
        }
    }
    /**
     * Record a successful operation
     */
    recordSuccess(latencyMs) {
        this.stats.successCount++;
        this.stats.consecutiveSuccesses++;
        this.stats.consecutiveFailures = 0;
        this.stats.lastSuccessTime = Date.now();
        // Update latency tracking
        this.latencies.push(latencyMs);
        if (this.latencies.length > this.maxLatencySamples) {
            this.latencies.shift();
        }
        this.updateLatencyStats();
        this.config.onSuccess(this.config.name, latencyMs, this.getStats());
        // In half-open state, check if we should close the circuit
        if (this.state === 'half_open' && this.stats.consecutiveSuccesses >= this.config.successThreshold) {
            this.transitionTo('closed');
        }
    }
    /**
     * Record a failed operation
     */
    recordFailure(error) {
        this.stats.failureCount++;
        this.stats.consecutiveFailures++;
        this.stats.consecutiveSuccesses = 0;
        this.stats.lastFailureTime = Date.now();
        this.config.onFailure(this.config.name, error, this.getStats());
        // Check if we should open the circuit
        if (this.state === 'closed' && this.stats.consecutiveFailures >= this.config.failureThreshold) {
            this.transitionTo('open');
        }
        // In half-open state, any failure opens the circuit again
        if (this.state === 'half_open') {
            this.transitionTo('open');
        }
    }
    /**
     * Determine if a request should be allowed in half-open state
     */
    shouldAllowHalfOpenRequest() {
        return Math.random() < this.config.halfOpenRequestRatio;
    }
    /**
     * Handle a rejected request (circuit open)
     */
    async handleRejection(fallback) {
        if (fallback) {
            try {
                const value = await fallback();
                return { success: false, error: new Error('Circuit open'), rejected: true, fallbackUsed: true };
            }
            catch {
                return { success: false, error: new Error('Circuit open and fallback failed'), rejected: true, fallbackUsed: false };
            }
        }
        return { success: false, error: new Error('Circuit open'), rejected: true, fallbackUsed: false };
    }
    /**
     * Handle a failed operation
     */
    async handleFailure(error, fallback) {
        if (fallback) {
            try {
                await fallback();
                return { success: false, error, rejected: false, fallbackUsed: true };
            }
            catch {
                return { success: false, error, rejected: false, fallbackUsed: false };
            }
        }
        return { success: false, error, rejected: false, fallbackUsed: false };
    }
    /**
     * Update latency statistics
     */
    updateLatencyStats() {
        if (this.latencies.length === 0) {
            this.stats.avgLatencyMs = 0;
            this.stats.p95LatencyMs = 0;
            return;
        }
        const sum = this.latencies.reduce((a, b) => a + b, 0);
        this.stats.avgLatencyMs = sum / this.latencies.length;
        const sorted = [...this.latencies].sort((a, b) => a - b);
        const p95Index = Math.floor(sorted.length * 0.95);
        this.stats.p95LatencyMs = sorted[p95Index] ?? sorted[sorted.length - 1] ?? 0;
    }
}
/**
 * Circuit breaker registry for managing multiple circuits
 */
export class CircuitBreakerRegistry {
    circuits = new Map();
    defaultConfig;
    constructor(defaultConfig = {}) {
        this.defaultConfig = defaultConfig;
    }
    /**
     * Get or create a circuit breaker for a name
     */
    get(name, config) {
        let circuit = this.circuits.get(name);
        if (!circuit) {
            circuit = new CircuitBreaker({
                ...this.defaultConfig,
                ...config,
                name,
            });
            this.circuits.set(name, circuit);
        }
        return circuit;
    }
    /**
     * Check if a circuit exists
     */
    has(name) {
        return this.circuits.has(name);
    }
    /**
     * Remove a circuit breaker
     */
    remove(name) {
        return this.circuits.delete(name);
    }
    /**
     * Get all circuit names
     */
    getNames() {
        return Array.from(this.circuits.keys());
    }
    /**
     * Get stats for all circuits
     */
    getAllStats() {
        const stats = {};
        for (const [name, circuit] of this.circuits) {
            stats[name] = circuit.getStats();
        }
        return stats;
    }
    /**
     * Get circuits in a specific state
     */
    getByState(state) {
        return Array.from(this.circuits.values()).filter((c) => c.getState() === state);
    }
    /**
     * Reset all circuits
     */
    resetAll() {
        for (const circuit of this.circuits.values()) {
            circuit.reset();
        }
    }
    /**
     * Clear all circuits
     */
    clear() {
        this.circuits.clear();
    }
}
/**
 * Create a circuit breaker instance
 */
export function createCircuitBreaker(config) {
    return new CircuitBreaker(config);
}
/**
 * Create a circuit breaker registry with default configuration
 */
export function createCircuitBreakerRegistry(defaultConfig) {
    return new CircuitBreakerRegistry(defaultConfig);
}
/**
 * AsyncLocalStorage instance for circuit breaker context - lazily initialized.
 */
let circuitBreakerALS = null;
// Lazy initialization to avoid issues in environments without AsyncLocalStorage
async function getCircuitBreakerALS() {
    if (!circuitBreakerALS) {
        try {
            // Try dynamic import for Node.js/Workers environments
            const moduleName = 'node:async_hooks';
            const asyncHooks = await import(moduleName);
            if (typeof asyncHooks?.AsyncLocalStorage !== 'function') {
                throw new Error('AsyncLocalStorage not available');
            }
            circuitBreakerALS = new asyncHooks.AsyncLocalStorage();
        }
        catch {
            // Fallback: Simple stack-based implementation for non-ALS environments
            const contextStack = [];
            circuitBreakerALS = {
                run(store, callback) {
                    contextStack.push(store);
                    const result = callback();
                    const isPromiseLike = (val) => val !== null &&
                        typeof val === 'object' &&
                        typeof val.then === 'function';
                    if (isPromiseLike(result)) {
                        const resultPromise = Promise.resolve(result).finally(() => {
                            contextStack.pop();
                        });
                        return resultPromise;
                    }
                    contextStack.pop();
                    return result;
                },
                getStore() {
                    return contextStack[contextStack.length - 1];
                },
            };
        }
    }
    return circuitBreakerALS;
}
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
export async function runWithCircuitBreakerRegistry(fn, config) {
    const registry = new CircuitBreakerRegistry(config);
    const als = await getCircuitBreakerALS();
    try {
        return await als.run(registry, fn);
    }
    finally {
        // Clear the registry to release resources
        registry.clear();
    }
}
/**
 * Get the current circuit breaker registry from the request context.
 * Returns undefined if not running within runWithCircuitBreakerRegistry().
 *
 * @returns The current CircuitBreakerRegistry or undefined
 */
export function getCurrentCircuitBreakerRegistry() {
    if (!circuitBreakerALS) {
        return undefined;
    }
    return circuitBreakerALS.getStore();
}
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
export function getCircuitBreaker(name, config) {
    const registry = getCurrentCircuitBreakerRegistry();
    if (registry) {
        return registry.get(name, config);
    }
    // Fall back to global registry for backward compatibility (deprecated path)
    return getGlobalCircuitBreakerRegistry().get(name, config);
}
// ============================================================================
// Global Circuit Breaker Registry (DEPRECATED - do-wffs)
// ============================================================================
// DEPRECATED: The global registry pattern causes state leakage between
// requests/tenants. Use runWithCircuitBreakerRegistry() for proper isolation.
//
// Migration guide:
// 1. Wrap request handlers with runWithCircuitBreakerRegistry()
// 2. Use getCurrentCircuitBreakerRegistry() or getCircuitBreaker() to get circuits
// 3. Circuits will be automatically isolated per request
/**
 * Global circuit breaker registry singleton.
 *
 * @deprecated **DO NOT USE** - Global registry causes tenant state leakage in multi-tenant environments.
 *
 * ## Why this is deprecated
 * The global registry shares circuit breaker state across all requests and tenants,
 * which can lead to:
 * - Tenant A's failures affecting Tenant B's circuit state
 * - Memory leaks from accumulated circuit breakers
 * - Unpredictable behavior in high-concurrency scenarios
 *
 * ## Migration Guide
 *
 * **Before (deprecated):**
 * ```ts
 * const registry = getGlobalCircuitBreakerRegistry()
 * const circuit = registry.get('my-service')
 * ```
 *
 * **After (request-scoped):**
 * ```ts
 * // In middleware - wrap request handling
 * await runWithCircuitBreakerRegistry(async () => {
 *   // All circuit breaker usage is isolated to this request
 *   const circuit = getCircuitBreaker('my-service')
 *   await circuit.execute(() => fetchData())
 * })
 * ```
 *
 * Or use `getCurrentCircuitBreakerRegistry()` within the scoped context.
 *
 * @see {@link runWithCircuitBreakerRegistry} - The recommended request-scoped alternative
 * @see {@link getCurrentCircuitBreakerRegistry} - Get registry within a scoped context
 * @see {@link getCircuitBreaker} - Convenience function that uses scoped registry when available
 * @internal Exported only for backward compatibility - will be removed in a future major version
 */
let globalRegistry = null;
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
export function getGlobalCircuitBreakerRegistry() {
    if (!globalRegistry) {
        globalRegistry = new CircuitBreakerRegistry();
    }
    return globalRegistry;
}
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
export function resetGlobalCircuitBreakerRegistry() {
    if (globalRegistry) {
        globalRegistry.clear();
    }
    globalRegistry = null;
}
//# sourceMappingURL=circuit-breaker.js.map