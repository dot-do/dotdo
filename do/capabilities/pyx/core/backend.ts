/**
 * Python Backend Interface and Mock Implementation
 *
 * Defines the interface for Python execution backends (Pyodide, remote, etc.)
 * and provides a MockBackend for testing.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Result of executing Python code
 */
export interface ExecResult {
  /** The return value of the last expression, or null */
  result: unknown
  /** Captured stdout output */
  stdout: string
  /** Captured stderr output */
  stderr: string
  /** Execution duration in milliseconds */
  duration: number
}

/**
 * Options for code execution
 */
export interface ExecOptions {
  /** Timeout in milliseconds */
  timeout?: number
  /** Global variables to inject before execution */
  globals?: Record<string, unknown>
}

/**
 * Represents an imported Python module
 */
export interface PyModule {
  /** Module name */
  name: string
  /** Call a function on this module */
  call(funcName: string, ...args: unknown[]): Promise<unknown>
  /** Get an attribute from this module */
  get(attrName: string): Promise<unknown>
}

/**
 * Represents an installed Python package
 */
export interface Package {
  /** Package name */
  name: string
  /** Package version */
  version: string
}

// ============================================================================
// PythonBackend Interface
// ============================================================================

/**
 * Interface for Python execution backends
 *
 * Implementations may include:
 * - PyodideBackend: In-browser WebAssembly Python
 * - RemoteBackend: Server-side Python execution
 * - MockBackend: For testing
 */
export interface PythonBackend {
  /**
   * Execute Python code
   * @param code - Python source code to execute
   * @param options - Optional execution options
   */
  exec(code: string, options?: ExecOptions): Promise<ExecResult>

  /**
   * Execute Python code with pre-set globals
   * @param code - Python source code to execute
   * @param globals - Variables to inject into global scope
   */
  execWithGlobals(code: string, globals: Record<string, unknown>): Promise<ExecResult>

  /**
   * Import a Python module
   * @param name - Module name to import
   * @throws Error if module not found
   */
  importModule(name: string): Promise<PyModule>

  /**
   * Get a global variable by name
   * @param name - Variable name
   * @returns The value, or undefined if not found
   */
  getGlobal(name: string): Promise<unknown>

  /**
   * Set a global variable
   * @param name - Variable name
   * @param value - Value to set
   */
  setGlobal(name: string, value: unknown): Promise<void>

  /**
   * Install a Python package
   * @param name - Package name
   * @param version - Optional version specifier
   */
  installPackage(name: string, version?: string): Promise<void>

  /**
   * List installed packages
   */
  listPackages(): Promise<Package[]>

  /**
   * Create a snapshot of the current state
   * @returns Serialized state as Uint8Array
   */
  createSnapshot(): Promise<Uint8Array>

  /**
   * Restore state from a snapshot
   * @param data - Serialized state from createSnapshot
   */
  restoreSnapshot(data: Uint8Array): Promise<void>

  /**
   * Reset to a clean state
   */
  reset(): Promise<void>
}

// ============================================================================
// MockBackend Implementation
// ============================================================================

/**
 * Recorded method call
 */
export interface MethodCall {
  /** Method name */
  method: string
  /** Arguments passed */
  args: unknown[]
  /** When the call occurred */
  timestamp: Date
}

/**
 * Mock implementation of PythonBackend for testing
 *
 * Features:
 * - Configurable responses for specific code patterns
 * - Call recording for verification
 * - Error simulation
 */
export class MockBackend implements PythonBackend {
  private responses: Map<string, ExecResult> = new Map()
  private responsePatterns: Array<{ pattern: RegExp; response: ExecResult }> = []
  private responseErrors: Map<string, Error> = new Map()
  private methodErrors: Map<string, Error> = new Map()
  private calls: MethodCall[] = []
  private globals: Map<string, unknown> = new Map()
  private packages: Map<string, Package> = new Map()
  private modules: Map<string, PyModule> = new Map()
  // Stored snapshot for potential future use (e.g., incremental snapshots)
  private storedSnapshot: {
    globals: Map<string, unknown>
    packages: Map<string, Package>
  } | null = null

  /**
   * Get the last stored snapshot (for testing/debugging)
   */
  getLastSnapshot(): { globals: Map<string, unknown>; packages: Map<string, Package> } | null {
    return this.storedSnapshot
  }

  /**
   * Configure a specific response for exact code match
   */
  setResponse(code: string, response: ExecResult): void {
    this.responses.set(code, response)
  }

  /**
   * Configure a response for code matching a pattern
   */
  setResponsePattern(pattern: RegExp, response: ExecResult): void {
    this.responsePatterns.push({ pattern, response })
  }

  /**
   * Configure an error to throw for specific code
   */
  setResponseError(code: string, error: Error): void {
    this.responseErrors.set(code, error)
  }

  /**
   * Configure an error to throw for a specific method
   */
  setError(method: string, error: Error): void {
    this.methodErrors.set(method, error)
  }

