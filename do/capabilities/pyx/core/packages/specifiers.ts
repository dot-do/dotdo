/**
 * PEP 440 Version Specifier Parsing
 * https://peps.python.org/pep-0440/
 */

import type { VersionSpecifier, VersionOperator, PythonVersionConstraint } from './types'

/**
 * Valid PEP 440 version operators
 */
const VERSION_OPERATORS = ['===', '~=', '==', '!=', '<=', '>=', '<', '>'] as const

/**
 * Regex for PEP 440 version format
 * Supports: epoch, release, pre-release, post-release, dev, local
 *
 * A valid version must start with a digit (after optional epoch)
 */
const VERSION_PATTERN = /^(\d+!)?(\d+(?:\.\d+)*(?:\.\*)?)((?:a|b|rc|alpha|beta|c|pre|preview)\d*)?(\.?post\d*)?(\.?dev\d*)?(\+[a-zA-Z0-9.]+)?(-\d+)?$/i

/**
 * Alternate pattern for more lenient matching (to handle edge cases)
 * Still requires version to start with a digit (after optional epoch)
 */
const LENIENT_VERSION_PATTERN = /^(\d+!)?\d+[a-zA-Z0-9.*+-]*$/

/**
 * Parse a version specifier string (e.g., ">=1.0.0", "~=2.3.0")
 */
export function parseVersionSpecifier(spec: string): VersionSpecifier {
  const trimmed = spec.trim()

  // Find the operator
  let op: VersionOperator | undefined
  let versionPart = ''

  for (const operator of VERSION_OPERATORS) {
    if (trimmed.startsWith(operator)) {
      op = operator as VersionOperator
      versionPart = trimmed.slice(operator.length).trim()
      break
    }
  }

  if (!op) {
    throw new Error(`Invalid version specifier: no valid operator found in "${spec}"`)
  }

  if (!versionPart) {
    throw new Error(`Invalid version specifier: no version found in "${spec}"`)
  }

  // Validate version format (except for === which allows arbitrary strings)
  if (op !== '===') {
    if (!VERSION_PATTERN.test(versionPart) && !LENIENT_VERSION_PATTERN.test(versionPart)) {
      throw new Error(`Invalid version format: "${versionPart}"`)
    }
  }

  const result: VersionSpecifier = {
    op,
    version: versionPart,
  }

  // Check for wildcard
  if (versionPart.endsWith('.*')) {
    result.isWildcard = true
  }

  // Extract local version
  const localMatch = versionPart.match(/\+([a-zA-Z0-9.]+)$/)
  if (localMatch) {
    result.localVersion = localMatch[1]
  }

  // Extract epoch
  const epochMatch = versionPart.match(/^(\d+)!/)
  if (epochMatch) {
    result.epoch = parseInt(epochMatch[1], 10)
  }

  return result
}

/**
 * Parse a comma-separated list of version specifiers
 */
export function parseVersionSpecifiers(specs: string): Array<{ op: string; version: string }> {
  if (!specs.trim()) {
    return []
  }

  return specs.split(',').map(spec => {
    const parsed = parseVersionSpecifier(spec.trim())
    return { op: parsed.op, version: parsed.version }
  })
}

/**
 * Compare two version strings
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  // Remove epoch if present
  const aNoEpoch = a.replace(/^\d+!/, '')
  const bNoEpoch = b.replace(/^\d+!/, '')

  // Extract epoch
  const aEpochMatch = a.match(/^(\d+)!/)
  const bEpochMatch = b.match(/^(\d+)!/)
  const aEpoch = aEpochMatch ? parseInt(aEpochMatch[1], 10) : 0
  const bEpoch = bEpochMatch ? parseInt(bEpochMatch[1], 10) : 0

  if (aEpoch !== bEpoch) {
    return aEpoch < bEpoch ? -1 : 1
  }

  // Remove local version for comparison
  const aBase = aNoEpoch.replace(/\+.*$/, '')
  const bBase = bNoEpoch.replace(/\+.*$/, '')

  // Split into parts
  const aParts = aBase.split(/[.-]/).map(p => {
    // Handle pre-release identifiers
    const numMatch = p.match(/^(\d+)(.*)$/)
    if (numMatch) {
      return { num: parseInt(numMatch[1], 10), suffix: numMatch[2] || '' }
    }
    return { num: -1, suffix: p }
  })

  const bParts = bBase.split(/[.-]/).map(p => {
    const numMatch = p.match(/^(\d+)(.*)$/)
    if (numMatch) {
      return { num: parseInt(numMatch[1], 10), suffix: numMatch[2] || '' }
    }
    return { num: -1, suffix: p }
  })

  const maxLen = Math.max(aParts.length, bParts.length)

  for (let i = 0; i < maxLen; i++) {
    const aPart = aParts[i] ?? { num: 0, suffix: '' }
    const bPart = bParts[i] ?? { num: 0, suffix: '' }

    // Compare numeric parts
    if (aPart.num !== bPart.num) {
      return aPart.num < bPart.num ? -1 : 1
    }

    // Compare suffixes (pre-release tags)
    if (aPart.suffix !== bPart.suffix) {
      // No suffix > any suffix (release > pre-release)
      if (!aPart.suffix && bPart.suffix) return 1
      if (aPart.suffix && !bPart.suffix) return -1
      return aPart.suffix < bPart.suffix ? -1 : 1
    }
  }

  return 0
}

/**
 * Check if a version satisfies a single specifier
 */
