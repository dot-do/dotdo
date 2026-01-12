/**
 * DO Auto-Wiring via Reflection
 *
 * Discovers public methods on DO subclasses and exposes them to
 * SDK/RPC/MCP/REST/CLI transports. This enables a single class
 * definition to automatically provide multiple API interfaces.
 *
 * Key concepts:
 * - Public methods (no underscore prefix) are exposed
 * - _prefixed methods remain private
 * - __prefixed methods are protected-style
 * - Reflection discovers methods on prototype chain
 * - Method metadata (parameters, return types, descriptions) can be extracted
 */

import type { DO } from '../objects/DO'

// ============================================================================
// TYPES
// ============================================================================

export interface ParameterInfo {
  name: string
  optional: boolean
}

export interface MethodSignature {
  name: string
  parameterCount: number
  parameters: ParameterInfo[]
  async: boolean
}

export interface MethodMetadata {
  name: string
  description?: string
  parameters?: Record<string, { description?: string }>
  returns?: { description?: string }
  throws?: string[]
}

export interface ExposedMethodInfo {
  name: string
  signature: MethodSignature
  metadata: MethodMetadata
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Methods from Object.prototype that should never be exposed
 */
const OBJECT_PROTOTYPE_METHODS = new Set([
  'constructor',
  'toString',
  'toLocaleString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  '__proto__',
])

/**
 * Methods from DurableObject/DO base class that should not be exposed
 * These are framework methods, not business logic
 */
const DO_BASE_METHODS = new Set([
  // Lifecycle
  'initialize',
  'fork',
  'compact',
  'moveTo',

  // Branching
  'branch',
  'checkout',
  'merge',

  // Resolution
  'resolve',

  // HTTP handler from DurableObject
  'fetch',

  // Workflow context methods (protected, but accessible via $)
  'send',
  'try',
  'do',
  'emit',
  'logAction',
  'emitEvent',
  'createWorkflowContext',
  'createOnProxy',
  'createScheduleBuilder',
  'createDomainProxy',

  // Internal helpers
  'resolveLocal',
  'resolveCrossDO',
  'invokeDomainMethod',
  'invokeCrossDOMethod',
  'executeAction',
  'completeAction',
  'failAction',
  'updateActionStatus',
  'log',
  'sleep',
  'link',
  'getLinkedObjects',
  'createThing',
  'createAction',

  // Capability system
  'hasCapability',

  // Protected accessors (these become getters)
  'collection',
  'relationships',

  // Private methods (no underscore prefix but marked private in TypeScript)
  'getStoreContext',
  'getOrCreateStub',
  'recordFailure',
  'clearCrossDoCache',
  'createDefaultApp',

  // Actor context methods
  'setActor',
  'clearActor',
  'getCurrentActor',

  // HTTP handling
  'handleFetch',
])

// ============================================================================
// CACHES
// ============================================================================

const exposedMethodsCache = new WeakMap<Function, string[]>()
const methodSignatureCache = new WeakMap<Function, Map<string, MethodSignature | undefined>>()
const methodMetadataCache = new WeakMap<Function, Map<string, MethodMetadata | undefined>>()

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the prototype chain for a class, stopping at Object.prototype
 */
function getPrototypeChain(cls: Function): object[] {
  const chain: object[] = []
  let proto = cls.prototype

  while (proto && proto !== Object.prototype) {
    chain.push(proto)
    proto = Object.getPrototypeOf(proto)
  }

  return chain
}

/**
 * Check if a property is a getter/setter (not a regular method)
 */
function isGetterOrSetter(proto: object, name: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(proto, name)
  return descriptor !== undefined && (descriptor.get !== undefined || descriptor.set !== undefined)
}

/**
 * Check if a method is an async function
 */
function isAsyncFunction(fn: Function): boolean {
  return fn.constructor.name === 'AsyncFunction' ||
         fn.toString().startsWith('async ')
}

/**
 * Parse function parameters from its source string
 * Returns array of { name, optional } objects
 */
function parseParameters(fn: Function): ParameterInfo[] {
  const fnStr = fn.toString()

  // Match the parameters section
  // Handle multiple formats:
  // - function name(a, b) { }
  // - (a, b) => { }
  // - async (a, b) => { }
  // - methodName(a, b) { } (class methods)
  // - async methodName(a, b) { } (async class methods)
  // - *methodName(a, b) { } (generator methods)
  const paramMatch = fnStr.match(
    /^(?:async\s+)?(?:\*\s*)?(?:function\s*)?(?:\w+\s*)?\(([^)]*)\)|^(?:async\s+)?(\w+)\s*=>/
  )

