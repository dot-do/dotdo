import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { priya, ralph, tom, mark, sally, quinn, enableMockMode, disableMockMode, setMockResponse } from '../index'

describe('Named Agents - Template Literal Interface', () => {
  beforeEach(() => {
    enableMockMode()
  })

  afterEach(() => {
    disableMockMode()
  })
  describe('Basic invocation', () => {
    it('should invoke priya with template literal and return Promise<string>', async () => {
      const result = await priya`define the MVP`

      expect(result).toBeTypeOf('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should invoke ralph with template literal', async () => {
      const result = await ralph`build a login form`

      expect(result).toBeTypeOf('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should invoke tom with template literal', async () => {
      const result = await tom`review this architecture`

      expect(result).toBeTypeOf('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should invoke mark with template literal', async () => {
      const result = await mark`write a launch announcement`

      expect(result).toBeTypeOf('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should invoke sally with template literal', async () => {
      const result = await sally`create a sales pitch`

      expect(result).toBeTypeOf('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should invoke quinn with template literal', async () => {
      const result = await quinn`test this feature`

      expect(result).toBeTypeOf('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('Template interpolation', () => {
    it('should handle variable interpolation in template', async () => {
      const hypothesis = 'AI-powered task management'
      const result = await priya`define the MVP for ${hypothesis}`

      expect(result).toBeTypeOf('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should handle multiple variable interpolations', async () => {
      const feature = 'authentication'
      const framework = 'Hono'
      const result = await ralph`implement ${feature} using ${framework}`

      expect(result).toBeTypeOf('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should handle object interpolation', async () => {
      const spec = { feature: 'login', requirements: ['oauth', '2fa'] }
      const result = await ralph`build ${spec}`

      expect(result).toBeTypeOf('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('Agent personas and roles', () => {
    it('priya should have product role', () => {
      expect(priya.role).toBe('product')
    })

    it('ralph should have engineering role', () => {
      expect(ralph.role).toBe('engineering')
    })

    it('tom should have tech lead role', () => {
      expect(tom.role).toBe('tech-lead')
    })

    it('mark should have marketing role', () => {
      expect(mark.role).toBe('marketing')
    })

    it('sally should have sales role', () => {
      expect(sally.role).toBe('sales')
    })

    it('quinn should have qa role', () => {
      expect(quinn.role).toBe('qa')
    })
  })

  describe('Agent metadata', () => {
    it('priya should have correct name and description', () => {
      expect(priya.name).toBe('Priya')
      expect(priya.description).toContain('Product')
      expect(priya.description).toContain('specs')
    })

    it('ralph should have correct name and description', () => {
      expect(ralph.name).toBe('Ralph')
      expect(ralph.description).toContain('Engineering')
      expect(ralph.description).toContain('builds')
    })

    it('tom should have correct name and description', () => {
      expect(tom.name).toBe('Tom')
      expect(tom.description).toContain('Tech Lead')
      expect(tom.description).toContain('architecture')
    })

    it('mark should have correct name and description', () => {
      expect(mark.name).toBe('Mark')
      expect(mark.description).toContain('Marketing')
      expect(mark.description).toContain('content')
    })

    it('sally should have correct name and description', () => {
      expect(sally.name).toBe('Sally')
      expect(sally.description).toContain('Sales')
      expect(sally.description).toContain('outreach')
    })

    it('quinn should have correct name and description', () => {
      expect(quinn.name).toBe('Quinn')
      expect(quinn.description).toContain('QA')
      expect(quinn.description).toContain('testing')
    })
  })

  describe('Agent chaining', () => {
    it('should chain priya -> ralph workflow', async () => {
      const spec = await priya`define a simple todo app`
      const app = await ralph`build ${spec}`

      expect(spec).toBeTypeOf('string')
      expect(app).toBeTypeOf('string')
      expect(app.length).toBeGreaterThan(0)
    })

    it('should chain priya -> ralph -> tom workflow', async () => {
      const spec = await priya`define authentication feature`
      const implementation = await ralph`implement ${spec}`
      const review = await tom`review ${implementation}`

      expect(spec).toBeTypeOf('string')
      expect(implementation).toBeTypeOf('string')
      expect(review).toBeTypeOf('string')
    })

    it('should support iterative improvement loop', async () => {
      const spec = await priya`define a login form`
      let app = await ralph`build ${spec}`
      const feedback = await tom`review ${app}`
      app = await ralph`improve ${app} per ${feedback}`

      expect(app).toBeTypeOf('string')
      expect(app.length).toBeGreaterThan(0)
    })
  })

  describe('Agent method interface (alternative to template)', () => {
    it('should support functional call syntax as alternative', async () => {
      const result = await priya('define the MVP')

      expect(result).toBeTypeOf('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should support functional call with context object', async () => {
      const result = await ralph({
        task: 'build authentication',
        context: { framework: 'Hono', database: 'D1' }
      })

      expect(result).toBeTypeOf('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('Agent approval methods', () => {
    it('tom should have approve method for tech review', async () => {
      const code = 'function hello() { return "world" }'
      const result = await tom.approve(code)

      expect(result).toHaveProperty('approved')
      expect(typeof result.approved).toBe('boolean')
    })

    it('quinn should have approve method for QA', async () => {
      const feature = { name: 'login', tests: ['unit', 'e2e'] }
      const result = await quinn.approve(feature)

      expect(result).toHaveProperty('approved')
      expect(typeof result.approved).toBe('boolean')
    })
  })

  describe('Error handling', () => {
    it('should handle empty template literal', async () => {
      const result = await priya``

      expect(result).toBeTypeOf('string')
    })

    it('should handle undefined interpolation', async () => {
      const undefined_var = undefined
      const result = await ralph`build ${undefined_var}`

      expect(result).toBeTypeOf('string')
    })

    it('should handle null interpolation', async () => {
      const null_var = null
      const result = await priya`define ${null_var}`

      expect(result).toBeTypeOf('string')
    })
  })

  describe('Agent context and state', () => {
    it('should maintain conversation context across calls', async () => {
      const result1 = await priya`define a todo app`
      const result2 = await priya`add real-time collaboration to that`

      expect(result2).toBeTypeOf('string')
      expect(result2.length).toBeGreaterThan(0)
    })

    it('should allow context reset', async () => {
      await priya`define a todo app`
      priya.reset()
      const result = await priya`what were we talking about?`

      expect(result).toBeTypeOf('string')
    })
  })

  describe('Agent configuration', () => {
    it('should allow temperature configuration', async () => {
      const creative = await mark.withConfig({ temperature: 0.9 })`write a creative tagline`
      const precise = await mark.withConfig({ temperature: 0.1 })`write a precise tagline`

      expect(creative).toBeTypeOf('string')
      expect(precise).toBeTypeOf('string')
    })

    it('should allow max_tokens configuration', async () => {
      const brief = await priya.withConfig({ max_tokens: 100 })`define the MVP`

      expect(brief).toBeTypeOf('string')
      expect(brief.split(' ').length).toBeLessThanOrEqual(150)
    })
  })

  describe('Streaming responses', () => {
    it('should support streaming for long responses', async () => {
      const stream = priya.stream`define a comprehensive product roadmap`
      const chunks: string[] = []

      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks.join('')).toBeTypeOf('string')
    })
  })
})
