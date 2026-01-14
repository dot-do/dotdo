/**
 * npmx.do - NPM/NPX for Edge Runtimes
 *
 * Package management that works in Cloudflare Workers, Deno, browsers,
 * and any V8 isolate. Zero cold starts, no Node.js required.
 *
 * @example
 * ```typescript
 * import { npm, npx } from 'npmx.do'
 *
 * // Install packages at runtime
 * await npm.install(['lodash', 'react@18'])
 *
 * // Run npx commands
 * await npx('cowsay', ['hello'])
 * ```
 *
 * @example CLI
 * ```bash
 * npx npmx.do install lodash
 * npx npmx.do info react
 * npx npmx.do search "state management"
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Re-export core @dotdo/npmx
// =============================================================================

export * from './core/index.js'

// =============================================================================
// CLI exports
// =============================================================================

export {
  createCLI,
  runCLI,
  formatPackageList,
  formatSearchResults,
  formatPackageInfo,
  formatInstallResult,
} from './cli/index.js'

export type {
  CommandResult,
  PackageEntry,
  SearchResult,
  ListFormatOptions,
  InstallOptions,
} from './cli/types.js'

// =============================================================================
// Shared types (single source of truth)
// =============================================================================

import type { InstallResult as _InstallResult } from './types.js'
export type { InstallResult, PackageVersion, PackageUpdate } from './types.js'
export { createEmptyInstallResult } from './types.js'

// Re-alias for internal use
type InstallResult = _InstallResult

// =============================================================================
// Service Definition (for dotdo integration)
// =============================================================================

// import { createService } from 'dotdo'
// import App from './App.js'
// import Site from './Site.js'
//
// export default createService({
//   name: 'npmx',
//   App,
//   Site,
//   docs: import.meta.glob('./docs/*.mdx'),
// })

// =============================================================================
// npm/npx factories for SDK usage
// =============================================================================

/**
 * Configuration options for the npm SDK
 */
export interface NpmConfig {
  /** Working directory for operations */
  cwd?: string
  /** Custom registry URL */
  registry?: string
  /** Authentication token */
  token?: string
}

// InstallResult is now exported from './types.js' above

/**
 * npm SDK interface
 */
export interface NpmSDK {
  /**
   * Install packages
   * @param packages - Package specs to install (e.g., ['lodash', 'react@18'])
   * @param options - Install options
   */
  install: (packages?: string[], options?: { dev?: boolean; exact?: boolean }) => Promise<InstallResult>

  /**
   * Uninstall packages
   * @param packages - Package names to remove
   */
  uninstall: (packages: string[]) => Promise<void>

  /**
   * Run a package.json script
   * @param script - Script name
   * @param args - Arguments to pass to the script
   */
  run: (script: string, args?: string[]) => Promise<{ exitCode: number; output: string }>

  /**
   * List installed packages
   * @param options - List options
   */
  list: (options?: { depth?: number }) => Promise<Array<{ name: string; version: string }>>

  /**
   * Search the registry
   * @param query - Search query
   */
  search: (query: string) => Promise<Array<{ name: string; version: string; description?: string }>>

  /**
   * Get package info
   * @param name - Package name
   * @param version - Optional version
   */
  info: (name: string, version?: string) => Promise<{
    name: string
    version: string
    description?: string
    dependencies?: Record<string, string>
  }>
}

/**
 * Create an npm SDK instance
 *
 * @experimental This API returns placeholder data. Full implementation pending.
 * All methods return empty arrays or stub values. Use the core/ modules
 * directly for actual package operations until this SDK is fully implemented.
 *
 * @param config - Configuration options
 * @returns An npm SDK instance with placeholder methods
 *
 * @example
 * ```typescript
 * import { createNpm } from 'npmx.do'
 *
 * const npm = createNpm({ cwd: '/app' })
 * await npm.install(['lodash', 'express'])
 * await npm.run('build')
 * ```
 */
export function createNpm(config: NpmConfig = {}): NpmSDK {
  // @experimental - Placeholder implementation
  // TODO: Wire up to core/ modules (resolver, tarball, package)
  void config // Acknowledge config param for future use
  return {
    install: async () => ({
      installed: [],
      removed: [],
      updated: [],
      stats: {
        resolved: 0,
        cached: 0,
        duration: 0,
      },
    }),
    uninstall: async () => {},
    run: async () => ({ exitCode: 0, output: '' }),
    list: async () => [],
    search: async () => [],
    info: async (name) => ({ name, version: '0.0.0' }),
  }
}

/**
 * Execute a package binary (npx-style)
 *
 * @experimental This API returns placeholder data. Full implementation pending.
 * Currently returns an empty success result without executing any command.
 * Use bashx.do for actual command execution until this is fully implemented.
 *
 * @param command - Command/package to run
 * @param args - Arguments to pass
 * @param options - Execution options
 *
 * @example
 * ```typescript
 * import { npx } from 'npmx.do'
 *
 * // Run cowsay
 * await npx('cowsay', ['hello'])
 *
 * // Create a Next.js app
 * await npx('create-next-app', ['my-app'])
 * ```
 */
export async function npx(
  command: string,
  args: string[] = [],
  options: NpmConfig = {}
): Promise<{ exitCode: number; output: string }> {
  // @experimental - Placeholder implementation
  // TODO: Implement package download, caching, and execution via bashx
  void command
  void args
  void options
  return { exitCode: 0, output: '' }
}

/**
 * Default npm SDK singleton
 *
 * @experimental This API returns placeholder data. See {@link createNpm} for details.
 * All methods return empty arrays or stub values until fully implemented.
 *
 * @example
 * ```typescript
 * import { npm } from 'npmx.do'
 *
 * await npm.install(['lodash'])
 * const packages = await npm.list()
 * ```
 */
export const npm: NpmSDK = createNpm()
