/**
 * Data Format Parsers for Schema Directives
 *
 * Parsers for CSV, TSV, JSON, JSONL, XML, and YAML formats.
 */

import { extractPath } from './id-extraction'

export interface CSVOptions {
  delimiter?: string
}

export interface JSONOptions {
  dataPath?: string
}

export interface XMLOptions {
  itemPath?: string
}

export interface YAMLOptions {
  dataPath?: string
}

/**
 * Parse a line of CSV, handling quoted values
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          current += '"'
          i++ // Skip next char
        } else {
          // End of quoted value
          inQuotes = false
        }
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === delimiter) {
        result.push(current)
        current = ''
      } else {
        current += char
      }
    }
  }

  result.push(current)
  return result
}

export interface CSVParseOptions extends CSVOptions {
  strict?: boolean
}

/**
 * Parse CSV data into an array of objects
 * @param csv The CSV string
 * @param options Parsing options
 * @throws Error if strict mode is enabled and a row has wrong column count
 */
export function parseCSV(csv: string, options: CSVParseOptions = {}): Record<string, string>[] {
  const delimiter = options.delimiter || ','
  const strict = options.strict ?? true

  // Remove BOM if present
  let cleanCsv = csv
  if (cleanCsv.charCodeAt(0) === 0xfeff) {
    cleanCsv = cleanCsv.slice(1)
  }

  // Normalize line endings and split
  const lines = cleanCsv.replace(/\r\n/g, '\n').split('\n').filter(Boolean)

  if (lines.length === 0) {
    return []
  }

  const headers = parseCSVLine(lines[0], delimiter)
  const result: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter)

    // Validate column count in strict mode
    if (strict && values.length !== headers.length) {
      throw new Error(`CSV parse error at row ${i + 1}: expected ${headers.length} columns but got ${values.length}`)
    }

    const row: Record<string, string> = {}

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? ''
    }

    result.push(row)
  }

  return result
}

/**
 * Parse TSV (tab-separated values) data into an array of objects
 * @param tsv The TSV string
 */
export function parseTSV(tsv: string): Record<string, string>[] {
  // TSV is just CSV with tab delimiter
  return parseCSV(tsv, { delimiter: '\t' })
}

/**
 * Extract data from a parsed JSON object using a JSONPath
 */
function extractDataFromPath(data: unknown, dataPath: string): unknown[] {
  const extracted = extractPath(data, dataPath)
  if (Array.isArray(extracted)) {
    return extracted
  }
  if (extracted === undefined || extracted === null) {
    return []
  }
  return [extracted]
}

/**
 * Parse JSON data into an array of objects
 * @param json The JSON string
 * @param options Parsing options
 */
export function parseJSON(json: string, options: JSONOptions = {}): Record<string, unknown>[] {
  const parsed = JSON.parse(json)

  if (options.dataPath) {
    const data = extractDataFromPath(parsed, options.dataPath)
    return data as Record<string, unknown>[]
  }

  if (Array.isArray(parsed)) {
    return parsed
  }

  return [parsed]
}

/**
 * Parse JSONL (newline-delimited JSON) data into an array of objects
 * @param jsonl The JSONL string
 */
export function parseJSONL(jsonl: string): Record<string, unknown>[] {
  const lines = jsonl.split('\n').filter((line) => line.trim().length > 0)
  return lines.map((line) => JSON.parse(line))
}

/**
 * Simple XML parser (minimal implementation)
 * Note: For production, consider using a proper XML parser library
 */
export function parseXML(xml: string, options: XMLOptions = {}): Record<string, unknown>[] {
  const itemPath = options.itemPath || ''

  // Remove XML declaration
  let cleanXml = xml.replace(/<\?xml[^?]*\?>/g, '').trim()

  // Parse the XML into a simple object structure
  function parseElement(xmlStr: string): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    // Extract tag name
    const tagMatch = xmlStr.match(/^<(\w+)([^>]*)>/)
    if (!tagMatch) return result

    const tagName = tagMatch[1]
    const attrsStr = tagMatch[2]

    // Extract attributes
    const attrRegex = /(\w+)="([^"]*)"/g
    let attrMatch
    while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
      result[`@${attrMatch[1]}`] = attrMatch[2]
    }

    // Find content between opening and closing tags
    const contentRegex = new RegExp(`^<${tagName}[^>]*>([\\s\\S]*)</${tagName}>$`)
    const contentMatch = xmlStr.match(contentRegex)

    if (contentMatch) {
      const content = contentMatch[1].trim()

      // Check if content has child elements
      const childRegex = /<(\w+)[^>]*>[\s\S]*?<\/\1>/g
      const children: string[] = []
      let childMatch

      while ((childMatch = childRegex.exec(content)) !== null) {
        children.push(childMatch[0])
      }

      if (children.length > 0) {
        // Group children by tag name
        const childGroups: Record<string, Record<string, unknown>[]> = {}

        for (const child of children) {
          const childTagMatch = child.match(/^<(\w+)/)
          if (childTagMatch) {
            const childTag = childTagMatch[1]
            if (!childGroups[childTag]) {
              childGroups[childTag] = []
            }
            childGroups[childTag].push(parseElement(child))
          }
        }

        Object.assign(result, childGroups)
      } else if (content) {
        // Text content
        return { ...result, '#text': content }
      }
    }

    return result
  }

  // Parse root element
  const rootMatch = cleanXml.match(/^<(\w+)[^>]*>[\s\S]*<\/\1>$/)
  if (!rootMatch) return []

  const parsed = parseElement(cleanXml)

  // Navigate to item path and extract items
  if (itemPath) {
    const pathParts = itemPath.split('.')
    let current: unknown = { [pathParts[0]]: parsed }

    for (const part of pathParts) {
      if (current && typeof current === 'object') {
        const obj = current as Record<string, unknown>
        const value = obj[part]
        if (Array.isArray(value)) {
          // Flatten nested structure for items
          return value.map((item) => {
            if (typeof item === 'object' && item !== null) {
              const flattened: Record<string, unknown> = {}
              for (const [key, val] of Object.entries(item as Record<string, unknown>)) {
                if (key.startsWith('@')) {
                  flattened[key] = val
                } else if (Array.isArray(val) && val.length === 1 && typeof val[0] === 'object') {
                  const inner = val[0] as Record<string, unknown>
                  if ('#text' in inner) {
                    flattened[key] = inner['#text']
                  } else {
                    flattened[key] = val
                  }
                } else {
                  flattened[key] = val
                }
              }
              return flattened
            }
            return item as Record<string, unknown>
          })
        }
        current = value
      }
    }
  }

  return []
}

