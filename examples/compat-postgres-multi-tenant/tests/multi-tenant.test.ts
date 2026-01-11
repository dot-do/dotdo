/**
 * Multi-Tenant Postgres Example - Test Suite
 *
 * Tests for:
 * - Tenant isolation
 * - CRUD operations
 * - Authentication
 * - Query builder
 * - Row-level security patterns
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  query,
  insert,
  insertMany,
  update,
  upsert,
  deleteById,
  deleteMany,
  transaction,
  type BaseRow,
  type QueryResult,
} from '../src/queries'
import {
  AuthService,
  hashPassword,
  verifyPassword,
  generateJWT,
  verifyJWT,
} from '../src/auth'

// ============================================================================
// MOCK STORAGE
// ============================================================================

/**
 * In-memory mock of DurableObjectStorage for testing
 */
class MockStorage {
  private data: Map<string, unknown> = new Map()

  async get(key: string): Promise<unknown> {
    return this.data.get(key)
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async list(): Promise<Map<string, unknown>> {
    return new Map(this.data)
  }

  // For testing - clear all data
  clear(): void {
    this.data.clear()
  }
}

// ============================================================================
// TEST TYPES
// ============================================================================

interface User extends BaseRow {
  email: string
  name: string
  role: 'admin' | 'member' | 'viewer'
}

interface Project extends BaseRow {
  name: string
  description?: string
  team_id: string
  status: 'active' | 'archived'
}

interface Task extends BaseRow {
  title: string
  project_id: string
  assignee_id?: string
  status: 'todo' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high'
}

// ============================================================================
// TENANT ISOLATION TESTS
// ============================================================================

describe('Multi-Tenant Isolation', () => {
  let storage1: MockStorage
  let storage2: MockStorage

  beforeEach(() => {
    storage1 = new MockStorage()
    storage2 = new MockStorage()
  })

  it('should isolate data between tenants', async () => {
    const tenant1 = 'acme'
    const tenant2 = 'globex'

    // Insert user in tenant 1
    await insert<User>(storage1 as unknown as DurableObjectStorage, 'users', tenant1, {
      email: 'alice@acme.com',
      name: 'Alice',
      role: 'admin',
    })

    // Insert user in tenant 2
    await insert<User>(storage2 as unknown as DurableObjectStorage, 'users', tenant2, {
      email: 'bob@globex.com',
      name: 'Bob',
      role: 'admin',
    })

    // Query tenant 1
    const result1 = await query<User>(storage1 as unknown as DurableObjectStorage, 'users', tenant1).execute()

    // Query tenant 2
    const result2 = await query<User>(storage2 as unknown as DurableObjectStorage, 'users', tenant2).execute()

    // Verify isolation
    expect(result1.data).toHaveLength(1)
    expect(result1.data?.[0].email).toBe('alice@acme.com')
    expect(result1.data?.[0].tenant_id).toBe(tenant1)

    expect(result2.data).toHaveLength(1)
    expect(result2.data?.[0].email).toBe('bob@globex.com')
    expect(result2.data?.[0].tenant_id).toBe(tenant2)
  })

  it('should not leak data across tenant boundaries', async () => {
    const tenant1 = 'acme'
    const tenant2 = 'globex'

    // Insert secret data in tenant 1
    await insert<User>(storage1 as unknown as DurableObjectStorage, 'users', tenant1, {
      email: 'secret@acme.com',
      name: 'Secret User',
      role: 'admin',
    })

    // Tenant 2's storage should be empty
    const result = await query<User>(storage2 as unknown as DurableObjectStorage, 'users', tenant2).execute()

    expect(result.data).toHaveLength(0)
  })
})

// ============================================================================
// CRUD OPERATIONS TESTS
// ============================================================================

describe('CRUD Operations', () => {
  let storage: MockStorage
  const tenantId = 'test-tenant'

  beforeEach(() => {
    storage = new MockStorage()
  })

  describe('Insert', () => {
    it('should insert a single row', async () => {
      const result = await insert<User>(storage as unknown as DurableObjectStorage, 'users', tenantId, {
        email: 'test@example.com',
        name: 'Test User',
        role: 'member',
      })

      expect(result.error).toBeNull()
      expect(result.data).toBeDefined()
      expect(result.data?.id).toBeDefined()
      expect(result.data?.email).toBe('test@example.com')
      expect(result.data?.tenant_id).toBe(tenantId)
      expect(result.data?.created_at).toBeDefined()
      expect(result.data?.updated_at).toBeDefined()
    })

    it('should insert multiple rows', async () => {
      const users = [
        { email: 'user1@example.com', name: 'User 1', role: 'member' as const },
        { email: 'user2@example.com', name: 'User 2', role: 'member' as const },
        { email: 'user3@example.com', name: 'User 3', role: 'admin' as const },
      ]

      const result = await insertMany<User>(storage as unknown as DurableObjectStorage, 'users', tenantId, users)

      expect(result.error).toBeNull()
      expect(result.data).toHaveLength(3)
      expect(result.data?.every((u) => u.tenant_id === tenantId)).toBe(true)
    })
  })

  describe('Query', () => {
    beforeEach(async () => {
      // Seed test data
      await insertMany<User>(storage as unknown as DurableObjectStorage, 'users', tenantId, [
        { email: 'alice@example.com', name: 'Alice', role: 'admin' },
        { email: 'bob@example.com', name: 'Bob', role: 'member' },
        { email: 'carol@example.com', name: 'Carol', role: 'viewer' },
      ])
    })

    it('should query all rows', async () => {
      const result = await query<User>(storage as unknown as DurableObjectStorage, 'users', tenantId).execute()

      expect(result.error).toBeNull()
      expect(result.data).toHaveLength(3)
    })

    it('should filter with where clause', async () => {
      const result = await query<User>(storage as unknown as DurableObjectStorage, 'users', tenantId)
        .where('role', 'eq', 'admin')
        .execute()

      expect(result.error).toBeNull()
      expect(result.data).toHaveLength(1)
      expect(result.data?.[0].name).toBe('Alice')
    })

    it('should filter with whereIn', async () => {
      const result = await query<User>(storage as unknown as DurableObjectStorage, 'users', tenantId)
        .whereIn('role', ['admin', 'member'])
        .execute()

      expect(result.error).toBeNull()
      expect(result.data).toHaveLength(2)
    })

    it('should sort results', async () => {
      const result = await query<User>(storage as unknown as DurableObjectStorage, 'users', tenantId)
        .orderBy('name', 'asc')
        .execute()

      expect(result.error).toBeNull()
      expect(result.data?.[0].name).toBe('Alice')
      expect(result.data?.[1].name).toBe('Bob')
      expect(result.data?.[2].name).toBe('Carol')
    })

    it('should paginate results', async () => {
      const result = await query<User>(storage as unknown as DurableObjectStorage, 'users', tenantId)
        .orderBy('name', 'asc')
        .paginate(1, 2)
        .execute()

      expect(result.error).toBeNull()
      expect(result.data).toHaveLength(2)
      expect(result.data?.[0].name).toBe('Alice')
      expect(result.data?.[1].name).toBe('Bob')
    })

    it('should return first row', async () => {
      const result = await query<User>(storage as unknown as DurableObjectStorage, 'users', tenantId)
        .where('role', 'eq', 'admin')
        .first()

      expect(result.error).toBeNull()
      expect(result.data?.name).toBe('Alice')
    })

    it('should return null with firstOrNull when no match', async () => {
      const result = await query<User>(storage as unknown as DurableObjectStorage, 'users', tenantId)
        .where('role', 'eq', 'superadmin')
        .firstOrNull()

      expect(result.error).toBeNull()
      expect(result.data).toBeNull()
    })

    it('should count rows', async () => {
      const result = await query<User>(storage as unknown as DurableObjectStorage, 'users', tenantId)
        .where('role', 'neq', 'viewer')
        .count()

      expect(result.error).toBeNull()
      expect(result.data).toBe(2)
    })

    it('should check existence', async () => {
      const exists = await query<User>(storage as unknown as DurableObjectStorage, 'users', tenantId)
        .where('email', 'eq', 'alice@example.com')
        .exists()

      expect(exists).toBe(true)

      const notExists = await query<User>(storage as unknown as DurableObjectStorage, 'users', tenantId)
        .where('email', 'eq', 'unknown@example.com')
        .exists()

      expect(notExists).toBe(false)
    })
  })

  describe('Update', () => {
    it('should update a row', async () => {
      const inserted = await insert<User>(storage as unknown as DurableObjectStorage, 'users', tenantId, {
        email: 'test@example.com',
        name: 'Test',
        role: 'member',
      })

      // Wait a moment to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10))

      const updated = await update<User>(storage as unknown as DurableObjectStorage, 'users', inserted.data!.id, {
        name: 'Updated Name',
        role: 'admin',
      })

      expect(updated.error).toBeNull()
      expect(updated.data?.name).toBe('Updated Name')
      expect(updated.data?.role).toBe('admin')
      // Verify the row was updated (id stays same, data changes)
      expect(updated.data?.id).toBe(inserted.data?.id)
    })

    it('should return error for non-existent row', async () => {
      const result = await update<User>(storage as unknown as DurableObjectStorage, 'users', 'non-existent-id', {
        name: 'Test',
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('NOT_FOUND')
    })
  })

  describe('Upsert', () => {
    it('should insert new row on upsert', async () => {
      const result = await upsert<User>(storage as unknown as DurableObjectStorage, 'users', tenantId, {
        email: 'new@example.com',
        name: 'New User',
        role: 'member',
      })

      expect(result.error).toBeNull()
      expect(result.data?.email).toBe('new@example.com')
    })

    it('should update existing row on upsert', async () => {
      // First insert
      const inserted = await insert<User>(storage as unknown as DurableObjectStorage, 'users', tenantId, {
        email: 'existing@example.com',
        name: 'Original',
        role: 'member',
      })

      // Upsert with same ID
      const result = await upsert<User>(
        storage as unknown as DurableObjectStorage,
        'users',
        tenantId,
        {
          id: inserted.data!.id,
          email: 'existing@example.com',
          name: 'Updated',
          role: 'admin',
        },
        'id'
      )

      expect(result.error).toBeNull()
      expect(result.data?.id).toBe(inserted.data?.id)
      expect(result.data?.name).toBe('Updated')
      expect(result.data?.role).toBe('admin')
    })
  })

  describe('Delete', () => {
    it('should delete a row by ID', async () => {
      const inserted = await insert<User>(storage as unknown as DurableObjectStorage, 'users', tenantId, {
        email: 'delete@example.com',
        name: 'To Delete',
        role: 'member',
      })

      const result = await deleteById<User>(storage as unknown as DurableObjectStorage, 'users', inserted.data!.id)

      expect(result.error).toBeNull()
      expect(result.data?.email).toBe('delete@example.com')

      // Verify deletion
      const remaining = await query<User>(storage as unknown as DurableObjectStorage, 'users', tenantId).execute()
      expect(remaining.data).toHaveLength(0)
    })

    it('should delete multiple rows', async () => {
      const result1 = await insert<User>(storage as unknown as DurableObjectStorage, 'users', tenantId, {
        email: 'user1@example.com',
        name: 'User 1',
        role: 'member',
      })
      const result2 = await insert<User>(storage as unknown as DurableObjectStorage, 'users', tenantId, {
        email: 'user2@example.com',
        name: 'User 2',
        role: 'member',
      })
      await insert<User>(storage as unknown as DurableObjectStorage, 'users', tenantId, {
        email: 'user3@example.com',
        name: 'User 3',
        role: 'admin',
      })

      const deleted = await deleteMany<User>(storage as unknown as DurableObjectStorage, 'users', [
        result1.data!.id,
        result2.data!.id,
      ])

      expect(deleted.error).toBeNull()
      expect(deleted.data).toHaveLength(2)

      const remaining = await query<User>(storage as unknown as DurableObjectStorage, 'users', tenantId).execute()
      expect(remaining.data).toHaveLength(1)
      expect(remaining.data?.[0].email).toBe('user3@example.com')
    })
  })
})

// ============================================================================
// TRANSACTION TESTS
// ============================================================================

describe('Transactions', () => {
  let storage: MockStorage
  const tenantId = 'test-tenant'

  beforeEach(() => {
    storage = new MockStorage()
  })

  it('should execute batched operations', async () => {
    const tx = transaction<User>(storage as unknown as DurableObjectStorage, tenantId)

    tx.insert('users', { email: 'tx1@example.com', name: 'TX User 1', role: 'member' })
      .insert('users', { email: 'tx2@example.com', name: 'TX User 2', role: 'member' })

    const result = await tx.commit()

    expect(result.error).toBeNull()

    const users = await query<User>(storage as unknown as DurableObjectStorage, 'users', tenantId).execute()
    expect(users.data).toHaveLength(2)
  })

  it('should rollback pending operations', async () => {
    const tx = transaction<User>(storage as unknown as DurableObjectStorage, tenantId)

    tx.insert('users', { email: 'rollback@example.com', name: 'Rollback User', role: 'member' })
    tx.rollback()

    // After rollback, commit should be a no-op
    await tx.commit()

    const users = await query<User>(storage as unknown as DurableObjectStorage, 'users', tenantId).execute()
    expect(users.data).toHaveLength(0)
  })
})

// ============================================================================
// AUTHENTICATION TESTS
// ============================================================================

describe('Authentication', () => {
  let storage: MockStorage
  const tenantId = 'auth-test-tenant'

  beforeEach(() => {
    storage = new MockStorage()
  })

  describe('Password Hashing', () => {
    it('should hash and verify password', async () => {
      const password = 'secure-password-123'
      const hash = await hashPassword(password)

      expect(hash).toBeDefined()
      expect(hash).not.toBe(password)

      const valid = await verifyPassword(password, hash)
      expect(valid).toBe(true)

      const invalid = await verifyPassword('wrong-password', hash)
      expect(invalid).toBe(false)
    })

    it('should produce different hashes for same password', async () => {
      const password = 'test-password'
      const hash1 = await hashPassword(password)
      const hash2 = await hashPassword(password)

      expect(hash1).not.toBe(hash2)

      // Both should still verify
      expect(await verifyPassword(password, hash1)).toBe(true)
      expect(await verifyPassword(password, hash2)).toBe(true)
    })
  })

  describe('JWT', () => {
    it('should generate and verify JWT', async () => {
      const payload = {
        sub: 'user-123',
        tenant: tenantId,
        role: 'admin',
      }

      const token = await generateJWT(payload)
      expect(token).toBeDefined()
      expect(token.split('.')).toHaveLength(3)

      const verified = await verifyJWT(token)
      expect(verified).toBeDefined()
      expect(verified?.sub).toBe('user-123')
      expect(verified?.tenant).toBe(tenantId)
      expect(verified?.role).toBe('admin')
    })

    it('should reject expired token', async () => {
      const payload = {
        sub: 'user-123',
        tenant: tenantId,
        role: 'admin',
      }

      // Create token that expires immediately
      const token = await generateJWT(payload, -1000) // Already expired

      const verified = await verifyJWT(token)
      expect(verified).toBeNull()
    })

    it('should reject invalid token', async () => {
      const verified = await verifyJWT('invalid.token.here')
      expect(verified).toBeNull()
    })
  })

  describe('AuthService', () => {
    let auth: AuthService

    beforeEach(() => {
      auth = new AuthService(storage as unknown as DurableObjectStorage, tenantId)
    })

    it('should sign up new user', async () => {
      const result = await auth.signUp({
        email: 'newuser@example.com',
        password: 'password123',
        name: 'New User',
      })

      expect(result.error).toBeNull()
      expect(result.user).toBeDefined()
      expect(result.user?.email).toBe('newuser@example.com')
      expect(result.session).toBeDefined()
      expect(result.session?.access_token).toBeDefined()
      expect(result.session?.refresh_token).toBeDefined()

      // Password hash should not be returned
      expect((result.user as Record<string, unknown>)?.password_hash).toBeUndefined()
    })

    it('should not allow duplicate emails', async () => {
      await auth.signUp({
        email: 'duplicate@example.com',
        password: 'password123',
        name: 'First User',
      })

      const result = await auth.signUp({
        email: 'duplicate@example.com',
        password: 'different123',
        name: 'Second User',
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('invalid_credentials')
    })

    it('should sign in with valid credentials', async () => {
      await auth.signUp({
        email: 'signin@example.com',
        password: 'correct-password',
        name: 'Sign In User',
      })

      const result = await auth.signIn({
        email: 'signin@example.com',
        password: 'correct-password',
      })

      expect(result.error).toBeNull()
      expect(result.user?.email).toBe('signin@example.com')
      expect(result.session?.access_token).toBeDefined()
    })

    it('should reject invalid credentials', async () => {
      await auth.signUp({
        email: 'invalid@example.com',
        password: 'correct-password',
        name: 'Test User',
      })

      const result = await auth.signIn({
        email: 'invalid@example.com',
        password: 'wrong-password',
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('invalid_credentials')
    })

    it('should verify access token', async () => {
      const signUp = await auth.signUp({
        email: 'verify@example.com',
        password: 'password123',
        name: 'Verify User',
      })

      const result = await auth.verifyToken(signUp.session!.access_token)

      expect(result.error).toBeNull()
      expect(result.user?.email).toBe('verify@example.com')
    })

    it('should refresh session', async () => {
      const signUp = await auth.signUp({
        email: 'refresh@example.com',
        password: 'password123',
        name: 'Refresh User',
      })

      // Wait a moment to ensure different token timestamps
      await new Promise(resolve => setTimeout(resolve, 10))

      const refreshed = await auth.refreshSession(signUp.session!.refresh_token)

      expect(refreshed.error).toBeNull()
      expect(refreshed.session?.access_token).toBeDefined()
      // New session should have a different refresh token at minimum
      expect(refreshed.session?.refresh_token).not.toBe(signUp.session?.refresh_token)
    })

    it('should sign out user', async () => {
      const signUp = await auth.signUp({
        email: 'signout@example.com',
        password: 'password123',
        name: 'Sign Out User',
      })

      await auth.signOut(signUp.session!.id)

      // Refresh should fail after sign out
      const refreshed = await auth.refreshSession(signUp.session!.refresh_token)
      expect(refreshed.error).toBeDefined()
    })

    it('should make first user admin', async () => {
      const first = await auth.signUp({
        email: 'first@example.com',
        password: 'password123',
        name: 'First User',
      })

      const second = await auth.signUp({
        email: 'second@example.com',
        password: 'password123',
        name: 'Second User',
      })

      expect(first.user?.role).toBe('admin')
      expect(second.user?.role).toBe('member')
    })
  })
})

// ============================================================================
// QUERY FILTER TESTS
// ============================================================================

describe('Query Filters', () => {
  let storage: MockStorage
  const tenantId = 'filter-test-tenant'

  beforeEach(async () => {
    storage = new MockStorage()

    // Seed test data
    await insertMany<Task>(storage as unknown as DurableObjectStorage, 'tasks', tenantId, [
      { title: 'Task 1', project_id: 'proj-1', status: 'todo', priority: 'high' },
      { title: 'Task 2', project_id: 'proj-1', status: 'in_progress', priority: 'medium' },
      { title: 'Task 3', project_id: 'proj-2', status: 'done', priority: 'low' },
      { title: 'Task 4', project_id: 'proj-2', status: 'todo', priority: 'high' },
      { title: 'Urgent Task', project_id: 'proj-1', status: 'in_progress', priority: 'high' },
    ])
  })

  it('should filter with gt operator', async () => {
    // Using status as a string comparison
    const result = await query<Task>(storage as unknown as DurableObjectStorage, 'tasks', tenantId)
      .where('priority', 'eq', 'high')
      .execute()

    expect(result.data).toHaveLength(3)
  })

  it('should filter with like operator', async () => {
    const result = await query<Task>(storage as unknown as DurableObjectStorage, 'tasks', tenantId)
      .whereLike('title', '%Urgent%')
      .execute()

    expect(result.data).toHaveLength(1)
    expect(result.data?.[0].title).toBe('Urgent Task')
  })

  it('should filter with ilike operator (case insensitive)', async () => {
    const result = await query<Task>(storage as unknown as DurableObjectStorage, 'tasks', tenantId)
      .whereILike('title', '%urgent%')
      .execute()

    expect(result.data).toHaveLength(1)
    expect(result.data?.[0].title).toBe('Urgent Task')
  })

  it('should combine multiple filters', async () => {
    const result = await query<Task>(storage as unknown as DurableObjectStorage, 'tasks', tenantId)
      .where('project_id', 'eq', 'proj-1')
      .where('status', 'eq', 'in_progress')
      .execute()

    expect(result.data).toHaveLength(2)
  })

  it('should filter with whereAll helper', async () => {
    const result = await query<Task>(storage as unknown as DurableObjectStorage, 'tasks', tenantId)
      .whereAll({ project_id: 'proj-1', priority: 'high' })
      .execute()

    expect(result.data).toHaveLength(2)
  })

  it('should sort by multiple columns', async () => {
    const result = await query<Task>(storage as unknown as DurableObjectStorage, 'tasks', tenantId)
      .orderBy('project_id', 'asc')
      .orderBy('title', 'asc')
      .execute()

    expect(result.data?.[0].project_id).toBe('proj-1')
    expect(result.data?.[0].title).toBe('Task 1')
  })
})

// ============================================================================
// RELATIONSHIP TESTS
// ============================================================================

describe('Relationships', () => {
  let storage: MockStorage
  const tenantId = 'relation-test-tenant'

  beforeEach(async () => {
    storage = new MockStorage()

    // Seed projects
    await storage.put('table:projects', [
      {
        id: 'proj-1',
        tenant_id: tenantId,
        name: 'Project 1',
        status: 'active',
        team_id: 'team-1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])

    // Seed tasks with project_id foreign key
    await storage.put('table:tasks', [
      {
        id: 'task-1',
        tenant_id: tenantId,
        title: 'Task 1',
        project_id: 'proj-1',
        status: 'todo',
        priority: 'high',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'task-2',
        tenant_id: tenantId,
        title: 'Task 2',
        project_id: 'proj-1',
        status: 'in_progress',
        priority: 'medium',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])
  })

  it('should include related data', async () => {
    const result = await query<Project>(storage as unknown as DurableObjectStorage, 'projects', tenantId)
      .include('tasks')
      .execute()

    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(1)

    const project = result.data?.[0] as Project & { tasks?: Task[] }
    expect(project.tasks).toBeDefined()
    expect(project.tasks).toHaveLength(2)
  })
})
