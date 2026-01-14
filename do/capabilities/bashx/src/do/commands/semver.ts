/**
 * Semver Resolution Module
 *
 * npm-style semantic versioning resolution for package management.
 * This module provides version parsing, comparison, and range matching
 * compatible with Node.js semver package behavior.
 *
 * Part of bashx.do for enabling npm/yarn/pnpm commands in Workers.
 *
 * @module bashx/do/commands/semver
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parsed semantic version
 */
export interface SemVer {
  /** Major version number */
  major: number
  /** Minor version number */
  minor: number
  /** Patch version number */
  patch: number
  /** Prerelease identifiers (e.g., ['alpha', 1] for -alpha.1) */
  prerelease: (string | number)[]
  /** Build metadata (e.g., ['build', '001'] for +build.001) */
  build: string[]
  /** Original raw string */
  raw: string
}

/**
 * Comparator in a range (e.g., >=1.0.0)
 */
export interface Comparator {
  /** Comparison operator */
  operator: '' | '=' | '>' | '>=' | '<' | '<='
  /** Semver to compare against */
  semver: SemVer
}

/**
 * Parsed semver range
 */
export interface SemVerRange {
  /** Original range string */
  raw: string
  /** Set of comparator sets (OR of ANDs) */
  set: Comparator[][]
}

/**
 * Options for semver operations
 */
export interface SemVerOptions {
  /** Include prerelease versions in range matching */
  includePrerelease?: boolean
  /** Loose parsing mode */
  loose?: boolean
}

/**
 * Increment type for version bumping
 */
export type ReleaseType =
  | 'major'
  | 'minor'
  | 'patch'
  | 'premajor'
  | 'preminor'
  | 'prepatch'
  | 'prerelease'

/**
 * Difference type between versions
 */
export type DiffType =
  | 'major'
  | 'minor'
  | 'patch'
  | 'premajor'
  | 'preminor'
  | 'prepatch'
  | 'prerelease'
  | null

// ============================================================================
// PARSING
// ============================================================================

// Regex for semantic versioning
const SEMVER_REGEX = /^[v=]?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/

/**
 * Parse a version string into a SemVer object
 *
 * @param version - Version string to parse (e.g., "1.2.3", "v1.0.0-alpha+build")
 * @returns Parsed SemVer or null if invalid
 */
export function parseSemver(version: string): SemVer | null {
  if (!version || typeof version !== 'string') {
    return null
  }

  // Clean whitespace
  const trimmed = version.trim()
  if (!trimmed) {
    return null
  }

  // Check for negative numbers (invalid)
  if (trimmed.startsWith('-') && !trimmed.startsWith('-0')) {
    return null
  }

  const match = trimmed.match(SEMVER_REGEX)
  if (!match) {
    return null
  }

  const [, majorStr, minorStr, patchStr, prereleaseStr, buildStr] = match

  const major = parseInt(majorStr, 10)
  const minor = parseInt(minorStr, 10)
  const patch = parseInt(patchStr, 10)

  // Parse prerelease
  const prerelease: (string | number)[] = []
  if (prereleaseStr) {
    for (const part of prereleaseStr.split('.')) {
      // Numeric identifiers
      if (/^\d+$/.test(part)) {
        prerelease.push(parseInt(part, 10))
      } else {
        prerelease.push(part)
      }
    }
  }

  // Parse build metadata (kept as strings)
  const build: string[] = buildStr ? buildStr.split('.') : []

  return {
    major,
    minor,
    patch,
    prerelease,
    build,
    raw: version,
  }
}

// ============================================================================
// COMPARISON
// ============================================================================

/**
 * Compare two prerelease arrays
 */
function comparePrerelease(a: (string | number)[], b: (string | number)[]): number {
  // A release version has higher precedence than prerelease
  if (a.length === 0 && b.length > 0) return 1
  if (a.length > 0 && b.length === 0) return -1
  if (a.length === 0 && b.length === 0) return 0

  const minLen = Math.min(a.length, b.length)
  for (let i = 0; i < minLen; i++) {
    const ai = a[i]
    const bi = b[i]

    if (ai === bi) continue

    const aIsNum = typeof ai === 'number'
    const bIsNum = typeof bi === 'number'

    // Numbers have lower precedence than strings
    if (aIsNum && !bIsNum) return -1
    if (!aIsNum && bIsNum) return 1

    if (aIsNum && bIsNum) {
      return ai - bi
    }

    // Both strings
    return (ai as string) < (bi as string) ? -1 : 1
  }

  // Longer prerelease has higher precedence
  return a.length - b.length
}

