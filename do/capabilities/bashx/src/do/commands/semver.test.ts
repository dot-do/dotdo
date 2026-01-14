/**
 * Semver Resolution Tests - RED Phase
 *
 * Tests for npm-style semantic versioning resolution:
 * - Parse semver versions (major.minor.patch-prerelease+build)
 * - Compare versions
 * - Match versions against ranges (^, ~, >=, <, ||, etc.)
 * - Find best matching version from a list
 *
 * These tests document the expected behavior before implementation.
 *
 * @module bashx/do/commands/semver.test
 */

import { describe, it, expect } from 'vitest'
import {
  parseSemver,
  compareSemver,
  satisfies,
  maxSatisfying,
  minSatisfying,
  validRange,
  coerce,
  clean,
  inc,
  diff,
  SemVer,
  SemVerRange,
} from './semver.js'

// ============================================================================
// SEMVER PARSING TESTS
// ============================================================================

describe('parseSemver - version parsing', () => {
  describe('basic versions', () => {
    it('should parse simple version', () => {
      const v = parseSemver('1.2.3')
      expect(v).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: [],
        build: [],
        raw: '1.2.3',
      })
    })

    it('should parse version with v prefix', () => {
      const v = parseSemver('v1.2.3')
      expect(v).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: [],
        build: [],
        raw: 'v1.2.3',
      })
    })

    it('should parse version with = prefix', () => {
      const v = parseSemver('=1.2.3')
      expect(v).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: [],
        build: [],
        raw: '=1.2.3',
      })
    })

    it('should parse version with leading zeros stripped', () => {
      const v = parseSemver('01.02.03')
      expect(v?.major).toBe(1)
      expect(v?.minor).toBe(2)
      expect(v?.patch).toBe(3)
    })

    it('should parse large version numbers', () => {
      const v = parseSemver('999.999.999')
      expect(v?.major).toBe(999)
      expect(v?.minor).toBe(999)
      expect(v?.patch).toBe(999)
    })
  })

  describe('prerelease versions', () => {
    it('should parse alpha prerelease', () => {
      const v = parseSemver('1.0.0-alpha')
      expect(v?.prerelease).toEqual(['alpha'])
    })

    it('should parse beta with number', () => {
      const v = parseSemver('1.0.0-beta.1')
      expect(v?.prerelease).toEqual(['beta', 1])
    })

    it('should parse rc version', () => {
      const v = parseSemver('2.0.0-rc.1')
      expect(v?.prerelease).toEqual(['rc', 1])
    })

    it('should parse numeric prerelease', () => {
      const v = parseSemver('1.0.0-0')
      expect(v?.prerelease).toEqual([0])
    })

    it('should parse complex prerelease', () => {
      const v = parseSemver('1.0.0-alpha.1.beta.2')
      expect(v?.prerelease).toEqual(['alpha', 1, 'beta', 2])
    })
  })

  describe('build metadata', () => {
    it('should parse build metadata', () => {
      const v = parseSemver('1.0.0+build.123')
      expect(v?.build).toEqual(['build', '123'])
    })

    it('should parse prerelease with build', () => {
      const v = parseSemver('1.0.0-alpha+001')
      expect(v?.prerelease).toEqual(['alpha'])
      expect(v?.build).toEqual(['001'])
    })

    it('should parse git sha as build', () => {
      const v = parseSemver('1.0.0+20130313144700')
      expect(v?.build).toEqual(['20130313144700'])
    })
  })

  describe('invalid versions', () => {
    it('should return null for empty string', () => {
      expect(parseSemver('')).toBeNull()
    })

    it('should return null for non-version string', () => {
      expect(parseSemver('not-a-version')).toBeNull()
    })

    it('should return null for incomplete version', () => {
      expect(parseSemver('1.2')).toBeNull()
    })

    it('should return null for negative numbers', () => {
      expect(parseSemver('-1.2.3')).toBeNull()
    })

    it('should return null for non-numeric parts', () => {
      expect(parseSemver('a.b.c')).toBeNull()
    })
  })
})

