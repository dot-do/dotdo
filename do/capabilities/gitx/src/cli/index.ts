/**
 * @fileoverview CLI Entry Point for gitx
 *
 * This module provides the main command-line interface for gitx, a git-compatible
 * version control system. It handles argument parsing, command routing, and
 * provides the foundation for all CLI subcommands.
 *
 * @module cli/index
 *
 * @example
 * // Create and run CLI programmatically
 * import { createCLI, runCLI } from './cli'
 *
 * const cli = createCLI({ name: 'gitx', version: '1.0.0' })
 * cli.registerCommand('status', statusHandler)
 * await cli.run(['status', '--short'])
 *
 * @example
 * // Parse arguments without running
 * import { parseArgs } from './cli'
 *
 * const parsed = parseArgs(['status', '--short', '--branch'])
 * console.log(parsed.command) // 'status'
 * console.log(parsed.options) // { short: true, branch: true }
 */

import cac from 'cac'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { checkoutCommand } from './commands/checkout'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for configuring CLI behavior.
 *
 * @description Allows customization of CLI execution including working directory,
 * and output streams for testing or embedding scenarios.
 *
 * @property cwd - Working directory for command execution. Defaults to process.cwd().
 * @property stdout - Custom function for standard output. Defaults to console.log.
 * @property stderr - Custom function for error output. Defaults to console.error.
 *
 * @example
 * const options: CLIOptions = {
 *   cwd: '/path/to/repo',
 *   stdout: (msg) => output.push(msg),
 *   stderr: (msg) => errors.push(msg)
 * }
 */
export interface CLIOptions {
  /** Working directory for command execution */
  cwd?: string
  /** Custom function for standard output */
  stdout?: (msg: string) => void
  /** Custom function for error output */
  stderr?: (msg: string) => void
}

/**
 * Result returned from CLI command execution.
 *
 * @description Contains the exit code, executed command name, and any error
 * that occurred during execution. Used to determine success/failure of CLI operations.
 *
 * @property exitCode - Exit code (0 for success, non-zero for failure)
 * @property command - The command that was executed, if any
 * @property error - Error object if command failed
 *
 * @example
 * const result = await cli.run(['status'])
 * if (result.exitCode !== 0) {
 *   console.error(`Command ${result.command} failed:`, result.error?.message)
 * }
 */
export interface CLIResult {
  /** Exit code (0 for success, non-zero for failure) */
  exitCode: number
  /** The command that was executed, if any */
  command?: string
  /** Error object if command failed */
  error?: Error
}

/**
 * Parsed command-line arguments structure.
 *
 * @description Contains the parsed representation of CLI arguments including
 * the command name, positional arguments, options/flags, and working directory.
 *
 * @property command - The subcommand to execute (e.g., 'status', 'diff')
 * @property args - Positional arguments after the command
 * @property options - Key-value pairs of parsed options/flags
 * @property rawArgs - Arguments after '--' separator (passed through unchanged)
 * @property cwd - Working directory for command execution
 *
 * @example
 * // Parsing 'gitx status --short file.txt'
 * const parsed: ParsedArgs = {
 *   command: 'status',
 *   args: ['file.txt'],
 *   options: { short: true },
 *   rawArgs: [],
 *   cwd: '/path/to/repo'
 * }
 */
export interface ParsedArgs {
  /** The subcommand to execute (e.g., 'status', 'diff') */
  command?: string
  /** Positional arguments after the command */
  args: string[]
  /** Key-value pairs of parsed options/flags */
  options: Record<string, any>
  /** Arguments after '--' separator (passed through unchanged) */
  rawArgs: string[]
  /** Working directory for command execution */
  cwd: string
}

/**
 * Context object passed to command handlers.
 *
 * @description Provides command handlers with all necessary context including
 * the working directory, arguments, options, and I/O functions.
 *
 * @property cwd - Current working directory for the command
 * @property args - Positional arguments passed to the command
 * @property options - Parsed options/flags for the command
 * @property rawArgs - Raw arguments after '--' separator
 * @property stdout - Function to write to standard output
 * @property stderr - Function to write to standard error
 *
 * @example
 * async function statusHandler(ctx: CommandContext): Promise<void> {
 *   const { cwd, options, stdout } = ctx
 *   const status = await getStatus(cwd)
 *   if (options.short) {
 *     stdout(formatShort(status))
 *   } else {
 *     stdout(formatLong(status))
 *   }
 * }
 */
