/**
 * $type Directive Handler
 *
 * Resolves type discriminators for polymorphic entities.
 */

/**
 * Resolve the $type discriminator from an entity
 * Returns the type name string or undefined if not present
 */
export function resolveTypeDiscriminator(entity: Record<string, unknown>): string | undefined {
  const type = entity.$type

  if (type === undefined) {
    return undefined
  }

  if (typeof type === 'string') {
    return type
  }

  // Fallback - try to convert to string
  return String(type)
}
