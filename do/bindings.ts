/**
 * Type-safe DO Binding Registry (do-hsfo)
 *
 * Provides compile-time validation for Durable Object binding names,
 * catching typos before runtime.
 *
 * @example
 * ```typescript
 * // Define your bindings once
 * interface AppBindings {
 *   USER_DO: DurableObjectNamespace
 *   SESSION_DO: DurableObjectNamespace
 *   ANALYTICS_DO: DurableObjectNamespace
 * }
 *
 * // Type-safe access with autocomplete
 * const accessor = createBindingAccessor<AppBindings>(env)
 * const userDO = accessor.get('USER_DO')  // Autocomplete works!
 * const invalid = accessor.get('TYPO_DO') // Compile error!
 *
 * // Or use the simple helper
 * const userDO = getBinding<AppBindings, 'USER_DO'>('USER_DO', env)
 * ```
 */

/**
 * Generic DurableObjectNamespace type that works with any type parameter.
 * This ensures compatibility with both typed and untyped DO namespaces.
 * The `any` type parameter is required because DurableObjectNamespace is generic
 * and we need to match namespaces with arbitrary DO class types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDurableObjectNamespace = DurableObjectNamespace<any>

/**
 * Constraint type for binding registries.
 * Uses a mapped type approach to avoid strict index signature issues.
 */
export type DOBindingConstraint = {
  [key: string]: AnyDurableObjectNamespace
}

/**
 * Base type for DO binding registries.
 * All values must be DurableObjectNamespace (with any type parameter).
 */
export type DOBindingRegistry<T extends DOBindingConstraint> = T

/**
 * Extract binding names as a union type from a registry
 */
export type BindingNames<T extends DOBindingConstraint> = keyof T & string

/**
 * Validate that a binding name exists in the registry at compile time
 */
export type ValidateBindingName<
  T extends DOBindingConstraint,
  K extends string
> = K extends keyof T ? K : never

/**
 * Type-safe binding accessor with autocomplete support
 */
export interface BindingAccessor<T extends DOBindingConstraint> {
  /**
   * Get a DO namespace by name with compile-time validation
   * @param name - The binding name (autocomplete enabled)
   * @returns The DurableObjectNamespace
   * @throws Error if binding is not found at runtime
   */
  get<K extends BindingNames<T>>(name: K): T[K]

  /**
   * Check if a binding exists at runtime
   * @param name - The binding name to check
   * @returns true if the binding exists
   */
  has<K extends BindingNames<T>>(name: K): boolean

  /**
   * Get all registered binding names
   * @returns Array of binding names
   */
  names(): BindingNames<T>[]

  /**
   * Get a DO stub by binding name and ID
   * @param name - The binding name
   * @param id - The Durable Object ID or string name
   * @returns DurableObjectStub for the specified DO
   */
  getStub<K extends BindingNames<T>>(
    name: K,
    id: string | DurableObjectId
  ): DurableObjectStub<undefined>

  /**
   * Create a new unique ID for a binding
   * @param name - The binding name
   * @returns A new unique DurableObjectId
   */
  newUniqueId<K extends BindingNames<T>>(name: K): DurableObjectId

  /**
   * Get or create an ID from a string name
   * @param name - The binding name
   * @param idName - The string name to convert to an ID
   * @returns The DurableObjectId for the name
   */
  idFromName<K extends BindingNames<T>>(name: K, idName: string): DurableObjectId

  /**
   * Get an ID from a hex string
   * @param name - The binding name
   * @param hexId - The hex string representation of the ID
   * @returns The DurableObjectId
   */
  idFromString<K extends BindingNames<T>>(name: K, hexId: string): DurableObjectId
}

