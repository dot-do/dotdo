// LSP Service for rpc.do CLI
// Provides TypeScript language service functionality for code completion,
// hover information, type checking, and signature help.

import * as ts from 'typescript'

/**
 * Options for creating an LSP service
 */
export interface LSPServiceOptions {
  /** TypeScript type definitions content (e.g., from .do/$.d.ts) */
  types: string
  /** Optional compiler options */
  compilerOptions?: ts.CompilerOptions
}

/**
 * Completion item returned by getCompletions
 */
export interface CompletionItem {
  /** Name of the completion */
  name: string
  /** Kind of completion (property, method, variable, etc.) */
  kind: string
  /** Optional documentation */
  documentation?: string | undefined
  /** Sort text for ordering */
  sortText?: string | undefined
}

/**
 * Hover information returned by getHover
 */
export interface HoverInfo {
  /** Type information as a string */
  type: string
  /** Optional documentation from JSDoc */
  documentation?: string | undefined
}

/**
 * Diagnostic error returned by check
 */
export interface DiagnosticError {
  /** Error message */
  message: string
  /** Line number (0-indexed) */
  line: number
  /** Column number (0-indexed) */
  column: number
  /** TypeScript error code */
  code?: number | undefined
  /** Error category (error, warning, etc.) */
  category?: string | undefined
}

/**
 * Parameter info for signature help
 */
export interface ParameterInfo {
  /** Parameter name */
  name: string
  /** Parameter documentation */
  documentation?: string | undefined
}

/**
 * Signature info for a function
 */
export interface SignatureItem {
  /** Full signature label */
  label: string
  /** Documentation for the signature */
  documentation?: string | undefined
  /** Parameter information */
  parameters?: ParameterInfo[] | undefined
}

/**
 * Signature help result
 */
export interface SignatureInfo {
  /** Available signatures */
  signatures: SignatureItem[]
  /** Active signature index */
  activeSignature: number
  /** Active parameter index */
  activeParameter: number
}

/**
 * Position in code
 */
export interface Position {
  line: number
  column: number
}

// Virtual file names
const TYPES_FILE = '/lib/types.d.ts'
const USER_FILE = '/user/code.ts'

/**
 * LSPService - TypeScript Language Service for rpc.do CLI
 *
 * Provides code completion, hover, type checking, and signature help
 * using the TypeScript compiler API.
 */
export class LSPService {
  private languageService: ts.LanguageService
  private typesContent: string
  private userCode: string = ''
  private ready: boolean = false
  private version: number = 0

  constructor(options: LSPServiceOptions) {
    // Process types to ensure $ is available as a global
    this.typesContent = this.processTypes(options.types)

    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: false, // Less strict to avoid false positives in REPL context
      noEmit: true,
      allowJs: true,
      checkJs: false,
      skipLibCheck: true,
      esModuleInterop: true,
      noLib: false,
      ...options.compilerOptions,
    }

    // Keep reference to 'this' for the host
    const self = this

