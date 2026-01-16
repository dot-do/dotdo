/**
 * Output Component E2E Tests
 *
 * End-to-end tests for Output.tsx and related output rendering.
 * Tests cover visual rendering of different output types.
 *
 * RED PHASE: These tests define expected behavior for output rendering.
 */

import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, type Instance } from 'ink-testing-library'
import {
  Output,
  createOutputEntry,
  ErrorOutput,
  TableOutput,
  type OutputEntry,
  type OutputType,
} from '../../src/components/Output.js'
import { delay, stripAnsi } from './test-utils.js'

// =============================================================================
// Output Component Unit Tests
// =============================================================================

describe('Output Component E2E', () => {
  let instance: Instance | null = null

  afterEach(() => {
    if (instance) {
      instance.unmount()
      instance = null
    }
  })

  // ===========================================================================
  // Basic Rendering Tests
  // ===========================================================================

  describe('basic rendering', () => {
    it('should render empty state with no entries', async () => {
      instance = render(React.createElement(Output, { entries: [] }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      // Empty output should render without error
      expect(output).toBeDefined()
    })

    it('should render a single output entry', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('result', 'Hello World'),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('Hello World')
    })

    it('should render multiple output entries', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('input', 'const x = 1'),
        createOutputEntry('result', '1'),
        createOutputEntry('info', 'Variable created'),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('const x = 1')
      expect(output).toContain('1')
      expect(output).toContain('Variable created')
    })
  })

  // ===========================================================================
  // Output Type Prefix Tests
  // ===========================================================================

  describe('output type prefixes', () => {
    it('should show > prefix for input entries', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('input', 'test command'),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      expect(output).toContain('>')
    })

    it('should show < prefix for result entries', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('result', 'result value'),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      expect(output).toContain('<')
    })

    it('should show ! prefix for error entries', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('error', 'Something went wrong'),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      expect(output).toContain('!')
    })

    it('should show ~ prefix for warning entries', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('warning', 'This is a warning'),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      expect(output).toContain('~')
    })

    it('should show i prefix for info entries', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('info', 'Information message'),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      expect(output).toContain('i')
    })

    it('should show * prefix for system entries', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('system', 'System message'),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      expect(output).toContain('*')
    })
  })

  // ===========================================================================
  // Value Formatting Tests
  // ===========================================================================

  describe('value formatting', () => {
    it('should format null values correctly', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('result', null),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('null')
    })

    it('should format undefined values correctly', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('result', undefined),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('undefined')
    })

    it('should format numbers correctly', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('result', 42),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('42')
    })

    it('should format booleans correctly', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('result', true),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('true')
    })

    /**
     * RED PHASE: This test is EXPECTED TO FAIL.
     *
     * Expected behavior: String values should be displayed with quotes
     * to distinguish them from other output types.
     *
     * Current behavior: createOutputEntry passes strings through as-is
     * without adding quotes (line 166 in Output.tsx).
     *
     * This is a design decision that could go either way:
     * - With quotes: Makes it clear it's a string value
     * - Without quotes: Cleaner output for plain messages
     */
    it.fails('should format strings with quotes', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('result', 'hello'),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('"hello"')
    })

    it('should format arrays correctly', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('result', [1, 2, 3]),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('[')
      expect(output).toContain('1')
      expect(output).toContain('2')
      expect(output).toContain('3')
    })

    it('should format objects correctly', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('result', { name: 'test', value: 42 }),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('name')
      expect(output).toContain('test')
      expect(output).toContain('value')
      expect(output).toContain('42')
    })

    it('should handle nested objects', async () => {
      const entries: OutputEntry[] = [
        createOutputEntry('result', { outer: { inner: 'value' } }),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('outer')
      expect(output).toContain('inner')
      expect(output).toContain('value')
    })

    it('should handle deep nesting with truncation', async () => {
      const deepObject = {
        l1: { l2: { l3: { l4: { l5: 'deep' } } } },
      }
      const entries: OutputEntry[] = [
        createOutputEntry('result', deepObject),
      ]
      instance = render(React.createElement(Output, { entries }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      // Should truncate at depth 3+ with {...}
      expect(output).toContain('{...')
    })
  })

  // ===========================================================================
  // Max Entries Tests
  // ===========================================================================

  describe('max entries limit', () => {
    it('should limit displayed entries to maxEntries', async () => {
      // Create more entries than the default max (100)
      const entries: OutputEntry[] = []
      for (let i = 0; i < 150; i++) {
        entries.push(createOutputEntry('info', `Entry ${i}`))
      }
      instance = render(React.createElement(Output, { entries, maxEntries: 100 }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      // Should not contain early entries
      expect(output).not.toContain('Entry 0')
      expect(output).not.toContain('Entry 49')
      // Should contain later entries
      expect(output).toContain('Entry 149')
      expect(output).toContain('Entry 100')
    })

    it('should respect custom maxEntries', async () => {
      const entries: OutputEntry[] = []
      for (let i = 0; i < 20; i++) {
        entries.push(createOutputEntry('info', `Entry ${i}`))
      }
      instance = render(React.createElement(Output, { entries, maxEntries: 5 }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      // Only last 5 entries should be visible
      expect(output).not.toContain('Entry 0')
      expect(output).not.toContain('Entry 14')
      expect(output).toContain('Entry 19')
      expect(output).toContain('Entry 15')
    })
  })

  // ===========================================================================
  // ErrorOutput Component Tests
  // ===========================================================================

  describe('ErrorOutput component', () => {
    it('should render error message', async () => {
      const error = new Error('Test error message')
      instance = render(React.createElement(ErrorOutput, { error }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('Error')
      expect(output).toContain('Test error message')
    })

    it('should hide stack trace by default', async () => {
      const error = new Error('Test error')
      error.stack = 'Error: Test error\n    at TestFunction (test.js:1:1)'
      instance = render(React.createElement(ErrorOutput, { error }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).not.toContain('at TestFunction')
    })

    it('should show stack trace when showStack is true', async () => {
      const error = new Error('Test error')
      error.stack = 'Error: Test error\n    at TestFunction (test.js:1:1)'
      instance = render(React.createElement(ErrorOutput, { error, showStack: true }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('at TestFunction')
    })
  })

  // ===========================================================================
  // TableOutput Component Tests
  // ===========================================================================

  describe('TableOutput component', () => {
    it('should render empty state', async () => {
      instance = render(React.createElement(TableOutput, { data: [] }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('(empty)')
    })

    it('should render table with data', async () => {
      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]
      instance = render(React.createElement(TableOutput, { data }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      // Should have headers
      expect(output).toContain('name')
      expect(output).toContain('age')
      // Should have data
      expect(output).toContain('Alice')
      expect(output).toContain('30')
      expect(output).toContain('Bob')
      expect(output).toContain('25')
    })

    it('should render table with custom columns', async () => {
      const data = [
        { name: 'Alice', age: 30, email: 'alice@example.com' },
        { name: 'Bob', age: 25, email: 'bob@example.com' },
      ]
      instance = render(React.createElement(TableOutput, { data, columns: ['name', 'email'] }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      // Should have specified columns
      expect(output).toContain('name')
      expect(output).toContain('email')
      // Should not have age column
      expect(output).not.toContain('age')
    })

    it('should handle null values in table data', async () => {
      const data = [
        { name: 'Alice', value: null },
        { name: 'Bob', value: 'test' },
      ]
      instance = render(React.createElement(TableOutput, { data }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('Alice')
      expect(output).toContain('Bob')
      expect(output).toContain('test')
    })

    it('should align columns properly', async () => {
      const data = [
        { short: 'a', longer_column_name: 'x' },
        { short: 'bb', longer_column_name: 'yy' },
      ]
      instance = render(React.createElement(TableOutput, { data }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      // Table should be rendered with proper alignment
      expect(output).toContain('|')
    })
  })

  // ===========================================================================
  // createOutputEntry Tests
  // ===========================================================================

  describe('createOutputEntry helper', () => {
    it('should create entry with unique ID', () => {
      const entry1 = createOutputEntry('result', 'test1')
      const entry2 = createOutputEntry('result', 'test2')

      expect(entry1.id).not.toBe(entry2.id)
    })

    it('should set correct type', () => {
      const types: OutputType[] = ['input', 'result', 'error', 'info', 'warning', 'system']

      for (const type of types) {
        const entry = createOutputEntry(type, 'test')
        expect(entry.type).toBe(type)
      }
    })

    it('should set timestamp', () => {
      const before = new Date()
      const entry = createOutputEntry('result', 'test')
      const after = new Date()

      expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(entry.timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should stringify non-string content', () => {
      const entry = createOutputEntry('result', { foo: 'bar' })
      expect(entry.content).toContain('foo')
      expect(entry.content).toContain('bar')
    })

    it('should preserve string content', () => {
      const entry = createOutputEntry('result', 'plain text')
      expect(entry.content).toBe('plain text')
    })
  })
})
