/**
 * Schema Registry
 *
 * A centralized registry for Zod schemas that enables:
 * - Reusable schema definitions
 * - Event schema validation
 * - Runtime schema lookup by name
 */

import { z, ZodType, ZodError } from 'zod'
import { ValidationError } from './error-transform'

/**
 * Schema entry in the registry
 */
interface SchemaEntry<T = unknown> {
  schema: ZodType<T>
  description?: string
  version?: string
}

/**
 * Schema registry for storing and retrieving Zod schemas by name
 */
class SchemaRegistryImpl {
  private schemas = new Map<string, SchemaEntry>()

  /**
   * Register a schema with a unique name
   *
   * @param name - Unique identifier for the schema
   * @param schema - Zod schema to register
   * @param options - Optional metadata
   *
   * @example
   * ```ts
   * SchemaRegistry.register('User', z.object({
   *   id: z.string().uuid(),
   *   name: z.string(),
   *   email: z.string().email(),
   * }), { description: 'User entity schema' })
   * ```
   */
  register<T>(
    name: string,
    schema: ZodType<T>,
    options?: { description?: string; version?: string }
  ): void {
    if (this.schemas.has(name)) {
      console.warn(`[SchemaRegistry] Overwriting existing schema: ${name}`)
    }
    this.schemas.set(name, {
      schema,
      description: options?.description,
      version: options?.version,
    })
  }

  /**
   * Get a schema by name
   *
   * @param name - Schema name to look up
   * @returns The schema or undefined if not found
   */
  get<T = unknown>(name: string): ZodType<T> | undefined {
    const entry = this.schemas.get(name)
    return entry?.schema as ZodType<T> | undefined
  }

  /**
   * Check if a schema is registered
   *
   * @param name - Schema name to check
   */
  has(name: string): boolean {
    return this.schemas.has(name)
  }

  /**
   * Validate data against a registered schema
   *
   * @param name - Schema name to validate against
   * @param data - Data to validate
   * @returns Validation result
   *
   * @example
   * ```ts
   * const result = SchemaRegistry.validate('User', userData)
   * if (result.success) {
   *   // result.data is typed
   * }
   * ```
   */
  validate<T = unknown>(
    name: string,
    data: unknown
  ): { success: true; data: T } | { success: false; error: ValidationError } {
    const schema = this.get<T>(name)
    if (!schema) {
      return {
        success: false,
        error: new ValidationError({
          message: `Schema "${name}" not found in registry`,
          path: [],
          code: 'SCHEMA_NOT_FOUND',
        }),
      }
    }

    const result = schema.safeParse(data)
    if (result.success) {
      return { success: true, data: result.data }
    }

    const firstIssue = result.error.issues[0]
    return {
      success: false,
      error: new ValidationError({
        message: formatZodError(result.error),
        path: firstIssue?.path ?? [],
        received: data,
        expected: firstIssue?.message ?? 'valid input',
        code: 'VALIDATION_FAILED',
      }),
    }
  }

  /**
   * List all registered schema names
   */
  list(): string[] {
    return Array.from(this.schemas.keys())
  }

  /**
   * Get schema with metadata
   *
   * @param name - Schema name
   */
  getEntry(name: string): SchemaEntry | undefined {
    return this.schemas.get(name)
  }

  /**
   * Remove a schema from the registry
   *
   * @param name - Schema name to remove
   */
  remove(name: string): boolean {
    return this.schemas.delete(name)
  }

  /**
   * Clear all registered schemas
   */
  clear(): void {
    this.schemas.clear()
  }
}

/**
 * Global schema registry instance
 */
export const SchemaRegistry = new SchemaRegistryImpl()

/**
 * Event schema registry for validating event payloads
 */
class EventRegistryImpl {
  private eventSchemas = new Map<string, ZodType<unknown>>()

  /**
   * Register an event schema
   *
   * @param eventType - Event type (e.g., 'user.created', 'order.placed')
   * @param schema - Zod schema for the event payload
   *
   * @example
   * ```ts
   * EventRegistry.register('user.created', z.object({
   *   userId: z.string().uuid(),
   *   email: z.string().email(),
   *   createdAt: z.string().datetime(),
   * }))
   * ```
   */
  register<T>(eventType: string, schema: ZodType<T>): void {
    if (this.eventSchemas.has(eventType)) {
      console.warn(`[EventRegistry] Overwriting existing event schema: ${eventType}`)
    }
    this.eventSchemas.set(eventType, schema)
  }

