/**
 * bashx.do Type Definitions
 *
 * Comprehensive TypeScript interfaces for AI-enhanced bash execution
 * with AST-based validation, safety classification, and intent analysis.
 *
 * This file re-exports core types from @dotdo/bashx (core/types.ts) and
 * adds platform-specific types for Cloudflare Workers integration.
 *
 * Type Architecture:
 * - core/types.ts: Pure library types (no Cloudflare deps)
 * - src/types.ts: Re-exports core + platform-specific extensions
 *
 * @packageDocumentation
 */

// ============================================================================
// Re-export Core Types
// ============================================================================

/**
 * AST Types (tree-sitter-bash compatible)
 * Re-exported from core/types.ts for backward compatibility.
 */
export type {
  // AST Node Types
  BashNode,
  Program,
  List,
  Pipeline,
  Command,
  Subshell,
  CompoundCommand,
  FunctionDef,
  Word,
  Redirect,
  Assignment,
  Expansion,
  ParseError,
  // Safety Classification Types
  SafetyClassification,
  CommandClassification,
  OperationType,
  ImpactLevel,
  SafetyAnalysis,
  DangerCheck,
  // Intent Types
  Intent,
  Fix,
  // Multi-Language Types
  SupportedLanguage,
  LanguageContext,
} from '../core/types.js'

// Import types we need to reference in this file
import type {
  Program,
  ParseError,
  Fix,
  Intent,
  SafetyClassification,
} from '../core/types.js'

// ============================================================================
// Result Type
// ============================================================================

/**
 * Result of a bash command execution.
 * Contains the execution output, AST analysis, safety classification,
 * and recovery options.
 *
 * @example
 * ```typescript
 * const result = await bash`git status`
 *
 * if (result.exitCode === 0) {
 *   console.log(result.stdout)
 * } else {
 *   console.error(result.stderr)
 * }
 *
 * // Check if command was blocked
 * if (result.blocked) {
 *   console.log('Blocked:', result.blockReason)
 *   console.log('Requires confirmation:', result.requiresConfirm)
 * }
 * ```
 */
export interface BashResult {
  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  /**
   * The original input string (command or natural language description).
   */
  input: string

  // -------------------------------------------------------------------------
  // AST Analysis
  // -------------------------------------------------------------------------

  /**
   * Parsed Abstract Syntax Tree of the command.
   * Only present if parsing succeeded.
   */
  ast?: Program

  /**
   * Whether the command is syntactically valid bash.
   */
  valid: boolean

  /**
   * Parse errors, if any.
   */
  errors?: ParseError[]

  /**
   * Auto-fixed command, if the original had errors that could be corrected.
   */
  fixed?: {
    /** The corrected command string */
    command: string
    /** List of fixes that were applied */
    changes: Fix[]
  }

  // -------------------------------------------------------------------------
  // Semantic Understanding
  // -------------------------------------------------------------------------

  /**
   * Semantic intent extracted from the command.
   * Describes what files will be read/written/deleted, network access, etc.
   */
  intent: Intent

  // -------------------------------------------------------------------------
  // Safety Classification
  // -------------------------------------------------------------------------

  /**
   * Safety classification of the command.
   * Indicates the type of operation, impact level, and reversibility.
   */
  classification: SafetyClassification

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  /**
   * The actual command that was (or would be) executed.
   * May differ from input if input was natural language or was auto-fixed.
   */
  command: string

  /**
   * Whether the command was generated from natural language input.
   */
  generated: boolean

  /**
   * Standard output from the command execution.
   */
  stdout: string

  /**
   * Standard error from the command execution.
   */
  stderr: string

  /**
   * Exit code of the command. 0 typically indicates success.
   */
  exitCode: number

  // -------------------------------------------------------------------------
  // Safety Gate
  // -------------------------------------------------------------------------

  /**
   * Whether the command was blocked from execution due to safety concerns.
   */
  blocked?: boolean

  /**
   * Whether the command requires explicit confirmation to execute.
   * True for high/critical impact commands.
   */
  requiresConfirm?: boolean

  /**
   * Reason the command was blocked, if applicable.
   */
  blockReason?: string

  // -------------------------------------------------------------------------
  // Recovery
  // -------------------------------------------------------------------------

  /**
   * Undo script to reverse the effects of this command.
   * Only present for reversible operations.
   */
  undo?: string

  /**
   * Alternative commands or suggestions if the command failed or was blocked.
   */
  suggestions?: string[]

