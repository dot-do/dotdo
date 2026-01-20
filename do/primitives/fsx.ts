/**
 * fsx - File System Extended Primitive with AI Assistance
 *
 * Provides file system operations that integrate with the WorkflowContext ($) pattern
 * and can leverage AI for intelligent file operations.
 *
 * @packageDocumentation
 */

import type { WorkflowContext } from '../context.js'

// ============================================================================
// AI PROMISE TYPES (inline to avoid cross-package imports)
// ============================================================================

/**
 * Metadata for AI operations
 */
export interface AIMeta {
  model?: string
  temperature?: number
  tokens?: { input: number; output: number }
  cost?: number
  duration?: number
}

/**
 * Enhanced Promise with AI metadata and chainable methods
 */
export interface AIPromise<T> extends Promise<T> {
  readonly $meta: AIMeta
  with(options: Partial<AIMeta>): AIPromise<T>
  pipe<U>(fn: (value: T) => U | Promise<U>): AIPromise<U>
}

/**
 * Create an AIPromise wrapper
 */
function createAIPromise<T>(
  executor: (meta: AIMeta) => Promise<T>,
  initialMeta: AIMeta = {}
): AIPromise<T> {
  const meta: AIMeta = { ...initialMeta }
  const basePromise = executor(meta)
  const aiPromise = basePromise as AIPromise<T>

  Object.defineProperty(aiPromise, '$meta', {
    get: () => meta,
    enumerable: true
  })

  Object.defineProperty(aiPromise, 'with', {
    value: (options: Partial<AIMeta>) => {
      return createAIPromise(executor, { ...meta, ...options })
    },
    enumerable: true
  })

  Object.defineProperty(aiPromise, 'pipe', {
    value: function <U>(fn: (value: T) => U | Promise<U>): AIPromise<U> {
      return createAIPromise<U>(
        async (pipeMeta) => {
          const result = await basePromise
          Object.assign(pipeMeta, meta)
          return await fn(result)
        },
        { ...meta }
      )
    },
    enumerable: true
  })

  return aiPromise
}

/**
 * Create initial meta with optional model (handles exactOptionalPropertyTypes)
 */
