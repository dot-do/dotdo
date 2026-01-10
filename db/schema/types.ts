/**
 * Type definitions for the Schema Core Cascade Generation System
 */

/**
 * Schema-level functions that can be attached via $fn
 */
export interface SchemaFunctions {
  validate?: (entity: unknown) => boolean
  beforeSave?: (entity: unknown) => unknown
  afterCreate?: (entity: unknown) => void
  onCreate?: () => void
  onUpdate?: () => void
  onDelete?: () => void
  transform?: (entity: unknown) => unknown
  authorize?: () => boolean
  [key: string]: ((...args: unknown[]) => unknown) | undefined
}

/**
 * Metadata extracted from $ directives in schema
 */
export interface SchemaMetadata {
  $id?: string
  $context?: string
  $version?: string
  $fn?: SchemaFunctions
}

/**
 * Cascade operators for field references
 * -> Forward insert
 * ~> Forward search
 * <- Backward insert
 * <~ Backward search
 */
export type CascadeOperator = '->' | '~>' | '<-' | '<~'

/**
 * Legacy parsed field definition (used by parse-schema.ts)
 * @deprecated Use ParsedField union type instead
 */
export interface LegacyParsedField {
  name: string
  type: string
  required: boolean
  isArray?: boolean
  isNested?: boolean
  nestedFields?: LegacyParsedField[]
  operator?: CascadeOperator
  reference?: string
  prompt?: string
}

/**
 * Legacy parsed type definition (used by parse-schema.ts)
 * @deprecated Use ParsedType with Record<string, ParsedField> instead
 */
export interface LegacyParsedType {
  name: string
  fields: LegacyParsedField[]
}

/**
 * Result of parseSchema() - uses legacy types for backwards compatibility
 */
export interface LegacyParsedSchema {
  metadata: SchemaMetadata
  types: LegacyParsedType[]
  getType: (name: string) => LegacyParsedType | undefined
  hasType: (name: string) => boolean
  getFieldsForType: (name: string) => LegacyParsedField[]
}

// Backwards compatibility alias
export type ParsedSchema = LegacyParsedSchema

/**
 * Schema definition input (what users pass to DB())
 */
export interface SchemaDefinition {
  $id?: string
  $context?: string
  $version?: string
  $fn?: SchemaFunctions
  [key: string]: unknown
}

/**
 * Result of DB() factory - wraps ParsedSchema with direct metadata access
 * Uses legacy types for backwards compatibility
 */
export interface DBSchema<T extends SchemaDefinition = SchemaDefinition> {
  $id?: string
  $context?: string
  $version?: string
  $fn?: SchemaFunctions
  types: Map<string, LegacyParsedType>
  getType: (name: string) => LegacyParsedType | undefined
  // Dynamic access to type definitions by name
  [key: string]: LegacyParsedType | string | SchemaFunctions | Map<string, LegacyParsedType> | ((name: string) => LegacyParsedType | undefined) | undefined
}

// ============================================================================
// Entity and Relationship Types
// ============================================================================

/**
 * Base entity interface with required $id and $type.
 * @deprecated Use Entity<T> for typed entities or BaseEntity for untyped
 */
export interface BaseEntity {
  $id: string
  $type: string
  [key: string]: unknown
}

/**
 * Relationship between two entities.
 */
export interface Relationship {
  id: string
  from: string
  to: string
  verb: string
  data?: Record<string, unknown> | null
  createdAt: Date
}

// ============================================================================
// Generation Types
// ============================================================================

/**
 * Options for entity generation.
 */
export interface GenerationOptions {
  seed?: Partial<BaseEntity>
  $context?: string
  $seed?: Record<string, unknown>
  model?: string
  temperature?: number
  maxTokens?: number
  dryRun?: boolean
  validateOnly?: boolean
  depth?: number
  maxDepth?: number
  fuzzyThreshold?: number
  maxConcurrency?: number
  relationshipBatchSize?: number
  persistCache?: boolean
  cacheKey?: string
  memoryWarningThresholdMb?: number
  timeout?: number
  retryCount?: number
  batchSize?: number
  onWarning?: (warning: string) => void
  onGenerationError?: (error: Error) => void
  generateId?: (type: string) => string
  generateVerb?: (field: string, direction: string) => string
}

