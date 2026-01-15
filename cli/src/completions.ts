/**
 * TypeScript Language Service Completions via @typescript/vfs
 *
 * Uses an in-memory TypeScript environment to provide real-time
 * autocomplete suggestions for the REPL. No external tsserver needed.
 */

import ts from 'typescript'

/**
 * Completion item returned by the completion engine
 */
export interface CompletionItem {
  /** The text to insert */
  name: string
  /** Kind of completion (method, property, variable, etc.) */
  kind: ts.ScriptElementKind
  /** Optional documentation */
  documentation?: string
  /** Sort priority (lower = higher priority) */
  sortText: string
  /** Is this a method that should add parentheses? */
  isMethod?: boolean
  /** Parameter info for methods */
  parameters?: string
  /** Return type */
  returnType?: string
}

/**
 * Completion context for the current cursor position
 */
export interface CompletionContext {
  /** Trigger character (e.g., '.') */
  triggerCharacter?: string
  /** Whether completion was explicitly requested */
  isExplicit: boolean
  /** Current word being typed */
  currentWord: string
  /** Position info */
  line: number
  column: number
}

/**
 * TypeScript Virtual File System Completion Engine
 *
 * Creates an in-memory TypeScript environment that provides
 * IDE-quality completions without requiring file system access.
 */
export class CompletionEngine {
  private languageService: ts.LanguageService
  private files: Map<string, { content: string; version: number }>
  private compilerOptions: ts.CompilerOptions

  constructor(rpcTypeDefinitions?: string) {
    this.files = new Map()
    this.compilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts'],
      strict: true,
      allowJs: true,
      checkJs: false,
      esModuleInterop: true,
      skipLibCheck: true,
    }

    // Initialize with base type definitions
    this.initializeBaseTypes(rpcTypeDefinitions)