// ============================================================================
// SEMVER COMPARISON TESTS
// ============================================================================

describe('compareSemver - version comparison', () => {
  describe('major version comparison', () => {
    it('should compare major versions', () => {
      expect(compareSemver('2.0.0', '1.0.0')).toBeGreaterThan(0)
      expect(compareSemver('1.0.0', '2.0.0')).toBeLessThan(0)
    })

    it('should handle large major differences', () => {
      expect(compareSemver('10.0.0', '9.0.0')).toBeGreaterThan(0)
      expect(compareSemver('100.0.0', '99.0.0')).toBeGreaterThan(0)
    })
  })

  describe('minor version comparison', () => {
    it('should compare minor versions', () => {
      expect(compareSemver('1.2.0', '1.1.0')).toBeGreaterThan(0)
      expect(compareSemver('1.1.0', '1.2.0')).toBeLessThan(0)
    })

    it('should handle equal major with different minor', () => {
      expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0)
    })
  })

  describe('patch version comparison', () => {
    it('should compare patch versions', () => {
      expect(compareSemver('1.0.2', '1.0.1')).toBeGreaterThan(0)
      expect(compareSemver('1.0.1', '1.0.2')).toBeLessThan(0)
    })

    it('should return 0 for equal versions', () => {
      expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
    })
  })

  describe('prerelease comparison', () => {
    it('should order release after prerelease', () => {
      expect(compareSemver('1.0.0', '1.0.0-alpha')).toBeGreaterThan(0)
    })

    it('should order alpha before beta', () => {
      expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
    })

    it('should order rc before release', () => {
      expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
    })

    it('should order numeric prereleases', () => {
      expect(compareSemver('1.0.0-1', '1.0.0-2')).toBeLessThan(0)
      expect(compareSemver('1.0.0-10', '1.0.0-9')).toBeGreaterThan(0)
    })

    it('should order mixed prereleases', () => {
      expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.2')).toBeLessThan(0)
      expect(compareSemver('1.0.0-alpha.10', '1.0.0-alpha.9')).toBeGreaterThan(0)
    })

    it('should handle numbers before strings in prerelease', () => {
      expect(compareSemver('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0)
    })
  })

  describe('build metadata', () => {
    it('should ignore build metadata in comparison', () => {
      expect(compareSemver('1.0.0+build.1', '1.0.0+build.2')).toBe(0)
      expect(compareSemver('1.0.0', '1.0.0+build')).toBe(0)
    })
  })
})

// ============================================================================
// RANGE SATISFACTION TESTS
// ============================================================================

describe('satisfies - range matching', () => {
  describe('exact version', () => {
    it('should match exact version', () => {
      expect(satisfies('1.2.3', '1.2.3')).toBe(true)
      expect(satisfies('1.2.3', '1.2.4')).toBe(false)
    })

    it('should match with = prefix', () => {
      expect(satisfies('1.2.3', '=1.2.3')).toBe(true)
    })
  })

  describe('caret ranges (^)', () => {
    it('should match compatible minor/patch changes', () => {
      expect(satisfies('1.2.3', '^1.2.0')).toBe(true)
      expect(satisfies('1.3.0', '^1.2.0')).toBe(true)
      expect(satisfies('1.9.9', '^1.2.0')).toBe(true)
    })

    it('should not match major version changes', () => {
      expect(satisfies('2.0.0', '^1.2.0')).toBe(false)
      expect(satisfies('0.9.9', '^1.2.0')).toBe(false)
    })

    it('should handle ^0.x.x specially', () => {
      // ^0.2.3 means >=0.2.3 <0.3.0
      expect(satisfies('0.2.3', '^0.2.3')).toBe(true)
      expect(satisfies('0.2.4', '^0.2.3')).toBe(true)
      expect(satisfies('0.3.0', '^0.2.3')).toBe(false)
    })

    it('should handle ^0.0.x specially', () => {
      // ^0.0.3 means >=0.0.3 <0.0.4
      expect(satisfies('0.0.3', '^0.0.3')).toBe(true)
      expect(satisfies('0.0.4', '^0.0.3')).toBe(false)
    })
  })

  describe('tilde ranges (~)', () => {
    it('should match patch-level changes', () => {
      expect(satisfies('1.2.3', '~1.2.0')).toBe(true)
      expect(satisfies('1.2.9', '~1.2.0')).toBe(true)
    })

    it('should not match minor version changes', () => {
      expect(satisfies('1.3.0', '~1.2.0')).toBe(false)
      expect(satisfies('1.1.9', '~1.2.0')).toBe(false)
    })

    it('should work with prerelease', () => {
      expect(satisfies('1.2.3-beta', '~1.2.0')).toBe(true)
    })
  })

  describe('comparison operators', () => {
    it('should handle > operator', () => {
      expect(satisfies('1.2.4', '>1.2.3')).toBe(true)
      expect(satisfies('1.2.3', '>1.2.3')).toBe(false)
      expect(satisfies('1.2.2', '>1.2.3')).toBe(false)
    })

    it('should handle >= operator', () => {
      expect(satisfies('1.2.4', '>=1.2.3')).toBe(true)
      expect(satisfies('1.2.3', '>=1.2.3')).toBe(true)
      expect(satisfies('1.2.2', '>=1.2.3')).toBe(false)
    })

    it('should handle < operator', () => {
      expect(satisfies('1.2.2', '<1.2.3')).toBe(true)
      expect(satisfies('1.2.3', '<1.2.3')).toBe(false)
      expect(satisfies('1.2.4', '<1.2.3')).toBe(false)
    })

    it('should handle <= operator', () => {
      expect(satisfies('1.2.2', '<=1.2.3')).toBe(true)
      expect(satisfies('1.2.3', '<=1.2.3')).toBe(true)
      expect(satisfies('1.2.4', '<=1.2.3')).toBe(false)
    })
  })

  describe('hyphen ranges', () => {
    it('should match versions in range', () => {
      expect(satisfies('1.2.3', '1.0.0 - 2.0.0')).toBe(true)
      expect(satisfies('1.0.0', '1.0.0 - 2.0.0')).toBe(true)
      expect(satisfies('2.0.0', '1.0.0 - 2.0.0')).toBe(true)
    })

    it('should not match versions outside range', () => {
      expect(satisfies('0.9.9', '1.0.0 - 2.0.0')).toBe(false)
      expect(satisfies('2.0.1', '1.0.0 - 2.0.0')).toBe(false)
    })

    it('should handle partial versions in range', () => {
      // 1.0 - 2.0 means >=1.0.0 <2.1.0
      expect(satisfies('2.0.9', '1.0 - 2.0')).toBe(true)
    })
  })

  describe('x-ranges', () => {
    it('should match with x wildcard', () => {
      expect(satisfies('1.2.3', '1.x')).toBe(true)
      expect(satisfies('1.0.0', '1.x')).toBe(true)
      expect(satisfies('1.9.9', '1.x')).toBe(true)
    })

    it('should not match different major', () => {
      expect(satisfies('2.0.0', '1.x')).toBe(false)
    })

    it('should match with * wildcard', () => {
      expect(satisfies('1.2.3', '1.*')).toBe(true)
      expect(satisfies('1.2.3', '*')).toBe(true)
    })

    it('should match with empty string (any version)', () => {
      expect(satisfies('1.2.3', '')).toBe(true)
    })
  })

  describe('combined ranges (AND)', () => {
    it('should match when all conditions are satisfied', () => {
      expect(satisfies('1.2.3', '>=1.0.0 <2.0.0')).toBe(true)
      expect(satisfies('1.5.0', '>1.0.0 <2.0.0')).toBe(true)
    })

    it('should not match when any condition fails', () => {
      expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false)
      expect(satisfies('0.9.0', '>=1.0.0 <2.0.0')).toBe(false)
    })
  })

  describe('OR ranges (||)', () => {
    it('should match when any range is satisfied', () => {
      expect(satisfies('1.2.3', '1.2.3 || 2.0.0')).toBe(true)
      expect(satisfies('2.0.0', '1.2.3 || 2.0.0')).toBe(true)
    })

    it('should not match when no range is satisfied', () => {
      expect(satisfies('1.5.0', '1.2.3 || 2.0.0')).toBe(false)
    })

    it('should work with complex ranges', () => {
      expect(satisfies('1.5.0', '^1.0.0 || ^2.0.0')).toBe(true)
      expect(satisfies('2.5.0', '^1.0.0 || ^2.0.0')).toBe(true)
      expect(satisfies('3.0.0', '^1.0.0 || ^2.0.0')).toBe(false)
    })
  })

  describe('prerelease handling', () => {
    it('should not match prerelease unless range specifies it', () => {
      // By default, 1.0.0-alpha should not satisfy ^1.0.0
      expect(satisfies('1.0.0-alpha', '^1.0.0')).toBe(false)
    })

    it('should match prerelease when range includes same version prerelease', () => {
      expect(satisfies('1.0.0-alpha.2', '>=1.0.0-alpha.1')).toBe(true)
    })

    it('should match with includePrerelease option', () => {
      expect(satisfies('1.0.0-alpha', '^1.0.0', { includePrerelease: true })).toBe(true)
    })
  })
})

