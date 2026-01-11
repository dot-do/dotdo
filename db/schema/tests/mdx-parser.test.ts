import { describe, it, expect } from 'vitest'
import { parseMdxSchema, type MdxSchema, type MdxEntity } from '../mdx/parser'

/**
 * MDX Schema Parser Tests
 *
 * TDD tests for parsing DB.mdx schema files into structured schema definitions.
 *
 * Supported MDX format:
 * - Frontmatter with metadata (title, version, etc.)
 * - Entity definitions as ## H2 headings
 * - Field tables with | Field | Type | Description | format
 * - State machines from ### States bullet lists (draft -> launched -> scaling)
 * - Events from ### Events bullet lists
 */

// ============================================================================
// Basic Entity Parsing
// ============================================================================

describe('parseMdxSchema', () => {
  describe('Basic Entity Parsing', () => {
    it('parses a simple entity with fields from markdown table', () => {
      const mdx = `
## User

| Field | Type |
|-------|------|
| name | string |
| email | string |
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.User).toBeDefined()
      expect(result.entities.User.fields.name).toEqual({
        type: 'string',
        description: undefined,
      })
      expect(result.entities.User.fields.email).toEqual({
        type: 'string',
        description: undefined,
      })
    })

    it('parses entity description from paragraph after heading', () => {
      const mdx = `
## Startup

The core business entity for tracking startups.

| Field | Type |
|-------|------|
| name | string |
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.Startup.description).toBe(
        'The core business entity for tracking startups.'
      )
    })

    it('parses multiple entities', () => {
      const mdx = `
## User

| Field | Type |
|-------|------|
| name | string |

## Post

| Field | Type |
|-------|------|
| title | string |
| content | string |
`
      const result = parseMdxSchema(mdx)

      expect(Object.keys(result.entities)).toHaveLength(2)
      expect(result.entities.User).toBeDefined()
      expect(result.entities.Post).toBeDefined()
    })
  })

  // ============================================================================
  // Field Type Parsing with Operators
  // ============================================================================

  describe('Field Type Parsing with Operators', () => {
    it('parses forward insert operator ->', () => {
      const mdx = `
## Startup

| Field | Type |
|-------|------|
| model | \`->LeanCanvas\` |
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.Startup.fields.model).toEqual({
        type: '->LeanCanvas',
        description: undefined,
      })
    })

    it('parses forward search operator ~>', () => {
      const mdx = `
## Startup

| Field | Type |
|-------|------|
| customer | \`~>ICP\` |
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.Startup.fields.customer).toEqual({
        type: '~>ICP',
        description: undefined,
      })
    })

    it('parses backward insert operator <-', () => {
      const mdx = `
## Startup

| Field | Type |
|-------|------|
| idea | \`<-Idea\` |
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.Startup.fields.idea).toEqual({
        type: '<-Idea',
        description: undefined,
      })
    })

    it('parses backward search operator <~', () => {
      const mdx = `
## Startup

| Field | Type |
|-------|------|
| related | \`<~Topic\` |
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.Startup.fields.related).toEqual({
        type: '<~Topic',
        description: undefined,
      })
    })

    it('parses array types with operators', () => {
      const mdx = `
## Startup

| Field | Type |
|-------|------|
| founders | \`[->Founder]\` |
| experiments | \`->Experiment[]\` |
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.Startup.fields.founders).toEqual({
        type: '[->Founder]',
        description: undefined,
      })
      expect(result.entities.Startup.fields.experiments).toEqual({
        type: '->Experiment[]',
        description: undefined,
      })
    })

    it('parses fields with description column', () => {
      const mdx = `
## Startup

| Field | Type | Description |
|-------|------|-------------|
| idea | \`<-Idea\` | Backward link to Idea |
| customer | \`~>ICP\` | Fuzzy search for ICP |
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.Startup.fields.idea).toEqual({
        type: '<-Idea',
        description: 'Backward link to Idea',
      })
      expect(result.entities.Startup.fields.customer).toEqual({
        type: '~>ICP',
        description: 'Fuzzy search for ICP',
      })
    })
  })

  // ============================================================================
  // Frontmatter Parsing
  // ============================================================================

  describe('Frontmatter Parsing', () => {
    it('parses YAML frontmatter', () => {
      const mdx = `---
title: Database Schema
version: 1.0.0
---

## User

| Field | Type |
|-------|------|
| name | string |
`
      const result = parseMdxSchema(mdx)

      expect(result.frontmatter).toEqual({
        title: 'Database Schema',
        version: '1.0.0',
      })
    })

    it('handles missing frontmatter gracefully', () => {
      const mdx = `
## User

| Field | Type |
|-------|------|
| name | string |
`
      const result = parseMdxSchema(mdx)

      expect(result.frontmatter).toEqual({})
    })
  })

  // ============================================================================
  // State Machine Parsing
  // ============================================================================

  describe('State Machine Parsing', () => {
    it('parses states from ### States section with arrow notation', () => {
      const mdx = `
## Startup

| Field | Type |
|-------|------|
| name | string |

### States
- draft -> launched -> scaling -> exit
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.Startup.states).toEqual([
        'draft',
        'launched',
        'scaling',
        'exit',
      ])
    })

    it('parses states from bullet list items', () => {
      const mdx = `
## Startup

| Field | Type |
|-------|------|
| name | string |

### States
- draft
- launched
- scaling
- exit
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.Startup.states).toEqual([
        'draft',
        'launched',
        'scaling',
        'exit',
      ])
    })

    it('parses unicode arrow notation for states', () => {
      const mdx = `
## Order

| Field | Type |
|-------|------|
| id | string |

### States
- pending -> processing -> shipped -> delivered
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.Order.states).toEqual([
        'pending',
        'processing',
        'shipped',
        'delivered',
      ])
    })
  })

  // ============================================================================
  // Events Parsing
  // ============================================================================

  describe('Events Parsing', () => {
    it('parses events from ### Events section', () => {
      const mdx = `
## Startup

| Field | Type |
|-------|------|
| name | string |

### Events
- Customer.signup
- Payment.received
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.Startup.events).toEqual([
        'Customer.signup',
        'Payment.received',
      ])
    })

    it('parses events with descriptions', () => {
      const mdx = `
## Startup

| Field | Type |
|-------|------|
| name | string |

### Events
- Customer.signup - When a new customer signs up
- Payment.failed - When payment processing fails
`
      const result = parseMdxSchema(mdx)

      // Should extract just the event name, not the description
      expect(result.entities.Startup.events).toContain('Customer.signup')
      expect(result.entities.Startup.events).toContain('Payment.failed')
    })
  })

  // ============================================================================
  // Complex Schema Parsing
  // ============================================================================

  describe('Complex Schema Parsing', () => {
    it('parses complete schema with all features', () => {
      const mdx = `---
title: Database Schema
---

# Entities

## Startup

The core business entity.

| Field | Type | Description |
|-------|------|-------------|
| idea | \`<-Idea\` | Backward link to Idea |
| customer | \`~>ICP\` | Fuzzy search for ICP |
| founders | \`[->Founder]\` | Array of generated Founders |
| model | \`->LeanCanvas\` | Forward link to canvas |

### States
- draft -> launched -> scaling -> exit

### Events
- Customer.signup
- Payment.received

## Idea

| Field | Type |
|-------|------|
| hypothesis | string |
| validation | \`->Experiment[]\` |
`
      const result = parseMdxSchema(mdx)

      // Check frontmatter
      expect(result.frontmatter?.title).toBe('Database Schema')

      // Check Startup entity
      expect(result.entities.Startup).toBeDefined()
      expect(result.entities.Startup.description).toBe('The core business entity.')
      expect(result.entities.Startup.fields.idea.type).toBe('<-Idea')
      expect(result.entities.Startup.fields.customer.type).toBe('~>ICP')
      expect(result.entities.Startup.fields.founders.type).toBe('[->Founder]')
      expect(result.entities.Startup.fields.model.type).toBe('->LeanCanvas')
      expect(result.entities.Startup.states).toEqual([
        'draft',
        'launched',
        'scaling',
        'exit',
      ])
      expect(result.entities.Startup.events).toContain('Customer.signup')
      expect(result.entities.Startup.events).toContain('Payment.received')

      // Check Idea entity
      expect(result.entities.Idea).toBeDefined()
      expect(result.entities.Idea.fields.hypothesis.type).toBe('string')
      expect(result.entities.Idea.fields.validation.type).toBe('->Experiment[]')
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('handles empty input', () => {
      const result = parseMdxSchema('')

      expect(result.entities).toEqual({})
      expect(result.frontmatter).toEqual({})
    })

    it('handles entities without tables', () => {
      const mdx = `
## EmptyEntity

Just a description, no fields.
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.EmptyEntity).toBeDefined()
      expect(result.entities.EmptyEntity.fields).toEqual({})
      expect(result.entities.EmptyEntity.description).toBe(
        'Just a description, no fields.'
      )
    })

    it('handles code blocks inside type column', () => {
      const mdx = `
## User

| Field | Type |
|-------|------|
| name | \`string\` |
| age | \`number\` |
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.User.fields.name.type).toBe('string')
      expect(result.entities.User.fields.age.type).toBe('number')
    })

    it('ignores H1 headings (treats only H2 as entities)', () => {
      const mdx = `
# Schema Title

Not an entity.

## RealEntity

| Field | Type |
|-------|------|
| name | string |
`
      const result = parseMdxSchema(mdx)

      expect(result.entities['Schema Title']).toBeUndefined()
      expect(result.entities.RealEntity).toBeDefined()
    })

    it('handles table with extra whitespace', () => {
      const mdx = `
## User

|  Field  |  Type  |  Description  |
|---------|--------|---------------|
|  name   |  string  |  User's name  |
`
      const result = parseMdxSchema(mdx)

      expect(result.entities.User.fields.name).toEqual({
        type: 'string',
        description: "User's name",
      })
    })
  })

  // ============================================================================
  // Source Tracking
  // ============================================================================

  describe('Source Tracking', () => {
    it('tracks source file path when provided', () => {
      const mdx = `
## User

| Field | Type |
|-------|------|
| name | string |
`
      const result = parseMdxSchema(mdx, '/path/to/DB.mdx')

      expect(result.source).toBe('/path/to/DB.mdx')
    })

    it('defaults to empty source when not provided', () => {
      const mdx = `
## User

| Field | Type |
|-------|------|
| name | string |
`
      const result = parseMdxSchema(mdx)

      expect(result.source).toBe('')
    })
  })
})

// ============================================================================
// Type Interface Tests
// ============================================================================

describe('MdxSchema Type', () => {
  it('has correct structure', () => {
    const schema: MdxSchema = {
      entities: {
        User: {
          fields: {
            name: { type: 'string' },
          },
        },
      },
      source: '/path/to/file.mdx',
    }

    expect(schema.entities.User.fields.name.type).toBe('string')
  })

  it('supports optional fields in entity', () => {
    const entity: MdxEntity = {
      fields: {},
      states: ['draft', 'published'],
      events: ['User.created'],
      description: 'A user entity',
    }

    expect(entity.states).toHaveLength(2)
    expect(entity.events).toHaveLength(1)
    expect(entity.description).toBe('A user entity')
  })
})
