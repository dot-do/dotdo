/**
 * ID Extraction for Schema Directives
 *
 * Extracts IDs from data using JSONPath patterns and optional transforms.
 */

import { applyTransform } from './transforms'

/**
 * Extract a value from data using a simple JSONPath-like pattern
 * Supports: $.field, $.nested.field, $.array[0]
 */
export function extractPath(data: unknown, path: string): unknown {
  if (!path.startsWith('$.')) {
    return undefined
  }

  const parts = path.slice(2).split(/\.|\[(\d+)\]/).filter(Boolean)

  let current: unknown = data
  for (const part of parts) {
    if (current === null || current === undefined) {
      return current
    }

    const index = parseInt(part, 10)
    if (!isNaN(index) && Array.isArray(current)) {
      current = current[index]
    } else if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }

  return current
}

/**
 * Convert a value to string for ID purposes
 */
function valueToString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return String(value)
}

/**
 * Parse a transform expression like "PascalCase($.name)"
 * Returns [transformName, path] or null if not a transform
 */
function parseTransformExpression(pattern: string): [string, string] | null {
  const match = pattern.match(/^(\w+)\((.+)\)$/)
  if (match) {
    return [match[1], match[2]]
  }
  return null
}

/**
 * Check if a pattern segment is a JSONPath (starts with $.)
 */
function isJsonPath(segment: string): boolean {
  return segment.startsWith('$.')
}

/**
 * Check if a pattern segment is a transform expression
 */
function isTransformExpression(segment: string): boolean {
  return /^\w+\(\$.+\)$/.test(segment)
}

/**
 * Extract a single segment value (either path or transform)
 */
function extractSegment(data: unknown, segment: string): string | undefined | null {
  // Check for transform expression first
  const transformParts = parseTransformExpression(segment)
  if (transformParts) {
    const [transformName, path] = transformParts
    const value = extractPath(data, path)
    const strValue = valueToString(value)
    if (strValue === undefined || strValue === null) {
      return strValue
    }
    return applyTransform(transformName, strValue)
  }

  // Check for simple JSONPath
  if (isJsonPath(segment)) {
    return valueToString(extractPath(data, segment))
  }

  // Not a path or transform, return as literal
  return segment
}

/**
 * Split a composite pattern into segments
 * Handles patterns like: "$.prefix-$.suffix", "lowercase($.type)-slugify($.name)"
 */
function splitCompositePattern(pattern: string): { segment: string; separator: string }[] {
  const result: { segment: string; separator: string }[] = []
  let current = ''
  let parenDepth = 0

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]

    if (char === '(') {
      parenDepth++
    } else if (char === ')') {
      parenDepth--
    } else if (parenDepth === 0 && (char === '-' || char === '_' || char === ':' || char === '/')) {
      // Check if this is a separator or part of a path
      // It's a separator if current ends with a path or transform, and next segment starts with $ or a transform
      const remaining = pattern.slice(i + 1)
      // Check if remaining starts with a JSONPath ($.) or a transform function (word followed by parenthesis)
      const isNextSegmentPath = remaining.startsWith('$.') || /^[a-zA-Z]+\(/.test(remaining)
      // Check if current looks like a complete path or transform
      const isCurrentComplete = current.endsWith(')') || (isJsonPath(current) && !current.includes('('))

      if (current && isNextSegmentPath && isCurrentComplete) {
        result.push({ segment: current, separator: char })
        current = ''
        continue
      }
    }

    current += char
  }

  if (current) {
    result.push({ segment: current, separator: '' })
  }

  return result
}

/**
 * Extract an ID from data using a pattern
 *
 * Patterns can be:
 * - Simple JSONPath: "$.slug"
 * - Nested JSONPath: "$.metadata.id"
 * - Array index: "$.ids[0]"
 * - Transform: "PascalCase($.name)"
 * - Composite: "$.prefix-$.suffix"
 * - Composite with transforms: "lowercase($.type)-slugify($.name)"
 *
 * @param data The data object to extract from
 * @param pattern The extraction pattern
 * @returns The extracted ID as a string, or undefined/null for missing/null values
 * @throws Error if an invalid transform function is used
 */
export function extractId(data: unknown, pattern: string): string | undefined | null {
  // Check if it's a simple pattern (single path or transform)
  const segments = splitCompositePattern(pattern)

  if (segments.length === 1) {
    // Simple pattern
    return extractSegment(data, pattern)
  }

  // Composite pattern - join segments with their separators
  const parts: string[] = []
  for (const { segment, separator } of segments) {
    const value = extractSegment(data, segment)
    if (value === undefined || value === null) {
      return value
    }
    parts.push(value)
    if (separator) {
      parts.push(separator)
    }
  }

  return parts.join('')
}
