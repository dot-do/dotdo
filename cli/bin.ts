#!/usr/bin/env bun
/**
 * CLI Entry Point (Direct Bun execution)
 *
 * This file is for direct bun execution (bunx dotdo).
 * For npm/npx, use bin.js which spawns bun.
 *
 * Uses the unified Commander-based CLI from main.ts.
 */

import { program } from './main'

/**
 * Main CLI function
 */
export async function main(argv: string[]): Promise<void> {
  // Parse with Commander - use 'user' mode to skip automatic process.argv handling
  program.parse(argv, { from: 'user' })
}

// Run if executed directly
if (import.meta.main) {
  // Parse process.argv directly with Commander
  program.parse()
}
