// Cross-DO RPC - Durable Object to Durable Object communication
// Provides typed RPC between DOs with stub caching and connection pooling
// Integrates with observability context for automatic correlation ID propagation
import { RPCError, RPCErrorCode, isSerializedError, deserializeError, TransportError, NotFoundError, ValidationError } from './errors';
import { generateCorrelationId, CORRELATION_ID_HEADER, DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER } from './headers';
// Re-export for convenience
export { generateCorrelationId, CORRELATION_ID_HEADER };
export { DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER };
/**
 * Type guard to check if a value is a DurableObjectId.
 *
 * Uses multiple checks to ensure the value is a real DurableObjectId:
 * 1. Must be a non-null object
 * 2. Must have an `equals` method (unique to DurableObjectId)
 * 3. Must have a `toString` method
 * 4. Must have a `name` property (present on all DurableObjectIds)
 * 5. The `toString()` result must be a non-empty string (real IDs return hex strings)
 *
 * This is more robust than just checking for method existence, which could be
 * spoofed by any object with matching method signatures.
 */
function isDurableObjectId(id) {
    if (typeof id !== 'object' || id === null) {
        return false;
    }
    const candidate = id;
    // Check required methods exist
    if (typeof candidate.equals !== 'function' || typeof candidate.toString !== 'function') {
        return false;
    }
    // Real DurableObjectIds have a 'name' property (may be undefined but property exists)
    if (!('name' in candidate)) {
        return false;
    }
    // Additional validation: toString() should return a non-empty string
    // Real DurableObjectIds return 64-character hex strings
    try {
        const str = candidate.toString();
        if (typeof str !== 'string' || str.length === 0) {
            return false;
        }
    }
    catch {
        // If toString() throws, it's not a valid DurableObjectId
        return false;
    }
    return true;
}
/**
 * Stub cache for connection pooling
 * Caches DO stubs to avoid repeated binding.get() calls
 */
export class CrossDOStubCache {
    // Use WeakMap to track per-namespace caches
    namespaceCache = new WeakMap();
    /**
     * Get the cache for a specific namespace
     */
    getNamespaceCache(binding) {
        let cache = this.namespaceCache.get(binding);
        if (!cache) {
            cache = new Map();
            this.namespaceCache.set(binding, cache);
        }
        return cache;
    }
    /**
     * Get cache key from id
     */
    getIdKey(id) {
        return typeof id === 'string' ? id : id.toString();
    }
    /**
     * Get or create a DO stub.
     *
     * Uses a compute-if-absent pattern to prevent race conditions where multiple
     * concurrent calls might create duplicate stubs for the same ID.
     *
     * In JavaScript's single-threaded execution model, the synchronous portion
     * of this method (check + set) is atomic. However, since `binding.get()` is
     * synchronous and the cache operations are synchronous, we can safely use
     * a simple check-then-set pattern.
     *
     * The key insight is that even if multiple async operations call getStub()
     * concurrently, each synchronous execution block completes atomically.
     * The first call to complete will populate the cache, and subsequent calls
     * will find the cached value.
     */
    getStub(binding, id) {
        const cache = this.getNamespaceCache(binding);
        const idKey = this.getIdKey(id);
        // Check cache first - this is the fast path
        let existingStub = cache.get(idKey);
        if (existingStub !== undefined) {
            return existingStub;
        }
        // Create new stub - binding.get() is synchronous
        const doId = isDurableObjectId(id) ? id : binding.idFromName(id);
        const newStub = binding.get(doId);
        // Use Map's native set which is atomic in single-threaded JS
        // If another call raced and set a value between our get and set,
        // we'll overwrite it with our stub. This is safe because all stubs
        // pointing to the same DO ID are functionally equivalent.
        //
        // However, for consistency (returning the same stub instance for the
        // same ID within a cache lifetime), we do a final check and prefer
        // any existing stub that may have been set by a racing call.
        existingStub = cache.get(idKey);
        if (existingStub !== undefined) {
            // Another call won the race - return their stub for consistency
            // Note: newStub will be garbage collected since it's not referenced
            return existingStub;
        }
        // We won the race - store and return our stub
        cache.set(idKey, newStub);
        return newStub;
    }
    /**
     * Clear all cached stubs across all namespaces
     */
    clear() {
        // WeakMap doesn't have a clear method, so we need to track namespaces
        // For now, just create a new WeakMap
        this.namespaceCache = new WeakMap();
    }
    /**
     * Evict all stubs for a specific namespace
     */
    evictNamespace(binding) {
        const cache = this.namespaceCache.get(binding);
        if (cache) {
            cache.clear();
        }
    }
    /**
     * Evict a specific DO stub
     */
    evict(binding, id) {
        const cache = this.namespaceCache.get(binding);
        if (cache) {
            const idKey = this.getIdKey(id);
            cache.delete(idKey);
        }
    }
}
/**
 * Creates a typed proxy client for cross-DO RPC calls.
 *
 * This function wraps a DurableObject binding and provides a typed interface
 * for calling methods on another DO via fetch-based RPC.
 *
 * @example
 * ```typescript
 * interface CustomerDO {
 *   getBalance(): Promise<number>
 *   charge(amount: number): Promise<boolean>
 * }
 *
 * const customer = createCrossDOClient<CustomerDO>(env.Customer, 'customer-123')
 * const balance = await customer.getBalance()
 * const charged = await customer.charge(100)
 * ```
 *
 * @param binding - The DurableObjectNamespace binding
 * @param id - Either a string name or a DurableObjectId
 * @param cache - Optional stub cache for connection pooling
 * @param options - Optional RPC options including correlation ID
 * @returns A typed proxy that forwards method calls to the remote DO
 */
