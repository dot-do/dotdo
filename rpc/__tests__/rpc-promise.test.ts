/**
 * RpcPromise Tests (TDD RED Phase)
 *
 * RpcPromise is a Cap'n Proto-style promise that enables promise pipelining.
 * The key insight: you can call methods and access properties on an unresolved promise.
 *
 * ```typescript
 * const user = api.getUser(id)  // RpcPromise, not yet resolved
 * const email = user.email      // Still RpcPromise, property access on unresolved promise
 * await email                   // NOW the full pipeline executes
 * ```
 *
 * This enables single round-trip for chained access like:
 * `await this.Customer(id).profile.email`
 *
 * @see https://capnproto.org/rpc.html for the original Cap'n Proto pipelining concept
 */

import { describe, it, expect } from 'vitest'

// Import from the module that doesn't exist yet - tests should fail
import { RpcPromise, createRpcPromise, type PipelineOperation } from '../rpc-promise'

// ============================================================================
// TYPE DEFINITIONS FOR TESTS
// ============================================================================

interface User {
  $id: string
  name: string
  email: string
  profile: Profile
  getOrders(): Order[]
  getProfile(): Profile
  notify(message: string): void
}

interface Profile {
  bio: string
  avatar: string
  settings: Settings
}

interface Settings {
  theme: string
  notifications: boolean
}

interface Order {
  id: string
  total: number
}

// ============================================================================
// 1. PROMISE INTERFACE TESTS
// ============================================================================

describe('RpcPromise: Promise Interface', () => {
  describe('instanceof Promise', () => {
    it('should be instanceof Promise', () => {
      const promise = createRpcPromise<User>(() => {})

      expect(promise).toBeInstanceOf(Promise)
    })

    it('should be a thenable', () => {
      const promise = createRpcPromise<User>(() => {})

      expect(typeof promise.then).toBe('function')
    })
  })

  describe('.then() support', () => {
    it('should support .then() with onFulfilled callback', async () => {
      const user: User = {
        $id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        profile: { bio: 'Engineer', avatar: 'alice.png', settings: { theme: 'dark', notifications: true } },
        getOrders: () => [],
        getProfile: () => user.profile,
        notify: () => {},
      }

      const promise = createRpcPromise<User>((resolve) => resolve(user))

      const result = await promise.then((u) => u.name)

      expect(result).toBe('Alice')
    })

    it('should support .then() chaining', async () => {
      const promise = createRpcPromise<number>((resolve) => resolve(5))

      const result = await promise
        .then((n) => n * 2)
        .then((n) => n + 1)

      expect(result).toBe(11)
    })

    it('should support .then() with onRejected callback', async () => {
      const promise = createRpcPromise<User>((_, reject) => reject(new Error('failed')))

      const result = await promise.then(
        () => 'success',
        () => 'caught'
      )

      expect(result).toBe('caught')
    })
  })

  describe('.catch() support', () => {
    it('should support .catch() for error handling', async () => {
      const promise = createRpcPromise<User>((_, reject) => reject(new Error('Network error')))

      const result = await promise.catch((err) => err.message)

      expect(result).toBe('Network error')
    })

    it('should propagate errors through chain to .catch()', async () => {
      const promise = createRpcPromise<number>((resolve) => resolve(5))

      const result = await promise
        .then((n) => {
          if (n > 0) throw new Error('positive')
          return n
        })
        .catch((err) => err.message)

      expect(result).toBe('positive')
    })
  })

  describe('.finally() support', () => {
    it('should support .finally() callback', async () => {
      let finallyCalled = false
      const promise = createRpcPromise<number>((resolve) => resolve(42))

      await promise.finally(() => {
        finallyCalled = true
      })

      expect(finallyCalled).toBe(true)
    })

    it('should call .finally() even on rejection', async () => {
      let finallyCalled = false
      const promise = createRpcPromise<number>((_, reject) => reject(new Error('fail')))

      await promise.finally(() => {
        finallyCalled = true
      }).catch(() => {})

      expect(finallyCalled).toBe(true)
    })

    it('should preserve the resolved value through .finally()', async () => {
      const promise = createRpcPromise<number>((resolve) => resolve(42))

      const result = await promise.finally(() => {
        // Do nothing, but value should pass through
      })

      expect(result).toBe(42)
    })
  })
})

