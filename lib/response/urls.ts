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
 * Pluralize a word according to English pluralization rules
 *
 * Rules:
 * 1. Irregular plurals (person -> people, child -> children)
 * 2. Words ending in s, x, ch, sh -> add 'es'
 * 3. Words ending in consonant + y -> change y to ies
 * 4. All others -> add 's'
 */
function pluralize(word: string): string {
  const lower = word.toLowerCase()

  // Check irregular plurals first
  if (IRREGULAR_PLURALS[lower]) {
    return IRREGULAR_PLURALS[lower]
  }

  // Words ending in s, x, ch, sh -> add 'es'
  if (lower.endsWith('s') || lower.endsWith('x') || lower.endsWith('ch') || lower.endsWith('sh')) {
    return lower + 'es'
  }

  // Words ending in consonant + y -> change y to ies
  if (lower.endsWith('y')) {
    const secondToLast = lower.charAt(lower.length - 2)
    const vowels = 'aeiou'
    if (!vowels.includes(secondToLast)) {
      return lower.slice(0, -1) + 'ies'
    }
  }

  // Default: add 's'
  return lower + 's'
}

/**
 * Remove trailing slash from a string if present
 */
function stripTrailingSlash(str: string): string {
  return str.endsWith('/') ? str.slice(0, -1) : str
}

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
 * Build a context URL from a namespace
 *
 * @param ns - The namespace URL (e.g., "https://headless.ly")
 * @param options - Optional configuration
 * @param options.parent - Parent URL to use when isRoot is true
 * @param options.isRoot - Whether this is the root level (uses parent if provided)
 * @returns The context URL
 */
export function buildContextUrl(ns: string, options?: { parent?: string; isRoot?: boolean }): string {
  // If both parent and isRoot are provided and truthy, return parent
  if (options?.parent && options?.isRoot) {
    return options.parent
  }

  // Otherwise return the namespace as-is
  return ns
}

/**
 * Build a type URL from a namespace and type name
 *
 * @param ns - The namespace URL (e.g., "https://headless.ly")
 * @param type - The type name in PascalCase (e.g., "Customer")
 * @returns The type URL with pluralized, lowercase type path
 * @throws Error if type is empty or whitespace-only
 */
export function buildTypeUrl(ns: string, type: string): string {
  // Validate type
  const trimmedType = type.trim()
  if (!trimmedType) {
    throw new Error('Type cannot be empty')
  }

  // Normalize namespace (remove trailing slash)
  const normalizedNs = stripTrailingSlash(ns)

  // Pluralize and lowercase the type
  const pluralType = pluralize(trimmedType)

  return `${normalizedNs}/${pluralType}`
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
