// ============================================================================
// NOUN - Type registry entry
// ============================================================================

export interface NounData {
  noun: string // 'Startup'
  plural?: string // 'Startups'
  description?: string // 'A company in the portfolio'
  schema?: NounSchema // Field definitions
  doClass?: string // CF binding if this noun is a DO subclass
}

export interface NounSchema {
  // Field definitions using ai-database syntax
  // e.g., { name: 'string', stage: 'string', icp: '->ICP' }
  [field: string]: string | FieldDefinition
}

export interface FieldDefinition {
  type: string // 'string', 'number', 'boolean', 'date', etc.
  description?: string
  required?: boolean
  default?: unknown

  // Relationship operators (ai-database)
  operator?: '->' | '~>' | '<-' | '<~'
  targetType?: string // For relationships
  prompt?: string // AI generation prompt
  threshold?: number // Fuzzy match threshold (0-1)
}

// ============================================================================
// NOUN INSTANCE (from registry)
// ============================================================================

export interface Noun extends NounData {
  // Things of this type (backref)
  things: () => import('./Things').Things

  // Get schema as parsed fields
  fields: () => ParsedField[]
}

export interface ParsedField {
  name: string
  type: string
  isArray: boolean
  isOptional: boolean
  isRelation: boolean
  relatedType?: string
  operator?: '->' | '~>' | '<-' | '<~'
  direction?: 'forward' | 'backward'
  matchMode?: 'exact' | 'fuzzy'
  prompt?: string
  threshold?: number
}

// ============================================================================
// HELPER: Parse field definition
// ============================================================================

export function parseField(name: string, definition: string | FieldDefinition): ParsedField {
  if (typeof definition === 'object') {
    return {
      name,
      type: definition.type,
      isArray: definition.type.endsWith('[]'),
      isOptional: !definition.required,
      isRelation: !!definition.operator,
      relatedType: definition.targetType,
      operator: definition.operator,
      direction: definition.operator?.startsWith('<') ? 'backward' : 'forward',
      matchMode: definition.operator?.includes('~') ? 'fuzzy' : 'exact',
      prompt: definition.prompt,
      threshold: definition.threshold,
    }
  }

  // Parse string definition: 'What is the idea? ->Idea'
  const operators = ['~>', '<~', '->', '<-'] as const

  for (const op of operators) {
    const opIndex = definition.indexOf(op)
    if (opIndex !== -1) {
      const prompt = definition.slice(0, opIndex).trim() || undefined
      let targetType = definition.slice(opIndex + op.length).trim()

      // Handle array syntax: ['->Tag']
      const isArray = targetType.startsWith('[') && targetType.endsWith(']')
      if (isArray) {
        targetType = targetType.slice(1, -1)
      }

      // Handle optional: '->Category?'
      const isOptional = targetType.endsWith('?')
      if (isOptional) {
        targetType = targetType.slice(0, -1)
      }

      return {
        name,
        type: targetType,
        isArray,
        isOptional,
        isRelation: true,
        relatedType: targetType,
        operator: op,
        direction: op.startsWith('<') ? 'backward' : 'forward',
        matchMode: op.includes('~') ? 'fuzzy' : 'exact',
        prompt,
      }
    }
  }

  // Simple field type
  const isArray = definition.endsWith('[]')
  const isOptional = definition.endsWith('?')
  const type = definition.replace(/[\[\]?]/g, '')

  return {
    name,
    type,
    isArray,
    isOptional,
    isRelation: false,
  }
}
