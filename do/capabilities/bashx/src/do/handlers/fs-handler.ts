/**
 * Filesystem Command Handler
 *
 * Handles filesystem-related commands: ls, cat, head, tail, wc.
 * Implements the CommandHandler interface for the Strategy pattern.
 *
 * @module src/do/handlers/fs-handler
 */

import type { BashResult, ExecOptions, FsCapability } from '../../types.js'
import type { CommandHandler, CommandHandlerContext } from './types.js'
import { ResultBuilder } from '../result/result-builder.js'

/**
 * Set of commands handled by this handler.
 */
const FS_COMMANDS = new Set(['ls', 'cat', 'head', 'tail', 'wc'])

/**
 * Filesystem command handler implementing the Strategy pattern.
 *
 * Handles:
 * - ls: List directory contents
 * - cat: Concatenate and display files
 * - head: Display first N lines
 * - tail: Display last N lines
 * - wc: Count lines, words, and characters
 */
export class FsCommandHandler implements CommandHandler {
  readonly name = 'fs'

  private readonly fs: FsCapability

  /**
   * Create a new FsCommandHandler.
   *
   * @param context - Handler context containing fs capability
   * @throws Error if fs capability is not provided
   */
  constructor(context: CommandHandlerContext) {
    if (!context.fs) {
      throw new Error('FsCommandHandler requires fs capability in context')
    }
    this.fs = context.fs
  }

  /**
   * Check if this handler can handle the given command.
   */
  canHandle(command: string): boolean {
    return FS_COMMANDS.has(command)
  }

