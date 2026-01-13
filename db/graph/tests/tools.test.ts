/**
 * Digital Tools Graph Integration Tests
 *
 * TDD tests for Tool Things in the graph model. Integrates digital tools
 * with the Graph Model for tool registry, execution tracking, and MCP compatibility.
 *
 * Domain model:
 * - Tool (node): A callable capability stored as a Thing
 * - Provider (node): Service providing tools (e.g., 'openai', 'anthropic')
 * - Tool -[providedBy]-> Provider: Tool comes from this provider
 * - Invocation lifecycle: invoke -> invoking -> invoked
 *
 * Uses real SQLite, NO MOCKS - per project testing philosophy.
 *
 * @see dotdo-2hiae - Digital Tools Graph Integration
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Tool parameter definition stored in graph
 */
interface ToolParameter {
  name: string
  type: string
  description?: string
  required?: boolean
  schema?: Record<string, unknown>
}

/**
 * Tool data schema stored in Thing.data
 */
interface ToolData {
  /** Tool name (unique identifier) */
  name: string
  /** Human-readable description */
  description: string
  /** Input parameters */
  parameters: ToolParameter[]
  /** Tool category for filtering */
  category?: string
  /** Semantic version */
  version?: string
  /** Whether tool is destructive */
  destructive?: boolean
  /** Security level */
  securityLevel?: 'public' | 'internal' | 'restricted' | 'critical'
  /** Provider ID (foreign key to Provider Thing) */
  providerId?: string
  /** Handler reference for execution */
  handlerRef?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Tool Thing - A Thing with Tool-specific data
 */
interface ToolThing {
  id: string
  typeId: number
  typeName: 'Tool'
  data: ToolData
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

/**
 * Input for creating a new Tool
 */
interface CreateToolInput {
  id?: string
  name: string
  description: string
  parameters?: ToolParameter[]
  category?: string
  version?: string
  destructive?: boolean
  securityLevel?: 'public' | 'internal' | 'restricted' | 'critical'
  providerId?: string
  handlerRef?: string
  metadata?: Record<string, unknown>
}

/**
 * Input for updating a Tool
 */
interface UpdateToolInput {
  name?: string
  description?: string
  parameters?: ToolParameter[]
  category?: string
  version?: string
  destructive?: boolean
  securityLevel?: 'public' | 'internal' | 'restricted' | 'critical'
  handlerRef?: string
  metadata?: Record<string, unknown>
}

/**
 * Query options for finding tools
 */
interface ToolQueryOptions {
  category?: string
  securityLevel?: 'public' | 'internal' | 'restricted' | 'critical'
  providerId?: string
  namePrefix?: string
  limit?: number
  offset?: number
}

/**
 * Tool invocation state
 */
type InvocationState = 'invoke' | 'invoking' | 'invoked' | 'failed'

/**
 * Tool invocation data
 */
interface InvocationData {
  toolId: string
  input: Record<string, unknown>
  output?: unknown
  error?: string
  startedAt?: number
  completedAt?: number
  agentId?: string
}

// ============================================================================
// TOOLSTORE INTERFACE TESTS
// ============================================================================

describe('ToolStore Interface', () => {
  it('ToolStore is exported from db/graph', async () => {
    const graphModule = await import('../index').catch(() => null)
    expect(graphModule?.ToolStore).toBeDefined()
  })

  it('has createTool method', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not exported from db/graph')
    }
    expect(graphModule.ToolStore.prototype.createTool).toBeDefined()
    expect(typeof graphModule.ToolStore.prototype.createTool).toBe('function')
  })

  it('has getTool method', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not exported from db/graph')
    }
    expect(graphModule.ToolStore.prototype.getTool).toBeDefined()
    expect(typeof graphModule.ToolStore.prototype.getTool).toBe('function')
  })

  it('has getToolByName method', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not exported from db/graph')
    }
    expect(graphModule.ToolStore.prototype.getToolByName).toBeDefined()
    expect(typeof graphModule.ToolStore.prototype.getToolByName).toBe('function')
  })

  it('has updateTool method', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not exported from db/graph')
    }
    expect(graphModule.ToolStore.prototype.updateTool).toBeDefined()
    expect(typeof graphModule.ToolStore.prototype.updateTool).toBe('function')
  })

  it('has deleteTool method', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not exported from db/graph')
    }
    expect(graphModule.ToolStore.prototype.deleteTool).toBeDefined()
    expect(typeof graphModule.ToolStore.prototype.deleteTool).toBe('function')
  })

  it('has findTools method', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not exported from db/graph')
    }
    expect(graphModule.ToolStore.prototype.findTools).toBeDefined()
    expect(typeof graphModule.ToolStore.prototype.findTools).toBe('function')
  })

  it('has listTools method', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not exported from db/graph')
    }
    expect(graphModule.ToolStore.prototype.listTools).toBeDefined()
    expect(typeof graphModule.ToolStore.prototype.listTools).toBe('function')
  })
})

