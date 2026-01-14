/**
 * EmailTemplater - Comprehensive Email Templating Primitives
 *
 * Provides a complete email templating system:
 * - TemplateEngine: Variable substitution with {{variable}} syntax
 * - HTMLProcessor: CSS inlining and HTML sanitization
 * - TextGenerator: HTML to plain text conversion
 * - LocalizationManager: i18n support for templates
 * - AttachmentHandler: Email attachment processing
 * - VariableValidator: Validate template variables
 * - EmailTemplater: Main class orchestrating all components
 */

export * from './types'

import type {
  EmailTemplate,
  TemplateContext,
  EmailConfig,
  RenderedEmail,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  PreviewResult,
  TemplateListItem,
  TemplateVariable,
  VariableType,
  Attachment,
  LocaleConfig,
  TranslationEntry,
  TemplateHelper,
  TemplateFilter,
  TemplateEngineConfig,
  IEmailTemplater,
  ITemplateEngine,
  IHTMLProcessor,
  ITextGenerator,
  ILocalizationManager,
  IAttachmentHandler,
  IVariableValidator,
} from './types'

// =============================================================================
// VariableValidator Implementation
// =============================================================================

/**
 * Validates template variables against their definitions
 */
export class VariableValidator implements IVariableValidator {
  /**
   * Validate a value against a variable definition
   */
  validate(value: unknown, variable: TemplateVariable): ValidationError | null {
    // Check required
    if (variable.required && (value === undefined || value === null)) {
      return {
        variable: variable.name,
        message: `Required variable "${variable.name}" is missing`,
        code: 'MISSING_REQUIRED',
        expected: variable.type,
        received: value === null ? 'null' : 'undefined',
      }
    }

    // If not required and value is missing, it's valid
    if (value === undefined || value === null) {
      return null
    }

    // Check type
    if (!this.checkType(value, variable.type)) {
      return {
        variable: variable.name,
        message: `Variable "${variable.name}" has invalid type. Expected ${variable.type}, got ${typeof value}`,
        code: 'INVALID_TYPE',
        expected: variable.type,
        received: typeof value,
      }
    }

    return null
  }

  /**
   * Check if value matches expected type
   */
  checkType(value: unknown, expectedType: VariableType): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string'
      case 'number':
        return typeof value === 'number' && !isNaN(value)
      case 'boolean':
        return typeof value === 'boolean'
      case 'date':
        // Accept Date objects, valid date strings, or timestamps
        if (value instanceof Date) return true
        if (typeof value === 'string') {
          const date = new Date(value)
          return !isNaN(date.getTime())
        }
        if (typeof value === 'number') {
          const date = new Date(value)
          return !isNaN(date.getTime())
        }
        return false
      case 'array':
        return Array.isArray(value)
      case 'object':
        return (
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value)
        )
      default:
        return false
    }
  }

  /**
   * Coerce value to expected type if possible
   */
  coerce(value: unknown, targetType: VariableType): unknown {
    if (value === undefined || value === null) return value

    switch (targetType) {
      case 'string':
        return String(value)
      case 'number':
        const num = Number(value)
        return isNaN(num) ? value : num
      case 'boolean':
        if (typeof value === 'string') {
          if (value.toLowerCase() === 'true' || value === '1') return true
          if (value.toLowerCase() === 'false' || value === '0') return false
        }
        return Boolean(value)
      case 'date':
        if (value instanceof Date) return value
        return new Date(value as string | number)
      default:
        return value
    }
  }
}

// =============================================================================
// TemplateEngine Implementation
// =============================================================================

/**
 * Template engine for variable substitution
 * Supports {{variable}}, {{nested.path}}, conditionals, loops, helpers, and filters
 */
export class TemplateEngine implements ITemplateEngine {
  private helpers: Map<string, TemplateHelper> = new Map()
  private filters: Map<string, TemplateFilter> = new Map()
  private config: TemplateEngineConfig

  constructor(config: TemplateEngineConfig = {}) {
    this.config = {
      openDelimiter: '{{',
      closeDelimiter: '}}',
      escapeHtml: false,
      throwOnMissing: false,
      ...config,
    }

    // Register built-in helpers and filters
    if (config.helpers) {
      config.helpers.forEach((h) => this.registerHelper(h))
    }
    if (config.filters) {
      config.filters.forEach((f) => this.registerFilter(f))
    }
  }

