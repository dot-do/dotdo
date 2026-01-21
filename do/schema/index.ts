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
} from './parser'
