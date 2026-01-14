/**
 * Path utilities for fsx.do - POSIX-style path manipulation
 *
 * This module provides POSIX-compliant path manipulation functions similar to
 * Node.js `path.posix`. All functions use forward slash (/) as the separator
 * and follow POSIX semantics for path resolution.
 *
 * @module path
 * @example
 * ```typescript
 * import { normalize, join, resolve, dirname, basename, extname } from './path'
 *
 * normalize('/foo//bar/../baz')  // '/foo/baz'
 * join('foo', 'bar', 'baz')      // 'foo/bar/baz'
 * resolve('/foo', 'bar')         // '/foo/bar'
 * dirname('/foo/bar/baz.txt')    // '/foo/bar'
 * basename('/foo/bar/baz.txt')   // 'baz.txt'
 * extname('file.txt')            // '.txt'
 * ```
 */

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * POSIX path separator character.
 *
 * @example
 * ```typescript
 * import { sep } from './path'
 * console.log(sep) // '/'
 * ```
 */
export const sep = '/' as const

/**
 * POSIX path delimiter for environment variables like PATH.
 *
 * @example
 * ```typescript
 * import { delimiter } from './path'
 * const paths = '/usr/bin:/bin:/usr/local/bin'
 * paths.split(delimiter) // ['/usr/bin', '/bin', '/usr/local/bin']
 * ```
 */
export const delimiter = ':' as const

// =============================================================================
// TYPES
// =============================================================================

/**
 * Parsed path object containing all components of a path.
 *
 * @example
 * ```typescript
 * // For path '/home/user/file.txt':
 * {
 *   root: '/',
 *   dir: '/home/user',
 *   base: 'file.txt',
 *   ext: '.txt',
 *   name: 'file'
 * }
 * ```
 */
export interface ParsedPath {
  /** The root of the path ('/' for absolute, '' for relative) */
  root: string
  /** The full directory path */
  dir: string
  /** The filename including extension */
  base: string
  /** The file extension including the leading dot */
  ext: string
  /** The filename without extension */
  name: string
}

// =============================================================================
// PATH VALIDATION
// =============================================================================

/**
 * Get a human-readable type name for error messages.
 *
 * @param value - The value to get the type of
 * @returns Human-readable type name (e.g., 'null', 'undefined', 'object', 'number')
 * @internal
 */
function getTypeName(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  return typeof value
}

/**
 * Validate that a path argument is a string.
 *
 * This function provides runtime type checking at API boundaries. While TypeScript
 * provides compile-time type safety, this validation ensures proper error messages
 * when functions are called from JavaScript or with any/unknown types.
 *
 * @param path - The path argument to validate
 * @param argName - Name of the argument for error messages (default: 'path')
 * @throws {TypeError} If path is not a string, with a clear message including the actual type
 *
 * @example
 * ```typescript
 * validatePath(null)      // throws TypeError: Path must be a string, got null
 * validatePath(undefined) // throws TypeError: Path must be a string, got undefined
 * validatePath(123)       // throws TypeError: Path must be a string, got number
 * validatePath('/foo')    // OK
 * ```
 *
 * @internal
 */
function validatePath(path: unknown, argName: string = 'path'): asserts path is string {
  if (typeof path !== 'string') {
    throw new TypeError(`${argName} must be a string, got ${getTypeName(path)}`)
  }
}

/**
 * Validate that an optional extension argument is a string if provided.
 *
 * @param ext - The extension argument to validate
 * @throws {TypeError} If ext is not a string or undefined
 * @internal
 */
function validateOptionalPath(value: unknown, argName: string = 'ext'): asserts value is string | undefined {
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError(`${argName} must be a string, got ${getTypeName(value)}`)
  }
}

// =============================================================================
// INTERNAL UTILITIES
// =============================================================================

/** ASCII code for '/' character */
const CHAR_FORWARD_SLASH = 47

/**
 * Check if a character code is a forward slash.
 * @internal
 */
function isSlash(code: number): boolean {
  return code === CHAR_FORWARD_SLASH
}

/**
 * Optimized single-pass path normalization.
 * Processes the path character by character to minimize allocations.
 *
 * @internal
 */
