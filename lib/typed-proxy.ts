/**
 * Typed Proxy Utilities
 *
 * These utilities provide type-safe proxy creation, eliminating the need for
 * `as unknown as` double assertions when creating fluent API proxies.
 *
 * The core insight is that JavaScript Proxies return values don't match the
 * target type - they can return any type based on handler logic. This file
 * provides utilities to create proxies with proper type inference.
 *
 * @module lib/typed-proxy
 *
 * @example
 * ```typescript
 * // Instead of:
 * export const every = new Proxy((() => {}) as unknown as EveryFunction, handler)
 *
 * // Use:
 * export const every = createTypedProxy<EveryFunction>(
 *   () => {},  // Any target works
 *   handler,
 *   'every'    // Optional debug name
 * )
 * ```
 */

// ============================================================================
// CORE TYPED PROXY FACTORY
// ============================================================================

/**
 * Creates a Proxy with correct TypeScript typing for the public interface.
 *
 * This eliminates the `as unknown as T` pattern by encapsulating the type
 * assertion in a single, well-documented location.
 *
 * @typeParam TPublic - The public interface type (what callers see)
 * @typeParam TTarget - The actual target type (usually simpler)
 * @param target - The proxy target (can be any callable or object)
 * @param handler - The proxy handler implementing the behavior
 * @param debugName - Optional name for debugging (shows in stack traces)
 * @returns A proxy with the TPublic interface
 *
 * @example
 * ```typescript
 * interface EveryFunction {
 *   (schedule: string, handler: Function): Unsubscribe
 *   Monday: EveryTimeProxy
 *   Tuesday: EveryTimeProxy
 *   // ...
 * }
 *
 * const every = createTypedProxy<EveryFunction>(
 *   () => {},
 *   {
 *     get(target, prop) { ... },
 *     apply(target, thisArg, args) { ... }
 *   }
 * )
 * ```
 */
export function createTypedProxy<TPublic, TTarget extends object = object>(
  target: TTarget,
  handler: ProxyHandler<TTarget>,
  debugName?: string
): TPublic {
  // The proxy is the single point where we accept type mismatch between
  // target and public interface - this is documented and intentional.
  const proxy = new Proxy(target, handler)

  // Add debug name if provided (helps with stack traces)
  if (debugName && typeof proxy === 'object' && proxy !== null) {
    Object.defineProperty(proxy, Symbol.toStringTag, {
      value: debugName,
      configurable: true,
    })
  }

  // Type assertion: The proxy handler defines the actual behavior,
  // which implements TPublic. The target is just a placeholder.
  return proxy as unknown as TPublic
}

// ============================================================================
// CALLABLE PROXY FACTORIES
// ============================================================================

/**
 * Creates a callable proxy that can be invoked as both a function and accessed as an object.
 *
 * This is the most common pattern for fluent APIs like `$.every.Monday.at9am(handler)`
 * where `every` is both callable (`every('Monday at 9am', handler)`) and has properties.
 *
 * @typeParam TPublic - The public callable interface type
 * @param handler - The proxy handler with both `get` and `apply` traps
 * @param debugName - Optional name for debugging
 * @returns A callable proxy with the TPublic interface
 *
 * @example
 * ```typescript
 * const every = createCallableProxy<EveryFunction>({
 *   get(target, prop) {
 *     if (prop === 'Monday') return createTimeProxy('Monday')
 *     // ...
 *   },
 *   apply(target, thisArg, [schedule, handler]) {
 *     return registerSchedule(schedule, handler)
 *   }
 * })
 *
 * // Both work:
 * every('Monday at 9am', handler)
 * every.Monday.at9am(handler)
 * ```
 */
export function createCallableProxy<TPublic>(
  handler: ProxyHandler<() => unknown>,
  debugName?: string
): TPublic {
  return createTypedProxy<TPublic, () => unknown>(
    () => {
      // Empty function as target - handler.apply provides actual behavior
    },
    handler,
    debugName
  )
}

/**
 * Creates a nested callable proxy for chained property access.
 *
 * Use this for intermediate proxy levels like `.Monday` in `every.Monday.at9am()`.
 *
 * @typeParam TPublic - The public interface for this level
 * @param handler - Handler for this proxy level
 * @returns Nested callable proxy
 */
