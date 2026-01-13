/**
 * Miniflare Code Sandbox
 *
 * This module provides code execution in an isolated sandbox.
 * Supports JavaScript, TypeScript, JSX, TSX, and MDX execution.
 *
 * @see cli/tests/sandbox.test.ts for test specifications
 */

import * as esbuild from 'esbuild'
import * as vm from 'node:vm'

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
// Constants
// ============================================================================

const DEFAULT_TIMEOUT = 5000

// ============================================================================
// File Type Detection
// ============================================================================

/**
 * Detect file type from file path extension
 */
export function detectFileType(filePath: string): FileType {
  const ext = filePath.split('.').pop()?.toLowerCase()

  switch (ext) {
    case 'ts':
      return 'ts'
    case 'tsx':
      return 'tsx'
    case 'jsx':
      return 'jsx'
    case 'js':
      return 'js'
    case 'mdx':
      return 'mdx'
    case 'md':
      return 'md'
    default:
      return 'ts' // Default to TypeScript
  }
}

// ============================================================================
// Code Transformation
// ============================================================================

/**
 * Transform code from TypeScript/JSX/TSX to JavaScript
 * Uses Bun.Transpiler when available, falls back to esbuild
 */
export async function transformCode(
  code: string,
  fileType: FileType
): Promise<string> {
  // JavaScript and Markdown pass through unchanged
  if (fileType === 'js') {
    return code
  }

  if (fileType === 'md') {
    return code
  }

  // MDX needs special handling - pass through for now
  if (fileType === 'mdx') {
    return code
  }

  // Map file type to loader
  const loaderMap: Record<string, 'ts' | 'tsx' | 'jsx'> = {
    ts: 'ts',
    tsx: 'tsx',
    jsx: 'jsx',
  }

  const loader = loaderMap[fileType]
  if (!loader) {
    return code
  }

  // Try Bun.Transpiler first (when running in Bun runtime)
  if (typeof globalThis.Bun !== 'undefined') {
    try {
      const transpiler = new Bun.Transpiler({
        loader,
        tsconfig: {
          compilerOptions: {
            jsx: 'react-jsx',
            jsxImportSource: 'react',
          },
        },
      })

      return transpiler.transformSync(code)
    } catch (error) {
      // Fall through to esbuild
    }
  }

  // Fall back to esbuild (works in Node.js)
  try {
    const result = await esbuild.transform(code, {
      loader,
      jsx: 'transform',
      jsxFactory: 'jsx',
      jsxFragment: 'Fragment',
      // Use iife format to avoid export/import statements
      // that would fail in a Function() context
      format: 'cjs',
      target: 'esnext',
    })

    // Strip CommonJS wrapper - we just want the plain transformed code
    let transformed = result.code
    // Remove 'use strict' if present
    transformed = transformed.replace(/^"use strict";\n?/, '')

    return transformed
  } catch (error) {
    // Rethrow transform errors to be caught by runInSandbox
    throw error
  }
}

// ============================================================================
// MDX Parsing
// ============================================================================

interface MDXParseResult {
  frontmatter?: Record<string, unknown>
  codeBlocks?: Array<{
    language: string
    code: string
  }>
  components?: string[]
  content: string
}

/**
 * Parse MDX content - extract frontmatter, code blocks, and components
 */
function parseMDX(mdx: string): MDXParseResult {
  const result: MDXParseResult = {
    content: mdx,
  }

  // Parse frontmatter (YAML between --- markers)
  const frontmatterMatch = mdx.match(/^---\n([\s\S]*?)\n---/)
  if (frontmatterMatch) {
    const yamlContent = frontmatterMatch[1]
    result.frontmatter = parseYaml(yamlContent)
    result.content = mdx.slice(frontmatterMatch[0].length).trim()
  }

  // Extract code blocks
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g
  const codeBlocks: Array<{ language: string; code: string }> = []
  let match

  while ((match = codeBlockRegex.exec(mdx)) !== null) {
    codeBlocks.push({
      language: match[1] || 'text',
      code: match[2].trim(),
    })
  }

  if (codeBlocks.length > 0) {
    result.codeBlocks = codeBlocks
  }

  // Extract JSX components (simple regex for component tags)
  const componentRegex = /<([A-Z][a-zA-Z0-9]*)[^>]*>/g
  const components = new Set<string>()

  while ((match = componentRegex.exec(mdx)) !== null) {
    components.add(match[1])
  }

  if (components.size > 0) {
    result.components = Array.from(components)
  }

  return result
}

