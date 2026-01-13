/**
 * @dotdo/path-utils - POSIX-style path utilities for edge environments
 *
 * Zero dependencies. Works in Cloudflare Workers, Node.js, and browsers.
 *
 * @example
 * ```typescript
 * import { normalize, join, resolve, parse } from '@dotdo/path-utils'
 *
 * normalize('/foo/./bar/../baz')  // '/foo/baz'
 * join('foo', 'bar', 'baz')       // 'foo/bar/baz'
 * resolve('/foo', 'bar', 'baz')   // '/foo/bar/baz'
 * parse('/home/user/file.txt')   // { root: '/', dir: '/home/user', base: 'file.txt', ext: '.txt', name: 'file' }
 * ```
 */

/** POSIX path separator */
export const sep = '/'

/** POSIX path delimiter (for PATH environment variable) */
export const delimiter = ':'

/** Parsed path object */
export interface ParsedPath {
  root: string
  dir: string
  base: string
  ext: string
  name: string
}

/**
 * Normalize a path by:
 * - Collapsing multiple consecutive slashes to one
 * - Removing trailing slashes (except for root)
 * - Resolving . (current directory) segments
 * - Resolving .. (parent directory) segments
 */
export function normalize(path: string): string {
  if (path === '') return '.'
  if (path === '.') return '.'
  if (path === '..') return '..'

  const isAbs = path.startsWith('/')

  // Split and filter empty segments (handles multiple slashes)
  const segments = path.split('/').filter((s) => s !== '')

  const result: string[] = []

  for (const segment of segments) {
    if (segment === '.') {
      // Current directory - skip
      continue
    } else if (segment === '..') {
      // Parent directory
      if (result.length > 0 && result[result.length - 1] !== '..') {
        result.pop()
      } else if (!isAbs) {
        // For relative paths, keep the .. if we can't go up
        result.push('..')
      }
      // For absolute paths at root, just ignore the ..
    } else {
      result.push(segment)
    }
  }

  // Handle edge cases
  if (isAbs) {
    return '/' + result.join('/')
  }

  // For relative paths
  if (result.length === 0) {
    // If we started with ./ and ended with nothing, return .
    return '.'
  }

  return result.join('/')
}

/**
 * Resolve path segments to an absolute path.
 * Later absolute paths override earlier ones.
 */
export function resolve(...paths: string[]): string {
  if (paths.length === 0) return '/'

  let resolved = ''

  for (const path of paths) {
    if (path.startsWith('/')) {
      // Absolute path - start over
      resolved = path
    } else if (resolved === '') {
      resolved = path
    } else {
      resolved = resolved + '/' + path
    }
  }

  // Make sure the result is absolute
  if (!resolved.startsWith('/')) {
    resolved = '/' + resolved
  }

  return normalize(resolved)
}

/**
 * Get the filename portion of a path.
 * Optionally remove an extension if it matches.
 */
export function basename(path: string, ext?: string): string {
  if (path === '' || path === '/') return ''

  // Remove trailing slashes
  let p = path
  while (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1)
  }

  // Get the last segment
  const lastSlash = p.lastIndexOf('/')
  const name = lastSlash === -1 ? p : p.slice(lastSlash + 1)

  // Remove extension if provided and matches
  // But don't remove if ext === name (the entire filename is the extension)
  if (ext && name.endsWith(ext) && name.length > ext.length) {
    return name.slice(0, -ext.length)
  }

  return name
}

/**
 * Get the directory portion of a path.
 */
export function dirname(path: string): string {
  if (path === '' || path === '/') {
    return path === '' ? '.' : '/'
  }

  // Remove trailing slashes
  let p = path
  while (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1)
  }

  const lastSlash = p.lastIndexOf('/')

  if (lastSlash === -1) {
    // No directory part
    return '.'
  }

  if (lastSlash === 0) {
    // Root directory
    return '/'
  }

  return p.slice(0, lastSlash)
}

/**
 * Join path segments and normalize the result.
 */
export function join(...paths: string[]): string {
  if (paths.length === 0) return '.'

  // Filter out empty segments
  const filtered = paths.filter((p) => p !== '')

  if (filtered.length === 0) return '.'

  // Check if first segment is absolute
  const firstSegment = filtered[0]
  if (!firstSegment) return '.'
  const isAbs = firstSegment.startsWith('/')

  // Join all segments, stripping leading slashes from non-first segments
  let result = firstSegment
  for (let i = 1; i < filtered.length; i++) {
    let segment = filtered[i]
    if (!segment) continue
    // Strip leading slashes from subsequent segments
    while (segment.startsWith('/')) {
      segment = segment.slice(1)
    }
    if (segment) {
      result = result + '/' + segment
    }
  }

  const normalized = normalize(result)

  // If the original was absolute but normalization returned '.', return '/'
  if (isAbs && normalized === '.') {
    return '/'
  }

  return normalized
}

/**
 * Check if a path is absolute (starts with /).
 */
export function isAbsolute(path: string): boolean {
  return path.startsWith('/')
}

/**
 * Extract the extension from a path.
 * Returns the portion from the last . to the end of the basename.
 * Returns empty string if:
 * - No . exists in basename
 * - The . is the first character of the basename (dotfile)
 * - The path is empty, /, ., or ..
 */
export function extname(path: string): string {
  const base = basename(path)

  if (base === '' || base === '.' || base === '..') {
    return ''
  }

  // Find the last dot
  const lastDot = base.lastIndexOf('.')

  // No dot found
  if (lastDot === -1) {
    return ''
  }

  // Dot is first character (dotfile with no extension)
  if (lastDot === 0) {
    return ''
  }

  return base.slice(lastDot)
}

/**
 * Parse a path into its component parts.
 */
export function parse(path: string): ParsedPath {
  if (path === '') {
    return { root: '', dir: '', base: '', ext: '', name: '' }
  }

  const root = path.startsWith('/') ? '/' : ''
  let dir = dirname(path)
  const base = basename(path)
  const ext = extname(path)

  // Calculate name: base without extension
  let name: string
  if (ext === '') {
    name = base
  } else {
    name = base.slice(0, -ext.length)
  }

  // dirname returns '.' for paths without directory component
  // but parse expects '' for those cases
  // However, keep '.' for './foo' style paths
  if (dir === '.' && !path.startsWith('./') && !path.startsWith('../')) {
    dir = ''
  }

  return { root, dir, base, ext, name }
}

/**
 * Format a parsed path object back to a path string.
 * Priority: dir > root, base > name+ext
 */
export function format(pathObject: Partial<ParsedPath>): string {
  const { root = '', dir = '', base = '', ext = '', name = '' } = pathObject

  // Compute the filename portion
  // base takes priority over name+ext
  const filename = base !== '' ? base : name + ext

  // Compute the directory portion
  // dir takes priority over root
  if (dir !== '') {
    // If dir ends with /, don't add another one
    if (dir.endsWith('/')) {
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

/**
 * Compute the relative path from `from` to `to`.
 * Both paths are normalized first.
 */
export function relative(from: string, to: string): string {
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
