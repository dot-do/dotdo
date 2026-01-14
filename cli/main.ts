#!/usr/bin/env bun
/**
 * dotdo CLI Entry Point (Commander-based)
 *
 * Unified CLI for Durable Objects development and cli.do services.
 * All commands (dev and service) are registered here.
 *
 * Dev Commands:
 *   dotdo start         - Start local development server (main command)
 *   dotdo dev           - Start local development server (legacy)
 *   dotdo do:list       - List Durable Objects
 *   dotdo deploy        - Deploy to production
 *   dotdo tunnel        - Expose local server via CF Tunnel
 *   dotdo eval          - Run AI evals (evalite integration)
 *
 * Auth Commands:
 *   dotdo login         - Log in to your account
 *   dotdo logout        - Log out of your account
 *   dotdo whoami        - Show current user
 *
 * MCP Commands:
 *   dotdo mcp           - Start stdio MCP bridge to DO's /mcp endpoint
 *
 * Service Commands (cli.do):
 *   dotdo call          - Make voice calls via calls.do
 *   dotdo text          - Send SMS/MMS via texts.do
 *   dotdo email         - Send emails via emails.do
 *   dotdo charge        - Create charges via payments.do
 *   dotdo queue         - Queue operations via queue.do
 *   dotdo llm           - LLM requests via llm.do
 *   dotdo config        - Manage CLI configuration
 */

import { Command } from 'commander'
import { devCommand } from './commands/dev-local'
import { doCommand } from './commands/do-ops'
import { tunnelCommand } from './commands/tunnel'
import { deployCommand } from './commands/deploy-multi'
import { startCommand } from './commands/start'
import { evalCommand } from './commands/eval'
import { replCommand } from './commands/repl'
import { connectCommand } from './commands/connect'
import { generateCommand } from './commands/generate'
// Auth commands
import { run as loginRun } from './commands/auth/login'
import { run as logoutRun } from './commands/auth/logout'
import { run as whoamiRun } from './commands/auth/whoami'
// MCP command
import { mcpCommand } from './mcp-stdio'
// Service commands (Commander wrappers)
import {
  callCommand,
  textCommand,
  emailCommand,
  chargeCommand,
  queueCommand,
  llmCommand,
  configCommand,
} from './commands/services'
import { createLogger } from './utils/logger'
import { DOTDO_DIR } from './utils/paths'

const logger = createLogger('cli')

// Package info
const pkg = {
  name: 'dotdo',
  version: '0.1.0',
  description: 'Self-contained CLI for Durable Objects development',
}

export const program = new Command()
  .name('dotdo')
  .description(pkg.description)
  .version(pkg.version, '-v, --version', 'Show version number')
  .option('--debug', 'Enable debug output')

// Handle debug flag at parse time
const originalParse = program.parse.bind(program)
program.parse = function (argv?: readonly string[], options?: { from: 'node' | 'electron' | 'user' }) {
  // Pre-parse to check for --debug flag
  const args = argv ?? process.argv
  if (args.includes('--debug')) {
    process.env.DEBUG = '1'
  }
  return originalParse(argv, options)
}

// Add dev commands
program.addCommand(startCommand)
program.addCommand(devCommand)
program.addCommand(doCommand)
program.addCommand(tunnelCommand)
program.addCommand(deployCommand)
program.addCommand(evalCommand)
program.addCommand(replCommand)
program.addCommand(connectCommand)
program.addCommand(generateCommand)

// Add service commands (cli.do)
program.addCommand(callCommand)
program.addCommand(textCommand)
program.addCommand(emailCommand)
program.addCommand(chargeCommand)
program.addCommand(queueCommand)
program.addCommand(llmCommand)
program.addCommand(configCommand)

// Auth commands
program
  .command('login')
  .description('Log in to your account (id.org.ai OAuth)')
  .action(async () => {
    try {
      await loginRun()
    } catch (error) {
      process.exit(1)
    }
  })

program
  .command('logout')
  .description('Log out of your account')
  .action(async () => {
    try {
      await logoutRun()
    } catch (error) {
      process.exit(1)
    }
  })

program
  .command('whoami')
  .description('Show current user')
  .action(async () => {
    try {
      await whoamiRun()
    } catch (error) {
      process.exit(1)
    }
  })

// MCP command - stdio bridge to DO's /mcp endpoint
program
  .command('mcp')
  .description('Start stdio MCP bridge to DO\'s /mcp endpoint')
  .option('--url <url>', 'DO URL (defaults to DO_URL env var)')
  .action(async (options) => {
    try {
      await mcpCommand({ url: options.url })
    } catch (error) {
      logger.error('MCP bridge failed:', { error: error instanceof Error ? error.message : String(error) })
      process.exit(1)
    }
  })

