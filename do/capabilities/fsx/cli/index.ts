/**
 * CLI for fsx - Filesystem operations
 *
 * Commands:
 * - ls [path]     - list directory contents
 * - cat <path>    - read file contents
 * - mkdir <path>  - create directory
 * - rm <path>     - remove file/directory
 * - cp <src> <dest> - copy file
 */

import cac from 'cac'
import type { CommandResult, LsEntry } from './types'
import { VERSION } from './version'
import {
  normalizeCLIPath,
  formatLsOutput,
  formatError,
  missingArgumentError,
  unknownCommandError,
  parseOptions,
} from './utils'
import { mainHelp, getCommandHelp } from './help'

// Re-export formatLsOutput for tests
export { formatLsOutput } from './utils'

/**
 * Mock filesystem interface for dependency injection
 */
interface MockFS {
  readFile: (path: string) => Promise<string>
  readFileBytes: (path: string) => Promise<Uint8Array>
  writeFile: (path: string, content: string | Uint8Array) => Promise<void>
  readdir: (path: string) => Promise<string[]>
  readdirWithTypes: (path: string) => Promise<Array<{ name: string; type: 'file' | 'directory' | 'symlink' }>>
  stat: (path: string) => Promise<{ size: number; mode: number; mtime: number; type: 'file' | 'directory' | 'symlink' }>
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>
  rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>
  cp: (src: string, dest: string, options?: { recursive?: boolean }) => Promise<void>
  exists: (path: string) => Promise<boolean>
}

/**
 * CLI context for dependency injection
 */
interface CLIContext {
  fs: MockFS
  stdout: (text: string) => void
  stderr: (text: string) => void
  exit: (code: number) => void
}

/**
 * Create and return the CLI instance with all commands registered
 */
export function createCLI() {
  const cli = cac('fsx')

  cli.version(VERSION)
  cli.help()

  // ls command
  cli.command('ls [path]', 'list directory contents')
    .option('-l, --long', 'Use long listing format')
    .option('-a, --all', 'Show hidden files (including . and ..)')
    .action(() => {}) // Placeholder - actual execution happens in runCLI

  // cat command
  cli.command('cat <files...>', 'read and concatenate file contents')
    .action(() => {})

  // mkdir command
  cli.command('mkdir <paths...>', 'create directories')
    .option('-p, --parents', 'Create parent directories as needed (recursive)')
    .action(() => {})

  // rm command
  cli.command('rm <paths...>', 'remove files or directories')
    .option('-r, -R, --recursive', 'Remove directories and their contents recursively')
    .option('-f, --force', 'Ignore nonexistent files, never prompt')
    .action(() => {})

  // cp command
  cli.command('cp <source> <dest>', 'copy files')
    .option('-r, -R, --recursive', 'Copy directories recursively')
    .action(() => {})

  return {
    name: 'fsx',
    parse: cli.parse.bind(cli),
    commands: ['ls', 'cat', 'mkdir', 'rm', 'cp'],
    cli
  }
}

/**
 * Execute a CLI command with the given arguments and context
 */
export async function runCLI(args: string[], context: CLIContext): Promise<CommandResult> {
  const { fs, stdout, stderr } = context

  // Handle --version and -v
  if (args.includes('--version') || args.includes('-v')) {
    stdout(VERSION)
    return { exitCode: 0 }
  }

  // Handle --help and -h at root level
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    if (args.length === 0 || (args.length === 1 && (args[0] === '--help' || args[0] === '-h'))) {
      stdout(mainHelp())
      return { exitCode: 0 }
    }
  }

  // Parse command
  const command = args[0]
  const restArgs = args.slice(1)

  // Handle command-specific help
  if (restArgs.includes('--help') || restArgs.includes('-h')) {
    const helpText = getCommandHelp(command)
    if (helpText) {
      stdout(helpText)
      return { exitCode: 0 }
    }
  }

  try {
    switch (command) {
      case 'ls':
        return await executeLs(restArgs, fs, stdout, stderr)

      case 'cat':
        return await executeCat(restArgs, fs, stdout, stderr)

      case 'mkdir':
        return await executeMkdir(restArgs, fs, stderr)

      case 'rm':
        return await executeRm(restArgs, fs, stderr)

      case 'cp':
        return await executeCp(restArgs, fs, stderr)

      default:
        stderr(unknownCommandError(command))
        return { exitCode: 1, error: `unknown command '${command}'` }
    }
  } catch (err: unknown) {
    const message = formatError(command, err)
    stderr(message)
    return { exitCode: 1, error: message }
  }
}

/**
 * Execute ls command
 */
