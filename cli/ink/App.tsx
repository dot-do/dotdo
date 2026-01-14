import React, { useState, useCallback, useMemo } from 'react'
import { Box } from 'ink'
import { Header } from './Header'
import { Input } from './Input'
import { Output } from './Output'
import { createCompletionService } from '../services/ts-completions'
import { join } from 'path'

interface AppProps {
  doName: string
  user?: string
  onExecute: (code: string) => Promise<string>
  typesPath?: string
}

interface OutputEntry {
  type: 'input' | 'output' | 'error'
  content: string
}

export function App({ doName, user, onExecute, typesPath }: AppProps) {
  const [entries, setEntries] = useState<OutputEntry[]>([])
  const [currentInput, setCurrentInput] = useState('')

  // Create completion service with optional types path
  const completionService = useMemo(() => {
    const defaultTypesPath = typesPath || join(process.cwd(), '.do', 'types.d.ts')
    return createCompletionService(defaultTypesPath)
  }, [typesPath])

  // Get dynamic completions based on current input
  const completions = useMemo(() => {
    if (!currentInput) {
      // Default completions when input is empty
      return ['$', 'await', 'const', 'let', 'async']
    }
    // Get completions at end of current input
    return completionService.getCompletions(currentInput, currentInput.length)
  }, [currentInput, completionService])

  const handleSubmit = useCallback(async (code: string) => {
    if (!code.trim()) return

    // Handle special commands
    if (code.startsWith('.')) {
      if (code === '.help') {
        setEntries(e => [...e, {
          type: 'output',
          content: `Commands:
  .help    - Show this help
  .clear   - Clear output
  Ctrl+C   - Exit`
        }])
        return
      }
      if (code === '.clear') {
        setEntries([])
        return
      }
    }

    // Add input to history
    setEntries(e => [...e, { type: 'input', content: code }])

    try {
      const result = await onExecute(code)
      setEntries(e => [...e, { type: 'output', content: result }])
    } catch (error) {
      setEntries(e => [...e, {
        type: 'error',
        content: error instanceof Error ? error.message : String(error)
      }])
    }
  }, [onExecute])

  return (
    <Box flexDirection="column" padding={1}>
      <Header doName={doName} user={user} />
      <Output entries={entries} />
      <Input
        prompt={`${doName}> `}
        onSubmit={handleSubmit}
        onChange={setCurrentInput}
        completions={completions}
      />
    </Box>
  )
}
