/**
 * Semver Types
 *
 * Type definitions for semantic versioning.
 */

/**
 * Options for parsing versions
 */
export interface ParseOptions {
  /** Enable loose parsing (allow leading v, =, whitespace) */
  loose?: boolean
  /** Include prerelease versions in range comparisons */
  includePrerelease?: boolean
}

/**
 * Options for range operations
 */
export interface SatisfiesOptions {
  /** Include prerelease versions when checking ranges */
  includePrerelease?: boolean
  /** Enable loose parsing */
  loose?: boolean
}

/**
 * Prerelease identifier - can be string or number
 */
export type PrereleaseIdentifier = string | number

/**
 * Build metadata identifier - always string
 */
export type BuildIdentifier = string

/**
 * SemVer object representation
 */
export interface SemVerObject {
  /** Major version number */
  major: number
  /** Minor version number */
  minor: number
  /** Patch version number */
  patch: number
  /** Prerelease identifiers (e.g., ['alpha', 1]) */
  prerelease: PrereleaseIdentifier[]
  /** Build metadata identifiers (e.g., ['build', '123']) */
  build: BuildIdentifier[]
  /** Canonical version string (without v prefix) */
  version: string
  /** Original raw input string */
  raw: string
}

/**
 * Release types for incrementing versions
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
 * Comparator operators
 */
export type ComparatorOperator = '' | '=' | '<' | '>' | '<=' | '>=' | '!='

/**
 * Comparison result: -1 (less), 0 (equal), 1 (greater)
 */
export type CompareResult = -1 | 0 | 1

/**
 * A single comparator (operator + version)
 */
export interface Comparator {
  operator: ComparatorOperator
  semver: SemVerObject | null
  value: string
}

/**
 * A range is a set of comparator sets (joined by ||)
 * Each comparator set is an array of comparators (joined by AND)
 */
export interface Range {
  /** Array of comparator sets (OR groups) */
  set: Comparator[][]
  /** Original raw range string */
  raw: string
  /** Options used to parse the range */
  options?: SatisfiesOptions | undefined
}
