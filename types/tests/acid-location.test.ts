import { describe, it, expect, expectTypeOf } from 'vitest'

/**
 * ACID Location Types Tests
 *
 * Tests for the ACID location type system including:
 * - RegionHint type
 * - ColoCode type
 * - REGION_COLOS mapping
 * - LocationConfig interface
 * - Utility functions
 *
 * @task dotdo-7xi3 - ACID Types: Location
 */

import type {
  RegionHint,
  ColoCode,
  LocationConfig,
  ColoToRegion,
  ColosInRegion,
} from '../acid/location'

import {
  REGION_COLOS,
  ALL_REGIONS,
  ALL_COLOS,
  REGIONS_WITH_COLOS,
  getRegionForColo,
  getColosForRegion,
  isColoInRegion,
  getRandomColoInRegion,
  validateLocationConfig,
} from '../acid/location'

// ============================================================================
// RegionHint Type Tests
// ============================================================================

describe('RegionHint Type', () => {
  it('should include wnam (Western North America)', () => {
    const region: RegionHint = 'wnam'
    expect(region).toBe('wnam')
  })

  it('should include enam (Eastern North America)', () => {
    const region: RegionHint = 'enam'
    expect(region).toBe('enam')
  })

  it('should include sam (South America)', () => {
    const region: RegionHint = 'sam'
    expect(region).toBe('sam')
  })

  it('should include weur (Western Europe)', () => {
    const region: RegionHint = 'weur'
    expect(region).toBe('weur')
  })

  it('should include eeur (Eastern Europe)', () => {
    const region: RegionHint = 'eeur'
    expect(region).toBe('eeur')
  })

  it('should include apac (Asia Pacific)', () => {
    const region: RegionHint = 'apac'
    expect(region).toBe('apac')
  })

  it('should include oc (Oceania)', () => {
    const region: RegionHint = 'oc'
    expect(region).toBe('oc')
  })

  it('should include afr (Africa)', () => {
    const region: RegionHint = 'afr'
    expect(region).toBe('afr')
  })

  it('should include me (Middle East)', () => {
    const region: RegionHint = 'me'
    expect(region).toBe('me')
  })

  it('should not accept invalid region', () => {
    // @ts-expect-error - 'invalid' is not a valid RegionHint
    const invalid: RegionHint = 'invalid'
    expect(invalid).toBeDefined()
  })
})

// ============================================================================
// ColoCode Type Tests
// ============================================================================

describe('ColoCode Type', () => {
  describe('North America - East', () => {
    it.each([
      ['ewr', 'Newark'],
      ['ord', 'Chicago'],
      ['dfw', 'Dallas'],
      ['iad', 'Ashburn'],
      ['atl', 'Atlanta'],
      ['mia', 'Miami'],
    ])('should include %s (%s)', (code) => {
      const colo: ColoCode = code as ColoCode
      expect(colo).toBe(code)
    })
  })

  describe('North America - West', () => {
    it.each([
      ['lax', 'Los Angeles'],
      ['sjc', 'San Jose'],
      ['sea', 'Seattle'],
      ['den', 'Denver'],
    ])('should include %s (%s)', (code) => {
      const colo: ColoCode = code as ColoCode
      expect(colo).toBe(code)
    })
  })

  describe('South America', () => {
    it('should include gru (Sao Paulo)', () => {
      const colo: ColoCode = 'gru'
      expect(colo).toBe('gru')
    })
  })

  describe('Europe - West', () => {
    it.each([
      ['cdg', 'Paris'],
      ['ams', 'Amsterdam'],
      ['fra', 'Frankfurt'],
      ['lhr', 'London'],
      ['mad', 'Madrid'],
      ['mxp', 'Milan'],
      ['zrh', 'Zurich'],
    ])('should include %s (%s)', (code) => {
      const colo: ColoCode = code as ColoCode
      expect(colo).toBe(code)
    })
  })

  describe('Europe - East', () => {
    it.each([
      ['vie', 'Vienna'],
      ['arn', 'Stockholm'],
    ])('should include %s (%s)', (code) => {
      const colo: ColoCode = code as ColoCode
      expect(colo).toBe(code)
    })
  })

  describe('Asia Pacific', () => {
    it.each([
      ['sin', 'Singapore'],
      ['nrt', 'Tokyo Narita'],
      ['hkg', 'Hong Kong'],
      ['bom', 'Mumbai'],
      ['del', 'Delhi'],
      ['hnd', 'Tokyo Haneda'],
      ['icn', 'Seoul'],
      ['kix', 'Osaka'],
    ])('should include %s (%s)', (code) => {
      const colo: ColoCode = code as ColoCode
      expect(colo).toBe(code)
    })
  })

  describe('Oceania', () => {
    it.each([
      ['syd', 'Sydney'],
      ['mel', 'Melbourne'],
      ['akl', 'Auckland'],
    ])('should include %s (%s)', (code) => {
      const colo: ColoCode = code as ColoCode
      expect(colo).toBe(code)
    })
  })

  describe('Africa', () => {
    it('should include jnb (Johannesburg)', () => {
      const colo: ColoCode = 'jnb'
      expect(colo).toBe('jnb')
    })
  })

  it('should not accept invalid colo code', () => {
    // @ts-expect-error - 'xyz' is not a valid ColoCode
    const invalid: ColoCode = 'xyz'
    expect(invalid).toBeDefined()
  })
})

