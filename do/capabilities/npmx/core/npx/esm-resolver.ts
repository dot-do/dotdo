/**
 * ESM.sh Bundle Resolver
 *
 * Resolves npm packages to esm.sh URLs for Tier 1 execution:
 * - Package specifier to esm.sh URL conversion
 * - Version resolution via esm.sh redirects
 * - Binary/CLI entry point resolution
 * - Bundle caching
 *
 * @module npmx/core/npx/esm-resolver
 */

import { ValidationError } from '../errors/index.js'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Options for ESM bundle resolution
 */
export interface EsmResolveOptions {
  /** Target ES version (default: es2022) */
  target?: string
  /** Enable development mode (source maps, etc.) */
  dev?: boolean
  /** Custom esm.sh base URL */
  baseUrl?: string
  /** Package version (defaults to latest) */
  version?: string
  /** Timeout for fetch operations */
  timeout?: number
  /** Cache control */
  cache?: 'default' | 'no-cache' | 'force-cache'
}

/**
 * Resolved ESM bundle information
 */
export interface EsmBundle {
  /** Full URL to the ESM bundle */
  url: string
  /** Package name */
  package: string
  /** Resolved version */
  version: string
  /** Entry point path within the package */
  entry: string
  /** Whether this was served from cache */
  cached: boolean
  /** Bundle size in bytes (if known) */
  size?: number
  /** Dependencies included in the bundle */
  bundledDeps?: string[]
}

/**
 * Binary resolution result
 */
export interface BinaryResolution {
  /** Binary name */
  name: string
  /** Path to the binary entry point */
  path: string
  /** Full esm.sh URL for the binary */
  url: string
  /** Package that provides this binary */
  package: string
  /** Package version */
  version: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_BASE_URL = 'https://esm.sh'
const DEFAULT_TIMEOUT = 30000
const REGISTRY_URL = 'https://registry.npmjs.org'

// ============================================================================
// CACHE
// ============================================================================

/**
 * Cache for ESM bundles
 */
export class EsmBundleCache {
  private cache = new Map<string, EsmBundle>()

  get(key: string): EsmBundle | undefined {
    return this.cache.get(key)
  }

  set(key: string, bundle: EsmBundle): void {
    this.cache.set(key, bundle)
  }

  has(key: string): boolean {
    return this.cache.has(key)
  }

  clear(): void {
    this.cache.clear()
  }

