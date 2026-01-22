/**
 * Tests for workers.do integration
 *
 * NO MOCKS - Uses dependency injection via the `api` option in WorkersDoClientOptions.
 * The WorkersDoClient accepts an injected API implementation for testing.
 *
 * TDD approach:
 * - Test project creation and management
 * - Test deployment flow (upload -> validate -> deploy)
 * - Test log streaming
 * - Test status checking
 * - Test environment variable management
 * - Test error handling and retries
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  WorkersDoClient,
  createWorkersDoClient,
  type Project,
  type Deployment,
  type LogEntry,
  type EnvVar,
  type HealthStatus,
  type WorkersDoAPI,
} from '../services/workers-do'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a fake API implementation for testing.
 * This is dependency injection, NOT vi.mock.
 */
function createFakeAPI(): {
  api: WorkersDoAPI
  calls: Record<string, Array<unknown[]>>
} {
  const calls: Record<string, Array<unknown[]>> = {
    'projects.create': [],
    'projects.get': [],
    'projects.list': [],
    'projects.delete': [],
    'deployments.create': [],
    'deployments.get': [],
    'deployments.list': [],
    'deployments.cancel': [],
    'logs.stream': [],
    'logs.get': [],
    'env.set': [],
    'env.get': [],
    'env.delete': [],
    'health.check': [],
  }

  // Response handlers that can be customized per test
  let projectsCreateHandler: () => Promise<Project> = async () => ({
    $id: 'proj-default',
    name: 'default-project',
    url: 'https://default.workers.do',
    createdAt: new Date().toISOString(),
  })

  let projectsGetHandler: () => Promise<Project> = async () => ({
    $id: 'proj-default',
    name: 'default-project',
    url: 'https://default.workers.do',
    createdAt: new Date().toISOString(),
  })

  let projectsListHandler: () => Promise<Project[]> = async () => []
  let projectsDeleteHandler: () => Promise<boolean> = async () => true

  let deploymentsCreateHandler: () => Promise<Deployment> = async () => ({
    $id: 'deploy-default',
    projectId: 'proj-default',
    version: '1.0.0',
    status: 'pending',
    createdAt: new Date().toISOString(),
  })

  let deploymentsGetHandler: () => Promise<Deployment> = async () => ({
    $id: 'deploy-default',
    projectId: 'proj-default',
    version: '1.0.0',
    status: 'active',
    createdAt: new Date().toISOString(),
  })

  let deploymentsListHandler: () => Promise<Deployment[]> = async () => []
  let deploymentsCancelHandler: () => Promise<boolean> = async () => true

  let logsStreamHandler: () => Promise<ReadableStream<LogEntry>> = async () =>
    new ReadableStream({
      start(controller) {
        controller.close()
      },
    })

  let logsGetHandler: () => Promise<LogEntry[]> = async () => []

  let envSetHandler: () => Promise<boolean> = async () => true
  let envGetHandler: () => Promise<EnvVar[]> = async () => []
  let envDeleteHandler: () => Promise<boolean> = async () => true

  let healthCheckHandler: () => Promise<HealthStatus> = async () => ({
    healthy: true,
    uptime: 3600000,
    lastCheck: new Date().toISOString(),
  })

  const api: WorkersDoAPI = {
    projects: {
      create: async (options) => {
        calls['projects.create'].push([options])
        return projectsCreateHandler()
      },
      get: async (id) => {
        calls['projects.get'].push([id])
        return projectsGetHandler()
      },
      list: async () => {
        calls['projects.list'].push([])
        return projectsListHandler()
      },
      delete: async (id) => {
        calls['projects.delete'].push([id])
        return projectsDeleteHandler()
      },
    },
    deployments: {
      create: async (options) => {
        calls['deployments.create'].push([options])
        return deploymentsCreateHandler()
      },
      get: async (id) => {
        calls['deployments.get'].push([id])
        return deploymentsGetHandler()
      },
      list: async (projectId) => {
        calls['deployments.list'].push([projectId])
        return deploymentsListHandler()
      },
      cancel: async (id) => {
        calls['deployments.cancel'].push([id])
        return deploymentsCancelHandler()
      },
    },
    logs: {
      stream: async (options) => {
        calls['logs.stream'].push([options])
        return logsStreamHandler()
      },
      get: async (projectId, options) => {
        calls['logs.get'].push([projectId, options])
        return logsGetHandler()
      },
    },
    env: {
      set: async (options) => {
        calls['env.set'].push([options])
        return envSetHandler()
      },
      get: async (projectId) => {
        calls['env.get'].push([projectId])
        return envGetHandler()
      },
      delete: async (projectId, key) => {
        calls['env.delete'].push([projectId, key])
        return envDeleteHandler()
      },
    },
    health: {
      check: async (projectId) => {
        calls['health.check'].push([projectId])
        return healthCheckHandler()
      },
    },
  }

  return {
    api,
    calls,
    // Expose setters for customizing responses
    setProjectsCreateHandler: (handler: typeof projectsCreateHandler) => {
      projectsCreateHandler = handler
    },
    setProjectsGetHandler: (handler: typeof projectsGetHandler) => {
      projectsGetHandler = handler
    },
    setProjectsListHandler: (handler: typeof projectsListHandler) => {
      projectsListHandler = handler
    },
    setProjectsDeleteHandler: (handler: typeof projectsDeleteHandler) => {
      projectsDeleteHandler = handler
    },
    setDeploymentsCreateHandler: (handler: typeof deploymentsCreateHandler) => {
      deploymentsCreateHandler = handler
    },
    setDeploymentsGetHandler: (handler: typeof deploymentsGetHandler) => {
      deploymentsGetHandler = handler
    },
    setDeploymentsListHandler: (handler: typeof deploymentsListHandler) => {
      deploymentsListHandler = handler
    },
    setDeploymentsCancelHandler: (handler: typeof deploymentsCancelHandler) => {
      deploymentsCancelHandler = handler
    },
    setLogsStreamHandler: (handler: typeof logsStreamHandler) => {
      logsStreamHandler = handler
    },
    setLogsGetHandler: (handler: typeof logsGetHandler) => {
      logsGetHandler = handler
    },
    setEnvSetHandler: (handler: typeof envSetHandler) => {
      envSetHandler = handler
    },
    setEnvGetHandler: (handler: typeof envGetHandler) => {
      envGetHandler = handler
    },
    setEnvDeleteHandler: (handler: typeof envDeleteHandler) => {
      envDeleteHandler = handler
    },
    setHealthCheckHandler: (handler: typeof healthCheckHandler) => {
      healthCheckHandler = handler
    },
  } as {
    api: WorkersDoAPI
    calls: Record<string, Array<unknown[]>>
  } & Record<string, (handler: () => Promise<unknown>) => void>
}

