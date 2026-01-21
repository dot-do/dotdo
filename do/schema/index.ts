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
