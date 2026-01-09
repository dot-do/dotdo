/**
 * Test Utilities for Capability Module Testing
 *
 * Provides common utilities for testing capability loading, lazy initialization,
 * and mixin behavior.
 */

import type { CapabilityRegistry, CapabilityModule } from '../capabilities'

// ============================================================================
// MODULE LOAD TRACKING
// ============================================================================

/**
 * Tracks when capability modules are instantiated
 */
export interface ModuleLoadRecord {
  loadCount: number
  instance: unknown
  loadTimestamps: number[]
}

/**
 * A tracker that monitors module instantiation
 */
export interface ModuleLoadTracker {
  [key: string]: ModuleLoadRecord
}

/**
 * Create a fresh module load tracker
 */
export function createModuleTracker(): ModuleLoadTracker {
  return {}
}

/**
 * Reset all counters in a tracker
 */
export function resetTracker(tracker: ModuleLoadTracker): void {
  for (const key of Object.keys(tracker)) {
    tracker[key] = {
      loadCount: 0,
      instance: null,
      loadTimestamps: [],
    }
  }
}

/**
 * Get total load count across all tracked modules
 */
export function getTotalLoadCount(tracker: ModuleLoadTracker): number {
  return Object.values(tracker).reduce((sum, record) => sum + record.loadCount, 0)
}

// ============================================================================
// MOCK CAPABILITY FACTORIES
// ============================================================================

/**
 * Options for creating tracked capability classes
 */
export interface TrackedCapabilityOptions {
  /** Custom methods to add to the capability */
  methods?: Record<string, (...args: unknown[]) => unknown>
  /** Custom properties to add to the capability */
  properties?: Record<string, unknown>
  /** Whether the capability should have a dispose method */
  disposable?: boolean
}

/**
 * Create a capability class that tracks its instantiation
 */
export function createTrackedCapability(
  name: string,
  tracker: ModuleLoadTracker,
  options: TrackedCapabilityOptions = {},
): CapabilityModule {
  const { methods = {}, properties = {}, disposable = false } = options

  return class TrackedCapability {
    static capabilityName = name

    constructor() {
      if (!tracker[name]) {
        tracker[name] = {
          loadCount: 0,
          instance: null,
          loadTimestamps: [],
        }
      }
      tracker[name].loadCount++
      tracker[name].instance = this
      tracker[name].loadTimestamps.push(Date.now())

      // Apply properties
      Object.assign(this, properties)
    }

    // Default test method
    testMethod(): string {
      return `${name} capability working`
    }

    // Apply custom methods
    ...Object.fromEntries(
      Object.entries(methods).map(([methodName, fn]) => [methodName, fn]),
    )

    // Conditional dispose
    ...(disposable
      ? {
          dispose(): void {
            // Cleanup logic
          },
        }
      : {})
  } as unknown as CapabilityModule
}

/**
 * Create a mock filesystem capability
 */
export function createMockFsCapability(tracker?: ModuleLoadTracker): CapabilityModule {
  const name = 'fs'

  return class MockFsCapability {
    constructor() {
      if (tracker) {
        if (!tracker[name]) {
          tracker[name] = { loadCount: 0, instance: null, loadTimestamps: [] }
        }
        tracker[name].loadCount++
        tracker[name].instance = this
        tracker[name].loadTimestamps.push(Date.now())
      }
    }

    async read(path: string): Promise<string> {
      return `contents of ${path}`
    }

    async write(path: string, content: string): Promise<void> {
      // Mock write
    }

    async exists(path: string): Promise<boolean> {
      return true
    }

    async delete(path: string): Promise<void> {
      // Mock delete
    }

    async list(path: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
      return [
        { name: 'file.txt', isDirectory: false },
        { name: 'dir', isDirectory: true },
      ]
    }

    async mkdir(path: string): Promise<void> {
      // Mock mkdir
    }

    async stat(path: string): Promise<{
      size: number
      isDirectory: boolean
      isFile: boolean
      createdAt: Date
      modifiedAt: Date
    }> {
      return {
        size: 1024,
        isDirectory: false,
        isFile: true,
        createdAt: new Date(),
        modifiedAt: new Date(),
      }
    }

    async copy(src: string, dest: string): Promise<void> {
      // Mock copy
    }

    async move(src: string, dest: string): Promise<void> {
      // Mock move
    }
  } as unknown as CapabilityModule
}

