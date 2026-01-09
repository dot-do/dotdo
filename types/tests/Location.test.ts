import { describe, it, expect, expectTypeOf } from 'vitest'

/**
 * Location Types Tests (RED Phase)
 *
 * These tests verify the Location type system for Cloudflare edge location management:
 * - Region type (geographic regions)
 * - ColoCode type (IATA codes for Cloudflare colos)
 * - ColoCity type (friendly city names)
 * - Colo union type (code | city)
 * - Mapping objects (cityToCode, codeToCity, coloRegion, regionToCF)
 * - normalizeLocation() function
 *
 * Implementation requirements:
 * - Create types/Location.ts with all types and mappings
 * - Export from types/index.ts
 *
 * Reference: dotdo-3pxi - Location types tests
 */

// ============================================================================
// Import the types under test (will fail until implemented)
// ============================================================================

import type {
  Region,
  ColoCode,
  ColoCity,
  Colo,
  NormalizedLocation,
  CFLocationHint,
} from '../Location'

import {
  cityToCode,
  codeToCity,
  coloRegion,
  regionToCF,
  normalizeLocation,
} from '../Location'

// ============================================================================
// Region Type Tests
// ============================================================================

describe('Region Type', () => {
  it('should include us-west region', () => {
    const region: Region = 'us-west'
    expect(region).toBe('us-west')
  })

  it('should include us-east region', () => {
    const region: Region = 'us-east'
    expect(region).toBe('us-east')
  })

  it('should include eu-west region', () => {
    const region: Region = 'eu-west'
    expect(region).toBe('eu-west')
  })

  it('should include eu-east region', () => {
    const region: Region = 'eu-east'
    expect(region).toBe('eu-east')
  })

  it('should include south-america region', () => {
    const region: Region = 'south-america'
    expect(region).toBe('south-america')
  })

  it('should include asia-pacific region', () => {
    const region: Region = 'asia-pacific'
    expect(region).toBe('asia-pacific')
  })

  it('should include oceania region', () => {
    const region: Region = 'oceania'
    expect(region).toBe('oceania')
  })

  it('should include africa region', () => {
    const region: Region = 'africa'
    expect(region).toBe('africa')
  })

  it('should include middle-east region', () => {
    const region: Region = 'middle-east'
    expect(region).toBe('middle-east')
  })

  it('should not accept invalid region', () => {
    // @ts-expect-error - 'invalid-region' is not a valid Region
    const invalid: Region = 'invalid-region'
    expect(invalid).toBeDefined()
  })
})

// ============================================================================
// ColoCode Type Tests (IATA Codes)
// ============================================================================

