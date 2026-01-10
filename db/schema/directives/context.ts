/**
 * $context Directive Handler
 *
 * Resolves and merges context namespaces for schema types.
 */

export interface ContextObject {
  base?: string
  vocab?: string
  [prefix: string]: string | undefined
}

export interface ContextOptions {
  baseContext?: string
  schemaContext?: string
}

/**
 * Normalize a context URL by removing trailing slashes
 */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Check if a string is an absolute URL
 */
function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//.test(url)
}

/**
 * Resolve a relative context against a base
 */
function resolveRelativeContext(relative: string, base: string): string {
  const normalizedBase = normalizeUrl(base)
  return `${normalizedBase}/${relative}`
}

/**
 * Resolve the $context directive from a type definition
 */
export function resolveContext(
  type: Record<string, unknown>,
  options: ContextOptions = {}
): string | ContextObject {
  const context = type.$context

  // No context on type - use schema context
  if (context === undefined) {
    if (options.schemaContext) {
      return options.schemaContext
    }
    return ''
  }

  // String context
  if (typeof context === 'string') {
    // Absolute URL
    if (isAbsoluteUrl(context)) {
      return normalizeUrl(context)
    }

    // Relative context with base
    if (options.baseContext) {
      return resolveRelativeContext(context, options.baseContext)
    }

    return context
  }

  // Object context
  if (typeof context === 'object' && context !== null) {
    return context as ContextObject
  }

  return ''
}

/**
 * Merge a type-level context with a schema-level context
 */
export function mergeContext(
  typeContext: string | ContextObject | undefined,
  schemaContext: string | undefined
): string | ContextObject {
  // No type context - return schema context
  if (!typeContext) {
    return schemaContext || ''
  }

  // Type context is absolute or object - return as-is
  if (typeof typeContext === 'object') {
    return typeContext
  }

  if (isAbsoluteUrl(typeContext)) {
    return normalizeUrl(typeContext)
  }

  // Type context is relative - merge with schema context
  if (schemaContext) {
    return resolveRelativeContext(typeContext, schemaContext)
  }

  return typeContext
}