  /**
   * Register a custom helper function
   */
  registerHelper(helper: TemplateHelper): void {
    this.helpers.set(helper.name, helper)
  }

  /**
   * Register a custom filter function
   */
  registerFilter(filter: TemplateFilter): void {
    this.filters.set(filter.name, filter)
  }

  /**
   * Render a template string with variables
   */
  render(template: string, variables: Record<string, unknown>): string {
    let result = template

    // Process loops first ({{#each array}}...{{/each}})
    result = this.processLoops(result, variables)

    // Process conditionals ({{#if condition}}...{{/if}})
    result = this.processConditionals(result, variables)

    // Process helpers ({{helperName arg1 arg2}})
    result = this.processHelpers(result, variables)

    // Process variable substitutions with filters ({{variable|filter}})
    result = this.processVariables(result, variables)

    return result
  }

  /**
   * Extract variable names from template
   */
  extractVariables(template: string): string[] {
    const variables: Set<string> = new Set()
    const open = this.escapeRegExp(this.config.openDelimiter!)
    const close = this.escapeRegExp(this.config.closeDelimiter!)

    // Match simple variables: {{variable}} or {{nested.path}}
    const simplePattern = new RegExp(`${open}\\s*([a-zA-Z_][a-zA-Z0-9_.]*)\\s*(?:\\|[^}]*)?${close}`, 'g')
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
   * Process loop blocks
   */
  private processLoops(template: string, variables: Record<string, unknown>): string {
    const openDelim = this.config.openDelimiter!
    const closeDelim = this.config.closeDelimiter!

    // Find outermost {{#each ...}} and its matching {{/each}}
    const result = this.processBlock(template, 'each', (arrayName, body) => {
      const array = this.getValue(arrayName, variables)
      if (!Array.isArray(array)) return ''

      return array
        .map((item, index) => {
          // Create loop context
          const loopVars: Record<string, unknown> = {
            ...variables,
            this: item,
            '@index': index,
            '@first': index === 0,
            '@last': index === array.length - 1,
          }

          // If item is an object, spread its properties
          if (typeof item === 'object' && item !== null) {
            Object.assign(loopVars, item)
          }

          // Recursively process nested content
          return this.render(body, loopVars)
        })
        .join('')
    })

    return result
  }

  /**
   * Process a block type, handling nesting correctly
   */
  private processBlock(
    template: string,
    blockType: string,
    processor: (param: string, body: string) => string
  ): string {
    const openDelim = this.config.openDelimiter!
    const closeDelim = this.config.closeDelimiter!
    const openTag = `${openDelim}#${blockType}`
    const closeTag = `${openDelim}/${blockType}${closeDelim}`

    let result = ''
    let pos = 0

    while (pos < template.length) {
      const openStart = template.indexOf(openTag, pos)
      if (openStart === -1) {
        result += template.slice(pos)
        break
      }

      // Add text before the open tag
      result += template.slice(pos, openStart)

      // Find the end of the open tag
      const openEnd = template.indexOf(closeDelim, openStart)
      if (openEnd === -1) {
        result += template.slice(openStart)
        break
      }

      // Extract the parameter (e.g., array name for #each, condition for #if)
      const tagContent = template.slice(openStart + openTag.length, openEnd).trim()
      const param = tagContent.split(/\s+/)[0]

      // Find matching close tag, accounting for nesting
      let depth = 1
      let searchPos = openEnd + closeDelim.length
      let bodyEnd = -1

      while (depth > 0 && searchPos < template.length) {
        const nextOpen = template.indexOf(openTag, searchPos)
        const nextClose = template.indexOf(closeTag, searchPos)

        if (nextClose === -1) {
          // No closing tag found
          break
        }

        if (nextOpen !== -1 && nextOpen < nextClose) {
          // Found nested open tag
          depth++
          searchPos = nextOpen + openTag.length
        } else {
          // Found close tag
          depth--
          if (depth === 0) {
            bodyEnd = nextClose
          }
          searchPos = nextClose + closeTag.length
        }
      }

      if (bodyEnd === -1) {
        // Malformed template, keep original
        result += template.slice(openStart, openEnd + closeDelim.length)
        pos = openEnd + closeDelim.length
        continue
      }

      // Extract body between tags
      const body = template.slice(openEnd + closeDelim.length, bodyEnd)

      // Process this block
      result += processor(param, body)

      // Move past the close tag
      pos = bodyEnd + closeTag.length
    }

    return result
  }

  /**
   * Process conditional blocks
   */
  private processConditionals(template: string, variables: Record<string, unknown>): string {
    let result = template

    // Process #if blocks (with optional else)
    result = this.processIfBlock(result, variables)

    // Process #unless blocks
    result = this.processUnlessBlock(result, variables)

    return result
  }

  /**
   * Process {{#if ...}}...{{else}}...{{/if}} blocks with proper nesting
   */
  private processIfBlock(template: string, variables: Record<string, unknown>): string {
    const openDelim = this.config.openDelimiter!
    const closeDelim = this.config.closeDelimiter!
    const openTag = `${openDelim}#if`
    const closeTag = `${openDelim}/if${closeDelim}`
    const elseTag = `${openDelim}else${closeDelim}`

    let result = ''
    let pos = 0

    while (pos < template.length) {
      const openStart = template.indexOf(openTag, pos)
      if (openStart === -1) {
        result += template.slice(pos)
        break
      }

      // Add text before the open tag
      result += template.slice(pos, openStart)

      // Find the end of the open tag
      const openEnd = template.indexOf(closeDelim, openStart)
      if (openEnd === -1) {
        result += template.slice(openStart)
        break
      }

      // Extract the condition
      const condition = template.slice(openStart + openTag.length, openEnd).trim()

      // Find matching close tag, accounting for nesting
      let depth = 1
      let searchPos = openEnd + closeDelim.length
      let bodyEnd = -1
      let elsePos = -1

      while (depth > 0 && searchPos < template.length) {
        const nextOpen = template.indexOf(openTag, searchPos)
        const nextClose = template.indexOf(closeTag, searchPos)
        const nextElse = depth === 1 ? template.indexOf(elseTag, searchPos) : -1

        if (nextClose === -1) {
          break
        }

        // Check for else at current depth (before any nested if)
        if (nextElse !== -1 && (nextOpen === -1 || nextElse < nextOpen) && nextElse < nextClose && elsePos === -1) {
          elsePos = nextElse
        }

        if (nextOpen !== -1 && nextOpen < nextClose) {
          // Found nested open tag
          depth++
          searchPos = nextOpen + openTag.length
        } else {
          // Found close tag
          depth--
          if (depth === 0) {
            bodyEnd = nextClose
          }
          searchPos = nextClose + closeTag.length
        }
      }

      if (bodyEnd === -1) {
        // Malformed template, keep original
        result += template.slice(openStart, openEnd + closeDelim.length)
        pos = openEnd + closeDelim.length
        continue
      }

      // Extract body parts
      let ifBody: string
      let elseBody: string

      if (elsePos !== -1 && elsePos < bodyEnd) {
        ifBody = template.slice(openEnd + closeDelim.length, elsePos)
        elseBody = template.slice(elsePos + elseTag.length, bodyEnd)
      } else {
        ifBody = template.slice(openEnd + closeDelim.length, bodyEnd)
        elseBody = ''
      }

      // Evaluate condition
      const value = this.getValue(condition, variables)
      const isTruthy = this.isTruthy(value)

      // Process the appropriate branch (recursively via render for full processing)
      const content = isTruthy ? ifBody : elseBody
      result += this.render(content, variables)

      // Move past the close tag
      pos = bodyEnd + closeTag.length
    }

    return result
  }

  /**
   * Process {{#unless ...}}...{{/unless}} blocks
   */
  private processUnlessBlock(template: string, variables: Record<string, unknown>): string {
    return this.processBlock(template, 'unless', (condition, body) => {
      const value = this.getValue(condition, variables)
      const isTruthy = this.isTruthy(value)
      return !isTruthy ? this.render(body, variables) : ''
    })
  }

  /**
   * Process helper functions
   */
  private processHelpers(template: string, variables: Record<string, unknown>): string {
    const open = this.escapeRegExp(this.config.openDelimiter!)
    const close = this.escapeRegExp(this.config.closeDelimiter!)

    // Match {{helperName arg1 "arg2"}}
    const pattern = new RegExp(
      `${open}\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\s+([^}]+?)\\s*${close}`,
      'g'
    )

    return template.replace(pattern, (match, helperName, argsStr) => {
      const helper = this.helpers.get(helperName)
      if (!helper) return match // Not a helper, leave as is

      // Parse arguments
      const args = this.parseHelperArgs(argsStr, variables)
      if (args.length === 0) return match

      try {
        const result = helper.fn(args[0], ...args.slice(1))
        return String(result)
      } catch {
        return match
      }
    })
  }

  /**
   * Process variable substitutions with filters
   */
  private processVariables(template: string, variables: Record<string, unknown>): string {
    const open = this.escapeRegExp(this.config.openDelimiter!)
    const close = this.escapeRegExp(this.config.closeDelimiter!)

    // Match {{variable}}, {{variable|filter}}, {{variable|filter:"arg"}}
    const pattern = new RegExp(
      `${open}\\s*([a-zA-Z_@][a-zA-Z0-9_.]*)(?:\\|([^}]+))?\\s*${close}`,
      'g'
    )

    return template.replace(pattern, (match, varPath, filterStr) => {
      let value = this.getValue(varPath, variables)

      // Apply filters
      if (filterStr) {
        const filters = this.parseFilters(filterStr)
        for (const { name, args } of filters) {
          if (name === 'default') {
            // Special handling for default filter
            if (value === undefined || value === null) {
              value = args[0]
            }
          } else {
            const filter = this.filters.get(name)
            if (filter) {
              try {
                value = filter.fn(value, ...args)
              } catch {
                // Keep original value on error
              }
            }
          }
        }
      }

      // If value is still undefined, keep the original placeholder
      if (value === undefined) {
        return match
      }

      return String(value ?? '')
    })
  }

  /**
   * Get a value from variables using dot notation
   */
  private getValue(path: string, variables: Record<string, unknown>): unknown {
    // Handle special loop variables
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
   * Check if a value is truthy for conditionals
   */
  private isTruthy(value: unknown): boolean {
    if (value === undefined || value === null) return false
    if (value === false) return false
    if (value === 0) return false
    if (value === '') return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
  }

  /**
   * Parse helper arguments
   */
  private parseHelperArgs(argsStr: string, variables: Record<string, unknown>): unknown[] {
    const args: unknown[] = []
    // Match variable names and quoted strings
    const pattern = /([a-zA-Z_][a-zA-Z0-9_.]*)|"([^"]*)"|'([^']*)'|(\d+(?:\.\d+)?)/g
    let match

    while ((match = pattern.exec(argsStr)) !== null) {
      if (match[1]) {
        // Variable name
        args.push(this.getValue(match[1], variables))
      } else if (match[2] !== undefined) {
        // Double quoted string
        args.push(match[2])
      } else if (match[3] !== undefined) {
        // Single quoted string
        args.push(match[3])
      } else if (match[4]) {
        // Number
        args.push(Number(match[4]))
      }
    }

    return args
  }

