/**
 * bashx.do Type Definitions
 *
 * Comprehensive TypeScript interfaces for AI-enhanced bash execution
 * with AST-based validation, safety classification, and intent analysis.
 *
 * @packageDocumentation
 */

// ============================================================================
// AST Types (tree-sitter-bash compatible)
// ============================================================================

/**
 * Union type of all possible AST node types.
 * Used for type-safe AST traversal.
 */
export type BashNode =
  | Program
  | List
  | Pipeline
  | Command
  | Subshell
  | CompoundCommand
  | FunctionDef
  | Word
  | Redirect
  | Assignment

/**
 * Root node of a parsed bash script.
 * Contains all top-level statements and any parse errors.
 */
export interface Program {
  /** Node type discriminator */
  type: 'Program'
  /** Top-level statements in the script */
  body: BashNode[]
  /** Parse errors encountered, if any */
  errors?: ParseError[]
}

/**
 * A list of commands connected by a list operator.
 * Represents && (and), || (or), ; (sequential), or & (background).
 */
export interface List {
  /** Node type discriminator */
  type: 'List'
  /** The operator connecting left and right */
  operator: '&&' | '||' | ';' | '&'
  /** Left-hand side command */
  left: BashNode
  /** Right-hand side command */
  right: BashNode
}

/**
 * A pipeline of commands connected by pipes.
 * Data flows from left to right through stdout/stdin.
 */
export interface Pipeline {
  /** Node type discriminator */
  type: 'Pipeline'
  /** Whether the pipeline is negated with ! */
  negated: boolean
  /** Commands in the pipeline, in order */
  commands: Command[]
}

/**
 * A simple command with name, arguments, and redirections.
 * The fundamental unit of bash execution.
 */
export interface Command {
  /** Node type discriminator */
  type: 'Command'
  /** Command name (null for assignment-only commands) */
  name: Word | null
  /** Variable assignments before the command */
  prefix: Assignment[]
  /** Command arguments */
  args: Word[]
  /** I/O redirections */
  redirects: Redirect[]
}

/**
 * A subshell - commands executed in a child shell.
 * Syntax: ( commands )
 */
export interface Subshell {
  /** Node type discriminator */
  type: 'Subshell'
  /** Commands executed in the subshell */
  body: BashNode[]
}

/**
 * A compound command such as if, for, while, case, etc.
 */
export interface CompoundCommand {
  /** Node type discriminator */
  type: 'CompoundCommand'
  /** Type of compound command */
  kind: 'if' | 'for' | 'while' | 'until' | 'case' | 'select' | 'brace' | 'arithmetic'
  /** Body of the compound command */
  body: BashNode[]
}

/**
 * A function definition.
 * Syntax: name() { body } or function name { body }
 */
export interface FunctionDef {
  /** Node type discriminator */
  type: 'FunctionDef'
  /** Function name */
  name: string
  /** Function body */
  body: BashNode
}

/**
 * A word in the shell grammar.
 * Can be a literal string, quoted string, or contain expansions.
 */
export interface Word {
  /** Node type discriminator */
  type: 'Word'
  /** The literal value of the word */
  value: string
  /** Quote style, if quoted */
  quoted?: 'single' | 'double' | 'ansi-c' | 'locale'
  /** Expansions within the word */
  expansions?: Expansion[]
}

/**
 * An expansion within a word (variable, command substitution, etc.).
 */
export interface Expansion {
  /** Type of expansion */
  type: 'ParameterExpansion' | 'CommandSubstitution' | 'ArithmeticExpansion' | 'ProcessSubstitution'
  /** Start position in the containing word */
  start: number
  /** End position in the containing word */
  end: number
  /** Content of the expansion (string or parsed AST) */
  content: string | BashNode[]
}

/**
 * An I/O redirection.
 * Examples: > file, >> file, < file, 2>&1
 */
export interface Redirect {
  /** Node type discriminator */
  type: 'Redirect'
  /** Redirection operator */
  op: '>' | '>>' | '<' | '<<' | '<<<' | '>&' | '<&' | '<>' | '>|'
  /** File descriptor (default: stdout for >, stdin for <) */
  fd?: number
  /** Target file or descriptor */
  target: Word
}

/**
 * A variable assignment.
 * Examples: VAR=value, VAR+=append
 */
export interface Assignment {
  /** Node type discriminator */
  type: 'Assignment'
  /** Variable name */
  name: string
  /** Assigned value (null for VAR= with no value) */
  value: Word | null
  /** Assignment operator */
  operator: '=' | '+='
}

/**
 * A parse error with location and optional fix suggestion.
 */
export interface ParseError {
  /** Error message */
  message: string
  /** Line number (1-based) */
  line: number
  /** Column number (1-based) */
  column: number
  /** Suggested fix, if available */
  suggestion?: string
}

// ============================================================================
// Intent Types
// ============================================================================

/**
 * Semantic intent extracted from a bash command.
 * Describes what the command intends to do in terms of file operations,
 * network access, and privilege requirements.
 *
 * @example
 * ```typescript
 * // Intent for: find . -name "*.ts" | xargs rm
 * const intent: Intent = {
 *   commands: ['find', 'xargs', 'rm'],
 *   reads: ['.'],
 *   writes: [],
 *   deletes: ['*.ts'],
 *   network: false,
 *   elevated: false
 * }
 * ```
 */
