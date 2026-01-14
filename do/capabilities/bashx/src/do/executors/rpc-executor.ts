/**
 * RpcExecutor Module
 *
 * Tier 2 execution: RPC bindings for external services.
 *
 * This module handles commands that are executed via RPC calls to
 * external services like jq.do, npm.do, git.do.
 *
 * Interface Contract:
 * -------------------
 * RpcExecutor implements the TierExecutor interface:
 * - canExecute(command): Returns true if a service binding exists for the command
 * - execute(command, options): Makes RPC call and returns BashResult
 *
 * Dependency Injection:
 * ---------------------
 * - bindings: Map of service names to RPC endpoints
 * - defaultTimeout: Optional timeout configuration
 *
 * Service Binding Types:
 * ----------------------
 * - HTTP endpoint (string URL): Makes POST to URL/execute
 * - Service binding (object with fetch): Uses Cloudflare service binding
 *
 * @module bashx/do/executors/rpc-executor
 */

import type { BashResult, ExecOptions } from '../../types.js'
import type { TierExecutor, BaseExecutorConfig } from './types.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * RPC endpoint - either a URL string or a service binding with fetch method
 */
export type RpcEndpoint = string | { fetch: typeof fetch }

/**
 * RPC service binding configuration
 */
export interface RpcServiceBinding {
  /** Service name */
  name: string
  /** RPC endpoint URL or service binding */
  endpoint: RpcEndpoint
  /** Commands this service handles */
  commands: string[]
}

/**
 * Configuration for RpcExecutor.
 *
 * @example
 * ```typescript
 * const config: RpcExecutorConfig = {
 *   bindings: {
 *     jq: { name: 'jq', endpoint: 'https://jq.do', commands: ['jq'] },
 *     npm: { name: 'npm', endpoint: env.NPM_SERVICE, commands: ['npm', 'npx'] },
 *   },
 *   defaultTimeout: 30000,
 * }
 * const executor = createRpcExecutor(config)
 * ```
 */
export interface RpcExecutorConfig extends BaseExecutorConfig {
  /**
   * Service bindings by name.
   *
   * If not provided, DEFAULT_RPC_SERVICES will be used.
   * If provided (even empty object), only those bindings are used.
   */
  bindings?: Record<string, RpcServiceBinding>
}

/**
 * RPC request payload
 */
export interface RpcRequestPayload {
  /** Command to execute */
  command: string
  /** Working directory */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Timeout in milliseconds */
  timeout?: number
}

/**
 * RPC response payload
 */
export interface RpcResponsePayload {
  /** Standard output */
  stdout: string
  /** Standard error */
  stderr: string
  /** Exit code */
  exitCode: number
}

// ============================================================================
// RPC RESPONSE VALIDATION
// ============================================================================

/**
 * Error thrown when RPC response validation fails.
 *
 * This error is thrown when the response from an RPC service
 * does not match the expected RpcResponsePayload structure.
 *
 * @example
 * ```typescript
 * try {
 *   const response = parseRpcResponse(data)
 * } catch (error) {
 *   if (error instanceof RpcResponseError) {
 *     console.error('Invalid response:', error.received)
 *   }
 * }
 * ```
 */
export class RpcResponseError extends Error {
  /** The invalid data that was received */
  public readonly received: unknown

  constructor(message: string, received: unknown) {
    super(message)
    this.name = 'RpcResponseError'
    this.received = received
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, RpcResponseError.prototype)
  }
}

/**
 * Type guard to check if a value is a valid RpcResponsePayload.
 *
 * Validates that the value is an object with:
 * - stdout: string
 * - stderr: string
 * - exitCode: number
 *
 * Extra properties are allowed (structural typing).
 *
 * @param value - The value to check
 * @returns true if the value is a valid RpcResponsePayload
 *
 * @example
 * ```typescript
 * const data = await response.json()
 * if (isRpcResponse(data)) {
 *   // data is RpcResponsePayload
 *   console.log(data.stdout)
 * }
 * ```
 */
