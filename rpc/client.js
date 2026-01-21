// RPC Client - connects to Workers/DOs
// Implements typed proxy for remote method invocation via fetch-based RPC
// Supports pluggable transports for different communication backends
// Includes Cap'n Proto-style promise pipelining for efficient RPC chaining
//
// This module uses shared proxy utilities from @dotdo/utils for
// common patterns like deep nested RPC proxies.
import { deserializeError, isRPCError, TransportError, InternalError } from './errors';
import { AutoTransport } from './transport/auto';
import { PipelineBuilder } from './pipeline';
import { generateCorrelationId, CORRELATION_ID_HEADER } from './headers';
import { createDeepRPCProxy } from '@dotdo/utils';
// Re-export for backward compatibility
export { generateCorrelationId, CORRELATION_ID_HEADER };
/**
 * Handles error responses from RPC calls by parsing structured errors
 * or falling back to generic error messages.
 *
 * @param response - The HTTP response object
 * @param correlationId - The correlation ID for this request
 * @param errorPrefix - Optional prefix for the fallback error message
 * @throws Deserialized RPCError if response contains structured error
 * @throws Generic Error if response is not ok and no structured error found
 */
async function handleErrorResponse(response, correlationId, errorPrefix = 'RPC error') {
    if (!response.ok) {
        const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || correlationId;
        // Try to parse the structured error response
        try {
            const errorBody = await response.json();
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
        throw new InternalError(`${errorPrefix}: ${response.status}`, { correlationId: responseCorrelationId });
    }
}
/**
 * Internal helper to create a method invoker function
 * The generic parameter R allows the return type to flow through when known
 */
function createMethodInvoker(url, timeout, methodPath, baseCorrelationId) {
    return async (...args) => {
        const method = methodPath.join('.');
        // Generate a correlation ID for each request, or use the provided base correlation ID
        const correlationId = baseCorrelationId || generateCorrelationId();
        const response = await fetch(`${url}/rpc`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [CORRELATION_ID_HEADER]: correlationId,
            },
            body: JSON.stringify({ method, args }),
            signal: AbortSignal.timeout(timeout),
        });
        await handleErrorResponse(response, correlationId);
        return response.json();
    };
}
/**
 * Create a nested proxy that tracks the property path
 * Uses shared createDeepRPCProxy utility for consistent proxy behavior
 *
 * @typeParam T - The expected type at this point in the path (used for type inference)
 */
function createNestedProxyForFetch(url, timeout, correlationId) {
    return createDeepRPCProxy({
        invoke: async (path, args) => {
            return createMethodInvoker(url, timeout, path, correlationId)(...args);
        }
    });
}
/**
 * Creates a typed proxy client that forwards method calls via RPC.
 *
 * The client intercepts method calls and sends them as JSON-RPC requests to the
 * specified URL. It supports:
 * - Flat APIs: `client.greet('World')`
 * - Nested APIs: `client.users.create({ name: 'Alice' })`
 * - Configurable timeout via AbortSignal
 * - WebSocket-first transport with HTTP fallback (via autoUpgrade or strategy)
 *
 * @example
 * ```typescript
 * interface MyAPI {
 *   greet(name: string): Promise<string>
 *   users: {
 *     create(user: User): Promise<{ id: string }>
 *   }
 * }
 *
 * const client = createClient<MyAPI>({ url: 'https://api.example.com' })
 * const greeting = await client.greet('World')
 * const user = await client.users.create({ name: 'Alice' })
 *
 * // With WebSocket-first transport (tries WS, falls back to HTTP)
 * const wsClient = createClient<MyAPI>({
 *   url: 'https://api.example.com',
 *   autoUpgrade: true, // or strategy: 'websocket-first'
 * })
 *
 * // With explicit strategy
 * const strategyClient = createClient<MyAPI>({
 *   url: 'https://api.example.com',
 *   strategy: 'websocket-first', // Best for REPL and real-time use cases
 * })
 * ```
 *
 * @param options - Configuration options including URL and optional timeout
 * @returns A typed proxy that forwards method calls via RPC
 */