// ============================================================================
// REGION_COLOS Mapping Tests
// ============================================================================

describe('REGION_COLOS Mapping', () => {
  it('should map wnam to western US colos', () => {
    expect(REGION_COLOS.wnam).toEqual(['lax', 'sjc', 'sea', 'den'])
  })

  it('should map enam to eastern US colos', () => {
    expect(REGION_COLOS.enam).toEqual(['ewr', 'ord', 'dfw', 'iad', 'atl', 'mia'])
  })

  it('should map sam to South America colos', () => {
    expect(REGION_COLOS.sam).toEqual(['gru'])
  })

  it('should map weur to Western Europe colos', () => {
    expect(REGION_COLOS.weur).toEqual(['cdg', 'ams', 'fra', 'lhr', 'mad', 'mxp', 'zrh'])
  })

  it('should map eeur to Eastern Europe colos', () => {
    expect(REGION_COLOS.eeur).toEqual(['vie', 'arn'])
  })

  it('should map apac to Asia Pacific colos', () => {
    expect(REGION_COLOS.apac).toEqual(['sin', 'nrt', 'hkg', 'bom', 'del', 'hnd', 'icn', 'kix'])
  })

  it('should map oc to Oceania colos', () => {
    expect(REGION_COLOS.oc).toEqual(['syd', 'mel', 'akl'])
  })

  it('should map afr to Africa colos', () => {
    expect(REGION_COLOS.afr).toEqual(['jnb'])
  })

  it('should map me to empty array (no colos)', () => {
    expect(REGION_COLOS.me).toEqual([])
  })

  it('should have all regions defined', () => {
    const regions: RegionHint[] = ['wnam', 'enam', 'sam', 'weur', 'eeur', 'apac', 'oc', 'afr', 'me']
    for (const region of regions) {
      expect(REGION_COLOS[region]).toBeDefined()
      expect(Array.isArray(REGION_COLOS[region])).toBe(true)
    }
  })

  it('should contain only valid ColoCode values', () => {
    for (const colos of Object.values(REGION_COLOS)) {
      for (const colo of colos) {
        expect(ALL_COLOS).toContain(colo)
      }
    }
  })
})

// ============================================================================
// LocationConfig Interface Tests
// ============================================================================

