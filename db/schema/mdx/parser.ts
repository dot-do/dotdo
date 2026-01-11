/**
 * MDX Schema Parser
 *
 * Parses DB.mdx schema files into structured MdxSchema definitions.
 * Supports:
 * - YAML frontmatter
 * - Entity definitions as ## H2 headings
 * - Field tables with | Field | Type | Description | format
 * - State machines from ### States bullet lists
 * - Events from ### Events bullet lists
 * - All four cascade operators: -> ~> <- <~
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed field type from MDX table
 */
export interface MdxFieldType {
  /** The type string (e.g., 'string', '->User', '~>ICP[]') */
  type: string
  /** Optional description from the Description column */
  description?: string
}

/**
 * Parsed entity from MDX
 */
export interface MdxEntity {
  /** Fields defined in the entity table */
  fields: Record<string, MdxFieldType>
  /** State machine states (e.g., ['draft', 'launched', 'scaling']) */
  states?: string[]
  /** Events the entity responds to (e.g., ['Customer.signup']) */
  events?: string[]
  /** Description paragraph after the entity heading */
  description?: string
}

/**
 * Complete parsed MDX schema
 */
export interface MdxSchema {
  /** Entities defined in the schema, keyed by name */
  entities: Record<string, MdxEntity>
  /** Source file path */
  source: string
  /** Parsed frontmatter metadata */
  frontmatter?: Record<string, unknown>
}

// ============================================================================
// Regex Patterns
// ============================================================================

/** Match YAML frontmatter */
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/

/** Match H2 headings (entity names) */
const H2_HEADING_REGEX = /^##\s+(.+)$/

/** Match H3 headings (States, Events sections) */
const H3_HEADING_REGEX = /^###\s+(.+)$/

/** Match table row */
const TABLE_ROW_REGEX = /^\|(.+)\|$/

/** Match table separator row (---|---|---) */
const TABLE_SEPARATOR_REGEX = /^\|[\s-:|]+\|$/

/** Match bullet list item */
const BULLET_ITEM_REGEX = /^[-*]\s+(.+)$/

