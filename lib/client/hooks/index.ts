/**
 * Client Hooks
 *
 * React hooks for interacting with dotdo backends.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Dollar ($) context with workflow methods
 */
export interface DollarContext {
  /** Fire-and-forget event dispatch */
  send: (event: unknown) => void
  /** Try action once */
  try: <T = unknown>(action: unknown) => Promise<T>
  /** Durable action with retries */
  do: <T = unknown>(action: unknown) => Promise<T>
  /** Event handlers */
  on: Record<string, unknown>
  /** Scheduling */
  every: Record<string, unknown>
  /** Access Nouns */
  [noun: string]: unknown
}

/**
 * Runtime type marker for DollarContext (for runtime type checking in tests)
 * This is a symbol that can be used to identify DollarContext objects at runtime.
 */
export const DollarContext = Symbol.for('dotdo.DollarContext')

/**
 * Collection hook result type
 */
export interface CollectionHookResult<T> {
  data: T[] | undefined
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

/**
 * Sync form configuration
 */
export interface SyncFormConfig {
  collection: string
  id: string
}

/**
 * Sync form result type
 */
export interface SyncFormResult<T> {
  values: T
  setValue: <K extends keyof T>(key: K, value: T[K]) => void
  submit: () => Promise<void>
  isDirty: boolean
  isSaving: boolean
  error: Error | null
}

/**
 * Sync table configuration
 */
export interface SyncTableConfig {
  collection: string
  pageSize?: number
}

/**
 * Sync table result type
 */
export interface SyncTableResult<T> {
  rows: T[]
  page: number
  pageSize: number
  total: number
  isLoading: boolean
  error: Error | null
  nextPage: () => void
  prevPage: () => void
  setPage: (page: number) => void
  refresh: () => void
}

// =============================================================================
// $ Context Singleton
// =============================================================================

// This would normally be populated by a provider
let globalDollarContext: DollarContext | null = null

/**
 * Set the global $ context (typically called by Provider)
 */
export function setGlobalDollarContext(ctx: DollarContext): void {
  globalDollarContext = ctx
}

/**
 * Create a mock/stub $ context for when no provider is present
 */
function createStubDollarContext(): DollarContext {
  const stub = {
    send: () => {
      console.warn('use$ called without Provider - send() is a no-op')
    },
    try: async () => {
      console.warn('use$ called without Provider - try() returns undefined')
      return undefined as never
    },
    do: async () => {
      console.warn('use$ called without Provider - do() returns undefined')
      return undefined as never
    },
    on: new Proxy({}, {
      get: () => () => {
        console.warn('use$ called without Provider - on handlers are no-ops')
      },
    }),
    every: new Proxy({}, {
      get: () => () => {
        console.warn('use$ called without Provider - every handlers are no-ops')
      },
    }),
  }

  // Proxy to handle dynamic Noun access
  return new Proxy(stub, {
    get(target, prop) {
      if (prop in target) {
        return target[prop as keyof typeof target]
      }
      // Return a stub for dynamic Noun access
      return () => {
        console.warn(`use$ called without Provider - ${String(prop)}() is a no-op`)
        return Promise.resolve(undefined)
      }
    },
  }) as DollarContext
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to access the $ context with workflow methods
 *
 * @returns DollarContext with send, try, do, on, every, and Noun accessors
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const $ = use$()
 *
 *   const handleClick = () => {
 *     $.send({ type: 'button.clicked' })
 *   }
 *
 *   return <button onClick={handleClick}>Click me</button>
 * }
 * ```
 */
export function use$(): DollarContext {
  // Return global context if available, otherwise return stub
  return globalDollarContext ?? createStubDollarContext()
}

/**
 * Alias for use$ hook
 */
export const useDollar = use$

/**
 * Hook to access a collection of items with real-time sync
 *
 * @param collection - Name of the collection to access
 * @returns CollectionHookResult with data, loading state, and error
 *
 * @example
 * ```tsx
 * function UserList() {
 *   const { data: users, isLoading, error } = useCollection<User>('users')
 *
 *   if (isLoading) return <div>Loading...</div>
 *   if (error) return <div>Error: {error.message}</div>
 *
 *   return (
 *     <ul>
 *       {users?.map(user => <li key={user.id}>{user.name}</li>)}
 *     </ul>
 *   )
 * }
 * ```
 */
export function useCollection<T>(collection: string): CollectionHookResult<T> {
  // Stub implementation - real implementation would use TanStack Query or similar
  return {
    data: undefined,
    isLoading: false,
    error: null,
    refetch: () => {
      console.warn(`useCollection('${collection}') - refetch() called but no provider present`)
    },
  }
}

/**
 * Hook for synced form state with auto-save
 *
 * @param config - Form configuration with collection and id
 * @returns Form state with values, setters, and submit function
 *
 * @example
 * ```tsx
 * function UserForm({ userId }: { userId: string }) {
 *   const form = useSyncForm<User>({ collection: 'users', id: userId })
 *
 *   return (
 *     <form onSubmit={e => { e.preventDefault(); form.submit(); }}>
 *       <input
 *         value={form.values.name}
 *         onChange={e => form.setValue('name', e.target.value)}
 *       />
 *       <button disabled={form.isSaving}>
 *         {form.isSaving ? 'Saving...' : 'Save'}
 *       </button>
 *     </form>
 *   )
 * }
 * ```
 */
export function useSyncForm<T extends Record<string, unknown>>(
  config: SyncFormConfig
): SyncFormResult<T> {
  // Stub implementation
  return {
    values: {} as T,
    setValue: () => {
      console.warn(`useSyncForm('${config.collection}', '${config.id}') - setValue() called but no provider present`)
    },
    submit: async () => {
      console.warn(`useSyncForm('${config.collection}', '${config.id}') - submit() called but no provider present`)
    },
    isDirty: false,
    isSaving: false,
    error: null,
  }
}

/**
 * Hook for synced table with pagination
 *
 * @param config - Table configuration with collection name
 * @returns Table state with rows, pagination, and controls
 *
 * @example
 * ```tsx
 * function UserTable() {
 *   const table = useSyncTable<User>({ collection: 'users' })
 *
 *   return (
 *     <div>
 *       <table>
 *         <tbody>
 *           {table.rows.map(user => (
 *             <tr key={user.id}>
 *               <td>{user.name}</td>
 *               <td>{user.email}</td>
 *             </tr>
 *           ))}
 *         </tbody>
 *       </table>
 *       <div>
 *         Page {table.page} of {Math.ceil(table.total / table.pageSize)}
 *         <button onClick={table.prevPage}>Prev</button>
 *         <button onClick={table.nextPage}>Next</button>
 *       </div>
 *     </div>
 *   )
 * }
 * ```
 */
export function useSyncTable<T>(config: SyncTableConfig): SyncTableResult<T> {
  // Stub implementation
  return {
    rows: [],
    page: 1,
    pageSize: config.pageSize ?? 10,
    total: 0,
    isLoading: false,
    error: null,
    nextPage: () => {
      console.warn(`useSyncTable('${config.collection}') - nextPage() called but no provider present`)
    },
    prevPage: () => {
      console.warn(`useSyncTable('${config.collection}') - prevPage() called but no provider present`)
    },
    setPage: () => {
      console.warn(`useSyncTable('${config.collection}') - setPage() called but no provider present`)
    },
    refresh: () => {
      console.warn(`useSyncTable('${config.collection}') - refresh() called but no provider present`)
    },
  }
}