function normalizeStringPosix(path: string, allowAboveRoot: boolean): string {
  let res = ''
  let lastSegmentLength = 0
  let lastSlash = -1
  let dots = 0
  let code = 0

  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) {
      code = path.charCodeAt(i)
    } else if (isSlash(code)) {
      break
    } else {
      code = CHAR_FORWARD_SLASH
    }

    if (isSlash(code)) {
      if (lastSlash === i - 1 || dots === 1) {
        // NOOP - Empty segment or '.'
      } else if (dots === 2) {
        if (
          res.length < 2 ||
          lastSegmentLength !== 2 ||
          res.charCodeAt(res.length - 1) !== 46 || // '.'
          res.charCodeAt(res.length - 2) !== 46 // '.'
        ) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf(sep)
            if (lastSlashIndex === -1) {
              res = ''
              lastSegmentLength = 0
            } else {
              res = res.slice(0, lastSlashIndex)
              lastSegmentLength = res.length - 1 - res.lastIndexOf(sep)
            }
            lastSlash = i
            dots = 0
            continue
          } else if (res.length !== 0) {
            res = ''
            lastSegmentLength = 0
            lastSlash = i
            dots = 0
            continue
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? '/..' : '..'
          lastSegmentLength = 2
        }
      } else {
        if (res.length > 0) {
          res += '/' + path.slice(lastSlash + 1, i)
        } else {
          res = path.slice(lastSlash + 1, i)
        }
        lastSegmentLength = i - lastSlash - 1
      }
      lastSlash = i
      dots = 0
    } else if (code === 46 && dots !== -1) {
      // '.'
      ++dots
    } else {
      dots = -1
    }
  }
  return res
}

// =============================================================================
// CORE PATH OPERATIONS
// =============================================================================

/**
 * Normalize a path by resolving `.` and `..` segments and collapsing slashes.
 *
 * This function:
 * - Collapses multiple consecutive slashes to one
 * - Removes trailing slashes (except for root `/`)
 * - Resolves `.` (current directory) segments
 * - Resolves `..` (parent directory) segments
 * - Preserves the absolute/relative nature of the path
 *
 * @param path - The path to normalize
 * @returns The normalized path, or '.' if path is empty
 *
 * @example Basic normalization
 * ```typescript
 * normalize('/foo/bar//baz')     // '/foo/bar/baz'
 * normalize('/foo/./bar')        // '/foo/bar'
 * normalize('/foo/bar/../baz')   // '/foo/baz'
 * ```
 *
 * @example Edge cases
 * ```typescript
 * normalize('')                  // '.'
 * normalize('.')                 // '.'
 * normalize('..')                // '..'
 * normalize('/')                 // '/'
 * normalize('///')               // '/'
 * ```
 *
 * @example Relative paths with ..
 * ```typescript
 * normalize('../foo/bar')        // '../foo/bar'
 * normalize('foo/../../bar')     // '../bar'
 * normalize('/foo/../..')        // '/'  (cannot go above root)
 * ```
 */
export function normalize(path: string): string {
  validatePath(path)

  // Fast path for common cases
  if (path === '') return '.'
  if (path === '.') return '.'
  if (path === '..') return '..'
  if (path === '/') return '/'

  const isAbsolute = isSlash(path.charCodeAt(0))
  const trailingSlash = isSlash(path.charCodeAt(path.length - 1))

  // Normalize the path
  let normalized = normalizeStringPosix(path, !isAbsolute)

  if (normalized.length === 0) {
    if (isAbsolute) return '/'
    return '.'
  }

  // Add leading slash for absolute paths
  if (isAbsolute) {
    normalized = '/' + normalized
  }

  return normalized
}

/**
 * Join path segments and normalize the result.
 *
 * Joins all path segments using the POSIX separator (`/`) and then
 * normalizes the resulting path. Empty segments are ignored.
 *
 * @param paths - Path segments to join
 * @returns The joined and normalized path, or '.' if no segments
 *
 * @example Basic joining
 * ```typescript
 * join('foo', 'bar', 'baz')      // 'foo/bar/baz'
 * join('/foo', 'bar', 'baz')     // '/foo/bar/baz'
 * join('foo', '', 'bar')         // 'foo/bar'
 * ```
 *
 * @example Joining with dots
 * ```typescript
 * join('foo', '.', 'bar')        // 'foo/bar'
 * join('foo', '..', 'bar')       // 'bar'
 * join('foo', 'bar', '..', 'baz') // 'foo/baz'
 * ```
 *
 * @example Leading slashes in non-first segments
 * ```typescript
 * join('/foo', '/bar')           // '/foo/bar'  (strips leading / from bar)
 * join('foo', '/bar')            // 'foo/bar'
 * ```
 *
 * @example Edge cases
 * ```typescript
 * join()                         // '.'
 * join('')                       // '.'
 * join('', '')                   // '.'
 * ```
 */
