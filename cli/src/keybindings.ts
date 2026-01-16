/**
 * Keybinding Handler Module
 *
 * Extracted keybinding logic that was previously in Input.tsx.
 * Provides a configurable keybinding registry with support for:
 * - Standard readline keybindings
 * - Customizable keybinding presets (default, emacs, vim)
 * - Registration/unregistration of keybindings
 * - Conflict detection
 */

// Types
export type KeybindingAction =
  | 'exit'
  | 'submit'
  | 'complete'
  | 'toggleCompletions'
  | 'hideCompletions'
  | 'historyUp'
  | 'historyDown'
  | 'cursorLeft'
  | 'cursorRight'
  | 'moveToBeginning'
  | 'moveToEnd'
  | 'backspace'
  | 'delete'
  | 'deleteWord'
  | 'clearLine'
  | 'killToEnd'
  | 'yank'
  | 'insertNewline'
  | 'insertChar'
  | 'cancel'
  | 'custom'
  | 'exitOrDelete'
  | 'clearScreen'

export interface KeyEvent {
  input?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  upArrow?: boolean
  downArrow?: boolean
  leftArrow?: boolean
  rightArrow?: boolean
  tab?: boolean
  backspace?: boolean
  delete?: boolean
  escape?: boolean
  return?: boolean
}

export interface Keybinding {
  key: KeyEvent
  action: KeybindingAction | string
  handler?: (context: KeybindingContext) => void
  mode?: 'normal' | 'insert' // For vim mode
}

export interface CompletionItem {
  name: string
  kind: string
  isMethod?: boolean
}

export interface KeybindingContext {
  value: string
  cursorPosition: number
  history: string[]
  historyIndex: number
  completions: CompletionItem[]
  selectedCompletion: number
  showCompletions: boolean
  focused: boolean
  multiline: boolean

  // Action callbacks
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  onExit: () => void
  onToggleCompletions: (show: boolean) => void
  onRequestCompletions: (value: string, position: number) => void
  setCursorPosition: (position: number) => void
  setHistoryIndex: (index: number) => void
  setSelectedCompletion: (index: number) => void
}

export interface KeybindingConflict {
  key: KeyEvent
  existing: string
  proposed: string
}

export interface KeybindingHandlerOptions {
  mergeWithDefaults?: boolean
}

// Default keybindings
export const DEFAULT_KEYBINDINGS: Keybinding[] = [
  // Exit
  { key: { input: 'c', ctrl: true }, action: 'exit' },
  { key: { input: 'd', ctrl: true }, action: 'exitOrDelete' },

  // Navigation
  { key: { input: 'a', ctrl: true }, action: 'moveToBeginning' },
  { key: { input: 'e', ctrl: true }, action: 'moveToEnd' },
  { key: { leftArrow: true }, action: 'cursorLeft' },
  { key: { rightArrow: true }, action: 'cursorRight' },

  // History
  { key: { upArrow: true }, action: 'historyUp' },
  { key: { downArrow: true }, action: 'historyDown' },

  // Editing
  { key: { backspace: true }, action: 'backspace' },
  { key: { delete: true }, action: 'delete' },
  { key: { input: 'u', ctrl: true }, action: 'clearLine' },
  { key: { input: 'k', ctrl: true }, action: 'killToEnd' },
  { key: { input: 'w', ctrl: true }, action: 'deleteWord' },
  { key: { input: 'y', ctrl: true }, action: 'yank' },

  // Completions
  { key: { tab: true }, action: 'complete' },
  { key: { escape: true }, action: 'hideCompletions' },
  { key: { input: ' ', ctrl: true }, action: 'toggleCompletions' },

  // Submit
  { key: { return: true }, action: 'submit' },
]

// Emacs keybindings preset
const EMACS_KEYBINDINGS: Keybinding[] = [
  ...DEFAULT_KEYBINDINGS,
  { key: { input: 'f', ctrl: true }, action: 'cursorRight' },
  { key: { input: 'b', ctrl: true }, action: 'cursorLeft' },
  { key: { input: 'n', ctrl: true }, action: 'historyDown' },
  { key: { input: 'p', ctrl: true }, action: 'historyUp' },
]

// Vim keybindings preset
const VIM_KEYBINDINGS: Keybinding[] = [
  ...DEFAULT_KEYBINDINGS,
  { key: { input: 'h' }, action: 'cursorLeft', mode: 'normal' },
  { key: { input: 'l' }, action: 'cursorRight', mode: 'normal' },
  { key: { input: 'j' }, action: 'historyDown', mode: 'normal' },
  { key: { input: 'k' }, action: 'historyUp', mode: 'normal' },
]

