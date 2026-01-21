// rpc.do CLI - Eval and Run Commands
// Execute code and scripts against RPC endpoints

import { promises as fs } from 'node:fs'
import * as fsSync from 'node:fs'

/**
 * Options for the eval command
 */
export interface EvalOptions {
  /** Pretty print JSON output */
  pretty?: boolean | undefined
  /** Execution timeout in milliseconds (default: 5000) */
  timeout?: number | undefined
  /** OAuth token for authentication */
  authToken?: string | undefined
  /** Callback for output messages */
  onOutput?: ((message: string) => void) | undefined
}

/**
 * Options for the run command
 */
export interface RunOptions extends EvalOptions {
  /** Watch for file changes and re-run */
  watch?: boolean | undefined
  /** AbortSignal for cancelling watch mode */
  signal?: AbortSignal | undefined
}

/**
 * Result of eval/run operation
 */
export interface EvalResult {
  /** Whether the operation succeeded */
  success: boolean
  /** The result value (on success) */
  value?: unknown
  /** Error message (on failure) */
  error?: string
}

/**
 * Normalize endpoint URL by removing trailing slash
 */
function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '')
}

/**
 * Check if response contains an RPC error
 */
function isRpcError(data: unknown): data is { error: { code: string; message: string; stack?: string } } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as { error: unknown }).error === 'object' &&
    (data as { error: unknown }).error !== null &&
    'message' in ((data as { error: { message: unknown } }).error)
  )
}

/**
 * Check if response contains a result
 */
function isRpcResult(data: unknown): data is { result: unknown } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'result' in data
  )
}

/**
 * Format output value for display
 */
function formatOutput(value: unknown, pretty: boolean): string {
  if (value === undefined) {
    return 'undefined'
  }
  if (pretty) {
    return JSON.stringify(value, null, 2)
  }
  return JSON.stringify(value)
}

/**
 * Execute code against an RPC endpoint
 *
 * @example
 * ```typescript
 * const result = await evalCommand('https://api.example.com', '1+1', {
 *   onOutput: console.log,
 * })
 *
 * if (result.success) {
 *   console.log('Result:', result.value)
 * } else {
 *   console.error('Error:', result.error)
 * }
 * ```
 */
export async function evalCommand(
  endpoint: string,
  code: string,
  options: EvalOptions
): Promise<EvalResult> {
  const {
    pretty = false,
    timeout = 5000,
    authToken,
    onOutput = () => {},
  } = options

  // Normalize endpoint URL
  const normalizedEndpoint = normalizeEndpoint(endpoint)
  const rpcUrl = `${normalizedEndpoint}/rpc`

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  try {
    // Make RPC call to _eval endpoint
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method: '_eval', args: [code] }),
      signal: AbortSignal.timeout(timeout),
    })

    // Handle HTTP errors
    if (!response.ok) {
      const errorMsg = `HTTP ${response.status}: ${response.statusText}`
      onOutput(`Error: ${errorMsg}`)
      return {
        success: false,
        error: errorMsg,
      }
    }

    // Parse JSON response
    let data: unknown
    try {
      data = await response.json()
    } catch (parseError) {
      const errorMsg = parseError instanceof Error ? parseError.message : 'Failed to parse JSON response'
      onOutput(`Error: ${errorMsg}`)
      return {
        success: false,
        error: errorMsg,
      }
    }

    // Check for RPC-level errors
    if (isRpcError(data)) {
      const errorMsg = data.error.message
      onOutput(`Error: ${errorMsg}`)
      if (data.error.stack) {
        onOutput(data.error.stack)
      }
      return {
        success: false,
        error: errorMsg,
      }
    }

    // Extract result
    if (isRpcResult(data)) {
      const value = data.result
      onOutput(formatOutput(value, pretty))
      return {
        success: true,
        value,
      }
    }

    // Unexpected response format
    const errorMsg = 'Unexpected response format'
    onOutput(`Error: ${errorMsg}`)
    return {
      success: false,
      error: errorMsg,
    }
  } catch (error) {
    // Handle network/timeout errors
    let errorMsg = error instanceof Error ? error.message : String(error)

    // Make timeout errors more user-friendly
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      errorMsg = `Request timeout after ${timeout}ms`
    }

    onOutput(`Error: ${errorMsg}`)
    return {
      success: false,
      error: errorMsg,
    }
  }
}

/**
 * Execute a script file against an RPC endpoint
 *
 * @example
 * ```typescript
 * const result = await runCommand('https://api.example.com', './script.ts', {
 *   watch: true,
 *   onOutput: console.log,
 * })
 * ```
 */
export async function runCommand(
  endpoint: string,
  filepath: string,
  options: RunOptions
): Promise<EvalResult> {
  const {
    watch = false,
    signal,
    onOutput = () => {},
    ...evalOptions
  } = options

  // Read the script file
  let code: string
  try {
    code = await fs.readFile(filepath, 'utf-8')
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    onOutput(`Error: ${errorMsg}`)
    return {
      success: false,
      error: errorMsg,
    }
  }

  // Execute the script
  const executeScript = async (scriptCode: string): Promise<EvalResult> => {
    return evalCommand(endpoint, scriptCode, { ...evalOptions, onOutput })
  }

  // If not watching, just execute once
  if (!watch) {
    return executeScript(code)
  }

  // Watch mode
  onOutput(`Watching ${filepath} for changes...`)

  // Execute initial run
  let lastResult = await executeScript(code)

  // Set up file watcher
  let watcher: fsSync.FSWatcher | undefined

  try {
    watcher = fsSync.watch(filepath, async (eventType) => {
      if (eventType === 'change') {
        onOutput(`\nFile changed, reloading...`)
        try {
          const newCode = await fs.readFile(filepath, 'utf-8')
          lastResult = await executeScript(newCode)
        } catch (readError) {
          const errorMsg = readError instanceof Error ? readError.message : String(readError)
          onOutput(`Error reading file: ${errorMsg}`)
        }
      }
    })

    // Handle abort signal
    if (signal) {
      const cleanup = () => {
        if (watcher) {
          watcher.close()
        }
      }

      signal.addEventListener('abort', cleanup)

      // Wait until aborted
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve()
          return
        }
        signal.addEventListener('abort', () => resolve())
      })

      signal.removeEventListener('abort', cleanup)
    } else {
      // No signal, wait forever (user must Ctrl+C)
      await new Promise(() => {}) // Never resolves
    }
  } finally {
    if (watcher) {
      watcher.close()
    }
  }

  return lastResult
}
