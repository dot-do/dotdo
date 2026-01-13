/**
 * Config Utility
 *
 * Loads and manages CLI configuration from various sources:
 * - wrangler.toml / wrangler.jsonc
 * - dotdo.config.ts
 * - package.json (dotdo field)
 * - environment variables
 */

import * as fs from 'fs'
import * as path from 'path'
import { createLogger, type Logger } from './logger'

// Re-export types from types/config.ts
export type {
  DotdoConfig,
  DotdoConfigInput,
  SurfaceConfig,
  SurfaceEntry,
  SurfacesConfig,
} from '../../types/config'

// Re-export Logger type for callers
export type { Logger } from './logger'

import type { DotdoConfig, DotdoConfigInput } from '../../types/config'

// ============================================================================
// CLI-specific Configuration Types
// ============================================================================

/**
 * CLI configuration for OAuth and authentication flows
 *
 * Extends the base DotdoConfig with CLI-specific settings for
 * API endpoints, authentication, and vault access.
 */
export interface CLIConfig extends Partial<DotdoConfig> {
  /** Base URL for the API server (default: https://api.org.ai) */
  apiUrl?: string
  /** Base URL for the auth server (default: https://id.org.ai) */
  authUrl?: string
  /** Base URL for the vault server */
  vaultUrl?: string
  /** Current session token */
  sessionToken?: string
  /** Whether to use federated authentication via id.org.ai */
  federateAuth?: boolean
  /** Preferred browser for OAuth flows */
  preferredBrowser?: string
  /** Request timeout in milliseconds */
  timeout?: number
}

/**
 * Default CLI configuration values
 */
export const defaultCLIConfig: CLIConfig = {
  apiUrl: 'https://api.org.ai',
  authUrl: 'https://id.org.ai',
  vaultUrl: 'https://vault.org.ai',
  timeout: 30000,
}

/**
 * Get CLI configuration with defaults
 */
export function getCLIConfig(overrides?: Partial<CLIConfig>): CLIConfig {
  return {
    ...defaultCLIConfig,
    ...overrides,
  }
}

/**
 * Set a CLI configuration value
 * Note: This is a stub for now - in production would persist to file
 */
export function setConfig(key: keyof CLIConfig, value: unknown): void {
  // In a real implementation, this would persist to ~/.org.ai/config.json
  // For now, it's a no-op since config is loaded fresh each time
}

/**
 * Get a CLI configuration value
 */
export function getConfig(): CLIConfig {
  return getCLIConfig()
}

// Default configuration
const defaultConfig: DotdoConfig = {
  port: 4000,
  host: 'localhost',
  srcDir: '.',
  outDir: 'dist',
  entryPoint: 'index.ts',
  compatibilityDate: '2024-01-01',
  compatibilityFlags: ['nodejs_compat'],
  persist: true,
}

/**
 * Find the project root directory
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let dir = startDir

  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir
    }
    dir = path.dirname(dir)
  }

  return startDir
}

/**
 * Load wrangler configuration
 */