export class KeybindingHandler {
  private keybindings: Keybinding[]
  private disabledKeys: Set<string> = new Set()
  private killRing: string = '' // For yank functionality

  constructor(customBindings?: Keybinding[], options?: KeybindingHandlerOptions) {
    if (customBindings) {
      if (options?.mergeWithDefaults) {
        this.keybindings = [...DEFAULT_KEYBINDINGS, ...customBindings]
      } else {
        this.keybindings = [...customBindings]
      }
    } else {
      this.keybindings = [...DEFAULT_KEYBINDINGS]
    }
  }

  static preset(name: 'default' | 'emacs' | 'vim'): KeybindingHandler {
    switch (name) {
      case 'emacs':
        return new KeybindingHandler(EMACS_KEYBINDINGS)
      case 'vim':
        return new KeybindingHandler(VIM_KEYBINDINGS)
      default:
        return new KeybindingHandler()
    }
  }

  static fromJSON(json: string): KeybindingHandler {
    const bindings = JSON.parse(json) as Keybinding[]
    return new KeybindingHandler(bindings)
  }

  getKeybindings(): Keybinding[] {
    return [...this.keybindings]
  }

  register(binding: Keybinding): void {
    // Validate keybinding
    if (!this.isValidKey(binding.key)) {
      throw new Error('Invalid keybinding: key must have input or a special key')
    }

    // Check if keybinding already exists, override if so
    const existingIndex = this.keybindings.findIndex(b => this.keysMatch(b.key, binding.key))
    if (existingIndex >= 0) {
      this.keybindings[existingIndex] = binding
    } else {
      this.keybindings.push(binding)
    }
  }

  unregister(key: KeyEvent): void {
    this.keybindings = this.keybindings.filter(b => !this.keysMatch(b.key, key))
  }

  disable(key: KeyEvent): void {
    this.disabledKeys.add(this.keyToString(key))
  }

  enable(key: KeyEvent): void {
    this.disabledKeys.delete(this.keyToString(key))
  }

  findBinding(key: KeyEvent): Keybinding | undefined {
    return this.keybindings.find(b => this.keysMatch(b.key, key))
  }

  findConflicts(bindings: Keybinding[]): KeybindingConflict[] {
    const conflicts: KeybindingConflict[] = []

    for (const binding of bindings) {
      const existing = this.findBinding(binding.key)
      if (existing && existing.action !== binding.action) {
        conflicts.push({
          key: binding.key,
          existing: existing.action,
          proposed: binding.action,
        })
      }
    }

    return conflicts
  }

  toJSON(): string {
    return JSON.stringify(this.keybindings)
  }

  handle(key: KeyEvent, context: KeybindingContext): boolean {
    // Don't handle if not focused
    if (!context.focused) {
      return false
    }

    // Check if key is disabled
    if (this.disabledKeys.has(this.keyToString(key))) {
      return false
    }

    // Find matching binding (first try exact, then try flexible for special keys)
    let binding = this.findBinding(key)

    // If no exact match but we have return/tab/etc with modifiers, try matching without modifiers
    if (!binding && (key.return || key.tab || key.escape)) {
      binding = this.findBindingFlexible(key)
    }

    // Handle custom handler
    if (binding?.handler) {
      binding.handler(context)
      return true
    }

    // Handle built-in actions
    if (binding) {
      return this.executeAction(binding.action, key, context)
    }

    // Handle regular character input
    if (key.input && !key.ctrl && !key.meta) {
      this.handleCharInput(key.input, context)
      return true
    }

    return false
  }

  /**
   * Find binding with flexible matching - matches special keys even if modifiers differ
   * This allows Shift+Enter to match the 'return' binding
   */
  private findBindingFlexible(key: KeyEvent): Keybinding | undefined {
    // Create a version of the key without modifiers for matching
    const baseKey: KeyEvent = {
      return: key.return,
      tab: key.tab,
      escape: key.escape,
      upArrow: key.upArrow,
      downArrow: key.downArrow,
      leftArrow: key.leftArrow,
      rightArrow: key.rightArrow,
      backspace: key.backspace,
      delete: key.delete,
    }
    return this.keybindings.find(b => this.keysMatchBase(b.key, baseKey))
  }

