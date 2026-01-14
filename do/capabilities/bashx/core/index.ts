/**
 * @dotdo/bashx - Core Library
 *
 * Pure library for bash command parsing, classification, escaping, and safety analysis.
 * Zero Cloudflare dependencies - works in any JavaScript environment.
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { shellEscape, classifyInput, analyze, ShellBackend } from '@dotdo/bashx'
 *
 * // Escape values for shell interpolation
 * const file = 'my file.txt'
 * const escaped = shellEscape(file)  // => 'my file.txt'
 *
 * // Classify input as command or natural language
 * const result = await classifyInput('ls -la')
 * // { type: 'command', confidence: 0.95, ... }
 *
 * // Analyze AST for safety classification
 * const ast = { type: 'Program', body: [...] }
 * const { classification, intent } = analyze(ast)
 * ```
 */

// ============================================================================
// Type Exports
// ============================================================================

export type {
  // AST Types
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
  // Intent & Classification Types
  Intent,
  SafetyClassification,
  CommandClassification,
  SafetyAnalysis,
  DangerCheck,
  OperationType,
  ImpactLevel,
  Fix,
  // Multi-Language Types
  SupportedLanguage,
  LanguageContext,
} from './types.js'

// ============================================================================
// Backend Interface
// ============================================================================

/**
 * Abstract interface for shell execution backends.
 *
 * Platform-specific implementations (Node.js, Durable Objects, etc.)
 * should implement the {@link ShellBackend} interface.
 *
 * Note: {@link ShellResult} is exported from RPC types below.
 *
 * @example
 * ```typescript
 * import type { ShellBackend, ShellOptions, BackendInfo } from '@dotdo/bashx'
 *
 * class MyBackend implements ShellBackend {
 *   async execute(command: string, options?: ShellOptions) {
 *     // Platform-specific execution
 *     return { exitCode: 0, stdout: '...', stderr: '', success: true }
 *   }
 *   async isReady() { return true }
 *   async getInfo(): Promise<BackendInfo> { ... }
 * }
 * ```
 */
export type {
  ShellBackend,
  ShellOptions,
  BackendInfo,
} from './backend.js'

// ============================================================================
// Escape Utilities
// ============================================================================

/**
 * Shell escaping utilities for safe command interpolation.
 *
 * - {@link shellEscape} - Escape multiple arguments and join with spaces
 * - {@link shellEscapeArg} - Escape a single argument for safe shell use
 * - {@link createShellTemplate} - Create a tagged template with escaping options
 * - {@link rawTemplate} - Tagged template WITHOUT escaping (use with caution)
 * - {@link safeTemplate} - Tagged template WITH escaping (recommended)
 *
 * @example
 * ```typescript
 * import { shellEscape, safeTemplate } from '@dotdo/bashx'
 *
 * // Escape arguments
 * shellEscape('cat', 'my file.txt')  // => "cat 'my file.txt'"
 *
 * // Safe template literals
 * const file = 'untrusted; rm -rf /'
 * safeTemplate`cat ${file}`  // => "cat 'untrusted; rm -rf /'"
 * ```
 */
export {
  shellEscape,
  shellEscapeArg,
  createShellTemplate,
  rawTemplate,
  safeTemplate,
} from './escape/index.js'

// ============================================================================
// Classification
// ============================================================================

/**
 * Input classification to distinguish commands from natural language.
 *
 * {@link classifyInput} analyzes user input and determines whether it's:
 * - A valid bash command
 * - Natural language intent
 * - Invalid/empty input
 *
 * @example
 * ```typescript
 * import { classifyInput } from '@dotdo/bashx'
 *
 * const cmd = await classifyInput('ls -la')
 * // { type: 'command', confidence: 0.95, ... }
 *
 * const intent = await classifyInput('show me all files')
 * // { type: 'intent', confidence: 0.9, suggestedCommand: 'ls -la', ... }
 * ```
 */
export {
  classifyInput,
} from './classify/index.js'

export type {
  InputClassification,
  ClassificationAlternative,
} from './classify/index.js'

// ============================================================================
// Language Detection & Routing
// ============================================================================

/**
 * Language detection and routing for multi-language shell support.
 *
 * **Language Detection:**
 * - {@link detectLanguage} - Detect programming language from input
 *
 * **Language Routing:**
 * - {@link LanguageRouter} - Unified facade for language detection and worker routing
 *
 * The LanguageRouter combines language detection with worker availability
 * to determine optimal execution paths (polyglot vs sandbox).
 *
 * @example
 * ```typescript
 * import { LanguageRouter, detectLanguage } from '@dotdo/bashx'
 *
 * // Direct language detection
 * const detection = detectLanguage('python3 script.py')
 * // { language: 'python', method: 'interpreter', confidence: 0.90, ... }
 *
 * // Unified routing with worker availability
 * const router = new LanguageRouter()
 * const result = router.route('pip install requests', ['python', 'node'])
 * // { language: 'python', routeTo: 'polyglot', worker: 'python', packageManager: 'pip' }
 *
 * // Package manager detection
 * LanguageRouter.isPackageManager('pip')   // true
 * LanguageRouter.isPackageManager('ls')    // false
 * ```
 */
export {
  detectLanguage,
} from './classify/language-detector.js'

export type {
  // SupportedLanguage is already exported from './types.js'
  DetectionMethod,
  LanguageDetectionResult,
  LanguageDetectionDetails,
} from './classify/language-detector.js'

export {
  LanguageRouter,
} from './classify/language-router.js'

