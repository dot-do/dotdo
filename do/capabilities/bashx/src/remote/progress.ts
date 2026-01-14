/**
 * Progress Reporting for Git Operations
 *
 * Provides standardized progress callbacks for clone, fetch, push operations.
 *
 * @module bashx/remote/progress
 */

// =============================================================================
// Progress Types
// =============================================================================

/**
 * Progress phases for Git operations
 */
export type ProgressPhase =
  | 'connecting'
  | 'authenticating'
  | 'counting'
  | 'compressing'
  | 'receiving'
  | 'resolving'
  | 'writing'
  | 'checking-out'
  | 'updating-refs'
  | 'done'

/**
 * Progress event with details about current operation
 */
export interface ProgressEvent {
  /** Current phase of the operation */
  phase: ProgressPhase
  /** Current item number (objects, bytes, etc.) */
  current: number
  /** Total items expected (0 if unknown) */
  total: number
  /** Bytes transferred (for network operations) */
  bytes?: number
  /** Total bytes expected (for network operations) */
  totalBytes?: number
  /** Human-readable message */
  message?: string
  /** Percentage complete (0-100, undefined if unknown) */
  percent?: number
}

/**
 * Progress callback function type
 */
export type ProgressCallback = (event: ProgressEvent) => void

/**
 * Progress reporter interface for more structured reporting
 */
export interface ProgressReporter {
  /** Called when operation phase changes */
  onPhase(phase: ProgressPhase): void
  /** Called with progress updates */
  onProgress(current: number, total: number, message?: string): void
  /** Called when bytes are transferred */
  onBytes(bytes: number, totalBytes?: number): void
  /** Called when operation completes */
  onComplete(): void
  /** Called on error */
  onError(error: Error): void
}

/**
 * Options for progress callbacks in operations
 */
export interface ProgressOptions {
  /** Simple callback for progress events */
  onProgress?: ProgressCallback
  /** Structured reporter for more detailed tracking */
  reporter?: ProgressReporter
  /** Disable progress reporting (for non-interactive use) */
  quiet?: boolean
}

// =============================================================================
// Progress Helpers
// =============================================================================

/**
 * Create a progress event
 */
export function createProgressEvent(
  phase: ProgressPhase,
  current: number,
  total: number,
  options?: {
    bytes?: number
    totalBytes?: number
    message?: string
  }
): ProgressEvent {
  const event: ProgressEvent = {
    phase,
    current,
    total,
    bytes: options?.bytes,
    totalBytes: options?.totalBytes,
    message: options?.message,
  }

  // Calculate percentage if we have total
  if (total > 0) {
    event.percent = Math.round((current / total) * 100)
  }

  return event
}

/**
 * Emit progress event through callback or reporter
 */
export function emitProgress(
  options: ProgressOptions | undefined,
  event: ProgressEvent
): void {
  if (!options || options.quiet) return

  if (options.onProgress) {
    options.onProgress(event)
  }

  if (options.reporter) {
    options.reporter.onProgress(event.current, event.total, event.message)
  }
}

/**
 * Emit phase change
 */
export function emitPhase(
  options: ProgressOptions | undefined,
  phase: ProgressPhase,
  message?: string
): void {
  if (!options || options.quiet) return

  if (options.onProgress) {
    options.onProgress(createProgressEvent(phase, 0, 0, { message }))
  }

  if (options.reporter) {
    options.reporter.onPhase(phase)
  }
}

/**
 * Emit completion
 */
export function emitComplete(options: ProgressOptions | undefined): void {
  if (!options || options.quiet) return

  if (options.onProgress) {
    options.onProgress(createProgressEvent('done', 100, 100))
  }

  if (options.reporter) {
    options.reporter.onComplete()
  }
}

/**
 * Emit error
 */
export function emitError(
  options: ProgressOptions | undefined,
  error: Error
): void {
  if (!options || options.quiet) return

  if (options.reporter) {
    options.reporter.onError(error)
  }
}

// =============================================================================
// Terminal Progress Reporter
// =============================================================================

/**
 * Progress reporter for terminal output
 */
export class TerminalProgressReporter implements ProgressReporter {
  private currentPhase: ProgressPhase = 'connecting'
  private startTime: number = Date.now()
  private lastUpdate: number = 0
  private updateInterval: number = 100 // ms between updates

  constructor(private stream: { write: (s: string) => void } = process.stderr) {
    this.startTime = Date.now()
  }

