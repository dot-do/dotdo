/**
 * Miniflare Code Sandbox (TDD Stub - Not Yet Implemented)
 *
 * This module provides code execution in an isolated Miniflare sandbox.
 * Currently exports stubs for TDD RED phase testing.
 *
 * @see cli/tests/sandbox.test.ts for test specifications
 */

// ============================================================================
// Type Definitions
// ============================================================================

export type FileType = 'js' | 'ts' | 'jsx' | 'tsx' | 'mdx' | 'md'

export interface SandboxConfig {
  timeout?: number
  memoryLimit?: number
}

export interface SandboxResult {
  success: boolean
  value?: unknown
  error?: string
  logs: Array<{
    level: 'log' | 'error' | 'warn' | 'info' | 'debug'
    args: unknown[]
  }>
  executionTime?: number
}

export interface Sandbox {
  run(code: string, fileType?: FileType): Promise<SandboxResult>
  dispose(): Promise<void>
}

// ============================================================================
// Stub Implementations (RED Phase - Not Yet Implemented)
// ============================================================================

/**
 * Execute code in a Miniflare sandbox
 * @stub Not yet implemented - will fail tests
 */
export async function runInSandbox(
  _code: string,
  _fileType: FileType = 'ts',
  _config?: SandboxConfig
): Promise<SandboxResult> {
  // Stub implementation - returns failure for all tests
  throw new Error('runInSandbox not implemented yet - TDD RED phase')
}

/**
 * Create a reusable sandbox instance
 * @stub Not yet implemented - will fail tests
 */
export async function createSandbox(_config?: SandboxConfig): Promise<Sandbox> {
  // Stub implementation - returns failure for all tests
  throw new Error('createSandbox not implemented yet - TDD RED phase')
}

/**
 * Transform code from TypeScript/JSX/TSX to JavaScript
 * @stub Not yet implemented - will fail tests
 */
export async function transformCode(
  _code: string,
  _fileType: FileType
): Promise<string> {
  // Stub implementation - returns failure for all tests
  throw new Error('transformCode not implemented yet - TDD RED phase')
}

/**
 * Detect file type from file path
 * @stub Not yet implemented - will fail tests
 */
export function detectFileType(_filePath: string): FileType {
  // Stub implementation - returns failure for all tests
  throw new Error('detectFileType not implemented yet - TDD RED phase')
}
