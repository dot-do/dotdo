#!/usr/bin/env node
// rpc.do CLI - Command line interface for RPC operations
// Main entry point using commander

import { Command } from 'commander'
import { pull } from './pull'
import { evalCommand, runCommand } from './eval'
import { startRepl } from './repl'
import { loginCommand, logoutCommand, whoamiCommand, createDefaultLoginOptions } from './login'

const program = new Command()

program
  .name('rpc.do')
  .description('CLI for rpc.do - Cap\'n Web RPC for Durable Objects')
  .version('0.0.1')

program
  .command('pull')
  .description('Pull TypeScript types from an RPC endpoint')
  .argument('[endpoint]', 'RPC endpoint URL')
  .option('-f, --from <url>', 'RPC endpoint URL (alternative to positional arg)')
  .option('-o, --out <path>', 'Output path (default: .do/$.d.ts)')
  .option('-t, --timeout <ms>', 'Request timeout in milliseconds', '30000')
  .action(async (endpointArg: string | undefined, options: { from?: string; out?: string; timeout: string }) => {
    const endpoint = endpointArg ?? options.from

    if (endpoint === undefined) {
      console.error('Error: endpoint is required. Provide as argument or use --from <url>')
      process.exit(1)
      return // TypeScript needs this for narrowing after process.exit
    }

    const result = await pull({
      endpoint,
      outPath: options.out,
      timeout: parseInt(options.timeout, 10),
      onProgress: (message) => console.log(message),
    })

    if (!result.success) {
      console.error(`Error: ${result.error}`)
      process.exit(1)
    }
  })

program
  .command('eval')
  .description('Evaluate code against an RPC endpoint')
  .argument('<endpoint>', 'RPC endpoint URL')
  .argument('<code>', 'Code to evaluate')
  .option('-t, --timeout <ms>', 'Execution timeout in milliseconds', '5000')
  .option('-p, --pretty', 'Pretty print JSON output')
  .option('-a, --auth <token>', 'OAuth token for authentication')
  .action(async (endpoint: string, code: string, options: { timeout: string; pretty?: boolean; auth?: string }) => {
    const result = await evalCommand(endpoint, code, {
      timeout: parseInt(options.timeout, 10),
      pretty: options.pretty,
      authToken: options.auth,
      onOutput: (message) => console.log(message),
    })

    if (!result.success) {
      process.exit(1)
    }
  })

program
  .command('run')
  .description('Execute a script file against an RPC endpoint')
  .argument('<endpoint>', 'RPC endpoint URL')
  .argument('<file>', 'Script file to execute (.ts or .js)')
  .option('-t, --timeout <ms>', 'Execution timeout in milliseconds', '5000')
  .option('-p, --pretty', 'Pretty print JSON output')
  .option('-a, --auth <token>', 'OAuth token for authentication')
  .option('-w, --watch', 'Watch for file changes and re-run')
  .action(async (endpoint: string, file: string, options: { timeout: string; pretty?: boolean; auth?: string; watch?: boolean }) => {
    const result = await runCommand(endpoint, file, {
      timeout: parseInt(options.timeout, 10),
      pretty: options.pretty,
      authToken: options.auth,
      watch: options.watch,
      onOutput: (message) => console.log(message),
    })

    if (!result.success) {
      process.exit(1)
    }
  })

program
  .command('repl')
  .description('Start interactive REPL connected to endpoint')
  .argument('<endpoint>', 'RPC endpoint URL')
  .option('-t, --types <path>', 'Path to TypeScript types file (default: fetch from endpoint)')
  .option('-H, --history <path>', 'Path to history file (default: ~/.do/repl_history)')
  .action(async (endpoint: string, options: { types?: string; history?: string }) => {
    // Read types from file if provided
    let types: string | undefined
    if (options.types) {
      const fs = await import('node:fs')
      try {
        types = fs.readFileSync(options.types, 'utf-8')
      } catch (error) {
        console.error(`Error reading types file: ${error instanceof Error ? error.message : error}`)
        process.exit(1)
      }
    }

    await startRepl(endpoint, {
      types,
      historyPath: options.history,
    })
  })

// Default OAuth configuration
const DEFAULT_CLIENT_ID = 'rpc-do-cli'
const DEFAULT_OAUTH_URL = 'https://oauth.do'

// OAuth provider presets
const OAUTH_PROVIDERS: Record<string, { clientId: string; oauthUrl: string }> = {
  'oauth.do': { clientId: 'rpc-do-cli', oauthUrl: 'https://oauth.do' },
  github: { clientId: 'rpc-do-github', oauthUrl: 'https://github.com/login/oauth' },
  google: { clientId: 'rpc-do-google', oauthUrl: 'https://accounts.google.com/o/oauth2' },
}

program
  .command('login')
  .description('Authenticate with OAuth device flow')
  .option('--force', 'Force re-authentication even if already logged in')
  .option('--provider <name>', 'OAuth provider preset (oauth.do, github, google)', 'oauth.do')
  .option('--client-id <id>', 'OAuth client ID (overrides provider preset)')
  .option('--oauth-url <url>', 'OAuth server URL (overrides provider preset)')
  .action(async (options: { force?: boolean; provider: string; clientId?: string; oauthUrl?: string }) => {
    // Get provider preset or use defaults
    const preset = OAUTH_PROVIDERS[options.provider] ?? { clientId: DEFAULT_CLIENT_ID, oauthUrl: DEFAULT_OAUTH_URL }

    // Allow explicit overrides
    const clientId = options.clientId ?? preset.clientId
    const oauthUrl = options.oauthUrl ?? preset.oauthUrl

    const { deviceFlow, tokenStore } = createDefaultLoginOptions({
      clientId,
      oauthBaseUrl: oauthUrl,
    })

    // Handle Ctrl+C gracefully during login
    const abortController = new AbortController()
    const onSignal = () => {
      console.log('\nLogin cancelled.')
      abortController.abort()
      process.exit(130) // Standard exit code for Ctrl+C
    }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)

    try {
      const result = await loginCommand({
        deviceFlow,
        tokenStore,
        force: options.force,
        onOutput: (message) => console.log(message),
      })

      if (!result.success) {
        process.exit(1)
      }
    } finally {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
    }
  })

program
  .command('logout')
  .description('Clear stored authentication tokens')
  .action(async () => {
    const { tokenStore } = createDefaultLoginOptions({
      clientId: DEFAULT_CLIENT_ID,
      oauthBaseUrl: DEFAULT_OAUTH_URL,
    })

    const result = await logoutCommand({
      tokenStore,
      onOutput: (message) => console.log(message),
    })

    if (!result.success) {
      process.exit(1)
    }
  })

program
  .command('whoami')
  .description('Show current authentication status')
  .action(async () => {
    const { tokenStore } = createDefaultLoginOptions({
      clientId: DEFAULT_CLIENT_ID,
      oauthBaseUrl: DEFAULT_OAUTH_URL,
    })

    const result = await whoamiCommand({
      tokenStore,
      onOutput: (message) => console.log(message),
    })

    if (!result.success) {
      process.exit(1)
    }
  })

program.parse()