  // -------------------------------------------------------------------------
  // Multi-Language Extensions (optional fields for backward compatibility)
  // -------------------------------------------------------------------------

  /**
   * The detected or specified programming language for this command.
   * Present when executing non-bash code via interpreters.
   * @optional
   */
  language?: 'bash' | 'python' | 'ruby' | 'node' | 'go' | 'rust'

  /**
   * Execution tier for multi-language commands.
   * - 1: Direct shell execution (bash)
   * - 2: Interpreted execution (python, ruby, node)
   * - 3: Compiled execution (go, rust)
   * @optional
   */
  tier?: 1 | 2 | 3
}

// ============================================================================
// Execution Options
// ============================================================================

/**
 * Options for executing bash commands.
 *
 * @example
 * ```typescript
 * const options: ExecOptions = {
 *   timeout: 30000,
 *   cwd: '/home/user/project',
 *   env: { NODE_ENV: 'production' },
 *   confirm: true,
 *   dryRun: false
 * }
 * ```
 */
export interface ExecOptions {
  /**
   * Maximum execution time in milliseconds.
   * Command will be killed if it exceeds this limit.
   * @default 30000
   */
  timeout?: number

  /**
   * Working directory for command execution.
   * Defaults to the current working directory.
   */
  cwd?: string

  /**
   * Environment variables to set for the command.
   * These are merged with the current environment.
   */
  env?: Record<string, string>

  /**
   * Confirm execution of dangerous commands.
   * Required for commands classified as high or critical impact.
   * @default false
   */
  confirm?: boolean

  /**
   * Run in dry-run mode - parse and analyze without executing.
   * Useful for validation and safety checks.
   * @default false
   */
  dryRun?: boolean

  /**
   * Run command with elevated privileges (sudo).
   * Requires confirmation.
   * @default false
   */
  elevated?: boolean

  /**
   * Capture stdin from the provided string.
   */
  stdin?: string

  /**
   * Maximum output size in bytes before truncation.
   * @default 1048576 (1MB)
   */
  maxOutputSize?: number
}

/**
 * Legacy alias for ExecOptions.
 * @deprecated Use ExecOptions instead.
 */
export type BashOptions = ExecOptions

/**
 * Result of executing a bash command.
 * This is a simplified alias for BashResult that focuses on execution output.
 *
 * @example
 * ```typescript
 * const result: ExecResult = await bash.exec('ls', ['-la'])
 * console.log(result.stdout)
 * console.log('Exit code:', result.exitCode)
 * ```
 */
export type ExecResult = BashResult

// ============================================================================
// Streaming Types
// ============================================================================

/**
 * Options for streaming command execution via spawn.
 */
export interface SpawnOptions extends ExecOptions {
  /**
   * Callback for stdout data chunks.
   */
  onStdout?: (chunk: string) => void

  /**
   * Callback for stderr data chunks.
   */
  onStderr?: (chunk: string) => void

  /**
   * Callback when the process exits.
   */
  onExit?: (exitCode: number) => void
}

/**
 * Handle for a spawned process.
 */
export interface SpawnHandle {
  /**
   * Process ID of the spawned process.
   */
  pid: number

  /**
   * Promise that resolves when the process exits.
   */
  done: Promise<BashResult>

  /**
   * Kill the spawned process.
   * @param signal - Signal to send (default: SIGTERM)
   */
  kill(signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT'): void

  /**
   * Write to the process stdin.
   */
  write(data: string): void

  /**
   * Close stdin to signal end of input.
   */
  closeStdin(): void
}

// ============================================================================
// Client Types
// ============================================================================

/**
 * Tagged template and callable bash client interface.
 * Supports both tagged template literals and direct function calls.
 *
 * @example
 * ```typescript
 * // Tagged template
 * const result = await bash`git status`
 *
 * // With interpolation
 * const file = 'package.json'
 * await bash`cat ${file}`
 *
 * // Direct call with options
 * await bash('rm -rf build', { confirm: true })
 * ```
 */
export interface BashClient {
  (input: string, options?: ExecOptions): Promise<BashResult>
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<BashResult>
}

/**
 * Tagged template function type for bash commands.
 */
export type BashTaggedTemplate = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<BashResult>

/**
 * Extended bash client with additional tagged template capabilities.
 * Provides shell-safe interpolation by default, with escape utilities.
 *
 * @example
 * ```typescript
 * import { bash } from 'bashx'
 *
 * // Basic tagged template (values are escaped)
 * const file = 'my file.txt'
 * await bash`cat ${file}`  // → cat 'my file.txt'
 *
 * // Options as factory
 * await bash({ cwd: '/tmp' })`ls -la`
 *
 * // Raw mode (no escaping - dangerous!)
 * await bash.raw`echo ${userInput}`
 *
 * // Reusable configured template
 * const tmpBash = bash.with({ cwd: '/tmp', timeout: 5000 })
 * await tmpBash`ls`
 *
 * // Direct escape utility
 * const escaped = bash.escape('file; rm -rf /')
 * ```
 */
export interface BashClientExtended {
  /**
   * Execute a bash command with options.
   */
  (input: string, options?: ExecOptions): Promise<BashResult>

