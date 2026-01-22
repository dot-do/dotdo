// Pipeline/Promise Pipelining - Cap'n Proto style
// Implements true promise pipelining where chained calls are batched into a single round trip
//
// Cap'n Proto Promise Pipelining:
// Instead of:
//   const user = await getUser(id)      // Round trip 1
//   const profile = await user.getProfile()  // Round trip 2
//
// Enable:
//   const profile = getUser(id).getProfile() // Single round trip
//
// The pipeline collects chained method calls and sends them all at once.
// The server resolves the chain and returns the final result.
import { generateCorrelationId, CORRELATION_ID_HEADER } from './headers';
import { deserializeError } from './errors';
import { DEFAULT_RPC_TIMEOUT_MS, DEFAULT_MAX_PIPELINE_DEPTH } from '@dotdo/utils';
/**
 * Create a simple pipeline promise that chains operations locally
 * This is useful for post-processing RPC results without additional round trips
 */
export function createPipeline(promise) {
    const pipeline = promise;
    Object.defineProperty(pipeline, 'pipe', {
        value: (fn) => {
            return createPipeline(promise.then(fn));
        },
        enumerable: true
    });
    Object.defineProperty(pipeline, 'get', {
        value: (key) => {
            return createPipeline(promise.then(result => result[key]));
        },
        enumerable: true
    });
    Object.defineProperty(pipeline, 'call', {
        value: (method, ...args) => {
            return createPipeline(promise.then(result => {
                const fn = result[method];
                if (typeof fn !== 'function') {
                    throw new Error(`${String(method)} is not a function`);
                }
                // Cast to callable function type for proper invocation
                return fn.apply(result, args);
            }));
        },
        enumerable: true
    });
    return pipeline;
}
/**
 * Enhance a client with simple pipeline support
 * Wraps all methods to return PipelinePromise for local chaining
 */
export function withPipeline(client) {
    return new Proxy(client, {
        get(target, prop) {
            if (typeof prop === 'symbol') {
                return undefined;
            }
            const value = target[prop];
            if (typeof value === 'function') {
                return (...args) => {
                    const promise = value.apply(target, args);
                    return createPipeline(promise);
                };
            }
            return value;
        }
    });
}
// ============================================================================
// True Promise Pipelining (Server-side resolution)
// ============================================================================
/**
 * Pipeline builder that collects operations and executes them in a single round trip
 * This implements Cap'n Proto-style promise pipelining
 */
