#!/usr/bin/env node
/**
 * dotdo CLI
 *
 * Interactive REPL with TypeScript autocomplete for dotdo Durable Objects.
 *
 * Usage:
 *   dotdo                           # Start REPL in offline mode
 *   dotdo --endpoint wss://...      # Connect to endpoint
 *   dotdo -e "$.Customer('id').get()" # Execute expression and exit
 */

import React from 'react'
import { render } from 'ink'
import { Repl, WelcomeMessage } from './repl.js'

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): {
  endpoint?: string
  token?: string
  expression?: string
  debug: boolean
  help: boolean
  version: boolean
} {
  const result = {
    endpoint: undefined as string | undefined,
    token: undefined as string | undefined,
    expression: undefined as string | undefined,
    debug: false,
    help: false,
    version: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case '-h':
      case '--help':
        result.help = true
        break

      case '-v':
      case '--version':
        result.version = true
        break

      case '-d':
      case '--debug':
        result.debug = true
        break

      case '-e':
      case '--endpoint':
        result.endpoint = args[++i]
        break

      case '-t':
      case '--token':
        result.token = args[++i]
        break

      case '-x':
      case '--execute':
        result.expression = args[++i]
        break

      default:
        // Positional argument - treat as endpoint if not set
        if (!arg.startsWith('-') && !result.endpoint) {
          result.endpoint = arg
        }
    }
  }

  // Check environment variables
  if (!result.endpoint) {
    result.endpoint = process.env.DOTDO_ENDPOINT
  }
  if (!result.token) {
    result.token = process.env.DOTDO_TOKEN
  }

  return result
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
dotdo CLI - Interactive REPL with TypeScript autocomplete

Usage:
  dotdo [options] [endpoint]

Options:
  -e, --endpoint <url>   WebSocket endpoint URL
  -t, --token <token>    Authentication token
  -x, --execute <expr>   Execute expression and exit
  -d, --debug            Enable debug logging
  -h, --help             Show this help message
  -v, --version          Show version

Examples:
  dotdo                                    # Start in offline mode
  dotdo wss://api.dotdo.dev/ws/rpc         # Connect to endpoint
  dotdo -e wss://... -x "$.ping()"         # Execute and exit

Environment:
  DOTDO_ENDPOINT   Default WebSocket endpoint
  DOTDO_TOKEN      Default authentication token

REPL Commands:
  .help      Show help
  .clear     Clear output
  .schema    Show current schema
  .connect   Reconnect
  .exit      Exit

Keyboard Shortcuts:
  Tab        Complete / cycle completions
  Ctrl+Space Toggle completion dropdown
  Up/Down    Navigate history or completions
  Ctrl+U     Clear line
  Ctrl+W     Delete word
  Ctrl+C     Exit
`)
}

/**
 * Show version
 */
function showVersion(): void {
  console.log('dotdo CLI v0.1.0')
}

/**
 * Execute a single expression
 */
async function executeExpression(
  expression: string,
  endpoint?: string,
  token?: string,
  debug?: boolean
): Promise<void> {
  // For single expression execution, we need to connect, run, and exit
  const { RpcClient } = await import('./rpc-client.js')

  if (!endpoint) {
    console.error('Error: No endpoint specified for expression execution')
    process.exit(1)
  }

  const client = new RpcClient({
    url: endpoint,
    token,
    debug,
    autoReconnect: false,
  })

  try {
    await client.connect()
    const proxy = client.createProxy<Record<string, unknown>>()

    // Create a simple evaluator
    const evalFn = new Function('$', `return (async () => ${expression})()`)
    const result = await evalFn(proxy)

    if (result !== undefined) {
      console.log(JSON.stringify(result, null, 2))
    }

    client.disconnect()
    process.exit(0)
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err))
    client.disconnect()
    process.exit(1)
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    showHelp()
    process.exit(0)
  }

  if (args.version) {
    showVersion()
    process.exit(0)
  }

  // Single expression mode
  if (args.expression) {
    await executeExpression(args.expression, args.endpoint, args.token, args.debug)
    return
  }

  // Interactive REPL mode
  const { waitUntilExit } = render(
    <React.Fragment>
      <WelcomeMessage />
      <Repl
        endpoint={args.endpoint}
        token={args.token}
        debug={args.debug}
      />
    </React.Fragment>
  )

  await waitUntilExit()
}

// Run
main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