/**
 * Simple YAML parser for frontmatter
 * Handles basic key-value pairs, nested objects, and arrays
 */
function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = yaml.split('\n')

  let currentKey: string | null = null
  let currentIndent = 0
  let arrayItems: unknown[] = []
  let inArray = false
  let objectStack: Array<{ obj: Record<string, unknown>; key: string; indent: number }> = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const indent = line.search(/\S/)

    // Handle array items
    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim()
      if (currentKey && indent > currentIndent) {
        if (!inArray) {
          arrayItems = []
          inArray = true
        }
        arrayItems.push(parseYamlValue(value))
        result[currentKey] = arrayItems
      }
      continue
    }

    // Reset array state when we hit a non-array line
    if (inArray && indent <= currentIndent) {
      inArray = false
      arrayItems = []
    }

    // Handle key: value pairs
    const colonIndex = trimmed.indexOf(':')
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim()
      const value = trimmed.slice(colonIndex + 1).trim()

      // Check if this starts a nested object
      if (value === '') {
        // This key has nested content
        if (indent > currentIndent && currentKey) {
          // Nested object
          if (!result[currentKey]) {
            result[currentKey] = {}
          }
          const parentObj = result[currentKey] as Record<string, unknown>
          objectStack.push({ obj: result, key: currentKey, indent: currentIndent })
          currentKey = key
          currentIndent = indent
          result[currentKey] = {}
        } else {
          // Top-level nested object
          currentKey = key
          currentIndent = indent
          result[key] = {}
        }
      } else {
        // Simple key-value
        if (indent > currentIndent && currentKey && typeof result[currentKey] === 'object') {
          // Add to nested object
          (result[currentKey] as Record<string, unknown>)[key] = parseYamlValue(value)
        } else {
          currentKey = key
          currentIndent = indent
          result[key] = parseYamlValue(value)
        }
      }
    }
  }

  return result
}

/**
 * Parse a YAML value string into the appropriate type
 */
function parseYamlValue(value: string): unknown {
  // Remove quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }

  // Boolean
  if (value === 'true') return true
  if (value === 'false') return false

  // Number
  const num = Number(value)
  if (!isNaN(num) && value !== '') return num

  // Null
  if (value === 'null' || value === '~') return null

  return value
}

// ============================================================================
// JSX Runtime (simple implementation for sandbox)
// ============================================================================

interface JSXElement {
  type: string | Function
  props: Record<string, unknown> & { children?: unknown }
}

function jsxRuntime(type: string | Function, props: Record<string, unknown>, ...children: unknown[]): JSXElement {
  const finalChildren = children.length === 0 ? props?.children
    : children.length === 1 ? children[0]
    : children

  return {
    type,
    props: {
      ...props,
      children: finalChildren,
    },
  }
}

function Fragment(props: { children?: unknown }): JSXElement {
  return {
    type: Fragment,
    props: { children: props.children },
  }
}

// ============================================================================
// Sandbox Execution
// ============================================================================

/**
 * Execute code in a sandboxed environment
 */
