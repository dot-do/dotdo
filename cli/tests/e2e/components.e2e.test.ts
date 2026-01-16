/**
 * Components E2E Tests
 *
 * End-to-end tests for CLI components:
 * - StatusBar
 * - Input
 * - Suggestions
 *
 * RED PHASE: These tests define expected behavior for component rendering.
 */

import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, type Instance } from 'ink-testing-library'
import { Input, StatusBar } from '../../src/components/Input.js'
import { Suggestions } from '../../src/components/Suggestions.js'
import { delay, stripAnsi } from './test-utils.js'
import ts from 'typescript'
import type { CompletionItem } from '../../src/completions.js'

// =============================================================================
// StatusBar Component Tests
// =============================================================================

describe('StatusBar Component E2E', () => {
  let instance: Instance | null = null

  afterEach(() => {
    if (instance) {
      instance.unmount()
      instance = null
    }
  })

  describe('connection status', () => {
    it('should show "connected" when connected is true', async () => {
      instance = render(React.createElement(StatusBar, { connected: true }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('connected')
    })

    it('should show "disconnected" when connected is false', async () => {
      instance = render(React.createElement(StatusBar, { connected: false }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('disconnected')
    })

    /**
     * RED PHASE: This test is EXPECTED TO FAIL until color support is
     * properly configured in ink-testing-library or the component.
     *
     * Expected behavior: connected status should be styled in green.
     * Current behavior: ink-testing-library may strip or encode colors differently.
     */
    it.fails('should display green color for connected status', async () => {
      instance = render(React.createElement(StatusBar, { connected: true }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      // ANSI escape code for green - ink may use different encoding
      // This test documents the expected visual behavior
      expect(output).toContain('\x1B[32m')
    })

    /**
     * RED PHASE: This test is EXPECTED TO FAIL until color support is
     * properly configured in ink-testing-library or the component.
     *
     * Expected behavior: disconnected status should be styled in red.
     * Current behavior: ink-testing-library may strip or encode colors differently.
     */
    it.fails('should display red color for disconnected status', async () => {
      instance = render(React.createElement(StatusBar, { connected: false }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      // ANSI escape code for red
      expect(output).toContain('\x1B[31m')
    })
  })

  describe('endpoint display', () => {
    it('should display endpoint URL when provided', async () => {
      instance = render(React.createElement(StatusBar, {
        connected: true,
        endpoint: 'ws://localhost:8080',
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('ws://localhost:8080')
    })

    it('should not display endpoint when not provided', async () => {
      instance = render(React.createElement(StatusBar, { connected: false }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).not.toContain('ws://')
      expect(output).not.toContain('localhost')
    })
  })

  describe('mode display', () => {
    it('should display mode when provided', async () => {
      instance = render(React.createElement(StatusBar, {
        connected: true,
        mode: 'TestSchema',
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('[TestSchema]')
    })

    it('should not display mode when not provided', async () => {
      instance = render(React.createElement(StatusBar, { connected: false }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).not.toContain('[')
    })
  })

  describe('border style', () => {
    it('should have a border', async () => {
      instance = render(React.createElement(StatusBar, { connected: true }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      // Box characters indicating border
      expect(
        output.includes('\u2500') || // horizontal line
        output.includes('\u2502') || // vertical line
        output.includes('\u250C') || // top-left corner
        output.includes('\u2510')    // top-right corner
      ).toBe(true)
    })
  })
})

// =============================================================================
// Suggestions Component Tests
// =============================================================================

describe('Suggestions Component E2E', () => {
  let instance: Instance | null = null

  afterEach(() => {
    if (instance) {
      instance.unmount()
      instance = null
    }
  })

  const createCompletion = (
    name: string,
    kind: ts.ScriptElementKind = ts.ScriptElementKind.variableElement,
    options: Partial<CompletionItem> = {}
  ): CompletionItem => ({
    name,
    kind,
    sortText: name,
    isMethod: false,
    ...options,
  })

  describe('visibility', () => {
    it('should not render when visible is false', async () => {
      const suggestions = [createCompletion('test')]
      instance = render(React.createElement(Suggestions, {
        suggestions,
        selectedIndex: 0,
        visible: false,
      }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      expect(output).toBe('')
    })

    it('should not render when suggestions is empty', async () => {
      instance = render(React.createElement(Suggestions, {
        suggestions: [],
        selectedIndex: 0,
        visible: true,
      }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      expect(output).toBe('')
    })

    it('should render when visible and has suggestions', async () => {
      const suggestions = [createCompletion('test')]
      instance = render(React.createElement(Suggestions, {
        suggestions,
        selectedIndex: 0,
        visible: true,
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('test')
    })
  })

  describe('suggestion rendering', () => {
    it('should display suggestion names', async () => {
      const suggestions = [
        createCompletion('alpha'),
        createCompletion('beta'),
        createCompletion('gamma'),
      ]
      instance = render(React.createElement(Suggestions, {
        suggestions,
        selectedIndex: 0,
        visible: true,
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('alpha')
      expect(output).toContain('beta')
      expect(output).toContain('gamma')
    })

    /**
     * RED PHASE: This test is EXPECTED TO FAIL until selection highlighting
     * is properly rendered/preserved in ink-testing-library.
     *
     * Expected behavior: Selected suggestion should have blue background.
     * Current behavior: ink-testing-library may not preserve background colors.
     */
    it.fails('should highlight selected suggestion with background color', async () => {
      const suggestions = [
        createCompletion('first'),
        createCompletion('second'),
      ]
      instance = render(React.createElement(Suggestions, {
        suggestions,
        selectedIndex: 1,
        visible: true,
      }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      // Blue background ANSI code for selection
      expect(output).toContain('\x1B[44m')
    })

    it('should show function icon for methods', async () => {
      const suggestions = [
        createCompletion('myFunction', ts.ScriptElementKind.functionElement),
      ]
      instance = render(React.createElement(Suggestions, {
        suggestions,
        selectedIndex: 0,
        visible: true,
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('fn')
    })

    it('should show variable icon for variables', async () => {
      const suggestions = [
        createCompletion('myVar', ts.ScriptElementKind.variableElement),
      ]
      instance = render(React.createElement(Suggestions, {
        suggestions,
        selectedIndex: 0,
        visible: true,
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('v')
    })

    it('should show class icon for classes', async () => {
      const suggestions = [
        createCompletion('MyClass', ts.ScriptElementKind.classElement),
      ]
      instance = render(React.createElement(Suggestions, {
        suggestions,
        selectedIndex: 0,
        visible: true,
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('C')
    })

    it('should show interface icon for interfaces', async () => {
      const suggestions = [
        createCompletion('MyInterface', ts.ScriptElementKind.interfaceElement),
      ]
      instance = render(React.createElement(Suggestions, {
        suggestions,
        selectedIndex: 0,
        visible: true,
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('I')
    })
  })

  describe('max visible limit', () => {
    it('should limit displayed suggestions to maxVisible', async () => {
      const suggestions = Array.from({ length: 20 }, (_, i) =>
        createCompletion(`item${i}`)
      )
      instance = render(React.createElement(Suggestions, {
        suggestions,
        selectedIndex: 0,
        visible: true,
        maxVisible: 5,
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      // Should show only first 5
      expect(output).toContain('item0')
      expect(output).toContain('item4')
      expect(output).not.toContain('item10')
    })

    it('should show scroll indicator when more items exist', async () => {
      const suggestions = Array.from({ length: 20 }, (_, i) =>
        createCompletion(`item${i}`)
      )
      instance = render(React.createElement(Suggestions, {
        suggestions,
        selectedIndex: 0,
        visible: true,
        maxVisible: 5,
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      // Should show "1/20" indicator
      expect(output).toContain('1/20')
    })

    it('should scroll window when selection moves', async () => {
      const suggestions = Array.from({ length: 20 }, (_, i) =>
        createCompletion(`item${i}`)
      )
      instance = render(React.createElement(Suggestions, {
        suggestions,
        selectedIndex: 15,
        visible: true,
        maxVisible: 5,
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      // Selected item should be visible
      expect(output).toContain('item15')
      // Early items should not be visible
      expect(output).not.toContain('item0')
    })
  })

  describe('parameters and return type', () => {
    it('should display function parameters', async () => {
      const suggestions = [
        createCompletion('myFunc', ts.ScriptElementKind.functionElement, {
          parameters: 'x: number, y: string',
        }),
      ]
      instance = render(React.createElement(Suggestions, {
        suggestions,
        selectedIndex: 0,
        visible: true,
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('(x: number, y: string)')
    })

    it('should display return type', async () => {
      const suggestions = [
        createCompletion('myFunc', ts.ScriptElementKind.functionElement, {
          returnType: 'Promise<void>',
        }),
      ]
      instance = render(React.createElement(Suggestions, {
        suggestions,
        selectedIndex: 0,
        visible: true,
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('-> Promise<void>')
    })
  })
})

// =============================================================================
// Input Component Tests
// =============================================================================

describe('Input Component E2E', () => {
  let instance: Instance | null = null

  afterEach(() => {
    if (instance) {
      instance.unmount()
      instance = null
    }
  })

  describe('prompt rendering', () => {
    it('should display default prompt', async () => {
      instance = render(React.createElement(Input, {
        value: '',
        onChange: () => {},
        onSubmit: () => {},
        completions: [],
        onRequestCompletions: () => {},
        showCompletions: false,
        onToggleCompletions: () => {},
        history: [],
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('>')
    })

    it('should display custom prompt', async () => {
      instance = render(React.createElement(Input, {
        prompt: '>>> ',
        value: '',
        onChange: () => {},
        onSubmit: () => {},
        completions: [],
        onRequestCompletions: () => {},
        showCompletions: false,
        onToggleCompletions: () => {},
        history: [],
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('>>>')
    })

    it('should display input value after prompt', async () => {
      instance = render(React.createElement(Input, {
        value: 'test input',
        onChange: () => {},
        onSubmit: () => {},
        completions: [],
        onRequestCompletions: () => {},
        showCompletions: false,
        onToggleCompletions: () => {},
        history: [],
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('test input')
    })
  })

  describe('placeholder', () => {
    it('should show placeholder when value is empty', async () => {
      instance = render(React.createElement(Input, {
        value: '',
        placeholder: 'Type something...',
        onChange: () => {},
        onSubmit: () => {},
        completions: [],
        onRequestCompletions: () => {},
        showCompletions: false,
        onToggleCompletions: () => {},
        history: [],
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('Type something...')
    })

    it('should not show placeholder when value has content', async () => {
      instance = render(React.createElement(Input, {
        value: 'content',
        placeholder: 'Type something...',
        onChange: () => {},
        onSubmit: () => {},
        completions: [],
        onRequestCompletions: () => {},
        showCompletions: false,
        onToggleCompletions: () => {},
        history: [],
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).not.toContain('Type something...')
    })
  })

  describe('cursor display', () => {
    /**
     * RED PHASE: This test is EXPECTED TO FAIL until cursor rendering
     * is properly preserved in ink-testing-library output.
     *
     * Expected behavior: Cursor should be shown with inverse video.
     * Current behavior: ink-testing-library may strip styling codes.
     */
    it.fails('should display cursor at end of input with inverse styling', async () => {
      instance = render(React.createElement(Input, {
        value: 'test',
        onChange: () => {},
        onSubmit: () => {},
        completions: [],
        onRequestCompletions: () => {},
        showCompletions: false,
        onToggleCompletions: () => {},
        history: [],
      }))

      await delay(50)

      const output = instance.lastFrame() ?? ''
      // Inverse text (cursor) ANSI code
      expect(output).toContain('\x1B[7m')
    })
  })

  describe('completions dropdown', () => {
    it('should show completions when showCompletions is true', async () => {
      const completions: CompletionItem[] = [
        {
          name: 'completion1',
          kind: ts.ScriptElementKind.variableElement,
          sortText: 'completion1',
          isMethod: false,
        },
      ]
      instance = render(React.createElement(Input, {
        value: 'comp',
        onChange: () => {},
        onSubmit: () => {},
        completions,
        onRequestCompletions: () => {},
        showCompletions: true,
        onToggleCompletions: () => {},
        history: [],
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).toContain('completion1')
    })

    it('should not show completions when showCompletions is false', async () => {
      const completions: CompletionItem[] = [
        {
          name: 'completion1',
          kind: ts.ScriptElementKind.variableElement,
          sortText: 'completion1',
          isMethod: false,
        },
      ]
      instance = render(React.createElement(Input, {
        value: 'comp',
        onChange: () => {},
        onSubmit: () => {},
        completions,
        onRequestCompletions: () => {},
        showCompletions: false,
        onToggleCompletions: () => {},
        history: [],
      }))

      await delay(50)

      const output = stripAnsi(instance.lastFrame() ?? '')
      expect(output).not.toContain('completion1')
    })
  })
})
