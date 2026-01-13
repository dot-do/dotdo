/**
 * FSx Configuration Module
 *
 * Provides configuration types and utilities for the fsx.do filesystem.
 * Configuration is validated, normalized, and frozen for immutability.
 *
 * @module core/config
 */

import { constants } from './constants.js'
import { EINVAL } from './errors.js'
import { normalize } from './path.js'
import type { BufferEncoding } from './types.js'

/**
 * Valid encoding types for filesystem operations
 */
const VALID_ENCODINGS: BufferEncoding[] = ['utf-8', 'utf8', 'ascii', 'base64', 'hex', 'binary', 'latin1']

/**
 * Maximum valid file mode (all permission bits set)
 */
const MAX_MODE = 0o7777

/**
 * FSx Configuration interface
 *
 * Defines the configuration options for filesystem operations.
 */
export interface FSxConfig {
  /** Base path for filesystem operations */
  readonly rootPath: string

  /** Whether writes are allowed (read-only mode blocks write operations) */
  readonly readOnly: boolean

  /** Default text encoding */
  readonly encoding: BufferEncoding

  /** Default file creation mode (permissions) */
  readonly mode: number

  /** Default open flags */
  readonly flags: number

  /** Default for directory operations */
  readonly recursive: boolean
}

/**
 * Configuration options (partial, for user input)
 */
export interface FSxConfigOptions {
  rootPath?: string
  readOnly?: boolean
  encoding?: BufferEncoding
  mode?: number
  flags?: number
  recursive?: boolean
}

/**
 * Default configuration values
 */
export const defaultConfig: FSxConfig = Object.freeze({
  rootPath: '/',
  readOnly: false,
  encoding: 'utf8' as BufferEncoding,
  mode: 0o666,
  flags: constants.O_RDONLY,
  recursive: false,
})

/**
 * Validate and normalize a root path
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
 * Validate encoding
 */
function validateEncoding(encoding: unknown): BufferEncoding {
  if (typeof encoding !== 'string' || !VALID_ENCODINGS.includes(encoding as BufferEncoding)) {
    throw new EINVAL('createConfig', 'encoding must be a valid BufferEncoding')
  }
  return encoding as BufferEncoding
}

/**
 * Validate file mode
 */
function validateMode(mode: unknown): number {
  if (typeof mode !== 'number') {
    throw new EINVAL('createConfig', 'mode must be a number')
  }
  if (mode < 0 || mode > MAX_MODE) {
    throw new EINVAL('createConfig', `mode must be between 0 and ${MAX_MODE.toString(8)}`)
  }
  return mode
}

/**
 * Validate flags
 */
function validateFlags(flags: unknown): number {
  if (typeof flags !== 'number') {
    throw new EINVAL('createConfig', 'flags must be a number')
  }
  return flags
}

/**
 * Validate boolean value
 */
function validateBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new EINVAL('createConfig', `${name} must be a boolean`)
  }
  return value
}

/**
 * Create a new FSx configuration
 *
 * Creates a validated, normalized, and frozen configuration object.
 * Any invalid options will throw EINVAL.
 *
 * @param options - Optional configuration options to override defaults
 * @returns A frozen FSxConfig object
 *
 * @throws {EINVAL} If any option is invalid
 *
 * @example
 * ```typescript
 * // Use all defaults
 * const config = createConfig()
 *
 * // Custom root path
 * const customConfig = createConfig({ rootPath: '/home/user' })
 *
 * // Read-only mode
 * const roConfig = createConfig({ readOnly: true })
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

/**
 * Check if a configuration is in read-only mode
 *
 * @param config - The configuration to check
 * @returns true if the configuration is read-only
 *
 * @example
 * ```typescript
 * const config = createConfig({ readOnly: true })
 * if (isReadOnly(config)) {
 *   throw new EROFS('write', '/file.txt')
 * }
 * ```
 */
export function isReadOnly(config: FSxConfig): boolean {
  return config.readOnly
}