  /**
   * Execute a bash command using tagged template.
   * Interpolated values are automatically shell-escaped for safety.
   */
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<BashResult>

  /**
   * Create a tagged template with bound options.
   * Returns a template function that uses the specified options.
   *
   * @example
   * ```typescript
   * await bash({ cwd: '/tmp' })`ls -la`
   * await bash({ confirm: true })`rm -rf old/`
   * ```
   */
  (options: ExecOptions): BashTaggedTemplate

  /**
   * Raw tagged template - NO escaping.
   * Use with extreme caution for trusted input only.
   *
   * @example
   * ```typescript
   * // Glob patterns need raw mode
   * const pattern = '*.ts'
   * await bash.raw`find . -name ${pattern}`
   * ```
   */
  raw: BashTaggedTemplate

  /**
   * Create a reusable tagged template with bound options.
   * Unlike calling bash(options), this returns a reusable function.
   *
   * @example
   * ```typescript
   * const tmpBash = bash.with({ cwd: '/tmp' })
   * await tmpBash`ls`
   * await tmpBash`pwd`
   * ```
   */
  with(options: ExecOptions): BashTaggedTemplate

  /**
   * Escape a value for safe shell use.
   * Uses single-quote escaping.
   *
   * @example
   * ```typescript
   * bash.escape('file; rm -rf /')  // → 'file; rm -rf /'
   * bash.escape("it's fine")       // → 'it'"'"'s fine'
   * ```
   */
  escape(value: unknown): string
}

// ============================================================================
// BashCapability Interface
// ============================================================================

/**
 * Main interface for the $.bash proxy providing bash execution capabilities.
 * This is the primary API for executing bash commands within workflows.
 *
 * @example
 * ```typescript
 * // In a workflow context
 * class MyWorkflow extends DO {
 *   async deploy() {
 *     // Execute a command
 *     const result = await $.bash.exec('npm', ['run', 'build'])
 *
 *     // Run a shell script
 *     await $.bash.run(`
 *       cd /app
 *       npm install
 *       npm run build
 *     `)
 *
 *     // Streaming execution
 *     const handle = await $.bash.spawn('npm', ['run', 'dev'])
 *     handle.kill('SIGTERM')
 *   }
 * }
 * ```
 */
export interface BashCapability {
  /**
   * Execute a command and wait for completion.
   *
   * @param command - The command to execute (e.g., 'git', 'npm', 'ls')
   * @param args - Optional array of command arguments
   * @param options - Optional execution options
   * @returns Promise resolving to the execution result
   *
   * @example
   * ```typescript
   * // Simple command
   * const result = await $.bash.exec('ls')
   *
   * // With arguments
   * const result = await $.bash.exec('git', ['status', '--short'])
   *
   * // With options
   * const result = await $.bash.exec('npm', ['install'], {
   *   cwd: '/app',
   *   timeout: 60000
   * })
   * ```
   */
  exec(command: string, args?: string[], options?: ExecOptions): Promise<BashResult>

  /**
   * Spawn a command for streaming execution.
   * Returns a handle that can be used to interact with the running process.
   *
   * @param command - The command to spawn
   * @param args - Optional array of command arguments
   * @param options - Optional spawn options including stream callbacks
   * @returns Promise resolving to a spawn handle
   *
   * @example
   * ```typescript
   * // Stream output from a long-running process
   * const handle = await $.bash.spawn('tail', ['-f', '/var/log/app.log'], {
   *   onStdout: (chunk) => console.log(chunk),
   *   onStderr: (chunk) => console.error(chunk)
   * })
   *
   * // Later, stop the process
   * handle.kill()
   *
   * // Wait for it to finish
   * const result = await handle.done
   * ```
   */
  spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle>