export function join(...paths: string[]): string {
  if (paths.length === 0) return '.'

  // Validate all path arguments
  for (let i = 0; i < paths.length; i++) {
    validatePath(paths[i], `paths[${i}]`)
  }

  let joined: string | undefined

  for (const path of paths) {
    if (path.length > 0) {
      if (joined === undefined) {
        joined = path
      } else {
        joined += '/' + path
      }
    }
  }

  if (joined === undefined) return '.'

  return normalize(joined)
}

/**
 * Resolve path segments to an absolute path.
 *
 * Processes segments from left to right. Each absolute path encountered
 * resets the resolved path. The result is always an absolute path.
 *
 * @param paths - Path segments to resolve
 * @returns The resolved absolute path, or '/' if no segments
 *
 * @example Basic resolution
 * ```typescript
 * resolve('/foo', 'bar')         // '/foo/bar'
 * resolve('/foo', 'bar', 'baz')  // '/foo/bar/baz'
 * resolve('foo', 'bar')          // '/foo/bar'  (relative treated as from /)
 * ```
 *
 * @example Absolute path override
 * ```typescript
 * resolve('/foo', '/bar')        // '/bar'  (later absolute overrides)
 * resolve('/foo', '/bar', 'baz') // '/bar/baz'
 * ```
 *
 * @example Dot resolution
 * ```typescript
 * resolve('/foo', '.', 'bar')    // '/foo/bar'
 * resolve('/foo/bar', '..')      // '/foo'
 * resolve('/foo', '..', '..', 'bar') // '/bar'  (stops at root)
 * ```
 *
 * @example Edge cases
 * ```typescript
 * resolve()                      // '/'
 * resolve('/')                   // '/'
 * resolve('/', '..')             // '/'  (cannot go above root)
 * ```
 */
export function resolve(...paths: string[]): string {
  if (paths.length === 0) return '/'

  // Validate all path arguments
  for (let i = 0; i < paths.length; i++) {
    validatePath(paths[i], `paths[${i}]`)
  }

  let resolved = ''

  for (const path of paths) {
    if (path.length === 0) continue

    if (isSlash(path.charCodeAt(0))) {
      // Absolute path - start over
      resolved = path
    } else if (resolved.length === 0) {
      resolved = path
    } else {
      resolved = resolved + '/' + path
    }
  }

  // Make sure the result is absolute
  if (!resolved.length || !isSlash(resolved.charCodeAt(0))) {
    resolved = '/' + resolved
  }

  return normalize(resolved)
}

// =============================================================================
// PATH COMPONENT EXTRACTION
// =============================================================================

/**
 * Get the directory portion of a path.
 *
 * Returns the path up to (but not including) the final component.
 * Trailing slashes are ignored when determining the final component.
 *
 * @param path - The path to extract the directory from
 * @returns The directory portion, '.' if no directory, or '/' for root children
 *
 * @example Basic directory extraction
 * ```typescript
 * dirname('/foo/bar/baz.txt')    // '/foo/bar'
 * dirname('/foo/bar/baz')        // '/foo/bar'
 * dirname('/foo')                // '/'
 * ```
 *
 * @example Relative paths
 * ```typescript
 * dirname('foo/bar')             // 'foo'
 * dirname('file.txt')            // '.'
 * dirname('foo')                 // '.'
 * ```
 *
 * @example Edge cases
 * ```typescript
 * dirname('')                    // '.'
 * dirname('/')                   // '/'
 * dirname('/foo/bar/')           // '/foo'  (trailing slash ignored)
 * dirname('.')                   // '.'
 * dirname('..')                  // '.'
 * ```
 */
