/**
 * DOWithPrimitives Preset Tests
 *
 * Tests for the pre-composed DO class that includes all extended primitives:
 * - $.fs: Filesystem operations
 * - $.git: Git version control
 * - $.bash: Shell execution
 * - $.npm: Package management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DO } from '../core/DO'
import { DOWithPrimitives, DOWithAllPrimitives } from '../presets/primitives'

// Mock DurableObjectState
const createMockState = () => ({
  id: { toString: () => 'test-id-123' } as DurableObjectId,
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue(new Map()),
    sql: {
      exec: vi.fn().mockReturnValue({ results: [] }),
      raw: vi.fn().mockReturnValue([]),
    },
  },
  blockConcurrencyWhile: vi.fn(async (fn) => fn()),
  waitUntil: vi.fn(),
})

// Mock environment
const createMockEnv = () => ({
  R2_BUCKET: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue({ objects: [] }),
  },
})

describe('DOWithPrimitives Preset', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
  })

  describe('Class Structure', () => {
    it('should export DOWithPrimitives class', () => {
      expect(DOWithPrimitives).toBeDefined()
      expect(typeof DOWithPrimitives).toBe('function')
    })

    it('should export DOWithAllPrimitives alias', () => {
      expect(DOWithAllPrimitives).toBeDefined()
      expect(DOWithAllPrimitives).toBe(DOWithPrimitives)
    })

    it('should extend DO base class', () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(instance).toBeInstanceOf(DO)
    })

    it('should have static $type', () => {
      expect(DOWithPrimitives.$type).toBe('DOWithPrimitives')
    })

    it('should have static capabilities array', () => {
      expect(DOWithPrimitives.capabilities).toContain('fs')
      expect(DOWithPrimitives.capabilities).toContain('git')
      expect(DOWithPrimitives.capabilities).toContain('bash')
      expect(DOWithPrimitives.capabilities).toContain('npm')
    })
  })

  describe('Workflow Context ($)', () => {
    it('should have $.fs capability', () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(instance.$.fs).toBeDefined()
    })

    it('should have $.git capability', () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(instance.$.git).toBeDefined()
    })

    it('should have $.bash capability', () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(instance.$.bash).toBeDefined()
    })

    it('should have $.npm capability', () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(instance.$.npm).toBeDefined()
    })

    it('should have all base $ properties', () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      // Base $ properties from DO - check they're accessible via proxy
      expect(instance.$.send).toBeDefined()
      expect(instance.$.try).toBeDefined()
      expect(instance.$.do).toBeDefined()
      expect(instance.$.on).toBeDefined()
      expect(instance.$.every).toBeDefined()
    })
  })

  describe('Filesystem Operations', () => {
    it('should provide $.fs.read()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.fs.read).toBe('function')
    })

    it('should provide $.fs.write()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.fs.write).toBe('function')
    })

    it('should provide $.fs.exists()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.fs.exists).toBe('function')
    })

    it('should provide $.fs.list()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.fs.list).toBe('function')
    })

    it('should provide $.fs.delete()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.fs.delete).toBe('function')
    })

    it('should provide $.fs.mkdir()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.fs.mkdir).toBe('function')
    })
  })

  describe('Git Operations', () => {
    it('should provide $.git.status()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.git.status).toBe('function')
    })

    it('should provide $.git.add()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.git.add).toBe('function')
    })

    it('should provide $.git.commit()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.git.commit).toBe('function')
    })

    it('should provide $.git.configure()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.git.configure).toBe('function')
    })

    it('should provide $.git.sync()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.git.sync).toBe('function')
    })
  })

  describe('Bash Operations', () => {
    it('should provide $.bash.exec()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.bash.exec).toBe('function')
    })

    it('should provide $.bash template literal', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      // $.bash should be callable as a template literal
      expect(typeof instance.$.bash).toBe('function')
    })

    it('should provide $.bash.analyze()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.bash.analyze).toBe('function')
    })

    it('should provide $.bash.isDangerous()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.bash.isDangerous).toBe('function')
    })
  })

  describe('NPM Operations', () => {
    it('should provide $.npm.resolve()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.npm.resolve).toBe('function')
    })

    it('should provide $.npm.install()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.npm.install).toBe('function')
    })

    it('should provide $.npm.list()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.npm.list).toBe('function')
    })

    it('should provide $.npm.lockfile()', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      expect(typeof instance.$.npm.lockfile).toBe('function')
    })
  })

  describe('Extensibility', () => {
    it('should be extendable for custom DOs', () => {
      class MyBusinessDO extends DOWithPrimitives {
        static readonly $type = 'MyBusinessDO'

        async processFiles(): Promise<string[]> {
          const files = await this.$.fs.list('/')
          return files.map((f) => f.name)
        }
      }

      const instance = new MyBusinessDO(mockState as any, mockEnv)
      expect(instance).toBeInstanceOf(DOWithPrimitives)
      expect(instance).toBeInstanceOf(DO)
      expect(typeof instance.processFiles).toBe('function')
    })

    it('should preserve capabilities when extended', () => {
      class MyBusinessDO extends DOWithPrimitives {
        static readonly $type = 'MyBusinessDO'
      }

      const instance = new MyBusinessDO(mockState as any, mockEnv)
      // Check capabilities are accessible (proxy properties don't enumerate)
      expect(instance.$.fs).toBeDefined()
      expect(instance.$.git).toBeDefined()
      expect(instance.$.bash).toBeDefined()
      expect(instance.$.npm).toBeDefined()
    })

    it('should allow method overrides', () => {
      class MyBusinessDO extends DOWithPrimitives {
        static readonly $type = 'MyBusinessDO'
        customProperty = 'custom'

        async fetch(request: Request): Promise<Response> {
          if (request.url.endsWith('/custom')) {
            return new Response(this.customProperty)
          }
          return super.fetch(request)
        }
      }

      const instance = new MyBusinessDO(mockState as any, mockEnv)
      expect(instance.customProperty).toBe('custom')
    })
  })

  describe('Integration', () => {
    it('should allow git operations on fs-written files', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Configure git
      instance.$.git.configure({
        repo: 'test/repo',
        branch: 'main',
      })

      // Verify both capabilities are accessible
      expect(typeof instance.$.fs.write).toBe('function')
      expect(typeof instance.$.git.add).toBe('function')
    })

    it('should allow bash to interact with fs', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Both capabilities should be available
      expect(typeof instance.$.fs.read).toBe('function')
      expect(typeof instance.$.bash.exec).toBe('function')
    })

    it('should allow npm to use bash for scripts', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Both capabilities should be available
      expect(typeof instance.$.npm.run).toBe('function')
      expect(typeof instance.$.bash.exec).toBe('function')
    })
  })

  describe('Type Safety', () => {
    it('should have proper TypeScript types for $', () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // These should compile without errors
      const fs = instance.$.fs
      const git = instance.$.git
      const bash = instance.$.bash
      const npm = instance.$.npm

      expect(fs).toBeDefined()
      expect(git).toBeDefined()
      expect(bash).toBeDefined()
      expect(npm).toBeDefined()
    })
  })
})
