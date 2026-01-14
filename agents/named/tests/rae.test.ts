import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rae, enableMockMode, disableMockMode, PERSONAS } from '../index'

/**
 * Helper to check if result is string-like (has toString, length, etc.)
 * Named agents return AgentResultWithTools which is a string-like object
 */
function expectStringLike(result: unknown): void {
  expect(result).toBeDefined()
  expect(typeof (result as { toString: () => string }).toString).toBe('function')
  expect((result as { toString: () => string }).toString().length).toBeGreaterThan(0)
}

describe('Rae - Frontend/React Agent', () => {
  beforeEach(() => {
    enableMockMode()
  })

  afterEach(() => {
    disableMockMode()
  })

  describe('Agent metadata', () => {
    it('should have frontend role', () => {
      expect(rae.role).toBe('frontend')
    })

    it('should have correct name', () => {
      expect(rae.name).toBe('Rae')
    })

    it('should have correct description', () => {
      expect(rae.description).toContain('Frontend')
      expect(rae.description).toContain('React')
    })
  })

  describe('PERSONAS entry', () => {
    it('should have Rae in PERSONAS', () => {
      expect(PERSONAS.rae).toBeDefined()
      expect(PERSONAS.rae.name).toBe('Rae')
      expect(PERSONAS.rae.role).toBe('frontend')
    })

    it('should have React-related instructions', () => {
      expect(PERSONAS.rae.instructions).toContain('React')
      expect(PERSONAS.rae.instructions).toContain('component')
    })
  })

  describe('Template literal invocation', () => {
    it('should invoke rae with template literal and return string-like result', async () => {
      const result = await rae`build a button component`

      expectStringLike(result)
    })

    it('should handle variable interpolation', async () => {
      const componentName = 'Modal'
      const result = await rae`create a ${componentName} component`

      expectStringLike(result)
    })

    it('should handle object interpolation for design specs', async () => {
      const spec = {
        component: 'Card',
        props: ['title', 'children', 'onClick'],
        styling: 'tailwind',
      }
      const result = await rae`implement ${spec}`

      expectStringLike(result)
    })
  })

  describe('Functional call syntax', () => {
    it('should support direct function call', async () => {
      const result = await rae('create a navigation component')

      expectStringLike(result)
    })

    it('should support function call with object', async () => {
      const result = await rae({
        task: 'build form component',
        context: { fields: ['email', 'password'], validation: true },
      })

      expectStringLike(result)
    })
  })

  describe('Agent configuration', () => {
    it('should allow temperature configuration', async () => {
      const creative = await rae.withConfig({ temperature: 0.9 })`design a creative hero section`
      const precise = await rae.withConfig({ temperature: 0.1 })`create a standard form layout`

      expectStringLike(creative)
      expectStringLike(precise)
    })
  })

  describe('Agent chaining with other agents', () => {
    // Import other agents lazily to avoid circular deps
    it('should chain with priya for component specs', async () => {
      const { priya } = await import('../index')
      const spec = await priya`define a dashboard component`
      const component = await rae`build ${spec}`

      expectStringLike(spec)
      expectStringLike(component)
    })

    it('should chain with tom for code review', async () => {
      const { tom } = await import('../index')
      const component = await rae`create a dropdown menu`
      const review = await tom`review ${component}`

      expectStringLike(component)
      expectStringLike(review)
    })
  })

  describe('Streaming responses', () => {
    it('should support streaming for long component implementations', async () => {
      const stream = rae.stream`create a complex data table with sorting and filtering`
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
      await rae`create a button component`
      const result2 = await rae`add a loading state to that`

      expectStringLike(result2)
    })

    it('should allow context reset', async () => {
      await rae`build a sidebar component`
      rae.reset()
      const result = await rae`what were we building?`

      expectStringLike(result)
    })
  })

  describe('Tools availability', () => {
    it('should have access to agent tools', () => {
      expect(rae.tools).toBeDefined()
      expect(Array.isArray(rae.tools)).toBe(true)
    })
  })
})
