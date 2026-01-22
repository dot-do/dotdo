// Branded types for ID fields - see do-e3my
// Provides compile-time type safety for different ID types
// =============================================================================
// Type Guards
// =============================================================================
/**
 * Pattern for Thing IDs: timestamp(base36)-randomPart
 * e.g., "luhm21abc-xyz123"
 */
const THING_ID_PATTERN = /^[a-z0-9]+-[a-z0-9]+$/;
/**
 * Pattern for Event IDs: evt-timestamp(base36)-randomPart
 * e.g., "evt-luhm21abc-xyz1"
 */
const EVENT_ID_PATTERN = /^evt-[a-z0-9]+-[a-z0-9]+$/;
/**
 * Pattern for Relationship IDs: subject:predicate:object
 * e.g., "thing-123:owns:thing-456"
 */
const RELATIONSHIP_ID_PATTERN = /^[^:]+:[^:]+:[^:]+$/;
/**
 * Check if a string is a valid ThingId
 */
export function isThingId(id) {
    return typeof id === 'string' && id.length > 0 && THING_ID_PATTERN.test(id);
}
/**
 * Check if a string is a valid EventId
 */
export function isEventId(id) {
    return typeof id === 'string' && id.length > 0 && EVENT_ID_PATTERN.test(id);
}
/**
 * Check if a string is a valid RelationshipId
 */
export function isRelationshipId(id) {
    return typeof id === 'string' && id.length > 0 && RELATIONSHIP_ID_PATTERN.test(id);
}
/**
 * Check if a string is a valid UserId
 * User IDs can be any non-empty string (JWT sub, email, etc.)
 */
export function isUserId(id) {
    return typeof id === 'string' && id.length > 0;
}
/**
 * Check if a string is a valid TenantId
 * Tenant IDs are typically derived from hostnames (alphanumeric + hyphens)
 */
export function isTenantId(id) {
    return typeof id === 'string' && id.length > 0 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(id);
}
/**
 * Check if a string is a valid OrgId
 * Org IDs follow the same pattern as Thing IDs
 */
export function isOrgId(id) {
    return typeof id === 'string' && id.length > 0 && THING_ID_PATTERN.test(id);
}
/**
 * Check if a string is a valid ApiKeyId
 * API Key IDs follow the same pattern as Thing IDs
 */
export function isApiKeyId(id) {
    return typeof id === 'string' && id.length > 0 && THING_ID_PATTERN.test(id);
}
/**
 * Check if a string is a valid CorrelationId
 * Correlation IDs can be any non-empty string (UUID, event ID, etc.)
 */
export function isCorrelationId(id) {
    return typeof id === 'string' && id.length > 0;
}
// =============================================================================
// Assertion Functions
// =============================================================================
/**
 * Assert that a string is a valid ThingId, throwing if not
 */
export function assertThingId(id) {
    if (!isThingId(id)) {
        throw new Error(`Invalid ThingId: ${id}`);
    }
}
/**
 * Assert that a string is a valid EventId, throwing if not
 */
export function assertEventId(id) {
    if (!isEventId(id)) {
        throw new Error(`Invalid EventId: ${id}`);
    }
}
/**
 * Assert that a string is a valid RelationshipId, throwing if not
 */
export function assertRelationshipId(id) {
    if (!isRelationshipId(id)) {
        throw new Error(`Invalid RelationshipId: ${id}`);
    }
}
/**
 * Assert that a string is a valid UserId, throwing if not
 */
export function assertUserId(id) {
    if (!isUserId(id)) {
        throw new Error(`Invalid UserId: ${id}`);
    }
}
/**
 * Assert that a string is a valid TenantId, throwing if not
 */
export function assertTenantId(id) {
    if (!isTenantId(id)) {
        throw new Error(`Invalid TenantId: ${id}`);
    }
}
// =============================================================================
// Factory Functions
// =============================================================================
/**
 * Create a ThingId from a string (unchecked cast)
 * Use when you're certain the string is a valid ThingId
 */
export function toThingId(id) {
    return id;
}
/**
 * Create an EventId from a string (unchecked cast)
 * Use when you're certain the string is a valid EventId
 */
export function toEventId(id) {
    return id;
}
/**
 * Create a RelationshipId from a string (unchecked cast)
 * Use when you're certain the string is a valid RelationshipId
 */
export function toRelationshipId(id) {
    return id;
}
/**
 * Create a UserId from a string (unchecked cast)
 * Use when you're certain the string is a valid UserId
 */
export function toUserId(id) {
    return id;
}
/**
 * Create a TenantId from a string (unchecked cast)
 * Use when you're certain the string is a valid TenantId
 */
export function toTenantId(id) {
    return id;
}
/**
 * Create an OrgId from a string (unchecked cast)
 * Use when you're certain the string is a valid OrgId
 */
export function toOrgId(id) {
    return id;
}
/**
 * Create an ApiKeyId from a string (unchecked cast)
 * Use when you're certain the string is a valid ApiKeyId
 */
export function toApiKeyId(id) {
    return id;
}
/**
 * Create a CorrelationId from a string (unchecked cast)
 * Use when you're certain the string is a valid CorrelationId
 */
export function toCorrelationId(id) {
    return id;
}
/**
 * Create a RelationshipId from subject, predicate, and object
 */
export function createRelationshipId(subject, predicate, object) {
    return `${subject}:${predicate}:${object}`;
}
//# sourceMappingURL=branded-types.js.map