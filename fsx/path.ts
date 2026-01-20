// Path utilities for fsx primitive
// POSIX-compatible path operations

/**
 * Path separator (always POSIX-style)
 */
export const sep = '/'

/**
 * Path delimiter (always POSIX-style)
 */
export const delimiter = ':'

/**
 * Normalize a path, resolving .. and . segments
 */
export function normalize(path: string): string {
  if (!path) return '.'

  const isAbsolute = path.charAt(0) === '/'
  const trailingSlash = path.charAt(path.length - 1) === '/'

  // Split path and filter empty segments
  const segments = path.split('/').filter(Boolean)
  const result: string[] = []

  for (const segment of segments) {
    if (segment === '..') {
      if (result.length > 0 && result[result.length - 1] !== '..') {
        result.pop()
      } else if (!isAbsolute) {
        result.push('..')
      }
    } else if (segment !== '.') {
      result.push(segment)
    }
  }

  let normalized = result.join('/')

  if (isAbsolute) {
    normalized = '/' + normalized
  }

  if (trailingSlash && normalized.charAt(normalized.length - 1) !== '/') {
    normalized += '/'
  }

  return normalized || (isAbsolute ? '/' : '.')
}

/**
 * Join multiple path segments
 */
export function join(...paths: string[]): string {
  if (paths.length === 0) return '.'

  const joined = paths
    .filter(p => p && typeof p === 'string')
    .join('/')

  return normalize(joined)
}

/**
 * Resolve a path to an absolute path
 * Uses '/' as the base for absolute resolution
 */
export function resolve(...paths: string[]): string {
  let resolvedPath = ''
  let resolvedAbsolute = false

  // Iterate from right to left
  for (let i = paths.length - 1; i >= 0 && !resolvedAbsolute; i--) {
    const path = paths[i]

    if (!path || typeof path !== 'string') {
      continue
    }

    resolvedPath = path + '/' + resolvedPath
    resolvedAbsolute = path.charAt(0) === '/'
  }

  // If still not absolute, prepend root
  if (!resolvedAbsolute) {
    resolvedPath = '/' + resolvedPath
  }

  return normalize(resolvedPath)
}

/**
 * Check if path is absolute
 */
export function isAbsolute(path: string): boolean {
  return path.charAt(0) === '/'
}

/**
 * Get the relative path from 'from' to 'to'
 */
export function relative(from: string, to: string): string {
  const fromAbs = resolve(from)
  const toAbs = resolve(to)

  if (fromAbs === toAbs) return ''

  const fromParts = fromAbs.split('/').filter(Boolean)
  const toParts = toAbs.split('/').filter(Boolean)

  // Find common base
  let commonLength = 0
  const minLength = Math.min(fromParts.length, toParts.length)

  for (let i = 0; i < minLength; i++) {
    if (fromParts[i] === toParts[i]) {
      commonLength++
    } else {
      break
    }
  }

  // Build relative path
  const upCount = fromParts.length - commonLength
  const result: string[] = []

  for (let i = 0; i < upCount; i++) {
    result.push('..')
  }

  for (let i = commonLength; i < toParts.length; i++) {
    result.push(toParts[i])
  }

  return result.join('/') || '.'
}

/**
 * Get the directory name of a path
 */
export function dirname(path: string): string {
  if (!path) return '.'

  const hasRoot = path.charAt(0) === '/'
  let end = -1
  let matchedSlash = true

  for (let i = path.length - 1; i >= 1; i--) {
    if (path.charAt(i) === '/') {
      if (!matchedSlash) {
        end = i
        break
      }
    } else {
      matchedSlash = false
    }
  }

  if (end === -1) {
    return hasRoot ? '/' : '.'
  }

  if (hasRoot && end === 1) {
    return '/'
  }

  return path.slice(0, end)
}

/**
 * Get the base name of a path
 */
export function basename(path: string, ext?: string): string {
  if (!path) return ''

  // Remove trailing slashes
  let end = path.length - 1
  while (end > 0 && path.charAt(end) === '/') {
    end--
  }

  // Find start of basename
  let start = 0
  for (let i = end; i >= 0; i--) {
    if (path.charAt(i) === '/') {
      start = i + 1
      break
    }
  }

  let base = path.slice(start, end + 1)

  // Remove extension if specified
  if (ext && base.endsWith(ext)) {
    base = base.slice(0, base.length - ext.length)
  }

  return base
}

/**
 * Get the extension of a path
 */
export function extname(path: string): string {
  const base = basename(path)
  const dotIndex = base.lastIndexOf('.')

  if (dotIndex <= 0) {
    return ''
  }

  return base.slice(dotIndex)
}

/**
 * Parse a path into its components
 */
export function parse(path: string): {
  root: string
  dir: string
  base: string
  ext: string
  name: string
} {
  const root = isAbsolute(path) ? '/' : ''
  const dir = dirname(path)
  const base = basename(path)
  const ext = extname(path)
  const name = ext ? base.slice(0, base.length - ext.length) : base

  return { root, dir, base, ext, name }
}

/**
 * Format path components into a path string
 */
export function format(pathObject: {
  root?: string
  dir?: string
  base?: string
  ext?: string
  name?: string
}): string {
  const dir = pathObject.dir || pathObject.root || ''
  const base = pathObject.base || (pathObject.name || '') + (pathObject.ext || '')

  if (!dir) {
    return base
  }

  return dir === pathObject.root ? dir + base : dir + '/' + base
}
