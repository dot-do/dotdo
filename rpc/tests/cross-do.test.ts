import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { createCrossDOClient, CrossDOStubCache, CrossDOContext } from '../cross-do'

// Test DO classes
class CustomerDO {
  private balance = 1000

  async getBalance(): Promise<number> {
    return this.balance
  }

  async charge(amount: number): Promise<boolean> {
    if (this.balance >= amount) {
      this.balance -= amount
      return true
    }
    return false
  }

  async notify(message: string): Promise<{ success: boolean; message: string }> {
    return { success: true, message }
  }

  async getPaymentMethods(): Promise<Array<{ id: string; active: boolean }>> {
    return [
      { id: 'card-1', active: true },
      { id: 'card-2', active: false },
      { id: 'card-3', active: true },
    ]
  }
}

class OrderDO {
  private status = 'pending'
  private customerId = 'customer-456'

  async getStatus(): Promise<string> {
    return this.status
  }

  async getCustomerId(): Promise<string> {
    return this.customerId
  }

  // Cross-DO call example
  async getCustomerBalance(env: { DO: DurableObjectNamespace }): Promise<number> {
    const customer = createCrossDOClient<CustomerDO>(env.DO, this.customerId)
    return customer.getBalance()
  }
}

describe('Cross-DO RPC', () => {
  describe('createCrossDOClient', () => {
    it('should create a typed proxy for cross-DO calls', () => {
      interface TestDO {
        getValue(): Promise<number>
        setValue(value: number): Promise<void>
      }

      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async () => new Response(JSON.stringify(42))
        })
      } as unknown as DurableObjectNamespace

      const client = createCrossDOClient<TestDO>(mockBinding, 'test-do')

      expect(client).toBeDefined()
      expect(typeof client.getValue).toBe('function')
      expect(typeof client.setValue).toBe('function')
    })

    it('should call methods on another DO', async () => {
      interface TestDO {
        getBalance(): Promise<number>
      }

      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async (url: string, options: RequestInit) => {
            const body = JSON.parse(options.body as string)
            expect(body.method).toBe('getBalance')
            return new Response(JSON.stringify(1000), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          }
        })
      } as unknown as DurableObjectNamespace

      const client = createCrossDOClient<TestDO>(mockBinding, 'customer-123')
      const balance = await client.getBalance()

      expect(balance).toBe(1000)
    })

    it('should pass arguments to remote DO methods', async () => {
      interface TestDO {
        charge(amount: number): Promise<boolean>
      }

      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async (url: string, options: RequestInit) => {
            const body = JSON.parse(options.body as string)
            expect(body.method).toBe('charge')
            expect(body.args).toEqual([100])
            return new Response(JSON.stringify(true), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          }
        })
      } as unknown as DurableObjectNamespace

      const client = createCrossDOClient<TestDO>(mockBinding, 'customer-123')
      const charged = await client.charge(100)

      expect(charged).toBe(true)
    })

    it('should support DurableObjectId directly', async () => {
      interface TestDO {
        ping(): Promise<string>
      }

      // Mock ID with all required properties for the enhanced type guard:
      // - equals method
      // - toString method that returns a non-empty string
      // - name property (present on all real DurableObjectIds)
      const mockId = {
        toString: () => 'direct-id',
        equals: () => false,
        name: 'test-do-name'  // Required by enhanced type guard
      } as DurableObjectId
      let idFromNameCalled = false

      const mockBinding = {
        idFromName: () => {
          idFromNameCalled = true
          return mockId
        },
        get: () => ({
          fetch: async () => new Response(JSON.stringify('pong'))
        })
      } as unknown as DurableObjectNamespace

      const client = createCrossDOClient<TestDO>(mockBinding, mockId)
      const result = await client.ping()

      expect(result).toBe('pong')
      expect(idFromNameCalled).toBe(false) // Should NOT call idFromName
    })

    it('should throw on DO RPC error', async () => {
      interface TestDO {
        fail(): Promise<void>
      }

      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async () => new Response(JSON.stringify({ error: 'Internal error' }), {
            status: 500
          })
        })
      } as unknown as DurableObjectNamespace

      const client = createCrossDOClient<TestDO>(mockBinding, 'test-do')

      await expect(client.fail()).rejects.toThrow('Cross-DO RPC error: 500')
    })
  })

  describe('CrossDOStubCache', () => {
    it('should cache DO stubs by namespace and id', () => {
      const cache = new CrossDOStubCache()

      const mockBinding = {
        idFromName: (name: string) => ({ toString: () => name }),
        get: (id: DurableObjectId) => ({ id, fetch: async () => new Response() })
      } as unknown as DurableObjectNamespace

      const stub1 = cache.getStub(mockBinding, 'customer-1')
      const stub2 = cache.getStub(mockBinding, 'customer-1')
      const stub3 = cache.getStub(mockBinding, 'customer-2')

      // Same namespace and id should return cached stub
      expect(stub1).toBe(stub2)
      // Different id should return different stub
      expect(stub1).not.toBe(stub3)
    })

    it('should handle DurableObjectId in cache key', () => {
      const cache = new CrossDOStubCache()

      const mockId = { toString: () => 'mock-id' } as DurableObjectId
      const mockBinding = {
        idFromName: () => mockId,
        get: (id: DurableObjectId) => ({ id, fetch: async () => new Response() })
      } as unknown as DurableObjectNamespace

      const stub1 = cache.getStub(mockBinding, mockId)
      const stub2 = cache.getStub(mockBinding, mockId)

      expect(stub1).toBe(stub2)
    })

    it('should clear cache', () => {
      const cache = new CrossDOStubCache()

      const mockBinding = {
        idFromName: (name: string) => ({ toString: () => name }),
        get: (id: DurableObjectId) => ({ id, fetch: async () => new Response() })
      } as unknown as DurableObjectNamespace

      const stub1 = cache.getStub(mockBinding, 'customer-1')
      cache.clear()
      const stub2 = cache.getStub(mockBinding, 'customer-1')

      // After clear, should get a new stub
      expect(stub1).not.toBe(stub2)
    })

    it('should evict stubs by namespace', () => {
      const cache = new CrossDOStubCache()

      const mockBinding1 = {
        idFromName: (name: string) => ({ toString: () => name }),
        get: (id: DurableObjectId) => ({ id, namespace: 'ns1', fetch: async () => new Response() })
      } as unknown as DurableObjectNamespace

      const mockBinding2 = {
        idFromName: (name: string) => ({ toString: () => name }),
        get: (id: DurableObjectId) => ({ id, namespace: 'ns2', fetch: async () => new Response() })
      } as unknown as DurableObjectNamespace

      const stub1 = cache.getStub(mockBinding1, 'do-1')
      const stub2 = cache.getStub(mockBinding2, 'do-1')

      cache.evictNamespace(mockBinding1)

      const stub1New = cache.getStub(mockBinding1, 'do-1')
      const stub2Same = cache.getStub(mockBinding2, 'do-1')

      // Namespace 1 should be evicted
      expect(stub1).not.toBe(stub1New)
      // Namespace 2 should remain cached
      expect(stub2).toBe(stub2Same)
    })
  })

  describe('CrossDOContext ($)', () => {
    it('should provide $ context for cross-DO calls', async () => {
      interface CustomerDO {
        getBalance(): Promise<number>
      }

      interface OrderDO {
        getStatus(): Promise<string>
      }

      const mockEnv = {
        Customer: {
          idFromName: () => ({ toString: () => 'customer-id' }),
          get: () => ({
            fetch: async () => new Response(JSON.stringify(1000))
          })
        } as unknown as DurableObjectNamespace,
        Order: {
          idFromName: () => ({ toString: () => 'order-id' }),
          get: () => ({
            fetch: async () => new Response(JSON.stringify('pending'))
          })
        } as unknown as DurableObjectNamespace
      }

      const $ = new CrossDOContext(mockEnv)

      const balance = await $.Customer<CustomerDO>('customer-456').getBalance()
      const status = await $.Order<OrderDO>('order-123').getStatus()

      expect(balance).toBe(1000)
      expect(status).toBe('pending')
    })

    it('should support broadcast to multiple DOs', async () => {
      interface CustomerDO {
        notify(message: string): Promise<{ success: boolean }>
      }

      const mockEnv = {
        Customer: {
          idFromName: (name: string) => ({ toString: () => name }),
          get: () => ({
            fetch: async () => new Response(JSON.stringify({ success: true }))
          })
        } as unknown as DurableObjectNamespace
      }

      const $ = new CrossDOContext(mockEnv)

      const results = await $.Customer<CustomerDO>().broadcast(
        ['c1', 'c2', 'c3'],
        'notify',
        'Your order shipped!'
      )

      expect(results).toHaveLength(3)
      expect(results.every(r => r.success)).toBe(true)
    })

    it('should cache stubs internally', async () => {
      interface TestDO {
        getValue(): Promise<number>
      }

      let stubCreationCount = 0

      const mockEnv = {
        Test: {
          idFromName: () => ({ toString: () => 'test-id' }),
          get: () => {
            stubCreationCount++
            return {
              fetch: async () => new Response(JSON.stringify(42))
            }
          }
        } as unknown as DurableObjectNamespace
      }

      const $ = new CrossDOContext(mockEnv)

      await $.Test<TestDO>('test-1').getValue()
      await $.Test<TestDO>('test-1').getValue()
      await $.Test<TestDO>('test-1').getValue()

      // Should only create stub once due to caching
      expect(stubCreationCount).toBe(1)
    })
  })

  describe('Namespace routing', () => {
    it('should route based on namespace ($.Customer(id).method())', async () => {
      interface CustomerDO {
        getName(): Promise<string>
      }

      const mockEnv = {
        Customer: {
          idFromName: (name: string) => ({ toString: () => name }),
          get: () => ({
            fetch: async (url: string, options: RequestInit) => {
              const body = JSON.parse(options.body as string)
              return new Response(JSON.stringify('Alice'))
            }
          })
        } as unknown as DurableObjectNamespace
      }

      const $ = new CrossDOContext(mockEnv)
      const name = await $.Customer<CustomerDO>('customer-123').getName()

      expect(name).toBe('Alice')
    })

    it('should support multiple namespaces', async () => {
      const mockEnv = {
        Customer: {
          idFromName: () => ({ toString: () => 'customer-id' }),
          get: () => ({
            fetch: async () => new Response(JSON.stringify({ type: 'customer' }))
          })
        } as unknown as DurableObjectNamespace,
        Order: {
          idFromName: () => ({ toString: () => 'order-id' }),
          get: () => ({
            fetch: async () => new Response(JSON.stringify({ type: 'order' }))
          })
        } as unknown as DurableObjectNamespace,
        Product: {
          idFromName: () => ({ toString: () => 'product-id' }),
          get: () => ({
            fetch: async () => new Response(JSON.stringify({ type: 'product' }))
          })
        } as unknown as DurableObjectNamespace
      }

      const $ = new CrossDOContext(mockEnv)

      const customer = await $.Customer('c1').fetch('/')
      const order = await $.Order('o1').fetch('/')
      const product = await $.Product('p1').fetch('/')

      expect(customer).toEqual({ type: 'customer' })
      expect(order).toEqual({ type: 'order' })
      expect(product).toEqual({ type: 'product' })
    })
  })

  describe('Error handling', () => {
    it('should throw descriptive error for missing namespace', async () => {
      const $ = new CrossDOContext({})

      // NotFoundError.forResource generates "DONamespace with id NonExistent not found"
      expect(() => $.NonExistent('id-1')).toThrow('DONamespace with id NonExistent not found')
    })

    it('should handle network errors gracefully', async () => {
      interface TestDO {
        method(): Promise<void>
      }

      const mockEnv = {
        Test: {
          idFromName: () => ({ toString: () => 'test-id' }),
          get: () => ({
            fetch: async () => {
              throw new Error('Network error')
            }
          })
        } as unknown as DurableObjectNamespace
      }

      const $ = new CrossDOContext(mockEnv)

      await expect($.Test<TestDO>('test-1').method()).rejects.toThrow('Network error')
    })
  })

  describe('Connection pooling', () => {
    it('should reuse stubs for same DO id', async () => {
      interface TestDO {
        getValue(): Promise<number>
      }

      let fetchCount = 0
      const mockEnv = {
        Test: {
          idFromName: (name: string) => ({ toString: () => name }),
          get: (id: DurableObjectId) => ({
            id,
            fetch: async () => {
              fetchCount++
              return new Response(JSON.stringify(42))
            }
          })
        } as unknown as DurableObjectNamespace
      }

      const $ = new CrossDOContext(mockEnv)

      // Multiple calls to same DO
      await $.Test<TestDO>('test-1').getValue()
      await $.Test<TestDO>('test-1').getValue()
      await $.Test<TestDO>('test-1').getValue()

      // Fetch should be called 3 times (same stub, different calls)
      expect(fetchCount).toBe(3)
    })
  })

  describe('isDurableObjectId type guard (do-dx3gt)', () => {
    it('should reject null and undefined', () => {
      const mockBinding = {
        idFromName: () => ({ toString: () => 'fallback-id', name: undefined, equals: () => false }),
        get: () => ({ fetch: async () => new Response(JSON.stringify(42)) })
      } as unknown as DurableObjectNamespace

      // These should all use idFromName (treating input as string)
      // because the type guard rejects them
      let idFromNameCalled = false
      const bindingWithTracker = {
        ...mockBinding,
        idFromName: (name: string) => {
          idFromNameCalled = true
          return { toString: () => name, name: undefined, equals: () => false }
        }
      } as unknown as DurableObjectNamespace

      // null should be treated as a string and call idFromName
      createCrossDOClient<{ test(): Promise<void> }>(bindingWithTracker, null as unknown as string)
      expect(idFromNameCalled).toBe(true)
    })

    it('should reject objects without required methods', () => {
      let idFromNameCalled = false
      const mockBinding = {
        idFromName: () => {
          idFromNameCalled = true
          return { toString: () => 'id', name: undefined, equals: () => false }
        },
        get: () => ({ fetch: async () => new Response(JSON.stringify(42)) })
      } as unknown as DurableObjectNamespace

      // Object without equals method
      const fakeId1 = { toString: () => 'fake' }
      createCrossDOClient<{ test(): Promise<void> }>(mockBinding, fakeId1 as unknown as DurableObjectId)
      expect(idFromNameCalled).toBe(true)

      idFromNameCalled = false

      // Object without toString method
      const fakeId2 = { equals: () => false }
      createCrossDOClient<{ test(): Promise<void> }>(mockBinding, fakeId2 as unknown as DurableObjectId)
      expect(idFromNameCalled).toBe(true)
    })

    it('should reject objects without name property', () => {
      let idFromNameCalled = false
      const mockBinding = {
        idFromName: () => {
          idFromNameCalled = true
          return { toString: () => 'id', name: undefined, equals: () => false }
        },
        get: () => ({ fetch: async () => new Response(JSON.stringify(42)) })
      } as unknown as DurableObjectNamespace

      // Object with equals and toString but NO name property (spoofed object)
      const spoofedId = { equals: () => false, toString: () => 'spoofed-id' }
      createCrossDOClient<{ test(): Promise<void> }>(mockBinding, spoofedId as unknown as DurableObjectId)
      expect(idFromNameCalled).toBe(true)
    })

    it('should reject objects where toString returns non-string', () => {
      let idFromNameCalled = false
      const mockBinding = {
        idFromName: () => {
          idFromNameCalled = true
          return { toString: () => 'id', name: undefined, equals: () => false }
        },
        get: () => ({ fetch: async () => new Response(JSON.stringify(42)) })
      } as unknown as DurableObjectNamespace

      // Object where toString returns non-string
      const badId = { equals: () => false, toString: () => 123, name: undefined }
      createCrossDOClient<{ test(): Promise<void> }>(mockBinding, badId as unknown as DurableObjectId)
      expect(idFromNameCalled).toBe(true)
    })

    it('should reject objects where toString throws', () => {
      let idFromNameCalled = false
      const mockBinding = {
        idFromName: () => {
          idFromNameCalled = true
          return { toString: () => 'id', name: undefined, equals: () => false }
        },
        get: () => ({ fetch: async () => new Response(JSON.stringify(42)) })
      } as unknown as DurableObjectNamespace

      // Object where toString throws
      const throwingId = {
        equals: () => false,
        toString: () => { throw new Error('toString failed') },
        name: undefined
      }
      createCrossDOClient<{ test(): Promise<void> }>(mockBinding, throwingId as unknown as DurableObjectId)
      expect(idFromNameCalled).toBe(true)
    })

    it('should reject objects where toString returns empty string', () => {
      let idFromNameCalled = false
      const mockBinding = {
        idFromName: () => {
          idFromNameCalled = true
          return { toString: () => 'id', name: undefined, equals: () => false }
        },
        get: () => ({ fetch: async () => new Response(JSON.stringify(42)) })
      } as unknown as DurableObjectNamespace

      // Object where toString returns empty string
      const emptyStringId = { equals: () => false, toString: () => '', name: undefined }
      createCrossDOClient<{ test(): Promise<void> }>(mockBinding, emptyStringId as unknown as DurableObjectId)
      expect(idFromNameCalled).toBe(true)
    })

    it('should accept valid DurableObjectId-like objects with name property', () => {
      let idFromNameCalled = false
      const validId = {
        equals: () => false,
        toString: () => 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234',
        name: 'my-do-name'  // Real DurableObjectIds have this property
      }

      const mockBinding = {
        idFromName: () => {
          idFromNameCalled = true
          return validId
        },
        get: (id: DurableObjectId) => {
          // Verify we're getting the valid ID, not a transformed one
          expect(id.toString()).toBe(validId.toString())
          return { fetch: async () => new Response(JSON.stringify(42)) }
        }
      } as unknown as DurableObjectNamespace

      createCrossDOClient<{ test(): Promise<void> }>(mockBinding, validId as unknown as DurableObjectId)
      // Should NOT call idFromName because validId passes the type guard
      expect(idFromNameCalled).toBe(false)
    })
  })

  describe('CrossDOStubCache race condition handling (do-dx3gt)', () => {
    it('should return consistent stub when racing calls complete', async () => {
      const cache = new CrossDOStubCache()
      let stubCreationCount = 0

      const mockBinding = {
        idFromName: (name: string) => ({ toString: () => name, name, equals: () => false }),
        get: () => {
          stubCreationCount++
          return { id: stubCreationCount, fetch: async () => new Response() }
        }
      } as unknown as DurableObjectNamespace

      // Simulate concurrent calls (in JS single-threaded, these are sequential but mimic the pattern)
      const stub1 = cache.getStub(mockBinding, 'test-id')
      const stub2 = cache.getStub(mockBinding, 'test-id')
      const stub3 = cache.getStub(mockBinding, 'test-id')

      // All should return the same stub
      expect(stub1).toBe(stub2)
      expect(stub2).toBe(stub3)

      // Only one stub should have been created
      expect(stubCreationCount).toBe(1)
    })

    it('should handle concurrent getStub calls with same ID returning same stub', async () => {
      const cache = new CrossDOStubCache()
      const createdStubs: DurableObjectStub[] = []

      const mockBinding = {
        idFromName: (name: string) => ({ toString: () => name, name, equals: () => false }),
        get: () => {
          const stub = { uniqueId: Math.random(), fetch: async () => new Response() }
          createdStubs.push(stub as unknown as DurableObjectStub)
          return stub
        }
      } as unknown as DurableObjectNamespace

      // Make many concurrent calls
      const promises = Array(100).fill(null).map(() =>
        Promise.resolve(cache.getStub(mockBinding, 'concurrent-test'))
      )

      const stubs = await Promise.all(promises)

      // All returned stubs should be the same instance
      const firstStub = stubs[0]
      expect(stubs.every(s => s === firstStub)).toBe(true)

      // Only one stub should have been created (cache works correctly)
      expect(createdStubs.length).toBe(1)
    })

    it('should isolate different IDs in cache', () => {
      const cache = new CrossDOStubCache()
      let stubCreationCount = 0

      const mockBinding = {
        idFromName: (name: string) => ({ toString: () => name, name, equals: () => false }),
        get: () => {
          stubCreationCount++
          return { id: stubCreationCount, fetch: async () => new Response() }
        }
      } as unknown as DurableObjectNamespace

      const stubA1 = cache.getStub(mockBinding, 'id-a')
      const stubB1 = cache.getStub(mockBinding, 'id-b')
      const stubA2 = cache.getStub(mockBinding, 'id-a')
      const stubB2 = cache.getStub(mockBinding, 'id-b')

      // Same ID should return same stub
      expect(stubA1).toBe(stubA2)
      expect(stubB1).toBe(stubB2)

      // Different IDs should return different stubs
      expect(stubA1).not.toBe(stubB1)

      // Should have created exactly 2 stubs
      expect(stubCreationCount).toBe(2)
    })

    it('should handle eviction correctly during concurrent access', () => {
      const cache = new CrossDOStubCache()
      let stubCreationCount = 0

      const mockBinding = {
        idFromName: (name: string) => ({ toString: () => name, name, equals: () => false }),
        get: () => {
          stubCreationCount++
          return { generation: stubCreationCount, fetch: async () => new Response() }
        }
      } as unknown as DurableObjectNamespace

      // Get initial stub
      const stub1 = cache.getStub(mockBinding, 'test-id')
      expect(stubCreationCount).toBe(1)

      // Evict and get new stub
      cache.evict(mockBinding, 'test-id')
      const stub2 = cache.getStub(mockBinding, 'test-id')
      expect(stubCreationCount).toBe(2)

      // Stubs should be different (eviction worked)
      expect(stub1).not.toBe(stub2)

      // Subsequent calls should return the new cached stub
      const stub3 = cache.getStub(mockBinding, 'test-id')
      expect(stub2).toBe(stub3)
      expect(stubCreationCount).toBe(2)
    })
  })
})
