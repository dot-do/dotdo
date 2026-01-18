/**
 * Input Component with Autocomplete
 *
 * A text input component that integrates with the TypeScript
 * completion engine to provide real-time autocomplete.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { Suggestions } from './Suggestions.js'
import type { CompletionItem } from '../completions.js'

export interface InputProps {
  /** Prompt prefix */
  prompt?: string
  /** Current input value */
  value: string
  /** Called when value changes */
  onChange: (value: string) => void
  /** Called when Enter is pressed */
  onSubmit: (value: string) => void
  /** Available completions */
  completions: CompletionItem[]
  /** Called when completions are needed */
  onRequestCompletions: (value: string, cursorPosition: number) => void
  /** Whether to show completions */
  showCompletions: boolean
  /** Called to toggle completion visibility */
  onToggleCompletions: (show: boolean) => void
  /** History navigation */
  history: string[]
  /** Placeholder text */
  placeholder?: string
  /** Is input focused */
  focused?: boolean
  /** Multi-line mode */
  multiline?: boolean
}

/**
 * Custom text input with autocomplete support
 */
export function Input({
  prompt = '> ',
  value,
  onChange,
  onSubmit,
  completions,
  onRequestCompletions,
  showCompletions,
  onToggleCompletions,
  history,
  placeholder = '',
  focused = true,
  multiline = false,
}: InputProps): React.ReactElement {
  const [cursorPosition, setCursorPosition] = useState(value.length)
  const [selectedCompletion, setSelectedCompletion] = useState(0)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const { exit } = useApp()

  // Debounce timer for completions
  const completionTimer = useRef<NodeJS.Timeout | null>(null)

  // Request completions with debounce
  const requestCompletionsDebounced = useCallback((newValue: string, position: number) => {
    if (completionTimer.current) {
      clearTimeout(completionTimer.current)
    }
    completionTimer.current = setTimeout(() => {
      onRequestCompletions(newValue, position)
    }, 100)
  }, [onRequestCompletions])

  // Handle input changes
  const handleChange = useCallback((newValue: string, newCursorPos: number) => {
    onChange(newValue)
    setCursorPosition(newCursorPos)
    setSelectedCompletion(0)
    setHistoryIndex(-1)
    requestCompletionsDebounced(newValue, newCursorPos)
  }, [onChange, requestCompletionsDebounced])

  // Apply selected completion
  const applyCompletion = useCallback((completion: CompletionItem) => {
    // Find the word start
    let wordStart = cursorPosition
    while (wordStart > 0 && /[\w$]/.test(value[wordStart - 1] ?? '')) {
      wordStart--
    }

    // Build new value
    const before = value.slice(0, wordStart)
    const after = value.slice(cursorPosition)
    const insertText = completion.isMethod ? `${completion.name}(` : completion.name
    const newValue = before + insertText + after
    const newCursorPos = wordStart + insertText.length

    onChange(newValue)
    setCursorPosition(newCursorPos)
    onToggleCompletions(false)
    setSelectedCompletion(0)
  }, [value, cursorPosition, onChange, onToggleCompletions])

  // Handle key input
  useInput((input, key) => {
    if (!focused) return

    // Ctrl+C to exit
    if (input === 'c' && key.ctrl) {
      exit()
      return
    }

    // Ctrl+Space to toggle completions
    if (input === ' ' && key.ctrl) {
      onToggleCompletions(!showCompletions)
      if (!showCompletions) {
        onRequestCompletions(value, cursorPosition)
      }
      return
    }

    // Escape to hide completions
    if (key.escape) {
      onToggleCompletions(false)
      return
    }

    // Tab to complete
    if (key.tab) {
      const selectedItem = completions[selectedCompletion]
      if (showCompletions && completions.length > 0 && selectedItem) {
        applyCompletion(selectedItem)
      } else if (completions.length > 0) {
        onToggleCompletions(true)
      }
      return
    }

    // Enter to submit or select completion
    if (key.return) {
      const selectedItem = completions[selectedCompletion]
      if (showCompletions && completions.length > 0 && selectedItem) {
        applyCompletion(selectedItem)
      } else if (multiline && key.shift) {
        // Shift+Enter for newline in multiline mode
        const newValue = value.slice(0, cursorPosition) + '\n' + value.slice(cursorPosition)
        handleChange(newValue, cursorPosition + 1)
      } else {
        onSubmit(value)
        setHistoryIndex(-1)
      }
      return
    }

    // Arrow up/down for completion navigation or history
    if (key.upArrow) {
      if (showCompletions && completions.length > 0) {
        setSelectedCompletion(prev => Math.max(0, prev - 1))
      } else if (history.length > 0) {
        const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex
        setHistoryIndex(newIndex)
        if (newIndex >= 0) {
          const historyValue = history[history.length - 1 - newIndex]
          if (historyValue !== undefined) {
            onChange(historyValue)
            setCursorPosition(historyValue.length)
          }
        }
      }
      return
    }

    if (key.downArrow) {
      if (showCompletions && completions.length > 0) {
        setSelectedCompletion(prev => Math.min(completions.length - 1, prev + 1))
      } else if (historyIndex > 0) {
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        const historyValue = history[history.length - 1 - newIndex]
        if (historyValue !== undefined) {
          onChange(historyValue)
          setCursorPosition(historyValue.length)
        }
      } else if (historyIndex === 0) {
        setHistoryIndex(-1)
        onChange('')
        setCursorPosition(0)
      }
      return
    }

    // Left/right arrow for cursor movement
    if (key.leftArrow) {
      if (cursorPosition > 0) {
        setCursorPosition(cursorPosition - 1)
      }
      return
    }

    if (key.rightArrow) {
      if (cursorPosition < value.length) {
        setCursorPosition(cursorPosition + 1)
      }
      return
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorPosition > 0) {
        const newValue = value.slice(0, cursorPosition - 1) + value.slice(cursorPosition)
        handleChange(newValue, cursorPosition - 1)
      }
      return
    }

    // Ctrl+A - move to beginning
    if (input === 'a' && key.ctrl) {
      setCursorPosition(0)
      return
    }

    // Ctrl+E - move to end
    if (input === 'e' && key.ctrl) {
      setCursorPosition(value.length)
      return
    }

    // Ctrl+U - clear line
    if (input === 'u' && key.ctrl) {
      onChange('')
      setCursorPosition(0)
      onToggleCompletions(false)
      return
    }

    // Ctrl+W - delete word
    if (input === 'w' && key.ctrl) {
      let wordStart = cursorPosition
      // Skip spaces
      while (wordStart > 0 && /\s/.test(value[wordStart - 1] ?? '')) {
        wordStart--
      }
      // Find word start
      while (wordStart > 0 && !/\s/.test(value[wordStart - 1] ?? '')) {
        wordStart--
      }
      const newValue = value.slice(0, wordStart) + value.slice(cursorPosition)
      handleChange(newValue, wordStart)
      return
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      const newValue = value.slice(0, cursorPosition) + input + value.slice(cursorPosition)
      handleChange(newValue, cursorPosition + input.length)

      // Show completions on dot
      if (input === '.') {
        onToggleCompletions(true)
      }
    }
  }, { isActive: focused })

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (completionTimer.current) {
        clearTimeout(completionTimer.current)
      }
    }
  }, [])

  // Render the input line with cursor
  const renderInput = () => {
    const before = value.slice(0, cursorPosition)
    const cursor = value[cursorPosition] ?? ' '
    const after = value.slice(cursorPosition + 1)

    return (
      <Text>
        <Text color="cyan" bold>{prompt}</Text>
        <Text>{before}</Text>
        <Text inverse>{cursor}</Text>
        <Text>{after}</Text>
        {value.length === 0 && <Text dimColor>{placeholder}</Text>}
      </Text>
    )
  }

  return (
    <Box flexDirection="column">
      <Box>
        {renderInput()}
      </Box>
      <Suggestions
        suggestions={completions}
        selectedIndex={selectedCompletion}
        visible={showCompletions && completions.length > 0}
      />
    </Box>
  )
}

/**
 * Simple status bar component
 */
export interface StatusBarProps {
  connected: boolean
  endpoint?: string
  mode?: string
}

export function StatusBar({ connected, endpoint, mode }: StatusBarProps): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Box marginRight={2}>
        <Text color={connected ? 'green' : 'red'}>
          {connected ? 'connected' : 'disconnected'}
        </Text>
      </Box>
      {endpoint && (
        <Box marginRight={2}>
          <Text dimColor>{endpoint}</Text>
        </Box>
      )}
      {mode && (
        <Box>
          <Text color="yellow">[{mode}]</Text>
        </Box>
      )}
    </Box>
  )
}
