/**
 * Domain Registry System for ai-workflows
 *
 * Provides a factory for creating domain objects with handlers that capture
 * source code for serialization, and a global registry for handler resolution.
 */

export interface Handler {
  fn: Function
  source: string
}

export interface DomainObject {
  name: string
  handlers: Record<string, Handler>
}

// Global registry for domains
const domainRegistry = new Map<string, DomainObject>()

/**
 * Creates a domain object with named handlers.
 * Each handler is wrapped to include both the function and its source code.
 *
 * @param name - The domain name (e.g., 'Inventory', 'Payment')
 * @param handlers - Object mapping handler names to handler functions
 * @returns A DomainObject with name and wrapped handlers
 *
 * @example
 * const Inventory = Domain('Inventory', {
 *   check: async (product, _, $) => ({ available: true })
 * })
 */
export function Domain(
  name: string,
  handlers: Record<string, Function>
): DomainObject {
  const wrappedHandlers: Record<string, Handler> = {}

  for (const [handlerName, fn] of Object.entries(handlers)) {
    wrappedHandlers[handlerName] = {
      fn,
      source: fn.toString()
    }
  }

  return {
    name,
    handlers: wrappedHandlers
  }
}

/**
 * Registers a domain in the global registry.
 * Once registered, handlers can be resolved by path.
 *
 * @param domain - The domain object to register
 */
export function registerDomain(domain: DomainObject): void {
  domainRegistry.set(domain.name, domain)
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

  const domain = domainRegistry.get(domainName)
  if (!domain) {
    return undefined
  }

  const handler = domain.handlers[handlerName]
  if (!handler) {
    return undefined
  }

  return handler
}

/**
 * Clears the domain registry.
 * Used for test isolation to ensure clean state between tests.
 */
export function clearDomainRegistry(): void {
  domainRegistry.clear()
}
