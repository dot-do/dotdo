import React from 'react'
import { Box, Text } from 'ink'

interface HeaderProps {
  doName: string
  user?: string
}

export function Header({ doName, user }: HeaderProps) {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text color="cyan" bold>{doName}</Text>
      {user && (
        <>
          <Text> </Text>
          <Text color="gray">{user}</Text>
        </>
      )}
    </Box>
  )
}
