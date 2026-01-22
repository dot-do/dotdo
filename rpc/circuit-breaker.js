/**
 * Circuit Breaker Integration for Cross-DO RPC
 *
 * Wraps cross-DO RPC calls with circuit breaker protection to prevent
 * cascading failures when DOs become unavailable or slow.
 *
 * This module provides:
 * - createDOStubWithCircuitBreaker: Wraps createDOStub with circuit breaker
 * - createCrossDOClientWithCircuitBreaker: Wraps createCrossDOClient with circuit breaker
 * - CircuitBreakerRPCConfig: Configuration for circuit breaker in RPC context
 *
 * @module @dotdo/rpc/circuit-breaker
 */
import { createDOStub } from './client';
import { createCrossDOClient, CrossDOStubCache } from './cross-do';
import { getCircuitBreaker, runWithCircuitBreakerRegistry, } from '@dotdo/utils';
import { TransportError } from './errors';
export { getCircuitBreaker, runWithCircuitBreakerRegistry };
/**
 * Default circuit breaker configuration for cross-DO RPC
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG = {
    /** Open circuit after 5 consecutive failures */
    failureThreshold: 5,
    /** Wait 30 seconds before attempting half-open */
    resetTimeoutMs: 30000,
    /** Need 3 successes in half-open to close circuit */
    successThreshold: 3,
    /** Individual request timeout of 10 seconds */
    timeoutMs: 10000,
    /** Allow 10% of requests through in half-open state */
    halfOpenRequestRatio: 0.1,
};
/**
 * Get the circuit name for a DO stub
 */
function getCircuitName(binding, id, prefix = 'do-rpc') {
    const idStr = typeof id === 'string' ? id : id.toString();
    // Use a hash or truncate for very long IDs
    const shortId = idStr.length > 32 ? idStr.slice(0, 32) : idStr;
    return `${prefix}:${shortId}`;
}
/**
 * Creates a typed proxy for a Durable Object stub with circuit breaker protection.
 *
 * This wrapper adds circuit breaker protection around DO method calls to prevent
 * cascading failures when the target DO is unavailable or slow.
 *
 * @example
 * ```typescript
 * interface CounterDO {
 *   increment(): Promise<number>
 *   getValue(): Promise<number>
 * }
 *
 * // With circuit breaker (enabled by default)
 * const counter = createDOStubWithCircuitBreaker<CounterDO>(env.COUNTER, 'my-counter')
 *
 * // With custom circuit breaker config
 * const counter = createDOStubWithCircuitBreaker<CounterDO>(env.COUNTER, 'my-counter', {
 *   circuitBreaker: {
 *     failureThreshold: 3,
 *     resetTimeoutMs: 10000,
 *     fallback: () => ({ error: 'Service unavailable' })
 *   }
 * })
 *
 * // Disable circuit breaker
 * const counter = createDOStubWithCircuitBreaker<CounterDO>(env.COUNTER, 'my-counter', {
 *   circuitBreaker: { enabled: false }
 * })
 * ```
 *
 * @param binding - The DurableObjectNamespace binding
 * @param id - Either a string name or a DurableObjectId
 * @param options - Optional configuration including circuit breaker settings
 * @returns A typed proxy with circuit breaker protection
 */
export function createDOStubWithCircuitBreaker(binding, id, options) {
    const cbConfig = options?.circuitBreaker;
    const enabled = cbConfig?.enabled !== false; // Default to enabled
    // If circuit breaker is disabled, use regular createDOStub
    if (!enabled) {
        return createDOStub(binding, id, options);
    }
    // Get the circuit breaker for this DO
    const circuitName = getCircuitName(binding, id, cbConfig?.namePrefix);
    const circuit = getCircuitBreaker(circuitName, {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        ...cbConfig,
    });
    // Create the underlying stub
    const stub = createDOStub(binding, id, options);
    // Wrap with circuit breaker proxy
    // Cast needed because TypeScript can't infer that the proxy preserves the stub's type
    return new Proxy(stub, {
        get(_, prop) {
            if (typeof prop === 'symbol') {
                return undefined;
            }
            if (prop === 'then' || prop === 'catch' || prop === 'finally') {
                return undefined;
            }
            // Special property to access circuit breaker stats
            if (prop === '$circuit') {
                return {
                    getState: () => circuit.getState(),
                    getStats: () => circuit.getStats(),
                    forceOpen: () => circuit.forceOpen(),
                    forceClose: () => circuit.forceClose(),
                    reset: () => circuit.reset(),
                };
            }
            // Wrap method call with circuit breaker
            return async (...args) => {
                const result = await circuit.execute(async () => {
                    const method = stub[prop];
                    if (typeof method !== 'function') {
                        throw new Error(`Method ${prop} is not a function`);
                    }
                    return method(...args);
                }, cbConfig?.fallback);
                if (result.success) {
                    return result.value;
                }
                if (result.rejected) {
                    // Circuit is open - throw a transport error
                    throw TransportError.circuitOpen(circuitName);
                }
                // Operation failed
                throw result.error;
            };
        },
    });
}
/**
 * Creates a typed proxy for cross-DO RPC with circuit breaker protection.
 *
 * This wrapper adds circuit breaker protection around cross-DO method calls
 * to prevent cascading failures when target DOs are unavailable.
 *
 * @example
 * ```typescript
 * interface CustomerDO {
 *   getBalance(): Promise<number>
 *   charge(amount: number): Promise<boolean>
 * }
 *
 * // With circuit breaker
 * const customer = createCrossDOClientWithCircuitBreaker<CustomerDO>(
 *   env.Customer,
 *   'customer-123',
 *   undefined, // no cache
 *   {
 *     circuitBreaker: {
 *       failureThreshold: 3,
 *       resetTimeoutMs: 15000
 *     }
 *   }
 * )
 *
 * const balance = await customer.getBalance()
 * ```
 *
 * @param binding - The DurableObjectNamespace binding
 * @param id - Either a string name or a DurableObjectId
 * @param cache - Optional stub cache for connection pooling
 * @param options - Optional RPC and circuit breaker options
 * @returns A typed proxy with circuit breaker protection
 */
