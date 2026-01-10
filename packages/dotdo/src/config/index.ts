/**
 * DO Config Module
 *
 * Configuration system for do.config.ts files.
 * Provides type-safe configuration loading, validation, and environment resolution.
 *
 * This is a STUB file for TDD RED phase - implementation pending.
 *
 * @see docs/plans/2026-01-10-do-dashboard-design.md for specification
 */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Authentication configuration for OAuth providers
 */
export interface AuthConfig {
  /**
   * OAuth provider
   * @default 'oauth.do' - federated auth via oauth.do
   */
  provider?: 'oauth.do' | 'workos' | 'clerk' | 'auth0' | 'custom'
  clientId?: string
  clientSecret?: string
  scopes?: string[]
  authorizationUrl?: string
  tokenUrl?: string
  userinfoUrl?: string
}

/**
 * Custom view configuration for dashboard
 */
export interface CustomView {
  name: string
  path: string
  component: string
}

/**
 * Dashboard/Admin UI configuration
 */
export interface DashboardConfig {
  title?: string
  logo?: string
  favicon?: string
  theme?: 'light' | 'dark' | 'auto'
  sections?: Array<'schema' | 'data' | 'compute' | 'platform' | 'storage'>
  views?: CustomView[]
}

/**
 * REST API configuration
 */
export interface ApiConfig {
  basePath?: string // default: '/api'
  openapi?: {
    title?: string
    version?: string
    description?: string
  }
  cors?: {
    origins?: string[]
    methods?: string[]
    credentials?: boolean
  }
  rateLimit?: {
    limit: number
    window: '1s' | '1m' | '1h' | '1d'
  }
}

/**
 * Key bindings for CLI
 */
export interface KeyBindings {
  quit?: string
  help?: string
  search?: string
  create?: string
  edit?: string
  delete?: string
  [key: string]: string | undefined
}

/**
 * CLI configuration
 */
export interface CliConfig {
  name?: string // CLI command name
  keys?: Partial<KeyBindings>
  vimMode?: boolean // default: true
}

/**
 * Main DO configuration interface
 *
 * Defines the structure of do.config.ts files.
 */
export interface DoConfig {
  /**
   * Primary namespace URL
   * @example 'myapp.com'
   */
  ns: string

  /**
   * Environment-specific namespace overrides
   */
  envs?: Record<string, string>

  /**
   * Authentication configuration
   * @default Uses oauth.do with automatic provider detection
   */
  auth?: AuthConfig

  /**
   * Dashboard/Admin UI configuration
   */
  dashboard?: DashboardConfig

  /**
   * REST API configuration
   */
  api?: ApiConfig

  /**
   * CLI configuration
   */
  cli?: CliConfig
}

/**
 * Options for loadConfig()
 */
export interface LoadConfigOptions {
  /**
   * Working directory to search for do.config.ts
   * @default process.cwd()
   */
  cwd?: string

  /**
   * Whether to cache loaded config
   * @default true
   */
  cache?: boolean
}

// =============================================================================
// Functions (STUB - Not Implemented)
// =============================================================================

/**
 * Define a DO configuration with type safety.
 *
 * @param config - The configuration object
 * @returns The same configuration object (identity function for type inference)
 *
 * @example
 * ```ts
 * // do.config.ts
 * import { defineConfig } from 'dotdo'
 *
 * export default defineConfig({
 *   ns: 'myapp.com',
 *   envs: {
 *     staging: 'staging.myapp.com',
 *     production: 'myapp.com',
 *   },
 * })
 * ```
 */
export function defineConfig(config: DoConfig): DoConfig {
  // STUB: Will be implemented in GREEN phase
  throw new Error('Not implemented: defineConfig()')
}

/**
 * Load DO configuration from do.config.ts file.
 *
 * @param options - Load options
 * @returns Promise resolving to the loaded configuration
 * @throws ConfigNotFoundError if no config file is found
 * @throws ConfigValidationError if config is invalid
 *
 * @example
 * ```ts
 * const config = await loadConfig()
 * console.log(config.ns) // 'myapp.com'
 * ```
 */
export async function loadConfig(options?: LoadConfigOptions): Promise<DoConfig> {
  // STUB: Will be implemented in GREEN phase
  throw new Error('Not implemented: loadConfig()')
}

/**
 * Resolve the namespace for the current environment.
 *
 * Uses DO_ENV or NODE_ENV environment variables to determine the current environment,
 * then looks up the namespace in the envs override map.
 *
 * @param config - The DO configuration
 * @param env - Optional explicit environment name (overrides env vars)
 * @returns The resolved namespace URL
 *
 * @example
 * ```ts
 * const config = { ns: 'myapp.com', envs: { staging: 'staging.myapp.com' } }
 *
 * resolveNamespace(config) // 'myapp.com' (no env set)
 * resolveNamespace(config, 'staging') // 'staging.myapp.com'
 *
 * process.env.DO_ENV = 'staging'
 * resolveNamespace(config) // 'staging.myapp.com'
 * ```
 */
export function resolveNamespace(config: DoConfig, env?: string): string {
  // STUB: Will be implemented in GREEN phase
  throw new Error('Not implemented: resolveNamespace()')
}
