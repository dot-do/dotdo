// @dotdo/db - Abstract Storage Layer
// Uses digital-objects from primitives
// Base for database.do managed service

export * from './types'
export * from './errors'
export * from './branded-types'
export * from './storage'
export * from './adapters'
export * from './id'
export * from './pagination'
export * from './things'
export * from './relationships'
export * from './events'
export * from './query'
export * from './digital-objects'
export * from './sqlite'
export * from './migrations'
export * from './audit'
export * from './schema'
export {
  // Re-export from schemas.ts but exclude ValidationError to avoid conflict with schema.ts
  ThingSchema,
  ThingInputSchema,
  BaseEventSchema,
  EventSchema,
  EventInputSchema,
  BaseRelationshipSchema,
  RelationshipSchema,
  RelationshipInputSchema,
  EventIdSchema,
  ThingIdSchema,
  RelationshipIdSchema,
  DLQQueryOptionsSchema,
  validateThing,
  validateThingInput,
  validateEvent,
  validateEventInput,
  validateRelationship,
  validateRelationshipInput,
  safeParseThing,
  safeParseEvent,
  safeParseRelationship,
  formatValidationError,
  type ValidationError as SchemaValidationErrorInfo
} from './schemas'
export * from './event-sourcing'