export function createNestedProxy<TPublic>(
  handler: ProxyHandler<() => unknown>
): TPublic {
  return createTypedProxy<TPublic, () => unknown>(() => {}, handler)
}

// ============================================================================
// OBJECT PROXY FACTORIES
// ============================================================================

/**
 * Creates a non-callable object proxy with type-safe interface.
 *
 * Use this for proxies that are accessed purely via properties, not called.
 *
 * @typeParam TPublic - The public object interface type
 * @param handler - The proxy handler
 * @param debugName - Optional name for debugging
 * @returns An object proxy with the TPublic interface
 */
export function createObjectProxy<TPublic extends object>(
  handler: ProxyHandler<object>,
  debugName?: string
): TPublic {
  return createTypedProxy<TPublic, object>({}, handler, debugName)
}

// ============================================================================
// SCHEDULE BUILDER PROXY
// ============================================================================

/**
 * Configuration for schedule builder proxy
 */
export interface ScheduleBuilderConfig {
  /** Callback when a schedule is registered */
  onScheduleRegistered: (cron: string, name: string, handler: ScheduleHandler) => void
}

/** Handler function type for schedules */
export type ScheduleHandler = () => void | Promise<void>

/**
 * Creates a type-safe schedule builder proxy.
 *
 * This is a specialized factory for the `$.every` fluent API pattern.
 *
 * @param config - Schedule builder configuration
 * @returns ScheduleBuilder proxy
 */
export function createScheduleBuilderProxy<TScheduleBuilder>(
  config: ScheduleBuilderConfig
): TScheduleBuilder {
  const { onScheduleRegistered } = config

  return createCallableProxy<TScheduleBuilder>({
    get(_target, day: string) {
      // Return time proxy for day access: every.Monday.at9am
      return createNestedProxy<unknown>({
        get(_timeTarget, time: string) {
          // Return handler registrar: every.Monday.at9am(handler)
          return (handler: ScheduleHandler, name?: string) => {
            const cron = `${day}@${time}` // Simplified - real impl converts to cron
            const scheduleName = name ?? `schedule:${cron}`
            onScheduleRegistered(cron, scheduleName, handler)
          }
        },
        apply(_timeTarget, _thisArg, [handler, name]: [ScheduleHandler, string?]) {
          // Direct day call: every.Monday(handler)
          const cron = day
          const scheduleName = name ?? `schedule:${cron}`
          onScheduleRegistered(cron, scheduleName, handler)
        },
      })
    },
    apply(_target, _thisArg, [schedule, handler, name]: [string, ScheduleHandler, string?]) {
      // Natural language: every('Monday at 9am', handler)
      const scheduleName = name ?? `schedule:${schedule}`
      onScheduleRegistered(schedule, scheduleName, handler)
    },
  }, 'ScheduleBuilder')
}

// ============================================================================
// DOMAIN PROXY UTILITIES
// ============================================================================

/**
 * Creates a domain proxy for cross-DO method invocation.
 *
 * This provides type-safe access to methods on remote DOs.
 *
 * @typeParam TProxy - The public interface for the domain
 * @param invoker - Function to invoke methods on the target
 * @returns Domain proxy
 */
export function createDomainProxy<TProxy>(
  invoker: (method: string, args: unknown[]) => Promise<unknown>
): TProxy {
  return createObjectProxy<TProxy>({
    get(_target, method: string) {
      // Skip Promise thenable methods to avoid auto-resolution
      if (method === 'then' || method === 'catch' || method === 'finally') {
        return undefined
      }

      // Return method wrapper
      return (...args: unknown[]) => invoker(method, args)
    },
  }, 'DomainProxy')
}

// ============================================================================
// TYPE ASSERTIONS (FOR CONTROLLED USE)
// ============================================================================

/**
 * Single-point type assertion for proxy returns.
 *
 * Use this ONLY when creating proxies where the handler defines behavior
 * that doesn't match the target type. This documents intent clearly.
 *
 * @internal Use createTypedProxy instead for new code
 */
export function asProxyInterface<T>(proxy: object): T {
  return proxy as unknown as T
}

// ============================================================================
// EXPORTS
// ============================================================================

export type {
  ScheduleBuilderConfig,
  ScheduleHandler,
}