  /**
   * Match only the base key (special keys) without considering modifiers
   */
  private keysMatchBase(a: KeyEvent, b: KeyEvent): boolean {
    return (
      !!a.return === !!b.return &&
      !!a.tab === !!b.tab &&
      !!a.escape === !!b.escape &&
      !!a.upArrow === !!b.upArrow &&
      !!a.downArrow === !!b.downArrow &&
      !!a.leftArrow === !!b.leftArrow &&
      !!a.rightArrow === !!b.rightArrow &&
      !!a.backspace === !!b.backspace &&
      !!a.delete === !!b.delete &&
      !a.input && !b.input  // Only match special keys, not character keys
    )
  }

  private executeAction(action: string, key: KeyEvent, context: KeybindingContext): boolean {
    switch (action) {
      case 'exit':
        context.onExit()
        return true

      case 'exitOrDelete':
        if (context.value === '') {
          context.onExit()
        } else {
          this.deleteCharAtCursor(context)
        }
        return true

      case 'submit':
        return this.handleSubmit(key, context)

      case 'complete':
        return this.handleTab(context)

      case 'toggleCompletions':
        if (context.showCompletions) {
          context.onToggleCompletions(false)
        } else {
          context.onToggleCompletions(true)
          context.onRequestCompletions(context.value, context.cursorPosition)
        }
        return true

      case 'hideCompletions':
        context.onToggleCompletions(false)
        return true

      case 'historyUp':
        return this.handleHistoryUp(context)

      case 'historyDown':
        return this.handleHistoryDown(context)

      case 'cursorLeft':
        if (context.cursorPosition > 0) {
          context.setCursorPosition(context.cursorPosition - 1)
        }
        return true

      case 'cursorRight':
        if (context.cursorPosition < context.value.length) {
          context.setCursorPosition(context.cursorPosition + 1)
        }
        return true

      case 'moveToBeginning':
        context.setCursorPosition(0)
        return true

      case 'moveToEnd':
        context.setCursorPosition(context.value.length)
        return true

      case 'backspace':
        if (context.cursorPosition > 0) {
          const newValue =
            context.value.slice(0, context.cursorPosition - 1) +
            context.value.slice(context.cursorPosition)
          context.onChange(newValue)
          context.setCursorPosition(context.cursorPosition - 1)
        }
        return true

      case 'delete':
        this.deleteCharAtCursor(context)
        return true

      case 'clearLine':
        context.onChange('')
        context.setCursorPosition(0)
        context.onToggleCompletions(false)
        return true

      case 'killToEnd':
        const killed = context.value.slice(context.cursorPosition)
        this.killRing = killed
        context.onChange(context.value.slice(0, context.cursorPosition))
        return true

      case 'deleteWord':
        return this.handleDeleteWord(context)

      case 'yank':
        if (this.killRing) {
          const newValue =
            context.value.slice(0, context.cursorPosition) +
            this.killRing +
            context.value.slice(context.cursorPosition)
          context.onChange(newValue)
          context.setCursorPosition(context.cursorPosition + this.killRing.length)
        }
        return true

      case 'insertNewline':
        const newValue =
          context.value.slice(0, context.cursorPosition) +
          '\n' +
          context.value.slice(context.cursorPosition)
        context.onChange(newValue)
        context.setCursorPosition(context.cursorPosition + 1)
        return true

      default:
        return false
    }
  }

  private handleSubmit(key: KeyEvent, context: KeybindingContext): boolean {
    // Handle Shift+Enter
    if (key.shift) {
      if (context.multiline) {
        // Insert newline in multiline mode
        const newValue =
          context.value.slice(0, context.cursorPosition) +
          '\n' +
          context.value.slice(context.cursorPosition)
        context.onChange(newValue)
        context.setCursorPosition(context.cursorPosition + 1)
      } else {
        // Submit in single-line mode
        context.onSubmit(context.value)
      }
      return true
    }

    // Apply completion if visible
    if (context.showCompletions && context.completions.length > 0) {
      this.applyCompletion(context)
      return true
    }

    // Submit
    context.onSubmit(context.value)
    return true
  }

  private handleTab(context: KeybindingContext): boolean {
    if (context.showCompletions && context.completions.length > 0) {
      // Apply the selected completion
      this.applyCompletion(context)
      return true
    }

    if (context.completions.length > 0) {
      // Show completions
      context.onToggleCompletions(true)
      return true
    }

    return true
  }

  private handleHistoryUp(context: KeybindingContext): boolean {
    if (context.showCompletions) {
      // Navigate completions up
      const newIndex = Math.max(0, context.selectedCompletion - 1)
      context.setSelectedCompletion(newIndex)
    } else {
      // Navigate history
      const newIndex = Math.min(context.historyIndex + 1, context.history.length - 1)
      context.setHistoryIndex(newIndex)
      if (context.history[newIndex]) {
        const historyValue = context.history[context.history.length - 1 - newIndex]
        context.onChange(historyValue)
        context.setCursorPosition(historyValue.length)
      }
    }
    return true
  }

