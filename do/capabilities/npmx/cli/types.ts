/**
 * CLI Types for npmx
 *
 * Type definitions for npm-compatible CLI commands.
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
 * Package listing entry
 */
export interface PackageEntry {
  name: string
  version: string
  description?: string
  dev?: boolean
  resolved?: string
}

/**
 * Options for list output formatting
 */
export interface ListFormatOptions {
  long?: boolean
  json?: boolean
  depth?: number
}

/**
 * Install options
 */
export interface InstallOptions {
  save?: boolean
  saveDev?: boolean
  saveExact?: boolean
  global?: boolean
  production?: boolean
}

/**
 * Search result entry
 */
export interface SearchResult {
  name: string
  version: string
  description?: string
  keywords?: string[]
  author?: string
  date?: string
  downloads?: number
}
