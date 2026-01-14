import { describe, it, expect } from 'vitest'
import {
  parse,
  valid,
  clean,
  compare,
  lt,
  gt,
  eq,
  neq,
  lte,
  gte,
  coerce,
  SemVer,
  type SemVerObject,
} from '../../../core/semver'

describe('semver', () => {
  describe('parse - basic version parsing', () => {
    it('should parse a simple version string', () => {
      const result = parse('1.2.3')
      expect(result).not.toBeNull()
      expect(result?.major).toBe(1)
      expect(result?.minor).toBe(2)
      expect(result?.patch).toBe(3)
    })

    it('should parse version 0.0.0', () => {
      const result = parse('0.0.0')
      expect(result).not.toBeNull()
      expect(result?.major).toBe(0)
      expect(result?.minor).toBe(0)
      expect(result?.patch).toBe(0)
    })

    it('should parse large version numbers', () => {
      const result = parse('999.999.999')
      expect(result).not.toBeNull()
      expect(result?.major).toBe(999)
      expect(result?.minor).toBe(999)
      expect(result?.patch).toBe(999)
    })

    it('should return the version string from toString()', () => {
      const result = parse('1.2.3')
      expect(result?.version).toBe('1.2.3')
    })
  })

  describe('parse - prerelease versions', () => {
    it('should parse alpha prerelease', () => {
      const result = parse('1.0.0-alpha')
      expect(result).not.toBeNull()
      expect(result?.major).toBe(1)
      expect(result?.minor).toBe(0)
      expect(result?.patch).toBe(0)
      expect(result?.prerelease).toEqual(['alpha'])
    })

    it('should parse alpha.1 prerelease', () => {
      const result = parse('1.0.0-alpha.1')
      expect(result).not.toBeNull()
      expect(result?.prerelease).toEqual(['alpha', 1])
    })

    it('should parse numeric prerelease identifiers', () => {
      const result = parse('1.0.0-0.3.7')
      expect(result).not.toBeNull()
      expect(result?.prerelease).toEqual([0, 3, 7])
    })

    it('should parse beta prerelease', () => {
      const result = parse('1.0.0-beta')
      expect(result).not.toBeNull()
      expect(result?.prerelease).toEqual(['beta'])
    })

    it('should parse rc prerelease', () => {
      const result = parse('1.0.0-rc.1')
      expect(result).not.toBeNull()
      expect(result?.prerelease).toEqual(['rc', 1])
    })

    it('should parse complex prerelease identifiers', () => {
      const result = parse('1.0.0-x.7.z.92')
      expect(result).not.toBeNull()
      expect(result?.prerelease).toEqual(['x', 7, 'z', 92])
    })

    it('should parse prerelease with hyphens', () => {
      const result = parse('1.0.0-alpha-beta')
      expect(result).not.toBeNull()
      expect(result?.prerelease).toEqual(['alpha-beta'])
    })
  })

  describe('parse - build metadata', () => {
    it('should parse build metadata', () => {
      const result = parse('1.0.0+build')
      expect(result).not.toBeNull()
      expect(result?.major).toBe(1)
      expect(result?.minor).toBe(0)
      expect(result?.patch).toBe(0)
      expect(result?.build).toEqual(['build'])
    })

    it('should parse build metadata with numbers', () => {
      const result = parse('1.0.0+001')
      expect(result).not.toBeNull()
      expect(result?.build).toEqual(['001'])
    })

    it('should parse build metadata with dots', () => {
      const result = parse('1.0.0+20130313144700')
      expect(result).not.toBeNull()
      expect(result?.build).toEqual(['20130313144700'])
    })

    it('should parse dotted build metadata', () => {
      const result = parse('1.0.0+exp.sha.5114f85')
      expect(result).not.toBeNull()
      expect(result?.build).toEqual(['exp', 'sha', '5114f85'])
    })

    it('should parse prerelease with build metadata', () => {
      const result = parse('1.0.0-alpha+001')
      expect(result).not.toBeNull()
      expect(result?.prerelease).toEqual(['alpha'])
      expect(result?.build).toEqual(['001'])
    })

    it('should parse complex prerelease with build metadata', () => {
      const result = parse('1.0.0-alpha.1+build.123')
      expect(result).not.toBeNull()
      expect(result?.prerelease).toEqual(['alpha', 1])
      expect(result?.build).toEqual(['build', '123'])
    })
  })

  describe('compare - version comparison', () => {
    it('should compare patch versions', () => {
      expect(compare('1.0.0', '1.0.1')).toBe(-1)
      expect(compare('1.0.1', '1.0.0')).toBe(1)
      expect(compare('1.0.0', '1.0.0')).toBe(0)
    })

    it('should compare minor versions', () => {
      expect(compare('1.0.0', '1.1.0')).toBe(-1)
      expect(compare('1.1.0', '1.0.0')).toBe(1)
      expect(compare('1.1.0', '1.1.0')).toBe(0)
    })

    it('should compare major versions', () => {
      expect(compare('1.0.0', '2.0.0')).toBe(-1)
      expect(compare('2.0.0', '1.0.0')).toBe(1)
      expect(compare('2.0.0', '2.0.0')).toBe(0)
    })

    it('should order versions correctly: 1.0.0 < 1.0.1 < 1.1.0 < 2.0.0', () => {
      expect(lt('1.0.0', '1.0.1')).toBe(true)
      expect(lt('1.0.1', '1.1.0')).toBe(true)
      expect(lt('1.1.0', '2.0.0')).toBe(true)
    })

    it('should compare prerelease versions as lower than release', () => {
      expect(compare('1.0.0-alpha', '1.0.0')).toBe(-1)
      expect(compare('1.0.0', '1.0.0-alpha')).toBe(1)
    })

    it('should ignore build metadata in comparison', () => {
      expect(compare('1.0.0+build1', '1.0.0+build2')).toBe(0)
      expect(compare('1.0.0+build', '1.0.0')).toBe(0)
    })
  })

  describe('compare - prerelease ordering', () => {
    it('should order alpha < beta < rc', () => {
      expect(lt('1.0.0-alpha', '1.0.0-beta')).toBe(true)
      expect(lt('1.0.0-beta', '1.0.0-rc')).toBe(true)
    })

    it('should order rc < release', () => {
      expect(lt('1.0.0-rc', '1.0.0')).toBe(true)
      expect(lt('1.0.0-rc.1', '1.0.0')).toBe(true)
    })

    it('should order numbered prereleases', () => {
      expect(lt('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(true)
      expect(lt('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(true)
    })

    it('should order prerelease identifiers lexically when alphanumeric', () => {
      expect(lt('1.0.0-alpha', '1.0.0-beta')).toBe(true)
      expect(lt('1.0.0-beta', '1.0.0-gamma')).toBe(true)
    })

    it('should compare numeric vs alphanumeric prerelease (numeric < alphanumeric)', () => {
      // Per semver spec: Numeric identifiers always have lower precedence than alphanumeric
      expect(lt('1.0.0-1', '1.0.0-alpha')).toBe(true)
      expect(gt('1.0.0-alpha', '1.0.0-1')).toBe(true)
    })

    it('should compare by identifier count when all else equal', () => {
      // Shorter sets have lower precedence
      expect(lt('1.0.0-alpha', '1.0.0-alpha.1')).toBe(true)
      expect(lt('1.0.0-alpha.1', '1.0.0-alpha.1.1')).toBe(true)
    })
  })

  describe('comparison operators', () => {
    it('lt - less than', () => {
      expect(lt('1.0.0', '2.0.0')).toBe(true)
      expect(lt('2.0.0', '1.0.0')).toBe(false)
      expect(lt('1.0.0', '1.0.0')).toBe(false)
    })

    it('gt - greater than', () => {
      expect(gt('2.0.0', '1.0.0')).toBe(true)
      expect(gt('1.0.0', '2.0.0')).toBe(false)
      expect(gt('1.0.0', '1.0.0')).toBe(false)
    })

    it('eq - equal', () => {
      expect(eq('1.0.0', '1.0.0')).toBe(true)
      expect(eq('1.0.0', '2.0.0')).toBe(false)
    })

    it('neq - not equal', () => {
      expect(neq('1.0.0', '2.0.0')).toBe(true)
      expect(neq('1.0.0', '1.0.0')).toBe(false)
    })

    it('lte - less than or equal', () => {
      expect(lte('1.0.0', '2.0.0')).toBe(true)
      expect(lte('1.0.0', '1.0.0')).toBe(true)
      expect(lte('2.0.0', '1.0.0')).toBe(false)
    })

    it('gte - greater than or equal', () => {
      expect(gte('2.0.0', '1.0.0')).toBe(true)
      expect(gte('1.0.0', '1.0.0')).toBe(true)
      expect(gte('1.0.0', '2.0.0')).toBe(false)
    })
  })

  describe('valid - version validation', () => {
    it('should return version for valid strings', () => {
      expect(valid('1.2.3')).toBe('1.2.3')
      expect(valid('0.0.0')).toBe('0.0.0')
      expect(valid('1.0.0-alpha')).toBe('1.0.0-alpha')
    })

    it('should return null for invalid strings', () => {
      expect(valid('1')).toBeNull()
      expect(valid('1.2')).toBeNull()
      expect(valid('a.b.c')).toBeNull()
      expect(valid('1.2.3.4')).toBeNull()
    })

    it('should return null for empty or non-string inputs', () => {
      expect(valid('')).toBeNull()
      expect(valid(null as any)).toBeNull()
      expect(valid(undefined as any)).toBeNull()
    })
  })

  describe('invalid versions', () => {
    it('should reject single number', () => {
      expect(parse('1')).toBeNull()
    })

    it('should reject two numbers', () => {
      expect(parse('1.2')).toBeNull()
    })

    it('should reject non-numeric versions', () => {
      expect(parse('a.b.c')).toBeNull()
    })

    it('should reject four-part versions', () => {
      expect(parse('1.2.3.4')).toBeNull()
    })

    it('should reject leading zeros in numeric identifiers', () => {
      expect(parse('01.2.3')).toBeNull()
      expect(parse('1.02.3')).toBeNull()
      expect(parse('1.2.03')).toBeNull()
    })

    it('should reject negative numbers', () => {
      expect(parse('-1.2.3')).toBeNull()
      expect(parse('1.-2.3')).toBeNull()
      expect(parse('1.2.-3')).toBeNull()
    })

    it('should reject versions with spaces', () => {
      expect(parse(' 1.2.3')).toBeNull()
      expect(parse('1.2.3 ')).toBeNull()
      expect(parse('1. 2.3')).toBeNull()
    })

    it('should reject empty prerelease identifiers', () => {
      expect(parse('1.0.0-')).toBeNull()
      expect(parse('1.0.0-alpha.')).toBeNull()
      expect(parse('1.0.0-.alpha')).toBeNull()
    })

    it('should reject empty build metadata identifiers', () => {
      expect(parse('1.0.0+')).toBeNull()
      expect(parse('1.0.0+build.')).toBeNull()
      expect(parse('1.0.0+.build')).toBeNull()
    })
  })

  describe('coerce - version coercion', () => {
    it('should strip leading v', () => {
      const result = coerce('v1.2.3')
      expect(result?.version).toBe('1.2.3')
    })

    it('should strip leading V (uppercase)', () => {
      const result = coerce('V1.2.3')
      expect(result?.version).toBe('1.2.3')
    })

    it('should coerce single number to x.0.0', () => {
      const result = coerce('1')
      expect(result?.version).toBe('1.0.0')
    })

    it('should coerce two numbers to x.y.0', () => {
      const result = coerce('1.2')
      expect(result?.version).toBe('1.2.0')
    })

    it('should extract version from string with prefix', () => {
      const result = coerce('version 1.2.3')
      expect(result?.version).toBe('1.2.3')
    })

    it('should extract version from string with suffix', () => {
      const result = coerce('1.2.3-beta is the version')
      expect(result?.version).toBe('1.2.3')
    })

    it('should coerce from package name format', () => {
      const result = coerce('lodash@4.17.21')
      expect(result?.version).toBe('4.17.21')
    })

    it('should return null for uncoercible strings', () => {
      expect(coerce('not a version')).toBeNull()
      expect(coerce('')).toBeNull()
    })
  })

  describe('clean - version cleaning', () => {
    it('should strip leading and trailing whitespace', () => {
      expect(clean('  1.2.3  ')).toBe('1.2.3')
    })

    it('should strip leading v', () => {
      expect(clean('v1.2.3')).toBe('1.2.3')
    })

    it('should strip leading = and v', () => {
      expect(clean('=v1.2.3')).toBe('1.2.3')
      expect(clean('= v1.2.3')).toBe('1.2.3')
    })

    it('should return null for invalid versions after cleaning', () => {
      expect(clean('not a version')).toBeNull()
    })
  })

  describe('SemVer class', () => {
    it('should create instance from string', () => {
      const v = new SemVer('1.2.3')
      expect(v.major).toBe(1)
      expect(v.minor).toBe(2)
      expect(v.patch).toBe(3)
      expect(v.version).toBe('1.2.3')
    })

    it('should create instance from another SemVer', () => {
      const v1 = new SemVer('1.2.3')
      const v2 = new SemVer(v1)
      expect(v2.version).toBe('1.2.3')
    })

    it('should throw on invalid version', () => {
      expect(() => new SemVer('invalid')).toThrow()
    })

    it('should implement compare method', () => {
      const v = new SemVer('1.0.0')
      expect(v.compare('2.0.0')).toBe(-1)
      expect(v.compare('1.0.0')).toBe(0)
      expect(v.compare('0.9.0')).toBe(1)
    })

    it('should implement toString method', () => {
      const v = new SemVer('1.2.3-alpha+build')
      expect(v.toString()).toBe('1.2.3-alpha+build')
    })

    it('should have raw property with original string', () => {
      const v = new SemVer('v1.2.3')
      expect(v.raw).toBe('v1.2.3')
      expect(v.version).toBe('1.2.3')
    })

    it('should provide inc method for incrementing', () => {
      const v = new SemVer('1.2.3')
      expect(v.inc('patch').version).toBe('1.2.4')
      expect(v.inc('minor').version).toBe('1.3.0')
      expect(v.inc('major').version).toBe('2.0.0')
    })

    it('should increment prerelease versions', () => {
      const v = new SemVer('1.0.0-alpha.1')
      expect(v.inc('prerelease').version).toBe('1.0.0-alpha.2')
    })
  })

  describe('loose vs strict parsing modes', () => {
    it('should accept leading v in loose mode', () => {
      const result = parse('v1.2.3', { loose: true })
      expect(result).not.toBeNull()
      expect(result?.version).toBe('1.2.3')
    })

    it('should reject leading v in strict mode (default)', () => {
      const result = parse('v1.2.3')
      expect(result).toBeNull()
    })

    it('should accept leading = in loose mode', () => {
      const result = parse('=1.2.3', { loose: true })
      expect(result).not.toBeNull()
      expect(result?.version).toBe('1.2.3')
    })

    it('should accept leading zeros in prerelease in loose mode', () => {
      const result = parse('1.0.0-01', { loose: true })
      expect(result).not.toBeNull()
    })

    it('should reject leading zeros in prerelease in strict mode', () => {
      // Leading zeros in numeric prerelease identifiers are not allowed per spec
      const result = parse('1.0.0-01')
      expect(result).toBeNull()
    })

    it('should accept extra whitespace in loose mode', () => {
      const result = parse('  1.2.3  ', { loose: true })
      expect(result).not.toBeNull()
      expect(result?.version).toBe('1.2.3')
    })

    it('should reject extra whitespace in strict mode', () => {
      const result = parse('  1.2.3  ')
      expect(result).toBeNull()
    })
  })

  describe('edge cases and npm semver compatibility', () => {
    it('should handle version 0.0.0-0', () => {
      const result = parse('0.0.0-0')
      expect(result).not.toBeNull()
      expect(result?.prerelease).toEqual([0])
    })

    it('should handle very long prerelease identifiers', () => {
      const longIdent = 'a'.repeat(100)
      const result = parse(`1.0.0-${longIdent}`)
      expect(result).not.toBeNull()
      expect(result?.prerelease).toEqual([longIdent])
    })

    it('should handle many prerelease identifiers', () => {
      const result = parse('1.0.0-a.b.c.d.e.f.g')
      expect(result).not.toBeNull()
      expect(result?.prerelease).toHaveLength(7)
    })

    it('should handle build metadata with hyphens', () => {
      const result = parse('1.0.0+build-123')
      expect(result).not.toBeNull()
      expect(result?.build).toEqual(['build-123'])
    })

    it('should sort array of versions correctly', () => {
      const versions = ['2.0.0', '1.0.0', '1.10.0', '1.2.0', '1.0.0-alpha']
      const sorted = versions.sort(compare)
      expect(sorted).toEqual(['1.0.0-alpha', '1.0.0', '1.2.0', '1.10.0', '2.0.0'])
    })

    it('should handle version with both prerelease and build', () => {
      const result = parse('1.0.0-beta.11+sha.0a1b2c3')
      expect(result).not.toBeNull()
      expect(result?.prerelease).toEqual(['beta', 11])
      expect(result?.build).toEqual(['sha', '0a1b2c3'])
    })
  })
})
