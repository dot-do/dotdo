/**
 * Cloudflare Sandbox SDK Integration
 *
 * This module provides code execution in isolated containers on Cloudflare's edge
 * using the @cloudflare/sandbox SDK. Each sandbox runs in a VM-backed Durable Object
 * with full Ubuntu environment.
 *
 * @see https://developers.cloudflare.com/sandbox/
 * @see https://github.com/cloudflare/sandbox-sdk
 */

import {
  getSandbox as getCloudfareSandbox,
  proxyToSandbox,
  type Sandbox as CloudflareSandbox,
  parseSSEStream,
} from '@cloudflare/sandbox'

// Re-export Sandbox class for wrangler config
export { Sandbox } from '@cloudflare/sandbox'

// ============================================================================
// Type Definitions
// ============================================================================

export type FileType = 'js' | 'ts' | 'jsx' | 'tsx' | 'mdx' | 'md' | 'py' | 'sh'

export interface SandboxConfig {
  /** Inactivity timeout before container sleeps (default: "10m") */
  sleepAfter?: string
  /** Keep container alive indefinitely */
  keepAlive?: boolean
  /** Normalize sandbox IDs for preview URL compatibility */
  normalizeId?: boolean
  /** Container provisioning timeouts */
  containerTimeouts?: {
    instanceGetTimeoutMS?: number
    portReadyTimeoutMS?: number
  }
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
  success: boolean
}

export interface CodeContextOptions {
  language: 'python' | 'javascript' | 'typescript'
  cwd?: string
  envVars?: Record<string, string>
  timeout?: number
}

// ExecutionResult type - matches @cloudflare/sandbox internal type
// The SDK uses this type but doesn't export it from the main entry point
export interface ExecutionResult {
  code: string
  logs: { stdout: string[]; stderr: string[] }
  error?: { name: string; value: string; traceback: string[]; lineNumber?: number }
  executionCount?: number
  results: Array<{
    text?: string
    html?: string
    png?: string
    jpeg?: string
    svg?: string
    latex?: string
    markdown?: string
    javascript?: string
    json?: unknown
    chart?: unknown
    data?: unknown
  }>
}

export interface StreamEvent {
  type: 'stdout' | 'stderr' | 'complete' | 'error'
  data?: string
  exitCode?: number
  message?: string
}

export interface ExposedPort {
  port: number
  exposedAt: string
  name?: string
}

// ============================================================================
// Environment Type
// ============================================================================

export interface SandboxEnv {
  Sandbox: DurableObjectNamespace<CloudflareSandbox>
}

// ============================================================================
// Sandbox Wrapper Class
// ============================================================================

/**
 * Wrapper around Cloudflare Sandbox providing a simplified API
 */
export class DotdoSandbox {
  private sandbox: DurableObjectStub<CloudflareSandbox>
  private hostname: string

  constructor(sandbox: DurableObjectStub<CloudflareSandbox>, hostname: string) {
    this.sandbox = sandbox
    this.hostname = hostname
  }

  // --------------------------------------------------------------------------
  // Command Execution
  // --------------------------------------------------------------------------

  /**
   * Execute a shell command and return the result
   */
  async exec(command: string): Promise<ExecResult> {
    return this.sandbox.exec(command)
  }

  /**
   * Execute a command with streaming output
   */
  async execStream(command: string): Promise<AsyncIterable<StreamEvent>> {
    const stream = await this.sandbox.execStream(command)
    return parseSSEStream(stream)
  }

  /**
   * Start a background process (e.g., web server)
   */
  async startProcess(command: string): Promise<void> {
    await this.sandbox.startProcess(command)
  }

  // --------------------------------------------------------------------------
  // File Operations
  // --------------------------------------------------------------------------

  /**
   * Write content to a file in the sandbox
   */
  async writeFile(
    path: string,
    content: string,
    options?: { encoding?: 'utf-8' | 'base64' }
  ): Promise<void> {
    await this.sandbox.writeFile(path, content, options)
  }

  /**
   * Read a file from the sandbox
   */
  async readFile(
    path: string,
    options?: { encoding?: 'utf-8' | 'base64' }
  ): Promise<{ content: string }> {
    return this.sandbox.readFile(path, options)
  }