  /**
   * Execute a filesystem command.
   */
  async execute(command: string, args: string[], options?: ExecOptions): Promise<BashResult> {
    if (!this.canHandle(command)) {
      throw new Error(`FsCommandHandler does not support command: ${command}`)
    }

    try {
      switch (command) {
        case 'ls':
          return await this.executeLs(args)
        case 'cat':
          return await this.executeCat(args)
        case 'head':
          return await this.executeHead(args, options)
        case 'tail':
          return await this.executeTail(args, options)
        case 'wc':
          return this.executeWc(args, options)
        default:
          throw new Error(`Unsupported command: ${command}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return ResultBuilder.error(command, message, 1)
        .withTier(1)
        .withIntent({
          commands: [command],
          reads: args.filter(a => !a.startsWith('-')),
          writes: [],
          deletes: [],
          network: false,
          elevated: false,
        })
        .build()
    }
  }

  /**
   * Execute ls command - list directory contents.
   */
  private async executeLs(args: string[]): Promise<BashResult> {
    const path = args.find(a => !a.startsWith('-')) || '.'
    const entries = await this.fs.list(path, { withFileTypes: true })

    const stdout = (entries as Array<{ name: string; isDirectory(): boolean }>)
      .map(e => e.isDirectory() ? `${e.name}/` : e.name)
      .join('\n') + '\n'

    return ResultBuilder.success('ls', stdout)
      .withTier(1)
      .withIntent({
        commands: ['ls'],
        reads: [path],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      })
      .withClassification({
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'List directory contents',
      })
      .build()
  }

  /**
   * Execute cat command - concatenate and display files.
   */
  private async executeCat(args: string[]): Promise<BashResult> {
    const files = args.filter(a => !a.startsWith('-'))

    if (files.length === 0) {
      return ResultBuilder.error('cat', 'cat: missing operand', 1)
        .withTier(1)
        .build()
    }

    const contents = await Promise.all(
      files.map(f => this.fs.read(f, { encoding: 'utf-8' }))
    )
    const stdout = contents.join('')

    return ResultBuilder.success('cat', stdout)
      .withTier(1)
      .withIntent({
        commands: ['cat'],
        reads: files,
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      })
      .withClassification({
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Read file contents',
      })
      .build()
  }

  /**
   * Execute head command - display first N lines.
   */
  private async executeHead(args: string[], options?: ExecOptions): Promise<BashResult> {
    const { lines, excludeLast, quiet, files } = this.parseHeadTailArgs(args, 'head')

    if (files.length === 0) {
      // Read from stdin
      const stdinContent = options?.stdin || ''
      const stdinLines = stdinContent.split('\n')
      let selectedLines: string[]

      if (excludeLast) {
        selectedLines = stdinLines.slice(0, -lines)
      } else {
        selectedLines = stdinLines.slice(0, lines)
      }

      const stdout = selectedLines.join('\n') + '\n'
      return ResultBuilder.success('head', stdout)
        .withTier(1)
        .withIntent({
          commands: ['head'],
          reads: [],
          writes: [],
          deletes: [],
          network: false,
          elevated: false,
        })
        .withClassification({
          type: 'read',
          impact: 'none',
          reversible: true,
          reason: 'Read first lines from stdin',
        })
        .build()
    }

    const results: string[] = []
    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi]
      const content = await this.fs.read(file, { encoding: 'utf-8' }) as string
      const fileLines = content.split('\n')
      let selectedLines: string[]

      if (excludeLast) {
        selectedLines = fileLines.slice(0, -lines)
      } else {
        selectedLines = fileLines.slice(0, lines)
      }

      // Add header if multiple files and not quiet
      if (files.length > 1 && !quiet) {
        if (fi > 0) results.push('')
        results.push(`==> ${file} <==`)
      }
      results.push(...selectedLines)
    }

    const stdout = results.join('\n') + '\n'
    return ResultBuilder.success('head', stdout)
      .withTier(1)
      .withIntent({
        commands: ['head'],
        reads: files,
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      })
      .withClassification({
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Read first lines from files',
      })
      .build()
  }

  /**
   * Execute tail command - display last N lines.
   */
  private async executeTail(args: string[], options?: ExecOptions): Promise<BashResult> {
    const { lines, startFrom, quiet, files } = this.parseTailArgs(args)

    if (files.length === 0) {
      // Read from stdin
      const stdinContent = options?.stdin || ''
      const stdinLines = stdinContent.split('\n')
      const effectiveStdinLines = stdinLines[stdinLines.length - 1] === '' ? stdinLines.slice(0, -1) : stdinLines
      let selectedLines: string[]

      if (startFrom) {
        selectedLines = effectiveStdinLines.slice(lines - 1)
      } else {
        selectedLines = effectiveStdinLines.slice(-lines)
      }

      const stdout = selectedLines.join('\n') + '\n'
      return ResultBuilder.success('tail', stdout)
        .withTier(1)
        .withIntent({
          commands: ['tail'],
          reads: [],
          writes: [],
          deletes: [],
          network: false,
          elevated: false,
        })
        .withClassification({
          type: 'read',
          impact: 'none',
          reversible: true,
          reason: 'Read last lines from stdin',
        })
        .build()
    }

    const results: string[] = []
    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi]
      const content = await this.fs.read(file, { encoding: 'utf-8' }) as string
      const allLines = content.split('\n')
      const effectiveLines = allLines[allLines.length - 1] === '' ? allLines.slice(0, -1) : allLines
      let selectedLines: string[]

      if (startFrom) {
        selectedLines = effectiveLines.slice(lines - 1)
      } else {
        selectedLines = effectiveLines.slice(-lines)
      }

      // Add header if multiple files and not quiet
      if (files.length > 1 && !quiet) {
        if (fi > 0) results.push('')
        results.push(`==> ${file} <==`)
      }
      results.push(...selectedLines)
    }

    const stdout = results.join('\n') + '\n'
    return ResultBuilder.success('tail', stdout)
      .withTier(1)
      .withIntent({
        commands: ['tail'],
        reads: files,
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      })
      .withClassification({
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Read last lines from files',
      })
      .build()
  }

  /**
   * Execute wc command - count lines, words, characters.
   */
  private executeWc(args: string[], options?: ExecOptions): BashResult {
    const input = options?.stdin || ''
    const lineCount = input.split('\n').length - (input.endsWith('\n') ? 1 : 0)
    const wordCount = input.split(/\s+/).filter(Boolean).length
    const charCount = input.length

    let stdout: string
    if (args.includes('-l')) {
      stdout = `${lineCount}\n`
    } else if (args.includes('-w')) {
      stdout = `${wordCount}\n`
    } else if (args.includes('-c')) {
      stdout = `${charCount}\n`
    } else {
      stdout = `${lineCount} ${wordCount} ${charCount}\n`
    }

    return ResultBuilder.success('wc', stdout)
      .withTier(1)
      .withIntent({
        commands: ['wc'],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      })
      .withClassification({
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Count lines, words, or characters',
      })
      .build()
  }

  /**
   * Parse head/tail command arguments.
   */
  private parseHeadTailArgs(args: string[], _command: 'head' | 'tail'): {
    lines: number
    excludeLast: boolean
    quiet: boolean
    files: string[]
  } {
    let quiet = false
    let lines = 10
    let excludeLast = false
    const files: string[] = []

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '-q' || arg === '--quiet' || arg === '--silent') {
        quiet = true
      } else if (arg === '-n' && args[i + 1]) {
        const nArg = args[++i]
        if (nArg.startsWith('-')) {
          excludeLast = true
          lines = parseInt(nArg.slice(1), 10)
        } else {
          lines = parseInt(nArg, 10)
        }
      } else if (arg.startsWith('-n')) {
        const nArg = arg.slice(2)
        if (nArg.startsWith('-')) {
          excludeLast = true
          lines = parseInt(nArg.slice(1), 10)
        } else {
          lines = parseInt(nArg, 10)
        }
      } else if (!arg.startsWith('-')) {
        files.push(arg)
      }
    }

    return { lines, excludeLast, quiet, files }
  }

  /**
   * Parse tail-specific arguments (handles +N for starting position).
   */
  private parseTailArgs(args: string[]): {
    lines: number
    startFrom: boolean
    quiet: boolean
    files: string[]
  } {
    let quiet = false
    let lines = 10
    let startFrom = false
    const files: string[] = []

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '-q' || arg === '--quiet' || arg === '--silent') {
        quiet = true
      } else if (arg === '-n' && args[i + 1]) {
        const nArg = args[++i]
        if (nArg.startsWith('+')) {
          startFrom = true
          lines = parseInt(nArg.slice(1), 10)
        } else {
          lines = parseInt(nArg, 10)
        }
      } else if (arg.startsWith('-n')) {
        const nArg = arg.slice(2)
        if (nArg.startsWith('+')) {
          startFrom = true
          lines = parseInt(nArg.slice(1), 10)
        } else {
          lines = parseInt(nArg, 10)
        }
      } else if (!arg.startsWith('-')) {
        files.push(arg)
      }
    }

    return { lines, startFrom, quiet, files }
  }
}
