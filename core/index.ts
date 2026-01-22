/**
 * @dotdo/core - Core Types and Interfaces
 *
 * This package provides the unified database abstraction layer types.
 * All storage backends (@dotdo/db4, @dotdo/postgres, @dotdo/sqlite, etc.)
 * implement these interfaces.
 *
 * @packageDocumentation
 */

// =============================================================================
// Core Types
// =============================================================================

export type {
  // JSON types
  JsonPrimitive,
  JsonArray,
  JsonValue,
  JsonObject,
  StorableData,

  // Thing (Entity/Node)
  Thing,
  CreateThingInput,

  // Relationship (Edge)
  Relationship,
  CreateRelationshipInput,

  // Query
  QueryOptions,
  SearchOptions,

  // Pagination
  PaginatedResult,
  CursorResult,

  // Type Schema
  TypeSchema,
  Discriminated
} from './types'

// =============================================================================
// DBClient Interface
// =============================================================================

export type { DBClient, TypedDBClient } from './db-client'
export { createTypedClient } from './db-client'

// =============================================================================
// Actions Interface
// =============================================================================

export type {
  // Types
  ActionStatus,
  ActionTrigger,
  ActionError,
  Action,
  ActionStatusChange,

  // Input types
  CreateActionInput,
  UpdateActionInput,
  FindActionsOptions,
  ClaimActionsOptions,

  // Client interface
  ActionsClient
} from './actions'

// =============================================================================
// Events Interface
// =============================================================================

export type {
  // Types
  Event,

  // Input types
  EmitEventInput,
  QueryEventsOptions,
  SubscribeEventsOptions,

  // Client interface
  EventsClient,

  // Event sourcing
  EventHandler,
  StandardActionEventType,
  StandardCrudEventType
} from './events'

export { replayEvents } from './events'

// =============================================================================
// Polymorphic Collections
// =============================================================================

export type {
  // Schema types
  TypeDefinition,
  FieldDefinition,
  TypeRegistryEntry,
  PolymorphicQueryOptions,

  // Function types (example)
  FunctionBase,
  CodeFunction,
  GenerativeFunction,
  AgenticFunction,
  HumanFunction,
  FunctionType
} from './polymorphic'

export {
  TypeRegistry,
  buildTypeFilter,
  isType,
  assertType,
  matchType
} from './polymorphic'

// =============================================================================
// Full Client Interface
// =============================================================================

export type {
  DBClientFull,
  Collection,
  DODatabaseConfig
} from './full-client'

export { combineClients } from './full-client'
