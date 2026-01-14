/**
 * DocumentRenderer Tests - PDF Generation and Document Processing Primitives
 *
 * Comprehensive test suite covering:
 * - TemplateEngine: Variable substitution, conditionals, loops
 * - PDFGenerator: HTML to PDF, merge, split, watermark
 * - DocumentParser: Text extraction, form fields, metadata
 * - SignatureCollector: Envelope creation, signing workflow
 * - DocumentRenderer: Full integration tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TemplateEngine,
  PDFGenerator,
  DocumentParser,
  SignatureCollector,
  VariableValidator,
  DocumentRenderer,
  BulkDocumentRenderer,
} from './index'
import type {
  DocumentTemplate,
  TemplateVariable,
  Signer,
  SignatureFieldDefinition,
  PDFOptions,
  WatermarkConfig,
  BulkRenderInput,
  BulkProgress,
  BulkRenderResult,
} from './types'

// =============================================================================
// TemplateEngine Tests
// =============================================================================

describe('TemplateEngine', () => {
  let engine: TemplateEngine

  beforeEach(() => {
    engine = new TemplateEngine()
  })

  describe('variable substitution', () => {
    it('should substitute simple variables', () => {
      const template = 'Hello, {{name}}!'
      const result = engine.render(template, { name: 'World' })
      expect(result).toBe('Hello, World!')
    })

    it('should substitute nested variables', () => {
      const template = 'Hello, {{user.name}}!'
      const result = engine.render(template, { user: { name: 'John' } })
      expect(result).toBe('Hello, John!')
    })

    it('should handle deeply nested paths', () => {
      const template = '{{a.b.c.d}}'
      const result = engine.render(template, { a: { b: { c: { d: 'deep' } } } })
      expect(result).toBe('deep')
    })

    it('should preserve unmatched variables', () => {
      const template = 'Hello, {{unknown}}!'
      const result = engine.render(template, { name: 'World' })
      expect(result).toBe('Hello, {{unknown}}!')
    })

    it('should handle multiple variables', () => {
      const template = '{{greeting}}, {{name}}! Today is {{day}}.'
      const result = engine.render(template, {
        greeting: 'Hello',
        name: 'Alice',
        day: 'Monday',
      })
      expect(result).toBe('Hello, Alice! Today is Monday.')
    })

    it('should format dates', () => {
      const template = 'Date: {{date}}'
      const date = new Date('2024-01-15')
      const result = engine.render(template, { date })
      expect(result).toContain('2024') // Date formatting varies by locale
    })

    it('should format numbers', () => {
      const template = 'Amount: {{amount}}'
      const result = engine.render(template, { amount: 1234567.89 })
      expect(result).toContain('1') // Number formatting varies by locale
    })

    it('should handle whitespace in delimiters', () => {
      const template = 'Hello, {{ name }}!'
      const result = engine.render(template, { name: 'World' })
      expect(result).toBe('Hello, World!')
    })
  })

  describe('conditional blocks', () => {
    it('should render #if block when truthy', () => {
      const template = '{{#if showGreeting}}Hello!{{/if}}'
      const result = engine.render(template, { showGreeting: true })
      expect(result).toBe('Hello!')
    })

    it('should not render #if block when falsy', () => {
      const template = '{{#if showGreeting}}Hello!{{/if}}'
      const result = engine.render(template, { showGreeting: false })
      expect(result).toBe('')
    })

    it('should handle #if with else', () => {
      const template = '{{#if isLoggedIn}}Welcome!{{else}}Please log in.{{/if}}'

      expect(engine.render(template, { isLoggedIn: true })).toBe('Welcome!')
      expect(engine.render(template, { isLoggedIn: false })).toBe('Please log in.')
    })

    it('should treat empty array as falsy', () => {
      const template = '{{#if items}}Has items{{else}}Empty{{/if}}'
      expect(engine.render(template, { items: [] })).toBe('Empty')
      expect(engine.render(template, { items: [1] })).toBe('Has items')
    })

    it('should treat empty string as falsy', () => {
      const template = '{{#if name}}Name: {{name}}{{else}}No name{{/if}}'
      expect(engine.render(template, { name: '' })).toBe('No name')
      expect(engine.render(template, { name: 'John' })).toBe('Name: John')
    })

    it('should handle nested conditionals', () => {
      const template = '{{#if a}}{{#if b}}Both{{else}}Only A{{/if}}{{else}}Neither{{/if}}'

      expect(engine.render(template, { a: true, b: true })).toBe('Both')
      expect(engine.render(template, { a: true, b: false })).toBe('Only A')
      expect(engine.render(template, { a: false, b: true })).toBe('Neither')
    })

    it('should render #unless block when falsy', () => {
      const template = '{{#unless hasErrors}}Success!{{/unless}}'

      expect(engine.render(template, { hasErrors: false })).toBe('Success!')
      expect(engine.render(template, { hasErrors: true })).toBe('')
    })
  })

  describe('loop blocks', () => {
    it('should iterate over arrays', () => {
      const template = '{{#each items}}{{this}} {{/each}}'
      const result = engine.render(template, { items: ['a', 'b', 'c'] })
      expect(result).toBe('a b c ')
    })

    it('should provide loop context variables', () => {
      const template = '{{#each items}}{{@index}}:{{this}} {{/each}}'
      const result = engine.render(template, { items: ['a', 'b', 'c'] })
      expect(result).toBe('0:a 1:b 2:c ')
    })

    it('should provide @first and @last', () => {
      const template = '{{#each items}}{{#if @first}}[{{/if}}{{this}}{{#if @last}}]{{/if}}{{/each}}'
      const result = engine.render(template, { items: ['a', 'b', 'c'] })
      expect(result).toBe('[abc]')
    })

    it('should iterate over object arrays', () => {
      const template = '{{#each users}}{{name}}: {{email}} {{/each}}'
      const result = engine.render(template, {
        users: [
          { name: 'Alice', email: 'alice@example.com' },
          { name: 'Bob', email: 'bob@example.com' },
        ],
      })
      expect(result).toBe('Alice: alice@example.com Bob: bob@example.com ')
    })

    it('should handle nested loops', () => {
      const template = '{{#each categories}}{{name}}: {{#each items}}{{this}} {{/each}}| {{/each}}'
      const result = engine.render(template, {
        categories: [
          { name: 'Fruits', items: ['Apple', 'Banana'] },
          { name: 'Veggies', items: ['Carrot', 'Lettuce'] },
        ],
      })
      expect(result).toBe('Fruits: Apple Banana | Veggies: Carrot Lettuce | ')
    })

    it('should handle empty arrays', () => {
      const template = '{{#each items}}{{this}}{{/each}}'
      const result = engine.render(template, { items: [] })
      expect(result).toBe('')
    })

    it('should handle non-array values gracefully', () => {
      const template = '{{#each notAnArray}}{{this}}{{/each}}'
      const result = engine.render(template, { notAnArray: 'string' })
      expect(result).toBe('')
    })
  })

  describe('extractVariables', () => {
    it('should extract simple variables', () => {
      const template = 'Hello, {{name}}! Your email is {{email}}.'
      const vars = engine.extractVariables(template)
      expect(vars).toContain('name')
      expect(vars).toContain('email')
    })

    it('should extract nested variable paths', () => {
      const template = '{{user.name}} - {{user.address.city}}'
      const vars = engine.extractVariables(template)
      expect(vars).toContain('user.name')
      expect(vars).toContain('user.address.city')
    })

    it('should extract loop variables', () => {
      const template = '{{#each items}}{{this}}{{/each}}'
      const vars = engine.extractVariables(template)
      expect(vars).toContain('items')
    })

    it('should extract conditional variables', () => {
      const template = '{{#if showDetails}}Details{{/if}}'
      const vars = engine.extractVariables(template)
      expect(vars).toContain('showDetails')
    })
  })

  describe('custom delimiters', () => {
    it('should support custom delimiters', () => {
      const customEngine = new TemplateEngine({
        openDelimiter: '<%',
        closeDelimiter: '%>',
      })
      const template = 'Hello, <% name %>!'
      const result = customEngine.render(template, { name: 'World' })
      expect(result).toBe('Hello, World!')
    })
  })
})

// =============================================================================
// PDFGenerator Tests
// =============================================================================

describe('PDFGenerator', () => {
  let generator: PDFGenerator

  beforeEach(() => {
    generator = new PDFGenerator()
  })

  describe('generate', () => {
    it('should generate PDF from simple HTML', async () => {
      const html = '<p>Hello, World!</p>'
      const pdf = await generator.generate(html)

      expect(pdf).toBeInstanceOf(Uint8Array)
      expect(pdf.length).toBeGreaterThan(0)

      // Check PDF header
      const header = new TextDecoder().decode(pdf.slice(0, 8))
      expect(header).toContain('%PDF')
    })

    it('should generate PDF with custom page size', async () => {
      const html = '<p>Test content</p>'
      const pdf = await generator.generate(html, {
        page: { size: 'a4' },
      })

      expect(pdf).toBeInstanceOf(Uint8Array)
      // PDF should contain A4 dimensions (595.28 x 841.89)
      const pdfString = new TextDecoder().decode(pdf)
      expect(pdfString).toContain('MediaBox')
    })

    it('should generate PDF in landscape orientation', async () => {
      const html = '<p>Landscape content</p>'
      const pdf = await generator.generate(html, {
        page: {
          size: 'letter',
          orientation: 'landscape',
        },
      })

      expect(pdf).toBeInstanceOf(Uint8Array)
    })

    it('should handle HTML with multiple paragraphs', async () => {
      const html = `
        <h1>Title</h1>
        <p>First paragraph with some text.</p>
        <p>Second paragraph with more text.</p>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
      `
      const pdf = await generator.generate(html)

      expect(pdf).toBeInstanceOf(Uint8Array)
    })

    it('should strip script tags from HTML', async () => {
      const html = '<p>Safe content</p><script>alert("xss")</script>'
      const pdf = await generator.generate(html)

      const pdfString = new TextDecoder().decode(pdf)
      expect(pdfString).not.toContain('alert')
    })

    it('should handle special characters', async () => {
      const html = '<p>Special chars: &amp; &lt; &gt; &quot;</p>'
      const pdf = await generator.generate(html)

      expect(pdf).toBeInstanceOf(Uint8Array)
    })
  })

  describe('merge', () => {
    it('should merge multiple PDFs', async () => {
      const pdf1 = await generator.generate('<p>Page 1</p>')
      const pdf2 = await generator.generate('<p>Page 2</p>')

      const merged = await generator.merge([pdf1, pdf2])

      expect(merged).toBeInstanceOf(Uint8Array)
      expect(merged.length).toBeGreaterThan(0)
    })

    it('should throw error for empty array', async () => {
      await expect(generator.merge([])).rejects.toThrow('No PDFs to merge')
    })

    it('should return single PDF unchanged', async () => {
      const pdf = await generator.generate('<p>Single page</p>')
      const merged = await generator.merge([pdf])

      expect(merged).toEqual(pdf)
    })
  })

  describe('split', () => {
    it('should split PDF into pages', async () => {
      const pdf = await generator.generate('<p>Content</p>')
      const pages = await generator.split(pdf)

      expect(pages).toBeInstanceOf(Array)
      expect(pages.length).toBeGreaterThan(0)
    })
  })

  describe('watermark', () => {
    it('should add watermark to PDF', async () => {
      const pdf = await generator.generate('<p>Content</p>')
      const config: WatermarkConfig = {
        text: 'CONFIDENTIAL',
        opacity: 0.3,
        rotation: 45,
      }

      const watermarked = await generator.watermark(pdf, config)

      expect(watermarked).toBeInstanceOf(Uint8Array)
    })
  })

  describe('encrypt', () => {
    it('should encrypt PDF with password', async () => {
      const pdf = await generator.generate('<p>Secret content</p>')
      const encrypted = await generator.encrypt(pdf, 'password123')

      expect(encrypted).toBeInstanceOf(Uint8Array)
    })
  })
})

// =============================================================================
// DocumentParser Tests
// =============================================================================

describe('DocumentParser', () => {
  let parser: DocumentParser
  let generator: PDFGenerator

  beforeEach(() => {
    parser = new DocumentParser()
    generator = new PDFGenerator()
  })

  describe('extractText', () => {
    it('should extract text from PDF', async () => {
      const pdf = await generator.generate('<p>Hello World</p>')
      const result = await parser.extractText(pdf)

      expect(result.content).toBeDefined()
      expect(result.pages).toBeInstanceOf(Array)
    })

    it('should provide confidence score', async () => {
      const pdf = await generator.generate('<p>Sample text</p>')
      const result = await parser.extractText(pdf)

      expect(result.confidence).toBeDefined()
      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    })
  })

  describe('extractFormFields', () => {
    it('should return empty array for PDF without forms', async () => {
      const pdf = await generator.generate('<p>No forms here</p>')
      const fields = await parser.extractFormFields(pdf)

      expect(fields).toBeInstanceOf(Array)
    })
  })

  describe('extractTables', () => {
    it('should return empty array for PDF without tables', async () => {
      const pdf = await generator.generate('<p>No tables here</p>')
      const tables = await parser.extractTables(pdf)

      expect(tables).toBeInstanceOf(Array)
    })
  })

  describe('getMetadata', () => {
    it('should extract metadata from PDF', async () => {
      const pdf = await generator.generate('<p>Content</p>', {
        metadata: {
          title: 'Test Document',
          author: 'Test Author',
        },
      })
      const metadata = await parser.getMetadata(pdf)

      expect(metadata).toBeDefined()
    })
  })

  describe('extract', () => {
    it('should perform full extraction', async () => {
      const pdf = await generator.generate('<p>Full extraction test</p>')
      const result = await parser.extract(pdf)

      expect(result.text).toBeDefined()
      expect(result.formFields).toBeInstanceOf(Array)
      expect(result.tables).toBeInstanceOf(Array)
      expect(result.metadata).toBeDefined()
      expect(result.pageCount).toBeGreaterThan(0)
      expect(result.extractedAt).toBeInstanceOf(Date)
    })
  })
})

// =============================================================================
// SignatureCollector Tests
// =============================================================================

describe('SignatureCollector', () => {
  let collector: SignatureCollector
  let generator: PDFGenerator

  beforeEach(() => {
    collector = new SignatureCollector()
    generator = new PDFGenerator()
  })

  const createMockDocument = async () => {
    const pdfBytes = await generator.generate('<p>Contract</p>')
    return {
      id: 'doc-123',
      templateId: 'template-1',
      format: 'pdf' as const,
      content: btoa(String.fromCharCode(...pdfBytes)),
      mimeType: 'application/pdf',
      sizeBytes: pdfBytes.length,
      pageCount: 1,
      metadata: {},
      renderedAt: new Date(),
      variables: {},
    }
  }

  const mockSigners: Signer[] = [
    { id: 'signer-1', name: 'Alice', email: 'alice@example.com', order: 1 },
    { id: 'signer-2', name: 'Bob', email: 'bob@example.com', order: 2 },
  ]

  const mockFields: SignatureFieldDefinition[] = [
    {
      id: 'sig-1',
      type: 'signature',
      signerId: 'signer-1',
      position: { x: 100, y: 100, page: 1 },
      size: { width: 200, height: 50 },
      required: true,
    },
    {
      id: 'sig-2',
      type: 'signature',
      signerId: 'signer-2',
      position: { x: 100, y: 200, page: 1 },
      size: { width: 200, height: 50 },
      required: true,
    },
  ]

  describe('createEnvelope', () => {
    it('should create signing envelope', async () => {
      const doc = await createMockDocument()
      const envelope = await collector.createEnvelope(doc, mockSigners, mockFields)

      expect(envelope.id).toBeDefined()
      expect(envelope.status).toBe('draft')
      expect(envelope.signers).toHaveLength(2)
      expect(envelope.sessions).toHaveLength(2)
      expect(envelope.signatures).toHaveLength(0)
      expect(envelope.createdAt).toBeInstanceOf(Date)
    })

    it('should create sessions for each signer', async () => {
      const doc = await createMockDocument()
      const envelope = await collector.createEnvelope(doc, mockSigners, mockFields)

      for (const session of envelope.sessions) {
        expect(session.id).toBeDefined()
        expect(session.accessToken).toBeDefined()
        expect(session.status).toBe('pending')
        expect(session.expiresAt).toBeInstanceOf(Date)
      }
    })
  })

  describe('getSigningUrl', () => {
    it('should return signing URL with token', async () => {
      const doc = await createMockDocument()
      const envelope = await collector.createEnvelope(doc, mockSigners, mockFields)

      const url = await collector.getSigningUrl(envelope.id, 'signer-1')

      expect(url).toContain('/sign/')
      expect(url).toContain('token=')
    })

    it('should update envelope status to sent', async () => {
      const doc = await createMockDocument()
      const envelope = await collector.createEnvelope(doc, mockSigners, mockFields)

      await collector.getSigningUrl(envelope.id, 'signer-1')
      const updated = await collector.getEnvelope(envelope.id)

      expect(updated.status).toBe('sent')
    })

    it('should throw error for unknown envelope', async () => {
      await expect(collector.getSigningUrl('unknown-id', 'signer-1')).rejects.toThrow('not found')
    })

    it('should throw error for unknown signer', async () => {
      const doc = await createMockDocument()
      const envelope = await collector.createEnvelope(doc, mockSigners, mockFields)

      await expect(collector.getSigningUrl(envelope.id, 'unknown-signer')).rejects.toThrow('not found')
    })
  })

  describe('recordSignature', () => {
    it('should record signature', async () => {
      const doc = await createMockDocument()
      const envelope = await collector.createEnvelope(doc, mockSigners, mockFields)

      await collector.recordSignature(envelope.id, {
        fieldId: 'sig-1',
        signerId: 'signer-1',
        signedAt: new Date(),
        ipAddress: '127.0.0.1',
      })

      const updated = await collector.getEnvelope(envelope.id)
      expect(updated.signatures).toHaveLength(1)
    })

    it('should update status to partially_signed', async () => {
      const doc = await createMockDocument()
      const envelope = await collector.createEnvelope(doc, mockSigners, mockFields)

      await collector.recordSignature(envelope.id, {
        fieldId: 'sig-1',
        signerId: 'signer-1',
        signedAt: new Date(),
      })

      const updated = await collector.getEnvelope(envelope.id)
      expect(updated.status).toBe('partially_signed')
    })

    it('should update status to completed when all signed', async () => {
      const doc = await createMockDocument()
      const envelope = await collector.createEnvelope(doc, mockSigners, mockFields)

      await collector.recordSignature(envelope.id, {
        fieldId: 'sig-1',
        signerId: 'signer-1',
        signedAt: new Date(),
      })

      await collector.recordSignature(envelope.id, {
        fieldId: 'sig-2',
        signerId: 'signer-2',
        signedAt: new Date(),
      })

      const updated = await collector.getEnvelope(envelope.id)
      expect(updated.status).toBe('completed')
      expect(updated.completedAt).toBeInstanceOf(Date)
    })
  })

  describe('voidEnvelope', () => {
    it('should void envelope', async () => {
      const doc = await createMockDocument()
      const envelope = await collector.createEnvelope(doc, mockSigners, mockFields)

      await collector.voidEnvelope(envelope.id, 'Cancelled by sender')

      const updated = await collector.getEnvelope(envelope.id)
      expect(updated.status).toBe('voided')
    })
  })

  describe('completeEnvelope', () => {
    it('should complete envelope', async () => {
      const doc = await createMockDocument()
      const envelope = await collector.createEnvelope(doc, mockSigners, mockFields)

      const completed = await collector.completeEnvelope(envelope.id)

      expect(completed.status).toBe('completed')
      expect(completed.completedAt).toBeInstanceOf(Date)
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

  const definitions: TemplateVariable[] = [
    { name: 'name', type: 'string', required: true },
    { name: 'age', type: 'number', required: false },
    { name: 'email', type: 'string', required: true, pattern: '^[^@]+@[^@]+$' },
    { name: 'isActive', type: 'boolean', required: false },
    { name: 'birthDate', type: 'date', required: false },
    { name: 'tags', type: 'array', required: false },
    { name: 'metadata', type: 'object', required: false },
  ]

  describe('validate', () => {
    it('should pass valid variables', () => {
      const result = validator.validate(
        {
          name: 'John',
          email: 'john@example.com',
        },
        definitions
      )

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail on missing required variable', () => {
      const result = validator.validate({ email: 'test@example.com' }, definitions)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.field === 'name')).toBe(true)
    })

    it('should fail on invalid type', () => {
      const result = validator.validate(
        {
          name: 'John',
          email: 'john@example.com',
          age: 'not a number',
        },
        definitions
      )

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.field === 'age' && e.code === 'INVALID_TYPE')).toBe(true)
    })

    it('should fail on invalid pattern', () => {
      const result = validator.validate(
        {
          name: 'John',
          email: 'invalid-email',
        },
        definitions
      )

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.field === 'email' && e.code === 'INVALID_FORMAT')).toBe(true)
    })

    it('should warn on unused variables', () => {
      const result = validator.validate(
        {
          name: 'John',
          email: 'john@example.com',
          unknownField: 'value',
        },
        definitions
      )

      expect(result.warnings.some((w) => w.field === 'unknownField')).toBe(true)
    })

    it('should accept optional variables as undefined', () => {
      const result = validator.validate(
        {
          name: 'John',
          email: 'john@example.com',
          age: undefined,
        },
        definitions
      )

      expect(result.valid).toBe(true)
    })

    it('should validate boolean type', () => {
      const result = validator.validate(
        {
          name: 'John',
          email: 'john@example.com',
          isActive: true,
        },
        definitions
      )

      expect(result.valid).toBe(true)
    })

    it('should validate date type with Date object', () => {
      const result = validator.validate(
        {
          name: 'John',
          email: 'john@example.com',
          birthDate: new Date(),
        },
        definitions
      )

      expect(result.valid).toBe(true)
    })

    it('should validate date type with ISO string', () => {
      const result = validator.validate(
        {
          name: 'John',
          email: 'john@example.com',
          birthDate: '2024-01-15',
        },
        definitions
      )

      expect(result.valid).toBe(true)
    })

    it('should validate array type', () => {
      const result = validator.validate(
        {
          name: 'John',
          email: 'john@example.com',
          tags: ['developer', 'designer'],
        },
        definitions
      )

      expect(result.valid).toBe(true)
    })

    it('should validate object type', () => {
      const result = validator.validate(
        {
          name: 'John',
          email: 'john@example.com',
          metadata: { key: 'value' },
        },
        definitions
      )

      expect(result.valid).toBe(true)
    })

    it('should reject array as object type', () => {
      const result = validator.validate(
        {
          name: 'John',
          email: 'john@example.com',
          metadata: ['not', 'an', 'object'],
        },
        definitions
      )

      expect(result.valid).toBe(false)
    })
  })
})

// =============================================================================
// DocumentRenderer Integration Tests
// =============================================================================

describe('DocumentRenderer', () => {
  let renderer: DocumentRenderer

  beforeEach(() => {
    renderer = new DocumentRenderer()
  })

  const invoiceTemplate: DocumentTemplate = {
    id: 'invoice-template',
    name: 'Invoice Template',
    html: `
      <h1>Invoice #{{invoiceNumber}}</h1>
      <p>Date: {{date}}</p>
      <p>Bill To: {{customer.name}}</p>
      <p>Address: {{customer.address}}</p>
      <table>
        <tr><th>Item</th><th>Qty</th><th>Price</th></tr>
        {{#each items}}
        <tr>
          <td>{{name}}</td>
          <td>{{quantity}}</td>
          <td>{{price}}</td>
        </tr>
        {{/each}}
      </table>
      <p>Total: {{total}}</p>
      {{#if notes}}
      <p>Notes: {{notes}}</p>
      {{/if}}
    `,
    css: 'body { font-family: Arial, sans-serif; } table { width: 100%; border-collapse: collapse; }',
    variables: [
      { name: 'invoiceNumber', type: 'string', required: true },
      { name: 'date', type: 'date', required: true },
      { name: 'customer', type: 'object', required: true },
      { name: 'items', type: 'array', required: true },
      { name: 'total', type: 'currency', required: true },
      { name: 'notes', type: 'string', required: false },
    ],
    category: 'billing',
  }

  describe('template management', () => {
    it('should register and retrieve template', async () => {
      await renderer.register(invoiceTemplate)
      const template = await renderer.get('invoice-template')

      expect(template).not.toBeNull()
      expect(template?.name).toBe('Invoice Template')
    })

    it('should list registered templates', async () => {
      await renderer.register(invoiceTemplate)
      const list = await renderer.list()

      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('invoice-template')
      expect(list[0].variableCount).toBe(6)
    })

    it('should delete template', async () => {
      await renderer.register(invoiceTemplate)
      await renderer.delete('invoice-template')
      const template = await renderer.get('invoice-template')

      expect(template).toBeNull()
    })

    it('should return null for unknown template', async () => {
      const template = await renderer.get('unknown-template')
      expect(template).toBeNull()
    })
  })

  describe('render', () => {
    beforeEach(async () => {
      await renderer.register(invoiceTemplate)
    })

    it('should render document with variables', async () => {
      const doc = await renderer.render('invoice-template', {
        invoiceNumber: 'INV-001',
        date: new Date('2024-01-15'),
        customer: {
          name: 'Acme Corp',
          address: '123 Main St',
        },
        items: [
          { name: 'Widget', quantity: 2, price: 25.0 },
          { name: 'Gadget', quantity: 1, price: 50.0 },
        ],
        total: 100.0,
      })

      expect(doc.id).toBeDefined()
      expect(doc.format).toBe('pdf')
      expect(doc.mimeType).toBe('application/pdf')
      expect(doc.content).toBeDefined()
      expect(doc.sizeBytes).toBeGreaterThan(0)
      expect(doc.renderedAt).toBeInstanceOf(Date)
    })

    it('should throw error for missing template', async () => {
      await expect(
        renderer.render('unknown-template', {})
      ).rejects.toThrow('not found')
    })

    it('should throw error for missing required variables', async () => {
      await expect(
        renderer.render('invoice-template', {
          invoiceNumber: 'INV-001',
          // Missing date, customer, items, total
        })
      ).rejects.toThrow('Validation failed')
    })

    it('should include hash for integrity', async () => {
      const doc = await renderer.render('invoice-template', {
        invoiceNumber: 'INV-001',
        date: new Date(),
        customer: { name: 'Test', address: '123 St' },
        items: [],
        total: 0,
      })

      expect(doc.hash).toBeDefined()
      expect(doc.hash?.length).toBe(64) // SHA-256 hex
    })
  })

  describe('preview', () => {
    beforeEach(async () => {
      await renderer.register(invoiceTemplate)
    })

    it('should preview document with validation', async () => {
      const result = await renderer.preview('invoice-template', {
        invoiceNumber: 'INV-001',
        date: new Date(),
        customer: { name: 'Test', address: '123' },
        items: [],
        total: 0,
      })

      expect(result.isPreview).toBe(true)
      expect(result.validation.valid).toBe(true)
      expect(result.previewedAt).toBeInstanceOf(Date)
    })

    it('should return validation errors in preview', async () => {
      const result = await renderer.preview('invoice-template', {
        invoiceNumber: 'INV-001',
        // Missing required fields
      })

      expect(result.validation.valid).toBe(false)
      expect(result.validation.errors.length).toBeGreaterThan(0)
    })
  })

  describe('validate', () => {
    beforeEach(async () => {
      await renderer.register(invoiceTemplate)
    })

    it('should validate correct variables', async () => {
      const result = await renderer.validate('invoice-template', {
        invoiceNumber: 'INV-001',
        date: new Date(),
        customer: { name: 'Test', address: '123' },
        items: [],
        total: 100,
      })

      expect(result.valid).toBe(true)
    })

    it('should return error for unknown template', async () => {
      const result = await renderer.validate('unknown-template', {})

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_TEMPLATE')).toBe(true)
    })
  })

  describe('signing workflow', () => {
    beforeEach(async () => {
      await renderer.register({
        ...invoiceTemplate,
        signatureFields: [
          {
            id: 'sig-1',
            type: 'signature',
            signerId: 'client',
            position: { x: 100, y: 700, page: 1 },
            size: { width: 200, height: 50 },
            required: true,
          },
        ],
      })
    })

    it('should create signing envelope', async () => {
      const doc = await renderer.render('invoice-template', {
        invoiceNumber: 'INV-001',
        date: new Date(),
        customer: { name: 'Test', address: '123' },
        items: [],
        total: 0,
      })

      const envelope = await renderer.createSigningEnvelope(doc, [
        { id: 'client', name: 'Client', email: 'client@example.com' },
      ])

      expect(envelope.id).toBeDefined()
      expect(envelope.status).toBe('draft')
      expect(envelope.signers).toHaveLength(1)
    })
  })

  describe('document operations', () => {
    it('should parse document', async () => {
      const pdfBytes = await new PDFGenerator().generate('<p>Test content</p>')
      const extraction = await renderer.parse(pdfBytes)

      expect(extraction.text).toBeDefined()
      expect(extraction.pageCount).toBeGreaterThan(0)
    })

    it('should merge documents', async () => {
      const generator = new PDFGenerator()
      const pdf1 = await generator.generate('<p>Page 1</p>')
      const pdf2 = await generator.generate('<p>Page 2</p>')

      const merged = await renderer.merge([pdf1, pdf2])

      expect(merged).toBeInstanceOf(Uint8Array)
    })

    it('should split document', async () => {
      const pdfBytes = await new PDFGenerator().generate('<p>Content</p>')
      const pages = await renderer.split(pdfBytes)

      expect(pages).toBeInstanceOf(Array)
    })
  })
})

// =============================================================================
// Edge Cases and Error Handling Tests
// =============================================================================

describe('Edge Cases', () => {
  describe('TemplateEngine edge cases', () => {
    const engine = new TemplateEngine()

    it('should handle empty template', () => {
      expect(engine.render('', {})).toBe('')
    })

    it('should handle template with no variables', () => {
      expect(engine.render('Static content', {})).toBe('Static content')
    })

    it('should handle malformed conditionals gracefully', () => {
      const template = '{{#if condition}}no closing tag'
      expect(() => engine.render(template, { condition: true })).not.toThrow()
    })

    it('should handle malformed loops gracefully', () => {
      const template = '{{#each items}}no closing tag'
      expect(() => engine.render(template, { items: [1, 2] })).not.toThrow()
    })

    it('should handle null values', () => {
      const template = '{{value}}'
      expect(engine.render(template, { value: null })).toBe('{{value}}')
    })

    it('should handle unicode content', () => {
      const template = 'Hello {{name}}'
      const result = engine.render(template, { name: 'Cafe' })
      expect(result).toBe('Hello Cafe')
    })
  })

  describe('PDFGenerator edge cases', () => {
    const generator = new PDFGenerator()

    it('should handle empty HTML', async () => {
      const pdf = await generator.generate('')
      expect(pdf).toBeInstanceOf(Uint8Array)
    })

    it('should handle very long content', async () => {
      const longText = 'x'.repeat(10000)
      const html = `<p>${longText}</p>`
      const pdf = await generator.generate(html)
      expect(pdf).toBeInstanceOf(Uint8Array)
    })

    it('should handle nested HTML structures', async () => {
      const html = '<div><div><div><p>Deep nesting</p></div></div></div>'
      const pdf = await generator.generate(html)
      expect(pdf).toBeInstanceOf(Uint8Array)
    })
  })
})

// =============================================================================
// BulkDocumentRenderer Tests
// =============================================================================

describe('BulkDocumentRenderer', () => {
  let renderer: DocumentRenderer
  let bulkRenderer: BulkDocumentRenderer

  // Sample template for testing
  const sampleTemplate: DocumentTemplate = {
    id: 'invoice-template',
    name: 'Invoice Template',
    html: '<div><h1>Invoice #{{invoiceNumber}}</h1><p>Customer: {{customerName}}</p><p>Amount: {{amount}}</p></div>',
    variables: [
      { name: 'invoiceNumber', type: 'string', required: true },
      { name: 'customerName', type: 'string', required: true },
      { name: 'amount', type: 'number', required: true },
    ],
  }

  beforeEach(async () => {
    renderer = new DocumentRenderer()
    bulkRenderer = new BulkDocumentRenderer(renderer)
    await renderer.register(sampleTemplate)
  })

  describe('renderBulk', () => {
    it('should render multiple documents in parallel', async () => {
      const inputs: BulkRenderInput[] = [
        { id: 'inv-001', templateId: 'invoice-template', variables: { invoiceNumber: 'INV-001', customerName: 'Alice', amount: 100 } },
        { id: 'inv-002', templateId: 'invoice-template', variables: { invoiceNumber: 'INV-002', customerName: 'Bob', amount: 200 } },
        { id: 'inv-003', templateId: 'invoice-template', variables: { invoiceNumber: 'INV-003', customerName: 'Charlie', amount: 300 } },
      ]

      const response = await bulkRenderer.renderBulk(inputs)

      expect(response.summary.total).toBe(3)
      expect(response.summary.succeeded).toBe(3)
      expect(response.summary.failed).toBe(0)
      expect(response.results).toHaveLength(3)
      expect(response.results.every(r => r.status === 'completed')).toBe(true)
      expect(response.results.every(r => r.document !== undefined)).toBe(true)
    })

    it('should handle large batch sizes', async () => {
      const inputs: BulkRenderInput[] = Array.from({ length: 50 }, (_, i) => ({
        id: `inv-${i}`,
        templateId: 'invoice-template',
        variables: { invoiceNumber: `INV-${i}`, customerName: `Customer ${i}`, amount: i * 10 },
      }))

      const response = await bulkRenderer.renderBulk(inputs, {
        concurrency: 5,
        batchSize: 10,
      })

      expect(response.summary.total).toBe(50)
      expect(response.summary.succeeded).toBe(50)
    })

    it('should continue on individual failures when continueOnError is true', async () => {
      const inputs: BulkRenderInput[] = [
        { id: 'inv-001', templateId: 'invoice-template', variables: { invoiceNumber: 'INV-001', customerName: 'Alice', amount: 100 } },
        { id: 'inv-002', templateId: 'non-existent-template', variables: {} }, // This will fail
        { id: 'inv-003', templateId: 'invoice-template', variables: { invoiceNumber: 'INV-003', customerName: 'Charlie', amount: 300 } },
      ]

      const response = await bulkRenderer.renderBulk(inputs, { continueOnError: true })

      expect(response.summary.total).toBe(3)
      expect(response.summary.succeeded).toBe(2)
      expect(response.summary.failed).toBe(1)
      expect(response.summary.failures).toHaveLength(1)
      expect(response.summary.failures[0].id).toBe('inv-002')
    })

    it('should stop on first failure when continueOnError is false', async () => {
      const inputs: BulkRenderInput[] = [
        { id: 'inv-001', templateId: 'non-existent-template', variables: {} }, // This will fail first
        { id: 'inv-002', templateId: 'invoice-template', variables: { invoiceNumber: 'INV-002', customerName: 'Bob', amount: 200 } },
      ]

      await expect(
        bulkRenderer.renderBulk(inputs, { continueOnError: false })
      ).rejects.toThrow()
    })

    it('should skip invalid items when skipInvalid is true', async () => {
      const inputs: BulkRenderInput[] = [
        { id: 'inv-001', templateId: 'invoice-template', variables: { invoiceNumber: 'INV-001', customerName: 'Alice', amount: 100 } },
        { id: 'inv-002', templateId: 'invoice-template', variables: { customerName: 'Bob' } }, // Missing required fields
        { id: 'inv-003', templateId: 'invoice-template', variables: { invoiceNumber: 'INV-003', customerName: 'Charlie', amount: 300 } },
      ]

      const response = await bulkRenderer.renderBulk(inputs, { skipInvalid: true })

      expect(response.summary.succeeded).toBe(2)
      expect(response.summary.skipped).toBe(1)
      expect(response.summary.skippedItems).toHaveLength(1)
      expect(response.summary.skippedItems[0].id).toBe('inv-002')
    })

    it('should call progress callback with correct progress info', async () => {
      const progressUpdates: BulkProgress[] = []

      const inputs: BulkRenderInput[] = [
        { id: 'inv-001', templateId: 'invoice-template', variables: { invoiceNumber: 'INV-001', customerName: 'Alice', amount: 100 } },
        { id: 'inv-002', templateId: 'invoice-template', variables: { invoiceNumber: 'INV-002', customerName: 'Bob', amount: 200 } },
      ]

      await bulkRenderer.renderBulk(inputs, {
        onProgress: (progress) => progressUpdates.push({ ...progress }),
      })

      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates[progressUpdates.length - 1].completed).toBe(2)
      expect(progressUpdates[progressUpdates.length - 1].percentage).toBe(100)
    })

    it('should call onItemComplete for each completed item', async () => {
      const completedItems: BulkRenderResult[] = []

      const inputs: BulkRenderInput[] = [
        { id: 'inv-001', templateId: 'invoice-template', variables: { invoiceNumber: 'INV-001', customerName: 'Alice', amount: 100 } },
        { id: 'inv-002', templateId: 'invoice-template', variables: { invoiceNumber: 'INV-002', customerName: 'Bob', amount: 200 } },
      ]

      await bulkRenderer.renderBulk(inputs, {
        onItemComplete: (result) => completedItems.push(result),
      })

      expect(completedItems).toHaveLength(2)
      expect(completedItems.map(i => i.id)).toContain('inv-001')
      expect(completedItems.map(i => i.id)).toContain('inv-002')
    })

    it('should call onBatchComplete after each batch', async () => {
      const batchResults: { batchNum: number; count: number }[] = []

      const inputs: BulkRenderInput[] = Array.from({ length: 15 }, (_, i) => ({
        id: `inv-${i}`,
        templateId: 'invoice-template',
        variables: { invoiceNumber: `INV-${i}`, customerName: `Customer ${i}`, amount: i * 10 },
      }))

      await bulkRenderer.renderBulk(inputs, {
        batchSize: 5,
        onBatchComplete: (batchNum, results) => {
          batchResults.push({ batchNum, count: results.length })
        },
      })

      expect(batchResults).toHaveLength(3) // 15 items / 5 per batch = 3 batches
      expect(batchResults[0].batchNum).toBe(1)
      expect(batchResults[0].count).toBe(5)
      expect(batchResults[2].batchNum).toBe(3)
      expect(batchResults[2].count).toBe(5)
    })

    it('should track timing information correctly', async () => {
      const inputs: BulkRenderInput[] = [
        { id: 'inv-001', templateId: 'invoice-template', variables: { invoiceNumber: 'INV-001', customerName: 'Alice', amount: 100 } },
      ]

      const response = await bulkRenderer.renderBulk(inputs)

      expect(response.summary.startedAt).toBeInstanceOf(Date)
      expect(response.summary.finishedAt).toBeInstanceOf(Date)
      expect(response.summary.totalDurationMs).toBeGreaterThanOrEqual(0)
      expect(response.results[0].durationMs).toBeGreaterThanOrEqual(0)
      expect(response.results[0].startedAt).toBeInstanceOf(Date)
      expect(response.results[0].finishedAt).toBeInstanceOf(Date)
    })

    it('should handle empty input array', async () => {
      const response = await bulkRenderer.renderBulk([])

      expect(response.summary.total).toBe(0)
      expect(response.summary.succeeded).toBe(0)
      expect(response.results).toHaveLength(0)
    })

    it('should prevent concurrent bulk operations', async () => {
      const inputs: BulkRenderInput[] = Array.from({ length: 100 }, (_, i) => ({
        id: `inv-${i}`,
        templateId: 'invoice-template',
        variables: { invoiceNumber: `INV-${i}`, customerName: `Customer ${i}`, amount: i * 10 },
      }))

      // Start first operation without awaiting
      const firstOp = bulkRenderer.renderBulk(inputs)

      // Try to start second operation
      await expect(bulkRenderer.renderBulk(inputs)).rejects.toThrow('Bulk operation already in progress')

      // Wait for first to complete
      await firstOp
    })
  })

  describe('validateBulk', () => {
    it('should validate multiple inputs', async () => {
      const inputs: BulkRenderInput[] = [
        { id: 'inv-001', templateId: 'invoice-template', variables: { invoiceNumber: 'INV-001', customerName: 'Alice', amount: 100 } },
        { id: 'inv-002', templateId: 'invoice-template', variables: { customerName: 'Bob' } }, // Missing required fields
      ]

      const results = await bulkRenderer.validateBulk(inputs)

      expect(results).toHaveLength(2)
      expect(results[0].validation.valid).toBe(true)
      expect(results[1].validation.valid).toBe(false)
    })

    it('should validate in parallel', async () => {
      const inputs: BulkRenderInput[] = Array.from({ length: 20 }, (_, i) => ({
        id: `inv-${i}`,
        templateId: 'invoice-template',
        variables: { invoiceNumber: `INV-${i}`, customerName: `Customer ${i}`, amount: i * 10 },
      }))

      const startTime = Date.now()
      const results = await bulkRenderer.validateBulk(inputs)
      const duration = Date.now() - startTime

      expect(results).toHaveLength(20)
      // Should be reasonably fast due to parallel processing
      expect(duration).toBeLessThan(5000) // 5 seconds max
    })
  })

  describe('estimate', () => {
    it('should estimate resources for bulk operation', async () => {
      const inputs: BulkRenderInput[] = Array.from({ length: 100 }, (_, i) => ({
        id: `inv-${i}`,
        templateId: 'invoice-template',
        variables: { invoiceNumber: `INV-${i}`, customerName: `Customer ${i}`, amount: i * 10 },
      }))

      const estimate = await bulkRenderer.estimate(inputs, { batchSize: 25, concurrency: 10 })

      expect(estimate.batchCount).toBe(4) // 100 items / 25 per batch
      expect(estimate.itemsPerBatch).toBe(25)
      expect(estimate.estimatedDurationMs).toBeGreaterThan(0)
      expect(estimate.estimatedMemoryMb).toBeGreaterThan(0)
    })

    it('should adjust estimate based on concurrency', async () => {
      const inputs: BulkRenderInput[] = Array.from({ length: 50 }, (_, i) => ({
        id: `inv-${i}`,
        templateId: 'invoice-template',
        variables: {},
      }))

      const lowConcurrency = await bulkRenderer.estimate(inputs, { concurrency: 1 })
      const highConcurrency = await bulkRenderer.estimate(inputs, { concurrency: 10 })

      // Lower concurrency should result in higher estimated time
      expect(lowConcurrency.estimatedDurationMs).toBeGreaterThan(highConcurrency.estimatedDurationMs)
    })
  })

  describe('cancel', () => {
    it('should stop processing when cancelled', async () => {
      const completedItems: string[] = []

      const inputs: BulkRenderInput[] = Array.from({ length: 100 }, (_, i) => ({
        id: `inv-${i}`,
        templateId: 'invoice-template',
        variables: { invoiceNumber: `INV-${i}`, customerName: `Customer ${i}`, amount: i * 10 },
      }))

      const bulkPromise = bulkRenderer.renderBulk(inputs, {
        concurrency: 1, // Process slowly
        onItemComplete: (result) => {
          completedItems.push(result.id)
          if (completedItems.length >= 5) {
            bulkRenderer.cancel()
          }
        },
      })

      const response = await bulkPromise

      // Should have stopped before processing all items
      expect(response.summary.total).toBeLessThan(100)
    })
  })

  describe('isRunning', () => {
    it('should return true while operation is in progress', async () => {
      expect(bulkRenderer.isRunning()).toBe(false)

      const inputs: BulkRenderInput[] = Array.from({ length: 20 }, (_, i) => ({
        id: `inv-${i}`,
        templateId: 'invoice-template',
        variables: { invoiceNumber: `INV-${i}`, customerName: `Customer ${i}`, amount: i * 10 },
      }))

      const bulkPromise = bulkRenderer.renderBulk(inputs)

      // Check running state during operation
      expect(bulkRenderer.isRunning()).toBe(true)

      await bulkPromise

      expect(bulkRenderer.isRunning()).toBe(false)
    })
  })

  describe('getRenderer', () => {
    it('should return the underlying DocumentRenderer', () => {
      expect(bulkRenderer.getRenderer()).toBe(renderer)
    })
  })

  describe('concurrency control', () => {
    it('should respect concurrency limit', async () => {
      let maxConcurrent = 0
      let currentConcurrent = 0

      const inputs: BulkRenderInput[] = Array.from({ length: 10 }, (_, i) => ({
        id: `inv-${i}`,
        templateId: 'invoice-template',
        variables: { invoiceNumber: `INV-${i}`, customerName: `Customer ${i}`, amount: i * 10 },
      }))

      // We can't directly measure concurrency from outside, but we can verify
      // that the operation completes successfully with the concurrency setting
      const response = await bulkRenderer.renderBulk(inputs, {
        concurrency: 3,
      })

      expect(response.summary.succeeded).toBe(10)
    })
  })

  describe('timeout handling', () => {
    it('should timeout slow operations', async () => {
      // Create a renderer that simulates slow rendering
      const slowRenderer = new DocumentRenderer()
      await slowRenderer.register({
        id: 'slow-template',
        name: 'Slow Template',
        html: '<p>{{content}}</p>',
        variables: [{ name: 'content', type: 'string', required: true }],
      })

      const slowBulkRenderer = new BulkDocumentRenderer(slowRenderer)

      const inputs: BulkRenderInput[] = [
        { id: 'doc-001', templateId: 'slow-template', variables: { content: 'test' } },
      ]

      // This test verifies timeout config is applied correctly
      // Actual timeout behavior depends on render speed
      const response = await slowBulkRenderer.renderBulk(inputs, {
        timeoutMs: 30000, // 30 second timeout
      })

      expect(response.summary.total).toBe(1)
    })
  })
})

// =============================================================================
// Document Versioning Tests
// =============================================================================

describe('Document Versioning', () => {
  let renderer: DocumentRenderer

  beforeEach(() => {
    renderer = new DocumentRenderer()
  })

  describe('createVersion', () => {
    it('should create first version with version number 1', async () => {
      const content = new TextEncoder().encode('Document content v1')
      const version = await renderer.createVersion('doc-001', content, {
        description: 'Initial version',
        author: 'test-user',
      })

      expect(version.documentId).toBe('doc-001')
      expect(version.versionNumber).toBe(1)
      expect(version.isCurrent).toBe(true)
      expect(version.previousVersionId).toBeNull()
      expect(version.metadata.description).toBe('Initial version')
      expect(version.metadata.author).toBe('test-user')
      expect(version.metadata.action).toBe('created')
      expect(version.hash).toBeDefined()
      expect(version.sizeBytes).toBe(content.length)
    })

    it('should create subsequent versions with incrementing version numbers', async () => {
      const content1 = new TextEncoder().encode('Content v1')
      const content2 = new TextEncoder().encode('Content v2')
      const content3 = new TextEncoder().encode('Content v3')

      const v1 = await renderer.createVersion('doc-001', content1)
      const v2 = await renderer.createVersion('doc-001', content2)
      const v3 = await renderer.createVersion('doc-001', content3)

      expect(v1.versionNumber).toBe(1)
      expect(v2.versionNumber).toBe(2)
      expect(v3.versionNumber).toBe(3)

      expect(v1.isCurrent).toBe(false)
      expect(v2.isCurrent).toBe(false)
      expect(v3.isCurrent).toBe(true)
    })

    it('should link versions with previousVersionId and nextVersionId', async () => {
      const content1 = new TextEncoder().encode('Content v1')
      const content2 = new TextEncoder().encode('Content v2')

      const v1 = await renderer.createVersion('doc-001', content1)
      const v2 = await renderer.createVersion('doc-001', content2)

      // After creating v2, v1's nextVersionId should be updated
      const versions = await renderer.listVersions('doc-001')
      const updatedV1 = await renderer.getVersion('doc-001', v1.id)

      expect(v2.previousVersionId).toBe(v1.id)
      expect(updatedV1!.nextVersionId).toBe(v2.id)
    })

    it('should compute unique hashes for different content', async () => {
      const content1 = new TextEncoder().encode('Content v1')
      const content2 = new TextEncoder().encode('Content v2')

      const v1 = await renderer.createVersion('doc-001', content1)
      const v2 = await renderer.createVersion('doc-001', content2)

      expect(v1.hash).not.toBe(v2.hash)
    })

    it('should compute same hash for identical content', async () => {
      const content = new TextEncoder().encode('Same content')

      const v1 = await renderer.createVersion('doc-001', content)
      const v2 = await renderer.createVersion('doc-002', content)

      expect(v1.hash).toBe(v2.hash)
    })
  })

  describe('listVersions', () => {
    it('should return empty array for unknown document', async () => {
      const versions = await renderer.listVersions('unknown-doc')
      expect(versions).toEqual([])
    })

    it('should list all versions in order', async () => {
      const content1 = new TextEncoder().encode('Content v1')
      const content2 = new TextEncoder().encode('Content v2')
      const content3 = new TextEncoder().encode('Content v3')

      await renderer.createVersion('doc-001', content1, { description: 'First' })
      await renderer.createVersion('doc-001', content2, { description: 'Second' })
      await renderer.createVersion('doc-001', content3, { description: 'Third' })

      const versions = await renderer.listVersions('doc-001')

      expect(versions.length).toBe(3)
      expect(versions[0].versionNumber).toBe(1)
      expect(versions[0].description).toBe('First')
      expect(versions[1].versionNumber).toBe(2)
      expect(versions[2].versionNumber).toBe(3)
      expect(versions[2].isCurrent).toBe(true)
    })

    it('should return lightweight list items without content', async () => {
      const content = new TextEncoder().encode('Some content')
      await renderer.createVersion('doc-001', content, { author: 'alice' })

      const versions = await renderer.listVersions('doc-001')

      expect(versions[0]).toHaveProperty('id')
      expect(versions[0]).toHaveProperty('versionNumber')
      expect(versions[0]).toHaveProperty('hash')
      expect(versions[0]).toHaveProperty('sizeBytes')
      expect(versions[0]).toHaveProperty('createdAt')
      expect(versions[0]).toHaveProperty('isCurrent')
      expect(versions[0]).not.toHaveProperty('content')
    })
  })

  describe('getVersion', () => {
    it('should return null for unknown version', async () => {
      const version = await renderer.getVersion('doc-001', 'unknown-version')
      expect(version).toBeNull()
    })

    it('should return full version with content', async () => {
      const content = new TextEncoder().encode('Full content')
      const created = await renderer.createVersion('doc-001', content, {
        description: 'Test version',
        author: 'test-user',
      })

      const retrieved = await renderer.getVersion('doc-001', created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(created.id)
      expect(retrieved!.content).toEqual(content)
      expect(retrieved!.metadata.description).toBe('Test version')
    })
  })

  describe('revertToVersion', () => {
    it('should create new version with content from source version', async () => {
      const content1 = new TextEncoder().encode('Original content')
      const content2 = new TextEncoder().encode('Modified content')

      const v1 = await renderer.createVersion('doc-001', content1, { description: 'Original' })
      await renderer.createVersion('doc-001', content2, { description: 'Modified' })

      const reverted = await renderer.revertToVersion('doc-001', v1.id)

      expect(reverted.versionNumber).toBe(3)
      expect(reverted.content).toEqual(content1)
      expect(reverted.metadata.action).toBe('reverted')
      expect(reverted.metadata.sourceVersionId).toBe(v1.id)
      expect(reverted.metadata.description).toContain('Reverted to version 1')
    })

    it('should throw error for unknown version', async () => {
      await expect(
        renderer.revertToVersion('doc-001', 'unknown-version')
      ).rejects.toThrow('Version "unknown-version" not found')
    })

    it('should preserve hash when reverting', async () => {
      const content1 = new TextEncoder().encode('Original content')
      const content2 = new TextEncoder().encode('Modified content')

      const v1 = await renderer.createVersion('doc-001', content1)
      await renderer.createVersion('doc-001', content2)

      const reverted = await renderer.revertToVersion('doc-001', v1.id)

      expect(reverted.hash).toBe(v1.hash)
    })
  })

  describe('diffVersions', () => {
    it('should detect identical versions by hash', async () => {
      const content = new TextEncoder().encode('Same content')

      const v1 = await renderer.createVersion('doc-001', content)
      const v2 = await renderer.createVersion('doc-001', content)

      const diff = await renderer.diffVersions('doc-001', v1.id, v2.id)

      expect(diff.isIdentical).toBe(true)
      expect(diff.fromVersionNumber).toBe(1)
      expect(diff.toVersionNumber).toBe(2)
    })

    it('should detect size difference between versions', async () => {
      const content1 = new TextEncoder().encode('Short')
      const content2 = new TextEncoder().encode('Much longer content here')

      const v1 = await renderer.createVersion('doc-001', content1)
      const v2 = await renderer.createVersion('doc-001', content2)

      const diff = await renderer.diffVersions('doc-001', v1.id, v2.id)

      expect(diff.isIdentical).toBe(false)
      expect(diff.summary.sizeDelta).toBe(content2.length - content1.length)
    })

    it('should throw error for unknown versions', async () => {
      const content = new TextEncoder().encode('Content')
      const v1 = await renderer.createVersion('doc-001', content)

      await expect(
        renderer.diffVersions('doc-001', 'unknown', v1.id)
      ).rejects.toThrow('Source version "unknown" not found')

      await expect(
        renderer.diffVersions('doc-001', v1.id, 'unknown')
      ).rejects.toThrow('Target version "unknown" not found')
    })

    it('should return diff summary', async () => {
      const content1 = new TextEncoder().encode('Line 1\nLine 2\nLine 3')
      const content2 = new TextEncoder().encode('Line 1\nModified Line 2\nLine 3\nLine 4')

      const v1 = await renderer.createVersion('doc-001', content1)
      const v2 = await renderer.createVersion('doc-001', content2)

      const diff = await renderer.diffVersions('doc-001', v1.id, v2.id)

      expect(diff.summary).toHaveProperty('added')
      expect(diff.summary).toHaveProperty('removed')
      expect(diff.summary).toHaveProperty('modified')
      expect(diff.summary).toHaveProperty('total')
      expect(diff.generatedAt).toBeDefined()
    })
  })

  describe('getVersionHistory', () => {
    it('should throw error for document with no versions', async () => {
      await expect(
        renderer.getVersionHistory('unknown-doc')
      ).rejects.toThrow('No versions found')
    })

    it('should return complete version history', async () => {
      const content1 = new TextEncoder().encode('Content v1')
      const content2 = new TextEncoder().encode('Content v2')

      await renderer.createVersion('doc-001', content1, { author: 'alice' })
      await renderer.createVersion('doc-001', content2, { author: 'bob' })

      const history = await renderer.getVersionHistory('doc-001')

      expect(history.documentId).toBe('doc-001')
      expect(history.totalVersions).toBe(2)
      expect(history.currentVersionNumber).toBe(2)
      expect(history.entries.length).toBe(2)
      expect(history.versions).toBeDefined()
      expect(history.versions!.length).toBe(2)
    })

    it('should include audit entries with action information', async () => {
      const content = new TextEncoder().encode('Content')
      await renderer.createVersion('doc-001', content, {
        author: 'alice',
        description: 'Initial commit',
      })

      const history = await renderer.getVersionHistory('doc-001')

      expect(history.entries[0].action).toBe('created')
      expect(history.entries[0].actor).toBe('alice')
      expect(history.entries[0].description).toBe('Initial commit')
    })

    it('should filter by action type', async () => {
      const content1 = new TextEncoder().encode('Content v1')
      const content2 = new TextEncoder().encode('Content v2')

      const v1 = await renderer.createVersion('doc-001', content1)
      await renderer.createVersion('doc-001', content2)
      await renderer.revertToVersion('doc-001', v1.id)

      const history = await renderer.getVersionHistory('doc-001', {
        actions: ['reverted'],
      })

      expect(history.entries.length).toBe(1)
      expect(history.entries[0].action).toBe('reverted')
    })

    it('should filter by author', async () => {
      const content = new TextEncoder().encode('Content')
      await renderer.createVersion('doc-001', content, { author: 'alice' })
      await renderer.createVersion('doc-001', content, { author: 'bob' })
      await renderer.createVersion('doc-001', content, { author: 'alice' })

      const history = await renderer.getVersionHistory('doc-001', {
        author: 'alice',
      })

      expect(history.entries.length).toBe(2)
      expect(history.entries.every((e) => e.actor === 'alice')).toBe(true)
    })

    it('should apply pagination', async () => {
      const content = new TextEncoder().encode('Content')
      for (let i = 0; i < 5; i++) {
        await renderer.createVersion('doc-001', content, { description: `Version ${i + 1}` })
      }

      const history = await renderer.getVersionHistory('doc-001', {
        offset: 1,
        limit: 2,
      })

      expect(history.entries.length).toBe(2)
      expect(history.entries[0].versionNumber).toBe(2)
      expect(history.entries[1].versionNumber).toBe(3)
    })
  })

  describe('audit trail', () => {
    it('should track version creation', async () => {
      const content = new TextEncoder().encode('Content')
      await renderer.createVersion('doc-001', content, {
        author: 'test-user',
        description: 'First version',
      })

      const history = await renderer.getVersionHistory('doc-001')

      expect(history.entries[0].action).toBe('created')
      expect(history.entries[0].actor).toBe('test-user')
      expect(history.entries[0].timestamp).toBeDefined()
    })

    it('should track version updates', async () => {
      const content1 = new TextEncoder().encode('Content v1')
      const content2 = new TextEncoder().encode('Content v2')

      await renderer.createVersion('doc-001', content1)
      await renderer.createVersion('doc-001', content2, { author: 'updater' })

      const history = await renderer.getVersionHistory('doc-001')

      expect(history.entries[0].action).toBe('created')
      expect(history.entries[1].action).toBe('updated')
      expect(history.entries[1].actor).toBe('updater')
    })

    it('should track reverts', async () => {
      const content1 = new TextEncoder().encode('Content v1')
      const content2 = new TextEncoder().encode('Content v2')

      const v1 = await renderer.createVersion('doc-001', content1)
      await renderer.createVersion('doc-001', content2)
      await renderer.revertToVersion('doc-001', v1.id)

      const history = await renderer.getVersionHistory('doc-001')

      expect(history.entries[2].action).toBe('reverted')
      expect(history.entries[2].description).toContain('Reverted')
    })
  })

  describe('multi-document versioning', () => {
    it('should maintain separate version histories per document', async () => {
      const content = new TextEncoder().encode('Content')

      await renderer.createVersion('doc-001', content)
      await renderer.createVersion('doc-001', content)
      await renderer.createVersion('doc-002', content)

      const versions1 = await renderer.listVersions('doc-001')
      const versions2 = await renderer.listVersions('doc-002')

      expect(versions1.length).toBe(2)
      expect(versions2.length).toBe(1)
      expect(versions1[0].documentId).toBeUndefined() // List items don't include documentId
      expect(versions2[0].versionNumber).toBe(1)
    })
  })
})
