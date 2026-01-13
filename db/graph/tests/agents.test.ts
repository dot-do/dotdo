/**
 * Agents as Graph Things - Comprehensive Tests
 *
 * Tests for the complete Agent graph model including:
 * - Agent Thing CRUD operations
 * - Memory Thing for agent memories
 * - Conversation Thing for conversation threads
 * - Relationships: HAS_TOOL, HAS_MEMORY, PARTICIPATES_IN, HANDED_OFF_TO, SPAWNED
 *
 * @see dotdo-ucolo - Agents as Graph Things (Epic)
 *
 * IMPORTANT: NO MOCKS - Uses real in-memory stores for testing.
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// AGENT THING TESTS
// ============================================================================

describe('Agent Thing', () => {
  describe('CRUD Operations', () => {
    it('creates an agent with required fields', async () => {
      const { createAgentThing, AGENT_TYPE_NAME } = await import('../agent-thing')

      const agent = await createAgentThing({}, {
        name: 'test-engineer',
        persona: {
          role: 'engineering',
          name: 'Test Engineer',
          description: 'A test engineering agent',
        },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      expect(agent).toBeDefined()
      expect(agent.typeName).toBe(AGENT_TYPE_NAME)
      expect(agent.data.persona.role).toBe('engineering')
      expect(agent.data.model).toBe('claude-sonnet-4-20250514')
      expect(agent.data.mode).toBe('autonomous')
      expect(agent.id).toBe('https://agents.do/test-engineer')
    })

    it('creates an agent with optional tools', async () => {
      const { createAgentThing } = await import('../agent-thing')

      const agent = await createAgentThing({}, {
        name: 'tooled-agent',
        persona: {
          role: 'engineering',
          name: 'Tooled Agent',
          description: 'Agent with tools',
        },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
        tools: ['tool-execute', 'tool-search', 'tool-write'],
      })

      expect(agent.data.tools).toEqual(['tool-execute', 'tool-search', 'tool-write'])
    })

    it('creates an agent with optional instructions', async () => {
      const { createAgentThing } = await import('../agent-thing')

      const instructions = 'You are a specialized TypeScript expert.'
      const agent = await createAgentThing({}, {
        name: 'instructed-agent',
        persona: {
          role: 'engineering',
          name: 'Instructed Agent',
          description: 'Agent with custom instructions',
        },
        model: 'claude-sonnet-4-20250514',
        mode: 'supervised',
        instructions,
      })

      expect(agent.data.instructions).toBe(instructions)
    })

    it('validates mode is one of autonomous, supervised, manual', async () => {
      const { createAgentThing } = await import('../agent-thing')

      await expect(
        createAgentThing({}, {
          name: 'invalid-mode-agent',
          persona: { role: 'engineering', name: 'Test', description: 'Test' },
          model: 'claude-sonnet-4-20250514',
          mode: 'invalid' as any,
        })
      ).rejects.toThrow('Invalid agent mode')
    })

    it('validates role is a known role type', async () => {
      const { createAgentThing } = await import('../agent-thing')

      await expect(
        createAgentThing({}, {
          name: 'invalid-role-agent',
          persona: { role: 'invalid' as any, name: 'Test', description: 'Test' },
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
        })
      ).rejects.toThrow('Invalid agent role')
    })

    it('retrieves agent by name', async () => {
      const { createAgentThing, getAgentThing } = await import('../agent-thing')

      await createAgentThing({}, {
        name: 'retrievable-agent',
        persona: { role: 'product', name: 'Retrievable', description: 'Can be retrieved' },
        model: 'gpt-4',
        mode: 'autonomous',
      })

      const retrieved = await getAgentThing({}, 'retrievable-agent')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.data.persona.name).toBe('Retrievable')
    })

    it('returns null for non-existent agent', async () => {
      const { getAgentThing } = await import('../agent-thing')

      const result = await getAgentThing({}, 'non-existent-agent-xyz')
      expect(result).toBeNull()
    })

    it('updates agent model', async () => {
      const { createAgentThing, updateAgentThing, getAgentThing } = await import('../agent-thing')

      await createAgentThing({}, {
        name: 'update-model-agent',
        persona: { role: 'engineering', name: 'Update Model', description: 'For testing updates' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      const updated = await updateAgentThing({}, 'update-model-agent', {
        model: 'gpt-4-turbo',
      })

      expect(updated?.data.model).toBe('gpt-4-turbo')

      const retrieved = await getAgentThing({}, 'update-model-agent')
      expect(retrieved?.data.model).toBe('gpt-4-turbo')
    })

    it('updates agent mode', async () => {
      const { createAgentThing, updateAgentThing } = await import('../agent-thing')

      await createAgentThing({}, {
        name: 'update-mode-agent',
        persona: { role: 'engineering', name: 'Update Mode', description: 'For testing mode updates' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      const updated = await updateAgentThing({}, 'update-mode-agent', {
        mode: 'supervised',
      })

      expect(updated?.data.mode).toBe('supervised')
    })

    it('soft deletes an agent', async () => {
      const { createAgentThing, deleteAgentThing, getAgentThing } = await import('../agent-thing')

      await createAgentThing({}, {
        name: 'delete-agent',
        persona: { role: 'qa', name: 'Delete Test', description: 'For testing deletion' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      const deleted = await deleteAgentThing({}, 'delete-agent')
      expect(deleted?.deletedAt).not.toBeNull()

      // Should still be retrievable (soft delete)
      const retrieved = await getAgentThing({}, 'delete-agent')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.deletedAt).not.toBeNull()
    })
  })

  describe('Named Agents', () => {
    it('registers all named agents', async () => {
      const { registerNamedAgents, getAgentThing, NAMED_AGENTS } = await import('../agent-thing')

      await registerNamedAgents({})

      for (const name of NAMED_AGENTS) {
        const agent = await getAgentThing({}, name)
        expect(agent).not.toBeNull()
      }
    })

    it('priya is a product agent', async () => {
      const { registerNamedAgents, getAgentThing } = await import('../agent-thing')

      await registerNamedAgents({})

      const priya = await getAgentThing({}, 'priya')
      expect(priya?.data.persona.role).toBe('product')
      expect(priya?.data.persona.name).toBe('Priya')
      expect(priya?.id).toBe('https://agents.do/priya')
    })

    it('ralph is an engineering agent', async () => {
      const { registerNamedAgents, getAgentThing } = await import('../agent-thing')

      await registerNamedAgents({})

      const ralph = await getAgentThing({}, 'ralph')
      expect(ralph?.data.persona.role).toBe('engineering')
      expect(ralph?.data.persona.name).toBe('Ralph')
    })

    it('tom is a tech-lead agent', async () => {
      const { registerNamedAgents, getAgentThing } = await import('../agent-thing')

      await registerNamedAgents({})

      const tom = await getAgentThing({}, 'tom')
      expect(tom?.data.persona.role).toBe('tech-lead')
      expect(tom?.data.persona.name).toBe('Tom')
    })

    it('named agents have default model claude-sonnet-4-20250514', async () => {
      const { registerNamedAgents, getAgentThing, NAMED_AGENTS } = await import('../agent-thing')

      await registerNamedAgents({})

      for (const name of NAMED_AGENTS) {
        const agent = await getAgentThing({}, name)
        expect(agent?.data.model).toBe('claude-sonnet-4-20250514')
      }
    })

    it('named agents are autonomous by default', async () => {
      const { registerNamedAgents, getAgentThing, NAMED_AGENTS } = await import('../agent-thing')

      await registerNamedAgents({})

      for (const name of NAMED_AGENTS) {
        const agent = await getAgentThing({}, name)
        expect(agent?.data.mode).toBe('autonomous')
      }
    })
  })

  describe('Query Operations', () => {
    it('gets all agents', async () => {
      const { createAgentThing, getAllAgents } = await import('../agent-thing')

      // Create a few agents
      await createAgentThing({}, {
        name: 'query-all-1',
        persona: { role: 'engineering', name: 'Query 1', description: 'Test 1' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })
      await createAgentThing({}, {
        name: 'query-all-2',
        persona: { role: 'product', name: 'Query 2', description: 'Test 2' },
        model: 'gpt-4',
        mode: 'supervised',
      })

      const allAgents = await getAllAgents({})
      expect(allAgents.length).toBeGreaterThanOrEqual(2)
      expect(allAgents.every((a) => a.typeName === 'Agent')).toBe(true)
    })

    it('gets agents by role', async () => {
      const { createAgentThing, getAgentsByRole } = await import('../agent-thing')

      // Create agents with different roles
      await createAgentThing({}, {
        name: 'role-eng-1',
        persona: { role: 'engineering', name: 'Eng 1', description: 'Engineer 1' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })
      await createAgentThing({}, {
        name: 'role-eng-2',
        persona: { role: 'engineering', name: 'Eng 2', description: 'Engineer 2' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })
      await createAgentThing({}, {
        name: 'role-prod-1',
        persona: { role: 'product', name: 'Prod 1', description: 'Product 1' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      const engineers = await getAgentsByRole({}, 'engineering')
      expect(engineers.length).toBeGreaterThanOrEqual(2)
      expect(engineers.every((a) => a.data.persona.role === 'engineering')).toBe(true)
    })
  })

  describe('Type Guards', () => {
    it('isAgentThing correctly identifies agent things', async () => {
      const { createAgentThing, isAgentThing } = await import('../agent-thing')

      const agent = await createAgentThing({}, {
        name: 'type-guard-agent',
        persona: { role: 'qa', name: 'Type Guard', description: 'For type checking' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      expect(isAgentThing(agent)).toBe(true)
    })

    it('isAgentThingData validates data structure', async () => {
      const { isAgentThingData } = await import('../agent-thing')

      expect(isAgentThingData({
        persona: { role: 'engineering', name: 'Test', description: 'Test' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })).toBe(true)

      expect(isAgentThingData({})).toBe(false)
      expect(isAgentThingData({ model: 'x' })).toBe(false)
      expect(isAgentThingData(null)).toBe(false)
    })
  })
})

// ============================================================================
// MEMORY THING TESTS
// ============================================================================

describe('Memory Thing', () => {
  describe('CRUD Operations', () => {
    it('creates a memory with required fields', async () => {
      const { createMemory, MEMORY_TYPE_NAME } = await import('../agents/memory')

      const memory = await createMemory({}, {
        agentId: 'https://agents.do/ralph',
        kind: 'episodic',
        content: 'User requested TypeScript refactoring for auth module.',
      })

      expect(memory).toBeDefined()
      expect(memory.typeName).toBe(MEMORY_TYPE_NAME)
      expect(memory.data.agentId).toBe('https://agents.do/ralph')
      expect(memory.data.kind).toBe('episodic')
      expect(memory.data.content).toContain('TypeScript')
    })

    it('creates a memory with optional fields', async () => {
      const { createMemory } = await import('../agents/memory')

      const memory = await createMemory({}, {
        agentId: 'https://agents.do/priya',
        kind: 'semantic',
        content: 'User prefers detailed explanations with code examples.',
        importance: 0.9,
        tags: ['preferences', 'communication'],
        context: 'Product planning session',
      })

      expect(memory.data.importance).toBe(0.9)
      expect(memory.data.tags).toEqual(['preferences', 'communication'])
      expect(memory.data.context).toBe('Product planning session')
    })

    it('retrieves a memory by ID', async () => {
      const { createMemory, getMemory } = await import('../agents/memory')

      const created = await createMemory({}, {
        agentId: 'https://agents.do/tom',
        kind: 'procedural',
        content: 'When reviewing code, always check for TypeScript strict mode.',
      })

      const retrieved = await getMemory({}, created.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.data.content).toContain('TypeScript strict mode')
    })

    it('returns null for non-existent memory', async () => {
      const { getMemory } = await import('../agents/memory')

      const result = await getMemory({}, 'non-existent-memory-id')
      expect(result).toBeNull()
    })

    it('updates memory importance', async () => {
      const { createMemory, updateMemory } = await import('../agents/memory')

      const created = await createMemory({}, {
        agentId: 'https://agents.do/ralph',
        kind: 'episodic',
        content: 'Important event to remember.',
        importance: 0.5,
      })

      const updated = await updateMemory({}, created.id, { importance: 0.95 })
      expect(updated?.data.importance).toBe(0.95)
    })

    it('deletes a memory', async () => {
      const { createMemory, deleteMemory, getMemory } = await import('../agents/memory')

      const created = await createMemory({}, {
        agentId: 'https://agents.do/quinn',
        kind: 'episodic',
        content: 'Memory to delete.',
      })

      const deleted = await deleteMemory({}, created.id)
      expect(deleted?.deletedAt).not.toBeNull()
    })
  })

  describe('Query Operations', () => {
    it('gets memories by agent', async () => {
      const { createMemory, getMemoriesByAgent } = await import('../agents/memory')

      const agentId = 'https://agents.do/test-memory-agent'

      await createMemory({}, {
        agentId,
        kind: 'episodic',
        content: 'Memory 1 for agent.',
      })
      await createMemory({}, {
        agentId,
        kind: 'semantic',
        content: 'Memory 2 for agent.',
      })
      await createMemory({}, {
        agentId: 'https://agents.do/other-agent',
        kind: 'episodic',
        content: 'Memory for different agent.',
      })

      const memories = await getMemoriesByAgent({}, agentId)
      expect(memories.length).toBeGreaterThanOrEqual(2)
      expect(memories.every((m) => m.data.agentId === agentId)).toBe(true)
    })

    it('filters memories by kind', async () => {
      const { createMemory, getMemoriesByAgent } = await import('../agents/memory')

      const agentId = 'https://agents.do/memory-kind-agent'

      await createMemory({}, { agentId, kind: 'episodic', content: 'Episodic memory.' })
      await createMemory({}, { agentId, kind: 'semantic', content: 'Semantic memory.' })
      await createMemory({}, { agentId, kind: 'procedural', content: 'Procedural memory.' })

      const episodic = await getMemoriesByAgent({}, agentId, { kind: 'episodic' })
      expect(episodic.every((m) => m.data.kind === 'episodic')).toBe(true)
    })

    it('searches memories by content', async () => {
      const { createMemory, searchMemories } = await import('../agents/memory')

      await createMemory({}, {
        agentId: 'https://agents.do/search-agent',
        kind: 'episodic',
        content: 'User asked about TypeScript generics implementation.',
        tags: ['typescript', 'generics'],
      })
      await createMemory({}, {
        agentId: 'https://agents.do/search-agent',
        kind: 'semantic',
        content: 'Python is good for data science.',
        tags: ['python', 'data'],
      })

      const results = await searchMemories({}, 'TypeScript')
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results.some((m) => m.data.content.includes('TypeScript'))).toBe(true)
    })

    it('searches memories by tags', async () => {
      const { createMemory, searchMemories } = await import('../agents/memory')

      await createMemory({}, {
        agentId: 'https://agents.do/tag-search-agent',
        kind: 'semantic',
        content: 'Some content about databases.',
        tags: ['database', 'postgres'],
      })

      const results = await searchMemories({}, 'postgres')
      expect(results.some((m) => m.data.tags?.includes('postgres'))).toBe(true)
    })
  })

  describe('Memory Types', () => {
    it('supports conversation memory kind', async () => {
      const { createMemory } = await import('../agents/memory')

      const memory = await createMemory({}, {
        agentId: 'https://agents.do/ralph',
        kind: 'conversation',
        content: 'Context from planning discussion.',
        conversationId: 'conv-12345',
      })

      expect(memory.data.kind).toBe('conversation')
      expect(memory.data.conversationId).toBe('conv-12345')
    })

    it('supports episodic memory kind', async () => {
      const { createMemory } = await import('../agents/memory')

      const memory = await createMemory({}, {
        agentId: 'https://agents.do/priya',
        kind: 'episodic',
        content: 'User mentioned they prefer dark mode.',
      })

      expect(memory.data.kind).toBe('episodic')
    })

    it('supports semantic memory kind', async () => {
      const { createMemory } = await import('../agents/memory')

      const memory = await createMemory({}, {
        agentId: 'https://agents.do/tom',
        kind: 'semantic',
        content: 'TypeScript strict null checks prevent runtime errors.',
      })

      expect(memory.data.kind).toBe('semantic')
    })

    it('supports procedural memory kind', async () => {
      const { createMemory } = await import('../agents/memory')

      const memory = await createMemory({}, {
        agentId: 'https://agents.do/quinn',
        kind: 'procedural',
        content: 'To run tests: npm test. To build: npm run build.',
      })

      expect(memory.data.kind).toBe('procedural')
    })
  })

  describe('Type Guards', () => {
    it('isMemoryThing correctly identifies memory things', async () => {
      const { createMemory, isMemoryThing } = await import('../agents/memory')

      const memory = await createMemory({}, {
        agentId: 'https://agents.do/ralph',
        kind: 'episodic',
        content: 'Test memory.',
      })

      expect(isMemoryThing(memory)).toBe(true)
    })

    it('isMemoryThingData validates data structure', async () => {
      const { isMemoryThingData } = await import('../agents/memory')

      expect(isMemoryThingData({
        agentId: 'agent-1',
        kind: 'episodic',
        content: 'Test content',
      })).toBe(true)

      expect(isMemoryThingData({})).toBe(false)
      expect(isMemoryThingData({ agentId: 'x' })).toBe(false)
      expect(isMemoryThingData(null)).toBe(false)
    })
  })
})

// ============================================================================
// CONVERSATION THING TESTS
// ============================================================================

describe('Conversation Thing', () => {
  describe('CRUD Operations', () => {
    it('creates a conversation', async () => {
      const { createConversation, CONVERSATION_TYPE_NAME, CONVERSATION_STATUS } = await import('../agents/conversation')

      const conversation = await createConversation({}, {
        title: 'Feature Planning',
        participants: ['https://agents.do/priya', 'https://agents.do/ralph'],
        userId: 'user-123',
      })

      expect(conversation).toBeDefined()
      expect(conversation.typeName).toBe(CONVERSATION_TYPE_NAME)
      expect(conversation.data.title).toBe('Feature Planning')
      expect(conversation.data.status).toBe(CONVERSATION_STATUS.ACTIVE)
      expect(conversation.data.participants).toContain('https://agents.do/priya')
      expect(conversation.data.participants).toContain('https://agents.do/ralph')
    })

    it('retrieves a conversation by ID', async () => {
      const { createConversation, getConversation } = await import('../agents/conversation')

      const created = await createConversation({}, {
        title: 'Code Review Session',
        participants: ['https://agents.do/tom'],
      })

      const retrieved = await getConversation({}, created.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.data.title).toBe('Code Review Session')
    })

    it('returns null for non-existent conversation', async () => {
      const { getConversation } = await import('../agents/conversation')

      const result = await getConversation({}, 'non-existent-conv')
      expect(result).toBeNull()
    })

    it('adds an agent to a conversation', async () => {
      const { createConversation, addAgentToConversation } = await import('../agents/conversation')

      const created = await createConversation({}, {
        title: 'Planning',
        participants: ['https://agents.do/priya'],
      })

      const updated = await addAgentToConversation({}, created.id, 'https://agents.do/ralph')
      expect(updated?.data.participants).toContain('https://agents.do/ralph')
    })

    it('removes an agent from a conversation', async () => {
      const { createConversation, removeAgentFromConversation } = await import('../agents/conversation')

      const created = await createConversation({}, {
        title: 'Team Meeting',
        participants: ['https://agents.do/priya', 'https://agents.do/ralph', 'https://agents.do/tom'],
      })

      const updated = await removeAgentFromConversation({}, created.id, 'https://agents.do/ralph')
      expect(updated?.data.participants).not.toContain('https://agents.do/ralph')
      expect(updated?.data.participants).toContain('https://agents.do/priya')
    })

    it('adds a message to a conversation', async () => {
      const { createConversation, addMessageToConversation } = await import('../agents/conversation')

      const created = await createConversation({}, {
        title: 'Discussion',
        participants: ['https://agents.do/ralph'],
      })

      const updated = await addMessageToConversation({}, created.id, {
        role: 'user',
        content: 'Can you help me with TypeScript?',
      })

      expect(updated?.data.messages.length).toBe(1)
      expect(updated?.data.messages[0].content).toBe('Can you help me with TypeScript?')
      expect(updated?.data.messageCount).toBe(1)
    })

    it('updates conversation status', async () => {
      const { createConversation, updateConversationStatus, CONVERSATION_STATUS } = await import('../agents/conversation')

      const created = await createConversation({}, {
        title: 'Completed Task',
        participants: ['https://agents.do/quinn'],
      })

      const updated = await updateConversationStatus({}, created.id, CONVERSATION_STATUS.COMPLETED)
      expect(updated?.data.status).toBe(CONVERSATION_STATUS.COMPLETED)
    })

    it('deletes a conversation', async () => {
      const { createConversation, deleteConversation } = await import('../agents/conversation')

      const created = await createConversation({}, {
        title: 'To Delete',
        participants: [],
      })

      const deleted = await deleteConversation({}, created.id)
      expect(deleted?.deletedAt).not.toBeNull()
    })
  })

  describe('Query Operations', () => {
    it('gets conversations by agent', async () => {
      const { createConversation, getAgentConversations } = await import('../agents/conversation')

      const agentId = 'https://agents.do/conv-query-agent'

      await createConversation({}, {
        title: 'Conv 1',
        participants: [agentId, 'https://agents.do/other'],
      })
      await createConversation({}, {
        title: 'Conv 2',
        participants: [agentId],
      })
      await createConversation({}, {
        title: 'Conv 3 - Other',
        participants: ['https://agents.do/other'],
      })

      const conversations = await getAgentConversations({}, agentId)
      expect(conversations.length).toBeGreaterThanOrEqual(2)
      expect(conversations.every((c) => c.data.participants.includes(agentId))).toBe(true)
    })

    it('gets active conversations', async () => {
      const {
        createConversation,
        getActiveConversations,
        updateConversationStatus,
        CONVERSATION_STATUS,
      } = await import('../agents/conversation')

      const conv1 = await createConversation({}, {
        title: 'Active Conv',
        participants: ['https://agents.do/active-agent'],
        userId: 'user-active-test',
      })

      const conv2 = await createConversation({}, {
        title: 'Completed Conv',
        participants: ['https://agents.do/active-agent'],
        userId: 'user-active-test',
      })
      await updateConversationStatus({}, conv2.id, CONVERSATION_STATUS.COMPLETED)

      const active = await getActiveConversations({}, { userId: 'user-active-test' })
      expect(active.every((c) => c.data.status === CONVERSATION_STATUS.ACTIVE)).toBe(true)
    })
  })

  describe('Conversation Status', () => {
    it('supports active status', async () => {
      const { createConversation, CONVERSATION_STATUS } = await import('../agents/conversation')

      const conv = await createConversation({}, { title: 'Active', participants: [] })
      expect(conv.data.status).toBe(CONVERSATION_STATUS.ACTIVE)
    })

    it('supports paused status', async () => {
      const { createConversation, updateConversationStatus, CONVERSATION_STATUS } = await import('../agents/conversation')

      const conv = await createConversation({}, { title: 'To Pause', participants: [] })
      const paused = await updateConversationStatus({}, conv.id, CONVERSATION_STATUS.PAUSED)
      expect(paused?.data.status).toBe(CONVERSATION_STATUS.PAUSED)
    })

    it('supports completed status', async () => {
      const { createConversation, updateConversationStatus, CONVERSATION_STATUS } = await import('../agents/conversation')

      const conv = await createConversation({}, { title: 'To Complete', participants: [] })
      const completed = await updateConversationStatus({}, conv.id, CONVERSATION_STATUS.COMPLETED)
      expect(completed?.data.status).toBe(CONVERSATION_STATUS.COMPLETED)
    })

    it('supports archived status', async () => {
      const { createConversation, updateConversationStatus, CONVERSATION_STATUS } = await import('../agents/conversation')

      const conv = await createConversation({}, { title: 'To Archive', participants: [] })
      const archived = await updateConversationStatus({}, conv.id, CONVERSATION_STATUS.ARCHIVED)
      expect(archived?.data.status).toBe(CONVERSATION_STATUS.ARCHIVED)
    })
  })

  describe('Type Guards', () => {
    it('isConversationThing correctly identifies conversation things', async () => {
      const { createConversation, isConversationThing } = await import('../agents/conversation')

      const conv = await createConversation({}, {
        title: 'Type Test',
        participants: [],
      })

      expect(isConversationThing(conv)).toBe(true)
    })

    it('isConversationThingData validates data structure', async () => {
      const { isConversationThingData } = await import('../agents/conversation')

      expect(isConversationThingData({
        status: 'active',
        participants: [],
        messages: [],
      })).toBe(true)

      expect(isConversationThingData({})).toBe(false)
      expect(isConversationThingData({ status: 'active' })).toBe(false)
      expect(isConversationThingData(null)).toBe(false)
    })
  })
})

// ============================================================================
// RELATIONSHIP TESTS
// ============================================================================

describe('Agent Relationships', () => {
  describe('Tool Relationships (HAS_TOOL)', () => {
    it('adds a tool to an agent', async () => {
      const { addToolToAgent, getAgentTools } = await import('../agents/relationships')

      const agentId = 'https://agents.do/tool-agent'
      const toolId = 'tool-code-execute'

      await addToolToAgent({}, agentId, toolId, { permission: 'auto' })

      const tools = await getAgentTools({}, agentId)
      expect(tools.some((t) => t.toolId === toolId)).toBe(true)
    })

    it('removes a tool from an agent', async () => {
      const { addToolToAgent, removeToolFromAgent, getAgentTools } = await import('../agents/relationships')

      const agentId = 'https://agents.do/tool-remove-agent'
      const toolId = 'tool-to-remove'

      await addToolToAgent({}, agentId, toolId)
      await removeToolFromAgent({}, agentId, toolId)

      const tools = await getAgentTools({}, agentId)
      expect(tools.some((t) => t.toolId === toolId)).toBe(false)
    })

    it('checks if agent has a tool', async () => {
      const { addToolToAgent, agentHasTool } = await import('../agents/relationships')

      const agentId = 'https://agents.do/has-tool-agent'
      const toolId = 'tool-check'

      await addToolToAgent({}, agentId, toolId)

      expect(await agentHasTool({}, agentId, toolId)).toBe(true)
      expect(await agentHasTool({}, agentId, 'non-existent-tool')).toBe(false)
    })

    it('stores tool permission level', async () => {
      const { addToolToAgent, getAgentTools } = await import('../agents/relationships')

      const agentId = 'https://agents.do/permission-agent'
      const toolId = 'tool-confirm'

      await addToolToAgent({}, agentId, toolId, { permission: 'confirm' })

      const tools = await getAgentTools({}, agentId)
      const tool = tools.find((t) => t.toolId === toolId)
      expect(tool?.permission).toBe('confirm')
    })
  })

  describe('Memory Relationships (HAS_MEMORY)', () => {
    it('links a memory to an agent', async () => {
      const { linkMemoryToAgent, unlinkMemoryFromAgent } = await import('../agents/relationships')

      const agentId = 'https://agents.do/memory-link-agent'
      const memoryId = 'memory-123'

      await linkMemoryToAgent({}, agentId, memoryId)

      // Should not throw when linking
      expect(true).toBe(true)

      // Unlink should return true
      const unlinked = await unlinkMemoryFromAgent({}, agentId, memoryId)
      expect(unlinked).toBe(true)
    })
  })

  describe('Conversation Relationships (PARTICIPATES_IN)', () => {
    it('links a conversation to an agent', async () => {
      const { linkConversationToAgent, getConversationParticipants } = await import('../agents/relationships')

      const agentId = 'https://agents.do/conv-link-agent'
      const conversationId = 'conv-456'

      await linkConversationToAgent({}, agentId, conversationId, { role: 'assistant' })

      const participants = await getConversationParticipants({}, conversationId)
      expect(participants.some((p) => p.agentId === agentId)).toBe(true)
    })

    it('gets conversation participants', async () => {
      const { linkConversationToAgent, getConversationParticipants } = await import('../agents/relationships')

      const conversationId = 'conv-participants-test'

      await linkConversationToAgent({}, 'https://agents.do/part-1', conversationId)
      await linkConversationToAgent({}, 'https://agents.do/part-2', conversationId)

      const participants = await getConversationParticipants({}, conversationId)
      expect(participants.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Handoff Relationships (HANDED_OFF_TO)', () => {
    it('records a handoff between agents', async () => {
      const { recordHandoff, getHandoffHistory } = await import('../agents/relationships')

      const fromAgent = 'https://agents.do/handoff-from'
      const toAgent = 'https://agents.do/handoff-to'

      await recordHandoff({}, fromAgent, toAgent, {
        reason: 'Needs technical expertise',
        conversationId: 'conv-handoff',
      })

      const history = await getHandoffHistory({}, fromAgent, 'from')
      expect(history.some((h) => h.toAgentId === toAgent)).toBe(true)
    })

    it('gets handoff history from perspective', async () => {
      const { recordHandoff, getHandoffHistory } = await import('../agents/relationships')

      const agent1 = 'https://agents.do/history-agent-1'
      const agent2 = 'https://agents.do/history-agent-2'

      await recordHandoff({}, agent1, agent2, { reason: 'Test handoff' })

      const fromHistory = await getHandoffHistory({}, agent1, 'from')
      expect(fromHistory.some((h) => h.toAgentId === agent2)).toBe(true)

      const toHistory = await getHandoffHistory({}, agent2, 'to')
      expect(toHistory.some((h) => h.fromAgentId === agent1)).toBe(true)
    })
  })

  describe('Spawn Relationships (SPAWNED)', () => {
    it('records a spawn relationship', async () => {
      const { recordSpawn, getSpawnedAgents } = await import('../agents/relationships')

      const parentAgent = 'https://agents.do/parent-agent'
      const childAgent = 'https://agents.do/child-agent'

      await recordSpawn({}, parentAgent, childAgent, {
        task: 'Run tests in parallel',
        conversationId: 'conv-spawn',
      })

      const spawned = await getSpawnedAgents({}, parentAgent)
      expect(spawned.some((s) => s.childAgentId === childAgent)).toBe(true)
    })

    it('gets parent agent', async () => {
      const { recordSpawn, getParentAgent } = await import('../agents/relationships')

      const parent = 'https://agents.do/spawn-parent'
      const child = 'https://agents.do/spawn-child'

      await recordSpawn({}, parent, child, { task: 'Subtask' })

      const parentId = await getParentAgent({}, child)
      expect(parentId).toBe(parent)
    })

    it('returns null for agent without parent', async () => {
      const { getParentAgent } = await import('../agents/relationships')

      const parentId = await getParentAgent({}, 'https://agents.do/no-parent-agent')
      expect(parentId).toBeNull()
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Agent Graph Integration', () => {
  it('creates an agent with memories', async () => {
    const { createAgentThing } = await import('../agent-thing')
    const { createMemory, getMemoriesByAgent } = await import('../agents/memory')

    const agent = await createAgentThing({}, {
      name: 'memory-integrated-agent',
      persona: { role: 'engineering', name: 'Memory Agent', description: 'Agent with memories' },
      model: 'claude-sonnet-4-20250514',
      mode: 'autonomous',
    })

    // Create memories for the agent
    await createMemory({}, {
      agentId: agent.id,
      kind: 'episodic',
      content: 'User prefers detailed code comments.',
    })
    await createMemory({}, {
      agentId: agent.id,
      kind: 'semantic',
      content: 'TypeScript is the primary language for this project.',
    })

    const memories = await getMemoriesByAgent({}, agent.id)
    expect(memories.length).toBeGreaterThanOrEqual(2)
  })

  it('creates an agent participating in conversations', async () => {
    const { createAgentThing } = await import('../agent-thing')
    const { createConversation, getAgentConversations } = await import('../agents/conversation')

    const agent = await createAgentThing({}, {
      name: 'conv-integrated-agent',
      persona: { role: 'product', name: 'Conv Agent', description: 'Agent in conversations' },
      model: 'claude-sonnet-4-20250514',
      mode: 'autonomous',
    })

    // Create conversations with the agent
    await createConversation({}, {
      title: 'Planning Session',
      participants: [agent.id],
    })
    await createConversation({}, {
      title: 'Review Meeting',
      participants: [agent.id, 'https://agents.do/other'],
    })

    const conversations = await getAgentConversations({}, agent.id)
    expect(conversations.length).toBeGreaterThanOrEqual(2)
  })

  it('supports agent handoff workflow', async () => {
    const { createAgentThing, getAgentThing } = await import('../agent-thing')
    const { recordHandoff, getHandoffHistory } = await import('../agents/relationships')

    // Create two agents
    const priya = await createAgentThing({}, {
      name: 'handoff-priya',
      persona: { role: 'product', name: 'Priya', description: 'Product manager' },
      model: 'claude-sonnet-4-20250514',
      mode: 'autonomous',
    })

    const ralph = await createAgentThing({}, {
      name: 'handoff-ralph',
      persona: { role: 'engineering', name: 'Ralph', description: 'Engineer' },
      model: 'claude-sonnet-4-20250514',
      mode: 'autonomous',
    })

    // Record handoff from Priya to Ralph
    await recordHandoff({}, priya.id, ralph.id, {
      reason: 'Spec is ready, handing off for implementation',
      conversationId: 'conv-handoff-workflow',
    })

    // Verify handoff history
    const priyaHandoffs = await getHandoffHistory({}, priya.id, 'from')
    expect(priyaHandoffs.some((h) => h.toAgentId === ralph.id)).toBe(true)

    const ralphReceived = await getHandoffHistory({}, ralph.id, 'to')
    expect(ralphReceived.some((h) => h.fromAgentId === priya.id)).toBe(true)
  })

  it('supports named agent workflow', async () => {
    const { registerNamedAgents, getAgentThing } = await import('../agent-thing')
    const { recordHandoff, getHandoffHistory } = await import('../agents/relationships')

    // Register named agents
    await registerNamedAgents({})

    // Get named agents
    const priya = await getAgentThing({}, 'priya')
    const ralph = await getAgentThing({}, 'ralph')
    const tom = await getAgentThing({}, 'tom')

    expect(priya).not.toBeNull()
    expect(ralph).not.toBeNull()
    expect(tom).not.toBeNull()

    // Verify roles
    expect(priya?.data.persona.role).toBe('product')
    expect(ralph?.data.persona.role).toBe('engineering')
    expect(tom?.data.persona.role).toBe('tech-lead')
  })
})
