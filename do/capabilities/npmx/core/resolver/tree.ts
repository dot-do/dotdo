/**
 * Dependency Tree Builder
 *
 * Builds a complete dependency tree with:
 * - Flat dependency resolution
 * - Version conflict resolution (newest compatible)
 * - Peer dependency handling
 * - Optional dependency handling
 * - Circular dependency detection
 * - Hoisting and deduplication
 * - devDependencies separation
 * - bundledDependencies support
 *
 * Performance optimizations:
 * - Parallel resolution of independent dependencies
 * - Batched registry fetches with concurrency control
 * - Reduced object allocations in hot paths
 * - Optimized version satisfaction checks (using cached semver)
 */

import { satisfies, maxSatisfying, compare as semverCompare, valid as semverValid } from '../semver'
import { ResolutionError } from '../errors'
import type {
  DependencyTree,
  DependencyNode,
  ResolvedPackage,
  ResolutionOptions,
  ResolutionWarning,
  ResolutionStats,
  PackageManifest,
  RegistryFetcher,
} from './types'

// Semver compatibility shim (matches npm semver API)
const semver = {
  satisfies,
  maxSatisfying,
  valid: semverValid,
  compare: semverCompare,
  gt: (a: string, b: string) => semverCompare(a, b) === 1,
}

// Concurrency limit for parallel resolution
const DEFAULT_CONCURRENCY = 16

interface ResolveContext {
  /** Currently resolving packages (for cycle detection) */
  resolvingStack: Set<string>
  /** Already resolved packages: key is "name@version" */
  resolvedCache: Map<string, ResolvedPackage>
  /** Version resolution cache: "name@range" -> resolved version */
  versionCache: Map<string, string>
  /** All resolved nodes by name@version */
  allResolvedNodes: Map<string, DependencyNode>
  /** Track dependency requirements: name -> requester -> { range, version } */
  depRequirements: Map<string, Map<string, { range: string; version: string }>>
  /** Packages needed at each level */
  requirements: Map<string, Set<string>> // name -> set of required ranges
  /** Track if package is dev-only */
  devPackages: Set<string>
  /** Track optional packages */
  optionalPackages: Set<string>
  /** Detected circular dependencies */
  circularDeps: Map<string, string[]>
  /** Warnings collected during resolution */
  warnings: ResolutionWarning[]
  /** Registry fetch count */
  fetchCount: number
  /** Root level dependencies (for peer checking) */
  rootDeps: Map<string, string>
  /** Available versions cache per package */
  versionsCache: Map<string, string[]>
  /** Pending version fetches (for deduplication) */
  pendingVersionFetches: Map<string, Promise<string[]>>
  /** Pending package info fetches (for deduplication) */
  pendingInfoFetches: Map<string, Promise<ResolvedPackage>>
}

/**
 * Run async tasks with concurrency control using a semaphore pattern.
 * This implementation correctly handles concurrency without the race conditions
 * present in naive Promise.race approaches.
 */
async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []

  const results: R[] = new Array(items.length)
  let nextIndex = 0
  let completedCount = 0

  return new Promise((resolve, reject) => {
    let hasRejected = false

    const runNext = (): void => {
      if (hasRejected) return

      while (nextIndex < items.length && (nextIndex - completedCount) < limit) {
        const currentIndex = nextIndex++
        const item = items[currentIndex]!

        fn(item)
          .then((result) => {
            if (hasRejected) return
            results[currentIndex] = result
            completedCount++

            if (completedCount === items.length) {
              resolve(results)
            } else {
              runNext()
            }
          })
          .catch((err) => {
            if (!hasRejected) {
              hasRejected = true
              reject(err)
            }
          })
      }
    }

    runNext()
  })
}

export class DependencyTreeBuilder {
  private registry: RegistryFetcher
  private production: boolean
  private autoInstallPeers: boolean
  private platform: string

  constructor(options: ResolutionOptions) {
    if (!options.registry) {
      throw new Error('Registry fetcher is required')
    }
    this.registry = options.registry
    this.production = options.production ?? false
    this.autoInstallPeers = options.autoInstallPeers ?? false
    this.platform = options.platform ?? process.platform
  }

