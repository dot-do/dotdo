/**
 * withNpm Capability - NPM Package Management Capability for Durable Objects
 *
 * This capability adds the $.npm API to Durable Objects, providing
 * npm-like package management operations including resolution, installation,
 * and script execution.
 *
 * Uses the $.fs capability for filesystem storage and optionally $.bash
 * for running npm scripts.
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo'
 * import { withNpm, withFs } from 'dotdo/capabilities'
 *
 * class BuildDO extends withNpm(withFs(DO)) {
 *   async build() {
 *     // Resolve version
 *     const version = await this.$.npm.resolve('lodash', '^4.17.0')
 *
 *     // Install packages
 *     await this.$.npm.install('lodash', version)
 *
 *     // List installed
 *     const packages = await this.$.npm.list()
 *     return packages
 *   }
 * }
 * ```
 *
 * @see dotdo-zjxth for design details
 */

import { createCapability, type Constructor, type CapabilityContext } from './infrastructure'
import type { FsCapability, WithFsContext } from './fs'

// Core imports - shared with NpmDO for single source of truth
import { satisfies, maxSatisfying } from '../../primitives/npmx/core/semver'
import { createTarball } from '../../primitives/npmx/core/tarball'
import { LRUCache } from '../../primitives/npmx/core/cache/lru'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result from bash command execution (for npm run)
 */
export interface BashResult {
  input: string
  command: string
  valid: boolean
  generated: boolean
  stdout: string
  stderr: string
  exitCode: number
  blocked?: boolean
  requiresConfirm?: boolean
}

/**
 * Configuration options for the withNpm capability
 */
export interface WithNpmOptions {
  /** Custom npm registry URL (default: https://registry.npmjs.org) */
  registry?: string
}

/**
 * Lock file format (npm v3 package-lock.json compatible)
 */
export interface LockFile {
  name?: string
  version?: string
  lockfileVersion: number
  requires?: boolean
  packages: Record<string, LockFileEntry>
}

/**
 * Entry in the lock file packages section
 */
export interface LockFileEntry {
  version: string
  resolved?: string
  integrity?: string
  dev?: boolean
  optional?: boolean
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/**
 * Result of an npm install operation
 */
export interface InstallResult {
  /** Packages that were added */
  added: Array<{ name: string; version: string }>
  /** Packages that were removed */
  removed: Array<{ name: string; version: string }>
  /** Packages that were updated */
  updated: Array<{ name: string; from: string; to: string }>
}

/**
 * Installed package entry
 */
export interface InstalledPackage {
  name: string
  version: string
  dev?: boolean
}

/**
 * Package.json structure (simplified)
 */
export interface PackageJson {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

/**
 * Resolved package info from registry
 */
export interface ResolvedPackage {
  name: string
  version: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dist?: {
    tarball?: string
    shasum?: string
    integrity?: string
  }
}

/**
 * The npm capability API exposed on $.npm
 */
export interface NpmCapability {
  /**
   * Resolve a semver range to a specific version.
   *
   * @param name - Package name (e.g., 'lodash')
   * @param range - Semver range (e.g., '^4.17.0')
   * @returns Resolved version string
   */
  resolve(name: string, range: string): Promise<string>

  /**
   * Install packages to the virtual filesystem.
   *
   * @param name - Optional package name to install
   * @param version - Optional specific version
   * @returns Install result
   */
  install(name?: string, version?: string): Promise<InstallResult>

  /**
   * List installed packages.
   */
  list(): Promise<InstalledPackage[]>

  /**
   * Generate or read the lockfile.
   */
  lockfile(): Promise<LockFile>

  /**
   * Run an npm script from package.json.
   * Requires withBash.
   */
  run(script: string): Promise<BashResult>

