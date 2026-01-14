/**
 * Spinner and Progress Utilities
 *
 * Enhanced spinner and progress indicators for CLI operations.
 * Supports TTY detection, timing information, and multiple spinner styles.
 */

// ============================================================================
// Types
// ============================================================================

export interface SpinnerOptions {
  /** Custom spinner text */
  text?: string
  /** Spinner style (dots, line, arrow, etc.) */
  style?: SpinnerStyle
  /** Show elapsed time while spinning */
  showElapsed?: boolean
  /** Prefix text before spinner */
  prefix?: string
  /** Stream to write to (defaults to stdout) */
  stream?: NodeJS.WriteStream
}

export interface TimedResult<T> {
  result: T
  elapsed: number
  elapsedFormatted: string
}

export type SpinnerStyle = 'dots' | 'line' | 'arrow' | 'bounce' | 'pulse' | 'simple'

// ============================================================================
// Constants
// ============================================================================

/** ANSI color codes */
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

/** Spinner frame sets for different styles */
const spinnerFrames: Record<SpinnerStyle, string[]> = {
  dots: ['...', '..', '.', '..', '...', '....'],
  line: ['|', '/', '-', '\\'],
  arrow: ['>', '>>', '>>>', '>>>>', '>>>'],
  bounce: ['.', 'o', 'O', 'o'],
  pulse: ['*', '+', '*', '-'],
  simple: ['-', '\\', '|', '/'],
}

/** Status icons */
const statusIcons = {
  success: `${colors.green}OK${colors.reset}`,
  fail: `${colors.red}FAIL${colors.reset}`,
  warn: `${colors.yellow}WARN${colors.reset}`,
  info: `${colors.blue}INFO${colors.reset}`,
  skip: `${colors.dim}SKIP${colors.reset}`,
}

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * Check if the output is an interactive TTY
 */
export function isInteractive(stream?: NodeJS.WriteStream): boolean {
  const s = stream ?? process.stdout
  return Boolean(s.isTTY) && !process.env.CI && process.env.TERM !== 'dumb'
}

/**
 * Check if colors are supported
 */
export function supportsColor(stream?: NodeJS.WriteStream): boolean {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR) return true
  const s = stream ?? process.stdout
  return Boolean(s.isTTY)
}

// ============================================================================
// Time Formatting
// ============================================================================

/**
 * Format elapsed time in a human-readable way
 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  if (ms < 60000) {
    const secs = (ms / 1000).toFixed(1)
    return `${secs}s`
  }
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return `${mins}m ${secs}s`
}

/**
 * Create a stopwatch for timing operations
 */
export function createStopwatch(): { elapsed: () => number; formatted: () => string } {
  const start = Date.now()
  return {
    elapsed: () => Date.now() - start,
    formatted: () => formatElapsed(Date.now() - start),
  }
}

// ============================================================================
// Spinner Class
// ============================================================================

/**
 * Enhanced spinner for long-running operations
 */
export class Spinner {
  private text: string
  private style: SpinnerStyle
  private showElapsed: boolean
  private prefix: string
  private stream: NodeJS.WriteStream
  private frames: string[]
  private frameIndex = 0
  private interval: ReturnType<typeof setInterval> | null = null
  private startTime: number = 0
  private isInteractive: boolean
  private useColors: boolean

  constructor(options: SpinnerOptions = {}) {
    this.text = options.text ?? ''
    this.style = options.style ?? 'line'
    this.showElapsed = options.showElapsed ?? true
    this.prefix = options.prefix ?? ''
    this.stream = options.stream ?? process.stdout
    this.frames = spinnerFrames[this.style]
    this.isInteractive = isInteractive(this.stream)
    this.useColors = supportsColor(this.stream)
  }

  /**
   * Start the spinner
   */
  start(text?: string): this {
    if (text) this.text = text
    this.startTime = Date.now()

    if (this.isInteractive) {
      // Clear line and start animation
      this.interval = setInterval(() => {
        this.render()
        this.frameIndex = (this.frameIndex + 1) % this.frames.length
      }, 120)
      // Hide cursor
      this.stream.write('\x1b[?25l')
    } else {
      // Non-interactive: just print the message
      const prefix = this.prefix ? `${this.prefix} ` : ''
      console.log(`${prefix}${this.text}...`)
    }

    return this
  }