  /**
   * Resolve dependencies and build the dependency tree
   *
   * Performance: Uses parallel resolution for root-level dependencies
   * while maintaining correctness for nested dependencies
   */
  async resolve(manifest: PackageManifest): Promise<DependencyTree> {
    const startTime = Date.now()

    const ctx: ResolveContext = {
      resolvingStack: new Set(),
      resolvedCache: new Map(),
      versionCache: new Map(),
      allResolvedNodes: new Map(),
      depRequirements: new Map(),
      requirements: new Map(),
      devPackages: new Set(),
      optionalPackages: new Set(),
      circularDeps: new Map(),
      warnings: [],
      fetchCount: 0,
      rootDeps: new Map(),
      versionsCache: new Map(),
      pendingVersionFetches: new Map(),
      pendingInfoFetches: new Map(),
    }

    // Gather all dependencies
    const deps = { ...manifest.dependencies }
    const devDeps = this.production ? {} : { ...manifest.devDependencies }

    // Track root-level deps for peer dependency checking
    for (const [name, range] of Object.entries({ ...deps, ...devDeps })) {
      ctx.rootDeps.set(name, range)
    }

    // Resolve production dependencies in parallel
    const resolvedNodes: Map<string, DependencyNode> = new Map()
    const depEntries = Object.entries(deps)

    // Prefetch all version lists in parallel for root dependencies
    await this.prefetchVersions(depEntries.map(([name]) => name), ctx)

    // Resolve production deps in parallel batches
    await Promise.all(
      depEntries.map(([name, range]) =>
        this.resolvePackage(name, range, ctx, resolvedNodes, false, false)
      )
    )

    // Resolve dev dependencies in parallel
    const devDepEntries = Object.entries(devDeps)
    if (devDepEntries.length > 0) {
      await this.prefetchVersions(devDepEntries.map(([name]) => name), ctx)
      await Promise.all(
        devDepEntries.map(([name, range]) =>
          this.resolvePackage(name, range, ctx, resolvedNodes, true, false)
        )
      )
    }

    // Handle auto-install peers if enabled
    if (this.autoInstallPeers) {
      await this.autoInstallPeerDeps(ctx, resolvedNodes)
    }

    // Build the final tree with hoisting
    const hoistedTree = this.hoistDependencies(resolvedNodes, ctx)

    // Add circular dependency warnings
    for (const [pkg, cycle] of ctx.circularDeps) {
      ctx.warnings.push({
        type: 'circular-dependency',
        package: pkg,
        cycle,
      })
    }

    const stats: ResolutionStats = {
      totalPackages: hoistedTree.size,
      deduplicatedPackages: this.countDeduplication(ctx),
      registryFetches: ctx.fetchCount,
      resolutionTime: Date.now() - startTime,
    }

    return {
      name: manifest.name ?? 'package',
      version: manifest.version ?? '0.0.0',
      resolved: Object.fromEntries(hoistedTree),
      warnings: ctx.warnings,
      stats,
    }
  }

  /**
   * Prefetch version lists for multiple packages in parallel
   */
  private async prefetchVersions(names: string[], ctx: ResolveContext): Promise<void> {
    const unfetched = names.filter(name => !ctx.versionsCache.has(name) && !ctx.pendingVersionFetches.has(name))
    if (unfetched.length === 0) return

    await Promise.all(
      unfetched.map(async (name) => {
        // Check again in case another task started fetching
        if (ctx.versionsCache.has(name) || ctx.pendingVersionFetches.has(name)) return

        const fetchPromise = this.registry.getPackageVersions(name)
        ctx.pendingVersionFetches.set(name, fetchPromise)

        try {
          const versions = await fetchPromise
          ctx.versionsCache.set(name, versions)
          ctx.fetchCount++
        } finally {
          ctx.pendingVersionFetches.delete(name)
        }
      })
    )
  }

