/**
 * Semver Parsing
 *
 * Parse, validate, clean, and coerce version strings.
 */

import type {
  ParseOptions,
  SemVerObject,
  PrereleaseIdentifier,
  BuildIdentifier,
  ReleaseType,
} from './types'
import { ParseError } from '../errors'

// Regex patterns for semver parsing
// Strict pattern: no leading v/=, no whitespace, no leading zeros
const NUMERIC = '0|[1-9]\\d*'
const NUMERIC_LOOSE = '\\d+'
const ALPHANUMERIC = '[0-9A-Za-z-]+'
const PRERELEASE_IDENTIFIER = `(?:${NUMERIC}|${ALPHANUMERIC})`
const PRERELEASE_IDENTIFIER_LOOSE = `(?:${NUMERIC_LOOSE}|${ALPHANUMERIC})`
const PRERELEASE = `(?:-(?<prerelease>${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*))`
const PRERELEASE_LOOSE = `(?:-(?<prerelease>${PRERELEASE_IDENTIFIER_LOOSE}(?:\\.${PRERELEASE_IDENTIFIER_LOOSE})*))`
const BUILD_IDENTIFIER = '[0-9A-Za-z-]+'
const BUILD = `(?:\\+(?<build>${BUILD_IDENTIFIER}(?:\\.${BUILD_IDENTIFIER})*))`

// Strict semver regex
const FULL_VERSION = `^(?<major>${NUMERIC})\\.(?<minor>${NUMERIC})\\.(?<patch>${NUMERIC})${PRERELEASE}?${BUILD}?$`

// Loose semver regex (allows v prefix, =, leading zeros, whitespace)
const FULL_VERSION_LOOSE = `^[v=\\s]*(?<major>${NUMERIC_LOOSE})\\.(?<minor>${NUMERIC_LOOSE})\\.(?<patch>${NUMERIC_LOOSE})${PRERELEASE_LOOSE}?${BUILD}?\\s*$`

// Coerce pattern - find version-like strings anywhere in input
const COERCE_PATTERN = /(?:^|[^\d])(\d{1,16})(?:\.(\d{1,16}))?(?:\.(\d{1,16}))?(?:$|[^\d])/

const SEMVER_REGEX = new RegExp(FULL_VERSION)
const SEMVER_REGEX_LOOSE = new RegExp(FULL_VERSION_LOOSE)

/**
 * Check if a numeric string has a leading zero (invalid in strict mode)
 */
function hasLeadingZero(str: string): boolean {
  return str.length > 1 && str[0] === '0'
}

/**
 * Parse prerelease identifiers, converting numeric strings to numbers
 */
function parsePrerelease(
  prerelease: string | undefined,
  loose: boolean
): PrereleaseIdentifier[] {
  if (!prerelease) return []

  return prerelease.split('.').map((id) => {
    // In strict mode, numeric identifiers must not have leading zeros
    if (!loose && /^[0-9]+$/.test(id) && hasLeadingZero(id)) {
      throw new ParseError(`Invalid prerelease identifier: ${id}`, { version: prerelease })
    }
    // Convert pure numeric strings to numbers
    if (/^[0-9]+$/.test(id)) {
      return parseInt(id, 10)
    }
    return id
  })
}

/**
 * Parse build metadata identifiers
 */
function parseBuild(build: string | undefined): BuildIdentifier[] {
  if (!build) return []
  return build.split('.')
}

/**
 * Format version string from components
 */
function formatVersion(
  major: number,
  minor: number,
  patch: number,
  prerelease: PrereleaseIdentifier[],
  build: BuildIdentifier[]
): string {
  let version = `${major}.${minor}.${patch}`
  if (prerelease.length > 0) {
    version += `-${prerelease.join('.')}`
  }
  if (build.length > 0) {
    version += `+${build.join('.')}`
  }
  return version
}

/**
 * SemVer class for working with semantic versions
 */
