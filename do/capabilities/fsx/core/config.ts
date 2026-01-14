/**
 * @fileoverview FSx Configuration Module
 *
 * Provides comprehensive configuration management for the fsx.do filesystem.
 * This module handles:
 *
 * - **Type-safe configuration** - Strongly typed interfaces with readonly properties
 * - **Validation** - Runtime validation of all configuration options
 * - **Normalization** - Path normalization and default merging
 * - **Immutability** - Frozen configuration objects to prevent mutation
 *
 * @module core/config
 *
 * @example Basic usage
 * ```typescript
 * import { createConfig, defaultConfig } from './config'
 *
 * // Use all defaults
 * const config = createConfig()
 *
 * // Custom configuration
 * const custom = createConfig({
 *   rootPath: '/home/user/data',
 *   readOnly: true,
 *   encoding: 'utf-8'
 * })
 * ```
 *
 * @example Validation
 * ```typescript
 * import { createConfig, isValidEncoding, isValidMode } from './config'
 *
 * // Validate before creating
 * if (isValidEncoding(userEncoding)) {
 *   const config = createConfig({ encoding: userEncoding })
 * }
 *
 * // Invalid options throw EINVAL
 * try {
 *   createConfig({ mode: -1 }) // Throws EINVAL
 * } catch (err) {
 *   console.error('Invalid configuration:', err.message)
 * }
 * ```
 */

import { constants } from './constants.js'
import { EINVAL } from './errors.js'
import { normalize } from './path.js'
import type { BufferEncoding } from './types.js'

// =============================================================================
// VALIDATION CONSTANTS
// =============================================================================

/**
 * List of valid buffer encoding types supported by FSx.
 *
 * These encodings are compatible with Node.js Buffer and TextEncoder/TextDecoder.
 *
 * @remarks
 * - `utf8` and `utf-8` are equivalent and both accepted
 * - `binary` and `latin1` are equivalent (ISO-8859-1)
 *
 * @example
 * ```typescript
 * import { VALID_ENCODINGS } from './config'
 *
 * if (VALID_ENCODINGS.includes(userEncoding)) {
 *   // Safe to use
 * }
 * ```
 */
export const VALID_ENCODINGS: readonly BufferEncoding[] = Object.freeze([
  'utf-8',
  'utf8',
  'ascii',
  'base64',
  'hex',
  'binary',
  'latin1',
])

/**
 * Minimum valid file mode value (no permissions).
 *
 * Mode 0 means no permissions for anyone. While unusual,
 * it's technically valid for special use cases.
 */
export const MIN_MODE = 0

/**
 * Maximum valid file mode value (all permission and special bits set).
 *
 * This includes:
 * - Permission bits: rwx for owner, group, and others (0o777)
 * - Special bits: setuid, setgid, sticky bit (0o7000)
 *
 * @remarks
 * Value: 0o7777 = 4095 decimal
 */
export const MAX_MODE = 0o7777

/**
 * Default file permission mode for newly created files.
 *
 * Mode 0o666 (rw-rw-rw-) allows read/write for owner, group, and others.
 * This is typically masked by umask to produce actual permissions.
 */
export const DEFAULT_FILE_MODE = 0o666

/**
 * Default directory permission mode for newly created directories.
 *
 * Mode 0o755 (rwxr-xr-x) allows full access for owner, read/execute for others.
 */
export const DEFAULT_DIR_MODE = 0o755

// =============================================================================
// CONFIGURATION INTERFACES
// =============================================================================

/**
 * FSx Configuration interface.
 *
 * Defines the complete set of configuration options for filesystem operations.
 * All properties are readonly to enforce immutability after creation.
 *
 * @remarks
 * Configuration objects should be created using {@link createConfig} which
 * validates all options and returns a frozen object.
 *
 * @example
 * ```typescript
 * const config: FSxConfig = {
 *   rootPath: '/data',
 *   readOnly: false,
 *   encoding: 'utf8',
 *   mode: 0o666,
 *   flags: constants.O_RDONLY,
 *   recursive: false
 * }
 * ```
 */
