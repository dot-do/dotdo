/**
 * Workers Types Tests
 *
 * Tests for type definitions and runtime type guards.
 * Verifies that type exports are accessible and that
 * runtime type validation works correctly.
 *
 * @module workers/types.test
 */

import { describe, it, expect } from 'vitest'
import type {
  // Proxy configuration
  ProxyMode,
  ProxyConfig,
  HostnameConfig,
  FixedNamespaceConfig,
  APIConfig,
  NamespaceResolveResult,
  SimpleWorkerConfig,

  // Load balancing
  WorkerStatus,
  LoadBalancerStrategy,
  WorkerRegistration,
  WorkerNode,
  TaskRequest,
  RouteResult,
  WorkerLoadMetrics,
  RouteOptions,
  StatusHistoryEntry,
  RoutingHistoryEntry,
  ClusterUtilization,
  LoadBalancer,
  FullLoadBalancer,

  // Worker handlers
  WorkerHandler,

  // Messaging
  MessageType,
  DeliveryStatus,
  WorkerMessage,
  MessageEnvelope,
  BusConfig,
  MessageFilter,

  // Handoffs
  HandoffReason,
  HandoffState,
  HandoffContext,
  HandoffRequest,
  HandoffResult,
  HandoffChainEntry,

  // Escalations
  EscalationOptions,
  EscalationData,
  EscalationRelationship,
  SLAStatus,

  // Workflow
  WorkflowState,
  WorkflowStepResult,
  AIWorkflowTask,
  WorkerTier,

  // Events
  WorkerEventType,
  WorkerEvent,
} from './types'

// =============================================================================
// TYPE EXISTENCE TESTS
// =============================================================================

