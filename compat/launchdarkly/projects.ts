/**
 * @dotdo/launchdarkly - Project and Environment Management
 *
 * Implements LaunchDarkly project and environment CRUD operations.
 */

import type {
  Project,
  Environment,
  CreateProjectRequest,
  CreateEnvironmentRequest,
  UpdateEnvironmentRequest,
} from './types'

// =============================================================================
// Project Store
// =============================================================================

/**
 * In-memory project store (for testing and edge runtime)
 */
export class ProjectStore {
  private _projects: Map<string, Project> = new Map()

  /**
   * Create a new project
   */
  async create(request: CreateProjectRequest): Promise<Project> {
    if (this._projects.has(request.key)) {
      throw new Error(`Project ${request.key} already exists`)
    }

    const defaultEnv = request.environments?.[0] ?? {
      key: 'production',
      name: 'Production',
      color: '417505',
    }

    const project: Project = {
      key: request.key,
      name: request.name,
      tags: request.tags ?? [],
      environments: [],
      defaultClientSideAvailability: request.defaultClientSideAvailability ?? {
        usingEnvironmentId: false,
        usingMobileKey: true,
      },
      includeInSnippetByDefault: request.includeInSnippetByDefault ?? false,
    }

    // Create default environments
    const environments = request.environments ?? [
      defaultEnv,
      { key: 'test', name: 'Test', color: 'F5A623' },
    ]

    for (const envRequest of environments) {
      const env = createEnvironment(project.key, envRequest)
      project.environments.push(env)
    }

    this._projects.set(project.key, project)
    return project
  }

  /**
   * Get a project by key
   */
  async get(projectKey: string): Promise<Project | null> {
    return this._projects.get(projectKey) ?? null
  }

  /**
   * List all projects
   */
  async list(): Promise<Project[]> {
    return Array.from(this._projects.values())
  }

  /**
   * Update a project
   */
  async update(
    projectKey: string,
    updates: Partial<CreateProjectRequest>
  ): Promise<Project | null> {
    const project = this._projects.get(projectKey)
    if (!project) return null

    if (updates.name !== undefined) project.name = updates.name
    if (updates.tags !== undefined) project.tags = updates.tags
    if (updates.defaultClientSideAvailability !== undefined) {
      project.defaultClientSideAvailability = updates.defaultClientSideAvailability
    }
    if (updates.includeInSnippetByDefault !== undefined) {
      project.includeInSnippetByDefault = updates.includeInSnippetByDefault
    }

    this._projects.set(projectKey, project)
    return project
  }

  /**
   * Delete a project
   */
  async delete(projectKey: string): Promise<boolean> {
    return this._projects.delete(projectKey)
  }

  /**
   * Add environment to project
   */
  async addEnvironment(
    projectKey: string,
    request: CreateEnvironmentRequest
  ): Promise<Environment | null> {
    const project = this._projects.get(projectKey)
    if (!project) return null

    // Check for duplicate
    if (project.environments.some((e) => e.key === request.key)) {
      throw new Error(`Environment ${request.key} already exists in project ${projectKey}`)
    }

    const env = createEnvironment(projectKey, request)
    project.environments.push(env)
    this._projects.set(projectKey, project)
    return env
  }

  /**
   * Get environment from project
   */
  async getEnvironment(projectKey: string, envKey: string): Promise<Environment | null> {
    const project = this._projects.get(projectKey)
    if (!project) return null
    return project.environments.find((e) => e.key === envKey) ?? null
  }

  /**
   * Update environment
   */
  async updateEnvironment(
    projectKey: string,
    envKey: string,
    updates: UpdateEnvironmentRequest
  ): Promise<Environment | null> {
    const project = this._projects.get(projectKey)
    if (!project) return null

    const envIndex = project.environments.findIndex((e) => e.key === envKey)
    if (envIndex === -1) return null

    const env = project.environments[envIndex]!
    if (updates.name !== undefined) env.name = updates.name
    if (updates.color !== undefined) env.color = updates.color
    if (updates.defaultTtl !== undefined) env.defaultTtl = updates.defaultTtl
    if (updates.secureMode !== undefined) env.secureMode = updates.secureMode
    if (updates.defaultTrackEvents !== undefined) env.defaultTrackEvents = updates.defaultTrackEvents
    if (updates.requireComments !== undefined) env.requireComments = updates.requireComments
    if (updates.confirmChanges !== undefined) env.confirmChanges = updates.confirmChanges

    project.environments[envIndex] = env
    this._projects.set(projectKey, project)
    return env
  }

  /**
   * Delete environment
   */
  async deleteEnvironment(projectKey: string, envKey: string): Promise<boolean> {
    const project = this._projects.get(projectKey)
    if (!project) return false

    const initialLength = project.environments.length
    project.environments = project.environments.filter((e) => e.key !== envKey)

    if (project.environments.length < initialLength) {
      this._projects.set(projectKey, project)
      return true
    }
    return false
  }

  /**
   * Clear all projects (for testing)
   */
  clear(): void {
    this._projects.clear()
  }
}

// =============================================================================
// Environment Helper
// =============================================================================

/**
 * Create a new environment with generated keys
 */
function createEnvironment(projectKey: string, request: CreateEnvironmentRequest): Environment {
  return {
    key: request.key,
    name: request.name,
    color: request.color,
    apiKey: generateApiKey(projectKey, request.key),
    mobileKey: generateMobileKey(projectKey, request.key),
    defaultTtl: request.defaultTtl ?? 0,
    secureMode: request.secureMode ?? false,
    defaultTrackEvents: request.defaultTrackEvents ?? false,
    requireComments: request.requireComments ?? false,
    confirmChanges: request.confirmChanges ?? false,
    tags: [],
  }
}

/**
 * Generate a deterministic API key for an environment
 */
function generateApiKey(projectKey: string, envKey: string): string {
  const base = `sdk-${projectKey}-${envKey}`
  const hash = simpleHash(base)
  return `sdk-${hash.slice(0, 8)}-${hash.slice(8, 16)}-${hash.slice(16, 24)}`
}

/**
 * Generate a deterministic mobile key for an environment
 */
function generateMobileKey(projectKey: string, envKey: string): string {
  const base = `mob-${projectKey}-${envKey}`
  const hash = simpleHash(base)
  return `mob-${hash.slice(0, 8)}-${hash.slice(8, 16)}-${hash.slice(16, 24)}`
}

/**
 * Simple hash function for key generation
 */
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(24, '0')
}

// =============================================================================
// Factory Functions
// =============================================================================

let _globalProjectStore: ProjectStore | null = null

/**
 * Create a new project store
 */
export function createProjectStore(): ProjectStore {
  return new ProjectStore()
}

/**
 * Get or create global project store
 */
export function getProjectStore(): ProjectStore {
  if (!_globalProjectStore) {
    _globalProjectStore = new ProjectStore()
  }
  return _globalProjectStore
}

/**
 * Set global project store
 */
export function setProjectStore(store: ProjectStore): void {
  _globalProjectStore = store
}

/**
 * Clear global state (for testing)
 */
export function _clearProjects(): void {
  _globalProjectStore = null
}
