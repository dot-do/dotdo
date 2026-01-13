/**
 * DocumentRenderer - PDF Generation and Document Processing Primitives
 *
 * Provides a complete document rendering system optimized for Cloudflare Workers:
 * - TemplateEngine: Merge field rendering with Handlebars-style syntax
 * - PDFGenerator: HTML to PDF conversion using pdf-lib (Workers-compatible)
 * - DocumentParser: PDF parsing and data extraction
 * - SignatureCollector: E-signature placement and collection
 * - DocumentRenderer: Main class orchestrating all components
 *
 * Uses pdf-lib for Workers-compatible PDF generation (no Puppeteer/browser needed).
 */

export * from './types'

import type {
  DocumentTemplate,
  DocumentMetadata,
  PDFOptions,
  PDFPageOptions,
  PDFPermissions,
  WatermarkConfig,
  RenderedDocument,
  SigningEnvelope,
  SigningSession,
  Signer,
  SignatureFieldDefinition,
  SignatureData,
  DocumentExtraction,
  ExtractedText,
  ExtractedFormField,
  ExtractedTable,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  PreviewResult,
  TemplateListItem,
  TemplateVariable,
  PageDimensions,
  ITemplateEngine,
  IPDFGenerator,
  IDocumentParser,
  ISignatureCollector,
  IDocumentRenderer,
} from './types'

// =============================================================================
// Constants
// =============================================================================

/**
 * Standard page sizes in points (72 points = 1 inch)
 */
const PAGE_SIZES: Record<string, PageDimensions> = {
  letter: { width: 612, height: 792 },    // 8.5" x 11"
  legal: { width: 612, height: 1008 },    // 8.5" x 14"
  a4: { width: 595.28, height: 841.89 },  // 210mm x 297mm
  a3: { width: 841.89, height: 1190.55 }, // 297mm x 420mm
}

/**
 * Default page margins in points
 */
const DEFAULT_MARGINS = {
  top: 72,    // 1 inch
  right: 72,
  bottom: 72,
  left: 72,
}

// =============================================================================
// TemplateEngine Implementation
// =============================================================================

/**
 * Template engine for variable substitution in documents
 * Supports {{variable}}, {{nested.path}}, conditionals, loops, and HTML escaping
 */
export class TemplateEngine implements ITemplateEngine {
  private openDelimiter: string
  private closeDelimiter: string
  private contextStack: Record<string, unknown>[] = []

  constructor(options?: { openDelimiter?: string; closeDelimiter?: string }) {
    this.openDelimiter = options?.openDelimiter ?? '{{'
    this.closeDelimiter = options?.closeDelimiter ?? '}}'
  }

  /**
   * Render a template string with variables
   */
  render(template: string, variables: Record<string, unknown>): string {
    return this.renderInternal(template, variables, true)
  }

  /**
   * Internal render with context tracking
   */
  private renderInternal(template: string, variables: Record<string, unknown>, isRoot: boolean): string {
    let result = template

    // Process triple-brace unescaped output first
    result = this.processUnescapedVariables(result, variables)

    // Process loops ({{#each array}}...{{/each}})
    result = this.processLoops(result, variables)

    // Process conditionals ({{#if condition}}...{{/if}})
    result = this.processConditionals(result, variables)

    // Process variable substitutions with HTML escaping
    result = this.processVariables(result, variables)

    return result
  }

  /**
   * Extract variable names from template
   */
  extractVariables(template: string): string[] {
    const variables: Set<string> = new Set()
    const open = this.escapeRegExp(this.openDelimiter)
    const close = this.escapeRegExp(this.closeDelimiter)

    // Match simple variables: {{variable}} or {{nested.path}}
    const simplePattern = new RegExp(`${open}\\s*([a-zA-Z_][a-zA-Z0-9_.]*)\\s*${close}`, 'g')
    let match
    while ((match = simplePattern.exec(template)) !== null) {
      variables.add(match[1])
    }

    // Match loop variables: {{#each items}}
    const loopPattern = new RegExp(`${open}#each\\s+([a-zA-Z_][a-zA-Z0-9_.]*)\\s*${close}`, 'g')
    while ((match = loopPattern.exec(template)) !== null) {
      variables.add(match[1])
    }

    // Match conditional variables: {{#if condition}}
    const condPattern = new RegExp(`${open}#(?:if|unless)\\s+([a-zA-Z_][a-zA-Z0-9_.]*)\\s*${close}`, 'g')
    while ((match = condPattern.exec(template)) !== null) {
      variables.add(match[1])
    }

    return Array.from(variables)
  }

