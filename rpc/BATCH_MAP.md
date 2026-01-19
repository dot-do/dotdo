# BatchMapPromise - Efficient Array Processing for RPC

BatchMapPromise provides automatic batching, concurrency control, and error handling for processing arrays with async operations. It's particularly useful for RPC calls where you need to process multiple items efficiently.

## Features

- **Automatic Batching**: Process arrays efficiently with configurable batch sizes
- **Concurrency Control**: Limit parallel operations to avoid overwhelming resources
- **Progress Tracking**: Monitor processing with real-time progress callbacks
- **Error Handling**: Flexible error strategies (fail-fast, continue, retry)
- **Retry Logic**: Automatic retry with configurable attempts
- **Transform Support**: Apply transformations to results
- **Order Preservation**: Results maintain input array order
- **Chainable API**: Fluent interface for configuration

## Installation

```typescript
import { createBatchMapPromise, batchMap } from '@dotdo/rpc'
```

## Basic Usage

```typescript
const userIds = ['user-1', 'user-2', 'user-3']

const users = await createBatchMapPromise(
  userIds,
  async (id) => fetchUser(id)
)
```

## API Reference

### `createBatchMapPromise<T, R>(items, fn, options)`

Creates a BatchMapPromise for processing an array.

**Parameters:**
- `items: T[]` - Array of items to process
- `fn: (item: T, index: number) => Promise<R> | R` - Function to apply to each item
- `options?: BatchMapOptions<T, R>` - Configuration options

**Returns:** `BatchMapPromise<R>` - A promise that resolves to an array of results

### BatchMapOptions

```typescript
interface BatchMapOptions<T, R> {
  // Maximum number of concurrent operations (default: Infinity)
  concurrency?: number

  // Maximum items per batch (for splitting large arrays)
  batchSize?: number

  // Progress callback
  onProgress?: (done: number, total: number) => void

  // Transform function applied to each result
  transform?: (result: R) => any

  // Error handling strategy (default: 'fail')
  onError?: 'fail' | 'continue' | 'retry'

  // Number of retry attempts for failed items (default: 0)
  retries?: number

  // Callback for individual item errors
  onItemError?: (index: number, item: T, error: Error) => void
}
```

## Examples

### Concurrency Control

Limit the number of simultaneous operations:

```typescript
const results = await createBatchMapPromise(
  items,
  processItem,
  { concurrency: 5 }
)
```

### Progress Tracking

Monitor processing progress:

```typescript
const results = await createBatchMapPromise(
  items,
  processItem,
  {
    onProgress: (done, total) => {
      console.log(`Progress: ${done}/${total} (${Math.round(done/total*100)}%)`)
    }
  }
)
```

### Chainable API

Use method chaining for cleaner code:

```typescript
const results = await createBatchMapPromise(items, processItem)
  .batch(10)
  .progress((done, total) => console.log(`${done}/${total}`))
```

### Transform Results

Apply a transformation to each result:

```typescript
const names = await createBatchMapPromise(
  userIds,
  fetchUser,
  {
    transform: (user) => user.name
  }
)
// Returns: ['Alice', 'Bob', 'Charlie']
```

### Error Handling

#### Fail Fast (default)

Stop on first error:

```typescript
await createBatchMapPromise(items, processItem)
// Throws on first error
```

#### Continue on Error

Process all items, collect errors:

```typescript
const results = await createBatchMapPromise(
  items,
  processItem,
  {
    onError: 'continue',
    onItemError: (index, item, error) => {
      console.error(`Item ${index} failed:`, error)
    }
  }
)
// Failed items will be undefined in results
```

#### Retry Failed Items

Automatically retry failed operations:

```typescript
const results = await createBatchMapPromise(
  items,
  processItem,
  {
    retries: 3,
    onError: 'continue'
  }
)
// Retries each failed item up to 3 times
```

### Batch Size Control

Split large arrays into smaller batches:

```typescript
const results = await createBatchMapPromise(
  largeArray,
  processItem,
  {
    batchSize: 100,
    concurrency: 10
  }
)
```

## RPC Client Integration

BatchMapPromise is designed to integrate with RPC clients for efficient bulk operations:

```typescript
// Extend RPC client methods with .map()
const client = createRPCClient('https://api.example.com')

// Instead of multiple individual calls:
const users = await Promise.all(
  ids.map(id => client.getUser(id))
)

// Use batch mapping:
const users = await client.getUser.map(ids)
// Single batched request instead of N individual requests
```

## Performance Considerations

### Concurrency

- **Unlimited (`Infinity`)**: All items processed in parallel. Use for I/O-bound operations.
- **Limited (e.g., `5`)**: Controls resource usage. Use for CPU-intensive operations or rate-limited APIs.
- **Sequential (`1`)**: One at a time. Use when order matters or for debugging.

### Batch Size

- Controls how many items are sent in a single request
- Useful for APIs with payload size limits
- Helps manage memory usage for large arrays

### Progress Tracking

- Minimal overhead
- Called after each item completes
- Useful for long-running operations and user feedback

## Advanced Patterns

### Combining with Pipeline

```typescript
const avatars = await client
  .getTeam('engineering')
  .members
  .map(member => member.getAvatar())
```

### Parallel Batch Processing

```typescript
const [users, posts, comments] = await Promise.all([
  createBatchMapPromise(userIds, fetchUser, { concurrency: 10 }),
  createBatchMapPromise(postIds, fetchPost, { concurrency: 10 }),
  createBatchMapPromise(commentIds, fetchComment, { concurrency: 10 })
])
```

### Conditional Processing

```typescript
const results = await createBatchMapPromise(
  items,
  async (item) => {
    if (item.needsProcessing) {
      return processItem(item)
    }
    return item // Return as-is
  }
)
```

## Testing

```typescript
import { describe, it, expect } from 'vitest'
import { createBatchMapPromise } from '@dotdo/rpc'

describe('BatchMapPromise', () => {
  it('should process items in parallel', async () => {
    const results = await createBatchMapPromise(
      [1, 2, 3],
      async (x) => x * 2
    )
    expect(results).toEqual([2, 4, 6])
  })

  it('should respect concurrency limit', async () => {
    let maxConcurrent = 0
    let currentConcurrent = 0

    const results = await createBatchMapPromise(
      [1, 2, 3, 4, 5],
      async (x) => {
        currentConcurrent++
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
        await new Promise(r => setTimeout(r, 10))
        currentConcurrent--
        return x
      },
      { concurrency: 2 }
    )

    expect(maxConcurrent).toBe(2)
  })
})
```

## Implementation Notes

### Order Preservation

Results always maintain the same order as the input array, regardless of completion order:

```typescript
// Even if item 3 finishes before item 1, results[0] will be item 1's result
const results = await createBatchMapPromise(items, asyncFn)
```

### Memory Efficiency

- Results array is pre-allocated to input size
- Streaming support for large batches (future enhancement)
- Failed items leave `undefined` in results array when using `onError: 'continue'`

### Error Propagation

- Default behavior (`onError: 'fail'`): Throws first error encountered
- `onError: 'continue'`: Collects errors, continues processing
- `onError: 'retry'`: Retries failed items, then throws if still failing

## See Also

- [Pipeline/Promise Chaining](./PIPELINE.md) - For chaining RPC calls
- [RPC Client](./CLIENT.md) - Core RPC client documentation
- [Error Handling](./ERRORS.md) - Error types and handling strategies
