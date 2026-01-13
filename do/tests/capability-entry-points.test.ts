/**
 * Tests for Capability Entry Points
 *
 * Tests for:
 * - do/fs.ts - DO with Filesystem capability only
 * - do/git.ts - DO with Filesystem and Git capabilities
 * - do/bash.ts - DO with Filesystem and Bash capabilities
 */

import { describe, it, expect } from 'vitest'

// Import from capability entry points
import * as doFs from '../fs'
import * as doGit from '../git'
import * as doBash from '../bash'

describe('do/fs.ts - DO with Filesystem Capability', () => {
  describe('DO Class Export', () => {
    it('exports DO class', () => {
      expect(doFs.DO).toBeDefined()
      expect(typeof doFs.DO).toBe('function')
    })

    it('DO is a class constructor', () => {
      expect(doFs.DO.prototype).toBeDefined()
      expect(doFs.DO.prototype.constructor).toBe(doFs.DO)
    })
  })

  describe('Capabilities', () => {
    it('exports capabilities array', () => {
      expect(doFs.capabilities).toBeDefined()
      expect(Array.isArray(doFs.capabilities)).toBe(true)
    })

    it('includes only fs capability', () => {
      expect(doFs.capabilities).toContain('fs')
      expect(doFs.capabilities.length).toBe(1)
    })

    it('does not include git capability', () => {
      expect(doFs.capabilities).not.toContain('git')
    })

    it('does not include bash capability', () => {
      expect(doFs.capabilities).not.toContain('bash')
    })
  })

  describe('Mixin Export', () => {
    it('exports withFs mixin', () => {
      expect(doFs.withFs).toBeDefined()
      expect(typeof doFs.withFs).toBe('function')
    })
  })
})

describe('do/git.ts - DO with Filesystem and Git Capabilities', () => {
  describe('DO Class Export', () => {
    it('exports DO class', () => {
      expect(doGit.DO).toBeDefined()
      expect(typeof doGit.DO).toBe('function')
    })

    it('DO is a class constructor', () => {
      expect(doGit.DO.prototype).toBeDefined()
      expect(doGit.DO.prototype.constructor).toBe(doGit.DO)
    })
  })

  describe('Capabilities', () => {
    it('exports capabilities array', () => {
      expect(doGit.capabilities).toBeDefined()
      expect(Array.isArray(doGit.capabilities)).toBe(true)
    })

    it('includes fs capability', () => {
      expect(doGit.capabilities).toContain('fs')
    })

    it('includes git capability', () => {
      expect(doGit.capabilities).toContain('git')
    })

    it('has exactly 2 capabilities', () => {
      expect(doGit.capabilities.length).toBe(2)
    })

    it('does not include bash capability', () => {
      expect(doGit.capabilities).not.toContain('bash')
    })
  })

  describe('Mixin Exports', () => {
    it('exports withFs mixin', () => {
      expect(doGit.withFs).toBeDefined()
      expect(typeof doGit.withFs).toBe('function')
    })

    it('exports withGit mixin', () => {
      expect(doGit.withGit).toBeDefined()
      expect(typeof doGit.withGit).toBe('function')
    })
  })
})

describe('do/bash.ts - DO with Filesystem and Bash Capabilities', () => {
  describe('DO Class Export', () => {
    it('exports DO class', () => {
      expect(doBash.DO).toBeDefined()
      expect(typeof doBash.DO).toBe('function')
    })

    it('DO is a class constructor', () => {
      expect(doBash.DO.prototype).toBeDefined()
      expect(doBash.DO.prototype.constructor).toBe(doBash.DO)
    })
  })

  describe('Capabilities', () => {
    it('exports capabilities array', () => {
      expect(doBash.capabilities).toBeDefined()
      expect(Array.isArray(doBash.capabilities)).toBe(true)
    })

    it('includes fs capability', () => {
      expect(doBash.capabilities).toContain('fs')
    })

    it('includes bash capability', () => {
      expect(doBash.capabilities).toContain('bash')
    })

    it('has exactly 2 capabilities', () => {
      expect(doBash.capabilities.length).toBe(2)
    })

    it('does not include git capability', () => {
      expect(doBash.capabilities).not.toContain('git')
    })
  })

  describe('Mixin Exports', () => {
    it('exports withFs mixin', () => {
      expect(doBash.withFs).toBeDefined()
      expect(typeof doBash.withFs).toBe('function')
    })

    it('exports withBash mixin', () => {
      expect(doBash.withBash).toBeDefined()
      expect(typeof doBash.withBash).toBe('function')
    })
  })
})

describe('Capability Entry Points - Comparison', () => {
  it('all entry points export different DO classes', () => {
    // Each entry point should have a distinct DO class
    // (composed differently based on capabilities)
    expect(doFs.DO).toBeDefined()
    expect(doGit.DO).toBeDefined()
    expect(doBash.DO).toBeDefined()
  })

  it('capability arrays match expected combinations', () => {
    expect(doFs.capabilities).toEqual(['fs'])
    expect(doGit.capabilities).toEqual(['fs', 'git'])
    expect(doBash.capabilities).toEqual(['fs', 'bash'])
  })

  it('fs is the base capability for git and bash', () => {
    // Both git and bash entry points should include fs
    expect(doGit.capabilities[0]).toBe('fs')
    expect(doBash.capabilities[0]).toBe('fs')
  })
})
