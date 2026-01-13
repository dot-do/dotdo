/**
 * PDF Generation Tests
 *
 * Tests for the DocumentRenderer primitive's PDF generation capabilities.
 * Following TDD - write tests first, then implement.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  DocumentRenderer,
  PDFDocument,
  PDFPage,
  PDFGenerationOptions,
  PageSize,
  PageOrientation,
  Margin,
  FontFamily,
  TextStyle,
} from '../index'

describe('DocumentRenderer - PDF Generation', () => {
  let renderer: DocumentRenderer

  beforeEach(() => {
    renderer = new DocumentRenderer()
  })

  describe('Basic PDF Creation', () => {
    it('should create an empty PDF document', async () => {
      const pdf = await renderer.createPDF()
      expect(pdf).toBeInstanceOf(PDFDocument)
      expect(pdf.pageCount).toBe(0)
    })

    it('should create a PDF with a single page', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      expect(pdf.pageCount).toBe(1)
      expect(page).toBeInstanceOf(PDFPage)
    })

    it('should create a PDF with multiple pages', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()
      pdf.addPage()
      pdf.addPage()
      expect(pdf.pageCount).toBe(3)
    })

    it('should set document metadata', async () => {
      const pdf = await renderer.createPDF({
        title: 'Test Document',
        author: 'Test Author',
        subject: 'Test Subject',
        keywords: ['test', 'pdf', 'document'],
        creator: 'dotdo',
        producer: 'DocumentRenderer',
      })
      expect(pdf.metadata.title).toBe('Test Document')
      expect(pdf.metadata.author).toBe('Test Author')
      expect(pdf.metadata.subject).toBe('Test Subject')
      expect(pdf.metadata.keywords).toEqual(['test', 'pdf', 'document'])
    })

    it('should generate PDF bytes', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()
      const bytes = await pdf.toBytes()
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.length).toBeGreaterThan(0)
      // PDF magic bytes: %PDF-
      expect(bytes[0]).toBe(0x25) // %
      expect(bytes[1]).toBe(0x50) // P
      expect(bytes[2]).toBe(0x44) // D
      expect(bytes[3]).toBe(0x46) // F
    })

    it('should generate PDF as base64 string', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()
      const base64 = await pdf.toBase64()
      expect(typeof base64).toBe('string')
      expect(base64.length).toBeGreaterThan(0)
      // Decode and verify PDF magic
      const decoded = atob(base64)
      expect(decoded.startsWith('%PDF-')).toBe(true)
    })
  })

  describe('Page Configuration', () => {
    it('should create page with default size (Letter)', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      expect(page.size).toBe(PageSize.Letter)
      expect(page.width).toBe(612) // 8.5 inches * 72 points
      expect(page.height).toBe(792) // 11 inches * 72 points
    })

    it('should create page with A4 size', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage({ size: PageSize.A4 })
      expect(page.size).toBe(PageSize.A4)
      expect(page.width).toBe(595) // 210mm
      expect(page.height).toBe(842) // 297mm
    })

    it('should create page with Legal size', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage({ size: PageSize.Legal })
      expect(page.size).toBe(PageSize.Legal)
      expect(page.width).toBe(612)
      expect(page.height).toBe(1008) // 14 inches
    })

    it('should create page with custom size', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage({ width: 400, height: 600 })
      expect(page.width).toBe(400)
      expect(page.height).toBe(600)
    })

    it('should create page in landscape orientation', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage({
        size: PageSize.Letter,
        orientation: PageOrientation.Landscape,
      })
      expect(page.orientation).toBe(PageOrientation.Landscape)
      expect(page.width).toBe(792) // Swapped
      expect(page.height).toBe(612)
    })

    it('should set page margins', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage({
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      })
      expect(page.margins.top).toBe(72)
      expect(page.margins.right).toBe(72)
      expect(page.margins.bottom).toBe(72)
      expect(page.margins.left).toBe(72)
    })

    it('should use default margins when not specified', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      expect(page.margins.top).toBe(72) // 1 inch default
      expect(page.margins.right).toBe(72)
      expect(page.margins.bottom).toBe(72)
      expect(page.margins.left).toBe(72)
    })
  })

  describe('Text Rendering', () => {
    it('should draw text on page', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawText('Hello, World!', { x: 50, y: 700 })
      const bytes = await pdf.toBytes()
      expect(bytes.length).toBeGreaterThan(0)
    })

    it('should draw text with custom font size', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawText('Large Text', { x: 50, y: 700, fontSize: 24 })
      // Verify the operation was recorded
      expect(page.operations.length).toBeGreaterThan(0)
    })

    it('should draw text with custom font family', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawText('Helvetica Text', {
        x: 50,
        y: 700,
        fontFamily: FontFamily.Helvetica,
      })
      expect(page.operations.length).toBeGreaterThan(0)
    })

    it('should draw bold text', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawText('Bold Text', {
        x: 50,
        y: 700,
        style: TextStyle.Bold,
      })
      expect(page.operations.length).toBeGreaterThan(0)
    })

    it('should draw italic text', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawText('Italic Text', {
        x: 50,
        y: 700,
        style: TextStyle.Italic,
      })
      expect(page.operations.length).toBeGreaterThan(0)
    })

    it('should draw text with custom color', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawText('Red Text', {
        x: 50,
        y: 700,
        color: { r: 255, g: 0, b: 0 },
      })
      expect(page.operations.length).toBeGreaterThan(0)
    })

    it('should draw multiline text', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawText('Line 1\nLine 2\nLine 3', {
        x: 50,
        y: 700,
        lineHeight: 1.5,
      })
      expect(page.operations.length).toBeGreaterThan(0)
    })

    it('should wrap text within maxWidth', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawText(
        'This is a long text that should be wrapped automatically when it exceeds the maximum width',
        { x: 50, y: 700, maxWidth: 200 }
      )
      expect(page.operations.length).toBeGreaterThan(0)
    })

    it('should align text left, center, and right', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawText('Left', { x: 50, y: 700, align: 'left' })
      page.drawText('Center', { x: 50, y: 680, align: 'center', maxWidth: 200 })
      page.drawText('Right', { x: 50, y: 660, align: 'right', maxWidth: 200 })
      expect(page.operations.length).toBe(3)
    })
  })

  describe('Shape Drawing', () => {
    it('should draw a rectangle', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawRectangle({
        x: 50,
        y: 700,
        width: 100,
        height: 50,
        borderColor: { r: 0, g: 0, b: 0 },
        borderWidth: 1,
      })
      expect(page.operations.length).toBe(1)
    })

    it('should draw a filled rectangle', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawRectangle({
        x: 50,
        y: 700,
        width: 100,
        height: 50,
        fillColor: { r: 200, g: 200, b: 200 },
      })
      expect(page.operations.length).toBe(1)
    })

    it('should draw a line', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawLine({
        start: { x: 50, y: 700 },
        end: { x: 200, y: 700 },
        color: { r: 0, g: 0, b: 0 },
        thickness: 1,
      })
      expect(page.operations.length).toBe(1)
    })

    it('should draw a circle', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawCircle({
        x: 100,
        y: 700,
        radius: 30,
        borderColor: { r: 0, g: 0, b: 0 },
      })
      expect(page.operations.length).toBe(1)
    })

    it('should draw an ellipse', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawEllipse({
        x: 100,
        y: 700,
        xRadius: 50,
        yRadius: 30,
        borderColor: { r: 0, g: 0, b: 0 },
      })
      expect(page.operations.length).toBe(1)
    })
  })

  describe('Image Embedding', () => {
    it('should embed a PNG image', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      // Create a minimal 1x1 red PNG
      const redPngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
      await page.drawImage(redPngBase64, {
        x: 50,
        y: 700,
        width: 100,
        height: 100,
      })
      expect(page.operations.length).toBe(1)
    })

    it('should embed a JPEG image', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      // Minimal valid JPEG (1x1 pixel)
      const jpegBase64 =
        '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q=='
      await page.drawImage(jpegBase64, {
        x: 50,
        y: 700,
        width: 100,
        height: 100,
      })
      expect(page.operations.length).toBe(1)
    })

    it('should scale image proportionally', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      const pngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
      await page.drawImage(pngBase64, {
        x: 50,
        y: 700,
        width: 200, // Scale to this width
        fit: 'contain',
      })
      expect(page.operations.length).toBe(1)
    })

    it('should position image with alignment', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      const pngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
      await page.drawImage(pngBase64, {
        x: 50,
        y: 700,
        width: 100,
        height: 100,
        align: 'center',
      })
      expect(page.operations.length).toBe(1)
    })
  })
})

describe('DocumentRenderer - HTML to PDF', () => {
  let renderer: DocumentRenderer

  beforeEach(() => {
    renderer = new DocumentRenderer()
  })

  describe('HTML Conversion', () => {
    it('should convert simple HTML to PDF', async () => {
      const html = '<html><body><h1>Hello World</h1></body></html>'
      const pdf = await renderer.fromHTML(html)
      expect(pdf).toBeInstanceOf(PDFDocument)
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1)
    })

    it('should preserve basic text formatting', async () => {
      const html = `
        <html>
          <body>
            <b>Bold</b>
            <i>Italic</i>
            <u>Underline</u>
          </body>
        </html>
      `
      const pdf = await renderer.fromHTML(html)
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1)
    })

    it('should handle headings (h1-h6)', async () => {
      const html = `
        <html>
          <body>
            <h1>Heading 1</h1>
            <h2>Heading 2</h2>
            <h3>Heading 3</h3>
            <h4>Heading 4</h4>
            <h5>Heading 5</h5>
            <h6>Heading 6</h6>
          </body>
        </html>
      `
      const pdf = await renderer.fromHTML(html)
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1)
    })

    it('should handle paragraphs', async () => {
      const html = `
        <html>
          <body>
            <p>First paragraph with some text.</p>
            <p>Second paragraph with more text.</p>
          </body>
        </html>
      `
      const pdf = await renderer.fromHTML(html)
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1)
    })

    it('should handle unordered lists', async () => {
      const html = `
        <html>
          <body>
            <ul>
              <li>Item 1</li>
              <li>Item 2</li>
              <li>Item 3</li>
            </ul>
          </body>
        </html>
      `
      const pdf = await renderer.fromHTML(html)
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1)
    })

    it('should handle ordered lists', async () => {
      const html = `
        <html>
          <body>
            <ol>
              <li>First item</li>
              <li>Second item</li>
              <li>Third item</li>
            </ol>
          </body>
        </html>
      `
      const pdf = await renderer.fromHTML(html)
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1)
    })

    it('should handle tables', async () => {
      const html = `
        <html>
          <body>
            <table>
              <thead>
                <tr><th>Name</th><th>Age</th></tr>
              </thead>
              <tbody>
                <tr><td>John</td><td>30</td></tr>
                <tr><td>Jane</td><td>25</td></tr>
              </tbody>
            </table>
          </body>
        </html>
      `
      const pdf = await renderer.fromHTML(html)
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1)
    })

    it('should handle inline styles', async () => {
      const html = `
        <html>
          <body>
            <p style="color: red; font-size: 18px;">Red text</p>
            <p style="background-color: yellow;">Highlighted</p>
          </body>
        </html>
      `
      const pdf = await renderer.fromHTML(html)
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1)
    })

    it('should handle embedded images', async () => {
      const html = `
        <html>
          <body>
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==" width="100" height="100">
          </body>
        </html>
      `
      const pdf = await renderer.fromHTML(html)
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1)
    })

    it('should handle links', async () => {
      const html = `
        <html>
          <body>
            <a href="https://example.com">Click here</a>
          </body>
        </html>
      `
      const pdf = await renderer.fromHTML(html)
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1)
    })
  })

  describe('HTML Conversion Options', () => {
    it('should accept page size option', async () => {
      const html = '<html><body><p>Test</p></body></html>'
      const pdf = await renderer.fromHTML(html, { pageSize: PageSize.A4 })
      const page = pdf.getPage(0)
      expect(page.size).toBe(PageSize.A4)
    })

    it('should accept page orientation option', async () => {
      const html = '<html><body><p>Test</p></body></html>'
      const pdf = await renderer.fromHTML(html, {
        orientation: PageOrientation.Landscape,
      })
      const page = pdf.getPage(0)
      expect(page.orientation).toBe(PageOrientation.Landscape)
    })

    it('should accept margin options', async () => {
      const html = '<html><body><p>Test</p></body></html>'
      const pdf = await renderer.fromHTML(html, {
        margins: { top: 50, right: 50, bottom: 50, left: 50 },
      })
      const page = pdf.getPage(0)
      expect(page.margins.top).toBe(50)
    })

    it('should accept header and footer HTML', async () => {
      const html = '<html><body><p>Test content</p></body></html>'
      const pdf = await renderer.fromHTML(html, {
        header: '<div style="text-align: center">Page Header</div>',
        footer: '<div style="text-align: center">Page {pageNumber} of {totalPages}</div>',
      })
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1)
    })

    it('should support CSS styling', async () => {
      const html = `
        <html>
          <head>
            <style>
              body { font-family: Arial; }
              h1 { color: blue; }
              .highlight { background-color: yellow; }
            </style>
          </head>
          <body>
            <h1>Styled Heading</h1>
            <p class="highlight">Highlighted text</p>
          </body>
        </html>
      `
      const pdf = await renderer.fromHTML(html)
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1)
    })
  })
})

describe('DocumentRenderer - Template Rendering', () => {
  let renderer: DocumentRenderer

  beforeEach(() => {
    renderer = new DocumentRenderer()
  })

  describe('Template Engine', () => {
    it('should render template with variable substitution', async () => {
      const template = '<html><body><h1>Hello, {{name}}!</h1></body></html>'
      const pdf = await renderer.renderTemplate(template, { name: 'World' })
      expect(pdf).toBeInstanceOf(PDFDocument)
    })

    it('should handle nested object variables', async () => {
      const template = '<html><body><p>{{user.firstName}} {{user.lastName}}</p></body></html>'
      const pdf = await renderer.renderTemplate(template, {
        user: { firstName: 'John', lastName: 'Doe' },
      })
      expect(pdf).toBeInstanceOf(PDFDocument)
    })

    it('should handle array iteration', async () => {
      const template = `
        <html>
          <body>
            <ul>
              {{#each items}}
              <li>{{this}}</li>
              {{/each}}
            </ul>
          </body>
        </html>
      `
      const pdf = await renderer.renderTemplate(template, {
        items: ['Apple', 'Banana', 'Cherry'],
      })
      expect(pdf).toBeInstanceOf(PDFDocument)
    })

    it('should handle conditional rendering', async () => {
      const template = `
        <html>
          <body>
            {{#if showMessage}}
            <p>Message is visible</p>
            {{else}}
            <p>Message is hidden</p>
            {{/if}}
          </body>
        </html>
      `
      const pdf1 = await renderer.renderTemplate(template, { showMessage: true })
      const pdf2 = await renderer.renderTemplate(template, { showMessage: false })
      expect(pdf1).toBeInstanceOf(PDFDocument)
      expect(pdf2).toBeInstanceOf(PDFDocument)
    })

    it('should format dates', async () => {
      const template = '<html><body><p>Date: {{formatDate date "YYYY-MM-DD"}}</p></body></html>'
      const pdf = await renderer.renderTemplate(template, {
        date: new Date('2024-01-15'),
      })
      expect(pdf).toBeInstanceOf(PDFDocument)
    })

    it('should format numbers', async () => {
      const template = '<html><body><p>Amount: {{formatNumber amount "0,0.00"}}</p></body></html>'
      const pdf = await renderer.renderTemplate(template, { amount: 1234.5 })
      expect(pdf).toBeInstanceOf(PDFDocument)
    })

    it('should format currency', async () => {
      const template = '<html><body><p>Price: {{formatCurrency price "USD"}}</p></body></html>'
      const pdf = await renderer.renderTemplate(template, { price: 99.99 })
      expect(pdf).toBeInstanceOf(PDFDocument)
    })
  })

  describe('Pre-built Templates', () => {
    it('should render invoice template', async () => {
      const pdf = await renderer.renderInvoice({
        invoiceNumber: 'INV-001',
        date: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        from: {
          name: 'Acme Corp',
          address: '123 Main St',
          city: 'New York',
          country: 'USA',
        },
        to: {
          name: 'Client Inc',
          address: '456 Oak Ave',
          city: 'Los Angeles',
          country: 'USA',
        },
        items: [
          { description: 'Service A', quantity: 2, unitPrice: 100 },
          { description: 'Service B', quantity: 1, unitPrice: 250 },
        ],
        tax: 0.1,
        currency: 'USD',
      })
      expect(pdf).toBeInstanceOf(PDFDocument)
    })

    it('should render receipt template', async () => {
      const pdf = await renderer.renderReceipt({
        receiptNumber: 'RCP-001',
        date: new Date(),
        merchant: {
          name: 'Store Inc',
          address: '789 Pine St',
        },
        items: [
          { name: 'Product A', price: 29.99 },
          { name: 'Product B', price: 49.99 },
        ],
        subtotal: 79.98,
        tax: 8.0,
        total: 87.98,
        paymentMethod: 'Credit Card',
      })
      expect(pdf).toBeInstanceOf(PDFDocument)
    })

    it('should render contract template', async () => {
      const pdf = await renderer.renderContract({
        title: 'Service Agreement',
        effectiveDate: new Date(),
        parties: [
          { name: 'Company A', role: 'Provider' },
          { name: 'Company B', role: 'Client' },
        ],
        terms: [
          { title: 'Term 1', content: 'Description of term 1' },
          { title: 'Term 2', content: 'Description of term 2' },
        ],
        signatures: [
          { name: 'John Doe', title: 'CEO, Company A' },
          { name: 'Jane Smith', title: 'CEO, Company B' },
        ],
      })
      expect(pdf).toBeInstanceOf(PDFDocument)
    })

    it('should render letter template', async () => {
      const pdf = await renderer.renderLetter({
        date: new Date(),
        from: {
          name: 'John Doe',
          address: '123 Main St',
          city: 'New York, NY 10001',
        },
        to: {
          name: 'Jane Smith',
          address: '456 Oak Ave',
          city: 'Los Angeles, CA 90001',
        },
        subject: 'RE: Your Inquiry',
        body: 'Dear Jane,\n\nThank you for your inquiry...',
        signature: 'Best regards,\nJohn Doe',
      })
      expect(pdf).toBeInstanceOf(PDFDocument)
    })
  })
})

describe('DocumentRenderer - PDF Operations', () => {
  let renderer: DocumentRenderer

  beforeEach(() => {
    renderer = new DocumentRenderer()
  })

  describe('PDF Merging', () => {
    it('should merge two PDFs', async () => {
      const pdf1 = await renderer.createPDF()
      pdf1.addPage()
      pdf1.addPage()

      const pdf2 = await renderer.createPDF()
      pdf2.addPage()

      const merged = await renderer.mergePDFs([pdf1, pdf2])
      expect(merged.pageCount).toBe(3)
    })

    it('should merge multiple PDFs', async () => {
      const pdfs = await Promise.all([
        renderer.createPDF().then((p) => {
          p.addPage()
          return p
        }),
        renderer.createPDF().then((p) => {
          p.addPage()
          p.addPage()
          return p
        }),
        renderer.createPDF().then((p) => {
          p.addPage()
          return p
        }),
      ])

      const merged = await renderer.mergePDFs(pdfs)
      expect(merged.pageCount).toBe(4)
    })

    it('should merge PDFs from bytes', async () => {
      const pdf1 = await renderer.createPDF()
      pdf1.addPage()
      const bytes1 = await pdf1.toBytes()

      const pdf2 = await renderer.createPDF()
      pdf2.addPage()
      const bytes2 = await pdf2.toBytes()

      const merged = await renderer.mergePDFBytes([bytes1, bytes2])
      expect(merged.pageCount).toBe(2)
    })

    it('should preserve page content after merge', async () => {
      const pdf1 = await renderer.createPDF()
      const page1 = pdf1.addPage()
      page1.drawText('Document 1', { x: 50, y: 700 })

      const pdf2 = await renderer.createPDF()
      const page2 = pdf2.addPage()
      page2.drawText('Document 2', { x: 50, y: 700 })

      const merged = await renderer.mergePDFs([pdf1, pdf2])
      expect(merged.pageCount).toBe(2)
      // Content verification would require parsing
    })
  })

  describe('PDF Splitting', () => {
    it('should split PDF into individual pages', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()
      pdf.addPage()
      pdf.addPage()

      const split = await renderer.splitPDF(pdf)
      expect(split.length).toBe(3)
      expect(split[0].pageCount).toBe(1)
      expect(split[1].pageCount).toBe(1)
      expect(split[2].pageCount).toBe(1)
    })

    it('should split PDF by page ranges', async () => {
      const pdf = await renderer.createPDF()
      for (let i = 0; i < 10; i++) {
        pdf.addPage()
      }

      const split = await renderer.splitPDF(pdf, {
        ranges: [
          { start: 0, end: 2 }, // Pages 1-3
          { start: 3, end: 5 }, // Pages 4-6
          { start: 6, end: 9 }, // Pages 7-10
        ],
      })

      expect(split.length).toBe(3)
      expect(split[0].pageCount).toBe(3)
      expect(split[1].pageCount).toBe(3)
      expect(split[2].pageCount).toBe(4)
    })

    it('should extract specific pages', async () => {
      const pdf = await renderer.createPDF()
      for (let i = 0; i < 5; i++) {
        pdf.addPage()
      }

      const extracted = await renderer.extractPages(pdf, [0, 2, 4])
      expect(extracted.pageCount).toBe(3)
    })

    it('should remove specific pages', async () => {
      const pdf = await renderer.createPDF()
      for (let i = 0; i < 5; i++) {
        pdf.addPage()
      }

      const result = await renderer.removePages(pdf, [1, 3])
      expect(result.pageCount).toBe(3)
    })
  })

  describe('Watermarks', () => {
    it('should add text watermark to all pages', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()
      pdf.addPage()

      await renderer.addWatermark(pdf, {
        text: 'CONFIDENTIAL',
        opacity: 0.3,
        rotation: -45,
      })

      expect(pdf.pageCount).toBe(2)
    })

    it('should add image watermark', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()

      const logoBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

      await renderer.addWatermark(pdf, {
        image: logoBase64,
        opacity: 0.2,
        position: 'center',
      })

      expect(pdf.pageCount).toBe(1)
    })

    it('should position watermark (top-left, center, bottom-right)', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()

      await renderer.addWatermark(pdf, {
        text: 'DRAFT',
        position: 'top-left',
      })

      await renderer.addWatermark(pdf, {
        text: 'DRAFT',
        position: 'bottom-right',
      })

      expect(pdf.pageCount).toBe(1)
    })

    it('should apply watermark to specific pages only', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()
      pdf.addPage()
      pdf.addPage()

      await renderer.addWatermark(pdf, {
        text: 'SAMPLE',
        pages: [0, 2], // Only first and third pages
      })

      expect(pdf.pageCount).toBe(3)
    })
  })

  describe('Headers and Footers', () => {
    it('should add header to all pages', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()
      pdf.addPage()

      await renderer.addHeader(pdf, {
        text: 'Document Title',
        fontSize: 10,
        align: 'center',
      })

      expect(pdf.pageCount).toBe(2)
    })

    it('should add footer with page numbers', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()
      pdf.addPage()
      pdf.addPage()

      await renderer.addFooter(pdf, {
        text: 'Page {pageNumber} of {totalPages}',
        fontSize: 10,
        align: 'center',
      })

      expect(pdf.pageCount).toBe(3)
    })

    it('should add header with left and right sections', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()

      await renderer.addHeader(pdf, {
        left: 'Company Name',
        right: 'Report Date: 2024-01-15',
        fontSize: 9,
      })

      expect(pdf.pageCount).toBe(1)
    })

    it('should add header with image logo', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()

      const logoBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

      await renderer.addHeader(pdf, {
        image: logoBase64,
        imageWidth: 50,
        imageHeight: 20,
        text: 'Company Report',
        align: 'left',
      })

      expect(pdf.pageCount).toBe(1)
    })
  })

  describe('Page Manipulation', () => {
    it('should rotate page', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()

      page.rotate(90)
      expect(page.rotation).toBe(90)
    })

    it('should scale page content', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()
      page.drawText('Test', { x: 100, y: 100 })

      page.scale(0.5)
      expect(page.scaleFactor).toBe(0.5)
    })

    it('should reorder pages', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage() // Page 0
      pdf.addPage() // Page 1
      pdf.addPage() // Page 2

      pdf.reorderPages([2, 0, 1])
      expect(pdf.pageCount).toBe(3)
      // Verify order change (would need content verification)
    })

    it('should insert page at specific position', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage() // Page 0
      pdf.addPage() // Page 1

      pdf.insertPage(1) // Insert at position 1
      expect(pdf.pageCount).toBe(3)
    })

    it('should copy page from another PDF', async () => {
      const source = await renderer.createPDF()
      const sourcePage = source.addPage()
      sourcePage.drawText('Source Content', { x: 50, y: 700 })

      const target = await renderer.createPDF()
      target.addPage()

      await target.copyPageFrom(source, 0)
      expect(target.pageCount).toBe(2)
    })
  })
})

describe('DocumentRenderer - PDF Security', () => {
  let renderer: DocumentRenderer

  beforeEach(() => {
    renderer = new DocumentRenderer()
  })

  describe('Password Protection', () => {
    it('should encrypt PDF with user password', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()

      await pdf.encrypt({
        userPassword: 'user123',
      })

      const bytes = await pdf.toBytes()
      expect(bytes.length).toBeGreaterThan(0)
    })

    it('should encrypt PDF with owner password', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()

      await pdf.encrypt({
        ownerPassword: 'owner456',
        userPassword: 'user123',
      })

      const bytes = await pdf.toBytes()
      expect(bytes.length).toBeGreaterThan(0)
    })

    it('should set permissions when encrypting', async () => {
      const pdf = await renderer.createPDF()
      pdf.addPage()

      await pdf.encrypt({
        userPassword: 'user123',
        permissions: {
          printing: true,
          modifying: false,
          copying: false,
          annotating: true,
        },
      })

      const bytes = await pdf.toBytes()
      expect(bytes.length).toBeGreaterThan(0)
    })
  })

  describe('Digital Signatures', () => {
    it('should add signature placeholder', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()

      page.addSignatureField({
        name: 'Signature1',
        x: 100,
        y: 100,
        width: 200,
        height: 50,
      })

      expect(page.signatureFields.length).toBe(1)
    })

    it('should add multiple signature fields', async () => {
      const pdf = await renderer.createPDF()
      const page = pdf.addPage()

      page.addSignatureField({
        name: 'Signer1',
        x: 100,
        y: 200,
        width: 150,
        height: 40,
      })

      page.addSignatureField({
        name: 'Signer2',
        x: 300,
        y: 200,
        width: 150,
        height: 40,
      })

      expect(page.signatureFields.length).toBe(2)
    })
  })
})
