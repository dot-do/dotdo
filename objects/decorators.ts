/**
 * Decorators Module - TypeScript decorators for DO classes
 *
 * Provides @DOType decorator for automatic registration.
 */

import { TypeRegistry, type DOClass } from './TypeRegistry'
import { DO } from './DO'

/**
 * Options for the @DOType decorator
 */
export interface DOTypeOptions {
  registry: TypeRegistry
  name?: string
  binding?: string
}

/**
 * @DOType decorator - Registers a DO class with the TypeRegistry
 *
 * @example
 * ```typescript
 * const registry = new TypeRegistry()
 *
 * @DOType({ registry })
 * class CustomDO extends DO {
 *   static override $type = 'CustomDO'
 * }
 * ```
 */
export function DOType(options: DOTypeOptions): ClassDecorator {
  return function <TFunction extends Function>(target: TFunction): TFunction {
    const DOClass = target as unknown as typeof DO & { $type: string }

    // If custom name is provided, override the $type
    if (options.name) {
      Object.defineProperty(DOClass, '$type', {
        value: options.name,
        writable: false,
        configurable: false,
      })
    }

    // Register with the provided registry
    options.registry.register(DOClass, { binding: options.binding })

    return target
  }
}

// Re-export TypeRegistry for convenience
export { TypeRegistry } from './TypeRegistry'