  /**
   * Pack a directory into a tarball.
   */
  pack(dir?: string): Promise<Uint8Array>
}

/**
 * Extended WorkflowContext type with npm capability
 */
export interface WithNpmContext extends WithFsContext {
  npm: NpmCapability
}

// ============================================================================
// REGISTRY FETCHER
// ============================================================================

const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

interface RegistryFetcher {
  getPackageVersions(name: string): Promise<string[]>
  getPackageInfo(name: string, version: string): Promise<ResolvedPackage>
  getLatestVersion(name: string): Promise<string>
}

function createRegistryFetcher(registry: string = DEFAULT_REGISTRY): RegistryFetcher {
  // Use LRUCache to prevent OOM in long-running DOs (bounded to 100 entries)
  const cache = new LRUCache<string, Promise<unknown>>({ maxSize: 100 })

  async function fetchPackageMetadata(name: string): Promise<{
    name: string
    versions: Record<string, ResolvedPackage>
    'dist-tags': Record<string, string>
  }> {
    type PackageMetadata = {
      name: string
      versions: Record<string, ResolvedPackage>
      'dist-tags': Record<string, string>
    }

    const cacheKey = `${registry}/${name}`
    const cached = cache.get(cacheKey)
    if (cached) {
      return cached as Promise<PackageMetadata>
    }

    const promise = fetch(`${registry}/${encodeURIComponent(name)}`, {
      headers: { Accept: 'application/json' },
    }).then((res) => {
      if (!res.ok) throw new Error(`Package not found: ${name}`)
      return res.json()
    })

    cache.set(cacheKey, promise)
    return promise as Promise<PackageMetadata>
  }

  return {
    async getPackageVersions(name: string): Promise<string[]> {
      const metadata = await fetchPackageMetadata(name)
      return Object.keys(metadata.versions || {})
    },

    async getPackageInfo(name: string, version: string): Promise<ResolvedPackage> {
      const metadata = await fetchPackageMetadata(name)
      const versionData = metadata.versions?.[version]
      if (!versionData) throw new Error(`Version ${version} not found for package ${name}`)
      return {
        name: versionData.name,
        version: versionData.version,
        dependencies: versionData.dependencies,
        devDependencies: versionData.devDependencies,
        peerDependencies: versionData.peerDependencies,
        optionalDependencies: versionData.optionalDependencies,
        dist: versionData.dist,
      }
    },

    async getLatestVersion(name: string): Promise<string> {
      const metadata = await fetchPackageMetadata(name)
      const latest = metadata['dist-tags']?.latest
      if (!latest) {
        const versions = Object.keys(metadata.versions || {})
        return maxSatisfying(versions, '*') || versions[0] || ''
      }
      return latest
    },
  }
}

// ============================================================================
// NPM MODULE IMPLEMENTATION
// ============================================================================

class NpmModule implements NpmCapability {
  private fs: FsCapability
  private bash?: { run: (script: string) => Promise<BashResult> }
  private registryFetcher: RegistryFetcher

  constructor(
    fs: FsCapability,
    options?: {
      bash?: { run: (script: string) => Promise<BashResult> }
      registry?: string
    }
  ) {
    this.fs = fs
    this.bash = options?.bash
    this.registryFetcher = createRegistryFetcher(options?.registry)
  }

  async resolve(name: string, range: string): Promise<string> {
    if (range === 'latest' || range === '') {
      return this.registryFetcher.getLatestVersion(name)
    }

    const versions = await this.registryFetcher.getPackageVersions(name)
    const resolved = maxSatisfying(versions, range)
    if (!resolved) {
      throw new Error(`No version of ${name} satisfies range ${range}`)
    }
    return resolved
  }

  async install(name?: string, version?: string): Promise<InstallResult> {
    const result: InstallResult = { added: [], removed: [], updated: [] }

    const nodeModulesExists = await this.fs.exists('/node_modules')
    if (!nodeModulesExists) {
      await this.fs.mkdir('/node_modules', { recursive: true })
    }

    if (name) {
      const resolvedVersion = version || (await this.resolve(name, 'latest'))
      const pkgInfo = await this.registryFetcher.getPackageInfo(name, resolvedVersion)

      const pkgJsonPath = `/node_modules/${name}/package.json`
      const alreadyInstalled = await this.fs.exists(pkgJsonPath)

      if (alreadyInstalled) {
        const existingContent = await this.fs.read(pkgJsonPath, { encoding: 'utf-8' })
        const existingPkg = JSON.parse(existingContent as string) as PackageJson
        if (existingPkg.version !== resolvedVersion) {
          result.updated.push({ name, from: existingPkg.version || 'unknown', to: resolvedVersion })
        } else {
          return result
        }
      } else {
        result.added.push({ name, version: resolvedVersion })
      }

      await this.fs.mkdir(`/node_modules/${name}`, { recursive: true })
      await this.fs.write(
        pkgJsonPath,
        JSON.stringify({ name: pkgInfo.name, version: pkgInfo.version, dependencies: pkgInfo.dependencies }, null, 2)
      )
    } else {
      const packageJsonExists = await this.fs.exists('/package.json')
      if (!packageJsonExists) {
        throw new Error('No package.json found')
      }

      const content = await this.fs.read('/package.json', { encoding: 'utf-8' })
      const packageJson = JSON.parse(content as string) as PackageJson
      const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies }

      for (const [depName, depRange] of Object.entries(allDeps)) {
        const subResult = await this.install(depName, await this.resolve(depName, depRange))
        result.added.push(...subResult.added)
        result.updated.push(...subResult.updated)
      }
    }

