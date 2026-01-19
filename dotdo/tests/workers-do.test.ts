/**
 * Tests for workers.do integration
 *
 * TDD approach:
 * - Test project creation and management
 * - Test deployment flow (upload → validate → deploy)
 * - Test log streaming
 * - Test status checking
 * - Test environment variable management
 * - Test error handling and retries
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  WorkersDoClient,
  createWorkersDoClient,
  type Project,
  type Deployment,
  type LogEntry,
  type EnvVar,
  type HealthStatus,
} from '../services/workers-do'

// Mock the RPC client
vi.mock('@dotdo/rpc', () => ({
  createClient: vi.fn(() => mockAPI),
}))

// Mock API responses
let mockAPI: any

describe('WorkersDoClient', () => {
  let client: WorkersDoClient

  beforeEach(() => {
    // Reset mocks before each test
    mockAPI = {
      projects: {
        create: vi.fn(),
        get: vi.fn(),
        list: vi.fn(),
        delete: vi.fn(),
      },
      deployments: {
        create: vi.fn(),
        get: vi.fn(),
        list: vi.fn(),
        cancel: vi.fn(),
      },
      logs: {
        stream: vi.fn(),
        get: vi.fn(),
      },
      env: {
        set: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
      },
      health: {
        check: vi.fn(),
      },
    }

    client = createWorkersDoClient({
      token: 'test-token',
      timeout: 5000,
      maxRetries: 2,
      retryBaseDelay: 100,
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

      mockAPI.projects.create.mockResolvedValue(mockProject)

      const result = await client.createProject({
        name: 'test-project',
        namespace: 'default',
        environment: 'production',
      })

      expect(result).toEqual(mockProject)
      expect(mockAPI.projects.create).toHaveBeenCalledWith({
        name: 'test-project',
        namespace: 'default',
        environment: 'production',
      })
    })

    it('should get a project by ID', async () => {
      const mockProject: Project = {
        $id: 'proj-123',
        name: 'test-project',
        url: 'https://test-project.workers.do',
        createdAt: new Date().toISOString(),
      }

      mockAPI.projects.get.mockResolvedValue(mockProject)

      const result = await client.getProject('proj-123')

      expect(result).toEqual(mockProject)
      expect(mockAPI.projects.get).toHaveBeenCalledWith('proj-123')
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

      mockAPI.projects.list.mockResolvedValue(mockProjects)

      const result = await client.listProjects()

      expect(result).toEqual(mockProjects)
      expect(result).toHaveLength(2)
    })

    it('should delete a project', async () => {
      mockAPI.projects.delete.mockResolvedValue(true)

      const result = await client.deleteProject('proj-123')

      expect(result).toBe(true)
      expect(mockAPI.projects.delete).toHaveBeenCalledWith('proj-123')
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

      mockAPI.deployments.create.mockResolvedValue(mockDeployment)

      const result = await client.deploy({
        projectId: 'proj-123',
        bundle,
        version: '1.0.0',
      })

      expect(result).toEqual(mockDeployment)
      expect(mockAPI.deployments.create).toHaveBeenCalledWith({
        projectId: 'proj-123',
        bundle,
        version: '1.0.0',
      })
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

      mockAPI.deployments.create.mockResolvedValue(mockDeployment)

      const result = await client.deploy({
        projectId: 'proj-123',
        bundle,
        version: '1.0.0',
        dryRun: true,
      })

      expect(result).toEqual(mockDeployment)
      expect(mockAPI.deployments.create).toHaveBeenCalledWith({
        projectId: 'proj-123',
        bundle,
        version: '1.0.0',
        dryRun: true,
      })
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

      mockAPI.deployments.get.mockResolvedValue(mockDeployment)

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

      mockAPI.deployments.list.mockResolvedValue(mockDeployments)

      const result = await client.listDeployments('proj-123')

      expect(result).toEqual(mockDeployments)
      expect(result).toHaveLength(2)
    })

    it('should cancel a deployment', async () => {
      mockAPI.deployments.cancel.mockResolvedValue(true)

      const result = await client.cancelDeployment('deploy-123')

      expect(result).toBe(true)
      expect(mockAPI.deployments.cancel).toHaveBeenCalledWith('deploy-123')
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
      mockAPI.deployments.get.mockImplementation(() => {
        return Promise.resolve(deploymentStates[callCount++] || deploymentStates[deploymentStates.length - 1])
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

      mockAPI.deployments.get.mockResolvedValue(pendingDeployment)

      await expect(
        client.waitForDeployment('deploy-123', 100, 500)
      ).rejects.toThrow('Deployment timeout')
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
          mockLogs.forEach(log => controller.enqueue(log))
          controller.close()
        },
      })

      mockAPI.logs.stream.mockResolvedValue(mockStream)

      const stream = await client.streamLogs({
        projectId: 'proj-123',
        follow: true,
      })

      expect(stream).toBeInstanceOf(ReadableStream)
      expect(mockAPI.logs.stream).toHaveBeenCalledWith({
        projectId: 'proj-123',
        follow: true,
      })
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

      mockAPI.logs.get.mockResolvedValue(mockLogs)

      const result = await client.getLogs('proj-123', { limit: 10, level: 'error' })

      expect(result).toEqual(mockLogs)
      expect(mockAPI.logs.get).toHaveBeenCalledWith('proj-123', { limit: 10, level: 'error' })
    })
  })

  describe('Environment Variables', () => {
    it('should set environment variables', async () => {
      mockAPI.env.set.mockResolvedValue(true)

      const result = await client.setEnv({
        projectId: 'proj-123',
        variables: [
          { key: 'API_KEY', value: 'secret-key', isSecret: true },
          { key: 'DEBUG', value: 'true', isSecret: false },
        ],
      })

      expect(result).toBe(true)
      expect(mockAPI.env.set).toHaveBeenCalledWith({
        projectId: 'proj-123',
        variables: [
          { key: 'API_KEY', value: 'secret-key', isSecret: true },
          { key: 'DEBUG', value: 'true', isSecret: false },
        ],
      })
    })

    it('should get environment variables', async () => {
      const mockEnvVars: EnvVar[] = [
        { key: 'API_KEY', value: '***', isSecret: true },
        { key: 'DEBUG', value: 'true', isSecret: false },
      ]

      mockAPI.env.get.mockResolvedValue(mockEnvVars)

      const result = await client.getEnv('proj-123')

      expect(result).toEqual(mockEnvVars)
      expect(result[0].isSecret).toBe(true)
      expect(result[0].value).toBe('***') // Secret values are masked
    })

    it('should delete an environment variable', async () => {
      mockAPI.env.delete.mockResolvedValue(true)

      const result = await client.deleteEnv('proj-123', 'OLD_VAR')

      expect(result).toBe(true)
      expect(mockAPI.env.delete).toHaveBeenCalledWith('proj-123', 'OLD_VAR')
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

      mockAPI.health.check.mockResolvedValue(mockHealth)

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

      mockAPI.health.check.mockResolvedValue(mockHealth)

      const result = await client.checkHealth('proj-123')

      expect(result.healthy).toBe(false)
      expect(result.errors).toHaveLength(2)
    })
  })

  describe('Error Handling', () => {
    it('should retry on network errors', async () => {
      // Create client with 3 retries for this test
      const retryClient = createWorkersDoClient({
        token: 'test-token',
        timeout: 5000,
        maxRetries: 3,
        retryBaseDelay: 100,
      })

      let callCount = 0
      mockAPI.projects.get.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.reject(new Error('fetch failed'))
        }
        if (callCount === 2) {
          return Promise.reject(new Error('econnreset'))
        }
        return Promise.resolve({
          $id: 'proj-123',
          name: 'test-project',
          url: 'https://test-project.workers.do',
          createdAt: new Date().toISOString(),
        })
      })

      const result = await retryClient.getProject('proj-123')

      expect(result.$id).toBe('proj-123')
      expect(mockAPI.projects.get).toHaveBeenCalledTimes(3)
    })

    it('should not retry on non-retryable errors', async () => {
      const nonRetryableError = new Error('Invalid credentials')
      mockAPI.projects.get.mockRejectedValue(nonRetryableError)

      await expect(client.getProject('proj-123')).rejects.toThrow('Invalid credentials')
      expect(mockAPI.projects.get).toHaveBeenCalledTimes(1)
    })

    it('should throw after max retries', async () => {
      mockAPI.projects.get.mockRejectedValue(new Error('Network timeout'))

      await expect(client.getProject('proj-123')).rejects.toThrow()
      expect(mockAPI.projects.get).toHaveBeenCalledTimes(2) // maxRetries = 2
    })

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('Request timeout')
      mockAPI.deployments.create.mockRejectedValue(timeoutError)

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

      mockAPI.deployments.create.mockResolvedValue(mockDeployment)

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
      const client = createWorkersDoClient({ token: 'test-token' })
      expect(client).toBeInstanceOf(WorkersDoClient)
    })

    it('should create client with custom options', () => {
      const client = createWorkersDoClient({
        url: 'https://custom.workers.do',
        token: 'test-token',
        timeout: 10000,
        maxRetries: 5,
        retryBaseDelay: 500,
      })
      expect(client).toBeInstanceOf(WorkersDoClient)
    })
  })
})