describe('ColoCode Type', () => {
  describe('North America codes', () => {
    it('should include iad (Washington DC)', () => {
      const code: ColoCode = 'iad'
      expect(code).toBe('iad')
    })

    it('should include ewr (Newark)', () => {
      const code: ColoCode = 'ewr'
      expect(code).toBe('ewr')
    })

    it('should include lax (Los Angeles)', () => {
      const code: ColoCode = 'lax'
      expect(code).toBe('lax')
    })

    it('should include sjc (San Jose)', () => {
      const code: ColoCode = 'sjc'
      expect(code).toBe('sjc')
    })

    it('should include ord (Chicago)', () => {
      const code: ColoCode = 'ord'
      expect(code).toBe('ord')
    })

    it('should include dfw (Dallas)', () => {
      const code: ColoCode = 'dfw'
      expect(code).toBe('dfw')
    })

    it('should include den (Denver)', () => {
      const code: ColoCode = 'den'
      expect(code).toBe('den')
    })

    it('should include sea (Seattle)', () => {
      const code: ColoCode = 'sea'
      expect(code).toBe('sea')
    })

    it('should include atl (Atlanta)', () => {
      const code: ColoCode = 'atl'
      expect(code).toBe('atl')
    })

    it('should include mia (Miami)', () => {
      const code: ColoCode = 'mia'
      expect(code).toBe('mia')
    })
  })

  describe('Europe codes', () => {
    it('should include lhr (London)', () => {
      const code: ColoCode = 'lhr'
      expect(code).toBe('lhr')
    })

    it('should include cdg (Paris)', () => {
      const code: ColoCode = 'cdg'
      expect(code).toBe('cdg')
    })

    it('should include ams (Amsterdam)', () => {
      const code: ColoCode = 'ams'
      expect(code).toBe('ams')
    })

    it('should include fra (Frankfurt)', () => {
      const code: ColoCode = 'fra'
      expect(code).toBe('fra')
    })

    it('should include mrs (Marseille)', () => {
      const code: ColoCode = 'mrs'
      expect(code).toBe('mrs')
    })

    it('should include mxp (Milan)', () => {
      const code: ColoCode = 'mxp'
      expect(code).toBe('mxp')
    })

    it('should include prg (Prague)', () => {
      const code: ColoCode = 'prg'
      expect(code).toBe('prg')
    })

    it('should include arn (Stockholm)', () => {
      const code: ColoCode = 'arn'
      expect(code).toBe('arn')
    })

    it('should include vie (Vienna)', () => {
      const code: ColoCode = 'vie'
      expect(code).toBe('vie')
    })
  })

  describe('Asia-Pacific codes', () => {
    it('should include sin (Singapore)', () => {
      const code: ColoCode = 'sin'
      expect(code).toBe('sin')
    })

    it('should include hkg (Hong Kong)', () => {
      const code: ColoCode = 'hkg'
      expect(code).toBe('hkg')
    })

    it('should include nrt (Tokyo)', () => {
      const code: ColoCode = 'nrt'
      expect(code).toBe('nrt')
    })

    it('should include kix (Osaka)', () => {
      const code: ColoCode = 'kix'
      expect(code).toBe('kix')
    })
  })

  it('should not accept invalid colo code', () => {
    // @ts-expect-error - 'xyz' is not a valid ColoCode
    const invalid: ColoCode = 'xyz'
    expect(invalid).toBeDefined()
  })
})

// ============================================================================
// ColoCity Type Tests
// ============================================================================

describe('ColoCity Type', () => {
  describe('North America cities', () => {
    it('should include Virginia', () => {
      const city: ColoCity = 'Virginia'
      expect(city).toBe('Virginia')
    })

    it('should include Newark', () => {
      const city: ColoCity = 'Newark'
      expect(city).toBe('Newark')
    })

    it('should include LosAngeles', () => {
      const city: ColoCity = 'LosAngeles'
      expect(city).toBe('LosAngeles')
    })

    it('should include SanJose', () => {
      const city: ColoCity = 'SanJose'
      expect(city).toBe('SanJose')
    })

    it('should include Chicago', () => {
      const city: ColoCity = 'Chicago'
      expect(city).toBe('Chicago')
    })

    it('should include Dallas', () => {
      const city: ColoCity = 'Dallas'
      expect(city).toBe('Dallas')
    })

    it('should include Denver', () => {
      const city: ColoCity = 'Denver'
      expect(city).toBe('Denver')
    })

    it('should include Seattle', () => {
      const city: ColoCity = 'Seattle'
      expect(city).toBe('Seattle')
    })

    it('should include Atlanta', () => {
      const city: ColoCity = 'Atlanta'
      expect(city).toBe('Atlanta')
    })

    it('should include Miami', () => {
      const city: ColoCity = 'Miami'
      expect(city).toBe('Miami')
    })
  })

  describe('Europe cities', () => {
    it('should include London', () => {
      const city: ColoCity = 'London'
      expect(city).toBe('London')
    })

    it('should include Paris', () => {
      const city: ColoCity = 'Paris'
      expect(city).toBe('Paris')
    })

    it('should include Amsterdam', () => {
      const city: ColoCity = 'Amsterdam'
      expect(city).toBe('Amsterdam')
    })

    it('should include Frankfurt', () => {
      const city: ColoCity = 'Frankfurt'
      expect(city).toBe('Frankfurt')
    })

    it('should include Marseille', () => {
      const city: ColoCity = 'Marseille'
      expect(city).toBe('Marseille')
    })

    it('should include Milan', () => {
      const city: ColoCity = 'Milan'
      expect(city).toBe('Milan')
    })

    it('should include Prague', () => {
      const city: ColoCity = 'Prague'
      expect(city).toBe('Prague')
    })

    it('should include Stockholm', () => {
      const city: ColoCity = 'Stockholm'
      expect(city).toBe('Stockholm')
    })

    it('should include Vienna', () => {
      const city: ColoCity = 'Vienna'
      expect(city).toBe('Vienna')
    })
  })

  describe('Asia-Pacific cities', () => {
    it('should include Singapore', () => {
      const city: ColoCity = 'Singapore'
      expect(city).toBe('Singapore')
    })

    it('should include HongKong', () => {
      const city: ColoCity = 'HongKong'
      expect(city).toBe('HongKong')
    })

    it('should include Tokyo', () => {
      const city: ColoCity = 'Tokyo'
      expect(city).toBe('Tokyo')
    })

    it('should include Osaka', () => {
      const city: ColoCity = 'Osaka'
      expect(city).toBe('Osaka')
    })
  })

  it('should not accept invalid city', () => {
    // @ts-expect-error - 'InvalidCity' is not a valid ColoCity
    const invalid: ColoCity = 'InvalidCity'
    expect(invalid).toBeDefined()
  })
})

