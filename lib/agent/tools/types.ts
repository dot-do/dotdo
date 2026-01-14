/**
 * Tool Adapter Types
 *
 * Shared types for Claude Code tool adapters that map Claude SDK tools
 * to fsx.do and bashx.do capabilities.
 *
 * @module lib/agent/tools/types
 */

import type { FSx } from '../../../do/capabilities/fsx/core/fsx'
import type { TieredExecutor } from '../../../do/capabilities/bashx/src/do/tiered-executor'
import type { SafetyClassification } from '../../../do/capabilities/bashx/src/types'

// ============================================================================
// CORE INTERFACES
// ============================================================================

/**
 * JSON Schema type for tool input validation
 */
export interface JSONSchema {
  type: string
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
  enum?: string[]
  description?: string
  default?: unknown
  additionalProperties?: boolean | JSONSchema
  [key: string]: unknown
}

/**
 * Context provided to tool execution
 */
export interface ToolContext {
  /** Filesystem capability (fsx.do) */
  fs: FSx
  /** Bash executor (bashx.do) */
  bash?: TieredExecutor
  /** Current working directory */
  cwd: string
  /** Files that have been read in this session (for Edit validation) */
  readFiles: Set<string>
  /** Environment variables */
  env?: Record<string, string>
  /** User ID for permission context */
  uid?: number
  /** Group ID for permission context */
  gid?: number
}

/**
 * Generic tool adapter interface
 */
export interface ToolAdapter<TInput = unknown, TOutput = unknown> {
  /** Tool name (matches Claude SDK tool name) */
  name: string
  /** Tool description for LLM */
  description: string
  /** JSON Schema for input validation */
  inputSchema: JSONSchema
  /** Execute the tool with given input and context */
  execute(input: TInput, context: ToolContext): Promise<TOutput>
}

// ============================================================================
// READ TOOL
// ============================================================================

/**
 * Input for the Read tool
 */
export interface ReadToolInput {
  /** Absolute path to the file to read */
  file_path: string
  /** Line offset to start reading from (1-indexed) */
  offset?: number
  /** Number of lines to read */
  limit?: number
}

/**
 * Output from the Read tool
 */
export interface ReadToolOutput {
  /** File content as string, or base64-encoded for binary/images */
  content: string | { type: 'base64'; data: string; media_type: string }
  /** Whether the output was truncated */
  truncated?: boolean
  /** Total number of lines in the file (if applicable) */
  total_lines?: number
}

// ============================================================================
// WRITE TOOL
// ============================================================================

/**
 * Input for the Write tool
 */
export interface WriteToolInput {
  /** Absolute path to the file to write */
  file_path: string
  /** Content to write to the file */
  content: string
}

/**
 * Output from the Write tool
 */
export interface WriteToolOutput {
  /** Whether the write succeeded */
  success: boolean
  /** Number of bytes written */
  bytes_written: number
}

// ============================================================================
// EDIT TOOL
// ============================================================================

/**
 * Input for the Edit tool
 */
export interface EditToolInput {
  /** Absolute path to the file to edit */
  file_path: string
  /** The exact string to find and replace */
  old_string: string
  /** The string to replace it with */
  new_string: string
  /** Replace all occurrences (default: false) */
  replace_all?: boolean
}

/**
 * Output from the Edit tool
 */
export interface EditToolOutput {
  /** Whether the edit succeeded */
  success: boolean
  /** Number of replacements made */
  replacements_made: number
  /** Undo command (old_string/new_string swap) */
  undo?: { old_string: string; new_string: string }
}

// ============================================================================
// GLOB TOOL
// ============================================================================

/**
 * Input for the Glob tool
 */
export interface GlobToolInput {
  /** Glob pattern to match (e.g., "**\/*.ts") */
  pattern: string
  /** Base directory for matching (defaults to cwd) */
  path?: string
}

/**
 * Output from the Glob tool
 */
export interface GlobToolOutput {
  /** Matched file paths (sorted by mtime, most recent first) */
  files: string[]
  /** Whether results were truncated */
  truncated?: boolean
}

