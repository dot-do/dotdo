/**
 * GREEN Phase Implementation: Function Registry
 * Issue: dotdo-71ziz
 *
 * Registry pattern for Bloblang functions and methods.
 * Replaces switch statements with extensible registration.
 */

import { stringFunctions } from './stdlib/string'
import * as arrayFunctions from './stdlib/array'
import * as numberFunctions from './stdlib/number'
import * as objectFunctions from './stdlib/object'
import * as typeFunctions from './stdlib/type'

/**
 * Function metadata stored alongside the function
 */
export interface FunctionMetadata {
  name: string
  arity: number
  description?: string
  argTypes?: string[]
  returnType?: string
  variadic?: boolean
  category?: string
  tags?: string[]
  namespace?: string
  async?: boolean
  minArity?: number
  validateArgs?: boolean
  validateReturn?: boolean
}

/**
 * Definition for registering a function
 */
export interface FunctionDefinition extends FunctionMetadata {
  fn: (...args: unknown[]) => unknown
  overwrite?: boolean
}

/**
 * Definition for registering a method
 */
export interface MethodDefinition extends FunctionMetadata {
  fn: (this: unknown, ...args: unknown[]) => unknown
  overwrite?: boolean
}

/**
 * Wrapper for a registered function
 */
export interface RegisteredFunction {
  call: (...args: unknown[]) => unknown
  metadata: FunctionMetadata
}

/**
 * Type-organized method registry
 */
export type TypedMethodRegistry = Map<string, Map<string, RegisteredFunction>>

/**
 * Options for creating a registry
 */
export interface RegistryOptions {
  includeStdlib?: boolean
}

/**
 * Options for listing functions
 */
export interface ListFunctionsOptions {
  namespace?: string
}

/**
 * Validate argument type
 */
function validateArgType(value: unknown, expectedType: string, index: number, funcName: string): void {
  const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  const isOptional = expectedType.endsWith('?')
  const requiredType = isOptional ? expectedType.slice(0, -1) : expectedType

  if (isOptional && value === undefined) {
    return
  }

  if (actualType !== requiredType) {
    throw new TypeError(`${funcName}: argument ${index + 1} expected type ${requiredType}, got ${actualType}`)
  }
}

/**
 * Validate return type
 */
function validateReturnType(value: unknown, expectedType: string, funcName: string): void {
  const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value

  if (actualType !== expectedType) {
    throw new TypeError(`${funcName}: return type expected ${expectedType}, got ${actualType}`)
  }
}

/**
 * Create a validated wrapper function
 */
function createValidatedWrapper(
  fn: (...args: unknown[]) => unknown,
  metadata: FunctionMetadata
): (...args: unknown[]) => unknown {
  return function(...args: unknown[]): unknown {
    // Validate argument types if specified
    if (metadata.validateArgs && metadata.argTypes) {
      for (let i = 0; i < metadata.argTypes.length; i++) {
        validateArgType(args[i], metadata.argTypes[i], i, metadata.name)
      }
    }

    const result = fn.apply(null, args)

    // Validate return type if specified
    if (metadata.validateReturn && metadata.returnType) {
      validateReturnType(result, metadata.returnType, metadata.name)
    }

    return result
  }
}

/**
 * Create a validated method wrapper
 */
function createValidatedMethodWrapper(
  fn: (this: unknown, ...args: unknown[]) => unknown,
  metadata: FunctionMetadata
): (this: unknown, ...args: unknown[]) => unknown {
  return function(this: unknown, ...args: unknown[]): unknown {
    // Validate argument types if specified
    if (metadata.validateArgs && metadata.argTypes) {
      for (let i = 0; i < metadata.argTypes.length; i++) {
        validateArgType(args[i], metadata.argTypes[i], i, metadata.name)
      }
    }

    const result = fn.call(this, ...args)

    // Validate return type if specified
    if (metadata.validateReturn && metadata.returnType) {
      validateReturnType(result, metadata.returnType, metadata.name)
    }

    return result
  }
}


/**
 * Function Registry implementation
 */
export class FunctionRegistryImpl {
  private functions: Map<string, RegisteredFunction> = new Map()
  private methods: TypedMethodRegistry = new Map()

