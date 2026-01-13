/**
 * withNpm Mixin - NPM Package Management Capability
 *
 * Adds $.npm to the WorkflowContext with package management operations:
 * - resolve, install, list, lockfile
 * - run (requires withBash)
 * - pack
 *
 * Uses the npm registry API for package resolution and provides
 * filesystem-backed package management via $.fs.
 *
 * @example
 * ```typescript
 * import { withNpm, withFs } from 'dotdo/mixins'
 * import { DO } from 'dotdo'
 *
 * // Basic usage with filesystem
 * class MyDO extends withNpm(withFs(DO)) {
 *   async setup() {
 *     // Install lodash
 *     await this.$.npm.install('lodash', '4.17.21')
 *
 *     // List installed packages
 *     const packages = await this.$.npm.list()
 *     console.log(packages)
 *   }
 * }
 *
 * // With bash capability for npm run scripts
 * class BuildDO extends withNpm(withBash(withFs(DO))) {
 *   async build() {
 *     await this.$.npm.install()  // Install all deps from package.json
 *     const result = await this.$.npm.run('build')
 *     return result.exitCode === 0
 *   }
 * }
 * ```
 *
 * @module lib/mixins/npm
 */

import type { WorkflowContext } from '../../types/WorkflowContext'
import type { FsCapability, WithFsContext } from './fs'

// ============================================================================
// BASH RESULT TYPE (minimal definition for run())
// ============================================================================

/**
 * Result from bash command execution.
 * Matches the BashResult interface from bashx.
 */
export interface BashResult {
  input: string
  command: string
  valid: boolean
  generated: boolean
  stdout: string
  stderr: string
  exitCode: number
  intent?: {
    commands: string[]
    reads: string[]
    writes: string[]
    deletes: string[]
    network: boolean
    elevated: boolean
  }
  classification?: {
    type: 'read' | 'write' | 'delete' | 'execute' | 'network' | 'system' | 'mixed'
    impact: 'none' | 'low' | 'medium' | 'high' | 'critical'
    reversible: boolean
    reason: string
  }
  blocked?: boolean
  requiresConfirm?: boolean
}

// ============================================================================
// SEMVER IMPLEMENTATION
// ============================================================================

/**
 * Minimal semver implementation for version resolution.
 * Supports common version ranges used in package.json.
 */

interface SemVerParts {
  major: number
  minor: number
  patch: number
  prerelease?: string[]
}

/**
 * Parse a version string into its components.
 */
function parseSemVer(version: string): SemVerParts | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?/)
  if (!match) return null

  return {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10),
    prerelease: match[4]?.split('.'),
  }
}

/**
 * Compare two semantic versions.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
function compareSemVer(a: string, b: string): number {
  const parsedA = parseSemVer(a)
  const parsedB = parseSemVer(b)

  if (!parsedA || !parsedB) return 0

  if (parsedA.major !== parsedB.major) return parsedA.major - parsedB.major
  if (parsedA.minor !== parsedB.minor) return parsedA.minor - parsedB.minor
  if (parsedA.patch !== parsedB.patch) return parsedA.patch - parsedB.patch

  // Prerelease versions have lower precedence
  if (parsedA.prerelease && !parsedB.prerelease) return -1
  if (!parsedA.prerelease && parsedB.prerelease) return 1

  return 0
}

/**
 * Check if a version satisfies a semver range.
 * Supports: exact, ^, ~, >=, >, <=, <, *, latest
 */
