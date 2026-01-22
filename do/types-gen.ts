/**
 * TypeScript Type Generator for DO
 *
 * Generates TypeScript .d.ts definitions from the DO's internal schema and capabilities.
 * Used by the _types RPC endpoint to provide type definitions for SDK/CLI auto-generation.
 *
 * @module do/types-gen
 */

/**
 * Options for type generation
 */
export interface TypeGenOptions {
  /**
   * Output format
   * - 'pretty': Formatted with indentation and newlines (default)
   * - 'minified': Minimal whitespace
   */
  format?: 'pretty' | 'minified'

  /**
   * Custom entity types to include (registered via schema)
   */
  customTypes?: Record<string, CustomTypeDefinition>

  /**
   * Package version to include in output
   */
  version?: string
}

/**
 * Definition for a custom entity type
 */
export interface CustomTypeDefinition {
  name: string
  fields: Record<string, FieldDefinition>
  description?: string
}

/**
 * Definition for a field in a custom type
 */
export interface FieldDefinition {
  type: string
  optional?: boolean
  description?: string
}

/**
 * Result of type generation
 */
export interface TypeGenResult {
  /** The generated TypeScript definitions */
  types: string
  /** Version identifier */
  version: string
  /** Generation timestamp */
  timestamp: number
}

// Cache for generated types
let cachedTypes: TypeGenResult | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60000 // 1 minute cache

/**
 * Generate TypeScript type definitions for the DO
 *
 * @param options - Generation options
 * @returns TypeGenResult with types, version, and timestamp
 */
export function generateTypes(options: TypeGenOptions = {}): TypeGenResult {
  const now = Date.now()

  // Return cached result if still valid (and same format)
  if (cachedTypes && (now - cacheTimestamp) < CACHE_TTL_MS && options.format !== 'minified') {
    return cachedTypes
  }

  const format = options.format ?? 'pretty'
  const version = options.version ?? '1.0.0'
  const nl = format === 'pretty' ? '\n' : ' '
  const indent = format === 'pretty' ? '  ' : ''

  const types = generateTypeDefinitions(nl, indent, options.customTypes)

  const result: TypeGenResult = {
    types,
    version,
    timestamp: now,
  }

  // Cache the result (only for pretty format)
  if (format === 'pretty') {
    cachedTypes = result
    cacheTimestamp = now
  }

  return result
}

/**
 * Clear the type generation cache
 */
export function clearTypeCache(): void {
  cachedTypes = null
  cacheTimestamp = 0
}

/**
 * Generate the full type definitions string
 */
function generateTypeDefinitions(
  nl: string,
  indent: string,
  customTypes?: Record<string, CustomTypeDefinition>
): string {
  const sections: string[] = []

  // Header
  sections.push(generateHeader(nl))

  // Branded ID types
  sections.push(generateBrandedTypes(nl, indent))

  // Base entity types
  sections.push(generateBaseEntityTypes(nl, indent))

  // Store interfaces
  sections.push(generateThingsStoreInterface(nl, indent))
  sections.push(generateEventsStoreInterface(nl, indent))
  sections.push(generateRelationshipsStoreInterface(nl, indent))

  // Workflow context types
  sections.push(generateWorkflowContextTypes(nl, indent))

  // DO interface
  sections.push(generateDOInterface(nl, indent))

  // Custom types if provided
  if (customTypes && Object.keys(customTypes).length > 0) {
    sections.push(generateCustomTypes(nl, indent, customTypes))
  }

  return sections.join(nl + nl)
}

/**
 * Generate header with metadata
 */
function generateHeader(nl: string): string {
  return [
    '/**',
    ' * Auto-generated TypeScript definitions for @dotdo/do',
    ' * ',
    ' * This file provides type definitions for the Durable Object (DO) class',
    ' * and its entity stores (Things, Events, Relationships).',
    ' * ',
    ' * @generated',
    ' */',
    '',
    '// =============================================================================',
    '// BRANDED ID TYPES',
    '// =============================================================================',
  ].join(nl)
}

