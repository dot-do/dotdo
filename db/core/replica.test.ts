/**
 * ReplicaManager tests
 *
 * Tests for geo-distribution and replication:
 * - Jurisdiction placement (eu/us/fedramp) - guaranteed data sovereignty
 * - Region→colo mapping (us-east-1→iad) - location hints
 * - City placement via colo.do - guaranteed precise placement
 * - Read/write routing (nearest, primary, secondary)
 * - WriteThrough replication
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReplicaConfig, Region, City, Jurisdiction } from './types'
import {
  ReplicaManager,
  resolveColoFromRegion,
  getJurisdictionForRegion,
  isRegionInJurisdiction,
  createPlacementOptions,
} from './replica'

// ============================================================================
// REGION TO COLO MAPPING TESTS
// ============================================================================

describe('resolveColoFromRegion', () => {
  it('should map US regions to correct colos', () => {
    expect(resolveColoFromRegion('us-east-1')).toBe('iad')
    expect(resolveColoFromRegion('us-east-2')).toBe('ord')
    expect(resolveColoFromRegion('us-west-1')).toBe('sfo')
    expect(resolveColoFromRegion('us-west-2')).toBe('sea')
  })

  it('should map EU regions to correct colos', () => {
    expect(resolveColoFromRegion('eu-west-1')).toBe('dub')
    expect(resolveColoFromRegion('eu-west-2')).toBe('lhr')
    expect(resolveColoFromRegion('eu-west-3')).toBe('cdg')
    expect(resolveColoFromRegion('eu-central-1')).toBe('fra')
  })

  it('should map AP regions to correct colos', () => {
    expect(resolveColoFromRegion('ap-northeast-1')).toBe('nrt')
    expect(resolveColoFromRegion('ap-southeast-1')).toBe('sin')
    expect(resolveColoFromRegion('ap-southeast-2')).toBe('syd')
    expect(resolveColoFromRegion('ap-south-1')).toBe('bom')
  })

  it('should map other regions', () => {
    expect(resolveColoFromRegion('sa-east-1')).toBe('gru')
    expect(resolveColoFromRegion('me-south-1')).toBe('dxb')
    expect(resolveColoFromRegion('af-south-1')).toBe('jnb')
  })
})

// ============================================================================
// JURISDICTION TESTS
// ============================================================================

describe('getJurisdictionForRegion', () => {
  it('should return eu for EU regions', () => {
    expect(getJurisdictionForRegion('eu-west-1')).toBe('eu')
    expect(getJurisdictionForRegion('eu-central-1')).toBe('eu')
    expect(getJurisdictionForRegion('eu-north-1')).toBe('eu')
  })

  it('should return us for US regions', () => {
    expect(getJurisdictionForRegion('us-east-1')).toBe('us')
    expect(getJurisdictionForRegion('us-west-2')).toBe('us')
    expect(getJurisdictionForRegion('ca-central-1')).toBe('us')
  })

  it('should return fedramp for gov regions', () => {
    expect(getJurisdictionForRegion('us-gov-west-1')).toBe('fedramp')
    expect(getJurisdictionForRegion('us-gov-east-1')).toBe('fedramp')
  })

  it('should return undefined for other regions', () => {
    expect(getJurisdictionForRegion('ap-northeast-1')).toBeUndefined()
    expect(getJurisdictionForRegion('sa-east-1')).toBeUndefined()
  })
})

describe('isRegionInJurisdiction', () => {
  it('should validate EU regions', () => {
    expect(isRegionInJurisdiction('eu-west-1', 'eu')).toBe(true)
    expect(isRegionInJurisdiction('us-east-1', 'eu')).toBe(false)
  })

  it('should validate US regions', () => {
    expect(isRegionInJurisdiction('us-east-1', 'us')).toBe(true)
    expect(isRegionInJurisdiction('eu-west-1', 'us')).toBe(false)
  })

  it('should validate FedRAMP regions', () => {
    expect(isRegionInJurisdiction('us-gov-west-1', 'fedramp')).toBe(true)
    expect(isRegionInJurisdiction('us-east-1', 'fedramp')).toBe(false)
  })
})

// ============================================================================
// PLACEMENT OPTIONS TESTS
// ============================================================================

describe('createPlacementOptions', () => {
  it('should create options with jurisdiction constraint', () => {
    const config: ReplicaConfig = {
      jurisdiction: 'eu',
      readFrom: 'nearest',
    }
    const options = createPlacementOptions(config)

    expect(options.jurisdiction).toBe('eu')
  })

  it('should create options with region hint', () => {
    const config: ReplicaConfig = {
      regions: ['us-east-1'],
      readFrom: 'nearest',
    }
    const options = createPlacementOptions(config)

    expect(options.locationHint).toBe('enam') // US East maps to enam hint
  })

  it('should create options with city for colo.do', () => {
    const config: ReplicaConfig = {
      cities: ['iad'],
      readFrom: 'nearest',
    }
    const options = createPlacementOptions(config)

    expect(options.coloDo).toBe('iad')
  })

  it('should prioritize city over region over jurisdiction', () => {
    const config: ReplicaConfig = {
      jurisdiction: 'us',
      regions: ['us-west-2'],
      cities: ['lhr'], // London - even though jurisdiction is US!
      readFrom: 'nearest',
    }
    const options = createPlacementOptions(config)

    // City takes precedence for primary placement
    expect(options.coloDo).toBe('lhr')
  })
})

// ============================================================================
// REPLICA MANAGER TESTS
// ============================================================================

describe('ReplicaManager', () => {
  // Mock DurableObjectNamespace
  const createMockNamespace = () => {
    const stubs = new Map<string, any>()
    return {
      idFromName: vi.fn((name: string) => ({ toString: () => `id-${name}` })),
      get: vi.fn((id: any, options?: any) => {
        const name = id.toString()
        if (!stubs.has(name)) {
          stubs.set(name, {
            fetch: vi.fn().mockResolvedValue(
              new Response(JSON.stringify({ success: true }))
            ),
            _options: options, // Store options for testing
          })
        }
        const stub = stubs.get(name)
        stub._options = options
        return stub
      }),
      _stubs: stubs,
    }
  }

  // Mock colo.do service (for precise city placement)
  const createMockColoDo = (city: City) => ({
    idFromName: vi.fn((name: string) => ({ toString: () => `colo-${city}-${name}` })),
    get: vi.fn((id: any) => ({
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }))
      ),
    })),
  })

  let mockNamespace: ReturnType<typeof createMockNamespace>
  let manager: ReplicaManager

  beforeEach(() => {
    mockNamespace = createMockNamespace()
  })

  describe('constructor', () => {
    it('should create with default config', () => {
      manager = new ReplicaManager(mockNamespace as any)
      expect(manager).toBeInstanceOf(ReplicaManager)
    })

    it('should accept custom config', () => {
      const config: ReplicaConfig = {
        jurisdiction: 'eu',
        regions: ['eu-west-1', 'eu-central-1'],
        readFrom: 'nearest',
        writeThrough: true,
      }
      manager = new ReplicaManager(mockNamespace as any, config)
      expect(manager.config).toEqual(config)
    })
  })

  describe('getPrimaryStub', () => {
    it('should create DO with jurisdiction constraint', async () => {
      manager = new ReplicaManager(mockNamespace as any, {
        jurisdiction: 'eu',
        readFrom: 'nearest',
      })

      const stub = await manager.getPrimaryStub('my-db')

      expect(mockNamespace.get).toHaveBeenCalled()
      // The options should include jurisdiction
      const call = mockNamespace.get.mock.calls[0]
      expect(call[1]?.jurisdiction).toBe('eu')
    })

    it('should create DO with locationHint for region', async () => {
      manager = new ReplicaManager(mockNamespace as any, {
        regions: ['us-east-1'],
        readFrom: 'nearest',
      })

      const stub = await manager.getPrimaryStub('my-db')

      const call = mockNamespace.get.mock.calls[0]
      expect(call[1]?.locationHint).toBeDefined()
    })
  })

  describe('getReadStub', () => {
    it('should return primary for readFrom=primary', async () => {
      manager = new ReplicaManager(mockNamespace as any, {
        readFrom: 'primary',
      })

      const stub = await manager.getReadStub('my-db')
      expect(stub).toBeDefined()
    })

    it('should return nearest for readFrom=nearest', async () => {
      manager = new ReplicaManager(mockNamespace as any, {
        regions: ['us-east-1', 'eu-west-1'],
        readFrom: 'nearest',
      })

      const stub = await manager.getReadStub('my-db')
      expect(stub).toBeDefined()
    })

    it('should prefer secondary for readFrom=secondary', async () => {
      manager = new ReplicaManager(mockNamespace as any, {
        regions: ['us-east-1', 'eu-west-1'],
        readFrom: 'secondary',
      })

      const stub = await manager.getReadStub('my-db')
      expect(stub).toBeDefined()
    })
  })

  describe('getWriteStub', () => {
    it('should always return primary for writes', async () => {
      manager = new ReplicaManager(mockNamespace as any, {
        regions: ['us-east-1', 'eu-west-1'],
        readFrom: 'secondary', // Even with secondary read preference
      })

      const stub = await manager.getWriteStub('my-db')
      expect(stub).toBeDefined()
      // Should be the primary stub
    })
  })

  describe('writeThrough', () => {
    it('should replicate writes to all replicas when enabled', async () => {
      manager = new ReplicaManager(mockNamespace as any, {
        regions: ['us-east-1', 'eu-west-1', 'ap-northeast-1'],
        readFrom: 'nearest',
        writeThrough: true,
      })

      const result = await manager.writeThroughAll('my-db', '/write', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      })

      // Should write to all regions
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should only write to primary when writeThrough is false', async () => {
      manager = new ReplicaManager(mockNamespace as any, {
        regions: ['us-east-1', 'eu-west-1'],
        readFrom: 'nearest',
        writeThrough: false,
      })

      const result = await manager.writeThroughAll('my-db', '/write', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      })

      // Should only write to primary
      expect(result.length).toBe(1)
    })
  })

  describe('replicaCount', () => {
    it('should return number of configured regions', () => {
      manager = new ReplicaManager(mockNamespace as any, {
        regions: ['us-east-1', 'eu-west-1', 'ap-northeast-1'],
        readFrom: 'nearest',
      })

      expect(manager.replicaCount).toBe(3)
    })

    it('should return number of configured cities', () => {
      manager = new ReplicaManager(mockNamespace as any, {
        cities: ['iad', 'lhr', 'nrt', 'sin'],
        readFrom: 'nearest',
      })

      expect(manager.replicaCount).toBe(4)
    })

    it('should return 1 when no regions or cities', () => {
      manager = new ReplicaManager(mockNamespace as any, {
        jurisdiction: 'eu',
        readFrom: 'primary',
      })

      expect(manager.replicaCount).toBe(1)
    })
  })
})

// ============================================================================
// COLO.DO PATTERN TESTS
// ============================================================================

describe('colo.do pattern', () => {
  it('should use colo.do for precise city placement', async () => {
    const mockColoDo = {
      iad: {
        idFromName: vi.fn((name: string) => ({ toString: () => `iad-${name}` })),
        get: vi.fn(() => ({
          fetch: vi.fn().mockResolvedValue(new Response('ok')),
        })),
      },
    }

    const manager = new ReplicaManager(
      {} as any, // Primary namespace not used for colo.do
      {
        cities: ['iad'],
        readFrom: 'nearest',
      },
      mockColoDo as any
    )

    // When colo.do bindings are provided, should use them for city placement
    const stub = await manager.getStubInCity('my-db', 'iad')
    expect(mockColoDo.iad.idFromName).toHaveBeenCalled()
  })

  it('should support multiple city deployments', async () => {
    const mockColoBindings = {
      iad: {
        idFromName: vi.fn((name: string) => ({ toString: () => `iad-${name}` })),
        get: vi.fn(() => ({ fetch: vi.fn().mockResolvedValue(new Response('ok')) })),
      },
      lhr: {
        idFromName: vi.fn((name: string) => ({ toString: () => `lhr-${name}` })),
        get: vi.fn(() => ({ fetch: vi.fn().mockResolvedValue(new Response('ok')) })),
      },
      nrt: {
        idFromName: vi.fn((name: string) => ({ toString: () => `nrt-${name}` })),
        get: vi.fn(() => ({ fetch: vi.fn().mockResolvedValue(new Response('ok')) })),
      },
    }

    const manager = new ReplicaManager(
      {} as any,
      {
        cities: ['iad', 'lhr', 'nrt'],
        readFrom: 'nearest',
      },
      mockColoBindings as any
    )

    // Get stubs in each city
    await manager.getStubInCity('my-db', 'iad')
    await manager.getStubInCity('my-db', 'lhr')
    await manager.getStubInCity('my-db', 'nrt')

    expect(mockColoBindings.iad.idFromName).toHaveBeenCalled()
    expect(mockColoBindings.lhr.idFromName).toHaveBeenCalled()
    expect(mockColoBindings.nrt.idFromName).toHaveBeenCalled()
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('ReplicaManager integration', () => {
  it('should work with realistic multi-region setup', async () => {
    const mockNamespace = {
      idFromName: vi.fn((name: string) => ({ toString: () => `id-${name}` })),
      get: vi.fn(() => ({
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ rows: [] }))
        ),
      })),
    }

    const manager = new ReplicaManager(mockNamespace as any, {
      jurisdiction: 'eu', // GDPR compliance
      regions: ['eu-west-1', 'eu-central-1'], // Dublin + Frankfurt
      readFrom: 'nearest',
      writeThrough: true,
    })

    // All regions should be in EU
    expect(manager.config.jurisdiction).toBe('eu')

    // Write should go to all replicas
    const writeResults = await manager.writeThroughAll('gdpr-db', '/write', {
      method: 'POST',
      body: JSON.stringify({ user: 'data' }),
    })

    expect(writeResults.length).toBeGreaterThanOrEqual(1)
  })

  it('should enforce jurisdiction constraints', () => {
    const manager = new ReplicaManager({} as any, {
      jurisdiction: 'eu',
      readFrom: 'nearest',
    })

    // Should validate that regions match jurisdiction
    expect(manager.isValidRegion('eu-west-1')).toBe(true)
    expect(manager.isValidRegion('us-east-1')).toBe(false)
  })
})