export function isRpcResponse(value: unknown): value is RpcResponsePayload {
  if (value === null || value === undefined) {
    return false
  }

  if (typeof value !== 'object') {
    return false
  }

  const obj = value as Record<string, unknown>

  if (typeof obj.stdout !== 'string') {
    return false
  }

  if (typeof obj.stderr !== 'string') {
    return false
  }

  if (typeof obj.exitCode !== 'number') {
    return false
  }

  return true
}

/**
 * Parse and validate an RPC response.
 *
 * This function validates that the response matches the expected structure
 * and throws a descriptive error if validation fails.
 *
 * @param value - The value to parse (typically from response.json())
 * @returns The validated RpcResponsePayload
 * @throws {RpcResponseError} If the response is invalid
 *
 * @example
 * ```typescript
 * const data = await response.json()
 * const payload = parseRpcResponse(data)
 * // payload is guaranteed to be RpcResponsePayload
 * ```
 */
export function parseRpcResponse(value: unknown): RpcResponsePayload {
  if (isRpcResponse(value)) {
    return value
  }

  // Build a descriptive error message
  let details = 'Invalid RPC response: '

  if (value === null) {
    details += 'received null'
  } else if (value === undefined) {
    details += 'received undefined'
  } else if (typeof value !== 'object') {
    details += `expected object, received ${typeof value}`
  } else {
    const obj = value as Record<string, unknown>
    const missing: string[] = []
    const wrongType: string[] = []

    if (!('stdout' in obj)) {
      missing.push('stdout')
    } else if (typeof obj.stdout !== 'string') {
      wrongType.push(`stdout (expected string, got ${typeof obj.stdout})`)
    }

    if (!('stderr' in obj)) {
      missing.push('stderr')
    } else if (typeof obj.stderr !== 'string') {
      wrongType.push(`stderr (expected string, got ${typeof obj.stderr})`)
    }

    if (!('exitCode' in obj)) {
      missing.push('exitCode')
    } else if (typeof obj.exitCode !== 'number') {
      wrongType.push(`exitCode (expected number, got ${typeof obj.exitCode})`)
    }

    if (missing.length > 0) {
      details += `missing fields: ${missing.join(', ')}`
    }
    if (wrongType.length > 0) {
      if (missing.length > 0) details += '; '
      details += `wrong types: ${wrongType.join(', ')}`
    }
  }

  throw new RpcResponseError(details, value)
}

// ============================================================================
// DEFAULT SERVICES
// ============================================================================

/**
 * Default RPC services and their configurations
 */
export const DEFAULT_RPC_SERVICES: Record<string, RpcServiceBinding> = {
  jq: {
    name: 'jq',
    endpoint: 'https://jq.do',
    commands: ['jq'],
  },
  npm: {
    name: 'npm',
    endpoint: 'https://npm.do',
    commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
  },
  git: {
    name: 'git',
    endpoint: 'https://git.do',
    commands: ['git'],
  },
  pyx: {
    name: 'pyx',
    endpoint: 'https://pyx.do',
    commands: ['python', 'python3', 'pip', 'pip3', 'pipx', 'uvx', 'pyx'],
  },
  esm: {
    name: 'esm',
    endpoint: 'https://esm.do',
    commands: ['esm'],
  },
}

// ============================================================================
// RPC EXECUTOR CLASS
// ============================================================================

/**
 * RpcExecutor - Execute commands via RPC to external services
 *
 * Provides Tier 2 execution for commands that require specialized
 * external services. Supports both HTTP endpoints and Cloudflare service bindings.
 *
 * Implements the TierExecutor interface for composition with TieredExecutor.
 *
 * @example
 * ```typescript
 * // Create with default services (jq.do, npm.do, git.do)
 * const executor = new RpcExecutor()
 *
 * // Check if command can be handled
 * if (executor.canExecute('git status')) {
 *   const result = await executor.execute('git status')
 * }
 *
 * // Create with custom service bindings
 * const customExecutor = new RpcExecutor({
 *   bindings: {
 *     myService: {
 *       name: 'myService',
 *       endpoint: 'https://my-service.example.com',
 *       commands: ['my-cmd'],
 *     },
 *   },
 * })
 * ```
 *
 * @implements {TierExecutor}
 */
export class RpcExecutor implements TierExecutor {
  private readonly bindings: Record<string, RpcServiceBinding>
  private readonly defaultTimeout: number
  private readonly commandToService: Map<string, string>