  /**
   * Resolve a single package and its dependencies
   */
  private async resolvePackage(
    name: string,
    range: string,
    ctx: ResolveContext,
    resolved: Map<string, DependencyNode>,
    isDev: boolean,
    isOptional: boolean,
    requester: string = 'ROOT'
  ): Promise<DependencyNode | null> {
    // Resolve version
    let version: string
    try {
      version = await this.resolveVersion(name, range, ctx)
    } catch (error) {
      if (isOptional) {
        ctx.warnings.push({
          type: 'optional-skipped',
          package: name,
          message: String(error),
        })
        return null
      }
      throw error
    }

    // Track this requirement
    if (!ctx.depRequirements.has(name)) {
      ctx.depRequirements.set(name, new Map())
    }
    ctx.depRequirements.get(name)!.set(requester, { range, version })

    const pkgKey = `${name}@${version}`

    // Check for circular dependency
    if (ctx.resolvingStack.has(pkgKey)) {
      // Mark circular reference
      const cycle = [...ctx.resolvingStack, pkgKey].slice(
        [...ctx.resolvingStack].indexOf(pkgKey)
      )
      const cycleNames = cycle.map((k) => k.split('@')[0]).filter((n): n is string => n !== undefined)
      ctx.circularDeps.set(name, cycleNames)

      // Return existing node if already resolved
      const existing = ctx.allResolvedNodes.get(pkgKey)
      if (existing) {
        if (!existing.circularTo) {
          existing.circularTo = []
        }
        return existing
      }

      // Create a placeholder for circular ref
      return null
    }

    // Check if we already have this exact version resolved
    const existingNode = ctx.allResolvedNodes.get(pkgKey)
    if (existingNode) {
      if (!isDev) {
        existingNode.dev = false
      }
      // Update the resolved map with the best node for this name
      const currentInResolved = resolved.get(name)
      if (!currentInResolved || !semver.satisfies(currentInResolved.version, range)) {
        // If the current one doesn't satisfy this range but existingNode does,
        // we may have a conflict - keep both tracked
      }
      return existingNode
    }

    // Get package info
    let pkgInfo: ResolvedPackage
    try {
      pkgInfo = await this.getPackageInfo(name, version, ctx)
    } catch (error) {
      if (isOptional) {
        ctx.warnings.push({
          type: 'optional-skipped',
          package: name,
          message: String(error),
        })
        return null
      }
      throw error
    }

    // Check platform compatibility for optional deps
    if (isOptional && pkgInfo.os && !this.isPlatformCompatible(pkgInfo.os)) {
      ctx.warnings.push({
        type: 'optional-skipped',
        package: name,
        message: `Not compatible with platform ${this.platform}`,
      })
      return null
    }

    // Track dev/optional status
    if (isDev) {
      ctx.devPackages.add(name)
    }
    if (isOptional) {
      ctx.optionalPackages.add(name)
    }

    // Create the node
    const node: DependencyNode = {
      name,
      version,
      dependencies: pkgInfo.dependencies || {},
      dev: isDev,
      integrity: pkgInfo.dist?.integrity || this.generateIntegrity(name, version),
      resolved: pkgInfo.dist?.tarball || this.generateResolvedUrl(name, version),
    }

    // Only set optional if explicitly true (satisfies exactOptionalPropertyTypes)
    if (isOptional) {
      node.optional = true
    }

    // Handle peer dependencies
    if (pkgInfo.peerDependencies) {
      node.peerDependencies = pkgInfo.peerDependencies
      this.checkPeerDependencies(name, pkgInfo.peerDependencies, ctx, resolved)
    }

    // Handle bundled dependencies
    const bundled = pkgInfo.bundledDependencies || pkgInfo.bundleDependencies
    if (bundled && bundled.length > 0) {
      node.bundledDependencies = bundled
      node.hasBundled = true
    }

    // Store in all resolved nodes
    ctx.allResolvedNodes.set(pkgKey, node)

    // Add to resolved (may be replaced during hoisting)
    resolved.set(name, node)

    // Resolve nested dependencies
    ctx.resolvingStack.add(pkgKey)

    try {
      // Collect all dependencies to resolve
      const regularDeps: Array<[string, string]> = []
      const optionalDeps: Array<[string, string]> = []

      const deps = pkgInfo.dependencies
      if (deps) {
        for (const depName in deps) {
          if (!bundled?.includes(depName)) {
            regularDeps.push([depName, deps[depName]!])
          }
        }
      }

      const optDeps = pkgInfo.optionalDependencies
      if (optDeps) {
        for (const depName in optDeps) {
          if (!bundled?.includes(depName)) {
            optionalDeps.push([depName, optDeps[depName]!])
          }
        }
      }

      // Prefetch version lists for all dependencies in parallel
      const allDepNames = [...regularDeps, ...optionalDeps].map(([n]) => n)
      if (allDepNames.length > 0) {
        await this.prefetchVersions(allDepNames, ctx)
      }

      // Resolve all dependencies in parallel using concurrency control
      // Note: We resolve in parallel because cycle detection uses the stack
      // and each package starts fresh after its own resolution completes
      if (regularDeps.length > 0) {
        await parallelLimit(regularDeps, DEFAULT_CONCURRENCY, ([depName, depRange]) =>
          this.resolvePackage(depName, depRange, ctx, resolved, isDev, false, name)
        )
      }

      if (optionalDeps.length > 0) {
        await parallelLimit(optionalDeps, DEFAULT_CONCURRENCY, ([depName, depRange]) =>
          this.resolvePackage(depName, depRange, ctx, resolved, isDev, true, name)
        )
      }
    } finally {
      ctx.resolvingStack.delete(pkgKey)
    }

    // Mark circular edges
    if (ctx.circularDeps.has(name)) {
      const cycle = ctx.circularDeps.get(name)!
      node.circularTo = cycle.filter((n) => n !== name)
    }

    return node
  }