// ============================================================================
// TOOL CRUD TESTS
// ============================================================================

describe('Tool as Thing', () => {
  describe('Create Tool', () => {
    it('should create Tool Thing with name and description', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented - waiting for db/graph/tools.ts')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.createTool({
        name: 'searchNodes',
        description: 'Search for nodes in the graph',
      })

      expect(tool).toBeDefined()
      expect(tool.id).toBeDefined()
      expect(tool.typeName).toBe('Tool')
      expect(tool.data.name).toBe('searchNodes')
      expect(tool.data.description).toBe('Search for nodes in the graph')
    })

    it('should create Tool Thing with parameters', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.createTool({
        name: 'file_write',
        description: 'Write content to a file',
        parameters: [
          { name: 'path', type: 'string', description: 'File path', required: true },
          { name: 'content', type: 'string', description: 'File content', required: true },
          { name: 'encoding', type: 'string', description: 'File encoding', required: false },
        ],
      })

      expect(tool.data.parameters).toHaveLength(3)
      expect(tool.data.parameters[0].name).toBe('path')
      expect(tool.data.parameters[0].required).toBe(true)
      expect(tool.data.parameters[2].required).toBe(false)
    })

    it('should create Tool Thing with category', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.createTool({
        name: 'git_commit',
        description: 'Commit changes to git',
        category: 'version-control',
      })

      expect(tool.data.category).toBe('version-control')
    })

    it('should create Tool Thing with version', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.createTool({
        name: 'database_query',
        description: 'Query the database',
        version: '2.0.0',
      })

      expect(tool.data.version).toBe('2.0.0')
    })

    it('should create Tool Thing with security level', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.createTool({
        name: 'shell_execute',
        description: 'Execute shell commands',
        securityLevel: 'restricted',
      })

      expect(tool.data.securityLevel).toBe('restricted')
    })

    it('should default security level to public', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.createTool({
        name: 'format_text',
        description: 'Format text content',
      })

      expect(tool.data.securityLevel).toBe('public')
    })

    it('should create Tool Thing with destructive flag', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.createTool({
        name: 'delete_file',
        description: 'Delete a file',
        destructive: true,
      })

      expect(tool.data.destructive).toBe(true)
    })

    it('should default destructive to false', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.createTool({
        name: 'read_file',
        description: 'Read a file',
      })

      expect(tool.data.destructive).toBe(false)
    })

    it('should auto-generate ID from tool name', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.createTool({
        name: 'searchNodes',
        description: 'Search nodes',
      })

      expect(tool.id).toBe('tool:searchNodes')
    })

    it('should use provided ID if given', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.createTool({
        id: 'custom-tool-id',
        name: 'customTool',
        description: 'A custom tool',
      })

      expect(tool.id).toBe('custom-tool-id')
    })

    it('should reject duplicate tool names', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})

      await store.createTool({
        name: 'uniqueTool',
        description: 'First tool',
      })

      await expect(
        store.createTool({
          name: 'uniqueTool',
          description: 'Second tool with same name',
        })
      ).rejects.toThrow()
    })

    it('should store metadata', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.createTool({
        name: 'metadataTool',
        description: 'Tool with metadata',
        metadata: {
          author: 'test',
          tags: ['utility', 'io'],
        },
      })

      expect(tool.data.metadata).toEqual({
        author: 'test',
        tags: ['utility', 'io'],
      })
    })
  })

  // ==========================================================================
  // READ TOOL TESTS
  // ==========================================================================

  describe('Read Tool', () => {
    it('should retrieve Tool by ID', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})

      await store.createTool({
        name: 'retrievableTool',
        description: 'A tool to retrieve',
      })

      const tool = await store.getTool('tool:retrievableTool')

      expect(tool).toBeDefined()
      expect(tool?.id).toBe('tool:retrievableTool')
      expect(tool?.data.name).toBe('retrievableTool')
    })

    it('should return null for non-existent Tool', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.getTool('non-existent-tool')

      expect(tool).toBeNull()
    })

    it('should retrieve Tool by name', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})

      await store.createTool({
        name: 'namedTool',
        description: 'Find by name',
      })

      const tool = await store.getToolByName('namedTool')

      expect(tool).toBeDefined()
      expect(tool?.data.name).toBe('namedTool')
    })

    it('should return Tool with all fields populated', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})

      await store.createTool({
        name: 'fullTool',
        description: 'Fully populated tool',
        parameters: [{ name: 'arg', type: 'string', required: true }],
        category: 'test',
        version: '1.0.0',
        destructive: true,
        securityLevel: 'internal',
        metadata: { key: 'value' },
      })

      const tool = await store.getTool('tool:fullTool')

      expect(tool).toBeDefined()
      expect(tool?.id).toBe('tool:fullTool')
      expect(tool?.typeName).toBe('Tool')
      expect(tool?.data.name).toBe('fullTool')
      expect(tool?.data.description).toBe('Fully populated tool')
      expect(tool?.data.parameters).toHaveLength(1)
      expect(tool?.data.category).toBe('test')
      expect(tool?.data.version).toBe('1.0.0')
      expect(tool?.data.destructive).toBe(true)
      expect(tool?.data.securityLevel).toBe('internal')
      expect(tool?.data.metadata).toEqual({ key: 'value' })
      expect(tool?.createdAt).toBeDefined()
      expect(tool?.updatedAt).toBeDefined()
      expect(tool?.deletedAt).toBeNull()
    })
  })

  // ==========================================================================
  // UPDATE TOOL TESTS
  // ==========================================================================

  describe('Update Tool', () => {
    it('should update Tool description', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})

      await store.createTool({
        name: 'updateDescTool',
        description: 'Original description',
      })

      const updated = await store.updateTool('tool:updateDescTool', {
        description: 'Updated description',
      })

      expect(updated?.data.description).toBe('Updated description')
    })

    it('should update Tool parameters', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})

      await store.createTool({
        name: 'updateParamsTool',
        description: 'Tool with params',
        parameters: [{ name: 'old', type: 'string' }],
      })

      const updated = await store.updateTool('tool:updateParamsTool', {
        parameters: [
          { name: 'new1', type: 'string', required: true },
          { name: 'new2', type: 'number', required: false },
        ],
      })

      expect(updated?.data.parameters).toHaveLength(2)
      expect(updated?.data.parameters[0].name).toBe('new1')
    })

    it('should update Tool version', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})

      await store.createTool({
        name: 'versionedTool',
        description: 'Tool with version',
        version: '1.0.0',
      })

      const updated = await store.updateTool('tool:versionedTool', {
        version: '2.0.0',
      })

      expect(updated?.data.version).toBe('2.0.0')
    })

    it('should update Tool security level', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})

      await store.createTool({
        name: 'securityTool',
        description: 'Tool with security',
        securityLevel: 'public',
      })

      const updated = await store.updateTool('tool:securityTool', {
        securityLevel: 'restricted',
      })

      expect(updated?.data.securityLevel).toBe('restricted')
    })

    it('should update updatedAt timestamp', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})

      const created = await store.createTool({
        name: 'timestampTool',
        description: 'Tool for timestamp test',
      })

      const originalUpdatedAt = created.updatedAt

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await store.updateTool('tool:timestampTool', {
        description: 'Updated description',
      })

      expect(updated?.updatedAt).toBeGreaterThan(originalUpdatedAt)
      expect(updated?.createdAt).toBe(created.createdAt)
    })

    it('should return null for non-existent Tool', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})
      const result = await store.updateTool('non-existent', { description: 'Test' })

      expect(result).toBeNull()
    })

    it('should not change name on update (immutable)', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})

      await store.createTool({
        name: 'immutableNameTool',
        description: 'Original',
      })

      // Attempting to update name should either be ignored or throw
      const updated = await store.updateTool('tool:immutableNameTool', {
        // @ts-expect-error - name should not be updatable via update
        name: 'newName',
      })

      // Name should remain 'immutableNameTool'
      expect(updated?.data.name).toBe('immutableNameTool')
    })
  })

  // ==========================================================================
  // DELETE TOOL TESTS
  // ==========================================================================

  describe('Delete Tool', () => {
    it('should soft delete a Tool by setting deletedAt', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})

      await store.createTool({
        name: 'deletableTool',
        description: 'Tool to delete',
      })

      const deleted = await store.deleteTool('tool:deletableTool')

      expect(deleted).toBeDefined()
      expect(deleted?.deletedAt).toBeDefined()
      expect(deleted?.deletedAt).not.toBeNull()
    })

    it('should still be retrievable after soft delete', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})

      await store.createTool({
        name: 'softDeletedTool',
        description: 'Soft deleted tool',
      })

      await store.deleteTool('tool:softDeletedTool')

      const tool = await store.getTool('tool:softDeletedTool')
      expect(tool).toBeDefined()
      expect(tool?.deletedAt).not.toBeNull()
    })

    it('should return null for non-existent Tool', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore) {
        throw new Error('ToolStore not implemented')
      }

      const store = new graphModule.ToolStore({})
      const result = await store.deleteTool('non-existent')

      expect(result).toBeNull()
    })
  })
})

