// Batch Map Promise - Efficient batching for array operations
// Implements the BatchMapPromise pattern for RPC operations
/**
 * Creates a BatchMapPromise that efficiently processes arrays with batching and concurrency control
 */
export function createBatchMapPromise(items, fn, options = {}) {
    const { concurrency = Infinity, batchSize: _batchSize, onProgress, transform, onError = 'fail', retries = 0, onItemError } = options;
    // Core processing logic
    const execute = async () => {
        if (items.length === 0)
            return [];
        // Results array preserving input order
        const results = new Array(items.length);
        const errors = new Map();
        let completed = 0;
        // Process a single item with retry logic
        const processItem = async (item, index, attemptsLeft = retries + 1) => {
            try {
                let result = await fn(item, index);
                // Apply transform if provided
                // The transform function can change the type, but this is type-erased at runtime
                // Callers using transform should ensure type compatibility
                if (transform) {
                    result = (await transform(result));
                }
                results[index] = result;
            }
            catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                // Retry logic - applies regardless of error handling strategy
                if (attemptsLeft > 1) {
                    return processItem(item, index, attemptsLeft - 1);
                }
                // Error handling after all retries exhausted
                if (onError === 'fail' || onError === 'retry') {
                    throw err;
                }
                if (onError === 'continue') {
                    errors.set(index, err);
                    if (onItemError) {
                        onItemError(index, item, err);
                    }
                    // Leave result undefined for failed items
                }
            }
            finally {
                completed++;
                if (onProgress) {
                    onProgress(completed, items.length);
                }
            }
        };
        // Concurrency control
        if (concurrency === Infinity) {
            // Parallel execution - all at once
            await Promise.all(items.map((item, index) => processItem(item, index)));
        }
        else {
            // Limited concurrency using a worker pool
            const queue = items.map((item, index) => ({ item, index }));
            const workers = [];
            for (let i = 0; i < Math.min(concurrency, items.length); i++) {
                workers.push((async () => {
                    while (queue.length > 0) {
                        const next = queue.shift();
                        if (next) {
                            await processItem(next.item, next.index);
                        }
                    }
                })());
            }
            await Promise.all(workers);
        }
        return results;
    };
    // Create the promise
    const promise = execute();
    // Add chainable methods
    Object.defineProperty(promise, 'batch', {
        value: (size) => {
            return createBatchMapPromise(items, fn, {
                ...options,
                batchSize: size,
                concurrency: size
            });
        },
        enumerable: false
    });
    Object.defineProperty(promise, 'progress', {
        value: (callback) => {
            return createBatchMapPromise(items, fn, {
                ...options,
                onProgress: callback
            });
        },
        enumerable: false
    });
    return promise;
}
/**
 * Batch process an array with automatic chunking and concurrency control
 */
export async function batchMap(items, fn, options = {}) {
    return createBatchMapPromise(items, fn, options);
}
//# sourceMappingURL=batch.js.map