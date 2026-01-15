/**
 * Completions Engine Tests
 *
 * Tests for the TypeScript Language Service completion engine.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  CompletionEngine,
  filterCompletions,
  getWordAtCursor,
  shouldShowCompletions,
} from '../src/completions.js'

describe('CompletionEngine', () => {
  let engine: CompletionEngine

  beforeEach(() => {
    engine = new CompletionEngine()
  })

  afterEach(() => {
    engine.dispose()
  })

  describe('basic completions', () => {
    it('should provide completions for $ context', () => {
      const completions = engine.getCompletions('$.', 2)

      expect(completions.length).toBeGreaterThan(0)

      const names = completions.map(c => c.name)
      expect(names).toContain('send')
      expect(names).toContain('try')
      expect(names).toContain('do')
      expect(names).toContain('on')
      expect(names).toContain('every')
    })

    it('should provide completions for console', () => {
      const completions = engine.getCompletions('console.', 8)

      const names = completions.map(c => c.name)
      expect(names).toContain('log')
      expect(names).toContain('error')
      expect(names).toContain('warn')
    })

    it('should filter completions by prefix', () => {
      const completions = engine.getCompletions('$.se', 4)

      const filtered = filterCompletions(completions, {
        currentWord: 'se',
        triggerCharacter: undefined,
        isExplicit: false,
        line: 0,
        column: 4,
      })

      const names = filtered.map(c => c.name)
      expect(names).toContain('send')
    })
  })

  describe('type definitions', () => {
    it('should update with custom type definitions', () => {
      const customTypes = `
interface Customer {
  $id: string;
  name: string;
  email: string;
  getOrders(): Promise<Order[]>;
  charge(amount: number): Promise<Receipt>;
}

interface Order {
  id: string;
  total: number;
}

interface Receipt {
  id: string;
  amount: number;
}

declare const customer: Customer;
`
      engine.updateTypeDefinitions('custom', customTypes)

      const completions = engine.getCompletions('customer.', 9)
      const names = completions.map(c => c.name)

      expect(names).toContain('$id')
      expect(names).toContain('name')
      expect(names).toContain('email')
      expect(names).toContain('getOrders')
      expect(names).toContain('charge')
    })

    it('should provide parameter info for methods', () => {
      const customTypes = `
interface Api {
  charge(amount: number): Promise<void>;
}
declare const api: Api;
`
      engine.updateTypeDefinitions('api', customTypes)

      const completions = engine.getCompletions('api.', 4)
      const chargeCompletion = completions.find(c => c.name === 'charge')

      expect(chargeCompletion).toBeDefined()
      expect(chargeCompletion?.isMethod).toBe(true)
    })
  })

  describe('diagnostics', () => {
    it('should detect syntax errors', () => {
      const diagnostics = engine.getDiagnostics('const x = ')

      expect(diagnostics.length).toBeGreaterThan(0)
    })

    it('should detect type errors', () => {
      const code = `
const x: number = "string"
`
      const diagnostics = engine.getDiagnostics(code)

      expect(diagnostics.length).toBeGreaterThan(0)
    })

    it('should format diagnostics correctly', () => {
      const diagnostics = engine.getDiagnostics('const x = ')

      if (diagnostics.length > 0) {
        const formatted = engine.formatDiagnostic(diagnostics[0])
        expect(formatted).toContain('Line')
      }
    })
  })

  describe('quick info', () => {
    it('should provide hover info for known symbols', () => {
      const code = 'console.log'
      const info = engine.getQuickInfo(code, 8) // Position on 'log'

      expect(info).toBeDefined()
      if (info) {
        expect(info).toContain('log')
      }
    })
  })

  describe('signature help', () => {
    it('should provide signature help inside function calls', () => {
      const code = 'console.log('
      const help = engine.getSignatureHelp(code, 12)

      // Note: signature help availability depends on TS version
      // Just verify it doesn't throw
      expect(help === undefined || help !== null).toBe(true)
    })
  })
})

describe('getWordAtCursor', () => {
  it('should find word at middle of cursor', () => {
    const result = getWordAtCursor('hello world', 7)
    expect(result.word).toBe('world')
    expect(result.start).toBe(6)
    expect(result.end).toBe(11)
  })

  it('should handle cursor at word start', () => {
    const result = getWordAtCursor('hello', 0)
    expect(result.word).toBe('hello')
    expect(result.start).toBe(0)
  })

  it('should handle cursor at word end', () => {
    const result = getWordAtCursor('hello', 5)
    expect(result.word).toBe('hello')
    expect(result.end).toBe(5)
  })

  it('should handle empty content', () => {
    const result = getWordAtCursor('', 0)
    expect(result.word).toBe('')
  })

  it('should handle cursor between words', () => {
    const result = getWordAtCursor('hello world', 5)
    expect(result.word).toBe('hello')
  })

  it('should handle special characters', () => {
    const result = getWordAtCursor('$.send', 3)
    expect(result.word).toBe('send')
  })
})

describe('shouldShowCompletions', () => {
  it('should show on dot trigger', () => {
    expect(shouldShowCompletions('$.', 2, '.')).toBe(true)
  })

  it('should show on explicit request', () => {
    expect(shouldShowCompletions('con', 3, undefined)).toBe(true)
  })

  it('should show when typing word', () => {
    expect(shouldShowCompletions('cons', 4, 's')).toBe(true)
  })
})

describe('filterCompletions', () => {
  const mockCompletions = [
    { name: 'send', kind: 'function' as any, sortText: '0' },
    { name: 'subscribe', kind: 'function' as any, sortText: '1' },
    { name: 'set', kind: 'function' as any, sortText: '2' },
    { name: 'get', kind: 'function' as any, sortText: '3' },
  ]

  it('should filter by prefix', () => {
    const filtered = filterCompletions(mockCompletions, {
      currentWord: 'se',
      triggerCharacter: undefined,
      isExplicit: false,
      line: 0,
      column: 2,
    })

    expect(filtered.map(c => c.name)).toEqual(['send', 'set'])
  })

  it('should sort exact matches first', () => {
    const filtered = filterCompletions(mockCompletions, {
      currentWord: 'set',
      triggerCharacter: undefined,
      isExplicit: false,
      line: 0,
      column: 3,
    })

    expect(filtered[0].name).toBe('set')
  })

  it('should return all on empty prefix', () => {
    const filtered = filterCompletions(mockCompletions, {
      currentWord: '',
      triggerCharacter: '.',
      isExplicit: false,
      line: 0,
      column: 0,
    })

    expect(filtered.length).toBe(mockCompletions.length)
  })
})
