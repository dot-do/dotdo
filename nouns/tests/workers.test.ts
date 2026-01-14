import { describe, it, expect, beforeAll } from 'vitest'
import { z } from 'zod'

/**
 * Worker Nouns Validation Tests
 *
 * RED phase TDD - comprehensive tests for Worker, Agent, Human, Team nouns.
 * Tests schema validation, type guards, inheritance, and edge cases.
 *
 * These tests may expose issues with:
 * - Type/const name collisions (type Worker vs const Worker)
 * - Schema inheritance via .extend()
 * - Type guard edge cases
 * - Default value application
 * - $type literal validation
 */

// ============================================================================
// Dynamic Imports - Tests fail gracefully until modules exist
// ============================================================================

let WorkerSchema: z.ZodType | undefined
let AgentSchema: z.ZodType | undefined
let HumanSchema: z.ZodType | undefined
let TeamSchema: z.ZodType | undefined
let WorkerNoun: unknown
let AgentNoun: unknown
let HumanNoun: unknown
let TeamNoun: unknown
let isWorker: ((obj: unknown) => boolean) | undefined
let isAgent: ((obj: unknown) => boolean) | undefined
let isHuman: ((obj: unknown) => boolean) | undefined
let isTeam: ((obj: unknown) => boolean) | undefined

beforeAll(async () => {
  try {
    const module = await import('../workers/')
    WorkerSchema = module.WorkerSchema
    AgentSchema = module.AgentSchema
    HumanSchema = module.HumanSchema
    TeamSchema = module.TeamSchema
    WorkerNoun = module.Worker
    AgentNoun = module.Agent
    HumanNoun = module.Human
    TeamNoun = module.Team
    isWorker = module.isWorker
    isAgent = module.isAgent
    isHuman = module.isHuman
    isTeam = module.isTeam
  } catch (e) {
    console.error('Failed to import workers module:', e)
  }
})

// ============================================================================
// Helper Functions
// ============================================================================

function createValidWorker(overrides?: Record<string, unknown>) {
  return {
    $id: 'https://api.dotdo.dev/workers/worker-001',
    $type: 'https://schema.org.ai/Worker',
    name: 'Test Worker',
    skills: ['coding', 'testing'],
    status: 'available',
    ...overrides,
  }
}

function createValidAgent(overrides?: Record<string, unknown>) {
  return {
    $id: 'https://api.dotdo.dev/agents/agent-001',
    $type: 'https://schema.org.ai/Agent',
    name: 'Test Agent',
    skills: ['coding', 'testing'],
    status: 'available',
    model: 'claude-3-opus',
    tools: ['code_execution', 'web_search'],
    autonomous: false,
    ...overrides,
  }
}

function createValidHuman(overrides?: Record<string, unknown>) {
  return {
    $id: 'https://api.dotdo.dev/humans/human-001',
    $type: 'https://schema.org.ai/Human',
    name: 'Test Human',
    skills: ['management', 'review'],
    status: 'available',
    requiresApproval: true,
    notificationChannels: ['email', 'slack'],
    ...overrides,
  }
}

function createValidTeam(overrides?: Record<string, unknown>) {
  return {
    $id: 'https://api.dotdo.dev/teams/team-001',
    $type: 'https://schema.org.ai/Team',
    name: 'Test Team',
    members: ['agent-001', 'human-001'],
    ...overrides,
  }
}

// ============================================================================
// 1. Module Export Tests
// ============================================================================

describe('Module Exports', () => {
  describe('Schema Exports', () => {
    it('WorkerSchema is exported and is a Zod schema', () => {
      expect(WorkerSchema).toBeDefined()
      expect(WorkerSchema).toHaveProperty('safeParse')
      expect(WorkerSchema).toHaveProperty('parse')
    })

    it('AgentSchema is exported and is a Zod schema', () => {
      expect(AgentSchema).toBeDefined()
      expect(AgentSchema).toHaveProperty('safeParse')
      expect(AgentSchema).toHaveProperty('parse')
    })

    it('HumanSchema is exported and is a Zod schema', () => {
      expect(HumanSchema).toBeDefined()
      expect(HumanSchema).toHaveProperty('safeParse')
      expect(HumanSchema).toHaveProperty('parse')
    })

    it('TeamSchema is exported and is a Zod schema', () => {
      expect(TeamSchema).toBeDefined()
      expect(TeamSchema).toHaveProperty('safeParse')
      expect(TeamSchema).toHaveProperty('parse')
    })
  })

  describe('Noun Definition Exports', () => {
    it('Worker noun definition is exported', () => {
      expect(WorkerNoun).toBeDefined()
      expect(WorkerNoun).toHaveProperty('noun')
      expect(WorkerNoun).toHaveProperty('plural')
      expect(WorkerNoun).toHaveProperty('$type')
      expect(WorkerNoun).toHaveProperty('schema')
    })

    it('Agent noun definition is exported', () => {
      expect(AgentNoun).toBeDefined()
      expect(AgentNoun).toHaveProperty('noun')
      expect(AgentNoun).toHaveProperty('plural')
      expect(AgentNoun).toHaveProperty('$type')
      expect(AgentNoun).toHaveProperty('schema')
    })

    it('Human noun definition is exported', () => {
      expect(HumanNoun).toBeDefined()
      expect(HumanNoun).toHaveProperty('noun')
      expect(HumanNoun).toHaveProperty('plural')
      expect(HumanNoun).toHaveProperty('$type')
      expect(HumanNoun).toHaveProperty('schema')
    })

    it('Team noun definition is exported', () => {
      expect(TeamNoun).toBeDefined()
      expect(TeamNoun).toHaveProperty('noun')
      expect(TeamNoun).toHaveProperty('plural')
      expect(TeamNoun).toHaveProperty('$type')
      expect(TeamNoun).toHaveProperty('schema')
    })
  })

  describe('Type Guard Exports', () => {
    it('isWorker is exported and is a function', () => {
      expect(isWorker).toBeDefined()
      expect(typeof isWorker).toBe('function')
    })

    it('isAgent is exported and is a function', () => {
      expect(isAgent).toBeDefined()
      expect(typeof isAgent).toBe('function')
    })

    it('isHuman is exported and is a function', () => {
      expect(isHuman).toBeDefined()
      expect(typeof isHuman).toBe('function')
    })

    it('isTeam is exported and is a function', () => {
      expect(isTeam).toBeDefined()
      expect(typeof isTeam).toBe('function')
    })
  })
})

