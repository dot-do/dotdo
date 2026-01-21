/**
 * TypeScript Type Inference from Schema
 *
 * Provides utility types that infer TypeScript types from unified schema definitions.
 * Supports both IceType modifiers and ai-database prompt fields.
 *
 * @example
 * ```typescript
 * const schema = {
 *   Product: {
 *     sku: 'string!',
 *     name: 'string!',
 *     price: 'decimal(10,2)!',
 *     tags: 'string[]',
 *     vendor: '-> Vendor?',
 *   },
 *   Vendor: {
 *     name: 'string!',
 *     products: '<- Product.vendor[]',
 *   },
 * } as const
 *
 * type Product = InferEntity<typeof schema, 'Product'>
 * // => {
 * //   $id: string
 * //   $type: 'Product'
 * //   sku: string
 * //   name: string
 * //   price: number
 * //   tags: string[]
 * //   vendor?: Vendor
 * // }
 * ```
 *
 * @module do/schema/infer
 */

import type { RawDatabaseSchema, RawEntitySchema, RawFieldDefinition } from './types'

// =============================================================================
// Primitive Type Mapping
// =============================================================================

/**
 * Map field type string to TypeScript type
 */
type MapPrimitiveType<T extends string> =
  // String types
  T extends 'string' | 'text' | 'varchar' | 'char' | 'uuid' | 'markdown' | 'url'
    ? string
    // Number types
    : T extends 'number' | 'int' | 'long' | 'bigint' | 'float' | 'double' | 'decimal' | 'fixed'
    ? number
    // Boolean types
    : T extends 'bool' | 'boolean'
    ? boolean
    // Date types
    : T extends 'date' | 'datetime' | 'timestamp' | 'timestamptz' | 'time'
    ? Date
    // JSON type
    : T extends 'json'
    ? Record<string, unknown>
    // Binary type
    : T extends 'binary'
    ? Uint8Array
    // Unknown type
    : unknown

// =============================================================================
// Field Type Extraction
// =============================================================================

/**
 * Extract base type from field definition, removing modifiers
 *
 * Examples:
 *   'string!'      -> 'string'
 *   'string?'      -> 'string'
 *   'string#'      -> 'string'
 *   'string!#'     -> 'string'
 *   'decimal(10,2)' -> 'decimal'
 *   'string[]'     -> 'string'
 */
type ExtractBaseType<T extends string> =
  // Handle parametric types first: decimal(10,2) -> decimal
  T extends `${infer Base}(${string})`
    ? Base
    // Handle array types: string[] -> string
    : T extends `${infer Base}[]`
    ? ExtractBaseType<Base>
    // Handle modifiers at end: string! -> string, string? -> string, string# -> string
    : T extends `${infer Base}!`
    ? ExtractBaseType<Base>
    : T extends `${infer Base}?`
    ? ExtractBaseType<Base>
    : T extends `${infer Base}#`
    ? ExtractBaseType<Base>
    // Handle combinations like !# or #!
    : T extends `${infer Base}!#` | `${infer Base}#!`
    ? ExtractBaseType<Base>
    // Base case: just the type
    : T

/**
 * Check if field is required (has ! modifier)
 */
type IsRequired<T extends string> =
  T extends `${string}!${string}` ? true : false

/**
 * Check if field is optional (has ? modifier or no ! modifier)
 */
type IsOptional<T extends string> =
  T extends `${string}?${string}` ? true
  : T extends `${string}!${string}` ? false
  : true // Default to optional

/**
 * Check if field is an array (has [] suffix)
 */
type IsArray<T extends string> =
  // Remove modifiers first, then check for []
  T extends `${string}[]${string}` ? true
  : T extends `${string}[]` ? true
  : false

/**
 * Check if field is a relation (starts with ->, <-, ~>, or <~)
 */
type IsRelation<T extends string> =
  T extends `-> ${string}` | `->${string}` ? true
  : T extends `<- ${string}` | `<-${string}` ? true
  : T extends `~> ${string}` | `~>${string}` ? true
  : T extends `<~ ${string}` | `<~${string}` ? true
  : false

/**
 * Extract relation target type
 */
type ExtractRelationTarget<T extends string> =
  // Forward exact: -> User or ->User
  T extends `-> ${infer Target}` | `->${infer Target}`
    ? ExtractTargetType<Target>
    // Backward exact: <- User.field or <-User.field
    : T extends `<- ${infer Target}` | `<-${infer Target}`
    ? ExtractTargetType<Target>
    // Forward fuzzy: ~> User
    : T extends `~> ${infer Target}` | `~>${infer Target}`
    ? ExtractTargetType<Target>
    // Backward fuzzy: <~ User
    : T extends `<~ ${infer Target}` | `<~${infer Target}`
    ? ExtractTargetType<Target>
    : never

/**
 * Extract clean target type from relation target (remove . and [] and ?)
 */