/**
 * Resolution information for a field.
 */
export interface FieldResolution {
  field: string
  method: 'found' | 'generated'
  entityId: string
  similarity?: number
}

/**
 * Metrics from a generation operation.
 */
export interface GenerationMetrics {
  totalTimeMs: number
  startTime: Date
  endTime: Date
  aiGenerationTimeMs: number
  entitiesGenerated: number
  entitiesByType: Record<string, number>
  relationshipsCreated: number
  relationshipBatches: number
  parallelBatches: number
  parallelizableFields: string[]
  generationOrder: string[]
  timeByType: Record<string, number>
  fuzzySearchCount: number
  cacheHits: number
  arrayParallelGeneration: boolean
  maxConcurrentOperations: number
  transactionCount: number
  nestedTransactions: number
  memoryUsage: {
    heapUsed: number
    peak: number
  }
}

/**
 * Result of a cascade generation operation.
 */
export interface CascadeResult<T = BaseEntity> {
  entity: T
  generated: BaseEntity[]
  relationships: Relationship[]
  resolutions: FieldResolution[]
  metrics: GenerationMetrics
}

/**
 * Batch operation for relationship creation.
 */
export interface BatchOperation {
  type: 'relationship'
  data: Partial<Relationship>[]
}

// ============================================================================
// Dependency Graph Types
// ============================================================================

/**
 * Node in the dependency graph.
 */
export interface DependencyNode {
  type: string
  dependsOn: string[]
  dependedOnBy: string[]
  softDependsOn: string[]
}

/**
 * Edge in the dependency graph.
 */
export interface DependencyEdge {
  from: string
  to: string
  isArray?: boolean
  isSoft?: boolean
}

/**
 * Dependency graph for cascade resolution.
 */
export interface DependencyGraph {
  nodes: string[]
  edges: DependencyEdge[]
  parallelGroups: string[][]
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when a circular dependency is detected.
 */
export class CircularDependencyError extends Error {
  cyclePath: string[]

  constructor(cyclePath: string[]) {
    super(`Circular dependency detected: ${cyclePath.join(' -> ')}`)
    this.name = 'CircularDependencyError'
    this.cyclePath = cyclePath
  }
}

/**
 * Error thrown when generation fails.
 */
export class GenerationFailedError extends Error {
  partialResults: Record<string, BaseEntity>

  constructor(message: string, partialResults: Record<string, BaseEntity> = {}) {
    super(message)
    this.name = 'GenerationFailedError'
    this.partialResults = partialResults
  }
}

/**
 * Error thrown when schema parsing fails.
 */
export class SchemaParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaParseError'
  }
}

/**
 * Error thrown when context token limit is exceeded.
 */
export class ContextOverflowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContextOverflowError'
  }
}

/**
 * Error thrown when required context is missing.
 */
export class MissingContextError extends Error {
  missingKeys: string[]

  constructor(missingKeys: string[], message?: string) {
    super(message ?? `Missing required context: ${missingKeys.join(', ')}`)
    this.name = 'MissingContextError'
    this.missingKeys = missingKeys
  }
}

// ============================================================================
// Generation Engine Types (Extended)
// ============================================================================

/**
 * Extended parsed field for generation engine with target info
 */
export interface GenerationParsedField {
  type: string
  prompt?: string
  isArray?: boolean
  isOptional?: boolean
  operator?: CascadeOperator
  target?: string
  elementType?: string
  subfields?: Record<string, GenerationParsedField>
  conditionalPrompts?: Record<string, string>
  requiresContext?: string[]
  optional?: boolean
}

/**
 * Schema directives for type-level configuration
 */
export interface SchemaDirectives {
  $context?: string
  $seed?: Record<string, unknown>
  $examples?: Array<Record<string, unknown>>
  $format?: string
  $jsonSchema?: Record<string, unknown>
  $constraints?: {
    minLength?: number
    maxLength?: number
    pattern?: string
    [key: string]: unknown
  }
  $requiresParent?: boolean
  $model?: string
  $maxTokens?: number
  $prefix?: string
  [key: string]: unknown
}