// ============================================================================
// TOOL QUERY TESTS
// ============================================================================

describe('Tool Queries', () => {
  it('should find tools by category', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not implemented')
    }

    const store = new graphModule.ToolStore({})

    await store.createTool({ name: 'tool1', description: 'Graph tool', category: 'graph' })
    await store.createTool({ name: 'tool2', description: 'Mutation tool', category: 'mutation' })
    await store.createTool({ name: 'tool3', description: 'Another graph tool', category: 'graph' })

    const graphTools = await store.findTools({ category: 'graph' })

    expect(Array.isArray(graphTools)).toBe(true)
    expect(graphTools.length).toBe(2)
    expect(graphTools.every((t: ToolThing) => t.data.category === 'graph')).toBe(true)
  })

  it('should find tools by security level', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not implemented')
    }

    const store = new graphModule.ToolStore({})

    await store.createTool({ name: 'publicTool', description: 'Public', securityLevel: 'public' })
    await store.createTool({ name: 'restrictedTool', description: 'Restricted', securityLevel: 'restricted' })
    await store.createTool({ name: 'anotherPublic', description: 'Another public', securityLevel: 'public' })

    const restrictedTools = await store.findTools({ securityLevel: 'restricted' })

    expect(restrictedTools.length).toBe(1)
    expect(restrictedTools[0].data.name).toBe('restrictedTool')
  })

  it('should find tools by name prefix', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not implemented')
    }

    const store = new graphModule.ToolStore({})

    await store.createTool({ name: 'git_commit', description: 'Commit' })
    await store.createTool({ name: 'git_push', description: 'Push' })
    await store.createTool({ name: 'file_read', description: 'Read file' })

    const gitTools = await store.findTools({ namePrefix: 'git_' })

    expect(gitTools.length).toBe(2)
    expect(gitTools.every((t: ToolThing) => t.data.name.startsWith('git_'))).toBe(true)
  })

  it('should exclude soft-deleted tools from queries by default', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not implemented')
    }

    const store = new graphModule.ToolStore({})

    await store.createTool({ name: 'activeTool', description: 'Active', category: 'test' })
    await store.createTool({ name: 'deletedTool', description: 'Deleted', category: 'test' })
    await store.deleteTool('tool:deletedTool')

    const tools = await store.findTools({ category: 'test' })

    const deletedInResults = tools.find((t: ToolThing) => t.data.name === 'deletedTool')
    expect(deletedInResults).toBeUndefined()
  })

  it('should support limit and offset for pagination', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not implemented')
    }

    const store = new graphModule.ToolStore({})

    for (let i = 0; i < 10; i++) {
      await store.createTool({
        name: `paginatedTool${i}`,
        description: `Tool ${i}`,
        category: 'paginate',
      })
    }

    const page1 = await store.findTools({ category: 'paginate', limit: 3, offset: 0 })
    const page2 = await store.findTools({ category: 'paginate', limit: 3, offset: 3 })

    expect(page1).toHaveLength(3)
    expect(page2).toHaveLength(3)

    const page1Names = page1.map((t: ToolThing) => t.data.name)
    const page2Names = page2.map((t: ToolThing) => t.data.name)
    const overlap = page1Names.filter((name: string) => page2Names.includes(name))
    expect(overlap).toHaveLength(0)
  })

  it('should list all tools', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not implemented')
    }

    const store = new graphModule.ToolStore({})

    await store.createTool({ name: 'listTool1', description: 'Tool 1' })
    await store.createTool({ name: 'listTool2', description: 'Tool 2' })
    await store.createTool({ name: 'listTool3', description: 'Tool 3' })

    const tools = await store.listTools()

    expect(tools.length).toBeGreaterThanOrEqual(3)
  })
})