// ============================================================================
// Colo Union Type Tests
// ============================================================================

describe('Colo Union Type', () => {
  it('should accept ColoCode', () => {
    const colo: Colo = 'lax'
    expect(colo).toBe('lax')
  })

  it('should accept ColoCity', () => {
    const colo: Colo = 'LosAngeles'
    expect(colo).toBe('LosAngeles')
  })

  it('should not accept invalid values', () => {
    // @ts-expect-error - 'invalid' is not a valid Colo
    const invalid: Colo = 'invalid'
    expect(invalid).toBeDefined()
  })
})

// ============================================================================
// CFLocationHint Type Tests
// ============================================================================

describe('CFLocationHint Type', () => {
  it('should include wnam (Western North America)', () => {
    const hint: CFLocationHint = 'wnam'
    expect(hint).toBe('wnam')
  })

  it('should include enam (Eastern North America)', () => {
    const hint: CFLocationHint = 'enam'
    expect(hint).toBe('enam')
  })

  it('should include sam (South America)', () => {
    const hint: CFLocationHint = 'sam'
    expect(hint).toBe('sam')
  })

  it('should include weur (Western Europe)', () => {
    const hint: CFLocationHint = 'weur'
    expect(hint).toBe('weur')
  })

  it('should include eeur (Eastern Europe)', () => {
    const hint: CFLocationHint = 'eeur'
    expect(hint).toBe('eeur')
  })

  it('should include apac (Asia-Pacific)', () => {
    const hint: CFLocationHint = 'apac'
    expect(hint).toBe('apac')
  })

  it('should include oc (Oceania)', () => {
    const hint: CFLocationHint = 'oc'
    expect(hint).toBe('oc')
  })

  it('should include afr (Africa)', () => {
    const hint: CFLocationHint = 'afr'
    expect(hint).toBe('afr')
  })

  it('should include me (Middle East)', () => {
    const hint: CFLocationHint = 'me'
    expect(hint).toBe('me')
  })
})

// ============================================================================
// cityToCode Mapping Tests
// ============================================================================

