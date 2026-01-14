/**
 * Native npm Commands via npmx Registry Client
 *
 * Provides native execution of simple npm commands that only require
 * registry access (no file system writes or script execution):
 *
 * - npm view/info: Get package metadata
 * - npm search: Search packages
 * - npm pack (download only): Download tarball
 * - npm version (query): Get available versions
 *
 * These commands can run in Tier 1/3 without RPC to npm.do service,
 * reducing latency for simple operations.
 *
 * For complex operations that require file system writes (install, ci),
 * script execution (run, test, build), or full npm CLI features,
 * the system falls back to Tier 2 RPC.
 *
 * @module bashx/do/commands/npm-native
 */

import {
  NpmRegistryClient,
  type PackageMetadata,
  type PackageVersion,
  type SearchResult,
  type NpmRegistryClientOptions,
} from '../../npmx/registry-client.js'
import { parsePackageSpec, resolveVersion, getLatestVersion } from '../../npmx/version-resolver.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result from native npm command execution
 */
export interface NpmNativeResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Options for npm native execution
 */
export interface NpmNativeOptions {
  /** Custom registry URL */
  registry?: string
  /** Authentication token */
  token?: string
  /** Enable caching */
  cache?: boolean
  /** Timeout in milliseconds */
  timeout?: number
}

/**
 * npm view output format
 */
export type NpmViewFormat = 'json' | 'text'

/**
 * Parsed npm view arguments
 */
export interface NpmViewArgs {
  packageSpec: string
  field?: string
  json: boolean
}

/**
 * Parsed npm search arguments
 */
export interface NpmSearchArgs {
  query: string
  long: boolean
  json: boolean
  limit?: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * npm commands that can be executed natively via registry client
 */
export const NATIVE_NPM_COMMANDS = new Set([
  'view',
  'info',    // alias for view
  'show',    // alias for view
  'search',
  'find',    // alias for search
  's',       // alias for search
  'pack',    // download-only mode
])

/**
 * npm commands that require RPC (file writes, scripts, etc.)
 */
export const RPC_ONLY_NPM_COMMANDS = new Set([
  'install',
  'i',
  'ci',
  'add',
  'remove',
  'uninstall',
  'rm',
  'run',
  'run-script',
  'test',
  't',
  'start',
  'build',
  'publish',
  'audit',
  'update',
  'outdated',
  'link',
  'unlink',
  'init',
  'create',
  'exec',      // npx-like
  'pkg',
  'config',
  'cache',
  'dedupe',
  'prune',
])

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

/**
 * Parse npm view command arguments
 */
export function parseNpmViewArgs(args: string[]): NpmViewArgs {
  let packageSpec = ''
  let field: string | undefined
  let json = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') {
      json = true
    } else if (arg === '-j') {
      json = true
    } else if (!arg.startsWith('-')) {
      if (!packageSpec) {
        packageSpec = arg
      } else if (!field) {
        // Second non-flag is field selector
        field = arg
      }
    }
  }

  return { packageSpec, field, json }
}

/**
 * Parse npm search command arguments
 */
export function parseNpmSearchArgs(args: string[]): NpmSearchArgs {
  const queryParts: string[] = []
  let long = false
  let json = false
  let limit: number | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--long' || arg === '-l') {
      long = true
    } else if (arg === '--json') {
      json = true
    } else if (arg === '-j') {
      json = true
    } else if (arg === '--searchlimit' || arg === '--limit') {
      if (args[i + 1]) {
        limit = parseInt(args[++i], 10)
      }
    } else if (arg.startsWith('--searchlimit=') || arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10)
    } else if (!arg.startsWith('-')) {
      queryParts.push(arg)
    }
  }

  return {
    query: queryParts.join(' '),
    long,
    json,
    limit,
  }
}

// ============================================================================
// FORMATTING HELPERS
// ============================================================================

/**
 * Format package metadata for npm view text output
 */