  onPhase(phase: ProgressPhase): void {
    this.currentPhase = phase
    const phaseMessages: Record<ProgressPhase, string> = {
      connecting: 'Connecting to remote...',
      authenticating: 'Authenticating...',
      counting: 'Counting objects...',
      compressing: 'Compressing objects...',
      receiving: 'Receiving objects...',
      resolving: 'Resolving deltas...',
      writing: 'Writing objects...',
      'checking-out': 'Checking out files...',
      'updating-refs': 'Updating references...',
      done: 'Done.',
    }
    this.stream.write(`\r${phaseMessages[phase]}\x1b[K`)
  }

  onProgress(current: number, total: number, message?: string): void {
    const now = Date.now()
    if (now - this.lastUpdate < this.updateInterval) return
    this.lastUpdate = now

    let output = '\r'
    if (total > 0) {
      const percent = Math.round((current / total) * 100)
      output += `${this.getPhaseLabel()}: ${percent}% (${current}/${total})`
    } else {
      output += `${this.getPhaseLabel()}: ${current}`
    }
    if (message) {
      output += ` ${message}`
    }
    output += '\x1b[K' // Clear to end of line
    this.stream.write(output)
  }

  onBytes(bytes: number, totalBytes?: number): void {
    const now = Date.now()
    if (now - this.lastUpdate < this.updateInterval) return
    this.lastUpdate = now

    const bytesStr = this.formatBytes(bytes)
    if (totalBytes) {
      const totalStr = this.formatBytes(totalBytes)
      const percent = Math.round((bytes / totalBytes) * 100)
      this.stream.write(`\r${this.getPhaseLabel()}: ${percent}% (${bytesStr}/${totalStr})\x1b[K`)
    } else {
      this.stream.write(`\r${this.getPhaseLabel()}: ${bytesStr}\x1b[K`)
    }
  }

  onComplete(): void {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2)
    this.stream.write(`\rDone in ${elapsed}s\x1b[K\n`)
  }

  onError(error: Error): void {
    this.stream.write(`\rError: ${error.message}\x1b[K\n`)
  }

  private getPhaseLabel(): string {
    const labels: Record<ProgressPhase, string> = {
      connecting: 'Connecting',
      authenticating: 'Authenticating',
      counting: 'Counting objects',
      compressing: 'Compressing',
      receiving: 'Receiving objects',
      resolving: 'Resolving deltas',
      writing: 'Writing objects',
      'checking-out': 'Checking out',
      'updating-refs': 'Updating refs',
      done: 'Done',
    }
    return labels[this.currentPhase]
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`
  }
}

// =============================================================================
// Event Progress Reporter
// =============================================================================

/**
 * Progress reporter that emits events (for programmatic use)
 */
export class EventProgressReporter implements ProgressReporter {
  private events: ProgressEvent[] = []
  private listeners: Set<ProgressCallback> = new Set()

  /**
   * Add a listener for progress events
   */
  addListener(callback: ProgressCallback): void {
    this.listeners.add(callback)
  }

  /**
   * Remove a listener
   */
  removeListener(callback: ProgressCallback): void {
    this.listeners.delete(callback)
  }

  /**
   * Get all recorded events
   */
  getEvents(): ProgressEvent[] {
    return [...this.events]
  }

  onPhase(phase: ProgressPhase): void {
    const event = createProgressEvent(phase, 0, 0)
    this.emit(event)
  }

  onProgress(current: number, total: number, message?: string): void {
    const event = createProgressEvent(
      this.events.length > 0 ? this.events[this.events.length - 1].phase : 'connecting',
      current,
      total,
      { message }
    )
    this.emit(event)
  }

  onBytes(bytes: number, totalBytes?: number): void {
    const phase = this.events.length > 0 ? this.events[this.events.length - 1].phase : 'receiving'
    const event = createProgressEvent(phase, bytes, totalBytes || 0, {
      bytes,
      totalBytes,
    })
    this.emit(event)
  }

  onComplete(): void {
    const event = createProgressEvent('done', 100, 100)
    this.emit(event)
  }

  onError(error: Error): void {
    // Record error as an event with message
    const event = createProgressEvent('done', 0, 0, { message: error.message })
    this.emit(event)
  }

  private emit(event: ProgressEvent): void {
    this.events.push(event)
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

// =============================================================================
// Noop Progress Reporter
// =============================================================================

/**
 * No-op progress reporter (for quiet mode)
 */
export class NoopProgressReporter implements ProgressReporter {
  onPhase(_phase: ProgressPhase): void {}
  onProgress(_current: number, _total: number, _message?: string): void {}
  onBytes(_bytes: number, _totalBytes?: number): void {}
  onComplete(): void {}
  onError(_error: Error): void {}
}
