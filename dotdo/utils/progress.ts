/**
 * Progress Indicators for CLI Commands
 *
 * Provides consistent progress feedback for long-running operations like:
 * - dotdo init (project scaffolding)
 * - dotdo deploy (deployment)
 * - dotdo build (building)
 *
 * Uses ora for spinner animations with fallback for non-TTY environments.
 */

import ora, { type Ora, type Options as OraOptions } from 'ora'

/**
 * Progress step configuration
 */
export interface ProgressStep {
  /** Step name displayed during execution (e.g., "Creating project structure...") */
  name: string
  /** Optional task function to execute */
  task?: () => Promise<void> | void
}

/**
 * Progress indicator options
 */
export interface ProgressOptions {
  /** Whether to show spinner (auto-detected if not provided) */
  spinner?: boolean
  /** Stream to write to (defaults to process.stderr) */
  stream?: NodeJS.WriteStream
  /** Color theme */
  color?: 'cyan' | 'green' | 'yellow' | 'red' | 'blue' | 'magenta'
  /** Silent mode - suppresses all output (for JSON mode) */
  silent?: boolean
}

/**
 * Progress indicator class for managing CLI progress
 */
export class Progress {
  private ora: Ora | null = null
  private options: ProgressOptions
  private isInteractive: boolean
  private isSilent: boolean

  constructor(options: ProgressOptions = {}) {
    this.options = options
    this.isSilent = options.silent ?? false
    this.isInteractive = this.isSilent ? false : (options.spinner ?? (process.stdout.isTTY ?? false))
  }

  /**
   * Start a new progress indicator with a message
   */
  start(message: string): this {
    if (this.isSilent) {
      return this
    }
    if (this.isInteractive) {
      const oraOptions: OraOptions = {
        text: message,
        color: this.options.color || 'cyan',
        stream: this.options.stream || process.stderr,
      }
      this.ora = ora(oraOptions).start()
    } else {
      // For non-TTY, just print the message
      console.log(`  ${message}`)
    }
    return this
  }

  /**
   * Update the progress message
   */
  update(message: string): this {
    if (this.ora) {
      this.ora.text = message
    } else if (!this.isInteractive) {
      console.log(`  ${message}`)
    }
    return this
  }

  /**
   * Mark the current step as successful
   */
  succeed(message?: string): this {
    if (this.ora) {
      this.ora.succeed(message)
    } else if (message) {
      console.log(`  \x1b[32m\u2713\x1b[0m ${message}`)
    }
    this.ora = null
    return this
  }

  /**
   * Mark the current step as failed
   */
  fail(message?: string): this {
    if (this.ora) {
      this.ora.fail(message)
    } else if (message) {
      console.log(`  \x1b[31m\u2717\x1b[0m ${message}`)
    }
    this.ora = null
    return this
  }

  /**
   * Mark the current step with a warning
   */
  warn(message?: string): this {
    if (this.ora) {
      this.ora.warn(message)
    } else if (message) {
      console.log(`  \x1b[33m\u26a0\x1b[0m ${message}`)
    }
    this.ora = null
    return this
  }

  /**
   * Mark the current step with info
   */
  info(message?: string): this {
    if (this.ora) {
      this.ora.info(message)
    } else if (message) {
      console.log(`  \x1b[36mi\x1b[0m ${message}`)
    }
    this.ora = null
    return this
  }

  /**
   * Stop the spinner without any status
   */
  stop(): this {
    if (this.ora) {
      this.ora.stop()
      this.ora = null
    }
    return this
  }

  /**
   * Run a series of steps with progress indication
   */
  async runSteps(steps: ProgressStep[]): Promise<void> {
    for (const step of steps) {
      this.start(step.name)
      try {
        if (step.task) {
          await step.task()
        }
        this.succeed(step.name.replace('...', ''))
      } catch (error) {
        this.fail(step.name.replace('...', ''))
        throw error
      }
    }
  }
}

/**
 * Create a new progress indicator
 */
export function createProgress(options: ProgressOptions = {}): Progress {
  return new Progress(options)
}

/**
 * Simple step runner with progress indication
 *
 * @example
 * await withProgress('Installing dependencies...', async () => {
 *   await execAsync('npm install')
 * })
 */
export async function withProgress<T>(
  message: string,
  task: () => Promise<T>,
  options: ProgressOptions = {}
): Promise<T> {
  const progress = createProgress(options)
  progress.start(message)
  try {
    const result = await task()
    progress.succeed(message.replace('...', ''))
    return result
  } catch (error) {
    progress.fail(message.replace('...', ''))
    throw error
  }
}

/**
 * Create a multi-step progress runner
 *
 * @example
 * const steps = stepRunner()
 * await steps.run('Creating files...', async () => { ... })
 * await steps.run('Installing deps...', async () => { ... })
 * steps.complete('Project initialized!')
 */
export function stepRunner(options: ProgressOptions = {}) {
  const progress = createProgress(options)
  let completed = 0
  let failed = false

  return {
    /**
     * Run a single step with progress
     */
    async run<T>(message: string, task: () => Promise<T>): Promise<T> {
      if (failed) {
        throw new Error('Previous step failed')
      }
      progress.start(message)
      try {
        const result = await task()
        progress.succeed(message.replace('...', ''))
        completed++
        return result
      } catch (error) {
        failed = true
        progress.fail(message.replace('...', ''))
        throw error
      }
    },

    /**
     * Log info without a spinner
     */
    info(message: string): void {
      progress.info(message)
    },

    /**
     * Log warning without a spinner
     */
    warn(message: string): void {
      progress.warn(message)
    },

    /**
     * Mark all steps as complete
     */
    complete(message: string): void {
      console.log('')
      console.log(`\x1b[32m\u2713\x1b[0m ${message}`)
    },

    /**
     * Get the count of completed steps
     */
    get completedCount(): number {
      return completed
    },

    /**
     * Check if any step failed
     */
    get hasFailed(): boolean {
      return failed
    },
  }
}