  size(): number {
    return this.cache.size
  }
}

// Global cache instance
const bundleCache = new EsmBundleCache()

// ============================================================================
// URL BUILDING
// ============================================================================

/**
 * Parse package specifier into name, version, and subpath
 */
function parsePackageSpec(packageSpec: string): {
  name: string
  version?: string
  subpath?: string
} {
  let spec = packageSpec.trim()
  let name: string
  let version: string | undefined
  let subpath: string | undefined

  // Handle scoped packages
  if (spec.startsWith('@')) {
    const scopeSlash = spec.indexOf('/')
    if (scopeSlash === -1) {
      throw new ValidationError('Invalid scoped package name', { package: packageSpec })
    }

    // Check for version after scope
    const afterScope = spec.substring(scopeSlash + 1)
    const versionAt = afterScope.indexOf('@')
    const subpathSlash = afterScope.indexOf('/')

    if (versionAt !== -1 && (subpathSlash === -1 || versionAt < subpathSlash)) {
      // Has version
      name = spec.substring(0, scopeSlash + 1 + versionAt)
      const rest = afterScope.substring(versionAt + 1)
      const restSlash = rest.indexOf('/')
      if (restSlash !== -1) {
        version = rest.substring(0, restSlash)
        subpath = rest.substring(restSlash)
      } else {
        version = rest
      }
    } else if (subpathSlash !== -1) {
      // Has subpath but no version
      name = spec.substring(0, scopeSlash + 1 + subpathSlash)
      subpath = afterScope.substring(subpathSlash)
    } else {
      name = spec
    }
  } else {
    // Non-scoped package
    const atIndex = spec.indexOf('@')
    const slashIndex = spec.indexOf('/')

    if (atIndex !== -1 && (slashIndex === -1 || atIndex < slashIndex)) {
      // Has version
      name = spec.substring(0, atIndex)
      const rest = spec.substring(atIndex + 1)
      const restSlash = rest.indexOf('/')
      if (restSlash !== -1) {
        version = rest.substring(0, restSlash)
        subpath = rest.substring(restSlash)
      } else {
        version = rest
      }
    } else if (slashIndex !== -1) {
      // Has subpath but no version
      name = spec.substring(0, slashIndex)
      subpath = spec.substring(slashIndex)
    } else {
      name = spec
    }
  }

  return { name, version, subpath }
}

/**
 * Build esm.sh URL from package specifier
 */
export function buildEsmShUrl(
  packageSpec: string,
  options?: EsmResolveOptions
): string {
  if (!packageSpec || packageSpec.trim() === '') {
    throw new ValidationError('Package specifier cannot be empty', { package: packageSpec })
  }

  // Validate package name (no path traversal)
  if (packageSpec.includes('..') || packageSpec.includes('%')) {
    throw new ValidationError('Invalid package name', { package: packageSpec })
  }

  const baseUrl = options?.baseUrl || DEFAULT_BASE_URL
  const { name, version: parsedVersion, subpath } = parsePackageSpec(packageSpec)

  // Use version from options if not in specifier
  const version = parsedVersion || options?.version

  // Build URL path
  let urlPath = name
  if (version) {
    urlPath += `@${version}`
  }
  if (subpath) {
    urlPath += subpath
  }

  // Build query parameters
  const params: string[] = []

  if (options?.target) {
    params.push(`target=${options.target}`)
  }

  if (options?.dev) {
    params.push('dev')
  }

  // Construct final URL
  let url = `${baseUrl}/${urlPath}`
  if (params.length > 0) {
    url += `?${params.join('&')}`
  }

  return url
}

// ============================================================================
// BUNDLE RESOLUTION
// ============================================================================

/**
 * Extract version from esm.sh redirect URL or response headers
 */
function extractVersionFromResponse(
  response: Response,
  packageName: string,
  specVersion?: string
): string {
  // If a specific version was provided in the spec (not 'latest'), use it
  if (specVersion && specVersion !== 'latest' && /^\d+\.\d+\.\d+/.test(specVersion)) {
    return specVersion
  }

  // Try to extract from X-Esm-Id header (most reliable)
  const esmId = response.headers.get('x-esm-id')
  if (esmId) {
    // Format: /stable/package@version/... or /v123/package@version/...
    const match = esmId.match(/@(\d+\.\d+\.\d+[^/]*)/)
    if (match) {
      return match[1]
    }
  }

  // Try to extract from final URL (after redirects)
  const finalUrl = response.url
  // Escape package name for regex (handle scoped packages)
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('/', '\\/')
  const versionMatch = finalUrl.match(new RegExp(`${escapedName}@(\\d+\\.\\d+\\.\\d+[^/?]*)`))
  if (versionMatch) {
    return versionMatch[1]
  }

  // Try Content-Location header
  const contentLocation = response.headers.get('content-location')
  if (contentLocation) {
    const locMatch = contentLocation.match(/@(\d+\.\d+\.\d+[^/]*)/)
    if (locMatch) {
      return locMatch[1]
    }
  }

  // Default to 'latest' if version can't be determined
  return specVersion || 'latest'
}

/**
 * Fetch package metadata from npm registry to get version and metadata
 */
async function fetchPackageMetadata(
  packageName: string,
  version?: string,
  timeout?: number
): Promise<{ version: string; entry?: string; bundledDeps?: string[] }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout ?? DEFAULT_TIMEOUT)

  try {
    // Fetch from npm registry
    const registryUrl = version && version !== 'latest'
      ? `${REGISTRY_URL}/${encodeURIComponent(packageName)}/${version}`
      : `${REGISTRY_URL}/${encodeURIComponent(packageName)}/latest`

    const response = await fetch(registryUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      // Fallback: try to get latest version from package info
      if (version === 'latest' || !version) {
        const pkgResponse = await fetch(`${REGISTRY_URL}/${encodeURIComponent(packageName)}`, {
          headers: { Accept: 'application/json' },
        })
        if (pkgResponse.ok) {
          const pkgData = await pkgResponse.json() as {
            'dist-tags'?: { latest?: string }
          }
          if (pkgData['dist-tags']?.latest) {
            return { version: pkgData['dist-tags'].latest }
          }
        }
      }
      return { version: version || 'latest' }
    }

    const data = await response.json() as {
      version?: string
      main?: string
      module?: string
      exports?: unknown
      bundledDependencies?: string[]
      bundleDependencies?: string[]
    }

    return {
      version: data.version || version || 'latest',
      entry: data.module || data.main || 'index.js',
      bundledDeps: data.bundledDependencies || data.bundleDependencies,
    }
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      return { version: version || 'latest' }
    }
    return { version: version || 'latest' }
  }
}

/**
 * Resolve a package to an esm.sh bundle
 */