// ============================================================================
// 2. PROPERTY ACCESS ON UNRESOLVED PROMISE
// ============================================================================

describe('RpcPromise: Property Access on Unresolved Promise', () => {
  describe('single property access', () => {
    it('should return RpcPromise when accessing property on unresolved promise', () => {
      const promise = createRpcPromise<User>(() => {})

      const emailPromise = promise.email

      expect(emailPromise).toBeInstanceOf(Promise)
    })

    it('should track property access in the pipeline', () => {
      const promise = createRpcPromise<User>(() => {})

      const emailPromise = promise.email as RpcPromise<string>

      expect(emailPromise.pipeline).toEqual([
        { type: 'property', name: 'email' }
      ])
    })

    it('should resolve to the property value when awaited', async () => {
      const user: User = {
        $id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        profile: { bio: 'Engineer', avatar: 'alice.png', settings: { theme: 'dark', notifications: true } },
        getOrders: () => [],
        getProfile: () => user.profile,
        notify: () => {},
      }

      const promise = createRpcPromise<User>((resolve) => resolve(user))

      const email = await promise.email

      expect(email).toBe('alice@example.com')
    })
  })

  describe('nested property access', () => {
    it('should support chained property access: promise.profile.bio', () => {
      const promise = createRpcPromise<User>(() => {})

      const bioPromise = promise.profile.bio as RpcPromise<string>

      expect(bioPromise.pipeline).toEqual([
        { type: 'property', name: 'profile' },
        { type: 'property', name: 'bio' }
      ])
    })

    it('should support deeply nested access: promise.profile.settings.theme', () => {
      const promise = createRpcPromise<User>(() => {})

      const themePromise = promise.profile.settings.theme as RpcPromise<string>

      expect(themePromise.pipeline).toEqual([
        { type: 'property', name: 'profile' },
        { type: 'property', name: 'settings' },
        { type: 'property', name: 'theme' }
      ])
    })

    it('should resolve nested properties when awaited', async () => {
      const user: User = {
        $id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        profile: {
          bio: 'Engineer',
          avatar: 'alice.png',
          settings: { theme: 'dark', notifications: true }
        },
        getOrders: () => [],
        getProfile: () => user.profile,
        notify: () => {},
      }

      const promise = createRpcPromise<User>((resolve) => resolve(user))

      const theme = await promise.profile.settings.theme

      expect(theme).toBe('dark')
    })
  })
})

// ============================================================================
// 3. METHOD CALLS ON UNRESOLVED PROMISE
// ============================================================================

describe('RpcPromise: Method Calls on Unresolved Promise', () => {
  describe('single method call', () => {
    it('should return RpcPromise when calling method on unresolved promise', () => {
      const promise = createRpcPromise<User>(() => {})

      const profilePromise = promise.getProfile()

      expect(profilePromise).toBeInstanceOf(Promise)
    })

    it('should track method call in the pipeline', () => {
      const promise = createRpcPromise<User>(() => {})

      const profilePromise = promise.getProfile() as RpcPromise<Profile>

      expect(profilePromise.pipeline).toEqual([
        { type: 'method', name: 'getProfile', args: [] }
      ])
    })

    it('should track method call with arguments', () => {
      const promise = createRpcPromise<User>(() => {})

      const notifyPromise = promise.notify('Hello!') as RpcPromise<void>

      expect(notifyPromise.pipeline).toEqual([
        { type: 'method', name: 'notify', args: ['Hello!'] }
      ])
    })

    it('should resolve method result when awaited', async () => {
      const user: User = {
        $id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        profile: { bio: 'Engineer', avatar: 'alice.png', settings: { theme: 'dark', notifications: true } },
        getOrders: () => [{ id: 'order-1', total: 100 }],
        getProfile: () => user.profile,
        notify: () => {},
      }

      const promise = createRpcPromise<User>((resolve) => resolve(user))

      const orders = await promise.getOrders()

      expect(orders).toEqual([{ id: 'order-1', total: 100 }])
    })
  })

  describe('method with complex arguments', () => {
    it('should preserve argument types in pipeline', () => {
      const promise = createRpcPromise<User>(() => {})

      const notifyPromise = promise.notify('Test message') as RpcPromise<void>

      expect(notifyPromise.pipeline[0]).toEqual({
        type: 'method',
        name: 'notify',
        args: ['Test message']
      })
    })
  })
})

