/**
 * Pyodide Backend Implementation
 *
 * Implements the PythonBackend interface using Pyodide WebAssembly runtime.
 * This backend runs Python code in V8 isolates via Cloudflare Workers.
 */

import type {
  PythonBackend,
  ExecResult,
  ExecOptions,
  PyModule,
  Package,
} from '../core/backend.js'

// =============================================================================
// Types for Pyodide Runtime
// =============================================================================

/**
 * Pyodide instance type (minimal interface)
 *
 * The actual Pyodide types are loaded dynamically from the Pyodide package.
 * This interface captures the methods we use.
 */
export interface PyodideInstance {
  runPythonAsync(code: string): Promise<unknown>
  runPython(code: string): unknown
  loadPackage(packages: string | string[]): Promise<void>
  loadPackagesFromImports(code: string): Promise<void>
  globals: PyProxy
  FS: PyodideFS
  pyimport(name: string): PyProxy
  setStdout(options: { batched: (msg: string) => void }): void
  setStderr(options: { batched: (msg: string) => void }): void
}

/**
 * Python proxy object
 */
export interface PyProxy {
  get(name: string): unknown
  set(name: string, value: unknown): void
  toJs(): unknown
  destroy(): void
}

/**
 * Pyodide filesystem interface
 */
export interface PyodideFS {
  writeFile(path: string, data: string | Uint8Array): void
  readFile(path: string, opts?: { encoding?: string }): string | Uint8Array
  mkdir(path: string): void
  rmdir(path: string): void
  unlink(path: string): void
}

/**
 * Options for creating a PyodideBackend
 */
export interface PyodideBackendOptions {
  /**
   * URL to load Pyodide from
   * @default 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/'
   */
  pyodideUrl?: string

  /**
   * Packages to pre-load
   */
  preloadPackages?: string[]

  /**
   * Memory limit in bytes
   */
  memoryLimit?: number

  /**
   * Pyodide instance (for testing/mocking)
   */
  pyodide?: PyodideInstance
}

// =============================================================================
// PyodideBackend Implementation
// =============================================================================

/**
 * Python execution backend using Pyodide WebAssembly runtime
 *
 * This backend provides:
 * - In-process Python execution in WebAssembly
 * - Package installation via micropip
 * - Memory snapshots for fast cold starts
 * - stdout/stderr capture
 */
export class PyodideBackend implements PythonBackend {
  private pyodide: PyodideInstance | null = null
  private readonly options: PyodideBackendOptions
  private installedPackages: Map<string, Package> = new Map()
  private isInitialized = false

  constructor(opts: PyodideBackendOptions = {}) {
    this.options = {
      pyodideUrl: 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/',
      ...opts,
    }

    // Use provided pyodide instance if available (for testing)
    if (opts.pyodide) {
      this.pyodide = opts.pyodide
      this.isInitialized = true
    }
  }

  /**
   * Initialize Pyodide runtime
   *
   * In production, this would load Pyodide from CDN or bundled assets.
   * The actual loading is stubbed since it requires the Pyodide runtime.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    // Stub: In production, this would be:
    // this.pyodide = await loadPyodide({ indexURL: this.options.pyodideUrl })
    throw new Error(
      'PyodideBackend.initialize() requires Pyodide runtime. ' +
        'This is stubbed for development. In production, use the Cloudflare Python binding.'
    )
  }

  /**
   * Ensure Pyodide is initialized
   */
  private ensureInitialized(): void {
    if (!this.pyodide) {
      throw new Error('Pyodide not initialized. Call initialize() first.')
    }
  }

  /**
   * Execute Python code
   */
  async exec(code: string, options?: ExecOptions): Promise<ExecResult> {
    this.ensureInitialized()

    const startTime = performance.now()
    let stdout = ''
    let stderr = ''

    // Set up stdout/stderr capture
    this.pyodide!.setStdout({
      batched: (msg: string) => {
        stdout += msg + '\n'
      },
    })

    this.pyodide!.setStderr({
      batched: (msg: string) => {
        stderr += msg + '\n'
      },
    })

    // Apply globals if provided
    if (options?.globals) {
      for (const [key, value] of Object.entries(options.globals)) {
        this.pyodide!.globals.set(key, value)
      }
    }

    // Execute with optional timeout
    let result: unknown
    try {
      if (options?.timeout) {
        result = await this.execWithTimeout(code, options.timeout)
      } else {
        result = await this.pyodide!.runPythonAsync(code)
      }

      // Convert PyProxy to JS if needed
      if (result && typeof result === 'object' && 'toJs' in result) {
        const proxy = result as PyProxy
        result = proxy.toJs()
        proxy.destroy()
      }
    } catch (error) {
      const err = error as Error
      stderr += err.message
      result = null
    }

    const duration = performance.now() - startTime

    return {
      result,
      stdout: stdout.trimEnd(),
      stderr: stderr.trimEnd(),
      duration,
    }
  }