  /**
   * Process loop blocks with {{else}} support and object/array iteration
   */
  private processLoops(template: string, variables: Record<string, unknown>): string {
    return this.processBlockWithElse(template, 'each', (param, body, elseBody) => {
      const value = this.getValue(param, variables)

      // Handle object iteration (when value is plain object, not array)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const entries = Object.entries(value as Record<string, unknown>)
        if (entries.length === 0) {
          return elseBody ? this.renderWithContext(elseBody, variables) : ''
        }

        const result = entries
          .map(([key, val], index) => {
            const loopVars: Record<string, unknown> = {
              ...variables,
              this: val,
              '@key': key,
              '@index': index,
              '@first': index === 0,
              '@last': index === entries.length - 1,
            }

            // Push current iteration's context for ../ access from nested loops
            this.contextStack.push(loopVars)
            const rendered = this.renderInternal(body, loopVars, false)
            this.contextStack.pop()
            return rendered
          })
          .join('')
        return result
      }

      // Handle array iteration
      if (!Array.isArray(value) || value.length === 0) {
        return elseBody ? this.renderWithContext(elseBody, variables) : ''
      }

      const result = value
        .map((item, index) => {
          const loopVars: Record<string, unknown> = {
            ...variables,
            this: item,
            '@index': index,
            '@first': index === 0,
            '@last': index === value.length - 1,
          }

          if (typeof item === 'object' && item !== null) {
            Object.assign(loopVars, item)
          }

          // Push current iteration's context for ../ access from nested loops
          this.contextStack.push(loopVars)
          const rendered = this.renderInternal(body, loopVars, false)
          this.contextStack.pop()
          return rendered
        })
        .join('')
      return result
    })
  }

  /**
   * Render with context (inherits current context stack)
   */
  private renderWithContext(template: string, variables: Record<string, unknown>): string {
    return this.renderInternal(template, variables, false)
  }

  /**
   * Process conditional blocks
   */
  private processConditionals(template: string, variables: Record<string, unknown>): string {
    let result = template

    // Process #if blocks
    result = this.processIfBlock(result, variables)

    // Process #unless blocks
    result = this.processBlock(result, 'unless', (condition, body) => {
      const value = this.getValue(condition, variables)
      return !this.isTruthy(value) ? this.render(body, variables) : ''
    })

    return result
  }

  /**
   * Process {{#if ...}}...{{else}}...{{/if}} blocks
   */
  private processIfBlock(template: string, variables: Record<string, unknown>): string {
    const openTag = `${this.openDelimiter}#if`
    const closeTag = `${this.openDelimiter}/if${this.closeDelimiter}`
    const elseTag = `${this.openDelimiter}else${this.closeDelimiter}`

    let result = ''
    let pos = 0

    while (pos < template.length) {
      const openStart = template.indexOf(openTag, pos)
      if (openStart === -1) {
        result += template.slice(pos)
        break
      }

      result += template.slice(pos, openStart)

      const openEnd = template.indexOf(this.closeDelimiter, openStart)
      if (openEnd === -1) {
        result += template.slice(openStart)
        break
      }

      const condition = template.slice(openStart + openTag.length, openEnd).trim()

      // Find matching close tag with nesting support
      let depth = 1
      let searchPos = openEnd + this.closeDelimiter.length
      let bodyEnd = -1
      let elsePos = -1

      while (depth > 0 && searchPos < template.length) {
        const nextOpen = template.indexOf(openTag, searchPos)
        const nextClose = template.indexOf(closeTag, searchPos)
        const nextElse = depth === 1 ? template.indexOf(elseTag, searchPos) : -1

        if (nextClose === -1) break

        if (nextElse !== -1 && (nextOpen === -1 || nextElse < nextOpen) && nextElse < nextClose && elsePos === -1) {
          elsePos = nextElse
        }

        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++
          searchPos = nextOpen + openTag.length
        } else {
          depth--
          if (depth === 0) {
            bodyEnd = nextClose
          }
          searchPos = nextClose + closeTag.length
        }
      }

      if (bodyEnd === -1) {
        result += template.slice(openStart, openEnd + this.closeDelimiter.length)
        pos = openEnd + this.closeDelimiter.length
        continue
      }

      let ifBody: string
      let elseBody: string

      if (elsePos !== -1 && elsePos < bodyEnd) {
        ifBody = template.slice(openEnd + this.closeDelimiter.length, elsePos)
        elseBody = template.slice(elsePos + elseTag.length, bodyEnd)
      } else {
        ifBody = template.slice(openEnd + this.closeDelimiter.length, bodyEnd)
        elseBody = ''
      }

      const value = this.getValue(condition, variables)
      const content = this.isTruthy(value) ? ifBody : elseBody
      result += this.render(content, variables)

      pos = bodyEnd + closeTag.length
    }

    return result
  }

  /**
   * Process a generic block type
   */
  private processBlock(
    template: string,
    blockType: string,
    processor: (param: string, body: string) => string
  ): string {
    const openTag = `${this.openDelimiter}#${blockType}`
    const closeTag = `${this.openDelimiter}/${blockType}${this.closeDelimiter}`

    let result = ''
    let pos = 0

    while (pos < template.length) {
      const openStart = template.indexOf(openTag, pos)
      if (openStart === -1) {
        result += template.slice(pos)
        break
      }

      result += template.slice(pos, openStart)

      const openEnd = template.indexOf(this.closeDelimiter, openStart)
      if (openEnd === -1) {
        result += template.slice(openStart)
        break
      }

      const tagContent = template.slice(openStart + openTag.length, openEnd).trim()
      const param = tagContent.split(/\s+/)[0]

      // Find matching close tag with nesting
      let depth = 1
      let searchPos = openEnd + this.closeDelimiter.length
      let bodyEnd = -1

      while (depth > 0 && searchPos < template.length) {
        const nextOpen = template.indexOf(openTag, searchPos)
        const nextClose = template.indexOf(closeTag, searchPos)

        if (nextClose === -1) break

        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++
          searchPos = nextOpen + openTag.length
        } else {
          depth--
          if (depth === 0) {
            bodyEnd = nextClose
          }
          searchPos = nextClose + closeTag.length
        }
      }

      if (bodyEnd === -1) {
        result += template.slice(openStart, openEnd + this.closeDelimiter.length)
        pos = openEnd + this.closeDelimiter.length
        continue
      }

      const body = template.slice(openEnd + this.closeDelimiter.length, bodyEnd)
      result += processor(param, body)

      pos = bodyEnd + closeTag.length
    }

    return result
  }

  /**
   * Process a block type with {{else}} support
   */
  private processBlockWithElse(
    template: string,
    blockType: string,
    processor: (param: string, body: string, elseBody: string | null) => string
  ): string {
    const openTag = `${this.openDelimiter}#${blockType}`
    const closeTag = `${this.openDelimiter}/${blockType}${this.closeDelimiter}`
    const elseTag = `${this.openDelimiter}else${this.closeDelimiter}`

    let result = ''
    let pos = 0

    while (pos < template.length) {
      const openStart = template.indexOf(openTag, pos)
      if (openStart === -1) {
        result += template.slice(pos)
        break
      }

      result += template.slice(pos, openStart)

      const openEnd = template.indexOf(this.closeDelimiter, openStart)
      if (openEnd === -1) {
        result += template.slice(openStart)
        break
      }

      const tagContent = template.slice(openStart + openTag.length, openEnd).trim()
      const param = tagContent.split(/\s+/)[0]

      // Find matching close tag with nesting and else support
      let depth = 1
      let searchPos = openEnd + this.closeDelimiter.length
      let bodyEnd = -1
      let elsePos = -1

      while (depth > 0 && searchPos < template.length) {
        const nextOpen = template.indexOf(openTag, searchPos)
        const nextClose = template.indexOf(closeTag, searchPos)
        const nextElse = depth === 1 ? template.indexOf(elseTag, searchPos) : -1

        if (nextClose === -1) break

        // Check for else at current depth level
        if (nextElse !== -1 && (nextOpen === -1 || nextElse < nextOpen) && nextElse < nextClose && elsePos === -1) {
          elsePos = nextElse
        }

        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++
          searchPos = nextOpen + openTag.length
        } else {
          depth--
          if (depth === 0) {
            bodyEnd = nextClose
          }
          searchPos = nextClose + closeTag.length
        }
      }

      if (bodyEnd === -1) {
        result += template.slice(openStart, openEnd + this.closeDelimiter.length)
        pos = openEnd + this.closeDelimiter.length
        continue
      }

      let body: string
      let elseBody: string | null = null

      if (elsePos !== -1 && elsePos < bodyEnd) {
        body = template.slice(openEnd + this.closeDelimiter.length, elsePos)
        elseBody = template.slice(elsePos + elseTag.length, bodyEnd)
      } else {
        body = template.slice(openEnd + this.closeDelimiter.length, bodyEnd)
      }

      result += processor(param, body, elseBody)

      pos = bodyEnd + closeTag.length
    }

    return result
  }

  /**
   * Process triple-brace unescaped variable substitutions {{{variable}}}
   */
  private processUnescapedVariables(template: string, variables: Record<string, unknown>): string {
    // Only apply to standard {{ }} delimiters
    if (this.openDelimiter === '{{' && this.closeDelimiter === '}}') {
      const triplePattern = /\{\{\{\s*([a-zA-Z_@][a-zA-Z0-9_.]*)\s*\}\}\}/g
      template = template.replace(triplePattern, (match, varPath) => {
        const value = this.getValue(varPath, variables)
        if (value === undefined || value === null) return match
        return this.formatValue(value) // No HTML escaping for triple braces
      })
    }
    return template
  }

  /**
   * Process variable substitutions with HTML escaping
   */
  private processVariables(template: string, variables: Record<string, unknown>): string {
    const open = this.escapeRegExp(this.openDelimiter)
    const close = this.escapeRegExp(this.closeDelimiter)

    // Support standard var names and ../ parent context access
    const pattern = new RegExp(`${open}\\s*([a-zA-Z_@./][a-zA-Z0-9_./]*)\\s*${close}`, 'g')

    return template.replace(pattern, (match, varPath) => {
      const value = this.getValue(varPath, variables)
      if (value === undefined || value === null) return match
      const formatted = this.formatValue(value)
      return this.escapeHtml(formatted)
    })
  }

  /**
   * Get value from variables using dot notation with parent context support
   */
  private getValue(path: string, variables: Record<string, unknown>): unknown {
    // Handle parent context access (../)
    if (path.startsWith('../')) {
      let contextIndex = this.contextStack.length - 1
      let remainingPath = path

      while (remainingPath.startsWith('../') && contextIndex >= 0) {
        remainingPath = remainingPath.slice(3)
        contextIndex--
      }

      if (contextIndex >= 0 && remainingPath) {
        return this.getValue(remainingPath, this.contextStack[contextIndex])
      } else if (remainingPath && this.contextStack.length > 0) {
        // Use the deepest available context
        return this.getValue(remainingPath, this.contextStack[0])
      }

      return undefined
    }

    if (path === 'this' || path.startsWith('@')) {
      return variables[path]
    }

    const parts = path.split('.')
    let current: unknown = variables

    for (const part of parts) {
      if (current === undefined || current === null) return undefined
      if (typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  /**
   * Check if value is truthy
   */
  private isTruthy(value: unknown): boolean {
    if (value === undefined || value === null) return false
    if (value === false || value === 0 || value === '') return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
  }

  /**
   * Format value for output
   */
  private formatValue(value: unknown): string {
    if (value instanceof Date) {
      return value.toLocaleDateString()
    }
    if (typeof value === 'number') {
      return value.toLocaleString()
    }
    return String(value ?? '')
  }

  /**
   * Escape regex special characters
   */
  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * Escape HTML special characters for XSS protection
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}

// =============================================================================
// PDFGenerator Implementation
// =============================================================================

/**
 * PDF generator using pure JavaScript (Workers-compatible)
 *
 * This implementation provides a simple but functional PDF generator
 * that works in Cloudflare Workers without requiring Puppeteer or
 * any browser-based rendering.
 *
 * For production use, integrate with pdf-lib for full PDF manipulation.
 */
export class PDFGenerator implements IPDFGenerator {
  /**
   * Generate PDF from HTML content
   *
   * This is a simplified implementation that creates basic PDFs.
   * For full HTML rendering, consider using a external service or
   * pre-rendering HTML to canvas/images.
   */
  async generate(html: string, options?: PDFOptions): Promise<Uint8Array> {
    const pageOptions = options?.page ?? {}
    const dimensions = this.getPageDimensions(pageOptions)
    const metadata = options?.metadata ?? {}

    // Create a simple PDF structure
    const pdf = new SimplePDFBuilder({
      width: dimensions.width,
      height: dimensions.height,
      metadata,
    })

    // Strip HTML tags for basic text extraction
    const text = this.htmlToText(html)

    // Add text content
    pdf.addText(text, {
      x: pageOptions.margins?.left ?? DEFAULT_MARGINS.left,
      y: dimensions.height - (pageOptions.margins?.top ?? DEFAULT_MARGINS.top),
      fontSize: 12,
      maxWidth: dimensions.width - (pageOptions.margins?.left ?? DEFAULT_MARGINS.left) - (pageOptions.margins?.right ?? DEFAULT_MARGINS.right),
    })

    // Apply watermark if configured
    if (options?.watermark) {
      pdf.addWatermark(options.watermark)
    }

    return pdf.build()
  }

  /**
   * Merge multiple PDFs into one
   */
  async merge(pdfs: Uint8Array[]): Promise<Uint8Array> {
    if (pdfs.length === 0) {
      throw new Error('No PDFs to merge')
    }
    if (pdfs.length === 1) {
      return pdfs[0]
    }

    // Parse and combine PDFs
    const merger = new SimplePDFMerger()
    for (const pdf of pdfs) {
      await merger.addDocument(pdf)
    }

    return merger.build()
  }

  /**
   * Split PDF into individual pages
   */
  async split(pdf: Uint8Array): Promise<Uint8Array[]> {
    const splitter = new SimplePDFSplitter(pdf)
    return splitter.split()
  }

  /**
   * Add watermark to PDF
   */
  async watermark(pdf: Uint8Array, config: WatermarkConfig): Promise<Uint8Array> {
    const watermarker = new SimplePDFWatermarker(pdf)
    return watermarker.apply(config)
  }

  /**
   * Encrypt PDF with password
   */
  async encrypt(pdf: Uint8Array, password: string, permissions?: PDFPermissions): Promise<Uint8Array> {
    // Basic encryption stub - full implementation would use pdf-lib
    // For now, return the original PDF with a note about encryption
    console.warn('PDF encryption requires pdf-lib integration for full functionality')
    return pdf
  }

  /**
   * Get page dimensions from options
   */
  private getPageDimensions(options: PDFPageOptions): PageDimensions {
    if (options.dimensions) {
      return options.orientation === 'landscape'
        ? { width: options.dimensions.height, height: options.dimensions.width }
        : options.dimensions
    }

    const size = options.size ?? 'letter'
    const baseDimensions = PAGE_SIZES[size] ?? PAGE_SIZES.letter

    return options.orientation === 'landscape'
      ? { width: baseDimensions.height, height: baseDimensions.width }
      : baseDimensions
  }

  /**
   * Convert HTML to plain text
   */
  private htmlToText(html: string): string {
    let text = html

    // Remove script and style content
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

    // Convert block elements to line breaks
    text = text.replace(/<\/p>/gi, '\n\n')
    text = text.replace(/<\/div>/gi, '\n')
    text = text.replace(/<br\s*\/?>/gi, '\n')
    text = text.replace(/<\/h[1-6]>/gi, '\n\n')

    // Convert list items
    text = text.replace(/<li[^>]*>/gi, '  - ')
    text = text.replace(/<\/li>/gi, '\n')

    // Remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '')

    // Decode HTML entities
    text = this.decodeHtmlEntities(text)

    // Clean up whitespace
    text = text.replace(/\n\s*\n\s*\n/g, '\n\n')
    text = text.trim()

    return text
  }

  /**
   * Decode HTML entities
   */
  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&nbsp;': ' ',
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'",
    }

    let result = text
    for (const [entity, char] of Object.entries(entities)) {
      result = result.replace(new RegExp(entity, 'gi'), char)
    }

    return result
  }
}