  constructor(config: RpcExecutorConfig = {}) {
    this.defaultTimeout = config.defaultTimeout ?? 30000

    // If bindings are explicitly provided, use only those (no defaults)
    // If no bindings provided at all (undefined), use defaults
    if (config.bindings !== undefined) {
      // Explicit bindings provided - use only those, no defaults
      this.bindings = { ...config.bindings }
    } else {
      // No bindings provided, use defaults
      this.bindings = { ...DEFAULT_RPC_SERVICES }
    }

    // Build command to service mapping
    this.commandToService = new Map()
    for (const [serviceName, binding] of Object.entries(this.bindings)) {
      for (const cmd of binding.commands) {
        this.commandToService.set(cmd, serviceName)
      }
    }
  }

  /**
   * Check if a binding exists
   */
  hasBinding(name: string): boolean {
    return name in this.bindings
  }

  /**
   * Get a binding by name
   */
  getBinding(name: string): RpcServiceBinding | undefined {
    return this.bindings[name]
  }

  /**
   * Check if this executor can handle a command
   */
  canExecute(command: string): boolean {
    const cmd = this.extractCommandName(command)
    return this.commandToService.has(cmd)
  }

  /**
   * Get the service name for a command
   */
  getServiceForCommand(command: string): string | null {
    const cmd = this.extractCommandName(command)
    return this.commandToService.get(cmd) ?? null
  }

  /**
   * Get list of available services
   */
  getAvailableServices(): string[] {
    return Object.keys(this.bindings)
  }

  /**
   * Get commands handled by a service
   */
  getCommandsForService(serviceName: string): string[] {
    const binding = this.bindings[serviceName]
    return binding?.commands ?? []
  }

  /**
   * Execute a command via RPC
   */
  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    const serviceName = this.getServiceForCommand(command)

    if (!serviceName) {
      throw new Error(`No RPC service available for command: ${this.extractCommandName(command)}`)
    }

    const binding = this.bindings[serviceName]
    if (!binding) {
      throw new Error(`RPC binding not found: ${serviceName}`)
    }

    try {
      const payload: RpcRequestPayload = {
        command,
        cwd: options?.cwd,
        env: options?.env,
        timeout: options?.timeout ?? this.defaultTimeout,
      }

      const response = await this.makeRpcCall(binding, payload)

      return this.createResult(command, response.stdout, response.stderr, response.exitCode)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Tier 2 RPC execution failed: ${message}`)
    }
  }

  /**
   * Make an RPC call to a service
   */
  private async makeRpcCall(
    binding: RpcServiceBinding,
    payload: RpcRequestPayload
  ): Promise<RpcResponsePayload> {
    const { endpoint } = binding

    if (typeof endpoint === 'string') {
      // HTTP endpoint
      const response = await fetch(`${endpoint}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return {
          stdout: '',
          stderr: `RPC error: ${errorText}`,
          exitCode: 1,
        }
      }

      const data: unknown = await response.json()
      return parseRpcResponse(data)
    } else {
      // Service binding with fetch method
      const response = await endpoint.fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return {
          stdout: '',
          stderr: `RPC error: ${errorText}`,
          exitCode: 1,
        }
      }

      const data: unknown = await response.json()
      return parseRpcResponse(data)
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private extractCommandName(command: string): string {
    const trimmed = command.trim()
    const withoutEnvVars = trimmed.replace(/^(\w+=\S+\s+)+/, '')
    const match = withoutEnvVars.match(/^[\w\-./]+/)
    if (!match) return ''
    return match[0].split('/').pop() || ''
  }

  private createResult(
    command: string,
    stdout: string,
    stderr: string,
    exitCode: number
  ): BashResult {
    return {
      input: command,
      command,
      valid: true,
      generated: false,
      stdout,
      stderr,
      exitCode,
      intent: {
        commands: [this.extractCommandName(command)],
        reads: [],
        writes: [],
        deletes: [],
        network: true,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'none',
        reversible: true,
        reason: 'Tier 2: RPC service execution',
      },
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an RpcExecutor with the given configuration
 */
export function createRpcExecutor(config: RpcExecutorConfig = {}): RpcExecutor {
  return new RpcExecutor(config)
}