export function createCrossDOClient(binding, id, cache, options) {
    // Get or create stub (with optional caching)
    const stub = cache ? cache.getStub(binding, id) : (() => {
        const doId = isDurableObjectId(id) ? id : binding.idFromName(id);
        return binding.get(doId);
    })();
    const baseCorrelationId = options?.correlationId;
    const sourceDoId = options?.sourceDoId;
    return new Proxy({}, {
        get(_, prop) {
            // Don't intercept symbols or promise methods
            if (typeof prop === 'symbol') {
                return undefined;
            }
            if (prop === 'then' || prop === 'catch' || prop === 'finally') {
                return undefined;
            }
            // Special method for raw fetch access
            if (prop === 'fetch') {
                return async (url, init) => {
                    // Use provided correlation ID or generate new one
                    const correlationId = baseCorrelationId || generateCorrelationId();
                    const headers = new Headers(init?.headers);
                    headers.set(CORRELATION_ID_HEADER, correlationId);
                    // Add DO source headers for trust chain (do-nuwe)
                    if (sourceDoId) {
                        headers.set(DO_SOURCE_HEADER, 'true');
                        headers.set(DO_SOURCE_ID_HEADER, sourceDoId);
                    }
                    let response;
                    try {
                        response = await stub.fetch(url, { ...init, headers });
                    }
                    catch (error) {
                        // Handle transport-level errors (DO stub failures, network issues, etc.)
                        throw TransportError.stubFailed(error instanceof Error ? error : new Error(String(error)));
                    }
                    if (!response.ok) {
                        const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || correlationId;
                        const errorBody = await response.json().catch(() => null);
                        // If the response is a structured error, deserialize it
                        if (errorBody && isSerializedError(errorBody)) {
                            const deserializedError = deserializeError(errorBody);
                            // Add correlation ID to error details if it's an RPCError
                            if (deserializedError instanceof RPCError) {
                                throw new RPCError(deserializedError.code, deserializedError.message, { ...deserializedError.details, correlationId: responseCorrelationId });
                            }
                            throw deserializedError;
                        }
                        // Fallback: create an RPCError with the HTTP status
                        throw new RPCError(RPCErrorCode.INTERNAL_ERROR, errorBody?.message || `Cross-DO fetch error: ${response.status}`, { status: response.status, correlationId: responseCorrelationId, ...errorBody });
                    }
                    return response.json();
                };
            }
            // Return method invoker
            return async (...args) => {
                // Use provided correlation ID or generate new one
                const correlationId = baseCorrelationId || generateCorrelationId();
                // Build headers with DO source info for trust chain (do-nuwe)
                const headers = {
                    'Content-Type': 'application/json',
                    [CORRELATION_ID_HEADER]: correlationId,
                };
                if (sourceDoId) {
                    headers[DO_SOURCE_HEADER] = 'true';
                    headers[DO_SOURCE_ID_HEADER] = sourceDoId;
                }
                let response;
                try {
                    response = await stub.fetch('https://do/rpc', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ method: prop, args }),
                    });
                }
                catch (error) {
                    // Handle transport-level errors (DO stub failures, network issues, etc.)
                    throw TransportError.stubFailed(error instanceof Error ? error : new Error(String(error)));
                }
                if (!response.ok) {
                    const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || correlationId;
                    const errorBody = await response.json().catch(() => null);
                    // If the response is a structured error, deserialize it
                    if (errorBody && isSerializedError(errorBody)) {
                        const deserializedError = deserializeError(errorBody);
                        // Add correlation ID to error details if it's an RPCError
                        if (deserializedError instanceof RPCError) {
                            throw new RPCError(deserializedError.code, deserializedError.message, { ...deserializedError.details, correlationId: responseCorrelationId });
                        }
                        throw deserializedError;
                    }
                    // Fallback: create an RPCError with the HTTP status
                    throw new RPCError(RPCErrorCode.INTERNAL_ERROR, errorBody?.message || `Cross-DO RPC error: ${response.status}`, { status: response.status, correlationId: responseCorrelationId, method: prop, ...errorBody });
                }
                return response.json();
            };
        }
    });
}
/**
 * Cross-DO Context - provides $ style syntax for DO-to-DO calls
 *
 * This class provides a proxy-based API for calling methods on other DOs
 * using the familiar $.Namespace(id).method() syntax.
 *
 * @example
 * ```typescript
 * const $ = new CrossDOContext(env)
 *
 * // Call methods on other DOs
 * const balance = await $.Customer<CustomerDO>('customer-123').getBalance()
 * const status = await $.Order<OrderDO>('order-456').getStatus()
 *
 * // Broadcast to multiple DOs
 * const results = await $.Customer<CustomerDO>().broadcast(
 *   ['c1', 'c2', 'c3'],
 *   'notify',
 *   'Your order shipped!'
 * )
 *
 * // With correlation ID for request tracing
 * const $traced = new CrossDOContext(env, { correlationId: 'request-123' })
 * await $traced.Customer<CustomerDO>('customer-456').getBalance()
 * ```
 */