// ============================================================================
// 2. Worker Schema Validation Tests
// ============================================================================

describe('Worker Schema Validation', () => {
  describe('Valid Worker Data', () => {
    it('validates minimal valid worker', () => {
      const worker = createValidWorker()
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(true)
    })

    it('validates worker with all required fields', () => {
      const worker = {
        $id: 'https://api.dotdo.dev/workers/w1',
        $type: 'https://schema.org.ai/Worker',
        name: 'Alice',
        skills: [],
        status: 'available',
      }
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(true)
    })

    it('validates worker with status: available', () => {
      const worker = createValidWorker({ status: 'available' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(true)
    })

    it('validates worker with status: busy', () => {
      const worker = createValidWorker({ status: 'busy' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(true)
    })

    it('validates worker with status: away', () => {
      const worker = createValidWorker({ status: 'away' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(true)
    })

    it('validates worker with status: offline', () => {
      const worker = createValidWorker({ status: 'offline' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(true)
    })

    it('validates worker with empty skills array', () => {
      const worker = createValidWorker({ skills: [] })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(true)
    })

    it('validates worker with multiple skills', () => {
      const worker = createValidWorker({
        skills: ['python', 'javascript', 'typescript', 'rust'],
      })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(true)
    })
  })

  describe('Invalid Worker Data', () => {
    it('rejects worker missing $id', () => {
      const worker = createValidWorker()
      delete (worker as Record<string, unknown>).$id
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('rejects worker missing $type', () => {
      const worker = createValidWorker()
      delete (worker as Record<string, unknown>).$type
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('rejects worker missing name', () => {
      const worker = createValidWorker()
      delete (worker as Record<string, unknown>).name
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('rejects worker missing skills', () => {
      const worker = createValidWorker()
      delete (worker as Record<string, unknown>).skills
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('rejects worker missing status', () => {
      const worker = createValidWorker()
      delete (worker as Record<string, unknown>).status
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('rejects worker with invalid status value', () => {
      const worker = createValidWorker({ status: 'invalid' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('rejects worker with status: active (wrong enum)', () => {
      const worker = createValidWorker({ status: 'active' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('rejects worker with status: online (wrong enum)', () => {
      const worker = createValidWorker({ status: 'online' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('rejects worker with null name', () => {
      const worker = createValidWorker({ name: null })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('rejects worker with number as name', () => {
      const worker = createValidWorker({ name: 12345 })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('rejects worker with skills as string instead of array', () => {
      const worker = createValidWorker({ skills: 'coding' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('rejects worker with skills containing non-strings', () => {
      const worker = createValidWorker({ skills: ['coding', 123, true] })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })
  })

  describe('$type Literal Validation', () => {
    it('rejects worker with wrong $type', () => {
      const worker = createValidWorker({ $type: 'https://schema.org.ai/Agent' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('rejects worker with partial $type', () => {
      const worker = createValidWorker({ $type: 'Worker' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('rejects worker with lowercase $type', () => {
      const worker = createValidWorker({ $type: 'https://schema.org.ai/worker' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('rejects worker with empty $type', () => {
      const worker = createValidWorker({ $type: '' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// 3. Agent Schema Validation Tests
// ============================================================================

describe('Agent Schema Validation', () => {
  describe('Valid Agent Data', () => {
    it('validates minimal valid agent', () => {
      const agent = createValidAgent()
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('validates agent with all required fields', () => {
      const agent = {
        $id: 'https://api.dotdo.dev/agents/a1',
        $type: 'https://schema.org.ai/Agent',
        name: 'Claude',
        skills: ['coding'],
        status: 'available',
        model: 'claude-3-opus',
        tools: [],
        autonomous: true,
      }
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('validates agent with optional systemPrompt', () => {
      const agent = createValidAgent({
        systemPrompt: 'You are a helpful assistant.',
      })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('validates agent with optional temperature', () => {
      const agent = createValidAgent({ temperature: 0.7 })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('validates agent with temperature at min boundary (0)', () => {
      const agent = createValidAgent({ temperature: 0 })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('validates agent with temperature at max boundary (1)', () => {
      const agent = createValidAgent({ temperature: 1 })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('validates agent with optional maxTokens', () => {
      const agent = createValidAgent({ maxTokens: 4096 })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('validates agent with autonomous: true', () => {
      const agent = createValidAgent({ autonomous: true })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('validates agent with autonomous: false', () => {
      const agent = createValidAgent({ autonomous: false })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('validates agent with empty tools array', () => {
      const agent = createValidAgent({ tools: [] })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('validates agent with multiple tools', () => {
      const agent = createValidAgent({
        tools: ['code_execution', 'web_search', 'file_access', 'bash'],
      })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('validates agent with all optional fields', () => {
      const agent = createValidAgent({
        systemPrompt: 'You are helpful.',
        temperature: 0.5,
        maxTokens: 2048,
      })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })
  })

  describe('Invalid Agent Data', () => {
    it('rejects agent missing model', () => {
      const agent = createValidAgent()
      delete (agent as Record<string, unknown>).model
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })

    it('rejects agent missing tools', () => {
      const agent = createValidAgent()
      delete (agent as Record<string, unknown>).tools
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })

    it('rejects agent missing autonomous', () => {
      const agent = createValidAgent()
      delete (agent as Record<string, unknown>).autonomous
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })

    it('rejects agent with temperature below 0', () => {
      const agent = createValidAgent({ temperature: -0.1 })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })

    it('rejects agent with temperature above 1', () => {
      const agent = createValidAgent({ temperature: 1.1 })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })

    it('rejects agent with temperature: 2', () => {
      const agent = createValidAgent({ temperature: 2 })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })

    it('rejects agent with autonomous as string', () => {
      const agent = createValidAgent({ autonomous: 'true' })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })

    it('rejects agent with tools as string instead of array', () => {
      const agent = createValidAgent({ tools: 'bash' })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })

    it('rejects agent with null model', () => {
      const agent = createValidAgent({ model: null })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })
  })

  describe('$type Literal Validation', () => {
    it('rejects agent with Worker $type', () => {
      const agent = createValidAgent({ $type: 'https://schema.org.ai/Worker' })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })

    it('rejects agent with Human $type', () => {
      const agent = createValidAgent({ $type: 'https://schema.org.ai/Human' })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })

    it('validates agent with correct $type literal', () => {
      const agent = createValidAgent({ $type: 'https://schema.org.ai/Agent' })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })
  })

  describe('Schema Inheritance from Worker', () => {
    it('agent inherits $id from Worker', () => {
      const agent = createValidAgent()
      delete (agent as Record<string, unknown>).$id
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })

    it('agent inherits name from Worker', () => {
      const agent = createValidAgent()
      delete (agent as Record<string, unknown>).name
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })

    it('agent inherits skills from Worker', () => {
      const agent = createValidAgent()
      delete (agent as Record<string, unknown>).skills
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })

    it('agent inherits status enum from Worker', () => {
      const agent = createValidAgent({ status: 'offline' })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('agent rejects invalid status inherited from Worker', () => {
      const agent = createValidAgent({ status: 'invalid' })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// 4. Human Schema Validation Tests
// ============================================================================

describe('Human Schema Validation', () => {
  describe('Valid Human Data', () => {
    it('validates minimal valid human', () => {
      const human = createValidHuman()
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })

    it('validates human with all required fields', () => {
      const human = {
        $id: 'https://api.dotdo.dev/humans/h1',
        $type: 'https://schema.org.ai/Human',
        name: 'Bob',
        skills: ['review'],
        status: 'available',
        requiresApproval: true,
        notificationChannels: ['email'],
      }
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })

    it('validates human with optional email', () => {
      const human = createValidHuman({ email: 'bob@example.com' })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })

    it('validates human with optional timezone', () => {
      const human = createValidHuman({ timezone: 'America/New_York' })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })

    it('validates human with optional workingHours', () => {
      const human = createValidHuman({
        workingHours: { start: '09:00', end: '17:00' },
      })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })

    it('validates human with optional preferredLanguage', () => {
      const human = createValidHuman({ preferredLanguage: 'en' })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })

    it('validates human with requiresApproval: true', () => {
      const human = createValidHuman({ requiresApproval: true })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })

    it('validates human with requiresApproval: false', () => {
      const human = createValidHuman({ requiresApproval: false })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })

    it('validates human with multiple notification channels', () => {
      const human = createValidHuman({
        notificationChannels: ['email', 'slack', 'sms'],
      })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })

    it('validates human with all optional fields', () => {
      const human = createValidHuman({
        email: 'bob@example.com',
        timezone: 'UTC',
        workingHours: { start: '08:00', end: '18:00' },
        preferredLanguage: 'en-US',
      })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })
  })

  describe('Invalid Human Data', () => {
    it('rejects human missing requiresApproval', () => {
      const human = createValidHuman()
      delete (human as Record<string, unknown>).requiresApproval
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(false)
    })

    it('rejects human missing notificationChannels', () => {
      const human = createValidHuman()
      delete (human as Record<string, unknown>).notificationChannels
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(false)
    })

    it('rejects human with invalid email format', () => {
      const human = createValidHuman({ email: 'invalid-email' })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(false)
    })

    it('rejects human with email missing @ symbol', () => {
      const human = createValidHuman({ email: 'bob.example.com' })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(false)
    })

    it('rejects human with requiresApproval as string', () => {
      const human = createValidHuman({ requiresApproval: 'true' })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(false)
    })

    it('rejects human with notificationChannels as string', () => {
      const human = createValidHuman({ notificationChannels: 'email' })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(false)
    })

    it('rejects human with workingHours missing start', () => {
      const human = createValidHuman({ workingHours: { end: '17:00' } })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(false)
    })

    it('rejects human with workingHours missing end', () => {
      const human = createValidHuman({ workingHours: { start: '09:00' } })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(false)
    })
  })

  describe('$type Literal Validation', () => {
    it('rejects human with Worker $type', () => {
      const human = createValidHuman({ $type: 'https://schema.org.ai/Worker' })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(false)
    })

    it('rejects human with Agent $type', () => {
      const human = createValidHuman({ $type: 'https://schema.org.ai/Agent' })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(false)
    })

    it('validates human with correct $type literal', () => {
      const human = createValidHuman({ $type: 'https://schema.org.ai/Human' })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })
  })

  describe('Schema Inheritance from Worker', () => {
    it('human inherits $id from Worker', () => {
      const human = createValidHuman()
      delete (human as Record<string, unknown>).$id
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(false)
    })

    it('human inherits name from Worker', () => {
      const human = createValidHuman()
      delete (human as Record<string, unknown>).name
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(false)
    })

    it('human inherits skills from Worker', () => {
      const human = createValidHuman()
      delete (human as Record<string, unknown>).skills
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(false)
    })

    it('human inherits status enum from Worker', () => {
      const human = createValidHuman({ status: 'busy' })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })

    it('human rejects invalid status inherited from Worker', () => {
      const human = createValidHuman({ status: 'active' })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// 5. Team Schema Validation Tests
// ============================================================================

describe('Team Schema Validation', () => {
  describe('Valid Team Data', () => {
    it('validates minimal valid team', () => {
      const team = createValidTeam()
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team with all required fields', () => {
      const team = {
        $id: 'https://api.dotdo.dev/teams/t1',
        $type: 'https://schema.org.ai/Team',
        name: 'Engineering Team',
        members: ['agent-001'],
      }
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team with optional description', () => {
      const team = createValidTeam({ description: 'The best team' })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team with optional lead', () => {
      const team = createValidTeam({ lead: 'human-001' })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team with optional skills', () => {
      const team = createValidTeam({ skills: ['coding', 'design'] })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team with status: active', () => {
      const team = createValidTeam({ status: 'active' })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team with status: inactive', () => {
      const team = createValidTeam({ status: 'inactive' })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team with status: forming', () => {
      const team = createValidTeam({ status: 'forming' })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team with optional goals', () => {
      const team = createValidTeam({ goals: ['Ship v2.0', 'Reduce bugs'] })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team with optional channels', () => {
      const team = createValidTeam({
        channels: [
          { type: 'slack', identifier: '#engineering' },
          { type: 'email', identifier: 'team@example.com' },
        ],
      })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team with optional capacity', () => {
      const team = createValidTeam({ capacity: 10 })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team with optional workload', () => {
      const team = createValidTeam({ workload: 5 })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team with empty members array', () => {
      const team = createValidTeam({ members: [] })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team with all optional fields', () => {
      const team = createValidTeam({
        description: 'Full team',
        lead: 'human-001',
        skills: ['coding'],
        status: 'active',
        goals: ['Ship'],
        channels: [{ type: 'slack', identifier: '#team' }],
        capacity: 10,
        workload: 3,
      })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })
  })

  describe('Invalid Team Data', () => {
    it('rejects team missing $id', () => {
      const team = createValidTeam()
      delete (team as Record<string, unknown>).$id
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(false)
    })

    it('rejects team missing $type', () => {
      const team = createValidTeam()
      delete (team as Record<string, unknown>).$type
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(false)
    })

    it('rejects team missing name', () => {
      const team = createValidTeam()
      delete (team as Record<string, unknown>).name
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(false)
    })

    it('rejects team missing members', () => {
      const team = createValidTeam()
      delete (team as Record<string, unknown>).members
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(false)
    })

    it('rejects team with invalid status', () => {
      const team = createValidTeam({ status: 'invalid' })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(false)
    })

    it('rejects team with status: available (wrong enum)', () => {
      const team = createValidTeam({ status: 'available' })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(false)
    })

    it('rejects team with members as string', () => {
      const team = createValidTeam({ members: 'agent-001' })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(false)
    })

    it('rejects team with invalid channel type', () => {
      const team = createValidTeam({
        channels: [{ type: 'invalid', identifier: '#team' }],
      })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(false)
    })

    it('rejects team with channel missing identifier', () => {
      const team = createValidTeam({
        channels: [{ type: 'slack' }],
      })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(false)
    })

    it('rejects team with channel missing type', () => {
      const team = createValidTeam({
        channels: [{ identifier: '#team' }],
      })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(false)
    })
  })

  describe('$type Literal Validation', () => {
    it('rejects team with Worker $type', () => {
      const team = createValidTeam({ $type: 'https://schema.org.ai/Worker' })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(false)
    })

    it('rejects team with Agent $type', () => {
      const team = createValidTeam({ $type: 'https://schema.org.ai/Agent' })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(false)
    })

    it('validates team with correct $type literal', () => {
      const team = createValidTeam({ $type: 'https://schema.org.ai/Team' })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })
  })

  describe('Team Channel Types', () => {
    it('validates channel type: slack', () => {
      const team = createValidTeam({
        channels: [{ type: 'slack', identifier: '#channel' }],
      })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates channel type: email', () => {
      const team = createValidTeam({
        channels: [{ type: 'email', identifier: 'team@example.com' }],
      })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates channel type: discord', () => {
      const team = createValidTeam({
        channels: [{ type: 'discord', identifier: '#server' }],
      })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates channel type: teams', () => {
      const team = createValidTeam({
        channels: [{ type: 'teams', identifier: 'Engineering' }],
      })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates channel type: other', () => {
      const team = createValidTeam({
        channels: [{ type: 'other', identifier: 'custom-channel' }],
      })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// 6. Type Guard Tests
// ============================================================================

describe('Type Guards', () => {
  describe('isWorker', () => {
    it('returns true for valid Worker', () => {
      const worker = createValidWorker()
      expect(isWorker!(worker)).toBe(true)
    })

    it('returns false for Agent (different $type)', () => {
      const agent = createValidAgent()
      expect(isWorker!(agent)).toBe(false)
    })

    it('returns false for Human (different $type)', () => {
      const human = createValidHuman()
      expect(isWorker!(human)).toBe(false)
    })

    it('returns false for Team', () => {
      const team = createValidTeam()
      expect(isWorker!(team)).toBe(false)
    })

    it('returns false for null', () => {
      expect(isWorker!(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isWorker!(undefined)).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(isWorker!({})).toBe(false)
    })

    it('returns false for string', () => {
      expect(isWorker!('worker')).toBe(false)
    })

    it('returns false for number', () => {
      expect(isWorker!(123)).toBe(false)
    })

    it('returns false for array', () => {
      expect(isWorker!([])).toBe(false)
    })

    it('returns false for partial Worker (missing fields)', () => {
      expect(isWorker!({ $id: 'test', $type: 'https://schema.org.ai/Worker' })).toBe(false)
    })
  })

  describe('isAgent', () => {
    it('returns true for valid Agent', () => {
      const agent = createValidAgent()
      expect(isAgent!(agent)).toBe(true)
    })

    it('returns false for Worker (missing agent fields)', () => {
      const worker = createValidWorker()
      expect(isAgent!(worker)).toBe(false)
    })

    it('returns false for Human', () => {
      const human = createValidHuman()
      expect(isAgent!(human)).toBe(false)
    })

    it('returns false for Team', () => {
      const team = createValidTeam()
      expect(isAgent!(team)).toBe(false)
    })

    it('returns false for null', () => {
      expect(isAgent!(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isAgent!(undefined)).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(isAgent!({})).toBe(false)
    })

    it('returns false for Worker with Agent $type but missing agent fields', () => {
      const invalidAgent = {
        ...createValidWorker(),
        $type: 'https://schema.org.ai/Agent',
      }
      expect(isAgent!(invalidAgent)).toBe(false)
    })
  })

  describe('isHuman', () => {
    it('returns true for valid Human', () => {
      const human = createValidHuman()
      expect(isHuman!(human)).toBe(true)
    })

    it('returns false for Worker (missing human fields)', () => {
      const worker = createValidWorker()
      expect(isHuman!(worker)).toBe(false)
    })

    it('returns false for Agent', () => {
      const agent = createValidAgent()
      expect(isHuman!(agent)).toBe(false)
    })

    it('returns false for Team', () => {
      const team = createValidTeam()
      expect(isHuman!(team)).toBe(false)
    })

    it('returns false for null', () => {
      expect(isHuman!(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isHuman!(undefined)).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(isHuman!({})).toBe(false)
    })

    it('returns false for Worker with Human $type but missing human fields', () => {
      const invalidHuman = {
        ...createValidWorker(),
        $type: 'https://schema.org.ai/Human',
      }
      expect(isHuman!(invalidHuman)).toBe(false)
    })
  })

  describe('isTeam', () => {
    it('returns true for valid Team', () => {
      const team = createValidTeam()
      expect(isTeam!(team)).toBe(true)
    })

    it('returns false for Worker', () => {
      const worker = createValidWorker()
      expect(isTeam!(worker)).toBe(false)
    })

    it('returns false for Agent', () => {
      const agent = createValidAgent()
      expect(isTeam!(agent)).toBe(false)
    })

    it('returns false for Human', () => {
      const human = createValidHuman()
      expect(isTeam!(human)).toBe(false)
    })

    it('returns false for null', () => {
      expect(isTeam!(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isTeam!(undefined)).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(isTeam!({})).toBe(false)
    })
  })

  describe('Type Guard Edge Cases', () => {
    it('isWorker rejects object with correct $type but wrong structure', () => {
      const invalidWorker = {
        $id: 'test',
        $type: 'https://schema.org.ai/Worker',
        // missing name, skills, status
      }
      expect(isWorker!(invalidWorker)).toBe(false)
    })

    it('type guards handle frozen objects', () => {
      const worker = Object.freeze(createValidWorker())
      expect(isWorker!(worker)).toBe(true)
    })

    it('type guards handle objects with prototype chain', () => {
      class WorkerClass {
        $id = 'https://api.dotdo.dev/workers/w1'
        $type = 'https://schema.org.ai/Worker' as const
        name = 'Test'
        skills = ['coding']
        status = 'available' as const
      }
      const worker = new WorkerClass()
      expect(isWorker!(worker)).toBe(true)
    })

    it('type guards handle objects with extra properties', () => {
      const workerWithExtra = {
        ...createValidWorker(),
        extraField: 'should not affect validation',
      }
      // This tests whether the schema is strict or passthrough
      const result = isWorker!(workerWithExtra)
      // Zod default is passthrough (ignores extra fields)
      expect(result).toBe(true)
    })
  })
})

// ============================================================================
// 7. Noun Definition Tests
// ============================================================================

describe('Noun Definitions', () => {
  describe('Worker Noun Definition', () => {
    it('has correct noun name', () => {
      expect((WorkerNoun as Record<string, unknown>).noun).toBe('Worker')
    })

    it('has correct plural name', () => {
      expect((WorkerNoun as Record<string, unknown>).plural).toBe('Workers')
    })

    it('has correct $type', () => {
      expect((WorkerNoun as Record<string, unknown>).$type).toBe('https://schema.org.ai/Worker')
    })

    it('has schema reference', () => {
      expect((WorkerNoun as Record<string, unknown>).schema).toBe(WorkerSchema)
    })

    it('has defaults defined', () => {
      expect((WorkerNoun as Record<string, unknown>).defaults).toBeDefined()
    })

    it('defaults include status: available', () => {
      expect((WorkerNoun as Record<string, unknown>).defaults).toHaveProperty('status', 'available')
    })

    it('defaults include empty skills array', () => {
      expect((WorkerNoun as Record<string, unknown>).defaults).toHaveProperty('skills')
      expect(((WorkerNoun as Record<string, unknown>).defaults as Record<string, unknown>).skills).toEqual([])
    })
  })

  describe('Agent Noun Definition', () => {
    it('has correct noun name', () => {
      expect((AgentNoun as Record<string, unknown>).noun).toBe('Agent')
    })

    it('has correct plural name', () => {
      expect((AgentNoun as Record<string, unknown>).plural).toBe('Agents')
    })

    it('has correct $type', () => {
      expect((AgentNoun as Record<string, unknown>).$type).toBe('https://schema.org.ai/Agent')
    })

    it('has schema reference', () => {
      expect((AgentNoun as Record<string, unknown>).schema).toBe(AgentSchema)
    })

    it('has extends: Worker', () => {
      expect((AgentNoun as Record<string, unknown>).extends).toBe('Worker')
    })

    it('has defaults defined', () => {
      expect((AgentNoun as Record<string, unknown>).defaults).toBeDefined()
    })

    it('defaults include autonomous: false', () => {
      expect((AgentNoun as Record<string, unknown>).defaults).toHaveProperty('autonomous', false)
    })

    it('defaults include empty tools array', () => {
      expect(((AgentNoun as Record<string, unknown>).defaults as Record<string, unknown>).tools).toEqual([])
    })
  })

  describe('Human Noun Definition', () => {
    it('has correct noun name', () => {
      expect((HumanNoun as Record<string, unknown>).noun).toBe('Human')
    })

    it('has correct plural name', () => {
      expect((HumanNoun as Record<string, unknown>).plural).toBe('Humans')
    })

    it('has correct $type', () => {
      expect((HumanNoun as Record<string, unknown>).$type).toBe('https://schema.org.ai/Human')
    })

    it('has schema reference', () => {
      expect((HumanNoun as Record<string, unknown>).schema).toBe(HumanSchema)
    })

    it('has extends: Worker', () => {
      expect((HumanNoun as Record<string, unknown>).extends).toBe('Worker')
    })

    it('has defaults defined', () => {
      expect((HumanNoun as Record<string, unknown>).defaults).toBeDefined()
    })

    it('defaults include requiresApproval: true', () => {
      expect((HumanNoun as Record<string, unknown>).defaults).toHaveProperty('requiresApproval', true)
    })

    it('defaults include notificationChannels with email', () => {
      expect(((HumanNoun as Record<string, unknown>).defaults as Record<string, unknown>).notificationChannels).toEqual(['email'])
    })
  })

  describe('Team Noun Definition', () => {
    it('has correct noun name', () => {
      expect((TeamNoun as Record<string, unknown>).noun).toBe('Team')
    })

    it('has correct plural name', () => {
      expect((TeamNoun as Record<string, unknown>).plural).toBe('Teams')
    })

    it('has correct $type', () => {
      expect((TeamNoun as Record<string, unknown>).$type).toBe('https://schema.org.ai/Team')
    })

    it('has schema reference', () => {
      expect((TeamNoun as Record<string, unknown>).schema).toBe(TeamSchema)
    })

    it('has defaults defined', () => {
      expect((TeamNoun as Record<string, unknown>).defaults).toBeDefined()
    })

    it('defaults include status: active', () => {
      expect((TeamNoun as Record<string, unknown>).defaults).toHaveProperty('status', 'active')
    })

    it('defaults include empty members array', () => {
      expect(((TeamNoun as Record<string, unknown>).defaults as Record<string, unknown>).members).toEqual([])
    })

    it('defaults include workload: 0', () => {
      expect((TeamNoun as Record<string, unknown>).defaults).toHaveProperty('workload', 0)
    })
  })
})

// ============================================================================
// 8. Type/Const Name Collision Tests
// ============================================================================

describe('Type/Const Name Collision', () => {
  /**
   * These tests verify that the exports handle the type vs const name collision properly.
   * In TypeScript, you can have both a type and a const with the same name, but
   * re-exports need to be handled carefully.
   */

  it('Worker can be used as both type and value', () => {
    // WorkerNoun should be the Noun definition object
    expect(typeof WorkerNoun).toBe('object')
    expect(WorkerNoun).toHaveProperty('noun')
    expect(WorkerNoun).toHaveProperty('schema')
  })

  it('Agent can be used as both type and value', () => {
    expect(typeof AgentNoun).toBe('object')
    expect(AgentNoun).toHaveProperty('noun')
    expect(AgentNoun).toHaveProperty('schema')
  })

  it('Human can be used as both type and value', () => {
    expect(typeof HumanNoun).toBe('object')
    expect(HumanNoun).toHaveProperty('noun')
    expect(HumanNoun).toHaveProperty('schema')
  })

  it('Team can be used as both type and value', () => {
    expect(typeof TeamNoun).toBe('object')
    expect(TeamNoun).toHaveProperty('noun')
    expect(TeamNoun).toHaveProperty('schema')
  })

  it('WorkerType is exported separately (if available)', async () => {
    const module = await import('../workers/')
    // The index.ts exports WorkerType as an alias for the type
    // This should be a type-only export, so it won't exist at runtime
    // but the module should compile without issues
    expect(module.Worker).toBeDefined()
  })

  it('AgentType is exported separately (if available)', async () => {
    const module = await import('../workers/')
    expect(module.Agent).toBeDefined()
  })

  it('HumanType is exported separately (if available)', async () => {
    const module = await import('../workers/')
    expect(module.Human).toBeDefined()
  })

  it('TeamType is exported separately (if available)', async () => {
    const module = await import('../workers/')
    expect(module.Team).toBeDefined()
  })
})

// ============================================================================
// 9. Schema Inheritance Tests (.extend())
// ============================================================================

describe('Schema Inheritance via .extend()', () => {
  /**
   * Tests to verify that AgentSchema and HumanSchema properly extend WorkerSchema
   * using Zod's .extend() method.
   */

  it('AgentSchema has all Worker fields', () => {
    const shape = (AgentSchema as z.ZodObject<z.ZodRawShape>).shape
    expect(shape).toHaveProperty('$id')
    expect(shape).toHaveProperty('name')
    expect(shape).toHaveProperty('skills')
    expect(shape).toHaveProperty('status')
  })

  it('AgentSchema has additional agent-specific fields', () => {
    const shape = (AgentSchema as z.ZodObject<z.ZodRawShape>).shape
    expect(shape).toHaveProperty('model')
    expect(shape).toHaveProperty('tools')
    expect(shape).toHaveProperty('autonomous')
  })

  it('AgentSchema overrides $type from Worker', () => {
    const shape = (AgentSchema as z.ZodObject<z.ZodRawShape>).shape
    expect(shape).toHaveProperty('$type')
    // The $type should be a literal for Agent, not Worker
    const agent = createValidAgent()
    const result = AgentSchema!.safeParse(agent)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.$type).toBe('https://schema.org.ai/Agent')
    }
  })

  it('HumanSchema has all Worker fields', () => {
    const shape = (HumanSchema as z.ZodObject<z.ZodRawShape>).shape
    expect(shape).toHaveProperty('$id')
    expect(shape).toHaveProperty('name')
    expect(shape).toHaveProperty('skills')
    expect(shape).toHaveProperty('status')
  })

  it('HumanSchema has additional human-specific fields', () => {
    const shape = (HumanSchema as z.ZodObject<z.ZodRawShape>).shape
    expect(shape).toHaveProperty('requiresApproval')
    expect(shape).toHaveProperty('notificationChannels')
  })

  it('HumanSchema overrides $type from Worker', () => {
    const shape = (HumanSchema as z.ZodObject<z.ZodRawShape>).shape
    expect(shape).toHaveProperty('$type')
    const human = createValidHuman()
    const result = HumanSchema!.safeParse(human)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.$type).toBe('https://schema.org.ai/Human')
    }
  })

  it('TeamSchema does NOT extend Worker (independent schema)', () => {
    // Team has different required fields - it's not a Worker subtype
    const shape = (TeamSchema as z.ZodObject<z.ZodRawShape>).shape
    // Team has members instead of skills
    expect(shape).toHaveProperty('members')
    // Team status has different enum values
    const team = createValidTeam({ status: 'forming' })
    const result = TeamSchema!.safeParse(team)
    expect(result.success).toBe(true)
  })

  it('Worker status enum is preserved in Agent', () => {
    // Worker status: 'available' | 'busy' | 'away' | 'offline'
    const validStatuses = ['available', 'busy', 'away', 'offline']
    for (const status of validStatuses) {
      const agent = createValidAgent({ status })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    }
  })

  it('Worker status enum is preserved in Human', () => {
    const validStatuses = ['available', 'busy', 'away', 'offline']
    for (const status of validStatuses) {
      const human = createValidHuman({ status })
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    }
  })

  it('Team has different status enum than Worker', () => {
    // Team status: 'active' | 'inactive' | 'forming'
    // Worker status: 'available' | 'busy' | 'away' | 'offline'
    const workerStatus = 'available'
    const team = createValidTeam({ status: workerStatus })
    const result = TeamSchema!.safeParse(team)
    // Worker status should be invalid for Team
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// 10. Default Values Tests
// ============================================================================

describe('Default Values', () => {
  /**
   * Tests to verify that defaults are properly defined in noun definitions.
   * Note: Zod schemas don't automatically apply defaults - that's done
   * by the application layer using the noun.defaults property.
   */

  it('Worker defaults are properly defined', () => {
    const defaults = (WorkerNoun as Record<string, unknown>).defaults as Record<string, unknown>
    expect(defaults).toEqual({
      status: 'available',
      skills: [],
    })
  })

  it('Agent defaults are properly defined', () => {
    const defaults = (AgentNoun as Record<string, unknown>).defaults as Record<string, unknown>
    expect(defaults).toEqual({
      status: 'available',
      skills: [],
      tools: [],
      autonomous: false,
    })
  })

  it('Human defaults are properly defined', () => {
    const defaults = (HumanNoun as Record<string, unknown>).defaults as Record<string, unknown>
    expect(defaults).toEqual({
      status: 'available',
      skills: [],
      requiresApproval: true,
      notificationChannels: ['email'],
    })
  })

  it('Team defaults are properly defined', () => {
    const defaults = (TeamNoun as Record<string, unknown>).defaults as Record<string, unknown>
    expect(defaults).toEqual({
      status: 'active',
      members: [],
      skills: [],
      workload: 0,
    })
  })

  it('Agent defaults include inherited Worker defaults', () => {
    const agentDefaults = (AgentNoun as Record<string, unknown>).defaults as Record<string, unknown>
    const workerDefaults = (WorkerNoun as Record<string, unknown>).defaults as Record<string, unknown>
    // Agent should have both Worker defaults and its own
    expect(agentDefaults.status).toBe(workerDefaults.status)
    expect(agentDefaults.skills).toEqual(workerDefaults.skills)
  })

  it('Human defaults include inherited Worker defaults', () => {
    const humanDefaults = (HumanNoun as Record<string, unknown>).defaults as Record<string, unknown>
    const workerDefaults = (WorkerNoun as Record<string, unknown>).defaults as Record<string, unknown>
    expect(humanDefaults.status).toBe(workerDefaults.status)
    expect(humanDefaults.skills).toEqual(workerDefaults.skills)
  })
})

// ============================================================================
// 11. Optional Fields Tests
// ============================================================================

describe('Optional Fields', () => {
  describe('Agent Optional Fields', () => {
    it('validates agent without systemPrompt', () => {
      const agent = createValidAgent()
      delete (agent as Record<string, unknown>).systemPrompt
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('validates agent without temperature', () => {
      const agent = createValidAgent()
      delete (agent as Record<string, unknown>).temperature
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('validates agent without maxTokens', () => {
      const agent = createValidAgent()
      delete (agent as Record<string, unknown>).maxTokens
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })
  })

  describe('Human Optional Fields', () => {
    it('validates human without email', () => {
      const human = createValidHuman()
      delete (human as Record<string, unknown>).email
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })

    it('validates human without timezone', () => {
      const human = createValidHuman()
      delete (human as Record<string, unknown>).timezone
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })

    it('validates human without workingHours', () => {
      const human = createValidHuman()
      delete (human as Record<string, unknown>).workingHours
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })

    it('validates human without preferredLanguage', () => {
      const human = createValidHuman()
      delete (human as Record<string, unknown>).preferredLanguage
      const result = HumanSchema!.safeParse(human)
      expect(result.success).toBe(true)
    })
  })

  describe('Team Optional Fields', () => {
    it('validates team without description', () => {
      const team = createValidTeam()
      delete (team as Record<string, unknown>).description
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team without lead', () => {
      const team = createValidTeam()
      delete (team as Record<string, unknown>).lead
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team without skills', () => {
      const team = createValidTeam()
      delete (team as Record<string, unknown>).skills
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team without status', () => {
      const team = createValidTeam()
      delete (team as Record<string, unknown>).status
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team without goals', () => {
      const team = createValidTeam()
      delete (team as Record<string, unknown>).goals
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team without channels', () => {
      const team = createValidTeam()
      delete (team as Record<string, unknown>).channels
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team without capacity', () => {
      const team = createValidTeam()
      delete (team as Record<string, unknown>).capacity
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('validates team without workload', () => {
      const team = createValidTeam()
      delete (team as Record<string, unknown>).workload
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// 12. Edge Cases and Error Messages
// ============================================================================

describe('Edge Cases and Error Messages', () => {
  describe('Empty String Handling', () => {
    it('handles empty name string for Worker', () => {
      const worker = createValidWorker({ name: '' })
      const result = WorkerSchema!.safeParse(worker)
      // Empty string is valid for z.string() unless .min(1) is used
      // This test exposes whether there's a minimum length constraint
      expect(result.success).toBe(true)
    })

    it('handles empty $id string for Worker', () => {
      const worker = createValidWorker({ $id: '' })
      const result = WorkerSchema!.safeParse(worker)
      // Empty string is valid for z.string() unless constrained
      expect(result.success).toBe(true)
    })

    it('handles empty model string for Agent', () => {
      const agent = createValidAgent({ model: '' })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })
  })

  describe('Whitespace Handling', () => {
    it('handles whitespace-only name', () => {
      const worker = createValidWorker({ name: '   ' })
      const result = WorkerSchema!.safeParse(worker)
      // Whitespace is valid for z.string() unless .trim() is used
      expect(result.success).toBe(true)
    })
  })

  describe('Special Characters', () => {
    it('handles special characters in name', () => {
      const worker = createValidWorker({ name: 'Test Worker <script>alert(1)</script>' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(true)
    })

    it('handles unicode in name', () => {
      const worker = createValidWorker({ name: 'Test Worker' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(true)
    })

    it('handles emoji in name', () => {
      const worker = createValidWorker({ name: 'Test Worker' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(true)
    })
  })

  describe('Large Data Handling', () => {
    it('handles very long name', () => {
      const worker = createValidWorker({ name: 'a'.repeat(10000) })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(true)
    })

    it('handles many skills', () => {
      const skills = Array.from({ length: 1000 }, (_, i) => `skill-${i}`)
      const worker = createValidWorker({ skills })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(true)
    })

    it('handles many team members', () => {
      const members = Array.from({ length: 1000 }, (_, i) => `member-${i}`)
      const team = createValidTeam({ members })
      const result = TeamSchema!.safeParse(team)
      expect(result.success).toBe(true)
    })
  })

  describe('Null vs Undefined', () => {
    it('rejects null for required string field', () => {
      const worker = createValidWorker({ name: null })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
    })

    it('handles undefined for optional field', () => {
      const agent = createValidAgent({ systemPrompt: undefined })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('rejects null for optional field (Zod strictness)', () => {
      const agent = createValidAgent({ systemPrompt: null })
      const result = AgentSchema!.safeParse(agent)
      // z.string().optional() does not accept null, only undefined
      expect(result.success).toBe(false)
    })
  })

  describe('Schema Error Messages', () => {
    it('provides helpful error for missing required field', () => {
      const worker = createValidWorker()
      delete (worker as Record<string, unknown>).name
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0)
        const issue = result.error.issues[0]
        expect(issue.path).toContain('name')
      }
    })

    it('provides helpful error for wrong type', () => {
      const worker = createValidWorker({ name: 12345 })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0)
        const issue = result.error.issues[0]
        expect(issue.code).toBe('invalid_type')
      }
    })

    it('provides helpful error for invalid enum value', () => {
      const worker = createValidWorker({ status: 'invalid' })
      const result = WorkerSchema!.safeParse(worker)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0)
        const issue = result.error.issues[0]
        // Zod uses 'invalid_enum_value' for z.enum() but 'invalid_value' for literal unions
        // The status field uses z.enum(), so we expect invalid_enum_value
        // However, z.literal() failures return 'invalid_literal'
        expect(['invalid_enum_value', 'invalid_value']).toContain(issue.code)
      }
    })

    it('provides helpful error for temperature out of range', () => {
      const agent = createValidAgent({ temperature: 2.0 })
      const result = AgentSchema!.safeParse(agent)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0)
        const issue = result.error.issues[0]
        expect(issue.code).toBe('too_big')
      }
    })
  })
})

// ============================================================================
// 13. Cross-Validation Tests
// ============================================================================

describe('Cross-Validation Between Types', () => {
  it('Agent is NOT valid as Worker (different $type literal)', () => {
    const agent = createValidAgent()
    const result = WorkerSchema!.safeParse(agent)
    // Should fail because $type is 'Agent' not 'Worker'
    expect(result.success).toBe(false)
  })

  it('Human is NOT valid as Worker (different $type literal)', () => {
    const human = createValidHuman()
    const result = WorkerSchema!.safeParse(human)
    expect(result.success).toBe(false)
  })

  it('Worker is NOT valid as Agent (missing required fields)', () => {
    const worker = createValidWorker()
    const result = AgentSchema!.safeParse(worker)
    expect(result.success).toBe(false)
  })

  it('Worker is NOT valid as Human (missing required fields)', () => {
    const worker = createValidWorker()
    const result = HumanSchema!.safeParse(worker)
    expect(result.success).toBe(false)
  })

  it('Agent is NOT valid as Human (wrong $type)', () => {
    const agent = createValidAgent()
    const result = HumanSchema!.safeParse(agent)
    expect(result.success).toBe(false)
  })

  it('Human is NOT valid as Agent (wrong $type)', () => {
    const human = createValidHuman()
    const result = AgentSchema!.safeParse(human)
    expect(result.success).toBe(false)
  })

  it('Team is NOT valid as any Worker type', () => {
    const team = createValidTeam()
    expect(WorkerSchema!.safeParse(team).success).toBe(false)
    expect(AgentSchema!.safeParse(team).success).toBe(false)
    expect(HumanSchema!.safeParse(team).success).toBe(false)
  })

  it('Worker types are NOT valid as Team', () => {
    expect(TeamSchema!.safeParse(createValidWorker()).success).toBe(false)
    expect(TeamSchema!.safeParse(createValidAgent()).success).toBe(false)
    expect(TeamSchema!.safeParse(createValidHuman()).success).toBe(false)
  })
})
