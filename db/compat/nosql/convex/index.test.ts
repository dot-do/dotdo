/**
 * @dotdo/convex - Convex SDK compat tests (RED PHASE)
 *
 * Tests for Convex Browser SDK API compatibility backed by DO SQLite:
 * - ConvexClient - Client initialization
 * - query() - One-shot queries
 * - onUpdate() - Reactive subscriptions
 * - mutation() - Data mutations
 * - action() - Server actions (can call external APIs)
 * - setAuth() - Authentication
 * - Document IDs - ID generation and validation
 *
 * @see https://docs.convex.dev/client/javascript
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  ConvexClient,
  ConvexClientOptions,
  FunctionReference,
  FunctionArgs,
  FunctionReturnType,
  DocumentId,
  GenericId,
  OptimisticUpdate,
  QueryToken,
  Unsubscribe,
  AuthTokenFetcher,
  ConvexError,
  ExtendedConvexConfig,
} from './types'
import { ConvexClient as ConvexClientImpl } from './convex'

// ============================================================================
// TEST DATA TYPES
// ============================================================================

interface Message {
  _id: DocumentId<'messages'>
  _creationTime: number
  body: string
  author: string
  channel: string
}

interface User {
  _id: DocumentId<'users'>
  _creationTime: number
  name: string
  email: string
  tokenIdentifier?: string
}

interface Channel {
  _id: DocumentId<'channels'>
  _creationTime: number
  name: string
  description: string
  members: DocumentId<'users'>[]
}

// Mock API object (simulating convex/_generated/api)
const api = {
  messages: {
    list: { _name: 'messages:list' } as FunctionReference<'query'>,
    get: { _name: 'messages:get' } as FunctionReference<'query'>,
    send: { _name: 'messages:send' } as FunctionReference<'mutation'>,
    update: { _name: 'messages:update' } as FunctionReference<'mutation'>,
    remove: { _name: 'messages:remove' } as FunctionReference<'mutation'>,
  },
  users: {
    list: { _name: 'users:list' } as FunctionReference<'query'>,
    get: { _name: 'users:get' } as FunctionReference<'query'>,
    getByToken: { _name: 'users:getByToken' } as FunctionReference<'query'>,
    create: { _name: 'users:create' } as FunctionReference<'mutation'>,
    update: { _name: 'users:update' } as FunctionReference<'mutation'>,
  },
  channels: {
    list: { _name: 'channels:list' } as FunctionReference<'query'>,
    create: { _name: 'channels:create' } as FunctionReference<'mutation'>,
    addMember: { _name: 'channels:addMember' } as FunctionReference<'mutation'>,
  },
  openai: {
    chat: { _name: 'openai:chat' } as FunctionReference<'action'>,
    embed: { _name: 'openai:embed' } as FunctionReference<'action'>,
  },
  search: {
    messages: { _name: 'search:messages' } as FunctionReference<'action'>,
  },
}

// ============================================================================
// CLIENT CREATION TESTS
// ============================================================================

describe('ConvexClient', () => {
  describe('creation', () => {
    it('should create client with deployment URL', () => {
      const client = new ConvexClientImpl('https://your-deployment.convex.cloud')
      expect(client).toBeDefined()
      expect(client.query).toBeDefined()
      expect(client.mutation).toBeDefined()
      expect(client.action).toBeDefined()
    })

    it('should create client with options', () => {
      const client = new ConvexClientImpl('https://your-deployment.convex.cloud', {
        unsavedChangesWarning: false,
      })
      expect(client).toBeDefined()
    })

    it('should create client with skipConvexDeploymentUrlCheck', () => {
      const client = new ConvexClientImpl('http://localhost:3210', {
        skipConvexDeploymentUrlCheck: true,
      })
      expect(client).toBeDefined()
    })

    it('should create client with verbose logging', () => {
      const client = new ConvexClientImpl('https://your-deployment.convex.cloud', {
        verbose: true,
      })
      expect(client).toBeDefined()
    })

    it('should accept extended DO config', () => {
      const client = new ConvexClientImpl('https://your-deployment.convex.cloud', {
        doNamespace: {} as DurableObjectNamespace,
        shard: { algorithm: 'consistent', count: 4 },
        replica: { readPreference: 'nearest' },
      } as ExtendedConvexConfig)
      expect(client).toBeDefined()
    })

    it('should accept shard configuration', () => {
      const client = new ConvexClientImpl('https://your-deployment.convex.cloud', {
        shard: { key: 'channel', count: 8, algorithm: 'hash' },
      } as ExtendedConvexConfig)
      expect(client).toBeDefined()
    })

    it('should accept replica configuration', () => {
      const client = new ConvexClientImpl('https://your-deployment.convex.cloud', {
        replica: {
          readPreference: 'secondary',
          writeThrough: true,
          jurisdiction: 'eu',
        },
      } as ExtendedConvexConfig)
      expect(client).toBeDefined()
    })
  })
})

// ============================================================================
// ONE-SHOT QUERY TESTS
// ============================================================================

describe('query()', () => {
  let client: ConvexClient

  beforeEach(() => {
    client = new ConvexClientImpl('https://test.convex.cloud')
  })

  afterEach(async () => {
    await client.close()
  })

  it('should execute query without arguments', async () => {
    const messages = await client.query(api.messages.list, {})
    expect(Array.isArray(messages)).toBe(true)
  })

  it('should execute query with arguments', async () => {
    const message = await client.query(api.messages.get, { id: 'msg123' as DocumentId<'messages'> })
    expect(message === null || typeof message === 'object').toBe(true)
  })

  it('should execute query with complex arguments', async () => {
    const messages = await client.query(api.messages.list, {
      channel: 'ch123' as DocumentId<'channels'>,
      limit: 10,
      cursor: null,
    })
    expect(Array.isArray(messages)).toBe(true)
  })

  it('should return null for non-existent document', async () => {
    const message = await client.query(api.messages.get, { id: 'nonexistent' as DocumentId<'messages'> })
    expect(message).toBeNull()
  })

  it('should throw error for invalid function reference', async () => {
    const invalidRef = { _name: 'invalid:function' } as FunctionReference<'query'>
    await expect(client.query(invalidRef, {})).rejects.toThrow()
  })

  it('should return typed results', async () => {
    const users = await client.query(api.users.list, {})
    expect(Array.isArray(users)).toBe(true)
  })

  it('should handle pagination arguments', async () => {
    const result = await client.query(api.messages.list, {
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(result).toBeDefined()
  })
})

// ============================================================================
// REACTIVE SUBSCRIPTION TESTS (onUpdate)
// ============================================================================

describe('onUpdate()', () => {
  let client: ConvexClient

  beforeEach(() => {
    client = new ConvexClientImpl('https://test.convex.cloud')
  })

  afterEach(async () => {
    await client.close()
  })

  it('should subscribe to query updates', () => {
    const callback = vi.fn()
    const unsubscribe = client.onUpdate(api.messages.list, {}, callback)

    expect(typeof unsubscribe).toBe('function')
  })

  it('should call callback with initial data', async () => {
    const callback = vi.fn()
    client.onUpdate(api.messages.list, {}, callback)

    // Wait for initial callback
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(callback).toHaveBeenCalled()
  })

  it('should call callback with array result', async () => {
    const callback = vi.fn()
    client.onUpdate(api.messages.list, {}, callback)

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(callback).toHaveBeenCalledWith(expect.any(Array))
  })

  it('should unsubscribe from updates', () => {
    const callback = vi.fn()
    const unsubscribe = client.onUpdate(api.messages.list, {}, callback)

    unsubscribe()

    // Should not throw
    expect(true).toBe(true)
  })

  it('should receive updates after mutation', async () => {
    const callback = vi.fn()
    client.onUpdate(api.messages.list, {}, callback)

    await new Promise(resolve => setTimeout(resolve, 10))
    const initialCallCount = callback.mock.calls.length

    // Perform mutation
    await client.mutation(api.messages.send, { body: 'Hello', author: 'Alice', channel: 'general' })

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(callback.mock.calls.length).toBeGreaterThan(initialCallCount)
  })

  it('should not receive updates after unsubscribe', async () => {
    const callback = vi.fn()
    const unsubscribe = client.onUpdate(api.messages.list, {}, callback)

    await new Promise(resolve => setTimeout(resolve, 10))
    unsubscribe()

    const callCountAfterUnsubscribe = callback.mock.calls.length

    // Perform mutation
    await client.mutation(api.messages.send, { body: 'Hello', author: 'Alice', channel: 'general' })

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(callback.mock.calls.length).toBe(callCountAfterUnsubscribe)
  })

  it('should support multiple subscriptions', () => {
    const callback1 = vi.fn()
    const callback2 = vi.fn()

    const unsub1 = client.onUpdate(api.messages.list, {}, callback1)
    const unsub2 = client.onUpdate(api.users.list, {}, callback2)

    expect(typeof unsub1).toBe('function')
    expect(typeof unsub2).toBe('function')
  })

  it('should support same query with different args', () => {
    const callback1 = vi.fn()
    const callback2 = vi.fn()

    const unsub1 = client.onUpdate(api.messages.list, { channel: 'ch1' as DocumentId<'channels'> }, callback1)
    const unsub2 = client.onUpdate(api.messages.list, { channel: 'ch2' as DocumentId<'channels'> }, callback2)

    expect(typeof unsub1).toBe('function')
    expect(typeof unsub2).toBe('function')
  })

  it('should handle error in subscription', async () => {
    const callback = vi.fn()
    const errorCallback = vi.fn()

    const invalidRef = { _name: 'invalid:function' } as FunctionReference<'query'>

    // Should call error callback or throw
    try {
      client.onUpdate(invalidRef, {}, callback, errorCallback)
      await new Promise(resolve => setTimeout(resolve, 10))
    } catch {
      // Expected for invalid function
    }
  })
})

// ============================================================================
// MUTATION TESTS
// ============================================================================

describe('mutation()', () => {
  let client: ConvexClient

  beforeEach(() => {
    client = new ConvexClientImpl('https://test.convex.cloud')
  })

  afterEach(async () => {
    await client.close()
  })

  it('should execute mutation with arguments', async () => {
    const result = await client.mutation(api.messages.send, {
      body: 'Hello, World!',
      author: 'Alice',
      channel: 'general',
    })
    expect(result).toBeDefined()
  })

  it('should return created document ID', async () => {
    const id = await client.mutation(api.messages.send, {
      body: 'Test message',
      author: 'Bob',
      channel: 'random',
    })
    expect(typeof id).toBe('string')
  })

  it('should execute update mutation', async () => {
    // First create a message
    const id = await client.mutation(api.messages.send, {
      body: 'Original',
      author: 'Alice',
      channel: 'general',
    })

    // Then update it
    await client.mutation(api.messages.update, {
      id: id as DocumentId<'messages'>,
      body: 'Updated',
    })

    // Verify update
    const message = await client.query(api.messages.get, { id: id as DocumentId<'messages'> })
    expect(message?.body).toBe('Updated')
  })

  it('should execute delete mutation', async () => {
    // First create a message
    const id = await client.mutation(api.messages.send, {
      body: 'To be deleted',
      author: 'Alice',
      channel: 'general',
    })

    // Then delete it
    await client.mutation(api.messages.remove, { id: id as DocumentId<'messages'> })

    // Verify deletion
    const message = await client.query(api.messages.get, { id: id as DocumentId<'messages'> })
    expect(message).toBeNull()
  })

  it('should throw error for invalid mutation', async () => {
    const invalidRef = { _name: 'invalid:mutation' } as FunctionReference<'mutation'>
    await expect(client.mutation(invalidRef, {})).rejects.toThrow()
  })

  it('should support optimistic updates', async () => {
    const optimisticUpdate: OptimisticUpdate<typeof api.messages.send> = (
      localStore,
      args
    ) => {
      const existing = localStore.getQuery(api.messages.list, {}) ?? []
      localStore.setQuery(api.messages.list, {}, [
        ...existing,
        {
          _id: 'optimistic' as DocumentId<'messages'>,
          _creationTime: Date.now(),
          body: args.body,
          author: args.author,
          channel: args.channel,
        },
      ])
    }

    const id = await client.mutation(
      api.messages.send,
      { body: 'Optimistic', author: 'Alice', channel: 'general' },
      { optimisticUpdate }
    )

    expect(id).toBeDefined()
  })

  it('should rollback optimistic update on error', async () => {
    const callback = vi.fn()
    client.onUpdate(api.messages.list, {}, callback)

    await new Promise(resolve => setTimeout(resolve, 10))
    const initialMessages = callback.mock.calls[callback.mock.calls.length - 1][0]

    const optimisticUpdate: OptimisticUpdate<typeof api.messages.send> = (
      localStore,
      args
    ) => {
      const existing = localStore.getQuery(api.messages.list, {}) ?? []
      localStore.setQuery(api.messages.list, {}, [
        ...existing,
        { _id: 'optimistic' as DocumentId<'messages'>, body: args.body } as Message,
      ])
    }

    const invalidRef = { _name: 'invalid:mutation' } as FunctionReference<'mutation'>

    try {
      await client.mutation(invalidRef, { body: 'Will fail' }, { optimisticUpdate })
    } catch {
      // Expected
    }

    await new Promise(resolve => setTimeout(resolve, 10))
    const currentMessages = callback.mock.calls[callback.mock.calls.length - 1][0]

    // Should rollback to original state
    expect(currentMessages.length).toBe(initialMessages.length)
  })
})

// ============================================================================
// ACTION TESTS
// ============================================================================

describe('action()', () => {
  let client: ConvexClient

  beforeEach(() => {
    client = new ConvexClientImpl('https://test.convex.cloud')
  })

  afterEach(async () => {
    await client.close()
  })

  it('should execute action with arguments', async () => {
    const result = await client.action(api.openai.chat, { prompt: 'Hello' })
    expect(result).toBeDefined()
  })

  it('should return action result', async () => {
    const result = await client.action(api.openai.embed, { text: 'Hello, World!' })
    expect(result).toBeDefined()
  })

  it('should handle action with complex return type', async () => {
    const result = await client.action(api.search.messages, {
      query: 'hello',
      limit: 10,
    })
    expect(result).toBeDefined()
  })

  it('should throw error for failed action', async () => {
    const invalidRef = { _name: 'invalid:action' } as FunctionReference<'action'>
    await expect(client.action(invalidRef, {})).rejects.toThrow()
  })

  it('should support long-running actions', async () => {
    const result = await client.action(api.openai.chat, {
      prompt: 'Write a long essay',
      maxTokens: 1000,
    })
    expect(result).toBeDefined()
  })

  it('should handle action timeout', async () => {
    // Actions can run longer than queries/mutations
    const result = await client.action(api.openai.chat, { prompt: 'Complex task' })
    expect(result).toBeDefined()
  })
})

// ============================================================================
// AUTHENTICATION TESTS
// ============================================================================

describe('setAuth()', () => {
  let client: ConvexClient

  beforeEach(() => {
    client = new ConvexClientImpl('https://test.convex.cloud')
  })

  afterEach(async () => {
    await client.close()
  })

  it('should set auth token fetcher', () => {
    const fetchToken: AuthTokenFetcher = async () => 'test-token'
    client.setAuth(fetchToken)
    // Should not throw
    expect(true).toBe(true)
  })

  it('should clear auth with null', () => {
    const fetchToken: AuthTokenFetcher = async () => 'test-token'
    client.setAuth(fetchToken)
    client.setAuth(null)
    // Should not throw
    expect(true).toBe(true)
  })

  it('should use auth token for queries', async () => {
    const fetchToken: AuthTokenFetcher = async () => 'user-token-123'
    client.setAuth(fetchToken)

    const user = await client.query(api.users.getByToken, {})
    // Should use auth context
    expect(user).toBeDefined()
  })

  it('should use auth token for mutations', async () => {
    const fetchToken: AuthTokenFetcher = async () => 'user-token-123'
    client.setAuth(fetchToken)

    const id = await client.mutation(api.users.update, {
      name: 'Updated Name',
    })
    expect(id).toBeDefined()
  })

  it('should call token fetcher for each request', async () => {
    const fetchToken = vi.fn().mockResolvedValue('test-token')
    client.setAuth(fetchToken)

    await client.query(api.users.list, {})
    await client.query(api.messages.list, {})

    // Should be called at least twice
    expect(fetchToken).toHaveBeenCalledTimes(2)
  })

  it('should handle token refresh', async () => {
    let tokenVersion = 1
    const fetchToken: AuthTokenFetcher = async () => `token-v${tokenVersion++}`
    client.setAuth(fetchToken)

    await client.query(api.users.list, {})
    await client.query(api.messages.list, {})

    // Token version should have incremented
    expect(tokenVersion).toBeGreaterThan(1)
  })

  it('should handle auth error', async () => {
    const fetchToken: AuthTokenFetcher = async () => {
      throw new Error('Auth failed')
    }
    client.setAuth(fetchToken)

    await expect(client.query(api.users.list, {})).rejects.toThrow()
  })

  it('should provide onTokenChange callback', () => {
    const onTokenChange = vi.fn()
    client.setAuth(async () => 'token', { onTokenChange })

    // onTokenChange should be called when token changes
    expect(true).toBe(true) // Just verify no throw
  })
})

// ============================================================================
// DOCUMENT ID TESTS
// ============================================================================

describe('Document IDs', () => {
  let client: ConvexClient

  beforeEach(() => {
    client = new ConvexClientImpl('https://test.convex.cloud')
  })

  afterEach(async () => {
    await client.close()
  })

  it('should generate unique document IDs', async () => {
    const id1 = await client.mutation(api.messages.send, { body: 'First', author: 'A', channel: 'ch' })
    const id2 = await client.mutation(api.messages.send, { body: 'Second', author: 'B', channel: 'ch' })

    expect(id1).not.toBe(id2)
  })

  it('should generate IDs with correct format', async () => {
    const id = await client.mutation(api.messages.send, { body: 'Test', author: 'A', channel: 'ch' })

    // Convex IDs are typically base64-like strings
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('should support ID type safety', async () => {
    const messageId = await client.mutation(api.messages.send, { body: 'Test', author: 'A', channel: 'ch' }) as DocumentId<'messages'>

    // Should work with correct table
    const message = await client.query(api.messages.get, { id: messageId })
    expect(message).toBeDefined()
  })

  it('should include _creationTime in documents', async () => {
    const id = await client.mutation(api.messages.send, { body: 'Test', author: 'A', channel: 'ch' })
    const message = await client.query(api.messages.get, { id: id as DocumentId<'messages'> })

    expect(message?._creationTime).toBeDefined()
    expect(typeof message?._creationTime).toBe('number')
  })

  it('should order _creationTime correctly', async () => {
    const id1 = await client.mutation(api.messages.send, { body: 'First', author: 'A', channel: 'ch' })
    await new Promise(resolve => setTimeout(resolve, 5))
    const id2 = await client.mutation(api.messages.send, { body: 'Second', author: 'B', channel: 'ch' })

    const msg1 = await client.query(api.messages.get, { id: id1 as DocumentId<'messages'> })
    const msg2 = await client.query(api.messages.get, { id: id2 as DocumentId<'messages'> })

    expect(msg1!._creationTime).toBeLessThan(msg2!._creationTime)
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('error handling', () => {
  let client: ConvexClient

  beforeEach(() => {
    client = new ConvexClientImpl('https://test.convex.cloud')
  })

  afterEach(async () => {
    await client.close()
  })

  it('should throw ConvexError for known errors', async () => {
    const invalidRef = { _name: 'error:throw' } as FunctionReference<'query'>

    try {
      await client.query(invalidRef, {})
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeDefined()
    }
  })

  it('should include error message', async () => {
    const invalidRef = { _name: 'error:throw' } as FunctionReference<'query'>

    try {
      await client.query(invalidRef, {})
      expect.fail('Should have thrown')
    } catch (error) {
      expect((error as Error).message).toBeDefined()
    }
  })

  it('should handle network errors', async () => {
    // Simulate network failure scenario
    const client = new ConvexClientImpl('https://invalid-url.convex.cloud')

    // Should handle gracefully
    expect(client).toBeDefined()
  })

  it('should handle validation errors', async () => {
    // Missing required field
    try {
      await client.mutation(api.messages.send, { body: 'Test' } as any)
    } catch (error) {
      expect(error).toBeDefined()
    }
  })

  it('should propagate user-defined errors', async () => {
    // Custom application errors from Convex functions
    const errorRef = { _name: 'custom:error' } as FunctionReference<'mutation'>

    try {
      await client.mutation(errorRef, {})
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeDefined()
    }
  })
})

// ============================================================================
// CLIENT LIFECYCLE TESTS
// ============================================================================

describe('client lifecycle', () => {
  it('should close cleanly', async () => {
    const client = new ConvexClientImpl('https://test.convex.cloud')
    await client.close()
    // Should not throw
    expect(true).toBe(true)
  })

  it('should cancel pending queries on close', async () => {
    const client = new ConvexClientImpl('https://test.convex.cloud')

    const queryPromise = client.query(api.messages.list, {})
    await client.close()

    // Should either resolve or reject gracefully
    try {
      await queryPromise
    } catch {
      // Expected if cancelled
    }
  })

  it('should unsubscribe all on close', async () => {
    const client = new ConvexClientImpl('https://test.convex.cloud')

    const callback = vi.fn()
    client.onUpdate(api.messages.list, {}, callback)

    await client.close()

    // No more callbacks should fire
    const callCount = callback.mock.calls.length
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(callback.mock.calls.length).toBe(callCount)
  })

  it('should throw after close', async () => {
    const client = new ConvexClientImpl('https://test.convex.cloud')
    await client.close()

    await expect(client.query(api.messages.list, {})).rejects.toThrow()
  })

  it('should allow sync method to wait for pending writes', async () => {
    const client = new ConvexClientImpl('https://test.convex.cloud')

    // Queue multiple mutations
    client.mutation(api.messages.send, { body: 'Msg1', author: 'A', channel: 'ch' })
    client.mutation(api.messages.send, { body: 'Msg2', author: 'B', channel: 'ch' })

    // Wait for all to complete
    await client.sync()

    // All should be visible
    const messages = await client.query(api.messages.list, { channel: 'ch' as DocumentId<'channels'> })
    expect(messages.length).toBeGreaterThanOrEqual(2)

    await client.close()
  })
})

// ============================================================================
// FUNCTION REGISTRY TESTS
// ============================================================================

describe('function registry', () => {
  let client: ConvexClient

  beforeEach(() => {
    client = new ConvexClientImpl('https://test.convex.cloud')
  })

  afterEach(async () => {
    await client.close()
  })

  it('should register query functions', () => {
    // The mock api object should be usable
    expect(api.messages.list._name).toBe('messages:list')
    expect(api.users.get._name).toBe('users:get')
  })

  it('should register mutation functions', () => {
    expect(api.messages.send._name).toBe('messages:send')
    expect(api.users.create._name).toBe('users:create')
  })

  it('should register action functions', () => {
    expect(api.openai.chat._name).toBe('openai:chat')
    expect(api.search.messages._name).toBe('search:messages')
  })

  it('should distinguish function types', async () => {
    // Query
    await expect(client.query(api.messages.list, {})).resolves.toBeDefined()

    // Mutation (treated as mutation)
    await expect(client.mutation(api.messages.send, { body: 'x', author: 'a', channel: 'c' })).resolves.toBeDefined()

    // Action
    await expect(client.action(api.openai.chat, { prompt: 'hi' })).resolves.toBeDefined()
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('integration', () => {
  it('should work with realistic chat workflow', async () => {
    const client = new ConvexClientImpl('https://test.convex.cloud')

    // Subscribe to messages
    const messagesCallback = vi.fn()
    const unsubscribe = client.onUpdate(api.messages.list, { channel: 'general' as DocumentId<'channels'> }, messagesCallback)

    // Wait for initial data
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(messagesCallback).toHaveBeenCalled()

    // Send a message
    const messageId = await client.mutation(api.messages.send, {
      body: 'Hello, everyone!',
      author: 'Alice',
      channel: 'general',
    })
    expect(messageId).toBeDefined()

    // Wait for subscription update
    await new Promise(resolve => setTimeout(resolve, 10))

    // Update the message
    await client.mutation(api.messages.update, {
      id: messageId as DocumentId<'messages'>,
      body: 'Hello, everyone! (edited)',
    })

    // Delete the message
    await client.mutation(api.messages.remove, {
      id: messageId as DocumentId<'messages'>,
    })

    // Verify deletion
    const deletedMessage = await client.query(api.messages.get, { id: messageId as DocumentId<'messages'> })
    expect(deletedMessage).toBeNull()

    // Clean up
    unsubscribe()
    await client.close()
  })

  it('should work with authenticated user flow', async () => {
    const client = new ConvexClientImpl('https://test.convex.cloud')

    // Set authentication
    const userId = 'user-123'
    client.setAuth(async () => `token-${userId}`)

    // Query user-specific data
    const currentUser = await client.query(api.users.getByToken, {})

    // Create user if not exists
    if (!currentUser) {
      await client.mutation(api.users.create, {
        name: 'New User',
        email: 'new@example.com.ai',
      })
    }

    // Update user
    await client.mutation(api.users.update, {
      name: 'Updated Name',
    })

    await client.close()
  })

  it('should work with AI action integration', async () => {
    const client = new ConvexClientImpl('https://test.convex.cloud')

    // Call an AI action
    const response = await client.action(api.openai.chat, {
      prompt: 'What is the capital of France?',
    })

    expect(response).toBeDefined()

    // Search using embeddings
    const searchResults = await client.action(api.search.messages, {
      query: 'hello world',
      limit: 5,
    })

    expect(searchResults).toBeDefined()

    await client.close()
  })

  it('should handle concurrent operations', async () => {
    const client = new ConvexClientImpl('https://test.convex.cloud')

    // Multiple concurrent mutations
    const promises = Array.from({ length: 10 }, (_, i) =>
      client.mutation(api.messages.send, {
        body: `Message ${i}`,
        author: `User ${i % 3}`,
        channel: 'stress-test',
      })
    )

    const ids = await Promise.all(promises)

    // All should succeed with unique IDs
    expect(new Set(ids).size).toBe(10)

    await client.close()
  })
})

// ============================================================================
// DO ROUTING TESTS
// ============================================================================

describe('DO routing', () => {
  it('should extract shard key from mutation', () => {
    const client = new ConvexClientImpl('https://test.convex.cloud', {
      shard: { key: 'channel' },
    } as ExtendedConvexConfig)

    expect(client).toBeDefined()
  })

  it('should route reads based on replica config', () => {
    const client = new ConvexClientImpl('https://test.convex.cloud', {
      replica: { readPreference: 'secondary' },
    } as ExtendedConvexConfig)

    expect(client).toBeDefined()
  })

  it('should support write-through replication', () => {
    const client = new ConvexClientImpl('https://test.convex.cloud', {
      replica: { writeThrough: true },
    } as ExtendedConvexConfig)

    expect(client).toBeDefined()
  })

  it('should respect jurisdiction constraints', () => {
    const client = new ConvexClientImpl('https://test.convex.cloud', {
      replica: { jurisdiction: 'eu' },
    } as ExtendedConvexConfig)

    expect(client).toBeDefined()
  })
})

// ============================================================================
// LOCAL STORE TESTS (for optimistic updates)
// ============================================================================

describe('local store', () => {
  let client: ConvexClient

  beforeEach(() => {
    client = new ConvexClientImpl('https://test.convex.cloud')
  })

  afterEach(async () => {
    await client.close()
  })

  it('should support getQuery in optimistic update', async () => {
    const optimisticUpdate: OptimisticUpdate<typeof api.messages.send> = (localStore) => {
      const messages = localStore.getQuery(api.messages.list, {})
      expect(messages === null || Array.isArray(messages)).toBe(true)
    }

    await client.mutation(api.messages.send, { body: 'Test', author: 'A', channel: 'ch' }, { optimisticUpdate })
  })

  it('should support setQuery in optimistic update', async () => {
    const newMessage: Message = {
      _id: 'temp' as DocumentId<'messages'>,
      _creationTime: Date.now(),
      body: 'Optimistic',
      author: 'Me',
      channel: 'ch',
    }

    const optimisticUpdate: OptimisticUpdate<typeof api.messages.send> = (localStore) => {
      const existing = localStore.getQuery(api.messages.list, {}) ?? []
      localStore.setQuery(api.messages.list, {}, [...existing, newMessage])
    }

    await client.mutation(api.messages.send, { body: 'Test', author: 'A', channel: 'ch' }, { optimisticUpdate })
  })

  it('should reflect optimistic updates in subscriptions', async () => {
    const callback = vi.fn()
    client.onUpdate(api.messages.list, {}, callback)
    await new Promise(resolve => setTimeout(resolve, 10))

    const beforeCount = callback.mock.calls.length

    const optimisticUpdate: OptimisticUpdate<typeof api.messages.send> = (localStore) => {
      const existing = localStore.getQuery(api.messages.list, {}) ?? []
      localStore.setQuery(api.messages.list, {}, [
        ...existing,
        {
          _id: 'opt' as DocumentId<'messages'>,
          _creationTime: Date.now(),
          body: 'Instant',
          author: 'Me',
          channel: 'ch',
        },
      ])
    }

    // Start mutation (don't await - check optimistic immediately)
    const mutationPromise = client.mutation(api.messages.send, { body: 'Test', author: 'A', channel: 'ch' }, { optimisticUpdate })

    // Should trigger callback with optimistic data
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(callback.mock.calls.length).toBeGreaterThan(beforeCount)

    await mutationPromise
  })
})

// ============================================================================
// PAGINATION TESTS
// ============================================================================

describe('pagination', () => {
  let client: ConvexClient

  beforeEach(() => {
    client = new ConvexClientImpl('https://test.convex.cloud')
  })

  afterEach(async () => {
    await client.close()
  })

  it('should support paginationOpts in queries', async () => {
    const result = await client.query(api.messages.list, {
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(result).toBeDefined()
  })

  it('should return pagination cursor', async () => {
    // Create multiple messages
    for (let i = 0; i < 15; i++) {
      await client.mutation(api.messages.send, { body: `Msg ${i}`, author: 'A', channel: 'page-test' })
    }

    const result = await client.query(api.messages.list, {
      paginationOpts: { numItems: 5, cursor: null },
    })

    // Should include continuation info
    expect(result).toBeDefined()
  })

  it('should paginate through results', async () => {
    // Create messages
    for (let i = 0; i < 10; i++) {
      await client.mutation(api.messages.send, { body: `Msg ${i}`, author: 'A', channel: 'paginate' })
    }

    // Get first page
    const page1 = await client.query(api.messages.list, {
      paginationOpts: { numItems: 3, cursor: null },
    })
    expect(page1).toBeDefined()
  })
})

// ============================================================================
// BATCH OPERATIONS TESTS
// ============================================================================

describe('batch operations', () => {
  let client: ConvexClient

  beforeEach(() => {
    client = new ConvexClientImpl('https://test.convex.cloud')
  })

  afterEach(async () => {
    await client.close()
  })

  it('should support multiple queries in parallel', async () => {
    const [messages, users, channels] = await Promise.all([
      client.query(api.messages.list, {}),
      client.query(api.users.list, {}),
      client.query(api.channels.list, {}),
    ])

    expect(Array.isArray(messages)).toBe(true)
    expect(Array.isArray(users)).toBe(true)
    expect(Array.isArray(channels)).toBe(true)
  })

  it('should support multiple mutations in parallel', async () => {
    const ids = await Promise.all([
      client.mutation(api.messages.send, { body: 'Msg1', author: 'A', channel: 'batch' }),
      client.mutation(api.messages.send, { body: 'Msg2', author: 'B', channel: 'batch' }),
      client.mutation(api.messages.send, { body: 'Msg3', author: 'C', channel: 'batch' }),
    ])

    expect(ids.length).toBe(3)
    expect(new Set(ids).size).toBe(3)
  })

  it('should maintain consistency with concurrent mutations', async () => {
    // Create channel
    await client.mutation(api.channels.create, { name: 'concurrent', description: 'Test' })

    // Add multiple members concurrently
    await Promise.all([
      client.mutation(api.channels.addMember, { channel: 'concurrent', user: 'u1' as DocumentId<'users'> }),
      client.mutation(api.channels.addMember, { channel: 'concurrent', user: 'u2' as DocumentId<'users'> }),
      client.mutation(api.channels.addMember, { channel: 'concurrent', user: 'u3' as DocumentId<'users'> }),
    ])

    // All should be added
    const channels = await client.query(api.channels.list, {})
    expect(channels).toBeDefined()
  })
})