// ============================================================================
// TOOL INVOCATION LIFECYCLE TESTS
// ============================================================================

describe('Tool Invocation Lifecycle', () => {
  it('should create invoke relationship (invoke state)', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore || !graphModule?.RelationshipsStore) {
      throw new Error('ToolStore or RelationshipsStore not implemented')
    }

    const toolStore = new graphModule.ToolStore({})
    const relStore = new graphModule.RelationshipsStore({})

    const tool = await toolStore.createTool({
      name: 'invocableTool',
      description: 'A tool to invoke',
    })

    // Create invocation relationship with 'invoke' verb
    const invocation = await relStore.create({
      id: 'inv-1',
      verb: 'invoke',
      from: 'do://agents/agent-1',
      to: `do://tools/${tool.data.name}`,
      data: {
        input: { query: 'test' },
        requestedAt: Date.now(),
      },
    })

    expect(invocation).toBeDefined()
    expect(invocation.verb).toBe('invoke')
  })

  it('should transition to invoking state', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore || !graphModule?.RelationshipsStore) {
      throw new Error('ToolStore or RelationshipsStore not implemented')
    }

    const toolStore = new graphModule.ToolStore({})
    const relStore = new graphModule.RelationshipsStore({})

    const tool = await toolStore.createTool({
      name: 'invokingTool',
      description: 'Tool in invoking state',
    })

    // Create invocation in 'invoking' state (in progress)
    const invocation = await relStore.create({
      id: 'inv-2',
      verb: 'invoking',
      from: 'do://agents/agent-1',
      to: `do://tools/${tool.data.name}`,
      data: {
        input: { query: 'test' },
        startedAt: Date.now(),
      },
    })

    expect(invocation).toBeDefined()
    expect(invocation.verb).toBe('invoking')
  })

  it('should transition to invoked state (completed)', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore || !graphModule?.RelationshipsStore) {
      throw new Error('ToolStore or RelationshipsStore not implemented')
    }

    const toolStore = new graphModule.ToolStore({})
    const relStore = new graphModule.RelationshipsStore({})

    const tool = await toolStore.createTool({
      name: 'invokedTool',
      description: 'Tool that was invoked',
    })

    // Create invocation in 'invoked' state (completed)
    const invocation = await relStore.create({
      id: 'inv-3',
      verb: 'invoked',
      from: 'do://agents/agent-1',
      to: `do://tools/${tool.data.name}`,
      data: {
        input: { query: 'test' },
        output: { results: [] },
        startedAt: Date.now() - 1000,
        completedAt: Date.now(),
      },
    })

    expect(invocation).toBeDefined()
    expect(invocation.verb).toBe('invoked')
  })

  it('should query invocations by tool', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore || !graphModule?.RelationshipsStore) {
      throw new Error('ToolStore or RelationshipsStore not implemented')
    }

    const toolStore = new graphModule.ToolStore({})
    const relStore = new graphModule.RelationshipsStore({})

    const tool = await toolStore.createTool({
      name: 'queryInvocationsTool',
      description: 'Tool for querying invocations',
    })

    // Create multiple invocations
    await relStore.create({
      id: 'inv-query-1',
      verb: 'invoked',
      from: 'do://agents/agent-1',
      to: `do://tools/${tool.data.name}`,
      data: { input: { x: 1 } },
    })

    await relStore.create({
      id: 'inv-query-2',
      verb: 'invoked',
      from: 'do://agents/agent-2',
      to: `do://tools/${tool.data.name}`,
      data: { input: { x: 2 } },
    })

    // Query invocations for this tool
    const invocations = await relStore.queryByTo(`do://tools/${tool.data.name}`, { verb: 'invoked' })

    expect(invocations.length).toBeGreaterThanOrEqual(2)
  })

  it('should query invocations by agent', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore || !graphModule?.RelationshipsStore) {
      throw new Error('ToolStore or RelationshipsStore not implemented')
    }

    const toolStore = new graphModule.ToolStore({})
    const relStore = new graphModule.RelationshipsStore({})

    await toolStore.createTool({ name: 'agentInvoke1', description: 'Tool 1' })
    await toolStore.createTool({ name: 'agentInvoke2', description: 'Tool 2' })

    // Create invocations from same agent
    await relStore.create({
      id: 'inv-agent-1',
      verb: 'invoked',
      from: 'do://agents/agent-tracker',
      to: 'do://tools/agentInvoke1',
      data: {},
    })

    await relStore.create({
      id: 'inv-agent-2',
      verb: 'invoked',
      from: 'do://agents/agent-tracker',
      to: 'do://tools/agentInvoke2',
      data: {},
    })

    // Query all invocations by this agent
    const invocations = await relStore.queryByFrom('do://agents/agent-tracker', { verb: 'invoked' })

    expect(invocations.length).toBeGreaterThanOrEqual(2)
  })
})