describe('cityToCode Mapping', () => {
  describe('North America mappings', () => {
    it('should map Virginia to iad', () => {
      expect(cityToCode.Virginia).toBe('iad')
    })

    it('should map Newark to ewr', () => {
      expect(cityToCode.Newark).toBe('ewr')
    })

    it('should map LosAngeles to lax', () => {
      expect(cityToCode.LosAngeles).toBe('lax')
    })

    it('should map SanJose to sjc', () => {
      expect(cityToCode.SanJose).toBe('sjc')
    })

    it('should map Chicago to ord', () => {
      expect(cityToCode.Chicago).toBe('ord')
    })

    it('should map Dallas to dfw', () => {
      expect(cityToCode.Dallas).toBe('dfw')
    })

    it('should map Denver to den', () => {
      expect(cityToCode.Denver).toBe('den')
    })

    it('should map Seattle to sea', () => {
      expect(cityToCode.Seattle).toBe('sea')
    })

    it('should map Atlanta to atl', () => {
      expect(cityToCode.Atlanta).toBe('atl')
    })

    it('should map Miami to mia', () => {
      expect(cityToCode.Miami).toBe('mia')
    })
  })

  describe('Europe mappings', () => {
    it('should map London to lhr', () => {
      expect(cityToCode.London).toBe('lhr')
    })

    it('should map Paris to cdg', () => {
      expect(cityToCode.Paris).toBe('cdg')
    })

    it('should map Amsterdam to ams', () => {
      expect(cityToCode.Amsterdam).toBe('ams')
    })

    it('should map Frankfurt to fra', () => {
      expect(cityToCode.Frankfurt).toBe('fra')
    })

    it('should map Marseille to mrs', () => {
      expect(cityToCode.Marseille).toBe('mrs')
    })

    it('should map Milan to mxp', () => {
      expect(cityToCode.Milan).toBe('mxp')
    })

    it('should map Prague to prg', () => {
      expect(cityToCode.Prague).toBe('prg')
    })

    it('should map Stockholm to arn', () => {
      expect(cityToCode.Stockholm).toBe('arn')
    })

    it('should map Vienna to vie', () => {
      expect(cityToCode.Vienna).toBe('vie')
    })
  })

  describe('Asia-Pacific mappings', () => {
    it('should map Singapore to sin', () => {
      expect(cityToCode.Singapore).toBe('sin')
    })

    it('should map HongKong to hkg', () => {
      expect(cityToCode.HongKong).toBe('hkg')
    })

    it('should map Tokyo to nrt', () => {
      expect(cityToCode.Tokyo).toBe('nrt')
    })

    it('should map Osaka to kix', () => {
      expect(cityToCode.Osaka).toBe('kix')
    })
  })

  it('should be a complete mapping of all cities', () => {
    const cities: ColoCity[] = [
      'Virginia', 'Newark', 'LosAngeles', 'SanJose', 'Chicago',
      'Dallas', 'Denver', 'Seattle', 'Atlanta', 'Miami',
      'London', 'Paris', 'Amsterdam', 'Frankfurt', 'Marseille',
      'Milan', 'Prague', 'Stockholm', 'Vienna',
      'Singapore', 'HongKong', 'Tokyo', 'Osaka',
    ]

    for (const city of cities) {
      expect(cityToCode[city]).toBeDefined()
    }
  })
})

// ============================================================================
// codeToCity Mapping Tests
// ============================================================================

describe('codeToCity Mapping', () => {
  describe('North America mappings', () => {
    it('should map iad to Virginia', () => {
      expect(codeToCity.iad).toBe('Virginia')
    })

    it('should map ewr to Newark', () => {
      expect(codeToCity.ewr).toBe('Newark')
    })

    it('should map lax to LosAngeles', () => {
      expect(codeToCity.lax).toBe('LosAngeles')
    })

    it('should map sjc to SanJose', () => {
      expect(codeToCity.sjc).toBe('SanJose')
    })

    it('should map ord to Chicago', () => {
      expect(codeToCity.ord).toBe('Chicago')
    })

    it('should map dfw to Dallas', () => {
      expect(codeToCity.dfw).toBe('Dallas')
    })

    it('should map den to Denver', () => {
      expect(codeToCity.den).toBe('Denver')
    })

    it('should map sea to Seattle', () => {
      expect(codeToCity.sea).toBe('Seattle')
    })

    it('should map atl to Atlanta', () => {
      expect(codeToCity.atl).toBe('Atlanta')
    })

    it('should map mia to Miami', () => {
      expect(codeToCity.mia).toBe('Miami')
    })
  })

  describe('Europe mappings', () => {
    it('should map lhr to London', () => {
      expect(codeToCity.lhr).toBe('London')
    })

    it('should map cdg to Paris', () => {
      expect(codeToCity.cdg).toBe('Paris')
    })

    it('should map ams to Amsterdam', () => {
      expect(codeToCity.ams).toBe('Amsterdam')
    })

    it('should map fra to Frankfurt', () => {
      expect(codeToCity.fra).toBe('Frankfurt')
    })

    it('should map mrs to Marseille', () => {
      expect(codeToCity.mrs).toBe('Marseille')
    })

    it('should map mxp to Milan', () => {
      expect(codeToCity.mxp).toBe('Milan')
    })

    it('should map prg to Prague', () => {
      expect(codeToCity.prg).toBe('Prague')
    })

    it('should map arn to Stockholm', () => {
      expect(codeToCity.arn).toBe('Stockholm')
    })

    it('should map vie to Vienna', () => {
      expect(codeToCity.vie).toBe('Vienna')
    })
  })

  describe('Asia-Pacific mappings', () => {
    it('should map sin to Singapore', () => {
      expect(codeToCity.sin).toBe('Singapore')
    })

    it('should map hkg to HongKong', () => {
      expect(codeToCity.hkg).toBe('HongKong')
    })

    it('should map nrt to Tokyo', () => {
      expect(codeToCity.nrt).toBe('Tokyo')
    })

    it('should map kix to Osaka', () => {
      expect(codeToCity.kix).toBe('Osaka')
    })
  })

  it('should be a complete mapping of all codes', () => {
    const codes: ColoCode[] = [
      'iad', 'ewr', 'lax', 'sjc', 'ord', 'dfw', 'den', 'sea', 'atl', 'mia',
      'lhr', 'cdg', 'ams', 'fra', 'mrs', 'mxp', 'prg', 'arn', 'vie',
      'sin', 'hkg', 'nrt', 'kix',
    ]

    for (const code of codes) {
      expect(codeToCity[code]).toBeDefined()
    }
  })

  it('should be inverse of cityToCode', () => {
    const cities: ColoCity[] = [
      'Virginia', 'Newark', 'LosAngeles', 'SanJose', 'Chicago',
      'Dallas', 'Denver', 'Seattle', 'Atlanta', 'Miami',
      'London', 'Paris', 'Amsterdam', 'Frankfurt', 'Marseille',
      'Milan', 'Prague', 'Stockholm', 'Vienna',
      'Singapore', 'HongKong', 'Tokyo', 'Osaka',
    ]

    for (const city of cities) {
      const code = cityToCode[city]
      expect(codeToCity[code]).toBe(city)
    }
  })
})

