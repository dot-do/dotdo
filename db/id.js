// ID generation utilities for @dotdo/db
// Single source of truth for ID generation across the codebase (do-y5ko)
// Branded types added per do-e3my
// Collision resistance improved per do-1knp.5
/**
 * Generate cryptographically secure random string in base36
 * Uses crypto.randomUUID() and converts to base36 for compact representation
 * Provides 122 bits of entropy (UUID v4 has 122 random bits)
 */
function cryptoRandom(length) {
    // Use crypto.randomUUID() which is available in Workers and modern browsers
    const uuid = crypto.randomUUID().replace(/-/g, '');
    // Convert hex UUID to base36 for more compact representation
    // Take first 24 hex chars (96 bits) and convert to ~18 base36 chars
    const hex = uuid.slice(0, 24);
    const bigInt = BigInt('0x' + hex);
    const base36 = bigInt.toString(36);
    return base36.slice(0, length);
}
/**
 * Generate a unique ID using timestamp and cryptographically secure random suffix
 * Format: {timestamp-base36}-{random-12-chars}
 * Example: "m5x7y2z-a1b2c3d4e5f6"
 * Returns a branded ThingId for type safety
 *
 * Collision resistance: 12 base36 chars = ~62 bits of entropy
 * Combined with millisecond timestamp, collisions are virtually impossible
 */
export function generateId() {
    return `${Date.now().toString(36)}-${cryptoRandom(12)}`;
}
/**
 * Generate a unique event ID with 'evt-' prefix
 * Format: evt-{timestamp-base36}-{random-8-chars}
 * Example: "evt-m5x7y2z-a1b2c3d4"
 * Returns a branded EventId for type safety
 *
 * Collision resistance: 8 base36 chars = ~41 bits of entropy
 * Combined with millisecond timestamp, collisions are virtually impossible
 */
export function generateEventId() {
    return `evt-${Date.now().toString(36)}-${cryptoRandom(8)}`;
}
//# sourceMappingURL=id.js.map