type ExtractTargetType<T extends string> =
  // Remove array suffix first
  T extends `${infer Base}[]`
    ? ExtractTargetType<Base>
    // Remove optional suffix
    : T extends `${infer Base}?`
    ? ExtractTargetType<Base>
    // Remove backref (e.g., User.owner -> User)
    : T extends `${infer Type}.${string}`
    ? Type
    // Just the type
    : T

/**
 * Check if relation target is array
 */
type IsRelationArray<T extends string> =
  T extends `${string}[]` ? true : false

/**
 * Check if relation is optional
 */
type IsRelationOptional<T extends string> =
  T extends `${string}?` | `${string}?[]` | `${string}[]?` ? true : false

// =============================================================================
// Schema Type Inference
// =============================================================================

/**
 * Infer TypeScript type for a single field
 */
type InferFieldType<
  TSchema extends RawDatabaseSchema,
  TField extends string
> =
  // Check if it's a relation field
  IsRelation<TField> extends true
    ? ExtractRelationTarget<TField> extends keyof TSchema
      // Relation to another entity in the schema
      ? IsRelationArray<TField> extends true
        ? InferEntity<TSchema, ExtractRelationTarget<TField> & keyof TSchema>[]
        : IsRelationOptional<TField> extends true
        ? InferEntity<TSchema, ExtractRelationTarget<TField> & keyof TSchema> | undefined
        : InferEntity<TSchema, ExtractRelationTarget<TField> & keyof TSchema>
      // Relation target not in schema - use unknown
      : IsRelationArray<TField> extends true
      ? unknown[]
      : unknown
    // Regular field
    : IsArray<TField> extends true
    ? MapPrimitiveType<ExtractBaseType<TField>>[]
    : MapPrimitiveType<ExtractBaseType<TField>>

/**
 * Infer TypeScript type for a raw field definition (string or array)
 */
type InferRawFieldType<
  TSchema extends RawDatabaseSchema,
  TField extends RawFieldDefinition
> =
  TField extends string
    ? InferFieldType<TSchema, TField>
    : TField extends [infer Inner extends string]
    ? InferFieldType<TSchema, Inner>[]
    : unknown

/**
 * Get required field keys from entity schema
 */
type RequiredFieldKeys<TEntity extends RawEntitySchema> = {
  [K in keyof TEntity]: K extends `$${string}`
    ? never
    : TEntity[K] extends string
    ? IsRequired<TEntity[K]> extends true
      ? K
      : never
    : never
}[keyof TEntity]

/**
 * Get optional field keys from entity schema
 */
type OptionalFieldKeys<TEntity extends RawEntitySchema> = {
  [K in keyof TEntity]: K extends `$${string}`
    ? never
    : TEntity[K] extends string
    ? IsOptional<TEntity[K]> extends true
      ? K
      : never
    : K extends string
    ? K // Array fields are optional by default
    : never
}[keyof TEntity]

/**
 * Infer TypeScript type from an entity schema definition
 *
 * @example
 * ```typescript
 * const schema = {
 *   Product: {
 *     sku: 'string!',
 *     name: 'string!',
 *     price: 'decimal(10,2)!',
 *     tags: 'string[]',
 *     description: 'A compelling product description',
 *     vendor: '-> Vendor?',
 *   },
 * } as const
 *
 * type Product = InferEntity<typeof schema, 'Product'>
 * // => {
 * //   $id: string
 * //   $type: 'Product'
 * //   sku: string
 * //   name: string
 * //   price: number
 * //   tags?: string[]
 * //   description?: string  // Prompt fields are optional strings
 * //   vendor?: Vendor
 * // }
 * ```
 */
export type InferEntity<
  TSchema extends RawDatabaseSchema,
  TEntityName extends keyof TSchema
> = {
  /** Unique identifier */
  $id: string
  /** Entity type name */
  $type: TEntityName
  /** Creation timestamp */
  $createdAt?: number
  /** Last update timestamp */
  $updatedAt?: number
} & {
  // Required fields (have ! modifier)
  [K in RequiredFieldKeys<TSchema[TEntityName]>]: TSchema[TEntityName][K] extends RawFieldDefinition
    ? InferRawFieldType<TSchema, TSchema[TEntityName][K]>
    : unknown
} & {
  // Optional fields (have ? modifier or no modifier)
  [K in OptionalFieldKeys<TSchema[TEntityName]>]?: TSchema[TEntityName][K] extends RawFieldDefinition
    ? InferRawFieldType<TSchema, TSchema[TEntityName][K]>
    : unknown
}

/**
 * Infer TypeScript types for all entities in a schema
 *
 * @example
 * ```typescript
 * const schema = {
 *   Product: { ... },
 *   Vendor: { ... },
 * } as const
 *
 * type Entities = InferSchema<typeof schema>
 * // => {
 * //   Product: { $id: string; $type: 'Product'; ... }
 * //   Vendor: { $id: string; $type: 'Vendor'; ... }
 * // }
 * ```
 */
export type InferSchema<TSchema extends RawDatabaseSchema> = {
  [K in keyof TSchema]: InferEntity<TSchema, K>
}