describe('Workers Types Existence', () => {
  describe('Proxy Configuration Types', () => {
    it('should allow valid ProxyMode values', () => {
      const hostname: ProxyMode = 'hostname'
      const path: ProxyMode = 'path'
      const fixed: ProxyMode = 'fixed'

      expect(hostname).toBe('hostname')
      expect(path).toBe('path')
      expect(fixed).toBe('fixed')
    })

    it('should allow valid ProxyConfig', () => {
      const config: ProxyConfig = {
        mode: 'hostname',
        defaultDO: 'MyDO',
      }

      expect(config.mode).toBe('hostname')
      expect(config.defaultDO).toBe('MyDO')
    })

    it('should allow HostnameConfig', () => {
      const config: HostnameConfig = {
        mode: 'hostname',
        baseDomains: ['api.example.com'],
        defaultDO: 'MainDO',
      }

      expect(config.baseDomains).toHaveLength(1)
    })

    it('should allow FixedNamespaceConfig', () => {
      const config: FixedNamespaceConfig = {
        mode: 'fixed',
        namespace: 'main',
        defaultDO: 'MainDO',
      }

      expect(config.namespace).toBe('main')
    })

    it('should allow APIConfig', () => {
      const config: APIConfig = {
        ns: '/:org',
      }

      expect(config.ns).toBe('/:org')
    })

    it('should allow NamespaceResolveResult', () => {
      const result: NamespaceResolveResult = {
        ns: 'tenant-1',
        remainingPath: '/users',
      }

      expect(result.ns).toBe('tenant-1')
      expect(result.remainingPath).toBe('/users')
    })

    it('should allow SimpleWorkerConfig', () => {
      const config: SimpleWorkerConfig = {
        stripEnvelope: true,
        defaultHeaders: { 'X-Custom': 'value' },
      }

      expect(config.stripEnvelope).toBe(true)
    })
  })

  describe('Load Balancing Types', () => {
    it('should allow valid WorkerStatus values', () => {
      const available: WorkerStatus = 'available'
      const busy: WorkerStatus = 'busy'
      const offline: WorkerStatus = 'offline'

      expect([available, busy, offline]).toEqual(['available', 'busy', 'offline'])
    })

    it('should allow valid LoadBalancerStrategy values', () => {
      const roundRobin: LoadBalancerStrategy = 'round-robin'
      const leastBusy: LoadBalancerStrategy = 'least-busy'
      const capability: LoadBalancerStrategy = 'capability'

      expect([roundRobin, leastBusy, capability]).toEqual(['round-robin', 'least-busy', 'capability'])
    })

    it('should allow WorkerRegistration', () => {
      const registration: WorkerRegistration = {
        id: 'worker-1',
        endpoint: 'http://worker1:3000',
        capabilities: ['compute', 'analyze'],
        maxConcurrentTasks: 100,
        weight: 1,
      }

      expect(registration.id).toBe('worker-1')
      expect(registration.capabilities).toHaveLength(2)
    })

    it('should allow WorkerNode', () => {
      const node: WorkerNode = {
        id: 'worker-1',
        endpoint: 'http://worker1:3000',
        status: 'available',
        capabilities: ['compute'],
        currentTasks: 5,
        maxConcurrentTasks: 100,
        cpuUsage: 0.5,
        memoryUsage: 0.3,
        weight: 1,
        registeredAt: Date.now(),
        lastHeartbeat: Date.now(),
      }

      expect(node.status).toBe('available')
    })

    it('should allow TaskRequest', () => {
      const task: TaskRequest = {
        id: 'task-1',
        type: 'compute',
        requiredCapabilities: ['analyze'],
        preferredCapabilities: ['fast'],
      }

      expect(task.id).toBe('task-1')
      expect(task.requiredCapabilities).toContain('analyze')
    })

    it('should allow RouteResult', () => {
      const result: RouteResult = {
        workerId: 'worker-1',
        endpoint: 'http://worker1:3000',
        strategy: 'round-robin',
        timestamp: Date.now(),
      }

      expect(result.strategy).toBe('round-robin')
    })

    it('should allow WorkerLoadMetrics', () => {
      const metrics: WorkerLoadMetrics = {
        currentTasks: 10,
        cpuUsage: 0.75,
        memoryUsage: 0.60,
      }

      expect(metrics.cpuUsage).toBe(0.75)
    })

    it('should allow RouteOptions', () => {
      const options: RouteOptions = {
        tiebreaker: 'cpuUsage',
      }

      expect(options.tiebreaker).toBe('cpuUsage')
    })

    it('should allow StatusHistoryEntry', () => {
      const entry: StatusHistoryEntry = {
        status: 'busy',
        timestamp: Date.now(),
      }

      expect(entry.status).toBe('busy')
    })

    it('should allow RoutingHistoryEntry', () => {
      const entry: RoutingHistoryEntry = {
        taskId: 'task-1',
        routedAt: Date.now(),
        completedAt: Date.now(),
        strategy: 'least-busy',
      }

      expect(entry.taskId).toBe('task-1')
    })

    it('should allow ClusterUtilization', () => {
      const util: ClusterUtilization = {
        avgCpuUsage: 0.6,
        avgMemoryUsage: 0.5,
        totalTasks: 100,
        workerCount: 10,
      }

      expect(util.workerCount).toBe(10)
    })
  })

  describe('Messaging Types', () => {
    it('should allow valid MessageType values', () => {
      const command: MessageType = 'command'
      const event: MessageType = 'event'
      const query: MessageType = 'query'
      const response: MessageType = 'response'

      expect([command, event, query, response]).toHaveLength(4)
    })

    it('should allow valid DeliveryStatus values', () => {
      const pending: DeliveryStatus = 'pending'
      const delivered: DeliveryStatus = 'delivered'
      const failed: DeliveryStatus = 'failed'
      const acknowledged: DeliveryStatus = 'acknowledged'

      expect([pending, delivered, failed, acknowledged]).toHaveLength(4)
    })

    it('should allow WorkerMessage', () => {
      const message: WorkerMessage = {
        id: 'msg-1',
        type: 'command',
        from: 'worker-1',
        to: 'worker-2',
        payload: { action: 'process' },
        timestamp: Date.now(),
      }

      expect(message.type).toBe('command')
    })

    it('should allow MessageEnvelope', () => {
      const envelope: MessageEnvelope = {
        message: {
          id: 'msg-1',
          type: 'event',
          from: 'worker-1',
          to: 'worker-2',
          payload: {},
          timestamp: Date.now(),
        },
        deliveryStatus: 'pending',
        attempts: 0,
        maxRetries: 3,
        createdAt: Date.now(),
      }

      expect(envelope.deliveryStatus).toBe('pending')
    })

    it('should allow BusConfig', () => {
      const config: BusConfig = {
        maxRetries: 5,
        retryDelayMs: 1000,
        deadLetterQueue: true,
      }

      expect(config.maxRetries).toBe(5)
    })

    it('should allow MessageFilter', () => {
      const filter: MessageFilter = {
        type: 'event',
        from: 'worker-1',
      }

      expect(filter.type).toBe('event')
    })
  })

  describe('Handoff Types', () => {
    it('should allow valid HandoffReason values', () => {
      const escalation: HandoffReason = 'escalation'
      const delegation: HandoffReason = 'delegation'
      const loadBalancing: HandoffReason = 'load-balancing'
      const capability: HandoffReason = 'capability-mismatch'
      const timeout: HandoffReason = 'timeout'
      const failure: HandoffReason = 'failure'

      expect([escalation, delegation, loadBalancing, capability, timeout, failure]).toHaveLength(6)
    })

    it('should allow valid HandoffState values', () => {
      const initiated: HandoffState = 'initiated'
      const accepted: HandoffState = 'accepted'
      const rejected: HandoffState = 'rejected'
      const completed: HandoffState = 'completed'
      const failed: HandoffState = 'failed'

      expect([initiated, accepted, rejected, completed, failed]).toHaveLength(5)
    })

    it('should allow HandoffContext', () => {
      const context: HandoffContext = {
        taskId: 'task-1',
        taskType: 'process',
        data: { key: 'value' },
        history: [],
        metadata: {},
      }

      expect(context.taskId).toBe('task-1')
    })

    it('should allow HandoffRequest', () => {
      const request: HandoffRequest = {
        id: 'handoff-1',
        fromWorkerId: 'worker-1',
        toWorkerId: 'worker-2',
        reason: 'escalation',
        context: {
          taskId: 'task-1',
          taskType: 'process',
          data: {},
          history: [],
        },
        timestamp: Date.now(),
      }

      expect(request.reason).toBe('escalation')
    })

    it('should allow HandoffResult', () => {
      const result: HandoffResult = {
        handoffId: 'handoff-1',
        state: 'completed',
        acceptedBy: 'worker-2',
        acceptedAt: Date.now(),
      }

      expect(result.state).toBe('completed')
    })

    it('should allow HandoffChainEntry', () => {
      const entry: HandoffChainEntry = {
        workerId: 'worker-1',
        action: 'initiated',
        timestamp: Date.now(),
        notes: 'Task too complex',
      }

      expect(entry.action).toBe('initiated')
    })
  })

  describe('Escalation Types', () => {
    it('should allow EscalationOptions', () => {
      const options: EscalationOptions = {
        priority: 'high',
        slaHours: 4,
        notifyChannels: ['slack', 'email'],
      }

      expect(options.priority).toBe('high')
    })

    it('should allow EscalationData', () => {
      const data: EscalationData = {
        reason: 'Human judgment required',
        context: { key: 'value' },
        suggestedActions: ['review', 'approve'],
      }

      expect(data.reason).toContain('Human')
    })

    it('should allow EscalationRelationship', () => {
      const rel: EscalationRelationship = {
        id: 'esc-1',
        fromWorkerId: 'worker-1',
        toWorkerId: 'worker-2',
        data: {
          reason: 'Need approval',
          context: {},
        },
        createdAt: Date.now(),
        resolvedAt: Date.now(),
      }

      expect(rel.fromWorkerId).toBe('worker-1')
    })

    it('should allow valid SLAStatus values', () => {
      const onTrack: SLAStatus = 'on-track'
      const atRisk: SLAStatus = 'at-risk'
      const breached: SLAStatus = 'breached'

      expect([onTrack, atRisk, breached]).toEqual(['on-track', 'at-risk', 'breached'])
    })
  })

  describe('Workflow Types', () => {
    it('should allow valid WorkflowState values', () => {
      const pending: WorkflowState = 'pending'
      const running: WorkflowState = 'running'
      const waitingApproval: WorkflowState = 'waiting-approval'
      const completed: WorkflowState = 'completed'
      const failed: WorkflowState = 'failed'
      const cancelled: WorkflowState = 'cancelled'

      expect([pending, running, waitingApproval, completed, failed, cancelled]).toHaveLength(6)
    })

    it('should allow WorkflowStepResult', () => {
      const result: WorkflowStepResult = {
        stepId: 'step-1',
        success: true,
        output: { result: 'done' },
        executedBy: 'worker-1',
        executedAt: Date.now(),
        duration: 1000,
      }

      expect(result.success).toBe(true)
    })

    it('should allow AIWorkflowTask', () => {
      const task: AIWorkflowTask = {
        id: 'task-1',
        type: 'generate',
        input: { prompt: 'Hello' },
        requiredTier: 'generative',
        estimatedDuration: 5000,
      }

      expect(task.requiredTier).toBe('generative')
    })

    it('should allow valid WorkerTier values', () => {
      const code: WorkerTier = 'code'
      const generative: WorkerTier = 'generative'
      const agentic: WorkerTier = 'agentic'
      const human: WorkerTier = 'human'

      expect([code, generative, agentic, human]).toEqual(['code', 'generative', 'agentic', 'human'])
    })
  })

  describe('Event Types', () => {
    it('should allow valid WorkerEventType values', () => {
      const registered: WorkerEventType = 'worker:registered'
      const deregistered: WorkerEventType = 'worker:deregistered'
      const statusChanged: WorkerEventType = 'worker:status-changed'
      const taskAssigned: WorkerEventType = 'task:assigned'
      const taskCompleted: WorkerEventType = 'task:completed'
      const handoffInitiated: WorkerEventType = 'handoff:initiated'
      const escalationCreated: WorkerEventType = 'escalation:created'

      const events = [registered, deregistered, statusChanged, taskAssigned, taskCompleted, handoffInitiated, escalationCreated]
      expect(events).toHaveLength(7)
    })

    it('should allow WorkerEvent', () => {
      const event: WorkerEvent = {
        type: 'worker:registered',
        workerId: 'worker-1',
        data: { endpoint: 'http://worker1:3000' },
        timestamp: Date.now(),
      }

      expect(event.type).toBe('worker:registered')
    })
  })
})

