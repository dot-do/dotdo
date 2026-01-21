// REPL Service for rpc.do CLI
// Provides an interactive REPL with autocomplete, history, and RPC execution

import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as util from 'node:util'

import type { Transport } from '../transport/types'
import type { RPCMessage } from '../types'
import { LSPService, type CompletionItem, type HoverInfo, type SignatureInfo, type DiagnosticError } from './lsp'

/**
 * Options for creating a REPL service
 */
export interface ReplServiceOptions {
  /** Transport for RPC communication */
  transport: Transport
  /** TypeScript type definitions (optional, for autocomplete) */
  types?: string | undefined
  /** Path to history file (default: ~/.do/repl_history) */
  historyPath?: string | undefined
  /** Maximum history size (default: 1000) */
  maxHistorySize?: number | undefined
  /** Custom prompt (default: "$ > ") */
  prompt?: string | undefined
  /** Output function (default: console.log) */
  output?: ((text: string) => void) | undefined
  /** Callback when exit is requested */
  onExit?: (() => void) | undefined
  /** Callback when clear is requested */
  onClear?: (() => void) | undefined
  /** Readline interface (for testing) */
  rl?: readline.Interface | undefined
}

/**
 * Custom command definition
 */
export interface ReplCommand {
  /** Command name (without the leading dot) */
  name: string
  /** Description for help text */
  description: string
  /** Execute function */
  execute: (args: string[]) => Promise<void>
}

/**
 * Result from processing a line of input
 */
export interface ProcessLineResult {
  /** Whether the input is complete */
  complete: boolean
  /** The result of execution (if complete) */
  result?: unknown
  /** Error message (if any) */
  error?: string
}

/**
 * Default history path
 */
function getDefaultHistoryPath(): string {
  return path.join(os.homedir(), '.do', 'repl_history')
}

/**
 * REPL Service - Interactive REPL with autocomplete and RPC execution
 *
 * Provides:
 * - Tab completion using LSPService
 * - Command history with file persistence
 * - RPC execution via transport
 * - Built-in commands (.help, .exit, .clear, .types)
 * - Multiline input support
 *
 * @example
 * ```typescript
 * const repl = new ReplService({
 *   transport: new FetchTransport({ url: 'https://api.do' }),
 *   types: typeDefinitions,
 * })
 *
 * await repl.start()
 * ```
 */
export class ReplService {
  private readonly transport: Transport
  private readonly lsp: LSPService | null
  private readonly historyPath: string
  private readonly maxHistorySize: number
  private readonly prompt: string
  private readonly output: (text: string) => void
  private readonly onExit: (() => void) | undefined
  private readonly onClear: (() => void) | undefined

  private rl: readline.Interface | null = null
  private running: boolean = false
  private history: string[] = []
  private multilineBuffer: string = ''
  private customCommands: Map<string, ReplCommand> = new Map()

  // Built-in commands
  private readonly builtinCommands: Map<string, ReplCommand>

