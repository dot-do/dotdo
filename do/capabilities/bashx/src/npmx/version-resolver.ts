/**
 * NPM Version Resolver
 *
 * Handles semver range resolution for npm packages.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface PackageSpec {
  name: string
  scope?: string
  version?: string
  range?: string
  normalizedRange?: string
  tag?: string
  protocol?: string
  alias?: string
}

export interface SemverRange {
  raw: string
  normalized: string
  comparators: SemverComparator[][]
}

export interface SemverComparator {
  operator: '' | '=' | '<' | '>' | '<=' | '>=' | '~' | '^'
  major: number
  minor: number
  patch: number
  prerelease?: (string | number)[]
  build?: string[]
}

export interface ResolveOptions {
  includePrerelease?: boolean
}

export interface LatestVersionOptions {
  includePrerelease?: boolean
}

// =============================================================================
// CONSTANTS
// =============================================================================

const SEMVER_REGEX = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z\-.]+))?(?:\+([0-9A-Za-z\-.]+))?$/

// Invalid package names per npm rules
const INVALID_PACKAGE_PATTERNS = [
  /^\./, // starts with dot
  /^_/, // starts with underscore
  /[A-Z]/, // uppercase
  /\s/, // contains spaces
  /^\.\./, // path traversal
  /^node_modules$/, // reserved
  /^favicon\.ico$/, // reserved
]

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function parseVersion(version: string): {
  major: number
  minor: number
  patch: number
  prerelease?: (string | number)[]
  build?: string[]
} | null {
  const match = version.match(SEMVER_REGEX)
  if (!match) return null

  const [, major, minor, patch, prereleaseStr, buildStr] = match
  const prerelease = prereleaseStr
    ? prereleaseStr.split('.').map((p) => (/^\d+$/.test(p) ? parseInt(p, 10) : p))
    : undefined
  const build = buildStr ? buildStr.split('.') : undefined

  return {
    major: parseInt(major, 10),
    minor: parseInt(minor, 10),
    patch: parseInt(patch, 10),
    prerelease,
    build,
  }
}

function isValidPackageName(name: string): boolean {
  if (!name || name.length === 0 || name.length > 214) return false

  // Check for scoped packages - extract the package name part after scope
  let baseName = name
  if (name.startsWith('@')) {
    const slashIndex = name.indexOf('/')
    if (slashIndex === -1) return false
    // For scoped packages, validate the name after scope (but allow slashes for deep paths)
    baseName = name.slice(slashIndex + 1)
    // If there's another slash, it's a deep scoped package - still valid
  }

  // Check against invalid patterns (but not on scope part)
  for (const pattern of INVALID_PACKAGE_PATTERNS) {
    if (pattern.test(baseName)) return false
  }

  // Check for path traversal
  if (name.includes('..')) return false

  return true
}

function isDistTag(version: string): boolean {
  // Dist tags are non-semver strings like 'latest', 'next', 'beta', etc.
  return !SEMVER_REGEX.test(version) && !isRange(version)
}

function isRange(range: string): boolean {
  // Contains range operators or wildcards
  return (
    range.includes('^') ||
    range.includes('~') ||
    range.includes('>') ||
    range.includes('<') ||
    range.includes('=') ||
    range.includes(' ') ||
    range.includes('||') ||
    range.includes('x') ||
    range.includes('X') ||
    range === '*'
  )
}

function normalizeXRange(range: string): string {
  // Convert x-ranges to proper ranges
  // 1.x -> >=1.0.0 <2.0.0-0
  // 1.2.x -> >=1.2.0 <1.3.0-0
  // * -> >=0.0.0

  if (range === '*' || range === 'x' || range === 'X') {
    return '>=0.0.0'
  }

  const xRangeMatch = range.match(/^(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/)
  if (xRangeMatch) {
    const [, major, minor, patch] = xRangeMatch

    if (!minor || minor === 'x' || minor === 'X' || minor === '*') {
      return `>=${major}.0.0 <${parseInt(major) + 1}.0.0-0`
    }

    if (!patch || patch === 'x' || patch === 'X' || patch === '*') {
      return `>=${major}.${minor}.0 <${major}.${parseInt(minor) + 1}.0-0`
    }
  }

  return range
}

// =============================================================================
// FUNCTIONS
// =============================================================================

export function parsePackageSpec(spec: string): PackageSpec {
  let remaining = spec
  let alias: string | undefined
  let protocol: string | undefined

  // Handle alias format: my-lodash@npm:lodash@4.17.21
  if (!remaining.startsWith('@') && remaining.includes('@npm:')) {
    const aliasMatch = remaining.match(/^([^@]+)@npm:(.+)$/)
    if (aliasMatch) {
      alias = aliasMatch[1]
      remaining = aliasMatch[2]
      protocol = 'npm'
    }
  }
  // Handle npm: protocol without alias
  else if (remaining.startsWith('npm:')) {
    protocol = 'npm'
    remaining = remaining.slice(4)
  }

  let name: string
  let scope: string | undefined
  let version: string | undefined
  let range: string | undefined
  let tag: string | undefined
  let normalizedRange: string | undefined

  // Parse scoped package: @scope/name[@version]
  if (remaining.startsWith('@')) {
    const scopeMatch = remaining.match(/^(@[^/]+\/[^@]+)(?:@(.+))?$/)
    // Also handle deep scoped like @org/scope/deep
    const deepMatch = remaining.match(/^(@[^/]+\/.+?)(?:@(\d.*))?$/)

    if (scopeMatch) {
      name = scopeMatch[1]
      const scopePart = name.match(/^(@[^/]+)\//)
      scope = scopePart ? scopePart[1] : undefined
      const versionPart = scopeMatch[2]

      if (versionPart) {
        if (SEMVER_REGEX.test(versionPart)) {
          version = versionPart
        } else if (isRange(versionPart)) {
          range = versionPart
          normalizedRange = normalizeXRange(versionPart)
        } else {
          tag = versionPart
        }
      }
    } else if (deepMatch) {
      name = deepMatch[1]
      const scopePart = name.match(/^(@[^/]+)\//)
      scope = scopePart ? scopePart[1] : undefined
      const versionPart = deepMatch[2]
      if (versionPart) {
        version = versionPart
      }
    } else {
      throw new Error(`Invalid package name: ${spec}`)
    }
  } else {
    // Parse non-scoped package: name[@version]
    const match = remaining.match(/^([^@]+)(?:@(.+))?$/)
    if (!match) {
      throw new Error(`Invalid package name: ${spec}`)
    }

    name = match[1]
    const versionPart = match[2]

    if (versionPart) {
      if (SEMVER_REGEX.test(versionPart)) {
        version = versionPart
      } else if (isRange(versionPart)) {
        range = versionPart
        normalizedRange = normalizeXRange(versionPart)
      } else if (isDistTag(versionPart)) {
        tag = versionPart
      }
    }
  }

  // Validate package name
  if (!isValidPackageName(name)) {
    throw new Error(`Invalid package name: ${name}`)
  }

  return {
    name,
    scope,
    version,
    range,
    normalizedRange,
    tag,
    protocol,
    alias,
  }
}

export function resolveVersion(
  versions: string[],
  range: string,
  options?: ResolveOptions
): string | null {
  const includePrerelease = options?.includePrerelease ?? false

  // Exact version match
  if (SEMVER_REGEX.test(range) && versions.includes(range)) {
    return range
  }

  // Find all matching versions
  const matching = versions.filter((v) => {
    const parsed = parseVersion(v)
    if (!parsed) return false

    // Skip prereleases unless explicitly included
    if (parsed.prerelease && !includePrerelease) {
      // Allow prerelease if range specifically mentions prereleases
      if (!range.includes('-')) {
        return false
      }
    }

    return matchesRange(v, range)
  })

  if (matching.length === 0) return null

  // Return highest matching version
  const sorted = sortVersions(matching, 'desc')
  return sorted[0]
}

export function matchesRange(version: string, range: string): boolean {
  const parsed = parseVersion(version)
  if (!parsed) return false

  // Normalize range
  const normalizedRange = normalizeXRange(range)

  // Handle * (any version)
  if (range === '*' || normalizedRange === '>=0.0.0') {
    return true
  }

  // Handle exact version match
  if (SEMVER_REGEX.test(range)) {
    const rangeVer = parseVersion(range)
    if (!rangeVer) return false
    return (
      parsed.major === rangeVer.major &&
      parsed.minor === rangeVer.minor &&
      parsed.patch === rangeVer.patch
    )
  }

  // Handle OR ranges (||)
  if (range.includes('||')) {
    const parts = range.split('||').map((p) => p.trim())
    return parts.some((p) => matchesRange(version, p))
  }

  // Handle hyphen ranges (1.0.0 - 2.0.0)
  const hyphenMatch = range.match(/^(\d+\.\d+\.\d+)\s*-\s*(\d+\.\d+\.\d+)$/)
  if (hyphenMatch) {
    return matchesRange(version, `>=${hyphenMatch[1]}`) && matchesRange(version, `<=${hyphenMatch[2]}`)
  }

  // Handle AND ranges (space separated)
  if (range.includes(' ') && !range.includes(' - ')) {
    const parts = range.split(/\s+/).filter(Boolean)
    return parts.every((p) => matchesRange(version, p))
  }

  // Handle caret range (^)
  if (range.startsWith('^')) {
    const rangeVer = parseVersion(range.slice(1))
    if (!rangeVer) return false

    // For ^0.x.y, the rules are different
    if (rangeVer.major === 0) {
      if (rangeVer.minor === 0) {
        // ^0.0.x matches only 0.0.x
        return (
          parsed.major === 0 &&
          parsed.minor === 0 &&
          parsed.patch === rangeVer.patch
        )
      }
      // ^0.x.y matches 0.x.*
      return parsed.major === 0 && parsed.minor === rangeVer.minor && parsed.patch >= rangeVer.patch
    }

    // For ^x.y.z where x > 0, matches x.*.*
    return (
      parsed.major === rangeVer.major &&
      (parsed.minor > rangeVer.minor ||
        (parsed.minor === rangeVer.minor && parsed.patch >= rangeVer.patch))
    )
  }

  // Handle tilde range (~)
  if (range.startsWith('~')) {
    const rangeVer = parseVersion(range.slice(1))
    if (!rangeVer) return false

    // ~x.y.z matches x.y.*
    return (
      parsed.major === rangeVer.major &&
      parsed.minor === rangeVer.minor &&
      parsed.patch >= rangeVer.patch
    )
  }

  // Handle comparison operators
  if (range.startsWith('>=')) {
    const rangeVer = parseVersion(range.slice(2))
    if (!rangeVer) return false
    return compareSemver(version, range.slice(2)) >= 0
  }

  if (range.startsWith('<=')) {
    const rangeVer = parseVersion(range.slice(2))
    if (!rangeVer) return false
    return compareSemver(version, range.slice(2)) <= 0
  }

  if (range.startsWith('>')) {
    const rangeVer = parseVersion(range.slice(1))
    if (!rangeVer) return false
    return compareSemver(version, range.slice(1)) > 0
  }

  if (range.startsWith('<')) {
    const compareTo = range.slice(1)
    // Handle prerelease ceiling like <2.0.0-0
    if (compareTo.endsWith('-0')) {
      const base = compareTo.slice(0, -2)
      const baseVer = parseVersion(base + '.0')
      if (!baseVer) {
        // Try parsing as full version
        const fullVer = parseVersion(base)
        if (!fullVer) return false
        return compareSemver(version, base) < 0
      }
      return compareSemver(version, base) < 0
    }
    const rangeVer = parseVersion(compareTo)
    if (!rangeVer) return false
    return compareSemver(version, compareTo) < 0
  }

  if (range.startsWith('=')) {
    return matchesRange(version, range.slice(1))
  }

  // Handle x-ranges (already normalized above)
  if (normalizedRange !== range) {
    return matchesRange(version, normalizedRange)
  }

  return false
}

export function sortVersions(versions: string[], order?: 'asc' | 'desc'): string[] {
  const sorted = [...versions].sort(compareSemver)
  return order === 'desc' ? sorted.reverse() : sorted
}

export function getLatestVersion(versions: string[], options?: LatestVersionOptions): string {
  const includePrerelease = options?.includePrerelease ?? false

  // Filter out prereleases unless requested
  let candidates = versions
  if (!includePrerelease) {
    const stableVersions = versions.filter((v) => {
      const parsed = parseVersion(v)
      return parsed && !parsed.prerelease
    })
    if (stableVersions.length > 0) {
      candidates = stableVersions
    }
  }

  const sorted = sortVersions(candidates, 'desc')
  return sorted[0]
}

export function parseRange(range: string): SemverRange {
  const normalized = normalizeXRange(range)
  // Simplified implementation - returns basic structure
  return {
    raw: range,
    normalized,
    comparators: [], // Full parsing would be more complex
  }
}

export function compareSemver(a: string, b: string): number {
  const parsedA = parseVersion(a)
  const parsedB = parseVersion(b)

  if (!parsedA && !parsedB) return 0
  if (!parsedA) return -1
  if (!parsedB) return 1

  // Compare major.minor.patch
  if (parsedA.major !== parsedB.major) {
    return parsedA.major - parsedB.major
  }
  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor - parsedB.minor
  }
  if (parsedA.patch !== parsedB.patch) {
    return parsedA.patch - parsedB.patch
  }

  // Versions without prerelease come after versions with prerelease
  const aHasPre = parsedA.prerelease && parsedA.prerelease.length > 0
  const bHasPre = parsedB.prerelease && parsedB.prerelease.length > 0

  if (!aHasPre && bHasPre) return 1
  if (aHasPre && !bHasPre) return -1

  // Compare prerelease identifiers if both have them
  if (aHasPre && bHasPre) {
    const aPre = parsedA.prerelease!
    const bPre = parsedB.prerelease!
    const maxLen = Math.max(aPre.length, bPre.length)

    for (let i = 0; i < maxLen; i++) {
      if (i >= aPre.length) return -1
      if (i >= bPre.length) return 1

      const aVal = aPre[i]
      const bVal = bPre[i]

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        if (aVal !== bVal) return aVal - bVal
      } else if (typeof aVal === 'number') {
        return -1 // Numbers come before strings
      } else if (typeof bVal === 'number') {
        return 1
      } else {
        const cmp = aVal.localeCompare(bVal)
        if (cmp !== 0) return cmp
      }
    }
  }

  // Build metadata should be ignored for precedence, but versions without
  // build metadata should come before versions with build metadata when
  // everything else is equal
  const aHasBuild = parsedA.build && parsedA.build.length > 0
  const bHasBuild = parsedB.build && parsedB.build.length > 0

  if (!aHasBuild && bHasBuild) return -1
  if (aHasBuild && !bHasBuild) return 1

  return 0
}

export function isPrerelease(version: string): boolean {
  const parsed = parseVersion(version)
  return parsed !== null && parsed.prerelease !== undefined && parsed.prerelease.length > 0
}

export function isValidVersion(version: string): boolean {
  return parseVersion(version) !== null
}

export function isValidRange(range: string): boolean {
  // Basic validation - could be more thorough
  try {
    parseRange(range)
    return true
  } catch {
    return false
  }
}
