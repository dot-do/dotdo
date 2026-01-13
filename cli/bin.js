#!/usr/bin/env node
/**
 * CLI Entry Point (Node.js wrapper)
 *
 * Spawns bun to run the TypeScript CLI.
 * Bun is installed as a dependency, so it's available in node_modules/.bin/bun
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const bunPath = join(__dirname, '..', 'node_modules', '.bin', 'bun')
const mainTs = join(__dirname, 'main.ts')

// Spawn bun with the TypeScript entry point
const child = spawn(bunPath, [mainTs, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})

child.on('close', (code) => {
  process.exit(code ?? 0)
})

child.on('error', (err) => {
  // Fallback: try global bun if local not found
  if (err.code === 'ENOENT') {
    const fallback = spawn('bun', [mainTs, ...process.argv.slice(2)], {
      stdio: 'inherit',
      env: process.env,
    })

    fallback.on('close', (code) => process.exit(code ?? 0))
    fallback.on('error', () => {
      console.error('Error: Could not find bun. Please run: npm install')
      process.exit(1)
    })
  } else {
    console.error('Error:', err.message)
    process.exit(1)
  }
})