/**
 * Compare two SemVer objects
 */
function compareSemverObjects(a: SemVer, b: SemVer): number {
  // Compare major
  if (a.major !== b.major) return a.major - b.major

  // Compare minor
  if (a.minor !== b.minor) return a.minor - b.minor

  // Compare patch
  if (a.patch !== b.patch) return a.patch - b.patch

  // Compare prerelease (build metadata is ignored)
  return comparePrerelease(a.prerelease, b.prerelease)
}

/**
 * Compare two semantic versions
 *
 * @param v1 - First version
 * @param v2 - Second version
 * @returns Negative if v1 < v2, positive if v1 > v2, 0 if equal
 */
export function compareSemver(v1: string, v2: string): number {
  const parsed1 = parseSemver(v1)
  const parsed2 = parseSemver(v2)

  if (!parsed1 || !parsed2) {
    throw new Error(`Invalid version: ${!parsed1 ? v1 : v2}`)
  }

  return compareSemverObjects(parsed1, parsed2)
}

// ============================================================================
// RANGE PARSING
// ============================================================================

/**
 * Create a SemVer object from components
 */
function createSemVer(
  major: number,
  minor: number,
  patch: number,
  prerelease: (string | number)[] = [],
  build: string[] = []
): SemVer {
  const prereleaseStr = prerelease.length > 0 ? `-${prerelease.join('.')}` : ''
  const buildStr = build.length > 0 ? `+${build.join('.')}` : ''
  return {
    major,
    minor,
    patch,
    prerelease,
    build,
    raw: `${major}.${minor}.${patch}${prereleaseStr}${buildStr}`,
  }
}

/**
 * Parse a hyphen range (e.g., "1.0.0 - 2.0.0")
 */
function parseHyphenRange(range: string): Comparator[][] | null {
  const hyphenMatch = range.match(/^\s*(\S+)\s+-\s+(\S+)\s*$/)
  if (!hyphenMatch) return null

  const [, from, to] = hyphenMatch

  // Parse the from version (may be partial)
  const fromParts = from.split('.')
  const fromMajor = parseInt(fromParts[0], 10)
  const fromMinor = fromParts.length > 1 ? parseInt(fromParts[1], 10) : 0
  const fromPatch = fromParts.length > 2 ? parseInt(fromParts[2], 10) : 0

  if (isNaN(fromMajor)) return null

  const fromSemver = createSemVer(fromMajor, fromMinor, fromPatch)

  // Parse the to version (may be partial)
  const toParts = to.split('.')
  const toMajor = parseInt(toParts[0], 10)
  const toMinor = toParts.length > 1 ? parseInt(toParts[1], 10) : NaN
  const toPatch = toParts.length > 2 ? parseInt(toParts[2], 10) : NaN

  if (isNaN(toMajor)) return null

  let toSemver: SemVer
  let toOp: '<' | '<=' = '<='

  if (isNaN(toMinor)) {
    // Partial: 1 means <2.0.0-0
    toSemver = createSemVer(toMajor + 1, 0, 0, ['0'])
    toOp = '<'
  } else if (isNaN(toPatch)) {
    // Partial: 1.2 means <1.3.0-0
    toSemver = createSemVer(toMajor, toMinor + 1, 0, ['0'])
    toOp = '<'
  } else {
    toSemver = createSemVer(toMajor, toMinor, toPatch)
  }

  return [[
    { operator: '>=', semver: fromSemver },
    { operator: toOp, semver: toSemver },
  ]]
}

/**
 * Parse X-range (e.g., "1.x", "1.*", "*")
 */