export function satisfiesSpecifier(version: string, specifier: { op: string; version: string }): boolean {
  const { op, version: specVersion } = specifier

  // Handle wildcards
  if (specVersion.endsWith('.*')) {
    const prefix = specVersion.slice(0, -2)
    const versionPrefix = version.split('.').slice(0, prefix.split('.').length).join('.')

    if (op === '==') {
      return versionPrefix === prefix
    }
    if (op === '!=') {
      return versionPrefix !== prefix
    }
  }

  // Handle arbitrary equality
  if (op === '===') {
    return version === specVersion
  }

  // Handle compatible release (~=)
  if (op === '~=') {
    const parts = specVersion.split('.')
    if (parts.length < 2) {
      // ~=X means >=X, ==X.*
      const cmp = compareVersions(version, specVersion)
      if (cmp < 0) return false
      const vParts = version.split('.')
      return vParts[0] === parts[0]
    }
    // ~=X.Y means >=X.Y, ==X.*
    // ~=X.Y.Z means >=X.Y.Z, ==X.Y.*
    const upperBoundParts = parts.slice(0, -1)
    const versionParts = version.split('.')
    const versionUpperParts = versionParts.slice(0, upperBoundParts.length)

    // Check lower bound
    if (compareVersions(version, specVersion) < 0) {
      return false
    }

    // Check upper bound (same prefix)
    return versionUpperParts.join('.') === upperBoundParts.join('.')
  }

  const cmp = compareVersions(version, specVersion)

  switch (op) {
    case '==': return cmp === 0
    case '!=': return cmp !== 0
    case '<': return cmp < 0
    case '<=': return cmp <= 0
    case '>': return cmp > 0
    case '>=': return cmp >= 0
    default: return false
  }
}

/**
 * Check if a version satisfies all specifiers
 */
export function satisfies(version: string, specifiers: Array<{ op: string; version: string }>): boolean {
  if (specifiers.length === 0) {
    return true
  }
  return specifiers.every(spec => satisfiesSpecifier(version, spec))
}

/**
 * Parse a Python version constraint string (used in requires-python)
 */
export function parsePythonVersionConstraint(constraint: string): PythonVersionConstraint {
  const specifiers = parseVersionSpecifiers(constraint)

  // Find minimum version from >= specifiers
  let minVersion: string | undefined
  for (const spec of specifiers) {
    if (spec.op === '>=' || spec.op === '~=' || spec.op === '==') {
      const ver = spec.version.replace(/\.\*$/, '')
      if (!minVersion || compareVersions(ver, minVersion) < 0) {
        minVersion = ver
      }
    }
    if (spec.op === '>') {
      // For >, the min version is slightly higher, but we approximate
      const ver = spec.version
      if (!minVersion || compareVersions(ver, minVersion) < 0) {
        minVersion = ver
      }
    }
  }

  return {
    specifiers,
    minVersion,
    satisfies(version: string): boolean {
      // Handle ~= specially for Python version constraints
      const expandedSpecifiers = specifiers.flatMap(spec => {
        if (spec.op === '~=') {
          // ~=X.Y means >=X.Y and ==X.*
          const parts = spec.version.split('.')
          if (parts.length === 2) {
            return [
              { op: '>=', version: spec.version },
              { op: '==', version: `${parts[0]}.*` }
            ]
          }
          // ~=X.Y.Z means >=X.Y.Z and ==X.Y.*
          return [
            { op: '>=', version: spec.version },
            { op: '==', version: `${parts.slice(0, -1).join('.')}.*` }
          ]
        }
        return [spec]
      })
      return satisfies(version, expandedSpecifiers)
    }
  }
}

/**
 * Normalize a package name according to PEP 503
 * https://peps.python.org/pep-0503/#normalized-names
 */
export function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}
