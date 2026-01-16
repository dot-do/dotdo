/**
 * Ink Rendering Test Helpers
 *
 * Provides utilities for testing Ink (React CLI) components:
 * - renderWithProviders() - Ink render with common providers
 * - createTestInput() - Simulated key input helper
 * - ANSI/text utilities
 *
 * @module cli/tests/helpers/render
 */

import React from 'react'
import { render, type Instance } from 'ink-testing-library'
import { delay } from './index.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Enhanced render instance with test helpers
 */
export interface TestRenderInstance {
  /** The ink render instance */
  instance: Instance
  /** Get the current frame output */
  getOutput: () => string
  /** Get output with ANSI codes stripped */
  getPlainOutput: () => string
  /** Type a single key into the component */
  press: (key: string) => void
  /** Type a string (with optional delay between characters) */
  type: (text: string, charDelay?: number) => Promise<void>
  /** Press Enter/Return */
  submit: () => void
  /** Press Tab */
  tab: () => void
  /** Press Escape */
  escape: () => void
  /** Press Up arrow */
  up: () => void
  /** Press Down arrow */
  down: () => void
  /** Press Left arrow */
  left: () => void
  /** Press Right arrow */
  right: () => void
  /** Press Backspace */
  backspace: () => void
  /** Press Delete */
  delete: () => void
  /** Press Ctrl+C */
  ctrlC: () => void
  /** Press Ctrl+D */
  ctrlD: () => void
  /** Press custom Ctrl+key combination */
  ctrl: (key: string) => void
  /** Cleanup the instance */
  cleanup: () => void
  /** Wait for output to contain specific text */
  waitForText: (text: string, timeout?: number) => Promise<void>
  /** Wait for any output change */
  waitForUpdate: (timeout?: number) => Promise<void>
  /** Assert output contains patterns */
  assertContains: (...patterns: string[]) => void
  /** Assert output does NOT contain patterns */
  assertNotContains: (...patterns: string[]) => void
}

/**
 * Render options
 */
export interface RenderOptions {
  /** Initial stdin data to write */
  initialInput?: string
  /** Whether to use fake timers (requires vi.useFakeTimers() to be called) */
  useFakeTimers?: boolean
}

// =============================================================================
// ANSI Escape Codes
// =============================================================================

/**
 * Common ANSI escape sequences for key input
 */
export const KEYS = {
  UP: '\x1B[A',
  DOWN: '\x1B[B',
  RIGHT: '\x1B[C',
  LEFT: '\x1B[D',
  ENTER: '\r',
  RETURN: '\r',
  TAB: '\t',
  ESCAPE: '\x1B',
  BACKSPACE: '\x7F',
  DELETE: '\x1B[3~',
  CTRL_A: '\x01',
  CTRL_B: '\x02',
  CTRL_C: '\x03',
  CTRL_D: '\x04',
  CTRL_E: '\x05',
  CTRL_F: '\x06',
  CTRL_K: '\x0B',
  CTRL_L: '\x0C',
  CTRL_N: '\x0E',
  CTRL_P: '\x10',
  CTRL_U: '\x15',
  CTRL_W: '\x17',
  CTRL_Y: '\x19',
  CTRL_Z: '\x1A',
  CTRL_SPACE: '\x00',
} as const

/**
 * Get Ctrl key code for a letter
 */
export function ctrlKey(letter: string): string {
  const code = letter.toUpperCase().charCodeAt(0) - 64
  return String.fromCharCode(code)
}

// =============================================================================
// ANSI Stripping Utilities
// =============================================================================

/**
 * Strip ANSI escape codes from text
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

/**
 * Extract visible text content, stripping ANSI and normalizing whitespace
 */
export function extractText(text: string): string {
  return stripAnsi(text)
    .replace(/\s+/g, ' ')
    .trim()
}

// =============================================================================
// Render Helpers
// =============================================================================

