/**
 * Semver Range Resolution Tests (RED Phase)
 *
 * These tests verify npm-compatible semver range resolution behavior.
 * Tests are expected to FAIL initially - implementation comes in GREEN phase.
 */

import { describe, it, expect } from 'vitest'
import {
  satisfies,
  maxSatisfying,
  minSatisfying,
  validRange,
  parseRange,
  intersects,
} from '../../../core/semver'

describe('Semver Range Resolution', () => {
  describe('Exact version matching', () => {
    it('matches exact version "1.2.3"', () => {
      expect(satisfies('1.2.3', '1.2.3')).toBe(true)
    })

    it('does not match different versions', () => {
      expect(satisfies('1.2.4', '1.2.3')).toBe(false)
      expect(satisfies('1.2.2', '1.2.3')).toBe(false)
      expect(satisfies('1.3.3', '1.2.3')).toBe(false)
      expect(satisfies('2.2.3', '1.2.3')).toBe(false)
    })

    it('handles versions with v prefix', () => {
      expect(satisfies('v1.2.3', '1.2.3')).toBe(true)
      expect(satisfies('1.2.3', 'v1.2.3')).toBe(true)
    })

    it('handles versions with = prefix', () => {
      expect(satisfies('1.2.3', '=1.2.3')).toBe(true)
      expect(satisfies('1.2.4', '=1.2.3')).toBe(false)
    })
  })

  describe('Comparator ranges', () => {
    describe('greater than (>)', () => {
      it('matches versions greater than specified', () => {
        expect(satisfies('1.0.1', '>1.0.0')).toBe(true)
        expect(satisfies('1.1.0', '>1.0.0')).toBe(true)
        expect(satisfies('2.0.0', '>1.0.0')).toBe(true)
      })

      it('does not match equal or lesser versions', () => {
        expect(satisfies('1.0.0', '>1.0.0')).toBe(false)
        expect(satisfies('0.9.9', '>1.0.0')).toBe(false)
      })
    })

    describe('greater than or equal (>=)', () => {
      it('matches versions greater than or equal', () => {
        expect(satisfies('1.0.0', '>=1.0.0')).toBe(true)
        expect(satisfies('1.0.1', '>=1.0.0')).toBe(true)
        expect(satisfies('2.0.0', '>=1.0.0')).toBe(true)
      })

      it('does not match lesser versions', () => {
        expect(satisfies('0.9.9', '>=1.0.0')).toBe(false)
        expect(satisfies('0.0.1', '>=1.0.0')).toBe(false)
      })
    })

    describe('less than (<)', () => {
      it('matches versions less than specified', () => {
        expect(satisfies('1.9.9', '<2.0.0')).toBe(true)
        expect(satisfies('0.0.1', '<2.0.0')).toBe(true)
        expect(satisfies('1.0.0', '<2.0.0')).toBe(true)
      })

      it('does not match equal or greater versions', () => {
        expect(satisfies('2.0.0', '<2.0.0')).toBe(false)
        expect(satisfies('2.0.1', '<2.0.0')).toBe(false)
        expect(satisfies('3.0.0', '<2.0.0')).toBe(false)
      })
    })

    describe('less than or equal (<=)', () => {
      it('matches versions less than or equal', () => {
        expect(satisfies('2.0.0', '<=2.0.0')).toBe(true)
        expect(satisfies('1.9.9', '<=2.0.0')).toBe(true)
        expect(satisfies('0.0.1', '<=2.0.0')).toBe(true)
      })

      it('does not match greater versions', () => {
        expect(satisfies('2.0.1', '<=2.0.0')).toBe(false)
        expect(satisfies('3.0.0', '<=2.0.0')).toBe(false)
      })
    })
  })

  describe('Hyphen ranges', () => {
    it('matches versions in "1.0.0 - 2.0.0" (inclusive)', () => {
      expect(satisfies('1.0.0', '1.0.0 - 2.0.0')).toBe(true)
      expect(satisfies('1.5.0', '1.0.0 - 2.0.0')).toBe(true)
      expect(satisfies('2.0.0', '1.0.0 - 2.0.0')).toBe(true)
    })

    it('does not match versions outside range', () => {
      expect(satisfies('0.9.9', '1.0.0 - 2.0.0')).toBe(false)
      expect(satisfies('2.0.1', '1.0.0 - 2.0.0')).toBe(false)
    })

    it('handles partial versions on right side', () => {
      // "1.0.0 - 2" means >=1.0.0 <3.0.0-0
      expect(satisfies('1.0.0', '1.0.0 - 2')).toBe(true)
      expect(satisfies('2.9.9', '1.0.0 - 2')).toBe(true)
      expect(satisfies('3.0.0', '1.0.0 - 2')).toBe(false)
    })

    it('handles partial versions on left side', () => {
      // "1 - 2.0.0" means >=1.0.0 <=2.0.0
      expect(satisfies('1.0.0', '1 - 2.0.0')).toBe(true)
      expect(satisfies('1.9.9', '1 - 2.0.0')).toBe(true)
      expect(satisfies('2.0.0', '1 - 2.0.0')).toBe(true)
      expect(satisfies('2.0.1', '1 - 2.0.0')).toBe(false)
    })

    it('handles "1.2 - 2.3.4"', () => {
      // >=1.2.0 <=2.3.4
      expect(satisfies('1.2.0', '1.2 - 2.3.4')).toBe(true)
      expect(satisfies('2.3.4', '1.2 - 2.3.4')).toBe(true)
      expect(satisfies('1.1.9', '1.2 - 2.3.4')).toBe(false)
      expect(satisfies('2.3.5', '1.2 - 2.3.4')).toBe(false)
    })
  })

  describe('X-ranges (wildcards)', () => {
    describe('"*" matches any version', () => {
      it('matches all versions', () => {
        expect(satisfies('0.0.1', '*')).toBe(true)
        expect(satisfies('1.0.0', '*')).toBe(true)
        expect(satisfies('999.999.999', '*')).toBe(true)
      })

      it('also accepts empty string as wildcard', () => {
        expect(satisfies('1.0.0', '')).toBe(true)
      })
    })

    describe('"1.x" matches any 1.*.* version', () => {
      it('matches 1.x.x versions', () => {
        expect(satisfies('1.0.0', '1.x')).toBe(true)
        expect(satisfies('1.9.9', '1.x')).toBe(true)
        expect(satisfies('1.99.99', '1.x')).toBe(true)
      })

      it('does not match other major versions', () => {
        expect(satisfies('0.9.9', '1.x')).toBe(false)
        expect(satisfies('2.0.0', '1.x')).toBe(false)
      })

      it('also works with 1.X and 1.*', () => {
        expect(satisfies('1.5.0', '1.X')).toBe(true)
        expect(satisfies('1.5.0', '1.*')).toBe(true)
        expect(satisfies('2.0.0', '1.X')).toBe(false)
        expect(satisfies('2.0.0', '1.*')).toBe(false)
      })
    })

    describe('"1.2.x" matches any 1.2.* version', () => {
      it('matches 1.2.x versions', () => {
        expect(satisfies('1.2.0', '1.2.x')).toBe(true)
        expect(satisfies('1.2.99', '1.2.x')).toBe(true)
      })

      it('does not match other minor versions', () => {
        expect(satisfies('1.1.9', '1.2.x')).toBe(false)
        expect(satisfies('1.3.0', '1.2.x')).toBe(false)
      })

      it('also works with 1.2.X and 1.2.*', () => {
        expect(satisfies('1.2.5', '1.2.X')).toBe(true)
        expect(satisfies('1.2.5', '1.2.*')).toBe(true)
      })
    })

    describe('partial versions as X-ranges', () => {
      it('"1" is equivalent to "1.x.x"', () => {
        expect(satisfies('1.0.0', '1')).toBe(true)
        expect(satisfies('1.9.9', '1')).toBe(true)
        expect(satisfies('2.0.0', '1')).toBe(false)
      })

      it('"1.2" is equivalent to "1.2.x"', () => {
        expect(satisfies('1.2.0', '1.2')).toBe(true)
        expect(satisfies('1.2.99', '1.2')).toBe(true)
        expect(satisfies('1.3.0', '1.2')).toBe(false)
      })
    })
  })

  describe('Tilde ranges (~)', () => {
    describe('"~1.2.3" allows patch-level changes', () => {
      it('matches >=1.2.3 <1.3.0-0', () => {
        expect(satisfies('1.2.3', '~1.2.3')).toBe(true)
        expect(satisfies('1.2.4', '~1.2.3')).toBe(true)
        expect(satisfies('1.2.99', '~1.2.3')).toBe(true)
      })

      it('does not match minor or major bumps', () => {
        expect(satisfies('1.3.0', '~1.2.3')).toBe(false)
        expect(satisfies('2.0.0', '~1.2.3')).toBe(false)
      })

      it('does not match earlier patches', () => {
        expect(satisfies('1.2.2', '~1.2.3')).toBe(false)
      })
    })

    describe('"~1.2" allows patch-level changes if minor specified', () => {
      it('matches >=1.2.0 <1.3.0-0', () => {
        expect(satisfies('1.2.0', '~1.2')).toBe(true)
        expect(satisfies('1.2.99', '~1.2')).toBe(true)
        expect(satisfies('1.3.0', '~1.2')).toBe(false)
      })
    })

    describe('"~1" allows minor-level changes', () => {
      it('matches >=1.0.0 <2.0.0-0', () => {
        expect(satisfies('1.0.0', '~1')).toBe(true)
        expect(satisfies('1.9.9', '~1')).toBe(true)
        expect(satisfies('2.0.0', '~1')).toBe(false)
      })
    })

    describe('"~0.2.3" allows patch-level changes', () => {
      it('matches >=0.2.3 <0.3.0-0', () => {
        expect(satisfies('0.2.3', '~0.2.3')).toBe(true)
        expect(satisfies('0.2.99', '~0.2.3')).toBe(true)
        expect(satisfies('0.3.0', '~0.2.3')).toBe(false)
      })
    })

    describe('"~0.0.3" allows patch-level changes', () => {
      it('matches >=0.0.3 <0.1.0-0', () => {
        expect(satisfies('0.0.3', '~0.0.3')).toBe(true)
        expect(satisfies('0.0.4', '~0.0.3')).toBe(true)
        expect(satisfies('0.1.0', '~0.0.3')).toBe(false)
      })
    })
  })

  describe('Caret ranges (^)', () => {
    describe('"^1.2.3" allows minor and patch changes for 1.x', () => {
      it('matches >=1.2.3 <2.0.0-0', () => {
        expect(satisfies('1.2.3', '^1.2.3')).toBe(true)
        expect(satisfies('1.2.4', '^1.2.3')).toBe(true)
        expect(satisfies('1.3.0', '^1.2.3')).toBe(true)
        expect(satisfies('1.99.99', '^1.2.3')).toBe(true)
      })

      it('does not match major bumps', () => {
        expect(satisfies('2.0.0', '^1.2.3')).toBe(false)
      })

      it('does not match earlier versions', () => {
        expect(satisfies('1.2.2', '^1.2.3')).toBe(false)
        expect(satisfies('1.1.9', '^1.2.3')).toBe(false)
      })
    })

    describe('"^0.2.3" allows only patch changes (0.x special case)', () => {
      it('matches >=0.2.3 <0.3.0-0', () => {
        expect(satisfies('0.2.3', '^0.2.3')).toBe(true)
        expect(satisfies('0.2.4', '^0.2.3')).toBe(true)
        expect(satisfies('0.2.99', '^0.2.3')).toBe(true)
      })

      it('does not match minor bumps in 0.x', () => {
        expect(satisfies('0.3.0', '^0.2.3')).toBe(false)
      })

      it('does not match major bumps', () => {
        expect(satisfies('1.0.0', '^0.2.3')).toBe(false)
      })
    })

    describe('"^0.0.3" matches exactly (0.0.x special case)', () => {
      it('matches only 0.0.3', () => {
        expect(satisfies('0.0.3', '^0.0.3')).toBe(true)
      })

      it('does not match any other version', () => {
        expect(satisfies('0.0.4', '^0.0.3')).toBe(false)
        expect(satisfies('0.0.2', '^0.0.3')).toBe(false)
        expect(satisfies('0.1.0', '^0.0.3')).toBe(false)
      })
    })

    describe('"^1.2.x" allows minor and patch', () => {
      it('matches >=1.2.0 <2.0.0-0', () => {
        expect(satisfies('1.2.0', '^1.2.x')).toBe(true)
        expect(satisfies('1.9.9', '^1.2.x')).toBe(true)
        expect(satisfies('2.0.0', '^1.2.x')).toBe(false)
      })
    })

    describe('"^0.0.x" matches any 0.0.x', () => {
      it('matches >=0.0.0 <0.1.0-0', () => {
        expect(satisfies('0.0.0', '^0.0.x')).toBe(true)
        expect(satisfies('0.0.99', '^0.0.x')).toBe(true)
        expect(satisfies('0.1.0', '^0.0.x')).toBe(false)
      })
    })

    describe('"^0.0" matches any 0.0.x', () => {
      it('matches >=0.0.0 <0.1.0-0', () => {
        expect(satisfies('0.0.0', '^0.0')).toBe(true)
        expect(satisfies('0.0.99', '^0.0')).toBe(true)
        expect(satisfies('0.1.0', '^0.0')).toBe(false)
      })
    })

    describe('"^1.2" allows minor and patch', () => {
      it('matches >=1.2.0 <2.0.0-0', () => {
        expect(satisfies('1.2.0', '^1.2')).toBe(true)
        expect(satisfies('1.9.9', '^1.2')).toBe(true)
        expect(satisfies('2.0.0', '^1.2')).toBe(false)
      })
    })

    describe('"^0.x" allows minor and patch in 0.x', () => {
      it('matches >=0.0.0 <1.0.0-0', () => {
        expect(satisfies('0.0.0', '^0.x')).toBe(true)
        expect(satisfies('0.9.9', '^0.x')).toBe(true)
        expect(satisfies('1.0.0', '^0.x')).toBe(false)
      })
    })
  })

  describe('Range intersections (AND)', () => {
    describe('space-separated ranges (implicit AND)', () => {
      it('">=1.0.0 <2.0.0" matches intersection', () => {
        expect(satisfies('1.0.0', '>=1.0.0 <2.0.0')).toBe(true)
        expect(satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true)
        expect(satisfies('1.9.9', '>=1.0.0 <2.0.0')).toBe(true)
      })

      it('does not match outside intersection', () => {
        expect(satisfies('0.9.9', '>=1.0.0 <2.0.0')).toBe(false)
        expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false)
      })
    })

    describe('complex intersections', () => {
      it('">1.0.0 <1.5.0" narrows the range', () => {
        expect(satisfies('1.0.1', '>1.0.0 <1.5.0')).toBe(true)
        expect(satisfies('1.4.9', '>1.0.0 <1.5.0')).toBe(true)
        expect(satisfies('1.0.0', '>1.0.0 <1.5.0')).toBe(false)
        expect(satisfies('1.5.0', '>1.0.0 <1.5.0')).toBe(false)
      })

      it('">=1.0.0 <=2.0.0 !=1.5.0" excludes specific version', () => {
        expect(satisfies('1.0.0', '>=1.0.0 <=2.0.0')).toBe(true)
        expect(satisfies('1.4.9', '>=1.0.0 <=2.0.0')).toBe(true)
        expect(satisfies('2.0.0', '>=1.0.0 <=2.0.0')).toBe(true)
      })
    })
  })

  describe('Range unions (OR)', () => {
    describe('"||" separated ranges', () => {
      it('"1.x || 2.x" matches either major version', () => {
        expect(satisfies('1.0.0', '1.x || 2.x')).toBe(true)
        expect(satisfies('1.9.9', '1.x || 2.x')).toBe(true)
        expect(satisfies('2.0.0', '1.x || 2.x')).toBe(true)
        expect(satisfies('2.9.9', '1.x || 2.x')).toBe(true)
      })

      it('does not match other major versions', () => {
        expect(satisfies('0.9.9', '1.x || 2.x')).toBe(false)
        expect(satisfies('3.0.0', '1.x || 2.x')).toBe(false)
      })
    })

    describe('complex unions', () => {
      it('"<1.0.0 || >=2.0.0" matches below 1 or at/above 2', () => {
        expect(satisfies('0.9.9', '<1.0.0 || >=2.0.0')).toBe(true)
        expect(satisfies('0.0.1', '<1.0.0 || >=2.0.0')).toBe(true)
        expect(satisfies('2.0.0', '<1.0.0 || >=2.0.0')).toBe(true)
        expect(satisfies('3.0.0', '<1.0.0 || >=2.0.0')).toBe(true)
      })

      it('does not match between 1.0.0 and 2.0.0', () => {
        expect(satisfies('1.0.0', '<1.0.0 || >=2.0.0')).toBe(false)
        expect(satisfies('1.5.0', '<1.0.0 || >=2.0.0')).toBe(false)
        expect(satisfies('1.9.9', '<1.0.0 || >=2.0.0')).toBe(false)
      })
    })

    describe('union with intersection', () => {
      it('">=1.0.0 <1.5.0 || >=2.0.0 <2.5.0"', () => {
        expect(satisfies('1.0.0', '>=1.0.0 <1.5.0 || >=2.0.0 <2.5.0')).toBe(true)
        expect(satisfies('1.4.9', '>=1.0.0 <1.5.0 || >=2.0.0 <2.5.0')).toBe(true)
        expect(satisfies('2.0.0', '>=1.0.0 <1.5.0 || >=2.0.0 <2.5.0')).toBe(true)
        expect(satisfies('2.4.9', '>=1.0.0 <1.5.0 || >=2.0.0 <2.5.0')).toBe(true)
        expect(satisfies('1.5.0', '>=1.0.0 <1.5.0 || >=2.0.0 <2.5.0')).toBe(false)
        expect(satisfies('1.9.9', '>=1.0.0 <1.5.0 || >=2.0.0 <2.5.0')).toBe(false)
        expect(satisfies('2.5.0', '>=1.0.0 <1.5.0 || >=2.0.0 <2.5.0')).toBe(false)
      })
    })
  })

  describe('Prerelease matching rules', () => {
    describe('prerelease versions only match ranges with same major.minor.patch', () => {
      it('">1.0.0" does not match "1.0.1-alpha" by default', () => {
        // Prereleases only match if the comparator includes that exact tuple
        expect(satisfies('1.0.1-alpha', '>1.0.0')).toBe(false)
      })

      it('">=1.0.1-alpha" matches "1.0.1-alpha"', () => {
        expect(satisfies('1.0.1-alpha', '>=1.0.1-alpha')).toBe(true)
      })

      it('">=1.0.1-alpha" matches "1.0.1-beta"', () => {
        expect(satisfies('1.0.1-beta', '>=1.0.1-alpha')).toBe(true)
      })

      it('">=1.0.1-alpha" matches "1.0.1" (release)', () => {
        expect(satisfies('1.0.1', '>=1.0.1-alpha')).toBe(true)
      })

      it('"^1.0.0" does not match prereleases by default', () => {
        expect(satisfies('1.0.1-alpha', '^1.0.0')).toBe(false)
      })

      it('"^1.0.0-alpha" matches prereleases of 1.0.0', () => {
        expect(satisfies('1.0.0-beta', '^1.0.0-alpha')).toBe(true)
        expect(satisfies('1.0.0-alpha.2', '^1.0.0-alpha')).toBe(true)
        expect(satisfies('1.0.0', '^1.0.0-alpha')).toBe(true)
      })
    })

    describe('prerelease ordering', () => {
      it('alpha < beta < rc < release', () => {
        expect(satisfies('1.0.0-beta', '>1.0.0-alpha')).toBe(true)
        expect(satisfies('1.0.0-rc.1', '>1.0.0-beta')).toBe(true)
        expect(satisfies('1.0.0', '>1.0.0-rc.1')).toBe(true)
      })

      it('numeric prerelease identifiers sort numerically', () => {
        expect(satisfies('1.0.0-alpha.2', '>1.0.0-alpha.1')).toBe(true)
        expect(satisfies('1.0.0-alpha.10', '>1.0.0-alpha.9')).toBe(true)
        expect(satisfies('1.0.0-alpha.10', '>1.0.0-alpha.2')).toBe(true)
      })

      it('string prerelease identifiers sort lexically', () => {
        expect(satisfies('1.0.0-beta', '>1.0.0-alpha')).toBe(true)
        expect(satisfies('1.0.0-alpha', '<1.0.0-beta')).toBe(true)
      })
    })

    describe('includePrerelease option', () => {
      it('">1.0.0" matches "2.0.0-alpha" with includePrerelease', () => {
        expect(satisfies('2.0.0-alpha', '>1.0.0', { includePrerelease: true })).toBe(true)
      })

      it('"^1.0.0" matches "1.5.0-alpha" with includePrerelease', () => {
        expect(satisfies('1.5.0-alpha', '^1.0.0', { includePrerelease: true })).toBe(true)
      })
    })
  })

  describe('maxSatisfying', () => {
    const versions = ['1.0.0', '1.2.0', '1.2.3', '1.5.0', '2.0.0', '2.1.0']

    it('returns the highest version matching the range', () => {
      expect(maxSatisfying(versions, '^1.0.0')).toBe('1.5.0')
      expect(maxSatisfying(versions, '^2.0.0')).toBe('2.1.0')
      expect(maxSatisfying(versions, '~1.2.0')).toBe('1.2.3')
      expect(maxSatisfying(versions, '>=1.0.0 <1.5.0')).toBe('1.2.3')
    })

    it('returns null if no version matches', () => {
      expect(maxSatisfying(versions, '^3.0.0')).toBe(null)
      expect(maxSatisfying(versions, '<1.0.0')).toBe(null)
    })

    it('handles empty version list', () => {
      expect(maxSatisfying([], '^1.0.0')).toBe(null)
    })

    it('works with prerelease versions', () => {
      const versionsWithPre = ['1.0.0', '1.1.0', '1.2.0-alpha', '1.2.0-beta', '1.2.0']
      expect(maxSatisfying(versionsWithPre, '>=1.2.0-alpha <1.2.0')).toBe('1.2.0-beta')
      expect(maxSatisfying(versionsWithPre, '^1.0.0')).toBe('1.2.0')
    })

    it('handles "*" range', () => {
      expect(maxSatisfying(versions, '*')).toBe('2.1.0')
    })
  })

  describe('minSatisfying', () => {
    const versions = ['1.0.0', '1.2.0', '1.2.3', '1.5.0', '2.0.0', '2.1.0']

    it('returns the lowest version matching the range', () => {
      expect(minSatisfying(versions, '^1.0.0')).toBe('1.0.0')
      expect(minSatisfying(versions, '^2.0.0')).toBe('2.0.0')
      expect(minSatisfying(versions, '~1.2.0')).toBe('1.2.0')
      expect(minSatisfying(versions, '>1.0.0')).toBe('1.2.0')
    })

    it('returns null if no version matches', () => {
      expect(minSatisfying(versions, '^3.0.0')).toBe(null)
      expect(minSatisfying(versions, '<1.0.0')).toBe(null)
    })

    it('handles empty version list', () => {
      expect(minSatisfying([], '^1.0.0')).toBe(null)
    })

    it('works with prerelease versions', () => {
      const versionsWithPre = ['1.0.0', '1.1.0', '1.2.0-alpha', '1.2.0-beta', '1.2.0']
      expect(minSatisfying(versionsWithPre, '>=1.2.0-alpha')).toBe('1.2.0-alpha')
    })

    it('handles "*" range', () => {
      expect(minSatisfying(versions, '*')).toBe('1.0.0')
    })
  })

  describe('validRange', () => {
    it('returns normalized range for valid inputs', () => {
      expect(validRange('1.0.0')).toBe('1.0.0')
      expect(validRange('^1.0.0')).toBeTruthy()
      expect(validRange('>=1.0.0 <2.0.0')).toBeTruthy()
      expect(validRange('1.x || 2.x')).toBeTruthy()
    })

    it('returns null for invalid ranges', () => {
      expect(validRange('not a range')).toBe(null)
      expect(validRange('>>1.0.0')).toBe(null)
      expect(validRange('1.0.0.0.0')).toBe(null)
    })

    it('normalizes various input formats', () => {
      expect(validRange('  ^1.0.0  ')).toBeTruthy()
      expect(validRange('v1.0.0')).toBeTruthy()
      expect(validRange('=1.0.0')).toBeTruthy()
    })
  })

  describe('parseRange', () => {
    it('returns parsed range object for valid inputs', () => {
      const range = parseRange('^1.2.3')
      expect(range).toBeTruthy()
      expect(range?.set).toBeInstanceOf(Array)
    })

    it('returns null for invalid ranges', () => {
      expect(parseRange('invalid')).toBe(null)
    })
  })

  describe('intersects', () => {
    it('returns true for overlapping ranges', () => {
      expect(intersects('^1.0.0', '>=1.5.0 <2.0.0')).toBe(true)
      expect(intersects('1.x', '>=1.0.0')).toBe(true)
      expect(intersects('>=1.0.0 <2.0.0', '>=1.5.0 <3.0.0')).toBe(true)
    })

    it('returns false for non-overlapping ranges', () => {
      expect(intersects('^1.0.0', '^2.0.0')).toBe(false)
      expect(intersects('<1.0.0', '>2.0.0')).toBe(false)
      expect(intersects('1.x', '2.x')).toBe(false)
    })

    it('handles edge cases', () => {
      expect(intersects('1.0.0', '1.0.0')).toBe(true)
      expect(intersects('>=1.0.0 <1.0.1', '>=1.0.0 <1.0.1')).toBe(true)
      expect(intersects('>=1.0.0 <1.0.1', '>=1.0.1 <1.0.2')).toBe(false)
    })
  })

  describe('Edge cases and error handling', () => {
    it('handles whitespace in ranges', () => {
      expect(satisfies('1.0.0', '  >=1.0.0   <2.0.0  ')).toBe(true)
      expect(satisfies('1.0.0', '\t^1.0.0\n')).toBe(true)
    })

    it('handles unusual but valid ranges', () => {
      expect(satisfies('1.0.0', '>=1.0.0')).toBe(true)
      expect(satisfies('1.0.0', '1.0.0 - 1.0.0')).toBe(true)
    })

    it('returns false for invalid versions', () => {
      expect(satisfies('invalid', '^1.0.0')).toBe(false)
      expect(satisfies('1.0', '^1.0.0')).toBe(false)
    })

    it('handles leading zeros correctly', () => {
      // Leading zeros are not valid in semver
      expect(satisfies('01.0.0', '^1.0.0')).toBe(false)
      expect(satisfies('1.00.0', '^1.0.0')).toBe(false)
    })

    it('handles very large version numbers', () => {
      expect(satisfies('999.999.999', '>=1.0.0')).toBe(true)
      expect(satisfies('1.0.0', '<999.999.999')).toBe(true)
    })
  })

  describe('npm registry real-world ranges', () => {
    it('lodash typical range "^4.17.0"', () => {
      expect(satisfies('4.17.21', '^4.17.0')).toBe(true)
      expect(satisfies('4.17.0', '^4.17.0')).toBe(true)
      expect(satisfies('4.16.6', '^4.17.0')).toBe(false)
      expect(satisfies('5.0.0', '^4.17.0')).toBe(false)
    })

    it('typescript typical range "~5.0.0"', () => {
      expect(satisfies('5.0.0', '~5.0.0')).toBe(true)
      expect(satisfies('5.0.4', '~5.0.0')).toBe(true)
      expect(satisfies('5.1.0', '~5.0.0')).toBe(false)
    })

    it('node engine range ">=18.0.0"', () => {
      expect(satisfies('18.0.0', '>=18.0.0')).toBe(true)
      expect(satisfies('20.0.0', '>=18.0.0')).toBe(true)
      expect(satisfies('16.0.0', '>=18.0.0')).toBe(false)
    })

    it('peer dependency range "^17.0.0 || ^18.0.0"', () => {
      expect(satisfies('17.0.2', '^17.0.0 || ^18.0.0')).toBe(true)
      expect(satisfies('18.2.0', '^17.0.0 || ^18.0.0')).toBe(true)
      expect(satisfies('16.14.0', '^17.0.0 || ^18.0.0')).toBe(false)
      expect(satisfies('19.0.0', '^17.0.0 || ^18.0.0')).toBe(false)
    })
  })
})