// Init command
program
  .command('init')
  .description('Initialize a new dotdo project')
  .option('-t, --template <template>', 'Project template', 'default')
  .option('--no-git', 'Skip git initialization')
  .action(async (options) => {
    logger.info('Initializing new dotdo project...')

    const fs = await import('fs')
    const path = await import('path')

    const cwd = process.cwd()

    // Create basic structure
    const dirs = [DOTDO_DIR, 'objects', 'api']
    for (const dir of dirs) {
      const dirPath = path.join(cwd, dir)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
        logger.debug(`Created: ${dir}/`)
      }
    }

    // Create dotdo.config.ts
    const configPath = path.join(cwd, 'dotdo.config.ts')
    if (!fs.existsSync(configPath)) {
      const configContent = `/**
 * dotdo configuration
 */

import type { DotdoConfig } from 'dotdo/cli'

export default {
  port: 8787,
  entryPoint: 'index.ts',
  compatibilityDate: '2024-01-01',
  compatibilityFlags: ['nodejs_compat'],
} satisfies DotdoConfig
`
      fs.writeFileSync(configPath, configContent)
      logger.debug('Created: dotdo.config.ts')
    }

    // Create example DO
    const examplePath = path.join(cwd, 'objects', 'Counter.ts')
    if (!fs.existsSync(examplePath)) {
      const exampleContent = `/**
 * Example Durable Object: Counter
 */

export class Counter extends DurableObject {
  private count: number = 0

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/increment') {
      this.count++
      await this.ctx.storage.put('count', this.count)
      return new Response(JSON.stringify({ count: this.count }))
    }

    if (url.pathname === '/decrement') {
      this.count--
      await this.ctx.storage.put('count', this.count)
      return new Response(JSON.stringify({ count: this.count }))
    }

    return new Response(JSON.stringify({ count: this.count }))
  }
}
`
      fs.writeFileSync(examplePath, exampleContent)
      logger.debug('Created: objects/Counter.ts')
    }

    // Create index.ts
    const indexPath = path.join(cwd, 'index.ts')
    if (!fs.existsSync(indexPath)) {
      const indexContent = `/**
 * Worker entry point
 */

import { Counter } from './objects/Counter'

export { Counter }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Route to Counter DO
    if (url.pathname.startsWith('/counter')) {
      const id = env.COUNTER.idFromName('default')
      const counter = env.COUNTER.get(id)
      return counter.fetch(request)
    }

    return new Response('Hello from dotdo!')
  },
}

interface Env {
  COUNTER: DurableObjectNamespace
}
`
      fs.writeFileSync(indexPath, indexContent)
      logger.debug('Created: index.ts')
    }

    // Initialize git
    if (options.git) {
      const { execSync } = await import('child_process')
      try {
        if (!fs.existsSync(path.join(cwd, '.git'))) {
          execSync('git init', { cwd, stdio: 'ignore' })
          logger.debug('Initialized git repository')
        }
      } catch {
        // Git not available
      }
    }

    console.log()
    logger.success('Project initialized!')
    console.log()
    console.log('  Next steps:')
    console.log('    1. Run: dotdo dev')
    console.log('    2. Visit: http://localhost:8787')
    console.log('    3. Try:   http://localhost:8787/counter/increment')
    console.log()
  })

// Logs command
program
  .command('logs')
  .description('Stream logs from deployed workers')
  .option('-f, --follow', 'Follow log output', true)
  .option('--format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    const { spawn } = await import('child_process')

    const args = ['wrangler', 'tail']
    if (options.format === 'json') {
      args.push('--format', 'json')
    }

    const proc = spawn('bunx', args, {
      stdio: 'inherit',
    })

    proc.on('error', (error) => {
      logger.error('Failed to start wrangler tail', { error: error.message })
      process.exit(1)
    })
  })

// Build command
program
  .command('build')
  .description('Build the project')
  .option('-w, --watch', 'Watch for changes')
  .action(async (options) => {
    const { spawn } = await import('child_process')

    logger.info('Building project...')

    const args = ['tsc', '-p', 'tsconfig.json']
    if (options.watch) {
      args.push('--watch')
    }

    const proc = spawn('bunx', args, {
      stdio: 'inherit',
    })

    proc.on('exit', (code) => {
      if (code === 0) {
        logger.success('Build complete')
      } else {
        logger.error('Build failed')
        process.exit(code ?? 1)
      }
    })
  })

// Make REPL the default when no command given
program.action(async () => {
  // Import dynamically to avoid circular dependency issues
  const { replCommand } = await import('./commands/repl')
  // Parse with empty arguments to trigger the repl command's action
  await replCommand.parseAsync([], { from: 'user' })
})

// Parse arguments only when run directly (not when imported)
// bin.ts will call program.parse() when using this module
if (import.meta.main) {
  program.parse()
}