  if (!paramMatch) {
    return []
  }

  // If it's a single arrow function param without parens (x => ...)
  if (paramMatch[2]) {
    return [{ name: paramMatch[2], optional: false }]
  }

  const paramStr = paramMatch[1]
  if (!paramStr || paramStr.trim() === '') {
    return []
  }

  // Split by comma, handling nested structures like { a, b } and array types
  const params: ParameterInfo[] = []
  let depth = 0
  let current = ''

  for (const char of paramStr) {
    if (char === '(' || char === '{' || char === '[' || char === '<') {
      depth++
      current += char
    } else if (char === ')' || char === '}' || char === ']' || char === '>') {
      depth--
      current += char
    } else if (char === ',' && depth === 0) {
      if (current.trim()) {
        params.push(parseParameter(current.trim()))
      }
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) {
    params.push(parseParameter(current.trim()))
  }

  return params
}

/**
 * Parse a single parameter string like "name: type" or "name?: type" or "name = default"
 */
function parseParameter(paramStr: string): ParameterInfo {
  // Handle rest parameters (...rest: type[])
  const restMatch = paramStr.match(/^\.\.\.(\w+)/)
  if (restMatch) {
    return { name: restMatch[1]!, optional: true }
  }

  // Handle destructuring: { a, b }: Type or [a, b]: Type
  if (paramStr.startsWith('{') || paramStr.startsWith('[')) {
    // Extract name from after the closing brace/bracket
    const colonIndex = paramStr.lastIndexOf(':')
    if (colonIndex !== -1) {
      // Try to get a meaningful name, or use 'data'
      return { name: 'data', optional: paramStr.includes('?') }
    }
    return { name: 'data', optional: false }
  }

  // Handle regular parameters: name, name?, name: type, name?: type, name = default
  const nameMatch = paramStr.match(/^(\w+)(\?)?(?:\s*[=:]|$)/)
  if (nameMatch) {
    const isOptional = nameMatch[2] === '?' || paramStr.includes('=')
    return { name: nameMatch[1]!, optional: isOptional }
  }

  return { name: 'arg', optional: false }
}

/**
 * Check if a method name should be excluded from exposure
 */
function shouldExclude(name: string): boolean {
  // Exclude constructor
  if (name === 'constructor') return true

  // Exclude _prefixed and __prefixed methods
  if (name.startsWith('_')) return true

  // Exclude Object.prototype methods
  if (OBJECT_PROTOTYPE_METHODS.has(name)) return true

  // Exclude DO base methods
  if (DO_BASE_METHODS.has(name)) return true

  return false
}

/**
 * Generate a human-readable description from a camelCase/PascalCase method name
 * e.g., "createOrder" -> "Create order"
 *       "getCustomerById" -> "Get customer by id"
 */
function generateMethodDescription(methodName: string): string {
  // Split camelCase/PascalCase into words
  const words = methodName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
    .toLowerCase()

  // Capitalize first letter
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// ============================================================================
// MAIN API
// ============================================================================

/**
 * Get list of exposed (public) method names for a DO class
 *
 * @param DOClass - The DO class constructor to inspect
 * @returns Array of public method names
 */
export function getExposedMethods(DOClass: Function): string[] {
  // Check cache
  const cached = exposedMethodsCache.get(DOClass)
  if (cached) {
    return cached
  }

  const methods = new Set<string>()
  const chain = getPrototypeChain(DOClass)

  for (const proto of chain) {
    // Get all own property names (string keys only, not symbols)
    const names = Object.getOwnPropertyNames(proto)

    for (const name of names) {
      // Skip if should be excluded
      if (shouldExclude(name)) continue

      // Skip getters/setters
      if (isGetterOrSetter(proto, name)) continue

      // Get the property descriptor
      const descriptor = Object.getOwnPropertyDescriptor(proto, name)
      if (!descriptor) continue

      // Must be a function
      const value = descriptor.value
      if (typeof value !== 'function') continue

      methods.add(name)
    }
  }

  const result = Array.from(methods)
  exposedMethodsCache.set(DOClass, result)
  return result
}

/**
 * Check if a method is exposed (public) on a DO class
 *
 * @param DOClass - The DO class constructor to inspect
 * @param methodName - The method name to check
 * @returns true if the method is exposed, false otherwise
 */
export function isExposed(DOClass: Function, methodName: string): boolean {
  // Quick exclusion checks
  if (shouldExclude(methodName)) return false

  // Check if it's a symbol string representation
  if (methodName.includes('Symbol')) return false

  const chain = getPrototypeChain(DOClass)

  for (const proto of chain) {
    // Check if property exists
    if (!Object.prototype.hasOwnProperty.call(proto, methodName)) continue

    // Skip getters/setters
    if (isGetterOrSetter(proto, methodName)) return false

    const descriptor = Object.getOwnPropertyDescriptor(proto, methodName)
    if (!descriptor) continue

    // Must be a function
    if (typeof descriptor.value === 'function') {
      return true
    }
  }

  return false
}

/**
 * Get the signature of a method on a DO class
 *
 * @param DOClass - The DO class constructor to inspect
 * @param methodName - The method name to get signature for
 * @returns MethodSignature if method is exposed, undefined otherwise
 */
export function getMethodSignature(DOClass: Function, methodName: string): MethodSignature | undefined {
  // Check cache
  let classCache = methodSignatureCache.get(DOClass)
  if (classCache?.has(methodName)) {
    return classCache.get(methodName)
  }

  // Method must be exposed
  if (!isExposed(DOClass, methodName)) {
    if (!classCache) {
      classCache = new Map()
      methodSignatureCache.set(DOClass, classCache)
    }
    classCache.set(methodName, undefined)
    return undefined
  }

  // Find the method in prototype chain
  const chain = getPrototypeChain(DOClass)
  let fn: Function | undefined

  for (const proto of chain) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, methodName)
    if (descriptor && typeof descriptor.value === 'function') {
      fn = descriptor.value
      break
    }
  }