export type {
  RoutingResult,
  RoutingDestination,
} from './classify/language-router.js'

// ============================================================================
// AST Utilities
// ============================================================================

/**
 * AST utilities for working with bash command structures.
 *
 * **Type Guards:**
 * - {@link isProgram}, {@link isCommand}, {@link isPipeline}, {@link isList}
 * - {@link isWord}, {@link isRedirect}, {@link isAssignment}
 * - {@link isSubshell}, {@link isCompoundCommand}, {@link isFunctionDef}
 * - {@link isExpansion}, {@link isBashNode}, {@link getNodeType}
 *
 * **Factory Functions:**
 * - {@link createProgram} - Create a Program (root) AST node
 * - {@link createCommand} - Create a Command node
 * - {@link createPipeline} - Create a Pipeline node
 * - {@link createList} - Create a List (&&, ||, ;, &) node
 * - {@link createWord}, {@link createRedirect}, {@link createAssignment}
 *
 * **Serialization:**
 * - {@link serializeAST} - Convert AST to JSON string
 * - {@link deserializeAST} - Parse JSON string to AST
 *
 * @example
 * ```typescript
 * import { createProgram, createCommand, isCommand } from '@dotdo/bashx'
 *
 * // Create AST programmatically
 * const ast = createProgram([
 *   createCommand('git', ['status']),
 *   createCommand('git', ['diff']),
 * ])
 *
 * // Type-safe traversal
 * for (const node of ast.body) {
 *   if (isCommand(node)) {
 *     console.log('Command:', node.name?.value)
 *   }
 * }
 * ```
 */
export {
  // Type guards
  isProgram,
  isCommand,
  isPipeline,
  isList,
  isWord,
  isRedirect,
  isAssignment,
  isSubshell,
  isCompoundCommand,
  isFunctionDef,
  isExpansion,
  isBashNode,
  getNodeType,
  // Factory functions
  createProgram,
  createCommand,
  createPipeline,
  createList,
  createWord,
  createRedirect,
  createAssignment,
  // Serialization
  serializeAST,
  deserializeAST,
  // Constants
  NodeType,
  NODE_TYPES,
} from './ast/index.js'

// ============================================================================
// Safety Analysis
// ============================================================================

/**
 * Safety analysis for bash commands using structural AST analysis.
 *
 * **Primary Functions:**
 * - {@link analyze} - Analyze AST for safety classification and intent
 * - {@link isDangerous} - Check if a command is dangerous
 * - {@link classifyCommand} - Classify a single command by name and args
 *
 * **Intent Extraction:**
 * - {@link extractIntent} - Extract semantic intent from Command nodes
 * - {@link extractIntentFromAST} - Extract extended intent from Program AST
 * - {@link describeIntent} - Generate human-readable description
 *
 * @example
 * ```typescript
 * import { analyze, isDangerous, classifyCommand } from '@dotdo/bashx'
 *
 * // Classify a single command
 * classifyCommand('rm', ['-rf', '/'])
 * // { type: 'delete', impact: 'critical', reversible: false, ... }
 *
 * // Analyze full AST
 * const { classification, intent } = analyze(ast)
 *
 * // Quick danger check
 * const { dangerous, reason } = isDangerous(ast)
 * ```
 */
export {
  analyze,
  isDangerous,
  classifyCommand,
  extractIntent,
  extractIntentFromAST,
  describeIntent,
} from './safety/index.js'

export type { ExtendedIntent } from './safety/index.js'

// ============================================================================
// PTY Emulation (Virtual Terminal)
// ============================================================================

/**
 * Virtual terminal (PTY) emulation with ANSI sequence parsing.
 *
 * - {@link VirtualPTY} - Full virtual terminal emulator
 * - {@link ANSIParser} - ANSI escape sequence parser
 * - {@link TerminalBuffer} - Screen buffer management
 *
 * @example
 * ```typescript
 * import { VirtualPTY } from '@dotdo/bashx'
 *
 * const pty = new VirtualPTY({ rows: 24, cols: 80 })
 *
 * // Write data (handles ANSI sequences)
 * pty.write('Hello, World!\r\n')
 * pty.write('\x1b[31mRed text\x1b[0m')
 *
 * // Get screen content
 * const screen = pty.getScreen()
 * ```
 */
export {
  VirtualPTY,
  ANSIParser,
  TerminalBuffer,
  createDefaultAttributes,
  createEmptyCell,
  createDefaultCursor,
} from './pty/index.js'

export type {
  // Core configuration
  VirtualPTYOptions,
  PTYInfo,
  // Screen buffer types
  ScreenBuffer,
  Cell,
  CellAttributes,
  CursorState,
  Color,
  ColorCode,
  RGBColor,
  // Parser types
  ParserState,
  ParsedSequence,
  // Event types
  PTYEvent,
  ScreenChangeEvent,
  BellEvent,
  TitleChangeEvent,
  // Callback types
  DataCallback,
  ScreenChangeCallback,
  SequenceCallback,
  EventCallback,
} from './pty/index.js'

// ============================================================================
// RPC Types (Remote Shell Execution)
// ============================================================================

/**
 * Types for remote shell execution via RPC.
 *
 * These types define the interface for executing shell commands
 * across process boundaries or network connections.
 */
export type {
  ShellResult,
  ShellExecOptions,
  ShellSpawnOptions,
  ShellStream,
  ShellApi,
  ShellDataCallback,
  ShellExitCallback,
} from './rpc/index.js'