/**
 * Parsed type for generation engine with directives
 */
export interface GenerationParsedType {
  name: string
  fields: Record<string, GenerationParsedField>
  directives: SchemaDirectives
}

/**
 * Complete parsed schema for generation engine
 */
export interface GenerationParsedSchema {
  types: Record<string, GenerationParsedType>
  directives: SchemaDirectives
}

/**
 * Generation plan for dry-run mode
 */
export interface GenerationPlan {
  typesToGenerate: string[]
  estimatedTokens?: number
  dependencies: Record<string, string[]>
}

/**
 * Validation error for generation
 */
export interface GenerationValidationError {
  field: string
  type: 'format' | 'required' | 'constraint' | 'type' | 'missing_parent'
  message?: string
}

/**
 * Generation result with all metadata
 */
export interface GenerationResult<T = BaseEntity> {
  entity: T
  parsedSchema: GenerationParsedSchema
  dependencyGraph: EngineDepGraph
  generationOrder: string[]
  relationships: Relationship[]
  method: 'code' | 'generative' | 'agentic' | 'human'
  dryRun?: boolean
  plan?: GenerationPlan
  valid?: boolean
  errors?: GenerationValidationError[]
}

/**
 * Dependency graph node for engine
 */
export interface EngineDepNode {
  name: string
  dependsOn: string[]
  dependedOnBy: string[]
  softDependsOn: string[]
}

/**
 * Dependency graph edge for engine
 */
export interface EngineDepEdge {
  from: string
  to: string
  isArray: boolean
  operator: string
  fieldName: string
}

/**
 * Engine dependency graph
 */
export interface EngineDepGraph {
  nodes: Record<string, EngineDepNode>
  edges: EngineDepEdge[]
}

/**
 * Field instruction for generation
 */
export interface FieldInstruction {
  field: string
  prompt: string
}

/**
 * Context snapshot
 */
export interface ContextSnapshot {
  generatedCount: number
  parentDepth: number
  timestamp: Date
}

/**
 * Context options
 */
export interface ContextOptions {
  schema: GenerationParsedSchema
  namespace: string
  maxContextTokens?: number
  autoCompact?: boolean
}

/**
 * Context validation result
 */
export interface ContextValidationResult {
  valid: boolean
  errors: GenerationValidationError[]
}

// ============================================================================
// Type System for db4ai-style Cascade Generation
// ============================================================================

// Base Field Type
export interface BaseField {
  prompt?: string
  required?: boolean
  default?: unknown
}

// Primitive Field Types
export interface StringField extends BaseField {
  kind: 'string'
  prompt?: string
  default?: string
  pattern?: string
  minLength?: number
  maxLength?: number
}

export interface NumberField extends BaseField {
  kind: 'number'
  prompt?: string
  default?: number
  min?: number
  max?: number
  integer?: boolean
}

export interface BooleanField extends BaseField {
  kind: 'boolean'
  prompt?: string
  default?: boolean
}

// Complex Field Types
export interface ArrayField extends BaseField {
  kind: 'array'
  prompt?: string
  items: KindParsedField
  minItems?: number
  maxItems?: number
}

export interface ObjectField extends BaseField {
  kind: 'object'
  prompt?: string
  fields: Record<string, KindParsedField>
}

// Reference Field Types
export type ReferenceDirection = 'forward' | 'backward'
export type ReferenceMode = 'exact' | 'fuzzy'

export interface ReferenceField extends BaseField {
  kind: 'reference'
  target: string | string[]
  direction: ReferenceDirection
  mode: ReferenceMode
  prompt?: string
  optional?: boolean
}

// Computed Field Types
export interface ComputedField {
  kind: 'computed'
  compute: (entity: unknown) => unknown
  returnType: string
  async?: boolean
  dependencies?: string[]
}

// JSONPath Field Types
export interface JSONPathField extends BaseField {
  kind: 'jsonpath'
  path: string
  source: string
  default?: unknown
}