/**
 * Generate branded ID types
 */
function generateBrandedTypes(nl: string, indent: string): string {
  return [
    '/**',
    ' * Branded type for Thing IDs - provides compile-time type safety',
    ' */',
    'export type ThingId = string & { readonly __brand: unique symbol };',
    '',
    '/**',
    ' * Branded type for Event IDs - provides compile-time type safety',
    ' */',
    'export type EventId = string & { readonly __brand: unique symbol };',
    '',
    '/**',
    ' * Branded type for Correlation IDs - for tracing related events',
    ' */',
    'export type CorrelationId = string & { readonly __brand: unique symbol };',
  ].join(nl)
}

/**
 * Generate base entity types (Thing, Event, Relationship)
 */
function generateBaseEntityTypes(nl: string, indent: string): string {
  return [
    '// =============================================================================',
    '// BASE ENTITY TYPES',
    '// =============================================================================',
    '',
    '/**',
    ' * JSON-serializable value type',
    ' */',
    'export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };',
    '',
    '/**',
    ' * Base data type for storable entities',
    ' */',
    'export type StorableData = Record<string, JsonValue>;',
    '',
    '/**',
    ' * Base Thing interface with system fields',
    ' * ',
    ' * Things are the primary entities stored in a DO.',
    ' * Each Thing has a unique $id, a $type, and timestamps.',
    ' */',
    'export interface Thing<T extends StorableData = StorableData> {',
    `${indent}/** Unique identifier for this Thing */`,
    `${indent}$id: ThingId;`,
    `${indent}/** Type discriminator (e.g., "Customer", "Order") */`,
    `${indent}$type: string;`,
    `${indent}/** Creation timestamp (Unix ms) */`,
    `${indent}$createdAt: number;`,
    `${indent}/** Last update timestamp (Unix ms) */`,
    `${indent}$updatedAt: number;`,
    `${indent}/** User-defined data */`,
    `${indent}[key: string]: JsonValue | ThingId | string | number;`,
    '}',
    '',
    '/**',
    ' * Base Event interface with system fields',
    ' * ',
    ' * Events are immutable records of things that happened.',
    ' * Used for event sourcing and audit trails.',
    ' */',
    'export interface Event<P extends JsonValue = JsonValue> {',
    `${indent}/** Unique identifier for this Event */`,
    `${indent}$id: EventId;`,
    `${indent}/** Event type (e.g., "Customer.signup", "Order.placed") */`,
    `${indent}type: string;`,
    `${indent}/** Event timestamp (Unix ms) */`,
    `${indent}$timestamp: number;`,
    `${indent}/** Event payload data */`,
    `${indent}payload: P;`,
    `${indent}/** Source entity that emitted the event */`,
    `${indent}source?: ThingId | string;`,
    `${indent}/** Correlation ID for tracing */`,
    `${indent}correlationId?: CorrelationId | string;`,
    '}',
    '',
    '/**',
    ' * Relationship between two Things (subject-predicate-object triple)',
    ' * ',
    ' * Relationships model connections between entities.',
    ' * Example: Customer "owns" Order',
    ' */',
    'export interface Relationship<M extends StorableData = StorableData> {',
    `${indent}/** Subject Thing ID */`,
    `${indent}subject: ThingId | string;`,
    `${indent}/** Predicate verb (e.g., "owns", "created", "belongsTo") */`,
    `${indent}predicate: string;`,
    `${indent}/** Object Thing ID */`,
    `${indent}object: ThingId | string;`,
    `${indent}/** Creation timestamp (Unix ms) */`,
    `${indent}$createdAt: number;`,
    '}',
  ].join(nl)
}

/**
 * Generate ThingsStore interface
 */