export function createCrossDOClientWithCircuitBreaker(binding, id, cache, options) {
    const cbConfig = options?.circuitBreaker;
    const enabled = cbConfig?.enabled !== false; // Default to enabled
    // If circuit breaker is disabled, use regular createCrossDOClient
    if (!enabled) {
        return createCrossDOClient(binding, id, cache, options);
    }
    // Get the circuit breaker for this DO
    const circuitName = getCircuitName(binding, id, cbConfig?.namePrefix);
    const circuit = getCircuitBreaker(circuitName, {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        ...cbConfig,
    });
    // Create the underlying client
    const client = createCrossDOClient(binding, id, cache, options);
    // Wrap with circuit breaker proxy
    return new Proxy({}, {
        get(_, prop) {
            if (typeof prop === 'symbol') {
                return undefined;
            }
            if (prop === 'then' || prop === 'catch' || prop === 'finally') {
                return undefined;
            }
            // Special property to access circuit breaker stats
            if (prop === '$circuit') {
                return {
                    getState: () => circuit.getState(),
                    getStats: () => circuit.getStats(),
                    forceOpen: () => circuit.forceOpen(),
                    forceClose: () => circuit.forceClose(),
                    reset: () => circuit.reset(),
                };
            }
            // Special handling for fetch method
            if (prop === 'fetch') {
                const fetchFn = client.fetch;
                return async (url, init) => {
                    const result = await circuit.execute(async () => fetchFn(url, init), cbConfig?.fallback);
                    if (result.success) {
                        return result.value;
                    }
                    if (result.rejected) {
                        throw TransportError.circuitOpen(circuitName);
                    }
                    throw result.error;
                };
            }
            // Wrap method call with circuit breaker
            return async (...args) => {
                const result = await circuit.execute(async () => {
                    const method = client[prop];
                    if (typeof method !== 'function') {
                        throw new Error(`Method ${prop} is not a function`);
                    }
                    return method(...args);
                }, cbConfig?.fallback);
                if (result.success) {
                    return result.value;
                }
                if (result.rejected) {
                    throw TransportError.circuitOpen(circuitName);
                }
                throw result.error;
            };
        },
    });
}
/**
 * Circuit breaker-aware Cross-DO Context factory
 *
 * Creates a Cross-DO context that automatically wraps all DO calls
 * with circuit breaker protection.
 *
 * @example
 * ```typescript
 * import { createCircuitBreakerContext } from '@dotdo/rpc/circuit-breaker'
 *
 * const $ = createCircuitBreakerContext(env, {
 *   failureThreshold: 3,
 *   resetTimeoutMs: 15000
 * })
 *
 * // All calls are protected by circuit breaker
 * const customer = $<CustomerDO>('Customer', 'customer-123')
 * const balance = await customer.getBalance()
 *
 * // Check circuit state
 * const state = customer.$circuit.getState()
 * ```
 */
export function createCircuitBreakerDOAccessor(env, config) {
    const cache = new CrossDOStubCache();
    return (namespace, id) => {
        const binding = env[namespace];
        if (!binding) {
            throw new Error(`DO namespace not found: ${namespace}`);
        }
        const options = config
            ? { circuitBreaker: config }
            : {};
        return createCrossDOClientWithCircuitBreaker(binding, id, cache, options);
    };
}
//# sourceMappingURL=circuit-breaker.js.map