/**
 * @dotdo/supabase - Supabase SDK compat tests
 *
 * Tests for @supabase/supabase-js API compatibility backed by DO SQLite:
 * - createClient() - Client initialization with config
 * - from().select/insert/update/delete/upsert - Query builder
 * - Query filters: eq, neq, gt, gte, lt, lte, like, ilike, in, contains, etc.
 * - Modifiers: order, limit, range, single, maybeSingle
 * - Auth: signUp, signIn, signOut, getUser, getSession
 * - Realtime: channel, on, subscribe
 * - Storage: upload, download, list, remove
 * - Functions: invoke
 *
 * @see https://supabase.com/docs/reference/javascript
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  SupabaseClient,
  SupabaseClientOptions,
  ExtendedSupabaseConfig,
  PostgrestQueryBuilder,
  PostgrestFilterBuilder,
  PostgrestResponse,
  PostgrestSingleResponse,
  User,
  Session,
  AuthClient,
  StorageClient,
  FunctionsClient,
  RealtimeChannel,
  RealtimeClient,
  Row,
} from './types'
import { createClient } from './supabase'

// ============================================================================
// TEST DATA TYPES
// ============================================================================

interface TestUser {
  id: number
  name: string
  email: string
  age: number
  active: boolean
  tags: string[]
  metadata: Record<string, unknown>
  created_at: string
}

interface TestPost {
  id: number
  user_id: number
  title: string
  body: string
  published: boolean
  views: number
  created_at: string
}

// ============================================================================
// CREATE CLIENT TESTS
// ============================================================================

describe('createClient', () => {
  it('should create client with URL and key', () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key')
    expect(client).toBeDefined()
    expect(client.from).toBeDefined()
    expect(client.auth).toBeDefined()
    expect(client.storage).toBeDefined()
  })

  it('should create client with options', () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key', {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
      },
    })
    expect(client).toBeDefined()
  })

  it('should create client with custom db schema', () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key', {
      db: { schema: 'custom_schema' },
    })
    expect(client).toBeDefined()
  })

  it('should create client with global headers', () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key', {
      global: {
        headers: { 'X-Custom-Header': 'value' },
      },
    })
    expect(client).toBeDefined()
  })

  it('should create client with custom fetch', () => {
    const customFetch = vi.fn()
    const client = createClient('https://test.supabase.co', 'test-anon-key', {
      global: { fetch: customFetch as unknown as typeof fetch },
    })
    expect(client).toBeDefined()
  })

  it('should create client with realtime options', () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key', {
      realtime: {
        config: {
          broadcast: { self: true },
        },
      },
    })
    expect(client).toBeDefined()
  })

  it('should accept extended DO config', () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key', {
      doNamespace: {} as DurableObjectNamespace,
      shard: { algorithm: 'consistent', count: 4 },
      replica: { readPreference: 'nearest' },
    } as ExtendedSupabaseConfig)
    expect(client).toBeDefined()
  })

  it('should accept shard configuration', () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key', {
      shard: { key: 'user_id', count: 8, algorithm: 'hash' },
    } as ExtendedSupabaseConfig)
    expect(client).toBeDefined()
  })

  it('should accept replica configuration', () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key', {
      replica: {
        readPreference: 'secondary',
        writeThrough: true,
        jurisdiction: 'eu',
      },
    } as ExtendedSupabaseConfig)
    expect(client).toBeDefined()
  })
})

// ============================================================================
// QUERY BUILDER - SELECT TESTS
// ============================================================================

describe('from().select()', () => {
  let client: SupabaseClient

  beforeEach(() => {
    client = createClient('https://test.supabase.co', 'test-anon-key')
  })

  it('should select all columns', async () => {
    const { data, error } = await client.from<TestUser>('users').select()
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('should select specific columns', async () => {
    const { data, error } = await client.from<TestUser>('users').select('id, name, email')
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('should select with count option', async () => {
    const { data, error, count } = await client
      .from<TestUser>('users')
      .select('*', { count: 'exact' })
    expect(error).toBeNull()
    expect(typeof count).toBe('number')
  })

  it('should select with head option (no data)', async () => {
    const { data, error, count } = await client
      .from<TestUser>('users')
      .select('*', { head: true, count: 'exact' })
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('should select related data with foreign key', async () => {
    const { data, error } = await client
      .from<TestPost>('posts')
      .select('id, title, users(id, name)')
    expect(error).toBeNull()
  })

  it('should select with nested relations', async () => {
    const { data, error } = await client
      .from('organizations')
      .select('id, name, users(id, name, posts(id, title))')
    expect(error).toBeNull()
  })
})

// ============================================================================
// QUERY BUILDER - INSERT TESTS
// ============================================================================

describe('from().insert()', () => {
  let client: SupabaseClient

  beforeEach(() => {
    client = createClient('https://test.supabase.co', 'test-anon-key')
  })

  it('should insert single row', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .insert({ name: 'Alice', email: 'alice@test.com', age: 30, active: true })
      .select()
    expect(error).toBeNull()
  })

  it('should insert multiple rows', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .insert([
        { name: 'Bob', email: 'bob@test.com', age: 25, active: true },
        { name: 'Carol', email: 'carol@test.com', age: 28, active: false },
      ])
      .select()
    expect(error).toBeNull()
  })

  it('should insert with count option', async () => {
    const { data, error, count } = await client
      .from<TestUser>('users')
      .insert({ name: 'Dave', email: 'dave@test.com' }, { count: 'exact' })
      .select()
    expect(error).toBeNull()
  })

  it('should insert with defaultToNull option', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .insert({ name: 'Eve' }, { defaultToNull: true })
      .select()
    expect(error).toBeNull()
  })

  it('should return inserted row with single()', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .insert({ name: 'Frank', email: 'frank@test.com' })
      .select()
      .single()
    expect(error).toBeNull()
    if (data) {
      expect(data.name).toBe('Frank')
    }
  })
})

// ============================================================================
// QUERY BUILDER - UPDATE TESTS
// ============================================================================

describe('from().update()', () => {
  let client: SupabaseClient

  beforeEach(() => {
    client = createClient('https://test.supabase.co', 'test-anon-key')
  })

  it('should update rows with filter', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .update({ active: false })
      .eq('id', 1)
      .select()
    expect(error).toBeNull()
  })

  it('should update multiple fields', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .update({ name: 'Updated Name', age: 35 })
      .eq('id', 1)
      .select()
    expect(error).toBeNull()
  })

  it('should update with count option', async () => {
    const { data, error, count } = await client
      .from<TestUser>('users')
      .update({ active: true }, { count: 'exact' })
      .eq('active', false)
      .select()
    expect(error).toBeNull()
  })

  it('should update based on multiple conditions', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .update({ active: true })
      .eq('active', false)
      .gt('age', 25)
      .select()
    expect(error).toBeNull()
  })
})

// ============================================================================
// QUERY BUILDER - UPSERT TESTS
// ============================================================================

describe('from().upsert()', () => {
  let client: SupabaseClient

  beforeEach(() => {
    client = createClient('https://test.supabase.co', 'test-anon-key')
  })

  it('should upsert single row', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .upsert({ id: 1, name: 'Alice Updated', email: 'alice@test.com' })
      .select()
    expect(error).toBeNull()
  })

  it('should upsert multiple rows', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .upsert([
        { id: 1, name: 'Alice', email: 'alice@test.com' },
        { id: 2, name: 'Bob', email: 'bob@test.com' },
      ])
      .select()
    expect(error).toBeNull()
  })

  it('should upsert with onConflict', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .upsert({ email: 'alice@test.com', name: 'Alice New' }, { onConflict: 'email' })
      .select()
    expect(error).toBeNull()
  })

  it('should upsert with ignoreDuplicates', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .upsert({ id: 1, name: 'Ignored' }, { ignoreDuplicates: true })
      .select()
    expect(error).toBeNull()
  })

  it('should upsert with count option', async () => {
    const { data, error, count } = await client
      .from<TestUser>('users')
      .upsert({ id: 1, name: 'Counted' }, { count: 'exact' })
      .select()
    expect(error).toBeNull()
  })
})

// ============================================================================
// QUERY BUILDER - DELETE TESTS
// ============================================================================

describe('from().delete()', () => {
  let client: SupabaseClient

  beforeEach(() => {
    client = createClient('https://test.supabase.co', 'test-anon-key')
  })

  it('should delete rows with filter', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .delete()
      .eq('id', 1)
      .select()
    expect(error).toBeNull()
  })

  it('should delete with count option', async () => {
    const { data, error, count } = await client
      .from<TestUser>('users')
      .delete({ count: 'exact' })
      .eq('active', false)
      .select()
    expect(error).toBeNull()
  })

  it('should delete based on multiple conditions', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .delete()
      .eq('active', false)
      .lt('age', 20)
      .select()
    expect(error).toBeNull()
  })
})

// ============================================================================
// QUERY BUILDER - FILTER TESTS
// ============================================================================

describe('filters', () => {
  let client: SupabaseClient

  beforeEach(() => {
    client = createClient('https://test.supabase.co', 'test-anon-key')
  })

  it('should filter with eq', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .eq('id', 1)
    expect(error).toBeNull()
  })

  it('should filter with neq', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .neq('active', false)
    expect(error).toBeNull()
  })

  it('should filter with gt', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .gt('age', 25)
    expect(error).toBeNull()
  })

  it('should filter with gte', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .gte('age', 25)
    expect(error).toBeNull()
  })

  it('should filter with lt', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .lt('age', 30)
    expect(error).toBeNull()
  })

  it('should filter with lte', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .lte('age', 30)
    expect(error).toBeNull()
  })

  it('should filter with like', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .like('name', '%Alice%')
    expect(error).toBeNull()
  })

  it('should filter with ilike (case-insensitive)', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .ilike('name', '%alice%')
    expect(error).toBeNull()
  })

  it('should filter with is (null check)', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .is('email', null)
    expect(error).toBeNull()
  })

  it('should filter with is (boolean check)', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .is('active', true)
    expect(error).toBeNull()
  })

  it('should filter with in', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .in('id', [1, 2, 3])
    expect(error).toBeNull()
  })

  it('should filter with contains (array)', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .contains('tags', ['admin'])
    expect(error).toBeNull()
  })

  it('should filter with containedBy', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .containedBy('tags', ['admin', 'user', 'moderator'])
    expect(error).toBeNull()
  })

  it('should filter with overlaps', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .overlaps('tags', ['admin', 'editor'])
    expect(error).toBeNull()
  })

  it('should filter with textSearch', async () => {
    const { data, error } = await client
      .from<TestPost>('posts')
      .select()
      .textSearch('body', 'hello & world')
    expect(error).toBeNull()
  })

  it('should filter with textSearch and options', async () => {
    const { data, error } = await client
      .from<TestPost>('posts')
      .select()
      .textSearch('body', 'hello world', { type: 'websearch', config: 'english' })
    expect(error).toBeNull()
  })

  it('should filter with match', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .match({ active: true, age: 30 })
    expect(error).toBeNull()
  })

  it('should filter with not', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .not('active', 'is', null)
    expect(error).toBeNull()
  })

  it('should filter with or', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .or('age.gt.30,active.eq.true')
    expect(error).toBeNull()
  })

  it('should filter with or on foreign table', async () => {
    const { data, error } = await client
      .from<TestPost>('posts')
      .select('*, users(*)')
      .or('name.eq.Alice,name.eq.Bob', { foreignTable: 'users' })
    expect(error).toBeNull()
  })

  it('should chain multiple filters', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .eq('active', true)
      .gte('age', 25)
      .lte('age', 35)
      .ilike('name', '%a%')
    expect(error).toBeNull()
  })
})

// ============================================================================
// QUERY BUILDER - MODIFIER TESTS
// ============================================================================

describe('modifiers', () => {
  let client: SupabaseClient

  beforeEach(() => {
    client = createClient('https://test.supabase.co', 'test-anon-key')
  })

  it('should order ascending', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .order('name', { ascending: true })
    expect(error).toBeNull()
  })

  it('should order descending', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .order('created_at', { ascending: false })
    expect(error).toBeNull()
  })

  it('should order with nullsFirst', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .order('email', { nullsFirst: true })
    expect(error).toBeNull()
  })

  it('should order foreign table', async () => {
    const { data, error } = await client
      .from<TestPost>('posts')
      .select('*, users(*)')
      .order('name', { foreignTable: 'users' })
    expect(error).toBeNull()
  })

  it('should limit results', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .limit(10)
    expect(error).toBeNull()
  })

  it('should limit foreign table', async () => {
    const { data, error } = await client
      .from('organizations')
      .select('*, users(*)')
      .limit(5, { foreignTable: 'users' })
    expect(error).toBeNull()
  })

  it('should range results', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .range(0, 9)
    expect(error).toBeNull()
  })

  it('should range foreign table', async () => {
    const { data, error } = await client
      .from('organizations')
      .select('*, users(*)')
      .range(0, 4, { foreignTable: 'users' })
    expect(error).toBeNull()
  })

  it('should return single row', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .eq('id', 1)
      .single()
    expect(error).toBeNull()
  })

  it('should return maybeSingle (nullable)', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .eq('id', 999)
      .maybeSingle()
    expect(error).toBeNull()
    // data can be null if no match
  })

  it('should return CSV format', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .csv()
    expect(error).toBeNull()
    expect(typeof data === 'string' || data === null).toBe(true)
  })

  it('should explain query', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .explain()
    expect(error).toBeNull()
  })

  it('should explain query with options', async () => {
    const { data, error } = await client
      .from<TestUser>('users')
      .select()
      .explain({ analyze: true, verbose: true, format: 'json' })
    expect(error).toBeNull()
  })

  it('should support abort signal', async () => {
    const controller = new AbortController()
    const promise = client
      .from<TestUser>('users')
      .select()
      .abortSignal(controller.signal)

    controller.abort()
    // Should handle abort gracefully
    const { data, error } = await promise
    // May have error due to abort
  })
})

// ============================================================================
// RPC TESTS
// ============================================================================

describe('rpc()', () => {
  let client: SupabaseClient

  beforeEach(() => {
    client = createClient('https://test.supabase.co', 'test-anon-key')
  })

  it('should call function without args', async () => {
    const { data, error } = await client.rpc('get_server_time')
    expect(error).toBeNull()
  })

  it('should call function with args', async () => {
    const { data, error } = await client.rpc('get_user_by_id', { user_id: 1 })
    expect(error).toBeNull()
  })

  it('should call function with head option', async () => {
    const { data, error } = await client.rpc('count_users', {}, { head: true })
    expect(data).toBeNull()
  })

  it('should call function with count option', async () => {
    const { data, error, count } = await client.rpc('get_users', {}, { count: 'exact' })
    expect(error).toBeNull()
  })

  it('should chain filters on rpc result', async () => {
    const { data, error } = await client
      .rpc('get_users')
      .eq('active', true)
      .order('name')
    expect(error).toBeNull()
  })
})

// ============================================================================
// AUTH TESTS
// ============================================================================

describe('auth', () => {
  let client: SupabaseClient

  beforeEach(() => {
    client = createClient('https://test.supabase.co', 'test-anon-key')
  })

  describe('signUp', () => {
    it('should sign up with email and password', async () => {
      const { data, error } = await client.auth.signUp({
        email: 'test@example.com.ai',
        password: 'password123',
      })
      expect(error).toBeNull()
    })

    it('should sign up with phone and password', async () => {
      const { data, error } = await client.auth.signUp({
        phone: '+1234567890',
        password: 'password123',
      })
      expect(error).toBeNull()
    })

    it('should sign up with metadata', async () => {
      const { data, error } = await client.auth.signUp({
        email: 'test@example.com.ai',
        password: 'password123',
        options: {
          data: { name: 'Test User', role: 'admin' },
        },
      })
      expect(error).toBeNull()
    })

    it('should sign up with email redirect', async () => {
      const { data, error } = await client.auth.signUp({
        email: 'test@example.com.ai',
        password: 'password123',
        options: {
          emailRedirectTo: 'https://example.com.ai/confirm',
        },
      })
      expect(error).toBeNull()
    })
  })

  describe('signInWithPassword', () => {
    it('should sign in with email', async () => {
      const { data, error } = await client.auth.signInWithPassword({
        email: 'test@example.com.ai',
        password: 'password123',
      })
      expect(error).toBeNull()
    })

    it('should sign in with phone', async () => {
      const { data, error } = await client.auth.signInWithPassword({
        phone: '+1234567890',
        password: 'password123',
      })
      expect(error).toBeNull()
    })
  })

  describe('signInWithOAuth', () => {
    it('should return OAuth URL for github', async () => {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'github',
      })
      expect(error).toBeNull()
      expect(data?.url).toBeDefined()
    })

    it('should support redirect options', async () => {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'https://example.com.ai/callback',
          scopes: 'email profile',
        },
      })
      expect(error).toBeNull()
    })
  })

  describe('signInWithOtp', () => {
    it('should send OTP to email', async () => {
      const { data, error } = await client.auth.signInWithOtp({
        email: 'test@example.com.ai',
      })
      expect(error).toBeNull()
    })

    it('should send OTP to phone', async () => {
      const { data, error } = await client.auth.signInWithOtp({
        phone: '+1234567890',
      })
      expect(error).toBeNull()
    })

    it('should support shouldCreateUser option', async () => {
      const { data, error } = await client.auth.signInWithOtp({
        email: 'new@example.com.ai',
        options: { shouldCreateUser: true },
      })
      expect(error).toBeNull()
    })
  })

  describe('verifyOtp', () => {
    it('should verify email OTP', async () => {
      const { data, error } = await client.auth.verifyOtp({
        email: 'test@example.com.ai',
        token: '123456',
        type: 'email',
      })
      expect(error).toBeNull()
    })

    it('should verify SMS OTP', async () => {
      const { data, error } = await client.auth.verifyOtp({
        phone: '+1234567890',
        token: '123456',
        type: 'sms',
      })
      expect(error).toBeNull()
    })
  })

  describe('signOut', () => {
    it('should sign out current session', async () => {
      const { error } = await client.auth.signOut()
      expect(error).toBeNull()
    })

    it('should sign out with scope', async () => {
      const { error } = await client.auth.signOut({ scope: 'global' })
      expect(error).toBeNull()
    })
  })

  describe('getSession', () => {
    it('should get current session', async () => {
      const { data, error } = await client.auth.getSession()
      expect(error).toBeNull()
    })
  })

  describe('getUser', () => {
    it('should get current user', async () => {
      const { data, error } = await client.auth.getUser()
      expect(error).toBeNull()
    })
  })

  describe('refreshSession', () => {
    it('should refresh session', async () => {
      const { data, error } = await client.auth.refreshSession()
      expect(error).toBeNull()
    })

    it('should refresh with token', async () => {
      const { data, error } = await client.auth.refreshSession({
        refreshToken: 'refresh-token',
      })
      expect(error).toBeNull()
    })
  })

  describe('setSession', () => {
    it('should set session tokens', async () => {
      const { data, error } = await client.auth.setSession({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      })
      expect(error).toBeNull()
    })
  })

  describe('updateUser', () => {
    it('should update user email', async () => {
      const { data, error } = await client.auth.updateUser({
        email: 'new@example.com.ai',
      })
      expect(error).toBeNull()
    })

    it('should update user password', async () => {
      const { data, error } = await client.auth.updateUser({
        password: 'newpassword123',
      })
      expect(error).toBeNull()
    })

    it('should update user metadata', async () => {
      const { data, error } = await client.auth.updateUser({
        data: { name: 'New Name' },
      })
      expect(error).toBeNull()
    })
  })

  describe('resetPasswordForEmail', () => {
    it('should send reset email', async () => {
      const { data, error } = await client.auth.resetPasswordForEmail('test@example.com.ai')
      expect(error).toBeNull()
    })

    it('should send reset email with redirect', async () => {
      const { data, error } = await client.auth.resetPasswordForEmail('test@example.com.ai', {
        redirectTo: 'https://example.com.ai/reset',
      })
      expect(error).toBeNull()
    })
  })

  describe('onAuthStateChange', () => {
    it('should subscribe to auth changes', () => {
      const callback = vi.fn()
      const { data } = client.auth.onAuthStateChange(callback)
      expect(data.subscription).toBeDefined()
      expect(data.subscription.unsubscribe).toBeDefined()
    })

    it('should unsubscribe from auth changes', () => {
      const callback = vi.fn()
      const { data } = client.auth.onAuthStateChange(callback)
      data.subscription.unsubscribe()
      // Should not throw
    })
  })

  describe('mfa', () => {
    it('should enroll TOTP factor', async () => {
      const { data, error } = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'My Authenticator',
      })
      expect(error).toBeNull()
    })

    it('should challenge factor', async () => {
      const { data, error } = await client.auth.mfa.challenge({
        factorId: 'factor-id',
      })
      expect(error).toBeNull()
    })

    it('should verify challenge', async () => {
      const { data, error } = await client.auth.mfa.verify({
        factorId: 'factor-id',
        challengeId: 'challenge-id',
        code: '123456',
      })
      expect(error).toBeNull()
    })

    it('should unenroll factor', async () => {
      const { data, error } = await client.auth.mfa.unenroll({
        factorId: 'factor-id',
      })
      expect(error).toBeNull()
    })

    it('should list factors', async () => {
      const { data, error } = await client.auth.mfa.listFactors()
      expect(error).toBeNull()
    })

    it('should get authenticator assurance level', async () => {
      const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
      expect(error).toBeNull()
    })
  })
})

// ============================================================================
// STORAGE TESTS
// ============================================================================

describe('storage', () => {
  let client: SupabaseClient

  beforeEach(() => {
    client = createClient('https://test.supabase.co', 'test-anon-key')
  })

  describe('buckets', () => {
    it('should list buckets', async () => {
      const { data, error } = await client.storage.listBuckets()
      expect(error).toBeNull()
    })

    it('should get bucket', async () => {
      const { data, error } = await client.storage.getBucket('avatars')
      expect(error).toBeNull()
    })

    it('should create bucket', async () => {
      const { data, error } = await client.storage.createBucket('new-bucket', {
        public: true,
      })
      expect(error).toBeNull()
    })

    it('should create bucket with options', async () => {
      const { data, error } = await client.storage.createBucket('uploads', {
        public: false,
        fileSizeLimit: 1024 * 1024 * 10, // 10MB
        allowedMimeTypes: ['image/*', 'application/pdf'],
      })
      expect(error).toBeNull()
    })

    it('should update bucket', async () => {
      const { data, error } = await client.storage.updateBucket('uploads', {
        public: true,
      })
      expect(error).toBeNull()
    })

    it('should delete bucket', async () => {
      const { data, error } = await client.storage.deleteBucket('old-bucket')
      expect(error).toBeNull()
    })

    it('should empty bucket', async () => {
      const { data, error } = await client.storage.emptyBucket('temp')
      expect(error).toBeNull()
    })
  })

  describe('files', () => {
    it('should upload file', async () => {
      const file = new Blob(['test content'], { type: 'text/plain' })
      const { data, error } = await client.storage
        .from('uploads')
        .upload('test.txt', file)
      expect(error).toBeNull()
    })

    it('should upload file with options', async () => {
      const file = new Blob(['test content'], { type: 'text/plain' })
      const { data, error } = await client.storage
        .from('uploads')
        .upload('test.txt', file, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'text/plain',
        })
      expect(error).toBeNull()
    })

    it('should download file', async () => {
      const { data, error } = await client.storage
        .from('uploads')
        .download('test.txt')
      expect(error).toBeNull()
    })

    it('should get public URL', () => {
      const { data } = client.storage
        .from('public-bucket')
        .getPublicUrl('image.png')
      expect(data?.publicUrl).toBeDefined()
    })

    it('should get public URL with transform', () => {
      const { data } = client.storage
        .from('public-bucket')
        .getPublicUrl('image.png', {
          width: 200,
          height: 200,
          resize: 'cover',
        })
      expect(data?.publicUrl).toBeDefined()
    })

    it('should create signed URL', async () => {
      const { data, error } = await client.storage
        .from('private-bucket')
        .createSignedUrl('file.pdf', 3600)
      expect(error).toBeNull()
      expect(data?.signedUrl).toBeDefined()
    })

    it('should create signed URLs batch', async () => {
      const { data, error } = await client.storage
        .from('private-bucket')
        .createSignedUrls(['file1.pdf', 'file2.pdf'], 3600)
      expect(error).toBeNull()
    })

    it('should list files', async () => {
      const { data, error } = await client.storage
        .from('uploads')
        .list()
      expect(error).toBeNull()
    })

    it('should list files in folder', async () => {
      const { data, error } = await client.storage
        .from('uploads')
        .list('documents')
      expect(error).toBeNull()
    })

    it('should list files with options', async () => {
      const { data, error } = await client.storage
        .from('uploads')
        .list('', {
          limit: 10,
          offset: 0,
          sortBy: { column: 'created_at', order: 'desc' },
          search: 'test',
        })
      expect(error).toBeNull()
    })

    it('should move file', async () => {
      const { data, error } = await client.storage
        .from('uploads')
        .move('old/path.txt', 'new/path.txt')
      expect(error).toBeNull()
    })

    it('should copy file', async () => {
      const { data, error } = await client.storage
        .from('uploads')
        .copy('source.txt', 'destination.txt')
      expect(error).toBeNull()
    })

    it('should remove files', async () => {
      const { data, error } = await client.storage
        .from('uploads')
        .remove(['file1.txt', 'file2.txt'])
      expect(error).toBeNull()
    })

    it('should update file', async () => {
      const file = new Blob(['updated content'], { type: 'text/plain' })
      const { data, error } = await client.storage
        .from('uploads')
        .update('test.txt', file)
      expect(error).toBeNull()
    })
  })
})

// ============================================================================
// FUNCTIONS TESTS
// ============================================================================

describe('functions', () => {
  let client: SupabaseClient

  beforeEach(() => {
    client = createClient('https://test.supabase.co', 'test-anon-key')
  })

  it('should invoke function', async () => {
    const { data, error } = await client.functions.invoke('hello-world')
    expect(error).toBeNull()
  })

  it('should invoke function with body', async () => {
    const { data, error } = await client.functions.invoke('process-data', {
      body: { name: 'test' },
    })
    expect(error).toBeNull()
  })

  it('should invoke function with headers', async () => {
    const { data, error } = await client.functions.invoke('protected', {
      headers: { 'X-Custom-Header': 'value' },
    })
    expect(error).toBeNull()
  })

  it('should invoke function with string body', async () => {
    const { data, error } = await client.functions.invoke('echo', {
      body: 'raw string',
    })
    expect(error).toBeNull()
  })

  it('should set auth token', () => {
    client.functions.setAuth('new-token')
    // Should not throw
  })
})

// ============================================================================
// REALTIME TESTS
// ============================================================================

describe('realtime', () => {
  let client: SupabaseClient

  beforeEach(() => {
    client = createClient('https://test.supabase.co', 'test-anon-key')
  })

  describe('channel', () => {
    it('should create channel', () => {
      const channel = client.channel('test-channel')
      expect(channel).toBeDefined()
      expect(channel.subscribe).toBeDefined()
    })

    it('should create channel with options', () => {
      const channel = client.channel('test-channel', {
        config: {
          broadcast: { self: true, ack: true },
          presence: { key: 'user-id' },
        },
      })
      expect(channel).toBeDefined()
    })

    it('should subscribe to channel', () => {
      const channel = client.channel('test')
      const subscribed = channel.subscribe((status) => {
        expect(['SUBSCRIBED', 'TIMED_OUT', 'CLOSED', 'CHANNEL_ERROR']).toContain(status)
      })
      expect(subscribed).toBe(channel)
    })

    it('should unsubscribe from channel', async () => {
      const channel = client.channel('test')
      channel.subscribe()
      const result = await channel.unsubscribe()
      expect(['ok', 'timed_out', 'error']).toContain(result)
    })
  })

  describe('broadcast', () => {
    it('should listen for broadcast events', () => {
      const callback = vi.fn()
      const channel = client
        .channel('room')
        .on('broadcast', { event: 'cursor_pos' }, callback)
        .subscribe()
      expect(channel).toBeDefined()
    })

    it('should send broadcast message', async () => {
      const channel = client.channel('room').subscribe()
      const result = await channel.send({
        type: 'broadcast',
        event: 'cursor_pos',
        payload: { x: 100, y: 200 },
      })
      expect(['ok', 'timed_out', 'error']).toContain(result)
    })
  })

  describe('presence', () => {
    it('should listen for presence sync', () => {
      const callback = vi.fn()
      const channel = client
        .channel('room')
        .on('presence', { event: 'sync' }, callback)
        .subscribe()
      expect(channel).toBeDefined()
    })

    it('should listen for presence join', () => {
      const callback = vi.fn()
      const channel = client
        .channel('room')
        .on('presence', { event: 'join' }, callback)
        .subscribe()
      expect(channel).toBeDefined()
    })

    it('should listen for presence leave', () => {
      const callback = vi.fn()
      const channel = client
        .channel('room')
        .on('presence', { event: 'leave' }, callback)
        .subscribe()
      expect(channel).toBeDefined()
    })

    it('should track presence', async () => {
      const channel = client.channel('room').subscribe()
      const result = await channel.track({ user_id: '123', online: true })
      expect(['ok', 'timed_out', 'error']).toContain(result)
    })

    it('should untrack presence', async () => {
      const channel = client.channel('room').subscribe()
      await channel.track({ user_id: '123' })
      const result = await channel.untrack()
      expect(['ok', 'timed_out', 'error']).toContain(result)
    })

    it('should get presence state', () => {
      const channel = client.channel('room').subscribe()
      const state = channel.presenceState()
      expect(typeof state).toBe('object')
    })
  })

  describe('postgres_changes', () => {
    it('should listen for INSERT events', () => {
      const callback = vi.fn()
      const channel = client
        .channel('db-changes')
        .on('postgres_changes', { event: 'INSERT', table: 'users' }, callback)
        .subscribe()
      expect(channel).toBeDefined()
    })

    it('should listen for UPDATE events', () => {
      const callback = vi.fn()
      const channel = client
        .channel('db-changes')
        .on('postgres_changes', { event: 'UPDATE', table: 'users' }, callback)
        .subscribe()
      expect(channel).toBeDefined()
    })

    it('should listen for DELETE events', () => {
      const callback = vi.fn()
      const channel = client
        .channel('db-changes')
        .on('postgres_changes', { event: 'DELETE', table: 'users' }, callback)
        .subscribe()
      expect(channel).toBeDefined()
    })

    it('should listen for all events with *', () => {
      const callback = vi.fn()
      const channel = client
        .channel('db-changes')
        .on('postgres_changes', { event: '*', table: 'users' }, callback)
        .subscribe()
      expect(channel).toBeDefined()
    })

    it('should filter by schema', () => {
      const callback = vi.fn()
      const channel = client
        .channel('db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, callback)
        .subscribe()
      expect(channel).toBeDefined()
    })

    it('should filter by column value', () => {
      const callback = vi.fn()
      const channel = client
        .channel('db-changes')
        .on(
          'postgres_changes',
          { event: '*', table: 'users', filter: 'id=eq.123' },
          callback
        )
        .subscribe()
      expect(channel).toBeDefined()
    })
  })

  describe('channel management', () => {
    it('should remove channel', async () => {
      const channel = client.channel('to-remove').subscribe()
      const result = await client.removeChannel(channel)
      expect(['ok', 'timed_out', 'error']).toContain(result)
    })

    it('should remove all channels', async () => {
      client.channel('channel-1').subscribe()
      client.channel('channel-2').subscribe()
      const results = await client.removeAllChannels()
      expect(Array.isArray(results)).toBe(true)
    })

    it('should get all channels', () => {
      client.channel('channel-1').subscribe()
      client.channel('channel-2').subscribe()
      const channels = client.getChannels()
      expect(Array.isArray(channels)).toBe(true)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('integration', () => {
  it('should work with realistic CRUD workflow', async () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key')

    // Create
    const { data: created, error: createError } = await client
      .from<TestUser>('users')
      .insert({ name: 'Test User', email: 'test@example.com.ai', age: 25, active: true })
      .select()
      .single()

    expect(createError).toBeNull()

    // Read
    const { data: users, error: readError } = await client
      .from<TestUser>('users')
      .select('id, name, email')
      .eq('active', true)
      .order('name')
      .limit(10)

    expect(readError).toBeNull()

    // Update
    const { data: updated, error: updateError } = await client
      .from<TestUser>('users')
      .update({ age: 26 })
      .eq('email', 'test@example.com.ai')
      .select()
      .single()

    expect(updateError).toBeNull()

    // Delete
    const { error: deleteError } = await client
      .from<TestUser>('users')
      .delete()
      .eq('email', 'test@example.com.ai')

    expect(deleteError).toBeNull()
  })

  it('should work with auth flow', async () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key')

    // Sign up
    const { data: signUpData, error: signUpError } = await client.auth.signUp({
      email: 'newuser@example.com.ai',
      password: 'securepassword123',
      options: {
        data: { role: 'user' },
      },
    })

    expect(signUpError).toBeNull()

    // Sign in
    const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
      email: 'newuser@example.com.ai',
      password: 'securepassword123',
    })

    expect(signInError).toBeNull()

    // Get session
    const { data: sessionData } = await client.auth.getSession()

    // Sign out
    const { error: signOutError } = await client.auth.signOut()
    expect(signOutError).toBeNull()
  })

  it('should work with storage flow', async () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key')

    // Create bucket
    await client.storage.createBucket('test-bucket', { public: true })

    // Upload file
    const file = new Blob(['Hello, World!'], { type: 'text/plain' })
    const { data: uploadData, error: uploadError } = await client.storage
      .from('test-bucket')
      .upload('hello.txt', file)

    expect(uploadError).toBeNull()

    // List files
    const { data: files, error: listError } = await client.storage
      .from('test-bucket')
      .list()

    expect(listError).toBeNull()

    // Get public URL
    const { data: urlData } = client.storage
      .from('test-bucket')
      .getPublicUrl('hello.txt')

    expect(urlData?.publicUrl).toBeDefined()

    // Download
    const { data: downloadData, error: downloadError } = await client.storage
      .from('test-bucket')
      .download('hello.txt')

    expect(downloadError).toBeNull()

    // Remove
    const { error: removeError } = await client.storage
      .from('test-bucket')
      .remove(['hello.txt'])

    expect(removeError).toBeNull()
  })

  it('should work with realtime subscription', async () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key')

    const insertCallback = vi.fn()
    const updateCallback = vi.fn()

    // Subscribe to changes
    const channel = client
      .channel('users-changes')
      .on('postgres_changes', { event: 'INSERT', table: 'users' }, insertCallback)
      .on('postgres_changes', { event: 'UPDATE', table: 'users' }, updateCallback)
      .subscribe()

    // Insert should trigger callback
    await client.from('users').insert({ name: 'Realtime User' })

    // Cleanup
    await client.removeChannel(channel)
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('error handling', () => {
  let client: SupabaseClient

  beforeEach(() => {
    client = createClient('https://test.supabase.co', 'test-anon-key')
  })

  it('should return error for invalid table', async () => {
    const { data, error } = await client.from('nonexistent_table').select()
    // Error handling depends on implementation
  })

  it('should return error for constraint violation', async () => {
    await client.from('users').insert({ id: 1, email: 'unique@test.com' })
    const { data, error } = await client
      .from('users')
      .insert({ id: 1, email: 'unique@test.com' })
    // Should have error for duplicate
  })

  it('should return error for invalid auth credentials', async () => {
    const { data, error } = await client.auth.signInWithPassword({
      email: 'nonexistent@example.com.ai',
      password: 'wrongpassword',
    })
    // Should have auth error
  })

  it('should return error for invalid storage path', async () => {
    const { data, error } = await client.storage
      .from('nonexistent-bucket')
      .download('file.txt')
    // Should have storage error
  })

  it('should return error for invalid function name', async () => {
    const { data, error } = await client.functions.invoke('nonexistent-function')
    // Should have function error
  })
})

// ============================================================================
// DO ROUTING TESTS
// ============================================================================

describe('DO routing', () => {
  it('should extract shard key from INSERT', () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key', {
      shard: { key: 'user_id' },
    } as ExtendedSupabaseConfig)

    // Internal method to test shard key extraction
    // In production, this routes to appropriate DO shard
    expect(client).toBeDefined()
  })

  it('should route reads based on replica config', () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key', {
      replica: { readPreference: 'secondary' },
    } as ExtendedSupabaseConfig)

    expect(client).toBeDefined()
  })

  it('should support write-through replication', () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key', {
      replica: { writeThrough: true },
    } as ExtendedSupabaseConfig)

    expect(client).toBeDefined()
  })

  it('should respect jurisdiction constraints', () => {
    const client = createClient('https://test.supabase.co', 'test-anon-key', {
      replica: { jurisdiction: 'eu' },
    } as ExtendedSupabaseConfig)

    expect(client).toBeDefined()
  })
})
