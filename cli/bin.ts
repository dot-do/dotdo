#!/usr/bin/env bun
/**
 * CLI Entry Point
 *
 * Main entry point for the `do` CLI command.
 * Requires Bun runtime: https://bun.sh
 */

// Runtime check for helpful error if run without Bun
if (typeof Bun === 'undefined') {
  console.error(`
dotdo CLI requires Bun runtime.

Install Bun:
  curl -fsSL https://bun.sh/install | bash

Then run:
  bunx dotdo <command>

Or install globally:
  bun add -g dotdo
  do <command>
`)
  process.exit(1)
}

import { route, parseArgv, helpText, version } from './index'
import { commands } from './commands/index'
import { fallback } from './fallback'

/**
 * Main CLI function
 */
export async function main(argv: string[]): Promise<void> {
  const result = route(argv)

  switch (result.type) {
    case 'help':
      console.log(helpText)
      break
    case 'version':
      console.log(version)
      break
    case 'command':
      await commands[result.name].run(result.args)
      break
    case 'fallback':
      await fallback(result.input)
      break
  }
}

// Run if executed directly
if (import.meta.main) {
  main(parseArgv(Bun.argv))
}