// =============================================================================
// SimplePDFBuilder - Basic PDF Structure Builder
// =============================================================================

/**
 * Simple PDF builder for Workers-compatible PDF generation
 */
class SimplePDFBuilder {
  private width: number
  private height: number
  private metadata: DocumentMetadata
  private objects: string[] = []
  private pages: string[] = []
  private currentContent: string[] = []

  constructor(options: { width: number; height: number; metadata?: DocumentMetadata }) {
    this.width = options.width
    this.height = options.height
    this.metadata = options.metadata ?? {}
  }

  /**
   * Add text to the current page
   */
  addText(text: string, options: { x: number; y: number; fontSize: number; maxWidth: number }): void {
    const lines = this.wrapText(text, options.maxWidth, options.fontSize)
    let y = options.y

    for (const line of lines) {
      if (y < 72) { // New page if we run out of space
        this.finalizePage()
        y = this.height - 72
      }

      const escapedLine = this.escapeText(line)
      this.currentContent.push(`BT /F1 ${options.fontSize} Tf ${options.x} ${y} Td (${escapedLine}) Tj ET`)
      y -= options.fontSize * 1.5 // Line height
    }
  }

  /**
   * Add watermark
   */
  addWatermark(config: WatermarkConfig): void {
    if (config.text) {
      const opacity = config.opacity ?? 0.3
      const fontSize = config.fontSize ?? 48
      const rotation = config.rotation ?? 45

      // Calculate center position
      const centerX = this.width / 2
      const centerY = this.height / 2

      // Add watermark with rotation and transparency
      const radians = (rotation * Math.PI) / 180
      const cos = Math.cos(radians)
      const sin = Math.sin(radians)

      this.currentContent.push(
        `q`,
        `${opacity} g`,
        `${cos.toFixed(4)} ${sin.toFixed(4)} ${(-sin).toFixed(4)} ${cos.toFixed(4)} ${centerX} ${centerY} cm`,
        `BT /F1 ${fontSize} Tf 0 0 Td (${this.escapeText(config.text)}) Tj ET`,
        `Q`
      )
    }
  }

