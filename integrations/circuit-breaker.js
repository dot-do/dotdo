/**
 * Circuit Breaker Integration for External Integrations
 *
 * Provides circuit breaker protection for third-party integrations to prevent
 * cascading failures when external services become unavailable or slow.
 *
 * Features:
 * - Per-integration failure tracking
 * - Configurable thresholds per integration
 * - Half-open state for testing recovery
 * - Automatic circuit closure on recovery
 *
 * This is a self-contained implementation that does not depend on @dotdo/do.
 *
 * @module @dotdo/integrations/circuit-breaker
 */
/**
 * Default circuit breaker configuration for integrations
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG = {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    successThreshold: 3,
    timeoutMs: 10000,
    halfOpenRequestRatio: 0.1,
    onStateChange: () => { },
    onFailure: () => { },
    onSuccess: () => { },
};
// ============================================================================
// Internal Circuit Breaker Implementation
// ============================================================================
/**
 * Internal circuit breaker implementation for integrations
 */
class IntegrationCircuitBreaker {
    name;
    state = 'closed';
    config;
    stats;
    latencies = [];
    maxLatencySamples = 100;
    constructor(name, config) {
        this.name = name;
        this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
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
    getState() {
        return this.state;
    }
    getStats() {
        return { ...this.stats, state: this.state };
    }
    getName() {
        return this.name;
    }
    isAllowingRequests() {
        this.checkStateTransition();
        return this.state === 'closed' || (this.state === 'half_open' && this.shouldAllowHalfOpenRequest());
    }
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
            const err = error instanceof Error ? error : new Error(String(error));
            // Check if it was a timeout
            if (err.message === 'Circuit breaker timeout') {
                this.stats.timeoutCount++;
            }
            this.recordFailure(err);
            return this.handleFailure(err, fallback);
        }
    }
    forceOpen() {
        this.transitionTo('open');
    }
    forceClose() {
        this.transitionTo('closed');
        this.stats.consecutiveFailures = 0;
        this.stats.consecutiveSuccesses = 0;
    }
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
    checkStateTransition() {
        if (this.state === 'open' && this.stats.circuitOpenedAt) {
            const timeSinceOpen = Date.now() - this.stats.circuitOpenedAt;
            if (timeSinceOpen >= this.config.resetTimeoutMs) {
                this.transitionTo('half_open');
            }
        }
    }
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
            this.config.onStateChange(this.name, oldState, newState);
        }
    }
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
        this.config.onSuccess(this.name, latencyMs, this.getStats());
        // In half-open state, check if we should close the circuit
        if (this.state === 'half_open' && this.stats.consecutiveSuccesses >= this.config.successThreshold) {
            this.transitionTo('closed');
        }
    }
    recordFailure(error) {
        this.stats.failureCount++;
        this.stats.consecutiveFailures++;
        this.stats.consecutiveSuccesses = 0;
        this.stats.lastFailureTime = Date.now();
        this.config.onFailure(this.name, error, this.getStats());
        // Check if we should open the circuit
        if (this.state === 'closed' && this.stats.consecutiveFailures >= this.config.failureThreshold) {
            this.transitionTo('open');
        }
        // In half-open state, any failure opens the circuit again
        if (this.state === 'half_open') {
            this.transitionTo('open');
        }
    }
    shouldAllowHalfOpenRequest() {
        return Math.random() < this.config.halfOpenRequestRatio;
    }
    async handleRejection(fallback) {
        if (fallback) {
            try {
                await fallback();
                return { success: false, error: new Error('Circuit open'), rejected: true, fallbackUsed: true };
            }
            catch {
                return { success: false, error: new Error('Circuit open and fallback failed'), rejected: true, fallbackUsed: false };
            }
        }
        return { success: false, error: new Error('Circuit open'), rejected: true, fallbackUsed: false };
    }
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
// ============================================================================
// Integration Method Wrapping
// ============================================================================
/**
 * Wraps an integration method with circuit breaker protection
 */
function wrapMethod(circuit, method, methodName) {
    return async (...args) => {
        const result = await circuit.execute(async () => method(...args), 
        // Fallback returns a circuit open error
        () => ({
            success: false,
            error: {
                code: 'CIRCUIT_OPEN',
                message: `Circuit breaker is open for method ${methodName}. Service may be unavailable.`,
                retryable: true,
            },
        }));
        if (result.success) {
            return result.value;
        }
        // If circuit is open/rejected, the fallback result is used
        if (result.rejected && result.fallbackUsed) {
            return {
                success: false,
                error: {
                    code: 'CIRCUIT_OPEN',
                    message: `Circuit breaker is open. Service may be unavailable.`,
                    retryable: true,
                },
            };
        }
        // Operation failed but circuit may still be closed
        return {
            success: false,
            error: {
                code: 'INTEGRATION_ERROR',
                message: result.error.message,
                originalError: result.error,
                retryable: true,
            },
        };
    };
}
/**
 * Create circuit breaker protected methods for an integration
 */
function createProtectedMethods(circuit, methods) {
    const protectedMethods = {};
    for (const [name, method] of Object.entries(methods)) {
        if (typeof method === 'function') {
            protectedMethods[name] = wrapMethod(circuit, method, name);
        }
    }
    return protectedMethods;
}
// ============================================================================
// Public API
// ============================================================================
/**
 * Circuit breaker protected integration wrapper
 *
 * Wraps an existing integration with circuit breaker protection for all methods.
 * Tracks failures per integration and opens circuit when threshold is reached.
 */
