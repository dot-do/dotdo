/**
 * React Ink Adapter for VirtualPTY
 *
 * Provides Node.js stream interfaces that wrap VirtualPTY,
 * allowing React Ink to render to a headless virtual terminal.
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { VirtualPTY, InkAdapter } from '@dotdo/bashx/pty'
 * import { render } from 'ink'
 * import React from 'react'
 *
 * const pty = new VirtualPTY({ cols: 80, rows: 24 })
 * const adapter = new InkAdapter(pty)
 *
 * // Render Ink app to VirtualPTY
 * const app = render(<MyApp />, adapter.getInkOptions())
 *
 * // Screen content is now in VirtualPTY
 * console.log(pty.toString())
 *
 * // Cleanup
 * app.unmount()
 * adapter.dispose()
 * ```
 */

import { EventEmitter } from 'events'
import type { VirtualPTY } from './virtual-pty.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration options for InkAdapter
 */
export interface InkAdapterOptions {
  /** Enable debug mode in Ink (default: false) */
  debug?: boolean
  /** Exit on Ctrl+C (default: true) */
  exitOnCtrlC?: boolean
  /** Patch console methods (default: true) */
  patchConsole?: boolean
}

/**
 * Options object compatible with Ink's render() function
 */
export interface InkRenderOptions {
  stdout: InkWriteStream
  stdin: InkReadStream
  stderr: InkWriteStream
  debug: boolean
  exitOnCtrlC: boolean
  patchConsole: boolean
}

/**
 * Stream triplet for Ink
 */
export interface InkStreams {
  stdout: InkWriteStream
  stderr: InkWriteStream
  stdin: InkReadStream
}

// ============================================================================
// WriteStream Implementation
// ============================================================================

/**
 * A write stream that wraps VirtualPTY, compatible with Ink's stdout/stderr
 *
 * Implements the subset of NodeJS.WriteStream that Ink actually uses.
 */
export class InkWriteStream extends EventEmitter {
  readonly isTTY = true as const
  readonly writable = true
  readonly writableHighWaterMark = 16384
  readonly writableLength = 0

  private _pty: VirtualPTY
  private _disposed = false
  private _unsubscribeResize: (() => void) | null = null

  constructor(pty: VirtualPTY) {
    super()
    this._pty = pty

    // Subscribe to PTY screen changes to detect resize
    this._unsubscribeResize = pty.onScreenChange((event) => {
      if (event.type === 'resize') {
        this.emit('resize')
      }
    })
  }

  /**
   * Number of columns in the terminal
   */
  get columns(): number {
    return this._pty.columns
  }

  /**
   * Number of rows in the terminal
   */
  get rows(): number {
    return this._pty.rows
  }

  /**
   * Write data to the terminal
   */
  write(
    chunk: string | Buffer | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void
  ): boolean {
    if (this._disposed) {
      return false
    }

    // Handle overloaded signature
    const cb = typeof encoding === 'function' ? encoding : callback

    try {
      if (typeof chunk === 'string') {
        this._pty.write(chunk)
      } else if (chunk instanceof Uint8Array) {
        this._pty.write(chunk)
      } else if (Buffer.isBuffer(chunk)) {
        this._pty.write(new Uint8Array(chunk))
      }
      cb?.()
      return true
    } catch (error) {
      cb?.(error as Error)
      return false
    }
  }

  /**
   * End the stream (no-op for VirtualPTY)
   */
  end(
    chunk?: string | Buffer | Uint8Array | (() => void),
    encoding?: BufferEncoding | (() => void),
    callback?: () => void
  ): this {
    if (typeof chunk === 'function') {
      chunk()
    } else if (chunk) {
      this.write(chunk as string | Buffer | Uint8Array, encoding as BufferEncoding)
    }

    if (typeof encoding === 'function') {
      encoding()
    } else if (callback) {
      callback()
    }

    return this
  }

  /**
   * Clear current line
   * @param dir Direction: -1 = left of cursor, 0 = entire line, 1 = right of cursor
   */
  clearLine(dir: -1 | 0 | 1, callback?: () => void): boolean {
    if (this._disposed) return false

    // ESC [ K variants:
    // ESC [ 0 K - Clear from cursor to end of line
    // ESC [ 1 K - Clear from start of line to cursor
    // ESC [ 2 K - Clear entire line
    const code = dir === -1 ? 1 : dir === 1 ? 0 : 2
    this._pty.write(`\x1b[${code}K`)
    callback?.()
    return true
  }

