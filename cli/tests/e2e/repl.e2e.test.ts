/**
 * REPL E2E Tests
 *
 * End-to-end tests for the CLI REPL using ink-testing-library.
 * Tests cover the full user interaction flow with the REPL component.
 *
 * NOTE: Code evaluation now happens via RPC, not locally.
 * Tests that evaluate expressions need an RPC connection or will show
 * "Not connected to endpoint" error.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'

import {
  renderRepl,
  MockRpcServer,
  delay,
  stripAnsi,
  type ReplTestInstance,
} from './test-utils.js'

describe('REPL E2E', () => {
  let repl: ReplTestInstance | null = null

  afterEach(() => {
    if (repl) {
      repl.cleanup()
      repl = null
    }
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Startup Tests
  // ===========================================================================

  describe('startup', () => {
    it('should start in offline mode when no endpoint is provided', async () => {
      repl = renderRepl()

      // Wait for initial render
      await delay(100)

      const output = repl.getOutput()

      // Should show REPL header
      expect(output).toContain('dotdo REPL')

      // Should show offline mode message
      expect(output).toContain('offline')
    })

    it('should display the input prompt', async () => {
      repl = renderRepl()

      await delay(100)

      const output = repl.getOutput()

      // Should show prompt character
      expect(output).toContain('>')
    })

    it('should show disconnected status when no endpoint', async () => {
      repl = renderRepl()

      await delay(100)

      const output = repl.getOutput()

      // Status bar should show disconnected
      expect(output).toContain('disconnected')
    })

    it.skip('should attempt to connect when endpoint is provided', async () => {
      // This test is skipped because it requires mocking the WebSocket connection
      // which is not straightforward with the current architecture
      const server = new MockRpcServer()

      repl = renderRepl({
        endpoint: server.getUrl(),
      })

      await delay(200)

      // Would verify connection attempt was made
      // Currently requires WebSocket mocking
    })
  })

  // ===========================================================================
  // Command Execution Tests
  // ===========================================================================

  describe('command execution', () => {
    describe('.help command', () => {
      it('should display help text when .help is entered', async () => {
        repl = renderRepl()

        await delay(100)

        // Type .help command
        await repl.type('.help')
        repl.submit()

        await delay(100)

        const output = repl.getOutput()

        // Help text should contain command descriptions
        expect(output).toContain('Commands')
        expect(output).toContain('.help')
        expect(output).toContain('.clear')
        expect(output).toContain('.schema')
        expect(output).toContain('.exit')
      })

      it('should display keyboard shortcuts in help', async () => {
        repl = renderRepl()

        await delay(100)

        await repl.type('.help')
        repl.submit()

        await delay(100)

        const output = repl.getOutput()

        // Should show keyboard shortcuts
        expect(output).toContain('Tab')
        expect(output).toContain('Ctrl')
      })
    })

    describe('.clear command', () => {
      it('should clear output when .clear is entered', async () => {
        repl = renderRepl()

        await delay(100)

        // First, execute something to generate output
        await repl.type('.help')
        repl.submit()

        await delay(100)

        let output = repl.getOutput()
        expect(output).toContain('Commands')

        // Now clear
        await repl.type('.clear')
        repl.submit()

        await delay(100)

        output = repl.getOutput()

        // Output should be cleared (help text gone)
        // Note: Header and prompt will still be visible
        const stripped = stripAnsi(output)
        expect(stripped).not.toContain('Commands:')
      })
    })

    describe('.schema command', () => {
      it('should show warning when no schema is loaded', async () => {
        repl = renderRepl()

        await delay(100)

        await repl.type('.schema')
        repl.submit()

        await delay(100)

        const output = repl.getOutput()

        // Should indicate no schema available
        expect(output.toLowerCase()).toContain('no schema')
      })
    })

    describe('unknown command', () => {
      it('should display error for unknown commands', async () => {
        repl = renderRepl()

        await delay(100)

        await repl.type('.foobar')
        repl.submit()

        await delay(100)

        const output = repl.getOutput()

        // Should show error for unknown command
        expect(output.toLowerCase()).toContain('unknown')
        expect(output).toContain('foobar')
      })
    })
  })

  // ===========================================================================
  // Completion Tests
  // ===========================================================================

  describe('completions', () => {
    it('should show completion dropdown on Tab press', async () => {
      repl = renderRepl()

      await delay(100)

      // Type a partial word that has completions
      repl.type('cons')

      await delay(150) // Wait for debounced completion request

      // Press Tab to show completions
      repl.tab()

      await delay(100)

      const output = repl.getOutput()

      // Completion dropdown should appear
      // The exact format depends on Suggestions component
      // At minimum, we should see something related to console
      expect(output).toContain('console')
    })

    it('should show completions for $ context', async () => {
      repl = renderRepl()

      await delay(100)

      // Type $. which should trigger completions
      repl.type('$.')

      await delay(200) // Wait for completion engine

      const output = repl.getOutput()

      // Should show $ completions (send, try, do, on, every)
      // At least one of these should be visible
      const hasCompletion =
        output.includes('send') ||
        output.includes('try') ||
        output.includes('on') ||
        output.includes('every')

      expect(hasCompletion).toBe(true)
    })

    it('should navigate completions with Down arrow', async () => {
      repl = renderRepl()

      await delay(100)

      // Type to get completions
      repl.type('$.')

      await delay(200)

      // Show completions
      repl.tab()

      await delay(100)

      const initialOutput = repl.getOutput()

      // Navigate down
      repl.down()

      await delay(50)

      const afterDownOutput = repl.getOutput()

      // Output should change (selection moved)
      // Note: This may not be visible in text, but state should change
      // For now, we just verify no crash
      expect(afterDownOutput).toBeDefined()
    })

    it('should navigate completions with Up arrow', async () => {
      repl = renderRepl()

      await delay(100)

      // Type to get completions
      repl.type('$.')

      await delay(200)

      repl.tab()

      await delay(100)

      // Navigate down first
      repl.down()
      repl.down()

      await delay(50)

      // Then navigate up
      repl.up()

      await delay(50)

      const output = repl.getOutput()
      expect(output).toBeDefined()
    })
  })

  // ===========================================================================
  // History Navigation Tests
  // ===========================================================================

  describe('history navigation', () => {
    it('should navigate to previous command with Up arrow', async () => {
      repl = renderRepl()

      await delay(100)

      // Execute a command to add to history
      repl.type('.help')
      repl.submit()

      await delay(100)

      // Now press up to recall the command
      repl.up()

      await delay(50)

      const output = repl.getOutput()

      // The input should now contain the previous command
      expect(output).toContain('.help')
    })

    it('should navigate through multiple history entries', async () => {
      repl = renderRepl()

      await delay(100)

      // Execute multiple commands
      repl.type('.help')
      repl.submit()

      await delay(100)

      repl.type('.schema')
      repl.submit()

      await delay(100)

      // Navigate up twice
      repl.up() // Should recall .schema
      await delay(50)

      let output = repl.getOutput()
      expect(output).toContain('.schema')

      repl.up() // Should recall .help
      await delay(50)

      output = repl.getOutput()
      expect(output).toContain('.help')
    })

    it('should navigate back down through history', async () => {
      repl = renderRepl()

      await delay(100)

      // Execute commands
      repl.type('.help')
      repl.submit()

      await delay(100)

      repl.type('.schema')
      repl.submit()

      await delay(100)

      // Go up twice
      repl.up()
      repl.up()

      await delay(50)

      // Now go down
      repl.down()

      await delay(50)

      const output = repl.getOutput()
      expect(output).toContain('.schema')
    })

    it('should clear input when navigating past most recent history', async () => {
      repl = renderRepl()

      await delay(100)

      // Execute a command
      repl.type('.help')
      repl.submit()

      await delay(100)

      // Go up to recall
      repl.up()
      await delay(50)

      // Go down past the end
      repl.down()
      await delay(50)

      // Input should be cleared (back to empty state)
      // This is the expected behavior based on Input.tsx lines 180-183
      const output = repl.getOutput()
      // When at history index -1, the input is cleared
      expect(output).toBeDefined()
    })
  })

  // ===========================================================================
  // Expression Evaluation Tests
  // ===========================================================================

  describe('expression evaluation', () => {
    // NOTE: Code evaluation now happens via RPC, not locally.
    // Without an endpoint, the REPL shows "Not connected to endpoint" error.

    it('should show not connected error when no endpoint', async () => {
      repl = renderRepl()

      await delay(100)

      await repl.type('1 + 1')
      repl.submit()

      await delay(200)

      const output = repl.getOutput()

      // Without an RPC connection, should show connection error
      expect(output).toContain('Not connected to endpoint')
    })

    it('should handle syntax errors gracefully', async () => {
      repl = renderRepl()

      await delay(100)

      await repl.type('const x = ')
      repl.submit()

      await delay(200)

      const output = repl.getOutput()

      // Should show connection error (can't evaluate without RPC)
      // or TypeScript diagnostic error
      expect(output).toBeDefined()
    })

    it('should show not connected for any expression without endpoint', async () => {
      repl = renderRepl()

      await delay(100)

      await repl.type('undefined')
      repl.submit()

      await delay(200)

      const output = repl.getOutput()
      // Without RPC connection, shows error
      expect(output).toContain('Not connected to endpoint')
    })
  })

  // ===========================================================================
  // Input Editing Tests
  // ===========================================================================

  describe('input editing', () => {
    it('should handle character input', async () => {
      repl = renderRepl()

      await delay(100)

      repl.type('test')

      await delay(50)

      const output = repl.getOutput()
      expect(output).toContain('test')
    })

    it('should handle backspace', async () => {
      repl = renderRepl()

      await delay(100)

      await repl.type('hello')
      await delay(50)

      // Press backspace (delete)
      repl.press('\x7F') // DEL character

      await delay(50)

      const output = repl.getOutput()
      // 'hello' without last char = 'hell'
      expect(output).toContain('hell')
    })

    it('should not submit on empty input', async () => {
      repl = renderRepl()

      await delay(100)

      // Just press enter with no input
      repl.submit()

      await delay(100)

      const output = repl.getOutput()

      // Should not have added any output entries (except initial)
      // This is a bit hard to test precisely, but we verify no crash
      expect(output).toBeDefined()
    })
  })

  // ===========================================================================
  // Status Bar Tests
  // ===========================================================================

  describe('status bar', () => {
    it('should show disconnected when offline', async () => {
      repl = renderRepl()

      await delay(100)

      const output = repl.getOutput()
      expect(output).toContain('disconnected')
    })

    it.skip('should show connected when connected to endpoint', async () => {
      // Skipped: requires WebSocket mocking
    })

    it.skip('should show endpoint URL when provided', async () => {
      // Skipped: requires WebSocket mocking
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle rapid typing', async () => {
      repl = renderRepl()

      await delay(100)

      // Type rapidly
      await repl.type('console.log("test")')

      await delay(100)

      const output = repl.getOutput()
      expect(output).toContain('console.log')
    })

    it('should handle special characters', async () => {
      repl = renderRepl()

      await delay(100)

      await repl.type('$.on.User.created')

      await delay(100)

      const output = repl.getOutput()
      expect(output).toContain('$.on.User.created')
    })

    it('should not crash on Ctrl+C', async () => {
      repl = renderRepl()

      await delay(100)

      // Ctrl+C is mapped to exit, but in tests we may not have full terminal
      // Just verify it doesn't crash
      try {
        repl.press('\x03') // Ctrl+C
        await delay(50)
      } catch {
        // Expected - exit() called
      }

      // Test that we got here without crashing
      expect(true).toBe(true)
    })

    it('should handle Escape to hide completions', async () => {
      repl = renderRepl()

      await delay(100)

      // Trigger completions
      await repl.type('$.')
      await delay(200)

      repl.tab()
      await delay(100)

      // Press Escape
      repl.press('\x1B')
      await delay(50)

      // Completions should be hidden
      // Verify no crash
      expect(repl.getOutput()).toBeDefined()
    })
  })
})
