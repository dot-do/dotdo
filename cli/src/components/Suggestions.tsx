/**
 * Suggestions Dropdown Component
 *
 * Displays autocomplete suggestions in a dropdown below the input.
 * Supports keyboard navigation and selection.
 */

import React from 'react'
import { Box, Text } from 'ink'
import type { CompletionItem } from '../completions.js'
import ts from 'typescript'

export interface SuggestionsProps {
  /** List of suggestions to display */
  suggestions: CompletionItem[]
  /** Currently selected index */
  selectedIndex: number
  /** Maximum suggestions to show */
  maxVisible?: number
  /** Whether the dropdown is visible */
  visible: boolean
}

/**
 * Get icon for completion kind
 */
function getKindIcon(kind: ts.ScriptElementKind): string {
  switch (kind) {
    case ts.ScriptElementKind.functionElement:
    case ts.ScriptElementKind.memberFunctionElement:
      return 'fn'
    case ts.ScriptElementKind.variableElement:
    case ts.ScriptElementKind.letElement:
    case ts.ScriptElementKind.constElement:
      return 'v'
    case ts.ScriptElementKind.memberVariableElement:
      return 'p'
    case ts.ScriptElementKind.interfaceElement:
      return 'I'
    case ts.ScriptElementKind.typeElement:
      return 'T'
    case ts.ScriptElementKind.classElement:
      return 'C'
    case ts.ScriptElementKind.keyword:
      return 'k'
    default:
      return ' '
  }
}

/**
 * Get color for completion kind
 */
function getKindColor(kind: ts.ScriptElementKind): string {
  switch (kind) {
    case ts.ScriptElementKind.functionElement:
    case ts.ScriptElementKind.memberFunctionElement:
      return 'magenta'
    case ts.ScriptElementKind.variableElement:
    case ts.ScriptElementKind.letElement:
    case ts.ScriptElementKind.constElement:
    case ts.ScriptElementKind.memberVariableElement:
      return 'cyan'
    case ts.ScriptElementKind.interfaceElement:
    case ts.ScriptElementKind.typeElement:
      return 'yellow'
    case ts.ScriptElementKind.classElement:
      return 'green'
    case ts.ScriptElementKind.keyword:
      return 'blue'
    default:
      return 'white'
  }
}

/**
 * Suggestions dropdown component
 */
export function Suggestions({
  suggestions,
  selectedIndex,
  maxVisible = 8,
  visible,
}: SuggestionsProps): React.ReactElement | null {
  if (!visible || suggestions.length === 0) {
    return null
  }

  // Calculate visible window
  const startIndex = Math.max(0, Math.min(
    selectedIndex - Math.floor(maxVisible / 2),
    suggestions.length - maxVisible
  ))
  const visibleSuggestions = suggestions.slice(startIndex, startIndex + maxVisible)

  // Find max width for alignment
  const maxNameWidth = Math.max(...visibleSuggestions.map(s => s.name.length))

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" marginTop={1}>
      {visibleSuggestions.map((suggestion, i) => {
        const actualIndex = startIndex + i
        const isSelected = actualIndex === selectedIndex
        const icon = getKindIcon(suggestion.kind)
        const color = getKindColor(suggestion.kind)

        return (
          <Box key={suggestion.name + actualIndex}>
            <Text
              backgroundColor={isSelected ? 'blue' : undefined}
              color={isSelected ? 'white' : undefined}
            >
              {' '}
              <Text color={isSelected ? 'white' : color}>{icon}</Text>
              {' '}
              <Text bold={isSelected}>
                {suggestion.name.padEnd(maxNameWidth)}
              </Text>
              {suggestion.parameters !== undefined && (
                <Text dimColor={!isSelected}>
                  ({suggestion.parameters})
                </Text>
              )}
              {suggestion.returnType && (
                <Text dimColor={!isSelected}>
                  {' -> '}{suggestion.returnType}
                </Text>
              )}
              {' '}
            </Text>
          </Box>
        )
      })}
      {suggestions.length > maxVisible && (
        <Box justifyContent="flex-end">
          <Text dimColor>
            {' '}{selectedIndex + 1}/{suggestions.length}{' '}
          </Text>
        </Box>
      )}
    </Box>
  )
}

/**
 * Signature help display component
 */
export interface SignatureHelpProps {
  signature: string
  activeParameter?: number
  documentation?: string
  visible: boolean
}

export function SignatureHelp({
  signature,
  activeParameter,
  documentation,
  visible,
}: SignatureHelpProps): React.ReactElement | null {
  if (!visible || !signature) {
    return null
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="yellow">{signature}</Text>
      </Box>
      {documentation && (
        <Box marginTop={1}>
          <Text dimColor>{documentation}</Text>
        </Box>
      )}
    </Box>
  )
}

/**
 * Quick info tooltip component
 */
export interface QuickInfoProps {
  info: string
  visible: boolean
}

export function QuickInfo({
  info,
  visible,
}: QuickInfoProps): React.ReactElement | null {
  if (!visible || !info) {
    return null
  }

  // Split into type and documentation
  const lines = info.split('\n\n')
  const typePart = lines[0]
  const docPart = lines.slice(1).join('\n\n')

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="cyan">{typePart}</Text>
      {docPart && (
        <Text dimColor>{docPart}</Text>
      )}
    </Box>
  )
}
