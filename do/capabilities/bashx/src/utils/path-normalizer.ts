/**
 * Path Normalizer
 *
 * Cross-platform path normalization utilities for Unix and Windows.
 * Handles drive letters, UNC paths, home directory expansion,
 * environment variables, and security validation.
 *
 * @example
 * ```typescript
 * import { toUnixPath, expandPath, validatePathSecurity } from './path-normalizer'
 *
 * // Convert Windows path to Unix
 * toUnixPath('C:\\Users\\test') // '/c/Users/test'
 *
 * // Expand environment variables
 * expandPath('$HOME/Documents', { HOME: '/home/user' }) // '/home/user/Documents'
 *
 * // Validate path security
 * validatePathSecurity('/safe/path') // OK
 * validatePathSecurity('../../../etc/passwd') // throws PathSecurityError
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Types and Constants
// =============================================================================

/**
 * Platform type for path detection.
 */
export enum PathPlatform {
  Unix = 'unix',
  Windows = 'windows',
}

/**
 * Error thrown when path security validation fails.
 */
export class PathSecurityError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly reason: SecurityViolationType
  ) {
    super(message)
    this.name = 'PathSecurityError'
  }
}

/**
 * Types of security violations detected.
 */
export type SecurityViolationType =
  | 'path_traversal'
  | 'null_byte'
  | 'device_name'
  | 'outside_root'

/**
 * Options for path security validation.
 */
export interface PathSecurityOptions {
  /**
   * Allowed root directory. Paths outside this root will be rejected.
   */
  allowedRoot?: string
}

/**
 * Windows reserved device names (case-insensitive).
 * These cannot be used as file/directory names on Windows.
 */
const WINDOWS_DEVICE_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

/**
 * Regex to match Windows drive letters (e.g., C:, D:).
 */
const DRIVE_LETTER_REGEX = /^([a-zA-Z]):/

/**
 * Regex to match Unix-style drive path (e.g., /c, /d).
 */
const UNIX_DRIVE_REGEX = /^\/([a-zA-Z])(?:\/|$)/

/**
 * Regex to match Unix-style UNC paths (e.g., //server/share).
 */
const UNIX_UNC_REGEX = /^\/\/[^/]+\/[^/]+/

/**
 * Regex to match Windows extended path prefix (\\?\).
 */
const EXTENDED_PATH_REGEX = /^\\\\\?\\([a-zA-Z]):\\/

/**
 * Regex to match Unix environment variable ($VAR or ${VAR}).
 */
const UNIX_ENV_VAR_REGEX = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}|\$([a-zA-Z_][a-zA-Z0-9_]*)/g

/**
 * Regex to match Windows environment variable (%VAR%).
 */
const WINDOWS_ENV_VAR_REGEX = /%([a-zA-Z_][a-zA-Z0-9_]*)%/g

/**
 * LRU cache for path normalization results.
 */
const pathCache = new Map<string, string>()
const MAX_CACHE_SIZE = 1000

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Converts a path to Unix format.
 *
 * - Backslashes become forward slashes
 * - Drive letters (C:) become /c
 * - UNC paths (\\server\share) become //server/share
 *
 * @param path - The path to convert
 * @returns The Unix-style path
 *
 * @example
 * ```typescript
 * toUnixPath('C:\\Users\\test')  // '/c/Users/test'
 * toUnixPath('\\\\server\\share') // '//server/share'
 * toUnixPath('foo\\bar')          // 'foo/bar'
 * ```
 */
export function toUnixPath(path: string): string {
  if (!path) return path

  // Check cache
  const cacheKey = `unix:${path}`
  const cached = pathCache.get(cacheKey)
  if (cached !== undefined) return cached

  let result = path

  // Handle Windows extended path prefix (\\?\C:\)
  const extendedMatch = result.match(EXTENDED_PATH_REGEX)
  if (extendedMatch) {
    const driveLetter = extendedMatch[1].toLowerCase()
    result = `/${driveLetter}${result.slice(extendedMatch[0].length - 1)}`
  }

  // Handle UNC paths (must check before converting backslashes)
  if (result.startsWith('\\\\') && !extendedMatch) {
    // Convert \\server\share to //server/share
    result = result.replace(/\\/g, '/')
    cacheResult(cacheKey, result)
    return result
  }

  // Handle drive letters before converting backslashes
  const driveMatch = result.match(DRIVE_LETTER_REGEX)
  if (driveMatch) {
    const driveLetter = driveMatch[1].toLowerCase()
    result = `/${driveLetter}${result.slice(2)}`
  }

  // Convert backslashes to forward slashes
  result = result.replace(/\\/g, '/')

  // Collapse multiple slashes (but preserve // at start for UNC)
  if (result.startsWith('//')) {
    const rest = result.slice(2).replace(/\/+/g, '/')
    result = `//${rest}`
  } else {
    result = result.replace(/\/+/g, '/')
  }

  cacheResult(cacheKey, result)
  return result
}