async function executeLs(
  args: string[],
  fs: MockFS,
  stdout: (text: string) => void,
  stderr: (text: string) => void
): Promise<CommandResult> {
  const { options, paths } = parseOptions(args)
  const targetPath = normalizeCLIPath(paths[0] || '/')

  try {
    const stat = await fs.stat(targetPath)

    if (stat.type === 'file') {
      // ls on a file just shows the file
      const name = targetPath.split('/').pop() || targetPath
      const entry: LsEntry = {
        name,
        type: stat.type,
        size: stat.size,
        mode: stat.mode,
        mtime: stat.mtime
      }
      stdout(formatLsOutput([entry], { long: options.long, showAll: options.all }))
      return { exitCode: 0 }
    }

    // It's a directory
    const entries = await fs.readdirWithTypes(targetPath)
    const detailedEntries = await Promise.all(
      entries.map(async (e) => {
        const fullPath = targetPath === '/' ? `/${e.name}` : `${targetPath}/${e.name}`
        try {
          const entryStat = await fs.stat(fullPath)
          return {
            name: e.name,
            type: e.type,
            size: entryStat.size,
            mode: entryStat.mode,
            mtime: entryStat.mtime
          }
        } catch {
          return {
            name: e.name,
            type: e.type,
            size: 0,
            mode: 0o644,
            mtime: Date.now()
          }
        }
      })
    )

    stdout(formatLsOutput(detailedEntries, { long: options.long, showAll: options.all }))
    return { exitCode: 0 }
  } catch (err: unknown) {
    stderr(formatError('ls', err))
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, error: message }
  }
}

/**
 * Execute cat command
 */
async function executeCat(
  args: string[],
  fs: MockFS,
  stdout: (text: string) => void,
  stderr: (text: string) => void
): Promise<CommandResult> {
  const { paths } = parseOptions(args)

  if (paths.length === 0) {
    stderr(missingArgumentError('cat', 'file'))
    return { exitCode: 1, error: 'missing file argument' }
  }

  try {
    const contents: string[] = []
    for (const p of paths) {
      const normalizedPath = normalizeCLIPath(p)
      const content = await fs.readFile(normalizedPath)
      contents.push(content)
    }
    stdout(contents.join(''))
    return { exitCode: 0 }
  } catch (err: unknown) {
    stderr(formatError('cat', err))
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, error: message }
  }
}

/**
 * Execute mkdir command
 */
async function executeMkdir(
  args: string[],
  fs: MockFS,
  stderr: (text: string) => void
): Promise<CommandResult> {
  const { options, paths } = parseOptions(args)

  if (paths.length === 0) {
    stderr(missingArgumentError('mkdir', 'directory'))
    return { exitCode: 1, error: 'missing directory argument' }
  }

  try {
    for (const p of paths) {
      const normalizedPath = normalizeCLIPath(p)
      if (options.parents) {
        // With -p, don't error if exists
        try {
          await fs.mkdir(normalizedPath, { recursive: true })
        } catch (err: unknown) {
          const e = err as { code?: string }
          if (e.code !== 'EEXIST') throw err
        }
      } else {
        await fs.mkdir(normalizedPath)
      }
    }
    return { exitCode: 0 }
  } catch (err: unknown) {
    stderr(formatError('mkdir', err))
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, error: message }
  }
}

/**
 * Execute rm command
 */
async function executeRm(
  args: string[],
  fs: MockFS,
  stderr: (text: string) => void
): Promise<CommandResult> {
  const { options, paths } = parseOptions(args)

  if (paths.length === 0) {
    stderr(missingArgumentError('rm', 'file'))
    return { exitCode: 1, error: 'missing file argument' }
  }

  try {
    for (const p of paths) {
      const normalizedPath = normalizeCLIPath(p)
      await fs.rm(normalizedPath, {
        recursive: options.recursive,
        force: options.force
      })
    }
    return { exitCode: 0 }
  } catch (err: unknown) {
    stderr(formatError('rm', err))
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, error: message }
  }
}

/**
 * Execute cp command
 */
async function executeCp(
  args: string[],
  fs: MockFS,
  stderr: (text: string) => void
): Promise<CommandResult> {
  const { options, paths } = parseOptions(args)

  if (paths.length === 0) {
    stderr(missingArgumentError('cp', 'source'))
    return { exitCode: 1, error: 'missing source argument' }
  }

  if (paths.length === 1) {
    stderr(missingArgumentError('cp', 'destination'))
    return { exitCode: 1, error: 'missing destination argument' }
  }

  const src = normalizeCLIPath(paths[0])
  const dest = normalizeCLIPath(paths[1])

  try {
    await fs.cp(src, dest, { recursive: options.recursive })
    return { exitCode: 0 }
  } catch (err: unknown) {
    stderr(formatError('cp', err))
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, error: message }
  }
}
