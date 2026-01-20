/**
 * bashx - Bash/Shell Extended Primitive with AI Assistance
 *
 * Provides command execution that integrates with the WorkflowContext ($) pattern
 * and can leverage AI for intelligent command generation, error handling,
 * and scripting assistance.
 *
 * @packageDocumentation
 */

import type { WorkflowContext } from '../context.js'

// ============================================================================
// AI PROMISE TYPES (inline to avoid cross-package imports)
// ============================================================================

/**
 * Metadata for AI operations
 */
export interface AIMeta {
  model?: string
  temperature?: number
  tokens?: { input: number; output: number }
  cost?: number
  duration?: number
}

/**
 * Enhanced Promise with AI metadata and chainable methods
 */
export interface AIPromise<T> extends Promise<T> {
  readonly $meta: AIMeta
  with(options: Partial<AIMeta>): AIPromise<T>
  pipe<U>(fn: (value: T) => U | Promise<U>): AIPromise<U>
}

/**
 * Create an AIPromise wrapper
 */
function createAIPromise<T>(
  executor: (meta: AIMeta) => Promise<T>,
  initialMeta: AIMeta = {}
): AIPromise<T> {
  const meta: AIMeta = { ...initialMeta }
  const basePromise = executor(meta)
  const aiPromise = basePromise as AIPromise<T>

  Object.defineProperty(aiPromise, '$meta', {
    get: () => meta,
    enumerable: true
  })

  Object.defineProperty(aiPromise, 'with', {
    value: (options: Partial<AIMeta>) => {
      return createAIPromise(executor, { ...meta, ...options })
    },
    enumerable: true
  })

  Object.defineProperty(aiPromise, 'pipe', {
    value: function <U>(fn: (value: T) => U | Promise<U>): AIPromise<U> {
      return createAIPromise<U>(
        async (pipeMeta) => {
          const result = await basePromise
          Object.assign(pipeMeta, meta)
          return await fn(result)
        },
        { ...meta }
      )
    },
    enumerable: true
  })

  return aiPromise
}

/**
 * Create initial meta with optional model (handles exactOptionalPropertyTypes)
 */
