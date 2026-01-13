/**
 * Capability Infrastructure
 *
 * This module provides the infrastructure for adding optional capabilities
 * to Durable Object classes. Capabilities are:
 * - Opt-in: Only added when explicitly composed with withX(Base)
 * - Lazy-initialized: API created on first $ property access
 * - Type-safe: TypeScript inference for capability APIs on $ context
 * - Composable: Multiple capabilities can be chained
 *
 * @example
 * ```typescript
 * const withFS = createCapability('fs', (ctx) => ({
 *   read: (path: string) => ctx.sql.exec(`SELECT * FROM files WHERE path = ?`, [path]),
 *   write: (path: string, content: string) => // ...
 * }))
 *
 * class MyDO extends withFS(DO) {
 *   async handleRequest() {
 *     const file = await this.$.fs.read('/config.json')
 *   }
 * }
 * ```
 *
 * @see dotdo-k9fw4 issue for design details
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Generic class constructor type
 */
export type Constructor<T = {}> = new (...args: any[]) => T

/**
 * Context passed to capability initialization functions
 */
export interface CapabilityContext {
  /** Durable Object state */
  state: DurableObjectState
  /** Environment bindings */
  env: unknown
  /** Current WorkflowContext (base $, or proxied $ with capabilities) */
  $: unknown
}

/**
 * Capability initialization function
 * Receives context and returns the capability API
 */
export type CapabilityInit<API> = (ctx: CapabilityContext) => API

/**
 * Capability function type - transforms a base class into an extended class
 */
export type CapabilityMixin<Name extends string, API> = <TBase extends Constructor<DOBase>>(
  Base: TBase
) => TBase & Constructor<{ hasCapability(name: string): boolean }>

/**
 * Base interface that DO classes must implement to support capabilities
 */
interface DOBase {
  ctx: DurableObjectState
  env: unknown
  $: unknown
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Symbol used to store capability cache on instances
 * Using Symbol.for() ensures the symbol is globally unique and
 * consistent across module evaluations.
 */
const CAPABILITY_CACHE = Symbol.for('dotdo.capabilityCache')

/**
 * Symbol used to store capability init functions on classes
 * Using Symbol.for() ensures the symbol is globally unique and
 * consistent across module evaluations.
 */
const CAPABILITY_INITS = Symbol.for('dotdo.capabilityInits')

/**
 * Create a capability that adds a named capability to a DO class.
 *
 * The capability:
 * 1. Adds the capability name to a static `capabilities` array
 * 2. Provides a `hasCapability(name)` method for runtime capability detection
 * 3. Wraps the `$` getter with a Proxy for lazy capability initialization
 * 4. Caches capability instances per-DO instance
 *
 * @param name - Capability name (e.g., 'fs', 'git', 'bash')
 * @param init - Initialization function that returns the capability API
 * @returns Capability function that transforms a base class
 */
export function createCapability<Name extends string, API>(
  name: Name,
  init: CapabilityInit<API>
): CapabilityMixin<Name, API> {
  return function <TBase extends Constructor<DOBase>>(Base: TBase) {
    // Get existing capabilities from base class
    const existingCapabilities: string[] = (Base as any).capabilities || []

    // Check if this capability is already registered (idempotency)
    const hasExisting = existingCapabilities.includes(name)

    // Get existing init functions from base class
    const existingInits: Map<string, CapabilityInit<unknown>> =
      (Base as any)[CAPABILITY_INITS] || new Map()

    // Create new inits map with this capability's init
    // (overwrites if same name, supporting "last applied wins")
    const newInits = new Map(existingInits)
    newInits.set(name, init as CapabilityInit<unknown>)

    // Build the new capabilities array
    const newCapabilities = hasExisting
      ? existingCapabilities
      : [...existingCapabilities, name]

    const ResultClass = class MixedClass extends Base {
      /**
       * Instance-level cache for initialized capabilities
       */
      [CAPABILITY_CACHE] = new Map<string, unknown>()

      /**
       * Cached base $ from parent class
       */
      #base$: unknown

      constructor(...args: any[]) {
        super(...args)
        // Capture the base $ before we potentially delete it
        // The base DO class sets this.$ in its constructor as an own property,
        // which shadows our getter. We capture it and delete the own property
        // so our getter can intercept property access.
        //
        // For composed mixins (withB(withA(DO))), the inner mixin already
        // deleted the own property, so hasOwn returns false and we skip deletion.
        // In that case, this.$ triggers the inner mixin's getter, which returns
        // a Proxy - we capture that proxy as our base$.
        const hasOwnDollar = Object.hasOwn(this, '$')
        this.#base$ = (this as any).$
        if (hasOwnDollar) {
          delete (this as any).$
        }
      }

      /**
       * Check if this DO instance has a specific capability.
       *
       * @param cap - Capability name to check
       * @returns true if capability is registered
       */
      hasCapability(cap: string): boolean {
        return (this.constructor as any).capabilities?.includes(cap) ?? false
      }

      /**
       * WorkflowContext with capability extensions.
       * Wraps the base $ with a Proxy that intercepts capability property access.
       */
      get $() {
        let base$ = this.#base$

        // If #base$ is undefined, we're being called during a subclass's constructor
        // before that subclass has had a chance to set its #base$. In this case,
        // we need to return super's $ directly (which will be our proxied version).
        // This happens when withB(withA(DO)) and B's constructor calls this.$.
        if (base$ === undefined) {
          // Try to get $ from the prototype chain (bypassing our getter)
          const proto = Object.getPrototypeOf(Object.getPrototypeOf(this))
          const descriptor = Object.getOwnPropertyDescriptor(proto, '$')
          if (descriptor?.get) {
            base$ = descriptor.get.call(this)
          }
        }

        // If still undefined, something is wrong
        if (base$ === undefined) {
          throw new Error(`Capability '${name}': base $ context is undefined`)
        }

        const cache = this[CAPABILITY_CACHE]
        const inits = (this.constructor as any)[CAPABILITY_INITS] as Map<
          string,
          CapabilityInit<unknown>
        >
        const instance = this

        return new Proxy(base$ as object, {
          get(target, prop, receiver) {
            // Check if this is a capability property
            if (typeof prop === 'string' && inits.has(prop)) {
              // Lazy initialize capability on first access
              if (!cache.has(prop)) {
                const capInit = inits.get(prop)!
                const ctx: CapabilityContext = {
                  state: instance.ctx,
                  env: instance.env,
                  // Pass the proxied $ so capabilities can access other capabilities
                  $: receiver,
                }
                cache.set(prop, capInit(ctx))
              }
              return cache.get(prop)
            }

            // Fall through to base $ properties
            return Reflect.get(target, prop, receiver)
          },
        })
      }
    }

    // Set static properties directly on the class object
    // (using Object.defineProperty to avoid class field evaluation issues with closures)
    Object.defineProperty(ResultClass, CAPABILITY_INITS, {
      value: newInits,
      writable: false,
      enumerable: false,
      configurable: false,
    })
    Object.defineProperty(ResultClass, 'capabilities', {
      value: newCapabilities,
      writable: true,
      enumerable: true,
      configurable: true,
    })

    return ResultClass
  }
}