  /**
   * Clear screen from cursor down
   */
  clearScreenDown(callback?: () => void): boolean {
    if (this._disposed) return false

    // ESC [ 0 J - Clear from cursor to end of screen
    this._pty.write('\x1b[0J')
    callback?.()
    return true
  }

  /**
   * Move cursor to absolute position
   */
  cursorTo(x: number, y?: number, callback?: () => void): boolean {
    if (this._disposed) return false

    if (y !== undefined) {
      // ESC [ row ; col H (1-based)
      this._pty.write(`\x1b[${y + 1};${x + 1}H`)
    } else {
      // ESC [ col G - Move to column (1-based)
      this._pty.write(`\x1b[${x + 1}G`)
    }
    callback?.()
    return true
  }

  /**
   * Move cursor relative to current position
   */
  moveCursor(dx: number, dy: number, callback?: () => void): boolean {
    if (this._disposed) return false

    // Vertical movement
    if (dy > 0) {
      this._pty.write(`\x1b[${dy}B`) // Down
    } else if (dy < 0) {
      this._pty.write(`\x1b[${-dy}A`) // Up
    }

    // Horizontal movement
    if (dx > 0) {
      this._pty.write(`\x1b[${dx}C`) // Forward
    } else if (dx < 0) {
      this._pty.write(`\x1b[${-dx}D`) // Backward
    }

    callback?.()
    return true
  }

  /**
   * Get terminal window size as [columns, rows]
   */
  getWindowSize(): [number, number] {
    return [this._pty.columns, this._pty.rows]
  }

  /**
   * Get color depth (8 = 256 colors, 24 = true color)
   */
  getColorDepth(_env?: object): number {
    // VirtualPTY uses xterm-256color by default
    const termType = this._pty.getInfo().termType
    if (termType.includes('256color') || termType.includes('truecolor')) {
      return 8 // 256 colors
    }
    return 4 // 16 colors
  }

  /**
   * Check if terminal supports specified number of colors
   */
  hasColors(count?: number, _env?: object): boolean {
    if (count === undefined) return true

    const depth = this.getColorDepth()
    const maxColors = Math.pow(2, depth)
    return count <= maxColors
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    this._unsubscribeResize?.()
    this._unsubscribeResize = null
    this.removeAllListeners()
  }
}

// ============================================================================
// ReadStream Implementation
// ============================================================================

/**
 * A read stream that wraps VirtualPTY input, compatible with Ink's stdin
 *
 * Implements the subset of NodeJS.ReadStream that Ink actually uses.
 */
export class InkReadStream extends EventEmitter {
  readonly isTTY = true as const
  readonly readable = true
  readonly isRawModeSupported = true

  private _pty: VirtualPTY
  private _isRaw = false
  private _disposed = false
  private _unsubscribeInput: (() => void) | null = null

  constructor(pty: VirtualPTY) {
    super()
    this._pty = pty

    // Subscribe to PTY input events
    this._unsubscribeInput = pty.onInput((data) => {
      if (this._disposed) return

      // Convert to Buffer for Node.js stream compatibility
      const buffer =
        typeof data === 'string'
          ? Buffer.from(data)
          : Buffer.from(data)

      this.emit('data', buffer)
    })
  }

  /**
   * Whether raw mode is enabled
   */
  get isRaw(): boolean {
    return this._isRaw
  }

  /**
   * Set raw mode on/off
   * In raw mode, input is character-by-character without line buffering
   */
  setRawMode(mode: boolean): this {
    this._isRaw = mode
    this._pty.setRawMode(mode)
    return this
  }

  /**
   * Resume reading (no-op for virtual PTY)
   */
  resume(): this {
    return this
  }

  /**
   * Pause reading (no-op for virtual PTY)
   */
  pause(): this {
    return this
  }

  /**
   * Reference the stream (no-op for virtual PTY)
   */
  ref(): this {
    return this
  }

  /**
   * Unreference the stream (no-op for virtual PTY)
   */
  unref(): this {
    return this
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    this._unsubscribeInput?.()
    this._unsubscribeInput = null
    this.removeAllListeners()
  }
}

// ============================================================================
// InkAdapter Class
// ============================================================================

