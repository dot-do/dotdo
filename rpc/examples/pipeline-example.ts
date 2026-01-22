/**
 * Promise Pipelining Example
 *
 * This example demonstrates Cap'n Proto-style promise pipelining in @dotdo/rpc.
 * Promise pipelining allows chaining multiple RPC calls that get batched into
 * a SINGLE network round trip, dramatically reducing latency.
 *
 * Traditional RPC (2 round trips):
 *   const user = await client.getUser('123')     // Round trip 1
 *   const profile = await user.getProfile()      // Round trip 2
 *
 * With Pipelining (1 round trip):
 *   const profile = await client.pipeline('getUser', '123')
 *     .call('getProfile')
 *
 * The server receives the full pipeline chain and executes it locally,
 * returning only the final result.
 */

import { createServer } from '../server'
import { createClientWithPipeline } from '../client'
import { PipelineBuilder } from '../pipeline'
import { FetchTransport } from '../transport/fetch'

// ============================================================================
// Types - Define your API interfaces
// ============================================================================

interface User {
  id: string
  name: string
  email: string
  getProfile(): Profile
  getOrders(): Order[]
  getSettings(): Settings
}

interface Profile {
  avatar: string
  bio: string
  socialLinks: {
    twitter?: string
    github?: string
  }
}

interface Order {
  id: string
  total: number
  items: Array<{ name: string; price: number }>
}

interface Settings {
  theme: 'light' | 'dark'
  notifications: boolean
  getValue(key: string): string | undefined
}

interface UserAPI {
  getUser(id: string): Promise<User>
  users: {
    get(id: string): User
    list(): User[]
  }
}

// ============================================================================
// Server Implementation - The target object with methods
// ============================================================================

/**
 * Create a mock user API for demonstration
 */
function createMockAPI(): UserAPI {
  const users: Record<string, User> = {
    'alice': createUser('alice', 'Alice Smith', 'alice@example.com'),
    'bob': createUser('bob', 'Bob Jones', 'bob@example.com'),
    'charlie': createUser('charlie', 'Charlie Brown', 'charlie@example.com'),
  }

  function createUser(id: string, name: string, email: string): User {
    return {
      id,
      name,
      email,
      getProfile: () => ({
        avatar: `https://avatars.example.com/${id}.png`,
        bio: `Hello, I'm ${name}!`,
        socialLinks: {
          twitter: `@${id}`,
          github: id,
        },
      }),
      getOrders: () => [
        { id: `${id}-order-1`, total: 99.99, items: [{ name: 'Widget', price: 99.99 }] },
        { id: `${id}-order-2`, total: 149.99, items: [{ name: 'Gadget', price: 149.99 }] },
      ],
      getSettings: () => ({
        theme: 'dark' as const,
        notifications: true,
        getValue: (key: string) => {
          const values: Record<string, string> = {
            language: 'en',
            timezone: 'UTC',
            currency: 'USD',
          }
          return values[key]
        },
      }),
    }
  }

  return {
    async getUser(id: string): Promise<User> {
      const user = users[id]
      if (!user) throw new Error(`User ${id} not found`)
      return user
    },
    users: {
      get(id: string): User {
        const user = users[id]
        if (!user) throw new Error(`User ${id} not found`)
        return user
      },
      list(): User[] {
        return Object.values(users)
      },
    },
  }
}

// ============================================================================
// Example 1: Basic Pipeline - Replace 2 round trips with 1
// ============================================================================

/**
 * Without pipelining, getting a user's avatar URL requires 2 round trips:
 *   1. getUser('alice') -> User object
 *   2. user.getProfile() -> Profile with avatar
 *
 * With pipelining, this is a single round trip.
 */
async function basicPipelineExample(serverUrl: string) {
  console.log('\n=== Example 1: Basic Pipeline ===')

  // Create a client with pipelining support
  const client = createClientWithPipeline<UserAPI>({ url: serverUrl })

  // Traditional approach would be:
  // const user = await client.getUser('alice')  // Round trip 1
  // const profile = await user.getProfile()      // Round trip 2 (if this were a remote call)

  // With pipelining - SINGLE round trip:
  const profile = await client.pipeline('getUser', 'alice')
    .call('getProfile' as keyof User)

  console.log('Got profile in single round trip:', profile)
  return profile
}

// ============================================================================
// Example 2: Deep Pipeline Chain - Property access and method calls
// ============================================================================

/**
 * Pipeline can chain multiple operations:
 * - .call() to invoke methods on intermediate results
 * - .get() to access properties
 *
 * All operations execute server-side in one round trip.
 */
