import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  loadTenantConfig,
  validateConfig,
  getDefaultConfig,
  getPipelineEndpoint,
  type TenantArtifactConfig,
} from '../artifacts-config'

/**
 * Artifact Config Loader Tests (RED Phase)
 *
 * Tests for loading and validating tenant artifact configuration from KV.
 * The config controls pipeline modes, cache behavior, and rate limits.
 *
 * These tests are expected to FAIL until artifacts-config.ts is implemented.
 *
 * @see /docs/plans/2026-01-10-artifact-storage-design.md
 */

// ============================================================================
// Test Fixtures
// ============================================================================

const VALID_CONFIG: TenantArtifactConfig = {
  ns: 'myapp.do',
  pipelines: {
    allowedModes: ['preview', 'build', 'bulk'],
    defaultMode: 'build',
  },
  cache: {
    defaultMaxAge: 300,
    defaultStaleWhileRevalidate: 60,
    minMaxAge: 10,
    allowFreshBypass: true,
  },
  limits: {
    maxArtifactsPerRequest: 1000,
    maxBytesPerRequest: 10 * 1024 * 1024, // 10MB
    maxRequestsPerMinute: 100,
  },
}

const MINIMAL_CONFIG: TenantArtifactConfig = {
  ns: 'minimal.do',
  pipelines: {
    allowedModes: ['build'],
    defaultMode: 'build',
  },
  cache: {
    defaultMaxAge: 300,
    defaultStaleWhileRevalidate: 60,
    minMaxAge: 10,
    allowFreshBypass: true,
  },
  limits: {
    maxArtifactsPerRequest: 1000,
    maxBytesPerRequest: 10485760,
    maxRequestsPerMinute: 100,
  },
}

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockKV(data: Record<string, unknown> = {}): KVNamespace {
  return {
    get: vi.fn(async (key: string, options?: unknown) => {
      const value = data[key]
      if (value === undefined) return null
      if (typeof options === 'object' && options !== null && 'type' in options) {
        const opts = options as { type: string }
        if (opts.type === 'json') return value
        if (opts.type === 'text') return JSON.stringify(value)
      }
      return JSON.stringify(value)
    }),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace
}

// ============================================================================
// Load Tenant Config Tests
// ============================================================================

describe('loadTenantConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('successful loading', () => {
    it('loads tenant config from KV by namespace', async () => {
      const kv = createMockKV({
        'artifact-config:myapp.do': VALID_CONFIG,
      })

      const config = await loadTenantConfig(kv, 'myapp.do')

      expect(kv.get).toHaveBeenCalledWith('artifact-config:myapp.do', { type: 'json' })
      expect(config.ns).toBe('myapp.do')
      expect(config.pipelines.defaultMode).toBe('build')
      expect(config.cache.defaultMaxAge).toBe(300)
      expect(config.limits.maxArtifactsPerRequest).toBe(1000)
    })

    it('loads config with custom key prefix', async () => {
      const kv = createMockKV({
        'tenant:myapp.do:artifacts': VALID_CONFIG,
      })

      const config = await loadTenantConfig(kv, 'myapp.do', {
        keyPrefix: 'tenant:',
        keySuffix: ':artifacts',
      })

      expect(kv.get).toHaveBeenCalledWith('tenant:myapp.do:artifacts', { type: 'json' })
      expect(config.ns).toBe('myapp.do')
    })

    it('normalizes namespace to lowercase', async () => {
      const kv = createMockKV({
        'artifact-config:myapp.do': VALID_CONFIG,
      })

      const config = await loadTenantConfig(kv, 'MyApp.DO')

      expect(kv.get).toHaveBeenCalledWith('artifact-config:myapp.do', { type: 'json' })
      expect(config.ns).toBe('myapp.do')
    })

    it('preserves all config fields correctly', async () => {
      const kv = createMockKV({
        'artifact-config:full.do': VALID_CONFIG,
      })

      const config = await loadTenantConfig(kv, 'full.do')

      expect(config).toEqual(VALID_CONFIG)
      expect(config.pipelines.allowedModes).toEqual(['preview', 'build', 'bulk'])
      expect(config.cache.allowFreshBypass).toBe(true)
      expect(config.limits.maxBytesPerRequest).toBe(10 * 1024 * 1024)
    })
  })

  describe('default fallbacks', () => {
    it('returns default config when key missing in KV', async () => {
      const kv = createMockKV({})

      const config = await loadTenantConfig(kv, 'unknown.do')

      expect(config.ns).toBe('unknown.do')
      expect(config.pipelines.defaultMode).toBe('build')
      expect(config.pipelines.allowedModes).toContain('build')
      expect(config.cache.defaultMaxAge).toBe(300)
      expect(config.limits.maxArtifactsPerRequest).toBe(1000)
    })

    it('returns default config when KV returns null', async () => {
      const kv = createMockKV({})
      ;(kv.get as ReturnType<typeof vi.fn>).mockResolvedValue(null)

      const config = await loadTenantConfig(kv, 'null.do')

      expect(config.ns).toBe('null.do')
      expect(config.pipelines.defaultMode).toBe('build')
    })

    it('returns default config when KV returns undefined', async () => {
      const kv = createMockKV({})
      ;(kv.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      const config = await loadTenantConfig(kv, 'undefined.do')

      expect(config.ns).toBe('undefined.do')
    })

    it('uses provided defaults when config missing', async () => {
      const kv = createMockKV({})
      const customDefaults: Partial<TenantArtifactConfig> = {
        cache: {
          defaultMaxAge: 600,
          defaultStaleWhileRevalidate: 120,
          minMaxAge: 30,
          allowFreshBypass: false,
        },
      }

      const config = await loadTenantConfig(kv, 'custom.do', { defaults: customDefaults })

      expect(config.cache.defaultMaxAge).toBe(600)
      expect(config.cache.defaultStaleWhileRevalidate).toBe(120)
      expect(config.cache.minMaxAge).toBe(30)
      expect(config.cache.allowFreshBypass).toBe(false)
    })

    it('merges partial config with defaults', async () => {
      const partialConfig = {
        ns: 'partial.do',
        pipelines: {
          allowedModes: ['preview'] as const,
          defaultMode: 'preview' as const,
        },
        // cache and limits missing - should use defaults
      }
      const kv = createMockKV({
        'artifact-config:partial.do': partialConfig,
      })

      const config = await loadTenantConfig(kv, 'partial.do')

      expect(config.pipelines.allowedModes).toEqual(['preview'])
      expect(config.pipelines.defaultMode).toBe('preview')
      // Defaults should be applied for missing sections
      expect(config.cache.defaultMaxAge).toBe(300)
      expect(config.limits.maxArtifactsPerRequest).toBe(1000)
    })
  })

  describe('error handling', () => {
    it('throws on KV read error', async () => {
      const kv = createMockKV({})
      ;(kv.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('KV unavailable'))

      await expect(loadTenantConfig(kv, 'error.do')).rejects.toThrow('KV unavailable')
    })

    it('throws on invalid JSON in KV', async () => {
      const kv = createMockKV({})
      ;(kv.get as ReturnType<typeof vi.fn>).mockResolvedValue('{ invalid json }')

      await expect(loadTenantConfig(kv, 'badjson.do')).rejects.toThrow()
    })
  })
})