// ============================================================================
// GREP TOOL
// ============================================================================

/**
 * Input for the Grep tool
 */
export interface GrepToolInput {
  /** Search pattern (regex) */
  pattern: string
  /** File or directory to search in */
  path?: string
  /** Glob pattern to filter files */
  glob?: string
  /** File type to search (e.g., "ts", "py") */
  type?: string
  /** Output mode */
  output_mode?: 'content' | 'files_with_matches' | 'count'
  /** Case insensitive search */
  '-i'?: boolean
  /** Show line numbers */
  '-n'?: boolean
  /** Context lines after match */
  '-A'?: number
  /** Context lines before match */
  '-B'?: number
  /** Context lines before and after match */
  '-C'?: number
  /** Multiline mode */
  multiline?: boolean
  /** Limit output to first N entries */
  head_limit?: number
  /** Skip first N entries */
  offset?: number
}

/**
 * A single grep match
 */
export interface GrepMatch {
  /** File path */
  file: string
  /** Line number (if applicable) */
  line?: number
  /** Match content (if applicable) */
  content?: string
  /** Count (if output_mode is 'count') */
  count?: number
}

/**
 * Output from the Grep tool
 */
export interface GrepToolOutput {
  /** Matches found */
  matches: GrepMatch[]
  /** Whether results were truncated */
  truncated?: boolean
}

// ============================================================================
// BASH TOOL
// ============================================================================

/**
 * Input for the Bash tool
 */
export interface BashToolInput {
  /** Command to execute */
  command: string
  /** Timeout in milliseconds */
  timeout?: number
  /** Working directory */
  cwd?: string
  /** Confirm dangerous operations */
  confirm?: boolean
  /** Run in background */
  run_in_background?: boolean
  /** Description of what the command does */
  description?: string
}

/**
 * Output from the Bash tool
 */
export interface BashToolOutput {
  /** Standard output */
  stdout: string
  /** Standard error */
  stderr: string
  /** Exit code */
  exit_code: number
  /** Whether the command was blocked */
  blocked?: boolean
  /** Reason for blocking */
  block_reason?: string
  /** Execution tier used (1-4) */
  tier?: 1 | 2 | 3 | 4
  /** Execution duration in milliseconds */
  duration_ms: number
  /** Safety classification */
  safety?: SafetyClassification
}

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Base error class for tool errors
 */
export class ToolError extends Error {
  /** Error code for Claude SDK compatibility */
  code: string
  /** Additional error details */
  details?: unknown

  constructor(message: string, code: string, details?: unknown) {
    super(message)
    this.name = 'ToolError'
    this.code = code
    this.details = details
  }
}

/**
 * File not found error
 */
export class FileNotFoundError extends ToolError {
  constructor(path: string) {
    super(`ENOENT: no such file or directory: '${path}'`, 'ENOENT', { path })
    this.name = 'FileNotFoundError'
  }
}

/**
 * Permission denied error
 */
export class PermissionError extends ToolError {
  constructor(path: string, operation: string) {
    super(`EACCES: permission denied: '${path}' (${operation})`, 'EACCES', { path, operation })
    this.name = 'PermissionError'
  }
}

/**
 * Is a directory error
 */
export class IsDirectoryError extends ToolError {
  constructor(path: string) {
    super(`EISDIR: illegal operation on a directory: '${path}'`, 'EISDIR', { path })
    this.name = 'IsDirectoryError'
  }
}

/**
 * Not a directory error
 */
export class NotDirectoryError extends ToolError {
  constructor(path: string) {
    super(`ENOTDIR: not a directory: '${path}'`, 'ENOTDIR', { path })
    this.name = 'NotDirectoryError'
  }
}

/**
 * File already exists error
 */
