/**
 * Type Extractor Module
 *
 * Extracts TypeScript type definitions from source files for documentation.
 * Uses TypeScript compiler API to parse and extract type information.
 */

import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { getSourceFileForType } from './type-docs'

/**
 * Extracted property information
 */
export interface ExtractedProperty {
  name: string
  type: string
  description?: string
  required: boolean
  defaultValue?: string
  internal?: boolean
  remarks?: string
  deprecated?: boolean
  examples?: string[]
}

/**
 * Type parameter information
 */
export interface TypeParameter {
  name: string
  constraint?: string
  default?: string
  description?: string
}

/**
 * Extracted type information
 */
export interface ExtractedType {
  name: string
  kind: 'interface' | 'type' | 'class' | 'enum' | 'function'
  description?: string
  properties?: ExtractedProperty[]
  typeParameters?: TypeParameter[]
  extends?: string[]
  sourceFile: string
  lineNumber: number
}

// Cache for extracted types
const typeCache = new Map<string, ExtractedType>()

/**
 * Extract type definition from source files
 */
export async function extractType(typeName: string): Promise<ExtractedType> {
  // Check cache first
  if (typeCache.has(typeName)) {
    return typeCache.get(typeName)!
  }

  const sourceFile = getSourceFileForType(typeName)
  if (!sourceFile) {
    throw new Error(`Type '${typeName}' not found in source files`)
  }

  if (!existsSync(sourceFile)) {
    throw new Error(`Source file '${sourceFile}' does not exist`)
  }

  const content = await readFile(sourceFile, 'utf-8')
  const extracted = parseTypeFromContent(typeName, content, sourceFile)

  if (!extracted) {
    throw new Error(`Type '${typeName}' not found in ${sourceFile}`)
  }

  typeCache.set(typeName, extracted)
  return extracted
}

/**
 * Parse type information from file content
 */
function parseTypeFromContent(
  typeName: string,
  content: string,
  sourceFile: string
): ExtractedType | null {
  const lines = content.split('\n')

  // Find the type/interface definition
  const patterns = [
    new RegExp(`^export\\s+interface\\s+${typeName}\\b`, 'm'),
    new RegExp(`^export\\s+type\\s+${typeName}\\b`, 'm'),
    new RegExp(`^export\\s+class\\s+${typeName}\\b`, 'm'),
    new RegExp(`^interface\\s+${typeName}\\b`, 'm'),
    new RegExp(`^type\\s+${typeName}\\b`, 'm'),
  ]

  let lineNumber = -1
  let kind: ExtractedType['kind'] = 'interface'
  let matchLine = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        lineNumber = i + 1
        matchLine = line
        if (line.includes('interface')) kind = 'interface'
        else if (line.includes('type')) kind = 'type'
        else if (line.includes('class')) kind = 'class'
        break
      }
    }
    if (lineNumber > 0) break
  }

  if (lineNumber < 0) {
    return null
  }

  // Extract description from preceding JSDoc comment
  let description: string | undefined
  let jsDocStart = lineNumber - 2
  while (jsDocStart >= 0 && (lines[jsDocStart].trim() === '' || lines[jsDocStart].includes('*'))) {
    jsDocStart--
  }
  jsDocStart++

  const jsDocLines = lines.slice(jsDocStart, lineNumber - 1)
  if (jsDocLines.length > 0 && jsDocLines[0].includes('/**')) {
    description = jsDocLines
      .map((l) => l.replace(/^\s*\*\s?/, '').replace(/^\/\*\*\s*/, '').replace(/\*\/\s*$/, ''))
      .filter((l) => l && !l.startsWith('@'))
      .join(' ')
      .trim()
  }

  // Extract extends clause
  const extendsMatch = matchLine.match(/extends\s+([^{]+)/)
  const extendsTypes = extendsMatch
    ? extendsMatch[1].split(',').map((t) => t.trim())
    : undefined

  // Extract type parameters
  const typeParamMatch = matchLine.match(/<([^>]+)>/)
  let typeParameters: TypeParameter[] | undefined
  if (typeParamMatch) {
    typeParameters = parseTypeParameters(typeParamMatch[1])
  }

  // Extract properties
  const properties = extractProperties(lines, lineNumber - 1)

  return {
    name: typeName,
    kind,
    description,
    properties,
    typeParameters,
    extends: extendsTypes,
    sourceFile,
    lineNumber,
  }
}

