/**
 * CAS Path Mapping Functions
 *
 * Maps between content hashes and file paths in the content-addressable storage.
 * Uses git-style object storage: objects/xx/yyyy... where xx is first 2 hex chars.
 *
 * Supports both SHA-1 (40 char) and SHA-256 (64 char) hashes.
 */

/**
 * Options for path mapping configuration
 */
export interface PathMappingOptions {
  /** Base directory for object storage (default: 'objects') */
  baseDir?: string
  /** Number of characters to use for the prefix directory (default: 2, range: 1-8) */
  prefixLen?: number
}

/**
 * Default path mapping options
 */
const DEFAULT_OPTIONS: Required<PathMappingOptions> = {
  baseDir: 'objects',
  prefixLen: 2,
}

/**
 * Validate that a string contains only hexadecimal characters
 */
function isValidHex(str: string): boolean {
  return /^[0-9a-fA-F]+$/.test(str)
}

/**
 * Normalize and validate options
 */
function normalizeOptions(options?: PathMappingOptions): Required<PathMappingOptions> {
  const baseDir = options?.baseDir
    ? options.baseDir.replace(/\/$/, '') // Strip trailing slash
    : DEFAULT_OPTIONS.baseDir

  // Use default if empty string
  const normalizedBaseDir = baseDir || DEFAULT_OPTIONS.baseDir

  const prefixLen = options?.prefixLen ?? DEFAULT_OPTIONS.prefixLen

  // Validate prefixLen is an integer
  if (!Number.isInteger(prefixLen)) {
    throw new Error('prefixLen must be an integer')
  }

  // Validate prefixLen range
  if (prefixLen < 1 || prefixLen > 8) {
    throw new Error('prefixLen must be between 1 and 8')
  }

  return {
    baseDir: normalizedBaseDir,
    prefixLen,
  }
}

/**
 * Validate that a hash is valid (correct length and hex characters)
 * @param hash - The hash string to validate
 * @returns true if valid, false otherwise
 */
export function isValidHash(hash: string): boolean {
  if (!hash || (hash.length !== 40 && hash.length !== 64)) {
    return false
  }
  return isValidHex(hash)
}

/**
 * Validate that a path is a valid CAS object path
 * @param path - The path to validate
 * @param options - Path mapping options
 * @returns true if valid, false otherwise
 */
export function isValidPath(path: string, options?: PathMappingOptions): boolean {
  try {
    pathToHash(path, options)
    return true
  } catch {
    return false
  }
}

/**
 * Convert a hash to a storage path
 * @param hash - 40 or 64 character hex string (SHA-1 or SHA-256)
 * @param options - Path mapping options
 * @returns Path in format: baseDir/xx.../yyyy...
 */
export function hashToPath(hash: string, options?: PathMappingOptions): string {
  const { baseDir, prefixLen } = normalizeOptions(options)

  // Validate hash length (SHA-1 = 40, SHA-256 = 64)
  if (hash.length !== 40 && hash.length !== 64) {
    throw new Error(`Invalid hash length: expected 40 (SHA-1) or 64 (SHA-256), got ${hash.length}`)
  }

  // Validate hex characters
  if (!isValidHex(hash)) {
    throw new Error('Invalid hash: contains non-hex characters')
  }

  // Normalize to lowercase
  const normalizedHash = hash.toLowerCase()

  // Split into directory (first prefixLen chars) and filename (remaining chars)
  const dir = normalizedHash.slice(0, prefixLen)
  const filename = normalizedHash.slice(prefixLen)

  return `${baseDir}/${dir}/${filename}`
}

/**
 * Extract a hash from a storage path
 * @param path - Path in format: baseDir/xx.../yyyy...
 * @param options - Path mapping options
 * @returns Lowercase hex hash string
 */
export function pathToHash(path: string, options?: PathMappingOptions): string {
  const { baseDir, prefixLen } = normalizeOptions(options)

  // Validate path starts with baseDir
  const expectedPrefix = baseDir + '/'
  if (!path.startsWith(expectedPrefix)) {
    throw new Error(`Invalid path: must start with "${expectedPrefix}"`)
  }

  // Remove baseDir prefix and split remaining path
  const remainingPath = path.slice(expectedPrefix.length)
  const parts = remainingPath.split('/')

  // Expected format: xx.../yyyy... (2 parts after baseDir)
  if (parts.length !== 2) {
    throw new Error(`Invalid path: expected format "${baseDir}/xx.../yyyy..."`)
  }

  const dir = parts[0]
  const filename = parts[1]

  // Validate directory and filename exist
  if (!dir || !filename) {
    throw new Error(`Invalid path: expected format "${baseDir}/xx.../yyyy..."`)
  }

  // Validate directory is exactly prefixLen characters
  if (dir.length !== prefixLen) {
    throw new Error(`Invalid path: directory must be ${prefixLen} characters, got ${dir.length}`)
  }

  // Validate directory contains only hex characters
  if (!isValidHex(dir)) {
    throw new Error('Invalid path: directory contains non-hex characters')
  }

  // Validate filename contains only hex characters
  if (!isValidHex(filename)) {
    throw new Error('Invalid path: filename contains non-hex characters')
  }

  // Combine and normalize to lowercase
  const hash = (dir + filename).toLowerCase()

  // Validate resulting hash length (SHA-1 = 40, SHA-256 = 64)
  if (hash.length !== 40 && hash.length !== 64) {
    throw new Error(`Invalid hash length: expected 40 (SHA-1) or 64 (SHA-256), got ${hash.length}`)
  }

  return hash
}

/**
 * PathMapper interface for factory-created mappers
 */
export interface PathMapper {
  /** Convert hash to path using the configured options */
  hashToPath(hash: string): string
  /** Convert path to hash using the configured options */
  pathToHash(path: string): string
  /** The options used to create this mapper */
  options: Required<PathMappingOptions>
}

/**
 * Create a path mapper with pre-configured options
 * @param options - Path mapping options
 * @returns PathMapper with bound options
 */
export function createPathMapper(options?: PathMappingOptions): PathMapper {
  const normalizedOptions = normalizeOptions(options)

  return {
    hashToPath: (hash: string) => hashToPath(hash, normalizedOptions),
    pathToHash: (path: string) => pathToHash(path, normalizedOptions),
    options: normalizedOptions,
  }
}
