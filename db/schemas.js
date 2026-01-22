// Zod Schemas for Runtime Validation - see do-grp5.11
// Provides type-safe runtime validation for Things, Events, and Relationships
// Types imported from types.ts per do-stc2d.1 to break circular dependencies
import { z } from 'zod';
// =============================================================================
// JSON Value Schemas - Core building blocks
// =============================================================================
/**
 * Schema for JSON primitive values
 */
export const JsonPrimitiveSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null()
]);
/**
 * Schema for JSON values (recursive)
 * Handles primitives, arrays, and nested objects
 */
export const JsonValueSchema = z.lazy(() => z.union([
    JsonPrimitiveSchema,
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
]));
/**
 * Schema for JSON arrays
 */
export const JsonArraySchema = z.array(JsonValueSchema);
/**
 * Schema for JSON objects
 */
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
/**
 * Schema for storable data (record of JSON values)
 */
export const StorableDataSchema = z.record(z.string(), JsonValueSchema);
// =============================================================================
// ID Pattern Schemas - Based on branded-types.ts patterns
// =============================================================================
/**
 * Pattern for Thing IDs: timestamp(base36)-randomPart
 * e.g., "luhm21abc-xyz123"
 */
export const ThingIdPattern = /^[a-z0-9]+-[a-z0-9]+$/;
/**
 * Pattern for Event IDs: evt-timestamp(base36)-randomPart
 * e.g., "evt-luhm21abc-xyz1"
 */
export const EventIdPattern = /^evt-[a-z0-9]+-[a-z0-9]+$/;
/**
 * Pattern for Relationship IDs: subject:predicate:object
 */
export const RelationshipIdPattern = /^[^:]+:[^:]+:[^:]+$/;
/**
 * Schema for Thing ID strings
 */
export const ThingIdSchema = z.string().regex(ThingIdPattern, 'Invalid ThingId format');
/**
 * Schema for Event ID strings
 */
export const EventIdSchema = z.string().regex(EventIdPattern, 'Invalid EventId format');
/**
 * Schema for Relationship ID strings
 */
export const RelationshipIdSchema = z.string().regex(RelationshipIdPattern, 'Invalid RelationshipId format');
/**
 * Schema for any non-empty string ID (for backward compatibility)
 */
export const AnyIdSchema = z.string().min(1, 'ID cannot be empty');
// =============================================================================
// Thing Schemas
// =============================================================================
/**
 * Schema for base Thing fields (system-managed fields)
 */
export const BaseThingSchema = z.object({
    $id: ThingIdSchema,
    $type: z.string().min(1, '$type is required'),
    $createdAt: z.number().int().positive(),
    $updatedAt: z.number().int().positive()
});
/**
 * Schema for Thing with additional user data
 * Uses passthrough to allow additional properties
 */
export const ThingSchema = BaseThingSchema.passthrough();
/**
 * Schema for Thing input (creating a new Thing)
 * Excludes auto-generated fields ($id, $createdAt, $updatedAt)
 */
export const ThingInputSchema = z.object({
    $type: z.string().min(1, '$type is required')
}).passthrough();
/**
 * Schema for Thing update (partial update)
 * All fields optional, cannot update $id or $type
 */
export const ThingUpdateSchema = z.record(z.string(), JsonValueSchema).refine((data) => !('$id' in data) && !('$type' in data), { message: 'Cannot update $id or $type fields' });
/**
 * Schema for bulk update item
 */
export const BulkUpdateItemSchema = z.object({
    id: z.union([ThingIdSchema, AnyIdSchema]),
    data: ThingUpdateSchema
});
/**
 * Schema for Thing list options
 */
export const ThingListOptionsSchema = z.object({
    type: z.string().optional(),
    limit: z.number().int().positive().max(1000).optional(),
    offset: z.number().int().nonnegative().optional()
}).optional();
// =============================================================================
// Event Schemas
// =============================================================================
/**
 * Schema for base Event fields (system-managed fields)
 */
