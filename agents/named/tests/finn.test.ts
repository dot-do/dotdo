import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { finn, enableMockMode, disableMockMode, PERSONAS, ROLE_DEFINITIONS } from '../index'

/**
 * Helper to check if result is string-like (has toString, length, etc.)
 * Named agents return AgentResultWithTools which is a string-like object
 */
function expectStringLike(result: unknown): void {
  expect(result).toBeDefined()
  expect(typeof (result as { toString: () => string }).toString).toBe('function')
  expect((result as { toString: () => string }).toString().length).toBeGreaterThan(0)
}

describe('Finn - Finance Agent', () => {
  beforeEach(() => {
    enableMockMode()
  })

  afterEach(() => {
    disableMockMode()
  })

  describe('Agent metadata', () => {
    it('should have finance role', () => {
      expect(finn.role).toBe('finance')
    })

    it('should have correct name', () => {
      expect(finn.name).toBe('Finn')
    })

    it('should have correct description', () => {
      expect(finn.description).toContain('Finance')
    })
  })

  describe('PERSONAS entry', () => {
    it('should have Finn in PERSONAS', () => {
      expect(PERSONAS.finn).toBeDefined()
      expect(PERSONAS.finn.name).toBe('Finn')
      expect(PERSONAS.finn.role).toBe('finance')
    })

    it('should have finance-related instructions', () => {
      expect(PERSONAS.finn.instructions).toContain('finance')
    })
  })

  describe('ROLE_DEFINITIONS', () => {
    it('should have finance role defined', () => {
      expect(ROLE_DEFINITIONS.finance).toBeDefined()
      expect(ROLE_DEFINITIONS.finance.role).toBe('finance')
      expect(ROLE_DEFINITIONS.finance.title).toBe('Finance Lead')
    })

    it('should have analytical trait', () => {
      expect(ROLE_DEFINITIONS.finance.traits).toContain('analytical')
    })
  })

  describe('Template literal invocation', () => {
    it('should invoke finn with template literal and return string-like result', async () => {
      const result = await finn`what's our runway?`

      expectStringLike(result)
    })

    it('should handle variable interpolation', async () => {
      const amount = 50000
      const result = await finn`analyze ${amount} in expenses`

      expectStringLike(result)
    })

    it('should handle object interpolation for financial data', async () => {
      const data = {
        revenue: 100000,
        expenses: 75000,
        period: 'Q4 2025',
      }
      const result = await finn`forecast based on ${data}`

      expectStringLike(result)
    })
  })

  describe('Functional call syntax', () => {
    it('should support direct function call', async () => {
      const result = await finn('calculate burn rate')

      expectStringLike(result)
    })

    it('should support function call with object', async () => {
      const result = await finn({
        task: 'analyze P&L',
        context: { quarter: 'Q1', year: 2026 },
      })

      expectStringLike(result)
    })
  })

  describe('Agent configuration', () => {
    it('should allow temperature configuration', async () => {
      const conservative = await finn.withConfig({ temperature: 0.1 })`project next quarter revenue`
      const exploratory = await finn.withConfig({ temperature: 0.7 })`brainstorm cost reduction ideas`

      expectStringLike(conservative)
      expectStringLike(exploratory)
    })
  })

  describe('Agent chaining with other agents', () => {
    it('should chain with priya for budget planning', async () => {
      const { priya } = await import('../index')
      const spec = await priya`define MVP requirements`
      const budget = await finn`estimate budget for ${spec}`

      expectStringLike(spec)
      expectStringLike(budget)
    })

    it('should chain with sally for revenue projections', async () => {
      const { sally } = await import('../index')
      const pipeline = await sally`forecast Q1 sales`
      const projection = await finn`convert ${pipeline} to revenue projection`

      expectStringLike(pipeline)
      expectStringLike(projection)
    })
  })

  describe('Streaming responses', () => {
    it('should support streaming for detailed financial analysis', async () => {
      const stream = finn.stream`create a comprehensive cash flow analysis`
      const chunks: string[] = []

      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks.join('')).toBeTypeOf('string')
    })
  })

  describe('Context and state', () => {
    it('should maintain conversation context across calls', async () => {
      await finn`analyze our current revenue`
      const result2 = await finn`now compare that to last quarter`

      expectStringLike(result2)
    })

    it('should allow context reset', async () => {
      await finn`analyze the financial statements`
      finn.reset()
      const result = await finn`what were we analyzing?`

      expectStringLike(result)
    })
  })

  describe('Tools availability', () => {
    it('should have access to agent tools', () => {
      expect(finn.tools).toBeDefined()
      expect(Array.isArray(finn.tools)).toBe(true)
    })
  })
})
