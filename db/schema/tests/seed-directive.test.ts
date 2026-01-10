/**
 * $seed Directive Tests
 *
 * Tests for the $seed directive which populates entities from external data sources.
 *
 * This is RED phase TDD - tests should FAIL until seed handlers are implemented.
 *
 * The $seed directive supports:
 * - URL string: `$seed: 'https://...data.csv'`
 * - Object config: `$seed: { url, format, idField }`
 * - Pagination: `$next`, `$data` JSONPaths
 * - Formats: tsv, csv, json, jsonl, xml, yaml
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// These imports should FAIL until implemented
// @ts-expect-error - parseSeedConfig not yet implemented
import {
  parseSeedConfig,
  processSeedDirective,
  fetchSeedData,
  createEntityFromSeed,
  detectFormat,
  extractPaginationInfo,
} from '../directives/seed'

// @ts-expect-error - data format parsers not yet implemented
import {
  parseCSV,
  parseTSV,
  parseJSON,
  parseJSONL,
  parseXML,
  parseYAML,
} from '../directives/parsers'

// @ts-expect-error - extractId from id-extraction not yet implemented
import { extractId } from '../directives/id-extraction'

// ============================================================================
// Mock Fetch Setup
// ============================================================================

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

// ============================================================================
// $seed Configuration Parsing Tests
// ============================================================================

describe('$seed Configuration Parsing', () => {
  describe('URL String Format', () => {
    it('parses simple URL string', () => {
      const seed = 'https://example.com/data.csv'
      const config = parseSeedConfig(seed)

      expect(config.url).toBe('https://example.com/data.csv')
      expect(config.format).toBe('csv')
    })

    it('auto-detects format from .csv extension', () => {
      const config = parseSeedConfig('https://example.com/users.csv')
      expect(config.format).toBe('csv')
    })

    it('auto-detects format from .tsv extension', () => {
      const config = parseSeedConfig('https://example.com/users.tsv')
      expect(config.format).toBe('tsv')
    })

    it('auto-detects format from .json extension', () => {
      const config = parseSeedConfig('https://example.com/users.json')
      expect(config.format).toBe('json')
    })

    it('auto-detects format from .jsonl extension', () => {
      const config = parseSeedConfig('https://example.com/users.jsonl')
      expect(config.format).toBe('jsonl')
    })

    it('auto-detects format from .xml extension', () => {
      const config = parseSeedConfig('https://example.com/users.xml')
      expect(config.format).toBe('xml')
    })

    it('auto-detects format from .yaml extension', () => {
      const config = parseSeedConfig('https://example.com/users.yaml')
      expect(config.format).toBe('yaml')
    })

    it('auto-detects format from .yml extension', () => {
      const config = parseSeedConfig('https://example.com/users.yml')
      expect(config.format).toBe('yaml')
    })

    it('defaults to json when no extension', () => {
      const config = parseSeedConfig('https://api.example.com/users')
      expect(config.format).toBe('json')
    })
  })

  describe('Object Config Format', () => {
    it('parses full object config', () => {
      const seed = {
        url: 'https://example.com/data.csv',
        format: 'csv',
        idField: 'user_id',
      }
      const config = parseSeedConfig(seed)

      expect(config.url).toBe('https://example.com/data.csv')
      expect(config.format).toBe('csv')
      expect(config.idField).toBe('user_id')
    })

    it('allows format override', () => {
      const seed = {
        url: 'https://example.com/data', // No extension
        format: 'csv',
      }
      const config = parseSeedConfig(seed)
      expect(config.format).toBe('csv')
    })

    it('parses with headers config', () => {
      const seed = {
        url: 'https://api.example.com/data',
        headers: {
          'Authorization': 'Bearer token123',
          'Accept': 'application/json',
        },
      }
      const config = parseSeedConfig(seed)
      expect(config.headers['Authorization']).toBe('Bearer token123')
    })

    it('parses with transform function name', () => {
      const seed = {
        url: 'https://example.com/data.json',
        transform: 'normalizeUsers',
      }
      const config = parseSeedConfig(seed)
      expect(config.transform).toBe('normalizeUsers')
    })
  })

  describe('Pagination Config', () => {
    it('parses $next JSONPath for cursor pagination', () => {
      const seed = {
        url: 'https://api.example.com/users',
        $next: '$.meta.next_cursor',
        $data: '$.data',
      }
      const config = parseSeedConfig(seed)

      expect(config.pagination.nextPath).toBe('$.meta.next_cursor')
      expect(config.pagination.dataPath).toBe('$.data')
    })

    it('parses offset-based pagination', () => {
      const seed = {
        url: 'https://api.example.com/users',
        $data: '$.results',
        $next: {
          type: 'offset',
          param: 'offset',
          limit: 100,
          total: '$.total',
        },
      }
      const config = parseSeedConfig(seed)

      expect(config.pagination.type).toBe('offset')
      expect(config.pagination.param).toBe('offset')
      expect(config.pagination.limit).toBe(100)
    })

    it('parses page-based pagination', () => {
      const seed = {
        url: 'https://api.example.com/users',
        $data: '$.items',
        $next: {
          type: 'page',
          param: 'page',
          totalPages: '$.totalPages',
        },
      }
      const config = parseSeedConfig(seed)

      expect(config.pagination.type).toBe('page')
      expect(config.pagination.param).toBe('page')
    })

    it('parses link header pagination', () => {
      const seed = {
        url: 'https://api.example.com/users',
        $next: {
          type: 'link-header',
          rel: 'next',
        },
      }
      const config = parseSeedConfig(seed)

      expect(config.pagination.type).toBe('link-header')
      expect(config.pagination.rel).toBe('next')
    })
  })

  describe('ID Field Configuration', () => {
    it('uses idField for entity ID', () => {
      const seed = {
        url: 'https://example.com/data.json',
        idField: 'userId',
      }
      const config = parseSeedConfig(seed)
      expect(config.idField).toBe('userId')
    })

    it('supports JSONPath for idField', () => {
      const seed = {
        url: 'https://example.com/data.json',
        idField: '$.attributes.id',
      }
      const config = parseSeedConfig(seed)
      expect(config.idField).toBe('$.attributes.id')
    })

    it('supports composite idField', () => {
      const seed = {
        url: 'https://example.com/data.json',
        idField: '$.org-$.project',
      }
      const config = parseSeedConfig(seed)
      expect(config.idField).toBe('$.org-$.project')
    })

    it('supports transform in idField', () => {
      const seed = {
        url: 'https://example.com/data.json',
        idField: 'slugify($.name)',
      }
      const config = parseSeedConfig(seed)
      expect(config.idField).toBe('slugify($.name)')
    })
  })
})

// ============================================================================
// Data Format Parsing Tests
// ============================================================================

describe('Data Format Parsing', () => {
  describe('CSV Parsing', () => {
    it('parses simple CSV', () => {
      const csv = `name,email,age
John,john@example.com,30
Jane,jane@example.com,25`

      const result = parseCSV(csv)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ name: 'John', email: 'john@example.com', age: '30' })
      expect(result[1]).toEqual({ name: 'Jane', email: 'jane@example.com', age: '25' })
    })

    it('handles quoted values with commas', () => {
      const csv = `name,address
John,"123 Main St, Apt 4"
Jane,"456 Oak Ave, Suite 100"`

      const result = parseCSV(csv)

      expect(result[0].address).toBe('123 Main St, Apt 4')
    })

    it('handles escaped quotes', () => {
      const csv = `name,quote
John,"He said ""Hello"""`

      const result = parseCSV(csv)
      expect(result[0].quote).toBe('He said "Hello"')
    })

    it('handles empty values', () => {
      const csv = `name,email,phone
John,john@example.com,
Jane,,555-1234`

      const result = parseCSV(csv)

      expect(result[0].phone).toBe('')
      expect(result[1].email).toBe('')
    })

    it('handles different line endings', () => {
      const csvCRLF = 'name,email\r\nJohn,john@example.com\r\n'
      const csvLF = 'name,email\nJohn,john@example.com\n'

      expect(parseCSV(csvCRLF)).toEqual(parseCSV(csvLF))
    })

    it('handles BOM marker', () => {
      const csvWithBOM = '\ufeffname,email\nJohn,john@example.com'
      const result = parseCSV(csvWithBOM)
      expect(result[0].name).toBe('John')
    })

    it('supports custom delimiter option', () => {
      const csv = `name;email;age
John;john@example.com;30`

      const result = parseCSV(csv, { delimiter: ';' })
      expect(result[0].email).toBe('john@example.com')
    })
  })

  describe('TSV Parsing', () => {
    it('parses tab-separated values', () => {
      const tsv = `name\temail\tage
John\tjohn@example.com\t30
Jane\tjane@example.com\t25`

      const result = parseTSV(tsv)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ name: 'John', email: 'john@example.com', age: '30' })
    })

    it('handles values containing commas', () => {
      const tsv = `name\taddress
John\t123 Main St, Apt 4`

      const result = parseTSV(tsv)
      expect(result[0].address).toBe('123 Main St, Apt 4')
    })
  })

  describe('JSON Parsing', () => {
    it('parses JSON array', () => {
      const json = `[
        {"name": "John", "email": "john@example.com"},
        {"name": "Jane", "email": "jane@example.com"}
      ]`

      const result = parseJSON(json)

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('John')
    })

    it('parses JSON object with data array', () => {
      const json = `{
        "data": [
          {"name": "John"},
          {"name": "Jane"}
        ],
        "meta": {"total": 2}
      }`

      const result = parseJSON(json, { dataPath: '$.data' })

      expect(result).toHaveLength(2)
    })

    it('parses deeply nested data', () => {
      const json = `{
        "response": {
          "body": {
            "users": [{"name": "John"}]
          }
        }
      }`

      const result = parseJSON(json, { dataPath: '$.response.body.users' })
      expect(result[0].name).toBe('John')
    })
  })

  describe('JSONL Parsing', () => {
    it('parses newline-delimited JSON', () => {
      const jsonl = `{"name": "John", "email": "john@example.com"}
{"name": "Jane", "email": "jane@example.com"}
{"name": "Bob", "email": "bob@example.com"}`

      const result = parseJSONL(jsonl)

      expect(result).toHaveLength(3)
      expect(result[0].name).toBe('John')
      expect(result[2].name).toBe('Bob')
    })

    it('handles empty lines', () => {
      const jsonl = `{"name": "John"}

{"name": "Jane"}
`

      const result = parseJSONL(jsonl)
      expect(result).toHaveLength(2)
    })

    it('handles trailing newline', () => {
      const jsonl = `{"name": "John"}
{"name": "Jane"}
`

      const result = parseJSONL(jsonl)
      expect(result).toHaveLength(2)
    })
  })

  describe('XML Parsing', () => {
    it('parses simple XML', () => {
      const xml = `<?xml version="1.0"?>
<users>
  <user>
    <name>John</name>
    <email>john@example.com</email>
  </user>
  <user>
    <name>Jane</name>
    <email>jane@example.com</email>
  </user>
</users>`

      const result = parseXML(xml, { itemPath: 'users.user' })

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('John')
    })

    it('handles XML attributes', () => {
      const xml = `<users>
  <user id="1" active="true">
    <name>John</name>
  </user>
</users>`

      const result = parseXML(xml, { itemPath: 'users.user' })
      expect(result[0]['@id']).toBe('1')
      expect(result[0]['@active']).toBe('true')
    })
  })

  describe('YAML Parsing', () => {
    it('parses YAML array', () => {
      const yaml = `- name: John
  email: john@example.com
- name: Jane
  email: jane@example.com`

      const result = parseYAML(yaml)

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('John')
    })

    it('parses YAML with nested data', () => {
      const yaml = `data:
  users:
    - name: John
    - name: Jane
meta:
  total: 2`

      const result = parseYAML(yaml, { dataPath: 'data.users' })
      expect(result).toHaveLength(2)
    })
  })
})

// ============================================================================
// Format Detection Tests
// ============================================================================

describe('Format Detection', () => {
  describe('From URL Extension', () => {
    it('detects csv from extension', () => {
      expect(detectFormat('https://example.com/data.csv')).toBe('csv')
    })

    it('detects json from extension', () => {
      expect(detectFormat('https://example.com/data.json')).toBe('json')
    })

    it('handles query parameters', () => {
      expect(detectFormat('https://example.com/data.csv?token=abc')).toBe('csv')
    })

    it('handles URL fragments', () => {
      expect(detectFormat('https://example.com/data.json#section')).toBe('json')
    })
  })

  describe('From Content-Type Header', () => {
    it('detects from text/csv', () => {
      expect(detectFormat(null, 'text/csv')).toBe('csv')
    })

    it('detects from application/json', () => {
      expect(detectFormat(null, 'application/json')).toBe('json')
    })

    it('detects from text/tab-separated-values', () => {
      expect(detectFormat(null, 'text/tab-separated-values')).toBe('tsv')
    })

    it('detects from application/xml', () => {
      expect(detectFormat(null, 'application/xml')).toBe('xml')
    })

    it('detects from text/yaml', () => {
      expect(detectFormat(null, 'text/yaml')).toBe('yaml')
    })

    it('handles charset in content-type', () => {
      expect(detectFormat(null, 'application/json; charset=utf-8')).toBe('json')
    })
  })

  describe('From Content Sniffing', () => {
    it('detects JSON from content', () => {
      const content = '{"name": "John"}'
      expect(detectFormat(null, null, content)).toBe('json')
    })

    it('detects JSON array from content', () => {
      const content = '[{"name": "John"}]'
      expect(detectFormat(null, null, content)).toBe('json')
    })

    it('detects CSV from content', () => {
      const content = 'name,email\nJohn,john@example.com'
      expect(detectFormat(null, null, content)).toBe('csv')
    })

    it('detects XML from content', () => {
      const content = '<?xml version="1.0"?><root></root>'
      expect(detectFormat(null, null, content)).toBe('xml')
    })

    it('detects YAML from content', () => {
      const content = '---\nname: John\nemail: john@example.com'
      expect(detectFormat(null, null, content)).toBe('yaml')
    })
  })
})

// ============================================================================
// Seed Data Fetching Tests
// ============================================================================

describe('Seed Data Fetching', () => {
  describe('Single Request', () => {
    it('fetches data from URL', async () => {
      const csvData = 'name,email\nJohn,john@example.com'
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(csvData),
        headers: new Headers({ 'Content-Type': 'text/csv' }),
      })

      const config = parseSeedConfig('https://example.com/users.csv')
      const result = await fetchSeedData(config)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('John')
    })

    it('includes custom headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('[]'),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })

      const config = parseSeedConfig({
        url: 'https://api.example.com/users',
        headers: { 'Authorization': 'Bearer token123' },
      })

      await fetchSeedData(config)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer token123',
          }),
        })
      )
    })

    it('handles fetch errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const config = parseSeedConfig('https://example.com/missing.csv')

      await expect(fetchSeedData(config)).rejects.toThrow('404')
    })

    it('handles network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const config = parseSeedConfig('https://example.com/data.csv')

      await expect(fetchSeedData(config)).rejects.toThrow('Network error')
    })
  })

  describe('Paginated Fetching', () => {
    it('follows cursor pagination', async () => {
      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              data: [{ id: 1, name: 'John' }],
              next_cursor: 'cursor123',
            })
          ),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })

      // Second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              data: [{ id: 2, name: 'Jane' }],
              next_cursor: null,
            })
          ),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })

      const config = parseSeedConfig({
        url: 'https://api.example.com/users',
        $data: '$.data',
        $next: '$.next_cursor',
      })

      const result = await fetchSeedData(config)

      expect(result).toHaveLength(2)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('follows offset pagination', async () => {
      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              results: [{ id: 1 }, { id: 2 }],
              total: 4,
            })
          ),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })

      // Second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              results: [{ id: 3 }, { id: 4 }],
              total: 4,
            })
          ),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })

      const config = parseSeedConfig({
        url: 'https://api.example.com/users',
        $data: '$.results',
        $next: {
          type: 'offset',
          param: 'offset',
          limit: 2,
          total: '$.total',
        },
      })

      const result = await fetchSeedData(config)

      expect(result).toHaveLength(4)
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.stringContaining('offset=2'),
        expect.anything()
      )
    })

    it('follows Link header pagination', async () => {
      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('[{"id": 1}]'),
        headers: new Headers({
          'Content-Type': 'application/json',
          'Link': '<https://api.example.com/users?page=2>; rel="next"',
        }),
      })

      // Second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('[{"id": 2}]'),
        headers: new Headers({
          'Content-Type': 'application/json',
        }),
      })

      const config = parseSeedConfig({
        url: 'https://api.example.com/users',
        $next: { type: 'link-header', rel: 'next' },
      })

      const result = await fetchSeedData(config)

      expect(result).toHaveLength(2)
    })

    it('respects max pages limit', async () => {
      // Setup infinite pagination
      for (let i = 0; i < 10; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                data: [{ id: i }],
                next: `cursor${i + 1}`,
              })
            ),
          headers: new Headers({ 'Content-Type': 'application/json' }),
        })
      }

      const config = parseSeedConfig({
        url: 'https://api.example.com/users',
        $data: '$.data',
        $next: '$.next',
        maxPages: 3,
      })

      const result = await fetchSeedData(config)

      expect(result).toHaveLength(3)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })
})

// ============================================================================
// Entity Creation Tests
// ============================================================================

describe('Entity Creation from Seed', () => {
  describe('ID Extraction', () => {
    it('uses idField to set entity $id', () => {
      const row = { user_id: 'USR123', name: 'John' }
      const type = { $seed: { idField: 'user_id' } }

      const entity = createEntityFromSeed(row, type)

      expect(entity.$id).toBe('USR123')
    })

    it('uses JSONPath idField', () => {
      const row = { data: { id: 'nested-id' }, name: 'John' }
      const type = { $seed: { idField: '$.data.id' } }

      const entity = createEntityFromSeed(row, type)

      expect(entity.$id).toBe('nested-id')
    })

    it('generates ID when idField not specified', () => {
      const row = { name: 'John' }
      const type = { $seed: { url: 'https://example.com/data.csv' } }

      const entity = createEntityFromSeed(row, type)

      expect(entity.$id).toBeDefined()
      expect(typeof entity.$id).toBe('string')
    })

    it('applies transform to idField', () => {
      const row = { name: 'John Doe' }
      const type = { $seed: { idField: 'slugify($.name)' } }

      const entity = createEntityFromSeed(row, type)

      expect(entity.$id).toBe('john-doe')
    })
  })

  describe('Type Assignment', () => {
    it('sets $type from schema type name', () => {
      const row = { name: 'John' }
      const type = { $seed: { url: 'https://example.com/data.csv' } }

      const entity = createEntityFromSeed(row, type, { typeName: 'User' })

      expect(entity.$type).toBe('User')
    })
  })

  describe('Field Mapping', () => {
    it('maps all row fields to entity', () => {
      const row = {
        name: 'John',
        email: 'john@example.com',
        age: 30,
      }
      const type = { $seed: { url: 'https://example.com/data.csv' } }

      const entity = createEntityFromSeed(row, type)

      expect(entity.name).toBe('John')
      expect(entity.email).toBe('john@example.com')
      expect(entity.age).toBe(30)
    })

    it('applies field mapping configuration', () => {
      const row = { user_name: 'John', user_email: 'john@example.com' }
      const type = {
        $seed: {
          url: 'https://example.com/data.csv',
          mapping: {
            name: '$.user_name',
            email: '$.user_email',
          },
        },
      }

      const entity = createEntityFromSeed(row, type)

      expect(entity.name).toBe('John')
      expect(entity.email).toBe('john@example.com')
    })

    it('excludes seed directive fields from entity', () => {
      const row = { name: 'John', email: 'john@example.com' }
      const type = { $seed: { url: 'https://example.com/data.csv' } }

      const entity = createEntityFromSeed(row, type)

      expect(entity.$seed).toBeUndefined()
    })
  })

  describe('Type Coercion', () => {
    it('coerces string numbers from CSV', () => {
      const row = { name: 'John', age: '30', score: '95.5' }
      const type = {
        $seed: { url: 'https://example.com/data.csv' },
        age: 'number',
        score: 'number',
      }

      const entity = createEntityFromSeed(row, type)

      expect(entity.age).toBe(30)
      expect(entity.score).toBe(95.5)
    })

    it('coerces string booleans from CSV', () => {
      const row = { name: 'John', active: 'true', verified: 'false' }
      const type = {
        $seed: { url: 'https://example.com/data.csv' },
        active: 'boolean',
        verified: 'boolean',
      }

      const entity = createEntityFromSeed(row, type)

      expect(entity.active).toBe(true)
      expect(entity.verified).toBe(false)
    })

    it('parses date strings', () => {
      const row = { name: 'John', createdAt: '2024-01-15T10:30:00Z' }
      const type = {
        $seed: { url: 'https://example.com/data.csv' },
        createdAt: 'date',
      }

      const entity = createEntityFromSeed(row, type)

      expect(entity.createdAt).toBeInstanceOf(Date)
    })
  })
})

// ============================================================================
// Full Seed Processing Tests
// ============================================================================

describe('Full Seed Processing', () => {
  it('processes CSV seed and creates entities', async () => {
    const csvData = `user_id,name,email
USR001,John,john@example.com
USR002,Jane,jane@example.com`

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(csvData),
      headers: new Headers({ 'Content-Type': 'text/csv' }),
    })

    const type = {
      $seed: {
        url: 'https://example.com/users.csv',
        idField: 'user_id',
      },
      name: 'string',
      email: 'string',
    }

    const entities = await processSeedDirective(type, { typeName: 'User' })

    expect(entities).toHaveLength(2)
    expect(entities[0].$id).toBe('USR001')
    expect(entities[0].$type).toBe('User')
    expect(entities[0].name).toBe('John')
  })

  it('processes JSON API seed with pagination', async () => {
    // First page
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            users: [{ id: 1, name: 'John' }],
            meta: { next: 'page2' },
          })
        ),
      headers: new Headers({ 'Content-Type': 'application/json' }),
    })

    // Second page
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            users: [{ id: 2, name: 'Jane' }],
            meta: { next: null },
          })
        ),
      headers: new Headers({ 'Content-Type': 'application/json' }),
    })

    const type = {
      $seed: {
        url: 'https://api.example.com/users',
        $data: '$.users',
        $next: '$.meta.next',
        idField: '$.id',
      },
    }

    const entities = await processSeedDirective(type, { typeName: 'User' })

    expect(entities).toHaveLength(2)
    expect(entities[0].$id).toBe('1')
    expect(entities[1].$id).toBe('2')
  })

  it('applies transform to seed data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify([
            { FIRST_NAME: 'JOHN', LAST_NAME: 'DOE' },
            { FIRST_NAME: 'JANE', LAST_NAME: 'SMITH' },
          ])
        ),
      headers: new Headers({ 'Content-Type': 'application/json' }),
    })

    const type = {
      $seed: {
        url: 'https://api.example.com/users',
        transform: (rows: Array<{ FIRST_NAME: string; LAST_NAME: string }>) =>
          rows.map((r) => ({
            name: `${r.FIRST_NAME} ${r.LAST_NAME}`.toLowerCase(),
          })),
      },
    }

    const entities = await processSeedDirective(type, { typeName: 'User' })

    expect(entities[0].name).toBe('john doe')
    expect(entities[1].name).toBe('jane smith')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Seed Error Handling', () => {
  it('throws on invalid URL', async () => {
    const type = { $seed: 'not-a-valid-url' }

    await expect(processSeedDirective(type)).rejects.toThrow('Invalid URL')
  })

  it('throws on parse error with helpful message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('invalid json {'),
      headers: new Headers({ 'Content-Type': 'application/json' }),
    })

    const type = { $seed: 'https://example.com/data.json' }

    await expect(processSeedDirective(type)).rejects.toThrow(/parse/i)
  })

  it('includes row number in CSV parse errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('name,email\nJohn\nJane,jane@example.com'),
      headers: new Headers({ 'Content-Type': 'text/csv' }),
    })

    const type = { $seed: 'https://example.com/data.csv' }

    await expect(processSeedDirective(type)).rejects.toThrow(/row 2/i)
  })

  it('handles rate limiting with retry', async () => {
    // First call: rate limited
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '1' }),
    })

    // Second call: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('[{"id": 1}]'),
      headers: new Headers({ 'Content-Type': 'application/json' }),
    })

    const type = {
      $seed: {
        url: 'https://api.example.com/users',
        retry: { maxRetries: 3, backoff: 'exponential' },
      },
    }

    const entities = await processSeedDirective(type)

    expect(entities).toHaveLength(1)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

// ============================================================================
// Pagination Info Extraction Tests
// ============================================================================

describe('Pagination Info Extraction', () => {
  describe('Cursor Pagination', () => {
    it('extracts cursor from response', () => {
      const response = { data: [], meta: { cursor: 'abc123' } }
      const config = { pagination: { nextPath: '$.meta.cursor' } }

      const next = extractPaginationInfo(response, config)

      expect(next.cursor).toBe('abc123')
      expect(next.hasMore).toBe(true)
    })

    it('detects end of pagination', () => {
      const response = { data: [], meta: { cursor: null } }
      const config = { pagination: { nextPath: '$.meta.cursor' } }

      const next = extractPaginationInfo(response, config)

      expect(next.hasMore).toBe(false)
    })
  })

  describe('Offset Pagination', () => {
    it('calculates next offset', () => {
      const response = { results: [{}, {}], total: 10 }
      const config = {
        pagination: {
          type: 'offset',
          limit: 2,
          totalPath: '$.total',
        },
        currentOffset: 0,
      }

      const next = extractPaginationInfo(response, config)

      expect(next.offset).toBe(2)
      expect(next.hasMore).toBe(true)
    })

    it('detects end of offset pagination', () => {
      const response = { results: [{}, {}], total: 10 }
      const config = {
        pagination: {
          type: 'offset',
          limit: 2,
          totalPath: '$.total',
        },
        currentOffset: 8,
      }

      const next = extractPaginationInfo(response, config)

      expect(next.hasMore).toBe(false)
    })
  })

  describe('Link Header Pagination', () => {
    it('parses Link header for next URL', () => {
      const headers = new Headers({
        Link: '<https://api.example.com/users?page=2>; rel="next", <https://api.example.com/users?page=5>; rel="last"',
      })
      const config = { pagination: { type: 'link-header', rel: 'next' } }

      const next = extractPaginationInfo(null, config, headers)

      expect(next.url).toBe('https://api.example.com/users?page=2')
      expect(next.hasMore).toBe(true)
    })

    it('detects no more pages from Link header', () => {
      const headers = new Headers({
        Link: '<https://api.example.com/users?page=1>; rel="first"',
      })
      const config = { pagination: { type: 'link-header', rel: 'next' } }

      const next = extractPaginationInfo(null, config, headers)

      expect(next.hasMore).toBe(false)
    })
  })
})
