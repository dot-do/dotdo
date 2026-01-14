/**
 * TemplateEngine Tests - TDD GREEN Phase
 *
 * Tests for the TemplateEngine class covering:
 * - Variable injection ({{variable}}, {{nested.path}})
 * - Conditionals ({{#if condition}}...{{else}}...{{/if}}, {{#unless}})
 * - Loops ({{#each array}}...{{/each}})
 * - Partials support ({{> partialName}})
 * - Output escaping (HTML, text, Markdown)
 * - Template caching and compilation
 * - Custom helpers and filters
 *
 * @module db/primitives/notifications/tests/template-engine
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTemplateEngine,
  TemplateEngine,
  type TemplateEngineConfig,
  type EscapeMode,
} from '../template-engine'

// =============================================================================
// Factory Tests
// =============================================================================

describe('TemplateEngine Factory', () => {
  describe('createTemplateEngine()', () => {
    it('creates a TemplateEngine instance', () => {
      const engine = createTemplateEngine()

      expect(engine).toBeDefined()
      expect(engine).toBeInstanceOf(TemplateEngine)
    })

    it('accepts optional configuration', () => {
      const engine = createTemplateEngine({
        cacheEnabled: false,
        maxCacheSize: 50,
      })

      expect(engine).toBeDefined()
      const stats = engine.getCacheStats()
      expect(stats.enabled).toBe(false)
      expect(stats.maxSize).toBe(50)
    })

    it('accepts custom delimiters', () => {
      const engine = createTemplateEngine({
        openDelimiter: '<%',
        closeDelimiter: '%>',
      })

      const result = engine.render('Hello <% name %>!', { name: 'World' })
      expect(result).toBe('Hello World!')
    })
  })
})

// =============================================================================
// Variable Injection Tests
// =============================================================================

describe('Variable Injection', () => {
  let engine: TemplateEngine

  beforeEach(() => {
    engine = createTemplateEngine()
  })

  describe('Simple Variables', () => {
    it('substitutes a single variable', () => {
      const template = 'Hello, {{name}}!'
      const result = engine.render(template, { name: 'Alice' })
      expect(result).toBe('Hello, Alice!')
    })

    it('substitutes multiple variables', () => {
      const template = '{{greeting}}, {{name}}! Welcome to {{company}}.'
      const result = engine.render(template, {
        greeting: 'Hi',
        name: 'Bob',
        company: 'Acme',
      })
      expect(result).toBe('Hi, Bob! Welcome to Acme.')
    })

    it('handles variables with spaces in delimiters', () => {
      const template = 'Hello, {{ name }}!'
      const result = engine.render(template, { name: 'Charlie' })
      expect(result).toBe('Hello, Charlie!')
    })

    it('preserves unmatched variables', () => {
      const template = 'Hello, {{name}}! Price: ${{price}}'
      const result = engine.render(template, { name: 'Dave' })
      expect(result).toBe('Hello, Dave! Price: ${{price}}')
    })

    it('handles empty variables object', () => {
      const template = 'Hello, {{name}}!'
      const result = engine.render(template, {})
      expect(result).toBe('Hello, {{name}}!')
    })
  })

  describe('Nested Object Variables', () => {
    it('accesses nested properties with dot notation', () => {
      const template = 'Hello, {{user.name}}! Your email is {{user.email}}.'
      const result = engine.render(template, {
        user: { name: 'Eve', email: 'eve@example.com' },
      })
      expect(result).toBe('Hello, Eve! Your email is eve@example.com.')
    })

    it('accesses deeply nested properties', () => {
      const template = 'City: {{address.city.name}}'
      const result = engine.render(template, {
        address: { city: { name: 'New York' } },
      })
      expect(result).toBe('City: New York')
    })

    it('handles missing nested properties gracefully', () => {
      const template = 'Value: {{a.b.c}}'
      const result = engine.render(template, { a: { b: {} } })
      expect(result).toBe('Value: {{a.b.c}}')
    })
  })
})

// =============================================================================
// Conditionals Tests
// =============================================================================

describe('Conditionals', () => {
  let engine: TemplateEngine

  beforeEach(() => {
    engine = createTemplateEngine()
  })

  describe('{{#if}} blocks', () => {
    it('renders content when condition is truthy', () => {
      const template = '{{#if showGreeting}}Hello!{{/if}}'
      const result = engine.render(template, { showGreeting: true })
      expect(result).toBe('Hello!')
    })

    it('does not render content when condition is falsy', () => {
      const template = '{{#if showGreeting}}Hello!{{/if}}'
      const result = engine.render(template, { showGreeting: false })
      expect(result).toBe('')
    })

    it('handles else blocks', () => {
      const template = '{{#if isVip}}VIP Welcome!{{else}}Standard Welcome{{/if}}'
      const result = engine.render(template, { isVip: false })
      expect(result).toBe('Standard Welcome')
    })

    it('treats empty strings as falsy', () => {
      const template = '{{#if name}}Hello {{name}}{{else}}Hello Guest{{/if}}'
      const result = engine.render(template, { name: '' })
      expect(result).toBe('Hello Guest')
    })

    it('treats 0 as falsy', () => {
      const template = '{{#if count}}You have {{count}} items{{else}}No items{{/if}}'
      const result = engine.render(template, { count: 0 })
      expect(result).toBe('No items')
    })

    it('handles nested conditionals', () => {
      const template = '{{#if a}}A{{#if b}}B{{/if}}{{/if}}'
      const result = engine.render(template, { a: true, b: true })
      expect(result).toBe('AB')
    })
  })

  describe('{{#unless}} blocks', () => {
    it('renders content when condition is falsy', () => {
      const template = '{{#unless isPremium}}Upgrade today!{{/unless}}'
      const result = engine.render(template, { isPremium: false })
      expect(result).toBe('Upgrade today!')
    })

    it('does not render content when condition is truthy', () => {
      const template = '{{#unless isPremium}}Upgrade today!{{/unless}}'
      const result = engine.render(template, { isPremium: true })
      expect(result).toBe('')
    })
  })
})

// =============================================================================
// Loops Tests
// =============================================================================

describe('Loops', () => {
  let engine: TemplateEngine

  beforeEach(() => {
    engine = createTemplateEngine()
  })

  describe('{{#each}} blocks', () => {
    it('iterates over simple arrays', () => {
      const template = '{{#each items}}{{this}} {{/each}}'
      const result = engine.render(template, { items: ['apple', 'banana', 'cherry'] })
      expect(result).toBe('apple banana cherry ')
    })

    it('iterates over arrays of objects', () => {
      const template = '{{#each users}}{{name}} ({{email}}), {{/each}}'
      const result = engine.render(template, {
        users: [
          { name: 'Alice', email: 'alice@example.com' },
          { name: 'Bob', email: 'bob@example.com' },
        ],
      })
      expect(result).toBe('Alice (alice@example.com), Bob (bob@example.com), ')
    })

    it('provides @index in each loops', () => {
      const template = '{{#each items}}{{@index}}: {{this}}, {{/each}}'
      const result = engine.render(template, { items: ['a', 'b', 'c'] })
      expect(result).toBe('0: a, 1: b, 2: c, ')
    })

    it('provides @first and @last indicators', () => {
      const template =
        '{{#each items}}{{#if @first}}[{{/if}}{{this}}{{#if @last}}]{{/if}}{{#unless @last}}, {{/unless}}{{/each}}'
      const result = engine.render(template, { items: ['a', 'b', 'c'] })
      expect(result).toBe('[a, b, c]')
    })

    it('handles empty arrays', () => {
      const template = '{{#each items}}{{this}}{{/each}}'
      const result = engine.render(template, { items: [] })
      expect(result).toBe('')
    })

    it('handles nested loops', () => {
      const template = '{{#each groups}}Group: {{#each items}}{{this}} {{/each}}| {{/each}}'
      const result = engine.render(template, {
        groups: [{ items: ['a', 'b'] }, { items: ['c', 'd'] }],
      })
      expect(result).toBe('Group: a b | Group: c d | ')
    })
  })
})

// =============================================================================
// Partials Tests
// =============================================================================

describe('Partials', () => {
  let engine: TemplateEngine

  beforeEach(() => {
    engine = createTemplateEngine()
  })

  describe('registerPartial()', () => {
    it('registers a partial template', () => {
      engine.registerPartial('header', '<h1>{{title}}</h1>')

      const result = engine.render('{{> header}}', { title: 'Welcome' })
      expect(result).toBe('<h1>Welcome</h1>')
    })

    it('supports nested partials', () => {
      engine.registerPartial('inner', '<span>{{text}}</span>')
      engine.registerPartial('outer', '<div>{{> inner}}</div>')

      const result = engine.render('{{> outer}}', { text: 'Hello' })
      expect(result).toBe('<div><span>Hello</span></div>')
    })

    it('supports partial arguments', () => {
      engine.registerPartial('greeting', 'Hello, {{name}}!')

      const result = engine.render('{{> greeting name="World"}}', {})
      expect(result).toBe('Hello, World!')
    })

    it('preserves unregistered partials', () => {
      const result = engine.render('{{> unknown}}', {})
      expect(result).toBe('{{> unknown}}')
    })
  })

  describe('removePartial()', () => {
    it('removes a registered partial', () => {
      engine.registerPartial('test', 'Test content')
      engine.removePartial('test')

      expect(engine.getPartial('test')).toBeUndefined()
    })
  })
})

// =============================================================================
// Output Escaping Tests
// =============================================================================

describe('Output Escaping', () => {
  let engine: TemplateEngine

  beforeEach(() => {
    engine = createTemplateEngine()
  })

  describe('HTML escaping', () => {
    it('escapes HTML special characters', () => {
      const result = engine.render('{{content}}', { content: '<script>alert("XSS")</script>' }, { escape: 'html' })
      expect(result).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;')
    })

    it('escapes ampersands', () => {
      const result = engine.render('{{content}}', { content: 'Tom & Jerry' }, { escape: 'html' })
      expect(result).toBe('Tom &amp; Jerry')
    })

    it('escapes quotes', () => {
      const result = engine.render('{{content}}', { content: 'He said "hello"' }, { escape: 'html' })
      expect(result).toBe('He said &quot;hello&quot;')
    })
  })

  describe('Text escaping', () => {
    it('strips HTML tags', () => {
      const result = engine.render('{{content}}', { content: '<p>Hello <b>World</b></p>' }, { escape: 'text' })
      expect(result).toBe('Hello World')
    })
  })

  describe('Markdown escaping', () => {
    it('escapes Markdown special characters', () => {
      const result = engine.render('{{content}}', { content: '*bold* and _italic_' }, { escape: 'markdown' })
      expect(result).toBe('\\*bold\\* and \\_italic\\_')
    })
  })

  describe('No escaping', () => {
    it('does not escape when escape mode is none', () => {
      const result = engine.render('{{content}}', { content: '<script>alert("XSS")</script>' }, { escape: 'none' })
      expect(result).toBe('<script>alert("XSS")</script>')
    })
  })
})

// =============================================================================
// Filters Tests
// =============================================================================

describe('Filters', () => {
  let engine: TemplateEngine

  beforeEach(() => {
    engine = createTemplateEngine()
  })

  describe('Built-in filters', () => {
    it('applies default filter', () => {
      const result = engine.render('{{name|default:"Guest"}}', {})
      expect(result).toBe('Guest')
    })

    it('applies uppercase filter', () => {
      const result = engine.render('{{name|uppercase}}', { name: 'hello' })
      expect(result).toBe('HELLO')
    })

    it('applies lowercase filter', () => {
      const result = engine.render('{{name|lowercase}}', { name: 'HELLO' })
      expect(result).toBe('hello')
    })

    it('applies trim filter', () => {
      const result = engine.render('{{name|trim}}', { name: '  hello  ' })
      expect(result).toBe('hello')
    })

    it('chains multiple filters', () => {
      const result = engine.render('{{name|trim|uppercase}}', { name: '  hello  ' })
      expect(result).toBe('HELLO')
    })
  })

  describe('Custom filters', () => {
    it('registers and applies custom filter', () => {
      engine.registerFilter({
        name: 'reverse',
        fn: (value) => String(value).split('').reverse().join(''),
      })

      const result = engine.render('{{text|reverse}}', { text: 'hello' })
      expect(result).toBe('olleh')
    })
  })
})

// =============================================================================
// Helpers Tests
// =============================================================================

describe('Helpers', () => {
  let engine: TemplateEngine

  beforeEach(() => {
    engine = createTemplateEngine()
  })

  describe('Built-in helpers', () => {
    it('applies uppercase helper', () => {
      const result = engine.render('{{uppercase name}}', { name: 'hello' })
      expect(result).toBe('HELLO')
    })

    it('applies truncate helper', () => {
      const result = engine.render('{{truncate text 5}}', { text: 'Hello World' })
      expect(result).toBe('Hello...')
    })

    it('applies formatCurrency helper', () => {
      const result = engine.render('{{formatCurrency price "USD"}}', { price: 29.99 })
      expect(result).toBe('$29.99')
    })
  })

  describe('Custom helpers', () => {
    it('registers and applies custom helper', () => {
      engine.registerHelper({
        name: 'repeat',
        fn: (value, times: number) => String(value).repeat(times),
      })

      const result = engine.render('{{repeat char 3}}', { char: 'x' })
      expect(result).toBe('xxx')
    })
  })
})

// =============================================================================
// Variable Extraction Tests
// =============================================================================

describe('Variable Extraction', () => {
  let engine: TemplateEngine

  beforeEach(() => {
    engine = createTemplateEngine()
  })

  describe('extractVariables()', () => {
    it('extracts simple variable names', () => {
      const template = 'Hello, {{name}}! Your order {{orderId}} is ready.'
      const variables = engine.extractVariables(template)
      expect(variables).toContain('name')
      expect(variables).toContain('orderId')
    })

    it('extracts nested variable paths', () => {
      const template = 'Hello, {{user.name}}!'
      const variables = engine.extractVariables(template)
      expect(variables).toContain('user.name')
    })

    it('extracts variables from loops', () => {
      const template = '{{#each items}}{{name}}{{/each}}'
      const variables = engine.extractVariables(template)
      expect(variables).toContain('items')
    })

    it('extracts variables from conditionals', () => {
      const template = '{{#if showBanner}}{{bannerText}}{{/if}}'
      const variables = engine.extractVariables(template)
      expect(variables).toContain('showBanner')
      expect(variables).toContain('bannerText')
    })
  })
})

// =============================================================================
// Template Caching Tests
// =============================================================================

describe('Template Caching', () => {
  describe('Cache enabled', () => {
    let engine: TemplateEngine

    beforeEach(() => {
      engine = createTemplateEngine({ cacheEnabled: true, maxCacheSize: 5 })
    })

    it('caches compiled templates', () => {
      const template = 'Hello {{name}}'

      // First render - compiles and caches
      engine.render(template, { name: 'World' })

      const compiled = engine.getCompiled(template)
      expect(compiled).toBeDefined()
      expect(compiled?.source).toBe(template)
    })

    it('returns cache statistics', () => {
      const stats = engine.getCacheStats()

      expect(stats.enabled).toBe(true)
      expect(stats.maxSize).toBe(5)
      expect(stats.size).toBeGreaterThanOrEqual(0)
    })

    it('clears cache', () => {
      engine.render('Hello {{name}}', { name: 'World' })
      expect(engine.getCacheStats().size).toBeGreaterThan(0)

      engine.clearCache()
      expect(engine.getCacheStats().size).toBe(0)
    })

    it('evicts old entries when cache is full', () => {
      // Fill cache
      for (let i = 0; i < 10; i++) {
        engine.render(`Template ${i}: {{name}}`, { name: 'Test' })
      }

      // Cache size should not exceed maxSize
      expect(engine.getCacheStats().size).toBeLessThanOrEqual(5)
    })
  })

  describe('Cache disabled', () => {
    it('does not cache when disabled', () => {
      const engine = createTemplateEngine({ cacheEnabled: false })

      engine.render('Hello {{name}}', { name: 'World' })

      const stats = engine.getCacheStats()
      expect(stats.enabled).toBe(false)
      expect(stats.size).toBe(0)
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration', () => {
  describe('Complex template rendering', () => {
    it('renders a complete email template', () => {
      const engine = createTemplateEngine()

      engine.registerPartial('header', '<header>{{title}}</header>')
      engine.registerPartial('footer', '<footer>{{year}} {{company}}</footer>')

      const template = `
{{> header}}
<main>
  <h1>Hello, {{user.name}}!</h1>
  {{#if isPremium}}
    <p>Thank you for being a premium member!</p>
  {{else}}
    <p>Consider upgrading to premium.</p>
  {{/if}}
  <h2>Your recent orders:</h2>
  <ul>
    {{#each orders}}
    <li>Order #{{id}}: {{total|currency:"USD"}} - {{status}}</li>
    {{/each}}
  </ul>
</main>
{{> footer}}
`.trim()

      const result = engine.render(template, {
        title: 'Account Summary',
        user: { name: 'Alice' },
        isPremium: true,
        orders: [
          { id: '001', total: 99.99, status: 'Delivered' },
          { id: '002', total: 49.99, status: 'Shipped' },
        ],
        year: 2024,
        company: 'Acme Inc',
      })

      expect(result).toContain('<header>Account Summary</header>')
      expect(result).toContain('Hello, Alice!')
      expect(result).toContain('Thank you for being a premium member!')
      expect(result).not.toContain('Consider upgrading')
      expect(result).toContain('Order #001')
      expect(result).toContain('$99.99')
      expect(result).toContain('<footer>2024 Acme Inc</footer>')
    })
  })
})

// =============================================================================
// Dispose Tests
// =============================================================================

describe('Dispose', () => {
  it('clears all resources on dispose', () => {
    const engine = createTemplateEngine()

    engine.registerPartial('test', 'Test')
    engine.registerHelper({ name: 'test', fn: () => 'test' })
    engine.registerFilter({ name: 'test', fn: (v) => v })
    engine.render('Hello {{name}}', { name: 'World' })

    engine.dispose()

    expect(engine.getPartial('test')).toBeUndefined()
    expect(engine.getHelper('test')).toBeUndefined()
    expect(engine.getFilter('test')).toBeUndefined()
    expect(engine.getCacheStats().size).toBe(0)
  })
})
