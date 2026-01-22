import { describe, it, expect } from 'vitest'
import { specToYAML, generateOpenAPI } from '../openapi'
import { Hono } from 'hono'

/**
 * Tests for YAML escaping issues in OpenAPI spec generation.
 *
 * YAML has many special characters that require proper quoting/escaping:
 * - @ at the start of a value (reserved indicator)
 * - ` backticks (can cause parsing issues)
 * - Multiline strings need block scalar or proper escaping
 * - Characters like *, &, !, |, >, {, }, [, ], etc.
 *
 * Issue: do-xpnb
 */
describe('OpenAPI YAML Escaping', () => {
  describe('specToYAML special character handling', () => {
    it('should properly escape @ symbol at start of string', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        info: {
          title: '@dotdo/api',
          version: '1.0.0',
          description: 'The @dotdo/api package provides a HATEOAS API'
        }
      })

      const yaml = specToYAML(spec)

      // YAML parsers will fail if @ is at the start of an unquoted string
      // The string should be quoted to be valid YAML
      expect(yaml).toContain('title:')

      // This test will fail because the current implementation doesn't quote @ strings
      // A valid YAML would have: title: "@dotdo/api" or title: '@dotdo/api'
      // But the current implementation produces: title: @dotdo/api (invalid YAML)

      // Verify the YAML is parseable by checking it doesn't produce bare @ at value start
      const lines = yaml.split('\n')
      const titleLine = lines.find(l => l.includes('title:'))
      expect(titleLine).toBeDefined()

      // The value after "title: " should be quoted if it starts with @
      // Current bug: it outputs "title: @dotdo/api" which is invalid YAML
      const titleValue = titleLine!.split('title:')[1]?.trim()
      if (titleValue?.startsWith('@')) {
        // If value starts with @, it MUST be quoted in valid YAML
        // This assertion will fail with current implementation
        expect(titleValue).toMatch(/^["']/)
      }
    })

    it('should properly escape backticks in strings', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        info: {
          title: 'Test API',
          version: '1.0.0',
          description: 'Use template literals like `await ai`Summarize: ${text}``'
        }
      })

      const yaml = specToYAML(spec)

      // Backticks can cause parsing issues in some YAML parsers
      // The string containing backticks should be properly quoted
      expect(yaml).toContain('description:')

      // Verify backticks are properly escaped/quoted
      const lines = yaml.split('\n')
      const descLine = lines.find(l => l.includes('description:'))
      expect(descLine).toBeDefined()

      // The description contains backticks which should be in a quoted string
      // Current bug: backticks are not escaped
      const descValue = descLine!.split('description:')[1]?.trim()
      if (descValue?.includes('`')) {
        // If contains backticks, should be quoted for safety
        expect(descValue).toMatch(/^["']/)
      }
    })

    it('should properly handle multiline strings', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        info: {
          title: 'Test API',
          version: '1.0.0',
          description: `This is a multiline description.

It has multiple paragraphs.

And some code examples:
  const x = 1;
  const y = 2;`
        }
      })

      const yaml = specToYAML(spec)

      // Multiline strings in YAML need special handling:
      // Either use block scalar (| or >) or properly escape newlines in quoted strings
      expect(yaml).toContain('description:')

      // The current implementation should use block scalar or properly escape
      // Current bug: newlines are just escaped with \n inside quotes which works,
      // but the implementation doesn't handle all edge cases

      // Verify the YAML structure is valid for multiline content
      // The description should either:
      // 1. Use block scalar: description: |
      // 2. Use quoted string with escaped newlines: description: "line1\nline2"
      const descIndex = yaml.indexOf('description:')
      expect(descIndex).toBeGreaterThan(-1)

      const afterDesc = yaml.slice(descIndex)
      // Should be quoted since it contains newlines
      expect(afterDesc).toMatch(/description:\s*["']/)
    })

    it('should properly escape YAML reserved characters', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        info: {
          title: 'Test API',
          version: '1.0.0',
          description: 'Special chars: * & ! | > { } [ ] % @ ` # : -'
        }
      })

      const yaml = specToYAML(spec)

      // Many YAML special characters require quoting when at certain positions:
      // * - alias indicator
      // & - anchor indicator
      // ! - tag indicator
      // | - literal block scalar
      // > - folded block scalar
      // { } - flow mapping
      // [ ] - flow sequence
      // % - directive indicator
      // @ ` - reserved for future use

      expect(yaml).toContain('description:')

      // The string contains multiple special characters
      // It should be quoted to prevent YAML parsing errors
      const lines = yaml.split('\n')
      const descLine = lines.find(l => l.includes('description:') && l.includes('Special chars'))
      expect(descLine).toBeDefined()

      const descValue = descLine!.split('description:')[1]?.trim()
      // Current bug: not all special characters trigger quoting
      // The value should be quoted since it contains *, &, !, etc.
      expect(descValue).toMatch(/^["']/)
    })

    it('should properly escape strings that look like YAML booleans', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        tags: [
          { name: 'yes', description: 'Operations that return yes/no' },
          { name: 'no', description: 'Negative responses' },
          { name: 'true', description: 'Boolean true operations' },
          { name: 'false', description: 'Boolean false operations' },
          { name: 'on', description: 'Enable operations' },
          { name: 'off', description: 'Disable operations' }
        ]
      })

      const yaml = specToYAML(spec)

      // YAML 1.1 treats yes/no/true/false/on/off as booleans
      // These should be quoted when used as string values
      expect(yaml).toContain('tags:')

      // The tag names should be quoted strings, not bare booleans
      // Current bug: these values are not quoted and will be parsed as booleans
      // "name: yes" becomes { name: true } when parsed
      // "name: no" becomes { name: false } when parsed

      // Each name should be quoted
      const yesLine = yaml.match(/name:\s*(yes|"yes"|'yes')/)?.[1]
      const noLine = yaml.match(/name:\s*(no|"no"|'no')/)?.[1]

      // These will fail because current implementation doesn't quote yes/no
      expect(yesLine).toMatch(/^["']yes["']$/)
      expect(noLine).toMatch(/^["']no["']$/)
    })

    it('should properly escape strings that look like numbers', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        info: {
          title: 'Test API',
          version: '1.0',  // Could be parsed as number 1.0
          description: 'Version 1e10 and 0x1F'  // Scientific notation and hex
        },
        tags: [
          { name: '123', description: 'Numeric tag' },
          { name: '1.5', description: 'Float tag' }
        ]
      })

      const yaml = specToYAML(spec)

      // Version "1.0" might be parsed as number 1 (losing the .0)
      // Tag names that look like numbers should be quoted

      expect(yaml).toContain('version:')
      expect(yaml).toContain('tags:')

      // The version should be quoted to preserve it as string "1.0"
      const versionMatch = yaml.match(/version:\s*(.+)/)
      expect(versionMatch).toBeDefined()

      // Current bug: "1.0" is not quoted and might be parsed as number
      // Should be: version: "1.0" or version: '1.0'
      const versionValue = versionMatch![1]?.trim()
      expect(versionValue).toMatch(/^["']1\.0["']$/)
    })

    it('should handle empty strings', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        info: {
          title: 'Test API',
          version: '1.0.0',
          description: ''  // Empty string
        }
      })

      const yaml = specToYAML(spec)

      // Empty strings should be represented as "" or '' in YAML
      // Not just omitted or as nothing after the colon

      // Current implementation filters out undefined but may not handle empty strings
      const descLine = yaml.match(/description:\s*(.*)/)
      if (descLine) {
        const value = descLine[1]?.trim()
        // Empty string should be explicitly quoted as "" or ''
        expect(value).toMatch(/^["']['"]$/)
      }
    })

    it('should properly escape strings starting with special YAML indicators', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        tags: [
          { name: 'Users', description: '- List of users (not a YAML list item)' },
          { name: 'Config', description: '? Question mark config' },
          { name: 'Mapping', description: ': Colon at start' },
          { name: 'Anchor', description: '& Ampersand anchor' },
          { name: 'Alias', description: '* Asterisk alias' },
          { name: 'Tag', description: '! Exclamation tag' }
        ]
      })

      const yaml = specToYAML(spec)

      // Strings starting with - ? : & * ! need to be quoted
      // They are YAML structural indicators

      // Current bug: only : and # trigger quoting, not - ? & * !

      const dashDesc = yaml.match(/description:\s*(.+List of users)/)?.[1]
      expect(dashDesc).toBeDefined()
      // Should be quoted since it starts with -
      expect(dashDesc).toMatch(/^["']/)
    })
  })
})
