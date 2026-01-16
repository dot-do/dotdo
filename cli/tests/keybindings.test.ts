/**
 * Keybinding Handler Tests (RED Phase)
 *
 * Tests for an extracted keybinding handler module that should be
 * separate from Input.tsx. The current Input.tsx has ~150 lines of
 * monolithic keybinding logic in useInput (lines 106-258).
 *
 * This test file expects:
 * 1. A KeybindingHandler class/module at cli/src/keybindings.ts
 * 2. Configurable keybinding registry
 * 3. Individual keybinding action handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Import the module we expect to exist (will fail until GREEN phase)
import {
  KeybindingHandler,
  type Keybinding,
  type KeybindingAction,
  type KeybindingContext,
  type KeyEvent,
  DEFAULT_KEYBINDINGS,
} from '../src/keybindings.js'

describe('KeybindingHandler', () => {
  let handler: KeybindingHandler
  let context: KeybindingContext

  beforeEach(() => {
    // Create a mock context that keybindings operate on
    context = {
      value: '',
      cursorPosition: 0,
      history: ['echo hello', 'ls -la', 'npm test'],
      historyIndex: -1,
      completions: [
        { name: 'then', kind: 'method', isMethod: true },
        { name: 'catch', kind: 'method', isMethod: true },
        { name: 'finally', kind: 'method', isMethod: true },
      ],
      selectedCompletion: 0,
      showCompletions: false,
      focused: true,
      multiline: false,

      // Action callbacks
      onChange: vi.fn(),
      onSubmit: vi.fn(),
      onExit: vi.fn(),
      onToggleCompletions: vi.fn(),
      onRequestCompletions: vi.fn(),
      setCursorPosition: vi.fn(),
      setHistoryIndex: vi.fn(),
      setSelectedCompletion: vi.fn(),
    }

    handler = new KeybindingHandler()
  })

  describe('construction and initialization', () => {
    it('should create with default keybindings', () => {
      expect(handler).toBeDefined()
      expect(handler.getKeybindings()).toEqual(DEFAULT_KEYBINDINGS)
    })

    it('should accept custom keybindings in constructor', () => {
      const customBindings: Keybinding[] = [
        { key: { input: 'x', ctrl: true }, action: 'exit' },
      ]
      const customHandler = new KeybindingHandler(customBindings)
      const bindings = customHandler.getKeybindings()

      expect(bindings).toContainEqual({ key: { input: 'x', ctrl: true }, action: 'exit' })
    })

    it('should merge custom keybindings with defaults', () => {
      const customBindings: Keybinding[] = [
        { key: { input: 'x', ctrl: true }, action: 'exit' },
      ]
      const customHandler = new KeybindingHandler(customBindings, { mergeWithDefaults: true })
      const bindings = customHandler.getKeybindings()

      // Should have both custom and default bindings
      expect(bindings).toContainEqual({ key: { input: 'x', ctrl: true }, action: 'exit' })
      expect(bindings).toContainEqual({ key: { input: 'c', ctrl: true }, action: 'exit' })
    })
  })

  describe('keybinding registration', () => {
    it('should register a new keybinding', () => {
      handler.register({ key: { input: 'k', ctrl: true }, action: 'clearScreen' })

      const bindings = handler.getKeybindings()
      expect(bindings).toContainEqual({ key: { input: 'k', ctrl: true }, action: 'clearScreen' })
    })

    it('should unregister a keybinding', () => {
      handler.unregister({ input: 'u', ctrl: true })

      const bindings = handler.getKeybindings()
      expect(bindings).not.toContainEqual(
        expect.objectContaining({ key: { input: 'u', ctrl: true } })
      )
    })

    it('should override existing keybinding for same key', () => {
      // Ctrl+C defaults to 'exit', override to 'cancel'
      handler.register({ key: { input: 'c', ctrl: true }, action: 'cancel' })

      const bindings = handler.getKeybindings()
      const ctrlC = bindings.find(b => b.key.input === 'c' && b.key.ctrl)

      expect(ctrlC?.action).toBe('cancel')
    })

    it('should register keybinding with custom handler', () => {
      const customHandler = vi.fn()
      handler.register({
        key: { input: 'p', ctrl: true },
        action: 'custom',
        handler: customHandler,
      })

      handler.handle({ input: 'p', ctrl: true }, context)

      expect(customHandler).toHaveBeenCalledWith(context)
    })
  })

  describe('keybinding conflicts', () => {
    it('should detect conflicting keybindings', () => {
      const conflicts = handler.findConflicts([
        { key: { input: 'c', ctrl: true }, action: 'cancel' },
      ])

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0]).toEqual({
        key: { input: 'c', ctrl: true },
        existing: 'exit',
        proposed: 'cancel',
      })
    })

    it('should return empty array when no conflicts', () => {
      const conflicts = handler.findConflicts([
        { key: { input: 'x', ctrl: true }, action: 'customAction' },
      ])

      expect(conflicts).toHaveLength(0)
    })

    it('should validate keybindings and throw on invalid', () => {
      expect(() => {
        handler.register({ key: {}, action: 'exit' } as Keybinding)
      }).toThrow('Invalid keybinding: key must have input or a special key')
    })
  })

  describe('exit action (Ctrl+C)', () => {
    it('should call onExit when Ctrl+C is pressed', () => {
      const handled = handler.handle({ input: 'c', ctrl: true }, context)

      expect(handled).toBe(true)
      expect(context.onExit).toHaveBeenCalled()
    })

    it('should not exit when not focused', () => {
      context.focused = false
      const handled = handler.handle({ input: 'c', ctrl: true }, context)

      expect(handled).toBe(false)
      expect(context.onExit).not.toHaveBeenCalled()
    })
  })

  describe('Ctrl+D (exit or delete)', () => {
    it('should exit on empty line', () => {
      context.value = ''
      handler.handle({ input: 'd', ctrl: true }, context)

      expect(context.onExit).toHaveBeenCalled()
    })

    it('should delete character at cursor on non-empty line', () => {
      context.value = 'hello'
      context.cursorPosition = 2
      handler.handle({ input: 'd', ctrl: true }, context)

      expect(context.onChange).toHaveBeenCalledWith('helo')
      expect(context.onExit).not.toHaveBeenCalled()
    })
  })

  describe('toggle completions (Ctrl+Space)', () => {
    it('should toggle completions on', () => {
      context.showCompletions = false
      handler.handle({ input: ' ', ctrl: true }, context)

      expect(context.onToggleCompletions).toHaveBeenCalledWith(true)
      expect(context.onRequestCompletions).toHaveBeenCalledWith('', 0)
    })

    it('should toggle completions off', () => {
      context.showCompletions = true
      handler.handle({ input: ' ', ctrl: true }, context)

      expect(context.onToggleCompletions).toHaveBeenCalledWith(false)
    })
  })

  describe('escape key', () => {
    it('should hide completions on Escape', () => {
      context.showCompletions = true
      handler.handle({ escape: true }, context)

      expect(context.onToggleCompletions).toHaveBeenCalledWith(false)
    })
  })

  describe('Tab completion', () => {
    it('should apply completion when completions visible', () => {
      context.showCompletions = true
      context.value = 'promise.th'
      context.cursorPosition = 10
      context.selectedCompletion = 0

      handler.handle({ tab: true }, context)

      expect(context.onChange).toHaveBeenCalledWith('promise.then(')
      expect(context.onToggleCompletions).toHaveBeenCalledWith(false)
    })

    it('should show completions when hidden but available', () => {
      context.showCompletions = false
      context.completions = [{ name: 'then', kind: 'method', isMethod: true }]

      handler.handle({ tab: true }, context)

      expect(context.onToggleCompletions).toHaveBeenCalledWith(true)
    })

    it('should do nothing when no completions available', () => {
      context.showCompletions = false
      context.completions = []

      handler.handle({ tab: true }, context)

      expect(context.onToggleCompletions).not.toHaveBeenCalled()
      expect(context.onChange).not.toHaveBeenCalled()
    })
  })

  describe('Enter/Return key', () => {
    it('should apply completion when visible', () => {
      context.showCompletions = true
      context.value = 'promise.th'
      context.cursorPosition = 10

      handler.handle({ return: true }, context)

      expect(context.onChange).toHaveBeenCalledWith('promise.then(')
      expect(context.onSubmit).not.toHaveBeenCalled()
    })

    it('should submit when completions not visible', () => {
      context.showCompletions = false
      context.value = 'echo hello'

      handler.handle({ return: true }, context)

      expect(context.onSubmit).toHaveBeenCalledWith('echo hello')
    })

    it('should insert newline on Shift+Enter in multiline mode', () => {
      context.multiline = true
      context.value = 'line1'
      context.cursorPosition = 5

      handler.handle({ return: true, shift: true }, context)

      expect(context.onChange).toHaveBeenCalledWith('line1\n')
      expect(context.setCursorPosition).toHaveBeenCalledWith(6)
    })

    it('should submit on Shift+Enter in single-line mode', () => {
      context.multiline = false
      context.value = 'command'

      handler.handle({ return: true, shift: true }, context)

      expect(context.onSubmit).toHaveBeenCalledWith('command')
    })
  })

  describe('Up arrow (history/completion navigation)', () => {
    it('should navigate completions up when visible', () => {
      context.showCompletions = true
      context.selectedCompletion = 1

      handler.handle({ upArrow: true }, context)

      expect(context.setSelectedCompletion).toHaveBeenCalledWith(0)
    })

    it('should not go below 0 when navigating completions', () => {
      context.showCompletions = true
      context.selectedCompletion = 0

      handler.handle({ upArrow: true }, context)

      expect(context.setSelectedCompletion).toHaveBeenCalledWith(0)
    })

    it('should navigate history when completions hidden', () => {
      context.showCompletions = false
      context.historyIndex = -1

      handler.handle({ upArrow: true }, context)

      expect(context.setHistoryIndex).toHaveBeenCalledWith(0)
      expect(context.onChange).toHaveBeenCalledWith('npm test') // Most recent
      expect(context.setCursorPosition).toHaveBeenCalledWith(8)
    })

    it('should move through history on repeated up', () => {
      context.showCompletions = false
      context.historyIndex = 0 // Already at most recent

      handler.handle({ upArrow: true }, context)

      expect(context.setHistoryIndex).toHaveBeenCalledWith(1)
      expect(context.onChange).toHaveBeenCalledWith('ls -la') // Second most recent
    })

    it('should not go past end of history', () => {
      context.showCompletions = false
      context.historyIndex = 2 // At oldest

      handler.handle({ upArrow: true }, context)

      expect(context.setHistoryIndex).toHaveBeenCalledWith(2) // Stays at 2
    })
  })

  describe('Down arrow (history/completion navigation)', () => {
    it('should navigate completions down when visible', () => {
      context.showCompletions = true
      context.selectedCompletion = 0

      handler.handle({ downArrow: true }, context)

      expect(context.setSelectedCompletion).toHaveBeenCalledWith(1)
    })

    it('should not go past completions length', () => {
      context.showCompletions = true
      context.selectedCompletion = 2 // Last item

      handler.handle({ downArrow: true }, context)

      expect(context.setSelectedCompletion).toHaveBeenCalledWith(2)
    })

    it('should navigate back in history', () => {
      context.showCompletions = false
      context.historyIndex = 1

      handler.handle({ downArrow: true }, context)

      expect(context.setHistoryIndex).toHaveBeenCalledWith(0)
      expect(context.onChange).toHaveBeenCalledWith('npm test')
    })

    it('should clear input when at historyIndex 0 and pressing down', () => {
      context.showCompletions = false
      context.historyIndex = 0
      context.value = 'npm test'

      handler.handle({ downArrow: true }, context)

      expect(context.setHistoryIndex).toHaveBeenCalledWith(-1)
      expect(context.onChange).toHaveBeenCalledWith('')
      expect(context.setCursorPosition).toHaveBeenCalledWith(0)
    })
  })

  describe('Left/Right arrow (cursor movement)', () => {
    it('should move cursor left', () => {
      context.value = 'hello'
      context.cursorPosition = 3

      handler.handle({ leftArrow: true }, context)

      expect(context.setCursorPosition).toHaveBeenCalledWith(2)
    })

    it('should not move cursor left past 0', () => {
      context.value = 'hello'
      context.cursorPosition = 0

      handler.handle({ leftArrow: true }, context)

      expect(context.setCursorPosition).not.toHaveBeenCalled()
    })

    it('should move cursor right', () => {
      context.value = 'hello'
      context.cursorPosition = 2

      handler.handle({ rightArrow: true }, context)

      expect(context.setCursorPosition).toHaveBeenCalledWith(3)
    })

    it('should not move cursor right past value length', () => {
      context.value = 'hello'
      context.cursorPosition = 5

      handler.handle({ rightArrow: true }, context)

      expect(context.setCursorPosition).not.toHaveBeenCalled()
    })
  })

  describe('Backspace', () => {
    it('should delete character before cursor', () => {
      context.value = 'hello'
      context.cursorPosition = 3

      handler.handle({ backspace: true }, context)

      expect(context.onChange).toHaveBeenCalledWith('helo')
      expect(context.setCursorPosition).toHaveBeenCalledWith(2)
    })

    it('should do nothing at position 0', () => {
      context.value = 'hello'
      context.cursorPosition = 0

      handler.handle({ backspace: true }, context)

      expect(context.onChange).not.toHaveBeenCalled()
    })
  })

  describe('Delete key', () => {
    it('should delete character at cursor', () => {
      context.value = 'hello'
      context.cursorPosition = 2

      handler.handle({ delete: true }, context)

      expect(context.onChange).toHaveBeenCalledWith('helo')
    })

    it('should do nothing at end of value', () => {
      context.value = 'hello'
      context.cursorPosition = 5

      handler.handle({ delete: true }, context)

      expect(context.onChange).not.toHaveBeenCalled()
    })
  })

  describe('Ctrl+A (move to beginning)', () => {
    it('should move cursor to beginning', () => {
      context.value = 'hello world'
      context.cursorPosition = 6

      handler.handle({ input: 'a', ctrl: true }, context)

      expect(context.setCursorPosition).toHaveBeenCalledWith(0)
    })
  })

  describe('Ctrl+E (move to end)', () => {
    it('should move cursor to end', () => {
      context.value = 'hello world'
      context.cursorPosition = 3

      handler.handle({ input: 'e', ctrl: true }, context)

      expect(context.setCursorPosition).toHaveBeenCalledWith(11)
    })
  })

  describe('Ctrl+U (clear line)', () => {
    it('should clear the entire line', () => {
      context.value = 'hello world'
      context.cursorPosition = 6

      handler.handle({ input: 'u', ctrl: true }, context)

      expect(context.onChange).toHaveBeenCalledWith('')
      expect(context.setCursorPosition).toHaveBeenCalledWith(0)
      expect(context.onToggleCompletions).toHaveBeenCalledWith(false)
    })
  })

  describe('Ctrl+K (kill to end of line)', () => {
    it('should delete from cursor to end of line', () => {
      context.value = 'hello world'
      context.cursorPosition = 5

      handler.handle({ input: 'k', ctrl: true }, context)

      expect(context.onChange).toHaveBeenCalledWith('hello')
    })
  })

  describe('Ctrl+W (delete word)', () => {
    it('should delete word before cursor', () => {
      context.value = 'hello world'
      context.cursorPosition = 11

      handler.handle({ input: 'w', ctrl: true }, context)

      expect(context.onChange).toHaveBeenCalledWith('hello ')
      expect(context.setCursorPosition).toHaveBeenCalledWith(6)
    })

    it('should handle multiple spaces', () => {
      context.value = 'hello   world'
      context.cursorPosition = 13

      handler.handle({ input: 'w', ctrl: true }, context)

      expect(context.onChange).toHaveBeenCalledWith('hello   ')
      expect(context.setCursorPosition).toHaveBeenCalledWith(8)
    })

    it('should delete entire line from beginning of word', () => {
      context.value = 'hello'
      context.cursorPosition = 5

      handler.handle({ input: 'w', ctrl: true }, context)

      expect(context.onChange).toHaveBeenCalledWith('')
      expect(context.setCursorPosition).toHaveBeenCalledWith(0)
    })
  })

  describe('Ctrl+Y (yank/paste)', () => {
    it('should paste previously deleted text', async () => {
      // First delete a word
      context.value = 'hello world'
      context.cursorPosition = 11
      handler.handle({ input: 'w', ctrl: true }, context)

      // Reset mocks
      vi.mocked(context.onChange).mockClear()
      vi.mocked(context.setCursorPosition).mockClear()
      context.value = 'hello '
      context.cursorPosition = 6

      // Then yank it back
      handler.handle({ input: 'y', ctrl: true }, context)

      expect(context.onChange).toHaveBeenCalledWith('hello world')
      expect(context.setCursorPosition).toHaveBeenCalledWith(11)
    })
  })

  describe('regular character input', () => {
    it('should insert character at cursor position', () => {
      context.value = 'hllo'
      context.cursorPosition = 1

      handler.handle({ input: 'e' }, context)

      expect(context.onChange).toHaveBeenCalledWith('hello')
      expect(context.setCursorPosition).toHaveBeenCalledWith(2)
    })

    it('should show completions when typing a dot', () => {
      context.value = 'promise'
      context.cursorPosition = 7

      handler.handle({ input: '.' }, context)

      expect(context.onChange).toHaveBeenCalledWith('promise.')
      expect(context.onToggleCompletions).toHaveBeenCalledWith(true)
    })

    it('should ignore input with ctrl modifier', () => {
      context.value = 'hello'
      context.cursorPosition = 5

      const handled = handler.handle({ input: 'x', ctrl: true }, context)

      // Should be handled by specific Ctrl+X binding or ignored
      expect(context.onChange).not.toHaveBeenCalled()
    })

    it('should ignore input with meta modifier', () => {
      context.value = 'hello'
      context.cursorPosition = 5

      handler.handle({ input: 'x', meta: true }, context)

      expect(context.onChange).not.toHaveBeenCalled()
    })
  })

  describe('customizable keybindings', () => {
    it('should allow disabling a default keybinding', () => {
      handler.disable({ input: 'c', ctrl: true })

      handler.handle({ input: 'c', ctrl: true }, context)

      expect(context.onExit).not.toHaveBeenCalled()
    })

    it('should allow re-enabling a disabled keybinding', () => {
      handler.disable({ input: 'c', ctrl: true })
      handler.enable({ input: 'c', ctrl: true })

      handler.handle({ input: 'c', ctrl: true }, context)

      expect(context.onExit).toHaveBeenCalled()
    })

    it('should support Emacs-style keybindings preset', () => {
      const emacsHandler = KeybindingHandler.preset('emacs')

      expect(emacsHandler.getKeybindings()).toContainEqual(
        expect.objectContaining({ key: { input: 'f', ctrl: true }, action: 'cursorRight' })
      )
      expect(emacsHandler.getKeybindings()).toContainEqual(
        expect.objectContaining({ key: { input: 'b', ctrl: true }, action: 'cursorLeft' })
      )
    })

    it('should support Vim-style keybindings preset', () => {
      const vimHandler = KeybindingHandler.preset('vim')

      // In vim normal mode
      expect(vimHandler.getKeybindings()).toContainEqual(
        expect.objectContaining({ key: { input: 'h' }, action: 'cursorLeft', mode: 'normal' })
      )
      expect(vimHandler.getKeybindings()).toContainEqual(
        expect.objectContaining({ key: { input: 'l' }, action: 'cursorRight', mode: 'normal' })
      )
    })

    it('should serialize keybindings to JSON', () => {
      const json = handler.toJSON()
      const parsed = JSON.parse(json)

      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed).toContainEqual(
        expect.objectContaining({ key: { input: 'c', ctrl: true }, action: 'exit' })
      )
    })

    it('should load keybindings from JSON', () => {
      const customJson = JSON.stringify([
        { key: { input: 'q', ctrl: true }, action: 'exit' },
      ])

      const loadedHandler = KeybindingHandler.fromJSON(customJson)

      expect(loadedHandler.getKeybindings()).toContainEqual(
        expect.objectContaining({ key: { input: 'q', ctrl: true }, action: 'exit' })
      )
    })
  })

  describe('keybinding matching', () => {
    it('should match exact key combinations', () => {
      const binding = handler.findBinding({ input: 'c', ctrl: true })

      expect(binding).toBeDefined()
      expect(binding?.action).toBe('exit')
    })

    it('should not match partial key combinations', () => {
      // Ctrl+C is bound, but just 'c' should not match it
      const binding = handler.findBinding({ input: 'c' })

      expect(binding?.action).not.toBe('exit')
    })

    it('should match special keys without input', () => {
      const binding = handler.findBinding({ tab: true })

      expect(binding).toBeDefined()
      expect(binding?.action).toBe('complete')
    })
  })
})

describe('DEFAULT_KEYBINDINGS', () => {
  it('should include all standard readline keybindings', () => {
    expect(DEFAULT_KEYBINDINGS).toContainEqual(
      expect.objectContaining({ key: { input: 'c', ctrl: true }, action: 'exit' })
    )
    expect(DEFAULT_KEYBINDINGS).toContainEqual(
      expect.objectContaining({ key: { input: 'a', ctrl: true }, action: 'moveToBeginning' })
    )
    expect(DEFAULT_KEYBINDINGS).toContainEqual(
      expect.objectContaining({ key: { input: 'e', ctrl: true }, action: 'moveToEnd' })
    )
    expect(DEFAULT_KEYBINDINGS).toContainEqual(
      expect.objectContaining({ key: { input: 'u', ctrl: true }, action: 'clearLine' })
    )
    expect(DEFAULT_KEYBINDINGS).toContainEqual(
      expect.objectContaining({ key: { input: 'w', ctrl: true }, action: 'deleteWord' })
    )
    expect(DEFAULT_KEYBINDINGS).toContainEqual(
      expect.objectContaining({ key: { input: 'k', ctrl: true }, action: 'killToEnd' })
    )
    expect(DEFAULT_KEYBINDINGS).toContainEqual(
      expect.objectContaining({ key: { input: 'y', ctrl: true }, action: 'yank' })
    )
  })

  it('should include arrow key bindings', () => {
    expect(DEFAULT_KEYBINDINGS).toContainEqual(
      expect.objectContaining({ key: { upArrow: true }, action: 'historyUp' })
    )
    expect(DEFAULT_KEYBINDINGS).toContainEqual(
      expect.objectContaining({ key: { downArrow: true }, action: 'historyDown' })
    )
    expect(DEFAULT_KEYBINDINGS).toContainEqual(
      expect.objectContaining({ key: { leftArrow: true }, action: 'cursorLeft' })
    )
    expect(DEFAULT_KEYBINDINGS).toContainEqual(
      expect.objectContaining({ key: { rightArrow: true }, action: 'cursorRight' })
    )
  })

  it('should include completion keybindings', () => {
    expect(DEFAULT_KEYBINDINGS).toContainEqual(
      expect.objectContaining({ key: { tab: true }, action: 'complete' })
    )
    expect(DEFAULT_KEYBINDINGS).toContainEqual(
      expect.objectContaining({ key: { escape: true }, action: 'hideCompletions' })
    )
    expect(DEFAULT_KEYBINDINGS).toContainEqual(
      expect.objectContaining({ key: { input: ' ', ctrl: true }, action: 'toggleCompletions' })
    )
  })
})

describe('KeybindingAction type', () => {
  it('should define all standard actions', () => {
    // This test verifies the type is exported correctly
    const actions: KeybindingAction[] = [
      'exit',
      'submit',
      'complete',
      'toggleCompletions',
      'hideCompletions',
      'historyUp',
      'historyDown',
      'cursorLeft',
      'cursorRight',
      'moveToBeginning',
      'moveToEnd',
      'backspace',
      'delete',
      'deleteWord',
      'clearLine',
      'killToEnd',
      'yank',
      'insertNewline',
      'insertChar',
      'cancel',
      'custom',
    ]

    expect(actions).toHaveLength(21)
  })
})

describe('KeyEvent type', () => {
  it('should support all ink useInput key properties', () => {
    // Verify the KeyEvent type matches ink's useInput key structure
    const keyEvent: KeyEvent = {
      input: 'a',
      ctrl: true,
      meta: false,
      shift: false,
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      tab: false,
      backspace: false,
      delete: false,
      escape: false,
      return: false,
    }

    expect(keyEvent.input).toBe('a')
    expect(keyEvent.ctrl).toBe(true)
  })
})