  /**
   * Get all recorded calls for a specific method
   */
  getCalls(method: string): MethodCall[] {
    return this.calls.filter((c) => c.method === method)
  }

  /**
   * Get all recorded calls
   */
  getAllCalls(): MethodCall[] {
    return [...this.calls]
  }

  /**
   * Clear all recorded calls
   */
  clearCalls(): void {
    this.calls = []
  }

  /**
   * Configure a mock module
   */
  setModule(name: string, mod: PyModule): void {
    this.modules.set(name, mod)
  }

  private recordCall(method: string, args: unknown[]): void {
    this.calls.push({
      method,
      args,
      timestamp: new Date(),
    })
  }

  private checkMethodError(method: string): void {
    const error = this.methodErrors.get(method)
    if (error) {
      throw error
    }
  }

  private getResponse(code: string): ExecResult | undefined {
    // Check exact match first
    const exact = this.responses.get(code)
    if (exact) return exact

    // Check patterns
    for (const { pattern, response } of this.responsePatterns) {
      if (pattern.test(code)) {
        return response
      }
    }

    return undefined
  }

  private defaultResponse(): ExecResult {
    return {
      result: null,
      stdout: '',
      stderr: '',
      duration: 0,
    }
  }

  async exec(code: string, options?: ExecOptions): Promise<ExecResult> {
    this.recordCall('exec', [code, options])
    this.checkMethodError('exec')

    // Check for code-specific error
    const error = this.responseErrors.get(code)
    if (error) {
      throw error
    }

    // Apply globals from options
    if (options?.globals) {
      for (const [key, value] of Object.entries(options.globals)) {
        this.globals.set(key, value)
      }
    }

    const response = this.getResponse(code)
    return response ?? this.defaultResponse()
  }

  async execWithGlobals(code: string, globals: Record<string, unknown>): Promise<ExecResult> {
    this.recordCall('execWithGlobals', [code, globals])
    this.checkMethodError('execWithGlobals')

    // Set globals
    for (const [key, value] of Object.entries(globals)) {
      this.globals.set(key, value)
    }

    const response = this.getResponse(code)
    return response ?? this.defaultResponse()
  }

  async importModule(name: string): Promise<PyModule> {
    this.recordCall('importModule', [name])
    this.checkMethodError('importModule')

    const mod = this.modules.get(name)
    if (mod) return mod

    // For common modules, return a mock
    if (['json', 'os', 'sys', 'math', 're'].includes(name)) {
      return this.createMockModule(name)
    }

    throw new Error(`ModuleNotFoundError: No module named '${name}'`)
  }

  private createMockModule(name: string): PyModule {
    return {
      name,
      call: async (funcName: string, ...args: unknown[]) => {
        this.recordCall(`${name}.${funcName}`, args)
        return null
      },
      get: async (_attrName: string) => {
        return undefined
      },
    }
  }

  async getGlobal(name: string): Promise<unknown> {
    this.recordCall('getGlobal', [name])
    this.checkMethodError('getGlobal')
    return this.globals.get(name)
  }

  async setGlobal(name: string, value: unknown): Promise<void> {
    this.recordCall('setGlobal', [name, value])
    this.checkMethodError('setGlobal')
    this.globals.set(name, value)
  }

  async installPackage(name: string, version?: string): Promise<void> {
    this.recordCall('installPackage', [name, version])
    this.checkMethodError('installPackage')

    this.packages.set(name, {
      name,
      version: version ?? '1.0.0',
    })
  }

  async listPackages(): Promise<Package[]> {
    this.recordCall('listPackages', [])
    this.checkMethodError('listPackages')
    return Array.from(this.packages.values())
  }

  async createSnapshot(): Promise<Uint8Array> {
    this.recordCall('createSnapshot', [])
    this.checkMethodError('createSnapshot')

    // Store current state
    this.storedSnapshot = {
      globals: new Map(this.globals),
      packages: new Map(this.packages),
    }

    // Return a mock snapshot (just the serialized state reference)
    const encoder = new TextEncoder()
    return encoder.encode(JSON.stringify({
      globals: Object.fromEntries(this.globals),
      packages: Object.fromEntries(this.packages),
    }))
  }

  async restoreSnapshot(data: Uint8Array): Promise<void> {
    this.recordCall('restoreSnapshot', [data])
    this.checkMethodError('restoreSnapshot')

    // Restore from data
    const decoder = new TextDecoder()
    const parsed = JSON.parse(decoder.decode(data))

    this.globals = new Map(Object.entries(parsed.globals))
    this.packages = new Map(
      Object.entries(parsed.packages).map(([name, pkg]) => [name, pkg as Package])
    )
  }

  async reset(): Promise<void> {
    this.recordCall('reset', [])
    this.checkMethodError('reset')

    this.globals.clear()
    this.packages.clear()
    this.modules.clear()
  }
}