export class PipelineBuilder {
    steps = [];
    initialMethod;
    initialArgs;
    transport;
    baseUrl;
    correlationId;
    timeout;
    resolved = null;
    constructor(transport, method, args, options) {
        if (typeof transport === 'string') {
            this.baseUrl = transport;
            this.transport = null; // Will use fetch
        }
        else {
            this.transport = transport;
        }
        this.initialMethod = method;
        this.initialArgs = args;
        if (options?.correlationId !== undefined) {
            this.correlationId = options.correlationId;
        }
        this.timeout = options?.timeout ?? DEFAULT_RPC_TIMEOUT_MS;
    }
    /**
     * Add a property access step to the pipeline
     */
    get(key) {
        const next = this.clone();
        next.steps.push({ type: 'get', name: String(key) });
        return next;
    }
    /**
     * Add a method call step to the pipeline
     */
    call(method, ...args) {
        const next = this.clone();
        next.steps.push({ type: 'call', name: String(method), args });
        return next;
    }
    /**
     * Create a clone of this builder with the current state
     */
    clone() {
        const clone = new PipelineBuilder(this.transport || this.baseUrl, this.initialMethod, this.initialArgs, {
            ...(this.correlationId !== undefined && { correlationId: this.correlationId }),
            timeout: this.timeout,
        });
        clone.steps = [...this.steps];
        return clone;
    }
    /**
     * Execute the pipeline and get the result
     * Implements PromiseLike for await support
     */
    then(onfulfilled, onrejected) {
        if (!this.resolved) {
            this.resolved = this.execute();
        }
        return this.resolved.then(onfulfilled, onrejected);
    }
    /**
     * Execute the pipeline request
     */
    async execute() {
        const correlationId = this.correlationId || generateCorrelationId();
        if (this.transport) {
            // Use transport for pipeline request
            const message = {
                method: this.initialMethod,
                args: this.initialArgs,
                correlationId,
            };
            // If we have pipeline steps, use the pipeline endpoint
            if (this.steps.length > 0) {
                const pipelineRequest = {
                    method: this.initialMethod,
                    args: this.initialArgs,
                    pipeline: this.steps,
                    correlationId,
                };
                // Send as a special pipeline message
                const response = await this.transport.send({
                    method: '__pipeline__',
                    args: [pipelineRequest],
                    correlationId,
                });
                if (response.error) {
                    throw deserializeError(response.error);
                }
                return response.result;
            }
            // No pipeline steps, just a regular call
            const response = await this.transport.send(message);
            if (response.error) {
                throw deserializeError(response.error);
            }
            return response.result;
        }
        // Fallback to fetch-based pipeline
        const pipelineRequest = {
            method: this.initialMethod,
            args: this.initialArgs,
            pipeline: this.steps,
            correlationId,
        };
        const response = await fetch(`${this.baseUrl}/rpc/pipeline`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [CORRELATION_ID_HEADER]: correlationId,
            },
            body: JSON.stringify(pipelineRequest),
            signal: AbortSignal.timeout(this.timeout),
        });
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.message || `Pipeline error: ${response.status}`);
        }
        const result = await response.json();
        if (result.error) {
            throw new Error(`Pipeline step ${result.error.stepIndex} failed: ${result.error.message}`);
        }
        return result.result;
    }
}
/**
 * Create a pipelining client that enables Cap'n Proto-style promise pipelining
 *
 * @example
 * ```typescript
 * interface UserAPI {
 *   getUser(id: string): Promise<User>
 *   users: {
 *     profile: {
 *       get(id: string): Promise<Profile>
 *     }
 *   }
 * }
 *
 * interface User {
 *   getProfile(): Promise<Profile>
 *   getOrders(): Promise<Order[]>
 * }
 *
 * const client = createPipelineClient<UserAPI>({ url: 'https://api.example.com' })
 *
 * // Traditional approach (2 round trips):
 * const user = await client.getUser('123')
 * const profile = await user.getProfile()
 *
 * // With pipelining (1 round trip):
 * const profile = await client.pipeline('getUser', '123')
 *   .call('getProfile')
 *
 * // Even deeper nesting:
 * const avatar = await client.pipeline('getUser', '123')
 *   .call('getProfile')
 *   .get('avatar')
 *   .get('url')
 * ```
 */
export function createPipelineClient(options) {
    const { url, transport, timeout = DEFAULT_RPC_TIMEOUT_MS, correlationId } = options;
    const proxy = new Proxy({}, {
        get(_, prop) {
            if (typeof prop === 'symbol') {
                return undefined;
            }
            if (prop === 'then' || prop === 'catch' || prop === 'finally') {
                return undefined;
            }
            // Special pipeline method
            if (prop === 'pipeline') {
                return (method, ...args) => {
                    return new PipelineBuilder(transport || url, String(method), args, {
                        ...(correlationId !== undefined && { correlationId }),
                        timeout,
                    });
                };
            }
            // pipelineFrom for nested paths
            if (prop === 'pipelineFrom') {
                return (methodPath, ...args) => {
                    return new PipelineBuilder(transport || url, methodPath, args, {
                        ...(correlationId !== undefined && { correlationId }),
                        timeout,
                    });
                };
            }
            // Regular method access - returns a function that creates a pipeline
            return (...args) => {
                return new PipelineBuilder(transport || url, String(prop), args, {
                    ...(correlationId !== undefined && { correlationId }),
                    timeout,
                });
            };
        }
    });
    return proxy;
}
/**
 * Execute a pipeline request on the server
 *
 * This function takes a pipeline request and executes all steps,
 * returning the final result or an error indicating which step failed.
 *
 * @param target - The object containing methods to call
 * @param request - The pipeline request
 * @param options - Execution options
 * @returns The pipeline response
 *
 * @example
 * ```typescript
 * // In your RPC server
 * app.post('/rpc/pipeline', async (c) => {
 *   const request = await c.req.json<PipelineRequest>()
 *   const response = await executePipeline(myTarget, request)
 *   return c.json(response)
 * })
 * ```
 */