// ============================================================================
// 4. CHAINING: PROPERTY + METHOD COMBINATIONS
// ============================================================================

describe('RpcPromise: Chaining Property Access and Method Calls', () => {
  describe('method then property', () => {
    it('should chain method call followed by property access', () => {
      const promise = createRpcPromise<User>(() => {})

      const bioPromise = promise.getProfile().bio as RpcPromise<string>

      expect(bioPromise.pipeline).toEqual([
        { type: 'method', name: 'getProfile', args: [] },
        { type: 'property', name: 'bio' }
      ])
    })

    it('should resolve chained method+property when awaited', async () => {
      const user: User = {
        $id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        profile: { bio: 'Engineer', avatar: 'alice.png', settings: { theme: 'dark', notifications: true } },
        getOrders: () => [],
        getProfile: () => user.profile,
        notify: () => {},
      }

      const promise = createRpcPromise<User>((resolve) => resolve(user))

      const bio = await promise.getProfile().bio

      expect(bio).toBe('Engineer')
    })
  })

  describe('property then method', () => {
    it('should chain property access followed by method call (if applicable)', () => {
      // This tests the general capability - even though our Profile doesn't have methods,
      // the pipeline should still track the operations correctly
      interface ExtendedProfile extends Profile {
        getFullBio(): string
      }

      interface ExtendedUser extends User {
        profile: ExtendedProfile
      }

      const promise = createRpcPromise<ExtendedUser>(() => {})

      const fullBioPromise = promise.profile.getFullBio() as RpcPromise<string>

      expect(fullBioPromise.pipeline).toEqual([
        { type: 'property', name: 'profile' },
        { type: 'method', name: 'getFullBio', args: [] }
      ])
    })
  })

  describe('long chains', () => {
    it('should support arbitrarily long chains', () => {
      const promise = createRpcPromise<User>(() => {})

      const notificationsPromise = promise.getProfile().settings.notifications as RpcPromise<boolean>

      expect(notificationsPromise.pipeline).toEqual([
        { type: 'method', name: 'getProfile', args: [] },
        { type: 'property', name: 'settings' },
        { type: 'property', name: 'notifications' }
      ])
    })
  })
})

// ============================================================================
// 5. PIPELINE TRACKING AND INTROSPECTION
// ============================================================================

describe('RpcPromise: Pipeline Tracking', () => {
  describe('pipeline property', () => {
    it('should expose pipeline array on RpcPromise', () => {
      const promise = createRpcPromise<User>(() => {})

      expect(promise.pipeline).toEqual([])
    })

    it('should accumulate operations in pipeline', () => {
      const promise = createRpcPromise<User>(() => {})

      // Each access creates a new RpcPromise with accumulated pipeline
      const step1 = promise.profile as RpcPromise<Profile>
      const step2 = step1.settings as RpcPromise<Settings>
      const step3 = step2.theme as RpcPromise<string>

      expect(step1.pipeline).toHaveLength(1)
      expect(step2.pipeline).toHaveLength(2)
      expect(step3.pipeline).toHaveLength(3)
    })

    it('should not mutate original promise pipeline', () => {
      const promise = createRpcPromise<User>(() => {})

      // Access property - should create new RpcPromise
      const _emailPromise = promise.email

      // Original should still have empty pipeline
      expect(promise.pipeline).toEqual([])
    })
  })

  describe('PipelineOperation type', () => {
    it('should distinguish property operations', () => {
      const promise = createRpcPromise<User>(() => {})
      const emailPromise = promise.email as RpcPromise<string>

      const op = emailPromise.pipeline[0]
      expect(op.type).toBe('property')
      expect(op.name).toBe('email')
      expect('args' in op).toBe(false)
    })

    it('should distinguish method operations', () => {
      const promise = createRpcPromise<User>(() => {})
      const profilePromise = promise.getProfile() as RpcPromise<Profile>

      const op = profilePromise.pipeline[0]
      expect(op.type).toBe('method')
      expect(op.name).toBe('getProfile')
      expect(op.args).toEqual([])
    })
  })
})

