import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { dana } from '../dana'
import { enableMockMode, disableMockMode, PERSONAS } from '../named/factory'

/**
 * Helper to check if result is string-like (has toString, length, etc.)
 * Named agents return AgentResultWithTools which is a string-like object
 */
function expectStringLike(result: unknown): void {
  expect(result).toBeDefined()
  expect(typeof (result as { toString: () => string }).toString).toBe('function')
  expect((result as { toString: () => string }).toString().length).toBeGreaterThan(0)
}

describe('Dana - Data/Analytics Agent', () => {
  beforeEach(() => {
    enableMockMode()
  })

  afterEach(() => {
    disableMockMode()
  })

  describe('Agent metadata', () => {
    it('should have data role', () => {
      expect(dana.role).toBe('data')
    })

    it('should have correct name', () => {
      expect(dana.name).toBe('Dana')
    })

    it('should have correct description', () => {
      expect(dana.description.toLowerCase()).toContain('data')
    })
  })

  describe('PERSONAS entry', () => {
    it('should have Dana in PERSONAS', () => {
      expect(PERSONAS.dana).toBeDefined()
      expect(PERSONAS.dana.name).toBe('Dana')
      expect(PERSONAS.dana.role).toBe('data')
    })

    it('should have data-related instructions', () => {
      expect(PERSONAS.dana.instructions).toContain('data')
      expect(PERSONAS.dana.instructions).toContain('analytics')
    })
  })

  describe('Template literal invocation', () => {
    it('should invoke dana with template literal and return string-like result', async () => {
      const result = await dana`which features have low adoption?`

      expectStringLike(result)
    })

    it('should handle variable interpolation', async () => {
      const metric = 'conversion rate'
      const result = await dana`analyze ${metric} trends`

      expectStringLike(result)
    })

    it('should handle object interpolation for data queries', async () => {
      const query = {
        metrics: ['churn', 'retention', 'arpu'],
        timeframe: 'last 90 days',
        segment: 'enterprise',
      }
      const result = await dana`generate report for ${query}`

      expectStringLike(result)
    })
  })

  describe('Functional call syntax', () => {
    it('should support direct function call', async () => {
      const result = await dana('analyze user engagement metrics')

      expectStringLike(result)
    })

    it('should support function call with object', async () => {
      const result = await dana({
        task: 'cohort analysis',
        context: { cohort: 'Q4 signups', metrics: ['activation', 'retention'] },
      })

      expectStringLike(result)
    })
  })

  describe('Agent configuration', () => {
    it('should allow temperature configuration', async () => {
      const exploratory = await dana.withConfig({ temperature: 0.9 })`explore anomalies in user behavior`
      const precise = await dana.withConfig({ temperature: 0.1 })`calculate exact churn rate`

      expectStringLike(exploratory)
      expectStringLike(precise)
    })
  })

  describe('Streaming responses', () => {
    it('should support streaming for long data reports', async () => {
      const stream = dana.stream`generate comprehensive analytics report`
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
      await dana`analyze feature adoption`
      const result2 = await dana`drill down on the lowest performing feature`

      expectStringLike(result2)
    })

    it('should allow context reset', async () => {
      await dana`track conversion funnel`
      dana.reset()
      const result = await dana`what were we analyzing?`

      expectStringLike(result)
    })
  })

  describe('Tools availability', () => {
    it('should have access to agent tools', () => {
      expect(dana.tools).toBeDefined()
      expect(Array.isArray(dana.tools)).toBe(true)
    })
  })

  describe('Data role routing', () => {
    it('should route data queries to data role', async () => {
      const result = await dana`which features have low adoption?`

      // Dana should respond with data-driven insights
      expectStringLike(result)
      // The response should come from the data role
      expect(dana.role).toBe('data')
    })
  })
})
