/**
 * pyx - Python for Cloudflare Workers
 *
 * Run Python at the edge with Pyodide. Scientific computing, data analysis,
 * and ML inference in V8 isolates with ~1s cold starts and memory snapshots.
 *
 * @example Basic execution
 * ```typescript
 * import { py } from 'pyx'
 *
 * const result = await py.exec(`
 *   import numpy as np
 *   arr = np.array([1, 2, 3, 4, 5])
 *   np.mean(arr)
 * `)
 * console.log(result) // 3.0
 * ```
 *
 * @example Persistent session
 * ```typescript
 * import { py } from 'pyx'
 *
 * const session = await py.session()
 * await session.run('x = 10')
 * await session.run('y = 20')
 * const sum = await session.run('x + y')
 * console.log(sum) // 30
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Core exports - AST, Transform, Safety
// =============================================================================

export * from './core/ast/index.js'
export * from './core/transform/index.js'
export * from './core/safety/index.js'

// =============================================================================
// Type definitions
// =============================================================================

/**
 * Result of Python code execution
 */
export interface PyExecResult {
  /** The return value of the last expression */
  result: unknown
  /** Captured stdout output */
  stdout: string
  /** Captured stderr output */
  stderr: string
  /** Execution time in milliseconds */
  duration: number
}

/**
 * Options for Python execution
 */
export interface PyExecOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Environment variables to set */
  env?: Record<string, string>
  /** Packages to install before execution */
  packages?: string[]
  /** Whether to capture stdout (default: true) */
  captureStdout?: boolean
  /** Whether to capture stderr (default: true) */
  captureStderr?: boolean
}

/**
 * A persistent Python session with state
 */
export interface PySession {
  /** Session identifier */
  id: string
  /** Run Python code in this session */
  run(code: string, options?: PyExecOptions): Promise<PyExecResult>
  /** Install packages in this session */
  install(packages: string[]): Promise<void>
  /** Create a snapshot of this session */
  snapshot(): Promise<PySnapshot>
  /** Get session variables */
  getVariables(): Promise<Record<string, unknown>>
  /** Close the session */
  close(): Promise<void>
}

/**
 * A memory snapshot of a Python session
 */
export interface PySnapshot {
  /** Snapshot identifier */
  id: string
  /** Session ID this snapshot was created from */
  sessionId: string
  /** Size in bytes */
  size: number
  /** Creation timestamp */
  createdAt: Date
  /** Restore this snapshot to a new session */
  restore(): Promise<PySession>
}

/**
 * Options for creating a Python session
 */
export interface PySessionOptions {
  /** Restore from an existing snapshot */
  snapshot?: string | PySnapshot
  /** Packages to pre-install */
  packages?: string[]
  /** Session timeout in milliseconds */
  timeout?: number
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Main pyx API for Python execution
 */
export interface PyAPI {
  /**
   * Execute Python code
   *
   * @example
   * ```typescript
   * const result = await py.exec('2 + 2')
   * console.log(result.result) // 4
   * ```
   */
  exec(code: string, options?: PyExecOptions): Promise<PyExecResult>

  /**
   * Create a persistent Python session
   *
   * @example
   * ```typescript
   * const session = await py.session()
   * await session.run('x = 10')
   * const result = await session.run('x * 2')
   * console.log(result.result) // 20
   * ```
   */
  session(options?: PySessionOptions): Promise<PySession>

  /**
   * Install Python packages
   *
   * @example
   * ```typescript
   * await py.install(['numpy', 'pandas'])
   * ```
   */
  install(packages: string[]): Promise<void>

  /**
   * List available snapshots
   */
  listSnapshots(): Promise<PySnapshot[]>

  /**
   * Get a snapshot by ID
   */
  getSnapshot(id: string): Promise<PySnapshot | null>

  /**
   * Delete a snapshot
   */
  deleteSnapshot(id: string): Promise<void>
}

/**
 * Create a pyx instance
 *
 * @example
 * ```typescript
 * import { createPy } from 'pyx'
 *
 * const py = createPy()
 * const result = await py.exec('print("Hello")')
 * ```
 */
export function createPy(): PyAPI {
  // TODO: Implement Pyodide integration
  throw new Error('createPy() not implemented')
}

/**
 * Default pyx instance for quick usage
 *
 * @example
 * ```typescript
 * import { py } from 'pyx'
 *
 * const result = await py.exec('1 + 1')
 * console.log(result.result) // 2
 * ```
 */
export const py: PyAPI = {
  exec: async () => {
    throw new Error('py.exec() not implemented')
  },
  session: async () => {
    throw new Error('py.session() not implemented')
  },
  install: async () => {
    throw new Error('py.install() not implemented')
  },
  listSnapshots: async () => {
    throw new Error('py.listSnapshots() not implemented')
  },
  getSnapshot: async () => {
    throw new Error('py.getSnapshot() not implemented')
  },
  deleteSnapshot: async () => {
    throw new Error('py.deleteSnapshot() not implemented')
  },
}

// =============================================================================
// Notebook API
// =============================================================================

/**
 * A notebook cell
 */
export interface NotebookCell {
  id: string
  type: 'code' | 'markdown'
  source: string
  output?: PyExecResult
  executionCount?: number
}

/**
 * A Python notebook
 */
export interface Notebook {
  id: string
  name: string
  cells: NotebookCell[]
  session: PySession
  /** Add a new cell */
  addCell(type: 'code' | 'markdown', source?: string): NotebookCell
  /** Remove a cell */
  removeCell(id: string): void
  /** Execute a cell */
  executeCell(id: string): Promise<PyExecResult>
  /** Execute all cells */
  executeAll(): Promise<PyExecResult[]>
  /** Save notebook */
  save(): Promise<void>
  /** Export to .ipynb format */
  toIPynb(): string
}

/**
 * Create a new notebook
 */
export function createNotebook(_name?: string): Promise<Notebook> {
  throw new Error('createNotebook() not implemented')
}

/**
 * Load a notebook from .ipynb format
 */
export function loadNotebook(_ipynb: string): Promise<Notebook> {
  throw new Error('loadNotebook() not implemented')
}