// =============================================================================
// INTERFACE COMPATIBILITY TESTS
// =============================================================================

describe('Interface Compatibility', () => {
  describe('LoadBalancer Interface', () => {
    it('should be implementable', () => {
      const mockBalancer: LoadBalancer = {
        route: async (task: TaskRequest) => ({
          workerId: 'mock-worker',
          endpoint: 'http://mock:3000',
          strategy: 'round-robin',
          timestamp: Date.now(),
        }),
      }

      expect(mockBalancer.route).toBeTypeOf('function')
    })
  })

  describe('FullLoadBalancer Interface', () => {
    it('should extend LoadBalancer with additional methods', () => {
      const mockFullBalancer: FullLoadBalancer = {
        route: async () => ({
          workerId: 'mock',
          endpoint: 'http://mock:3000',
          strategy: 'round-robin',
          timestamp: Date.now(),
        }),
        registerWorker: async () => ({
          id: 'mock',
          endpoint: 'http://mock:3000',
          status: 'available',
          capabilities: [],
          currentTasks: 0,
          maxConcurrentTasks: 100,
          cpuUsage: 0,
          memoryUsage: 0,
          weight: 1,
          registeredAt: Date.now(),
          lastHeartbeat: Date.now(),
        }),
        deregisterWorker: async () => {},
        updateWorkerStatus: async () => {},
        updateWorkerLoad: async () => {},
        getAvailableWorkers: async () => [],
        completeTask: async () => {},
        getRoutingHistory: async () => [],
        getStatusHistory: async () => [],
        heartbeat: async () => {},
        checkHeartbeats: async () => {},
        getTaskDistribution: async () => ({}),
        getClusterUtilization: async () => ({
          avgCpuUsage: 0,
          avgMemoryUsage: 0,
          totalTasks: 0,
          workerCount: 0,
        }),
        identifyHotspots: async () => [],
      }

      expect(mockFullBalancer.registerWorker).toBeTypeOf('function')
      expect(mockFullBalancer.getClusterUtilization).toBeTypeOf('function')
    })
  })

  describe('WorkerHandler Interface', () => {
    it('should be implementable as a fetch handler', () => {
      const handler: WorkerHandler = {
        fetch: async (request: Request) => {
          return new Response('OK')
        },
      }

      expect(handler.fetch).toBeTypeOf('function')
    })
  })
})