/**
 * Adapter that bridges React Ink with VirtualPTY
 *
 * Creates Node.js-compatible stream interfaces that route I/O
 * through VirtualPTY, allowing Ink to render to a virtual terminal.
 *
 * @example
 * ```typescript
 * const pty = new VirtualPTY({ cols: 80, rows: 24 })
 * const adapter = new InkAdapter(pty)
 *
 * // Get streams for manual use
 * const { stdout, stderr, stdin } = adapter.getStreams()
 *
 * // Or get complete options for Ink's render()
 * const inkOptions = adapter.getInkOptions()
 * render(<App />, inkOptions)
 * ```
 */
export class InkAdapter {
  private _pty: VirtualPTY
  private _options: Required<InkAdapterOptions>
  private _stdout: InkWriteStream
  private _stderr: InkWriteStream
  private _stdin: InkReadStream
  private _disposed = false

  constructor(pty: VirtualPTY, options: InkAdapterOptions = {}) {
    this._pty = pty
    this._options = {
      debug: options.debug ?? false,
      exitOnCtrlC: options.exitOnCtrlC ?? true,
      patchConsole: options.patchConsole ?? true,
    }

    // Create stream wrappers
    this._stdout = new InkWriteStream(pty)
    this._stderr = new InkWriteStream(pty)
    this._stdin = new InkReadStream(pty)
  }

  /**
   * Get the wrapped streams
   */
  getStreams(): InkStreams {
    return {
      stdout: this._stdout,
      stderr: this._stderr,
      stdin: this._stdin,
    }
  }

  /**
   * Get options compatible with Ink's render() function
   */
  getInkOptions(): InkRenderOptions {
    return {
      stdout: this._stdout,
      stderr: this._stderr,
      stdin: this._stdin,
      debug: this._options.debug,
      exitOnCtrlC: this._options.exitOnCtrlC,
      patchConsole: this._options.patchConsole,
    }
  }

  /**
   * Get the underlying VirtualPTY
   */
  getPTY(): VirtualPTY {
    return this._pty
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    this._stdout.dispose()
    this._stderr.dispose()
    this._stdin.dispose()
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create Ink-compatible streams from a VirtualPTY without full adapter
 *
 * Use this when you only need the streams and not the full adapter.
 *
 * @example
 * ```typescript
 * const pty = new VirtualPTY({ cols: 80, rows: 24 })
 * const { stdout, stderr, stdin } = createInkStreams(pty)
 * ```
 */
export function createInkStreams(pty: VirtualPTY): InkStreams {
  return {
    stdout: new InkWriteStream(pty),
    stderr: new InkWriteStream(pty),
    stdin: new InkReadStream(pty),
  }
}

/**
 * Create Ink-compatible stdout from a VirtualPTY
 *
 * This is a convenience function for creating a single stdout stream.
 * For most use cases, prefer using `InkAdapter` or `createInkStreams`.
 *
 * @example
 * ```typescript
 * import { render } from 'ink'
 * import { VirtualPTY, createInkStdout, createInkStdin } from '@dotdo/bashx/pty'
 *
 * const pty = new VirtualPTY({ cols: 80, rows: 24 })
 * render(<MyApp />, {
 *   stdout: createInkStdout(pty),
 *   stdin: createInkStdin(pty)
 * })
 * ```
 */
export function createInkStdout(pty: VirtualPTY): InkWriteStream {
  return new InkWriteStream(pty)
}

/**
 * Create Ink-compatible stdin from a VirtualPTY
 *
 * This is a convenience function for creating a single stdin stream.
 * The returned stream supports `setRawMode()` for character-by-character input.
 * For most use cases, prefer using `InkAdapter` or `createInkStreams`.
 *
 * @example
 * ```typescript
 * import { render } from 'ink'
 * import { VirtualPTY, createInkStdout, createInkStdin } from '@dotdo/bashx/pty'
 *
 * const pty = new VirtualPTY({ cols: 80, rows: 24 })
 * render(<MyApp />, {
 *   stdout: createInkStdout(pty),
 *   stdin: createInkStdin(pty)
 * })
 * ```
 */
export function createInkStdin(pty: VirtualPTY): InkReadStream {
  return new InkReadStream(pty)
}

/**
 * Create Ink-compatible stderr from a VirtualPTY
 *
 * This is a convenience function for creating a single stderr stream.
 * For most use cases, prefer using `InkAdapter` or `createInkStreams`.
 *
 * @example
 * ```typescript
 * const pty = new VirtualPTY({ cols: 80, rows: 24 })
 * const stderr = createInkStderr(pty)
 * ```
 */
export function createInkStderr(pty: VirtualPTY): InkWriteStream {
  return new InkWriteStream(pty)
}