export async function executePipeline(target, request, options = {}) {
    const { maxDepth = DEFAULT_MAX_PIPELINE_DEPTH, timeout = DEFAULT_RPC_TIMEOUT_MS } = options;
    const { method, args, pipeline, correlationId } = request;
    // Validate pipeline depth
    if (pipeline.length > maxDepth) {
        return {
            error: {
                stepIndex: -1,
                message: `Pipeline exceeds maximum depth of ${maxDepth}`,
                code: 'PIPELINE_TOO_DEEP',
            },
            correlationId,
        };
    }
    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Pipeline execution timed out after ${timeout}ms`));
        }, timeout);
    });
    try {
        // Execute with timeout
        const result = await Promise.race([
            executeSteps(target, method, args, pipeline),
            timeoutPromise,
        ]);
        return { result: result, correlationId };
    }
    catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        // Check if it's a step error with index
        if ('stepIndex' in err) {
            return {
                error: {
                    stepIndex: err.stepIndex,
                    message: err.message,
                    code: err.code,
                },
                correlationId,
            };
        }
        return {
            error: {
                stepIndex: -1,
                message: err.message,
                code: 'INTERNAL_ERROR',
            },
            correlationId,
        };
    }
}
/**
 * Execute pipeline steps sequentially
 */
async function executeSteps(target, method, args, steps) {
    // Execute initial method
    const methodParts = method.split('.');
    let current = target;
    // Navigate to the method
    for (let i = 0; i < methodParts.length - 1; i++) {
        const part = methodParts[i];
        if (part === undefined) {
            const error = new Error(`Invalid method path: empty segment at index ${i}`);
            error.stepIndex = -1;
            throw error;
        }
        if (!current || typeof current !== 'object') {
            const error = new Error(`Cannot access ${part} on ${typeof current}`);
            error.stepIndex = -1;
            throw error;
        }
        current = current[part];
    }
    // Get and execute the final method
    const methodName = methodParts[methodParts.length - 1];
    if (methodName === undefined) {
        const error = new Error(`Invalid method path: empty method name`);
        error.stepIndex = -1;
        throw error;
    }
    if (!current || typeof current !== 'object') {
        const error = new Error(`Method ${method} not found`);
        error.stepIndex = -1;
        throw error;
    }
    const fn = current[methodName];
    if (typeof fn !== 'function') {
        const error = new Error(`${method} is not a function`);
        error.stepIndex = -1;
        throw error;
    }
    // Execute initial call
    let result = await fn.apply(current, args);
    // Execute pipeline steps
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        try {
            switch (step.type) {
                case 'get':
                    if (result === null || result === undefined) {
                        const error = new Error(`Cannot read property '${step.name}' of ${result}`);
                        error.stepIndex = i;
                        throw error;
                    }
                    result = result[step.name];
                    break;
                case 'call':
                    if (result === null || result === undefined) {
                        const error = new Error(`Cannot call method '${step.name}' on ${result}`);
                        error.stepIndex = i;
                        throw error;
                    }
                    const method = result[step.name];
                    if (typeof method !== 'function') {
                        const error = new Error(`${step.name} is not a function`);
                        error.stepIndex = i;
                        throw error;
                    }
                    result = await method.apply(result, step.args || []);
                    break;
                case 'pipe':
                    // Pipe operations are client-side only
                    const error = new Error('Pipe operations must be resolved client-side');
                    error.stepIndex = i;
                    throw error;
            }
        }
        catch (err) {
            if (err && typeof err === 'object' && 'stepIndex' in err) {
                throw err;
            }
            const error = err instanceof Error ? err : new Error(String(err));
            const wrappedError = error;
            wrappedError.stepIndex = i;
            throw wrappedError;
        }
    }
    return result;
}
/**
 * Create a handler for pipeline requests in Hono
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { createPipelineHandler } from '@dotdo/rpc'
 *
 * const app = new Hono()
 * const myAPI = { ... }
 *
 * app.post('/rpc/pipeline', createPipelineHandler(myAPI))
 * ```
 */
export function createPipelineHandler(target, options) {
    return async (c) => {
        const request = await c.req.json();
        const correlationId = request.correlationId || generateCorrelationId();
        c.header(CORRELATION_ID_HEADER, correlationId);
        const response = await executePipeline(target, { ...request, correlationId }, options);
        if (response.error) {
            return c.json(response, 500);
        }
        return c.json(response);
    };
}
// ============================================================================
// Integration with existing RPC server
// ============================================================================
/**
 * Middleware to add pipeline support to an existing RPC server
 *
 * This registers the __pipeline__ method that the PipelineBuilder uses
 *
 * @param target - The target object with methods
 * @param options - Pipeline execution options
 */
export function withPipelineSupport(target, options) {
    return {
        ...target,
        async __pipeline__(request) {
            return executePipeline(target, request, options);
        },
    };
}
//# sourceMappingURL=pipeline.js.map