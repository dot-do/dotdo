/**
 * Schema Directives Tests
 *
 * Tests for $id, $context, $instructions, and other $ directives.
 *
 * This is RED phase TDD - tests should FAIL until directive handlers are implemented.
 *
 * Directives are special keys in schema type definitions that start with $
 * and control behavior like ID extraction, context namespaces, AI generation,
 * and UI presentation.
 */

import { describe, it, expect } from 'vitest'

// These imports should FAIL until implemented
// @ts-expect-error - extractId not yet implemented
import { extractId } from '../directives/id-extraction'

// @ts-expect-error - transform functions not yet implemented
import {
  PascalCase,
  camelCase,
  kebabCase,
  snakeCase,
  UPPERCASE,
  lowercase,
  slugify,
} from '../directives/transforms'

// @ts-expect-error - context directive handler not yet implemented
import { resolveContext, mergeContext } from '../directives/context'

// @ts-expect-error - instructions directive handler not yet implemented
import { resolveInstructions, mergeInstructions } from '../directives/instructions'

// @ts-expect-error - UI directive handlers not yet implemented
import { resolveUIDirectives } from '../directives/ui'

// @ts-expect-error - source directive handler not yet implemented
import { resolveSource } from '../directives/source'

// @ts-expect-error - type discriminator handler not yet implemented
import { resolveTypeDiscriminator } from '../directives/type'

// ============================================================================
// $id Directive Tests
// ============================================================================

describe('$id Directive', () => {
  describe('JSONPath Extraction', () => {
    it('extracts id from simple JSONPath', () => {
      const data = { slug: 'my-article' }
      const result = extractId(data, '$.slug')
      expect(result).toBe('my-article')
    })

    it('extracts id from nested JSONPath', () => {
      const data = { metadata: { id: 'nested-id' } }
      const result = extractId(data, '$.metadata.id')
      expect(result).toBe('nested-id')
    })

    it('extracts id from array index', () => {
      const data = { ids: ['first', 'second', 'third'] }
      const result = extractId(data, '$.ids[0]')
      expect(result).toBe('first')
    })

    it('returns undefined for missing path', () => {
      const data = { name: 'test' }
      const result = extractId(data, '$.missing')
      expect(result).toBeUndefined()
    })

    it('handles null values in path', () => {
      const data = { value: null }
      const result = extractId(data, '$.value')
      expect(result).toBeNull()
    })
  })

  describe('Transform Functions', () => {
    it('applies PascalCase transform', () => {
      const data = { name: 'hello world' }
      const result = extractId(data, 'PascalCase($.name)')
      expect(result).toBe('HelloWorld')
    })

    it('applies camelCase transform', () => {
      const data = { name: 'Hello World' }
      const result = extractId(data, 'camelCase($.name)')
      expect(result).toBe('helloWorld')
    })

    it('applies kebab-case transform', () => {
      const data = { name: 'Hello World' }
      const result = extractId(data, 'kebabCase($.name)')
      expect(result).toBe('hello-world')
    })

    it('applies snake_case transform', () => {
      const data = { name: 'Hello World' }
      const result = extractId(data, 'snakeCase($.name)')
      expect(result).toBe('hello_world')
    })

    it('applies UPPERCASE transform', () => {
      const data = { code: 'abc123' }
      const result = extractId(data, 'UPPERCASE($.code)')
      expect(result).toBe('ABC123')
    })

    it('applies lowercase transform', () => {
      const data = { code: 'ABC123' }
      const result = extractId(data, 'lowercase($.code)')
      expect(result).toBe('abc123')
    })

    it('applies slugify transform', () => {
      const data = { title: 'Hello, World! & Friends' }
      const result = extractId(data, 'slugify($.title)')
      expect(result).toBe('hello-world-friends')
    })
  })

  describe('Composite ID Patterns', () => {
    it('concatenates multiple paths with literal separator', () => {
      const data = { prefix: 'PRJ', suffix: '001' }
      const result = extractId(data, '$.prefix-$.suffix')
      expect(result).toBe('PRJ-001')
    })

    it('supports underscore separator', () => {
      const data = { org: 'acme', project: 'web' }
      const result = extractId(data, '$.org_$.project')
      expect(result).toBe('acme_web')
    })

    it('supports colon separator', () => {
      const data = { namespace: 'users', id: '123' }
      const result = extractId(data, '$.namespace:$.id')
      expect(result).toBe('users:123')
    })

    it('supports slash separator (path-like)', () => {
      const data = { org: 'acme', repo: 'app' }
      const result = extractId(data, '$.org/$.repo')
      expect(result).toBe('acme/app')
    })

    it('combines transform with composite', () => {
      const data = { type: 'User', name: 'John Doe' }
      const result = extractId(data, 'lowercase($.type)-slugify($.name)')
      expect(result).toBe('user-john-doe')
    })

    it('handles three-part composite', () => {
      const data = { year: 2024, month: '01', day: 15 }
      const result = extractId(data, '$.year-$.month-$.day')
      expect(result).toBe('2024-01-15')
    })
  })

  describe('Edge Cases', () => {
    it('handles empty string value', () => {
      const data = { id: '' }
      const result = extractId(data, '$.id')
      expect(result).toBe('')
    })

    it('handles numeric values', () => {
      const data = { id: 12345 }
      const result = extractId(data, '$.id')
      expect(result).toBe('12345')
    })

    it('handles boolean values', () => {
      const data = { active: true }
      const result = extractId(data, '$.active')
      expect(result).toBe('true')
    })

    it('throws on invalid transform function', () => {
      const data = { name: 'test' }
      expect(() => extractId(data, 'InvalidTransform($.name)')).toThrow()
    })

    it('handles special characters in values', () => {
      const data = { id: 'user@example.com' }
      const result = extractId(data, '$.id')
      expect(result).toBe('user@example.com')
    })
  })
})