export interface CommandContext {
  /** Current working directory for the command */
  cwd: string
  /** Positional arguments passed to the command */
  args: string[]
  /** Parsed options/flags for the command */
  options: Record<string, any>
  /** Raw arguments after '--' separator */
  rawArgs: string[]
  /** Function to write to standard output */
  stdout: (msg: string) => void
  /** Function to write to standard error */
  stderr: (msg: string) => void
}

/**
 * Function type for command handlers.
 *
 * @description Command handlers receive a CommandContext and may return
 * void or a Promise for async operations. Errors should be thrown
 * to indicate failure.
 *
 * @param ctx - The command context with args, options, and I/O
 * @returns void or Promise<void>
 *
 * @example
 * const myHandler: CommandHandler = async (ctx) => {
 *   ctx.stdout('Hello from command!')
 * }
 */
type CommandHandler = (ctx: CommandContext) => void | Promise<void>

// ============================================================================
// Constants
// ============================================================================

/** Available subcommands for the CLI */
const SUBCOMMANDS = ['status', 'diff', 'log', 'blame', 'commit', 'branch', 'checkout', 'review', 'web'] as const

/** Current CLI version */
const VERSION = '0.0.1'

/** CLI name */
const NAME = 'gitx'

// ============================================================================
// CLI Class
// ============================================================================

/**
 * Main CLI class for gitx command-line interface.
 *
 * @description Provides command registration, argument parsing, help generation,
 * and command execution. Supports custom output streams for testing.
 *
 * @example
 * const cli = new CLI({ name: 'gitx', version: '1.0.0' })
 * cli.registerCommand('status', statusHandler)
 * const result = await cli.run(['status', '--short'])
 *
 * @example
 * // With custom output streams for testing
 * const output: string[] = []
 * const cli = new CLI({
 *   stdout: (msg) => output.push(msg),
 *   stderr: (msg) => output.push(`ERROR: ${msg}`)
 * })
 */
export class CLI {
  /** The name of the CLI tool */
  public name: string

  /** The version of the CLI tool */
  public version: string

  /** Registered command handlers */
  private handlers: Map<string, CommandHandler> = new Map()

  /** Function for standard output */
  private stdout: (msg: string) => void

  /** Function for error output */
  private stderr: (msg: string) => void

  /**
   * Creates a new CLI instance.
   *
   * @description Initializes the CLI with optional name, version, and I/O functions.
   * Defaults are provided for all options.
   *
   * @param options - Configuration options
   * @param options.name - CLI name (default: 'gitx')
   * @param options.version - CLI version (default: '0.0.1')
   * @param options.stdout - Standard output function (default: console.log)
   * @param options.stderr - Error output function (default: console.error)
   *
   * @example
   * const cli = new CLI({ name: 'my-tool', version: '2.0.0' })
   */
  constructor(options: { name?: string; version?: string; stdout?: (msg: string) => void; stderr?: (msg: string) => void } = {}) {
    this.name = options.name ?? NAME
    this.version = options.version ?? VERSION
    this.stdout = options.stdout ?? console.log
    this.stderr = options.stderr ?? console.error
  }

  /**
   * Registers a command handler for a subcommand.
   *
   * @description Associates a handler function with a command name. The handler
   * will be invoked when that command is executed.
   *
   * @param name - The command name (e.g., 'status', 'diff')
   * @param handler - The function to handle the command
   *
   * @example
   * cli.registerCommand('status', async (ctx) => {
   *   const status = await getStatus(ctx.cwd)
   *   ctx.stdout(formatStatus(status))
   * })
   */
  registerCommand(name: string, handler: CommandHandler): void {
    this.handlers.set(name, handler)
  }