export interface FSxConfig {
  /**
   * Base path for all filesystem operations.
   *
   * All paths passed to filesystem methods are relative to this root.
   * Must be an absolute path (starts with '/').
   *
   * @defaultValue '/'
   *
   * @example
   * ```typescript
   * // With rootPath: '/home/user'
   * fs.read('data/file.txt') // Reads /home/user/data/file.txt
   * ```
   */
  readonly rootPath: string

  /**
   * Whether the filesystem is in read-only mode.
   *
   * When `true`, all write operations (write, mkdir, unlink, etc.)
   * will throw an EROFS (read-only filesystem) error.
   *
   * @defaultValue false
   *
   * @example
   * ```typescript
   * const roConfig = createConfig({ readOnly: true })
   * if (isReadOnly(roConfig)) {
   *   throw new EROFS('write', path)
   * }
   * ```
   */
  readonly readOnly: boolean

  /**
   * Default text encoding for read/write operations.
   *
   * Used when no encoding is specified in operation options.
   * See {@link VALID_ENCODINGS} for supported values.
   *
   * @defaultValue 'utf8'
   */
  readonly encoding: BufferEncoding

  /**
   * Default file permission mode for newly created files.
   *
   * Specified as an octal number (e.g., 0o644).
   * Must be between {@link MIN_MODE} (0) and {@link MAX_MODE} (0o7777).
   *
   * @defaultValue 0o666 (rw-rw-rw-)
   *
   * @remarks
   * Common mode values:
   * - 0o644: Owner rw, others r (files)
   * - 0o755: Owner rwx, others rx (executables/directories)
   * - 0o600: Owner rw only (private files)
   */
  readonly mode: number

  /**
   * Default file open flags.
   *
   * Specifies the default behavior for file operations.
   * Uses POSIX-style flags from the constants module.
   *
   * @defaultValue constants.O_RDONLY (read-only)
   *
   * @see constants for available flag values
   *
   * @example
   * ```typescript
   * import { constants } from './constants'
   *
   * // Read-write with create
   * const flags = constants.O_RDWR | constants.O_CREAT
   * ```
   */
  readonly flags: number

  /**
   * Default behavior for recursive directory operations.
   *
   * When `true`, operations like mkdir and rmdir will
   * operate recursively by default.
   *
   * @defaultValue false
   *
   * @example
   * ```typescript
   * // With recursive: true
   * fs.mkdir('/a/b/c') // Creates all intermediate directories
   * ```
   */
  readonly recursive: boolean
}

/**
 * Partial configuration options for user input.
 *
 * Used as input to {@link createConfig}. All properties are optional
 * and will be merged with {@link defaultConfig}.
 *
 * @example
 * ```typescript
 * const options: FSxConfigOptions = {
 *   rootPath: '/data',
 *   readOnly: true
 * }
 * const config = createConfig(options)
 * ```
 */
export interface FSxConfigOptions {
  /**
   * Base path for filesystem operations.
   * @see FSxConfig.rootPath
   */
  rootPath?: string

  /**
   * Enable read-only mode.
   * @see FSxConfig.readOnly
   */
  readOnly?: boolean

  /**
   * Default text encoding.
   * @see FSxConfig.encoding
   */
  encoding?: BufferEncoding

  /**
   * Default file permission mode.
   * @see FSxConfig.mode
   */
  mode?: number

  /**
   * Default file open flags.
   * @see FSxConfig.flags
   */
  flags?: number

