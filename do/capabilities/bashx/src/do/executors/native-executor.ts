/**
 * NativeExecutor Module
 *
 * Tier 1 execution: Native in-Worker commands via nodejs_compat_v2.
 *
 * This module is a THIN DISPATCHER that routes commands to their
 * respective command modules:
 *
 * - Filesystem operations via FsCapability (cat, ls, head, tail, etc.)
 * - HTTP operations via fetch API (curl, wget)
 * - Data processing (jq, yq, base64, envsubst) - delegates to data-processing.ts
 * - Crypto operations (sha256sum, md5sum, etc.) - delegates to crypto.ts
 * - Text processing (sed, awk, diff, patch, tee, xargs) - delegates to text-processing.ts
 * - POSIX utilities (cut, sort, tr, uniq, wc, etc.) - delegates to posix-utils.ts
 * - System utilities (yes, whoami, hostname, printenv) - delegates to system-utils.ts
 * - Extended utilities (env, id, uname, tac) - delegates to extended-utils.ts
 * - Math & control (bc, expr, seq, sleep, timeout) - delegates to math-control.ts
 * - Pure computation (true, false, pwd, echo)
 *
 * Interface Contract:
 * -------------------
 * NativeExecutor implements the TierExecutor interface:
 * - canExecute(command): Returns true if command is in NATIVE_COMMANDS
 * - execute(command, options): Executes and returns BashResult
 *
 * @module bashx/do/executors/native-executor
 */

import type { BashResult, ExecOptions, FsCapability } from '../../types.js'
import type { TierExecutor, BaseExecutorConfig } from './types.js'

// Import from shared command-parser module
import {
  extractCommandName,
  extractArgs,
  hasPipeline,
  splitPipeline,
} from '../utils/command-parser.js'

// Import from command modules
import {
  executeCut,
  executeSort,
  executeTr,
  executeUniq,
  executeWc,
  executeBasename,
  executeDirname,
  executeEcho,
  executePrintf,
  executeDate,
  type CutOptions,
  type SortOptions,
  type TrOptions,
  type UniqOptions,
  type EchoOptions,
} from '../commands/posix-utils.js'

import {
  executeBc,
  executeExpr,
  executeSeq,
  executeSleep as executeSleepMathControl,
} from '../commands/math-control.js'

import {
  executeJq,
  executeBase64,
  executeEnvsubst,
  parseJqArgs,
  parseBase64Args,
  JqError,
  Base64Error,
} from '../commands/data-processing.js'

import {
  executeCryptoCommand,
} from '../commands/crypto.js'

import {
  executeSed,
  executeAwk,
  executeDiff,
  executePatch,
  executeTee,
  executeXargs,
} from '../commands/text-processing.js'

import {
  executeYes,
  executeWhoami,
  executeHostname,
  executePrintenv,
} from '../commands/system-utils.js'

import {
  parseEnvArgs,
  executeEnv,
  formatEnv,
  parseIdArgs,
  executeId,
  DEFAULT_WORKER_IDENTITY,
  parseUnameArgs,
  executeUname,
  DEFAULT_WORKER_SYSINFO,
  executeTac,
} from '../commands/extended-utils.js'

import {
  executeTest,
  createFileInfoProvider,
} from '../commands/test-command.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for NativeExecutor.
 */
export interface NativeExecutorConfig extends BaseExecutorConfig {
  /**
   * Filesystem capability for file operations.
   */
  fs?: FsCapability
}

/**
 * Native capability types
 */
export type NativeCapability =
  | 'fs'
  | 'http'
  | 'data'
  | 'crypto'
  | 'text'
  | 'posix'
  | 'system'
  | 'extended'
  | 'compute'

/**
 * Result from native command execution
 */
export interface NativeCommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

// ============================================================================
// COMMAND SETS
// ============================================================================

/**
 * All commands that can be executed natively
 */
export const NATIVE_COMMANDS = new Set([
  // Filesystem
  'cat', 'head', 'tail', 'ls', 'test', '[', 'stat', 'readlink', 'find', 'grep',
  'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'touch', 'truncate', 'ln', 'chmod', 'chown',
  // HTTP
  'curl', 'wget',
  // Data processing
  'jq', 'yq', 'base64', 'envsubst',
  // Crypto
  'sha256sum', 'sha1sum', 'sha512sum', 'sha384sum', 'md5sum', 'uuidgen', 'uuid', 'cksum', 'sum', 'openssl',
  // Text processing
  'sed', 'awk', 'diff', 'patch', 'tee', 'xargs',
  // POSIX utilities
  'cut', 'sort', 'tr', 'uniq', 'wc', 'basename', 'dirname', 'echo', 'printf', 'date', 'dd', 'od',
  // System utilities
  'yes', 'whoami', 'hostname', 'printenv',
  // Extended utilities
  'env', 'id', 'uname', 'tac',
  // Pure computation
  'true', 'false', 'pwd', 'rev', 'bc', 'expr', 'seq', 'shuf', 'sleep', 'timeout',
])