// ============================================================================
// coloRegion Mapping Tests
// ============================================================================

describe('coloRegion Mapping', () => {
  describe('US West colos', () => {
    it('should map lax to us-west', () => {
      expect(coloRegion.lax).toBe('us-west')
    })

    it('should map sjc to us-west', () => {
      expect(coloRegion.sjc).toBe('us-west')
    })

    it('should map sea to us-west', () => {
      expect(coloRegion.sea).toBe('us-west')
    })

    it('should map den to us-west', () => {
      expect(coloRegion.den).toBe('us-west')
    })
  })

  describe('US East colos', () => {
    it('should map iad to us-east', () => {
      expect(coloRegion.iad).toBe('us-east')
    })

    it('should map ewr to us-east', () => {
      expect(coloRegion.ewr).toBe('us-east')
    })

    it('should map ord to us-east', () => {
      expect(coloRegion.ord).toBe('us-east')
    })

    it('should map dfw to us-east', () => {
      expect(coloRegion.dfw).toBe('us-east')
    })

    it('should map atl to us-east', () => {
      expect(coloRegion.atl).toBe('us-east')
    })

    it('should map mia to us-east', () => {
      expect(coloRegion.mia).toBe('us-east')
    })
  })

  describe('EU West colos', () => {
    it('should map lhr to eu-west', () => {
      expect(coloRegion.lhr).toBe('eu-west')
    })

    it('should map cdg to eu-west', () => {
      expect(coloRegion.cdg).toBe('eu-west')
    })

    it('should map ams to eu-west', () => {
      expect(coloRegion.ams).toBe('eu-west')
    })

    it('should map fra to eu-west', () => {
      expect(coloRegion.fra).toBe('eu-west')
    })

    it('should map mrs to eu-west', () => {
      expect(coloRegion.mrs).toBe('eu-west')
    })

    it('should map mxp to eu-west', () => {
      expect(coloRegion.mxp).toBe('eu-west')
    })
  })

  describe('EU East colos', () => {
    it('should map prg to eu-east', () => {
      expect(coloRegion.prg).toBe('eu-east')
    })

    it('should map arn to eu-east', () => {
      expect(coloRegion.arn).toBe('eu-east')
    })

    it('should map vie to eu-east', () => {
      expect(coloRegion.vie).toBe('eu-east')
    })
  })

  describe('Asia-Pacific colos', () => {
    it('should map sin to asia-pacific', () => {
      expect(coloRegion.sin).toBe('asia-pacific')
    })

    it('should map hkg to asia-pacific', () => {
      expect(coloRegion.hkg).toBe('asia-pacific')
    })

    it('should map nrt to asia-pacific', () => {
      expect(coloRegion.nrt).toBe('asia-pacific')
    })

    it('should map kix to asia-pacific', () => {
      expect(coloRegion.kix).toBe('asia-pacific')
    })
  })

  it('should map all codes to a region', () => {
    const codes: ColoCode[] = [
      'iad', 'ewr', 'lax', 'sjc', 'ord', 'dfw', 'den', 'sea', 'atl', 'mia',
      'lhr', 'cdg', 'ams', 'fra', 'mrs', 'mxp', 'prg', 'arn', 'vie',
      'sin', 'hkg', 'nrt', 'kix',
    ]

    for (const code of codes) {
      expect(coloRegion[code]).toBeDefined()
    }
  })
})