export class SemVer implements SemVerObject {
  major: number
  minor: number
  patch: number
  prerelease: PrereleaseIdentifier[]
  build: BuildIdentifier[]
  version: string
  raw: string

  constructor(
    version: string | SemVer | SemVerObject,
    options?: ParseOptions
  ) {
    if (version instanceof SemVer) {
      this.major = version.major
      this.minor = version.minor
      this.patch = version.patch
      this.prerelease = [...version.prerelease]
      this.build = [...version.build]
      this.version = version.version
      this.raw = version.raw
      return
    }

    if (typeof version === 'object' && version !== null) {
      this.major = version.major
      this.minor = version.minor
      this.patch = version.patch
      this.prerelease = [...version.prerelease]
      this.build = [...version.build]
      this.version = version.version
      this.raw = version.raw
      return
    }

    // Try strict first, then loose (to allow v prefix)
    let parsed = parse(version, options)
    if (!parsed && !options?.loose) {
      // Try loose mode to handle v prefix
      parsed = parse(version, { ...options, loose: true })
    }
    if (!parsed) {
      throw new ParseError(`Invalid version: ${version}`, { version })
    }

    this.major = parsed.major
    this.minor = parsed.minor
    this.patch = parsed.patch
    this.prerelease = parsed.prerelease
    this.build = parsed.build
    this.version = parsed.version
    this.raw = version
  }

  /**
   * Return the version string
   */
  toString(): string {
    return this.version
  }

  /**
   * Compare this version to another
   */
  compare(other: string | SemVer): -1 | 0 | 1 {
    const otherVer = other instanceof SemVer ? other : new SemVer(other)
    return compareVersions(this, otherVer)
  }

  /**
   * Increment the version
   */
  inc(
    release: ReleaseType,
    identifier?: string,
    identifierBase?: string | false
  ): SemVer {
    switch (release) {
      case 'major':
        this.major++
        this.minor = 0
        this.patch = 0
        this.prerelease = []
        break
      case 'minor':
        this.minor++
        this.patch = 0
        this.prerelease = []
        break
      case 'patch':
        this.patch++
        this.prerelease = []
        break
      case 'premajor':
        this.major++
        this.minor = 0
        this.patch = 0
        this.prerelease = identifier
          ? [identifier, identifierBase === false ? 1 : 0]
          : [0]
        break
      case 'preminor':
        this.minor++
        this.patch = 0
        this.prerelease = identifier
          ? [identifier, identifierBase === false ? 1 : 0]
          : [0]
        break
      case 'prepatch':
        this.patch++
        this.prerelease = identifier
          ? [identifier, identifierBase === false ? 1 : 0]
          : [0]
        break
      case 'prerelease':
        if (this.prerelease.length === 0) {
          this.patch++
          this.prerelease = identifier
            ? [identifier, identifierBase === false ? 1 : 0]
            : [0]
        } else {
          // Increment the last numeric identifier, or add .0
          let found = false
          for (let i = this.prerelease.length - 1; i >= 0; i--) {
            if (typeof this.prerelease[i] === 'number') {
              ;(this.prerelease[i] as number)++
              found = true
              break
            }
          }
          if (!found) {
            this.prerelease.push(0)
          }
        }
        break
    }
    this.build = []
    this.version = formatVersion(
      this.major,
      this.minor,
      this.patch,
      this.prerelease,
      this.build
    )
    return this
  }
}

/**
 * Compare two SemVer objects
 */
