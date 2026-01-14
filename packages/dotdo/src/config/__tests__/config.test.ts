/**
 * DoConfig Tests (RED phase - TDD)
 *
 * These tests define the contract for the do.config.ts configuration system.
 * Tests are expected to FAIL until the implementation is created.
 *
 * The DoConfig system provides:
 * - DoConfig interface for type-safe configuration
 * - defineConfig() helper function for configuration authoring
 * - loadConfig() for reading do.config.ts from the current working directory
 * - Environment-specific namespace overrides
 * - Default values for optional configuration
 *
 * ## Expected Interface
 *
 * ```typescript
 * interface DoConfig {
 *   ns: string                           // Primary namespace URL
 *   envs?: Record<string, string>        // Environment-specific ns overrides
 *   auth?: AuthConfig                    // Authentication configuration
 *   dashboard?: DashboardConfig          // Dashboard UI configuration
 *   api?: ApiConfig                      // REST API configuration
 *   cli?: CliConfig                      // CLI configuration
 * }
 *
 * function defineConfig(config: DoConfig): DoConfig
 * function loadConfig(options?: LoadConfigOptions): Promise<DoConfig>
 * function resolveNamespace(config: DoConfig, env?: string): string
 * ```
 *
 * @see docs/plans/2026-01-10-do-dashboard-design.md for full specification
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'

// Import the module under test (will fail until implemented)
import {
  defineConfig,
  loadConfig,
  resolveNamespace,
  type DoConfig,
  type AuthConfig,
  type DashboardConfig,
  type ApiConfig,
  type CliConfig,
} from '../index'

// =============================================================================
// DoConfig Interface Tests
// =============================================================================

describe('DoConfig Interface', () => {
  describe('required fields', () => {
    it('requires ns (namespace) field', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
      }

      expect(config.ns).toBe('myapp.com')
    })

    it('ns must be a string', () => {
      const config: DoConfig = {
        ns: 'example.com.ai',
      }

      expect(typeof config.ns).toBe('string')
    })

    it('ns should be a valid domain-like string', () => {
      const validConfigs: DoConfig[] = [
        { ns: 'myapp.com' },
        { ns: 'app.example.io' },
        { ns: 'staging.myapp.com' },
        { ns: 'localhost:8787' },
      ]

      for (const config of validConfigs) {
        expect(config.ns).toBeDefined()
        expect(config.ns.length).toBeGreaterThan(0)
      }
    })
  })

  describe('optional fields', () => {
    it('envs is optional', () => {
      const config: DoConfig = { ns: 'myapp.com' }
      expect(config.envs).toBeUndefined()
    })

    it('auth is optional', () => {
      const config: DoConfig = { ns: 'myapp.com' }
      expect(config.auth).toBeUndefined()
    })

    it('dashboard is optional', () => {
      const config: DoConfig = { ns: 'myapp.com' }
      expect(config.dashboard).toBeUndefined()
    })

    it('api is optional', () => {
      const config: DoConfig = { ns: 'myapp.com' }
      expect(config.api).toBeUndefined()
    })

    it('cli is optional', () => {
      const config: DoConfig = { ns: 'myapp.com' }
      expect(config.cli).toBeUndefined()
    })
  })

  describe('envs configuration', () => {
    it('envs is a Record<string, string>', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        envs: {
          staging: 'staging.myapp.com',
          production: 'myapp.com',
          development: 'localhost:8787',
        },
      }

      expect(config.envs).toBeDefined()
      expect(config.envs!.staging).toBe('staging.myapp.com')
      expect(config.envs!.production).toBe('myapp.com')
      expect(config.envs!.development).toBe('localhost:8787')
    })

    it('envs can be empty', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        envs: {},
      }

      expect(config.envs).toEqual({})
    })
  })

  describe('auth configuration', () => {
    it('auth.provider can be oauth.do (default)', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        auth: {
          provider: 'oauth.do',
        },
      }

      expect(config.auth?.provider).toBe('oauth.do')
    })

    it('auth.provider can be workos, clerk, auth0, or custom', () => {
      const providers: AuthConfig['provider'][] = ['workos', 'clerk', 'auth0', 'custom']

      for (const provider of providers) {
        const config: DoConfig = {
          ns: 'myapp.com',
          auth: { provider },
        }
        expect(config.auth?.provider).toBe(provider)
      }
    })

    it('auth supports clientId and clientSecret', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        auth: {
          provider: 'auth0',
          clientId: 'my-client-id',
          clientSecret: 'my-secret',
        },
      }

      expect(config.auth?.clientId).toBe('my-client-id')
      expect(config.auth?.clientSecret).toBe('my-secret')
    })

    it('auth supports scopes array', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        auth: {
          scopes: ['openid', 'profile', 'email'],
        },
      }

      expect(config.auth?.scopes).toEqual(['openid', 'profile', 'email'])
    })

    it('auth supports custom OAuth URLs', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        auth: {
          provider: 'custom',
          authorizationUrl: 'https://auth.example.com.ai/authorize',
          tokenUrl: 'https://auth.example.com.ai/token',
          userinfoUrl: 'https://auth.example.com.ai/userinfo',
        },
      }

      expect(config.auth?.authorizationUrl).toBe('https://auth.example.com.ai/authorize')
      expect(config.auth?.tokenUrl).toBe('https://auth.example.com.ai/token')
      expect(config.auth?.userinfoUrl).toBe('https://auth.example.com.ai/userinfo')
    })
  })

  describe('dashboard configuration', () => {
    it('dashboard supports title', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        dashboard: {
          title: 'My App Admin',
        },
      }

      expect(config.dashboard?.title).toBe('My App Admin')
    })

    it('dashboard supports logo and favicon', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        dashboard: {
          logo: '/assets/logo.svg',
          favicon: '/assets/favicon.ico',
        },
      }

      expect(config.dashboard?.logo).toBe('/assets/logo.svg')
      expect(config.dashboard?.favicon).toBe('/assets/favicon.ico')
    })

    it('dashboard theme can be light, dark, or auto', () => {
      const themes: DashboardConfig['theme'][] = ['light', 'dark', 'auto']

      for (const theme of themes) {
        const config: DoConfig = {
          ns: 'myapp.com',
          dashboard: { theme },
        }
        expect(config.dashboard?.theme).toBe(theme)
      }
    })

    it('dashboard supports sections array', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        dashboard: {
          sections: ['schema', 'data', 'compute', 'platform', 'storage'],
        },
      }

      expect(config.dashboard?.sections).toEqual(['schema', 'data', 'compute', 'platform', 'storage'])
    })

    it('dashboard supports custom views', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        dashboard: {
          views: [
            { name: 'Analytics', path: '/analytics', component: 'AnalyticsView' },
          ],
        },
      }

      expect(config.dashboard?.views).toHaveLength(1)
      expect(config.dashboard?.views![0].name).toBe('Analytics')
    })
  })

  describe('api configuration', () => {
    it('api supports basePath (default: /api)', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        api: {
          basePath: '/v1',
        },
      }

      expect(config.api?.basePath).toBe('/v1')
    })

    it('api supports openapi configuration', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        api: {
          openapi: {
            title: 'My App API',
            version: '1.0.0',
            description: 'API for My App',
          },
        },
      }

      expect(config.api?.openapi?.title).toBe('My App API')
      expect(config.api?.openapi?.version).toBe('1.0.0')
      expect(config.api?.openapi?.description).toBe('API for My App')
    })

    it('api supports cors configuration', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        api: {
          cors: {
            origins: ['https://myapp.com', 'https://admin.myapp.com'],
            methods: ['GET', 'POST', 'PUT', 'DELETE'],
            credentials: true,
          },
        },
      }

      expect(config.api?.cors?.origins).toEqual(['https://myapp.com', 'https://admin.myapp.com'])
      expect(config.api?.cors?.methods).toEqual(['GET', 'POST', 'PUT', 'DELETE'])
      expect(config.api?.cors?.credentials).toBe(true)
    })

    it('api supports rateLimit configuration', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        api: {
          rateLimit: {
            limit: 100,
            window: '1m',
          },
        },
      }

      expect(config.api?.rateLimit?.limit).toBe(100)
      expect(config.api?.rateLimit?.window).toBe('1m')
    })

    it('rateLimit window can be 1s, 1m, 1h, or 1d', () => {
      const windows: ApiConfig['rateLimit'] extends { window: infer W } ? W[] : never = ['1s', '1m', '1h', '1d']

      for (const window of windows) {
        const config: DoConfig = {
          ns: 'myapp.com',
          api: {
            rateLimit: { limit: 100, window },
          },
        }
        expect(config.api?.rateLimit?.window).toBe(window)
      }
    })
  })

  describe('cli configuration', () => {
    it('cli supports name (command name)', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        cli: {
          name: 'myapp',
        },
      }

      expect(config.cli?.name).toBe('myapp')
    })

    it('cli supports vimMode (default: true)', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        cli: {
          vimMode: false,
        },
      }

      expect(config.cli?.vimMode).toBe(false)
    })

    it('cli supports custom key bindings', () => {
      const config: DoConfig = {
        ns: 'myapp.com',
        cli: {
          keys: {
            quit: 'ctrl+c',
            help: '?',
          },
        },
      }

      expect(config.cli?.keys?.quit).toBe('ctrl+c')
      expect(config.cli?.keys?.help).toBe('?')
    })
  })
})

// =============================================================================
// defineConfig() Function Tests
// =============================================================================

describe('defineConfig()', () => {
  it('returns the same config object passed in', () => {
    const input: DoConfig = { ns: 'myapp.com' }
    const result = defineConfig(input)

    expect(result).toEqual(input)
  })

  it('preserves all configuration properties', () => {
    const input: DoConfig = {
      ns: 'myapp.com',
      envs: {
        staging: 'staging.myapp.com',
      },
      auth: {
        provider: 'oauth.do',
      },
      dashboard: {
        title: 'Admin',
        theme: 'dark',
      },
      api: {
        basePath: '/api',
      },
      cli: {
        name: 'myapp',
        vimMode: true,
      },
    }

    const result = defineConfig(input)

    expect(result.ns).toBe('myapp.com')
    expect(result.envs).toEqual({ staging: 'staging.myapp.com' })
    expect(result.auth?.provider).toBe('oauth.do')
    expect(result.dashboard?.title).toBe('Admin')
    expect(result.dashboard?.theme).toBe('dark')
    expect(result.api?.basePath).toBe('/api')
    expect(result.cli?.name).toBe('myapp')
    expect(result.cli?.vimMode).toBe(true)
  })

  it('provides type safety for configuration', () => {
    // This test verifies that TypeScript types work correctly
    // If the types are wrong, this file will fail to compile
    const config = defineConfig({
      ns: 'myapp.com',
      auth: {
        provider: 'oauth.do', // TypeScript should enforce valid providers
      },
      dashboard: {
        theme: 'auto', // TypeScript should enforce valid themes
      },
      api: {
        rateLimit: {
          limit: 100,
          window: '1h', // TypeScript should enforce valid windows
        },
      },
    })

    expect(config.ns).toBe('myapp.com')
  })

  it('can be used as default export pattern', () => {
    // Simulates: export default defineConfig({ ns: 'myapp.com' })
    const defaultExport = defineConfig({ ns: 'myapp.com' })

    expect(defaultExport).toBeDefined()
    expect(defaultExport.ns).toBe('myapp.com')
  })
})

// =============================================================================
// loadConfig() Function Tests
// =============================================================================

describe('loadConfig()', () => {
  let tempDir: string

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await mkdtemp(join(tmpdir(), 'dotdo-config-test-'))
  })

  afterEach(async () => {
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true })
  })

  it('loads do.config.ts from current working directory', async () => {
    // Create a mock do.config.ts file
    const configContent = `
      export default {
        ns: 'test-app.com',
      }
    `
    await writeFile(join(tempDir, 'do.config.ts'), configContent)

    const config = await loadConfig({ cwd: tempDir })

    expect(config.ns).toBe('test-app.com')
  })

  it('loads do.config.js as fallback', async () => {
    const configContent = `
      module.exports = {
        ns: 'js-app.com',
      }
    `
    await writeFile(join(tempDir, 'do.config.js'), configContent)

    const config = await loadConfig({ cwd: tempDir })

    expect(config.ns).toBe('js-app.com')
  })

  it('prefers do.config.ts over do.config.js', async () => {
    const tsContent = `export default { ns: 'typescript-app.com' }`
    const jsContent = `module.exports = { ns: 'javascript-app.com' }`

    await writeFile(join(tempDir, 'do.config.ts'), tsContent)
    await writeFile(join(tempDir, 'do.config.js'), jsContent)

    const config = await loadConfig({ cwd: tempDir })

    expect(config.ns).toBe('typescript-app.com')
  })

  it('throws ConfigNotFoundError when no config file exists', async () => {
    await expect(loadConfig({ cwd: tempDir })).rejects.toThrow('ConfigNotFoundError')
  })

  it('throws ConfigValidationError for invalid config', async () => {
    const invalidConfig = `
      export default {
        // missing required 'ns' field
        auth: { provider: 'oauth.do' }
      }
    `
    await writeFile(join(tempDir, 'do.config.ts'), invalidConfig)

    await expect(loadConfig({ cwd: tempDir })).rejects.toThrow('ConfigValidationError')
  })

  it('loads config with all properties populated', async () => {
    const fullConfig = `
      export default {
        ns: 'full-app.com',
        envs: {
          staging: 'staging.full-app.com',
          production: 'full-app.com',
        },
        auth: {
          provider: 'oauth.do',
          scopes: ['openid', 'profile'],
        },
        dashboard: {
          title: 'Full App Admin',
          theme: 'dark',
        },
        api: {
          basePath: '/api/v1',
        },
        cli: {
          name: 'fullapp',
          vimMode: true,
        },
      }
    `
    await writeFile(join(tempDir, 'do.config.ts'), fullConfig)

    const config = await loadConfig({ cwd: tempDir })

    expect(config.ns).toBe('full-app.com')
    expect(config.envs?.staging).toBe('staging.full-app.com')
    expect(config.auth?.provider).toBe('oauth.do')
    expect(config.dashboard?.title).toBe('Full App Admin')
    expect(config.api?.basePath).toBe('/api/v1')
    expect(config.cli?.name).toBe('fullapp')
  })

  it('uses process.cwd() when cwd option is not provided', async () => {
    // Mock process.cwd to return our temp dir
    const originalCwd = process.cwd
    process.cwd = () => tempDir

    const configContent = `export default { ns: 'cwd-app.com' }`
    await writeFile(join(tempDir, 'do.config.ts'), configContent)

    try {
      const config = await loadConfig()
      expect(config.ns).toBe('cwd-app.com')
    } finally {
      process.cwd = originalCwd
    }
  })

  it('caches loaded config by default', async () => {
    const configContent = `export default { ns: 'cached-app.com' }`
    await writeFile(join(tempDir, 'do.config.ts'), configContent)

    const config1 = await loadConfig({ cwd: tempDir })
    const config2 = await loadConfig({ cwd: tempDir })

    // Should return the same object reference (cached)
    expect(config1).toBe(config2)
  })

  it('bypasses cache when cache: false option is provided', async () => {
    const configContent = `export default { ns: 'uncached-app.com' }`
    await writeFile(join(tempDir, 'do.config.ts'), configContent)

    const config1 = await loadConfig({ cwd: tempDir, cache: false })
    const config2 = await loadConfig({ cwd: tempDir, cache: false })

    // Should return different object references (not cached)
    expect(config1).not.toBe(config2)
    expect(config1).toEqual(config2)
  })
})

// =============================================================================
// resolveNamespace() Function Tests
// =============================================================================

describe('resolveNamespace()', () => {
  it('returns ns when no env is specified', () => {
    const config: DoConfig = {
      ns: 'myapp.com',
      envs: {
        staging: 'staging.myapp.com',
      },
    }

    const result = resolveNamespace(config)

    expect(result).toBe('myapp.com')
  })

  it('returns ns when env is not in envs', () => {
    const config: DoConfig = {
      ns: 'myapp.com',
      envs: {
        staging: 'staging.myapp.com',
      },
    }

    const result = resolveNamespace(config, 'unknown')

    expect(result).toBe('myapp.com')
  })

  it('returns envs override when env matches', () => {
    const config: DoConfig = {
      ns: 'myapp.com',
      envs: {
        staging: 'staging.myapp.com',
        production: 'prod.myapp.com',
      },
    }

    expect(resolveNamespace(config, 'staging')).toBe('staging.myapp.com')
    expect(resolveNamespace(config, 'production')).toBe('prod.myapp.com')
  })

  it('returns ns when envs is undefined', () => {
    const config: DoConfig = {
      ns: 'myapp.com',
    }

    const result = resolveNamespace(config, 'staging')

    expect(result).toBe('myapp.com')
  })

  it('uses DO_ENV environment variable when env not passed', () => {
    const originalEnv = process.env.DO_ENV
    process.env.DO_ENV = 'staging'

    try {
      const config: DoConfig = {
        ns: 'myapp.com',
        envs: {
          staging: 'staging.myapp.com',
        },
      }

      const result = resolveNamespace(config)

      expect(result).toBe('staging.myapp.com')
    } finally {
      if (originalEnv === undefined) {
        delete process.env.DO_ENV
      } else {
        process.env.DO_ENV = originalEnv
      }
    }
  })

  it('uses NODE_ENV as fallback when DO_ENV not set', () => {
    const originalDoEnv = process.env.DO_ENV
    const originalNodeEnv = process.env.NODE_ENV
    delete process.env.DO_ENV
    process.env.NODE_ENV = 'production'

    try {
      const config: DoConfig = {
        ns: 'myapp.com',
        envs: {
          production: 'prod.myapp.com',
        },
      }

      const result = resolveNamespace(config)

      expect(result).toBe('prod.myapp.com')
    } finally {
      if (originalDoEnv === undefined) {
        delete process.env.DO_ENV
      } else {
        process.env.DO_ENV = originalDoEnv
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalNodeEnv
      }
    }
  })
})

// =============================================================================
// Default Values Tests
// =============================================================================

describe('Default Values', () => {
  it('auth.provider defaults to oauth.do', async () => {
    // When auth is provided but provider is not specified
    const config: DoConfig = {
      ns: 'myapp.com',
      auth: {
        scopes: ['openid'],
      },
    }

    // After loading/processing, provider should default to 'oauth.do'
    // This tests the runtime default application
    expect(config.auth?.provider).toBeUndefined() // Before processing

    // The loadConfig should apply defaults
    // We test this through the applyDefaults utility if exposed,
    // or through loadConfig behavior
  })

  it('api.basePath defaults to /api', () => {
    const config: DoConfig = {
      ns: 'myapp.com',
      api: {
        cors: { origins: ['*'] },
      },
    }

    // basePath should be undefined before defaults are applied
    expect(config.api?.basePath).toBeUndefined()
  })

  it('cli.vimMode defaults to true', () => {
    const config: DoConfig = {
      ns: 'myapp.com',
      cli: {
        name: 'myapp',
      },
    }

    // vimMode should be undefined before defaults are applied
    expect(config.cli?.vimMode).toBeUndefined()
  })

  it('dashboard.theme defaults to auto', () => {
    const config: DoConfig = {
      ns: 'myapp.com',
      dashboard: {
        title: 'My Dashboard',
      },
    }

    // theme should be undefined before defaults are applied
    expect(config.dashboard?.theme).toBeUndefined()
  })

  describe('applyDefaults()', () => {
    // Import the applyDefaults utility if exposed
    // This function should apply all default values to a config

    it('applies all default values to minimal config', async () => {
      // This import will fail until implemented
      const { applyDefaults } = await import('../defaults')

      const minimalConfig: DoConfig = { ns: 'myapp.com' }
      const configWithDefaults = applyDefaults(minimalConfig)

      // Should have default auth provider
      expect(configWithDefaults.auth?.provider).toBe('oauth.do')

      // Should have default API basePath
      expect(configWithDefaults.api?.basePath).toBe('/api')

      // Should have default dashboard theme
      expect(configWithDefaults.dashboard?.theme).toBe('auto')

      // Should have default CLI vimMode
      expect(configWithDefaults.cli?.vimMode).toBe(true)
    })

    it('does not override explicitly set values', async () => {
      const { applyDefaults } = await import('../defaults')

      const config: DoConfig = {
        ns: 'myapp.com',
        auth: { provider: 'auth0' },
        api: { basePath: '/v1' },
        dashboard: { theme: 'dark' },
        cli: { vimMode: false },
      }

      const result = applyDefaults(config)

      expect(result.auth?.provider).toBe('auth0')
      expect(result.api?.basePath).toBe('/v1')
      expect(result.dashboard?.theme).toBe('dark')
      expect(result.cli?.vimMode).toBe(false)
    })
  })
})

// =============================================================================
// Environment Resolution Tests
// =============================================================================

describe('Environment Resolution', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('resolves development namespace for DO_ENV=development', () => {
    process.env.DO_ENV = 'development'

    const config: DoConfig = {
      ns: 'myapp.com',
      envs: {
        development: 'localhost:8787',
        staging: 'staging.myapp.com',
        production: 'myapp.com',
      },
    }

    const ns = resolveNamespace(config)
    expect(ns).toBe('localhost:8787')
  })

  it('resolves staging namespace for DO_ENV=staging', () => {
    process.env.DO_ENV = 'staging'

    const config: DoConfig = {
      ns: 'myapp.com',
      envs: {
        development: 'localhost:8787',
        staging: 'staging.myapp.com',
        production: 'myapp.com',
      },
    }

    const ns = resolveNamespace(config)
    expect(ns).toBe('staging.myapp.com')
  })

  it('resolves production namespace for DO_ENV=production', () => {
    process.env.DO_ENV = 'production'

    const config: DoConfig = {
      ns: 'myapp.com',
      envs: {
        development: 'localhost:8787',
        staging: 'staging.myapp.com',
        production: 'prod.myapp.com',
      },
    }

    const ns = resolveNamespace(config)
    expect(ns).toBe('prod.myapp.com')
  })

  it('falls back to default ns when env not in envs map', () => {
    process.env.DO_ENV = 'testing'

    const config: DoConfig = {
      ns: 'myapp.com',
      envs: {
        development: 'localhost:8787',
        production: 'prod.myapp.com',
      },
    }

    const ns = resolveNamespace(config)
    expect(ns).toBe('myapp.com')
  })

  it('supports custom environment names', () => {
    process.env.DO_ENV = 'preview-pr-123'

    const config: DoConfig = {
      ns: 'myapp.com',
      envs: {
        'preview-pr-123': 'pr-123.preview.myapp.com',
      },
    }

    const ns = resolveNamespace(config)
    expect(ns).toBe('pr-123.preview.myapp.com')
  })
})

// =============================================================================
// Integration Pattern Tests
// =============================================================================

describe('Integration Patterns', () => {
  it('supports typical do.config.ts file pattern', () => {
    // This simulates how a user would write their do.config.ts
    const config = defineConfig({
      ns: 'myapp.com',
      envs: {
        development: 'localhost:8787',
        staging: 'staging.myapp.com',
        production: 'myapp.com',
      },
    })

    expect(config).toBeDefined()
    expect(config.ns).toBe('myapp.com')
  })

  it('supports full configuration pattern', () => {
    const config = defineConfig({
      ns: 'enterprise.com',
      envs: {
        development: 'dev.enterprise.local:8787',
        staging: 'staging.enterprise.com',
        production: 'enterprise.com',
      },
      auth: {
        provider: 'workos',
        clientId: process.env.WORKOS_CLIENT_ID,
        clientSecret: process.env.WORKOS_CLIENT_SECRET,
        scopes: ['openid', 'profile', 'email'],
      },
      dashboard: {
        title: 'Enterprise Admin',
        logo: '/logo.svg',
        theme: 'auto',
        sections: ['data', 'compute', 'platform'],
      },
      api: {
        basePath: '/api/v1',
        openapi: {
          title: 'Enterprise API',
          version: '1.0.0',
        },
        cors: {
          origins: ['https://enterprise.com', 'https://admin.enterprise.com'],
          credentials: true,
        },
        rateLimit: {
          limit: 1000,
          window: '1m',
        },
      },
      cli: {
        name: 'ent',
        vimMode: true,
        keys: {
          quit: 'q',
        },
      },
    })

    expect(config.ns).toBe('enterprise.com')
    expect(config.auth?.provider).toBe('workos')
    expect(config.dashboard?.sections).toContain('data')
    expect(config.api?.rateLimit?.limit).toBe(1000)
    expect(config.cli?.name).toBe('ent')
  })

  it('supports minimal configuration for quick start', () => {
    // Simplest possible configuration
    const config = defineConfig({ ns: 'quick-start.com' })

    expect(config.ns).toBe('quick-start.com')
    expect(config.envs).toBeUndefined()
    expect(config.auth).toBeUndefined()
    expect(config.dashboard).toBeUndefined()
    expect(config.api).toBeUndefined()
    expect(config.cli).toBeUndefined()
  })
})