function satisfies(version: string, range: string): boolean {
  const parsed = parseSemVer(version)
  if (!parsed) return false

  // Handle special cases
  if (range === '*' || range === 'latest' || range === '') return true

  // Handle exact version
  if (/^\d+\.\d+\.\d+/.test(range)) {
    const rangeVersion = parseSemVer(range)
    return rangeVersion !== null && compareSemVer(version, range) === 0
  }

  // Handle caret (^) - compatible with version
  if (range.startsWith('^')) {
    const rangeVersion = parseSemVer(range.slice(1))
    if (!rangeVersion) return false

    if (rangeVersion.major === 0) {
      // ^0.x.y means >=0.x.y <0.(x+1).0 for 0.x.y
      if (rangeVersion.minor === 0) {
        return parsed.major === 0 && parsed.minor === 0 && parsed.patch >= rangeVersion.patch
      }
      return parsed.major === 0 && parsed.minor === rangeVersion.minor && parsed.patch >= rangeVersion.patch
    }

    return parsed.major === rangeVersion.major &&
      (parsed.minor > rangeVersion.minor ||
        (parsed.minor === rangeVersion.minor && parsed.patch >= rangeVersion.patch))
  }

  // Handle tilde (~) - approximately equivalent
  if (range.startsWith('~')) {
    const rangeVersion = parseSemVer(range.slice(1))
    if (!rangeVersion) return false

    return parsed.major === rangeVersion.major &&
      parsed.minor === rangeVersion.minor &&
      parsed.patch >= rangeVersion.patch
  }

  // Handle >= operator
  if (range.startsWith('>=')) {
    return compareSemVer(version, range.slice(2).trim()) >= 0
  }

  // Handle > operator
  if (range.startsWith('>') && !range.startsWith('>=')) {
    return compareSemVer(version, range.slice(1).trim()) > 0
  }

  // Handle <= operator
  if (range.startsWith('<=')) {
    return compareSemVer(version, range.slice(2).trim()) <= 0
  }

  // Handle < operator
  if (range.startsWith('<') && !range.startsWith('<=')) {
    return compareSemVer(version, range.slice(1).trim()) < 0
  }

  // Default: exact match
  return compareSemVer(version, range) === 0
}

/**
 * Find the maximum version that satisfies a range.
 */
