/**
 * Semver Range Resolution
 *
 * Parse and evaluate version ranges with npm-compatible semantics.
 *
 * Performance optimizations:
 * - LRU cache for parsed ranges (avoids repeated regex parsing)
 * - LRU cache for parsed versions (avoids repeated string parsing)
 * - Memoized satisfies checks for common version/range pairs
 */

import type {
  SatisfiesOptions,
  Range,
  Comparator,
  ComparatorOperator,
  SemVerObject,
} from './types'
import { parse, compareVersions } from './parse'

// ============================================
// LRU Cache Implementation
// ============================================

/**
 * Simple LRU cache for parsed ranges and versions
 */
class LRUCache<K, V> {
  private cache: Map<K, V>
  private maxSize: number

  constructor(maxSize: number) {
    this.cache = new Map()
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    // Delete if exists to update position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first) entry
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, value)
  }

  clear(): void {
    this.cache.clear()
  }
}

// Cache for parsed ranges (key: range string)
const rangeCache = new LRUCache<string, Range | null>(1000)

// Cache for parsed versions (key: version string)
const versionCache = new LRUCache<string, SemVerObject | null>(2000)

// Cache for satisfies results (key: "version@range")
const satisfiesCache = new LRUCache<string, boolean>(5000)

/**
 * Clear all caches (useful for testing or memory management)
 */
export function clearCaches(): void {
  rangeCache.clear()
  versionCache.clear()
  satisfiesCache.clear()
}

/**
 * Get cached parsed version or parse and cache
 */
function getCachedVersion(version: string, options?: SatisfiesOptions): SemVerObject | null {
  const cacheKey = options?.loose ? `loose:${version}` : version
  let cached = versionCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  const cleanVersion = version.replace(/^v/, '')
  cached = parse(cleanVersion, { loose: false })
  if (!cached && options?.loose) {
    cached = parse(cleanVersion, { loose: true })
  }

  versionCache.set(cacheKey, cached)
  return cached
}

/**
 * Get cached parsed range or parse and cache
 */
function getCachedRange(range: string, options?: SatisfiesOptions): Range | null {
  const cacheKey = options?.includePrerelease ? `pre:${range}` : range
  let cached = rangeCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  const cleanRange = range.replace(/^v(?=[0-9])/, '')
  cached = parseRangeInternal(cleanRange, options)
  rangeCache.set(cacheKey, cached)
  return cached
}

