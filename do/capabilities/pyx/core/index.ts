/**
 * @dotdo/pyx - Python execution for JavaScript runtimes
 *
 * This is the core module that provides platform-agnostic utilities
 * for Python code execution, AST manipulation, safety checking, and more.
 *
 * For platform-specific implementations (Cloudflare Workers, Node.js, etc.),
 * see the corresponding backend packages.
 */

// Re-export backend interfaces and types
export type {
  ExecResult,
  ExecOptions,
  PyModule,
  Package,
  PythonBackend,
  MethodCall,
} from './backend.js'

export { MockBackend } from './backend.js'

// Re-export AST utilities
export * as ast from './ast/index.js'

// Re-export safety utilities
export * as safety from './safety/index.js'

// Re-export transform utilities
export * as transform from './transform/index.js'

// Re-export package utilities
export * as packages from './packages/index.js'

// Re-export venv utilities
export * as venv from './venv/index.js'

/**
 * Version of the @dotdo/pyx core module
 */
export const VERSION = '0.0.1'
