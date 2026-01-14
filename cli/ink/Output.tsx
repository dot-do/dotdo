import React from 'react'
import { Box, Text } from 'ink'

interface OutputEntry {
  type: 'input' | 'output' | 'error'
  content: string
}

interface OutputProps {
  entries: OutputEntry[]
}

export function Output({ entries }: OutputProps) {
  return (
    <Box flexDirection="column">
      {entries.map((entry, i) => (
        <Box key={i}>
          {entry.type === 'input' && (
            <Text color="gray">&gt; {entry.content}</Text>
          )}
          {entry.type === 'output' && (
            <Text>{entry.content}</Text>
          )}
          {entry.type === 'error' && (
            <Text color="red">{entry.content}</Text>
          )}
        </Box>
      ))}
    </Box>
  )
}
