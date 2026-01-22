#!/usr/bin/env node
/**
 * @dotdo/mcp CLI - Standalone MCP Server
 *
 * Run as a standalone MCP server using stdio transport.
 * This allows AI agents like Claude Code to connect directly.
 *
 * Usage:
 *   npx @dotdo/mcp              # Start stdio server
 *   npx @dotdo/mcp --help       # Show help
 *   npx @dotdo/mcp --version    # Show version
 *   npx @dotdo/mcp --http       # Start HTTP server (default port 3000)
 *   npx @dotdo/mcp --http --port 8080  # HTTP server on custom port
 *
 * MCP stdio integration (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "dotdo": {
 *         "command": "npx",
 *         "args": ["@dotdo/mcp"]
 *       }
 *     }
 *   }
 *
 * @module @dotdo/mcp/cli
 */

import { createMCPServer } from './server'
import { searchTool } from './search'
import { fetchTool } from './fetch'
import { doTool } from './do'
import { createReadStream, createWriteStream } from 'fs'
import { createInterface } from 'readline'
import { createScopedLogger, LogLevel } from '@dotdo/utils'

const logger = createScopedLogger({ level: LogLevel.INFO, prefix: '[mcp]' })

/**
 * CLI options parsed from arguments
 */
interface CLIOptions {
  help: boolean
  version: boolean
  http: boolean
  port: number
  verbose: boolean
}

/**
 * Parse CLI arguments
 */
function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    help: false,
    version: false,
    http: false,
    port: 3000,
    verbose: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true
        break
      case '-v':
      case '--version':
        options.version = true
        break
      case '--http':
        options.http = true
        break
      case '-p':
      case '--port':
        options.port = parseInt(args[++i] || '3000', 10)
        break
      case '--verbose':
        options.verbose = true
        break
    }
  }

  return options
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
dotdo-mcp - Standalone MCP Server for dotdo

USAGE:
  npx @dotdo/mcp [OPTIONS]

OPTIONS:
  -h, --help       Show this help message
  -v, --version    Show version
  --http           Run as HTTP server instead of stdio
  -p, --port NUM   HTTP server port (default: 3000)
  --verbose        Enable verbose logging

TOOLS:
  - search         Search Things in a DO
  - fetch          Fetch web content
  - do             Execute code in DO sandbox

MCP INTEGRATION:
  Add to claude_desktop_config.json:
  {
    "mcpServers": {
      "dotdo": {
        "command": "npx",
        "args": ["@dotdo/mcp"]
      }
    }
  }

For more information, visit https://dotdo.dev
`)
}

/**
 * Show version
 */
function showVersion(): void {
  console.log('0.0.1')
}

/**
 * Handle a single JSON-RPC message
 */
async function handleMessage(
  server: ReturnType<typeof createMCPServer>,
  message: Record<string, unknown>,
  verbose: boolean
): Promise<unknown> {
  const { method, params, id } = message

  if (verbose) {
    logger.debug(`[mcp] <- ${method}`, params)
  }

  try {
    let result: unknown

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'dotdo-mcp', version: '0.0.1' },
        }
        break

      case 'tools/list':
        result = {
          tools: server.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        }
        break

      case 'tools/call': {
        const { name, arguments: args } = params as { name: string; arguments: unknown }
        const tool = server.tools.find((t) => t.name === name)
        if (!tool) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Tool not found: ${name}` },
          }
        }
        const toolResult = await tool.execute(args)
        // Preserve type information by using appropriate content type
        if (typeof toolResult === 'string') {
          // Strings: return directly without double-stringifying
          result = {
            content: [{ type: 'text', text: toolResult }],
          }
        } else {
          // Objects, arrays, and primitives: return as structured JSON
          result = {
            content: [{ type: 'json', data: toolResult }],
          }
        }
        break
      }

      case 'notifications/initialized':
        // Client notification, no response needed
        return null

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        }
    }

    if (verbose) {
      logger.debug(`[mcp] -> response`, result)
    }

    return { jsonrpc: '2.0', id, result }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: errorMessage },
    }
  }
}

/**
 * Run stdio transport server
 */
async function runStdioServer(verbose: boolean): Promise<void> {
  const server = createMCPServer({ name: 'dotdo-mcp', version: '0.0.1' })

  // Register tools
  server.addTool(searchTool)
  server.addTool(fetchTool)
  server.addTool(doTool)

  if (verbose) {
    logger.debug('[mcp] Starting stdio server with tools:', server.tools.map((t) => t.name))
  }

  // Set up stdin/stdout for JSON-RPC
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  rl.on('line', async (line) => {
    if (!line.trim()) return

    try {
      const message = JSON.parse(line)
      const response = await handleMessage(server, message, verbose)

      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n')
      }
    } catch (error) {
      const errorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      }
      process.stdout.write(JSON.stringify(errorResponse) + '\n')
    }
  })

  rl.on('close', () => {
    if (verbose) {
      logger.debug('[mcp] stdin closed, shutting down')
    }
    process.exit(0)
  })
}

/**
 * Run HTTP server
 */
async function runHttpServer(port: number, verbose: boolean): Promise<void> {
  const server = createMCPServer({ name: 'dotdo-mcp', version: '0.0.1' })

  // Register tools
  server.addTool(searchTool)
  server.addTool(fetchTool)
  server.addTool(doTool)

  if (verbose) {
    logger.debug(`Starting HTTP server on port ${port}`)
    logger.debug('Tools:', server.tools.map((t) => t.name))
  }

  // Use Node's built-in http server
  const { createServer } = await import('http')

  const httpServer = createServer(async (req, res) => {
    // Convert Node request to Web Request
    const url = new URL(req.url || '/', `http://localhost:${port}`)
    const body = await new Promise<string>((resolve) => {
      let data = ''
      req.on('data', (chunk) => (data += chunk))
      req.on('end', () => resolve(data))
    })

    const requestInit: RequestInit = {
      method: req.method || 'GET',
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([_, v]) => v !== undefined) as [string, string][]
      ),
    }
    if (body) {
      requestInit.body = body
    }
    const request = new Request(url.toString(), requestInit)

    // Handle request through MCP server
    const response = await server.fetch(request)

    // Write response
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    res.end(await response.text())
  })

  httpServer.listen(port, () => {
    logger.info(`dotdo-mcp HTTP server running on http://localhost:${port}`)
    logger.info('Endpoints:')
    logger.info(`  POST /mcp/initialize   - Initialize server`)
    logger.info(`  GET  /mcp/tools        - List available tools`)
    logger.info(`  POST /mcp/tools/call   - Call a tool`)
    logger.info(`  GET  /                 - Health check`)
  })
}

/**
 * Main entry point
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv)

  if (options.help) {
    showHelp()
    return
  }

  if (options.version) {
    showVersion()
    return
  }

  if (options.http) {
    await runHttpServer(options.port, options.verbose)
  } else {
    await runStdioServer(options.verbose)
  }
}

// Run if this is the main module
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url === `file://${process.argv[1]}.ts` ||
    process.argv[1].endsWith('/mcp/cli.ts') ||
    process.argv[1].endsWith('/mcp/cli'))

if (isMain) {
  main().catch((error) => {
    logger.error('Error:', error)
    process.exit(1)
  })
}
