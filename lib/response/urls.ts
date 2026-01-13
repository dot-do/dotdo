/**
 * URL Builder Utilities
 *
 * Functions for constructing context URLs, type URLs, and ID URLs
 * in the dotdo response format.
 */

/**
 * Irregular plural forms mapping
 */
const IRREGULAR_PLURALS: Record<string, string> = {
  person: 'people',
  child: 'children',
  man: 'men',
  woman: 'women',
  foot: 'feet',
  tooth: 'teeth',
  goose: 'geese',
  mouse: 'mice',
  ox: 'oxen',
}

/**
 * Cache for pluralization results to avoid recomputing
 */
const pluralCache = new Map<string, string>()

/**
 * Cache for normalized namespace strings (trailing slash removed)
 */
const normalizedNsCache = new Map<string, string>()

/**
 * Cache for type URLs (ns + type -> URL)
 * Key format: `${ns}\0${type}` (null byte separator for uniqueness)
 */
const typeUrlCache = new Map<string, string>()

/**
 * Pluralize a word according to English pluralization rules.
 * Results are cached for performance.
 *
 * Rules:
 * 1. Irregular plurals (person -> people, child -> children)
 * 2. Words ending in s, x, ch, sh -> add 'es'
 * 3. Words ending in consonant + y -> change y to ies
 * 4. All others -> add 's'
 */
export function pluralize(word: string): string {
  const lower = word.toLowerCase()

  // Check cache first
  const cached = pluralCache.get(lower)
  if (cached !== undefined) {
    return cached
  }

  let result: string

  // Check irregular plurals first
  if (IRREGULAR_PLURALS[lower]) {
    result = IRREGULAR_PLURALS[lower]
  }
  // Words ending in s, x, ch, sh -> add 'es'
  else if (lower.endsWith('s') || lower.endsWith('x') || lower.endsWith('ch') || lower.endsWith('sh')) {
    result = lower + 'es'
  }
  // Words ending in consonant + y -> change y to ies
  else if (lower.endsWith('y')) {
    const secondToLast = lower.charAt(lower.length - 2)
    if (secondToLast !== 'a' && secondToLast !== 'e' && secondToLast !== 'i' && secondToLast !== 'o' && secondToLast !== 'u') {
      result = lower.slice(0, -1) + 'ies'
    } else {
      result = lower + 's'
    }
  }
  // Default: add 's'
  else {
    result = lower + 's'
  }

  // Cache the result
  pluralCache.set(lower, result)
  return result
}

/**
 * Remove trailing slash from a string if present.
 * Results are cached for performance.
 * Exported for use by other modules.
 */
export function normalizeNs(str: string): string {
  // Check cache first
  const cached = normalizedNsCache.get(str)
  if (cached !== undefined) {
    return cached
  }

  // Compute and cache
  const result = str.endsWith('/') ? str.slice(0, -1) : str
  normalizedNsCache.set(str, result)
  return result
}

// Keep internal alias for backward compatibility within this file
const stripTrailingSlash = normalizeNs

/**
 * URL-encode special characters in an ID that should not appear literally in a URL path
 * Characters that need encoding: @, space, /, ?, #, etc.
 */
function encodeId(id: string): string {
  // encodeURIComponent encodes everything except: A-Z a-z 0-9 - _ . ! ~ * ' ( )
  // We want to additionally preserve - _ . for typical IDs
  return encodeURIComponent(id)
}

/**
 * Schema.org.ai base URL for orphan DO type definitions
 */
const SCHEMA_BASE_URL = 'https://schema.org.ai'

/**
 * Build the schema.org.ai URL for a given type
 *
 * @param type - The type name (e.g., "DO", "Startup", "Collection")
 * @returns The schema URL (e.g., "https://schema.org.ai/DO")
 */
function buildSchemaUrl(type: string): string {
  return `${SCHEMA_BASE_URL}/${type}`
}

/**
 * Check if a parent value is effectively empty (null, undefined, empty string, or whitespace)
 */
function isEmptyParent(parent: string | undefined | null): boolean {
  return !parent || parent.trim() === ''
}

/**
 * Build a context URL from a namespace
 *
 * @param ns - The namespace URL (e.g., "https://headless.ly")
 * @param options - Optional configuration
 * @param options.parent - Parent URL to use when isRoot is true
 * @param options.isRoot - Whether this is the root level (uses parent if provided)
 * @param options.isCollection - Whether this is a collection (uses Collection schema for orphans)
 * @param options.type - The entity type (used for orphan schema URL fallback)
 * @returns The context URL
 */
export function buildContextUrl(
  ns: string,
  options?: { parent?: string; isRoot?: boolean; isCollection?: boolean; type?: string }
): string {
  // If isRoot is true, handle parent/orphan logic
  if (options?.isRoot) {
    // If parent is provided and not empty, use it
    if (!isEmptyParent(options.parent)) {
      return options.parent!
    }

    // Orphan DO: fall back to schema.org.ai
    // isCollection takes precedence over type
    if (options.isCollection) {
      return buildSchemaUrl('Collection')
    }

    // Use the type for schema URL, default to 'DO' if no type provided
    const type = options.type || 'DO'
    return buildSchemaUrl(type)
  }

  // Non-root: return the namespace as-is
  return ns
}

/**
 * Build a type URL from a namespace and type name
 * Results are cached for performance.
 *
 * @param ns - The namespace URL (e.g., "https://headless.ly")
 * @param type - The type name in PascalCase (e.g., "Customer")
 * @returns The type URL with pluralized, lowercase type path
 * @throws Error if type is empty or whitespace-only
 */
export function buildTypeUrl(ns: string, type: string): string {
  // Validate type first (before cache check, as invalid input shouldn't be cached)
  const trimmedType = type.trim()
  if (!trimmedType) {
    throw new Error('Type cannot be empty')
  }

  // Check cache using composite key
  const cacheKey = `${ns}\0${trimmedType}`
  const cached = typeUrlCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  // Normalize namespace (remove trailing slash) - also cached
  const normalizedNs = stripTrailingSlash(ns)

  // Pluralize and lowercase the type - also cached
  const pluralType = pluralize(trimmedType)

  // Build and cache result
  const result = `${normalizedNs}/${pluralType}`
  typeUrlCache.set(cacheKey, result)
  return result
}

/**
 * Build an ID URL from a namespace, type name, and ID
 *
 * @param ns - The namespace URL (e.g., "https://headless.ly")
 * @param type - The type name in PascalCase (e.g., "Customer")
 * @param id - The entity ID (e.g., "alice")
 * @returns The ID URL with encoded ID
 * @throws Error if namespace, type, or id is empty or whitespace-only
 */
export function buildIdUrl(ns: string, type: string, id: string): string {
  // Validate namespace
  const trimmedNs = ns.trim()
  if (!trimmedNs) {
    throw new Error('Namespace cannot be empty')
  }

  // Validate type (will throw if empty)
  const trimmedType = type.trim()
  if (!trimmedType) {
    throw new Error('Type cannot be empty')
  }

  // Validate id
  const trimmedId = id.trim()
  if (!trimmedId) {
    throw new Error('ID cannot be empty')
  }

  // Build type URL and append encoded ID
  const typeUrl = buildTypeUrl(ns, type)
  const encodedId = encodeId(id)

  return `${typeUrl}/${encodedId}`
}