async function deepPipelineExample(serverUrl: string) {
  console.log('\n=== Example 2: Deep Pipeline Chain ===')

  const client = createClientWithPipeline<UserAPI>({ url: serverUrl })

  // Get user -> get profile -> get socialLinks -> get github
  // Without pipelining: potentially 4 round trips (if each were remote)
  // With pipelining: 1 round trip

  const githubUsername = await client.pipeline('getUser', 'bob')
    .call('getProfile' as keyof User)
    .get('socialLinks' as never)
    .get('github' as never)

  console.log('Got GitHub username in single round trip:', githubUsername)
  return githubUsername
}

// ============================================================================
// Example 3: Pipeline with Method Arguments
// ============================================================================

/**
 * Pipeline supports passing arguments to chained method calls.
 */
async function pipelineWithArgsExample(serverUrl: string) {
  console.log('\n=== Example 3: Pipeline with Method Arguments ===')

  const client = createClientWithPipeline<UserAPI>({ url: serverUrl })

  // Get user -> get settings -> getValue('timezone')
  // The 'timezone' argument is passed to getValue on the server
  const timezone = await client.pipeline('getUser', 'charlie')
    .call('getSettings' as keyof User)
    .call('getValue' as never, 'timezone' as never)

  console.log('Got timezone setting in single round trip:', timezone)
  return timezone
}

// ============================================================================
// Example 4: Pipeline with Nested API Paths
// ============================================================================

/**
 * Pipeline works with dot-separated method paths (e.g., 'users.get')
 */
async function nestedPathPipelineExample(serverUrl: string) {
  console.log('\n=== Example 4: Nested Path Pipeline ===')

  const client = createClientWithPipeline<UserAPI>({ url: serverUrl })

  // Access nested 'users.get' method and chain operations
  const orders = await client.pipeline('users.get' as keyof UserAPI, 'alice')
    .call('getOrders' as never)

  console.log('Got orders via nested path in single round trip:', orders)
  return orders
}

// ============================================================================
// Example 5: Using PipelineBuilder directly with Transport
// ============================================================================

/**
 * For more control, use PipelineBuilder directly with a transport.
 * This is useful when you need custom transport configuration.
 */
async function transportPipelineExample(serverUrl: string) {
  console.log('\n=== Example 5: Direct PipelineBuilder with Transport ===')

  // Create a custom transport
  const transport = new FetchTransport({
    url: serverUrl,
    timeout: 5000,
    headers: {
      'X-Custom-Header': 'pipeline-example',
    },
  })

  // Build pipeline directly
  const builder = new PipelineBuilder<User>(
    transport,
    'getUser',
    ['alice'],
    { timeout: 5000 }
  )

  // Chain operations
  const bio = await builder
    .call('getProfile' as keyof User)
    .get('bio' as never)

  console.log('Got bio using direct builder:', bio)
  return bio
}

// ============================================================================
// Example 6: Demonstrating Round Trip Savings
// ============================================================================

/**
 * This example uses a counting mock to prove pipelining uses only 1 round trip.
 */
async function roundTripCountingExample() {
  console.log('\n=== Example 6: Round Trip Counting ===')

  let fetchCallCount = 0

  // Create a counting fetch wrapper
  const countingFetch: typeof fetch = async (...args) => {
    fetchCallCount++
    console.log(`  Network call #${fetchCallCount}`)
    return fetch(...args)
  }

  // Start a local server for this example
  const api = createMockAPI()
  const server = createServer({ target: api })

  // Create transport with counting fetch
  const transport = new FetchTransport({
    url: 'http://localhost', // Will be intercepted
    fetch: async (input, init) => {
      // Intercept and route to our server
      fetchCallCount++
      console.log(`  Network call #${fetchCallCount}`)
      const request = new Request(input, init)
      return server.fetch(request)
    },
  })

  // Execute a deep pipeline chain
  console.log('Executing deep pipeline chain...')
  const builder = new PipelineBuilder<User>(
    transport,
    'getUser',
    ['alice'],
    {}
  )

  await builder
    .call('getProfile' as keyof User)
    .get('socialLinks' as never)
    .get('twitter' as never)

  console.log(`\nTotal network calls: ${fetchCallCount}`)
  console.log('Without pipelining, this would require multiple calls!')

  return fetchCallCount
}

// ============================================================================
// Run All Examples
// ============================================================================

export async function runAllExamples() {
  // For examples 1-5, we need a running server
  // In real usage, this would be a remote URL
  const api = createMockAPI()
  const server = createServer({ target: api })

  // Mock server URL (in tests, we'd intercept fetch)
  const serverUrl = 'http://localhost:8787'

  console.log('='.repeat(60))
  console.log('Promise Pipelining Examples')
  console.log('='.repeat(60))

  // Example 6 is self-contained with counting
  await roundTripCountingExample()

  console.log('\n' + '='.repeat(60))
  console.log('Examples complete!')
  console.log('='.repeat(60))
}

// Export individual examples for testing
export {
  basicPipelineExample,
  deepPipelineExample,
  pipelineWithArgsExample,
  nestedPathPipelineExample,
  transportPipelineExample,
  roundTripCountingExample,
  createMockAPI,
}