function maxSatisfying(versions: string[], range: string): string | null {
  // Filter valid versions and sort descending
  const validVersions = versions
    .filter(v => parseSemVer(v) !== null && !parseSemVer(v)?.prerelease)
    .sort((a, b) => -compareSemVer(a, b))

  // Handle 'latest' tag
  if (range === 'latest' || range === '*') {
    return validVersions[0] || null
  }

  // Find the first (highest) version that satisfies
  for (const version of validVersions) {
    if (satisfies(version, range)) {
      return version
    }
  }

  return null
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

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
 * NPM capability interface for dotdo workflows.
 *
 * Provides package management operations backed by $.fs for storage
 * and optionally $.bash for running npm scripts.
 */
export interface NpmCapability {
  /**
   * Resolve a semver range to a specific version.
   *
   * Uses npm registry to find the best matching version.
   *
   * @param name - Package name (e.g., 'lodash')
   * @param range - Semver range (e.g., '^4.17.0', '>=1.0.0 <2.0.0')
   * @returns Resolved version string
   *
   * @example
   * ```typescript
   * const version = await $.npm.resolve('lodash', '^4.17.0')
   * // => '4.17.21'
   * ```
   */
  resolve(name: string, range: string): Promise<string>

  /**
   * Install packages to the virtual filesystem.
   *
   * If called without arguments, installs all dependencies from package.json.
   * If name is provided, installs that specific package.
   *
   * @param name - Optional package name to install
   * @param version - Optional specific version (if not provided, uses 'latest')
   * @returns Install result with added/removed/updated packages
   *
   * @example
   * ```typescript
   * // Install all from package.json
   * await $.npm.install()
   *
   * // Install specific package
   * await $.npm.install('lodash')
   * await $.npm.install('lodash', '4.17.21')
   * ```
   */
  install(name?: string, version?: string): Promise<InstallResult>

  /**
   * List installed packages.
   *
   * Reads node_modules to determine what's installed.
   *
   * @returns Array of installed packages with name and version
   *
   * @example
   * ```typescript
   * const packages = await $.npm.list()
   * // => [{ name: 'lodash', version: '4.17.21' }, ...]
   * ```
   */
  list(): Promise<InstalledPackage[]>

  /**
   * Generate or read the lockfile.
   *
   * Returns the current package-lock.json structure.
   *
   * @returns LockFile structure
   *
   * @example
   * ```typescript
   * const lock = await $.npm.lockfile()
   * console.log(lock.lockfileVersion, lock.packages)
   * ```
   */
  lockfile(): Promise<LockFile>

  /**
   * Run an npm script from package.json.
   *
   * Requires withBash capability to be present.
   *
   * @param script - Script name from package.json scripts
   * @returns Bash execution result
   * @throws Error if withBash is not available
   *
   * @example
   * ```typescript
   * const result = await $.npm.run('build')
   * if (result.exitCode !== 0) {
   *   throw new Error(`Build failed: ${result.stderr}`)
   * }
   * ```
   */
  run(script: string): Promise<BashResult>

  /**
   * Pack a directory into a tarball.
   *
   * Creates an npm-compatible .tgz package from the specified directory.
   *
   * @param dir - Directory to pack (defaults to '/')
   * @returns Tarball as Uint8Array
   *
   * @example
   * ```typescript
   * const tarball = await $.npm.pack('/app')
   * await $.fs.write('/app.tgz', tarball)
   * ```
   */
  pack(dir?: string): Promise<Uint8Array>
}

// ============================================================================
// EXTENDED CONTEXT TYPES
// ============================================================================

export interface WithNpmContext extends WithFsContext {
  npm: NpmCapability
}

export interface WithBashContext extends WorkflowContext {
  bash: {
    run: (script: string) => Promise<BashResult>
    exec: (cmd: string, args?: string[], opts?: unknown) => Promise<BashResult>
    [key: string]: unknown
  }
}

export interface WithNpmBashContext extends WithBashContext, WithFsContext {
  npm: NpmCapability
}

// ============================================================================
// MIXIN TYPE
// ============================================================================

// Note: TypeScript requires any[] for mixin constructor patterns (TS2545)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = {}> = new (...args: any[]) => T

// ============================================================================
// REGISTRY FETCHER
// ============================================================================

/**
 * Default npm registry URL
 */
const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

/**
 * Registry fetcher interface
 */
interface RegistryFetcher {
  getPackageVersions(name: string): Promise<string[]>
  getPackageInfo(name: string, version: string): Promise<ResolvedPackage>
  getLatestVersion(name: string): Promise<string>
}

/**
 * Create a registry fetcher that fetches package metadata from npm registry.
 */
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
      headers: {
        Accept: 'application/json',
      },
    }).then((res) => {
      if (!res.ok) {
        throw new Error(`Package not found: ${name}`)
      }
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
      if (!versionData) {
        throw new Error(`Version ${version} not found for package ${name}`)
      }
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

/**
 * Create a tar header block (512 bytes)
 */
function createTarHeader(name: string, size: number, mode: number = 0o644): Uint8Array {
  const header = new Uint8Array(512)
  const encoder = new TextEncoder()

  // Name (100 bytes)
  const nameBytes = encoder.encode(name.slice(0, 99))
  header.set(nameBytes, 0)

  // Mode (8 bytes, octal)
  const modeStr = mode.toString(8).padStart(7, '0') + '\0'
  header.set(encoder.encode(modeStr), 100)

  // UID (8 bytes, octal)
  header.set(encoder.encode('0000000\0'), 108)

  // GID (8 bytes, octal)
  header.set(encoder.encode('0000000\0'), 116)

  // Size (12 bytes, octal)
  const sizeStr = size.toString(8).padStart(11, '0') + '\0'
  header.set(encoder.encode(sizeStr), 124)

  // Mtime (12 bytes, octal)
  const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0'
  header.set(encoder.encode(mtime), 136)

  // Checksum placeholder (8 spaces)
  header.set(encoder.encode('        '), 148)

  // Type flag (1 byte) - '0' for regular file
  header[156] = 0x30

  // USTAR indicator
  header.set(encoder.encode('ustar'), 257)
  header[262] = 0x00

  // Version
  header.set(encoder.encode('00'), 263)

  // Calculate checksum
  let checksum = 0
  for (let i = 0; i < 512; i++) {
    checksum += header[i]!
  }
  const checksumStr = checksum.toString(8).padStart(6, '0') + '\0 '
  header.set(encoder.encode(checksumStr), 148)

  return header
}

/**
 * Create a simple tarball from files.
 */
async function createTarball(files: Array<{ path: string; content: Uint8Array }>): Promise<Uint8Array> {
  const blocks: Uint8Array[] = []

  for (const file of files) {
    // Add header
    const header = createTarHeader(file.path, file.content.length)
    blocks.push(header)

    // Add content
    blocks.push(file.content)

    // Pad to 512-byte boundary
    const padding = 512 - (file.content.length % 512)
    if (padding < 512) {
      blocks.push(new Uint8Array(padding))
    }
  }

  // Add two empty blocks at end
  blocks.push(new Uint8Array(1024))

  // Calculate total size
  const totalSize = blocks.reduce((sum, block) => sum + block.length, 0)
  const result = new Uint8Array(totalSize)

  let offset = 0
  for (const block of blocks) {
    result.set(block, offset)
    offset += block.length
  }

  // Gzip compress using CompressionStream
  const stream = new Blob([result]).stream()
  const compressedStream = stream.pipeThrough(new CompressionStream('gzip'))
  const compressedBlob = await new Response(compressedStream).blob()
  return new Uint8Array(await compressedBlob.arrayBuffer())
}

// ============================================================================
// NPM MODULE IMPLEMENTATION
// ============================================================================

/**
 * NpmModule provides npm-like package management operations.
 *
 * Uses $.fs for storage and optionally $.bash for running scripts.
 */
export class NpmModule implements NpmCapability {
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
    // Handle 'latest' tag specially
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
    const result: InstallResult = {
      added: [],
      removed: [],
      updated: [],
    }

    // Ensure node_modules exists
    const nodeModulesExists = await this.fs.exists('/node_modules')
    if (!nodeModulesExists) {
      await this.fs.mkdir('/node_modules', { recursive: true })
    }

    if (name) {
      // Install specific package
      const resolvedVersion = version || (await this.resolve(name, 'latest'))
      const pkgInfo = await this.registryFetcher.getPackageInfo(name, resolvedVersion)

      // Check if already installed
      const pkgJsonPath = `/node_modules/${name}/package.json`
      const alreadyInstalled = await this.fs.exists(pkgJsonPath)

      if (alreadyInstalled) {
        const existingPkg = JSON.parse(await this.fs.read(pkgJsonPath)) as PackageJson
        if (existingPkg.version !== resolvedVersion) {
          result.updated.push({
            name,
            from: existingPkg.version || 'unknown',
            to: resolvedVersion,
          })
        } else {
          // Already at correct version
          return result
        }
      } else {
        result.added.push({ name, version: resolvedVersion })
      }

      // Create package directory
      await this.fs.mkdir(`/node_modules/${name}`, { recursive: true })

      // Write package.json
      await this.fs.write(
        pkgJsonPath,
        JSON.stringify(
          {
            name: pkgInfo.name,
            version: pkgInfo.version,
            dependencies: pkgInfo.dependencies,
          },
          null,
          2
        )
      )

      // Note: Full tarball extraction would require downloading and extracting
      // For now, we create the package.json which is sufficient for list() and lockfile()
    } else {
      // Install all from package.json
      const packageJsonExists = await this.fs.exists('/package.json')
      if (!packageJsonExists) {
        throw new Error('No package.json found')
      }

      const packageJson = JSON.parse(await this.fs.read('/package.json')) as PackageJson
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      }

      for (const [depName, depRange] of Object.entries(allDeps)) {
        const subResult = await this.install(depName, await this.resolve(depName, depRange))
        result.added.push(...subResult.added)
        result.updated.push(...subResult.updated)
      }
    }

    // Update package-lock.json
    await this.updateLockfile()

    return result
  }

  async list(): Promise<InstalledPackage[]> {
    const packages: InstalledPackage[] = []

    const nodeModulesExists = await this.fs.exists('/node_modules')
    if (!nodeModulesExists) {
      return packages
    }

    const entries = await this.fs.list('/node_modules')
    for (const entry of entries) {
      if (entry.isDirectory && !entry.name.startsWith('.')) {
        // Handle scoped packages (@org/pkg)
        if (entry.name.startsWith('@')) {
          const scopedEntries = await this.fs.list(`/node_modules/${entry.name}`)
          for (const scopedEntry of scopedEntries) {
            if (scopedEntry.isDirectory) {
              const pkgJsonPath = `/node_modules/${entry.name}/${scopedEntry.name}/package.json`
              if (await this.fs.exists(pkgJsonPath)) {
                try {
                  const pkgJson = JSON.parse(await this.fs.read(pkgJsonPath)) as PackageJson
                  packages.push({
                    name: `${entry.name}/${scopedEntry.name}`,
                    version: pkgJson.version || 'unknown',
                  })
                } catch {
                  // Skip invalid package.json
                }
              }
            }
          }
        } else {
          const pkgJsonPath = `/node_modules/${entry.name}/package.json`
          if (await this.fs.exists(pkgJsonPath)) {
            try {
              const pkgJson = JSON.parse(await this.fs.read(pkgJsonPath)) as PackageJson
              packages.push({
                name: entry.name,
                version: pkgJson.version || 'unknown',
              })
            } catch {
              // Skip invalid package.json
            }
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
      const content = await this.fs.read(lockfilePath)
      return JSON.parse(content) as LockFile
    }

    // Generate lockfile from current state
    return this.generateLockfile()
  }

  async run(script: string): Promise<BashResult> {
    if (!this.bash) {
      throw new Error('withNpm.run() requires withBash capability. Apply withBash mixin to use npm scripts.')
    }

    // Read package.json to get scripts
    const packageJsonExists = await this.fs.exists('/package.json')
    if (!packageJsonExists) {
      throw new Error('No package.json found')
    }

    const packageJson = JSON.parse(await this.fs.read('/package.json')) as PackageJson
    const scriptCommand = packageJson.scripts?.[script]

    if (!scriptCommand) {
      throw new Error(`Script "${script}" not found in package.json`)
    }

    // Execute the script using bash capability
    return this.bash.run(scriptCommand)
  }

  async pack(dir: string = '/'): Promise<Uint8Array> {
    // Read package.json from the directory
    const pkgJsonPath = dir === '/' ? '/package.json' : `${dir}/package.json`
    const pkgJsonExists = await this.fs.exists(pkgJsonPath)

    if (!pkgJsonExists) {
      throw new Error(`No package.json found in ${dir}`)
    }

    // Collect files to include
    const files: Array<{ path: string; content: Uint8Array }> = []

    // Helper to recursively collect files
    const collectFiles = async (currentDir: string, prefix: string) => {
      const entries = await this.fs.list(currentDir)
      for (const entry of entries) {
        const fullPath = currentDir === '/' ? `/${entry.name}` : `${currentDir}/${entry.name}`
        const tarPath = prefix ? `${prefix}/${entry.name}` : entry.name

        // Skip node_modules and common excludes
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue
        }

        if (entry.isDirectory) {
          await collectFiles(fullPath, tarPath)
        } else {
          const content = await this.fs.read(fullPath)
          files.push({
            path: `package/${tarPath}`,
            content: new TextEncoder().encode(content),
          })
        }
      }
    }

    await collectFiles(dir, '')

    // Create tarball
    return createTarball(files)
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private async updateLockfile(): Promise<void> {
    const lockfile = await this.generateLockfile()
    await this.fs.write('/package-lock.json', JSON.stringify(lockfile, null, 2))
  }

  private async generateLockfile(): Promise<LockFile> {
    const packages: Record<string, LockFileEntry> = {}

    // Get root package.json
    const packageJsonExists = await this.fs.exists('/package.json')
    let rootPackage: PackageJson = {}
    if (packageJsonExists) {
      rootPackage = JSON.parse(await this.fs.read('/package.json'))
    }

    // Add root package entry
    packages[''] = {
      version: rootPackage.version || '0.0.0',
      dependencies: rootPackage.dependencies,
    }

    // Add installed packages
    const installed = await this.list()
    for (const pkg of installed) {
      const pkgJsonPath = `/node_modules/${pkg.name}/package.json`
      if (await this.fs.exists(pkgJsonPath)) {
        const pkgJson = JSON.parse(await this.fs.read(pkgJsonPath)) as PackageJson
        packages[`node_modules/${pkg.name}`] = {
          version: pkg.version,
          dependencies: pkgJson.dependencies,
        }
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
// MIXIN OPTIONS
// ============================================================================

/**
 * Options for the withNpm mixin
 */
export interface WithNpmOptions {
  /** Custom registry URL (defaults to https://registry.npmjs.org) */
  registry?: string
}

// ============================================================================
// MIXIN IMPLEMENTATION
// ============================================================================

// Symbol for caching the npm module instance
const NPM_MODULE_CACHE = Symbol('npmModuleCache')

/**
 * Adds npm package management capability to a DO class.
 *
 * **Requires**: withFs capability (throws error if not present)
 * **Optional**: withBash capability (required for $.npm.run())
 *
 * @param Base - The base DO class (must have withFs applied)
 * @param options - Optional configuration
 * @returns Extended class with npm capability
 *
 * @example Basic usage
 * ```typescript
 * import { withNpm, withFs } from 'dotdo/mixins'
 * import { DO } from 'dotdo'
 *
 * class MyDO extends withNpm(withFs(DO)) {
 *   async install() {
 *     await this.$.npm.install('lodash', '4.17.21')
 *   }
 * }
 * ```
 *
 * @example With bash for scripts
 * ```typescript
 * import { withNpm, withBash, withFs } from 'dotdo/mixins'
 * import { DO } from 'dotdo'
 *
 * class BuildDO extends withNpm(withBash(withFs(DO))) {
 *   async build() {
 *     await this.$.npm.install()
 *     const result = await this.$.npm.run('build')
 *     return result.exitCode === 0
 *   }
 * }
 * ```
 */
export function withNpm<TBase extends Constructor<{ $: WithFsContext }>>(Base: TBase, options?: WithNpmOptions) {
  return class WithNpm extends Base {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static capabilities = [...((Base as any).capabilities || []), 'npm']

    /**
     * Check if this DO class has a specific capability
     */
    hasCapability(name: string): boolean {
      if (name === 'npm') return true
      // Check if parent class has the hasCapability method
      const baseProto = Base.prototype
      if (baseProto && typeof baseProto.hasCapability === 'function') {
        return baseProto.hasCapability.call(this, name)
      }
      return false
    }

    // Cache for the npm module instance
    /** @internal */ [NPM_MODULE_CACHE]?: NpmModule

    /**
     * Lazy-loaded NpmModule
     * @internal
     */
    get npmModule(): NpmModule {
      if (!this[NPM_MODULE_CACHE]) {
        // Get fs capability from $
        const fs = (this.$ as WithFsContext).fs
        if (!fs) {
          throw new Error('withNpm requires withFs capability. Apply withFs mixin first.')
        }

        // Get optional bash capability
        const bash = (this.$ as unknown as WithBashContext).bash

        this[NPM_MODULE_CACHE] = new NpmModule(fs, {
          bash: bash?.run ? { run: (script: string) => bash.run(script) } : undefined,
          registry: options?.registry,
        })
      }
      return this[NPM_MODULE_CACHE]
    }

    // TypeScript requires any[] for mixin constructors (TS2545)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)

      // Verify fs capability is available
      const fs = (this.$ as WithFsContext).fs
      if (!fs) {
        throw new Error('withNpm requires withFs capability. Apply withFs mixin first.')
      }

      // Extend $ to include npm capability
      const originalContext = this.$
      const self = this

      // Create a new proxy that extends the original $ with npm
      this.$ = new Proxy(originalContext as WithNpmContext, {
        get(target, prop: string | symbol) {
          if (prop === 'npm') {
            return self.npmModule
          }
          // Forward to original context
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const value = (target as any)[prop]
          if (typeof value === 'function') {
            // Only bind if it has a bind method (not a Proxy or capability object)
            if (typeof value.bind === 'function') {
              // Don't bind capability functions that have custom properties
              // (like $.bash which is both callable AND has .exec, .run, etc.)
              const customProps = Object.getOwnPropertyNames(value).filter(
                (p) => p !== 'length' && p !== 'name' && p !== 'prototype'
              )
              if (customProps.length > 0) {
                // This is a capability object with methods, return as-is
                return value
              }
              return value.bind(target)
            }
          }
          return value
        },
      })
    }
  }
}