// ============================================================================
// Config Validation Tests
// ============================================================================

describe('validateConfig', () => {
  describe('valid configurations', () => {
    it('accepts valid complete config', () => {
      const result = validateConfig(VALID_CONFIG)

      expect(result).toEqual(VALID_CONFIG)
    })

    it('accepts minimal valid config', () => {
      const result = validateConfig(MINIMAL_CONFIG)

      expect(result.ns).toBe('minimal.do')
      expect(result.pipelines.allowedModes).toEqual(['build'])
    })

    it('accepts config with single pipeline mode', () => {
      const config = {
        ...VALID_CONFIG,
        pipelines: {
          allowedModes: ['preview'] as const,
          defaultMode: 'preview' as const,
        },
      }

      const result = validateConfig(config)

      expect(result.pipelines.allowedModes).toEqual(['preview'])
    })
  })

  describe('reject invalid values', () => {
    it('rejects negative TTL values', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        cache: {
          ...VALID_CONFIG.cache,
          defaultMaxAge: -1,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/defaultMaxAge|negative|invalid/i)
    })

    it('rejects negative staleWhileRevalidate', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        cache: {
          ...VALID_CONFIG.cache,
          defaultStaleWhileRevalidate: -10,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/staleWhileRevalidate|negative|invalid/i)
    })

    it('rejects negative minMaxAge', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        cache: {
          ...VALID_CONFIG.cache,
          minMaxAge: -5,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/minMaxAge|negative|invalid/i)
    })

    it('rejects zero minMaxAge', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        cache: {
          ...VALID_CONFIG.cache,
          minMaxAge: 0,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/minMaxAge|zero|positive|invalid/i)
    })

    it('rejects defaultMaxAge less than minMaxAge', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        cache: {
          ...VALID_CONFIG.cache,
          defaultMaxAge: 5,
          minMaxAge: 10,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/defaultMaxAge.*minMaxAge|constraint/i)
    })

    it('rejects null config', () => {
      expect(() => validateConfig(null)).toThrow()
    })

    it('rejects undefined config', () => {
      expect(() => validateConfig(undefined)).toThrow()
    })

    it('rejects non-object config', () => {
      expect(() => validateConfig('invalid')).toThrow()
      expect(() => validateConfig(123)).toThrow()
      expect(() => validateConfig([])).toThrow()
    })

    it('rejects config missing required fields', () => {
      expect(() => validateConfig({})).toThrow(/ns|required/i)
      expect(() => validateConfig({ ns: 'test.do' })).toThrow(/pipelines|required/i)
    })

    it('rejects empty namespace', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        ns: '',
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/ns|empty|required/i)
    })

    it('rejects namespace with invalid characters', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        ns: 'invalid namespace!@#',
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/ns|invalid|character/i)
    })
  })

  describe('pipeline mode validation', () => {
    it('rejects unknown pipeline modes in allowedModes', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        pipelines: {
          allowedModes: ['preview', 'invalid-mode', 'build'] as unknown as TenantArtifactConfig['pipelines']['allowedModes'],
          defaultMode: 'build' as const,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/invalid.*mode|allowedModes/i)
    })

    it('rejects unknown defaultMode', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        pipelines: {
          allowedModes: ['preview', 'build'] as const,
          defaultMode: 'unknown' as unknown as 'preview' | 'build' | 'bulk',
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/defaultMode|invalid|unknown/i)
    })

    it('only allows preview, build, or bulk modes', () => {
      const validModes = ['preview', 'build', 'bulk'] as const

      for (const mode of validModes) {
        const config = {
          ...VALID_CONFIG,
          pipelines: {
            allowedModes: [mode],
            defaultMode: mode,
          },
        }
        expect(() => validateConfig(config)).not.toThrow()
      }
    })

    it('rejects empty allowedModes array', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        pipelines: {
          allowedModes: [] as const,
          defaultMode: 'build' as const,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/allowedModes|empty|at least one/i)
    })

    it('rejects defaultMode not in allowedModes', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        pipelines: {
          allowedModes: ['preview'] as const,
          defaultMode: 'build' as const,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/defaultMode.*allowedModes|not allowed/i)
    })

    it('rejects duplicate modes in allowedModes', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        pipelines: {
          allowedModes: ['build', 'build', 'preview'] as unknown as TenantArtifactConfig['pipelines']['allowedModes'],
          defaultMode: 'build' as const,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/duplicate|unique/i)
    })
  })

  describe('cache TTL bounds validation', () => {
    it('enforces minMaxAge floor', () => {
      const config = {
        ...VALID_CONFIG,
        cache: {
          ...VALID_CONFIG.cache,
          minMaxAge: 5,
          defaultMaxAge: 3, // Below minMaxAge floor
        },
      }

      expect(() => validateConfig(config)).toThrow(/defaultMaxAge.*minMaxAge|floor|bound/i)
    })

    it('accepts defaultMaxAge equal to minMaxAge', () => {
      const config = {
        ...VALID_CONFIG,
        cache: {
          ...VALID_CONFIG.cache,
          minMaxAge: 10,
          defaultMaxAge: 10,
        },
      }

      expect(() => validateConfig(config)).not.toThrow()
    })

    it('accepts defaultMaxAge greater than minMaxAge', () => {
      const config = {
        ...VALID_CONFIG,
        cache: {
          ...VALID_CONFIG.cache,
          minMaxAge: 10,
          defaultMaxAge: 300,
        },
      }

      expect(() => validateConfig(config)).not.toThrow()
    })

    it('rejects excessively large TTL values', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        cache: {
          ...VALID_CONFIG.cache,
          defaultMaxAge: 365 * 24 * 60 * 60 + 1, // > 1 year
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/defaultMaxAge|too large|maximum/i)
    })

    it('rejects non-integer TTL values', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        cache: {
          ...VALID_CONFIG.cache,
          defaultMaxAge: 300.5,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/defaultMaxAge|integer/i)
    })

    it('validates allowFreshBypass is boolean', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        cache: {
          ...VALID_CONFIG.cache,
          allowFreshBypass: 'yes' as unknown as boolean,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/allowFreshBypass|boolean/i)
    })
  })

  describe('rate limit config validation', () => {
    it('rejects negative maxArtifactsPerRequest', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        limits: {
          ...VALID_CONFIG.limits,
          maxArtifactsPerRequest: -1,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/maxArtifactsPerRequest|negative|invalid/i)
    })

    it('rejects zero maxArtifactsPerRequest', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        limits: {
          ...VALID_CONFIG.limits,
          maxArtifactsPerRequest: 0,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/maxArtifactsPerRequest|zero|positive/i)
    })

    it('rejects negative maxBytesPerRequest', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        limits: {
          ...VALID_CONFIG.limits,
          maxBytesPerRequest: -1024,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/maxBytesPerRequest|negative|invalid/i)
    })

    it('rejects zero maxBytesPerRequest', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        limits: {
          ...VALID_CONFIG.limits,
          maxBytesPerRequest: 0,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/maxBytesPerRequest|zero|positive/i)
    })

    it('rejects negative maxRequestsPerMinute', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        limits: {
          ...VALID_CONFIG.limits,
          maxRequestsPerMinute: -10,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/maxRequestsPerMinute|negative|invalid/i)
    })

    it('rejects zero maxRequestsPerMinute', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        limits: {
          ...VALID_CONFIG.limits,
          maxRequestsPerMinute: 0,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/maxRequestsPerMinute|zero|positive/i)
    })

    it('rejects non-integer limit values', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        limits: {
          ...VALID_CONFIG.limits,
          maxArtifactsPerRequest: 100.5,
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/maxArtifactsPerRequest|integer/i)
    })

    it('rejects excessively large maxArtifactsPerRequest', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        limits: {
          ...VALID_CONFIG.limits,
          maxArtifactsPerRequest: 1_000_001, // > 1M
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/maxArtifactsPerRequest|too large|maximum/i)
    })

    it('rejects excessively large maxBytesPerRequest', () => {
      const invalidConfig = {
        ...VALID_CONFIG,
        limits: {
          ...VALID_CONFIG.limits,
          maxBytesPerRequest: 1024 * 1024 * 1024 + 1, // > 1GB
        },
      }

      expect(() => validateConfig(invalidConfig)).toThrow(/maxBytesPerRequest|too large|maximum/i)
    })

    it('accepts valid rate limit values', () => {
      const config = {
        ...VALID_CONFIG,
        limits: {
          maxArtifactsPerRequest: 5000,
          maxBytesPerRequest: 50 * 1024 * 1024, // 50MB
          maxRequestsPerMinute: 500,
        },
      }

      expect(() => validateConfig(config)).not.toThrow()
    })
  })
})

