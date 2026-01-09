/**
 * Tests for FunctionRegistry
 *
 * Tests function registration, discovery, and management:
 * - Registration and retrieval
 * - Type-based filtering
 * - Tag-based filtering
 * - Metadata management
 * - Validation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  FunctionRegistry,
  FunctionNotFoundError,
  FunctionAlreadyExistsError,
  FunctionValidationError,
  getDefaultRegistry,
  createRegistry,
} from '../FunctionRegistry'
import type {
  CodeFunctionConfig,
  GenerativeFunctionConfig,
  AgenticFunctionConfig,
  HumanFunctionConfig,
} from '../BaseFunctionExecutor'

describe('FunctionRegistry', () => {
  let registry: FunctionRegistry

  beforeEach(() => {
    registry = new FunctionRegistry()
  })

  describe('register', () => {
    it('should register a code function', () => {
      const config: CodeFunctionConfig = {
        type: 'code',
        name: 'testFunction',
        handler: () => 'result',
      }

      registry.register(config)

      expect(registry.has('testFunction')).toBe(true)
    })

    it('should register a generative function', () => {
      const config: GenerativeFunctionConfig = {
        type: 'generative',
        name: 'summarize',
        model: 'claude-sonnet-4-20250514',
        prompt: 'Summarize: {{input}}',
      }

      registry.register(config)

      expect(registry.has('summarize')).toBe(true)
    })

    it('should register an agentic function', () => {
      const config: AgenticFunctionConfig = {
        type: 'agentic',
        name: 'researcher',
        model: 'claude-sonnet-4-20250514',
        tools: ['web_search', 'read_url'],
        goal: 'Research {{topic}}',
      }

      registry.register(config)

      expect(registry.has('researcher')).toBe(true)
    })

    it('should register a human function', () => {
      const config: HumanFunctionConfig = {
        type: 'human',
        name: 'approve',
        channel: 'slack',
        prompt: 'Approve request?',
        actions: ['approve', 'reject'],
      }

      registry.register(config)

      expect(registry.has('approve')).toBe(true)
    })

    it('should throw on duplicate registration', () => {
      const config: CodeFunctionConfig = {
        type: 'code',
        name: 'testFunction',
        handler: () => 'result',
      }

      registry.register(config)

      expect(() => registry.register(config)).toThrow(FunctionAlreadyExistsError)
    })

    it('should register with metadata', () => {
      const config: CodeFunctionConfig = {
        type: 'code',
        name: 'testFunction',
        handler: () => 'result',
      }

      registry.register(config, {
        tags: ['tag1', 'tag2'],
        version: '2.0.0',
        author: 'test',
      })

      const fn = registry.get('testFunction')
      expect(fn?.metadata.tags).toEqual(['tag1', 'tag2'])
      expect(fn?.metadata.version).toBe('2.0.0')
      expect(fn?.metadata.author).toBe('test')
    })

    it('should support method chaining', () => {
      const result = registry
        .register({ type: 'code', name: 'fn1', handler: () => {} })
        .register({ type: 'code', name: 'fn2', handler: () => {} })
        .register({ type: 'code', name: 'fn3', handler: () => {} })

      expect(result).toBe(registry)
      expect(registry.list().length).toBe(3)
    })
  })

  describe('registerCode', () => {
    it('should register code function without type property', () => {
      registry.registerCode({
        name: 'myFunction',
        handler: () => 'result',
      })

      const fn = registry.get<CodeFunctionConfig>('myFunction')
      expect(fn?.config.type).toBe('code')
    })
  })

  describe('registerGenerative', () => {
    it('should register generative function without type property', () => {
      registry.registerGenerative({
        name: 'summarizer',
        model: 'claude-sonnet-4-20250514',
        prompt: 'Summarize: {{input}}',
      })

      const fn = registry.get<GenerativeFunctionConfig>('summarizer')
      expect(fn?.config.type).toBe('generative')
    })
  })

  describe('registerAgentic', () => {
    it('should register agentic function without type property', () => {
      registry.registerAgentic({
        name: 'agent',
        model: 'claude-sonnet-4-20250514',
        tools: ['search'],
        goal: 'Find information',
      })

      const fn = registry.get<AgenticFunctionConfig>('agent')
      expect(fn?.config.type).toBe('agentic')
    })
  })

  describe('registerHuman', () => {
    it('should register human function without type property', () => {
      registry.registerHuman({
        name: 'approver',
        channel: 'slack',
        prompt: 'Please approve',
      })

      const fn = registry.get<HumanFunctionConfig>('approver')
      expect(fn?.config.type).toBe('human')
    })
  })

  describe('unregister', () => {
    it('should unregister a function', () => {
      registry.register({
        type: 'code',
        name: 'testFunction',
        handler: () => 'result',
      })

      const result = registry.unregister('testFunction')

      expect(result).toBe(true)
      expect(registry.has('testFunction')).toBe(false)
    })

    it('should return false for non-existent function', () => {
      const result = registry.unregister('nonExistent')
      expect(result).toBe(false)
    })

    it('should remove from type index', () => {
      registry.register({
        type: 'code',
        name: 'testFunction',
        handler: () => 'result',
      })

      registry.unregister('testFunction')

      const codeFunctions = registry.findByType('code')
      expect(codeFunctions).toHaveLength(0)
    })

    it('should remove from tag index', () => {
      registry.register(
        { type: 'code', name: 'testFunction', handler: () => 'result' },
        { tags: ['tag1'] }
      )

      registry.unregister('testFunction')

      const taggedFunctions = registry.findByTag('tag1')
      expect(taggedFunctions).toHaveLength(0)
    })
  })

  describe('get', () => {
    it('should return registered function', () => {
      registry.register({
        type: 'code',
        name: 'testFunction',
        handler: () => 'result',
      })

      const fn = registry.get('testFunction')

      expect(fn).toBeDefined()
      expect(fn?.config.name).toBe('testFunction')
    })

    it('should return undefined for non-existent function', () => {
      const fn = registry.get('nonExistent')
      expect(fn).toBeUndefined()
    })
  })

  describe('getOrThrow', () => {
    it('should return registered function', () => {
      registry.register({
        type: 'code',
        name: 'testFunction',
        handler: () => 'result',
      })

      const fn = registry.getOrThrow('testFunction')

      expect(fn.config.name).toBe('testFunction')
    })

    it('should throw for non-existent function', () => {
      expect(() => registry.getOrThrow('nonExistent')).toThrow(FunctionNotFoundError)
    })
  })

  describe('has', () => {
    it('should return true for registered function', () => {
      registry.register({
        type: 'code',
        name: 'testFunction',
        handler: () => 'result',
      })

      expect(registry.has('testFunction')).toBe(true)
    })

    it('should return false for non-existent function', () => {
      expect(registry.has('nonExistent')).toBe(false)
    })
  })

  describe('list', () => {
    it('should return empty array when no functions registered', () => {
      expect(registry.list()).toEqual([])
    })

    it('should return all registered function names', () => {
      registry.register({ type: 'code', name: 'fn1', handler: () => {} })
      registry.register({ type: 'code', name: 'fn2', handler: () => {} })
      registry.register({ type: 'code', name: 'fn3', handler: () => {} })

      const names = registry.list()

      expect(names).toHaveLength(3)
      expect(names).toContain('fn1')
      expect(names).toContain('fn2')
      expect(names).toContain('fn3')
    })
  })

  describe('find', () => {
    beforeEach(() => {
      registry.register(
        { type: 'code', name: 'codeFn1', handler: () => {} },
        { tags: ['utility', 'sync'] }
      )
      registry.register(
        { type: 'code', name: 'codeFn2', handler: () => {} },
        { tags: ['utility', 'async'] }
      )
      registry.register(
        { type: 'generative', name: 'genFn', model: 'claude', prompt: 'test' },
        { tags: ['ai'] }
      )
      registry.register(
        { type: 'agentic', name: 'agentFn', model: 'claude', tools: [], goal: 'test' },
        { tags: ['ai'], deprecated: true }
      )
      registry.register(
        { type: 'human', name: 'humanFn', channel: 'slack', prompt: 'test' },
        { tags: ['approval'] }
      )
    })

    it('should filter by type', () => {
      const results = registry.find({ type: 'code' })
      expect(results).toHaveLength(2)
      expect(results.every(fn => fn.config.type === 'code')).toBe(true)
    })

    it('should filter by multiple types', () => {
      const results = registry.find({ type: ['code', 'generative'] })
      expect(results).toHaveLength(3)
    })

    it('should filter by tag', () => {
      const results = registry.find({ tags: ['utility'] })
      expect(results).toHaveLength(2)
    })

    it('should filter by name pattern (string)', () => {
      const results = registry.find({ name: 'Fn' })
      expect(results).toHaveLength(5) // All have 'Fn' in name
    })

    it('should filter by name pattern (regex)', () => {
      const results = registry.find({ name: /^code/ })
      expect(results).toHaveLength(2)
    })

    it('should filter by deprecated', () => {
      const results = registry.find({ deprecated: true })
      expect(results).toHaveLength(1)
      expect(results[0].metadata.deprecated).toBe(true)
    })

    it('should combine multiple filters', () => {
      const results = registry.find({ type: 'code', tags: ['utility'] })
      expect(results).toHaveLength(2)
    })
  })

  describe('findByType', () => {
    it('should return functions of specific type', () => {
      registry.register({ type: 'code', name: 'fn1', handler: () => {} })
      registry.register({ type: 'generative', name: 'fn2', model: 'claude', prompt: 'test' })

      const results = registry.findByType('code')

      expect(results).toHaveLength(1)
      expect(results[0].config.type).toBe('code')
    })
  })

  describe('findByTag', () => {
    it('should return functions with specific tag', () => {
      registry.register(
        { type: 'code', name: 'fn1', handler: () => {} },
        { tags: ['tag1'] }
      )
      registry.register(
        { type: 'code', name: 'fn2', handler: () => {} },
        { tags: ['tag2'] }
      )

      const results = registry.findByTag('tag1')

      expect(results).toHaveLength(1)
      expect(results[0].config.name).toBe('fn1')
    })
  })

  describe('findByTags', () => {
    it('should return functions with all specified tags', () => {
      registry.register(
        { type: 'code', name: 'fn1', handler: () => {} },
        { tags: ['a', 'b'] }
      )
      registry.register(
        { type: 'code', name: 'fn2', handler: () => {} },
        { tags: ['a'] }
      )
      registry.register(
        { type: 'code', name: 'fn3', handler: () => {} },
        { tags: ['a', 'b', 'c'] }
      )

      const results = registry.findByTags(['a', 'b'])

      expect(results).toHaveLength(2)
      expect(results.map(fn => fn.config.name)).toContain('fn1')
      expect(results.map(fn => fn.config.name)).toContain('fn3')
    })
  })

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      registry.register({ type: 'code', name: 'fn1', handler: () => {} }, { tags: ['a'] })
      registry.register({ type: 'code', name: 'fn2', handler: () => {} }, { tags: ['a', 'b'] })
      registry.register({ type: 'generative', name: 'fn3', model: 'claude', prompt: 'test' }, { deprecated: true })

      const stats = registry.getStats()

      expect(stats.total).toBe(3)
      expect(stats.byType.code).toBe(2)
      expect(stats.byType.generative).toBe(1)
      expect(stats.byType.agentic).toBe(0)
      expect(stats.byType.human).toBe(0)
      expect(stats.deprecated).toBe(1)
      expect(stats.tags.get('a')).toBe(2)
      expect(stats.tags.get('b')).toBe(1)
    })
  })

  describe('getTags', () => {
    it('should return all registered tags', () => {
      registry.register({ type: 'code', name: 'fn1', handler: () => {} }, { tags: ['a', 'b'] })
      registry.register({ type: 'code', name: 'fn2', handler: () => {} }, { tags: ['c'] })

      const tags = registry.getTags()

      expect(tags).toHaveLength(3)
      expect(tags).toContain('a')
      expect(tags).toContain('b')
      expect(tags).toContain('c')
    })
  })

  describe('updateMetadata', () => {
    it('should update metadata', () => {
      registry.register({ type: 'code', name: 'fn1', handler: () => {} }, { version: '1.0.0' })

      const result = registry.updateMetadata('fn1', { version: '2.0.0', author: 'test' })

      expect(result).toBe(true)
      const fn = registry.get('fn1')
      expect(fn?.metadata.version).toBe('2.0.0')
      expect(fn?.metadata.author).toBe('test')
    })

    it('should update tags correctly', () => {
      registry.register({ type: 'code', name: 'fn1', handler: () => {} }, { tags: ['a', 'b'] })

      registry.updateMetadata('fn1', { tags: ['b', 'c'] })

      expect(registry.findByTag('a')).toHaveLength(0)
      expect(registry.findByTag('b')).toHaveLength(1)
      expect(registry.findByTag('c')).toHaveLength(1)
    })

    it('should return false for non-existent function', () => {
      const result = registry.updateMetadata('nonExistent', { version: '2.0.0' })
      expect(result).toBe(false)
    })
  })

  describe('deprecate', () => {
    it('should mark function as deprecated', () => {
      registry.register({ type: 'code', name: 'fn1', handler: () => {} })

      const result = registry.deprecate('fn1', 'Use fn2 instead')

      expect(result).toBe(true)
      const fn = registry.get('fn1')
      expect(fn?.metadata.deprecated).toBe(true)
      expect(fn?.metadata.deprecationMessage).toBe('Use fn2 instead')
    })
  })

  describe('clear', () => {
    it('should remove all functions', () => {
      registry.register({ type: 'code', name: 'fn1', handler: () => {} })
      registry.register({ type: 'code', name: 'fn2', handler: () => {} })

      registry.clear()

      expect(registry.list()).toHaveLength(0)
      expect(registry.getStats().total).toBe(0)
    })
  })

  describe('toJSON / fromJSON', () => {
    it('should export and import registry', () => {
      registry.register(
        { type: 'code', name: 'fn1', handler: () => {} },
        { tags: ['test'] }
      )

      const json = registry.toJSON()
      const newRegistry = new FunctionRegistry()

      // Note: handler functions can't be serialized, so we need to handle that
      const dataWithHandler = {
        functions: json.functions.map(f => ({
          ...f,
          config: { ...f.config, handler: () => {} }
        }))
      }

      newRegistry.fromJSON(dataWithHandler)

      expect(newRegistry.has('fn1')).toBe(true)
      expect(newRegistry.findByTag('test')).toHaveLength(1)
    })
  })

  describe('validation', () => {
    it('should reject invalid function names', () => {
      expect(() => registry.register({
        type: 'code',
        name: '123invalid',
        handler: () => {},
      })).toThrow(FunctionValidationError)
    })

    it('should reject names with special characters', () => {
      expect(() => registry.register({
        type: 'code',
        name: 'invalid-name',
        handler: () => {},
      })).toThrow(FunctionValidationError)
    })

    it('should accept valid names', () => {
      expect(() => registry.register({
        type: 'code',
        name: 'valid_name123',
        handler: () => {},
      })).not.toThrow()

      expect(() => registry.register({
        type: 'code',
        name: '_startWithUnderscore',
        handler: () => {},
      })).not.toThrow()
    })

    it('should reject code function without handler', () => {
      expect(() => registry.register({
        type: 'code',
        name: 'noHandler',
        handler: undefined as unknown as () => void,
      })).toThrow(FunctionValidationError)
    })

    it('should reject generative function without model', () => {
      expect(() => registry.register({
        type: 'generative',
        name: 'noModel',
        model: '',
        prompt: 'test',
      })).toThrow(FunctionValidationError)
    })

    it('should reject generative function without prompt', () => {
      expect(() => registry.register({
        type: 'generative',
        name: 'noPrompt',
        model: 'claude',
        prompt: '',
      })).toThrow(FunctionValidationError)
    })

    it('should reject agentic function without goal', () => {
      expect(() => registry.register({
        type: 'agentic',
        name: 'noGoal',
        model: 'claude',
        tools: [],
        goal: '',
      })).toThrow(FunctionValidationError)
    })

    it('should reject human function without channel', () => {
      expect(() => registry.register({
        type: 'human',
        name: 'noChannel',
        channel: '',
        prompt: 'test',
      })).toThrow(FunctionValidationError)
    })
  })

  describe('factory functions', () => {
    it('getDefaultRegistry should return singleton', () => {
      const r1 = getDefaultRegistry()
      const r2 = getDefaultRegistry()
      expect(r1).toBe(r2)
    })

    it('createRegistry should return new instance', () => {
      const r1 = createRegistry()
      const r2 = createRegistry()
      expect(r1).not.toBe(r2)
    })
  })
})