    // Create the language service
    this.languageService = this.createLanguageService()
  }

  /**
   * Initialize base type definitions for the REPL environment
   */
  private initializeBaseTypes(rpcTypeDefinitions?: string): void {
    // Core REPL context types
    const coreTypes = `
declare const $: DotdoContext;

/**
 * Standard CRUD methods available on all nouns
 */
interface NounProxy<T = Thing> {
  /** Get entity by ID */
  get(id: string): Promise<T>;
  /** List all entities */
  list(): Promise<T[]>;
  /** Create new entity */
  create(data: Partial<T>): Promise<T>;
  /** Update entity by ID */
  update(id: string, data: Partial<T>): Promise<T>;
  /** Delete entity by ID */
  delete(id: string): Promise<void>;
  /** Query entities */
  query(filter: Record<string, unknown>): Promise<T[]>;
  /** Count entities */
  count(): Promise<number>;
  /** Index signature for other dynamic methods */
  [method: string]: (...args: unknown[]) => Promise<unknown>;
}

/**
 * Event handler verbs available on each noun
 */
interface EventVerbProxy {
  /** Handle entity created */
  created: (handler: (event: Event) => void | Promise<void>) => void;
  /** Handle entity updated */
  updated: (handler: (event: Event) => void | Promise<void>) => void;
  /** Handle entity deleted */
  deleted: (handler: (event: Event) => void | Promise<void>) => void;
  /** Handle custom verbs */
  [verb: string]: (handler: (event: Event) => void | Promise<void>) => void;
}

/** Version reference - supports multiple formats:
 * - @v1234 (version number)
 * - @~1 (relative, one version back)
 * - @2024-01-15 (ISO timestamp)
 * - @branch-name (branch reference)
 */
type VersionRef = string;

interface DotdoContext {
  /** Send a fire-and-forget event */
  send(event: Event): void;
  /** Try an action (single attempt) */
  try<T>(action: () => T | Promise<T>): Promise<T>;
  /** Execute action with retries */
  do<T>(action: () => T | Promise<T>): Promise<T>;
  /** Event handlers with Noun.verb pattern */
  on: EventHandlerProxy;
  /** Scheduling DSL */
  every: ScheduleBuilder;
  /** Checkout a specific version or time (time travel) */
  checkout(ref: VersionRef): Promise<void>;
  /** Create a new branch from current state */
  branch(name: string): Promise<string>;
  /** Merge changes from one branch to another */
  merge(source: string, target?: string): Promise<void>;
  /** Common nouns */
  Customer: NounProxy;
  Order: NounProxy;
  Thing: NounProxy;
  User: NounProxy;
  Product: NounProxy;
  Account: NounProxy;
  /** Cross-DO RPC for any noun */
  [doName: string]: NounProxy | ((...args: unknown[]) => DOProxy);
}

interface EventHandlerProxy {
  /** Customer event handlers */
  Customer: EventVerbProxy;
  /** Order event handlers */
  Order: EventVerbProxy;
  /** Thing event handlers */
  Thing: EventVerbProxy;
  /** User event handlers */
  User: EventVerbProxy;
  /** Product event handlers */
  Product: EventVerbProxy;
  /** Account event handlers */
  Account: EventVerbProxy;
  /** Any noun event handlers */
  [noun: string]: EventVerbProxy;
}

interface ScheduleBuilder {
  Monday: ScheduleBuilder;
  Tuesday: ScheduleBuilder;
  Wednesday: ScheduleBuilder;
  Thursday: ScheduleBuilder;
  Friday: ScheduleBuilder;
  Saturday: ScheduleBuilder;
  Sunday: ScheduleBuilder;
  day: ScheduleBuilder;
  hour: (handler: () => void) => void;
  at9am: (handler: () => void) => void;
  at(time: string): (handler: () => void) => void;
}

interface DOProxy {
  [method: string]: (...args: unknown[]) => Promise<unknown>;
}

interface Event {
  $type: string;
  $id?: string;
  [key: string]: unknown;
}

interface Thing {
  $type: string;
  $id: string;
  [key: string]: unknown;
}

/** Console for REPL output */
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  table(data: unknown): void;
};
`

    this.files.set('/lib/core.d.ts', { content: coreTypes, version: 1 })

    // Add RPC types if provided
    if (rpcTypeDefinitions) {
      this.files.set('/lib/rpc-types.d.ts', { content: rpcTypeDefinitions, version: 1 })
    }

    // Initialize flat namespace globals (utilities + nouns from RPC types)
    this.updateGlobalNamespace(rpcTypeDefinitions)

    // Initialize the REPL file
    this.files.set('/repl.ts', { content: '', version: 1 })
  }

  /**
   * Generate and update flat namespace global declarations
   * This makes nouns (Customer, Order) and utilities (on, every, send) available
   * at the top level without the $. prefix.
   */
  private updateGlobalNamespace(rpcTypeDefinitions?: string): void {
    // Base utilities that mirror $ properties
    const baseGlobals = `
// Flat namespace - utilities available without $ prefix
/** Send a fire-and-forget event */
declare const send: typeof $.send;
/** Event handlers with Noun.verb pattern */
declare const on: typeof $.on;
/** Scheduling DSL */
declare const every: typeof $.every;
/** Try an action (single attempt) - use bracket notation since 'try' is reserved */
declare const tryAction: typeof $['try'];
/** Execute action with retries - use bracket notation since 'do' is reserved */
declare const doAction: typeof $['do'];
/** Checkout a specific version or time (time travel) */
declare const checkout: typeof $.checkout;
/** Create a new branch from current state */
declare const branch: typeof $.branch;
/** Merge changes from one branch to another */
declare const merge: typeof $.merge;

// Flat namespace - Common nouns available without $ prefix
/** Customer entity methods */
declare const Customer: typeof $.Customer;
/** Order entity methods */
declare const Order: typeof $.Order;
/** Thing entity methods */
declare const Thing: typeof $.Thing;
/** User entity methods */
declare const User: typeof $.User;
/** Product entity methods */
declare const Product: typeof $.Product;
/** Account entity methods */
declare const Account: typeof $.Account;
`

    // Extract additional nouns from RPC type definitions
    const nounDeclarations = this.extractNounDeclarations(rpcTypeDefinitions)

    const globalTypes = baseGlobals + nounDeclarations

    const existing = this.files.get('/lib/globals.d.ts')
    if (existing) {
      existing.content = globalTypes
      existing.version++
    } else {
      this.files.set('/lib/globals.d.ts', { content: globalTypes, version: 1 })
    }
  }

  /**
   * Extract noun declarations from RPC type definitions
   * Looks for patterns like "Customer: CustomerMethods" in DotdoContext extensions
   */
  private extractNounDeclarations(rpcTypeDefinitions?: string): string {
    if (!rpcTypeDefinitions) return ''

    const declarations: string[] = []

    // Look for interface extensions that add nouns to DotdoContext
    // Pattern: Customer: CustomerMethods or Order: OrderMethods
    const contextExtensionMatch = rpcTypeDefinitions.match(
      /declare\s+interface\s+DotdoContext\s*\{([^}]+)\}/
    )

    if (contextExtensionMatch) {
      const contextBody = contextExtensionMatch[1]
      // Match "NounName: NounMethods" patterns (capitalized names)
      const nounPattern = /(\w+):\s*(\w+Methods)/g
      let match
      while ((match = nounPattern.exec(contextBody)) !== null) {
        const [, nounName, methodsType] = match
        // Only include if it starts with uppercase (is a Noun)
        if (/^[A-Z]/.test(nounName)) {
          declarations.push(`/** ${nounName} entity methods */`)
          declarations.push(`declare const ${nounName}: ${methodsType};`)
        }
      }
    }

    return declarations.length > 0 ? '\n// Flat namespace - Nouns available without $ prefix\n' + declarations.join('\n') : ''
  }

  /**
   * Create the TypeScript language service
   */
  private createLanguageService(): ts.LanguageService {
    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => Array.from(this.files.keys()),
      getScriptVersion: (fileName) => {
        const file = this.files.get(fileName)
        return file ? String(file.version) : '0'
      },
      getScriptSnapshot: (fileName) => {
        const file = this.files.get(fileName)
        if (file) {
          return ts.ScriptSnapshot.fromString(file.content)
        }
        // Try to load from TypeScript lib
        if (fileName.includes('lib.') && fileName.endsWith('.d.ts')) {
          const libPath = require.resolve(`typescript/lib/${fileName.split('/').pop()}`)
          try {
            const fs = require('fs')
            const content = fs.readFileSync(libPath, 'utf8')
            return ts.ScriptSnapshot.fromString(content)
          } catch {
            return undefined
          }
        }
        return undefined
      },
      getCurrentDirectory: () => '/',
      getCompilationSettings: () => this.compilerOptions,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (fileName) => this.files.has(fileName),
      readFile: (fileName) => this.files.get(fileName)?.content,
      readDirectory: () => [],
      directoryExists: () => true,
      getDirectories: () => [],
    }

    return ts.createLanguageService(host, ts.createDocumentRegistry())
  }

  /**
   * Update the REPL content and get completions at cursor position
   */
  updateReplContent(content: string): void {
    const file = this.files.get('/repl.ts')!
    file.content = content
    file.version++
  }

  /**
   * Add or update type definitions (e.g., from RPC schema)
   */
  updateTypeDefinitions(name: string, content: string): void {
    const fileName = `/lib/${name}.d.ts`
    const existing = this.files.get(fileName)
    if (existing) {
      existing.content = content
      existing.version++
    } else {
      this.files.set(fileName, { content, version: 1 })
    }

    // Update global namespace to include any new nouns from this type definition
    this.updateGlobalNamespaceFromAllSources()
  }

  /**
   * Rebuild global namespace from all type definition sources
   */
  private updateGlobalNamespaceFromAllSources(): void {
    // Collect all RPC type definitions
    let combinedRpcTypes = ''
    for (const [fileName, file] of this.files) {
      if (fileName.startsWith('/lib/') && fileName !== '/lib/core.d.ts' && fileName !== '/lib/globals.d.ts') {
        combinedRpcTypes += file.content + '\n'
      }
    }

    this.updateGlobalNamespace(combinedRpcTypes || undefined)
  }

  /**
   * Get completions at a specific position in the REPL
   */
  getCompletions(content: string, cursorPosition: number): CompletionItem[] {
    // Update REPL content
    this.updateReplContent(content)

    // Get completions from language service
    const completions = this.languageService.getCompletionsAtPosition(
      '/repl.ts',
      cursorPosition,
      {
        includeCompletionsForModuleExports: true,
        includeCompletionsWithInsertText: true,
        includeAutomaticOptionalChainCompletions: true,
      }
    )

    if (!completions) {
      return []
    }

    // Map to our completion items
    return completions.entries.map((entry) => {
      const details = this.languageService.getCompletionEntryDetails(
        '/repl.ts',
        cursorPosition,
        entry.name,
        undefined,
        undefined,
        undefined,
        undefined
      )

      const item: CompletionItem = {
        name: entry.name,
        kind: entry.kind,
        sortText: entry.sortText,
        isMethod: entry.kind === ts.ScriptElementKind.functionElement ||
                  entry.kind === ts.ScriptElementKind.memberFunctionElement,
      }

      if (details) {
        item.documentation = ts.displayPartsToString(details.documentation)

        // Extract signature info for methods
        if (details.displayParts) {
          const signature = ts.displayPartsToString(details.displayParts)
          // Parse out parameters and return type
          const match = signature.match(/\(([^)]*)\)(?:\s*:\s*(.+))?/)
          if (match) {
            item.parameters = match[1] || ''
            item.returnType = match[2]?.trim()
          }
        }
      }

      return item
    })
  }

  /**
   * Get quick info (hover) at a position
   */
  getQuickInfo(content: string, cursorPosition: number): string | undefined {
    this.updateReplContent(content)

    const info = this.languageService.getQuickInfoAtPosition('/repl.ts', cursorPosition)
    if (!info) return undefined

    const displayString = ts.displayPartsToString(info.displayParts)
    const documentation = info.documentation ? ts.displayPartsToString(info.documentation) : ''

    return documentation ? `${displayString}\n\n${documentation}` : displayString
  }

  /**
   * Get diagnostics for the current content
   */
  getDiagnostics(content: string): ts.Diagnostic[] {
    this.updateReplContent(content)

    const syntactic = this.languageService.getSyntacticDiagnostics('/repl.ts')
    const semantic = this.languageService.getSemanticDiagnostics('/repl.ts')

    return [...syntactic, ...semantic]
  }

  /**
   * Get signature help for function calls
   */
  getSignatureHelp(content: string, cursorPosition: number): ts.SignatureHelpItems | undefined {
    this.updateReplContent(content)
    return this.languageService.getSignatureHelpItems('/repl.ts', cursorPosition, undefined)
  }

  /**
   * Format diagnostic messages for display
   */
  formatDiagnostic(diagnostic: ts.Diagnostic): string {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      return `Line ${line + 1}, Col ${character + 1}: ${message}`
    }
    return message
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.languageService.dispose()
    this.files.clear()
  }
}

