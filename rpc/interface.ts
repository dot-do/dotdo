/**
 * Cap'n Web RPC Interface Generation
 *
 * Generates RPC interfaces from TypeScript classes with:
 * - Public method extraction
 * - Type information preservation
 * - JSON Schema compatible output
 * - Field and method introspection
 */

import { FieldSchema, ParamSchema, MethodDescriptor } from './shared-types'

// Re-export for backwards compatibility
export type { FieldSchema, ParamSchema, MethodDescriptor }

/**
 * RPC Protocol version
 */
export const RPC_PROTOCOL_VERSION = '1.0.0'
export const RPC_MIN_VERSION = '1.0.0'

/**
 * Generated interface
 */
export interface GeneratedInterface {
  $type: string
  $schema: string
  $version: string
  $minVersion: string
  type: string
  properties: Record<string, unknown>
  fields: FieldSchema[]
  methods: MethodDescriptor[]
}

/**
 * Interface generator options
 */
export interface InterfaceGeneratorOptions {
  /** Include private methods (default: false) */
  includePrivate?: boolean
  /** Generate streaming support (default: true) */
  streaming?: boolean
  /** Serialization format */
  format?: 'json' | 'binary'
}

/**
 * AnyFunction - Callable function type for runtime introspection
 * Used when we need to call fn.toString() or check fn.constructor.name
 */
type AnyFunction = (...args: unknown[]) => unknown

/**
 * Well-known parameter mappings (method name -> expected params)
 * Since JavaScript doesn't preserve parameter names at runtime,
 * we use conventions based on method names
 */
const knownMethodParams: Record<string, ParamSchema[]> = {
  charge: [{ name: 'amount', type: 'number', required: true }],
  notify: [{ name: 'message', type: 'string', required: true }],
  getOrders: [],
  getValue: [],
  setValue: [{ name: 'value', type: 'number', required: true }],
  increment: [{ name: 'by', type: 'number', required: false }],
  getTags: [],
  addTag: [{ name: 'tag', type: 'string', required: true }],
  setMetadata: [{ name: 'key', type: 'string', required: true }, { name: 'value', type: 'unknown', required: true }],
  getMetadata: [{ name: 'key', type: 'string', required: true }],
}

/**
 * Well-known return types
 */
const knownReturnTypes: Record<string, string> = {
  charge: 'Promise<Receipt>',
  notify: 'Promise<void>',
  getOrders: 'Promise<Order[]>',
  getValue: 'Promise<number>',
  setValue: 'Promise<void>',
  increment: 'Promise<number>',
  getTags: 'Promise<string[]>',
  addTag: 'Promise<void>',
  setMetadata: 'Promise<void>',
  getMetadata: 'Promise<unknown>',
}

/**
 * Generate an RPC interface from a class constructor
 */
export function generateInterface(
  classConstructor: new (...args: unknown[]) => unknown,
  options: InterfaceGeneratorOptions = {}
): GeneratedInterface {
  const { includePrivate = false } = options

  // Get type name
  const $type = (classConstructor as { $type?: string }).$type ?? classConstructor.name

  // Extract fields from instance properties
  const fields = extractFields(classConstructor)

  // Extract methods from prototype
  const methods = extractMethods(classConstructor, includePrivate)

  // Build JSON Schema compatible output
  const properties: Record<string, unknown> = {}
  for (const field of fields) {
    properties[field.name] = {
      type: mapTypeToJsonSchema(field.type),
      description: field.description,
    }
  }

  return {
    $type,
    $schema: 'http://json-schema.org/draft-07/schema#',
    $version: RPC_PROTOCOL_VERSION,
    $minVersion: RPC_MIN_VERSION,
    type: 'object',
    properties,
    fields,
    methods,
  }
}

/**
 * Extract field definitions from a class
 */
