# @dotdo/app Data Layer

Dual-mode data fetching abstraction with REST and TanStack DB (WebSocket) support.

## Features

- **Dual-Mode Operation**: Switch between REST and real-time WebSocket sync
- **Optimistic Updates**: Instant UI updates with background persistence
- **Client-Side Caching**: Intelligent cache management and invalidation
- **TanStack Query Integration**: Ready-to-use query hooks and helpers
- **Automatic Fallback**: Graceful degradation from WebSocket to REST on failure
- **Type-Safe**: Full TypeScript support with type inference

## Usage

### Basic REST Client

```typescript
import { createDataClient } from './data'

const client = createDataClient({
  mode: 'rest',
  baseUrl: 'https://api.example.com',
})

// CRUD operations
const customer = await client.get('customers', '123')
const customers = await client.list('customers')
const newCustomer = await client.create('customers', { name: 'Alice' })
const updated = await client.update('customers', '123', { name: 'Bob' })
await client.delete('customers', '123')
```

### WebSocket Real-Time Sync

```typescript
const client = createDataClient({
  mode: 'tanstack-db',
  baseUrl: 'wss://api.example.com',
})

// Subscribe to real-time updates
const unsubscribe = client.onUpdate((update) => {
  console.log('Real-time update:', update)
  // { type: 'broadcast', resource: 'customers', id: '123', data: {...} }
})

// All CRUD operations sync in real-time
const customer = await client.create('customers', { name: 'Charlie' })
// Automatically broadcasts to all connected clients
```

### Optimistic Updates

```typescript
const client = createDataClient({
  mode: 'rest',
  baseUrl: 'https://api.example.com',
  optimistic: true,
})

// Returns immediately with optimistic ID
const customer = await client.create('customers', { name: 'Dave' })
console.log(customer.$id) // 'optimistic-1'

// Background request completes and notifies listeners
client.onUpdate((update) => {
  console.log('Real data received:', update.data.$id) // '456'
})
```

### Client-Side Caching

```typescript
const client = createDataClient({
  mode: 'rest',
  baseUrl: 'https://api.example.com',
  cache: true,
})

// First call hits the API
const customer1 = await client.get('customers', '123')

// Second call returns cached data
const customer2 = await client.get('customers', '123')

// Manually invalidate cache
client.invalidateCache('customers', '123')

// Cache automatically invalidated on updates
await client.update('customers', '123', { name: 'Updated' })
const customer3 = await client.get('customers', '123') // Fresh data
```

### Mode Switching

```typescript
const client = createDataClient({
  mode: 'rest',
  baseUrl: 'https://api.example.com',
})

// Switch to WebSocket mode at runtime
client.setMode('tanstack-db')

// Switch back to REST
client.setMode('rest')
```

## TanStack Query Integration

```typescript
import { createQueryFunctions, createQueryClientConfig } from './data/query'
import { QueryClient, QueryClientProvider, useQuery, useMutation } from '@tanstack/react-query'

const client = createDataClient({
  mode: 'rest',
  baseUrl: 'https://api.example.com',
})

const queryFunctions = createQueryFunctions(client)
const queryClient = new QueryClient(createQueryClientConfig(client))

function CustomerList() {
  const { data, isLoading } = useQuery(
    queryFunctions.useListQuery('customers')
  )

  return (
    <div>
      {isLoading ? 'Loading...' : data.map(c => <div key={c.$id}>{c.name}</div>)}
    </div>
  )
}

function CustomerForm() {
  const { mutate } = useMutation(
    queryFunctions.useCreateMutation('customers', {
      onSuccess: (data) => {
        console.log('Customer created:', data)
      },
    })
  )

  return (
    <button onClick={() => mutate({ name: 'New Customer' })}>
      Create Customer
    </button>
  )
}
```

## API Reference

### DataClient

#### Methods

- `get(resource: string, id: string): Promise<Thing>`
- `list(resource: string, query?: Record<string, any>): Promise<Thing[]>`
- `create(resource: string, data: Record<string, any>): Promise<Thing>`
- `update(resource: string, id: string, data: Record<string, any>): Promise<Thing>`
- `delete(resource: string, id: string): Promise<void>`
- `onUpdate(listener: UpdateListener): () => void` - Returns unsubscribe function
- `getMode(): DataMode` - Returns current mode ('rest' or 'tanstack-db')
- `setMode(mode: DataMode): void` - Switch modes at runtime
- `disconnect(): void` - Close WebSocket connection
- `invalidateCache(resource: string, id?: string): void` - Clear cache entries

### Options

```typescript
interface DataClientOptions {
  mode: 'rest' | 'tanstack-db'
  baseUrl: string
  timeout?: number // Default: 30000ms
  optimistic?: boolean // Default: false
  cache?: boolean // Default: false
  token?: string // Authentication token
}
```

## Architecture

### REST Mode

```
Client → fetch → API → Response → Cache (optional)
```

### TanStack DB Mode

```
Client → WebSocket → Server
   ↓
Real-time broadcasts to all connected clients
```

### Fallback Behavior

When WebSocket fails to connect or disconnects:
```
WebSocket (failed) → Automatic fallback to REST → Reconnection attempts
```

## Testing

All features are thoroughly tested with 19 test cases covering:
- REST operations (GET, POST, PUT, DELETE, LIST)
- WebSocket connection and sync
- Real-time broadcasts
- Optimistic updates
- Cache management
- Mode switching
- Error handling and fallbacks

Run tests:
```bash
npm test app/tests/data.test.ts
```

## See Also

- [TanStack Query Documentation](https://tanstack.com/query)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [@dotdo/rpc](/rpc) - RPC client used for REST fallback
