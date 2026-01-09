/**
 * Lifecycle Module Types
 *
 * Internal types and interfaces used by lifecycle modules for
 * communicating with the DO base class.
 */

import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import type * as schema from '../../db'
import type { CloudflareEnv } from '../../types/CloudflareBindings'

/**
 * Context provided to lifecycle modules by the DO base class.
 * This allows lifecycle modules to access DO state without tight coupling.
 */
export interface LifecycleContext {
  /** Namespace URL - the DO's identity */
  ns: string
  /** Current branch */
  currentBranch: string
  /** Drizzle database instance */
  db: DrizzleSqliteDODatabase<typeof schema>
  /** Cloudflare environment bindings */
  env: CloudflareEnv
  /** Durable Object context (state) */
  ctx: DurableObjectState
  /** Emit an event */
  emitEvent: (verb: string, data?: unknown) => Promise<void>
  /** Log a message */
  log: (message: string, data?: unknown) => void
}

/**
 * Base interface for lifecycle strategy modules.
 * Each lifecycle module implements operations related to a specific concern.
 */
export interface LifecycleModule {
  /** Initialize the module with context */
  initialize(context: LifecycleContext): void
}

/**
 * Lazy-loadable lifecycle module.
 * Used for deferred loading to minimize cold start impact.
 */
export type LazyModule<T extends LifecycleModule> = {
  _instance?: T
  _context?: LifecycleContext
  get(): T
  setContext(context: LifecycleContext): void
}

/**
 * Create a lazy-loadable module wrapper.
 * The module is only instantiated when first accessed.
 */
export function createLazyModule<T extends LifecycleModule>(
  factory: () => T
): LazyModule<T> {
  const wrapper: LazyModule<T> = {
    _instance: undefined,
    _context: undefined,
    get() {
      if (!wrapper._instance) {
        wrapper._instance = factory()
        if (wrapper._context) {
          wrapper._instance.initialize(wrapper._context)
        }
      }
      return wrapper._instance
    },
    setContext(context: LifecycleContext) {
      wrapper._context = context
      if (wrapper._instance) {
        wrapper._instance.initialize(context)
      }
    },
  }
  return wrapper
}