  /**
   * Enable recursive operations by default.
   * @see FSxConfig.recursive
   */
  recursive?: boolean
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

/**
 * Default configuration values for FSx.
 *
 * This frozen object contains the default values used when
 * options are not specified in {@link createConfig}.
 *
 * @remarks
 * This object is frozen and cannot be modified. Use {@link createConfig}
 * to create custom configurations.
 *
 * @example
 * ```typescript
 * import { defaultConfig } from './config'
 *
 * console.log(defaultConfig.rootPath)   // '/'
 * console.log(defaultConfig.encoding)   // 'utf8'
 * console.log(defaultConfig.mode)       // 438 (0o666)
 * ```
 */
export const defaultConfig: FSxConfig = Object.freeze({
  rootPath: '/',
  readOnly: false,
  encoding: 'utf8' as BufferEncoding,
  mode: DEFAULT_FILE_MODE,
  flags: constants.O_RDONLY,
  recursive: false,
})

// =============================================================================
// VALIDATION UTILITIES
// =============================================================================

/**
 * Check if a value is a valid BufferEncoding.
 *
 * Use this to validate user input before creating a configuration.
 *
 * @param value - The value to check
 * @returns `true` if the value is a valid encoding
 *
 * @example
 * ```typescript
 * const userInput = 'utf8'
 * if (isValidEncoding(userInput)) {
 *   const config = createConfig({ encoding: userInput })
 * }
 * ```
 */
export function isValidEncoding(value: unknown): value is BufferEncoding {
  return typeof value === 'string' && VALID_ENCODINGS.includes(value as BufferEncoding)
}

/**
 * Check if a value is a valid file mode.
 *
 * Valid modes are integers between 0 and 0o7777 (4095).
 *
 * @param value - The value to check
 * @returns `true` if the value is a valid mode
 *
 * @example
 * ```typescript
 * isValidMode(0o644)   // true
 * isValidMode(0o755)   // true
 * isValidMode(-1)      // false
 * isValidMode(0o10000) // false (exceeds max)
 * isValidMode('644')   // false (not a number)
 * ```
 */
export function isValidMode(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_MODE && value <= MAX_MODE
}

/**
 * Check if a value is a valid flags value.
 *
 * Flags must be a non-negative integer.
 *
 * @param value - The value to check
 * @returns `true` if the value is a valid flags value
 *
 * @example
 * ```typescript
 * import { constants } from './constants'
 *
 * isValidFlags(constants.O_RDONLY)              // true
 * isValidFlags(constants.O_RDWR | O_CREAT)      // true
 * isValidFlags(-1)                              // false
 * isValidFlags('r')                             // false
 * ```
 */
export function isValidFlags(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Check if a value is a valid root path.
 *
 * Root paths must be strings. Empty strings are valid and
 * will be normalized to '/'.
 *
 * @param value - The value to check
 * @returns `true` if the value is a valid root path
 *
 * @example
 * ```typescript
 * isValidRootPath('/home/user') // true
 * isValidRootPath('')           // true (normalizes to '/')
 * isValidRootPath('relative')   // true (will be made absolute)
 * isValidRootPath(123)          // false
 * isValidRootPath(null)         // false
 * ```
 */
export function isValidRootPath(value: unknown): value is string {
  return typeof value === 'string'
}

// =============================================================================
// INTERNAL VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate and normalize a root path.
 *
 * @internal
 * @param rootPath - The root path to validate
 * @returns The normalized absolute path
 * @throws {EINVAL} If rootPath is not a string
 */
function validateAndNormalizePath(rootPath: unknown): string {
  if (typeof rootPath !== 'string') {
    throw new EINVAL('createConfig', 'rootPath must be a string')
  }

  // Empty string normalizes to root
  if (rootPath === '') {
    return '/'
  }

  // Ensure absolute path
  let path = rootPath
  if (!path.startsWith('/')) {
    path = '/' + path
  }

  return normalize(path)
}

/**
 * Validate encoding and return typed value.
 *
 * @internal
 * @param encoding - The encoding to validate
 * @returns The validated encoding
 * @throws {EINVAL} If encoding is not valid
 */
function validateEncoding(encoding: unknown): BufferEncoding {
  if (!isValidEncoding(encoding)) {
    throw new EINVAL('createConfig', 'encoding must be a valid BufferEncoding')
  }
  return encoding
}

/**
 * Validate file mode and return typed value.
 *
 * @internal
 * @param mode - The mode to validate
 * @returns The validated mode
 * @throws {EINVAL} If mode is not a valid number in range
 */
function validateMode(mode: unknown): number {
  if (typeof mode !== 'number') {
    throw new EINVAL('createConfig', 'mode must be a number')
  }
  if (mode < MIN_MODE || mode > MAX_MODE) {
    throw new EINVAL('createConfig', `mode must be between 0 and ${MAX_MODE.toString(8)}`)
  }
  return mode
}

/**
 * Validate flags and return typed value.
 *
 * @internal
 * @param flags - The flags to validate
 * @returns The validated flags
 * @throws {EINVAL} If flags is not a number
 */
function validateFlags(flags: unknown): number {
  if (typeof flags !== 'number') {
    throw new EINVAL('createConfig', 'flags must be a number')
  }
  return flags
}

/**
 * Validate boolean value and return typed value.
 *
 * @internal
 * @param value - The value to validate
 * @param name - The property name for error messages
 * @returns The validated boolean
 * @throws {EINVAL} If value is not a boolean
 */
function validateBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new EINVAL('createConfig', `${name} must be a boolean`)
  }
  return value
}