export function dirname(path: string): string {
  validatePath(path)

  if (path.length === 0) return '.'

  const isAbsolute = isSlash(path.charCodeAt(0))

  // Remove trailing slashes
  let end = path.length
  while (end > 1 && isSlash(path.charCodeAt(end - 1))) {
    end--
  }

  // Find the last slash
  let lastSlash = -1
  for (let i = end - 1; i >= 0; i--) {
    if (isSlash(path.charCodeAt(i))) {
      lastSlash = i
      break
    }
  }

  if (lastSlash === -1) {
    // No directory component
    return '.'
  }

  if (lastSlash === 0) {
    // Root directory
    return '/'
  }

  // Skip consecutive trailing slashes in the directory portion
  let dirEnd = lastSlash
  while (dirEnd > 1 && isSlash(path.charCodeAt(dirEnd - 1))) {
    dirEnd--
  }

  return path.slice(0, dirEnd === 0 && isAbsolute ? 1 : dirEnd)
}

/**
 * Get the filename portion of a path.
 *
 * Returns the last component of the path. Optionally removes a
 * matching extension from the result.
 *
 * @param path - The path to extract the filename from
 * @param ext - Optional extension to remove from the result
 * @returns The filename, or '' for root/empty paths
 *
 * @example Basic filename extraction
 * ```typescript
 * basename('/foo/bar/baz.txt')   // 'baz.txt'
 * basename('/foo/bar/baz')       // 'baz'
 * basename('file.txt')           // 'file.txt'
 * ```
 *
 * @example Extension removal
 * ```typescript
 * basename('/foo/bar.txt', '.txt')  // 'bar'
 * basename('/foo/bar.txt', '.md')   // 'bar.txt'  (no match)
 * basename('file.test.ts', '.ts')   // 'file.test'
 * ```
 *
 * @example Edge cases
 * ```typescript
 * basename('')                   // ''
 * basename('/')                  // ''
 * basename('/foo/bar/')          // 'bar'  (trailing slash ignored)
 * basename('.txt', '.txt')       // '.txt'  (ext === name, not removed)
 * ```
 */
export function basename(path: string, ext?: string): string {
  validatePath(path)
  validateOptionalPath(ext, 'ext')

  if (path.length === 0) return ''

  // Remove trailing slashes
  let end = path.length
  while (end > 0 && isSlash(path.charCodeAt(end - 1))) {
    end--
  }

  if (end === 0) return ''

  // Find the start of the basename
  let start = 0
  for (let i = end - 1; i >= 0; i--) {
    if (isSlash(path.charCodeAt(i))) {
      start = i + 1
      break
    }
  }

  const name = path.slice(start, end)

  // Remove extension if provided and matches
  // But don't remove if ext === name (the entire filename is the extension)
  if (ext !== undefined && ext.length > 0 && name.endsWith(ext) && name.length > ext.length) {
    return name.slice(0, -ext.length)
  }

  return name
}

/**
 * Extract the extension from a path.
 *
 * Returns the portion from the last `.` to the end of the basename,
 * including the leading dot. Returns empty string for dotfiles
 * without a second dot.
 *
 * @param path - The path to extract the extension from
 * @returns The extension including leading dot, or '' if none
 *
 * @example Basic extension extraction
 * ```typescript
 * extname('file.txt')            // '.txt'
 * extname('/foo/bar.json')       // '.json'
 * extname('archive.tar.gz')      // '.gz'  (last extension only)
 * ```
 *
 * @example Dotfiles
 * ```typescript
 * extname('.gitignore')          // ''  (dotfile without extension)
 * extname('.gitignore.bak')      // '.bak'  (dotfile with extension)
 * ```
 *
 * @example No extension
 * ```typescript
 * extname('file')                // ''
 * extname('/foo/bar')            // ''
 * extname('')                    // ''
 * extname('/')                   // ''
 * ```
 *
 * @example Special cases
 * ```typescript
 * extname('file.')               // '.'  (trailing dot)
 * extname('file..txt')           // '.txt'
 * ```
 */
export function extname(path: string): string {
  validatePath(path)

  const base = basename(path)

  if (base === '' || base === '.' || base === '..') {
    return ''
  }

  // Find the last dot
  let dotIndex = -1
  for (let i = base.length - 1; i >= 0; i--) {
    if (base.charCodeAt(i) === 46) {
      // '.'
      dotIndex = i
      break
    }
  }

  // No dot found or dot is first character (dotfile with no extension)
  if (dotIndex === -1 || dotIndex === 0) {
    return ''
  }

  return base.slice(dotIndex)
}

// =============================================================================
// PATH PARSING AND FORMATTING
// =============================================================================

