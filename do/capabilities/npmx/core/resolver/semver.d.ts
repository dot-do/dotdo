/**
 * Type declarations for semver package
 */
declare module 'semver' {
  /**
   * Compare two versions
   * Returns 0 if equal, 1 if v1 > v2, -1 if v1 < v2
   */
  export function compare(v1: string, v2: string): -1 | 0 | 1

  /**
   * Check if v1 > v2
   */
  export function gt(v1: string, v2: string): boolean

  /**
   * Check if v1 >= v2
   */
  export function gte(v1: string, v2: string): boolean

  /**
   * Check if v1 < v2
   */
  export function lt(v1: string, v2: string): boolean

  /**
   * Check if v1 <= v2
   */
  export function lte(v1: string, v2: string): boolean

  /**
   * Check if v1 == v2
   */
  export function eq(v1: string, v2: string): boolean

  /**
   * Check if v1 != v2
   */
  export function neq(v1: string, v2: string): boolean

  /**
   * Check if version satisfies a range
   */
  export function satisfies(version: string, range: string): boolean

  /**
   * Get the highest version in list that satisfies the range
   */
  export function maxSatisfying(
    versions: string[],
    range: string
  ): string | null

  /**
   * Get the lowest version in list that satisfies the range
   */
  export function minSatisfying(
    versions: string[],
    range: string
  ): string | null

  /**
   * Check if a version is valid
   */
  export function valid(version: string): string | null

  /**
   * Coerce a string to a valid semver version
   */
  export function coerce(version: string): SemVer | null

  /**
   * Parse a version string
   */
  export function parse(version: string): SemVer | null

  /**
   * Clean a version string
   */
  export function clean(version: string): string | null

  /**
   * Check if a range is valid
   */
  export function validRange(range: string): string | null

  /**
   * SemVer class
   */
  export class SemVer {
    raw: string
    major: number
    minor: number
    patch: number
    prerelease: readonly (string | number)[]
    build: readonly string[]
    version: string

    constructor(version: string)
    compare(other: SemVer | string): -1 | 0 | 1
    toString(): string
  }

  /**
   * Range class
   */
  export class Range {
    raw: string
    set: readonly (readonly Comparator[])[]

    constructor(range: string)
    test(version: SemVer | string): boolean
    toString(): string
  }

  /**
   * Comparator class
   */
  export class Comparator {
    operator: '' | '=' | '<' | '>' | '<=' | '>='
    semver: SemVer
    value: string

    constructor(comp: string)
    test(version: SemVer | string): boolean
    toString(): string
  }

  export default {
    compare,
    gt,
    gte,
    lt,
    lte,
    eq,
    neq,
    satisfies,
    maxSatisfying,
    minSatisfying,
    valid,
    coerce,
    parse,
    clean,
    validRange,
    SemVer,
    Range,
    Comparator,
  }
}