export const BaseEventSchema = z.object({
    $id: EventIdSchema,
    type: z.string().min(1, 'Event type is required'),
    $timestamp: z.number().int().positive(),
    source: z.string().optional(),
    correlationId: z.string().optional()
});
/**
 * Schema for Event with typed payload
 */
export const EventSchema = BaseEventSchema.extend({
    payload: JsonValueSchema
});
/**
 * Schema for Event input (emitting a new Event)
 * Excludes auto-generated fields ($id, $timestamp)
 */
export const EventInputSchema = z.object({
    type: z.string().min(1, 'Event type is required'),
    payload: JsonValueSchema,
    source: z.string().optional(),
    correlationId: z.string().optional()
});
/**
 * Schema for Event query options
 */
export const EventQueryOptionsSchema = z.object({
    type: z.string().optional(),
    source: z.string().optional(),
    correlationId: z.string().optional(),
    since: z.number().int().positive().optional(),
    until: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(1000).optional(),
    offset: z.number().int().nonnegative().optional()
}).optional();
/**
 * Schema for retention policy
 */
export const RetentionPolicySchema = z.object({
    maxEvents: z.number().int().positive().optional(),
    maxAgeDays: z.number().int().positive().optional()
}).refine((data) => data.maxEvents !== undefined || data.maxAgeDays !== undefined, { message: 'At least one of maxEvents or maxAgeDays must be specified' });
/**
 * Schema for durability configuration
 */
export const DurabilityConfigSchema = z.object({
    retries: z.number().int().nonnegative().optional(),
    backoff: z.enum(['linear', 'exponential']).optional(),
    timeout: z.number().int().positive().optional()
});
/**
 * Schema for DLQ entry
 */
export const DLQEntrySchema = z.object({
    event: EventSchema,
    attempts: z.number().int().nonnegative(),
    lastError: z.string(),
    timestamp: z.number().int().positive(),
    handlerIndex: z.number().int().nonnegative().optional()
});
/**
 * Schema for DLQ query options
 */
export const DLQQueryOptionsSchema = z.object({
    type: z.string().optional(),
    since: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional()
}).optional();
// =============================================================================
// Relationship Schemas
// =============================================================================
/**
 * Schema for base Relationship fields
 */
export const BaseRelationshipSchema = z.object({
    subject: z.union([ThingIdSchema, AnyIdSchema]),
    predicate: z.string().min(1, 'Predicate is required'),
    object: z.union([ThingIdSchema, AnyIdSchema]),
    $createdAt: z.number().int().positive()
});
/**
 * Schema for Relationship with additional metadata
 */
export const RelationshipSchema = BaseRelationshipSchema.passthrough();
/**
 * Schema for Relationship input (adding a new Relationship)
 * Excludes auto-generated field ($createdAt)
 */
export const RelationshipInputSchema = z.object({
    subject: z.union([ThingIdSchema, AnyIdSchema]),
    predicate: z.string().min(1, 'Predicate is required'),
    object: z.union([ThingIdSchema, AnyIdSchema])
}).passthrough();
/**
 * Schema for Relationship query
 */
export const RelationshipQuerySchema = z.object({
    subject: z.string().optional(),
    predicate: z.string().optional(),
    object: z.string().optional()
});
// =============================================================================
// Validation Helpers - Throwing versions
// =============================================================================
/**
 * Validate a Thing, throwing if invalid
 * @param data - The data to validate
 * @returns The validated Thing
 * @throws z.ZodError if validation fails
 */
export function validateThing(data) {
    return ThingSchema.parse(data);
}
/**
 * Validate a Thing input, throwing if invalid
 * @param data - The data to validate
 * @returns The validated ThingInput
 * @throws z.ZodError if validation fails
 */
export function validateThingInput(data) {
    return ThingInputSchema.parse(data);
}
/**
 * Validate an Event, throwing if invalid
 * @param data - The data to validate
 * @returns The validated Event
 * @throws z.ZodError if validation fails
 */
export function validateEvent(data) {
    return EventSchema.parse(data);
}
/**
 * Validate an Event input, throwing if invalid
 * @param data - The data to validate
 * @returns The validated EventInput
 * @throws z.ZodError if validation fails
 */
