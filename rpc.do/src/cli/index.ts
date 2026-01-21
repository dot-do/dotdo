#!/usr/bin/env node
// rpc.do CLI - Command line interface for RPC operations
// Main entry point using commander

import { Command } from 'commander'
import { pull } from './pull'

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

program.parse()
