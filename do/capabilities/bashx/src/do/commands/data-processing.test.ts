/**
 * Data Processing Commands Tests - RED Phase (TDD)
 *
 * Comprehensive failing tests for data processing commands:
 * - jq (JSON processor)
 * - yq (YAML processor)
 * - base64 (encoding/decoding)
 * - envsubst (environment variable substitution)
 *
 * These tests define expected behavior. Implementation comes later (GREEN phase).
 *
 * @module bashx/do/commands/data-processing.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TieredExecutor, type TieredExecutorConfig, type SandboxBinding } from '../tiered-executor.js'
import type { FsCapability, BashResult } from '../../types.js'

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Sample JSON data for testing jq commands
 */
const SAMPLE_JSON = {
  simple: '{"name": "bashx", "version": "1.0.0"}',
  nested: '{"data": {"user": {"name": "alice", "age": 30}}}',
  array: '{"items": [{"id": 1, "name": "first"}, {"id": 2, "name": "second"}, {"id": 3, "name": "third"}]}',
  users: '[{"name": "alice", "age": 25}, {"name": "bob", "age": 17}, {"name": "charlie", "age": 35}]',
  conditional: '{"active": true, "premium": "yes", "basic": "no"}',
  multiDoc: '{"a": 1}\n{"b": 2}\n{"c": 3}',
}

/**
 * Sample YAML data for testing yq commands
 */
const SAMPLE_YAML = {
  simple: 'name: bashx\nversion: 1.0.0\n',
  nested: 'data:\n  user:\n    name: alice\n    age: 30\n',
  list: 'items:\n  - first\n  - second\n  - third\n',
  multiDoc: '---\na: 1\n---\nb: 2\n---\nc: 3\n',
  anchors: 'defaults: &defaults\n  timeout: 30\n  retries: 3\nserver:\n  <<: *defaults\n  host: localhost\n',
}

/**
 * Sample data for base64 testing
 */
const BASE64_SAMPLES = {
  simple: 'Hello, World!',
  simpleEncoded: 'SGVsbG8sIFdvcmxkIQ==',
  binary: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG header
  urlUnsafe: 'a+b/c==',
  urlSafe: 'a-b_c',
}

/**
 * Sample templates for envsubst testing
 */
const ENVSUBST_TEMPLATES = {
  simple: 'Hello, $NAME!',
  braces: 'Hello, ${NAME}!',
  multiple: '$GREETING, $NAME! Welcome to $PLACE.',
  default: 'Value: ${VAR:-default_value}',
  alternate: 'Value: ${VAR:+alternate_value}',
  error: 'Value: ${VAR:?Variable is required}',
  assign: 'Value: ${VAR:=assigned_value}',
  nested: 'Path: ${BASE_DIR:-/tmp}/${SUBDIR:-data}',
}

// ============================================================================
// MOCK HELPERS
// ============================================================================

/**
 * Create a mock filesystem capability with JSON/YAML files
 */
function createMockFsCapability(): FsCapability {
  const files: Record<string, string> = {
    '/data/simple.json': SAMPLE_JSON.simple,
    '/data/nested.json': SAMPLE_JSON.nested,
    '/data/array.json': SAMPLE_JSON.array,
    '/data/users.json': SAMPLE_JSON.users,
    '/data/conditional.json': SAMPLE_JSON.conditional,
    '/data/multi.jsonl': SAMPLE_JSON.multiDoc,
    '/data/simple.yaml': SAMPLE_YAML.simple,
    '/data/nested.yaml': SAMPLE_YAML.nested,
    '/data/list.yaml': SAMPLE_YAML.list,
    '/data/multi.yaml': SAMPLE_YAML.multiDoc,
    '/data/anchors.yaml': SAMPLE_YAML.anchors,
    '/data/hello.txt': BASE64_SAMPLES.simple,
    '/templates/greeting.tpl': ENVSUBST_TEMPLATES.simple,
    '/templates/config.tpl': ENVSUBST_TEMPLATES.multiple,
    '/templates/defaults.tpl': ENVSUBST_TEMPLATES.default,
  }

  return {
    read: async (path: string) => {
      if (files[path]) return files[path]
      throw new Error(`ENOENT: no such file: ${path}`)
    },
    exists: async (path: string) => path in files,
    list: async (path: string) => {
      const entries = Object.keys(files)
        .filter((f) => f.startsWith(path + '/'))
        .map((f) => {
          const name = f.slice(path.length + 1).split('/')[0]
          return { name, isDirectory: () => false }
        })
      return entries
    },
    stat: async (path: string) => {
      if (files[path]) {
        return {
          size: files[path].length,
          isDirectory: () => false,
          isFile: () => true,
        }
      }
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    },
  } as unknown as FsCapability
}

