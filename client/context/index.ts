/**
 * $ Context Factory for SaasKit
 *
 * Creates a React context for the $ workflow context, allowing components
 * to access dotdo's workflow methods (send, try, do, on, every) and Nouns.
 */

import type { DollarContext } from '../hooks'

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for create$Context
 */
export interface Create$ContextConfig {
  /** Base URL for the dotdo backend */
  baseUrl: string
  /** Authentication configuration */
  auth?: {
    token?: string
    refreshToken?: string
  }
  /** Request timeout in ms */
  timeout?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
}

/**
 * Result of create$Context - a context with Provider and hook
 */
export interface $ContextResult {
  /** React Provider component */
  Provider: (props: { children: React.ReactNode }) => React.ReactElement
  /** Hook to access the $ context */
  use$: () => DollarContext
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Creates a $ context for use in React applications
 *
 * This factory creates a Provider component and a use$ hook that can be
 * used to access the $ context throughout your application.
 *
 * @param config - Configuration for the $ context
 * @returns Context with Provider component and use$ hook
 *
 * @example
 * ```tsx
 * // Create context at app level
 * const { Provider, use$ } = create$Context({
 *   baseUrl: 'https://api.example.com',
 *   auth: { token: 'user-token' },
 * })
 *
 * // Wrap your app
 * function App() {
 *   return (
 *     <Provider>
 *       <MyApp />
 *     </Provider>
 *   )
 * }
 *
 * // Use in components
 * function MyComponent() {
 *   const $ = use$()
 *   // Use $.send(), $.do(), $.try(), etc.
 * }
 * ```
 */
export function create$Context(config: Create$ContextConfig): $ContextResult {
  // Create the $ context instance
  const dollarContext: DollarContext = createDollarContext(config)

  // Create a simple Provider that provides the context
  // In a full implementation, this would use React.createContext
  const Provider = (props: { children: React.ReactNode }): React.ReactElement => {
    // For now, return children directly - in a full implementation
    // this would wrap with a React Context Provider
    return props.children as React.ReactElement
  }

  // Create the hook
  const use$ = (): DollarContext => {
    return dollarContext
  }

  return {
    Provider,
    use$,
  }
}

/**
 * Creates a DollarContext instance from configuration
 */
function createDollarContext(config: Create$ContextConfig): DollarContext {
  const { baseUrl, auth, timeout = 30000 } = config
  const fetchFn = config.fetch ?? globalThis.fetch

  // Build headers with auth
  const getHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (auth?.token) {
      headers['Authorization'] = `Bearer ${auth.token}`
    }
    return headers
  }

  // Make an RPC call
  const rpc = async <T>(method: string, params?: unknown): Promise<T> => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetchFn(`${baseUrl}/rpc`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ method, params }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`RPC error: ${response.statusText}`)
      }

      const data = await response.json()
      return data.result as T
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // Create the $ context
  const context: DollarContext = {
    send: (event: unknown) => {
      // Fire-and-forget - don't await
      rpc('send', { event }).catch(err => {
        console.error('$.send error:', err)
      })
    },

    try: async <T = unknown>(action: unknown): Promise<T> => {
      return rpc<T>('try', { action })
    },

    do: async <T = unknown>(action: unknown): Promise<T> => {
      return rpc<T>('do', { action })
    },

    on: new Proxy({}, {
      get: (_, noun: string) => {
        return new Proxy({}, {
          get: (_, verb: string) => {
            return (handler: unknown) => {
              // Register event handler
              rpc('on', { noun, verb, handler: String(handler) }).catch(err => {
                console.error(`$.on.${noun}.${verb} error:`, err)
              })
            }
          },
        })
      },
    }),

    every: new Proxy({}, {
      get: (_, schedule: string) => {
        return (handler: unknown) => {
          // Register scheduled handler
          rpc('every', { schedule, handler: String(handler) }).catch(err => {
            console.error(`$.every.${schedule} error:`, err)
          })
        }
      },
    }),
  }

  // Add Proxy for dynamic Noun access
  return new Proxy(context, {
    get: (target, prop: string) => {
      if (prop in target) {
        return target[prop as keyof typeof target]
      }

      // Dynamic Noun access: $.Customer(id).method()
      return (id?: string) => {
        return new Proxy({}, {
          get: (_, method: string) => {
            return async (...args: unknown[]) => {
              return rpc(`${prop}.${method}`, { id, args })
            }
          },
        })
      }
    },
  }) as DollarContext
}

// Re-export types
export type { DollarContext }
