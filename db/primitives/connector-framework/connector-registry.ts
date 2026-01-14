/**
 * Airbyte Connector Registry Integration
 *
 * Provides integration with the Airbyte connector registry for:
 * - Discovering available connectors
 * - Version management and updates
 * - Connector metadata and specifications
 * - Breaking change detection
 *
 * @module db/primitives/connector-framework/connector-registry
 */

import type { ConnectorSpecification } from './airbyte-protocol'

// =============================================================================
// Types
// =============================================================================

/**
 * Registry configuration
 */
export interface RegistryConfig {
  registryUrl: string
  cacheDir?: string
  cacheTtlMs?: number
  persistCache?: boolean
}

/**
 * Connector type
 */
export type ConnectorType = 'source' | 'destination'

/**
 * Release stage
 */
export type ReleaseStage = 'alpha' | 'beta' | 'generally_available'

/**
 * Connector metadata from registry
 */
export interface ConnectorMetadata {
  definitionId: string
  name: string
  dockerRepository: string
  dockerImageTag: string
  documentationUrl?: string
  changelogUrl?: string
  icon?: string
  releaseStage: ReleaseStage
  supportedSyncModes?: string[]
  type: ConnectorType
}

/**
 * Connector definition with full details
 */
export interface ConnectorDefinition extends ConnectorMetadata {
  spec?: ConnectorSpecification
  releases?: ConnectorVersion[]
}

/**
 * Connector version information
 */
export interface ConnectorVersion {
  version: string
  dockerImageTag: string
  releaseDate?: string
  changelog?: string
  protocolVersion?: string
}

/**
 * Registry search result
 */
export interface RegistrySearchResult extends ConnectorMetadata {
  relevanceScore?: number
}

/**
 * Search filters
 */
export interface SearchFilters {
  type?: ConnectorType
  releaseStage?: ReleaseStage
  supportedSyncModes?: string[]
}

/**
 * Update check result
 */
export interface ConnectorUpdateInfo {
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
  breakingChanges?: boolean
  releaseNotes?: string
}

/**
 * Version options
 */
export interface VersionOptions {
  includePrerelease?: boolean
}

/**
 * List options
 */
export interface ListOptions {
  forceRefresh?: boolean
  useCacheOnError?: boolean
}

/**
 * Lock file entry
 */
export interface LockEntry {
  connectorId: string
  version: string
  dockerImage: string
  digest: string
  lockedAt: string
}

/**
 * Breaking changes info
 */
export interface BreakingChangesInfo {
  isBreaking: boolean
  reason?: string
  protocolVersionChange?: boolean
  migrationNotes?: string[]
}

/**
 * Update compatibility result
 */
export interface UpdateCompatibility {
  compatible: boolean
  warnings: string[]
}

/**
 * Update plan step
 */
export interface UpdateStep {
  action: 'pull' | 'migrate' | 'verify' | 'cleanup'
  description: string
  command?: string
}

/**
 * Update plan
 */
export interface UpdatePlan {
  steps: UpdateStep[]
  rollbackPlan: {
    steps: UpdateStep[]
  }
}

// =============================================================================
// Registry Implementation
// =============================================================================

/**
 * Connector registry interface
 */
export interface ConnectorRegistry {
  // Discovery
  listSources(options?: ListOptions): Promise<ConnectorMetadata[]>
  listDestinations(options?: ListOptions): Promise<ConnectorMetadata[]>
  search(query: string, filters?: SearchFilters): Promise<RegistrySearchResult[]>
  getConnector(definitionId: string): Promise<ConnectorDefinition | undefined>

  // Version management
  getVersions(definitionId: string): Promise<ConnectorVersion[]>
  getLatestVersion(definitionId: string, options?: VersionOptions): Promise<ConnectorVersion | undefined>
  checkForUpdate(definitionId: string, currentVersion: string): Promise<ConnectorUpdateInfo>
  resolveVersion(definitionId: string, constraint: string): Promise<ConnectorVersion | undefined>
  compareVersions(v1: string, v2: string): number

  // Specifications
  getConnectorSpec(definitionId: string): Promise<ConnectorSpecification | undefined>

  // Locking
  createLockEntry(definitionId: string, version: string): Promise<LockEntry>
  verifyLockEntry(entry: LockEntry): Promise<boolean>

  // Breaking changes
  getBreakingChanges(definitionId: string, fromVersion: string, toVersion: string): Promise<BreakingChangesInfo>

  // Update workflow
  checkUpdateCompatibility(
    definitionId: string,
    fromVersion: string,
    toVersion: string,
  ): Promise<UpdateCompatibility>
  createUpdatePlan(definitionId: string, fromVersion: string, toVersion: string): Promise<UpdatePlan>