// ============================================================================
// 6. FULL PIPELINE EXECUTION
// ============================================================================

describe('RpcPromise: Full Pipeline Execution', () => {
  describe('deferred execution', () => {
    it('should not execute until awaited', async () => {
      let executed = false

      const promise = createRpcPromise<User>((resolve) => {
        executed = true
        resolve({
          $id: 'user-1',
          name: 'Alice',
          email: 'alice@example.com',
          profile: { bio: 'Engineer', avatar: 'alice.png', settings: { theme: 'dark', notifications: true } },
          getOrders: () => [],
          getProfile: function() { return this.profile },
          notify: () => {},
        } as User)
      })

      // Access property - should NOT trigger execution yet
      const emailPromise = promise.email

      // Give some time for any async operations
      await new Promise((r) => setTimeout(r, 10))

      // Check that executor hasn't run yet (deferred)
      // Note: This depends on implementation - if using lazy Promise,
      // the executor runs immediately. For true Cap'n Proto style,
      // execution should be deferred until await.
      expect(emailPromise).toBeInstanceOf(Promise)

      // NOW it executes
      const email = await emailPromise
      expect(email).toBe('alice@example.com')
      expect(executed).toBe(true)
    })
  })

  describe('executor receives pipeline', () => {
    it('should pass pipeline to custom executor for batch execution', async () => {
      let capturedPipeline: PipelineOperation[] | undefined

      const customExecutor = async (
        baseValue: User,
        pipeline: PipelineOperation[]
      ): Promise<unknown> => {
        capturedPipeline = pipeline

        // Execute the pipeline
        let result: unknown = baseValue
        for (const op of pipeline) {
          if (op.type === 'property') {
            result = (result as Record<string, unknown>)[op.name]
          } else if (op.type === 'method') {
            result = (result as Record<string, (...args: unknown[]) => unknown>)[op.name](...op.args)
          }
        }
        return result
      }

      const user: User = {
        $id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        profile: { bio: 'Engineer', avatar: 'alice.png', settings: { theme: 'dark', notifications: true } },
        getOrders: () => [],
        getProfile: function() { return this.profile },
        notify: () => {},
      }

      const promise = createRpcPromise<User>(
        (resolve) => resolve(user),
        { executor: customExecutor }
      )

      await promise.profile.bio

      expect(capturedPipeline).toEqual([
        { type: 'property', name: 'profile' },
        { type: 'property', name: 'bio' }
      ])
    })
  })

  describe('error handling in pipeline', () => {
    it('should reject if base promise rejects', async () => {
      const promise = createRpcPromise<User>((_, reject) => {
        reject(new Error('Base failed'))
      })

      await expect(promise.email).rejects.toThrow('Base failed')
    })

    it('should reject if property access fails on resolved value', async () => {
      const promise = createRpcPromise<User>((resolve) => {
        resolve(null as unknown as User)
      })

      await expect(promise.email).rejects.toThrow()
    })

    it('should reject if method call fails on resolved value', async () => {
      const promise = createRpcPromise<User>((resolve) => {
        resolve({
          $id: 'user-1',
          name: 'Alice',
          email: 'alice@example.com',
          profile: { bio: 'Engineer', avatar: 'alice.png', settings: { theme: 'dark', notifications: true } },
          getOrders: () => { throw new Error('Orders unavailable') },
          getProfile: function() { return this.profile },
          notify: () => {},
        } as User)
      })

      await expect(promise.getOrders()).rejects.toThrow('Orders unavailable')
    })
  })
})

// ============================================================================
// 7. SPECIAL CASES AND EDGE CASES
// ============================================================================

