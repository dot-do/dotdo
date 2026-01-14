import { describe, it, expect } from 'vitest'
import type { Worker, Agent, Human } from '../types'
import { isWorker, isAgent, isHuman, WorkerSchema, AgentSchema, HumanSchema } from '../types'

describe('Worker types', () => {
  describe('Worker base type', () => {
    it('Worker has required properties', () => {
      const worker: Worker = {
        $id: 'https://schema.org.ai/workers/w1',
        $type: 'https://schema.org.ai/Worker',
        name: 'Test Worker',
        skills: ['task-execution'],
        status: 'available'
      }
      expect(worker.$type).toBe('https://schema.org.ai/Worker')
    })

    it('isWorker validates a correct Worker object', () => {
      const worker = {
        $id: 'https://schema.org.ai/workers/w1',
        $type: 'https://schema.org.ai/Worker',
        name: 'Test Worker',
        skills: ['task-execution'],
        status: 'available'
      }
      expect(isWorker(worker)).toBe(true)
    })

    it('isWorker rejects objects missing required fields', () => {
      expect(isWorker({ name: 'Test' })).toBe(false)
      expect(isWorker({ $id: 'test', $type: 'Worker' })).toBe(false)
      expect(isWorker(null)).toBe(false)
      expect(isWorker(undefined)).toBe(false)
    })

    it('WorkerSchema validates with Zod', () => {
      const result = WorkerSchema.safeParse({
        $id: 'https://schema.org.ai/workers/w1',
        $type: 'https://schema.org.ai/Worker',
        name: 'Test Worker',
        skills: ['task-execution'],
        status: 'available'
      })
      expect(result.success).toBe(true)
    })
  })

  describe('Agent type', () => {
    it('Agent extends Worker with AI capabilities', () => {
      const agent: Agent = {
        $id: 'https://schema.org.ai/agents/a1',
        $type: 'https://schema.org.ai/Agent',
        name: 'Code Review Agent',
        skills: ['code-review', 'testing'],
        status: 'available',
        model: 'claude-3-opus',
        tools: ['read', 'write', 'bash'],
        autonomous: true
      }
      expect(agent.$type).toBe('https://schema.org.ai/Agent')
    })

    it('isAgent validates a correct Agent object', () => {
      const agent = {
        $id: 'https://schema.org.ai/agents/a1',
        $type: 'https://schema.org.ai/Agent',
        name: 'Code Review Agent',
        skills: ['code-review', 'testing'],
        status: 'available',
        model: 'claude-3-opus',
        tools: ['read', 'write', 'bash'],
        autonomous: true
      }
      expect(isAgent(agent)).toBe(true)
    })

    it('isAgent rejects objects missing Agent-specific fields', () => {
      // Missing model, tools, autonomous
      expect(isAgent({
        $id: 'test',
        $type: 'https://schema.org.ai/Agent',
        name: 'Test',
        skills: [],
        status: 'available'
      })).toBe(false)
    })

    it('AgentSchema validates with Zod', () => {
      const result = AgentSchema.safeParse({
        $id: 'https://schema.org.ai/agents/a1',
        $type: 'https://schema.org.ai/Agent',
        name: 'Code Review Agent',
        skills: ['code-review', 'testing'],
        status: 'available',
        model: 'claude-3-opus',
        tools: ['read', 'write', 'bash'],
        autonomous: true
      })
      expect(result.success).toBe(true)
    })
  })

  describe('Human type', () => {
    it('Human extends Worker with approval requirements', () => {
      const human: Human = {
        $id: 'https://schema.org.ai/humans/h1',
        $type: 'https://schema.org.ai/Human',
        name: 'Alice',
        skills: ['design', 'review'],
        status: 'available',
        requiresApproval: true,
        notificationChannels: ['email', 'slack']
      }
      expect(human.$type).toBe('https://schema.org.ai/Human')
    })

    it('isHuman validates a correct Human object', () => {
      const human = {
        $id: 'https://schema.org.ai/humans/h1',
        $type: 'https://schema.org.ai/Human',
        name: 'Alice',
        skills: ['design', 'review'],
        status: 'available',
        requiresApproval: true,
        notificationChannels: ['email', 'slack']
      }
      expect(isHuman(human)).toBe(true)
    })

    it('isHuman rejects objects missing Human-specific fields', () => {
      // Missing requiresApproval, notificationChannels
      expect(isHuman({
        $id: 'test',
        $type: 'https://schema.org.ai/Human',
        name: 'Alice',
        skills: [],
        status: 'available'
      })).toBe(false)
    })

    it('HumanSchema validates with Zod', () => {
      const result = HumanSchema.safeParse({
        $id: 'https://schema.org.ai/humans/h1',
        $type: 'https://schema.org.ai/Human',
        name: 'Alice',
        skills: ['design', 'review'],
        status: 'available',
        requiresApproval: true,
        notificationChannels: ['email', 'slack']
      })
      expect(result.success).toBe(true)
    })
  })

  describe('Type discrimination', () => {
    it('Worker status can be available, busy, away, or offline', () => {
      const statuses = ['available', 'busy', 'away', 'offline'] as const
      statuses.forEach(status => {
        const worker: Worker = {
          $id: 'https://schema.org.ai/workers/w1',
          $type: 'https://schema.org.ai/Worker',
          name: 'Test',
          skills: [],
          status
        }
        expect(isWorker(worker)).toBe(true)
      })
    })

    it('isAgent returns false for Human objects', () => {
      const human = {
        $id: 'https://schema.org.ai/humans/h1',
        $type: 'https://schema.org.ai/Human',
        name: 'Alice',
        skills: [],
        status: 'available',
        requiresApproval: true,
        notificationChannels: ['email']
      }
      expect(isAgent(human)).toBe(false)
    })

    it('isHuman returns false for Agent objects', () => {
      const agent = {
        $id: 'https://schema.org.ai/agents/a1',
        $type: 'https://schema.org.ai/Agent',
        name: 'Bot',
        skills: [],
        status: 'available',
        model: 'claude-3-opus',
        tools: [],
        autonomous: true
      }
      expect(isHuman(agent)).toBe(false)
    })
  })
})
