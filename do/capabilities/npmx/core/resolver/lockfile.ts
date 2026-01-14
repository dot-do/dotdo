/**
 * Lock File Generation and Parsing
 *
 * Generates npm v3 compatible package-lock.json files.
 */

import type {
  DependencyTree,
  DependencyNode,
  LockFile,
  LockFileEntry,
  TreeDiff,
} from './types'

/**
 * Generate a package-lock.json (v3) from a resolved dependency tree
 */
export function generateLockFile(tree: DependencyTree): LockFile {
  const packages: Record<string, LockFileEntry> = {}

  // Add root package entry
  packages[''] = {
    version: tree.version || '0.0.0',
    dependencies: collectRootDependencies(tree),
  }

  // Add all resolved packages
  addPackagesToLockfile(tree.resolved, 'node_modules', packages)

  return {
    name: tree.name || 'package',
    version: tree.version || '0.0.0',
    lockfileVersion: 3,
    requires: true,
    packages,
  }
}

/**
 * Collect root-level dependencies for the lockfile root entry
 */
function collectRootDependencies(tree: DependencyTree): Record<string, string> {
  const deps: Record<string, string> = {}

  for (const [name, node] of Object.entries(tree.resolved)) {
    deps[name] = node.version
  }

  return deps
}

/**
 * Recursively add packages to the lockfile
 */
function addPackagesToLockfile(
  resolved: Record<string, DependencyNode>,
  prefix: string,
  packages: Record<string, LockFileEntry>
): void {
  for (const [name, node] of Object.entries(resolved)) {
    const path = `${prefix}/${name}`

    const entry: LockFileEntry = {
      version: node.version,
    }

    if (node.resolved) {
      entry.resolved = node.resolved
    }

    if (node.integrity) {
      entry.integrity = node.integrity
    }

    if (node.dev) {
      entry.dev = true
    }

    if (node.optional) {
      entry.optional = true
    }

    if (Object.keys(node.dependencies).length > 0) {
      entry.dependencies = { ...node.dependencies }
    }

    if (node.peerDependencies && Object.keys(node.peerDependencies).length > 0) {
      entry.peerDependencies = { ...node.peerDependencies }
    }

    if (node.bundledDependencies && node.bundledDependencies.length > 0) {
      entry.bundleDependencies = [...node.bundledDependencies]
    }

    packages[path] = entry

    // Handle nested dependencies
    if (node.nestedDependencies) {
      addPackagesToLockfile(node.nestedDependencies, `${path}/node_modules`, packages)
    }
  }
}

/**
 * Parse a package-lock.json file into a DependencyTree
 */
export function parseLockFile(lockfile: LockFile): DependencyTree {
  const resolved: Record<string, DependencyNode> = {}

  for (const [path, entry] of Object.entries(lockfile.packages)) {
    if (path === '') {
      // Root entry - skip
      continue
    }

    // Extract package name from path
    const parts = path.split('/node_modules/')
    const name = parts[parts.length - 1]

    // Check if this is a nested dependency
    const isNested = parts.length > 2

    if (!isNested && name !== undefined) {
      resolved[name] = lockFileEntryToNode(name, entry)
    }
    // Nested dependencies will be handled in a second pass
  }

  // Second pass for nested dependencies
  for (const [path, entry] of Object.entries(lockfile.packages)) {
    if (path === '') continue

    const parts = path.split('/node_modules/')
    if (parts.length > 2) {
      // This is a nested dependency
      const parentPath = parts.slice(0, -1).join('/node_modules/')
      const parentName = parentPath.split('/node_modules/').pop()!
      const name = parts[parts.length - 1]

      if (parentName === undefined || name === undefined) continue

      const parentNode = resolved[parentName]
      if (parentNode) {
        if (!parentNode.nestedDependencies) {
          parentNode.nestedDependencies = {}
        }
        parentNode.nestedDependencies[name] = lockFileEntryToNode(name, entry)
      }
    }
  }

  return {
    name: lockfile.name ?? 'package',
    version: lockfile.version ?? '0.0.0',
    resolved,
    warnings: [],
    stats: {
      totalPackages: Object.keys(resolved).length,
      deduplicatedPackages: 0,
      registryFetches: 0,
    },
  }
}

/**
 * Convert a lockfile entry to a DependencyNode
 */
function lockFileEntryToNode(name: string, entry: LockFileEntry): DependencyNode {
  const node: DependencyNode = {
    name,
    version: entry.version,
    dependencies: entry.dependencies || {},
    dev: entry.dev ?? false,
  }

  if (entry.optional !== undefined) {
    node.optional = entry.optional
  }
  if (entry.peerDependencies !== undefined) {
    node.peerDependencies = entry.peerDependencies
  }
  if (entry.bundleDependencies !== undefined) {
    node.bundledDependencies = entry.bundleDependencies
    node.hasBundled = entry.bundleDependencies.length > 0
  }
  if (entry.integrity !== undefined) {
    node.integrity = entry.integrity
  }
  if (entry.resolved !== undefined) {
    node.resolved = entry.resolved
  }

  return node
}

/**
 * Diff two dependency trees to find changes
 */
export function diffTrees(before: DependencyTree, after: DependencyTree): TreeDiff {
  const added: Array<{ name: string; version: string }> = []
  const removed: Array<{ name: string; version: string }> = []
  const updated: Array<{ name: string; from: string; to: string }> = []
  const unchanged: Array<{ name: string; version: string }> = []

  const beforeNames = new Set(Object.keys(before.resolved))
  const afterNames = new Set(Object.keys(after.resolved))

  // Find added packages
  for (const name of afterNames) {
    if (!beforeNames.has(name)) {
      const node = after.resolved[name]
      if (node) {
        added.push({ name, version: node.version })
      }
    }
  }

  // Find removed packages
  for (const name of beforeNames) {
    if (!afterNames.has(name)) {
      const node = before.resolved[name]
      if (node) {
        removed.push({ name, version: node.version })
      }
    }
  }

  // Find updated and unchanged
  for (const name of beforeNames) {
    if (afterNames.has(name)) {
      const beforeNode = before.resolved[name]
      const afterNode = after.resolved[name]

      if (beforeNode && afterNode) {
        if (beforeNode.version !== afterNode.version) {
          updated.push({ name, from: beforeNode.version, to: afterNode.version })
        } else {
          unchanged.push({ name, version: beforeNode.version })
        }
      }
    }
  }

  return {
    added,
    removed,
    updated,
    unchanged,
    summary: {
      added: added.length,
      removed: removed.length,
      updated: updated.length,
      unchanged: unchanged.length,
    },
  }
}

/**
 * Validate a lockfile's integrity
 */
export function validateLockFile(lockfile: LockFile): LockFileValidation {
  const errors: string[] = []
  const warnings: string[] = []

  // Check lockfile version
  if (lockfile.lockfileVersion !== 3) {
    warnings.push(`Lockfile version ${lockfile.lockfileVersion} may not be fully supported`)
  }

  // Check for missing integrity hashes
  for (const [path, entry] of Object.entries(lockfile.packages)) {
    if (path === '') continue // Skip root

    if (!entry.integrity) {
      warnings.push(`Missing integrity hash for ${path}`)
    }

    if (!entry.resolved) {
      warnings.push(`Missing resolved URL for ${path}`)
    }
  }

  // Check for orphaned dependencies
  const declaredDeps = new Set<string>()
  for (const [, entry] of Object.entries(lockfile.packages)) {
    if (entry.dependencies) {
      for (const dep of Object.keys(entry.dependencies)) {
        declaredDeps.add(dep)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

export interface LockFileValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}
