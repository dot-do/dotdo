/**
 * Tests for polymorphic.ts
 *
 * Comprehensive test coverage for polymorphic collection utilities:
 * 1. TypeRegistry - Type hierarchy management
 * 2. buildTypeFilter - Query filter generation
 * 3. isType - Type guard for discriminated unions
 * 4. assertType - Type assertion helper
 * 5. matchType - Pattern matching for discriminated unions
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  TypeRegistry,
  buildTypeFilter,
  isType,
  assertType,
  matchType,
  type TypeDefinition,
  type CodeFunction,
  type GenerativeFunction,
  type AgenticFunction,
  type HumanFunction,
  type FunctionType,
} from '../src/polymorphic'

describe('TypeRegistry', () => {
  let registry: TypeRegistry

  beforeEach(() => {
    registry = new TypeRegistry()
  })

  describe('register', () => {
    it('should register a simple type', () => {
      const definition: TypeDefinition = {
        $type: 'User',
        name: 'string!',
        email: 'string!',
      }

      registry.register(definition)

      const entry = registry.get('User')
      expect(entry).toBeDefined()
      expect(entry?.definition).toBe(definition)
      expect(entry?.parent).toBeUndefined()
      expect(entry?.children).toEqual([])
      expect(entry?.ancestors).toEqual([])
      expect(entry?.descendants).toEqual([])
    })

    it('should register a type that extends another', () => {
      registry.register({
        $type: 'Function',
        $abstract: true,
        name: 'string!',
      })

      registry.register({
        $type: 'CodeFunction',
        $extends: 'Function',
        code: 'string!',
      })

      const functionEntry = registry.get('Function')
      const codeEntry = registry.get('CodeFunction')

      expect(functionEntry?.children).toContain('CodeFunction')
      expect(functionEntry?.descendants).toContain('CodeFunction')
      expect(codeEntry?.parent).toBe('Function')
      expect(codeEntry?.ancestors).toContain('Function')
    })

    it('should handle multi-level inheritance', () => {
      registry.register({ $type: 'Base', $abstract: true })
      registry.register({ $type: 'Middle', $extends: 'Base', $abstract: true })
      registry.register({ $type: 'Leaf', $extends: 'Middle' })

      const baseEntry = registry.get('Base')
      const middleEntry = registry.get('Middle')
      const leafEntry = registry.get('Leaf')

      expect(baseEntry?.descendants).toContain('Middle')
      expect(baseEntry?.descendants).toContain('Leaf')
      expect(middleEntry?.ancestors).toEqual(['Base'])
      expect(middleEntry?.descendants).toContain('Leaf')
      expect(leafEntry?.ancestors).toEqual(['Middle', 'Base'])
    })
  })

  describe('get', () => {
    it('should return undefined for unregistered type', () => {
      expect(registry.get('NonExistent')).toBeUndefined()
    })

    it('should return entry for registered type', () => {
      registry.register({ $type: 'Test' })
      expect(registry.get('Test')).toBeDefined()
    })
  })

  describe('isSubtypeOf', () => {
    beforeEach(() => {
      registry.register({ $type: 'Animal', $abstract: true })
      registry.register({ $type: 'Dog', $extends: 'Animal' })
      registry.register({ $type: 'Cat', $extends: 'Animal' })
    })

    it('should return true for same type', () => {
      expect(registry.isSubtypeOf('Dog', 'Dog')).toBe(true)
    })

    it('should return true for direct subtype', () => {
      expect(registry.isSubtypeOf('Dog', 'Animal')).toBe(true)
    })

    it('should return false for non-subtype', () => {
      expect(registry.isSubtypeOf('Dog', 'Cat')).toBe(false)
    })

    it('should return false for unregistered type', () => {
      expect(registry.isSubtypeOf('Unknown', 'Animal')).toBe(false)
    })

    it('should return false when parent is not ancestor', () => {
      expect(registry.isSubtypeOf('Animal', 'Dog')).toBe(false)
    })
  })

  describe('getHierarchy', () => {
    beforeEach(() => {
      registry.register({ $type: 'Function', $abstract: true })
      registry.register({ $type: 'CodeFunction', $extends: 'Function' })
      registry.register({ $type: 'GenerativeFunction', $extends: 'Function' })
    })

    it('should return type and all descendants', () => {
      const hierarchy = registry.getHierarchy('Function')
      expect(hierarchy).toContain('Function')
      expect(hierarchy).toContain('CodeFunction')
      expect(hierarchy).toContain('GenerativeFunction')
      expect(hierarchy).toHaveLength(3)
    })

    it('should return only the type for leaf types', () => {
      const hierarchy = registry.getHierarchy('CodeFunction')
      expect(hierarchy).toEqual(['CodeFunction'])
    })

    it('should return type in array for unknown type', () => {
      const hierarchy = registry.getHierarchy('Unknown')
      expect(hierarchy).toEqual(['Unknown'])
    })
  })

  describe('getBaseType', () => {
    beforeEach(() => {
      registry.register({ $type: 'Root', $abstract: true })
      registry.register({ $type: 'Middle', $extends: 'Root', $abstract: true })
      registry.register({ $type: 'Leaf', $extends: 'Middle' })
    })

    it('should return root type for deeply nested type', () => {
      expect(registry.getBaseType('Leaf')).toBe('Root')
    })

    it('should return same type for root type', () => {
      expect(registry.getBaseType('Root')).toBe('Root')
    })

    it('should return same type for unknown type', () => {
      expect(registry.getBaseType('Unknown')).toBe('Unknown')
    })
  })

  describe('getAllTypes', () => {
    it('should return empty array for empty registry', () => {
      expect(registry.getAllTypes()).toEqual([])
    })

    it('should return all registered types', () => {
      registry.register({ $type: 'A' })
      registry.register({ $type: 'B' })
      registry.register({ $type: 'C' })

      const types = registry.getAllTypes()
      expect(types).toContain('A')
      expect(types).toContain('B')
      expect(types).toContain('C')
      expect(types).toHaveLength(3)
    })
  })
})

describe('buildTypeFilter', () => {
  let registry: TypeRegistry

  beforeEach(() => {
    registry = new TypeRegistry()
    registry.register({ $type: 'Function', $abstract: true })
    registry.register({ $type: 'CodeFunction', $extends: 'Function' })
    registry.register({ $type: 'GenerativeFunction', $extends: 'Function' })
  })

  it('should return specific subtypes when provided', () => {
    const filter = buildTypeFilter(registry, {
      type: 'Function',
      subtypes: ['CodeFunction'],
    })
    expect(filter).toEqual(['CodeFunction'])
  })

  it('should return full hierarchy for abstract types', () => {
    const filter = buildTypeFilter(registry, { type: 'Function' })
    expect(filter).toContain('Function')
    expect(filter).toContain('CodeFunction')
    expect(filter).toContain('GenerativeFunction')
  })

  it('should return only the type for concrete types by default', () => {
    const filter = buildTypeFilter(registry, { type: 'CodeFunction' })
    expect(filter).toEqual(['CodeFunction'])
  })

  it('should include subtypes when explicitly requested for concrete types', () => {
    registry.register({ $type: 'SpecialCodeFunction', $extends: 'CodeFunction' })
    const filter = buildTypeFilter(registry, {
      type: 'CodeFunction',
      includeSubtypes: true,
    })
    expect(filter).toContain('CodeFunction')
    expect(filter).toContain('SpecialCodeFunction')
  })

  it('should return type in array for unknown type', () => {
    const filter = buildTypeFilter(registry, { type: 'Unknown' })
    expect(filter).toEqual(['Unknown'])
  })
})

describe('isType', () => {
  it('should return true when $type matches', () => {
    const codeFn: FunctionType = {
      $type: 'CodeFunction',
      name: 'test',
      input: {},
      output: {},
      runtime: 'js',
      code: 'return 1',
    }
    expect(isType(codeFn, 'CodeFunction')).toBe(true)
  })

  it('should return false when $type does not match', () => {
    const codeFn: FunctionType = {
      $type: 'CodeFunction',
      name: 'test',
      input: {},
      output: {},
      runtime: 'js',
      code: 'return 1',
    }
    expect(isType(codeFn, 'GenerativeFunction')).toBe(false)
  })

  it('should narrow type correctly', () => {
    const fn: FunctionType = {
      $type: 'GenerativeFunction',
      name: 'gen',
      input: {},
      output: {},
      model: 'gpt-4',
      prompt: 'Hello',
    }

    if (isType(fn, 'GenerativeFunction')) {
      // TypeScript should know fn has model and prompt
      expect(fn.model).toBe('gpt-4')
      expect(fn.prompt).toBe('Hello')
    }
  })
})

describe('assertType', () => {
  it('should return value when type matches', () => {
    const codeFn: FunctionType = {
      $type: 'CodeFunction',
      name: 'test',
      input: {},
      output: {},
      runtime: 'js',
      code: 'return 1',
    }
    const result = assertType(codeFn, 'CodeFunction')
    expect(result).toBe(codeFn)
    expect(result.runtime).toBe('js')
  })

  it('should throw when type does not match', () => {
    const codeFn: FunctionType = {
      $type: 'CodeFunction',
      name: 'test',
      input: {},
      output: {},
      runtime: 'js',
      code: 'return 1',
    }
    expect(() => assertType(codeFn, 'GenerativeFunction')).toThrow(
      "Expected type 'GenerativeFunction', got 'CodeFunction'"
    )
  })
})

describe('matchType', () => {
  const createCodeFunction = (): CodeFunction => ({
    $type: 'CodeFunction',
    name: 'code',
    input: {},
    output: {},
    runtime: 'ts',
    code: 'return true',
  })

  const createGenerativeFunction = (): GenerativeFunction => ({
    $type: 'GenerativeFunction',
    name: 'gen',
    input: {},
    output: {},
    model: 'claude-3',
    prompt: 'Test prompt',
  })

  const createAgenticFunction = (): AgenticFunction => ({
    $type: 'AgenticFunction',
    name: 'agent',
    input: {},
    output: {},
    agent: 'agent-1',
    tools: ['tool1', 'tool2'],
  })

  const createHumanFunction = (): HumanFunction => ({
    $type: 'HumanFunction',
    name: 'human',
    input: {},
    output: {},
  })

  it('should call matching handler', () => {
    const fn: FunctionType = createCodeFunction()
    const result = matchType(fn, {
      CodeFunction: (f) => `Code: ${f.runtime}`,
      GenerativeFunction: (f) => `AI: ${f.model}`,
    })
    expect(result).toBe('Code: ts')
  })

  it('should call default handler when no match', () => {
    const fn: FunctionType = createAgenticFunction()
    const result = matchType(fn, {
      CodeFunction: (f) => `Code: ${f.runtime}`,
      _: (f) => `Unknown: ${f.$type}`,
    })
    expect(result).toBe('Unknown: AgenticFunction')
  })

  it('should return undefined when no handler matches and no default', () => {
    const fn: FunctionType = createHumanFunction()
    const result = matchType(fn, {
      CodeFunction: (f) => `Code: ${f.runtime}`,
      GenerativeFunction: (f) => `AI: ${f.model}`,
    })
    expect(result).toBeUndefined()
  })

  it('should handle all function types', () => {
    const handlers = {
      CodeFunction: (f: CodeFunction) => `code:${f.runtime}`,
      GenerativeFunction: (f: GenerativeFunction) => `gen:${f.model}`,
      AgenticFunction: (f: AgenticFunction) => `agent:${f.agent}`,
      HumanFunction: (f: HumanFunction) => `human:${f.assignee ?? 'unassigned'}`,
    }

    expect(matchType(createCodeFunction(), handlers)).toBe('code:ts')
    expect(matchType(createGenerativeFunction(), handlers)).toBe('gen:claude-3')
    expect(matchType(createAgenticFunction(), handlers)).toBe('agent:agent-1')
    expect(matchType(createHumanFunction(), handlers)).toBe('human:unassigned')
  })
})
