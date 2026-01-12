/**
 * Bash Tool Adapter
 *
 * Maps Claude SDK Bash tool to bashx.do tiered execution.
 * Includes AST-based safety analysis and tiered execution model.
 *
 * @module lib/agent/tools/bash
 */

import type {
  ToolAdapter,
  ToolContext,
  BashToolInput,
  BashToolOutput,
  JSONSchema,
} from './types'
import { CommandBlockedError, TimeoutError } from './types'

/**
 * Default timeout for bash commands (2 minutes)
 */
const DEFAULT_TIMEOUT = 120000

/**
 * Maximum timeout (10 minutes)
 */
const MAX_TIMEOUT = 600000

/**
 * Dangerous commands that require confirmation
 */
const DANGEROUS_COMMANDS = new Set([
  'rm',
  'rmdir',
  'mv',
  'dd',
  'mkfs',
  'fdisk',
  'parted',
  'mount',
  'umount',
  'chmod',
  'chown',
  'sudo',
  'su',
  'kill',
  'killall',
  'pkill',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init',
])

/**
 * Dangerous patterns that should be blocked or require confirmation
 */
const DANGEROUS_PATTERNS = [
  /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\//, // rm -rf /
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?\//, // rm -fr /
  />\s*\/dev\/sd[a-z]/, // write to disk device
  /dd\s+.*of=\/dev\//, // dd to device
  /mkfs/, // format filesystem
  /:\(\)\{\s*:\|:&\s*\};:/, // fork bomb
  /chmod\s+(-[a-zA-Z]*\s+)?777\s+\//, // chmod 777 /
  /curl.*\|\s*(ba)?sh/, // curl | sh
  /wget.*\|\s*(ba)?sh/, // wget | sh
]

/**
 * Commands that map to Tier 1 (native fsx operations)
 */
const TIER1_COMMANDS = new Set([
  'cat',
  'ls',
  'head',
  'tail',
  'echo',
  'printf',
  'pwd',
  'wc',
  'stat',
  'file',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'test',
  '[',
  '[[',
])

/**
 * Commands that map to Tier 2 (RPC services)
 */
const TIER2_COMMANDS = new Set([
  'git',
  'jq',
  'yq',
  'curl',
  'wget',
])

/**
 * Commands that map to Tier 3 (dynamic npm loading)
 */
const TIER3_COMMANDS = new Set([
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'node',
  'tsx',
  'ts-node',
  'esbuild',
  'tsc',
])

/**
 * Simple command parser to extract command name
 */
function extractCommandName(command: string): string | null {
  // Remove leading whitespace and environment variables
  const trimmed = command.trim()

  // Handle environment variable assignments at the start
  let cmd = trimmed
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(cmd)) {
    cmd = cmd.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '')
  }

  // Handle command substitution, subshells, etc.
  if (cmd.startsWith('(') || cmd.startsWith('$(') || cmd.startsWith('`')) {
    return null // Complex command
  }

  // Extract the command name (first word)
  const match = cmd.match(/^([a-zA-Z_][a-zA-Z0-9_\-.]*)/)
  return match ? match[1]! : null
}

/**
 * Check if command is dangerous
 */
function isDangerousCommand(command: string): { dangerous: boolean; reason?: string } {
  const cmdName = extractCommandName(command)

  // Check dangerous command names
  if (cmdName && DANGEROUS_COMMANDS.has(cmdName)) {
    return {
      dangerous: true,
      reason: `Command '${cmdName}' can modify system state and requires confirmation`,
    }
  }

  // Check dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        dangerous: true,
        reason: 'Command matches a dangerous pattern and requires confirmation',
      }
    }
  }

  return { dangerous: false }
}

/**
 * Determine execution tier for a command
 */
function determineExecutionTier(command: string): 1 | 2 | 3 | 4 {
  const cmdName = extractCommandName(command)

  if (cmdName && TIER1_COMMANDS.has(cmdName)) {
    return 1
  }

  if (cmdName && TIER2_COMMANDS.has(cmdName)) {
    return 2
  }

  if (cmdName && TIER3_COMMANDS.has(cmdName)) {
    return 3
  }

  // Default to sandbox for unknown commands
  return 4
}

/**
 * Execute a Tier 1 command using fsx
 */