export class CircuitBreakerIntegration {
    circuit;
    wrappedIntegration;
    _methods;
    constructor(integration, circuitConfig) {
        this.wrappedIntegration = integration;
        this.circuit = new IntegrationCircuitBreaker(integration.name, circuitConfig ?? {});
        this._methods = createProtectedMethods(this.circuit, integration.methods);
    }
    // Delegate readonly properties
    get name() {
        return this.wrappedIntegration.name;
    }
    get version() {
        return this.wrappedIntegration.version;
    }
    get metadata() {
        return this.wrappedIntegration.metadata;
    }
    get status() {
        return this.wrappedIntegration.status;
    }
    get methods() {
        return this._methods;
    }
    // Delegate lifecycle methods
    async init(config) {
        return this.wrappedIntegration.init(config);
    }
    async shutdown() {
        return this.wrappedIntegration.shutdown?.();
    }
    async healthCheck() {
        // Check circuit state first
        if (!this.circuit.isAllowingRequests()) {
            return false;
        }
        return this.wrappedIntegration.healthCheck?.() ?? true;
    }
    // Delegate event methods
    async handleWebhook(request) {
        if (this.wrappedIntegration.handleWebhook) {
            return this.wrappedIntegration.handleWebhook(request);
        }
        return new Response('Webhooks not supported', { status: 501 });
    }
    onEvent(handler) {
        this.wrappedIntegration.onEvent?.(handler);
    }
    // Circuit breaker specific methods
    /**
     * Get the current circuit state
     */
    getCircuitState() {
        return this.circuit.getState();
    }
    /**
     * Get circuit breaker statistics
     */
    getCircuitStats() {
        return this.circuit.getStats();
    }
    /**
     * Check if the circuit is allowing requests
     */
    isCircuitAllowingRequests() {
        return this.circuit.isAllowingRequests();
    }
    /**
     * Force the circuit to open (useful for maintenance or known outages)
     */
    forceCircuitOpen() {
        this.circuit.forceOpen();
    }
    /**
     * Force the circuit to close (useful for testing or manual recovery)
     */
    forceCircuitClose() {
        this.circuit.forceClose();
    }
    /**
     * Reset the circuit breaker to initial state
     */
    resetCircuit() {
        this.circuit.reset();
    }
    /**
     * Get the underlying integration (without circuit breaker)
     */
    getUnwrappedIntegration() {
        return this.wrappedIntegration;
    }
}
/**
 * Registry for managing circuit breakers across multiple integrations
 */
export class IntegrationCircuitBreakerRegistry {
    wrappedIntegrations = new Map();
    defaultConfig;
    constructor(defaultConfig) {
        this.defaultConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...defaultConfig };
    }
    /**
     * Wrap an integration with circuit breaker protection
     */
    wrap(integration, config) {
        const mergedConfig = { ...this.defaultConfig, ...config };
        const wrapped = new CircuitBreakerIntegration(integration, mergedConfig);
        this.wrappedIntegrations.set(integration.name, wrapped);
        return wrapped;
    }
    /**
     * Get a wrapped integration by name
     */
    get(name) {
        return this.wrappedIntegrations.get(name);
    }
    /**
     * Check if an integration is wrapped
     */
    has(name) {
        return this.wrappedIntegrations.has(name);
    }
    /**
     * Remove a wrapped integration
     */
    remove(name) {
        return this.wrappedIntegrations.delete(name);
    }
    /**
     * Get all wrapped integration names
     */
    getNames() {
        return Array.from(this.wrappedIntegrations.keys());
    }
    /**
     * Get all circuit stats for all wrapped integrations
     */
    getAllCircuitStats() {
        const stats = {};
        for (const [name, wrapped] of this.wrappedIntegrations) {
            stats[name] = wrapped.getCircuitStats();
        }
        return stats;
    }
    /**
     * Get wrapped integrations by circuit state
     */
    getByCircuitState(state) {
        return Array.from(this.wrappedIntegrations.values()).filter((wrapped) => wrapped.getCircuitState() === state);
    }
    /**
     * Get integrations with open circuits (unhealthy)
     */
    getUnhealthyIntegrations() {
        return this.getByCircuitState('open');
    }
    /**
     * Get integrations in half-open state (recovering)
     */
    getRecoveringIntegrations() {
        return this.getByCircuitState('half_open');
    }
    /**
     * Get integrations with closed circuits (healthy)
     */
    getHealthyIntegrations() {
        return this.getByCircuitState('closed');
    }
    /**
     * Reset all circuit breakers
     */
    resetAll() {
        for (const wrapped of this.wrappedIntegrations.values()) {
            wrapped.resetCircuit();
        }
    }
    /**
     * Clear all wrapped integrations
     */
    clear() {
        this.wrappedIntegrations.clear();
    }
    /**
     * Get summary of circuit breaker health
     */
    getHealthSummary() {
        const healthy = this.getHealthyIntegrations().length;
        const unhealthy = this.getUnhealthyIntegrations().length;
        const recovering = this.getRecoveringIntegrations().length;
        return {
            total: this.wrappedIntegrations.size,
            healthy,
            unhealthy,
            recovering,
        };
    }
}
/**
 * Factory function to create a circuit breaker protected integration
 */
export function createCircuitBreakerIntegration(integration, config) {
    return new CircuitBreakerIntegration(integration, config);
}
/**
 * Factory function to create an integration circuit breaker registry
 */
export function createIntegrationCircuitBreakerRegistry(defaultConfig) {
    return new IntegrationCircuitBreakerRegistry(defaultConfig);
}
//# sourceMappingURL=circuit-breaker.js.map