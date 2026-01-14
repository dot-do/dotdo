/**
 * Identity Module - Parse and build DO identifiers
 *
 * Provides utilities for working with DO IDs in various formats.
 */

import { TypeRegistry, type DOClass } from './TypeRegistry'
import type { Env } from '../objects/core/DO'

/**
 * Parsed DO ID components
 */
export interface ParsedDoId {
  namespace?: string
  type: string
  id: string
  subPath?: string
}

/**
 * Build DO ID options
 */
export interface BuildDoIdOptions {
  namespace?: string
  type: string
  id: string
}

/**
 * Resolve ID result
 */
export interface ResolveIdResult {
  DOClass: DOClass
  bindingName: string
  doIdString: string
  lookupKey: string
}

/**
 * Parse a DO ID into its components
 *
 * Formats supported:
 * - "Type/id" -> { type: "Type", id: "id" }
 * - "https://namespace/Type/id" -> { namespace: "https://namespace", type: "Type", id: "id" }
 * - "Type/id/SubType/subId" -> { type: "Type", id: "id", subPath: "SubType/subId" }
 */
export function parseDoId(doId: string, registry?: TypeRegistry): ParsedDoId {
  // Check if it's a URL format
  if (doId.startsWith('http://') || doId.startsWith('https://')) {
    const url = new URL(doId)
    const namespace = `${url.protocol}//${url.host}`
    const pathParts = url.pathname.slice(1).split('/')

    if (pathParts.length < 2) {
      throw new Error(`Invalid DO ID format: ${doId}`)
    }

    const [type, id, ...rest] = pathParts
    const subPath = rest.length > 0 ? rest.join('/') : undefined

    // Validate type if registry provided
    if (registry && !registry.has(type!)) {
      throw new Error(`Unknown type: ${type}`)
    }

    return { namespace, type: type!, id: id!, subPath }
  }

  // Simple format: Type/id or Type/id/SubType/subId
  const parts = doId.split('/')
  if (parts.length < 2) {
    throw new Error(`Invalid DO ID format: ${doId}`)
  }

  const [type, id, ...rest] = parts
  const subPath = rest.length > 0 ? rest.join('/') : undefined

  // Validate type if registry provided
  if (registry && !registry.has(type!)) {
    throw new Error(`Unknown type: ${type}`)
  }

  return { type: type!, id: id!, subPath }
}

/**
 * Build a DO ID from components
 */
export function buildDoId(options: BuildDoIdOptions): string {
  const { namespace, type, id } = options

  if (namespace) {
    return `${namespace}/${type}/${id}`
  }

  return `${type}/${id}`
}

/**
 * Resolve a DO ID to its class and binding information
 */
export async function resolveId(
  doId: string,
  registry: TypeRegistry,
  env: Env,
): Promise<ResolveIdResult> {
  const parsed = parseDoId(doId, registry)
  const DOClass = registry.get(parsed.type)

  if (!DOClass) {
    throw new Error(`Unknown type: ${parsed.type}`)
  }

  const metadata = registry.getMetadata(parsed.type)

  // Check if the binding exists in env
  if (metadata.binding !== 'DO' && !(metadata.binding in env)) {
    throw new Error(`Binding ${metadata.binding} not found in environment`)
  }

  // Build the lookup key (includes namespace for isolation)
  const lookupKey = parsed.namespace
    ? `${parsed.namespace}/${parsed.type}/${parsed.id}`
    : `${parsed.type}/${parsed.id}`

  // Generate deterministic DO ID string
  const doIdString = generateDoIdString(lookupKey)

  return {
    DOClass,
    bindingName: metadata.binding,
    doIdString,
    lookupKey,
  }
}

/**
 * Generate a deterministic DO ID string from a lookup key
 * Uses a simple hash-like transformation for consistency
 */
function generateDoIdString(lookupKey: string): string {
  // Use a simple hash for deterministic ID generation
  let hash = 0
  for (let i = 0; i < lookupKey.length; i++) {
    const char = lookupKey.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }

  // Return the lookup key as the ID (deterministic)
  return `do:${Math.abs(hash).toString(16)}:${lookupKey}`
}

// Re-export TypeRegistry for convenience
export { TypeRegistry } from './TypeRegistry'
