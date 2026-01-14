/**
 * PDF Extraction Tests - RED Phase
 *
 * These tests define the desired API for comprehensive PDF parsing and extraction.
 * The current DocumentParser has basic stub implementations. These tests specify
 * the full functionality needed for production PDF extraction.
 *
 * Test Coverage:
 * - Extract text from PDF pages (per-page, with coordinates)
 * - Extract metadata (author, title, creation date, custom fields)
 * - Extract images from PDF (with positions and dimensions)
 * - Extract form field values (text, checkbox, radio, dropdown, date)
 * - Handle encrypted/password-protected PDFs
 * - Parse PDF structure (pages, fonts, annotations, bookmarks, links)
 * - Table detection and extraction
 *
 * RED Tests: These tests should FAIL until the PDFExtractor implementation is complete.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import {
  DocumentParser,
  PDFGenerator,
} from '../../../../primitives/document-renderer/index'
import type {
  ExtractedText,
  ExtractedFormField,
  ExtractedTable,
  DocumentMetadata,
  DocumentExtraction,
  Bounds,
} from '../../../../primitives/document-renderer/types'

// =============================================================================
// Extended Types for PDF Extraction (to be implemented)
// =============================================================================

/**
 * Text extraction with position information
 */
interface TextBlock {
  /** The extracted text content */
  text: string
  /** Page number (1-indexed) */
  page: number
  /** Bounding box coordinates */
  bounds: Bounds
  /** Font information */
  font?: {
    name: string
    size: number
    bold?: boolean
    italic?: boolean
  }
  /** Text color (hex) */
  color?: string
  /** Confidence score (0-1) for OCR'd text */
  confidence?: number
}

/**
 * Extracted image from PDF
 */
interface ExtractedImage {
  /** Unique identifier for this image */
  id: string
  /** Page number (1-indexed) */
  page: number
  /** Image data as base64 */
  data: string
  /** MIME type (image/png, image/jpeg, etc.) */
  mimeType: string
  /** Image dimensions in pixels */
  dimensions: {
    width: number
    height: number
  }
  /** Position on page */
  bounds: Bounds
  /** Color space (RGB, CMYK, Grayscale) */
  colorSpace?: string
  /** Bits per component */
  bitsPerComponent?: number
}

/**
 * PDF annotation
 */
interface PDFAnnotation {
  /** Annotation type */
  type: 'highlight' | 'underline' | 'strikeout' | 'squiggly' | 'note' | 'link' | 'stamp' | 'freetext' | 'line' | 'square' | 'circle' | 'polygon' | 'ink' | 'popup' | 'fileattachment' | 'sound' | 'movie' | 'widget' | 'screen' | 'printermark' | 'trapnet' | 'watermark' | '3d' | 'redact'
  /** Page number */
  page: number
  /** Position */
  bounds: Bounds
  /** Content (for text annotations) */
  content?: string
  /** Author */
  author?: string
  /** Creation date */
  createdAt?: Date
  /** Modified date */
  modifiedAt?: Date
  /** Color */
  color?: string
  /** Link destination (for link annotations) */
  destination?: string
}

/**
 * PDF bookmark/outline entry
 */
interface PDFBookmark {
  /** Bookmark title */
  title: string
  /** Target page number */
  page: number
  /** Child bookmarks */
  children?: PDFBookmark[]
  /** Whether bookmark is expanded by default */
  expanded?: boolean
}

/**
 * Font used in PDF
 */
interface PDFFont {
  /** Font name */
  name: string
  /** Font type (Type1, TrueType, OpenType, CIDFont) */
  type: string
  /** Whether font is embedded */
  embedded: boolean
  /** Encoding */
  encoding?: string
  /** Pages where font is used */
  usedOnPages: number[]
}

/**
 * Complete PDF structure information
 */
interface PDFStructure {
  /** PDF version (e.g., "1.7") */
  version: string
  /** Page count */
  pageCount: number
  /** Page dimensions per page */
  pages: Array<{
    number: number
    width: number
    height: number
    rotation?: number
  }>
  /** Fonts used in document */
  fonts: PDFFont[]
  /** Bookmarks/outline */
  bookmarks: PDFBookmark[]
  /** Whether PDF is tagged (accessible) */
  isTagged: boolean
  /** Whether PDF contains forms */
  hasForm: boolean
  /** Whether PDF has digital signatures */
  hasSignatures: boolean
  /** Encryption information */
  encryption?: {
    encrypted: boolean
    method?: string
    permissions?: {
      printing: boolean
      modifying: boolean
      copying: boolean
      annotating: boolean
    }
  }
}

/**
 * Extended PDF extraction options
 */
interface PDFExtractionOptions {
  /** Extract text with coordinates */
  includeTextCoordinates?: boolean
  /** Extract images */
  extractImages?: boolean
  /** Maximum image dimension to extract (skip larger) */
  maxImageSize?: number
  /** Extract annotations */
  extractAnnotations?: boolean
  /** Extract bookmarks */
  extractBookmarks?: boolean
  /** Extract fonts info */
  extractFonts?: boolean
  /** Password for encrypted PDFs */
  password?: string
  /** Page range to extract (1-indexed) */
  pages?: {
    start?: number
    end?: number
  }
  /** Enable OCR for scanned documents */
  enableOCR?: boolean
  /** OCR language(s) */
  ocrLanguages?: string[]
}

/**
 * Extended document extraction result
 */
interface ExtendedDocumentExtraction extends DocumentExtraction {
  /** Text blocks with positions */
  textBlocks?: TextBlock[]
  /** Extracted images */
  images: ExtractedImage[]
  /** Annotations */
  annotations?: PDFAnnotation[]
  /** PDF structure info */
  structure?: PDFStructure
}

// =============================================================================
// Test Fixtures - Sample PDFs
// =============================================================================

// Helper to create test PDFs with specific content
async function createTestPDF(content: string): Promise<Uint8Array> {
  const generator = new PDFGenerator()
  return generator.generate(content)
}

// =============================================================================
// Text Extraction Tests
// =============================================================================