  /**
   * Register a global function
   */
  register(def: FunctionDefinition): void {
    // Validate function name
    if (!def.name || def.name.trim() === '') {
      throw new Error('Invalid function name: name cannot be empty')
    }

    // Validate function
    if (typeof def.fn !== 'function') {
      throw new Error('Invalid function: fn must be a function')
    }

    // Check for duplicates
    if (this.functions.has(def.name) && !def.overwrite) {
      throw new Error(`Function '${def.name}' is already registered`)
    }

    const metadata: FunctionMetadata = {
      name: def.name,
      arity: def.arity,
      description: def.description,
      argTypes: def.argTypes,
      returnType: def.returnType,
      variadic: def.variadic,
      category: def.category,
      tags: def.tags,
      namespace: def.namespace,
      async: def.async,
      minArity: def.minArity,
      validateArgs: def.validateArgs,
      validateReturn: def.validateReturn,
    }

    // Create wrapper with validation if needed
    const wrappedFn = (def.validateArgs || def.validateReturn)
      ? createValidatedWrapper(def.fn, metadata)
      : def.fn

    this.functions.set(def.name, {
      call: wrappedFn,
      metadata,
    })
  }

  /**
   * Register a method for a specific type
   */
  registerMethod(type: string, def: MethodDefinition): void {
    if (!this.methods.has(type)) {
      this.methods.set(type, new Map())
    }

    const typeRegistry = this.methods.get(type)!

    // Check for duplicates
    if (typeRegistry.has(def.name) && !def.overwrite) {
      throw new Error(`Method '${def.name}' is already registered for type '${type}'`)
    }

    const metadata: FunctionMetadata = {
      name: def.name,
      arity: def.arity,
      description: def.description,
      argTypes: def.argTypes,
      returnType: def.returnType,
      variadic: def.variadic,
      category: def.category,
      tags: def.tags,
      async: def.async,
      minArity: def.minArity,
      validateArgs: def.validateArgs,
      validateReturn: def.validateReturn,
    }

    // Determine if the function is an arrow-style (first param is target) or this-style
    const originalFn = def.fn

    // Arrow functions don't have prototype, regular functions do
    // Arrow functions with (target, ...args) pattern expect target as first param
    // Regular functions use 'this' for the target
    const isArrowFunction = !originalFn.prototype

    // Create a wrapper that handles both .call(target, ...args) and direct calls
    const wrappedFn = function(this: unknown, ...args: unknown[]): unknown {
      if (isArrowFunction) {
        // Arrow function expects target as first arg: (target, arg1, arg2, ...)
        // When called via .call(target, arg1, arg2), this=target
        return originalFn.call(undefined, this, ...args)
      } else {
        // Regular function uses 'this': function(arg1, arg2) { return this.method(arg1, arg2) }
        return originalFn.call(this, ...args)
      }
    }

    // Optionally add validation wrapper
    const finalFn = (def.validateArgs || def.validateReturn)
      ? createValidatedMethodWrapper(wrappedFn, metadata)
      : wrappedFn

    typeRegistry.set(def.name, {
      call: finalFn as (...args: unknown[]) => unknown,
      metadata,
    })
  }

  /**
   * Check if a function is registered
   */
  has(name: string): boolean {
    return this.functions.has(name)
  }

  /**
   * Get a registered function
   */
  get(name: string): ((...args: unknown[]) => unknown) | undefined {
    const registered = this.functions.get(name)
    return registered?.call
  }

  /**
   * Check if a method is registered for a type
   */
  hasMethod(type: string, name: string): boolean {
    return this.methods.get(type)?.has(name) ?? false
  }

  /**
   * Get a registered method
   * Returns a function that takes the target as first arg (for .call() usage)
   */
  getMethod(type: string, name: string): ((...args: unknown[]) => unknown) | undefined {
    const registered = this.methods.get(type)?.get(name)
    if (!registered) return undefined

    // Return a wrapper that properly handles .call() semantics
    // When called as method?.call(target, arg1, arg2), target becomes 'this'
    return registered.call
  }

  /**
   * Get metadata for a function
   */
  getMetadata(name: string): FunctionMetadata | undefined {
    return this.functions.get(name)?.metadata
  }

  /**
   * Get metadata for a method
   */
  getMethodMetadata(type: string, name: string): FunctionMetadata | undefined {
    return this.methods.get(type)?.get(name)?.metadata
  }

  /**
   * List all function names
   */
  listFunctions(options?: ListFunctionsOptions): string[] {
    let names = Array.from(this.functions.keys())

    if (options?.namespace) {
      names = names.filter(name => {
        const meta = this.functions.get(name)?.metadata
        return meta?.namespace === options.namespace
      })
    }

    return names.sort()
  }

