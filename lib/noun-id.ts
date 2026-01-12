/**
 * Noun/id Format Parser
 *
 * Parses and formats Thing references in the Noun/id format used throughout dotdo.
 *
 * Examples:
 * - 'Customer/acme' - Simple thing reference
 * - 'Startup/headless.ly' - With special characters in id
 * - 'Startup/acme/Product/widget' - Nested paths
 * - 'Startup/acme@experiment' - With branch
 * - 'Startup/acme@v1234' - With specific version
 * - 'Startup/acme@~1' - Relative version (one back)
 * - 'Startup/acme@2024-01-08' - Version at timestamp
 */

/**
 * Parsed Noun/id reference
 */
export interface NounIdRef {
  /** The noun type (e.g., 'Startup', 'Customer') - must be PascalCase */
  noun: string
  /** The identifier (e.g., 'acme', 'headless.ly') */
  id: string
  /** Nested path (e.g., Product/widget in Startup/acme/Product/widget) */
  path?: NounIdRef
  /** Branch name (e.g., 'main', 'experiment') */
  branch?: string
  /** Specific version rowid */
  version?: number
  /** Relative version offset (e.g., 1 for ~1, 5 for ~5) */
  relativeVersion?: number
  /** Version at specific timestamp */
  timestamp?: Date
}

/**
 * Check if a string is valid PascalCase
 *
 * @param str - The string to check
 * @returns True if the string is PascalCase
 */
export function isPascalCase(str: string): boolean {
  if (!str || str.length === 0) return false
  // Must start with uppercase letter
  if (!/^[A-Z]/.test(str)) return false
  // Must only contain letters and numbers (no spaces, hyphens, underscores), numbers allowed after first char
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(str)) return false
  // Must not be all uppercase (unless single letter)
  // Check if all letters are uppercase
  const letters = str.replace(/[0-9]/g, '')
  if (letters.length > 1 && letters === letters.toUpperCase()) return false
  return true
}

/**
 * Parse a modifier string (after @) into the appropriate field
 */
function parseModifier(
  modifier: string
): Pick<NounIdRef, 'branch' | 'version' | 'relativeVersion' | 'timestamp'> {
  if (!modifier) {
    throw new Error('Empty modifier after @')
  }

  // Check for version: @v followed by digits
  const versionMatch = modifier.match(/^v(\d+)$/)
  if (versionMatch) {
    return { version: parseInt(versionMatch[1]!, 10) }
  }

  // Check for relative version: @~N
  const relativeMatch = modifier.match(/^~(\d+)$/)
  if (relativeMatch) {
    return { relativeVersion: parseInt(relativeMatch[1]!, 10) }
  }

  // Check for ISO 8601 timestamp with time: YYYY-MM-DDTHH:MM:SS...
  const isoTimestampMatch = modifier.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2}))$/
  )
  if (isoTimestampMatch) {
    return { timestamp: new Date(isoTimestampMatch[1]!) }
  }

  // Check for date-only timestamp: YYYY-MM-DD
  const dateMatch = modifier.match(/^(\d{4}-\d{2}-\d{2})$/)
  if (dateMatch) {
    // Parse as local date at midnight for correct getDate()/getMonth()/getFullYear() behavior
    const [year, month, day] = dateMatch[1]!.split('-').map(Number)
    return { timestamp: new Date(year!, month! - 1, day!) }
  }

  // Otherwise it's a branch name - validate it
  // Branch cannot start with hyphen or dot
  if (modifier.startsWith('-') || modifier.startsWith('.')) {
    throw new Error(`Invalid branch name: cannot start with '${modifier[0]}'`)
  }
  // Branch cannot contain spaces or slashes
  if (/[\s/]/.test(modifier)) {
    throw new Error('Invalid branch name: cannot contain spaces or slashes')
  }

  return { branch: modifier }
}

/**
 * Validate an ID string
 */
function validateId(id: string): void {
  if (!id) {
    throw new Error('ID cannot be empty')
  }
  // ID cannot start with hyphen or dot
  if (id.startsWith('-') || id.startsWith('.')) {
    throw new Error(`Invalid ID: cannot start with '${id[0]}'`)
  }
  // ID cannot contain spaces
  if (/\s/.test(id)) {
    throw new Error('Invalid ID: cannot contain whitespace')
  }
}

/**
 * Parse a Noun/id string into a NounIdRef
 *
 * @param input - The Noun/id string to parse
 * @returns Parsed NounIdRef object
 * @throws Error if input is invalid
 *
 * @example
 * parseNounId('Customer/acme')
 * // => { noun: 'Customer', id: 'acme' }
 *
 * parseNounId('Startup/acme/Product/widget')
 * // => { noun: 'Startup', id: 'acme', path: { noun: 'Product', id: 'widget' } }
 *
 * parseNounId('Startup/acme@experiment')
 * // => { noun: 'Startup', id: 'acme', branch: 'experiment' }
 */