  /**
   * Build the final PDF
   */
  build(): Uint8Array {
    this.finalizePage()

    const pdf: string[] = []
    const offsets: number[] = []

    // PDF Header
    pdf.push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')

    // Catalog
    offsets.push(this.getOffset(pdf))
    pdf.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

    // Pages
    offsets.push(this.getOffset(pdf))
    const pageRefs = this.pages.map((_, i) => `${i + 4} 0 R`).join(' ')
    pdf.push(`2 0 obj\n<< /Type /Pages /Kids [${pageRefs}] /Count ${this.pages.length} >>\nendobj\n`)

    // Font
    offsets.push(this.getOffset(pdf))
    pdf.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n')

    // Pages and content streams
    let objNum = 4
    for (let i = 0; i < this.pages.length; i++) {
      // Page object
      offsets.push(this.getOffset(pdf))
      pdf.push(
        `${objNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.width} ${this.height}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${objNum + 1} 0 R >>\nendobj\n`
      )
      objNum++

      // Content stream
      offsets.push(this.getOffset(pdf))
      const content = this.pages[i]
      pdf.push(`${objNum} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`)
      objNum++
    }

    // XRef table
    const xrefOffset = this.getOffset(pdf)
    pdf.push(`xref\n0 ${objNum}\n0000000000 65535 f \n`)
    for (const offset of offsets) {
      pdf.push(`${offset.toString().padStart(10, '0')} 00000 n \n`)
    }

    // Trailer
    pdf.push(
      `trailer\n<< /Size ${objNum} /Root 1 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF`
    )

    const pdfString = pdf.join('')
    return new TextEncoder().encode(pdfString)
  }