/**
 * Filter and sort completions based on context
 */
export function filterCompletions(
  completions: CompletionItem[],
  context: CompletionContext
): CompletionItem[] {
  let filtered = completions

  // Filter by current word prefix
  if (context.currentWord) {
    const prefix = context.currentWord.toLowerCase()
    filtered = completions.filter((c) =>
      c.name.toLowerCase().startsWith(prefix)
    )
  }

  // Sort by relevance
  return filtered.sort((a, b) => {
    // Exact prefix matches first
    const aStartsWith = a.name.toLowerCase().startsWith(context.currentWord.toLowerCase())
    const bStartsWith = b.name.toLowerCase().startsWith(context.currentWord.toLowerCase())
    if (aStartsWith && !bStartsWith) return -1
    if (!aStartsWith && bStartsWith) return 1

    // Then by sortText
    return a.sortText.localeCompare(b.sortText)
  })
}

/**
 * Get the word at cursor position
 */
export function getWordAtCursor(content: string, position: number): { word: string; start: number; end: number } {
  // Find word boundaries
  let start = position
  let end = position

  // Move start back to find word beginning
  while (start > 0 && /[\w$]/.test(content[start - 1])) {
    start--
  }

  // Move end forward to find word end
  while (end < content.length && /[\w$]/.test(content[end])) {
    end++
  }

  return {
    word: content.slice(start, end),
    start,
    end,
  }
}