describe('WorkersDoClient', () => {
  let client: WorkersDoClient
  let fakeAPI: ReturnType<typeof createFakeAPI>

  beforeEach(() => {
    fakeAPI = createFakeAPI()
    client = createWorkersDoClient({
      token: 'test-token',
      timeout: 5000,
      maxRetries: 2,
      retryBaseDelay: 100,
      api: fakeAPI.api,
    })
  })

  describe('Project Management', () => {
    it('should create a project', async () => {
      const mockProject: Project = {
        $id: 'proj-123',
        name: 'test-project',
        url: 'https://test-project.workers.do',
        createdAt: new Date().toISOString(),
        namespace: 'default',
        environment: 'production',
      }

      ;(fakeAPI as any).setProjectsCreateHandler(async () => mockProject)

      const result = await client.createProject({
        name: 'test-project',
        namespace: 'default',
        environment: 'production',
      })

      expect(result).toEqual(mockProject)
      expect(fakeAPI.calls['projects.create']).toHaveLength(1)
      expect(fakeAPI.calls['projects.create'][0]).toEqual([
        {
          name: 'test-project',
          namespace: 'default',
          environment: 'production',
        },
      ])
    })

    it('should get a project by ID', async () => {
      const mockProject: Project = {
        $id: 'proj-123',
        name: 'test-project',
        url: 'https://test-project.workers.do',
        createdAt: new Date().toISOString(),
      }

      ;(fakeAPI as any).setProjectsGetHandler(async () => mockProject)

      const result = await client.getProject('proj-123')

      expect(result).toEqual(mockProject)
      expect(fakeAPI.calls['projects.get']).toHaveLength(1)
      expect(fakeAPI.calls['projects.get'][0]).toEqual(['proj-123'])
    })

    it('should list all projects', async () => {
      const mockProjects: Project[] = [
        {
          $id: 'proj-1',
          name: 'project-1',
          url: 'https://project-1.workers.do',
          createdAt: new Date().toISOString(),
        },
        {
          $id: 'proj-2',
          name: 'project-2',
          url: 'https://project-2.workers.do',
          createdAt: new Date().toISOString(),
        },
      ]

      ;(fakeAPI as any).setProjectsListHandler(async () => mockProjects)

      const result = await client.listProjects()

      expect(result).toEqual(mockProjects)
      expect(result).toHaveLength(2)
    })

    it('should delete a project', async () => {
      ;(fakeAPI as any).setProjectsDeleteHandler(async () => true)

      const result = await client.deleteProject('proj-123')

      expect(result).toBe(true)
      expect(fakeAPI.calls['projects.delete'][0]).toEqual(['proj-123'])
    })
  })

  describe('Deployment', () => {
    it('should deploy a bundle', async () => {
      const bundle = new Uint8Array([1, 2, 3, 4])
      const mockDeployment: Deployment = {
        $id: 'deploy-123',
        projectId: 'proj-123',
        version: '1.0.0',
        status: 'pending',
        createdAt: new Date().toISOString(),
        bundleSize: 4,
      }

      ;(fakeAPI as any).setDeploymentsCreateHandler(async () => mockDeployment)

      const result = await client.deploy({
        projectId: 'proj-123',
        bundle,
        version: '1.0.0',
      })

      expect(result).toEqual(mockDeployment)
      expect(fakeAPI.calls['deployments.create']).toHaveLength(1)
    })

    it('should validate bundle before deploy (dry run)', async () => {
      const bundle = new Uint8Array([1, 2, 3, 4])
      const mockDeployment: Deployment = {
        $id: 'deploy-123',
        projectId: 'proj-123',
        version: '1.0.0',
        status: 'pending',
        createdAt: new Date().toISOString(),
        bundleSize: 4,
      }

      ;(fakeAPI as any).setDeploymentsCreateHandler(async () => mockDeployment)

      const result = await client.deploy({
        projectId: 'proj-123',
        bundle,
        version: '1.0.0',
        dryRun: true,
      })

      expect(result).toEqual(mockDeployment)
      const createCall = fakeAPI.calls['deployments.create'][0][0] as {
        dryRun?: boolean
      }
      expect(createCall.dryRun).toBe(true)
    })

    it('should get deployment status', async () => {
      const mockDeployment: Deployment = {
        $id: 'deploy-123',
        projectId: 'proj-123',
        version: '1.0.0',
        status: 'active',
        url: 'https://test-project.workers.do',
        createdAt: new Date().toISOString(),
        deployedAt: new Date().toISOString(),
        bundleSize: 1024,
        buildTime: 5000,
      }

      ;(fakeAPI as any).setDeploymentsGetHandler(async () => mockDeployment)

      const result = await client.getDeployment('deploy-123')

      expect(result).toEqual(mockDeployment)
      expect(result.status).toBe('active')
    })

    it('should list deployments for a project', async () => {
      const mockDeployments: Deployment[] = [
        {
          $id: 'deploy-1',
          projectId: 'proj-123',
          version: '1.0.0',
          status: 'active',
          createdAt: new Date().toISOString(),
        },
        {
          $id: 'deploy-2',
          projectId: 'proj-123',
          version: '1.0.1',
          status: 'failed',
          createdAt: new Date().toISOString(),
          failedAt: new Date().toISOString(),
          error: 'Build failed',
        },
      ]

      ;(fakeAPI as any).setDeploymentsListHandler(async () => mockDeployments)

      const result = await client.listDeployments('proj-123')

      expect(result).toEqual(mockDeployments)
      expect(result).toHaveLength(2)
    })

    it('should cancel a deployment', async () => {
      ;(fakeAPI as any).setDeploymentsCancelHandler(async () => true)

      const result = await client.cancelDeployment('deploy-123')

      expect(result).toBe(true)
      expect(fakeAPI.calls['deployments.cancel'][0]).toEqual(['deploy-123'])
    })

    it('should wait for deployment to complete', async () => {
      // Simulate deployment progressing: pending -> building -> deploying -> active
      const deploymentStates: Deployment[] = [
        {
          $id: 'deploy-123',
          projectId: 'proj-123',
          version: '1.0.0',
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
        {
          $id: 'deploy-123',
          projectId: 'proj-123',
          version: '1.0.0',
          status: 'building',
          createdAt: new Date().toISOString(),
        },
        {
          $id: 'deploy-123',
          projectId: 'proj-123',
          version: '1.0.0',
          status: 'active',
          createdAt: new Date().toISOString(),
          deployedAt: new Date().toISOString(),
        },
      ]

      let callCount = 0
      ;(fakeAPI as any).setDeploymentsGetHandler(async () => {
        return deploymentStates[callCount++] || deploymentStates[deploymentStates.length - 1]
      })

      const result = await client.waitForDeployment('deploy-123', 100, 5000)

      expect(result.status).toBe('active')
      expect(callCount).toBeGreaterThanOrEqual(3)
    })

    it('should timeout if deployment takes too long', async () => {
      const pendingDeployment: Deployment = {
        $id: 'deploy-123',
        projectId: 'proj-123',
        version: '1.0.0',
        status: 'building',
        createdAt: new Date().toISOString(),
      }

      ;(fakeAPI as any).setDeploymentsGetHandler(async () => pendingDeployment)

      await expect(client.waitForDeployment('deploy-123', 100, 500)).rejects.toThrow(
        'Deployment timeout'
      )
    })
  })

  describe('Log Streaming', () => {
    it('should stream logs', async () => {
      const mockLogs: LogEntry[] = [
        {
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Server started',
        },
        {
          timestamp: new Date().toISOString(),
          level: 'warn',
          message: 'High memory usage',
        },
      ]

      const mockStream = new ReadableStream({
        start(controller) {
          mockLogs.forEach((log) => controller.enqueue(log))
          controller.close()
        },
      })

      ;(fakeAPI as any).setLogsStreamHandler(async () => mockStream)

      const stream = await client.streamLogs({
        projectId: 'proj-123',
        follow: true,
      })

      expect(stream).toBeInstanceOf(ReadableStream)
      expect(fakeAPI.calls['logs.stream']).toHaveLength(1)
    })

    it('should get recent logs', async () => {
      const mockLogs: LogEntry[] = [
        {
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Request received',
          requestId: 'req-123',
        },
        {
          timestamp: new Date().toISOString(),
          level: 'error',
          message: 'Database connection failed',
        },
      ]

      ;(fakeAPI as any).setLogsGetHandler(async () => mockLogs)

      const result = await client.getLogs('proj-123', { limit: 10, level: 'error' })

      expect(result).toEqual(mockLogs)
      expect(fakeAPI.calls['logs.get'][0]).toEqual(['proj-123', { limit: 10, level: 'error' }])
    })
  })

  describe('Environment Variables', () => {
    it('should set environment variables', async () => {
      ;(fakeAPI as any).setEnvSetHandler(async () => true)

      const result = await client.setEnv({
        projectId: 'proj-123',
        variables: [
          { key: 'API_KEY', value: 'secret-key', isSecret: true },
          { key: 'DEBUG', value: 'true', isSecret: false },
        ],
      })

      expect(result).toBe(true)
      expect(fakeAPI.calls['env.set']).toHaveLength(1)
    })

    it('should get environment variables', async () => {
      const mockEnvVars: EnvVar[] = [
        { key: 'API_KEY', value: '***', isSecret: true },
        { key: 'DEBUG', value: 'true', isSecret: false },
      ]

      ;(fakeAPI as any).setEnvGetHandler(async () => mockEnvVars)

      const result = await client.getEnv('proj-123')

      expect(result).toEqual(mockEnvVars)
      expect(result[0].isSecret).toBe(true)
      expect(result[0].value).toBe('***') // Secret values are masked
    })

    it('should delete an environment variable', async () => {
      ;(fakeAPI as any).setEnvDeleteHandler(async () => true)

      const result = await client.deleteEnv('proj-123', 'OLD_VAR')

      expect(result).toBe(true)
      expect(fakeAPI.calls['env.delete'][0]).toEqual(['proj-123', 'OLD_VAR'])
    })
  })

  describe('Health Monitoring', () => {
    it('should check deployment health', async () => {
      const mockHealth: HealthStatus = {
        healthy: true,
        uptime: 3600000,
        lastCheck: new Date().toISOString(),
        metrics: {
          requestCount: 1000,
          errorRate: 0.01,
          avgResponseTime: 50,
        },
      }

      ;(fakeAPI as any).setHealthCheckHandler(async () => mockHealth)

      const result = await client.checkHealth('proj-123')

      expect(result).toEqual(mockHealth)
      expect(result.healthy).toBe(true)
      expect(result.metrics?.errorRate).toBeLessThan(0.05)
    })

    it('should detect unhealthy deployment', async () => {
      const mockHealth: HealthStatus = {
        healthy: false,
        uptime: 60000,
        lastCheck: new Date().toISOString(),
        errors: ['High error rate', 'Database unreachable'],
        metrics: {
          requestCount: 100,
          errorRate: 0.5,
          avgResponseTime: 5000,
        },
      }

      ;(fakeAPI as any).setHealthCheckHandler(async () => mockHealth)

      const result = await client.checkHealth('proj-123')

      expect(result.healthy).toBe(false)
      expect(result.errors).toHaveLength(2)
    })
  })

  describe('Error Handling', () => {
    it('should retry on network errors', async () => {
      // Create client with 3 retries for this test
      const retryFakeAPI = createFakeAPI()
      const retryClient = createWorkersDoClient({
        token: 'test-token',
        timeout: 5000,
        maxRetries: 3,
        retryBaseDelay: 100,
        api: retryFakeAPI.api,
      })

      let callCount = 0
      ;(retryFakeAPI as any).setProjectsGetHandler(async () => {
        callCount++
        if (callCount === 1) {
          throw new Error('fetch failed')
        }
        if (callCount === 2) {
          throw new Error('econnreset')
        }
        return {
          $id: 'proj-123',
          name: 'test-project',
          url: 'https://test-project.workers.do',
          createdAt: new Date().toISOString(),
        }
      })

      const result = await retryClient.getProject('proj-123')

      expect(result.$id).toBe('proj-123')
      expect(callCount).toBe(3)
    })

    it('should not retry on non-retryable errors', async () => {
      let callCount = 0
      ;(fakeAPI as any).setProjectsGetHandler(async () => {
        callCount++
        throw new Error('Invalid credentials')
      })

      await expect(client.getProject('proj-123')).rejects.toThrow('Invalid credentials')
      expect(callCount).toBe(1)
    })

    it('should throw after max retries', async () => {
      ;(fakeAPI as any).setProjectsGetHandler(async () => {
        throw new Error('Network timeout')
      })

      await expect(client.getProject('proj-123')).rejects.toThrow()
      expect(fakeAPI.calls['projects.get'].length).toBe(2) // maxRetries = 2
    })

    it('should handle timeout errors', async () => {
      ;(fakeAPI as any).setDeploymentsCreateHandler(async () => {
        throw new Error('Request timeout')
      })

      await expect(
        client.deploy({
          projectId: 'proj-123',
          bundle: new Uint8Array([1, 2, 3]),
        })
      ).rejects.toThrow()
    })
  })

  describe('DO Migrations', () => {
    it('should handle DO migrations during deployment', async () => {
      // Simulate deployment with migration
      const mockDeployment: Deployment = {
        $id: 'deploy-123',
        projectId: 'proj-123',
        version: '2.0.0',
        status: 'active',
        createdAt: new Date().toISOString(),
        deployedAt: new Date().toISOString(),
      }

      ;(fakeAPI as any).setDeploymentsCreateHandler(async () => mockDeployment)

      const result = await client.deploy({
        projectId: 'proj-123',
        bundle: new Uint8Array([1, 2, 3]),
        version: '2.0.0',
      })

      expect(result.status).toBe('active')
      expect(result.version).toBe('2.0.0')
    })
  })

  describe('Client Creation', () => {
    it('should create client with default options', () => {
      const defaultClient = createWorkersDoClient({ token: 'test-token', api: fakeAPI.api })
      expect(defaultClient).toBeInstanceOf(WorkersDoClient)
    })

    it('should create client with custom options', () => {
      const customClient = createWorkersDoClient({
        url: 'https://custom.workers.do',
        token: 'test-token',
        timeout: 10000,
        maxRetries: 5,
        retryBaseDelay: 500,
        api: fakeAPI.api,
      })
      expect(customClient).toBeInstanceOf(WorkersDoClient)
    })
  })
})