// ============================================================================
// FIND MATCHING VERSION TESTS
// ============================================================================

describe('maxSatisfying - find best matching version', () => {
  const versions = ['1.0.0', '1.1.0', '1.2.0', '1.2.1', '2.0.0', '2.1.0']

  it('should return highest matching version', () => {
    expect(maxSatisfying(versions, '^1.0.0')).toBe('1.2.1')
  })

  it('should return exact match', () => {
    expect(maxSatisfying(versions, '1.1.0')).toBe('1.1.0')
  })

  it('should return null for no match', () => {
    expect(maxSatisfying(versions, '^3.0.0')).toBeNull()
  })

  it('should handle empty version list', () => {
    expect(maxSatisfying([], '^1.0.0')).toBeNull()
  })

  it('should work with tilde ranges', () => {
    expect(maxSatisfying(versions, '~1.2.0')).toBe('1.2.1')
  })

  it('should work with comparison operators', () => {
    expect(maxSatisfying(versions, '>=1.0.0 <2.0.0')).toBe('1.2.1')
    expect(maxSatisfying(versions, '>2.0.0')).toBe('2.1.0')
  })
})

describe('minSatisfying - find lowest matching version', () => {
  const versions = ['1.0.0', '1.1.0', '1.2.0', '1.2.1', '2.0.0', '2.1.0']

  it('should return lowest matching version', () => {
    expect(minSatisfying(versions, '^1.0.0')).toBe('1.0.0')
  })

  it('should return null for no match', () => {
    expect(minSatisfying(versions, '^3.0.0')).toBeNull()
  })

  it('should work with OR ranges', () => {
    expect(minSatisfying(versions, '^1.2.0 || ^2.0.0')).toBe('1.2.0')
  })
})

