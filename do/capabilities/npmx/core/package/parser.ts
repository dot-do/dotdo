/**
 * Package.json Parsing Functions
 *
 * Parses dependencies, scripts, entry points, files, bin, and keywords.
 * This module has ZERO Cloudflare dependencies.
 */

import type {
  ParsedDependency,
  ParsedScript,
  ParsedScripts,
  ParsedFiles,
  ParsedBin,
  ParsedKeywords,
  ParseFilesOptions,
  ParseBinOptions,
  ParseKeywordsOptions,
  EntryPointOptions,
  EntryPointResult,
  PackageJson,
  PackageExports,
  ConditionalExports,
  DependencyType,
} from './types.js'
import { normalizePath, normalizeKeywords } from './normalize.js'

// =============================================================================
// Dependency Parsing
// =============================================================================

/**
 * Determines the type of a dependency specifier.
 */
function getDependencyType(spec: string): DependencyType {
  // Git URLs
  if (spec.startsWith('git+') || spec.startsWith('git://') || spec.startsWith('git@')) {
    return 'git'
  }

  // GitHub shorthand: user/repo or user/repo#ref
  if (/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+/.test(spec) && !spec.includes(':')) {
    return 'github'
  }

  // File protocol
  if (spec.startsWith('file:')) {
    return 'file'
  }

  // npm: alias protocol
  if (spec.startsWith('npm:')) {
    return 'alias'
  }

  // workspace: protocol
  if (spec.startsWith('workspace:')) {
    return 'workspace'
  }

  // URL (tarball)
  if (spec.startsWith('http://') || spec.startsWith('https://')) {
    return 'url'
  }

  // Exact version (no range operators)
  if (/^\d+\.\d+\.\d+/.test(spec) && !/^[\^~>=<]/.test(spec)) {
    return 'exact'
  }

  // Tag (not a valid semver range)
  if (/^[a-zA-Z]/.test(spec) && !/^[\^~>=<]/.test(spec)) {
    return 'tag'
  }

  // Range (default)
  return 'range'
}

/**
 * Validates a semver range.
 */
function isValidSemverRange(range: string): boolean {
  // Basic semver range patterns
  const patterns = [
    /^\d+\.\d+\.\d+/,           // Exact: 1.0.0
    /^\^?\d+(\.\d+)?(\.\d+)?/,  // Caret: ^1.0.0
    /^~?\d+(\.\d+)?(\.\d+)?/,   // Tilde: ~1.0.0
    /^>=?\d+(\.\d+)?(\.\d+)?/,  // GTE: >=1.0.0
    /^<=?\d+(\.\d+)?(\.\d+)?/,  // LTE: <=1.0.0
    /^[*x]$/,                    // Any: * or x
  ]

  return patterns.some(p => p.test(range))
}

/**
 * Parses a dependencies object into structured dependency information.
 */
export function parseDependencies(
  deps: Record<string, string> | undefined,
  options?: { validate?: boolean }
): ParsedDependency[] {
  if (!deps) return []

  const result: ParsedDependency[] = []

  for (const [name, spec] of Object.entries(deps)) {
    const type = getDependencyType(spec)
    const dep: ParsedDependency = {
      name,
      version: spec,
      type,
    }

    // Parse type-specific fields
    switch (type) {
      case 'github': {
        const hashIndex = spec.indexOf('#')
        if (hashIndex !== -1) {
          dep.ref = spec.slice(hashIndex + 1)
        }
        break
      }
      case 'file': {
        dep.path = spec.slice(5) // Remove "file:" prefix
        break
      }
      case 'alias': {
        // npm:real-package@version
        const aliasSpec = spec.slice(4) // Remove "npm:" prefix
        const atIndex = aliasSpec.lastIndexOf('@')
        if (atIndex > 0) {
          dep.realName = aliasSpec.slice(0, atIndex)
          dep.version = aliasSpec.slice(atIndex + 1)
        } else {
          dep.realName = aliasSpec
        }
        break
      }
      case 'url': {
        dep.url = spec
        break
      }
    }

    // Validate if requested
    if (options?.validate) {
      if (type === 'range' || type === 'tag' || type === 'exact') {
        // For range/exact/tag, validate the semver pattern
        if (!isValidSemverRange(spec) && type !== 'exact') {
          dep.valid = false
          dep.error = `Invalid semver range: ${spec}`
        }
      }
    }

    result.push(dep)
  }

  return result
}

// =============================================================================
// Scripts Parsing
// =============================================================================

/**
 * Lifecycle script names
 */
const LIFECYCLE_SCRIPTS = new Set([
  'prepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
  'dependencies',
])

