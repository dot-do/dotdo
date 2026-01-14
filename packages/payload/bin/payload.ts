#!/usr/bin/env node
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import { existsSync, symlinkSync, unlinkSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const templateDir = join(__dirname, '..', 'template')
const userDir = process.cwd()
const userConfig = resolve(userDir, 'payload.config.ts')
const configLink = join(templateDir, 'payload.config.ts')

const VALID_COMMANDS = ['dev', 'build', 'start'] as const
type ValidCommand = typeof VALID_COMMANDS[number]

// Validate command
const [,, cmd = 'dev', ...args] = process.argv
if (!VALID_COMMANDS.includes(cmd as ValidCommand)) {
  console.error(`Error: Invalid command '${cmd}'`)
  console.error(`Valid commands: ${VALID_COMMANDS.join(', ')}`)
  process.exit(1)
}

// Check if user's payload.config.ts exists
if (!existsSync(userConfig)) {
  console.error('Error: payload.config.ts not found in current directory')
  console.error('Create a payload.config.ts file to get started.')
  process.exit(1)
}

// Symlink user's payload.config.ts into template
function createSymlink(): void {
  try {
    if (existsSync(configLink)) {
      unlinkSync(configLink)
    }
  } catch (err) {
    console.error('Error removing existing config symlink:', err)
    process.exit(1)
  }

  try {
    symlinkSync(userConfig, configLink)
  } catch (err) {
    console.error('Error creating config symlink:', err)
    process.exit(1)
  }
}

function cleanupSymlink(): void {
  try {
    if (existsSync(configLink)) {
      unlinkSync(configLink)
    }
  } catch {
    // Ignore cleanup errors on exit
  }
}

// Register cleanup handlers
process.on('SIGINT', () => {
  cleanupSymlink()
  process.exit(130)
})

process.on('SIGTERM', () => {
  cleanupSymlink()
  process.exit(143)
})

createSymlink()

// Run next from template directory
const next = spawn('npx', ['next', cmd, ...args], {
  cwd: templateDir,
  stdio: 'inherit',
  env: { ...process.env, PAYLOAD_CONFIG_PATH: userConfig }
})

next.on('exit', code => {
  cleanupSymlink()
  process.exit(code ?? 0)
})