    // Create a language service host
    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => [USER_FILE],
      getScriptVersion: (_fileName: string) => {
        return String(self.version)
      },
      getScriptSnapshot: (fileName: string) => {
        if (fileName === USER_FILE) {
          return ts.ScriptSnapshot.fromString(self.getFullUserCode())
        }
        // Try to read lib files from disk using ts.sys
        if (ts.sys && ts.sys.fileExists(fileName)) {
          const content = ts.sys.readFile(fileName)
          if (content) {
            return ts.ScriptSnapshot.fromString(content)
          }
        }
        return undefined
      },
      getCurrentDirectory: () => ts.sys?.getCurrentDirectory?.() ?? '/',
      getCompilationSettings: () => compilerOptions,
      getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
      fileExists: (fileName: string) => {
        if (fileName === USER_FILE) return true
        // Check for lib files on disk
        return ts.sys?.fileExists(fileName) ?? false
      },
      readFile: (fileName: string) => {
        if (fileName === USER_FILE) return self.getFullUserCode()
        // Read lib files from disk
        return ts.sys?.readFile(fileName)
      },
      directoryExists: (path: string) => ts.sys?.directoryExists(path) ?? true,
      getDirectories: (path: string) => ts.sys?.getDirectories(path) ?? [],
    }

    this.languageService = ts.createLanguageService(host, ts.createDocumentRegistry())
    this.ready = true
  }

  /**
   * Process type definitions to ensure $ is available as a global variable
   */
  private processTypes(types: string): string {
    // If there's a WorkflowContext interface but no global $ declaration, add one
    if (types.includes('WorkflowContext') && !types.includes('declare const $')) {
      // Check if it's a module (has export)
      if (types.includes('export ')) {
        // Add global declaration at the end
        return types + '\n\ndeclare global {\n  const $: WorkflowContext;\n}\n'
      }
    }
    return types
  }

  /**
   * Check if the service is ready
   */
  isReady(): boolean {
    return this.ready
  }

  /**
   * Get full user code with type declarations prepended
   */
  private getFullUserCode(): string {
    // Inline the types directly into the user code file
    // This ensures all types are available in the same compilation unit
    return `${this.typesContent}\n\n// User code below:\n${this.userCode}`
  }

  /**
   * Calculate the length of the types header
   */
  private getTypesHeaderLength(): number {
    return this.typesContent.length + '\n\n// User code below:\n'.length
  }

  /**
   * Update user code and increment version for cache invalidation
   */
  private updateUserCode(code: string): void {
    if (this.userCode !== code) {
      this.userCode = code
      this.version++
    }
  }

  /**
   * Convert position (line, column) to offset in the user code
   */
  private positionToOffset(position: Position, code: string): number {
    // Handle negative or invalid positions
    if (position.line < 0 || position.column < 0) {
      return 0
    }

    const lines = code.split('\n')
    let offset = 0

    // Handle line beyond total lines
    const line = Math.min(position.line, lines.length - 1)
    if (line < 0) return 0

    for (let i = 0; i < line; i++) {
      const lineContent = lines[i]
      if (lineContent !== undefined) {
        offset += lineContent.length + 1 // +1 for newline
      }
    }

    // Handle column beyond line length
    const column = Math.min(position.column, lines[line]?.length ?? 0)
    offset += column

    return offset
  }

  /**
   * Get code completions at a position
   *
   * @param position - Position in the code (line, column)
   * @param code - The user code to analyze
   * @returns Array of completion items
   */
  getCompletions(position: Position, code: string): CompletionItem[] {
    // Update internal user code
    this.updateUserCode(code)

    // Calculate offset in the full code (with types prepended)
    const headerLength = this.getTypesHeaderLength()
    const offsetInUserCode = this.positionToOffset(position, code)
    const offset = headerLength + offsetInUserCode

    try {
      const completions = this.languageService.getCompletionsAtPosition(
        USER_FILE,
        offset,
        {
          includeExternalModuleExports: false,
          includeInsertTextCompletions: true,
        }
      )

      if (!completions) {
        return []
      }

      return completions.entries.map(entry => ({
        name: entry.name,
        kind: entry.kind, // Already a string like "property", "method", etc.
        sortText: entry.sortText,
        documentation: this.getCompletionDocumentation(entry),
      }))
    } catch {
      return []
    }
  }

  /**
   * Get documentation for a completion entry
   */
  private getCompletionDocumentation(entry: ts.CompletionEntry): string | undefined {
    try {
      const details = this.languageService.getCompletionEntryDetails(
        USER_FILE,
        0,
        entry.name,
        {},
        entry.source,
        {},
        entry.data
      )
      if (details?.documentation) {
        return ts.displayPartsToString(details.documentation)
      }
    } catch {
      // Ignore errors getting documentation
    }
    return undefined
  }

  /**
   * Get hover information at a position
   *
   * @param position - Position in the code (line, column)
   * @param code - The user code to analyze
   * @returns Hover information or null
   */
  getHover(position: Position, code: string): HoverInfo | null {
    // Update internal user code
    this.updateUserCode(code)

    // Calculate offset
    const headerLength = this.getTypesHeaderLength()
    const offsetInUserCode = this.positionToOffset(position, code)
    const offset = headerLength + offsetInUserCode

    try {
      const quickInfo = this.languageService.getQuickInfoAtPosition(USER_FILE, offset)

      if (!quickInfo) {
        return null
      }

      const typeInfo = ts.displayPartsToString(quickInfo.displayParts)
      const documentation = quickInfo.documentation
        ? ts.displayPartsToString(quickInfo.documentation)
        : undefined

      if (!typeInfo || typeInfo.trim() === '') {
        return null
      }

      return {
        type: typeInfo,
        documentation,
      }
    } catch {
      return null
    }
  }

  /**
   * Check code for TypeScript errors
   *
   * @param code - The user code to check
   * @returns Array of diagnostic errors
   */
  check(code: string): DiagnosticError[] {
    if (!code || code.trim() === '') {
      return []
    }

    // Update internal user code
    this.updateUserCode(code)

    try {
      const semanticDiagnostics = this.languageService.getSemanticDiagnostics(USER_FILE)
      const syntacticDiagnostics = this.languageService.getSyntacticDiagnostics(USER_FILE)

      const allDiagnostics = [...syntacticDiagnostics, ...semanticDiagnostics]
      const headerLength = this.getTypesHeaderLength()

      return allDiagnostics.map(diagnostic => {
        let line = 0
        let column = 0

        if (diagnostic.file && diagnostic.start !== undefined) {
          // Adjust for the types header we prepended
          const adjustedStart = Math.max(0, diagnostic.start - headerLength)
          // Get the position but we'll recalculate below to adjust for the header
          const _originalPosition = diagnostic.file.getLineAndCharacterOfPosition(
            Math.min(diagnostic.start, diagnostic.file.getEnd())
          )

          // Recalculate based on adjusted position
          const lines = code.split('\n')
          let currentOffset = 0
          for (let i = 0; i < lines.length; i++) {
            const lineContent = lines[i]
            if (lineContent !== undefined && currentOffset + lineContent.length >= adjustedStart) {
              line = i
              column = adjustedStart - currentOffset
              break
            }
            if (lineContent !== undefined) {
              currentOffset += lineContent.length + 1
            }
          }
        }

        return {
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
          line,
          column,
          code: diagnostic.code,
          category: ts.DiagnosticCategory[diagnostic.category],
        }
      })
    } catch {
      return []
    }
  }

  /**
   * Get signature help at a position (for function calls)
   *
   * @param position - Position in the code (line, column)
   * @param code - The user code to analyze
   * @returns Signature help information or null
   */
  getSignatureHelp(position: Position, code: string): SignatureInfo | null {
    // Update internal user code
    this.updateUserCode(code)

    // Calculate offset
    const headerLength = this.getTypesHeaderLength()
    const offsetInUserCode = this.positionToOffset(position, code)
    const offset = headerLength + offsetInUserCode

    try {
      const signatureHelp = this.languageService.getSignatureHelpItems(
        USER_FILE,
        offset,
        {}
      )

      if (!signatureHelp || signatureHelp.items.length === 0) {
        return null
      }

      const signatures: SignatureItem[] = signatureHelp.items.map(item => {
        const label = [
          ...item.prefixDisplayParts,
          ...item.parameters.flatMap((p, i) => [
            ...(i > 0 ? item.separatorDisplayParts : []),
            ...p.displayParts,
          ]),
          ...item.suffixDisplayParts,
        ]
          .map(part => part.text)
          .join('')

        const parameters: ParameterInfo[] = item.parameters.map(param => ({
          name: param.name,
          documentation: param.documentation
            ? ts.displayPartsToString(param.documentation)
            : undefined,
        }))

        return {
          label,
          documentation: item.documentation
            ? ts.displayPartsToString(item.documentation)
            : undefined,
          parameters,
        }
      })

      return {
        signatures,
        activeSignature: signatureHelp.selectedItemIndex,
        activeParameter: signatureHelp.argumentIndex,
      }
    } catch {
      return null
    }
  }
}
