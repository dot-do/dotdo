/**
 * TemplateEngine Tests - Document template rendering with merge fields
 *
 * @module db/primitives/documents/tests/template-engine
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTemplateEngine,
  DocumentTemplateEngine,
  type DocumentTemplate,
  type MergeField,
  type TemplateSection,
} from '../template-engine'

describe('DocumentTemplateEngine', () => {
  let engine: DocumentTemplateEngine

  beforeEach(() => {
    engine = createTemplateEngine()
  })

  // =============================================================================
  // Basic Template Rendering
  // =============================================================================

  describe('basic rendering', () => {
    it('should render simple merge fields', () => {
      const result = engine.render('Hello {{name}}!', { name: 'World' })
      expect(result).toBe('Hello World!')
    })

    it('should render nested object paths', () => {
      const result = engine.render('{{customer.name}} at {{customer.company}}', {
        customer: { name: 'Alice', company: 'Acme Inc' },
      })
      expect(result).toBe('Alice at Acme Inc')
    })

    it('should handle missing fields gracefully', () => {
      const result = engine.render('Hello {{missing}}!', {})
      expect(result).toBe('Hello !')
    })

    it('should throw on missing fields when configured', () => {
      const strictEngine = createTemplateEngine({ throwOnMissing: true })
      expect(() => strictEngine.render('Hello {{missing}}!', {})).toThrow()
    })

    it('should handle deeply nested paths', () => {
      const result = engine.render('{{a.b.c.d}}', {
        a: { b: { c: { d: 'deep' } } },
      })
      expect(result).toBe('deep')
    })

    it('should handle arrays with index access', () => {
      const result = engine.render('{{items.0}} and {{items.1}}', {
        items: ['first', 'second'],
      })
      expect(result).toBe('first and second')
    })
  })

  // =============================================================================
  // Document Templates
  // =============================================================================

  describe('document templates', () => {
    it('should register and retrieve templates', () => {
      const template: DocumentTemplate = {
        id: 'invoice',
        name: 'Invoice Template',
        content: 'Invoice #{{invoiceNumber}} for {{customer}}',
        mergeFields: [
          { name: 'invoiceNumber', type: 'string', required: true },
          { name: 'customer', type: 'string', required: true },
        ],
      }

      engine.registerTemplate(template)
      const retrieved = engine.getTemplate('invoice')

      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe('invoice')
    })

    it('should render using registered template', () => {
      engine.registerTemplate({
        id: 'welcome',
        name: 'Welcome Letter',
        content: 'Dear {{name}}, welcome to {{company}}!',
        mergeFields: [
          { name: 'name', type: 'string', required: true },
          { name: 'company', type: 'string', required: true },
        ],
      })

      const result = engine.renderTemplate('welcome', {
        name: 'Alice',
        company: 'Acme',
      })

      expect(result).toBe('Dear Alice, welcome to Acme!')
    })

    it('should validate required fields', () => {
      engine.registerTemplate({
        id: 'contract',
        name: 'Contract',
        content: '{{partyA}} and {{partyB}}',
        mergeFields: [
          { name: 'partyA', type: 'string', required: true },
          { name: 'partyB', type: 'string', required: true },
        ],
      })

      const validation = engine.validateData('contract', { partyA: 'Alice' })

      expect(validation.valid).toBe(false)
      expect(validation.missingFields).toContain('partyB')
    })

    it('should list all templates', () => {
      engine.registerTemplate({ id: 'a', name: 'A', content: '', mergeFields: [] })
      engine.registerTemplate({ id: 'b', name: 'B', content: '', mergeFields: [] })

      const templates = engine.listTemplates()

      expect(templates).toHaveLength(2)
      expect(templates.map((t) => t.id)).toContain('a')
      expect(templates.map((t) => t.id)).toContain('b')
    })

    it('should delete templates', () => {
      engine.registerTemplate({ id: 'temp', name: 'Temp', content: '', mergeFields: [] })
      expect(engine.getTemplate('temp')).toBeDefined()

      engine.deleteTemplate('temp')
      expect(engine.getTemplate('temp')).toBeUndefined()
    })
  })

  // =============================================================================
  // Conditionals
  // =============================================================================

  describe('conditionals', () => {
    it('should handle if blocks', () => {
      const result = engine.render('{{#if premium}}VIP{{/if}} Customer', {
        premium: true,
      })
      expect(result).toBe('VIP Customer')
    })

    it('should handle if/else blocks', () => {
      const template = '{{#if premium}}VIP{{else}}Regular{{/if}} Customer'

      expect(engine.render(template, { premium: true })).toBe('VIP Customer')
      expect(engine.render(template, { premium: false })).toBe('Regular Customer')
    })

    it('should handle unless blocks', () => {
      const result = engine.render('{{#unless banned}}Welcome{{/unless}}', {
        banned: false,
      })
      expect(result).toBe('Welcome')
    })

    it('should handle falsy values correctly', () => {
      const template = '{{#if value}}yes{{else}}no{{/if}}'

      expect(engine.render(template, { value: 0 })).toBe('no')
      expect(engine.render(template, { value: '' })).toBe('no')
      expect(engine.render(template, { value: null })).toBe('no')
      expect(engine.render(template, { value: undefined })).toBe('no')
      expect(engine.render(template, { value: [] })).toBe('no')
    })

    it('should handle nested conditions', () => {
      const result = engine.render(
        '{{#if a}}{{#if b}}both{{else}}a only{{/if}}{{/if}}',
        { a: true, b: true }
      )
      expect(result).toBe('both')
    })
  })

  // =============================================================================
  // Loops
  // =============================================================================

  describe('loops', () => {
    it('should iterate arrays with each', () => {
      const result = engine.render('{{#each items}}{{this}}{{/each}}', {
        items: ['a', 'b', 'c'],
      })
      expect(result).toBe('abc')
    })

    it('should provide @index in each loops', () => {
      const result = engine.render('{{#each items}}{{@index}}:{{this}} {{/each}}', {
        items: ['a', 'b', 'c'],
      })
      expect(result).toBe('0:a 1:b 2:c ')
    })

    it('should provide @first and @last', () => {
      const result = engine.render(
        '{{#each items}}{{#if @first}}[{{/if}}{{this}}{{#if @last}}]{{/if}}{{/each}}',
        { items: ['a', 'b', 'c'] }
      )
      expect(result).toBe('[abc]')
    })

    it('should iterate objects', () => {
      const result = engine.render(
        '{{#each obj}}{{@key}}={{this}} {{/each}}',
        { obj: { a: 1, b: 2 } }
      )
      expect(result).toContain('a=1')
      expect(result).toContain('b=2')
    })

    it('should handle nested objects in each', () => {
      const result = engine.render(
        '{{#each items}}{{name}}:{{price}} {{/each}}',
        { items: [{ name: 'A', price: 10 }, { name: 'B', price: 20 }] }
      )
      expect(result).toBe('A:10 B:20 ')
    })

    it('should handle empty arrays', () => {
      const result = engine.render('Items: {{#each items}}{{this}}{{/each}}Done', {
        items: [],
      })
      expect(result).toBe('Items: Done')
    })
  })

  // =============================================================================
  // Filters and Formatting
  // =============================================================================

  describe('filters', () => {
    it('should apply uppercase filter', () => {
      const result = engine.render('{{name | uppercase}}', { name: 'alice' })
      expect(result).toBe('ALICE')
    })

    it('should apply lowercase filter', () => {
      const result = engine.render('{{name | lowercase}}', { name: 'ALICE' })
      expect(result).toBe('alice')
    })

    it('should apply capitalize filter', () => {
      const result = engine.render('{{name | capitalize}}', { name: 'alice smith' })
      expect(result).toBe('Alice Smith')
    })

    it('should apply currency filter', () => {
      const result = engine.render('{{amount | currency}}', { amount: 1234.56 })
      expect(result).toMatch(/\$1,234\.56/)
    })

    it('should apply date filter', () => {
      const result = engine.render('{{date | date}}', { date: '2024-01-15' })
      expect(result).toContain('2024')
    })

    it('should chain multiple filters', () => {
      const result = engine.render('{{name | trim | uppercase}}', { name: '  alice  ' })
      expect(result).toBe('ALICE')
    })

    it('should allow custom filters', () => {
      const customEngine = createTemplateEngine({
        filters: [
          {
            name: 'reverse',
            fn: (value: unknown) => String(value).split('').reverse().join(''),
          },
        ],
      })

      const result = customEngine.render('{{text | reverse}}', { text: 'hello' })
      expect(result).toBe('olleh')
    })

    it('should apply number filter with decimals', () => {
      const result = engine.render('{{value | number:2}}', { value: 123.456 })
      expect(result).toBe('123.46')
    })
  })

  // =============================================================================
  // Sections and Partials
  // =============================================================================

  describe('sections', () => {
    it('should register and use partials', () => {
      engine.registerPartial('header', '<h1>{{title}}</h1>')

      const result = engine.render('{{> header}}', { title: 'Welcome' })
      expect(result).toBe('<h1>Welcome</h1>')
    })

    it('should pass data to partials', () => {
      engine.registerPartial('address', '{{street}}, {{city}}')

      const result = engine.render('Address: {{> address data=billing}}', {
        billing: { street: '123 Main St', city: 'NYC' },
      })
      expect(result).toBe('Address: 123 Main St, NYC')
    })

    it('should support template sections', () => {
      const template: DocumentTemplate = {
        id: 'letter',
        name: 'Business Letter',
        content: '{{> header}}{{> body}}{{> footer}}',
        sections: [
          { id: 'header', content: 'From: {{sender}}\n' },
          { id: 'body', content: 'Dear {{recipient}},\n{{message}}\n' },
          { id: 'footer', content: 'Sincerely, {{sender}}' },
        ],
        mergeFields: [],
      }

      engine.registerTemplate(template)

      const result = engine.renderTemplate('letter', {
        sender: 'Alice',
        recipient: 'Bob',
        message: 'Hello!',
      })

      expect(result).toContain('From: Alice')
      expect(result).toContain('Dear Bob')
      expect(result).toContain('Hello!')
      expect(result).toContain('Sincerely, Alice')
    })
  })

  // =============================================================================
  // HTML Escaping
  // =============================================================================

  describe('escaping', () => {
    it('should escape HTML by default for safe rendering', () => {
      const safeEngine = createTemplateEngine({ escapeByDefault: 'html' })
      const result = safeEngine.render('{{content}}', {
        content: '<script>alert("xss")</script>',
      })
      expect(result).not.toContain('<script>')
      expect(result).toContain('&lt;script&gt;')
    })

    it('should not escape with triple braces', () => {
      const safeEngine = createTemplateEngine({ escapeByDefault: 'html' })
      const result = safeEngine.render('{{{content}}}', {
        content: '<strong>bold</strong>',
      })
      expect(result).toBe('<strong>bold</strong>')
    })

    it('should support markdown escaping', () => {
      const mdEngine = createTemplateEngine({ escapeByDefault: 'markdown' })
      const result = mdEngine.render('{{text}}', { text: '**bold**' })
      expect(result).toContain('\\*\\*')
    })
  })

  // =============================================================================
  // Merge Field Extraction
  // =============================================================================

  describe('merge field extraction', () => {
    it('should extract simple merge fields', () => {
      const fields = engine.extractFields('Hello {{name}}, your order is {{orderId}}')
      expect(fields).toContain('name')
      expect(fields).toContain('orderId')
    })

    it('should extract nested merge fields', () => {
      const fields = engine.extractFields('{{customer.name}} - {{customer.address.city}}')
      expect(fields).toContain('customer.name')
      expect(fields).toContain('customer.address.city')
    })

    it('should extract fields from loops', () => {
      const fields = engine.extractFields('{{#each items}}{{name}}{{price}}{{/each}}')
      expect(fields).toContain('items')
    })

    it('should extract fields from conditionals', () => {
      const fields = engine.extractFields('{{#if premium}}{{discount}}{{/if}}')
      expect(fields).toContain('premium')
      expect(fields).toContain('discount')
    })

    it('should handle duplicates', () => {
      const fields = engine.extractFields('{{name}} and {{name}}')
      expect(fields.filter((f) => f === 'name')).toHaveLength(1)
    })
  })

  // =============================================================================
  // Field Type Validation
  // =============================================================================

  describe('field validation', () => {
    it('should validate string fields', () => {
      engine.registerTemplate({
        id: 'test',
        name: 'Test',
        content: '{{name}}',
        mergeFields: [{ name: 'name', type: 'string', required: true }],
      })

      const valid = engine.validateData('test', { name: 'Alice' })
      const invalid = engine.validateData('test', { name: 123 })

      expect(valid.valid).toBe(true)
      expect(invalid.valid).toBe(false)
      expect(invalid.typeErrors).toContainEqual({ field: 'name', expected: 'string', actual: 'number' })
    })

    it('should validate number fields', () => {
      engine.registerTemplate({
        id: 'test',
        name: 'Test',
        content: '{{amount}}',
        mergeFields: [{ name: 'amount', type: 'number', required: true }],
      })

      const valid = engine.validateData('test', { amount: 100 })
      const invalid = engine.validateData('test', { amount: 'hundred' })

      expect(valid.valid).toBe(true)
      expect(invalid.valid).toBe(false)
    })

    it('should validate date fields', () => {
      engine.registerTemplate({
        id: 'test',
        name: 'Test',
        content: '{{date}}',
        mergeFields: [{ name: 'date', type: 'date', required: true }],
      })

      const valid1 = engine.validateData('test', { date: '2024-01-15' })
      const valid2 = engine.validateData('test', { date: new Date() })
      const invalid = engine.validateData('test', { date: 'not-a-date' })

      expect(valid1.valid).toBe(true)
      expect(valid2.valid).toBe(true)
      expect(invalid.valid).toBe(false)
    })

    it('should validate array fields', () => {
      engine.registerTemplate({
        id: 'test',
        name: 'Test',
        content: '{{#each items}}{{this}}{{/each}}',
        mergeFields: [{ name: 'items', type: 'array', required: true }],
      })

      const valid = engine.validateData('test', { items: [1, 2, 3] })
      const invalid = engine.validateData('test', { items: 'not-array' })

      expect(valid.valid).toBe(true)
      expect(invalid.valid).toBe(false)
    })

    it('should validate optional fields', () => {
      engine.registerTemplate({
        id: 'test',
        name: 'Test',
        content: '{{name}} {{nickname}}',
        mergeFields: [
          { name: 'name', type: 'string', required: true },
          { name: 'nickname', type: 'string', required: false },
        ],
      })

      const result = engine.validateData('test', { name: 'Alice' })
      expect(result.valid).toBe(true)
    })

    it('should validate with custom validators', () => {
      engine.registerTemplate({
        id: 'test',
        name: 'Test',
        content: '{{email}}',
        mergeFields: [{
          name: 'email',
          type: 'string',
          required: true,
          validate: (value) => {
            const str = String(value)
            return str.includes('@') && str.includes('.')
          },
        }],
      })

      const valid = engine.validateData('test', { email: 'test@example.com' })
      const invalid = engine.validateData('test', { email: 'not-an-email' })

      expect(valid.valid).toBe(true)
      expect(invalid.valid).toBe(false)
      expect(invalid.validationErrors).toContainEqual({ field: 'email', message: 'Custom validation failed' })
    })
  })

  // =============================================================================
  // Template Versioning
  // =============================================================================

  describe('versioning', () => {
    it('should track template versions', () => {
      engine.registerTemplate({
        id: 'versioned',
        name: 'Versioned',
        content: 'v1',
        mergeFields: [],
        version: 1,
      })

      const v1 = engine.getTemplate('versioned')
      expect(v1?.version).toBe(1)

      engine.registerTemplate({
        id: 'versioned',
        name: 'Versioned',
        content: 'v2',
        mergeFields: [],
        version: 2,
      })

      const v2 = engine.getTemplate('versioned')
      expect(v2?.version).toBe(2)
    })

    it('should retrieve specific versions', () => {
      engine.registerTemplate({
        id: 'doc',
        name: 'Doc',
        content: 'version 1',
        mergeFields: [],
        version: 1,
      })

      engine.registerTemplate({
        id: 'doc',
        name: 'Doc',
        content: 'version 2',
        mergeFields: [],
        version: 2,
      })

      const v1 = engine.getTemplateVersion('doc', 1)
      const v2 = engine.getTemplateVersion('doc', 2)

      expect(v1?.content).toBe('version 1')
      expect(v2?.content).toBe('version 2')
    })
  })

  // =============================================================================
  // Caching
  // =============================================================================

  describe('caching', () => {
    it('should cache compiled templates', () => {
      const template = '{{a}} {{b}} {{c}}'

      // First render compiles the template
      engine.render(template, { a: 1, b: 2, c: 3 })

      // Get cache stats
      const stats = engine.getCacheStats()
      expect(stats.size).toBeGreaterThan(0)
    })

    it('should clear cache', () => {
      engine.render('{{x}}', { x: 1 })

      engine.clearCache()

      const stats = engine.getCacheStats()
      expect(stats.size).toBe(0)
    })
  })
})