// =============================================================================
// CONFIGURATION FACTORY
// =============================================================================

/**
 * Create a new FSx configuration.
 *
 * Creates a validated, normalized, and frozen configuration object.
 * Options are merged with {@link defaultConfig}, and all values are
 * validated before the configuration is frozen.
 *
 * @param options - Optional configuration options to override defaults
 * @returns A frozen FSxConfig object
 *
 * @throws {EINVAL} If any option is invalid:
 *   - `rootPath` must be a string
 *   - `readOnly` must be a boolean
 *   - `encoding` must be a valid BufferEncoding (see {@link VALID_ENCODINGS})
 *   - `mode` must be a number between 0 and 0o7777
 *   - `flags` must be a number
 *   - `recursive` must be a boolean
 *
 * @example Use all defaults
 * ```typescript
 * const config = createConfig()
 * // {
 * //   rootPath: '/',
 * //   readOnly: false,
 * //   encoding: 'utf8',
 * //   mode: 0o666,
 * //   flags: 0,
 * //   recursive: false
 * // }
 * ```
 *
 * @example Custom root path
 * ```typescript
 * const config = createConfig({ rootPath: '/home/user' })
 * console.log(config.rootPath) // '/home/user'
 * ```
 *
 * @example Read-only mode
 * ```typescript
 * const roConfig = createConfig({ readOnly: true })
 * if (isReadOnly(roConfig)) {
 *   throw new EROFS('write', '/file.txt')
 * }
 * ```
 *
 * @example Path normalization
 * ```typescript
 * const config = createConfig({ rootPath: '/foo//bar/../baz' })
 * console.log(config.rootPath) // '/foo/baz'
 *
 * const config2 = createConfig({ rootPath: 'relative/path' })
 * console.log(config2.rootPath) // '/relative/path'
 * ```
 *
 * @example Multiple options
 * ```typescript
 * const config = createConfig({
 *   rootPath: '/data',
 *   readOnly: true,
 *   encoding: 'ascii',
 *   mode: 0o600,
 *   recursive: true
 * })
 * ```
 */
export function createConfig(options: FSxConfigOptions = {}): FSxConfig {
  const config: FSxConfig = {
    rootPath:
      options.rootPath !== undefined
        ? validateAndNormalizePath(options.rootPath)
        : defaultConfig.rootPath,

    readOnly:
      options.readOnly !== undefined
        ? validateBoolean(options.readOnly, 'readOnly')
        : defaultConfig.readOnly,

    encoding:
      options.encoding !== undefined
        ? validateEncoding(options.encoding)
        : defaultConfig.encoding,

    mode:
      options.mode !== undefined
        ? validateMode(options.mode)
        : defaultConfig.mode,

    flags:
      options.flags !== undefined
        ? validateFlags(options.flags)
        : defaultConfig.flags,

    recursive:
      options.recursive !== undefined
        ? validateBoolean(options.recursive, 'recursive')
        : defaultConfig.recursive,
  }

  return Object.freeze(config)
}

