import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { Worker } from '../services/workers-do'

interface WorkerPickerProps {
  workers: Worker[]
  onSelect: (worker: Worker) => void
  onCancel: () => void
}

export function WorkerPicker({ workers, onSelect, onCancel }: WorkerPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1))
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(workers.length - 1, i + 1))
    } else if (key.return) {
      const selected = workers[selectedIndex]
      if (selected) {
        onSelect(selected)
      }
    } else if (key.escape) {
      onCancel()
    }
  })

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Select a worker:</Text>
      <Box flexDirection="column" marginTop={1}>
        {workers.map((worker, i) => (
          <Box key={worker.$id}>
            <Text color={i === selectedIndex ? 'cyan' : undefined}>
              {i === selectedIndex ? '> ' : '  '}
              {worker.name || worker.url}
            </Text>
            {worker.accessedAt && (
              <Text color="gray"> (accessed {formatRelativeTime(worker.accessedAt)})</Text>
            )}
          </Box>
        ))}
      </Box>
      <Text color="gray" marginTop={1}>
        Up/Down navigate - Enter select - Esc cancel
      </Text>
    </Box>
  )
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}