  constructor(options: ReplServiceOptions) {
    this.transport = options.transport
    this.historyPath = options.historyPath ?? getDefaultHistoryPath()
    this.maxHistorySize = options.maxHistorySize ?? 1000
    this.prompt = options.prompt ?? '$ > '
    this.output = options.output ?? console.log
    this.onExit = options.onExit
    this.onClear = options.onClear

    // Initialize LSP if types provided
    if (options.types) {
      this.lsp = new LSPService({ types: options.types })
    } else {
      this.lsp = null
    }

    // Initialize built-in commands
    this.builtinCommands = new Map([
      ['exit', {
        name: 'exit',
        description: 'Exit the REPL',
        execute: async () => {
          await this.stop()
          if (this.onExit) {
            this.onExit()
          }
        },
      }],
      ['quit', {
        name: 'quit',
        description: 'Exit the REPL (alias for .exit)',
        execute: async () => {
          await this.stop()
          if (this.onExit) {
            this.onExit()
          }
        },
      }],
      ['help', {
        name: 'help',
        description: 'Show available commands',
        execute: async () => {
          this.showHelp()
        },
      }],
      ['clear', {
        name: 'clear',
        description: 'Clear the screen',
        execute: async () => {
          if (this.onClear) {
            this.onClear()
          } else {
            // Default: print ANSI clear sequence
            this.output('\x1b[2J\x1b[H')
          }
        },
      }],
      ['types', {
        name: 'types',
        description: 'Show type information',
        execute: async () => {
          if (this.lsp) {
            // Get completions for $ to show available types
            const completions = this.lsp.getCompletions({ line: 0, column: 2 }, '$.')
            this.output('Available $ members:')
            for (const c of completions) {
              this.output(`  ${c.name}: ${c.kind}`)
            }
          } else {
            this.output('Type information not available (no types loaded)')
          }
        },
      }],
      ['history', {
        name: 'history',
        description: 'Show command history',
        execute: async () => {
          if (this.history.length === 0) {
            this.output('No history')
          } else {
            this.history.forEach((cmd, i) => {
              this.output(`  ${i + 1}  ${cmd}`)
            })
          }
        },
      }],
    ])

    // Store provided readline interface
    if (options.rl) {
      this.rl = options.rl
    }
  }

  /**
   * Get the current prompt string
   */
  getPrompt(): string {
    return this.multilineBuffer ? '... ' : this.prompt
  }

  /**
   * Check if the REPL is currently running
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Get command history
   */
  getHistory(): string[] {
    return [...this.history]
  }

  /**
   * Load history from file
   */
  async loadHistory(): Promise<void> {
    try {
      if (fs.existsSync(this.historyPath)) {
        const content = fs.readFileSync(this.historyPath, 'utf-8')
        this.history = content.split('\n').filter(line => line.trim().length > 0)
        // Limit to max size
        if (this.history.length > this.maxHistorySize) {
          this.history = this.history.slice(-this.maxHistorySize)
        }
      }
    } catch {
      // Ignore errors loading history
    }
  }

  /**
   * Save history to file
   */
  async saveHistory(): Promise<void> {
    try {
      const dir = path.dirname(this.historyPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.historyPath, this.history.join('\n') + '\n')
    } catch {
      // Ignore errors saving history
    }
  }

