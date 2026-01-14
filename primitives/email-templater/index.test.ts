/**
 * EmailTemplater Tests - TDD Red-Green-Refactor
 *
 * Comprehensive tests for email templating primitives
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  EmailTemplater,
  TemplateEngine,
  HTMLProcessor,
  TextGenerator,
  LocalizationManager,
  AttachmentHandler,
  VariableValidator,
} from './index'
import type {
  EmailTemplate,
  TemplateContext,
  EmailConfig,
  RenderedEmail,
  ValidationResult,
  PreviewResult,
  Attachment,
  LocaleConfig,
  TemplateHelper,
  TemplateFilter,
} from './types'

// =============================================================================
// TemplateEngine Tests
// =============================================================================

describe('TemplateEngine', () => {
  let engine: TemplateEngine

  beforeEach(() => {
    engine = new TemplateEngine()
  })

  describe('simple variable substitution', () => {
    it('should substitute a single variable', () => {
      const template = 'Hello, {{name}}!'
      const variables = { name: 'Alice' }
      const result = engine.render(template, variables)
      expect(result).toBe('Hello, Alice!')
    })

    it('should substitute multiple variables', () => {
      const template = '{{greeting}}, {{name}}! Welcome to {{company}}.'
      const variables = { greeting: 'Hi', name: 'Bob', company: 'Acme' }
      const result = engine.render(template, variables)
      expect(result).toBe('Hi, Bob! Welcome to Acme.')
    })

    it('should handle variables with spaces in delimiters', () => {
      const template = 'Hello, {{ name }}!'
      const variables = { name: 'Charlie' }
      const result = engine.render(template, variables)
      expect(result).toBe('Hello, Charlie!')
    })

    it('should preserve unmatched delimiters', () => {
      const template = 'Hello, {{name}}! Price: ${{price}}'
      const variables = { name: 'Dave' }
      const result = engine.render(template, variables)
      expect(result).toBe('Hello, Dave! Price: ${{price}}')
    })

    it('should handle empty variables object', () => {
      const template = 'Hello, {{name}}!'
      const result = engine.render(template, {})
      expect(result).toBe('Hello, {{name}}!')
    })
  })

  describe('nested object variables', () => {
    it('should access nested properties with dot notation', () => {
      const template = 'Hello, {{user.name}}! Your email is {{user.email}}.'
      const variables = {
        user: { name: 'Eve', email: 'eve@example.com' },
      }
      const result = engine.render(template, variables)
      expect(result).toBe('Hello, Eve! Your email is eve@example.com.')
    })

    it('should access deeply nested properties', () => {
      const template = 'City: {{address.city.name}}'
      const variables = {
        address: { city: { name: 'New York' } },
      }
      const result = engine.render(template, variables)
      expect(result).toBe('City: New York')
    })

    it('should handle missing nested properties gracefully', () => {
      const template = 'Value: {{a.b.c}}'
      const variables = { a: { b: {} } }
      const result = engine.render(template, variables)
      expect(result).toBe('Value: {{a.b.c}}')
    })
  })

  describe('array iteration', () => {
    it('should iterate over simple arrays', () => {
      const template = '{{#each items}}{{this}}, {{/each}}'
      const variables = { items: ['apple', 'banana', 'cherry'] }
      const result = engine.render(template, variables)
      expect(result).toBe('apple, banana, cherry, ')
    })

    it('should iterate over arrays of objects', () => {
      const template = '{{#each users}}{{name}} ({{email}}), {{/each}}'
      const variables = {
        users: [
          { name: 'Alice', email: 'alice@example.com' },
          { name: 'Bob', email: 'bob@example.com' },
        ],
      }
      const result = engine.render(template, variables)
      expect(result).toBe('Alice (alice@example.com), Bob (bob@example.com), ')
    })

    it('should provide @index in each loops', () => {
      const template = '{{#each items}}{{@index}}: {{this}}, {{/each}}'
      const variables = { items: ['a', 'b', 'c'] }
      const result = engine.render(template, variables)
      expect(result).toBe('0: a, 1: b, 2: c, ')
    })

    it('should provide @first and @last indicators', () => {
      const template = '{{#each items}}{{#if @first}}[{{/if}}{{this}}{{#if @last}}]{{/if}}{{#unless @last}}, {{/unless}}{{/each}}'
      const variables = { items: ['a', 'b', 'c'] }
      const result = engine.render(template, variables)
      expect(result).toBe('[a, b, c]')
    })

    it('should handle empty arrays', () => {
      const template = '{{#each items}}{{this}}{{/each}}'
      const variables = { items: [] }
      const result = engine.render(template, variables)
      expect(result).toBe('')
    })

    it('should handle nested loops', () => {
      const template = '{{#each groups}}Group: {{#each items}}{{this}} {{/each}}| {{/each}}'
      const variables = {
        groups: [
          { items: ['a', 'b'] },
          { items: ['c', 'd'] },
        ],
      }
      const result = engine.render(template, variables)
      expect(result).toBe('Group: a b | Group: c d | ')
    })
  })

  describe('conditional blocks', () => {
    it('should render content when condition is truthy', () => {
      const template = '{{#if showGreeting}}Hello!{{/if}}'
      const variables = { showGreeting: true }
      const result = engine.render(template, variables)
      expect(result).toBe('Hello!')
    })

    it('should not render content when condition is falsy', () => {
      const template = '{{#if showGreeting}}Hello!{{/if}}'
      const variables = { showGreeting: false }
      const result = engine.render(template, variables)
      expect(result).toBe('')
    })

    it('should handle else blocks', () => {
      const template = '{{#if isVip}}VIP Welcome!{{else}}Standard Welcome{{/if}}'
      const variables = { isVip: false }
      const result = engine.render(template, variables)
      expect(result).toBe('Standard Welcome')
    })

    it('should handle unless blocks', () => {
      const template = '{{#unless isPremium}}Upgrade today!{{/unless}}'
      const variables = { isPremium: false }
      const result = engine.render(template, variables)
      expect(result).toBe('Upgrade today!')
    })

    it('should treat empty strings as falsy', () => {
      const template = '{{#if name}}Hello {{name}}{{else}}Hello Guest{{/if}}'
      const variables = { name: '' }
      const result = engine.render(template, variables)
      expect(result).toBe('Hello Guest')
    })

    it('should treat 0 as falsy', () => {
      const template = '{{#if count}}You have {{count}} items{{else}}No items{{/if}}'
      const variables = { count: 0 }
      const result = engine.render(template, variables)
      expect(result).toBe('No items')
    })

    it('should handle nested conditionals', () => {
      const template = '{{#if a}}A{{#if b}}B{{/if}}{{/if}}'
      const variables = { a: true, b: true }
      const result = engine.render(template, variables)
      expect(result).toBe('AB')
    })
  })

  describe('default values', () => {
    it('should use default value when variable is missing', () => {
      const template = 'Hello, {{name|default:"Guest"}}!'
      const variables = {}
      const result = engine.render(template, variables)
      expect(result).toBe('Hello, Guest!')
    })

    it('should use variable value when provided', () => {
      const template = 'Hello, {{name|default:"Guest"}}!'
      const variables = { name: 'Frank' }
      const result = engine.render(template, variables)
      expect(result).toBe('Hello, Frank!')
    })

    it('should handle numeric default values', () => {
      const template = 'Items: {{count|default:0}}'
      const variables = {}
      const result = engine.render(template, variables)
      expect(result).toBe('Items: 0')
    })

    it('should use default for null values', () => {
      const template = 'Value: {{value|default:"N/A"}}'
      const variables = { value: null }
      const result = engine.render(template, variables)
      expect(result).toBe('Value: N/A')
    })

    it('should use default for undefined values', () => {
      const template = 'Value: {{value|default:"N/A"}}'
      const variables = { value: undefined }
      const result = engine.render(template, variables)
      expect(result).toBe('Value: N/A')
    })
  })

  describe('custom helpers', () => {
    it('should execute custom helper functions', () => {
      engine.registerHelper({
        name: 'uppercase',
        fn: (value) => String(value).toUpperCase(),
      })
      const template = 'Name: {{uppercase name}}'
      const variables = { name: 'grace' }
      const result = engine.render(template, variables)
      expect(result).toBe('Name: GRACE')
    })

    it('should pass arguments to helpers', () => {
      engine.registerHelper({
        name: 'truncate',
        fn: (value, length: number) => String(value).slice(0, length),
      })
      const template = 'Title: {{truncate title 10}}'
      const variables = { title: 'A very long title here' }
      const result = engine.render(template, variables)
      expect(result).toBe('Title: A very lon')
    })

    it('should handle formatDate helper', () => {
      engine.registerHelper({
        name: 'formatDate',
        fn: (value) => {
          // Use UTC date to avoid timezone issues
          const date = new Date(value as string + 'T12:00:00Z')
          return date.toLocaleDateString('en-US', { timeZone: 'UTC' })
        },
      })
      const template = 'Date: {{formatDate date}}'
      const variables = { date: '2024-01-15' }
      const result = engine.render(template, variables)
      expect(result).toBe('Date: 1/15/2024')
    })

    it('should handle formatCurrency helper', () => {
      engine.registerHelper({
        name: 'formatCurrency',
        fn: (value, currency: string = 'USD') => {
          return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency,
          }).format(value as number)
        },
      })
      const template = 'Price: {{formatCurrency price "USD"}}'
      const variables = { price: 29.99 }
      const result = engine.render(template, variables)
      expect(result).toBe('Price: $29.99')
    })
  })

  describe('custom filters', () => {
    it('should apply filter functions', () => {
      engine.registerFilter({
        name: 'lowercase',
        fn: (value) => String(value).toLowerCase(),
      })
      const template = 'Name: {{name|lowercase}}'
      const variables = { name: 'HENRY' }
      const result = engine.render(template, variables)
      expect(result).toBe('Name: henry')
    })

    it('should chain multiple filters', () => {
      engine.registerFilter({
        name: 'lowercase',
        fn: (value) => String(value).toLowerCase(),
      })
      engine.registerFilter({
        name: 'trim',
        fn: (value) => String(value).trim(),
      })
      const template = 'Name: {{name|trim|lowercase}}'
      const variables = { name: '  IRENE  ' }
      const result = engine.render(template, variables)
      expect(result).toBe('Name: irene')
    })

    it('should pass filter arguments', () => {
      engine.registerFilter({
        name: 'replace',
        fn: (value, search: string, replacement: string) =>
          String(value).replace(new RegExp(search, 'g'), replacement),
      })
      const template = 'Text: {{text|replace:" ":"_"}}'
      const variables = { text: 'hello world' }
      const result = engine.render(template, variables)
      expect(result).toBe('Text: hello_world')
    })
  })

  describe('extract variables', () => {
    it('should extract simple variable names', () => {
      const template = 'Hello, {{name}}! Your order {{orderId}} is ready.'
      const variables = engine.extractVariables(template)
      expect(variables).toEqual(['name', 'orderId'])
    })

    it('should extract nested variable paths', () => {
      const template = 'Hello, {{user.name}}!'
      const variables = engine.extractVariables(template)
      expect(variables).toEqual(['user.name'])
    })

    it('should extract variables from loops', () => {
      const template = '{{#each items}}{{name}}{{/each}}'
      const variables = engine.extractVariables(template)
      expect(variables).toContain('items')
    })

    it('should extract variables from conditionals', () => {
      const template = '{{#if showBanner}}{{bannerText}}{{/if}}'
      const variables = engine.extractVariables(template)
      expect(variables).toContain('showBanner')
      expect(variables).toContain('bannerText')
    })
  })
})

// =============================================================================
// VariableValidator Tests
// =============================================================================

describe('VariableValidator', () => {
  let validator: VariableValidator

  beforeEach(() => {
    validator = new VariableValidator()
  })

  describe('required variable validation', () => {
    it('should fail when required variable is missing', () => {
      const error = validator.validate(undefined, {
        name: 'email',
        type: 'string',
        required: true,
      })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('MISSING_REQUIRED')
    })

    it('should pass when required variable is provided', () => {
      const error = validator.validate('test@example.com', {
        name: 'email',
        type: 'string',
        required: true,
      })
      expect(error).toBeNull()
    })

    it('should pass when optional variable is missing', () => {
      const error = validator.validate(undefined, {
        name: 'nickname',
        type: 'string',
        required: false,
      })
      expect(error).toBeNull()
    })
  })

  describe('type validation', () => {
    it('should validate string type', () => {
      expect(validator.checkType('hello', 'string')).toBe(true)
      expect(validator.checkType(123, 'string')).toBe(false)
    })

    it('should validate number type', () => {
      expect(validator.checkType(42, 'number')).toBe(true)
      expect(validator.checkType(3.14, 'number')).toBe(true)
      expect(validator.checkType('42', 'number')).toBe(false)
    })

    it('should validate boolean type', () => {
      expect(validator.checkType(true, 'boolean')).toBe(true)
      expect(validator.checkType(false, 'boolean')).toBe(true)
      expect(validator.checkType('true', 'boolean')).toBe(false)
    })

    it('should validate date type', () => {
      expect(validator.checkType(new Date(), 'date')).toBe(true)
      expect(validator.checkType('2024-01-01', 'date')).toBe(true) // ISO string
      expect(validator.checkType(1704067200000, 'date')).toBe(true) // timestamp
    })

    it('should validate array type', () => {
      expect(validator.checkType([], 'array')).toBe(true)
      expect(validator.checkType([1, 2, 3], 'array')).toBe(true)
      expect(validator.checkType('array', 'array')).toBe(false)
    })

    it('should validate object type', () => {
      expect(validator.checkType({}, 'object')).toBe(true)
      expect(validator.checkType({ a: 1 }, 'object')).toBe(true)
      expect(validator.checkType([], 'object')).toBe(false) // arrays are not objects
      expect(validator.checkType(null, 'object')).toBe(false)
    })
  })

  describe('type coercion', () => {
    it('should coerce number string to number', () => {
      expect(validator.coerce('42', 'number')).toBe(42)
      expect(validator.coerce('3.14', 'number')).toBeCloseTo(3.14)
    })

    it('should coerce boolean strings', () => {
      expect(validator.coerce('true', 'boolean')).toBe(true)
      expect(validator.coerce('false', 'boolean')).toBe(false)
      expect(validator.coerce('1', 'boolean')).toBe(true)
      expect(validator.coerce('0', 'boolean')).toBe(false)
    })

    it('should coerce date strings', () => {
      const result = validator.coerce('2024-01-15', 'date')
      expect(result).toBeInstanceOf(Date)
    })

    it('should coerce number to string', () => {
      expect(validator.coerce(42, 'string')).toBe('42')
    })
  })
})

// =============================================================================
// HTMLProcessor Tests
// =============================================================================

describe('HTMLProcessor', () => {
  let processor: HTMLProcessor

  beforeEach(() => {
    processor = new HTMLProcessor()
  })

  describe('HTML processing', () => {
    it('should pass through valid HTML', () => {
      const html = '<p>Hello <strong>World</strong></p>'
      const result = processor.process(html)
      expect(result).toContain('<p>Hello')
      expect(result).toContain('<strong>World</strong>')
    })

    it('should handle self-closing tags', () => {
      const html = '<img src="image.png" /><br />'
      const result = processor.process(html)
      expect(result).toContain('image.png')
    })
  })

  describe('CSS inlining', () => {
    it('should inline styles from style tags', () => {
      const html = `
        <style>.red { color: red; }</style>
        <p class="red">Text</p>
      `
      const result = processor.inlineStyles(html)
      expect(result).toContain('style="color: red')
    })

    it('should handle multiple style rules', () => {
      const html = `
        <style>
          .bold { font-weight: bold; }
          .big { font-size: 20px; }
        </style>
        <p class="bold big">Text</p>
      `
      const result = processor.inlineStyles(html)
      expect(result).toContain('font-weight: bold')
      expect(result).toContain('font-size: 20px')
    })

    it('should preserve existing inline styles', () => {
      const html = `
        <style>.red { color: red; }</style>
        <p class="red" style="margin: 10px;">Text</p>
      `
      const result = processor.inlineStyles(html)
      expect(result).toContain('color: red')
      expect(result).toContain('margin: 10px')
    })
  })

  describe('HTML sanitization', () => {
    it('should remove script tags', () => {
      const html = '<p>Hello</p><script>alert("xss")</script>'
      const result = processor.sanitize(html)
      expect(result).not.toContain('<script>')
      expect(result).not.toContain('alert')
      expect(result).toContain('<p>Hello</p>')
    })

    it('should remove onclick handlers', () => {
      const html = '<button onclick="alert()">Click</button>'
      const result = processor.sanitize(html)
      expect(result).not.toContain('onclick')
    })

    it('should remove javascript: URLs', () => {
      const html = '<a href="javascript:alert()">Link</a>'
      const result = processor.sanitize(html)
      expect(result).not.toContain('javascript:')
    })

    it('should allow safe attributes', () => {
      const html = '<a href="https://example.com" class="link">Link</a>'
      const result = processor.sanitize(html)
      expect(result).toContain('href="https://example.com"')
      expect(result).toContain('class="link"')
    })
  })
})

// =============================================================================
// TextGenerator Tests
// =============================================================================

describe('TextGenerator', () => {
  let generator: TextGenerator

  beforeEach(() => {
    generator = new TextGenerator()
  })

  describe('HTML to text conversion', () => {
    it('should convert simple HTML to text', () => {
      const html = '<p>Hello World</p>'
      const result = generator.generate(html)
      expect(result).toContain('Hello World')
    })

    it('should convert links to text with URL', () => {
      const html = '<a href="https://example.com">Click here</a>'
      const result = generator.generate(html)
      expect(result).toContain('Click here')
      expect(result).toContain('https://example.com')
    })

    it('should convert lists to bullet points', () => {
      const html = '<ul><li>Item 1</li><li>Item 2</li></ul>'
      const result = generator.generate(html)
      expect(result).toContain('Item 1')
      expect(result).toContain('Item 2')
      // Should have some kind of bullet marker
      expect(result).toMatch(/[-*]\s*Item 1/)
    })

    it('should add line breaks for block elements', () => {
      const html = '<p>Paragraph 1</p><p>Paragraph 2</p>'
      const result = generator.generate(html)
      expect(result).toContain('Paragraph 1')
      expect(result).toContain('Paragraph 2')
      // Should have separation between paragraphs
      expect(result.indexOf('Paragraph 1')).toBeLessThan(
        result.indexOf('Paragraph 2')
      )
    })

    it('should handle headings with emphasis', () => {
      const html = '<h1>Main Title</h1><p>Content</p>'
      const result = generator.generate(html)
      expect(result).toContain('Main Title')
      // Heading should be prominent (uppercase or with markers)
    })

    it('should handle br tags', () => {
      const html = 'Line 1<br>Line 2<br />Line 3'
      const result = generator.generate(html)
      expect(result).toContain('Line 1')
      expect(result).toContain('Line 2')
      expect(result).toContain('Line 3')
    })

    it('should handle nested elements', () => {
      const html = '<div><p><strong>Bold</strong> and <em>italic</em></p></div>'
      const result = generator.generate(html)
      expect(result).toContain('Bold')
      expect(result).toContain('italic')
    })

    it('should strip style and script content', () => {
      const html = '<style>p { color: red; }</style><script>alert()</script><p>Content</p>'
      const result = generator.generate(html)
      expect(result).toContain('Content')
      expect(result).not.toContain('color')
      expect(result).not.toContain('alert')
    })

    it('should handle tables', () => {
      const html = '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>'
      const result = generator.generate(html)
      expect(result).toContain('A')
      expect(result).toContain('B')
      expect(result).toContain('C')
      expect(result).toContain('D')
    })
  })
})

// =============================================================================
// LocalizationManager Tests
// =============================================================================

describe('LocalizationManager', () => {
  let manager: LocalizationManager

  beforeEach(() => {
    manager = new LocalizationManager({
      locale: 'en-US',
      fallback: 'en',
      translations: {
        'en-US': {
          subject: 'Welcome to Our Service',
        },
        'es-ES': {
          subject: 'Bienvenido a Nuestro Servicio',
        },
        'fr-FR': {
          subject: 'Bienvenue sur Notre Service',
        },
      },
    })
  })

  describe('translation lookup', () => {
    it('should get translation for exact locale', () => {
      manager.addTranslation('welcome', 'es-ES', {
        subject: 'Hola',
      })
      const translation = manager.getTranslation('welcome', 'es-ES')
      expect(translation?.subject).toBe('Hola')
    })

    it('should fall back to base locale', () => {
      manager.addTranslation('welcome', 'en', {
        subject: 'Hello',
      })
      const translation = manager.getTranslation('welcome', 'en-GB')
      expect(translation?.subject).toBe('Hello')
    })

    it('should return null for missing translation', () => {
      const translation = manager.getTranslation('nonexistent', 'en-US')
      expect(translation).toBeNull()
    })
  })

  describe('date formatting', () => {
    it('should format dates for different locales', () => {
      const date = new Date('2024-01-15')

      const enResult = manager.formatDate(date, 'en-US')
      const frResult = manager.formatDate(date, 'fr-FR')

      expect(enResult).toContain('2024') // Year should be present
      expect(frResult).toContain('2024')
      // Different locales may have different formats
    })

    it('should handle custom date formats', () => {
      const date = new Date('2024-01-15')
      const result = manager.formatDate(date, 'en-US', 'short')
      expect(result).toBeTruthy()
    })
  })

  describe('number formatting', () => {
    it('should format numbers for different locales', () => {
      const number = 1234567.89

      const enResult = manager.formatNumber(number, 'en-US')
      const deResult = manager.formatNumber(number, 'de-DE')

      expect(enResult).toContain('1,234,567.89') // US format
      expect(deResult).toContain('1.234.567,89') // German format
    })

    it('should format currency', () => {
      const result = manager.formatNumber(29.99, 'en-US', {
        style: 'currency',
        currency: 'USD',
      })
      expect(result).toContain('$')
      expect(result).toContain('29.99')
    })

    it('should format percentages', () => {
      const result = manager.formatNumber(0.15, 'en-US', {
        style: 'percent',
      })
      expect(result).toContain('15%')
    })
  })
})

// =============================================================================
// AttachmentHandler Tests
// =============================================================================

describe('AttachmentHandler', () => {
  let handler: AttachmentHandler

  beforeEach(() => {
    handler = new AttachmentHandler()
  })

  describe('attachment validation', () => {
    it('should validate valid attachment', () => {
      const attachment: Attachment = {
        filename: 'document.pdf',
        content: 'base64content',
        contentType: 'application/pdf',
      }
      expect(handler.validate(attachment)).toBe(true)
    })

    it('should reject attachment without filename', () => {
      const attachment = {
        filename: '',
        content: 'base64content',
        contentType: 'application/pdf',
      } as Attachment
      expect(handler.validate(attachment)).toBe(false)
    })

    it('should reject attachment without content', () => {
      const attachment = {
        filename: 'test.pdf',
        content: '',
        contentType: 'application/pdf',
      } as Attachment
      expect(handler.validate(attachment)).toBe(false)
    })

    it('should reject attachment without content type', () => {
      const attachment = {
        filename: 'test.pdf',
        content: 'base64content',
        contentType: '',
      } as Attachment
      expect(handler.validate(attachment)).toBe(false)
    })

    it('should validate inline attachments with cid', () => {
      const attachment: Attachment = {
        filename: 'logo.png',
        content: 'base64content',
        contentType: 'image/png',
        cid: 'logo@company.com',
        disposition: 'inline',
      }
      expect(handler.validate(attachment)).toBe(true)
    })
  })

  describe('attachment processing', () => {
    it('should add attachment and return processed result', () => {
      const attachment: Attachment = {
        filename: 'report.pdf',
        content: 'base64content',
        contentType: 'application/pdf',
      }
      const result = handler.add(attachment)
      expect(result.filename).toBe('report.pdf')
      expect(result.contentType).toBe('application/pdf')
    })

    it('should detect content type from filename if not provided', () => {
      const attachment: Attachment = {
        filename: 'image.jpg',
        content: 'base64content',
        contentType: '', // Will be detected
      }
      const result = handler.add(attachment)
      expect(result.contentType).toBe('image/jpeg')
    })
  })

  describe('size calculation', () => {
    it('should calculate total size of attachments', () => {
      const attachments: Attachment[] = [
        { filename: 'a.txt', content: 'hello', contentType: 'text/plain' },
        { filename: 'b.txt', content: 'world', contentType: 'text/plain' },
      ]
      const size = handler.getTotalSize(attachments)
      expect(size).toBeGreaterThan(0)
    })

    it('should handle base64 encoded content', () => {
      const content = Buffer.from('Hello World').toString('base64')
      const attachments: Attachment[] = [
        { filename: 'test.txt', content, contentType: 'text/plain' },
      ]
      const size = handler.getTotalSize(attachments)
      expect(size).toBe(11) // "Hello World" is 11 bytes
    })

    it('should handle Buffer content', () => {
      const attachments: Attachment[] = [
        { filename: 'test.txt', content: Buffer.from('Test'), contentType: 'text/plain' },
      ]
      const size = handler.getTotalSize(attachments)
      expect(size).toBe(4) // "Test" is 4 bytes
    })

    it('should return 0 for empty attachments', () => {
      const size = handler.getTotalSize([])
      expect(size).toBe(0)
    })
  })
})

// =============================================================================
// EmailTemplater Integration Tests
// =============================================================================

describe('EmailTemplater', () => {
  let templater: EmailTemplater

  beforeEach(() => {
    templater = new EmailTemplater()
  })

  describe('template registration', () => {
    it('should register a template', async () => {
      const template: EmailTemplate = {
        id: 'welcome',
        name: 'Welcome Email',
        subject: 'Welcome, {{name}}!',
        html: '<h1>Welcome, {{name}}!</h1>',
        variables: [
          { name: 'name', type: 'string', required: true },
        ],
      }

      await templater.register(template)
      const registered = await templater.get('welcome')

      expect(registered).not.toBeNull()
      expect(registered?.id).toBe('welcome')
    })

    it('should overwrite existing template with same ID', async () => {
      await templater.register({
        id: 'test',
        name: 'Test v1',
        subject: 'v1',
        html: '<p>v1</p>',
        variables: [],
      })

      await templater.register({
        id: 'test',
        name: 'Test v2',
        subject: 'v2',
        html: '<p>v2</p>',
        variables: [],
      })

      const template = await templater.get('test')
      expect(template?.name).toBe('Test v2')
    })
  })

  describe('template rendering', () => {
    beforeEach(async () => {
      // Use string array to avoid template literal parsing ${{ as JavaScript
      const orderHtml = [
        '<h1>Thank you, {{customer.name}}!</h1>',
        '<p>Your order #{{orderId}} has been confirmed.</p>',
        '<h2>Items:</h2>',
        '<ul>',
        '  {{#each items}}',
        '  <li>{{name}} - ${{price}}</li>',
        '  {{/each}}',
        '</ul>',
        '<p>Total: ${{total}}</p>',
      ].join('\n')

      await templater.register({
        id: 'order-confirmation',
        name: 'Order Confirmation',
        subject: 'Order #{{orderId}} Confirmed',
        html: orderHtml,
        variables: [
          { name: 'orderId', type: 'string', required: true },
          { name: 'customer', type: 'object', required: true },
          { name: 'items', type: 'array', required: true },
          { name: 'total', type: 'number', required: true },
        ],
      })
    })

    it('should render template with variables', async () => {
      const context: TemplateContext = {
        variables: {
          orderId: 'ORD-12345',
          customer: { name: 'John Doe' },
          items: [
            { name: 'Widget', price: 9.99 },
            { name: 'Gadget', price: 19.99 },
          ],
          total: 29.98,
        },
      }

      const config: EmailConfig = {
        from: 'orders@example.com',
      }

      const result = await templater.render('order-confirmation', context, config)

      expect(result.subject).toBe('Order #ORD-12345 Confirmed')
      expect(result.html).toContain('Thank you, John Doe!')
      expect(result.html).toContain('Widget')
      expect(result.html).toContain('$29.98')
      expect(result.from).toBe('orders@example.com')
    })

    it('should generate text version from HTML', async () => {
      const context: TemplateContext = {
        variables: {
          orderId: 'ORD-123',
          customer: { name: 'Jane' },
          items: [{ name: 'Product', price: 10 }],
          total: 10,
        },
      }

      const config: EmailConfig = { from: 'test@example.com' }
      const result = await templater.render('order-confirmation', context, config)

      expect(result.text).toBeTruthy()
      expect(result.text).toContain('Thank you')
      expect(result.text).not.toContain('<h1>')
    })

    it('should throw error for non-existent template', async () => {
      const context: TemplateContext = { variables: {} }
      const config: EmailConfig = { from: 'test@example.com' }

      await expect(
        templater.render('nonexistent', context, config)
      ).rejects.toThrow()
    })

    it('should use provided text template instead of generating', async () => {
      await templater.register({
        id: 'with-text',
        name: 'With Text',
        subject: 'Test',
        html: '<p>HTML Version</p>',
        text: 'Plain Text Version',
        variables: [],
      })

      const result = await templater.render(
        'with-text',
        { variables: {} },
        { from: 'test@example.com' }
      )

      expect(result.text).toBe('Plain Text Version')
    })
  })

  describe('variable validation', () => {
    beforeEach(async () => {
      await templater.register({
        id: 'newsletter',
        name: 'Newsletter',
        subject: 'News for {{subscriber.name}}',
        html: '<p>Hello {{subscriber.name}}, here are {{articleCount}} articles.</p>',
        variables: [
          { name: 'subscriber', type: 'object', required: true },
          { name: 'articleCount', type: 'number', required: true },
          { name: 'promoCode', type: 'string', required: false, default: 'NONE' },
        ],
      })
    })

    it('should validate required variables', async () => {
      const result = await templater.validate('newsletter', {})

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(2) // subscriber and articleCount
      expect(result.errors.some(e => e.variable === 'subscriber')).toBe(true)
      expect(result.errors.some(e => e.variable === 'articleCount')).toBe(true)
    })

    it('should pass validation with all required variables', async () => {
      const result = await templater.validate('newsletter', {
        subscriber: { name: 'Test User' },
        articleCount: 5,
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate variable types', async () => {
      const result = await templater.validate('newsletter', {
        subscriber: 'not an object', // Should be object
        articleCount: 'five', // Should be number
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.code === 'INVALID_TYPE')).toBe(true)
    })

    it('should warn about unused variables', async () => {
      const result = await templater.validate('newsletter', {
        subscriber: { name: 'Test' },
        articleCount: 5,
        unusedVar: 'this is not used',
      })

      expect(result.valid).toBe(true)
      expect(result.warnings.some(w => w.code === 'UNUSED_VARIABLE')).toBe(true)
    })
  })

  describe('preview mode', () => {
    beforeEach(async () => {
      await templater.register({
        id: 'preview-test',
        name: 'Preview Test',
        subject: 'Preview: {{title}}',
        html: '<h1>{{title}}</h1><p>{{body}}</p>',
        variables: [
          { name: 'title', type: 'string', required: true },
          { name: 'body', type: 'string', required: true },
        ],
      })
    })

    it('should return preview result with validation', async () => {
      const result = await templater.preview(
        'preview-test',
        {
          variables: {
            title: 'Test Title',
            body: 'Test Body',
          },
        },
        { from: 'preview@example.com' }
      )

      expect(result.isPreview).toBe(true)
      expect(result.rendered.subject).toBe('Preview: Test Title')
      expect(result.validation.valid).toBe(true)
      expect(result.sizeBytes).toBeGreaterThan(0)
      expect(result.previewedAt).toBeInstanceOf(Date)
    })

    it('should include validation errors in preview', async () => {
      const result = await templater.preview(
        'preview-test',
        { variables: { title: 'Test' } }, // Missing body
        { from: 'preview@example.com' }
      )

      expect(result.isPreview).toBe(true)
      expect(result.validation.valid).toBe(false)
      expect(result.validation.errors.some(e => e.variable === 'body')).toBe(true)
    })
  })

  describe('template listing', () => {
    beforeEach(async () => {
      await templater.register({
        id: 'template-a',
        name: 'Template A',
        subject: 'A',
        html: '<p>A</p>',
        variables: [{ name: 'x', type: 'string', required: true }],
      })
      await templater.register({
        id: 'template-b',
        name: 'Template B',
        subject: 'B',
        html: '<p>B</p>',
        variables: [
          { name: 'y', type: 'string', required: true },
          { name: 'z', type: 'number', required: false },
        ],
      })
    })

    it('should list all templates', async () => {
      const list = await templater.list()

      expect(list).toHaveLength(2)
      expect(list.some(t => t.id === 'template-a')).toBe(true)
      expect(list.some(t => t.id === 'template-b')).toBe(true)
    })

    it('should include variable count in list', async () => {
      const list = await templater.list()

      const templateA = list.find(t => t.id === 'template-a')
      const templateB = list.find(t => t.id === 'template-b')

      expect(templateA?.variableCount).toBe(1)
      expect(templateB?.variableCount).toBe(2)
    })

    it('should return empty list when no templates', async () => {
      const emptyTemplater = new EmailTemplater()
      const list = await emptyTemplater.list()
      expect(list).toHaveLength(0)
    })
  })

  describe('template deletion', () => {
    beforeEach(async () => {
      await templater.register({
        id: 'to-delete',
        name: 'To Delete',
        subject: 'Test',
        html: '<p>Test</p>',
        variables: [],
      })
    })

    it('should delete template', async () => {
      await templater.delete('to-delete')
      const template = await templater.get('to-delete')
      expect(template).toBeNull()
    })

    it('should not throw when deleting non-existent template', async () => {
      await expect(templater.delete('nonexistent')).resolves.not.toThrow()
    })
  })

  describe('localization', () => {
    beforeEach(async () => {
      await templater.register({
        id: 'localized',
        name: 'Localized Email',
        subject: 'Welcome',
        html: '<h1>Welcome</h1>',
        variables: [],
        defaultLocale: 'en-US',
      })

      // Add translations
      templater.addTranslation('localized', 'es-ES', {
        subject: 'Bienvenido',
        html: '<h1>Bienvenido</h1>',
      })

      templater.addTranslation('localized', 'fr-FR', {
        subject: 'Bienvenue',
        html: '<h1>Bienvenue</h1>',
      })
    })

    it('should render with default locale', async () => {
      const result = await templater.render(
        'localized',
        { variables: {} },
        { from: 'test@example.com' }
      )

      expect(result.subject).toBe('Welcome')
      expect(result.html).toContain('Welcome')
    })

    it('should render with specified locale', async () => {
      const result = await templater.render(
        'localized',
        { variables: {}, locale: 'es-ES' },
        { from: 'test@example.com' }
      )

      expect(result.subject).toBe('Bienvenido')
      expect(result.html).toContain('Bienvenido')
    })

    it('should fall back to default when locale not found', async () => {
      const result = await templater.render(
        'localized',
        { variables: {}, locale: 'de-DE' }, // No German translation
        { from: 'test@example.com' }
      )

      expect(result.subject).toBe('Welcome')
    })
  })

  describe('attachments', () => {
    beforeEach(async () => {
      await templater.register({
        id: 'with-attachment',
        name: 'With Attachment',
        subject: 'Document Attached',
        html: '<p>Please see attached document.</p>',
        variables: [],
      })
    })

    it('should include attachments in rendered email', async () => {
      const attachment: Attachment = {
        filename: 'document.pdf',
        content: Buffer.from('PDF content').toString('base64'),
        contentType: 'application/pdf',
      }

      const result = await templater.render(
        'with-attachment',
        { variables: {} },
        { from: 'test@example.com', defaultAttachments: [attachment] }
      )

      expect(result.attachments).toHaveLength(1)
      expect(result.attachments?.[0].filename).toBe('document.pdf')
    })

    it('should support inline attachments with cid', async () => {
      await templater.register({
        id: 'with-inline',
        name: 'With Inline Image',
        subject: 'See Image',
        html: '<p>Logo: <img src="cid:logo" /></p>',
        variables: [],
      })

      const attachment: Attachment = {
        filename: 'logo.png',
        content: Buffer.from('PNG data').toString('base64'),
        contentType: 'image/png',
        cid: 'logo',
        disposition: 'inline',
      }

      const result = await templater.render(
        'with-inline',
        { variables: {} },
        { from: 'test@example.com', defaultAttachments: [attachment] }
      )

      expect(result.html).toContain('cid:logo')
      expect(result.attachments?.[0].cid).toBe('logo')
    })
  })

  describe('email configuration', () => {
    beforeEach(async () => {
      await templater.register({
        id: 'config-test',
        name: 'Config Test',
        subject: 'Test',
        html: '<p>Test</p>',
        variables: [],
      })
    })

    it('should include reply-to address', async () => {
      const result = await templater.render(
        'config-test',
        { variables: {} },
        { from: 'noreply@example.com', replyTo: 'support@example.com' }
      )

      expect(result.from).toBe('noreply@example.com')
      expect(result.replyTo).toBe('support@example.com')
    })

    it('should include custom headers', async () => {
      const result = await templater.render(
        'config-test',
        { variables: {} },
        {
          from: 'test@example.com',
          headers: {
            'X-Custom-Header': 'custom-value',
            'X-Priority': '1',
          },
        }
      )

      expect(result.headers?.['X-Custom-Header']).toBe('custom-value')
      expect(result.headers?.['X-Priority']).toBe('1')
    })

    it('should support multiple recipients', async () => {
      const result = await templater.render(
        'config-test',
        { variables: {} },
        { from: 'test@example.com' }
      )

      // Default to empty string for 'to' which will be set by sender
      expect(result.to).toBe('')
    })
  })

  describe('complex templates', () => {
    it('should handle real-world order confirmation template', async () => {
      // Using string concatenation to avoid template literal parsing issues with ${{
      const complexHtml = [
        '<div>',
        '  <h1>{{#if isGift}}Gift Order{{else}}Your Order{{/if}}</h1>',
        '  <p>Order ID: {{order.id}}</p>',
        '  <p>Date: {{order.date}}</p>',
        '',
        '  {{#if customer.isPremium}}',
        '  <div class="premium-badge">Premium Customer</div>',
        '  {{/if}}',
        '',
        '  <h2>Items</h2>',
        '  <table>',
        '    {{#each order.items}}',
        '    <tr>',
        '      <td>{{name}}</td>',
        '      <td>{{quantity}} x ${{unitPrice|default:0}}</td>',
        '      <td>${{total}}</td>',
        '    </tr>',
        '    {{/each}}',
        '  </table>',
        '',
        '  <p>Subtotal: ${{order.subtotal}}</p>',
        '  {{#if order.discount}}',
        '  <p>Discount: -${{order.discount}}</p>',
        '  {{/if}}',
        '  <p><strong>Total: ${{order.total}}</strong></p>',
        '',
        '  {{#if shippingAddress}}',
        '  <h3>Shipping To:</h3>',
        '  <p>',
        '    {{shippingAddress.name}}<br>',
        '    {{shippingAddress.street}}<br>',
        '    {{shippingAddress.city}}, {{shippingAddress.state}} {{shippingAddress.zip}}',
        '  </p>',
        '  {{/if}}',
        '',
        '  {{#unless isGift}}',
        '  <p>Thank you for your order!</p>',
        '  {{/unless}}',
        '',
        '  {{#if isGift}}',
        '  <p>Gift Message: {{giftMessage|default:"Enjoy!"}}</p>',
        '  {{/if}}',
        '</div>',
      ].join('\n')

      await templater.register({
        id: 'complex-order',
        name: 'Complex Order Confirmation',
        subject: '{{#if isGift}}Gift Order{{else}}Order{{/if}} #{{order.id}} - {{order.status}}',
        html: complexHtml,
        variables: [
          { name: 'order', type: 'object', required: true },
          { name: 'customer', type: 'object', required: true },
          { name: 'isGift', type: 'boolean', required: false, default: false },
          { name: 'giftMessage', type: 'string', required: false },
          { name: 'shippingAddress', type: 'object', required: false },
        ],
      })

      const result = await templater.render(
        'complex-order',
        {
          variables: {
            order: {
              id: 'ORD-789',
              date: '2024-01-15',
              status: 'Confirmed',
              items: [
                { name: 'Widget', quantity: 2, unitPrice: 10, total: 20 },
                { name: 'Gadget', quantity: 1, unitPrice: 25, total: 25 },
              ],
              subtotal: 45,
              discount: 5,
              total: 40,
            },
            customer: { name: 'Alice', isPremium: true },
            shippingAddress: {
              name: 'Alice Smith',
              street: '123 Main St',
              city: 'Springfield',
              state: 'IL',
              zip: '62701',
            },
          },
        },
        { from: 'orders@example.com' }
      )

      expect(result.subject).toBe('Order #ORD-789 - Confirmed')
      expect(result.html).toContain('Your Order')
      expect(result.html).toContain('Premium Customer')
      expect(result.html).toContain('Widget')
      expect(result.html).toContain('Gadget')
      expect(result.html).toContain('Discount: -$5')
      expect(result.html).toContain('Total: $40')
      expect(result.html).toContain('Alice Smith')
      expect(result.html).toContain('Thank you for your order!')
    })
  })
})
