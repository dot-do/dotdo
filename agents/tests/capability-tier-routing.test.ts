/**
 * Agent Capability Tier Routing Tests - [RED] Phase
 *
 * TDD failing tests for agent capability tier routing based on skill levels:
 * - junior: Basic tasks, limited autonomy, requires supervision
 * - senior: Complex tasks, higher autonomy, can mentor juniors
 * - expert: Strategic tasks, full autonomy, makes architectural decisions
 *
 * These tests define the expected behavior for:
 * - Capability tier definitions (junior, senior, expert)
 * - Task routing based on required tier
 * - Tier escalation when lower tiers can't handle
 * - Tier-based access control
 *
 * NO MOCKS - uses real GraphEngine per CLAUDE.md guidelines.
 *
 * @module agents/tests/capability-tier-routing
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { GraphEngine } from '../../db/graph'

// =============================================================================
// TYPE DEFINITIONS (To be implemented)
// =============================================================================

/**
 * Agent capability tier levels based on skill/experience
 */
type AgentCapabilityTier = 'junior' | 'senior' | 'expert'

/**
 * Task complexity levels that map to tier requirements
 */
interface TaskComplexity {
  /** Technical complexity (1-10) */
  technical: number
  /** Business impact (1-10) */
  impact: number
  /** Decision autonomy required (1-10) */
  autonomy: number
  /** Risk level (1-10) */
  risk: number
}

/**
 * Task request with tier requirements
 */
interface AgentTaskRequest {
  id: string
  type: string
  description?: string
  complexity?: TaskComplexity
  requiredTier?: AgentCapabilityTier
  requiredPermissions?: string[]
  input?: unknown
  metadata?: Record<string, unknown>
}

/**
 * Result of tier routing
 */
interface AgentTierRouteResult {
  tier: AgentCapabilityTier
  agentId: string | null
  reason?: string
  escalatedFrom?: AgentCapabilityTier
  routedAt: number
  accessGranted: boolean
  deniedPermissions?: string[]
}

/**
 * Agent registration with tier and permissions
 */
interface AgentRegistration {
  id: string
  name: string
  tier: AgentCapabilityTier
  permissions: string[]
  specializations?: string[]
  maxConcurrentTasks?: number
}

/**
 * Tier escalation record
 */
interface TierEscalationRecord {
  taskId: string
  fromTier: AgentCapabilityTier
  toTier: AgentCapabilityTier
  reason: string
  timestamp: number
}

/**
 * Tier access policy
 */
interface TierAccessPolicy {
  tier: AgentCapabilityTier
  allowedOperations: string[]
  deniedOperations: string[]
  requiresApproval: string[]
  maxRiskLevel: number
}

// =============================================================================
// PLACEHOLDER IMPLEMENTATIONS (Will fail until GREEN phase)
// =============================================================================

/**
 * Agent Capability Tier Router - to be implemented in GREEN phase
 */
class AgentCapabilityTierRouter {
  private graph: GraphEngine

  constructor(graph: GraphEngine) {
    this.graph = graph
  }

  // Tier definitions
  async getTierDefinition(_tier: AgentCapabilityTier): Promise<TierAccessPolicy | null> {
    throw new Error('Not implemented: getTierDefinition')
  }

  async setTierDefinition(_tier: AgentCapabilityTier, _policy: TierAccessPolicy): Promise<void> {
    throw new Error('Not implemented: setTierDefinition')
  }

  // Agent registration
  async registerAgent(_registration: AgentRegistration): Promise<void> {
    throw new Error('Not implemented: registerAgent')
  }

  async getAgentsByTier(_tier: AgentCapabilityTier): Promise<AgentRegistration[]> {
    throw new Error('Not implemented: getAgentsByTier')
  }

  async getAgentTier(_agentId: string): Promise<AgentCapabilityTier | null> {
    throw new Error('Not implemented: getAgentTier')
  }

  // Task routing
  async routeTask(_task: AgentTaskRequest): Promise<AgentTierRouteResult> {
    throw new Error('Not implemented: routeTask')
  }

  async selectTierForTask(_task: AgentTaskRequest): Promise<AgentCapabilityTier> {
    throw new Error('Not implemented: selectTierForTask')
  }

  // Tier escalation
  async escalateTask(
    _task: AgentTaskRequest,
    _fromTier: AgentCapabilityTier,
    _reason: string
  ): Promise<AgentTierRouteResult> {
    throw new Error('Not implemented: escalateTask')
  }

