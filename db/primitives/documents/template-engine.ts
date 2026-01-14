/**
 * DocumentTemplateEngine - Template engine with merge fields for document generation
 *
 * Extends the notification TemplateEngine with:
 * - Document templates with IDs, names, and merge field definitions
 * - Template registration and versioning
 * - Field validation with types
 * - Sections and partials
 *
 * @module db/primitives/documents/template-engine
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Output escaping mode
 */
export type EscapeMode = 'none' | 'html' | 'markdown'

/**
 * Merge field type
 */
export type MergeFieldType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object'

/**
 * Merge field definition
 */
export interface MergeField {
  /** Field name (supports dot notation for nested paths) */
  name: string
  /** Field type for validation */
  type: MergeFieldType
  /** Whether the field is required */
  required: boolean
  /** Default value if not provided */
  defaultValue?: unknown
  /** Custom validation function */
  validate?: (value: unknown) => boolean
  /** Description for documentation */
  description?: string
}

/**
 * Template section
 */
export interface TemplateSection {
  /** Section ID */
  id: string
  /** Section content */
  content: string
  /** Optional condition for showing section */
  condition?: string
}

/**
 * Document template definition
 */
export interface DocumentTemplate {
  /** Unique template ID */
  id: string
  /** Human-readable name */
  name: string
  /** Template content with merge fields */
  content: string
  /** Merge field definitions */
  mergeFields: MergeField[]
  /** Optional sections */
  sections?: TemplateSection[]
  /** Template version */
  version?: number
  /** Template description */
  description?: string
  /** Created timestamp */
  createdAt?: Date
  /** Updated timestamp */
  updatedAt?: Date
}

/**
 * Template filter function
 */
export interface TemplateFilter {
  name: string
  fn: (value: unknown, ...args: unknown[]) => unknown
  description?: string
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean
  /** Missing required fields */
  missingFields?: string[]
  /** Type errors */
  typeErrors?: Array<{ field: string; expected: string; actual: string }>
  /** Custom validation errors */
  validationErrors?: Array<{ field: string; message: string }>
}

/**
 * Template engine configuration
 */
export interface TemplateEngineConfig {
  /** Opening delimiter (default: '{{') */
  openDelimiter?: string
  /** Closing delimiter (default: '}}') */
  closeDelimiter?: string
  /** Whether to escape by default */
  escapeByDefault?: EscapeMode
  /** Whether to throw on missing variables */
  throwOnMissing?: boolean
  /** Custom filters to register */
  filters?: TemplateFilter[]
  /** Enable template caching */
  cacheEnabled?: boolean
  /** Maximum cache size */
  maxCacheSize?: number
}

/**
 * Compiled template representation
 */
interface CompiledTemplate {
  source: string
  compiledAt: number
}

/**
 * Cache statistics
 */
export interface CacheStats {
  size: number
  maxSize: number
  enabled: boolean
}

// =============================================================================
// HTML Entity Escaping
// =============================================================================

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"'`=/]/g, (char) => HTML_ESCAPE_MAP[char] || char)
}