function generateThingsStoreInterface(nl: string, indent: string): string {
  return [
    '// =============================================================================',
    '// THINGS STORE',
    '// =============================================================================',
    '',
    '/**',
    ' * ThingsStore - CRUD operations for Things',
    ' * ',
    ' * Provides create, read, update, delete operations for Things.',
    ' * All operations are async and return Promises.',
    ' */',
    'export interface ThingsStore<T extends StorableData = StorableData> {',
    `${indent}/**`,
    `${indent} * Create a new Thing`,
    `${indent} * @param data - Thing data with required $type field`,
    `${indent} * @returns Created Thing with generated $id and timestamps`,
    `${indent} */`,
    `${indent}create<D extends Partial<T> & { $type: string }>(data: D): Promise<Thing<T> & D>;`,
    '',
    `${indent}/**`,
    `${indent} * Get a Thing by ID`,
    `${indent} * @param id - Thing ID`,
    `${indent} * @returns Thing or null if not found`,
    `${indent} */`,
    `${indent}get(id: string): Promise<Thing<T> | null>;`,
    '',
    `${indent}/**`,
    `${indent} * Update a Thing`,
    `${indent} * @param id - Thing ID`,
    `${indent} * @param data - Partial data to merge`,
    `${indent} * @returns Updated Thing`,
    `${indent} */`,
    `${indent}update<U extends Partial<T>>(id: string, data: U): Promise<Thing<T>>;`,
    '',
    `${indent}/**`,
    `${indent} * Delete a Thing`,
    `${indent} * @param id - Thing ID`,
    `${indent} */`,
    `${indent}delete(id: string): Promise<void>;`,
    '',
    `${indent}/**`,
    `${indent} * List Things with optional filtering`,
    `${indent} * @param options - Query options`,
    `${indent} * @returns Array of Things`,
    `${indent} */`,
    `${indent}list(options?: { type?: string; limit?: number; offset?: number }): Promise<Thing<T>[]>;`,
    '',
    `${indent}/**`,
    `${indent} * Bulk create multiple Things`,
    `${indent} * @param things - Array of Thing data`,
    `${indent} * @returns Array of created Things`,
    `${indent} */`,
    `${indent}bulkCreate<D extends Partial<T> & { $type: string }>(things: D[]): Promise<(Thing<T> & D)[]>;`,
    '',
    `${indent}/**`,
    `${indent} * Bulk update multiple Things`,
    `${indent} * @param items - Array of { id, data } pairs`,
    `${indent} * @returns Array of updated Things`,
    `${indent} */`,
    `${indent}bulkUpdate(items: Array<{ id: string; data: Partial<T> }>): Promise<Thing<T>[]>;`,
    '',
    `${indent}/**`,
    `${indent} * Bulk delete multiple Things`,
    `${indent} * @param ids - Array of Thing IDs`,
    `${indent} */`,
    `${indent}bulkDelete(ids: string[]): Promise<void>;`,
    '}',
  ].join(nl)
}

/**
 * Generate EventsStore interface
 */
function generateEventsStoreInterface(nl: string, indent: string): string {
  return [
    '// =============================================================================',
    '// EVENTS STORE',
    '// =============================================================================',
    '',
    '/**',
    ' * EventQueryOptions - Options for querying events',
    ' */',
    'export interface EventQueryOptions {',
    `${indent}type?: string;`,
    `${indent}source?: string;`,
    `${indent}correlationId?: string;`,
    `${indent}since?: number;`,
    `${indent}until?: number;`,
    `${indent}limit?: number;`,
    `${indent}offset?: number;`,
    '}',
    '',
    '/**',
    ' * EventsStore - Event emission and query operations',
    ' * ',
    ' * Events are immutable records. Once emitted, they cannot be modified.',
    ' * Supports subscriptions for real-time event handling.',
    ' */',
    'export interface EventsStore<P extends JsonValue = JsonValue> {',
    `${indent}/**`,
    `${indent} * Emit a new event`,
    `${indent} * @param event - Event data with type and payload`,
    `${indent} * @returns Emitted Event with generated $id and $timestamp`,
    `${indent} */`,
    `${indent}emit(event: { type: string; payload: P; source?: string; correlationId?: string }): Promise<Event<P>>;`,
    '',
    `${indent}/**`,
    `${indent} * Get an event by ID`,
    `${indent} * @param id - Event ID`,
    `${indent} * @returns Event or null if not found`,
    `${indent} */`,
    `${indent}get(id: string): Promise<Event<P> | null>;`,
    '',
    `${indent}/**`,
    `${indent} * Query events with filtering`,
    `${indent} * @param options - Query options`,
    `${indent} * @returns Array of matching Events`,
    `${indent} */`,
    `${indent}query(options?: EventQueryOptions): Promise<Event<P>[]>;`,
    '',
    `${indent}/**`,
    `${indent} * Subscribe to new events`,
    `${indent} * @param handler - Callback for each new event`,
    `${indent} * @returns Unsubscribe function`,
    `${indent} */`,
    `${indent}subscribe(handler: (event: Event<P>) => void): () => void;`,
    '',
    `${indent}/**`,
    `${indent} * Count events with optional filter`,
    `${indent} * @param filter - Optional type filter`,
    `${indent} * @returns Event count`,
    `${indent} */`,
    `${indent}count(filter?: { type?: string }): Promise<number>;`,
    '}',
  ].join(nl)
}