// ============================================================================
// RANGE VALIDATION TESTS
// ============================================================================

describe('validRange - range validation', () => {
  it('should return normalized range for valid input', () => {
    expect(validRange('^1.0.0')).toBe('>=1.0.0 <2.0.0-0')
    expect(validRange('~1.2.3')).toBe('>=1.2.3 <1.3.0-0')
    expect(validRange('1.2.3')).toBe('1.2.3')
  })

  it('should return null for invalid range', () => {
    expect(validRange('not-valid')).toBeNull()
    expect(validRange('>>1.0.0')).toBeNull()
  })

  it('should handle whitespace', () => {
    expect(validRange('  ^1.0.0  ')).toBe('>=1.0.0 <2.0.0-0')
  })
})

// ============================================================================
// COERCION TESTS
// ============================================================================

describe('coerce - version coercion', () => {
  it('should coerce partial versions', () => {
    expect(coerce('1')).toBe('1.0.0')
    expect(coerce('1.2')).toBe('1.2.0')
    expect(coerce('1.2.3')).toBe('1.2.3')
  })

  it('should coerce versions from text', () => {
    expect(coerce('v1.2.3')).toBe('1.2.3')
    expect(coerce('version 1.2.3')).toBe('1.2.3')
    expect(coerce('1.2.3-alpha')).toBe('1.2.3')
  })

  it('should return null for non-coercible', () => {
    expect(coerce('not a version')).toBeNull()
    expect(coerce('')).toBeNull()
  })
})

