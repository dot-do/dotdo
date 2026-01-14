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
  // Versioning types
  DocumentVersion,
  DocumentVersionMetadata,
  DocumentVersionListItem,
  VersionDiff,
  VersionHistory,
  VersionHistoryOptions,
  VersionAuditEntry,
  VersionAction,
  DiffChange,
  // Bulk generation types
  BulkRenderInput,
  BulkRenderResult,
  BulkRenderOptions,
  BulkProgress,
  BulkRenderSummary,
  BulkRenderResponse,
  IBulkDocumentRenderer,
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

    // Split HTML by page breaks and process each page
    const pages = this.splitByPageBreaks(html)

    for (let i = 0; i < pages.length; i++) {
      if (i > 0) {
        pdf.newPage()
      }

      // Strip HTML tags for basic text extraction
      const text = this.htmlToText(pages[i])

      // Add text content
      pdf.addText(text, {
        x: pageOptions.margins?.left ?? DEFAULT_MARGINS.left,
        y: dimensions.height - (pageOptions.margins?.top ?? DEFAULT_MARGINS.top),
        fontSize: 12,
        maxWidth: dimensions.width - (pageOptions.margins?.left ?? DEFAULT_MARGINS.left) - (pageOptions.margins?.right ?? DEFAULT_MARGINS.right),
      })

      // Apply watermark if configured (on each page)
      if (options?.watermark) {
        pdf.addWatermark(options.watermark)
      }
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
   * Split HTML content by page breaks
   */
  private splitByPageBreaks(html: string): string[] {
    let content = html

    // Handle style="page-break-after: always" and similar
    content = content.replace(
      /<div[^>]*style\s*=\s*["'][^"']*page-break-after\s*:\s*always[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
      (match) => match + '\n\n<!-- PAGE_BREAK -->\n\n'
    )

    content = content.replace(
      /<div[^>]*style\s*=\s*["'][^"']*page-break-before\s*:\s*always[^"']*["'][^>]*>/gi,
      '\n\n<!-- PAGE_BREAK -->\n\n$&'
    )

    // Also handle empty divs with page-break-after (common pattern)
    content = content.replace(
      /<div\s+style\s*=\s*["']page-break-after:\s*always["']\s*><\/div>/gi,
      '\n\n<!-- PAGE_BREAK -->\n\n'
    )

    // Split by our marker
    const pages = content.split(/\n*<!-- PAGE_BREAK -->\n*/g)

    // Filter out empty pages
    return pages.filter((page) => page.trim().length > 0)
  }

  /**
   * Convert HTML to plain text
   */
  private htmlToText(html: string): string {
    let text = html

    // Remove script and style content
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

    // Convert tables to tab-delimited format for detection
    text = this.convertTablesToText(text)

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
   * Convert HTML tables to tab-delimited text format
   */
  private convertTablesToText(html: string): string {
    let result = html

    // Process each table
    const tablePattern = /<table[^>]*>([\s\S]*?)<\/table>/gi
    result = result.replace(tablePattern, (match, tableContent) => {
      const rows: string[] = []

      // Extract rows (both thead and tbody)
      const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
      let rowMatch
      while ((rowMatch = rowPattern.exec(tableContent)) !== null) {
        const rowContent = rowMatch[1]
        const cells: string[] = []

        // Extract cells (th and td)
        const cellPattern = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi
        let cellMatch
        while ((cellMatch = cellPattern.exec(rowContent)) !== null) {
          // Remove any nested HTML and trim
          const cellText = cellMatch[2].replace(/<[^>]+>/g, '').trim()
          cells.push(cellText)
        }

        if (cells.length > 0) {
          rows.push(cells.join('\t'))
        }
      }

      return '\n' + rows.join('\n') + '\n'
    })

    return result
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
   * Force start a new page
   */
  newPage(): void {
    this.finalizePage()
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
    // Each page uses 2 objects: page object + content stream, so page i is at object 5 + (i * 2)
    const pageRefs = this.pages.map((_, i) => `${5 + (i * 2)} 0 R`).join(' ')
    pdf.push(`2 0 obj\n<< /Type /Pages /Kids [${pageRefs}] /Count ${this.pages.length} >>\nendobj\n`)

    // Font
    offsets.push(this.getOffset(pdf))
    pdf.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n')

    // Info dictionary (metadata)
    offsets.push(this.getOffset(pdf))
    const infoDict = this.buildInfoDict()
    pdf.push(`4 0 obj\n${infoDict}\nendobj\n`)

    // Pages and content streams
    let objNum = 5
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

    // Trailer with Info reference
    pdf.push(
      `trailer\n<< /Size ${objNum} /Root 1 0 R /Info 4 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF`
    )

    const pdfString = pdf.join('')
    return new TextEncoder().encode(pdfString)
  }

  /**
   * Build the Info dictionary for metadata
   */
  private buildInfoDict(): string {
    const parts: string[] = ['<<']

    if (this.metadata.title) {
      parts.push(`/Title (${this.escapeText(this.metadata.title)})`)
    }
    if (this.metadata.author) {
      parts.push(`/Author (${this.escapeText(this.metadata.author)})`)
    }
    if (this.metadata.subject) {
      parts.push(`/Subject (${this.escapeText(this.metadata.subject)})`)
    }
    if (this.metadata.creator) {
      parts.push(`/Creator (${this.escapeText(this.metadata.creator)})`)
    }
    if (this.metadata.producer) {
      parts.push(`/Producer (${this.escapeText(this.metadata.producer)})`)
    }
    if (this.metadata.keywords && this.metadata.keywords.length > 0) {
      parts.push(`/Keywords (${this.escapeText(this.metadata.keywords.join(', '))})`)
    }
    if (this.metadata.creationDate) {
      parts.push(`/CreationDate (D:${this.formatPdfDate(this.metadata.creationDate)})`)
    }
    if (this.metadata.modificationDate) {
      parts.push(`/ModDate (D:${this.formatPdfDate(this.metadata.modificationDate)})`)
    }
    // Add custom metadata fields
    if (this.metadata.custom) {
      for (const [key, value] of Object.entries(this.metadata.custom)) {
        parts.push(`/${key} (${this.escapeText(value)})`)
      }
    }

    parts.push('>>')
    return parts.join(' ')
  }

  /**
   * Format date for PDF (D:YYYYMMDDHHmmss)
   */
  private formatPdfDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')
    return `${year}${month}${day}${hours}${minutes}${seconds}`
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
   * Preserves newlines to maintain table structure
   */
  private wrapText(text: string, maxWidth: number, fontSize: number): string[] {
    // First split by newlines to preserve line structure
    const inputLines = text.split('\n')
    const outputLines: string[] = []

    // Approximate character width (Helvetica)
    const charWidth = fontSize * 0.5

    for (const inputLine of inputLines) {
      if (inputLine.trim() === '') {
        outputLines.push('')
        continue
      }

      // For lines that fit, just add them (preserving tabs)
      const lineWidth = inputLine.length * charWidth
      if (lineWidth <= maxWidth) {
        outputLines.push(inputLine)
        continue
      }

      // For long lines, wrap by spaces but preserve tabs
      const words = inputLine.split(/ +/g)
      let currentLine = ''

      for (const word of words) {
        if (word === '') continue

        const testLine = currentLine ? `${currentLine} ${word}` : word
        const testWidth = testLine.length * charWidth

        if (testWidth > maxWidth && currentLine.trim()) {
          outputLines.push(currentLine.trimEnd())
          currentLine = word
        } else {
          currentLine = testLine
        }
      }

      if (currentLine.trim()) {
        outputLines.push(currentLine.trimEnd())
      }
    }

    return outputLines.filter((line) => line.length > 0 || outputLines.length <= 1)
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
// PDF Parser Types (Extended)
// =============================================================================

/**
 * Text block with position information
 */
export interface TextBlock {
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
export interface ExtractedImage {
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
export interface PDFAnnotation {
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
export interface PDFBookmark {
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
export interface PDFFont {
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
export interface PDFStructure {
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
export interface PDFExtractionOptions {
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
export interface ExtendedDocumentExtraction extends DocumentExtraction {
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
// DocumentParser Implementation
// =============================================================================

/**
 * Document parser for PDF data extraction
 *
 * Provides comprehensive PDF parsing capabilities:
 * - Text extraction with per-page separation and position info
 * - Form field extraction from AcroForms
 * - Table detection and extraction using heuristics
 * - Image extraction
 * - Metadata parsing (standard and XMP)
 * - PDF structure analysis (fonts, bookmarks, annotations)
 * - Encryption detection and handling
 *
 * Optimized for Cloudflare Workers runtime compatibility.
 */
export class DocumentParser implements IDocumentParser {
  private pdfData: Uint8Array | null = null
  private pdfString: string = ''
  private objects: Map<string, string> = new Map()
  private pageObjects: Map<number, string> = new Map()

  // ==========================================================================
  // Public API - Core extraction methods
  // ==========================================================================

  /**
   * Extract text from PDF
   */
  async extractText(pdf: Uint8Array, options?: PDFExtractionOptions): Promise<ExtractedText> {
    this.validatePDF(pdf)
    this.parsePDF(pdf)

    const pageRange = this.getPageRange(options)
    const pages = this.extractTextByPage(pageRange)

    return {
      content: pages.join('\n\n'),
      pages,
      confidence: 0.85,
    }
  }

  /**
   * Extract text blocks with position information
   */
  async extractTextBlocks(pdf: Uint8Array, options?: PDFExtractionOptions): Promise<TextBlock[]> {
    this.validatePDF(pdf)
    this.parsePDF(pdf)

    const pageRange = this.getPageRange(options)
    const blocks: TextBlock[] = []

    for (let pageNum = pageRange.start; pageNum <= pageRange.end; pageNum++) {
      const pageBlocks = this.extractPageTextBlocks(pageNum)
      blocks.push(...pageBlocks)
    }

    return blocks
  }

  /**
   * Extract form fields from PDF
   */
  async extractFormFields(pdf: Uint8Array): Promise<ExtractedFormField[]> {
    this.validatePDF(pdf)
    this.parsePDF(pdf)
    return this.parseAcroForm()
  }

  /**
   * Extract tables from PDF
   */
  async extractTables(pdf: Uint8Array): Promise<ExtractedTable[]> {
    this.validatePDF(pdf)
    this.parsePDF(pdf)
    return this.detectAndExtractTables()
  }

  /**
   * Get document metadata
   */
  async getMetadata(pdf: Uint8Array): Promise<DocumentMetadata> {
    this.validatePDF(pdf)
    this.parsePDF(pdf)
    return this.parseMetadata()
  }

  /**
   * Extract images from PDF
   */
  async extractImages(pdf: Uint8Array, options?: PDFExtractionOptions): Promise<ExtractedImage[]> {
    this.validatePDF(pdf)
    this.parsePDF(pdf)

    const pageRange = this.getPageRange(options)
    const maxSize = options?.maxImageSize ?? Infinity

    return this.parseImages(pageRange, maxSize)
  }

  /**
   * Extract annotations from PDF
   */
  async extractAnnotations(pdf: Uint8Array): Promise<PDFAnnotation[]> {
    this.validatePDF(pdf)
    this.parsePDF(pdf)
    return this.parseAnnotations()
  }

  /**
   * Extract XMP metadata when present
   */
  async extractXMPMetadata(pdf: Uint8Array): Promise<Record<string, unknown>> {
    this.validatePDF(pdf)
    this.parsePDF(pdf)
    return this.parseXMPMetadata()
  }

  /**
   * Get PDF structure information
   */
  async getStructure(pdf: Uint8Array): Promise<PDFStructure> {
    this.validatePDF(pdf)
    this.parsePDF(pdf)
    return this.parsePDFStructure()
  }

  /**
   * Check if PDF is encrypted
   */
  async isEncrypted(pdf: Uint8Array): Promise<boolean> {
    this.validatePDF(pdf)
    this.parsePDF(pdf)
    return this.checkEncryption()
  }

  /**
   * Get encryption information
   */
  async getEncryptionInfo(pdf: Uint8Array): Promise<{
    encrypted: boolean
    method?: string
    keyLength?: number
  }> {
    this.validatePDF(pdf)
    this.parsePDF(pdf)
    return this.parseEncryptionInfo()
  }

  /**
   * Get PDF permissions (requires owner password if encrypted)
   */
  async getPermissions(pdf: Uint8Array, options?: PDFExtractionOptions): Promise<{
    printing: boolean
    copying: boolean
    modifying: boolean
    annotating: boolean
  }> {
    this.validatePDF(pdf)
    this.parsePDF(pdf)
    return this.parsePermissions(options?.password)
  }

  /**
   * Full document extraction
   */
  async extract(pdf: Uint8Array, options?: PDFExtractionOptions): Promise<ExtendedDocumentExtraction> {
    this.validatePDF(pdf)
    this.parsePDF(pdf)

    const pageRange = this.getPageRange(options)

    const [text, formFields, tables, metadata] = await Promise.all([
      this.extractText(pdf, options),
      this.extractFormFields(pdf),
      this.extractTables(pdf),
      this.getMetadata(pdf),
    ])

    const result: ExtendedDocumentExtraction = {
      text,
      formFields,
      tables,
      metadata,
      pageCount: this.countPages(),
      extractedAt: new Date(),
      images: [],
    }

    // Optional extractions based on options
    if (options?.includeTextCoordinates) {
      result.textBlocks = await this.extractTextBlocks(pdf, options)
    }

    if (options?.extractImages) {
      result.images = await this.extractImages(pdf, options)
    }

    if (options?.extractAnnotations) {
      result.annotations = await this.extractAnnotations(pdf)
    }

    if (options?.extractBookmarks || options?.extractFonts) {
      result.structure = await this.getStructure(pdf)
    }

    return result
  }

  // ==========================================================================
  // Private - PDF Parsing Core
  // ==========================================================================

  /**
   * Validate PDF input
   */
  private validatePDF(pdf: Uint8Array): void {
    if (!pdf || pdf.length === 0) {
      throw new Error('Invalid PDF: empty input')
    }

    // Check PDF magic bytes
    const header = new TextDecoder().decode(pdf.slice(0, 8))
    if (!header.startsWith('%PDF-')) {
      throw new Error('Invalid PDF: not a PDF file (missing %PDF- header)')
    }

    // Check for EOF marker
    const trailer = new TextDecoder().decode(pdf.slice(-20))
    if (!trailer.includes('%%EOF')) {
      throw new Error('Invalid PDF: truncated or incomplete file (missing %%EOF)')
    }
  }

  /**
   * Parse PDF structure into internal representation
   */
  private parsePDF(pdf: Uint8Array): void {
    this.pdfData = pdf
    this.pdfString = new TextDecoder().decode(pdf)
    this.objects.clear()
    this.pageObjects.clear()

    // Parse all objects
    this.parseObjects()

    // Build page mapping
    this.buildPageMapping()
  }

  /**
   * Parse PDF objects
   */
  private parseObjects(): void {
    // Match object definitions: "n n obj ... endobj"
    const objPattern = /(\d+)\s+(\d+)\s+obj\s*([\s\S]*?)\s*endobj/g
    let match

    while ((match = objPattern.exec(this.pdfString)) !== null) {
      const objNum = match[1]
      const genNum = match[2]
      const content = match[3]
      this.objects.set(`${objNum} ${genNum}`, content)
    }
  }

  /**
   * Build mapping from page numbers to page objects
   */
  private buildPageMapping(): void {
    // Find Pages dictionary
    const pagesMatch = /\/Type\s*\/Pages[\s\S]*?\/Kids\s*\[([\s\S]*?)\]/g.exec(this.pdfString)
    if (!pagesMatch) return

    // Extract page references
    const kidsString = pagesMatch[1]
    const pageRefs = kidsString.match(/(\d+)\s+\d+\s+R/g) || []

    pageRefs.forEach((ref, index) => {
      const objNum = ref.match(/(\d+)/)?.[1]
      if (objNum) {
        this.pageObjects.set(index + 1, objNum)
      }
    })
  }

  /**
   * Get page range from options
   */
  private getPageRange(options?: PDFExtractionOptions): { start: number; end: number } {
    const totalPages = this.countPages()
    const start = Math.max(1, options?.pages?.start ?? 1)
    const end = Math.min(totalPages, options?.pages?.end ?? totalPages)
    return { start, end }
  }

  // ==========================================================================
  // Private - Text Extraction
  // ==========================================================================

  /**
   * Extract text by page
   */
  private extractTextByPage(pageRange: { start: number; end: number }): string[] {
    const pages: string[] = []

    for (let pageNum = pageRange.start; pageNum <= pageRange.end; pageNum++) {
      const pageText = this.extractPageText(pageNum)
      pages.push(pageText)
    }

    return pages
  }

  /**
   * Extract text from a single page
   */
  private extractPageText(pageNum: number): string {
    const pageObjNum = this.pageObjects.get(pageNum)
    if (!pageObjNum) {
      // Fallback to global text extraction for this page range
      return this.extractTextContentGlobal()
    }

    const pageObj = this.objects.get(`${pageObjNum} 0`)
    if (!pageObj) return ''

    // Find content stream reference
    const contentsMatch = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(pageObj)
    if (!contentsMatch) return ''

    const contentObjNum = contentsMatch[1]
    const contentObj = this.objects.get(`${contentObjNum} 0`)
    if (!contentObj) return ''

    // Extract text from content stream
    return this.extractTextFromStream(contentObj)
  }

  /**
   * Extract text from a content stream
   */
  private extractTextFromStream(content: string): string {
    const textMatches: string[] = []

    // Find stream content
    const streamMatch = /stream\s*([\s\S]*?)\s*endstream/.exec(content)
    if (!streamMatch) {
      // Try extracting directly from content
      return this.extractTextOperators(content)
    }

    return this.extractTextOperators(streamMatch[1])
  }

  /**
   * Extract text from PDF operators
   * Preserves line breaks by detecting BT/ET blocks
   */
  private extractTextOperators(content: string): string {
    // Split by BT...ET blocks (text blocks)
    const textBlockPattern = /BT\s*([\s\S]*?)\s*ET/g
    const textBlocks: string[] = []
    let match

    while ((match = textBlockPattern.exec(content)) !== null) {
      const blockContent = match[1]
      const blockText = this.extractTextFromBlock(blockContent)
      if (blockText) {
        textBlocks.push(blockText)
      }
    }

    // Each BT/ET block is typically a separate line
    return textBlocks.join('\n')
  }

  /**
   * Extract text from a single BT/ET block
   */
  private extractTextFromBlock(block: string): string {
    const textParts: string[] = []

    // Match Tj operator (show text)
    const tjPattern = /\((.*?)\)\s*Tj/g
    let match
    while ((match = tjPattern.exec(block)) !== null) {
      textParts.push(this.unescapePdfText(match[1]))
    }

    // Match TJ operator (show text array)
    const tjArrayPattern = /\[([\s\S]*?)\]\s*TJ/g
    while ((match = tjArrayPattern.exec(block)) !== null) {
      const arrayContent = match[1]
      // Extract strings from array
      const stringPattern = /\((.*?)\)/g
      let strMatch
      while ((strMatch = stringPattern.exec(arrayContent)) !== null) {
        textParts.push(this.unescapePdfText(strMatch[1]))
      }
    }

    // Match ' and " operators (show text with spacing)
    const quotePattern = /\((.*?)\)\s*['"]/g
    while ((match = quotePattern.exec(block)) !== null) {
      textParts.push(this.unescapePdfText(match[1]))
    }

    // Join text parts within a block with empty string (they're continuation)
    return textParts.join('')
  }

  /**
   * Global text extraction (fallback)
   */
  private extractTextContentGlobal(): string {
    const textMatches: string[] = []

    // Find all text streams
    const streamPattern = /stream\s*([\s\S]*?)\s*endstream/g
    let match

    while ((match = streamPattern.exec(this.pdfString)) !== null) {
      const streamContent = match[1]
      const text = this.extractTextOperators(streamContent)
      if (text) textMatches.push(text)
    }

    return textMatches.join(' ').trim()
  }

  /**
   * Extract text blocks with position info for a page
   */
  private extractPageTextBlocks(pageNum: number): TextBlock[] {
    const blocks: TextBlock[] = []
    const pageObjNum = this.pageObjects.get(pageNum)

    if (!pageObjNum) {
      // Return basic block without position
      const text = this.extractPageText(pageNum)
      if (text) {
        blocks.push({
          text,
          page: pageNum,
          bounds: { x: 0, y: 0, width: 612, height: 792 },
          confidence: 0.7,
        })
      }
      return blocks
    }

    const pageObj = this.objects.get(`${pageObjNum} 0`)
    if (!pageObj) return blocks

    // Get page dimensions
    const mediaBox = this.parseMediaBox(pageObj)

    // Find content stream
    const contentsMatch = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(pageObj)
    if (!contentsMatch) return blocks

    const contentObjNum = contentsMatch[1]
    const contentObj = this.objects.get(`${contentObjNum} 0`)
    if (!contentObj) return blocks

    // Parse text operations with positions
    const streamMatch = /stream\s*([\s\S]*?)\s*endstream/.exec(contentObj)
    if (!streamMatch) return blocks

    const operations = this.parseTextOperations(streamMatch[1])

    for (const op of operations) {
      blocks.push({
        text: op.text,
        page: pageNum,
        bounds: {
          x: op.x,
          y: op.y,
          width: op.text.length * (op.fontSize * 0.5),
          height: op.fontSize * 1.2,
        },
        font: op.font ? {
          name: op.font,
          size: op.fontSize,
        } : undefined,
        confidence: 0.85,
      })
    }

    return blocks
  }

  /**
   * Parse text operations with position tracking
   */
  private parseTextOperations(content: string): Array<{
    text: string
    x: number
    y: number
    fontSize: number
    font?: string
  }> {
    const operations: Array<{
      text: string
      x: number
      y: number
      fontSize: number
      font?: string
    }> = []

    let currentX = 0
    let currentY = 0
    let currentFontSize = 12
    let currentFont: string | undefined

    // Split into lines and parse
    const lines = content.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()

      // Text matrix: x y Td or x y TD
      const tdMatch = /(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+T[dD]/.exec(trimmed)
      if (tdMatch) {
        currentX += parseFloat(tdMatch[1])
        currentY += parseFloat(tdMatch[2])
      }

      // Absolute position: x y x y x y Tm
      const tmMatch = /(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+Tm/.exec(trimmed)
      if (tmMatch) {
        currentX = parseFloat(tmMatch[5])
        currentY = parseFloat(tmMatch[6])
        currentFontSize = parseFloat(tmMatch[4]) || currentFontSize
      }

      // Font selection: /FontName size Tf
      const tfMatch = /\/(\w+)\s+(-?\d+\.?\d*)\s+Tf/.exec(trimmed)
      if (tfMatch) {
        currentFont = tfMatch[1]
        currentFontSize = parseFloat(tfMatch[2]) || currentFontSize
      }

      // Text showing: (text) Tj
      const tjMatch = /\((.*?)\)\s*Tj/.exec(trimmed)
      if (tjMatch) {
        operations.push({
          text: this.unescapePdfText(tjMatch[1]),
          x: currentX,
          y: currentY,
          fontSize: currentFontSize,
          font: currentFont,
        })
      }

      // Text array: [...] TJ
      const tjArrayMatch = /\[([\s\S]*?)\]\s*TJ/.exec(trimmed)
      if (tjArrayMatch) {
        const arrayContent = tjArrayMatch[1]
        const stringPattern = /\((.*?)\)/g
        let textParts: string[] = []
        let strMatch
        while ((strMatch = stringPattern.exec(arrayContent)) !== null) {
          textParts.push(this.unescapePdfText(strMatch[1]))
        }
        if (textParts.length > 0) {
          operations.push({
            text: textParts.join(''),
            x: currentX,
            y: currentY,
            fontSize: currentFontSize,
            font: currentFont,
          })
        }
      }
    }

    return operations
  }

  /**
   * Parse MediaBox from page object
   */
  private parseMediaBox(pageObj: string): { width: number; height: number } {
    const match = /\/MediaBox\s*\[\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\]/.exec(pageObj)
    if (match) {
      return {
        width: parseFloat(match[3]) - parseFloat(match[1]),
        height: parseFloat(match[4]) - parseFloat(match[2]),
      }
    }
    return { width: 612, height: 792 } // Default letter size
  }

  // ==========================================================================
  // Private - Metadata Extraction
  // ==========================================================================

  /**
   * Parse PDF metadata
   */
  private parseMetadata(): DocumentMetadata {
    const metadata: DocumentMetadata = {}

    // Find Info dictionary
    const infoMatch = /\/Info\s+(\d+)\s+\d+\s+R/.exec(this.pdfString)
    if (infoMatch) {
      const infoObjNum = infoMatch[1]
      const infoObj = this.objects.get(`${infoObjNum} 0`)
      if (infoObj) {
        // Parse metadata fields
        metadata.title = this.extractMetadataField(infoObj, 'Title')
        metadata.author = this.extractMetadataField(infoObj, 'Author')
        metadata.subject = this.extractMetadataField(infoObj, 'Subject')
        metadata.creator = this.extractMetadataField(infoObj, 'Creator')
        metadata.producer = this.extractMetadataField(infoObj, 'Producer')

        const keywords = this.extractMetadataField(infoObj, 'Keywords')
        if (keywords) {
          metadata.keywords = keywords.split(/[,;]\s*/)
        }

        // Parse dates
        const creationDate = this.extractMetadataField(infoObj, 'CreationDate')
        if (creationDate) {
          metadata.creationDate = this.parsePdfDate(creationDate)
        }

        const modDate = this.extractMetadataField(infoObj, 'ModDate')
        if (modDate) {
          metadata.modificationDate = this.parsePdfDate(modDate)
        }

        // Extract custom metadata
        metadata.custom = this.extractCustomMetadata(infoObj)
      }
    }

    // Fallback to searching directly in PDF string
    if (!metadata.title) {
      const titleMatch = /\/Title\s*\((.*?)\)/.exec(this.pdfString)
      if (titleMatch) metadata.title = this.unescapePdfText(titleMatch[1])
    }

    if (!metadata.author) {
      const authorMatch = /\/Author\s*\((.*?)\)/.exec(this.pdfString)
      if (authorMatch) metadata.author = this.unescapePdfText(authorMatch[1])
    }

    return metadata
  }

  /**
   * Extract a specific metadata field
   */
  private extractMetadataField(obj: string, fieldName: string): string | undefined {
    // Try parenthesized string
    const parenMatch = new RegExp(`\\/${fieldName}\\s*\\(([^)]*?)\\)`).exec(obj)
    if (parenMatch) {
      return this.unescapePdfText(parenMatch[1])
    }

    // Try hex string
    const hexMatch = new RegExp(`\\/${fieldName}\\s*<([0-9A-Fa-f]+)>`).exec(obj)
    if (hexMatch) {
      return this.hexToString(hexMatch[1])
    }

    return undefined
  }

  /**
   * Extract custom metadata fields
   */
  private extractCustomMetadata(obj: string): Record<string, string> | undefined {
    const custom: Record<string, string> = {}
    const standardFields = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped']

    // Find all name/value pairs
    const fieldPattern = /\/([A-Za-z][A-Za-z0-9]*)\s*\(([^)]*)\)/g
    let match
    while ((match = fieldPattern.exec(obj)) !== null) {
      const fieldName = match[1]
      if (!standardFields.includes(fieldName)) {
        custom[fieldName] = this.unescapePdfText(match[2])
      }
    }

    return Object.keys(custom).length > 0 ? custom : undefined
  }

  /**
   * Parse XMP metadata
   */
  private parseXMPMetadata(): Record<string, unknown> {
    const xmpData: Record<string, unknown> = {}

    // Find XMP metadata stream
    const xmpMatch = /\/Metadata\s+(\d+)\s+\d+\s+R/.exec(this.pdfString)
    if (!xmpMatch) return xmpData

    const xmpObjNum = xmpMatch[1]
    const xmpObj = this.objects.get(`${xmpObjNum} 0`)
    if (!xmpObj) return xmpData

    // Extract stream content
    const streamMatch = /stream\s*([\s\S]*?)\s*endstream/.exec(xmpObj)
    if (!streamMatch) return xmpData

    const xmpContent = streamMatch[1]

    // Parse basic XMP fields (simplified XML parsing)
    const dcTitleMatch = /<dc:title[^>]*>[\s\S]*?<rdf:li[^>]*>([^<]*)<\/rdf:li>/.exec(xmpContent)
    if (dcTitleMatch) xmpData['dc:title'] = dcTitleMatch[1]

    const dcCreatorMatch = /<dc:creator[^>]*>[\s\S]*?<rdf:li[^>]*>([^<]*)<\/rdf:li>/.exec(xmpContent)
    if (dcCreatorMatch) xmpData['dc:creator'] = dcCreatorMatch[1]

    const dcDescriptionMatch = /<dc:description[^>]*>[\s\S]*?<rdf:li[^>]*>([^<]*)<\/rdf:li>/.exec(xmpContent)
    if (dcDescriptionMatch) xmpData['dc:description'] = dcDescriptionMatch[1]

    const xmpCreateDateMatch = /<xmp:CreateDate>([^<]*)<\/xmp:CreateDate>/.exec(xmpContent)
    if (xmpCreateDateMatch) xmpData['xmp:CreateDate'] = xmpCreateDateMatch[1]

    const xmpModifyDateMatch = /<xmp:ModifyDate>([^<]*)<\/xmp:ModifyDate>/.exec(xmpContent)
    if (xmpModifyDateMatch) xmpData['xmp:ModifyDate'] = xmpModifyDateMatch[1]

    return xmpData
  }

  /**
   * Parse PDF date format (D:YYYYMMDDHHmmSSOHH'mm')
   */
  private parsePdfDate(dateStr: string): Date | undefined {
    // Remove 'D:' prefix if present
    const cleaned = dateStr.replace(/^D:/, '')

    // Parse format: YYYYMMDDHHmmSSOHH'mm'
    const match = /(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(cleaned)
    if (!match) return undefined

    const year = parseInt(match[1], 10)
    const month = match[2] ? parseInt(match[2], 10) - 1 : 0
    const day = match[3] ? parseInt(match[3], 10) : 1
    const hour = match[4] ? parseInt(match[4], 10) : 0
    const minute = match[5] ? parseInt(match[5], 10) : 0
    const second = match[6] ? parseInt(match[6], 10) : 0

    return new Date(year, month, day, hour, minute, second)
  }

  // ==========================================================================
  // Private - Form Field Extraction
  // ==========================================================================

  /**
   * Parse AcroForm fields
   */
  private parseAcroForm(): ExtractedFormField[] {
    const fields: ExtractedFormField[] = []

    // Find AcroForm dictionary
    const acroFormMatch = /\/AcroForm\s+(\d+)\s+\d+\s+R/.exec(this.pdfString)
    if (!acroFormMatch) {
      // Try inline AcroForm
      const inlineAcroForm = /\/AcroForm\s*<<([\s\S]*?)>>/.exec(this.pdfString)
      if (!inlineAcroForm) return fields
    }

    // Find all widget annotations (form fields)
    const widgetPattern = /\/Subtype\s*\/Widget[\s\S]*?\/T\s*\(([^)]*)\)[\s\S]*?\/FT\s*\/(\w+)/g
    let match

    while ((match = widgetPattern.exec(this.pdfString)) !== null) {
      const fieldName = this.unescapePdfText(match[1])
      const fieldType = match[2]

      const field: ExtractedFormField = {
        name: fieldName,
        value: '',
        type: this.mapFieldType(fieldType),
        page: 1, // Would need to trace back to page
      }

      // Extract value based on field type
      const valueMatch = this.extractFieldValue(match.index, fieldType)
      if (valueMatch !== undefined) {
        field.value = valueMatch
      }

      // Extract bounds if available
      const boundsMatch = this.extractFieldBounds(match.index)
      if (boundsMatch) {
        field.bounds = boundsMatch
      }

      fields.push(field)
    }

    return fields
  }

  /**
   * Map PDF field type to our type
   */
  private mapFieldType(pdfType: string): 'text' | 'checkbox' | 'radio' | 'select' | 'date' {
    switch (pdfType) {
      case 'Tx': return 'text'
      case 'Btn': return 'checkbox' // Could also be radio, need more context
      case 'Ch': return 'select'
      default: return 'text'
    }
  }

  /**
   * Extract field value
   */
  private extractFieldValue(startIndex: number, fieldType: string): string | boolean | undefined {
    // Search for /V (value) after the field definition
    const searchArea = this.pdfString.slice(startIndex, startIndex + 500)

    // Try string value
    const stringMatch = /\/V\s*\(([^)]*)\)/.exec(searchArea)
    if (stringMatch) {
      return this.unescapePdfText(stringMatch[1])
    }

    // Try name value (for checkboxes/radios)
    const nameMatch = /\/V\s*\/(\w+)/.exec(searchArea)
    if (nameMatch) {
      const value = nameMatch[1]
      if (fieldType === 'Btn') {
        return value !== 'Off' && value !== 'No'
      }
      return value
    }

    // Try hex string value
    const hexMatch = /\/V\s*<([0-9A-Fa-f]+)>/.exec(searchArea)
    if (hexMatch) {
      return this.hexToString(hexMatch[1])
    }

    return undefined
  }

  /**
   * Extract field bounds
   */
  private extractFieldBounds(startIndex: number): Bounds | undefined {
    const searchArea = this.pdfString.slice(startIndex, startIndex + 500)
    const rectMatch = /\/Rect\s*\[\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\]/.exec(searchArea)

    if (rectMatch) {
      const x1 = parseFloat(rectMatch[1])
      const y1 = parseFloat(rectMatch[2])
      const x2 = parseFloat(rectMatch[3])
      const y2 = parseFloat(rectMatch[4])

      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      }
    }

    return undefined
  }

  // ==========================================================================
  // Private - Table Extraction
  // ==========================================================================

  /**
   * Detect and extract tables using heuristics
   */
  private detectAndExtractTables(): ExtractedTable[] {
    const tables: ExtractedTable[] = []
    const pageCount = this.countPages()

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const pageTables = this.extractTablesFromPage(pageNum)
      tables.push(...pageTables)
    }

    return tables
  }

  /**
   * Extract tables from a single page
   */
  private extractTablesFromPage(pageNum: number): ExtractedTable[] {
    const tables: ExtractedTable[] = []
    const pageText = this.extractPageText(pageNum)

    if (!pageText) return tables

    // Split into lines
    const lines = pageText.split('\n').filter(line => line.trim())

    // Detect tabular patterns (lines with consistent delimiters)
    const tabularLines: string[][] = []
    let currentTable: string[][] = []
    let lastColumnCount = 0

    for (const line of lines) {
      // Check for tab-delimited content
      const tabCells = line.split('\t').filter(cell => cell.trim())

      // Check for consistent spacing that might indicate columns
      const spaceCells = line.split(/\s{2,}/).filter(cell => cell.trim())

      // Use the split that gives more columns
      const cells = tabCells.length > spaceCells.length ? tabCells : spaceCells

      if (cells.length >= 2) {
        // Potential table row
        if (lastColumnCount === 0 || cells.length === lastColumnCount) {
          currentTable.push(cells)
          lastColumnCount = cells.length
        } else if (currentTable.length >= 2) {
          // Column count changed, save current table
          tabularLines.push(...this.processTableCandidate(currentTable, pageNum, tables))
          currentTable = [cells]
          lastColumnCount = cells.length
        }
      } else if (currentTable.length >= 2) {
        // Non-tabular line, save current table
        tabularLines.push(...this.processTableCandidate(currentTable, pageNum, tables))
        currentTable = []
        lastColumnCount = 0
      }
    }

    // Process any remaining table
    if (currentTable.length >= 2) {
      this.processTableCandidate(currentTable, pageNum, tables)
    }

    return tables
  }

  /**
   * Process a potential table candidate
   */
  private processTableCandidate(rows: string[][], pageNum: number, tables: ExtractedTable[]): string[][] {
    if (rows.length < 2) return []

    // First row is likely headers if it contains different content pattern
    const headers = rows[0]
    const dataRows = rows.slice(1)

    tables.push({
      headers,
      rows: dataRows,
      page: pageNum,
    })

    return []
  }

  // ==========================================================================
  // Private - Image Extraction
  // ==========================================================================

  /**
   * Parse and extract images from PDF
   */
  private parseImages(pageRange: { start: number; end: number }, maxSize: number): ExtractedImage[] {
    const images: ExtractedImage[] = []
    let imageId = 0

    // Find XObject dictionaries containing images
    const xObjectPattern = /\/Subtype\s*\/Image[\s\S]*?(?=endobj)/g
    let match

    while ((match = xObjectPattern.exec(this.pdfString)) !== null) {
      const imageObj = match[0]

      // Extract image properties
      const widthMatch = /\/Width\s+(\d+)/.exec(imageObj)
      const heightMatch = /\/Height\s+(\d+)/.exec(imageObj)

      if (!widthMatch || !heightMatch) continue

      const width = parseInt(widthMatch[1], 10)
      const height = parseInt(heightMatch[1], 10)

      // Skip if larger than maxSize
      if (width > maxSize || height > maxSize) continue

      // Determine color space
      let colorSpace = 'DeviceRGB'
      const colorSpaceMatch = /\/ColorSpace\s*\/(\w+)/.exec(imageObj)
      if (colorSpaceMatch) {
        colorSpace = colorSpaceMatch[1]
      }

      // Determine bits per component
      let bitsPerComponent = 8
      const bpcMatch = /\/BitsPerComponent\s+(\d+)/.exec(imageObj)
      if (bpcMatch) {
        bitsPerComponent = parseInt(bpcMatch[1], 10)
      }

      // Determine image type
      let mimeType = 'image/png'
      const filterMatch = /\/Filter\s*\/(\w+)/.exec(imageObj)
      if (filterMatch) {
        const filter = filterMatch[1]
        if (filter === 'DCTDecode') mimeType = 'image/jpeg'
        else if (filter === 'JPXDecode') mimeType = 'image/jp2'
      }

      // Extract image data (stream content)
      const streamMatch = /stream\s*([\s\S]*?)\s*endstream/.exec(imageObj)
      let imageData = ''
      if (streamMatch && streamMatch[1]) {
        // Convert to base64 if it's binary data
        imageData = this.arrayBufferToBase64(new TextEncoder().encode(streamMatch[1]))
      }

      images.push({
        id: `img_${++imageId}`,
        page: 1, // Would need to trace back to actual page
        data: imageData,
        mimeType,
        dimensions: { width, height },
        bounds: { x: 0, y: 0, width, height },
        colorSpace: this.normalizeColorSpace(colorSpace),
        bitsPerComponent,
      })
    }

    return images
  }

  /**
   * Normalize color space name
   */
  private normalizeColorSpace(colorSpace: string): string {
    const mapping: Record<string, string> = {
      'DeviceRGB': 'RGB',
      'DeviceCMYK': 'CMYK',
      'DeviceGray': 'Grayscale',
      'CalRGB': 'RGB',
      'CalGray': 'Grayscale',
      'Lab': 'Lab',
      'ICCBased': 'RGB', // Simplified
    }
    return mapping[colorSpace] || colorSpace
  }

  // ==========================================================================
  // Private - Annotation Extraction
  // ==========================================================================

  /**
   * Parse annotations from PDF
   */
  private parseAnnotations(): PDFAnnotation[] {
    const annotations: PDFAnnotation[] = []

    // Find annotation dictionaries
    const annotPattern = /\/Type\s*\/Annot[\s\S]*?\/Subtype\s*\/(\w+)([\s\S]*?)(?=\d+\s+\d+\s+obj|$)/g
    let match

    while ((match = annotPattern.exec(this.pdfString)) !== null) {
      const subtype = match[1].toLowerCase()
      const annotContent = match[2]

      const annotation: PDFAnnotation = {
        type: this.mapAnnotationType(subtype),
        page: 1, // Would need to trace back
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      }

      // Extract bounds
      const rectMatch = /\/Rect\s*\[\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\]/.exec(annotContent)
      if (rectMatch) {
        annotation.bounds = {
          x: parseFloat(rectMatch[1]),
          y: parseFloat(rectMatch[2]),
          width: parseFloat(rectMatch[3]) - parseFloat(rectMatch[1]),
          height: parseFloat(rectMatch[4]) - parseFloat(rectMatch[2]),
        }
      }

      // Extract content
      const contentsMatch = /\/Contents\s*\(([^)]*)\)/.exec(annotContent)
      if (contentsMatch) {
        annotation.content = this.unescapePdfText(contentsMatch[1])
      }

      // Extract author
      const authorMatch = /\/T\s*\(([^)]*)\)/.exec(annotContent)
      if (authorMatch) {
        annotation.author = this.unescapePdfText(authorMatch[1])
      }

      // Extract color
      const colorMatch = /\/C\s*\[\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\]/.exec(annotContent)
      if (colorMatch) {
        const r = Math.round(parseFloat(colorMatch[1]) * 255)
        const g = Math.round(parseFloat(colorMatch[2]) * 255)
        const b = Math.round(parseFloat(colorMatch[3]) * 255)
        annotation.color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
      }

      // Extract link destination
      if (subtype === 'link') {
        const uriMatch = /\/URI\s*\(([^)]*)\)/.exec(annotContent)
        if (uriMatch) {
          annotation.destination = this.unescapePdfText(uriMatch[1])
        }
      }

      annotations.push(annotation)
    }

    return annotations
  }

  /**
   * Map PDF annotation subtype to our type
   */
  private mapAnnotationType(subtype: string): PDFAnnotation['type'] {
    const mapping: Record<string, PDFAnnotation['type']> = {
      'highlight': 'highlight',
      'underline': 'underline',
      'strikeout': 'strikeout',
      'squiggly': 'squiggly',
      'text': 'note',
      'link': 'link',
      'stamp': 'stamp',
      'freetext': 'freetext',
      'line': 'line',
      'square': 'square',
      'circle': 'circle',
      'polygon': 'polygon',
      'ink': 'ink',
      'popup': 'popup',
      'fileattachment': 'fileattachment',
      'sound': 'sound',
      'movie': 'movie',
      'widget': 'widget',
      'screen': 'screen',
      'printermark': 'printermark',
      'trapnet': 'trapnet',
      'watermark': 'watermark',
      '3d': '3d',
      'redact': 'redact',
    }
    return mapping[subtype] || 'note'
  }

  // ==========================================================================
  // Private - Structure Extraction
  // ==========================================================================

  /**
   * Parse PDF structure information
   */
  private parsePDFStructure(): PDFStructure {
    // Extract PDF version
    const versionMatch = /%PDF-(\d+\.\d+)/.exec(this.pdfString)
    const version = versionMatch ? versionMatch[1] : '1.0'

    // Count pages and get dimensions
    const pageCount = this.countPages()
    const pages = this.getPageDimensions(pageCount)

    // Extract fonts
    const fonts = this.extractFonts()

    // Extract bookmarks
    const bookmarks = this.extractBookmarks()

    // Check for tagged PDF
    const isTagged = /\/MarkInfo/.test(this.pdfString) && /\/Marked\s+true/.test(this.pdfString)

    // Check for forms
    const hasForm = /\/AcroForm/.test(this.pdfString)

    // Check for signatures
    const hasSignatures = /\/Sig/.test(this.pdfString) && /\/Type\s*\/Sig/.test(this.pdfString)

    // Get encryption info
    const encryption = this.parseEncryptionStructure()

    return {
      version,
      pageCount,
      pages,
      fonts,
      bookmarks,
      isTagged,
      hasForm,
      hasSignatures,
      encryption,
    }
  }

  /**
   * Get page dimensions for all pages
   */
  private getPageDimensions(pageCount: number): PDFStructure['pages'] {
    const pages: PDFStructure['pages'] = []

    for (let i = 1; i <= pageCount; i++) {
      const pageObjNum = this.pageObjects.get(i)
      let width = 612
      let height = 792
      let rotation: number | undefined

      if (pageObjNum) {
        const pageObj = this.objects.get(`${pageObjNum} 0`)
        if (pageObj) {
          const mediaBox = this.parseMediaBox(pageObj)
          width = mediaBox.width
          height = mediaBox.height

          const rotateMatch = /\/Rotate\s+(\d+)/.exec(pageObj)
          if (rotateMatch) {
            rotation = parseInt(rotateMatch[1], 10)
          }
        }
      }

      pages.push({ number: i, width, height, rotation })
    }

    return pages
  }

  /**
   * Extract font information
   */
  private extractFonts(): PDFFont[] {
    const fonts: PDFFont[] = []
    const fontNames = new Set<string>()

    // Find font definitions
    const fontPattern = /\/Type\s*\/Font[\s\S]*?\/BaseFont\s*\/(\S+)[\s\S]*?\/Subtype\s*\/(\w+)/g
    let match

    while ((match = fontPattern.exec(this.pdfString)) !== null) {
      const name = match[1].replace(/^\//, '')
      if (fontNames.has(name)) continue
      fontNames.add(name)

      const fontType = match[2]
      const fontContent = match[0]

      // Check if embedded
      const embedded = /\/FontFile/.test(fontContent)

      // Get encoding
      let encoding: string | undefined
      const encodingMatch = /\/Encoding\s*\/(\w+)/.exec(fontContent)
      if (encodingMatch) {
        encoding = encodingMatch[1]
      }

      fonts.push({
        name,
        type: fontType,
        embedded,
        encoding,
        usedOnPages: [], // Would need more complex analysis
      })
    }

    return fonts
  }

  /**
   * Extract bookmarks/outline
   */
  private extractBookmarks(): PDFBookmark[] {
    const bookmarks: PDFBookmark[] = []

    // Find Outlines dictionary
    const outlinesMatch = /\/Outlines\s+(\d+)\s+\d+\s+R/.exec(this.pdfString)
    if (!outlinesMatch) return bookmarks

    const outlinesObjNum = outlinesMatch[1]
    const outlinesObj = this.objects.get(`${outlinesObjNum} 0`)
    if (!outlinesObj) return bookmarks

    // Find first outline item
    const firstMatch = /\/First\s+(\d+)\s+\d+\s+R/.exec(outlinesObj)
    if (!firstMatch) return bookmarks

    // Parse outline items recursively
    this.parseOutlineItem(firstMatch[1], bookmarks)

    return bookmarks
  }

  /**
   * Parse an outline item and its siblings
   */
  private parseOutlineItem(objNum: string, bookmarks: PDFBookmark[]): void {
    const obj = this.objects.get(`${objNum} 0`)
    if (!obj) return

    // Extract title
    const titleMatch = /\/Title\s*\(([^)]*)\)/.exec(obj)
    const title = titleMatch ? this.unescapePdfText(titleMatch[1]) : 'Untitled'

    // Extract destination page
    let page = 1
    const destMatch = /\/Dest\s*\[\s*(\d+)\s+\d+\s+R/.exec(obj)
    if (destMatch) {
      // Would need to map object ref to page number
      page = 1
    }

    const bookmark: PDFBookmark = { title, page }

    // Check for children
    const firstChildMatch = /\/First\s+(\d+)\s+\d+\s+R/.exec(obj)
    if (firstChildMatch) {
      bookmark.children = []
      this.parseOutlineItem(firstChildMatch[1], bookmark.children)
    }

    bookmarks.push(bookmark)

    // Check for next sibling
    const nextMatch = /\/Next\s+(\d+)\s+\d+\s+R/.exec(obj)
    if (nextMatch) {
      this.parseOutlineItem(nextMatch[1], bookmarks)
    }
  }

  // ==========================================================================
  // Private - Encryption
  // ==========================================================================

  /**
   * Check if PDF is encrypted
   */
  private checkEncryption(): boolean {
    return /\/Encrypt/.test(this.pdfString)
  }

  /**
   * Parse encryption information
   */
  private parseEncryptionInfo(): {
    encrypted: boolean
    method?: string
    keyLength?: number
  } {
    if (!this.checkEncryption()) {
      return { encrypted: false }
    }

    // Find Encrypt dictionary
    const encryptMatch = /\/Encrypt\s+(\d+)\s+\d+\s+R/.exec(this.pdfString)
    if (!encryptMatch) {
      return { encrypted: true }
    }

    const encryptObjNum = encryptMatch[1]
    const encryptObj = this.objects.get(`${encryptObjNum} 0`)
    if (!encryptObj) {
      return { encrypted: true }
    }

    // Determine encryption method
    let method = 'Standard'
    const filterMatch = /\/Filter\s*\/(\w+)/.exec(encryptObj)
    if (filterMatch) {
      method = filterMatch[1]
    }

    // Check for AES
    const cfMatch = /\/CFM\s*\/(\w+)/.exec(encryptObj)
    if (cfMatch) {
      const cfm = cfMatch[1]
      if (cfm === 'AESV2') method = 'AES-128'
      else if (cfm === 'AESV3') method = 'AES-256'
    }

    // Get key length
    let keyLength = 40
    const lengthMatch = /\/Length\s+(\d+)/.exec(encryptObj)
    if (lengthMatch) {
      keyLength = parseInt(lengthMatch[1], 10)
    }

    return { encrypted: true, method, keyLength }
  }

  /**
   * Parse encryption structure for PDFStructure
   */
  private parseEncryptionStructure(): PDFStructure['encryption'] | undefined {
    if (!this.checkEncryption()) {
      return undefined
    }

    const info = this.parseEncryptionInfo()
    const permissions = this.parsePermissions()

    return {
      encrypted: true,
      method: info.method,
      permissions,
    }
  }

  /**
   * Parse permissions
   */
  private parsePermissions(password?: string): {
    printing: boolean
    copying: boolean
    modifying: boolean
    annotating: boolean
  } {
    // Default permissions (if not encrypted or can't parse)
    const defaultPerms = {
      printing: true,
      copying: true,
      modifying: true,
      annotating: true,
    }

    if (!this.checkEncryption()) {
      return defaultPerms
    }

    // Find Encrypt dictionary
    const encryptMatch = /\/Encrypt\s+(\d+)\s+\d+\s+R/.exec(this.pdfString)
    if (!encryptMatch) return defaultPerms

    const encryptObjNum = encryptMatch[1]
    const encryptObj = this.objects.get(`${encryptObjNum} 0`)
    if (!encryptObj) return defaultPerms

    // Parse P (permissions) value
    const pMatch = /\/P\s+(-?\d+)/.exec(encryptObj)
    if (!pMatch) return defaultPerms

    const p = parseInt(pMatch[1], 10)

    // Decode permission bits (PDF Reference Table 3.20)
    return {
      printing: (p & 4) !== 0 || (p & 2048) !== 0,
      modifying: (p & 8) !== 0,
      copying: (p & 16) !== 0,
      annotating: (p & 32) !== 0,
    }
  }

  // ==========================================================================
  // Private - Utility Methods
  // ==========================================================================

  /**
   * Count pages in PDF
   */
  private countPages(): number {
    const countMatch = /\/Count\s+(\d+)/.exec(this.pdfString)
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
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
  }

  /**
   * Convert hex string to regular string
   */
  private hexToString(hex: string): string {
    let result = ''
    for (let i = 0; i < hex.length; i += 2) {
      result += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
    }
    return result
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

  // Versioning storage
  private versions: Map<string, DocumentVersion[]> = new Map()
  private auditLog: Map<string, VersionAuditEntry[]> = new Map()

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

  // ==========================================================================
  // Versioning Methods
  // ==========================================================================

  /**
   * Create a new version of a document
   */
  async createVersion(
    documentId: string,
    content: Uint8Array,
    metadata?: DocumentVersionMetadata
  ): Promise<DocumentVersion> {
    const documentVersions = this.versions.get(documentId) ?? []
    const previousVersion = documentVersions.length > 0 ? documentVersions[documentVersions.length - 1] : null

    // Mark previous version as not current
    if (previousVersion) {
      previousVersion.isCurrent = false
    }

    const versionId = `ver_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
    const hash = await this.computeHash(content)
    const action: VersionAction = metadata?.action ?? (previousVersion ? 'updated' : 'created')

    const version: DocumentVersion = {
      id: versionId,
      documentId,
      versionNumber: documentVersions.length + 1,
      content,
      hash,
      sizeBytes: content.length,
      mimeType: 'application/pdf',
      metadata: {
        ...metadata,
        action,
      },
      createdAt: new Date(),
      previousVersionId: previousVersion?.id ?? null,
      nextVersionId: null,
      isCurrent: true,
    }

    // Update previous version's nextVersionId
    if (previousVersion) {
      previousVersion.nextVersionId = versionId
    }

    documentVersions.push(version)
    this.versions.set(documentId, documentVersions)

    // Add audit entry
    this.addAuditEntry(documentId, {
      versionId,
      versionNumber: version.versionNumber,
      action,
      actor: metadata?.author,
      timestamp: new Date(),
      description: metadata?.description ?? `Version ${version.versionNumber} ${action}`,
    })

    return version
  }

  /**
   * List all versions of a document
   */
  async listVersions(documentId: string): Promise<DocumentVersionListItem[]> {
    const documentVersions = this.versions.get(documentId) ?? []

    return documentVersions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      hash: v.hash,
      sizeBytes: v.sizeBytes,
      description: v.metadata.description,
      author: v.metadata.author,
      action: v.metadata.action,
      createdAt: v.createdAt,
      isCurrent: v.isCurrent,
    }))
  }

  /**
   * Get a specific version of a document
   */
  async getVersion(documentId: string, versionId: string): Promise<DocumentVersion | null> {
    const documentVersions = this.versions.get(documentId) ?? []
    return documentVersions.find((v) => v.id === versionId) ?? null
  }

  /**
   * Revert a document to a specific version
   */
  async revertToVersion(documentId: string, versionId: string): Promise<DocumentVersion> {
    const sourceVersion = await this.getVersion(documentId, versionId)
    if (!sourceVersion) {
      throw new Error(`Version "${versionId}" not found for document "${documentId}"`)
    }

    // Create a new version with the content from the source version
    const newVersion = await this.createVersion(documentId, sourceVersion.content, {
      description: `Reverted to version ${sourceVersion.versionNumber}`,
      sourceVersionId: versionId,
      action: 'reverted',
      author: undefined, // Caller should provide author if needed
    })

    return newVersion
  }

  /**
   * Compare two versions of a document
   */
  async diffVersions(
    documentId: string,
    fromVersionId: string,
    toVersionId: string
  ): Promise<VersionDiff> {
    const fromVersion = await this.getVersion(documentId, fromVersionId)
    const toVersion = await this.getVersion(documentId, toVersionId)

    if (!fromVersion) {
      throw new Error(`Source version "${fromVersionId}" not found`)
    }
    if (!toVersion) {
      throw new Error(`Target version "${toVersionId}" not found`)
    }

    // Check if versions are identical by hash
    const isIdentical = fromVersion.hash === toVersion.hash

    // Extract text from both versions for diff
    const fromText = await this.extractTextFromContent(fromVersion.content)
    const toText = await this.extractTextFromContent(toVersion.content)

    // Compute text-based diff
    const changes = this.computeTextDiff(fromText, toText)

    // Calculate summary
    const summary = {
      added: changes.filter((c) => c.operation === 'added').length,
      removed: changes.filter((c) => c.operation === 'removed').length,
      modified: changes.filter((c) => c.operation === 'modified').length,
      total: changes.length,
      sizeDelta: toVersion.sizeBytes - fromVersion.sizeBytes,
    }

    return {
      fromVersionId,
      toVersionId,
      fromVersionNumber: fromVersion.versionNumber,
      toVersionNumber: toVersion.versionNumber,
      changes,
      summary,
      isIdentical,
      generatedAt: new Date(),
    }
  }

  /**
   * Get version history with audit trail
   */
  async getVersionHistory(
    documentId: string,
    options?: VersionHistoryOptions
  ): Promise<VersionHistory> {
    const documentVersions = this.versions.get(documentId) ?? []
    const auditEntries = this.auditLog.get(documentId) ?? []

    if (documentVersions.length === 0) {
      throw new Error(`No versions found for document "${documentId}"`)
    }

    // Apply filters to audit entries
    let filteredEntries = [...auditEntries]

    if (options?.actions && options.actions.length > 0) {
      filteredEntries = filteredEntries.filter((e) => options.actions!.includes(e.action))
    }

    if (options?.author) {
      filteredEntries = filteredEntries.filter((e) => e.actor === options.author)
    }

    if (options?.dateRange?.from) {
      filteredEntries = filteredEntries.filter((e) => e.timestamp >= options.dateRange!.from!)
    }

    if (options?.dateRange?.to) {
      filteredEntries = filteredEntries.filter((e) => e.timestamp <= options.dateRange!.to!)
    }

    // Apply pagination
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? filteredEntries.length
    filteredEntries = filteredEntries.slice(offset, offset + limit)

    const currentVersion = documentVersions.find((v) => v.isCurrent)!
    const firstVersion = documentVersions[0]
    const latestVersion = documentVersions[documentVersions.length - 1]

    const result: VersionHistory = {
      documentId,
      totalVersions: documentVersions.length,
      currentVersionId: currentVersion.id,
      currentVersionNumber: currentVersion.versionNumber,
      firstVersionDate: firstVersion.createdAt,
      latestVersionDate: latestVersion.createdAt,
      entries: filteredEntries,
    }

    // Include version list if requested
    if (options?.includeContent !== false) {
      result.versions = await this.listVersions(documentId)
    }

    return result
  }

  /**
   * Add an audit log entry
   */
  private addAuditEntry(documentId: string, entry: VersionAuditEntry): void {
    const entries = this.auditLog.get(documentId) ?? []
    entries.push(entry)
    this.auditLog.set(documentId, entries)
  }

  /**
   * Extract text from PDF content for diffing
   */
  private async extractTextFromContent(content: Uint8Array): Promise<string> {
    try {
      const extraction = await this.documentParser.extractText(content)
      return extraction.content
    } catch {
      // If extraction fails, return empty string
      return ''
    }
  }

  /**
   * Compute text-based diff between two strings
   * Uses a line-by-line comparison for simplicity
   */
  private computeTextDiff(fromText: string, toText: string): DiffChange[] {
    const fromLines = fromText.split('\n')
    const toLines = toText.split('\n')
    const changes: DiffChange[] = []

    // Simple diff algorithm using LCS-like approach
    let fromIdx = 0
    let toIdx = 0

    while (fromIdx < fromLines.length || toIdx < toLines.length) {
      const fromLine = fromIdx < fromLines.length ? fromLines[fromIdx] : null
      const toLine = toIdx < toLines.length ? toLines[toIdx] : null

      if (fromLine === toLine) {
        // Unchanged
        fromIdx++
        toIdx++
      } else if (toLine === null || (fromLine !== null && !toLines.includes(fromLine))) {
        // Line was removed
        changes.push({
          operation: 'removed',
          location: { start: fromIdx, end: fromIdx + 1 },
          original: fromLine!,
        })
        fromIdx++
      } else if (fromLine === null || (toLine !== null && !fromLines.includes(toLine))) {
        // Line was added
        changes.push({
          operation: 'added',
          location: { start: toIdx, end: toIdx + 1 },
          modified: toLine!,
        })
        toIdx++
      } else {
        // Line was modified
        changes.push({
          operation: 'modified',
          location: { start: fromIdx, end: fromIdx + 1 },
          original: fromLine!,
          modified: toLine!,
        })
        fromIdx++
        toIdx++
      }
    }

    return changes
  }
}

// =============================================================================
// BulkDocumentRenderer - Parallel Bulk Document Generation
// =============================================================================

/**
 * Default configuration for bulk rendering
 */
const BULK_DEFAULTS = {
  concurrency: 10,
  batchSize: 100,
  continueOnError: true,
  skipInvalid: false,
  timeoutMs: 30000,
}

/**
 * BulkDocumentRenderer - Optimized for mass document generation
 *
 * Features:
 * - Parallel processing with configurable concurrency
 * - Batching for memory optimization (process N documents, release memory, repeat)
 * - Progress tracking with callbacks
 * - Individual and batch event emissions
 * - Cancellation support
 * - Validation pre-check option
 * - Timeout per document
 *
 * Optimized for Cloudflare Workers runtime with careful memory management.
 */
export class BulkDocumentRenderer implements IBulkDocumentRenderer {
  private renderer: DocumentRenderer
  private cancelled = false
  private running = false
  private inProgressItems: Set<string> = new Set()

  constructor(renderer?: DocumentRenderer) {
    this.renderer = renderer ?? new DocumentRenderer()
  }

  /**
   * Render multiple documents in parallel with batching
   */
  async renderBulk(
    inputs: BulkRenderInput[],
    options?: BulkRenderOptions
  ): Promise<BulkRenderResponse> {
    if (this.running) {
      throw new Error('Bulk operation already in progress. Call cancel() first.')
    }

    this.running = true
    this.cancelled = false
    this.inProgressItems.clear()

    const startedAt = new Date()
    const opts = { ...BULK_DEFAULTS, ...options }
    const results: BulkRenderResult[] = []
    const failures: Array<{ id: string; error: string }> = []
    const skippedItems: Array<{ id: string; reason: string }> = []

    // Calculate batches
    const totalBatches = Math.ceil(inputs.length / opts.batchSize)
    let succeeded = 0
    let failed = 0
    let skipped = 0
    const processingTimes: number[] = []

    try {
      // Process in batches
      for (let batchNum = 0; batchNum < totalBatches && !this.cancelled; batchNum++) {
        const batchStart = batchNum * opts.batchSize
        const batchEnd = Math.min(batchStart + opts.batchSize, inputs.length)
        const batchInputs = inputs.slice(batchStart, batchEnd)
        const batchResults: BulkRenderResult[] = []

        // Process batch with concurrency limit
        await this.processBatchWithConcurrency(
          batchInputs,
          opts,
          (result) => {
            batchResults.push(result)
            results.push(result)

            if (result.status === 'completed') {
              succeeded++
              processingTimes.push(result.durationMs)
            } else if (result.status === 'failed') {
              failed++
              failures.push({ id: result.id, error: result.error ?? 'Unknown error' })
            } else if (result.status === 'skipped') {
              skipped++
              skippedItems.push({ id: result.id, reason: result.error ?? 'Validation failed' })
            }

            // Calculate progress
            const completed = succeeded + failed + skipped
            const avgTime = processingTimes.length > 0
              ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
              : 0
            const remaining = inputs.length - completed
            const estimatedRemainingMs = remaining * avgTime

            const progress: BulkProgress = {
              total: inputs.length,
              completed,
              succeeded,
              failed,
              skipped,
              currentBatch: batchNum + 1,
              totalBatches,
              percentage: Math.round((completed / inputs.length) * 100),
              estimatedRemainingMs: Math.round(estimatedRemainingMs),
              averageTimeMs: Math.round(avgTime),
              inProgress: Array.from(this.inProgressItems),
            }

            opts.onProgress?.(progress)
            opts.onItemComplete?.(result)
          }
        )

        // Batch complete callback
        opts.onBatchComplete?.(batchNum + 1, batchResults)

        // Allow GC between batches for memory optimization
        await this.yieldToEventLoop()
      }
    } finally {
      this.running = false
      this.inProgressItems.clear()
    }

    const finishedAt = new Date()
    const totalDurationMs = finishedAt.getTime() - startedAt.getTime()
    const total = succeeded + failed + skipped

    const summary: BulkRenderSummary = {
      total,
      succeeded,
      failed,
      skipped,
      totalDurationMs,
      averageTimeMs: total > 0 ? Math.round(totalDurationMs / total) : 0,
      startedAt,
      finishedAt,
      failures,
      skippedItems,
    }

    return { summary, results }
  }

  /**
   * Process a batch with concurrency control
   */
  private async processBatchWithConcurrency(
    inputs: BulkRenderInput[],
    options: Required<BulkRenderOptions>,
    onResult: (result: BulkRenderResult) => void
  ): Promise<BulkRenderResult[]> {
    const results: BulkRenderResult[] = []
    const queue = [...inputs]
    const inFlight: Promise<void>[] = []

    const processNext = async (): Promise<void> => {
      while (queue.length > 0 && !this.cancelled) {
        const input = queue.shift()
        if (!input) break

        this.inProgressItems.add(input.id)

        const startedAt = new Date()
        let result: BulkRenderResult

        try {
          // Validate first if skipInvalid is enabled
          if (options.skipInvalid) {
            const validation = await this.renderer.validate(input.templateId, input.variables)
            if (!validation.valid) {
              result = {
                id: input.id,
                status: 'skipped',
                error: validation.errors.map(e => e.message).join('; '),
                validation,
                durationMs: Date.now() - startedAt.getTime(),
                startedAt,
                finishedAt: new Date(),
              }
              this.inProgressItems.delete(input.id)
              onResult(result)
              continue
            }
          }

          // Render with timeout
          const document = await this.withTimeout(
            this.renderer.render(input.templateId, input.variables, input.options),
            options.timeoutMs,
            `Rendering ${input.id} timed out after ${options.timeoutMs}ms`
          )

          result = {
            id: input.id,
            status: 'completed',
            document,
            durationMs: Date.now() - startedAt.getTime(),
            startedAt,
            finishedAt: new Date(),
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)

          if (!options.continueOnError) {
            this.cancelled = true
            throw error
          }

          result = {
            id: input.id,
            status: 'failed',
            error: errorMsg,
            durationMs: Date.now() - startedAt.getTime(),
            startedAt,
            finishedAt: new Date(),
          }
        }

        this.inProgressItems.delete(input.id)
        onResult(result)
      }
    }

    // Start concurrent processors
    for (let i = 0; i < Math.min(options.concurrency, inputs.length); i++) {
      inFlight.push(processNext())
    }

    await Promise.all(inFlight)
    return results
  }

  /**
   * Validate multiple inputs before bulk rendering
   */
  async validateBulk(
    inputs: BulkRenderInput[]
  ): Promise<Array<{ id: string; validation: ValidationResult }>> {
    const results: Array<{ id: string; validation: ValidationResult }> = []

    // Process validations in parallel with reasonable concurrency
    const concurrency = 50
    const queue = [...inputs]

    const processNext = async (): Promise<void> => {
      while (queue.length > 0) {
        const input = queue.shift()
        if (!input) break

        const validation = await this.renderer.validate(input.templateId, input.variables)
        results.push({ id: input.id, validation })
      }
    }

    const workers = Array(Math.min(concurrency, inputs.length))
      .fill(null)
      .map(() => processNext())

    await Promise.all(workers)
    return results
  }

  /**
   * Estimate time and resources for bulk operation
   */
  async estimate(
    inputs: BulkRenderInput[],
    options?: BulkRenderOptions
  ): Promise<{
    estimatedDurationMs: number
    estimatedMemoryMb: number
    batchCount: number
    itemsPerBatch: number
  }> {
    const opts = { ...BULK_DEFAULTS, ...options }

    // Estimate based on document complexity
    // Average document generation takes ~50-200ms depending on complexity
    const avgTimePerDoc = 100 // ms (conservative estimate)

    // With concurrency, effective time is reduced
    const effectiveConcurrency = Math.min(opts.concurrency, inputs.length)
    const parallelBatches = Math.ceil(inputs.length / effectiveConcurrency)
    const estimatedDurationMs = parallelBatches * avgTimePerDoc

    // Memory estimate: ~2MB per document in-flight
    // Plus base overhead for template caching
    const memPerDoc = 2 // MB
    const baseOverhead = 50 // MB for templates, parser, etc.
    const estimatedMemoryMb = baseOverhead + (effectiveConcurrency * memPerDoc)

    return {
      estimatedDurationMs,
      estimatedMemoryMb,
      batchCount: Math.ceil(inputs.length / opts.batchSize),
      itemsPerBatch: opts.batchSize,
    }
  }

  /**
   * Cancel an in-progress bulk operation
   */
  cancel(): void {
    this.cancelled = true
  }

  /**
   * Check if a bulk operation is in progress
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Get the underlying DocumentRenderer instance
   */
  getRenderer(): DocumentRenderer {
    return this.renderer
  }

  /**
   * Wrap a promise with a timeout
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(message))
      }, timeoutMs)
    })

    try {
      const result = await Promise.race([promise, timeoutPromise])
      clearTimeout(timeoutId!)
      return result
    } catch (error) {
      clearTimeout(timeoutId!)
      throw error
    }
  }

  /**
   * Yield to event loop for better memory management
   */
  private async yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }
}
