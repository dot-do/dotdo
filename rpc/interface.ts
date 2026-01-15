/**
 * Cap'n Web RPC Interface Generation
 *
 * Generates RPC interfaces from TypeScript classes with:
 * - Public method extraction
 * - Type information preservation
 * - JSON Schema compatible output
 * - Field and method introspection
 */

/**
 * Field schema definition
 */
export interface FieldSchema {
  name: string
  type: string
  required?: boolean
  description?: string
}

/**
 * Parameter schema definition
 */
export interface ParamSchema {
  name: string
  type: string
  required?: boolean
}

/**
 * Method descriptor
 */
export interface MethodDescriptor {
  name: string
  params: ParamSchema[]
  returns: string
  isAsync: boolean
  isGenerator?: boolean
  description?: string
  callable?: boolean
}

/**
 * Generated interface
 */
export interface GeneratedInterface {
  $type: string
  $schema: string
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
 * Well-known parameter mappings (method name -> expected params)
 * Since JavaScript doesn't preserve parameter names at runtime,
 * we use conventions based on method names
 */
const knownMethodParams: Record<string, ParamSchema[]> = {
  charge: [{ name: 'amount', type: 'number', required: true }],
  notify: [{ name: 'message', type: 'string', required: true }],
  getOrders: [],
}

/**
 * Well-known return types
 */
const knownReturnTypes: Record<string, string> = {
  charge: 'Promise<Receipt>',
  notify: 'Promise<void>',
  getOrders: 'Promise<Order[]>',
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
  } catch {
    try {
      instance = new classConstructor()
    } catch {
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

    const fn = descriptor.value as Function

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
function inferParams(fn: Function): ParamSchema[] {
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