describe('clean - version cleaning', () => {
  it('should clean version strings', () => {
    expect(clean(' 1.2.3 ')).toBe('1.2.3')
    expect(clean('v1.2.3')).toBe('1.2.3')
    expect(clean('=1.2.3')).toBe('1.2.3')
  })

  it('should return null for invalid', () => {
    expect(clean('not valid')).toBeNull()
  })
})

// ============================================================================
// VERSION INCREMENT TESTS
// ============================================================================

describe('inc - version increment', () => {
  it('should increment major version', () => {
    expect(inc('1.2.3', 'major')).toBe('2.0.0')
  })

  it('should increment minor version', () => {
    expect(inc('1.2.3', 'minor')).toBe('1.3.0')
  })

  it('should increment patch version', () => {
    expect(inc('1.2.3', 'patch')).toBe('1.2.4')
  })

  it('should handle prerelease increment', () => {
    expect(inc('1.2.3', 'prerelease')).toBe('1.2.4-0')
    expect(inc('1.2.3-alpha.1', 'prerelease')).toBe('1.2.3-alpha.2')
  })

  it('should handle premajor', () => {
    expect(inc('1.2.3', 'premajor')).toBe('2.0.0-0')
  })

  it('should handle preminor', () => {
    expect(inc('1.2.3', 'preminor')).toBe('1.3.0-0')
  })

  it('should handle prepatch', () => {
    expect(inc('1.2.3', 'prepatch')).toBe('1.2.4-0')
  })

  it('should accept prerelease identifier', () => {
    expect(inc('1.2.3', 'prerelease', 'alpha')).toBe('1.2.4-alpha.0')
    expect(inc('1.2.3-alpha.1', 'prerelease', 'alpha')).toBe('1.2.3-alpha.2')
  })
})

// ============================================================================
// VERSION DIFF TESTS
// ============================================================================