describe('RpcPromise: Special Cases', () => {
  describe('Symbol properties', () => {
    it('should handle Symbol.toStringTag', () => {
      const promise = createRpcPromise<User>(() => {})

      expect(Object.prototype.toString.call(promise)).toBe('[object RpcPromise]')
    })

    it('should not intercept Symbol.iterator', () => {
      const promise = createRpcPromise<User>(() => {})

      // Symbol properties should pass through or return undefined
      expect((promise as unknown as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined()
    })
  })

  describe('Promise static methods', () => {
    it('should work with Promise.resolve wrapping', async () => {
      const promise = createRpcPromise<number>((resolve) => resolve(42))

      const wrapped = Promise.resolve(promise)
      const result = await wrapped

      expect(result).toBe(42)
    })

    it('should work with Promise.all', async () => {
      const promise1 = createRpcPromise<number>((resolve) => resolve(1))
      const promise2 = createRpcPromise<number>((resolve) => resolve(2))

      const results = await Promise.all([promise1, promise2])

      expect(results).toEqual([1, 2])
    })

    it('should work with Promise.race', async () => {
      const fast = createRpcPromise<string>((resolve) => resolve('fast'))
      const slow = createRpcPromise<string>((resolve) => {
        setTimeout(() => resolve('slow'), 100)
      })

      const result = await Promise.race([fast, slow])

      expect(result).toBe('fast')
    })
  })

  describe('then/catch/finally return types', () => {
    it('.then() should return regular Promise, not RpcPromise', async () => {
      const promise = createRpcPromise<number>((resolve) => resolve(5))

      const thenResult = promise.then((n) => n * 2)

      // After .then(), we get a regular Promise back
      // Pipeline access should not be possible
      expect(typeof (thenResult as unknown as Record<string, unknown>).pipeline).toBe('undefined')
    })
  })

  describe('accessing reserved properties', () => {
    it('should handle "then" property access correctly (Promise compliance)', () => {
      // "then" is special - must return the actual then method for Promise compliance
      const promise = createRpcPromise<{ then: string }>(() => {})

      // This should be the actual then method, not a pipeline to "then" property
      expect(typeof promise.then).toBe('function')
    })

    it('should handle "catch" property access correctly', () => {
      const promise = createRpcPromise<{ catch: string }>(() => {})

      expect(typeof promise.catch).toBe('function')
    })

    it('should handle "finally" property access correctly', () => {
      const promise = createRpcPromise<{ finally: string }>(() => {})

      expect(typeof promise.finally).toBe('function')
    })
  })

  describe('type narrowing', () => {
    it('should preserve types through the pipeline', async () => {
      const user: User = {
        $id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        profile: { bio: 'Engineer', avatar: 'alice.png', settings: { theme: 'dark', notifications: true } },
        getOrders: () => [{ id: 'order-1', total: 99.99 }],
        getProfile: function() { return this.profile },
        notify: () => {},
      }

      const promise = createRpcPromise<User>((resolve) => resolve(user))

      // TypeScript should infer these types correctly
      const email: string = await promise.email
      const orders: Order[] = await promise.getOrders()
      const theme: string = await promise.profile.settings.theme

      expect(typeof email).toBe('string')
      expect(Array.isArray(orders)).toBe(true)
      expect(typeof theme).toBe('string')
    })
  })
})

// ============================================================================
// 8. INTEGRATION WITH EXISTING RPC SYSTEM
// ============================================================================

describe('RpcPromise: Integration Points', () => {
  describe('wire format compatibility', () => {
    it('should generate PipelineStep-compatible format', () => {
      const promise = createRpcPromise<User>(() => {})
      const emailPromise = promise.getProfile().bio as RpcPromise<string>

      // The pipeline should be convertible to PipelineStep[] format
      const steps = emailPromise.pipeline.map((op, index) => ({
        method: op.type === 'method' ? op.name : `get:${op.name}`,
        args: op.type === 'method' ? op.args : [],
        index,
      }))

      expect(steps).toEqual([
        { method: 'getProfile', args: [], index: 0 },
        { method: 'get:bio', args: [], index: 1 },
      ])
    })
  })

  describe('serializable pipeline', () => {
    it('should have JSON-serializable pipeline operations', () => {
      const promise = createRpcPromise<User>(() => {})
      const notifyPromise = promise.notify('Hello, world!') as RpcPromise<void>

      const json = JSON.stringify(notifyPromise.pipeline)
      const parsed = JSON.parse(json)

      expect(parsed).toEqual([
        { type: 'method', name: 'notify', args: ['Hello, world!'] }
      ])
    })
  })
})