/**
 * Commands requiring filesystem access
 */
export const FS_COMMANDS = new Set([
  'cat', 'head', 'tail', 'ls', 'test', '[', 'stat', 'readlink', 'find', 'grep',
  'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'touch', 'truncate', 'ln', 'chmod', 'chown',
])

/**
 * HTTP commands
 */
export const HTTP_COMMANDS = new Set(['curl', 'wget'])

/**
 * Data processing commands
 */
export const DATA_COMMANDS = new Set(['jq', 'yq', 'base64', 'envsubst'])

/**
 * Crypto commands
 */
export const CRYPTO_COMMANDS = new Set([
  'sha256sum', 'sha1sum', 'sha512sum', 'sha384sum', 'md5sum',
  'uuidgen', 'uuid', 'cksum', 'sum', 'openssl',
])

/**
 * Text processing commands
 */
export const TEXT_PROCESSING_COMMANDS = new Set([
  'sed', 'awk', 'diff', 'patch', 'tee', 'xargs',
])

/**
 * POSIX utility commands
 */
export const POSIX_UTILS_COMMANDS = new Set([
  'cut', 'sort', 'tr', 'uniq', 'wc',
  'basename', 'dirname', 'printf',
  'date', 'dd', 'od',
])

/**
 * System utility commands
 */
export const SYSTEM_UTILS_COMMANDS = new Set([
  'yes', 'whoami', 'hostname', 'printenv',
])

/**
 * Extended utility commands
 */
export const EXTENDED_UTILS_COMMANDS = new Set([
  'env', 'id', 'uname', 'tac',
])

// ============================================================================
// NATIVE EXECUTOR CLASS
// ============================================================================

/**
 * NativeExecutor - Thin dispatcher for native in-Worker commands
 *
 * Routes commands to their respective command modules for execution.
 * This class focuses on dispatch logic rather than implementation.
 *
 * @implements {TierExecutor}
 */
export class NativeExecutor implements TierExecutor {
  private readonly fs?: FsCapability

  constructor(config: NativeExecutorConfig = {}) {
    this.fs = config.fs
    // Timeout is not used yet but reserved for future implementation
    void config.defaultTimeout
  }

  /**
   * Check if filesystem capability is available
   */
  get hasFsCapability(): boolean {
    return this.fs !== undefined
  }

  /**
   * Check if this executor can handle a command
   */
  canExecute(command: string): boolean {
    const cmd = extractCommandName(command)
    return NATIVE_COMMANDS.has(cmd)
  }

  /**
   * Check if a command requires filesystem capability
   */
  requiresFsCapability(command: string): boolean {
    const cmd = extractCommandName(command)
    return FS_COMMANDS.has(cmd)
  }

  /**
   * Get the capability type for a command
   */
  getCapability(command: string): NativeCapability {
    const cmd = extractCommandName(command)

    if (FS_COMMANDS.has(cmd)) return 'fs'
    if (HTTP_COMMANDS.has(cmd)) return 'http'
    if (DATA_COMMANDS.has(cmd)) return 'data'
    if (CRYPTO_COMMANDS.has(cmd)) return 'crypto'
    if (TEXT_PROCESSING_COMMANDS.has(cmd)) return 'text'
    if (POSIX_UTILS_COMMANDS.has(cmd)) return 'posix'
    if (SYSTEM_UTILS_COMMANDS.has(cmd)) return 'system'
    if (EXTENDED_UTILS_COMMANDS.has(cmd)) return 'extended'
    return 'compute'
  }

  /**
   * Execute a command natively
   */
  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    // Handle pipelines by splitting and chaining
    if (hasPipeline(command)) {
      return this.executePipeline(command, options)
    }

    const cmd = extractCommandName(command)
    const args = extractArgs(command)
    const capability = this.getCapability(cmd)

    // Special case: commands that can work with stdin don't need fs
    const fileArgs = args.filter(a => !a.startsWith('-'))
    const canUseStdin = (cmd === 'cat' || cmd === 'head' || cmd === 'tail') &&
      fileArgs.length === 0 && options?.stdin !== undefined
    const needsFsForThisCmd = this.requiresFsCapability(cmd) && !canUseStdin

