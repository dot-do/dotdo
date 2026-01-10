/**
 * Transform Functions for Schema Directives
 *
 * String transformation utilities used by $id and other directives.
 */

/**
 * Split a string into words, handling various input formats
 */
function splitIntoWords(str: string): string[] {
  // Handle camelCase and PascalCase by inserting space before uppercase letters
  // that follow lowercase letters
  const spacedStr = str.replace(/([a-z])([A-Z])/g, '$1 $2')

  // Split on spaces, hyphens, underscores
  return spacedStr.split(/[\s\-_]+/).filter((word) => word.length > 0)
}

/**
 * Converts a string to PascalCase (UpperCamelCase)
 * @example PascalCase('hello world') => 'HelloWorld'
 * @example PascalCase('hello-world') => 'HelloWorld'
 * @example PascalCase('hello_world') => 'HelloWorld'
 */
export function PascalCase(str: string): string {
  const words = splitIntoWords(str)
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('')
}

/**
 * Converts a string to camelCase (lowerCamelCase)
 * @example camelCase('hello world') => 'helloWorld'
 * @example camelCase('HelloWorld') => 'helloWorld'
 */
export function camelCase(str: string): string {
  const pascal = PascalCase(str)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

/**
 * Converts a string to kebab-case
 * @example kebabCase('hello world') => 'hello-world'
 * @example kebabCase('HelloWorld') => 'hello-world'
 */
export function kebabCase(str: string): string {
  const words = splitIntoWords(str)
  return words.map((word) => word.toLowerCase()).join('-')
}

/**
 * Converts a string to snake_case
 * @example snakeCase('hello world') => 'hello_world'
 * @example snakeCase('HelloWorld') => 'hello_world'
 */
export function snakeCase(str: string): string {
  const words = splitIntoWords(str)
  return words.map((word) => word.toLowerCase()).join('_')
}

/**
 * Converts a string to UPPERCASE
 * @example UPPERCASE('hello') => 'HELLO'
 */
export function UPPERCASE(str: string): string {
  return str.toUpperCase()
}

/**
 * Converts a string to lowercase
 * @example lowercase('HELLO') => 'hello'
 */
export function lowercase(str: string): string {
  return str.toLowerCase()
}

/**
 * Converts a string to a URL-safe slug
 * Removes special characters, normalizes unicode, and converts to lowercase with hyphens
 * @example slugify('Hello, World!') => 'hello-world'
 * @example slugify('Cafe del Mar') => 'cafe-del-mar'
 */
export function slugify(str: string): string {
  return (
    str
      // Normalize unicode characters (e.g., e => e)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Convert to lowercase
      .toLowerCase()
      // Replace non-alphanumeric characters with hyphens
      .replace(/[^a-z0-9]+/g, '-')
      // Collapse multiple hyphens
      .replace(/-+/g, '-')
      // Trim leading/trailing hyphens
      .replace(/^-+|-+$/g, '')
  )
}

/**
 * Map of available transform functions by name
 */
export const transforms: Record<string, (str: string) => string> = {
  PascalCase,
  camelCase,
  kebabCase,
  snakeCase,
  UPPERCASE,
  lowercase,
  slugify,
}

/**
 * Apply a named transform function
 * @throws Error if transform function is not found
 */
export function applyTransform(transformName: string, value: string): string {
  const fn = transforms[transformName]
  if (!fn) {
    throw new Error(`Unknown transform function: ${transformName}`)
  }
  return fn(value)
}