/**
 * Simple YAML parser (minimal implementation for common cases)
 * Note: For production, consider using a proper YAML parser library
 */
export function parseYAML(yaml: string, options: YAMLOptions = {}): Record<string, unknown>[] {
  const lines = yaml.split('\n')
  let result: unknown

  // Check if it's a list at root level (starts with -)
  if (lines[0].trim().startsWith('-')) {
    result = parseYAMLArray(lines, 0).value
  } else {
    result = parseYAMLObject(lines, 0).value
  }

  if (options.dataPath) {
    const pathParts = options.dataPath.split('.')
    let current: unknown = result

    for (const part of pathParts) {
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        current = (current as Record<string, unknown>)[part]
      }
    }

    if (Array.isArray(current)) {
      return current as Record<string, unknown>[]
    }
  }

  if (Array.isArray(result)) {
    return result as Record<string, unknown>[]
  }

  return [result as Record<string, unknown>]
}

function getIndent(line: string): number {
  const match = line.match(/^(\s*)/)
  return match ? match[1].length : 0
}

function parseYAMLArray(lines: string[], startIndent: number): { value: unknown[]; endIndex: number } {
  const result: unknown[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i++
      continue
    }

    const indent = getIndent(line)
    if (indent < startIndent && i > 0) {
      break
    }

    if (trimmed.startsWith('- ')) {
      // Simple list item
      const value = trimmed.slice(2)
      if (value.includes(':')) {
        // It's an object item starting on same line
        const obj: Record<string, unknown> = {}
        const [key, val] = value.split(':').map((s) => s.trim())
        obj[key] = val || ''

        // Check for more properties at next indent level
        let j = i + 1
        const itemIndent = indent + 2
        while (j < lines.length) {
          const nextLine = lines[j]
          const nextTrimmed = nextLine.trim()
          if (!nextTrimmed) {
            j++
            continue
          }
          const nextIndent = getIndent(nextLine)
          if (nextIndent < itemIndent) break
          if (nextIndent === itemIndent && nextTrimmed.includes(':')) {
            const [k, v] = nextTrimmed.split(':').map((s) => s.trim())
            obj[k] = v || ''
          }
          j++
        }

        result.push(obj)
        i = j
        continue
      } else {
        result.push(value)
      }
    } else if (trimmed.startsWith('-')) {
      // List item with object on next lines
      const obj: Record<string, unknown> = {}
      let j = i + 1
      const itemIndent = indent + 2

      while (j < lines.length) {
        const nextLine = lines[j]
        const nextTrimmed = nextLine.trim()
        if (!nextTrimmed) {
          j++
          continue
        }
        const nextIndent = getIndent(nextLine)
        if (nextIndent < itemIndent) break
        if (nextTrimmed.includes(':')) {
          const colonIndex = nextTrimmed.indexOf(':')
          const key = nextTrimmed.slice(0, colonIndex).trim()
          const value = nextTrimmed.slice(colonIndex + 1).trim()
          obj[key] = value || ''
        }
        j++
      }

      result.push(obj)
      i = j
      continue
    }

    i++
  }

  return { value: result, endIndex: i }
}

function parseYAMLObject(lines: string[], startIndent: number): { value: Record<string, unknown>; endIndex: number } {
  const result: Record<string, unknown> = {}
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i++
      continue
    }

    const indent = getIndent(line)
    if (indent < startIndent && i > 0) {
      break
    }

    if (trimmed.includes(':')) {
      const colonIndex = trimmed.indexOf(':')
      const key = trimmed.slice(0, colonIndex).trim()
      const value = trimmed.slice(colonIndex + 1).trim()

      if (value) {
        result[key] = value
        i++
      } else {
        // Check next line for nested content
        const nextLine = lines[i + 1]
        if (nextLine) {
          const nextIndent = getIndent(nextLine)
          const nextTrimmed = nextLine.trim()

          if (nextIndent > indent) {
            if (nextTrimmed.startsWith('-')) {
              const { value: arr, endIndex } = parseYAMLArray(lines.slice(i + 1), nextIndent)
              result[key] = arr
              i = i + 1 + endIndex
            } else {
              const { value: obj, endIndex } = parseYAMLObject(lines.slice(i + 1), nextIndent)
              result[key] = obj
              i = i + 1 + endIndex
            }
          } else {
            result[key] = ''
            i++
          }
        } else {
          result[key] = ''
          i++
        }
      }
    } else {
      i++
    }
  }

  return { value: result, endIndex: i }
}