    // Check if filesystem is required but not available
    if (needsFsForThisCmd && !this.fs) {
      return this.createResult(command, '', 'FsCapability not available', 1)
    }

    try {
      let result: NativeCommandResult

      switch (capability) {
        case 'fs':
          result = await this.executeFs(cmd, args, options)
          break
        case 'http':
          result = await this.executeHttp(cmd, args, options)
          break
        case 'data':
          result = await this.executeData(cmd, args, options)
          break
        case 'crypto':
          result = await this.executeCrypto(cmd, args, options)
          break
        case 'text':
          result = await this.executeText(cmd, args, options)
          break
        case 'posix':
          result = await this.executePosix(cmd, args, options)
          break
        case 'system':
          result = await this.executeSystem(cmd, args, options)
          break
        case 'extended':
          result = await this.executeExtended(cmd, args, options)
          break
        case 'compute':
        default:
          result = await this.executeCompute(cmd, args, options)
          break
      }

      return this.createResult(command, result.stdout, result.stderr, result.exitCode)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.createResult(command, '', message, 1)
    }
  }

  // ============================================================================
  // PIPELINE EXECUTION
  // ============================================================================

  private async executePipeline(command: string, options?: ExecOptions): Promise<BashResult> {
    const commands = splitPipeline(command)
    let currentInput = options?.stdin || ''

    for (const cmd of commands) {
      const result = await this.execute(cmd, { ...options, stdin: currentInput })

      if (result.exitCode !== 0) {
        return result
      }

      currentInput = result.stdout
    }

    return this.createResult(command, currentInput, '', 0)
  }

  // ============================================================================
  // FILESYSTEM COMMANDS
  // ============================================================================

  private async executeFs(
    cmd: string,
    args: string[],
    options?: ExecOptions
  ): Promise<NativeCommandResult> {
    // Handle commands that can work with stdin without fs
    if (cmd === 'cat') {
      return this.executeCat(args, options)
    }
    if (cmd === 'head') {
      return this.executeHead(args, options)
    }
    if (cmd === 'tail') {
      return this.executeTail(args, options)
    }

    if (!this.fs) {
      throw new Error('FsCapability not available')
    }

    switch (cmd) {
      case 'ls':
        return this.executeLs(args)
      case 'test':
      case '[':
        return this.executeTestCommand(args)
      default:
        throw new Error(`Unsupported fs command: ${cmd}`)
    }
  }

  private async executeCat(args: string[], options?: ExecOptions): Promise<NativeCommandResult> {
    const files = args.filter(a => !a.startsWith('-'))

    if (files.length === 0) {
      return { stdout: options?.stdin || '', stderr: '', exitCode: 0 }
    }

    try {
      const contents = await Promise.all(
        files.map(f => this.fs!.read(f, { encoding: 'utf-8' }))
      )
      return { stdout: contents.join(''), stderr: '', exitCode: 0 }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { stdout: '', stderr: message, exitCode: 1 }
    }
  }

  private async executeLs(args: string[]): Promise<NativeCommandResult> {
    const path = args.find(a => !a.startsWith('-')) || '.'

    try {
      const entries = await this.fs!.list(path, { withFileTypes: true })
      const names = (entries as Array<{ name: string; isDirectory(): boolean }>)
        .map(e => e.isDirectory?.() ? `${e.name}/` : e.name)
        .join('\n')
      return { stdout: names + (names ? '\n' : ''), stderr: '', exitCode: 0 }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { stdout: '', stderr: message, exitCode: 1 }
    }
  }

  private async executeHead(args: string[], options?: ExecOptions): Promise<NativeCommandResult> {
    let lines = 10
    const files: string[] = []

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n' && args[i + 1]) {
        lines = parseInt(args[++i], 10)
      } else if (args[i].startsWith('-n')) {
        lines = parseInt(args[i].slice(2), 10)
      } else if (args[i].match(/^-\d+$/)) {
        lines = parseInt(args[i].slice(1), 10)
      } else if (!args[i].startsWith('-')) {
        files.push(args[i])
      }
    }

    if (files.length === 0) {
      const input = options?.stdin || ''
      const inputLines = input.split('\n')
      const result = inputLines.slice(0, lines).join('\n')
      return { stdout: result + (result ? '\n' : ''), stderr: '', exitCode: 0 }
    }

    try {
      const content = await this.fs!.read(files[0], { encoding: 'utf-8' }) as string
      const contentLines = content.split('\n')
      const result = contentLines.slice(0, lines).join('\n')
      return { stdout: result + '\n', stderr: '', exitCode: 0 }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { stdout: '', stderr: message, exitCode: 1 }
    }
  }

  private async executeTail(args: string[], options?: ExecOptions): Promise<NativeCommandResult> {
    let lines = 10
    const files: string[] = []

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n' && args[i + 1]) {
        lines = parseInt(args[++i], 10)
      } else if (args[i].startsWith('-n')) {
        lines = parseInt(args[i].slice(2), 10)
      } else if (!args[i].startsWith('-')) {
        files.push(args[i])
      }
    }

    if (files.length === 0) {
      const input = options?.stdin || ''
      const inputLines = input.split('\n').filter((l, i, arr) => i < arr.length - 1 || l !== '')
      const result = inputLines.slice(-lines).join('\n')
      return { stdout: result + (result ? '\n' : ''), stderr: '', exitCode: 0 }
    }

    try {
      const content = await this.fs!.read(files[0], { encoding: 'utf-8' }) as string
      const contentLines = content.split('\n').filter((l, i, arr) => i < arr.length - 1 || l !== '')
      const result = contentLines.slice(-lines).join('\n')
      return { stdout: result + '\n', stderr: '', exitCode: 0 }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { stdout: '', stderr: message, exitCode: 1 }
    }
  }

  private async executeTestCommand(args: string[]): Promise<NativeCommandResult> {
    // Delegate to test-command module
    const fileInfo = createFileInfoProvider(this.fs!)
    try {
      const result = await executeTest(args, fileInfo)
      return { stdout: '', stderr: result.stderr, exitCode: result.exitCode }
    } catch {
      return { stdout: '', stderr: '', exitCode: 1 }
    }
  }

  // ============================================================================
  // HTTP COMMANDS
  // ============================================================================

  private async executeHttp(
    cmd: string,
    args: string[],
    _options?: ExecOptions
  ): Promise<NativeCommandResult> {
    switch (cmd) {
      case 'curl':
        return this.executeCurl(args)
      case 'wget':
        return this.executeWget(args)
      default:
        throw new Error(`Unsupported http command: ${cmd}`)
    }
  }

  private async executeCurl(args: string[]): Promise<NativeCommandResult> {
    let url = ''
    let method = 'GET'
    let body: string | undefined = undefined
    let followRedirects = false
    let headersOnly = false
    const headers: Record<string, string> = {}

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '-s' || arg === '--silent') {
        // Silent mode - continue parsing
      } else if (arg === '-X' && args[i + 1]) {
        method = args[++i]
      } else if (arg === '-H' && args[i + 1]) {
        const header = args[++i]
        const colonIndex = header.indexOf(':')
        if (colonIndex > 0) {
          headers[header.slice(0, colonIndex).trim()] = header.slice(colonIndex + 1).trim()
        }
      } else if (arg === '-d' && args[i + 1]) {
        body = args[++i]
        if (method === 'GET') {
          method = 'POST' // -d implies POST unless -X is specified
        }
      } else if (arg === '-u' && args[i + 1]) {
        const credentials = args[++i]
        const base64 = btoa(credentials)
        headers['Authorization'] = `Basic ${base64}`
      } else if (arg === '-L' || arg === '--location') {
        followRedirects = true
      } else if (arg === '-I' || arg === '--head') {
        method = 'HEAD'
        headersOnly = true
      } else if (!arg.startsWith('-') && !url) {
        url = arg
      }
    }

    if (!url) {
      return { stdout: '', stderr: 'curl: no URL specified', exitCode: 1 }
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body,
        redirect: followRedirects ? 'follow' : 'manual',
      }

      const response = await fetch(url, fetchOptions)

      if (headersOnly) {
        // For HEAD requests, return headers as output
        const headerLines: string[] = []
        headerLines.push(`HTTP/1.1 ${response.status} ${response.statusText}`)
        response.headers.forEach((value, key) => {
          headerLines.push(`${key}: ${value}`)
        })
        return { stdout: headerLines.join('\n') + '\n', stderr: '', exitCode: 0 }
      }

      const content = await response.text()
      return { stdout: content, stderr: '', exitCode: response.ok ? 0 : 1 }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { stdout: '', stderr: `curl: ${message}`, exitCode: 1 }
    }
  }

  private async executeWget(args: string[]): Promise<NativeCommandResult> {
    let url = ''
    const headers: Record<string, string> = {}

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '-qO-' || arg === '-O-' || arg === '-O' || arg === '-q') {
        // Output to stdout mode or quiet mode - check for next arg being '-'
        if (arg === '-O' && args[i + 1] === '-') {
          i++ // Skip the '-'
        }
        // Continue parsing
      } else if (arg === '--header' && args[i + 1]) {
        const header = args[++i]
        const colonIndex = header.indexOf(':')
        if (colonIndex > 0) {
          headers[header.slice(0, colonIndex).trim()] = header.slice(colonIndex + 1).trim()
        }
      } else if (!arg.startsWith('-') && !url) {
        url = arg
      }
    }

    if (!url) {
      return { stdout: '', stderr: 'wget: missing URL', exitCode: 1 }
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }

    try {
      const fetchOptions: RequestInit = {
        method: 'GET',
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        redirect: 'follow',
      }

      const response = await fetch(url, fetchOptions)
      const content = await response.text()
      return { stdout: content, stderr: '', exitCode: response.ok ? 0 : 1 }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { stdout: '', stderr: `wget: ${message}`, exitCode: 1 }
    }
  }

  // ============================================================================
  // DATA PROCESSING COMMANDS - Delegating to data-processing.ts
  // ============================================================================

  private async executeData(
    cmd: string,
    args: string[],
    options?: ExecOptions
  ): Promise<NativeCommandResult> {
    const input = options?.stdin || ''

    switch (cmd) {
      case 'jq': {
        const { query, options: jqOpts } = parseJqArgs(args)
        try {
          const result = executeJq(query || '.', input, jqOpts)
          return { stdout: result, stderr: '', exitCode: 0 }
        } catch (error) {
          if (error instanceof JqError) {
            return { stdout: '', stderr: `jq: ${error.message}`, exitCode: error.exitCode }
          }
          throw error
        }
      }
      case 'base64': {
        const { options: b64Opts } = parseBase64Args(args)
        try {
          const result = executeBase64(input, b64Opts)
          return { stdout: result, stderr: '', exitCode: 0 }
        } catch (error) {
          if (error instanceof Base64Error) {
            return { stdout: '', stderr: `base64: ${error.message}`, exitCode: 1 }
          }
          throw error
        }
      }
      case 'envsubst': {
        const result = executeEnvsubst(input, { env: options?.env || {} })
        return { stdout: result, stderr: '', exitCode: 0 }
      }
      default:
        throw new Error(`Unsupported data command: ${cmd}`)
    }
  }

  // ============================================================================
  // CRYPTO COMMANDS - Delegating to crypto.ts
  // ============================================================================

  private async executeCrypto(
    cmd: string,
    args: string[],
    options?: ExecOptions
  ): Promise<NativeCommandResult> {
    // Handle uuidgen specially since it doesn't need input
    if (cmd === 'uuidgen' || cmd === 'uuid') {
      const uuid = crypto.randomUUID()
      return { stdout: uuid + '\n', stderr: '', exitCode: 0 }
    }

    try {
      // executeCryptoCommand expects a CryptoCommandContext object, not just stdin string
      const result = await executeCryptoCommand(cmd, args, { stdin: options?.stdin, fs: this.fs })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { stdout: '', stderr: message, exitCode: 1 }
    }
  }

  // ============================================================================
  // TEXT PROCESSING COMMANDS - Delegating to text-processing.ts
  // ============================================================================

  private async executeText(
    cmd: string,
    args: string[],
    options?: ExecOptions
  ): Promise<NativeCommandResult> {
    let input = options?.stdin || ''

    switch (cmd) {
      case 'sed': {
        // For sed, read file content if a file is specified
        // Look for file paths (arguments that look like paths)
        const fileArgs = args.filter(a =>
          !a.startsWith('-') &&
          !a.startsWith('s/') &&
          (a.startsWith('/') || a.match(/\.(txt|log|conf|cfg|sh|md|json|xml|yaml|yml)$/))
        )

        if (fileArgs.length > 0 && this.fs) {
          try {
            input = await this.fs.read(fileArgs[fileArgs.length - 1], { encoding: 'utf-8' }) as string
          } catch {
            // If file read fails, continue with stdin
          }
        }

        const result = executeSed(args, input, this.fs)
        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
      }
      case 'awk': {
        // For awk, read file content if specified
        // Skip the first non-flag arg which is usually the program
        const nonFlagArgs = args.filter(a => !a.startsWith('-'))
        if (nonFlagArgs.length > 1 && this.fs) {
          // Last arg is typically the file
          const lastArg = nonFlagArgs[nonFlagArgs.length - 1]
          if (lastArg.startsWith('/') || lastArg.match(/\.(txt|log|conf|cfg|sh|md|json|xml|yaml|yml)$/)) {
            try {
              input = await this.fs.read(lastArg, { encoding: 'utf-8' }) as string
            } catch {
              // If file read fails, continue with stdin
            }
          }
        }

        const result = executeAwk(args, input)
        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
      }
      case 'diff': {
        // diff requires two file contents
        const diffFiles = args.filter(a => !a.startsWith('-'))
        if (diffFiles.length >= 2 && this.fs) {
          try {
            const file1Content = await this.fs.read(diffFiles[0], { encoding: 'utf-8' }) as string
            const file2Content = await this.fs.read(diffFiles[1], { encoding: 'utf-8' }) as string
            const unified = args.includes('-u') || args.includes('--unified')
            const context = args.includes('-c') || args.includes('--context')
            const result = executeDiff(file1Content, file2Content, diffFiles[0], diffFiles[1], { unified, context })
            return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { stdout: '', stderr: `diff: ${message}`, exitCode: 1 }
          }
        }
        return { stdout: '', stderr: 'diff: missing operand', exitCode: 1 }
      }
      case 'patch': {
        // patch applies a diff to a file
        const reverse = args.includes('-R') || args.includes('--reverse')
        const dryRun = args.includes('--dry-run')

        // Parse -pN for strip prefix level
        let stripLevel = 0
        for (const arg of args) {
          const match = arg.match(/^-p(\d+)$/)
          if (match) {
            stripLevel = parseInt(match[1], 10)
          }
        }

        // Get patch input from stdin
        const patchContent = input

        // Find target file
        const nonFlagArgs = args.filter(a => !a.startsWith('-'))
        const targetFile = nonFlagArgs.length > 0 ? nonFlagArgs[nonFlagArgs.length - 1] : undefined

        if (this.fs && targetFile) {
          try {
            const originalContent = await this.fs.read(targetFile, { encoding: 'utf-8' }) as string
            const result = executePatch(originalContent, patchContent, { reverse, dryRun, stripLevel })
            return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { stdout: '', stderr: `patch: ${message}`, exitCode: 1 }
          }
        }
        return { stdout: '', stderr: 'patch: missing file operand', exitCode: 1 }
      }
      case 'tee': {
        // tee writes stdin to file and stdout
        // executeTee takes (input, args, fs)
        try {
          const result = await executeTee(input, args, this.fs)
          return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { stdout: '', stderr: `tee: ${message}`, exitCode: 1 }
        }
      }
      case 'xargs': {
        // xargs builds command lines from stdin
        // executeXargs takes (input, args, executor)
        try {
          const result = await executeXargs(input, args, async (cmd: string) => {
            // For now, just use echo behavior for the built command
            return { stdout: cmd + '\n', stderr: '', exitCode: 0 }
          })
          return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { stdout: '', stderr: `xargs: ${message}`, exitCode: 1 }
        }
      }
      default:
        return { stdout: '', stderr: `Unsupported text command: ${cmd}`, exitCode: 1 }
    }
  }

  // ============================================================================
  // POSIX UTILITY COMMANDS - Delegating to posix-utils.ts
  // ============================================================================

  private async executePosix(
    cmd: string,
    args: string[],
    options?: ExecOptions
  ): Promise<NativeCommandResult> {
    const input = options?.stdin || ''

    switch (cmd) {
      case 'printf': {
        if (args.length === 0) {
          return { stdout: '', stderr: '', exitCode: 0 }
        }
        const format = args[0]
        const values = args.slice(1)
        const result = executePrintf(format, values)
        return { stdout: result, stderr: '', exitCode: 0 }
      }
      case 'cut': {
        const cutOpts = this.parseCutArgs(args)
        const result = executeCut(input, cutOpts)
        return { stdout: result, stderr: '', exitCode: 0 }
      }
      case 'sort': {
        const sortOpts = this.parseSortArgs(args)
        const lines = input.split('\n').filter(l => l)
        try {
          const sorted = executeSort(lines, sortOpts)
          return { stdout: sorted.join('\n') + (sorted.length ? '\n' : ''), stderr: '', exitCode: 0 }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { stdout: '', stderr: message, exitCode: 1 }
        }
      }
      case 'uniq': {
        const uniqOpts = this.parseUniqArgs(args)
        const lines = input.split('\n')
        const result = executeUniq(lines, uniqOpts)
        return { stdout: result.join('\n'), stderr: '', exitCode: 0 }
      }
      case 'tr': {
        const set1 = args[0] || ''
        const set2 = args[1] || ''
        const trOpts: TrOptions = {}
        const result = executeTr(input, set1, set2, trOpts)
        return { stdout: result, stderr: '', exitCode: 0 }
      }
      case 'wc': {
        const wcResult = executeWc(input)
        if (args.includes('-l')) {
          return { stdout: String(wcResult.lines) + '\n', stderr: '', exitCode: 0 }
        }
        return { stdout: `${wcResult.lines} ${wcResult.words} ${wcResult.chars}\n`, stderr: '', exitCode: 0 }
      }
      case 'basename': {
        const path = args[0] || ''
        const suffix = args[1]
        const result = executeBasename(path, suffix)
        return { stdout: result + '\n', stderr: '', exitCode: 0 }
      }
      case 'dirname': {
        const path = args[0] || ''
        const result = executeDirname(path)
        return { stdout: result + '\n', stderr: '', exitCode: 0 }
      }
      case 'date': {
        const format = args.find(a => a.startsWith('+'))
        try {
          const result = executeDate(format)
          return { stdout: result + '\n', stderr: '', exitCode: 0 }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { stdout: '', stderr: message, exitCode: 1 }
        }
      }
      default:
        throw new Error(`Unsupported posix command: ${cmd}`)
    }
  }

  private parseCutArgs(args: string[]): CutOptions {
    const opts: CutOptions = {}
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-d' && args[i + 1]) {
        opts.delimiter = args[++i]
      } else if (args[i].startsWith('-d')) {
        opts.delimiter = args[i].slice(2)
      } else if (args[i] === '-f' && args[i + 1]) {
        opts.fields = args[++i]
      } else if (args[i].startsWith('-f')) {
        opts.fields = args[i].slice(2)
      }
    }
    return opts
  }

  private parseSortArgs(args: string[]): SortOptions {
    const opts: SortOptions = {}
    for (const arg of args) {
      if (arg === '-r' || arg === '--reverse') opts.reverse = true
      if (arg === '-n' || arg === '--numeric-sort') opts.numeric = true
      if (arg === '-u' || arg === '--unique') opts.unique = true
    }
    return opts
  }

  private parseUniqArgs(args: string[]): UniqOptions {
    const opts: UniqOptions = {}
    for (const arg of args) {
      if (arg === '-c' || arg === '--count') opts.count = true
      if (arg === '-d' || arg === '--repeated') opts.repeated = true
      if (arg === '-u' || arg === '--unique') opts.unique = true
      if (arg === '-i' || arg === '--ignore-case') opts.ignoreCase = true
    }
    return opts
  }

  // ============================================================================
  // SYSTEM UTILITY COMMANDS - Delegating to system-utils.ts
  // ============================================================================

  private async executeSystem(
    cmd: string,
    args: string[],
    options?: ExecOptions
  ): Promise<NativeCommandResult> {
    const context = {
      cwd: options?.cwd,
      env: options?.env,
    }

    switch (cmd) {
      case 'yes': {
        const result = executeYes(args)
        return result
      }
      case 'whoami': {
        const result = executeWhoami(args, context)
        return result
      }
      case 'hostname': {
        const result = executeHostname(args, context)
        return result
      }
      case 'printenv': {
        const result = executePrintenv(args, context)
        return result
      }
      default:
        throw new Error(`Unsupported system command: ${cmd}`)
    }
  }

  // ============================================================================
  // EXTENDED UTILITY COMMANDS - Delegating to extended-utils.ts
  // ============================================================================

  private async executeExtended(
    cmd: string,
    args: string[],
    options?: ExecOptions
  ): Promise<NativeCommandResult> {
    switch (cmd) {
      case 'env': {
        const envOpts = parseEnvArgs(args)
        const envResult = executeEnv(options?.env || {}, envOpts)
        if (envResult.command) {
          // Would need to execute subcommand - not supported in thin dispatcher
          return { stdout: '', stderr: 'env: command execution not supported', exitCode: 1 }
        }
        const output = formatEnv(envResult.env)
        return { stdout: output, stderr: '', exitCode: 0 }
      }
      case 'id': {
        const idOpts = parseIdArgs(args)
        const result = executeId(DEFAULT_WORKER_IDENTITY, idOpts)
        return { stdout: result + '\n', stderr: '', exitCode: 0 }
      }
      case 'uname': {
        const unameOpts = parseUnameArgs(args)
        const result = executeUname(DEFAULT_WORKER_SYSINFO, unameOpts)
        return { stdout: result + '\n', stderr: '', exitCode: 0 }
      }
      case 'tac': {
        const input = options?.stdin || ''
        const result = executeTac(input)
        return { stdout: result, stderr: '', exitCode: 0 }
      }
      default:
        throw new Error(`Unsupported extended command: ${cmd}`)
    }
  }

  // ============================================================================
  // PURE COMPUTATION COMMANDS - Delegating to math-control.ts and others
  // ============================================================================

  private async executeCompute(
    cmd: string,
    args: string[],
    options?: ExecOptions
  ): Promise<NativeCommandResult> {
    switch (cmd) {
      case 'true':
        return { stdout: '', stderr: '', exitCode: 0 }
      case 'false':
        return { stdout: '', stderr: '', exitCode: 1 }
      case 'pwd':
        return { stdout: (options?.cwd || '/') + '\n', stderr: '', exitCode: 0 }
      case 'echo': {
        const echoOpts: EchoOptions = { noNewline: args[0] === '-n' }
        const echoArgs = echoOpts.noNewline ? args.slice(1) : args
        const result = executeEcho(echoArgs, echoOpts)
        return { stdout: result, stderr: '', exitCode: 0 }
      }
      case 'seq': {
        const nums = args.filter(a => !a.startsWith('-')).map(Number)
        const seqResult = executeSeq(nums)
        return { stdout: seqResult.result + '\n', stderr: '', exitCode: seqResult.exitCode }
      }
      case 'expr': {
        const exprResult = executeExpr(args)
        return { stdout: exprResult.result + '\n', stderr: exprResult.stderr, exitCode: exprResult.exitCode }
      }
      case 'bc': {
        const input = options?.stdin || args.join(' ')
        const bcResult = executeBc(input.trim())
        return { stdout: bcResult.result + '\n', stderr: bcResult.stderr, exitCode: bcResult.exitCode }
      }
      case 'sleep': {
        const sleepResult = await executeSleepMathControl(args)
        return { stdout: '', stderr: sleepResult.stderr, exitCode: sleepResult.exitCode }
      }
      case 'rev': {
        const input = options?.stdin || ''
        const lines = input.split('\n')
        const reversed = lines.map(line => line.split('').reverse().join(''))
        return { stdout: reversed.join('\n'), stderr: '', exitCode: 0 }
      }
      case 'timeout': {
        // timeout DURATION COMMAND [ARGS...]
        // For simple implementation, extract duration and execute the subcommand
        if (args.length < 2) {
          return { stdout: '', stderr: 'timeout: missing operand', exitCode: 125 }
        }
        const duration = args[0]
        const subCommand = args.slice(1).join(' ')

        // Parse duration and set up timeout
        let timeoutMs: number
        try {
          // Handle duration with unit suffix (s, m, h, d)
          const match = duration.match(/^(\d+(?:\.\d+)?)(s|m|h|d)?$/)
          if (!match) {
            return { stdout: '', stderr: `timeout: invalid time interval '${duration}'`, exitCode: 125 }
          }
          const value = parseFloat(match[1])
          const unit = match[2] || 's'
          const TIME_UNIT_MS: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 }
          timeoutMs = value * (TIME_UNIT_MS[unit] ?? 1000)
        } catch {
          return { stdout: '', stderr: `timeout: invalid time interval '${duration}'`, exitCode: 125 }
        }

        // Execute subcommand with timeout
        const controller = new AbortController()
        let timedOut = false

        const timer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)

        try {
          const result = await Promise.race([
            this.execute(subCommand, options),
            new Promise<never>((_, reject) => {
              controller.signal.addEventListener('abort', () => {
                reject(new Error('TIMEOUT'))
              })
            }),
          ])
          clearTimeout(timer)
          return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
        } catch {
          clearTimeout(timer)
          if (timedOut) {
            return { stdout: '', stderr: '', exitCode: 124 }
          }
          throw new Error('timeout: command failed')
        }
      }
      default:
        throw new Error(`Unsupported compute command: ${cmd}`)
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private createResult(
    command: string,
    stdout: string,
    stderr: string,
    exitCode: number
  ): BashResult {
    return {
      input: command,
      command,
      valid: true,
      generated: false,
      stdout,
      stderr,
      exitCode,
      intent: {
        commands: [extractCommandName(command)],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'none',
        reversible: true,
        reason: 'Tier 1: Native in-Worker execution',
      },
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a NativeExecutor with the given configuration
 */
export function createNativeExecutor(config: NativeExecutorConfig = {}): NativeExecutor {
  return new NativeExecutor(config)
}