describe('diff - version difference', () => {
  it('should return major for major change', () => {
    expect(diff('1.0.0', '2.0.0')).toBe('major')
  })

  it('should return minor for minor change', () => {
    expect(diff('1.0.0', '1.1.0')).toBe('minor')
  })

  it('should return patch for patch change', () => {
    expect(diff('1.0.0', '1.0.1')).toBe('patch')
  })

  it('should return prerelease for prerelease change', () => {
    expect(diff('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe('prerelease')
  })

  it('should return premajor/preminor/prepatch', () => {
    expect(diff('1.0.0', '2.0.0-alpha')).toBe('premajor')
    expect(diff('1.0.0', '1.1.0-alpha')).toBe('preminor')
    expect(diff('1.0.0', '1.0.1-alpha')).toBe('prepatch')
  })

  it('should return null for identical versions', () => {
    expect(diff('1.0.0', '1.0.0')).toBeNull()
  })
})

// ============================================================================
// TYPE DEFINITION TESTS
// ============================================================================

describe('SemVer type', () => {
  it('should have correct structure', () => {
    const v: SemVer = {
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['alpha', 1],
      build: ['build', '001'],
      raw: '1.2.3-alpha.1+build.001',
    }

    expect(v.major).toBe(1)
    expect(v.minor).toBe(2)
    expect(v.patch).toBe(3)
    expect(v.prerelease).toEqual(['alpha', 1])
    expect(v.build).toEqual(['build', '001'])
  })
})

describe('SemVerRange type', () => {
  it('should represent a parsed range', () => {
    const range: SemVerRange = {
      raw: '^1.0.0',
      set: [
        [
          { operator: '>=', semver: { major: 1, minor: 0, patch: 0, prerelease: [], build: [], raw: '1.0.0' } },
          { operator: '<', semver: { major: 2, minor: 0, patch: 0, prerelease: ['0'], build: [], raw: '2.0.0-0' } },
        ],
      ],
    }

    expect(range.raw).toBe('^1.0.0')
    expect(range.set).toHaveLength(1)
    expect(range.set[0]).toHaveLength(2)
  })
})

// ============================================================================
// EDGE CASES AND COMPLEX SCENARIOS
// ============================================================================

describe('edge cases', () => {
  describe('0.x.x version handling', () => {
    it('should handle 0.0.0', () => {
      expect(parseSemver('0.0.0')).not.toBeNull()
      expect(compareSemver('0.0.0', '0.0.1')).toBeLessThan(0)
    })

    it('should handle 0.0.x ranges correctly', () => {
      // In 0.0.x, even patch is considered breaking
      expect(satisfies('0.0.1', '^0.0.0')).toBe(false)
    })
  })

  describe('very large version numbers', () => {
    it('should handle large numbers', () => {
      expect(parseSemver('9999.9999.9999')).not.toBeNull()
      expect(compareSemver('9999.0.0', '9998.9999.9999')).toBeGreaterThan(0)
    })
  })

  describe('special prerelease identifiers', () => {
    it('should handle various prerelease formats', () => {
      expect(parseSemver('1.0.0-x.7.z.92')).not.toBeNull()
      expect(parseSemver('1.0.0-alpha-a.b-c-somethinglong')).not.toBeNull()
    })
  })

  describe('npm registry real-world versions', () => {
    const lodashVersions = [
      '4.17.0', '4.17.1', '4.17.2', '4.17.3', '4.17.4', '4.17.5',
      '4.17.10', '4.17.11', '4.17.15', '4.17.19', '4.17.20', '4.17.21',
    ]

    it('should correctly find latest compatible version', () => {
      expect(maxSatisfying(lodashVersions, '^4.17.0')).toBe('4.17.21')
      expect(maxSatisfying(lodashVersions, '~4.17.10')).toBe('4.17.21')
    })

    it('should correctly find minimum compatible version', () => {
      expect(minSatisfying(lodashVersions, '>=4.17.10')).toBe('4.17.10')
    })
  })

  describe('workspace protocols', () => {
    it('should handle workspace:* syntax', () => {
      expect(satisfies('1.2.3', 'workspace:*')).toBe(true)
    })

    it('should handle workspace:^ syntax', () => {
      expect(satisfies('1.2.3', 'workspace:^')).toBe(true)
    })

    it('should handle workspace:~ syntax', () => {
      expect(satisfies('1.2.3', 'workspace:~')).toBe(true)
    })
  })
})

// ============================================================================
// INTEGRATION WITH SORT -V
// ============================================================================

describe('integration with version sort', () => {
  it('should be consistent with sort -V behavior', () => {
    // Versions that sort -V handles
    const versions = ['1.10.0', '1.2.0', '1.9.0', '2.0.0', '1.0.0']

    // Sort using semver comparison
    const sorted = [...versions].sort((a, b) => compareSemver(a, b))

    expect(sorted).toEqual(['1.0.0', '1.2.0', '1.9.0', '1.10.0', '2.0.0'])
  })

  it('should handle npm-specific cases beyond sort -V', () => {
    // sort -V doesn't understand caret/tilde ranges
    expect(satisfies('1.5.0', '^1.0.0')).toBe(true)
    expect(satisfies('1.5.0', '~1.5.0')).toBe(true)
  })
})
