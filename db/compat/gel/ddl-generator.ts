/**
 * DDL Generator - Stub Implementation
 *
 * This is a stub file that allows tests to run and fail properly.
 * The actual implementation will be done in the GREEN phase.
 *
 * Converts Schema IR from SDL Parser to SQLite DDL statements.
 */

import type { Schema } from './sdl-parser'

export interface GeneratedDDL {
  /** CREATE TABLE statements */
  tables: string[]
  /** CREATE INDEX statements */
  indexes: string[]
  /** CREATE TRIGGER statements (for computed properties, readonly enforcement, updated_at) */
  triggers: string[]
  /** CREATE VIEW statements (for backlinks) */
  views: string[]
}

export interface DDLGeneratorOptions {
  /** Inheritance strategy: 'sti' (Single Table) or 'cti' (Class Table) */
  inheritanceStrategy?: 'sti' | 'cti'
  /** Whether to generate metadata tables (_types, _enums, etc.) */
  generateMetadata?: boolean
  /** Whether to add _created_at and _updated_at columns */
  addTimestamps?: boolean
  /** Whether to add _type discriminator column for inheritance */
  addTypeColumn?: boolean
}

/**
 * Generate SQLite DDL from Schema IR
 *
 * @param schema - The Schema IR from SDL Parser
 * @param options - Optional generator configuration
 * @returns Generated DDL statements organized by category
 * @throws Error if schema contains unsupported constructs
 */
export function generateDDL(schema: Schema, options?: DDLGeneratorOptions): GeneratedDDL {
  throw new Error('DDL generator not implemented')
}

/**
 * Map EdgeDB/Gel scalar type to SQLite type
 *
 * @param sdlType - The SDL scalar type (e.g., 'str', 'int32', 'datetime')
 * @returns The corresponding SQLite type
 */
export function mapScalarType(sdlType: string): string {
  throw new Error('mapScalarType not implemented')
}

/**
 * Convert PascalCase or camelCase to snake_case
 *
 * @param name - The name to convert
 * @returns The snake_case version
 */
export function toSnakeCase(name: string): string {
  throw new Error('toSnakeCase not implemented')
}

/**
 * Generate the column definition for a property
 *
 * @param name - Column name
 * @param type - SDL type
 * @param required - Whether the column is NOT NULL
 * @param defaultValue - Optional default value
 * @param constraints - Optional constraints
 * @returns SQL column definition fragment
 */
export function generateColumnDef(
  name: string,
  type: string,
  required: boolean,
  defaultValue?: string | number | boolean,
  constraints?: string[]
): string {
  throw new Error('generateColumnDef not implemented')
}

/**
 * Generate a CHECK constraint from EdgeDB constraint
 *
 * @param constraintType - The constraint type (e.g., 'min_value', 'max_len_value')
 * @param columnName - The column name
 * @param value - The constraint value
 * @returns SQL CHECK constraint clause
 */
export function generateCheckConstraint(
  constraintType: string,
  columnName: string,
  value: number | string
): string {
  throw new Error('generateCheckConstraint not implemented')
}

/**
 * Generate junction table for multi-link
 *
 * @param sourceType - The source type name
 * @param linkName - The link name
 * @param targetType - The target type name
 * @param linkProperties - Optional link properties
 * @returns CREATE TABLE statement for junction table
 */
export function generateJunctionTable(
  sourceType: string,
  linkName: string,
  targetType: string,
  linkProperties?: Array<{ name: string; type: string; required: boolean }>
): string {
  throw new Error('generateJunctionTable not implemented')
}