/**
 * Generate RelationshipsStore interface
 */
function generateRelationshipsStoreInterface(nl: string, indent: string): string {
  return [
    '// =============================================================================',
    '// RELATIONSHIPS STORE',
    '// =============================================================================',
    '',
    '/**',
    ' * RelationshipQuery - Query options for finding relationships',
    ' */',
    'export interface RelationshipQuery {',
    `${indent}subject?: string;`,
    `${indent}predicate?: string;`,
    `${indent}object?: string;`,
    '}',
    '',
    '/**',
    ' * RelationshipsStore - Operations for managing entity relationships',
    ' * ',
    ' * Relationships are subject-predicate-object triples that model',
    ' * connections between Things.',
    ' */',
    'export interface RelationshipsStore<M extends StorableData = StorableData> {',
    `${indent}/**`,
    `${indent} * Add a new relationship`,
    `${indent} * @param rel - Relationship data`,
    `${indent} * @returns Created Relationship with timestamp`,
    `${indent} */`,
    `${indent}add(rel: { subject: string; predicate: string; object: string } & M): Promise<Relationship<M>>;`,
    '',
    `${indent}/**`,
    `${indent} * Remove a relationship`,
    `${indent} * @param rel - Relationship to remove (by subject/predicate/object)`,
    `${indent} */`,
    `${indent}remove(rel: { subject: string; predicate: string; object: string }): Promise<void>;`,
    '',
    `${indent}/**`,
    `${indent} * Find relationships matching query`,
    `${indent} * @param query - Query options`,
    `${indent} * @returns Array of matching Relationships`,
    `${indent} */`,
    `${indent}find(query: RelationshipQuery): Promise<Relationship<M>[]>;`,
    '',
    `${indent}/**`,
    `${indent} * Get all objects related to a subject by predicate`,
    `${indent} * @param subjectId - Subject Thing ID`,
    `${indent} * @param predicate - Relationship predicate`,
    `${indent} * @returns Array of object IDs`,
    `${indent} */`,
    `${indent}getRelated(subjectId: string, predicate: string): Promise<string[]>;`,
    '',
    `${indent}/**`,
    `${indent} * Get all subjects related to an object by predicate`,
    `${indent} * @param objectId - Object Thing ID`,
    `${indent} * @param predicate - Relationship predicate`,
    `${indent} * @returns Array of subject IDs`,
    `${indent} */`,
    `${indent}getRelatedTo(objectId: string, predicate: string): Promise<string[]>;`,
    '}',
  ].join(nl)
}

/**
 * Generate WorkflowContext types
 */
