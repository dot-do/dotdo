import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

interface InputProps {
  prompt: string
  onSubmit: (value: string) => void
  onChange?: (value: string) => void
  completions?: string[]
}

export function Input({ prompt, onSubmit, onChange, completions = [] }: InputProps) {
  const [value, setValue] = useState('')
  const [showCompletions, setShowCompletions] = useState(false)

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value)
      setValue('')
      onChange?.('')
      setShowCompletions(false)
    } else if (key.backspace || key.delete) {
      setValue(v => {
        const newValue = v.slice(0, -1)
        onChange?.(newValue)
        return newValue
      })
    } else if (key.tab) {
      setShowCompletions(true)
    } else if (key.escape) {
      setShowCompletions(false)
    } else if (!key.ctrl && !key.meta && input) {
      setValue(v => {
        const newValue = v + input
        onChange?.(newValue)
        return newValue
      })
    }
  })

  const filteredCompletions = completions.filter(c =>
    c.toLowerCase().startsWith(value.toLowerCase())
  ).slice(0, 5)

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="green">{prompt}</Text>
        <Text>{value}</Text>
        <Text color="gray">|</Text>
      </Box>
      {showCompletions && filteredCompletions.length > 0 && (
        <Box flexDirection="column" marginLeft={prompt.length}>
          {filteredCompletions.map((c, i) => (
            <Text key={i} color="yellow">{c}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
