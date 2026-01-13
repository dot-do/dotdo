/**
 * Path Constants and Utilities
 *
 * Standardized paths for dotdo CLI. Uses `.do` as the directory name.
 */

import * as path from 'path'
import * as os from 'os'

// ============================================================================
// Constants
// ============================================================================

/** The standard dotdo directory name */
export const DOTDO_DIR = '.do'

/** State subdirectory within .do */
export const DOTDO_STATE_DIR = path.join(DOTDO_DIR, 'state')

/** Bin subdirectory within .do */
export const DOTDO_BIN_SUBDIR = 'bin'

// ============================================================================
// Path Functions
// ============================================================================

/**
 * Get the dotdo directory path for a project
 */
export function getDotdoDir(rootDir: string): string {
  return path.join(rootDir, DOTDO_DIR)
}

/**
 * Get the state directory path for a project
 */
export function getStateDir(rootDir: string): string {
  return path.join(rootDir, DOTDO_STATE_DIR)
}

/**
 * Get the user's home dotdo directory (~/.do)
 */
export function getHomeDotdoDir(): string {
  return path.join(os.homedir(), DOTDO_DIR)
}

/**
 * Get the user's home dotdo bin directory (~/.do/bin)
 */
export function getHomeBinDir(): string {
  return path.join(os.homedir(), DOTDO_DIR, DOTDO_BIN_SUBDIR)
}

/**
 * Get the local project dotdo bin directory (.do/bin)
 */
export function getLocalBinDir(rootDir: string = process.cwd()): string {
  return path.join(rootDir, DOTDO_DIR, DOTDO_BIN_SUBDIR)
}