    await this.updateLockfile()
    return result
  }

  async list(): Promise<InstalledPackage[]> {
    const packages: InstalledPackage[] = []

    const nodeModulesExists = await this.fs.exists('/node_modules')
    if (!nodeModulesExists) return packages

    const entries = await this.fs.list('/node_modules')
    const entryNames = Array.isArray(entries) ? entries.map((e) => (typeof e === 'string' ? e : e.name)) : []

    for (const entryName of entryNames) {
      if (entryName.startsWith('.')) continue

      if (entryName.startsWith('@')) {
        const scopedEntries = await this.fs.list(`/node_modules/${entryName}`)
        const scopedNames = Array.isArray(scopedEntries) ? scopedEntries.map((e) => (typeof e === 'string' ? e : e.name)) : []

        for (const scopedName of scopedNames) {
          const pkgJsonPath = `/node_modules/${entryName}/${scopedName}/package.json`
          if (await this.fs.exists(pkgJsonPath)) {
            try {
              const content = await this.fs.read(pkgJsonPath, { encoding: 'utf-8' })
              const pkgJson = JSON.parse(content as string) as PackageJson
              packages.push({ name: `${entryName}/${scopedName}`, version: pkgJson.version || 'unknown' })
            } catch {
              // Skip invalid package.json
            }
          }
        }
      } else {
        const pkgJsonPath = `/node_modules/${entryName}/package.json`
        if (await this.fs.exists(pkgJsonPath)) {
          try {
            const content = await this.fs.read(pkgJsonPath, { encoding: 'utf-8' })
            const pkgJson = JSON.parse(content as string) as PackageJson
            packages.push({ name: entryName, version: pkgJson.version || 'unknown' })
          } catch {
            // Skip invalid package.json
          }
        }
      }
    }

    return packages
  }

  async lockfile(): Promise<LockFile> {
    const lockfilePath = '/package-lock.json'
    const exists = await this.fs.exists(lockfilePath)

    if (exists) {
      const content = await this.fs.read(lockfilePath, { encoding: 'utf-8' })
      return JSON.parse(content as string) as LockFile
    }

    return this.generateLockfile()
  }

  async run(script: string): Promise<BashResult> {
    if (!this.bash) {
      throw new Error('withNpm.run() requires withBash capability. Apply withBash to use npm scripts.')
    }

    const packageJsonExists = await this.fs.exists('/package.json')
    if (!packageJsonExists) {
      throw new Error('No package.json found')
    }

    const content = await this.fs.read('/package.json', { encoding: 'utf-8' })
    const packageJson = JSON.parse(content as string) as PackageJson
    const scriptCommand = packageJson.scripts?.[script]

    if (!scriptCommand) {
      throw new Error(`Script "${script}" not found in package.json`)
    }

    return this.bash.run(scriptCommand)
  }

  async pack(dir: string = '/'): Promise<Uint8Array> {
    const pkgJsonPath = dir === '/' ? '/package.json' : `${dir}/package.json`
    const pkgJsonExists = await this.fs.exists(pkgJsonPath)

    if (!pkgJsonExists) {
      throw new Error(`No package.json found in ${dir}`)
    }

    // Core createTarball uses Map<string, Uint8Array> format
    const files = new Map<string, Uint8Array>()

    const collectFiles = async (currentDir: string, prefix: string) => {
      const entries = await this.fs.list(currentDir)
      const entryNames = Array.isArray(entries) ? entries.map((e) => (typeof e === 'string' ? e : e.name)) : []

      for (const entryName of entryNames) {
        const fullPath = currentDir === '/' ? `/${entryName}` : `${currentDir}/${entryName}`
        const tarPath = prefix ? `${prefix}/${entryName}` : entryName

        if (entryName === 'node_modules' || entryName === '.git') continue

        const stat = await this.fs.stat(fullPath)
        if (stat.isDirectory()) {
          await collectFiles(fullPath, tarPath)
        } else {
          const content = await this.fs.read(fullPath, { encoding: 'utf-8' })
          // Use path with 'package/' prefix as key (npm pack convention)
          files.set(`package/${tarPath}`, new TextEncoder().encode(content as string))
        }
      }
    }

    await collectFiles(dir, '')
    return createTarball(files)
  }

