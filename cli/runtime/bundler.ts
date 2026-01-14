/**
 * TSX/MDX Compilation Pipeline
 *
 * Compiles TSX and MDX surface files into servable JavaScript.
 *
 * Features:
 * - Compile .tsx/.ts files with React JSX to JavaScript using esbuild
 * - Compile .mdx/.md files using @mdx-js/mdx
 * - Generate source maps for debugging
 * - Handle ES module imports
 * - Watch mode with file change detection
 * - Caching for performance
 */

import { watch as fsWatch, type FSWatcher } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'

// Lazy-loaded esbuild for cold start optimization
// esbuild is a native binary and can be slow to initialize
let esbuildModule: typeof import('esbuild') | null = null

async function getEsbuild(): Promise<typeof import('esbuild')> {
  if (!esbuildModule) {
    esbuildModule = await import('esbuild')
  }
  return esbuildModule
}

/**
 * Result of compiling a file
 */
export interface CompileResult {
  /** The compiled JavaScript code */
  code: string
  /** Optional source map (JSON string) */
  map?: string
}

/**
 * Options for the bundler
 */
export interface BundlerOptions {
  /** Enable watch mode for file change detection */
  watch?: boolean
  /** Generate source maps */
  sourceMaps?: boolean
}

/**
 * A watcher that can be closed
 */
export interface Watcher {
  /** Stop watching for changes */
  close(): void
}

/**
 * Bundler instance with caching and watch support
 */
export interface Bundler {
  /** Compile a file (uses cache if available) */
  compile(filePath: string): Promise<CompileResult>
  /** Clear the compilation cache */
  clearCache(): void
  /** Watch a file for changes */
  watch(filePath: string, onChange: (result: CompileResult) => void): Watcher
}

/**
 * Cache entry with mtime tracking
 */
interface CacheEntry {
  result: CompileResult
  mtime: number
}

/**
 * Compile a TypeScript/TSX file using esbuild
 */
async function compileTsx(filePath: string, sourceMaps: boolean): Promise<CompileResult> {
  const { transform } = await getEsbuild()

  // Read the source file
  const source = await readFile(filePath, 'utf-8')

  // Determine loader based on extension
  const ext = extname(filePath).toLowerCase()
  const loader = ext === '.tsx' ? 'tsx' : 'ts'

  // Use esbuild transform for TSX/TS compilation
  const result = await transform(source, {
    loader,
    jsx: 'automatic',
    jsxImportSource: 'react',
    target: 'es2020',
    format: 'esm',
    sourcemap: sourceMaps ? 'external' : false,
    sourcefile: filePath,
  })

  return {
    code: result.code,
    map: result.map || undefined,
  }
}

/**
 * Compile an MDX file using @mdx-js/mdx
 */
async function compileMdx(filePath: string, sourceMaps: boolean): Promise<CompileResult> {
  const { transform } = await getEsbuild()

  // Dynamic import @mdx-js/mdx
  const { compile } = await import('@mdx-js/mdx')

  // Read the file content
  const content = await readFile(filePath, 'utf-8')

  // Compile MDX to JSX
  const compiled = await compile(content, {
    jsx: true,
    jsxImportSource: 'react',
    development: false,
    // Enable source maps if requested
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SourceMapGenerator: sourceMaps ? (await import('source-map')).SourceMapGenerator as any : undefined,
  })

  const jsxCode = String(compiled)

  // Transform the JSX output to JavaScript using esbuild
  const transformed = await transform(jsxCode, {
    loader: 'jsx',
    jsx: 'automatic',
    jsxImportSource: 'react',
    target: 'es2020',
    format: 'esm',
    sourcemap: sourceMaps ? 'external' : false,
    sourcefile: filePath,
  })

  // For MDX, combine source maps if both exist
  let map: string | undefined
  if (sourceMaps) {
    if (transformed.map) {
      map = transformed.map
    } else if (compiled.map) {
      map = JSON.stringify(compiled.map)
    }
  }

  return {
    code: transformed.code,
    map,
  }
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Get file modification time
 */
async function getFileMtime(filePath: string): Promise<number> {
  const stats = await stat(filePath)
  return stats.mtimeMs
}

/**
 * Compile a single file to JavaScript.
 *
 * Supports:
 * - .tsx, .ts - TypeScript/React files
 * - .mdx, .md - MDX/Markdown files
 *
 * @param filePath - Absolute path to the file to compile
 * @param options - Compilation options
 * @returns Compiled code and optional source map
 * @throws Error if file type is unsupported or file doesn't exist
 */
export async function compileFile(filePath: string, options?: BundlerOptions): Promise<CompileResult> {
  const sourceMaps = options?.sourceMaps ?? false

  // Check if file exists
  if (!(await fileExists(filePath))) {
    throw new Error(`File not found: ${filePath}`)
  }

  const ext = extname(filePath).toLowerCase()

  switch (ext) {
    case '.tsx':
    case '.ts':
      return compileTsx(filePath, sourceMaps)

    case '.mdx':
    case '.md':
      return compileMdx(filePath, sourceMaps)

    default:
      throw new Error(`Unsupported file type: ${ext}`)
  }
}

/**
 * Create a bundler instance with caching and watch support.
 *
 * The bundler caches compilation results and invalidates the cache
 * when files are modified (based on mtime).
 *
 * @param options - Bundler configuration options
 * @returns Bundler instance
 */
export function createBundler(options?: BundlerOptions): Bundler {
  const sourceMaps = options?.sourceMaps ?? false
  const cache = new Map<string, CacheEntry>()

  return {
    async compile(filePath: string): Promise<CompileResult> {
      // Check cache
      const cached = cache.get(filePath)
      if (cached) {
        // Validate cache by checking mtime
        try {
          const currentMtime = await getFileMtime(filePath)
          if (currentMtime <= cached.mtime) {
            return cached.result
          }
        } catch {
          // File may have been deleted, clear cache entry
          cache.delete(filePath)
        }
      }

      // Compile the file
      const result = await compileFile(filePath, { sourceMaps })

      // Cache the result
      try {
        const mtime = await getFileMtime(filePath)
        cache.set(filePath, { result, mtime })
      } catch {
        // Ignore caching errors
      }

      return result
    },

    clearCache(): void {
      cache.clear()
    },

    watch(filePath: string, onChange: (result: CompileResult) => void): Watcher {
      let watcher: FSWatcher | null = null

      // Use Node's fs.watch for file watching
      try {
        watcher = fsWatch(filePath, async (eventType) => {
          if (eventType === 'change') {
            // Invalidate cache
            cache.delete(filePath)

            try {
              // Recompile and notify
              const result = await compileFile(filePath, { sourceMaps })

              // Update cache
              try {
                const mtime = await getFileMtime(filePath)
                cache.set(filePath, { result, mtime })
              } catch {
                // Ignore caching errors
              }

              onChange(result)
            } catch (error) {
              // Log error but don't crash the watcher
              console.error('Compilation error:', error)
            }
          }
        })
      } catch (error) {
        console.error('Failed to start watcher:', error)
      }

      return {
        close(): void {
          if (watcher) {
            watcher.close()
            watcher = null
          }
        },
      }
    },
  }
}