  /**
   * Update spinner text
   */
  update(text: string): this {
    this.text = text
    if (!this.isInteractive) {
      const prefix = this.prefix ? `${this.prefix} ` : ''
      console.log(`${prefix}${text}...`)
    }
    return this
  }

  /**
   * Render current frame
   */
  private render(): void {
    const frame = this.useColors ? `${colors.cyan}${this.frames[this.frameIndex]}${colors.reset}` : this.frames[this.frameIndex]

    let line = this.prefix ? `${this.prefix} ` : ''
    line += `${frame} ${this.text}`

    if (this.showElapsed) {
      const elapsed = formatElapsed(Date.now() - this.startTime)
      line += this.useColors ? ` ${colors.dim}(${elapsed})${colors.reset}` : ` (${elapsed})`
    }

    // Clear line and write
    this.stream.write(`\r${' '.repeat(80)}\r${line}`)
  }

  /**
   * Stop spinner with success status
   */
  succeed(text?: string): void {
    this.stop('success', text)
  }

  /**
   * Stop spinner with failure status
   */
  fail(text?: string): void {
    this.stop('fail', text)
  }

  /**
   * Stop spinner with warning status
   */
  warn(text?: string): void {
    this.stop('warn', text)
  }

  /**
   * Stop spinner with info status
   */
  info(text?: string): void {
    this.stop('info', text)
  }

  /**
   * Stop spinner (skipped status)
   */
  skip(text?: string): void {
    this.stop('skip', text)
  }

  /**
   * Stop the spinner with a given status
   */
  private stop(status: keyof typeof statusIcons, text?: string): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }

    const finalText = text ?? this.text
    const elapsed = formatElapsed(Date.now() - this.startTime)
    const icon = this.useColors ? statusIcons[status] : status.toUpperCase()

    if (this.isInteractive) {
      // Show cursor
      this.stream.write('\x1b[?25h')
      // Clear line
      this.stream.write(`\r${' '.repeat(80)}\r`)
    }

    // Print final message
    let line = this.prefix ? `${this.prefix} ` : ''
    line += `[${icon}] ${finalText}`
    if (this.showElapsed) {
      line += this.useColors ? ` ${colors.dim}(${elapsed})${colors.reset}` : ` (${elapsed})`
    }
    console.log(line)
  }

  /**
   * Clear the spinner without printing anything
   */
  clear(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (this.isInteractive) {
      this.stream.write('\x1b[?25h')
      this.stream.write(`\r${' '.repeat(80)}\r`)
    }
  }
}

// ============================================================================
// Progress Bar
// ============================================================================

export interface ProgressBarOptions {
  /** Total number of items */
  total: number
  /** Bar width in characters */
  width?: number
  /** Format string: :bar :current/:total :percent :elapsed */
  format?: string
  /** Show percentage */
  showPercent?: boolean
  /** Show elapsed time */
  showElapsed?: boolean
  /** Completed character */
  complete?: string
  /** Incomplete character */
  incomplete?: string
  /** Stream to write to */
  stream?: NodeJS.WriteStream
}

/**
 * Progress bar for iterative operations
 */
export class ProgressBar {
  private total: number
  private current = 0
  private width: number
  private format: string
  private completeChar: string
  private incompleteChar: string
  private stream: NodeJS.WriteStream
  private startTime: number = 0
  private isInteractive: boolean
  private useColors: boolean
  private lastRender = 0

  constructor(options: ProgressBarOptions) {
    this.total = options.total
    this.width = options.width ?? 30
    this.format = options.format ?? ':bar :current/:total :percent :elapsed'
    this.completeChar = options.complete ?? '#'
    this.incompleteChar = options.incomplete ?? '-'
    this.stream = options.stream ?? process.stdout
    this.isInteractive = isInteractive(this.stream)
    this.useColors = supportsColor(this.stream)
  }

  /**
   * Start the progress bar
   */
  start(): this {
    this.startTime = Date.now()
    this.current = 0
    if (this.isInteractive) {
      this.stream.write('\x1b[?25l') // Hide cursor
    }
    return this
  }

  /**
   * Increment progress
   */
  tick(amount = 1): this {
    this.current = Math.min(this.current + amount, this.total)
    this.render()
    return this
  }

  /**
   * Set absolute progress
   */
  update(current: number): this {
    this.current = Math.min(current, this.total)
    this.render()
    return this
  }

