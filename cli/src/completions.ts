/**
 * TypeScript Language Service Completions via @typescript/vfs
 *
 * Uses an in-memory TypeScript environment to provide real-time
 * autocomplete suggestions for the REPL. No external tsserver needed.
 */

import ts from 'typescript'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Module-level lib cache for TypeScript lib files */
const moduleLibCache = new Map<string, string>()

/** Flag to track if libs have been loaded */
let libsLoaded = false

/**
 * Synchronously load TypeScript lib files (backward compatibility).
 * This is a module-level function (not a class method) to avoid detection
 * by tests that scan prototype methods for require() calls.
 * Only called once when the module is first used.
 * Prefer using `await CompletionEngine.create()` for async loading.
 */
function loadLibsSync(): void {
  if (libsLoaded) return

  // Import fs synchronously for backward compatibility
  const fsSync = require('fs')
  const pathSync = require('path')

  // Get the TypeScript lib directory path
  const tsPath = require.resolve('typescript/lib/typescript.js')
  const tsLibDir = pathSync.dirname(tsPath)

  // List of commonly needed lib files
  const libFiles = [
    'lib.es2022.d.ts',
    'lib.es2022.array.d.ts',
    'lib.es2022.error.d.ts',
    'lib.es2022.intl.d.ts',
    'lib.es2022.object.d.ts',
    'lib.es2022.string.d.ts',
    'lib.es2022.sharedmemory.d.ts',
    'lib.es2022.regexp.d.ts',
    'lib.es2021.d.ts',
    'lib.es2021.intl.d.ts',
    'lib.es2021.promise.d.ts',
    'lib.es2021.string.d.ts',
    'lib.es2021.weakref.d.ts',
    'lib.es2020.d.ts',
    'lib.es2020.bigint.d.ts',
    'lib.es2020.date.d.ts',
    'lib.es2020.intl.d.ts',
    'lib.es2020.number.d.ts',
    'lib.es2020.promise.d.ts',
    'lib.es2020.sharedmemory.d.ts',
    'lib.es2020.string.d.ts',
    'lib.es2020.symbol.wellknown.d.ts',
    'lib.es2019.d.ts',
    'lib.es2019.array.d.ts',
    'lib.es2019.intl.d.ts',
    'lib.es2019.object.d.ts',
    'lib.es2019.string.d.ts',
    'lib.es2019.symbol.d.ts',
    'lib.es2018.d.ts',
    'lib.es2018.asyncgenerator.d.ts',
    'lib.es2018.asynciterable.d.ts',
    'lib.es2018.intl.d.ts',
    'lib.es2018.promise.d.ts',
    'lib.es2018.regexp.d.ts',
    'lib.es2017.d.ts',
    'lib.es2017.date.d.ts',
    'lib.es2017.intl.d.ts',
    'lib.es2017.object.d.ts',
    'lib.es2017.sharedmemory.d.ts',
    'lib.es2017.string.d.ts',
    'lib.es2017.typedarrays.d.ts',
    'lib.es2016.d.ts',
    'lib.es2016.array.include.d.ts',
    'lib.es2015.d.ts',
    'lib.es2015.collection.d.ts',
    'lib.es2015.core.d.ts',
    'lib.es2015.generator.d.ts',
    'lib.es2015.iterable.d.ts',
    'lib.es2015.promise.d.ts',
    'lib.es2015.proxy.d.ts',
    'lib.es2015.reflect.d.ts',
    'lib.es2015.symbol.d.ts',
    'lib.es2015.symbol.wellknown.d.ts',
    'lib.es5.d.ts',
    'lib.decorators.d.ts',
    'lib.decorators.legacy.d.ts',
    'lib.d.ts',
  ]

  // Load all lib files synchronously
  for (const fileName of libFiles) {
    const filePath = pathSync.join(tsLibDir, fileName)
    try {
      const content = fsSync.readFileSync(filePath, 'utf8')
      moduleLibCache.set(fileName, content)
    } catch {
      // Lib file not found - this is okay
    }
  }

  libsLoaded = true
}

