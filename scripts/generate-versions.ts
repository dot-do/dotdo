#!/usr/bin/env node
/**
 * Generate versions.tsv with all package metadata from the workspace.
 *
 * Usage: npx tsx scripts/generate-versions.ts
 *
 * Reads all package.json files from the workspace packages defined in
 * pnpm-workspace.yaml and outputs a TSV file with package metadata.
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

interface PackageJson {
  name?: string
  version?: string
  description?: string
  private?: boolean
  main?: string
  types?: string
  repository?: string | { type?: string; url?: string; directory?: string }
  homepage?: string
  license?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface PackageMetadata {
  name: string
  version: string
  description: string
  private: boolean
  main: string
  types: string
  repository: string
  homepage: string
  license: string
  dependencies: number
  devDependencies: number
}

/**
 * Parse pnpm-workspace.yaml to get workspace package patterns
 */
function parseWorkspaceYaml(): string[] {
  const workspacePath = join(rootDir, 'pnpm-workspace.yaml')
  const content = readFileSync(workspacePath, 'utf-8')

  // Simple YAML parser for the packages array
  const patterns: string[] = []
  let inPackages = false

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === 'packages:') {
      inPackages = true
      continue
    }
    if (inPackages && trimmed.startsWith('-')) {
      const pattern = trimmed.slice(1).trim()
      patterns.push(pattern)
    }
  }

  return patterns
}

/**
 * Expand glob patterns (e.g., examples/*) to actual directories
 */
function expandPattern(pattern: string): string[] {
  if (pattern.endsWith('/*')) {
    const baseDir = join(rootDir, pattern.slice(0, -2))
    if (!existsSync(baseDir) || !statSync(baseDir).isDirectory()) {
      return []
    }
    return readdirSync(baseDir)
      .map(name => join(baseDir, name))
      .filter(path => {
        try {
          return statSync(path).isDirectory() && existsSync(join(path, 'package.json'))
        } catch {
          return false
        }
      })
  }

  const fullPath = join(rootDir, pattern)
  if (existsSync(fullPath) && existsSync(join(fullPath, 'package.json'))) {
    return [fullPath]
  }
  return []
}

/**
 * Get all package directories from the workspace
 */
function getPackageDirs(): string[] {
  const patterns = parseWorkspaceYaml()
  const dirs: string[] = []

  for (const pattern of patterns) {
    dirs.push(...expandPattern(pattern))
  }

  return dirs.sort()
}

/**
 * Read and parse a package.json file
 */
function readPackageJson(pkgDir: string): PackageJson | null {
  const pkgJsonPath = join(pkgDir, 'package.json')
  try {
    return JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Extract repository URL from package.json repository field
 */
function getRepositoryUrl(repo: PackageJson['repository']): string {
  if (!repo) return ''
  if (typeof repo === 'string') return repo
  return repo.url || ''
}

/**
 * Extract metadata from a package.json
 */
function extractMetadata(pkg: PackageJson): PackageMetadata {
  return {
    name: pkg.name || '',
    version: pkg.version || '',
    description: pkg.description || '',
    private: pkg.private === true,
    main: pkg.main || '',
    types: pkg.types || '',
    repository: getRepositoryUrl(pkg.repository),
    homepage: pkg.homepage || '',
    license: pkg.license || '',
    dependencies: Object.keys(pkg.dependencies || {}).length,
    devDependencies: Object.keys(pkg.devDependencies || {}).length,
  }
}

/**
 * Escape a value for TSV format (handle tabs and newlines)
 */
function escapeTsv(value: string | number | boolean): string {
  const str = String(value)
  // Replace tabs and newlines with spaces
  return str.replace(/[\t\n\r]/g, ' ')
}

/**
 * Generate TSV content from package metadata
 */
function generateTsv(packages: PackageMetadata[]): string {
  const headers = [
    'name',
    'version',
    'description',
    'private',
    'main',
    'types',
    'repository',
    'homepage',
    'license',
    'dependencies',
    'devDependencies',
  ]

  const rows: string[] = [headers.join('\t')]

  for (const pkg of packages) {
    const row = [
      escapeTsv(pkg.name),
      escapeTsv(pkg.version),
      escapeTsv(pkg.description),
      escapeTsv(pkg.private),
      escapeTsv(pkg.main),
      escapeTsv(pkg.types),
      escapeTsv(pkg.repository),
      escapeTsv(pkg.homepage),
      escapeTsv(pkg.license),
      escapeTsv(pkg.dependencies),
      escapeTsv(pkg.devDependencies),
    ]
    rows.push(row.join('\t'))
  }

  return rows.join('\n') + '\n'
}

/**
 * Print summary to console
 */
function printSummary(packages: PackageMetadata[]): void {
  console.log('\n=== Package Versions Summary ===\n')

  const publicPackages = packages.filter(p => !p.private)
  const privatePackages = packages.filter(p => p.private)

  console.log(`Total packages: ${packages.length}`)
  console.log(`  Public: ${publicPackages.length}`)
  console.log(`  Private: ${privatePackages.length}`)
  console.log()

  // Print table
  const nameWidth = Math.max(30, ...packages.map(p => p.name.length))
  const versionWidth = 10
  const depsWidth = 6

  console.log(
    'Name'.padEnd(nameWidth) + '  ' +
    'Version'.padEnd(versionWidth) + '  ' +
    'Deps'.padStart(depsWidth) + '  ' +
    'Private'
  )
  console.log('-'.repeat(nameWidth + versionWidth + depsWidth + 20))

  for (const pkg of packages) {
    console.log(
      pkg.name.padEnd(nameWidth) + '  ' +
      pkg.version.padEnd(versionWidth) + '  ' +
      String(pkg.dependencies).padStart(depsWidth) + '  ' +
      (pkg.private ? 'yes' : 'no')
    )
  }

  console.log()

  // Total dependencies
  const totalDeps = packages.reduce((sum, p) => sum + p.dependencies, 0)
  const totalDevDeps = packages.reduce((sum, p) => sum + p.devDependencies, 0)
  console.log(`Total dependencies: ${totalDeps}`)
  console.log(`Total devDependencies: ${totalDevDeps}`)
}

function main() {
  console.log('Generating versions.tsv...\n')

  const dirs = getPackageDirs()
  const packages: PackageMetadata[] = []

  for (const dir of dirs) {
    const pkg = readPackageJson(dir)
    if (pkg && pkg.name) {
      packages.push(extractMetadata(pkg))
    }
  }

  // Sort by name
  packages.sort((a, b) => a.name.localeCompare(b.name))

  // Generate and write TSV
  const tsv = generateTsv(packages)
  const outputPath = join(rootDir, 'versions.tsv')
  writeFileSync(outputPath, tsv)

  console.log(`Written: ${outputPath}`)

  // Print summary
  printSummary(packages)
}

main()