  private handleHistoryDown(context: KeybindingContext): boolean {
    if (context.showCompletions) {
      // Navigate completions down
      const maxIndex = context.completions.length - 1
      const newIndex = Math.min(context.selectedCompletion + 1, maxIndex)
      context.setSelectedCompletion(newIndex)
    } else {
      // Navigate history
      if (context.historyIndex > 0) {
        const newIndex = context.historyIndex - 1
        context.setHistoryIndex(newIndex)
        const historyValue = context.history[context.history.length - 1 - newIndex]
        context.onChange(historyValue)
        context.setCursorPosition(historyValue.length)
      } else if (context.historyIndex === 0) {
        context.setHistoryIndex(-1)
        context.onChange('')
        context.setCursorPosition(0)
      }
    }
    return true
  }

  private handleDeleteWord(context: KeybindingContext): boolean {
    // Find word boundary going backwards from cursor
    let pos = context.cursorPosition

    // Skip any trailing spaces
    while (pos > 0 && context.value[pos - 1] === ' ') {
      pos--
    }

    // Find start of word
    while (pos > 0 && context.value[pos - 1] !== ' ') {
      pos--
    }

    const deleted = context.value.slice(pos, context.cursorPosition)
    this.killRing = deleted

    const newValue = context.value.slice(0, pos) + context.value.slice(context.cursorPosition)
    context.onChange(newValue)
    context.setCursorPosition(pos)

    return true
  }

  private handleCharInput(char: string, context: KeybindingContext): void {
    const newValue =
      context.value.slice(0, context.cursorPosition) +
      char +
      context.value.slice(context.cursorPosition)
    context.onChange(newValue)
    context.setCursorPosition(context.cursorPosition + 1)

    // Show completions when typing a dot
    if (char === '.') {
      context.onToggleCompletions(true)
    }
  }

  private deleteCharAtCursor(context: KeybindingContext): void {
    if (context.cursorPosition < context.value.length) {
      const newValue =
        context.value.slice(0, context.cursorPosition) +
        context.value.slice(context.cursorPosition + 1)
      context.onChange(newValue)
    }
  }

  private applyCompletion(context: KeybindingContext): void {
    const completion = context.completions[context.selectedCompletion]
    if (!completion) return

    // Find the partial text to replace (everything after the last dot)
    const lastDotIndex = context.value.lastIndexOf('.')
    const prefix = lastDotIndex >= 0 ? context.value.slice(0, lastDotIndex + 1) : ''

    // Build the completion text
    let completionText = completion.name
    if (completion.isMethod) {
      completionText += '('
    }

    const newValue = prefix + completionText
    context.onChange(newValue)
    context.setCursorPosition(newValue.length)
    context.onToggleCompletions(false)
  }

  private isValidKey(key: KeyEvent): boolean {
    return !!(
      key.input ||
      key.upArrow ||
      key.downArrow ||
      key.leftArrow ||
      key.rightArrow ||
      key.tab ||
      key.backspace ||
      key.delete ||
      key.escape ||
      key.return
    )
  }

  private keysMatch(a: KeyEvent, b: KeyEvent): boolean {
    // Check all modifiers and special keys
    return (
      a.input === b.input &&
      !!a.ctrl === !!b.ctrl &&
      !!a.meta === !!b.meta &&
      !!a.shift === !!b.shift &&
      !!a.upArrow === !!b.upArrow &&
      !!a.downArrow === !!b.downArrow &&
      !!a.leftArrow === !!b.leftArrow &&
      !!a.rightArrow === !!b.rightArrow &&
      !!a.tab === !!b.tab &&
      !!a.backspace === !!b.backspace &&
      !!a.delete === !!b.delete &&
      !!a.escape === !!b.escape &&
      !!a.return === !!b.return
    )
  }

  private keyToString(key: KeyEvent): string {
    const parts: string[] = []
    if (key.ctrl) parts.push('ctrl')
    if (key.meta) parts.push('meta')
    if (key.shift) parts.push('shift')
    if (key.input) parts.push(key.input)
    if (key.upArrow) parts.push('up')
    if (key.downArrow) parts.push('down')
    if (key.leftArrow) parts.push('left')
    if (key.rightArrow) parts.push('right')
    if (key.tab) parts.push('tab')
    if (key.backspace) parts.push('backspace')
    if (key.delete) parts.push('delete')
    if (key.escape) parts.push('escape')
    if (key.return) parts.push('return')
    return parts.join('+')
  }
}