// =============================================================================
// Entity Operations Types
// =============================================================================

/**
 * Input type for creating an entity (omits $id, $type, and timestamps)
 */
export type CreateInput<T> = Omit<T, '$id' | '$type' | '$createdAt' | '$updatedAt'>

/**
 * Input type for updating an entity (partial, omits $id, $type)
 */
export type UpdateInput<T> = Partial<Omit<T, '$id' | '$type' | '$createdAt' | '$updatedAt'>>

/**
 * Type for entity with required $id and $type
 */
export type EntityWithId<T> = T & { $id: string; $type: string }

// =============================================================================
// Typed Entity Operations
// =============================================================================

/**
 * Entity list options
 */
export interface ListOptions {
  /** Maximum number of results */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** Filter conditions */
  where?: Record<string, unknown>
  /** Order by field */
  orderBy?: string
  /** Order direction */
  order?: 'asc' | 'desc'
}

/**
 * Typed entity accessor operations
 *
 * @example
 * ```typescript
 * // These operations are available via $.Entity.* or $.Entity(id).*
 * interface ProductAccessor extends TypedEntityAccessor<Product> {
 *   define(schema): void
 *   create(data: CreateInput<Product>): Promise<Product>
 *   list(options?: ListOptions): Promise<Product[]>
 * }
 *
 * // Single entity access
 * $.Product(id).get()     // Promise<Product | null>
 * $.Product(id).update()  // Promise<Product>
 * $.Product(id).delete()  // Promise<void>
 * ```
 */
export interface TypedEntityAccessor<T> {
  /** Define the schema for this entity type */
  define(schema: Record<string, unknown>): void
  /** Create a new entity */
  create(data: CreateInput<T>): Promise<T>
  /** List entities of this type */
  list(options?: ListOptions): Promise<T[]>
}

/**
 * Single entity instance operations
 */
export interface TypedEntityInstance<T> {
  /** Get the entity by ID */
  get(): Promise<T | null>
  /** Update the entity */
  update(data: UpdateInput<T>): Promise<T>
  /** Delete the entity */
  delete(): Promise<void>
}

/**
 * Combined entity proxy type (callable for instance access + static methods)
 */
export type TypedEntityProxy<T> =
  TypedEntityAccessor<T> & ((id: string) => TypedEntityInstance<T>)

// =============================================================================
// Database Type
// =============================================================================

/**
 * Typed database instance with entity accessors
 *
 * @example
 * ```typescript
 * const schema = {
 *   Product: { sku: 'string!', name: 'string!' },
 *   Vendor: { name: 'string!' },
 * } as const
 *
 * type DB = TypedDB<typeof schema>
 * // DB has typed Product and Vendor accessors
 *
 * declare const $: WorkflowContext & DB
 *
 * // Typed create
 * const product = await $.Product.create({ sku: 'SKU001', name: 'Widget' })
 * //    ^? Product
 *
 * // Typed get
 * const p = await $.Product(id).get()
 * //    ^? Product | null
 *
 * // Typed list
 * const products = await $.Product.list()
 * //    ^? Product[]
 * ```
 */
export type TypedDB<TSchema extends RawDatabaseSchema> = {
  [K in keyof TSchema]: TypedEntityProxy<InferEntity<TSchema, K>>
}

// =============================================================================
// Helper Types for Schema Definition
// =============================================================================

/**
 * Helper type to ensure schema is defined with `as const`
 *
 * @example
 * ```typescript
 * // Use with as const for type inference
 * const schema = {
 *   Product: { sku: 'string!' },
 * } as const satisfies SchemaDefinition
 *
 * type Product = InferEntity<typeof schema, 'Product'>
 * ```
 */
export type SchemaDefinition = RawDatabaseSchema

/**
 * Validate that a schema type extends RawDatabaseSchema
 */
export type ValidateSchema<T extends RawDatabaseSchema> = T

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Extract entity names from a schema
 */
export type EntityNames<TSchema extends RawDatabaseSchema> = keyof TSchema & string

/**
 * Extract all entity types from a schema as a union
 */
export type AnyEntity<TSchema extends RawDatabaseSchema> = InferSchema<TSchema>[keyof TSchema]

/**
 * Get relation field names from an entity
 */
export type RelationFields<TSchema extends RawDatabaseSchema, TEntity extends keyof TSchema> = {
  [K in keyof TSchema[TEntity]]: TSchema[TEntity][K] extends string
    ? IsRelation<TSchema[TEntity][K]> extends true
      ? K
      : never
    : never
}[keyof TSchema[TEntity]]

/**
 * Get non-relation (data) field names from an entity
 */
export type DataFields<TSchema extends RawDatabaseSchema, TEntity extends keyof TSchema> = {
  [K in keyof TSchema[TEntity]]: K extends `$${string}`
    ? never
    : TSchema[TEntity][K] extends string
    ? IsRelation<TSchema[TEntity][K]> extends true
      ? never
      : K
    : K
}[keyof TSchema[TEntity]]