/**
 * Render a React component for testing with enhanced helpers
 *
 * @param element - React element to render
 * @param options - Render options
 * @returns Test instance with helpers
 */
export function renderComponent(
  element: React.ReactElement,
  options: RenderOptions = {}
): TestRenderInstance {
  const instance = render(element)

  if (options.initialInput) {
    instance.stdin.write(options.initialInput)
  }

  const getOutput = (): string => {
    return instance.lastFrame() ?? ''
  }

  const getPlainOutput = (): string => {
    return stripAnsi(getOutput())
  }

  const press = (key: string): void => {
    instance.stdin.write(key)
  }

  const type = async (text: string, charDelay = 10): Promise<void> => {
    for (const char of text) {
      instance.stdin.write(char)
      if (charDelay > 0) {
        await delay(charDelay)
      }
    }
  }

  const submit = (): void => press(KEYS.ENTER)
  const tab = (): void => press(KEYS.TAB)
  const escape = (): void => press(KEYS.ESCAPE)
  const up = (): void => press(KEYS.UP)
  const down = (): void => press(KEYS.DOWN)
  const left = (): void => press(KEYS.LEFT)
  const right = (): void => press(KEYS.RIGHT)
  const backspace = (): void => press(KEYS.BACKSPACE)
  const del = (): void => press(KEYS.DELETE)
  const ctrlC = (): void => press(KEYS.CTRL_C)
  const ctrlD = (): void => press(KEYS.CTRL_D)
  const ctrl = (key: string): void => press(ctrlKey(key))

  const cleanup = (): void => {
    instance.unmount()
  }

  const waitForText = async (text: string, timeout = 5000): Promise<void> => {
    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
      const output = getPlainOutput()
      if (output.includes(text)) {
        return
      }
      await delay(50)
    }
    throw new Error(
      `Timeout waiting for text: "${text}"\nCurrent output:\n${getPlainOutput()}`
    )
  }

  const waitForUpdate = async (timeout = 1000): Promise<void> => {
    const initialOutput = getOutput()
    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
      if (getOutput() !== initialOutput) {
        return
      }
      await delay(50)
    }
    // Don't throw - output may not change
  }

  const assertContains = (...patterns: string[]): void => {
    const output = getPlainOutput()
    for (const pattern of patterns) {
      if (!output.includes(pattern)) {
        throw new Error(
          `Expected output to contain "${pattern}"\nActual output:\n${output}`
        )
      }
    }
  }

  const assertNotContains = (...patterns: string[]): void => {
    const output = getPlainOutput()
    for (const pattern of patterns) {
      if (output.includes(pattern)) {
        throw new Error(
          `Expected output NOT to contain "${pattern}"\nActual output:\n${output}`
        )
      }
    }
  }

  return {
    instance,
    getOutput,
    getPlainOutput,
    press,
    type,
    submit,
    tab,
    escape,
    up,
    down,
    left,
    right,
    backspace,
    delete: del,
    ctrlC,
    ctrlD,
    ctrl,
    cleanup,
    waitForText,
    waitForUpdate,
    assertContains,
    assertNotContains,
  }
}

/**
 * Render with common providers wrapped
 *
 * This is a convenience wrapper that sets up common context providers
 * that may be needed by components.
 *
 * @param element - React element to render
 * @param providers - Optional provider components to wrap with
 * @param options - Render options
 */
export function renderWithProviders(
  element: React.ReactElement,
  providers: React.ComponentType<{ children: React.ReactNode }>[] = [],
  options: RenderOptions = {}
): TestRenderInstance {
  // Wrap element with providers (innermost to outermost)
  let wrapped = element
  for (const Provider of providers.reverse()) {
    wrapped = React.createElement(Provider, { children: wrapped })
  }

  return renderComponent(wrapped, options)
}

// =============================================================================
// Input Simulation Helpers
// =============================================================================

/**
 * Create a test input helper for simulating keyboard input
 */
