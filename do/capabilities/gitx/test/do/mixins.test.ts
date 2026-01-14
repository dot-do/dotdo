/**
 * @fileoverview Tests for DO Mixin Functions
 *
 * Tests the withGit mixin function that composes
 * module functionality into Durable Object classes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  withGit,
  type WithGitCapability,
  type WithGitOptions,
  type Constructor,
} from '../../src/do/index'
import { GitModule } from '../../src/do/GitModule'

// ============================================================================
// Mock Base Classes
// ============================================================================

/**
 * Simple base class to simulate a DO
 */
class BaseDO {
  public readonly id: string
  public readonly env: Record<string, unknown>

  constructor(id?: string, env?: Record<string, unknown>) {
    this.id = id ?? 'test-do'
    this.env = env ?? {}
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

// ============================================================================
// withGit Mixin Tests
// ============================================================================

describe('withGit mixin', () => {
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

  it('should pass options to GitModule', () => {
    const DOWithGit = withGit(BaseDO, {
      repo: 'org/repo',
      branch: 'develop',
      path: 'packages/core',
    })
    const instance = new DOWithGit()

    expect(instance.git.binding.repo).toBe('org/repo')
    expect(instance.git.binding.branch).toBe('develop')
    expect(instance.git.binding.path).toBe('packages/core')
  })

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

  it('should create new git instance per DO instance', () => {
    const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
    const instance1 = new DOWithGit()
    const instance2 = new DOWithGit()

    expect(instance1.git).not.toBe(instance2.git)
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
  })
})