  /**
   * Resolve a version range to a specific version
   *
   * Optimizations:
   * - Deduplicates concurrent fetches for the same package
   * - Uses cached version lists
   * - Caches resolution results
   */
  private async resolveVersion(
    name: string,
    range: string,
    ctx: ResolveContext
  ): Promise<string> {
    const cacheKey = `${name}@${range}`
    const cached = ctx.versionCache.get(cacheKey)
    if (cached) {
      return cached
    }

    // Check if we already have versions cached for this package
    let versions = ctx.versionsCache.get(name)
    if (!versions) {
      // Check if there's a pending fetch we can wait on
      let pendingFetch = ctx.pendingVersionFetches.get(name)
      if (pendingFetch) {
        versions = await pendingFetch
      } else {
        // Start a new fetch and register it
        const fetchPromise = this.registry.getPackageVersions(name)
        ctx.pendingVersionFetches.set(name, fetchPromise)
        try {
          versions = await fetchPromise
          ctx.versionsCache.set(name, versions)
          ctx.fetchCount++
        } finally {
          ctx.pendingVersionFetches.delete(name)
        }
      }
    }

    // Handle exact versions
    if (semver.valid(range)) {
      if (versions.includes(range)) {
        ctx.versionCache.set(cacheKey, range)
        return range
      }
      throw new ResolutionError(`Version ${range} not found for ${name}`, name, range)
    }

    // Find max satisfying version
    const resolved = semver.maxSatisfying(versions, range)
    if (!resolved) {
      throw new ResolutionError(`No version of ${name} satisfies ${range}`, name, range)
    }

    ctx.versionCache.set(cacheKey, resolved)
    return resolved
  }

  /**
   * Get package info from registry with caching
   *
   * Optimizations:
   * - Deduplicates concurrent fetches for the same package@version
   * - Caches results
   */
  private async getPackageInfo(
    name: string,
    version: string,
    ctx: ResolveContext
  ): Promise<ResolvedPackage> {
    const key = `${name}@${version}`
    const cached = ctx.resolvedCache.get(key)
    if (cached) {
      return cached
    }

    // Check if there's a pending fetch we can wait on
    let pendingFetch = ctx.pendingInfoFetches.get(key)
    if (pendingFetch) {
      return pendingFetch
    }

    // Start a new fetch and register it
    const fetchPromise = this.registry.getPackageInfo(name, version)
    ctx.pendingInfoFetches.set(key, fetchPromise)

    try {
      const info = await fetchPromise
      ctx.resolvedCache.set(key, info)
      return info
    } finally {
      ctx.pendingInfoFetches.delete(key)
    }
  }