describe('PDF Extraction - Text Content', () => {
  let parser: DocumentParser

  beforeEach(() => {
    parser = new DocumentParser()
  })

  describe('Basic Text Extraction', () => {
    it('should extract text from a single page PDF', async () => {
      const pdf = await createTestPDF('<p>Hello World</p>')
      const result = await parser.extractText(pdf)

      expect(result.content).toContain('Hello World')
      expect(result.pages).toHaveLength(1)
      expect(result.pages[0]).toContain('Hello World')
    })

    it('should extract text from multiple pages', async () => {
      // This test requires a multi-page PDF generator
      const pdf = await createTestPDF(`
        <p>Page 1 content here</p>
        <div style="page-break-after: always"></div>
        <p>Page 2 content here</p>
        <div style="page-break-after: always"></div>
        <p>Page 3 content here</p>
      `)
      const result = await parser.extractText(pdf)

      // Should extract text from all pages
      expect(result.pages.length).toBeGreaterThanOrEqual(3)
      expect(result.pages[0]).toContain('Page 1')
      expect(result.pages[1]).toContain('Page 2')
      expect(result.pages[2]).toContain('Page 3')
    })

    it('should preserve text order and structure', async () => {
      const pdf = await createTestPDF(`
        <h1>Title</h1>
        <p>First paragraph</p>
        <p>Second paragraph</p>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
      `)
      const result = await parser.extractText(pdf)

      // Text should appear in document order
      const titleIndex = result.content.indexOf('Title')
      const firstIndex = result.content.indexOf('First paragraph')
      const secondIndex = result.content.indexOf('Second paragraph')
      const item1Index = result.content.indexOf('Item 1')

      expect(titleIndex).toBeLessThan(firstIndex)
      expect(firstIndex).toBeLessThan(secondIndex)
      expect(secondIndex).toBeLessThan(item1Index)
    })

    it('should handle unicode characters correctly', async () => {
      const pdf = await createTestPDF(`
        <p>English: Hello World</p>
        <p>Chinese: \u4F60\u597D\u4E16\u754C</p>
        <p>Japanese: \u3053\u3093\u306B\u3061\u306F</p>
        <p>Arabic: \u0645\u0631\u062D\u0628\u0627</p>
        <p>Emoji: \uD83D\uDE00\uD83C\uDF1F\uD83D\uDC4D</p>
      `)
      const result = await parser.extractText(pdf)

      expect(result.content).toContain('\u4F60\u597D') // Chinese
      expect(result.content).toContain('\u3053\u3093\u306B\u3061\u306F') // Japanese
      expect(result.content).toContain('\u0645\u0631\u062D\u0628\u0627') // Arabic
    })

    it('should handle special characters and escapes', async () => {
      const pdf = await createTestPDF(`
        <p>Ampersand: &amp;</p>
        <p>Less than: &lt;</p>
        <p>Greater than: &gt;</p>
        <p>Quote: &quot;</p>
        <p>Copyright: &copy;</p>
        <p>Trademark: &trade;</p>
      `)
      const result = await parser.extractText(pdf)

      expect(result.content).toContain('&')
      expect(result.content).toContain('<')
      expect(result.content).toContain('>')
    })
  })

  describe('Text Extraction with Coordinates', () => {
    it('should extract text with bounding box coordinates', async () => {
      const pdf = await createTestPDF('<p>Positioned text</p>')

      // Extended extraction that includes coordinates
      const extractor = parser as unknown as {
        extractTextBlocks(pdf: Uint8Array): Promise<TextBlock[]>
      }

      // This method needs to be implemented
      expect(extractor.extractTextBlocks).toBeDefined()
      const blocks = await extractor.extractTextBlocks(pdf)

      expect(blocks.length).toBeGreaterThan(0)
      const block = blocks[0]
      expect(block.text).toContain('Positioned text')
      expect(block.page).toBe(1)
      expect(block.bounds).toBeDefined()
      expect(block.bounds.x).toBeGreaterThanOrEqual(0)
      expect(block.bounds.y).toBeGreaterThanOrEqual(0)
      expect(block.bounds.width).toBeGreaterThan(0)
      expect(block.bounds.height).toBeGreaterThan(0)
    })

    it('should include font information for text blocks', async () => {
      const pdf = await createTestPDF(`
        <h1 style="font-size: 24px; font-weight: bold;">Bold Heading</h1>
        <p style="font-style: italic;">Italic paragraph</p>
      `)

      const extractor = parser as unknown as {
        extractTextBlocks(pdf: Uint8Array): Promise<TextBlock[]>
      }
      const blocks = await extractor.extractTextBlocks(pdf)

      const headingBlock = blocks.find((b) => b.text.includes('Bold Heading'))
      expect(headingBlock?.font).toBeDefined()
      expect(headingBlock?.font?.bold).toBe(true)
      expect(headingBlock?.font?.size).toBeGreaterThan(12)

      const italicBlock = blocks.find((b) => b.text.includes('Italic'))
      expect(italicBlock?.font?.italic).toBe(true)
    })

    it('should extract text from specific page ranges', async () => {
      const pdf = await createTestPDF(`
        <p>Page 1</p>
        <div style="page-break-after: always"></div>
        <p>Page 2</p>
        <div style="page-break-after: always"></div>
        <p>Page 3</p>
      `)

      const extractor = parser as unknown as {
        extractText(pdf: Uint8Array, options: PDFExtractionOptions): Promise<ExtractedText>
      }

      const result = await extractor.extractText(pdf, {
        pages: { start: 2, end: 2 },
      })

      expect(result.content).toContain('Page 2')
      expect(result.content).not.toContain('Page 1')
      expect(result.content).not.toContain('Page 3')
    })
  })
})

// =============================================================================
// Metadata Extraction Tests
// =============================================================================