export interface Intent {
  /**
   * List of command names that will be executed.
   * Includes commands in pipelines and subshells.
   */
  commands: string[]

  /**
   * File paths or patterns that will be read.
   */
  reads: string[]

  /**
   * File paths or patterns that will be written/created.
   */
  writes: string[]

  /**
   * File paths or patterns that will be deleted.
   */
  deletes: string[]

  /**
   * Whether the command performs network operations.
   * True for commands like curl, wget, ssh, nc, etc.
   */
  network: boolean

  /**
   * Whether the command requires elevated privileges.
   * True for sudo, doas, or commands that modify system files.
   */
  elevated: boolean
}

// ============================================================================
// Fix Types
// ============================================================================

/**
 * A fix to apply to a bash command to correct syntax errors.
 * Used by the auto-fix system to repair broken commands.
 *
 * @example
 * ```typescript
 * // Fix for unclosed quote: echo "hello
 * const fix: Fix = {
 *   type: 'insert',
 *   position: 'end',
 *   value: '"',
 *   reason: 'Unclosed double quote'
 * }
 * ```
 */
export interface Fix {
  /**
   * Type of fix to apply.
   * - insert: Add characters at position
   * - replace: Replace characters at position
   * - delete: Remove characters at position
   */
  type: 'insert' | 'replace' | 'delete'

  /**
   * Position in the command to apply the fix.
   * Can be a character index, 'start', or 'end'.
   */
  position: number | 'start' | 'end'

  /**
   * Value to insert or use as replacement.
   * Not used for delete operations.
   */
  value?: string

  /**
   * Human-readable explanation of why this fix is needed.
   */
  reason: string
}

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
// Safety Classification Types
// ============================================================================

/**
 * Safety classification for a bash command.
 * Determines what type of operation the command performs and its potential impact.
 *
 * @example
 * ```typescript
 * const classification: SafetyClassification = {
 *   type: 'delete',
 *   impact: 'critical',
 *   reversible: false,
 *   reason: 'rm -rf with root path could delete entire filesystem'
 * }
 * ```
 */
export interface SafetyClassification {
  /**
   * Type of operation the command performs.
   * - read: Only reads data (ls, cat, find)
   * - write: Creates or modifies data (cp, mv, touch, echo >)
   * - delete: Removes data (rm, rmdir)
   * - execute: Runs other programs (exec, eval, source)
   * - network: Performs network operations (curl, wget, ssh)
   * - system: Modifies system state (chmod, chown, mount)
   * - mixed: Combination of multiple types
   */
  type: 'read' | 'write' | 'delete' | 'execute' | 'network' | 'system' | 'mixed'

  /**
   * Potential impact level of the command.
   * - none: No side effects (pwd, echo without redirect)
   * - low: Minor, easily reversible changes (touch, mkdir)
   * - medium: Significant but recoverable changes (cp, mv within project)
   * - high: Substantial changes that are difficult to reverse (rm, chmod)
   * - critical: Potentially catastrophic, irreversible changes (rm -rf /, dd)
   */
  impact: 'none' | 'low' | 'medium' | 'high' | 'critical'

  /**
   * Whether the operation can be undone.
   * Commands with undo capability will include undo scripts in results.
   */
  reversible: boolean

  /**
   * Human-readable explanation of the safety classification.
   */
  reason: string
}

/**
 * Alias for SafetyClassification for backwards compatibility.
 */
export type CommandClassification = SafetyClassification

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
   */
  analyze(input: string): { classification: SafetyClassification; intent: Intent }

  /**
   * Check if a command is dangerous.
   * Quick safety check without full analysis.
   *
   * @param input - The command to check
   * @returns Object indicating if dangerous and why
   */
  isDangerous(input: string): { dangerous: boolean; reason?: string }
}

// ============================================================================
// Filesystem Capability Types (for FsModule integration)
// ============================================================================

/**
 * Filesystem entry returned by list operations.
 */
export interface FsEntry {
  /** Entry name (file or directory name) */
  name: string
  /** Whether this entry is a directory */
  isDirectory: boolean
}

/**
 * File/directory statistics.
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
 */
export interface FsListOptions {
  /** Filter function for entries */
  filter?: (entry: FsEntry) => boolean
  /** Whether to list recursively */
  recursive?: boolean
  /** Pattern to match (glob-like) */
  pattern?: string
}

/**
 * Filesystem capability interface.
 * This is the interface that FsModule from dotdo implements.
 * BashModule can optionally use this for optimized file operations.
 *
 * When available, commands like `cat`, `head`, `tail` can be executed
 * natively via $.fs instead of spawning a subprocess.
 *
 * @example
 * ```typescript
 * // In a DO with both fs and bash capabilities
 * class MyDO extends withBash(withFs(DO), (instance) => ({
 *   execute: async (cmd, opts) => containerExecutor.run(cmd, opts)
 * })) {
 *   async readFile(path: string) {
 *     // This might use $.fs.read() internally for 'cat' commands
 *     return this.$.bash.exec('cat', [path])
 *   }
 * }
 * ```
 */
export interface FsCapability {
  /**
   * Read file content.
   */
  read(path: string, options?: FsReadOptions): Promise<string>

  /**
   * Check if a path exists.
   */
  exists(path: string): Promise<boolean>

  /**
   * List directory contents.
   */
  list(path: string, options?: FsListOptions): Promise<FsEntry[]>

  /**
   * Get file/directory statistics.
   */
  stat(path: string): Promise<FsStat>
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
