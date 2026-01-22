// rpc.do CLI - Init Command
// Initializes a project with .do/ directory and config.json

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { pull, type PullOptions, type PullResult } from './pull'

/**
 * Available project templates
 */
export const TEMPLATES = ['basic', 'full'] as const
export type Template = (typeof TEMPLATES)[number]

/**
 * Config file structure
 */
export interface DoConfig {
  /** RPC endpoint URL */
  endpoint: string
  /** Enable TypeScript support */
  typescript: boolean
  /** Path to types file */
  typesPath: string
  /** Generate client code (full template) */
  generateClient?: boolean
  /** Watch mode enabled (full template) */
  watchMode?: boolean
}

/**
 * Options for the init command
 */
export interface InitOptions {
  /** RPC endpoint URL */
  endpoint: string
  /** Working directory (default: process.cwd()) */
  cwd?: string | undefined
  /** Skip pulling types from endpoint (default: false) */
  skipPull?: boolean | undefined
  /** Force overwrite existing config */
  force?: boolean | undefined
  /** Project template to use (default: 'basic') */
  template?: Template | undefined
  /** Callback for progress updates */
  onProgress?: ((message: string) => void) | undefined
  /** Custom pull function for dependency injection (testing) */
  pullFn?: ((options: PullOptions) => Promise<PullResult>) | undefined
}

/**
 * Result of the init operation
 */
export interface InitResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Path to config.json (on success) */
  configPath?: string
  /** Path to types file (if pulled) */
  typesPath?: string
  /** Error from pull operation (if failed but init succeeded) */
  pullError?: string
  /** Whether config already exists */
  exists?: boolean
  /** Error message (on failure) */
  error?: string
}

/**
 * Validate endpoint URL
 */
function isValidEndpoint(endpoint: string): boolean {
  if (!endpoint) {
    return false
  }
  try {
    const url = new URL(endpoint)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Normalize endpoint URL by removing trailing slashes
 */
function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '')
}

/**
 * Get config for a template
 */
function getConfigForTemplate(endpoint: string, template: Template): DoConfig {
  const baseConfig: DoConfig = {
    endpoint,
    typescript: true,
    typesPath: '.do/$.d.ts',
  }

  if (template === 'full') {
    return {
      ...baseConfig,
      generateClient: true,
      watchMode: false,
    }
  }

  return baseConfig
}

/**
 * Initialize a new rpc.do project
 *
 * Creates .do/ directory with config.json and optionally pulls types.
 *
 * @example
 * ```typescript
 * const result = await init({
 *   endpoint: 'https://api.example.com',
 *   onProgress: console.log,
 * })
 *
 * if (result.success) {
 *   console.log('Project initialized!')
 * }
 * ```
 */
export async function init(options: InitOptions): Promise<InitResult> {
  const {
    endpoint,
    cwd = process.cwd(),
    skipPull = false,
    force = false,
    template = 'basic',
    onProgress = () => {},
    pullFn = pull,
  } = options

  // Validate endpoint is provided
  if (!endpoint) {
    return {
      success: false,
      error: 'endpoint is required',
    }
  }

  // Validate endpoint is a valid URL
  if (!isValidEndpoint(endpoint)) {
    return {
      success: false,
      error: 'Invalid endpoint URL. Must be a valid http:// or https:// URL.',
    }
  }

  const normalizedEndpoint = normalizeEndpoint(endpoint)
  const doDir = path.join(cwd, '.do')
  const configPath = path.join(doDir, 'config.json')

  // Check if config already exists
  try {
    await fs.stat(configPath)
    // Config exists
    if (!force) {
      return {
        success: false,
        exists: true,
        error: 'Configuration already exists. Use --force to overwrite.',
      }
    }
  } catch {
    // Config does not exist, which is expected
  }

  try {
    // Create .do/ directory
    onProgress('Creating .do/ directory...')
    await fs.mkdir(doDir, { recursive: true })

    // Create config.json
    onProgress('Creating config.json...')
    const config = getConfigForTemplate(normalizedEndpoint, template)
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')

    // Optionally pull types
    let typesPath: string | undefined
    let pullError: string | undefined

    if (!skipPull) {
      onProgress('Pulling types from endpoint...')
      const pullResult = await pullFn({
        endpoint: normalizedEndpoint,
        cwd,
        onProgress,
      })

      if (pullResult.success && pullResult.outPath) {
        typesPath = pullResult.outPath
        onProgress(`Types written to ${path.basename(pullResult.outPath)}`)
      } else if (pullResult.error) {
        pullError = pullResult.error
        onProgress(`Warning: Failed to pull types: ${pullResult.error}`)
      }
    }

    // Success messages
    onProgress('')
    onProgress('Initialized rpc.do project successfully!')
    onProgress('')
    onProgress('Next steps:')
    if (skipPull) {
      onProgress('  rpc.do pull        # Pull types from endpoint')
    }
    onProgress('  rpc.do repl        # Start interactive REPL')
    onProgress('  rpc.do eval <code> # Evaluate code against endpoint')
    onProgress('')

    const result: InitResult = {
      success: true,
      configPath,
    }

    if (typesPath !== undefined) {
      result.typesPath = typesPath
    }

    if (pullError !== undefined) {
      result.pullError = pullError
    }

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: message,
    }
  }
}
