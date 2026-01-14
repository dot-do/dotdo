/**
 * [RED] Tool Thing CRUD - Graph Storage Tests
 *
 * Failing tests for storing Tools as Things in the graph.
 * Tests CRUD operations, category queries, and type validation.
 *
 * Key Features Under Test:
 * - Tool creation with category hierarchy
 * - Schema validation for tool definitions
 * - Tool discovery by category, audience, security level
 * - Tool updates with version tracking
 * - Soft delete with history preservation
 * - Prevention of deletion with active invocations
 *
 * NO MOCKS - Uses real SQLite database.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Equals, Expect } from './type-utils'

// Production module imports (these don't exist yet - that's the RED phase)
import {
  createToolGraph,
  type ToolGraph,
  type ToolThing,
  type ToolCategory,
  type ToolAudience,
  type SecurityLevel,
  type ToolParameter,
  type ToolInvocation,
  type ToolVersion,
  type ToolQueryOptions,
  type ToolCreateInput,
  type ToolUpdateInput,
} from '../src/tool-things'

// ============================================================================
// TYPE DEFINITIONS - Expected types for Tool Things
// ============================================================================

/**
 * Tool category hierarchy
 * Top-level categories with optional subcategories
 */
type ExpectedToolCategory =
  | 'communication'
  | 'data'
  | 'development'
  | 'ai'
  | 'integration'
  | 'system'
  | 'custom'

/**
 * Tool audience - who can use this tool
 */
type ExpectedToolAudience = 'agent' | 'human' | 'both'

/**
 * Security level for tool execution
 */
type ExpectedSecurityLevel = 'public' | 'internal' | 'restricted' | 'admin'

/**
 * Expected ToolThing structure
 */
interface ExpectedToolThing {
  $id: string
  $type: 'Tool'
  id: string
  name: string
  description: string
  category: ExpectedToolCategory
  subcategory?: string
  audience: ExpectedToolAudience
  securityLevel: ExpectedSecurityLevel
  parameters: ToolParameter[]
  permissions: string[]
  version: number
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date
}

// ============================================================================
// 1. TOOL CREATION TESTS
// ============================================================================

