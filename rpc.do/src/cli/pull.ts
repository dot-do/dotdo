// rpc.do CLI - Pull Command
// Fetches TypeScript types from an RPC endpoint and writes to local file

import { promises as fs } from 'node:fs'
import * as path from 'node:path'

/**
 * Options for the pull command
 */
export interface PullOptions {
  /** The RPC endpoint URL */
  endpoint: string
  /** Custom output path (default: .do/$.d.ts relative to cwd) */
  outPath?: string | undefined
  /** Working directory (default: process.cwd()) */
  cwd?: string | undefined
  /** Callback for progress updates */
  onProgress?: ((message: string) => void) | undefined
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number | undefined
}

/**
 * Result of the pull operation
 */
export interface PullResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Output path where types were written (on success) */
  outPath?: string
  /** Error message (on failure) */
  error?: string
}

/**
 * Normalize endpoint URL by removing trailing slash
 */
function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '')
}

/**
 * Check if response contains an RPC error
 */
function isRpcError(data: unknown): data is { error: { code: string; message: string } } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as { error: unknown }).error === 'object' &&
    (data as { error: unknown }).error !== null &&
    'message' in ((data as { error: { message: unknown } }).error)
  )
}

/**
 * Pull types from an RPC endpoint
 *
 * Calls the _types() RPC method on the endpoint and writes the
 * TypeScript definitions to a local file.
 *
 * @example
 * ```typescript
 * const result = await pull({
 *   endpoint: 'https://api.example.com',
 *   onProgress: console.log,
 * })
 *
 * if (result.success) {
 *   console.log(`Types written to ${result.outPath}`)
 * } else {
 *   console.error(`Failed: ${result.error}`)
 * }
 * ```
 */
export async function pull(options: PullOptions): Promise<PullResult> {
  const {
    endpoint,
    cwd = process.cwd(),
    timeout = 30000,
    onProgress = () => {},
  } = options

  // Determine output path
  const outPath = options.outPath ?? path.join(cwd, '.do', '$.d.ts')

  // Normalize endpoint URL
  const normalizedEndpoint = normalizeEndpoint(endpoint)
  const rpcUrl = `${normalizedEndpoint}/rpc`

  try {
    // Report progress: fetching
    const url = new URL(normalizedEndpoint)
    onProgress(`Fetching types from ${url.host}...`)

    // Make RPC call to _types endpoint
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ method: '_types', args: [] }),
      signal: AbortSignal.timeout(timeout),
    })

    // Handle HTTP errors
    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    // Parse JSON response
    let data: unknown
    try {
      data = await response.json()
    } catch (parseError) {
      return {
        success: false,
        error: parseError instanceof Error ? parseError.message : 'Failed to parse JSON response',
      }
    }

    // Check for RPC-level errors
    if (isRpcError(data)) {
      return {
        success: false,
        error: data.error.message,
      }
    }

    // Extract types string from response
    const types = typeof data === 'string' ? data : String(data)

    // Ensure output directory exists
    const outDir = path.dirname(outPath)
    await fs.mkdir(outDir, { recursive: true })

    // Report progress: writing
    onProgress(`Writing types to ${path.relative(cwd, outPath) || outPath}...`)

    // Write types to file
    await fs.writeFile(outPath, types, 'utf-8')

    // Report progress: done
    onProgress(`Wrote types to ${path.basename(outPath)}`)

    return {
      success: true,
      outPath,
    }
  } catch (error) {
    // Handle network/fetch errors
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: message,
    }
  }
}