function createInitialMeta(model?: string): AIMeta {
  if (model !== undefined) {
    return { model }
  }
  return {}
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * File metadata returned by file operations
 */
export interface FileInfo {
  /** Full path to the file */
  path: string
  /** File name without directory */
  name: string
  /** File extension (without dot) */
  extension: string
  /** File size in bytes */
  size: number
  /** Last modified timestamp */
  modifiedAt: Date
  /** Creation timestamp */
  createdAt: Date
  /** Whether the path is a directory */
  isDirectory: boolean
  /** Whether the path is a file */
  isFile: boolean
  /** Whether the file is readable */
  readable: boolean
  /** Whether the file is writable */
  writable: boolean
}

/**
 * Supported text encodings (Cloudflare Workers compatible)
 */
export type TextEncoding = 'utf-8' | 'utf-16' | 'utf-16le' | 'utf-16be' | 'latin1' | 'ascii'

/**
 * Options for reading files
 */
export interface ReadOptions {
  /** Encoding for text files (default: 'utf-8'). Use null for binary. */
  encoding?: TextEncoding | null
  /** Start reading from this byte offset */
  start?: number
  /** Stop reading at this byte offset */
  end?: number
  /** Maximum bytes to read */
  maxBytes?: number
}

/**
 * Options for writing files
 */
export interface WriteOptions {
  /** Encoding for text files (default: 'utf-8') */
  encoding?: TextEncoding
  /** File mode (permissions) */
  mode?: number
  /** Whether to append to existing file */
  append?: boolean
  /** Create parent directories if they don't exist */
  recursive?: boolean
}

/**
 * Options for listing files/directories
 */
export interface ListOptions {
  /** Include hidden files (starting with .) */
  includeHidden?: boolean
  /** Recursively list subdirectories */
  recursive?: boolean
  /** Maximum depth for recursive listing */
  maxDepth?: number
  /** File extension filter (e.g., '.ts', '.json') */
  extension?: string | string[]
  /** Glob pattern filter */
  pattern?: string
}

/**
 * Options for copy/move operations
 */
export interface CopyMoveOptions {
  /** Overwrite existing files */
  overwrite?: boolean
  /** Create parent directories if needed */
  recursive?: boolean
  /** Preserve file timestamps */
  preserveTimestamps?: boolean
}

/**
 * Result of an AI-assisted file operation
 */
export interface AIFileResult<T> {
  /** The operation result */
  result: T
  /** AI explanation of what was done */
  explanation?: string
  /** Confidence score (0-1) for AI decisions */
  confidence?: number
  /** Files that were affected */
  affectedFiles?: string[]
}

/**
 * Options for AI-assisted operations
 */
export interface AIOptions {
  /** AI model to use */
  model?: string
  /** Custom prompt for AI guidance */
  prompt?: string
  /** Whether to require confirmation before changes */
  confirm?: boolean
  /** Maximum files to process */
  maxFiles?: number
}

// ============================================================================
// FSX CLASS
// ============================================================================

/**
 * Extended File System primitive that integrates with WorkflowContext
 *
 * @example
 * ```typescript
 * const fsx = createFSX($)
 *
 * // Read a file
 * const content = await fsx.read('/path/to/file.txt')
 *
 * // Write a file with event emission
 * await fsx.write('/path/to/output.json', { data: 'value' })
 *
 * // AI-assisted file search
 * const files = await fsx.findSimilar('/path/to/example.ts')
 *
 * // AI-assisted content transformation
 * const transformed = await fsx.transform('/path/to/file.md', 'Convert to JSON format')
 * ```
 */
export class FSX {
  private $: WorkflowContext

  constructor(context: WorkflowContext) {
    this.$ = context
  }

  // ==========================================================================
  // CORE FILE OPERATIONS
  // ==========================================================================

  /**
   * Read a file's contents
   *
   * @param path - Path to the file
   * @param options - Read options
   * @returns File contents as string or Uint8Array (for binary)
   *
   * @example
   * ```typescript
   * const content = await fsx.read('config.json')
   * const binary = await fsx.read('image.png', { encoding: null })
   * ```
   */
  async read(path: string, options?: ReadOptions): Promise<string | Uint8Array> {
    const encoding = options?.encoding ?? 'utf-8'

    // Emit event for tracking
    this.$.send({
      type: 'File.read',
      payload: { path, options }
    })

    // Use durable execution for file operations
    return this.$.do(async () => {
      // In a real implementation, this would use R2, KV, or another storage API
      // For Cloudflare Workers, this would use R2 or KV
      const response = await fetch(`file://${path}`)
      if (encoding) {
        return await response.text()
      } else {
        return new Uint8Array(await response.arrayBuffer())
      }
    })
  }

  /**
   * Read a file and parse as JSON
   *
   * @param path - Path to the JSON file
   * @returns Parsed JSON object
   *
   * @example
   * ```typescript
   * const config = await fsx.readJson<Config>('config.json')
   * ```
   */
  async readJson<T = unknown>(path: string): Promise<T> {
    const content = await this.read(path, { encoding: 'utf-8' })
    return JSON.parse(content as string) as T
  }

  /**
   * Write content to a file
   *
   * @param path - Path to write to
   * @param content - Content to write (string, Uint8Array, or object to be JSON-serialized)
   * @param options - Write options
   *
   * @example
   * ```typescript
   * await fsx.write('output.txt', 'Hello, World!')
   * await fsx.write('data.json', { key: 'value' })
   * ```
   */
  async write(
    path: string,
    content: string | Uint8Array | ArrayBuffer | object,
    options?: WriteOptions
  ): Promise<void> {
    const isArrayBuffer = content instanceof ArrayBuffer
    const isUint8Array = content instanceof Uint8Array
    const data = typeof content === 'object' && !isArrayBuffer && !isUint8Array
      ? JSON.stringify(content, null, 2)
      : content

    const size = typeof data === 'string'
      ? data.length
      : isUint8Array
        ? (data as Uint8Array).length
        : isArrayBuffer
          ? (data as ArrayBuffer).byteLength
          : 0

    // Emit event for tracking
    this.$.send({
      type: 'File.write',
      payload: { path, size, options }
    })

    return this.$.do(async () => {
      // Implementation would use R2, KV, or another storage API
      // This is a placeholder for the interface
      console.log(`[fsx.write] ${path} (${size} bytes)`)
    })
  }

  /**
   * Append content to a file
   *
   * @param path - Path to append to
   * @param content - Content to append
   *
   * @example
   * ```typescript
   * await fsx.append('log.txt', 'New log entry\n')
   * ```
   */
  async append(path: string, content: string | Uint8Array): Promise<void> {
    return this.write(path, content, { append: true })
  }

  /**
   * Delete a file or directory
   *
   * @param path - Path to delete
   * @param options - Delete options
   *
   * @example
   * ```typescript
   * await fsx.delete('temp.txt')
   * await fsx.delete('temp-dir', { recursive: true })
   * ```
   */
  async delete(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.$.send({
      type: 'File.delete',
      payload: { path, options }
    })

    return this.$.do(async () => {
      console.log(`[fsx.delete] ${path}`)
    })
  }

  /**
   * Check if a path exists
   *
   * @param path - Path to check
   * @returns Whether the path exists
   *
   * @example
   * ```typescript
   * if (await fsx.exists('config.json')) {
   *   // File exists
   * }
   * ```
   */
  async exists(path: string): Promise<boolean> {
    return this.$.try(async () => {
      // Implementation would check actual filesystem
      return false
    })
  }

  /**
   * Get file/directory information
   *
   * @param path - Path to get info for
   * @returns File information
   *
   * @example
   * ```typescript
   * const info = await fsx.stat('file.txt')
   * console.log(`Size: ${info.size} bytes`)
   * ```
   */
  async stat(path: string): Promise<FileInfo> {
    return this.$.try(async () => {
      // Implementation would use actual fs.stat
      return {
        path,
        name: path.split('/').pop() ?? '',
        extension: path.split('.').pop() ?? '',
        size: 0,
        modifiedAt: new Date(),
        createdAt: new Date(),
        isDirectory: false,
        isFile: true,
        readable: true,
        writable: true
      }
    })
  }

  /**
   * List files in a directory
   *
   * @param path - Directory path
   * @param options - List options
   * @returns Array of file paths or FileInfo objects
   *
   * @example
   * ```typescript
   * const files = await fsx.list('./src')
   * const tsFiles = await fsx.list('./src', { extension: '.ts', recursive: true })
   * ```
   */
  async list(path: string, options?: ListOptions): Promise<string[]> {
    this.$.send({
      type: 'File.list',
      payload: { path, options }
    })

    return this.$.try(async () => {
      // Implementation would list actual directory
      return []
    })
  }

  /**
   * Copy a file or directory
   *
   * @param source - Source path
   * @param destination - Destination path
   * @param options - Copy options
   *
   * @example
   * ```typescript
   * await fsx.copy('source.txt', 'backup.txt')
   * await fsx.copy('./src', './dist', { recursive: true })
   * ```
   */
  async copy(source: string, destination: string, options?: CopyMoveOptions): Promise<void> {
    this.$.send({
      type: 'File.copy',
      payload: { source, destination, options }
    })

    return this.$.do(async () => {
      console.log(`[fsx.copy] ${source} -> ${destination}`)
    })
  }

  /**
   * Move/rename a file or directory
   *
   * @param source - Source path
   * @param destination - Destination path
   * @param options - Move options
   *
   * @example
   * ```typescript
   * await fsx.move('old.txt', 'new.txt')
   * ```
   */
  async move(source: string, destination: string, options?: CopyMoveOptions): Promise<void> {
    this.$.send({
      type: 'File.move',
      payload: { source, destination, options }
    })

    return this.$.do(async () => {
      console.log(`[fsx.move] ${source} -> ${destination}`)
    })
  }

  /**
   * Create a directory
   *
   * @param path - Directory path
   * @param options - Create options
   *
   * @example
   * ```typescript
   * await fsx.mkdir('./nested/deep/dir', { recursive: true })
   * ```
   */
  async mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void> {
    this.$.send({
      type: 'File.mkdir',
      payload: { path, options }
    })

    return this.$.do(async () => {
      console.log(`[fsx.mkdir] ${path}`)
    })
  }

  // ==========================================================================
  // AI-ASSISTED OPERATIONS
  // ==========================================================================

  /**
   * Find files similar to a given file using AI analysis
   *
   * @param path - Path to the reference file
   * @param options - AI options
   * @returns Similar files with similarity scores
   *
   * @example
   * ```typescript
   * const similar = await fsx.findSimilar('utils/helpers.ts')
   * // Returns files with similar structure/purpose
   * ```
   */
  findSimilar(
    path: string,
    options?: AIOptions & { directory?: string }
  ): AIPromise<AIFileResult<Array<{ path: string; score: number }>>> {
    this.$.send({
      type: 'File.findSimilar',
      payload: { path, options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // AI would analyze file content and find similar files
      return {
        result: [],
        explanation: `Finding files similar to ${path}`,
        confidence: 0.8,
        affectedFiles: []
      }
    }, createInitialMeta(options?.model))
  }

  /**
   * Transform file content using AI
   *
   * @param path - Path to the file to transform
   * @param instruction - What transformation to apply
   * @param options - AI options
   * @returns Transformed content
   *
   * @example
   * ```typescript
   * const json = await fsx.transform('data.csv', 'Convert CSV to JSON')
   * const summary = await fsx.transform('report.md', 'Summarize the key points')
   * ```
   */
  transform(
    path: string,
    instruction: string,
    options?: AIOptions
  ): AIPromise<AIFileResult<string>> {
    this.$.send({
      type: 'File.transform',
      payload: { path, instruction, options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // Read file content
      const content = await this.read(path)

      // AI would transform the content based on instruction
      return {
        result: content as string,
        explanation: `Transformed ${path}: ${instruction}`,
        confidence: 0.9,
        affectedFiles: [path]
      }
    }, createInitialMeta(options?.model))
  }

  /**
   * Generate file content using AI
   *
   * @param path - Path where the file will be created
   * @param description - Description of what to generate
   * @param options - AI options
   * @returns Generated content
   *
   * @example
   * ```typescript
   * const code = await fsx.generate('utils/validator.ts', 'Create an email validator function')
   * ```
   */
  generate(
    path: string,
    description: string,
    options?: AIOptions
  ): AIPromise<AIFileResult<string>> {
    this.$.send({
      type: 'File.generate',
      payload: { path, description, options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // AI would generate content based on description
      return {
        result: '',
        explanation: `Generated ${path}: ${description}`,
        confidence: 0.85,
        affectedFiles: [path]
      }
    }, createInitialMeta(options?.model))
  }

  /**
   * Analyze file content with AI and return insights
   *
   * @param path - Path to the file to analyze
   * @param options - AI options with optional analysis focus
   * @returns Analysis results
   *
   * @example
   * ```typescript
   * const analysis = await fsx.analyze('app.ts', { prompt: 'Find potential bugs' })
   * ```
   */
  analyze(
    path: string,
    options?: AIOptions
  ): AIPromise<AIFileResult<{
    summary: string
    suggestions: string[]
    metrics?: Record<string, number>
  }>> {
    this.$.send({
      type: 'File.analyze',
      payload: { path, options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      return {
        result: {
          summary: `Analysis of ${path}`,
          suggestions: [],
          metrics: {}
        },
        explanation: `Analyzed ${path}`,
        confidence: 0.9,
        affectedFiles: [path]
      }
    }, createInitialMeta(options?.model))
  }

  /**
   * Organize files in a directory using AI-suggested structure
   *
   * @param directory - Directory to organize
   * @param options - AI options with organization preferences
   * @returns Organization plan and results
   *
   * @example
   * ```typescript
   * const plan = await fsx.organize('./downloads', { confirm: true })
   * ```
   */
  organize(
    directory: string,
    options?: AIOptions & { dryRun?: boolean }
  ): AIPromise<AIFileResult<{
    moves: Array<{ from: string; to: string }>
    newDirectories: string[]
  }>> {
    this.$.send({
      type: 'File.organize',
      payload: { directory, options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      return {
        result: {
          moves: [],
          newDirectories: []
        },
        explanation: `Organizing ${directory}`,
        confidence: 0.75,
        affectedFiles: []
      }
    }, createInitialMeta(options?.model))
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an FSX instance bound to a WorkflowContext
 *
 * @param context - The WorkflowContext ($) to bind to
 * @returns FSX instance
 *
 * @example
 * ```typescript
 * import { createFSX } from '@dotdo/do/primitives/fsx'
 *
 * // In a DO method
 * const fsx = createFSX($)
 * await fsx.read('config.json')
 * ```
 */
export function createFSX(context: WorkflowContext): FSX {
  return new FSX(context)
}

/**
 * Standalone file operations without WorkflowContext binding
 * Useful for simple operations outside of a workflow
 */
export const fsx = {
  /**
   * Read a file (standalone)
   */
  read: async (path: string, options?: ReadOptions): Promise<string | Uint8Array> => {
    const response = await fetch(`file://${path}`)
    const encoding = options?.encoding ?? 'utf-8'
    if (encoding) {
      return await response.text()
    } else {
      return new Uint8Array(await response.arrayBuffer())
    }
  },

  /**
   * Read JSON file (standalone)
   */
  readJson: async <T = unknown>(path: string): Promise<T> => {
    const content = await fsx.read(path)
    return JSON.parse(content as string)
  },

  /**
   * Check if file exists (standalone)
   */
  exists: async (path: string): Promise<boolean> => {
    try {
      const response = await fetch(`file://${path}`, { method: 'HEAD' })
      return response.ok
    } catch {
      return false
    }
  }
}