// ============================================================================
// Default Config Tests
// ============================================================================

describe('getDefaultConfig', () => {
  it('returns default config with expected structure', () => {
    const defaults = getDefaultConfig()

    expect(defaults).toHaveProperty('ns')
    expect(defaults).toHaveProperty('pipelines')
    expect(defaults).toHaveProperty('cache')
    expect(defaults).toHaveProperty('limits')
  })

  it('has build as default pipeline mode', () => {
    const defaults = getDefaultConfig()

    expect(defaults.pipelines.defaultMode).toBe('build')
  })

  it('allows all pipeline modes by default', () => {
    const defaults = getDefaultConfig()

    expect(defaults.pipelines.allowedModes).toContain('preview')
    expect(defaults.pipelines.allowedModes).toContain('build')
    expect(defaults.pipelines.allowedModes).toContain('bulk')
  })

  it('has reasonable cache defaults', () => {
    const defaults = getDefaultConfig()

    expect(defaults.cache.defaultMaxAge).toBe(300) // 5 minutes
    expect(defaults.cache.defaultStaleWhileRevalidate).toBe(60)
    expect(defaults.cache.minMaxAge).toBe(10)
    expect(defaults.cache.allowFreshBypass).toBe(true)
  })

  it('has reasonable limit defaults', () => {
    const defaults = getDefaultConfig()

    expect(defaults.limits.maxArtifactsPerRequest).toBe(1000)
    expect(defaults.limits.maxBytesPerRequest).toBe(10 * 1024 * 1024) // 10MB
    expect(defaults.limits.maxRequestsPerMinute).toBe(100)
  })

  it('returns a new object on each call (immutability)', () => {
    const defaults1 = getDefaultConfig()
    const defaults2 = getDefaultConfig()

    expect(defaults1).not.toBe(defaults2)
    expect(defaults1).toEqual(defaults2)

    // Mutating one should not affect the other
    defaults1.cache.defaultMaxAge = 999
    expect(defaults2.cache.defaultMaxAge).toBe(300)
  })

  it('accepts namespace parameter', () => {
    const defaults = getDefaultConfig('custom.do')

    expect(defaults.ns).toBe('custom.do')
  })

  it('uses placeholder namespace when not provided', () => {
    const defaults = getDefaultConfig()

    expect(defaults.ns).toBeDefined()
    expect(typeof defaults.ns).toBe('string')
  })
})