function loadWranglerConfig(projectRoot: string, logger?: Logger): Partial<DotdoConfig> {
  const config: Partial<DotdoConfig> = {}

  // Try wrangler.jsonc first
  const jsoncPath = path.join(projectRoot, 'wrangler.jsonc')
  if (fs.existsSync(jsoncPath)) {
    try {
      // Remove comments for JSON parsing
      const content = fs.readFileSync(jsoncPath, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*/g, '')
      const wrangler = JSON.parse(content)
      return extractWranglerConfig(wrangler)
    } catch (error) {
      logger?.debug('Failed to parse config file', {
        file: jsoncPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Try wrangler.toml
  const tomlPath = path.join(projectRoot, 'wrangler.toml')
  if (fs.existsSync(tomlPath)) {
    try {
      // Simple TOML parsing for basic fields
      const content = fs.readFileSync(tomlPath, 'utf-8')
      const lines = content.split('\n')

      for (const line of lines) {
        const match = line.match(/^(\w+)\s*=\s*["']?([^"'\n]+)["']?/)
        if (match) {
          const [, key, value] = match
          if (key === 'name') config.name = value
          if (key === 'main') config.entryPoint = value
          if (key === 'compatibility_date') config.compatibilityDate = value
        }
      }
    } catch (error) {
      logger?.debug('Failed to parse config file', {
        file: tomlPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return config
}

/**
 * Extract dotdo config from wrangler format
 */
function extractWranglerConfig(wrangler: Record<string, unknown>): Partial<DotdoConfig> {
  const config: Partial<DotdoConfig> = {}

  if (wrangler.name) config.name = String(wrangler.name)
  if (wrangler.main) config.entryPoint = String(wrangler.main)
  if (wrangler.compatibility_date) config.compatibilityDate = String(wrangler.compatibility_date)
  if (Array.isArray(wrangler.compatibility_flags)) config.compatibilityFlags = wrangler.compatibility_flags.map(String)

  // Durable Objects
  if (wrangler.durable_objects && typeof wrangler.durable_objects === 'object') {
    const doConfig = wrangler.durable_objects as { bindings?: Array<{ name: string; class_name: string; script_name?: string }> }
    if (Array.isArray(doConfig.bindings)) {
      config.durableObjects = {}
      for (const binding of doConfig.bindings) {
        config.durableObjects[binding.name] = {
          className: binding.class_name,
          scriptName: binding.script_name,
        }
      }
    }
  }

  return config
}

/**
 * Load dotdo.config.ts if present
 */
async function loadDotdoConfig(projectRoot: string, logger?: Logger): Promise<Partial<DotdoConfig>> {
  const configPath = path.join(projectRoot, 'dotdo.config.ts')

  if (!fs.existsSync(configPath)) {
    return {}
  }

  try {
    // Dynamic import for TypeScript config
    const configModule = await import(configPath)
    return configModule.default ?? configModule
  } catch (error) {
    logger?.debug('Failed to parse config file', {
      file: configPath,
      error: error instanceof Error ? error.message : String(error),
    })
    return {}
  }
}

/**
 * Load config from package.json dotdo field
 */
function loadPackageJsonConfig(projectRoot: string, logger?: Logger): Partial<DotdoConfig> {
  const pkgPath = path.join(projectRoot, 'package.json')

  if (!fs.existsSync(pkgPath)) {
    return {}
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    return pkg.dotdo ?? {}
  } catch (error) {
    logger?.debug('Failed to parse config file', {
      file: pkgPath,
      error: error instanceof Error ? error.message : String(error),
    })
    return {}
  }
}

/**
 * Load config from environment variables
 */
function loadEnvConfig(): Partial<DotdoConfig> {
  const config: Partial<DotdoConfig> = {}

  if (process.env.DOTDO_PORT) config.port = parseInt(process.env.DOTDO_PORT, 10)
  if (process.env.DOTDO_HOST) config.host = process.env.DOTDO_HOST
  if (process.env.CLOUDFLARE_ACCOUNT_ID) config.accountId = process.env.CLOUDFLARE_ACCOUNT_ID

  return config
}

/**
 * Load complete configuration from all sources
 *
 * Priority (highest to lowest):
 * 1. Environment variables
 * 2. dotdo.config.ts
 * 3. package.json dotdo field
 * 4. wrangler.toml / wrangler.jsonc
 * 5. Default values
 */
export function loadConfig(projectRoot?: string, logger?: Logger): DotdoConfig {
  const root = projectRoot ?? findProjectRoot()
  const log = logger ?? createLogger('config')

  const wranglerConfig = loadWranglerConfig(root, log)
  const pkgConfig = loadPackageJsonConfig(root, log)
  const envConfig = loadEnvConfig()

  // Note: dotdo.config.ts loading is async, so we load it synchronously here
  // For full async support, use loadConfigAsync

  return {
    ...defaultConfig,
    ...wranglerConfig,
    ...pkgConfig,
    ...envConfig,
  }
}

/**
 * Load configuration asynchronously (includes dotdo.config.ts)
 */
export async function loadConfigAsync(projectRoot?: string, logger?: Logger): Promise<DotdoConfig> {
  const root = projectRoot ?? findProjectRoot()
  const log = logger ?? createLogger('config')

  const wranglerConfig = loadWranglerConfig(root, log)
  const pkgConfig = loadPackageJsonConfig(root, log)
  const dotdoConfig = await loadDotdoConfig(root, log)
  const envConfig = loadEnvConfig()

  return {
    ...defaultConfig,
    ...wranglerConfig,
    ...pkgConfig,
    ...dotdoConfig,
    ...envConfig,
  }
}

/**
 * Save configuration to dotdo.config.ts
 */
export function saveConfig(config: Partial<DotdoConfig>, projectRoot?: string): void {
  const root = projectRoot ?? findProjectRoot()
  const configPath = path.join(root, 'dotdo.config.ts')

  const content = `/**
 * dotdo configuration
 * Generated by dotdo CLI
 */

import type { DotdoConfig } from 'dotdo/cli'

export default ${JSON.stringify(config, null, 2)} satisfies DotdoConfig
`

  fs.writeFileSync(configPath, content, 'utf-8')
}

/**
 * Get a specific config value
 */
export function getConfigValue<K extends keyof DotdoConfig>(key: K): DotdoConfig[K] {
  const config = loadConfig()
  return config[key]
}

/**
 * Define configuration for dotdo.config.ts with type safety and defaults
 *
 * @example
 * ```typescript
 * import { defineConfig } from 'dotdo'
 *
 * export default defineConfig({
 *   port: 4000,
 *   surfaces: {
 *     app: './App.tsx',
 *     admin: './Admin.tsx',
 *     site: { shell: './Site.mdx', content: 'site/' },
 *     docs: { shell: './Docs.mdx', content: 'docs/' },
 *     blog: { shell: './Blog.mdx', content: 'blog/' },
 *   },
 * })
 * ```
 */
export function defineConfig(config: DotdoConfigInput): DotdoConfig {
  return {
    ...defaultConfig,
    ...config,
  }
}