/**
 * Parses a scripts object into structured script information.
 */
export function parseScripts(
  scripts: Record<string, string> | undefined
): ParsedScripts {
  if (!scripts) return {}

  const result: ParsedScripts = {}

  // First pass: collect all scripts
  const scriptNames = Object.keys(scripts)

  for (const name of scriptNames) {
    // Skip pre/post scripts in first pass
    if (name.startsWith('pre') || name.startsWith('post')) {
      // Check if this is a pre/post for another script
      const baseName = name.startsWith('pre') ? name.slice(3) : name.slice(4)
      if (scriptNames.includes(baseName)) {
        continue
      }
    }

    const command = scripts[name]!
    const script: ParsedScript = { command }

    // Check for pre/post scripts
    const preName = `pre${name}`
    const postName = `post${name}`
    if (scripts[preName]) {
      script.pre = scripts[preName]
    }
    if (scripts[postName]) {
      script.post = scripts[postName]
    }

    // Check if lifecycle script
    if (LIFECYCLE_SCRIPTS.has(name)) {
      script.lifecycle = true
    }

    // Detect environment variables
    const envMatches = command.match(/([A-Z_][A-Z0-9_]*)=/g)
    if (envMatches) {
      script.envVars = envMatches.map(m => m.slice(0, -1))
    }

    // Detect npm run references
    const npmRunMatches = command.match(/npm run (\S+)/g)
    if (npmRunMatches) {
      script.references = npmRunMatches.map(m => m.replace('npm run ', ''))
    }

    result[name] = script
  }

  // Second pass: add standalone pre/post scripts
  for (const name of scriptNames) {
    if (name.startsWith('pre') || name.startsWith('post')) {
      const baseName = name.startsWith('pre') ? name.slice(3) : name.slice(4)
      if (!scriptNames.includes(baseName)) {
        // This is a standalone pre/post script
        const command = scripts[name]!
        const script: ParsedScript = { command }

        if (LIFECYCLE_SCRIPTS.has(name)) {
          script.lifecycle = true
        }

        result[name] = script
      }
    }
  }

  return result
}

// =============================================================================
// Entry Point Resolution
// =============================================================================

/**
 * Resolves the entry point for a package based on exports, main, module fields.
 */
export function resolveEntryPoint(
  pkg: Partial<PackageJson>,
  options?: EntryPointOptions
): EntryPointResult {
  const result: EntryPointResult = {
    entry: null,
    main: pkg.main,
  }

  // Handle types field
  if (options?.resolveTypes) {
    result.types = pkg.types ?? pkg.typings

    // Handle typesVersions
    if (pkg.typesVersions && options.tsVersion) {
      const typesPath = resolveTypesVersions(pkg.typesVersions, options.tsVersion)
      if (typesPath) {
        result.typesPath = typesPath
      }
    }
  }

  // Try exports field first (highest priority)
  if (pkg.exports !== undefined) {
    const exportResult = resolveExportsField(
      pkg.exports,
      options?.subpath ?? '.',
      options?.conditions ?? [],
      options?.type ?? 'commonjs'
    )
    result.entry = exportResult
    return result
  }

  // Try module field for ESM
  if (options?.type === 'module' && pkg.module) {
    result.entry = pkg.module
    return result
  }

  // Try main field
  if (pkg.main) {
    result.entry = pkg.main
    return result
  }

  // Default to index.js
  result.entry = './index.js'
  return result
}

/**
 * Resolves the exports field for a given subpath and conditions.
 */
function resolveExportsField(
  exports: PackageExports,
  subpath: string,
  conditions: string[],
  type: 'module' | 'commonjs'
): string | null {
  // Simple string export
  if (typeof exports === 'string') {
    if (subpath === '.') {
      return exports
    }
    return null
  }

  // Null export (restricted)
  if (exports === null) {
    return null
  }

  // Conditional exports object
  if (typeof exports === 'object') {
    // Check if this is a subpath exports map or conditional exports
    const keys = Object.keys(exports)
    const isSubpathMap = keys.some(k => k.startsWith('.'))

    if (isSubpathMap) {
      // Subpath exports map
      let target = exports[subpath]

      // Handle pattern matching (e.g., "./features/*")
      if (!target) {
        for (const pattern of keys) {
          if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace('*', '(.+)') + '$')
            const match = subpath.match(regex)
            if (match) {
              const patternTarget = exports[pattern]
              if (typeof patternTarget === 'string') {
                target = patternTarget.replace('*', match[1]!)
              } else if (patternTarget === null) {
                return null
              }
              break
            }
          }
        }
      }

      if (target === undefined) {
        return null
      }

      if (target === null) {
        return null
      }

      if (typeof target === 'string') {
        return target
      }

      // Resolve conditional target
      return resolveConditionalExport(target as ConditionalExports, conditions, type)
    } else {
      // Conditional exports at root level
      if (subpath !== '.') {
        return null
      }
      return resolveConditionalExport(exports as ConditionalExports, conditions, type)
    }
  }

  return null
}

