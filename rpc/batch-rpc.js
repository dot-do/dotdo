/**
 * Batch RPC - Execute multiple RPC calls in a single request
 *
 * Reduces network round trips by batching multiple independent RPC calls
 * into a single HTTP request. Each call in the batch is executed in parallel
 * on the server, and results are returned in the same order.
 *
 * @module rpc/batch-rpc
 */
import { deserializeError, isRPCError } from './errors';
import { generateCorrelationId, CORRELATION_ID_HEADER } from './headers';
/**
 * Type-safe batch builder for constructing batch RPC calls
 *
 * @example
 * ```typescript
 * const batch = new BatchRPCBuilder<MyAPI>('https://api.example.com')
 *   .add('things.get', ['id1'])
 *   .add('things.get', ['id2'])
 *   .add('events.list', [{ limit: 10 }])
 *
 * const results = await batch.execute()
 * // results[0] is the result of things.get('id1')
 * // results[1] is the result of things.get('id2')
 * // results[2] is the result of events.list({ limit: 10 })
 * ```
 */
export class BatchRPCBuilder {
    calls = [];
    url;
    options;
    constructor(url, options = {}) {
        this.url = url;
        this.options = options;
    }
    /**
     * Add an RPC call to the batch
     *
     * @param method - Method name (supports dot notation)
     * @param args - Arguments for the method
     * @param id - Optional unique ID for this call
     * @returns this for chaining
     */
    add(method, args = [], id) {
        this.calls.push({
            method,
            args,
            id: id ?? `call-${this.calls.length}`,
        });
        return this;
    }
    /**
     * Get the current number of calls in the batch
     */
    get size() {
        return this.calls.length;
    }
    /**
     * Check if the batch is empty
     */
    get isEmpty() {
        return this.calls.length === 0;
    }
    /**
     * Clear all calls from the batch
     */
    clear() {
        this.calls = [];
        return this;
    }
    /**
     * Execute all calls in the batch
     *
     * @returns Array of results in the same order as the calls
     * @throws If throwOnError is true and any call fails
     */
    async execute() {
        if (this.calls.length === 0) {
            return [];
        }
        return executeBatchRPC(this.url, this.calls, this.options);
    }
    /**
     * Execute and extract just the successful results (throws on any error)
     *
     * @returns Array of result values (not BatchRPCResult objects)
     * @throws If any call in the batch fails
     */
    async executeStrict() {
        const results = await this.execute();
        const values = [];
        for (const result of results) {
            if (result.error) {
                throw deserializeError(result.error);
            }
            values.push(result.result);
        }
        return values;
    }
}
/**
 * Execute a batch of RPC calls
 *
 * @param url - Base URL of the RPC endpoint
 * @param calls - Array of RPC calls to execute
 * @param options - Execution options
 * @returns Array of results in the same order as the calls
 */
export async function executeBatchRPC(url, calls, options = {}) {
    const { timeout = 30000, correlationId, throwOnError = false } = options;
    if (calls.length === 0) {
        return [];
    }
    // Ensure all calls have IDs
    const normalizedCalls = calls.map((call, index) => ({
        ...call,
        id: call.id ?? `call-${index}`,
    }));
    const requestCorrelationId = correlationId ?? generateCorrelationId();
    const response = await fetch(`${url}/rpc/batch`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            [CORRELATION_ID_HEADER]: requestCorrelationId,
        },
        body: JSON.stringify({ calls: normalizedCalls }),
        signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
        const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || requestCorrelationId;
        // Try to parse error response
        try {
            const errorBody = (await response.json());
            if (errorBody.code && errorBody.message) {
                throw deserializeError(errorBody);
            }
        }
        catch (e) {
            if (isRPCError(e)) {
                throw e;
            }
        }
        throw new Error(`Batch RPC error: ${response.status} [${responseCorrelationId}]`);
    }
    const batchResponse = (await response.json());
    // If throwOnError, check for any errors and throw the first one
    if (throwOnError) {
        for (const result of batchResponse.results) {
            if (result.error) {
                throw deserializeError(result.error);
            }
        }
    }
    return batchResponse.results;
}
/**
 * Create a batch RPC builder for a URL
 *
 * @param url - Base URL of the RPC endpoint
 * @param options - Default options for batch execution
 * @returns A new BatchRPCBuilder instance
 *
 * @example
 * ```typescript
 * const results = await createBatchRPC('https://api.example.com')
 *   .add('things.get', ['id1'])
 *   .add('things.get', ['id2'])
 *   .add('events.list', [{ limit: 10 }])
 *   .execute()
 * ```
 */