/**
 * Parse a path into its component parts.
 *
 * Splits a path into root, dir, base, ext, and name components.
 * Use with `format()` for path manipulation.
 *
 * @param path - The path to parse
 * @returns Object containing path components
 *
 * @example Absolute path
 * ```typescript
 * parse('/home/user/file.txt')
 * // {
 * //   root: '/',
 * //   dir: '/home/user',
 * //   base: 'file.txt',
 * //   ext: '.txt',
 * //   name: 'file'
 * // }
 * ```
 *
 * @example Relative path
 * ```typescript
 * parse('foo/bar/baz.js')
 * // {
 * //   root: '',
 * //   dir: 'foo/bar',
 * //   base: 'baz.js',
 * //   ext: '.js',
 * //   name: 'baz'
 * // }
 * ```
 *
 * @example Filename only
 * ```typescript
 * parse('file.txt')
 * // {
 * //   root: '',
 * //   dir: '',
 * //   base: 'file.txt',
 * //   ext: '.txt',
 * //   name: 'file'
 * // }
 * ```
 */
export function parse(path: string): ParsedPath {
  validatePath(path)

  if (path === '') {
    return { root: '', dir: '', base: '', ext: '', name: '' }
  }

  const isAbs = isSlash(path.charCodeAt(0))
  const root = isAbs ? '/' : ''
  let dir = dirname(path)
  const base = basename(path)
  const ext = extname(path)

  // Calculate name: base without extension
  const name = ext === '' ? base : base.slice(0, -ext.length)

  // dirname returns '.' for paths without directory component
  // but parse expects '' for those cases (unless path starts with ./ or ../)
  if (dir === '.' && !path.startsWith('./') && !path.startsWith('../')) {
    dir = ''
  }

  return { root, dir, base, ext, name }
}

/**
 * Format a parsed path object back to a path string.
 *
 * Constructs a path from components. Priority rules:
 * - `dir` overrides `root` for the directory portion
 * - `base` overrides `name + ext` for the filename portion
 *
 * @param pathObject - Object containing path components
 * @returns The formatted path string
 *
 * @example Full path object
 * ```typescript
 * format({
 *   root: '/',
 *   dir: '/home/user',
 *   base: 'file.txt',
 *   ext: '.txt',
 *   name: 'file'
 * }) // '/home/user/file.txt'
 * ```
 *
 * @example Partial objects
 * ```typescript
 * format({ dir: '/home/user', base: 'file.txt' })  // '/home/user/file.txt'
 * format({ root: '/', base: 'file.txt' })          // '/file.txt'
 * format({ dir: '/home', name: 'file', ext: '.txt' }) // '/home/file.txt'
 * ```
 *
 * @example Priority rules
 * ```typescript
 * // base overrides name+ext
 * format({ base: 'actual.js', name: 'ignored', ext: '.ts' }) // 'actual.js'
 *
 * // dir overrides root
 * format({ root: '/', dir: '/home', base: 'file' }) // '/home/file'
 * ```
 */
export function format(pathObject: Partial<ParsedPath>): string {
  const { root = '', dir = '', base = '', ext = '', name = '' } = pathObject

  // Compute the filename portion (base takes priority over name+ext)
  const filename = base !== '' ? base : name + ext

  // Compute the directory portion (dir takes priority over root)
  if (dir !== '') {
    // If dir ends with /, don't add another one
    if (isSlash(dir.charCodeAt(dir.length - 1))) {
      return dir + filename
    }
    return filename !== '' ? dir + '/' + filename : dir
  }

  // No dir, use root
  if (root !== '') {
    return root + filename
  }

  // No dir, no root
  return filename
}

// =============================================================================
// PATH PREDICATES AND UTILITIES
// =============================================================================

/**
 * Check if a path is absolute (starts with /).
 *
 * @param path - The path to check
 * @returns True if the path is absolute
 *
 * @example
 * ```typescript
 * isAbsolute('/foo/bar')         // true
 * isAbsolute('/')                // true
 * isAbsolute('//foo')            // true  (multiple slashes)
 * isAbsolute('foo/bar')          // false
 * isAbsolute('./foo')            // false
 * isAbsolute('')                 // false
 * ```
 */
export function isAbsolute(path: string): boolean {
  validatePath(path)
  return path.length > 0 && isSlash(path.charCodeAt(0))
}