/**
 * Check if position is inside a string literal (single, double, or template)
 */
function isInsideString(content: string, position: number): boolean {
  let inSingle = false
  let inDouble = false
  let inTemplate = false

  for (let i = 0; i < position; i++) {
    const char = content[i]
    const prevChar = i > 0 ? content[i - 1] : ''

    // Skip escaped characters
    if (prevChar === '\\') continue

    if (char === "'" && !inDouble && !inTemplate) {
      inSingle = !inSingle
    } else if (char === '"' && !inSingle && !inTemplate) {
      inDouble = !inDouble
    } else if (char === '`' && !inSingle && !inDouble) {
      inTemplate = !inTemplate
    }
  }

  return inSingle || inDouble || inTemplate
}

/**
 * Check if the dot is after a number literal (e.g., "123.")
 */
function isNumberLiteral(content: string, position: number): boolean {
  // Find the dot position (should be at position - 1 since position is after the dot)
  const dotIndex = position - 1
  if (dotIndex < 0 || content[dotIndex] !== '.') return false

  // Check if character before dot is a digit
  const charBeforeDot = dotIndex > 0 ? content[dotIndex - 1] : ''
  return /\d/.test(charBeforeDot)
}

/**
 * Check if position is inside a single-line comment
 */
function isInsideComment(content: string, position: number): boolean {
  // Find the start of the current line
  let lineStart = content.lastIndexOf('\n', position - 1)
  if (lineStart === -1) lineStart = 0
  else lineStart++

  // Get content from line start to position
  const lineContent = content.slice(lineStart, position)

  // Check for // comment (not inside a string)
  let inString = false
  let stringChar = ''
  for (let i = 0; i < lineContent.length - 1; i++) {
    const char = lineContent[i]
    const prevChar = i > 0 ? lineContent[i - 1] : ''

    // Skip escaped characters
    if (prevChar === '\\') continue

    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true
      stringChar = char
    } else if (inString && char === stringChar) {
      inString = false
    } else if (!inString && char === '/' && lineContent[i + 1] === '/') {
      return true
    }
  }

  return false
}