describe('Tool Thing Creation', () => {
  let graph: ToolGraph

  beforeEach(() => {
    graph = createToolGraph({ namespace: 'tools' })
  })

  afterEach(async () => {
    await graph.clear()
  })

  describe('Basic creation', () => {
    it('creates a Tool Thing with required fields', async () => {
      const tool = await graph.create({
        name: 'Send Email',
        description: 'Send an email to a recipient',
        category: 'communication',
        audience: 'both',
        securityLevel: 'internal',
        parameters: [
          { name: 'to', type: 'string', required: true, description: 'Recipient email' },
          { name: 'subject', type: 'string', required: true, description: 'Email subject' },
          { name: 'body', type: 'string', required: true, description: 'Email body' },
        ],
      })

      expect(tool.$type).toBe('Tool')
      expect(tool.name).toBe('Send Email')
      expect(tool.category).toBe('communication')
      expect(tool.audience).toBe('both')
      expect(tool.securityLevel).toBe('internal')
      expect(tool.parameters).toHaveLength(3)
      expect(tool.$id).toBeDefined()
      expect(tool.id).toBeDefined()
      expect(tool.version).toBe(1)
      expect(tool.createdAt).toBeInstanceOf(Date)
      expect(tool.updatedAt).toBeInstanceOf(Date)
    })

    it('creates a Tool Thing with category hierarchy', async () => {
      const tool = await graph.create({
        name: 'Send Email',
        description: 'Send an email notification',
        category: 'communication',
        subcategory: 'email',
        audience: 'both',
        securityLevel: 'internal',
        parameters: [],
      })

      expect(tool.category).toBe('communication')
      expect(tool.subcategory).toBe('email')
    })

    it('auto-generates tool id from category path', async () => {
      const tool = await graph.create({
        name: 'Send Slack Message',
        description: 'Post a message to Slack',
        category: 'communication',
        subcategory: 'slack',
        audience: 'both',
        securityLevel: 'internal',
        parameters: [],
      })

      // ID should be derived from category hierarchy + name
      expect(tool.id).toMatch(/^communication\.slack\./)
    })

    it('allows custom tool id', async () => {
      const tool = await graph.create({
        id: 'custom.tool.id',
        name: 'Custom Tool',
        description: 'A tool with custom ID',
        category: 'custom',
        audience: 'agent',
        securityLevel: 'public',
        parameters: [],
      })

      expect(tool.id).toBe('custom.tool.id')
    })

    it('creates Tool with default values', async () => {
      const tool = await graph.create({
        name: 'Simple Tool',
        description: 'A simple tool',
        category: 'system',
        parameters: [],
      })

      // Defaults should be applied
      expect(tool.audience).toBe('both')
      expect(tool.securityLevel).toBe('internal')
      expect(tool.permissions).toEqual([])
    })
  })

  describe('Schema validation', () => {
    it('validates Tool schema on creation', async () => {
      // Missing required fields should fail
      await expect(graph.create({
        // Missing name
        description: 'A tool without name',
        category: 'system',
        parameters: [],
      } as ToolCreateInput)).rejects.toThrow(/name.*required/i)
    })

    it('validates parameter schema', async () => {
      await expect(graph.create({
        name: 'Bad Params',
        description: 'Tool with invalid parameters',
        category: 'system',
        parameters: [
          { name: 'param1' }, // Missing type
        ] as ToolParameter[],
      })).rejects.toThrow(/parameter.*type.*required/i)
    })

    it('validates parameter types', async () => {
      await expect(graph.create({
        name: 'Invalid Type',
        description: 'Tool with invalid parameter type',
        category: 'system',
        parameters: [
          { name: 'param1', type: 'invalid-type', required: true },
        ] as ToolParameter[],
      })).rejects.toThrow(/invalid.*type/i)
    })

    it('validates description length', async () => {
      await expect(graph.create({
        name: 'Short Desc',
        description: '', // Empty description
        category: 'system',
        parameters: [],
      })).rejects.toThrow(/description.*required/i)
    })
  })

  describe('Category validation', () => {
    it('rejects invalid category values', async () => {
      await expect(graph.create({
        name: 'Bad Category',
        description: 'Tool with invalid category',
        category: 'invalid-category' as ToolCategory,
        parameters: [],
      })).rejects.toThrow(/invalid.*category/i)
    })

    it('allows valid top-level categories', async () => {
      const categories: ToolCategory[] = [
        'communication',
        'data',
        'development',
        'ai',
        'integration',
        'system',
        'custom',
      ]

      for (const category of categories) {
        const tool = await graph.create({
          name: `${category} Tool`,
          description: `Tool in ${category} category`,
          category,
          parameters: [],
        })
        expect(tool.category).toBe(category)
      }
    })

    it('validates subcategory format', async () => {
      await expect(graph.create({
        name: 'Bad Subcategory',
        description: 'Tool with invalid subcategory',
        category: 'communication',
        subcategory: 'invalid/subcategory', // Invalid characters
        parameters: [],
      })).rejects.toThrow(/invalid.*subcategory/i)
    })
  })

  describe('Unique constraints', () => {
    it('prevents duplicate tool IDs', async () => {
      await graph.create({
        id: 'unique.tool.id',
        name: 'First Tool',
        description: 'First tool',
        category: 'system',
        parameters: [],
      })

      await expect(graph.create({
        id: 'unique.tool.id',
        name: 'Second Tool',
        description: 'Second tool with same ID',
        category: 'system',
        parameters: [],
      })).rejects.toThrow(/duplicate.*id/i)
    })

    it('prevents duplicate names in same category', async () => {
      await graph.create({
        name: 'Unique Name',
        description: 'First tool',
        category: 'communication',
        subcategory: 'email',
        parameters: [],
      })

      await expect(graph.create({
        name: 'Unique Name', // Same name
        description: 'Second tool',
        category: 'communication',
        subcategory: 'email', // Same category
        parameters: [],
      })).rejects.toThrow(/duplicate.*name/i)
    })

    it('allows same name in different categories', async () => {
      await graph.create({
        name: 'Send Message',
        description: 'Send via email',
        category: 'communication',
        subcategory: 'email',
        parameters: [],
      })

      const tool2 = await graph.create({
        name: 'Send Message',
        description: 'Send via Slack',
        category: 'communication',
        subcategory: 'slack', // Different subcategory
        parameters: [],
      })

      expect(tool2.name).toBe('Send Message')
    })
  })
})