// ============================================================================
// regionToCF Mapping Tests
// ============================================================================

describe('regionToCF Mapping', () => {
  it('should map us-west to wnam', () => {
    expect(regionToCF['us-west']).toBe('wnam')
  })

  it('should map us-east to enam', () => {
    expect(regionToCF['us-east']).toBe('enam')
  })

  it('should map south-america to sam', () => {
    expect(regionToCF['south-america']).toBe('sam')
  })

  it('should map eu-west to weur', () => {
    expect(regionToCF['eu-west']).toBe('weur')
  })

  it('should map eu-east to eeur', () => {
    expect(regionToCF['eu-east']).toBe('eeur')
  })

  it('should map asia-pacific to apac', () => {
    expect(regionToCF['asia-pacific']).toBe('apac')
  })

  it('should map oceania to oc', () => {
    expect(regionToCF['oceania']).toBe('oc')
  })

  it('should map africa to afr', () => {
    expect(regionToCF['africa']).toBe('afr')
  })

  it('should map middle-east to me', () => {
    expect(regionToCF['middle-east']).toBe('me')
  })

  it('should map all regions to CF hints', () => {
    const regions: Region[] = [
      'us-west', 'us-east', 'eu-west', 'eu-east',
      'south-america', 'asia-pacific', 'oceania', 'africa', 'middle-east',
    ]

    for (const region of regions) {
      expect(regionToCF[region]).toBeDefined()
    }
  })
})

// ============================================================================
// normalizeLocation Function Tests
// ============================================================================

