/**
 * Dependency Hoisting Logic
 *
 * Implements npm-style dependency hoisting to create a flat node_modules structure.
 * Handles version conflicts by nesting incompatible versions.
 */

import semver from 'semver'
import type { DependencyNode, DependencyTree } from './types'

/**
 * Requirement tracking for hoisting decisions
 */
interface HoistingContext {
  /** Package name -> version requirements from different dependents */
  requirements: Map<string, VersionRequirement[]>
  /** Packages that must remain nested (bundled, conflicts) */
  mustNest: Set<string>
}

interface VersionRequirement {
  /** The version range required */
  range: string
  /** Package requesting this dependency */
  requester: string
  /** Resolved version satisfying this range */
  resolvedVersion: string
}

/**
 * Analyze dependency tree and determine optimal hoisting
 */
export function analyzeHoisting(tree: DependencyTree): HoistingAnalysis {
  const ctx: HoistingContext = {
    requirements: new Map(),
    mustNest: new Set(),
  }

  // Collect all version requirements
  for (const [name, node] of Object.entries(tree.resolved)) {
    for (const [depName, depRange] of Object.entries(node.dependencies)) {
      const depNode = tree.resolved[depName]
      if (depNode) {
        addRequirement(ctx, depName, {
          range: depRange,
          requester: name,
          resolvedVersion: depNode.version,
        })
      }
    }

    // Mark bundled dependencies as must-nest
    if (node.bundledDependencies) {
      for (const bundled of node.bundledDependencies) {
        ctx.mustNest.add(`${name}:${bundled}`)
      }
    }
  }

  // Analyze conflicts
  const conflicts: HoistingConflict[] = []
  const hoistable: string[] = []

  for (const [name, reqs] of ctx.requirements) {
    if (ctx.mustNest.has(name)) {
      continue
    }

    const versions = new Set(reqs.map((r) => r.resolvedVersion))

    if (versions.size === 1) {
      // Single version - can hoist
      hoistable.push(name)
    } else {
      // Multiple versions - conflict
      const conflict: HoistingConflict = {
        package: name,
        versions: Array.from(versions),
        requesters: reqs.map((r) => ({
          package: r.requester,
          range: r.range,
          resolved: r.resolvedVersion,
        })),
      }
      conflicts.push(conflict)
    }
  }

  return {
    hoistable,
    conflicts,
    mustNest: Array.from(ctx.mustNest),
  }
}

function addRequirement(
  ctx: HoistingContext,
  name: string,
  req: VersionRequirement
): void {
  if (!ctx.requirements.has(name)) {
    ctx.requirements.set(name, [])
  }
  ctx.requirements.get(name)!.push(req)
}

/**
 * Result of hoisting analysis
 */
export interface HoistingAnalysis {
  /** Packages that can be hoisted to root */
  hoistable: string[]
  /** Packages with version conflicts */
  conflicts: HoistingConflict[]
  /** Packages that must stay nested (bundled, etc.) */
  mustNest: string[]
}

export interface HoistingConflict {
  package: string
  versions: string[]
  requesters: Array<{
    package: string
    range: string
    resolved: string
  }>
}

/**
 * Apply hoisting to a dependency tree
 * Returns a new tree with hoisted structure
 */
export function applyHoisting(tree: DependencyTree): DependencyTree {
  const analysis = analyzeHoisting(tree)
  const newResolved: Record<string, DependencyNode> = {}

  // First, add all root-level packages
  for (const [name, node] of Object.entries(tree.resolved)) {
    // Check if this is a hoisting conflict
    const conflict = analysis.conflicts.find((c) => c.package === name)

    if (conflict) {
      // For conflicts, pick the most common version for root
      // or the highest version
      const versionCounts = new Map<string, number>()
      for (const req of conflict.requesters) {
        versionCounts.set(req.resolved, (versionCounts.get(req.resolved) || 0) + 1)
      }

      let rootVersion = node.version
      let maxCount = 0

      for (const [ver, count] of versionCounts) {
        if (count > maxCount || (count === maxCount && semver.gt(ver, rootVersion))) {
          rootVersion = ver
          maxCount = count
        }
      }

      // Only keep this version at root if it matches
      if (node.version === rootVersion) {
        const { nestedDependencies: _, ...nodeWithoutNested } = node
        newResolved[name] = nodeWithoutNested
      }
    } else {
      // No conflict, hoist to root
      const { nestedDependencies: _, ...nodeWithoutNested } = node
      newResolved[name] = nodeWithoutNested
    }
  }

  // Then, nest conflicting versions
  for (const conflict of analysis.conflicts) {
    const rootNode = newResolved[conflict.package]
    const rootVersion = rootNode?.version

    for (const req of conflict.requesters) {
      if (req.resolved !== rootVersion) {
        // Need to nest this version under the requester
        const parent = newResolved[req.package]
        if (parent) {
          if (!parent.nestedDependencies) {
            parent.nestedDependencies = {}
          }

          const nestedNode = tree.resolved[conflict.package]
          if (nestedNode) {
            const { nestedDependencies: _, ...nestedWithoutNested } = nestedNode
            parent.nestedDependencies[conflict.package] = {
              ...nestedWithoutNested,
              version: req.resolved,
            }
          }
        }
      }
    }
  }

  return {
    ...tree,
    resolved: newResolved,
  }
}

/**
 * Calculate space savings from deduplication
 */
export function calculateDeduplicationSavings(tree: DependencyTree): DeduplicationStats {
  const uniquePackages = new Map<string, Set<string>>() // name -> versions

  function collectPackages(resolved: Record<string, DependencyNode>): void {
    for (const [name, node] of Object.entries(resolved)) {
      if (!uniquePackages.has(name)) {
        uniquePackages.set(name, new Set())
      }
      uniquePackages.get(name)!.add(node.version)

      if (node.nestedDependencies) {
        collectPackages(node.nestedDependencies)
      }
    }
  }

  collectPackages(tree.resolved)

  let totalInstances = 0
  let uniqueInstances = 0

  for (const [_name, versions] of uniquePackages) {
    totalInstances += versions.size
    uniqueInstances++
  }

  return {
    totalPackages: uniquePackages.size,
    totalInstances,
    deduplicatedCount: totalInstances - uniquePackages.size,
  }
}

export interface DeduplicationStats {
  totalPackages: number
  totalInstances: number
  deduplicatedCount: number
}
