/**
 * PDFGenerator Tests - HTML to PDF conversion for Workers
 *
 * @module db/primitives/documents/tests/pdf-generator
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createPDFGenerator,
  PDFGenerator,
  type PDFOptions,
  type PDFDocument,
  type PageSize,
  type PageOrientation,
} from '../pdf-generator'

describe('PDFGenerator', () => {
  let generator: PDFGenerator

  beforeEach(() => {
    generator = createPDFGenerator()
  })

  // =============================================================================
  // Basic PDF Generation
  // =============================================================================

  describe('basic generation', () => {
    it('should generate PDF from HTML string', async () => {
      const html = '<h1>Hello World</h1><p>This is a test document.</p>'
      const pdf = await generator.fromHTML(html)

      expect(pdf).toBeDefined()
      expect(pdf.bytes).toBeInstanceOf(Uint8Array)
      expect(pdf.bytes.length).toBeGreaterThan(0)
      expect(pdf.pageCount).toBeGreaterThan(0)
    })

    it('should generate PDF from plain text', async () => {
      const text = 'Hello World\nThis is a test.'
      const pdf = await generator.fromText(text)

      expect(pdf).toBeDefined()
      expect(pdf.bytes).toBeInstanceOf(Uint8Array)
    })

    it('should return PDF metadata', async () => {
      const pdf = await generator.fromHTML('<h1>Test</h1>')

      expect(pdf.metadata).toBeDefined()
      expect(pdf.metadata.createdAt).toBeInstanceOf(Date)
    })

    it('should handle empty content', async () => {
      const pdf = await generator.fromHTML('')

      expect(pdf).toBeDefined()
      expect(pdf.pageCount).toBe(1)
    })
  })

  // =============================================================================
  // Page Configuration
  // =============================================================================

  describe('page configuration', () => {
    it('should support letter page size', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>', {
        pageSize: 'letter',
      })

      expect(pdf.metadata.pageSize).toBe('letter')
    })

    it('should support A4 page size', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>', {
        pageSize: 'A4',
      })

      expect(pdf.metadata.pageSize).toBe('A4')
    })

    it('should support legal page size', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>', {
        pageSize: 'legal',
      })

      expect(pdf.metadata.pageSize).toBe('legal')
    })

    it('should support custom page dimensions', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>', {
        pageSize: { width: 612, height: 792 }, // 8.5x11 inches in points
      })

      expect(pdf).toBeDefined()
    })

    it('should support landscape orientation', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>', {
        orientation: 'landscape',
      })

      expect(pdf.metadata.orientation).toBe('landscape')
    })

    it('should support portrait orientation', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>', {
        orientation: 'portrait',
      })

      expect(pdf.metadata.orientation).toBe('portrait')
    })

    it('should set margins', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>', {
        margins: {
          top: 72,    // 1 inch in points
          bottom: 72,
          left: 72,
          right: 72,
        },
      })

      expect(pdf).toBeDefined()
    })
  })

  // =============================================================================
  // Headers and Footers
  // =============================================================================

  describe('headers and footers', () => {
    it('should add header to all pages', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>'.repeat(100), {
        header: {
          content: '<div>Company Name</div>',
          height: 50,
        },
      })

      expect(pdf).toBeDefined()
    })

    it('should add footer to all pages', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>'.repeat(100), {
        footer: {
          content: '<div>Page {{pageNumber}} of {{totalPages}}</div>',
          height: 30,
        },
      })

      expect(pdf).toBeDefined()
    })

    it('should support page numbers in footer', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>'.repeat(100), {
        footer: {
          content: '{{pageNumber}}/{{totalPages}}',
          height: 30,
        },
      })

      expect(pdf.pageCount).toBeGreaterThan(1)
    })

    it('should skip header/footer on first page', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>'.repeat(100), {
        header: {
          content: 'Header',
          height: 50,
          skipFirst: true,
        },
      })

      expect(pdf).toBeDefined()
    })
  })

  // =============================================================================
  // Metadata
  // =============================================================================

  describe('metadata', () => {
    it('should set document title', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>', {
        metadata: {
          title: 'Invoice #12345',
        },
      })

      expect(pdf.metadata.title).toBe('Invoice #12345')
    })

    it('should set document author', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>', {
        metadata: {
          author: 'John Doe',
        },
      })

      expect(pdf.metadata.author).toBe('John Doe')
    })

    it('should set document subject', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>', {
        metadata: {
          subject: 'Monthly Report',
        },
      })

      expect(pdf.metadata.subject).toBe('Monthly Report')
    })

    it('should set keywords', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>', {
        metadata: {
          keywords: ['invoice', 'billing', '2024'],
        },
      })

      expect(pdf.metadata.keywords).toEqual(['invoice', 'billing', '2024'])
    })

    it('should set creator', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>', {
        metadata: {
          creator: 'dotdo DocumentRenderer',
        },
      })

      expect(pdf.metadata.creator).toBe('dotdo DocumentRenderer')
    })
  })

  // =============================================================================
  // Styling
  // =============================================================================

  describe('styling', () => {
    it('should apply inline CSS', async () => {
      const html = `
        <style>h1 { color: navy; }</style>
        <h1>Styled Heading</h1>
      `
      const pdf = await generator.fromHTML(html)

      expect(pdf).toBeDefined()
    })

    it('should apply CSS from options', async () => {
      const pdf = await generator.fromHTML('<h1>Heading</h1>', {
        css: 'h1 { font-size: 24pt; }',
      })

      expect(pdf).toBeDefined()
    })

    it('should support font embedding', async () => {
      const pdf = await generator.fromHTML('<p>Custom font text</p>', {
        fonts: [{
          family: 'CustomFont',
          src: new Uint8Array([/* font bytes */]),
          weight: 400,
          style: 'normal',
        }],
      })

      expect(pdf).toBeDefined()
    })
  })

  // =============================================================================
  // Images
  // =============================================================================

  describe('images', () => {
    it('should embed base64 images', async () => {
      const html = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />'
      const pdf = await generator.fromHTML(html)

      expect(pdf).toBeDefined()
    })

    it('should handle image from bytes', async () => {
      // 1x1 transparent PNG
      const pngBytes = new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
        0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0,
        0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1,
        13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
      ])

      const pdf = await generator.fromHTML('<p>With image</p>', {
        images: {
          logo: pngBytes,
        },
      })

      expect(pdf).toBeDefined()
    })
  })

  // =============================================================================
  // Page Breaks
  // =============================================================================

  describe('page breaks', () => {
    it('should respect page-break-before CSS', async () => {
      const html = `
        <p>Page 1</p>
        <div style="page-break-before: always;">Page 2</div>
      `
      const pdf = await generator.fromHTML(html)

      expect(pdf.pageCount).toBe(2)
    })

    it('should respect page-break-after CSS', async () => {
      const html = `
        <div style="page-break-after: always;">Page 1</div>
        <p>Page 2</p>
      `
      const pdf = await generator.fromHTML(html)

      expect(pdf.pageCount).toBe(2)
    })

    it('should avoid page breaks inside elements', async () => {
      const html = `
        <div style="page-break-inside: avoid;">
          <p>Keep together</p>
          <p>Keep together</p>
        </div>
      `
      const pdf = await generator.fromHTML(html)

      expect(pdf).toBeDefined()
    })
  })

  // =============================================================================
  // Tables
  // =============================================================================

  describe('tables', () => {
    it('should render HTML tables', async () => {
      const html = `
        <table>
          <thead>
            <tr><th>Item</th><th>Price</th></tr>
          </thead>
          <tbody>
            <tr><td>Widget</td><td>$10</td></tr>
            <tr><td>Gadget</td><td>$20</td></tr>
          </tbody>
        </table>
      `
      const pdf = await generator.fromHTML(html)

      expect(pdf).toBeDefined()
    })

    it('should handle table spanning multiple pages', async () => {
      const rows = Array.from({ length: 100 }, (_, i) =>
        `<tr><td>Row ${i}</td><td>Value ${i}</td></tr>`
      ).join('')

      const html = `
        <table>
          <thead><tr><th>Item</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `
      const pdf = await generator.fromHTML(html)

      expect(pdf.pageCount).toBeGreaterThan(1)
    })
  })

  // =============================================================================
  // Watermarks
  // =============================================================================

  describe('watermarks', () => {
    it('should add text watermark', async () => {
      const pdf = await generator.fromHTML('<p>Document content</p>', {
        watermark: {
          text: 'DRAFT',
          opacity: 0.3,
          rotation: -45,
        },
      })

      expect(pdf).toBeDefined()
    })

    it('should add image watermark', async () => {
      const pdf = await generator.fromHTML('<p>Document content</p>', {
        watermark: {
          image: new Uint8Array([/* image bytes */]),
          opacity: 0.2,
        },
      })

      expect(pdf).toBeDefined()
    })
  })

  // =============================================================================
  // Security
  // =============================================================================

  describe('security', () => {
    it('should set password protection', async () => {
      const pdf = await generator.fromHTML('<p>Secret content</p>', {
        security: {
          userPassword: 'user123',
          ownerPassword: 'owner456',
        },
      })

      expect(pdf.metadata.encrypted).toBe(true)
    })

    it('should set permissions', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>', {
        security: {
          permissions: {
            printing: false,
            copying: false,
            modifying: false,
          },
        },
      })

      expect(pdf.metadata.permissions?.printing).toBe(false)
    })
  })

  // =============================================================================
  // Output Formats
  // =============================================================================

  describe('output formats', () => {
    it('should output as Uint8Array', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>')

      expect(pdf.bytes).toBeInstanceOf(Uint8Array)
    })

    it('should output as base64', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>')
      const base64 = pdf.toBase64()

      expect(typeof base64).toBe('string')
      expect(base64.length).toBeGreaterThan(0)
    })

    it('should output as data URL', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>')
      const dataUrl = pdf.toDataURL()

      expect(dataUrl).toMatch(/^data:application\/pdf;base64,/)
    })

    it('should provide content hash', async () => {
      const pdf = await generator.fromHTML('<p>Content</p>')

      expect(pdf.hash).toBeDefined()
      expect(typeof pdf.hash).toBe('string')
    })
  })

  // =============================================================================
  // Merging PDFs
  // =============================================================================

  describe('merging', () => {
    it('should merge multiple PDFs', async () => {
      const pdf1 = await generator.fromHTML('<p>Page 1</p>')
      const pdf2 = await generator.fromHTML('<p>Page 2</p>')

      const merged = await generator.merge([pdf1, pdf2])

      expect(merged.pageCount).toBe(2)
    })

    it('should merge with options', async () => {
      const pdf1 = await generator.fromHTML('<p>Page 1</p>')
      const pdf2 = await generator.fromHTML('<p>Page 2</p>')

      const merged = await generator.merge([pdf1, pdf2], {
        metadata: {
          title: 'Merged Document',
        },
      })

      expect(merged.metadata.title).toBe('Merged Document')
    })
  })

  // =============================================================================
  // Template Integration
  // =============================================================================

  describe('template integration', () => {
    it('should render from template with data', async () => {
      const template = `
        <h1>Invoice #{{invoiceNumber}}</h1>
        <p>Customer: {{customer}}</p>
        <p>Total: {{total}}</p>
      `

      const pdf = await generator.fromTemplate(template, {
        invoiceNumber: '12345',
        customer: 'Alice Corp',
        total: '$1,234.56',
      })

      expect(pdf).toBeDefined()
    })

    it('should use registered template engine', async () => {
      generator.setTemplateEngine({
        render: (template, data) => template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? '')),
      })

      const pdf = await generator.fromTemplate('<p>Hello {{name}}</p>', { name: 'World' })

      expect(pdf).toBeDefined()
    })
  })

  // =============================================================================
  // Error Handling
  // =============================================================================

  describe('error handling', () => {
    it('should handle invalid HTML gracefully', async () => {
      const html = '<p>Unclosed tag'
      const pdf = await generator.fromHTML(html)

      expect(pdf).toBeDefined()
    })

    it('should handle very large documents', async () => {
      const largeContent = '<p>Content</p>'.repeat(10000)
      const pdf = await generator.fromHTML(largeContent)

      expect(pdf.pageCount).toBeGreaterThan(100)
    })

    it('should handle special characters', async () => {
      const html = '<p>Special chars: & < > " \' \u00A0 \u2019</p>'
      const pdf = await generator.fromHTML(html)

      expect(pdf).toBeDefined()
    })
  })
})