  /**
   * Parse filter chain
   */
  private parseFilters(filterStr: string): Array<{ name: string; args: unknown[] }> {
    const filters: Array<{ name: string; args: unknown[] }> = []
    const parts = filterStr.split('|')

    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed) continue

      // Parse filter name and args: filter:"arg1":"arg2" or filter:value
      const colonIndex = trimmed.indexOf(':')
      if (colonIndex === -1) {
        filters.push({ name: trimmed, args: [] })
      } else {
        const name = trimmed.slice(0, colonIndex)
        const argsStr = trimmed.slice(colonIndex + 1)

        // Parse arguments
        const args: unknown[] = []
        const argPattern = /"([^"]*)"|'([^']*)'|([^\s:]+)/g
        let match
        while ((match = argPattern.exec(argsStr)) !== null) {
          if (match[1] !== undefined) {
            args.push(match[1])
          } else if (match[2] !== undefined) {
            args.push(match[2])
          } else if (match[3]) {
            // Try to parse as number
            const num = Number(match[3])
            args.push(isNaN(num) ? match[3] : num)
          }
        }

        filters.push({ name, args })
      }
    }

    return filters
  }

  /**
   * Escape special regex characters
   */
  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}

// =============================================================================
// HTMLProcessor Implementation
// =============================================================================