describe('normalizeLocation Function', () => {
  describe('with ColoCode input', () => {
    it('should normalize lax to { code: lax, region: us-west, cfHint: wnam }', () => {
      const result = normalizeLocation('lax')

      expect(result.code).toBe('lax')
      expect(result.region).toBe('us-west')
      expect(result.cfHint).toBe('wnam')
    })

    it('should normalize iad to { code: iad, region: us-east, cfHint: enam }', () => {
      const result = normalizeLocation('iad')

      expect(result.code).toBe('iad')
      expect(result.region).toBe('us-east')
      expect(result.cfHint).toBe('enam')
    })

    it('should normalize lhr to { code: lhr, region: eu-west, cfHint: weur }', () => {
      const result = normalizeLocation('lhr')

      expect(result.code).toBe('lhr')
      expect(result.region).toBe('eu-west')
      expect(result.cfHint).toBe('weur')
    })

    it('should normalize prg to { code: prg, region: eu-east, cfHint: eeur }', () => {
      const result = normalizeLocation('prg')

      expect(result.code).toBe('prg')
      expect(result.region).toBe('eu-east')
      expect(result.cfHint).toBe('eeur')
    })

    it('should normalize sin to { code: sin, region: asia-pacific, cfHint: apac }', () => {
      const result = normalizeLocation('sin')

      expect(result.code).toBe('sin')
      expect(result.region).toBe('asia-pacific')
      expect(result.cfHint).toBe('apac')
    })
  })

  describe('with ColoCity input', () => {
    it('should normalize LosAngeles to { code: lax, region: us-west, cfHint: wnam }', () => {
      const result = normalizeLocation('LosAngeles')

      expect(result.code).toBe('lax')
      expect(result.region).toBe('us-west')
      expect(result.cfHint).toBe('wnam')
    })

    it('should normalize Virginia to { code: iad, region: us-east, cfHint: enam }', () => {
      const result = normalizeLocation('Virginia')

      expect(result.code).toBe('iad')
      expect(result.region).toBe('us-east')
      expect(result.cfHint).toBe('enam')
    })

    it('should normalize London to { code: lhr, region: eu-west, cfHint: weur }', () => {
      const result = normalizeLocation('London')

      expect(result.code).toBe('lhr')
      expect(result.region).toBe('eu-west')
      expect(result.cfHint).toBe('weur')
    })

    it('should normalize Prague to { code: prg, region: eu-east, cfHint: eeur }', () => {
      const result = normalizeLocation('Prague')

      expect(result.code).toBe('prg')
      expect(result.region).toBe('eu-east')
      expect(result.cfHint).toBe('eeur')
    })

    it('should normalize Singapore to { code: sin, region: asia-pacific, cfHint: apac }', () => {
      const result = normalizeLocation('Singapore')

      expect(result.code).toBe('sin')
      expect(result.region).toBe('asia-pacific')
      expect(result.cfHint).toBe('apac')
    })
  })

  describe('with Region input', () => {
    it('should normalize us-west to { code: undefined, region: us-west, cfHint: wnam }', () => {
      const result = normalizeLocation('us-west')

      expect(result.code).toBeUndefined()
      expect(result.region).toBe('us-west')
      expect(result.cfHint).toBe('wnam')
    })

    it('should normalize us-east to { code: undefined, region: us-east, cfHint: enam }', () => {
      const result = normalizeLocation('us-east')

      expect(result.code).toBeUndefined()
      expect(result.region).toBe('us-east')
      expect(result.cfHint).toBe('enam')
    })

    it('should normalize eu-west to { code: undefined, region: eu-west, cfHint: weur }', () => {
      const result = normalizeLocation('eu-west')

      expect(result.code).toBeUndefined()
      expect(result.region).toBe('eu-west')
      expect(result.cfHint).toBe('weur')
    })

    it('should normalize eu-east to { code: undefined, region: eu-east, cfHint: eeur }', () => {
      const result = normalizeLocation('eu-east')

      expect(result.code).toBeUndefined()
      expect(result.region).toBe('eu-east')
      expect(result.cfHint).toBe('eeur')
    })

    it('should normalize asia-pacific to { code: undefined, region: asia-pacific, cfHint: apac }', () => {
      const result = normalizeLocation('asia-pacific')

      expect(result.code).toBeUndefined()
      expect(result.region).toBe('asia-pacific')
      expect(result.cfHint).toBe('apac')
    })

    it('should normalize south-america to { code: undefined, region: south-america, cfHint: sam }', () => {
      const result = normalizeLocation('south-america')

      expect(result.code).toBeUndefined()
      expect(result.region).toBe('south-america')
      expect(result.cfHint).toBe('sam')
    })

    it('should normalize oceania to { code: undefined, region: oceania, cfHint: oc }', () => {
      const result = normalizeLocation('oceania')

      expect(result.code).toBeUndefined()
      expect(result.region).toBe('oceania')
      expect(result.cfHint).toBe('oc')
    })

    it('should normalize africa to { code: undefined, region: africa, cfHint: afr }', () => {
      const result = normalizeLocation('africa')

      expect(result.code).toBeUndefined()
      expect(result.region).toBe('africa')
      expect(result.cfHint).toBe('afr')
    })

    it('should normalize middle-east to { code: undefined, region: middle-east, cfHint: me }', () => {
      const result = normalizeLocation('middle-east')

      expect(result.code).toBeUndefined()
      expect(result.region).toBe('middle-east')
      expect(result.cfHint).toBe('me')
    })
  })

  describe('return type', () => {
    it('should return NormalizedLocation type', () => {
      const result = normalizeLocation('lax')

      expectTypeOf(result).toEqualTypeOf<NormalizedLocation>()
    })

    it('should have code property of ColoCode | undefined', () => {
      const resultWithCode = normalizeLocation('lax')
      const resultWithoutCode = normalizeLocation('us-west')

      expectTypeOf(resultWithCode.code).toEqualTypeOf<ColoCode | undefined>()
      expectTypeOf(resultWithoutCode.code).toEqualTypeOf<ColoCode | undefined>()
    })

    it('should have region property of Region', () => {
      const result = normalizeLocation('lax')

      expectTypeOf(result.region).toEqualTypeOf<Region>()
    })

    it('should have cfHint property of CFLocationHint', () => {
      const result = normalizeLocation('lax')

      expectTypeOf(result.cfHint).toEqualTypeOf<CFLocationHint>()
    })
  })

  describe('all colos normalize correctly', () => {
    it('should normalize all ColoCode values', () => {
      const codes: ColoCode[] = [
        'iad', 'ewr', 'lax', 'sjc', 'ord', 'dfw', 'den', 'sea', 'atl', 'mia',
        'lhr', 'cdg', 'ams', 'fra', 'mrs', 'mxp', 'prg', 'arn', 'vie',
        'sin', 'hkg', 'nrt', 'kix',
      ]

      for (const code of codes) {
        const result = normalizeLocation(code)

        expect(result.code).toBe(code)
        expect(result.region).toBeDefined()
        expect(result.cfHint).toBeDefined()
      }
    })

    it('should normalize all ColoCity values', () => {
      const cities: ColoCity[] = [
        'Virginia', 'Newark', 'LosAngeles', 'SanJose', 'Chicago',
        'Dallas', 'Denver', 'Seattle', 'Atlanta', 'Miami',
        'London', 'Paris', 'Amsterdam', 'Frankfurt', 'Marseille',
        'Milan', 'Prague', 'Stockholm', 'Vienna',
        'Singapore', 'HongKong', 'Tokyo', 'Osaka',
      ]

      for (const city of cities) {
        const result = normalizeLocation(city)

        expect(result.code).toBe(cityToCode[city])
        expect(result.region).toBeDefined()
        expect(result.cfHint).toBeDefined()
      }
    })

    it('should normalize all Region values', () => {
      const regions: Region[] = [
        'us-west', 'us-east', 'eu-west', 'eu-east',
        'south-america', 'asia-pacific', 'oceania', 'africa', 'middle-east',
      ]

      for (const region of regions) {
        const result = normalizeLocation(region)

        expect(result.code).toBeUndefined()
        expect(result.region).toBe(region)
        expect(result.cfHint).toBeDefined()
      }
    })
  })
})