// ============================================================================
// PROVIDER INTEGRATION TESTS
// ============================================================================

describe('Provider Integration', () => {
  it('should create Tool providedBy Provider relationship', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore || !graphModule?.RelationshipsStore) {
      throw new Error('ToolStore or RelationshipsStore not implemented')
    }

    const toolStore = new graphModule.ToolStore({})
    const relStore = new graphModule.RelationshipsStore({})

    // Create a tool with provider
    const tool = await toolStore.createTool({
      name: 'anthropic_claude',
      description: 'Claude conversation tool',
      providerId: 'provider:anthropic',
    })

    // Create providedBy relationship
    const rel = await relStore.create({
      id: 'rel-provider-1',
      verb: 'providedBy',
      from: `do://tools/${tool.data.name}`,
      to: 'do://providers/anthropic',
      data: {
        apiVersion: '2024-01-01',
        model: 'claude-3-opus',
      },
    })

    expect(rel).toBeDefined()
    expect(rel.verb).toBe('providedBy')
  })

  it('should find tools by provider', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore || !graphModule?.RelationshipsStore) {
      throw new Error('ToolStore or RelationshipsStore not implemented')
    }

    const toolStore = new graphModule.ToolStore({})
    const relStore = new graphModule.RelationshipsStore({})

    // Create tools from different providers
    await toolStore.createTool({
      name: 'openai_gpt4',
      description: 'GPT-4 tool',
      providerId: 'provider:openai',
    })

    await toolStore.createTool({
      name: 'anthropic_claude',
      description: 'Claude tool',
      providerId: 'provider:anthropic',
    })

    await relStore.create({
      id: 'rel-openai',
      verb: 'providedBy',
      from: 'do://tools/openai_gpt4',
      to: 'do://providers/openai',
    })

    await relStore.create({
      id: 'rel-anthropic',
      verb: 'providedBy',
      from: 'do://tools/anthropic_claude',
      to: 'do://providers/anthropic',
    })

    // Query tools from OpenAI provider
    const openaiTools = await relStore.queryByTo('do://providers/openai', { verb: 'providedBy' })

    expect(openaiTools.length).toBe(1)
    expect(openaiTools[0].from).toBe('do://tools/openai_gpt4')
  })

  it('should find tools by providerId field', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not implemented')
    }

    const store = new graphModule.ToolStore({})

    await store.createTool({
      name: 'providerTool1',
      description: 'Tool 1',
      providerId: 'provider:test',
    })

    await store.createTool({
      name: 'providerTool2',
      description: 'Tool 2',
      providerId: 'provider:test',
    })

    await store.createTool({
      name: 'providerTool3',
      description: 'Tool 3',
      providerId: 'provider:other',
    })

    const tools = await store.findTools({ providerId: 'provider:test' })

    expect(tools.length).toBe(2)
    expect(tools.every((t: ToolThing) => t.data.providerId === 'provider:test')).toBe(true)
  })
})

