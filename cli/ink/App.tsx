import React, { useState, useCallback } from 'react'
import { Box } from 'ink'
import { Header } from './Header'
import { Input } from './Input'
import { Output } from './Output'

interface AppProps {
  doName: string
  user?: string
  onExecute: (code: string) => Promise<string>
}

interface OutputEntry {
  type: 'input' | 'output' | 'error'
  content: string
}

export function App({ doName, user, onExecute }: AppProps) {
  const [entries, setEntries] = useState<OutputEntry[]>([])
  const [completions] = useState<string[]>([
    '$.things',
    '$.events',
    '$.actions',
    '$.on',
    '$.every',
    'await',
  ])

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
  .types   - Regenerate types
  .switch  - Switch DO
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
        completions={completions}
      />
    </Box>
  )
}
