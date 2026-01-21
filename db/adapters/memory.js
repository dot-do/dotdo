// In-Memory Storage Adapter for @dotdo/db
// Implements StorageAdapter using JavaScript Map
/**
 * In-memory storage adapter
 *
 * Uses a JavaScript Map for fast key-value storage. Ideal for testing
 * and development. Data is not persisted across process restarts.
 *
 * Thread-safe within a single JavaScript execution context.
 */
export class MemoryStorageAdapter {
    store;
    namespace;
    constructor(options = {}) {
        this.store = new Map();
        this.namespace = options.namespace || '';
    }
    /**
     * Apply namespace prefix to key
     */
    prefixKey(key) {
        return this.namespace ? `${this.namespace}:${key}` : key;
    }
    /**
     * Remove namespace prefix from key
     */
    unprefixKey(key) {
        if (this.namespace && key.startsWith(`${this.namespace}:`)) {
            return key.slice(this.namespace.length + 1);
        }
        return key;
    }
    /**
     * Check if a key matches the namespace
     */
    matchesNamespace(key) {
        if (!this.namespace)
            return true;
        return key.startsWith(`${this.namespace}:`);
    }
    async get(key) {
        const prefixedKey = this.prefixKey(key);
        const entry = this.store.get(prefixedKey);
        return entry?.value;
    }
    async getMany(keys) {
        const result = new Map();
        for (const key of keys) {
            const prefixedKey = this.prefixKey(key);
            const entry = this.store.get(prefixedKey);
            if (entry !== undefined) {
                result.set(key, entry.value);
            }
        }
        return result;
    }
    async put(key, value) {
        const prefixedKey = this.prefixKey(key);
        const now = Date.now();
        const existing = this.store.get(prefixedKey);
        this.store.set(prefixedKey, {
            value,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now
        });
    }
    async putMany(entries) {
        const now = Date.now();
        for (const [key, value] of entries) {
            const prefixedKey = this.prefixKey(key);
            const existing = this.store.get(prefixedKey);
            this.store.set(prefixedKey, {
                value,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now
            });
        }
    }
    async delete(key) {
        const prefixedKey = this.prefixKey(key);
        this.store.delete(prefixedKey);
    }
    async deleteMany(keys) {
        for (const key of keys) {
            const prefixedKey = this.prefixKey(key);
            this.store.delete(prefixedKey);
        }
    }
    async list(options = {}) {
        const { prefix, limit = 1000, cursor, includeValues = true } = options;
        // Build effective prefix for filtering
        const effectivePrefix = this.namespace
            ? prefix
                ? `${this.namespace}:${prefix}`
                : `${this.namespace}:`
            : prefix || '';
        // Get all matching keys, sorted
        const allKeys = Array.from(this.store.keys())
            .filter((key) => {
            // Must match namespace
            if (!this.matchesNamespace(key))
                return false;
            // Must match prefix if specified
            if (effectivePrefix && !key.startsWith(effectivePrefix))
                return false;
            // Must be after cursor if specified
            if (cursor && key <= cursor)
                return false;
            return true;
        })
            .sort();
        // Apply pagination
        const hasMore = allKeys.length > limit;
        const pageKeys = allKeys.slice(0, limit);
        // Build result entries
        const entries = new Map();
        for (const key of pageKeys) {
            const unprefixedKey = this.unprefixKey(key);
            if (includeValues) {
                const entry = this.store.get(key);
                entries.set(unprefixedKey, entry?.value);
            }
            else {
                entries.set(unprefixedKey, undefined);
            }
        }
        // Next cursor is the last key returned (prefixed)
        const lastKey = pageKeys[pageKeys.length - 1];
        const nextCursor = hasMore && lastKey ? lastKey : undefined;
        const resultObj = {
            entries,
            hasMore
        };
        if (nextCursor !== undefined) {
            resultObj.cursor = nextCursor;
        }
        return resultObj;
    }
    async transaction(fn) {
        // For in-memory storage, we can provide basic atomicity by:
        // 1. Creating a snapshot before the operation
        // 2. Restoring on failure
        const snapshot = new Map(this.store);
        try {
            return await fn();
        }
        catch (error) {
            // Restore snapshot on failure
            this.store = snapshot;
            throw error;
        }
    }
    async has(key) {
        const prefixedKey = this.prefixKey(key);
        return this.store.has(prefixedKey);
    }
    async clear() {
        if (this.namespace) {
            // Only clear keys with our namespace prefix
            for (const key of this.store.keys()) {
                if (this.matchesNamespace(key)) {
                    this.store.delete(key);
                }
            }
        }
        else {
            this.store.clear();
        }
    }
    async count(prefix) {
        const effectivePrefix = this.namespace
            ? prefix
                ? `${this.namespace}:${prefix}`
                : `${this.namespace}:`
            : prefix || '';
        let count = 0;
        for (const key of this.store.keys()) {
            if (!this.matchesNamespace(key))
                continue;
            if (effectivePrefix && !key.startsWith(effectivePrefix))
                continue;
            count++;
        }
        return count;
    }
    /**
     * Get the underlying Map for testing/debugging
     * Note: Returns the actual Map reference, not a copy
     */
    getStore() {
        return this.store;
    }
    /**
     * Get all entries as a plain object (useful for debugging)
     */
    toJSON() {
        const result = {};
        for (const [key, entry] of this.store) {
            if (this.matchesNamespace(key)) {
                result[this.unprefixKey(key)] = entry.value;
            }
        }
        return result;
    }
    /**
     * Set the underlying store (used for shared storage)
     * @internal
     */
    setStore(store) {
        this.store = store;
    }
}
/**
 * Factory function to create an in-memory storage adapter
 */
export function createMemoryStorageAdapter(options) {
    return new MemoryStorageAdapter(options);
}
/**
 * Shared in-memory storage instances for testing
 * Allows multiple adapters to share the same underlying Map
 */
export class SharedMemoryStorage {
    static instances = new Map();
    /**
     * Get a shared storage instance by name
     */
    static get(name) {
        let store = this.instances.get(name);
        if (!store) {
            store = new Map();
            this.instances.set(name, store);
        }
        return store;
    }
    /**
     * Clear a shared storage instance
     */
    static clear(name) {
        const store = this.instances.get(name);
        if (store) {
            store.clear();
        }
    }
    /**
     * Clear all shared storage instances
     */
    static clearAll() {
        for (const store of this.instances.values()) {
            store.clear();
        }
    }
    /**
     * Create an adapter backed by shared storage
     */
    static createAdapter(name, options) {
        const adapter = new MemoryStorageAdapter(options);
        // Replace the internal store with shared storage
        adapter.setStore(this.get(name));
        return adapter;
    }
}
//# sourceMappingURL=memory.js.map