  private async updateLockfile(): Promise<void> {
    const lockfile = await this.generateLockfile()
    await this.fs.write('/package-lock.json', JSON.stringify(lockfile, null, 2))
  }

  private async generateLockfile(): Promise<LockFile> {
    const packages: Record<string, LockFileEntry> = {}

    const packageJsonExists = await this.fs.exists('/package.json')
    let rootPackage: PackageJson = {}
    if (packageJsonExists) {
      const content = await this.fs.read('/package.json', { encoding: 'utf-8' })
      rootPackage = JSON.parse(content as string)
    }

    packages[''] = { version: rootPackage.version || '0.0.0', dependencies: rootPackage.dependencies }

    const installed = await this.list()
    for (const pkg of installed) {
      const pkgJsonPath = `/node_modules/${pkg.name}/package.json`
      if (await this.fs.exists(pkgJsonPath)) {
        const content = await this.fs.read(pkgJsonPath, { encoding: 'utf-8' })
        const pkgJson = JSON.parse(content as string) as PackageJson
        packages[`node_modules/${pkg.name}`] = { version: pkg.version, dependencies: pkgJson.dependencies }
      }
    }

    return {
      name: rootPackage.name,
      version: rootPackage.version,
      lockfileVersion: 3,
      requires: true,
      packages,
    }
  }
}

// ============================================================================
// CAPABILITY IMPLEMENTATION
// ============================================================================

/**
 * Create the capability initialization function for npm
 */
function createNpmInit(options: WithNpmOptions = {}) {
  return (ctx: CapabilityContext): NpmCapability => {
    // Get fs capability from context
    const $ = ctx.$ as WithFsContext
    if (!$.fs) {
      throw new Error('withNpm requires withFs capability. Apply withFs first.')
    }

    // Get optional bash capability
    const bash = ($ as unknown as { bash?: { run: (script: string) => Promise<BashResult> } }).bash

    return new NpmModule($.fs as unknown as FsCapability, {
      bash: bash?.run ? { run: (script: string) => bash.run(script) } : undefined,
      registry: options.registry,
    })
  }
}

/**
 * Base capability without options - uses default configuration
 */
const baseNpmCapability = createCapability<'npm', NpmCapability>('npm', createNpmInit())

/**
 * withNpm capability - adds $.npm capability to a Durable Object class
 *
 * This capability provides npm-like package management operations backed by
 * the $.fs capability for storage.
 *
 * **Requires**: withFs must be applied first
 * **Optional**: withBash (required for $.npm.run())
 *
 * @param Base - The base DO class to extend (must have withFs applied)
 * @param options - Optional configuration for the npm capability
 * @returns Extended class with $.npm capability
 *
 * @example
 * ```typescript
 * // Basic usage
 * class MyDO extends withNpm(withFs(DO)) {
 *   async setup() {
 *     await this.$.npm.install('lodash', '4.17.21')
 *     const packages = await this.$.npm.list()
 *     return packages
 *   }
 * }
 *
 * // With custom registry
 * class PrivateDO extends withNpm(withFs(DO), {
 *   registry: 'https://npm.mycompany.com'
 * }) {
 *   async install() {
 *     await this.$.npm.install('@mycompany/private-pkg')
 *   }
 * }
 *
 * // With bash for scripts
 * class BuildDO extends withNpm(withBash(withFs(DO))) {
 *   async build() {
 *     await this.$.npm.install()
 *     const result = await this.$.npm.run('build')
 *     return result.exitCode === 0
 *   }
 * }
 * ```
 */
export function withNpm<TBase extends Constructor<{ ctx: DurableObjectState; env: unknown; $: unknown }>>(
  Base: TBase,
  options?: WithNpmOptions
): TBase & Constructor<{ hasCapability(name: string): boolean }> {
  if (options) {
    const customCapability = createCapability<'npm', NpmCapability>('npm', createNpmInit(options))
    return customCapability(Base)
  }

  return baseNpmCapability(Base)
}