/**
 * Create a mock git capability
 */
export function createMockGitCapability(tracker?: ModuleLoadTracker): CapabilityModule {
  const name = 'git'

  return class MockGitCapability {
    constructor() {
      if (tracker) {
        if (!tracker[name]) {
          tracker[name] = { loadCount: 0, instance: null, loadTimestamps: [] }
        }
        tracker[name].loadCount++
        tracker[name].instance = this
        tracker[name].loadTimestamps.push(Date.now())
      }
    }

    async status(): Promise<{
      branch: string
      staged: string[]
      unstaged: string[]
      untracked: string[]
      ahead: number
      behind: number
    }> {
      return {
        branch: 'main',
        staged: [],
        unstaged: [],
        untracked: [],
        ahead: 0,
        behind: 0,
      }
    }

    async add(files: string | string[]): Promise<void> {
      // Mock add
    }

    async commit(message: string): Promise<{ hash: string; message: string }> {
      return { hash: 'abc123', message }
    }

    async push(): Promise<void> {
      // Mock push
    }

    async pull(): Promise<void> {
      // Mock pull
    }

    async checkout(ref: string): Promise<void> {
      // Mock checkout
    }

    async branch(): Promise<{ current: string; all: string[] }> {
      return { current: 'main', all: ['main', 'develop'] }
    }

    async log(count?: number): Promise<
      Array<{
        hash: string
        message: string
        author: string
        date: Date
      }>
    > {
      return [
        {
          hash: 'abc123',
          message: 'Initial commit',
          author: 'test@example.com',
          date: new Date(),
        },
      ]
    }

    async diff(): Promise<{
      files: Array<{
        path: string
        additions: number
        deletions: number
        patch: string
      }>
    }> {
      return { files: [] }
    }

    async clone(url: string, dest?: string): Promise<void> {
      // Mock clone
    }

    async init(): Promise<void> {
      // Mock init
    }

    async stash(): Promise<void> {
      // Mock stash
    }

    async merge(branch: string): Promise<{ success: boolean; conflicts: string[] }> {
      return { success: true, conflicts: [] }
    }

    async rebase(onto: string): Promise<void> {
      // Mock rebase
    }

    async reset(ref?: string): Promise<void> {
      // Mock reset
    }

    async tag(name?: string): Promise<void | string[]> {
      return name ? undefined : ['v1.0.0', 'v1.1.0']
    }

    async remote(): Promise<Array<{ name: string; url: string }>> {
      return [{ name: 'origin', url: 'https://github.com/user/repo.git' }]
    }
  } as unknown as CapabilityModule
}

/**
 * Create a mock bash capability
 */
export function createMockBashCapability(tracker?: ModuleLoadTracker): CapabilityModule {
  const name = 'bash'

  return class MockBashCapability {
    constructor() {
      if (tracker) {
        if (!tracker[name]) {
          tracker[name] = { loadCount: 0, instance: null, loadTimestamps: [] }
        }
        tracker[name].loadCount++
        tracker[name].instance = this
        tracker[name].loadTimestamps.push(Date.now())
      }
    }

    async exec(command: string): Promise<{
      stdout: string
      stderr: string
      exitCode: number
    }> {
      return { stdout: '', stderr: '', exitCode: 0 }
    }

    async run(command: string): Promise<string> {
      return ''
    }

    async spawn(
      command: string,
      args?: string[],
    ): Promise<{
      pid: number
      kill: () => void
    }> {
      return {
        pid: 12345,
        kill: () => {},
      }
    }

    async which(binary: string): Promise<string | null> {
      return `/usr/bin/${binary}`
    }

    env(key?: string, value?: string): Record<string, string> | string | undefined {
      if (key === undefined) {
        return { PATH: '/usr/bin' }
      }
      if (value === undefined) {
        return '/usr/bin'
      }
      return undefined
    }

    async cd(path: string): Promise<void> {
      // Mock cd
    }

    async pipe(commands: string[]): Promise<{
      stdout: string
      stderr: string
      exitCode: number
    }> {
      return { stdout: '', stderr: '', exitCode: 0 }
    }
  } as unknown as CapabilityModule
}

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

