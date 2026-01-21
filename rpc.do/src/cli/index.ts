#!/usr/bin/env node
// rpc.do CLI - Command line interface for RPC operations
// Main entry point using commander

import { Command } from 'commander'
import { pull } from './pull'
import { evalCommand, runCommand } from './eval'

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

program.parse()
