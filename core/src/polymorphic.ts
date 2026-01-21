/**
 * @dotdo/core - Polymorphic Collections
 *
 * Support for type hierarchies where collections can have sub-types.
 * For example, a "Function" collection can contain:
 * - CodeFunction
 * - GenerativeFunction
 * - AgenticFunction
 * - HumanFunction
 *
 * All sub-types share a base schema and can be queried together or separately.
 */

import type { StorableData, Thing, JsonObject } from './types'

// =============================================================================
// Type Definition Schema
// =============================================================================

/**
 * Field type definitions
 *
 * Modifiers:
 * - `!` required
 * - `?` optional
 * - `#` indexed
 * - `[]` array
 *
 * @example
 * ```typescript
 * const UserSchema: TypeDefinition = {
 *   $type: 'User',
 *   $index: [['email'], ['createdAt']],
 *
 *   id: 'uuid!',
 *   email: 'string#',      // indexed
 *   name: 'string!',
 *   age: 'int?',           // optional
 *   tags: 'string[]?',     // optional array
 * }
 * ```
 */
export interface TypeDefinition {
  /** Type name */
  $type: string

  /** Parent type to inherit from (enables polymorphism) */
  $extends?: string

  /** Whether this type is abstract (cannot be instantiated) */
  $abstract?: boolean

  /** Index definitions */
  $index?: string[][]

  /** Field definitions (string syntax or detailed) */
  [field: string]: unknown
}

/**
 * Detailed field definition
 */
export interface FieldDefinition {
  /** Field type (string, int, float, boolean, uuid, text, json, date) */
  type: string

  /** Whether the field is required */
  required?: boolean

  /** Whether to index this field */
  indexed?: boolean

  /** Whether the field is an array */
  array?: boolean

  /** Default value */
  default?: unknown

  /** Reference to another type (for relations) */
  ref?: string

  /** Reference direction for relations */
  direction?: 'forward' | 'backward'
}

// =============================================================================
// Type Registry
// =============================================================================

/**
 * Type registry entry
 */
export interface TypeRegistryEntry {
  /** Type definition */
  definition: TypeDefinition

  /** Parent type name (if extends), undefined if no parent */
  parent: string | undefined

  /** Child type names */
  children: string[]

  /** All ancestor types (parent chain) */
  ancestors: string[]

  /** All descendant types (child tree) */
  descendants: string[]

  /** Discriminator field name */
  discriminator: string
}

/**
 * Type registry for managing type hierarchies
 *
 * @example
 * ```typescript
 * const registry = new TypeRegistry()
 *
 * registry.register({
 *   $type: 'Function',
 *   $abstract: true,
 *   name: 'string!',
 *   input: 'json!',
 *   output: 'json!'
 * })
 *
 * registry.register({
 *   $type: 'CodeFunction',
 *   $extends: 'Function',
 *   runtime: 'string!',
 *   code: 'text!'
 * })
 *
 * // Get all types in the Function hierarchy
 * const types = registry.getHierarchy('Function')
 * // ['Function', 'CodeFunction', 'GenerativeFunction', ...]
 * ```
 */
export class TypeRegistry {
  private types = new Map<string, TypeRegistryEntry>()

  /**
   * Register a type definition
   */
  register(definition: TypeDefinition): void {
    const entry: TypeRegistryEntry = {
      definition,
      parent: definition.$extends,
      children: [],
      ancestors: [],
      descendants: [],
      discriminator: '$type'
    }

    // Add to parent's children
    if (definition.$extends) {
      const parent = this.types.get(definition.$extends)
      if (parent) {
        parent.children.push(definition.$type)
        entry.ancestors = [definition.$extends, ...parent.ancestors]

        // Update all ancestors' descendants
        for (const ancestorName of entry.ancestors) {
          const ancestor = this.types.get(ancestorName)
          if (ancestor) {
            ancestor.descendants.push(definition.$type)
          }
        }
      }
    }

    this.types.set(definition.$type, entry)
  }

  /**
   * Get a type entry
   */
  get(typeName: string): TypeRegistryEntry | undefined {
    return this.types.get(typeName)
  }

  /**
   * Check if a type is a subtype of another
   */
  isSubtypeOf(typeName: string, parentName: string): boolean {
    const entry = this.types.get(typeName)
    if (!entry) return false
    if (typeName === parentName) return true
    return entry.ancestors.includes(parentName)
  }

  /**
   * Get all types in a hierarchy (the type and all descendants)
   */
  getHierarchy(typeName: string): string[] {
    const entry = this.types.get(typeName)
    if (!entry) return [typeName]
    return [typeName, ...entry.descendants]
  }

  /**
   * Get the base type for a type (root of hierarchy)
   */
  getBaseType(typeName: string): string {
    const entry = this.types.get(typeName)
    if (!entry || entry.ancestors.length === 0) return typeName
    const base = entry.ancestors[entry.ancestors.length - 1]
    return base ?? typeName
  }