/**
 * Process HTML templates - CSS inlining and sanitization
 */
export class HTMLProcessor implements IHTMLProcessor {
  /**
   * Process HTML template
   */
  process(html: string): string {
    // Basic processing - just return as is for now
    return html
  }

  /**
   * Inline CSS styles from <style> tags into elements
   */
  inlineStyles(html: string): string {
    // Extract style rules from <style> tags
    const styleRules = this.extractStyleRules(html)

    // Remove <style> tags from HTML
    let result = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

    // Apply styles to matching elements
    for (const [selector, styles] of styleRules) {
      result = this.applyStylesToSelector(result, selector, styles)
    }

    return result
  }

  /**
   * Sanitize HTML for email clients
   */
  sanitize(html: string): string {
    let result = html

    // Remove script tags and their content
    result = result.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')

    // Remove event handlers (onclick, onload, etc.)
    result = result.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
    result = result.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '')

    // Remove javascript: URLs
    result = result.replace(/href\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, 'href="#"')

    return result
  }

  /**
   * Extract CSS rules from <style> tags
   */
  private extractStyleRules(html: string): Map<string, string> {
    const rules = new Map<string, string>()
    const stylePattern = /<style[^>]*>([\s\S]*?)<\/style>/gi
    let match

    while ((match = stylePattern.exec(html)) !== null) {
      const css = match[1]
      // Parse CSS rules
      const rulePattern = /([^{]+)\s*\{\s*([^}]+)\s*\}/g
      let ruleMatch

      while ((ruleMatch = rulePattern.exec(css)) !== null) {
        const selector = ruleMatch[1].trim()
        const styles = ruleMatch[2].trim()
        rules.set(selector, styles)
      }
    }

    return rules
  }

  /**
   * Apply styles to elements matching a selector
   */
  private applyStylesToSelector(html: string, selector: string, styles: string): string {
    // Handle class selectors
    if (selector.startsWith('.')) {
      const className = selector.slice(1)
      // Match elements with this class
      const pattern = new RegExp(
        `(<[^>]+class\\s*=\\s*["'][^"']*\\b${this.escapeRegExp(className)}\\b[^"']*["'][^>]*)(>)`,
        'gi'
      )

      return html.replace(pattern, (match, before, after) => {
        // Check if element already has style attribute
        if (/style\s*=\s*["']/i.test(before)) {
          // Append to existing style
          return before.replace(
            /style\s*=\s*["']([^"']*)["']/i,
            `style="${styles}; $1"`
          ) + after
        } else {
          // Add style attribute
          return `${before} style="${styles}"${after}`
        }
      })
    }

    return html
  }

  /**
   * Escape special regex characters
   */
  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}