// ============================================================================
// Pipeline Endpoint Tests
// ============================================================================

describe('getPipelineEndpoint', () => {
  it('returns preview pipeline endpoint for preview mode', () => {
    const endpoint = getPipelineEndpoint('preview')

    expect(endpoint).toContain('preview')
    expect(endpoint).toMatch(/^https?:\/\//)
  })

  it('returns build pipeline endpoint for build mode', () => {
    const endpoint = getPipelineEndpoint('build')

    expect(endpoint).toContain('build')
    expect(endpoint).toMatch(/^https?:\/\//)
  })

  it('returns bulk pipeline endpoint for bulk mode', () => {
    const endpoint = getPipelineEndpoint('bulk')

    expect(endpoint).toContain('bulk')
    expect(endpoint).toMatch(/^https?:\/\//)
  })

  it('throws for unknown pipeline mode', () => {
    expect(() => getPipelineEndpoint('invalid')).toThrow(/invalid|unknown|mode/i)
  })

  it('throws for empty mode string', () => {
    expect(() => getPipelineEndpoint('')).toThrow(/empty|required|mode/i)
  })

  it('is case-insensitive', () => {
    const endpoint1 = getPipelineEndpoint('PREVIEW')
    const endpoint2 = getPipelineEndpoint('preview')

    expect(endpoint1).toBe(endpoint2)
  })

  it('returns consistent endpoints', () => {
    const endpoint1 = getPipelineEndpoint('build')
    const endpoint2 = getPipelineEndpoint('build')

    expect(endpoint1).toBe(endpoint2)
  })

  it('returns different endpoints for different modes', () => {
    const preview = getPipelineEndpoint('preview')
    const build = getPipelineEndpoint('build')
    const bulk = getPipelineEndpoint('bulk')

    expect(preview).not.toBe(build)
    expect(build).not.toBe(bulk)
    expect(preview).not.toBe(bulk)
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('type safety', () => {
  it('TenantArtifactConfig matches expected interface', () => {
    const config: TenantArtifactConfig = {
      ns: 'test.do',
      pipelines: {
        allowedModes: ['preview', 'build', 'bulk'],
        defaultMode: 'build',
      },
      cache: {
        defaultMaxAge: 300,
        defaultStaleWhileRevalidate: 60,
        minMaxAge: 10,
        allowFreshBypass: true,
      },
      limits: {
        maxArtifactsPerRequest: 1000,
        maxBytesPerRequest: 10485760,
        maxRequestsPerMinute: 100,
      },
    }

    expect(config).toBeDefined()
    expect(validateConfig(config)).toBeDefined()
  })
})

// ============================================================================
// Integration-like Tests
// ============================================================================

describe('config loading workflow', () => {
  it('loads, validates, and returns usable config', async () => {
    const kv = createMockKV({
      'artifact-config:workflow.do': VALID_CONFIG,
    })

    const config = await loadTenantConfig(kv, 'workflow.do')

    // Should be validated during load
    expect(config.ns).toBe('myapp.do')
    expect(config.pipelines.allowedModes.includes(config.pipelines.defaultMode)).toBe(true)
    expect(config.cache.defaultMaxAge).toBeGreaterThanOrEqual(config.cache.minMaxAge)
    expect(config.limits.maxArtifactsPerRequest).toBeGreaterThan(0)
  })

  it('returns validated defaults for missing tenant', async () => {
    const kv = createMockKV({})

    const config = await loadTenantConfig(kv, 'missing.do')

    // Defaults should also be valid
    expect(() => validateConfig(config)).not.toThrow()
    expect(config.ns).toBe('missing.do')
  })

  it('can use loaded config to select pipeline endpoint', async () => {
    const kv = createMockKV({
      'artifact-config:endpoint.do': {
        ...VALID_CONFIG,
        pipelines: {
          allowedModes: ['preview', 'build'],
          defaultMode: 'preview',
        },
      },
    })

    const config = await loadTenantConfig(kv, 'endpoint.do')
    const endpoint = getPipelineEndpoint(config.pipelines.defaultMode)

    expect(endpoint).toContain('preview')
  })

  it('validates config on load (rejects invalid stored config)', async () => {
    const invalidStoredConfig = {
      ns: 'invalid.do',
      pipelines: {
        allowedModes: ['unknown-mode'],
        defaultMode: 'unknown-mode',
      },
      cache: {
        defaultMaxAge: -1,
        defaultStaleWhileRevalidate: 60,
        minMaxAge: 10,
        allowFreshBypass: true,
      },
      limits: {
        maxArtifactsPerRequest: 1000,
        maxBytesPerRequest: 10485760,
        maxRequestsPerMinute: 100,
      },
    }
    const kv = createMockKV({
      'artifact-config:invalid.do': invalidStoredConfig,
    })

    await expect(loadTenantConfig(kv, 'invalid.do')).rejects.toThrow()
  })
})
