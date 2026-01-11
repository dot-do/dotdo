/**
 * Database/Test Data Fixtures for E2E Tests
 *
 * Provides fixtures for setting up and tearing down test data.
 * Manages test isolation by cleaning up created data after each test.
 */

import { test as base, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

/**
 * DB fixture types
 */
export type DBFixtures = {
  /** Test data factory */
  factory: TestDataFactory

  /** Seeder for bulk test data */
  seeder: TestDataSeeder

  /** Cleanup helper */
  cleanupTestData: () => Promise<void>
}

/**
 * Test data types
 */
export type CreatedUser = {
  id: string
  email: string
  name: string
}

export type CreatedThing = {
  id: string
  name: string
  description?: string
}

export type CreatedWorkflow = {
  id: string
  name: string
  status: string
}

/**
 * Test data factory for creating individual entities
 */
export class TestDataFactory {
  private createdUsers: string[] = []
  private createdThings: string[] = []
  private createdWorkflows: string[] = []
  private idCounter = 0

  constructor(private request: APIRequestContext) {}

  /**
   * Generate a unique ID for test data
   */
  uniqueId(prefix = 'test'): string {
    this.idCounter++
    return `${prefix}-${Date.now()}-${this.idCounter}`
  }

  /**
   * Generate unique email
   */
  uniqueEmail(): string {
    return `${this.uniqueId('user')}@test.example.com.ai`
  }

  /**
   * Create a user via API
   */
  async createUser(data?: Partial<{ email: string; name: string; password: string }>): Promise<CreatedUser | null> {
    const userData = {
      email: data?.email || this.uniqueEmail(),
      name: data?.name || `Test User ${this.idCounter}`,
      password: data?.password || 'test-password-123',
    }

    try {
      const response = await this.request.post('/api/users', {
        headers: { 'Content-Type': 'application/json' },
        data: userData,
      })

      if (response.ok()) {
        const user = await response.json()
        this.createdUsers.push(user.id)
        return user
      }
    } catch {
      // API might not exist yet
    }

    return null
  }

  /**
   * Create a thing via API
   */
  async createThing(data?: Partial<{ name: string; description: string }>): Promise<CreatedThing | null> {
    const thingData = {
      name: data?.name || `Test Thing ${this.uniqueId('thing')}`,
      description: data?.description,
    }

    try {
      const response = await this.request.post('/api/things', {
        headers: { 'Content-Type': 'application/json' },
        data: thingData,
      })

      if (response.ok()) {
        const thing = await response.json()
        this.createdThings.push(thing.id)
        return thing
      }
    } catch {
      // API might not exist yet
    }

    return null
  }

  /**
   * Create a workflow via API
   */
  async createWorkflow(data?: Partial<{ name: string }>): Promise<CreatedWorkflow | null> {
    const workflowData = {
      name: data?.name || `Test Workflow ${this.uniqueId('workflow')}`,
    }

    try {
      const response = await this.request.post('/api/workflows', {
        headers: { 'Content-Type': 'application/json' },
        data: workflowData,
      })

      if (response.ok()) {
        const workflow = await response.json()
        this.createdWorkflows.push(workflow.id)
        return workflow
      }
    } catch {
      // API might not exist yet
    }

    return null
  }

  /**
   * Get all created entity IDs
   */
  getCreatedIds(): { users: string[]; things: string[]; workflows: string[] } {
    return {
      users: [...this.createdUsers],
      things: [...this.createdThings],
      workflows: [...this.createdWorkflows],
    }
  }

  /**
   * Cleanup all created test data
   */
  async cleanup(): Promise<void> {
    // Delete things
    for (const id of this.createdThings) {
      try {
        await this.request.delete(`/api/things/${id}`)
      } catch {
        // Ignore errors - entity might already be deleted
      }
    }

    // Delete workflows
    for (const id of this.createdWorkflows) {
      try {
        await this.request.delete(`/api/workflows/${id}`)
      } catch {
        // Ignore errors
      }
    }

    // Delete users (should be last as other entities might reference them)
    for (const id of this.createdUsers) {
      try {
        await this.request.delete(`/api/users/${id}`)
      } catch {
        // Ignore errors
      }
    }

    // Clear tracking arrays
    this.createdUsers = []
    this.createdThings = []
    this.createdWorkflows = []
  }
}

/**
 * Test data seeder for bulk operations
 */
export class TestDataSeeder {
  constructor(private factory: TestDataFactory) {}

  /**
   * Seed multiple users
   */
  async seedUsers(count: number): Promise<CreatedUser[]> {
    const users: CreatedUser[] = []

    for (let i = 0; i < count; i++) {
      const user = await this.factory.createUser({
        name: `Seeded User ${i + 1}`,
      })
      if (user) users.push(user)
    }

    return users
  }

  /**
   * Seed multiple things
   */
  async seedThings(count: number): Promise<CreatedThing[]> {
    const things: CreatedThing[] = []

    for (let i = 0; i < count; i++) {
      const thing = await this.factory.createThing({
        name: `Seeded Thing ${i + 1}`,
        description: `Description for thing ${i + 1}`,
      })
      if (thing) things.push(thing)
    }

    return things
  }

  /**
   * Seed a complete test environment
   */
  async seedTestEnvironment(): Promise<{
    users: CreatedUser[]
    things: CreatedThing[]
    workflows: CreatedWorkflow[]
  }> {
    const users = await this.seedUsers(3)
    const things = await this.seedThings(5)
    const workflows: CreatedWorkflow[] = []

    // Create some workflows
    for (let i = 0; i < 2; i++) {
      const workflow = await this.factory.createWorkflow({
        name: `Seeded Workflow ${i + 1}`,
      })
      if (workflow) workflows.push(workflow)
    }

    return { users, things, workflows }
  }
}

/**
 * Extended test with DB fixtures
 */
export const test = base.extend<DBFixtures>({
  // Test data factory
  factory: async ({ request }, use) => {
    const factory = new TestDataFactory(request)
    await use(factory)
    // Cleanup after test
    await factory.cleanup()
  },

  // Test data seeder
  seeder: async ({ request }, use) => {
    const factory = new TestDataFactory(request)
    const seeder = new TestDataSeeder(factory)
    await use(seeder)
    // Cleanup after test
    await factory.cleanup()
  },

  // Cleanup helper
  cleanupTestData: async ({ request }, use) => {
    const factory = new TestDataFactory(request)

    const cleanupFn = async () => {
      await factory.cleanup()
    }

    await use(cleanupFn)
  },
})

/**
 * Test data assertions
 */
export const dataExpect = {
  /**
   * Assert entity was created
   */
  toBeCreated<T extends { id: string }>(entity: T | null): asserts entity is T {
    expect(entity).not.toBeNull()
    expect(entity!.id).toBeTruthy()
  },

  /**
   * Assert entity has expected properties
   */
  toHaveProperties<T extends object>(entity: T, properties: Partial<T>): void {
    for (const [key, value] of Object.entries(properties)) {
      expect((entity as Record<string, unknown>)[key]).toBe(value)
    }
  },
}

export { expect } from '@playwright/test'