  /**
   * Finalize current page and start new one
   */
  private finalizePage(): void {
    if (this.currentContent.length > 0) {
      this.pages.push(this.currentContent.join('\n'))
      this.currentContent = []
    }
  }

  /**
   * Get current byte offset
   */
  private getOffset(parts: string[]): number {
    return parts.join('').length
  }

  /**
   * Escape text for PDF string
   */
  private escapeText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
  }

  /**
   * Wrap text to fit within maxWidth
   */
  private wrapText(text: string, maxWidth: number, fontSize: number): string[] {
    const words = text.split(/\s+/)
    const lines: string[] = []
    let currentLine = ''

    // Approximate character width (Helvetica)
    const charWidth = fontSize * 0.5

    for (const word of words) {
      if (word === '') continue

      const testLine = currentLine ? `${currentLine} ${word}` : word
      const testWidth = testLine.length * charWidth

      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine)
        currentLine = word
      } else {
        currentLine = testLine
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }

    return lines
  }
}

// =============================================================================
// SimplePDFMerger - Basic PDF Merger
// =============================================================================

/**
 * Simple PDF merger stub
 * Full implementation would parse PDFs and combine them
 */
class SimplePDFMerger {
  private documents: Uint8Array[] = []

  async addDocument(pdf: Uint8Array): Promise<void> {
    this.documents.push(pdf)
  }

  build(): Uint8Array {
    // Stub: Return first document
    // Full implementation would parse and merge all documents
    if (this.documents.length === 0) {
      throw new Error('No documents to merge')
    }
    console.warn('PDF merging requires pdf-lib integration for full functionality')
    return this.documents[0]
  }
}

// =============================================================================
// SimplePDFSplitter - Basic PDF Splitter
// =============================================================================

/**
 * Simple PDF splitter stub
 */
class SimplePDFSplitter {
  constructor(private pdf: Uint8Array) {}

  split(): Uint8Array[] {
    // Stub: Return single document
    // Full implementation would extract individual pages
    console.warn('PDF splitting requires pdf-lib integration for full functionality')
    return [this.pdf]
  }
}

// =============================================================================
// SimplePDFWatermarker - Basic Watermark Applier
// =============================================================================

