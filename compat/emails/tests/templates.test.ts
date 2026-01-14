import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemoryTemplateStorage,
  TemplateRenderer,
  BUILT_IN_TEMPLATES,
  initializeBuiltInTemplates,
  extractVariables,
  validateTemplateData,
} from '../templates'
import type { EmailTemplate } from '../types'

describe('Email Templates', () => {
  describe('InMemoryTemplateStorage', () => {
    let storage: InMemoryTemplateStorage

    beforeEach(() => {
      storage = new InMemoryTemplateStorage()
    })

    it('should store and retrieve templates', async () => {
      const template: EmailTemplate = {
        id: 'test-1',
        name: 'Test Template',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
        created_at: new Date(),
        updated_at: new Date(),
      }

      await storage.set(template)
      const retrieved = await storage.get('test-1')

      expect(retrieved).toEqual(template)
    })

    it('should return null for non-existent templates', async () => {
      const result = await storage.get('non-existent')
      expect(result).toBeNull()
    })

    it('should delete templates', async () => {
      const template: EmailTemplate = {
        id: 'test-1',
        name: 'Test',
        subject: 'Test',
        html: '<p>Hello</p>',
        created_at: new Date(),
        updated_at: new Date(),
      }

      await storage.set(template)
      await storage.delete('test-1')
      const result = await storage.get('test-1')

      expect(result).toBeNull()
    })

    it('should list all templates', async () => {
      const template1: EmailTemplate = {
        id: 'test-1',
        name: 'Template 1',
        subject: 'Subject 1',
        html: '<p>1</p>',
        created_at: new Date(),
        updated_at: new Date(),
      }

      const template2: EmailTemplate = {
        id: 'test-2',
        name: 'Template 2',
        subject: 'Subject 2',
        html: '<p>2</p>',
        created_at: new Date(),
        updated_at: new Date(),
      }

      await storage.set(template1)
      await storage.set(template2)

      const templates = await storage.list()
      expect(templates).toHaveLength(2)
    })

    it('should clear all templates', async () => {
      const template: EmailTemplate = {
        id: 'test-1',
        name: 'Test',
        subject: 'Test',
        html: '<p>Hello</p>',
        created_at: new Date(),
        updated_at: new Date(),
      }

      await storage.set(template)
      storage.clear()
      const templates = await storage.list()

      expect(templates).toHaveLength(0)
    })
  })

  describe('TemplateRenderer', () => {
    let storage: InMemoryTemplateStorage
    let renderer: TemplateRenderer

    beforeEach(() => {
      storage = new InMemoryTemplateStorage()
      renderer = new TemplateRenderer(storage)
    })

    describe('Variable substitution', () => {
      it('should substitute simple variables', () => {
        const result = renderer.renderString('Hello {{name}}!', { name: 'John' })
        expect(result).toBe('Hello John!')
      })

      it('should handle multiple variables', () => {
        const result = renderer.renderString(
          '{{greeting}} {{name}}, welcome to {{company}}!',
          { greeting: 'Hello', name: 'John', company: 'Acme' }
        )
        expect(result).toBe('Hello John, welcome to Acme!')
      })

      it('should handle nested paths', () => {
        const result = renderer.renderString(
          'User: {{user.name}}, Email: {{user.email}}',
          { user: { name: 'John', email: 'john@example.com' } }
        )
        expect(result).toBe('User: John, Email: john@example.com')
      })

      it('should handle missing variables gracefully', () => {
        const result = renderer.renderString('Hello {{name}}!', {})
        expect(result).toBe('Hello !')
      })

      it('should escape HTML when enabled', () => {
        const result = renderer.renderString(
          'Content: {{content}}',
          { content: '<script>alert("xss")</script>' },
          true
        )
        expect(result).toBe('Content: &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
      })
    })

    describe('Conditionals ({{#if}})', () => {
      it('should show content when condition is truthy', () => {
        const result = renderer.renderString(
          '{{#if showGreeting}}Hello!{{/if}}',
          { showGreeting: true }
        )
        expect(result).toBe('Hello!')
      })

      it('should hide content when condition is falsy', () => {
        const result = renderer.renderString(
          '{{#if showGreeting}}Hello!{{/if}}',
          { showGreeting: false }
        )
        expect(result).toBe('')
      })

      it('should handle non-empty arrays as truthy', () => {
        const result = renderer.renderString(
          '{{#if items}}Has items{{/if}}',
          { items: [1, 2, 3] }
        )
        expect(result).toBe('Has items')
      })

      it('should handle empty arrays as falsy', () => {
        const result = renderer.renderString(
          '{{#if items}}Has items{{/if}}',
          { items: [] }
        )
        expect(result).toBe('')
      })

      it('should handle nested variables in conditionals', () => {
        const result = renderer.renderString(
          '{{#if cta_url}}<a href="{{cta_url}}">{{cta_text}}</a>{{/if}}',
          { cta_url: 'https://example.com', cta_text: 'Click here' }
        )
        expect(result).toBe('<a href="https://example.com">Click here</a>')
      })
    })

    describe('Loops ({{#each}})', () => {
      it('should iterate over arrays', () => {
        const result = renderer.renderString(
          '{{#each items}}<li>{{this}}</li>{{/each}}',
          { items: ['apple', 'banana', 'cherry'] }
        )
        expect(result).toBe('<li>apple</li><li>banana</li><li>cherry</li>')
      })

      it('should handle objects in array', () => {
        const result = renderer.renderString(
          '{{#each users}}<p>{{this.name}}: {{this.email}}</p>{{/each}}',
          { users: [{ name: 'John', email: 'john@example.com' }, { name: 'Jane', email: 'jane@example.com' }] }
        )
        expect(result).toBe('<p>John: john@example.com</p><p>Jane: jane@example.com</p>')
      })

      it('should provide @index variable', () => {
        const result = renderer.renderString(
          '{{#each items}}{{@index}}: {{this}} {{/each}}',
          { items: ['a', 'b', 'c'] }
        )
        expect(result).toBe('0: a 1: b 2: c ')
      })

      it('should provide @first and @last variables', () => {
        const result = renderer.renderString(
          '{{#each items}}{{#if @first}}First: {{/if}}{{this}}{{#if @last}} (last){{/if}} {{/each}}',
          { items: ['a', 'b', 'c'] }
        )
        expect(result).toBe('First: a b c (last) ')
      })

      it('should handle empty arrays', () => {
        const result = renderer.renderString(
          '{{#each items}}<li>{{this}}</li>{{/each}}',
          { items: [] }
        )
        expect(result).toBe('')
      })

      it('should handle non-array values', () => {
        const result = renderer.renderString(
          '{{#each items}}<li>{{this}}</li>{{/each}}',
          { items: 'not an array' }
        )
        expect(result).toBe('')
      })
    })

    describe('Template rendering', () => {
      it('should render template by ID', async () => {
        const template: EmailTemplate = {
          id: 'welcome',
          name: 'Welcome',
          subject: 'Welcome {{name}}!',
          html: '<h1>Hello {{name}}</h1>',
          text: 'Hello {{name}}',
          created_at: new Date(),
          updated_at: new Date(),
        }

        await storage.set(template)
        const result = await renderer.render('welcome', { name: 'John' })

        expect(result?.subject).toBe('Welcome John!')
        expect(result?.html).toBe('<h1>Hello John</h1>')
        expect(result?.text).toBe('Hello John')
      })

      it('should return null for non-existent template', async () => {
        const result = await renderer.render('non-existent', {})
        expect(result).toBeNull()
      })
    })
  })

  describe('BUILT_IN_TEMPLATES', () => {
    it('should have welcome template', () => {
      const welcome = BUILT_IN_TEMPLATES.find((t) => t.id === 'welcome')
      expect(welcome).toBeDefined()
      expect(welcome?.subject).toContain('{{company_name}}')
    })

    it('should have password-reset template', () => {
      const reset = BUILT_IN_TEMPLATES.find((t) => t.id === 'password-reset')
      expect(reset).toBeDefined()
      expect(reset?.html).toContain('{{reset_url}}')
    })

    it('should have notification template', () => {
      const notification = BUILT_IN_TEMPLATES.find((t) => t.id === 'notification')
      expect(notification).toBeDefined()
      expect(notification?.subject).toBe('{{subject}}')
    })
  })

  describe('initializeBuiltInTemplates', () => {
    it('should add all built-in templates to storage', async () => {
      const storage = new InMemoryTemplateStorage()
      await initializeBuiltInTemplates(storage)

      const templates = await storage.list()
      expect(templates.length).toBeGreaterThanOrEqual(BUILT_IN_TEMPLATES.length)
    })
  })

  describe('extractVariables', () => {
    it('should extract simple variables', () => {
      const variables = extractVariables('Hello {{name}}!')
      expect(variables).toContain('name')
    })

    it('should extract multiple variables', () => {
      const variables = extractVariables('{{greeting}} {{name}}, welcome to {{company}}!')
      expect(variables).toEqual(expect.arrayContaining(['greeting', 'name', 'company']))
    })

    it('should extract variables from conditionals', () => {
      const variables = extractVariables('{{#if showCta}}Click here{{/if}}')
      expect(variables).toContain('showCta')
    })

    it('should extract variables from loops', () => {
      const variables = extractVariables('{{#each items}}{{this}}{{/each}}')
      expect(variables).toContain('items')
    })

    it('should handle nested paths (extract root)', () => {
      const variables = extractVariables('{{user.name}} - {{user.email}}')
      expect(variables).toContain('user')
    })

    it('should not include special variables', () => {
      const variables = extractVariables('{{@index}} {{this}}')
      expect(variables).not.toContain('@index')
      expect(variables).not.toContain('this')
    })
  })

  describe('validateTemplateData', () => {
    it('should pass when all variables are provided', () => {
      const template: EmailTemplate = {
        id: 'test',
        name: 'Test',
        subject: 'Test',
        html: 'Hello',
        variables: ['name', 'company'],
        created_at: new Date(),
        updated_at: new Date(),
      }

      const result = validateTemplateData(template, { name: 'John', company: 'Acme' })
      expect(result.valid).toBe(true)
      expect(result.missing).toHaveLength(0)
    })

    it('should fail when variables are missing', () => {
      const template: EmailTemplate = {
        id: 'test',
        name: 'Test',
        subject: 'Test',
        html: 'Hello',
        variables: ['name', 'company', 'product'],
        created_at: new Date(),
        updated_at: new Date(),
      }

      const result = validateTemplateData(template, { name: 'John' })
      expect(result.valid).toBe(false)
      expect(result.missing).toContain('company')
      expect(result.missing).toContain('product')
    })

    it('should pass for templates without variables', () => {
      const template: EmailTemplate = {
        id: 'test',
        name: 'Test',
        subject: 'Test',
        html: 'Hello',
        created_at: new Date(),
        updated_at: new Date(),
      }

      const result = validateTemplateData(template, {})
      expect(result.valid).toBe(true)
    })
  })
})