// Patterns for parsing ranges
const COMPARATOR = /^([<>=!]*)\s*(v?[0-9]+(?:\.[0-9]+)?(?:\.[0-9]+)?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\s*$/

// X-range patterns
const XRANGE = /^([~^]?)([v=]?\s*)?(?:([0-9]+|[xX*])(?:\.([0-9]+|[xX*])(?:\.([0-9]+|[xX*]))?)?)?(-[0-9A-Za-z.-]+)?$/

// Hyphen range: 1.0.0 - 2.0.0
const HYPHEN_RANGE = /^\s*([v=]?\s*[0-9]+(?:\.[0-9]+)?(?:\.[0-9]+)?(?:-[0-9A-Za-z.-]+)?)\s*-\s*([v=]?\s*[0-9]+(?:\.[0-9]+)?(?:\.[0-9]+)?(?:-[0-9A-Za-z.-]+)?)\s*$/

/**
 * Check if a string represents any version (wildcard)
 */
function isX(val: string | undefined): boolean {
  return val === undefined || val === '' || val === 'x' || val === 'X' || val === '*'
}

/**
 * Parse a partial version and fill in missing parts
 */
function parsePartialVersion(str: string): { major: number; minor?: number | undefined; patch?: number | undefined; prerelease?: string | undefined } | null {
  const cleaned = str.trim().replace(/^[v=]\s*/, '')
  const parts = cleaned.split(/[-+]/)
  const versionPart = parts[0]
  if (versionPart === undefined) return null

  const prerelease = parts[1]

  const nums = versionPart.split('.')
  const majorStr = nums[0]
  if (majorStr === undefined) return null
  const major = parseInt(majorStr, 10)

  if (isNaN(major)) return null

  const minorStr = nums[1]
  const patchStr = nums[2]
  const minor = minorStr !== undefined && !isX(minorStr) ? parseInt(minorStr, 10) : undefined
  const patch = patchStr !== undefined && !isX(patchStr) ? parseInt(patchStr, 10) : undefined

  return { major, minor, patch, prerelease }
}

/**
 * Create a comparator from operator and version string
 */
function createComparator(operator: ComparatorOperator, version: string): Comparator {
  const semver = parse(version, { loose: true })
  return {
    operator,
    semver,
    value: operator + version,
  }
}

/**
 * Create a comparator from a full SemVer object
 */
function createComparatorFromSemVer(operator: ComparatorOperator, semver: SemVerObject | null): Comparator {
  return {
    operator,
    semver,
    value: semver ? operator + semver.version : operator,
  }
}

/**
 * Parse a tilde range (~)
 * ~1.2.3 := >=1.2.3 <1.3.0-0
 * ~1.2 := >=1.2.0 <1.3.0-0
 * ~1 := >=1.0.0 <2.0.0-0
 */
function parseTildeRange(major: number, minor?: number, patch?: number, prerelease?: string): Comparator[] {
  if (minor === undefined) {
    // ~1 → >=1.0.0 <2.0.0-0
    return [
      createComparator('>=', `${major}.0.0`),
      createComparatorFromSemVer('<', { major: major + 1, minor: 0, patch: 0, prerelease: [0], build: [], version: `${major + 1}.0.0-0`, raw: '' }),
    ]
  }

  if (patch === undefined) {
    // ~1.2 → >=1.2.0 <1.3.0-0
    return [
      createComparator('>=', `${major}.${minor}.0`),
      createComparatorFromSemVer('<', { major, minor: minor + 1, patch: 0, prerelease: [0], build: [], version: `${major}.${minor + 1}.0-0`, raw: '' }),
    ]
  }

  // ~1.2.3 → >=1.2.3 <1.3.0-0
  const from = prerelease ? `${major}.${minor}.${patch}-${prerelease}` : `${major}.${minor}.${patch}`
  return [
    createComparator('>=', from),
    createComparatorFromSemVer('<', { major, minor: minor + 1, patch: 0, prerelease: [0], build: [], version: `${major}.${minor + 1}.0-0`, raw: '' }),
  ]
}

/**
 * Parse a caret range (^)
 * ^1.2.3 := >=1.2.3 <2.0.0-0
 * ^0.2.3 := >=0.2.3 <0.3.0-0
 * ^0.0.3 := >=0.0.3 <0.0.4-0
 * ^1.2.x := >=1.2.0 <2.0.0-0
 * ^0.0.x := >=0.0.0 <0.1.0-0
 * ^0.0 := >=0.0.0 <0.1.0-0
 */
function parseCaretRange(major: number, minor?: number, patch?: number, prerelease?: string): Comparator[] {
  if (major === 0) {
    if (minor === undefined) {
      // ^0 or ^0.x → >=0.0.0 <1.0.0-0
      return [
        createComparator('>=', '0.0.0'),
        createComparatorFromSemVer('<', { major: 1, minor: 0, patch: 0, prerelease: [0], build: [], version: '1.0.0-0', raw: '' }),
      ]
    }

    if (minor === 0) {
      if (patch === undefined) {
        // ^0.0 or ^0.0.x → >=0.0.0 <0.1.0-0
        return [
          createComparator('>=', '0.0.0'),
          createComparatorFromSemVer('<', { major: 0, minor: 1, patch: 0, prerelease: [0], build: [], version: '0.1.0-0', raw: '' }),
        ]
      }

      // ^0.0.3 → >=0.0.3 <0.0.4-0
      const from = prerelease ? `0.0.${patch}-${prerelease}` : `0.0.${patch}`
      return [
        createComparator('>=', from),
        createComparatorFromSemVer('<', { major: 0, minor: 0, patch: patch + 1, prerelease: [0], build: [], version: `0.0.${patch + 1}-0`, raw: '' }),
      ]
    }

    // ^0.2.3 → >=0.2.3 <0.3.0-0
    const patchVal = patch ?? 0
    const from = prerelease ? `0.${minor}.${patchVal}-${prerelease}` : `0.${minor}.${patchVal}`
    return [
      createComparator('>=', from),
      createComparatorFromSemVer('<', { major: 0, minor: minor + 1, patch: 0, prerelease: [0], build: [], version: `0.${minor + 1}.0-0`, raw: '' }),
    ]
  }

  // ^1.2.3 → >=1.2.3 <2.0.0-0
  const minorVal = minor ?? 0
  const patchVal = patch ?? 0
  const from = prerelease ? `${major}.${minorVal}.${patchVal}-${prerelease}` : `${major}.${minorVal}.${patchVal}`
  return [
    createComparator('>=', from),
    createComparatorFromSemVer('<', { major: major + 1, minor: 0, patch: 0, prerelease: [0], build: [], version: `${major + 1}.0.0-0`, raw: '' }),
  ]
}

/**
 * Parse a hyphen range (1.0.0 - 2.0.0)
 */
function parseHyphenRange(from: string, to: string): Comparator[] {
  const fromParsed = parsePartialVersion(from)
  const toParsed = parsePartialVersion(to)

  if (!fromParsed || !toParsed) return []

  const comparators: Comparator[] = []

  // From: fill in missing parts with 0
  const fromMajor = fromParsed.major
  const fromMinor = fromParsed.minor ?? 0
  const fromPatch = fromParsed.patch ?? 0
  comparators.push(createComparator('>=', `${fromMajor}.${fromMinor}.${fromPatch}`))

  // To: if partial, use < (next major/minor)
  if (toParsed.patch === undefined) {
    if (toParsed.minor === undefined) {
      // "1.0.0 - 2" → <3.0.0-0
      comparators.push(createComparatorFromSemVer('<', {
        major: toParsed.major + 1, minor: 0, patch: 0, prerelease: [0], build: [], version: `${toParsed.major + 1}.0.0-0`, raw: ''
      }))
    } else {
      // "1.0.0 - 2.3" → <2.4.0-0
      comparators.push(createComparatorFromSemVer('<', {
        major: toParsed.major, minor: toParsed.minor + 1, patch: 0, prerelease: [0], build: [], version: `${toParsed.major}.${toParsed.minor + 1}.0-0`, raw: ''
      }))
    }
  } else {
    // Full version: use <=
    comparators.push(createComparator('<=', `${toParsed.major}.${toParsed.minor}.${toParsed.patch}`))
  }

  return comparators
}

/**
 * Parse an X-range (1.x, 1.2.x, *, 1.*, etc.)
 */
function parseXRange(major: number | undefined, minor: number | undefined, patch: number | undefined): Comparator[] {
  if (major === undefined) {
    // * → any version
    return [createComparator('>=', '0.0.0')]
  }

  if (minor === undefined) {
    // 1 or 1.x → >=1.0.0 <2.0.0-0
    return [
      createComparator('>=', `${major}.0.0`),
      createComparatorFromSemVer('<', { major: major + 1, minor: 0, patch: 0, prerelease: [0], build: [], version: `${major + 1}.0.0-0`, raw: '' }),
    ]
  }

  if (patch === undefined) {
    // 1.2 or 1.2.x → >=1.2.0 <1.3.0-0
    return [
      createComparator('>=', `${major}.${minor}.0`),
      createComparatorFromSemVer('<', { major, minor: minor + 1, patch: 0, prerelease: [0], build: [], version: `${major}.${minor + 1}.0-0`, raw: '' }),
    ]
  }

  // Full version: exact match
  return [createComparator('=', `${major}.${minor}.${patch}`)]
}

/**
 * Parse a single comparator set (no ||)
 */
function parseComparatorSet(range: string, _options?: SatisfiesOptions): Comparator[] {
  range = range.trim()

  // Empty or * means any version
  if (range === '' || range === '*') {
    return [createComparator('>=', '0.0.0')]
  }

  // Check for hyphen range first
  const hyphenMatch = range.match(HYPHEN_RANGE)
  if (hyphenMatch && hyphenMatch[1] !== undefined && hyphenMatch[2] !== undefined) {
    return parseHyphenRange(hyphenMatch[1], hyphenMatch[2])
  }

  // Split by whitespace (AND)
  const parts = range.split(/\s+/).filter(p => p.length > 0)
  const comparators: Comparator[] = []

  for (const part of parts) {
    // Check for tilde or caret
    const xrangeMatch = part.match(XRANGE)
    if (xrangeMatch) {
      const [, prefix, , majorStr, minorStr, patchStr, prerelease] = xrangeMatch

      const major = majorStr !== undefined && !isX(majorStr) ? parseInt(majorStr, 10) : undefined
      const minor = minorStr !== undefined && !isX(minorStr) ? parseInt(minorStr, 10) : undefined
      const patch = patchStr !== undefined && !isX(patchStr) ? parseInt(patchStr, 10) : undefined
      const prereleaseStr = prerelease?.slice(1) // Remove leading -

      if (prefix === '~') {
        if (major !== undefined) {
          comparators.push(...parseTildeRange(major, minor, patch, prereleaseStr))
        }
        continue
      }

      if (prefix === '^') {
        if (major !== undefined) {
          comparators.push(...parseCaretRange(major, minor, patch, prereleaseStr))
        }
        continue
      }

      // X-range without prefix
      if (major !== undefined || isX(majorStr)) {
        comparators.push(...parseXRange(major, minor, patch))
        continue
      }
    }

    // Standard comparator (>, >=, <, <=, =, !=)
    const comparatorMatch = part.match(COMPARATOR)
    if (comparatorMatch) {
      const op = comparatorMatch[1] ?? ''
      const versionStr = (comparatorMatch[2] ?? '').replace(/^v/, '')

      // Handle != (not equal)
      if (op === '!=') {
        // Split into two ranges: <version || >version
        // For simplicity, we'll handle this in the test function
        comparators.push({ operator: '!=', semver: parse(versionStr, { loose: true }), value: part })
        continue
      }

      // Empty operator means = (exact match)
      const operator = (op === '' || op === '=') ? '=' : op as ComparatorOperator
      comparators.push(createComparator(operator, versionStr))
      continue
    }

    // Fallback: try to parse as version
    const parsed = parse(part, { loose: true })
    if (parsed) {
      comparators.push(createComparator('=', parsed.version))
    }
  }

  return comparators
}

/**
 * Internal range parser (not cached)
 */
function parseRangeInternal(
  range: string,
  options?: SatisfiesOptions
): Range | null {
  if (typeof range !== 'string') return null

  range = range.trim()

  // Split by || (OR)
  const orParts = range.split(/\s*\|\|\s*/)
  const sets: Comparator[][] = []

  for (const part of orParts) {
    const comparators = parseComparatorSet(part, options)
    if (comparators.length > 0) {
      sets.push(comparators)
    }
  }

  if (sets.length === 0) return null

  return {
    set: sets,
    raw: range,
    options,
  }
}

/**
 * Parse a range string into a Range object (cached)
 */
export function parseRange(
  range: string,
  options?: SatisfiesOptions
): Range | null {
  return getCachedRange(range, options)
}

/**
 * Test a version against a single comparator
 */
function testComparator(version: SemVerObject, comp: Comparator, _options?: SatisfiesOptions): boolean {
  if (!comp.semver) {
    // No version constraint (like >=0.0.0)
    return comp.operator === '>=' || comp.operator === '' || comp.operator === '='
  }

  const cmp = compareVersions(version, comp.semver)

  switch (comp.operator) {
    case '=':
    case '':
      return cmp === 0
    case '>':
      return cmp === 1
    case '>=':
      return cmp >= 0
    case '<':
      return cmp === -1
    case '<=':
      return cmp <= 0
    case '!=':
      return cmp !== 0
    default:
      return false
  }
}

/**
 * Check if a prerelease version is allowed to match the comparator set.
 * By default, prereleases only match if the comparator has the same [major, minor, patch] tuple.
 */
function prereleaseAllowed(version: SemVerObject, comparators: Comparator[], options?: SatisfiesOptions): boolean {
  // If includePrerelease, always allow
  if (options?.includePrerelease) return true

  // If version has no prerelease, it's always allowed
  if (version.prerelease.length === 0) return true

  // Check if any comparator has a prerelease with the same major.minor.patch
  for (const comp of comparators) {
    if (comp.semver && comp.semver.prerelease.length > 0) {
      if (
        version.major === comp.semver.major &&
        version.minor === comp.semver.minor &&
        version.patch === comp.semver.patch
      ) {
        return true
      }
    }
  }

  return false
}

/**
 * Check if a version satisfies a range (with caching)
 */
export function satisfies(
  version: string,
  range: string,
  options?: SatisfiesOptions
): boolean {
  // Build cache key
  const cacheKey = options?.loose
    ? `loose:${version}@${range}`
    : options?.includePrerelease
      ? `pre:${version}@${range}`
      : `${version}@${range}`

  // Check cache first
  const cached = satisfiesCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  // Compute result
  const result = satisfiesInternal(version, range, options)
  satisfiesCache.set(cacheKey, result)
  return result
}

/**
 * Internal satisfies check (not cached)
 */
function satisfiesInternal(
  version: string,
  range: string,
  options?: SatisfiesOptions
): boolean {
  // Use cached version parsing
  const parsed = getCachedVersion(version, options)
  if (!parsed) return false

  // Use cached range parsing
  const parsedRange = getCachedRange(range, options)
  if (!parsedRange) return false

  // Check each OR set
  for (const comparators of parsedRange.set) {
    // Check prerelease allowance
    if (!prereleaseAllowed(parsed, comparators, options)) {
      continue
    }

    // Check all AND comparators
    let allMatch = true
    for (const comp of comparators) {
      if (!testComparator(parsed, comp, options)) {
        allMatch = false
        break
      }
    }

    if (allMatch) return true
  }

  return false
}

/**
 * Return the highest version that satisfies the range
 *
 * Optimized to:
 * 1. Parse the range once and reuse
 * 2. Avoid redundant version parsing (cached)
 * 3. Use pre-parsed versions for comparison
 */
export function maxSatisfying(
  versions: string[],
  range: string,
  options?: SatisfiesOptions
): string | null {
  // Parse range once
  const parsedRange = getCachedRange(range, options)
  if (!parsedRange) return null

  let max: SemVerObject | null = null
  let maxStr: string | null = null

  for (const v of versions) {
    // Use cached version parsing
    const parsed = getCachedVersion(v, options)
    if (!parsed) continue

    // Check satisfaction using already-parsed objects
    if (satisfiesWithParsed(parsed, parsedRange, options)) {
      if (!max || compareVersions(parsed, max) === 1) {
        max = parsed
        maxStr = parsed.version
      }
    }
  }

  return maxStr
}

/**
 * Internal satisfies check using pre-parsed objects
 */
function satisfiesWithParsed(
  parsed: SemVerObject,
  parsedRange: Range,
  options?: SatisfiesOptions
): boolean {
  for (const comparators of parsedRange.set) {
    if (!prereleaseAllowed(parsed, comparators, options)) {
      continue
    }

    let allMatch = true
    for (const comp of comparators) {
      if (!testComparator(parsed, comp, options)) {
        allMatch = false
        break
      }
    }

    if (allMatch) return true
  }

  return false
}

/**
 * Return the lowest version that satisfies the range
 *
 * Optimized to use cached parsing (same as maxSatisfying)
 */
export function minSatisfying(
  versions: string[],
  range: string,
  options?: SatisfiesOptions
): string | null {
  // Parse range once
  const parsedRange = getCachedRange(range, options)
  if (!parsedRange) return null

  let min: SemVerObject | null = null
  let minStr: string | null = null

  for (const v of versions) {
    // Use cached version parsing
    const parsed = getCachedVersion(v, options)
    if (!parsed) continue

    // Check satisfaction using already-parsed objects
    if (satisfiesWithParsed(parsed, parsedRange, options)) {
      if (!min || compareVersions(parsed, min) === -1) {
        min = parsed
        minStr = parsed.version
      }
    }
  }

  return minStr
}

/**
 * Return the valid range string, or null if invalid
 */
export function validRange(
  range: string,
  options?: SatisfiesOptions
): string | null {
  const trimmed = range.trim()

  // Check for invalid operators
  if (/^>>|<<|><|<>/.test(trimmed)) {
    return null
  }

  const parsed = parseRange(trimmed, options)
  if (!parsed) return null

  // Validate all comparators have valid semvers (except for >= operators with no version)
  for (const set of parsed.set) {
    for (const c of set) {
      // If it has a version pattern but couldn't parse, it's invalid
      if (c.value.match(/[0-9]/) && !c.semver) {
        return null
      }
    }
  }

  // Return a normalized form
  return parsed.set
    .map(set =>
      set.map(c => {
        // Normalize = operator to just the version
        if (c.operator === '=' && c.semver) {
          return c.semver.version
        }
        return c.value
      }).join(' ')
    )
    .join(' || ')
}

/**
 * Check if two ranges have any overlap
 */
export function intersects(
  range1: string,
  range2: string,
  options?: SatisfiesOptions
): boolean {
  const r1 = parseRange(range1, options)
  const r2 = parseRange(range2, options)

  if (!r1 || !r2) return false

  // For each pair of comparator sets, check if they can overlap
  for (const set1 of r1.set) {
    for (const set2 of r2.set) {
      if (comparatorSetsIntersect(set1, set2, options)) {
        return true
      }
    }
  }

  return false
}

/**
 * Check if two comparator sets have any overlap
 */
function comparatorSetsIntersect(
  set1: Comparator[],
  set2: Comparator[],
  _options?: SatisfiesOptions
): boolean {
  // Get bounds for each set
  const bounds1 = getSetBounds(set1)
  const bounds2 = getSetBounds(set2)

  if (!bounds1 || !bounds2) return false

  // Check if the ranges overlap
  // Overlap exists if: min1 <= max2 AND min2 <= max1
  const minOk = !bounds1.min || !bounds2.max ||
    compareVersions(bounds1.min.semver!, bounds2.max.semver!) <= (bounds2.maxInclusive ? 0 : -1)
  const maxOk = !bounds2.min || !bounds1.max ||
    compareVersions(bounds2.min.semver!, bounds1.max.semver!) <= (bounds1.maxInclusive ? 0 : -1)

  return minOk && maxOk
}

/**
 * Get the min/max bounds from a comparator set
 */
function getSetBounds(set: Comparator[]): {
  min: Comparator | null
  max: Comparator | null
  minInclusive: boolean
  maxInclusive: boolean
} | null {
  let min: Comparator | null = null
  let max: Comparator | null = null
  let minInclusive = true
  let maxInclusive = true

  for (const c of set) {
    if (!c.semver) continue

    switch (c.operator) {
      case '>=':
        if (!min || (c.semver && compareVersions(c.semver, min.semver!) > 0)) {
          min = c
          minInclusive = true
        }
        break
      case '>':
        if (!min || (c.semver && compareVersions(c.semver, min.semver!) >= 0)) {
          min = c
          minInclusive = false
        }
        break
      case '<=':
        if (!max || (c.semver && compareVersions(c.semver, max.semver!) < 0)) {
          max = c
          maxInclusive = true
        }
        break
      case '<':
        if (!max || (c.semver && compareVersions(c.semver, max.semver!) <= 0)) {
          max = c
          maxInclusive = false
        }
        break
      case '=':
      case '':
        // Exact match sets both min and max
        if (!min || (c.semver && compareVersions(c.semver, min.semver!) > 0)) {
          min = c
          minInclusive = true
        }
        if (!max || (c.semver && compareVersions(c.semver, max.semver!) < 0)) {
          max = c
          maxInclusive = true
        }
        break
    }
  }

  return { min, max, minInclusive, maxInclusive }
}