/**
 * Resolves conditional exports based on conditions and module type.
 */
function resolveConditionalExport(
  conditional: ConditionalExports,
  conditions: string[],
  type: 'module' | 'commonjs'
): string | null {
  // Check user-provided conditions first
  for (const condition of conditions) {
    if (conditional[condition] !== undefined) {
      const value = conditional[condition]
      if (typeof value === 'string') {
        return value
      }
      if (value === null) {
        return null
      }
      if (typeof value === 'object') {
        return resolveConditionalExport(value, conditions.slice(1), type)
      }
    }
  }

  // Check module type conditions
  if (type === 'module' && conditional.import !== undefined) {
    if (typeof conditional.import === 'string') {
      return conditional.import
    }
    if (typeof conditional.import === 'object' && conditional.import !== null) {
      return resolveConditionalExport(conditional.import, conditions, type)
    }
  }

  if (type === 'commonjs' && conditional.require !== undefined) {
    if (typeof conditional.require === 'string') {
      return conditional.require
    }
    if (typeof conditional.require === 'object' && conditional.require !== null) {
      return resolveConditionalExport(conditional.require, conditions, type)
    }
  }

  // Check default
  if (conditional.default !== undefined) {
    if (typeof conditional.default === 'string') {
      return conditional.default
    }
    if (typeof conditional.default === 'object' && conditional.default !== null) {
      return resolveConditionalExport(conditional.default, conditions, type)
    }
  }

  return null
}

/**
 * Resolves typesVersions field based on TypeScript version.
 */
function resolveTypesVersions(
  typesVersions: Record<string, Record<string, string[]>>,
  tsVersion: string
): string | undefined {
  for (const [range, mapping] of Object.entries(typesVersions)) {
    if (matchesVersionRange(tsVersion, range)) {
      // Return the first mapping path
      const paths = Object.values(mapping)[0]
      if (paths && paths.length > 0) {
        return paths[0]
      }
    }
  }
  return undefined
}

/**
 * Checks if a version matches a range pattern.
 */
function matchesVersionRange(version: string, range: string): boolean {
  if (range === '*') return true

  const versionParts = version.split('.').map(Number)
  const major = versionParts[0] ?? 0

  const gteMatch = range.match(/^>=(\d+)/)
  if (gteMatch) {
    return major >= parseInt(gteMatch[1]!, 10)
  }

  return false
}

// =============================================================================
// Files Parsing
// =============================================================================

const ALWAYS_INCLUDED = ['package.json', 'README', 'LICENSE', 'LICENCE', 'CHANGELOG', 'HISTORY']

/**
 * Parses the files field with validation and warnings.
 */
export function parseFiles(
  files: string[] | undefined,
  options?: ParseFilesOptions
): ParsedFiles {
  const result: ParsedFiles = {
    patterns: [],
    negations: [],
    alwaysIncluded: [...ALWAYS_INCLUDED],
    hasGlobs: false,
    includeAll: false,
    warnings: [],
  }

  // If files is undefined, include all files
  if (!files) {
    result.includeAll = true
    return result
  }

  for (const pattern of files) {
    // Negation pattern
    if (pattern.startsWith('!')) {
      result.negations.push(pattern.slice(1))
      continue
    }

    result.patterns.push(pattern)

    // Check for glob patterns
    if (pattern.includes('*') || pattern.includes('?') || pattern.includes('[')) {
      result.hasGlobs = true
    }

    // Validate if requested
    if (options?.validate) {
      // Warn about including src directory
      if (pattern === 'src/' || pattern === 'src' || pattern.startsWith('src/')) {
        result.warnings!.push({
          code: 'SUSPICIOUS_INCLUDE_PATTERN',
          message: 'Including "src/" is unusual; typically only "dist/" is published',
          pattern,
        })
      }
    }
  }

  // Check if main entry point is included (always check when packageJson is provided)
  if (options?.packageJson?.main) {
    const main = options.packageJson.main
    // Normalize main path (handle both ./dist/index.js and dist/index.js)
    const mainPath = main.startsWith('./') ? main.slice(2) : main

    const isIncluded = result.patterns.some(pattern => {
      // Normalize pattern (remove trailing slash for comparison)
      const normalizedPattern = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern

      // Check if main starts with the pattern directory
      if (mainPath.startsWith(normalizedPattern + '/') || mainPath === normalizedPattern) {
        return true
      }

      // Check exact match
      if (mainPath === pattern) {
        return true
      }

      return false
    })

    if (!isIncluded) {
      result.warnings!.push({
        code: 'MAIN_NOT_INCLUDED',
        message: `Main entry point "${main}" may not be included in published files`,
      })
    }
  }

  return result
}