// Prompt Field Types (AI Generation)
export interface PromptField extends BaseField {
  kind: 'prompt'
  prompt: string
  model?: string
  outputSchema?: Record<string, string>
  temperature?: number
  maxTokens?: number
}

// KindParsedField Union - All possible field types with kind discriminator
export type KindParsedField =
  | StringField
  | NumberField
  | BooleanField
  | ArrayField
  | ObjectField
  | ReferenceField
  | ComputedField
  | JSONPathField
  | PromptField

// Type Definition Hooks
export interface TypeHooks {
  created?: (entity: unknown) => Promise<unknown>
  updated?: (entity: unknown, changes: unknown) => Promise<unknown>
  deleted?: (entity: unknown) => Promise<void>
  beforeCreate?: (data: Record<string, unknown>) => Promise<Record<string, unknown>>
}

// KindParsedType Structure
export interface KindParsedType {
  name: string
  fields: Record<string, KindParsedField>
  references: string[]
  seed?: Array<Record<string, unknown>>
  icon?: string
  group?: string
  instructions?: string
  hooks?: TypeHooks
}

// TypeDefinition (Input format for defining types)
export type TypeDefinition = Record<string, FieldInput>

// FieldInputBase - base types for field input (non-recursive)
export type FieldInputBase =
  | string                                    // "What is the name?" -> StringField
  | [string]                                  // ["What are the tags?"] -> ArrayField of strings
  | ((entity: unknown) => unknown)            // Compute function -> ComputedField

// FieldInput (Flexible input that gets normalized to ParsedField)
export type FieldInput =
  | FieldInputBase
  | { [key: string]: FieldInputBase | FieldInput }  // Nested object -> ObjectField

// Entity<T> Type - Derives entity type from definition
type InferFieldType<T> =
  // String prompt -> string
  T extends string
    ? T extends `${string}->${string}?`
      ? { $id: string; $type: string; [key: string]: unknown } | undefined
      : T extends `${string}->${string}`
        ? { $id: string; $type: string; [key: string]: unknown }
        : T extends `->${string}?`
          ? { $id: string; $type: string; [key: string]: unknown } | undefined
          : T extends `->${string}`
            ? { $id: string; $type: string; [key: string]: unknown }
            : T extends `~>${string}`
              ? { $id: string; $type: string; [key: string]: unknown }
              : T extends `<-${string}`
                ? { $id: string; $type: string; [key: string]: unknown }
                : T extends `<~${string}`
                  ? { $id: string; $type: string; [key: string]: unknown }
                  : string
  // Array prompt -> array
  : T extends [infer Item]
    ? Item extends string
      ? Item extends `->${string}`
        ? Array<{ $id: string; $type: string; [key: string]: unknown }>
        : string[]
      : unknown[]
  // Object definition -> nested object
  : T extends Record<string, unknown>
    ? { [K in keyof T]: InferFieldType<T[K]> }
  // Function -> return type (simplified to unknown for now)
  : T extends (entity: unknown) => infer R
    ? R extends Promise<infer U>
      ? U
      : R
  : unknown

/**
 * TypedEntity<T> - Main type that derives fields from a type definition
 *
 * Every Entity has:
 * - $id: string - Unique identifier
 * - $type: string - Type name
 * - All fields from the definition, typed correctly
 */
export type TypedEntity<T extends TypeDefinition = TypeDefinition> = {
  $id: string
  $type: string
} & {
  [K in keyof T]: InferFieldType<T[K]>
}

// ============================================================================
// Type Aliases for Tests and New API
// ============================================================================

/**
 * ParsedField - Union of all field types with kind discriminator
 * Used by the new type system for cascade generation
 */
export type ParsedField = KindParsedField

/**
 * ParsedType - Type definition with fields as Record and references array
 * Used by the new type system for cascade generation
 */
export type ParsedType = KindParsedType

/**
 * Entity<T> - Generic entity type that derives fields from a type definition
 * Overload the Entity interface to support both:
 * - Entity (base interface with $id, $type, and index signature)
 * - Entity<T> (generic type with derived fields)
 */
export type { TypedEntity as Entity }
