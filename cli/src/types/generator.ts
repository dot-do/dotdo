/**
 * TypeScript Definition Generator
 *
 * Generates .d.ts files from RPC schemas for autocomplete support.
 * This module creates type definitions that make the REPL aware of
 * the available methods, parameters, and return types.
 */

import type { Schema, FieldSchema, MethodSchema, ParamSchema } from '../rpc-client.js'

/**
 * Options for type generation
 */
export interface TypeGeneratorOptions {
  /** Include JSDoc comments */
  includeJSDoc?: boolean
  /** Namespace for generated types */
  namespace?: string
  /** Generate strict types (no any) */
  strict?: boolean
}

/**
 * Generate TypeScript definitions from a schema
 */
export function generateTypesFromSchema(
  schema: Schema,
  options: TypeGeneratorOptions = {}
): string {
  const {
    includeJSDoc = true,
    namespace,
    strict = true,
  } = options

  const lines: string[] = []

  // Header comment
  lines.push(`// Auto-generated TypeScript definitions for ${schema.name}`)
  lines.push(`// Generated at: ${new Date().toISOString()}`)
  lines.push('')

  // Open namespace if specified
  if (namespace) {
    lines.push(`declare namespace ${namespace} {`)
  }

  // Generate main interface
  lines.push(...generateInterface(schema, { includeJSDoc, strict }))
  lines.push('')

  // Generate related types (return types, parameter types)
  const relatedTypes = extractRelatedTypes(schema)
  for (const type of relatedTypes) {
    lines.push(...generateRelatedType(type, { includeJSDoc, strict }))
    lines.push('')
  }

  // Close namespace
  if (namespace) {
    lines.push('}')
  }

  // Generate global declarations for REPL
  lines.push('')
  lines.push('// REPL globals')
  lines.push(`declare const ${schema.name.toLowerCase()}: ${namespace ? `${namespace}.` : ''}${schema.name};`)

  return lines.join('\n')
}

/**
 * Generate interface declaration
 */
function generateInterface(
  schema: Schema,
  options: { includeJSDoc: boolean; strict: boolean }
): string[] {
  const lines: string[] = []

  if (options.includeJSDoc) {
    lines.push('/**')
    lines.push(` * ${schema.name} interface`)
    lines.push(' */')
  }

  lines.push(`interface ${schema.name} {`)

  // Generate field declarations
  for (const field of schema.fields) {
    lines.push(...generateFieldDeclaration(field, options))
  }

  if (schema.fields.length > 0 && schema.methods.length > 0) {
    lines.push('')
  }

  // Generate method declarations
  for (const method of schema.methods) {
    lines.push(...generateMethodDeclaration(method, options))
  }

  lines.push('}')

  return lines
}

/**
 * Generate field declaration
 */
function generateFieldDeclaration(
  field: FieldSchema,
  options: { includeJSDoc: boolean; strict: boolean }
): string[] {
  const lines: string[] = []

  if (options.includeJSDoc && field.description) {
    lines.push(`  /** ${field.description} */`)
  }

  const optional = field.required === false ? '?' : ''
  const tsType = mapSchemaTypeToTS(field.type, options.strict)

  lines.push(`  ${field.name}${optional}: ${tsType};`)

  return lines
}

/**
 * Generate method declaration
 */
function generateMethodDeclaration(
  method: MethodSchema,
  options: { includeJSDoc: boolean; strict: boolean }
): string[] {
  const lines: string[] = []

  if (options.includeJSDoc) {
    lines.push('  /**')
    if (method.description) {
      lines.push(`   * ${method.description}`)
    }
    for (const param of method.params) {
      lines.push(`   * @param ${param.name} - ${param.type}`)
    }
    lines.push(`   * @returns ${method.returns}`)
    lines.push('   */')
  }

  const params = method.params
    .map(p => formatParam(p, options.strict))
    .join(', ')

  const returnType = mapSchemaTypeToTS(method.returns, options.strict)

  lines.push(`  ${method.name}(${params}): ${returnType};`)

  return lines
}

/**
 * Format a parameter for the method signature
 */
function formatParam(param: ParamSchema, strict: boolean): string {
  const optional = param.required === false ? '?' : ''
  const tsType = mapSchemaTypeToTS(param.type, strict)
  return `${param.name}${optional}: ${tsType}`
}

/**
 * Map schema type to TypeScript type
 */
function mapSchemaTypeToTS(schemaType: string, strict: boolean): string {
  // Handle Promise wrapper
  if (schemaType.startsWith('Promise<')) {
    const innerType = schemaType.slice(8, -1)
    return `Promise<${mapSchemaTypeToTS(innerType, strict)}>`
  }

  // Handle array types
  if (schemaType.endsWith('[]')) {
    const baseType = schemaType.slice(0, -2)
    return `${mapSchemaTypeToTS(baseType, strict)}[]`
  }

  // Handle generic types
  const genericMatch = schemaType.match(/^(\w+)<(.+)>$/)
  if (genericMatch) {
    const [, container, inner] = genericMatch
    return `${container}<${mapSchemaTypeToTS(inner, strict)}>`
  }

  // Direct type mappings
  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    Date: 'Date',
    void: 'void',
    null: 'null',
    undefined: 'undefined',
    object: 'Record<string, unknown>',
    unknown: strict ? 'unknown' : 'any',
    any: strict ? 'unknown' : 'any',
  }

  return typeMap[schemaType] ?? schemaType
}

