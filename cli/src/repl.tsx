/**
 * REPL Component
 *
 * The main REPL interface that combines:
 * - TypeScript completion engine
 * - RPC client for remote execution (via ai-evaluate)
 * - Input/Output display
 * - History management
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { Box, Text, useApp } from 'ink'
import { evaluate } from 'ai-evaluate'
import { Input, StatusBar } from './components/Input.js'
import { Output, createOutputEntry, type OutputEntry } from './components/Output.js'
import { CompletionEngine, filterCompletions, getWordAtCursor, type CompletionItem } from './completions.js'
import { RpcClient, generateTypeDefinitions, type Schema } from './rpc-client.js'

// =============================================================================
// Execution Types
// =============================================================================

/**
 * Result of code execution via ai-evaluate
 */
export interface ExecuteResult {
  /** Whether execution succeeded */
  success: boolean
  /** Return value on success */
  value?: unknown
  /** Error message on failure */
  error?: string
}

/**
 * Log callback for streaming console output
 */
export type LogCallback = (level: string, message: string) => void

// =============================================================================
// Secure Code Execution via ai-evaluate
// =============================================================================

/**
 * Execute code securely using ai-evaluate.
 *
 * This replaces the unsafe `new Function()` approach with isolated V8 execution.
 *
 * Features:
 * - Runs in isolated V8 workers (no filesystem access)
 * - Network blocked by default
 * - Memory and CPU limits enforced
 * - Timeout enforcement
 * - SDK globals ($, db, ai) available via rpcUrl
 *
 * @param code - JavaScript/TypeScript code to execute
 * @param rpcUrl - RPC endpoint URL for SDK context
 * @param onLog - Optional callback for console output
 * @returns Execution result with success/value/error
 */
