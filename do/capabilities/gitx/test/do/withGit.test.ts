/**
 * @fileoverview Comprehensive Tests for withGit Mixin Function
 *
 * Tests the withGit mixin function that adds git capability to DO classes.
 * These tests cover:
 * - Basic functionality (git property, GitModule instance)
 * - Lazy initialization
 * - Options handling
 * - R2 binding resolution
 * - Context mode ($.git integration)
 * - Inheritance chain preservation
 * - Type safety
 * - Type guards
 * - Composition with other mixins
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  withGit,
  hasGitCapability,
  type WithGitCapability,
  type WithGitOptions,
  type WithGitContext,
} from '../../src/do/withGit'
import { GitModule, type R2BucketLike } from '../../src/do/GitModule'

// ============================================================================
// Mock Classes and Fixtures
// ============================================================================

/**
 * Simple base class to simulate a Durable Object
 */
class BaseDO {
  public readonly id: string
  public readonly env: Record<string, unknown>
  public readonly $: Record<string, unknown>

  constructor(id?: string, env?: Record<string, unknown>) {
    this.id = id ?? 'test-do'
    this.env = env ?? {}
    this.$ = {}
  }

  async fetch(_request: Request): Promise<Response> {
    return new Response('OK')
  }
}

/**
 * Extended base class with additional functionality
 */
class ExtendedDO extends BaseDO {
  public readonly name: string

  constructor(id?: string, env?: Record<string, unknown>, name?: string) {
    super(id, env)
    this.name = name ?? 'ExtendedDO'
  }

  greet(): string {
    return `Hello from ${this.name}`
  }
}

/**
 * Base class with filesystem capability (simulating withFs mixin)
 */
class BaseDOWithFs extends BaseDO {
  constructor(id?: string, env?: Record<string, unknown>) {
    super(id, env)
    // Simulate $.fs capability
    this.$ = {
      fs: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        readDir: vi.fn(),
        exists: vi.fn(),
        mkdir: vi.fn(),
        rm: vi.fn(),
      },
    }
  }
}

/**
 * Mock R2 bucket for testing
 */
function createMockR2Bucket(): R2BucketLike {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
  }
}

// ============================================================================
// Basic Functionality Tests
// ============================================================================