describe('LocationConfig Interface', () => {
  it('should allow region only', () => {
    const config: LocationConfig = {
      region: 'wnam',
    }
    expect(config.region).toBe('wnam')
    expect(config.colo).toBeUndefined()
    expect(config.latencyMs).toBeUndefined()
  })

  it('should allow colo only', () => {
    const config: LocationConfig = {
      colo: 'lax',
    }
    expect(config.region).toBeUndefined()
    expect(config.colo).toBe('lax')
  })

  it('should allow both region and colo', () => {
    const config: LocationConfig = {
      region: 'wnam',
      colo: 'lax',
    }
    expect(config.region).toBe('wnam')
    expect(config.colo).toBe('lax')
  })

  it('should allow latencyMs', () => {
    const config: LocationConfig = {
      region: 'wnam',
      latencyMs: 50,
    }
    expect(config.latencyMs).toBe(50)
  })

  it('should allow empty config', () => {
    const config: LocationConfig = {}
    expect(config.region).toBeUndefined()
    expect(config.colo).toBeUndefined()
    expect(config.latencyMs).toBeUndefined()
  })

  it('should have correct type for region property', () => {
    const config: LocationConfig = { region: 'apac' }
    expectTypeOf(config.region).toEqualTypeOf<RegionHint | undefined>()
  })

  it('should have correct type for colo property', () => {
    const config: LocationConfig = { colo: 'sin' }
    expectTypeOf(config.colo).toEqualTypeOf<ColoCode | undefined>()
  })

  it('should have correct type for latencyMs property', () => {
    const config: LocationConfig = { latencyMs: 100 }
    expectTypeOf(config.latencyMs).toEqualTypeOf<number | undefined>()
  })
})

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('getRegionForColo', () => {
  it('should return wnam for lax', () => {
    expect(getRegionForColo('lax')).toBe('wnam')
  })

  it('should return enam for ewr', () => {
    expect(getRegionForColo('ewr')).toBe('enam')
  })

  it('should return weur for cdg', () => {
    expect(getRegionForColo('cdg')).toBe('weur')
  })

  it('should return apac for sin', () => {
    expect(getRegionForColo('sin')).toBe('apac')
  })

  it('should return oc for syd', () => {
    expect(getRegionForColo('syd')).toBe('oc')
  })

  it('should return afr for jnb', () => {
    expect(getRegionForColo('jnb')).toBe('afr')
  })

  it('should return correct region for all colos', () => {
    for (const [region, colos] of Object.entries(REGION_COLOS)) {
      for (const colo of colos) {
        expect(getRegionForColo(colo as ColoCode)).toBe(region)
      }
    }
  })
})

describe('getColosForRegion', () => {
  it('should return wnam colos', () => {
    expect(getColosForRegion('wnam')).toEqual(['lax', 'sjc', 'sea', 'den'])
  })

  it('should return empty array for me', () => {
    expect(getColosForRegion('me')).toEqual([])
  })

  it('should return all apac colos', () => {
    const apacColos = getColosForRegion('apac')
    expect(apacColos).toContain('sin')
    expect(apacColos).toContain('nrt')
    expect(apacColos).toContain('hkg')
    expect(apacColos.length).toBe(8)
  })
})

describe('isColoInRegion', () => {
  it('should return true for lax in wnam', () => {
    expect(isColoInRegion('lax', 'wnam')).toBe(true)
  })

  it('should return false for lax in enam', () => {
    expect(isColoInRegion('lax', 'enam')).toBe(false)
  })

  it('should return true for cdg in weur', () => {
    expect(isColoInRegion('cdg', 'weur')).toBe(true)
  })

  it('should return false for any colo in me', () => {
    expect(isColoInRegion('lax', 'me')).toBe(false)
    expect(isColoInRegion('sin', 'me')).toBe(false)
  })
})

describe('getRandomColoInRegion', () => {
  it('should return a colo from wnam', () => {
    const colo = getRandomColoInRegion('wnam')
    expect(colo).toBeDefined()
    expect(REGION_COLOS.wnam).toContain(colo)
  })

  it('should return undefined for me (empty region)', () => {
    expect(getRandomColoInRegion('me')).toBeUndefined()
  })

  it('should return gru for sam (single colo)', () => {
    expect(getRandomColoInRegion('sam')).toBe('gru')
  })

  it('should always return a valid colo for non-empty regions', () => {
    for (const region of REGIONS_WITH_COLOS) {
      const colo = getRandomColoInRegion(region)
      expect(colo).toBeDefined()
      expect(REGION_COLOS[region]).toContain(colo)
    }
  })
})