  if (!fn) {
    return undefined
  }

  const parameters = parseParameters(fn)

  // Mark parameters beyond fn.length as optional
  // fn.length counts only the parameters before the first one with a default value
  // Parameters at or after fn.length are considered optional
  const requiredParamCount = fn.length
  for (let i = requiredParamCount; i < parameters.length; i++) {
    parameters[i]!.optional = true
  }

  // Heuristic: Common optional parameter naming patterns
  // In TypeScript/JavaScript, parameters with these names are often optional
  const optionalPatterns = /^(options?|opts?|config|params?|settings|args|kwargs|extra|additional|metadata|context|props)$/i

  for (const param of parameters) {
    if (optionalPatterns.test(param.name)) {
      param.optional = true
    }
  }

  const signature: MethodSignature = {
    name: methodName,
    parameterCount: fn.length,
    parameters,
    async: isAsyncFunction(fn),
  }

  // Cache the result
  if (!classCache) {
    classCache = new Map()
    methodSignatureCache.set(DOClass, classCache)
  }
  classCache.set(methodName, signature)

  return signature
}

/**
 * Get metadata for a method on a DO class
 *
 * Note: Full JSDoc parsing requires additional tooling (e.g., TypeScript compiler API
 * or a JSDoc parser). This implementation provides basic metadata and a structure
 * that can be extended with decorator-based or external metadata sources.
 *
 * @param DOClass - The DO class constructor to inspect
 * @param methodName - The method name to get metadata for
 * @returns MethodMetadata if method is exposed, undefined otherwise
 */
export function getMethodMetadata(DOClass: Function, methodName: string): MethodMetadata | undefined {
  // Check cache
  let classCache = methodMetadataCache.get(DOClass)
  if (classCache?.has(methodName)) {
    return classCache.get(methodName)
  }

  // Method must be exposed
  if (!isExposed(DOClass, methodName)) {
    if (!classCache) {
      classCache = new Map()
      methodMetadataCache.set(DOClass, classCache)
    }
    classCache.set(methodName, undefined)
    return undefined
  }

  // Get signature for parameter info
  const signature = getMethodSignature(DOClass, methodName)
  if (!signature) {
    return undefined
  }

  // Build basic metadata
  // In a full implementation, this could extract JSDoc from source or use decorators
  // For now, we provide auto-generated descriptions based on method name
  const generatedDescription = generateMethodDescription(methodName)

  const metadata: MethodMetadata = {
    name: methodName,
    description: generatedDescription,
    parameters: {},
    returns: { description: `Return value of ${methodName}` },
    throws: undefined,
  }

  // Populate parameter entries from signature
  for (const param of signature.parameters) {
    metadata.parameters![param.name] = { description: undefined }
  }

  // Cache the result
  if (!classCache) {
    classCache = new Map()
    methodMetadataCache.set(DOClass, classCache)
  }
  classCache.set(methodName, metadata)

  return metadata
}