function formatPackageViewText(pkg: PackageMetadata, version?: PackageVersion): string {
  const lines: string[] = []

  const v = version || pkg.versions[pkg['dist-tags'].latest]
  if (!v) {
    return `${pkg.name}\n`
  }

  // Header line: name@version | license | deps | versions
  const depsCount = Object.keys(v.dependencies || {}).length
  const versionsCount = Object.keys(pkg.versions).length
  const license = v.license || 'UNLICENSED'
  lines.push(`${v.name}@${v.version} | ${license} | deps: ${depsCount === 0 ? 'none' : depsCount} | versions: ${versionsCount}`)

  // Description
  if (v.description) {
    lines.push(v.description)
  }

  // Keywords
  if (v.keywords && v.keywords.length > 0) {
    lines.push(`keywords: ${v.keywords.join(', ')}`)
  }

  // Tarball
  if (v.dist?.tarball) {
    lines.push('')
    lines.push(`dist`)
    lines.push(`.tarball: ${v.dist.tarball}`)
    if (v.dist.integrity) {
      lines.push(`.integrity: ${v.dist.integrity}`)
    }
    if (v.dist.shasum) {
      lines.push(`.shasum: ${v.dist.shasum}`)
    }
  }

  // Dependencies
  const deps = v.dependencies || {}
  if (Object.keys(deps).length > 0) {
    lines.push('')
    lines.push('dependencies:')
    for (const [name, range] of Object.entries(deps)) {
      lines.push(`${name}: ${range}`)
    }
  }

  // Maintainers
  if (v.maintainers && v.maintainers.length > 0) {
    lines.push('')
    lines.push('maintainers:')
    for (const m of v.maintainers) {
      lines.push(`- ${m.name}${m.email ? ` <${m.email}>` : ''}`)
    }
  }

  // Dist-tags
  lines.push('')
  lines.push('dist-tags:')
  for (const [tag, ver] of Object.entries(pkg['dist-tags'])) {
    lines.push(`${tag}: ${ver}`)
  }

  // Recent versions (last 10)
  const publishedVersions = Object.keys(pkg.versions)
  const recentVersions = publishedVersions.slice(-10).reverse()
  if (recentVersions.length > 0) {
    lines.push('')
    lines.push('published over 10 versions')
    if (pkg.time) {
      for (const ver of recentVersions.slice(0, 5)) {
        const published = pkg.time[ver]
        if (published) {
          lines.push(`${ver}: ${new Date(published).toISOString()}`)
        }
      }
    }
  }

  return lines.join('\n') + '\n'
}

/**
 * Extract a specific field from package version
 */