  /**
   * Runs the CLI with the provided arguments.
   *
   * @description Parses arguments, handles help/version flags, validates commands,
   * and executes the appropriate handler. Returns a result object with exit code.
   *
   * @param args - Command-line arguments (excluding 'node' and script name)
   * @param options - Run options
   * @param options.skipCwdCheck - Skip validation of --cwd directory existence
   * @returns Promise<CLIResult> with exitCode, command, and potential error
   *
   * @throws Never throws directly - errors are captured in CLIResult.error
   *
   * @example
   * const result = await cli.run(['status', '--short'])
   * if (result.exitCode === 0) {
   *   console.log('Success!')
   * } else {
   *   console.error('Failed:', result.error?.message)
   * }
   *
   * @example
   * // Skip cwd validation for testing
   * const result = await cli.run(['status'], { skipCwdCheck: true })
   */
  async run(args: string[], options: { skipCwdCheck?: boolean } = {}): Promise<CLIResult> {
    const parsed = parseArgs(args)

    // Check for help flag
    if (parsed.options.help || parsed.options.h) {
      // If there's a registered handler, let it handle its own help
      if (parsed.command && this.handlers.has(parsed.command)) {
        // Pass through to handler - it will handle --help itself
      } else if (parsed.command) {
        this.stdout(this.getSubcommandHelp(parsed.command))
        return { exitCode: 0, command: parsed.command }
      } else {
        this.stdout(this.getHelp())
        return { exitCode: 0, command: parsed.command }
      }
    }

    // Check for version flag (only when no command is specified)
    // When a command is present, -v should be interpreted as verbose for that command
    if (!parsed.command && (parsed.options.version || parsed.options.v)) {
      this.stdout(`${this.name} ${this.version}`)
      return { exitCode: 0 }
    }
    // For --version flag without command
    if (!parsed.command && parsed.options.version) {
      this.stdout(`${this.name} ${this.version}`)
      return { exitCode: 0 }
    }

    // Check for unknown flags (flags starting with -- that aren't recognized)
    // Skip flag validation for registered commands - they handle their own flags
    if (parsed.command && this.handlers.has(parsed.command)) {
      // Skip flag validation for registered commands
    } else {
      const knownFlags = ['cwd', 'C', 'help', 'h', 'version', 'v', 'short', 'branch', 'staged',
        'cached', 'n', 'oneline', 'graph', 'all', 'format', 'L', 'm', 'amend', 'a', 'd', 'D', 'list',
        'interactive', 'port', 'open', 'verbose', 'vv', 'u', 'includeUntracked', 'keepIndex', 'index',
        'message', 'quiet', 'q', 'pathspec', 'force', 'f', 'b', 'B', 'track', 't', 'merge', 'detach',
        'orphan', 'theirs', 'ours', 'conflict', 'patch', 'p', 'ff', 'ffOnly', 'squash', 'abort',
        'continue', 'strategy', 'strategyOption', 'update', 'dryRun', 'intentToAdd', 'refresh', 'A', 'N']
      for (const key of Object.keys(parsed.options)) {
        if (!knownFlags.includes(key) && key !== '--') {
          this.stderr(`Unknown option: --${key}\nRun 'gitx --help' for available commands.`)
          return { exitCode: 1, error: new Error(`Unknown option: --${key}`) }
        }
      }
    }

    // If no command, show help
    if (!parsed.command) {
      this.stdout(this.getHelp())
      return { exitCode: 0 }
    }

    // Check if command exists
    if (!SUBCOMMANDS.includes(parsed.command as any) && !this.handlers.has(parsed.command)) {
      const suggestion = this.suggestCommand(parsed.command)
      let errorMsg = `Unknown command: ${parsed.command}`
      if (suggestion) {
        errorMsg += `\nDid you mean '${suggestion}'?`
      }
      errorMsg += `\nRun 'gitx --help' for available commands.`
      this.stderr(errorMsg)
      return { exitCode: 1, command: parsed.command, error: new Error(`Unknown command: ${parsed.command}`) }
    }

    // Execute command handler if registered
    const handler = this.handlers.get(parsed.command)
    if (handler) {
      try {
        await handler({
          cwd: parsed.cwd,
          args: parsed.args,
          options: parsed.options,
          rawArgs: parsed.rawArgs,
          stdout: this.stdout,
          stderr: this.stderr
        })
        return { exitCode: 0, command: parsed.command }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.stderr(`Error: ${error.message}`)
        return { exitCode: 1, command: parsed.command, error }
      }
    }

    // Check if --cwd directory exists (only for built-in commands without handlers)
    if (parsed.cwd !== process.cwd() && !options.skipCwdCheck) {
      if (!existsSync(parsed.cwd)) {
        this.stderr(`Error: directory does not exist: ${parsed.cwd}`)
        return { exitCode: 1, command: parsed.command, error: new Error(`directory does not exist: ${parsed.cwd}`) }
      }
    }

    // Default behavior for built-in commands without handler
    return { exitCode: 0, command: parsed.command }
  }