function escapeMarkdown(str: string): string {
  return str.replace(/([\\`*_{}[\]()#+\-.!|])/g, '\\$1')
}

function applyEscaping(value: string, mode: EscapeMode): string {
  switch (mode) {
    case 'html':
      return escapeHtml(value)
    case 'markdown':
      return escapeMarkdown(value)
    case 'none':
    default:
      return value
  }
}

// =============================================================================
// DocumentTemplateEngine Implementation
// =============================================================================

/**
 * Document template engine for generating documents with merge fields
 */
export class DocumentTemplateEngine {
  private templates: Map<string, DocumentTemplate> = new Map()
  private templateVersions: Map<string, Map<number, DocumentTemplate>> = new Map()
  private partials: Map<string, string> = new Map()
  private filters: Map<string, TemplateFilter> = new Map()
  private cache: Map<string, CompiledTemplate> = new Map()
  private config: Required<TemplateEngineConfig>

  constructor(config: TemplateEngineConfig = {}) {
    this.config = {
      openDelimiter: config.openDelimiter ?? '{{',
      closeDelimiter: config.closeDelimiter ?? '}}',
      escapeByDefault: config.escapeByDefault ?? 'none',
      throwOnMissing: config.throwOnMissing ?? false,
      filters: config.filters ?? [],
      cacheEnabled: config.cacheEnabled ?? true,
      maxCacheSize: config.maxCacheSize ?? 100,
    }

    // Register built-in filters
    this.registerBuiltinFilters()

    // Register custom filters
    for (const filter of this.config.filters) {
      this.registerFilter(filter)
    }
  }

  // ===========================================================================
  // Built-in Filters
  // ===========================================================================

  private registerBuiltinFilters(): void {
    // uppercase filter
    this.filters.set('uppercase', {
      name: 'uppercase',
      fn: (value) => String(value ?? '').toUpperCase(),
    })

    // lowercase filter
    this.filters.set('lowercase', {
      name: 'lowercase',
      fn: (value) => String(value ?? '').toLowerCase(),
    })

    // capitalize filter - capitalizes each word
    this.filters.set('capitalize', {
      name: 'capitalize',
      fn: (value) => {
        const str = String(value ?? '')
        return str
          .split(/\s+/)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ')
      },
    })

    // trim filter
    this.filters.set('trim', {
      name: 'trim',
      fn: (value) => String(value ?? '').trim(),
    })

    // currency filter
    this.filters.set('currency', {
      name: 'currency',
      fn: (value, currency: string = 'USD') => {
        const num = Number(value)
        if (isNaN(num)) return String(value)
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency,
        }).format(num)
      },
    })

    // date filter
    this.filters.set('date', {
      name: 'date',
      fn: (value, format?: string) => {
        const date = value instanceof Date ? value : new Date(String(value))
        if (isNaN(date.getTime())) return String(value)

        const opts: Intl.DateTimeFormatOptions =
          format === 'short'
            ? { dateStyle: 'short' }
            : format === 'long'
              ? { dateStyle: 'long' }
              : { year: 'numeric', month: 'short', day: 'numeric' }

        return new Intl.DateTimeFormat('en-US', opts).format(date)
      },
    })

    // number filter
    this.filters.set('number', {
      name: 'number',
      fn: (value, decimals?: number) => {
        const num = Number(value)
        if (isNaN(num)) return String(value)
        if (decimals !== undefined) {
          return num.toFixed(decimals)
        }
        return num.toLocaleString()
      },
    })

    // default filter
    this.filters.set('default', {
      name: 'default',
      fn: (value, defaultValue) => (value === undefined || value === null ? defaultValue : value),
    })
  }

  /**
   * Register a custom filter
   */
  registerFilter(filter: TemplateFilter): void {
    this.filters.set(filter.name, filter)
  }

  // ===========================================================================
  // Template Registration
  // ===========================================================================

  /**
   * Register a document template
   */
  registerTemplate(template: DocumentTemplate): void {
    const version = template.version ?? 1
    const templateWithMeta: DocumentTemplate = {
      ...template,
      version,
      createdAt: template.createdAt ?? new Date(),
      updatedAt: new Date(),
    }

    this.templates.set(template.id, templateWithMeta)

    // Store in version history
    if (!this.templateVersions.has(template.id)) {
      this.templateVersions.set(template.id, new Map())
    }
    this.templateVersions.get(template.id)!.set(version, templateWithMeta)

    // Register sections as partials if present
    if (template.sections) {
      for (const section of template.sections) {
        this.partials.set(section.id, section.content)
      }
    }

    // Clear cache for this template
    this.invalidateCache(template.id)
  }

  /**
   * Get a registered template
   */
  getTemplate(id: string): DocumentTemplate | undefined {
    return this.templates.get(id)
  }

  /**
   * Get a specific version of a template
   */
  getTemplateVersion(id: string, version: number): DocumentTemplate | undefined {
    return this.templateVersions.get(id)?.get(version)
  }

  /**
   * List all registered templates
   */
  listTemplates(): DocumentTemplate[] {
    return Array.from(this.templates.values())
  }

  /**
   * Delete a template
   */
  deleteTemplate(id: string): boolean {
    const existed = this.templates.has(id)
    this.templates.delete(id)
    this.templateVersions.delete(id)
    this.invalidateCache(id)
    return existed
  }

  // ===========================================================================
  // Partial Registration
  // ===========================================================================

  /**
   * Register a partial template
   */
  registerPartial(name: string, content: string): void {
    this.partials.set(name, content)
    this.clearCache()
  }

  /**
   * Get a registered partial
   */
  getPartial(name: string): string | undefined {
    return this.partials.get(name)
  }

  // ===========================================================================
  // Rendering
  // ===========================================================================

  /**
   * Render a template string with data
   */
  render(template: string, data: Record<string, unknown>): string {
    // Cache the compiled template
    this.compile(template)

    // Process template
    let result = template

    // Process triple braces first (unescaped output)
    result = this.processTripleBraces(result, data)

    // Process partials
    result = this.processPartials(result, data)

    // Process loops
    result = this.processLoops(result, data)

    // Process conditionals
    result = this.processConditionals(result, data)

    // Process variables with filters
    result = this.processVariables(result, data)

    return result
  }

  /**
   * Render a registered template by ID
   */
  renderTemplate(id: string, data: Record<string, unknown>): string {
    const template = this.templates.get(id)
    if (!template) {
      throw new Error(`Template not found: ${id}`)
    }

    // Apply default values from merge fields
    const dataWithDefaults = { ...data }
    for (const field of template.mergeFields) {
      if (dataWithDefaults[field.name] === undefined && field.defaultValue !== undefined) {
        dataWithDefaults[field.name] = field.defaultValue
      }
    }

    return this.render(template.content, dataWithDefaults)
  }

  // ===========================================================================
  // Triple Brace Processing (Unescaped)
  // ===========================================================================

  private processTripleBraces(template: string, data: Record<string, unknown>): string {
    // Match {{{variable}}} for unescaped output
    const pattern = /\{\{\{([a-zA-Z_][a-zA-Z0-9_.]*)\}\}\}/g

    return template.replace(pattern, (_match, varPath) => {
      const value = this.getValue(varPath, data)
      return String(value ?? '')
    })
  }

  // ===========================================================================
  // Partial Processing
  // ===========================================================================

  private processPartials(template: string, data: Record<string, unknown>): string {
    // Match {{> partialName}} or {{> partialName data=binding}}
    const pattern = /\{\{>\s*(\w+)(?:\s+([^}]+))?\}\}/g

    return template.replace(pattern, (_match, partialName, argsStr) => {
      const partial = this.partials.get(partialName)
      if (!partial) return ''

      // Parse arguments
      const partialData = { ...data }
      if (argsStr) {
        const argPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g
        let argMatch
        while ((argMatch = argPattern.exec(argsStr)) !== null) {
          const key = argMatch[1]
          const value = argMatch[2] ?? argMatch[3] ?? argMatch[4]
          if (key && value !== undefined) {
            // Check if value is a variable reference
            const resolved = this.getValue(value, data)
            if (resolved !== undefined) {
              // Spread object data into partial context
              if (typeof resolved === 'object' && resolved !== null) {
                Object.assign(partialData, resolved)
              } else {
                partialData[key] = resolved
              }
            }
          }
        }
      }

      return this.render(partial, partialData)
    })
  }

  // ===========================================================================
  // Loop Processing
  // ===========================================================================

  private processLoops(template: string, data: Record<string, unknown>): string {
    const openTag = '{{#each'
    const closeTag = '{{/each}}'

    let result = ''
    let pos = 0

    while (pos < template.length) {
      const openStart = template.indexOf(openTag, pos)
      if (openStart === -1) {
        result += template.slice(pos)
        break
      }

      result += template.slice(pos, openStart)

      const openEnd = template.indexOf('}}', openStart)
      if (openEnd === -1) {
        result += template.slice(openStart)
        break
      }

      const iterableName = template.slice(openStart + openTag.length, openEnd).trim()

      // Find matching close tag
      let depth = 1
      let searchPos = openEnd + 2
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
        result += template.slice(openStart, openEnd + 2)
        pos = openEnd + 2
        continue
      }

      const body = template.slice(openEnd + 2, bodyEnd)
      const iterable = this.getValue(iterableName, data)

      if (Array.isArray(iterable)) {
        for (let index = 0; index < iterable.length; index++) {
          const item = iterable[index]
          const loopData: Record<string, unknown> = {
            ...data,
            this: item,
            '@index': index,
            '@first': index === 0,
            '@last': index === iterable.length - 1,
          }

          // Spread object properties
          if (typeof item === 'object' && item !== null) {
            Object.assign(loopData, item)
          }

          result += this.render(body, loopData)
        }
      } else if (typeof iterable === 'object' && iterable !== null) {
        // Object iteration
        const entries = Object.entries(iterable)
        for (let index = 0; index < entries.length; index++) {
          const [key, value] = entries[index]
          const loopData: Record<string, unknown> = {
            ...data,
            this: value,
            '@key': key,
            '@index': index,
            '@first': index === 0,
            '@last': index === entries.length - 1,
          }
          result += this.render(body, loopData)
        }
      }

      pos = bodyEnd + closeTag.length
    }

    return result
  }

  // ===========================================================================
  // Conditional Processing
  // ===========================================================================

  private processConditionals(template: string, data: Record<string, unknown>): string {
    let result = template

    // Process #if blocks
    result = this.processIfBlocks(result, data)

    // Process #unless blocks
    result = this.processUnlessBlocks(result, data)

    return result
  }

  private processIfBlocks(template: string, data: Record<string, unknown>): string {
    const openTag = '{{#if'
    const closeTag = '{{/if}}'
    const elseTag = '{{else}}'

    let result = ''
    let pos = 0

    while (pos < template.length) {
      const openStart = template.indexOf(openTag, pos)
      if (openStart === -1) {
        result += template.slice(pos)
        break
      }

      result += template.slice(pos, openStart)

      const openEnd = template.indexOf('}}', openStart)
      if (openEnd === -1) {
        result += template.slice(openStart)
        break
      }

      const condition = template.slice(openStart + openTag.length, openEnd).trim()

      // Find matching close tag
      let depth = 1
      let searchPos = openEnd + 2
      let bodyEnd = -1
      let elsePos = -1

      while (depth > 0 && searchPos < template.length) {
        const nextOpen = template.indexOf(openTag, searchPos)
        const nextClose = template.indexOf(closeTag, searchPos)
        const nextElse = depth === 1 ? template.indexOf(elseTag, searchPos) : -1

        if (nextClose === -1) break

        // Track else at current depth
        if (
          nextElse !== -1 &&
          (nextOpen === -1 || nextElse < nextOpen) &&
          nextElse < nextClose &&
          elsePos === -1
        ) {
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
        result += template.slice(openStart, openEnd + 2)
        pos = openEnd + 2
        continue
      }

      // Extract if and else bodies
      let ifBody: string
      let elseBody: string

      if (elsePos !== -1 && elsePos < bodyEnd) {
        ifBody = template.slice(openEnd + 2, elsePos)
        elseBody = template.slice(elsePos + elseTag.length, bodyEnd)
      } else {
        ifBody = template.slice(openEnd + 2, bodyEnd)
        elseBody = ''
      }

      // Evaluate condition
      const value = this.getValue(condition, data)
      const isTruthy = this.isTruthy(value)

      result += this.render(isTruthy ? ifBody : elseBody, data)
      pos = bodyEnd + closeTag.length
    }

    return result
  }

  private processUnlessBlocks(template: string, data: Record<string, unknown>): string {
    const openTag = '{{#unless'
    const closeTag = '{{/unless}}'

    let result = ''
    let pos = 0

    while (pos < template.length) {
      const openStart = template.indexOf(openTag, pos)
      if (openStart === -1) {
        result += template.slice(pos)
        break
      }

      result += template.slice(pos, openStart)

      const openEnd = template.indexOf('}}', openStart)
      if (openEnd === -1) {
        result += template.slice(openStart)
        break
      }

      const condition = template.slice(openStart + openTag.length, openEnd).trim()

      // Find matching close tag
      let depth = 1
      let searchPos = openEnd + 2
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
        result += template.slice(openStart, openEnd + 2)
        pos = openEnd + 2
        continue
      }

      const body = template.slice(openEnd + 2, bodyEnd)
      const value = this.getValue(condition, data)
      const isTruthy = this.isTruthy(value)

      result += isTruthy ? '' : this.render(body, data)
      pos = bodyEnd + closeTag.length
    }

    return result
  }

  // ===========================================================================
  // Variable Processing
  // ===========================================================================

  private processVariables(template: string, data: Record<string, unknown>): string {
    const escapeMode = this.config.escapeByDefault

    // Match {{variable}}, {{variable | filter}}, {{variable | filter:arg}}
    const pattern = /\{\{\s*([a-zA-Z_@][a-zA-Z0-9_.]*)\s*(?:\|\s*([^}]+))?\s*\}\}/g

    return template.replace(pattern, (match, varPath, filterStr) => {
      let value = this.getValue(varPath, data)

      // Apply filters
      if (filterStr) {
        const filters = this.parseFilters(filterStr)
        for (const { name, args } of filters) {
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

      // Handle missing values
      if (value === undefined) {
        if (this.config.throwOnMissing) {
          throw new Error(`Missing variable: ${varPath}`)
        }
        return ''
      }

      // Apply escaping
      const str = String(value ?? '')
      return escapeMode === 'none' ? str : applyEscaping(str, escapeMode)
    })
  }

  // ===========================================================================
  // Field Extraction
  // ===========================================================================

  /**
   * Extract all merge field names from a template
   */
  extractFields(template: string): string[] {
    const fields = new Set<string>()

    // Simple variables: {{name}}, {{user.name}}
    const varPattern = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\|[^}]*)?\}\}/g
    let match
    while ((match = varPattern.exec(template)) !== null) {
      fields.add(match[1]!)
    }

    // Triple braces: {{{content}}}
    const triplePattern = /\{\{\{([a-zA-Z_][a-zA-Z0-9_.]*)\}\}\}/g
    while ((match = triplePattern.exec(template)) !== null) {
      fields.add(match[1]!)
    }

    // Loop variables: {{#each items}}
    const eachPattern = /\{\{#each\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g
    while ((match = eachPattern.exec(template)) !== null) {
      fields.add(match[1]!)
    }

    // Conditionals: {{#if condition}}, {{#unless condition}}
    const condPattern = /\{\{#(?:if|unless)\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g
    while ((match = condPattern.exec(template)) !== null) {
      fields.add(match[1]!)
    }

    return Array.from(fields)
  }

  // ===========================================================================
  // Validation
  // ===========================================================================

  /**
   * Validate data against a template's merge field definitions
   */
  validateData(templateId: string, data: Record<string, unknown>): ValidationResult {
    const template = this.templates.get(templateId)
    if (!template) {
      return { valid: false, missingFields: [], typeErrors: [], validationErrors: [{ field: '', message: `Template not found: ${templateId}` }] }
    }

    const missingFields: string[] = []
    const typeErrors: Array<{ field: string; expected: string; actual: string }> = []
    const validationErrors: Array<{ field: string; message: string }> = []

    for (const field of template.mergeFields) {
      const value = this.getValue(field.name, data)

      // Check required
      if (field.required && (value === undefined || value === null)) {
        missingFields.push(field.name)
        continue
      }

      // Skip type/custom validation for optional missing fields
      if (value === undefined || value === null) {
        continue
      }

      // Type validation
      const actualType = this.getValueType(value)
      if (!this.isTypeCompatible(field.type, actualType, value)) {
        typeErrors.push({
          field: field.name,
          expected: field.type,
          actual: actualType,
        })
        continue
      }

      // Custom validation
      if (field.validate && !field.validate(value)) {
        validationErrors.push({
          field: field.name,
          message: 'Custom validation failed',
        })
      }
    }

    return {
      valid: missingFields.length === 0 && typeErrors.length === 0 && validationErrors.length === 0,
      missingFields: missingFields.length > 0 ? missingFields : undefined,
      typeErrors: typeErrors.length > 0 ? typeErrors : undefined,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    }
  }

  private getValueType(value: unknown): string {
    if (Array.isArray(value)) return 'array'
    if (value instanceof Date) return 'date'
    return typeof value
  }

  private isTypeCompatible(expected: MergeFieldType, actual: string, value: unknown): boolean {
    if (expected === actual) return true

    // Date can be a string in ISO format or a Date object
    if (expected === 'date') {
      if (value instanceof Date) return true
      if (typeof value === 'string') {
        const date = new Date(value)
        return !isNaN(date.getTime())
      }
      return false
    }

    // Object type
    if (expected === 'object') {
      return actual === 'object' && !Array.isArray(value) && value !== null
    }

    return false
  }

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  private compile(template: string): CompiledTemplate {
    const cacheKey = this.getCacheKey(template)

    if (this.config.cacheEnabled && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!
    }

    const compiled: CompiledTemplate = {
      source: template,
      compiledAt: Date.now(),
    }

    if (this.config.cacheEnabled) {
      this.addToCache(cacheKey, compiled)
    }

    return compiled
  }

  private getCacheKey(template: string): string {
    let hash = 0
    for (let i = 0; i < template.length; i++) {
      const char = template.charCodeAt(i)
      hash = ((hash << 5) - hash + char) | 0
    }
    return `doc_tmpl_${hash}`
  }

  private addToCache(key: string, compiled: CompiledTemplate): void {
    if (this.cache.size >= this.config.maxCacheSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, compiled)
  }

  private invalidateCache(templateId: string): void {
    // For now, just clear the entire cache when a template changes
    // A more sophisticated implementation would track dependencies
    const template = this.templates.get(templateId)
    if (template) {
      const key = this.getCacheKey(template.content)
      this.cache.delete(key)
    }
  }

  /**
   * Clear all cached templates
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return {
      size: this.cache.size,
      maxSize: this.config.maxCacheSize,
      enabled: this.config.cacheEnabled,
    }
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  private getValue(path: string, data: Record<string, unknown>): unknown {
    // Handle special loop variables
    if (path === 'this' || path.startsWith('@')) {
      return data[path]
    }

    const parts = path.split('.')
    let current: unknown = data

    for (const part of parts) {
      if (current === undefined || current === null) return undefined
      if (typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  private isTruthy(value: unknown): boolean {
    if (value === undefined || value === null) return false
    if (value === false) return false
    if (value === 0) return false
    if (value === '') return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
  }

  private parseFilters(filterStr: string): Array<{ name: string; args: unknown[] }> {
    const filters: Array<{ name: string; args: unknown[] }> = []
    const parts = filterStr.split('|')

    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed) continue

      const colonIndex = trimmed.indexOf(':')
      if (colonIndex === -1) {
        filters.push({ name: trimmed, args: [] })
      } else {
        const name = trimmed.slice(0, colonIndex)
        const argsStr = trimmed.slice(colonIndex + 1)

        const args: unknown[] = []
        const argPattern = /"([^"]*)"|'([^']*)'|([^\s:"']+)/g
        let match
        while ((match = argPattern.exec(argsStr)) !== null) {
          if (match[1] !== undefined) {
            args.push(match[1])
          } else if (match[2] !== undefined) {
            args.push(match[2])
          } else if (match[3]) {
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
   * Dispose of the engine and clear resources
   */
  dispose(): void {
    this.templates.clear()
    this.templateVersions.clear()
    this.partials.clear()
    this.filters.clear()
    this.cache.clear()
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new DocumentTemplateEngine instance
 */
export function createTemplateEngine(config?: TemplateEngineConfig): DocumentTemplateEngine {
  return new DocumentTemplateEngine(config)
}

// =============================================================================
// Default Export
// =============================================================================

export default DocumentTemplateEngine