describe('validateLocationConfig', () => {
  it('should return true for valid config with matching region and colo', () => {
    expect(validateLocationConfig({ region: 'wnam', colo: 'lax' })).toBe(true)
  })

  it('should return true for config with only region', () => {
    expect(validateLocationConfig({ region: 'wnam' })).toBe(true)
  })

  it('should return true for config with only colo', () => {
    expect(validateLocationConfig({ colo: 'lax' })).toBe(true)
  })

  it('should return true for empty config', () => {
    expect(validateLocationConfig({})).toBe(true)
  })

  it('should throw for mismatched region and colo', () => {
    expect(() => validateLocationConfig({ region: 'wnam', colo: 'cdg' }))
      .toThrow("Colo 'cdg' is not in region 'wnam'")
  })

  it('should throw for negative latencyMs', () => {
    expect(() => validateLocationConfig({ latencyMs: -10 }))
      .toThrow('latencyMs must be non-negative')
  })

  it('should return true for zero latencyMs', () => {
    expect(validateLocationConfig({ latencyMs: 0 })).toBe(true)
  })

  it('should return true for positive latencyMs', () => {
    expect(validateLocationConfig({ latencyMs: 100 })).toBe(true)
  })
})

// ============================================================================
// Constants Tests
// ============================================================================

describe('ALL_REGIONS', () => {
  it('should contain all 9 regions', () => {
    expect(ALL_REGIONS).toHaveLength(9)
  })

  it('should contain all expected regions', () => {
    expect(ALL_REGIONS).toContain('wnam')
    expect(ALL_REGIONS).toContain('enam')
    expect(ALL_REGIONS).toContain('sam')
    expect(ALL_REGIONS).toContain('weur')
    expect(ALL_REGIONS).toContain('eeur')
    expect(ALL_REGIONS).toContain('apac')
    expect(ALL_REGIONS).toContain('oc')
    expect(ALL_REGIONS).toContain('afr')
    expect(ALL_REGIONS).toContain('me')
  })

  it('should be readonly', () => {
    expectTypeOf(ALL_REGIONS).toEqualTypeOf<readonly RegionHint[]>()
  })
})

describe('ALL_COLOS', () => {
  it('should contain 32 colos', () => {
    expect(ALL_COLOS).toHaveLength(32)
  })

  it('should contain key colos', () => {
    expect(ALL_COLOS).toContain('lax')
    expect(ALL_COLOS).toContain('ewr')
    expect(ALL_COLOS).toContain('cdg')
    expect(ALL_COLOS).toContain('sin')
    expect(ALL_COLOS).toContain('syd')
    expect(ALL_COLOS).toContain('jnb')
  })

  it('should be readonly', () => {
    expectTypeOf(ALL_COLOS).toEqualTypeOf<readonly ColoCode[]>()
  })
})

describe('REGIONS_WITH_COLOS', () => {
  it('should not contain me (empty region)', () => {
    expect(REGIONS_WITH_COLOS).not.toContain('me')
  })

  it('should contain all other regions', () => {
    expect(REGIONS_WITH_COLOS).toContain('wnam')
    expect(REGIONS_WITH_COLOS).toContain('enam')
    expect(REGIONS_WITH_COLOS).toContain('sam')
    expect(REGIONS_WITH_COLOS).toContain('weur')
    expect(REGIONS_WITH_COLOS).toContain('eeur')
    expect(REGIONS_WITH_COLOS).toContain('apac')
    expect(REGIONS_WITH_COLOS).toContain('oc')
    expect(REGIONS_WITH_COLOS).toContain('afr')
  })

  it('should have 8 regions (all except me)', () => {
    expect(REGIONS_WITH_COLOS).toHaveLength(8)
  })
})

// ============================================================================
// Utility Type Tests
// ============================================================================

describe('ColoToRegion Utility Type', () => {
  it('should infer wnam for lax', () => {
    type LaxRegion = ColoToRegion<'lax'>
    expectTypeOf<LaxRegion>().toEqualTypeOf<'wnam'>()
  })

  it('should infer weur for cdg', () => {
    type CdgRegion = ColoToRegion<'cdg'>
    expectTypeOf<CdgRegion>().toEqualTypeOf<'weur'>()
  })
})

describe('ColosInRegion Utility Type', () => {
  it('should return wnam colos', () => {
    type WnamColos = ColosInRegion<'wnam'>
    expectTypeOf<WnamColos>().toEqualTypeOf<'lax' | 'sjc' | 'sea' | 'den'>()
  })

  it('should return sam colo', () => {
    type SamColos = ColosInRegion<'sam'>
    expectTypeOf<SamColos>().toEqualTypeOf<'gru'>()
  })

  it('should return never for me (empty)', () => {
    type MeColos = ColosInRegion<'me'>
    expectTypeOf<MeColos>().toEqualTypeOf<never>()
  })
})