function generateWorkflowContextTypes(nl: string, indent: string): string {
  return [
    '// =============================================================================',
    '// WORKFLOW CONTEXT ($)',
    '// =============================================================================',
    '',
    '/**',
    ' * Schedule handler function type',
    ' */',
    'export type ScheduleHandler = () => Promise<void> | void;',
    '',
    '/**',
    ' * Event handler function type',
    ' */',
    'export type EventHandler<P = unknown> = (event: Event<P>) => Promise<void> | void;',
    '',
    '/**',
    ' * On proxy for event handlers - $.on.Customer.signup(handler)',
    ' */',
    'export interface OnProxy {',
    `${indent}[noun: string]: {`,
    `${indent}${indent}[verb: string]: (handler: EventHandler) => void;`,
    `${indent}};`,
    '}',
    '',
    '/**',
    ' * Every proxy for scheduling - $.every.Monday.at9am(handler)',
    ' */',
    'export interface EveryProxy {',
    `${indent}/** Numeric interval: every(5).minutes(handler) */`,
    `${indent}(value: number): { [unit: string]: (handler: ScheduleHandler) => void };`,
    `${indent}/** Day-based: every.Monday.at9am(handler) */`,
    `${indent}[key: string]: EveryProxy | ((handler: ScheduleHandler) => void);`,
    '}',
    '',
    '/**',
    ' * Durable action options',
    ' */',
    'export interface DoOptions {',
    `${indent}/** Number of retry attempts (default: 3) */`,
    `${indent}retries?: number;`,
    `${indent}/** Backoff strategy */`,
    `${indent}backoff?: 'linear' | 'exponential';`,
    `${indent}/** Timeout in milliseconds */`,
    `${indent}timeout?: number;`,
    '}',
    '',
    '/**',
    ' * WorkflowContext ($) - Fluent API for events, scheduling, and cross-DO RPC',
    ' * ',
    ' * The $ context is the primary way to interact with the DO runtime.',
    ' * It provides event handling, scheduling, and durability primitives.',
    ' * ',
    ' * @example',
    ' * // Event handlers',
    ' * $.on.Customer.signup(async (event) => {',
    ' *   await $.send({ type: "welcome-email", to: event.email });',
    ' * });',
    ' * ',
    ' * // Scheduling',
    ' * $.every.Monday.at("9am")(async () => {',
    ' *   await generateWeeklyReport();',
    ' * });',
    ' * ',
    ' * // Cross-DO RPC',
    ' * await $.Order("order-123").ship();',
    ' */',
    'export interface WorkflowContext {',
    `${indent}/**`,
    `${indent} * Fire-and-forget event emission`,
    `${indent} * @param event - Event to send`,
    `${indent} */`,
    `${indent}send(event: { type: string; payload?: unknown }): void;`,
    '',
    `${indent}/**`,
    `${indent} * Single attempt execution (no retries)`,
    `${indent} * @param action - Action to execute`,
    `${indent} * @returns Action result`,
    `${indent} */`,
    `${indent}try<T>(action: () => Promise<T>): Promise<T>;`,
    '',
    `${indent}/**`,
    `${indent} * Durable execution with retries`,
    `${indent} * @param action - Action to execute`,
    `${indent} * @param options - Retry options`,
    `${indent} * @returns Action result`,
    `${indent} */`,
    `${indent}do<T>(action: () => Promise<T>, options?: DoOptions): Promise<T>;`,
    '',
    `${indent}/**`,
    `${indent} * Event handler registration proxy`,
    `${indent} * Usage: $.on.Customer.signup(handler)`,
    `${indent} */`,
    `${indent}on: OnProxy;`,
    '',
    `${indent}/**`,
    `${indent} * Scheduling DSL proxy`,
    `${indent} * Usage: $.every.Monday.at9am(handler)`,
    `${indent} */`,
    `${indent}every: EveryProxy;`,
    '',
    `${indent}/**`,
    `${indent} * Cross-DO RPC - dynamically access other DOs`,
    `${indent} * Usage: $.Customer("user-123").getProfile()`,
    `${indent} */`,
    `${indent}[doName: string]: ((id: string) => Record<string, (...args: unknown[]) => Promise<unknown>>) | unknown;`,
    '}',
  ].join(nl)
}