describe('PDF Extraction - Metadata', () => {
  let parser: DocumentParser
  let generator: PDFGenerator

  beforeEach(() => {
    parser = new DocumentParser()
    generator = new PDFGenerator()
  })

  describe('Standard Metadata Fields', () => {
    it('should extract document title', async () => {
      const pdf = await generator.generate('<p>Content</p>', {
        metadata: { title: 'My Document Title' },
      })
      const metadata = await parser.getMetadata(pdf)

      expect(metadata.title).toBe('My Document Title')
    })

    it('should extract document author', async () => {
      const pdf = await generator.generate('<p>Content</p>', {
        metadata: { author: 'John Doe' },
      })
      const metadata = await parser.getMetadata(pdf)

      expect(metadata.author).toBe('John Doe')
    })

    it('should extract document subject', async () => {
      const pdf = await generator.generate('<p>Content</p>', {
        metadata: { subject: 'Technical Documentation' },
      })
      const metadata = await parser.getMetadata(pdf)

      expect(metadata.subject).toBe('Technical Documentation')
    })

    it('should extract keywords', async () => {
      const pdf = await generator.generate('<p>Content</p>', {
        metadata: { keywords: ['pdf', 'extraction', 'testing'] },
      })
      const metadata = await parser.getMetadata(pdf)

      expect(metadata.keywords).toEqual(['pdf', 'extraction', 'testing'])
    })

    it('should extract creator application', async () => {
      const pdf = await generator.generate('<p>Content</p>', {
        metadata: { creator: 'DocumentRenderer 1.0' },
      })
      const metadata = await parser.getMetadata(pdf)

      expect(metadata.creator).toBe('DocumentRenderer 1.0')
    })

    it('should extract producer application', async () => {
      const pdf = await generator.generate('<p>Content</p>', {
        metadata: { producer: 'pdf-lib' },
      })
      const metadata = await parser.getMetadata(pdf)

      expect(metadata.producer).toBe('pdf-lib')
    })

    it('should extract creation date', async () => {
      const creationDate = new Date('2024-06-15T10:30:00Z')
      const pdf = await generator.generate('<p>Content</p>', {
        metadata: { creationDate },
      })
      const metadata = await parser.getMetadata(pdf)

      expect(metadata.creationDate).toBeDefined()
      expect(metadata.creationDate?.getFullYear()).toBe(2024)
      expect(metadata.creationDate?.getMonth()).toBe(5) // June (0-indexed)
      expect(metadata.creationDate?.getDate()).toBe(15)
    })

    it('should extract modification date', async () => {
      const modDate = new Date('2024-12-25T14:00:00Z')
      const pdf = await generator.generate('<p>Content</p>', {
        metadata: { modificationDate: modDate },
      })
      const metadata = await parser.getMetadata(pdf)

      expect(metadata.modificationDate).toBeDefined()
    })
  })

  describe('Custom Metadata Fields', () => {
    it('should extract custom metadata fields', async () => {
      const pdf = await generator.generate('<p>Content</p>', {
        metadata: {
          title: 'Test',
          custom: {
            'Department': 'Engineering',
            'Project': 'DocRenderer',
            'Version': '2.0.1',
          },
        },
      })
      const metadata = await parser.getMetadata(pdf)

      expect(metadata.custom).toBeDefined()
      expect(metadata.custom?.['Department']).toBe('Engineering')
      expect(metadata.custom?.['Project']).toBe('DocRenderer')
      expect(metadata.custom?.['Version']).toBe('2.0.1')
    })
  })

  describe('XMP Metadata', () => {
    it('should extract XMP metadata when present', async () => {
      // XMP is an XML-based metadata standard embedded in PDFs
      const extractor = parser as unknown as {
        extractXMPMetadata(pdf: Uint8Array): Promise<Record<string, unknown>>
      }

      const pdf = await createTestPDF('<p>Document with XMP</p>')

      expect(extractor.extractXMPMetadata).toBeDefined()
      const xmpData = await extractor.extractXMPMetadata(pdf)

      // XMP should return structured metadata
      expect(typeof xmpData).toBe('object')
    })
  })
})

// =============================================================================
// Image Extraction Tests
// =============================================================================