function compareVersions(a: SemVerObject, b: SemVerObject): -1 | 0 | 1 {
  // Compare major.minor.patch
  if (a.major !== b.major) return a.major > b.major ? 1 : -1
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1

  // A version without prerelease has higher precedence
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0

  // Compare prerelease identifiers
  const len = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < len; i++) {
    // Fewer fields = lower precedence (1.0.0-alpha < 1.0.0-alpha.1)
    if (i >= a.prerelease.length) return -1
    if (i >= b.prerelease.length) return 1

    const ai = a.prerelease[i]
    const bi = b.prerelease[i]

    if (ai === bi) continue

    // Numeric identifiers have lower precedence than alphanumeric
    const aIsNum = typeof ai === 'number'
    const bIsNum = typeof bi === 'number'

    if (aIsNum && !bIsNum) return -1
    if (!aIsNum && bIsNum) return 1

    // Both numeric: compare as numbers
    if (aIsNum && bIsNum) {
      return (ai as number) > (bi as number) ? 1 : -1
    }

    // Both string: compare lexically
    return (ai as string) > (bi as string) ? 1 : -1
  }

  return 0
}

/**
 * Parse a version string into a SemVer object
 */
export function parse(
  version: string | null | undefined,
  options?: ParseOptions
): SemVerObject | null {
  if (typeof version !== 'string') return null

  const loose = options?.loose ?? false
  const regex = loose ? SEMVER_REGEX_LOOSE : SEMVER_REGEX
  const match = version.match(regex)

  if (!match || !match.groups) return null

  const { major, minor, patch, prerelease, build } = match.groups

  // Ensure required groups exist
  if (major === undefined || minor === undefined || patch === undefined) {
    return null
  }

  // In strict mode, check for leading zeros in major.minor.patch
  if (!loose) {
    if (hasLeadingZero(major) || hasLeadingZero(minor) || hasLeadingZero(patch)) {
      return null
    }
  }

  try {
    const prereleaseArr = parsePrerelease(prerelease, loose)
    const buildArr = parseBuild(build)

    const majorNum = parseInt(major, 10)
    const minorNum = parseInt(minor, 10)
    const patchNum = parseInt(patch, 10)

    return {
      major: majorNum,
      minor: minorNum,
      patch: patchNum,
      prerelease: prereleaseArr,
      build: buildArr,
      version: formatVersion(majorNum, minorNum, patchNum, prereleaseArr, buildArr),
      raw: version,
    }
  } catch {
    return null
  }
}

/**
 * Return the valid version string if valid, or null
 */
export function valid(
  version: string | null | undefined,
  options?: ParseOptions
): string | null {
  const parsed = parse(version, options)
  return parsed ? parsed.version : null
}

/**
 * Clean a version string (strip leading v, =, whitespace)
 */
export function clean(
  version: string | null | undefined,
  options?: ParseOptions
): string | null {
  if (typeof version !== 'string') return null

  // Strip leading/trailing whitespace, then leading = and v in any order/combination
  const cleaned = version.trim().replace(/^[=\sv]+/, '')

  // Parse with strict mode to validate the cleaned version
  const parsed = parse(cleaned, { ...options, loose: false })
  return parsed ? parsed.version : null
}

/**
 * Coerce a string into a valid semver version if possible
 */
export function coerce(
  version: string | null | undefined,
  _options?: ParseOptions
): SemVer | null {
  if (typeof version !== 'string') return null

  // Strip leading v/V
  let cleaned = version.replace(/^[vV]/, '')

  // Try to parse as-is first
  const direct = parse(cleaned, { loose: true })
  if (direct) {
    return new SemVer(direct)
  }

  // Try to find a version-like pattern
  const match = cleaned.match(COERCE_PATTERN)
  if (!match || match[1] === undefined) return null

  const major = parseInt(match[1], 10)
  const minor = match[2] !== undefined ? parseInt(match[2], 10) : 0
  const patch = match[3] !== undefined ? parseInt(match[3], 10) : 0

  // Validate the numbers aren't too large
  if (!isFinite(major) || !isFinite(minor) || !isFinite(patch)) {
    return null
  }

  try {
    return new SemVer(`${major}.${minor}.${patch}`)
  } catch {
    return null
  }
}

// Re-export for internal use
export { compareVersions, formatVersion }