// ============================================================================
// 2. TOOL DISCOVERY TESTS
// ============================================================================

describe('Tool Discovery', () => {
  let graph: ToolGraph

  beforeEach(async () => {
    graph = createToolGraph({ namespace: 'tools' })

    // Seed test data
    await Promise.all([
      // Communication tools
      graph.create({
        name: 'Send Email',
        description: 'Send an email',
        category: 'communication',
        subcategory: 'email',
        audience: 'both',
        securityLevel: 'internal',
        parameters: [],
      }),
      graph.create({
        name: 'Send Slack Message',
        description: 'Post to Slack',
        category: 'communication',
        subcategory: 'slack',
        audience: 'both',
        securityLevel: 'internal',
        parameters: [],
      }),
      graph.create({
        name: 'Send SMS',
        description: 'Send SMS message',
        category: 'communication',
        subcategory: 'sms',
        audience: 'human',
        securityLevel: 'restricted',
        parameters: [],
      }),
      // Data tools
      graph.create({
        name: 'Query Database',
        description: 'Run SQL query',
        category: 'data',
        subcategory: 'sql',
        audience: 'agent',
        securityLevel: 'admin',
        parameters: [],
      }),
      graph.create({
        name: 'Read File',
        description: 'Read file contents',
        category: 'data',
        subcategory: 'filesystem',
        audience: 'both',
        securityLevel: 'internal',
        parameters: [],
      }),
      // AI tools
      graph.create({
        name: 'Generate Text',
        description: 'Generate text with LLM',
        category: 'ai',
        subcategory: 'llm',
        audience: 'agent',
        securityLevel: 'public',
        parameters: [],
      }),
    ])
  })

  afterEach(async () => {
    await graph.clear()
  })

  describe('Query by category', () => {
    it('queries tools by category', async () => {
      const tools = await graph.query({
        category: 'communication',
      })

      expect(tools).toHaveLength(3)
      expect(tools.every((t) => t.category === 'communication')).toBe(true)
    })

    it('queries tools by category and subcategory', async () => {
      const tools = await graph.query({
        category: 'communication',
        subcategory: 'email',
      })

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('Send Email')
    })

    it('queries tools by subcategory only', async () => {
      const tools = await graph.query({
        subcategory: 'sql',
      })

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('Query Database')
    })

    it('returns empty array for non-existent category', async () => {
      const tools = await graph.query({
        category: 'nonexistent' as ToolCategory,
      })

      expect(tools).toHaveLength(0)
    })
  })

  describe('Query by audience', () => {
    it('queries tools by audience (agent)', async () => {
      const tools = await graph.query({
        audience: 'agent',
      })

      expect(tools).toHaveLength(2)
      expect(tools.every((t) => t.audience === 'agent')).toBe(true)
    })

    it('queries tools by audience (human)', async () => {
      const tools = await graph.query({
        audience: 'human',
      })

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('Send SMS')
    })

    it('queries tools by audience (both)', async () => {
      const tools = await graph.query({
        audience: 'both',
      })

      expect(tools).toHaveLength(3)
      expect(tools.every((t) => t.audience === 'both')).toBe(true)
    })

    it('queries tools available to agents (agent + both)', async () => {
      const tools = await graph.query({
        availableTo: 'agent',
      })

      // Should include 'agent' and 'both' audiences
      expect(tools.length).toBeGreaterThanOrEqual(5)
      expect(tools.every((t) => t.audience === 'agent' || t.audience === 'both')).toBe(true)
    })

    it('queries tools available to humans (human + both)', async () => {
      const tools = await graph.query({
        availableTo: 'human',
      })

      // Should include 'human' and 'both' audiences
      expect(tools.length).toBeGreaterThanOrEqual(4)
      expect(tools.every((t) => t.audience === 'human' || t.audience === 'both')).toBe(true)
    })
  })

  describe('Query by security level', () => {
    it('filters by security level', async () => {
      const tools = await graph.query({
        securityLevel: 'admin',
      })

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('Query Database')
    })

    it('filters by maximum security level', async () => {
      const tools = await graph.query({
        maxSecurityLevel: 'internal',
      })

      // Should include public and internal, exclude restricted and admin
      expect(tools.length).toBeGreaterThan(0)
      expect(tools.every((t) => t.securityLevel === 'public' || t.securityLevel === 'internal')).toBe(true)
    })

    it('filters by minimum security level', async () => {
      const tools = await graph.query({
        minSecurityLevel: 'restricted',
      })

      // Should include restricted and admin
      expect(tools.length).toBeGreaterThan(0)
      expect(tools.every((t) => t.securityLevel === 'restricted' || t.securityLevel === 'admin')).toBe(true)
    })
  })

  describe('Search by name/description', () => {
    it('searches tools by name', async () => {
      const tools = await graph.query({
        search: 'Email',
      })

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('Send Email')
    })

    it('searches tools by description', async () => {
      const tools = await graph.query({
        search: 'LLM',
      })

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('Generate Text')
    })

    it('searches are case-insensitive', async () => {
      const tools = await graph.query({
        search: 'send',
      })

      expect(tools.length).toBeGreaterThanOrEqual(3)
    })

    it('searches with partial matches', async () => {
      const tools = await graph.query({
        search: 'Slack',
      })

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('Send Slack Message')
    })
  })

  describe('Pagination', () => {
    it('paginates large tool sets', async () => {
      const page1 = await graph.query({
        limit: 2,
        offset: 0,
      })

      expect(page1).toHaveLength(2)

      const page2 = await graph.query({
        limit: 2,
        offset: 2,
      })

      expect(page2).toHaveLength(2)

      // Pages should have different tools
      const page1Ids = new Set(page1.map((t) => t.id))
      const page2Ids = new Set(page2.map((t) => t.id))
      const intersection = [...page1Ids].filter((id) => page2Ids.has(id))
      expect(intersection).toHaveLength(0)
    })

    it('returns total count with pagination', async () => {
      const result = await graph.query({
        limit: 2,
        offset: 0,
        includeCount: true,
      })

      expect(result.tools).toHaveLength(2)
      expect(result.total).toBe(6)
    })

    it('handles offset beyond results', async () => {
      const tools = await graph.query({
        limit: 10,
        offset: 100,
      })

      expect(tools).toHaveLength(0)
    })

    it('uses default pagination values', async () => {
      const tools = await graph.query({})

      // Should return all tools (default limit is high or unlimited)
      expect(tools.length).toBe(6)
    })
  })

  describe('Sorting', () => {
    it('sorts by name ascending', async () => {
      const tools = await graph.query({
        sortBy: 'name',
        sortOrder: 'asc',
      })

      const names = tools.map((t) => t.name)
      const sorted = [...names].sort()
      expect(names).toEqual(sorted)
    })

    it('sorts by name descending', async () => {
      const tools = await graph.query({
        sortBy: 'name',
        sortOrder: 'desc',
      })

      const names = tools.map((t) => t.name)
      const sorted = [...names].sort().reverse()
      expect(names).toEqual(sorted)
    })

    it('sorts by createdAt', async () => {
      const tools = await graph.query({
        sortBy: 'createdAt',
        sortOrder: 'desc',
      })

      for (let i = 1; i < tools.length; i++) {
        expect(tools[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(tools[i].createdAt.getTime())
      }
    })

    it('sorts by category', async () => {
      const tools = await graph.query({
        sortBy: 'category',
        sortOrder: 'asc',
      })

      const categories = tools.map((t) => t.category)
      const sorted = [...categories].sort()
      expect(categories).toEqual(sorted)
    })
  })

  describe('Combined filters', () => {
    it('combines category and audience filters', async () => {
      const tools = await graph.query({
        category: 'communication',
        audience: 'both',
      })

      expect(tools).toHaveLength(2)
      expect(tools.every((t) => t.category === 'communication' && t.audience === 'both')).toBe(true)
    })

    it('combines search and security level', async () => {
      const tools = await graph.query({
        search: 'Send',
        securityLevel: 'internal',
      })

      expect(tools.every((t) => t.securityLevel === 'internal')).toBe(true)
      expect(tools.every((t) => t.name.toLowerCase().includes('send') || t.description.toLowerCase().includes('send'))).toBe(true)
    })

    it('combines all filters', async () => {
      const tools = await graph.query({
        category: 'communication',
        audience: 'both',
        securityLevel: 'internal',
        search: 'email',
        limit: 10,
        sortBy: 'name',
        sortOrder: 'asc',
      })

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('Send Email')
    })
  })
})

// ============================================================================
// 3. TOOL UPDATES TESTS
// ============================================================================

describe('Tool Updates', () => {
  let graph: ToolGraph
  let existingTool: ToolThing

  beforeEach(async () => {
    graph = createToolGraph({ namespace: 'tools' })

    existingTool = await graph.create({
      name: 'Original Tool',
      description: 'Original description',
      category: 'system',
      audience: 'both',
      securityLevel: 'internal',
      parameters: [
        { name: 'param1', type: 'string', required: true, description: 'First parameter' },
      ],
      permissions: ['read'],
    })
  })

  afterEach(async () => {
    await graph.clear()
  })

  describe('Parameter updates', () => {
    it('updates tool parameters', async () => {
      const updated = await graph.update(existingTool.id, {
        parameters: [
          { name: 'param1', type: 'string', required: true, description: 'Updated first parameter' },
          { name: 'param2', type: 'number', required: false, description: 'New second parameter' },
        ],
      })

      expect(updated.parameters).toHaveLength(2)
      expect(updated.parameters[0].description).toBe('Updated first parameter')
      expect(updated.parameters[1].name).toBe('param2')
    })

    it('removes parameters', async () => {
      const updated = await graph.update(existingTool.id, {
        parameters: [],
      })

      expect(updated.parameters).toHaveLength(0)
    })

    it('validates parameter updates', async () => {
      await expect(graph.update(existingTool.id, {
        parameters: [
          { name: 'bad', type: 'invalid' } as ToolParameter,
        ],
      })).rejects.toThrow(/invalid.*type/i)
    })

    it('updates individual parameter properties', async () => {
      const updated = await graph.update(existingTool.id, {
        parameters: [
          { name: 'param1', type: 'string', required: false, description: 'Now optional' },
        ],
      })

      expect(updated.parameters[0].required).toBe(false)
    })
  })

  describe('Permission updates', () => {
    it('updates tool permissions', async () => {
      const updated = await graph.update(existingTool.id, {
        permissions: ['read', 'write', 'execute'],
      })

      expect(updated.permissions).toEqual(['read', 'write', 'execute'])
    })

    it('adds new permissions', async () => {
      const updated = await graph.update(existingTool.id, {
        permissions: [...existingTool.permissions, 'admin'],
      })

      expect(updated.permissions).toContain('admin')
      expect(updated.permissions).toContain('read')
    })

    it('removes permissions', async () => {
      const updated = await graph.update(existingTool.id, {
        permissions: [],
      })

      expect(updated.permissions).toHaveLength(0)
    })
  })

  describe('Version tracking', () => {
    it('tracks version changes', async () => {
      expect(existingTool.version).toBe(1)

      const updated = await graph.update(existingTool.id, {
        description: 'Updated description',
      })

      expect(updated.version).toBe(2)
    })

    it('increments version on each update', async () => {
      let tool = existingTool

      for (let i = 2; i <= 5; i++) {
        tool = await graph.update(tool.id, {
          description: `Version ${i}`,
        })
        expect(tool.version).toBe(i)
      }
    })

    it('retrieves specific version', async () => {
      await graph.update(existingTool.id, { description: 'Version 2' })
      await graph.update(existingTool.id, { description: 'Version 3' })

      const version1 = await graph.getVersion(existingTool.id, 1)
      const version2 = await graph.getVersion(existingTool.id, 2)
      const version3 = await graph.getVersion(existingTool.id, 3)

      expect(version1?.description).toBe('Original description')
      expect(version2?.description).toBe('Version 2')
      expect(version3?.description).toBe('Version 3')
    })

    it('lists all versions', async () => {
      await graph.update(existingTool.id, { description: 'Version 2' })
      await graph.update(existingTool.id, { description: 'Version 3' })

      const versions = await graph.listVersions(existingTool.id)

      expect(versions).toHaveLength(3)
      expect(versions.map((v) => v.version)).toEqual([1, 2, 3])
    })

    it('preserves version history on updates', async () => {
      const original = { ...existingTool }

      await graph.update(existingTool.id, {
        name: 'New Name',
        description: 'New Description',
        parameters: [],
      })

      const version1 = await graph.getVersion(existingTool.id, 1)

      expect(version1?.name).toBe(original.name)
      expect(version1?.description).toBe(original.description)
      expect(version1?.parameters).toHaveLength(1)
    })
  })

  describe('Metadata updates', () => {
    it('updates basic metadata', async () => {
      const updated = await graph.update(existingTool.id, {
        name: 'Renamed Tool',
        description: 'New description',
      })

      expect(updated.name).toBe('Renamed Tool')
      expect(updated.description).toBe('New description')
    })

    it('updates category', async () => {
      const updated = await graph.update(existingTool.id, {
        category: 'communication',
        subcategory: 'email',
      })

      expect(updated.category).toBe('communication')
      expect(updated.subcategory).toBe('email')
    })

    it('updates audience', async () => {
      const updated = await graph.update(existingTool.id, {
        audience: 'agent',
      })

      expect(updated.audience).toBe('agent')
    })

    it('updates security level', async () => {
      const updated = await graph.update(existingTool.id, {
        securityLevel: 'admin',
      })

      expect(updated.securityLevel).toBe('admin')
    })

    it('updates updatedAt timestamp', async () => {
      const originalUpdatedAt = existingTool.updatedAt

      // Small delay to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 10))

      const updated = await graph.update(existingTool.id, {
        description: 'Triggers timestamp update',
      })

      expect(updated.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
    })

    it('preserves createdAt on update', async () => {
      const originalCreatedAt = existingTool.createdAt

      const updated = await graph.update(existingTool.id, {
        description: 'Should not change createdAt',
      })

      expect(updated.createdAt.getTime()).toBe(originalCreatedAt.getTime())
    })
  })

  describe('Update validation', () => {
    it('rejects updates to non-existent tool', async () => {
      await expect(graph.update('non-existent-id', {
        description: 'This should fail',
      })).rejects.toThrow(/not found/i)
    })

    it('validates category on update', async () => {
      await expect(graph.update(existingTool.id, {
        category: 'invalid' as ToolCategory,
      })).rejects.toThrow(/invalid.*category/i)
    })

    it('validates audience on update', async () => {
      await expect(graph.update(existingTool.id, {
        audience: 'invalid' as ToolAudience,
      })).rejects.toThrow(/invalid.*audience/i)
    })

    it('validates security level on update', async () => {
      await expect(graph.update(existingTool.id, {
        securityLevel: 'invalid' as SecurityLevel,
      })).rejects.toThrow(/invalid.*security/i)
    })

    it('prevents empty name on update', async () => {
      await expect(graph.update(existingTool.id, {
        name: '',
      })).rejects.toThrow(/name.*required/i)
    })
  })

  describe('Concurrent updates', () => {
    it('handles concurrent updates correctly', async () => {
      // Simulate concurrent updates
      const [update1, update2] = await Promise.all([
        graph.update(existingTool.id, { description: 'Update 1' }),
        graph.update(existingTool.id, { description: 'Update 2' }),
      ])

      // Both should succeed with different versions
      expect(update1.version).not.toBe(update2.version)
    })

    it('supports optimistic locking', async () => {
      const tool = await graph.get(existingTool.id)

      // First update with expected version
      const updated = await graph.update(existingTool.id, {
        description: 'First update',
      }, { expectedVersion: tool?.version })

      // Second update with stale version should fail
      await expect(graph.update(existingTool.id, {
        description: 'Stale update',
      }, { expectedVersion: tool?.version })).rejects.toThrow(/version.*conflict/i)
    })
  })
})

// ============================================================================
// 4. TOOL DELETION TESTS
// ============================================================================

describe('Tool Deletion', () => {
  let graph: ToolGraph
  let existingTool: ToolThing

  beforeEach(async () => {
    graph = createToolGraph({ namespace: 'tools' })

    existingTool = await graph.create({
      name: 'Deletable Tool',
      description: 'A tool that will be deleted',
      category: 'system',
      parameters: [],
    })
  })

  afterEach(async () => {
    await graph.clear()
  })

  describe('Soft delete', () => {
    it('soft deletes tool (sets deletedAt)', async () => {
      await graph.delete(existingTool.id)

      const tool = await graph.get(existingTool.id, { includeDeleted: true })

      expect(tool).not.toBeNull()
      expect(tool?.deletedAt).toBeInstanceOf(Date)
    })

    it('excludes deleted tools from queries by default', async () => {
      await graph.delete(existingTool.id)

      const tools = await graph.query({})

      expect(tools.find((t) => t.id === existingTool.id)).toBeUndefined()
    })

    it('includes deleted tools when requested', async () => {
      await graph.delete(existingTool.id)

      const tools = await graph.query({ includeDeleted: true })

      expect(tools.find((t) => t.id === existingTool.id)).toBeDefined()
    })

    it('returns null for deleted tool on get', async () => {
      await graph.delete(existingTool.id)

      const tool = await graph.get(existingTool.id)

      expect(tool).toBeNull()
    })

    it('returns deleted tool when includeDeleted is true', async () => {
      await graph.delete(existingTool.id)

      const tool = await graph.get(existingTool.id, { includeDeleted: true })

      expect(tool).not.toBeNull()
      expect(tool?.id).toBe(existingTool.id)
    })
  })

  describe('History preservation', () => {
    it('preserves invocation history after deletion', async () => {
      // Record some invocations
      await graph.recordInvocation(existingTool.id, {
        input: { test: 'value' },
        output: { result: 'success' },
        durationMs: 100,
        success: true,
      })

      await graph.delete(existingTool.id)

      // History should still be accessible
      const invocations = await graph.getInvocations(existingTool.id)

      expect(invocations).toHaveLength(1)
      expect(invocations[0].success).toBe(true)
    })

    it('preserves version history after deletion', async () => {
      // Create some versions
      await graph.update(existingTool.id, { description: 'Version 2' })
      await graph.update(existingTool.id, { description: 'Version 3' })

      await graph.delete(existingTool.id)

      // Version history should still be accessible
      const versions = await graph.listVersions(existingTool.id)

      expect(versions.length).toBeGreaterThanOrEqual(3)
    })

    it('preserves tool data for auditing', async () => {
      await graph.delete(existingTool.id)

      // Full tool data should be preserved
      const tool = await graph.get(existingTool.id, { includeDeleted: true })

      expect(tool?.name).toBe('Deletable Tool')
      expect(tool?.description).toBe('A tool that will be deleted')
      expect(tool?.category).toBe('system')
    })
  })

  describe('Active invocation protection', () => {
    it('prevents deletion of tools with active invocations', async () => {
      // Start an invocation (simulated as pending)
      await graph.startInvocation(existingTool.id, {
        input: { test: 'value' },
        startedAt: new Date(),
      })

      await expect(graph.delete(existingTool.id)).rejects.toThrow(/active.*invocation/i)
    })

    it('allows deletion after invocations complete', async () => {
      // Start and complete an invocation
      const invocationId = await graph.startInvocation(existingTool.id, {
        input: { test: 'value' },
        startedAt: new Date(),
      })

      await graph.completeInvocation(invocationId, {
        output: { result: 'done' },
        success: true,
        durationMs: 50,
      })

      // Now deletion should work
      await expect(graph.delete(existingTool.id)).resolves.not.toThrow()
    })

    it('force delete bypasses active invocation check', async () => {
      // Start an active invocation
      await graph.startInvocation(existingTool.id, {
        input: { test: 'value' },
        startedAt: new Date(),
      })

      // Force delete should work
      await graph.delete(existingTool.id, { force: true })

      const tool = await graph.get(existingTool.id, { includeDeleted: true })
      expect(tool?.deletedAt).toBeDefined()
    })

    it('cancels active invocations on force delete', async () => {
      const invocationId = await graph.startInvocation(existingTool.id, {
        input: { test: 'value' },
        startedAt: new Date(),
      })

      await graph.delete(existingTool.id, { force: true })

      // Invocation should be marked as cancelled
      const invocation = await graph.getInvocation(invocationId)
      expect(invocation?.status).toBe('cancelled')
    })
  })

  describe('Restore/undelete', () => {
    it('supports restoring deleted tools', async () => {
      await graph.delete(existingTool.id)

      await graph.restore(existingTool.id)

      const tool = await graph.get(existingTool.id)

      expect(tool).not.toBeNull()
      expect(tool?.deletedAt).toBeUndefined()
    })

    it('fails to restore non-deleted tool', async () => {
      await expect(graph.restore(existingTool.id)).rejects.toThrow(/not deleted/i)
    })

    it('fails to restore non-existent tool', async () => {
      await expect(graph.restore('non-existent')).rejects.toThrow(/not found/i)
    })

    it('restored tool appears in queries', async () => {
      await graph.delete(existingTool.id)
      await graph.restore(existingTool.id)

      const tools = await graph.query({})

      expect(tools.find((t) => t.id === existingTool.id)).toBeDefined()
    })
  })

  describe('Hard delete (permanent)', () => {
    it('supports permanent deletion', async () => {
      await graph.delete(existingTool.id, { permanent: true, confirm: true })

      const tool = await graph.get(existingTool.id, { includeDeleted: true })

      expect(tool).toBeNull()
    })

    it('removes version history on permanent delete', async () => {
      await graph.update(existingTool.id, { description: 'Version 2' })

      await graph.delete(existingTool.id, { permanent: true, confirm: true })

      const versions = await graph.listVersions(existingTool.id)

      expect(versions).toHaveLength(0)
    })

    it('removes invocation history on permanent delete', async () => {
      await graph.recordInvocation(existingTool.id, {
        input: {},
        output: {},
        durationMs: 100,
        success: true,
      })

      await graph.delete(existingTool.id, { permanent: true, confirm: true })

      const invocations = await graph.getInvocations(existingTool.id)

      expect(invocations).toHaveLength(0)
    })

    it('requires confirmation for permanent delete', async () => {
      await expect(graph.delete(existingTool.id, {
        permanent: true,
        // Missing confirmation
      })).rejects.toThrow(/confirm/i)
    })

    it('accepts confirmation for permanent delete', async () => {
      await graph.delete(existingTool.id, {
        permanent: true,
        confirm: true,
      })

      const tool = await graph.get(existingTool.id, { includeDeleted: true })
      expect(tool).toBeNull()
    })
  })

  describe('Cascading effects', () => {
    it('removes tool from relationships on delete', async () => {
      // Create a relationship
      await graph.createRelationship(existingTool.id, 'related', 'other-tool-id')

      await graph.delete(existingTool.id)

      // Relationship should be removed or marked as deleted
      const relationships = await graph.getRelationships(existingTool.id)
      expect(relationships.filter((r) => !r.deletedAt)).toHaveLength(0)
    })

    it('updates dependent tools on delete', async () => {
      // Create another tool that depends on this one
      const dependent = await graph.create({
        name: 'Dependent Tool',
        description: 'Depends on deletable tool',
        category: 'system',
        parameters: [],
        dependencies: [existingTool.id],
      })

      await graph.delete(existingTool.id)

      // Dependent tool should be notified/updated
      const updatedDependent = await graph.get(dependent.id)
      expect(updatedDependent?.meta?.brokenDependencies).toContain(existingTool.id)
    })
  })
})

// ============================================================================
// TYPE-LEVEL TESTS
// ============================================================================

describe('Type-level checks', () => {
  it('ToolThing type matches expected structure', () => {
    // Type-level assertion
    type _Check = Expect<Equals<ToolThing['$type'], 'Tool'>>
    expect(true).toBe(true)
  })

  it('ToolCategory includes all expected values', () => {
    type _Check = Expect<
      Equals<
        ToolCategory,
        'communication' | 'data' | 'development' | 'ai' | 'integration' | 'system' | 'custom'
      >
    >
    expect(true).toBe(true)
  })

  it('ToolAudience includes all expected values', () => {
    type _Check = Expect<Equals<ToolAudience, 'agent' | 'human' | 'both'>>
    expect(true).toBe(true)
  })

  it('SecurityLevel has correct ordering', () => {
    type _Check = Expect<
      Equals<SecurityLevel, 'public' | 'internal' | 'restricted' | 'admin'>
    >
    expect(true).toBe(true)
  })
})