function createInitialMeta(model?: string): AIMeta {
  if (model !== undefined) {
    return { model }
  }
  return {}
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of executing a command
 */
export interface ExecResult {
  /** Exit code (0 = success) */
  exitCode: number
  /** Standard output */
  stdout: string
  /** Standard error */
  stderr: string
  /** Combined output (stdout + stderr in order) */
  combined: string
  /** Execution duration in milliseconds */
  duration: number
  /** Whether the command was successful (exitCode === 0) */
  success: boolean
  /** Signal that killed the process (if any) */
  signal?: string
}

/**
 * Options for executing commands
 */
export interface ExecOptions {
  /** Working directory */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Timeout in milliseconds */
  timeout?: number
  /** Maximum output buffer size in bytes */
  maxBuffer?: number
  /** Whether to throw on non-zero exit code */
  throwOnError?: boolean
  /** Shell to use (default: /bin/sh) */
  shell?: string | boolean
  /** Input to pass to stdin */
  stdin?: string
  /** Whether to capture combined output */
  combinedOutput?: boolean
  /** Whether to stream output */
  stream?: boolean
}

/**
 * Command with metadata for pipeline
 */
export interface Command {
  /** Command string or array of arguments */
  cmd: string | string[]
  /** Command options */
  options?: ExecOptions
  /** Description for logging */
  description?: string
  /** Whether this command can fail without stopping pipeline */
  allowFailure?: boolean
}

/**
 * Pipeline execution result
 */
export interface PipelineResult {
  /** Overall success (all commands succeeded or allowFailure) */
  success: boolean
  /** Results of each command */
  results: Array<ExecResult & { command: string; description?: string }>
  /** Total duration in milliseconds */
  totalDuration: number
  /** Number of successful commands */
  successCount: number
  /** Number of failed commands */
  failedCount: number
}

/**
 * Options for AI-assisted operations
 */
export interface AIBashOptions {
  /** AI model to use */
  model?: string
  /** Operating system context */
  os?: 'linux' | 'macos' | 'windows'
  /** Shell context */
  shell?: 'bash' | 'zsh' | 'sh' | 'fish' | 'powershell'
  /** Whether to require confirmation before execution */
  confirm?: boolean
  /** Additional context about the system/environment */
  context?: string
  /** Safety level for generated commands */
  safety?: 'strict' | 'normal' | 'permissive'
}

/**
 * AI-generated command result
 */
export interface AICommandResult {
  /** Generated command */
  command: string
  /** Explanation of what the command does */
  explanation: string
  /** Confidence score (0-1) */
  confidence: number
  /** Potential risks or warnings */
  warnings?: string[]
  /** Alternative commands */
  alternatives?: Array<{ command: string; explanation: string }>
  /** Whether the command is considered safe */
  safe: boolean
}

/**
 * AI error diagnosis result
 */
export interface AIDiagnosisResult {
  /** What went wrong */
  problem: string
  /** Why it happened */
  cause: string
  /** How to fix it */
  solution: string
  /** Commands to run to fix the issue */
  fixCommands?: string[]
  /** Confidence score (0-1) */
  confidence: number
  /** Additional resources or documentation */
  resources?: string[]
}

// ============================================================================
// BASHX CLASS
// ============================================================================

/**
 * Extended Bash/Shell primitive that integrates with WorkflowContext
 *
 * @example
 * ```typescript
 * const bash = createBashX($)
 *
 * // Execute a command
 * const result = await bash.exec('ls -la')
 *
 * // Execute with options
 * await bash.exec('npm install', { cwd: './project', timeout: 60000 })
 *
 * // AI-generated command
 * const cmd = await bash.generate('find all TypeScript files larger than 1MB')
 * if (cmd.safe) await bash.exec(cmd.command)
 *
 * // Pipeline execution
 * await bash.pipeline([
 *   { cmd: 'npm install', description: 'Install dependencies' },
 *   { cmd: 'npm run build', description: 'Build project' },
 *   { cmd: 'npm test', description: 'Run tests' }
 * ])
 * ```
 */
export class BashX {
  private $: WorkflowContext
  private defaultOptions: ExecOptions

  constructor(context: WorkflowContext, defaultOptions: ExecOptions = {}) {
    this.$ = context
    this.defaultOptions = defaultOptions
  }

  // ==========================================================================
  // CORE EXECUTION
  // ==========================================================================

  /**
   * Execute a shell command
   *
   * @param command - Command to execute
   * @param options - Execution options
   * @returns Execution result
   *
   * @example
   * ```typescript
   * const result = await bash.exec('echo "Hello, World!"')
   * console.log(result.stdout) // "Hello, World!"
   *
   * const files = await bash.exec('ls -la', { cwd: '/tmp' })
   * console.log(files.stdout)
   * ```
   */
  async exec(command: string | string[], options?: ExecOptions): Promise<ExecResult> {
    const cmd = Array.isArray(command) ? command.join(' ') : command
    const opts = { ...this.defaultOptions, ...options }

    this.$.send({
      type: 'Bash.exec',
      payload: { command: cmd, options: opts }
    })

    return this.$.do(async () => {
      const startTime = Date.now()

      try {
        // In a real implementation, this would use child_process or a similar API
        // For Cloudflare Workers, this would need to use a subprocess API or external service
        console.log(`[bashx.exec] ${cmd}`)

        // Placeholder implementation
        const duration = Date.now() - startTime
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          combined: '',
          duration,
          success: true
        }
      } catch (error) {
        const duration = Date.now() - startTime
        const message = error instanceof Error ? error.message : String(error)

        if (opts.throwOnError) {
          throw error
        }

        return {
          exitCode: 1,
          stdout: '',
          stderr: message,
          combined: message,
          duration,
          success: false
        }
      }
    }, { timeout: opts.timeout ?? 30000 })
  }

  /**
   * Execute a command and return just stdout (convenience method)
   *
   * @param command - Command to execute
   * @param options - Execution options
   * @returns stdout content
   *
   * @example
   * ```typescript
   * const output = await bash.run('whoami')
   * console.log(`Current user: ${output}`)
   * ```
   */
  async run(command: string | string[], options?: ExecOptions): Promise<string> {
    const result = await this.exec(command, options)
    if (!result.success && options?.throwOnError !== false) {
      throw new Error(`Command failed: ${result.stderr || result.combined}`)
    }
    return result.stdout.trim()
  }

  /**
   * Execute a command and return the exit code only
   *
   * @param command - Command to execute
   * @param options - Execution options
   * @returns Exit code
   *
   * @example
   * ```typescript
   * const code = await bash.code('test -f config.json')
   * if (code === 0) {
   *   console.log('Config file exists')
   * }
   * ```
   */
  async code(command: string | string[], options?: ExecOptions): Promise<number> {
    const result = await this.exec(command, { ...options, throwOnError: false })
    return result.exitCode
  }

  /**
   * Execute multiple commands in a pipeline
   *
   * @param commands - Commands to execute
   * @param options - Pipeline options
   * @returns Pipeline result
   *
   * @example
   * ```typescript
   * const result = await bash.pipeline([
   *   { cmd: 'npm ci', description: 'Install deps' },
   *   { cmd: 'npm run lint', description: 'Lint code', allowFailure: true },
   *   { cmd: 'npm run build', description: 'Build' },
   *   { cmd: 'npm test', description: 'Test' }
   * ])
   *
   * console.log(`${result.successCount}/${result.results.length} commands succeeded`)
   * ```
   */
  async pipeline(
    commands: Command[],
    options?: { stopOnFailure?: boolean; parallel?: boolean }
  ): Promise<PipelineResult> {
    const stopOnFailure = options?.stopOnFailure ?? true
    const startTime = Date.now()

    this.$.send({
      type: 'Bash.pipeline',
      payload: {
        commands: commands.map(c => ({
          cmd: Array.isArray(c.cmd) ? c.cmd.join(' ') : c.cmd,
          description: c.description
        })),
        options
      }
    })

    const results: PipelineResult['results'] = []
    let successCount = 0
    let failedCount = 0

    for (const command of commands) {
      const cmd = Array.isArray(command.cmd) ? command.cmd.join(' ') : command.cmd

      const result = await this.exec(cmd, command.options)

      // Build result entry, only adding description if it exists (for exactOptionalPropertyTypes)
      const entry: PipelineResult['results'][number] = {
        ...result,
        command: cmd
      }
      if (command.description !== undefined) {
        entry.description = command.description
      }
      results.push(entry)

      if (result.success) {
        successCount++
      } else {
        failedCount++
        if (stopOnFailure && !command.allowFailure) {
          break
        }
      }
    }

    return {
      success: failedCount === 0 || commands.every(c => c.allowFailure || results.find(r => r.command === (Array.isArray(c.cmd) ? c.cmd.join(' ') : c.cmd))?.success),
      results,
      totalDuration: Date.now() - startTime,
      successCount,
      failedCount
    }
  }

  /**
   * Check if a command exists
   *
   * @param command - Command name to check
   * @returns Whether the command exists
   *
   * @example
   * ```typescript
   * if (await bash.exists('docker')) {
   *   await bash.exec('docker ps')
   * }
   * ```
   */
  async exists(command: string): Promise<boolean> {
    const result = await this.exec(`command -v ${command}`, { throwOnError: false })
    return result.success
  }

  /**
   * Get environment variable value
   *
   * @param name - Variable name
   * @returns Variable value or undefined
   *
   * @example
   * ```typescript
   * const home = await bash.env('HOME')
   * console.log(`Home directory: ${home}`)
   * ```
   */
  async env(name: string): Promise<string | undefined> {
    const result = await this.exec(`echo $${name}`, { throwOnError: false })
    const value = result.stdout.trim()
    return value || undefined
  }

  /**
   * Get current working directory
   *
   * @returns Current working directory path
   *
   * @example
   * ```typescript
   * const cwd = await bash.pwd()
   * console.log(`Working directory: ${cwd}`)
   * ```
   */
  async pwd(): Promise<string> {
    return this.run('pwd')
  }

  /**
   * Get current user
   *
   * @returns Current username
   *
   * @example
   * ```typescript
   * const user = await bash.whoami()
   * console.log(`Running as: ${user}`)
   * ```
   */
  async whoami(): Promise<string> {
    return this.run('whoami')
  }

  // ==========================================================================
  // SCRIPTING HELPERS
  // ==========================================================================

  /**
   * Execute a multi-line script
   *
   * @param script - Script content
   * @param options - Execution options
   * @returns Execution result
   *
   * @example
   * ```typescript
   * await bash.script(`
   *   cd /tmp
   *   mkdir -p myproject
   *   cd myproject
   *   npm init -y
   * `)
   * ```
   */
  async script(script: string, options?: ExecOptions): Promise<ExecResult> {
    // Clean up the script (remove leading indentation)
    const cleanScript = script
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .join(' && ')

    return this.exec(cleanScript, options)
  }

  /**
   * Execute command with retry logic
   *
   * @param command - Command to execute
   * @param options - Execution and retry options
   * @returns Execution result
   *
   * @example
   * ```typescript
   * const result = await bash.retry('curl https://api.example.com', {
   *   retries: 3,
   *   delay: 1000
   * })
   * ```
   */
  async retry(
    command: string | string[],
    options?: ExecOptions & {
      retries?: number
      delay?: number
      backoff?: 'linear' | 'exponential'
    }
  ): Promise<ExecResult> {
    const { retries = 3, delay = 1000, backoff = 'exponential', ...execOptions } = options ?? {}

    let lastResult: ExecResult | undefined
    let attempt = 0

    while (attempt <= retries) {
      lastResult = await this.exec(command, execOptions)

      if (lastResult.success) {
        return lastResult
      }

      if (attempt < retries) {
        const waitTime = backoff === 'exponential'
          ? delay * Math.pow(2, attempt)
          : delay * (attempt + 1)

        await new Promise(resolve => setTimeout(resolve, waitTime))
      }

      attempt++
    }

    return lastResult!
  }

  // ==========================================================================
  // AI-ASSISTED OPERATIONS
  // ==========================================================================

  /**
   * Generate a command from natural language description
   *
   * @param description - What you want to do
   * @param options - AI options
   * @returns Generated command with explanation
   *
   * @example
   * ```typescript
   * const cmd = await bash.generate('find all files modified in the last 24 hours')
   * console.log(cmd.command) // "find . -mtime -1 -type f"
   * console.log(cmd.explanation)
   *
   * if (cmd.safe && cmd.confidence > 0.8) {
   *   await bash.exec(cmd.command)
   * }
   * ```
   */
  generate(description: string, options?: AIBashOptions): AIPromise<AICommandResult> {
    this.$.send({
      type: 'Bash.generate',
      payload: { description, options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // AI would generate the command based on description
      return {
        command: 'echo "placeholder"',
        explanation: `Generated command for: ${description}`,
        confidence: 0.8,
        safe: true,
        warnings: [],
        alternatives: []
      }
    }, createInitialMeta(options?.model))
  }

  /**
   * Diagnose an error and get suggestions for fixing it
   *
   * @param error - Error message or ExecResult with error
   * @param options - AI options
   * @returns Diagnosis with suggested fixes
   *
   * @example
   * ```typescript
   * const result = await bash.exec('npm install weird-package')
   * if (!result.success) {
   *   const diagnosis = await bash.diagnose(result)
   *   console.log(diagnosis.problem)
   *   console.log(diagnosis.solution)
   *
   *   if (diagnosis.fixCommands) {
   *     for (const fix of diagnosis.fixCommands) {
   *       await bash.exec(fix)
   *     }
   *   }
   * }
   * ```
   */
  diagnose(
    error: string | ExecResult,
    options?: AIBashOptions
  ): AIPromise<AIDiagnosisResult> {
    const errorMessage = typeof error === 'string' ? error : error.stderr || error.combined

    this.$.send({
      type: 'Bash.diagnose',
      payload: { error: errorMessage, options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // AI would analyze the error and provide diagnosis
      return {
        problem: 'Command execution failed',
        cause: 'Unknown cause',
        solution: 'Please check the error message for details',
        fixCommands: [],
        confidence: 0.7,
        resources: []
      }
    }, createInitialMeta(options?.model))
  }

  /**
   * Explain what a command does in plain language
   *
   * @param command - Command to explain
   * @param options - AI options
   * @returns Plain language explanation
   *
   * @example
   * ```typescript
   * const explanation = await bash.explain('find . -name "*.js" -exec grep -l "TODO" {} \\;')
   * console.log(explanation)
   * // "This command finds all JavaScript files and searches for TODO comments..."
   * ```
   */
  explain(command: string, options?: AIBashOptions): AIPromise<string> {
    this.$.send({
      type: 'Bash.explain',
      payload: { command, options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // AI would explain the command
      return `The command "${command}" does the following...`
    }, createInitialMeta(options?.model))
  }

  /**
   * Optimize a command for better performance or readability
   *
   * @param command - Command to optimize
   * @param options - AI options with optimization preferences
   * @returns Optimized command with explanation
   *
   * @example
   * ```typescript
   * const optimized = await bash.optimize('cat file.txt | grep pattern | wc -l')
   * console.log(optimized.command) // "grep -c pattern file.txt"
   * console.log(optimized.explanation)
   * ```
   */
  optimize(
    command: string,
    options?: AIBashOptions & { optimize?: 'performance' | 'readability' | 'both' }
  ): AIPromise<AICommandResult> {
    this.$.send({
      type: 'Bash.optimize',
      payload: { command, options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // AI would optimize the command
      return {
        command,
        explanation: 'Command is already optimized',
        confidence: 0.9,
        safe: true
      }
    }, createInitialMeta(options?.model))
  }

  /**
   * Generate a script from multiple steps described in natural language
   *
   * @param steps - Array of step descriptions
   * @param options - AI options
   * @returns Generated script
   *
   * @example
   * ```typescript
   * const script = await bash.generateScript([
   *   'Create a backup of the database',
   *   'Compress the backup file',
   *   'Upload to S3',
   *   'Clean up old backups older than 7 days'
   * ])
   * console.log(script.script)
   * ```
   */
  generateScript(
    steps: string[],
    options?: AIBashOptions & { comments?: boolean }
  ): AIPromise<{
    script: string
    explanation: string
    confidence: number
    warnings?: string[]
  }> {
    this.$.send({
      type: 'Bash.generateScript',
      payload: { steps, options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // AI would generate a script from the steps
      const script = steps.map((step, i) => `# Step ${i + 1}: ${step}\necho "TODO: ${step}"`).join('\n\n')

      return {
        script,
        explanation: `Generated script with ${steps.length} steps`,
        confidence: 0.8,
        warnings: []
      }
    }, createInitialMeta(options?.model))
  }

  /**
   * Check if a command is safe to execute
   *
   * @param command - Command to check
   * @param options - AI options
   * @returns Safety assessment
   *
   * @example
   * ```typescript
   * const safety = await bash.checkSafety('rm -rf /')
   * console.log(safety.safe) // false
   * console.log(safety.reason) // "This command would delete all files..."
   * ```
   */
  checkSafety(
    command: string,
    options?: AIBashOptions
  ): AIPromise<{
    safe: boolean
    confidence: number
    reason: string
    risks?: string[]
    alternatives?: string[]
  }> {
    this.$.send({
      type: 'Bash.checkSafety',
      payload: { command, options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // Check for obviously dangerous patterns
      const dangerousPatterns = [
        /rm\s+-rf\s+\/(?!\w)/,
        /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
        />\s*\/dev\/sd[a-z]/,
        /dd\s+.*of=\/dev\/sd[a-z]/,
        /mkfs\./
      ]

      const isDangerous = dangerousPatterns.some(pattern => pattern.test(command))

      return {
        safe: !isDangerous,
        confidence: isDangerous ? 0.95 : 0.8,
        reason: isDangerous
          ? 'This command contains potentially destructive operations'
          : 'This command appears safe to execute',
        risks: isDangerous ? ['May cause data loss', 'May affect system stability'] : [],
        alternatives: []
      }
    }, createInitialMeta(options?.model))
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a BashX instance bound to a WorkflowContext
 *
 * @param context - The WorkflowContext ($) to bind to
 * @param defaultOptions - Default options for all commands
 * @returns BashX instance
 *
 * @example
 * ```typescript
 * import { createBashX } from '@dotdo/do/primitives/bashx'
 *
 * // In a DO method
 * const bash = createBashX($)
 * await bash.exec('npm install')
 *
 * // With default options
 * const bash = createBashX($, { cwd: '/app', timeout: 60000 })
 * ```
 */
export function createBashX(context: WorkflowContext, defaultOptions?: ExecOptions): BashX {
  return new BashX(context, defaultOptions)
}

/**
 * Standalone command execution without WorkflowContext binding
 */
export const bashx = {
  /**
   * Execute a command (standalone)
   */
  exec: async (command: string, options?: ExecOptions): Promise<ExecResult> => {
    const startTime = Date.now()
    try {
      // Placeholder - real implementation would use subprocess
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        combined: '',
        duration: Date.now() - startTime,
        success: true
      }
    } catch (error) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: String(error),
        combined: String(error),
        duration: Date.now() - startTime,
        success: false
      }
    }
  },

  /**
   * Run a command and return stdout (standalone)
   */
  run: async (command: string, options?: ExecOptions): Promise<string> => {
    const result = await bashx.exec(command, options)
    return result.stdout.trim()
  },

  /**
   * Check if a command exists (standalone)
   */
  exists: async (command: string): Promise<boolean> => {
    const result = await bashx.exec(`command -v ${command}`)
    return result.success
  }
}
