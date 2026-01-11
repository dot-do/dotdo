/**
 * Schema Core - Cascade Generation System
 *
 * The schema IS the workflow - relationships define generation flow without
 * explicit orchestration code.
 *
 * Four Cascade Operators:
 * | Operator | Direction | Method | Behavior |
 * |----------|-----------|--------|----------|
 * | `->`     | Forward   | Insert | Generate NEW, link TO it |
 * | `~>`     | Forward   | Search | Semantic search, generate if not found |
 * | `<-`     | Backward  | Insert | Generate NEW, link FROM it |
 * | `<~`     | Backward  | Search | Semantic search, link FROM found |
 *
 * @example
 * ```typescript
 * import { DB, GenerationEngine } from 'dotdo/db/schema'
 *
 * const schema = DB({
 *   Startup: {
 *     idea: '<-Idea',
 *     customer: '~>ICP',
 *     founders: ['->Founder'],
 *     model: '->LeanCanvas',
 *   },
 * })
 *
 * const engine = new GenerationEngine(schema)
 * const startup = await engine.generate('Startup', { name: 'Acme' })
 * ```
 */

// ============================================================================
// DB FACTORY
// ============================================================================

export { DB } from './db-factory'

// ============================================================================
// PARSE SCHEMA
// ============================================================================

export { parseSchema } from './parse-schema'

// ============================================================================
// TYPES
// ============================================================================

export type {
  // Schema Types
  SchemaDefinition,
  SchemaMetadata,
  SchemaFunctions,
  ParsedSchema,
  ParsedType,
  ParsedField,
  DBSchema,
  CascadeOperator,

  // Legacy Types (for backwards compatibility)
  LegacyParsedField,
  LegacyParsedType,
  LegacyParsedSchema,

  // Entity Types
  Entity,
  BaseEntity,
  Relationship,
  TypedEntity,

  // Field Types (new type system)
  BaseField,
  StringField,
  NumberField,
  BooleanField,
  ArrayField,
  ObjectField,
  ReferenceField,
  ComputedField,
  JSONPathField,
  PromptField,
  ReferenceDirection,
  ReferenceMode,
  TypeHooks,
  TypeDefinition,
  FieldInput,

  // Generation Types
  GenerationOptions,
  GenerationMetrics,
  CascadeResult,
  FieldResolution,
  BatchOperation,

  // Dependency Graph Types
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
} from './types'

// ============================================================================
// ERRORS
// ============================================================================

export {
  CircularDependencyError,
  GenerationFailedError,
  SchemaParseError,
} from './types'

// ============================================================================
// GENERATION ENGINE
// ============================================================================

export { GenerationEngine } from './engine'
export type { GenerationEngineOptions } from './engine'

// ============================================================================
// RESOLVERS
// ============================================================================

export {
  ForwardCascadeResolver,
  resolveForwardInsert,
  resolveForwardSearch,
} from './resolvers/forward'

export type {
  ParsedReference,
  GenerationContext,
  SemanticSearchResult,
  TypeSchema,
  GenerateOptions,
  SemanticSearchOptions,
  CreateRelationshipOptions,
  ForwardCascadeResolverOptions,
  ShorthandReference,
} from './resolvers/forward'

// ============================================================================
// MDX SCHEMA PARSER
// ============================================================================

export {
  parseMdxSchema,
  discoverSchemaFiles,
  loadAndMergeSchemas,
} from './mdx'

export type {
  MdxSchema,
  MdxEntity,
  MdxFieldType,
  DiscoveryOptions,
  MergedMdxSchema,
} from './mdx'
