// Branded types for ID fields - see do-e3my
// Provides compile-time type safety for different ID types

/**
 * Unique symbol for branding types
 * Using a symbol ensures the brand cannot be accidentally satisfied
 */
declare const brand: unique symbol

/**
 * Brand utility type that adds a unique brand to a base type
 * This creates nominal typing in TypeScript's structural type system
 */
export type Brand<T, B> = T & { [brand]: B }

// =============================================================================
// Branded ID Types
// =============================================================================

/**
 * Branded type for Thing IDs (e.g., "luhm21-abc123")
 * Used for: Things, Nouns, Verbs, Actions, Functions, Workflows
 */
export type ThingId = Brand<string, 'ThingId'>

/**
 * Branded type for Event IDs (e.g., "evt-luhm21-abc1")
 * Used for: Events, Actions
 */
export type EventId = Brand<string, 'EventId'>

/**
 * Branded type for Relationship IDs
 * Composite key derived from subject:predicate:object
 */
export type RelationshipId = Brand<string, 'RelationshipId'>

/**
 * Branded type for User IDs
 * Used for: Users, authentication, audit trails
 */
export type UserId = Brand<string, 'UserId'>

/**
 * Branded type for Tenant IDs
 * Used for: Multi-tenancy, namespace derivation
 */
export type TenantId = Brand<string, 'TenantId'>

/**
 * Branded type for Organization IDs
 * Used for: Orgs, team management
 */
export type OrgId = Brand<string, 'OrgId'>

/**
 * Branded type for API Key IDs
 * Used for: API Keys authentication
 */
export type ApiKeyId = Brand<string, 'ApiKeyId'>

/**
 * Branded type for Correlation IDs
 * Used for: Event tracing, distributed systems
 */
export type CorrelationId = Brand<string, 'CorrelationId'>

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Pattern for Thing IDs: timestamp(base36)-randomPart
 * e.g., "luhm21abc-xyz123"
 */
const THING_ID_PATTERN = /^[a-z0-9]+-[a-z0-9]+$/

/**
 * Pattern for Event IDs: evt-timestamp(base36)-randomPart
 * e.g., "evt-luhm21abc-xyz1"
 */
const EVENT_ID_PATTERN = /^evt-[a-z0-9]+-[a-z0-9]+$/

/**
 * Pattern for Relationship IDs: subject:predicate:object
 * e.g., "thing-123:owns:thing-456"
 */
const RELATIONSHIP_ID_PATTERN = /^[^:]+:[^:]+:[^:]+$/

/**
 * Check if a string is a valid ThingId
 */
export function isThingId(id: string): id is ThingId {
  return typeof id === 'string' && id.length > 0 && THING_ID_PATTERN.test(id)
}

/**
 * Check if a string is a valid EventId
 */
export function isEventId(id: string): id is EventId {
  return typeof id === 'string' && id.length > 0 && EVENT_ID_PATTERN.test(id)
}

/**
 * Check if a string is a valid RelationshipId
 */
export function isRelationshipId(id: string): id is RelationshipId {
  return typeof id === 'string' && id.length > 0 && RELATIONSHIP_ID_PATTERN.test(id)
}

/**
 * Check if a string is a valid UserId
 * User IDs can be any non-empty string (JWT sub, email, etc.)
 */
export function isUserId(id: string): id is UserId {
  return typeof id === 'string' && id.length > 0
}

/**
 * Check if a string is a valid TenantId
 * Tenant IDs are typically derived from hostnames (alphanumeric + hyphens)
 */
export function isTenantId(id: string): id is TenantId {
  return typeof id === 'string' && id.length > 0 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(id)
}

/**
 * Check if a string is a valid OrgId
 * Org IDs follow the same pattern as Thing IDs
 */
export function isOrgId(id: string): id is OrgId {
  return typeof id === 'string' && id.length > 0 && THING_ID_PATTERN.test(id)
}

/**
 * Check if a string is a valid ApiKeyId
 * API Key IDs follow the same pattern as Thing IDs
 */
export function isApiKeyId(id: string): id is ApiKeyId {
  return typeof id === 'string' && id.length > 0 && THING_ID_PATTERN.test(id)
}

/**
 * Check if a string is a valid CorrelationId
 * Correlation IDs can be any non-empty string (UUID, event ID, etc.)
 */
export function isCorrelationId(id: string): id is CorrelationId {
  return typeof id === 'string' && id.length > 0
}

// =============================================================================
// Assertion Functions
// =============================================================================

/**
 * Assert that a string is a valid ThingId, throwing if not
 */
export function assertThingId(id: string): asserts id is ThingId {
  if (!isThingId(id)) {
    throw new Error(`Invalid ThingId: ${id}`)
  }
}

/**
 * Assert that a string is a valid EventId, throwing if not
 */
export function assertEventId(id: string): asserts id is EventId {
  if (!isEventId(id)) {
    throw new Error(`Invalid EventId: ${id}`)
  }
}

/**
 * Assert that a string is a valid RelationshipId, throwing if not
 */
export function assertRelationshipId(id: string): asserts id is RelationshipId {
  if (!isRelationshipId(id)) {
    throw new Error(`Invalid RelationshipId: ${id}`)
  }
}

/**
 * Assert that a string is a valid UserId, throwing if not
 */
export function assertUserId(id: string): asserts id is UserId {
  if (!isUserId(id)) {
    throw new Error(`Invalid UserId: ${id}`)
  }
}

/**
 * Assert that a string is a valid TenantId, throwing if not
 */
export function assertTenantId(id: string): asserts id is TenantId {
  if (!isTenantId(id)) {
    throw new Error(`Invalid TenantId: ${id}`)
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a ThingId from a string (unchecked cast)
 * Use when you're certain the string is a valid ThingId
 */
export function toThingId(id: string): ThingId {
  return id as ThingId
}

/**
 * Create an EventId from a string (unchecked cast)
 * Use when you're certain the string is a valid EventId
 */
export function toEventId(id: string): EventId {
  return id as EventId
}

/**
 * Create a RelationshipId from a string (unchecked cast)
 * Use when you're certain the string is a valid RelationshipId
 */
export function toRelationshipId(id: string): RelationshipId {
  return id as RelationshipId
}

/**
 * Create a UserId from a string (unchecked cast)
 * Use when you're certain the string is a valid UserId
 */
export function toUserId(id: string): UserId {
  return id as UserId
}

/**
 * Create a TenantId from a string (unchecked cast)
 * Use when you're certain the string is a valid TenantId
 */
export function toTenantId(id: string): TenantId {
  return id as TenantId
}

/**
 * Create an OrgId from a string (unchecked cast)
 * Use when you're certain the string is a valid OrgId
 */
export function toOrgId(id: string): OrgId {
  return id as OrgId
}

/**
 * Create an ApiKeyId from a string (unchecked cast)
 * Use when you're certain the string is a valid ApiKeyId
 */
export function toApiKeyId(id: string): ApiKeyId {
  return id as ApiKeyId
}

/**
 * Create a CorrelationId from a string (unchecked cast)
 * Use when you're certain the string is a valid CorrelationId
 */
export function toCorrelationId(id: string): CorrelationId {
  return id as CorrelationId
}

/**
 * Create a RelationshipId from subject, predicate, and object
 */
export function createRelationshipId(subject: string, predicate: string, object: string): RelationshipId {
  return `${subject}:${predicate}:${object}` as RelationshipId
}