export function createClient(options) {
    const { url, timeout = 30000, correlationId, autoUpgrade, strategy, wsPath } = options;
    // Determine if we should use AutoTransport (for WebSocket support)
    // Strategy takes precedence over autoUpgrade
    const effectiveStrategy = strategy ?? (autoUpgrade ? 'websocket-first' : undefined);
    if (effectiveStrategy) {
        const transport = new AutoTransport({
            url,
            timeout,
            correlationId,
            strategy: effectiveStrategy,
            wsPath,
        });
        return createTransportNestedProxyWithShared(transport, correlationId);
    }
    // Default to simple fetch-based proxy (no WebSocket)
    return createNestedProxyForFetch(url, timeout, correlationId);
}
/**
 * Internal helper to create a method invoker for transport-based client
 * The generic parameter R allows the return type to flow through when known
 */
function createTransportMethodInvoker(transport, methodPath, baseCorrelationId) {
    return async (...args) => {
        const method = methodPath.join('.');
        const correlationId = baseCorrelationId || generateCorrelationId();
        const message = { method, args, correlationId };
        const response = await transport.send(message);
        if (response.error) {
            throw deserializeError(response.error);
        }
        return response.result;
    };
}
/**
 * Create a nested proxy that tracks the property path for transport-based client
 * Uses shared createDeepRPCProxy utility with special property support for $transport
 *
 * @typeParam T - The expected type at this point in the path (used for type inference)
 */
function createTransportNestedProxyWithShared(transport, correlationId) {
    return createDeepRPCProxy({
        invoke: async (path, args) => {
            return createTransportMethodInvoker(transport, path, correlationId)(...args);
        },
        getSpecialProperty: (prop) => {
            // Special property to access the underlying transport
            if (prop === '$transport') {
                return transport;
            }
            return undefined;
        }
    });
}
/**
 * Creates a typed proxy client that uses a transport for RPC communication.
 *
 * This is the new transport-based API that separates the transport layer
 * from the RPC protocol. Use this when you need more control over the
 * communication backend.
 *
 * @example
 * ```typescript
 * import { createClientWithTransport, FetchTransport } from '@dotdo/rpc'
 *
 * interface MyAPI {
 *   greet(name: string): Promise<string>
 *   users: {
 *     create(user: User): Promise<{ id: string }>
 *   }
 * }
 *
 * // Using fetch transport
 * const transport = new FetchTransport({ url: 'https://api.example.com' })
 * const client = createClientWithTransport<MyAPI>({ transport })
 *
 * const greeting = await client.greet('World')
 * const user = await client.users.create({ name: 'Alice' })
 *
 * // Access the underlying transport
 * const state = client.$transport.getState?.()
 * await client.$transport.close?.()
 * ```
 *
 * @param options - Configuration options including the transport
 * @returns A typed proxy that forwards method calls via the transport
 */