/**
 * Assert that a capability was loaded exactly once
 */
export function assertLoadedOnce(tracker: ModuleLoadTracker, name: string): void {
  const record = tracker[name]
  if (!record) {
    throw new Error(`Capability '${name}' was never loaded`)
  }
  if (record.loadCount !== 1) {
    throw new Error(`Capability '${name}' was loaded ${record.loadCount} times, expected 1`)
  }
}

/**
 * Assert that a capability was never loaded
 */
export function assertNeverLoaded(tracker: ModuleLoadTracker, name: string): void {
  const record = tracker[name]
  if (record && record.loadCount > 0) {
    throw new Error(`Capability '${name}' was loaded ${record.loadCount} times, expected 0`)
  }
}

/**
 * Assert that capabilities were loaded in a specific order
 */
export function assertLoadOrder(tracker: ModuleLoadTracker, expectedOrder: string[]): void {
  const loadTimes = expectedOrder.map((name) => {
    const record = tracker[name]
    if (!record || record.loadTimestamps.length === 0) {
      throw new Error(`Capability '${name}' was never loaded`)
    }
    return { name, timestamp: record.loadTimestamps[0] }
  })

  for (let i = 1; i < loadTimes.length; i++) {
    if (loadTimes[i].timestamp < loadTimes[i - 1].timestamp) {
      throw new Error(
        `Capability '${loadTimes[i].name}' was loaded before '${loadTimes[i - 1].name}', but expected reverse order`,
      )
    }
  }
}

// ============================================================================
// REGISTRY TEST HELPERS
// ============================================================================

/**
 * Create a registry pre-populated with mock capabilities
 */
export function createTestRegistry(
  capabilities: ('fs' | 'git' | 'bash')[] = [],
  tracker?: ModuleLoadTracker,
): CapabilityRegistry {
  // Dynamic import to avoid circular dependencies
  const { CapabilityRegistry } = require('../capabilities')
  const registry = new CapabilityRegistry()

  if (capabilities.includes('fs')) {
    registry.register('fs', createMockFsCapability(tracker))
  }
  if (capabilities.includes('git')) {
    registry.register('git', createMockGitCapability(tracker))
  }
  if (capabilities.includes('bash')) {
    registry.register('bash', createMockBashCapability(tracker))
  }

  return registry
}

/**
 * Options for capability test scenarios
 */
export interface CapabilityTestScenario {
  name: string
  capabilities: ('fs' | 'git' | 'bash')[]
  accessOrder: string[]
  expectedLoads: Record<string, number>
}

/**
 * Run a capability loading test scenario
 */
export async function runCapabilityScenario(
  scenario: CapabilityTestScenario,
): Promise<{
  passed: boolean
  tracker: ModuleLoadTracker
  errors: string[]
}> {
  const { createCapabilityProxy } = require('../capabilities')
  const tracker = createModuleTracker()
  const registry = createTestRegistry(scenario.capabilities, tracker)
  const proxy = createCapabilityProxy(registry)
  const errors: string[] = []

  // Access capabilities in specified order
  for (const capName of scenario.accessOrder) {
    try {
      const _ = (proxy as Record<string, unknown>)[capName]
    } catch (error) {
      errors.push(`Error accessing ${capName}: ${error}`)
    }
  }

  // Verify load counts
  for (const [name, expectedCount] of Object.entries(scenario.expectedLoads)) {
    const actualCount = tracker[name]?.loadCount ?? 0
    if (actualCount !== expectedCount) {
      errors.push(`${name}: expected ${expectedCount} loads, got ${actualCount}`)
    }
  }

  return {
    passed: errors.length === 0,
    tracker,
    errors,
  }
}
