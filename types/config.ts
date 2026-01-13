/**
 * Config Types
 *
 * Type definitions for dotdo.config.ts with surfaces support.
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

/**
 * Surface configuration with shell and content directory
 */
export interface SurfaceConfig {
  /** Path to the shell component (e.g., './Docs.mdx') */
  shell: string
  /** Path to the content directory (e.g., 'docs/') */
  content: string
}

/**
 * Surface entry - either a string shortcut or full config object
 */
export type SurfaceEntry = string | SurfaceConfig

/**
 * Surfaces configuration map
 * Keys are surface names (app, admin, docs, etc.)
 * Values are either string paths or SurfaceConfig objects
 */
export type SurfacesConfig = Record<string, SurfaceEntry>

/**
 * Complete dotdo configuration interface
 */
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

  // Surfaces configuration
  surfaces?: SurfacesConfig
}

/**
 * Input configuration for defineConfig (allows partial config)
 */
export type DotdoConfigInput = Partial<DotdoConfig>
