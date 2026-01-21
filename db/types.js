// Core types for @dotdo/db
// See do-luhm.21 - Replace Record<string, unknown> with bounded generics
// Type definitions moved here per do-stc2d.1 to break circular dependencies
/**
 * Type guard to check if a value is a valid JsonValue.
 *
 * @param value - The value to check
 * @returns True if the value is a valid JsonValue
 */
export function isJsonValue(value) {
    if (value === null)
        return true;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        return true;
    if (Array.isArray(value))
        return value.every(isJsonValue);
    if (typeof value === 'object') {
        return Object.values(value).every(v => v === undefined || isJsonValue(v));
    }
    return false;
}
/**
 * Convert a StorableData object to a JsonObject by stripping undefined values.
 *
 * StorableData may contain `undefined` values (for optional properties), but
 * JsonValue does not allow `undefined`. This function performs the conversion
 * safely by:
 * 1. Removing keys with undefined values
 * 2. Recursively converting nested objects
 * 3. Type-narrowing the result to JsonObject
 *
 * This replaces unsafe `thing as unknown as JsonValue` casts.
 *
 * @param data - The StorableData to convert
 * @returns A JsonObject with undefined values stripped
 *
 * @example
 * ```typescript
 * const thing = { $id: '123', name: 'Alice', age: undefined }
 * const json = toJsonObject(thing)
 * // { $id: '123', name: 'Alice' } - age key is removed
 * ```
 */
export function toJsonObject(data) {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
        // Skip undefined values (JSON.stringify behavior)
        if (value === undefined)
            continue;
        // Recursively convert nested objects
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            result[key] = toJsonObject(value);
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
//# sourceMappingURL=types.js.map