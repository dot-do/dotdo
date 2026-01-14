/**
 * CLI Types for fsx
 *
 * This file defines the types used by the CLI.
 * Part of TDD RED phase - types are defined but implementation doesn't exist yet.
 */

/**
 * Parsed command line arguments
 */
export interface ParsedArgs {
  command: string
  args: string[]
  options: Record<string, boolean | string | number>
}

/**
 * Result of executing a CLI command
 */
export interface CommandResult {
  exitCode: number
  output?: string
  error?: string
}

/**
 * Entry in a directory listing
 */
export interface LsEntry {
  name: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  mode: number
  mtime: number
}

/**
 * Options for ls output formatting
 */
export interface LsFormatOptions {
  long?: boolean
  showAll?: boolean
  human?: boolean
}
