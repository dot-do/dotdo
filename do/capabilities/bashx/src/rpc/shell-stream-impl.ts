/**
 * ShellStreamImpl - Streaming process handle implementation
 *
 * Implements the ShellStream interface using Node.js child_process.spawn().
 * Provides streaming I/O with callbacks for stdout, stderr, and process exit.
 *
 * @packageDocumentation
 */

import type { ChildProcess } from 'node:child_process'
import type {
  ShellStream,
  ShellResult,
  ShellDataCallback,
  ShellExitCallback,
} from '../../core/rpc/types.js'

/**
 * Implementation of ShellStream interface wrapping a Node.js ChildProcess.
 * Provides streaming access to process I/O with callback-based events.
 */
export class ShellStreamImpl implements ShellStream {
  private readonly _process: ChildProcess
  private readonly _pid: number

  // Callback arrays
  private _dataCallbacks: ShellDataCallback[] = []
  private _stderrCallbacks: ShellDataCallback[] = []
  private _exitCallbacks: ShellExitCallback[] = []

  // Output buffers for late-registered callbacks
  private _stdoutBuffer: string[] = []
  private _stderrBuffer: string[] = []

  // State tracking
  private _disposed = false
  private _exited = false
  private _stdinClosed = false
  private _finalResult: ShellResult | null = null
  private _exitCode: number | null = null
  private _exitSignal: string | undefined

  // Promise for wait()
  private _waitPromise: Promise<ShellResult> | null = null
  private _waitResolve: ((result: ShellResult) => void) | null = null

  constructor(process: ChildProcess) {
    this._process = process
    this._pid = process.pid ?? 0

    // Set up stdout handler
    if (process.stdout) {
      process.stdout.setEncoding('utf8')
      process.stdout.on('data', (chunk: string) => {
        this._stdoutBuffer.push(chunk)
        for (const cb of this._dataCallbacks) {
          cb(chunk)
        }
      })
    }

    // Set up stderr handler
    if (process.stderr) {
      process.stderr.setEncoding('utf8')
      process.stderr.on('data', (chunk: string) => {
        this._stderrBuffer.push(chunk)
        for (const cb of this._stderrCallbacks) {
          cb(chunk)
        }
      })
    }

    // Set up exit handler
    process.on('exit', (code, signal) => {
      this._exited = true
      this._exitCode = code ?? (signal ? -1 : 0)
      this._exitSignal = signal ?? undefined

      this._finalResult = {
        stdout: this._stdoutBuffer.join(''),
        stderr: this._stderrBuffer.join(''),
        exitCode: this._exitCode,
        signal: this._exitSignal,
      }

      // Notify exit callbacks
      for (const cb of this._exitCallbacks) {
        cb(this._exitCode, this._exitSignal)
      }

      // Resolve wait promise
      if (this._waitResolve) {
        this._waitResolve(this._finalResult)
      }
    })

    // Handle process error (e.g., spawn failure)
    process.on('error', (err) => {
      if (!this._exited) {
        this._exited = true
        this._exitCode = 1
        this._stderrBuffer.push(err.message)

        this._finalResult = {
          stdout: this._stdoutBuffer.join(''),
          stderr: this._stderrBuffer.join(''),
          exitCode: 1,
        }

        for (const cb of this._exitCallbacks) {
          cb(1, undefined)
        }

        if (this._waitResolve) {
          this._waitResolve(this._finalResult)
        }
      }
    })
  }

  /**
   * Process ID of the spawned process (read-only)
   */
  get pid(): number {
    return this._pid
  }

  /**
   * Write data to the process stdin.
   * @param data - String to write to stdin
   * @throws Error if stream is disposed
   */
  write(data: string): void {
    if (this._disposed) {
      throw new Error('Stream disposed')
    }
    if (this._stdinClosed) {
      throw new Error('Stdin already closed')
    }
    if (this._process.stdin) {
      this._process.stdin.write(data)
    }
  }

  /**
   * Close the stdin stream, signaling EOF to the process.
   * Idempotent - safe to call multiple times.
   */
  closeStdin(): void {
    if (this._disposed) {
      throw new Error('Stream disposed')
    }
    if (!this._stdinClosed && this._process.stdin) {
      this._stdinClosed = true
      this._process.stdin.end()
    }
  }

  /**
   * Terminate the process with the specified signal.
   * Safe to call on already-exited or disposed processes.
   * @param signal - Signal to send (defaults to 'SIGTERM')
   */
  kill(signal?: string): void {
    if (this._disposed || this._exited) {
      return
    }
    const sig = signal ?? 'SIGTERM'
    this._process.kill(sig as NodeJS.Signals)
  }

  /**
   * Register a callback for stdout data.
   * Late-registered callbacks receive any buffered data.
   * @param callback - Function to call with each stdout chunk
   * @returns Unsubscribe function
   * @throws Error if stream is disposed
   */
  onData(callback: ShellDataCallback): () => void {
    if (this._disposed) {
      throw new Error('Stream disposed')
    }
    this._dataCallbacks.push(callback)

    // Send buffered data to late subscriber
    for (const chunk of this._stdoutBuffer) {
      callback(chunk)
    }

    return () => {
      const idx = this._dataCallbacks.indexOf(callback)
      if (idx !== -1) {
        this._dataCallbacks.splice(idx, 1)
      }
    }
  }

  /**
   * Register a callback for stderr data.
   * Late-registered callbacks receive any buffered data.
   * @param callback - Function to call with each stderr chunk
   * @returns Unsubscribe function
   * @throws Error if stream is disposed
   */
  onStderr(callback: ShellDataCallback): () => void {
    if (this._disposed) {
      throw new Error('Stream disposed')
    }
    this._stderrCallbacks.push(callback)

    // Send buffered data to late subscriber
    for (const chunk of this._stderrBuffer) {
      callback(chunk)
    }

    return () => {
      const idx = this._stderrCallbacks.indexOf(callback)
      if (idx !== -1) {
        this._stderrCallbacks.splice(idx, 1)
      }
    }
  }

  /**
   * Register a callback for process exit.
   * If process already exited, callback is called immediately.
   * @param callback - Function to call when process exits
   * @returns Unsubscribe function
   * @throws Error if stream is disposed
   */
  onExit(callback: ShellExitCallback): () => void {
    if (this._disposed) {
      throw new Error('Stream disposed')
    }
    this._exitCallbacks.push(callback)

    // If already exited, call immediately
    if (this._exited && this._exitCode !== null) {
      callback(this._exitCode, this._exitSignal)
    }

    return () => {
      const idx = this._exitCallbacks.indexOf(callback)
      if (idx !== -1) {
        this._exitCallbacks.splice(idx, 1)
      }
    }
  }

  /**
   * Wait for the process to complete.
   * @returns Promise that resolves with the final ShellResult
   */
  wait(): Promise<ShellResult> {
    if (this._finalResult) {
      return Promise.resolve(this._finalResult)
    }

    if (!this._waitPromise) {
      this._waitPromise = new Promise((resolve) => {
        this._waitResolve = resolve
      })
    }

    return this._waitPromise
  }

  /**
   * Dispose of the stream, killing the process if still running.
   * Called automatically when using `using` syntax.
   */
  [Symbol.dispose](): void {
    if (this._disposed) {
      return
    }
    this._disposed = true

    // Kill the process if still running
    if (!this._exited) {
      this._process.kill('SIGTERM')
    }

    // Clear callbacks
    this._dataCallbacks.length = 0
    this._stderrCallbacks.length = 0
    this._exitCallbacks.length = 0
  }
}
