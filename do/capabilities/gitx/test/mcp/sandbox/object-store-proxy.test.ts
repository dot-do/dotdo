import { describe, it, expect } from 'vitest'
import { ObjectStoreProxy, createObjectStoreAccess } from '../../../src/mcp/sandbox/object-store-proxy'

describe('ObjectStoreProxy', () => {
  describe('class ObjectStoreProxy', () => {
    it('should route getObject through DO stub', async () => {
      const mock = { getObject: async () => ({ type: 'blob', data: new Uint8Array([1, 2, 3]) }) }
      const proxy = new ObjectStoreProxy(mock)
      const result = await proxy.getObject('abc123')
      expect(result).toEqual({ type: 'blob', data: new Uint8Array([1, 2, 3]) })
    })

    it('should route putObject through DO stub', async () => {
      const mock = { putObject: async () => 'abc123' }
      const proxy = new ObjectStoreProxy(mock)
      const sha = await proxy.putObject('blob', new Uint8Array([1, 2, 3]))
      expect(sha).toBe('abc123')
    })

    it('should route listObjects through DO stub', async () => {
      const mock = { listObjects: async () => ['sha1', 'sha2'] }
      const proxy = new ObjectStoreProxy(mock)
      const result = await proxy.listObjects({ type: 'blob', limit: 10 })
      expect(result).toEqual(['sha1', 'sha2'])
    })
  })

  describe('createObjectStoreAccess', () => {
    it('should create access object with proxy', () => {
      const access = createObjectStoreAccess({})
      expect(access).toHaveProperty('getProxy')
      expect(access).toHaveProperty('getObject')
    })

    it('should provide getProxy() method', () => {
      const access = createObjectStoreAccess({})
      const proxy = access.getProxy()
      expect(proxy).toBeInstanceOf(ObjectStoreProxy)
    })
  })
})