/**
 * Create a type-safe binding accessor for your environment
 *
 * @example
 * ```typescript
 * interface MyBindings {
 *   USER_DO: DurableObjectNamespace
 *   ORDER_DO: DurableObjectNamespace
 * }
 *
 * const bindings = createBindingAccessor<MyBindings>(env)
 * const userNS = bindings.get('USER_DO')  // Type-safe!
 * const stub = bindings.getStub('USER_DO', 'user-123')
 * ```
 *
 * @param env - The environment object containing DO bindings
 * @returns A type-safe binding accessor
 */
export function createBindingAccessor<T extends DOBindingConstraint>(
  env: T
): BindingAccessor<T> {
  return {
    get<K extends BindingNames<T>>(name: K): T[K] {
      const binding = env[name]
      if (!binding) {
        throw new Error(`Durable Object binding "${name}" not found in environment`)
      }
      return binding
    },

    has<K extends BindingNames<T>>(name: K): boolean {
      return name in env && env[name] !== undefined
    },

    names(): BindingNames<T>[] {
      return Object.keys(env).filter(
        (key) => env[key as keyof T] && typeof env[key as keyof T] === 'object'
      ) as BindingNames<T>[]
    },

    getStub<K extends BindingNames<T>>(
      name: K,
      id: string | DurableObjectId
    ): DurableObjectStub<undefined> {
      const namespace = this.get(name) as DurableObjectNamespace<undefined>
      const doId = typeof id === 'string' ? namespace.idFromName(id) : id
      return namespace.get(doId)
    },

    newUniqueId<K extends BindingNames<T>>(name: K): DurableObjectId {
      return this.get(name).newUniqueId()
    },

    idFromName<K extends BindingNames<T>>(name: K, idName: string): DurableObjectId {
      return this.get(name).idFromName(idName)
    },

    idFromString<K extends BindingNames<T>>(name: K, hexId: string): DurableObjectId {
      return this.get(name).idFromString(hexId)
    }
  }
}

/**
 * Simple helper to get a single binding with type safety
 *
 * @example
 * ```typescript
 * interface MyBindings {
 *   USER_DO: DurableObjectNamespace
 * }
 *
 * // Type-safe binding access
 * const userDO = getBinding<MyBindings, 'USER_DO'>('USER_DO', env)
 *
 * // This would fail at compile time:
 * // const bad = getBinding<MyBindings, 'TYPO'>('TYPO', env)
 * ```
 *
 * @param name - The binding name (must be a valid key of T)
 * @param env - The environment object
 * @returns The DurableObjectNamespace
 */
export function getBinding<
  T extends DOBindingConstraint,
  K extends keyof T & string
>(name: K, env: T): T[K] {
  const binding = env[name]
  if (!binding) {
    throw new Error(`Durable Object binding "${name}" not found in environment`)
  }
  return binding
}

/**
 * Get a DO stub directly with type-safe binding name
 *
 * @example
 * ```typescript
 * interface MyBindings {
 *   USER_DO: DurableObjectNamespace
 * }
 *
 * const stub = getStub<MyBindings, 'USER_DO'>('USER_DO', 'user-123', env)
 * const response = await stub.fetch(new Request('https://example.com'))
 * ```
 *
 * @param name - The binding name
 * @param id - The DO ID (string name or DurableObjectId)
 * @param env - The environment object
 * @returns The DurableObjectStub
 */
export function getStub<
  T extends DOBindingConstraint,
  K extends keyof T & string
>(name: K, id: string | DurableObjectId, env: T): DurableObjectStub<undefined> {
  const namespace = env[name] as DurableObjectNamespace<undefined>
  if (!namespace) {
    throw new Error(`Durable Object binding "${name}" not found in environment`)
  }
  const doId = typeof id === 'string' ? namespace.idFromName(id) : id
  return namespace.get(doId)
}

/**
 * Type helper for defining environment interfaces
 *
 * Use this to ensure your Env interface has the correct shape.
 *
 * @example
 * ```typescript
 * interface Env extends DOBindings<{
 *   USER_DO: DurableObjectNamespace
 *   ORDER_DO: DurableObjectNamespace
 * }> {
 *   // Other env bindings...
 *   KV: KVNamespace
 *   API_KEY: string
 * }
 * ```
 */
