/**
 * Domain Registry System for ai-workflows
 *
 * Provides a factory for creating domain objects with handlers that capture
 * source code for serialization, and a global registry for handler resolution.
 *
 * Type Inference:
 * The Domain factory uses TypeScript generics to preserve type information
 * for all handlers, enabling full type safety when calling handler functions.
 */

/**
 * Standard handler function signature.
 * Handlers receive: context, args, and the $ workflow API.
 */
// biome-ignore lint/suspicious/noExplicitAny: Handler functions can accept any context/args
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HandlerFunction<TContext = any, TArgs = any, TResult = any> = (
  context: TContext,
  args: TArgs,
  $: unknown,
) => TResult | Promise<TResult>

/**
 * A wrapped handler with both the function and its source code.
 * Generic over the handler function type to preserve type information.
 */
export interface Handler<T extends HandlerFunction = HandlerFunction> {
  fn: T
  source: string
}

/**
 * Maps handler names to their handler functions.
 */
export type HandlerMap = Record<string, HandlerFunction>

/**
 * Converts a HandlerMap to a record of wrapped Handlers.
 * Preserves the specific function type for each handler.
 */
export type WrappedHandlers<T extends HandlerMap> = {
  [K in keyof T]: Handler<T[K]>
}

/**
 * A domain object with type-safe handlers.
 * Generic over the handlers map to preserve full type information.
 */
export interface DomainObject<T extends HandlerMap = HandlerMap> {
  name: string
  handlers: WrappedHandlers<T>
}

/**
 * Base interface for domain objects in the registry (non-generic for storage).
 */
export interface DomainObjectBase {
  name: string
  handlers: Record<string, Handler>
}

// Global registry for domains
const domainRegistry = new Map<string, DomainObjectBase>()

/**
 * Creates a domain object with named handlers.
 * Each handler is wrapped to include both the function and its source code.
 *
 * Type inference automatically preserves the types of all handlers:
 * - Context types are inferred from the first parameter
 * - Args types are inferred from the second parameter
 * - Return types are inferred from the return value
 *
 * @param name - The domain name (e.g., 'Inventory', 'Payment')
 * @param handlers - Object mapping handler names to handler functions
 * @returns A DomainObject with name and type-safe wrapped handlers
 *
 * @example
 * const Inventory = Domain('Inventory', {
 *   check: async (product: Product, _, $) => ({ available: true, sku: product.sku }),
 *   reserve: async (product: Product, { quantity }: { quantity: number }, $) => ({
 *     reservationId: crypto.randomUUID(),
 *     quantity,
 *   }),
 * })
 *
 * // Type inference works:
 * const checkFn = Inventory.handlers.check.fn
 * // checkFn is typed as: (product: Product, _: any, $: unknown) => Promise<{ available: boolean; sku: string }>
 */
export function Domain<T extends HandlerMap>(name: string, handlers: T): DomainObject<T> {
  const wrappedHandlers = {} as WrappedHandlers<T>

  for (const [handlerName, fn] of Object.entries(handlers)) {
    ;(wrappedHandlers as Record<string, Handler>)[handlerName] = {
      fn,
      source: fn.toString(),
    }
  }

  return {
    name,
    handlers: wrappedHandlers,
  }
}

/**
 * Registers a domain in the global registry.
 * Once registered, handlers can be resolved by path.
 *
 * @param domain - The domain object to register
 */
export function registerDomain<T extends HandlerMap>(domain: DomainObject<T>): void {
  domainRegistry.set(domain.name, domain as unknown as DomainObjectBase)
}

/**
 * Resolves a handler by its path.
 *
 * @param path - Array of [domainName, handlerName]
 * @returns The handler if found, undefined otherwise
 *
 * @example
 * const handler = resolveHandler(['Inventory', 'check'])
 * if (handler) {
 *   const result = await handler.fn(product, args, context)
 * }
 */
export function resolveHandler(path: string[]): Handler | undefined {
  const [domainName, handlerName] = path

  const domain = domainRegistry.get(domainName!)
  if (!domain) {
    return undefined
  }

  const handler = domain.handlers[handlerName!]
  if (!handler) {
    return undefined
  }

  return handler
}

/**
 * Gets a domain from the registry by name.
 *
 * @param name - The domain name to look up
 * @returns The domain object if found, undefined otherwise
 */
export function getDomain(name: string): DomainObjectBase | undefined {
  return domainRegistry.get(name)
}

/**
 * Clears the domain registry.
 * Used for test isolation to ensure clean state between tests.
 */
export function clearDomainRegistry(): void {
  domainRegistry.clear()
}