// ============================================================================
// Transform Functions Unit Tests
// ============================================================================

describe('Transform Functions', () => {
  describe('PascalCase', () => {
    it('converts space-separated words', () => {
      expect(PascalCase('hello world')).toBe('HelloWorld')
    })

    it('converts kebab-case', () => {
      expect(PascalCase('hello-world')).toBe('HelloWorld')
    })

    it('converts snake_case', () => {
      expect(PascalCase('hello_world')).toBe('HelloWorld')
    })

    it('handles single word', () => {
      expect(PascalCase('hello')).toBe('Hello')
    })

    it('handles already PascalCase', () => {
      expect(PascalCase('HelloWorld')).toBe('HelloWorld')
    })

    it('handles mixed case input', () => {
      expect(PascalCase('helloWorld test')).toBe('HelloWorldTest')
    })
  })

  describe('camelCase', () => {
    it('converts space-separated words', () => {
      expect(camelCase('hello world')).toBe('helloWorld')
    })

    it('converts PascalCase', () => {
      expect(camelCase('HelloWorld')).toBe('helloWorld')
    })

    it('converts kebab-case', () => {
      expect(camelCase('hello-world')).toBe('helloWorld')
    })

    it('handles already camelCase', () => {
      expect(camelCase('helloWorld')).toBe('helloWorld')
    })
  })

  describe('kebabCase', () => {
    it('converts space-separated words', () => {
      expect(kebabCase('hello world')).toBe('hello-world')
    })

    it('converts PascalCase', () => {
      expect(kebabCase('HelloWorld')).toBe('hello-world')
    })

    it('converts camelCase', () => {
      expect(kebabCase('helloWorld')).toBe('hello-world')
    })

    it('converts snake_case', () => {
      expect(kebabCase('hello_world')).toBe('hello-world')
    })
  })

  describe('snakeCase', () => {
    it('converts space-separated words', () => {
      expect(snakeCase('hello world')).toBe('hello_world')
    })

    it('converts PascalCase', () => {
      expect(snakeCase('HelloWorld')).toBe('hello_world')
    })

    it('converts camelCase', () => {
      expect(snakeCase('helloWorld')).toBe('hello_world')
    })

    it('converts kebab-case', () => {
      expect(snakeCase('hello-world')).toBe('hello_world')
    })
  })

  describe('slugify', () => {
    it('removes special characters', () => {
      expect(slugify('Hello, World!')).toBe('hello-world')
    })

    it('handles ampersands', () => {
      expect(slugify('Rock & Roll')).toBe('rock-roll')
    })

    it('collapses multiple dashes', () => {
      expect(slugify('hello---world')).toBe('hello-world')
    })

    it('trims leading/trailing dashes', () => {
      expect(slugify('--hello--')).toBe('hello')
    })

    it('handles unicode characters', () => {
      expect(slugify('Caf\u00e9 del Mar')).toBe('cafe-del-mar')
    })
  })
})

// ============================================================================
// $context Directive Tests
// ============================================================================