  async getEscalationHistory(_taskId: string): Promise<TierEscalationRecord[]> {
    throw new Error('Not implemented: getEscalationHistory')
  }

  async canEscalate(_fromTier: AgentCapabilityTier): Promise<boolean> {
    throw new Error('Not implemented: canEscalate')
  }

  // Access control
  async checkAccess(
    _agentId: string,
    _operation: string,
    _task: AgentTaskRequest
  ): Promise<{ allowed: boolean; reason?: string }> {
    throw new Error('Not implemented: checkAccess')
  }

  async getAgentPermissions(_agentId: string): Promise<string[]> {
    throw new Error('Not implemented: getAgentPermissions')
  }

  async setAgentPermissions(_agentId: string, _permissions: string[]): Promise<void> {
    throw new Error('Not implemented: setAgentPermissions')
  }

  // Complexity assessment
  async assessTaskComplexity(_task: AgentTaskRequest): Promise<TaskComplexity> {
    throw new Error('Not implemented: assessTaskComplexity')
  }

  async calculateRequiredTier(_complexity: TaskComplexity): Promise<AgentCapabilityTier> {
    throw new Error('Not implemented: calculateRequiredTier')
  }
}

// =============================================================================
// TESTS
// =============================================================================

describe('Agent Capability Tier Routing [RED]', () => {
  let graph: GraphEngine
  let router: AgentCapabilityTierRouter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    graph = new GraphEngine()
    router = new AgentCapabilityTierRouter(graph)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // 1. CAPABILITY TIER DEFINITIONS
  // ===========================================================================

  describe('Capability Tier Definitions', () => {
    describe('Junior Tier', () => {
      it('should define junior tier with limited autonomy', async () => {
        const juniorPolicy: TierAccessPolicy = {
          tier: 'junior',
          allowedOperations: ['read', 'create', 'update-own'],
          deniedOperations: ['delete', 'deploy', 'approve'],
          requiresApproval: ['update-shared', 'create-critical'],
          maxRiskLevel: 3,
        }

        await router.setTierDefinition('junior', juniorPolicy)
        const policy = await router.getTierDefinition('junior')

        expect(policy).not.toBeNull()
        expect(policy?.tier).toBe('junior')
        expect(policy?.maxRiskLevel).toBe(3)
        expect(policy?.deniedOperations).toContain('deploy')
        expect(policy?.requiresApproval).toContain('update-shared')
      })

      it('should restrict junior tier from high-impact operations', async () => {
        await router.registerAgent({
          id: 'agent-junior-1',
          name: 'Junior Dev Agent',
          tier: 'junior',
          permissions: ['read', 'create', 'update-own'],
        })

        const task: AgentTaskRequest = {
          id: 'task-deploy-1',
          type: 'deploy',
          complexity: {
            technical: 5,
            impact: 8, // High impact
            autonomy: 7,
            risk: 7,
          },
        }

        const result = await router.routeTask(task)

        // Should NOT route to junior due to high impact
        expect(result.tier).not.toBe('junior')
      })
    })

    describe('Senior Tier', () => {
      it('should define senior tier with moderate autonomy', async () => {
        const seniorPolicy: TierAccessPolicy = {
          tier: 'senior',
          allowedOperations: ['read', 'create', 'update', 'delete', 'review'],
          deniedOperations: ['deploy-production', 'approve-budget'],
          requiresApproval: ['deploy-staging', 'architectural-change'],
          maxRiskLevel: 6,
        }

        await router.setTierDefinition('senior', seniorPolicy)
        const policy = await router.getTierDefinition('senior')

        expect(policy).not.toBeNull()
        expect(policy?.tier).toBe('senior')
        expect(policy?.maxRiskLevel).toBe(6)
        expect(policy?.allowedOperations).toContain('review')
        expect(policy?.deniedOperations).toContain('deploy-production')
      })

      it('should allow senior tier to mentor junior tasks', async () => {
        await router.registerAgent({
          id: 'agent-senior-1',
          name: 'Senior Dev Agent',
          tier: 'senior',
          permissions: ['read', 'create', 'update', 'delete', 'review', 'mentor'],
        })

        const mentorTask: AgentTaskRequest = {
          id: 'task-mentor-1',
          type: 'code-review',
          description: 'Review junior developer code',
          complexity: {
            technical: 4,
            impact: 3,
            autonomy: 5,
            risk: 2,
          },
        }

        const result = await router.routeTask(mentorTask)

        expect(result.tier).toBe('senior')
        expect(result.accessGranted).toBe(true)
      })
    })

    describe('Expert Tier', () => {
      it('should define expert tier with full autonomy', async () => {
        const expertPolicy: TierAccessPolicy = {
          tier: 'expert',
          allowedOperations: [
            'read',
            'create',
            'update',
            'delete',
            'deploy',
            'approve',
            'architectural-decision',
          ],
          deniedOperations: [], // No restrictions
          requiresApproval: [], // Full autonomy
          maxRiskLevel: 10,
        }

        await router.setTierDefinition('expert', expertPolicy)
        const policy = await router.getTierDefinition('expert')

        expect(policy).not.toBeNull()
        expect(policy?.tier).toBe('expert')
        expect(policy?.maxRiskLevel).toBe(10)
        expect(policy?.deniedOperations).toHaveLength(0)
        expect(policy?.requiresApproval).toHaveLength(0)
      })

      it('should allow expert tier to make architectural decisions', async () => {
        await router.registerAgent({
          id: 'agent-expert-1',
          name: 'Principal Agent',
          tier: 'expert',
          permissions: ['*'], // Full permissions
          specializations: ['architecture', 'security', 'performance'],
        })

        const architectureTask: AgentTaskRequest = {
          id: 'task-arch-1',
          type: 'architectural-decision',
          description: 'Design system architecture for new service',
          complexity: {
            technical: 9,
            impact: 9,
            autonomy: 10,
            risk: 8,
          },
        }

        const result = await router.routeTask(architectureTask)

        expect(result.tier).toBe('expert')
        expect(result.accessGranted).toBe(true)
      })
    })

    describe('Tier Hierarchy', () => {
      it('should enforce tier ordering: junior < senior < expert', async () => {
        // Register agents at each tier
        await router.registerAgent({
          id: 'agent-j',
          name: 'Junior',
          tier: 'junior',
          permissions: ['read'],
        })
        await router.registerAgent({
          id: 'agent-s',
          name: 'Senior',
          tier: 'senior',
          permissions: ['read', 'write'],
        })
        await router.registerAgent({
          id: 'agent-e',
          name: 'Expert',
          tier: 'expert',
          permissions: ['*'],
        })

        const juniorTier = await router.getAgentTier('agent-j')
        const seniorTier = await router.getAgentTier('agent-s')
        const expertTier = await router.getAgentTier('agent-e')

        expect(juniorTier).toBe('junior')
        expect(seniorTier).toBe('senior')
        expect(expertTier).toBe('expert')
      })
    })
  })

  // ===========================================================================
  // 2. TASK ROUTING BASED ON REQUIRED TIER
  // ===========================================================================

  describe('Task Routing Based on Required Tier', () => {
    beforeEach(async () => {
      // Register agents at each tier
      await router.registerAgent({
        id: 'junior-agent',
        name: 'Junior Developer',
        tier: 'junior',
        permissions: ['read', 'create', 'update-own'],
        maxConcurrentTasks: 3,
      })
      await router.registerAgent({
        id: 'senior-agent',
        name: 'Senior Developer',
        tier: 'senior',
        permissions: ['read', 'create', 'update', 'delete', 'review'],
        maxConcurrentTasks: 5,
      })
      await router.registerAgent({
        id: 'expert-agent',
        name: 'Principal Engineer',
        tier: 'expert',
        permissions: ['*'],
        maxConcurrentTasks: 10,
      })
    })

    it('should route simple tasks to junior tier', async () => {
      const simpleTask: AgentTaskRequest = {
        id: 'task-simple-1',
        type: 'bug-fix',
        description: 'Fix typo in documentation',
        complexity: {
          technical: 1,
          impact: 1,
          autonomy: 1,
          risk: 1,
        },
      }

      const result = await router.routeTask(simpleTask)

      expect(result.tier).toBe('junior')
      expect(result.agentId).toBe('junior-agent')
      expect(result.accessGranted).toBe(true)
    })

    it('should route medium complexity tasks to senior tier', async () => {
      const mediumTask: AgentTaskRequest = {
        id: 'task-medium-1',
        type: 'feature-implementation',
        description: 'Implement new API endpoint',
        complexity: {
          technical: 5,
          impact: 5,
          autonomy: 5,
          risk: 4,
        },
      }

      const result = await router.routeTask(mediumTask)

      expect(result.tier).toBe('senior')
      expect(result.agentId).toBe('senior-agent')
      expect(result.accessGranted).toBe(true)
    })

    it('should route high complexity tasks to expert tier', async () => {
      const complexTask: AgentTaskRequest = {
        id: 'task-complex-1',
        type: 'system-redesign',
        description: 'Redesign authentication system',
        complexity: {
          technical: 9,
          impact: 9,
          autonomy: 8,
          risk: 8,
        },
      }

      const result = await router.routeTask(complexTask)

      expect(result.tier).toBe('expert')
      expect(result.agentId).toBe('expert-agent')
      expect(result.accessGranted).toBe(true)
    })

    it('should respect explicitly required tier', async () => {
      const taskWithRequiredTier: AgentTaskRequest = {
        id: 'task-required-1',
        type: 'code-review',
        description: 'Review critical security code',
        requiredTier: 'expert', // Explicitly require expert
        complexity: {
          technical: 3, // Low technical complexity
          impact: 9, // High impact
          autonomy: 3,
          risk: 9, // High risk
        },
      }

      const result = await router.routeTask(taskWithRequiredTier)

      expect(result.tier).toBe('expert')
      expect(result.reason).toContain('explicitly required')
    })

    it('should calculate required tier from complexity scores', async () => {
      const complexity: TaskComplexity = {
        technical: 6,
        impact: 7,
        autonomy: 6,
        risk: 5,
      }

      const requiredTier = await router.calculateRequiredTier(complexity)

      // Average score is 6, should require senior tier
      expect(requiredTier).toBe('senior')
    })

    it('should route to highest available tier when no exact match', async () => {
      // Deregister senior agent
      await router.registerAgent({
        id: 'senior-agent',
        name: 'Senior Developer',
        tier: 'senior',
        permissions: [],
        maxConcurrentTasks: 0, // No capacity
      })

      const mediumTask: AgentTaskRequest = {
        id: 'task-overflow-1',
        type: 'feature',
        complexity: {
          technical: 5,
          impact: 5,
          autonomy: 5,
          risk: 4,
        },
      }

      const result = await router.routeTask(mediumTask)

      // Should escalate to expert since senior has no capacity
      expect(result.tier).toBe('expert')
      expect(result.escalatedFrom).toBe('senior')
    })
  })

  // ===========================================================================
  // 3. TIER ESCALATION WHEN LOWER TIERS CAN'T HANDLE
  // ===========================================================================

  describe('Tier Escalation', () => {
    beforeEach(async () => {
      await router.registerAgent({
        id: 'junior-1',
        name: 'Junior 1',
        tier: 'junior',
        permissions: ['read', 'create'],
      })
      await router.registerAgent({
        id: 'senior-1',
        name: 'Senior 1',
        tier: 'senior',
        permissions: ['read', 'create', 'update', 'delete'],
      })
      await router.registerAgent({
        id: 'expert-1',
        name: 'Expert 1',
        tier: 'expert',
        permissions: ['*'],
      })
    })

    it('should escalate from junior to senior on failure', async () => {
      const task: AgentTaskRequest = {
        id: 'task-esc-1',
        type: 'debugging',
        description: 'Debug complex race condition',
      }

      // First route to junior
      const initialResult = await router.routeTask(task)
      expect(initialResult.tier).toBe('junior')

      // Junior fails, escalate
      const escalated = await router.escalateTask(
        task,
        'junior',
        'Task complexity exceeded junior capabilities'
      )

      expect(escalated.tier).toBe('senior')
      expect(escalated.escalatedFrom).toBe('junior')
      expect(escalated.reason).toContain('exceeded')
    })

    it('should escalate from senior to expert on failure', async () => {
      const task: AgentTaskRequest = {
        id: 'task-esc-2',
        type: 'architecture-review',
        description: 'Review microservices architecture',
      }

      const escalated = await router.escalateTask(
        task,
        'senior',
        'Requires architectural expertise'
      )

      expect(escalated.tier).toBe('expert')
      expect(escalated.escalatedFrom).toBe('senior')
    })

    it('should not escalate beyond expert tier', async () => {
      const task: AgentTaskRequest = {
        id: 'task-esc-3',
        type: 'impossible-task',
        description: 'Task that even experts cannot handle',
      }

      await expect(
        router.escalateTask(task, 'expert', 'Expert also failed')
      ).rejects.toThrow(/cannot escalate beyond expert/i)
    })

    it('should track escalation history', async () => {
      const task: AgentTaskRequest = {
        id: 'task-history-1',
        type: 'multi-escalation',
      }

      await router.escalateTask(task, 'junior', 'First escalation')
      await router.escalateTask(task, 'senior', 'Second escalation')

      const history = await router.getEscalationHistory('task-history-1')

      expect(history).toHaveLength(2)
      expect(history[0]!.fromTier).toBe('junior')
      expect(history[0]!.toTier).toBe('senior')
      expect(history[1]!.fromTier).toBe('senior')
      expect(history[1]!.toTier).toBe('expert')
    })

    it('should validate escalation is possible before attempting', async () => {
      const canEscalateJunior = await router.canEscalate('junior')
      const canEscalateSenior = await router.canEscalate('senior')
      const canEscalateExpert = await router.canEscalate('expert')

      expect(canEscalateJunior).toBe(true)
      expect(canEscalateSenior).toBe(true)
      expect(canEscalateExpert).toBe(false)
    })

    it('should escalate based on task risk level exceeding tier threshold', async () => {
      // Set tier policies with risk thresholds
      await router.setTierDefinition('junior', {
        tier: 'junior',
        allowedOperations: ['read'],
        deniedOperations: [],
        requiresApproval: [],
        maxRiskLevel: 3,
      })

      const riskyTask: AgentTaskRequest = {
        id: 'task-risky-1',
        type: 'database-migration',
        complexity: {
          technical: 3,
          impact: 3,
          autonomy: 2,
          risk: 7, // Exceeds junior max risk of 3
        },
      }

      const result = await router.routeTask(riskyTask)

      // Should auto-escalate due to risk level
      expect(result.tier).not.toBe('junior')
      expect(['senior', 'expert']).toContain(result.tier)
    })

    it('should include reason for automatic escalation', async () => {
      const task: AgentTaskRequest = {
        id: 'task-auto-esc-1',
        type: 'deployment',
        requiredPermissions: ['deploy-production'],
      }

      const result = await router.routeTask(task)

      // Junior doesn't have deploy-production permission
      expect(result.tier).not.toBe('junior')
      expect(result.reason).toMatch(/permission|escalat/i)
    })
  })

  // ===========================================================================
  // 4. TIER-BASED ACCESS CONTROL
  // ===========================================================================

  describe('Tier-Based Access Control', () => {
    beforeEach(async () => {
      // Set up tier policies
      await router.setTierDefinition('junior', {
        tier: 'junior',
        allowedOperations: ['read', 'create-draft', 'update-own'],
        deniedOperations: ['delete', 'deploy', 'approve', 'access-secrets'],
        requiresApproval: ['publish', 'update-shared'],
        maxRiskLevel: 3,
      })

      await router.setTierDefinition('senior', {
        tier: 'senior',
        allowedOperations: ['read', 'create', 'update', 'delete', 'publish'],
        deniedOperations: ['deploy-production', 'access-secrets', 'approve-budget'],
        requiresApproval: ['deploy-staging'],
        maxRiskLevel: 6,
      })

      await router.setTierDefinition('expert', {
        tier: 'expert',
        allowedOperations: ['*'],
        deniedOperations: [],
        requiresApproval: [],
        maxRiskLevel: 10,
      })

      // Register agents
      await router.registerAgent({
        id: 'junior-agent',
        name: 'Junior',
        tier: 'junior',
        permissions: ['read', 'create-draft', 'update-own'],
      })

      await router.registerAgent({
        id: 'senior-agent',
        name: 'Senior',
        tier: 'senior',
        permissions: ['read', 'create', 'update', 'delete', 'publish'],
      })

      await router.registerAgent({
        id: 'expert-agent',
        name: 'Expert',
        tier: 'expert',
        permissions: ['*'],
      })
    })

    it('should deny junior access to restricted operations', async () => {
      const task: AgentTaskRequest = {
        id: 'task-access-1',
        type: 'delete-record',
        requiredPermissions: ['delete'],
      }

      const access = await router.checkAccess('junior-agent', 'delete', task)

      expect(access.allowed).toBe(false)
      expect(access.reason).toContain('denied')
    })

    it('should allow senior access to their permitted operations', async () => {
      const task: AgentTaskRequest = {
        id: 'task-access-2',
        type: 'publish-article',
        requiredPermissions: ['publish'],
      }

      const access = await router.checkAccess('senior-agent', 'publish', task)

      expect(access.allowed).toBe(true)
    })

    it('should allow expert access to all operations', async () => {
      const task: AgentTaskRequest = {
        id: 'task-access-3',
        type: 'access-secrets',
        requiredPermissions: ['access-secrets'],
      }

      const access = await router.checkAccess('expert-agent', 'access-secrets', task)

      expect(access.allowed).toBe(true)
    })

    it('should require approval for operations in requiresApproval list', async () => {
      const task: AgentTaskRequest = {
        id: 'task-approval-1',
        type: 'deploy-staging',
        requiredPermissions: ['deploy-staging'],
      }

      const access = await router.checkAccess('senior-agent', 'deploy-staging', task)

      // Should indicate approval required, not outright denied
      expect(access.allowed).toBe(false)
      expect(access.reason).toContain('approval')
    })

    it('should deny access when task risk exceeds tier threshold', async () => {
      const riskyTask: AgentTaskRequest = {
        id: 'task-risk-1',
        type: 'high-risk-operation',
        complexity: {
          technical: 2,
          impact: 2,
          autonomy: 2,
          risk: 8, // Exceeds junior max of 3
        },
      }

      const access = await router.checkAccess('junior-agent', 'execute', riskyTask)

      expect(access.allowed).toBe(false)
      expect(access.reason).toMatch(/risk|threshold/i)
    })

    it('should allow access when all required permissions are met', async () => {
      const task: AgentTaskRequest = {
        id: 'task-multi-perm-1',
        type: 'complex-operation',
        requiredPermissions: ['read', 'create', 'update'],
      }

      const access = await router.checkAccess('senior-agent', 'complex-operation', task)

      expect(access.allowed).toBe(true)
    })

    it('should deny access when any required permission is missing', async () => {
      const task: AgentTaskRequest = {
        id: 'task-missing-perm-1',
        type: 'privileged-operation',
        requiredPermissions: ['read', 'deploy'], // Junior doesn't have deploy
      }

      const access = await router.checkAccess('junior-agent', 'privileged-operation', task)

      expect(access.allowed).toBe(false)
    })

    it('should return denied permissions in result', async () => {
      const task: AgentTaskRequest = {
        id: 'task-denied-list-1',
        type: 'multi-permission-op',
        requiredPermissions: ['read', 'delete', 'deploy'],
      }

      const result = await router.routeTask(task)

      // If routed to junior (which shouldn't happen), check denied
      if (result.tier === 'junior') {
        expect(result.deniedPermissions).toContain('delete')
        expect(result.deniedPermissions).toContain('deploy')
      }
    })

    it('should allow updating agent permissions', async () => {
      // Grant additional permission to junior
      await router.setAgentPermissions('junior-agent', [
        'read',
        'create-draft',
        'update-own',
        'publish', // New permission
      ])

      const permissions = await router.getAgentPermissions('junior-agent')

      expect(permissions).toContain('publish')
    })

    it('should inherit tier permissions for wildcard', async () => {
      const expertPerms = await router.getAgentPermissions('expert-agent')

      // Wildcard should effectively grant all permissions
      expect(expertPerms).toContain('*')
    })
  })

  // ===========================================================================
  // 5. COMPLEXITY ASSESSMENT
  // ===========================================================================

  describe('Complexity Assessment', () => {
    it('should assess task complexity from description', async () => {
      const task: AgentTaskRequest = {
        id: 'task-assess-1',
        type: 'refactoring',
        description: 'Refactor legacy authentication module with proper error handling',
        metadata: {
          linesOfCode: 500,
          dependencies: 12,
          testCoverage: 0.3,
        },
      }

      const complexity = await router.assessTaskComplexity(task)

      expect(complexity.technical).toBeGreaterThanOrEqual(1)
      expect(complexity.technical).toBeLessThanOrEqual(10)
      expect(complexity.impact).toBeGreaterThanOrEqual(1)
      expect(complexity.impact).toBeLessThanOrEqual(10)
      expect(complexity.autonomy).toBeGreaterThanOrEqual(1)
      expect(complexity.autonomy).toBeLessThanOrEqual(10)
      expect(complexity.risk).toBeGreaterThanOrEqual(1)
      expect(complexity.risk).toBeLessThanOrEqual(10)
    })

    it('should map low complexity to junior tier', async () => {
      const lowComplexity: TaskComplexity = {
        technical: 2,
        impact: 2,
        autonomy: 1,
        risk: 1,
      }

      const tier = await router.calculateRequiredTier(lowComplexity)

      expect(tier).toBe('junior')
    })

    it('should map medium complexity to senior tier', async () => {
      const mediumComplexity: TaskComplexity = {
        technical: 5,
        impact: 5,
        autonomy: 5,
        risk: 4,
      }

      const tier = await router.calculateRequiredTier(mediumComplexity)

      expect(tier).toBe('senior')
    })

    it('should map high complexity to expert tier', async () => {
      const highComplexity: TaskComplexity = {
        technical: 8,
        impact: 9,
        autonomy: 8,
        risk: 7,
      }

      const tier = await router.calculateRequiredTier(highComplexity)

      expect(tier).toBe('expert')
    })

    it('should weight risk higher in tier calculation', async () => {
      // Low technical but high risk should still require senior/expert
      const riskyButSimple: TaskComplexity = {
        technical: 2,
        impact: 3,
        autonomy: 2,
        risk: 9, // High risk
      }

      const tier = await router.calculateRequiredTier(riskyButSimple)

      expect(tier).not.toBe('junior')
    })
  })

  // ===========================================================================
  // 6. GRAPH INTEGRATION
  // ===========================================================================

  describe('Graph Integration', () => {
    it('should store agent registrations in graph', async () => {
      await router.registerAgent({
        id: 'graph-agent-1',
        name: 'Graph Test Agent',
        tier: 'senior',
        permissions: ['read', 'write'],
        specializations: ['testing', 'automation'],
      })

      const node = await graph.getNode('graph-agent-1')

      expect(node).not.toBeNull()
      expect(node?.label).toBe('Agent')
      expect(node?.properties.tier).toBe('senior')
    })

    it('should query agents by tier from graph', async () => {
      await router.registerAgent({
        id: 'q-junior-1',
        name: 'Junior 1',
        tier: 'junior',
        permissions: [],
      })
      await router.registerAgent({
        id: 'q-junior-2',
        name: 'Junior 2',
        tier: 'junior',
        permissions: [],
      })
      await router.registerAgent({
        id: 'q-senior-1',
        name: 'Senior 1',
        tier: 'senior',
        permissions: [],
      })

      const juniorAgents = await router.getAgentsByTier('junior')

      expect(juniorAgents).toHaveLength(2)
      expect(juniorAgents.every(a => a.tier === 'junior')).toBe(true)
    })

    it('should store routing decisions in graph', async () => {
      await router.registerAgent({
        id: 'routing-agent',
        name: 'Routing Test',
        tier: 'senior',
        permissions: ['*'],
      })

      const task: AgentTaskRequest = {
        id: 'graph-task-1',
        type: 'test',
        complexity: {
          technical: 5,
          impact: 5,
          autonomy: 5,
          risk: 4,
        },
      }

      await router.routeTask(task)

      // Check for ROUTED_TO edge in graph
      const edges = await graph.queryEdges({
        type: 'ROUTED_TO',
      })

      const routingEdge = edges.find(e => e.properties.taskId === 'graph-task-1')
      expect(routingEdge).toBeDefined()
    })

    it('should store escalation records in graph', async () => {
      await router.registerAgent({
        id: 'esc-junior',
        name: 'Junior',
        tier: 'junior',
        permissions: [],
      })
      await router.registerAgent({
        id: 'esc-senior',
        name: 'Senior',
        tier: 'senior',
        permissions: ['*'],
      })

      const task: AgentTaskRequest = {
        id: 'esc-graph-task-1',
        type: 'escalatable',
      }

      await router.escalateTask(task, 'junior', 'Needs more expertise')

      // Check for ESCALATED_TO edge in graph
      const edges = await graph.queryEdges({
        type: 'ESCALATED_TO',
      })

      const escalationEdge = edges.find(e => e.properties.taskId === 'esc-graph-task-1')
      expect(escalationEdge).toBeDefined()
      expect(escalationEdge?.properties.fromTier).toBe('junior')
      expect(escalationEdge?.properties.toTier).toBe('senior')
    })
  })
})
