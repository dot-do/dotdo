// Typed RPC Client - provides full type inference for DO method calls
// Uses TypeScript utility types to infer methods, parameters, and return types from DO classes
import { generateCorrelationId, CORRELATION_ID_HEADER } from './headers';
import { deserializeError, isRPCError, InternalError } from './errors';
/**
 * Internal helper to make RPC calls via a DO stub
 */
async function invokeViaStub(stub, method, args, options) {
    const correlationId = options.correlationId || generateCorrelationId();
    const timeout = options.timeout ?? 30000;
    const headers = {
        'Content-Type': 'application/json',
        [CORRELATION_ID_HEADER]: correlationId,
        ...options.headers,
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await stub.fetch('https://do/rpc', {
            method: 'POST',
            headers,
            body: JSON.stringify({ method, args }),
            signal: controller.signal,
        });
        if (!response.ok) {
            const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || correlationId;
            // Try to parse the structured error response
            try {
                const errorBody = (await response.json());
                if (errorBody.code && errorBody.message) {
                    throw deserializeError(errorBody);
                }
            }
            catch (e) {
                // If it's already an RPCError from deserialization, re-throw it
                if (isRPCError(e)) {
                    throw e;
                }
            }
            // Fallback to typed error with correlation context
            throw new InternalError(`DO RPC error: ${response.status}`, { correlationId: responseCorrelationId });
        }
        return response.json();
    }
    finally {
        clearTimeout(timeoutId);
    }
}
/**
 * Internal helper to make RPC calls via fetch
 */
async function invokeViaFetch(url, methodPath, args, options) {
    const method = methodPath.join('.');
    const correlationId = options.correlationId || generateCorrelationId();
    const timeout = options.timeout ?? 30000;
    const headers = {
        'Content-Type': 'application/json',
        [CORRELATION_ID_HEADER]: correlationId,
        ...options.headers,
    };
    const response = await fetch(`${url}/rpc`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method, args }),
        signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
        const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || correlationId;
        // Try to parse the structured error response
        try {
            const errorBody = (await response.json());
            if (errorBody.code && errorBody.message) {
                throw deserializeError(errorBody);
            }
        }
        catch (e) {
            // If it's already an RPCError from deserialization, re-throw it
            if (isRPCError(e)) {
                throw e;
            }
        }
        // Fallback to typed error with correlation context
        throw new InternalError(`RPC error: ${response.status}`, { correlationId: responseCorrelationId });
    }
    return response.json();
}
/**
 * Creates a nested proxy for property path tracking (for nested APIs)
 *
 * @typeParam T - The expected type at this point in the path
 */
function createNestedProxyForFetch(url, path, options) {
    // Use a typed proxy target that can be both accessed as an object and called as a function
    const proxyTarget = Object.assign((() => undefined), {});
    return new Proxy(proxyTarget, {
        get(_target, prop) {
            // Don't intercept symbols or promise methods
            if (typeof prop === 'symbol')
                return undefined;
            if (prop === 'then' || prop === 'catch' || prop === 'finally')
                return undefined;
            return createNestedProxyForFetch(url, [...path, prop], options);
        },
        apply(_target, _thisArg, args) {
            // Build options object without undefined values (for exactOptionalPropertyTypes)
            const invokeOptions = {};
            if (options.timeout !== undefined)
                invokeOptions.timeout = options.timeout;
            if (options.correlationId !== undefined)
                invokeOptions.correlationId = options.correlationId;
            return invokeViaFetch(url, path, args, invokeOptions);
        },
    });
}
/**
 * Creates a typed RPC client from a DurableObjectStub.
 *
 * This function provides full type inference for:
 * - Available method names (autocomplete in IDE)
 * - Method parameter types
 * - Method return types
 *
 * The client infers methods directly from the DO class type parameter,
 * providing compile-time type safety for all RPC calls.
 *
 * @example
 * ```typescript
 * // Define your DO with typed methods
 * class CustomerDO {
 *   async getProfile(id: string): Promise<Profile> { ... }
 *   async updateEmail(id: string, email: string): Promise<void> { ... }
 *   async listOrders(limit?: number): Promise<Order[]> { ... }
 * }
 *
 * // Get the stub
 * const stub = env.CUSTOMER.get(env.CUSTOMER.idFromName('customer-123'))
 *
 * // Create typed client - methods are inferred from CustomerDO
 * const client = createTypedClient<CustomerDO>(stub)
 *
 * // All calls are fully typed:
 * const profile = await client.getProfile('123')        // Returns Profile
 * await client.updateEmail('123', 'new@email.com')      // Type-checked params
 * const orders = await client.listOrders(10)            // Returns Order[]
 *
 * // TypeScript errors on invalid calls:
 * await client.getProfile()                   // Error: missing argument
 * await client.updateEmail('123', 42)         // Error: number is not string
 * await client.nonExistent()                  // Error: method doesn't exist
 * ```
 *
 * @param stub - The DurableObjectStub to wrap
 * @param options - Optional configuration (timeout, correlationId)
 * @returns A typed proxy client with full method inference
 */