export type DOBindings<T extends DOBindingConstraint> = T

/**
 * Extract only the DO bindings from an environment type
 *
 * @example
 * ```typescript
 * interface Env {
 *   USER_DO: DurableObjectNamespace
 *   ORDER_DO: DurableObjectNamespace
 *   KV: KVNamespace
 *   API_KEY: string
 * }
 *
 * // ExtractDOBindings<Env> = { USER_DO: DurableObjectNamespace, ORDER_DO: DurableObjectNamespace }
 * type MyDOBindings = ExtractDOBindings<Env>
 * ```
 */
export type ExtractDOBindings<T> = {
  [K in keyof T as T[K] extends AnyDurableObjectNamespace ? K : never]: T[K]
}

/**
 * Type guard to check if a value is a DurableObjectNamespace
 *
 * @param value - The value to check
 * @returns true if the value is a DurableObjectNamespace
 */
export function isDurableObjectNamespace(value: unknown): value is AnyDurableObjectNamespace {
  return (
    typeof value === 'object' &&
    value !== null &&
    'get' in value &&
    'idFromName' in value &&
    'idFromString' in value &&
    'newUniqueId' in value &&
    typeof (value as AnyDurableObjectNamespace).get === 'function' &&
    typeof (value as AnyDurableObjectNamespace).idFromName === 'function' &&
    typeof (value as AnyDurableObjectNamespace).idFromString === 'function' &&
    typeof (value as AnyDurableObjectNamespace).newUniqueId === 'function'
  )
}

/**
 * Auto-extract DO bindings from an environment object at runtime
 *
 * Useful when you don't have compile-time types for the environment.
 *
 * @example
 * ```typescript
 * const doBindings = extractDOBindings(env)
 * // doBindings is Record<string, DurableObjectNamespace>
 * ```
 *
 * @param env - The environment object
 * @returns An object containing only the DO namespace bindings
 */
export function extractDOBindings(env: Record<string, unknown>): DOBindingConstraint {
  const result: DOBindingConstraint = {}

  for (const [key, value] of Object.entries(env)) {
    if (isDurableObjectNamespace(value)) {
      result[key] = value
    }
  }

  return result
}

/**
 * Create a typed environment subset containing only DO bindings
 *
 * @example
 * ```typescript
 * interface Env {
 *   USER_DO: DurableObjectNamespace
 *   KV: KVNamespace
 * }
 *
 * const doEnv = asBindingRegistry<Pick<Env, 'USER_DO'>>(env)
 * const accessor = createBindingAccessor(doEnv)
 * ```
 *
 * @param env - The full environment object
 * @returns The same object, typed as a DOBindingRegistry
 */
export function asBindingRegistry<T extends DOBindingConstraint>(
  env: T
): DOBindingRegistry<T> {
  return env
}

/**
 * Utility type to make binding names a string literal union
 *
 * @example
 * ```typescript
 * const BINDINGS = ['USER_DO', 'ORDER_DO', 'SESSION_DO'] as const
 * type MyBindingNames = BindingUnion<typeof BINDINGS>
 * // MyBindingNames = 'USER_DO' | 'ORDER_DO' | 'SESSION_DO'
 * ```
 */
export type BindingUnion<T extends readonly string[]> = T[number]

/**
 * Create a binding registry type from a const array of names
 *
 * @example
 * ```typescript
 * const BINDINGS = ['USER_DO', 'ORDER_DO'] as const
 * type MyRegistry = RegistryFromNames<typeof BINDINGS>
 * // MyRegistry = { USER_DO: DurableObjectNamespace, ORDER_DO: DurableObjectNamespace }
 * ```
 */
export type RegistryFromNames<T extends readonly string[]> = {
  [K in T[number]]: AnyDurableObjectNamespace
}