export async function runInSandbox(
  code: string,
  fileType: FileType = 'ts',
  config?: SandboxConfig
): Promise<SandboxResult> {
  const startTime = performance.now()
  const logs: SandboxResult['logs'] = []
  const timeout = config?.timeout ?? DEFAULT_TIMEOUT

  // Handle empty input
  if (!code || !code.trim()) {
    return {
      success: true,
      value: undefined,
      logs: [],
      executionTime: performance.now() - startTime,
    }
  }

  // Handle MDX specially
  if (fileType === 'mdx' || fileType === 'md') {
    try {
      const parsed = parseMDX(code)
      return {
        success: true,
        value: parsed,
        logs: [],
        executionTime: performance.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        logs: [],
        executionTime: performance.now() - startTime,
      }
    }
  }

  // Transform code to JavaScript
  let jsCode: string
  try {
    jsCode = await transformCode(code, fileType)
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      logs: [],
      executionTime: performance.now() - startTime,
    }
  }

  // Create sandboxed console
  // Use the real WeakSet from the outer scope, not the sandbox's
  const createConsoleMethod = (level: 'log' | 'error' | 'warn' | 'info' | 'debug') => {
    return (...args: unknown[]) => {
      logs.push({ level, args: args.map((arg) => cloneValue(arg, new WeakSet())) })
    }
  }

  const sandboxConsole = {
    log: createConsoleMethod('log'),
    error: createConsoleMethod('error'),
    warn: createConsoleMethod('warn'),
    info: createConsoleMethod('info'),
    debug: createConsoleMethod('debug'),
  }

  // Create sandbox globals (limited set)
  const sandboxGlobals: Record<string, unknown> = {
    console: sandboxConsole,
    // Basic globals
    undefined: undefined,
    NaN: NaN,
    Infinity: Infinity,
    // Built-in constructors
    Array,
    Object,
    String,
    Number,
    Boolean,
    Date,
    RegExp,
    Error,
    TypeError,
    ReferenceError,
    SyntaxError,
    RangeError,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Symbol,
    BigInt,
    JSON,
    Math,
    // Timer functions
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    // JSX runtime
    jsx: jsxRuntime,
    jsxs: jsxRuntime,
    jsxDEV: jsxRuntime,
    Fragment,
    // For JSX transformation compatibility
    React: {
      createElement: jsxRuntime,
      Fragment,
    },
    // Block access to Node.js/Bun globals
    process: undefined,
    require: undefined,
    module: undefined,
    exports: undefined,
    __dirname: undefined,
    __filename: undefined,
    Buffer: undefined,
    // Also block Bun globals
    Bun: undefined,
  }

  // Create a limited globalThis
  const sandboxGlobalThis: Record<string, unknown> = { ...sandboxGlobals }
  sandboxGlobals.globalThis = sandboxGlobalThis

  // Wrap code in async function to support await and return
  const wrappedCode = `
    (async () => {
      ${jsCode}
    })();
  `

  try {
    // Create VM context with sandbox globals
    const context = vm.createContext(sandboxGlobals)

    // Compile and run the script with timeout
    const script = new vm.Script(wrappedCode, {
      filename: 'sandbox.js',
    })

    // Execute with timeout (synchronous timeout supported by VM)
    const resultPromise = script.runInContext(context, {
      timeout: timeout,
    }) as Promise<unknown>

    // For async code, we also need to wait for the promise to resolve
    // but with a timeout for the async part too
    let result: unknown

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Execution timeout exceeded'))
      }, timeout)
    })

    try {
      result = await Promise.race([resultPromise, timeoutPromise])
    } catch (error) {
      if (error instanceof Error && error.message === 'Execution timeout exceeded') {
        return {
          success: false,
          error: 'Execution timeout exceeded',
          logs,
          executionTime: performance.now() - startTime,
        }
      }
      throw error
    }

    return {
      success: true,
      value: cloneValue(result),
      logs,
      executionTime: performance.now() - startTime,
    }
  } catch (error) {
    // VM timeout errors have a specific message
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (errorMessage.includes('timed out') || errorMessage.includes('Script execution timed out')) {
      return {
        success: false,
        error: 'Execution timeout exceeded',
        logs,
        executionTime: performance.now() - startTime,
      }
    }

    return {
      success: false,
      error: errorMessage,
      logs,
      executionTime: performance.now() - startTime,
    }
  }
}

/**
 * Clone a value for safe serialization (handles circular refs and special values)
 */
function cloneValue(value: unknown, seen = new WeakSet<object>()): unknown {
  // Handle primitives
  if (value === null || value === undefined) return value
  if (typeof value === 'number') return value
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value
  if (typeof value === 'symbol') return value
  if (typeof value === 'function') return value

  // Handle objects
  if (typeof value === 'object') {
    // Check for circular reference
    if (seen.has(value)) {
      return '[Circular]'
    }
    seen.add(value)

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map(item => cloneValue(item, seen))
    }

    // Handle plain objects
    const cloned: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      cloned[key] = cloneValue((value as Record<string, unknown>)[key], seen)
    }
    return cloned
  }

  return value
}

// ============================================================================
// Sandbox Factory
// ============================================================================

/**
 * Create a reusable sandbox instance
 */
export async function createSandbox(config?: SandboxConfig): Promise<Sandbox> {
  let disposed = false

  return {
    async run(code: string, fileType: FileType = 'ts'): Promise<SandboxResult> {
      if (disposed) {
        throw new Error('Sandbox has been disposed')
      }

      return runInSandbox(code, fileType, config)
    },

    async dispose(): Promise<void> {
      disposed = true
    },
  }
}