  /**
   * List all method names for a type
   */
  listMethods(type: string): string[] {
    const typeRegistry = this.methods.get(type)
    if (!typeRegistry) return []
    return Array.from(typeRegistry.keys()).sort()
  }

  /**
   * List all types with registered methods
   */
  listTypes(): string[] {
    return Array.from(this.methods.keys()).sort()
  }

  /**
   * List all namespaces
   */
  listNamespaces(): string[] {
    const namespaces = new Set<string>()
    for (const [, registered] of this.functions) {
      if (registered.metadata.namespace) {
        namespaces.add(registered.metadata.namespace)
      }
    }
    return Array.from(namespaces).sort()
  }

  /**
   * Count of registered functions
   */
  functionCount(): number {
    return this.functions.size
  }

  /**
   * Count of registered methods for a type
   */
  methodCount(type: string): number {
    return this.methods.get(type)?.size ?? 0
  }

  /**
   * Unregister a function
   */
  unregister(name: string): void {
    this.functions.delete(name)
  }

  /**
   * Unregister a method
   */
  unregisterMethod(type: string, name: string): void {
    this.methods.get(type)?.delete(name)
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.functions.clear()
    this.methods.clear()
  }

  /**
   * Create an alias for an existing function
   */
  alias(original: string, alias: string): void {
    const registered = this.functions.get(original)
    if (!registered) {
      throw new Error(`Function '${original}' not found`)
    }
    this.functions.set(alias, registered)
  }

  /**
   * Create an alias for an existing method
   */
  aliasMethod(type: string, original: string, alias: string): void {
    const typeRegistry = this.methods.get(type)
    if (!typeRegistry) {
      throw new Error(`Type '${type}' not found`)
    }
    const registered = typeRegistry.get(original)
    if (!registered) {
      throw new Error(`Method '${original}' not found for type '${type}'`)
    }
    typeRegistry.set(alias, registered)
  }

  /**
   * Register multiple functions at once (with rollback on failure)
   */
  registerBatch(defs: FunctionDefinition[]): void {
    const registered: string[] = []

    try {
      for (const def of defs) {
        this.register(def)
        registered.push(def.name)
      }
    } catch (error) {
      // Rollback
      for (const name of registered) {
        this.unregister(name)
      }
      throw error
    }
  }

  /**
   * Register multiple methods for a type at once
   */
  registerMethodBatch(type: string, defs: MethodDefinition[]): void {
    const registered: string[] = []

    try {
      for (const def of defs) {
        this.registerMethod(type, def)
        registered.push(def.name)
      }
    } catch (error) {
      // Rollback
      for (const name of registered) {
        this.unregisterMethod(type, name)
      }
      throw error
    }
  }
}

// Type alias for external use
export type FunctionRegistry = FunctionRegistryImpl

// Global singleton registry
let globalRegistry: FunctionRegistryImpl | null = null

/**
 * Get or create the global registry singleton
 * The global registry includes stdlib by default
 */
export function getGlobalRegistry(): FunctionRegistry {
  if (!globalRegistry) {
    globalRegistry = new FunctionRegistryImpl()
    registerStdlib(globalRegistry)
  }
  return globalRegistry
}

/**
 * Reset the global registry (for testing)
 */
export function resetRegistry(): void {
  globalRegistry = null
}

/**
 * Create a new registry instance
 */
export function createRegistry(options?: RegistryOptions): FunctionRegistry {
  const registry = new FunctionRegistryImpl()

  if (options?.includeStdlib) {
    registerStdlib(registry)
  }

  return registry
}

/**
 * Register a global function on the global registry
 */
export function registerGlobalFunction(
  name: string,
  fn: (...args: unknown[]) => unknown,
  options: Partial<FunctionMetadata> & { overwrite?: boolean } = {}
): void {
  const registry = getGlobalRegistry()
  registry.register({
    name,
    fn,
    arity: options.arity ?? fn.length,
    ...options,
  })
}

/**
 * Register a method on the global registry
 */
export function registerMethod(
  type: string,
  name: string,
  fn: (this: unknown, ...args: unknown[]) => unknown,
  options: Partial<FunctionMetadata> & { overwrite?: boolean } = {}
): void {
  const registry = getGlobalRegistry()
  registry.registerMethod(type, {
    name,
    fn,
    arity: options.arity ?? fn.length,
    ...options,
  })
}