  /**
   * Add a command to history
   */
  private addToHistory(command: string): void {
    const trimmed = command.trim()
    if (trimmed.length === 0) {
      return
    }

    // Don't add duplicate consecutive commands
    if (this.history.length > 0 && this.history[this.history.length - 1] === trimmed) {
      return
    }

    this.history.push(trimmed)

    // Limit history size
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize)
    }
  }

  /**
   * Register a custom command
   */
  registerCommand(command: ReplCommand): void {
    this.customCommands.set(command.name, command)
  }

  /**
   * Show help for all commands
   */
  private showHelp(): void {
    this.output('Commands:')

    // Built-in commands
    for (const [name, cmd] of this.builtinCommands) {
      this.output(`  .${name.padEnd(12)} ${cmd.description}`)
    }

    // Custom commands
    for (const [name, cmd] of this.customCommands) {
      this.output(`  .${name.padEnd(12)} ${cmd.description}`)
    }

    this.output('')
    this.output('Use Tab for autocomplete, Up/Down for history navigation.')
  }

  /**
   * Get completions for the current input
   *
   * Returns completion items from LSPService
   */
  getCompletions(code: string, position: number): CompletionItem[] {
    if (!this.lsp) {
      return []
    }

    // Convert position to line/column
    const lines = code.substring(0, position).split('\n')
    const line = lines.length - 1
    const column = lines[lines.length - 1]?.length ?? 0

    return this.lsp.getCompletions({ line, column }, code)
  }

  /**
   * Get readline-compatible completions
   *
   * Returns [completions, partial] tuple for readline completer
   */
  complete(line: string): [string[], string] {
    if (!this.lsp) {
      // Without LSP, suggest $ as starting point
      if (line === '' || line === '$') {
        return [['$'], line]
      }
      return [[], line]
    }

    // Find the partial word being typed
    const match = line.match(/\.?(\w*)$/)
    const partial = match?.[1] ?? ''
    const position = line.length

    // Get completions from LSP
    const completions = this.getCompletions(line, position)
    const names = completions.map(c => c.name)

    // Filter by partial
    const filtered = partial
      ? names.filter(n => n.startsWith(partial))
      : names

    return [filtered, partial]
  }

  /**
   * Get hover information for a position
   */
  getHoverInfo(code: string, position: number): HoverInfo | null {
    if (!this.lsp) {
      return null
    }

    const lines = code.substring(0, position).split('\n')
    const line = lines.length - 1
    const column = lines[lines.length - 1]?.length ?? 0

    return this.lsp.getHover({ line, column }, code)
  }

  /**
   * Get signature help for a function call
   */
  getSignatureHelp(code: string, position: number): SignatureInfo | null {
    if (!this.lsp) {
      return null
    }

    const lines = code.substring(0, position).split('\n')
    const line = lines.length - 1
    const column = lines[lines.length - 1]?.length ?? 0

    return this.lsp.getSignatureHelp({ line, column }, code)
  }

  /**
   * Check code for syntax errors
   */
  checkSyntax(code: string): DiagnosticError[] {
    if (!this.lsp) {
      return []
    }

    return this.lsp.check(code)
  }

  /**
   * Check if input is incomplete (needs more lines)
   */
  isIncomplete(code: string): boolean {
    let braces = 0
    let parens = 0
    let brackets = 0
    let inString = false
    let stringChar = ''
    let inTemplate = false

    for (let i = 0; i < code.length; i++) {
      const char = code[i]
      const prevChar = i > 0 ? code[i - 1] : ''

      // Skip escaped characters
      if (prevChar === '\\') {
        continue
      }

      // Handle strings
      if (!inString && !inTemplate) {
        if (char === '"' || char === "'") {
          inString = true
          stringChar = char
          continue
        }
        if (char === '`') {
          inTemplate = true
          continue
        }
      } else if (inString && char === stringChar) {
        inString = false
        stringChar = ''
        continue
      } else if (inTemplate && char === '`') {
        inTemplate = false
        continue
      }

      // Skip inside strings
      if (inString || inTemplate) {
        continue
      }

      // Count brackets
      switch (char) {
        case '{':
          braces++
          break
        case '}':
          braces--
          break
        case '(':
          parens++
          break
        case ')':
          parens--
          break
        case '[':
          brackets++
          break
        case ']':
          brackets--
          break
      }
    }

    // Incomplete if any brackets are open or in unclosed string/template
    return braces > 0 || parens > 0 || brackets > 0 || inString || inTemplate
  }

  /**
   * Process a line of input
   *
   * Returns the result of processing, including whether input is complete
   */
  async processLine(line: string): Promise<ProcessLineResult> {
    // Append to multiline buffer
    const fullCode = this.multilineBuffer
      ? this.multilineBuffer + '\n' + line
      : line

    // Check if input is complete
    if (this.isIncomplete(fullCode)) {
      this.multilineBuffer = fullCode
      return { complete: false }
    }

    // Input is complete, execute it
    this.multilineBuffer = ''

    try {
      const result = await this.executeCode(fullCode)
      return { complete: true, result }
    } catch (error) {
      return {
        complete: true,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Execute a line of input
   *
   * Handles built-in commands, custom commands, and RPC execution
   */
  async execute(input: string): Promise<void> {
    const trimmed = input.trim()

    // Empty input - do nothing
    if (trimmed.length === 0) {
      return
    }

    // Handle built-in commands
    if (trimmed.startsWith('.')) {
      await this.executeCommand(trimmed)
      return
    }

    // Add to history
    this.addToHistory(trimmed)

    // Execute as code
    try {
      const result = await this.executeCode(trimmed)
      if (result !== undefined) {
        this.printResult(result)
      }
    } catch (error) {
      this.printError(error)
    }
  }

  /**
   * Execute a built-in or custom command
   */
  private async executeCommand(input: string): Promise<void> {
    // Parse command and arguments
    const parts = input.slice(1).split(/\s+/)
    const cmdName = parts[0] ?? ''
    const args = parts.slice(1)

    // Look up command
    const builtinCmd = this.builtinCommands.get(cmdName)
    if (builtinCmd) {
      await builtinCmd.execute(args)
      return
    }

    const customCmd = this.customCommands.get(cmdName)
    if (customCmd) {
      await customCmd.execute(args)
      return
    }

    // Unknown command
    this.output(`Unknown command: .${cmdName}`)
    this.output('Type .help for available commands')
  }

  /**
   * Execute code (RPC or local evaluation)
   *
   * SECURITY NOTE: This uses new Function() for local JS evaluation.
   * This is acceptable because:
   * 1. This is a CLI REPL - the user already has local shell access
   * 2. The user explicitly typed the code to execute
   * 3. The attack surface is no different from running node/deno directly
   *
   * For server-side code evaluation, use worker_loaders (ai-evaluate) instead.
   */
  private async executeCode(code: string): Promise<unknown> {
    // Check if this is an RPC call (starts with $.)
    if (code.startsWith('$.') || code.startsWith('await $.')) {
      return this.executeRpc(code)
    }

    // Local evaluation via new Function() - safe for CLI REPL context
    try {
      const fn = new Function('$', `return ${code}`)
      const mockContext = this.createMockContext()
      return fn(mockContext)
    } catch {
      // If evaluation fails, might be a statement - just return undefined
      return undefined
    }
  }

  /**
   * Execute an RPC call
   */
  private async executeRpc(code: string): Promise<unknown> {
    // Parse the RPC call to extract method and arguments
    const { method, args } = this.parseRpcCall(code)

    if (!method) {
      throw new Error('Invalid RPC expression')
    }

    // Send via transport
    const message: RPCMessage = {
      method,
      args,
    }

    const response = await this.transport.send(message)

    if (response.error) {
      throw new Error(response.error.message)
    }

    return response.result
  }

  /**
   * Parse an RPC call expression to extract method and arguments
   */
  private parseRpcCall(code: string): { method: string; args: unknown[] } {
    // Remove 'await ' prefix if present
    let expr = code.trim()
    if (expr.startsWith('await ')) {
      expr = expr.slice(6).trim()
    }

    // Remove '$.' prefix
    if (expr.startsWith('$.')) {
      expr = expr.slice(2)
    }

    // Parse method.path(args)
    const match = expr.match(/^([\w.]+)\((.*)\)$/s)
    if (!match) {
      return { method: '', args: [] }
    }

    const method = match[1] ?? ''
    const argsStr = match[2] ?? ''

    // Parse arguments (simple JSON parsing)
    let args: unknown[] = []
    if (argsStr.trim().length > 0) {
      try {
        // Wrap in array brackets for JSON parsing
        args = JSON.parse(`[${argsStr}]`)
      } catch {
        // Try evaluating as JS - safe for CLI REPL context (user typed this)
        // SECURITY NOTE: new Function() used as JSON fallback
        try {
          const fn = new Function(`return [${argsStr}]`)
          args = fn()
        } catch {
          // Fall back to string argument
          args = [argsStr]
        }
      }
    }

    return { method, args }
  }

  /**
   * Create a mock $ context for local evaluation
   */
  private createMockContext(): Record<string, unknown> {
    // Return a proxy that records property access
    return new Proxy({}, {
      get: (_, prop) => {
        if (typeof prop === 'string') {
          return this.createMockContext()
        }
        return undefined
      },
    })
  }

  /**
   * Print a result value
   */
  private printResult(result: unknown): void {
    if (result === undefined) {
      return
    }

    const formatted = util.inspect(result, {
      colors: true,
      depth: 4,
      maxArrayLength: 100,
    })

    this.output(formatted)
  }

  /**
   * Print an error
   */
  private printError(error: unknown): void {
    if (error instanceof Error) {
      this.output(`Error: ${error.message}`)
    } else {
      this.output(`Error: ${String(error)}`)
    }
  }

  /**
   * Start the REPL
   */
  async start(): Promise<void> {
    if (this.running) {
      return
    }

    this.running = true

    // Load history
    await this.loadHistory()

    // Create readline interface if not provided
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: this.prompt,
        completer: (line: string) => this.complete(line),
        history: this.history,
        historySize: this.maxHistorySize,
      })
    }

    // Display prompt
    this.rl.setPrompt(this.getPrompt())
    this.rl.prompt()

    // Handle line input
    this.rl.on('line', async (line: string) => {
      const result = await this.processLine(line)

      if (result.complete) {
        if (result.error) {
          this.printError(new Error(result.error))
        } else if (result.result !== undefined) {
          this.printResult(result.result)
        }
      }

      // Update prompt for multiline
      if (this.rl) {
        this.rl.setPrompt(this.getPrompt())
        this.rl.prompt()
      }
    })

    // Handle close
    this.rl.on('close', async () => {
      await this.saveHistory()
      this.running = false
      if (this.onExit) {
        this.onExit()
      }
    })
  }

  /**
   * Stop the REPL
   */
  async stop(): Promise<void> {
    this.running = false

    // Save history
    await this.saveHistory()

    // Close readline
    if (this.rl) {
      this.rl.close()
      this.rl = null
    }
  }
}