  /**
   * Run a shell script.
   * Executes a multi-line bash script with full shell features.
   *
   * @param script - The bash script to execute
   * @param options - Optional execution options
   * @returns Promise resolving to the execution result
   *
   * @example
   * ```typescript
   * const result = await $.bash.run(`
   *   set -e
   *   cd /app
   *   npm install
   *   npm run build
   *   npm run test
   * `)
   *
   * if (result.exitCode !== 0) {
   *   throw new Error('Build failed: ' + result.stderr)
   * }
   * ```
   */
  run(script: string, options?: ExecOptions): Promise<BashResult>

  /**
   * Parse a command without executing it.
   * Useful for validation and analysis.
   *
   * @param input - The command or script to parse
   * @returns The parsed AST program
   */
  parse(input: string): Program

  /**
   * Analyze a command for safety classification.
   * Returns the safety classification and intent without executing.
   *
   * @param input - The command or script to analyze
   * @returns Analysis result with classification and intent
   *
   * @example
   * ```typescript
   * const analysis = $.bash.analyze('rm -rf /tmp/old-files')
   * console.log(analysis.classification.impact) // 'high'
   * console.log(analysis.classification.type)   // 'delete'
   * console.log(analysis.intent.deletes)        // ['/tmp/old-files']
   * ```
   */
  analyze(input: string): { classification: SafetyClassification; intent: Intent }

  /**
   * Check if a command is dangerous.
   * Quick safety check without full analysis.
   *
   * @param input - The command to check
   * @returns Object indicating if dangerous and why
   *
   * @example
   * ```typescript
   * const check = $.bash.isDangerous('rm -rf /')
   * if (check.dangerous) {
   *   console.error('Blocked:', check.reason)
   * }
   * ```
   */
  isDangerous(input: string): { dangerous: boolean; reason?: string }
}

// ============================================================================
// Filesystem Capability Types (from fsx.do)
// ============================================================================

/**
 * Re-export the comprehensive FsCapability interface from fsx.do.
 *
 * fsx.do provides a full POSIX-like filesystem API for Cloudflare Durable Objects
 * with tiered storage (hot/warm/cold), streaming support, and more.
 *
 * bashx uses a subset of this interface for Tier 1 native operations:
 * - read(): For cat, head, tail commands
 * - exists(): For test -e commands
 * - list(): For ls commands
 * - stat(): For test -f, test -d commands
 *
 * @see https://github.com/dot-do/fsx for full documentation
 */
import type { FsCapability as FsCapabilityBase, Stats as FsStatsBase, Dirent as DirentBase, ReadOptions as ReadOptionsBase, ListOptions as ListOptionsBase } from 'fsx.do'

/**
 * Re-export fsx.do types for backward compatibility.
 */
export type FsCapability = FsCapabilityBase
export type FsStats = FsStatsBase
export type Dirent = DirentBase
export type ReadOptions = ReadOptionsBase
export type ListOptions = ListOptionsBase

/**
 * Filesystem entry returned by list operations.
 * This is a simplified interface for backward compatibility.
 * The full Dirent class from fsx.do provides more functionality.
 */
export interface FsEntry {
  /** Entry name (file or directory name) */
  name: string
  /** Whether this entry is a directory */
  isDirectory: boolean
}

/**
 * File/directory statistics.
 * This is a simplified interface for backward compatibility.
 * The full Stats class from fsx.do provides POSIX-compatible methods.
 */
export interface FsStat {
  /** Size in bytes */
  size: number
  /** Whether this is a directory */
  isDirectory: boolean
  /** Whether this is a file */
  isFile: boolean
  /** Creation timestamp */
  createdAt: Date
  /** Last modification timestamp */
  modifiedAt: Date
}

/**
 * Options for filesystem read operations.
 * @deprecated Use ReadOptions from fsx.do instead
 */
export interface FsReadOptions {
  /** Encoding for reading file content */
  encoding?: 'utf8' | 'base64' | 'binary'
  /** Start offset for partial reads (like head/tail) */
  offset?: number
  /** Number of bytes/lines to read */
  limit?: number
}

/**
 * Options for filesystem list operations.
 * @deprecated Use ListOptions from fsx.do instead
 */
export interface FsListOptions {
  /** Filter function for entries */
  filter?: (entry: FsEntry) => boolean
  /** Whether to list recursively */
  recursive?: boolean
  /** Pattern to match (glob-like) */
  pattern?: string
}

// ============================================================================
// Type-Safe FsCapability with Proper Read Overloads
// ============================================================================

/**
 * String encoding types supported by the filesystem read operations.
 * Matches fsx.do's BufferEncoding type.
 */
export type StringEncoding = 'utf-8' | 'utf8' | 'ascii' | 'base64' | 'hex' | 'binary' | 'latin1'

/**
 * Read options with typed encoding for proper return type inference.
 */
export interface TypedReadOptions {
  /**
   * Character encoding for string output.
   * When specified (non-null), read() returns a string.
   * When null or undefined, read() returns Uint8Array.
   */
  encoding?: StringEncoding | null
  /** File open flag (default: 'r' for read) */
  flag?: string
  /** Start byte position for range reads (inclusive) */
  start?: number
  /** End byte position for range reads (inclusive) */
  end?: number
  /** Abort signal for cancellation support */
  signal?: AbortSignal
  /** High water mark for streaming reads (buffer size in bytes) */
  highWaterMark?: number
}

/**
 * Read options that explicitly specify a string encoding.
 * Used for overload inference - when encoding is a StringEncoding, return string.
 */
export interface TypedReadOptionsWithEncoding extends TypedReadOptions {
  encoding: StringEncoding
}

/**
 * Read options with no encoding or null encoding.
 * Used for overload inference - when encoding is absent/null, return Uint8Array.
 */
export interface TypedReadOptionsWithoutEncoding extends TypedReadOptions {
  encoding?: null
}

/**
 * Type-safe FsCapability interface with proper read() overloads.
 *
 * This interface extends the FsCapability from fsx.do with function overloads
 * that properly infer the return type of read() based on the encoding option:
 *
 * - `read(path, { encoding: 'utf-8' })` returns `Promise<string>`
 * - `read(path)` returns `Promise<Uint8Array>`
 * - `read(path, { encoding: null })` returns `Promise<Uint8Array>`
 *
 * This eliminates the need for `as string` casts when reading files with encoding.
 *
 * @example
 * ```typescript
 * const fs: TypedFsCapability = ...
 *
 * // TypeScript knows this is a string - no cast needed!
 * const content = await fs.read('/file.txt', { encoding: 'utf-8' })
 * const lines = content.split('\n')  // Works without 'as string'
 *
 * // TypeScript knows this is Uint8Array
 * const bytes = await fs.read('/file.bin')
 * console.log(bytes.length)
 * ```
 */
export interface TypedFsCapability extends Omit<FsCapability, 'read'> {
  /**
   * Read file contents as a string when encoding is specified.
   *
   * @param path - Absolute path to the file
   * @param options - Read options with encoding specified
   * @returns File contents as a string
   */
  read(path: string, options: TypedReadOptionsWithEncoding): Promise<string>