export function parseNounId(input: string): NounIdRef {
  if (!input) {
    throw new Error('Input cannot be empty')
  }

  // Check for whitespace at start or end
  if (input !== input.trim()) {
    throw new Error('Input cannot have leading or trailing whitespace')
  }

  // Check for double slashes
  if (input.includes('//')) {
    throw new Error('Input cannot contain double slashes')
  }

  // Check for trailing slash
  if (input.endsWith('/')) {
    throw new Error('Input cannot end with a slash')
  }

  // Check for multiple @ symbols in original input (before decoding)
  const atCount = (input.match(/@/g) || []).length
  if (atCount > 1) {
    throw new Error('Input cannot contain multiple @ symbols')
  }

  // Extract modifier BEFORE URL decoding (only literal @ in input counts as separator)
  let mainPartRaw = input
  let modifierRaw: string | undefined

  const atIndex = input.lastIndexOf('@')
  if (atIndex !== -1) {
    mainPartRaw = input.substring(0, atIndex)
    modifierRaw = input.substring(atIndex + 1)

    // Validate modifier is not empty
    if (!modifierRaw) {
      throw new Error('Modifier after @ cannot be empty')
    }

    // Check if modifier contains a slash (would be invalid branch name)
    if (modifierRaw.includes('/')) {
      throw new Error('Invalid branch name: cannot contain slashes')
    }

    // Validate modifier doesn't have whitespace
    if (/\s/.test(modifierRaw)) {
      throw new Error('Modifier cannot contain whitespace')
    }
  }

  // URL decode the main part: decode %40 to @, but preserve %2F
  const mainPartWithPreservedSlashes = mainPartRaw.replace(/%2F/gi, '\x00SLASH\x00')
  const mainPart = decodeURIComponent(mainPartWithPreservedSlashes)
    .replace(/\x00SLASH\x00/g, '%2F')

  // URL decode the modifier (if present)
  const modifier = modifierRaw ? decodeURIComponent(modifierRaw) : undefined

  // Split by / to get segments
  const segments = mainPart.split('/')

  // Must have at least 2 segments (Noun/id)
  if (segments.length < 2) {
    throw new Error('Input must have at least Noun/id format')
  }

  // Must have even number of segments (pairs of Noun/id)
  if (segments.length % 2 !== 0) {
    throw new Error('Incomplete Noun/id path - each Noun must have an id')
  }

  // Check for empty segments
  for (const segment of segments) {
    if (!segment) {
      throw new Error('Empty segment in path')
    }
    // Check for whitespace in segments
    if (/\s/.test(segment)) {
      throw new Error('Segments cannot contain whitespace')
    }
  }

  // Parse segments into nested NounIdRef
  function parseSegments(segs: string[], mod?: string): NounIdRef {
    const noun = segs[0]!
    const id = segs[1]!

    // Validate noun is PascalCase
    if (!isPascalCase(noun)) {
      throw new Error(`Invalid noun '${noun}': must be PascalCase`)
    }

    // Validate id
    validateId(id)

    const result: NounIdRef = { noun, id }

    if (segs.length > 2) {
      // More segments - recurse for nested path
      result.path = parseSegments(segs.slice(2), mod)
    } else if (mod) {
      // This is the leaf - apply modifier
      Object.assign(result, parseModifier(mod))
    }

    return result
  }

  return parseSegments(segments, modifier)
}

/**
 * Format a NounIdRef back into a Noun/id string
 *
 * @param ref - The NounIdRef to format
 * @returns Formatted Noun/id string
 *
 * @example
 * formatNounId({ noun: 'Customer', id: 'acme' })
 * // => 'Customer/acme'
 *
 * formatNounId({ noun: 'Startup', id: 'acme', branch: 'experiment' })
 * // => 'Startup/acme@experiment'
 */
export function formatNounId(ref: NounIdRef): string {
  let result = `${ref.noun}/${ref.id}`

  if (ref.path) {
    result += '/' + formatNounId(ref.path)
  } else {
    // Only add modifiers to the leaf node
    if (ref.branch !== undefined) {
      result += `@${ref.branch}`
    } else if (ref.version !== undefined) {
      result += `@v${ref.version}`
    } else if (ref.relativeVersion !== undefined) {
      result += `@~${ref.relativeVersion}`
    } else if (ref.timestamp !== undefined) {
      const d = ref.timestamp
      // Check if time component is midnight in local time
      const isLocalMidnight =
        d.getHours() === 0 &&
        d.getMinutes() === 0 &&
        d.getSeconds() === 0 &&
        d.getMilliseconds() === 0
      // Check if time component is midnight in UTC
      const isUtcMidnight =
        d.getUTCHours() === 0 &&
        d.getUTCMinutes() === 0 &&
        d.getUTCSeconds() === 0 &&
        d.getUTCMilliseconds() === 0

      if (isLocalMidnight) {
        // Format as date only using local components: YYYY-MM-DD
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        result += `@${year}-${month}-${day}`
      } else if (isUtcMidnight) {
        // Format as date only using UTC components: YYYY-MM-DD
        const year = d.getUTCFullYear()
        const month = String(d.getUTCMonth() + 1).padStart(2, '0')
        const day = String(d.getUTCDate()).padStart(2, '0')
        result += `@${year}-${month}-${day}`
      } else {
        // Format as full ISO string
        result += `@${d.toISOString()}`
      }
    }
  }

  return result
}

/**
 * Validate a Noun/id string without parsing
 *
 * @param input - The Noun/id string to validate
 * @returns True if the input is a valid Noun/id format
 */
export function isValidNounId(input: string): boolean {
  try {
    parseNounId(input)
    return true
  } catch {
    return false
  }
}
