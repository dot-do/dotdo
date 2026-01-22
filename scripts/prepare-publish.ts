#!/usr/bin/env node
/**
 * Prepare packages for publishing by replacing workspace:* dependencies
 * with the actual version numbers.
 *
 * Usage: npx tsx scripts/prepare-publish.ts
 *
 * This script is automatically run by changesets during the publish process,
 * but can also be run manually for verification.
 */

import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

// Workspace package directories (relative to root)
const WORKSPACE_DIRS = [
  'dotdo',
  'do',
  'db',
  'rpc',
  'ai',
  'api',
  'auth',
  'mcp',
  'core',
  'utils',
  'observability',
  'integrations',
  'business',
  'business/finance',
  'clickhouse',
  'experiments',
  'oauth',
  'testing',
  'test-utils',
  'fsx',
  'npmx',
  'bashx',
  'gitx',
  'rpc.do',
  'sdk.do',
  'platform.do',
]

interface PackageJson {
  name: string
  version: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function getPackageDirs(): string[] {
  return WORKSPACE_DIRS
    .map(dir => join(rootDir, dir))
    .filter(pkgPath => {
      const pkgJsonPath = join(pkgPath, 'package.json')
      try {
        return existsSync(pkgPath) && statSync(pkgPath).isDirectory() && existsSync(pkgJsonPath)
      } catch {
        return false
      }
    })
}

function readPackageJson(pkgDir: string): PackageJson {
  const pkgJsonPath = join(pkgDir, 'package.json')
  return JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
}

function writePackageJson(pkgDir: string, pkg: PackageJson): void {
  const pkgJsonPath = join(pkgDir, 'package.json')
  writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n')
}

function replaceWorkspaceProtocol(
  deps: Record<string, string> | undefined,
  versionMap: Map<string, string>
): Record<string, string> | undefined {
  if (!deps) return deps

  const result: Record<string, string> = {}
  for (const [name, version] of Object.entries(deps)) {
    if (version.startsWith('workspace:')) {
      const actualVersion = versionMap.get(name)
      if (!actualVersion) {
        // Not a workspace package, keep original
        result[name] = version
        continue
      }
      // workspace:* -> actual version, workspace:^ -> ^version
      const prefix = version.replace('workspace:', '').replace('*', '')
      result[name] = prefix + actualVersion
    } else {
      result[name] = version
    }
  }
  return result
}

function main() {
  console.log('Preparing packages for publish...\n')

  const dirs = getPackageDirs()
  const versionMap = new Map<string, string>()

  // First pass: collect all package versions
  for (const dir of dirs) {
    const pkg = readPackageJson(dir)
    versionMap.set(pkg.name, pkg.version)
    console.log(`Found: ${pkg.name}@${pkg.version}`)
  }

  console.log('\nReplacing workspace:* dependencies...\n')

  // Second pass: replace workspace:* with actual versions
  for (const dir of dirs) {
    const pkg = readPackageJson(dir)

    let modified = false

    const newDeps = replaceWorkspaceProtocol(pkg.dependencies, versionMap)
    if (JSON.stringify(newDeps) !== JSON.stringify(pkg.dependencies)) {
      pkg.dependencies = newDeps
      modified = true
    }

    const newDevDeps = replaceWorkspaceProtocol(pkg.devDependencies, versionMap)
    if (JSON.stringify(newDevDeps) !== JSON.stringify(pkg.devDependencies)) {
      pkg.devDependencies = newDevDeps
      modified = true
    }

    const newPeerDeps = replaceWorkspaceProtocol(pkg.peerDependencies, versionMap)
    if (JSON.stringify(newPeerDeps) !== JSON.stringify(pkg.peerDependencies)) {
      pkg.peerDependencies = newPeerDeps
      modified = true
    }

    if (modified) {
      writePackageJson(dir, pkg)
      console.log(`Updated: ${pkg.name}`)
      if (pkg.dependencies) {
        for (const [dep, ver] of Object.entries(pkg.dependencies)) {
          if (versionMap.has(dep)) {
            console.log(`  - ${dep}: ${ver}`)
          }
        }
      }
    }
  }

  console.log('\nDone!')
}

main()