// =============================================================================
// Bin Parsing
// =============================================================================

/**
 * Parses the bin field into a normalized object.
 */
export function parseBin(
  pkg: Partial<PackageJson>,
  options?: ParseBinOptions
): ParsedBin {
  const result: ParsedBin = {}

  if (!pkg.bin) {
    return result
  }

  // String bin: use package name as command
  if (typeof pkg.bin === 'string') {
    // Get command name from package name
    let commandName = pkg.name ?? ''
    if (commandName.startsWith('@')) {
      // Scoped package: use name after scope
      const slashIndex = commandName.indexOf('/')
      if (slashIndex !== -1) {
        commandName = commandName.slice(slashIndex + 1)
      }
    }
    const binPath = normalizePath(pkg.bin)
    result[commandName] = binPath

    // Validate path is in files for string bin too
    if (options?.validatePaths && pkg.files) {
      const warnings: Array<{ code: string; message: string; name?: string }> = []
      const pathWithoutPrefix = binPath.startsWith('./') ? binPath.slice(2) : binPath
      const isIncluded = pkg.files.some(pattern => {
        if (pattern.endsWith('/')) {
          return pathWithoutPrefix.startsWith(pattern.slice(0, -1))
        }
        return pathWithoutPrefix === pattern || pathWithoutPrefix.startsWith(pattern + '/')
      })

      if (!isIncluded) {
        warnings.push({
          code: 'BIN_NOT_IN_FILES',
          message: `Bin "${commandName}" path "${binPath}" may not be included in published files`,
        })
      }

      if (warnings.length > 0) {
        (result as ParsedBin).warnings = warnings as ParsedBin['warnings']
      }
    }

    return result
  }

  // Object bin
  const warnings: Array<{ code: string; message: string; name?: string }> = []
  const errors: Array<{ code: string; message: string; name?: string }> = []

  for (const [name, path] of Object.entries(pkg.bin)) {
    // Validate command name
    if (options?.validate && /\s/.test(name)) {
      errors.push({
        code: 'INVALID_BIN_NAME',
        message: `Bin command name "${name}" cannot contain spaces`,
        name,
      })
      continue
    }

    result[name] = normalizePath(path)
  }

  // Validate paths are in files
  if (options?.validatePaths && pkg.files) {
    for (const [name, path] of Object.entries(result)) {
      const pathWithoutPrefix = path.startsWith('./') ? path.slice(2) : path
      const isIncluded = pkg.files.some(pattern => {
        if (pattern.endsWith('/')) {
          return pathWithoutPrefix.startsWith(pattern.slice(0, -1))
        }
        return pathWithoutPrefix === pattern || pathWithoutPrefix.startsWith(pattern + '/')
      })

      if (!isIncluded) {
        warnings.push({
          code: 'BIN_NOT_IN_FILES',
          message: `Bin "${name}" path "${path}" may not be included in published files`,
        })
      }
    }
  }

  if (warnings.length > 0) {
    (result as ParsedBin).warnings = warnings as ParsedBin['warnings']
  }
  if (errors.length > 0) {
    (result as ParsedBin).errors = errors as ParsedBin['errors']
  }

  return result
}

// =============================================================================
// Keywords Parsing
// =============================================================================

/**
 * Parses and normalizes keywords array.
 */
export function parseKeywords(
  keywords: unknown[] | undefined,
  options?: ParseKeywordsOptions
): ParsedKeywords | string[] {
  if (!keywords || !Array.isArray(keywords)) {
    return []
  }

  const normalized = normalizeKeywords(keywords)
  const result = normalized as ParsedKeywords

  // Validate if requested
  if (options?.validate) {
    const warnings: Array<{ code: string; message: string }> = []

    for (const keyword of normalized) {
      if (keyword.length > 50) {
        warnings.push({
          code: 'KEYWORD_TOO_LONG',
          message: `Keyword "${keyword.slice(0, 20)}..." exceeds recommended length`,
        })
      }
    }

    if (warnings.length > 0) {
      result.warnings = warnings as ParsedKeywords['warnings']
    }
  }

  return result
}