function parseXRange(range: string): Comparator[][] | null {
  const trimmed = range.trim()

  // Handle *, empty string (any version)
  if (trimmed === '*' || trimmed === '') {
    return [[{ operator: '>=', semver: createSemVer(0, 0, 0) }]]
  }

  // Match patterns like 1.x, 1.*, 1.x.x, etc.
  const xMatch = trimmed.match(/^(\d+)(?:\.([x*]|\d+))?(?:\.([x*]|\d+))?$/)
  if (!xMatch) return null

  const [, majorStr, minorPart, patchPart] = xMatch
  const major = parseInt(majorStr, 10)

  // Check if it's an x-range pattern
  const hasXMinor = minorPart === 'x' || minorPart === '*'
  const hasXPatch = patchPart === 'x' || patchPart === '*'
  const hasPartialMinor = minorPart === undefined
  const hasPartialPatch = patchPart === undefined && !hasXMinor

  if (hasXMinor || hasPartialMinor) {
    // 1.x or 1.* means >=1.0.0 <2.0.0-0
    return [[
      { operator: '>=', semver: createSemVer(major, 0, 0) },
      { operator: '<', semver: createSemVer(major + 1, 0, 0, ['0']) },
    ]]
  }

  const minor = parseInt(minorPart, 10)
  if (isNaN(minor)) return null

  if (hasXPatch || hasPartialPatch) {
    // 1.2.x means >=1.2.0 <1.3.0-0
    return [[
      { operator: '>=', semver: createSemVer(major, minor, 0) },
      { operator: '<', semver: createSemVer(major, minor + 1, 0, ['0']) },
    ]]
  }

  return null
}

/**
 * Parse a caret range (^)
 */
function parseCaretRange(range: string): Comparator[][] | null {
  const match = range.match(/^\^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?/)
  if (!match) return null

  const [, majorStr, minorStr, patchStr, prereleaseStr] = match
  const major = parseInt(majorStr, 10)
  const minor = parseInt(minorStr, 10)
  const patch = parseInt(patchStr, 10)

  const prerelease: (string | number)[] = []
  if (prereleaseStr) {
    for (const part of prereleaseStr.split('.')) {
      prerelease.push(/^\d+$/.test(part) ? parseInt(part, 10) : part)
    }
  }

  const fromSemver = createSemVer(major, minor, patch, prerelease)

  let toSemver: SemVer
  if (major === 0 && minor === 0) {
    // ^0.0.x means >=0.0.x <0.0.(x+1)-0
    toSemver = createSemVer(0, 0, patch + 1, ['0'])
  } else if (major === 0) {
    // ^0.x.y means >=0.x.y <0.(x+1).0-0
    toSemver = createSemVer(0, minor + 1, 0, ['0'])
  } else {
    // ^x.y.z means >=x.y.z <(x+1).0.0-0
    toSemver = createSemVer(major + 1, 0, 0, ['0'])
  }

  return [[
    { operator: '>=', semver: fromSemver },
    { operator: '<', semver: toSemver },
  ]]
}

/**
 * Parse a tilde range (~)
 */