  /**
   * Read file contents as binary when no encoding is specified.
   *
   * @param path - Absolute path to the file
   * @param options - Read options without encoding (or encoding: null)
   * @returns File contents as Uint8Array
   */
  read(path: string, options?: TypedReadOptionsWithoutEncoding): Promise<Uint8Array>

  /**
   * Read file contents - return type depends on encoding option.
   *
   * @param path - Absolute path to the file
   * @param options - Read options (optional)
   * @returns File contents as string (with encoding) or Uint8Array (without)
   */
  read(path: string, options?: TypedReadOptions): Promise<string | Uint8Array>
}

/**
 * Helper function to cast any filesystem implementation to TypedFsCapability.
 * This provides runtime compatibility while enabling compile-time type safety.
 *
 * The cast is safe because TypedFsCapability only adds type-level information
 * about the read() return type based on options. The actual implementation
 * behavior is unchanged.
 *
 * @example
 * ```typescript
 * const fs = new FsxServiceAdapter(env.FSX)
 * const typedFs = asTypedFs(fs)
 *
 * // Now you can use typed reads without casts
 * const content = await typedFs.read('/file.txt', { encoding: 'utf-8' })
 * ```
 */
export function asTypedFs(fs: unknown): TypedFsCapability {
  return fs as TypedFsCapability
}

// ============================================================================
// MCP Tool Type
// ============================================================================

/**
 * MCP (Model Context Protocol) tool definition for bash.
 * Defines the schema for the bash tool as exposed via MCP.
 */
export interface BashMcpTool {
  /** Tool name, always 'bash' */
  name: 'bash'
  /** Tool description for LLM context */
  description: string
  /** JSON Schema for tool input */
  inputSchema: {
    type: 'object'
    properties: {
      /** The command or natural language description */
      input: { type: 'string'; description: string }
      /** Whether to confirm dangerous operations */
      confirm: { type: 'boolean'; description: string }
    }
    required: ['input']
  }
}