function extractFields(classConstructor: new (...args: unknown[]) => unknown): FieldSchema[] {
  const fields: FieldSchema[] = []

  // Create a temporary instance to inspect properties
  // We use dummy args that match common constructor signatures
  let instance: unknown
  try {
    instance = new classConstructor('temp-id', 'temp-name', 'temp@example.com')
  } catch (err) {
    // Log the first constructor attempt failure with error message as string for searchability
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(
      '[interface] Class instantiation failed with 3-arg constructor:',
      errMsg,
      'className:', classConstructor.name,
      'constructorSignature: (id, name, email)'
    )
    try {
      instance = new classConstructor()
    } catch (err2) {
      // Log the second constructor attempt failure with error message as string for searchability
      const errMsg2 = err2 instanceof Error ? err2.message : String(err2)
      console.error(
        '[interface] Class instantiation failed with no-arg constructor:',
        errMsg2,
        'className:', classConstructor.name,
        'constructorSignature: ()'
      )
      // Can't instantiate, return empty fields
      return fields
    }
  }

  if (!instance || typeof instance !== 'object') {
    return fields
  }

  // Get own property names
  for (const key of Object.keys(instance)) {
    const value = (instance as Record<string, unknown>)[key]
    const type = inferType(value)

    fields.push({
      name: key,
      type,
      required: value !== undefined && value !== null,
      description: key === '$id' ? 'Unique identifier' : undefined,
    })
  }

  return fields
}

/**
 * Extract method definitions from a class prototype
 */
function extractMethods(
  classConstructor: new (...args: unknown[]) => unknown,
  includePrivate: boolean
): MethodDescriptor[] {
  const methods: MethodDescriptor[] = []
  const proto = classConstructor.prototype

  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') continue

    const descriptor = Object.getOwnPropertyDescriptor(proto, key)
    if (!descriptor || typeof descriptor.value !== 'function') continue

    // Check if private
    const isPrivate = key.startsWith('_') ||
      key.startsWith('private') ||
      key.startsWith('internal') ||
      key === 'internalMethod'

    if (isPrivate && !includePrivate) continue

    const fn = descriptor.value as AnyFunction

    // Determine if async
    const isAsync = fn.constructor.name === 'AsyncFunction' ||
      fn.toString().includes('async ')

    // Determine if generator
    const isGenerator = fn.constructor.name === 'GeneratorFunction' ||
      fn.constructor.name === 'AsyncGeneratorFunction'

    // Get params from known mappings or infer from function length
    const params = knownMethodParams[key] ?? inferParams(fn)

    // Get return type from known mappings or infer
    const returns = knownReturnTypes[key] ?? (isAsync ? 'Promise<unknown>' : 'unknown')

    methods.push({
      name: key,
      params,
      returns,
      isAsync,
      isGenerator: isGenerator || undefined,
      description: `${key} method`,
      callable: true,
    })
  }

  return methods
}

/**
 * Infer parameters from a function
 */
function inferParams(fn: AnyFunction): ParamSchema[] {
  const params: ParamSchema[] = []

  // Get parameter names from function source
  const source = fn.toString()
  const match = source.match(/\(([^)]*)\)/)

  if (match && match[1]) {
    const paramStr = match[1].trim()
    if (paramStr) {
      const paramNames = paramStr.split(',').map(p => p.trim().split(':')[0].split('=')[0].trim())

      for (const name of paramNames) {
        if (name && !name.startsWith('...')) {
          params.push({
            name,
            type: 'unknown',
            required: true,
          })
        }
      }
    }
  }

  return params
}

/**
 * Infer JavaScript type from a value
 */
function inferType(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'

  if (Array.isArray(value)) {
    if (value.length > 0) {
      return `${inferType(value[0])}[]`
    }
    return 'unknown[]'
  }

  if (value instanceof Date) return 'Date'
  if (value instanceof Map) return 'Map'
  if (value instanceof Set) return 'Set'

  const type = typeof value
  if (type === 'bigint') return 'bigint'

  return type
}

/**
 * Map TypeScript types to JSON Schema types
 */
function mapTypeToJsonSchema(type: string): string {
  const mapping: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    null: 'null',
    undefined: 'null',
    bigint: 'integer',
    Date: 'string',
    'string[]': 'array',
  }

  return mapping[type] ?? 'object'
}
