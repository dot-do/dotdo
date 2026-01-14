/**
 * Semver Comparison Functions
 *
 * Compare, sort, and test version relationships.
 */

import type { CompareResult, ParseOptions } from './types'
import { parse, SemVer, compareVersions } from './parse'
import { ParseError } from '../errors'

/**
 * Compare two versions.
 * Returns:
 *  - -1 if v1 < v2
 *  -  0 if v1 == v2
 *  -  1 if v1 > v2
 */
export function compare(
  v1: string | SemVer,
  v2: string | SemVer,
  options?: ParseOptions
): CompareResult {
  const a = v1 instanceof SemVer ? v1 : parse(v1, options)
  const b = v2 instanceof SemVer ? v2 : parse(v2, options)

  if (!a || !b) {
    const invalid = !a ? String(v1) : String(v2)
    throw new ParseError(`Invalid version: ${invalid}`, { version: invalid })
  }

  return compareVersions(a, b)
}

/**
 * Reverse compare: rcompare(v1, v2) = compare(v2, v1)
 */
export function rcompare(
  v1: string | SemVer,
  v2: string | SemVer,
  options?: ParseOptions
): CompareResult {
  return compare(v2, v1, options)
}

/**
 * v1 < v2
 */
export function lt(
  v1: string | SemVer,
  v2: string | SemVer,
  options?: ParseOptions
): boolean {
  return compare(v1, v2, options) === -1
}

/**
 * v1 > v2
 */
export function gt(
  v1: string | SemVer,
  v2: string | SemVer,
  options?: ParseOptions
): boolean {
  return compare(v1, v2, options) === 1
}

/**
 * v1 == v2
 */
export function eq(
  v1: string | SemVer,
  v2: string | SemVer,
  options?: ParseOptions
): boolean {
  return compare(v1, v2, options) === 0
}

/**
 * v1 != v2
 */
export function neq(
  v1: string | SemVer,
  v2: string | SemVer,
  options?: ParseOptions
): boolean {
  return compare(v1, v2, options) !== 0
}

/**
 * v1 <= v2
 */
export function lte(
  v1: string | SemVer,
  v2: string | SemVer,
  options?: ParseOptions
): boolean {
  return compare(v1, v2, options) <= 0
}

/**
 * v1 >= v2
 */
export function gte(
  v1: string | SemVer,
  v2: string | SemVer,
  options?: ParseOptions
): boolean {
  return compare(v1, v2, options) >= 0
}

/**
 * Compare build metadata (for sorting, not semver precedence)
 */
export function compareBuild(
  v1: string | SemVer,
  v2: string | SemVer,
  options?: ParseOptions
): CompareResult {
  const a = v1 instanceof SemVer ? v1 : new SemVer(v1, options)
  const b = v2 instanceof SemVer ? v2 : new SemVer(v2, options)

  // First compare normally
  const result = compareVersions(a, b)
  if (result !== 0) return result

  // If equal, compare build metadata
  const lenA = a.build.length
  const lenB = b.build.length

  // No build metadata = lower precedence in this context
  if (lenA === 0 && lenB > 0) return -1
  if (lenA > 0 && lenB === 0) return 1
  if (lenA === 0 && lenB === 0) return 0

  const len = Math.max(lenA, lenB)
  for (let i = 0; i < len; i++) {
    if (i >= lenA) return -1
    if (i >= lenB) return 1

    const ai = a.build[i]
    const bi = b.build[i]

    // These should never be undefined due to the bounds checks above
    if (ai === undefined || bi === undefined) continue
    if (ai === bi) continue

    // Try to compare as numbers if both are numeric
    const aNum = parseInt(ai, 10)
    const bNum = parseInt(bi, 10)

    if (!isNaN(aNum) && !isNaN(bNum)) {
      return aNum > bNum ? 1 : -1
    }

    // Compare lexically
    return ai > bi ? 1 : -1
  }

  return 0
}

/**
 * Sort an array of versions (ascending)
 */
export function sort(
  versions: (string | SemVer)[],
  options?: ParseOptions
): (string | SemVer)[] {
  return versions.sort((a, b) => compare(a, b, options))
}

/**
 * Sort an array of versions (descending)
 */
export function rsort(
  versions: (string | SemVer)[],
  options?: ParseOptions
): (string | SemVer)[] {
  return versions.sort((a, b) => rcompare(a, b, options))
}

/**
 * Return the difference between two versions (major, minor, patch, prerelease)
 */
export function diff(
  v1: string | SemVer,
  v2: string | SemVer,
  options?: ParseOptions
): string | null {
  const a = v1 instanceof SemVer ? v1 : parse(v1, options)
  const b = v2 instanceof SemVer ? v2 : parse(v2, options)

  if (!a || !b) return null

  // Check if they are equal (including prerelease)
  if (compareVersions(a, b) === 0) return null

  // Determine what type of difference
  const aHasPre = a.prerelease.length > 0
  const bHasPre = b.prerelease.length > 0

  if (a.major !== b.major) {
    return aHasPre || bHasPre ? 'premajor' : 'major'
  }

  if (a.minor !== b.minor) {
    return aHasPre || bHasPre ? 'preminor' : 'minor'
  }

  if (a.patch !== b.patch) {
    return aHasPre || bHasPre ? 'prepatch' : 'patch'
  }

  // Only prerelease differs
  return 'prerelease'
}

/**
 * Get the major version number
 */
export function major(version: string | SemVer, options?: ParseOptions): number {
  const v = version instanceof SemVer ? version : new SemVer(version, options)
  return v.major
}

/**
 * Get the minor version number
 */
export function minor(version: string | SemVer, options?: ParseOptions): number {
  const v = version instanceof SemVer ? version : new SemVer(version, options)
  return v.minor
}

/**
 * Get the patch version number
 */
export function patch(version: string | SemVer, options?: ParseOptions): number {
  const v = version instanceof SemVer ? version : new SemVer(version, options)
  return v.patch
}

/**
 * Get the prerelease components
 */
export function prerelease(
  version: string | SemVer,
  options?: ParseOptions
): readonly (string | number)[] | null {
  const v = version instanceof SemVer ? version : parse(version, options)
  if (!v) return null
  return v.prerelease.length > 0 ? v.prerelease : null
}