/**
 * Check if the dots form a spread operator (...)
 */
function isSpreadOperator(content: string, position: number): boolean {
  // Position is after the dot (cursor position), so the last dot is at position - 1
  // For content "..." with position 4, we need to check indices 0, 1, 2
  // For content "..." with position 3, we need to check indices 0, 1, 2

  // Find where the potential third dot would be
  // If position is beyond content length, the last character is at content.length - 1
  const lastDotIndex = Math.min(position - 1, content.length - 1)
  if (lastDotIndex < 2) return false

  return (
    content[lastDotIndex] === '.' &&
    content[lastDotIndex - 1] === '.' &&
    content[lastDotIndex - 2] === '.'
  )
}

/**
 * Determine if we should show completions
 */
export function shouldShowCompletions(
  content: string,
  positionOrContext: number | CompletionContext,
  triggerChar?: string
): boolean {
  // Handle both signatures: (content, position, triggerChar?) or (content, context)
  let position: number
  let trigger: string | undefined

  if (typeof positionOrContext === 'object') {
    position = positionOrContext.column
    trigger = positionOrContext.triggerCharacter
  } else {
    position = positionOrContext
    trigger = triggerChar
  }

  // Handle dot trigger with context checks
  if (trigger === '.') {
    // Don't trigger inside strings
    if (isInsideString(content, position)) return false

    // Don't trigger inside comments
    if (isInsideComment(content, position)) return false

    // Don't trigger for spread operator
    if (isSpreadOperator(content, position)) return false

    // Don't trigger after number literal
    if (isNumberLiteral(content, position)) return false

    return true
  }

  // Show on explicit request (Ctrl+Space)
  if (trigger === undefined) return true

  // Check if we're in a word
  const { word } = getWordAtCursor(content, position)
  return word.length >= 1
}