export function createTestInput(instance: Instance) {
  return {
    /**
     * Write a single character
     */
    char: (c: string) => instance.stdin.write(c),

    /**
     * Write a string character by character
     */
    text: async (text: string, charDelay = 10) => {
      for (const c of text) {
        instance.stdin.write(c)
        if (charDelay > 0) {
          await delay(charDelay)
        }
      }
    },

    /**
     * Press Enter
     */
    enter: () => instance.stdin.write(KEYS.ENTER),

    /**
     * Press Tab
     */
    tab: () => instance.stdin.write(KEYS.TAB),

    /**
     * Press Escape
     */
    escape: () => instance.stdin.write(KEYS.ESCAPE),

    /**
     * Press arrow key
     */
    arrow: (direction: 'up' | 'down' | 'left' | 'right') => {
      const keyMap = {
        up: KEYS.UP,
        down: KEYS.DOWN,
        left: KEYS.LEFT,
        right: KEYS.RIGHT,
      }
      instance.stdin.write(keyMap[direction])
    },

    /**
     * Press Ctrl+key
     */
    ctrl: (key: string) => instance.stdin.write(ctrlKey(key)),

    /**
     * Press Backspace
     */
    backspace: () => instance.stdin.write(KEYS.BACKSPACE),

    /**
     * Press Delete
     */
    delete: () => instance.stdin.write(KEYS.DELETE),

    /**
     * Write raw ANSI sequence
     */
    raw: (sequence: string) => instance.stdin.write(sequence),
  }
}

// =============================================================================
// Output Assertion Helpers
// =============================================================================

/**
 * Assert that output contains specific text patterns
 */
export function assertOutput(output: string, patterns: string[]): void {
  const plain = stripAnsi(output)
  for (const pattern of patterns) {
    if (!plain.includes(pattern)) {
      throw new Error(
        `Expected output to contain "${pattern}"\nActual output:\n${plain}`
      )
    }
  }
}

/**
 * Assert that output does NOT contain specific text
 */
export function assertOutputNotContains(output: string, patterns: string[]): void {
  const plain = stripAnsi(output)
  for (const pattern of patterns) {
    if (plain.includes(pattern)) {
      throw new Error(
        `Expected output NOT to contain "${pattern}"\nActual output:\n${plain}`
      )
    }
  }
}

/**
 * Assert output matches a regex pattern
 */
export function assertOutputMatches(output: string, pattern: RegExp): void {
  const plain = stripAnsi(output)
  if (!pattern.test(plain)) {
    throw new Error(
      `Expected output to match ${pattern}\nActual output:\n${plain}`
    )
  }
}

/**
 * Count occurrences of a pattern in output
 */
export function countOccurrences(output: string, pattern: string): number {
  const plain = stripAnsi(output)
  return (plain.match(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
}

// =============================================================================
// Frame Analysis Helpers
// =============================================================================

/**
 * Parse output into lines
 */
export function getLines(output: string): string[] {
  return stripAnsi(output).split('\n')
}

/**
 * Get a specific line from output (1-indexed)
 */
export function getLine(output: string, lineNumber: number): string | undefined {
  const lines = getLines(output)
  return lines[lineNumber - 1]
}

/**
 * Find lines containing a pattern
 */
export function findLines(output: string, pattern: string): string[] {
  return getLines(output).filter((line) => line.includes(pattern))
}

/**
 * Check if output has box drawing characters (borders)
 */
export function hasBorder(output: string): boolean {
  const borderChars = [
    '\u2500', // horizontal line
    '\u2502', // vertical line
    '\u250C', // top-left corner
    '\u2510', // top-right corner
    '\u2514', // bottom-left corner
    '\u2518', // bottom-right corner
  ]
  return borderChars.some((char) => output.includes(char))
}

// =============================================================================
// Re-exports
// =============================================================================

export { delay } from './index.js'
export { render } from 'ink-testing-library'
export type { Instance } from 'ink-testing-library'
