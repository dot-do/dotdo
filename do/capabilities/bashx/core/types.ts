/**
 * Core Type Definitions for @dotdo/bashx
 *
 * Platform-agnostic types for bash command parsing, classification,
 * escaping, and safety analysis. Zero Cloudflare dependencies.
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

  // -------------------------------------------------------------------------
  // Multi-Language Extensions (optional fields for backward compatibility)
  // -------------------------------------------------------------------------

  /**
   * Programming languages detected in the command.
   * Present when the command invokes interpreters other than bash.
   * @optional
   */
  languages?: SupportedLanguage[]

  /**
   * Whether the command contains inline code (e.g., python -c "...").
   * @optional
   */
  inlineCode?: boolean

  /**
   * Script files targeted by the command (e.g., ['script.py', 'main.go']).
   * @optional
   */
  targetScripts?: string[]
}

// ============================================================================
// Safety Classification Types
// ============================================================================

/**
 * Safety classification for a bash command.
 * Determines what type of operation the command performs and its potential impact.
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

  /**
   * Suggested safer alternative command or approach.
   * Optional field to provide guidance when blocking or warning.
   */
  suggestion?: string
}

/**
 * Alias for SafetyClassification for backwards compatibility.
 */
export type CommandClassification = SafetyClassification

/**
 * Operation type classification.
 * Describes the primary category of operation a command performs.
 */
export type OperationType = SafetyClassification['type']

/**
 * Impact level classification.
 * Describes the potential impact of executing a command.
 */
export type ImpactLevel = SafetyClassification['impact']

/**
 * Safety analysis result combining classification and intent.
 */
export interface SafetyAnalysis {
  /** Safety classification of the command */
  classification: SafetyClassification
  /** Semantic intent extracted from the command */
  intent: Intent
}

/**
 * Danger check result.
 */
export interface DangerCheck {
  /** Whether the command is considered dangerous */
  dangerous: boolean
  /** Explanation of why the command is dangerous, if applicable */
  reason?: string
}

// ============================================================================
// Fix Types
// ============================================================================

/**
 * A fix to apply to a bash command to correct syntax errors.
 * Used by the auto-fix system to repair broken commands.
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
// Multi-Language Types
// ============================================================================

/**
 * Supported programming languages for multi-language execution.
 * - bash: Default shell language (POSIX-compatible)
 * - python: Python interpreter (python, python3)
 * - ruby: Ruby interpreter
 * - node: Node.js JavaScript runtime
 * - go: Go language (via go run)
 * - rust: Rust language (via cargo run)
 */
export type SupportedLanguage = 'bash' | 'python' | 'ruby' | 'node' | 'go' | 'rust'

/**
 * Context information about detected language.
 * Provides details about how the language was detected and execution context.
 */
export interface LanguageContext {
  /**
   * The detected programming language.
   */
  language: SupportedLanguage

  /**
   * Confidence score between 0 and 1.
   * Higher values indicate more certainty.
   */
  confidence: number

  /**
   * Detection method used to identify the language.
   * - shebang: Detected from #! line (highest confidence)
   * - interpreter: Detected from interpreter command (e.g., python script.py)
   * - extension: Detected from file extension (e.g., .py, .rb)
   * - syntax: Detected from syntax patterns (lowest confidence)
   * - default: Defaulted to bash when no patterns match
   */
  method: 'shebang' | 'interpreter' | 'extension' | 'syntax' | 'default'

  /**
   * Runtime version if detectable (e.g., 'python3', 'node18').
   */
  runtime?: string

  /**
   * True if the code is inline (using -c, -e, --eval flags).
   */
  inline?: boolean

  /**
   * Target file if detected from command.
   */
  file?: string
}