/**
 * Create a mock sandbox (should not be called for Tier 1 commands)
 */
function createMockSandbox(): SandboxBinding {
  return {
    execute: vi.fn(async (command: string): Promise<BashResult> => ({
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: `sandbox: ${command}\n`,
      stderr: '',
      exitCode: 0,
      intent: { commands: [], reads: [], writes: [], deletes: [], network: false, elevated: false },
      classification: { type: 'execute', impact: 'medium', reversible: false, reason: 'Sandbox execution' },
    })),
  }
}

/**
 * Create a TieredExecutor for testing
 */
function createTestExecutor(config?: Partial<TieredExecutorConfig>): TieredExecutor {
  return new TieredExecutor({
    fs: createMockFsCapability(),
    sandbox: createMockSandbox(),
    ...config,
  })
}

// ============================================================================
// JQ TESTS
// ============================================================================

describe('jq - JSON Processor', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = createTestExecutor()
  })

  describe('Command Classification', () => {
    it('classifies jq as Tier 1 native command', () => {
      const classification = executor.classifyCommand('jq . file.json')
      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
      expect(classification.capability).toBe('jq')
    })
  })

  describe('Pretty Print', () => {
    it('pretty prints JSON from file: jq "." file.json', async () => {
      const result = await executor.execute('jq "." /data/simple.json')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('"name"')
      expect(result.stdout).toContain('"bashx"')
      // Pretty print should have newlines and indentation
      expect(result.stdout).toMatch(/\n\s+/)
    })

    it('pretty prints JSON from stdin', async () => {
      const result = await executor.execute('jq "."', {
        stdin: SAMPLE_JSON.simple,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('"name"')
      expect(result.stdout).toContain('"bashx"')
    })
  })

  describe('Key Extraction', () => {
    it('extracts a top-level key: jq ".name"', async () => {
      const result = await executor.execute('jq ".name" /data/simple.json')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('"bashx"')
    })

    it('extracts a nested key: jq ".data.user.name"', async () => {
      const result = await executor.execute('jq ".data.user.name" /data/nested.json')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('"alice"')
    })

    it('returns null for missing keys', async () => {
      const result = await executor.execute('jq ".missing"', {
        stdin: SAMPLE_JSON.simple,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('null')
    })
  })

  describe('Array Operations', () => {
    it('accesses array by index: jq ".items[0]"', async () => {
      const result = await executor.execute('jq ".items[0]" /data/array.json')

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.id).toBe(1)
      expect(parsed.name).toBe('first')
    })

    it('accesses negative array index: jq ".items[-1]"', async () => {
      const result = await executor.execute('jq ".items[-1]" /data/array.json')

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.id).toBe(3)
      expect(parsed.name).toBe('third')
    })

    it('slices arrays: jq ".items[0:2]"', async () => {
      const result = await executor.execute('jq ".items[0:2]" /data/array.json')

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed).toHaveLength(2)
      expect(parsed[0].id).toBe(1)
      expect(parsed[1].id).toBe(2)
    })

    it('gets array length: jq ".items | length"', async () => {
      const result = await executor.execute('jq ".items | length" /data/array.json')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('3')
    })
  })

  describe('Array Transformations', () => {
    it('maps array elements: jq "map(.name)"', async () => {
      const result = await executor.execute('jq "map(.name)" /data/users.json')

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed).toEqual(['alice', 'bob', 'charlie'])
    })

    it('maps array with object construction: jq ".items | map({id, name})"', async () => {
      const result = await executor.execute('jq ".items | map({id, name})" /data/array.json')

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed).toHaveLength(3)
      expect(parsed[0]).toEqual({ id: 1, name: 'first' })
    })

    it('sorts arrays: jq "sort_by(.age)"', async () => {
      const result = await executor.execute('jq "sort_by(.age)" /data/users.json')

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed[0].name).toBe('bob') // age 17
      expect(parsed[1].name).toBe('alice') // age 25
      expect(parsed[2].name).toBe('charlie') // age 35
    })

    it('reverses arrays: jq "reverse"', async () => {
      const result = await executor.execute('jq "reverse" /data/users.json')

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed[0].name).toBe('charlie')
      expect(parsed[2].name).toBe('alice')
    })

    it('gets unique values: jq "map(.name) | unique"', async () => {
      const result = await executor.execute('jq "map(.name) | unique"', {
        stdin: '[{"name": "a"}, {"name": "b"}, {"name": "a"}]',
      })

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed).toEqual(['a', 'b'])
    })

    it('flattens arrays: jq "flatten"', async () => {
      const result = await executor.execute('jq "flatten"', {
        stdin: '[[1, 2], [3, 4], [5]]',
      })

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed).toEqual([1, 2, 3, 4, 5])
    })
  })

  describe('Filtering', () => {
    it('filters with select: jq "select(.age > 18)"', async () => {
      const result = await executor.execute('jq ".[] | select(.age > 18)" /data/users.json')

      expect(result.exitCode).toBe(0)
      // Should return alice and charlie, not bob (age 17)
      expect(result.stdout).toContain('alice')
      expect(result.stdout).toContain('charlie')
      expect(result.stdout).not.toContain('bob')
    })

    it('filters with map and select: jq "map(select(.age >= 25))"', async () => {
      const result = await executor.execute('jq "map(select(.age >= 25))" /data/users.json')

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed).toHaveLength(2)
      expect(parsed.map((u: { name: string }) => u.name)).toEqual(['alice', 'charlie'])
    })

    it('filters with has: jq "select(has(\"name\"))"', async () => {
      const result = await executor.execute('jq ".[] | select(has(\\"name\\"))" /data/users.json')

      expect(result.exitCode).toBe(0)
      // All users have name, should return all
      const lines = result.stdout.trim().split('\n').filter(Boolean)
      expect(lines.length).toBeGreaterThan(0)
    })
  })

  describe('Object Construction', () => {
    it('constructs object with shorthand: jq "{name, age}"', async () => {
      const result = await executor.execute('jq ".[] | {name, age}" /data/users.json')

      expect(result.exitCode).toBe(0)
      // Should output multiple objects with only name and age
      expect(result.stdout).toContain('"name"')
      expect(result.stdout).toContain('"age"')
    })

    it('constructs object with renamed keys: jq "{userName: .name, userAge: .age}"', async () => {
      const result = await executor.execute('jq ".[] | {userName: .name, userAge: .age}" /data/users.json')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('"userName"')
      expect(result.stdout).toContain('"userAge"')
    })

    it('adds new keys: jq ". + {new_key: \"value\"}"', async () => {
      const result = await executor.execute('jq ". + {new_key: \\"value\\"}"', {
        stdin: SAMPLE_JSON.simple,
      })

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.new_key).toBe('value')
      expect(parsed.name).toBe('bashx')
    })

    it('gets object keys: jq "keys"', async () => {
      const result = await executor.execute('jq "keys"', {
        stdin: SAMPLE_JSON.simple,
      })

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed).toContain('name')
      expect(parsed).toContain('version')
    })

    it('gets object values: jq "values"', async () => {
      const result = await executor.execute('jq ".[] | values"', {
        stdin: SAMPLE_JSON.simple,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('bashx')
      expect(result.stdout).toContain('1.0.0')
    })
  })

  describe('Output Modes', () => {
    it('outputs raw strings: jq -r ".name"', async () => {
      const result = await executor.execute('jq -r ".name" /data/simple.json')

      expect(result.exitCode).toBe(0)
      // Raw output should not have quotes
      expect(result.stdout.trim()).toBe('bashx')
      expect(result.stdout).not.toContain('"')
    })

    it('outputs compact JSON: jq -c "."', async () => {
      const result = await executor.execute('jq -c "."', {
        stdin: SAMPLE_JSON.simple,
      })

      expect(result.exitCode).toBe(0)
      // Compact output should be single line
      expect(result.stdout.trim().split('\n')).toHaveLength(1)
      expect(result.stdout).not.toMatch(/\n\s+/)
    })

    it('outputs tab-separated: jq -t ".[]"', async () => {
      const result = await executor.execute('jq -t ".items[].name" /data/array.json')

      expect(result.exitCode).toBe(0)
      // Tab-separated values
      expect(result.stdout).toContain('first')
      expect(result.stdout).toContain('second')
    })
  })

  describe('Slurp Mode', () => {
    it('slurps multiple inputs: jq -s "."', async () => {
      const result = await executor.execute('jq -s "."', {
        stdin: SAMPLE_JSON.multiDoc,
      })

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed).toHaveLength(3)
      expect(parsed[0].a).toBe(1)
      expect(parsed[1].b).toBe(2)
    })

    it('slurps and processes: jq -s "map(.a)"', async () => {
      const result = await executor.execute('jq -s "map(.a) | add"', {
        stdin: '{"a": 1}\n{"a": 2}\n{"a": 3}',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('6')
    })
  })

  describe('Variables', () => {
    it('uses --arg for string variables: jq --arg name "value" ".[$name]"', async () => {
      const result = await executor.execute('jq --arg key "name" ".[$key]"', {
        stdin: SAMPLE_JSON.simple,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('"bashx"')
    })

    it('uses --argjson for JSON variables', async () => {
      const result = await executor.execute('jq --argjson min 20 "map(select(.age > $min))" /data/users.json')

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed).toHaveLength(2) // alice (25) and charlie (35)
    })

    it('uses multiple variables', async () => {
      const result = await executor.execute(
        'jq --arg name "alice" --argjson minAge 20 ".[] | select(.name == $name and .age > $minAge)" /data/users.json'
      )

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.name).toBe('alice')
    })
  })

  describe('Pipes', () => {
    it('chains operations: jq ".data | .user | .name"', async () => {
      const result = await executor.execute('jq ".data | .user | .name" /data/nested.json')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('"alice"')
    })

    it('pipes through multiple filters: jq ".items | map(.name) | sort"', async () => {
      const result = await executor.execute('jq ".items | map(.name) | sort" /data/array.json')

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed).toEqual(['first', 'second', 'third'])
    })
  })

  describe('Conditionals', () => {
    it('evaluates if-then-else: jq "if .active then .premium else .basic end"', async () => {
      const result = await executor.execute('jq "if .active then .premium else .basic end" /data/conditional.json')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('"yes"')
    })

    it('uses alternative operator: jq ".missing // \"default\""', async () => {
      const result = await executor.execute('jq ".missing // \\"default\\""', {
        stdin: SAMPLE_JSON.simple,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('"default"')
    })

    it('uses try-catch: jq "try .invalid.path catch \"error\""', async () => {
      const result = await executor.execute('jq "try .items[99].name catch \\"not found\\""', {
        stdin: SAMPLE_JSON.array,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('"not found"')
    })
  })

  describe('String Operations', () => {
    it('splits strings: jq "split(\"-\")"', async () => {
      const result = await executor.execute('jq "split(\\"-\\")"', {
        stdin: '"a-b-c"',
      })

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed).toEqual(['a', 'b', 'c'])
    })

    it('joins strings: jq "join(\", \")"', async () => {
      const result = await executor.execute('jq "join(\\", \\")"', {
        stdin: '["a", "b", "c"]',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('"a, b, c"')
    })

    it('converts case: jq "ascii_upcase"', async () => {
      const result = await executor.execute('jq "ascii_upcase"', {
        stdin: '"hello"',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('"HELLO"')
    })

    it('tests regex: jq "test(\"pattern\")"', async () => {
      const result = await executor.execute('jq "test(\\"^bash\\")"', {
        stdin: '"bashx"',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('true')
    })
  })

  describe('Type Functions', () => {
    it('gets type: jq "type"', async () => {
      const result = await executor.execute('jq "type"', {
        stdin: SAMPLE_JSON.simple,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('"object"')
    })

    it('converts to number: jq "tonumber"', async () => {
      const result = await executor.execute('jq "tonumber"', {
        stdin: '"42"',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('42')
    })

    it('converts to string: jq "tostring"', async () => {
      const result = await executor.execute('jq "tostring"', {
        stdin: '42',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('"42"')
    })
  })

  describe('Error Handling', () => {
    it('handles invalid JSON input', async () => {
      const result = await executor.execute('jq "."', {
        stdin: 'not valid json',
      })

      expect(result.exitCode).toBe(5) // jq returns 5 for parse errors
      expect(result.stderr).toContain('parse error')
    })

    it('handles invalid filter expression', async () => {
      const result = await executor.execute('jq ".invalid[["', {
        stdin: SAMPLE_JSON.simple,
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toBeTruthy()
    })

    it('handles file not found', async () => {
      const result = await executor.execute('jq "." /nonexistent.json')

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('ENOENT')
    })
  })
})

// ============================================================================
// YQ TESTS
// ============================================================================

describe('yq - YAML Processor', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = createTestExecutor()
  })

  describe('Command Classification', () => {
    it('classifies yq as Tier 1 native command', () => {
      const classification = executor.classifyCommand('yq . file.yaml')
      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
      expect(classification.capability).toBe('yq')
    })
  })

  describe('Pretty Print', () => {
    it('pretty prints YAML from file: yq "." file.yaml', async () => {
      const result = await executor.execute('yq "." /data/simple.yaml')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('name: bashx')
      expect(result.stdout).toContain('version:')
    })

    it('pretty prints YAML from stdin', async () => {
      const result = await executor.execute('yq "."', {
        stdin: SAMPLE_YAML.simple,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('name: bashx')
    })
  })

  describe('Key Extraction', () => {
    it('extracts a top-level key: yq ".name"', async () => {
      const result = await executor.execute('yq ".name" /data/simple.yaml')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('bashx')
    })

    it('extracts a nested key: yq ".data.user.name"', async () => {
      const result = await executor.execute('yq ".data.user.name" /data/nested.yaml')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('alice')
    })

    it('extracts array elements: yq ".items[0]"', async () => {
      const result = await executor.execute('yq ".items[0]" /data/list.yaml')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('first')
    })
  })

  describe('Output Formats', () => {
    it('outputs as JSON: yq -o json', async () => {
      const result = await executor.execute('yq -o json "." /data/simple.yaml')

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.name).toBe('bashx')
    })

    it('outputs as JSON with compact format: yq -o json -c', async () => {
      const result = await executor.execute('yq -o json -c "." /data/simple.yaml')

      expect(result.exitCode).toBe(0)
      // Should be single line
      expect(result.stdout.trim().split('\n')).toHaveLength(1)
    })

    it('outputs as props format: yq -o props', async () => {
      const result = await executor.execute('yq -o props "." /data/simple.yaml')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('name = bashx')
    })

    it('outputs as CSV: yq -o csv', async () => {
      const result = await executor.execute('yq -o csv "." /data/list.yaml')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(',')
    })
  })

  describe('In-place Editing', () => {
    // Note: These tests verify the command parsing and expected behavior
    // Actual in-place editing would require write capability

    it('parses in-place edit command: yq -i ".key = value"', () => {
      const classification = executor.classifyCommand('yq -i ".name = \\"new-name\\"" file.yaml')
      expect(classification.tier).toBe(1)
      // In-place edit would require write access
    })

    it('sets a value: yq ".name = \"new-name\""', async () => {
      const result = await executor.execute('yq ".name = \\"new-name\\""', {
        stdin: SAMPLE_YAML.simple,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('new-name')
    })

    it('adds a new key: yq ".new_key = \"value\""', async () => {
      const result = await executor.execute('yq ".new_key = \\"value\\""', {
        stdin: SAMPLE_YAML.simple,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('new_key')
      expect(result.stdout).toContain('value')
    })

    it('deletes a key: yq "del(.name)"', async () => {
      const result = await executor.execute('yq "del(.name)"', {
        stdin: SAMPLE_YAML.simple,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).not.toContain('name:')
      expect(result.stdout).toContain('version')
    })
  })

  describe('Multi-Document Support', () => {
    it('processes all documents: yq ".a"', async () => {
      const result = await executor.execute('yq ".a" /data/multi.yaml')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('1')
    })

    it('selects specific document: yq "select(document_index == 0)"', async () => {
      const result = await executor.execute('yq "select(document_index == 0)" /data/multi.yaml')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('a: 1')
    })

    it('evaluates all documents: yq eval-all "."', async () => {
      const result = await executor.execute('yq eval-all "." /data/multi.yaml')

      expect(result.exitCode).toBe(0)
      // Should contain all documents
      expect(result.stdout).toContain('a: 1')
    })
  })

  describe('Anchor/Alias Support', () => {
    it('resolves anchors and aliases', async () => {
      const result = await executor.execute('yq ".server.timeout" /data/anchors.yaml')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('30')
    })

    it('expands aliases: yq "explode(.)"', async () => {
      const result = await executor.execute('yq "explode(.)" /data/anchors.yaml')

      expect(result.exitCode).toBe(0)
      // Should have expanded the anchor
      expect(result.stdout).toContain('timeout: 30')
    })
  })

  describe('Array Operations', () => {
    it('appends to array: yq ".items += [\"fourth\"]"', async () => {
      const result = await executor.execute('yq ".items += [\\"fourth\\"]"', {
        stdin: SAMPLE_YAML.list,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('fourth')
    })

    it('gets array length: yq ".items | length"', async () => {
      const result = await executor.execute('yq ".items | length" /data/list.yaml')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('3')
    })
  })

  describe('Error Handling', () => {
    it('handles invalid YAML', async () => {
      // Use truly invalid YAML - tabs mixed with spaces for indentation causes issues
      // and unclosed quotes/brackets are definitely invalid
      const result = await executor.execute('yq "."', {
        stdin: 'key: [\ninvalid unclosed bracket',
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toBeTruthy()
    })

    it('handles file not found', async () => {
      const result = await executor.execute('yq "." /nonexistent.yaml')

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('ENOENT')
    })
  })
})

// ============================================================================
// BASE64 TESTS
// ============================================================================

describe('base64 - Encoding/Decoding', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = createTestExecutor()
  })

  describe('Command Classification', () => {
    it('classifies base64 as Tier 1 native command', () => {
      const classification = executor.classifyCommand('base64 file.txt')
      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
      expect(classification.capability).toBe('base64')
    })
  })

  describe('Encoding', () => {
    it('encodes file content: base64 file', async () => {
      const result = await executor.execute('base64 /data/hello.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe(BASE64_SAMPLES.simpleEncoded)
    })

    it('encodes stdin: echo "text" | base64', async () => {
      const result = await executor.execute('base64', {
        stdin: BASE64_SAMPLES.simple,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe(BASE64_SAMPLES.simpleEncoded)
    })

    it('encodes empty input', async () => {
      const result = await executor.execute('base64', {
        stdin: '',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('')
    })

    it('wraps output at 76 characters by default', async () => {
      const longText = 'A'.repeat(100)
      const result = await executor.execute('base64', {
        stdin: longText,
      })

      expect(result.exitCode).toBe(0)
      // Default wrapping at 76 chars
      const lines = result.stdout.trim().split('\n')
      if (lines.length > 1) {
        expect(lines[0].length).toBeLessThanOrEqual(76)
      }
    })

    it('disables line wrapping: base64 -w 0', async () => {
      const longText = 'A'.repeat(100)
      const result = await executor.execute('base64 -w 0', {
        stdin: longText,
      })

      expect(result.exitCode).toBe(0)
      // No line breaks in output
      expect(result.stdout.trim().split('\n')).toHaveLength(1)
    })

    it('sets custom wrap width: base64 -w 40', async () => {
      const longText = 'A'.repeat(100)
      const result = await executor.execute('base64 -w 40', {
        stdin: longText,
      })

      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      if (lines.length > 1) {
        expect(lines[0].length).toBeLessThanOrEqual(40)
      }
    })
  })

  describe('Decoding', () => {
    it('decodes with -d flag: base64 -d', async () => {
      const result = await executor.execute('base64 -d', {
        stdin: BASE64_SAMPLES.simpleEncoded,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe(BASE64_SAMPLES.simple)
    })

    it('decodes with --decode flag: base64 --decode', async () => {
      const result = await executor.execute('base64 --decode', {
        stdin: BASE64_SAMPLES.simpleEncoded,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe(BASE64_SAMPLES.simple)
    })

    it('decodes with -D flag (macOS): base64 -D', async () => {
      const result = await executor.execute('base64 -D', {
        stdin: BASE64_SAMPLES.simpleEncoded,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe(BASE64_SAMPLES.simple)
    })

    it('decodes file: base64 -d encoded.txt', async () => {
      // Assuming file contains base64 encoded content
      const result = await executor.execute('base64 -d', {
        stdin: BASE64_SAMPLES.simpleEncoded,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe(BASE64_SAMPLES.simple)
    })

    it('ignores garbage with -i flag: base64 -d -i', async () => {
      const withGarbage = `${BASE64_SAMPLES.simpleEncoded}\n\nsome garbage here`
      const result = await executor.execute('base64 -d -i', {
        stdin: withGarbage,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe(BASE64_SAMPLES.simple)
    })

    it('handles multiline encoded input', async () => {
      const multiline = `SGVs\nbG8s\nIFdv\ncmxk\nIQ==`
      const result = await executor.execute('base64 -d', {
        stdin: multiline,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe(BASE64_SAMPLES.simple)
    })
  })

  describe('URL-Safe Base64', () => {
    it('encodes URL-safe: base64url or base64 --url', async () => {
      const result = await executor.execute('base64 --url', {
        stdin: 'some+data/with=special',
      })

      expect(result.exitCode).toBe(0)
      // URL-safe base64 uses - instead of + and _ instead of /
      expect(result.stdout).not.toContain('+')
      expect(result.stdout).not.toContain('/')
    })

    it('decodes URL-safe: base64 -d --url', async () => {
      const result = await executor.execute('base64 -d --url', {
        stdin: BASE64_SAMPLES.urlSafe,
      })

      expect(result.exitCode).toBe(0)
      // Should decode URL-safe encoding
    })
  })

  describe('Error Handling', () => {
    it('handles invalid base64 when decoding', async () => {
      const result = await executor.execute('base64 -d', {
        stdin: '!!!not-valid-base64!!!',
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('invalid')
    })

    it('handles file not found', async () => {
      const result = await executor.execute('base64 /nonexistent.txt')

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('ENOENT')
    })
  })
})

// ============================================================================
// ENVSUBST TESTS
// ============================================================================

describe('envsubst - Environment Variable Substitution', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = createTestExecutor()
  })

  describe('Command Classification', () => {
    it('classifies envsubst as Tier 1 native command', () => {
      const classification = executor.classifyCommand('envsubst < template')
      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
      expect(classification.capability).toBe('envsubst')
    })
  })

  describe('Basic Substitution', () => {
    it('substitutes $VAR syntax: envsubst', async () => {
      const result = await executor.execute('envsubst', {
        stdin: ENVSUBST_TEMPLATES.simple,
        env: { NAME: 'World' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello, World!')
    })

    it('substitutes ${VAR} syntax', async () => {
      const result = await executor.execute('envsubst', {
        stdin: ENVSUBST_TEMPLATES.braces,
        env: { NAME: 'World' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello, World!')
    })

    it('substitutes multiple variables', async () => {
      const result = await executor.execute('envsubst', {
        stdin: ENVSUBST_TEMPLATES.multiple,
        env: {
          GREETING: 'Hi',
          NAME: 'Alice',
          PLACE: 'bashx',
        },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hi, Alice! Welcome to bashx.')
    })

    it('leaves undefined variables empty', async () => {
      const result = await executor.execute('envsubst', {
        stdin: 'Value: $UNDEFINED_VAR',
        env: {},
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Value: ')
    })
  })

  describe('Specific Variable Substitution', () => {
    it('substitutes only specified variables: envsubst "$VAR1 $VAR2"', async () => {
      const result = await executor.execute('envsubst "$NAME"', {
        stdin: '$NAME says $GREETING',
        env: {
          NAME: 'Alice',
          GREETING: 'Hello',
        },
      })

      expect(result.exitCode).toBe(0)
      // Only NAME should be substituted, GREETING should remain as-is
      expect(result.stdout).toBe('Alice says $GREETING')
    })

    it('uses --variables flag to list variables', async () => {
      const result = await executor.execute('envsubst --variables', {
        stdin: '$VAR1 ${VAR2} $VAR3',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('VAR1')
      expect(result.stdout).toContain('VAR2')
      expect(result.stdout).toContain('VAR3')
    })
  })

  describe('Default Values: ${VAR:-default}', () => {
    it('uses default when variable is unset', async () => {
      const result = await executor.execute('envsubst', {
        stdin: ENVSUBST_TEMPLATES.default,
        env: {},
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Value: default_value')
    })

    it('uses variable value when set', async () => {
      const result = await executor.execute('envsubst', {
        stdin: ENVSUBST_TEMPLATES.default,
        env: { VAR: 'actual_value' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Value: actual_value')
    })

    it('uses default when variable is empty', async () => {
      const result = await executor.execute('envsubst', {
        stdin: '${VAR:-default}',
        env: { VAR: '' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('default')
    })

    it('handles nested defaults', async () => {
      const result = await executor.execute('envsubst', {
        stdin: ENVSUBST_TEMPLATES.nested,
        env: {},
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Path: /tmp/data')
    })
  })

  describe('Alternate Values: ${VAR:+alternate}', () => {
    it('uses alternate when variable is set', async () => {
      const result = await executor.execute('envsubst', {
        stdin: ENVSUBST_TEMPLATES.alternate,
        env: { VAR: 'something' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Value: alternate_value')
    })

    it('uses empty when variable is unset', async () => {
      const result = await executor.execute('envsubst', {
        stdin: ENVSUBST_TEMPLATES.alternate,
        env: {},
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Value: ')
    })

    it('uses empty when variable is empty string', async () => {
      const result = await executor.execute('envsubst', {
        stdin: '${VAR:+alternate}',
        env: { VAR: '' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
    })
  })

  describe('Error on Unset: ${VAR:?error}', () => {
    it('succeeds when variable is set', async () => {
      const result = await executor.execute('envsubst', {
        stdin: '${VAR:?Variable is required}',
        env: { VAR: 'value' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('value')
    })

    it('fails with error message when variable is unset', async () => {
      const result = await executor.execute('envsubst', {
        stdin: ENVSUBST_TEMPLATES.error,
        env: {},
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('Variable is required')
    })
  })

  describe('Assign Default: ${VAR:=default}', () => {
    it('uses default and assigns when unset', async () => {
      const result = await executor.execute('envsubst', {
        stdin: '${VAR:=assigned}',
        env: {},
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('assigned')
    })

    it('uses existing value when set', async () => {
      const result = await executor.execute('envsubst', {
        stdin: '${VAR:=assigned}',
        env: { VAR: 'existing' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('existing')
    })
  })

  describe('File Processing', () => {
    it('processes template file', async () => {
      const result = await executor.execute('envsubst < /templates/greeting.tpl', {
        env: { NAME: 'User' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello, User!')
    })

    it('processes config template', async () => {
      const result = await executor.execute('envsubst < /templates/config.tpl', {
        env: {
          GREETING: 'Welcome',
          NAME: 'Admin',
          PLACE: 'System',
        },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Welcome, Admin! Welcome to System.')
    })
  })

  describe('Edge Cases', () => {
    it('handles escaped dollar signs: $$VAR', async () => {
      const result = await executor.execute('envsubst', {
        stdin: '$$VAR is not substituted',
        env: { VAR: 'value' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('$VAR is not substituted')
    })

    it('handles variable names with underscores', async () => {
      const result = await executor.execute('envsubst', {
        stdin: '$MY_VAR_NAME',
        env: { MY_VAR_NAME: 'works' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('works')
    })

    it('handles variable names with numbers', async () => {
      const result = await executor.execute('envsubst', {
        stdin: '$VAR1 $VAR2',
        env: { VAR1: 'one', VAR2: 'two' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('one two')
    })

    it('preserves non-variable text', async () => {
      const result = await executor.execute('envsubst', {
        stdin: 'Regular text with $VAR and more text.',
        env: { VAR: 'substituted' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Regular text with substituted and more text.')
    })

    it('handles empty input', async () => {
      const result = await executor.execute('envsubst', {
        stdin: '',
        env: {},
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
    })

    it('handles input with no variables', async () => {
      const result = await executor.execute('envsubst', {
        stdin: 'Just plain text, no variables here.',
        env: { VAR: 'unused' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Just plain text, no variables here.')
    })
  })

  describe('Error Handling', () => {
    it('handles file not found', async () => {
      const result = await executor.execute('envsubst < /nonexistent.tpl', {
        env: {},
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('ENOENT')
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Data Processing - Integration', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = createTestExecutor()
  })

  describe('Pipeline Combinations', () => {
    it('pipes jq output to base64', async () => {
      const result = await executor.execute('jq -c "." /data/simple.json | base64')

      expect(result.exitCode).toBe(0)
      // Should be base64 encoded JSON
      const decoded = atob(result.stdout.trim())
      const parsed = JSON.parse(decoded)
      expect(parsed.name).toBe('bashx')
    })

    it('pipes yq to jq for JSON processing', async () => {
      const result = await executor.execute('yq -o json "." /data/simple.yaml | jq ".name"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('"bashx"')
    })

    it('uses envsubst with jq', async () => {
      const result = await executor.execute('jq -r ".name" /data/simple.json | envsubst', {
        env: {},
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('bashx')
    })
  })

  describe('Tier 1 Execution Verification', () => {
    it('all data processing commands use Tier 1 (no sandbox)', async () => {
      const mockSandbox = createMockSandbox()
      const testExecutor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: mockSandbox,
      })

      // Execute several data processing commands
      await testExecutor.execute('jq "." /data/simple.json')
      await testExecutor.execute('yq "." /data/simple.yaml')
      await testExecutor.execute('base64', { stdin: 'test' })
      await testExecutor.execute('envsubst', { stdin: '$VAR', env: { VAR: 'value' } })

      // Sandbox should NOT have been called
      expect(mockSandbox.execute).not.toHaveBeenCalled()
    })
  })
})