  /**
   * Create a directory (recursive by default)
   */
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.sandbox.mkdir(path, options ?? { recursive: true })
  }

  /**
   * Delete a file
   */
  async deleteFile(path: string): Promise<void> {
    await this.sandbox.deleteFile(path)
  }

  /**
   * Check if a file or directory exists
   * Uses readFile to check existence since exists() is not in the Sandbox API
   */
  async exists(path: string): Promise<{ exists: boolean }> {
    try {
      await this.sandbox.readFile(path)
      return { exists: true }
    } catch {
      return { exists: false }
    }
  }

  /**
   * Rename/move a file
   */
  async renameFile(oldPath: string, newPath: string): Promise<void> {
    await this.sandbox.renameFile(oldPath, newPath)
  }

  // --------------------------------------------------------------------------
  // Code Interpreter
  // --------------------------------------------------------------------------

  /**
   * Create a code execution context for interactive coding
   */
  async createCodeContext(
    options: CodeContextOptions
  ): Promise<{ id: string }> {
    return this.sandbox.createCodeContext(options)
  }

  /**
   * Execute code in a context
   */
  async runCode(
    code: string,
    options?: {
      context?: { id: string; language: string; cwd: string; createdAt: Date; lastUsed: Date }
      language?: 'python' | 'javascript' | 'typescript'
      envVars?: Record<string, string>
      timeout?: number
      signal?: AbortSignal
      onStdout?: (output: { text: string; timestamp: number }) => void | Promise<void>
      onStderr?: (output: { text: string; timestamp: number }) => void | Promise<void>
      onResult?: (result: unknown) => void | Promise<void>
      onError?: (error: { name: string; value: string; traceback: string[]; lineNumber?: number }) => void | Promise<void>
    }
  ): Promise<ExecutionResult> {
    return this.sandbox.runCode(code, options)
  }

  /**
   * List all code contexts
   */
  async listCodeContexts(): Promise<Array<{ id: string; language: string }>> {
    return this.sandbox.listCodeContexts()
  }

  /**
   * Delete a code context
   */
  async deleteCodeContext(contextId: string): Promise<void> {
    await this.sandbox.deleteCodeContext(contextId)
  }

  // --------------------------------------------------------------------------
  // Service Exposure
  // --------------------------------------------------------------------------

  /**
   * Expose a port for external access (preview URLs)
   */
  async exposePort(
    port: number,
    options?: { name?: string }
  ): Promise<ExposedPort> {
    const result = await this.sandbox.exposePort(port, {
      hostname: this.hostname,
      ...options,
    })
    return { port, exposedAt: result.url, name: options?.name }
  }

  /**
   * List all exposed ports
   */
  async getExposedPorts(): Promise<ExposedPort[]> {
    return this.sandbox.getExposedPorts(this.hostname)
  }

  /**
   * Remove port exposure
   */
  async unexposePort(port: number): Promise<void> {
    await this.sandbox.unexposePort(port)
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Destroy the sandbox and release resources
   */
  async destroy(): Promise<void> {
    await this.sandbox.destroy()
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Get or create a sandbox instance by ID
 *
 * @example
 * ```typescript
 * const sandbox = getSandbox(env.Sandbox, "user-123", request.url)
 * const result = await sandbox.exec("python --version")
 * ```
 */
export function getSandbox(
  namespace: DurableObjectNamespace<CloudflareSandbox>,
  sandboxId: string,
  hostname: string,
  config?: SandboxConfig
): DotdoSandbox {
  // Note: config options like sleepAfter are set on the Sandbox DO itself
  // The getSandbox function from @cloudflare/sandbox only takes namespace and id
  const cfSandbox = getCloudfareSandbox(namespace, sandboxId)

  return new DotdoSandbox(cfSandbox, hostname)
}

/**
 * Handle preview URL routing for exposed sandbox services
 *
 * @example
 * ```typescript
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const proxyResponse = await handlePreviewProxy(request, env)
 *     if (proxyResponse) return proxyResponse
 *     // ... handle other routes
 *   }
 * }
 * ```
 */
export async function handlePreviewProxy(
  request: Request,
  env: SandboxEnv
): Promise<Response | null> {
  return proxyToSandbox(request, env)
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Execute code in a temporary sandbox and return results
 * Useful for one-off code execution without managing sandbox lifecycle
 */
export async function executeCode(
  namespace: DurableObjectNamespace<CloudflareSandbox>,
  code: string,
  options: {
    language: 'python' | 'javascript' | 'typescript'
    sandboxId?: string
    hostname?: string
    timeout?: number
  }
): Promise<ExecutionResult> {
  const sandboxId = options.sandboxId ?? `temp-${crypto.randomUUID()}`
  const hostname = options.hostname ?? 'localhost'
  const sandbox = getSandbox(namespace, sandboxId, hostname)

  try {
    const context = await sandbox.createCodeContext({
      language: options.language,
      timeout: options.timeout ?? 30000,
    })

    return await sandbox.runCode(code, {
      context: context as any, // Context returned has id, language, cwd, createdAt, lastUsed
      language: options.language,
      timeout: options.timeout
    })
  } finally {
    // Cleanup temp sandboxes
    if (!options.sandboxId) {
      await sandbox.destroy()
    }
  }
}

/**
 * Execute a shell command in a temporary sandbox
 */
export async function executeCommand(
  namespace: DurableObjectNamespace<CloudflareSandbox>,
  command: string,
  options?: {
    sandboxId?: string
    hostname?: string
  }
): Promise<ExecResult> {
  const sandboxId = options?.sandboxId ?? `temp-${crypto.randomUUID()}`
  const hostname = options?.hostname ?? 'localhost'
  const sandbox = getSandbox(namespace, sandboxId, hostname)

  try {
    return await sandbox.exec(command)
  } finally {
    if (!options?.sandboxId) {
      await sandbox.destroy()
    }
  }
}

// ============================================================================
// Naming Patterns
// ============================================================================

/**
 * Generate a sandbox ID for per-user persistent sessions
 */
export function userSandboxId(userId: string): string {
  return `user-${userId}`
}

/**
 * Generate a sandbox ID for ephemeral sessions
 */
export function sessionSandboxId(): string {
  return `session-${crypto.randomUUID()}`
}

/**
 * Generate a sandbox ID for idempotent task execution
 */
export function taskSandboxId(taskId: string): string {
  return `task-${taskId}`
}