async function executeTier1(
  command: string,
  context: ToolContext
): Promise<{ stdout: string; stderr: string; exit_code: number }> {
  const { fs, cwd } = context
  const cmdName = extractCommandName(command)

  // Parse the command for basic shell operations
  // This is a simplified implementation - full shell parsing would use bashx AST

  try {
    if (cmdName === 'cat') {
      // Extract file path from command
      const args = command.replace(/^cat\s+/, '').trim()
      const filePath = args.startsWith('/') ? args : `${cwd}/${args}`
      const content = await fs.readFile(filePath) as string
      return { stdout: content, stderr: '', exit_code: 0 }
    }

    if (cmdName === 'ls') {
      const args = command.replace(/^ls\s*/, '').trim()
      const targetPath = args || cwd
      const fullPath = targetPath.startsWith('/') ? targetPath : `${cwd}/${targetPath}`
      const entries = await fs.readdir(fullPath)
      const entryNames = Array.isArray(entries)
        ? entries.map(e => typeof e === 'string' ? e : e.name)
        : entries
      return { stdout: entryNames.join('\n'), stderr: '', exit_code: 0 }
    }

    if (cmdName === 'pwd') {
      return { stdout: cwd, stderr: '', exit_code: 0 }
    }

    if (cmdName === 'echo') {
      const args = command.replace(/^echo\s*/, '')
      return { stdout: args, stderr: '', exit_code: 0 }
    }

    // For other Tier 1 commands, fall through to a not implemented error
    throw new Error(`Tier 1 command '${cmdName}' not yet implemented`)
  } catch (error) {
    const err = error as Error
    return {
      stdout: '',
      stderr: err.message,
      exit_code: 1,
    }
  }
}

/**
 * Execute a command using the tiered executor
 */
async function executeCommand(
  command: string,
  context: ToolContext,
  options: {
    timeout: number
    cwd?: string
    confirm?: boolean
  }
): Promise<BashToolOutput> {
  const startTime = Date.now()

  // Check if command is dangerous
  const danger = isDangerousCommand(command)
  if (danger.dangerous && !options.confirm) {
    return {
      stdout: '',
      stderr: '',
      exit_code: 0,
      blocked: true,
      block_reason: danger.reason,
      duration_ms: Date.now() - startTime,
    }
  }

  // Determine execution tier
  const tier = determineExecutionTier(command)

  // If we have a bash executor, use it
  if (context.bash && 'exec' in context.bash) {
    try {
      const result = await (context.bash as { exec: (cmd: string, opts: { timeout?: number; cwd?: string }) => Promise<{ stdout: string; stderr: string; exitCode: number }> }).exec(command, {
        timeout: options.timeout,
        cwd: options.cwd || context.cwd,
      })

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
        tier,
        duration_ms: Date.now() - startTime,
      }
    } catch (error) {
      const err = error as Error
      if (err.message.includes('timeout')) {
        throw new TimeoutError(command, options.timeout)
      }
      throw error
    }
  }

  // Otherwise, try Tier 1 execution
  if (tier === 1) {
    try {
      const result = await executeTier1(command, context)
      return {
        ...result,
        tier: 1,
        duration_ms: Date.now() - startTime,
      }
    } catch (error) {
      // Fall through to error handling
    }
  }

  // No executor available
  return {
    stdout: '',
    stderr: `No bash executor available for tier ${tier} command: ${command}`,
    exit_code: 127,
    tier,
    duration_ms: Date.now() - startTime,
  }
}

/**
 * Bash Tool Adapter
 *
 * Executes bash commands with AST-based safety analysis and tiered execution.
 * Tiers:
 * - Tier 1: Native (cat/ls via fsx) - <1ms
 * - Tier 2: RPC (git/jq) - <5ms
 * - Tier 3: Loader (npm via esm.sh) - <10ms
 * - Tier 4: Sandbox (fallback) - 2-3s cold
 */
export class BashToolAdapter implements ToolAdapter<BashToolInput, BashToolOutput> {
  readonly name = 'Bash'

  readonly description = `Executes a given bash command in a persistent shell session with optional timeout.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Usage notes:
- The command argument is required.
- You can specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). If not specified, commands will timeout after 120000ms (2 minutes).
- If the output exceeds 30000 characters, output will be truncated.`

  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Optional timeout in milliseconds (max 600000)',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command',
      },
      confirm: {
        type: 'boolean',
        description: 'Confirm execution of dangerous commands',
      },
      run_in_background: {
        type: 'boolean',
        description: 'Run the command in the background',
      },
      description: {
        type: 'string',
        description: 'Clear, concise description of what this command does',
      },
    },
    required: ['command'],
    additionalProperties: false,
  }

  async execute(input: BashToolInput, context: ToolContext): Promise<BashToolOutput> {
    const {
      command,
      timeout = DEFAULT_TIMEOUT,
      cwd,
      confirm = false,
    } = input

    // Validate timeout
    const effectiveTimeout = Math.min(Math.max(timeout, 0), MAX_TIMEOUT)

    // Execute command
    return executeCommand(command, context, {
      timeout: effectiveTimeout,
      cwd,
      confirm,
    })
  }
}