  /**
   * Generates the main help text for the CLI.
   *
   * @description Creates formatted help output showing available commands,
   * options, and usage information.
   *
   * @returns Formatted help string
   */
  private getHelp(): string {
    return `${this.name} v${this.version}

Usage: ${this.name} [options] <command> [args...]

Commands:
  status    Show the working tree status
  diff      Show changes between commits
  log       Show commit logs
  blame     Show what revision and author last modified each line
  commit    Record changes to the repository
  branch    List, create, or delete branches
  checkout  Switch branches or restore working tree files
  review    Review pull requests
  web       Start the web interface

Options:
  -h, --help     Show help
  -v, --version  Show version
  -C, --cwd      Set the working directory`
  }

  /**
   * Generates help text for a specific subcommand.
   *
   * @description Creates formatted help output for a specific command
   * including its description and usage pattern.
   *
   * @param command - The command name to get help for
   * @returns Formatted help string for the command
   */
  private getSubcommandHelp(command: string): string {
    const descriptions: Record<string, string> = {
      status: 'Show the working tree status',
      diff: 'Show changes between commits',
      log: 'Show commit logs',
      blame: 'Show what revision and author last modified each line',
      commit: 'Record changes to the repository',
      branch: 'List, create, or delete branches',
      checkout: 'Switch branches or restore working tree files',
      review: 'Review pull requests',
      web: 'Start the web interface'
    }

    return `${this.name} ${command}

${descriptions[command] || 'Command help'}

Usage: ${this.name} ${command} [options] [args...]`
  }