  /**
   * Check peer dependencies and add warnings
   */
  private checkPeerDependencies(
    packageName: string,
    peerDeps: Record<string, string>,
    ctx: ResolveContext,
    resolved: Map<string, DependencyNode>
  ): void {
    for (const [peer, range] of Object.entries(peerDeps)) {
      const installed = resolved.get(peer)
      const rootRange = ctx.rootDeps.get(peer)

      if (!installed && !rootRange) {
        // Peer not installed
        ctx.warnings.push({
          type: 'peer-missing',
          package: packageName,
          peer,
          required: range,
        })
      } else if (installed) {
        // Check version compatibility
        if (!semver.satisfies(installed.version, range)) {
          ctx.warnings.push({
            type: 'peer-incompatible',
            package: packageName,
            peer,
            required: range,
            installed: installed.version,
          })
        }
      }
    }
  }

  /**
   * Auto-install missing peer dependencies
   */
  private async autoInstallPeerDeps(
    ctx: ResolveContext,
    resolved: Map<string, DependencyNode>
  ): Promise<void> {
    // Collect all peer deps that are missing
    const missingPeers = new Map<string, string>()

    for (const node of resolved.values()) {
      if (node.peerDependencies) {
        for (const [peer, range] of Object.entries(node.peerDependencies)) {
          if (!resolved.has(peer) && !missingPeers.has(peer)) {
            missingPeers.set(peer, range)
          }
        }
      }
    }

    // Install missing peers
    for (const [name, range] of missingPeers) {
      await this.resolvePackage(name, range, ctx, resolved, false, false)
    }

    // Remove peer-missing warnings for peers we auto-installed
    ctx.warnings = ctx.warnings.filter(
      (w) => !(w.type === 'peer-missing' && resolved.has(w.peer!))
    )
  }

  /**
   * Check if package is compatible with current platform
   */
  private isPlatformCompatible(os: string[]): boolean {
    // Handle negation (e.g., ['!win32'])
    const negated = os.filter((o) => o.startsWith('!'))
    const allowed = os.filter((o) => !o.startsWith('!'))

    if (negated.length > 0) {
      return !negated.some((o) => o.slice(1) === this.platform)
    }

    return allowed.includes(this.platform)
  }

  /**
   * Create a shallow copy of a node without nested dependencies.
   * More efficient than destructuring spread for large objects.
   * Note: With exactOptionalPropertyTypes, we must only set optional properties
   * when they have a defined value.
   */
  private cloneNodeWithoutNested(node: DependencyNode): DependencyNode {
    const clone: DependencyNode = {
      name: node.name,
      version: node.version,
      dependencies: node.dependencies,
      dev: node.dev,
    }
    // Only copy optional properties if defined (satisfies exactOptionalPropertyTypes)
    if (node.optional !== undefined) clone.optional = node.optional
    if (node.peerDependencies) clone.peerDependencies = node.peerDependencies
    if (node.bundledDependencies) clone.bundledDependencies = node.bundledDependencies
    if (node.hasBundled !== undefined) clone.hasBundled = node.hasBundled
    if (node.circularTo) clone.circularTo = node.circularTo
    if (node.integrity !== undefined) clone.integrity = node.integrity
    if (node.resolved !== undefined) clone.resolved = node.resolved
    return clone
  }

