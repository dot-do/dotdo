/**
 * withNpm Mixin - NPM Package Management Capability for Durable Objects
 *
 * This mixin adds the $.npm capability to Durable Objects, providing
 * npm-like package management operations including resolution, installation,
 * and script execution.
 *
 * Uses the $.fs capability for filesystem storage and optionally $.bash
 * for running npm scripts.
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo'
 * import { withNpm, withFs } from 'dotdo/mixins'
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

import { createCapabilityMixin, type Constructor, type CapabilityContext } from './infrastructure'
import type { FsCapability, WithFsContext } from './fs'

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
 * Configuration options for the withNpm mixin
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
   * Requires withBash capability.
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
// SEMVER IMPLEMENTATION
// ============================================================================

interface SemVerParts {
  major: number
  minor: number
  patch: number
  prerelease?: string[]
}

function parseSemVer(version: string): SemVerParts | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?/)
  if (!match) return null
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4]?.split('.'),
  }
}

function compareSemVer(a: string, b: string): number {
  const parsedA = parseSemVer(a)
  const parsedB = parseSemVer(b)
  if (!parsedA || !parsedB) return 0

  if (parsedA.major !== parsedB.major) return parsedA.major - parsedB.major
  if (parsedA.minor !== parsedB.minor) return parsedA.minor - parsedB.minor
  if (parsedA.patch !== parsedB.patch) return parsedA.patch - parsedB.patch

  if (parsedA.prerelease && !parsedB.prerelease) return -1
  if (!parsedA.prerelease && parsedB.prerelease) return 1

  return 0
}

function satisfies(version: string, range: string): boolean {
  const parsed = parseSemVer(version)
  if (!parsed) return false

  if (range === '*' || range === 'latest' || range === '') return true

  if (/^\d+\.\d+\.\d+/.test(range)) {
    return compareSemVer(version, range) === 0
  }

  if (range.startsWith('^')) {
    const rangeVersion = parseSemVer(range.slice(1))
    if (!rangeVersion) return false

    if (rangeVersion.major === 0) {
      if (rangeVersion.minor === 0) {
        return parsed.major === 0 && parsed.minor === 0 && parsed.patch >= rangeVersion.patch
      }
      return parsed.major === 0 && parsed.minor === rangeVersion.minor && parsed.patch >= rangeVersion.patch
    }

    return (
      parsed.major === rangeVersion.major &&
      (parsed.minor > rangeVersion.minor || (parsed.minor === rangeVersion.minor && parsed.patch >= rangeVersion.patch))
    )
  }

  if (range.startsWith('~')) {
    const rangeVersion = parseSemVer(range.slice(1))
    if (!rangeVersion) return false
    return parsed.major === rangeVersion.major && parsed.minor === rangeVersion.minor && parsed.patch >= rangeVersion.patch
  }

  if (range.startsWith('>=')) return compareSemVer(version, range.slice(2).trim()) >= 0
  if (range.startsWith('>') && !range.startsWith('>=')) return compareSemVer(version, range.slice(1).trim()) > 0
  if (range.startsWith('<=')) return compareSemVer(version, range.slice(2).trim()) <= 0
  if (range.startsWith('<') && !range.startsWith('<=')) return compareSemVer(version, range.slice(1).trim()) < 0

  return compareSemVer(version, range) === 0
}

function maxSatisfying(versions: string[], range: string): string | null {
  const validVersions = versions
    .filter((v) => parseSemVer(v) !== null && !parseSemVer(v)?.prerelease)
    .sort((a, b) => -compareSemVer(a, b))

  if (range === 'latest' || range === '*') {
    return validVersions[0] || null
  }

  for (const version of validVersions) {
    if (satisfies(version, range)) {
      return version
    }
  }

  return null
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
  const cache = new Map<string, Promise<unknown>>()

  async function fetchPackageMetadata(name: string): Promise<{
    name: string
    versions: Record<string, ResolvedPackage>
    'dist-tags': Record<string, string>
  }> {
    const cacheKey = `${registry}/${name}`
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) as Promise<{
        name: string
        versions: Record<string, ResolvedPackage>
        'dist-tags': Record<string, string>
      }>
    }

    const promise = fetch(`${registry}/${encodeURIComponent(name)}`, {
      headers: { Accept: 'application/json' },
    }).then((res) => {
      if (!res.ok) throw new Error(`Package not found: ${name}`)
      return res.json()
    })

    cache.set(cacheKey, promise)
    return promise as Promise<{
      name: string
      versions: Record<string, ResolvedPackage>
      'dist-tags': Record<string, string>
    }>
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
// TARBALL CREATION
// ============================================================================

function createTarHeader(name: string, size: number, mode: number = 0o644): Uint8Array {
  const header = new Uint8Array(512)
  const encoder = new TextEncoder()

  const nameBytes = encoder.encode(name.slice(0, 99))
  header.set(nameBytes, 0)

  const modeStr = mode.toString(8).padStart(7, '0') + '\0'
  header.set(encoder.encode(modeStr), 100)

  header.set(encoder.encode('0000000\0'), 108)
  header.set(encoder.encode('0000000\0'), 116)

  const sizeStr = size.toString(8).padStart(11, '0') + '\0'
  header.set(encoder.encode(sizeStr), 124)

  const mtime = Math.floor(Date.now() / 1000)
    .toString(8)
    .padStart(11, '0') + '\0'
  header.set(encoder.encode(mtime), 136)

  header.set(encoder.encode('        '), 148)
  header[156] = 0x30

  header.set(encoder.encode('ustar'), 257)
  header[262] = 0x00
  header.set(encoder.encode('00'), 263)

  let checksum = 0
  for (let i = 0; i < 512; i++) {
    checksum += header[i]
  }
  const checksumStr = checksum.toString(8).padStart(6, '0') + '\0 '
  header.set(encoder.encode(checksumStr), 148)

  return header
}

async function createTarball(files: Array<{ path: string; content: Uint8Array }>): Promise<Uint8Array> {
  const blocks: Uint8Array[] = []

  for (const file of files) {
    const header = createTarHeader(file.path, file.content.length)
    blocks.push(header)
    blocks.push(file.content)

    const padding = 512 - (file.content.length % 512)
    if (padding < 512) {
      blocks.push(new Uint8Array(padding))
    }
  }

  blocks.push(new Uint8Array(1024))

  const totalSize = blocks.reduce((sum, block) => sum + block.length, 0)
  const result = new Uint8Array(totalSize)

  let offset = 0
  for (const block of blocks) {
    result.set(block, offset)
    offset += block.length
  }

  const stream = new Blob([result]).stream()
  const compressedStream = stream.pipeThrough(new CompressionStream('gzip'))
  const compressedBlob = await new Response(compressedStream).blob()
  return new Uint8Array(await compressedBlob.arrayBuffer())
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
      throw new Error('withNpm.run() requires withBash capability. Apply withBash mixin to use npm scripts.')
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

    const files: Array<{ path: string; content: Uint8Array }> = []

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
          files.push({
            path: `package/${tarPath}`,
            content: new TextEncoder().encode(content as string),
          })
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
// MIXIN IMPLEMENTATION
// ============================================================================

/**
 * Create the capability initialization function for npm
 */
function createNpmInit(options: WithNpmOptions = {}) {
  return (ctx: CapabilityContext): NpmCapability => {
    // Get fs capability from context
    const $ = ctx.$ as WithFsContext
    if (!$.fs) {
      throw new Error('withNpm requires withFs capability. Apply withFs mixin first.')
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
 * Base mixin without options - uses default configuration
 */
const baseNpmMixin = createCapabilityMixin<'npm', NpmCapability>('npm', createNpmInit())

/**
 * withNpm mixin - adds $.npm capability to a Durable Object class
 *
 * This mixin provides npm-like package management operations backed by
 * the $.fs capability for storage.
 *
 * **Requires**: withFs capability must be applied first
 * **Optional**: withBash capability (required for $.npm.run())
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
    const customMixin = createCapabilityMixin<'npm', NpmCapability>('npm', createNpmInit(options))
    return customMixin(Base)
  }

  return baseNpmMixin(Base)
}
