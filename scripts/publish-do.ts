#!/usr/bin/env node
/**
 * Publish script for @dotdo/do and its dependencies
 *
 * Publishes in dependency order:
 * Level 0: @dotdo/db, @dotdo/utils, @dotdo/observability, @dotdo/integrations, @dotdo/finance
 * Level 1: @dotdo/rpc
 * Level 2: @dotdo/auth
 * Level 3: @dotdo/do
 *
 * Usage: npx tsx scripts/publish-do.ts [--dry-run]
 */

import { execSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

// Packages to publish in dependency order
const PACKAGES_TO_PUBLISH = [
  // Level 0 - no workspace dependencies
  { dir: 'db', name: '@dotdo/db' },
  { dir: 'utils', name: '@dotdo/utils' },
  { dir: 'observability', name: '@dotdo/observability' },
  { dir: 'integrations', name: '@dotdo/integrations' },
  { dir: 'do/business/finance', name: '@dotdo/finance' },
  // Level 1
  { dir: 'rpc', name: '@dotdo/rpc' },
  // Level 2
  { dir: 'auth', name: '@dotdo/auth' },
  // Level 3
  { dir: 'do', name: '@dotdo/do' },
]

interface PackageJson {
  name: string
  version: string
  private?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function readPackageJson(pkgDir: string): PackageJson {
  return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'))
}

function writePackageJson(pkgDir: string, pkg: PackageJson): void {
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
}

function isPublished(name: string, version: string): boolean {
  try {
    execSync(`npm view "${name}@${version}" version`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
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
        // Not in our package set, keep as-is (will fail if needed at runtime)
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

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const versionMap = new Map<string, string>()
  const originalContents = new Map<string, string>()
  const toPublish: { dir: string; name: string; version: string }[] = []

  console.log(dryRun ? '🔍 DRY RUN MODE\n' : '')
  console.log('Checking packages for @dotdo/do dependency chain...\n')

  // First pass: collect versions and check what needs publishing
  for (const { dir, name } of PACKAGES_TO_PUBLISH) {
    const fullDir = join(rootDir, dir)

    if (!existsSync(join(fullDir, 'package.json'))) {
      console.log(`❌ ${name} - package.json not found at ${dir}`)
      continue
    }

    const pkg = readPackageJson(fullDir)
    versionMap.set(pkg.name, pkg.version)

    if (pkg.private) {
      console.log(`⏭️  ${pkg.name} (private)`)
      continue
    }

    if (isPublished(pkg.name, pkg.version)) {
      console.log(`✅ ${pkg.name}@${pkg.version} (already published)`)
    } else {
      console.log(`📦 ${pkg.name}@${pkg.version} (needs publish)`)
      toPublish.push({ dir: fullDir, name: pkg.name, version: pkg.version })
    }
  }

  if (toPublish.length === 0) {
    console.log('\n✨ All packages are already published!')
    return
  }

  console.log(`\n${toPublish.length} package(s) to publish:`)
  for (const { name, version } of toPublish) {
    console.log(`  - ${name}@${version}`)
  }

  if (dryRun) {
    console.log('\n🔍 Dry run complete. Run without --dry-run to publish.')
    return
  }

  // Save original package.json contents and replace workspace:*
  console.log('\nPreparing packages for publish...')

  for (const { dir } of toPublish) {
    const pkgJsonPath = join(dir, 'package.json')
    originalContents.set(pkgJsonPath, readFileSync(pkgJsonPath, 'utf-8'))

    const pkg = readPackageJson(dir)
    pkg.dependencies = replaceWorkspaceProtocol(pkg.dependencies, versionMap)
    pkg.devDependencies = replaceWorkspaceProtocol(pkg.devDependencies, versionMap)
    pkg.peerDependencies = replaceWorkspaceProtocol(pkg.peerDependencies, versionMap)
    writePackageJson(dir, pkg)
  }

  console.log('\n🔐 Safari will open for npm authentication (Touch ID)\n')

  let failed = false
  for (const { dir, name, version } of toPublish) {
    console.log(`\n📤 Publishing ${name}@${version}...`)
    const result = spawnSync('npm', ['publish', '--access', 'public'], {
      cwd: dir,
      stdio: 'inherit'
    })

    if (result.status !== 0) {
      console.error(`❌ Failed to publish ${name}@${version}`)
      failed = true
      break
    }
    console.log(`✅ Published ${name}@${version}`)
  }

  // Restore original package.json files
  console.log('\nRestoring package.json files...')
  for (const [path, content] of originalContents) {
    writeFileSync(path, content)
  }

  if (failed) {
    process.exit(1)
  }

  console.log('\n🎉 All @dotdo/do packages published!')
}

main()
