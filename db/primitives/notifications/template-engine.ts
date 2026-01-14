/**
 * TemplateEngine - Handlebars/Liquid-style template rendering
 *
 * Provides template rendering with:
 * - Variable injection ({{variable}}, {{nested.path}})
 * - Conditionals ({{#if condition}}...{{else}}...{{/if}}, {{#unless}})
 * - Loops ({{#each array}}...{{/each}})
 * - Partials/includes support
 * - Output escaping (HTML, text, Markdown)
 * - Template caching and compilation optimization
 *
 * @example
 * ```typescript
 * import { createTemplateEngine, TemplateEngine } from 'db/primitives/notifications/template-engine'
 *
 * const engine = createTemplateEngine()
 *
 * // Register a partial
 * engine.registerPartial('header', '<header>{{title}}</header>')
 *
 * // Render a template
 * const result = engine.render('Hello {{name}}!', { name: 'World' })
 *
 * // Render with escaping
 * const html = engine.render('{{html}}', { html: '<script>alert(1)</script>' }, { escape: 'html' })
 * ```
 *
 * @module db/primitives/notifications/template-engine
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Output escaping mode
 */
export type EscapeMode = 'none' | 'html' | 'text' | 'markdown'

/**
 * Template helper function
 */
export interface TemplateHelper {
  name: string
  fn: (value: unknown, ...args: unknown[]) => unknown
  description?: string
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
 * Compiled template representation
 */
export interface CompiledTemplate {
  source: string
  compiledAt: number
  ast?: TemplateNode[]
}

/**
 * Template AST node types
 */
export type TemplateNodeType = 'text' | 'variable' | 'if' | 'unless' | 'each' | 'partial'

/**
 * Template AST node
 */
export interface TemplateNode {
  type: TemplateNodeType
  value?: string
  condition?: string
  body?: TemplateNode[]
  elseBody?: TemplateNode[]
  varPath?: string
  filters?: Array<{ name: string; args: unknown[] }>
  partialName?: string
  partialArgs?: Record<string, string>
}

/**
 * Template engine configuration
 */
export interface TemplateEngineConfig {
  /** Opening delimiter (default: '{{') */
  openDelimiter?: string
  /** Closing delimiter (default: '}}') */
  closeDelimiter?: string
  /** Whether to escape HTML by default */
  escapeByDefault?: EscapeMode
  /** Whether to throw on missing variables */
  throwOnMissing?: boolean
  /** Custom helpers to register */
  helpers?: TemplateHelper[]
  /** Custom filters to register */
  filters?: TemplateFilter[]
  /** Enable template caching */
  cacheEnabled?: boolean
  /** Maximum cache size (number of templates) */
  maxCacheSize?: number
}

/**
 * Render options
 */
export interface RenderOptions {
  /** Escape mode for output */
  escape?: EscapeMode
  /** Additional partials for this render */
  partials?: Record<string, string>
}

/**
 * Template engine options
 */
export type TemplateEngineOptions = TemplateEngineConfig

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

function escapeText(str: string): string {
  // For plain text, strip HTML tags and decode entities
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function escapeMarkdown(str: string): string {
  // Escape Markdown special characters
  return str.replace(/([\\`*_{}[\]()#+\-.!|])/g, '\\$1')
}

function applyEscaping(value: string, mode: EscapeMode): string {
  switch (mode) {
    case 'html':
      return escapeHtml(value)
    case 'text':
      return escapeText(value)
    case 'markdown':
      return escapeMarkdown(value)
    case 'none':
    default:
      return value
  }
}

// =============================================================================
// TemplateEngine Implementation
// =============================================================================

/**
 * Template engine for rendering Handlebars/Liquid-style templates
 */
export class TemplateEngine {
  private helpers: Map<string, TemplateHelper> = new Map()
  private filters: Map<string, TemplateFilter> = new Map()
  private partials: Map<string, string> = new Map()
  private cache: Map<string, CompiledTemplate> = new Map()
  private config: Required<TemplateEngineConfig>

  constructor(config: TemplateEngineConfig = {}) {
    this.config = {
      openDelimiter: config.openDelimiter ?? '{{',
      closeDelimiter: config.closeDelimiter ?? '}}',
      escapeByDefault: config.escapeByDefault ?? 'none',
      throwOnMissing: config.throwOnMissing ?? false,
      helpers: config.helpers ?? [],
      filters: config.filters ?? [],
      cacheEnabled: config.cacheEnabled ?? true,
      maxCacheSize: config.maxCacheSize ?? 100,
    }

    // Register built-in helpers
    this.registerBuiltinHelpers()

    // Register built-in filters
    this.registerBuiltinFilters()

    // Register custom helpers
    for (const helper of this.config.helpers) {
      this.registerHelper(helper)
    }

    // Register custom filters
    for (const filter of this.config.filters) {
      this.registerFilter(filter)
    }
  }

  // ===========================================================================
  // Built-in Helpers
  // ===========================================================================

  private registerBuiltinHelpers(): void {
    // uppercase helper
    this.helpers.set('uppercase', {
      name: 'uppercase',
      fn: (value) => String(value ?? '').toUpperCase(),
    })

    // lowercase helper
    this.helpers.set('lowercase', {
      name: 'lowercase',
      fn: (value) => String(value ?? '').toLowerCase(),
    })

    // capitalize helper
    this.helpers.set('capitalize', {
      name: 'capitalize',
      fn: (value) => {
        const str = String(value ?? '')
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
      },
    })

    // truncate helper
    this.helpers.set('truncate', {
      name: 'truncate',
      fn: (value, length: number = 50, suffix: string = '...') => {
        const str = String(value ?? '')
        if (str.length <= length) return str
        return str.slice(0, length) + suffix
      },
    })

    // formatDate helper
    this.helpers.set('formatDate', {
      name: 'formatDate',
      fn: (value, format?: string, locale?: string) => {
        const date = value instanceof Date ? value : new Date(String(value))
        if (isNaN(date.getTime())) return String(value)

        const opts: Intl.DateTimeFormatOptions =
          format === 'short'
            ? { dateStyle: 'short' }
            : format === 'long'
              ? { dateStyle: 'long' }
              : format === 'full'
                ? { dateStyle: 'full' }
                : { year: 'numeric', month: 'short', day: 'numeric' }

        return new Intl.DateTimeFormat(locale ?? 'en-US', opts).format(date)
      },
    })

    // formatNumber helper
    this.helpers.set('formatNumber', {
      name: 'formatNumber',
      fn: (value, locale?: string) => {
        const num = Number(value)
        if (isNaN(num)) return String(value)
        return new Intl.NumberFormat(locale ?? 'en-US').format(num)
      },
    })

    // formatCurrency helper
    this.helpers.set('formatCurrency', {
      name: 'formatCurrency',
      fn: (value, currency: string = 'USD', locale?: string) => {
        const num = Number(value)
        if (isNaN(num)) return String(value)
        return new Intl.NumberFormat(locale ?? 'en-US', {
          style: 'currency',
          currency,
        }).format(num)
      },
    })

    // join helper
    this.helpers.set('join', {
      name: 'join',
      fn: (value, separator: string = ', ') => {
        if (!Array.isArray(value)) return String(value ?? '')
        return value.join(separator)
      },
    })

    // first helper
    this.helpers.set('first', {
      name: 'first',
      fn: (value) => {
        if (Array.isArray(value)) return value[0]
        return value
      },
    })

    // last helper
    this.helpers.set('last', {
      name: 'last',
      fn: (value) => {
        if (Array.isArray(value)) return value[value.length - 1]
        return value
      },
    })

    // length helper
    this.helpers.set('length', {
      name: 'length',
      fn: (value) => {
        if (Array.isArray(value)) return value.length
        if (typeof value === 'string') return value.length
        return 0
      },
    })
  }

  // ===========================================================================
  // Built-in Filters
  // ===========================================================================

  private registerBuiltinFilters(): void {
    // default filter
    this.filters.set('default', {
      name: 'default',
      fn: (value, defaultValue) => (value === undefined || value === null ? defaultValue : value),
    })

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

    // capitalize filter
    this.filters.set('capitalize', {
      name: 'capitalize',
      fn: (value) => {
        const str = String(value ?? '')
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
      },
    })

    // trim filter
    this.filters.set('trim', {
      name: 'trim',
      fn: (value) => String(value ?? '').trim(),
    })

    // truncate filter
    this.filters.set('truncate', {
      name: 'truncate',
      fn: (value, length: number = 50, suffix: string = '...') => {
        const str = String(value ?? '')
        if (str.length <= length) return str
        return str.slice(0, length) + suffix
      },
    })

    // replace filter
    this.filters.set('replace', {
      name: 'replace',
      fn: (value, search: string, replacement: string = '') => {
        return String(value ?? '').replace(new RegExp(search, 'g'), replacement)
      },
    })

    // split filter
    this.filters.set('split', {
      name: 'split',
      fn: (value, separator: string = ',') => {
        return String(value ?? '').split(separator)
      },
    })

    // join filter
    this.filters.set('join', {
      name: 'join',
      fn: (value, separator: string = ', ') => {
        if (!Array.isArray(value)) return String(value ?? '')
        return value.join(separator)
      },
    })

    // first filter
    this.filters.set('first', {
      name: 'first',
      fn: (value) => {
        if (Array.isArray(value)) return value[0]
        if (typeof value === 'string') return value[0]
        return value
      },
    })

    // last filter
    this.filters.set('last', {
      name: 'last',
      fn: (value) => {
        if (Array.isArray(value)) return value[value.length - 1]
        if (typeof value === 'string') return value[value.length - 1]
        return value
      },
    })

    // escape filter
    this.filters.set('escape', {
      name: 'escape',
      fn: (value, mode: EscapeMode = 'html') => {
        return applyEscaping(String(value ?? ''), mode)
      },
    })

    // raw filter (no escaping)
    this.filters.set('raw', {
      name: 'raw',
      fn: (value) => value,
    })

    // json filter
    this.filters.set('json', {
      name: 'json',
      fn: (value) => JSON.stringify(value),
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

    // pluralize filter
    this.filters.set('pluralize', {
      name: 'pluralize',
      fn: (value, singular: string, plural: string) => {
        const num = Number(value)
        return num === 1 ? singular : plural
      },
    })

    // slice filter
    this.filters.set('slice', {
      name: 'slice',
      fn: (value, start: number = 0, end?: number) => {
        if (Array.isArray(value)) return value.slice(start, end)
        if (typeof value === 'string') return value.slice(start, end)
        return value
      },
    })

    // reverse filter
    this.filters.set('reverse', {
      name: 'reverse',
      fn: (value) => {
        if (Array.isArray(value)) return [...value].reverse()
        if (typeof value === 'string') return value.split('').reverse().join('')
        return value
      },
    })

    // sort filter
    this.filters.set('sort', {
      name: 'sort',
      fn: (value, key?: string) => {
        if (!Array.isArray(value)) return value
        const arr = [...value]
        if (key) {
          return arr.sort((a, b) => {
            const aVal = a?.[key]
            const bVal = b?.[key]
            if (typeof aVal === 'string' && typeof bVal === 'string') {
              return aVal.localeCompare(bVal)
            }
            return (aVal ?? 0) - (bVal ?? 0)
          })
        }
        return arr.sort()
      },
    })

    // size/length filter
    this.filters.set('size', {
      name: 'size',
      fn: (value) => {
        if (Array.isArray(value)) return value.length
        if (typeof value === 'string') return value.length
        if (typeof value === 'object' && value !== null) return Object.keys(value).length
        return 0
      },
    })

    // keys filter
    this.filters.set('keys', {
      name: 'keys',
      fn: (value) => {
        if (typeof value === 'object' && value !== null) return Object.keys(value)
        return []
      },
    })

    // values filter
    this.filters.set('values', {
      name: 'values',
      fn: (value) => {
        if (typeof value === 'object' && value !== null) return Object.values(value)
        return []
      },
    })
  }

  // ===========================================================================
  // Helper & Filter Registration
  // ===========================================================================

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
   * Get a registered helper
   */
  getHelper(name: string): TemplateHelper | undefined {
    return this.helpers.get(name)
  }

  /**
   * Get a registered filter
   */
  getFilter(name: string): TemplateFilter | undefined {
    return this.filters.get(name)
  }

  // ===========================================================================
  // Partial Registration
  // ===========================================================================

  /**
   * Register a partial template
   */
  registerPartial(name: string, template: string): void {
    this.partials.set(name, template)
    // Invalidate cache entries that might use this partial
    if (this.config.cacheEnabled) {
      // For simplicity, clear the entire cache when partials change
      // A more sophisticated implementation would track partial dependencies
      this.cache.clear()
    }
  }

  /**
   * Get a registered partial
   */
  getPartial(name: string): string | undefined {
    return this.partials.get(name)
  }

  /**
   * Remove a partial
   */
  removePartial(name: string): void {
    this.partials.delete(name)
    if (this.config.cacheEnabled) {
      this.cache.clear()
    }
  }

  // ===========================================================================
  // Template Compilation & Caching
  // ===========================================================================

  /**
   * Compile a template for later use
   */
  compile(template: string): CompiledTemplate {
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

  /**
   * Get a compiled template from cache
   */
  getCompiled(template: string): CompiledTemplate | undefined {
    const cacheKey = this.getCacheKey(template)
    return this.cache.get(cacheKey)
  }

  /**
   * Clear the template cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; enabled: boolean } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxCacheSize,
      enabled: this.config.cacheEnabled,
    }
  }

  private getCacheKey(template: string): string {
    // Simple hash function for cache keys
    let hash = 0
    for (let i = 0; i < template.length; i++) {
      const char = template.charCodeAt(i)
      hash = ((hash << 5) - hash + char) | 0
    }
    return `tmpl_${hash}`
  }

  private addToCache(key: string, compiled: CompiledTemplate): void {
    // Evict oldest entries if cache is full
    if (this.cache.size >= this.config.maxCacheSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, compiled)
  }

  // ===========================================================================
  // Main Render Method
  // ===========================================================================

  /**
   * Render a template with variables
   */
  render(template: string, variables: Record<string, unknown>, options?: RenderOptions): string {
    const escapeMode = options?.escape ?? this.config.escapeByDefault

    // Merge partials from options
    const mergedPartials = new Map(this.partials)
    if (options?.partials) {
      for (const [name, partial] of Object.entries(options.partials)) {
        mergedPartials.set(name, partial)
      }
    }

    // Compile (or get from cache)
    this.compile(template)

    // Process template
    let result = template

    // Process partials first ({{> partialName}})
    result = this.processPartials(result, variables, mergedPartials)

    // Process loops ({{#each array}}...{{/each}})
    result = this.processLoops(result, variables)

    // Process conditionals ({{#if condition}}...{{else}}...{{/if}}, {{#unless}})
    result = this.processConditionals(result, variables)

    // Process helpers ({{helperName arg1 arg2}})
    result = this.processHelpers(result, variables)

    // Process variable substitutions with filters ({{variable}}, {{variable|filter}})
    result = this.processVariables(result, variables, escapeMode)

    return result
  }

  // ===========================================================================
  // Partial Processing
  // ===========================================================================

  private processPartials(
    template: string,
    variables: Record<string, unknown>,
    partials: Map<string, string>
  ): string {
    const openDelim = this.config.openDelimiter
    const closeDelim = this.config.closeDelimiter

    // Match {{> partialName}} or {{> partialName arg1=value1}}
    const pattern = new RegExp(
      `${this.escapeRegExp(openDelim)}>\\s*(\\w+)(?:\\s+([^}]+))?${this.escapeRegExp(closeDelim)}`,
      'g'
    )

    return template.replace(pattern, (match, partialName, argsStr) => {
      const partial = partials.get(partialName)
      if (!partial) return match

      // Parse arguments
      const partialVars = { ...variables }
      if (argsStr) {
        const argPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g
        let argMatch
        while ((argMatch = argPattern.exec(argsStr)) !== null) {
          const key = argMatch[1]
          // argMatch[2] = double quoted, argMatch[3] = single quoted, argMatch[4] = unquoted
          const isQuoted = argMatch[2] !== undefined || argMatch[3] !== undefined
          const value = argMatch[2] ?? argMatch[3] ?? argMatch[4]
          if (key && value !== undefined) {
            // Quoted values are always literals, unquoted are variable references
            if (isQuoted) {
              partialVars[key] = value
            } else if (value.match(/^\w+(?:\.\w+)*$/)) {
              // Unquoted - treat as variable reference
              const resolved = this.getValue(value, variables)
              partialVars[key] = resolved !== undefined ? resolved : value
            } else {
              partialVars[key] = value
            }
          }
        }
      }

      // Recursively render the partial
      return this.render(partial, partialVars)
    })
  }

  // ===========================================================================
  // Loop Processing
  // ===========================================================================

  private processLoops(template: string, variables: Record<string, unknown>): string {
    return this.processBlock(template, 'each', (arrayName, body) => {
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
            '@length': array.length,
          }

          // If item is an object, spread its properties
          if (typeof item === 'object' && item !== null) {
            Object.assign(loopVars, item)
          }

          // Recursively render nested content
          return this.render(body, loopVars)
        })
        .join('')
    })
  }

  // ===========================================================================
  // Conditional Processing
  // ===========================================================================

  private processConditionals(template: string, variables: Record<string, unknown>): string {
    let result = template

    // Process #if blocks (with optional else)
    result = this.processIfBlock(result, variables)

    // Process #unless blocks
    result = this.processBlock(result, 'unless', (condition, body) => {
      const value = this.getValue(condition, variables)
      const isTruthy = this.isTruthy(value)
      return !isTruthy ? this.render(body, variables) : ''
    })

    return result
  }

  private processIfBlock(template: string, variables: Record<string, unknown>): string {
    const openDelim = this.config.openDelimiter
    const closeDelim = this.config.closeDelimiter
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

      result += template.slice(pos, openStart)

      const openEnd = template.indexOf(closeDelim, openStart)
      if (openEnd === -1) {
        result += template.slice(openStart)
        break
      }

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

      // Process the appropriate branch
      const content = isTruthy ? ifBody : elseBody
      result += this.render(content, variables)

      pos = bodyEnd + closeTag.length
    }

    return result
  }

  // ===========================================================================
  // Helper Processing
  // ===========================================================================

  private processHelpers(template: string, variables: Record<string, unknown>): string {
    const open = this.escapeRegExp(this.config.openDelimiter)
    const close = this.escapeRegExp(this.config.closeDelimiter)

    // Match {{helperName arg1 "arg2"}} but NOT {{#if}}, {{/if}}, {{>partial}}, etc.
    const pattern = new RegExp(`${open}\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\s+([^}#/>]+?)\\s*${close}`, 'g')

    return template.replace(pattern, (match, helperName, argsStr) => {
      const helper = this.helpers.get(helperName)
      if (!helper) return match // Not a helper, leave as is

      // Parse arguments
      const args = this.parseHelperArgs(argsStr, variables)
      if (args.length === 0) return match

      try {
        const result = helper.fn(args[0], ...args.slice(1))
        return String(result ?? '')
      } catch {
        return match
      }
    })
  }

  // ===========================================================================
  // Variable Processing
  // ===========================================================================

  private processVariables(
    template: string,
    variables: Record<string, unknown>,
    escapeMode: EscapeMode
  ): string {
    const open = this.escapeRegExp(this.config.openDelimiter)
    const close = this.escapeRegExp(this.config.closeDelimiter)

    // Match {{variable}}, {{variable|filter}}, {{variable|filter:"arg"}}
    const pattern = new RegExp(`${open}\\s*([a-zA-Z_@][a-zA-Z0-9_.]*)(?:\\|([^}]+))?\\s*${close}`, 'g')

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
          } else if (name === 'raw') {
            // raw filter disables escaping
            continue
          } else if (name === 'escape') {
            // escape filter applies specific escaping
            value = applyEscaping(String(value ?? ''), (args[0] as EscapeMode) ?? 'html')
            continue
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

      // If value is still undefined
      if (value === undefined) {
        if (this.config.throwOnMissing) {
          throw new Error(`Missing variable: ${varPath}`)
        }
        return match // Keep original placeholder
      }

      // Check if raw filter was applied
      const hasRawFilter = filterStr?.includes('raw')
      if (hasRawFilter || escapeMode === 'none') {
        return String(value ?? '')
      }

      return applyEscaping(String(value ?? ''), escapeMode)
    })
  }

  // ===========================================================================
  // Block Processing Utility
  // ===========================================================================

  private processBlock(
    template: string,
    blockType: string,
    processor: (param: string, body: string) => string
  ): string {
    const openDelim = this.config.openDelimiter
    const closeDelim = this.config.closeDelimiter
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

      result += template.slice(pos, openStart)

      const openEnd = template.indexOf(closeDelim, openStart)
      if (openEnd === -1) {
        result += template.slice(openStart)
        break
      }

      const tagContent = template.slice(openStart + openTag.length, openEnd).trim()
      const param = tagContent.split(/\s+/)[0] ?? ''

      // Find matching close tag, accounting for nesting
      let depth = 1
      let searchPos = openEnd + closeDelim.length
      let bodyEnd = -1

      while (depth > 0 && searchPos < template.length) {
        const nextOpen = template.indexOf(openTag, searchPos)
        const nextClose = template.indexOf(closeTag, searchPos)

        if (nextClose === -1) {
          break
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
        result += template.slice(openStart, openEnd + closeDelim.length)
        pos = openEnd + closeDelim.length
        continue
      }

      const body = template.slice(openEnd + closeDelim.length, bodyEnd)
      result += processor(param, body)
      pos = bodyEnd + closeTag.length
    }

    return result
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

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
   * Escape special regex characters
   */
  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  // ===========================================================================
  // Variable Extraction
  // ===========================================================================

  /**
   * Extract variable names from a template
   */
  extractVariables(template: string): string[] {
    const variables: Set<string> = new Set()
    const open = this.escapeRegExp(this.config.openDelimiter)
    const close = this.escapeRegExp(this.config.closeDelimiter)

    // Match simple variables: {{variable}} or {{nested.path}}
    const simplePattern = new RegExp(`${open}\\s*([a-zA-Z_][a-zA-Z0-9_.]*)\\s*(?:\\|[^}]*)?${close}`, 'g')
    let match
    while ((match = simplePattern.exec(template)) !== null) {
      variables.add(match[1]!)
    }

    // Match loop variables: {{#each items}}
    const loopPattern = new RegExp(`${open}#each\\s+([a-zA-Z_][a-zA-Z0-9_.]*)\\s*${close}`, 'g')
    while ((match = loopPattern.exec(template)) !== null) {
      variables.add(match[1]!)
    }

    // Match conditional variables: {{#if condition}}, {{#unless condition}}
    const condPattern = new RegExp(`${open}#(?:if|unless)\\s+([a-zA-Z_][a-zA-Z0-9_.]*)\\s*${close}`, 'g')
    while ((match = condPattern.exec(template)) !== null) {
      variables.add(match[1]!)
    }

    return Array.from(variables)
  }

  // ===========================================================================
  // Dispose
  // ===========================================================================

  /**
   * Dispose of the template engine and clear resources
   */
  dispose(): void {
    this.helpers.clear()
    this.filters.clear()
    this.partials.clear()
    this.cache.clear()
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new TemplateEngine instance
 */
export function createTemplateEngine(config?: TemplateEngineConfig): TemplateEngine {
  return new TemplateEngine(config)
}

// =============================================================================
// Default Export
// =============================================================================

export default TemplateEngine