  /**
   * Hoist dependencies to the highest possible level.
   *
   * Optimizations:
   * - Uses efficient node cloning instead of spread operators
   * - Avoids unnecessary iterations through allResolvedNodes
   * - Two-pass algorithm for better cache locality
   * - Pre-processes version counts to avoid repeated lookups
   */
  private hoistDependencies(
    resolved: Map<string, DependencyNode>,
    ctx: ResolveContext
  ): Map<string, DependencyNode> {
    const hoisted = new Map<string, DependencyNode>()

    // First pass: determine which version to hoist for each package and add to hoisted map
    // Store nesting decisions for second pass
    const nestingDecisions: Array<{
      name: string
      version: string
      requesters: string[]
    }> = []

    for (const [name, requirements] of ctx.depRequirements) {
      // Collect all unique versions required with their requesters
      const versionsNeeded = new Map<string, string[]>()
      for (const [requester, { version }] of requirements) {
        let requesters = versionsNeeded.get(version)
        if (!requesters) {
          requesters = []
          versionsNeeded.set(version, requesters)
        }
        requesters.push(requester)
      }

      let hoistVersion: string

      if (versionsNeeded.size === 1) {
        // Single version - hoist it directly
        hoistVersion = versionsNeeded.keys().next().value!
      } else {
        // Multiple versions - find best one to hoist
        let maxCount = 0
        let candidates: string[] = []

        for (const [version, requesters] of versionsNeeded) {
          const count = requesters.length
          if (count > maxCount) {
            maxCount = count
            candidates = [version]
          } else if (count === maxCount) {
            candidates.push(version)
          }
        }

        // If tie, pick highest version
        hoistVersion = candidates.length > 1
          ? candidates.sort((a, b) => semver.compare(b, a))[0]!
          : candidates[0]!

        // Collect versions that need nesting for second pass
        for (const [version, requesters] of versionsNeeded) {
          if (version !== hoistVersion) {
            nestingDecisions.push({ name, version, requesters })
          }
        }
      }

      // Add hoisted node
      const node = ctx.allResolvedNodes.get(`${name}@${hoistVersion}`)
      if (node && !hoisted.has(name)) {
        hoisted.set(name, this.cloneNodeWithoutNested(node))
      }
    }

    // Ensure all resolved packages are in hoisted if not handled by requirements
    for (const [name, node] of resolved) {
      if (!hoisted.has(name)) {
        hoisted.set(name, this.cloneNodeWithoutNested(node))
      }
    }

    // Second pass: nest conflicting versions under their requesters
    for (const { name, version, requesters } of nestingDecisions) {
      const nestedNode = ctx.allResolvedNodes.get(`${name}@${version}`)
      if (!nestedNode) continue

      for (const requester of requesters) {
        if (requester === 'ROOT') continue

        const parentNode = hoisted.get(requester)
        if (parentNode) {
          if (!parentNode.nestedDependencies) {
            parentNode.nestedDependencies = {}
          }
          parentNode.nestedDependencies[name] = this.cloneNodeWithoutNested(nestedNode)
        }
      }
    }

    return hoisted
  }

  /**
   * Count how many packages were deduplicated
   */
  private countDeduplication(ctx: ResolveContext): number {
    // Count instances where same package was requested multiple times
    // but only installed once
    let duplicateRequests = 0

    for (const [, ranges] of ctx.requirements) {
      if (ranges.size > 1) {
        duplicateRequests += ranges.size - 1
      }
    }

    return duplicateRequests
  }

  /**
   * Generate integrity hash placeholder
   */
  private generateIntegrity(name: string, version: string): string {
    // In real implementation, this would be from registry
    // For now, generate a placeholder
    const data = `${name}@${version}`
    return `sha512-${Buffer.from(data).toString('base64').slice(0, 44)}`
  }

  /**
   * Generate resolved URL
   */
  private generateResolvedUrl(name: string, version: string): string {
    return `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`
  }
}

/**
 * Detect circular dependencies in a resolved tree
 */
export function detectCircularDependencies(tree: DependencyTree): string[][] {
  const cycles: string[][] = []
  const visited = new Set<string>()
  const stack: string[] = []
  const inStack = new Set<string>()

  function visit(name: string): void {
    if (inStack.has(name)) {
      // Found a cycle
      const cycleStart = stack.indexOf(name)
      const cycle = [...stack.slice(cycleStart), name]
      cycles.push(cycle)
      return
    }

    if (visited.has(name)) {
      return
    }

    visited.add(name)
    stack.push(name)
    inStack.add(name)

    const node = tree.resolved[name]
    if (node) {
      for (const dep of Object.keys(node.dependencies)) {
        visit(dep)
      }
    }

    stack.pop()
    inStack.delete(name)
  }

  for (const name of Object.keys(tree.resolved)) {
    visit(name)
  }

  return cycles
}
