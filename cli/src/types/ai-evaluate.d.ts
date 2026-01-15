/**
 * Type declarations for ai-evaluate module
 *
 * ai-evaluate provides secure code execution in isolated V8 workers.
 * This module will be available from @dotdo/ai-evaluate or ai-evaluate package.
 */

declare module 'ai-evaluate' {
  /**
   * Options for code evaluation
   */
  export interface EvaluateOptions {
    /** JavaScript/TypeScript code to execute */
    script?: string
    /** Module code with exports */
    module?: string
    /** Vitest-style test code */
    tests?: string
    /** Environment variables */
    env?: Record<string, string>
    /** Execution timeout in ms (default: 5000) */
    timeout?: number
    /** SDK configuration for $ context */
    sdk?: { rpcUrl: string } | { context: string }
    /** Custom fetch implementation (null to block network) */
    fetch?: typeof fetch | null
  }

  /**
   * Log entry from console output
   */
  export interface LogEntry {
    /** Log level (log, error, warn, info, debug) */
    level: string
    /** Log message or stringified arguments */
    message: string
    /** Original arguments passed to console method */
    args?: unknown[]
  }

  /**
   * Test result details
   */
  export interface TestDetails {
    /** Test name */
    name: string
    /** Whether test passed */
    passed: boolean
    /** Error message if failed */
    error?: string
  }

  /**
   * Test execution results
   */
  export interface TestResults {
    /** Number of passing tests */
    passed: number
    /** Number of failing tests */
    failed: number
    /** Total number of tests */
    total: number
    /** Details for each test */
    details: TestDetails[]
  }

  /**
   * Result of code evaluation
   */
  export interface EvaluateResult {
    /** Whether execution succeeded */
    success: boolean
    /** Return value on success */
    value?: unknown
    /** Error message on failure */
    error?: string
    /** Console output captured during execution */
    logs: LogEntry[]
    /** Test results if tests were provided */
    testResults?: TestResults
    /** Execution duration in ms */
    duration: number
  }

  /**
   * Evaluate code in a secure isolated V8 worker.
   *
   * Features:
   * - Runs in isolated V8 workers (no filesystem access)
   * - Network blocked by default
   * - Memory and CPU limits enforced
   * - Timeout enforcement
   * - Supports module exports and vitest-style tests
   * - Optional SDK globals ($, db, ai) for dotdo integration
   *
   * @param options - Evaluation options
   * @returns Promise resolving to evaluation result
   *
   * @example
   * // Simple script execution
   * const result = await evaluate({ script: 'return 1 + 1' })
   * console.log(result.value) // 2
   *
   * @example
   * // With SDK context
   * const result = await evaluate({
   *   script: 'await $.send({ type: "UserCreated", user: { name: "Alice" } })',
   *   sdk: { rpcUrl: 'wss://acme.api.dotdo.dev' }
   * })
   *
   * @example
   * // Running tests
   * const result = await evaluate({
   *   module: 'exports.add = (a, b) => a + b',
   *   tests: 'test("add", () => expect(add(1, 2)).toBe(3))'
   * })
   */
  export function evaluate(options: EvaluateOptions): Promise<EvaluateResult>
}