export function createClientWithTransport(options) {
    const { transport, correlationId } = options;
    return createTransportNestedProxyWithShared(transport, correlationId);
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
 * Creates a typed proxy for a Durable Object stub.
 *
 * This helper wraps a DurableObject binding and provides a typed interface
 * for calling methods on the DO via fetch-based RPC.
 *
 * @example
 * ```typescript
 * interface CounterDO {
 *   increment(): Promise<number>
 *   getValue(): Promise<number>
 * }
 *
 * // In a Worker
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const counter = createDOStub<CounterDO>(env.COUNTER, 'my-counter')
 *     const value = await counter.increment()
 *     return new Response(`Count: ${value}`)
 *   }
 * }
 * ```
 *
 * @param binding - The DurableObjectNamespace binding
 * @param id - Either a string name or a DurableObjectId
 * @param options - Optional configuration including correlation ID
 * @returns A typed proxy that forwards method calls to the DO
 */
export function createDOStub(binding, id, options) {
    const doId = isDurableObjectId(id) ? id : binding.idFromName(id);
    const stub = binding.get(doId);
    const baseCorrelationId = options?.correlationId;
    // Create a method invoker that preserves type inference
    const createMethodProxy = (methodName) => {
        return (async (...args) => {
            // Generate a correlation ID for each request, or use the provided base correlation ID
            const correlationId = baseCorrelationId || generateCorrelationId();
            let response;
            try {
                response = await stub.fetch('https://do/rpc', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        [CORRELATION_ID_HEADER]: correlationId,
                    },
                    body: JSON.stringify({ method: methodName, args }),
                });
            }
            catch (error) {
                // Handle transport-level errors (DO stub failures, network issues, etc.)
                throw TransportError.stubFailed(error instanceof Error ? error : new Error(String(error)));
            }
            await handleErrorResponse(response, correlationId, 'DO RPC error');
            return response.json();
        });
    };
    return new Proxy({}, {
        get(_target, prop) {
            // Don't intercept symbols or promise methods
            if (typeof prop === 'symbol') {
                return undefined;
            }
            if (prop === 'then' || prop === 'catch' || prop === 'finally') {
                return undefined;
            }
            return createMethodProxy(prop);
        }
    });
}
/**
 * Creates a secure typed proxy for DO-to-DO calls with HMAC signing.
 *
 * This version of createDOStub includes HMAC signatures in all requests,
 * which prevents header spoofing attacks. The receiving DO must have
 * DO_INTERNAL_SECRET configured and will verify the signature.
 *
 * @example
 * ```typescript
 * interface OtherDO {
 *   process(data: Data): Promise<Result>
 * }
 *
 * // In a Durable Object
 * class MyDO extends DurableObject {
 *   async doWork() {
 *     const other = createSecureDOStub<OtherDO>(
 *       this.env.OTHER_DO,
 *       'target-id',
 *       { sourceDoId: this.ctx.id.toString() }
 *     )
 *     return await other.process({ key: 'value' })
 *   }
 * }
 * ```
 *
 * @param binding - The DurableObjectNamespace binding
 * @param id - Either a string name or a DurableObjectId
 * @param options - Configuration including source DO ID for signing
 * @returns A typed proxy that forwards method calls to the DO with HMAC signing
 */
export function createSecureDOStub(binding, id, options) {
    // Lazy import to avoid circular dependencies
    let createDOToDoHeaders = null;
    const doId = isDurableObjectId(id) ? id : binding.idFromName(id);
    const stub = binding.get(doId);
    const { correlationId: baseCorrelationId, sourceDoId } = options;
    // Create a method invoker that preserves type inference
    const createMethodProxy = (methodName) => {
        return (async (...args) => {
            // Lazy load the auth module
            if (!createDOToDoHeaders) {
                const authModule = await import('../do/auth');
                createDOToDoHeaders = authModule.createDOToDoHeaders;
            }
            // Generate a correlation ID for each request, or use the provided base correlation ID
            const correlationId = baseCorrelationId || generateCorrelationId();
            // Create secure headers with HMAC signature
            const headers = await createDOToDoHeaders(sourceDoId, '/rpc', correlationId);
            let response;
            try {
                response = await stub.fetch('https://do/rpc', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ method: methodName, args }),
                });
            }
            catch (error) {
                // Handle transport-level errors (DO stub failures, network issues, etc.)
                throw TransportError.stubFailed(error instanceof Error ? error : new Error(String(error)));
            }
            await handleErrorResponse(response, correlationId, 'DO RPC error');
            return response.json();
        });
    };
    return new Proxy({}, {
        get(_target, prop) {
            // Don't intercept symbols or promise methods
            if (typeof prop === 'symbol') {
                return undefined;
            }
            if (prop === 'then' || prop === 'catch' || prop === 'finally') {
                return undefined;
            }
            return createMethodProxy(prop);
        }
    });
}
/**
 * Creates a typed proxy client with Cap'n Proto-style promise pipelining.
 *
 * This client extends the standard RPC client with a `pipeline()` method
 * that enables chaining multiple RPC calls into a single network round trip.
 *
 * @example
 * ```typescript
 * interface UserAPI {
 *   getUser(id: string): Promise<User>
 * }
 *
 * interface User {
 *   getProfile(): Promise<Profile>
 *   getOrders(): Promise<Order[]>
 * }
 *
 * const client = createClientWithPipeline<UserAPI>({ url: 'https://api.example.com' })
 *
 * // Traditional approach (2 round trips):
 * const user = await client.getUser('123')
 * // user is a plain object, no methods
 *
 * // With pipelining (1 round trip):
 * const profile = await client.pipeline('getUser', '123')
 *   .call('getProfile')
 *
 * // Chain multiple operations:
 * const avatarUrl = await client.pipeline('getUser', '123')
 *   .call('getProfile')
 *   .get('avatar')
 *   .get('url')
 * ```
 *
 * @param options - Configuration options
 * @returns A typed proxy with pipeline support
 */