describe('$context Directive', () => {
  describe('Namespace Resolution', () => {
    it('resolves simple namespace string', () => {
      const type = { $context: 'https://db.sb' }
      const result = resolveContext(type)
      expect(result).toBe('https://db.sb')
    })

    it('resolves relative namespace', () => {
      const type = { $context: 'schema/v1' }
      const result = resolveContext(type, { baseContext: 'https://db.sb' })
      expect(result).toBe('https://db.sb/schema/v1')
    })

    it('resolves with trailing slash normalization', () => {
      const type = { $context: 'https://db.sb/' }
      const result = resolveContext(type)
      expect(result).toBe('https://db.sb')
    })
  })

  describe('Inheritance', () => {
    it('inherits from schema-level context', () => {
      const schemaContext = 'https://db.sb'
      const type = {} // No type-level $context
      const result = resolveContext(type, { schemaContext })
      expect(result).toBe('https://db.sb')
    })

    it('type-level overrides schema-level', () => {
      const schemaContext = 'https://db.sb'
      const type = { $context: 'https://custom.io' }
      const result = resolveContext(type, { schemaContext })
      expect(result).toBe('https://custom.io')
    })

    it('merges type context with schema context', () => {
      const schemaContext = 'https://db.sb'
      const type = { $context: 'types/user' }
      const result = mergeContext(type.$context, schemaContext)
      expect(result).toBe('https://db.sb/types/user')
    })
  })

  describe('Context Object Format', () => {
    it('supports object format with base and vocab', () => {
      const type = {
        $context: {
          base: 'https://db.sb/',
          vocab: 'https://schema.org/',
        },
      }
      const result = resolveContext(type)
      expect(result).toEqual({
        base: 'https://db.sb/',
        vocab: 'https://schema.org/',
      })
    })

    it('supports prefixes in context object', () => {
      const type = {
        $context: {
          base: 'https://db.sb/',
          schema: 'https://schema.org/',
          foaf: 'http://xmlns.com/foaf/0.1/',
        },
      }
      const result = resolveContext(type)
      expect(result.schema).toBe('https://schema.org/')
      expect(result.foaf).toBe('http://xmlns.com/foaf/0.1/')
    })
  })
})

// ============================================================================
// $instructions Directive Tests
// ============================================================================

describe('$instructions Directive', () => {
  describe('Basic Instructions', () => {
    it('extracts instruction string', () => {
      const type = {
        $instructions: 'Generate a professional bio for a tech company executive',
      }
      const result = resolveInstructions(type)
      expect(result).toBe('Generate a professional bio for a tech company executive')
    })

    it('extracts instruction array', () => {
      const type = {
        $instructions: [
          'Use formal business language',
          'Include key achievements',
          'Keep under 200 words',
        ],
      }
      const result = resolveInstructions(type)
      expect(result).toEqual([
        'Use formal business language',
        'Include key achievements',
        'Keep under 200 words',
      ])
    })

    it('returns undefined when no instructions', () => {
      const type = { name: 'string' }
      const result = resolveInstructions(type)
      expect(result).toBeUndefined()
    })
  })

  describe('Overriding Default Prompts', () => {
    it('replaces default field generation prompt', () => {
      const defaultPrompt = 'Generate a description'
      const type = {
        $instructions: 'Generate an SEO-optimized product description',
      }
      const result = resolveInstructions(type, { defaultPrompt })
      expect(result).not.toBe(defaultPrompt)
      expect(result).toBe('Generate an SEO-optimized product description')
    })

    it('merges with default when mode is extend', () => {
      const defaultPrompt = 'Generate a description'
      const type = {
        $instructions: {
          mode: 'extend',
          content: 'Focus on benefits and use cases',
        },
      }
      const result = resolveInstructions(type, { defaultPrompt })
      expect(result).toContain(defaultPrompt)
      expect(result).toContain('Focus on benefits and use cases')
    })

    it('prepends instructions when mode is prepend', () => {
      const defaultPrompt = 'Generate content'
      const type = {
        $instructions: {
          mode: 'prepend',
          content: 'Important: Be concise.',
        },
      }
      const result = resolveInstructions(type, { defaultPrompt })
      expect(result.startsWith('Important: Be concise.')).toBe(true)
    })
  })

  describe('Field-Level Application', () => {
    it('applies to all fields in type when at type level', () => {
      const type = {
        $instructions: 'Use technical terminology',
        name: 'string',
        description: 'string',
        summary: 'string',
      }
      const fields = ['name', 'description', 'summary']
      fields.forEach((field) => {
        const result = resolveInstructions(type, { field })
        expect(result).toBe('Use technical terminology')
      })
    })

    it('field-level instructions override type-level', () => {
      const type = {
        $instructions: 'Use formal language',
        tagline: {
          type: 'string',
          $instructions: 'Be catchy and memorable',
        },
      }
      const result = resolveInstructions(type.tagline)
      expect(result).toBe('Be catchy and memorable')
    })
  })

  describe('Inheritance and Merging', () => {
    it('inherits from schema-level instructions', () => {
      const schemaInstructions = 'All content should be in English'
      const type = {}
      const result = resolveInstructions(type, { schemaInstructions })
      expect(result).toBe('All content should be in English')
    })

    it('merges type and schema instructions', () => {
      const schemaInstructions = 'Use formal language'
      const type = { $instructions: 'Focus on technical details' }
      const result = mergeInstructions(type.$instructions, schemaInstructions)
      expect(result).toContain('Use formal language')
      expect(result).toContain('Focus on technical details')
    })
  })
})

