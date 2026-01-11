/**
 * RED Phase Tests: YAML config parser
 * Issue: dotdo-fsdui
 *
 * These tests define the expected behavior for the YAML config parser.
 * They should FAIL until the implementation is complete.
 */
import { describe, it, expect } from 'vitest'
import {
  parseYAML,
  parseYAMLConfig,
  YAMLParseError,
  resolveEnvVars,
  resolveIncludes
} from '../yaml-parser'
import type { BenthosConfig } from '../config'

describe('YAML Parser', () => {
  describe('Basic YAML parsing', () => {
    it('parses simple key-value pairs', () => {
      const yaml = `
input:
  stdin: {}
output:
  stdout: {}
`
      const result = parseYAML(yaml)

      expect(result.input).toEqual({ stdin: {} })
      expect(result.output).toEqual({ stdout: {} })
    })

    it('parses nested structures', () => {
      const yaml = `
input:
  kafka:
    addresses:
      - localhost:9092
    topics:
      - my-topic
    consumer_group: my-group
`
      const result = parseYAML(yaml)

      expect(result.input.kafka.addresses).toEqual(['localhost:9092'])
      expect(result.input.kafka.topics).toEqual(['my-topic'])
      expect(result.input.kafka.consumer_group).toBe('my-group')
    })

    it('parses arrays of objects', () => {
      const yaml = `
pipeline:
  processors:
    - mapping: 'root = this'
    - filter: 'this.keep == true'
    - mapping: 'root.processed = true'
`
      const result = parseYAML(yaml)

      expect(result.pipeline.processors).toHaveLength(3)
      expect(result.pipeline.processors[0].mapping).toBe('root = this')
    })

    it('parses multiline strings with |', () => {
      const yaml = `
pipeline:
  processors:
    - mapping: |
        root = this
        root.field = "value"
        root.timestamp = now()
`
      const result = parseYAML(yaml)

      expect(result.pipeline.processors[0].mapping).toContain('root = this')
      expect(result.pipeline.processors[0].mapping).toContain('root.field = "value"')
    })

    it('parses literal strings with >', () => {
      const yaml = `
description: >
  This is a long description
  that spans multiple lines
  but will be folded into one.
`
      const result = parseYAML(yaml)

      // Folded style joins lines with spaces, may have trailing newline
      const desc = (result.description as string).trim()
      expect(desc).not.toMatch(/\n/)
      expect(desc).toContain('This is a long description')
    })

    it('preserves numeric types', () => {
      const yaml = `
config:
  integer: 42
  float: 3.14
  negative: -17
  scientific: 1e10
`
      const result = parseYAML(yaml)

      expect(result.config.integer).toBe(42)
      expect(result.config.float).toBe(3.14)
      expect(result.config.negative).toBe(-17)
      expect(result.config.scientific).toBe(1e10)
    })

    it('preserves boolean types', () => {
      const yaml = `
config:
  enabled: true
  disabled: false
  yes_value: yes
  no_value: no
`
      const result = parseYAML(yaml)

      expect(result.config.enabled).toBe(true)
      expect(result.config.disabled).toBe(false)
      expect(result.config.yes_value).toBe(true)
      expect(result.config.no_value).toBe(false)
    })

    it('handles null values', () => {
      const yaml = `
config:
  explicit_null: null
  tilde_null: ~
  empty:
`
      const result = parseYAML(yaml)

      expect(result.config.explicit_null).toBeNull()
      expect(result.config.tilde_null).toBeNull()
      expect(result.config.empty).toBeNull()
    })
  })

  describe('Environment variable resolution', () => {
    it('resolves ${VAR} syntax', () => {
      process.env.TEST_VAR = 'test_value'

      const yaml = `
input:
  kafka:
    addresses:
      - \${TEST_VAR}
    topics:
      - test
output:
  drop: {}
`
      const result = parseYAMLConfig(yaml)

      expect(result.input.kafka.addresses[0]).toBe('test_value')

      delete process.env.TEST_VAR
    })

    it('resolves ${VAR:default} syntax with default', () => {
      delete process.env.MISSING_VAR

      const yaml = `
input:
  kafka:
    addresses:
      - \${MISSING_VAR:localhost:9092}
    topics:
      - test
output:
  drop: {}
`
      const result = parseYAMLConfig(yaml)

      expect(result.input.kafka.addresses[0]).toBe('localhost:9092')
    })

    it('resolves ${VAR:-default} syntax with default when empty', () => {
      process.env.EMPTY_VAR = ''

      const yaml = `
input:
  generate:
    mapping: root = "\${EMPTY_VAR:-default_value}"
output:
  drop: {}
`
      const result = parseYAMLConfig(yaml)

      expect(result.input.generate.mapping).toContain('default_value')

      delete process.env.EMPTY_VAR
    })

    it('throws on missing required env var', () => {
      delete process.env.REQUIRED_VAR

      const yaml = `
input:
  kafka:
    addresses:
      - \${REQUIRED_VAR}
`
      expect(() => parseYAMLConfig(yaml)).toThrow(/REQUIRED_VAR.*not set/i)
    })

    it('resolves env vars in multiline strings', () => {
      process.env.TABLE_NAME = 'users'

      const yaml = `
input:
  generate:
    mapping: root = {}
output:
  drop: {}
pipeline:
  processors:
    - mapping: |
        root.query = "SELECT * FROM \${TABLE_NAME}"
`
      const result = parseYAMLConfig(yaml)

      expect(result.pipeline!.processors[0].mapping).toContain('SELECT * FROM users')

      delete process.env.TABLE_NAME
    })

    it('resolves multiple env vars in one value', () => {
      process.env.HOST = 'localhost'
      process.env.PORT = '9092'

      const yaml = `
input:
  kafka:
    addresses:
      - \${HOST}:\${PORT}
    topics:
      - test
output:
  drop: {}
`
      const result = parseYAMLConfig(yaml)

      expect(result.input.kafka.addresses[0]).toBe('localhost:9092')

      delete process.env.HOST
      delete process.env.PORT
    })

    it('provides resolveEnvVars as standalone function', () => {
      process.env.MY_VALUE = 'resolved'

      const result = resolveEnvVars('prefix_${MY_VALUE}_suffix')

      expect(result).toBe('prefix_resolved_suffix')

      delete process.env.MY_VALUE
    })
  })

  describe('Include directive support', () => {
    it('resolves !include directives', async () => {
      const yaml = `
input: !include inputs/kafka.yaml
output:
  stdout: {}
`
      // This would need a mock filesystem or actual file for real testing
      const result = await resolveIncludes(yaml, {
        'inputs/kafka.yaml': `
kafka:
  addresses: ['localhost:9092']
  topics: ['test']
`
      })

      expect(result.input.kafka.addresses).toEqual(['localhost:9092'])
    })

    it('resolves nested includes', async () => {
      const yaml = `
input: !include inputs/main.yaml
output: !include outputs/main.yaml
`
      const result = await resolveIncludes(yaml, {
        'inputs/main.yaml': `
kafka: !include ./kafka-config.yaml
`,
        'inputs/kafka-config.yaml': `
addresses: ['localhost:9092']
topics: ['test']
`,
        'outputs/main.yaml': `
stdout: {}
`
      })

      expect(result.input.kafka.addresses).toEqual(['localhost:9092'])
      expect(result.output.stdout).toEqual({})
    })
  })

  describe('parseYAMLConfig integration', () => {
    it('returns typed BenthosConfig', () => {
      const yaml = `
input:
  generate:
    mapping: 'root = {"test": true}'
    interval: 1s
output:
  drop: {}
`
      const config: BenthosConfig = parseYAMLConfig(yaml)

      expect(config.input.generate).toBeDefined()
      expect(config.output.drop).toBeDefined()
    })

    it('validates config after parsing', () => {
      const yaml = `
input:
  nonexistent_type: {}
output:
  drop: {}
`
      expect(() => parseYAMLConfig(yaml)).toThrow(/unknown input type/i)
    })
  })

  describe('Anchors and aliases', () => {
    it('supports YAML anchors', () => {
      const yaml = `
defaults: &defaults
  addresses:
    - localhost:9092
  consumer_group: default-group

input:
  kafka:
    <<: *defaults
    topics:
      - my-topic
`
      const result = parseYAML(yaml)

      expect(result.input.kafka.addresses).toEqual(['localhost:9092'])
      expect(result.input.kafka.consumer_group).toBe('default-group')
      expect(result.input.kafka.topics).toEqual(['my-topic'])
    })

    it('supports multiple anchors', () => {
      const yaml = `
kafka_defaults: &kafka_defaults
  addresses:
    - localhost:9092

http_defaults: &http_defaults
  timeout: 30s
  max_retries: 3

input:
  kafka:
    <<: *kafka_defaults
    topics: ['input']

output:
  http_client:
    <<: *http_defaults
    url: http://api.example.com.ai
`
      const result = parseYAML(yaml)

      expect(result.input.kafka.addresses).toBeDefined()
      expect(result.output.http_client.timeout).toBe('30s')
    })
  })

  describe('Error handling', () => {
    it('provides line numbers in parse errors', () => {
      const yaml = `
input:
  kafka:
    addresses: [
      unclosed array
`
      try {
        parseYAML(yaml)
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e).toBeInstanceOf(YAMLParseError)
        expect(e.line).toBeGreaterThan(0)
      }
    })

    it('handles duplicate keys', () => {
      const yaml = `
input:
  kafka:
    addresses: ['a']
    addresses: ['b']
`
      // Should warn or error on duplicate keys
      expect(() => parseYAML(yaml, { strict: true })).toThrow(/Map keys must be unique|duplicate/i)
    })

    it('provides context in error messages', () => {
      const yaml = `
input:
  kafka:
    addresses: [
      unclosed array
`
      try {
        parseYAML(yaml)
        expect.fail('Should have thrown')
      } catch (e: any) {
        // Error message should include line information
        expect(e.message).toMatch(/line \d+/i)
      }
    })
  })

  describe('Duration parsing', () => {
    it('understands Benthos duration formats', () => {
      const yaml = `
config:
  interval: 1s
  timeout: 30s
  long_timeout: 5m
  very_long: 2h
  mixed: 1h30m
`
      const result = parseYAML(yaml)

      // Durations should be preserved as strings
      expect(result.config.interval).toBe('1s')
      expect(result.config.timeout).toBe('30s')
      expect(result.config.long_timeout).toBe('5m')
    })
  })

  describe('Comments preservation', () => {
    it('ignores comments during parsing', () => {
      const yaml = `
# This is the input section
input:
  kafka:
    # Kafka broker addresses
    addresses:
      - localhost:9092  # Primary broker
# Output section
output:
  stdout: {}
`
      const result = parseYAML(yaml)

      expect(result.input.kafka.addresses).toEqual(['localhost:9092'])
    })
  })

  describe('Edge cases', () => {
    it('handles empty document', () => {
      const result = parseYAML('')

      expect(result).toEqual({})
    })

    it('handles document with only comments', () => {
      const yaml = `
# Just a comment
# Another comment
`
      const result = parseYAML(yaml)

      expect(result).toEqual({})
    })

    it('handles special characters in strings', () => {
      const yaml = `
config:
  regex: "^[a-z]+$"
  path: "/api/v1/users/{id}"
  query: "SELECT * FROM users WHERE name = 'test'"
`
      const result = parseYAML(yaml)

      expect(result.config.regex).toBe('^[a-z]+$')
      expect(result.config.path).toBe('/api/v1/users/{id}')
    })

    it('handles unicode', () => {
      const yaml = `
config:
  emoji: "🚀"
  japanese: "こんにちは"
`
      const result = parseYAML(yaml)

      expect(result.config.emoji).toBe('🚀')
      expect(result.config.japanese).toBe('こんにちは')
    })
  })
})
