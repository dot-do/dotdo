/**
 * Output formatting utilities for CLI
 */

import type { PackageEntry, SearchResult } from '../types'

/**
 * Format package list output
 */
export function formatPackageList(packages: PackageEntry[], options?: { long?: boolean; json?: boolean }): string {
  if (options?.json) {
    return JSON.stringify(packages, null, 2)
  }

  if (packages.length === 0) {
    return '(empty)'
  }

  if (options?.long) {
    return packages
      .map((p) => {
        const dev = p.dev ? ' (dev)' : ''
        const desc = p.description ? ` - ${p.description}` : ''
        return `${p.name}@${p.version}${dev}${desc}`
      })
      .join('\n')
  }

  return packages.map((p) => `${p.name}@${p.version}`).join('\n')
}

/**
 * Format search results
 */
export function formatSearchResults(results: SearchResult[], options?: { json?: boolean }): string {
  if (options?.json) {
    return JSON.stringify(results, null, 2)
  }

  if (results.length === 0) {
    return 'No packages found'
  }

  return results
    .map((r) => {
      const desc = r.description ? ` - ${r.description}` : ''
      return `${r.name}@${r.version}${desc}`
    })
    .join('\n')
}

/**
 * Format package info
 */
export function formatPackageInfo(
  pkg: {
    name: string
    version: string
    description?: string
    homepage?: string
    repository?: string
    license?: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  },
  options?: { json?: boolean }
): string {
  if (options?.json) {
    return JSON.stringify(pkg, null, 2)
  }

  const lines: string[] = []
  lines.push(`${pkg.name}@${pkg.version}`)

  if (pkg.description) {
    lines.push(`  ${pkg.description}`)
  }
  if (pkg.homepage) {
    lines.push(`  homepage: ${pkg.homepage}`)
  }
  if (pkg.repository) {
    lines.push(`  repository: ${pkg.repository}`)
  }
  if (pkg.license) {
    lines.push(`  license: ${pkg.license}`)
  }

  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    lines.push(`  dependencies:`)
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      lines.push(`    ${name}: ${version}`)
    }
  }

  if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
    lines.push(`  devDependencies:`)
    for (const [name, version] of Object.entries(pkg.devDependencies)) {
      lines.push(`    ${name}: ${version}`)
    }
  }

  return lines.join('\n')
}

/**
 * Format install result
 */
export function formatInstallResult(
  installed: Array<{ name: string; version: string }>,
  removed: Array<{ name: string; version: string }>,
  updated: Array<{ name: string; from: string; to: string }>
): string {
  const lines: string[] = []

  if (installed.length > 0) {
    lines.push(`added ${installed.length} packages`)
  }
  if (removed.length > 0) {
    lines.push(`removed ${removed.length} packages`)
  }
  if (updated.length > 0) {
    lines.push(`updated ${updated.length} packages`)
  }

  if (lines.length === 0) {
    return 'up to date'
  }

  return lines.join(', ')
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