export async function resolveEsmBundle(
  packageSpec: string,
  options?: EsmResolveOptions
): Promise<EsmBundle> {
  if (!packageSpec || packageSpec.trim() === '') {
    throw new ValidationError('Package specifier cannot be empty', { package: packageSpec })
  }

  // Validate package name
  if (packageSpec.includes('..') || packageSpec.includes('%')) {
    throw new ValidationError('Invalid package name', { package: packageSpec })
  }

  const { name, version: specVersion, subpath } = parsePackageSpec(packageSpec)

  // Check cache first (use full spec as cache key to avoid pollution)
  const cacheKey = `${name}@${specVersion || options?.version || 'latest'}${subpath || ''}`
  const cached = bundleCache.get(cacheKey)
  if (cached && options?.cache !== 'no-cache') {
    return { ...cached, cached: true }
  }

  const url = buildEsmShUrl(packageSpec, options)
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT

  // Fetch with timeout using GET (HEAD doesn't always follow redirects properly)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      // Check for X-Esm-Error header
      const esmError = response.headers.get('x-esm-error')
      if (esmError) {
        throw new ValidationError(`esm.sh error: ${esmError}`, { package: packageSpec })
      }
      if (response.status === 404) {
        throw new ValidationError(`Package not found: ${packageSpec}`, { package: packageSpec })
      }
      throw new ValidationError(`Failed to resolve package: ${response.status}`, { package: packageSpec })
    }

    // Extract resolved version from response
    const effectiveVersion = specVersion || options?.version
    let resolvedVersion = extractVersionFromResponse(response, name, effectiveVersion)

    // If we still have 'latest', fetch metadata from npm registry to get actual version
    let entry = 'index.js'
    let bundledDeps: string[] | undefined

    if (resolvedVersion === 'latest' || !resolvedVersion.match(/^\d+\.\d+\.\d+/)) {
      const metadata = await fetchPackageMetadata(name, undefined, timeout)
      resolvedVersion = metadata.version
      entry = metadata.entry || entry
      bundledDeps = metadata.bundledDeps
    } else {
      // Fetch metadata for entry point and bundledDeps
      const metadata = await fetchPackageMetadata(name, resolvedVersion, timeout)
      entry = metadata.entry || entry
      bundledDeps = metadata.bundledDeps
    }

    const bundle: EsmBundle = {
      url: subpath
        ? buildEsmShUrl(`${name}@${resolvedVersion}${subpath}`, options)
        : buildEsmShUrl(`${name}@${resolvedVersion}`, options),
      package: name,
      version: resolvedVersion,
      entry,
      cached: false,
      bundledDeps,
    }

    // Cache the result with the resolved version
    bundleCache.set(`${name}@${resolvedVersion}${subpath || ''}`, bundle)

    return bundle
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ValidationError('Request timeout while resolving package', { package: packageSpec })
    }

    throw error
  }
}

// ============================================================================
// BINARY RESOLUTION
// ============================================================================

/**
 * Resolve a binary from a package
 */
export async function resolveBinary(
  packageSpec: string,
  binaryName?: string,
  options?: EsmResolveOptions
): Promise<BinaryResolution> {
  const { name, version: specVersion } = parsePackageSpec(packageSpec)

  // First resolve the bundle to get version
  const bundle = await resolveEsmBundle(packageSpec, options)

  // Fetch package.json from npm registry (not esm.sh, which returns ESM code)
  const pkgJsonUrl = `${REGISTRY_URL}/${encodeURIComponent(name)}/${bundle.version}`

  const timeout = options?.timeout ?? DEFAULT_TIMEOUT
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(pkgJsonUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new ValidationError(`Failed to fetch package.json for ${name}`, { package: name })
    }

    const pkgJson = await response.json() as { bin?: string | Record<string, string> }

    if (!pkgJson.bin) {
      throw new ValidationError(`Package ${name} has no binary`, { package: name })
    }

    // Handle bin as string (single binary with package name)
    if (typeof pkgJson.bin === 'string') {
      const resolvedBinaryName = binaryName || name.split('/').pop()! // Use package name
      return {
        name: resolvedBinaryName,
        path: pkgJson.bin,
        url: buildEsmShUrl(`${name}@${bundle.version}/${pkgJson.bin}`, options),
        package: name,
        version: bundle.version,
      }
    }

    // Handle bin as object
    const binEntries = Object.entries(pkgJson.bin)
    if (binEntries.length === 0) {
      throw new ValidationError(`Package ${name} has no binary`, { package: name })
    }

    // If no binary name specified, use first one
    const targetBinaryName = binaryName || binEntries[0][0]
    const binaryPath = pkgJson.bin[targetBinaryName]

    if (!binaryPath) {
      throw new ValidationError(`Binary '${targetBinaryName}' not found in package ${name}`, { package: name })
    }

    return {
      name: targetBinaryName,
      path: binaryPath,
      url: buildEsmShUrl(`${name}@${bundle.version}/${binaryPath}`, options),
      package: name,
      version: bundle.version,
    }
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof ValidationError) {
      throw error
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ValidationError('Request timeout while resolving binary', { package: name })
    }

    throw error
  }
}

// ============================================================================
// BUNDLE FETCHING
// ============================================================================

/**
 * Fetch an ESM bundle from esm.sh
 */
export async function fetchEsmBundle(
  url: string,
  options?: { timeout?: number }
): Promise<string> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new ValidationError(`Failed to fetch bundle: ${response.status} ${response.statusText}`)
    }

    return await response.text()
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ValidationError('Request timeout while fetching bundle')
    }

    throw error
  }
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

/**
 * Clear the ESM bundle cache
 */
export function clearEsmBundleCache(): void {
  bundleCache.clear()
}

/**
 * Get ESM bundle cache size
 */
export function getEsmBundleCacheSize(): number {
  return bundleCache.size()
}

/**
 * Create a new isolated cache instance
 */
export function createEsmBundleCache(): EsmBundleCache {
  return new EsmBundleCache()
}
