/**
 * Discovery Module - Discover and auto-register DO types
 *
 * Provides utilities to discover DO classes from modules.
 */

import { DO } from './DO'
import { TypeRegistry, type DOClass } from './TypeRegistry'

/**
 * Type metadata returned by discoverTypes with includeMetadata option
 */
export interface TypeDiscoveryMetadata {
  extends: string
  class: DOClass
}

/**
 * Options for discoverTypes
 */
export interface DiscoverTypesOptions {
  includeMetadata?: boolean
}

/**
 * Result type for discoverTypes
 */
export type DiscoverTypesResult<T extends DiscoverTypesOptions> = T extends { includeMetadata: true }
  ? Record<string, TypeDiscoveryMetadata>
  : string[]

/**
 * Discover all DO subclasses in a module
 *
 * @param module - The module to scan for DO classes
 * @param options - Discovery options
 * @returns Array of type names or record with metadata
 */
export function discoverTypes<T extends DiscoverTypesOptions>(
  module: Record<string, unknown>,
  options?: T,
): DiscoverTypesResult<T> {
  const includeMetadata = options?.includeMetadata ?? false

  if (includeMetadata) {
    const result: Record<string, TypeDiscoveryMetadata> = {}

    for (const [name, value] of Object.entries(module)) {
      if (isDOClass(value)) {
        const DOClass = value as typeof DO & { $type: string }
        const parentClass = Object.getPrototypeOf(DOClass)
        const extendsType = parentClass?.$type || 'DO'

        result[DOClass.$type] = {
          extends: extendsType,
          class: DOClass,
        }
      }
    }

    return result as DiscoverTypesResult<T>
  }

  const types: string[] = []

  for (const [name, value] of Object.entries(module)) {
    if (isDOClass(value)) {
      const DOClass = value as typeof DO & { $type: string }
      types.push(DOClass.$type)
    }
  }

  return types as DiscoverTypesResult<T>
}

/**
 * Check if a value is a DO class
 */
function isDOClass(value: unknown): boolean {
  if (typeof value !== 'function') return false

  // Check if it has a static $type property
  const maybeClass = value as Record<string, unknown>
  if (!maybeClass.$type || typeof maybeClass.$type !== 'string') return false

  // Check if it extends DO (walk prototype chain)
  let current = value
  while (current) {
    if (current === DO) return true
    current = Object.getPrototypeOf(current)
  }

  return false
}

/**
 * Auto-register all discovered DO types from a module
 *
 * @param module - The module to scan for DO classes
 * @param registry - The TypeRegistry to register types in
 */
export function autoRegister(
  module: Record<string, unknown>,
  registry: TypeRegistry,
): void {
  const discovered = discoverTypes(module, { includeMetadata: true })

  for (const [$type, metadata] of Object.entries(discovered)) {
    // Skip if already registered
    if (registry.has($type)) continue

    try {
      registry.register(metadata.class)
    } catch {
      // Ignore registration errors (e.g., reserved names)
    }
  }
}

// Re-export TypeRegistry for convenience
export { TypeRegistry } from './TypeRegistry'