/**
 * Register standard library functions
 *
 * REFACTOR: Centralized registration of all stdlib functions and methods.
 * This replaces the switch statements in the interpreter.
 */
function registerStdlib(registry: FunctionRegistry): void {
  // ===== GLOBAL FUNCTIONS =====

  // Type functions
  registry.register({ name: 'type', fn: (x) => typeFunctions.type.call(x), arity: 1, category: 'type' })
  registry.register({ name: 'string', fn: (x) => typeFunctions.string.call(x), arity: 1, category: 'type' })
  registry.register({ name: 'int', fn: (x) => typeFunctions.int.call(x), arity: 1, category: 'type' })
  registry.register({ name: 'float', fn: (x) => typeFunctions.float.call(x), arity: 1, category: 'type' })
  registry.register({ name: 'bool', fn: (x) => typeFunctions.bool.call(x), arity: 1, category: 'type' })
  registry.register({ name: 'array', fn: (x) => typeFunctions.array.call(x), arity: 1, category: 'type' })
  registry.register({ name: 'object', fn: (x) => typeFunctions.object.call(x), arity: 1, category: 'type' })

  // JSON functions
  registry.register({ name: 'from_json', fn: (s) => JSON.parse(String(s)), arity: 1, category: 'json' })
  registry.register({ name: 'parse_json', fn: (s) => JSON.parse(String(s)), arity: 1, category: 'json' })
  registry.register({ name: 'to_json', fn: (x) => JSON.stringify(x), arity: 1, category: 'json' })
  registry.register({ name: 'number', fn: (x) => Number(x), arity: 1, category: 'type' })

  // Number functions with type validation
  registry.register({
    name: 'abs',
    fn: (x: unknown) => {
      if (typeof x !== 'number') throw new TypeError(`abs expects a number, got ${typeof x}`)
      return numberFunctions.abs(x)
    },
    arity: 1,
    category: 'number'
  })
  registry.register({
    name: 'ceil',
    fn: (x: unknown) => {
      if (typeof x !== 'number') throw new TypeError(`ceil expects a number, got ${typeof x}`)
      return numberFunctions.ceil(x)
    },
    arity: 1,
    category: 'number'
  })
  registry.register({
    name: 'floor',
    fn: (x: unknown) => {
      if (typeof x !== 'number') throw new TypeError(`floor expects a number, got ${typeof x}`)
      return numberFunctions.floor(x)
    },
    arity: 1,
    category: 'number'
  })
  registry.register({
    name: 'round',
    fn: (x: unknown) => {
      if (typeof x !== 'number') throw new TypeError(`round expects a number, got ${typeof x}`)
      return numberFunctions.round(x)
    },
    arity: 1,
    category: 'number'
  })
  registry.register({
    name: 'max',
    fn: (a: unknown, b: unknown) => {
      if (typeof a !== 'number') throw new TypeError(`max expects a number, got ${typeof a}`)
      if (typeof b !== 'number') throw new TypeError(`max expects a number, got ${typeof b}`)
      return numberFunctions.max(a, b)
    },
    arity: 2,
    category: 'number'
  })
  registry.register({
    name: 'min',
    fn: (a: unknown, b: unknown) => {
      if (typeof a !== 'number') throw new TypeError(`min expects a number, got ${typeof a}`)
      if (typeof b !== 'number') throw new TypeError(`min expects a number, got ${typeof b}`)
      return numberFunctions.min(a, b)
    },
    arity: 2,
    category: 'number'
  })
  registry.register({
    name: 'sum',
    fn: (arr: unknown) => {
      if (!Array.isArray(arr)) throw new TypeError(`sum expects an array, got ${typeof arr}`)
      for (const elem of arr) {
        if (typeof elem !== 'number') throw new TypeError(`sum array must contain only numbers, got ${typeof elem}`)
      }
      return numberFunctions.sum(arr as number[])
    },
    arity: 1,
    category: 'number'
  })

  // Object functions
  registry.register({ name: 'keys', fn: objectFunctions.keys, arity: 1, category: 'object' })
  registry.register({ name: 'values', fn: objectFunctions.values, arity: 1, category: 'object' })
  registry.register({ name: 'merge', fn: (a, b) => objectFunctions.merge(a, b), arity: 2, category: 'object' })
  registry.register({ name: 'without', fn: (obj, keys) => objectFunctions.without(obj, keys as string[]), arity: 2, category: 'object' })
  registry.register({ name: 'exists', fn: (obj, path) => objectFunctions.exists(obj, path as string), arity: 2, category: 'object' })
  registry.register({ name: 'get', fn: (obj, path, def) => objectFunctions.get(obj, path as string, def), arity: 3, minArity: 2, category: 'object' })
  registry.register({ name: 'set', fn: (obj, path, val) => objectFunctions.set(obj, path as string, val), arity: 3, category: 'object' })
  registry.register({
    name: 'entries',
    fn: (obj) => Object.entries(obj as Record<string, unknown>),
    arity: 1,
    category: 'object'
  })

  // String functions (global versions)
  registry.register({ name: 'uppercase', fn: (s) => stringFunctions.uppercase.call(s), arity: 1, category: 'string' })
  registry.register({ name: 'lowercase', fn: (s) => stringFunctions.lowercase.call(s), arity: 1, category: 'string' })
  registry.register({
    name: 'length',
    fn: (x: unknown) => {
      if (typeof x === 'string') return stringFunctions.length.call(x)
      if (Array.isArray(x)) return x.length
      throw new TypeError(`length expects a string or array, got ${typeof x}`)
    },
    arity: 1,
    category: 'string'
  })
  registry.register({
    name: 'substring',
    fn: (s, start, end) => stringFunctions.slice.call(s, start, end),
    arity: 3,
    minArity: 2,
    category: 'string'
  })
  registry.register({
    name: 'replace',
    fn: (s, old, replacement) => stringFunctions.replace.call(s, old, replacement),
    arity: 3,
    category: 'string'
  })

  // ===== STRING METHODS =====

  registry.registerMethod('string', {
    name: 'uppercase',
    fn: function(this: string) { return stringFunctions.uppercase.call(this) },
    arity: 0,
  })
  registry.registerMethod('string', {
    name: 'upper',
    fn: function(this: string) { return stringFunctions.uppercase.call(this) },
    arity: 0,
  })
  registry.registerMethod('string', {
    name: 'lowercase',
    fn: function(this: string) { return stringFunctions.lowercase.call(this) },
    arity: 0,
  })
  registry.registerMethod('string', {
    name: 'lower',
    fn: function(this: string) { return stringFunctions.lowercase.call(this) },
    arity: 0,
  })
  registry.registerMethod('string', {
    name: 'length',
    fn: function(this: string) { return stringFunctions.length.call(this) },
    arity: 0,
  })
  registry.registerMethod('string', {
    name: 'trim',
    fn: function(this: string) { return stringFunctions.trim.call(this) },
    arity: 0,
  })
  registry.registerMethod('string', {
    name: 'split',
    fn: function(this: string, delimiter: unknown) { return stringFunctions.split.call(this, delimiter) },
    arity: 1,
  })
  registry.registerMethod('string', {
    name: 'replace',
    fn: function(this: string, old: unknown, replacement: unknown) { return stringFunctions.replace.call(this, old, replacement) },
    arity: 2,
  })
  registry.registerMethod('string', {
    name: 'replace_all',
    fn: function(this: string, old: unknown, replacement: unknown) { return stringFunctions.replace_all.call(this, old, replacement) },
    arity: 2,
  })
  registry.registerMethod('string', {
    name: 'substring',
    fn: function(this: string, start: unknown, end: unknown) { return stringFunctions.slice.call(this, start, end) },
    arity: 2,
    minArity: 1,
  })
  registry.registerMethod('string', {
    name: 'slice',
    fn: function(this: string, start: unknown, end: unknown) { return stringFunctions.slice.call(this, start, end) },
    arity: 2,
    minArity: 1,
  })
  registry.registerMethod('string', {
    name: 'contains',
    fn: function(this: string, substr: unknown) { return stringFunctions.contains.call(this, substr) },
    arity: 1,
  })
  registry.registerMethod('string', {
    name: 'has_prefix',
    fn: function(this: string, prefix: unknown) { return stringFunctions.has_prefix.call(this, prefix) },
    arity: 1,
  })
  registry.registerMethod('string', {
    name: 'has_suffix',
    fn: function(this: string, suffix: unknown) { return stringFunctions.has_suffix.call(this, suffix) },
    arity: 1,
  })

  // ===== ARRAY METHODS =====

  // Note: map and filter are registered here for discoverability but
  // actual lambda evaluation is handled by the interpreter
  registry.registerMethod('array', {
    name: 'map',
    fn: function(this: unknown[], fn: (elem: unknown, idx: number) => unknown) {
      return this.map(fn)
    },
    arity: 1,
  })
  registry.registerMethod('array', {
    name: 'filter',
    fn: function(this: unknown[], fn: (elem: unknown, idx: number) => boolean) {
      return this.filter(fn)
    },
    arity: 1,
  })
  registry.registerMethod('array', {
    name: 'length',
    fn: function(this: unknown[]) { return this.length },
    arity: 0,
  })
  registry.registerMethod('array', {
    name: 'sort',
    fn: function(this: unknown[]) { return arrayFunctions.sort.call(this) },
    arity: 0,
  })
  registry.registerMethod('array', {
    name: 'reverse',
    fn: function(this: unknown[]) { return arrayFunctions.reverse.call(this) },
    arity: 0,
  })
  registry.registerMethod('array', {
    name: 'first',
    fn: function(this: unknown[]) { return arrayFunctions.first.call(this) },
    arity: 0,
  })
  registry.registerMethod('array', {
    name: 'last',
    fn: function(this: unknown[]) { return arrayFunctions.last.call(this) },
    arity: 0,
  })
  registry.registerMethod('array', {
    name: 'flatten',
    fn: function(this: unknown[]) { return arrayFunctions.flatten.call(this) },
    arity: 0,
  })
  registry.registerMethod('array', {
    name: 'unique',
    fn: function(this: unknown[]) { return arrayFunctions.unique.call(this) },
    arity: 0,
  })
  registry.registerMethod('array', {
    name: 'join',
    fn: function(this: unknown[], delimiter: unknown) { return this.join(String(delimiter ?? ',')) },
    arity: 1,
    minArity: 0,
  })
  registry.registerMethod('array', {
    name: 'contains',
    fn: function(this: unknown[], val: unknown) { return arrayFunctions.contains.call(this, val) },
    arity: 1,
  })
  registry.registerMethod('array', {
    name: 'append',
    fn: function(this: unknown[], val: unknown) { return arrayFunctions.append.call(this, val) },
    arity: 1,
  })
  registry.registerMethod('array', {
    name: 'concat',
    fn: function(this: unknown[], arr: unknown) { return arrayFunctions.concat.call(this, arr as unknown[]) },
    arity: 1,
  })
  registry.registerMethod('array', {
    name: 'slice',
    fn: function(this: unknown[], start: unknown, end: unknown) {
      if (typeof start !== 'number') throw new TypeError(`slice start index must be a number, got ${typeof start}`)
      if (end !== undefined && typeof end !== 'number') throw new TypeError(`slice end index must be a number, got ${typeof end}`)
      return arrayFunctions.slice.call(this, start as number, end as number | undefined)
    },
    arity: 2,
    minArity: 1,
  })
  registry.registerMethod('array', {
    name: 'index',
    fn: function(this: unknown[], i: unknown) {
      if (typeof i !== 'number') throw new TypeError(`index argument must be a number, got ${typeof i}`)
      return arrayFunctions.index.call(this, i as number)
    },
    arity: 1,
  })
  registry.registerMethod('array', {
    name: 'sum',
    fn: function(this: unknown[]) {
      for (const elem of this) {
        if (typeof elem !== 'number') throw new TypeError(`sum array must contain only numbers, got ${typeof elem}`)
      }
      return numberFunctions.sum(this as number[])
    },
    arity: 0,
  })
  // Note: reduce is registered here for discoverability but
  // actual lambda evaluation is handled by the interpreter
  registry.registerMethod('array', {
    name: 'reduce',
    fn: function(this: unknown[], fn: (acc: unknown, elem: unknown) => unknown, initial: unknown) {
      return this.reduce((acc, elem) => fn(acc, elem), initial)
    },
    arity: 2,
  })

  // ===== OBJECT METHODS =====

  registry.registerMethod('object', {
    name: 'keys',
    fn: function(this: Record<string, unknown>) { return objectFunctions.keys(this) },
    arity: 0,
  })
  registry.registerMethod('object', {
    name: 'values',
    fn: function(this: Record<string, unknown>) { return objectFunctions.values(this) },
    arity: 0,
  })
}