describe('PDF Extraction - Images', () => {
  let parser: DocumentParser

  beforeEach(() => {
    parser = new DocumentParser()
  })

  describe('Basic Image Extraction', () => {
    it('should extract embedded images from PDF', async () => {
      // Create a PDF with an embedded image
      const pdf = await createTestPDF(`
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />
        <p>Document with image</p>
      `)

      const extractor = parser as unknown as {
        extractImages(pdf: Uint8Array): Promise<ExtractedImage[]>
      }

      expect(extractor.extractImages).toBeDefined()
      const images = await extractor.extractImages(pdf)

      expect(images.length).toBeGreaterThan(0)
      const image = images[0]
      expect(image.id).toBeDefined()
      expect(image.data).toBeDefined()
      expect(image.mimeType).toMatch(/image\/(png|jpeg|gif)/)
      expect(image.page).toBe(1)
    })

    it('should extract multiple images from different pages', async () => {
      const pdf = await createTestPDF(`
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />
        <div style="page-break-after: always"></div>
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAx1xFJgAAAABJRU5ErkJggg==" />
      `)

      const extractor = parser as unknown as {
        extractImages(pdf: Uint8Array): Promise<ExtractedImage[]>
      }
      const images = await extractor.extractImages(pdf)

      expect(images.length).toBeGreaterThanOrEqual(2)
      // Images should be from different pages
      const pages = images.map((img) => img.page)
      expect(pages).toContain(1)
      expect(pages).toContain(2)
    })

    it('should extract image dimensions', async () => {
      const pdf = await createTestPDF(`
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVR42mNk+M9QzwAEjDAGNOODQQEAMO0DAQEKmSYAAAAASUVORK5CYII=" width="100" height="100" />
      `)

      const extractor = parser as unknown as {
        extractImages(pdf: Uint8Array): Promise<ExtractedImage[]>
      }
      const images = await extractor.extractImages(pdf)

      expect(images[0].dimensions).toBeDefined()
      expect(images[0].dimensions.width).toBeGreaterThan(0)
      expect(images[0].dimensions.height).toBeGreaterThan(0)
    })

    it('should extract image position on page', async () => {
      const pdf = await createTestPDF(`
        <div style="position: absolute; left: 50px; top: 100px;">
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />
        </div>
      `)

      const extractor = parser as unknown as {
        extractImages(pdf: Uint8Array): Promise<ExtractedImage[]>
      }
      const images = await extractor.extractImages(pdf)

      expect(images[0].bounds).toBeDefined()
      expect(images[0].bounds.x).toBeGreaterThanOrEqual(0)
      expect(images[0].bounds.y).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Image Format Support', () => {
    it('should extract JPEG images', async () => {
      const pdf = await createTestPDF(`
        <img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==" />
      `)

      const extractor = parser as unknown as {
        extractImages(pdf: Uint8Array): Promise<ExtractedImage[]>
      }
      const images = await extractor.extractImages(pdf)

      const jpegImage = images.find((img) => img.mimeType === 'image/jpeg')
      expect(jpegImage).toBeDefined()
    })

    it('should extract PNG images', async () => {
      const pdf = await createTestPDF(`
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />
      `)

      const extractor = parser as unknown as {
        extractImages(pdf: Uint8Array): Promise<ExtractedImage[]>
      }
      const images = await extractor.extractImages(pdf)

      const pngImage = images.find((img) => img.mimeType === 'image/png')
      expect(pngImage).toBeDefined()
    })

    it('should provide color space information', async () => {
      const pdf = await createTestPDF(`
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />
      `)

      const extractor = parser as unknown as {
        extractImages(pdf: Uint8Array): Promise<ExtractedImage[]>
      }
      const images = await extractor.extractImages(pdf)

      expect(images[0].colorSpace).toBeDefined()
      expect(['RGB', 'CMYK', 'Grayscale', 'DeviceRGB', 'DeviceCMYK', 'DeviceGray']).toContain(images[0].colorSpace)
    })
  })

  describe('Image Extraction Options', () => {
    it('should respect maximum image size option', async () => {
      const pdf = await createTestPDF(`
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVR42mNk+M9QzwAEjDAGNOODQQEAMO0DAQEKmSYAAAAASUVORK5CYII=" />
      `)

      const extractor = parser as unknown as {
        extractImages(pdf: Uint8Array, options: PDFExtractionOptions): Promise<ExtractedImage[]>
      }

      // With a very small max size, large images should be skipped
      const images = await extractor.extractImages(pdf, { maxImageSize: 5 })

      // Should filter out images larger than 5x5 pixels
      for (const img of images) {
        expect(img.dimensions.width).toBeLessThanOrEqual(5)
        expect(img.dimensions.height).toBeLessThanOrEqual(5)
      }
    })

    it('should extract images only from specified pages', async () => {
      const pdf = await createTestPDF(`
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />
        <div style="page-break-after: always"></div>
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAx1xFJgAAAABJRU5ErkJggg==" />
        <div style="page-break-after: always"></div>
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAFBgGAZD0MsAAAAABJRU5ErkJggg==" />
      `)

      const extractor = parser as unknown as {
        extractImages(pdf: Uint8Array, options: PDFExtractionOptions): Promise<ExtractedImage[]>
      }

      const images = await extractor.extractImages(pdf, {
        pages: { start: 2, end: 2 },
      })

      // Should only get images from page 2
      expect(images.every((img) => img.page === 2)).toBe(true)
    })
  })
})

// =============================================================================
// Form Field Extraction Tests
// =============================================================================

describe('PDF Extraction - Form Fields', () => {
  let parser: DocumentParser

  beforeEach(() => {
    parser = new DocumentParser()
  })

  describe('Text Fields', () => {
    it('should extract text field values', async () => {
      // PDF with AcroForm text field (would need pdf-lib to create)
      const extractor = parser as unknown as {
        extractFormFields(pdf: Uint8Array): Promise<ExtractedFormField[]>
      }

      const pdf = await createTestPDF('<input type="text" name="fullName" value="John Doe" />')
      const fields = await extractor.extractFormFields(pdf)

      const nameField = fields.find((f) => f.name === 'fullName')
      expect(nameField).toBeDefined()
      expect(nameField?.type).toBe('text')
      expect(nameField?.value).toBe('John Doe')
    })

    it('should extract multiline text areas', async () => {
      const extractor = parser as unknown as {
        extractFormFields(pdf: Uint8Array): Promise<ExtractedFormField[]>
      }

      const pdf = await createTestPDF('<textarea name="comments">Line 1\nLine 2\nLine 3</textarea>')
      const fields = await extractor.extractFormFields(pdf)

      const textArea = fields.find((f) => f.name === 'comments')
      expect(textArea).toBeDefined()
      expect(textArea?.value).toContain('Line 1')
      expect(textArea?.value).toContain('Line 2')
    })

    it('should extract password fields (masked value)', async () => {
      const extractor = parser as unknown as {
        extractFormFields(pdf: Uint8Array): Promise<ExtractedFormField[]>
      }

      const pdf = await createTestPDF('<input type="password" name="secret" value="hidden123" />')
      const fields = await extractor.extractFormFields(pdf)

      const pwdField = fields.find((f) => f.name === 'secret')
      expect(pwdField).toBeDefined()
      // Password values may be masked or empty in extraction
    })
  })

  describe('Checkbox Fields', () => {
    it('should extract checked checkbox value', async () => {
      const extractor = parser as unknown as {
        extractFormFields(pdf: Uint8Array): Promise<ExtractedFormField[]>
      }

      const pdf = await createTestPDF('<input type="checkbox" name="agree" checked />')
      const fields = await extractor.extractFormFields(pdf)

      const checkbox = fields.find((f) => f.name === 'agree')
      expect(checkbox).toBeDefined()
      expect(checkbox?.type).toBe('checkbox')
      expect(checkbox?.value).toBe(true)
    })

    it('should extract unchecked checkbox value', async () => {
      const extractor = parser as unknown as {
        extractFormFields(pdf: Uint8Array): Promise<ExtractedFormField[]>
      }

      const pdf = await createTestPDF('<input type="checkbox" name="newsletter" />')
      const fields = await extractor.extractFormFields(pdf)

      const checkbox = fields.find((f) => f.name === 'newsletter')
      expect(checkbox).toBeDefined()
      expect(checkbox?.value).toBe(false)
    })
  })

  describe('Radio Button Fields', () => {
    it('should extract selected radio button value', async () => {
      const extractor = parser as unknown as {
        extractFormFields(pdf: Uint8Array): Promise<ExtractedFormField[]>
      }

      const pdf = await createTestPDF(`
        <input type="radio" name="color" value="red" />
        <input type="radio" name="color" value="green" checked />
        <input type="radio" name="color" value="blue" />
      `)
      const fields = await extractor.extractFormFields(pdf)

      const radioGroup = fields.find((f) => f.name === 'color')
      expect(radioGroup).toBeDefined()
      expect(radioGroup?.type).toBe('radio')
      expect(radioGroup?.value).toBe('green')
    })
  })

  describe('Select/Dropdown Fields', () => {
    it('should extract selected dropdown value', async () => {
      const extractor = parser as unknown as {
        extractFormFields(pdf: Uint8Array): Promise<ExtractedFormField[]>
      }

      const pdf = await createTestPDF(`
        <select name="country">
          <option value="us">United States</option>
          <option value="uk" selected>United Kingdom</option>
          <option value="ca">Canada</option>
        </select>
      `)
      const fields = await extractor.extractFormFields(pdf)

      const dropdown = fields.find((f) => f.name === 'country')
      expect(dropdown).toBeDefined()
      expect(dropdown?.type).toBe('select')
      expect(dropdown?.value).toBe('uk')
    })

    it('should extract multiselect values', async () => {
      const extractor = parser as unknown as {
        extractFormFields(pdf: Uint8Array): Promise<ExtractedFormField[]>
      }

      const pdf = await createTestPDF(`
        <select name="skills" multiple>
          <option value="js" selected>JavaScript</option>
          <option value="py" selected>Python</option>
          <option value="go">Go</option>
        </select>
      `)
      const fields = await extractor.extractFormFields(pdf)

      const multiselect = fields.find((f) => f.name === 'skills')
      expect(multiselect).toBeDefined()
      expect(Array.isArray(multiselect?.value)).toBe(true)
      expect(multiselect?.value).toContain('js')
      expect(multiselect?.value).toContain('py')
    })
  })

  describe('Date Fields', () => {
    it('should extract date field values', async () => {
      const extractor = parser as unknown as {
        extractFormFields(pdf: Uint8Array): Promise<ExtractedFormField[]>
      }

      const pdf = await createTestPDF('<input type="date" name="birthdate" value="1990-05-15" />')
      const fields = await extractor.extractFormFields(pdf)

      const dateField = fields.find((f) => f.name === 'birthdate')
      expect(dateField).toBeDefined()
      expect(dateField?.type).toBe('date')
      // Value should be parseable as a date
      expect(new Date(dateField?.value as string).getFullYear()).toBe(1990)
    })
  })

  describe('Field Metadata', () => {
    it('should extract field page number', async () => {
      const extractor = parser as unknown as {
        extractFormFields(pdf: Uint8Array): Promise<ExtractedFormField[]>
      }

      const pdf = await createTestPDF('<input type="text" name="field1" value="test" />')
      const fields = await extractor.extractFormFields(pdf)

      expect(fields[0].page).toBeDefined()
      expect(fields[0].page).toBeGreaterThanOrEqual(1)
    })

    it('should extract field bounding box', async () => {
      const extractor = parser as unknown as {
        extractFormFields(pdf: Uint8Array): Promise<ExtractedFormField[]>
      }

      const pdf = await createTestPDF('<input type="text" name="positioned" value="test" />')
      const fields = await extractor.extractFormFields(pdf)

      const field = fields.find((f) => f.name === 'positioned')
      expect(field?.bounds).toBeDefined()
      expect(field?.bounds?.x).toBeGreaterThanOrEqual(0)
      expect(field?.bounds?.y).toBeGreaterThanOrEqual(0)
      expect(field?.bounds?.width).toBeGreaterThan(0)
      expect(field?.bounds?.height).toBeGreaterThan(0)
    })
  })
})

// =============================================================================
// Encrypted PDF Tests
// =============================================================================

describe('PDF Extraction - Encrypted PDFs', () => {
  let parser: DocumentParser
  let generator: PDFGenerator

  beforeEach(() => {
    parser = new DocumentParser()
    generator = new PDFGenerator()
  })

  describe('User Password Protection', () => {
    it('should detect encrypted PDF', async () => {
      const pdf = await generator.generate('<p>Secret content</p>')
      const encrypted = await generator.encrypt(pdf, 'userpassword')

      const extractor = parser as unknown as {
        isEncrypted(pdf: Uint8Array): Promise<boolean>
      }

      expect(extractor.isEncrypted).toBeDefined()
      const isEncrypted = await extractor.isEncrypted(encrypted)
      expect(isEncrypted).toBe(true)
    })

    it('should fail to extract text without password', async () => {
      const pdf = await generator.generate('<p>Secret content</p>')
      const encrypted = await generator.encrypt(pdf, 'password123')

      await expect(parser.extractText(encrypted)).rejects.toThrow(/password|encrypted|protected/i)
    })

    it('should extract text with correct password', async () => {
      const pdf = await generator.generate('<p>Secret content</p>')
      const encrypted = await generator.encrypt(pdf, 'correctpassword')

      const extractor = parser as unknown as {
        extractText(pdf: Uint8Array, options: PDFExtractionOptions): Promise<ExtractedText>
      }

      const result = await extractor.extractText(encrypted, {
        password: 'correctpassword',
      })

      expect(result.content).toContain('Secret content')
    })

    it('should fail with incorrect password', async () => {
      const pdf = await generator.generate('<p>Secret content</p>')
      const encrypted = await generator.encrypt(pdf, 'correctpassword')

      const extractor = parser as unknown as {
        extractText(pdf: Uint8Array, options: PDFExtractionOptions): Promise<ExtractedText>
      }

      await expect(
        extractor.extractText(encrypted, { password: 'wrongpassword' })
      ).rejects.toThrow(/password|incorrect|invalid/i)
    })
  })

  describe('Owner Password Protection', () => {
    it('should extract text from PDF with owner password only', async () => {
      // Owner password restricts editing but usually allows viewing
      const pdf = await generator.generate('<p>Content</p>')
      const encrypted = await generator.encrypt(pdf, 'ownerpassword', {
        printing: 'none',
        copying: false,
        modifying: false,
      })

      const extractor = parser as unknown as {
        extractText(pdf: Uint8Array, options: PDFExtractionOptions): Promise<ExtractedText>
      }

      // Should be able to read with owner password
      const result = await extractor.extractText(encrypted, {
        password: 'ownerpassword',
      })

      expect(result.content).toContain('Content')
    })
  })

  describe('Permission Extraction', () => {
    it('should extract PDF permissions', async () => {
      const pdf = await generator.generate('<p>Content</p>')
      const encrypted = await generator.encrypt(pdf, 'password', {
        printing: 'lowResolution',
        copying: false,
        modifying: false,
        annotating: true,
      })

      const extractor = parser as unknown as {
        getPermissions(pdf: Uint8Array, options: PDFExtractionOptions): Promise<{
          printing: boolean
          copying: boolean
          modifying: boolean
          annotating: boolean
        }>
      }

      expect(extractor.getPermissions).toBeDefined()
      const permissions = await extractor.getPermissions(encrypted, {
        password: 'password',
      })

      expect(permissions.printing).toBe(true) // lowResolution still allows printing
      expect(permissions.copying).toBe(false)
      expect(permissions.modifying).toBe(false)
      expect(permissions.annotating).toBe(true)
    })
  })

  describe('Encryption Method Detection', () => {
    it('should detect encryption method', async () => {
      const pdf = await generator.generate('<p>Content</p>')
      const encrypted = await generator.encrypt(pdf, 'password')

      const extractor = parser as unknown as {
        getEncryptionInfo(pdf: Uint8Array): Promise<{
          encrypted: boolean
          method?: string
          keyLength?: number
        }>
      }

      expect(extractor.getEncryptionInfo).toBeDefined()
      const info = await extractor.getEncryptionInfo(encrypted)

      expect(info.encrypted).toBe(true)
      expect(info.method).toBeDefined()
      // Common methods: 'AES-128', 'AES-256', 'RC4'
      expect(['AES-128', 'AES-256', 'RC4', 'Standard']).toContain(info.method)
    })
  })
})

// =============================================================================
// PDF Structure Parsing Tests
// =============================================================================

describe('PDF Extraction - Structure Parsing', () => {
  let parser: DocumentParser

  beforeEach(() => {
    parser = new DocumentParser()
  })

  describe('Page Information', () => {
    it('should extract page count', async () => {
      const pdf = await createTestPDF(`
        <p>Page 1</p>
        <div style="page-break-after: always"></div>
        <p>Page 2</p>
        <div style="page-break-after: always"></div>
        <p>Page 3</p>
      `)
      const result = await parser.extract(pdf)

      expect(result.pageCount).toBeGreaterThanOrEqual(3)
    })

    it('should extract page dimensions', async () => {
      const extractor = parser as unknown as {
        getStructure(pdf: Uint8Array): Promise<PDFStructure>
      }

      const pdf = await createTestPDF('<p>Content</p>')

      expect(extractor.getStructure).toBeDefined()
      const structure = await extractor.getStructure(pdf)

      expect(structure.pages).toHaveLength(structure.pageCount)
      expect(structure.pages[0].width).toBeGreaterThan(0)
      expect(structure.pages[0].height).toBeGreaterThan(0)
    })

    it('should detect page rotation', async () => {
      const extractor = parser as unknown as {
        getStructure(pdf: Uint8Array): Promise<PDFStructure>
      }

      // PDF with rotated pages (would need pdf-lib to create)
      const pdf = await createTestPDF('<p>Content</p>')
      const structure = await extractor.getStructure(pdf)

      expect(structure.pages[0].rotation).toBeDefined()
      // Rotation should be 0, 90, 180, or 270
      expect([0, 90, 180, 270, undefined]).toContain(structure.pages[0].rotation)
    })
  })

  describe('Font Information', () => {
    it('should list fonts used in document', async () => {
      const extractor = parser as unknown as {
        getStructure(pdf: Uint8Array): Promise<PDFStructure>
      }

      const pdf = await createTestPDF(`
        <p style="font-family: Helvetica;">Helvetica text</p>
        <p style="font-family: Times;">Times text</p>
      `)
      const structure = await extractor.getStructure(pdf)

      expect(structure.fonts).toBeInstanceOf(Array)
      expect(structure.fonts.length).toBeGreaterThan(0)

      const font = structure.fonts[0]
      expect(font.name).toBeDefined()
      expect(font.type).toBeDefined()
      expect(typeof font.embedded).toBe('boolean')
    })

    it('should identify embedded vs referenced fonts', async () => {
      const extractor = parser as unknown as {
        getStructure(pdf: Uint8Array): Promise<PDFStructure>
      }

      const pdf = await createTestPDF('<p>Content with fonts</p>')
      const structure = await extractor.getStructure(pdf)

      for (const font of structure.fonts) {
        expect(typeof font.embedded).toBe('boolean')
      }
    })

    it('should track font usage by page', async () => {
      const extractor = parser as unknown as {
        getStructure(pdf: Uint8Array): Promise<PDFStructure>
      }

      const pdf = await createTestPDF('<p>Content</p>')
      const structure = await extractor.getStructure(pdf)

      for (const font of structure.fonts) {
        expect(font.usedOnPages).toBeInstanceOf(Array)
      }
    })
  })

  describe('Bookmarks/Outline', () => {
    it('should extract bookmarks/outline', async () => {
      const extractor = parser as unknown as {
        getStructure(pdf: Uint8Array): Promise<PDFStructure>
      }

      // PDF with bookmarks
      const pdf = await createTestPDF(`
        <h1 id="chapter1">Chapter 1</h1>
        <p>Content</p>
        <h1 id="chapter2">Chapter 2</h1>
        <p>More content</p>
      `)
      const structure = await extractor.getStructure(pdf)

      expect(structure.bookmarks).toBeInstanceOf(Array)
    })

    it('should extract nested bookmarks', async () => {
      const extractor = parser as unknown as {
        getStructure(pdf: Uint8Array): Promise<PDFStructure>
      }

      const pdf = await createTestPDF(`
        <h1>Part 1</h1>
        <h2>Chapter 1.1</h2>
        <h2>Chapter 1.2</h2>
        <h1>Part 2</h1>
        <h2>Chapter 2.1</h2>
      `)
      const structure = await extractor.getStructure(pdf)

      // Check for nested structure
      const topLevel = structure.bookmarks.find((b) => b.title.includes('Part 1'))
      if (topLevel?.children) {
        expect(topLevel.children.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Annotations', () => {
    it('should extract annotations', async () => {
      const extractor = parser as unknown as {
        extractAnnotations(pdf: Uint8Array): Promise<PDFAnnotation[]>
      }

      const pdf = await createTestPDF('<p>Content with annotations</p>')

      expect(extractor.extractAnnotations).toBeDefined()
      const annotations = await extractor.extractAnnotations(pdf)

      expect(annotations).toBeInstanceOf(Array)
    })

    it('should extract highlight annotations', async () => {
      const extractor = parser as unknown as {
        extractAnnotations(pdf: Uint8Array): Promise<PDFAnnotation[]>
      }

      // PDF with highlight annotation
      const pdf = await createTestPDF('<p><mark>Highlighted text</mark></p>')
      const annotations = await extractor.extractAnnotations(pdf)

      const highlight = annotations.find((a) => a.type === 'highlight')
      if (highlight) {
        expect(highlight.page).toBeGreaterThanOrEqual(1)
        expect(highlight.bounds).toBeDefined()
      }
    })

    it('should extract note annotations with content', async () => {
      const extractor = parser as unknown as {
        extractAnnotations(pdf: Uint8Array): Promise<PDFAnnotation[]>
      }

      const pdf = await createTestPDF('<p>Text with a note</p>')
      const annotations = await extractor.extractAnnotations(pdf)

      const note = annotations.find((a) => a.type === 'note')
      if (note) {
        expect(note.content).toBeDefined()
      }
    })

    it('should extract link annotations', async () => {
      const extractor = parser as unknown as {
        extractAnnotations(pdf: Uint8Array): Promise<PDFAnnotation[]>
      }

      const pdf = await createTestPDF('<a href="https://example.com">Link text</a>')
      const annotations = await extractor.extractAnnotations(pdf)

      const link = annotations.find((a) => a.type === 'link')
      if (link) {
        expect(link.destination).toContain('example.com')
      }
    })
  })

  describe('PDF Version and Features', () => {
    it('should extract PDF version', async () => {
      const extractor = parser as unknown as {
        getStructure(pdf: Uint8Array): Promise<PDFStructure>
      }

      const pdf = await createTestPDF('<p>Content</p>')
      const structure = await extractor.getStructure(pdf)

      expect(structure.version).toBeDefined()
      expect(structure.version).toMatch(/^\d+\.\d+$/) // e.g., "1.7"
    })

    it('should detect tagged (accessible) PDF', async () => {
      const extractor = parser as unknown as {
        getStructure(pdf: Uint8Array): Promise<PDFStructure>
      }

      const pdf = await createTestPDF('<p>Content</p>')
      const structure = await extractor.getStructure(pdf)

      expect(typeof structure.isTagged).toBe('boolean')
    })

    it('should detect form presence', async () => {
      const extractor = parser as unknown as {
        getStructure(pdf: Uint8Array): Promise<PDFStructure>
      }

      const pdf = await createTestPDF('<input type="text" name="field" />')
      const structure = await extractor.getStructure(pdf)

      expect(typeof structure.hasForm).toBe('boolean')
    })

    it('should detect digital signatures', async () => {
      const extractor = parser as unknown as {
        getStructure(pdf: Uint8Array): Promise<PDFStructure>
      }

      const pdf = await createTestPDF('<p>Signed document</p>')
      const structure = await extractor.getStructure(pdf)

      expect(typeof structure.hasSignatures).toBe('boolean')
    })
  })
})

// =============================================================================
// Table Extraction Tests
// =============================================================================

describe('PDF Extraction - Tables', () => {
  let parser: DocumentParser

  beforeEach(() => {
    parser = new DocumentParser()
  })

  describe('Basic Table Extraction', () => {
    it('should extract table with headers and rows', async () => {
      const pdf = await createTestPDF(`
        <table>
          <thead>
            <tr><th>Name</th><th>Age</th><th>City</th></tr>
          </thead>
          <tbody>
            <tr><td>Alice</td><td>30</td><td>New York</td></tr>
            <tr><td>Bob</td><td>25</td><td>Los Angeles</td></tr>
            <tr><td>Carol</td><td>35</td><td>Chicago</td></tr>
          </tbody>
        </table>
      `)
      const tables = await parser.extractTables(pdf)

      expect(tables.length).toBeGreaterThan(0)
      const table = tables[0]
      expect(table.headers).toEqual(['Name', 'Age', 'City'])
      expect(table.rows).toHaveLength(3)
      expect(table.rows[0]).toEqual(['Alice', '30', 'New York'])
    })

    it('should handle table without explicit headers', async () => {
      const pdf = await createTestPDF(`
        <table>
          <tr><td>A1</td><td>B1</td></tr>
          <tr><td>A2</td><td>B2</td></tr>
        </table>
      `)
      const tables = await parser.extractTables(pdf)

      expect(tables.length).toBeGreaterThan(0)
      // First row might be treated as headers or all as rows
      expect(tables[0].rows.length).toBeGreaterThanOrEqual(1)
    })

    it('should extract multiple tables from document', async () => {
      const pdf = await createTestPDF(`
        <table>
          <tr><th>Table 1</th></tr>
          <tr><td>Data 1</td></tr>
        </table>
        <p>Some text between tables</p>
        <table>
          <tr><th>Table 2</th></tr>
          <tr><td>Data 2</td></tr>
        </table>
      `)
      const tables = await parser.extractTables(pdf)

      expect(tables.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Table Structure', () => {
    it('should extract table page number', async () => {
      const pdf = await createTestPDF(`
        <table>
          <tr><th>Header</th></tr>
          <tr><td>Data</td></tr>
        </table>
      `)
      const tables = await parser.extractTables(pdf)

      expect(tables[0].page).toBeDefined()
      expect(tables[0].page).toBeGreaterThanOrEqual(1)
    })

    it('should extract table bounding box', async () => {
      const pdf = await createTestPDF(`
        <table>
          <tr><th>Header</th></tr>
          <tr><td>Data</td></tr>
        </table>
      `)
      const tables = await parser.extractTables(pdf)

      expect(tables[0].bounds).toBeDefined()
      expect(tables[0].bounds?.x).toBeGreaterThanOrEqual(0)
      expect(tables[0].bounds?.y).toBeGreaterThanOrEqual(0)
      expect(tables[0].bounds?.width).toBeGreaterThan(0)
      expect(tables[0].bounds?.height).toBeGreaterThan(0)
    })
  })

  describe('Complex Tables', () => {
    it('should handle merged cells (colspan)', async () => {
      const pdf = await createTestPDF(`
        <table>
          <tr><th colspan="2">Merged Header</th></tr>
          <tr><td>Left</td><td>Right</td></tr>
        </table>
      `)
      const tables = await parser.extractTables(pdf)

      // Should handle colspan gracefully
      expect(tables.length).toBeGreaterThan(0)
    })

    it('should handle merged cells (rowspan)', async () => {
      const pdf = await createTestPDF(`
        <table>
          <tr><td rowspan="2">Merged</td><td>A</td></tr>
          <tr><td>B</td></tr>
        </table>
      `)
      const tables = await parser.extractTables(pdf)

      expect(tables.length).toBeGreaterThan(0)
    })

    it('should handle tables with empty cells', async () => {
      const pdf = await createTestPDF(`
        <table>
          <tr><th>A</th><th>B</th><th>C</th></tr>
          <tr><td>1</td><td></td><td>3</td></tr>
          <tr><td></td><td>2</td><td></td></tr>
        </table>
      `)
      const tables = await parser.extractTables(pdf)

      expect(tables.length).toBeGreaterThan(0)
      // Empty cells should be preserved as empty strings
      const table = tables[0]
      expect(table.rows.some((row) => row.includes(''))).toBe(true)
    })

    it('should handle nested tables', async () => {
      const pdf = await createTestPDF(`
        <table>
          <tr>
            <td>
              <table>
                <tr><td>Nested</td></tr>
              </table>
            </td>
            <td>Outer</td>
          </tr>
        </table>
      `)
      const tables = await parser.extractTables(pdf)

      // Should extract at least the outer table
      expect(tables.length).toBeGreaterThan(0)
    })
  })
})

// =============================================================================
// Full Document Extraction Tests
// =============================================================================

describe('PDF Extraction - Full Document', () => {
  let parser: DocumentParser

  beforeEach(() => {
    parser = new DocumentParser()
  })

  describe('Complete Extraction', () => {
    it('should perform full extraction with all components', async () => {
      const pdf = await createTestPDF(`
        <h1>Document Title</h1>
        <p>Some text content</p>
        <table>
          <tr><th>Column</th></tr>
          <tr><td>Value</td></tr>
        </table>
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />
      `)

      const result = await parser.extract(pdf)

      expect(result.text).toBeDefined()
      expect(result.text.content).toContain('Document Title')
      expect(result.formFields).toBeInstanceOf(Array)
      expect(result.tables).toBeInstanceOf(Array)
      expect(result.metadata).toBeDefined()
      expect(result.pageCount).toBeGreaterThan(0)
      expect(result.extractedAt).toBeInstanceOf(Date)
    })

    it('should include images in full extraction', async () => {
      const pdf = await createTestPDF(`
        <p>Text content</p>
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />
      `)

      const result = await parser.extract(pdf) as ExtendedDocumentExtraction

      expect(result.images).toBeDefined()
      expect(result.images).toBeInstanceOf(Array)
    })
  })

  describe('Extraction Options', () => {
    it('should respect extraction options', async () => {
      const pdf = await createTestPDF('<p>Content</p>')

      const extractor = parser as unknown as {
        extract(pdf: Uint8Array, options: PDFExtractionOptions): Promise<ExtendedDocumentExtraction>
      }

      const result = await extractor.extract(pdf, {
        extractImages: true,
        extractAnnotations: true,
        extractBookmarks: true,
        extractFonts: true,
        includeTextCoordinates: true,
      })

      expect(result.images).toBeDefined()
      expect(result.annotations).toBeDefined()
      expect(result.textBlocks).toBeDefined()
      expect(result.structure).toBeDefined()
    })

    it('should handle page range in full extraction', async () => {
      const pdf = await createTestPDF(`
        <p>Page 1</p>
        <div style="page-break-after: always"></div>
        <p>Page 2</p>
        <div style="page-break-after: always"></div>
        <p>Page 3</p>
      `)

      const extractor = parser as unknown as {
        extract(pdf: Uint8Array, options: PDFExtractionOptions): Promise<ExtendedDocumentExtraction>
      }

      const result = await extractor.extract(pdf, {
        pages: { start: 1, end: 2 },
      })

      expect(result.text.content).toContain('Page 1')
      expect(result.text.content).toContain('Page 2')
      expect(result.text.content).not.toContain('Page 3')
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('PDF Extraction - Error Handling', () => {
  let parser: DocumentParser

  beforeEach(() => {
    parser = new DocumentParser()
  })

  describe('Invalid Input', () => {
    it('should throw error for empty input', async () => {
      await expect(parser.extractText(new Uint8Array())).rejects.toThrow()
    })

    it('should throw error for non-PDF data', async () => {
      const notPdf = new TextEncoder().encode('This is not a PDF')
      await expect(parser.extractText(notPdf)).rejects.toThrow(/invalid|not a pdf|malformed/i)
    })

    it('should throw error for truncated PDF', async () => {
      const pdf = await createTestPDF('<p>Content</p>')
      // Truncate the PDF
      const truncated = pdf.slice(0, pdf.length / 2)

      await expect(parser.extractText(truncated)).rejects.toThrow(/truncated|incomplete|corrupt/i)
    })

    it('should throw error for corrupted PDF', async () => {
      const pdf = await createTestPDF('<p>Content</p>')
      // Corrupt the PDF by modifying bytes
      const corrupted = new Uint8Array(pdf)
      for (let i = 100; i < 200 && i < corrupted.length; i++) {
        corrupted[i] = Math.floor(Math.random() * 256)
      }

      await expect(parser.extractText(corrupted)).rejects.toThrow()
    })
  })

  describe('Graceful Degradation', () => {
    it('should return empty results for PDF without text', async () => {
      // PDF with only an image
      const pdf = await createTestPDF(`
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />
      `)

      const result = await parser.extractText(pdf)

      // Should not throw, but return minimal/empty content
      expect(result).toBeDefined()
    })

    it('should return empty arrays for PDF without forms', async () => {
      const pdf = await createTestPDF('<p>No forms here</p>')
      const fields = await parser.extractFormFields(pdf)

      expect(fields).toBeInstanceOf(Array)
      expect(fields).toHaveLength(0)
    })

    it('should return empty arrays for PDF without tables', async () => {
      const pdf = await createTestPDF('<p>No tables here</p>')
      const tables = await parser.extractTables(pdf)

      expect(tables).toBeInstanceOf(Array)
      expect(tables).toHaveLength(0)
    })
  })
})

// =============================================================================
// Performance Tests (marked as slow)
// =============================================================================

describe.skip('PDF Extraction - Performance', () => {
  let parser: DocumentParser

  beforeEach(() => {
    parser = new DocumentParser()
  })

  it('should extract text from large document efficiently', async () => {
    // Generate a large PDF
    const pages = Array(100)
      .fill(null)
      .map((_, i) => `<p>Page ${i + 1} with lots of content...</p>`)
      .join('<div style="page-break-after: always"></div>')

    const pdf = await createTestPDF(pages)

    const start = Date.now()
    await parser.extractText(pdf)
    const duration = Date.now() - start

    // Should complete in reasonable time
    expect(duration).toBeLessThan(10000) // 10 seconds
  })

  it('should handle document with many images', async () => {
    const images = Array(50)
      .fill('<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />')
      .join('\n')

    const pdf = await createTestPDF(images)

    const extractor = parser as unknown as {
      extractImages(pdf: Uint8Array): Promise<ExtractedImage[]>
    }

    const start = Date.now()
    await extractor.extractImages(pdf)
    const duration = Date.now() - start

    expect(duration).toBeLessThan(5000) // 5 seconds
  })
})
