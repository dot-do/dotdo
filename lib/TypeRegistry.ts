/**
 * TypeRegistry - Registry for DO type classes
 *
 * Provides registration, lookup, and inheritance queries for DO types.
 */

import { DO } from './DO'

/**
 * Reserved type names that cannot be registered
 */
const RESERVED_TYPES = new Set([
  'Object',
  'Function',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Symbol',
  'Error',
  'Promise',
  'Date',
  'RegExp',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Proxy',
  'Reflect',
])

/**
 * Metadata stored for each registered type
 */
export interface TypeMetadata {
  binding: string
  extends?: string
}

/**
 * DO class type with static $type property
 */
export type DOClass = typeof DO & { $type: string }

/**
 * TypeRegistry - Registry for DO type classes
 */
export class TypeRegistry {
  private types: Map<string, DOClass> = new Map()
  private metadata: Map<string, TypeMetadata> = new Map()

  /**
   * Register a DO class by its $type
   */
  register(DOClass: DOClass, options?: { binding?: string }): void {
    const $type = DOClass.$type

    // Validate $type exists
    if (!$type) {
      throw new Error('Class must have a static $type property')
    }

    // Validate PascalCase
    if (!/^[A-Z][a-zA-Z0-9]*$/.test($type)) {
      if (/^[a-z]/.test($type)) {
        throw new Error(`Type name must be PascalCase: ${$type}`)
      }
      throw new Error(`Type name contains invalid characters: ${$type}`)
    }

    // Check reserved names
    if (RESERVED_TYPES.has($type)) {
      throw new Error(`Type name is reserved: ${$type}`)
    }

    // Check for duplicate registration
    const existing = this.types.get($type)
    if (existing) {
      throw new Error(`Type "${$type}" is already registered by ${existing.name}`)
    }

    // Store the class
    this.types.set($type, DOClass)

    // Store metadata
    const parentClass = Object.getPrototypeOf(DOClass)
    const extendsType = parentClass?.$type || undefined

    this.metadata.set($type, {
      binding: options?.binding || 'DO',
      extends: extendsType,
    })
  }

  /**
   * Get a registered class by $type
   */
  get($type: string): DOClass | undefined {
    return this.types.get($type)
  }

  /**
   * Get metadata for a registered type
   */
  getMetadata($type: string): TypeMetadata {
    return this.metadata.get($type) || { binding: 'DO' }
  }

  /**
   * List all registered type names
   */
  listTypes(): string[] {
    return Array.from(this.types.keys())
  }

  /**
   * Find all types that extend a base type
   */
  findSubtypes(baseType: string): string[] {
    const subtypes: string[] = []

    for (const [$type, DOClass] of this.types) {
      if ($type === baseType) continue

      // Walk up the prototype chain
      let current = Object.getPrototypeOf(DOClass)
      while (current && current.$type) {
        if (current.$type === baseType) {
          subtypes.push($type)
          break
        }
        current = Object.getPrototypeOf(current)
      }
    }

    return subtypes
  }

  /**
   * Check if a type is registered
   */
  has($type: string): boolean {
    return this.types.has($type)
  }

  /**
   * Clear all registered types
   */
  clear(): void {
    this.types.clear()
    this.metadata.clear()
  }
}

export default TypeRegistry