// =============================================================================
// TextGenerator Implementation
// =============================================================================

/**
 * Generate plain text from HTML
 */
export class TextGenerator implements ITextGenerator {
  /**
   * Convert HTML to plain text
   */
  generate(html: string): string {
    let text = html

    // Remove <style> and <script> tags and their content
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')

    // Convert common block elements to line breaks
    text = text.replace(/<\/p>/gi, '\n\n')
    text = text.replace(/<\/div>/gi, '\n')
    text = text.replace(/<br\s*\/?>/gi, '\n')
    text = text.replace(/<\/h[1-6]>/gi, '\n\n')

    // Convert headings - add emphasis
    text = text.replace(/<h1[^>]*>/gi, '\n')
    text = text.replace(/<h[2-6][^>]*>/gi, '\n')

    // Convert links: <a href="url">text</a> -> text (url)
    text = text.replace(
      /<a[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
      '$2 ($1)'
    )

    // Convert list items
    text = text.replace(/<li[^>]*>/gi, '- ')
    text = text.replace(/<\/li>/gi, '\n')
    text = text.replace(/<\/?[uo]l[^>]*>/gi, '\n')

    // Convert table cells
    text = text.replace(/<\/td>/gi, '\t')
    text = text.replace(/<\/tr>/gi, '\n')

    // Remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '')

    // Decode HTML entities
    text = this.decodeHtmlEntities(text)

    // Clean up whitespace
    text = text.replace(/\n\s*\n\s*\n/g, '\n\n') // Multiple blank lines to double
    text = text.replace(/\t+/g, '\t') // Multiple tabs to single
    text = text.trim()

    return text
  }

  /**
   * Decode common HTML entities
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
      '&copy;': '(c)',
      '&reg;': '(R)',
      '&trade;': '(TM)',
      '&mdash;': '--',
      '&ndash;': '-',
      '&hellip;': '...',
    }

    let result = text
    for (const [entity, char] of Object.entries(entities)) {
      result = result.replace(new RegExp(entity, 'gi'), char)
    }

    // Decode numeric entities
    result = result.replace(/&#(\d+);/g, (_, num) =>
      String.fromCharCode(parseInt(num, 10))
    )
    result = result.replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )

    return result
  }
}

// =============================================================================
// LocalizationManager Implementation
// =============================================================================

/**
 * Manage template translations and locale-specific formatting
 */
export class LocalizationManager implements ILocalizationManager {
  private translations: Map<string, Map<string, TranslationEntry>> = new Map()
  private config: LocaleConfig

  constructor(config: LocaleConfig) {
    this.config = config
  }

  /**
   * Get translated content for a locale
   */
  getTranslation(templateId: string, locale: string): TranslationEntry | null {
    const templateTranslations = this.translations.get(templateId)
    if (!templateTranslations) return null

    // Try exact locale first
    let translation = templateTranslations.get(locale)
    if (translation) return translation

    // Try base locale (e.g., 'en' from 'en-GB')
    const baseLang = locale.split('-')[0]
    translation = templateTranslations.get(baseLang)
    if (translation) return translation

    // Try fallback
    translation = templateTranslations.get(this.config.fallback)
    return translation || null
  }

  /**
   * Add translation for a template
   */
  addTranslation(templateId: string, locale: string, translation: TranslationEntry): void {
    if (!this.translations.has(templateId)) {
      this.translations.set(templateId, new Map())
    }
    this.translations.get(templateId)!.set(locale, translation)
  }

  /**
   * Format a date for a locale
   */
  formatDate(date: Date, locale: string, format?: string): string {
    const options: Intl.DateTimeFormatOptions = format === 'short'
      ? { dateStyle: 'short' }
      : format === 'long'
        ? { dateStyle: 'long' }
        : { year: 'numeric', month: 'numeric', day: 'numeric' }

    return new Intl.DateTimeFormat(locale, options).format(date)
  }

  /**
   * Format a number for a locale
   */
  formatNumber(number: number, locale: string, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(locale, options).format(number)
  }
}

// =============================================================================
// AttachmentHandler Implementation
// =============================================================================

/**
 * Handle email attachments
 */
export class AttachmentHandler implements IAttachmentHandler {
  private mimeTypes: Record<string, string> = {
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }

  /**
   * Add attachment and return processed result
   */
  add(attachment: Attachment): Attachment {
    const result = { ...attachment }

    // Auto-detect content type if not provided
    if (!result.contentType) {
      result.contentType = this.detectContentType(result.filename)
    }

    return result
  }

  /**
   * Validate attachment
   */
  validate(attachment: Attachment): boolean {
    if (!attachment.filename || attachment.filename.trim() === '') {
      return false
    }
    if (!attachment.content || (typeof attachment.content === 'string' && attachment.content.trim() === '')) {
      return false
    }
    if (!attachment.contentType || attachment.contentType.trim() === '') {
      return false
    }
    return true
  }

  /**
   * Get total size of attachments in bytes
   */
  getTotalSize(attachments: Attachment[]): number {
    return attachments.reduce((total, attachment) => {
      if (Buffer.isBuffer(attachment.content)) {
        return total + attachment.content.length
      } else if (typeof attachment.content === 'string') {
        // Assume base64 encoded - decode to get actual size
        try {
          return total + Buffer.from(attachment.content, 'base64').length
        } catch {
          return total + attachment.content.length
        }
      }
      return total
    }, 0)
  }

  /**
   * Detect content type from filename
   */
  private detectContentType(filename: string): string {
    const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'))
    return this.mimeTypes[ext] || 'application/octet-stream'
  }
}

// =============================================================================
// EmailTemplater Implementation
// =============================================================================

/**
 * Main email templater class
 */
export class EmailTemplater implements IEmailTemplater {
  private templates: Map<string, EmailTemplate> = new Map()
  private engine: TemplateEngine
  private htmlProcessor: HTMLProcessor
  private textGenerator: TextGenerator
  private localizationManager: LocalizationManager
  private attachmentHandler: AttachmentHandler
  private validator: VariableValidator

  constructor(config?: TemplateEngineConfig) {
    this.engine = new TemplateEngine(config)
    this.htmlProcessor = new HTMLProcessor()
    this.textGenerator = new TextGenerator()
    this.localizationManager = new LocalizationManager({
      locale: 'en-US',
      fallback: 'en',
      translations: {},
    })
    this.attachmentHandler = new AttachmentHandler()
    this.validator = new VariableValidator()
  }

  /**
   * Register a new email template
   */
  async register(template: EmailTemplate): Promise<void> {
    this.templates.set(template.id, {
      ...template,
      createdAt: template.createdAt || new Date(),
      updatedAt: new Date(),
    })
  }

  /**
   * Render a template with context
   */
  async render(
    templateId: string,
    context: TemplateContext,
    config?: EmailConfig
  ): Promise<RenderedEmail> {
    const template = await this.get(templateId)
    if (!template) {
      throw new Error(`Template "${templateId}" not found`)
    }

    // Check for localized version
    let subject = template.subject
    let html = template.html
    let text = template.text

    if (context.locale) {
      const translation = this.localizationManager.getTranslation(
        templateId,
        context.locale
      )
      if (translation) {
        if (translation.subject) subject = translation.subject
        if (translation.html) html = translation.html
        if (translation.text) text = translation.text
      }
    }

    // Render subject
    const renderedSubject = this.engine.render(subject, context.variables)

    // Render HTML
    let renderedHtml = this.engine.render(html, context.variables)
    renderedHtml = this.htmlProcessor.process(renderedHtml)

    // Generate or render text
    let renderedText: string
    if (text) {
      renderedText = this.engine.render(text, context.variables)
    } else {
      renderedText = this.textGenerator.generate(renderedHtml)
    }

    // Build rendered email
    const rendered: RenderedEmail = {
      to: '',
      from: config?.from || '',
      subject: renderedSubject,
      html: renderedHtml,
      text: renderedText,
    }

    // Add optional fields
    if (config?.replyTo) {
      rendered.replyTo = config.replyTo
    }
    if (config?.headers) {
      rendered.headers = config.headers
    }
    if (config?.defaultAttachments && config.defaultAttachments.length > 0) {
      rendered.attachments = config.defaultAttachments.map((a) =>
        this.attachmentHandler.add(a)
      )
    }

    return rendered
  }

  /**
   * Validate variables against template requirements
   */
  async validate(
    templateId: string,
    variables: Record<string, unknown>
  ): Promise<ValidationResult> {
    const template = await this.get(templateId)
    if (!template) {
      throw new Error(`Template "${templateId}" not found`)
    }

    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []

    // Validate each defined variable
    for (const varDef of template.variables) {
      const value = variables[varDef.name]
      const error = this.validator.validate(value, varDef)
      if (error) {
        errors.push(error)
      }
    }

    // Check for unused variables
    const definedVarNames = new Set(template.variables.map((v) => v.name))
    for (const key of Object.keys(variables)) {
      if (!definedVarNames.has(key)) {
        warnings.push({
          variable: key,
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
   * Preview a template without sending
   */
  async preview(
    templateId: string,
    context: TemplateContext,
    config?: EmailConfig
  ): Promise<PreviewResult> {
    const validation = await this.validate(templateId, context.variables)

    // Render even if validation fails (for preview purposes)
    const rendered = await this.render(templateId, context, config)

    // Calculate size
    const sizeBytes =
      rendered.subject.length +
      rendered.html.length +
      rendered.text.length +
      (rendered.attachments
        ? this.attachmentHandler.getTotalSize(rendered.attachments)
        : 0)

    return {
      rendered,
      validation,
      sizeBytes,
      isPreview: true,
      previewedAt: new Date(),
    }
  }

  /**
   * List all registered templates
   */
  async list(): Promise<TemplateListItem[]> {
    return Array.from(this.templates.values()).map((t) => ({
      id: t.id,
      name: t.name,
      variableCount: t.variables.length,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }))
  }

  /**
   * Get a template by ID
   */
  async get(templateId: string): Promise<EmailTemplate | null> {
    return this.templates.get(templateId) || null
  }

  /**
   * Delete a template
   */
  async delete(templateId: string): Promise<void> {
    this.templates.delete(templateId)
  }

  /**
   * Add a translation for a template
   */
  addTranslation(
    templateId: string,
    locale: string,
    translation: TranslationEntry
  ): void {
    this.localizationManager.addTranslation(templateId, locale, translation)
  }
}