/**
 * Extract related types from method signatures
 */
function extractRelatedTypes(schema: Schema): RelatedType[] {
  const types: Map<string, RelatedType> = new Map()

  for (const method of schema.methods) {
    // Check return type
    const returnType = extractTypeName(method.returns)
    if (returnType && !isBuiltinType(returnType)) {
      types.set(returnType, { name: returnType, kind: 'return', source: method.name })
    }

    // Check parameter types
    for (const param of method.params) {
      const paramType = extractTypeName(param.type)
      if (paramType && !isBuiltinType(paramType)) {
        types.set(paramType, { name: paramType, kind: 'param', source: method.name })
      }
    }
  }

  return Array.from(types.values())
}

interface RelatedType {
  name: string
  kind: 'return' | 'param'
  source: string
}

/**
 * Extract the type name from a type string
 */
function extractTypeName(typeStr: string): string | null {
  // Remove Promise wrapper
  if (typeStr.startsWith('Promise<')) {
    typeStr = typeStr.slice(8, -1)
  }

  // Remove array suffix
  if (typeStr.endsWith('[]')) {
    typeStr = typeStr.slice(0, -2)
  }

  // Check if it's a custom type
  if (/^[A-Z]/.test(typeStr)) {
    return typeStr
  }

  return null
}

/**
 * Check if a type is a builtin type
 */
function isBuiltinType(typeName: string): boolean {
  const builtins = new Set([
    'string', 'number', 'boolean', 'void', 'null', 'undefined',
    'Date', 'Array', 'Object', 'Map', 'Set', 'Promise',
    'unknown', 'any', 'never'
  ])
  return builtins.has(typeName)
}

/**
 * Generate placeholder for related types
 */
function generateRelatedType(
  type: RelatedType,
  options: { includeJSDoc: boolean; strict: boolean }
): string[] {
  const lines: string[] = []

  if (options.includeJSDoc) {
    lines.push('/**')
    lines.push(` * ${type.name} type (referenced by ${type.source})`)
    lines.push(' */')
  }

  // Generate a placeholder interface
  lines.push(`interface ${type.name} {`)
  lines.push('  [key: string]: unknown;')
  lines.push('}')

  return lines
}

/**
 * Generate dotdo-specific types for the REPL context
 */
export function generateReplContextTypes(): string {
  return `
// dotdo REPL Context Types

/**
 * Main workflow context
 */
declare const $: DotdoContext;

interface DotdoContext {
  /** Send a fire-and-forget event */
  send(event: DotdoEvent): void;

  /** Try an action once */
  try<T>(action: () => T | Promise<T>): Promise<T>;

  /** Execute action with durable retries */
  do<T>(action: () => T | Promise<T>): Promise<T>;

  /** Event handlers */
  on: EventProxy;

  /** Scheduling DSL */
  every: ScheduleProxy;

  /** Cross-DO RPC - call any DO by name */
  [doName: string]: (id: string) => DOProxy;
}

interface DotdoEvent {
  $type: string;
  $id?: string;
  [key: string]: unknown;
}

interface EventProxy {
  [noun: string]: {
    [verb: string]: (handler: (event: DotdoEvent) => void | Promise<void>) => Subscription;
  };
}

interface Subscription {
  unsubscribe(): void;
}

interface ScheduleProxy {
  Monday: ScheduleProxy;
  Tuesday: ScheduleProxy;
  Wednesday: ScheduleProxy;
  Thursday: ScheduleProxy;
  Friday: ScheduleProxy;
  Saturday: ScheduleProxy;
  Sunday: ScheduleProxy;
  day: ScheduleProxy;
  hour: (handler: () => void | Promise<void>) => void;
  minute: (handler: () => void | Promise<void>) => void;
  at9am: (handler: () => void | Promise<void>) => void;
  at(time: string): (handler: () => void | Promise<void>) => void;
}

interface DOProxy {
  [method: string]: (...args: unknown[]) => Promise<unknown>;
}

/**
 * Thing - base entity type
 */
interface Thing {
  $type: string;
  $id: string;
  $createdAt?: Date;
  $updatedAt?: Date;
  [key: string]: unknown;
}

/**
 * Console for REPL output
 */
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  table(data: unknown): void;
  dir(obj: unknown, options?: { depth?: number }): void;
};
`
}

/**
 * Combine multiple schemas into a single type definition file
 */
export function generateCombinedTypes(
  schemas: Schema[],
  options: TypeGeneratorOptions = {}
): string {
  const sections: string[] = []

  // Add REPL context types
  sections.push(generateReplContextTypes())
  sections.push('')

  // Add each schema
  for (const schema of schemas) {
    sections.push(`// ${schema.name} types`)
    sections.push(generateTypesFromSchema(schema, options))
    sections.push('')
  }

  return sections.join('\n')
}
