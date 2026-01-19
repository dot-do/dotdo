// Example: Using BatchMapPromise for efficient RPC batching
import { createBatchMapPromise, batchMap } from '../batch'

// Example 1: Basic batch mapping
async function basicExample() {
  const userIds = ['user-1', 'user-2', 'user-3', 'user-4', 'user-5']

  // Simulate RPC call to fetch user
  const fetchUser = async (id: string) => {
    // This would be an actual RPC call
    await new Promise(r => setTimeout(r, 100))
    return { id, name: `User ${id}`, email: `${id}@example.com` }
  }

  // Process all users in parallel
  const users = await createBatchMapPromise(userIds, fetchUser)

  console.log('Fetched users:', users)
}

// Example 2: Concurrency control
async function concurrencyExample() {
  const items = Array.from({ length: 100 }, (_, i) => i)

  const heavyOperation = async (item: number) => {
    await new Promise(r => setTimeout(r, 50))
    return item * 2
  }

  // Limit to 5 concurrent operations
  const results = await createBatchMapPromise(items, heavyOperation, {
    concurrency: 5,
    onProgress: (done, total) => {
      console.log(`Progress: ${done}/${total}`)
    }
  })

  console.log(`Processed ${results.length} items`)
}

// Example 3: Chainable API with batch size
async function chainableExample() {
  const ids = Array.from({ length: 25 }, (_, i) => `id-${i}`)

  const fetchData = async (id: string) => {
    await new Promise(r => setTimeout(r, 10))
    return { id, value: Math.random() }
  }

  // Process in batches of 10 with progress tracking
  const results = await createBatchMapPromise(ids, fetchData)
    .batch(10)
    .progress((done, total) => {
      console.log(`Batch progress: ${done}/${total}`)
    })

  console.log(`Completed ${results.length} batches`)
}

// Example 4: Transform results
async function transformExample() {
  const userIds = ['alice', 'bob', 'charlie']

  const fetchUser = async (id: string) => {
    return {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      profile: { avatar: `https://example.com/avatars/${id}.jpg` }
    }
  }

  // Extract only names
  const names = await createBatchMapPromise(userIds, fetchUser, {
    transform: (user) => user.name
  })

  console.log('User names:', names) // ['Alice', 'Bob', 'Charlie']
}

// Example 5: Error handling with retries
async function errorHandlingExample() {
  const items = [1, 2, 3, 4, 5]
  let failureCount = 0

  const unreliableOperation = async (item: number) => {
    // Simulate intermittent failures
    if (Math.random() < 0.3 && failureCount < 2) {
      failureCount++
      throw new Error(`Temporary failure on ${item}`)
    }
    return item * 2
  }

  // Retry failed items up to 3 times
  const results = await createBatchMapPromise(items, unreliableOperation, {
    retries: 3,
    onError: 'continue', // Continue even if some items fail after retries
    onItemError: (index, item, error) => {
      console.error(`Item ${item} failed after retries:`, error.message)
    }
  })

  console.log('Results (undefined for failed items):', results)
}

// Example 6: RPC Client integration pattern
async function rpcClientExample() {
  // This would typically be integrated into the RPC client proxy
  interface RPCClient {
    getUser: {
      (id: string): Promise<User>
      map(ids: string[]): Promise<User[]>
    }
  }

  interface User {
    id: string
    name: string
  }

  // Simulated RPC client with .map() support
  const client = {
    getUser: Object.assign(
      async (id: string): Promise<User> => {
        // Single RPC call
        return { id, name: `User ${id}` }
      },
      {
        map: async (ids: string[]): Promise<User[]> => {
          // Batched RPC calls
          return createBatchMapPromise(
            ids,
            async (id) => {
              // This would be the actual RPC call
              return { id, name: `User ${id}` }
            },
            { concurrency: 10 }
          )
        }
      }
    )
  }

  // Usage: fetch multiple users efficiently
  const users = await client.getUser.map(['user-1', 'user-2', 'user-3'])
  console.log('Batch fetched users:', users)
}

// Run examples
async function runExamples() {
  console.log('\n=== Basic Example ===')
  await basicExample()

  console.log('\n=== Concurrency Example ===')
  await concurrencyExample()

  console.log('\n=== Chainable API Example ===')
  await chainableExample()

  console.log('\n=== Transform Example ===')
  await transformExample()

  console.log('\n=== Error Handling Example ===')
  await errorHandlingExample()

  console.log('\n=== RPC Client Example ===')
  await rpcClientExample()
}

// Uncomment to run:
// runExamples().catch(console.error)

export {
  basicExample,
  concurrencyExample,
  chainableExample,
  transformExample,
  errorHandlingExample,
  rpcClientExample
}