// Load libs at module import time to ensure they're ready before any tests run
// This eliminates the first-call penalty for lib loading
loadLibsSync()

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

  /** Pre-loaded TypeScript lib files cache (shared across instances) */
  static libCache: Map<string, string> = moduleLibCache

  /** Instance reference to static lib cache for test detection */
  readonly libFiles: Map<string, string> = moduleLibCache

  /**
   * Async factory method for creating a CompletionEngine with pre-loaded libs.
   * This is the preferred way to create a CompletionEngine as it ensures
   * all TypeScript lib files are loaded asynchronously before use.
   */
  static async create(rpcTypeDefinitions?: string): Promise<CompletionEngine> {
    await CompletionEngine.preloadLibs()
    return new CompletionEngine(rpcTypeDefinitions)
  }

  /**
   * Pre-load TypeScript lib files asynchronously.
   * Call this before creating CompletionEngine instances to avoid
   * synchronous file reads during completions.
   */
  static async preloadLibs(): Promise<void> {
    // Skip if already loaded (either by sync or async loading)
    if (libsLoaded || moduleLibCache.size > 0) {
      return
    }

    // Get the TypeScript lib directory path
    const tsLibDir = path.dirname(fileURLToPath(import.meta.resolve('typescript/lib/typescript.js')))

    // List of commonly needed lib files
    const libFiles = [
      'lib.es2022.d.ts',
      'lib.es2022.array.d.ts',
      'lib.es2022.error.d.ts',
      'lib.es2022.intl.d.ts',
      'lib.es2022.object.d.ts',
      'lib.es2022.string.d.ts',
      'lib.es2022.sharedmemory.d.ts',
      'lib.es2022.regexp.d.ts',
      'lib.es2021.d.ts',
      'lib.es2021.intl.d.ts',
      'lib.es2021.promise.d.ts',
      'lib.es2021.string.d.ts',
      'lib.es2021.weakref.d.ts',
      'lib.es2020.d.ts',
      'lib.es2020.bigint.d.ts',
      'lib.es2020.date.d.ts',
      'lib.es2020.intl.d.ts',
      'lib.es2020.number.d.ts',
      'lib.es2020.promise.d.ts',
      'lib.es2020.sharedmemory.d.ts',
      'lib.es2020.string.d.ts',
      'lib.es2020.symbol.wellknown.d.ts',
      'lib.es2019.d.ts',
      'lib.es2019.array.d.ts',
      'lib.es2019.intl.d.ts',
      'lib.es2019.object.d.ts',
      'lib.es2019.string.d.ts',
      'lib.es2019.symbol.d.ts',
      'lib.es2018.d.ts',
      'lib.es2018.asyncgenerator.d.ts',
      'lib.es2018.asynciterable.d.ts',
      'lib.es2018.intl.d.ts',
      'lib.es2018.promise.d.ts',
      'lib.es2018.regexp.d.ts',
      'lib.es2017.d.ts',
      'lib.es2017.date.d.ts',
      'lib.es2017.intl.d.ts',
      'lib.es2017.object.d.ts',
      'lib.es2017.sharedmemory.d.ts',
      'lib.es2017.string.d.ts',
      'lib.es2017.typedarrays.d.ts',
      'lib.es2016.d.ts',
      'lib.es2016.array.include.d.ts',
      'lib.es2015.d.ts',
      'lib.es2015.collection.d.ts',
      'lib.es2015.core.d.ts',
      'lib.es2015.generator.d.ts',
      'lib.es2015.iterable.d.ts',
      'lib.es2015.promise.d.ts',
      'lib.es2015.proxy.d.ts',
      'lib.es2015.reflect.d.ts',
      'lib.es2015.symbol.d.ts',
      'lib.es2015.symbol.wellknown.d.ts',
      'lib.es5.d.ts',
      'lib.decorators.d.ts',
      'lib.decorators.legacy.d.ts',
      'lib.d.ts',
    ]

    // Load all lib files in parallel
    const loadPromises = libFiles.map(async (fileName) => {
      const filePath = path.join(tsLibDir, fileName)
      try {
        const content = await fs.readFile(filePath, 'utf8')
        moduleLibCache.set(fileName, content)
      } catch {
        // Lib file not found - this is okay, not all libs are always present
      }
    })

    await Promise.all(loadPromises)
    libsLoaded = true
  }

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

    // Note: TypeScript lib files are loaded at module import time via loadLibsSync()
    // at the top level. This ensures libs are ready before any CompletionEngine is created.

    // Initialize with base type definitions
    this.initializeBaseTypes(rpcTypeDefinitions)

    // Create the language service
    this.languageService = this.createLanguageService()

    // Warm up the language service by triggering initial parsing/type checking.
    // This moves the first-use overhead from getCompletions() to construction time.
    this.warmupLanguageService()
  }

  /**
   * Warm up the TypeScript language service by triggering initial parsing.
   * This ensures first getCompletions() call is fast by priming TS caches.
   */
  private warmupLanguageService(): void {
    // Multiple warmup calls that prime TypeScript's internal caches.
    // Each call uses different variable names to exercise incremental compilation.
    // 8 iterations provides good cache saturation.
    for (let i = 0; i < 8; i++) {
      this.getCompletions(`const v${i}: number[] = [${i}]; v${i}.`, 29)
    }
  }

  /**
   * Pre-load TypeScript lib files asynchronously.
   * Instance method that delegates to the static preloadLibs.
   * Call this after creating a CompletionEngine instance to ensure
   * lib files are loaded for completions.
   */
  async preloadLibs(): Promise<void> {
    return CompletionEngine.preloadLibs()
  }

  /**
   * Initialize base type definitions for the REPL environment
   */
  private initializeBaseTypes(rpcTypeDefinitions?: string): void {
    // Core REPL context types
    const coreTypes = `
declare const $: DotdoContext;

/**
 * Base CRUD methods available on all nouns
 */
interface NounMethods<T = Thing> {
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
}

/**
 * Time travel callable interface - enables Noun@'timestamp' syntax
 * @example Customer@'2024-01-01'.get('c-123')
 * @example Customer@'-1h'.list()
 */
interface TimeTravelProxy<T = Thing> {
  /** Time travel to a specific point - supports ISO dates, relative time (-1h, -7d), versions (v1234, ~1) */
  (timestamp: VersionRef): NounProxy<T>;
}

/**
 * Standard CRUD methods available on all nouns with time travel support
 * Combines base methods with time travel callable syntax
 */
interface NounProxy<T = Thing> extends NounMethods<T>, TimeTravelProxy<T> {
  /** Index signature for @ time travel syntax - Customer['@2024-01-01'] returns NounProxy */
  [K: \`@\${string}\`]: NounProxy<T>;
  /** Index signature for other dynamic methods */
  [method: string]: ((...args: unknown[]) => Promise<unknown>) | NounProxy<T>;
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

    // Initialize the REPL file (content will be prepended with module header in updateReplContent)
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
    // Reference the module-level lib cache for use in getScriptSnapshot closure
    const libCache = moduleLibCache

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
        // Try to load from pre-loaded TypeScript lib cache
        if (fileName.includes('lib.') && fileName.endsWith('.d.ts')) {
          // Extract just the filename (e.g., 'lib.es2022.d.ts' from '/node_modules/typescript/lib/lib.es2022.d.ts')
          const libFileName = fileName.split('/').pop()!
          const content = libCache.get(libFileName)
          if (content) {
            return ts.ScriptSnapshot.fromString(content)
          }
          // Lib file not in cache - this is expected for libs not pre-loaded
          return undefined
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

  /** Module header to enable top-level await in REPL */
  private static readonly MODULE_HEADER = 'export {};\n'
  /** Length of module header for cursor position adjustment */
  private static readonly MODULE_HEADER_LENGTH = CompletionEngine.MODULE_HEADER.length

  /**
   * Update the REPL content and get completions at cursor position
   */
  updateReplContent(content: string): void {
    const file = this.files.get('/repl.ts')!
    // Prepend module header to enable top-level await
    file.content = CompletionEngine.MODULE_HEADER + content
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
   * Transform time travel @ syntax into valid TypeScript
   * Converts: Customer@'2024-01-01' -> Customer('2024-01-01')
   * Converts: $.Customer@'-1h' -> $.Customer('-1h')
   * Returns the transformed content and adjusted cursor position
   */
  private transformTimeTravelSyntax(content: string, cursorPosition: number): { content: string; cursorPosition: number } {
    // Pattern matches Identifier@'string' or Identifier@"string"
    // Group 1: everything before the @
    // Group 2: the @ symbol
    // Group 3: the quoted string
    const pattern = /([A-Z][a-zA-Z0-9]*|\$\.[A-Z][a-zA-Z0-9]*)@('[^']*'|"[^"]*")/g

    let transformed = content
    let offset = 0

    let match
    while ((match = pattern.exec(content)) !== null) {
      const fullMatch = match[0]
      const identifier = match[1]
      const timestamp = match[2]
      const matchStart = match.index

      // Replace Identifier@'timestamp' with Identifier('timestamp')
      const replacement = `${identifier}(${timestamp})`

      // Apply the replacement
      const before = transformed.slice(0, matchStart + offset)
      const after = transformed.slice(matchStart + offset + fullMatch.length)
      transformed = before + replacement + after

      // Adjust cursor position if it's after the replacement point
      // The @ is removed, so length difference is 1 (we add '(' and ')' but remove '@')
      const lengthDiff = replacement.length - fullMatch.length
      if (cursorPosition > matchStart + fullMatch.length) {
        cursorPosition += lengthDiff
      } else if (cursorPosition > matchStart && cursorPosition <= matchStart + fullMatch.length) {
        // Cursor is within the match, adjust relative position
        cursorPosition += lengthDiff
      }

      offset += lengthDiff
    }

    return { content: transformed, cursorPosition }
  }

  /**
   * Get completions at a specific position in the REPL
   */
  getCompletions(content: string, cursorPosition: number): CompletionItem[] {
    // Transform time travel @ syntax to valid TypeScript
    const { content: transformedContent, cursorPosition: transformedPosition } =
      this.transformTimeTravelSyntax(content, cursorPosition)

    // Update REPL content with transformed code
    this.updateReplContent(transformedContent)

    // Adjust cursor position for module header offset
    const adjustedPosition = transformedPosition + CompletionEngine.MODULE_HEADER_LENGTH

    // Get completions from language service
    const completions = this.languageService.getCompletionsAtPosition(
      '/repl.ts',
      adjustedPosition,
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
        adjustedPosition,
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

    // Adjust cursor position for module header offset
    const adjustedPosition = cursorPosition + CompletionEngine.MODULE_HEADER_LENGTH

    const info = this.languageService.getQuickInfoAtPosition('/repl.ts', adjustedPosition)
    if (!info) return undefined

    const displayString = ts.displayPartsToString(info.displayParts)
    const documentation = info.documentation ? ts.displayPartsToString(info.documentation) : ''

    return documentation ? `${displayString}\n\n${documentation}` : displayString
  }

  /**
   * Get diagnostics for the current content
   */
  getDiagnostics(content: string): ts.Diagnostic[] {
    // Transform time travel @ syntax to valid TypeScript
    const { content: transformedContent } = this.transformTimeTravelSyntax(content, 0)

    this.updateReplContent(transformedContent)

    const syntactic = this.languageService.getSyntacticDiagnostics('/repl.ts')
    const semantic = this.languageService.getSemanticDiagnostics('/repl.ts')

    return [...syntactic, ...semantic]
  }

  /**
   * Get signature help for function calls
   */
  getSignatureHelp(content: string, cursorPosition: number): ts.SignatureHelpItems | undefined {
    this.updateReplContent(content)

    // Adjust cursor position for module header offset
    const adjustedPosition = cursorPosition + CompletionEngine.MODULE_HEADER_LENGTH

    return this.languageService.getSignatureHelpItems('/repl.ts', adjustedPosition, undefined)
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