export function createTypedClient(stub, options = {}) {
    const { timeout = 30000, correlationId: baseCorrelationId } = options;
    // Create the $call function for making calls with options
    const $call = async (method, args, callOptions) => {
        // Build options object without undefined values (for exactOptionalPropertyTypes)
        const invokeOptions = {
            timeout: callOptions?.timeout ?? timeout,
        };
        const effectiveCorrelationId = callOptions?.correlationId ?? baseCorrelationId;
        if (effectiveCorrelationId !== undefined)
            invokeOptions.correlationId = effectiveCorrelationId;
        if (callOptions?.headers !== undefined)
            invokeOptions.headers = callOptions.headers;
        return invokeViaStub(stub, method, args, invokeOptions);
    };
    // Create the proxy for method calls
    return new Proxy({}, {
        get(_target, prop) {
            // Don't intercept symbols or promise methods
            if (typeof prop === 'symbol')
                return undefined;
            if (prop === 'then' || prop === 'catch' || prop === 'finally')
                return undefined;
            // Handle special $call method
            if (prop === '$call')
                return $call;
            // Handle special $stub property
            if (prop === '$stub')
                return stub;
            // Return method invoker
            return async (...args) => {
                // Build options object without undefined values (for exactOptionalPropertyTypes)
                const invokeOptions = { timeout };
                if (baseCorrelationId !== undefined)
                    invokeOptions.correlationId = baseCorrelationId;
                return invokeViaStub(stub, prop, args, invokeOptions);
            };
        },
    });
}
/**
 * Creates a typed RPC client from a URL endpoint.
 *
 * This is useful for client-side applications that need to call
 * remote RPC endpoints over HTTP.
 *
 * @example
 * ```typescript
 * interface MyAPI {
 *   users: {
 *     create(data: UserData): Promise<User>
 *     get(id: string): Promise<User>
 *   }
 *   posts: {
 *     list(limit?: number): Promise<Post[]>
 *   }
 * }
 *
 * const client = createTypedClientFromUrl<MyAPI>('https://api.example.com')
 *
 * const user = await client.users.create({ name: 'Alice' })
 * const posts = await client.posts.list(10)
 * ```
 *
 * @param url - The base URL for RPC endpoints
 * @param options - Optional configuration (timeout, correlationId)
 * @returns A typed proxy client with full method inference
 */
export function createTypedClientFromUrl(url, options = {}) {
    return createNestedProxyForFetch(url, [], { ...options, url });
}
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
 * Creates a typed RPC client from a DurableObjectNamespace binding.
 *
 * This is a convenience function that combines getting the stub and
 * creating the typed client in one step.
 *
 * @example
 * ```typescript
 * class CustomerDO {
 *   async getProfile(): Promise<Profile> { ... }
 *   async charge(amount: number): Promise<Receipt> { ... }
 * }
 *
 * // In a Worker
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const customer = createTypedClientFromBinding<CustomerDO>(
 *       env.CUSTOMER,
 *       'customer-123'
 *     )
 *
 *     const profile = await customer.getProfile()
 *     const receipt = await customer.charge(100)
 *
 *     return Response.json({ profile, receipt })
 *   }
 * }
 * ```
 *
 * @param binding - The DurableObjectNamespace binding
 * @param id - Either a string name or a DurableObjectId
 * @param options - Optional configuration (timeout, correlationId, sourceDoId)
 * @returns A typed proxy client with full method inference
 */
export function createTypedClientFromBinding(binding, id, options = {}) {
    const doId = isDurableObjectId(id) ? id : binding.idFromName(id);
    const stub = binding.get(doId);
    return createTypedClient(stub, options);
}
/**
 * Creates a batch caller for making multiple typed RPC calls in parallel.
 *
 * @example
 * ```typescript
 * class CustomerDO {
 *   async getProfile(id: string): Promise<Profile> {}
 *   async getOrders(id: string): Promise<Order[]> {}
 *   async getBalance(id: string): Promise<number> {}
 * }
 *
 * const client = createTypedClient<CustomerDO>(stub)
 *
 * // Make all calls in parallel
 * const [profile, orders, balance] = await batchCalls(
 *   client.getProfile('123'),
 *   client.getOrders('123'),
 *   client.getBalance('123')
 * )
 * ```
 *
 * @param calls - Array of RPC call promises
 * @returns Promise resolving to array of results
 */
export async function batchCalls(...calls) {
    return Promise.all(calls);
}
//# sourceMappingURL=typed-client.js.map