function parseTildeRange(range: string): Comparator[][] | null {
  const match = range.match(/^~(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?/)
  if (!match) return null

  const [, majorStr, minorStr, patchStr, prereleaseStr] = match
  const major = parseInt(majorStr, 10)
  const minor = parseInt(minorStr, 10)
  const patch = parseInt(patchStr, 10)

  const prerelease: (string | number)[] = []
  if (prereleaseStr) {
    for (const part of prereleaseStr.split('.')) {
      prerelease.push(/^\d+$/.test(part) ? parseInt(part, 10) : part)
    }
  }

  const fromSemver = createSemVer(major, minor, patch, prerelease)
  const toSemver = createSemVer(major, minor + 1, 0, ['0'])

  return [[
    { operator: '>=', semver: fromSemver },
    { operator: '<', semver: toSemver },
  ]]
}

/**
 * Parse a comparison operator range
 */
function parseComparisonRange(range: string): Comparator[][] | null {
  const match = range.match(/^(>=|<=|>|<|=)?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/)
  if (!match) return null

  const [, op, majorStr, minorStr, patchStr, prereleaseStr, buildStr] = match
  const major = parseInt(majorStr, 10)
  const minor = parseInt(minorStr, 10)
  const patch = parseInt(patchStr, 10)

  const prerelease: (string | number)[] = []
  if (prereleaseStr) {
    for (const part of prereleaseStr.split('.')) {
      prerelease.push(/^\d+$/.test(part) ? parseInt(part, 10) : part)
    }
  }

  const build = buildStr ? buildStr.split('.') : []
  const semver = createSemVer(major, minor, patch, prerelease, build)

  const operator = (op || '') as Comparator['operator']

  return [[{ operator, semver }]]
}

/**
 * Parse a single comparator set (space-separated AND)
 */
function parseComparatorSet(setStr: string): Comparator[] | null {
  const trimmed = setStr.trim()
  if (!trimmed) return null

  // Handle workspace: protocol
  if (trimmed.startsWith('workspace:')) {
    // workspace:*, workspace:^, workspace:~ all match any version
    return [{ operator: '>=', semver: createSemVer(0, 0, 0) }]
  }

  // Try hyphen range first
  const hyphenResult = parseHyphenRange(trimmed)
  if (hyphenResult) return hyphenResult[0]

  // Split by whitespace for AND combinations
  const parts = trimmed.split(/\s+/).filter(Boolean)
  const comparators: Comparator[] = []

  for (const part of parts) {
    let parsed: Comparator[][] | null = null

    if (part.startsWith('^')) {
      parsed = parseCaretRange(part)
    } else if (part.startsWith('~')) {
      parsed = parseTildeRange(part)
    } else if (part.includes('x') || part.includes('*') || /^\d+$/.test(part) || /^\d+\.\d+$/.test(part)) {
      parsed = parseXRange(part)
    } else {
      parsed = parseComparisonRange(part)
    }

    if (!parsed) return null
    comparators.push(...parsed[0])
  }

  return comparators.length > 0 ? comparators : null
}

/**
 * Parse a full range string
 */
function parseRange(range: string): SemVerRange | null {
  const trimmed = range.trim()

  // Handle empty string (any version)
  if (trimmed === '' || trimmed === '*') {
    return {
      raw: range,
      set: [[{ operator: '>=', semver: createSemVer(0, 0, 0) }]],
    }
  }

  // Handle workspace: protocol
  if (trimmed.startsWith('workspace:')) {
    return {
      raw: range,
      set: [[{ operator: '>=', semver: createSemVer(0, 0, 0) }]],
    }
  }

  // Split by || for OR combinations
  const orParts = trimmed.split(/\s*\|\|\s*/)
  const set: Comparator[][] = []

  for (const orPart of orParts) {
    const comparatorSet = parseComparatorSet(orPart)
    if (!comparatorSet) return null
    set.push(comparatorSet)
  }

  return set.length > 0 ? { raw: range, set } : null
}

// ============================================================================
// RANGE MATCHING
// ============================================================================

/**
 * Check if version satisfies a single comparator
 *
 * When includePrerelease is true and the version has a prerelease,
 * we need special handling for >= comparisons: treat the comparator
 * as if it included prereleases (e.g., >=1.0.0 becomes >=1.0.0-0)
 */
function satisfiesComparator(version: SemVer, comp: Comparator, options?: SemVerOptions): boolean {
  let cmp = compareSemverObjects(version, comp.semver)

  // Special handling for includePrerelease with >= operator
  // When the version is a prerelease and we're including prereleases,
  // we want >=1.0.0 to match 1.0.0-alpha (treat as >=1.0.0-0)
  if (
    options?.includePrerelease &&
    version.prerelease.length > 0 &&
    comp.semver.prerelease.length === 0 &&
    comp.operator === '>='
  ) {
    // Compare only major.minor.patch, ignoring prerelease
    if (
      version.major === comp.semver.major &&
      version.minor === comp.semver.minor &&
      version.patch === comp.semver.patch
    ) {
      // 1.0.0-alpha should satisfy >=1.0.0 when includePrerelease is true
      cmp = 0
    } else if (
      version.major > comp.semver.major ||
      (version.major === comp.semver.major && version.minor > comp.semver.minor) ||
      (version.major === comp.semver.major && version.minor === comp.semver.minor && version.patch > comp.semver.patch)
    ) {
      cmp = 1
    }
  }

  switch (comp.operator) {
    case '':
    case '=':
      return cmp === 0
    case '>':
      return cmp > 0
    case '>=':
      return cmp >= 0
    case '<':
      return cmp < 0
    case '<=':
      return cmp <= 0
    default:
      return false
  }
}

/**
 * Check if version has prerelease and if it's allowed
 *
 * The rule is: prerelease versions are only excluded if the version's
 * [major, minor, patch] matches a comparator's [major, minor, patch]
 * AND that comparator doesn't have a prerelease.
 *
 * For example:
 * - 1.0.0-alpha does NOT satisfy ^1.0.0 (same tuple as range start)
 * - 1.2.3-beta DOES satisfy ~1.2.0 (different tuple than range specification)
 */
function prereleaseAllowed(
  version: SemVer,
  comparatorSet: Comparator[],
  options?: SemVerOptions
): boolean {
  if (version.prerelease.length === 0) return true
  if (options?.includePrerelease) return true

  // Check if any comparator in the set matches the version's major.minor.patch
  for (const comp of comparatorSet) {
    // If this comparator's semver matches the version's major.minor.patch
    if (
      version.major === comp.semver.major &&
      version.minor === comp.semver.minor &&
      version.patch === comp.semver.patch
    ) {
      // If the comparator has a prerelease, it's allowed
      if (comp.semver.prerelease.length > 0) {
        return true
      }
      // If the comparator doesn't have a prerelease and matches the tuple,
      // the prerelease version is NOT allowed
      return false
    }
  }

  // No comparator matched the version's tuple, so prerelease is allowed
  return true
}

/**
 * Check if a version satisfies a range
 *
 * @param version - Version to check
 * @param range - Range to match against (e.g., "^1.0.0", ">=1.0.0 <2.0.0")
 * @param options - Matching options
 * @returns true if version satisfies range
 */
export function satisfies(
  version: string,
  range: string,
  options?: SemVerOptions
): boolean {
  const parsed = parseSemver(version)
  if (!parsed) return false

  const parsedRange = parseRange(range)
  if (!parsedRange) return false

  // Check each OR set
  for (const comparatorSet of parsedRange.set) {
    // Check prerelease allowance
    if (!prereleaseAllowed(parsed, comparatorSet, options)) {
      continue
    }

    // All comparators in the set must be satisfied (AND)
    let allSatisfied = true
    for (const comp of comparatorSet) {
      if (!satisfiesComparator(parsed, comp, options)) {
        allSatisfied = false
        break
      }
    }

    if (allSatisfied) return true
  }

  return false
}

/**
 * Find the highest version that satisfies a range
 *
 * @param versions - Array of versions to check
 * @param range - Range to match
 * @param options - Matching options
 * @returns Highest matching version or null
 */
export function maxSatisfying(
  versions: string[],
  range: string,
  options?: SemVerOptions
): string | null {
  let max: string | null = null

  for (const version of versions) {
    if (satisfies(version, range, options)) {
      if (max === null || compareSemver(version, max) > 0) {
        max = version
      }
    }
  }

  return max
}

/**
 * Find the lowest version that satisfies a range
 *
 * @param versions - Array of versions to check
 * @param range - Range to match
 * @param options - Matching options
 * @returns Lowest matching version or null
 */
export function minSatisfying(
  versions: string[],
  range: string,
  options?: SemVerOptions
): string | null {
  let min: string | null = null

  for (const version of versions) {
    if (satisfies(version, range, options)) {
      if (min === null || compareSemver(version, min) < 0) {
        min = version
      }
    }
  }

  return min
}

// ============================================================================
// RANGE UTILITIES
// ============================================================================

/**
 * Normalize a comparator set to a string
 */
function normalizeComparatorSet(comparators: Comparator[]): string {
  return comparators
    .map((c) => {
      const prereleaseStr = c.semver.prerelease.length > 0 ? `-${c.semver.prerelease.join('.')}` : ''
      return `${c.operator}${c.semver.major}.${c.semver.minor}.${c.semver.patch}${prereleaseStr}`
    })
    .join(' ')
}

/**
 * Validate and normalize a range
 *
 * @param range - Range string to validate
 * @returns Normalized range string or null if invalid
 */
export function validRange(range: string): string | null {
  const parsed = parseRange(range.trim())
  if (!parsed) return null

  // For simple exact versions, return as-is
  if (
    parsed.set.length === 1 &&
    parsed.set[0].length === 1 &&
    (parsed.set[0][0].operator === '' || parsed.set[0][0].operator === '=')
  ) {
    const sv = parsed.set[0][0].semver
    return `${sv.major}.${sv.minor}.${sv.patch}`
  }

  // Normalize the range
  return parsed.set.map(normalizeComparatorSet).join(' || ')
}

// ============================================================================
// VERSION UTILITIES
// ============================================================================

/**
 * Coerce a string into a valid semver version
 *
 * @param version - String to coerce (e.g., "1", "1.2", "v1.2.3-alpha")
 * @returns Coerced version string or null
 */
export function coerce(version: string): string | null {
  if (!version || typeof version !== 'string') return null

  const trimmed = version.trim()
  if (!trimmed) return null

  // Try to find a version-like pattern in the string
  const match = trimmed.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!match) return null

  const [, majorStr, minorStr, patchStr] = match
  const major = parseInt(majorStr, 10)
  const minor = minorStr !== undefined ? parseInt(minorStr, 10) : 0
  const patch = patchStr !== undefined ? parseInt(patchStr, 10) : 0

  return `${major}.${minor}.${patch}`
}