export class CrossDOContext {
    cache;
    env;
    correlationId;
    sourceDoId;
    constructor(env, options) {
        this.env = env;
        this.cache = new CrossDOStubCache();
        if (options?.correlationId !== undefined) {
            this.correlationId = options.correlationId;
        }
        if (options?.sourceDoId !== undefined) {
            this.sourceDoId = options.sourceDoId;
        }
        // Return proxy for namespace access
        return new Proxy(this, {
            get(target, namespace) {
                if (typeof namespace === 'symbol') {
                    return undefined;
                }
                // Pass through internal properties
                if (namespace in target) {
                    return target[namespace];
                }
                // Return namespace accessor
                return target.getNamespaceAccessor(namespace);
            }
        });
    }
    /**
     * Get accessor for a specific DO namespace
     */
    getNamespaceAccessor(namespace) {
        const binding = this.env[namespace];
        if (!binding) {
            throw NotFoundError.forResource('DONamespace', namespace);
        }
        const cache = this.cache;
        const contextCorrelationId = this.correlationId;
        const contextSourceDoId = this.sourceDoId;
        // Return a function that creates typed DO clients
        return (id) => {
            if (!id) {
                // No id provided - return broadcast helper
                return {
                    broadcast: async (ids, method, ...args) => {
                        // Use context correlation ID or generate a shared one for the broadcast
                        const correlationId = contextCorrelationId || generateCorrelationId();
                        const options = {
                            correlationId,
                            sourceDoId: contextSourceDoId,
                        };
                        const promises = ids.map(async (doId) => {
                            const client = createCrossDOClient(binding, doId, cache, options);
                            // Access the method using keyof T - client is typed as T
                            const methodFn = client[method];
                            if (typeof methodFn !== 'function') {
                                throw ValidationError.forField('method', `${String(method)} is not a function`);
                            }
                            // Cast to callable function type for proper invocation
                            return methodFn(...args);
                        });
                        // Cast Promise.all result to match the declared return type
                        return Promise.all(promises);
                    }
                };
            }
            // Create options with correlation ID and source DO ID if available
            const options = {};
            if (contextCorrelationId) {
                options.correlationId = contextCorrelationId;
            }
            if (contextSourceDoId) {
                options.sourceDoId = contextSourceDoId;
            }
            return createCrossDOClient(binding, id, cache, Object.keys(options).length > 0 ? options : undefined);
        };
    }
    /**
     * Clear all cached stubs
     */
    clearCache() {
        this.cache.clear();
    }
    /**
     * Evict cached stubs for a namespace
     */
    evictNamespace(namespace) {
        const binding = this.env[namespace];
        if (binding) {
            this.cache.evictNamespace(binding);
        }
    }
}
//# sourceMappingURL=cross-do.js.map