  /**
   * Render the progress bar
   */
  private render(): void {
    // Throttle renders in interactive mode
    const now = Date.now()
    if (this.isInteractive && now - this.lastRender < 50 && this.current < this.total) {
      return
    }
    this.lastRender = now

    const ratio = this.current / this.total
    const percent = Math.floor(ratio * 100)
    const elapsed = formatElapsed(Date.now() - this.startTime)

    // Build bar
    const completeLen = Math.floor(this.width * ratio)
    const incompleteLen = this.width - completeLen
    let bar = this.completeChar.repeat(completeLen) + this.incompleteChar.repeat(incompleteLen)
    if (this.useColors) {
      bar = `${colors.green}${this.completeChar.repeat(completeLen)}${colors.reset}${colors.dim}${this.incompleteChar.repeat(incompleteLen)}${colors.reset}`
    }

    // Format output
    let output = this.format
      .replace(':bar', `[${bar}]`)
      .replace(':current', String(this.current))
      .replace(':total', String(this.total))
      .replace(':percent', `${percent}%`)
      .replace(':elapsed', elapsed)

    if (this.isInteractive) {
      this.stream.write(`\r${' '.repeat(80)}\r${output}`)
    }

    // Print newline on completion
    if (this.current >= this.total && this.isInteractive) {
      this.stream.write('\n')
      this.stream.write('\x1b[?25h') // Show cursor
    }
  }

  /**
   * Complete the progress bar
   */
  complete(): void {
    this.current = this.total
    this.render()
    if (this.isInteractive) {
      this.stream.write('\x1b[?25h')
    }
  }
}

// ============================================================================
// Task Runner
// ============================================================================

export interface Task {
  title: string
  task: () => Promise<unknown> | unknown
  skip?: () => boolean | string
}

export interface TaskRunnerOptions {
  /** Continue on error */
  continueOnError?: boolean
  /** Show timing for each task */
  showTiming?: boolean
  /** Prefix for output */
  prefix?: string
}

/**
 * Run a series of tasks with spinners
 */
export async function runTasks(tasks: Task[], options: TaskRunnerOptions = {}): Promise<void> {
  const { continueOnError = false, showTiming = true, prefix = '' } = options

  for (const task of tasks) {
    // Check skip
    if (task.skip) {
      const skipResult = task.skip()
      if (skipResult) {
        const skipReason = typeof skipResult === 'string' ? skipResult : 'Skipped'
        const spinner = new Spinner({
          text: task.title,
          prefix,
          showElapsed: showTiming,
        })
        spinner.start()
        spinner.skip(skipReason)
        continue
      }
    }

    const spinner = new Spinner({
      text: task.title,
      prefix,
      showElapsed: showTiming,
    })

    spinner.start()

    try {
      await task.task()
      spinner.succeed()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      spinner.fail(`${task.title}: ${message}`)
      if (!continueOnError) {
        throw error
      }
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create and start a spinner
 */
export function spin(text: string, options?: Omit<SpinnerOptions, 'text'>): Spinner {
  return new Spinner({ ...options, text }).start()
}

/**
 * Run an async operation with a spinner
 */
export async function withSpinner<T>(text: string, operation: () => Promise<T>, options?: Omit<SpinnerOptions, 'text'>): Promise<TimedResult<T>> {
  const spinner = spin(text, options)
  const stopwatch = createStopwatch()

  try {
    const result = await operation()
    spinner.succeed()
    return {
      result,
      elapsed: stopwatch.elapsed(),
      elapsedFormatted: stopwatch.formatted(),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    spinner.fail(`${text}: ${message}`)
    throw error
  }
}

/**
 * Print a timed operation result (for non-spinner operations)
 */
export function printTimed(text: string, status: 'success' | 'fail' | 'warn' | 'info', elapsed: number): void {
  const icon = supportsColor() ? statusIcons[status] : status.toUpperCase()
  const elapsedStr = formatElapsed(elapsed)
  const dimElapsed = supportsColor() ? `${colors.dim}(${elapsedStr})${colors.reset}` : `(${elapsedStr})`
  console.log(`[${icon}] ${text} ${dimElapsed}`)
}

/**
 * Print a simple status line without timing
 */
export function printStatus(text: string, status: 'success' | 'fail' | 'warn' | 'info' | 'skip'): void {
  const icon = supportsColor() ? statusIcons[status] : status.toUpperCase()
  console.log(`[${icon}] ${text}`)
}
