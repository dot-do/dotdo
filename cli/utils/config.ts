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

export interface DotdoConfig {
  // Project settings
  name?: string
  entryPoint?: string
  srcDir?: string
  outDir?: string

  // Development
  port?: number
  host?: string
  persist?: boolean | string

  // Cloudflare settings
  compatibilityDate?: string
  compatibilityFlags?: string[]
  accountId?: string

  // Durable Objects
  durableObjects?: Record<string, {
    className: string
    scriptName?: string
  }>

  // Bindings
  d1Databases?: Record<string, string>
  r2Buckets?: string[]
  kvNamespaces?: string[]

  // Deploy targets
  deploy?: {
    cloudflare?: boolean
    vercel?: boolean
    fly?: boolean
  }

  // Tunnel settings
  tunnel?: {
    name?: string
    configPath?: string
  }
}

// Default configuration
const defaultConfig: DotdoConfig = {
  port: 8787,
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
function loadWranglerConfig(projectRoot: string): Partial<DotdoConfig> {
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
    } catch {
      // Ignore parse errors
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
    } catch {
      // Ignore parse errors
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
async function loadDotdoConfig(projectRoot: string): Promise<Partial<DotdoConfig>> {
  const configPath = path.join(projectRoot, 'dotdo.config.ts')

  if (!fs.existsSync(configPath)) {
    return {}
  }

  try {
    // Dynamic import for TypeScript config
    const configModule = await import(configPath)
    return configModule.default ?? configModule
  } catch {
    return {}
  }
}

/**
 * Load config from package.json dotdo field
 */
function loadPackageJsonConfig(projectRoot: string): Partial<DotdoConfig> {
  const pkgPath = path.join(projectRoot, 'package.json')

  if (!fs.existsSync(pkgPath)) {
    return {}
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    return pkg.dotdo ?? {}
  } catch {
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
export function loadConfig(projectRoot?: string): DotdoConfig {
  const root = projectRoot ?? findProjectRoot()

  const wranglerConfig = loadWranglerConfig(root)
  const pkgConfig = loadPackageJsonConfig(root)
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
export async function loadConfigAsync(projectRoot?: string): Promise<DotdoConfig> {
  const root = projectRoot ?? findProjectRoot()

  const wranglerConfig = loadWranglerConfig(root)
  const pkgConfig = loadPackageJsonConfig(root)
  const dotdoConfig = await loadDotdoConfig(root)
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