export function createBatchRPC(url, options = {}) {
    return new BatchRPCBuilder(url, options);
}
/**
 * Execute a batch of RPC calls on a Durable Object stub
 *
 * @param stub - The Durable Object stub
 * @param calls - Array of RPC calls to execute
 * @param options - Execution options
 * @returns Array of results in the same order as the calls
 */
export async function executeBatchDORPC(stub, calls, options = {}) {
    const { timeout = 30000, correlationId, throwOnError = false } = options;
    if (calls.length === 0) {
        return [];
    }
    // Ensure all calls have IDs
    const normalizedCalls = calls.map((call, index) => ({
        ...call,
        id: call.id ?? `call-${index}`,
    }));
    const requestCorrelationId = correlationId ?? generateCorrelationId();
    const response = await stub.fetch('https://do/rpc/batch', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            [CORRELATION_ID_HEADER]: requestCorrelationId,
        },
        body: JSON.stringify({ calls: normalizedCalls }),
    });
    if (!response.ok) {
        const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || requestCorrelationId;
        // Try to parse error response
        try {
            const errorBody = (await response.json());
            if (errorBody.code && errorBody.message) {
                throw deserializeError(errorBody);
            }
        }
        catch (e) {
            if (isRPCError(e)) {
                throw e;
            }
        }
        throw new Error(`Batch DO RPC error: ${response.status} [${responseCorrelationId}]`);
    }
    const batchResponse = (await response.json());
    // If throwOnError, check for any errors and throw the first one
    if (throwOnError) {
        for (const result of batchResponse.results) {
            if (result.error) {
                throw deserializeError(result.error);
            }
        }
    }
    return batchResponse.results;
}
/**
 * Create a batch RPC builder for a Durable Object stub
 *
 * @param stub - The Durable Object stub
 * @param options - Default options for batch execution
 * @returns A new BatchDORPCBuilder instance
 *
 * @example
 * ```typescript
 * const stub = env.DO.get(env.DO.idFromName('my-do'))
 *
 * const results = await createBatchDORPC(stub)
 *   .add('things.get', ['id1'])
 *   .add('things.get', ['id2'])
 *   .execute()
 * ```
 */
export function createBatchDORPC(stub, options = {}) {
    return new BatchDORPCBuilder(stub, options);
}
/**
 * Batch builder for Durable Object RPC calls
 */
export class BatchDORPCBuilder {
    calls = [];
    stub;
    options;
    constructor(stub, options = {}) {
        this.stub = stub;
        this.options = options;
    }
    /**
     * Add an RPC call to the batch
     */
    add(method, args = [], id) {
        this.calls.push({
            method,
            args,
            id: id ?? `call-${this.calls.length}`,
        });
        return this;
    }
    /**
     * Get the current number of calls in the batch
     */
    get size() {
        return this.calls.length;
    }
    /**
     * Check if the batch is empty
     */
    get isEmpty() {
        return this.calls.length === 0;
    }
    /**
     * Clear all calls from the batch
     */
    clear() {
        this.calls = [];
        return this;
    }
    /**
     * Execute all calls in the batch
     */
    async execute() {
        if (this.calls.length === 0) {
            return [];
        }
        return executeBatchDORPC(this.stub, this.calls, this.options);
    }
    /**
     * Execute and extract just the successful results (throws on any error)
     */
    async executeStrict() {
        const results = await this.execute();
        const values = [];
        for (const result of results) {
            if (result.error) {
                throw deserializeError(result.error);
            }
            values.push(result.result);
        }
        return values;
    }
}
//# sourceMappingURL=batch-rpc.js.map