describe('withGit mixin', () => {
  describe('basic functionality', () => {
    it('should add git property to class', () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      expect(instance.git).toBeDefined()
      expect(instance.git).toBeInstanceOf(GitModule)
    })

    it('should preserve base class properties', () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit('my-id', { key: 'value' })

      expect(instance.id).toBe('my-id')
      expect(instance.env).toEqual({ key: 'value' })
    })

    it('should preserve base class methods', async () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      const response = await instance.fetch(new Request('https://example.com.ai'))
      expect(response).toBeInstanceOf(Response)
      expect(await response.text()).toBe('OK')
    })

    it('should require repo option', () => {
      expect(() => {
        // @ts-expect-error - Testing runtime validation
        withGit(BaseDO, {})
      }).toThrow('withGit: repo option is required')
    })

    it('should return GitModule with correct module name', () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      expect(instance.git.name).toBe('git')
    })
  })

  describe('options handling', () => {
    it('should pass repo option to GitModule', () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      expect(instance.git.binding.repo).toBe('org/repo')
    })

    it('should pass branch option to GitModule', () => {
      const DOWithGit = withGit(BaseDO, {
        repo: 'org/repo',
        branch: 'develop',
      })
      const instance = new DOWithGit()

      expect(instance.git.binding.branch).toBe('develop')
    })

    it('should default branch to main', () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      expect(instance.git.binding.branch).toBe('main')
    })

    it('should pass path option to GitModule', () => {
      const DOWithGit = withGit(BaseDO, {
        repo: 'org/repo',
        path: 'packages/core',
      })
      const instance = new DOWithGit()

      expect(instance.git.binding.path).toBe('packages/core')
    })

    it('should handle all options together', () => {
      const DOWithGit = withGit(BaseDO, {
        repo: 'org/repo',
        branch: 'feature/test',
        path: 'src/lib',
        r2Binding: 'MY_R2',
        objectPrefix: 'custom/objects',
      })
      const instance = new DOWithGit()

      expect(instance.git.binding.repo).toBe('org/repo')
      expect(instance.git.binding.branch).toBe('feature/test')
      expect(instance.git.binding.path).toBe('src/lib')
    })
  })

  describe('lazy initialization', () => {
    it('should not create GitModule until git property is accessed', () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      // Before accessing git, no module should be created
      // We can't directly check the private symbol, but we can verify
      // that accessing git creates a consistent instance
      const git1 = instance.git
      const git2 = instance.git

      // Should be the same instance (lazy-loaded once)
      expect(git1).toBe(git2)
    })

    it('should create new GitModule instance per DO instance', () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance1 = new DOWithGit()
      const instance2 = new DOWithGit()

      expect(instance1.git).not.toBe(instance2.git)
    })

    it('should support auto-init option', async () => {
      const DOWithGit = withGit(BaseDO, {
        repo: 'org/repo',
        autoInit: true,
      })
      const instance = new DOWithGit()

      // With autoInit, git should be immediately accessible
      expect(instance.git).toBeInstanceOf(GitModule)
    })
  })

  describe('R2 binding resolution', () => {
    it('should resolve R2 bucket from default binding name', () => {
      const mockR2 = createMockR2Bucket()
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit('test-id', { R2_BUCKET: mockR2 })

      // Accessing git should pick up R2 from env
      expect(instance.git).toBeInstanceOf(GitModule)
    })

    it('should resolve R2 bucket from custom binding name', () => {
      const mockR2 = createMockR2Bucket()
      const DOWithGit = withGit(BaseDO, {
        repo: 'org/repo',
        r2Binding: 'GIT_OBJECTS',
      })
      const instance = new DOWithGit('test-id', { GIT_OBJECTS: mockR2 })

      expect(instance.git).toBeInstanceOf(GitModule)
    })

    it('should work without R2 bucket', () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      // Should still work, just without R2 functionality
      expect(instance.git).toBeInstanceOf(GitModule)
    })
  })

  describe('filesystem capability resolution', () => {
    it('should pick up fs from $ context', () => {
      const DOWithGit = withGit(BaseDOWithFs, { repo: 'org/repo' })
      const instance = new DOWithGit()

      // Git module should be created with fs capability available
      expect(instance.git).toBeInstanceOf(GitModule)
    })
  })

  describe('context mode ($.git)', () => {
    it('should extend $ context when contextMode is enabled', () => {
      const DOWithGit = withGit(BaseDO, {
        repo: 'org/repo',
        contextMode: true,
      })
      const instance = new DOWithGit()

      // $.git should be accessible
      expect((instance.$ as WithGitContext).git).toBeDefined()
      expect((instance.$ as WithGitContext).git).toBeInstanceOf(GitModule)
    })

    it('should return same GitModule from both this.git and $.git', () => {
      const DOWithGit = withGit(BaseDO, {
        repo: 'org/repo',
        contextMode: true,
      })
      const instance = new DOWithGit()

      expect((instance.$ as WithGitContext).git).toBe(instance.git)
    })

    it('should preserve existing $ properties when contextMode is enabled', () => {
      const DOWithGit = withGit(BaseDOWithFs, {
        repo: 'org/repo',
        contextMode: true,
      })
      const instance = new DOWithGit()

      // fs should still be accessible
      expect((instance.$ as Record<string, unknown>).fs).toBeDefined()
      // git should also be accessible
      expect((instance.$ as WithGitContext).git).toBeDefined()
    })

    it('should not extend $ context when contextMode is disabled', () => {
      const DOWithGit = withGit(BaseDO, {
        repo: 'org/repo',
        contextMode: false,
      })
      const instance = new DOWithGit()

      // $.git should not be set
      expect((instance.$ as Record<string, unknown>).git).toBeUndefined()
    })

    it('should default contextMode to false', () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      // $.git should not be set by default
      expect((instance.$ as Record<string, unknown>).git).toBeUndefined()
    })
  })

  describe('inheritance chain', () => {
    it('should work with extended base classes', () => {
      const DOWithGit = withGit(ExtendedDO, { repo: 'org/repo' })
      const instance = new DOWithGit('test-id', {}, 'MyDO')

      expect(instance.git).toBeInstanceOf(GitModule)
      expect(instance.name).toBe('MyDO')
      expect(instance.greet()).toBe('Hello from MyDO')
    })

    it('should maintain instanceof checks', () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      expect(instance).toBeInstanceOf(BaseDO)
    })

    it('should add capabilities to static array', () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })

      expect((DOWithGit as Record<string, unknown>).capabilities).toContain('git')
    })

    it('should support hasCapability method', () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit() as BaseDO & WithGitCapability & { hasCapability: (name: string) => boolean }

      expect(instance.hasCapability('git')).toBe(true)
      expect(instance.hasCapability('unknown')).toBe(false)
    })
  })

  describe('lifecycle methods', () => {
    it('should provide initializeGit method', async () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit() as BaseDO & WithGitCapability & { initializeGit: () => Promise<void> }

      await expect(instance.initializeGit()).resolves.toBeUndefined()
    })

    it('should provide disposeGit method', async () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit() as BaseDO & WithGitCapability & { disposeGit: () => Promise<void> }

      // Access git to ensure it's created
      expect(instance.git).toBeInstanceOf(GitModule)

      await expect(instance.disposeGit()).resolves.toBeUndefined()
    })

    it('should only initialize once', async () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit() as BaseDO & WithGitCapability & { initializeGit: () => Promise<void> }

      // Call initialize multiple times
      await instance.initializeGit()
      await instance.initializeGit()
      await instance.initializeGit()

      // Should not throw
      expect(instance.git).toBeInstanceOf(GitModule)
    })
  })

  describe('GitModule functionality', () => {
    it('should provide status method', async () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      const status = await instance.git.status()
      expect(status.branch).toBe('main')
      expect(status.staged).toEqual([])
      expect(status.unstaged).toEqual([])
      expect(status.clean).toBe(true)
    })

    it('should provide add method', async () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      await instance.git.add('test.txt')
      const status = await instance.git.status()
      expect(status.staged).toContain('test.txt')
    })

    it('should provide sync method', async () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      const result = await instance.git.sync()
      // Without R2, should return error
      expect(result.success).toBe(false)
      expect(result.error).toContain('R2 bucket not configured')
    })

    it('should provide push method', async () => {
      const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      const result = await instance.git.push()
      // Without R2, should return error
      expect(result.success).toBe(false)
      expect(result.error).toContain('R2 bucket not configured')
    })

    it('should provide binding property', () => {
      const DOWithGit = withGit(BaseDO, {
        repo: 'org/repo',
        branch: 'develop',
        path: 'src',
      })
      const instance = new DOWithGit()

      const binding = instance.git.binding
      expect(binding.repo).toBe('org/repo')
      expect(binding.branch).toBe('develop')
      expect(binding.path).toBe('src')
    })
  })
})

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('hasGitCapability type guard', () => {
  it('should return true for instances with git capability', () => {
    const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
    const instance = new DOWithGit()

    expect(hasGitCapability(instance)).toBe(true)
  })

  it('should return false for instances without git capability', () => {
    const instance = new BaseDO()

    expect(hasGitCapability(instance)).toBe(false)
  })

  it('should return false for null', () => {
    expect(hasGitCapability(null)).toBe(false)
  })

  it('should return false for undefined', () => {
    expect(hasGitCapability(undefined)).toBe(false)
  })

  it('should return false for primitives', () => {
    expect(hasGitCapability('string')).toBe(false)
    expect(hasGitCapability(123)).toBe(false)
    expect(hasGitCapability(true)).toBe(false)
  })

  it('should return false for objects with non-GitModule git property', () => {
    const fakeGit = { git: { notAGitModule: true } }

    expect(hasGitCapability(fakeGit)).toBe(false)
  })

  it('should narrow type correctly', () => {
    const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
    const instance: unknown = new DOWithGit()

    if (hasGitCapability(instance)) {
      // TypeScript should recognize instance.git here
      expect(instance.git.binding.repo).toBe('org/repo')
    }
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('type safety', () => {
  it('should correctly type WithGitCapability', () => {
    const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
    const instance: WithGitCapability = new DOWithGit()

    // TypeScript should recognize git property
    expect(instance.git).toBeDefined()
    expect(instance.git).toBeInstanceOf(GitModule)
  })

  it('should preserve base class type', () => {
    const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
    const instance = new DOWithGit('my-id', { key: 'value' })

    // Should have both BaseDO properties and git
    expect(instance.id).toBe('my-id')
    expect(instance.env).toEqual({ key: 'value' })
    expect(instance.git).toBeInstanceOf(GitModule)
  })

  it('should support interface extension', () => {
    interface MyDOInterface extends WithGitCapability {
      customMethod(): string
    }

    const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })

    class MyDO extends DOWithGit implements MyDOInterface {
      customMethod(): string {
        return `Custom method - repo: ${this.git.binding.repo}`
      }
    }

    const instance = new MyDO()
    expect(instance.customMethod()).toBe('Custom method - repo: org/repo')
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('edge cases and error handling', () => {
  it('should handle empty repo string', () => {
    expect(() => {
      withGit(BaseDO, { repo: '' })
    }).toThrow('withGit: repo option is required')
  })

  it('should handle special characters in repo name', () => {
    const DOWithGit = withGit(BaseDO, { repo: 'org/repo-with-dashes_and_underscores' })
    const instance = new DOWithGit()

    expect(instance.git.binding.repo).toBe('org/repo-with-dashes_and_underscores')
  })

  it('should handle full URL as repo', () => {
    const DOWithGit = withGit(BaseDO, { repo: 'https://github.com/org/repo.git' })
    const instance = new DOWithGit()

    expect(instance.git.binding.repo).toBe('https://github.com/org/repo.git')
  })

  it('should handle branch names with slashes', () => {
    const DOWithGit = withGit(BaseDO, {
      repo: 'org/repo',
      branch: 'feature/nested/branch',
    })
    const instance = new DOWithGit()

    expect(instance.git.binding.branch).toBe('feature/nested/branch')
  })

  it('should handle path with multiple segments', () => {
    const DOWithGit = withGit(BaseDO, {
      repo: 'org/repo',
      path: 'packages/core/src/lib',
    })
    const instance = new DOWithGit()

    expect(instance.git.binding.path).toBe('packages/core/src/lib')
  })
})