export function createClientWithPipeline(options) {
    const { url, timeout = 30000, correlationId } = options;
    return new Proxy({}, {
        get(_target, prop) {
            if (typeof prop === 'symbol') {
                return undefined;
            }
            if (prop === 'then' || prop === 'catch' || prop === 'finally') {
                return undefined;
            }
            // Special pipeline method - properly typed to return PipelineBuilder with correct generic
            if (prop === 'pipeline') {
                return (method, ...args) => {
                    const pipelineOpts = { timeout };
                    if (correlationId) {
                        pipelineOpts.correlationId = correlationId;
                    }
                    return new PipelineBuilder(url, String(method), args, pipelineOpts);
                };
            }
            // Regular method - create method invoker
            return createMethodInvoker(url, timeout, [prop], correlationId);
        }
    });
}
/**
 * Creates a typed proxy for a Durable Object stub with pipeline support.
 *
 * This enables Cap'n Proto-style promise pipelining for DO-to-DO calls,
 * reducing latency by batching chained operations into single requests.
 *
 * @example
 * ```typescript
 * interface CustomerDO {
 *   getAccount(): Promise<Account>
 * }
 *
 * interface Account {
 *   getBalance(): Promise<number>
 *   getTransactions(): Promise<Transaction[]>
 * }
 *
 * const customer = createDOStubWithPipeline<CustomerDO>(env.CUSTOMER, 'cust-123')
 *
 * // With pipelining (1 round trip):
 * const balance = await customer.pipeline('getAccount').call('getBalance')
 * ```
 *
 * @param binding - The DurableObjectNamespace binding
 * @param id - Either a string name or a DurableObjectId
 * @param options - Optional configuration
 * @returns A typed proxy with pipeline support
 */
