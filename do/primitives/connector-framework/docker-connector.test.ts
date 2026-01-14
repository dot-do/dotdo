/**
 * Docker Connector Wrapper Tests
 *
 * TDD RED phase: Tests for Docker-based Airbyte connector execution.
 *
 * Features:
 * - Docker container lifecycle (pull, start, stop)
 * - STDIN/STDOUT message protocol handling
 * - Connector registry integration
 * - Connector versioning and updates
 *
 * @module db/primitives/connector-framework/docker-connector
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { AirbyteMessage } from './airbyte-protocol'
import {
  type DockerConnector,
  type DockerConnectorConfig,
  type DockerConnectorOptions,
  type ConnectorImage,
  type ConnectorVersion,
  type StdioMessageHandler,
  type MessageStream,
  createDockerConnector,
  createStdioMessageHandler,
  parseStdioStream,
  serializeToStdio,
} from './docker-connector'
import {
  type ConnectorRegistry,
  type ConnectorMetadata,
  type ConnectorDefinition,
  type RegistrySearchResult,
  type ConnectorUpdateInfo,
  createConnectorRegistry,
  type RegistryConfig,
} from './connector-registry'

// =============================================================================
// STDIN/STDOUT Message Protocol Tests
// =============================================================================

describe('STDIN/STDOUT Message Protocol', () => {
  describe('parseStdioStream', () => {
    it('should parse single message from stream', async () => {
      const stream = '{"type":"RECORD","record":{"stream":"users","data":{"id":1},"emitted_at":1704067200000}}\n'
      const messages: AirbyteMessage[] = []

      for await (const msg of parseStdioStream(stream)) {
        messages.push(msg)
      }

      expect(messages).toHaveLength(1)
      expect(messages[0].type).toBe('RECORD')
    })

    it('should parse multiple messages from stream', async () => {
      const stream = [
        '{"type":"LOG","log":{"level":"INFO","message":"Starting"}}',
        '{"type":"RECORD","record":{"stream":"users","data":{"id":1},"emitted_at":1704067200000}}',
        '{"type":"STATE","state":{"type":"STREAM","stream":{"stream_descriptor":{"name":"users"},"stream_state":{"cursor":1}}}}',
      ].join('\n')

      const messages: AirbyteMessage[] = []
      for await (const msg of parseStdioStream(stream)) {
        messages.push(msg)
      }

      expect(messages).toHaveLength(3)
      expect(messages[0].type).toBe('LOG')
      expect(messages[1].type).toBe('RECORD')
      expect(messages[2].type).toBe('STATE')
    })

    it('should skip empty lines', async () => {
      const stream = [
        '{"type":"LOG","log":{"level":"INFO","message":"Start"}}',
        '',
        '{"type":"LOG","log":{"level":"INFO","message":"End"}}',
        '',
      ].join('\n')

      const messages: AirbyteMessage[] = []
      for await (const msg of parseStdioStream(stream)) {
        messages.push(msg)
      }

      expect(messages).toHaveLength(2)
    })

    it('should handle streaming ReadableStream input', async () => {
      const chunks = [
        '{"type":"LOG","log":{"level":"INFO","message":"Chunk1"}}\n',
        '{"type":"RECORD","record":{"stream":"data","data":{},"emitted_at":0}}\n',
      ]

      const stream = new ReadableStream<string>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk)
          }
          controller.close()
        },
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of parseStdioStream(stream)) {
        messages.push(msg)
      }

      expect(messages).toHaveLength(2)
    })

    it('should handle partial lines across chunks', async () => {
      // Message split across two chunks
      const chunks = ['{"type":"LOG","log":{"level":"IN', 'FO","message":"Split message"}}\n']

      const stream = new ReadableStream<string>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk)
          }
          controller.close()
        },
      })

      const messages: AirbyteMessage[] = []
      for await (const msg of parseStdioStream(stream)) {
        messages.push(msg)
      }

      expect(messages).toHaveLength(1)
      if (messages[0].type === 'LOG') {
        expect(messages[0].log.message).toBe('Split message')
      }
    })

    it('should emit errors for invalid JSON but continue processing', async () => {
      const stream = [
        '{"type":"LOG","log":{"level":"INFO","message":"Valid"}}',
        'not valid json',
        '{"type":"LOG","log":{"level":"INFO","message":"Also valid"}}',
      ].join('\n')

      const messages: AirbyteMessage[] = []
      const errors: Error[] = []

      for await (const msg of parseStdioStream(stream, { onError: (e) => errors.push(e) })) {
        messages.push(msg)
      }

      expect(messages).toHaveLength(2)
      expect(errors).toHaveLength(1)
    })
  })

  describe('serializeToStdio', () => {
    it('should serialize message to newline-terminated JSON', () => {
      const message: AirbyteMessage = {
        type: 'RECORD',
        record: { stream: 'users', data: { id: 1 }, emitted_at: 1704067200000 },
      }

      const output = serializeToStdio(message)

      expect(output.endsWith('\n')).toBe(true)
      expect(JSON.parse(output.trim())).toEqual(message)
    })

    it('should serialize multiple messages', () => {
      const messages: AirbyteMessage[] = [
        { type: 'LOG', log: { level: 'INFO', message: 'Start' } },
        { type: 'RECORD', record: { stream: 'data', data: {}, emitted_at: 0 } },
      ]

      const output = serializeToStdio(messages)
      const lines = output.trim().split('\n')

      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0]).type).toBe('LOG')
      expect(JSON.parse(lines[1]).type).toBe('RECORD')
    })
  })

  describe('StdioMessageHandler', () => {
    let handler: StdioMessageHandler

    beforeEach(() => {
      handler = createStdioMessageHandler()
    })

    it('should buffer partial messages', () => {
      handler.write('{"type":"LOG","log":{"level":"INFO"')
      expect(handler.getMessages()).toHaveLength(0)

      handler.write(',"message":"Complete"}}\n')
      expect(handler.getMessages()).toHaveLength(1)
    })

    it('should handle multiple messages in single write', () => {
      const data = [
        '{"type":"LOG","log":{"level":"INFO","message":"1"}}',
        '{"type":"LOG","log":{"level":"INFO","message":"2"}}',
      ].join('\n') + '\n'

      handler.write(data)

      expect(handler.getMessages()).toHaveLength(2)
    })

    it('should emit messages via callback', async () => {
      const received: AirbyteMessage[] = []
      handler = createStdioMessageHandler({
        onMessage: (msg) => received.push(msg),
      })

      handler.write('{"type":"LOG","log":{"level":"INFO","message":"Test"}}\n')

      expect(received).toHaveLength(1)
    })

    it('should separate STDERR (LOG) from STDOUT messages', () => {
      handler.writeStdout('{"type":"RECORD","record":{"stream":"data","data":{},"emitted_at":0}}\n')
      handler.writeStderr('{"type":"LOG","log":{"level":"ERROR","message":"Error occurred"}}\n')

      const records = handler.getMessages().filter((m) => m.type === 'RECORD')
      const logs = handler.getMessages().filter((m) => m.type === 'LOG')

      expect(records).toHaveLength(1)
      expect(logs).toHaveLength(1)
    })
  })
})

// =============================================================================
// Docker Connector Wrapper Tests
// =============================================================================

describe('DockerConnector', () => {
  let connector: DockerConnector
  let mockSpawn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Mock child_process spawn for Docker execution
    mockSpawn = vi.fn()
    vi.doMock('child_process', () => ({
      spawn: mockSpawn,
    }))
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('configuration', () => {
    it('should create connector with image reference', () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
      })

      expect(connector.getImage()).toEqual({
        repository: 'airbyte/source-postgres',
        tag: 'latest',
      })
    })

    it('should parse full image reference with registry', () => {
      connector = createDockerConnector({
        image: 'docker.io/airbyte/source-postgres:1.2.3',
      })

      const image = connector.getImage()
      expect(image.registry).toBe('docker.io')
      expect(image.repository).toBe('airbyte/source-postgres')
      expect(image.tag).toBe('1.2.3')
    })

    it('should support digest-based image references', () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres@sha256:abc123',
      })

      const image = connector.getImage()
      expect(image.digest).toBe('sha256:abc123')
    })

    it('should configure resource limits', () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
        resources: {
          memoryLimit: '512m',
          cpuLimit: '0.5',
          networkMode: 'none',
        },
      })

      const config = connector.getConfig()
      expect(config.resources?.memoryLimit).toBe('512m')
      expect(config.resources?.cpuLimit).toBe('0.5')
    })

    it('should configure volume mounts', () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
        mounts: [
          { hostPath: '/data/config', containerPath: '/secrets', readOnly: true },
          { hostPath: '/tmp/output', containerPath: '/output' },
        ],
      })

      const config = connector.getConfig()
      expect(config.mounts).toHaveLength(2)
      expect(config.mounts?.[0].readOnly).toBe(true)
    })
  })

  describe('lifecycle', () => {
    it('should pull image before first run', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
      })

      // Mock Docker pull
      const pullPromise = connector.ensureImage()

      // Should emit pulling event
      expect(connector.getStatus()).toBe('pulling')

      await pullPromise

      expect(connector.getStatus()).toBe('ready')
    })

    it('should skip pull if image exists locally', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
        skipPullIfExists: true,
      })

      // Mock local image check
      vi.spyOn(connector, 'imageExistsLocally' as any).mockResolvedValue(true)

      await connector.ensureImage()

      // Should not have pulled
      expect(connector.getStatus()).toBe('ready')
    })

    it('should start container for spec command', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
      })

      const specPromise = connector.spec()

      // Should spawn docker run with spec command
      expect(connector.getStatus()).toBe('running')

      // Mock spec output
      const spec = await specPromise

      expect(spec.connectionSpecification).toBeDefined()
    })

    it('should start container for check command', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
      })

      const config = { host: 'localhost', database: 'test' }
      const result = await connector.check(config)

      expect(result.status).toMatch(/SUCCEEDED|FAILED/)
    })

    it('should start container for discover command', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
      })

      const config = { host: 'localhost', database: 'test' }
      const catalog = await connector.discover(config)

      expect(catalog.streams).toBeDefined()
      expect(Array.isArray(catalog.streams)).toBe(true)
    })

    it('should stream records from read command', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
      })

      const config = { host: 'localhost', database: 'test' }
      const catalog = { streams: [{ stream: { name: 'users' }, sync_mode: 'full_refresh' }] }

      const records: AirbyteMessage[] = []
      for await (const message of connector.read(config, catalog)) {
        records.push(message)
        if (records.length >= 3) break // Limit for test
      }

      expect(records.length).toBeGreaterThan(0)
    })

    it('should stop container gracefully', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
      })

      // Start a long-running read
      const readGenerator = connector.read({}, { streams: [] })

      // Stop mid-stream
      await connector.stop()

      expect(connector.getStatus()).toBe('stopped')
    })

    it('should force kill container after timeout', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
        stopTimeout: 1000,
      })

      // Start connector
      const readGenerator = connector.read({}, { streams: [] })

      // Stop with force after timeout
      await connector.stop({ force: true })

      expect(connector.getStatus()).toBe('stopped')
    })

    it('should clean up container after completion', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
        removeOnComplete: true,
      })

      await connector.spec()

      // Container should be removed
      expect(connector.getContainerId()).toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('should capture connector errors from TRACE messages', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
      })

      // Simulate connector emitting error trace
      const errors: Error[] = []
      connector.on('error', (err) => errors.push(err))

      try {
        await connector.check({ invalid: 'config' })
      } catch (e) {
        // Expected
      }

      expect(errors.length).toBeGreaterThan(0)
    })

    it('should handle container crash', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
      })

      // Simulate container exit with error
      await expect(connector.read({}, { streams: [] }).next()).rejects.toThrow(/container.*exit/i)
    })

    it('should retry on transient Docker errors', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
        retryConfig: {
          maxRetries: 3,
          initialDelayMs: 100,
        },
      })

      let attempts = 0
      // Mock failing then succeeding
      vi.spyOn(connector as any, 'runContainer').mockImplementation(async () => {
        attempts++
        if (attempts < 2) {
          throw new Error('Docker daemon error')
        }
        return { exitCode: 0 }
      })

      await connector.spec()

      expect(attempts).toBe(2)
    })
  })

  describe('configuration injection', () => {
    it('should inject config via mounted file', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
        configInjection: 'file',
      })

      const config = { host: 'localhost', password: 'secret' }
      await connector.check(config)

      // Config should be written to temp file, mounted to /config/config.json
      const dockerArgs = connector.getLastDockerArgs()
      expect(dockerArgs).toContain('-v')
      expect(dockerArgs.join(' ')).toMatch(/config\.json/)
    })

    it('should inject config via environment variables', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
        configInjection: 'env',
      })

      const config = { host: 'localhost' }
      await connector.check(config)

      const dockerArgs = connector.getLastDockerArgs()
      expect(dockerArgs).toContain('-e')
    })

    it('should mask secrets in logs', async () => {
      connector = createDockerConnector({
        image: 'airbyte/source-postgres:latest',
        maskSecrets: true,
      })

      const logs: string[] = []
      connector.on('log', (log) => logs.push(log))

      const config = { host: 'localhost', password: 'supersecret123' }
      await connector.check(config)

      // Password should be masked in any logged output
      const hasUnmaskedSecret = logs.some((l) => l.includes('supersecret123'))
      expect(hasUnmaskedSecret).toBe(false)
    })
  })
})

// =============================================================================
// Connector Registry Tests
// =============================================================================

describe('ConnectorRegistry', () => {
  let registry: ConnectorRegistry

  beforeEach(() => {
    registry = createConnectorRegistry({
      registryUrl: 'https://connectors.airbyte.com/files/registries/v0/oss_registry.json',
      cacheDir: '/tmp/airbyte-registry-cache',
      cacheTtlMs: 3600000, // 1 hour
    })
  })

  describe('connector discovery', () => {
    it('should list available source connectors', async () => {
      const sources = await registry.listSources()

      expect(Array.isArray(sources)).toBe(true)
      expect(sources.length).toBeGreaterThan(0)
      expect(sources[0]).toHaveProperty('name')
      expect(sources[0]).toHaveProperty('dockerRepository')
    })

    it('should list available destination connectors', async () => {
      const destinations = await registry.listDestinations()

      expect(Array.isArray(destinations)).toBe(true)
      expect(destinations.length).toBeGreaterThan(0)
    })

    it('should search connectors by name', async () => {
      const results = await registry.search('postgres')

      expect(results.length).toBeGreaterThan(0)
      expect(results.some((r) => r.name.toLowerCase().includes('postgres'))).toBe(true)
    })

    it('should search with filters', async () => {
      const results = await registry.search('', {
        type: 'source',
        releaseStage: 'generally_available',
      })

      expect(results.every((r) => r.type === 'source')).toBe(true)
      expect(results.every((r) => r.releaseStage === 'generally_available')).toBe(true)
    })

    it('should get connector by definition ID', async () => {
      const connector = await registry.getConnector('source-postgres')

      expect(connector).toBeDefined()
      expect(connector?.definitionId).toBe('source-postgres')
      expect(connector?.dockerRepository).toContain('postgres')
    })

    it('should return undefined for non-existent connector', async () => {
      const connector = await registry.getConnector('non-existent-connector')

      expect(connector).toBeUndefined()
    })
  })

  describe('version management', () => {
    it('should list available versions for connector', async () => {
      const versions = await registry.getVersions('source-postgres')

      expect(Array.isArray(versions)).toBe(true)
      expect(versions.length).toBeGreaterThan(0)
      expect(versions[0]).toHaveProperty('version')
      expect(versions[0]).toHaveProperty('dockerImageTag')
    })

    it('should get latest stable version', async () => {
      const latest = await registry.getLatestVersion('source-postgres')

      expect(latest).toBeDefined()
      expect(latest?.version).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it('should get latest version including pre-releases', async () => {
      const latest = await registry.getLatestVersion('source-postgres', {
        includePrerelease: true,
      })

      expect(latest).toBeDefined()
    })

    it('should check if update is available', async () => {
      const updateInfo = await registry.checkForUpdate('source-postgres', '0.1.0')

      expect(updateInfo.hasUpdate).toBe(true)
      expect(updateInfo.currentVersion).toBe('0.1.0')
      expect(updateInfo.latestVersion).toBeDefined()
    })

    it('should return no update when on latest', async () => {
      const latest = await registry.getLatestVersion('source-postgres')
      const updateInfo = await registry.checkForUpdate('source-postgres', latest!.version)

      expect(updateInfo.hasUpdate).toBe(false)
    })

    it('should compare versions correctly', () => {
      expect(registry.compareVersions('1.0.0', '2.0.0')).toBeLessThan(0)
      expect(registry.compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0)
      expect(registry.compareVersions('1.0.0', '1.0.0')).toBe(0)
      expect(registry.compareVersions('1.0.0', '1.0.1')).toBeLessThan(0)
      expect(registry.compareVersions('1.1.0', '1.0.9')).toBeGreaterThan(0)
    })
  })

  describe('connector metadata', () => {
    it('should get connector specification', async () => {
      const spec = await registry.getConnectorSpec('source-postgres')

      expect(spec).toBeDefined()
      expect(spec?.connectionSpecification).toBeDefined()
      expect(spec?.connectionSpecification.type).toBe('object')
    })

    it('should get connector documentation URL', async () => {
      const connector = await registry.getConnector('source-postgres')

      expect(connector?.documentationUrl).toBeDefined()
      expect(connector?.documentationUrl).toMatch(/^https?:\/\//)
    })

    it('should get changelog URL', async () => {
      const connector = await registry.getConnector('source-postgres')

      expect(connector?.changelogUrl).toBeDefined()
    })

    it('should indicate supported sync modes', async () => {
      const connector = await registry.getConnector('source-postgres')

      expect(connector?.supportedSyncModes).toBeDefined()
      expect(Array.isArray(connector?.supportedSyncModes)).toBe(true)
    })

    it('should indicate release stage', async () => {
      const connector = await registry.getConnector('source-postgres')

      expect(connector?.releaseStage).toMatch(/alpha|beta|generally_available/)
    })
  })

  describe('caching', () => {
    it('should cache registry data', async () => {
      // First call fetches from network
      await registry.listSources()

      // Second call should use cache
      const fetchSpy = vi.spyOn(global, 'fetch')
      await registry.listSources()

      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('should refresh cache after TTL expires', async () => {
      vi.useFakeTimers()

      await registry.listSources()

      // Advance time past cache TTL
      vi.advanceTimersByTime(3600001)

      const fetchSpy = vi.spyOn(global, 'fetch')
      await registry.listSources()

      expect(fetchSpy).toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('should force refresh cache', async () => {
      await registry.listSources()

      const fetchSpy = vi.spyOn(global, 'fetch')
      await registry.listSources({ forceRefresh: true })

      expect(fetchSpy).toHaveBeenCalled()
    })

    it('should persist cache to disk', async () => {
      registry = createConnectorRegistry({
        registryUrl: 'https://connectors.airbyte.com/files/registries/v0/oss_registry.json',
        cacheDir: '/tmp/test-cache',
        persistCache: true,
      })

      await registry.listSources()

      // Check cache file exists
      const cacheExists = await registry.isCacheValid()
      expect(cacheExists).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should handle registry unavailable', async () => {
      registry = createConnectorRegistry({
        registryUrl: 'https://invalid.example.com/registry.json',
      })

      await expect(registry.listSources()).rejects.toThrow(/registry.*unavailable/i)
    })

    it('should use cached data when registry unavailable', async () => {
      // Pre-populate cache
      await registry.listSources()

      // Make registry unavailable
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'))

      // Should still work from cache
      const sources = await registry.listSources({ useCacheOnError: true })
      expect(sources.length).toBeGreaterThan(0)
    })

    it('should handle malformed registry response', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('not json', { status: 200 }),
      )

      await expect(registry.listSources()).rejects.toThrow(/invalid.*response/i)
    })
  })
})

// =============================================================================
// Connector Versioning Tests
// =============================================================================

describe('Connector Versioning', () => {
  let registry: ConnectorRegistry

  beforeEach(() => {
    registry = createConnectorRegistry({
      registryUrl: 'https://connectors.airbyte.com/files/registries/v0/oss_registry.json',
    })
  })

  describe('version constraints', () => {
    it('should resolve version from constraint ^1.0.0', async () => {
      const version = await registry.resolveVersion('source-postgres', '^1.0.0')

      expect(version).toBeDefined()
      expect(version?.version.startsWith('1.')).toBe(true)
    })

    it('should resolve version from constraint ~1.2.0', async () => {
      const version = await registry.resolveVersion('source-postgres', '~1.2.0')

      expect(version).toBeDefined()
      expect(version?.version.startsWith('1.2.')).toBe(true)
    })

    it('should resolve exact version', async () => {
      const version = await registry.resolveVersion('source-postgres', '1.0.0')

      expect(version?.version).toBe('1.0.0')
    })

    it('should resolve latest tag', async () => {
      const version = await registry.resolveVersion('source-postgres', 'latest')

      expect(version).toBeDefined()
    })

    it('should return undefined for unsatisfiable constraint', async () => {
      const version = await registry.resolveVersion('source-postgres', '>=999.0.0')

      expect(version).toBeUndefined()
    })
  })

  describe('version locking', () => {
    it('should generate lock file entry', async () => {
      const lockEntry = await registry.createLockEntry('source-postgres', '1.0.0')

      expect(lockEntry).toHaveProperty('connectorId', 'source-postgres')
      expect(lockEntry).toHaveProperty('version', '1.0.0')
      expect(lockEntry).toHaveProperty('dockerImage')
      expect(lockEntry).toHaveProperty('digest')
      expect(lockEntry).toHaveProperty('lockedAt')
    })

    it('should verify lock file integrity', async () => {
      const lockEntry = await registry.createLockEntry('source-postgres', '1.0.0')

      const isValid = await registry.verifyLockEntry(lockEntry)

      expect(isValid).toBe(true)
    })

    it('should detect tampered lock entry', async () => {
      const lockEntry = await registry.createLockEntry('source-postgres', '1.0.0')

      // Tamper with the entry
      lockEntry.digest = 'sha256:tampered'

      const isValid = await registry.verifyLockEntry(lockEntry)

      expect(isValid).toBe(false)
    })
  })

  describe('breaking change detection', () => {
    it('should detect major version change as breaking', async () => {
      const changes = await registry.getBreakingChanges('source-postgres', '1.0.0', '2.0.0')

      expect(changes.isBreaking).toBe(true)
      expect(changes.reason).toContain('major')
    })

    it('should detect protocol version change as breaking', async () => {
      const changes = await registry.getBreakingChanges('source-postgres', '1.0.0', '1.1.0')

      // Check if protocol version changed
      if (changes.protocolVersionChange) {
        expect(changes.isBreaking).toBe(true)
      }
    })

    it('should list migration notes for breaking changes', async () => {
      const changes = await registry.getBreakingChanges('source-postgres', '0.1.0', '1.0.0')

      if (changes.isBreaking) {
        expect(changes.migrationNotes).toBeDefined()
      }
    })
  })

  describe('update workflow', () => {
    it('should check compatibility before update', async () => {
      const compatibility = await registry.checkUpdateCompatibility('source-postgres', '1.0.0', '1.1.0')

      expect(compatibility).toHaveProperty('compatible')
      expect(compatibility).toHaveProperty('warnings')
    })

    it('should generate update plan', async () => {
      const plan = await registry.createUpdatePlan('source-postgres', '1.0.0', '2.0.0')

      expect(plan).toHaveProperty('steps')
      expect(plan.steps.length).toBeGreaterThan(0)
      expect(plan.steps[0]).toHaveProperty('action')
    })

    it('should include rollback instructions in update plan', async () => {
      const plan = await registry.createUpdatePlan('source-postgres', '1.0.0', '2.0.0')

      expect(plan).toHaveProperty('rollbackPlan')
      expect(plan.rollbackPlan).toHaveProperty('steps')
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Docker Connector with Registry Integration', () => {
  let registry: ConnectorRegistry

  beforeEach(() => {
    registry = createConnectorRegistry({
      registryUrl: 'https://connectors.airbyte.com/files/registries/v0/oss_registry.json',
    })
  })

  it('should create connector from registry definition', async () => {
    const definition = await registry.getConnector('source-postgres')
    expect(definition).toBeDefined()

    const connector = createDockerConnector({
      image: `${definition!.dockerRepository}:${definition!.dockerImageTag}`,
    })

    expect(connector.getImage().repository).toBe(definition!.dockerRepository)
  })

  it('should auto-update connector to latest version', async () => {
    const connector = createDockerConnector({
      image: 'airbyte/source-postgres:0.1.0',
      autoUpdate: true,
      registry,
    })

    await connector.ensureImage()

    // Should have updated to latest
    const currentVersion = connector.getImage().tag
    const latest = await registry.getLatestVersion('source-postgres')

    expect(currentVersion).toBe(latest?.dockerImageTag)
  })

  it('should respect version constraints during auto-update', async () => {
    const connector = createDockerConnector({
      image: 'airbyte/source-postgres:1.0.0',
      autoUpdate: true,
      versionConstraint: '^1.0.0', // Only update within 1.x
      registry,
    })

    await connector.ensureImage()

    const currentVersion = connector.getImage().tag
    expect(currentVersion?.startsWith('1.')).toBe(true)
  })
})