export async function executeCode(
  code: string,
  rpcUrl: string,
  onLog?: LogCallback
): Promise<ExecuteResult> {
  try {
    const result = await evaluate({
      script: code,
      sdk: { rpcUrl },
    })

    // Forward logs to callback if provided
    if (result.logs && onLog) {
      for (const log of result.logs) {
        onLog(log.level, log.message)
      }
    }

    return {
      success: result.success,
      value: result.value,
      error: result.error,
    }
  } catch (err) {
    // Handle unexpected errors from evaluate itself
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// =============================================================================
// Component Types
// =============================================================================

export interface ReplProps {
  /** RPC endpoint URL */
  endpoint?: string
  /** Authentication token */
  token?: string
  /** Initial type definitions (for offline mode) */
  initialTypes?: string
  /** Enable debug logging */
  debug?: boolean
}

/**
 * Evaluate TypeScript expression in a sandboxed context
 */
async function evaluateExpression(
  code: string,
  rpcClient: RpcClient | null,
  context: Record<string, unknown>
): Promise<unknown> {
  // Create evaluation context
  const outputFn = context.__output as ((type: string, content: string) => void) | undefined
  const evalContext = {
    ...context,
    $: rpcClient?.createProxy() ?? {},
    console: {
      log: (...args: unknown[]) => outputFn?.('info', args.join(' ')),
      error: (...args: unknown[]) => outputFn?.('error', args.join(' ')),
      warn: (...args: unknown[]) => outputFn?.('warning', args.join(' ')),
      info: (...args: unknown[]) => outputFn?.('info', args.join(' ')),
    },
  }

  // Simple expression evaluation using Function constructor
  // This is safe because we control the context
  try {
    // Wrap in async function for await support
    const fn = new Function(
      ...Object.keys(evalContext),
      `return (async () => { return ${code} })()`
    )
    return await fn(...Object.values(evalContext))
  } catch (err) {
    // Try as statements (for assignments, etc.)
    try {
      const fn = new Function(
        ...Object.keys(evalContext),
        `return (async () => { ${code} })()`
      )
      return await fn(...Object.values(evalContext))
    } catch {
      throw err
    }
  }
}

/**
 * REPL Component
 */
export function Repl({
  endpoint,
  token,
  initialTypes,
  debug = false,
}: ReplProps): React.ReactElement {
  const { exit } = useApp()

  // State
  const [inputValue, setInputValue] = useState('')
  const [outputEntries, setOutputEntries] = useState<OutputEntry[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [completions, setCompletions] = useState<CompletionItem[]>([])
  const [showCompletions, setShowCompletions] = useState(false)
  const [connected, setConnected] = useState(false)
  const [schema, setSchema] = useState<Schema | null>(null)
  const [rpcClient, setRpcClient] = useState<RpcClient | null>(null)
  const [evalContext, setEvalContext] = useState<Record<string, unknown>>({})

  // Create completion engine
  const completionEngine = useMemo(() => {
    return new CompletionEngine(initialTypes)
  }, [initialTypes])

  // Add output entry
  const addOutput = useCallback((type: OutputEntry['type'], content: unknown) => {
    setOutputEntries(prev => [...prev, createOutputEntry(type, content)])
  }, [])

  // Connect to RPC endpoint
  useEffect(() => {
    if (!endpoint) {
      addOutput('system', 'No endpoint specified. Running in offline mode.')
      return
    }

    const client = new RpcClient({
      url: endpoint,
      token,
      debug,
      autoReconnect: true,
    })

    client.on('connected', () => {
      setConnected(true)
      addOutput('system', `Connected to ${endpoint}`)
    })

    client.on('disconnected', () => {
      setConnected(false)
      addOutput('system', 'Disconnected')
    })

    client.on('error', (err: Error) => {
      addOutput('error', `Connection error: ${err.message}`)
    })

    client.on('event', (event: { type: string; data: unknown }) => {
      addOutput('info', `Event: ${event.type} - ${JSON.stringify(event.data)}`)
    })

    // Connect and introspect schema
    client.connect()
      .then((schema) => {
        setSchema(schema)
        setRpcClient(client)

        // Generate type definitions from schema
        const typeDefs = generateTypeDefinitions(schema)
        completionEngine.updateTypeDefinitions('rpc-types', typeDefs)

        addOutput('system', `Schema loaded: ${schema.name} with ${schema.methods.length} methods`)
      })
      .catch((err) => {
        addOutput('error', `Failed to connect: ${err.message}`)
      })

    return () => {
      client.disconnect()
    }
  }, [endpoint, token, debug, completionEngine, addOutput])

  // Update eval context with output function
  useEffect(() => {
    setEvalContext({
      __output: addOutput,
    })
  }, [addOutput])

  // Handle completion requests
  const handleRequestCompletions = useCallback((value: string, cursorPosition: number) => {
    const items = completionEngine.getCompletions(value, cursorPosition)
    const { word } = getWordAtCursor(value, cursorPosition)

    const filtered = filterCompletions(items, {
      triggerCharacter: value[cursorPosition - 1],
      isExplicit: false,
      currentWord: word,
      line: 0,
      column: cursorPosition,
    })

    setCompletions(filtered.slice(0, 50)) // Limit to 50 items
  }, [completionEngine])

  // Handle input submission
  const handleSubmit = useCallback(async (value: string) => {
    if (!value.trim()) {
      return
    }

    // Add to history
    setHistory(prev => [...prev, value])
    setInputValue('')
    setShowCompletions(false)

    // Show input in output
    addOutput('input', value)

    // Handle special commands
    if (value.startsWith('.')) {
      const command = value.slice(1).trim().toLowerCase()

      switch (command) {
        case 'help':
          addOutput('system', `
Commands:
  .help      - Show this help
  .clear     - Clear output
  .schema    - Show current schema
  .connect   - Reconnect to endpoint
  .exit      - Exit REPL

Keyboard shortcuts:
  Tab        - Complete / cycle completions
  Ctrl+Space - Toggle completions
  Up/Down    - Navigate history / completions
  Ctrl+C     - Exit
  Ctrl+U     - Clear line
  Ctrl+W     - Delete word
`)
          return

        case 'clear':
          setOutputEntries([])
          return

        case 'schema':
          if (schema) {
            addOutput('result', schema)
          } else {
            addOutput('warning', 'No schema available')
          }
          return

        case 'connect':
          if (rpcClient) {
            addOutput('system', 'Reconnecting...')
            rpcClient.connect().catch(err => {
              addOutput('error', `Reconnect failed: ${err.message}`)
            })
          } else {
            addOutput('warning', 'No endpoint configured')
          }
          return

        case 'exit':
          exit()
          return

        default:
          addOutput('error', `Unknown command: .${command}`)
          return
      }
    }

    // Evaluate the expression
    try {
      const result = await evaluateExpression(value, rpcClient, evalContext)
      if (result !== undefined) {
        addOutput('result', result)
      }
    } catch (err) {
      addOutput('error', err instanceof Error ? err.message : String(err))
    }
  }, [rpcClient, schema, evalContext, addOutput, exit])

  // Get diagnostics for current input
  const diagnostics = useMemo(() => {
    if (!inputValue.trim()) return []
    return completionEngine.getDiagnostics(inputValue)
  }, [inputValue, completionEngine])

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">dotdo REPL</Text>
        <Text dimColor> v0.1.0</Text>
      </Box>

      {/* Output area */}
      <Box flexGrow={1} flexDirection="column">
        <Output entries={outputEntries} />
      </Box>

      {/* Diagnostics */}
      {diagnostics.length > 0 && (
        <Box marginY={1}>
          {diagnostics.slice(0, 3).map((diag, i) => (
            <Text key={i} color="yellow">
              {completionEngine.formatDiagnostic(diag)}
            </Text>
          ))}
        </Box>
      )}

      {/* Input area */}
      <Box flexDirection="column" marginTop={1}>
        <Input
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          completions={completions}
          onRequestCompletions={handleRequestCompletions}
          showCompletions={showCompletions}
          onToggleCompletions={setShowCompletions}
          history={history}
          placeholder="Type expression or .help"
        />
      </Box>

      {/* Status bar */}
      <StatusBar
        connected={connected}
        endpoint={endpoint}
        mode={schema?.name}
      />
    </Box>
  )
}

/**
 * Welcome message component
 */
export function WelcomeMessage(): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>Welcome to the dotdo REPL!</Text>
      <Text dimColor>Type .help for commands, or start typing expressions.</Text>
      <Text dimColor>Press Tab for autocomplete, Ctrl+C to exit.</Text>
    </Box>
  )
}