/**
 * Start an interactive REPL connected to an endpoint
 *
 * Uses WebSocket-first transport strategy for optimal real-time experience:
 * - Tries WebSocket connection first (wss://endpoint/ws)
 * - Falls back to HTTP if WebSocket unavailable
 * - Enables real-time event streaming and low-latency REPL commands
 *
 * @example
 * ```typescript
 * await startRepl('https://api.do')
 * // -> Tries wss://api.do/ws first, falls back to https://api.do/rpc
 * ```
 */
export async function startRepl(endpoint: string, options?: {
  types?: string | undefined
  historyPath?: string | undefined
  /**
   * Transport strategy for RPC communication
   * - 'websocket-first': Try WebSocket first, fall back to HTTP (default, optimal for REPL)
   * - 'fetch-only': Only use HTTP
   * - 'websocket-only': Only use WebSocket (fail if unavailable)
   * - 'auto-upgrade': Start with HTTP, upgrade to WebSocket if available
   * @default 'websocket-first'
   */
  strategy?: 'fetch-only' | 'websocket-only' | 'auto-upgrade' | 'websocket-first'
}): Promise<void> {
  // Import transport - use AutoTransport for WebSocket-first strategy
  const { AutoTransport } = await import('../transport/auto')

  // Default to 'websocket-first' for optimal REPL experience
  const strategy = options?.strategy ?? 'websocket-first'

  const transport = new AutoTransport({
    url: endpoint,
    strategy,
  })

  // Listen for transport events to show connection status
  let transportType: 'fetch' | 'websocket' = 'fetch'
  transport.addEventListener((event) => {
    if (event.type === 'connect' && 'transport' in event) {
      transportType = event.transport as 'fetch' | 'websocket'
    }
  })

  // Try to fetch types if not provided
  let types = options?.types
  if (!types) {
    try {
      const response = await transport.send({ method: '_types', args: [] })
      if (response.result && typeof response.result === 'string') {
        types = response.result
      }
    } catch {
      // Types not available, continue without autocomplete
    }
  }

  const repl = new ReplService({
    transport,
    types,
    historyPath: options?.historyPath,
    onExit: () => {
      transport.close?.()
      process.exit(0)
    },
    onClear: () => {
      console.clear()
    },
  })

  // Print welcome message with transport info
  const transportInfo = transport.isUsingWebSocket?.() ? 'WebSocket' : 'HTTP'
  console.log(`Connected to ${endpoint} via ${transportInfo}`)
  console.log('Type .help for available commands')
  console.log('')

  await repl.start()
}