// ============================================================================
// MCP FORMAT CONVERSION TESTS
// ============================================================================

describe('MCP Format Conversion', () => {
  describe('toolThingToMcp', () => {
    it('should convert ToolThing to MCP format', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore || !graphModule?.toolThingToMcp) {
        throw new Error('ToolStore or toolThingToMcp not implemented')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.createTool({
        name: 'mcpTool',
        description: 'Tool for MCP conversion',
        parameters: [
          { name: 'query', type: 'string', description: 'Search query', required: true },
          { name: 'limit', type: 'number', description: 'Max results', required: false },
        ],
      })

      const mcpTool = graphModule.toolThingToMcp(tool)

      expect(mcpTool.name).toBe('mcpTool')
      expect(mcpTool.description).toBe('Tool for MCP conversion')
      expect(mcpTool.inputSchema.type).toBe('object')
      expect(mcpTool.inputSchema.properties.query).toBeDefined()
      expect(mcpTool.inputSchema.properties.query.type).toBe('string')
      expect(mcpTool.inputSchema.properties.query.description).toBe('Search query')
      expect(mcpTool.inputSchema.required).toContain('query')
      expect(mcpTool.inputSchema.required).not.toContain('limit')
    })

    it('should handle tool with no parameters', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore || !graphModule?.toolThingToMcp) {
        throw new Error('ToolStore or toolThingToMcp not implemented')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.createTool({
        name: 'noParamsTool',
        description: 'Tool without parameters',
        parameters: [],
      })

      const mcpTool = graphModule.toolThingToMcp(tool)

      expect(mcpTool.inputSchema.properties).toEqual({})
      expect(mcpTool.inputSchema.required).toBeUndefined()
    })

    it('should include annotations from tool metadata', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore || !graphModule?.toolThingToMcp) {
        throw new Error('ToolStore or toolThingToMcp not implemented')
      }

      const store = new graphModule.ToolStore({})
      const tool = await store.createTool({
        name: 'annotatedTool',
        description: 'Tool with annotations',
        category: 'graph',
        version: '2.0.0',
        destructive: true,
      })

      const mcpTool = graphModule.toolThingToMcp(tool)

      expect(mcpTool.annotations).toBeDefined()
      expect(mcpTool.annotations.category).toBe('graph')
      expect(mcpTool.annotations.version).toBe('2.0.0')
      expect(mcpTool.annotations.destructive).toBe(true)
    })
  })

  describe('mcpToToolThing', () => {
    it('should convert MCP tool to ToolThing data format', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.mcpToToolThing) {
        throw new Error('mcpToToolThing not implemented')
      }

      const mcpTool = {
        name: 'mcpInput',
        description: 'MCP input tool',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results' },
          },
          required: ['query'],
        },
      }

      const toolData = graphModule.mcpToToolThing(mcpTool)

      expect(toolData.name).toBe('mcpInput')
      expect(toolData.description).toBe('MCP input tool')
      expect(toolData.parameters).toHaveLength(2)
      expect(toolData.parameters[0].name).toBe('query')
      expect(toolData.parameters[0].type).toBe('string')
      expect(toolData.parameters[0].required).toBe(true)
      expect(toolData.parameters[1].name).toBe('limit')
      expect(toolData.parameters[1].required).toBe(false)
    })

    it('should handle MCP tool with no required fields', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.mcpToToolThing) {
        throw new Error('mcpToToolThing not implemented')
      }

      const mcpTool = {
        name: 'optionalTool',
        description: 'All optional params',
        inputSchema: {
          type: 'object' as const,
          properties: {
            optional1: { type: 'string' },
            optional2: { type: 'number' },
          },
        },
      }

      const toolData = graphModule.mcpToToolThing(mcpTool)

      expect(toolData.parameters.every((p: ToolParameter) => p.required === false)).toBe(true)
    })

    it('should handle MCP tool with annotations', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.mcpToToolThing) {
        throw new Error('mcpToToolThing not implemented')
      }

      const mcpTool = {
        name: 'annotatedMcpTool',
        description: 'MCP tool with annotations',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
        annotations: {
          category: 'test',
          version: '1.0.0',
          destructive: false,
        },
      }

      const toolData = graphModule.mcpToToolThing(mcpTool)

      expect(toolData.category).toBe('test')
      expect(toolData.version).toBe('1.0.0')
      expect(toolData.destructive).toBe(false)
    })
  })

  describe('Round-trip conversion', () => {
    it('should preserve data through toolThing -> MCP -> toolThing conversion', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.ToolStore || !graphModule?.toolThingToMcp || !graphModule?.mcpToToolThing) {
        throw new Error('Conversion functions not implemented')
      }

      const store = new graphModule.ToolStore({})
      const original = await store.createTool({
        name: 'roundTripTool',
        description: 'Round trip test',
        parameters: [
          { name: 'arg1', type: 'string', description: 'First arg', required: true },
          { name: 'arg2', type: 'number', description: 'Second arg', required: false },
        ],
        category: 'test',
        version: '1.0.0',
      })

      // Convert to MCP and back
      const mcpTool = graphModule.toolThingToMcp(original)
      const roundTripped = graphModule.mcpToToolThing(mcpTool)

      expect(roundTripped.name).toBe(original.data.name)
      expect(roundTripped.description).toBe(original.data.description)
      expect(roundTripped.parameters).toHaveLength(original.data.parameters.length)
      expect(roundTripped.category).toBe(original.data.category)
      expect(roundTripped.version).toBe(original.data.version)
    })
  })
})