function extractField(pkg: PackageVersion, field: string): unknown {
  const parts = field.split('.')
  let current: unknown = pkg

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Format search results for text output
 */
function formatSearchResultsText(results: SearchResult, long: boolean): string {
  if (results.objects.length === 0) {
    return 'No results found\n'
  }

  const lines: string[] = []

  if (long) {
    // Long format: more details per package
    for (const { package: pkg, score } of results.objects) {
      lines.push(`${pkg.name}`)
      if (pkg.description) {
        lines.push(`  ${pkg.description}`)
      }
      lines.push(`  Version: ${pkg.version}`)
      if (pkg.author?.name) {
        lines.push(`  Author: ${pkg.author.name}`)
      }
      if (pkg.keywords && pkg.keywords.length > 0) {
        lines.push(`  Keywords: ${pkg.keywords.slice(0, 5).join(', ')}`)
      }
      lines.push(`  Score: ${score.final.toFixed(4)}`)
      lines.push('')
    }
  } else {
    // Short format: tabular
    // NAME     DESCRIPTION                           AUTHOR      DATE     VERSION
    lines.push('NAME                           DESCRIPTION                                                AUTHOR         VERSION')

    for (const { package: pkg } of results.objects) {
      const name = pkg.name.padEnd(30).slice(0, 30)
      const desc = (pkg.description || '').padEnd(58).slice(0, 58)
      const author = (pkg.author?.name || '').padEnd(14).slice(0, 14)
      const version = pkg.version
      lines.push(`${name} ${desc} ${author} ${version}`)
    }
  }

  return lines.join('\n') + '\n'
}

// ============================================================================
// COMMAND EXECUTION
// ============================================================================

/**
 * Create npm registry client from options
 */
export function createRegistryClient(options?: NpmNativeOptions): NpmRegistryClient {
  const clientOptions: NpmRegistryClientOptions = {
    registry: options?.registry,
    timeout: options?.timeout ?? 30000,
    cache: options?.cache ?? true,
  }

  if (options?.token) {
    clientOptions.auth = { token: options.token }
  }

  return new NpmRegistryClient(clientOptions)
}

/**
 * Execute npm view/info/show command
 *
 * Examples:
 * - npm view lodash                    -> show latest version info
 * - npm view lodash@4.17.0            -> show specific version
 * - npm view lodash version           -> show only version field
 * - npm view lodash versions          -> show all versions
 * - npm view lodash dependencies      -> show dependencies
 * - npm view lodash --json            -> output as JSON
 */
export async function executeNpmView(
  args: string[],
  options?: NpmNativeOptions
): Promise<NpmNativeResult> {
  const { packageSpec, field, json } = parseNpmViewArgs(args)

  if (!packageSpec) {
    return {
      stdout: '',
      stderr: 'Usage: npm view <package>[@version] [field]\n',
      exitCode: 1,
    }
  }

  const client = createRegistryClient(options)

  try {
    // Parse package spec (handles scopes, versions, ranges)
    const spec = parsePackageSpec(packageSpec)

    // Fetch package metadata
    const metadata = await client.getPackageMetadata(spec.name)

    // Resolve version
    let targetVersion: string
    if (spec.version) {
      targetVersion = spec.version
    } else if (spec.tag) {
      const tagVersion = metadata['dist-tags'][spec.tag]
      if (!tagVersion) {
        return {
          stdout: '',
          stderr: `npm ERR! 404 tag '${spec.tag}' not found for ${spec.name}\n`,
          exitCode: 1,
        }
      }
      targetVersion = tagVersion
    } else if (spec.range) {
      const availableVersions = Object.keys(metadata.versions)
      const resolved = resolveVersion(availableVersions, spec.range)
      if (!resolved) {
        return {
          stdout: '',
          stderr: `npm ERR! 404 No matching version found for ${packageSpec}\n`,
          exitCode: 1,
        }
      }
      targetVersion = resolved
    } else {
      // Default to latest
      targetVersion = metadata['dist-tags'].latest || getLatestVersion(Object.keys(metadata.versions))
    }

    const version = metadata.versions[targetVersion]
    if (!version) {
      return {
        stdout: '',
        stderr: `npm ERR! 404 version '${targetVersion}' not found for ${spec.name}\n`,
        exitCode: 1,
      }
    }

    // Handle field extraction
    if (field) {
      // Special case: versions field shows all versions
      if (field === 'versions') {
        const allVersions = Object.keys(metadata.versions)
        if (json) {
          return {
            stdout: JSON.stringify(allVersions, null, 2) + '\n',
            stderr: '',
            exitCode: 0,
          }
        }
        return {
          stdout: allVersions.join('\n') + '\n',
          stderr: '',
          exitCode: 0,
        }
      }

      // Special case: time field shows publish times
      if (field === 'time' && metadata.time) {
        if (json) {
          return {
            stdout: JSON.stringify(metadata.time, null, 2) + '\n',
            stderr: '',
            exitCode: 0,
          }
        }
        const timeLines = Object.entries(metadata.time)
          .map(([ver, time]) => `${ver}: ${time}`)
          .join('\n')
        return {
          stdout: timeLines + '\n',
          stderr: '',
          exitCode: 0,
        }
      }

      // Extract specific field
      const fieldValue = extractField(version, field)
      if (fieldValue === undefined) {
        return {
          stdout: 'undefined\n',
          stderr: '',
          exitCode: 0,
        }
      }

      if (json || typeof fieldValue === 'object') {
        return {
          stdout: JSON.stringify(fieldValue, null, 2) + '\n',
          stderr: '',
          exitCode: 0,
        }
      }

      return {
        stdout: String(fieldValue) + '\n',
        stderr: '',
        exitCode: 0,
      }
    }

    // Full package view
    if (json) {
      return {
        stdout: JSON.stringify(version, null, 2) + '\n',
        stderr: '',
        exitCode: 0,
      }
    }

    return {
      stdout: formatPackageViewText(metadata, version),
      stderr: '',
      exitCode: 0,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Package not found')) {
      return {
        stdout: '',
        stderr: `npm ERR! 404 Not Found - ${packageSpec}\n`,
        exitCode: 1,
      }
    }
    return {
      stdout: '',
      stderr: `npm ERR! ${message}\n`,
      exitCode: 1,
    }
  }
}

/**
 * Execute npm search command
 *
 * Examples:
 * - npm search lodash               -> search for lodash
 * - npm search react --json         -> search in JSON format
 * - npm search utility --long       -> detailed output
 * - npm search cli --limit=20       -> limit results
 */
export async function executeNpmSearch(
  args: string[],
  options?: NpmNativeOptions
): Promise<NpmNativeResult> {
  const { query, long, json, limit } = parseNpmSearchArgs(args)

  if (!query) {
    return {
      stdout: '',
      stderr: 'Usage: npm search <query>\n',
      exitCode: 1,
    }
  }

  const client = createRegistryClient(options)

  try {
    const results = await client.search(query, { size: limit || 20 })

    if (json) {
      return {
        stdout: JSON.stringify(results.objects, null, 2) + '\n',
        stderr: '',
        exitCode: 0,
      }
    }

    return {
      stdout: formatSearchResultsText(results, long),
      stderr: '',
      exitCode: 0,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      stdout: '',
      stderr: `npm ERR! ${message}\n`,
      exitCode: 1,
    }
  }
}

/**
 * Execute npm pack command (download tarball only, no extraction)
 *
 * This is a simplified version that downloads the tarball to memory
 * and returns info about it. Full extraction requires file system access.
 *
 * Examples:
 * - npm pack lodash                  -> download lodash tarball
 * - npm pack lodash@4.17.21          -> specific version
 * - npm pack lodash --json           -> JSON output with tarball info
 */
export async function executeNpmPack(
  args: string[],
  options?: NpmNativeOptions
): Promise<NpmNativeResult> {
  const { packageSpec, json } = parseNpmViewArgs(args)

  if (!packageSpec) {
    return {
      stdout: '',
      stderr: 'Usage: npm pack <package>[@version]\n',
      exitCode: 1,
    }
  }

  const client = createRegistryClient(options)

  try {
    const spec = parsePackageSpec(packageSpec)
    const metadata = await client.getPackageMetadata(spec.name)

    // Resolve version
    let targetVersion: string
    if (spec.version) {
      targetVersion = spec.version
    } else if (spec.tag) {
      targetVersion = metadata['dist-tags'][spec.tag] || metadata['dist-tags'].latest
    } else if (spec.range) {
      const resolved = resolveVersion(Object.keys(metadata.versions), spec.range)
      if (!resolved) {
        return {
          stdout: '',
          stderr: `npm ERR! 404 No matching version found for ${packageSpec}\n`,
          exitCode: 1,
        }
      }
      targetVersion = resolved
    } else {
      targetVersion = metadata['dist-tags'].latest
    }

    const version = metadata.versions[targetVersion]
    if (!version) {
      return {
        stdout: '',
        stderr: `npm ERR! 404 version not found: ${targetVersion}\n`,
        exitCode: 1,
      }
    }

    // Download tarball
    const tarball = await client.downloadTarball(spec.name, targetVersion, {
      verifyIntegrity: true,
    })

    const filename = `${spec.name.replace('/', '-').replace('@', '')}-${targetVersion}.tgz`
    const size = tarball.byteLength

    if (json) {
      return {
        stdout: JSON.stringify({
          filename,
          size,
          name: spec.name,
          version: targetVersion,
          integrity: version.dist.integrity,
          shasum: version.dist.shasum,
        }, null, 2) + '\n',
        stderr: '',
        exitCode: 0,
      }
    }

    return {
      stdout: `${filename}\n`,
      stderr: '',
      exitCode: 0,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      stdout: '',
      stderr: `npm ERR! ${message}\n`,
      exitCode: 1,
    }
  }
}

/**
 * Execute native npm command
 *
 * Routes to the appropriate handler based on the npm subcommand.
 * Returns null if the command should be handled by RPC instead.
 */
export async function executeNpmNative(
  _command: string,
  args: string[],
  options?: NpmNativeOptions
): Promise<NpmNativeResult | null> {
  const subcommand = args[0] || ''
  const subArgs = args.slice(1)

  switch (subcommand) {
    case 'view':
    case 'info':
    case 'show':
    case 'v':
      return executeNpmView(subArgs, options)

    case 'search':
    case 'find':
    case 's':
      return executeNpmSearch(subArgs, options)

    case 'pack':
      // Only handle if --dry-run or no filesystem writes needed
      // Full pack with file extraction needs RPC
      if (args.includes('--dry-run') || args.includes('--json')) {
        return executeNpmPack(subArgs, options)
      }
      return null // Fall through to RPC

    default:
      // Command not supported natively, return null to indicate RPC fallback
      return null
  }
}

/**
 * Check if an npm command can be executed natively
 */
export function canExecuteNativeNpm(args: string[]): boolean {
  const subcommand = args[0] || ''

  // Check if subcommand is in native commands set
  if (NATIVE_NPM_COMMANDS.has(subcommand)) {
    // npm pack needs special handling - only native if --dry-run or --json
    if (subcommand === 'pack') {
      return args.includes('--dry-run') || args.includes('--json')
    }
    return true
  }

  return false
}

/**
 * Extract npm subcommand from full command string
 */
export function extractNpmSubcommand(command: string): string {
  // npm view lodash -> view
  // npm install -D typescript -> install
  const parts = command.trim().split(/\s+/)
  if (parts.length < 2) return ''

  // Skip 'npm' prefix
  const cmd = parts[0].toLowerCase()
  if (cmd !== 'npm') return ''

  return parts[1] || ''
}