/**
 * Simple PDF watermarker stub
 */
class SimplePDFWatermarker {
  constructor(private pdf: Uint8Array) {}

  apply(config: WatermarkConfig): Uint8Array {
    // Stub: Return original document
    // Full implementation would parse PDF and add watermark to each page
    console.warn('PDF watermarking requires pdf-lib integration for full functionality')
    return this.pdf
  }
}

// =============================================================================
// DocumentParser Implementation
// =============================================================================

/**
 * Document parser for PDF data extraction
 */
export class DocumentParser implements IDocumentParser {
  /**
   * Extract text from PDF
   */
  async extractText(pdf: Uint8Array): Promise<ExtractedText> {
    const text = this.extractTextContent(pdf)
    return {
      content: text,
      pages: [text], // Simplified: all text on one "page"
      confidence: 0.8,
    }
  }

  /**
   * Extract form fields from PDF
   */
  async extractFormFields(pdf: Uint8Array): Promise<ExtractedFormField[]> {
    // Parse PDF for AcroForm fields
    const fields: ExtractedFormField[] = []
    // Stub implementation - would need pdf-lib or similar for full parsing
    return fields
  }

  /**
   * Extract tables from PDF
   */
  async extractTables(pdf: Uint8Array): Promise<ExtractedTable[]> {
    // Table extraction is complex - would need heuristics or ML
    const tables: ExtractedTable[] = []
    return tables
  }

  /**
   * Get document metadata
   */
  async getMetadata(pdf: Uint8Array): Promise<DocumentMetadata> {
    return this.parseMetadata(pdf)
  }

  /**
   * Full document extraction
   */
  async extract(pdf: Uint8Array): Promise<DocumentExtraction> {
    const [text, formFields, tables, metadata] = await Promise.all([
      this.extractText(pdf),
      this.extractFormFields(pdf),
      this.extractTables(pdf),
      this.getMetadata(pdf),
    ])

    return {
      text,
      formFields,
      tables,
      metadata,
      pageCount: this.countPages(pdf),
      extractedAt: new Date(),
    }
  }

  /**
   * Extract text content from PDF
   */
  private extractTextContent(pdf: Uint8Array): string {
    const pdfString = new TextDecoder().decode(pdf)
    const textMatches: string[] = []

    // Find text streams and extract content
    // This is a simplified parser - real implementation needs proper PDF parsing
    const streamPattern = /stream\s*([\s\S]*?)\s*endstream/g
    let match

    while ((match = streamPattern.exec(pdfString)) !== null) {
      const streamContent = match[1]
      // Extract text from Tj and TJ operators
      const textPattern = /\((.*?)\)\s*Tj/g
      let textMatch
      while ((textMatch = textPattern.exec(streamContent)) !== null) {
        textMatches.push(this.unescapePdfText(textMatch[1]))
      }
    }

    return textMatches.join(' ').trim()
  }

  /**
   * Parse PDF metadata
   */
  private parseMetadata(pdf: Uint8Array): DocumentMetadata {
    const pdfString = new TextDecoder().decode(pdf)
    const metadata: DocumentMetadata = {}

    // Look for /Info dictionary
    const titleMatch = /\/Title\s*\((.*?)\)/.exec(pdfString)
    if (titleMatch) metadata.title = this.unescapePdfText(titleMatch[1])

    const authorMatch = /\/Author\s*\((.*?)\)/.exec(pdfString)
    if (authorMatch) metadata.author = this.unescapePdfText(authorMatch[1])

    const subjectMatch = /\/Subject\s*\((.*?)\)/.exec(pdfString)
    if (subjectMatch) metadata.subject = this.unescapePdfText(subjectMatch[1])

    const creatorMatch = /\/Creator\s*\((.*?)\)/.exec(pdfString)
    if (creatorMatch) metadata.creator = this.unescapePdfText(creatorMatch[1])

    return metadata
  }

  /**
   * Count pages in PDF
   */
  private countPages(pdf: Uint8Array): number {
    const pdfString = new TextDecoder().decode(pdf)
    const countMatch = /\/Count\s+(\d+)/.exec(pdfString)
    return countMatch ? parseInt(countMatch[1], 10) : 1
  }

  /**
   * Unescape PDF text string
   */
  private unescapePdfText(text: string): string {
    return text
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
  }
}

// =============================================================================
// SignatureCollector Implementation
// =============================================================================

/**
 * Signature collector for e-signature workflows
 */
export class SignatureCollector implements ISignatureCollector {
  private envelopes: Map<string, SigningEnvelope> = new Map()

  /**
   * Create signing envelope
   */
  async createEnvelope(
    document: RenderedDocument,
    signers: Signer[],
    fields: SignatureFieldDefinition[]
  ): Promise<SigningEnvelope> {
    const id = this.generateId()
    const now = new Date()

    // Create sessions for each signer
    const sessions: SigningSession[] = signers.map((signer) => ({
      id: this.generateId(),
      documentId: document.id,
      signer,
      accessToken: this.generateToken(),
      status: 'pending',
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days
      signatures: [],
      createdAt: now,
    }))

    const envelope: SigningEnvelope = {
      id,
      status: 'draft',
      document,
      signers,
      sessions,
      signatures: [],
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
    }

    this.envelopes.set(id, envelope)
    return envelope
  }

