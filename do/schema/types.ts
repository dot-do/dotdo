/**
 * Unified Schema Types
 *
 * Type definitions for the unified schema parser that handles both
 * IceType modifiers and ai-database prompt fields.
 *
 * @packageDocumentation
 */

// =============================================================================
// Primitive Types
// =============================================================================

/**
 * IceType primitive types
 */
export type PrimitiveType =
  | 'string'
  | 'text'
  | 'int'
  | 'long'
  | 'bigint'
  | 'float'
  | 'double'
  | 'bool'
  | 'boolean'
  | 'timestamp'
  | 'timestamptz'
  | 'date'
  | 'time'
  | 'uuid'
  | 'json'
  | 'binary'
  | 'number'
  | 'datetime'
  | 'markdown'
  | 'url'

/**
 * Parametric types that take numeric arguments
 */
export type ParametricType = 'decimal' | 'varchar' | 'char' | 'fixed'

/**
 * Generic types that use angle brackets
 */
export type GenericType = 'map' | 'struct' | 'enum' | 'ref' | 'list'

// =============================================================================
// Field Modifiers
// =============================================================================

/**
 * IceType field modifiers
 * - `!` - required (implies unique for some use cases)
 * - `#` - indexed/unique
 * - `?` - optional
 * - `` - no modifier (default)
 */
export type FieldModifier = '!' | '#' | '?' | ''

// =============================================================================
// Relation Operators
// =============================================================================

/**
 * Relation operators for connecting entities
 * - `->` - forward exact relation (foreign key)
 * - `<-` - backward exact relation (reverse reference)
 * - `~>` - forward fuzzy relation (AI/semantic matching)
 * - `<~` - backward fuzzy relation (AI reverse lookup)
 */
export type RelationOperator = '->' | '~>' | '<-' | '<~'

/**
 * Direction of the relationship
 */
export type RelationDirection = 'forward' | 'backward'

/**
 * Match mode for resolving relationships
 */
export type MatchMode = 'exact' | 'fuzzy'

// =============================================================================
// Parsed Field Definition
// =============================================================================

/**
 * Parsed field definition from the unified parser
 *
 * Handles both IceType syntax and ai-database prompt fields
 */
export interface FieldDefinition {
  /** Field name */
  name: string

  /** Base type (e.g., 'string', 'int', 'User') */
  type: string

  /** Field modifier (!, #, ?, or empty) */
  modifier: FieldModifier

  /** Whether field is required (! modifier) */
  required: boolean

  /** Whether field is optional (? modifier) */
  optional: boolean

  /** Whether field is indexed */
  indexed: boolean

  /** Whether field has unique constraint */
  unique: boolean

  /** Whether field is an array */
  array: boolean

  /** Default value if specified */
  defaultValue?: unknown

  /** Precision for decimal types */
  precision?: number

  /** Scale for decimal types */
  scale?: number

  /** Length for varchar/char types */
  length?: number

  /** Relation definition if this is a relation field */
  relation?: RelationDefinition

  /** Prompt for AI generation (ai-database style) */
  prompt?: string

  /** Whether this field is AI-generated */
  generated: boolean
}

// =============================================================================
// Relation Definition
// =============================================================================

/**
 * Parsed relation definition
 */
export interface RelationDefinition {
  /** Relation operator (->, ~>, <-, <~) */
  operator: RelationOperator

  /** Direction of the relationship */
  direction: RelationDirection

  /** Match mode for resolution */
  matchMode: MatchMode

  /** Target entity type */
  targetType: string

  /** Backref field name on target (for bidirectional relations) */
  backref?: string

  /** Union types for polymorphic references (e.g., ->A|B|C) */
  unionTypes?: string[]

  /** Similarity threshold for fuzzy matching (0-1) */
  threshold?: number

  /** Whether this relation targets an array */
  array?: boolean

  /** Whether this relation is optional */
  optional?: boolean

  /** Cascade behavior on delete */
  onDelete?: 'cascade' | 'set_null' | 'restrict'
}

// =============================================================================
// Schema Directives
// =============================================================================

/**
 * Schema-level directives ($ prefixed)
 */
export interface SchemaDirectives {
  /** AI generation instructions/context */
  $instructions?: string

  /** Fuzzy matching threshold (0-1) */
  $fuzzyThreshold?: number

  /** Composite indexes */
  $index?: string[][]

  /** Partition key fields */
  $partitionBy?: string[]

  /** Full-text search fields */
  $fts?: string[]

  /** Vector index configuration */
  $vector?: Record<string, number>

  /** Schema/entity type name */
  $type?: string

  /** Primary key field mapping (for seeding) */
  $id?: string

  /** Context for JSON-LD */
  $context?: string | Record<string, unknown>

  /** Seed data URL */
  $seed?: string

  /** Read-only flag */
  $readonly?: boolean

  /** TTL configuration */
  $ttl?: number

  /** Order by default */
  $orderBy?: string
}

// =============================================================================
// Unified Schema
// =============================================================================

/**
 * Parsed entity schema
 */
export interface EntitySchema {
  /** Entity name/type */
  name: string

  /** Parsed field definitions */
  fields: Map<string, FieldDefinition>

  /** Schema directives */
  directives: SchemaDirectives

  /** Parsed relation definitions */
  relations: Map<string, RelationDefinition>

  /** Schema version */
  version: number

  /** Creation timestamp */
  createdAt: number

  /** Last update timestamp */
  updatedAt: number
}

/**
 * Complete unified schema
 */
export interface UnifiedSchema {
  /** All parsed entities */
  entities: Map<string, EntitySchema>
}

// =============================================================================
// Raw Schema Input Types
// =============================================================================

/**
 * Raw field definition input (string or array literal)
 */
export type RawFieldDefinition = string | [string]

/**
 * Raw entity schema definition input
 */
export type RawEntitySchema = {
  [key: string]: RawFieldDefinition | unknown
} & Partial<SchemaDirectives>

/**
 * Raw database schema definition input
 */
export type RawDatabaseSchema = Record<string, RawEntitySchema>

// =============================================================================
// Parse Result Types
// =============================================================================

/**
 * Result of parsing a field definition string
 */
export interface ParsedFieldResult {
  /** The base type name */
  type: string

  /** Whether type is required (!) */
  required: boolean

  /** Whether type is optional (?) */
  optional: boolean

  /** Whether type is indexed/unique (#) */
  indexed: boolean

  /** Whether type is unique */
  unique: boolean

  /** Whether type is an array */
  array: boolean

  /** Default value */
  defaultValue?: unknown

  /** Precision for decimal */
  precision?: number

  /** Scale for decimal */
  scale?: number

  /** Length for varchar/char */
  length?: number

  /** Key type for map */
  keyType?: string

  /** Value type for map */
  valueType?: string

  /** Struct name */
  structName?: string

  /** Enum name */
  enumName?: string

  /** Reference target */
  refTarget?: string

  /** List element type */
  elementType?: string

  /** Relation definition */
  relation?: RelationDefinition

  /** Prompt for AI generation */
  prompt?: string

  /** Whether this is an AI-generated field */
  generated: boolean
}

// =============================================================================
// Validation Types
// =============================================================================

/**
 * Validation error
 */
export interface ValidationError {
  /** Path to the error (field name or directive) */
  path: string

  /** Error message */
  message: string

  /** Error code */
  code: string
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean

  /** Validation errors */
  errors: ValidationError[]

  /** Validation warnings */
  warnings: ValidationError[]
}