/**
 * Generate main DO interface
 */
function generateDOInterface(nl: string, indent: string): string {
  return [
    '// =============================================================================',
    '// DO (DURABLE OBJECT) INTERFACE',
    '// =============================================================================',
    '',
    '/**',
    ' * DO - The Durable Object for Digital Objects',
    ' * ',
    ' * DO = Durable Object = Digital Object',
    ' * ',
    ' * This is the main class that provides entity storage, event handling,',
    ' * WebSocket support, and scheduling capabilities.',
    ' * ',
    ' * @example',
    ' * // Access entity stores',
    ' * const customer = await do.things.create({ $type: "Customer", name: "Alice" });',
    ' * await do.events.emit({ type: "Customer.created", payload: customer });',
    ' * ',
    ' * // Use workflow context',
    ' * do.$.on.Customer.signup(async (event) => {',
    ' *   console.log("New signup:", event.payload);',
    ' * });',
    ' */',
    'export interface DO {',
    `${indent}/**`,
    `${indent} * Things entity store - CRUD for Things`,
    `${indent} */`,
    `${indent}things: ThingsStore;`,
    '',
    `${indent}/**`,
    `${indent} * Events entity store - Event emission and queries`,
    `${indent} */`,
    `${indent}events: EventsStore;`,
    '',
    `${indent}/**`,
    `${indent} * Relationships store - Entity connections`,
    `${indent} */`,
    `${indent}relationships: RelationshipsStore;`,
    '',
    `${indent}/**`,
    `${indent} * Workflow context for events, scheduling, and cross-DO RPC`,
    `${indent} */`,
    `${indent}$: WorkflowContext;`,
    '',
    `${indent}/**`,
    `${indent} * Handle incoming HTTP request`,
    `${indent} * @param request - Incoming Request`,
    `${indent} * @returns Response`,
    `${indent} */`,
    `${indent}fetch(request: Request): Promise<Response>;`,
    '',
    `${indent}/**`,
    `${indent} * Handle scheduled alarm`,
    `${indent} * Called by Cloudflare runtime when an alarm fires`,
    `${indent} */`,
    `${indent}alarm(): Promise<void>;`,
    '',
    `${indent}/**`,
    `${indent} * Handle WebSocket message`,
    `${indent} * @param ws - WebSocket instance`,
    `${indent} * @param message - Message content`,
    `${indent} */`,
    `${indent}webSocketMessage?(ws: WebSocket, message: ArrayBuffer | string): Promise<void>;`,
    '',
    `${indent}/**`,
    `${indent} * Handle WebSocket close`,
    `${indent} * @param ws - WebSocket instance`,
    `${indent} * @param code - Close code`,
    `${indent} * @param reason - Close reason`,
    `${indent} * @param wasClean - Whether close was clean`,
    `${indent} */`,
    `${indent}webSocketClose?(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void>;`,
    '}',
  ].join(nl)
}

/**
 * Generate custom entity types
 */
function generateCustomTypes(
  nl: string,
  indent: string,
  customTypes: Record<string, CustomTypeDefinition>
): string {
  const lines = [
    '// =============================================================================',
    '// CUSTOM ENTITY TYPES',
    '// =============================================================================',
    '',
  ]

  for (const [name, def] of Object.entries(customTypes)) {
    if (def.description) {
      lines.push('/**')
      lines.push(` * ${def.description}`)
      lines.push(' */')
    }
    lines.push(`export interface ${name} extends Thing {`)
    lines.push(`${indent}$type: '${def.name}';`)

    for (const [fieldName, fieldDef] of Object.entries(def.fields)) {
      if (fieldDef.description) {
        lines.push(`${indent}/** ${fieldDef.description} */`)
      }
      const optional = fieldDef.optional ? '?' : ''
      lines.push(`${indent}${fieldName}${optional}: ${fieldDef.type};`)
    }

    lines.push('}')
    lines.push('')
  }

  return lines.join(nl)
}
