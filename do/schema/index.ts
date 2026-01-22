/**
 * Unified Schema Module
 *
 * Provides schema parsing and type definitions for the unified schema format
 * that supports both IceType modifiers and ai-database prompt fields.
 *
 * @module do/schema
 */

// Types
export * from './types'

// Type Inference (do-lekf.7)
export type {
  InferEntity,
  InferSchema,
  CreateInput,
  UpdateInput,
  TypedEntityAccessor,
  TypedEntityInstance,
  TypedEntityProxy,
  TypedDB,
  SchemaDefinition,
  ValidateSchema,
  EntityNames,
  AnyEntity,
  RelationFields,
  DataFields,
  ListOptions,
  // Field type inference utilities (do-lekf.7)
  InferFieldType,
  InferRelationType,
  InferRelationOperator,
  InferRelationTarget,
  IsPromptField,
  IsIndexedField,
} from './infer'

// Parser
export {
  parseSchema,
  parseEntitySchema,
  parseFieldDefinition,
  parseRelation,
  isPromptField,
  isRelationField,
  getEntityNames,
  getRelationFields,
  isGeneratedField,
  // Relation operator helpers (do-lekf.5)
  hasOne,
  hasMany,
  belongsTo,
  manyToMany,
  fuzzyRelation,
  fuzzyBackref,
  // Relation helper option types (do-lekf.5)
  type HasOneOptions,
  type FuzzyRelationOptions,
  type FuzzyBackrefOptions,
} from './parser'

// DDL Generator (do-lekf.3)
export {
  generateEntityDDL,
  generateSchemaDDL,
  generateTableExistsQuery,
  generateMigrationDDL,
  type DDLOptions,
  type DDLResult,
} from './ddl'

// Relation Operators (do-lekf.5)
export {
  // Class
  RelationsManager,
  // Standalone functions
  createRelation,
  resolveRelation,
  deleteRelation,
  // Entity integration helpers
  extractForeignKeys,
  autoCreateRelations,
  expandEntityRelations,
  // Types
  type RelationsConfig,
  type ResolvedRelation,
  type ResolveOptions,
  type CreateRelationInput,
  type DeleteRelationInput,
} from './relations'

// AI-Generated Fields (do-lekf.4) - Temporarily disabled due to @dotdo/ai circular dependency
// TODO: Refactor ai-fields.ts to accept AI function as parameter instead of importing @dotdo/ai
// export {
//   // Main generation functions
//   generateFieldValue,
//   generateFieldValueWithResult,
//   generateAllFields,
//   generateAllFieldsSimple,
//   // Utility functions
//   buildAIPrompt,
//   getFieldsNeedingGeneration,
//   hasGeneratedFields,
//   getGeneratedFieldDefinitions,
//   createDefaultAIGenerate,
//   // Types
//   type AIGenerationContext,
//   type AIGenerateFunction,
//   type AIFieldOptions,
//   type FieldGenerationResult,
//   type AllFieldsGenerationResult,
// } from './ai-fields'