/**
 * Parse type parameters from string like "T extends Thing = Thing, U = unknown"
 */
function parseTypeParameters(paramString: string): TypeParameter[] {
  const params: TypeParameter[] = []
  const parts = paramString.split(',').map((p) => p.trim())

  for (const part of parts) {
    const param: TypeParameter = { name: '' }

    // Parse: Name extends Constraint = Default
    const match = part.match(/^(\w+)(?:\s+extends\s+([^=]+))?(?:\s*=\s*(.+))?$/)
    if (match) {
      param.name = match[1]
      if (match[2]) param.constraint = match[2].trim()
      if (match[3]) param.default = match[3].trim()
    } else {
      param.name = part
    }

    params.push(param)
  }

  return params
}

/**
 * Extract properties from interface/type body
 */
function extractProperties(lines: string[], startLine: number): ExtractedProperty[] {
  const properties: ExtractedProperty[] = []
  let braceCount = 0
  let inBody = false
  let currentJsDoc: string[] = []

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]

    // Track braces
    braceCount += (line.match(/{/g) || []).length
    braceCount -= (line.match(/}/g) || []).length

    if (braceCount > 0) inBody = true
    if (braceCount === 0 && inBody) break

    // Collect JSDoc comments
    if (line.includes('/**')) {
      currentJsDoc = [line]
    } else if (currentJsDoc.length > 0) {
      currentJsDoc.push(line)
      if (line.includes('*/')) {
        // End of JSDoc
      }
    }

    // Parse property line
    if (inBody && braceCount > 0) {
      const propMatch = line.match(/^\s*(?:readonly\s+)?(\$?\w+|\[[\w\s:]+\])(\?)?:\s*(.+?);?\s*$/)
      if (propMatch) {
        const [, name, optional, typeStr] = propMatch
        const type = typeStr.replace(/;$/, '').trim()

        // Parse JSDoc for this property
        const jsDoc = currentJsDoc.join('\n')
        const description = extractJsDocDescription(jsDoc)
        const internal = jsDoc.includes('@internal')
        const deprecated = jsDoc.includes('@deprecated')
        const remarks = extractJsDocTag(jsDoc, 'remarks')
        const examples = extractJsDocExamples(jsDoc)

        properties.push({
          name,
          type,
          description,
          required: !optional,
          internal,
          deprecated,
          remarks,
          examples: examples.length > 0 ? examples : undefined,
        })

        currentJsDoc = []
      }
    }
  }

  return properties
}

/**
 * Extract description from JSDoc comment
 */
function extractJsDocDescription(jsDoc: string): string | undefined {
  if (!jsDoc) return undefined

  const lines = jsDoc
    .replace(/\/\*\*|\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter((l) => l && !l.startsWith('@'))

  return lines.length > 0 ? lines.join(' ') : undefined
}

/**
 * Extract a specific JSDoc tag value
 */
function extractJsDocTag(jsDoc: string, tag: string): string | undefined {
  const match = jsDoc.match(new RegExp(`@${tag}\\s+(.+?)(?=@|\\*\\/|$)`, 's'))
  return match ? match[1].trim() : undefined
}

/**
 * Extract @example tags from JSDoc
 */
function extractJsDocExamples(jsDoc: string): string[] {
  const examples: string[] = []
  const regex = /@example\s+([\s\S]*?)(?=@|\*\/|$)/g
  let match
  while ((match = regex.exec(jsDoc)) !== null) {
    examples.push(match[1].trim())
  }
  return examples
}

/**
 * Clear the type cache
 */
export function clearTypeCache(): void {
  typeCache.clear()
}