// ============================================================================
// UI Directives Tests ($icon, $group)
// ============================================================================

describe('UI Directives', () => {
  describe('$icon Directive', () => {
    it('extracts icon name', () => {
      const type = { $icon: 'user' }
      const result = resolveUIDirectives(type)
      expect(result.icon).toBe('user')
    })

    it('supports icon library prefix', () => {
      const type = { $icon: 'lucide:user' }
      const result = resolveUIDirectives(type)
      expect(result.icon).toBe('lucide:user')
      expect(result.iconLibrary).toBe('lucide')
      expect(result.iconName).toBe('user')
    })

    it('supports emoji icons', () => {
      const type = { $icon: '\ud83d\udc64' }
      const result = resolveUIDirectives(type)
      expect(result.icon).toBe('\ud83d\udc64')
      expect(result.iconType).toBe('emoji')
    })

    it('supports icon URL', () => {
      const type = { $icon: 'https://example.com/icon.svg' }
      const result = resolveUIDirectives(type)
      expect(result.icon).toBe('https://example.com/icon.svg')
      expect(result.iconType).toBe('url')
    })
  })

  describe('$group Directive', () => {
    it('extracts group name', () => {
      const type = { $group: 'Settings' }
      const result = resolveUIDirectives(type)
      expect(result.group).toBe('Settings')
    })

    it('supports group with order', () => {
      const type = { $group: { name: 'Settings', order: 10 } }
      const result = resolveUIDirectives(type)
      expect(result.group).toBe('Settings')
      expect(result.groupOrder).toBe(10)
    })

    it('supports nested group path', () => {
      const type = { $group: 'Settings/Advanced/Performance' }
      const result = resolveUIDirectives(type)
      expect(result.group).toBe('Settings/Advanced/Performance')
      expect(result.groupPath).toEqual(['Settings', 'Advanced', 'Performance'])
    })
  })

  describe('Combined UI Directives', () => {
    it('resolves all UI directives together', () => {
      const type = {
        $icon: 'settings',
        $group: 'Configuration',
        $label: 'System Settings',
        $description: 'Configure system behavior',
        $hidden: false,
        $readonly: true,
      }
      const result = resolveUIDirectives(type)
      expect(result.icon).toBe('settings')
      expect(result.group).toBe('Configuration')
      expect(result.label).toBe('System Settings')
      expect(result.description).toBe('Configure system behavior')
      expect(result.hidden).toBe(false)
      expect(result.readonly).toBe(true)
    })
  })
})

// ============================================================================
// $type Discriminator Tests
// ============================================================================

describe('$type Directive', () => {
  describe('Type Discriminator', () => {
    it('extracts type discriminator value', () => {
      const entity = { $type: 'User', name: 'John' }
      const result = resolveTypeDiscriminator(entity)
      expect(result).toBe('User')
    })

    it('uses $type for polymorphic resolution', () => {
      const entities = [
        { $type: 'User', name: 'John' },
        { $type: 'Admin', name: 'Jane', permissions: ['all'] },
        { $type: 'Guest', sessionId: 'abc123' },
      ]

      entities.forEach((entity) => {
        const result = resolveTypeDiscriminator(entity)
        expect(result).toBe(entity.$type)
      })
    })

    it('returns undefined when no $type', () => {
      const entity = { name: 'John' }
      const result = resolveTypeDiscriminator(entity)
      expect(result).toBeUndefined()
    })
  })

  describe('Schema Type Definition', () => {
    it('validates entity against schema type', () => {
      const schema = {
        User: {
          $type: 'User',
          name: 'string',
          email: 'string',
        },
      }
      const entity = { $type: 'User', name: 'John', email: 'john@example.com' }
      const typeMatch = resolveTypeDiscriminator(entity)
      expect(typeMatch).toBe('User')
      expect(schema[typeMatch]).toBeDefined()
    })
  })
})