/**
 * Clean a version string
 *
 * @param version - Version string to clean
 * @returns Cleaned version or null
 */
export function clean(version: string): string | null {
  if (!version || typeof version !== 'string') return null

  const trimmed = version.trim()

  // Remove v or = prefix
  const cleaned = trimmed.replace(/^[v=]+/, '')

  const parsed = parseSemver(cleaned)
  if (!parsed) return null

  // Return canonical form without build metadata
  const prereleaseStr = parsed.prerelease.length > 0 ? `-${parsed.prerelease.join('.')}` : ''
  return `${parsed.major}.${parsed.minor}.${parsed.patch}${prereleaseStr}`
}

/**
 * Increment a version
 *
 * @param version - Version to increment
 * @param release - Type of increment
 * @param identifier - Prerelease identifier
 * @returns Incremented version
 */
export function inc(
  version: string,
  release: ReleaseType,
  identifier?: string
): string | null {
  const parsed = parseSemver(version)
  if (!parsed) return null

  const { major, minor, patch, prerelease } = parsed

  switch (release) {
    case 'major':
      return `${major + 1}.0.0`

    case 'minor':
      return `${major}.${minor + 1}.0`

    case 'patch':
      return `${major}.${minor}.${patch + 1}`

    case 'premajor':
      return `${major + 1}.0.0-${identifier ? `${identifier}.0` : '0'}`

    case 'preminor':
      return `${major}.${minor + 1}.0-${identifier ? `${identifier}.0` : '0'}`

    case 'prepatch':
      return `${major}.${minor}.${patch + 1}-${identifier ? `${identifier}.0` : '0'}`

    case 'prerelease':
      if (prerelease.length === 0) {
        // No existing prerelease, create one
        return `${major}.${minor}.${patch + 1}-${identifier ? `${identifier}.0` : '0'}`
      }

      // Has existing prerelease
      if (identifier) {
        // Check if identifier matches
        const hasIdentifier = typeof prerelease[0] === 'string' && prerelease[0] === identifier
        if (hasIdentifier && prerelease.length >= 2) {
          const lastIdx = prerelease.length - 1
          const last = prerelease[lastIdx]
          if (typeof last === 'number') {
            const newPrerelease = [...prerelease]
            newPrerelease[lastIdx] = last + 1
            return `${major}.${minor}.${patch}-${newPrerelease.join('.')}`
          }
        }
        // Start fresh with new identifier
        return `${major}.${minor}.${patch + 1}-${identifier}.0`
      }

      // No identifier, increment last numeric part
      const lastIdx = prerelease.length - 1
      const last = prerelease[lastIdx]
      if (typeof last === 'number') {
        const newPrerelease = [...prerelease]
        newPrerelease[lastIdx] = last + 1
        return `${major}.${minor}.${patch}-${newPrerelease.join('.')}`
      } else {
        // Append .0
        return `${major}.${minor}.${patch}-${prerelease.join('.')}.0`
      }

    default:
      return null
  }
}