/**
 * Compute the relative path from `from` to `to`.
 *
 * Both paths are normalized and resolved to absolute paths before
 * computing the relative path.
 *
 * @param from - The starting path
 * @param to - The destination path
 * @returns The relative path from `from` to `to`, or '' if same
 *
 * @example Basic relative paths
 * ```typescript
 * relative('/foo/bar', '/foo/baz')       // '../baz'
 * relative('/foo', '/foo/bar')           // 'bar'
 * relative('/foo/bar', '/foo')           // '..'
 * relative('/foo/bar', '/foo/bar')       // ''  (same path)
 * ```
 *
 * @example Distant paths
 * ```typescript
 * relative('/a/b/c', '/x/y/z')           // '../../../x/y/z'
 * relative('/', '/foo/bar')              // 'foo/bar'
 * relative('/foo/bar', '/')              // '../..'
 * ```
 *
 * @example Normalized input
 * ```typescript
 * relative('/foo/bar', '/foo/./bar')     // ''  (normalized to same)
 * relative('/foo//bar', '/foo/bar/baz')  // 'baz'
 * ```
 */
export function relative(from: string, to: string): string {
  validatePath(from, 'from')
  validatePath(to, 'to')

  // Normalize both paths and make them absolute for comparison
  const fromNorm = resolve(from)
  const toNorm = resolve(to)

  // If same path, return empty string
  if (fromNorm === toNorm) {
    return ''
  }

  // Split into segments (filter empty to handle root)
  const fromParts = fromNorm.split('/').filter((p) => p !== '')
  const toParts = toNorm.split('/').filter((p) => p !== '')

  // Find common prefix length
  let commonLength = 0
  const minLength = Math.min(fromParts.length, toParts.length)
  for (let i = 0; i < minLength; i++) {
    if (fromParts[i] !== toParts[i]) {
      break
    }
    commonLength++
  }

  // Calculate how many directories to go up from `from`
  const upCount = fromParts.length - commonLength

  // Build the relative path
  const relativeParts: string[] = []

  // Add '..' for each directory we need to go up
  for (let i = 0; i < upCount; i++) {
    relativeParts.push('..')
  }

  // Add the remaining parts of `to`
  for (let i = commonLength; i < toParts.length; i++) {
    const part = toParts[i]
    if (part) {
      relativeParts.push(part)
    }
  }

  return relativeParts.join('/')
}

// =============================================================================
// PATH VALIDATION UTILITIES
// =============================================================================

/**
 * Check if a path contains potentially dangerous traversal sequences.
 *
 * Detects `..` segments that could escape a base directory.
 * Use this for security validation before path operations.
 *
 * @param path - The path to check
 * @returns True if the path contains traversal sequences
 *
 * @example
 * ```typescript
 * hasTraversal('../foo')         // true
 * hasTraversal('foo/../bar')     // true (could escape depending on resolution)
 * hasTraversal('/foo/bar')       // false
 * hasTraversal('./foo')          // false
 * hasTraversal('foo..bar')       // false (not a segment)
 * ```
 */
export function hasTraversal(path: string): boolean {
  validatePath(path)

  const normalized = normalize(path)
  // Check if normalized path starts with .. or contains /..
  return normalized.startsWith('..') || normalized.includes('/..')
}

/**
 * Ensure a path stays within a base directory after normalization.
 *
 * Joins the base and path, normalizes the result, and verifies
 * it starts with the normalized base path.
 *
 * @param base - The base directory that must contain the result
 * @param path - The path to validate
 * @returns True if the resolved path is within base
 *
 * @example
 * ```typescript
 * isWithin('/app', 'data/file.txt')     // true -> /app/data/file.txt
 * isWithin('/app', '../etc/passwd')     // false -> escapes /app
 * isWithin('/app', '/etc/passwd')       // false -> absolute path escapes
 * isWithin('/app', './safe/../file')    // true -> /app/file
 * ```
 */
export function isWithin(base: string, path: string): boolean {
  validatePath(base, 'base')
  validatePath(path, 'path')

  const normalizedBase = normalize(base)
  const resolved = resolve(normalizedBase, path)

  // Must start with base path
  if (!resolved.startsWith(normalizedBase)) {
    return false
  }

  // If resolved is longer, the next character must be a slash
  // (prevents /app matching /application)
  if (resolved.length > normalizedBase.length) {
    return isSlash(resolved.charCodeAt(normalizedBase.length))
  }

  return true
}