// ============================================================================
// PERMISSION CHECKING TESTS
// ============================================================================

describe('Tool Permission Checks', () => {
  it('should check if agent can use tool based on security level', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore || !graphModule?.canAgentUseTool) {
      throw new Error('ToolStore or canAgentUseTool not implemented')
    }

    const store = new graphModule.ToolStore({})

    await store.createTool({
      name: 'publicTool',
      description: 'Public tool',
      securityLevel: 'public',
    })

    await store.createTool({
      name: 'restrictedTool',
      description: 'Restricted tool',
      securityLevel: 'restricted',
    })

    // Public tools should be accessible to all
    const canUsePublic = await graphModule.canAgentUseTool(
      { type: 'external' },
      'tool:publicTool',
      store
    )
    expect(canUsePublic.allowed).toBe(true)

    // Restricted tools should not be accessible to external agents
    const canUseRestricted = await graphModule.canAgentUseTool(
      { type: 'external' },
      'tool:restrictedTool',
      store
    )
    expect(canUseRestricted.allowed).toBe(false)
  })

  it('should allow internal agents to use restricted tools', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore || !graphModule?.canAgentUseTool) {
      throw new Error('ToolStore or canAgentUseTool not implemented')
    }

    const store = new graphModule.ToolStore({})

    await store.createTool({
      name: 'internalOnlyTool',
      description: 'Internal only',
      securityLevel: 'restricted',
    })

    const canUse = await graphModule.canAgentUseTool(
      { type: 'internal' },
      'tool:internalOnlyTool',
      store
    )

    expect(canUse.allowed).toBe(true)
  })

  it('should block critical tools for non-system agents', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore || !graphModule?.canAgentUseTool) {
      throw new Error('ToolStore or canAgentUseTool not implemented')
    }

    const store = new graphModule.ToolStore({})

    await store.createTool({
      name: 'criticalTool',
      description: 'Critical system tool',
      securityLevel: 'critical',
    })

    // Internal agent cannot use critical tools
    const internalResult = await graphModule.canAgentUseTool(
      { type: 'internal' },
      'tool:criticalTool',
      store
    )
    expect(internalResult.allowed).toBe(false)

    // System agent can use critical tools
    const systemResult = await graphModule.canAgentUseTool(
      { type: 'system' },
      'tool:criticalTool',
      store
    )
    expect(systemResult.allowed).toBe(true)
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Tool Edge Cases', () => {
  it('should handle empty parameters array', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not implemented')
    }

    const store = new graphModule.ToolStore({})

    const tool = await store.createTool({
      name: 'noParamsTool',
      description: 'Tool without parameters',
      parameters: [],
    })

    expect(tool.data.parameters).toEqual([])
  })

  it('should handle special characters in tool name', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not implemented')
    }

    const store = new graphModule.ToolStore({})

    const tool = await store.createTool({
      name: 'tool_with.dots-and_underscores',
      description: 'Tool with special chars',
    })

    const retrieved = await store.getToolByName('tool_with.dots-and_underscores')
    expect(retrieved?.data.name).toBe('tool_with.dots-and_underscores')
  })

  it('should handle Unicode in description', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not implemented')
    }

    const store = new graphModule.ToolStore({})

    const tool = await store.createTool({
      name: 'unicodeTool',
      description: 'Description with Unicode characters and special text',
    })

    expect(tool.data.description).toBe('Description with Unicode characters and special text')
  })

  it('should preserve parameter schema', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.ToolStore) {
      throw new Error('ToolStore not implemented')
    }

    const store = new graphModule.ToolStore({})

    const complexSchema = {
      type: 'object',
      properties: {
        nested: { type: 'object' },
        array: { type: 'array', items: { type: 'string' } },
      },
    }

    const tool = await store.createTool({
      name: 'schemaTool',
      description: 'Tool with complex schema',
      parameters: [
        {
          name: 'complexArg',
          type: 'object',
          description: 'Complex argument',
          schema: complexSchema,
        },
      ],
    })

    expect(tool.data.parameters[0].schema).toEqual(complexSchema)
  })
})

// ============================================================================
// CONSTANTS EXPORT TESTS
// ============================================================================

describe('Tool Constants', () => {
  it('should export TOOL_TYPE_ID', async () => {
    const graphModule = await import('../index').catch(() => null)
    expect(graphModule?.TOOL_TYPE_ID).toBeDefined()
    expect(typeof graphModule?.TOOL_TYPE_ID).toBe('number')
  })

  it('should export TOOL_TYPE_NAME', async () => {
    const graphModule = await import('../index').catch(() => null)
    expect(graphModule?.TOOL_TYPE_NAME).toBeDefined()
    expect(graphModule?.TOOL_TYPE_NAME).toBe('Tool')
  })
})