  /**
   * Get all registered types
   */
  getAllTypes(): string[] {
    return Array.from(this.types.keys())
  }
}

// =============================================================================
// Polymorphic Query Support
// =============================================================================

/**
 * Options for polymorphic queries
 */
export interface PolymorphicQueryOptions {
  /** The type to query (can be base type or sub-type) */
  type: string

  /** Whether to include sub-types (default: true for non-abstract, false for concrete) */
  includeSubtypes?: boolean

  /** Specific sub-types to include (overrides includeSubtypes) */
  subtypes?: string[]
}

/**
 * Build a type filter for polymorphic queries
 *
 * @param registry - Type registry
 * @param options - Query options
 * @returns Array of type names to include in the query
 */
export function buildTypeFilter(
  registry: TypeRegistry,
  options: PolymorphicQueryOptions
): string[] {
  const { type, includeSubtypes, subtypes } = options

  // If specific subtypes requested, use those
  if (subtypes && subtypes.length > 0) {
    return subtypes
  }

  const entry = registry.get(type)

  // Unknown type - just return it
  if (!entry) {
    return [type]
  }

  // Abstract types always include subtypes
  if (entry.definition.$abstract) {
    return registry.getHierarchy(type)
  }

  // Concrete types: include subtypes if explicitly requested
  if (includeSubtypes === true) {
    return registry.getHierarchy(type)
  }

  // Default: just the type itself
  return [type]
}

// =============================================================================
// Discriminated Union Helpers
// =============================================================================

/**
 * Type guard for discriminated union
 *
 * @example
 * ```typescript
 * interface CodeFunction { $type: 'CodeFunction'; code: string }
 * interface GenerativeFunction { $type: 'GenerativeFunction'; prompt: string }
 * type Function = CodeFunction | GenerativeFunction
 *
 * const fn: Function = ...
 * if (isType(fn, 'CodeFunction')) {
 *   // fn is CodeFunction here
 *   console.log(fn.code)
 * }
 * ```
 */
export function isType<T extends { $type: string }, K extends T['$type']>(
  value: T,
  type: K
): value is Extract<T, { $type: K }> {
  return value.$type === type
}

/**
 * Assert discriminated type (throws if wrong type)
 *
 * @example
 * ```typescript
 * const fn: Function = ...
 * const codeFn = assertType(fn, 'CodeFunction')
 * // codeFn is CodeFunction
 * ```
 */
export function assertType<T extends { $type: string }, K extends T['$type']>(
  value: T,
  type: K
): Extract<T, { $type: K }> {
  if (value.$type !== type) {
    throw new Error(`Expected type '${type}', got '${value.$type}'`)
  }
  return value as Extract<T, { $type: K }>
}

/**
 * Switch handler for discriminated unions
 *
 * @example
 * ```typescript
 * const result = matchType(fn, {
 *   CodeFunction: (f) => `Code: ${f.runtime}`,
 *   GenerativeFunction: (f) => `AI: ${f.model}`,
 *   _: (f) => `Unknown: ${f.$type}`
 * })
 * ```
 */
export function matchType<
  T extends { $type: string },
  R,
  H extends { [K in T['$type']]?: (value: Extract<T, { $type: K }>) => R } & {
    _?: (value: T) => R
  }
>(value: T, handlers: H): R | undefined {
  const handler = handlers[value.$type as T['$type']]
  if (handler) {
    return (handler as (v: T) => R)(value)
  }
  if (handlers._) {
    return handlers._(value)
  }
  return undefined
}

// =============================================================================
// Example: Function Collection Types
// =============================================================================

/**
 * Base function interface (shared by all function types)
 */
export interface FunctionBase extends StorableData {
  /** Function name */
  name: string

  /** Optional description */
  description?: string

  /** Input schema (JSON Schema) */
  input: JsonObject

  /** Output schema (JSON Schema) */
  output: JsonObject

  /** Optional configuration */
  config?: JsonObject
}

/**
 * Code function - executes code
 */
export interface CodeFunction extends FunctionBase {
  $type: 'CodeFunction'
  runtime: 'js' | 'ts' | 'python' | 'wasm'
  code: string
  dependencies?: string[]
}

/**
 * Generative function - uses an AI model
 */
export interface GenerativeFunction extends FunctionBase {
  $type: 'GenerativeFunction'
  model: string
  prompt: string
  temperature?: number
  maxTokens?: number
}

/**
 * Agentic function - uses an AI agent
 */
export interface AgenticFunction extends FunctionBase {
  $type: 'AgenticFunction'
  agent: string
  tools: string[]
  maxSteps?: number
}

/**
 * Human function - requires human input
 */
export interface HumanFunction extends FunctionBase {
  $type: 'HumanFunction'
  assignee?: string
  form?: JsonObject
  timeout?: number
}

/**
 * Union of all function types
 */
export type FunctionType = CodeFunction | GenerativeFunction | AgenticFunction | HumanFunction

/**
 * Thing containing a FunctionType
 */
export type FunctionThing = Thing<FunctionType>