  /**
   * Get an event schema
   *
   * @param eventType - Event type to look up
   */
  get<T = unknown>(eventType: string): ZodType<T> | undefined {
    return this.eventSchemas.get(eventType) as ZodType<T> | undefined
  }

  /**
   * Check if an event schema is registered
   *
   * @param eventType - Event type to check
   */
  has(eventType: string): boolean {
    return this.eventSchemas.has(eventType)
  }

  /**
   * Validate an event payload against its registered schema
   *
   * @param eventType - Event type
   * @param payload - Event payload to validate
   * @returns Validation result
   *
   * @example
   * ```ts
   * const result = EventRegistry.validate('user.created', eventPayload)
   * if (!result.success) {
   *   console.error('Invalid event:', result.error)
   * }
   * ```
   */
  validate<T = unknown>(
    eventType: string,
    payload: unknown
  ): { success: true; data: T } | { success: false; error: ValidationError } {
    const schema = this.get<T>(eventType)
    if (!schema) {
      // If no schema is registered, allow the event (permissive mode)
      return { success: true, data: payload as T }
    }

    const result = schema.safeParse(payload)
    if (result.success) {
      return { success: true, data: result.data }
    }

    const firstIssue = result.error.issues[0]
    return {
      success: false,
      error: new ValidationError({
        message: `Event "${eventType}" validation failed: ${formatZodError(result.error)}`,
        path: firstIssue?.path ?? [],
        received: payload,
        expected: firstIssue?.message ?? 'valid event payload',
        code: 'EVENT_VALIDATION_FAILED',
      }),
    }
  }

  /**
   * Validate an event payload, throwing on failure
   *
   * @param eventType - Event type
   * @param payload - Event payload to validate
   * @returns Validated payload
   * @throws ValidationError if validation fails
   */
  validateOrThrow<T = unknown>(eventType: string, payload: unknown): T {
    const result = this.validate<T>(eventType, payload)
    if (!result.success) {
      throw result.error
    }
    return result.data
  }

  /**
   * List all registered event types
   */
  list(): string[] {
    return Array.from(this.eventSchemas.keys())
  }

  /**
   * Remove an event schema
   *
   * @param eventType - Event type to remove
   */
  remove(eventType: string): boolean {
    return this.eventSchemas.delete(eventType)
  }

  /**
   * Clear all event schemas
   */
  clear(): void {
    this.eventSchemas.clear()
  }
}

/**
 * Global event registry instance
 */
export const EventRegistry = new EventRegistryImpl()

/**
 * Format Zod errors into a readable message
 */
function formatZodError(error: ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'root'
    return `${path}: ${issue.message}`
  })

  if (issues.length === 1) {
    return issues[0]
  }

  return `Validation failed:\n  - ${issues.join('\n  - ')}`
}

// ============================================================================
// Common Schemas
// ============================================================================

/**
 * Common UUID schema
 */
export const UuidSchema = z.string().uuid()

/**
 * Common email schema
 */
export const EmailSchema = z.string().email()

/**
 * Common URL schema
 */
export const UrlSchema = z.string().url()

/**
 * Common pagination schema for query params
 */
export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

/**
 * Common sort order schema
 */
export const SortOrderSchema = z.enum(['asc', 'desc']).default('asc')

/**
 * Common timestamp schema (ISO 8601)
 */
export const TimestampSchema = z.string().datetime()

/**
 * Common ID parameter schema
 */
export const IdParamSchema = z.object({
  id: z.string().uuid(),
})

// Register common schemas
SchemaRegistry.register('uuid', UuidSchema, { description: 'UUID v4 format' })
SchemaRegistry.register('email', EmailSchema, { description: 'Email address' })
SchemaRegistry.register('url', UrlSchema, { description: 'URL format' })
SchemaRegistry.register('pagination', PaginationSchema, { description: 'Pagination parameters' })
SchemaRegistry.register('timestamp', TimestampSchema, { description: 'ISO 8601 timestamp' })