/** Match code blocks in type column */
const CODE_BLOCK_REGEX = /`([^`]+)`/

/** Match state arrow notation (draft -> launched -> scaling) */
const STATE_ARROW_REGEX = /\s*(?:->|→)\s*/

// ============================================================================
// Frontmatter Parsing
// ============================================================================

/**
 * Parse YAML frontmatter from MDX content
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  const match = content.match(FRONTMATTER_REGEX)
  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const yamlContent = match[1]
  const body = content.slice(match[0].length).trim()

  // Simple YAML parsing (key: value pairs)
  const frontmatter: Record<string, unknown> = {}
  const lines = yamlContent.split('\n')

  for (const line of lines) {
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim()
      let value: unknown = line.slice(colonIndex + 1).trim()

      // Handle quoted strings
      if (
        (value as string).startsWith('"') &&
        (value as string).endsWith('"')
      ) {
        value = (value as string).slice(1, -1)
      } else if (
        (value as string).startsWith("'") &&
        (value as string).endsWith("'")
      ) {
        value = (value as string).slice(1, -1)
      } else if (value === 'true') {
        value = true
      } else if (value === 'false') {
        value = false
      } else if (!isNaN(Number(value)) && value !== '') {
        value = Number(value)
      }

      frontmatter[key] = value
    }
  }

  return { frontmatter, body }
}

// ============================================================================
// Table Parsing
// ============================================================================

/**
 * Parse a markdown table into rows and columns
 */
function parseTable(lines: string[]): {
  headers: string[]
  rows: string[][]
} {
  const headers: string[] = []
  const rows: string[][] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const match = line.match(TABLE_ROW_REGEX)
    if (!match) continue

    // Skip separator rows
    if (TABLE_SEPARATOR_REGEX.test(line)) continue

    const cells = match[1].split('|').map((cell) => cell.trim())

    if (headers.length === 0) {
      headers.push(...cells)
    } else {
      rows.push(cells)
    }
  }

  return { headers, rows }
}

/**
 * Extract type from table cell, handling code blocks
 */
function extractType(cell: string): string {
  const codeMatch = cell.match(CODE_BLOCK_REGEX)
  if (codeMatch) {
    return codeMatch[1]
  }
  return cell.trim()
}

/**
 * Parse fields from a table
 */
function parseFieldsFromTable(
  headers: string[],
  rows: string[][]
): Record<string, MdxFieldType> {
  const fields: Record<string, MdxFieldType> = {}

  const fieldIndex = headers.findIndex(
    (h) => h.toLowerCase() === 'field' || h.toLowerCase() === 'name'
  )
  const typeIndex = headers.findIndex((h) => h.toLowerCase() === 'type')
  const descIndex = headers.findIndex(
    (h) =>
      h.toLowerCase() === 'description' ||
      h.toLowerCase() === 'desc' ||
      h.toLowerCase() === 'notes'
  )

  if (fieldIndex === -1 || typeIndex === -1) {
    return fields
  }

  for (const row of rows) {
    const fieldName = row[fieldIndex]?.trim()
    const typeCell = row[typeIndex]?.trim()

    if (!fieldName || !typeCell) continue

    const field: MdxFieldType = {
      type: extractType(typeCell),
    }

    if (descIndex !== -1 && row[descIndex]?.trim()) {
      field.description = row[descIndex].trim()
    }

    fields[fieldName] = field
  }

  return fields
}

// ============================================================================
// States and Events Parsing
// ============================================================================

/**
 * Parse states from bullet list
 * Supports both arrow notation (draft -> launched -> scaling)
 * and individual bullet items
 */
function parseStates(lines: string[]): string[] {
  const states: string[] = []

  for (const line of lines) {
    const bulletMatch = line.match(BULLET_ITEM_REGEX)
    if (!bulletMatch) continue

    const content = bulletMatch[1].trim()

    // Check for arrow notation
    if (STATE_ARROW_REGEX.test(content)) {
      const stateList = content.split(STATE_ARROW_REGEX).map((s) => s.trim())
      states.push(...stateList.filter((s) => s.length > 0))
    } else {
      states.push(content)
    }
  }

  return states
}

/**
 * Parse events from bullet list
 * Extracts just the event name if description is present (Event.name - description)
 */
function parseEvents(lines: string[]): string[] {
  const events: string[] = []

  for (const line of lines) {
    const bulletMatch = line.match(BULLET_ITEM_REGEX)
    if (!bulletMatch) continue

    let content = bulletMatch[1].trim()

    // Remove description after " - "
    const dashIndex = content.indexOf(' - ')
    if (dashIndex > 0) {
      content = content.slice(0, dashIndex).trim()
    }

    if (content) {
      events.push(content)
    }
  }

  return events
}

// ============================================================================
// Entity Parsing
// ============================================================================

interface EntitySection {
  name: string
  lines: string[]
}

/**
 * Split content into entity sections based on H2 headings
 */
function splitIntoEntitySections(body: string): EntitySection[] {
  const lines = body.split('\n')
  const sections: EntitySection[] = []
  let currentSection: EntitySection | null = null

  for (const line of lines) {
    const h2Match = line.match(H2_HEADING_REGEX)
    if (h2Match) {
      if (currentSection) {
        sections.push(currentSection)
      }
      currentSection = {
        name: h2Match[1].trim(),
        lines: [],
      }
    } else if (currentSection) {
      currentSection.lines.push(line)
    }
  }

  if (currentSection) {
    sections.push(currentSection)
  }

  return sections
}

/**
 * Parse a single entity section
 */
function parseEntitySection(section: EntitySection): MdxEntity {
  const entity: MdxEntity = {
    fields: {},
  }

  const lines = section.lines
  let i = 0

  // Look for description (paragraph before table or subsections)
  const descriptionLines: string[] = []
  while (i < lines.length) {
    const line = lines[i].trim()

    // Stop at table, H3 heading, or empty line after description
    if (
      line.startsWith('|') ||
      H3_HEADING_REGEX.test(line) ||
      (descriptionLines.length > 0 && line === '')
    ) {
      break
    }

    if (line && !line.startsWith('#')) {
      descriptionLines.push(line)
    }
    i++
  }

  if (descriptionLines.length > 0) {
    entity.description = descriptionLines.join(' ').trim()
  }

  // Parse the rest of the section
  let currentSubsection: string | null = null
  let subsectionLines: string[] = []

  for (; i < lines.length; i++) {
    const line = lines[i]
    const h3Match = line.match(H3_HEADING_REGEX)

    if (h3Match) {
      // Process previous subsection
      if (currentSubsection === 'States') {
        entity.states = parseStates(subsectionLines)
      } else if (currentSubsection === 'Events') {
        entity.events = parseEvents(subsectionLines)
      }

      currentSubsection = h3Match[1].trim()
      subsectionLines = []
    } else if (line.trim().startsWith('|') && !currentSubsection) {
      // Table for fields (not in a subsection)
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      i-- // Back up one since the loop will increment

      const { headers, rows } = parseTable(tableLines)
      entity.fields = parseFieldsFromTable(headers, rows)
    } else if (currentSubsection) {
      subsectionLines.push(line)
    }
  }

  // Process final subsection
  if (currentSubsection === 'States') {
    entity.states = parseStates(subsectionLines)
  } else if (currentSubsection === 'Events') {
    entity.events = parseEvents(subsectionLines)
  }

  return entity
}

// ============================================================================
// Main Parser
// ============================================================================

/**
 * Parse MDX content into a structured MdxSchema
 *
 * @param content - The MDX content to parse
 * @param source - Optional source file path
 * @returns Parsed MdxSchema
 *
 * @example
 * ```typescript
 * const schema = parseMdxSchema(`
 * ---
 * title: My Schema
 * ---
 *
 * ## User
 *
 * | Field | Type |
 * |-------|------|
 * | name | string |
 * | posts | \`[->Post]\` |
 *
 * ### States
 * - active -> suspended -> deleted
 * `)
 *
 * console.log(schema.entities.User.fields.name.type) // 'string'
 * console.log(schema.entities.User.states) // ['active', 'suspended', 'deleted']
 * ```
 */
export function parseMdxSchema(content: string, source: string = ''): MdxSchema {
  const schema: MdxSchema = {
    entities: {},
    source,
  }

  if (!content.trim()) {
    schema.frontmatter = {}
    return schema
  }

  // Parse frontmatter
  const { frontmatter, body } = parseFrontmatter(content)
  schema.frontmatter = frontmatter

  // Split into entity sections
  const sections = splitIntoEntitySections(body)

  // Parse each entity
  for (const section of sections) {
    const entity = parseEntitySection(section)
    schema.entities[section.name] = entity
  }

  return schema
}
