/**
 * Tests for CommandRegistry
 *
 * Provides centralized command metadata management for the tiered execution model.
 * Commands are registered with tier, handler, and capabilities information.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  CommandRegistry,
  createDefaultRegistry,
  type CommandMetadata,
  type CommandCapability,
} from '../../../src/do/registry/command-registry.js'

describe('CommandRegistry', () => {
  let registry: CommandRegistry

  beforeEach(() => {
    registry = new CommandRegistry()
  })

  // ==========================================================================
  // REGISTER TESTS
  // ==========================================================================

  describe('register()', () => {
    it('should register a command with metadata', () => {
      const metadata: CommandMetadata = {
        tier: 1,
        handler: 'native',
        capability: 'fs',
      }

      registry.register('cat', metadata)

      expect(registry.has('cat')).toBe(true)
    })

    it('should register a command with multiple capabilities', () => {
      const metadata: CommandMetadata = {
        tier: 1,
        handler: 'native',
        capabilities: ['fs', 'compute'],
      }

      registry.register('grep', metadata)

      expect(registry.has('grep')).toBe(true)
      const registered = registry.get('grep')
      expect(registered?.capabilities).toContain('fs')
      expect(registered?.capabilities).toContain('compute')
    })

    it('should overwrite existing command registration', () => {
      registry.register('cat', { tier: 1, handler: 'native', capability: 'fs' })
      registry.register('cat', { tier: 2, handler: 'rpc', capability: 'remote' })

      const registered = registry.get('cat')
      expect(registered?.tier).toBe(2)
      expect(registered?.handler).toBe('rpc')
    })

    it('should return the registry instance for chaining', () => {
      const result = registry.register('cat', { tier: 1, handler: 'native' })

      expect(result).toBe(registry)
    })
  })

  // ==========================================================================
  // CLASSIFY TESTS
  // ==========================================================================

  describe('classify()', () => {
    beforeEach(() => {
      // Set up some commands for classification tests
      registry.register('cat', {
        tier: 1,
        handler: 'native',
        capability: 'fs',
        reason: 'Native filesystem operation via FsCapability',
      })
      registry.register('echo', {
        tier: 1,
        handler: 'native',
        capability: 'compute',
        reason: 'Pure computation command',
      })
      registry.register('npm', {
        tier: 2,
        handler: 'rpc',
        capability: 'npm',
        reason: 'RPC service available',
      })
    })

    it('should return TierClassification for registered command', () => {
      const classification = registry.classify('cat')

      expect(classification).toBeDefined()
      expect(classification?.tier).toBe(1)
      expect(classification?.handler).toBe('native')
      expect(classification?.capability).toBe('fs')
      expect(classification?.reason).toContain('filesystem')
    })

    it('should return undefined for unregistered command', () => {
      const classification = registry.classify('unknown-command')

      expect(classification).toBeUndefined()
    })

    it('should handle commands with different tiers', () => {
      const catClassification = registry.classify('cat')
      const npmClassification = registry.classify('npm')

      expect(catClassification?.tier).toBe(1)
      expect(npmClassification?.tier).toBe(2)
    })

    it('should include reason in classification', () => {
      const classification = registry.classify('echo')

      expect(classification?.reason).toBe('Pure computation command')
    })
  })

  // ==========================================================================
  // GET HANDLER TESTS
  // ==========================================================================

  describe('getHandler()', () => {
    beforeEach(() => {
      registry.register('cat', { tier: 1, handler: 'native', capability: 'fs' })
      registry.register('npm', { tier: 2, handler: 'rpc', capability: 'npm' })
      registry.register('python', { tier: 4, handler: 'sandbox', capability: 'container' })
    })

    it('should return handler name for registered command', () => {
      expect(registry.getHandler('cat')).toBe('native')
      expect(registry.getHandler('npm')).toBe('rpc')
      expect(registry.getHandler('python')).toBe('sandbox')
    })

    it('should return undefined for unregistered command', () => {
      expect(registry.getHandler('unknown')).toBeUndefined()
    })
  })

  // ==========================================================================
  // REGISTER ALL (BATCH REGISTRATION) TESTS
  // ==========================================================================

  describe('registerAll()', () => {
    it('should register multiple commands with same metadata', () => {
      const commands = ['cat', 'head', 'tail', 'ls']
      const metadata: CommandMetadata = {
        tier: 1,
        handler: 'native',
        capability: 'fs',
      }

      registry.registerAll(commands, metadata)

      for (const cmd of commands) {
        expect(registry.has(cmd)).toBe(true)
        expect(registry.get(cmd)?.tier).toBe(1)
        expect(registry.get(cmd)?.capability).toBe('fs')
      }
    })

    it('should return the registry instance for chaining', () => {
      const result = registry.registerAll(['echo', 'printf'], {
        tier: 1,
        handler: 'native',
        capability: 'compute',
      })

      expect(result).toBe(registry)
    })

    it('should handle empty array gracefully', () => {
      const result = registry.registerAll([], { tier: 1, handler: 'native' })

      expect(result).toBe(registry)
    })
  })

  // ==========================================================================
  // GET COMMANDS BY TIER TESTS
  // ==========================================================================

  describe('getCommandsByTier()', () => {
    beforeEach(() => {
      registry
        .register('cat', { tier: 1, handler: 'native', capability: 'fs' })
        .register('echo', { tier: 1, handler: 'native', capability: 'compute' })
        .register('npm', { tier: 2, handler: 'rpc', capability: 'npm' })
        .register('python', { tier: 4, handler: 'sandbox', capability: 'container' })
    })

    it('should return all commands for a given tier', () => {
      const tier1Commands = registry.getCommandsByTier(1)

      expect(tier1Commands).toContain('cat')
      expect(tier1Commands).toContain('echo')
      expect(tier1Commands).not.toContain('npm')
      expect(tier1Commands).not.toContain('python')
    })

    it('should return empty array for tier with no commands', () => {
      const tier3Commands = registry.getCommandsByTier(3)

      expect(tier3Commands).toEqual([])
    })
  })

  // ==========================================================================
  // GET COMMANDS BY CAPABILITY TESTS
  // ==========================================================================

  describe('getCommandsByCapability()', () => {
    beforeEach(() => {
      registry
        .register('cat', { tier: 1, handler: 'native', capability: 'fs' })
        .register('ls', { tier: 1, handler: 'native', capability: 'fs' })
        .register('echo', { tier: 1, handler: 'native', capability: 'compute' })
        .register('curl', { tier: 1, handler: 'native', capability: 'http' })
    })

    it('should return all commands with a given capability', () => {
      const fsCommands = registry.getCommandsByCapability('fs')

      expect(fsCommands).toContain('cat')
      expect(fsCommands).toContain('ls')
      expect(fsCommands).not.toContain('echo')
      expect(fsCommands).not.toContain('curl')
    })

    it('should return empty array for capability with no commands', () => {
      const gpuCommands = registry.getCommandsByCapability('gpu')

      expect(gpuCommands).toEqual([])
    })
  })

  // ==========================================================================
  // UTILITY METHODS TESTS
  // ==========================================================================

  describe('utility methods', () => {
    describe('has()', () => {
      it('should return true for registered command', () => {
        registry.register('cat', { tier: 1, handler: 'native' })

        expect(registry.has('cat')).toBe(true)
      })

      it('should return false for unregistered command', () => {
        expect(registry.has('unknown')).toBe(false)
      })
    })

    describe('get()', () => {
      it('should return metadata for registered command', () => {
        const metadata: CommandMetadata = {
          tier: 1,
          handler: 'native',
          capability: 'fs',
        }
        registry.register('cat', metadata)

        const result = registry.get('cat')

        expect(result).toBeDefined()
        expect(result?.tier).toBe(1)
        expect(result?.handler).toBe('native')
      })

      it('should return undefined for unregistered command', () => {
        expect(registry.get('unknown')).toBeUndefined()
      })
    })

    describe('size', () => {
      it('should return number of registered commands', () => {
        expect(registry.size).toBe(0)

        registry.register('cat', { tier: 1, handler: 'native' })
        expect(registry.size).toBe(1)

        registry.register('ls', { tier: 1, handler: 'native' })
        expect(registry.size).toBe(2)
      })
    })

    describe('clear()', () => {
      it('should remove all registered commands', () => {
        registry.register('cat', { tier: 1, handler: 'native' })
        registry.register('ls', { tier: 1, handler: 'native' })

        registry.clear()

        expect(registry.size).toBe(0)
        expect(registry.has('cat')).toBe(false)
        expect(registry.has('ls')).toBe(false)
      })
    })

    describe('commands()', () => {
      it('should return all registered command names', () => {
        registry.register('cat', { tier: 1, handler: 'native' })
        registry.register('ls', { tier: 1, handler: 'native' })
        registry.register('npm', { tier: 2, handler: 'rpc' })

        const commands = registry.commands()

        expect(commands).toContain('cat')
        expect(commands).toContain('ls')
        expect(commands).toContain('npm')
        expect(commands.length).toBe(3)
      })
    })
  })
})

// ============================================================================
// CREATE DEFAULT REGISTRY TESTS
// ============================================================================

describe('createDefaultRegistry()', () => {
  it('should return a pre-populated CommandRegistry', () => {
    const registry = createDefaultRegistry()

    expect(registry).toBeInstanceOf(CommandRegistry)
    expect(registry.size).toBeGreaterThan(0)
  })

  it('should have filesystem commands registered', () => {
    const registry = createDefaultRegistry()

    expect(registry.has('cat')).toBe(true)
    expect(registry.has('ls')).toBe(true)
    expect(registry.has('head')).toBe(true)
    expect(registry.has('tail')).toBe(true)
    expect(registry.has('mkdir')).toBe(true)
    expect(registry.has('cp')).toBe(true)
  })

  it('should classify filesystem commands correctly', () => {
    const registry = createDefaultRegistry()

    const catClassification = registry.classify('cat')
    expect(catClassification?.tier).toBe(1)
    expect(catClassification?.handler).toBe('native')
    expect(catClassification?.capability).toBe('fs')
  })

  it('should have HTTP commands registered', () => {
    const registry = createDefaultRegistry()

    expect(registry.has('curl')).toBe(true)
    expect(registry.has('wget')).toBe(true)

    const curlClassification = registry.classify('curl')
    expect(curlClassification?.capability).toBe('http')
  })

  it('should have crypto commands registered', () => {
    const registry = createDefaultRegistry()

    expect(registry.has('sha256sum')).toBe(true)
    expect(registry.has('md5sum')).toBe(true)
    expect(registry.has('uuidgen')).toBe(true)

    const shaClassification = registry.classify('sha256sum')
    expect(shaClassification?.capability).toBe('crypto')
  })

  it('should have text processing commands registered', () => {
    const registry = createDefaultRegistry()

    expect(registry.has('sed')).toBe(true)
    expect(registry.has('awk')).toBe(true)
    expect(registry.has('diff')).toBe(true)

    const sedClassification = registry.classify('sed')
    expect(sedClassification?.capability).toBe('text')
  })

  it('should have POSIX utility commands registered', () => {
    const registry = createDefaultRegistry()

    expect(registry.has('echo')).toBe(true)
    expect(registry.has('printf')).toBe(true)
    expect(registry.has('date')).toBe(true)
    expect(registry.has('sort')).toBe(true)

    const echoClassification = registry.classify('echo')
    expect(echoClassification?.capability).toBe('posix')
  })

  it('should have npm commands registered', () => {
    const registry = createDefaultRegistry()

    expect(registry.has('npm')).toBe(true)

    const npmClassification = registry.classify('npm')
    expect(npmClassification?.tier).toBe(1)
    expect(npmClassification?.capability).toBe('npm-native')
  })

  it('should have all major command categories', () => {
    const registry = createDefaultRegistry()

    // Check we have commands from each capability
    const fsCommands = registry.getCommandsByCapability('fs')
    const httpCommands = registry.getCommandsByCapability('http')
    const cryptoCommands = registry.getCommandsByCapability('crypto')
    const textCommands = registry.getCommandsByCapability('text')
    const posixCommands = registry.getCommandsByCapability('posix')
    const computeCommands = registry.getCommandsByCapability('compute')

    expect(fsCommands.length).toBeGreaterThan(0)
    expect(httpCommands.length).toBe(2) // curl, wget
    expect(cryptoCommands.length).toBeGreaterThan(0)
    expect(textCommands.length).toBeGreaterThan(0)
    expect(posixCommands.length).toBeGreaterThan(0)
    expect(computeCommands.length).toBeGreaterThan(0)
  })
})
