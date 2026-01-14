/**
 * AI Fallback Handler
 *
 * Handles unrecognized commands by passing them to AI for processing.
 * Detects whether input is code (uses sandbox) or natural language (uses AI agent).
 *
 * @see cli/utils/detect.ts for code detection heuristics
 * @see cli/sandbox.ts for Miniflare code execution
 * @see cli/agent.ts for AI SDK 6 ToolLoopAgent
 */

import { looksLikeCode } from './utils/detect'
import { runInSandbox, type SandboxResult } from './sandbox'
import { runAgent } from './agent'

/**
 * Default DO URL for agent MCP connection
 * Can be overridden via DO_URL env var
 */
const DEFAULT_DO_URL = 'https://api.dotdo.dev'

/**
 * Process fallback input - either code or natural language
 *
 * @param input - Array of CLI arguments that weren't recognized as commands
 *
 * @example
 * ```bash
 * # Code execution via sandbox
 * do 1 + 1                    # → 2
 * do "Math.sqrt(16)"          # → 4
 * do "const x = 5; return x"  # → 5
 *
 * # Natural language via AI agent
 * do "create a user named John"
 * do "list all customers"
 * do "deploy the app"
 * ```
 */
export async function fallback(input: string[]): Promise<void> {
  // Join input into a single string
  const inputStr = input.join(' ').trim()

  // Empty input - nothing to do
  if (!inputStr) {
    console.log('Usage: do [command] or do "[code or natural language]"')
    return
  }

  // Check if input looks like code
  if (looksLikeCode(inputStr)) {
    // Execute in sandbox
    await executeCode(inputStr)
  } else {
    // Process with AI agent
    await processWithAgent(inputStr)
  }
}

/**
 * Execute code in the Miniflare sandbox
 */
async function executeCode(code: string): Promise<void> {
  try {
    const result: SandboxResult = await runInSandbox(code, 'ts')

    // Print any console output
    for (const log of result.logs) {
      const args = log.args.map(formatValue).join(' ')
      switch (log.level) {
        case 'error':
          console.error(args)
          break
        case 'warn':
          console.warn(args)
          break
        default:
          console.log(args)
      }
    }

    // Print result
    if (result.success) {
      if (result.value !== undefined) {
        console.log(formatValue(result.value))
      }
    } else {
      console.error('Error:', result.error)
      process.exit(1)
    }
  } catch (error) {
    console.error('Sandbox error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

/**
 * Process natural language input with AI agent
 */
async function processWithAgent(input: string): Promise<void> {
  const doUrl = process.env.DO_URL || DEFAULT_DO_URL

  try {
    // runAgent already prints result to console
    await runAgent(input, doUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // Handle common errors with helpful messages
    if (message.includes('DO_URL') || message.includes('not configured')) {
      console.error('Error: DO_URL not configured.')
      console.error('Set DO_URL environment variable or run: do login')
    } else if (message.includes('MCP') || message.includes('connection')) {
      console.error('Error: Failed to connect to DO.')
      console.error('Check your network connection and DO_URL configuration.')
    } else {
      console.error('Error:', message)
    }
    process.exit(1)
  }
}

/**
 * Format a value for display
 */
function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'function') return '[Function]'

  // Objects - pretty print JSON
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default fallback