export function createDOStubWithPipeline(binding, id, options) {
    const doId = isDurableObjectId(id) ? id : binding.idFromName(id);
    const stub = binding.get(doId);
    const baseCorrelationId = options?.correlationId;
    const timeout = options?.timeout ?? 30000;
    // Create a transport-like interface for the DO stub
    const doTransport = {
        async send(message) {
            const correlationId = message.correlationId || generateCorrelationId();
            let response;
            try {
                response = await stub.fetch('https://do/rpc', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        [CORRELATION_ID_HEADER]: correlationId,
                    },
                    body: JSON.stringify({ method: message.method, args: message.args }),
                });
            }
            catch (error) {
                // Handle transport-level errors (DO stub failures, network issues, etc.)
                const transportError = TransportError.stubFailed(error instanceof Error ? error : new Error(String(error)));
                return {
                    error: {
                        code: transportError.code,
                        message: transportError.message,
                        type: transportError.name,
                    },
                    correlationId,
                };
            }
            if (!response.ok) {
                const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || correlationId;
                // Try to parse the structured error response
                try {
                    const errorBody = await response.json();
                    if (errorBody.code && errorBody.message) {
                        return { error: errorBody, correlationId: responseCorrelationId };
                    }
                }
                catch (_e) {
                    // If JSON parsing fails, fall through to generic error
                }
                // Fallback to generic error
                return {
                    error: {
                        code: 'INTERNAL_ERROR',
                        message: `DO RPC error: ${response.status} [${responseCorrelationId}]`,
                        type: 'InternalError',
                    },
                    correlationId: responseCorrelationId,
                };
            }
            const result = await response.json();
            return { result: result, correlationId };
        }
    };
    // Create a method invoker that preserves type inference
    const createMethodProxy = (methodName) => {
        return (async (...args) => {
            const correlationId = baseCorrelationId || generateCorrelationId();
            let response;
            try {
                response = await stub.fetch('https://do/rpc', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        [CORRELATION_ID_HEADER]: correlationId,
                    },
                    body: JSON.stringify({ method: methodName, args }),
                });
            }
            catch (error) {
                // Handle transport-level errors (DO stub failures, network issues, etc.)
                throw TransportError.stubFailed(error instanceof Error ? error : new Error(String(error)));
            }
            await handleErrorResponse(response, correlationId, 'DO RPC error');
            return response.json();
        });
    };
    return new Proxy({}, {
        get(_target, prop) {
            if (typeof prop === 'symbol') {
                return undefined;
            }
            if (prop === 'then' || prop === 'catch' || prop === 'finally') {
                return undefined;
            }
            // Special pipeline method - properly typed to return PipelineBuilder with correct generic
            if (prop === 'pipeline') {
                return (method, ...args) => {
                    const pipelineOpts = { timeout };
                    if (baseCorrelationId) {
                        pipelineOpts.correlationId = baseCorrelationId;
                    }
                    return new PipelineBuilder(doTransport, String(method), args, pipelineOpts);
                };
            }
            // Regular method - returns properly typed function
            return createMethodProxy(prop);
        }
    });
}
// ============================================================================
// Remote Event Handler Registration (do-qkqhm)
// ============================================================================
import { createRemoteEventProxy } from '@dotdo/utils';
/**
 * Creates a remote event handler proxy that stringifies handlers and sends them
 * to the backend for server-side execution.
 *
 * This enables the $.on.Customer.signup(handler) pattern to work across RPC,
 * where handlers are stringified on the client and executed on the DO.
 *
 * @param options - Configuration for the remote event proxy
 * @returns A proxy that registers handlers remotely via RPC
 *
 * @example
 * ```typescript
 * import { createDOStub, createRemoteOnProxy } from '@dotdo/rpc'
 *
 * // Create a DO stub with the registerHandler method
 * const $ = createDOStub<WorkflowContext>(env.DO, 'my-do')
 *
 * // Create the remote event proxy
 * const on = createRemoteOnProxy({ client: $ })
 *
 * // Register handlers that execute server-side
 * await on.Customer.signup(async (event) => {
 *   // This code runs on the DO, not the client
 *   await $.send({ type: 'welcome-email', payload: { to: event.email } })
 * })
 *
 * // Wildcards also work
 * await on['*'].created(async (event) => {
 *   console.log('Something was created:', event)
 * })
 * ```
 *
 * @example
 * ```typescript
 * // With a transport-based client
 * import { createClientWithTransport, FetchTransport, createRemoteOnProxy } from '@dotdo/rpc'
 *
 * const transport = new FetchTransport({ url: 'https://api.example.com' })
 * const client = createClientWithTransport<MyAPI>({ transport })
 *
 * const on = createRemoteOnProxy({
 *   client: client,
 *   source: 'web-client-123'
 * })
 *
 * await on.Order.placed(async (event) => {
 *   // Handler runs server-side with access to $ context
 * })
 * ```
 */
export function createRemoteOnProxy(options) {
    const { client, source, cache } = options;
    return createRemoteEventProxy({
        onRegister: async (path, handlerCode) => {
            const event = path.join('.');
            return client.registerHandler({ event, code: handlerCode, source });
        },
        cache
    });
}
//# sourceMappingURL=client.js.map