// =============================================================================
// CONFIGURATION UTILITIES
// =============================================================================

/**
 * Check if a configuration is in read-only mode.
 *
 * Helper function to check the readOnly property of a configuration.
 * Use this before performing write operations.
 *
 * @param config - The configuration to check
 * @returns `true` if the configuration is read-only
 *
 * @example
 * ```typescript
 * import { createConfig, isReadOnly } from './config'
 * import { EROFS } from './errors'
 *
 * const config = createConfig({ readOnly: true })
 *
 * function write(path: string, data: string): void {
 *   if (isReadOnly(config)) {
 *     throw new EROFS('write', path)
 *   }
 *   // Perform write...
 * }
 * ```
 */
export function isReadOnly(config: FSxConfig): boolean {
  return config.readOnly
}

/**
 * Create a new configuration by merging updates with an existing config.
 *
 * This is useful for creating modified configurations while preserving
 * immutability. The original configuration is not modified.
 *
 * @param config - The base configuration to extend
 * @param updates - The options to override
 * @returns A new frozen FSxConfig with the updates applied
 *
 * @throws {EINVAL} If any update value is invalid
 *
 * @example
 * ```typescript
 * const baseConfig = createConfig({ rootPath: '/data' })
 * const roConfig = mergeConfig(baseConfig, { readOnly: true })
 *
 * console.log(baseConfig.readOnly) // false (unchanged)
 * console.log(roConfig.readOnly)   // true
 * console.log(roConfig.rootPath)   // '/data' (inherited)
 * ```
 */
export function mergeConfig(config: FSxConfig, updates: FSxConfigOptions): FSxConfig {
  return createConfig({
    rootPath: updates.rootPath ?? config.rootPath,
    readOnly: updates.readOnly ?? config.readOnly,
    encoding: updates.encoding ?? config.encoding,
    mode: updates.mode ?? config.mode,
    flags: updates.flags ?? config.flags,
    recursive: updates.recursive ?? config.recursive,
  })
}

/**
 * Type guard to check if an object is a valid FSxConfig.
 *
 * Validates that the object has all required properties with correct types.
 * Does not validate that values are in valid ranges (use {@link createConfig}
 * for full validation).
 *
 * @param value - The value to check
 * @returns `true` if the value is a valid FSxConfig shape
 *
 * @example
 * ```typescript
 * const maybeConfig = JSON.parse(savedConfig)
 * if (isFSxConfig(maybeConfig)) {
 *   // Safe to use as FSxConfig
 *   console.log(maybeConfig.rootPath)
 * }
 * ```
 */
export function isFSxConfig(value: unknown): value is FSxConfig {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  return (
    typeof obj.rootPath === 'string' &&
    typeof obj.readOnly === 'boolean' &&
    typeof obj.encoding === 'string' &&
    typeof obj.mode === 'number' &&
    typeof obj.flags === 'number' &&
    typeof obj.recursive === 'boolean'
  )
}

/**
 * Convert a configuration to a plain object for serialization.
 *
 * Creates a shallow copy of the configuration that can be safely
 * serialized to JSON. The returned object is NOT frozen.
 *
 * @param config - The configuration to convert
 * @returns A plain object with the same properties
 *
 * @example
 * ```typescript
 * const config = createConfig({ rootPath: '/data' })
 * const json = JSON.stringify(configToObject(config))
 * localStorage.setItem('fsxConfig', json)
 *
 * // Later:
 * const saved = JSON.parse(localStorage.getItem('fsxConfig'))
 * const restored = createConfig(saved)
 * ```
 */
export function configToObject(config: FSxConfig): FSxConfigOptions {
  return {
    rootPath: config.rootPath,
    readOnly: config.readOnly,
    encoding: config.encoding,
    mode: config.mode,
    flags: config.flags,
    recursive: config.recursive,
  }
}