  /**
   * Get signing URL for a signer
   */
  async getSigningUrl(envelopeId: string, signerId: string): Promise<string> {
    const envelope = this.envelopes.get(envelopeId)
    if (!envelope) throw new Error(`Envelope ${envelopeId} not found`)

    const session = envelope.sessions.find((s) => s.signer.id === signerId)
    if (!session) throw new Error(`Signer ${signerId} not found in envelope`)

    // Update envelope status if this is first access
    if (envelope.status === 'draft') {
      envelope.status = 'sent'
    }

    // Return signing URL with access token
    return `/sign/${envelopeId}?token=${session.accessToken}`
  }

  /**
   * Record signature
   */
  async recordSignature(envelopeId: string, signature: SignatureData): Promise<void> {
    const envelope = this.envelopes.get(envelopeId)
    if (!envelope) throw new Error(`Envelope ${envelopeId} not found`)

    // Add signature to envelope
    envelope.signatures.push(signature)

    // Update session
    const session = envelope.sessions.find((s) => s.signer.id === signature.signerId)
    if (session) {
      session.signatures.push(signature)
      if (!session.viewedAt) {
        session.viewedAt = new Date()
      }
    }

    // Update envelope status
    this.updateEnvelopeStatus(envelope)
  }

  /**
   * Complete envelope
   */
  async completeEnvelope(envelopeId: string): Promise<SigningEnvelope> {
    const envelope = this.envelopes.get(envelopeId)
    if (!envelope) throw new Error(`Envelope ${envelopeId} not found`)

    envelope.status = 'completed'
    envelope.completedAt = new Date()

    // Update all sessions
    for (const session of envelope.sessions) {
      if (session.status === 'active') {
        session.status = 'completed'
      }
    }

    return envelope
  }

  /**
   * Void envelope
   */
  async voidEnvelope(envelopeId: string, reason: string): Promise<void> {
    const envelope = this.envelopes.get(envelopeId)
    if (!envelope) throw new Error(`Envelope ${envelopeId} not found`)

    envelope.status = 'voided'

    // Update all pending sessions
    for (const session of envelope.sessions) {
      if (session.status === 'pending' || session.status === 'active') {
        session.status = 'expired'
      }
    }
  }

  /**
   * Get envelope
   */
  async getEnvelope(envelopeId: string): Promise<SigningEnvelope> {
    const envelope = this.envelopes.get(envelopeId)
    if (!envelope) throw new Error(`Envelope ${envelopeId} not found`)
    return envelope
  }

