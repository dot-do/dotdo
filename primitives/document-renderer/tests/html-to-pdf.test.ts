/**
 * HTML to PDF Conversion Tests - RED Phase
 *
 * These tests define the desired behavior for HTML to PDF conversion with full CSS support.
 * The current implementation uses a simple text extraction approach. These tests drive
 * the implementation of proper HTML rendering with CSS styling, layout, and media features.
 *
 * Target Implementation:
 * - Full HTML/CSS rendering in Workers environment (no Puppeteer)
 * - CSS styling preservation (colors, fonts, borders, backgrounds)
 * - Page breaks and margins via CSS print media
 * - Headers/footers with dynamic content (page numbers, dates)
 * - Image embedding (base64, URLs, SVG)
 *
 * RED Tests: These tests will fail until the HTMLToPDFConverter is implemented.
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Types that will be implemented
interface HTMLToPDFOptions {
  page?: {
    size?: 'letter' | 'legal' | 'a4' | 'a3' | { width: number; height: number }
    orientation?: 'portrait' | 'landscape'
    margins?: {
      top?: number | string
      right?: number | string
      bottom?: number | string
      left?: number | string
    }
  }
  header?: {
    html: string
    height?: number | string
  }
  footer?: {
    html: string
    height?: number | string
  }
  printBackground?: boolean
  preferCSSPageSize?: boolean
  scale?: number
}

interface PDFResult {
  bytes: Uint8Array
  pageCount: number
  metadata: {
    title?: string
    author?: string
    subject?: string
    keywords?: string[]
    creationDate: Date
  }
}

// Placeholder for the class that will be implemented
class HTMLToPDFConverter {
  async convert(_html: string, _options?: HTMLToPDFOptions): Promise<PDFResult> {
    throw new Error('Not implemented')
  }
}

describe('HTMLToPDFConverter - Basic HTML Conversion', () => {
  let converter: HTMLToPDFConverter

  beforeEach(() => {
    converter = new HTMLToPDFConverter()
  })

  describe('Simple HTML Elements', () => {
    it('should convert plain text to PDF', async () => {
      const html = '<p>Hello, World!</p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.bytes.length).toBeGreaterThan(0)
      expect(result.pageCount).toBe(1)
    })

    it('should convert headings h1-h6 with proper sizing', async () => {
      const html = `
        <h1>Heading 1</h1>
        <h2>Heading 2</h2>
        <h3>Heading 3</h3>
        <h4>Heading 4</h4>
        <h5>Heading 5</h5>
        <h6>Heading 6</h6>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBeGreaterThanOrEqual(1)
    })

    it('should convert paragraphs with proper spacing', async () => {
      const html = `
        <p>First paragraph with some content.</p>
        <p>Second paragraph with more content.</p>
        <p>Third paragraph to test spacing.</p>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should convert unordered lists with bullet points', async () => {
      const html = `
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
          <li>Item 3</li>
        </ul>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      // PDF should contain bullet point markers
      expect(result.bytes.length).toBeGreaterThan(100)
    })

    it('should convert ordered lists with numbers', async () => {
      const html = `
        <ol>
          <li>First item</li>
          <li>Second item</li>
          <li>Third item</li>
        </ol>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      // PDF should contain numbered list markers
      expect(result.bytes.length).toBeGreaterThan(100)
    })

    it('should convert nested lists', async () => {
      const html = `
        <ul>
          <li>Parent item
            <ul>
              <li>Child item 1</li>
              <li>Child item 2</li>
            </ul>
          </li>
          <li>Another parent</li>
        </ul>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should convert tables with rows and columns', async () => {
      const html = `
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Age</th>
              <th>City</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Alice</td>
              <td>30</td>
              <td>New York</td>
            </tr>
            <tr>
              <td>Bob</td>
              <td>25</td>
              <td>Los Angeles</td>
            </tr>
          </tbody>
        </table>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should convert links preserving href', async () => {
      const html = '<a href="https://example.com">Click here</a>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      // PDF should contain link annotation
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toContain('/URI')
    })

    it('should convert blockquotes with proper indentation', async () => {
      const html = `
        <blockquote>
          This is a quoted text that should be indented.
        </blockquote>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should convert code blocks with monospace font', async () => {
      const html = `
        <pre><code>
function hello() {
  console.log('Hello, World!');
}
        </code></pre>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      // Should use monospace font
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toMatch(/Courier|Monaco|Consolas/i)
    })

    it('should convert inline code with distinct styling', async () => {
      const html = '<p>Use <code>console.log()</code> for debugging.</p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should convert horizontal rules', async () => {
      const html = `
        <p>Above the line</p>
        <hr />
        <p>Below the line</p>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })
  })

  describe('Text Formatting', () => {
    it('should render bold text', async () => {
      const html = '<p>This is <strong>bold</strong> text.</p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      // PDF should contain bold font reference
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toMatch(/Bold|700/i)
    })

    it('should render italic text', async () => {
      const html = '<p>This is <em>italic</em> text.</p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      // PDF should contain italic font reference
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toMatch(/Italic|Oblique/i)
    })

    it('should render underlined text', async () => {
      const html = '<p>This is <u>underlined</u> text.</p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should render strikethrough text', async () => {
      const html = '<p>This is <del>deleted</del> text.</p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should render subscript and superscript', async () => {
      const html = '<p>H<sub>2</sub>O and E=mc<sup>2</sup></p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should render combined formatting', async () => {
      const html = '<p>This is <strong><em>bold italic</em></strong> text.</p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      // PDF should contain bold-italic font reference
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toMatch(/BoldItalic|BoldOblique/i)
    })
  })

  describe('Full Document Structure', () => {
    it('should convert complete HTML document', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Document</title>
            <meta name="author" content="Test Author">
          </head>
          <body>
            <h1>Document Title</h1>
            <p>Document content goes here.</p>
          </body>
        </html>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.metadata.title).toBe('Test Document')
      expect(result.metadata.author).toBe('Test Author')
    })

    it('should extract metadata from meta tags', async () => {
      const html = `
        <html>
          <head>
            <title>Report 2026</title>
            <meta name="author" content="Jane Doe">
            <meta name="subject" content="Annual Report">
            <meta name="keywords" content="report, annual, 2026">
          </head>
          <body><p>Content</p></body>
        </html>
      `
      const result = await converter.convert(html)

      expect(result.metadata.title).toBe('Report 2026')
      expect(result.metadata.author).toBe('Jane Doe')
      expect(result.metadata.subject).toBe('Annual Report')
      expect(result.metadata.keywords).toEqual(['report', 'annual', '2026'])
    })
  })
})

describe('HTMLToPDFConverter - CSS Styling Preservation', () => {
  let converter: HTMLToPDFConverter

  beforeEach(() => {
    converter = new HTMLToPDFConverter()
  })

  describe('Inline Styles', () => {
    it('should preserve text color', async () => {
      const html = '<p style="color: #ff0000;">Red text</p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      // PDF should contain red color command
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toMatch(/1\s+0\s+0\s+rg|1\.0+\s+0\.0+\s+0\.0+\s+rg/)
    })

    it('should preserve background color', async () => {
      const html = '<div style="background-color: #0000ff; padding: 10px;">Blue background</div>'
      const result = await converter.convert(html, { printBackground: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      // PDF should contain blue color for background
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toMatch(/0\s+0\s+1\s+RG|0\.0+\s+0\.0+\s+1\.0+\s+RG/)
    })

    it('should preserve font-size', async () => {
      const html = '<p style="font-size: 24px;">Large text</p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      // PDF should contain font size command
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toMatch(/\/F\d+\s+24\s+Tf/)
    })

    it('should preserve font-weight', async () => {
      const html = '<p style="font-weight: bold;">Bold text</p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toMatch(/Bold|700/)
    })

    it('should preserve font-family', async () => {
      const html = '<p style="font-family: Georgia, serif;">Serif text</p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toMatch(/Georgia|Times/)
    })

    it('should preserve text-align', async () => {
      const html = `
        <p style="text-align: left;">Left aligned</p>
        <p style="text-align: center;">Center aligned</p>
        <p style="text-align: right;">Right aligned</p>
        <p style="text-align: justify;">Justified text that spans multiple lines to demonstrate justification behavior.</p>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should preserve line-height', async () => {
      const html = '<p style="line-height: 2;">Double spaced text</p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should preserve letter-spacing', async () => {
      const html = '<p style="letter-spacing: 2px;">S p a c e d text</p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })
  })

  describe('CSS Classes and Stylesheets', () => {
    it('should apply embedded stylesheet', async () => {
      const html = `
        <style>
          .highlight { background-color: yellow; color: black; }
          .important { font-weight: bold; color: red; }
        </style>
        <p class="highlight">Highlighted text</p>
        <p class="important">Important text</p>
      `
      const result = await converter.convert(html, { printBackground: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should apply CSS from style tag in head', async () => {
      const html = `
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; }
              h1 { color: navy; }
              p { margin: 10px 0; }
            </style>
          </head>
          <body>
            <h1>Styled Heading</h1>
            <p>Styled paragraph</p>
          </body>
        </html>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toMatch(/Arial|Helvetica/)
    })

    it('should handle CSS specificity correctly', async () => {
      const html = `
        <style>
          p { color: blue; }
          .red { color: red; }
          #special { color: green; }
        </style>
        <p>Blue text</p>
        <p class="red">Red text</p>
        <p id="special" class="red">Green text (id wins)</p>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should support CSS variables', async () => {
      const html = `
        <style>
          :root {
            --primary-color: #007bff;
            --font-size: 16px;
          }
          p { color: var(--primary-color); font-size: var(--font-size); }
        </style>
        <p>Text using CSS variables</p>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })
  })

  describe('Box Model', () => {
    it('should preserve padding', async () => {
      const html = '<div style="padding: 20px; background: #eee;">Padded content</div>'
      const result = await converter.convert(html, { printBackground: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should preserve margin', async () => {
      const html = `
        <div style="margin-bottom: 50px;">First block</div>
        <div>Second block</div>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should preserve border styles', async () => {
      const html = `
        <div style="border: 2px solid #333; padding: 10px;">Bordered content</div>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      // PDF should contain line drawing commands
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toMatch(/re\s+S|re\s+s/)
    })

    it('should preserve border-radius', async () => {
      const html = '<div style="border: 1px solid #000; border-radius: 10px; padding: 10px;">Rounded corners</div>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should preserve width and height', async () => {
      const html = '<div style="width: 200px; height: 100px; background: #ccc;">Fixed size</div>'
      const result = await converter.convert(html, { printBackground: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })
  })

  describe('Flexbox Layout', () => {
    it('should render flexbox container', async () => {
      const html = `
        <div style="display: flex; gap: 10px;">
          <div style="flex: 1; background: #f00;">Item 1</div>
          <div style="flex: 1; background: #0f0;">Item 2</div>
          <div style="flex: 1; background: #00f;">Item 3</div>
        </div>
      `
      const result = await converter.convert(html, { printBackground: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should handle flex-direction', async () => {
      const html = `
        <div style="display: flex; flex-direction: column;">
          <div>Row 1</div>
          <div>Row 2</div>
          <div>Row 3</div>
        </div>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should handle justify-content and align-items', async () => {
      const html = `
        <div style="display: flex; justify-content: space-between; align-items: center; height: 100px;">
          <div>Left</div>
          <div>Center</div>
          <div>Right</div>
        </div>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })
  })

  describe('Grid Layout', () => {
    it('should render grid container', async () => {
      const html = `
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
          <div style="background: #eee;">1</div>
          <div style="background: #ddd;">2</div>
          <div style="background: #ccc;">3</div>
          <div style="background: #bbb;">4</div>
          <div style="background: #aaa;">5</div>
          <div style="background: #999;">6</div>
        </div>
      `
      const result = await converter.convert(html, { printBackground: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should handle grid-column and grid-row spans', async () => {
      const html = `
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
          <div style="grid-column: span 2;">Wide item</div>
          <div>Normal</div>
          <div style="grid-row: span 2;">Tall item</div>
          <div>Normal</div>
          <div>Normal</div>
        </div>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })
  })

  describe('Table Styling', () => {
    it('should preserve table borders', async () => {
      const html = `
        <style>
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #333; padding: 8px; }
          th { background-color: #f5f5f5; }
        </style>
        <table>
          <thead><tr><th>Header 1</th><th>Header 2</th></tr></thead>
          <tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody>
        </table>
      `
      const result = await converter.convert(html, { printBackground: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should handle alternating row colors', async () => {
      const html = `
        <style>
          tr:nth-child(even) { background-color: #f9f9f9; }
        </style>
        <table>
          <tr><td>Row 1</td></tr>
          <tr><td>Row 2</td></tr>
          <tr><td>Row 3</td></tr>
          <tr><td>Row 4</td></tr>
        </table>
      `
      const result = await converter.convert(html, { printBackground: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })
  })
})

describe('HTMLToPDFConverter - Page Breaks and Margins', () => {
  let converter: HTMLToPDFConverter

  beforeEach(() => {
    converter = new HTMLToPDFConverter()
  })

  describe('Page Size and Orientation', () => {
    it('should create Letter size PDF by default', async () => {
      const html = '<p>Content</p>'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      // Letter size: 612 x 792 points
      expect(pdfString).toMatch(/MediaBox\s*\[\s*0\s+0\s+612\s+792\s*\]/)
    })

    it('should create A4 size PDF', async () => {
      const html = '<p>Content</p>'
      const result = await converter.convert(html, { page: { size: 'a4' } })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      // A4 size: 595.28 x 841.89 points
      expect(pdfString).toMatch(/MediaBox\s*\[\s*0\s+0\s+595/)
    })

    it('should create Legal size PDF', async () => {
      const html = '<p>Content</p>'
      const result = await converter.convert(html, { page: { size: 'legal' } })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      // Legal size: 612 x 1008 points
      expect(pdfString).toMatch(/MediaBox\s*\[\s*0\s+0\s+612\s+1008\s*\]/)
    })

    it('should create custom size PDF', async () => {
      const html = '<p>Content</p>'
      const result = await converter.convert(html, {
        page: { size: { width: 500, height: 700 } },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toMatch(/MediaBox\s*\[\s*0\s+0\s+500\s+700\s*\]/)
    })

    it('should create landscape PDF', async () => {
      const html = '<p>Content</p>'
      const result = await converter.convert(html, {
        page: { size: 'letter', orientation: 'landscape' },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      // Landscape Letter: 792 x 612 points
      expect(pdfString).toMatch(/MediaBox\s*\[\s*0\s+0\s+792\s+612\s*\]/)
    })
  })

  describe('Page Margins', () => {
    it('should apply default margins', async () => {
      const html = '<p>Content at the edge</p>'
      const result = await converter.convert(html)

      // Default margins should be ~72 points (1 inch)
      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should apply custom margins in points', async () => {
      const html = '<p>Content with custom margins</p>'
      const result = await converter.convert(html, {
        page: { margins: { top: 36, right: 36, bottom: 36, left: 36 } },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should apply custom margins in CSS units', async () => {
      const html = '<p>Content with CSS margins</p>'
      const result = await converter.convert(html, {
        page: { margins: { top: '1in', right: '0.5in', bottom: '1in', left: '0.5in' } },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should respect @page margin CSS rule', async () => {
      const html = `
        <style>
          @page { margin: 2cm; }
        </style>
        <p>Content with @page margins</p>
      `
      const result = await converter.convert(html, { preferCSSPageSize: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })
  })

  describe('Page Breaks', () => {
    it('should create new page with page-break-before: always', async () => {
      const html = `
        <p>Page 1 content</p>
        <div style="page-break-before: always;">
          <p>Page 2 content</p>
        </div>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(2)
    })

    it('should create new page with page-break-after: always', async () => {
      const html = `
        <div style="page-break-after: always;">
          <p>Page 1 content</p>
        </div>
        <p>Page 2 content</p>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(2)
    })

    it('should respect page-break-inside: avoid', async () => {
      const longContent = Array(50).fill('<p>Line of text that fills the page</p>').join('')
      const html = `
        ${longContent}
        <div style="page-break-inside: avoid;">
          <h2>Keep Together Heading</h2>
          <p>This paragraph should stay with its heading</p>
          <p>And this one too</p>
        </div>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBeGreaterThanOrEqual(2)
    })

    it('should respect break-before and break-after CSS properties', async () => {
      const html = `
        <p>First section</p>
        <section style="break-before: page;">
          <p>New section on new page</p>
        </section>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(2)
    })

    it('should handle orphans and widows CSS properties', async () => {
      const html = `
        <style>
          p { orphans: 3; widows: 3; }
        </style>
        ${Array(100).fill('<p>Line of text</p>').join('')}
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBeGreaterThan(1)
    })
  })

  describe('Multi-page Content', () => {
    it('should automatically flow content across pages', async () => {
      const lines = Array(100).fill('<p>This is a line of text that will cause page overflow.</p>').join('')
      const html = `<div>${lines}</div>`
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBeGreaterThan(1)
    })

    it('should handle very long tables across pages', async () => {
      const rows = Array(100).fill('<tr><td>Cell 1</td><td>Cell 2</td><td>Cell 3</td></tr>').join('')
      const html = `
        <table>
          <thead><tr><th>Col 1</th><th>Col 2</th><th>Col 3</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBeGreaterThan(1)
    })

    it('should repeat table headers on each page', async () => {
      const rows = Array(100).fill('<tr><td>Data</td></tr>').join('')
      const html = `
        <style>
          thead { display: table-header-group; }
        </style>
        <table>
          <thead><tr><th>Repeating Header</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBeGreaterThan(1)
      // Each page should contain the header text
    })
  })

  describe('CSS @page Rules', () => {
    it('should apply @page size rule', async () => {
      const html = `
        <style>
          @page { size: A4 landscape; }
        </style>
        <p>Content</p>
      `
      const result = await converter.convert(html, { preferCSSPageSize: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      // A4 landscape: 841.89 x 595.28 points
      expect(pdfString).toMatch(/MediaBox\s*\[\s*0\s+0\s+841/)
    })

    it('should apply named @page rules', async () => {
      const html = `
        <style>
          @page landscape-page { size: landscape; }
          .landscape { page: landscape-page; }
        </style>
        <p>Portrait content</p>
        <div class="landscape" style="page-break-before: always;">
          <p>Landscape content</p>
        </div>
      `
      const result = await converter.convert(html, { preferCSSPageSize: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(2)
    })

    it('should apply @page :first selector', async () => {
      const html = `
        <style>
          @page :first { margin-top: 100px; }
          @page { margin-top: 50px; }
        </style>
        ${Array(100).fill('<p>Content</p>').join('')}
      `
      const result = await converter.convert(html, { preferCSSPageSize: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBeGreaterThan(1)
    })
  })
})

describe('HTMLToPDFConverter - Headers and Footers', () => {
  let converter: HTMLToPDFConverter

  beforeEach(() => {
    converter = new HTMLToPDFConverter()
  })

  describe('Basic Headers', () => {
    it('should add simple text header', async () => {
      const html = '<p>Page content</p>'
      const result = await converter.convert(html, {
        header: { html: '<div>Document Header</div>' },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toContain('Document Header')
    })

    it('should add styled header', async () => {
      const html = '<p>Page content</p>'
      const result = await converter.convert(html, {
        header: {
          html: '<div style="border-bottom: 1px solid #000; padding-bottom: 5px;">Styled Header</div>',
        },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should set custom header height', async () => {
      const html = '<p>Page content</p>'
      const result = await converter.convert(html, {
        header: {
          html: '<div>Header</div>',
          height: '50px',
        },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should repeat header on all pages', async () => {
      const lines = Array(100).fill('<p>Line of content</p>').join('')
      const html = `<div>${lines}</div>`
      const result = await converter.convert(html, {
        header: { html: '<div>Repeating Header</div>' },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBeGreaterThan(1)
      // Each page should contain the header
    })
  })

  describe('Basic Footers', () => {
    it('should add simple text footer', async () => {
      const html = '<p>Page content</p>'
      const result = await converter.convert(html, {
        footer: { html: '<div>Document Footer</div>' },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toContain('Document Footer')
    })

    it('should add styled footer', async () => {
      const html = '<p>Page content</p>'
      const result = await converter.convert(html, {
        footer: {
          html: '<div style="border-top: 1px solid #000; padding-top: 5px; text-align: center;">Footer</div>',
        },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should set custom footer height', async () => {
      const html = '<p>Page content</p>'
      const result = await converter.convert(html, {
        footer: {
          html: '<div>Footer</div>',
          height: '30px',
        },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })
  })

  describe('Dynamic Content', () => {
    it('should include page numbers in footer', async () => {
      const lines = Array(100).fill('<p>Line of content</p>').join('')
      const html = `<div>${lines}</div>`
      const result = await converter.convert(html, {
        footer: { html: '<div>Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBeGreaterThan(1)
      // Footer should contain page numbers
    })

    it('should include current date in header', async () => {
      const html = '<p>Page content</p>'
      const result = await converter.convert(html, {
        header: { html: '<div>Generated: <span class="date"></span></div>' },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      // Header should contain the current date
    })

    it('should include document title in header', async () => {
      const html = `
        <html>
          <head><title>My Document</title></head>
          <body><p>Content</p></body>
        </html>
      `
      const result = await converter.convert(html, {
        header: { html: '<div><span class="title"></span></div>' },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toContain('My Document')
    })

    it('should include URL in footer', async () => {
      const html = '<p>Page content</p>'
      const result = await converter.convert(html, {
        footer: { html: '<div><span class="url"></span></div>' },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })
  })

  describe('Header/Footer Layout', () => {
    it('should support left/center/right sections in header', async () => {
      const html = '<p>Page content</p>'
      const result = await converter.convert(html, {
        header: {
          html: `
            <div style="display: flex; justify-content: space-between;">
              <div>Left Section</div>
              <div>Center Section</div>
              <div>Right Section</div>
            </div>
          `,
        },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should support logo image in header', async () => {
      const html = '<p>Page content</p>'
      const logoBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      const result = await converter.convert(html, {
        header: {
          html: `<div><img src="${logoBase64}" style="height: 30px;" /></div>`,
          height: '50px',
        },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should handle both header and footer together', async () => {
      const lines = Array(100).fill('<p>Content line</p>').join('')
      const html = `<div>${lines}</div>`
      const result = await converter.convert(html, {
        header: { html: '<div style="text-align: center;">CONFIDENTIAL</div>', height: '30px' },
        footer: { html: '<div style="text-align: center;">Page <span class="pageNumber"></span></div>', height: '30px' },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBeGreaterThan(1)
    })
  })

  describe('First Page Variations', () => {
    it('should hide header on first page', async () => {
      const lines = Array(100).fill('<p>Content</p>').join('')
      const html = `<div>${lines}</div>`
      // Use CSS to hide on first page
      const result = await converter.convert(html, {
        header: {
          html: `
            <style>
              @page:first { @top-center { content: none; } }
            </style>
            <div class="header">Regular Header</div>
          `,
        },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBeGreaterThan(1)
    })

    it('should use different header on first page', async () => {
      const lines = Array(100).fill('<p>Content</p>').join('')
      const html = `<div>${lines}</div>`
      // First page has different header
      const result = await converter.convert(html, {
        header: {
          html: `
            <style>
              .first-header { display: none; }
              .regular-header { display: block; }
              @page:first .first-header { display: block; }
              @page:first .regular-header { display: none; }
            </style>
            <div class="first-header">Title Page Header</div>
            <div class="regular-header">Regular Header</div>
          `,
        },
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBeGreaterThan(1)
    })
  })
})

describe('HTMLToPDFConverter - Image Embedding', () => {
  let converter: HTMLToPDFConverter

  beforeEach(() => {
    converter = new HTMLToPDFConverter()
  })

  // Sample base64 images for testing
  const pngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9QzwAEowGj/TgZAAMqAsIpP+noAAAAAElFTkSuQmCC'
  const jpegBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAKAAoDASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAUHCP/EACMQAAEEAgEDBQAAAAAAAAAAAAEAAgMRBAUhBhIxQVFhcYH/xAAVAQEBAAAAAAAAAAAAAAAAAAADBP/EABkRAQEBAQEBAAAAAAAAAAAAAAACMQERAP/aAAwDAQACEQMRAD8Ay7F6h1OBgR4uPtMuOFrQ1rBM8hoA8ADgBFFT7MqOb/r1/wAWER+p/9k='

  describe('Base64 Image Embedding', () => {
    it('should embed PNG image from base64', async () => {
      const html = `<img src="${pngBase64}" alt="PNG Image" />`
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      // PDF should contain image XObject
      expect(pdfString).toMatch(/\/Subtype\s*\/Image/)
    })

    it('should embed JPEG image from base64', async () => {
      const html = `<img src="${jpegBase64}" alt="JPEG Image" />`
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      // PDF should contain image XObject with DCTDecode filter
      expect(pdfString).toMatch(/\/Filter\s*\/DCTDecode/)
    })

    it('should handle multiple images', async () => {
      const html = `
        <img src="${pngBase64}" alt="Image 1" />
        <img src="${jpegBase64}" alt="Image 2" />
        <img src="${pngBase64}" alt="Image 3" />
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })
  })

  describe('Image Sizing', () => {
    it('should preserve original image dimensions', async () => {
      const html = `<img src="${pngBase64}" />`
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should scale image with width attribute', async () => {
      const html = `<img src="${pngBase64}" width="200" />`
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should scale image with height attribute', async () => {
      const html = `<img src="${pngBase64}" height="150" />`
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should scale image with both width and height', async () => {
      const html = `<img src="${pngBase64}" width="200" height="100" />`
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should scale image with CSS width/height', async () => {
      const html = `<img src="${pngBase64}" style="width: 50%; height: auto;" />`
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should handle max-width constraint', async () => {
      const html = `<img src="${pngBase64}" style="max-width: 100%; height: auto;" />`
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should maintain aspect ratio with object-fit: contain', async () => {
      const html = `
        <div style="width: 200px; height: 200px;">
          <img src="${pngBase64}" style="width: 100%; height: 100%; object-fit: contain;" />
        </div>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should crop with object-fit: cover', async () => {
      const html = `
        <div style="width: 100px; height: 100px; overflow: hidden;">
          <img src="${pngBase64}" style="width: 100%; height: 100%; object-fit: cover;" />
        </div>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })
  })

  describe('Image Positioning', () => {
    it('should position image inline with text', async () => {
      const html = `<p>Text before <img src="${pngBase64}" style="vertical-align: middle; height: 20px;" /> text after</p>`
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should position image as block element', async () => {
      const html = `
        <p>Text before image</p>
        <img src="${pngBase64}" style="display: block; margin: 10px auto;" />
        <p>Text after image</p>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should float image left', async () => {
      const html = `
        <img src="${pngBase64}" style="float: left; margin-right: 10px;" />
        <p>This text should wrap around the floated image on the left side.</p>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should float image right', async () => {
      const html = `
        <img src="${pngBase64}" style="float: right; margin-left: 10px;" />
        <p>This text should wrap around the floated image on the right side.</p>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should position image absolutely', async () => {
      const html = `
        <div style="position: relative; height: 200px;">
          <img src="${pngBase64}" style="position: absolute; bottom: 10px; right: 10px;" />
          <p>Content in the container</p>
        </div>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })
  })

  describe('SVG Embedding', () => {
    it('should embed inline SVG', async () => {
      const html = `
        <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="40" fill="red" />
        </svg>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should embed SVG with complex paths', async () => {
      const html = `
        <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 80 Q 95 10 180 80" stroke="black" fill="transparent"/>
          <rect x="50" y="50" width="100" height="100" fill="blue" opacity="0.5"/>
        </svg>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should embed SVG from data URI', async () => {
      const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="green" width="100" height="100"/></svg>'
      const svgDataUri = `data:image/svg+xml;base64,${btoa(svgContent)}`
      const html = `<img src="${svgDataUri}" />`
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should handle SVG with gradients', async () => {
      const html = `
        <svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" style="stop-color:rgb(255,255,0);stop-opacity:1" />
              <stop offset="100%" style="stop-color:rgb(255,0,0);stop-opacity:1" />
            </linearGradient>
          </defs>
          <rect x="10" y="10" width="180" height="80" fill="url(#grad1)" />
        </svg>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should handle SVG with text', async () => {
      const html = `
        <svg width="200" height="50" xmlns="http://www.w3.org/2000/svg">
          <text x="10" y="30" font-family="Arial" font-size="20" fill="black">SVG Text</text>
        </svg>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toContain('SVG Text')
    })
  })

  describe('Background Images', () => {
    it('should render CSS background-image', async () => {
      const html = `
        <div style="width: 200px; height: 100px; background-image: url('${pngBase64}'); background-size: cover;">
          Content over background
        </div>
      `
      const result = await converter.convert(html, { printBackground: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should handle background-repeat', async () => {
      const html = `
        <div style="width: 300px; height: 150px; background-image: url('${pngBase64}'); background-repeat: repeat;">
          Tiled background
        </div>
      `
      const result = await converter.convert(html, { printBackground: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should handle background-position', async () => {
      const html = `
        <div style="width: 200px; height: 200px; background-image: url('${pngBase64}'); background-repeat: no-repeat; background-position: center;">
          Centered background
        </div>
      `
      const result = await converter.convert(html, { printBackground: true })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should skip background images when printBackground is false', async () => {
      const html = `
        <div style="background-image: url('${pngBase64}'); width: 200px; height: 100px;">
          Content
        </div>
      `
      const result = await converter.convert(html, { printBackground: false })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      // Background should not be present in PDF
    })
  })

  describe('Image Error Handling', () => {
    it('should handle missing image gracefully', async () => {
      const html = '<img src="nonexistent.png" alt="Missing Image" />'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
      // Should not throw, may show alt text or placeholder
    })

    it('should handle invalid base64 gracefully', async () => {
      const html = '<img src="data:image/png;base64,INVALIDBASE64DATA!!!" />'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
      // Should not throw
    })

    it('should handle broken image with alt text', async () => {
      const html = '<img src="broken.jpg" alt="Broken Image Description" />'
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toContain('Broken Image Description')
    })
  })

  describe('Image in Tables', () => {
    it('should embed image in table cell', async () => {
      const html = `
        <table>
          <tr>
            <td><img src="${pngBase64}" /></td>
            <td>Text content</td>
          </tr>
        </table>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })

    it('should handle multiple images in table', async () => {
      const html = `
        <table>
          <tr>
            <td><img src="${pngBase64}" /></td>
            <td><img src="${jpegBase64}" /></td>
          </tr>
          <tr>
            <td><img src="${jpegBase64}" /></td>
            <td><img src="${pngBase64}" /></td>
          </tr>
        </table>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.pageCount).toBe(1)
    })
  })

  describe('Figure and Caption', () => {
    it('should render figure with caption', async () => {
      const html = `
        <figure>
          <img src="${pngBase64}" alt="Figure image" />
          <figcaption>Figure 1: Sample image with caption</figcaption>
        </figure>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toContain('Figure 1')
    })
  })
})

describe('HTMLToPDFConverter - Print Media Queries', () => {
  let converter: HTMLToPDFConverter

  beforeEach(() => {
    converter = new HTMLToPDFConverter()
  })

  describe('@media print Rules', () => {
    it('should apply @media print styles', async () => {
      const html = `
        <style>
          .screen-only { display: block; }
          @media print {
            .screen-only { display: none; }
            body { font-size: 12pt; }
          }
        </style>
        <div class="screen-only">This should be hidden in PDF</div>
        <p>This should appear in PDF</p>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).not.toContain('This should be hidden')
    })

    it('should hide elements with print:hidden class', async () => {
      const html = `
        <style>
          @media print { .print-hidden { display: none !important; } }
        </style>
        <nav class="print-hidden">Navigation - hidden in print</nav>
        <main>Main content - visible in print</main>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toContain('Main content')
      expect(pdfString).not.toContain('Navigation')
    })

    it('should show elements with print:block class', async () => {
      const html = `
        <style>
          .print-only { display: none; }
          @media print { .print-only { display: block; } }
        </style>
        <div class="print-only">This only appears in PDF</div>
        <p>Regular content</p>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      const pdfString = new TextDecoder().decode(result.bytes)
      expect(pdfString).toContain('This only appears in PDF')
    })

    it('should apply print-specific colors', async () => {
      const html = `
        <style>
          a { color: blue; }
          @media print { a { color: black; text-decoration: underline; } }
        </style>
        <a href="#">Link text</a>
      `
      const result = await converter.convert(html)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      // Link should be black in PDF
    })
  })
})