export function validateEventInput(data) {
    return EventInputSchema.parse(data);
}
/**
 * Validate a Relationship, throwing if invalid
 * @param data - The data to validate
 * @returns The validated Relationship
 * @throws z.ZodError if validation fails
 */
export function validateRelationship(data) {
    return RelationshipSchema.parse(data);
}
/**
 * Validate a Relationship input, throwing if invalid
 * @param data - The data to validate
 * @returns The validated RelationshipInput
 * @throws z.ZodError if validation fails
 */
export function validateRelationshipInput(data) {
    return RelationshipInputSchema.parse(data);
}
// =============================================================================
// Validation Helpers - Safe versions (no throwing)
// =============================================================================
/**
 * Safely parse a Thing without throwing
 * @param data - The data to validate
 * @returns SafeParseResult with either the validated data or error
 */
export function safeParseThing(data) {
    const result = ThingSchema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
}
/**
 * Safely parse a Thing input without throwing
 * @param data - The data to validate
 * @returns SafeParseResult with either the validated data or error
 */
export function safeParseThingInput(data) {
    const result = ThingInputSchema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
}
/**
 * Safely parse an Event without throwing
 * @param data - The data to validate
 * @returns SafeParseResult with either the validated data or error
 */
export function safeParseEvent(data) {
    const result = EventSchema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
}
/**
 * Safely parse an Event input without throwing
 * @param data - The data to validate
 * @returns SafeParseResult with either the validated data or error
 */
export function safeParseEventInput(data) {
    const result = EventInputSchema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
}
/**
 * Safely parse a Relationship without throwing
 * @param data - The data to validate
 * @returns SafeParseResult with either the validated data or error
 */
export function safeParseRelationship(data) {
    const result = RelationshipSchema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
}
/**
 * Safely parse a Relationship input without throwing
 * @param data - The data to validate
 * @returns SafeParseResult with either the validated data or error
 */
export function safeParseRelationshipInput(data) {
    const result = RelationshipInputSchema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
}
// =============================================================================
// Utility Functions
// =============================================================================
/**
 * Format Zod errors into a human-readable ValidationError
 * @param error - The ZodError to format
 * @returns Formatted ValidationError
 */
export function formatValidationError(error) {
    return {
        message: 'Validation failed',
        errors: error.errors.map(e => ({
            path: e.path,
            message: e.message
        }))
    };
}
/**
 * Check if data is a valid Thing
 * @param data - The data to check
 * @returns True if data is a valid Thing
 */
export function isThing(data) {
    return ThingSchema.safeParse(data).success;
}
/**
 * Check if data is a valid Event
 * @param data - The data to check
 * @returns True if data is a valid Event
 */
export function isEvent(data) {
    return EventSchema.safeParse(data).success;
}
/**
 * Check if data is a valid Relationship
 * @param data - The data to check
 * @returns True if data is a valid Relationship
 */
export function isRelationship(data) {
    return RelationshipSchema.safeParse(data).success;
}
/**
 * Validate and coerce a Thing ID
 * Returns the ID if valid, throws if invalid
 * @param id - The ID to validate
 * @returns The validated ID
 */
export function validateThingId(id) {
    return ThingIdSchema.parse(id);
}
/**
 * Validate and coerce an Event ID
 * Returns the ID if valid, throws if invalid
 * @param id - The ID to validate
 * @returns The validated ID
 */
export function validateEventId(id) {
    return EventIdSchema.parse(id);
}
/**
 * Safely validate a Thing ID without throwing
 * @param id - The ID to validate
 * @returns SafeParseResult with either the validated ID or error
 */
export function safeParseThingId(id) {
    const result = ThingIdSchema.safeParse(id);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
}
/**
 * Safely validate an Event ID without throwing
 * @param id - The ID to validate
 * @returns SafeParseResult with either the validated ID or error
 */
export function safeParseEventId(id) {
    const result = EventIdSchema.safeParse(id);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
}
//# sourceMappingURL=schemas.js.map