export class FileExistsError extends ToolError {
  constructor(path: string) {
    super(`EEXIST: file already exists: '${path}'`, 'EEXIST', { path })
    this.name = 'FileExistsError'
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends ToolError {
  constructor(operation: string, timeout: number) {
    super(`ETIMEDOUT: operation timed out after ${timeout}ms: ${operation}`, 'ETIMEDOUT', { operation, timeout })
    this.name = 'TimeoutError'
  }
}

/**
 * Uniqueness error (for Edit tool)
 */
export class NotUniqueError extends ToolError {
  constructor(substring: string, count: number) {
    super(`String to replace is not unique (found ${count} occurrences)`, 'NOT_UNIQUE', { substring, count })
    this.name = 'NotUniqueError'
  }
}

/**
 * Command blocked error (for Bash tool)
 */
export class CommandBlockedError extends ToolError {
  constructor(command: string, reason: string) {
    super(`Command blocked: ${reason}`, 'BLOCKED', { command, reason })
    this.name = 'CommandBlockedError'
  }
}

/**
 * File not read error (for Edit tool)
 */
export class FileNotReadError extends ToolError {
  constructor(path: string) {
    super(`File must be read before editing: '${path}'`, 'NOT_READ', { path })
    this.name = 'FileNotReadError'
  }
}

/**
 * Path traversal error
 */
export class PathTraversalError extends ToolError {
  constructor(path: string) {
    super(`Path traversal detected: '${path}'`, 'PATH_TRAVERSAL', { path })
    this.name = 'PathTraversalError'
  }
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * MIME types for binary file detection
 */
export const BINARY_MIME_TYPES: Record<string, string> = {
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  // Documents
  '.pdf': 'application/pdf',
  // Archives
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  // Binary
  '.wasm': 'application/wasm',
  '.exe': 'application/octet-stream',
  '.dll': 'application/octet-stream',
  '.so': 'application/octet-stream',
  '.dylib': 'application/octet-stream',
}

/**
 * Image extensions for multimodal support
 */
export const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif',
])

/**
 * File type mappings for Grep --type option (ripgrep compatible)
 */
export const FILE_TYPE_GLOBS: Record<string, string[]> = {
  ts: ['*.ts', '*.tsx', '*.mts', '*.cts'],
  typescript: ['*.ts', '*.tsx', '*.mts', '*.cts'],
  js: ['*.js', '*.jsx', '*.mjs', '*.cjs'],
  javascript: ['*.js', '*.jsx', '*.mjs', '*.cjs'],
  py: ['*.py', '*.pyi', '*.pyw'],
  python: ['*.py', '*.pyi', '*.pyw'],
  rust: ['*.rs'],
  go: ['*.go'],
  java: ['*.java'],
  c: ['*.c', '*.h'],
  cpp: ['*.cpp', '*.cc', '*.cxx', '*.hpp', '*.hh', '*.hxx', '*.C', '*.H'],
  cs: ['*.cs'],
  csharp: ['*.cs'],
  rb: ['*.rb', '*.rake', 'Rakefile'],
  ruby: ['*.rb', '*.rake', 'Rakefile'],
  php: ['*.php', '*.php3', '*.php4', '*.php5', '*.phtml'],
  swift: ['*.swift'],
  kotlin: ['*.kt', '*.kts'],
  scala: ['*.scala'],
  html: ['*.html', '*.htm', '*.xhtml'],
  css: ['*.css', '*.scss', '*.sass', '*.less'],
  json: ['*.json', '*.jsonc', '*.json5'],
  yaml: ['*.yaml', '*.yml'],
  xml: ['*.xml', '*.xsd', '*.xsl', '*.xslt'],
  md: ['*.md', '*.markdown'],
  markdown: ['*.md', '*.markdown'],
  sql: ['*.sql'],
  sh: ['*.sh', '*.bash', '*.zsh'],
  shell: ['*.sh', '*.bash', '*.zsh'],
  docker: ['Dockerfile', 'Dockerfile.*', '*.dockerfile'],
  make: ['Makefile', 'makefile', 'GNUmakefile', '*.mk'],
  toml: ['*.toml'],
  ini: ['*.ini', '*.cfg', '*.conf'],
  vue: ['*.vue'],
  svelte: ['*.svelte'],
  astro: ['*.astro'],
}