// ============================================================================
// $source Directive Tests
// ============================================================================

describe('$source Directive', () => {
  describe('External API Source', () => {
    it('resolves REST API source', () => {
      const type = {
        $source: 'https://api.example.com/users',
      }
      const result = resolveSource(type)
      expect(result.url).toBe('https://api.example.com/users')
      expect(result.method).toBe('GET')
    })

    it('resolves source with method', () => {
      const type = {
        $source: {
          url: 'https://api.example.com/users',
          method: 'POST',
        },
      }
      const result = resolveSource(type)
      expect(result.url).toBe('https://api.example.com/users')
      expect(result.method).toBe('POST')
    })

    it('resolves source with headers', () => {
      const type = {
        $source: {
          url: 'https://api.example.com/users',
          headers: {
            'Authorization': 'Bearer token',
            'Content-Type': 'application/json',
          },
        },
      }
      const result = resolveSource(type)
      expect(result.headers['Authorization']).toBe('Bearer token')
    })
  })

  describe('Data Mapping', () => {
    it('maps response to schema fields', () => {
      const type = {
        $source: {
          url: 'https://api.example.com/users',
          mapping: {
            id: '$.data.id',
            name: '$.data.attributes.name',
            email: '$.data.attributes.email',
          },
        },
      }
      const result = resolveSource(type)
      expect(result.mapping.id).toBe('$.data.id')
      expect(result.mapping.name).toBe('$.data.attributes.name')
    })

    it('supports array response mapping', () => {
      const type = {
        $source: {
          url: 'https://api.example.com/users',
          items: '$.data[*]',
          mapping: {
            id: '$.id',
            name: '$.name',
          },
        },
      }
      const result = resolveSource(type)
      expect(result.items).toBe('$.data[*]')
    })
  })

  describe('Authentication', () => {
    it('resolves source with API key auth', () => {
      const type = {
        $source: {
          url: 'https://api.example.com/data',
          auth: {
            type: 'apiKey',
            key: 'X-API-Key',
            value: '${env.API_KEY}',
          },
        },
      }
      const result = resolveSource(type)
      expect(result.auth.type).toBe('apiKey')
      expect(result.auth.key).toBe('X-API-Key')
    })

    it('resolves source with OAuth', () => {
      const type = {
        $source: {
          url: 'https://api.example.com/data',
          auth: {
            type: 'oauth2',
            tokenUrl: 'https://auth.example.com/token',
            clientId: '${env.CLIENT_ID}',
            clientSecret: '${env.CLIENT_SECRET}',
          },
        },
      }
      const result = resolveSource(type)
      expect(result.auth.type).toBe('oauth2')
    })
  })

  describe('Caching and Refresh', () => {
    it('resolves cache settings', () => {
      const type = {
        $source: {
          url: 'https://api.example.com/data',
          cache: {
            ttl: 3600,
            staleWhileRevalidate: true,
          },
        },
      }
      const result = resolveSource(type)
      expect(result.cache.ttl).toBe(3600)
      expect(result.cache.staleWhileRevalidate).toBe(true)
    })

    it('resolves refresh schedule', () => {
      const type = {
        $source: {
          url: 'https://api.example.com/data',
          refresh: 'every 5 minutes',
        },
      }
      const result = resolveSource(type)
      expect(result.refresh).toBe('every 5 minutes')
    })
  })
})

// ============================================================================
// Directive Parsing Tests
// ============================================================================

describe('Directive Parsing', () => {
  describe('Identifying Directives', () => {
    it('identifies all $ prefixed keys as directives', () => {
      const type = {
        $id: '$.slug',
        $context: 'https://db.sb',
        $instructions: 'Generate content',
        $icon: 'user',
        $group: 'Users',
        $source: 'https://api.example.com',
        $type: 'User',
        // Regular fields
        name: 'string',
        email: 'string',
      }

      const directives = Object.keys(type).filter((key) => key.startsWith('$'))
      const fields = Object.keys(type).filter((key) => !key.startsWith('$'))

      expect(directives).toHaveLength(7)
      expect(fields).toHaveLength(2)
    })
  })

  describe('Unknown Directives', () => {
    it('warns on unknown directive in development', () => {
      const type = {
        $unknown: 'value',
        name: 'string',
      }

      // Should log warning but not throw
      const ui = resolveUIDirectives(type)
      expect(ui.warnings).toContain('Unknown directive: $unknown')
    })
  })
})