/**
 * Converts a path to Windows format.
 *
 * - Forward slashes become backslashes
 * - Unix drive paths (/c) become C:
 * - Unix UNC paths (//server/share) become \\server\share
 *
 * @param path - The path to convert
 * @returns The Windows-style path
 *
 * @example
 * ```typescript
 * toWindowsPath('/c/Users/test')  // 'C:\\Users\\test'
 * toWindowsPath('//server/share') // '\\\\server\\share'
 * toWindowsPath('foo/bar')        // 'foo\\bar'
 * ```
 */
export function toWindowsPath(path: string): string {
  if (!path) return path

  // Check cache
  const cacheKey = `win:${path}`
  const cached = pathCache.get(cacheKey)
  if (cached !== undefined) return cached

  let result = path

  // Handle Unix UNC paths (//server/share)
  if (result.match(UNIX_UNC_REGEX)) {
    result = result.replace(/\//g, '\\')
    cacheResult(cacheKey, result)
    return result
  }

  // Handle Unix-style drive paths (/c/...)
  const unixDriveMatch = result.match(UNIX_DRIVE_REGEX)
  if (unixDriveMatch) {
    const driveLetter = unixDriveMatch[1].toUpperCase()
    const rest = result.slice(2) // Skip /c
    if (rest === '' || rest === '/') {
      result = `${driveLetter}:\\`
    } else {
      result = `${driveLetter}:${rest}`
    }
  }

  // Convert forward slashes to backslashes
  result = result.replace(/\//g, '\\')

  cacheResult(cacheKey, result)
  return result
}

/**
 * Resolves a path relative to a base path.
 *
 * - Resolves . and .. segments
 * - Handles both absolute and relative paths
 * - Normalizes the result to Unix format
 *
 * @param path - The path to resolve
 * @param base - Optional base path (defaults to empty string)
 * @returns The resolved path
 *
 * @example
 * ```typescript
 * resolvePath('bar/baz', '/foo')     // '/foo/bar/baz'
 * resolvePath('../baz', '/foo/bar')  // '/foo/baz'
 * resolvePath('/absolute')           // '/absolute'
 * ```
 */
export function resolvePath(path: string, base?: string): string {
  // Convert to Unix format first
  const unixPath = toUnixPath(path)
  const unixBase = base ? toUnixPath(base) : ''

  // If path is empty, return base
  if (!unixPath) {
    return unixBase || '/'
  }

  // If path is absolute, just normalize it
  if (isAbsolutePath(unixPath)) {
    return normalizePath(unixPath)
  }

  // Combine base and path
  let combined: string
  if (unixBase) {
    combined = unixBase.endsWith('/')
      ? `${unixBase}${unixPath}`
      : `${unixBase}/${unixPath}`
  } else {
    combined = unixPath
  }

  return normalizePath(combined)
}

/**
 * Expands environment variables and home directory (~) in a path.
 *
 * Supports:
 * - ~ and ~/path (home directory)
 * - $VAR and ${VAR} (Unix-style env vars)
 * - %VAR% (Windows-style env vars)
 *
 * @param path - The path to expand
 * @param env - Environment variables mapping (defaults to empty)
 * @returns The expanded path
 *
 * @example
 * ```typescript
 * expandPath('~/Documents', { HOME: '/home/user' })
 * // '/home/user/Documents'
 *
 * expandPath('$HOME/$PROJECT', { HOME: '/home/user', PROJECT: 'app' })
 * // '/home/user/app'
 *
 * expandPath('%USERPROFILE%\\Documents', { USERPROFILE: 'C:\\Users\\test' })
 * // 'C:\\Users\\test\\Documents'
 * ```
 */
export function expandPath(
  path: string,
  env: Record<string, string> = {}
): string {
  if (!path) return path

  let result = path

  // Expand home directory (~)
  if (result === '~' || result.startsWith('~/')) {
    const home = env.HOME || env.USERPROFILE
    if (home) {
      result = result === '~' ? home : home + result.slice(1)
    }
  }

  // Expand Unix-style environment variables ($VAR and ${VAR})
  result = result.replace(
    UNIX_ENV_VAR_REGEX,
    (match, bracedName, name) => {
      const varName = bracedName || name
      return env[varName] !== undefined ? env[varName] : match
    }
  )

  // Expand Windows-style environment variables (%VAR%)
  result = result.replace(WINDOWS_ENV_VAR_REGEX, (match, name) => {
    return env[name] !== undefined ? env[name] : match
  })

  return result
}

/**
 * Normalizes a path by resolving . and .. segments and removing redundant slashes.
 *
 * @param path - The path to normalize
 * @returns The normalized path
 *
 * @example
 * ```typescript
 * normalizePath('/foo//bar///baz')    // '/foo/bar/baz'
 * normalizePath('/foo/./bar/../baz')  // '/foo/baz'
 * normalizePath('./foo/../bar')       // 'bar'
 * ```
 */
export function normalizePath(path: string): string {
  if (!path) return path

  // Convert to Unix format
  const unixPath = toUnixPath(path)

  const isAbsolute = unixPath.startsWith('/')
  const hasTrailingSlash = unixPath.endsWith('/') && unixPath.length > 1

  // Split into segments
  const segments = unixPath.split('/').filter(Boolean)
  const result: string[] = []

  for (const segment of segments) {
    if (segment === '.') {
      continue
    } else if (segment === '..') {
      if (result.length > 0 && result[result.length - 1] !== '..') {
        result.pop()
      } else if (!isAbsolute) {
        result.push('..')
      }
    } else {
      result.push(segment)
    }
  }

  let normalized = result.join('/')

  if (isAbsolute) {
    normalized = '/' + normalized
  }

  if (hasTrailingSlash && normalized !== '/') {
    normalized += '/'
  }

  return normalized || (isAbsolute ? '/' : '.')
}

/**
 * Checks if a path is absolute.
 *
 * Supports:
 * - Unix absolute paths (/...)
 * - Windows drive paths (C:\...)
 * - UNC paths (\\server\share or //server/share)
 *
 * @param path - The path to check
 * @returns True if the path is absolute
 *
 * @example
 * ```typescript
 * isAbsolutePath('/foo/bar')       // true
 * isAbsolutePath('C:\\foo\\bar')   // true
 * isAbsolutePath('\\\\server\\s')  // true
 * isAbsolutePath('foo/bar')        // false
 * ```
 */
export function isAbsolutePath(path: string): boolean {
  if (!path) return false

  // Unix absolute path
  if (path.startsWith('/')) return true

  // Windows drive letter
  if (DRIVE_LETTER_REGEX.test(path)) return true

  // Windows UNC path
  if (path.startsWith('\\\\')) return true

  return false
}

/**
 * Detects the platform of a path based on its format.
 *
 * @param path - The path to analyze
 * @returns The detected platform (Unix or Windows)
 *
 * @example
 * ```typescript
 * detectPlatform('/foo/bar')      // PathPlatform.Unix
 * detectPlatform('C:\\foo\\bar')  // PathPlatform.Windows
 * detectPlatform('foo\\bar')      // PathPlatform.Windows
 * detectPlatform('foo/bar')       // PathPlatform.Unix
 * ```
 */
export function detectPlatform(path: string): PathPlatform {
  if (!path) return PathPlatform.Unix

  // Windows drive letter
  if (DRIVE_LETTER_REGEX.test(path)) return PathPlatform.Windows

  // Windows UNC path
  if (path.startsWith('\\\\')) return PathPlatform.Windows

  // Backslash indicates Windows
  if (path.includes('\\')) return PathPlatform.Windows

  // Default to Unix
  return PathPlatform.Unix
}

/**
 * Validates a path for security issues.
 *
 * Checks for:
 * - Path traversal attacks (../ sequences that escape allowed root)
 * - Null byte injection
 * - Windows reserved device names
 *
 * @param path - The path to validate
 * @param options - Validation options
 * @throws {PathSecurityError} If the path contains security issues
 *
 * @example
 * ```typescript
 * validatePathSecurity('/safe/path') // OK
 *
 * validatePathSecurity('/foo/../../../etc/passwd')
 * // throws PathSecurityError
 *
 * validatePathSecurity('/foo/bar\x00.txt')
 * // throws PathSecurityError (null byte)
 *
 * validatePathSecurity('C:\\CON')
 * // throws PathSecurityError (reserved device name)
 * ```
 */
export function validatePathSecurity(
  path: string,
  options: PathSecurityOptions = {}
): void {
  if (!path) return

  // Decode URL-encoded characters for security checking
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(path)
  } catch {
    // If decoding fails, use original path
    decodedPath = path
  }

  // Check for null bytes
  if (decodedPath.includes('\x00') || path.includes('%00')) {
    throw new PathSecurityError(
      `Null byte detected in path: ${path}`,
      path,
      'null_byte'
    )
  }

  // Check for Windows reserved device names
  const normalizedPath = toUnixPath(path)
  const segments = normalizedPath.split('/').filter(Boolean)

  for (const segment of segments) {
    // Get base name without extension
    const baseName = segment.split('.')[0].toUpperCase()
    if (WINDOWS_DEVICE_NAMES.has(baseName)) {
      throw new PathSecurityError(
        `Windows reserved device name detected: ${segment}`,
        path,
        'device_name'
      )
    }
  }

  // Check if path escapes allowed root
  if (options.allowedRoot) {
    const normalizedRoot = normalizePath(toUnixPath(options.allowedRoot))
    const normalizedTarget = normalizePath(toUnixPath(decodedPath))

    // Resolve relative paths against the root
    let resolvedTarget: string
    if (isAbsolutePath(normalizedTarget)) {
      resolvedTarget = normalizedTarget
    } else {
      resolvedTarget = resolvePath(normalizedTarget, normalizedRoot)
    }

    // Check if resolved path is within the allowed root
    const rootWithSlash = normalizedRoot.endsWith('/')
      ? normalizedRoot
      : normalizedRoot + '/'

    if (
      resolvedTarget !== normalizedRoot &&
      !resolvedTarget.startsWith(rootWithSlash)
    ) {
      throw new PathSecurityError(
        `Path escapes allowed root: ${path} resolves to ${resolvedTarget} (outside ${normalizedRoot})`,
        path,
        'outside_root'
      )
    }
  }

  // Check for path traversal (both encoded and unencoded)
  // Count how many levels the path tries to traverse
  const unixPath = toUnixPath(decodedPath)
  const parts = unixPath.split('/')
  let depth = 0
  let minDepth = 0

  // Track depth relative to starting position
  for (const part of parts) {
    if (part === '..') {
      depth--
      minDepth = Math.min(minDepth, depth)
    } else if (part && part !== '.') {
      depth++
    }
  }

  // For absolute paths, if we go negative, we're trying to escape root
  if (!options.allowedRoot && isAbsolutePath(path)) {
    // For absolute paths like /foo/../../../etc/passwd
    // The normalized result should not escape the filesystem root
    // If minDepth is more negative than the initial depth allows, it's traversal
    if (minDepth < 0) {
      throw new PathSecurityError(
        `Path traversal detected: ${path}`,
        path,
        'path_traversal'
      )
    }
  }

  // Check for encoded path traversal specifically (separate warning)
  if (
    decodedPath !== path &&
    (decodedPath.includes('../') || decodedPath.includes('..\\')) &&
    minDepth < 0
  ) {
    throw new PathSecurityError(
      `Encoded path traversal detected: ${path}`,
      path,
      'path_traversal'
    )
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Adds a result to the cache, evicting old entries if necessary.
 */
function cacheResult(key: string, value: string): void {
  if (pathCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entries (first 10%)
    const keysToDelete = Array.from(pathCache.keys()).slice(
      0,
      MAX_CACHE_SIZE / 10
    )
    for (const k of keysToDelete) {
      pathCache.delete(k)
    }
  }
  pathCache.set(key, value)
}

/**
 * Clears the path cache. Useful for testing.
 */
export function clearPathCache(): void {
  pathCache.clear()
}