  // Cache management
  isCacheValid(): Promise<boolean>
  clearCache(): Promise<void>
}

/**
 * In-memory cache for registry data
 */
interface RegistryCache {
  sources: ConnectorMetadata[]
  destinations: ConnectorMetadata[]
  connectors: Map<string, ConnectorDefinition>
  versions: Map<string, ConnectorVersion[]>
  lastFetched: number
}

/**
 * Create a connector registry instance
 */
export function createConnectorRegistry(config: RegistryConfig): ConnectorRegistry {
  const cache: RegistryCache = {
    sources: [],
    destinations: [],
    connectors: new Map(),
    versions: new Map(),
    lastFetched: 0,
  }

  const cacheTtlMs = config.cacheTtlMs ?? 3600000 // 1 hour default

  /**
   * Check if cache is still valid
   */
  function isCacheExpired(): boolean {
    return Date.now() - cache.lastFetched > cacheTtlMs
  }

  /**
   * Fetch registry data from URL
   */
  async function fetchRegistry(): Promise<{ sources: ConnectorMetadata[]; destinations: ConnectorMetadata[] }> {
    const response = await fetch(config.registryUrl)

    if (!response.ok) {
      throw new Error(`Registry unavailable: ${response.status} ${response.statusText}`)
    }

    const text = await response.text()
    let data: unknown

    try {
      data = JSON.parse(text)
    } catch {
      throw new Error('Invalid response from registry: not valid JSON')
    }

    // Parse Airbyte registry format
    const registry = data as {
      sources?: Array<{
        sourceDefinitionId?: string
        name?: string
        dockerRepository?: string
        dockerImageTag?: string
        documentationUrl?: string
        icon?: string
        releaseStage?: string
      }>
      destinations?: Array<{
        destinationDefinitionId?: string
        name?: string
        dockerRepository?: string
        dockerImageTag?: string
        documentationUrl?: string
        icon?: string
        releaseStage?: string
      }>
    }

    const sources: ConnectorMetadata[] = (registry.sources || []).map((s) => ({
      definitionId: s.sourceDefinitionId || s.name || 'unknown',
      name: s.name || 'Unknown Source',
      dockerRepository: s.dockerRepository || '',
      dockerImageTag: s.dockerImageTag || 'latest',
      documentationUrl: s.documentationUrl,
      icon: s.icon,
      releaseStage: (s.releaseStage as ReleaseStage) || 'alpha',
      type: 'source' as ConnectorType,
    }))

    const destinations: ConnectorMetadata[] = (registry.destinations || []).map((d) => ({
      definitionId: d.destinationDefinitionId || d.name || 'unknown',
      name: d.name || 'Unknown Destination',
      dockerRepository: d.dockerRepository || '',
      dockerImageTag: d.dockerImageTag || 'latest',
      documentationUrl: d.documentationUrl,
      icon: d.icon,
      releaseStage: (d.releaseStage as ReleaseStage) || 'alpha',
      type: 'destination' as ConnectorType,
    }))

    return { sources, destinations }
  }

  /**
   * Ensure cache is populated
   */
  async function ensureCache(forceRefresh = false): Promise<void> {
    if (!forceRefresh && !isCacheExpired() && cache.sources.length > 0) {
      return
    }

    const { sources, destinations } = await fetchRegistry()
    cache.sources = sources
    cache.destinations = destinations
    cache.lastFetched = Date.now()

    // Index connectors by ID
    for (const source of sources) {
      cache.connectors.set(source.definitionId, source)
      // Also index by name patterns
      const shortId = source.dockerRepository.split('/').pop() || source.definitionId
      if (!cache.connectors.has(shortId)) {
        cache.connectors.set(shortId, source)
      }
    }
    for (const dest of destinations) {
      cache.connectors.set(dest.definitionId, dest)
      const shortId = dest.dockerRepository.split('/').pop() || dest.definitionId
      if (!cache.connectors.has(shortId)) {
        cache.connectors.set(shortId, dest)
      }
    }
  }

  /**
   * Parse semantic version string
   */
  function parseVersion(version: string): [number, number, number, string?] {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/)
    if (!match) {
      return [0, 0, 0, version]
    }
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), match[4]]
  }

  /**
   * Compare two semantic versions
   */
  function compareVersions(v1: string, v2: string): number {
    const [major1, minor1, patch1, pre1] = parseVersion(v1)
    const [major2, minor2, patch2, pre2] = parseVersion(v2)

    if (major1 !== major2) return major1 - major2
    if (minor1 !== minor2) return minor1 - minor2
    if (patch1 !== patch2) return patch1 - patch2

    // Pre-release versions are less than release versions
    if (pre1 && !pre2) return -1
    if (!pre1 && pre2) return 1
    if (pre1 && pre2) return pre1.localeCompare(pre2)

    return 0
  }

  /**
   * Check if version satisfies constraint
   */
  function satisfiesConstraint(version: string, constraint: string): boolean {
    if (constraint === 'latest') return true

    const [major, minor, patch] = parseVersion(version)
    const [cMajor, cMinor, cPatch] = parseVersion(constraint.replace(/^[\^~>=<]+/, ''))

    if (constraint.startsWith('^')) {
      // ^1.2.3 allows 1.x.x but not 2.0.0
      return major === cMajor && (minor > cMinor || (minor === cMinor && patch >= cPatch))
    }

    if (constraint.startsWith('~')) {
      // ~1.2.3 allows 1.2.x but not 1.3.0
      return major === cMajor && minor === cMinor && patch >= cPatch
    }

    if (constraint.startsWith('>=')) {
      return compareVersions(version, constraint.slice(2)) >= 0
    }

    // Exact match
    return version === constraint
  }

  /**
   * Generate simulated versions for a connector
   */
  function generateVersions(connector: ConnectorDefinition): ConnectorVersion[] {
    const currentTag = connector.dockerImageTag
    const versions: ConnectorVersion[] = []

    // Parse current version
    const [major, minor, patch] = parseVersion(currentTag)

    // Generate some historical versions
    for (let m = 0; m <= major; m++) {
      for (let n = 0; n <= (m === major ? minor : 2); n++) {
        for (let p = 0; p <= (m === major && n === minor ? patch : 2); p++) {
          versions.push({
            version: `${m}.${n}.${p}`,
            dockerImageTag: `${m}.${n}.${p}`,
            releaseDate: new Date(Date.now() - (major - m) * 30 * 24 * 60 * 60 * 1000).toISOString(),
          })
        }
      }
    }

    return versions.sort((a, b) => compareVersions(b.version, a.version))
  }

  return {
    async listSources(options?: ListOptions): Promise<ConnectorMetadata[]> {
      try {
        await ensureCache(options?.forceRefresh)
        return [...cache.sources]
      } catch (error) {
        if (options?.useCacheOnError && cache.sources.length > 0) {
          return [...cache.sources]
        }
        throw error
      }
    },

    async listDestinations(options?: ListOptions): Promise<ConnectorMetadata[]> {
      try {
        await ensureCache(options?.forceRefresh)
        return [...cache.destinations]
      } catch (error) {
        if (options?.useCacheOnError && cache.destinations.length > 0) {
          return [...cache.destinations]
        }
        throw error
      }
    },

    async search(query: string, filters?: SearchFilters): Promise<RegistrySearchResult[]> {
      await ensureCache()

      let results: ConnectorMetadata[] = [...cache.sources, ...cache.destinations]

      // Apply type filter
      if (filters?.type) {
        results = results.filter((c) => c.type === filters.type)
      }

      // Apply release stage filter
      if (filters?.releaseStage) {
        results = results.filter((c) => c.releaseStage === filters.releaseStage)
      }

      // Apply name search
      if (query) {
        const lowerQuery = query.toLowerCase()
        results = results.filter(
          (c) =>
            c.name.toLowerCase().includes(lowerQuery) ||
            c.definitionId.toLowerCase().includes(lowerQuery) ||
            c.dockerRepository.toLowerCase().includes(lowerQuery),
        )
      }

      return results.map((r) => ({ ...r, relevanceScore: 1 }))
    },

    async getConnector(definitionId: string): Promise<ConnectorDefinition | undefined> {
      await ensureCache()
      return cache.connectors.get(definitionId)
    },

    async getVersions(definitionId: string): Promise<ConnectorVersion[]> {
      // Check cache first
      if (cache.versions.has(definitionId)) {
        return cache.versions.get(definitionId)!
      }

      const connector = await this.getConnector(definitionId)
      if (!connector) {
        return []
      }

      // In production, this would fetch from a versions API
      // For now, generate based on current version
      const versions = generateVersions(connector)
      cache.versions.set(definitionId, versions)

      return versions
    },

    async getLatestVersion(definitionId: string, options?: VersionOptions): Promise<ConnectorVersion | undefined> {
      const versions = await this.getVersions(definitionId)

      if (options?.includePrerelease) {
        return versions[0]
      }

      // Filter out pre-release versions
      return versions.find((v) => !v.version.includes('-'))
    },

    async checkForUpdate(definitionId: string, currentVersion: string): Promise<ConnectorUpdateInfo> {
      const latest = await this.getLatestVersion(definitionId)

      if (!latest) {
        return {
          hasUpdate: false,
          currentVersion,
        }
      }

      const comparison = compareVersions(latest.version, currentVersion)

      return {
        hasUpdate: comparison > 0,
        currentVersion,
        latestVersion: latest.version,
        breakingChanges: parseVersion(latest.version)[0] > parseVersion(currentVersion)[0],
      }
    },

    async resolveVersion(definitionId: string, constraint: string): Promise<ConnectorVersion | undefined> {
      if (constraint === 'latest') {
        return this.getLatestVersion(definitionId)
      }

      const versions = await this.getVersions(definitionId)

      return versions.find((v) => satisfiesConstraint(v.version, constraint))
    },

    compareVersions,

    async getConnectorSpec(definitionId: string): Promise<ConnectorSpecification | undefined> {
      const connector = await this.getConnector(definitionId)
      if (!connector) return undefined

      // In production, this would fetch the spec from the connector itself
      // For now, return a simulated spec
      return {
        connectionSpecification: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            database: { type: 'string' },
          },
          required: ['host', 'database'],
        },
        documentationUrl: connector.documentationUrl,
      }
    },

    async createLockEntry(definitionId: string, version: string): Promise<LockEntry> {
      const connector = await this.getConnector(definitionId)
      if (!connector) {
        throw new Error(`Connector ${definitionId} not found`)
      }

      const dockerImage = `${connector.dockerRepository}:${version}`

      // In production, would fetch actual digest from registry
      const digest = `sha256:${Buffer.from(dockerImage + Date.now()).toString('hex').slice(0, 64)}`

      return {
        connectorId: definitionId,
        version,
        dockerImage,
        digest,
        lockedAt: new Date().toISOString(),
      }
    },

    async verifyLockEntry(entry: LockEntry): Promise<boolean> {
      // In production, would verify digest against registry
      const expectedDigest = `sha256:${Buffer.from(entry.dockerImage + new Date(entry.lockedAt).getTime()).toString('hex').slice(0, 64)}`

      return entry.digest === expectedDigest
    },

    async getBreakingChanges(
      definitionId: string,
      fromVersion: string,
      toVersion: string,
    ): Promise<BreakingChangesInfo> {
      const [fromMajor] = parseVersion(fromVersion)
      const [toMajor] = parseVersion(toVersion)

      const isBreaking = toMajor > fromMajor

      return {
        isBreaking,
        reason: isBreaking ? 'Major version change detected' : undefined,
        protocolVersionChange: false,
        migrationNotes: isBreaking ? [`Review changelog for breaking changes from v${fromMajor} to v${toMajor}`] : [],
      }
    },

    async checkUpdateCompatibility(
      definitionId: string,
      fromVersion: string,
      toVersion: string,
    ): Promise<UpdateCompatibility> {
      const breakingChanges = await this.getBreakingChanges(definitionId, fromVersion, toVersion)

      return {
        compatible: !breakingChanges.isBreaking,
        warnings: breakingChanges.isBreaking ? ['This update contains breaking changes'] : [],
      }
    },

    async createUpdatePlan(
      definitionId: string,
      fromVersion: string,
      toVersion: string,
    ): Promise<UpdatePlan> {
      const connector = await this.getConnector(definitionId)
      const dockerImage = connector ? `${connector.dockerRepository}:${toVersion}` : `unknown:${toVersion}`

      return {
        steps: [
          {
            action: 'pull',
            description: `Pull new image ${dockerImage}`,
            command: `docker pull ${dockerImage}`,
          },
          {
            action: 'verify',
            description: 'Verify connection with new version',
            command: `docker run --rm ${dockerImage} check --config /path/to/config.json`,
          },
          {
            action: 'migrate',
            description: 'Update connector version in configuration',
          },
          {
            action: 'cleanup',
            description: 'Remove old image',
            command: `docker rmi ${connector?.dockerRepository}:${fromVersion}`,
          },
        ],
        rollbackPlan: {
          steps: [
            {
              action: 'pull',
              description: `Pull previous image ${connector?.dockerRepository}:${fromVersion}`,
              command: `docker pull ${connector?.dockerRepository}:${fromVersion}`,
            },
            {
              action: 'migrate',
              description: 'Revert connector version in configuration',
            },
          ],
        },
      }
    },

    async isCacheValid(): Promise<boolean> {
      return !isCacheExpired() && cache.sources.length > 0
    },

    async clearCache(): Promise<void> {
      cache.sources = []
      cache.destinations = []
      cache.connectors.clear()
      cache.versions.clear()
      cache.lastFetched = 0
    },
  }
}