  /**
   * Execute code with timeout
   */
  private async execWithTimeout(code: string, timeout: number): Promise<unknown> {
    return Promise.race([
      this.pyodide!.runPythonAsync(code),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Execution timeout')), timeout)
      ),
    ])
  }

  /**
   * Execute Python code with pre-set globals
   */
  async execWithGlobals(
    code: string,
    globals: Record<string, unknown>
  ): Promise<ExecResult> {
    return this.exec(code, { globals })
  }

  /**
   * Import a Python module
   */
  async importModule(name: string): Promise<PyModule> {
    this.ensureInitialized()

    // Ensure the package is loaded
    try {
      await this.pyodide!.loadPackage(name)
    } catch {
      // Package might be built-in, continue
    }

    const module = this.pyodide!.pyimport(name)

    return {
      name,
      call: async (funcName: string, ...args: unknown[]): Promise<unknown> => {
        const func = module.get(funcName)
        if (typeof func === 'function') {
          return func(...args)
        }
        throw new Error(`${name}.${funcName} is not a function`)
      },
      get: async (attrName: string): Promise<unknown> => {
        return module.get(attrName)
      },
    }
  }

  /**
   * Get a global variable by name
   */
  async getGlobal(name: string): Promise<unknown> {
    this.ensureInitialized()
    const value = this.pyodide!.globals.get(name)

    // Convert PyProxy to JS if needed
    if (value && typeof value === 'object' && 'toJs' in value) {
      const proxy = value as PyProxy
      const result = proxy.toJs()
      proxy.destroy()
      return result
    }

    return value
  }

  /**
   * Set a global variable
   */
  async setGlobal(name: string, value: unknown): Promise<void> {
    this.ensureInitialized()
    this.pyodide!.globals.set(name, value)
  }

  /**
   * Install a Python package using micropip
   */
  async installPackage(name: string, version?: string): Promise<void> {
    this.ensureInitialized()

    const packageSpec = version ? `${name}==${version}` : name

    // Use micropip for pure Python packages, loadPackage for Pyodide packages
    await this.pyodide!.runPythonAsync(`
import micropip
await micropip.install('${packageSpec}')
`)

    // Track installed package
    this.installedPackages.set(name, {
      name,
      version: version ?? 'latest',
    })
  }

  /**
   * List installed packages
   */
  async listPackages(): Promise<Package[]> {
    return Array.from(this.installedPackages.values())
  }

  /**
   * Create a memory snapshot
   *
   * Uses Pyodide's memory snapshot capability for fast restoration.
   * This serializes the entire Python heap state.
   */
  async createSnapshot(): Promise<Uint8Array> {
    this.ensureInitialized()

    // Stub: In production with Cloudflare's Python binding:
    // return this.pyodide!.makeMemorySnapshot()

    // For now, serialize what we can track
    const state = {
      packages: Object.fromEntries(this.installedPackages),
      timestamp: Date.now(),
    }

    return new TextEncoder().encode(JSON.stringify(state))
  }

  /**
   * Restore from a memory snapshot
   */
  async restoreSnapshot(data: Uint8Array): Promise<void> {
    // Stub: In production with Cloudflare's Python binding:
    // await loadPyodide({ memorySnapshot: data })

    const state = JSON.parse(new TextDecoder().decode(data))

    // Restore package tracking
    if (state.packages) {
      this.installedPackages = new Map(Object.entries(state.packages))
    }
  }

  /**
   * Reset to a clean state
   */
  async reset(): Promise<void> {
    // Clear tracked state
    this.installedPackages.clear()

    // In production, would reinitialize Pyodide
    // this.pyodide = null
    // this.isInitialized = false
    // await this.initialize()
  }

  /**
   * Check if Pyodide is initialized
   */
  get initialized(): boolean {
    return this.isInitialized
  }

  /**
   * Get the Pyodide CDN URL configured for this backend
   */
  get pyodideUrl(): string {
    return this.options.pyodideUrl ?? 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/'
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new PyodideBackend instance
 */
export function createPyodideBackend(
  options?: PyodideBackendOptions
): PyodideBackend {
  return new PyodideBackend(options)
}