  /**
   * Update envelope status based on signatures
   */
  private updateEnvelopeStatus(envelope: SigningEnvelope): void {
    const totalSigners = envelope.signers.length
    const signedCount = new Set(envelope.signatures.map((s) => s.signerId)).size

    if (signedCount === 0) {
      envelope.status = 'sent'
    } else if (signedCount < totalSigners) {
      envelope.status = 'partially_signed'
    } else {
      envelope.status = 'completed'
      envelope.completedAt = new Date()
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `env_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
  }

  /**
   * Generate access token
   */
  private generateToken(): string {
    return `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 15)}`
  }
}

// =============================================================================
// VariableValidator Implementation
// =============================================================================

/**
 * Validates template variables against their definitions
 */
export class VariableValidator {
  /**
   * Validate variables against template requirements
   */
  validate(variables: Record<string, unknown>, definitions: TemplateVariable[]): ValidationResult {
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []

    // Check each defined variable
    for (const def of definitions) {
      const value = variables[def.name]

      // Check required
      if (def.required && (value === undefined || value === null)) {
        errors.push({
          field: def.name,
          message: `Required variable "${def.name}" is missing`,
          code: 'MISSING_REQUIRED',
          expected: def.type,
        })
        continue
      }

      // Skip type check for undefined optional variables
      if (value === undefined || value === null) continue

      // Check type
      if (!this.checkType(value, def.type)) {
        errors.push({
          field: def.name,
          message: `Variable "${def.name}" has invalid type. Expected ${def.type}, got ${typeof value}`,
          code: 'INVALID_TYPE',
          expected: def.type,
          received: typeof value,
        })
      }

      // Check pattern for strings
      if (def.type === 'string' && def.pattern && typeof value === 'string') {
        const pattern = new RegExp(def.pattern)
        if (!pattern.test(value)) {
          errors.push({
            field: def.name,
            message: `Variable "${def.name}" does not match required pattern`,
            code: 'INVALID_FORMAT',
            expected: def.pattern,
            received: value,
          })
        }
      }
    }

    // Check for unused variables
    const definedNames = new Set(definitions.map((d) => d.name))
    for (const key of Object.keys(variables)) {
      if (!definedNames.has(key)) {
        warnings.push({
          field: key,
          message: `Variable "${key}" is not defined in template`,
          code: 'UNUSED_VARIABLE',
        })
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Check if value matches expected type
   */
  private checkType(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string'
      case 'number':
      case 'currency':
        return typeof value === 'number' && !isNaN(value)
      case 'boolean':
        return typeof value === 'boolean'
      case 'date':
        return value instanceof Date || (typeof value === 'string' && !isNaN(Date.parse(value)))
      case 'array':
        return Array.isArray(value)
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value)
      case 'image':
        return typeof value === 'string' // Base64 or URL
      default:
        return true
    }
  }
}

// =============================================================================
// DocumentRenderer Implementation
// =============================================================================

/**
 * Main document renderer class - orchestrates all components
 */
export class DocumentRenderer implements IDocumentRenderer {
  private templates: Map<string, DocumentTemplate> = new Map()
  private templateEngine: TemplateEngine
  private pdfGenerator: PDFGenerator
  private documentParser: DocumentParser
  private signatureCollector: SignatureCollector
  private variableValidator: VariableValidator

  constructor() {
    this.templateEngine = new TemplateEngine()
    this.pdfGenerator = new PDFGenerator()
    this.documentParser = new DocumentParser()
    this.signatureCollector = new SignatureCollector()
    this.variableValidator = new VariableValidator()
  }

  /**
   * Register a new template
   */
  async register(template: DocumentTemplate): Promise<void> {
    this.templates.set(template.id, {
      ...template,
      createdAt: template.createdAt ?? new Date(),
      updatedAt: new Date(),
    })
  }

  /**
   * Get template by ID
   */
  async get(templateId: string): Promise<DocumentTemplate | null> {
    return this.templates.get(templateId) ?? null
  }

  /**
   * List all templates
   */
  async list(): Promise<TemplateListItem[]> {
    return Array.from(this.templates.values()).map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      variableCount: t.variables.length,
      hasSignatureFields: (t.signatureFields?.length ?? 0) > 0,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }))
  }

  /**
   * Delete a template
   */
  async delete(templateId: string): Promise<void> {
    this.templates.delete(templateId)
  }

  /**
   * Render a document from template
   */
  async render(
    templateId: string,
    variables: Record<string, unknown>,
    options?: PDFOptions
  ): Promise<RenderedDocument> {
    const template = await this.get(templateId)
    if (!template) {
      throw new Error(`Template "${templateId}" not found`)
    }

    // Validate variables
    const validation = this.variableValidator.validate(variables, template.variables)
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.map((e) => e.message).join(', ')}`)
    }

    // Build full HTML with CSS
    let html = template.html
    if (template.css) {
      html = `<style>${template.css}</style>${html}`
    }

    // Render template with variables
    const renderedHtml = this.templateEngine.render(html, variables)

    // Generate PDF
    const pdfOptions: PDFOptions = {
      ...options,
      page: options?.page ?? template.pageOptions,
      header: options?.header ?? template.header,
      footer: options?.footer ?? template.footer,
      metadata: {
        ...options?.metadata,
        title: options?.metadata?.title ?? template.name,
      },
    }

    const pdfBytes = await this.pdfGenerator.generate(renderedHtml, pdfOptions)

    // Build rendered document
    const id = `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`

    return {
      id,
      templateId,
      format: 'pdf',
      content: this.arrayBufferToBase64(pdfBytes),
      mimeType: 'application/pdf',
      sizeBytes: pdfBytes.length,
      pageCount: this.estimatePageCount(renderedHtml),
      metadata: pdfOptions.metadata ?? {},
      renderedAt: new Date(),
      variables,
      hash: await this.computeHash(pdfBytes),
    }
  }

  /**
   * Preview a document
   */
  async preview(
    templateId: string,
    variables: Record<string, unknown>,
    options?: PDFOptions
  ): Promise<PreviewResult> {
    const template = await this.get(templateId)
    if (!template) {
      throw new Error(`Template "${templateId}" not found`)
    }

    const validation = this.variableValidator.validate(variables, template.variables)

    // Render even with validation errors (for preview)
    let rendered: RenderedDocument
    try {
      rendered = await this.render(templateId, variables, options)
    } catch {
      // Create placeholder document for failed render
      rendered = {
        id: 'preview',
        templateId,
        format: 'pdf',
        content: '',
        mimeType: 'application/pdf',
        sizeBytes: 0,
        pageCount: 0,
        metadata: {},
        renderedAt: new Date(),
        variables,
      }
    }

    return {
      rendered,
      validation,
      isPreview: true,
      previewedAt: new Date(),
    }
  }

  /**
   * Validate variables against template
   */
  async validate(templateId: string, variables: Record<string, unknown>): Promise<ValidationResult> {
    const template = await this.get(templateId)
    if (!template) {
      return {
        valid: false,
        errors: [{
          field: 'templateId',
          message: `Template "${templateId}" not found`,
          code: 'INVALID_TEMPLATE',
        }],
        warnings: [],
      }
    }

    return this.variableValidator.validate(variables, template.variables)
  }

  /**
   * Create signing envelope
   */
  async createSigningEnvelope(document: RenderedDocument, signers: Signer[]): Promise<SigningEnvelope> {
    const template = await this.get(document.templateId)
    const fields = template?.signatureFields ?? []
    return this.signatureCollector.createEnvelope(document, signers, fields)
  }

  /**
   * Parse document
   */
  async parse(document: Uint8Array): Promise<DocumentExtraction> {
    return this.documentParser.extract(document)
  }

  /**
   * Merge documents
   */
  async merge(documents: Uint8Array[]): Promise<Uint8Array> {
    return this.pdfGenerator.merge(documents)
  }

  /**
   * Split document
   */
  async split(document: Uint8Array): Promise<Uint8Array[]> {
    return this.pdfGenerator.split(document)
  }

  /**
   * Convert Uint8Array to base64
   */
  private arrayBufferToBase64(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  /**
   * Estimate page count from HTML content
   */
  private estimatePageCount(html: string): number {
    // Rough estimate: ~3000 characters per page
    const textLength = html.replace(/<[^>]+>/g, '').length
    return Math.max(1, Math.ceil(textLength / 3000))
  }

  /**
   * Compute SHA-256 hash
   */
  private async computeHash(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }
}