/**
 * Get the difference between two versions
 *
 * @param v1 - First version
 * @param v2 - Second version
 * @returns Type of difference or null if same
 */
export function diff(v1: string, v2: string): DiffType {
  const parsed1 = parseSemver(v1)
  const parsed2 = parseSemver(v2)

  if (!parsed1 || !parsed2) return null

  // Check if versions are identical
  if (compareSemverObjects(parsed1, parsed2) === 0) return null

  // hasPre1 available for potential future release type detection refinement
  void (parsed1.prerelease.length > 0)
  const hasPre2 = parsed2.prerelease.length > 0

  // Major difference
  if (parsed1.major !== parsed2.major) {
    return hasPre2 ? 'premajor' : 'major'
  }

  // Minor difference
  if (parsed1.minor !== parsed2.minor) {
    return hasPre2 ? 'preminor' : 'minor'
  }

  // Patch difference
  if (parsed1.patch !== parsed2.patch) {
    return hasPre2 ? 'prepatch' : 'patch'
  }

  // Same major.minor.patch, different prerelease
  return 'prerelease'
}

// ============================================================================
// COMMAND SET FOR TIERED EXECUTOR
// ============================================================================

/**
 * Set of semver-related commands handled by this module
 */
export const SEMVER_COMMANDS = new Set(['semver'])

/**
 * Check if a command is a semver command
 */
export function isSemverCommand(cmd: string): boolean {
  return SEMVER_COMMANDS.has(cmd)
}