// ============================================================================
// NormalizedLocation Type Tests
// ============================================================================

describe('NormalizedLocation Type', () => {
  it('should define NormalizedLocation interface', () => {
    const normalized: NormalizedLocation = {
      code: 'lax',
      region: 'us-west',
      cfHint: 'wnam',
    }

    expect(normalized.code).toBe('lax')
    expect(normalized.region).toBe('us-west')
    expect(normalized.cfHint).toBe('wnam')
  })

  it('should allow code to be undefined', () => {
    const normalized: NormalizedLocation = {
      code: undefined,
      region: 'us-west',
      cfHint: 'wnam',
    }

    expect(normalized.code).toBeUndefined()
    expect(normalized.region).toBe('us-west')
    expect(normalized.cfHint).toBe('wnam')
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('Type Safety', () => {
  it('should enforce ColoCode type in cityToCode values', () => {
    const code: ColoCode = cityToCode.Virginia

    expectTypeOf(code).toEqualTypeOf<ColoCode>()
  })

  it('should enforce ColoCity type in codeToCity values', () => {
    const city: ColoCity = codeToCity.iad

    expectTypeOf(city).toEqualTypeOf<ColoCity>()
  })

  it('should enforce Region type in coloRegion values', () => {
    const region: Region = coloRegion.lax

    expectTypeOf(region).toEqualTypeOf<Region>()
  })

  it('should enforce CFLocationHint type in regionToCF values', () => {
    const hint: CFLocationHint = regionToCF['us-west']

    expectTypeOf(hint).toEqualTypeOf<CFLocationHint>()
  })

  it('should accept Colo | Region in normalizeLocation', () => {
    // All these should type-check
    normalizeLocation('lax') // ColoCode
    normalizeLocation('LosAngeles') // ColoCity
    normalizeLocation('us-west') // Region

    expect(true).toBe(true)
  })
})