  /**
   * Suggests a command based on a misspelled input.
   *
   * @description Uses Levenshtein distance to find the closest matching
   * command when the user enters an unknown command. Only suggests
   * commands within a distance of 3 edits.
   *
   * @param input - The misspelled command input
   * @returns The suggested command name, or null if no close match
   */
  private suggestCommand(input: string): string | null {
    // Simple Levenshtein distance for typo detection
    let minDistance = Infinity
    let suggestion: string | null = null

    for (const cmd of SUBCOMMANDS) {
      const distance = levenshteinDistance(input, cmd)
      if (distance < minDistance && distance <= 3) {
        minDistance = distance
        suggestion = cmd
      }
    }

    return suggestion
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculates the Levenshtein distance between two strings.
 *
 * @description Computes the minimum number of single-character edits
 * (insertions, deletions, or substitutions) required to change one
 * string into the other. Used for command suggestion/typo detection.
 *
 * @param a - First string
 * @param b - Second string
 * @returns The edit distance between the strings
 *
 * @example
 * levenshteinDistance('status', 'staus') // Returns 1
 * levenshteinDistance('commit', 'comit') // Returns 1
 * levenshteinDistance('diff', 'branch') // Returns 6
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Creates a new CLI instance with the provided options.
 *
 * @description Factory function for creating CLI instances. Provides a
 * convenient way to instantiate the CLI with custom configuration.
 *
 * @param options - Configuration options for the CLI
 * @param options.name - CLI name (default: 'gitx')
 * @param options.version - CLI version (default: '0.0.1')
 * @param options.stdout - Standard output function (default: console.log)
 * @param options.stderr - Error output function (default: console.error)
 * @returns A new CLI instance
 *
 * @example
 * const cli = createCLI({ name: 'my-git', version: '1.0.0' })
 * cli.registerCommand('status', statusHandler)
 * await cli.run(['status'])
 *
 * @example
 * // For testing with captured output
 * const output: string[] = []
 * const cli = createCLI({
 *   stdout: (msg) => output.push(msg)
 * })
 */
export function createCLI(options: { name?: string; version?: string; stdout?: (msg: string) => void; stderr?: (msg: string) => void } = {}): CLI {
  return new CLI(options)
}

/**
 * Parses command-line arguments into a structured format.
 *
 * @description Uses the cac library to parse arguments, extracting the command,
 * positional arguments, options/flags, and handling special cases like --cwd
 * and the '--' separator for raw arguments.
 *
 * @param args - Array of command-line arguments (excluding 'node' and script name)
 * @returns ParsedArgs object with command, args, options, rawArgs, and cwd
 *
 * @example
 * const parsed = parseArgs(['status', '--short', '--branch'])
 * // Returns: {
 * //   command: 'status',
 * //   args: [],
 * //   options: { short: true, branch: true },
 * //   rawArgs: [],
 * //   cwd: process.cwd()
 * // }
 *
 * @example
 * const parsed = parseArgs(['--cwd', '/repo', 'diff', '--staged'])
 * // Returns: {
 * //   command: 'diff',
 * //   args: [],
 * //   options: { staged: true, cwd: '/repo' },
 * //   rawArgs: [],
 * //   cwd: '/repo'
 * // }
 *
 * @example
 * // With raw args after '--'
 * const parsed = parseArgs(['commit', '-m', 'msg', '--', 'file.txt'])
 * // Returns: {
 * //   command: 'commit',
 * //   args: [],
 * //   options: { m: 'msg' },
 * //   rawArgs: ['file.txt'],
 * //   cwd: process.cwd()
 * // }
 */
export function parseArgs(args: string[]): ParsedArgs {
  const cli = cac('gitx')

  // Global options
  cli.option('-C, --cwd <path>', 'Set the working directory')
  cli.option('-h, --help', 'Show help')
  cli.option('-v, --version', 'Show version')

  // Status command options
  cli.option('--short', 'Give the output in short format')
  cli.option('--branch', 'Show the branch info')

  // Diff command options
  cli.option('--staged', 'Show staged changes')
  cli.option('--cached', 'Show cached changes (alias for staged)')

  // Log command options
  cli.option('-n <count>', 'Limit the number of commits')
  cli.option('--oneline', 'Show each commit on a single line')
  cli.option('--graph', 'Draw a text-based graph')
  cli.option('--all', 'Show all refs')
  cli.option('--format <format>', 'Pretty-print format')

  // Blame command options
  cli.option('-L <range>', 'Line range')

  // Commit command options
  cli.option('-m <message>', 'Commit message')
  cli.option('--amend', 'Amend the previous commit')
  cli.option('-a', 'Stage all modified files')

  // Branch command options
  cli.option('-d', 'Delete a branch')
  cli.option('-D', 'Force delete a branch')
  cli.option('--list', 'List branches')
  cli.option('-v, --verbose', 'Verbose output')
  cli.option('-vv', 'Very verbose output')

  // Review command options
  cli.option('--interactive', 'Interactive review mode')

  // Web command options
  cli.option('--port <port>', 'Port number')
  cli.option('--open', 'Open in browser')

  // Stash command options
  cli.option('-u, --include-untracked', 'Include untracked files')
  cli.option('--keep-index', 'Keep staged changes in the index')
  cli.option('--index', 'Restore the index state')
  cli.option('-q, --quiet', 'Quiet mode')

  // Checkout command options
  cli.option('-b <branch>', 'Create and checkout a new branch')
  cli.option('-B <branch>', 'Create/reset and checkout a branch')
  cli.option('-f, --force', 'Force checkout')
  cli.option('--detach', 'Detach HEAD at commit')
  cli.option('--orphan <branch>', 'Create orphan branch')
  cli.option('-t, --track', 'Set up tracking mode')
  cli.option('--merge', 'Merge with current branch')
  cli.option('--theirs', 'Checkout theirs version for conflicts')
  cli.option('--ours', 'Checkout ours version for conflicts')
  cli.option('--conflict <style>', 'Conflict style')
  cli.option('-p, --patch', 'Select hunks interactively')

  // Merge command options
  cli.option('--no-ff', 'Create a merge commit even when fast-forward is possible')
  cli.option('--ff-only', 'Refuse to merge unless fast-forward is possible')
  cli.option('--squash', 'Squash commits without creating merge commit')
  cli.option('--abort', 'Abort the current in-progress merge')
  cli.option('--continue', 'Continue the merge after resolving conflicts')
  cli.option('--strategy <strategy>', 'Use the given merge strategy')
  cli.option('--strategy-option <option>', 'Pass option to merge strategy')

  // Add command options
  cli.option('-A, --all', 'Add all files (new, modified, deleted)')
  cli.option('--update', 'Update tracked files only')
  cli.option('--dry-run', 'Show what would be added')
  cli.option('-N, --intent-to-add', 'Record that the path will be added later')
  cli.option('--refresh', "Don't add, just refresh stat info")

  // Parse arguments
  const parsed = cli.parse(['node', 'gitx', ...args], { run: false })

  // Extract command and args
  const positionalArgs = parsed.args.slice() // Clone to avoid mutation
  let command: string | undefined
  const commandArgs: string[] = []
  let rawArgs: string[] = []

  // Find command from positional args
  for (let i = 0; i < positionalArgs.length; i++) {
    const arg = positionalArgs[i]
    if (!command && SUBCOMMANDS.includes(arg as any)) {
      command = arg
    } else if (arg === '--') {
      rawArgs = positionalArgs.slice(i + 1)
      break
    } else if (command) {
      commandArgs.push(arg)
    } else if (!arg.startsWith('-')) {
      // This is either a command we don't recognize or a positional arg before command
      command = arg
    }
  }

  // Handle --cwd option
  let cwd = process.cwd()
  if (parsed.options.cwd) {
    cwd = resolve(process.cwd(), parsed.options.cwd)
  } else if (parsed.options.C) {
    cwd = resolve(process.cwd(), parsed.options.C)
  }

  // Get rawArgs from cac's '--' key
  if (parsed.options['--'] && Array.isArray(parsed.options['--'])) {
    rawArgs = parsed.options['--']
  }

  // Clean up options object
  const options = { ...parsed.options }
  delete options['--']

  // Convert numeric options (only if they look like numbers)
  if (options.n !== undefined && typeof options.n === 'string') {
    const parsed = parseInt(options.n, 10)
    // Only convert if it's a valid number (for log command)
    // For add command, -n file.txt should keep 'file.txt' as string
    if (!isNaN(parsed)) {
      options.n = parsed
    }
    // Otherwise keep as string for add command to handle
  }
  if (options.port !== undefined && typeof options.port === 'string') {
    options.port = parseInt(options.port, 10)
  }

  return {
    command,
    args: commandArgs,
    options,
    rawArgs,
    cwd
  }
}

/**
 * Convenience function to create a CLI and run it with the provided arguments.
 *
 * @description Creates a new CLI instance with the provided options and
 * immediately runs it with the given arguments. Useful for simple one-off
 * CLI executions.
 *
 * @param args - Command-line arguments to run
 * @param options - CLI options including output streams
 * @returns Promise<CLIResult> with exitCode, command, and potential error
 *
 * @example
 * const result = await runCLI(['status', '--short'])
 * console.log(result.exitCode) // 0 or 1
 *
 * @example
 * // With custom output handling
 * const output: string[] = []
 * const result = await runCLI(['status'], {
 *   stdout: (msg) => output.push(msg),
 *   stderr: (msg) => console.error(msg)
 * })
 */
export async function runCLI(args: string[], options: CLIOptions = {}): Promise<CLIResult> {
  const cli = createCLI({
    stdout: options.stdout,
    stderr: options.stderr
  })

  // Register built-in command handlers
  cli.registerCommand('checkout', checkoutCommand)

  return cli.run(args)
}
