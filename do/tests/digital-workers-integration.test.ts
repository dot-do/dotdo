/**
 * TDD Integration Tests for @dotdo/do with digital-workers
 *
 * These tests verify that the DO (Durable Object) integrates correctly with
 * digital-workers patterns including:
 * - Worker types and status management
 * - Team organization and member management
 * - Role definitions for AI and human workers
 * - Capability tiers (code, generative, agentic, human)
 * - Load balancing and task routing
 * - Worker actions (notify, ask, approve, decide, do)
 * - WorkflowContext ($) integration with worker actions
 *
 * Issue: do-zr1u.7
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createContext,
  type WorkflowContext,
} from '../workflow/context'
import type {
  Worker,
  Team,
  WorkerRef,
  WorkerRole,
  WorkerStatus,
  ContactChannel,
  NotifyActionData,
  AskActionData,
  ApproveActionData,
  DecideActionData,
  DoActionData,
  NotifyResult,
  AskResult,
  ApprovalResult,
  DecideResult,
  DoResult,
  CapabilityTier,
} from 'digital-workers'
import {
  Role,
  Team as TeamFactory,
  CAPABILITY_TIERS,
  TIER_ORDER,
  compareTiers,
  isHigherTier,
  isLowerTier,
  getNextTier,
  getPreviousTier,
  getTierConfig,
  getToolsForTier,
  matchTierToComplexity,
  canExecuteAtTier,
  validateTierEscalation,
  createCapabilityProfile,
  TierRegistry,
  WorkerVerbs,
  registerWorkerActions,
  withWorkers,
} from 'digital-workers'

// Mock DurableObjectState for testing
const createMockState = () => ({
  id: { toString: () => `test-do-${Date.now()}` },
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(() => Promise.resolve(new Map())),
    delete: vi.fn(),
    deleteAll: vi.fn(),
    transaction: vi.fn((fn: () => void) => fn()),
  },
  waitUntil: vi.fn(),
  blockConcurrencyWhile: vi.fn(),
} as unknown as DurableObjectState)

// =============================================================================
// WORKER TYPE TESTS
// =============================================================================

describe('DO Integration with digital-workers: Worker Types', () => {
  let $: WorkflowContext
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    $ = createContext(mockState, {})
  })

  describe('Worker Interface', () => {
    it('should support Worker type with required fields', () => {
      const worker: Worker = {
        id: 'worker-001',
        name: 'Alice',
        type: 'human',
        status: 'available',
        contacts: {
          email: 'alice@example.com',
          slack: { workspace: 'acme', user: 'U123' },
        },
      }

      expect(worker.id).toBe('worker-001')
      expect(worker.name).toBe('Alice')
      expect(worker.type).toBe('human')
      expect(worker.status).toBe('available')
      expect(worker.contacts.email).toBe('alice@example.com')
    })

    it('should support AI agent workers', () => {
      const agentWorker: Worker = {
        id: 'agent-001',
        name: 'Code Reviewer Bot',
        type: 'agent',
        status: 'available',
        contacts: {
          api: { endpoint: 'https://api.agent.ai/v1', auth: 'bearer' },
          webhook: { url: 'https://hooks.agent.ai/events' },
        },
        capabilityTier: 'generative',
        skills: ['code-review', 'bug-detection', 'refactoring'],
        tools: ['generate', 'analyze', 'classify'],
      }

      expect(agentWorker.type).toBe('agent')
      expect(agentWorker.capabilityTier).toBe('generative')
      expect(agentWorker.skills).toContain('code-review')
    })

    it('should track worker status transitions', () => {
      const statuses: WorkerStatus[] = ['available', 'busy', 'away', 'offline']

      for (const status of statuses) {
        const worker: Worker = {
          id: 'worker-001',
          name: 'Test Worker',
          type: 'human',
          status,
          contacts: { email: 'test@example.com' },
        }
        expect(worker.status).toBe(status)
      }
    })
  })

  describe('WorkerRef Interface', () => {
    it('should support lightweight worker references', () => {
      const workerRef: WorkerRef = {
        id: 'worker-001',
        type: 'human',
        name: 'Alice',
        role: 'Engineer',
        capabilityTier: 'agentic',
      }

      expect(workerRef.id).toBe('worker-001')
      expect(workerRef.capabilityTier).toBe('agentic')
    })

    it('should support minimal worker references (id only)', () => {
      const minimalRef: WorkerRef = {
        id: 'worker-002',
      }

      expect(minimalRef.id).toBe('worker-002')
      expect(minimalRef.type).toBeUndefined()
      expect(minimalRef.name).toBeUndefined()
    })
  })
})

// =============================================================================
// TEAM TESTS
// =============================================================================

describe('DO Integration with digital-workers: Teams', () => {
  describe('Team Factory', () => {
    it('should create a team with members', () => {
      const team: Team = TeamFactory({
        id: 'team-eng',
        name: 'Engineering',
        description: 'Product engineering team',
        members: [
          { id: 'alice', name: 'Alice', role: 'Senior Engineer', type: 'human' },
          { id: 'bob', name: 'Bob', role: 'Engineer', type: 'human' },
          { id: 'ai-reviewer', name: 'Code Reviewer', role: 'Reviewer', type: 'agent' },
        ],
        contacts: {
          slack: '#engineering',
          email: 'eng@company.com',
        },
        lead: { id: 'alice', name: 'Alice' },
        goals: ['Ship features on schedule', 'Maintain code quality'],
      })

      expect(team.id).toBe('team-eng')
      expect(team.name).toBe('Engineering')
      expect(team.members).toHaveLength(3)
      expect(team.lead?.id).toBe('alice')
    })

    it('should add members to a team', () => {
      const team = TeamFactory({
        id: 'team-eng',
        name: 'Engineering',
        members: [{ id: 'alice', name: 'Alice' }],
        contacts: { email: 'eng@example.com' },
      })

      const updatedTeam = TeamFactory.addMember(team, {
        id: 'charlie',
        name: 'Charlie',
        role: 'Junior Engineer',
        type: 'human',
      })

      expect(updatedTeam.members).toHaveLength(2)
      expect(updatedTeam.members[1].id).toBe('charlie')
    })

    it('should remove members from a team', () => {
      const team = TeamFactory({
        id: 'team-eng',
        name: 'Engineering',
        members: [
          { id: 'alice', name: 'Alice' },
          { id: 'bob', name: 'Bob' },
        ],
        contacts: { email: 'eng@example.com' },
      })

      const updatedTeam = TeamFactory.removeMember(team, 'bob')

      expect(updatedTeam.members).toHaveLength(1)
      expect(updatedTeam.members[0].id).toBe('alice')
    })

    it('should filter AI members of a team', () => {
      const team = TeamFactory({
        id: 'team-support',
        name: 'Support',
        members: [
          { id: 'support-bot-1', name: 'Support Bot Alpha', type: 'agent' },
          { id: 'support-bot-2', name: 'Support Bot Beta', type: 'agent' },
          { id: 'jane', name: 'Jane', type: 'human' },
        ],
        contacts: { email: 'support@example.com' },
      })

      const aiMembers = TeamFactory.aiMembers(team)

      expect(aiMembers).toHaveLength(2)
      expect(aiMembers.every((m) => m.type === 'agent')).toBe(true)
    })

    it('should filter human members of a team', () => {
      const team = TeamFactory({
        id: 'team-eng',
        name: 'Engineering',
        members: [
          { id: 'alice', name: 'Alice', type: 'human' },
          { id: 'bob', name: 'Bob', type: 'human' },
          { id: 'ai-bot', name: 'AI Bot', type: 'agent' },
        ],
        contacts: { email: 'eng@example.com' },
      })

      const humanMembers = TeamFactory.humanMembers(team)

      expect(humanMembers).toHaveLength(2)
      expect(humanMembers.every((m) => m.type === 'human')).toBe(true)
    })

    it('should filter members by role', () => {
      const team = TeamFactory({
        id: 'team-eng',
        name: 'Engineering',
        members: [
          { id: 'alice', name: 'Alice', role: 'Senior Engineer' },
          { id: 'bob', name: 'Bob', role: 'Engineer' },
          { id: 'charlie', name: 'Charlie', role: 'Engineer' },
        ],
        contacts: { email: 'eng@example.com' },
      })

      const engineers = TeamFactory.byRole(team, 'Engineer')

      expect(engineers).toHaveLength(2)
      expect(engineers.every((m) => m.role === 'Engineer')).toBe(true)
    })
  })
})

// =============================================================================
// ROLE TESTS
// =============================================================================

describe('DO Integration with digital-workers: Roles', () => {
  describe('Role Factory', () => {
    it('should create a hybrid role by default', () => {
      const role: WorkerRole = Role({
        name: 'Software Engineer',
        description: 'Builds and maintains software systems',
        responsibilities: [
          'Write clean, maintainable code',
          'Review pull requests',
          'Fix bugs and issues',
        ],
        skills: ['TypeScript', 'React', 'Node.js'],
      })

      expect(role.name).toBe('Software Engineer')
      expect(role.type).toBe('hybrid')
      expect(role.responsibilities).toHaveLength(3)
    })

    it('should create an AI-specific role', () => {
      const role = Role.ai({
        name: 'Data Analyst',
        description: 'Analyzes data and generates insights',
        responsibilities: [
          'Process large datasets',
          'Generate reports',
          'Identify trends',
        ],
      })

      expect(role.type).toBe('ai')
      expect(role.name).toBe('Data Analyst')
    })

    it('should create a human-specific role', () => {
      const role = Role.human({
        name: 'Engineering Manager',
        description: 'Leads engineering team',
        responsibilities: [
          'Team leadership',
          'Strategic planning',
          'Performance reviews',
        ],
      })

      expect(role.type).toBe('human')
      expect(role.name).toBe('Engineering Manager')
    })

    it('should create a hybrid role explicitly', () => {
      const role = Role.hybrid({
        name: 'Content Writer',
        description: 'Creates written content',
        responsibilities: ['Write articles', 'Create marketing copy'],
      })

      expect(role.type).toBe('hybrid')
    })
  })
})

// =============================================================================
// CAPABILITY TIERS TESTS
// =============================================================================

describe('DO Integration with digital-workers: Capability Tiers', () => {
  describe('Tier Constants', () => {
    it('should have four capability tiers in order', () => {
      expect(CAPABILITY_TIERS).toEqual(['code', 'generative', 'agentic', 'human'])
    })

    it('should have correct tier ordering', () => {
      expect(TIER_ORDER.code).toBe(0)
      expect(TIER_ORDER.generative).toBe(1)
      expect(TIER_ORDER.agentic).toBe(2)
      expect(TIER_ORDER.human).toBe(3)
    })
  })

  describe('Tier Comparison Functions', () => {
    it('should compare tiers correctly', () => {
      expect(compareTiers('code', 'generative')).toBeLessThan(0)
      expect(compareTiers('human', 'agentic')).toBeGreaterThan(0)
      expect(compareTiers('generative', 'generative')).toBe(0)
    })

    it('should detect higher tiers', () => {
      expect(isHigherTier('agentic', 'code')).toBe(true)
      expect(isHigherTier('generative', 'human')).toBe(false)
    })

    it('should detect lower tiers', () => {
      expect(isLowerTier('code', 'generative')).toBe(true)
      expect(isLowerTier('human', 'agentic')).toBe(false)
    })

    it('should get next tier in escalation order', () => {
      expect(getNextTier('code')).toBe('generative')
      expect(getNextTier('generative')).toBe('agentic')
      expect(getNextTier('agentic')).toBe('human')
      expect(getNextTier('human')).toBeNull()
    })

    it('should get previous tier in de-escalation order', () => {
      expect(getPreviousTier('human')).toBe('agentic')
      expect(getPreviousTier('agentic')).toBe('generative')
      expect(getPreviousTier('generative')).toBe('code')
      expect(getPreviousTier('code')).toBeNull()
    })
  })

  describe('Tier Configuration', () => {
    it('should get tier config with correct complexity ranges', () => {
      const codeConfig = getTierConfig('code')
      expect(codeConfig.minComplexity).toBe(1)
      expect(codeConfig.maxComplexity).toBe(2)

      const generativeConfig = getTierConfig('generative')
      expect(generativeConfig.minComplexity).toBe(3)
      expect(generativeConfig.maxComplexity).toBe(5)

      const agenticConfig = getTierConfig('agentic')
      expect(agenticConfig.minComplexity).toBe(6)
      expect(agenticConfig.maxComplexity).toBe(8)

      const humanConfig = getTierConfig('human')
      expect(humanConfig.minComplexity).toBe(9)
      expect(humanConfig.maxComplexity).toBe(10)
    })

    it('should get appropriate tools for each tier', () => {
      const codeTools = getToolsForTier('code')
      expect(codeTools).toContain('calculate')
      expect(codeTools).toContain('lookup')

      const generativeTools = getToolsForTier('generative')
      expect(generativeTools).toContain('generate')
      expect(generativeTools).toContain('summarize')
      // Generative inherits code tools
      expect(generativeTools).toContain('calculate')

      const agenticTools = getToolsForTier('agentic')
      expect(agenticTools).toContain('browse')
      expect(agenticTools).toContain('execute')
      // Agentic inherits generative and code tools
      expect(agenticTools).toContain('generate')
      expect(agenticTools).toContain('calculate')

      const humanTools = getToolsForTier('human')
      expect(humanTools).toContain('approve')
      expect(humanTools).toContain('review')
      // Human has all tools
      expect(humanTools).toContain('browse')
      expect(humanTools).toContain('generate')
      expect(humanTools).toContain('calculate')
    })
  })

  describe('Complexity Matching', () => {
    it('should match complexity to appropriate tier', () => {
      const result1 = matchTierToComplexity(1)
      expect(result1.tier).toBe('code')
      expect(result1.confidence).toBeGreaterThan(0.7)

      const result4 = matchTierToComplexity(4)
      expect(result4.tier).toBe('generative')

      const result7 = matchTierToComplexity(7)
      expect(result7.tier).toBe('agentic')

      const result10 = matchTierToComplexity(10)
      expect(result10.tier).toBe('human')
    })

    it('should check if tier can execute at complexity', () => {
      expect(canExecuteAtTier('code', 2)).toBe(true)
      expect(canExecuteAtTier('code', 5)).toBe(false)

      expect(canExecuteAtTier('generative', 3)).toBe(true)
      expect(canExecuteAtTier('generative', 7)).toBe(false)

      expect(canExecuteAtTier('agentic', 6)).toBe(true)
      expect(canExecuteAtTier('agentic', 10)).toBe(false)

      expect(canExecuteAtTier('human', 10)).toBe(true)
    })
  })

  describe('Tier Escalation', () => {
    it('should validate valid escalation', () => {
      const result = validateTierEscalation({
        fromTier: 'generative',
        toTier: 'agentic',
        reason: 'Task requires autonomous execution',
      })

      expect(result.valid).toBe(true)
    })

    it('should require reason for escalation', () => {
      const result = validateTierEscalation({
        fromTier: 'code',
        toTier: 'generative',
        reason: '',
      })

      expect(result.valid).toBe(false)
      expect(result.error).toContain('reason')
    })

    it('should require justification when skipping tiers', () => {
      const result = validateTierEscalation({
        fromTier: 'code',
        toTier: 'agentic',
        reason: 'Need agentic capabilities',
      })

      expect(result.valid).toBe(false)
      expect(result.error).toContain('skipJustification')
    })

    it('should allow skipping tiers with justification', () => {
      const result = validateTierEscalation({
        fromTier: 'code',
        toTier: 'agentic',
        reason: 'Need agentic capabilities',
        skipJustification: 'Generative tier not suitable for this task',
      })

      expect(result.valid).toBe(true)
    })

    it('should block de-escalation by default', () => {
      const result = validateTierEscalation({
        fromTier: 'agentic',
        toTier: 'generative',
        reason: 'Task simpler than expected',
      })

      expect(result.valid).toBe(false)
      expect(result.error).toContain('de-escalation')
    })

    it('should allow de-escalation with explicit flag', () => {
      const result = validateTierEscalation({
        fromTier: 'agentic',
        toTier: 'generative',
        reason: 'Task simpler than expected',
        allowDeescalation: true,
      })

      expect(result.valid).toBe(true)
    })
  })

  describe('Capability Profile', () => {
    it('should create a valid capability profile', () => {
      const profile = createCapabilityProfile({
        name: 'code-validator',
        tier: 'code',
        complexityRating: 2,
        tools: ['calculate', 'validate'],
        description: 'Validates code patterns',
      })

      expect(profile.name).toBe('code-validator')
      expect(profile.tier).toBe('code')
      expect(profile.tools).toContain('validate')
    })

    it('should reject profile with invalid complexity for tier', () => {
      expect(() => {
        createCapabilityProfile({
          name: 'invalid-profile',
          tier: 'code',
          complexityRating: 5, // Too high for code tier (max 2)
          tools: ['calculate'],
        })
      }).toThrow()
    })

    it('should reject profile with invalid tools for tier', () => {
      expect(() => {
        createCapabilityProfile({
          name: 'invalid-profile',
          tier: 'code',
          complexityRating: 1,
          tools: ['browse'], // browse is agentic tier only
        })
      }).toThrow()
    })
  })

  describe('TierRegistry', () => {
    let registry: TierRegistry

    beforeEach(() => {
      registry = new TierRegistry()
    })

    it('should register and retrieve profiles', () => {
      registry.register({
        name: 'calculator',
        tier: 'code',
        complexityRating: 1,
        tools: ['calculate', 'transform'],
      })

      const profile = registry.get('calculator')
      expect(profile).toBeDefined()
      expect(profile?.name).toBe('calculator')
    })

    it('should list profiles by tier', () => {
      registry.register({
        name: 'calculator',
        tier: 'code',
        complexityRating: 1,
        tools: ['calculate'],
      })
      registry.register({
        name: 'generator',
        tier: 'generative',
        complexityRating: 4,
        tools: ['generate', 'summarize'],
      })

      const codeProfiles = registry.listByTier('code')
      expect(codeProfiles).toHaveLength(1)
      expect(codeProfiles[0].name).toBe('calculator')
    })

    it('should find profiles by complexity', () => {
      registry.register({
        name: 'simple-calc',
        tier: 'code',
        complexityRating: 1,
        tools: ['calculate'],
      })
      registry.register({
        name: 'ai-gen',
        tier: 'generative',
        complexityRating: 4,
        tools: ['generate'],
      })

      // Complexity 2 can be handled by code tier
      const profiles = registry.findByComplexity(2)
      expect(profiles.some((p) => p.name === 'simple-calc')).toBe(true)
    })

    it('should find profiles by required tools', () => {
      registry.register({
        name: 'validator',
        tier: 'code',
        complexityRating: 2,
        tools: ['calculate', 'validate'],
      })
      registry.register({
        name: 'transformer',
        tier: 'code',
        complexityRating: 2,
        tools: ['transform'],
      })

      const profiles = registry.findByTools(['validate'])
      expect(profiles).toHaveLength(1)
      expect(profiles[0].name).toBe('validator')
    })

    it('should unregister profiles', () => {
      registry.register({
        name: 'temp-profile',
        tier: 'code',
        complexityRating: 1,
        tools: ['calculate'],
      })

      expect(registry.get('temp-profile')).toBeDefined()

      const removed = registry.unregister('temp-profile')
      expect(removed).toBe(true)
      expect(registry.get('temp-profile')).toBeUndefined()
    })
  })
})

// =============================================================================
// WORKER VERBS TESTS
// =============================================================================

describe('DO Integration with digital-workers: Worker Verbs', () => {
  it('should have correct verb definitions for notify', () => {
    expect(WorkerVerbs.notify.action).toBe('notify')
    expect(WorkerVerbs.notify.actor).toBe('notifier')
    expect(WorkerVerbs.notify.activity).toBe('notifying')
    expect(WorkerVerbs.notify.result).toBe('notification')
    expect(WorkerVerbs.notify.reverse.at).toBe('notifiedAt')
    expect(WorkerVerbs.notify.reverse.by).toBe('notifiedBy')
  })

  it('should have correct verb definitions for ask', () => {
    expect(WorkerVerbs.ask.action).toBe('ask')
    expect(WorkerVerbs.ask.actor).toBe('asker')
    expect(WorkerVerbs.ask.activity).toBe('asking')
    expect(WorkerVerbs.ask.result).toBe('question')
  })

  it('should have correct verb definitions for approve', () => {
    expect(WorkerVerbs.approve.action).toBe('approve')
    expect(WorkerVerbs.approve.actor).toBe('approver')
    expect(WorkerVerbs.approve.activity).toBe('approving')
    expect(WorkerVerbs.approve.result).toBe('approval')
    expect(WorkerVerbs.approve.inverse).toBe('reject')
  })

  it('should have correct verb definitions for decide', () => {
    expect(WorkerVerbs.decide.action).toBe('decide')
    expect(WorkerVerbs.decide.actor).toBe('decider')
    expect(WorkerVerbs.decide.activity).toBe('deciding')
    expect(WorkerVerbs.decide.result).toBe('decision')
  })

  it('should have correct verb definitions for do', () => {
    expect(WorkerVerbs.do.action).toBe('do')
    expect(WorkerVerbs.do.actor).toBe('doer')
    expect(WorkerVerbs.do.activity).toBe('doing')
    expect(WorkerVerbs.do.result).toBe('task')
    expect(WorkerVerbs.do.reverse.at).toBe('doneAt')
    expect(WorkerVerbs.do.reverse.by).toBe('doneBy')
  })
})

// =============================================================================
// WORKFLOW CONTEXT INTEGRATION TESTS
// =============================================================================

describe('DO Integration with digital-workers: WorkflowContext ($)', () => {
  let $: WorkflowContext
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    $ = createContext(mockState, {})
  })

  describe('Worker Action Events via $.on', () => {
    it('should register Worker.notify event handler', () => {
      let notifyCalled = false

      $.on.Worker.notify((data: NotifyActionData) => {
        notifyCalled = true
        expect(data.action).toBe('notify')
      })

      // The handler should be registered
      expect(notifyCalled).toBe(false) // Not called yet

      // Emit the event
      $.send({ type: 'Worker.notify', payload: { action: 'notify', message: 'test' } })
    })

    it('should register Worker.ask event handler', () => {
      $.on.Worker.ask((data: AskActionData) => {
        expect(data.action).toBe('ask')
        expect(data.question).toBeDefined()
      })
    })

    it('should register Worker.approve event handler', () => {
      $.on.Worker.approve((data: ApproveActionData) => {
        expect(data.action).toBe('approve')
        expect(data.request).toBeDefined()
      })
    })

    it('should register Worker.decide event handler', () => {
      $.on.Worker.decide((data: DecideActionData) => {
        expect(data.action).toBe('decide')
        expect(data.options).toBeDefined()
      })
    })

    it('should register Worker.do event handler', () => {
      $.on.Worker.do((data: DoActionData) => {
        expect(data.action).toBe('do')
        expect(data.instruction).toBeDefined()
      })
    })
  })

  describe('Worker Result Events via $.on', () => {
    it('should register Worker.notified result event', () => {
      $.on.Worker.notified((result: { result: NotifyResult }) => {
        expect(result.result.sent).toBeDefined()
      })
    })

    it('should register Worker.answered result event', () => {
      $.on.Worker.answered((result: { result: AskResult }) => {
        expect(result.result.answer).toBeDefined()
      })
    })

    it('should register Worker.approved result event', () => {
      $.on.Worker.approved((result: { result: ApprovalResult }) => {
        expect(result.result.approved).toBe(true)
      })
    })

    it('should register Worker.rejected result event', () => {
      $.on.Worker.rejected((result: { result: ApprovalResult }) => {
        expect(result.result.approved).toBe(false)
      })
    })

    it('should register Worker.decided result event', () => {
      $.on.Worker.decided((result: { result: DecideResult }) => {
        expect(result.result.choice).toBeDefined()
      })
    })

    it('should register Worker.done result event', () => {
      $.on.Worker.done((result: { result: DoResult }) => {
        expect(result.result.success).toBe(true)
      })
    })

    it('should register Worker.failed result event', () => {
      $.on.Worker.failed((result: { result: DoResult }) => {
        expect(result.result.success).toBe(false)
      })
    })
  })

  describe('Durability Levels with Worker Actions', () => {
    it('should send worker events with $.send (fire-and-forget)', () => {
      const worker: Worker = {
        id: 'alice',
        name: 'Alice',
        type: 'human',
        status: 'available',
        contacts: { email: 'alice@example.com' },
      }

      // Fire-and-forget notify
      $.send({
        type: 'Worker.notify',
        payload: {
          actor: 'system',
          object: worker,
          action: 'notify',
          message: 'Hello Alice!',
        },
      })

      // No error means success for fire-and-forget
    })

    it('should try worker actions with $.try (single attempt)', async () => {
      const result = await $.try(async () => {
        return { attempted: true, action: 'Worker.ask' }
      })

      expect(result.attempted).toBe(true)
    })

    it('should execute durable worker actions with $.do (with retries)', async () => {
      let attempts = 0

      const result = await $.do(async () => {
        attempts++
        if (attempts < 2) {
          throw new Error('Transient failure')
        }
        return { success: true, attempts }
      }, { retries: 3 })

      expect(result.success).toBe(true)
      expect(result.attempts).toBe(2)
    })
  })
})

// =============================================================================
// WITHWORKERS CONTEXT EXTENSION TESTS
// =============================================================================

describe('DO Integration with digital-workers: withWorkers Context Extension', () => {
  let $: WorkflowContext
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    $ = createContext(mockState, {})
  })

  it('should extend context with notify method', () => {
    // Note: withWorkers requires registerWorkerActions to be called first in real usage
    // Here we test that withWorkers returns an extended context
    const worker$ = withWorkers($)

    expect(worker$.notify).toBeDefined()
    expect(typeof worker$.notify).toBe('function')
  })

  it('should extend context with ask method', () => {
    const worker$ = withWorkers($)

    expect(worker$.ask).toBeDefined()
    expect(typeof worker$.ask).toBe('function')
  })

  it('should extend context with approve method', () => {
    const worker$ = withWorkers($)

    expect(worker$.approve).toBeDefined()
    expect(typeof worker$.approve).toBe('function')
  })

  it('should extend context with decide method', () => {
    const worker$ = withWorkers($)

    expect(worker$.decide).toBeDefined()
    expect(typeof worker$.decide).toBe('function')
  })

  it('should preserve original context properties', () => {
    const worker$ = withWorkers($)

    // Original $ methods should still be available
    expect(worker$.send).toBeDefined()
    expect(worker$.try).toBeDefined()
    expect(worker$.do).toBeDefined()
    expect(worker$.on).toBeDefined()
    expect(worker$.every).toBeDefined()
  })
})

// =============================================================================
// CONTACT CHANNELS TESTS
// =============================================================================

describe('DO Integration with digital-workers: Contact Channels', () => {
  it('should support all contact channel types', () => {
    const channels: ContactChannel[] = [
      'email',
      'slack',
      'teams',
      'discord',
      'phone',
      'sms',
      'whatsapp',
      'telegram',
      'web',
      'api',
      'webhook',
    ]

    const worker: Worker = {
      id: 'multi-contact',
      name: 'Multi-Contact Worker',
      type: 'human',
      status: 'available',
      contacts: {
        email: 'worker@example.com',
        slack: { workspace: 'acme', user: 'U123' },
        teams: { tenant: 'acme', user: 'user@acme.com' },
        discord: { server: 'acme-gaming', user: 'worker#1234' },
        phone: { number: '+1-555-1234', country: 'US' },
        sms: { number: '+1-555-1234' },
        whatsapp: { number: '+1-555-1234' },
        telegram: { user: '@worker' },
        web: { url: 'https://app.example.com', userId: 'worker-001' },
        api: { endpoint: 'https://api.example.com/v1', auth: 'bearer' },
        webhook: { url: 'https://hooks.example.com/worker' },
      },
    }

    for (const channel of channels) {
      expect(worker.contacts[channel]).toBeDefined()
    }
  })

  it('should support contact preferences', () => {
    const worker: Worker = {
      id: 'pref-worker',
      name: 'Worker with Preferences',
      type: 'human',
      status: 'available',
      contacts: {
        email: 'worker@example.com',
        slack: '#general',
        phone: '+1-555-1234',
      },
      preferences: {
        primary: 'slack',
        urgent: 'phone',
        fallback: ['email', 'sms'],
        quietHours: {
          start: '22:00',
          end: '08:00',
          timezone: 'America/New_York',
        },
      },
    }

    expect(worker.preferences?.primary).toBe('slack')
    expect(worker.preferences?.urgent).toBe('phone')
    expect(worker.preferences?.fallback).toContain('email')
    expect(worker.preferences?.quietHours?.start).toBe('22:00')
  })
})

// =============================================================================
// WORKER ACTIONS TYPE SAFETY TESTS
// =============================================================================

describe('DO Integration with digital-workers: Action Type Safety', () => {
  it('should type notify action data correctly', () => {
    const notifyData: NotifyActionData = {
      actor: 'system',
      object: { id: 'alice', name: 'Alice', type: 'human', status: 'available', contacts: {} },
      action: 'notify',
      message: 'Hello!',
      priority: 'high',
      via: 'slack',
    }

    expect(notifyData.action).toBe('notify')
    expect(notifyData.message).toBe('Hello!')
    expect(notifyData.priority).toBe('high')
  })

  it('should type ask action data correctly', () => {
    const askData: AskActionData = {
      actor: 'system',
      object: 'alice',
      action: 'ask',
      question: 'What is the status?',
      schema: { status: 'pending | approved | rejected' },
      timeout: 60000,
    }

    expect(askData.action).toBe('ask')
    expect(askData.question).toBe('What is the status?')
    expect(askData.timeout).toBe(60000)
  })

  it('should type approve action data correctly', () => {
    const approveData: ApproveActionData = {
      actor: { id: 'manager', type: 'human' },
      object: 'expense-123',
      action: 'approve',
      request: 'Approve expense for $500',
      context: { amount: 500, category: 'travel' },
      timeout: 86400000,
      escalate: true,
    }

    expect(approveData.action).toBe('approve')
    expect(approveData.request).toContain('$500')
    expect(approveData.escalate).toBe(true)
  })

  it('should type decide action data correctly', () => {
    const decideData: DecideActionData = {
      actor: 'ai-decider',
      object: 'technology-choice',
      action: 'decide',
      options: ['React', 'Vue', 'Svelte'],
      context: 'Building a new frontend',
      criteria: ['DX', 'Performance', 'Ecosystem'],
    }

    expect(decideData.action).toBe('decide')
    expect(decideData.options).toHaveLength(3)
    expect(decideData.criteria).toContain('DX')
  })

  it('should type do action data correctly', () => {
    const doData: DoActionData = {
      actor: 'deploy-bot',
      object: 'production',
      action: 'do',
      instruction: 'Deploy v2.1.0 to production',
      timeout: 300000,
      maxRetries: 3,
    }

    expect(doData.action).toBe('do')
    expect(doData.instruction).toContain('v2.1.0')
    expect(doData.maxRetries).toBe(3)
  })
})

// =============================================================================
// WORKER RESULTS TYPE SAFETY TESTS
// =============================================================================

describe('DO Integration with digital-workers: Result Type Safety', () => {
  it('should type notify result correctly', () => {
    const result: NotifyResult = {
      sent: true,
      via: ['slack', 'email'],
      recipients: [{ id: 'alice' }],
      sentAt: new Date(),
      messageId: 'msg_123',
      delivery: [
        { channel: 'slack', status: 'delivered' },
        { channel: 'email', status: 'sent' },
      ],
    }

    expect(result.sent).toBe(true)
    expect(result.via).toHaveLength(2)
    expect(result.delivery?.[0].status).toBe('delivered')
  })

  it('should type ask result correctly', () => {
    const result: AskResult<{ status: string }> = {
      answer: { status: 'approved' },
      answeredBy: { id: 'alice' },
      answeredAt: new Date(),
      via: 'slack',
    }

    expect(result.answer.status).toBe('approved')
    expect(result.answeredBy?.id).toBe('alice')
  })

  it('should type approval result correctly', () => {
    const result: ApprovalResult = {
      approved: true,
      approvedBy: { id: 'manager', name: 'Manager' },
      approvedAt: new Date(),
      notes: 'Approved for travel expenses',
      via: 'slack',
    }

    expect(result.approved).toBe(true)
    expect(result.notes).toContain('travel')
  })

  it('should type decide result correctly', () => {
    const result: DecideResult<string> = {
      choice: 'React',
      reasoning: 'Best ecosystem and community support',
      confidence: 0.85,
      alternatives: [
        { option: 'Vue', score: 75 },
        { option: 'Svelte', score: 70 },
      ],
    }

    expect(result.choice).toBe('React')
    expect(result.confidence).toBeGreaterThan(0.8)
    expect(result.alternatives).toHaveLength(2)
  })

  it('should type do result correctly', () => {
    const result: DoResult<{ deployed: boolean; version: string }> = {
      result: { deployed: true, version: '2.1.0' },
      success: true,
      duration: 45000,
      steps: [
        { action: 'start', result: { instruction: 'Deploy v2.1.0' }, timestamp: new Date() },
        { action: 'build', result: { success: true }, timestamp: new Date() },
        { action: 'deploy', result: { success: true }, timestamp: new Date() },
        { action: 'complete', result: { deployed: true }, timestamp: new Date() },
      ],
    }

    expect(result.success).toBe(true)
    expect(result.result.deployed).toBe(true)
    expect(result.steps).toHaveLength(4)
  })

  it('should type failed do result correctly', () => {
    const result: DoResult = {
      result: undefined,
      success: false,
      error: 'Deployment failed: Connection timeout',
      duration: 60000,
      steps: [
        { action: 'start', result: {}, timestamp: new Date() },
        { action: 'error', result: { error: 'Connection timeout', attempt: 3 }, timestamp: new Date() },
      ],
    }

    expect(result.success).toBe(false)
    expect(result.error).toContain('timeout')
  })
})
