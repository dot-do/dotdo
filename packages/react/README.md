# @dotdo/react

React bindings for dotdo Durable Objects with real-time data synchronization.

## Installation

```bash
npm install @dotdo/react @dotdo/client
# or
pnpm add @dotdo/react @dotdo/client
```

**Peer dependencies:** `react >=18.0.0`, `zod >=3.0.0` (optional, for schema validation)

## Quick Start

Wrap your app with the DO provider and use hooks to access real-time data:

```tsx
import { DOProvider, useCollection } from '@dotdo/react'

function App() {
  return (
    <DOProvider url="wss://api.example.com.ai/ws">
      <TaskList />
    </DOProvider>
  )
}

function TaskList() {
  const { data: tasks, create, update } = useCollection('tasks')

  return (
    <ul>
      {tasks.map(task => (
        <li key={task.id} onClick={() => update(task.id, { done: !task.done })}>
          {task.title}
        </li>
      ))}
      <button onClick={() => create({ title: 'New task', done: false })}>
        Add Task
      </button>
    </ul>
  )
}
```

## API Reference

### Hooks

| Hook | Description |
|------|-------------|
| `useCollection(name)` | Subscribe to a collection with CRUD operations and optimistic updates |
| `useRecord(collection, id)` | Subscribe to a single record by ID |
| `useLiveQuery(query)` | Execute a live query with automatic re-subscription on changes |
| `useDO(namespace?)` | Access the underlying Durable Object client |
| `use$()` | Access the workflow context for event handling and scheduling |
| `useConnectionState()` | Monitor WebSocket connection status |

### useCollection

```tsx
const { data, create, update, remove, loading, error } = useCollection('users')
```

Returns real-time data with optimistic updates. Mutations are applied immediately and rolled back on failure.

### useRecord

```tsx
const { data: user, update, remove, loading } = useRecord('users', userId)
```

Subscribe to a single record. Returns `null` if the record doesn't exist.

### useLiveQuery

```tsx
const { data, refetch } = useLiveQuery({
  collection: 'orders',
  where: { status: 'pending' },
  orderBy: { createdAt: 'desc' },
  limit: 10
})
```

### useConnectionState

```tsx
const { connected, reconnecting, error } = useConnectionState()
```

## Entry Points

| Entry Point | Description |
|-------------|-------------|
| `@dotdo/react` | Main entry with DOProvider and all hooks |
| `@dotdo/react/hooks` | Hooks only (for custom provider setups) |
| `@dotdo/react/tanstack` | TanStack DB integration with `CollectionOptions` factory |
| `@dotdo/react/admin` | Admin data provider (React Admin-inspired pattern) |

### TanStack DB Integration

```tsx
import { CollectionOptions } from '@dotdo/react/tanstack'

const usersCollection = CollectionOptions('users', {
  schema: userSchema, // optional zod schema
})
```

### Admin Data Provider

```tsx
import { createDataProvider } from '@dotdo/react/admin'

const dataProvider = createDataProvider({
  url: 'wss://api.example.com.ai/ws',
})
```

## Related Packages

- [@dotdo/client](../client) - Core client library
- [@dotdo/zod](../zod) - Zod schema utilities
- [dotdo](https://github.com/dotdo/dotdo) - Main framework

## License

MIT
