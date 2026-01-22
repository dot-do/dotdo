// Storage Adapter Interface for @dotdo/db
// Provides an abstraction layer for different storage backends
/**
 * Create a typed wrapper around a generic storage adapter
 */
export function createTypedStorage(adapter) {
    return {
        get: (key) => adapter.get(key),
        getMany: (keys) => adapter.getMany(keys),
        put: (key, value) => adapter.put(key, value),
        putMany: (entries) => adapter.putMany(entries),
        delete: (key) => adapter.delete(key),
        deleteMany: (keys) => adapter.deleteMany(keys),
        list: (options) => adapter.list(options),
        transaction: (fn) => adapter.transaction(fn),
        has: (key) => adapter.has(key),
        clear: () => adapter.clear(),
        count: (prefix) => adapter.count(prefix)
    };
}
//# sourceMappingURL=storage.js.map